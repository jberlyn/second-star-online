/**
 * Pushing.
 *
 * - The roll: every press that reaches the player-block check rolls `random(25) = 1` once for each
 *   standing player on the target tile, in sprite order; each hit sends that player a push message
 *   with a direction and a strength. The roll is made whatever the step then does: a Web or Holy
 *   Shield that lets the step go does not cancel it (a kept 1.6 bug).
 * - The shove, on the victim's side: immortals and players under 1.6's client-side input lock are
 *   immune. If the pusher's strength is lower the victim reads "… is too weak", and then the code
 *   falls through anyway (a kept 1.6 bug): "… shoves you out of the way." and the victim's own move
 *   runs. That move runs the normal checks, so a victim holding Turn only turns, a wall stops it
 *   silently, and a standing player behind it gets its own push roll (a chain).
 *
 * The rolls and the pushes happen in the same tick (the original's message arrived a few frames
 * later), all rolls before any shove. The input lock is set while a window holds the keys (the Bio
 * window and the vault), and a player still `loading` its map counts as locked.
 */
import { attemptMove, type Dir, pushLines } from "@secondstaronline/shared";

import { isCrafting } from "../crafting/craft.ts";
import type { Player, Room } from "../world/world.ts";
import { carryOut, type MoveCtx, standingPlayersAt, walkWorld } from "./movement.ts";

/**
 * The 1/25 roll for each standing player on the target tile, in `room.players` order; the hits are
 * collected first and shoved after the last roll.
 */
export function rollPushes(
  room: Room,
  pusher: Player,
  tx: number,
  ty: number,
  dir: Dir,
  ctx: MoveCtx,
): void {
  const hit = standingPlayersAt(room, pusher, tx, ty).filter((v) => ctx.rng.random(25) === 1);
  for (const victim of hit) {
    pushOnMe(room, victim, dir, pusher, ctx);
  }
}

/** The shove on the victim's side. */
export function pushOnMe(room: Room, victim: Player, dir: Dir, pusher: Player, ctx: MoveCtx): void {
  if (victim.role === "immortal" || isKeyLocked(victim)) {
    return;
  }
  // Already pushed off the screen this tick: the map change comes first.
  if (ctx.crossings.some((c) => c.player === victim)) {
    return;
  }
  for (const line of pushLines(pusher.name, pusher.char.stats.str < victim.char.stats.str)) {
    ctx.tell(victim, line);
  }
  const o = attemptMove(victim, dir, victim.heldTurn, walkWorld(room, victim));
  carryOut(room, victim, dir, o, ctx);
}

/** The input lock: map loading, or a window holding the keys. A craft's lock does not stop a shove. */
function isKeyLocked(p: Player): boolean {
  return p.loading > 0 || (p.keyLock && !isCrafting(p));
}
