/**
 * Crashes: a child server on a file database kills itself (SIGKILL) at a named window
 * (`SSO_CRASH_AT`), starts again, and the conservation check still holds with nobody stuck. Every
 * intent and tick is one SQL transaction, so a kill inside it lands on the state before it.
 *
 * Scenes are built with the in-process test server on the same file, then the child plays.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ClientMsg } from "@secondstaronline/shared";

import { expectConserved, totals } from "./conservation.ts";
import { connectBot, idOf, make, settle, startTestServer } from "./harness.ts";

const SERVER_DIR = join(import.meta.dir, "..");

interface Child {
  url: string;
  proc: ReturnType<typeof Bun.spawn>;
  /** Resolves with the exit signal once the process is gone. */
  exited: Promise<{ signal: string | number | null; code: number | null }>;
}

/** Starts `bun src/main.ts` on `dbPath` and waits for its "listening on" line. */
async function spawnServer(
  dbPath: string,
  crashAt?: string,
  extraEnv: Record<string, string> = {},
): Promise<Child> {
  const clientDir = join(dir, "client");
  rmSync(clientDir, { recursive: true, force: true });
  mkdirSync(clientDir, { recursive: true });
  writeFileSync(join(clientDir, "index.html"), "<!doctype html><title>Second Star Online</title>");
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    SSO_DB: dbPath,
    SSO_CLIENT_DIR: clientDir,
    PORT: "0",
    ...extraEnv,
  };
  if (crashAt) {
    env.SSO_CRASH_AT = crashAt;
  } else {
    delete env.SSO_CRASH_AT;
  }
  const proc = Bun.spawn(["bun", "src/main.ts"], {
    cwd: SERVER_DIR,
    env,
    stdout: "pipe",
    stderr: "ignore",
  });
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let seen = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) {
      throw new Error(`the server exited before listening: ${seen}`);
    }
    seen += decoder.decode(value);
    const m = /listening on (\S+)/.exec(seen);
    if (m?.[1]) {
      reader.releaseLock();
      return {
        url: m[1],
        proc,
        exited: proc.exited.then(() => ({
          signal: proc.signalCode,
          code: proc.exitCode,
        })),
      };
    }
  }
}

const wsOf = (c: Child) => {
  const u = new URL("/ws", c.url);
  u.protocol = "ws:";
  return u.href;
};

let dir = "";
const children: Child[] = [];
afterEach(() => {
  for (const c of children.splice(0)) {
    c.proc.kill("SIGKILL");
  }
  if (dir) {
    rmSync(dir, { recursive: true, force: true });
    dir = "";
  }
});

/** Builds the scene on a file with the in-process server, then closes it. */
async function build(setup: (db: ReturnType<typeof startTestServer>["db"]) => void) {
  dir = mkdtempSync(join(tmpdir(), "sso-crash-"));
  const dbPath = join(dir, "sso.sqlite");
  const server = startTestServer({ dbPath });
  const maker = await connectBot(server.wsUrl);
  for (const name of ["Alice", "Bob"]) {
    maker.send(make(name));
    await maker.waitFor((m) => m.t === "created");
    maker.clear();
  }
  maker.close();
  setup(server.db);
  await server.stop();
  const check = startTestServer({ dbPath });
  const before = totals(check.db);
  await check.stop();
  return { dbPath, before };
}

const after = async (dbPath: string) => {
  const check = startTestServer({ dbPath });
  const t = totals(check.db);
  return { check, t };
};

const loginTo = async (c: Child, name: string) => {
  const bot = await connectBot(wsOf(c));
  bot.send({ t: "login", name, password: "secret" });
  await bot.waitFor((m) => m.t === "snapshot");
  bot.send({ t: "mapReady" });
  await settle(100);
  return bot;
};

/** The player can log in on a fresh server, is on the map, and is in no trade. */
async function expectPlayable(dbPath: string, names: string[]) {
  const c = await spawnServer(dbPath);
  children.push(c);
  for (const name of names) {
    const bot = await loginTo(c, name);
    bot.send({ t: "tradeOpen", id: "00000000-0000-4000-8000-000000000000" } as ClientMsg);
    bot.close();
  }
  c.proc.kill("SIGTERM");
  expect((await c.exited).code).toBe(0); // a stop signal saves and exits cleanly
}

describe("a kill inside a write lands on the state before it", () => {
  test("persist:mid: a drop is killed between the bag and the rest of its write", async () => {
    const { dbPath, before } = await build((db) => {
      db.run("UPDATE characters SET x = 6, y = 4 WHERE name = 'Alice'");
    });
    const c = await spawnServer(dbPath, "persist:mid");
    children.push(c);
    const alice = await loginTo(c, "Alice");
    alice.send({ t: "drop", slot: 1 });
    const end = await c.exited;
    expect(end.signal).toBe("SIGKILL");
    const { check, t } = await after(dbPath);
    expectConserved(before, t);
    // The Apple is still in Alice's bag, none on the ground.
    expect(
      check.db
        .query("SELECT item FROM inventory WHERE slot = 1 AND character_id = ?")
        .get(idOf(check.db, "Alice")),
    ).toEqual({ item: "Apple" });
    expect(check.db.query("SELECT COUNT(*) AS n FROM ground_items").get()).toEqual({ n: 0 });
    await check.stop();
    await expectPlayable(dbPath, ["Alice", "Bob"]);
  }, 30_000);

  test("bj:offlineCredit: a forfeit after the grace is killed after the debit", async () => {
    const { dbPath, before } = await build((db) => {
      db.run("UPDATE characters SET gold = 100, x = 9, y = 6 WHERE name = 'Alice'");
      db.run("UPDATE characters SET gold = 100, x = 11, y = 6 WHERE name = 'Bob'");
      const map = db
        .query<{ map_id: string }, []>("SELECT map_id FROM characters WHERE name = 'Alice'")
        .get();
      db.run(
        "INSERT INTO ground_items (id, map_id, x, y, item, kind, expires_at, created_at, qty) VALUES (?, ?, 10, 6, 'Blackjack Table', 'admin', NULL, '2026-11-10T00:00:00.000Z', 1)",
        [crypto.randomUUID(), map?.map_id ?? ""],
      );
    });
    const c = await spawnServer(dbPath, "bj:offlineCredit", { SSO_RECONNECT_GRACE: "1s" });
    children.push(c);
    const alice = await loginTo(c, "Alice");
    const bob = await loginTo(c, "Bob");
    const table = await (async () => {
      const snap = alice.inbox.find((m) => m.t === "snapshot");
      return snap?.t === "snapshot"
        ? snap.ground.find((g) => g.name === "Blackjack Table")?.id
        : undefined;
    })();
    expect(table).toBeDefined();
    for (const b of [alice, bob]) {
      b.send({ t: "pickup", id: table ?? "" });
      await settle(150);
    }
    alice.send({ t: "bjBid", text: "50" });
    bob.send({ t: "bjBid", text: "50" });
    await settle(300);
    bob.close(); // away mid-hand: the grace (1 s) runs out and the forfeit debits Bob offline
    const end = await Promise.race([
      c.exited,
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("no crash in 8 s")), 8000)),
    ]);
    expect(end.signal).toBe("SIGKILL");
    const { check, t } = await after(dbPath);
    expectConserved(before, t);
    await check.stop();
    await expectPlayable(dbPath, ["Alice", "Bob"]);
  }, 40_000);
});

describe("a stop signal saves and exits", () => {
  test("SIGTERM exits 0 and the position is the last one", async () => {
    const { dbPath } = await build((db) => {
      db.run("UPDATE characters SET x = 6, y = 4 WHERE name = 'Alice'");
    });
    const c = await spawnServer(dbPath);
    children.push(c);
    const alice = await loginTo(c, "Alice");
    alice.send({ t: "step", seq: 1, dir: "R", turn: false });
    await settle(500);
    c.proc.kill("SIGTERM");
    expect((await c.exited).code).toBe(0);
    const check = startTestServer({ dbPath });
    const row = check.db.query("SELECT x FROM characters WHERE name = 'Alice'").get() as {
      x: number;
    };
    expect(row.x).toBeGreaterThanOrEqual(6);
    await check.stop();
  }, 30_000);
});
