/**
 * Bot script, part 1: Alice swings an Axe at a tree until it falls; Bob, on the same map, sees the
 * stump and hears every `treechop`; Alice gets Logs, `treefalling` and the Lumberjacking line. Bob
 * casts a Fishing Pole into lake water and catches a Trout under the Fishing FX. Cara tills soil
 * with a Hoe, plants Seeds, waters them with a Watering Bucket, and the grown corn drops Corn. Time
 * passes with them on the map and the stump regrows. The changed tiles are on the map row.
 *
 * Part 2: Alice picks up the Logs and builds a Chair with her Saw. Each other crafter stands facing
 * their station, so the script needs no walking: Dave cooks a Trout at a Stove, Erin mixes a Red
 * Potion at an Alchemy Lab holding Red Sand, Finn smiths a Damaged sword at an Anvil while Bob
 * watches the BSmith FX, and Gail brews in a Cauldron and takes the Gold Crown out.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  type CreateMsg,
  type DeltaEvent,
  type ServerMsg,
  skillIndex,
  tileAt,
  withTile,
} from "@secondstaronline/shared";

import type { Db } from "../src/persistence/database.ts";
import { findMapByCoords } from "../src/persistence/maps.ts";
import type { Rng } from "../src/rng.ts";
import { type Bot, connectBot, face, settle, startTestServer, type TestServer } from "./harness.ts";

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

/**
 * `random(n)` answers from `wins` (a fixed answer per n), else n: no spawn, push or attack.
 * The script changes `wins` as it goes.
 */
const wins: Record<number, number> = {};
const rng: Rng = { random: (n) => (n >= 1 ? (wins[n] ?? n) : 0) };

const idOf = (db: Db, name: string) =>
  (db.query("SELECT id FROM characters WHERE name = ?").get(name) as { id: string }).id;

function place(db: Db, name: string, x: number, y: number, facing: string) {
  db.run("UPDATE characters SET x = ?, y = ?, facing = ? WHERE name = ?", [x, y, facing, name]);
}
function wield(db: Db, name: string, item: string, slot = "LeftHand") {
  db.run("INSERT OR REPLACE INTO equipment (character_id, slot, item) VALUES (?, ?, ?)", [
    idOf(db, name),
    slot,
    item,
  ]);
}
/** A placed fixture on the seed map x1000y992 (the World Editor's `admin` kind). */
function fixture(db: Db, item: string, x: number, y: number) {
  const map = db.query("SELECT id FROM maps WHERE mx = 1000 AND my = 992").get() as { id: string };
  db.run(
    "INSERT INTO ground_items (id, map_id, x, y, item, qty, kind, expires_at, created_at) VALUES (?, ?, ?, ?, ?, 1, 'admin', NULL, '2026-11-06')",
    [crypto.randomUUID(), map.id, x, y, item],
  );
}
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
function setSkill(db: Db, name: string, skill: string, value: number) {
  db.run("INSERT OR REPLACE INTO character_skills (character_id, skill, value) VALUES (?, ?, ?)", [
    idOf(db, name),
    skillIndex(skill) + 1,
    value,
  ]);
}
/** Sets one tile of layer 1 or 2 of the seed map x1000y992. */
function setTile(db: Db, layer: 1 | 2, x: number, y: number, code: string) {
  const col = layer === 1 ? "layer1" : "layer2";
  const row = db.query(`SELECT ${col} AS l FROM maps WHERE mx = 1000 AND my = 992`).get() as {
    l: string;
  };
  const rows = withTile(JSON.parse(row.l) as string[], x, y, code);
  db.run(`UPDATE maps SET ${col} = ? WHERE mx = 1000 AND my = 992`, [JSON.stringify(rows)]);
}

const deltas = (bot: Bot): DeltaEvent[] =>
  bot.inbox.flatMap((m) => (m.t === "delta" ? m.events : []));
const lines = (bot: Bot) => bot.inbox.flatMap((m) => (m.t === "chat" ? [m.text] : []));
const sounds = (bot: Bot) =>
  bot.inbox.flatMap((m) => (m.t === "sound" ? [`${m.name}:${m.ch}`] : []));
const tileEvents = (bot: Bot) => deltas(bot).filter((e) => e.e === "tile");
const added = (bot: Bot) =>
  deltas(bot).flatMap((e) => (e.e === "gadd" ? [[e.item.name, e.item.x, e.item.y]] : []));
const bagItems = (bot: Bot) => {
  const inv = bot.inbox.filter((m) => m.t === "inv").at(-1);
  return inv?.t === "inv" ? inv.inv.bag.map((l) => (l ? `${l.item}-${l.qty}` : "")) : [];
};
const lockOn = (bot: Bot) =>
  bot.inbox.filter((m) => m.t === "lock").map((m) => (m.t === "lock" ? m.on : null));

describe("gathering and crafting", () => {
  let server: TestServer;
  let alice: Bot;
  let bob: Bot;
  let cara: Bot;
  let dave: Bot;
  let erin: Bot;
  let finn: Bot;
  let gail: Bot;

  const tick = async (n: number) => {
    await settle();
    server.tickNow(n);
    await settle();
  };
  const ids = new Map<Bot, string>();
  const login = async (name: string): Promise<Bot> => {
    const bot = await connectBot(server.wsUrl);
    bot.send({ t: "login", name, password: "secret" });
    const snap = await bot.waitFor((m: ServerMsg) => m.t === "snapshot");
    ids.set(bot, snap.t === "snapshot" ? snap.you.id : "");
    bot.send({ t: "mapReady" });
    await settle();
    return bot;
  };
  /**
   * Holds Tab until `n` of the bot's own swings have gone out. Ticks go 10 at a time: a swing
   * waits at least 14 frames for the attack delay, so no extra swing slips in.
   */
  const swing = async (bot: Bot, n: number) => {
    const who = ids.get(bot);
    const swings = () => deltas(bot).filter((e) => e.e === "swing" && e.id === who).length;
    const start = swings();
    bot.send({ t: "attack", seq: 1, held: true });
    await settle(10);
    for (let i = 0; i < 800 && swings() - start < n; i++) {
      server.tickNow(1);
      await settle(2);
    }
    bot.send({ t: "attack", seq: 2, held: false });
    await tick(1);
  };

  beforeAll(async () => {
    // Alice faces a tree; Bob faces lake water on layer 1; Cara faces untilled soil. The map
    // is edited before the server loads it.
    server = startTestServer({
      rng,
      prepare: (db) => {
        setTile(db, 2, 5, 5, "S3");
        setTile(db, 2, 5, 6, "G3");
        setTile(db, 1, 10, 5, "W1");
        setTile(db, 2, 10, 5, "G3");
        setTile(db, 2, 13, 5, "TL");
        // The part 2 stations, each north of its crafter on row 10.
        fixture(db, "Stove", 2, 9);
        fixture(db, "Alchemy Lab", 4, 9);
        fixture(db, "Anvil", 6, 9);
        fixture(db, "Cauldron#1", 8, 9);
      },
    });
    const bot = await connectBot(server.wsUrl);
    for (const name of ["Alice", "Bob", "Cara", "Dave", "Erin", "Finn", "Gail"]) {
      bot.send(make(name));
      await bot.waitFor((m) => m.t === "created");
      bot.clear();
    }
    bot.close();
    const db = server.db;
    place(db, "Alice", 5, 6, "N");
    place(db, "Bob", 10, 6, "N");
    place(db, "Cara", 13, 6, "N");
    wield(db, "Alice", "Axe");
    wield(db, "Bob", "Fishing Pole");
    wield(db, "Cara", "Hoe");
    bag(db, "Cara", [
      ["Seeds", 1],
      ["Watering Bucket", 1],
    ]);
    setSkill(db, "Alice", "Lumberjacking", 5);
    setSkill(db, "Bob", "Fishing", 20);
    setSkill(db, "Cara", "Farming", 5);
    wield(db, "Alice", "Saw", "RightHand");
    bag(db, "Alice", []);
    place(db, "Dave", 2, 10, "N");
    place(db, "Erin", 4, 10, "N");
    place(db, "Finn", 6, 10, "N");
    place(db, "Gail", 8, 10, "N");
    bag(db, "Dave", [["Trout", 1]]);
    setSkill(db, "Dave", "Cooking", 1);
    bag(db, "Erin", [
      ["Potion Bottle", 1],
      ["Red Crystals", 2],
    ]);
    wield(db, "Erin", "Red Sand", "RightHand");
    bag(db, "Finn", [
      ["Damaged Sword, Long", 1],
      ["Chunk of Iron", 1],
    ]);
    wield(db, "Finn", "Blacksmith Hammer");
    bag(db, "Gail", [
      ["Chunk of Star", 1],
      ["Silver Crown", 1],
    ]);
    alice = await login("Alice");
    face(server, "Alice", "N"); // staging: 1.6 logs in facing south
    bob = await login("Bob");
    face(server, "Bob", "N"); // staging: 1.6 logs in facing south
    cara = await login("Cara");
    face(server, "Cara", "N"); // staging: 1.6 logs in facing south
    dave = await login("Dave");
    face(server, "Dave", "N"); // staging: 1.6 logs in facing south
    erin = await login("Erin");
    face(server, "Erin", "N"); // staging: 1.6 logs in facing south
    finn = await login("Finn");
    face(server, "Finn", "N"); // staging: 1.6 logs in facing south
    gail = await login("Gail");
    face(server, "Gail", "N"); // staging: 1.6 logs in facing south
    await tick(2);
  });

  afterAll(() => {
    for (const b of [alice, bob, cara, dave, erin, finn, gail]) {
      b?.close();
    }
    server?.stop();
  });

  test("18 axe swings fell the tree; everyone sees the stump and hears the chops", async () => {
    alice.clear();
    bob.clear();
    wins[3] = 1; // the logs roll (hunger's random(3) takes 1s too)
    wins[12] = 1; // LumberjackImp
    await swing(alice, 18);
    const aliceSwings = deltas(bob).filter((e) => e.e === "swing");
    expect(aliceSwings).toHaveLength(18);
    expect(aliceSwings.every((e) => e.e === "swing" && e.sound === "treechop")).toBe(true);
    expect(tileEvents(bob)).toContainEqual({ e: "tile", layer: 2, x: 5, y: 5, code: "P3" });
    expect(added(bob)).toContainEqual(["Logs", 5, 5]);
    expect(sounds(alice)).toContain("treefalling:2");
    expect(sounds(bob)).not.toContain("treefalling:2");
    expect(lines(alice)).toContain("You have advanced in the art of Lumberjacking!");
    delete wins[3];
    delete wins[12];
  });

  test("a cast into lake water shows the Fishing FX and catches a Trout", async () => {
    bob.clear();
    alice.clear();
    wins[28] = 1; // FishCheck 28 at Fishing 20
    await swing(bob, 1);
    await tick(2);
    expect(deltas(alice)).toContainEqual(expect.objectContaining({ e: "fx", name: "Fishing" }));
    expect(added(alice)).toContainEqual(["Trout", 10, 5]);
    delete wins[28];
  });

  test("Cara tills, plants, waters, and the corn grows Corn", async () => {
    cara.clear();
    await swing(cara, 18);
    expect(tileEvents(cara)).toContainEqual({ e: "tile", layer: 2, x: 13, y: 5, code: "SL" });
    expect(sounds(cara)).toContain("shoveling:2");
    cara.send({ t: "use", slot: 1 });
    await tick(1);
    expect(lines(cara)).toContain("You plant the seeds.");
    expect(tileEvents(cara)).toContainEqual({ e: "tile", layer: 2, x: 13, y: 5, code: "UL" });
    cara.send({ t: "unequip", slot: "LeftHand" });
    await tick(1);
    cara.send({ t: "equip", slot: 2 });
    await tick(1);
    await swing(cara, 18);
    expect(tileEvents(cara)).toContainEqual({ e: "tile", layer: 2, x: 13, y: 5, code: "XL" });
    // A produce roll on (13, 5): random(600) = 9 runs only `CheckHoles` and `DoVeg`.
    cara.clear();
    wins[600] = 9;
    wins[17] = 13;
    wins[12] = 5;
    await tick(1);
    delete wins[600];
    expect(added(cara)).toContainEqual(["Corn", 13, 5]);
  });

  test("time on the map regrows the stump; the map row keeps it", async () => {
    alice.clear();
    wins[600] = 5; // trees and rock
    wins[17] = 5;
    wins[12] = 5;
    await tick(1);
    delete wins[600];
    delete wins[17];
    delete wins[12];
    expect(tileEvents(alice)).toContainEqual({ e: "tile", layer: 2, x: 5, y: 5, code: "S3" });
    await tick(1);
    const rec = findMapByCoords(server.db, 1000, 992);
    expect(rec && tileAt(rec.layers[1], 5, 5)).toBe("S3");
    expect(rec && tileAt(rec.layers[1], 13, 5)).toBe("XL");
  });

  test("Alice picks up the Logs and builds a Chair with her Saw", async () => {
    alice.clear();
    alice.send({ t: "action" });
    await tick(1);
    expect(bagItems(alice)[0]).toBe("Logs-1");
    // the 40-frame pause after Ctrl stops the button until it runs out.
    alice.send({ t: "craft", slot: 1 });
    await tick(1);
    expect(lines(alice)).not.toContain("You begin to build something...");
    await tick(40);
    alice.send({ t: "craft", slot: 1 });
    await tick(1);
    expect(lines(alice)).toContain("You begin to build something...");
    expect(sounds(alice)).toContain("sawbbb:3");
    expect(lockOn(alice)).toEqual([true]);
    expect(bagItems(alice)[0]).toBe("Logs-1"); // the Logs go at completion
    await tick(200);
    expect(lines(alice)).toContain("You built a Chair!");
    expect(lockOn(alice)).toEqual([true, false]);
    expect(bagItems(alice)[0]).toBe("Chair-1");
  });

  test("Dave cooks a Trout at the Stove; the server's line names the dish", async () => {
    dave.clear();
    dave.send({ t: "craft", slot: 1 });
    await tick(1);
    expect(lines(dave)).toContain("You begin to cook the Trout.");
    await tick(200);
    expect(lines(dave)).toContain("Your Trout Fillet is ready!");
    expect(bagItems(dave)[0]).toBe("Trout Fillet-1");
  });

  test("Erin mixes a Red Potion; the crystal and bottle go at completion, the sand stays", async () => {
    erin.clear();
    erin.send({ t: "craft", slot: 1 });
    await tick(1);
    expect(lines(erin)).toContain("You begin to mix the potion.");
    expect(sounds(erin)).toContain("PotionMix:3");
    expect(erin.inbox.some((m) => m.t === "inv")).toBe(false); // nothing taken yet
    await tick(200);
    expect(lines(erin)).toContain("Your potion is ready!");
    expect(bagItems(erin)).toContain("Red Potion-1");
    expect(bagItems(erin)).toContain("Red Crystals-1");
    expect(bagItems(erin)).not.toContain("Potion Bottle-1");
  });

  test("Finn smiths the sword at the Anvil; Bob sees the BSmith FX", async () => {
    finn.clear();
    bob.clear();
    wins[30] = 1; // the smith animation rolls every frame
    finn.send({ t: "craft", slot: 1 });
    await tick(1);
    expect(lines(finn)).toContain("You begin to smith the Damaged Sword, Long...");
    expect(sounds(finn)).toContain("Swordhit3:3");
    await tick(3);
    delete wins[30];
    expect(deltas(bob)).toContainEqual(expect.objectContaining({ e: "fx", name: "BSmith" }));
    expect(deltas(finn)).toContainEqual(expect.objectContaining({ e: "fx", name: "BSmith" }));
    await tick(500);
    expect(lines(finn)).toContain("Your Long Sword is ready!");
    expect(bagItems(finn)[0]).toBe("Long Sword-1");
  });

  test("bug fixed: Gail's first ingredient goes in quietly, the second brews; she takes the Gold Crown out", async () => {
    gail.clear();
    gail.send({ t: "drop", slot: 1 });
    await tick(1);
    expect(lines(gail)).toEqual(["You drop a Chunk of Star into the container."]);
    gail.send({ t: "drop", slot: 2 });
    await tick(1);
    expect(lines(gail)).toContain(
      "The cauldron bubbles...and with a huge puff of smoke, a new item appears inside.",
    );
    gail.clear();
    gail.send({ t: "action" });
    await tick(1);
    expect(lines(gail)).toContain("You open the Cauldron to see what's inside...");
    expect(gail.inbox).toContainEqual({ t: "vault", items: ["Gold Crown"], open: true });
    gail.send({ t: "vaultTake", index: 1 });
    await tick(1);
    expect(bagItems(gail)).toContain("Gold Crown-1");
    expect(gail.inbox).toContainEqual({ t: "vault", items: [], open: false });
  });
});
