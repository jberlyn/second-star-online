/**
 * The on-foot step model, shared by the server sim and the client's prediction. Pure: no clock, no
 * randomness, no I/O.
 *
 * It covers the original's order of checks for a step, the arrow poll (one direction per frame,
 * priority L > R > U > D), the step animation (16 calls × 2 px and the walk frames) and player and
 * monster blocking (`blockPCCheck`).
 *
 * The web check is the `web` outcome of `attemptMove`. The Airship's 8-frame step is
 * `stepLengthFor`.
 */

import { MAP_HEIGHT, MAP_WIDTH, TILE_PX } from "../../constants.ts";
import { content } from "../../content/store.ts";
import { anyMatch } from "../core/patterns.ts";

/** An arrow key: Left, Right, Up, Down. */
export type Dir = "L" | "R" | "U" | "D";
/** `Facing` as the original stores it. */
export type Facing = "N" | "S" | "E" | "W";

/** The web line. */
export const WEB_TEXT = "Your feet are stuck in the web, you cannot move!";

/** SSO's line for a walk off an edge with no map beyond, or onto an unwalkable tile on it. */
export const EDGE_BLOCKED_TEXT = "You cannot go that way.";

/** Monster steps take 16 `stepFrame` calls of 2 px = 8 frames. */
export const MONSTER_STEP_FRAMES = 16;

/** Overlord and Mutant Worm are three tiles wide (the step-blocking test). */
export function isFootprint(name: string): boolean {
  return anyMatch(content().monsters.rules.footprint, name);
}

/**
 * The tile a monster's sprite is drawn nearest: its start tile for the first half of a step, its
 * logical tile (the step's destination) after that. Its loot drops here (a bug fixed: 1.6 dropped
 * it on the destination tile from the moment the step began).
 */
export function monsterDrawnTile(
  x: number,
  y: number,
  fromX: number,
  fromY: number,
  framesLeft: number,
): { x: number; y: number } {
  return framesLeft * 2 > MONSTER_STEP_FRAMES ? { x: fromX, y: fromY } : { x, y };
}

/**
 * The tile a monster's sprite stands on when a player's arrow is tested: its tile while standing,
 * its start tile on the tick a step begins (`framesLeft` = 16), nowhere in between. Null when
 * between tiles.
 */
export function monsterSpriteTile(
  x: number,
  y: number,
  fromX: number,
  fromY: number,
  framesLeft: number,
): { x: number; y: number } | null {
  if (framesLeft === 0) {
    return { x, y };
  }
  if (framesLeft === MONSTER_STEP_FRAMES) {
    return { x: fromX, y: fromY };
  }
  return null;
}

/** One roster slot as the step-blocking test sees it. */
export interface BlockSlot {
  /** The name this player last saw placed in the slot, or null. */
  name: string | null;
  /** The live sprite's tile at test time; null when dead, empty or between tiles. */
  at: { x: number; y: number } | null;
}

/**
 * The step-blocking test: does another player or a monster stop a step into (`tx`, `ty`)? `players`
 * are the other non-rider players at their logical tiles, mid-step or not. Each slot blocks its own
 * sprite's tile; an Overlord or Mutant Worm also blocks the two tiles to its right; a Web or Holy
 * Shield never blocks.
 *
 * Bugs fixed: in 1.6 the three-wide flag, once set by an Overlord or Mutant Worm, stayed set for
 * every later slot, and a Web or Holy Shield cleared the block found by any player or earlier slot.
 */
export function blockPCCheck(
  tx: number,
  ty: number,
  players: readonly { x: number; y: number }[],
  slots: readonly BlockSlot[],
): boolean {
  if (players.some((p) => p.x === tx && p.y === ty)) {
    return true;
  }
  return slots.some((s) => {
    if (!s.at || s.at.y !== ty) {
      return false;
    }
    const name = s.name ?? "";
    if (anyMatch(content().monsters.rules.clearsBlock, name)) {
      return false;
    }
    if (s.at.x === tx) {
      return true;
    }
    return isFootprint(name) && (s.at.x === tx - 1 || s.at.x === tx - 2);
  });
}

export const DIRS: readonly Dir[] = ["L", "R", "U", "D"];
export const FACINGS: readonly Facing[] = ["N", "S", "E", "W"];

/**
 * On foot a step takes 16 `stepFrame` calls. The actorList gets two
 * `stepFrame`s per drawn frame, so that is 8 frames, 0.4 s at 20 fps (measured 2026-11-08 in the
 * running 1.6). Counters stay in `stepFrame` units; the server and the client's prediction run the
 * actor phase `STEPFRAMES_PER_FRAME` times a tick.
 */
export const STEP_FRAMES = 16;

/**
 * The vehicles a player can ride. Only the Airship was ever reachable in 1.6; its Boat and
 * Battleship were written but never switched on (SSO builds them, issue #2).
 */
export type Vehicle = "Airship" | "Boat" | "Battleship";

/** A vehicle that sails on water: the Boat or the Battleship. */
export function isShip(vehicle: Vehicle | null): vehicle is "Boat" | "Battleship" {
  return vehicle === "Boat" || vehicle === "Battleship";
}

/**
 * `stepFrame` calls in one step for a walker: 16 on foot, 8 aboard an Airship (the step counter starts at 8
 * against 16). 4 frames aboard. A ship steps at walking pace, as 1.6 wrote it (only the Airship
 * set the shorter step).
 */
export function stepLengthFor(vehicle: Vehicle | null): number {
  return vehicle === "Airship" ? STEP_FRAMES / 2 : STEP_FRAMES;
}

/**
 * Pixels the sprite moves per `stepFrame` call: one tile over the step. On foot 2 px per call, 4 px
 * per drawn frame; aboard an Airship 4 px per call, 8 px per frame (the two 2 px moves per call).
 */
export function stepPxPerCall(stepLength: number = STEP_FRAMES): number {
  return TILE_PX / stepLength;
}

export const DIR_FACING: Readonly<Record<Dir, Facing>> = { L: "W", R: "E", U: "N", D: "S" };
export const DIR_DELTA: Readonly<Record<Dir, readonly [number, number]>> = {
  L: [-1, 0],
  R: [1, 0],
  U: [0, -1],
  D: [0, 1],
};
export const FACING_DELTA: Readonly<Record<Facing, readonly [number, number]>> = {
  W: [-1, 0],
  E: [1, 0],
  N: [0, -1],
  S: [0, 1],
};

/**
 * The arrow poll takes one direction per frame, in the order Left, Right, Up, Down (the original's
 * one-key chain). Holding Left and Up walks left.
 */
export function resolveHeld(held: Readonly<Partial<Record<Dir, boolean>>>): Dir | null {
  for (const d of DIRS) {
    if (held[d]) {
      return d;
    }
  }
  return null;
}

/** What the step model needs to know about one walker. */
export interface Walker {
  x: number;
  y: number;
  facing: Facing;
  /** Frames left in the current step; 0 when standing (the step counter). */
  stepFrames: number;
}

/** What the step model needs to know about the map. Coordinates are 1-based. */
export interface WalkWorld {
  /**
   * On-foot whitelist test for an on-screen tile (the original's blocked-tiles test); the grid
   * only.
   */
  walkable(x: number, y: number): boolean;
  /**
   * The step-blocking test for this target (`blockPCCheck`): another player or a monster stops the step.
   * May be asked about x = 18 (the right edge).
   */
  pcBlocked(x: number, y: number): boolean;
  /** A fixture on the ground blocks this on-screen tile. */
  itemBlocks(x: number, y: number): boolean;
  /**
   * A live trap (`flags.trap`, Classic: a Web) stands exactly on this tile; always false aboard an
   * Airship (the test needs no vehicle). Only ever asked about the walker's own tile.
   */
  webAt(x: number, y: number): boolean;
}

export type MoveOutcome =
  /** Nothing happened: mid-step, or a turn attempted mid-step. */
  | { kind: "none" }
  /** Alt/Turn + arrow while standing: facing changes, no step. */
  | { kind: "turn"; facing: Facing }
  /**
   * Blocked by a standing player or monster (`pc`), a fixture (`item`) or an unwalkable tile:
   * the walker faces that way.
   */
  | { kind: "blocked"; facing: Facing; by: "pc" | "item" | "tile" }
  /** A step started. The logical tile is the destination at once. */
  | { kind: "step"; facing: Facing; fromX: number; fromY: number; toX: number; toY: number }
  /**
   * A web is on the walker's own tile: the line is printed, nothing else changes, not even the
   * facing (`Facing` is set after the web test).
   */
  | { kind: "web" }
  /**
   * The target is off the screen: the edge wrap. The server checks the wrapped tile against the
   * next map's walk grid (`crossMapEdge`); there is no step animation.
   */
  | { kind: "edge"; facing: Facing; toX: number; toY: number; dmx: number; dmy: number };

/**
 * One step attempt for a held arrow, followed by the position refresh. Does not change `w`;
 * `applyOutcome` does.
 *
 * Order, as in the original:
 * 1. Turn in place, only when standing.
 * 2. Mid-step → stop. (1.6 runs the player and item tests mid-step too, but the walker's
 *    sprite is between tiles, so they never match.)
 * 3. Player/monster block (`pcBlocked`), asked even off screen (x = 18).
 * 4. Item block on an on-screen target, before the web test.
 * 5. Web on my own tile → the web line, stop.
 * 6. Facing set; off-screen target → edge wrap (the server checks the next map's tile).
 * 7. Unwalkable target → face and stop.
 * 8. Start the step.
 */
export function attemptMove(w: Walker, dir: Dir, turn: boolean, world: WalkWorld): MoveOutcome {
  const facing = DIR_FACING[dir];
  if (turn) {
    if (w.stepFrames > 0) {
      return { kind: "none" };
    }
    return { kind: "turn", facing };
  }
  const [dx, dy] = DIR_DELTA[dir];
  const nx = w.x + dx;
  const ny = w.y + dy;
  const onScreen = nx >= 1 && nx <= MAP_WIDTH && ny >= 1 && ny <= MAP_HEIGHT;
  if (w.stepFrames > 0) {
    return { kind: "none" };
  }
  if (world.pcBlocked(nx, ny)) {
    return { kind: "blocked", facing, by: "pc" };
  }
  if (onScreen && world.itemBlocks(nx, ny)) {
    return { kind: "blocked", facing, by: "item" };
  }
  if (world.webAt(w.x, w.y)) {
    return { kind: "web" };
  }
  if (!onScreen) {
    const wrap = edgeWrap(nx, ny);
    return { kind: "edge", facing, ...wrap };
  }
  if (!world.walkable(nx, ny)) {
    return { kind: "blocked", facing, by: "tile" };
  }
  return { kind: "step", facing, fromX: w.x, fromY: w.y, toX: nx, toY: ny };
}

/**
 * Target x 18/0 and y 13/0 wrap to 1/17 and 1/12 and move the map by ±1 (the maps
 * formulas' `map.edgeWrap`).
 */
export function edgeWrap(
  nx: number,
  ny: number,
): { toX: number; toY: number; dmx: number; dmy: number } {
  let toX = nx;
  let toY = ny;
  let dmx = 0;
  let dmy = 0;
  if (nx === MAP_WIDTH + 1) {
    toX = 1;
    dmx = 1;
  }
  if (nx === 0) {
    toX = MAP_WIDTH;
    dmx = -1;
  }
  if (ny === MAP_HEIGHT + 1) {
    toY = 1;
    dmy = 1;
  }
  if (ny === 0) {
    toY = MAP_HEIGHT;
    dmy = -1;
  }
  return { toX, toY, dmx, dmy };
}

/**
 * Applies an in-map outcome to the walker. Edges are handled by the caller (map change).
 */
export function applyOutcome(w: Walker, o: MoveOutcome, stepLength: number = STEP_FRAMES): void {
  switch (o.kind) {
    case "turn":
    case "blocked":
      w.facing = o.facing;
      return;
    case "step":
      w.facing = o.facing;
      w.x = o.toX;
      w.y = o.toY;
      w.stepFrames = stepLength;
      return;
    case "edge":
      w.facing = o.facing;
      return;
    case "none":
    case "web":
      return;
  }
}

/**
 * The step animation runs in `stepFrame` before the frame script polls the keys, so a held arrow
 * starts the next step in the same frame the last one ends: a steady cadence of 16 calls, 8 frames.
 * Call this once per actor pass, before `attemptMove` (which runs once per tick, in the frame
 * script).
 */
export function advanceStep(w: Walker): void {
  if (w.stepFrames > 0) {
    w.stepFrames -= 1;
  }
}

export type WalkFrame = "F1" | "F2" | "F3";

/**
 * The body frame shown with `stepFrames` left after this tick's `advanceStep`. The original sets
 * the member on even counts of the step counter before decrementing it (16 F1, 14 F2, 12 F3, 10 F2, 8
 * F1, 6 F2, 4 F3, 2 F2) and skips the odd counts (the original's don't-draw frames), which keep the
 * previous frame. Standing shows F2.
 *
 * The rule depends only on the counter, so it repeats every 8 counts and applies to any step
 * length: an 8-call step shows F1, F2, F3, F2, exactly as the original's Airship step runs the same
 * code from a counter of 8. Read after two decrements a frame, a foot step shows F1 F2 F3 F2 F1
 * F2 F3 F2 over its 8 frames.
 */
export function walkFrame(stepFrames: number, stepLength: number = STEP_FRAMES): WalkFrame {
  if (stepFrames <= 0 || stepFrames >= stepLength) {
    return "F2";
  }
  // Counter value when the member was last set: stepFrames + 1, rounded up to even.
  const v = stepFrames + 1 + ((stepFrames + 1) % 2);
  if (v % 8 === 0) {
    return "F1";
  }
  if (v % 8 === 4) {
    return "F3";
  }
  return "F2";
}

/**
 * Pixel offset from the step's start tile toward `facing`, with `stepFrames` left after this tick's
 * `advanceStep`: 2 px per `stepFrame` call on a 16-call step.
 */
export function stepOffsetPx(stepFrames: number, stepLength: number = STEP_FRAMES): number {
  if (stepFrames <= 0 || stepFrames > stepLength) {
    return 0;
  }
  return (stepLength - stepFrames) * stepPxPerCall(stepLength);
}
