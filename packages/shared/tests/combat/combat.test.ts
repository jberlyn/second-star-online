import { describe, expect, test } from "bun:test";

import { classesData } from "@secondstaronline/data";

import { STEPFRAMES_PER_FRAME } from "../../src/constants.ts";
import { attackPower, evalValue } from "../../src/rules/combat/attpower.ts";
import {
  type AttackTimers,
  meleeDamageVsMonster,
  meleeReaches,
  monsterHitsPlayer,
  monsterReaches,
  newAttackTimers,
  startSwing,
  swingBlocked,
  swingCooldowns,
  tickAttackTimers,
  tickSpriteTimers,
} from "../../src/rules/combat/combat.ts";
import {
  type Equipment,
  type Fighter,
  NO_EQUIPMENT,
  NO_FACTION,
  skillIndex,
} from "../../src/rules/core/fighter.ts";
import type { Rng } from "../../src/rules/core/lingo.ts";

/** A random source with fixed results, repeating the last one when exhausted. */
function scripted(results: readonly number[]): Rng & { calls: number[] } {
  let i = 0;
  const calls: number[] = [];
  return {
    calls,
    random(n) {
      calls.push(n);
      const r = results[Math.min(i, results.length - 1)] ?? 0;
      i += 1;
      return n >= 1 ? Math.min(r, n) : 0;
    },
  };
}
const maxRng: Rng = { random: (n) => (n >= 1 ? n : 0) };
const minRng: Rng = { random: (n) => (n >= 1 ? 1 : 0) };

function fighter(over: Partial<Fighter> = {}, cls: 1 | 2 | 3 = 1): Fighter {
  return {
    level: 1,
    str: 1,
    sta: 1,
    int: 1,
    wis: 1,
    spd: 1,
    skills: [...classesData.creation.startingSkills[cls].values],
    equip: { ...NO_EQUIPMENT },
    faction: { ...NO_FACTION },
    attackBonus: 0,
    wanted: false,
    ...over,
  };
}

/** Frames between swings while the key is held, from frame 0 (one swing in the loop). */
function heldCadence(equip: Equipment, skills: number[]): number[] {
  const t: AttackTimers = newAttackTimers();
  const fired: number[] = [];
  for (let frame = 0; frame < 200; frame++) {
    // Sprite 112 before the frame script, two `stepFrame` calls a frame.
    for (let call = 0; call < STEPFRAMES_PER_FRAME; call++) {
      tickSpriteTimers(t);
    }
    tickAttackTimers(t);
    if (t.canAttack && !swingBlocked(t)) {
      startSwing(t, equip, skills);
      t.canAttack = false;
      fired.push(frame);
    }
  }
  return fired.slice(1, 5).map((f, i) => f - (fired[i] as number));
}

describe("attack cadence", () => {
  const skills = fighter().skills;
  test("kept bug: holding attack swings every AtDelay + 1 = 15 frames", () => {
    expect(heldCadence(NO_EQUIPMENT, skills)).toEqual([15, 15, 15, 15]);
  });
  test("Ring of Quickness: 11 frames", () => {
    expect(heldCadence({ ...NO_EQUIPMENT, ring: "Ring of Quickness" }, skills)).toEqual([
      11, 11, 11, 11,
    ]);
  });
  test("kept bug: axe cascade gives AtDelay 15 below AxeFighting 90, so 16 frames", () => {
    expect(heldCadence({ ...NO_EQUIPMENT, weapon: "Axe" }, skills)).toEqual([16, 16, 16, 16]);
  });
  test("kept bug: fishing pole ignores the Ring of Quickness, 21 frames", () => {
    expect(
      heldCadence({ ...NO_EQUIPMENT, weapon: "Fishing Pole", ring: "Ring of Quickness" }, skills),
    ).toEqual([21, 21, 21, 21]);
  });
  test("held Mining Hammer swings every 8 frames: ActionDelay 14 calls = 7 frames under AtDelay 7", () => {
    expect(heldCadence({ ...NO_EQUIPMENT, weapon: "Mining Hammer" }, skills)).toEqual([8, 8, 8, 8]);
  });
});

describe("power bar", () => {
  function bonusAfterWait(waitFrames: number): number {
    const t = newAttackTimers();
    startSwing(t, NO_EQUIPMENT, fighter().skills);
    for (let i = 0; i < waitFrames; i++) {
      tickSpriteTimers(t);
      tickAttackTimers(t);
    }
    return startSwing(t, NO_EQUIPMENT, fighter().skills);
  }
  test("kept bug: tiers come from the member windows: +0 until t+39, +3, +5 from t+64, +7 from t+89", () => {
    expect(bonusAfterWait(15)).toBe(0);
    expect(bonusAfterWait(38)).toBe(0);
    expect(bonusAfterWait(39)).toBe(3);
    expect(bonusAfterWait(63)).toBe(3);
    expect(bonusAfterWait(64)).toBe(5);
    expect(bonusAfterWait(89)).toBe(7);
    expect(bonusAfterWait(400)).toBe(7);
  });
  test("the bar value resets on a swing, its member does not", () => {
    const t = newAttackTimers();
    t.bar = 80;
    t.barMember = 475;
    expect(startSwing(t, NO_EQUIPMENT, fighter().skills)).toBe(7);
    expect(t.bar).toBe(0);
    expect(t.barMember).toBe(475);
  });
});

describe("AttPower", () => {
  test("bare hands: 1 + STR tiers + Thrust > 0", () => {
    expect(attackPower(fighter({ str: 1 }), minRng).power).toBe(2);
    expect(attackPower(fighter({ str: 6 }), minRng).power).toBe(3);
    expect(attackPower(fighter({ str: 20 }), minRng).power).toBe(6);
  });
  test("Knife: 2 + random(3), Slash > 5 and > 10 blocks", () => {
    const f = fighter({ str: 1, equip: { ...NO_EQUIPMENT, weapon: "Knife" } });
    // Fighter: Slash 20, Thrust 20.
    expect(attackPower(f, minRng).power).toBe(2 + 1 + 2 + 1);
    expect(attackPower(f, maxRng).power).toBe(2 + 3 + 2 + 1);
  });
  test("every row value form evaluates", () => {
    expect(evalValue(3, minRng)).toBe(3);
    expect(evalValue("random(4)", maxRng)).toBe(4);
    expect(evalValue("2 + random(3)", maxRng)).toBe(5);
  });
  test("bow without arrows melees for 1", () => {
    const f = fighter({ str: 20, equip: { ...NO_EQUIPMENT, weapon: "Wooden Bow" } });
    expect(attackPower(f, minRng)).toEqual({ power: 1, outOfCrystals: null, crystal: null });
  });
  test("bow with arrows and no crystal wastes the swing", () => {
    const f = fighter({
      equip: { ...NO_EQUIPMENT, weapon: "Wooden Bow", offHand: "Blue Arrows" },
    });
    expect(attackPower(f, minRng).outOfCrystals).toBe("You don't have any blue crystals left!");
    expect(attackPower(f, minRng, () => true).crystal).toBe("Blue");
  });
});

describe("AttPower string-matching quirks", () => {
  /** A fighter with every skill 0 except `set`, holding `weapon` (and `offHand`). */
  const armed = (weapon: string, set: Record<string, number> = {}, offHand = "NOTHING") => {
    const skills = Array(38).fill(0) as number[];
    for (const [k, v] of Object.entries(set)) {
      skills[skillIndex(k)] = v;
    }
    return fighter({ skills, equip: { ...NO_EQUIPMENT, weapon, offHand } });
  };
  test('kept bug: "Bo" matches books and bows: a book rolls the Bo row 5 + random(8)', () => {
    const rng = scripted([1]);
    expect(attackPower(armed("Book of Fire"), rng).power).toBe(6);
    expect(rng.calls).toEqual([8]);
    const bow = scripted([1]);
    attackPower(armed("Wooden Bow", {}, "Blue Arrows"), bow, () => true);
    expect(bow.calls[0]).toBe(8);
  });
  test('kept bug: the "Minng Hammer" typo: a Mining Hammer gets no base row and stays at 1', () => {
    const rng = scripted([1]);
    expect(attackPower(armed("Mining Hammer"), rng).power).toBe(1);
    expect(rng.calls).toEqual([]);
    expect(attackPower(armed("Minng Hammer"), scripted([1])).power).toBe(3);
  });
  test("kept bug: Archery < 30 resets the bow's power, and Archery = 30 gets no tier at all", () => {
    const shot = (archery: number) =>
      attackPower(
        armed("Wooden Bow", { Archery: archery }, "Blue Arrows"),
        scripted([1]),
        () => true,
      ).power;
    // Below 10 all three resets run, the last (3 + random(4)) winning; 29 still resets.
    expect(shot(5)).toBe(4);
    expect(shot(29)).toBe(4);
    // 30 is neither < 30 nor > 30: the bow keeps what it had, less than at 29.
    expect(shot(30)).toBe(2);
    expect(shot(31)).toBe(3);
  });
  test("kept bug: Gold Sword's HeavyArms block runs twice: +11 at HeavyArms 100", () => {
    const at = (heavy: number) =>
      attackPower(armed("Gold Sword", { HeavyArms: heavy }), scripted([1])).power;
    expect(at(100) - at(0)).toBe(5 + 6);
    // HeavyArms 65: > 10, > 20 in the first block; > 10, > 20, > 60 in the second.
    expect(at(65) - at(0)).toBe(2 + 3);
  });
});

describe("melee vs monsters", () => {
  const slime = { name: "Slime", defense: 2 };
  test("damage = AttPower − Defense", () => {
    expect(meleeDamageVsMonster(6, slime, "NOTHING", minRng)).toBe(4);
  });
  test("below 1 becomes random(3)", () => {
    expect(meleeDamageVsMonster(2, slime, "NOTHING", maxRng)).toBe(3);
  });
  test("affinity rows: Sword +2 vs Slime", () => {
    expect(meleeDamageVsMonster(6, slime, "Short Sword", minRng)).toBe(6);
  });
  test("own tile and faced tile reach; the side does not", () => {
    const me = { x: 5, y: 5, facing: "E" as const };
    expect(meleeReaches(me, { x: 5, y: 5, footprint: false })).toBe(true);
    expect(meleeReaches(me, { x: 6, y: 5, footprint: false })).toBe(true);
    expect(meleeReaches(me, { x: 5, y: 6, footprint: false })).toBe(false);
  });
  test("kept bug: the 3x2 footprint is tested only on the faced tile", () => {
    // Overlord anchored at (4,6): its (5,5) cell is my own tile, which the footprint misses.
    expect(meleeReaches({ x: 5, y: 5, facing: "N" }, { x: 4, y: 6, footprint: true })).toBe(false);
    // Facing east, the faced tile (6,5) is the (+2,−1) cell.
    expect(meleeReaches({ x: 5, y: 5, facing: "E" }, { x: 4, y: 6, footprint: true })).toBe(true);
  });
});

describe("monsters hitting players", () => {
  test("CFMH: my tile or orthogonally next to it", () => {
    expect(monsterReaches({ x: 5, y: 5, footprint: false }, { x: 5, y: 5 })).toBe(true);
    expect(monsterReaches({ x: 6, y: 5, footprint: false }, { x: 5, y: 5 })).toBe(true);
    expect(monsterReaches({ x: 6, y: 6, footprint: false }, { x: 5, y: 5 })).toBe(false);
  });
  test("Slime hit: attack 1 + random(3), below 2 re-rolled as random(3)", () => {
    // random(3) = 1 → 2; then parry random(3000) = 2, block random(3000) = 2.
    expect(monsterHitsPlayer(1, fighter(), 0, scripted([1, 2, 2]))).toEqual({
      kind: "hit",
      lost: 2,
    });
  });
  test("kept bug: parry and block are random(3000) until the skill is over 10", () => {
    const rng = scripted([3, 1]);
    expect(monsterHitsPlayer(1, fighter(), 0, rng)).toEqual({ kind: "parry" });
    expect(rng.calls).toEqual([3, 3000]);
  });
  test("kept bug: negative DefenseBonus also reduces damage", () => {
    expect(monsterHitsPlayer(35, fighter(), -5, scripted([3, 2, 2]))).toMatchObject({ lost: 33 });
  });
});

describe("swing cooldowns by worn item", () => {
  test("Ring of Quickness sets 10/10 before the axe cascade", () => {
    const sk = Array(38).fill(0) as number[];
    const wear = (e: Partial<Equipment>) => ({ ...NO_EQUIPMENT, ...e });
    expect(swingCooldowns(wear({}), sk)).toEqual({ atDelay: 14, actionDelay: 14 });
    expect(swingCooldowns(wear({ ring: "Ring of Quickness" }), sk)).toEqual({
      atDelay: 10,
      actionDelay: 10,
    });
    // The axe cascade comes after: at Axe Fighting 0 the last true `<` row sets 15, and the
    // action delay stays 10.
    expect(swingCooldowns(wear({ ring: "ring of quickness", weapon: "Axe" }), sk)).toEqual({
      atDelay: 15,
      actionDelay: 10,
    });
  });
});
