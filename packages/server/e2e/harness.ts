/**
 * Bot E2E harness: a real server on a free port with an in-memory database, and headless
 * WebSocket bots that speak the real protocol.
 *
 * Tests run the sim by hand (`tickNow`), so every run is the same tick for tick.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  ClientMsg,
  CreateMsg,
  DeltaEvent,
  InventoryView,
  ServerMsg,
} from "@secondstaronline/shared";

import { WS_PATH } from "../src/gateway/server.ts";
import { type RunningServer, type ServerOptions, startServer } from "../src/main.ts";
import type { Db } from "../src/persistence/database.ts";
import { saveSettingOverride } from "../src/persistence/settings.ts";
import { type Rng, scriptedRng } from "../src/rng.ts";
import { manualClock } from "../tests/helpers/manual-clock.ts";
import { prepareScenarioMap } from "../tests/helpers/scenario-map.ts";

export interface TestServer extends RunningServer {
  /** Every throw the game caught at an entry point since the server started. */
  faults: { where: string; err: unknown }[];
  wsUrl: string;
  clock: ReturnType<typeof manualClock>;
}

export interface TestServerOptions {
  /** Defaults to an RNG that never rolls a push, so bots walking into each other only block. */
  rng?: Rng;
  /** Runs after migrations, before settings load: add maps, settings overrides. */
  prepare?: (db: Db) => void;
  /** A database file instead of `:memory:`, so a test can restart the server on it. */
  dbPath?: string;
  /** Wall-clock time for rows and loot decay (default a fixed instant). */
  isoNow?: () => string;
  /** Keep the login, creation and socket limits (default off, so bots can log in freely). */
  limits?: boolean;
  /** Reverse proxies in front (`SSO_PROXY_HOPS`). */
  proxyHops?: number;
  /** Receives throws the game caught at an entry point (default: collected in `faults`). */
  onFault?: (where: string, err: unknown) => void;
  /** Named crash windows. */
  crashPoint?: (label: string) => void;
  /** Makes a socket look behind (default the socket's own backlog). */
  backlogOf?: ServerOptions["backlogOf"];
  /** The perf output file (wires the tick probe). */
  perfOut?: string;
  /** Receives the tick lag line. */
  onLag?: (line: string) => void;
  /** Prebuilt client directory override (defaults to an isolated test fixture). */
  clientDir?: string;
}

let fixtureClientDir: string | null = null;
function defaultFixtureClientDir(): string {
  if (fixtureClientDir) {
    return fixtureClientDir;
  }
  const dir = mkdtempSync(join(tmpdir(), "sso-e2e-client-"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "index.html"),
    '<!doctype html><html><head><title>Second Star Online</title><link rel="stylesheet" href="/app.css"></head><body><script type="module" src="/app.js"></script></body></html>',
  );
  writeFileSync(join(dir, "app.js"), "console.log('sso');\n");
  writeFileSync(join(dir, "app.css"), "body{margin:0}\n");
  fixtureClientDir = dir;
  return dir;
}

export function startTestServer(options: TestServerOptions = {}): TestServer {
  const clock = manualClock();
  const faults: { where: string; err: unknown }[] = [];
  const server = startServer({
    dbPath: options.dbPath ?? ":memory:",
    port: 0,
    development: false,
    clientDir: options.clientDir ?? defaultFixtureClientDir(),
    clock,
    autoTick: false,
    isoNow: options.isoNow ?? (() => "2026-11-04T00:00:00.000Z"),
    rng: options.rng ?? scriptedRng([2]),
    prepare: (db) => {
      prepareScenarioMap(db);
      if (!options.limits) {
        for (const key of [
          "loginFailsPerIp",
          "loginFailsPerAccount",
          "createsPerIp",
          "socketsPerIp",
        ]) {
          saveSettingOverride(db, key, 0, "2026-11-04T00:00:00.000Z");
        }
      }
      options.prepare?.(db);
    },
    proxyHops: options.proxyHops,
    onFault:
      options.onFault ??
      ((where, err) => {
        faults.push({ where, err });
        console.error(`fault in ${where}`, err);
      }),
    crashPoint: options.crashPoint,
    backlogOf: options.backlogOf,
    perfOut: options.perfOut,
    onLag: options.onLag,
  });
  const wsUrl = new URL(WS_PATH, server.url);
  wsUrl.protocol = "ws:";
  return { ...server, faults, wsUrl: wsUrl.href, clock };
}

/** Opens a WebSocket and resolves with how it was closed. */
export function connectUntilClosed(
  url: string,
): Promise<{ opened: boolean; code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let opened = false;
    ws.addEventListener("open", () => {
      opened = true;
    });
    ws.addEventListener("close", (e) => resolve({ opened, code: e.code, reason: e.reason }));
    ws.addEventListener("error", () => {
      if (!opened) {
        reject(new Error(`could not connect to ${url}`));
      }
    });
  });
}

export interface Bot {
  /** Every message received, in order. */
  readonly inbox: ServerMsg[];
  send(msg: ClientMsg): void;
  /** Resolves with the first message (already received or future) matching `pred`. */
  waitFor<T extends ServerMsg>(pred: (m: ServerMsg) => m is T, timeoutMs?: number): Promise<T>;
  waitFor(pred: (m: ServerMsg) => boolean, timeoutMs?: number): Promise<ServerMsg>;
  /** Forgets received messages, so the next `waitFor` only sees new ones. */
  clear(): void;
  closed: Promise<{ code: number; reason: string }>;
  close(): void;
}

export async function connectBot(url: string): Promise<Bot> {
  const ws = new WebSocket(url);
  const inbox: ServerMsg[] = [];
  const waiters: { pred: (m: ServerMsg) => boolean; resolve: (m: ServerMsg) => void }[] = [];
  let resolveClosed: (v: { code: number; reason: string }) => void = () => {};
  const closed = new Promise<{ code: number; reason: string }>((r) => {
    resolveClosed = r;
  });
  ws.addEventListener("message", (e) => {
    const msg = JSON.parse(String(e.data)) as ServerMsg;
    inbox.push(msg);
    for (let i = waiters.length - 1; i >= 0; i--) {
      const w = waiters[i];
      if (w?.pred(msg)) {
        waiters.splice(i, 1);
        w.resolve(msg);
      }
    }
  });
  ws.addEventListener("close", (e) => resolveClosed({ code: e.code, reason: e.reason }));
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", () => reject(new Error(`could not connect to ${url}`)), {
      once: true,
    });
  });
  const bot: Bot = {
    inbox,
    send: (msg) => ws.send(JSON.stringify(msg)),
    waitFor(pred: (m: ServerMsg) => boolean, timeoutMs = 3000): Promise<ServerMsg> {
      const seen = inbox.find(pred);
      if (seen) {
        return Promise.resolve(seen);
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("bot: timed out waiting")), timeoutMs);
        waiters.push({
          pred,
          resolve: (m) => {
            clearTimeout(timer);
            resolve(m);
          },
        });
      });
    },
    clear: () => {
      inbox.length = 0;
    },
    closed,
    close: () => ws.close(),
  } as Bot;
  return bot;
}

/** Lets in-flight socket messages arrive. */
export function settle(ms = 30): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** A `create` message for a character with every stat 11 (classCode 1 Fighter, 2 Mage). */
export function make(name: string, classCode: 1 | 2 | 3 = 2): CreateMsg {
  return {
    t: "create",
    name,
    password: "secret",
    sex: 1,
    head: 1,
    classCode,
    str: 11,
    sta: 11,
    int: 11,
    wis: 11,
    dex: 11,
  };
}

/** Connects a bot, logs `name` in with the shared password and sends `mapReady`. */
export async function login(server: TestServer, name: string, password = "secret"): Promise<Bot> {
  const bot = await connectBot(server.wsUrl);
  bot.send({ t: "login", name, password });
  await bot.waitFor((m) => m.t === "snapshot");
  bot.send({ t: "mapReady" });
  await settle();
  return bot;
}

/** Lets intents arrive, runs `n` ticks, then lets the replies arrive; the clock moves `n*50` ms. */
export async function tick(server: TestServer, n: number): Promise<void> {
  await settle();
  server.clock.advance(n * 50);
  server.tickNow(n);
  await settle();
}

/** Sends a chat line (or a `/command`) and lets the reply arrive. */
export async function say(bot: Bot, text: string): Promise<void> {
  bot.send({ t: "chat", text });
  await settle();
}

/** The character's id by name. */
export function idOf(db: Db, name: string): string {
  return (db.query("SELECT id FROM characters WHERE name = ?").get(name) as { id: string }).id;
}

/** Puts a character on a map tile in the database (only while the character is logged out). */
export function place(db: Db, name: string, map: string, x: number, y: number, facing = "N"): void {
  const m = /^x(\d+)y(\d+)$/.exec(map);
  db.run(
    "UPDATE characters SET map_id = (SELECT id FROM maps WHERE mx = ? AND my = ?), x = ?, y = ?, facing = ? WHERE name = ?",
    [Number(m?.[1]), Number(m?.[2]), x, y, facing, name],
  );
}

/**
 * Staging: turns the live player to face `dir` with no tick. 1.6 logs in facing south;
 * tests about what happens at a faced tile call this right after
 * login. A direct set, not a Turn intent, which would need a tick and shift scripted rngs.
 */
export function face(server: TestServer, name: string, dir: "N" | "S" | "E" | "W"): void {
  const p = [...server.game.world.players.values()].find((x) => x.name === name);
  if (!p) {
    throw new Error(`${name} is not in`);
  }
  p.facing = dir;
}

/** Every chat line received since the last `clear()`. */
export const chats = (bot: Bot): string[] =>
  bot.inbox.flatMap((m) => (m.t === "chat" ? [m.text] : []));

/** Every delta event received since the last `clear()`. */
export const deltas = (bot: Bot): DeltaEvent[] =>
  bot.inbox.flatMap((m) => (m.t === "delta" ? m.events : []));

const invs = new Map<Bot, InventoryView>();
/** The newest inventory the bot has seen, sticky across `clear()`. */
export function lastInv(bot: Bot): InventoryView | undefined {
  const inv = bot.inbox
    .filter((m): m is Extract<ServerMsg, { t: "inv" }> => m.t === "inv")
    .at(-1)?.inv;
  if (inv) {
    invs.set(bot, inv);
  }
  return invs.get(bot);
}

/** The 1-based bag slot holding `item`, or 0. */
export const slotOf = (bot: Bot, item: string): number =>
  (lastInv(bot)?.bag.findIndex((l) => l?.item === item) ?? -1) + 1;

/** The middle of a tile on the stage: `(mouse − (30, 31)) / 32 + 1` names it. */
export const centre = (x: number, y: number) => ({ x: x * 32 + 14, y: y * 32 + 15 });

export interface QueueRng extends Rng {
  /** The next answers for `random(n)`; an empty queue answers `n` (a roll that never matches). */
  queue(n: number, ...answers: number[]): void;
  /** Every `random(n)` answers `answer` (even hunger's) until `fix(n, null)`. */
  fix(n: number, answer: number | null): void;
  /** Forgets every queued and fixed answer. */
  reset(): void;
}

/** One shared RNG for a whole playthrough: `random(n)` answers `n` unless a test queued otherwise. */
export function queueRng(): QueueRng {
  const queues = new Map<number, number[]>();
  const fixed = new Map<number, number>();
  return {
    random(n) {
      if (!(n >= 1)) {
        return 0;
      }
      return fixed.get(n) ?? queues.get(n)?.shift() ?? n;
    },
    fix(n, answer) {
      if (answer === null) {
        fixed.delete(n);
      } else {
        fixed.set(n, answer);
      }
    },
    queue(n, ...answers) {
      queues.set(n, [...(queues.get(n) ?? []), ...answers]);
    },
    reset() {
      queues.clear();
      fixed.clear();
    },
  };
}
