/**
 * Medals (the award check). Pure rules over the generated `socialData.medals`
 * (the generated social data).
 *
 * After every skill save (the skill save ends with the award check), each skill **exactly at 90**
 * whose id is not yet in the `Medals` field (a case-insensitive substring check for "<id>-") gets
 * it: `<id>-` appended, its line, its stat points (`Regged` is always 1). A skill that skips 90
 * never earns it (a kept bug: 1.6 did this).
 */
import { socialData } from "@secondstaronline/data";

import { skillValue } from "../core/fighter.ts";

const M = socialData.medals;

export type MedalStat = "str" | "sta" | "dex" | "int" | "wis";

/** The skill level a medal needs, exactly. */
export const MEDAL_AT = M.at;

/** The award check, in the script's order. */
export function checkForAwards(
  skills: readonly number[],
  medals: string,
): { medals: string; lines: string[]; stats: Partial<Record<MedalStat, number>> } {
  let out = medals;
  const lines: string[] = [];
  const stats: Partial<Record<MedalStat, number>> = {};
  for (const a of M.awards) {
    if (skillValue(skills, a.skill) !== M.at || out.includes(`${a.id}-`)) {
      continue;
    }
    out += `${a.id}-`;
    lines.push(a.text);
    for (const [k, v] of Object.entries(a.stats) as [MedalStat, number][]) {
      stats[k] = (stats[k] ?? 0) + v;
    }
  }
  return { medals: out, lines, stats };
}
