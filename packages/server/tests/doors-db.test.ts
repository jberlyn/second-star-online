/**
 * Doors and chests with real SQL (in-memory SQLite): a House Key opens a built house's door and
 * the change is stored in place; the owner fills her House Vault and it survives a restart; a
 * refilled quest chest is written.
 */
import { beforeEach, describe, expect, test } from "bun:test";

import type { ServerMsg } from "@secondstaronline/shared";

import { createGame, type Game } from "../src/game.ts";
import { loadContainers } from "../src/persistence/containers.ts";
import { type Db, openDatabase } from "../src/persistence/database.ts";
import { insertGround, loadGround, renameGround } from "../src/persistence/ground.ts";
import { findMapByCoords } from "../src/persistence/maps.ts";
import { migrate } from "../src/persistence/migrations.ts";
import { prepareScenarioMap } from "./helpers/scenario-map.ts";
import { rngByN } from "./helpers/sim.ts";

let db: Db;
let sent: { to: string; msg: ServerMsg }[];
const now = "2026-11-05T00:00:00.000Z";
const ROW_8R = Array.from({ length: 17 }, () => "8R").join(" ");

beforeEach(() => {
  db = openDatabase();
  migrate(db);
  prepareScenarioMap(db);
  sent = [];
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

/** Bob builds a Small House on x1000y992 and walks in to (9, 11), facing the door. */
function buildAndEnter(g: Game, id: string) {
  g.enter(id, false);
  g.intent(id, { t: "mapReady" });
  const p = g.world.players.get(id);
  if (!p) {
    throw new Error("not in");
  }
  p.char.bag[2] = { item: "Small House Deed", qty: 1 };
  p.char.bag[0] = { item: "House Key", qty: 1 };
  p.char.bag[1] = { item: "Apple", qty: 1 };
  g.intent(id, { t: "use", slot: 3 });
  g.intent(id, { t: "placeHouse", slot: 3, x: 10, y: 4 });
  p.x = 10;
  p.y = 5;
  g.tick();
  g.intent(id, { t: "mapReady" });
  return p;
}

describe("doors and house vaults in the database", () => {
  test("the House Key's change is stored in place, keeping the item's id and order", async () => {
    const g = game();
    const bob = await makeChar(g, "Bob");
    const p = buildAndEnter(g, bob);
    expect(p.map.name).toBe("xH11000yH1992");
    p.facing = "N";
    g.intent(bob, { t: "use", slot: 1 });
    const interior = findMapByCoords(db, 1000, 992, 1);
    const ground = loadGround(db, interior?.id ?? "", now);
    expect(ground.map((x) => x.item)).toEqual(["Exit", "Bob's Opened Door", "Bob's House Vault"]);
    expect(texts(bob)).not.toContain("Your key doesn't fit this lock!");
  });

  test("Bob fills his House Vault through the open door; the vault survives a restart", async () => {
    let g = game();
    const bob = await makeChar(g, "Bob");
    const p = buildAndEnter(g, bob);
    p.facing = "N";
    g.intent(bob, { t: "use", slot: 1 });
    // The key's pause runs out, then through the door to (5, 9), facing the vault at (5, 8).
    p.itemPause = 0;
    p.x = 5;
    p.y = 9;
    p.facing = "N";
    g.intent(bob, { t: "drop", slot: 2 });
    expect(texts(bob)).toContain("You drop a Apple into the container.");
    g.leave(bob);
    g = game();
    expect(loadContainers(db).get("Bob's House Vault")).toEqual(["Apple"]);
    expect(g.world.containers.get("Bob's House Vault")).toEqual(["Apple"]);
  });

  test("renameGround writes the new name and nothing else", () => {
    const map = findMapByCoords(db, 1000, 992);
    const id = "01900000-0000-7000-8000-000000000001";
    insertGround(
      db,
      {
        id,
        mapId: map?.id ?? "",
        x: 3,
        y: 3,
        item: "Steel Door",
        qty: 1,
        kind: "admin",
        expiresAt: null,
      },
      now,
    );
    renameGround(db, id, "Open Steel Door");
    expect(loadGround(db, map?.id ?? "", now).find((x) => x.id === id)).toMatchObject({
      item: "Open Steel Door",
      x: 3,
      y: 3,
      kind: "admin",
    });
  });

  test("a quest chest refill is written with the tick", async () => {
    const g = game({ 350: [1], 4000: [1], 6: [6] });
    const bob = await makeChar(g, "Bob");
    g.enter(bob, false);
    g.intent(bob, { t: "mapReady" });
    const p = g.world.players.get(bob);
    if (!p) {
      throw new Error("not in");
    }
    p.saveBlock = 0;
    g.tick();
    // random(6) = 6 → Dark Chest; random(6) for its line takes the default 6: Green Laser Sword.
    expect(loadContainers(db).get("Dark Chest")).toEqual(["Green Laser Sword"]);
  });
});
