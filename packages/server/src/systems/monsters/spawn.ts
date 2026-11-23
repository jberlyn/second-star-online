/**
 * Spawning. One pass of 1.6's spawner per player on the map per tick, with that client's
 * player-count ladder, against the server's one set of slots, so two players' rolls can never fill
 * a slot twice.
 */
import {
  anyMatch,
  blocksMonster,
  content,
  factionByKey,
  isWalkable,
  MAP_HEIGHT,
  MAP_WIDTH,
  type Rng,
} from "@secondstaronline/shared";

import type { WorldMap } from "../world/world.ts";
import { FOOT_CELLS, isWater } from "./ai.ts";
import { isFootprint, isNpced, type LiveMonster, type MonsterSlot, species } from "./slots.ts";

/** The odds for the spawn gate by players on the screen, 1..7+. */
export function spawnLadder(players: number): number {
  const ladder = [80, 120, 230, 400, 600, 900, 1300];
  return ladder[Math.min(Math.max(players, 1), ladder.length) - 1] as number;
}

const FACING_ROLL = ["N", "S", "W", "E"] as const;

/** True when a ground item on (x, y) stands in the way of a monster (`ground.blocks`). */
function blockedByItem(map: WorldMap, x: number, y: number): boolean {
  return map.ground.some((g) => g.x === x && g.y === y && blocksMonster(g.item));
}

/**
 * True when the tile is refused. Sea creatures (`rules.sea`, the list their movement uses) need
 * water; the rest need a walkable tile. A 3×2 monster also needs every footprint cell on the map
 * to be walkable, wherever its anchor is (bugs fixed: 1.6 checked only Squid, Shark and Mizella for
 * water, and skipped the footprint test past column 12 or row 9). No tile the monster covers may
 * hold a blocking ground item such as an Anvil or a statue (a bug fixed: 1.6 spawned on them).
 * Players and monsters on the tile do not matter.
 */
export function refusesTile(map: WorldMap, name: string, x: number, y: number): boolean {
  if (
    anyMatch(content().monsters.rules.sea, name) ? !isWater(map, x, y) : !isWalkable(map.walk, x, y)
  ) {
    return true;
  }
  if (blockedByItem(map, x, y)) {
    return true;
  }
  if (!isFootprint(name)) {
    return false;
  }
  // A cell off the screen is never in the NPC blocked tiles, so it never refuses.
  return FOOT_CELLS.some(([cx, cy]) => {
    const tx = x + cx;
    const ty = y + cy;
    const onMap = tx >= 1 && tx <= MAP_WIDTH && ty >= 1 && ty <= MAP_HEIGHT;
    return onMap && (!isWalkable(map.walk, tx, ty) || blockedByItem(map, tx, ty));
  });
}

export interface SpawnCtx {
  rng: Rng;
  /** Server minute of the hour, for Zombie and Skeleton. */
  minute: number;
  /** Players on the map, for the ladder. */
  players: number;
}

/**
 * The monster in each slot this pass: the roster, with the faction swap (the map's faction's
 * `member`, in a slot picked by `random(35)`, 1-4 taking one).
 */
function passRoster(map: WorldMap, rng: Rng): (string | null)[] {
  const mon = map.slots.map((s) => s.species);
  const member = factionByKey(map.flags.fctSpwn || null)?.member;
  if (member) {
    const k = rng.random(35);
    if (k >= 1 && k <= 4) {
      mon[k - 1] = member;
    }
  }
  return mon;
}

/** The hit points of a name not in the data. */
export const DEFAULT_HP = 1;

/**
 * A species' starting hit points; a name not in the data starts with `DEFAULT_HP` (a bug fixed:
 * 1.6 left the slot's old value for any species its HP table did not list, which in SSO was the
 * last occupant's HP at death).
 */
export function spawnHp(name: string): number {
  return species(name)?.hp ?? DEFAULT_HP;
}

/** A new live monster. */
export function placeMonster(name: string, x: number, y: number, rng: Rng): LiveMonster {
  const sp = species(name);
  const facing = FACING_ROLL[rng.random(4) - 1] ?? "N";
  return {
    name: sp?.name ?? name,
    hp: spawnHp(name),
    x,
    y,
    facing,
    anim: 0,
    fromX: x,
    fromY: y,
    queue: [],
    hitCountb: 0,
  };
}

/**
 * One player's spawner pass. Returns the slots that spawned. The gates for that player
 * (death lock, loading, the 45-frame wait after map entry) are the caller's.
 */
export function spawnPass(map: WorldMap, ctx: SpawnCtx): MonsterSlot[] {
  const { rng } = ctx;
  const mon = passRoster(map, rng);
  if (mon.every((m) => !m)) {
    return [];
  }
  if (rng.random(spawnLadder(ctx.players)) !== 1) {
    return [];
  }
  const spawned: MonsterSlot[] = [];
  for (const slot of map.slots) {
    const name = mon[slot.slot - 1];
    if (!name || slot.live) {
      continue;
    }
    const x = rng.random(MAP_WIDTH);
    const y = rng.random(MAP_HEIGHT);
    if (refusesTile(map, name, x, y)) {
      continue;
    }
    const drop = rng.random(5); // drawn even while the slot is paused
    if (slot.pause !== 0 || drop !== 1) {
      continue;
    }
    // An NPC's extra roll; a failure skips only this slot (a bug fixed: 1.6 ended the whole pass).
    if (isNpced(name) && rng.random(60) > 2) {
      continue;
    }
    const sp = species(name);
    if (sp?.spawnMinute && !(ctx.minute > sp.spawnMinute.gt && ctx.minute < sp.spawnMinute.lt)) {
      continue;
    }
    slot.live = placeMonster(name, x, y, rng);
    slot.pause = 30;
    slot.dirty = true;
    spawned.push(slot);
  }
  return spawned;
}
