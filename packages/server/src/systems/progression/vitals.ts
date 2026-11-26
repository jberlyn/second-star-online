/**
 * Regen, hunger and death on the server.
 */
import {
  ARENA_TEXT,
  can,
  content,
  DEATH_LOCK_FRAMES,
  type DeathDropRules,
  deathHead,
  deathHunger,
  deathPauseFrames,
  deathVitals,
  exileAtDeath,
  factionPerk,
  goldPileName,
  hastedRegenTarget,
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

import { logActivity, logPlaced } from "../admin/activity.ts";
import { arenaTileTaken } from "../combat/arena.ts";
import { onArenaTile } from "../combat/melee.ts";
import { addGround, type ItemCtx, ItemOut } from "../inventory/items.ts";
import { vehicleDeath } from "../vehicles/vehicles.ts";
import type { Outgoing, Player, Room, World } from "../world/world.ts";

/** The timer sprite (channel 4) for one player: the HP and SP regeneration counter. */
export function regenStep(p: Player): void {
  const v = p.char.vitals;
  const before = `${v.hp}/${v.sp}`;
  const hp = v.hp;
  const usual = regenTarget(factionPerk(p.char.faction, "regeneration"));
  // Haste (issue #17) shortens the period while it runs.
  const target = p.spell.haste > 0 ? hastedRegenTarget(usual) : usual;
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
export function hungerStep(p: Player, noHunger: boolean, rng: Rng): string | null {
  const r = hungerTick(p.char.hunger, noHunger, rng);
  p.char.hunger = r.hunger;
  return r.warning;
}

/**
 * A death more than this many ticks (2 s) after the last hit credits no one: the hit did not kill
 * you (a bug fixed: 1.6 kept the last attacker until death or login, however long ago).
 */
export function killCreditFrames(): number {
  return content().balance.timings.killCreditFrames;
}

/**
 * A player whose HP (or, aboard, hull) has run out, waiting for the death check: the hit that did
 * it is the kill, and no later hit lands or takes the credit, so even a flicker of 0 frames
 * (balance `timings`) credits the fatal hit. (The kill credit is at least 1 frame: a melee,
 * monster or cannon hit lands after the tick's death check, so it is 1 frame old when judged.)
 */
export function downed(p: Player): boolean {
  return p.char.vitals.hp < 1 || (p.vehicle !== null && p.hull !== null && p.hull <= 0);
}

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

/** The death drop: the operator's rules; a role with `dropOnEveryDeath` drops every time, for testing. */
export interface DeathDropCtx {
  item: ItemCtx;
  rules: DeathDropRules;
  everyDeath: boolean;
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
  // A rider dies when the hull runs out (an SSO addition: hits wear the hull, not HP).
  const hullGone = p.vehicle !== null && p.hull !== null && p.hull <= 0;
  if ((v.hp >= 1 && !lightningHit && !hullGone) || p.dontHitMeAgain) {
    return { kind: "none" };
  }
  if (p.hitAge > killCreditFrames()) {
    p.lastToHitMe = null;
    p.lastToHitId = null;
  }
  // A death, the arena's too, ends any poison (issue #17).
  p.spell.poison = null;
  const world = drop?.item.world;
  const arena = !p.vehicle && onArenaTile(room, p.x, p.y);
  if (world) {
    logDeath(world, p, { arena, lightning, vehicle: p.vehicle });
  }
  // A rider over an arena tile is not in the arena: its death is a normal one (an SSO rule).
  if (arena) {
    v.hp = 1;
    v.sp = 1;
    p.vitalsDirty = true;
    // `null` = no passing tile.
    const tile = pickArenaExit(room.map.layers[0], room.map.walk, rng, arenaTileTaken(room, p));
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
  // Dying aboard, or the hull running out, loses the vehicle; the Lightning death clears it too.
  // Kept on purpose: flying into danger is a risk the rider takes.
  const aboard = p.vehicle !== null;
  if (aboard) {
    // The vehicle is lost with nobody carrying it (issue #35); the death row names it too.
    if (drop && p.vehicle) {
      logActivity(drop.item.world, p, "deathDrop", { item: p.vehicle, details: { lost: 1 } });
    }
    out.push(...vehicleDeath(room, p));
  }
  if (lightning) {
    // The Lightning death script sets 1.6's don't-drop flag and has no head or exile code at all; the HP/SP reset, the lock and the pause are as below. The flag and the points
    // still follow at the end of the lock.
    deathVitals(v);
    p.vitalsDirty = true;
    p.deadLock = DEATH_LOCK_FRAMES;
    p.deathPause = deathPauseFrames();
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
      drop.everyDeath ? { ...drop.rules, who: "everyone", minLevel: 0 } : drop.rules,
      rng,
    );
    // The faction head goes down first, even in a vehicle or with drops off.
    const head = deathHead(p.char.faction.key, pvpMap);
    if (head) {
      const io = new ItemOut(room);
      addGround(drop.item, room, io, {
        item: head,
        x: p.x,
        y: p.y,
        kind: "drop",
        expiresAt: null,
        droppedBy: { id: p.id, name: p.name },
      });
      logPlaced(drop.item.world, p, "deathDrop", head);
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
          droppedBy: { id: p.id, name: p.name },
        });
        logActivity(drop.item.world, p, "deathDrop", { item: line.item, qty: -1 });
        invDelSlot(p.char.bag, d.slot, 1);
        p.invDirty = true;
        out.push(...io.out);
      }
    }
    const pile = d.kind === "gold" ? goldPileName(d.amount) : null;
    if (d.kind === "gold" && pile !== null) {
      // A "<n> Gold" pile goes on the death pixel; the server takes the gold since n ≤ gold. No
      // chat line. A world with no currency drops none.
      const io = new ItemOut(room);
      addGround(drop.item, room, io, {
        item: pile,
        x: p.x,
        y: p.y,
        kind: "drop",
        expiresAt: null,
        droppedBy: { id: p.id, name: p.name },
      });
      logActivity(drop.item.world, p, "deathDrop", { gold: -d.amount });
      p.char.gold -= d.amount;
      p.invDirty = true;
      out.push(...io.out);
    }
  }
  const exile = exileAtDeath({ key: p.char.faction.key, count: p.char.factionCount }, v.hpMax);
  if (exile) {
    p.char.faction = { ...NO_FACTION };
    p.char.factionCount = 0;
    lines.push(exile);
  }
  deathVitals(v);
  p.vitalsDirty = true;
  p.deadLock = DEATH_LOCK_FRAMES;
  p.deathPause = deathPauseFrames();
  return { kind: "death", lines, out };
}

/**
 * A death for the activity log: the victim's, naming the killer, and the killer's player kill when
 * a player online landed the last hit. A lost vehicle is noted on the death.
 */
function logDeath(
  world: World,
  p: Player,
  how: { arena: boolean; lightning: boolean; vehicle: string | null },
): void {
  const killer = p.lastToHitId !== null ? world.players.get(p.lastToHitId) : undefined;
  // A killer who has logged off is still named and linked by id.
  const other =
    killer && killer !== p
      ? killer
      : p.lastToHitId !== null && p.lastToHitId !== p.id && p.lastToHitMe !== null
        ? { id: p.lastToHitId, name: p.lastToHitMe }
        : p.lastToHitMe;
  const details = {
    arena: how.arena || null,
    lightning: how.lightning || null,
    vehicleLost: how.arena ? null : how.vehicle,
  };
  logActivity(world, p, "death", { other, details });
  if (killer && killer !== p) {
    logActivity(world, killer, "playerKill", {
      other: p,
      details: { arena: how.arena || null, lightning: how.lightning || null },
    });
  }
}

/** What happens when the death lock ends: hunger 40000, then the respawn warp. */
export function finishDeath(p: Player): void {
  p.char.hunger = deathHunger();
  p.lastToHitMe = null;
  p.lastToHitId = null;
}
