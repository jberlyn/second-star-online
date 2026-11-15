/**
 * Bot script: slots and high scores.
 *
 * King, an immortal, stands a Slot Machine and a High Score Statue on the map by hand (no shipped
 * map places either). Alice is refused facing E, then opens the panel from the tile south facing
 * N, cannot walk, pulls (Bob sees the Slot Machine FX), gets her result 30 ticks later with her
 * gold changed by the table, closes and walks. With 3 gold she pulls and the panel closes with the
 * line. After a save tick she is on the statue's list, which Bob reads by click from across the
 * map; King is not on it.
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

// The reels roll 1-2-3 (a loss) by default; a test queues others.
const reelQueue: number[] = [];
const rng: Rng = {
  random: (n) => (n === 4 && reelQueue.length > 0 ? (reelQueue.shift() as number) : n >= 1 ? n : 0),
};

const idOf = (db: Db, name: string) =>
  (db.query("SELECT id FROM characters WHERE name = ?").get(name) as { id: string }).id;
function place(db: Db, name: string, x: number, y: number) {
  db.run("UPDATE characters SET x = ?, y = ? WHERE name = ?", [x, y, name]);
}
const lines = (bot: Bot) => bot.inbox.flatMap((m) => (m.t === "chat" ? [m.text] : []));
const msgsOf = <T extends ServerMsg["t"]>(bot: Bot, t: T) =>
  bot.inbox.filter((m): m is Extract<ServerMsg, { t: T }> => m.t === t);

describe("slots and high scores", () => {
  let server: TestServer;
  let alice: Bot;
  let bob: Bot;
  let king: Bot;
  let seq = 0;

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
  const turn = async (bot: Bot, dir: "U" | "D" | "L" | "R") => {
    bot.send({ t: "step", seq: ++seq, dir, turn: true });
    bot.send({ t: "move", seq: ++seq, held: null, turn: false });
    await tick(2);
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

  beforeAll(async () => {
    server = startTestServer({ rng });
    const bot = await connectBot(server.wsUrl);
    for (const name of ["Alice", "Bob", "King"]) {
      bot.send(make(name));
      await bot.waitFor((m) => m.t === "created");
      bot.clear();
    }
    bot.close();
    const db = server.db;
    place(db, "Alice", 12, 9);
    place(db, "Bob", 3, 3);
    place(db, "King", 8, 6);
    const acc = db
      .query<{ account_id: string }, [string]>("SELECT account_id FROM characters WHERE id = ?")
      .get(idOf(db, "King"));
    setRole(db, acc?.account_id ?? "", "immortal", "2026-11-07T00:00:00.000Z");
    alice = await login("Alice");
    bob = await login("Bob");
    king = await login("King");
    const map = who("King").map;
    map.ground.push(
      {
        id: crypto.randomUUID(),
        item: "Slot Machine",
        x: 12,
        y: 8,
        kind: "admin",
        expiresAt: null,
      },
      {
        id: crypto.randomUUID(),
        item: "High Score Statue",
        x: 14,
        y: 5,
        kind: "admin",
        expiresAt: null,
      },
    );
    who("Alice").char.gold = 100;
    who("Alice").invDirty = true;
    await tick(2);
  });

  afterAll(() => {
    for (const b of [alice, bob, king]) {
      b?.close();
    }
    server?.stop();
  });

  test("Alice facing E is refused; facing N on the tile south she opens the panel and cannot walk", async () => {
    await turn(alice, "R");
    alice.clear();
    alice.send({ t: "pickup", id: groundOf("Alice", "Slot Machine") });
    await settle();
    expect(lines(alice)).toEqual([
      "This is a slot machine. You need to be standing in front of it to play.",
    ]);
    expect(msgsOf(alice, "slot")).toEqual([]);
    await tick(50);
    await turn(alice, "U");
    alice.clear();
    alice.send({ t: "pickup", id: groundOf("Alice", "Slot Machine") });
    await settle();
    expect(msgsOf(alice, "slot")).toEqual([{ t: "slot", open: true }]);
    expect(who("Alice").keyLock).toBe(true);
    const at = { x: who("Alice").x, y: who("Alice").y };
    for (const turnFirst of [true, false]) {
      alice.send({ t: "step", seq: ++seq, dir: "L", turn: turnFirst });
      alice.send({ t: "move", seq: ++seq, held: null, turn: false });
      await tick(20);
    }
    expect({ x: who("Alice").x, y: who("Alice").y, facing: who("Alice").facing }).toEqual({
      ...at,
      facing: "N",
    });
  });

  test("a pull: Bob sees the FX, Alice gets her loss 30 ticks later with 5 gold gone", async () => {
    bob.clear();
    alice.clear();
    reelQueue.push(1, 2, 3);
    alice.send({ t: "slotPull" });
    await settle();
    expect(msgsOf(alice, "slotSpin")).toHaveLength(1);
    await tick(2);
    const fx = bob.inbox.flatMap((m) =>
      m.t === "delta" ? m.events.filter((e) => e.e === "fx" && e.name === "Slot Machine") : [],
    );
    expect(fx.length).toBe(1);
    await tick(27);
    expect(msgsOf(alice, "slotResult")).toEqual([]);
    await tick(1);
    expect(msgsOf(alice, "slotResult")).toEqual([
      { t: "slotResult", reels: [1, 2, 3], win: false },
    ]);
    expect(lines(alice)).toContain("You lost. try again?");
    expect(who("Alice").char.gold).toBe(95);
  });

  test("a win pays the table: 2-3-2 is 80 gross", async () => {
    alice.clear();
    reelQueue.push(2, 3, 2);
    alice.send({ t: "slotPull" });
    await settle();
    await tick(30);
    expect(msgsOf(alice, "slotResult")).toEqual([{ t: "slotResult", reels: [2, 3, 2], win: true }]);
    expect(lines(alice)).toContain("You won!!!!");
    expect(who("Alice").char.gold).toBe(95 - 5 + 80);
  });

  test("Close frees the keys and Alice walks again", async () => {
    alice.send({ t: "slotClose" });
    await settle();
    expect(who("Alice").slot).toBeNull();
    expect(who("Alice").keyLock).toBe(false);
    const x = who("Alice").x;
    await turn(alice, "L");
    alice.send({ t: "step", seq: ++seq, dir: "L", turn: false });
    alice.send({ t: "move", seq: ++seq, held: null, turn: false });
    await tick(40);
    expect(who("Alice").x).toBe(x - 1);
  });

  test("with 3 gold a pull closes the panel, then the line", async () => {
    const a = who("Alice");
    a.x = 12;
    a.y = 9;
    a.stepFrames = 0;
    await tick(50);
    await turn(alice, "U");
    a.char.gold = 3;
    alice.clear();
    alice.send({ t: "pickup", id: groundOf("Alice", "Slot Machine") });
    await settle();
    expect(msgsOf(alice, "slot")).toEqual([{ t: "slot", open: true }]);
    alice.send({ t: "slotPull" });
    await settle();
    const kinds = alice.inbox.map((m) => m.t).filter((t) => t === "slot" || t === "chat");
    expect(kinds).toEqual(["slot", "slot", "chat"]);
    expect(msgsOf(alice, "slot")[1]).toEqual({ t: "slot", open: false });
    expect(lines(alice)).toEqual(["You don't have enough gold to play!"]);
    expect(a.char.gold).toBe(3);
    expect(a.keyLock).toBe(false);
  });

  test("after a save tick Alice is on the statue's list, which Bob reads from across the map; King is not", async () => {
    who("Alice").saveIn = 1;
    who("King").saveIn = 1;
    await tick(3);
    expect(server.game.world.highScores.map((e) => e.name)).toEqual(["Alice"]);
    bob.clear();
    bob.send({ t: "pickup", id: groundOf("Bob", "High Score Statue") });
    await settle();
    const said = lines(bob);
    expect(said[0]).toBe("You read the high score list...");
    expect(said[1]).toContain("1. Alice - ");
    expect(said[1]).not.toContain("King");
    await tick(60);
    const row = server.db.query("SELECT name FROM high_scores").all();
    expect(row).toEqual([{ name: "Alice" }]);
  });
});
