/**
 * Vehicle persistence (real SQL on in-memory SQLite): migration 22, the owner id and the vehicle
 * round-trip, boarding written as one transaction, and a login aboard.
 */
import { beforeEach, describe, expect, test } from "bun:test";

import { airshipWalkGrid, type ServerMsg } from "@secondstaronline/shared";

import { createGame, type Game } from "../src/game.ts";
import { findCharacterById } from "../src/persistence/characters.ts";
import { type Db, openDatabase } from "../src/persistence/database.ts";
import { insertGround, loadGround } from "../src/persistence/ground.ts";
import { findMapByCoords } from "../src/persistence/maps.ts";
import { migrate } from "../src/persistence/migrations.ts";
import { rngByN } from "./helpers/sim.ts";

let db: Db;
let sent: { to: string; msg: ServerMsg }[];
const now = "2026-11-07T00:00:00.000Z";

beforeEach(() => {
  db = openDatabase();
  migrate(db);
  sent = [];
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

describe("migration 22 (vehicles)", () => {
  test("a ground row keeps its owner id; a character's vehicle defaults to none", async () => {
    const g = game();
    const id = await makeChar(g, "Alice");
    expect(findCharacterById(db, id)?.vehicle).toBeNull();
    insertGround(
      db,
      {
        id: Bun.randomUUIDv7(),
        mapId: seedMapId(),
        x: 3,
        y: 3,
        item: "Alice's Airship",
        qty: 1,
        kind: "drop",
        expiresAt: null,
        ownerId: id,
      },
      now,
    );
    expect(loadGround(db, seedMapId(), now)).toMatchObject([{ ownerId: id }]);
    expect(() =>
      db.query("UPDATE characters SET vehicle = 'Canoe' WHERE id = ?").run(id),
    ).toThrow();
  });
});

describe("the Airship across sessions", () => {
  test("boarding writes the ground delete and the vehicle together; a login comes back aboard", async () => {
    const g = game();
    const id = await makeChar(g, "Alice");
    g.enter(id, false);
    g.intent(id, { t: "mapReady" });
    g.tick();
    const p = g.world.players.get(id);
    if (!p) {
      throw new Error("no player");
    }
    // A pad straight ahead (north of the start tile) and a deed in the bag. A login faces
    // south, so the test turns the player north.
    p.facing = "N";
    const padY = p.y - 1;
    const row = (p.map.layers[0][padY - 1] ?? "").split(" ");
    row[p.x - 1] = "J2";
    p.map.layers[0][padY - 1] = row.join(" ");
    p.char.bag[0] = { item: "Airship Deed", qty: 1 };
    g.intent(id, { t: "use", slot: 1 });
    expect(loadGround(db, seedMapId(), now)).toMatchObject([
      { item: "Alice's Airship", x: p.x, y: padY, ownerId: id },
    ]);
    expect(findCharacterById(db, id)?.vehicle).toBeNull();
    expect(p.char.bag[0]?.item).not.toBe("Airship Deed");
    p.itemPause = 0;
    g.intent(id, { t: "action" }); // Ctrl boards
    expect(p.vehicle).toBe("Airship");
    expect(loadGround(db, seedMapId(), now)).toEqual([]);
    const stored = findCharacterById(db, id);
    expect(stored?.vehicle).toBe("Airship");
    expect(stored?.position).toMatchObject({ x: p.x, y: padY });
    g.leave(id);
    const g2 = game();
    g2.enter(id, false);
    const q = g2.world.players.get(id);
    expect(q?.vehicle).toBe("Airship");
    expect(q?.spell.body).toBe(57);
    expect(q?.map.walkAir).toEqual(airshipWalkGrid(q?.map.layers[1] ?? []));
  });
});

describe("migration 43 (vehicle hulls)", () => {
  test("SSO: a parked hull and its parking time round-trip; none means full", async () => {
    const g = game();
    const id = await makeChar(g, "Alice");
    expect(findCharacterById(db, id)?.hull).toBeNull();
    const row = {
      mapId: seedMapId(),
      y: 3,
      item: "Alice's Airship",
      qty: 1,
      kind: "drop" as const,
      expiresAt: null,
      ownerId: id,
    };
    insertGround(db, { ...row, id: Bun.randomUUIDv7(), x: 3, hull: 50, parkedAt: now }, now);
    insertGround(db, { ...row, id: Bun.randomUUIDv7(), x: 4 }, now);
    expect(loadGround(db, seedMapId(), now)).toMatchObject([
      { x: 3, hull: 50, parkedAt: now },
      { x: 4, hull: null, parkedAt: null },
    ]);
    expect(() => db.query("UPDATE characters SET hull = -1 WHERE id = ?").run(id)).toThrow();
  });

  test("SSO: a parked ship's facing round-trips; none faces east; nothing else is allowed", async () => {
    const g = game();
    const id = await makeChar(g, "Alice");
    const row = {
      mapId: seedMapId(),
      y: 3,
      item: "Alice's Boat",
      qty: 1,
      kind: "drop" as const,
      expiresAt: null,
      ownerId: id,
    };
    const ship = Bun.randomUUIDv7();
    insertGround(db, { ...row, id: ship, x: 3, facing: "N" }, now);
    insertGround(db, { ...row, id: Bun.randomUUIDv7(), x: 4 }, now);
    expect(loadGround(db, seedMapId(), now)).toMatchObject([
      { x: 3, facing: "N" },
      { x: 4, facing: null },
    ]);
    expect(() => db.query("UPDATE ground_items SET facing = 'X' WHERE id = ?").run(ship)).toThrow();
  });

  test("SSO: a rider's hull is saved and a login comes back with it", async () => {
    const g = game();
    const id = await makeChar(g, "Alice");
    g.enter(id, false);
    g.intent(id, { t: "mapReady" });
    g.tick();
    const p = g.world.players.get(id);
    if (!p) {
      throw new Error("no player");
    }
    p.facing = "N";
    const padY = p.y - 1;
    const cells = (p.map.layers[0][padY - 1] ?? "").split(" ");
    cells[p.x - 1] = "J2";
    p.map.layers[0][padY - 1] = cells.join(" ");
    p.char.bag[0] = { item: "Airship Deed", qty: 1 };
    g.intent(id, { t: "use", slot: 1 });
    p.itemPause = 0;
    g.intent(id, { t: "action" });
    expect(findCharacterById(db, id)?.hull).toBe(80);
    p.hull = 33;
    g.leave(id);
    expect(findCharacterById(db, id)?.hull).toBe(33);
    const g2 = game();
    g2.enter(id, false);
    expect(g2.world.players.get(id)?.hull).toBe(33);
  });
});

describe("migration 44 (ship vehicles)", () => {
  test("a character can ride a Boat or Battleship, and nothing else new", async () => {
    const g = game();
    const id = await makeChar(g, "Alice");
    for (const v of ["Boat", "Battleship", "Airship"]) {
      db.query("UPDATE characters SET vehicle = ?, hull = 10 WHERE id = ?").run(v, id);
      expect(findCharacterById(db, id)).toMatchObject({ vehicle: v, hull: 10, name: "Alice" });
    }
    expect(() =>
      db.query("UPDATE characters SET vehicle = 'Canoe' WHERE id = ?").run(id),
    ).toThrow();
  });
});
