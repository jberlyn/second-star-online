/**
 * Pushing.
 *
 * - The roll: every press that reaches the player-block check rolls `random(25) = 1` once for each
 *   standing player on the target tile, in sprite order; each hit sends that player a push message
 *   with a direction and a strength. A standing player always blocks the step, so the roll comes
 *   with a blocked step.
 * - The shove, on the victim's side: `unpushable` roles and players under 1.6's client-side input lock are
 *   immune. If the pusher's strength is lower the victim reads "… is too weak" and stays (a bug
 *   fixed: 1.6 fell through, printed "… shoves you out of the way." and moved the victim anyway).
 *   Otherwise the victim reads the shove line and its own move runs. That move runs the normal
 *   checks, so a victim holding Turn only turns, a wall stops it silently, and a standing player
 *   behind it gets its own push roll (a chain).
 *
 * The rolls and the pushes happen in the same tick (the original's message arrived a few frames
 * later), all rolls before any shove. The input lock is set while a window holds the keys (the Bio
 * window and the vault), and a player still `loading` its map counts as locked.
 */
import { attemptMove, can, type Dir, pushLines } from "@secondstaronline/shared";

import { isCrafting, stopCraftsOnMove } from "../crafting/craft.ts";
import { type Player, type Room, statsOf } from "../world/world.ts";
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
  if (can(victim.role, "unpushable") || isKeyLocked(victim)) {
    return;
  }
  // Already pushed off the screen this tick: the map change comes first.
  if (ctx.crossings.some((c) => c.player === victim)) {
    return;
  }
  const tooWeak = statsOf(pusher).str < statsOf(victim).str;
  for (const line of pushLines(pusher.name, tooWeak)) {
    ctx.tell(victim, line);
  }
  if (tooWeak) {
    return;
  }
  const from = { x: victim.x, y: victim.y, step: victim.stepFrames };
  const o = attemptMove(victim, dir, victim.heldTurn, walkWorld(room, victim));
  carryOut(room, victim, dir, o, ctx);
  // A crafter shoved off the spot stops crafting, as walking away would.
  const moved = victim.x !== from.x || victim.y !== from.y || victim.stepFrames !== from.step;
  if (moved) {
    for (const out of stopCraftsOnMove(victim)) {
      if (out.msg.t === "chat") {
        ctx.tell(victim, out.msg.text);
      } else {
        ctx.send?.(out);
      }
    }
  }
}

/** The input lock: map loading, or a window holding the keys. A craft's lock does not stop a shove. */
function isKeyLocked(p: Player): boolean {
  return p.loading > 0 || (p.keyLock && !isCrafting(p));
}
