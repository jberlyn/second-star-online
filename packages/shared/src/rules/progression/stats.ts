/**
 * The stats a character plays with, calculated: the allocated stats, plus the class's
 * `statBonus` (classes.json), plus the points of every medal its skills hold. Neither bonus is
 * stored, so a class or a medal can be rebalanced and every character follows (a design change:
 * 1.6 added a promotion's and a medal's points to the stored stats for good).
 */
import { resolvedClass } from "./classes.ts";
import { medalBonus } from "./medals.ts";

export type StatKey = "str" | "sta" | "dex" | "int" | "wis";

/** The stat points class `classCode` adds, with what it inherits (issue #15). */
export function classStatBonus(classCode: number): Partial<Record<StatKey, number>> {
  return resolvedClass(classCode).statBonus;
}

/** The allocated stats plus the class's and the held medals' points; `stats` is untouched. */
export function effectiveStats<T extends Record<StatKey, number>>(
  stats: T,
  classCode: number,
  skills: readonly number[],
): T {
  const out = { ...stats };
  for (const bonus of [classStatBonus(classCode), medalBonus(skills)]) {
    for (const [k, v] of Object.entries(bonus) as [StatKey, number][]) {
      out[k] += v;
    }
  }
  return out;
}
