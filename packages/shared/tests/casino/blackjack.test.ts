/** Blackjack rules. */
import { describe, expect, test } from "bun:test";

import {
  bidCheck,
  casinoSide,
  drawCard,
  handTotal,
  lingoInteger,
  outcome,
  stake,
} from "../../src/index.ts";

const A = 51;

describe("blackjack", () => {
  test("the Ace routine: A-A 13, A-A-9 11, A-A-A 14, A-5 16, 10-9-5 24", () => {
    expect(handTotal([A, A])).toBe(13);
    expect(handTotal([A, A, 59])).toBe(11);
    expect(handTotal([A, A, A])).toBe(14);
    expect(handTotal([A, 55])).toBe(16);
    expect(handTotal([60, 59, 55])).toBe(24);
    expect(handTotal([A, 60])).toBe(21);
  });

  test("the outcome lines: 25 v 23 draw then P1, 24 v 24 two draws, 18 v 18 one draw, 22 v 17 P2, 17 v 19 P2", () => {
    expect(outcome(25, 23)).toEqual(["draw", 1]);
    expect(outcome(23, 25)).toEqual(["draw", 2]);
    expect(outcome(24, 24)).toEqual(["draw", "draw"]);
    expect(outcome(18, 18)).toEqual(["draw"]);
    expect(outcome(22, 17)).toEqual([2]);
    expect(outcome(17, 22)).toEqual([1]);
    expect(outcome(17, 19)).toEqual([2]);
    expect(outcome(20, 19)).toEqual([1]);
  });

  test("drawCard is random(10) + 50, crd51 = 11 and crd60 = 10", () => {
    expect(drawCard({ random: (n) => (n === 10 ? 1 : 0) })).toBe(51);
    expect(drawCard({ random: () => 10 })).toBe(60);
    expect(handTotal([51])).toBe(11);
    expect(handTotal([60])).toBe(10);
  });

  test("the stake is the lower bid; 0 is a free game", () => {
    expect(stake(50, 30)).toBe(30);
    expect(stake(0, 30)).toBe(0);
  });

  test('bidCheck: < 0 nothing, 100000 the max text, gold short the gold text, "abc" and "5.5" read as 0', () => {
    expect(bidCheck("-1", 100).kind).toBe("none");
    expect(bidCheck("100000", 1e9).kind).toBe("max");
    expect(bidCheck("99999", 99998).kind).toBe("poor");
    expect(bidCheck("50", 50)).toEqual({ kind: "ok", bid: 50 });
    expect(bidCheck("abc", 0)).toEqual({ kind: "ok", bid: 0 });
    expect(bidCheck("5.5", 0)).toEqual({ kind: "ok", bid: 0 });
    expect(lingoInteger(" 12 ")).toBe(12);
    expect(lingoInteger("")).toBeNull();
  });

  test("casinoSide: west is 1, east is 2, nothing else, not mid-step", () => {
    const t = { x: 10, y: 5 };
    expect(casinoSide({ x: 9, y: 5, stepFrames: 0 }, t)).toBe(1);
    expect(casinoSide({ x: 11, y: 5, stepFrames: 0 }, t)).toBe(2);
    expect(casinoSide({ x: 10, y: 6, stepFrames: 0 }, t)).toBeNull();
    expect(casinoSide({ x: 9, y: 4, stepFrames: 0 }, t)).toBeNull();
    expect(casinoSide({ x: 9, y: 5, stepFrames: 3 }, t)).toBeNull();
    expect(casinoSide({ x: 8, y: 5, stepFrames: 0 }, t)).toBeNull();
  });
});
