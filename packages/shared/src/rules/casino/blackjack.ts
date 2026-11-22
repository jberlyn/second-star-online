/** Blackjack. Pure rules over the content store's `casino.blackjack`. */
import type { CasinoData } from "@secondstaronline/data";

import { onContent } from "../../content/store.ts";
import { lingoEq, lingoInteger, type Rng } from "../core/lingo.ts";

type Blackjack = CasinoData["blackjack"];

let B: Blackjack;
export let BJ_ITEM: string;
export let BJ_TEXT: Blackjack["texts"];
export let BJ_MAX_BID: number;
export let BJ_HAND_SIZE: number;
export let BJ_RESET_FRAMES: number;
export let BJ_BID_BLOCK: Blackjack["bidBlock"];
export let BJ_BUTTON_BLOCK: Blackjack["buttonBlock"];
let ACE: number;

onContent((c) => {
  B = c.casino.blackjack;
  BJ_ITEM = B.item.text;
  BJ_TEXT = B.texts;
  BJ_MAX_BID = B.maxBid;
  BJ_HAND_SIZE = B.handSize;
  BJ_RESET_FRAMES = B.resetFrames;
  BJ_BID_BLOCK = B.bidBlock;
  BJ_BUTTON_BLOCK = B.buttonBlock;
  ACE = B.cards.base + 1;
});

/** The exact name that sits (comparison ignores case). */
export function isBlackjackTable(name: string): boolean {
  return lingoEq(name, BJ_ITEM);
}

/** `{USER}`-style text slots. */
export function fill(text: string, slots: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (_m, k: string) => String(slots[k] ?? ""));
}

/** A card is drawn from a 13-rank shoe: 51 (Ace)..59 (9) at 1/13 each, 60 (10/J/Q/K) at 4/13. */
export function drawCard(rng: Rng): number {
  return B.cards.base + Math.min(rng.random(13), B.cards.faces);
}

/** A card's value with the Ace as 11. */
export function cardValue(card: number): number {
  return B.values[String(card)] ?? 0;
}

/**
 * `handTotal`: count each Ace as 11, then reduce Aces from 11 to 1 one at a time while over 21.
 */
export function handTotal(cards: readonly number[]): number {
  let total = cards.reduce((n, c) => n + cardValue(c), 0);
  let aces = cards.filter((c) => c === ACE).length;
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return total;
}

export type BidCheck =
  | { kind: "none" }
  | { kind: "max" }
  | { kind: "poor" }
  | { kind: "ok"; bid: number };

/**
 * The client's checks, then the server's: requires a positive integer bid (`>= 1`); `<= 0` or
 * non-integers return `none`; > 99999 is the max text; gold short is the gold text.
 */
export function bidCheck(text: string, gold: number): BidCheck {
  const bid = lingoInteger(text);
  if (bid === null || bid < 1) {
    return { kind: "none" };
  }
  if (bid > BJ_MAX_BID) {
    return { kind: "max" };
  }
  return gold < bid ? { kind: "poor" } : { kind: "ok", bid };
}

/** The lower bid is the stake. */
export function stake(b1: number, b2: number): number {
  return Math.min(b1, b2);
}

export type Line = "draw" | 1 | 2;

/**
 * Settlement's checks: equal totals or both hands busting is a single draw; otherwise a bust loses
 * and the higher non-bust total wins.
 */
export function outcome(t1: number, t2: number): Line[] {
  if ((t1 > 21 && t2 > 21) || t1 === t2) {
    return ["draw"];
  }
  if (t2 > 21) {
    return [1];
  }
  if (t1 > 21) {
    return [2];
  }
  return [t1 > t2 ? 1 : 2];
}
