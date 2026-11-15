/**
 * Bot script: two bots create characters, log in, see each other, block each other, turn in place,
 * walk off the map edge, then relog and resume where they were saved.
 *
 * The sim is driven by hand (`tickNow`), so the run is identical every time.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  type CreateMsg,
  type DeltaEvent,
  type PlayerView,
  type SelfState,
  type ServerMsg,
  STEP_FRAMES,
  TEXT,
} from "@secondstaronline/shared";

import { type Bot, connectBot, settle, startTestServer, type TestServer } from "./harness.ts";

let server: TestServer;
let seq = 0;

beforeAll(() => {
  server = startTestServer();
});
afterAll(async () => {
  await server.stop();
});

const fighter = (name: string): CreateMsg => ({
  t: "create",
  name,
  password: "secret",
  sex: 1,
  head: 1,
  classCode: 1,
  str: 11,
  sta: 11,
  int: 11,
  wis: 11,
  dex: 11,
});

type Snapshot = Extract<ServerMsg, { t: "snapshot" }>;
type Delta = Extract<ServerMsg, { t: "delta" }>;

const isSnapshot = (m: ServerMsg): m is Snapshot => m.t === "snapshot";
const lastSelf = (bot: Bot): SelfState => {
  for (let i = bot.inbox.length - 1; i >= 0; i--) {
    const m = bot.inbox[i];
    if (m?.t === "you") {
      return m.self;
    }
    if (m?.t === "snapshot") {
      return m.self;
    }
  }
  throw new Error("no self state yet");
};
const events = (bot: Bot): DeltaEvent[] =>
  bot.inbox.filter((m): m is Delta => m.t === "delta").flatMap((m) => m.events);

/** Lets sent intents arrive, runs `n` ticks, then lets the replies arrive. */
async function tick(n: number) {
  await settle();
  server.tickNow(n);
  await settle();
}

async function login(name: string): Promise<{ bot: Bot; snap: Snapshot }> {
  const bot = await connectBot(server.wsUrl);
  bot.send({ t: "login", name, password: "secret" });
  await bot.waitFor((m) => m.t === "welcome");
  const snap = await bot.waitFor(isSnapshot);
  bot.send({ t: "mapReady" });
  await settle();
  return { bot, snap };
}

/** Presses and releases an arrow within one tick, the way a quick tap arrives. */
function tap(bot: Bot, dir: "L" | "R" | "U" | "D", turn = false) {
  bot.send({ t: "step", seq: ++seq, dir, turn });
  bot.send({ t: "move", seq: ++seq, held: null, turn: false });
}

let alice: Bot;
let bob: Bot;

describe("log in and walk the seed map", () => {
  test("creates two characters; a taken name is refused with the original text", async () => {
    const b = await connectBot(server.wsUrl);
    b.send(fighter("alice"));
    expect(await b.waitFor((m) => m.t === "created" || m.t === "denied")).toEqual({
      t: "created",
      text: TEXT.created,
    });
    b.clear();
    b.send(fighter("bob"));
    await b.waitFor((m) => m.t === "created");
    b.clear();
    b.send(fighter("Alice")); // the original server's file check ignored case
    expect(await b.waitFor((m) => m.t === "denied")).toEqual({ t: "denied", text: TEXT.nameTaken });
    b.close();
  });

  test("wrong password gets the original text", async () => {
    const b = await connectBot(server.wsUrl);
    b.send({ t: "login", name: "alice", password: "nope" });
    expect(await b.waitFor((m) => m.t === "denied")).toEqual({
      t: "denied",
      text: TEXT.badPassword,
    });
    b.close();
  });

  test("both log in at the start point, facing south, and see each other", async () => {
    const a = await login("alice");
    alice = a.bot;
    expect(a.snap.map.name).toBe("x1000y992");
    expect(a.snap.self).toMatchObject({ x: 6, y: 4, facing: "S" });
    expect(a.snap.players).toEqual([]);

    const b = await login("bob");
    bob = b.bot;
    expect(b.snap.players.map((p: PlayerView) => p.name)).toEqual(["alice"]);
    await settle();
    expect(events(alice)).toContainEqual(
      expect.objectContaining({ e: "enter", player: expect.objectContaining({ name: "bob" }) }),
    );
  });

  test("a standing player blocks: alice walking into bob only turns to face him", async () => {
    // bob steps right to (7,4); everyone sees the move.
    tap(bob, "R");
    await tick(1);
    // One of the 16 calls is used by actor pass 2 the same frame.
    expect(lastSelf(bob)).toMatchObject({ x: 7, y: 4, facing: "E", frames: STEP_FRAMES - 1 });
    expect(events(alice)).toContainEqual(
      expect.objectContaining({ e: "move", fromX: 6, fromY: 4, toX: 7, toY: 4 }),
    );
    await tick(STEP_FRAMES);
    alice.clear();
    bob.clear();

    tap(alice, "R");
    await tick(1);
    // Blocked: same tile, now facing east; told so even though only facing changed.
    expect(lastSelf(alice)).toMatchObject({ x: 6, y: 4, facing: "E" });
    expect(events(bob)).toContainEqual({ e: "turn", id: expect.any(String), facing: "E" });
  });

  test("kept bug: a moving player does not block: alice steps onto bob's tile", async () => {
    // bob walks right, then back left into (7,4)... alice targets (7,4) while bob is mid-step.
    tap(bob, "R");
    await tick(STEP_FRAMES + 1); // bob now standing at (8,4)
    tap(bob, "L");
    await tick(1); // bob mid-step from (8,4) into (7,4)
    expect(lastSelf(bob)).toMatchObject({ x: 7, y: 4, frames: STEP_FRAMES - 1 });
    tap(alice, "R");
    await tick(1);
    expect(lastSelf(alice)).toMatchObject({ x: 7, y: 4, facing: "E" });
    await tick(STEP_FRAMES);
  });

  test("turn in place: no step, and the other player sees the new facing", async () => {
    alice.clear();
    bob.clear();
    tap(alice, "D", true);
    await tick(1);
    expect(lastSelf(alice)).toMatchObject({ x: 7, y: 4, facing: "S" });
    expect(events(bob)).toContainEqual(expect.objectContaining({ e: "turn", facing: "S" }));
  });

  test("kept bug: walking off an edge with no map beyond lands on the start point", async () => {
    // bob at (7,4) walks up: (7,3), (7,2), (7,1), then off the top edge.
    bob.clear();
    alice.clear();
    for (let i = 0; i < 3; i++) {
      tap(bob, "U");
      await tick(STEP_FRAMES);
    }
    expect(lastSelf(bob)).toMatchObject({ x: 7, y: 1, facing: "N" });
    bob.clear();
    tap(bob, "U");
    await tick(1);
    const snap = await bob.waitFor(isSnapshot);
    expect(snap.map.name).toBe("x1000y992");
    expect(snap.self).toMatchObject({ x: 6, y: 4, facing: "N" });
    // alice saw bob leave and come back.
    expect(events(alice).map((e) => e.e)).toEqual(
      expect.arrayContaining(["move", "leave", "enter"]),
    );
    // Loading: bob cannot move until mapReady (or 100 ticks).
    tap(bob, "R");
    await tick(1);
    expect(lastSelf(bob)).toMatchObject({ x: 6, y: 4 });
    bob.send({ t: "mapReady" });
    await settle();
  });

  test("relog: logging out saves the tile, and the next login resumes there, facing south", async () => {
    // alice is at (7,4) facing south.
    alice.send({ t: "logout" });
    expect((await alice.closed).code).toBe(4001);
    await settle();
    expect(events(bob)).toContainEqual(expect.objectContaining({ e: "leave" }));
    const again = await login("alice");
    alice = again.bot;
    expect(again.snap.self).toMatchObject({ x: 7, y: 4, facing: "S" });
  });

  test("a dropped connection can resume with its token, keeping its facing", async () => {
    tap(alice, "L", true);
    await tick(1);
    const welcome = alice.inbox.find((m) => m.t === "welcome");
    if (welcome?.t !== "welcome") {
      throw new Error("no welcome");
    }
    alice.close();
    await settle();
    const b = await connectBot(server.wsUrl);
    b.send({ t: "resume", token: welcome.token });
    expect(await b.waitFor((m) => m.t === "welcome")).toMatchObject({ resumed: true });
    const snap = await b.waitFor(isSnapshot);
    expect(snap.self).toMatchObject({ x: 7, y: 4, facing: "W" });
    alice = b;
  });

  test("an expired resume token is refused", async () => {
    const welcome = alice.inbox.find((m) => m.t === "welcome");
    if (welcome?.t !== "welcome") {
      throw new Error("no welcome");
    }
    alice.close();
    await settle();
    server.clock.advance(30_001);
    const b = await connectBot(server.wsUrl);
    b.send({ t: "resume", token: welcome.token });
    expect(await b.waitFor((m) => m.t === "denied")).toEqual({
      t: "denied",
      text: TEXT.resumeFailed,
    });
    b.close();
  });

  test("a second login to the same account replaces the first", async () => {
    const second = await login("bob");
    expect(await bob.waitFor((m) => m.t === "kicked")).toEqual({
      t: "kicked",
      text: TEXT.replaced,
    });
    expect((await bob.closed).code).toBe(4002);
    expect(second.snap.self).toMatchObject({ x: 6, y: 4 });
    second.bot.close();
  });

  test("garbage is dropped, not fatal", async () => {
    const b = await connectBot(server.wsUrl);
    b.send({ t: "teleport", x: 1 } as unknown as never);
    b.send({ t: "login", name: "bob", password: "secret", admin: true } as unknown as never);
    b.send({ t: "login", name: "bob", password: "secret" });
    await b.waitFor((m) => m.t === "welcome");
    b.close();
  });
});
