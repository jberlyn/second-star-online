/**
 * What the combat and progression rules read about a character: stats, every skill (in the order of
 * the class data's `skills`), equipment and faction. Plain data; the server builds it from its own
 * state.
 */
import { onContent } from "../../content/store.ts";

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
  spd: number;
  /** One value per skill, index 0 = Slash. */
  skills: number[];
  equip: Equipment;
  faction: Faction;
  /** The Purple Potion's attack bonus flag (spells and potions arrive in later slices). */
  attackBonus: number;
  /** `gnL`: wanted for murder. */
  wanted: boolean;
}

/** Skill names normalised: case and spaces ignored ("Martial Arts" = "MartialArts"). */
const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();

let SKILL_INDEX = new Map<string, number>();
onContent((c) => {
  SKILL_INDEX = new Map(c.classes.skills.map((s) => [norm(s.skill), s.index - 1]));
});

/** The array index of a skill by any spelling the original uses. */
export function skillIndex(name: string): number {
  const i = SKILL_INDEX.get(norm(name));
  if (i === undefined) {
    throw new Error(`unknown skill ${name}`);
  }
  return i;
}

/**
 * Starting value for every skill a class doesn't set (every other skill 1); also what an older
 * character gets when a new skill is added to content.
 */
export const NEW_SKILL_VALUE = 1;

export function skillValue(skills: readonly number[], name: string): number {
  return skills[skillIndex(name)] ?? 0;
}
