/**
 * Sim test helpers: hand-built maps, players and a tick runner with an injected `Rng`.
 */
import type { ServerMsg } from "@secondstaronline/shared";

import { type Rng, scriptedRng } from "../../src/rng.ts";
import type { CasinoDeps } from "../../src/systems/casino/index.ts";
import { archiveNpcStore } from "../../src/systems/monsters/npcfiles.ts";
import { tick } from "../../src/systems/world/tick.ts";
import {
  addPlayer,
  createWorld,
  defaultCharacter,
  type Player,
  sessionCombatState,
  toWorldMap,
  type World,
  type WorldMap,
} from "../../src/systems/world/world.ts";

/** Casino deps for a warp in a test with no casino game: no grace and no offline payouts. */
export const NO_CASINO: CasinoDeps = { graceTicks: 0, addGoldOffline: () => {} };

/**
 * Answers `random(n)` from per-size queues; a size with no queue (or an empty one) gets `n`,
 * which matches only `random(1)`: no push, no spawn, no attack, no hunger loss.
 */
export function rngByN(queues: Record<number, number[]> = {}): Rng & { calls: number[] } {
  const calls: number[] = [];
  return {
    calls,
    random(n) {
      calls.push(n);
      if (!(n >= 1)) {
        return 0;
      }
      const q = queues[n];
      return q && q.length > 0 ? (q.shift() as number) : n;
    },
  };
}

/** The original NPC files: tests that build a room or ctx by hand use these. */
export const ARCHIVE_NPCS = archiveNpcStore();

/** Never rolls `random(25) = 1`, so walking into a player never pushes. */
export const NEVER_PUSH: Rng = scriptedRng([2]);

const blank = (code: string) => Array.from({ length: 12 }, () => Array(17).fill(code).join(" "));
export function testMap(
  name: string,
  trees: [number, number][] = [],
  layer1: (x: number, y: number) => string = () => "G1",
): WorldMap {
  const l2 = Array.from({ length: 12 }, (_, y) =>
    Array.from({ length: 17 }, (_, x) =>
      trees.some(([tx, ty]) => tx === x + 1 && ty === y + 1) ? "S3" : "G3",
    ).join(" "),
  );
  return toWorldMap({
    id: name,
    name,
    title: "",
    layers: [
      Array.from({ length: 12 }, (_, y) =>
        Array.from({ length: 17 }, (_, x) => layer1(x + 1, y + 1)).join(" "),
      ),
      l2,
      blank("G3"),
      blank("5A"),
    ],
  });
}

export function player(id: string, map: WorldMap, x: number, y: number): Player {
  return {
    id,
    accountId: id,
    name: id,
    head: 1,
    map,
    x,
    y,
    facing: "N",
    stepFrames: 0,
    vehicle: null,
    held: null,
    heldTurn: false,
    pending: null,
    loading: 0,
    n: 0,
    resumed: false,
    saveIn: 600,
    lastSent: null,
    forceYou: false,
    role: "player",
    broadcastIn: 0,
    chatIn: 0,
    char: defaultCharacter(),
    ...sessionCombatState(),
    ip: "127.0.0.1",
  };
}

export function setup(
  maps: WorldMap[],
  /** Where a player whose place (or respawn map) is gone goes. */
  fallbackPoint = { map: "x1000y992", x: 6, y: 4 },
  rng: Rng = NEVER_PUSH,
  /** A wall clock (ms) for the tick, such as jail sentences; none by default. */
  now?: () => number,
) {
  const byName = new Map(maps.map((m) => [m.name, m]));
  const world: World = createWorld();
  const deps = {
    loadMap: (n: string) => byName.get(n) ?? null,
    loadMapById: (id: string) => maps.find((m) => m.id === id) ?? null,
    fallbackPoint,
    saveIntervalTicks: 600,
    rng,
    casino: NO_CASINO,
    ...(now ? { now } : {}),
  };
  const join = (p: Player) => {
    addPlayer(world, p);
    p.loading = 0; // as if mapReady arrived
  };
  const run = (n = 1) => {
    const all: { to: string; msg: ServerMsg }[] = [];
    for (let i = 0; i < n; i++) {
      all.push(...tick(world, deps).out);
    }
    return all;
  };
  return { world, join, run };
}
