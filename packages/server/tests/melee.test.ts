/**
 * The player's swing on the server sim: the attack poll and its latch, Hold, and PvP's victim
 * test and skill gains.
 */
import { describe, expect, test } from "bun:test";

import { skillIndex } from "@secondstaronline/shared";

import {
  ATTACK_LATCH_TICKS,
  pollAttack,
  setAttackHeld,
  swingSound,
} from "../src/systems/combat/melee.ts";
import type { Player, Room } from "../src/systems/world/world.ts";
import { player, rngByN, setup, testMap } from "./helpers/sim.ts";

function scene(queues: Record<number, number[]> = {}) {
  const map = testMap("x1000y992");
  const rng = rngByN(queues);
  const { world, join, run } = setup([map], undefined, rng);
  const add = (id: string, x: number, y: number): Player => {
    const p = player(id, map, x, y);
    p.flicker = 0;
    join(p);
    return p;
  };
  const room = () => world.rooms.get(map.name) as Room;
  const poll = (p: Player) => pollAttack(room(), p, { rng, now: 0, world });
  return { map, world, rng, add, room, poll, run };
}

describe("the attack poll", () => {
  test(`SSO: a tap is latched for ${ATTACK_LATCH_TICKS} ticks: it swings if the attack re-arms by then`, () => {
    const s = scene();
    const a = s.add("Ann", 5, 5);
    a.timers.canAttack = false;
    // A tap: press and release before the next tick.
    setAttackHeld(a, true);
    setAttackHeld(a, false);
    expect(s.poll(a).swing).toBeNull();
    expect(s.poll(a).swing).toBeNull();
    a.timers.canAttack = true;
    expect(s.poll(a).swing).not.toBeNull();
  });

  test("SSO: a tap older than the latch is lost, as 1.6's keyPressed poll lost it", () => {
    const s = scene();
    const a = s.add("Ann", 5, 5);
    a.timers.canAttack = false;
    setAttackHeld(a, true);
    setAttackHeld(a, false);
    for (let i = 0; i <= ATTACK_LATCH_TICKS; i++) {
      expect(s.poll(a).swing).toBeNull();
    }
    a.timers.canAttack = true;
    expect(s.poll(a).swing).toBeNull();
    // A held key swings whenever the attack is armed.
    setAttackHeld(a, true);
    expect(s.poll(a).swing).not.toBeNull();
  });

  test("bug fixed: Hold stops attacking as well as walking", () => {
    const s = scene();
    const a = s.add("Ann", 5, 5);
    a.spell.hold = 100;
    a.held = "R";
    s.run(2);
    expect([a.x, a.y]).toEqual([5, 5]);
    setAttackHeld(a, true);
    const swingsIn = (out: ReturnType<typeof s.run>) =>
      out.flatMap((o) =>
        o.to === "Ann" && o.msg.t === "delta" ? o.msg.events.filter((e) => e.e === "swing") : [],
      );
    expect(swingsIn(s.run(1))).toHaveLength(0);
    expect(a.timers.atDelay).toBe(0);
    // When the Hold runs out the held key swings.
    a.spell.hold = 0;
    expect(swingsIn(s.run(1))).toHaveLength(1);
  });

  test("bug fixed: a bow with no arrows is refused once per press, with no cooldown", () => {
    const s = scene();
    const a = s.add("Ann", 5, 5);
    a.char.equip.weapon = "Wooden Bow";
    a.char.equip.offHand = "NOTHING";
    a.timers.canAttack = true;
    setAttackHeld(a, true);
    const lines: string[] = [];
    for (let i = 0; i < 5; i++) {
      const ev = s.poll(a);
      expect(ev.swing).toBeNull();
      lines.push(...ev.lines);
    }
    expect(lines).toEqual(["You don't have any arrows!"]);
    expect([a.timers.atDelay, a.timers.actionDelay, a.timers.canAttack]).toEqual([0, 0, true]);
    // A new press says it again.
    setAttackHeld(a, false);
    setAttackHeld(a, true);
    expect(s.poll(a).lines).toEqual(["You don't have any arrows!"]);
  });

  test("bug fixed: a bow with arrows but no crystal is refused before the swing, keeping the bar", () => {
    const s = scene();
    const a = s.add("Ann", 5, 5);
    a.char.equip.weapon = "Wooden Bow";
    a.char.equip.offHand = "Red Arrows";
    a.timers.canAttack = true;
    a.timers.bar = 80;
    a.timers.barMember = 475;
    setAttackHeld(a, true);
    const ev = s.poll(a);
    expect(ev.swing).toBeNull();
    expect(ev.lines).toEqual(["You don't have any red crystals left!"]);
    expect([a.timers.bar, a.timers.barMember, a.timers.atDelay]).toEqual([80, 475, 0]);
  });
});

describe("PvP melee", () => {
  test("bug fixed: a victim part-way through a step is hit on the tile it is leaving", () => {
    const s = scene();
    const a = s.add("Ann", 4, 6); // faces north: the faced tile is (4, 5)
    const b = s.add("Bob", 5, 5);
    b.char.skills = Array(38).fill(0);
    // Bob is mid-step east from (4, 5), the faced tile.
    b.facing = "E";
    b.stepFrames = 8;
    a.timers.canAttack = true;
    setAttackHeld(a, true);
    expect(s.poll(a).pvp.map((h) => h.victim.name)).toEqual(["Bob"]);
    expect(b.lastToHitMe).toBe("Ann");
  });

  test("bug fixed: a swing at (4,4) no longer hits a victim stepping from (9,4)", () => {
    const s = scene();
    const a = s.add("Ann", 4, 5); // faces north: the faced tile is (4, 4)
    const b = s.add("Bob", 9, 5);
    b.char.skills = Array(38).fill(0);
    // Bob is mid-step south from (9, 4), nowhere near the faced tile.
    b.facing = "S";
    b.stepFrames = 8;
    a.timers.canAttack = true;
    setAttackHeld(a, true);
    expect(s.poll(a).pvp).toEqual([]);
  });

  test('a PvP block can raise Block: "You have advanced in the art of Block!" at Parry > 50', () => {
    // Parry 55: random(90) ×3, 85, 80, 70, then random(60) = 2, no parry. Block 5: the base
    // random(90), then random(90) = 1, a block. The skill-gain roll: random(5) = 1.
    const s = scene({ 90: [9, 9, 9, 9, 1], 60: [2], 5: [1] });
    const a = s.add("Ann", 5, 5);
    const b = s.add("Bob", 5, 4);
    b.char.skills = Array(38).fill(0);
    b.char.skills[skillIndex("Parry")] = 55;
    b.char.skills[skillIndex("Block")] = 5;
    a.timers.canAttack = true;
    setAttackHeld(a, true);
    const ev = s.poll(a);
    expect(ev.pvp.map((h) => [h.text, h.lines])).toEqual([
      ["Block", ["You have advanced in the art of Block!"]],
    ]);
    expect(b.char.skills[skillIndex("Block")]).toBe(6);
  });
});

describe("the hit's i-frames", () => {
  test("a melee hit starts the victim's i-frames; no sprite is hidden on anyone's screen", () => {
    const s = scene();
    const a = s.add("Ann", 5, 5);
    const b = s.add("Bob", 5, 4);
    b.char.skills = Array(38).fill(0);
    a.timers.canAttack = true;
    setAttackHeld(a, true);
    // The key poll runs between the tick's two actor passes (tick.ts), so one counter call is
    // left this tick, then two a tick: 40 calls run out in 20 more ticks.
    const out = [...s.run(1)];
    setAttackHeld(a, false);
    expect(b.flicker).toBe(39);
    for (let i = 0; i < 19; i++) {
      out.push(...s.run(1));
    }
    expect(b.flicker).toBe(1);
    out.push(...s.run(1));
    expect(b.flicker).toBe(0);
    const selves = out.flatMap((o) => (o.msg.t === "you" ? [o.msg.self] : []));
    expect(selves.every((y) => !("hidden" in y))).toBe(true);
  });
});

describe("the swing sound", () => {
  test("swing sounds: none for Watering Bucket, Hoe and Fishing Pole, LaserSword for a laser sword", () => {
    for (const w of ["Watering Bucket", "hoe", "Fishing Pole"]) {
      expect(swingSound(w)).toBeNull();
    }
    expect(swingSound("Red Laser Sword")).toBe("LaserSword");
    expect(swingSound("Long Sword")).toBe("swordswing");
    expect(swingSound("NOTHING")).toBe("swordswing");
  });

  test("an Overlord kill is broadcast to everyone", () => {
    const s = scene();
    const a = s.add("Ann", 5, 5);
    a.facing = "E";
    a.timers.canAttack = true;
    a.char.stats.str = 500;
    const slot = s.map.slots[0];
    if (slot) {
      slot.live = {
        name: "Overlord",
        hp: 0,
        x: 6,
        y: 5,
        facing: "W",
        anim: 0,
        fromX: 6,
        fromY: 5,
        queue: [],
        hitCountb: 0,
      };
    }
    setAttackHeld(a, true);
    const ev = s.poll(a);
    expect(ev.broadcast).toBe("*** ** * All hail Ann who has rid the world of an evil overlord!");
  });
});

describe("bow shots", () => {
  /** Ann facing an Overlord at (6, 5) with 1000 HP, holding a bow and `offHand`. */
  function archer(offHand: string) {
    const s = scene();
    const a = s.add("Ann", 5, 5);
    a.facing = "E";
    a.timers.canAttack = true;
    a.char.equip = { ...a.char.equip, weapon: "Wooden Bow", offHand };
    a.char.bag[0] = { item: "Blue Crystals", qty: 5 };
    const slot = s.map.slots[0];
    if (!slot) {
      throw new Error("no monster slot");
    }
    slot.live = {
      name: "Overlord",
      hp: 1000,
      x: 6,
      y: 5,
      facing: "W",
      anim: 0,
      fromX: 6,
      fromY: 5,
      queue: [],
      hitCountb: 0,
    };
    setAttackHeld(a, true);
    s.poll(a);
    return { a, s, hp: slot.live?.hp, fx: s.room().fxQueue.map((c) => c.name) };
  }

  test("a bow with Blue Arrows and a crystal shoots an arrow and spends the crystal, hitting nothing in melee", () => {
    const { a, hp, fx } = archer("Blue Arrows");
    expect(fx).toContain("Blue ArrowsR");
    expect(a.char.bag[0]).toMatchObject({ item: "Blue Crystals", qty: 4 });
    expect(hp).toBe(1000);
  });

  test('an off-hand that only contains "Arrows" counts as no arrows: refused, no melee, no crystal', () => {
    const { a, hp, fx } = archer("Rusty Arrows");
    expect(fx.some((n) => n.includes("Arrows"))).toBe(false);
    expect(a.char.bag[0]).toMatchObject({ item: "Blue Crystals", qty: 5 });
    expect(hp).toBe(1000);
    expect(a.timers.atDelay).toBe(0);
  });
});
