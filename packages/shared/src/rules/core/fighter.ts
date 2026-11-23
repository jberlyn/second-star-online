/**
 * What the combat and progression rules read about a character: stats, every skill (in the order of
 * the class data's `skills`; saved and sent keyed by each skill's key), equipment and faction. Plain data; the server builds it from its own
 * state.
 */
import type { SkillBinding } from "@secondstaronline/data";

import { content, onContent } from "../../content/store.ts";

/** The empty equipment slot (`NOTHING`). */
export const NOTHING = "NOTHING";

export interface Equipment {
  /** `LeftHandE`: the weapon. */
  weapon: string;
  /** `RightHandE`: shield, arrows. */
  offHand: string;
  head: string;
  body: string;
  feet: string;
  /** `RingE`. */
  ring: string;
}

export const NO_EQUIPMENT: Equipment = {
  weapon: NOTHING,
  offHand: NOTHING,
  head: NOTHING,
  body: NOTHING,
  feet: NOTHING,
  ring: NOTHING,
};

export interface Faction {
  /** `Fctnme`: 0 none, 1 Mage, 2 Warrior, 3 Adventurer. */
  id: 0 | 1 | 2 | 3;
  f1Bonus: number;
  f2Bonus: number;
  f3Bonus: number;
}

export const NO_FACTION: Faction = { id: 0, f1Bonus: 0, f2Bonus: 0, f3Bonus: 0 };

export interface Fighter {
  level: number;
  str: number;
  sta: number;
  int: number;
  wis: number;
  /** One value per skill, in the order of the content's `classes.skills` (`SKILL_KEYS`). */
  skills: number[];
  equip: Equipment;
  faction: Faction;
  /** The Purple Potion's attack bonus flag (spells and potions arrive in later slices). */
  attackBonus: number;
  /** `gnL`: wanted for murder. */
  wanted: boolean;
}

/** Skill names normalised: case and spaces ignored ("Martial Arts" = "MartialArts"). */
export const skillNorm = (s: string) => s.replace(/\s+/g, "").toLowerCase();

let SKILL_INDEX = new Map<string, number>();
/** Every skill's key, in the content's order: the order of a character's skill values in memory. */
export let SKILL_KEYS: readonly string[] = [];
let BOUND: Partial<Record<SkillBinding, number>> = {};
onContent((c) => {
  SKILL_KEYS = c.classes.skills.map((s) => s.skill);
  SKILL_INDEX = new Map(c.classes.skills.map((s, i) => [skillNorm(s.skill), i]));
  BOUND = {};
  for (const [b, key] of Object.entries(c.bindings.skills) as [SkillBinding, string][]) {
    const i = key === undefined ? undefined : SKILL_INDEX.get(skillNorm(key));
    if (i !== undefined) {
      BOUND[b] = i;
    }
  }
});

/** The array index of a skill by any spelling the original uses, or undefined for no skill. */
export function findSkillIndex(name: string): number | undefined {
  return SKILL_INDEX.get(skillNorm(name));
}

/** The array index of a skill by any spelling the original uses. */
export function skillIndex(name: string): number {
  const i = SKILL_INDEX.get(skillNorm(name));
  if (i === undefined) {
    throw new Error(`unknown skill ${name}`);
  }
  return i;
}

/**
 * The array index of the skill content binds to an engine mechanic (`bindings.json` `skills`), or
 * undefined when the world binds none: the mechanic is off.
 */
export function boundSkillIndex(b: SkillBinding): number | undefined {
  return BOUND[b];
}

/** The value of a bound skill, or 0 when the world binds none. */
export function boundSkillValue(skills: readonly number[], b: SkillBinding): number {
  const i = BOUND[b];
  return i === undefined ? 0 : (skills[i] ?? 0);
}

/**
 * Starting value for every skill a class doesn't set (every other skill 1); also what an older
 * character gets when a new skill is added to content.
 */
export const NEW_SKILL_VALUE = 1;

/** A skill's value by name; 0 for a skill the world does not have. */
export function skillValue(skills: readonly number[], name: string): number {
  const i = SKILL_INDEX.get(skillNorm(name));
  return i === undefined ? 0 : (skills[i] ?? 0);
}

/** The name players see for a skill (its `display`, else its key); the name itself if unknown. */
export function skillDisplay(name: string): string {
  const i = SKILL_INDEX.get(skillNorm(name));
  const row = i === undefined ? undefined : content().classes.skills[i];
  return row ? (row.display ?? row.skill) : name;
}

/** Skill values keyed by skill key, as they are saved and sent. */
export type SkillValues = Record<string, number>;

/** A character's in-memory skill values keyed by skill key. */
export function skillsByKey(skills: readonly number[]): SkillValues {
  const out: SkillValues = {};
  SKILL_KEYS.forEach((k, i) => {
    out[k] = skills[i] ?? NEW_SKILL_VALUE;
  });
  return out;
}

/**
 * Skill values keyed by skill key as the in-memory list, in the content's order. A key is matched
 * as `findSkillIndex` matches names, the exact key first; a skill with no value takes `fallback`.
 */
export function skillsFromKeys(
  values: Readonly<SkillValues>,
  fallback: (key: string) => number = () => NEW_SKILL_VALUE,
): number[] {
  const found: (number | undefined)[] = SKILL_KEYS.map(() => undefined);
  // Another spelling of a key counts only where the exact key has no value, so the result never
  // depends on the order the values come in.
  for (const exact of [false, true]) {
    for (const [k, v] of Object.entries(values)) {
      const i = SKILL_INDEX.get(skillNorm(k));
      if (i !== undefined && (SKILL_KEYS[i] === k) === exact) {
        found[i] = v;
      }
    }
  }
  return SKILL_KEYS.map((k, i) => found[i] ?? fallback(k));
}
