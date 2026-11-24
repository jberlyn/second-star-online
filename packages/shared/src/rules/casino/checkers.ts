/**
 * Checkers. Pure rules over the content store's `casino.checkers`. A piece's `h`/`v` are the
 * sub-movie's sprite locs.
 */
import type { CasinoData } from "@secondstaronline/data";

import { onContent } from "../../content/store.ts";
import { hasBehaviour } from "../inventory/behaviours.ts";
import { legacyItem } from "./blackjack.ts";

type Checkers = NonNullable<CasinoData["checkers"]>;

let C: Checkers | undefined;
/** The rules the last store with this game had, for a game a publish leaves running. */
let LAST_C: Checkers | undefined;
export let CK_TEXT: Checkers["texts"];
export let CK_MARKER: Checkers["marker"];

onContent((c) => {
  C = c.casino.checkers;
  LAST_C = C ?? LAST_C;
  const r = LAST_C;
  // The last rules the world had: a match a publish leaves running finishes on them, and with none
  // ever, no item seats anyone (`isCheckersTable`), so these are never read.
  CK_TEXT = r?.texts ?? { stand: "", black: "", white: "", start: "", win: "", taken: "" };
  CK_MARKER = r?.marker ?? { black: [0, 0], white: [0, 0] };
});

/** Checkers, past the `isCheckersTable` gate (which is false in a world without it). */
function ck(): Checkers {
  // A game already running when a publish took this one out finishes on the rules it began with;
  // no new one starts (the gate is false). A world that never had it has no game to finish.
  const rules = C ?? LAST_C;
  if (!rules) {
    throw new Error("this world has no checkers");
  }
  return rules;
}

/**
 * An item with the `checkersTable` behaviour sits you down (Classic: exactly "Checkers Table", the
 * only name 1.6 seated; its click and Ctrl also routed longer names, which then sat no one).
 */
export function isCheckersTable(name: string): boolean {
  return C !== undefined && (hasBehaviour(name, "checkersTable") || legacyItem(name, C.item));
}

export type PieceName = "Black" | "White" | "BlackKing" | "WhiteKing";
/** Captured pieces have `v < 0` (they move −864, −864). */
export type Piece = { h: number; v: number; m: PieceName };
export type Side = 1 | 2;

/** The 24 pieces of frame 1, channels 2-25 (0-11 Black, 12-23 White). */
export function startBoard(): Piece[] {
  return ck().start.map((p) => ({ h: p.h, v: p.v, m: p.m }));
}

/** Side 1 owns names containing "Black", side 2 those containing "White". */
export function ownedBy(side: Side, m: PieceName): boolean {
  return m.startsWith(side === 1 ? "Black" : "White");
}

export type CheckersMove =
  | { kind: "none" }
  | { kind: "step"; board: Piece[] }
  | { kind: "jump"; board: Piece[]; captured: number };

const none: CheckersMove = { kind: "none" };

const DIRS = [-1, 1] as const;

function rawMove(
  board: readonly Piece[],
  index: number,
  side: Side,
  dh: number,
  dv: number,
): CheckersMove {
  const piece = board[index];
  if (!piece || piece.v <= 0 || !ownedBy(side, piece.m) || (dh !== -1 && dh !== 1)) {
    return none;
  }
  if (
    (dv !== -1 && dv !== 1) ||
    (piece.m === "Black" && dv === 1) ||
    (piece.m === "White" && dv === -1)
  ) {
    return none;
  }
  const B = ck().bounds;
  const inside = (n: number): boolean => {
    const h = piece.h + ck().step * n * dh;
    const v = piece.v + ck().step * n * dv;
    return h >= B.hMin && h <= B.hMax && v >= B.vMin && v <= B.vMax;
  };
  const at = (h: number, v: number): number => board.findIndex((p) => p.h === h && p.v === v);
  const next = at(piece.h + ck().step * dh, piece.v + ck().step * dv);
  const moved = (n: number): Piece[] =>
    board.map((p, i) =>
      i === index ? { ...p, h: piece.h + ck().step * n * dh, v: piece.v + ck().step * n * dv } : p,
    );
  const adjacent = board[next];
  if (adjacent) {
    if (ownedBy(side, adjacent.m)) {
      return none;
    }
    if (at(piece.h + ck().jump * dh, piece.v + ck().jump * dv) >= 0 || !inside(2)) {
      return none;
    }
    const after = moved(2);
    after[next] = { ...adjacent, h: adjacent.h + ck().captured, v: adjacent.v + ck().captured };
    return { kind: "jump", board: after, captured: next };
  }
  return inside(1) ? { kind: "step", board: moved(1) } : none;
}

/** Whether `index` has a legal jump on `board` for `side`. */
export function pieceHasJump(board: readonly Piece[], index: number, side: Side): boolean {
  for (const dh of DIRS) {
    for (const dv of DIRS) {
      if (rawMove(board, index, side, dh, dv).kind === "jump") {
        return true;
      }
    }
  }
  return false;
}

/** Whether `side` has any legal jump on `board`. */
export function sideHasJump(board: readonly Piece[], side: Side): boolean {
  return board.some((_, i) => pieceHasJump(board, i, side));
}

/** Whether `side` has any legal move (step or jump) on `board`. */
export function sideHasMove(board: readonly Piece[], side: Side): boolean {
  for (let i = 0; i < board.length; i += 1) {
    for (const dh of DIRS) {
      for (const dv of DIRS) {
        if (rawMove(board, i, side, dh, dv).kind !== "none") {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * The board-click rule for one chosen piece and the click's direction: enforces multi-jump
 * continuation (`jumpFrom`) and forced capture when a jump is available. `dh` and `dv` are −1 or 1.
 */
export function checkersMove(
  board: readonly Piece[],
  index: number,
  side: Side,
  dh: number,
  dv: number,
  jumpFrom: number | null = null,
): CheckersMove {
  if (jumpFrom !== null && index !== jumpFrom) {
    return none;
  }
  const move = rawMove(board, index, side, dh, dv);
  if (move.kind === "step") {
    const mustJump =
      jumpFrom !== null ? pieceHasJump(board, jumpFrom, side) : sideHasJump(board, side);
    if (mustJump) {
      return none;
    }
  }
  return move;
}

/** After every move: Black at V < 57 is a king, White at V > 270. */
export function promote(board: readonly Piece[], index: number): Piece[] {
  return board.map((p, i) => {
    if (i !== index) {
      return p;
    }
    if (p.m === "Black" && p.v < ck().kingBelow) {
      return { ...p, m: "BlackKing" };
    }
    return p.m === "White" && p.v > ck().kingAbove ? { ...p, m: "WhiteKing" } : p;
  });
}

/** The side with no piece left on the board (V > 0) or no legal move loses. */
export function loser(board: readonly Piece[], nextTurn?: Side): Side | null {
  const alive = (side: Side) => board.some((p) => p.v > 0 && ownedBy(side, p.m));
  if (!alive(1)) {
    return 1;
  }
  if (!alive(2)) {
    return 2;
  }
  if (nextTurn !== undefined) {
    return sideHasMove(board, nextTurn) ? null : nextTurn;
  }
  if (!sideHasMove(board, 1)) {
    return 1;
  }
  return sideHasMove(board, 2) ? null : 2;
}
