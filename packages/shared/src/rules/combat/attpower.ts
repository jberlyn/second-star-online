/**
 * Melee attack power (formula `attpower.assembly`). A port of `GetAttackPower`,
 * driven by the rows in `attPowerData`, in source order. Every
 * `random` the original draws is drawn here in the same order, so seeded replays match.
 *
 * Names use case-insensitive substring and exact matches.
 * Quirks kept as written (kept bugs): "Bo" matches books and bows,
 * the "Minng Hammer" typo, the Archery cascade, Gold Sword's HeavyArms block twice.
 */
import { type AttPowerTier, attPowerData } from "@secondstaronline/data";

import { type Fighter, skillValue } from "../core/fighter.ts";
import { lingoContains, lingoDiv, lingoEq, type Rng } from "../core/lingo.ts";
import { gearBonus } from "./gear.ts";

const AP = attPowerData.attPower;

/** The six arrow colours, by arrow number. */
export const ARROW_COLOURS = ["Blue", "Red", "Green", "Yellow", "Purple", "White"] as const;

/**
 * The crystal a bow shot spends: the last bag line containing "<Colour> Cry" with some left, as a
 * 0-based slot, or -1.
 */
export function crystalSlotIn(
  bag: readonly ({ item: string; qty: number } | null)[],
  colour: (typeof ARROW_COLOURS)[number],
): number {
  let slot = -1;
  bag.forEach((l, i) => {
    if (l && lingoContains(l.item, `${colour} Cry`) && l.qty > 0) {
      slot = i;
    }
  });
  return slot;
}

/**
 * A bow with arrows and no crystal of their colour: `attackPower`'s `outOfCrystals`. The swing's
 * cooldowns still start, but there is no attack animation, so no movement lock.
 */
export function bowOutOfCrystals(
  equip: { weapon: string; offHand: string },
  bag: readonly ({ item: string; qty: number } | null)[],
): boolean {
  if (!lingoContains(equip.weapon, "bow")) {
    return false;
  }
  const colour = ARROW_COLOURS.find((c) => lingoEq(equip.offHand, `${c} Arrows`));
  return colour !== undefined && crystalSlotIn(bag, colour) < 0;
}
export type CrystalColour = (typeof ARROW_COLOURS)[number];

export interface AttackPowerResult {
  /** The attack power before the power-bar bonus. */
  power: number;
  /**
   * A bow with arrows but no crystal of that colour: the swing is wasted after the cooldown and bar
   * reset (the leave-combat flag is set). The text is printed.
   */
  outOfCrystals: string | null;
  /** A bow shot that spends one crystal of this colour. */
  crystal: CrystalColour | null;
}

/** Evaluates a row value: a number, `random(n)` or `a + random(n)`. */
export function evalValue(v: number | string, rng: Rng): number {
  if (typeof v === "number") {
    return v;
  }
  const m = /^(?:(\d+) \+ )?random\((\d+)\)$/.exec(v);
  if (!m) {
    const n = Number(v);
    if (Number.isInteger(n)) {
      return n;
    }
    throw new Error(`attpower: cannot evaluate ${v}`);
  }
  return Number(m[1] ?? 0) + rng.random(Number(m[2]));
}

/** `["Archery < 10"]`: every condition true. `level` is the character level. */
export function tierApplies(f: Fighter, when: readonly string[] | null): boolean {
  if (!when) {
    return true;
  }
  return when.every((cond) => {
    const m = /^(\w+) ([<>]) (\d+)$/.exec(cond);
    if (!m) {
      throw new Error(`attpower: cannot read condition ${cond}`);
    }
    const value = m[1] === "level" ? f.level : skillValue(f.skills, m[1] as string);
    const n = Number(m[3]);
    return m[2] === "<" ? value < n : value > n;
  });
}

export function applyTier(power: number, t: AttPowerTier, f: Fighter, rng: Rng): number {
  if (t.subWeapon && !lingoEq(f.equip.weapon, t.subWeapon.pattern)) {
    return power;
  }
  if (!tierApplies(f, t.when)) {
    return power;
  }
  const v = evalValue(t.value, rng);
  switch (t.op) {
    case "set":
      return v;
    case "add":
      return power + v;
    case "subtract":
      return power - v;
  }
}

/** Parses the part of the left-hand item name after the first plus sign as an integer. */
function plusBonus(weapon: string): number {
  const item2 = weapon.split("+")[1] ?? "";
  const n = Number.parseInt(item2.trim(), 10);
  return Number.isNaN(n) ? 0 : n;
}

/**
 * The attack power calculation, starting from 1. `hasCrystal(colour)` answers the bow's crystal
 * check (the server's own bag).
 */
export function attackPower(
  f: Fighter,
  rng: Rng,
  hasCrystal: (c: CrystalColour) => boolean = () => false,
): AttackPowerResult {
  const w = f.equip.weapon;
  let power = 1;
  // Base rows by `contains`; every match re-rolls, the last one wins.
  for (const row of AP.base) {
    if (lingoContains(w, row.pattern)) {
      power = row.flat + (row.randomN === null ? 0 : rng.random(row.randomN));
      if (row.extra) {
        power += lingoDiv(rng.random(f.str), 2); // Gold Axe
      }
    }
  }
  if (w.includes("+")) {
    power += plusBonus(w);
  }
  power += gearBonus(f.equip, "attack"); // Argon's Ring +3
  const isBow = lingoContains(w, "bow");
  for (const row of AP.exactOverrides) {
    if (lingoEq(w, row.pattern)) {
      power = row.flat + (row.randomN === null ? 0 : rng.random(row.randomN));
    }
  }
  if (f.faction.id === 2) {
    power += f.faction.f2Bonus;
  }
  let outOfCrystals: string | null = null;
  let crystal: CrystalColour | null = null;
  if (isBow) {
    for (const a of AP.arrowBonus) {
      if (lingoEq(f.equip.offHand, a.arrows)) {
        power += a.bonus;
      }
    }
    for (const r of AP.ringBonus) {
      if (r.requiresBow && lingoEq(f.equip.ring, r.ring)) {
        power += r.bonus;
      }
    }
    const colour = ARROW_COLOURS.find((c) => lingoEq(f.equip.offHand, `${c} Arrows`)) ?? null;
    if (!colour) {
      // No arrows: attack power 1 and exit; the swing then melees.
      return { power: 1, outOfCrystals: null, crystal: null };
    }
    if (hasCrystal(colour)) {
      crystal = colour;
    } else {
      // "geen" as written (a kept 1.6 typo for green).
      const shown = colour === "Green" ? "geen" : colour.toLowerCase();
      outOfCrystals = `You don't have any ${shown} crystals left!`;
    }
  }
  if (f.attackBonus > 0) {
    power += 1; // Purple Potion
  }
  // STR tiers.
  for (const t of [5, 10, 15, 19]) {
    if (f.str > t) {
      power += 1;
    }
  }
  if (power < 1) {
    power = rng.random(2);
  }
  // Skill blocks in source order, the Thrust tiers last.
  for (const block of AP.skillBlocks) {
    const hit =
      block.weaponMatch === "any" ||
      (block.weaponMatch === "contains" && lingoContains(w, block.pattern ?? "")) ||
      (block.weaponMatch === "exact" && lingoEq(w, block.pattern ?? ""));
    if (!hit) {
      continue;
    }
    for (const t of block.tiers) {
      power = applyTier(power, t, f, rng);
    }
  }
  return { power, outOfCrystals, crystal };
}
