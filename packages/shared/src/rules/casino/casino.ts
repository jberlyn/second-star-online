/**
 * The casino's slots and click gates. Pure rules over the content store's `casino.slots`.
 */
import type { CasinoData } from "@secondstaronline/data";

import { onContent } from "../../content/store.ts";
import { lingoContains, type Rng } from "../core/lingo.ts";
import { FACING_DELTA, type Facing } from "../movement/movement.ts";

type Slots = CasinoData["slots"];

let S: Slots;
export let SLOT_ITEM: string;
export let SLOT_TEXT: {
  readonly stand: string;
  readonly poor: string;
  readonly win: string;
  readonly lose: string;
};
export let SLOT_COST: number;
export let SLOT_SPIN_FRAMES: number;
export let SLOT_FX: Slots["fx"];
export let SLOT_FACES: number;
export let SLOT_CASH: Slots["cash"];

onContent((c) => {
  S = c.casino.slots;
  SLOT_ITEM = S.item.text;
  SLOT_TEXT = { stand: S.standText, poor: S.poorText, win: S.winText, lose: S.loseText };
  SLOT_COST = S.cost;
  SLOT_SPIN_FRAMES = S.spinFrames;
  SLOT_FX = S.fx;
  SLOT_FACES = S.faces;
  SLOT_CASH = S.cash;
});

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
