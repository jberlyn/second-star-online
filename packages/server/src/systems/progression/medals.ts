/**
 * Medals on the server.
 *
 * 1.6 ran the award check at the end of every skill save: after each skill gain, an admin
 * `/Skill`, a class change and a death's skill penalty. The server runs it once a tick for every
 * player whose skills changed since it last looked, which is the same set of moments (a skill
 * changes only through those paths); the session's first tick only records them, as a login saved
 * no skills.
 */
import { CHAT_COLOR, checkForAwards, type MedalStat } from "@secondstaronline/shared";

import type { Outgoing, Player } from "../world/world.ts";

/**
 * The award check for `p` if its skills changed. Returns the award lines and whether the character
 * must be saved (1.6 saved the character after each award).
 */
export function medalCheck(p: Player): { out: Outgoing[]; save: boolean } {
  const now = p.char.skills.join(",");
  if (p.awardSkills === null || p.awardSkills === now) {
    p.awardSkills = now;
    return { out: [], save: false };
  }
  p.awardSkills = now;
  const r = checkForAwards(p.char.skills, p.char.medals);
  if (r.lines.length === 0) {
    return { out: [], save: false };
  }
  p.char.medals = r.medals;
  for (const [k, v] of Object.entries(r.stats) as [MedalStat, number][]) {
    p.char.stats[k] += v;
  }
  return {
    out: r.lines.map((text) => ({ to: p.id, msg: { t: "chat", text, color: CHAT_COLOR.normal } })),
    save: true,
  };
}
