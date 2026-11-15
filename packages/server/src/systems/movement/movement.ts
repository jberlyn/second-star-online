/**
 * Server-side movement. Applies the shared step model (shared/rules/movement/movement.ts) to each
 * player, once per tick.
 *
 * Per tick, per map (tick step 2):
 * 1. every player's step animation advances (`stepFrame` runs before the frame script);
 * 2. each player, in arrival order, acts on its next scheduled direction or legacy held input. A walk off the edge
 *    is returned as a map change for the caller to carry out. A step blocked into a standing player
 *    rolls a push for each of them (push.ts).
 */
import {
  ANTI_MACRO_START,
  advanceStep,
  applyOutcome,
  attemptMove,
  type BlockSlot,
  blockPCCheck,
  type DeltaEvent,
  DIR_DELTA,
  type Dir,
  isWalkable,
  isWebBody,
  type MoveOutcome,
  monsterSpriteTile,
  type ServerMsg,
  type StepMsg,
  stepLengthFor,
  type WalkWorld,
  WEB_TEXT,
} from "@secondstaronline/shared";

import type { Rng } from "../../rng.ts";
import { groundBlocks } from "../inventory/items.ts";
import { bodyOf } from "../monsters/slots.ts";
import { PENDING_MAX_TICKS, type Player, type Room } from "../world/world.ts";
import { rollPushes } from "./push.ts";

/** A walk off the edge of the screen. */
export interface EdgeCrossing {
  player: Player;
  outcome: Extract<MoveOutcome, { kind: "edge" }>;
}

/** What movement needs from the tick, and where it reports what happened. */
export interface MoveCtx {
  rng: Rng;
  /** A delta event others on the map should see, caused by `actor`. */
  emit(actor: Player, ev: DeltaEvent): void;
  /** A chat line for one player (push messages). */
  tell(to: Player, text: string): void;
  /** Map changes to carry out after the room loop. */
  crossings: EdgeCrossing[];
}

/** Records a `move` intent: the held arrow and the Turn modifier. */
export function setHeld(p: Player, held: Dir | null, turn: boolean, scheduled = false): void {
  if (scheduled) {
    p.walkQueue ??= [];
    p.pending = null;
  }
  // Pushes also read the current Turn modifier, even for scheduled clients.
  p.heldTurn = turn;
  if (p.walkQueue) {
    p.held = null;
    return;
  }
  p.held = held;
}

/** Records a `step` press. A newer press replaces an older one that was not acted on. */
export function pressStep(p: Player, dir: Dir, turn: boolean): void {
  if (p.walkQueue || p.loading > 0) {
    return;
  }
  p.pending = { dir, turn, age: 0 };
}

/** Bounded FIFO of directions committed by prediction. The server still checks every move. */
export function scheduleStep(p: Player, msg: StepMsg): void {
  if (!msg.at) {
    return;
  }
  p.walkQueue ??= [];
  p.held = null;
  p.pending = null;
  if (p.loading > 0 || p.keyLock || p.walkQueue.length >= 4) {
    rejectScheduled(p, msg.seq);
    return;
  }
  p.walkQueue.push({ seq: msg.seq, dir: msg.dir, turn: msg.turn, at: msg.at });
}

function rejectScheduled(p: Player, seq: number): void {
  p.moveRejected = Math.max(seq, p.walkQueue?.at(-1)?.seq ?? seq);
  p.walkQueue = [];
  p.forceYou = true;
}

export function walkWorld(room: Room, self: Player): WalkWorld {
  if (self.vehicle) {
    // An Airship has its own grid and 1.6's "block nothing" flag: fixtures, players and monsters
    // never block it, and there is no push roll.
    return {
      walkable: (x, y) => isWalkable(room.map.walkAir, x, y),
      pcBlocked: () => false,
      itemBlocks: () => false,
      // Webs are ignored aboard (the web test only runs with no vehicle).
      webAt: () => false,
    };
  }
  return {
    walkable: (x, y) => isWalkable(room.map.walk, x, y),
    // Standing players, then slots 1-4 by the names this player was shown. A player blocks only
    // while standing: a moving one is between tiles (a kept 1.6 bug).
    pcBlocked: (x, y) =>
      blockPCCheck(
        x,
        y,
        room.players.filter((o) => isStandingOther(self, o)),
        slotsFor(room, self),
      ),
    // Fixtures on the ground block too; loot never does.
    itemBlocks: (x, y) => groundBlocks(room, self, x, y),
    // A live Web exactly on the walker's own tile. A web never moves.
    webAt: (x, y) =>
      room.map.slots.some(
        (s) =>
          s.live !== null && isWebBody(bodyOf(s.live.name)) && s.live.x === x && s.live.y === y,
      ),
  };
}

/** A standing player other than `self`; a rider blocks no one. */
function isStandingOther(self: Player, o: Player): boolean {
  return o !== self && !o.vehicle && o.stepFrames === 0;
}

/** Slots 1-4 as `self`'s step-blocking test sees them: remembered name, live sprite tile. */
function slotsFor(room: Room, self: Player): BlockSlot[] {
  return room.map.slots.map((s, i) => {
    const m = s.live;
    return {
      name: self.shownNames[i] ?? null,
      at: m ? monsterSpriteTile(m.x, m.y, m.fromX, m.fromY, m.anim) : null,
    };
  });
}

/** The standing players other than `self` on a tile, in `room.players` order. */
export function standingPlayersAt(room: Room, self: Player, x: number, y: number): Player[] {
  return room.players.filter((o) => isStandingOther(self, o) && o.x === x && o.y === y);
}

/**
 * Remembers the names a player is shown placed in slots 1-4: from each `snapshot`'s
 * monsters and each `mspawn`. Never clears: death and map changes leave the names.
 */
export function noteShown(p: Player, msg: ServerMsg): void {
  if (msg.t === "snapshot") {
    for (const v of msg.monsters) {
      p.shownNames[v.slot - 1] = v.name;
    }
  } else if (msg.t === "delta") {
    for (const ev of msg.events) {
      if (ev.e === "mspawn") {
        p.shownNames[ev.monster.slot - 1] = ev.monster.name;
      }
    }
  }
}

/** The player sprite's step animation, once per `stepFrame` call. */
export function advancePlayer(p: Player): void {
  advanceStep(p);
}

/**
 * The map-load lock's countdown (SSO's own rule, a divergence: 100 ticks). Not an actor: it counts
 * frames, once per tick, however many `stepFrame`s the actors get.
 */
export function tickLoading(p: Player): void {
  if (p.loading > 0) {
    p.loading -= 1;
  }
}

/**
 * Step 2 for one player: acts on its next scheduled direction or legacy input. Others' views go to
 * `ctx.emit`; an edge crossing goes to `ctx.crossings`.
 */
export function movePlayer(room: Room, p: Player, ctx: MoveCtx): void {
  // 1.6's client-side input lock: map loading, or a window holding the keys.
  if (p.loading > 0 || p.keyLock) {
    p.pending = null;
    const queued = p.walkQueue?.[0];
    if (queued) {
      rejectScheduled(p, queued.seq);
    }
    return;
  }
  // Pushed off the screen earlier this tick: the map change comes first.
  if (ctx.crossings.some((c) => c.player === p)) {
    return;
  }
  const pending = p.pending;
  // No step starts during the attack animation, while held (the hold counter) or in the death
  // lock.
  if (p.timers.atkAnim > 0 || p.spell.hold > 0 || p.deadLock > 0) {
    // A committed prediction cannot wait through a combat lock and move after it timed out.
    const queued = p.walkQueue?.[0];
    if (queued) {
      rejectScheduled(p, queued.seq);
    }
    if (pending) {
      pending.age += 1;
      if (pending.age > PENDING_MAX_TICKS) {
        p.pending = null;
      }
    }
    return;
  }
  const queued = p.walkQueue?.[0];
  if (
    queued &&
    (queued.at.map !== p.map.name ||
      queued.at.n !== p.n ||
      queued.at.x !== p.x ||
      queued.at.y !== p.y)
  ) {
    rejectScheduled(p, queued.seq);
    return;
  }
  const dir = queued ? queued.dir : pending ? pending.dir : p.held;
  const turn = queued ? queued.turn : pending ? pending.turn : p.heldTurn;
  if (!dir) {
    return;
  }

  const o = attemptMove(p, dir, turn, walkWorld(room, p));
  if (o.kind === "none") {
    if (pending) {
      pending.age += 1;
      if (pending.age > PENDING_MAX_TICKS) {
        p.pending = null;
      }
    }
    return;
  }
  if (queued) {
    p.walkQueue?.shift();
    if (!queued.at.blocked && (o.kind === "blocked" || o.kind === "web")) {
      rejectScheduled(p, queued.seq);
    }
  }
  p.pending = null;
  // The client may have shown a refused press as a step; tell it where it really is.
  if (pending && (o.kind === "blocked" || o.kind === "web")) {
    p.forceYou = true;
  }
  carryOut(room, p, dir, o, ctx);
}

/**
 * 1.6 refreshes the fishing allowance when the facing is not "Left" (to 5), which
 * compares "W" with "Left" and so always holds (a kept bug): every press that gets past the turn,
 * the player/monster and item blocks and the mid-step test refreshes it, a step into a wall or off
 * the screen included. The web test runs after the refresh, so a webbed press refreshes it too.
 */
function refreshAntiMacro(p: Player, o: MoveOutcome): void {
  if (
    o.kind === "step" ||
    o.kind === "edge" ||
    o.kind === "web" ||
    (o.kind === "blocked" && o.by === "tile")
  ) {
    p.antiMacro = ANTI_MACRO_START;
  }
}

/**
 * Applies one move outcome and reports it. Shared by a player's own move and a push, which runs the
 * victim's own move.
 */
export function carryOut(room: Room, p: Player, dir: Dir, o: MoveOutcome, ctx: MoveCtx): void {
  refreshAntiMacro(p, o);
  const before = p.facing;
  const [dx, dy] = DIR_DELTA[dir];
  const tx = p.x + dx;
  const ty = p.y + dy;
  applyOutcome(p, o, stepLengthFor(p.vehicle));
  announce(p, o, before, ctx);
  // Each standing player's push is rolled whatever the step then does; the roll comes after
  // the step is applied, as a victim acts frames later.
  if (o.kind !== "none" && o.kind !== "turn" && !p.vehicle) {
    rollPushes(room, p, tx, ty, dir, ctx);
  }
}

function announce(p: Player, o: MoveOutcome, before: Player["facing"], ctx: MoveCtx): void {
  switch (o.kind) {
    case "none":
      return;
    case "turn":
    case "blocked":
      // Faces the way it tried to go. Others see the new facing at once (a deliberate divergence
      // from 1.6).
      if (p.facing !== before) {
        ctx.emit(p, { e: "turn", id: p.id, facing: p.facing });
      }
      return;
    case "step":
      p.n += 1;
      ctx.emit(p, {
        e: "move",
        id: p.id,
        fromX: o.fromX,
        fromY: o.fromY,
        toX: o.toX,
        toY: o.toY,
        facing: o.facing,
        frames: p.stepFrames,
      });
      return;
    case "web":
      // Printed on every attempt, facing untouched (a kept 1.6 bug; only a web on your own tile
      // counts).
      ctx.tell(p, WEB_TEXT);
      return;
    case "edge":
      ctx.crossings.push({ player: p, outcome: o });
      return;
  }
}
