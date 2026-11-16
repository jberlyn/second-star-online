/**
 * The casino's slots and high scores. Pure rules over the generated `casinoData`.
 */
import { casinoData, socialData } from "@secondstaronline/data";

import { skillValue } from "../core/fighter.ts";
import { lingoContains, type Rng } from "../core/lingo.ts";
import { FACING_DELTA, type Facing } from "../movement/movement.ts";
import { type AssassinEntry, type AssassinTable, topTenBlock } from "../social/assassin.ts";
import { bioScore } from "../social/bios.ts";

const S = casinoData.slots;
const H = casinoData.scores;

export const SLOT_ITEM = S.item.text;
export const SLOT_TEXT = {
  stand: S.standText,
  poor: S.poorText,
  win: S.winText,
  lose: S.loseText,
} as const;
export const SLOT_COST = S.cost;
export const SLOT_SPIN_FRAMES = S.spinFrames;
export const SLOT_FX = S.fx;
export const SLOT_FACES = S.faces;
export const SLOT_CASH = S.cash;

/** Any item whose name contains "Slot Machine" (ignoring case) opens and plays. */
export function isSlotMachine(name: string): boolean {
  return lingoContains(name, SLOT_ITEM);
}

/**
 * `SlotMachineClick`'s position test: facing N on the tile directly south of the machine. 1.6
 * compares pixels, so it fails mid-step; SSO compares tiles with `stepFrames = 0`, as the Guild
 * Center does.
 */
export function slotOpenCheck(
  p: { x: number; y: number; facing: Facing; stepFrames: number },
  machine: { x: number; y: number },
): "open" | "stand" {
  const [dx, dy] = FACING_DELTA[p.facing];
  return p.facing === "N" && p.stepFrames === 0 && p.x + dx === machine.x && p.y + dy === machine.y
    ? "open"
    : "stand";
}

/** Three reels, `random(4)` each in order. */
export function slotReels(rng: Rng): [number, number, number] {
  const a = rng.random(S.faces);
  const b = rng.random(S.faces);
  const c = rng.random(S.faces);
  return [a, b, c];
}

/** The gross payout: 0, or `base` + the first matching row's bonus. */
export function slotPayout(reels: readonly [number, number, number]): number {
  const row = S.payouts.find((r) => r.faces.every((f, i) => f === reels[i]));
  return row ? S.base + row.bonus : 0;
}

export type SlotSettlement = { ok: false } | { ok: true; gold: number; win: boolean };

/**
 * The slot spin settlement: charge 5, pay the gross on a win; gold below 5 exits sending nothing
 * (SSO answers it with the poor text and a stopped lever).
 */
export function slotSettle(gold: number, reels: readonly [number, number, number]): SlotSettlement {
  if (gold - S.cost < 0) {
    return { ok: false };
  }
  const gross = slotPayout(reels);
  return { ok: true, gold: gold - S.cost + gross, win: gross > 0 };
}

export const SCORES_ITEM = H.item.text;
export const SCORES_TEXT = H.text;
export const SCORES_PAUSE = H.pause;
export const SCORES_SIZE = H.tableSize;

/** The high-score points: `bioScore` plus the 8 formerly dropped skills (`Lumberjacking`, `Archery`, `Blessing`, `Musicianship`, `Illusion`, `Punch`, `Fire`, `Wind`). */
export function highScorePoints(skills: readonly number[], hpMax: number, spMax: number): number {
  return socialData.bios.score.lost.reduce(
    (sum, name) => sum + skillValue(skills, name),
    bioScore(skills, hpMax, spMax),
  );
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

/** Immortals and five-digit scores send nothing. */
export function submitsScore(points: number, immortal: boolean): boolean {
  return !immortal && String(points).length <= H.maxDigits;
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

/**
 * Which side of a Blackjack or Checkers Table you stand on: the tile west of the table (table =
 * your tile + 1 x, same row) is Player 1, the tile east is Player 2; no facing test. 1.6 compares
 * pixels, so mid-step fails; SSO compares tiles with `stepFrames = 0`, as `slotOpenCheck` does.
 */
export function casinoSide(
  p: { x: number; y: number; stepFrames: number },
  table: { x: number; y: number },
): 1 | 2 | null {
  if (p.stepFrames !== 0 || p.y !== table.y) {
    return null;
  }
  if (p.x + 1 === table.x) {
    return 1;
  }
  return p.x - 1 === table.x ? 2 : null;
}
