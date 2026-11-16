/**
 * Bot script: blackjack and checkers.
 *
 * King (an immortal) stands a Blackjack Table and a Checkers Table on the map. Alice sits west of
 * the blackjack table and Bob east, each sees their line, Carol is told "That seat is taken."
 * Alice bids 50 and Bob 30 (her gold drops 50 then rises 20), the deal, both stand, the gold
 * moves by the stake and the table resets 40 ticks later with the stake in both fields. In a
 * second hand Bob leaves mid-hand and Alice gains the stake. At the checkers table the first
 * player sees the start line twice, Black moves, White moves, Black jumps, Bob closes and
 * Alice's board waits.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import type { CreateMsg, ServerMsg } from "@secondstaronline/shared";

import { setRole } from "../src/persistence/accounts.ts";
import type { Db } from "../src/persistence/database.ts";
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

// Blackjack cards are `random(13)`; a test queues the rolls (10..13 = crd60, a ten).
const cardQueue: number[] = [];
const rng: Rng = {
  random: (n) =>
    n === 13 && cardQueue.length > 0 ? (cardQueue.shift() as number) : n >= 1 ? n : 0,
};

const idOf = (db: Db, name: string) =>
  (db.query("SELECT id FROM characters WHERE name = ?").get(name) as { id: string }).id;
function place(db: Db, name: string, x: number, y: number) {
  db.run("UPDATE characters SET x = ?, y = ? WHERE name = ?", [x, y, name]);
}
const lines = (bot: Bot) => bot.inbox.flatMap((m) => (m.t === "chat" ? [m.text] : []));
const msgsOf = <T extends ServerMsg["t"]>(bot: Bot, t: T) =>
  bot.inbox.filter((m): m is Extract<ServerMsg, { t: T }> => m.t === t);

describe("blackjack and checkers", () => {
  let server: TestServer;
  let alice: Bot;
  let bob: Bot;
  let carol: Bot;
  let king: Bot;

  const tick = async (n: number) => {
    await settle();
    server.clock.advance(Math.ceil(n * 50));
    server.tickNow(n);
    await settle();
  };
  const login = async (name: string): Promise<Bot> => {
    const bot = await connectBot(server.wsUrl);
    bot.send({ t: "login", name, password: "secret" });
    await bot.waitFor((m: ServerMsg) => m.t === "snapshot");
    bot.send({ t: "mapReady" });
    await settle();
    return bot;
  };
  const who = (name: string) => {
    const p = [...server.game.world.players.values()].find((x) => x.name === name);
    if (!p) {
      throw new Error(`${name} is not in`);
    }
    return p;
  };
  const groundOf = (name: string, item: string) =>
    who(name).map.ground.find((g) => g.item === item)?.id ?? "";
  const stand = (name: string, x: number, y: number) => {
    const p = who(name);
    p.x = x;
    p.y = y;
  };
  const sit = async (bot: Bot, name: string, item: string) => {
    who(name).itemPause = 0;
    bot.send({ t: "pickup", id: groundOf(name, item) });
    await settle();
  };

  beforeAll(async () => {
    server = startTestServer({ rng });
    const bot = await connectBot(server.wsUrl);
    for (const name of ["Alice", "Bob", "Carol", "King"]) {
      bot.send(make(name));
      await bot.waitFor((m) => m.t === "created");
      bot.clear();
    }
    bot.close();
    const db = server.db;
    place(db, "Alice", 9, 6);
    place(db, "Bob", 11, 6);
    place(db, "Carol", 5, 3);
    place(db, "King", 8, 3);
    const acc = db
      .query<{ account_id: string }, [string]>("SELECT account_id FROM characters WHERE id = ?")
      .get(idOf(db, "King"));
    setRole(db, acc?.account_id ?? "", "immortal", "2026-11-07T00:00:00.000Z");
    alice = await login("Alice");
    bob = await login("Bob");
    carol = await login("Carol");
    king = await login("King");
    who("King").map.ground.push(
      {
        id: crypto.randomUUID(),
        item: "Blackjack Table",
        x: 10,
        y: 6,
        kind: "admin",
        expiresAt: null,
      },
      {
        id: crypto.randomUUID(),
        item: "Checkers Table",
        x: 10,
        y: 10,
        kind: "admin",
        expiresAt: null,
      },
    );
    for (const n of ["Alice", "Bob"]) {
      who(n).char.gold = 100;
      who(n).invDirty = true;
    }
    await tick(2);
  });

  afterAll(() => {
    for (const b of [alice, bob, carol, king]) {
      b?.close();
    }
    server?.stop();
  });

  test("Alice sits west, Bob east; each sees their line; Carol is told the seat is taken", async () => {
    alice.clear();
    bob.clear();
    await sit(alice, "Alice", "Blackjack Table");
    expect(msgsOf(alice, "bj").filter((m) => m.open)).toHaveLength(1);
    expect(who("Alice").keyLock).toBe(true);
    await sit(bob, "Bob", "Blackjack Table");
    expect(lines(alice)).toEqual(["Bob has joined the table!"]);
    expect(lines(bob)).toEqual(["You take a seat at Alice's table!"]);
    stand("Carol", 9, 6);
    carol.clear();
    await sit(carol, "Carol", "Blackjack Table");
    expect(lines(carol)).toEqual(["That seat is taken."]);
    stand("Carol", 5, 3);
  });

  test("both bid: Alice's gold drops 50 then rises 20; the deal; they stand; the stake moves", async () => {
    cardQueue.push(10, 9, 10, 8); // P1 19, P2 18
    alice.clear();
    bob.clear();
    alice.send({ t: "bjBid", text: "50" });
    await tick(1);
    expect(who("Alice").char.gold).toBe(50);
    bob.send({ t: "bjBid", text: "30" });
    await tick(1);
    expect(who("Alice").char.gold).toBe(70);
    expect(who("Bob").char.gold).toBe(70);
    expect(lines(alice)).toEqual([
      "Alice makes a bid of 50.",
      "Bob makes a bid of 30.",
      "The bid is set at 30 gold.",
      "You are currently holding 19.",
    ]);
    expect(lines(bob)).toContain("You are currently holding 18.");
    const dealt = msgsOf(alice, "bj")
      .filter((m) => m.open)
      .at(-1);
    expect(dealt && dealt.open && dealt.hands).toEqual([
      [60, 59],
      [60, "back"],
    ]);
    alice.clear();
    bob.clear();
    alice.send({ t: "bjStand" });
    bob.send({ t: "bjStand" });
    await tick(1);
    expect(lines(alice)).toEqual(["Alice holds.", "Bob holds.", "Alice has won the game!!!"]);
    expect(who("Alice").char.gold).toBe(130);
    expect(who("Bob").char.gold).toBe(70);
    const shown = msgsOf(bob, "bj")
      .filter((m) => m.open)
      .at(-1);
    expect(shown && shown.open && shown.hands).toEqual([
      [60, 59],
      [60, 58],
    ]);
  });

  test("40 ticks after the result the table resets with the stake still in both fields", async () => {
    alice.clear();
    await tick(38); // the result was settled on an intent, one tick ago

    expect(msgsOf(alice, "bj")).toEqual([]);
    await tick(1);
    const v = msgsOf(alice, "bj").at(-1);
    expect(v && v.open && v.hands).toEqual([[], []]);
    expect(v && v.open && v.fields).toEqual(["30", "30"]);
    expect(v && v.open && v.sfx).toEqual(["shuffle"]);
  });

  test("a second hand: Bob leaves mid-hand and Alice gains the stake", async () => {
    cardQueue.push(10, 9, 10, 8);
    alice.send({ t: "bjBid", text: "20" });
    bob.send({ t: "bjBid", text: "20" });
    await tick(1);
    expect(who("Alice").char.gold).toBe(110);
    alice.clear();
    bob.clear();
    bob.send({ t: "bjLeave" });
    await tick(1);
    expect(lines(alice)).toEqual(["Bob has left the table!"]);
    expect(who("Alice").char.gold).toBe(150);
    expect(who("Bob").char.gold).toBe(50);
    expect(who("Bob").keyLock).toBe(false);
    expect(msgsOf(bob, "bj")).toEqual([{ t: "bj", open: false }]);
    alice.send({ t: "bjLeave" });
    await tick(1);
    expect(server.game.world.casinoTables.size).toBe(0);
  });

  test("checkers: both players see the start line once; Black moves, White moves, Black jumps", async () => {
    stand("Alice", 9, 10);
    stand("Bob", 11, 10);
    alice.clear();
    bob.clear();
    await sit(alice, "Alice", "Checkers Table");
    await sit(bob, "Bob", "Checkers Table");
    const start = "*** The Checkers Game Has Started. It's Alice's (black) turn.";
    expect(lines(alice)).toEqual([start]);
    expect(lines(bob)).toEqual([start]);
    alice.clear();
    bob.clear();
    alice.send({ t: "ckMove", piece: 8, dh: 1, dv: -1 });
    await settle();
    expect(msgsOf(bob, "ck").at(-1)).toMatchObject({ moved: { turn: 2 } });
    bob.send({ t: "ckMove", piece: 20, dh: 1, dv: 1 });
    await settle();
    expect(msgsOf(alice, "ck").at(-1)).toMatchObject({ moved: { turn: 1 } });
    alice.send({ t: "ckMove", piece: 8, dh: -1, dv: -1 });
    await settle();
    const v = msgsOf(bob, "ck").at(-1);
    expect(v && v.open && v.pieces[20]).toEqual({ h: -791, v: -714, m: "White" });
    expect(v && v.open && v.pieces[8]).toEqual({ h: 41, v: 118, m: "Black" });
  });

  test("Bob closes his window: Alice's board resets and waits, Bob's name blank", async () => {
    alice.clear();
    bob.send({ t: "ckClose" });
    await settle();
    const v = msgsOf(alice, "ck").at(-1);
    expect(v && v.open && v.names).toEqual(["Alice", ""]);
    expect(who("Bob").keyLock).toBe(false);
    alice.send({ t: "ckClose" });
    await settle();
    expect(server.game.world.casinoTables.size).toBe(0);
  });
});
