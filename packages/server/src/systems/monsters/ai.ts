/**
 * Monster movement.
 *
 * - The move-author pick runs once per player on the map per tick, with that client's ladder.
 * - The path (the original's path authoring) leans toward that player, using both sprites' pixel
 *   positions at authoring time.
 * - Steps run back to back, 16 frames each; a blocked step is skipped at no time cost. The logical
 *   tile changes when a step starts.
 */

import { monstersData } from "@secondstaronline/data";
import {
  anyMatch,
  blocksMonster,
  DIR_DELTA,
  DIR_FACING,
  type Dir,
  FACING_DELTA,
  isWalkable,
  lingoWord,
  MAP_HEIGHT,
  MAP_WIDTH,
  type Rng,
  stepLengthFor,
  stepOffsetPx,
  tileHas,
} from "@secondstaronline/shared";

import type { Player, WorldMap } from "../world/world.ts";
import { hasFlag, type NpcStore, npcData } from "./npcfiles.ts";
import {
  bodyOf,
  isFootprint,
  type LiveMonster,
  leansToward,
  MONSTER_STEP_FRAMES,
  type MonsterSlot,
  neverMoves,
} from "./slots.ts";

/** The Overlord / Mutant Worm cells beyond the anchor. */
export const FOOT_CELLS: readonly (readonly [number, number])[] = [
  [1, 0],
  [2, 0],
  [0, -1],
  [1, -1],
  [2, -1],
];

/** Layer-1 sea water. */
export function isWater(map: WorldMap, x: number, y: number): boolean {
  return tileHas(lingoWord(map.layers[0][y - 1] ?? "", x), "sea");
}

/** The odds for the move-author pick by players on the screen; 50 again at 9+. */
export function moveLadder(players: number): number {
  if (players >= 9) {
    return 50;
  }
  return [30, 50, 70, 100, 200, 300, 400, 600][Math.max(players, 1) - 1] as number;
}

/**
 * A sprite's `locH`/`locV`: `X·32+14`, `Y·32−3` at rest; mid-step, the start tile plus the pixels
 * moved so far.
 */
function pixel(x: number, y: number, facing: keyof typeof FACING_DELTA, left: number, len: number) {
  if (left <= 0) {
    return { h: x * 32 + 14, v: y * 32 - 3 };
  }
  const [dx, dy] = FACING_DELTA[facing];
  const off = stepOffsetPx(left, len);
  return { h: (x - dx) * 32 + 14 + dx * off, v: (y - dy) * 32 - 3 + dy * off };
}

const pick = <T>(rng: Rng, xs: readonly T[]): T => xs[rng.random(xs.length) - 1] as T;

/**
 * Authors a path: `random(10)` steps; a species on the hostile list leans toward `author`
 * (equality on pixel positions frozen at authoring), others walk at random. Returns null when the
 * monster never moves (`FLG|Still`, or no NPC data).
 */
export function authorPath(npcs: NpcStore, m: LiveMonster, author: Player, rng: Rng): Dir[] | null {
  const steps = rng.random(10); // drawn before the Still test
  if (!npcData(npcs, m.name) || hasFlag(npcs, m.name, "Still")) {
    return null;
  }
  const me = pixel(
    author.x,
    author.y,
    author.facing,
    author.stepFrames,
    stepLengthFor(author.vehicle),
  );
  const mon = pixel(m.x, m.y, m.facing, m.anim, MONSTER_STEP_FRAMES);
  const lean = leansToward(m.name);
  const path: Dir[] = [];
  for (let i = 0; i < steps; i++) {
    if (!lean) {
      path.push(pick(rng, ["U", "D", "L", "R"] as const));
      continue;
    }
    const h = Math.sign(me.h - mon.h);
    const v = Math.sign(me.v - mon.v);
    let choices: readonly Dir[];
    if (h === 0 && v > 0) {
      choices = ["L", "R", "D"];
    } else if (h === 0 && v < 0) {
      choices = ["L", "R", "U"];
    } else if (h > 0 && v === 0) {
      choices = ["D", "R", "U"];
    } else if (h < 0 && v === 0) {
      choices = ["D", "L", "U"];
    } else if (h === 0 && v === 0) {
      choices = ["D", "L", "R", "U"];
    } else if (h < 0 && v < 0) {
      choices = ["L", "U"];
    } else if (h > 0 && v < 0) {
      choices = ["R", "U"];
    } else if (h < 0 && v > 0) {
      choices = ["L", "D"];
    } else {
      choices = ["R", "D"];
    }
    path.push(pick(rng, choices));
  }
  return path;
}

export interface MoveEvent {
  slot: MonsterSlot;
  fromX: number;
  fromY: number;
}

/**
 * Takes steps off the queue until one can start. A step onto a non-water tile (sea movers), a
 * blocked tile, off the screen or onto a blocked footprint cell is skipped. A blocking ground item
 * on the anchor tile aborts the rest of the path. Players and other monsters never block (a kept
 * 1.6 bug: monsters ignore players, monsters and static NPCs). Returns the step started, or null.
 * A started step sets the slot's pause to 90.
 */
export function nextStep(map: WorldMap, slot: MonsterSlot): MoveEvent | null {
  const m = slot.live;
  if (!m) {
    return null;
  }
  const sea = anyMatch(monstersData.rules.seaMove, m.name);
  const foot = isFootprint(m.name);
  while (m.queue.length > 0) {
    const dir = m.queue.shift() as Dir;
    const [dx, dy] = DIR_DELTA[dir];
    const nx = m.x + dx;
    const ny = m.y + dy;
    if (sea ? !isWater(map, nx, ny) : !isWalkable(map.walk, nx, ny)) {
      continue;
    }
    if (nx > MAP_WIDTH || nx < 1 || ny > MAP_HEIGHT || ny < 1) {
      continue;
    }
    if (map.ground.some((g) => g.x === nx && g.y === ny && blocksMonster(g.item))) {
      // The rest of the path is dropped and no pause is set.
      m.queue = [];
      return null;
    }
    if (
      foot &&
      FOOT_CELLS.some(([cx, cy]) => {
        const tx = nx + cx;
        const ty = ny + cy;
        const onMap = tx >= 1 && tx <= MAP_WIDTH && ty >= 1 && ty <= MAP_HEIGHT;
        return onMap && !isWalkable(map.walk, tx, ty);
      })
    ) {
      continue;
    }
    const fromX = m.x;
    const fromY = m.y;
    m.fromX = fromX;
    m.fromY = fromY;
    m.x = nx;
    m.y = ny;
    m.facing = DIR_FACING[dir];
    m.anim = MONSTER_STEP_FRAMES;
    slot.pause = 90;
    slot.dirty = true;
    return { slot, fromX, fromY };
  }
  return null;
}

/**
 * One player's move-author pass. The caller gates on that player's death lock and loading. Sets
 * the author pause first and then starts the first step, as the original's step arrives with the
 * relayed move message one frame later (slot 2's pause is 0 after authoring a move, a kept 1.6
 * bug).
 */
export function moverPass(
  npcs: NpcStore,
  map: WorldMap,
  author: Player,
  players: number,
  rng: Rng,
  /** `M<k>Spell` for each slot, which runs between the pick and the move. */
  afterPick?: () => void,
): MoveEvent | null {
  if (map.slots.every((s) => !s.live)) {
    return null;
  }
  const k = rng.random(moveLadder(players));
  afterPick?.();
  const slot = map.slots[k - 1];
  const m = slot?.live;
  if (!slot || !m) {
    return null;
  }
  if (neverMoves(bodyOf(m.name)) || slot.pause !== 0) {
    return null;
  }
  const path = authorPath(npcs, m, author, rng);
  slot.pause = slot.slot === 2 ? 0 : 30;
  if (!path) {
    return null;
  }
  m.queue = path;
  return nextStep(map, slot);
}

/**
 * The walk tick in each monster's `stepFrame`: 2 px a frame; on the frame the step ends the next
 * one starts at once.
 */
export function walkTick(map: WorldMap, slot: MonsterSlot): MoveEvent | null {
  const m = slot.live;
  if (!m || m.anim === 0) {
    return null;
  }
  m.anim -= 1;
  if (m.anim === 0) {
    return nextStep(map, slot);
  }
  return null;
}

/** `M<k>Pause` countdown, once per frame. */
export function tickPauses(map: WorldMap): void {
  for (const s of map.slots) {
    if (s.pause > 0) {
      s.pause -= 1;
    }
  }
}
