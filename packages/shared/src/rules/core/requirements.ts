/**
 * Requirements (issue #37 stage 5): a skill, or the level, that must reach a value before an item
 * can be equipped or used, or a harvest node gathered. Content writes them as `{ needs, atLeast }`,
 * the shape the skill platforms use: `needs` is a skill key, or exactly `level`. Pure.
 */
import { skillDisplay, skillValue } from "./fighter.ts";

export interface Requirement {
  needs: string;
  atLeast: number;
  text?: string;
}

/** What a requirement reads from a player. */
export interface Qualifications {
  level: number;
  skills: readonly number[];
}

/** The requirement is met: the level, or the skill (0 for a skill the world lacks), reaches it. */
export function requirementMet(r: Requirement, who: Qualifications): boolean {
  const have = r.needs === "level" ? who.level : skillValue(who.skills, r.needs);
  return have >= r.atLeast;
}

/**
 * The refusal for an unmet requirement: the row's own `text`, else "You need Mining 30 to <verb>
 * this." ("You need to be level 30 to …" for the level).
 */
export function requirementText(r: Requirement, verb: string): string {
  if (r.text !== undefined) {
    return r.text;
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
