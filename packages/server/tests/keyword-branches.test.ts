/**
 * Server branches of name-based mechanics and skill gain that no other test reached (issue #37's
 * coverage baseline): the skill-gain line of a melee kill, a crossbow shot training Martial Arts,
 * the Fire Staff's free fireball by Staff Fighting, Firesword's `sword` behaviour, and the player
 * effects the spell collision picks by FX name.
 */
import { describe, expect, test } from "bun:test";

import { type ServerMsg, skillIndex, tileLoc } from "@secondstaronline/shared";

import { pollAttack, setAttackHeld } from "../src/systems/combat/melee.ts";
import { castIntent, freeFireballs, swingFireballs } from "../src/systems/spells/cast.ts";
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
  return { map, world, rng, add, room, run };
}

const tickOnce = (s: ReturnType<typeof scene>) => s.run(1);

/** Ann at (5, 5) facing east, `weapon` in hand, every skill 0, a `name` with `hp` at (6, 5). */
function facingMonster(weapon: string, name: string, hp: number, queues = {}) {
  const s = scene(queues);
  const a = s.add("Ann", 5, 5);
  a.facing = "E";
  a.timers.canAttack = true;
  a.char.skills = Array(a.char.skills.length).fill(0);
  a.char.equip = { ...a.char.equip, weapon };
  const slot = s.map.slots[0];
  if (!slot) {
    throw new Error("no monster slot");
  }
  slot.species = name;
  slot.live = {
    name,
    hp,
    x: 6,
    y: 5,
    facing: "W",
    anim: 0,
    fromX: 6,
    fromY: 5,
    queue: [],
    hitCountb: 0,
  };
  return { s, a, slot };
}

describe("a melee kill's skill gain", () => {
  test("a kill with a Long Sword rolls Slash and says so", () => {
    // Slash 10 and Wisdom 10: the roll is random(10 + wisdomBonus), Classic's 1.6 WisAdd (25 at
    // Wisdom 6-10); a 1 gains.
    const n = 10 + 25;
    const { s, a } = facingMonster("Long Sword", "Slime", 1, { [n]: [1] });
    a.char.stats.str = 500;
    a.char.skills[skillIndex("Slash")] = 10;
    setAttackHeld(a, true);
    const ev = pollAttack(s.room(), a, { rng: s.rng, now: 0, world: s.world });
    expect(a.char.skills[skillIndex("Slash")]).toBe(11);
    expect(ev.lines).toContain("You have advanced in the art of Slash!");
  });
});

describe("arrow shots", () => {
  test("a crossbow shot trains Martial Arts as well as Archery", () => {
    const { s, a } = facingMonster("Crossbow", "Overlord", 1000, { 7: [1], 9: [1] });
    a.char.equip.offHand = "Blue Arrows";
    a.char.bag[0] = { item: "Blue Crystal", qty: 5 };
    a.char.skills[skillIndex("Archery")] = 9;
    a.char.skills[skillIndex("MartialArts")] = 7;
    setAttackHeld(a, true);
    const ev = pollAttack(s.room(), a, { rng: s.rng, now: 0, world: s.world });
    expect(a.char.skills[skillIndex("Archery")]).toBe(10);
    expect(a.char.skills[skillIndex("MartialArts")]).toBe(8);
    expect(ev.lines).toEqual(
      expect.arrayContaining([
        "You have advanced in the art of Archery!",
        "You have advanced in the art of Martial Arts!",
      ]),
    );
  });

  test("a bow shot trains Archery alone", () => {
    const { s, a } = facingMonster("Wooden Bow", "Overlord", 1000, { 7: [1], 9: [1] });
    a.char.equip.offHand = "Blue Arrows";
    a.char.bag[0] = { item: "Blue Crystal", qty: 5 };
    a.char.skills[skillIndex("Archery")] = 9;
    a.char.skills[skillIndex("MartialArts")] = 7;
    setAttackHeld(a, true);
    const ev = pollAttack(s.room(), a, { rng: s.rng, now: 0, world: s.world });
    expect(s.room().fxQueue.map((c) => c.name)).toContain("Blue ArrowsR");
    expect(a.char.skills[skillIndex("Archery")]).toBe(10);
    expect(a.char.skills[skillIndex("MartialArts")]).toBe(7);
    expect(ev.lines).toEqual(["You have advanced in the art of Archery!"]);
  });
});

describe("free fireballs", () => {
  /** The power of the Fire Staff's fireball at a Staff Fighting value (every draw at its top). */
  function staffPower(staff: number): number | undefined {
    const s = scene();
    const a = s.add("Ann", 5, 5);
    a.char.equip.weapon = "Fire Staff";
    a.char.skills[skillIndex("StaffFighting")] = staff;
    swingFireballs(s.room(), a, { rng: s.rng });
    return s.room().fxQueue[0]?.power;
  }

  test("the Fire Staff's power is 1 + random(3), plus 1, 2, 3 and 5 past 20, 40, 80 and 99", () => {
    expect(staffPower(10)).toBe(4);
    expect(staffPower(21)).toBe(5);
    expect(staffPower(41)).toBe(7);
    expect(staffPower(81)).toBe(10);
    expect(staffPower(100)).toBe(15);
  });

  test("bug fixed: Firesword fires from Classic's swords, not a Swordfish", () => {
    expect(freeFireballs("Long Sword", true)).toEqual({ staff: false, sword: true });
    expect(freeFireballs("Knight's Sword +1", true)).toEqual({ staff: false, sword: true });
    expect(freeFireballs("Damaged Sword, Long", true)).toEqual({ staff: false, sword: true });
    expect(freeFireballs("Swordfish", true)).toEqual({ staff: false, sword: false });
    expect(freeFireballs("Long Sword", false)).toEqual({ staff: false, sword: false });
    expect(freeFireballs("Fire Staff", false)).toEqual({ staff: true, sword: false });
    const s = scene();
    const a = s.add("Ann", 5, 5);
    a.char.equip.weapon = "Swordfish";
    a.spell.fireSword = 10;
    swingFireballs(s.room(), a, { rng: s.rng });
    expect(s.room().fxQueue).toEqual([]);
    a.char.equip.weapon = "Long Sword";
    swingFireballs(s.room(), a, { rng: s.rng });
    expect(s.room().fxQueue.map((c) => c.power)).toEqual([7]);
  });
});

describe("spell effects on a player, by FX name", () => {
  /** Ann (6, 6) casts `spell` on Bob (9, 6), who holds `weapon`; 20 ticks run. */
  function castOnBob(spell: string, weapon = "Long Sword") {
    const s = scene();
    const a = s.add("Ann", 6, 6);
    const b = s.add("Bob", 9, 6);
    for (const p of [a, b]) {
      p.char.vitals = { ...p.char.vitals, sp: 200, spMax: 200, hp: 20, hpMax: 40 };
      p.char.equip.weapon = weapon;
    }
    b.char.hunger = 1000;
    b.spell.body = 57;
    a.spell.book = [spell];
    ["Blue", "Purple", "White", "Green", "Yellow", "Red"].forEach((c, i) => {
      a.char.bag[3 + i] = { item: `${c} Crystal`, qty: 50 };
    });
    const t = tileLoc(9, 6);
    const out: { to: string; msg: ServerMsg }[] = [
      ...castIntent(s.room(), a, spell, t.h, t.v, { rng: s.rng }).out,
    ];
    for (let i = 0; i < 20; i++) {
      out.push(...tickOnce(s));
    }
    const chat = (to: string) =>
      out.flatMap((m) => (m.to === to && m.msg.t === "chat" ? [m.msg.text] : []));
    return { a, b, ann: chat("Ann"), bob: chat("Bob") };
  }

  test("Diminish Hunger adds 3000 hunger below 35000", () => {
    const r = castOnBob("Diminish Hunger");
    expect(r.bob).toEqual(["Your hunger has diminished."]);
    expect(r.b.char.hunger).toBe(4000);
    // One line for every gain (#37 stage 6): 1.6 wrote this one "blessing".
    expect(r.ann).toContain("You have advanced in the art of Blessing!");
  });

  test("Nature Shift, Smoke Bomb and Dispel Illusions set and clear the body", () => {
    expect(castOnBob("Nature Shift").b.spell.body).toBe(80);
    const smoke = castOnBob("Smoke Bomb");
    expect([smoke.b.spell.body, smoke.b.spell.smokeBomb]).toEqual([100, 7]);
    expect(smoke.ann).toContain("You have advanced in the art of Martial Arts!");
    const dispel = castOnBob("Dispel Illusions");
    expect(dispel.b.spell.body).toBeNull();
    expect(dispel.ann).toContain("You have advanced in the art of Wizardry!");
  });

  test("bug fixed: Firesword lights Classic's swords, not a Swordfish", () => {
    const r = castOnBob("Firesword", "Long Sword");
    expect(r.bob).toEqual(["Your sword burns with a fiery fury."]);
    expect(r.b.spell.fireSword).toBe(101);
    for (const weapon of ["Axe", "Swordfish"]) {
      const other = castOnBob("Firesword", weapon);
      expect(other.bob).toEqual([
        "You feel a warmth you haven't felt before, but feel it has not assisted you.",
      ]);
      expect(other.b.spell.fireSword).toBe(0);
    }
  });

  test("Stone Skin, Argon's Fist, Inxition, Create Food and Radar", () => {
    const stone = castOnBob("Stone Skin");
    expect([stone.bob, stone.b.defenseBonus]).toEqual([["You suddenly feel much stronger."], 1]);
    expect(castOnBob("Argon's Fist").bob).toEqual(["The power of argon flows through your body."]);
    expect(castOnBob("Inxition").bob).toEqual(["Bob will become more powerful very soon."]);
    const food = castOnBob("Create Food");
    expect(food.bob).toEqual(["Suddenly, Ale appears in your inventory."]);
    expect(food.b.char.bag.filter((l) => l !== null)).toEqual([{ item: "Ale", qty: 1 }]);
    expect(castOnBob("Radar").bob).toEqual(["*** Bob has 200 Spell Points."]);
  });
});
