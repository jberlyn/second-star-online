/**
 * Persistence (real SQL on in-memory SQLite): the starting kit, an item movement in
 * one transaction, equipment across a relog, ground items across a restart and loot decay.
 */
import { beforeEach, describe, expect, test } from "bun:test";

import type { ServerMsg } from "@secondstaronline/shared";

import { createGame, type Game } from "../src/game.ts";
import { setRole } from "../src/persistence/accounts.ts";
import { type Db, openDatabase } from "../src/persistence/database.ts";
import { insertGround, loadGround } from "../src/persistence/ground.ts";
import { loadInventory } from "../src/persistence/inventory.ts";
import { findMapByCoords } from "../src/persistence/maps.ts";
import { migrate } from "../src/persistence/migrations.ts";
import { loadSlots } from "../src/persistence/monsters.ts";
import { rngByN } from "./helpers/sim.ts";

let db: Db;
let sent: { to: string; msg: ServerMsg }[];
let now = "2026-11-05T00:00:00.000Z";

beforeEach(() => {
  db = openDatabase();
  migrate(db);
  sent = [];
  now = "2026-11-05T00:00:00.000Z";
});

function game(): Game {
  return createGame({
    db,
    send: (to, msg) => sent.push({ to, msg }),
    isoNow: () => now,
    rng: rngByN(),
    minute: () => 0,
  });
}

async function makeChar(g: Game, name: string): Promise<string> {
  const r = await g.create({
    t: "create",
    name,
    password: "pw",
    sex: 1,
    head: 1,
    classCode: 1,
    str: 11,
    sta: 11,
    int: 11,
    wis: 11,
    dex: 11,
  });
  if (!r.ok) {
    throw new Error(r.text);
  }
  const l = await g.login(name, "pw");
  if (!l.ok) {
    throw new Error(l.text);
  }
  return l.characterId;
}

const seedMapId = () => findMapByCoords(db, 1000, 992)?.id ?? "";

describe("inventory persistence", () => {
  test("the starting kit loads: Apple-2, Knife-1, nothing worn", async () => {
    const g = game();
    const id = await makeChar(g, "Alice");
    g.enter(id, false);
    const inv = sent.find((s) => s.to === id && s.msg.t === "inv");
    g.tick();
    const after = sent.find((s) => s.to === id && s.msg.t === "inv");
    expect(inv ?? after).toBeDefined();
    const stored = loadInventory(db, id);
    expect(stored.bag.slice(0, 2)).toEqual([
      { item: "Apple", qty: 2 },
      { item: "Knife", qty: 1 },
    ]);
    expect(stored.equip.weapon).toBe("NOTHING");
  });

  test("equip and drop are written at once; a relog keeps them", async () => {
    const g = game();
    const id = await makeChar(g, "Alice");
    g.enter(id, false);
    g.intent(id, { t: "mapReady" });
    g.tick();
    g.intent(id, { t: "equip", slot: 2 });
    g.intent(id, { t: "drop", slot: 1 });
    expect(loadInventory(db, id).equip.weapon).toBe("Knife");
    expect(loadInventory(db, id).bag[0]).toEqual({ item: "Apple", qty: 1 });
    expect(loadGround(db, seedMapId(), now).map((x) => x.item)).toEqual(["Apple"]);
    g.leave(id);
    const g2 = game();
    g2.enter(id, false);
    const p = g2.world.players.get(id);
    expect(p?.char.equip.weapon).toBe("Knife");
    expect(p?.map.ground.map((x) => x.item)).toEqual(["Apple"]);
  });

  test("a gold drop writes the gold and the pile at once; a pickup gives it back", async () => {
    const g = game();
    const id = await makeChar(g, "Alice");
    g.enter(id, false);
    g.intent(id, { t: "mapReady" });
    g.tick();
    const p = g.world.players.get(id);
    if (!p) {
      throw new Error("no player");
    }
    p.char.gold = 100;
    g.intent(id, { t: "gold", n: 40 });
    expect(loadInventory(db, id).gold).toBe(60);
    expect(loadGround(db, seedMapId(), now).map((x) => x.item)).toEqual(["40 Gold"]);
    g.intent(id, { t: "action" }); // Ctrl takes the faced pile
    expect(loadInventory(db, id).gold).toBe(100);
    expect(loadGround(db, seedMapId(), now)).toEqual([]);
  });

  test("/drop by an immortal is saved and never decays", async () => {
    const g = game();
    const id = await makeChar(g, "Alice");
    g.enter(id, false);
    const p = g.world.players.get(id);
    setRole(db, p?.accountId ?? "", "immortal", now);
    if (p) {
      p.role = "immortal";
    }
    g.intent(id, { t: "mapReady" });
    g.tick();
    g.intent(id, { t: "chat", text: "/drop Long Sword" });
    const rows = loadGround(db, seedMapId(), now);
    expect(rows).toMatchObject([{ item: "Long Sword", kind: "admin", expiresAt: null }]);
  });
  test("a counted /drop pile keeps its count in the database", async () => {
    const g = game();
    const id = await makeChar(g, "Alice");
    g.enter(id, false);
    const p = g.world.players.get(id);
    setRole(db, p?.accountId ?? "", "immortal", now);
    if (p) {
      p.role = "immortal";
    }
    g.intent(id, { t: "mapReady" });
    g.tick();
    g.intent(id, { t: "chat", text: "/drop 20 Apple" });
    expect(loadGround(db, seedMapId(), now)).toMatchObject([{ item: "Apple", qty: 20 }]);
  });
});

describe("loot decay across a restart", () => {
  test("loot past its time is deleted when its map loads", () => {
    const mapId = seedMapId();
    insertGround(
      db,
      {
        id: Bun.randomUUIDv7(),
        mapId,
        x: 3,
        y: 3,
        item: "2 Gold",
        qty: 1,
        kind: "loot",
        expiresAt: "2026-11-05T00:30:00.000Z",
      },
      now,
    );
    expect(loadGround(db, mapId, "2026-11-05T00:29:59.000Z")).toHaveLength(1);
    expect(loadGround(db, mapId, "2026-11-05T00:30:00.000Z")).toHaveLength(0);
  });
});

describe("pig drop persistence", () => {
  test("pig drop: the bag and the map's slot rows are saved together", async () => {
    const g = game();
    const id = await makeChar(g, "Alice");
    g.enter(id, false);
    g.intent(id, { t: "mapReady" });
    g.tick();
    const p = g.world.players.get(id);
    if (!p) {
      throw new Error("no player");
    }
    p.char.bag[2] = { item: "Pig", qty: 2 };
    p.itemPause = 0;
    // Nothing blocks the tile the player faces on the start map.
    g.intent(id, { t: "drop", slot: 3 });
    const pigs = p.map.slots.filter((s) => s.live?.name === "Pig");
    expect(pigs).toHaveLength(1);
    // Reloaded from the database: one Pig fewer, and the live Pig in `map_slots`.
    expect(loadInventory(db, id).bag[2]).toEqual({ item: "Pig", qty: 1 });
    const rows = loadSlots(db, p.map.id).filter((r) => r.live?.name === "Pig");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.live).toMatchObject({ x: pigs[0]?.live?.x, y: pigs[0]?.live?.y });
    expect(p.map.slots.some((s) => s.dirty)).toBe(false);
  });
});
