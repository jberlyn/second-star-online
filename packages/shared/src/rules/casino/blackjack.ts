/** Blackjack. Pure rules over the content store's `casino.blackjack`. */
import type { CasinoData } from "@secondstaronline/data";

import { onContent } from "../../content/store.ts";
import { isEngineFixture } from "../core/fixtures.ts";
import { lingoEq, lingoInteger, type Rng } from "../core/lingo.ts";
import { hasBehaviour } from "../inventory/behaviours.ts";

type Blackjack = NonNullable<CasinoData["blackjack"]>;

let B: Blackjack | undefined;
/** The rules the last store with this game had, for a game a publish leaves running. */
let LAST_B: Blackjack | undefined;
export let BJ_TEXT: Blackjack["texts"];
export let BJ_MAX_BID: number;
export let BJ_HAND_SIZE: number;
export let BJ_RESET_FRAMES: number;
export let BJ_BID_BLOCK: Blackjack["bidBlock"];
export let BJ_BUTTON_BLOCK: Blackjack["buttonBlock"];
let ACE: number;

const NO_TEXTS: Blackjack["texts"] = {
  stand: "",
  joined: "",
  seat: "",
  left: "",
  bidMax: "",
  noGold: "",
  bid: "",
  stake: "",
  holding: "",
  holds: "",
  won: "",
  draw: "",
  taken: "",
};

onContent((c) => {
  B = c.casino.blackjack;
  LAST_B = B ?? LAST_B;
  const r = LAST_B;
  // The last rules the world had: a hand a publish leaves running finishes on them, and with none
  // ever, no item seats anyone (`isBlackjackTable`), so these are never read.
  BJ_TEXT = r?.texts ?? NO_TEXTS;
  BJ_MAX_BID = r?.maxBid ?? 0;
  BJ_HAND_SIZE = r?.handSize ?? 0;
  BJ_RESET_FRAMES = r?.resetFrames ?? 0;
  BJ_BID_BLOCK = r?.bidBlock ?? 1;
  BJ_BUTTON_BLOCK = r?.buttonBlock ?? 1;
  ACE = (r?.cards.base ?? 0) + 1;
});

/** Blackjack, past the `isBlackjackTable` gate (which is false in a world without it). */
function bj(): Blackjack {
  // A game already running when a publish took this one out finishes on the rules it began with;
  // no new one starts (the gate is false). A world that never had it has no game to finish.
  const rules = B ?? LAST_B;
  if (!rules) {
    throw new Error("this world has no blackjack");
  }
  return rules;
}

/**
 * An item with the `blackjackTable` behaviour sits you down (Classic: exactly "Blackjack Table",
 * the only name 1.6 seated; its click and Ctrl also routed longer names, which then sat no one).
 */
export function isBlackjackTable(name: string): boolean {
  return B !== undefined && (hasBehaviour(name, "blackjackTable") || legacyItem(name, B.item));
}

/**
 * A casino game's `item` from a pack or operator change made before the behaviours: its exact name
 * still plays, as it did (Classic's casino.json no longer sets it).
 */
export function legacyItem(name: string, item: { text: string } | undefined): boolean {
  return item !== undefined && !isEngineFixture(name) && lingoEq(name, item.text);
}

/** `{USER}`-style text slots. */
export function fill(text: string, slots: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (_m, k: string) => String(slots[k] ?? ""));
}

/** A card is drawn from a 13-rank shoe: 51 (Ace)..59 (9) at 1/13 each, 60 (10/J/Q/K) at 4/13. */
export function drawCard(rng: Rng): number {
  const { cards } = bj();
  return cards.base + Math.min(rng.random(13), cards.faces);
}

/** A card's value with the Ace as 11. */
export function cardValue(card: number): number {
  return bj().values[String(card)] ?? 0;
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
