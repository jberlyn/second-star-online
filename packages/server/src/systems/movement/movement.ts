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
  advanceStep,
  applyOutcome,
  attemptMove,
  type BlockSlot,
  blockPCCheck,
  type DeltaEvent,
  DIR_DELTA,
  DIR_FACING,
  type Dir,
  isShip,
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
import { isCrafting } from "../crafting/craft.ts";
import { groundBlocks } from "../inventory/items.ts";
import { bodyOf } from "../monsters/slots.ts";
import { type Outgoing, PENDING_MAX_TICKS, type Player, type Room } from "../world/world.ts";
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
  /** Any other message for a player (a shoved crafter's key unlock). */
  send?(o: Outgoing): void;
}

/** Records a `move` intent: the held arrow and the Turn modifier. */
export function setHeld(p: Player, held: Dir | null, turn: boolean, scheduled = false): void {
  if (scheduled) {
    p.walkQueue ??= [];
    p.pending = null;
  }
  // Pushes also read the current Turn modifier, even for scheduled clients.
  p.heldTurn = turn;
  // A new press: the next refusal prints its line again. A release does not clear it: a scheduled
  // client's queue still holds the steps it sent while the key was down, and each would print the
  // line again after the key came up (as the attack refusal is said once a press, not on release).
  if (held !== null) {
    p.told = null;
  }
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
  p.told = null;
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
  // Only this request is refused; the ones already queued are still checked in turn.
  // A running craft holds the player even if a stray window close cleared the key lock.
  if (p.loading > 0 || p.keyLock || isCrafting(p) || p.walkQueue.length >= 4) {
    refuseScheduled(p, msg.seq);
    return;
  }
  p.walkQueue.push({ seq: msg.seq, dir: msg.dir, turn: msg.turn, at: msg.at });
}

/**
 * Reports a refused request by its sequence number. Only that request is refused: requests behind
 * it are checked on their own, so the client can tell a refusal of a request it sent after its last
 * correction (which needs another correction) from one it sent before (already corrected).
 */
function refuseScheduled(p: Player, seq: number): void {
  p.moveRejected = Math.max(p.moveRejected ?? 0, seq);
  p.forceYou = true;
}

/** Refuses the request at the head of the queue. */
function refuseHead(p: Player): void {
  const queued = p.walkQueue?.shift();
  if (queued) {
    refuseScheduled(p, queued.seq);
  }
}

export function walkWorld(room: Room, self: Player): WalkWorld {
  if (isShip(self.vehicle)) {
    // A ship sails only on water and blocks like a walker, as 1.6 wrote it (only the Airship set
    // "block nothing"): players, other ships, monsters and fixtures such as a parked ship stop it.
    // Webs are ignored aboard.
    return {
      walkable: (x, y) => isWalkable(room.map.walkShip, x, y),
      pcBlocked: (x, y) =>
        blockPCCheck(
          x,
          y,
          room.players.filter((o) => o !== self && o.vehicle !== "Airship"),
          slotsFor(room, self),
        ),
      itemBlocks: (x, y) => groundBlocks(room, self, x, y),
      webAt: () => false,
    };
  }
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
    // Other players at their logical tiles, then slots 1-4 by the names this player was shown. A
    // player mid-step blocks the tile it is stepping onto (a bug fixed: 1.6 compared sprite
    // positions, so a moving player blocked no one and two could end on one tile).
    pcBlocked: (x, y) =>
      blockPCCheck(
        x,
        y,
        room.players.filter((o) => o !== self && !o.vehicle),
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
  // 1.6's client-side input lock: map loading, or a window holding the keys; a running craft holds
  // the player too, whatever the key lock says.
  if (p.loading > 0 || p.keyLock || isCrafting(p)) {
    p.pending = null;
    // Every queued request was predicted without the lock: refuse them all at once.
    const last = p.walkQueue?.at(-1);
    if (last) {
      p.walkQueue = [];
      refuseScheduled(p, last.seq);
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
    // A scheduled request waits out the attack animation (a few ticks), as it waits for the step
    // cadence: the attack key is sent when pressed and steps on client ticks, so a step the client
    // sent just before attacking can reach the same server tick as the swing. A hold or the death
    // lock can last much longer, so a request then is refused.
    if (p.spell.hold > 0 || p.deadLock > 0) {
      refuseHead(p);
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
    refuseHead(p);
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
      refuseScheduled(p, queued.seq);
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
 * Prints a refusal line once for the current press: a held key, or a scheduled client's repeated
 * requests, print it on the first refusal only.
 */
export function tellOnce(p: Player, text: string, tell: (text: string) => void): void {
  if (p.told !== text) {
    tell(text);
    p.told = text;
  }
}

/**
 * Applies one move outcome and reports it. Shared by a player's own move and a push, which runs the
 * victim's own move.
 */
export function carryOut(room: Room, p: Player, dir: Dir, o: MoveOutcome, ctx: MoveCtx): void {
  // A web or edge refusal keeps its line told; the edge's is printed by `crossMapEdge`.
  if (o.kind !== "web" && o.kind !== "edge" && o.kind !== "none") {
    p.told = null;
  }
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
      // Facing untouched; only a web on your own tile counts. Printed once a press (a bug fixed:
      // 1.6 printed it on every attempt while a direction was held).
      tellOnce(p, WEB_TEXT, (text) => ctx.tell(p, text));
      return;
    case "edge":
      // The crossing can still be refused by the next map's tile, so others see the new facing.
      if (p.facing !== before) {
        ctx.emit(p, { e: "turn", id: p.id, facing: p.facing });
      }
      ctx.crossings.push({ player: p, outcome: o });
      return;
  }
}
