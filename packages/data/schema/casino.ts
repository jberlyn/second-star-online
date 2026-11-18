/**
 * Schema for the casino tables `data:build` emits from `packages/data/content/casino.json`: the Slot Machine's texts, cost and payouts, the
 * High Score Statue's text and block layout, and the Blackjack Table and Checkers Table.
 * Texts keep 1.6's wording; `taken` is an SSO text.
 *
 */
import { z } from "zod";

const text = z.string().min(1);
const point = z.tuple([z.number().int(), z.number().int()]);
const face = z.number().int().min(1).max(4);

export const casinoDataSchema = z.strictObject({
  slots: z.strictObject({
    /** The exact item name that plays; a longer name routes and does nothing. */
    item: z.strictObject({ text: z.string().min(1) }),
    standText: z.string().min(1),
    poorText: z.string().min(1),
    winText: z.string().min(1),
    loseText: z.string().min(1),
    /** Gold charged at the result. */
    cost: z.number().int().positive(),
    /** Base payout before a bonus: the gross payout of any winning row is this + bonus. */
    base: z.number().int().positive(),
    /** Each reel is `random(faces)`. */
    faces: z.number().int().positive(),
    /** In source order; the first matching row pays. */
    payouts: z
      .array(
        z.strictObject({
          faces: z.tuple([face, face, face]),
          bonus: z.number().int().positive(),
        }),
      )
      .min(1),
    /** 500 → 470 on the client's counter. */
    spinFrames: z.number().int().positive(),
    /** The spell FX name played on a win. */
    fx: z.string().min(1),
    sound: z.strictObject({ name: z.string().min(1), channels: z.number().int().positive() }),
    cash: z.strictObject({ name: z.string().min(1), ch: z.number().int().positive() }),
  }),
  blackjack: z.strictObject({
    /** The exact item name that sits. */
    item: z.strictObject({ text }),
    texts: z.strictObject({
      stand: text,
      /** `{USER}` is the other player. */
      joined: text,
      seat: text,
      left: text,
      bidMax: text,
      noGold: text,
      /** `{USER}`, `{BID}`. */
      bid: text,
      stake: text,
      holding: text,
      holds: text,
      won: text,
      draw: text,
      taken: text,
    }),
    maxBid: z.number().int().positive(),
    /** A card is `random(faces) + base`: crd51-crd60. */
    cards: z.strictObject({ base: z.number().int(), faces: z.number().int().positive() }),
    /** Card number → value, the Ace as 11. */
    values: z.record(z.string(), z.number().int()),
    handSize: z.number().int().positive(),
    resetFrames: z.number().int().positive(),
    bidBlock: z.number().int().positive(),
    buttonBlock: z.number().int().positive(),
  }),
  checkers: z.strictObject({
    item: z.strictObject({ text }),
    texts: z.strictObject({
      stand: text,
      black: text,
      white: text,
      start: text,
      win: text,
      taken: text,
    }),
    step: z.number().int().positive(),
    jump: z.number().int().positive(),
    bounds: z.strictObject({
      hMin: z.number().int(),
      hMax: z.number().int(),
      vMin: z.number().int(),
      vMax: z.number().int(),
    }),
    kingBelow: z.number().int(),
    kingAbove: z.number().int(),
    marker: z.strictObject({ black: point, white: point }),
    captured: z.number().int(),
    /** The 24 pieces from the sub-movie's frame 1, channels 2-25 (12 Black, then 12 White). */
    start: z
      .array(
        z.strictObject({
          h: z.number().int(),
          v: z.number().int(),
          m: z.enum(["Black", "White"]),
        }),
      )
      // 24 squares: protocol `piece` is 0-23 and the client has 24 buttons.
      .length(24),
  }),
});

export type CasinoData = z.infer<typeof casinoDataSchema>;
