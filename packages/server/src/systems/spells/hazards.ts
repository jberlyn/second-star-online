/**
 * The server's 350 ms timer, run every 7 ticks of the 20 Hz simulation (a divergence: 1.6 used a
 * real timer).
 *
 * - **The Server Spirit**: two `random(50)` fireball lanes and six `random(10)` bolt spots cast
 *   into the hazard map, an operator setting that is unset by default, as no archived map is named
 *   `xSlimmySlimm` (SSO ships no invented content).
 * - **The church bell**: the NPC routine counts the runs; at 20 it plays the `Churchy:5:200` sound on
 *   the bell map, and past 460 it starts again at 1. 1.6 hard-wired the group `@x999y999`; SSO's
 *   bell map is a setting (`bellMap`, Classic's `x999y999`), and empty means no bell.
 */
import type { Rng } from "@secondstaronline/shared";

import type { Outgoing, World } from "../world/world.ts";
import { queueCast } from "./fx.ts";

/** Ticks per run of the server timer (350 ms at 20 Hz). */
export const TIMEOUT_TICKS = 7;

/** The eight sends, in order: [odds, spell, casterH, casterV, mouseH, mouseV, power]. */
const SPIRIT: readonly [number, string, number, number, number, number, number][] = [
  [50, "FireballL", 526, 231, 303, 235, 10],
  [50, "FireballR", 78, 359, 530, 358, 10],
  [10, "BoltD", 302, 185, 285, 268, 30],
  [10, "BoltD", 430, 185, 417, 267, 30],
  [10, "BoltD", 174, 185, 168, 283, 30],
  [10, "BoltD", 78, 221, 167, 313, 30],
  [10, "BoltD", 494, 157, 406, 343, 30],
  [10, "BoltD", 78, 93, 118, 220, 30],
];

/** The maps the server timer plays on (settings `hazardMap` and `bellMap`); null for none. */
export interface TimerMaps {
  hazardMap: string | null;
  bellMap: string | null;
}

/** One tick of the server timer; does nothing between runs. */
export function serverTimer(world: World, { hazardMap, bellMap }: TimerMaps, rng: Rng): Outgoing[] {
  if (world.tickNo % TIMEOUT_TICKS !== 0) {
    return [];
  }
  world.timeouts += 1;
  // The 1.6 server rolled every run; with nobody on the hazard map the draws change nothing,
  // so they are made only while the map is in use.
  const room = hazardMap ? world.rooms.get(hazardMap) : undefined;
  for (const [odds, name, ch, cv, h, v, power] of room ? SPIRIT : []) {
    if (room && rng.random(odds) === 1) {
      queueCast(room, {
        owner: "The Server Spirit",
        ownerId: null,
        name,
        casterH: ch,
        casterV: cv,
        h,
        v,
        power,
      });
    }
  }
  const out: Outgoing[] = [];
  world.npcAct += 1;
  if (world.npcAct === 20 && bellMap) {
    for (const p of world.rooms.get(bellMap)?.players ?? []) {
      out.push({ to: p.id, msg: { t: "sound", name: "churchy", ch: 5, volume: 200 } });
    }
  }
  if (world.npcAct > 460) {
    world.npcAct = 1;
  }
  return out;
}
