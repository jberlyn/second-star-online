/**
 * Requirements (issue #37 stage 5): a skill, or the level, that must reach a value before an item
 * can be equipped or used, or a harvest node gathered. Content writes them as `{ needs, atLeast }`,
 * the shape the skill platforms use: `needs` is a skill key, or exactly `level`; or exactly `class`
 * with `classes` (issue #15). Pure.
 */
import { content } from "../../content/store.ts";
import { skillDisplay, skillValue } from "./fighter.ts";

export interface Requirement {
  needs: string;
  atLeast: number;
  /** For `needs: "class"` (issue #15): the classes, by code. */
  classes?: readonly number[];
  text?: string;
}

/** What a requirement reads from a player. */
export interface Qualifications {
  level: number;
  skills: readonly number[];
  /** The class code, for a class requirement (issue #15). Absent: in no listed class. */
  classCode?: number;
}

/**
 * The requirement is met: the level, or the skill (0 for a skill the world lacks), reaches it; a
 * class requirement, the character is in one of its classes.
 */
export function requirementMet(r: Requirement, who: Qualifications): boolean {
  if (r.needs === "class") {
    return who.classCode !== undefined && (r.classes ?? []).includes(who.classCode);
  }
  const have = r.needs === "level" ? who.level : skillValue(who.skills, r.needs);
  return have >= r.atLeast;
}

/** "a Ranger or an Archer": the classes by name, each with its article, in the list's order. */
export function classListWords(codes: readonly number[]): string {
  const names = codes.map(
    (code) => content().classes.classes.find((k) => k.code === code)?.name ?? `class ${code}`,
  );
  const a = (n: string) => `${/^[aeiou]/i.test(n) ? "an" : "a"} ${n}`;
  return names.length <= 1
    ? a(names[0] ?? "")
    : `${names.slice(0, -1).map(a).join(", ")} or ${a(names[names.length - 1] ?? "")}`;
}

/**
 * The refusal for an unmet requirement: the row's own `text`, else "You need Mining 30 to <verb>
 * this." ("You need to be level 30 to …" for the level).
 */
export function requirementText(r: Requirement, verb: string): string {
  if (r.text !== undefined) {
    return r.text;
  }
  if (r.needs === "class") {
    return `Only ${classListWords(r.classes ?? [])} can ${verb} this.`;
  }
  return r.needs === "level"
    ? `You need to be level ${r.atLeast} to ${verb} this.`
    : `You need ${skillDisplay(r.needs)} ${r.atLeast} to ${verb} this.`;
}

/** The first requirement of a list the player does not meet, as its refusal, or null. */
export function firstUnmet(
  rows: readonly Requirement[],
  who: Qualifications,
  verb: string,
): string | null {
  const r = rows.find((row) => !requirementMet(row, who));
  return r ? requirementText(r, verb) : null;
}
