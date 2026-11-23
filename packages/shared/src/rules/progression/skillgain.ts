/**
 * Kill skill gain: the weapon skill increase for the left-hand item and the body, called by the original's kill routine
 * on the killer's client before the level check. Data: the classes `skillGain` and
 * monsters `skillCaps`.
 */
import { content } from "../../content/store.ts";
import {
  type Faction,
  type Fighter,
  findSkillIndex,
  skillDisplay,
  skillNorm,
  skillValue,
} from "../core/fighter.ts";
import { lingoContains, type Rng } from "../core/lingo.ts";
import { weaponIs } from "../crafting/masterwork.ts";
import { factionPerk } from "../social/factions.ts";

/** The skills the weapon trains: the last matching row wins; an exact row covers its masterworks. */
export function weaponSkillList(weapon: string): readonly string[] {
  let out: readonly string[] = [];
  for (const row of content().classes.skillGain.weaponSkills) {
    const hit =
      row.match === "exact" ? weaponIs(weapon, row.weapon) : lingoContains(weapon, row.weapon);
    if (hit) {
      out = row.skills;
    }
  }
  return out;
}

/**
 * The Mage skill cap, for kills and casts alike: the faction perk `mageCap` (Classic: 30, or for
 * the Mage faction 50/60/70/90/100 by tier 0/1/2/3/4 and over). A bug fixed: 1.6's kill path used
 * 80 at tier 3 and its cast path 90.
 */
export function mageSkillCap(f: Faction): number {
  return factionPerk(f, "mageCap");
}

/**
 * The skill caps by faction (kill path): the perks `skillCap` (Classic: 50; Warriors 55, 60, 70,
 * 80, 90 by tier, then 100; Adventurers 55 … 75, then 80) and `mageCap`.
 */
export function skillCaps(f: Fighter): { max: number; mage: number } {
  return { max: factionPerk(f.faction, "skillCap"), mage: mageSkillCap(f.faction) };
}

/** The skill cap by the killed monster's body, plus the Intelligence tiers. */
export function monsterSkillCap(body: number, intelligence: number): number {
  const caps = content().monsters.skillCaps;
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

const v = (f: Fighter, s: string) => skillValue(f.skills, s);

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

/**
 * The chat line for a gain, e.g. "You have advanced in the art of Punch!": the skill's `display`
 * name (`classes.json` `skills`), else its key.
 */
export function advancedText(skill: string): string {
  return `You have advanced in the art of ${skillDisplay(skill)}!`;
}

/**
 * Rolls every skill the weapon trains, in the original order; each needs skill > 0, below
 * its cap and below the monster's cap. Mutates `f.skills`; returns the skills that rose.
 * 1.6's `oSkills contains` was a substring test on the comma list of shown names; the list's
 * entries are matched to skills by name here (case and spaces ignored), so a skill's `display`
 * may change without it stopping training. For Classic's lists the two agree.
 */
export function rollKillSkillGain(f: Fighter, monsterBody: number, rng: Rng): string[] {
  const trained = new Set(weaponSkillList(f.equip.weapon).map(skillNorm));
  const caps = skillCaps(f);
  const monsterCap = monsterSkillCap(monsterBody, f.int);
  const w = wisAdd(f.wis);
  const gained: string[] = [];
  for (const r of RULES) {
    // A skill the world does not have is never rolled.
    const i = findSkillIndex(r.skill);
    if (i === undefined || !trained.has(skillNorm(r.skill))) {
      continue;
    }
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
