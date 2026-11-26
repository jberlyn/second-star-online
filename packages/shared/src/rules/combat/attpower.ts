/**
 * Melee attack power (formula `attpower.assembly`). A port of `GetAttackPower`,
 * driven by the rows in the content store's `attPower`, in source order. Every
 * `random` the original draws is drawn here in the same order, so seeded replays match.
 *
 * Names use case-insensitive substring and exact matches; each base row says which. Bugs fixed in
 * the data (see docs/differences-from-fso.md): the Bo's row matches the Bo exactly rather than books and bows, the
 * Mining Hammer's row is spelled right, the Archery tiers are steps rather than a cascade with a
 * gap at 30, and the Gold Sword's HeavyArms block runs once.
 */
import type { AttPowerBase, AttPowerTier, RolledValue } from "@secondstaronline/data";

import { content } from "../../content/store.ts";
import { type Fighter, skillValue } from "../core/fighter.ts";
import { lingoContains, lingoDiv, lingoEq, type Rng } from "../core/lingo.ts";
import { excepted, ruleMatches } from "../core/patterns.ts";
import { weaponIs } from "../crafting/masterwork.ts";
import { hasBehaviour } from "../inventory/behaviours.ts";
import { type CrystalColour, crystalColour } from "../inventory/inventory.ts";
import { classPerkBonus } from "../progression/classes.ts";
import { factionPerk } from "../social/factions.ts";
import { gearBonus } from "./gear.ts";

/** The six arrow colours, by arrow number. */
export const ARROW_COLOURS = ["Blue", "Red", "Green", "Yellow", "Purple", "White"] as const;

/**
 * The crystal a bow shot spends: the last bag line holding that colour's crystal with some left, as
 * a 0-based slot, or -1. (1.6 took any line containing "<Colour> Cry".)
 */
export function crystalSlotIn(
  bag: readonly ({ item: string; qty: number } | null)[],
  colour: (typeof ARROW_COLOURS)[number],
): number {
  let slot = -1;
  bag.forEach((l, i) => {
    if (l && crystalColour(l.item) === colour && l.qty > 0) {
      slot = i;
    }
  });
  return slot;
}

/** The line for a bow with no arrows in the off hand. */
export const NO_ARROWS_TEXT = "You don't have any arrows!";

/** The line for a bow whose arrows have no crystal of their colour left. */
export function outOfCrystalsText(colour: CrystalColour): string {
  return `You don't have any ${colour.toLowerCase()} crystals left!`;
}

/**
 * Why a bow cannot shoot, or null: no arrows in the off hand, or no crystal of the arrows' colour.
 * The swing is refused before it starts, so no cooldown or animation (bugs fixed: 1.6
 * meleed for 1 with no arrows and wasted the swing with no crystal).
 */
export function bowRefusal(
  equip: { weapon: string; offHand: string },
  bag: readonly ({ item: string; qty: number } | null)[],
): string | null {
  if (!hasBehaviour(equip.weapon, "bow")) {
    return null;
  }
  const colour = ARROW_COLOURS.find((c) => lingoEq(equip.offHand, `${c} Arrows`));
  if (colour === undefined) {
    return NO_ARROWS_TEXT;
  }
  return crystalSlotIn(bag, colour) < 0 ? outOfCrystalsText(colour) : null;
}

export interface AttackPowerResult {
  /** The attack power before target defenses. */
  power: number;
  /**
   * A bow with arrows but no crystal of that colour: the text to print. The server refuses the
   * shot before the swing (`bowRefusal`), so no cooldown starts (1.6 wasted the swing).
   */
  outOfCrystals: string | null;
  /** A bow shot that spends one crystal of this colour. */
  crystal: CrystalColour | null;
}

/** Evaluates a tier value: a number, or `flat + random(randomN)` (no draw when `randomN` is 0). */
export function evalValue(v: number | RolledValue, rng: Rng): number {
  if (typeof v === "number") {
    return v;
  }
  return v.flat + (v.randomN > 0 ? rng.random(v.randomN) : 0);
}

/**
 * A base roll: `flat + random(randomN)`, then `random(strength) / 2` when the row says so (the
 * Gold Axe). Draws in that order, as 1.6 did.
 */
export function rollBase(row: AttPowerBase, str: number, rng: Rng): number {
  let power = row.flat + (row.randomN > 0 ? rng.random(row.randomN) : 0);
  if (row.strengthHalf) {
    power += lingoDiv(rng.random(str), 2);
  }
  return power;
}

/** What a tier condition reads: the skills, and the character level. */
export interface TierReader {
  skills: readonly number[];
  level: number;
}

/** `["Archery < 10"]`: every condition true. `level` is the character level. */
export function tierApplies(f: TierReader, when: readonly string[] | null): boolean {
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
  return applyTierRow(power, t, f, rng);
}

/** A tier row without a weapon test (attack power's after that test, spell power's tables). */
export function applyTierRow(
  power: number,
  t: Omit<AttPowerTier, "subWeapon">,
  f: TierReader,
  rng: Rng,
): number {
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
  for (const row of content().attPower.attPower.base) {
    if (ruleMatches(w, row)) {
      power = rollBase(row, f.str, rng);
    }
  }
  if (w.includes("+")) {
    power += plusBonus(w);
  }
  power += gearBonus(f.equip, "attack"); // Argon's Ring +3
  const isBow = hasBehaviour(w, "bow");
  for (const row of content().attPower.attPower.exactOverrides) {
    if (lingoEq(w, row.pattern) && !excepted(row, w)) {
      power = rollBase(row, f.str, rng);
    }
  }
  // The faction perk `melee` (Classic: a Warrior's tier).
  power += factionPerk(f.faction, "melee") + classPerkBonus(f.classCode, "melee");
  let outOfCrystals: string | null = null;
  let crystal: CrystalColour | null = null;
  if (isBow) {
    for (const a of content().attPower.attPower.arrowBonus) {
      if (lingoEq(f.equip.offHand, a.arrows)) {
        power += a.bonus;
      }
    }
    for (const r of content().attPower.attPower.ringBonus) {
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
      outOfCrystals = outOfCrystalsText(colour); // 1.6 spelt green "geen" (a typo fixed)
    }
  }
  if (f.attackBonus > 0) {
    power += 1; // Purple Potion
  }
  // Bless (an SSO addition, issue #17) adds beside Argon's Fist.
  power += f.blessBonus ?? 0;
  // STR tiers.
  for (const t of [5, 10, 15, 19]) {
    if (f.str > t) {
      power += 1;
    }
  }
  if (power < 1) {
    power = rng.random(2);
  }
  // Skill blocks in source order, the Thrust tiers last; an exact block covers its masterworks.
  for (const block of content().attPower.attPower.skillBlocks) {
    const hit =
      !excepted(block, w) &&
      (block.weaponMatch === "any" ||
        (block.weaponMatch === "contains" && lingoContains(w, block.pattern ?? "")) ||
        (block.weaponMatch === "exact" && weaponIs(w, block.pattern ?? "")));
    if (!hit) {
      continue;
    }
    for (const t of block.tiers) {
      power = applyTier(power, t, f, rng);
    }
  }
  // Weaken (an SSO addition, issue #17) comes off last, never below 1.
  if ((f.weakenPenalty ?? 0) > 0) {
    power = Math.max(1, power - (f.weakenPenalty ?? 0));
  }
  return { power, outOfCrystals, crystal };
}
