/**
 * The Assassin's game. Pure rules over the generated `socialData` (the generated assassin data).
 */
import { itemsData, socialData } from "@secondstaronline/data";

import { skillValue } from "../core/fighter.ts";
import { lingoEq, lingoWord } from "../core/lingo.ts";
import { isGoldName } from "../inventory/inventory.ts";

const A = socialData.assassin;

/** `MODE.txt`: GO (normal), LIGHTNING, STOP (none running; the archive's value). */
export type AssassinMode = "GO" | "LIGHTNING" | "STOP";

/** A table entry: who (by id, with a copy of the name) and the score. */
export interface AssassinEntry {
  id: string;
  name: string;
  points: number;
}

/** The current or all-time top 10 in table order (`assassinsscore.txt`, `permassassinsscore.txt`). */
export type AssassinTable = AssassinEntry[];

export interface AssassinState {
  mode: AssassinMode;
  /** `assassinsscore.txt`. */
  current: AssassinTable;
  /** `permassassinsscore.txt` (points = wins). */
  legends: AssassinTable;
  /** `<name>.txt`: points this game, by character id. */
  scores: Map<string, number>;
  /** `<name>X.txt`: games won, by character id. */
  wins: Map<string, number>;
}

/** No game ever run: `MODE.txt` reads STOP in the archive, every table empty. */
export function emptyAssassinState(): AssassinState {
  return { mode: "STOP", current: [], legends: [], scores: new Map(), wins: new Map() };
}

/** A game is running: scoring exits on OFF, PAUSE, STOP, VOID or "". */
export function scoring(mode: AssassinMode): boolean {
  return mode === "GO" || mode === "LIGHTNING";
}

/** `MyCombatRating`: sixteen combat skills plus HPmax. */
export function combatRating(skills: readonly number[], hpMax: number): number {
  return A.rating.skills.reduce((sum, s) => sum + skillValue(skills, s), hpMax);
}

/**
 * `CompareAss`: a stronger killer is paid from the victim's band, a weaker one from its own; equal
 * ratings, or a deciding rating of 1800 or more, leave the victim's raw rating (kept bug: 1.6 did
 * this). The ladders overwrite in order, so the lowest band the rating is under wins.
 */
export function compareAss(killer: number, victim: number): number {
  const band = (ladder: readonly { below: number; points: number }[], rating: number) =>
    ladder.find((b) => rating < b.below)?.points;
  if (killer > victim) {
    return band(A.compare.stronger, victim) ?? victim;
  }
  if (killer < victim) {
    return band(A.compare.weaker, killer) ?? victim;
  }
  return victim;
}

/** The points a kill is worth: Lightning forces 10. */
export function killPoints(mode: AssassinMode, killer: number, victim: number): number {
  return mode === "LIGHTNING" ? A.score.lightningPoints : compareAss(killer, victim);
}

/**
 * The tie-blind ranking (the all-time legend table uses the same pass): the player's own entry is
 * blanked and counts 0, as empty slots do; the entry goes before the first slot k with `score <
 * H(k-1)` and `score > Hk` (k = 1: `score > H1`). Unranked (a tie with any entry; a kept bug of
 * 1.6) → `null`: the file is not rewritten, so the old entry stays. The High Score table (the
 * original's high-score check) is the same algorithm at its own size.
 */
export function rankEntry(
  table: AssassinTable,
  entry: AssassinEntry,
  size: number = A.score.tableSize,
): AssassinTable | null {
  const slots: (AssassinEntry | null)[] = Array.from({ length: size }, (_, k) => {
    const e = table[k];
    return e && e.id !== entry.id ? e : null;
  });
  const val = (k: number) => slots[k]?.points ?? 0;
  let at = -1;
  if (entry.points > val(0)) {
    at = 0;
  } else {
    for (let k = 1; k < size; k += 1) {
      if (entry.points < val(k - 1) && entry.points > val(k)) {
        at = k;
        break;
      }
    }
  }
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

/** The start lines (Lightning and normal), to everyone. */
export function startLines(mode: "GO" | "LIGHTNING"): readonly string[] {
  return mode === "LIGHTNING" ? A.start.lightning : A.start.normal;
}

/** "*** <name> just received <N> assassin points!" */
export function scoreLine(name: string, points: number): string {
  return A.score.text.replace("{NAME}", name).replace("{POINTS}", String(points));
}

/**
 * The end lines. With nobody scored only the first and last print; a missing second or third name
 * prints blank, as in 1.6.
 */
export function endLines(table: AssassinTable): string[] {
  const [ended, first, second, back] = A.end.lines as [string, string, string, string];
  if (table.length === 0) {
    return [ended, back];
  }
  const name = (k: number) => table[k]?.name ?? "";
  return [
    ended,
    first.replace("{W1}", name(0)).replace("{POINTS}", String(table[0]?.points ?? "")),
    second.replace("{W2}", name(1)).replace("{W3}", name(2)),
    back,
  ];
}

/** The Statue's line, "You view the top Assassins of FSO..." */
export const STATUE_ITEM = A.statue.item;
export const STATUE_TEXT = A.statue.text;
/** 20 frames: the original's pause between item actions. */
export const STATUE_PAUSE = A.statue.pause;

/**
 * The all-time scores display (both original draw routines): a return, the header, two returns,
 * then ten entries `N. <name> - <points> points`, four to a line six spaces apart; an empty entry
 * prints `N.  -  points`. The all-time block counts wins as "points".
 */
export function statueBlock(kind: "allTime" | "current", table: AssassinTable): string {
  const header = kind === "allTime" ? A.statue.allTimeHeader : A.statue.currentHeader;
  return topTenBlock(
    {
      header,
      entry: A.statue.entry,
      perLine: A.statue.perLine,
      separator: A.statue.separator,
      size: A.score.tableSize,
    },
    table,
  );
}

/** The layout shared by the Assassin Statue's blocks and the High Score Statue's. */
export interface TopTenLayout {
  header: string;
  entry: string;
  perLine: number;
  separator: string;
  size: number;
}

/**
 * A return, the header, two returns, then `size` entries `N. <name> - <points> points`,
 * `perLine` to a line, `separator` apart; an empty entry prints `N.  -  points`.
 */
export function topTenBlock(layout: TopTenLayout, table: AssassinTable): string {
  const entries = Array.from({ length: layout.size }, (_, k) =>
    layout.entry
      .replace("{N}", String(k + 1))
      .replace("{NAME}", table[k]?.name ?? "")
      .replace("{POINTS}", table[k] ? String(table[k].points) : ""),
  );
  const rows: string[] = [];
  for (let k = 0; k < entries.length; k += layout.perLine) {
    rows.push(entries.slice(k, k + layout.perLine).join(layout.separator));
  }
  return `\n${layout.header}\n\n${rows.join("\n")}`;
}

/** The archive's prizes, `Long Sword:1000 Gold:500 Gold:Knife`. */
export const ARCHIVED_PRIZES: readonly string[] = A.prizes.archived.split(":");

/**
 * The prizes given, in place order: items 1-3, stopping at the first blank; the fourth is never
 * given (kept bug: 1.6 did this).
 */
export function prizesGiven(prizes: readonly string[]): string[] {
  const out: string[] = [];
  for (const p of prizes.slice(0, A.prizes.awarded)) {
    if (p.trim() === "") {
      break;
    }
    out.push(p.trim());
  }
  return out;
}

/**
 * A prize line the setting accepts: blank, an item of the catalogue or a fixture, or `<n> Gold`
 * with n > 0 (InvAdd's gold branch).
 */
export function prizeLineOk(line: string): boolean {
  const s = line.trim();
  if (s === "") {
    return true;
  }
  if (isGoldName(s)) {
    return (
      /^\d+$/.test(lingoWord(s, 1)) &&
      Number(lingoWord(s, 1)) > 0 &&
      lingoEq(s.split(" ").slice(1).join(" "), "Gold")
    );
  }
  return (
    itemsData.items.some((i) => lingoEq(i.name, s)) || itemsData.fixtures.some((f) => lingoEq(f, s))
  );
}
