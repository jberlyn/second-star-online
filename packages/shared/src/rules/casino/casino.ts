/**
 * The casino's slots and click gates. Pure rules over the content store's `casino.slots`.
 */
import type { CasinoData } from "@secondstaronline/data";

import { onContent } from "../../content/store.ts";
import { isEngineFixture } from "../core/fixtures.ts";
import { lingoContains, type Rng } from "../core/lingo.ts";
import { hasBehaviour } from "../inventory/behaviours.ts";
import { FACING_DELTA, type Facing } from "../movement/movement.ts";

type Slots = NonNullable<CasinoData["slots"]>;

let S: Slots | undefined;
/** The rules the last store with this game had, for a game a publish leaves running. */
let LAST_S: Slots | undefined;
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
  LAST_S = S ?? LAST_S;
  const r = LAST_S;
  // The last rules the world had: a spin a publish leaves running finishes on them, and with none
  // ever, no item plays (`isSlotMachine`), so these are never read.
  SLOT_TEXT = {
    stand: r?.standText ?? "",
    poor: r?.poorText ?? "",
    win: r?.winText ?? "",
    lose: r?.loseText ?? "",
  };
  SLOT_COST = r?.cost ?? 0;
  SLOT_SPIN_FRAMES = r?.spinFrames ?? 0;
  SLOT_FX = r?.fx ?? "";
  SLOT_FACES = r?.faces ?? 1;
  SLOT_CASH = r?.cash ?? { name: "", ch: 1 };
});

/** The slots, past the `isSlotMachine` gate (which is false in a world without them). */
function slots(): Slots {
  // A game already running when a publish took this one out finishes on the rules it began with;
  // no new one starts (the gate is false). A world that never had it has no game to finish.
  const rules = S ?? LAST_S;
  if (!rules) {
    throw new Error("this world has no slot machines");
  }
  return rules;
}

/**
 * An item with the `slotMachine` behaviour (Classic: a name containing "Slot Machine") plays, in a
 * world that has slots.
 */
export function isSlotMachine(name: string): boolean {
  if (!S) {
    return false;
  }
  return (
    hasBehaviour(name, "slotMachine") ||
    (S.item !== undefined && !isEngineFixture(name) && lingoContains(name, S.item.text))
  );
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
  const { faces } = slots();
  const a = rng.random(faces);
  const b = rng.random(faces);
  const c = rng.random(faces);
  return [a, b, c];
}

/** The gross payout: 0, or `base` + the first matching row's bonus. */
export function slotPayout(reels: readonly [number, number, number]): number {
  const s = slots();
  const row = s.payouts.find((r) => r.faces.every((f, i) => f === reels[i]));
  return row ? s.base + row.bonus : 0;
}

export type SlotSettlement = { ok: false } | { ok: true; gold: number; win: boolean };

/**
 * The slot spin settlement: charge 5, pay the gross on a win; gold below 5 exits sending nothing
 * (SSO answers it with the poor text and a stopped lever).
 */
export function slotSettle(gold: number, reels: readonly [number, number, number]): SlotSettlement {
  const { cost } = slots();
  if (gold - cost < 0) {
    return { ok: false };
  }
  const gross = slotPayout(reels);
  return { ok: true, gold: gold - cost + gross, win: gross > 0 };
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
