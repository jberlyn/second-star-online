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
  test("handTotal reduces Aces one at a time: A-A 12, A-A-9 21, A-A-A 13, A-5 16, 10-9-5 24", () => {
    expect(handTotal([A, A])).toBe(12);
    expect(handTotal([A, A, 59])).toBe(21);
    expect(handTotal([A, A, A])).toBe(13);
    expect(handTotal([A, 55])).toBe(16);
    expect(handTotal([60, 59, 55])).toBe(24);
    expect(handTotal([A, 60])).toBe(21);
  });

  test("outcome: both bust is a single draw; bust loses; higher non-bust wins", () => {
    expect(outcome(25, 23)).toEqual(["draw"]);
    expect(outcome(23, 25)).toEqual(["draw"]);
    expect(outcome(24, 24)).toEqual(["draw"]);
    expect(outcome(18, 18)).toEqual(["draw"]);
    expect(outcome(22, 17)).toEqual([2]);
    expect(outcome(17, 22)).toEqual([1]);
    expect(outcome(17, 19)).toEqual([2]);
    expect(outcome(20, 19)).toEqual([1]);
  });

  test("drawCard draws from 13 ranks: 1..9 map to 51..59, 10..13 map to 60", () => {
    expect(drawCard({ random: (n) => (n === 13 ? 1 : 0) })).toBe(51);
    expect(drawCard({ random: (n) => (n === 13 ? 9 : 0) })).toBe(59);
    expect(drawCard({ random: (n) => (n === 13 ? 10 : 0) })).toBe(60);
    expect(drawCard({ random: (n) => (n === 13 ? 11 : 0) })).toBe(60);
    expect(drawCard({ random: (n) => (n === 13 ? 12 : 0) })).toBe(60);
    expect(drawCard({ random: (n) => (n === 13 ? 13 : 0) })).toBe(60);
    expect(handTotal([51])).toBe(11);
    expect(handTotal([60])).toBe(10);
  });

  test("the stake is the lower bid", () => {
    expect(stake(50, 30)).toBe(30);
    expect(stake(1, 30)).toBe(1);
  });

  test("bidCheck: <= 0 or non-numeric is none, 100000 is max, gold short is poor", () => {
    expect(bidCheck("-1", 100).kind).toBe("none");
    expect(bidCheck("0", 100).kind).toBe("none");
    expect(bidCheck("", 100).kind).toBe("none");
    expect(bidCheck("100000", 1e9).kind).toBe("max");
    expect(bidCheck("99999", 99998).kind).toBe("poor");
    expect(bidCheck("50", 50)).toEqual({ kind: "ok", bid: 50 });
    expect(bidCheck("abc", 0).kind).toBe("none");
    expect(bidCheck("5.5", 0).kind).toBe("none");
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
