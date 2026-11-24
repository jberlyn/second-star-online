/**
 * Monster movement.
 *
 * - The move-author pick runs once per player on the map per tick, with that client's ladder.
 * - A hostile walk chases that player: each step leans toward where they stand when the step
 *   starts. Other walks are random.
 * - Steps run back to back, 16 frames each; a blocked step is skipped at no time cost. The logical
 *   tile changes when a step starts. Walls, water, the screen edge, players and other monsters
 *   block a step.
 */

import {
  anyMatch,
  blocksMonster,
  content,
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

/**
 * The odds for the move-author pick by players on the screen (`balance.monsters.moveLadder`;
 * Classic 30 … 600), its last step from the 8th player on (a bug fixed: 1.6 fell back to 50 at the
 * 9th, so crowded screens' monsters nearly never stopped).
 */
export function moveLadder(players: number): number {
  const ladder = content().balance.monsters.moveLadder;
  return ladder[Math.min(Math.max(players, 1), ladder.length) - 1] as number;
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

/** A planned walk: random steps, or a chase of `steps` steps after one player. */
export interface WalkPlan {
  queue: Dir[];
  chase: { id: string; steps: number } | null;
}

/**
 * Authors a walk of `random(10)` steps (`balance.monsters.walkStepsRandomN`): a species on the hostile list chases `author`, others walk
 * at random. Returns null when the monster never moves (`FLG|Still`, or no NPC data).
 */
export function authorPath(
  npcs: NpcStore,
  m: LiveMonster,
  author: Player,
  rng: Rng,
): WalkPlan | null {
  const steps = rng.random(content().balance.monsters.walkStepsRandomN); // drawn before the Still test
  if (!npcData(npcs, m.name) || hasFlag(npcs, m.name, "Still")) {
    return null;
  }
  if (leansToward(m.name)) {
    return { queue: [], chase: { id: author.id, steps } };
  }
  const queue: Dir[] = [];
  for (let i = 0; i < steps; i++) {
    queue.push(pick(rng, ["U", "D", "L", "R"] as const));
  }
  return { queue, chase: null };
}

/**
 * One chase step: a direction toward `target`, by both sprites' pixel positions now (a bug fixed:
 * 1.6 worked out the whole path at authoring, toward where the player stood then).
 */
export function leanDir(m: LiveMonster, target: Player, rng: Rng): Dir {
  const me = pixel(
    target.x,
    target.y,
    target.facing,
    target.stepFrames,
    stepLengthFor(target.vehicle),
  );
  const mon = pixel(m.x, m.y, m.facing, m.anim, MONSTER_STEP_FRAMES);
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
  return pick(rng, choices);
}

/** The tiles a monster standing at (`x`, `y`) covers: its anchor, and a 3×2 one's footprint. */
export function monsterCells(name: string, x: number, y: number): [number, number][] {
  const cells: [number, number][] = [[x, y]];
  if (isFootprint(name)) {
    for (const [cx, cy] of FOOT_CELLS) {
      cells.push([x + cx, y + cy]);
    }
  }
  return cells;
}

/**
 * True when a player or another monster stands on a tile `slot`'s monster would cover at
 * (`x`, `y`) (a bug fixed: 1.6's monsters walked through both). Logical tiles count, so a walker
 * blocks the tile it is stepping onto; an Airship rider blocks nothing.
 */
export function occupied(
  map: WorldMap,
  slot: MonsterSlot,
  players: readonly Player[],
  x: number,
  y: number,
): boolean {
  const m = slot.live;
  if (!m) {
    return false;
  }
  const mine = monsterCells(m.name, x, y);
  const hits = (cells: readonly (readonly [number, number])[]) =>
    cells.some(([cx, cy]) => mine.some(([tx, ty]) => tx === cx && ty === cy));
  if (players.some((p) => !p.vehicle && hits([[p.x, p.y]]))) {
    return true;
  }
  return map.slots.some(
    (o) => o !== slot && o.live !== null && hits(monsterCells(o.live.name, o.live.x, o.live.y)),
  );
}

/** What a step needs besides the map: the players on it, and draws for chase steps. */
export interface WalkCtx {
  players: readonly Player[];
  rng: Rng;
}

export interface MoveEvent {
  slot: MonsterSlot;
  fromX: number;
  fromY: number;
}

/**
 * Takes steps off the walk until one can start. A step onto a non-water tile (sea movers), a
 * blocked tile, off the screen, onto a blocked footprint cell, or onto a player or another monster
 * is skipped. A blocking ground item on the anchor tile aborts the rest of the walk. A chase ends
 * when its player has left the map. Returns the step started, or null. A started step sets the
 * slot's pause to 90.
 */
export function nextStep(map: WorldMap, slot: MonsterSlot, ctx: WalkCtx): MoveEvent | null {
  const m = slot.live;
  if (!m) {
    return null;
  }
  const sea = anyMatch(content().monsters.rules.sea, m.name);
  const foot = isFootprint(m.name);
  for (;;) {
    let dir: Dir;
    const chase = m.chase;
    if (chase && chase.steps > 0) {
      const target = ctx.players.find((p) => p.id === chase.id);
      if (!target) {
        m.chase = null;
        return null;
      }
      chase.steps -= 1;
      dir = leanDir(m, target, ctx.rng);
    } else if (m.queue.length > 0) {
      dir = m.queue.shift() as Dir;
    } else {
      m.chase = null;
      return null;
    }
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
      // The rest of the walk is dropped and no pause is set.
      m.queue = [];
      m.chase = null;
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
    if (occupied(map, slot, ctx.players, nx, ny)) {
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
    if (m.chase?.steps === 0) {
      m.chase = null;
    }
    slot.pause = 90;
    slot.dirty = true;
    return { slot, fromX, fromY };
  }
}

/**
 * One player's move-author pass. The caller gates on that player's death lock and loading. Sets
 * the author pause of 30 first and then starts the first step, as the original's step arrives with
 * the relayed move message one frame later (a bug fixed: 1.6 gave slot 2 a pause of 0).
 */
export function moverPass(
  npcs: NpcStore,
  map: WorldMap,
  author: Player,
  players: number,
  rng: Rng,
  /** Everyone on the map: they block steps, and a chase follows one of them. */
  onMap: readonly Player[],
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
  if (neverMoves(m.name) || slot.pause !== 0) {
    return null;
  }
  const plan = authorPath(npcs, m, author, rng);
  slot.pause = 30;
  if (!plan) {
    return null;
  }
  m.queue = plan.queue;
  m.chase = plan.chase;
  return nextStep(map, slot, { players: onMap, rng });
}

/**
 * The walk tick in each monster's `stepFrame`: 2 px a frame; on the frame the step ends the next
 * one starts at once.
 */
export function walkTick(map: WorldMap, slot: MonsterSlot, ctx: WalkCtx): MoveEvent | null {
  const m = slot.live;
  if (!m || m.anim === 0) {
    return null;
  }
  m.anim -= 1;
  if (m.anim === 0) {
    return nextStep(map, slot, ctx);
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
