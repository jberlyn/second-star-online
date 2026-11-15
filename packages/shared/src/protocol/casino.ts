/** The slot machine, Blackjack and Checkers. */
import { z } from "zod";

/**
 * The Slot Machine panel: the lever and Close. The server decides everything else: the panel is
 * open and idle, the gold, the reels.
 */
export const slotPullSchema = z.strictObject({ t: z.literal("slotPull") });

export const slotCloseSchema = z.strictObject({ t: z.literal("slotClose") });

/**
 * The Blackjack Table: a bid click sends the field text (the server runs the original's bid
 * checks), Hit and Stand, Leave.
 */
export const bjBidSchema = z.strictObject({ t: z.literal("bjBid"), text: z.string().max(16) });

export const bjHitSchema = z.strictObject({ t: z.literal("bjHit") });

export const bjStandSchema = z.strictObject({ t: z.literal("bjStand") });

export const bjLeaveSchema = z.strictObject({ t: z.literal("bjLeave") });

/**
 * The Checkers window: a piece (0-23: channels 2-25) moved one square or jump towards the click, as
 * the sign of its offset; closing the window quits.
 */
export const ckMoveSchema = z.strictObject({
  t: z.literal("ckMove"),
  piece: z.number().int().min(0).max(23),
  dh: z.union([z.literal(-1), z.literal(1)]),
  dv: z.union([z.literal(-1), z.literal(1)]),
});

export const ckCloseSchema = z.strictObject({ t: z.literal("ckClose") });

export type CasinoServerMsg =
  /** The slot panel opens or closes. It survives a map change. */
  | { t: "slot"; open: boolean }
  /** A pull is settling: the reels spin until `slotResult`. */
  | { t: "slotSpin" }
  /**
   * The settled reels (`winslot`/`loseslot`); `null` reels: the lever goes back and the reels stop.
   */
  | { t: "slotResult"; reels: [number, number, number] | null; win: boolean }
  /**
   * The Blackjack Table: the whole table as `side` sees it, after every change. `hands` hold card
   * numbers 51-60, or `"back"` for the opponent's hidden second card.
   */
  | { t: "bj"; open: false }
  | {
      t: "bj";
      open: true;
      side: 1 | 2;
      names: [string, string];
      fields: [string, string];
      locked: [boolean, boolean];
      hands: [(number | "back")[], (number | "back")[]];
      sfx: ("shuffle" | "deal" | "cash")[];
    }
  /** The Checkers window: both names, the pieces; `moved` carries the new turn. */
  | { t: "ck"; open: false }
  | {
      t: "ck";
      open: true;
      side: 1 | 2;
      names: [string, string];
      pieces: { h: number; v: number; m: "Black" | "White" | "BlackKing" | "WhiteKing" }[];
      moved?: { turn: 1 | 2 };
    };
