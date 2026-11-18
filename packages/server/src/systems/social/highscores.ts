/**
 * The High Score Statue's table on the server: a ranking of every player's score, checked with each
 * periodic save. 1.6 kept it with its casino scripts; it has nothing to do with the casino.
 */
import { highScorePoints, rankHighScore, SCORES_SIZE } from "@secondstaronline/shared";

import type { Player, World } from "../world/world.ts";

/**
 * The high-score check on a save tick: immortals send nothing; a ranked score replaces the table.
 * There is no upper limit, so a server that raises skill caps sees it in the scores (1.6 skipped
 * scores of five digits or more).
 */
export function submitHighScore(world: World, p: Player): void {
  if (p.role === "immortal") {
    return;
  }
  const v = p.char.vitals;
  const points = highScorePoints(p.char.skills, v.hpMax, v.spMax);
  const next = rankHighScore(world.highScores, { id: p.id, name: p.name, points }, SCORES_SIZE);
  if (next) {
    world.highScores = next;
    world.highScoresDirty = true;
  }
}
