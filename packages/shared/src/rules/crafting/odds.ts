/**
 * Odds by level (`levelOdds` in the content): the chance at each listed level, in a straight line
 * between two points and flat beyond the ends, as RuneScape's skills read theirs. Pure.
 */
import type { Rng } from "../core/lingo.ts";

export interface OddsPoint {
  level: number;
  percent: number;
}

/** The chance (0 to 1) the points give at a level. */
export function oddsAt(points: readonly OddsPoint[], level: number): number {
  return Math.min(1, Math.max(0, percentAt(points, level) / 100));
}

function percentAt(points: readonly OddsPoint[], level: number): number {
  const first = points[0];
  if (!first) {
    return 0;
  }
  if (level <= first.level) {
    return first.percent;
  }
  for (let i = 0; i < points.length; i++) {
    const a = points[i] as OddsPoint;
    const b = points[i + 1];
    if (!b) {
      return a.percent;
    }
    if (level <= b.level) {
      return a.percent + ((b.percent - a.percent) * (level - a.level)) / (b.level - a.level);
    }
  }
  return first.percent;
}

/** The dice of a chance: one `random(10000)` against the chance, in hundredths of a percent. */
export function rollChance(chance: number, rng: Rng): boolean {
  if (chance >= 1) {
    return true;
  }
  if (chance <= 0) {
    return false;
  }
  return rng.random(10_000) <= Math.round(chance * 10_000);
}
