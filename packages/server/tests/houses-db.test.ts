/**
 * Houses on the server with real SQL (in-memory SQLite): a deed placed on the seed map builds a
 * house in one transaction, survives a restart, is entered by its Exit; decay demolishes it and
 * deletes its interior; rest regen and `HeadDrop` act in it.
 */
import { beforeEach, describe, expect, test } from "bun:test";

import type { ServerMsg } from "@secondstaronline/shared";

import { createGame, type Game } from "../src/game.ts";
import { type Db, openDatabase } from "../src/persistence/database.ts";
import { loadGround } from "../src/persistence/ground.ts";
import { loadHouseList, loadHouses } from "../src/persistence/houses.ts";
import { loadInventory } from "../src/persistence/inventory.ts";
import { findMapByCoords } from "../src/persistence/maps.ts";
import { loadMigrations, migrate, runMigrations } from "../src/persistence/migrations.ts";
import { demolish } from "../src/systems/housing/houses.ts";
import { prepareScenarioMap } from "./helpers/scenario-map.ts";
import { rngByN } from "./helpers/sim.ts";

let db: Db;
let sent: { to: string; msg: ServerMsg }[];
let now: string;

const ROW_8R = Array.from({ length: 17 }, () => "8R").join(" ");

beforeEach(() => {
  db = openDatabase();
  migrate(db);
  prepareScenarioMap(db);
  sent = [];
  now = "2026-11-05T00:00:00.000Z";
  // Paint the seed map's ground buildable (layer 1 `8R`).
  db.run("UPDATE maps SET layer1 = ?", [JSON.stringify(Array.from({ length: 12 }, () => ROW_8R))]);
});

const game = (queues: Record<number, number[]> = {}): Game =>
  createGame({
    db,
    send: (to, msg) => sent.push({ to, msg }),
    isoNow: () => now,
    rng: rngByN(queues),
    minute: () => 0,
  });

async function makeChar(g: Game, name: string): Promise<string> {
  await g.create({
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
  const l = await g.login(name, "pw");
  if (!l.ok) {
    throw new Error(l.text);
  }
  return l.characterId;
}

const texts = (to: string) =>
  sent.flatMap((m) => (m.to === to && m.msg.t === "chat" ? [m.msg.text] : []));

/** Enters `id` and puts a deed in bag slot 3. */
function enterWithDeed(g: Game, id: string, deed = "Small House Deed"): void {
  g.enter(id, false);
  g.intent(id, { t: "mapReady" });
  const p = g.world.players.get(id);
  if (p) {
    p.char.bag[2] = { item: deed, qty: 1 };
  }
}

/** Uses the deed in slot 3 and clicks the playfield at (x, y). */
function place(g: Game, id: string, x: number, y: number): void {
  g.intent(id, { t: "use", slot: 3 });
  g.intent(id, { t: "placeHouse", slot: 3, x, y });
}

describe("building a house", () => {
  test("a Small House on x1000y992: exit field, items, tiles, interior, deed and records in one write", async () => {
    const g = game();
    const id = await makeChar(g, "Bob");
    enterWithDeed(g, id);
    // Hovering (10, 4): anchor (9, 3), footprint x 9-11, y 3-5, clear of trees and of Bob at (6, 4).
    g.intent(id, { t: "use", slot: 3 });
    expect(sent.some((m) => m.msg.t === "placing" && m.msg.house === "Small House")).toBe(true);
    g.intent(id, { t: "placeHouse", slot: 3, x: 10, y: 4 });
    expect(sent.some((m) => m.msg.t === "placing" && m.msg.house === null)).toBe(true);

    const outdoor = findMapByCoords(db, 1000, 992);
    expect(outdoor?.exit1).toEqual({ mx: 1000, my: 992, x: 9, y: 11, house: 1 });
    expect(outdoor?.layers[1][2]?.split(" ").slice(8, 11)).toEqual(["D5", "E5", "I5"]);
    expect(outdoor?.layers[1][4]?.split(" ").slice(8, 11)).toEqual(["G5", "S5", "H5"]);
    const ground = loadGround(db, outdoor?.id ?? "", now).map((x) => `${x.item}@${x.x},${x.y}`);
    expect(ground).toEqual(expect.arrayContaining(["Exit@10,5", "Bob's Mailbox@9,5"]));

    const interior = findMapByCoords(db, 1000, 992, 1);
    expect(interior?.name).toBe("xH11000yH1992");
    expect(interior?.title).toBe("Bob's House");
    expect(interior?.signs[2]).toBe("Bob");
    expect(interior?.exit1).toEqual({ mx: 1000, my: 992, x: 10, y: 6 });
    expect(loadGround(db, interior?.id ?? "", now).map((x) => x.item)).toEqual([
      "Exit",
      "Bob's Door",
      "Bob's House Vault",
    ]);
    expect(loadInventory(db, id).bag[2]).toBeNull();
    expect(loadHouses(db)).toMatchObject([
      { ownerName: "Bob", map: "x1000y992", interior: "xH11000yH1992" },
    ]);
    expect(loadHouseList(db)).toEqual([
      {
        ownerId: id,
        ownerName: "Bob",
        map: "x1000y992",
        interior: "xH11000yH1992",
        month: "2026-11",
      },
    ]);
  });

  test("a refusal keeps placement on and builds nothing", async () => {
    const g = game();
    const id = await makeChar(g, "Bob");
    enterWithDeed(g, id);
    // Hovering (7, 4): the footprint covers Bob at (6, 4).
    place(g, id, 7, 4);
    expect(texts(id)).toContain(
      "You cannot build here because there seems to be something in the way!",
    );
    expect(findMapByCoords(db, 1000, 992, 1)).toBeNull();
    expect(g.world.players.get(id)?.placing).toEqual({ slot: 3, house: "Small House" });
    // A tree at (13, 3) is in the footprint of a house hovered at (13, 4).
    g.intent(id, { t: "placeHouse", slot: 3, x: 13, y: 4 });
    expect(texts(id)).toContain("The terrain is too rough to build here!");
    g.intent(id, { t: "placeHouse", slot: 3, x: 10, y: 4 });
    expect(findMapByCoords(db, 1000, 992, 1)).not.toBeNull();
  });

  test("the house survives a restart and its Exit leads into the interior at (9, 11)", async () => {
    let g = game();
    const id = await makeChar(g, "Bob");
    enterWithDeed(g, id);
    place(g, id, 10, 4);
    g.leave(id);
    g = game();
    g.enter(id, false);
    g.intent(id, { t: "mapReady" });
    const p = g.world.players.get(id);
    if (!p) {
      throw new Error("not in");
    }
    expect(p.map.exit1).toEqual({ mx: 1000, my: 992, x: 9, y: 11, house: 1 });
    // Stand on the Exit (10, 5): the next tick warps.
    p.x = 10;
    p.y = 5;
    g.tick();
    expect(p.map.name).toBe("xH11000yH1992");
    expect([p.x, p.y]).toEqual([9, 11]);
  });

  test("SSO: a deed builds with 25 items on the ground; 1.6 refused more than 17", async () => {
    const g = game();
    const id = await makeChar(g, "Bob");
    enterWithDeed(g, id);
    const map = g.world.players.get(id)?.map;
    for (let i = 0; i < 25; i++) {
      // Rows 9-10, clear of the footprint (x 9-11, y 3-5) and of Bob at (6, 4).
      map?.ground.push({
        id: `apple-${i}`,
        item: "Apple",
        x: (i % 17) + 1,
        y: 9 + Math.floor(i / 17),
        kind: "drop",
        expiresAt: null,
      });
    }
    place(g, id, 10, 4);
    expect(texts(id)).not.toContain("This room is too crowded to build a house here!");
    expect(findMapByCoords(db, 1000, 992, 1)?.name).toBe("xH11000yH1992");
  });

  test("bug fixed: standing beside the footprint is not in the way", async () => {
    const g = game();
    const id = await makeChar(g, "Bob");
    enterWithDeed(g, id);
    const p = g.world.players.get(id);
    const map = p?.map;
    // Hovering (10, 4): footprint x 9-11, y 3-5. Bob stands just left of it, an apple lies
    // just right of it, and another just above.
    if (p) {
      p.x = 8;
      p.y = 4;
    }
    map?.ground.push(
      { id: "a1", item: "Apple", x: 12, y: 4, kind: "drop", expiresAt: null },
      { id: "a2", item: "Apple", x: 10, y: 2, kind: "drop", expiresAt: null },
    );
    place(g, id, 10, 4);
    expect(texts(id)).not.toContain(
      "You cannot build here because there seems to be something in the way!",
    );
    expect(findMapByCoords(db, 1000, 992, 1)?.name).toBe("xH11000yH1992");
  });

  test("bug fixed: a Boat Deed says it cannot be built and is kept", async () => {
    const g = game();
    const id = await makeChar(g, "Bob");
    enterWithDeed(g, id, "Boat Deed");
    g.intent(id, { t: "use", slot: 3 });
    expect(texts(id)).toContain("Boats cannot be built yet, so this deed can't be used.");
    expect(g.world.players.get(id)?.char.bag[2]).toEqual({ item: "Boat Deed", qty: 1 });
    expect(g.world.players.get(id)?.placing).toBeNull();
  });

  test("a hall deed refuses a player with no guild", async () => {
    const g = game();
    const id = await makeChar(g, "Bob");
    enterWithDeed(g, id, "Small Guild Hall Deed");
    place(g, id, 10, 4);
    expect(texts(id)).toContain("You have to belong to a guild to build a guild hall!");
    expect(findMapByCoords(db, 1000, 992, 1)).toBeNull();
  });
});

describe("decay", () => {
  test("a stale owner's house is demolished by the day's sweep: tiles revert, Exit and mailbox go, the interior is deleted", async () => {
    let g = game();
    const bob = await makeChar(g, "Bob");
    enterWithDeed(g, bob);
    place(g, bob, 10, 4);
    g.leave(bob);
    // Two months later Ann logs in: the first clock check of the day sweeps.
    now = "2027-01-10T00:00:00.000Z";
    g = game();
    const ann = await makeChar(g, "Ann");
    g.enter(ann, false);
    const outdoor = findMapByCoords(db, 1000, 992);
    expect(outdoor?.layers[1][2]?.split(" ").slice(8, 11)).toEqual(["G3", "G3", "G3"]);
    const ground = loadGround(db, outdoor?.id ?? "", now).map((x) => x.item);
    expect(ground).not.toContain("Exit");
    expect(ground).not.toContain("Bob's Mailbox");
    // 1.6 left the exit field.
    expect(outdoor?.exit1).toEqual({ mx: 1000, my: 992, x: 9, y: 11, house: 1 });
    expect(findMapByCoords(db, 1000, 992, 1)).toBeNull();
    expect(loadHouses(db)).toEqual([]);
    expect(loadHouseList(db)).toEqual([]);
  });

  test("SSO: a player on the map sees the demolition at once: the tiles revert and the Exit and mailbox go", async () => {
    const g = game();
    const bob = await makeChar(g, "Bob");
    enterWithDeed(g, bob);
    place(g, bob, 10, 4);
    const ann = await makeChar(g, "Ann");
    g.enter(ann, false);
    g.intent(ann, { t: "mapReady" });
    const map = g.world.players.get(ann)?.map;
    const gone = map?.ground.filter((x) => x.item === "Exit" || x.item === "Bob's Mailbox") ?? [];
    expect(gone).toHaveLength(2);
    const r = demolish(g.world, "xH11000yH1992", (n) => g.world.rooms.get(n)?.map ?? null);
    const toAnn = r.out.flatMap((o) => (o.to === ann && o.msg.t === "delta" ? o.msg.events : []));
    expect(toAnn).toEqual(expect.arrayContaining(gone.map((x) => ({ e: "gdel", id: x.id }))));
    expect(toAnn.filter((e) => e.e !== "gdel").length).toBeGreaterThan(0);
    expect(map?.layers[1][2]?.split(" ").slice(8, 11)).toEqual(["G3", "G3", "G3"]);
  });

  test("a tile changed since the build is left as it is", async () => {
    let g = game();
    const bob = await makeChar(g, "Bob");
    enterWithDeed(g, bob);
    place(g, bob, 10, 4);
    g.leave(bob);
    const row = findMapByCoords(db, 1000, 992)?.layers[1][2]?.split(" ") ?? [];
    row[8] = "S3";
    const rows = findMapByCoords(db, 1000, 992)?.layers[1] ?? [];
    rows[2] = row.join(" ");
    db.run("UPDATE maps SET layer2 = ? WHERE slot = 0", [JSON.stringify(rows)]);
    now = "2027-01-10T00:00:00.000Z";
    g = game();
    const ann = await makeChar(g, "Ann");
    g.enter(ann, false);
    expect(findMapByCoords(db, 1000, 992)?.layers[1][2]?.split(" ").slice(8, 11)).toEqual([
      "S3",
      "G3",
      "G3",
    ]);
  });

  test("bug fixed: two houses by one owner on one map keep a blueprint each, and both are reverted", async () => {
    let g = game();
    const bob = await makeChar(g, "Bob");
    enterWithDeed(g, bob);
    place(g, bob, 10, 4);
    const p = g.world.players.get(bob);
    if (p) {
      p.char.bag[2] = { item: "Small House Deed", qty: 1 };
    }
    // The second house hovered at (14, 7): anchor (13, 6), x 13-15, y 6-8.
    place(g, bob, 14, 7);
    expect(findMapByCoords(db, 1000, 992, 2)?.title).toBe("Bob's House");
    expect(loadHouses(db).map((h) => h.interior)).toEqual(["xH11000yH1992", "xH21000yH2992"]);
    expect(loadHouseList(db)).toHaveLength(2);
    g.leave(bob);
    now = "2027-01-10T00:00:00.000Z";
    g = game();
    const ann = await makeChar(g, "Ann");
    g.enter(ann, false);
    const l2 = findMapByCoords(db, 1000, 992)?.layers[1] ?? [];
    expect(l2[2]?.split(" ").slice(8, 11)).toEqual(["G3", "G3", "G3"]);
    expect(l2[5]?.split(" ").slice(12, 15)).toEqual(["G3", "G3", "G3"]);
    expect(findMapByCoords(db, 1000, 992, 1)).toBeNull();
    expect(findMapByCoords(db, 1000, 992, 2)).toBeNull();
    expect(loadHouses(db)).toEqual([]);
  });

  test("bug fixed: a Small Shop's street lamp goes with it", async () => {
    let g = game();
    const bob = await makeChar(g, "Bob");
    enterWithDeed(g, bob, "Small Shop Deed");
    place(g, bob, 10, 4);
    const lamps = () =>
      loadGround(db, findMapByCoords(db, 1000, 992)?.id ?? "", now).filter(
        (x) => x.item === "Street Lamp",
      );
    expect(lamps().map((x) => [x.x, x.y])).toEqual([[9, 6]]);
    g.leave(bob);
    now = "2027-01-10T00:00:00.000Z";
    g = game();
    const ann = await makeChar(g, "Ann");
    g.enter(ann, false);
    expect(lamps()).toEqual([]);
  });

  test("bug fixed: the sweep runs once a day, not on every clock check", async () => {
    let g = game();
    const bob = await makeChar(g, "Bob");
    enterWithDeed(g, bob);
    place(g, bob, 10, 4);
    g.leave(bob);
    // Ann is online through December; Bob's house (last seen November) is fresh until January.
    now = "2026-12-31T23:00:00.000Z";
    g = game();
    const ann = await makeChar(g, "Ann");
    g.enter(ann, false);
    g.intent(ann, { t: "mapReady" });
    const p = g.world.players.get(ann);
    const check = () => {
      if (p) {
        p.houseClock = 1;
      }
      g.tick();
    };
    check();
    expect(findMapByCoords(db, 1000, 992, 1)).not.toBeNull();
    // The first check of 1 January sweeps; later checks that day change nothing.
    now = "2027-01-01T00:30:00.000Z";
    check();
    expect(findMapByCoords(db, 1000, 992, 1)).toBeNull();
    expect(g.world.houseSweepDay).toBe("2027-01-01");
    // A stale entry that appears later that day waits for the next day's first check.
    const stale = {
      ownerId: "zed",
      ownerName: "Zed",
      map: "x900y900",
      interior: "x900y900-zed",
      month: "2020-01",
    };
    g.world.houseList.push(stale);
    now = "2027-01-01T05:00:00.000Z";
    check();
    expect(g.world.houseList).toContainEqual(stale);
    now = "2027-01-02T00:30:00.000Z";
    check();
    expect(g.world.houseList).not.toContainEqual(stale);
    expect(g.world.houseSweepDay).toBe("2027-01-02");
  });

  test("an owner's own login refreshes their entries before the sweep", async () => {
    let g = game();
    const bob = await makeChar(g, "Bob");
    enterWithDeed(g, bob);
    place(g, bob, 10, 4);
    g.leave(bob);
    now = "2027-01-10T00:00:00.000Z";
    g = game();
    g.enter(bob, false);
    expect(findMapByCoords(db, 1000, 992, 1)).not.toBeNull();
    expect(loadHouseList(db)[0]?.month).toBe("2027-01");
  });
});

describe("inside", () => {
  test("rest regen: on a house map, random(10) = 1 and y < 11 heals 1 HP and 1 SP", async () => {
    const g = game({ 10: [1, 1] });
    const id = await makeChar(g, "Bob");
    enterWithDeed(g, id);
    place(g, id, 10, 4);
    const p = g.world.players.get(id);
    if (!p) {
      throw new Error("not in");
    }
    p.x = 10;
    p.y = 5;
    g.tick(); // through the Exit to (9, 11): y 11 does not heal
    p.y = 9;
    p.char.vitals.hp = 5;
    p.char.vitals.sp = 5;
    g.tick();
    expect([p.char.vitals.hp, p.char.vitals.sp]).toEqual([6, 6]);
  });

  test("bug fixed: the dead do not rest", async () => {
    const g = game({ 10: [1, 1, 1, 1] });
    const id = await makeChar(g, "Bob");
    enterWithDeed(g, id);
    place(g, id, 10, 4);
    const p = g.world.players.get(id);
    if (!p) {
      throw new Error("not in");
    }
    p.x = 10;
    p.y = 5;
    g.tick();
    p.y = 9;
    // Mid death lock: the roll comes up 1 and the row is below 11, but nothing heals.
    p.char.vitals.hp = 3;
    p.char.vitals.sp = 5;
    p.deadLock = 50;
    g.tick();
    expect([p.char.vitals.hp, p.char.vitals.sp]).toEqual([3, 5]);
    // Once alive again the same roll heals.
    p.deadLock = 0;
    g.tick();
    expect([p.char.vitals.hp, p.char.vitals.sp]).toEqual([4, 6]);
  });

  test("furniture drops only where the header names you", async () => {
    const g = game();
    const id = await makeChar(g, "Bob");
    enterWithDeed(g, id, "Anvil");
    g.intent(id, { t: "drop", slot: 3 });
    expect(texts(id)).toContain("This building does not belong to you, you can't place this here!");
    const p = g.world.players.get(id);
    if (!p) {
      throw new Error("not in");
    }
    p.char.bag[3] = { item: "Small House Deed", qty: 1 };
    g.intent(id, { t: "use", slot: 4 });
    g.intent(id, { t: "placeHouse", slot: 4, x: 10, y: 4 });
    p.x = 10;
    p.y = 5;
    g.tick();
    g.intent(id, { t: "mapReady" });
    p.facing = "N";
    p.y = 9;
    p.x = 7;
    sent.length = 0;
    g.intent(id, { t: "drop", slot: 3 });
    expect(texts(id)).not.toContain(
      "This building does not belong to you, you can't place this here!",
    );
    expect(p.map.ground.some((x) => x.item === "Anvil" && x.x === 7 && x.y === 8)).toBe(true);
  });

  test("bug fixed: a click on your own Anvil shows its line; Ctrl carries it off, even after a refusal elsewhere", async () => {
    const g = game();
    const id = await makeChar(g, "Bob");
    enterWithDeed(g, id);
    place(g, id, 10, 4);
    const p = g.world.players.get(id);
    if (!p) {
      throw new Error("not in");
    }
    // A town Anvil says its line.
    p.map.ground.push({ id: "town", item: "Anvil", x: 6, y: 3, kind: "admin", expiresAt: null });
    g.intent(id, { t: "pickup", id: "town" });
    expect(texts(id)).toContain("This is an anvil, used for blacksmithing.");
    // Into the house, where Bob's own Anvil stands.
    p.x = 10;
    p.y = 5;
    g.tick();
    g.intent(id, { t: "mapReady" });
    p.itemPause = 0;
    p.facing = "N";
    p.x = 7;
    p.y = 9;
    p.map.ground.push({ id: "mine", item: "Anvil", x: 7, y: 8, kind: "drop", expiresAt: null });
    sent.length = 0;
    g.intent(id, { t: "pickup", id: "mine" });
    expect(texts(id)).toContain("This is an anvil, used for blacksmithing.");
    expect(p.map.ground.some((x) => x.id === "mine")).toBe(true);
    sent.length = 0;
    g.intent(id, { t: "action" });
    expect(texts(id)).not.toContain("This is an anvil, used for blacksmithing.");
    expect(p.map.ground.some((x) => x.id === "mine")).toBe(false);
    expect(p.char.bag.some((l) => l?.item === "Anvil")).toBe(true);
  });

  test("a town Anvil answers a click with its line; it is not picked up", async () => {
    const g = game();
    const id = await makeChar(g, "Bob");
    g.enter(id, false);
    g.intent(id, { t: "mapReady" });
    const p = g.world.players.get(id);
    if (!p) {
      throw new Error("not in");
    }
    p.map.ground.push({ id: "anvil", item: "Anvil", x: 6, y: 3, kind: "admin", expiresAt: null });
    g.intent(id, { t: "pickup", id: "anvil" });
    expect(texts(id)).toContain("This is an anvil, used for blacksmithing.");
    expect(p.map.ground.some((x) => x.id === "anvil")).toBe(true);
  });
});

describe("house faults", () => {
  test("a build whose interior fails leaves no outdoor items, exit or spent deed", async () => {
    const faults: string[] = [];
    const g = createGame({
      db,
      send: (to, msg) => sent.push({ to, msg }),
      isoNow: () => now,
      rng: rngByN(),
      minute: () => 0,
      onFault: (where) => faults.push(where),
    });
    const id = await makeChar(g, "Bob");
    enterWithDeed(g, id);
    g.intent(id, { t: "use", slot: 3 });
    // The interior's map row cannot be written.
    db.run(
      "CREATE TRIGGER no_interiors BEFORE INSERT ON maps WHEN NEW.slot > 0 BEGIN SELECT RAISE(ABORT, 'no interiors'); END",
    );
    g.intent(id, { t: "placeHouse", slot: 3, x: 10, y: 4 });
    expect(faults).toEqual(["intent placeHouse from Bob"]);
    // Nothing reached SQL, and nothing is queued in memory to reach it at the next write.
    expect(g.world.groundLog).toEqual([]);
    expect(loadHouses(db)).toEqual([]);
    expect(findMapByCoords(db, 1000, 992)?.exit1).toBeNull();
    db.run("DROP TRIGGER no_interiors");
    // The player whose action failed was logged out.
    expect(g.isOnline(id)).toBe(false);
  });

  test("an interior whose house is gone is deleted at start (orphan sweep)", async () => {
    const g = game();
    const id = await makeChar(g, "Bob");
    enterWithDeed(g, id);
    place(g, id, 10, 4);
    g.leave(id);
    expect(findMapByCoords(db, 1000, 992, 1)).not.toBeNull();
    // A crash between a demolition and its deferred interior delete leaves this.
    db.run("DELETE FROM houses");
    db.run("DELETE FROM house_list");
    game();
    expect(findMapByCoords(db, 1000, 992, 1)).toBeNull();
  });

  test("SSO: offline characters saved in a deleted interior go to the fallback point, not their respawn point", async () => {
    const g = game();
    const id = await makeChar(g, "Bob");
    const carl = await makeChar(g, "Carl");
    enterWithDeed(g, id);
    place(g, id, 10, 4);
    g.leave(id);
    const seed = findMapByCoords(db, 1000, 992);
    const interior = findMapByCoords(db, 1000, 992, 1);
    // Bob was saved inside with no respawn point; Carl inside with his own on the seed map, which
    // could be a tutorial island: a lost place never sends him there.
    db.run("UPDATE characters SET map_id = ?, x = 9, y = 10 WHERE id IN (?, ?)", [
      interior?.id ?? "",
      id,
      carl,
    ]);
    db.run("UPDATE characters SET respawn_map_id = ?, respawn_x = 3, respawn_y = 3 WHERE id = ?", [
      seed?.id ?? "",
      carl,
    ]);
    db.run("DELETE FROM houses");
    db.run("DELETE FROM house_list");
    game();
    expect(findMapByCoords(db, 1000, 992, 1)).toBeNull();
    const at = (who: string) =>
      db.query("SELECT map_id, x, y FROM characters WHERE id = ?").get(who) as {
        map_id: string;
        x: number;
        y: number;
      };
    expect(at(carl)).toEqual({ map_id: seed?.id ?? "", x: 5, y: 5 });
    expect(at(id)).toEqual({ map_id: seed?.id ?? "", x: 5, y: 5 });
  });

  /** A game that throws at `label` once the demolition has run */
  const crashing = (label: string, queues: Record<number, number[]>, faults: string[]) => {
    let boom = true;
    const g: Game = createGame({
      db,
      send: (to, msg) => sent.push({ to, msg }),
      isoNow: () => now,
      rng: rngByN(queues),
      minute: () => 0,
      onFault: (where) => faults.push(where),
      crashPoint: (l) => {
        // Once Bob's house is gone from memory: the demolition ran in this check or tick.
        if (boom && l === label && g.world.houseList.length === 0) {
          boom = false;
          throw new Error(`test crash at ${l}`);
        }
      },
    });
    return g;
  };

  /** Bob's house on x1000y992, as SQL holds it. */
  const houseInSql = () => ({
    houses: loadHouses(db).length,
    interior: findMapByCoords(db, 1000, 992, 1) !== null,
    exit: loadGround(db, findMapByCoords(db, 1000, 992)?.id ?? "", now).some(
      (x) => x.item === "Exit",
    ),
  });

  test("a crash at house:demolished (login check) rolls the demolition back", async () => {
    let g = game();
    const bob = await makeChar(g, "Bob");
    enterWithDeed(g, bob);
    place(g, bob, 10, 4);
    g.leave(bob);
    const built = houseInSql();
    expect(built).toEqual({ houses: 1, interior: true, exit: true });
    now = "2027-01-10T00:00:00.000Z";
    const faults: string[] = [];
    g = crashing("house:demolished", {}, faults);
    const ann = await makeChar(g, "Ann");
    expect(g.enter(ann, false)).toBe(false);
    expect(faults).toEqual(["enter"]);
    // Nothing half-written: the house, its interior and its Exit are all still in SQL.
    expect(houseInSql()).toEqual(built);
    expect(g.isOnline(ann)).toBe(false);
    // A restart and the next login's sweep demolish it whole.
    g = game();
    g.enter(ann, false);
    expect(houseInSql()).toEqual({ houses: 0, interior: false, exit: false });
  });

  test("a crash at tick:afterHouseCheck rolls the tick back; the next tick runs", async () => {
    let g = game();
    const bob = await makeChar(g, "Bob");
    enterWithDeed(g, bob);
    place(g, bob, 10, 4);
    g.leave(bob);
    const built = houseInSql();
    // Ann logs in on 31 December, when the house is still fresh; the clock check in the tick is
    // the first of 1 January.
    now = "2026-12-31T23:00:00.000Z";
    const faults: string[] = [];
    g = crashing("tick:afterHouseCheck", {}, faults);
    const ann = await makeChar(g, "Ann");
    g.enter(ann, false);
    g.intent(ann, { t: "mapReady" });
    now = "2027-01-01T00:30:00.000Z";
    const p = g.world.players.get(ann);
    if (p) {
      p.houseClock = 1;
    }
    expect(g.tick()).toBe(false);
    expect(faults).toEqual(["tick"]);
    expect(houseInSql()).toEqual(built);
    expect(g.tick()).toBe(true);
    // A restart reads the house back from SQL; the next sweep demolishes it whole.
    g = game();
    g.enter(ann, false);
    expect(houseInSql()).toEqual({ houses: 0, interior: false, exit: false });
  });

  test("an interior that has a house is kept at start", async () => {
    const g = game();
    const id = await makeChar(g, "Bob");
    enterWithDeed(g, id);
    place(g, id, 10, 4);
    g.leave(id);
    game();
    expect(findMapByCoords(db, 1000, 992, 1)).not.toBeNull();
  });
});

describe("upgrading house records", () => {
  test("the migration names each list entry's house, gives its month a year and moves the shop lamp", () => {
    const old = openDatabase();
    const all = loadMigrations();
    runMigrations(
      old,
      all.filter((m) => m.name < "20261118_30"),
    );
    // Rows only; the owner need not exist for this test.
    old.run("PRAGMA foreign_keys = OFF");
    old.run(
      `INSERT INTO houses (owner_id, map_name, item1, item2, tiles, interior, updated_at) VALUES
        ('c1', 'x1y1', '{"item":"Street Lamp","x":5,"y":6}', '{"item":"Exit","x":6,"y":6}', '[]', 'xH11yH11', 'now')`,
    );
    old.run(
      "INSERT INTO house_list (position, owner_id, owner_name, map_name, month) VALUES (1, 'c1', 'Bob', 'x1y1', '1'), (2, 'c1', 'Bob', 'x9y9', '12')",
    );
    runMigrations(old, all);
    expect(
      old
        .query<{ item1: string }, []>("SELECT item1 FROM houses")
        .all()
        .map((r) => JSON.parse(r.item1)),
    ).toEqual([{ item: "Street Lamp", x: 5, y: 7 }]);
    const year = new Date().getUTCFullYear();
    const thisMonth = new Date().getUTCMonth() + 1;
    const list = loadHouseList(old);
    expect(list.map((e) => e.interior)).toEqual(["xH11yH11", ""]);
    expect(list[0]?.month).toBe(`${year}-01`);
    expect(list[1]?.month).toBe(`${thisMonth === 12 ? year : year - 1}-12`);
  });
});
