/**
 * The sim's randomness (`Rng`), passed in as an argument so tick replays are deterministic.
 * Positive bounds return 1..n. Nonpositive or unset bounds produced a random signed 32-bit number
 * in the original (never 1..n in practice), so SSO consumes one draw and returns 0 (checked on
 * Director 8.5).
 */
import type { Rng } from "@secondstaronline/shared";

export type { Rng };

function lingo(next: () => number): Rng {
  return {
    random(n) {
      const r = next();
      if (!(n >= 1)) {
        return 0;
      }
      return 1 + Math.floor(r * Math.floor(n));
    },
  };
}

/** The live server's RNG. */
export const systemRng: Rng = lingo(Math.random);

/** A seeded RNG (mulberry32) for replayable tests. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return lingo(() => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  });
}

/** Returns the given results in order, then repeats the last one. Tests only. */
export function scriptedRng(results: readonly number[]): Rng {
  let i = 0;
  return {
    random() {
      const r = results[Math.min(i, results.length - 1)] ?? 0;
      i += 1;
      return r;
    },
  };
}
