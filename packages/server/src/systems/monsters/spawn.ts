/**
 * Spawning. One pass of 1.6's spawner per player on the map per tick, with that client's
 * player-count ladder, against the server's one set of slots, so two players' rolls can never fill
 * a slot twice.
 */
import { monstersData } from "@secondstaronline/data";
import { anyMatch, isWalkable, MAP_HEIGHT, MAP_WIDTH, type Rng } from "@secondstaronline/shared";

import type { WorldMap } from "../world/world.ts";
import { FOOT_CELLS, isWater } from "./ai.ts";
import { isFootprint, isNpced, type LiveMonster, type MonsterSlot, species } from "./slots.ts";

/** The odds for the spawn gate by players on the screen, 1..7+. */
export function spawnLadder(players: number): number {
  const ladder = [80, 120, 230, 400, 600, 900, 1300];
  return ladder[Math.min(Math.max(players, 1), ladder.length) - 1] as number;
}

const FACING_ROLL = ["N", "S", "W", "E"] as const;

/**
 * True when the tile is refused. Land species fail on a blocked tile; then a tile with x > 12 or
 * y > 9 is accepted before the footprint test, so the footprint check is skipped there (a kept 1.6
 * bug). Only Squid, Shark and Mizella use the water test, so five other sea creatures spawn by land
 * rules (also kept). Players, monsters and items on the tile do not matter.
 */
export function refusesTile(map: WorldMap, name: string, x: number, y: number): boolean {
  const seaSpawn = anyMatch(monstersData.rules.seaSpawn, name);
  let refused = false;
  if (seaSpawn) {
    if (!isWater(map, x, y)) {
      refused = true;
    }
  } else {
    if (!isWalkable(map.walk, x, y)) {
      refused = true;
    }
    if (x > 12 || x < 1 || y > 9 || y < 1) {
      return refused;
    }
  }
  if (isFootprint(name)) {
    // A cell off the screen is never in the NPC blocked tiles, so it never refuses.
    for (const [cx, cy] of FOOT_CELLS) {
      const tx = x + cx;
      const ty = y + cy;
      const onMap = tx >= 1 && tx <= MAP_WIDTH && ty >= 1 && ty <= MAP_HEIGHT;
      if (onMap && !isWalkable(map.walk, tx, ty)) {
        refused = true;
      }
    }
  }
  return refused;
}

export interface SpawnCtx {
  rng: Rng;
  /** Server minute of the hour, for Zombie and Skeleton. */
  minute: number;
  /** Players on the map, for the ladder. */
  players: number;
}

/** The monster in each slot this pass: the roster, with the faction swap. */
function passRoster(map: WorldMap, rng: Rng): (string | null)[] {
  const mon = map.slots.map((s) => s.species);
  const f = map.flags.fctSpwn;
  const who = f === "W" ? "Warrior" : f === "M" ? "Mage" : f === "A" ? "Adventurer" : null;
  if (who) {
    const k = rng.random(35);
    if (k >= 1 && k <= 4) {
      mon[k - 1] = `${who} Faction Member`;
    }
  }
  return mon;
}

/** A new live monster in a slot. */
export function placeMonster(
  slot: MonsterSlot,
  name: string,
  x: number,
  y: number,
  rng: Rng,
): LiveMonster {
  const sp = species(name);
  const facing = FACING_ROLL[rng.random(4) - 1] ?? "N";
  // A name with no hit-point entry keeps the slot's old HP.
  const hp = sp?.hp ?? slot.lastHp ?? 0;
  return {
    name: sp?.name ?? name,
    hp,
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
    // An NPCed roll that fails ends the whole pass (bug ledger "NPCed roll failure aborts").
    if (isNpced(name) && rng.random(60) > 2) {
      return spawned;
    }
    const sp = species(name);
    if (sp?.spawnMinute && !(ctx.minute > sp.spawnMinute.gt && ctx.minute < sp.spawnMinute.lt)) {
      continue;
    }
    slot.live = placeMonster(slot, name, x, y, rng);
    slot.pause = 30;
    slot.dirty = true;
    spawned.push(slot);
  }
  return spawned;
}
