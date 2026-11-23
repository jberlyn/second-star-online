/**
 * Character creation: the rules the original creation screen enforced, run on the server, plus the
 * starting record.
 */
import type { StartClassRow } from "@secondstaronline/data";

import { content, onContent } from "../../content/store.ts";
import { skillsFromKeys } from "../core/fighter.ts";

export type Sex = 1 | 2;

/**
 * The classes offered on the creation screen, in its order, each with the name it shows (the
 * start class's `label`, else the class's name). Classic offers Fighter 1, Ranger 3 and Mage 2.
 */
export let START_CLASSES: readonly (StartClassRow & { label: string })[] = [];

/** The start class that creates class `code`, or undefined when the screen does not offer it. */
export function startClass(code: number): (StartClassRow & { label: string }) | undefined {
  return START_CLASSES.find((c) => c.code === code);
}

/**
 * Heads the screen can show. Choosing Male shows Head1 and Female shows Head2. The right arrow
 * steps forward through the cycle and the left arrow back: 1→3→4→5→6→9→10→1 and 2→7→8→11→2 (in 1.6
 * both arrows stepped forward). These are
 * all 11 heads in the `Characters` cast (`HEAD1`-`HEAD11`); the original's code also maps
 * Head12-17, which have no art.
 */
export const HEADS_BY_SEX: Readonly<Record<Sex, readonly number[]>> = {
  1: [1, 3, 4, 5, 6, 9, 10],
  2: [2, 7, 8, 11],
};

/** The next head after `head` in its sex's cycle. */
export function nextHead(sex: Sex, head: number): number {
  const cycle = HEADS_BY_SEX[sex];
  const i = cycle.indexOf(head);
  return cycle[(i + 1) % cycle.length] ?? cycle[0] ?? 1;
}

/** The head before `head` in its sex's cycle; a head outside the cycle goes to its first. */
export function prevHead(sex: Sex, head: number): number {
  const cycle = HEADS_BY_SEX[sex];
  const i = cycle.indexOf(head);
  if (i < 0) {
    return cycle[0] ?? 1;
  }
  return cycle[(i - 1 + cycle.length) % cycle.length] ?? cycle[0] ?? 1;
}

/** Points to spend (50). Every stat starts at 1. */
export const CREATION_POINTS = 50;
/** `+` raises a stat only while it is below 20; `−` lowers it only above 1. */
export const STAT_MAX = 20;
export const STAT_MIN = 1;

/** The five stats the screen lets you raise. */
export interface SpentStats {
  str: number;
  sta: number;
  int: number;
  wis: number;
  dex: number;
}

export interface CreationChoice extends SpentStats {
  name: string;
  sex: Sex;
  head: number;
  classCode: number;
}

/**
 * The longest name accepted. The letter check loops over characters 1-20 only; the screen's name
 * field (DBAdmin #3, an 81 px "limit" box) could not hold that many, so this cap rejects nothing
 * the original screen allowed.
 */
export const NAME_MAX = 20;

const RESERVED = ["Admin", "Guide", "Guardian"];

/**
 * The name checks in their original order, with the original alert texts. Returns null when the
 * name is accepted.
 *
 * - The letter check compares each character with "a".."z" ignoring case, so
 *   capital letters pass.
 * - "Admin", "Guide" and "Guardian" are refused anywhere in the name, any case.
 * - The monster-name check does nothing, so
 *   monster names are allowed.
 * - An empty name is refused here; the original would have written `.txt`.
 */
export function nameError(name: string): string | null {
  if (name.length === 0) {
    return "Please enter a name.";
  }
  if (name.length > NAME_MAX) {
    return `Names can be at most ${NAME_MAX} letters long.`;
  }
  // The letter loop runs first, so its alert wins for digits, symbols, spaces, quotes and colons
  // too; the later `contains` checks never fire within 20 characters.
  for (const ch of name) {
    if (!/^[a-z]$/i.test(ch)) {
      return "You can ONLY have letters in your user name!";
    }
  }
  const lower = name.toLowerCase();
  if (RESERVED.some((r) => lower.includes(r.toLowerCase()))) {
    return "Your name cannot have Guide, Guardian or Admin in your name. These are reserve for the game staff!";
  }
  return null;
}

/** The stat rules the + and − buttons enforced. Null when valid. */
export function statsError(s: SpentStats): string | null {
  const values = [s.str, s.sta, s.int, s.wis, s.dex];
  if (values.some((v) => !Number.isInteger(v) || v < STAT_MIN || v > STAT_MAX)) {
    return "Each stat must be between 1 and 20.";
  }
  const spent = values.reduce((a, v) => a + (v - STAT_MIN), 0);
  if (spent > CREATION_POINTS) {
    return "You have spent more than 50 points.";
  }
  return null;
}

/** Every rule of the creation screen. Null when the choice is valid. */
export function creationError(c: CreationChoice): string | null {
  const n = nameError(c.name);
  if (n) {
    return n;
  }
  if (c.sex !== 1 && c.sex !== 2) {
    return "Choose male or female.";
  }
  if (!HEADS_BY_SEX[c.sex].includes(c.head)) {
    return "That head is not available.";
  }
  if (!startClass(c.classCode)) {
    return "Choose a class.";
  }
  return statsError(c);
}

/** The character record a new character starts with. */
export interface StartingCharacter {
  name: string;
  sex: Sex;
  head: number;
  classCode: number;
  level: number;
  hp: number;
  hpMax: number;
  sp: number;
  spMax: number;
  exp: number;
  expNeeded: number;
  stats: SpentStats;
  /** One value per skill, in the order of the classes data's `skills`. */
  skills: number[];
  gold: number;
  profile: string;
  hunger: number;
  breakCount: number;
  /** Bag lines: item name and quantity. */
  bag: { item: string; qty: number }[];
}

/**
 * The skills a start class begins with, in the content's order: its `skills` by key, every other
 * skill `NEW_SKILL_VALUE` (1).
 */
export function startingSkills(code: number): number[] {
  return skillsFromKeys(startClass(code)?.skills ?? {});
}

/**
 * The starting record.
 *
 * The vitals and the bag are the world's (`bindings.json` `start`). Kept on purpose: Classic's
 * vitals are 1.6's literals `20:20:20:20` for every class, so a Fighter starts with SP 20/20
 * although the screen computed SP 0. 1.6 computed HP and SP rolls and discarded them; rolling would
 * reward remaking a character until it rolled well, so nothing is rolled here.
 */
export function startingCharacter(c: CreationChoice): StartingCharacter {
  const other = content().classes.creation.otherFields;
  const start = content().bindings.start;
  return {
    name: c.name,
    sex: c.sex,
    head: c.head,
    classCode: c.classCode,
    level: 1,
    hp: start.hp,
    hpMax: start.hp,
    sp: start.sp,
    spMax: start.sp,
    exp: 0,
    expNeeded: 30,
    stats: { str: c.str, sta: c.sta, int: c.int, wis: c.wis, dex: c.dex },
    skills: startingSkills(c.classCode),
    gold: other.gold,
    profile: other.profile,
    hunger: other.hunger,
    breakCount: other.breakCount,
    bag: start.bag.map((l) => ({ item: l.item, qty: l.qty })),
  };
}

onContent((c) => {
  START_CLASSES = c.classes.startClasses.map((sc) => ({
    ...sc,
    label:
      sc.label ?? c.classes.classes.find((k) => k.code === sc.code)?.name ?? `Class ${sc.code}`,
  }));
});
