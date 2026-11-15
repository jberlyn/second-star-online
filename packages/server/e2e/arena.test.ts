/**
 * Bot script: Alice, an immortal, paints a `6P` patch through the World Editor's SAVE. Before it,
 * Bob types `Challenge` and is told "This is not an arena!". After it, Bob's `Challenge` is read by
 * both bots as "Bob has entered the arena!" and Alice sees him jump onto a `6P` tile; a second one
 * says "You are already in a battle!!". Bob's `quit` is read by both as "Bob has stopped fighting."
 * and puts him on a walkable, non-`6P` tile The arena-tile swing has its own tests.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import type { CreateMsg, DeltaEvent, EditorMap, ServerMsg } from "@secondstaronline/shared";

import type { Rng } from "../src/rng.ts";
import { type Bot, connectBot, settle, startTestServer, type TestServer } from "./harness.ts";

const make = (name: string): CreateMsg => ({
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

/** `random(n)` answers `n` (no spawns, moves, attacks or pushes) unless a roll is queued for `n`. */
const queued: Record<number, number[]> = {};
const rng: Rng = {
  random: (n) => (n >= 1 ? (queued[n]?.shift() ?? n) : 0),
};

type Editor = Extract<ServerMsg, { t: "editor"; editing: true }>;
type Snapshot = Extract<ServerMsg, { t: "snapshot" }>;
const isEditor = (m: ServerMsg): m is Editor => m.t === "editor" && m.editing;
const isSnapshot = (m: ServerMsg): m is Snapshot => m.t === "snapshot";

const PAINTED: [number, number][] = [
  [3, 2],
  [4, 2],
  [3, 3],
  [4, 3],
];

const withCode = (row: string, x: number, code: string) => {
  const words = row.split(" ");
  words[x - 1] = code;
  return words.join(" ");
};

describe("the arena challenge", () => {
  let server: TestServer;
  let alice: Bot;
  let bob: Bot;

  const tick = async (n: number) => {
    await settle();
    server.tickNow(n);
    await settle();
  };
  const login = async (name: string): Promise<Bot> => {
    const bot = await connectBot(server.wsUrl);
    bot.send({ t: "login", name, password: "secret" });
    await bot.waitFor((m) => m.t === "snapshot");
    bot.send({ t: "mapReady" });
    await settle();
    return bot;
  };
  const chats = (bot: Bot) => bot.inbox.flatMap((m) => (m.t === "chat" ? [m.text] : []));
  const deltas = (bot: Bot): DeltaEvent[] =>
    bot.inbox.flatMap((m) => (m.t === "delta" ? m.events : []));
  const bobSeen = (bot: Bot) =>
    deltas(bot).flatMap((e) => (e.e === "enter" && e.player.name === "Bob" ? [e.player] : []));

  beforeAll(async () => {
    server = startTestServer({ rng });
    const bot = await connectBot(server.wsUrl);
    for (const name of ["Alice", "Bob"]) {
      bot.send(make(name));
      await bot.waitFor((m) => m.t === "created");
      bot.clear();
    }
    bot.close();
    server.db.run(
      "UPDATE accounts SET role = 'immortal' WHERE id = (SELECT account_id FROM characters WHERE name = 'Alice')",
    );
    server.db.run("UPDATE characters SET x = 6, y = 6 WHERE name = 'Alice'");
    server.db.run("UPDATE characters SET x = 6, y = 4 WHERE name = 'Bob'");
  });
  afterAll(async () => {
    await server.stop();
  });

  test("on a map with no 6P, Challenge says 'This is not an arena!' to Bob alone", async () => {
    alice = await login("Alice");
    bob = await login("Bob");
    alice.clear();
    bob.clear();
    bob.send({ t: "chat", text: "Challenge" });
    await tick(1);
    expect(chats(bob)).toEqual(["This is not an arena!"]);
    expect(chats(alice)).toEqual([]);
  });

  test("the arena is painted through the World Editor's SAVE", async () => {
    alice.send({ t: "editOpen" });
    const ed: Editor = await alice.waitFor(isEditor);
    const m: EditorMap = structuredClone(ed.map);
    for (const [x, y] of PAINTED) {
      m.layers[0][y - 1] = withCode(m.layers[0][y - 1] ?? "", x, "6P");
    }
    alice.send({ t: "editSave", map: m });
    await alice.waitFor((x) => x.t === "alert");
    alice.clear();
    alice.send({ t: "editClose" });
    await alice.waitFor(isSnapshot);
    alice.send({ t: "mapReady" });
    await settle();
    bob.clear();
  });

  test("Challenge: both read the line, Alice sees Bob jump onto a 6P tile, a second one is refused", async () => {
    alice.clear();
    bob.clear();
    queued[17] = [4];
    queued[12] = [3];
    bob.send({ t: "chat", text: "Challenge" });
    await tick(1);
    expect(chats(bob)).toEqual(["Bob has entered the arena!"]);
    expect(chats(alice)).toEqual(["Bob has entered the arena!"]);
    expect(bobSeen(alice).map((p) => [p.x, p.y])).toEqual([[4, 3]]);

    bob.clear();
    bob.send({ t: "chat", text: "Challenge" });
    await tick(1);
    expect(chats(bob)).toEqual(["You are already in a battle!!"]);
    expect(chats(alice)).toEqual(["Bob has entered the arena!"]);
  });

  test("quit: both read the line and Bob stands on a non-6P, walkable tile; a second quit is silent", async () => {
    alice.clear();
    bob.clear();
    bob.send({ t: "chat", text: "quit" });
    await tick(1);
    expect(chats(bob)).toEqual(["Bob has stopped fighting."]);
    expect(chats(alice)).toEqual(["Bob has stopped fighting."]);
    const [seen] = bobSeen(alice);
    expect(seen).toBeDefined();
    expect(PAINTED.some(([x, y]) => x === seen?.x && y === seen?.y)).toBe(false);

    bob.clear();
    bob.send({ t: "chat", text: "quit" });
    await tick(1);
    expect(chats(bob)).toEqual([]);
  });
});
