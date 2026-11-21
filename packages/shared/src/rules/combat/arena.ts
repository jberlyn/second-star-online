/**
 * The arena challenge's pure rules. I/O-free: the server action (server/systems/combat/arena.ts)
 * applies the result.
 *
 * Covers the arena death exit, the quit check and the challenge start.
 */
import { MAP_HEIGHT, MAP_WIDTH } from "../../constants.ts";
import type { Rng } from "../core/lingo.ts";
import { tileHas } from "../core/tiles.ts";
import { isWalkable } from "../core/walk.ts";
import type { Vehicle } from "../movement/movement.ts";
import { layer1Tile, shipNoun } from "../vehicles/vehicles.ts";

/** Every arena text. */
export const ARENA_TEXT = {
  standStillQuit: "You should stand still before exiting the arena.",
  standStillChallenge: "You should stand still before making a challenge.",
  alreadyInBattle: "You are already in a battle!!",
  notAnArena: "This is not an arena!",
  full: "There is no room in the arena!",
  held: "You cannot do that while you are held.",
  /** SSO's own lines: a rider cannot challenge, named by the vehicle. */
  landFirst: (vehicle: Vehicle) =>
    vehicle === "Airship"
      ? "You must land your airship before making a challenge."
      : `You must leave your ${shipNoun(vehicle)} before making a challenge.`,
  entered: (name: string) => `${name} has entered the arena!`,
  stopped: (name: string) => `${name} has stopped fighting.`,
  defeated: (name: string, killer: string) => `${name} was defeated by ${killer}.`,
} as const;

/**
 * Standing on a `6P` tile: word `x` of layer 1's row `y`, on any of the 12 rows (a bug fixed: 1.6
 * read another field of the map record for rows 10-12, so a `6P` there was never an arena tile).
 */
export function isArenaTile(layer1: readonly string[], x: number, y: number): boolean {
  return tileHas(layer1Tile(layer1, x, y), "arena");
}

/** Every `6P` tile of layer 1, row by row, y 1-12, then x 1-17. */
export function arenaTiles(layer1: readonly string[]): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let y = 1; y <= MAP_HEIGHT; y++) {
    for (let x = 1; x <= MAP_WIDTH; x++) {
      if (isArenaTile(layer1, x, y)) {
        out.push({ x, y });
      }
    }
  }
  return out;
}

/**
 * The map is an arena when layer 1 has a `6P` tile anywhere, the same tiles the challenge can put
 * you on (bugs fixed: 1.6 searched the raw map record for " 6P ", which missed a `6P` at either end
 * of a row and accepted one on another layer, in a sign or in the title that the challenge could
 * then never find).
 */
export function hasArena(layer1: readonly string[]): boolean {
  return arenaTiles(layer1).length > 0;
}

/** Tells whether a tile already holds a player, a monster or a blocking ground item. */
export type TileTaken = (x: number, y: number) => boolean;

/**
 * The challenge's tile: one uniform pick among the free `6P` tiles, or `null` when every one is
 * taken (bugs fixed: 1.6 made 799 random tries over the whole map and gave up silently when none
 * landed, and never checked who stood on the tile).
 */
export function findArenaTile(
  layer1: readonly string[],
  rng: Rng,
  taken: TileTaken = () => false,
): { x: number; y: number } | null {
  const free = arenaTiles(layer1).filter((t) => !taken(t.x, t.y));
  if (free.length === 0) {
    return null;
  }
  return free[rng.random(free.length) - 1] ?? null;
}

/**
 * The tiles `quit` and the arena death exit can leave to: not `6P`, walkable on the player's grid
 * and not taken. Row by row, y 1-12, then x 1-17.
 */
export function arenaExits(
  layer1: readonly string[],
  grid: readonly (readonly boolean[])[],
  taken: TileTaken = () => false,
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let y = 1; y <= MAP_HEIGHT; y++) {
    for (let x = 1; x <= MAP_WIDTH; x++) {
      if (!isArenaTile(layer1, x, y) && isWalkable(grid, x, y) && !taken(x, y)) {
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
  taken: TileTaken = () => false,
): { x: number; y: number } | null {
  const exits = arenaExits(layer1, grid, taken);
  if (exits.length === 0) {
    return null;
  }
  return exits[rng.random(exits.length) - 1] ?? null;
}

export type ArenaCheck = { kind: "text"; text: string } | { kind: "silent" } | { kind: "go" };

/**
 * The challenge start's checks. A Held player, or one waiting to respawn, is refused (a bug fixed:
 * 1.6 tested only whether you were mid-step).
 */
export function challengeCheck(a: {
  stepFrames: number;
  held: boolean;
  dead: boolean;
  /** The vehicle ridden, or null on foot. */
  riding: Vehicle | null;
  layer1: readonly string[];
  x: number;
  y: number;
}): ArenaCheck {
  if (a.dead) {
    return { kind: "silent" };
  }
  if (a.held) {
    return { kind: "text", text: ARENA_TEXT.held };
  }
  if (a.stepFrames > 0) {
    return { kind: "text", text: ARENA_TEXT.standStillChallenge };
  }
  if (a.riding !== null) {
    // A bug fixed: 1.6 sent a rider into the arena still flying, where it could not swing or cast
    // and monster melee could not reach it.
    return { kind: "text", text: ARENA_TEXT.landFirst(a.riding) };
  }
  if (isArenaTile(a.layer1, a.x, a.y)) {
    return { kind: "text", text: ARENA_TEXT.alreadyInBattle };
  }
  if (!hasArena(a.layer1)) {
    return { kind: "text", text: ARENA_TEXT.notAnArena };
  }
  return { kind: "go" };
}

/**
 * The quit command's checks; Hold and the death wait refuse it as they do a challenge. A rider is
 * never in the arena, even over its tiles (an SSO rule: arenas are for players on foot).
 */
export function quitCheck(a: {
  stepFrames: number;
  held: boolean;
  dead: boolean;
  riding: boolean;
  layer1: readonly string[];
  x: number;
  y: number;
}): ArenaCheck {
  if (a.dead || a.riding) {
    return { kind: "silent" };
  }
  if (a.stepFrames > 0) {
    return { kind: "text", text: ARENA_TEXT.standStillQuit };
  }
  if (!isArenaTile(a.layer1, a.x, a.y)) {
    return { kind: "silent" };
  }
  if (a.held) {
    return { kind: "text", text: ARENA_TEXT.held };
  }
  return { kind: "go" };
}
