/**
 * Checkers. Pure rules over `casinoData.checkers`. A piece's `h`/`v` are the sub-movie's sprite
 * locs.
 */
import { casinoData } from "@secondstaronline/data";

import { lingoEq } from "../core/lingo.ts";

const C = casinoData.checkers;

export const CK_ITEM = C.item.text;
export const CK_TEXT = C.texts;
export const CK_MARKER = C.marker;

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

/**
 * The board-click rule for one chosen piece and the click's direction: men go only forward (the
 * backward branches require an exact match for "Black" or "White"), your own piece next to it
 * blocks, an enemy there is jumped if the landing is empty and on the board (the captured piece
 * goes to −864, −864), else a one-square step if on the board. No multi-jump, no forced capture.
 * `dh` and `dv` are −1 or 1.
 */
export function checkersMove(
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

/** The side with no piece left on the board (V > 0) loses; no win by blocking. */
export function loser(board: readonly Piece[]): Side | null {
  const alive = (side: Side) => board.some((p) => p.v > 0 && ownedBy(side, p.m));
  if (!alive(1)) {
    return 1;
  }
  return alive(2) ? null : 2;
}
