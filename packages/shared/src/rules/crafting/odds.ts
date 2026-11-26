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
  return Math.min(
    1,
    Math.max(
      0,
      lineAt(
        points.map((p) => ({ level: p.level, value: p.percent })),
        level,
      ) / 100,
    ),
  );
}

/**
 * The value points give at a level: in a straight line between two points and flat beyond the
 * ends (0 with no points). Unclamped, so it reads a recipe's frames as well as a chance.
 */
export function lineAt(points: readonly { level: number; value: number }[], level: number): number {
  const first = points[0];
  if (!first) {
    return 0;
  }
  if (level <= first.level) {
    return first.value;
  }
  for (let i = 0; i < points.length; i++) {
    const a = points[i] as { level: number; value: number };
    const b = points[i + 1];
    if (!b) {
      return a.value;
    }
    if (level <= b.level) {
      return a.value + ((b.value - a.value) * (level - a.level)) / (b.level - a.level);
    }
  }
  return first.value;
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
