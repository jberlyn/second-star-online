/**
 * Character creation: the rules the original creation screen enforced, run on the server, plus the
 * starting record.
 */
import { content, onContent } from "../../content/store.ts";
import { NEW_SKILL_VALUE } from "../core/fighter.ts";

export type Sex = 1 | 2;
export type StartClass = 1 | 2 | 3;

/** Class codes offered on the screen: Fighter 1, Mage 2, Ranger 3. */
export let START_CLASSES: Readonly<Record<StartClass, string>>;

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

/** The five stats the screen lets you raise. Agility, Speed and Aim stay 1. */
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
  classCode: StartClass;
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
  if (!(c.classCode in START_CLASSES)) {
    return "Choose a class.";
  }
  return statsError(c);
}

/** The character record a new character starts with. */
export interface StartingCharacter {
  name: string;
  sex: Sex;
  head: number;
  classCode: StartClass;
  level: number;
  hp: number;
  hpMax: number;
  sp: number;
  spMax: number;
  exp: number;
  expNeeded: number;
  stats: SpentStats & { agi: number; spd: number; aim: number };
  /** One value per skill, skill index 1.. (the classes data's `skills`). */
  skills: number[];
  gold: number;
  profile: string;
  hunger: number;
  breakCount: number;
  /** Bag lines: item name and quantity. */
  bag: { item: string; qty: number }[];
}

/** Pad a class's starting skill list to `count` with `NEW_SKILL_VALUE`. */
export function padStartingSkills(values: readonly number[], count: number): number[] {
  const out = values.slice(0, count);
  while (out.length < count) {
    out.push(NEW_SKILL_VALUE);
  }
  return out;
}

/**
 * The starting record.
 *
 * Kept on purpose: the written vitals are the literals `20:20:20:20` for every class, so a Fighter
 * starts with SP 20/20 although the screen computed SP 0. 1.6 computed HP and SP rolls and discarded
 * them; rolling would reward remaking a character until it rolled well, so nothing is rolled here.
 */
export function startingCharacter(c: CreationChoice): StartingCharacter {
  const other = content().classes.creation.otherFields;
  return {
    name: c.name,
    sex: c.sex,
    head: c.head,
    classCode: c.classCode,
    level: 1,
    hp: 20,
    hpMax: 20,
    sp: 20,
    spMax: 20,
    exp: 0,
    expNeeded: 30,
    stats: { str: c.str, sta: c.sta, int: c.int, wis: c.wis, dex: c.dex, agi: 1, spd: 1, aim: 1 },
    skills: padStartingSkills(
      content().classes.creation.startingSkills[c.classCode].values,
      content().classes.skills.length,
    ),
    gold: other.gold,
    profile: other.profile,
    hunger: other.hunger,
    breakCount: other.breakCount,
    bag: [
      { item: "Apple", qty: 2 },
      { item: "Knife", qty: 1 },
    ],
  };
}

onContent((c) => {
  START_CLASSES = c.classes.creation.classes;
});
