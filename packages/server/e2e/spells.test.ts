/**
 * Bot script: Alice, an administrator mage, places a Slime; fails to read a Meteor Book (Dex), reads
 * Fireball, Minor Heal, Hold, Summon Creature and Identify books; casts a fireball at the Slime
 * (refused again inside the cast delay), heals Bob, holds him, summons a Pig; runs out of crystals;
 * then after a relog her spellbook is kept in full, Identify included.
 *
 * The RNG is the script's: a size with nothing queued answers `n`, which matches only
 * `random(1)` (no spawn, no move, no attack, no chatter), and a damage roll is its maximum.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  CAST_TEXT,
  type CreateMsg,
  type DeltaEvent,
  EFFECT_TEXT,
  type InventoryView,
  type ServerMsg,
  tileLoc,
} from "@secondstaronline/shared";

import type { Db } from "../src/persistence/database.ts";
import { loadSpellbook } from "../src/persistence/spells.ts";
import type { Rng } from "../src/rng.ts";
import { type Bot, connectBot, face, settle, startTestServer, type TestServer } from "./harness.ts";

type Chat = Extract<ServerMsg, { t: "chat" }>;

const make = (name: string): CreateMsg => ({
  t: "create",
  name,
  password: "secret",
  sex: 1,
  head: 1,
  classCode: 2,
  str: 11,
  sta: 11,
  int: 11,
  wis: 11,
  dex: 11,
});

const rng: Rng = { random: (n) => (n >= 1 ? n : 0) };

const idOf = (db: Db, name: string) =>
  (db.query("SELECT id FROM characters WHERE name = ?").get(name) as { id: string }).id;

function bag(db: Db, name: string, items: [string, number][]) {
  const id = idOf(db, name);
  db.run("DELETE FROM inventory WHERE character_id = ?", [id]);
  items.forEach(([item, qty], i) => {
    db.run("INSERT INTO inventory (id, character_id, slot, item, qty) VALUES (?, ?, ?, ?, ?)", [
      crypto.randomUUID(),
      id,
      i + 1,
      item,
      qty,
    ]);
  });
}

const chatTexts = (bot: Bot) =>
  bot.inbox.filter((m): m is Chat => m.t === "chat").map((m) => m.text);
/** The last `inv` a bot got, kept across `clear()`. */
const invs = new Map<Bot, InventoryView>();
const lastInv = (bot: Bot): InventoryView | undefined => {
  const inv = bot.inbox.filter((m) => m.t === "inv").at(-1)?.inv as InventoryView | undefined;
  if (inv) {
    invs.set(bot, inv);
  }
  return invs.get(bot);
};
const slotOf = (bot: Bot, item: string) =>
  (lastInv(bot)?.bag.findIndex((l) => l?.item === item) ?? -1) + 1;
const deltas = (bot: Bot): DeltaEvent[] =>
  bot.inbox.flatMap((m) => (m.t === "delta" ? m.events : []));
const lastSp = (bot: Bot) =>
  (bot.inbox.filter((m) => m.t === "vitals").at(-1) as Extract<ServerMsg, { t: "vitals" }>)?.vitals
    .sp;
const lastSpellbook = (bot: Bot) =>
  (bot.inbox.filter((m) => m.t === "spellbook").at(-1) as Extract<ServerMsg, { t: "spellbook" }>)
    ?.spells;
/** The middle of a tile on the stage: `(mouse − (30, 31)) / 32 + 1` names it. */
const centre = (x: number, y: number) => ({ x: x * 32 + 14, y: y * 32 + 15 });

describe("spells", () => {
  let server: TestServer;
  let alice: Bot;
  let bob: Bot;

  const tick = async (n: number) => {
    await settle();
    server.tickNow(n);
    await settle();
    for (const b of [alice, bob]) {
      if (b) {
        lastInv(b);
      }
    }
  };
  const login = async (name: string): Promise<Bot> => {
    const bot = await connectBot(server.wsUrl);
    bot.send({ t: "login", name, password: "secret" });
    await bot.waitFor((m) => m.t === "snapshot");
    bot.send({ t: "mapReady" });
    await settle();
    return bot;
  };
  const say = async (bot: Bot, text: string) => {
    bot.send({ t: "chat", text });
    await settle();
  };
  const use = async (bot: Bot, item: string) => {
    bot.send({ t: "use", slot: slotOf(bot, item) });
    await settle();
  };
  /** Casts, then waits out the 20-frame cast delay. */
  const cast = async (bot: Bot, spell: string, x: number, y: number) => {
    bot.send({ t: "cast", spell, x, y });
    await settle();
  };

  beforeAll(async () => {
    server = startTestServer({ rng });
    const bot = await connectBot(server.wsUrl);
    for (const name of ["Alice", "Bob"]) {
      bot.send(make(name));
      await bot.waitFor((m) => m.t === "created");
      bot.clear();
    }
    bot.close();
    const db = server.db;
    db.run(
      "UPDATE accounts SET role = 'administrator' WHERE id = (SELECT account_id FROM characters WHERE name = 'Alice')",
    );
    db.run(
      "UPDATE characters SET x = 6, y = 6, dex = 20, sp = 200, sp_max = 200 WHERE name = 'Alice'",
    );
    db.run("UPDATE characters SET x = 9, y = 6, hp = 5 WHERE name = 'Bob'");
    bag(db, "Alice", [
      ["Meteor Book", 1],
      ["Fireball Book", 1],
      ["Minor Heal Book", 1],
      ["Hold Book", 1],
      ["Summon Creature Book", 1],
      ["Identify Book", 1],
      ["Red Crystal", 2],
      ["Blue Crystal", 10],
      ["Purple Crystal", 10],
      ["White Crystal", 10],
    ]);
  });
  afterAll(async () => {
    await server.stop();
  });

  test("an operator places a Slime north of Alice", async () => {
    alice = await login("Alice");
    face(server, "Alice", "N"); // staging: 1.6 logs in facing south
    bob = await login("Bob");
    await tick(1); // the first `inv` and `vitals` go out with a tick
    expect(lastSpellbook(alice)).toEqual([]);
    await say(alice, "/roster 1 Slime");
    await say(alice, "/spawn 1"); // north: (6, 5)
    expect(chatTexts(alice)).toContain("Spawned a Slime in roster slot 1.");
  });

  test("books: Dex too low, then five spells learned", async () => {
    alice.clear();
    await use(alice, "Meteor Book");
    expect(chatTexts(alice)).toEqual(["Your mysticism is not high enough to learn this spell."]);
    for (const book of [
      "Fireball Book",
      "Minor Heal Book",
      "Hold Book",
      "Summon Creature Book",
      "Identify Book",
    ]) {
      await use(alice, book);
    }
    expect(chatTexts(alice)).toContain("You have learned the spell of Fireball.");
    expect(chatTexts(alice)).toContain("You have learned the spell of Identify.");
    expect(lastSpellbook(alice)).toEqual([
      "Fireball",
      "Minor Heal",
      "Hold",
      "Summon Creature",
      "Identify",
    ]);
    expect(slotOf(alice, "Fireball Book")).toBe(0);
    // Saved in full (a bug fixed: 1.6 dropped Identify).
    expect(loadSpellbook(server.db, idOf(server.db, "Alice"))).toEqual([
      "Fireball",
      "Minor Heal",
      "Hold",
      "Summon Creature",
      "Identify",
    ]);
  });

  test("a fireball at the Slime: SP, crystals, the FX for everyone, the hit", async () => {
    alice.clear();
    bob.clear();
    const slime = tileLoc(6, 5);
    await cast(alice, "Fireball", slime.h, slime.v);
    // Inside the 20-frame delay a second click does nothing.
    await cast(alice, "Fireball", slime.h, slime.v);
    expect(lastSp(alice)).toBe(188);
    expect(slotOf(alice, "Red Crystal")).toBe(0);
    await tick(2);
    expect(deltas(bob)).toContainEqual({
      e: "fx",
      slot: 1,
      name: "FireballU",
      h: slime.h,
      v: slime.v,
      caster: expect.any(String),
    });
    expect(deltas(bob).some((e) => e.e === "mspell" && e.slot === 1 && e.color === 124)).toBe(true);
  });

  test("out of red crystals: the refusal", async () => {
    await tick(20);
    alice.clear();
    await cast(alice, "Fireball", 300, 300);
    expect(chatTexts(alice)).toEqual([CAST_TEXT.crystals("Fireball")]);
  });

  test("Minor Heal on Bob, colour 5 for everyone", async () => {
    await tick(20);
    bob.clear();
    const at = tileLoc(9, 6);
    await cast(alice, "Minor Heal", at.h, at.v);
    await tick(4);
    expect(deltas(bob).some((e) => e.e === "phit" && e.id !== "" && e.color === 5)).toBe(true);
    const v = bob.inbox.filter((m) => m.t === "vitals").at(-1);
    expect(v?.t === "vitals" && v.vitals.hp > 5).toBe(true);
  });

  test("Hold roots Bob: the line, and his step is refused", async () => {
    await tick(20);
    bob.clear();
    const at = tileLoc(9, 6);
    await cast(alice, "Hold", at.h, at.v);
    await tick(4);
    expect(chatTexts(bob)).toContain(EFFECT_TEXT.hold);
    bob.send({ t: "step", seq: 1, dir: "D", turn: false });
    await tick(2);
    const you = bob.inbox.filter((m) => m.t === "you").at(-1);
    expect(you?.t === "you" && you.self.y).toBe(6);
    expect(you?.t === "you" && you.self.hold).toBe(true);
  });

  test("Summon Creature: a Pig takes roster slot 2", async () => {
    await tick(20);
    bob.clear();
    const t = centre(4, 4);
    await cast(alice, "Summon Creature", t.x, t.y);
    expect(deltas(bob)).toContainEqual(
      expect.objectContaining({
        e: "mspawn",
        monster: expect.objectContaining({ slot: 2, name: "Pig", x: 4, y: 4 }),
      }),
    );
  });

  test("bug fixed: after a relog the spellbook is kept, Identify included", async () => {
    alice.close();
    await settle();
    alice = await login("Alice");
    face(server, "Alice", "N"); // staging: 1.6 logs in facing south
    await tick(1);
    expect(lastSpellbook(alice)).toEqual([
      "Fireball",
      "Minor Heal",
      "Hold",
      "Summon Creature",
      "Identify",
    ]);
  });
});
