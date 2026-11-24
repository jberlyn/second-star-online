/**
 * The Battleship's cannon (issue #2): one shot a press along the facing, a Cannonball spent each
 * shot, a 5 second reload, and a shot that stops at the first player, monster or vehicle, at a tile
 * an Airship cannot cross, or at the edge.
 */
import { describe, expect, test } from "bun:test";

import {
  airshipWalkGrid,
  cannonReloadFrames,
  type DeltaEvent,
  FACING_DELTA,
  type ServerMsg,
  tileLoc,
} from "@secondstaronline/shared";

import { setAttackHeld } from "../src/systems/combat/melee.ts";
import { actionIntent, type ItemCtx, useIntent } from "../src/systems/inventory/items.ts";
import { type MonsterSlot, species } from "../src/systems/monsters/slots.ts";
import type { Player, Room, WorldMap } from "../src/systems/world/world.ts";
import { player, rngByN, setup, testMap } from "./helpers/sim.ts";

type Out = { to: string; msg: ServerMsg }[];
const chat = (out: Out, to: string) =>
  out.flatMap((m) => (m.to === to && m.msg.t === "chat" ? [m.msg.text] : []));
const events = (out: Out, to: string): DeltaEvent[] =>
  out.flatMap((m) => (m.to === to && m.msg.t === "delta" ? m.msg.events : []));

/** Land (G1) west of column 8, sea (W1) from column 8 east. */
const coast = () => testMap("x1000y992", [], (x) => (x >= 8 ? "W1" : "G1"));

/** Puts an Airship-blocking tile (D8) on layer 2 at (x, y). */
function wall(map: WorldMap, x: number, y: number) {
  const row = (map.layers[1][y - 1] ?? "").split(" ");
  row[x - 1] = "D8";
  map.layers[1][y - 1] = row.join(" ");
  map.walkAir = airshipWalkGrid(map.layers[1]);
}

/** Ann aboard a Battleship on (8, 5) with three Cannonballs; Bob and Cat on foot. */
function scene(deed: "Battleship Deed" | "Boat Deed" = "Battleship Deed") {
  const map = coast();
  const rng = rngByN();
  const { world, join, run } = setup([map], undefined, rng);
  const ann = player("Ann", map, 7, 5);
  const bob = player("Bob", map, 4, 5);
  const cat = player("Cat", map, 2, 5);
  for (const p of [ann, bob, cat]) {
    p.flicker = 0;
    p.char.vitals = { ...p.char.vitals, hp: 40, hpMax: 40 };
    join(p);
  }
  const room = world.rooms.get(map.name) as Room;
  const ctx = (): ItemCtx => ({ world, rng, now: 1_000_000 });
  ann.facing = "E";
  ann.char.bag[0] = { item: deed, qty: 1 };
  useIntent(ctx(), room, ann, 1);
  ann.itemPause = 0;
  actionIntent(ctx(), room, ann);
  expect([ann.vehicle, ann.x, ann.y]).toEqual([deed === "Boat Deed" ? "Boat" : "Battleship", 8, 5]);
  ann.char.bag[1] = { item: "Cannonball", qty: 3 };
  ann.facing = "W";
  /** A press of the attack key, released after a tick; the shot appears on the next frame. */
  const fire = () => {
    setAttackHeld(ann, true);
    const out = run(1);
    setAttackHeld(ann, false);
    return [...out, ...run(1)];
  };
  const shots = () => room.fx.filter((f) => f.name.startsWith("CannonballShot"));
  return { map, world, room, ann, bob, cat, run, fire, shots, ctx };
}

const balls = (p: Player) => p.char.bag[1]?.qty ?? 0;

function orc(map: WorldMap, x: number, y: number, name = "Orc"): MonsterSlot {
  const s = map.slots[0] as MonsterSlot;
  s.species ??= name;
  s.live = {
    name,
    hp: species(name)?.hp ?? 1,
    x,
    y,
    facing: "S",
    anim: 0,
    fromX: x,
    fromY: y,
    queue: [],
    hitCountb: 0,
  };
  return s;
}

describe("firing", () => {
  test("bug fixed: the attack key fires a cannonball 48 px out along the facing, spending one", () => {
    const s = scene();
    s.bob.x = 1; // out of the way
    const out = s.fire();
    expect(balls(s.ann)).toBe(2);
    const at = tileLoc(8, 5);
    const fx = events(out, "Bob").find((e) => e.e === "fx");
    expect(fx).toEqual({
      e: "fx",
      slot: 1,
      name: "CannonballShotL",
      h: at.h - 48,
      v: at.v,
      caster: "Ann",
    });
    // The frame that placed it has already counted one off.
    expect(s.ann.cannonReload).toBe(cannonReloadFrames() - 1);
  });

  test("SSO: one shot a press, and none again until the 5 second reload ends", () => {
    const s = scene();
    s.bob.x = 1;
    setAttackHeld(s.ann, true);
    s.run(cannonReloadFrames() + 20);
    expect(balls(s.ann)).toBe(2); // held throughout: one shot
    setAttackHeld(s.ann, false);
    s.ann.cannonReload = 0;
    s.fire();
    expect(balls(s.ann)).toBe(1);
    // A press during the reload fires nothing, even once it is over.
    s.fire();
    s.run(cannonReloadFrames());
    // (the press is still owed a shot, but the key is up)
    expect(balls(s.ann)).toBe(1);
    s.fire();
    expect(balls(s.ann)).toBe(0);
  });

  test("SSO: held through the reload, a press fires when the cannon is loaded", () => {
    const s = scene();
    s.bob.x = 1;
    s.fire();
    setAttackHeld(s.ann, true);
    s.run(cannonReloadFrames() - 2);
    expect(balls(s.ann)).toBe(2);
    s.run(2);
    expect(balls(s.ann)).toBe(1);
  });

  test("SSO: with no Cannonball nothing fires, said once a press", () => {
    const s = scene();
    s.ann.char.bag[1] = null;
    setAttackHeld(s.ann, true);
    const out = s.run(5);
    expect(chat(out, "Ann")).toEqual(["You have no cannonballs!"]);
    expect(s.shots()).toEqual([]);
    expect(s.ann.cannonReload).toBe(0);
  });

  test("a Boat has no cannon", () => {
    const s = scene("Boat Deed");
    const out = s.fire();
    expect(balls(s.ann)).toBe(3);
    expect(events(out, "Bob").filter((e) => e.e === "fx" || e.e === "swing")).toEqual([]);
  });

  test("on a no-fight map the cannon cannot fire", () => {
    const s = scene();
    s.map.flags.canFight = "O";
    const out = s.fire();
    expect(chat(out, "Ann")).toEqual(["You cannot fight here!"]);
    expect(balls(s.ann)).toBe(3);
  });
});

describe("the shot", () => {
  test("SSO: it stops at the first player and takes 14-16 HP off them, armour or not", () => {
    const s = scene();
    s.bob.char.equip.body = "Plate Mail";
    const out = s.fire();
    out.push(...s.run(10));
    // rngByN rolls the top of random(3): 13 + 3.
    expect(s.bob.char.vitals.hp).toBe(40 - 16);
    expect(s.bob.lastToHitMe).toBe("Ann");
    expect(s.bob.lastToHitId).toBe("Ann");
    expect(events(out, "Cat")).toContainEqual({ e: "fxend", slot: 1, name: "CannonballShotL" });
    expect(events(out, "Cat")).toContainEqual({ e: "phit", id: "Bob", text: "16", color: 6 });
    // It went no further: Cat, behind Bob, is untouched.
    s.run(40);
    expect(s.cat.char.vitals.hp).toBe(40);
    expect(s.shots()).toEqual([]);
  });

  test("SSO: aboard, the shot comes off the hull, and running it out sinks the ship", () => {
    const s = scene();
    s.bob.x = 1;
    // Cat sails a boat two tiles east of Ann.
    s.cat.x = 11;
    s.cat.y = 5;
    s.cat.vehicle = "Boat";
    s.cat.spell.body = 55;
    s.cat.hull = 60;
    s.ann.facing = "E";
    s.fire();
    s.run(10);
    expect([s.cat.hull, s.cat.char.vitals.hp]).toEqual([44, 40]);
    s.cat.hull = 10;
    s.cat.flicker = 0;
    s.ann.cannonReload = 0;
    s.fire();
    const out = s.run(60);
    expect(s.cat.vehicle).toBeNull();
    expect(chat(out, "Bob")).toContain(
      "*** Cat's boat was sunk by Ann. Cat was claimed by the waters.",
    );
  });

  test("SSO: where the map's PvP is off it passes over players, even on arena tiles", () => {
    const s = scene();
    s.map.flags.canPvp = "O";
    // Bob stands on an arena tile.
    const row = (s.map.layers[0][4] ?? "").split(" ");
    row[3] = "6P";
    s.map.layers[0][4] = row.join(" ");
    s.fire();
    s.run(60);
    expect([s.bob.char.vitals.hp, s.cat.char.vitals.hp]).toEqual([40, 40]);
  });

  test("SSO: it hits a monster for 14-16, whatever its defense", () => {
    const s = scene();
    s.bob.x = 1;
    s.cat.x = 1;
    s.cat.y = 7;
    const slot = orc(s.map, 5, 5);
    const out = s.fire();
    out.push(...s.run(8));
    expect(slot.live?.hp).toBe((species("Orc")?.hp ?? 1) - 16);
    expect(events(out, "Bob")).toContainEqual(
      expect.objectContaining({ e: "mspell", slot: 1, text: "16", splat: true, kill: false }),
    );
  });

  test("SSO: it hits a monster right beside the ship, short of where the ball appears", () => {
    for (const facing of ["W", "E", "N", "S"] as const) {
      const s = scene();
      s.bob.x = 1;
      s.cat.x = 1;
      s.cat.y = 9;
      const [dx, dy] = FACING_DELTA[facing];
      s.ann.facing = facing;
      // A Slime's picture is narrow: the ball appears beyond it.
      const slot = orc(s.map, 8 + dx, 5 + dy, "Slime");
      const hp = slot.live?.hp ?? 0;
      s.fire();
      s.run(2);
      expect([facing, slot.live?.hp ?? "dead"]).toEqual([facing, hp > 16 ? hp - 16 : "dead"]);
    }
  });

  test("SSO: it does not hit someone in the next row as it passes", () => {
    const s = scene();
    s.bob.y = 4;
    s.cat.y = 6;
    s.fire();
    s.run(60);
    expect([s.bob.char.vitals.hp, s.cat.char.vitals.hp]).toEqual([40, 40]);
  });

  test("SSO: it stops at a tile an Airship cannot cross", () => {
    const s = scene();
    wall(s.map, 5, 5);
    s.bob.x = 3;
    s.fire();
    s.run(30);
    expect(s.bob.char.vitals.hp).toBe(40);
    expect(s.shots()).toEqual([]);
  });

  test("SSO: such a tile right beside the ship stops the shot as it is fired", () => {
    const s = scene();
    wall(s.map, 7, 5);
    const out = s.fire();
    expect(balls(s.ann)).toBe(2);
    expect(events(out, "Bob").map((e) => e.e)).toEqual(expect.arrayContaining(["fx", "fxend"]));
    expect(s.shots()).toEqual([]);
  });

  test("SSO: it stops at a parked vehicle, which it leaves unharmed", () => {
    const s = scene();
    s.bob.x = 1;
    s.cat.x = 1;
    s.cat.y = 7;
    s.ann.facing = "E";
    s.map.ground.push({
      id: "g1",
      item: "Cat's Boat",
      x: 12,
      y: 5,
      kind: "drop",
      expiresAt: null,
      ownerId: "Cat",
      hull: 30,
    });
    const out = s.fire();
    out.push(...s.run(20));
    expect(events(out, "Bob")).toContainEqual({ e: "fxend", slot: 1, name: "CannonballShotR" });
    expect(s.map.ground.find((g) => g.id === "g1")?.hull).toBe(30);
  });

  test("SSO: over open water it flies to the edge of the map", () => {
    const s = scene();
    s.ann.facing = "E";
    s.fire();
    s.run(4);
    expect(s.shots().length).toBe(1);
    s.run(30);
    expect(s.shots()).toEqual([]);
  });
});
