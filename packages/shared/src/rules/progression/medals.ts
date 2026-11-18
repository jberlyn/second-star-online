/**
 * Medals, calculated from skills over the generated `socialData.medals` table.
 *
 * A skill at 90 or more holds its medal: the medal shows on the bio and its stat points are added
 * to the character's allocated stats (`effectiveStats`, stats.ts). A skill that falls below 90
 * loses both. Nothing is granted or stored (a design change: 1.6 appended the medal id to the
 * `Medals` field and added its points to the stored stats for good, and only when a skill reached
 * exactly 90).
 */
import { socialData } from "@secondstaronline/data";

import { skillValue } from "../core/fighter.ts";

const M = socialData.medals;

export type MedalStat = "str" | "sta" | "dex" | "int" | "wis";

/** The skill level a medal needs, at least. */
export const MEDAL_AT = M.at;

export type MedalAward = (typeof M.awards)[number];

/** The medals `skills` hold, in the table's order. */
export function heldMedals(skills: readonly number[]): MedalAward[] {
  return M.awards.filter((a) => skillValue(skills, a.skill) >= M.at);
}

/** The held medals as the bio's medal field: `id-id-…`. */
export function medalField(skills: readonly number[]): string {
  return heldMedals(skills)
    .map((a) => `${a.id}-`)
    .join("");
}

/** The stat points the held medals add. */
export function medalBonus(skills: readonly number[]): Partial<Record<MedalStat, number>> {
  const out: Partial<Record<MedalStat, number>> = {};
  for (const a of heldMedals(skills)) {
    for (const [k, v] of Object.entries(a.stats) as [MedalStat, number][]) {
      out[k] = (out[k] ?? 0) + v;
    }
  }
  return out;
}

/** The award lines for medals `after` holds and `before` did not, in the table's order. */
export function newMedalLines(before: readonly number[], after: readonly number[]): string[] {
  return M.awards
    .filter((a) => skillValue(before, a.skill) < M.at && skillValue(after, a.skill) >= M.at)
    .map((a) => a.text);
}
