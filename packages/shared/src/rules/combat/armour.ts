/**
 * Armour, PvP mitigation and equipment breaks (the formulas `mitigation.pvp`, `mitigation.pve`,
 * `break.armour` and `break.weapon`). Rows come from `itemRulesData`, in source order. `HitMe` is
 * the original's PvP hit handler and `HitMe2` its monster-hit handler.
 */
import { itemRulesData } from "@secondstaronline/data";

import type { Equipment, Fighter } from "../core/fighter.ts";
import { skillValue } from "../core/fighter.ts";
import { lingoEq, type Rng } from "../core/lingo.ts";
import { ruleMatches } from "../core/patterns.ts";

const R = itemRulesData;

type SlotVar = "RingE" | "HeadE" | "BodyE" | "RightHandE" | "LeftHandE" | "FeetE";

export function slotItem(e: Equipment, slot: SlotVar): string {
  switch (slot) {
    case "RingE":
      return e.ring;
    case "HeadE":
      return e.head;
    case "BodyE":
      return e.body;
    case "RightHandE":
      return e.offHand;
    case "LeftHandE":
      return e.weapon;
    case "FeetE":
      return e.feet;
  }
}

/** Parses the part after the first plus sign as an integer; returns 0 when it is not a number. */
function plusBonus(name: string): number {
  const i = name.indexOf("+");
  const n = Number.parseInt(name.slice(i + 1).trim(), 10);
  return Number.isNaN(n) ? 0 : n;
}

/**
 * The flat armour rows and the `+N` suffixes (HitMe, HitMe2). A `+N` item also matches its
 * `contains` row. Rings are not `+N`-adjusted; RightHand, Body, Head and Feet are, in that order.
 */
export function armourRows(power: number, e: Equipment, handler: "HitMe" | "HitMe2"): number {
  let p = power;
  for (const r of R.armour.rows) {
    const delta = handler === "HitMe" ? r.hitMe : r.hitMe2;
    if (delta !== null && ruleMatches(slotItem(e, r.slot), r)) {
      p += delta;
    }
  }
  for (const item of [e.offHand, e.body, e.head, e.feet]) {
    if (item.includes("+")) {
      p -= plusBonus(item);
    }
  }
  return p;
}

/**
 * Elemental armour (HitMe vs the last weapon seen; HitMe2 vs the last monster to hit me, after
 * the HP loss, so it only changes the number shown). Exact `=` on both sides.
 */
export function elementalRows(
  power: number,
  e: Equipment,
  handler: "HitMe" | "HitMe2",
  trigger: string,
): number {
  let p = power;
  for (const r of R.armour.elemental) {
    if (
      r.handler === handler &&
      lingoEq(trigger, r.trigger) &&
      ruleMatches(slotItem(e, r.slot), r)
    ) {
      p += r.delta;
    }
  }
  return p;
}

/** The faction reductions (HitMe, HitMe2). */
export function factionRows(power: number, f: Fighter): number {
  let p = power;
  const b = f.faction.f2Bonus;
  if (f.faction.id === 2) {
    p -= (b > 0 ? 1 : 0) + (b > 4 ? 1 : 0) + (b > 8 ? 1 : 0);
  }
  if (f.faction.id === 3) {
    p -= (b > 0 ? 1 : 0) + (b > 6 ? 1 : 0);
  }
  return p;
}

/** `+ random(3)`, then the defense bonus either way, then `< 2 → random(3)`. */
export function randomAndDefense(power: number, defenseBonus: number, rng: Rng): number {
  let p = power + rng.random(3);
  if (defenseBonus > 0) {
    p -= defenseBonus;
  }
  if (defenseBonus < 0) {
    p += defenseBonus; // kept bug: a negative defense bonus also reduces damage
  }
  if (p < 2) {
    p = rng.random(3);
  }
  return p;
}

const PVP_LADDER: [number, number][] = [
  [0, 90],
  [10, 90],
  [20, 85],
  [30, 80],
  [40, 70],
  [50, 60],
  [60, 50],
  [70, 40],
  [80, 35],
  [90, 31],
  [96, 24],
];

export type PvpHit = { kind: "parry" | "block" | "shield" } | { kind: "hit"; dmg: number };

/**
 * `HitMe` from the armour rows on for a victim already hit by the tile tests, not in i-frames.
 * `lastWeaponSeen` is the attacker's weapon. Every draw is made in the original order. `shielded`:
 * an innocent victim's sprite is exactly on a Holy Shield's (`"99-"`), which turns the outcome into
 * "Shield" after the parry and block draws (a kept 1.6 quirk: the Holy Shield overrides after the
 * parry and block draws).
 */
export function pvpHit(
  attackPower: number,
  victim: Fighter,
  lastWeaponSeen: string,
  defenseBonus: number,
  rng: Rng,
  shielded = false,
): PvpHit {
  const r = pvpDodge(attackPower, victim, lastWeaponSeen, defenseBonus, rng);
  return shielded ? { kind: "shield" } : r;
}

function pvpDodge(
  attackPower: number,
  victim: Fighter,
  lastWeaponSeen: string,
  defenseBonus: number,
  rng: Rng,
): PvpHit {
  let p = armourRows(attackPower, victim.equip, "HitMe");
  p = elementalRows(p, victim.equip, "HitMe", lastWeaponSeen);
  p = factionRows(p, victim);
  p = randomAndDefense(p, defenseBonus, rng);
  const adventurer = victim.faction.id === 3;
  // Parry: a base draw, then one per threshold passed.
  let dodge = rng.random(90);
  const parry = skillValue(victim.skills, "Parry");
  for (const [gt, n] of PVP_LADDER) {
    if (parry > gt) {
      dodge = rng.random(n);
    }
  }
  if (adventurer) {
    dodge -= 4;
    if (dodge < 1) {
      dodge = rng.random(90); // the re-roll (kept bug: the Faction-3 bonus is nearly void in PvP)
    }
  }
  if (dodge === 1) {
    return { kind: "parry" };
  }
  // Block: no base draw (kept bug: PvP Block 0 never blocks).
  if (dodge > 1) {
    const block = skillValue(victim.skills, "Block");
    for (const [gt, n] of PVP_LADDER) {
      if (block > gt) {
        dodge = rng.random(n);
      }
    }
    if (adventurer) {
      dodge -= 10;
      if (dodge < 1) {
        dodge = rng.random(90);
      }
    }
    if (dodge === 1) {
      return { kind: "block" };
    }
  }
  return { kind: "hit", dmg: p };
}

// ---- breaks --------------------------------------------------------------------------------

/** The break roll's range: `1 + 3·Sta + base`, plus the hunger terms. */
export function breakOdds(sta: number, hunger: number, base: 600 | 500): number {
  let n = 1 + 3 * sta + base;
  if (hunger > 20000) {
    n += 10;
  }
  if (hunger > 25000) {
    n += 30;
  }
  if (hunger > 30000) {
    n += 40;
  }
  if (hunger > 40000) {
    n += 50;
  }
  return n;
}

const ARMOUR_PICK: SlotVar[] = ["BodyE", "HeadE", "RightHandE"];

/**
 * The armour-break check after a monster hit landed. The exclusion list is tested against the
 * monster name prefixed by "a " and never matches (kept bug). Draw from the computed break pool; on
 * a 1, make up to four three-way slot picks while the picked slot holds nothing on the exact list.
 * Returns the equip slot that breaks, or null.
 */
export function rollArmourBreak(
  e: Equipment,
  sta: number,
  hunger: number,
  lastToHitMe: string,
  rng: Rng,
): "Body" | "Head" | "RightHand" | null {
  if (R.breaks.armour.excludedMonsters.some((m) => lingoEq(lastToHitMe, m))) {
    return null;
  }
  if (rng.random(breakOdds(sta, hunger, 600)) > 1) {
    return null;
  }
  for (let tries = 0; tries < 4; tries++) {
    const slot = ARMOUR_PICK[rng.random(3) - 1] as SlotVar;
    const item = slotItem(e, slot);
    if (R.breaks.armour.items.some((i) => i.slot === slot && lingoEq(item, i.item))) {
      return slot === "BodyE" ? "Body" : slot === "HeadE" ? "Head" : "RightHand";
    }
  }
  return null;
}

/**
 * The weapon-break check, rolled by the hitter on each melee hit of a monster: the exclusions (bare
 * name, so they work) and the exact weapon list come before the draw.
 */
export function rollWeaponBreak(
  e: Equipment,
  sta: number,
  hunger: number,
  monster: string,
  rng: Rng,
): boolean {
  if (R.breaks.weapon.excludedMonsters.some((m) => lingoEq(monster, m))) {
    return false;
  }
  if (!R.breaks.weapon.items.some((i) => lingoEq(e.weapon, i.item))) {
    return false;
  }
  return rng.random(breakOdds(sta, hunger, 500)) <= 1;
}

/** An item's damaged form: 33 `contains` rules, last wins; else unchanged. */
export function damagedForm(item: string): string {
  let out = item;
  for (const r of R.breaks.damaged) {
    if (ruleMatches(item, r)) {
      out = r.damaged;
    }
  }
  return out;
}

/** The break message, with the pre-damage name. */
export const shattersText = (item: string) => `Your ${item} shatters in battle!`;
