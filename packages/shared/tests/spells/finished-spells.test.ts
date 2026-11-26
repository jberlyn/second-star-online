/**
 * Issue #17: the seven spells 1.6 listed, priced and taught but gave no effect (Bless, Weaken,
 * Haste, Poison Dart, Replenish, Holy Weapon and Identify) have effects in SSO. These pin the shared
 * rules: where each is placed, what it does and how long it lasts.
 */
import { describe, expect, test } from "bun:test";

import { TICK_HZ } from "../../src/constants.ts";
import { attackPower } from "../../src/rules/combat/attpower.ts";
import { type Fighter, NO_EQUIPMENT, NO_FACTION } from "../../src/rules/core/fighter.ts";
import type { Rng } from "../../src/rules/core/lingo.ts";
import { identifyLines } from "../../src/rules/spells/identify.ts";
import { FX_TRIGGER_FRAMES, placeFx } from "../../src/rules/spells/spellfx.ts";
import {
  baseSpell,
  castEffect,
  crystalsFor,
  directional,
  hastedRegenTarget,
  holyWeaponBonus,
  isHarmful,
  playerSpellAmount,
  poisonOnMonster,
  spCost,
  spellByName,
  spellHitOnMonster,
  spellSchools,
  timedEffectFrames,
  weakenedAttack,
} from "../../src/rules/spells/spells.ts";

/** `random(n)` always answers 1. */
const low: Rng = { random: () => 1 };
/** `random(n)` always answers n. */
const high: Rng = { random: (n) => n };

const fighter = (over: Partial<Fighter> = {}): Fighter => ({
  level: 1,
  str: 1,
  sta: 1,
  int: 1,
  wis: 1,
  skills: [],
  equip: NO_EQUIPMENT,
  faction: NO_FACTION,
  attackBonus: 0,
  wanted: false,
  ...over,
});

const target = { equip: NO_EQUIPMENT, magicShield: false };
const caster = { h: 200, v: 200 };
const click = { h: 300, v: 150 };

describe("design change: the spells 1.6 left without an effect work", () => {
  test("design change: each spell has its cost, school and harm", () => {
    expect([spCost("Replenish", "NOTHING"), crystalsFor("Replenish")]).toEqual([
      22,
      { colour: "Blue", count: 5 },
    ]);
    expect([spCost("Haste", "NOTHING"), crystalsFor("Haste")]).toEqual([
      20,
      { colour: "Yellow", count: 3 },
    ]);
    expect([spCost("Bless", "NOTHING"), crystalsFor("Bless")]).toEqual([
      12,
      { colour: "Blue", count: 4 },
    ]);
    expect([spCost("Holy Weapon", "NOTHING"), crystalsFor("Holy Weapon")]).toEqual([
      10,
      { colour: "White", count: 3 },
    ]);
    expect([spCost("Weaken", "NOTHING"), crystalsFor("Weaken")]).toEqual([
      30,
      { colour: "White", count: 5 },
    ]);
    expect([spCost("Poison Dart", "NOTHING"), crystalsFor("Poison Dart")]).toEqual([
      25,
      { colour: "Green", count: 3 },
    ]);
    expect([spCost("Identify", "NOTHING"), crystalsFor("Identify")]).toEqual([5, null]);
    expect(["Weaken", "Poison Dart"].map(isHarmful)).toEqual([true, true]);
    expect(["Replenish", "Haste", "Bless", "Holy Weapon", "Identify"].map(isHarmful)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
    const schools = (s: string) =>
      spellSchools(spellByName(s) ?? { school: undefined }).map((x) => x.skill);
    expect(schools("Replenish")).toEqual(["Blessing"]);
    expect(schools("Haste")).toEqual(["Blessing"]);
    expect(schools("Bless")).toEqual(["Blessing"]);
    expect(schools("Holy Weapon")).toEqual(["Blessing"]);
    expect(schools("Weaken")).toEqual(["BlackArts"]);
    expect(schools("Poison Dart")).toEqual(["BlackArts", "MartialArts"]);
    expect(spellSchools(spellByName("Identify") ?? {})).toEqual([
      { skill: "ItemIdentification", cap: 100 },
    ]);
  });

  test("design change: the blessings, Weaken and Identify land at the click; Poison Dart flies from the caster", () => {
    for (const s of ["Replenish", "Haste", "Bless", "Holy Weapon", "Weaken", "Identify"]) {
      expect(placeFx(castEffect(s), caster, click)).toEqual(click);
    }
    expect(directional("Poison Dart", 200, 200, 300, 210)).toBe("Poison DartR");
    expect(directional("Poison Dart", 200, 200, 190, 100)).toBe("Poison DartU");
    expect(placeFx("Poison DartL", caster, click)).toEqual({ h: 168, v: 200 });
    expect(placeFx("Poison DartD", caster, click)).toEqual({ h: 200, v: 232 });
    expect(baseSpell("Poison DartU")).toBe("Poison Dart");
    // Each run acts on frame 3; the dart on any frame it shows (frame 1 of its three).
    for (const run of ["replenish", "haste", "bless", "holy weapon", "weaken"]) {
      expect(FX_TRIGGER_FRAMES[run]).toBe(3);
    }
    expect(FX_TRIGGER_FRAMES["poison dartl"]).toBe(1);
  });

  test("design change: Replenish heals between Minor and Major Heal, and hurts the undead", () => {
    const P = 4;
    const heal = (b: "minor heal" | "replenish" | "major heal", rng: Rng) =>
      playerSpellAmount(b, P, target, rng);
    // Minor 2 + P + 1..2, Replenish 8 + P + 1..6, Major 15 + P + 1..5.
    expect([heal("minor heal", low), heal("minor heal", high)]).toEqual([7, 8]);
    expect([heal("replenish", low), heal("replenish", high)]).toEqual([13, 18]);
    expect([heal("major heal", low), heal("major heal", high)]).toEqual([20, 24]);
    expect(spellHitOnMonster("Replenish-3", {}, 0, P, high)).toEqual({
      n: 8 + P + 8,
      heal: true,
      splat: false,
    });
    expect(spellHitOnMonster("Replenish-3", { hurtByHealing: true }, 0, P, high)).toEqual({
      n: 3 + P + 3,
      heal: false,
      splat: true,
    });
  });

  test("design change: a timed spell lasts its frames plus its frames per power, or its own seconds", () => {
    expect(timedEffectFrames("haste", 10)).toBe(1000 + 20 * 10);
    expect(timedEffectFrames("bless", 10)).toBe(1200);
    expect(timedEffectFrames("holyWeapon", 10)).toBe(1200);
    expect(timedEffectFrames("weaken", 10)).toBe(500 + 10 * 10);
    expect(timedEffectFrames("poison", 10)).toBe(200 + 10 * 10);
    expect(timedEffectFrames("haste", 10, { lasts: 7 })).toBe(7 * TICK_HZ);
  });

  test("design change: Haste doubles the regeneration speed", () => {
    expect(hastedRegenTarget(149)).toBe(75);
    expect(hastedRegenTarget(1)).toBe(1);
  });

  test("design change: Bless adds attack power and Weaken takes it off last, never below 1", () => {
    const base = attackPower(fighter(), low).power;
    expect(attackPower(fighter({ blessBonus: 2 }), low).power).toBe(base + 2);
    expect(attackPower(fighter({ weakenPenalty: 2 }), low).power).toBe(Math.max(1, base - 2));
    expect(attackPower(fighter({ weakenPenalty: 50 }), low).power).toBe(1);
    expect(weakenedAttack(10)).toBe(8);
    expect(weakenedAttack(2)).toBe(1);
  });

  test("design change: Holy Weapon adds 2 to a melee hit, 4 on the undead", () => {
    expect([holyWeaponBonus(false), holyWeaponBonus(true)]).toEqual([2, 4]);
  });

  test("design change: each hit of poison deals 2 + random(3), which spell defense does not reduce", () => {
    const shielded = { equip: { ...NO_EQUIPMENT, body: "Plate Armor" }, magicShield: true };
    expect(playerSpellAmount("poison dart", 9, shielded, low)).toBe(3);
    expect(playerSpellAmount("poison dart", 9, target, high)).toBe(5);
    expect(poisonOnMonster({}, 9, high)).toEqual({ n: 5, heal: false, splat: true });
    expect(poisonOnMonster({ resists: ["Poison Dart"] }, 9, low)).toEqual({
      n: 1,
      heal: false,
      splat: true,
    });
  });

  test("design change: Identify reads an item's real rules", () => {
    const sword = identifyLines("Long Sword");
    expect(sword[0]).toBe("You study the Long Sword closely...");
    expect(sword).toContain("It is wielded as a weapon.");
    expect(sword.some((l) => l.startsWith("It strikes for "))).toBe(true);
    const plate = identifyLines("Plate Armor");
    expect(plate).toContain("It is worn on the body.");
    expect(plate.some((l) => /each monster's hit on you\.$/.test(l))).toBe(true);
    expect(identifyLines("Apple")).toEqual([
      "You study the Apple closely...",
      "There is nothing more to learn about it.",
    ]);
    // A container's `#id` is not part of what it is.
    expect(identifyLines("Crate#12")[0]).toBe("You study the Crate closely...");
  });
});
