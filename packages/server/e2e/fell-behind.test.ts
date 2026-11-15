/**
 * The instruments and the decided behaviours. A socket with more than about 1 MB waiting is closed
 * with 4007 and the client's resume brings it back; the tick probe times the phases; a clean minute
 * logs no lag line.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CLOSE } from "@secondstaronline/shared";

import { MAX_BACKLOG_BYTES } from "../src/gateway/server.ts";
import {
  connectBot,
  idOf,
  login,
  make,
  settle,
  startTestServer,
  type TestServer,
  tick,
} from "./harness.ts";

/** Creates a character through the protocol, then hangs up (so `login` can bring it in). */
async function create(srv: TestServer, name: string): Promise<void> {
  const bot = await connectBot(srv.wsUrl);
  bot.send(make(name));
  await bot.waitFor((m) => m.t === "created");
  bot.close();
  await settle();
}

let server: TestServer | undefined;
afterEach(async () => {
  await server?.stop();
  server = undefined;
});

describe("a connection that falls far behind is reconnected", () => {
  test("a socket with 2 MB waiting is closed with 4007, resumes, and the others see it leave and return", async () => {
    const behind = new Set<string>();
    server = startTestServer({
      backlogOf: (ws) => (ws.data.characterId && behind.has(ws.data.characterId) ? 2 << 20 : 0),
    });
    await create(server, "Slowpoke");
    await create(server, "Watcher");

    const slow = await login(server, "Slowpoke");
    const watcher = await login(server, "Watcher");
    const welcome = slow.inbox.find((m) => m.t === "welcome");
    if (welcome?.t !== "welcome") {
      throw new Error("no welcome");
    }
    expect(CLOSE.behind.code).toBe(4007);
    watcher.clear();
    behind.add(idOf(server.db, "Slowpoke"));
    // Anything sent to the slow socket now trips the check.
    watcher.send({ t: "chat", text: "hello" });
    await tick(server, 1);
    const closed = await slow.closed;
    expect(closed.code).toBe(4007);
    expect(closed.reason).toBe("fell behind");
    expect(server.stats().gateway.closedBehind).toBeGreaterThanOrEqual(1);

    // The client's resume: a fresh socket with the token. The character is back with a snapshot.
    behind.clear();
    await settle();
    const again = await connectBot(server.wsUrl);
    again.send({ t: "resume", token: welcome.token });
    const snap = await again.waitFor((m) => m.t === "snapshot");
    expect(snap.t).toBe("snapshot");
    await settle();
    const kinds = watcher.inbox.flatMap((m) => (m.t === "delta" ? m.events.map((e) => e.e) : []));
    expect(kinds).toContain("leave");
    expect(kinds).toContain("enter");
    expect(server.faults).toEqual([]);
  });

  test("a backlog under the limit is never closed", async () => {
    server = startTestServer({ backlogOf: () => MAX_BACKLOG_BYTES });
    await create(server, "Patient");
    const bot = await login(server, "Patient");
    for (let i = 0; i < 5; i++) {
      bot.send({ t: "chat", text: `line ${i}` });
      await tick(server, 1);
    }
    const state = await Promise.race([
      bot.closed.then(() => "closed"),
      settle(100).then(() => "open"),
    ]);
    expect(state).toBe("open");
    const { gateway } = server.stats();
    expect(gateway.closedBehind).toBe(0);
    expect(gateway.maxBacklog).toBe(MAX_BACKLOG_BYTES);
  });
});

describe("the tick probe and the lag line", () => {
  test("with SSO_PERF_OUT the server writes a line a second with every phase; without it nothing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sso-perf-out-"));
    const out = join(dir, "perf.jsonl");
    server = startTestServer({ perfOut: out });
    await create(server, "Timed");
    await login(server, "Timed");
    server.tickNow(40);
    await new Promise((r) => setTimeout(r, 1200));
    const lines = readFileSync(out, "utf8").trim().split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(1);
    const line = JSON.parse(lines[0] ?? "{}");
    expect(line.tick.ticks).toBe(40);
    expect(Object.keys(line.tick.phases).sort()).toEqual(
      ["commit", "deliver", "players", "rooms", "sql", "world"].sort(),
    );
    expect(line.online).toBe(1);
    expect(line.gateway.messagesOut).toBeGreaterThan(0);
    expect(line.rowsWritten).toBeGreaterThanOrEqual(0);
    // The total is at least as long as its longest phase.
    expect(line.tick.total.max).toBeGreaterThanOrEqual(line.tick.phases.rooms.max);
  });

  test("a clean minute of ticks logs no lag line", async () => {
    const lines: string[] = [];
    server = startTestServer({ onLag: (l) => lines.push(l) });
    server.tickNow(1200);
    expect(lines).toEqual([]);
  });
});
