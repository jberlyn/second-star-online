/**
 * Bot script: Alice drops a Pig (Bob sees the monster) and Bob grabs it with Ctrl and gets a Pig;
 * Alice drops a Fire Orb (it lands on the ground like any item) and Bob picks it up; Alice learns
 * Web and casts it on Bob's tile, and Bob holding an arrow gets one web line for the press and
 * does not move; Bob logs out and in with the Pig and the orb kept.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  type CreateMsg,
  type DeltaEvent,
  type InventoryView,
  type ServerMsg,
  WEB_TEXT,
} from "@secondstaronline/shared";

import type { Db } from "../src/persistence/database.ts";
import type { Rng } from "../src/rng.ts";
import { type Bot, connectBot, settle, startTestServer, type TestServer } from "./harness.ts";

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

const chats = (bot: Bot) => bot.inbox.flatMap((m) => (m.t === "chat" ? [m.text] : []));
const deltas = (bot: Bot): DeltaEvent[] =>
  bot.inbox.flatMap((m) => (m.t === "delta" ? m.events : []));
const invs = new Map<Bot, InventoryView>();
const lastInv = (bot: Bot): InventoryView | undefined => {
  const inv = bot.inbox
    .filter((m): m is Extract<ServerMsg, { t: "inv" }> => m.t === "inv")
    .at(-1)?.inv;
  if (inv) {
    invs.set(bot, inv);
  }
  return invs.get(bot);
};
const slotOf = (bot: Bot, item: string) =>
  (lastInv(bot)?.bag.findIndex((l) => l?.item === item) ?? -1) + 1;
const has = (bot: Bot, item: string) => slotOf(bot, item) > 0;
/** The middle of a tile on the stage: `(mouse − (30, 31)) / 32 + 1` names it. */
const centre = (x: number, y: number) => ({ x: x * 32 + 14, y: y * 32 + 15 });

describe("orbs, pigs and webs", () => {
  let server: TestServer;
  let alice: Bot;
  let bob: Bot;
  let seq = 0;

  const login = async (name: string): Promise<Bot> => {
    const bot = await connectBot(server.wsUrl);
    bot.send({ t: "login", name, password: "secret" });
    await bot.waitFor((m) => m.t === "snapshot");
    bot.send({ t: "mapReady" });
    await settle();
    return bot;
  };
  const tick = async (n: number) => {
    await settle();
    server.tickNow(n);
    await settle();
  };
  const turn = (bot: Bot, dir: "L" | "R" | "U" | "D") =>
    bot.send({ t: "step", seq: ++seq, dir, turn: true });

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
      "UPDATE characters SET x = 6, y = 6, dex = 20, sp = 200, sp_max = 200 WHERE name = 'Alice'",
    );
    server.db.run("UPDATE characters SET x = 8, y = 6 WHERE name = 'Bob'");
    bag(server.db, "Alice", [
      ["Pig", 2],
      ["Fire Orb", 1],
      ["Web Book", 1],
      ["White Crystal", 6],
    ]);
  });
  afterAll(async () => {
    await server.stop();
  });

  test("Alice drops a Pig facing east: Bob sees a Pig monster on (7,6); one Pig left in her bag", async () => {
    alice = await login("Alice");
    bob = await login("Bob");
    await tick(2);
    lastInv(alice);
    lastInv(bob);
    turn(alice, "R");
    turn(bob, "L");
    await tick(2);
    alice.clear();
    bob.clear();
    alice.send({ t: "drop", slot: slotOf(alice, "Pig") });
    await tick(1);
    const spawned = deltas(bob).flatMap((e) => (e.e === "mspawn" ? [e.monster] : []));
    expect(spawned.map((m) => [m.name, m.x, m.y])).toEqual([["Pig", 7, 6]]);
    expect(chats(alice)).toEqual([]);
    expect(lastInv(alice)?.bag.find((l) => l?.item === "Pig")?.qty).toBe(1);
  });

  test("Bob grabs it with Ctrl and gets a Pig", async () => {
    bob.clear();
    bob.send({ t: "action" });
    await tick(1);
    expect(has(bob, "Pig")).toBe(true);
    expect(deltas(bob).some((e) => e.e === "mgone")).toBe(true);
  });

  test("Alice drops a Fire Orb: it lies on the ground like any item; Bob picks it up", async () => {
    await tick(60); // the grab's item pause
    alice.clear();
    bob.clear();
    alice.send({ t: "drop", slot: slotOf(alice, "Fire Orb") });
    await tick(1);
    const gadd = deltas(bob).flatMap((e) => (e.e === "gadd" ? [e.item] : []));
    expect(gadd.map((g) => [g.name, g.x, g.y])).toEqual([["Fire Orb", 7, 6]]);
    expect(chats(alice)).toEqual([]);
    bob.clear();
    bob.send({ t: "action" });
    await tick(1);
    expect(has(bob, "Fire Orb")).toBe(true);
  });

  test("Alice learns Web and casts it on Bob's tile; Bob holding an arrow gets one web line and stays", async () => {
    alice.clear();
    alice.send({ t: "use", slot: slotOf(alice, "Web Book") });
    await tick(1);
    expect(chats(alice)).toContain("You have learned the spell of Web.");
    await tick(41);
    bob.clear();
    const at = centre(8, 6);
    alice.send({ t: "cast", spell: "Web", x: at.x, y: at.y });
    await tick(1);
    const web = deltas(bob).flatMap((e) => (e.e === "mspawn" ? [e.monster] : []));
    expect(web.map((m) => [m.name, m.x, m.y])).toEqual([["Web", 8, 6]]);
    bob.clear();
    bob.send({ t: "move", seq: ++seq, held: "R", turn: false });
    await tick(3);
    expect(chats(bob)).toEqual([WEB_TEXT]);
    expect(deltas(bob).filter((e) => e.e === "move" && "id" in e)).toEqual([]);
    bob.send({ t: "move", seq: ++seq, held: null, turn: false });
    await tick(1);
  });

  test("Bob logs out and in: the Pig and the Fire Orb are kept", async () => {
    bob.close();
    await tick(2);
    bob = await login("Bob");
    await tick(2);
    expect(has(bob, "Pig")).toBe(true);
    expect(has(bob, "Fire Orb")).toBe(true);
    const id = idOf(server.db, "Bob");
    const rows = server.db.query("SELECT item FROM inventory WHERE character_id = ?").all(id) as {
      item: string;
    }[];
    expect(rows.map((r) => r.item)).toEqual(expect.arrayContaining(["Pig", "Fire Orb"]));
  });
});
