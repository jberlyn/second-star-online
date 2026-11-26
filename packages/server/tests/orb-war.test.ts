/**
 * The elemental orb war (issue #3) and the world events it is built from: an orb dropped on a
 * placed orb platform, the counters it moves, the mages it tells, the counters' drift, `/counter`,
 * and the counters kept with the bag in the database over a restart.
 */
import { beforeEach, describe, expect, test } from "bun:test";

import { ADMINISTRATOR, type ServerMsg } from "@secondstaronline/shared";

import { createGame, type Game } from "../src/game.ts";
import { recentAudit } from "../src/persistence/admin.ts";
import { loadCounters } from "../src/persistence/counters.ts";
import { type Db, openDatabase } from "../src/persistence/database.ts";
import { loadInventory } from "../src/persistence/inventory.ts";
import { migrate } from "../src/persistence/migrations.ts";
import { dropIntent, type ItemCtx } from "../src/systems/inventory/items.ts";
import { counterChat, driftTick } from "../src/systems/world/events.ts";
import type { Player, Room } from "../src/systems/world/world.ts";
import { prepareScenarioMap } from "./helpers/scenario-map.ts";
import { player, rngByN, setup, testMap } from "./helpers/sim.ts";

type Out = { to: string; msg: ServerMsg }[];
const chat = (out: Out, to: string) =>
  out.flatMap((m) => (m.to === to && m.msg.t === "chat" ? [m.msg.text] : []));

const FIRE_MAGE = 21;
const WIND_MAGE = 23;

/** A (a Fire Mage) faces east at (5, 5); B is a Wind Mage, C a Water Mage, elsewhere on the map. */
function scene() {
  const map = testMap("x1000y992");
  const rng = rngByN();
  const { world, join } = setup([map], undefined, rng);
  const a = player("A", map, 5, 5);
  const b = player("B", map, 12, 9);
  const c = player("C", map, 14, 9);
  a.char.classCode = FIRE_MAGE;
  b.char.classCode = WIND_MAGE;
  c.char.classCode = 22;
  a.facing = "E";
  for (const p of [a, b, c]) {
    join(p);
  }
  const room = world.rooms.get(map.name) as Room;
  const ctx = (): ItemCtx => ({ world, rng, now: 1_000_000 });
  const place = (item: string, kind: "admin" | "drop" = "admin") =>
    map.ground.push({ id: item, item, x: 6, y: 5, kind, expiresAt: null });
  return { map, world, room, a, b, c, ctx, place };
}

const give = (p: Player, slot: number, item: string, qty = 1) => {
  p.char.bag[slot - 1] = { item, qty };
};

describe("an orb on an orb platform", () => {
  test("design change: a Wind Orb on the Fire Orb Platform moves 1 from wind to fire, is used up, and tells both elements' mages", () => {
    const s = scene();
    s.place("Fire Orb Platform#3");
    give(s.a, 1, "Wind Orb", 3);
    const out = dropIntent(s.ctx(), s.room, s.a, 1, 3);
    expect(s.world.counters).toEqual({ Fire: 26, Wind: 24 });
    expect(s.world.countersDirty).toBe(true);
    // One orb of the stack is offered; the platform is all that is on the tile.
    expect(s.a.char.bag[0]).toEqual({ item: "Wind Orb", qty: 2 });
    expect(s.map.ground.map((g) => g.item)).toEqual(["Fire Orb Platform#3"]);
    expect(chat(out, "A")).toEqual([
      "You drop the wind orb onto the fire platform...you sense something powerful has just happened...",
      "You feel the fire magic within you grow stronger.",
    ]);
    expect(chat(out, "B")).toEqual(["You feel the wind magic within you weaken."]);
    expect(chat(out, "C")).toEqual([]);
    expect(s.world.activity.at(-1)).toMatchObject({
      type: "use",
      item: "Wind Orb",
      qty: -1,
      details: { offering: "Wind Orb on the Fire Orb Platform", onto: "Fire Orb Platform" },
    });
  });

  test("design change: an element at zero is weakened no further; the orb stays", () => {
    const s = scene();
    s.place("Water Orb Platform");
    s.world.counters = { Fire: 25, Water: 50, Earth: 25, Wind: 0 };
    give(s.a, 1, "Wind Orb");
    const out = dropIntent(s.ctx(), s.room, s.a, 1);
    expect(chat(out, "A")).toEqual([
      "You get the sense that the wind mages are already weakened enough.",
    ]);
    expect(s.world.counters.Wind).toBe(0);
    expect(s.world.countersDirty).toBe(false);
    expect(s.a.char.bag[0]).toEqual({ item: "Wind Orb", qty: 1 });
  });

  test("design change: an orb on its own element's platform does no good, and stays", () => {
    const s = scene();
    s.place("Earth Orb Platform");
    give(s.a, 1, "Earth Orb");
    const out = dropIntent(s.ctx(), s.room, s.a, 1);
    expect(chat(out, "A")).toEqual(["Dropping an earth orb will do no good here."]);
    expect(s.a.char.bag[0]).toEqual({ item: "Earth Orb", qty: 1 });
    expect(s.world.countersDirty).toBe(false);
  });

  test("a platform a player dropped is no altar: the orb is refused as on any crowded tile", () => {
    const s = scene();
    s.place("Fire Orb Platform", "drop");
    give(s.a, 1, "Wind Orb");
    const out = dropIntent(s.ctx(), s.room, s.a, 1);
    expect(chat(out, "A")).toEqual([
      "You begin to drop this but realize the floor is too crowded.",
    ]);
    expect(s.world.countersDirty).toBe(false);
    expect(s.a.char.bag[0]).toEqual({ item: "Wind Orb", qty: 1 });
  });

  test("the drop's own refusals come first: aboard a vehicle nothing is offered", () => {
    const s = scene();
    s.place("Fire Orb Platform");
    s.a.vehicle = "Airship";
    give(s.a, 1, "Wind Orb");
    dropIntent(s.ctx(), s.room, s.a, 1);
    expect(s.world.countersDirty).toBe(false);
    expect(s.a.char.bag[0]).toEqual({ item: "Wind Orb", qty: 1 });
  });
});

describe("the counters over time and in staff hands", () => {
  test("design change: each hour of running, an element's share drifts 1 back toward 25", () => {
    const s = scene();
    s.world.counters = { Fire: 30, Water: 20, Earth: 25, Wind: 25 };
    driftTick(s.world, 59);
    expect(s.world.countersDirty).toBe(false);
    driftTick(s.world, 60);
    expect(s.world.counters).toEqual({ Fire: 29, Water: 21, Earth: 25, Wind: 25 });
    expect(s.world.countersDirty).toBe(true);
  });

  test("/counter lists the counters and sets one inside its bounds", () => {
    const s = scene();
    s.world.counters = { Fire: 25, Water: 25, Earth: 25, Wind: 25 };
    expect(chat(counterChat(s.world, s.a, "").out, "A")).toEqual([
      "Counters: Fire 25, Water 25, Earth 25, Wind 25",
    ]);
    const r = counterChat(s.world, s.a, "fire 250");
    expect(chat(r.out, "A")).toEqual(["Fire is now 100."]);
    expect(r.changed).toEqual({ counter: "Fire", before: 25, after: 100 });
    expect(s.world.counters.Fire).toBe(100);
    expect(chat(counterChat(s.world, s.a, "Fire reset").out, "A")).toEqual(["Fire is now 25."]);
  });
});

describe("in the database", () => {
  let db: Db;
  let sent: Out;
  beforeEach(() => {
    db = openDatabase();
    migrate(db);
    prepareScenarioMap(db);
    sent = [];
  });
  const game = (): Game =>
    createGame({
      db,
      send: (to, msg) => sent.push({ to, msg }),
      isoNow: () => "2026-11-27T00:00:00.000Z",
      rng: rngByN(),
      minute: () => 0,
    });
  async function makeChar(g: Game, name: string, classCode: number): Promise<string> {
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
    g.enter(l.characterId, false);
    g.intent(l.characterId, { t: "mapReady" });
    const p = g.world.players.get(l.characterId) as Player;
    p.char.classCode = classCode;
    return l.characterId;
  }
  const texts = (to: string) =>
    sent.flatMap((m) => (m.to === to && m.msg.t === "chat" ? [m.msg.text] : []));

  test("design change: the first start saves each element at 25", () => {
    game();
    expect(loadCounters(db)).toEqual({ Earth: 25, Fire: 25, Water: 25, Wind: 25 });
  });

  test("design change: an offering's counters are saved with the bag it took the orb from, and kept over a restart", async () => {
    const g = game();
    const id = await makeChar(g, "Al", FIRE_MAGE);
    const p = g.world.players.get(id) as Player;
    p.role = ADMINISTRATOR;
    g.intent(id, { t: "chat", text: "/drop Fire Orb Platform" });
    p.char.bag[0] = { item: "Wind Orb", qty: 1 };
    g.intent(id, { t: "drop", slot: 1 });
    expect(texts(id)).toContain(
      "You drop the wind orb onto the fire platform...you sense something powerful has just happened...",
    );
    expect(loadCounters(db)).toEqual({ Earth: 25, Fire: 26, Water: 25, Wind: 24 });
    expect(loadInventory(db, id).bag.some((l) => l?.item === "Wind Orb")).toBe(false);
    expect(game().world.counters).toEqual({ Fire: 26, Water: 25, Earth: 25, Wind: 24 });
  });

  test("/counter needs the content editor's permission, and each change is audited", async () => {
    const g = game();
    const id = await makeChar(g, "Al", 1);
    g.intent(id, { t: "chat", text: "/counter Wind 3" });
    expect(g.world.counters.Wind).toBe(25);
    expect(texts(id).some((t) => t.includes("Wind is now"))).toBe(false);
    (g.world.players.get(id) as Player).role = ADMINISTRATOR;
    g.intent(id, { t: "chat", text: "/counter Wind 3" });
    expect(texts(id)).toContain("Wind is now 3.");
    g.tick();
    expect(loadCounters(db).Wind).toBe(3);
    expect(recentAudit(db, 1)[0]).toMatchObject({ command: "/counter", target: "Wind" });
  });
});
