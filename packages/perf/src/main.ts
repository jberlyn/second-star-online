/**
 * `bun run perf [scenario|all|soak|browser] [--profile p] [--seconds s] [--ramp s] [--seed n]`
 * One run: stage a scratch database, start the real server pinned to core 0,
 * the relay(s) and three bot processes on cores 1-3, wait, stop everything, and write
 * `perf-results/<run>/report.md` and `report.json`. Raw lines stay beside them.
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { join, resolve } from "node:path";

import type { BotsLine, BotsSpec } from "./bots.ts";
import {
  assertDockerSupported,
  assertScratchDataDir,
  DEFAULT_PERF_IMAGE,
  dockerHostLine,
  inspectDockerInfo,
  prepareDataOwnership,
  type StartedContainer,
  startDockerServer,
} from "./docker.ts";
import { PROFILES } from "./relay.ts";
import { reportMarkdown, type ServerLine, type Summary, summarize } from "./report.ts";
import { type BotPlan, SCENARIOS, type Scenario } from "./scenarios.ts";
import { stage } from "./stage.ts";

const ROOT = resolve(import.meta.dir, "..", "..", "..");
const BOT_PROCESSES = 3;
/** The server's core and the bots' (`PERF_SERVER_CORE=3 PERF_BOT_CORES=0-2` moves them). */
const SERVER_CORE = process.env.PERF_SERVER_CORE ?? "0";
const BOT_CORES = process.env.PERF_BOT_CORES ?? "1-3";

export interface Args {
  what: string;
  profile?: string;
  seconds?: number;
  ramp?: number;
  seed: number;
  hours?: number;
  docker?: boolean;
  image?: string;
}

export function parseArgs(argv: string[]): Args {
  const args: Args = { what: "town", seed: 1 };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    const next = () => argv[++i] ?? "";
    if (a === "--profile") {
      args.profile = next();
    } else if (a === "--seconds") {
      args.seconds = Number(next());
    } else if (a === "--ramp") {
      args.ramp = Number(next());
    } else if (a === "--seed") {
      args.seed = Number(next());
    } else if (a === "--hours") {
      args.hours = Number(next());
    } else if (a === "--docker") {
      args.docker = true;
    } else if (a === "--image") {
      const img = next();
      if (!img || img.startsWith("-")) {
        throw new Error("--image requires an image name");
      }
      args.image = img;
      args.docker = true;
    } else {
      rest.push(a);
    }
  }
  args.what = rest[0] ?? "town";
  return args;
}

function freePort(): number {
  const s = Bun.serve({ port: 0, fetch: () => new Response("") });
  const port = s.port ?? 0;
  s.stop(true);
  return port;
}

const pinned = (cores: string, cmd: string[]): string[] =>
  Bun.which("taskset") ? ["taskset", "-c", cores, ...cmd] : cmd;

function readLines<T>(path: string): T[] {
  try {
    return readFileSync(path, "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l) as T);
  } catch {
    return [];
  }
}

function hostLine(): string {
  const c = cpus();
  const pin = Bun.which("taskset")
    ? `server pinned to core ${SERVER_CORE}, bots and relay on cores ${BOT_CORES}`
    : "taskset missing: nothing pinned, bots share the server's cores";
  return `Host: ${c[0]?.model ?? "unknown"}, ${c.length} cores. ${pin}. Bun ${Bun.version}.`;
}

export interface RunOptions {
  scenario: Scenario;
  profile: string;
  seed: number;
  dir: string;
  churn?: boolean;
  /** Keep the server and bots running this long (ms) instead of ramp + seconds. */
  durationMs?: number;
  /** Leave the server running after the bots stop (soak: the caller kills it). */
  keepServer?: boolean;
  /** Characters staged but not played (the browser check logs in as one). */
  extra?: BotPlan[];
  /** Runs after the ramp, with the server's port, instead of waiting out `scenario.seconds`. */
  during?: (info: { serverPort: number; server: ReturnType<typeof Bun.spawn> }) => Promise<void>;
  /** Docker image to run instead of the host server process. */
  image?: string;
}

export interface RunResult {
  summary: Summary;
  serverLines: ServerLine[];
  botLines: BotsLine[];
  dbPath: string;
  fromT: number;
}

/** One scenario at one profile. */
export async function runScenario(o: RunOptions): Promise<RunResult> {
  if (o.image) {
    assertScratchDataDir(o.dir, join(ROOT, "perf-results"));
  }
  mkdirSync(o.dir, { recursive: true });
  const dataDir = o.image ? join(o.dir, "data") : o.dir;
  mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, "sso.sqlite");
  const perfOut = join(dataDir, "server.jsonl");
  writeFileSync(perfOut, "");
  await stage({
    dbPath,
    maps: o.scenario.maps,
    bots: [...o.scenario.bots, ...(o.extra ?? [])],
    pvpMaps: o.scenario.pvpMaps,
    monsters: o.scenario.monsters,
  });

  const port = freePort();
  let server: ReturnType<typeof Bun.spawn> | null = null;
  let container: StartedContainer | null = null;
  const onSignal = () => {
    container?.stopAndRemove(o.dir);
    process.exit(1);
  };
  if (o.image) {
    prepareDataOwnership(dataDir, o.image);
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
    container = startDockerServer({
      image: o.image,
      dataDir,
      port,
      cpusetCpus: SERVER_CORE,
      perfOutName: "server.jsonl",
    });
  } else {
    server = Bun.spawn(pinned(SERVER_CORE, ["bun", join(ROOT, "packages/server/src/main.ts")]), {
      cwd: ROOT,
      env: {
        ...process.env,
        SSO_DB: dbPath,
        PORT: String(port),
        SSO_PERF_OUT: perfOut,
        // Every bot connects from this machine.
        SSO_SOCKETS_PER_IP: "0",
        NODE_ENV: "production",
        // PERF_GC_LOG=1 logs every JavaScriptCore collection into server.err.log/server.log.
        ...(process.env.PERF_GC_LOG ? { BUN_JSC_logGC: "1" } : {}),
      },
      stdout: Bun.file(join(o.dir, "server.log")),
      stderr: Bun.file(join(o.dir, "server.err.log")),
    });
  }

  const relays: ReturnType<typeof Bun.spawn>[] = [];
  const botProcs: ReturnType<typeof Bun.spawn>[] = [];
  const botsOut: string[] = [];
  let fromT = 0;

  try {
    await waitForPort(port);

    // One relay per distinct profile the bots use.
    const profiles = new Set<string>([
      o.profile,
      ...o.scenario.bots.map((b) => b.profile ?? o.profile),
    ]);
    const urls: Record<string, string> = {};
    for (const p of profiles) {
      const relayPort = freePort();
      relays.push(
        Bun.spawn(
          pinned(BOT_CORES, [
            "bun",
            join(ROOT, "packages/perf/src/relay.ts"),
            String(relayPort),
            `127.0.0.1:${port}`,
            p,
            String(o.seed),
          ]),
          { cwd: ROOT, stdout: "ignore", stderr: "inherit" },
        ),
      );
      await waitForPort(relayPort);
      urls[p] = `ws://127.0.0.1:${relayPort}/ws`;
      if (p === o.profile) {
        urls.default = urls[p] ?? "";
      }
    }

    const shares: BotPlan[][] = Array.from({ length: BOT_PROCESSES }, () => []);
    o.scenario.bots.forEach((b, i) => {
      shares[i % BOT_PROCESSES]?.push(b);
    });
    const inventoryOut: string[] = [];
    shares.forEach((bots, i) => {
      const out = join(o.dir, `bots-${i}.jsonl`);
      writeFileSync(out, "");
      botsOut.push(out);
      const inv = join(o.dir, `inventory-${i}.json`);
      inventoryOut.push(inv);
      const spec: BotsSpec = {
        urls,
        bots,
        seed: o.seed * 10 + i,
        rampSeconds: o.scenario.rampSeconds,
        out,
        churn: o.churn,
        inventoryOut: inv,
      };
      const specPath = join(o.dir, `spec-${i}.json`);
      writeFileSync(specPath, JSON.stringify(spec));
      botProcs.push(
        Bun.spawn(pinned(BOT_CORES, ["bun", join(ROOT, "packages/perf/src/bots.ts"), specPath]), {
          cwd: ROOT,
          stdout: "inherit",
          stderr: "inherit",
        }),
      );
    });

    const startedAt = Date.now();
    fromT = startedAt + o.scenario.rampSeconds * 1000 + 5000;
    const total = o.durationMs ?? (o.scenario.rampSeconds + o.scenario.seconds + 5) * 1000;
    if (o.during && server) {
      await Bun.sleep((o.scenario.rampSeconds + 5) * 1000);
      await o.during({ serverPort: port, server });
    } else {
      await Bun.sleep(total);
    }
  } finally {
    if (o.image) {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
    }
    for (const p of botProcs) {
      p.kill("SIGTERM");
    }
    await Promise.all(botProcs.map((p) => p.exited));
    for (const r of relays) {
      r.kill();
    }
    if (container) {
      container.stopAndRemove(o.dir);
    } else if (server && !o.keepServer) {
      server.kill("SIGINT");
      await server.exited;
    }
  }

  const serverLines = readLines<ServerLine>(perfOut);
  const botLines = botsOut.flatMap((p) => readLines<BotsLine>(p));
  const summary = summarize(o.scenario.name, o.profile, serverLines, botLines, fromT);
  return { summary, serverLines, botLines, dbPath, fromT };
}

async function waitForPort(port: number): Promise<void> {
  for (let i = 0; i < 200; i++) {
    try {
      const s = await Bun.connect({
        hostname: "127.0.0.1",
        port,
        socket: { data() {}, open() {} },
      });
      s.end();
      return;
    } catch {
      await Bun.sleep(100);
    }
  }
  throw new Error(`nothing listening on ${port}`);
}

/** The default matrix of `all`: every scenario at lan, home and mobile; the 150 ms profile for the snap target. */
function matrix(): { name: string; profile: string }[] {
  const out: { name: string; profile: string }[] = [];
  for (const name of Object.keys(SCENARIOS)) {
    const profiles = name === "burst" || name === "behind" ? ["home"] : ["lan", "home", "mobile"];
    if (name === "town" || name === "world200") {
      profiles.push("p150");
    }
    for (const profile of profiles) {
      out.push({ name, profile });
    }
  }
  return out;
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  assertDockerSupported(args.what, args.docker, args.image);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const root = join(ROOT, "perf-results", stamp);
  mkdirSync(root, { recursive: true });

  if (args.what === "browser") {
    const { runBrowser } = await import("./browser.ts");
    await runBrowser(root, args.seed);
    process.exit(0);
  }
  if (args.what === "soak") {
    const { runSoak } = await import("./soak.ts");
    await runSoak(root, args.hours ?? 3, args.seed);
    process.exit(0);
  }

  const image = args.docker ? (args.image ?? DEFAULT_PERF_IMAGE) : undefined;
  const hostDescription = image
    ? dockerHostLine(inspectDockerInfo(image), SERVER_CORE, BOT_CORES)
    : hostLine();

  const jobs =
    args.what === "all" ? matrix() : [{ name: args.what, profile: args.profile ?? "home" }];
  const summaries: Summary[] = [];
  for (const job of jobs) {
    const make = SCENARIOS[job.name];
    if (!make) {
      console.error(
        `unknown scenario ${job.name}; try: ${Object.keys(SCENARIOS).join(", ")}, all, soak, browser`,
      );
      process.exit(1);
    }
    if (!PROFILES[job.profile]) {
      console.error(`unknown profile ${job.profile}; try: ${Object.keys(PROFILES).join(", ")}`);
      process.exit(1);
    }
    const scenario = make();
    if (args.seconds !== undefined) {
      scenario.seconds = args.seconds;
    }
    if (args.ramp !== undefined) {
      scenario.rampSeconds = args.ramp;
    }
    console.log(`== ${scenario.name} @ ${job.profile}: ${scenario.description}`);
    const result = await runScenario({
      scenario,
      profile: job.profile,
      seed: args.seed,
      dir: join(root, `${scenario.name}-${job.profile}`),
      image,
    });
    summaries.push(result.summary);
    const md = reportMarkdown(hostDescription, summaries);
    writeFileSync(join(root, "report.md"), md);
    writeFileSync(join(root, "report.json"), JSON.stringify(summaries, null, 2));
    appendFileSync(join(root, "progress.log"), `${scenario.name} ${job.profile} done\n`);
  }
  console.log(readFileSync(join(root, "report.md"), "utf8"));
  console.log(`report: ${join(root, "report.md")}`);
}
