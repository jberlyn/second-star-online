/**
 * Kill skill gain: the weapon skill increase for the left-hand item and the body, called by the original's kill routine
 * on the killer's client before the level check. Data: the generated classes `skillGain` and
 * monsters `skillCaps`.
 */
import { classesData, monstersData } from "@secondstaronline/data";

import { type Faction, type Fighter, skillIndex } from "../core/fighter.ts";
import { lingoContains, type Rng } from "../core/lingo.ts";
import { weaponIs } from "../crafting/masterwork.ts";

/** The skills the weapon trains: the last matching row wins; an exact row covers its masterworks. */
export function weaponSkillList(weapon: string): readonly string[] {
  let out: readonly string[] = [];
  for (const row of classesData.skillGain.weaponSkills) {
    const hit =
      row.match === "exact" ? weaponIs(weapon, row.weapon) : lingoContains(weapon, row.weapon);
    if (hit) {
      out = row.skills;
    }
  }
  return out;
}

/**
 * The Mage skill cap, for kills and casts alike: 30, or for the Mage faction 50/60/70/90/100 by
 * faction bonus < 1/1/2/3/> 3. A bug fixed: 1.6's kill path used 80 at bonus 3 and its cast path 90.
 */
export function mageSkillCap(f: Faction): number {
  if (f.id !== 1) {
    return 30;
  }
  const b = f.f1Bonus;
  return b < 1 ? 50 : b === 1 ? 60 : b === 2 ? 70 : b === 3 ? 90 : 100;
}

/** The skill caps by faction (kill path). */
export function skillCaps(f: Fighter): { max: number; mage: number } {
  let max = 50;
  const mage = mageSkillCap(f.faction);
  const { id, f2Bonus, f3Bonus } = f.faction;
  if (id === 2) {
    max = [55, 60, 70, 80, 90][Math.max(0, Math.min(f2Bonus, 4))] ?? 100;
    if (f2Bonus > 4) {
      max = 100;
    }
  }
  if (id === 3) {
    max = [55, 60, 65, 70, 75][Math.max(0, Math.min(f3Bonus, 4))] ?? 80;
    if (f3Bonus > 4) {
      max = 80;
    }
  }
  return { max, mage };
}

/** The skill cap by the killed monster's body, plus the Intelligence tiers. */
export function monsterSkillCap(body: number, intelligence: number): number {
  const caps = monstersData.skillCaps;
  let cap = caps.default;
  for (const row of caps.byBody) {
    if (row.body === String(body)) {
      cap = row.skillCap;
    }
  }
  for (const t of caps.intelligenceTiers) {
    if (intelligence > t.intelligenceGt) {
      cap += t.add;
    }
  }
  return cap;
}

/** The Wisdom addition to the skill-gain roll. */
export function wisAdd(wisdom: number): number {
  let w = 30;
  const tiers: [number, number][] = [
    [5, 5],
    [10, 7],
    [15, 8],
    [20, 5],
    [22, 2],
    [23, 3],
  ];
  for (const [gt, sub] of tiers) {
    if (wisdom > gt) {
      w -= sub;
    }
  }
  return w;
}

interface GainRule {
  skill: string;
  /** The `random(n)` size from the skill value. */
  n(f: Fighter, value: number, wis: number): number;
  cap: "max" | "mage";
  /** An extra requirement tested only after the roll succeeds. */
  requires?(f: Fighter): boolean;
}

const v = (f: Fighter, s: string) => f.skills[skillIndex(s)] ?? 0;

/** In source order. */
const RULES: readonly GainRule[] = [
  { skill: "HammerWielding", n: (f, x, w) => 40 - f.sta + x + w, cap: "max" },
  { skill: "AxeFighting", n: (_f, x, w) => x + w, cap: "max" },
  { skill: "Punch", n: (_f, x, w) => x + w, cap: "max" },
  { skill: "Archery", n: (_f, x, w) => x + w, cap: "max" },
  { skill: "MartialArts", n: (_f, x, w) => x + w, cap: "max" },
  { skill: "UnholyCombat", n: (_f, x) => x, cap: "mage" },
  {
    skill: "Thrust",
    n: (f, x, w) => 40 - f.sta + x + w,
    cap: "max",
    requires: (f) => v(f, "Slash") > 30,
  },
  { skill: "StaffFighting", n: (_f, x, w) => x + w, cap: "mage" },
  { skill: "Slash", n: (_f, x, w) => x + w, cap: "max" },
  {
    skill: "HeavyArms",
    n: (_f, x, w) => x + w,
    cap: "max",
    requires: (f) => v(f, "Thrust") > 60,
  },
  {
    skill: "Swordsmanship",
    n: (f, x, w) => 25 - f.sta + x + w,
    cap: "max",
    requires: (f) => v(f, "Slash") > 50,
  },
  {
    skill: "Fencing",
    n: (f, x, w) => 25 - f.sta + x + w,
    cap: "max",
    requires: (f) => v(f, "Swordsmanship") > 20,
  },
];

/** The chat line for a gain, e.g. "You have advanced in the art of Punch!" */
export function advancedText(skill: string): string {
  const shown: Record<string, string> = {
    HammerWielding: "Hammer Wielding",
    AxeFighting: "Axe Fighting",
    MartialArts: "Martial Arts",
    UnholyCombat: "Unholy Combat",
    StaffFighting: "Staff Fighting",
    HeavyArms: "Heavy Arms",
  };
  return `You have advanced in the art of ${shown[skill] ?? skill}!`;
}

/**
 * Rolls every skill the weapon trains, in the original order; each needs skill > 0, below
 * its cap and below the monster's cap. Mutates `f.skills`; returns the skills that rose.
 * `oSkills contains` is a substring test on the comma list, as written.
 */
export function rollKillSkillGain(f: Fighter, monsterBody: number, rng: Rng): string[] {
  const list = weaponSkillList(f.equip.weapon).join(", ");
  const caps = skillCaps(f);
  const monsterCap = monsterSkillCap(monsterBody, f.int);
  const w = wisAdd(f.wis);
  const gained: string[] = [];
  for (const r of RULES) {
    const label = advancedText(r.skill).slice("You have advanced in the art of ".length, -1);
    if (!lingoContains(list, label)) {
      continue;
    }
    const i = skillIndex(r.skill);
    const x = f.skills[i] ?? 0;
    if (!(x > 0) || !(x < caps[r.cap])) {
      continue;
    }
    const roll = rng.random(r.n(f, x, w));
    if (x < monsterCap && roll === 1 && (!r.requires || r.requires(f))) {
      f.skills[i] = x + 1;
      gained.push(r.skill);
    }
  }
  return gained;
}
