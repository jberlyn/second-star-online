/**
 * Airship sim tests: the deed, boarding, riding, what a rider cannot do, unboarding and death.
 */
import { describe, expect, test } from "bun:test";

import {
  airshipWalkGrid,
  DEFAULT_DEATH_DROPS,
  type DeltaEvent,
  footWalkGrid,
  type ServerMsg,
  tileLoc,
  VEHICLE_TEXT,
} from "@secondstaronline/shared";

import { pollAttack, setAttackHeld } from "../src/systems/combat/melee.ts";
import {
  actionIntent,
  crystalsIntent,
  dropIntent,
  goldIntent,
  type ItemCtx,
  pickupIntent,
  useIntent,
} from "../src/systems/inventory/items.ts";
import { monsterAttack } from "../src/systems/monsters/attack.ts";
import { type MonsterSlot, species } from "../src/systems/monsters/slots.ts";
import { checkDeath } from "../src/systems/progression/vitals.ts";
import { bioSource } from "../src/systems/social/bios.ts";
import { castIntent } from "../src/systems/spells/cast.ts";
import { playerRect } from "../src/systems/spells/geometry.ts";
import { type Player, type Room, vitalsView, type WorldMap } from "../src/systems/world/world.ts";
import { ARCHIVE_NPCS, player, rngByN, setup, testMap } from "./helpers/sim.ts";

type Out = { to: string; msg: ServerMsg }[];
const chat = (out: Out, to: string) =>
  out.flatMap((m) => (m.to === to && m.msg.t === "chat" ? [m.msg.text] : []));
const events = (out: Out, to: string): DeltaEvent[] =>
  out.flatMap((m) => (m.to === to && m.msg.t === "delta" ? m.msg.events : []));

/** A map with a `J2` pad at each of `pads` on layer 1. */
const padMap = (pads: [number, number][]) =>
  testMap("x1000y992", [], (x, y) => (pads.some(([px, py]) => px === x && py === y) ? "J2" : "G1"));

/** Sets a layer-2 code and refreshes both walk grids. */
function setL2(map: WorldMap, x: number, y: number, code: string) {
  const cells = (map.layers[1][y - 1] ?? "").split(" ");
  cells[x - 1] = code;
  map.layers[1][y - 1] = cells.join(" ");
  map.walk = footWalkGrid(map.layers[0], map.layers[1]);
  map.walkAir = airshipWalkGrid(map.layers[1]);
}

function scene(opts: { pads?: [number, number][]; rng?: ReturnType<typeof rngByN> } = {}) {
  const map = padMap(opts.pads ?? [[6, 5]]);
  const rng = opts.rng ?? rngByN();
  const { world, join, run, deps } = setup([map], undefined, rng);
  const ann = player("Ann", map, 5, 5);
  const bob = player("Bob", map, 8, 8);
  for (const p of [ann, bob]) {
    p.flicker = 0;
    p.char.vitals = { ...p.char.vitals, sp: 200, spMax: 200, hp: 20, hpMax: 40 };
  }
  ann.facing = "E";
  join(ann);
  join(bob);
  const room = world.rooms.get(map.name) as Room;
  const ctx = (): ItemCtx => ({ world, rng, now: 1_000_000 });
  const clear = (p: Player) => {
    p.itemPause = 0;
  };
  return { map, world, room, ann, bob, run, rng, ctx, clear, deps };
}

const give = (p: Player, slot: number, item: string, qty = 1) => {
  p.char.bag[slot - 1] = { item, qty };
};
const airshipAt = (map: WorldMap, x: number, y: number) =>
  map.ground.find((g) => g.x === x && g.y === y && g.item.endsWith("'s Airship"));

/** Builds Ann's airship on the pad east of her and returns the scene. */
function built(opts: Parameters<typeof scene>[0] = {}) {
  const s = scene(opts);
  give(s.ann, 1, "Airship Deed");
  useIntent(s.ctx(), s.room, s.ann, 1);
  return s;
}
/** Ann boards the airship east of her. */
function aboard(opts: Parameters<typeof scene>[0] = {}) {
  const s = built(opts);
  const out = actionIntent(s.ctx(), s.room, s.ann);
  s.clear(s.ann);
  return { ...s, out };
}

describe("the Airship Deed", () => {
  test("builds on the faced J2, consumes one deed, owner id recorded, no text", () => {
    const s = scene();
    give(s.ann, 1, "Airship Deed", 2);
    const out = useIntent(s.ctx(), s.room, s.ann, 1);
    const g = airshipAt(s.map, 6, 5);
    expect(g?.item).toBe("Ann's Airship");
    expect(g?.ownerId).toBe("Ann");
    expect(s.ann.char.bag[0]?.qty).toBe(1);
    expect(out.filter((o) => o.msg.t === "chat")).toHaveLength(0);
    expect(s.world.groundLog.some((e) => e.add?.ownerId === "Ann")).toBe(true);
    expect(s.ann.invDirty).toBe(true);
  });
  test("mid-step: stand still", () => {
    const s = scene();
    give(s.ann, 1, "Airship Deed");
    s.ann.stepFrames = 3;
    expect(chat(useIntent(s.ctx(), s.room, s.ann, 1), "Ann")).toEqual([VEHICLE_TEXT.standStill]);
    expect(s.ann.char.bag[0]?.item).toBe("Airship Deed");
  });
  test("off-screen faced tile: silent", () => {
    const s = scene();
    give(s.ann, 1, "Airship Deed");
    s.ann.x = 17;
    expect(useIntent(s.ctx(), s.room, s.ann, 1)).toEqual([]);
  });
  test("not a pad: no full stop", () => {
    const s = scene({ pads: [] });
    give(s.ann, 1, "Airship Deed");
    expect(chat(useIntent(s.ctx(), s.room, s.ann, 1), "Ann")).toEqual([
      "You cannot build your airship here",
    ]);
  });
  test("an item on the pad", () => {
    const s = scene();
    s.map.ground.push({ id: "x", item: "Apple", x: 6, y: 5, kind: "drop", expiresAt: null });
    give(s.ann, 1, "Airship Deed");
    expect(chat(useIntent(s.ctx(), s.room, s.ann, 1), "Ann")).toEqual([VEHICLE_TEXT.inTheWay]);
  });
  test("a pad on row 10 counts for building", () => {
    const s = scene({ pads: [[6, 10]] });
    s.ann.y = 10;
    give(s.ann, 1, "Airship Deed");
    expect(chat(useIntent(s.ctx(), s.room, s.ann, 1), "Ann")).toEqual([]);
    expect(airshipAt(s.map, 6, 10)?.ownerId).toBe("Ann");
    expect(s.ann.char.bag[0]).toBeNull();
  });
});

describe("boarding", () => {
  test("Ctrl facing it: you hop onto its tile, no step, body 57, the text", () => {
    const s = built();
    const out = actionIntent(s.ctx(), s.room, s.ann);
    expect(chat(out, "Ann")).toEqual([VEHICLE_TEXT.board]);
    expect(s.ann.vehicle).toBe("Airship");
    expect([s.ann.x, s.ann.y, s.ann.stepFrames]).toEqual([6, 5, 0]);
    expect(s.ann.spell.body).toBe(57);
    expect(events(out, "Bob")).toContainEqual({ e: "body", id: "Ann", body: 57 });
    expect(airshipAt(s.map, 6, 5)).toBeUndefined();
    expect(s.ann.vehicleDirty).toBe(true);
    expect(s.ann.forceYou).toBe(true);
  });
  test("a click on it boards the same way", () => {
    const s = built();
    const g = airshipAt(s.map, 6, 5);
    const out = pickupIntent(s.ctx(), s.room, s.ann, g?.id ?? "");
    expect(chat(out, "Ann")).toEqual([VEHICLE_TEXT.board]);
    expect(s.ann.vehicle).toBe("Airship");
  });
  test("another player's airship: not yours; facing away: you see", () => {
    const s = built();
    s.bob.x = 5;
    s.bob.y = 5;
    s.ann.x = 5;
    s.ann.y = 4; // Ann moves off so Bob can stand west of the pad
    s.bob.facing = "E";
    expect(chat(actionIntent(s.ctx(), s.room, s.bob), "Bob")).toEqual([VEHICLE_TEXT.notYours]);
    s.clear(s.bob);
    s.bob.facing = "N";
    expect(chat(actionIntent(s.ctx(), s.room, s.bob), "Bob")).toEqual([]);
    const g = airshipAt(s.map, 6, 5);
    s.bob.facing = "E";
    s.bob.x = 5;
    s.bob.y = 7; // two tiles away: a click only says whose it is
    s.clear(s.bob);
    expect(chat(pickupIntent(s.ctx(), s.room, s.bob, g?.id ?? ""), "Bob")).toEqual([
      "You see Ann's Airship.",
    ]);
  });
  test("already aboard: a click on another airship is silent", () => {
    const s = aboard();
    s.map.ground.push({
      id: "z",
      item: "Ann's Airship",
      x: 6,
      y: 6,
      kind: "drop",
      expiresAt: null,
    });
    expect(pickupIntent(s.ctx(), s.room, s.ann, "z")).toEqual([]);
  });
  test("an item with no owner id falls back to the 1.6 name test", () => {
    const s = scene();
    s.map.ground.push({
      id: "op",
      item: "Ann's Airship",
      x: 6,
      y: 5,
      kind: "admin",
      expiresAt: null,
    });
    s.bob.x = 5;
    s.bob.y = 5;
    s.ann.x = 5;
    s.ann.y = 3;
    s.bob.facing = "E";
    expect(chat(actionIntent(s.ctx(), s.room, s.bob), "Bob")).toEqual([VEHICLE_TEXT.notYours]);
    s.bob.x = 4;
    s.ann.x = 5;
    s.ann.y = 5;
    s.bob.x = 8;
    s.bob.y = 8;
    s.clear(s.ann);
    expect(chat(actionIntent(s.ctx(), s.room, s.ann), "Ann")).toEqual([VEHICLE_TEXT.board]);
  });
});

describe("riding", () => {
  test("an Airship step is 8 calls = 4 frames, a tile every 4 ticks", () => {
    const s = aboard();
    s.ann.held = "R";
    s.run(1);
    expect(s.ann.x).toBe(7);
    expect(s.ann.stepFrames).toBe(7); // one call used by actor pass 2
    s.run(3);
    expect([s.ann.x, s.ann.stepFrames]).toEqual([7, 1]);
    s.run(1);
    expect([s.ann.x, s.ann.stepFrames]).toEqual([8, 7]);
  });
  test("it flies over water and walls on foot cannot cross, but a layer-2 D8 stops it", () => {
    const s = aboard();
    setL2(s.map, 7, 5, "S3"); // a tree blocks on foot, not aloft
    s.ann.held = "R";
    s.run(1);
    expect(s.ann.x).toBe(7);
    setL2(s.map, 8, 5, "D8");
    s.run(4);
    s.run(1);
    expect(s.ann.x).toBe(7);
  });
  test("items and standing players never block, and no push roll is drawn", () => {
    const s = aboard();
    s.map.ground.push({ id: "w", item: "Wall Torch", x: 7, y: 5, kind: "admin", expiresAt: null });
    s.bob.x = 8;
    s.bob.y = 5;
    s.ann.held = "R";
    s.rng.calls.length = 0;
    s.run(1);
    s.run(4);
    s.run(1);
    expect([s.ann.x, s.ann.y]).toEqual([8, 5]);
    expect(s.rng.calls).not.toContain(25);
  });
  test("a foot walker walks onto a standing rider's tile, no push", () => {
    const s = aboard();
    s.bob.x = 8;
    s.bob.y = 5;
    s.bob.facing = "W";
    s.bob.held = "L";
    s.run(1);
    expect(s.bob.x).toBe(7);
    s.bob.held = null;
    s.run(17);
    s.bob.held = "L";
    s.run(1);
    expect([s.bob.x, s.bob.y]).toEqual([6, 5]);
  });
  test("standing on an Exit does nothing aloft", () => {
    const s = aboard();
    s.map.exit1 = { mapX: 1000, mapY: 991, x: 3, y: 3 } as never;
    s.map.ground.push({ id: "e", item: "Exit", x: 6, y: 5, kind: "admin", expiresAt: null });
    s.run(3);
    expect([s.ann.map.id, s.ann.x, s.ann.y]).toEqual([s.map.id, 6, 5]);
  });
  test("a hit rect for a standing rider cycles F2, F3, F1 with the tick", () => {
    const s = aboard();
    const rects = [0, 1, 2].map((t) => playerRect(s.ann, t));
    expect(rects[0]).not.toEqual(rects[1]);
    expect(rects[1]).toEqual(rects[2]);
  });
});

describe("what an Airship cannot do", () => {
  test("cast is silent and spends nothing", () => {
    const s = aboard();
    s.ann.spell.book = ["Minor Heal"];
    give(s.ann, 2, "Blue Crystals", 5);
    const r = castIntent(s.room, s.ann, "Minor Heal", 200, 100, { rng: s.rng });
    expect(r.out).toEqual([]);
    expect(s.ann.char.vitals.sp).toBe(200);
    expect(s.ann.timers.actionDelay).toBe(0);
  });
  test("attack sets AtDelay = 15 and never swings", () => {
    const s = aboard();
    s.ann.timers.canAttack = true;
    setAttackHeld(s.ann, true);
    const ev = pollAttack(s.room, s.ann, { rng: s.rng, now: 0, world: s.world });
    expect(ev.swing).toBeNull();
    expect(s.ann.timers.atDelay).toBe(15);
  });
  test("PvP melee skips the rider", () => {
    const s = aboard();
    s.bob.x = 6;
    s.bob.y = 6;
    s.bob.facing = "N";
    s.map.flags.canPvp = "X";
    setAttackHeld(s.bob, true);
    const ev = pollAttack(s.room, s.bob, { rng: s.rng, now: 0, world: s.world });
    expect(ev.pvp).toEqual([]);
  });
  test("a monster never melees a rider, and draws random(10) first", () => {
    const rng = rngByN({ 10: [1] });
    const s = aboard({ rng });
    const slot = s.map.slots[0] as MonsterSlot;
    slot.species = "Slime";
    slot.live = {
      name: "Slime",
      hp: species("Slime")?.hp ?? 5,
      x: 6,
      y: 6,
      facing: "N",
      anim: 0,
      fromX: 6,
      fromY: 6,
      queue: [],
      hitCountb: 0,
    };
    s.map.flags.canFight = "X";
    rng.calls.length = 0;
    const r = monsterAttack(s.map, slot, s.ann, {
      rng,
      npcs: ARCHIVE_NPCS,
      invulnerable: () => false,
    });
    expect(r).toBeNull();
    expect(rng.calls[0]).toBe(10);
  });
  test("Morph and Hold do nothing to a rider; Dispel keeps the airship", () => {
    const s = aboard();
    s.bob.spell.book = ["Morph", "Hold", "Dispel Illusions"];
    give(s.bob, 1, "Yellow Crystals", 10);
    give(s.bob, 2, "Purple Crystals", 10);
    give(s.bob, 3, "White Crystals", 10);
    s.bob.x = 8;
    s.bob.y = 5;
    const t = tileLoc(6, 5);
    for (const sp of ["Morph", "Hold", "Dispel Illusions"]) {
      s.bob.timers.actionDelay = 0;
      castIntent(s.room, s.bob, sp, t.h + 14, t.v + 18, { rng: s.rng });
      s.run(4);
    }
    expect(s.ann.spell.body).toBe(57);
    expect(s.ann.vehicle).toBe("Airship");
    expect(s.ann.spell.hold).toBe(0);
    expect(s.ann.spell.morph).toBe(0);
  });
  test("a morph counter running out aboard does not revert the body", () => {
    const s = aboard();
    s.ann.spell.morph = 1;
    const out = s.run(1);
    expect(s.ann.spell.body).toBe(57);
    expect(events(out, "Bob").filter((e) => e.e === "body")).toEqual([]);
  });
  test("a smoke bomb ending aboard still puffs but does not revert", () => {
    const s = aboard();
    s.ann.spell.smokeBomb = 1;
    s.run(1);
    expect(s.ann.spell.body).toBe(57);
    expect(s.room.fxQueue.length + s.room.fx.length).toBeGreaterThan(0);
  });
  test("bug fixed: aboard an airship items, gold and crystals are all refused 'from the sky'", () => {
    const s = aboard();
    give(s.ann, 2, "Apple", 1);
    expect(chat(dropIntent(s.ctx(), s.room, s.ann, 2), "Ann")).toEqual([VEHICLE_TEXT.sky]);
    expect(s.ann.char.bag[1]?.item).toBe("Apple");
    give(s.ann, 3, "Blue Crystals", 5);
    s.ann.char.gold = 50;
    s.ann.facing = "E";
    expect(chat(crystalsIntent(s.ctx(), s.room, s.ann, 3, 2, "drop"), "Ann")).toEqual([
      VEHICLE_TEXT.sky,
    ]);
    expect(chat(goldIntent(s.ctx(), s.room, s.ann, 10), "Ann")).toEqual([VEHICLE_TEXT.sky]);
    expect(s.ann.char.bag[2]).toEqual({ item: "Blue Crystals", qty: 5 });
    expect(s.ann.char.gold).toBe(50);
    expect(s.map.ground.some((g) => /Gold|Crystals/.test(g.item))).toBe(false);
  });
  test("bug fixed: Ctrl aboard an airship takes what is in front, and unboards when nothing is", () => {
    const s = aboard();
    // Off a pad, facing an Apple: Ctrl takes it, as on foot.
    s.ann.x = 7;
    s.ann.y = 5;
    s.ann.facing = "S";
    s.map.ground.push({ id: "ap2", item: "Apple", x: 7, y: 6, kind: "drop", expiresAt: null });
    expect(chat(actionIntent(s.ctx(), s.room, s.ann), "Ann")).toEqual([]);
    expect(s.ann.char.bag.some((l) => l?.item === "Apple")).toBe(true);
    expect(s.ann.vehicle).not.toBeNull();
    // Nothing in front: Ctrl tries to unboard, refused off a pad.
    s.clear(s.ann);
    expect(chat(actionIntent(s.ctx(), s.room, s.ann), "Ann")).toEqual([VEHICLE_TEXT.cannotGetOff]);
    // A click still picks up too.
    s.clear(s.ann);
    s.map.ground.push({ id: "ap3", item: "Apple", x: 7, y: 6, kind: "drop", expiresAt: null });
    pickupIntent(s.ctx(), s.room, s.ann, "ap3");
    expect(s.ann.char.bag.find((l) => l?.item === "Apple")?.qty).toBe(2);
  });
  test("the bio reads the vehicle, so the Robe's disguise is skipped aboard", () => {
    const s = aboard();
    expect(bioSource(s.world, s.ann).inVehicle).toBe(true);
    expect(bioSource(s.world, s.bob).inVehicle).toBe(false);
  });
});

describe("unboarding", () => {
  test("Ctrl on a pad parks the airship under you, the paperdoll returns, no text", () => {
    const s = aboard();
    const out = actionIntent(s.ctx(), s.room, s.ann);
    expect(chat(out, "Ann")).toEqual([]);
    expect(s.ann.vehicle).toBeNull();
    expect(s.ann.spell.body).toBeNull();
    expect([s.ann.x, s.ann.y]).toEqual([6, 5]);
    const g = airshipAt(s.map, 6, 5);
    expect(g?.ownerId).toBe("Ann");
    expect(events(out, "Bob")).toContainEqual({ e: "body", id: "Ann", body: null });
    expect(s.ann.vehicleDirty).toBe(true);
  });
  test("mid-step; not a pad; an item on my tile", () => {
    const s = aboard();
    s.ann.stepFrames = 3;
    expect(chat(actionIntent(s.ctx(), s.room, s.ann), "Ann")).toEqual([VEHICLE_TEXT.stopMoving]);
    s.ann.stepFrames = 0;
    s.clear(s.ann);
    s.map.ground.push({ id: "m", item: "Apple", x: 6, y: 5, kind: "drop", expiresAt: null });
    expect(chat(actionIntent(s.ctx(), s.room, s.ann), "Ann")).toEqual([VEHICLE_TEXT.parked]);
    s.clear(s.ann);
    s.ann.x = 9;
    expect(chat(actionIntent(s.ctx(), s.room, s.ann), "Ann")).toEqual([VEHICLE_TEXT.cannotGetOff]);
  });
  test("SSO: no 20-item cap at the deed or at the unboard", () => {
    const s = scene();
    for (let i = 0; i < 25; i++) {
      // Rows 10-11, clear of the pad at (6, 5).
      s.map.ground.push({
        id: `apple-${i}`,
        item: "Apple",
        x: (i % 17) + 1,
        y: 10 + Math.floor(i / 17),
        kind: "drop",
        expiresAt: null,
      });
    }
    give(s.ann, 1, "Airship Deed");
    expect(chat(useIntent(s.ctx(), s.room, s.ann, 1), "Ann")).toEqual([]);
    expect(airshipAt(s.map, 6, 5)).toBeDefined();
    actionIntent(s.ctx(), s.room, s.ann);
    expect(s.ann.vehicle).not.toBeNull();
    s.clear(s.ann);
    expect(chat(actionIntent(s.ctx(), s.room, s.ann), "Ann")).toEqual([]);
    expect(s.ann.vehicle).toBeNull();
    expect(airshipAt(s.map, 6, 5)?.ownerId).toBe("Ann");
  });
  test("a pad on row 10 lets you off", () => {
    const s = aboard({
      pads: [
        [6, 5],
        [6, 10],
      ],
    });
    s.ann.x = 6;
    s.ann.y = 10;
    expect(chat(actionIntent(s.ctx(), s.room, s.ann), "Ann")).toEqual([]);
    expect(s.ann.vehicle).toBeNull();
    expect(s.ann.spell.body).toBeNull();
    expect(airshipAt(s.map, 6, 10)?.ownerId).toBe("Ann");
  });
});

describe("death", () => {
  const dies = (s: ReturnType<typeof aboard>) => {
    s.ann.char.vitals.hp = 0;
    s.ann.dontHitMeAgain = false;
    s.ann.char.faction = { ...s.ann.char.faction, id: 1 };
    s.ann.char.wanted = true; // only a wanted death would drop the Apple
    give(s.ann, 2, "Apple", 1);
    s.map.flags.canPvp = "X";
    const rng = rngByN({ 2: [1], 3: [2] });
    return checkDeath(s.room, s.ann, rng, {
      item: s.ctx(),
      rules: DEFAULT_DEATH_DROPS,
      everyDeath: false,
    });
  };
  test("kept on purpose: dying aboard an airship loses it and drops nothing; the faction head still drops", () => {
    const s = aboard();
    const r = dies(s);
    expect(r.kind).toBe("death");
    expect(s.ann.vehicle).toBeNull();
    expect(s.ann.spell.body).toBeNull();
    expect(airshipAt(s.map, 6, 5)).toBeUndefined();
    expect(s.ann.char.bag.some((l) => l?.item === "Airship Deed")).toBe(false);
    expect(s.ann.char.bag.some((l) => l?.item === "Apple")).toBe(true);
    expect(s.map.ground.some((g) => g.item.includes("Head"))).toBe(true);
    expect(s.map.ground.some((g) => g.item === "Apple")).toBe(false);
  });
  test("a Lightning death clears it too", () => {
    const s = aboard();
    s.ann.lightningDeath = true;
    s.ann.char.vitals.hp = 20;
    const r = checkDeath(s.room, s.ann, rngByN(), {
      item: s.ctx(),
      rules: DEFAULT_DEATH_DROPS,
      everyDeath: false,
    });
    expect(r.kind).toBe("death");
    expect(s.ann.vehicle).toBeNull();
  });
  test("divergence: over an arena tile a rider dies a normal death and loses the airship", () => {
    const s = aboard();
    const row = (s.map.layers[0][4] ?? "").split(" ");
    row[5] = "6P";
    s.map.layers[0][4] = row.join(" ");
    s.ann.char.vitals.hp = 0;
    const r = checkDeath(s.room, s.ann, rngByN(), {
      item: s.ctx(),
      rules: DEFAULT_DEATH_DROPS,
      everyDeath: false,
    });
    expect(r.kind).toBe("death");
    expect(s.ann.vehicle).toBeNull();
  });
});

describe("hulls", () => {
  /** Bob rides an airship with `hull` left; Ann can cast Firebolt at him. */
  const target = (hull: number) => {
    const s = scene();
    s.bob.vehicle = "Airship";
    s.bob.spell.body = 57;
    s.bob.hull = hull;
    s.ann.spell.book = ["Firebolt"];
    give(s.ann, 1, "Red Crystals", 20);
    const fire = () => {
      s.ann.timers.actionDelay = 0;
      const t = tileLoc(8, 8);
      castIntent(s.room, s.ann, "Firebolt", t.h, t.v, { rng: s.rng });
      return s.run(17);
    };
    return { ...s, fire };
  };
  test("SSO: a new airship boards with a full hull, and the HP bar shows it", () => {
    const s = aboard();
    expect(s.ann.hull).toBe(80);
    expect(vitalsView(s.ann).hull).toEqual({ hp: 80, max: 80 });
    expect(vitalsView(s.bob).hull).toBeUndefined();
  });
  test("SSO: parking keeps the hull and the time; boarding again repairs a point a minute", () => {
    const s = aboard();
    s.ann.hull = 50;
    actionIntent({ ...s.ctx(), now: 1_000_000 }, s.room, s.ann);
    s.clear(s.ann);
    const g = airshipAt(s.map, 6, 5);
    expect([g?.hull, g?.parkedAt, s.ann.hull]).toEqual([50, 1_000_000, null]);
    expect(vitalsView(s.ann).hull).toBeUndefined();
    s.ann.x = 5;
    s.ann.facing = "E";
    actionIntent({ ...s.ctx(), now: 1_000_000 + 10 * 60_000 + 59_999 }, s.room, s.ann);
    expect([s.ann.vehicle, s.ann.hull]).toEqual(["Airship", 60]);
  });
  test("SSO: a player's spell wears a rider's hull by a fixed 2, never the rider's HP", () => {
    const s = target(80);
    s.fire();
    expect([s.bob.hull, s.bob.char.vitals.hp, s.bob.lastToHitMe]).toEqual([78, 20, "Ann"]);
  });
  test("SSO: the hull running out kills the rider; the airship is lost and everyone hears it", () => {
    const s = target(2);
    const out = [...s.fire(), ...s.run(40)];
    expect([s.bob.vehicle, s.bob.hull, s.bob.spell.body]).toEqual([null, null, null]);
    expect(chat(out, "Ann")).toContain(
      "*** Bob's airship was shot down by Ann. Bob fell from the sky.",
    );
    expect(chat(out, "Ann").some((t) => t.includes("was just killed"))).toBe(false);
    expect(s.ann.char.wanted).toBe(true);
    expect(s.bob.sunk).toBeNull();
  });
  test("divergence: over an arena tile a rider follows the map's PvP flag alone", () => {
    const s = target(80);
    s.map.flags.canPvp = "O";
    const row = (s.map.layers[0][7] ?? "").split(" ");
    row[7] = "6P";
    s.map.layers[0][7] = row.join(" ");
    s.fire();
    expect(s.bob.hull).toBe(80);
    s.bob.vehicle = null;
    s.bob.hull = null;
    s.bob.spell.body = null;
    s.bob.flicker = 0;
    s.fire();
    expect(s.bob.char.vitals.hp).toBeLessThan(20);
  });
});
