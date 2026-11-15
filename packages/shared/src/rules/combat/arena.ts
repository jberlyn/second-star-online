/**
 * The arena challenge's pure rules. I/O-free: the server action (server/systems/combat/arena.ts)
 * applies the result.
 *
 * Covers the arena death exit, the quit check and the challenge start.
 */
import { MAP_HEIGHT, MAP_WIDTH } from "../../constants.ts";
import { lingoContains, type Rng } from "../core/lingo.ts";
import { tileHas } from "../core/tiles.ts";
import { isWalkable } from "../core/walk.ts";
import { recordTile } from "../vehicles/vehicles.ts";

/** Every arena text. */
export const ARENA_TEXT = {
  standStillQuit: "You should stand still before exiting the arena.",
  standStillChallenge: "You should stand still before making a challenge.",
  alreadyInBattle: "You are already in a battle!!",
  notAnArena: "This is not an arena!",
  entered: (name: string) => `${name} has entered the arena!`,
  stopped: (name: string) => `${name} has stopped fighting.`,
  defeated: (name: string, killer: string) => `${name} was defeated by ${killer}.`,
} as const;

/** `Loopy < 800`, counting every roll of the challenge: 799 rolls. */
export const CHALLENGE_ROLLS = 799;

/**
 * Standing on a `6P` tile: the requested column of the map record is a layer-1 row only for rows
 * 1-9 (a kept 1.6 bug, see `recordTile`), so a `6P` on rows 10-12 is never an arena tile.
 */
export function isArenaTile(layer1: readonly string[], x: number, y: number): boolean {
  return tileHas(recordTile(layer1, x, y), "arena");
}

/** The pieces of the map record that can hold a space: layers, signs (fields 14-16), title (17). */
export interface ArenaRecord {
  /** The four layers, 12 rows each, as stored (words joined by single spaces). */
  layers: readonly (readonly string[])[];
  signs: readonly string[];
  title: string;
}

/**
 * Check 3, the map record includes " 6P ": a case-insensitive substring test on the raw `#` record.
 * Each piece is tested alone: joining fields with `#` can never make a `" 6P "` across a boundary,
 * and fields 10-13 and 18 hold no spaces (in the original's maps), so this is the same test with no
 * serialiser to keep in step. A layer row has no space at either end, so a `6P` only in column 1 or
 * 17 never matches (a kept 1.6 bug: an arena whose 6P tiles are only at a row's ends is "not an
 * arena").
 */
export function recordHasArena(rec: ArenaRecord): boolean {
  const pieces = [...rec.layers.flat(), ...rec.signs, rec.title];
  return pieces.some((piece) => lingoContains(piece, " 6P "));
}

/**
 * The challenge start's search: up to 799 rolls of `random(17)` then `random(12)`, the first whose
 * layer-1 row word is `6P` wins. `null` after 799 misses: the challenge ends silently.
 */
export function findArenaTile(
  layer1: readonly string[],
  rng: Rng,
): { x: number; y: number } | null {
  for (let loopy = 1; loopy < 800; loopy++) {
    const x = rng.random(MAP_WIDTH);
    const y = rng.random(MAP_HEIGHT);
    if (isArenaTile(layer1, x, y)) {
      return { x, y };
    }
  }
  return null;
}

/**
 * The tiles `quit` and the arena death exit can leave to: not `6P` (rows 1-9, so rows 10-12 always
 * pass that test, a kept 1.6 bug) and walkable on the player's grid. Row by row, y 1-12, then x
 * 1-17.
 */
export function arenaExits(
  layer1: readonly string[],
  grid: readonly (readonly boolean[])[],
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let y = 1; y <= MAP_HEIGHT; y++) {
    for (let x = 1; x <= MAP_WIDTH; x++) {
      if (!isArenaTile(layer1, x, y) && isWalkable(grid, x, y)) {
        out.push({ x, y });
      }
    }
  }
  return out;
}

/**
 * One uniform pick among `arenaExits`, one `rng.random(n)`. 1.6's loop counts only passing rolls
 * and keeps the 799th, which is the same uniform pick. With no passing tile it never ended and the
 * client hung; here the answer is `null`.
 */
export function pickArenaExit(
  layer1: readonly string[],
  grid: readonly (readonly boolean[])[],
  rng: Rng,
): { x: number; y: number } | null {
  const exits = arenaExits(layer1, grid);
  if (exits.length === 0) {
    return null;
  }
  return exits[rng.random(exits.length) - 1] ?? null;
}

export type ArenaCheck = { kind: "text"; text: string } | { kind: "silent" } | { kind: "go" };

/** The challenge start's checks 1-3 in 1.6's order. */
export function challengeCheck(a: {
  stepFrames: number;
  layer1: readonly string[];
  x: number;
  y: number;
  record: ArenaRecord;
}): ArenaCheck {
  if (a.stepFrames > 0) {
    return { kind: "text", text: ARENA_TEXT.standStillChallenge };
  }
  if (isArenaTile(a.layer1, a.x, a.y)) {
    return { kind: "text", text: ARENA_TEXT.alreadyInBattle };
  }
  if (!recordHasArena(a.record)) {
    return { kind: "text", text: ARENA_TEXT.notAnArena };
  }
  return { kind: "go" };
}

/** The quit command's checks. */
export function quitCheck(a: {
  stepFrames: number;
  layer1: readonly string[];
  x: number;
  y: number;
}): ArenaCheck {
  if (a.stepFrames > 0) {
    return { kind: "text", text: ARENA_TEXT.standStillQuit };
  }
  if (!isArenaTile(a.layer1, a.x, a.y)) {
    return { kind: "silent" };
  }
  return { kind: "go" };
}
