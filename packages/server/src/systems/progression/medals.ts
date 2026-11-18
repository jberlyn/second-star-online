/**
 * Medals on the server. A medal and its stat points are calculated from the skills (shared
 * `heldMedals`, `effectiveStats`), so nothing is granted or saved here; this only prints the award
 * line when a skill reaches 90 in play. The session's first tick records the skills without a
 * line: a medal already held at login just shows.
 */
import { CHAT_COLOR, newMedalLines } from "@secondstaronline/shared";

import type { Outgoing, Player } from "../world/world.ts";

/** The award lines for `p` if a skill reached 90 since the last look. */
export function medalCheck(p: Player): Outgoing[] {
  const before = p.awardSkills;
  if (before !== null && before.join(",") === p.char.skills.join(",")) {
    return [];
  }
  p.awardSkills = [...p.char.skills];
  if (before === null) {
    return [];
  }
  return newMedalLines(before, p.char.skills).map((text) => ({
    to: p.id,
    msg: { t: "chat", text, color: CHAT_COLOR.normal },
  }));
}
