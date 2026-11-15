import { describe, expect, test } from "bun:test";

import { seededRng } from "../src/rng";

describe("rng", () => {
  test("nonpositive or unset random bounds consume one draw and return 0", () => {
    const rng = seededRng(7);
    expect(rng.random(0)).toBe(0);
    expect(rng.random(-5)).toBe(0);
    expect(rng.random(Number.NaN)).toBe(0);
    const one = seededRng(7);
    one.random(0);
    const fresh = seededRng(7);
    fresh.random(1000);
    expect(one.random(1000)).toBe(fresh.random(1000));
  });

  test("random(n) returns 1..n", () => {
    const rng = seededRng(11);
    for (let i = 0; i < 1000; i++) {
      const r = rng.random(6);
      expect(r >= 1 && r <= 6).toBe(true);
    }
  });
});
