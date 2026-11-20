/**
 * Regen, hunger and death on the server.
 */
import {
  ARENA_TEXT,
  can,
  DEATH_HUNGER,
  DEATH_LOCK_FRAMES,
  DEATH_PAUSE_FRAMES,
  type DeathDropRules,
  deathHead,
  deathVitals,
  exileAtDeath,
  hungerTick,
  invDelSlot,
  lingoEq,
  NO_FACTION,
  pickArenaExit,
  type Rng,
  regenTarget,
  regenTick,
  rollDeathDrop,
} from "@secondstaronline/shared";

import { arenaTileTaken } from "../combat/arena.ts";
import { onArenaTile } from "../combat/melee.ts";
import { addGround, type ItemCtx, ItemOut } from "../inventory/items.ts";
import { vehicleDeath } from "../vehicles/airship.ts";
import { type Outgoing, type Player, type Room, statsOf } from "../world/world.ts";

/** The timer sprite (channel 4) for one player: the HP and SP regeneration counter. */
export function regenStep(p: Player): void {
  const v = p.char.vitals;
  const before = `${v.hp}/${v.sp}`;
  const hp = v.hp;
  const adventurer = p.char.faction.id === 3 ? p.char.faction.f3Bonus : null;
  const target = regenTarget(statsOf(p).spd, adventurer);
  p.regenCounter = regenTick(p.regenCounter, target, p.char.hunger, v);
  // Starving costs no HP for a role that takes no damage.
  if (v.hp < hp && can(p.role, "invulnerable")) {
    v.hp = hp;
  }
  if (`${v.hp}/${v.sp}` !== before) {
    p.vitalsDirty = true;
  }
}

/** Hunger for one player. Returns a warning line, if any. */
export function hungerStep(p: Player, immortal: boolean, rng: Rng): string | null {
  const r = hungerTick(p.char.hunger, immortal, rng);
  p.char.hunger = r.hunger;
  return r.warning;
}

/**
 * A death more than this many ticks (2 s) after the last hit credits no one: the hit did not kill
 * you (a bug fixed: 1.6 kept the last attacker until death or login, however long ago).
 */
export const KILL_CREDIT_TICKS = 40;

/** Once a tick: the last hit grows older. */
export function ageLastHit(p: Player): void {
  p.hitAge += 1;
}

export type DeathOutcome =
  | { kind: "none" }
  /** An arena death: no penalty, a random free tile on the same map. */
  | { kind: "arena"; tile: { x: number; y: number } | null; text: string }
  /** A normal death: the lock starts; an exile line, if any; the head's and drop's ground events. */
  | { kind: "death"; lines: string[]; out: Outgoing[] };

/** The death drop: the operator's rules; an immortal drops on every death, for testing. */
export interface DeathDropCtx {
  item: ItemCtx;
  rules: DeathDropRules;
  immortal: boolean;
  /**
   * A Lightning Assassin game is running: every death is penalty-free, whatever caused it (a bug
   * fixed: 1.6 spared only deaths from a Lightning melee hit).
   */
  lightningGame?: boolean;
}

/**
 * The frame script's `HP < 1 → RunDeathScript`. The guard is a separate don't-hit-again flag, not
 * the i-frames. A stale last hit is forgotten first, so it names no killer. After the arena exit,
 * in 1.6's order: the drop's draws (as the operator's rules allow), a faction member's head on a map whose
 * PvP flag is X (whatever killed it, created from nothing), the item or gold, then exile on HPmax (no
 * channel leave, as in 1.6). A death never lowers HPmax or SPmax (a design change: 1.6 had a one in
 * five chance of −1 each). Dying aboard loses the airship and drops
 * nothing but the head (kept on purpose). The wanted flag waits for the end of the lock (`respawn`).
 */
export function checkDeath(room: Room, p: Player, rng: Rng, drop?: DeathDropCtx): DeathOutcome {
  const v = p.char.vitals;
  // A Lightning hit runs `RunDeathScript2`, which has no `HP > 0` exit.
  const lightningHit = p.lightningDeath;
  p.lightningDeath = false;
  const lightning = lightningHit || (drop?.lightningGame ?? false);
  if ((v.hp >= 1 && !lightningHit) || p.dontHitMeAgain) {
    return { kind: "none" };
  }
  if (p.hitAge > KILL_CREDIT_TICKS) {
    p.lastToHitMe = null;
    p.lastToHitId = null;
  }
  if (onArenaTile(room, p.x, p.y)) {
    v.hp = 1;
    v.sp = 1;
    p.vitalsDirty = true;
    // The rider's exit is drawn from the Airship grid; `null` = no passing tile.
    const tile = pickArenaExit(
      room.map.layers[0],
      p.vehicle === "Airship" ? room.map.walkAir : room.map.walk,
      rng,
      arenaTileTaken(room, p),
    );
    const text = ARENA_TEXT.defeated(p.name, p.lastToHitMe ?? "");
    return { kind: "arena", tile, text };
  }
  p.dontHitMeAgain = true;
  p.facing = "S";
  p.stepFrames = 0; // the walk is cut
  p.attackHeld = false;
  p.attackPress = null;
  const lines: string[] = [];
  const out: Outgoing[] = [];
  const pvpMap = lingoEq(room.map.flags.canPvp, "X");
  // Dying aboard loses the airship, after the arena exit above (an arena death keeps it, as it
  // keeps everything); the Lightning death clears it too. Kept on purpose: flying into danger is a
  // risk the rider takes.
  const aboard = p.vehicle !== null;
  if (aboard) {
    out.push(...vehicleDeath(room, p));
  }
  if (lightning) {
    // The Lightning death script sets 1.6's don't-drop flag and has no head or exile code at all; the HP/SP reset, the lock and the pause are as below. The flag and the points
    // still follow at the end of the lock.
    deathVitals(v);
    p.vitalsDirty = true;
    p.deadLock = DEATH_LOCK_FRAMES;
    p.deathPause = DEATH_PAUSE_FRAMES;
    return { kind: "death", lines, out };
  }
  if (drop) {
    // The drop draws; the pile goes on the death tile.
    const d = rollDeathDrop(
      {
        bag: p.char.bag,
        gold: p.char.gold,
        level: v.level,
        wanted: p.char.wanted,
        killedByPlayer: p.lastToHitId !== null && p.lastToHitId !== p.id,
        inVehicle: aboard,
      },
      drop.immortal ? { ...drop.rules, who: "everyone", minLevel: 0 } : drop.rules,
      rng,
    );
    // The faction head goes down first, even in a vehicle or with drops off.
    const head = deathHead(p.char.faction.id, pvpMap);
    if (head) {
      const io = new ItemOut(room);
      addGround(drop.item, room, io, { item: head, x: p.x, y: p.y, kind: "drop", expiresAt: null });
      out.push(...io.out);
    }
    if (d.kind === "item") {
      const line = p.char.bag[d.slot];
      if (line) {
        const io = new ItemOut(room);
        addGround(drop.item, room, io, {
          item: line.item,
          x: p.x,
          y: p.y,
          kind: "drop",
          expiresAt: null,
        });
        invDelSlot(p.char.bag, d.slot, 1);
        p.invDirty = true;
        out.push(...io.out);
      }
    }
    if (d.kind === "gold") {
      // A "<n> Gold" pile goes on the death pixel; the server takes the gold since n ≤ gold. No
      // chat line.
      const io = new ItemOut(room);
      addGround(drop.item, room, io, {
        item: `${d.amount} Gold`,
        x: p.x,
        y: p.y,
        kind: "drop",
        expiresAt: null,
      });
      p.char.gold -= d.amount;
      p.invDirty = true;
      out.push(...io.out);
    }
  }
  const exile = exileAtDeath({ id: p.char.faction.id, count: p.char.factionCount }, v.hpMax);
  if (exile) {
    p.char.faction = { ...NO_FACTION };
    p.char.factionCount = 0;
    lines.push(exile);
  }
  deathVitals(v);
  p.vitalsDirty = true;
  p.deadLock = DEATH_LOCK_FRAMES;
  p.deathPause = DEATH_PAUSE_FRAMES;
  return { kind: "death", lines, out };
}

/** What happens when the death lock ends: hunger 40000, then the respawn warp. */
export function finishDeath(p: Player): void {
  p.char.hunger = DEATH_HUNGER;
  p.lastToHitMe = null;
  p.lastToHitId = null;
}
