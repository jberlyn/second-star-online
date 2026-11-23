import { describe, expect, test } from "bun:test";

import { classicData } from "@secondstaronline/data/classic";

const { classes: classesData } = classicData;

import { STEPFRAMES_PER_FRAME } from "../../src/constants.ts";
import { factionRows } from "../../src/rules/combat/armour.ts";
import { attackPower, bowRefusal, evalValue } from "../../src/rules/combat/attpower.ts";
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
  const withSkill = (skill: string, value: number) => {
    const s = [...skills];
    s[skillIndex(skill)] = value;
    return s;
  };
  test("bug fixed: holding attack swings every AtDelay = 14 frames, not 15", () => {
    expect(heldCadence(NO_EQUIPMENT, skills)).toEqual([14, 14, 14, 14]);
  });
  test("Ring of Quickness: 10 frames", () => {
    expect(heldCadence({ ...NO_EQUIPMENT, ring: "Ring of Quickness" }, skills)).toEqual([
      10, 10, 10, 10,
    ]);
  });
  test("bug fixed: the axe ladder slows low Axe Fighting, 25 frames at 0 down to 15 at 80-89", () => {
    const axe = { ...NO_EQUIPMENT, weapon: "Axe" };
    expect(heldCadence(axe, withSkill("AxeFighting", 0))).toEqual([25, 25, 25, 25]);
    expect(heldCadence(axe, withSkill("AxeFighting", 15))).toEqual([22, 22, 22, 22]);
    expect(heldCadence(axe, withSkill("AxeFighting", 55))).toEqual([18, 18, 18, 18]);
    expect(heldCadence(axe, withSkill("AxeFighting", 89))).toEqual([15, 15, 15, 15]);
    expect(heldCadence(axe, withSkill("AxeFighting", 90))).toEqual([14, 14, 14, 14]);
  });
  test("bug fixed: the Ring of Quickness shortens a fishing pole's 20 frames to 16", () => {
    expect(heldCadence({ ...NO_EQUIPMENT, weapon: "Fishing Pole" }, skills)).toEqual([
      20, 20, 20, 20,
    ]);
    expect(
      heldCadence({ ...NO_EQUIPMENT, weapon: "Fishing Pole", ring: "Ring of Quickness" }, skills),
    ).toEqual([16, 16, 16, 16]);
  });
  test("bug fixed: a Mining Hammer speeds up with Mining, 15 frames at 0 down to 7 from 80", () => {
    const hammer = { ...NO_EQUIPMENT, weapon: "Mining Hammer" };
    expect(heldCadence(hammer, withSkill("Mining", 0))).toEqual([15, 15, 15, 15]);
    expect(heldCadence(hammer, withSkill("Mining", 25))).toEqual([13, 13, 13, 13]);
    // AtDelay 9 at 60-69; the action delay (14 step calls, 7 frames) does not bind.
    expect(heldCadence(hammer, withSkill("Mining", 65))).toEqual([9, 9, 9, 9]);
    expect(heldCadence(hammer, withSkill("Mining", 85))).toEqual([7, 7, 7, 7]);
    expect(heldCadence(hammer, withSkill("Mining", 100))).toEqual([7, 7, 7, 7]);
  });
});

describe("no power bar", () => {
  test("design change: waiting between swings charges nothing; a swing only sets the cooldowns", () => {
    const t = newAttackTimers();
    startSwing(t, NO_EQUIPMENT, fighter().skills);
    // Long past 1.6's +7 tier (88 frames after the last swing), with Argon's Fist running.
    t.attackCounter = 400;
    for (let i = 0; i < 400; i++) {
      tickSpriteTimers(t);
      tickAttackTimers(t);
    }
    expect(startSwing(t, NO_EQUIPMENT, fighter().skills)).toBeUndefined();
    expect(Object.keys(t).sort()).toEqual(
      ["actionDelay", "atDelay", "atkAnim", "attackCounter", "canAttack"].sort(),
    );
    expect([t.atDelay, t.actionDelay]).toEqual([14, 14]);
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
  test("bug fixed: a bow with no arrows, or no crystal for them, is refused before the swing", () => {
    const bow = { weapon: "Wooden Bow", offHand: "NOTHING" };
    expect(bowRefusal(bow, [])).toBe("You don't have any arrows!");
    const arrows = { weapon: "Wooden Bow", offHand: "Blue Arrows" };
    expect(bowRefusal(arrows, [])).toBe("You don't have any blue crystals left!");
    expect(bowRefusal(arrows, [{ item: "Blue Crystal", qty: 1 }])).toBeNull();
    // Only the crystal itself counts (1.6 took any line containing "Blue Cry").
    expect(bowRefusal(arrows, [{ item: "Blue Crystal Ring", qty: 1 }])).toBe(
      "You don't have any blue crystals left!",
    );
    // Anything that is not a bow is never refused.
    expect(bowRefusal({ weapon: "Knife", offHand: "NOTHING" }, [])).toBeNull();
  });
  test("bow with arrows spends a crystal of their colour", () => {
    const f = fighter({
      equip: { ...NO_EQUIPMENT, weapon: "Wooden Bow", offHand: "Blue Arrows" },
    });
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
  test('bug fixed: the "Bo" row matches only the Bo, not books and bows', () => {
    const rng = scripted([1]);
    expect(attackPower(armed("Bo"), rng).power).toBe(6);
    expect(rng.calls).toEqual([8]);
    const book = scripted([1]);
    expect(attackPower(armed("Book of Fire"), book).power).toBe(1);
    expect(book.calls).toEqual([]);
    const bow = scripted([1]);
    attackPower(armed("Wooden Bow", {}, "Blue Arrows"), bow, () => true);
    expect(bow.calls[0]).not.toBe(8);
  });
  test("bug fixed: a Mining Hammer rolls its base row 2 + random(3)", () => {
    const rng = scripted([1]);
    expect(attackPower(armed("Mining Hammer"), rng).power).toBe(3);
    expect(rng.calls).toEqual([3]);
  });
  test("bug fixed: the Archery tiers are steps, and Archery 30 gets its +1", () => {
    const shot = (archery: number) =>
      attackPower(
        armed("Wooden Bow", { Archery: archery }, "Blue Arrows"),
        scripted([1]),
        () => true,
      ).power;
    // Below 30 the power is set by the step you are on, each step drawing its own roll.
    expect(shot(5)).toBe(2);
    expect(shot(15)).toBe(3);
    expect(shot(29)).toBe(4);
    // From 30 the bow keeps its power (Wooden Bow 1 + Blue Arrows 1) and gains +1 per step.
    expect(shot(30)).toBe(3);
    expect(shot(41)).toBe(4);
  });
  test("bug fixed: Gold Sword's HeavyArms block runs once: +6 at HeavyArms 100", () => {
    const at = (heavy: number) =>
      attackPower(armed("Gold Sword", { HeavyArms: heavy }), scripted([1])).power;
    expect(at(100) - at(0)).toBe(6);
    // HeavyArms 65: > 10, > 20, > 60.
    expect(at(65) - at(0)).toBe(3);
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
  test("bug fixed: the 3x2 footprint is tested on my own tile as well as the faced tile", () => {
    // Overlord anchored at (4,6): its (5,5) cell is my own tile.
    expect(meleeReaches({ x: 5, y: 5, facing: "N" }, { x: 4, y: 6, footprint: true })).toBe(true);
    // Facing away from it, with no cell under me, it is missed.
    expect(meleeReaches({ x: 8, y: 5, facing: "E" }, { x: 4, y: 6, footprint: true })).toBe(false);
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
    // random(3) = 1 → 2; then parry random(90) = 2, block random(90) = 2.
    expect(monsterHitsPlayer(1, fighter(), 0, scripted([1, 2, 2]))).toEqual({
      kind: "hit",
      lost: 2,
    });
  });
  test("bug fixed: parry and block start from random(90), not random(3000)", () => {
    const zero = fighter({ skills: Array(38).fill(0) as number[] });
    const rng = scripted([3, 1]);
    expect(monsterHitsPlayer(1, zero, 0, rng)).toEqual({ kind: "parry" });
    expect(rng.calls).toEqual([3, 90]);
  });
  test("bug fixed: a negative DefenseBonus adds damage", () => {
    // 35 + random(3) = 38, then 38 − (−5) = 43.
    expect(monsterHitsPlayer(35, fighter(), -5, scripted([3, 2, 2]))).toMatchObject({ lost: 43 });
    expect(monsterHitsPlayer(35, fighter(), 5, scripted([3, 2, 2]))).toMatchObject({ lost: 33 });
  });
  test("bug fixed: an innocent on a Holy Shield gets Shield before any draw", () => {
    const rng = scripted([1]);
    expect(monsterHitsPlayer(35, fighter(), 0, rng, true)).toEqual({ kind: "shield" });
    expect(rng.calls).toEqual([]);
  });
  test("bug fixed: an Adventurer's faction armour reads the Adventurer bonus, not the Warrior one", () => {
    const adventurer = (f2Bonus: number, f3Bonus: number) =>
      fighter({ faction: { id: 3, f1Bonus: 0, f2Bonus, f3Bonus } });
    // 1 off above bonus 0, 2 off above 6, by the Adventurer bonus alone.
    expect(factionRows(10, adventurer(0, 0))).toBe(10);
    expect(factionRows(10, adventurer(9, 0))).toBe(10);
    expect(factionRows(10, adventurer(0, 1))).toBe(9);
    expect(factionRows(10, adventurer(0, 7))).toBe(8);
    // A Warrior still reads the Warrior bonus: 1, 2 and 3 off above 0, 4 and 8.
    const warrior = fighter({ faction: { id: 2, f1Bonus: 0, f2Bonus: 9, f3Bonus: 0 } });
    expect(factionRows(10, warrior)).toBe(7);
  });
  test("bug fixed: ice armour against a Yeti cuts the hit points lost", () => {
    const iced = fighter({ equip: { ...NO_EQUIPMENT, body: "Ice Armor" } });
    // Against a Slime: 20, less Ice Armor's own armour row, + random(3) = 1 → 17.
    expect(monsterHitsPlayer(20, iced, 0, scripted([1, 2, 2]), false, "a Slime")).toEqual({
      kind: "hit",
      lost: 17,
    });
    // Against a Yeti the elemental row takes 7 more off the hit points lost.
    expect(monsterHitsPlayer(20, iced, 0, scripted([1, 2, 2]), false, "a Yeti")).toEqual({
      kind: "hit",
      lost: 10,
    });
  });
});

describe("swing cooldowns by worn item", () => {
  test("Ring of Quickness sets 10/10 before the axe ladder", () => {
    const sk = Array(38).fill(0) as number[];
    const wear = (e: Partial<Equipment>) => ({ ...NO_EQUIPMENT, ...e });
    expect(swingCooldowns(wear({}), sk)).toEqual({ atDelay: 14, actionDelay: 14 });
    expect(swingCooldowns(wear({ ring: "Ring of Quickness" }), sk)).toEqual({
      atDelay: 10,
      actionDelay: 10,
    });
    // The axe ladder comes after: at Axe Fighting 0 its first step sets 25, and the action delay
    // stays 10.
    expect(swingCooldowns(wear({ ring: "ring of quickness", weapon: "Axe" }), sk)).toEqual({
      atDelay: 25,
      actionDelay: 10,
    });
  });
});
