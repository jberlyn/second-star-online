/** Checkers rules. */
import { describe, expect, test } from "bun:test";

import { checkersMove, loser, type Piece, promote, startBoard } from "../../src/index.ts";

const empty = (): Piece[] =>
  Array.from({ length: 24 }, () => ({ h: -864 + 41, v: -864 + 54, m: "Black" }) as Piece);
const put = (b: Piece[], i: number, h: number, v: number, m: Piece["m"]) => {
  b[i] = { h, v, m };
};

describe("checkers", () => {
  test("the start board is the sub-movie's 24 pieces: 12 Black at the bottom, 12 White at the top", () => {
    const b = startBoard();
    expect(b).toHaveLength(24);
    expect(b.slice(0, 12).every((p) => p.m === "Black" && p.v >= 214)).toBe(true);
    expect(b.slice(12).every((p) => p.m === "White" && p.v <= 118)).toBe(true);
    expect(b[0]).toEqual({ h: 73, v: 278, m: "Black" });
  });

  test("step and jump towards the click; own piece blocks; landing occupied or off the board blocks", () => {
    const b = empty();
    put(b, 0, 105, 150, "Black");
    expect(checkersMove(b, 0, 1, -1, -1)).toMatchObject({ kind: "step" });
    const s = checkersMove(b, 0, 1, 1, -1);
    expect(s.kind === "step" && s.board[0]).toEqual({ h: 137, v: 118, m: "Black" });
    put(b, 12, 73, 118, "White");
    const j = checkersMove(b, 0, 1, -1, -1);
    expect(j.kind).toBe("jump");
    if (j.kind === "jump") {
      expect(j.board[0]).toEqual({ h: 41, v: 86, m: "Black" });
      expect(j.board[12]?.v).toBeLessThan(0);
      expect(j.captured).toBe(12);
    }
    put(b, 13, 41, 86, "White");
    expect(checkersMove(b, 0, 1, -1, -1).kind).toBe("none");
    put(b, 13, 41, 86, "Black");
    expect(checkersMove(b, 0, 1, -1, -1).kind).toBe("none");
    const own = empty();
    put(own, 0, 105, 150, "Black");
    put(own, 1, 73, 118, "Black");
    expect(checkersMove(own, 0, 1, -1, -1).kind).toBe("none");
    const edge = empty();
    put(edge, 0, 41, 150, "Black");
    expect(checkersMove(edge, 0, 1, -1, -1).kind).toBe("none");
    put(edge, 0, 73, 150, "Black");
    put(edge, 2, 41, 118, "White");
    expect(checkersMove(edge, 0, 1, -1, -1).kind).toBe("none"); // landing H 9 is off the board
  });

  test("men move forward only, kings four ways", () => {
    const b = empty();
    put(b, 0, 105, 150, "Black");
    put(b, 12, 105, 150 - 100, "White");
    expect(checkersMove(b, 0, 1, 1, 1).kind).toBe("none");
    expect(checkersMove(b, 12, 2, 1, -1).kind).toBe("none");
    expect(checkersMove(b, 12, 2, 1, 1)).toMatchObject({ kind: "step" });
    put(b, 0, 105, 150, "BlackKing");
    expect(checkersMove(b, 0, 1, 1, 1).kind).toBe("step");
    expect(checkersMove(b, 0, 1, -1, -1).kind).toBe("step");
    expect(checkersMove(b, 0, 2, 1, 1).kind).toBe("none"); // not your piece
  });

  test("kings at V < 57 and V > 270", () => {
    const b = empty();
    put(b, 0, 73, 54, "Black");
    put(b, 12, 73, 278, "White");
    put(b, 1, 105, 57, "Black");
    const p = promote(promote(promote(b, 0), 12), 1);
    expect(p[0]?.m).toBe("BlackKing");
    expect(p[12]?.m).toBe("WhiteKing");
    expect(p[1]?.m).toBe("Black");
  });

  test("a click in the piece's row or column does nothing", () => {
    const b = empty();
    put(b, 0, 105, 150, "Black");
    expect(checkersMove(b, 0, 1, 0, -1).kind).toBe("none");
    expect(checkersMove(b, 0, 1, 1, 0).kind).toBe("none");
  });

  test("no multi-jump: a jump is one move, the turn passes after it", () => {
    const b = empty();
    put(b, 0, 105, 214, "Black");
    put(b, 12, 73, 182, "White");
    put(b, 13, 41, 118, "White");
    const j = checkersMove(b, 0, 1, -1, -1);
    expect(j.kind).toBe("jump");
    if (j.kind === "jump") {
      // A second jump would be a second move, which the server only allows on the next turn.
      expect(j.board[13]?.v).toBe(118);
    }
  });

  test("the loser is the side with no piece on the board; blocked sides do not lose", () => {
    const b = startBoard();
    expect(loser(b)).toBeNull();
    const nb = b.map((p) => (p.m === "Black" ? { ...p, h: p.h - 864, v: p.v - 864 } : p));
    expect(loser(nb)).toBe(1);
    const nw = b.map((p) => (p.m === "White" ? { ...p, h: p.h - 864, v: p.v - 864 } : p));
    expect(loser(nw)).toBe(2);
  });
});
