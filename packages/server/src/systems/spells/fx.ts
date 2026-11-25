/**
 * Spell FX on a map: a cast becomes a cast message that every client places at the top of its next
 * frame script, in the lowest free FX sprite; the actorList then steps it each frame. The server
 * keeps one copy.
 *
 * - A slot is free when its sprite's `locV < 0`. With no 11-sprite cap the slot is the lowest free
 *   number.
 * - A FX whose `locV <= 0` never steps; one placed above the stage (a Splash clicked in the top
 *   32 px) stays until its slot is reused.
 */
import {
  cannonballDir,
  cannonballLaunchFrom,
  cannonballLaunchTiles,
  content,
  type DeltaEvent,
  isWalkable,
  newFx,
  placeFx,
  type Rng,
  spellImp,
  stepFx,
} from "@secondstaronline/shared";

import { fighterOf } from "../monsters/attack.ts";
import type { CastMessage, Player, Room, SpellFx } from "../world/world.ts";

/** Queues a cast for the next frame script. */
export function queueCast(room: Room, c: CastMessage): void {
  room.fxQueue.push(c);
}

/** The monster-spell block (`balance.timings.npcSpellBlockFrames`; Classic 30). */
export function npcSpellBlockFrames(): number {
  return content().balance.timings.npcSpellBlockFrames;
}

/**
 * A monster's cast: no player owns it and it is sent as its sprite, "180"-"183" or "a 180"-"a 183".
 * 1.6 tested whether the name contained "18", so any caster with "18" in its name, a player too, set the block.
 */
export function isMonsterCaster(q: Pick<CastMessage, "owner" | "ownerId">): boolean {
  return q.ownerId === null && /^(a )?18[0-3]$/.test(q.owner);
}

function freeSlot(room: Room): number {
  for (let k = 1; ; k += 1) {
    const at = room.fx.find((f) => f.slot === k);
    if (!at || at.v < 0) {
      return k;
    }
  }
}

export interface PlaceResult {
  events: DeltaEvent[];
  /** Skill-gain lines for casters (the cast skill gain on their own echo). */
  lines: { to: Player; text: string }[];
}

/**
 * The frame script's network message: each queued cast as every client ran it. A monster's cast
 * blocks monster spells for everyone here (a bug fixed: 1.6 blocked them for any caster whose name
 * contained "18"); the caster's own client runs the cast skill gain when the caster's loc is
 * positive and the cast trains; then the FX takes the lowest free slot, unless the name places
 * nothing.
 */
export function placeQueued(room: Room, rng: Rng): PlaceResult {
  const res: PlaceResult = { events: [], lines: [] };
  const queue = room.fxQueue.splice(0);
  for (const q of queue) {
    const { casterH, casterV } = q;
    for (const p of room.players) {
      // A client that is still loading ignores spells: it drops the whole message.
      if (p.loading > 0) {
        continue;
      }
      if (isMonsterCaster(q)) {
        p.spell.npcSpellBlock = npcSpellBlockFrames();
      }
    }
    const caster = q.ownerId ? room.players.find((p) => p.id === q.ownerId) : undefined;
    if (q.train !== false && casterH > 0 && casterV > 0 && caster && caster.loading === 0) {
      for (const text of spellImp(q.name, fighterOf(caster), rng, q.castSpell)) {
        res.lines.push({ to: caster, text });
      }
    }
    const at = placeFx(q.name, { h: casterH, v: casterV }, { h: q.h, v: q.v });
    if (!at) {
      continue;
    }
    const slot = freeSlot(room);
    room.fx = room.fx.filter((f) => f.slot !== slot);
    const fx: SpellFx = {
      ...newFx(q.name, at),
      slot,
      power: q.power,
      owner: q.owner,
      ownerId: q.ownerId,
      ...(q.castSpell === undefined ? {} : { castSpell: q.castSpell }),
      ...(q.firedFrom === undefined ? {} : { firedFrom: q.firedFrom }),
    };
    room.fx.push(fx);
    room.fx.sort((a, b) => a.slot - b.slot);
    const ev: DeltaEvent = { e: "fx", slot, name: q.name, h: at.h, v: at.v };
    if (caster && casterH > 0 && casterV > 0) {
      ev.caster = caster.id;
    }
    res.events.push(ev);
    // A cannonball shot whose way out is over a tile an Airship cannot cross stops at once: the
    // shot is heard and seen fired, and nothing flies.
    const shot = cannonballDir(q.name);
    if (shot) {
      fx.sweptTo = cannonballLaunchFrom({ h: casterH, v: casterV }, shot);
    }
    if (shot && cannonballLaunchTiles({ h: casterH, v: casterV }, shot).some(shotBlocked(room))) {
      fx.gone = true;
      room.fx = room.fx.filter((f) => f !== fx);
      res.events.push({ e: "fxend", slot, name: q.name });
    }
  }
  return res;
}

/** A tile a cannonball shot cannot pass: an `airshipBlock` tile (one Classic's Airship cannot cross). */
export function shotBlocked(room: Room): (t: { x: number; y: number }) => boolean {
  return (t) => !isWalkable(room.map.walkAir, t.x, t.y);
}

/** Every FX's `stepFrame`, before the frame's scripts; finished ones go. */
export function advanceFx(room: Room): void {
  const blocked = shotBlocked(room);
  for (const fx of room.fx) {
    stepFx(fx, (x, y) => blocked({ x, y }));
  }
  room.fx = room.fx.filter((f) => !f.gone);
}
