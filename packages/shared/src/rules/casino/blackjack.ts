/** Blackjack. Pure rules over the generated `casinoData`. */
import { casinoData } from "@secondstaronline/data";

import { lingoEq, lingoInteger, type Rng } from "../core/lingo.ts";

const B = casinoData.blackjack;

export const BJ_ITEM = B.item.text;
export const BJ_TEXT = B.texts;
export const BJ_MAX_BID = B.maxBid;
export const BJ_HAND_SIZE = B.handSize;
export const BJ_RESET_FRAMES = B.resetFrames;
export const BJ_BID_BLOCK = B.bidBlock;
export const BJ_BUTTON_BLOCK = B.buttonBlock;

/** The exact name that sits (comparison ignores case). */
export function isBlackjackTable(name: string): boolean {
  return lingoEq(name, BJ_ITEM);
}

/** `{USER}`-style text slots. */
export function fill(text: string, slots: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (_m, k: string) => String(slots[k] ?? ""));
}

/** A card is `random(10) + 50`: 51 (Ace) to 60, uniform with replacement. */
export function drawCard(rng: Rng): number {
  return rng.random(B.cards.faces) + B.cards.base;
}

/** A card's value with the Ace as 11. */
export function cardValue(card: number): number {
  return B.values[String(card)] ?? 0;
}

const ACE = B.cards.base + 1;

/**
 * `handTotal`: the sum with Ace = 11; over 21, subtract 10 for **every** Ace at once, then, still
 * inside that branch, add 11 if the result is under 11 (A-A is 13, A-A-9 is 11, A-A-A is 14).
 */
export function handTotal(cards: readonly number[]): number {
  let total = cards.reduce((n, c) => n + cardValue(c), 0);
  if (total > 21) {
    total -= 10 * cards.filter((c) => c === ACE).length;
    if (total < 11) {
      total += 11;
    }
  }
  return total;
}

export type BidCheck =
  | { kind: "none" }
  | { kind: "max" }
  | { kind: "poor" }
  | { kind: "ok"; bid: number };

/**
 * The client's checks, then the server's: the typed text reads as `integer` (a non-number as 0); <
 * 0 sends nothing; > 99999 is the max text; gold short is the gold text.
 */
export function bidCheck(text: string, gold: number): BidCheck {
  const bid = lingoInteger(text) ?? 0;
  if (bid < 0) {
    return { kind: "none" };
  }
  if (bid > BJ_MAX_BID) {
    return { kind: "max" };
  }
  return gold < bid ? { kind: "poor" } : { kind: "ok", bid };
}

/** The lower bid is the stake; a 0 bid makes a free game. */
export function stake(b1: number, b2: number): number {
  return Math.min(b1, b2);
}

export type Line = "draw" | 1 | 2;

/**
 * Settlement's checks run in this order: equal totals → draw; both bust → draw (and carry on); P2
 * bust and P1 not → P1; P1 bust and P2 not → P2; else the higher total, bust or not. The gold
 * follows the **last** entry: a side wins the stake, only draws refund.
 */
export function outcome(t1: number, t2: number): Line[] {
  const lines: Line[] = [];
  if (t1 === t2) {
    lines.push("draw");
  }
  if (t1 > 21 && t2 > 21) {
    lines.push("draw");
  }
  if (t2 > 21 && t1 <= 21) {
    lines.push(1);
  } else if (t1 > 21 && t2 <= 21) {
    lines.push(2);
  } else if (t1 > t2) {
    lines.push(1);
  } else if (t2 > t1) {
    lines.push(2);
  }
  return lines;
}
