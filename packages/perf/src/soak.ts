/**
 * `bun run perf soak [--hours h]`: 200 bots play for hours on one server on
 * the file database, some leaving and coming back so sessions churn. Once a minute the row count
 * of every table is sampled. At the end the server is killed with SIGKILL while the bots still
 * play, restarted on the same file, and checked: `integrity_check`, every character still
 * there, every bot's last-seen inventory against what SQL holds (differences are changes that
 * had not been saved yet), and every bot able to log in again.
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { openDatabase } from "@secondstaronline/server/src/persistence/database.ts";

import type { BotsLine } from "./bots.ts";
import { runScenario } from "./main.ts";
import { type ServerLine, summarize } from "./report.ts";
import { world } from "./scenarios.ts";
import { PASSWORD } from "./stage.ts";

const ROOT = resolve(import.meta.dir, "..", "..", "..");

type Db = ReturnType<typeof openDatabase>;

function tableCounts(db: Db): Record<string, number> {
  const out: Record<string, number> = {};
  const tables = db
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    )
    .all();
  for (const { name } of tables) {
    out[name] = Number((db.query(`SELECT count(*) AS n FROM "${name}"`).get() as { n: number }).n);
  }
  return out;
}

/** Slope of a least-squares line through (hours, value) pairs, as a share of the mean per hour. */
export function growthPerHour(points: { h: number; v: number }[]): number {
  if (points.length < 3) {
    return 0;
  }
  const n = points.length;
  const mx = points.reduce((a, p) => a + p.h, 0) / n;
  const my = points.reduce((a, p) => a + p.v, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.h - mx) * (p.v - my);
    den += (p.h - mx) ** 2;
  }
  return den === 0 || my === 0 ? 0 : num / den / my;
}

async function waitForPort(port: number): Promise<void> {
  for (let i = 0; i < 300; i++) {
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

/** Logs a character in over the protocol; true on a snapshot. */
function canLogIn(url: string, name: string): Promise<boolean> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    const done = (ok: boolean) => {
      try {
        ws.close();
      } catch {}
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), 15000);
    ws.addEventListener("open", () =>
      ws.send(JSON.stringify({ t: "login", name, password: PASSWORD })),
    );
    ws.addEventListener("message", (e) => {
      const m = JSON.parse(String(e.data)) as { t: string };
      if (m.t === "snapshot") {
        clearTimeout(timer);
        done(true);
      } else if (m.t === "denied") {
        clearTimeout(timer);
        done(false);
      }
    });
    ws.addEventListener("error", () => done(false));
  });
}

export async function runSoak(dir: string, hours: number, seed: number): Promise<void> {
  const scenario = world(200, 300, "soak");
  const tablesOut = join(dir, "tables.jsonl");
  writeFileSync(tablesOut, "");
  const t0 = Date.now();
  const durationMs = hours * 3600 * 1000;
  const result = await runScenario({
    scenario,
    profile: "home",
    seed,
    dir: join(dir, "soak"),
    churn: true,
    keepServer: true,
    during: async ({ server }) => {
      const dbPath = join(dir, "soak", "sso.sqlite");
      const db = openDatabase(dbPath);
      while (Date.now() - t0 < durationMs) {
        await Bun.sleep(60_000);
        appendFileSync(
          tablesOut,
          `${JSON.stringify({ t: Date.now(), tables: tableCounts(db) })}\n`,
        );
      }
      db.close();
      // The crash: SIGKILL while the bots are still playing.
      server.kill("SIGKILL");
      await server.exited;
    },
  });

  // ---- growth over the run -----------------------------------------------------------------
  const lines = result.serverLines;
  const first = lines[0]?.t ?? t0;
  const perMinute = new Map<number, ServerLine[]>();
  for (const l of lines) {
    const m = Math.floor((l.t - first) / 60000);
    perMinute.set(m, [...(perMinute.get(m) ?? []), l]);
  }
  const rssPoints: { h: number; v: number }[] = [];
  const p99Points: { h: number; v: number }[] = [];
  const walPoints: number[] = [];
  for (const [m, ls] of perMinute) {
    if (m < 30) {
      continue; // after the first 30 minutes
    }
    const h = m / 60;
    rssPoints.push({ h, v: Math.max(...ls.map((l) => l.rss)) });
    const all = ls.flatMap((l) => l.raw.total).sort((a, b) => a - b);
    p99Points.push({ h, v: all[Math.min(all.length - 1, Math.ceil(0.99 * all.length) - 1)] ?? 0 });
    walPoints.push(Math.max(...ls.map((l) => l.walBytes)));
  }
  const tables = readFileSync(tablesOut, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { t: number; tables: Record<string, number> });
  const growing: string[] = [];
  const firstT = tables[Math.floor(tables.length / 4)]?.tables ?? {};
  const lastT = tables.at(-1)?.tables ?? {};
  for (const [name, n] of Object.entries(lastT)) {
    const before = firstT[name] ?? 0;
    if (n > before) {
      growing.push(`${name} ${before} -> ${n}`);
    }
  }
  const steady = summarize("soak", "home", lines, result.botLines, first + 30 * 60000);

  // ---- the crash check ---------------------------------------------------------------------
  const dbPath = join(dir, "soak", "sso.sqlite");
  const port = Number(10000 + Math.floor(Math.random() * 20000));
  const restarted = Bun.spawn(["bun", join(ROOT, "packages/server/src/main.ts")], {
    cwd: ROOT,
    env: { ...process.env, SSO_DB: dbPath, PORT: String(port), NODE_ENV: "production" },
    stdout: "ignore",
    stderr: "inherit",
  });
  await waitForPort(port);
  const db = openDatabase(dbPath);
  const integrity = (db.query("PRAGMA integrity_check").get() as { integrity_check: string })
    .integrity_check;
  const characters = Number(
    (db.query("SELECT count(*) AS n FROM characters").get() as { n: number }).n,
  );

  let compared = 0;
  let differing = 0;
  for (let i = 0; i < 3; i++) {
    let inv: Record<
      string,
      { gold: number; bag: ({ item: string; qty: number } | null)[] } | null
    > = {};
    try {
      inv = JSON.parse(readFileSync(join(dir, "soak", `inventory-${i}.json`), "utf8"));
    } catch {}
    for (const [name, seen] of Object.entries(inv)) {
      if (!seen) {
        continue;
      }
      compared += 1;
      const row = db
        .query<{ id: string; gold: number }, [string]>(
          "SELECT id, gold FROM characters WHERE name = ?",
        )
        .get(name);
      if (!row) {
        differing += 1;
        continue;
      }
      const bag = db
        .query<{ slot: number; item: string; qty: number }, [string]>(
          "SELECT slot, item, qty FROM inventory WHERE character_id = ? ORDER BY slot",
        )
        .all(row.id);
      const same =
        row.gold === seen.gold &&
        seen.bag.every((l, k) => {
          const stored = bag.find((b) => b.slot === k + 1);
          return l ? stored?.item === l.item && stored.qty === l.qty : !stored;
        });
      if (!same) {
        differing += 1;
      }
    }
  }
  db.close();

  const url = `ws://127.0.0.1:${port}/ws`;
  let loggedIn = 0;
  const names = scenario.bots.map((b) => b.name);
  for (let i = 0; i < names.length; i += 20) {
    const results = await Promise.all(names.slice(i, i + 20).map((n) => canLogIn(url, n)));
    loggedIn += results.filter(Boolean).length;
  }
  restarted.kill("SIGINT");
  await restarted.exited;

  const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
  const report = [
    `# Soak report (${hours} h, 200 bots, world200 at home, file database)`,
    "",
    `- rss growth per hour after 30 min: ${pct(growthPerHour(rssPoints))} (pass: under 10%)`,
    `- tick p99 growth per hour after 30 min: ${pct(growthPerHour(p99Points))} (pass: under 10%)`,
    `- steady-state tick p50 / p99 / worst: ${steady.tick.p50} / ${steady.tick.p99} / ${steady.tick.max} ms, dropped ${steady.dropped}`,
    `- WAL file, largest seen: ${Math.round(Math.max(0, ...walPoints) / 1024 / 1024)} MB`,
    `- tables whose rows grew (first quarter -> end): ${growing.length ? growing.join("; ") : "none"}`,
    `- after kill -9 and restart: integrity_check ${integrity}; ${characters} characters (staged ${names.length}); ${compared} inventories compared, ${differing} differ (changes not yet saved when the process died); ${loggedIn} of ${names.length} bots logged in again`,
    "",
  ].join("\n");
  writeFileSync(join(dir, "soak-report.md"), report);
  console.log(report);
}
