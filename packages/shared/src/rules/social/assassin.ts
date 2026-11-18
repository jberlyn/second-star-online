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
 * `CompareAss`: a killer at least as strong as the victim is paid from the victim's band, a weaker
 * one from its own; a rating past the last band takes the last band. 1.6 paid the victim's raw
 * rating at equal ratings or a deciding rating of 1800 or more (a bug fixed).
 */
export function compareAss(killer: number, victim: number): number {
  const band = (ladder: readonly { below: number; points: number }[], rating: number) =>
    (ladder.find((b) => rating < b.below) ?? ladder[ladder.length - 1])?.points ?? 0;
  return killer >= victim ? band(A.compare.stronger, victim) : band(A.compare.weaker, killer);
}

/** The points a kill is worth: Lightning forces 10. */
export function killPoints(mode: AssassinMode, killer: number, victim: number): number {
  return mode === "LIGHTNING" ? A.score.lightningPoints : compareAss(killer, victim);
}

/**
 * The ranking (the all-time legend table uses the same pass): the player's own entry is dropped,
 * and the entry goes after every remaining entry with an equal or higher score, so a tie ranks
 * below the entry it ties. Unranked (a full table whose last entry beats it) → `null`: the old
 * table stands. 1.6 ranked with strict comparisons, so a tie with any entry never ranked and left
 * the player's old, lower entry in place (bugs fixed).
 */
export function rankEntry(
  table: AssassinTable,
  entry: AssassinEntry,
  size: number = A.score.tableSize,
): AssassinTable | null {
  const others = table.filter((e) => e.id !== entry.id).slice(0, size);
  const at = others.findIndex((e) => entry.points > e.points);
  const out = [...others];
  out.splice(at < 0 ? out.length : at, 0, entry);
  if (out.indexOf(entry) >= size) {
    return null;
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
 * The prizes given, in place order: items 1-4, stopping at the first blank. 1.6 gave only items
 * 1-3, so the fourth line was never given (a bug fixed).
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
