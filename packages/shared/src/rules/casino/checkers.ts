/**
 * Checkers. Pure rules over the content store's `casino.checkers`. A piece's `h`/`v` are the
 * sub-movie's sprite locs.
 */
import type { CasinoData } from "@secondstaronline/data";

import { onContent } from "../../content/store.ts";
import { lingoEq } from "../core/lingo.ts";

type Checkers = CasinoData["checkers"];

let C: Checkers;
export let CK_ITEM: string;
export let CK_TEXT: Checkers["texts"];
export let CK_MARKER: Checkers["marker"];

onContent((c) => {
  C = c.casino.checkers;
  CK_ITEM = C.item.text;
  CK_TEXT = C.texts;
  CK_MARKER = C.marker;
});

export function isCheckersTable(name: string): boolean {
  return lingoEq(name, CK_ITEM);
}

export type PieceName = "Black" | "White" | "BlackKing" | "WhiteKing";
/** Captured pieces have `v < 0` (they move −864, −864). */
export type Piece = { h: number; v: number; m: PieceName };
export type Side = 1 | 2;

/** The 24 pieces of frame 1, channels 2-25 (0-11 Black, 12-23 White). */
export function startBoard(): Piece[] {
  return C.start.map((p) => ({ h: p.h, v: p.v, m: p.m }));
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
  const B = C.bounds;
  const inside = (n: number): boolean => {
    const h = piece.h + C.step * n * dh;
    const v = piece.v + C.step * n * dv;
    return h >= B.hMin && h <= B.hMax && v >= B.vMin && v <= B.vMax;
  };
  const at = (h: number, v: number): number => board.findIndex((p) => p.h === h && p.v === v);
  const next = at(piece.h + C.step * dh, piece.v + C.step * dv);
  const moved = (n: number): Piece[] =>
    board.map((p, i) =>
      i === index ? { ...p, h: piece.h + C.step * n * dh, v: piece.v + C.step * n * dv } : p,
    );
  const adjacent = board[next];
  if (adjacent) {
    if (ownedBy(side, adjacent.m)) {
      return none;
    }
    if (at(piece.h + C.jump * dh, piece.v + C.jump * dv) >= 0 || !inside(2)) {
      return none;
    }
    const after = moved(2);
    after[next] = { ...adjacent, h: adjacent.h + C.captured, v: adjacent.v + C.captured };
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
    if (p.m === "Black" && p.v < C.kingBelow) {
      return { ...p, m: "BlackKing" };
    }
    return p.m === "White" && p.v > C.kingAbove ? { ...p, m: "WhiteKing" } : p;
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
