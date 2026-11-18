/**
 * The High Score Statue: the server's top-ten ranking of player scores. Pure rules over the
 * generated `socialData.highScores`.
 *
 * 1.6 kept the board with its casino scripts; in SSO it is a plain ranking of every player on the
 * server, with nothing to do with the casino.
 */
import { socialData } from "@secondstaronline/data";

import { type AssassinEntry, type AssassinTable, topTenBlock } from "./assassin.ts";
import { bioScore } from "./bios.ts";

const H = socialData.highScores;

export const SCORES_ITEM = H.item.text;
export const SCORES_TEXT = H.text;
export const SCORES_PAUSE = H.pause;
export const SCORES_SIZE = H.tableSize;

/** The high-score points: the bio score, which counts every skill, HPmax and SPmax. No cap. */
export function highScorePoints(skills: readonly number[], hpMax: number, spMax: number): number {
  return bioScore(skills, hpMax, spMax);
}

/**
 * Ranks a high-score entry into the table: keeps a player's higher existing score, compacts
 * remaining entries, and places ties right after the tied slot.
 */
export function rankHighScore(
  table: AssassinTable,
  entry: AssassinEntry,
  size: number = SCORES_SIZE,
): AssassinTable | null {
  const existing = table.find((e) => e.id === entry.id);
  if (existing && existing.points >= entry.points) {
    return null;
  }
  const rest = table.filter((e) => e.id !== entry.id);
  const slots: (AssassinEntry | null)[] = Array.from({ length: size }, (_, k) => rest[k] ?? null);
  const at = slots.findIndex((s) => entry.points > (s?.points ?? 0));
  if (at < 0) {
    return null;
  }
  const out: AssassinEntry[] = [];
  for (let k = 0; k < size; k += 1) {
    if (k === at) {
      out.push(entry);
    }
    const e = slots[k];
    if (e) {
      out.push(e);
    }
  }
  return out.slice(0, size);
}

/** The high-score board: one chat entry, the ten rows four to a line. */
export function scoresBlock(table: AssassinTable): string {
  return topTenBlock(
    {
      header: H.header,
      entry: H.entry,
      perLine: H.perLine,
      separator: H.separator,
      size: H.tableSize,
    },
    table,
  );
}
