/**
 * The crafting stations on the server: the Cook, Mix, Build and Smith buttons, their per-character
 * timers in the frame script, and their completions, which take the materials and make the result.
 * The rules are in shared/rules/crafting/craft.ts; this applies them to the player.
 */
import {
  advancedLines,
  boundSkillIndex,
  CRAFT_ORDER,
  CRAFT_SKILL,
  CRAFT_SOUND,
  CRAFT_TEXT,
  type CraftJob,
  type CraftKind,
  type CraftSkill,
  FACING_DELTA,
  finishCraft,
  ID_CONTAINERS,
  lingoEq,
  type Rng,
  SMITH_FX_CHANCE,
  startCraft,
  train,
} from "@secondstaronline/shared";

import { holdingsOf, logBagChange } from "../admin/activity.ts";
import { fighterOf } from "../monsters/attack.ts";
import { queueCast } from "../spells/fx.ts";
import { playerLoc } from "../spells/geometry.ts";
import type { Outgoing, Player, Room, World } from "../world/world.ts";

/** One running craft: the Smith, Cook, Build or Mix countdown. */
export interface CraftTimer {
  counter: number;
  job: CraftJob;
}

/** A player's crafting state; client globals in 1.6, so fresh at every login. */
export interface CraftState {
  timers: Partial<Record<CraftKind, CraftTimer>>;
  /** Whether the map was last told this player crafts (the `craft` event): stations animate. */
  shown: boolean;
  /** Where the crafter stood and faced when the craft started; leaving it ends the craft. */
  at: { x: number; y: number; facing: Player["facing"] } | null;
}

export function newCraftState(): CraftState {
  return { timers: {}, shown: false, at: null };
}

/**
 * The `craft` event when a player's crafting changed since the map was last told, so the station
 * they face animates only while it is in use (an SSO change). Null when nothing changed.
 */
export function craftShownChange(p: Player): { e: "craft"; id: string; on: boolean } | null {
  const on = craftingInPlace(p);
  if (on === p.craft.shown) {
    return null;
  }
  p.craft.shown = on;
  return { e: "craft", id: p.id, on };
}

/** True while any craft is running. */
export function isCrafting(p: Player): boolean {
  return Object.keys(p.craft.timers).length > 0;
}

/**
 * True while a craft runs and the crafter is alive and still stands and faces as at its start. A
 * crafter who died, or was turned or moved off the spot (a shove into a wall, an arena hop), is
 * shown as not crafting at once; `craftStep` ends the craft on the next frame.
 */
export function craftingInPlace(p: Player): boolean {
  const at = p.craft.at;
  return (
    isCrafting(p) &&
    p.deadLock === 0 &&
    (at === null || (at.x === p.x && at.y === p.y && at.facing === p.facing))
  );
}

/**
 * A map change ends every running craft: nothing has been taken yet, so nothing is lost. The keys
 * are already free (the map load frees them). Returns the line for the crafter, if a craft ran.
 */
export function cancelCrafts(p: Player): Outgoing[] {
  if (!isCrafting(p)) {
    return [];
  }
  p.craft.timers = {};
  p.craft.at = null;
  return [tell(p, CRAFT_TEXT.interrupted)];
}

/**
 * Being moved off the station (a shove) ends every running craft, as a map change does: the keys
 * are freed and the crafter is told. Nothing has been taken, so nothing is lost.
 */
export function stopCraftsOnMove(p: Player): Outgoing[] {
  if (!isCrafting(p)) {
    return [];
  }
  p.craft.timers = {};
  p.craft.at = null;
  p.keyLock = false;
  return [lock(p, false), tell(p, CRAFT_TEXT.interrupted)];
}

export interface CraftCtx {
  world: World;
  rng: Rng;
}

/** A craft's bound skill value, or undefined when the world binds none (the craft is off). */
const skillOf = (p: Player, b: CraftSkill): number | undefined => {
  const i = boundSkillIndex(b);
  return i === undefined ? undefined : (p.char.skills[i] ?? 0);
};

const tell = (p: Player, text: string): Outgoing => ({
  to: p.id,
  msg: { t: "chat", text, color: 0 },
});
const lock = (p: Player, on: boolean): Outgoing => ({ to: p.id, msg: { t: "lock", on } });

/** A craft trains its bound skill (the `craft` source), a line for each level gained. */
function gain(p: Player, kind: CraftKind, rng: Rng, out: Outgoing[], xp?: number): void {
  const i = boundSkillIndex(CRAFT_SKILL[kind]);
  if (i === undefined) {
    return;
  }
  const levels = train(fighterOf(p), i, "craft", rng, xp === undefined ? {} : { xp });
  out.push(...advancedLines(i, levels).map((l) => tell(p, l)));
}

/**
 * A unique container id. 1.6's client chose `#random(100000)`; SSO's server gives every built
 * container its own id instead. Monotonic from the clock, so ids stay unique across restarts.
 */
export function mintContainerId(world: World, now: number): number {
  world.lastContainerId = Math.max(world.lastContainerId + 1, Math.floor(now));
  return world.lastContainerId;
}

/** The station test: the faced tile holds an item with exactly that name, and you stand still. */
function facing(room: Room, p: Player, station: string): boolean {
  if (p.stepFrames > 0) {
    return false; // sprite 112 is between tiles: no pixel matches
  }
  const [dx, dy] = FACING_DELTA[p.facing];
  return room.map.ground.some(
    (g) => g.x === p.x + dx && g.y === p.y + dy && lingoEq(g.item, station),
  );
}

/**
 * Cook, Mix, Build or Smith on bag slot `slot`. The server takes the button from the item, as the
 * menu did, and checks it in the original order.
 */
export function craftIntent(room: Room, p: Player, slot: number, _ctx: CraftCtx): Outgoing[] {
  // One craft at a time: a running craft refuses another even if its key lock was cleared.
  if (p.deadLock > 0 || p.loading > 0 || isCrafting(p)) {
    return [];
  }
  const r = startCraft(
    {
      bag: p.char.bag,
      leftHand: p.char.equip.weapon,
      rightHand: p.char.equip.offHand,
      skill: (s) => skillOf(p, s),
      facing: (station) => facing(room, p, station),
      keyLock: p.keyLock,
      itemPause: p.itemPause,
      who: { level: p.char.vitals.level, skills: p.char.skills },
    },
    slot,
  );
  const out = r.lines.map((l) => tell(p, l));
  const s = r.started;
  if (!s) {
    return out;
  }
  // The same kind restarts its counter and overwrites its job.
  p.craft.timers[s.kind] = { counter: s.frames, job: s.job };
  p.craft.at = { x: p.x, y: p.y, facing: p.facing };
  // 1.6 locked the keys here (its client-side input lock). The start's pause between item actions only
  // waited for the server and is not kept.
  p.keyLock = true;
  out.push(lock(p, true));
  const sound = CRAFT_SOUND[s.kind];
  if (sound) {
    out.push({ to: p.id, msg: { t: "sound", name: sound, ch: 3 } });
  }
  return out;
}

/** A built Crate, Cabinet, Wind Cabinet or Cauldron gets a minted id as it enters the bag. */
function withId(ctx: CraftCtx, now: number) {
  return (name: string) =>
    ID_CONTAINERS.some((k) => lingoEq(name, k))
      ? `${name}#${mintContainerId(ctx.world, now)}`
      : name;
}

/**
 * A craft's completion: the keys are freed, the materials are taken and the result made (or the
 * failure line), then the skill handler rolls when something was made.
 */
function finish(p: Player, kind: CraftKind, job: CraftJob, ctx: CraftCtx, now: number) {
  const out: Outgoing[] = [];
  p.keyLock = false;
  out.push(lock(p, false));
  const skill = skillOf(p, CRAFT_SKILL[kind]) ?? 0;
  const before = holdingsOf(p.char);
  const r = finishCraft(p.char, job, skill, ctx.rng, withId(ctx, now));
  if (!r.reached) {
    return out;
  }
  // What went in and what came out, as the bag changed.
  logBagChange(ctx.world, p, "craft", before, holdingsOf(p.char), {
    details: { craft: kind, failed: r.added === null ? true : null },
  });
  // A failure uses up the materials even though nothing is added.
  p.invDirty = true;
  out.push(...r.lines.map((l) => tell(p, l)));
  if (r.gain) {
    gain(p, kind, ctx.rng, out, r.xp);
  }
  return out;
}

/**
 * The four counters at their place in the frame script, after the item-action pause: Smith (whose FX
 * roll comes before its completion test), Cook, Build, Mix. Each fires on the frame it reads 1,
 * then counts down. A map change (a warp, an exit) ends them (`cancelCrafts`); so does a death, a
 * frame after it, or being turned or moved off the spot (below).
 */
export function craftStep(room: Room, p: Player, ctx: CraftCtx, now: number): Outgoing[] {
  // The craft needs the crafter alive and standing at the station, as at its start.
  if (isCrafting(p) && !craftingInPlace(p)) {
    return stopCraftsOnMove(p);
  }
  const out: Outgoing[] = [];
  for (const kind of CRAFT_ORDER) {
    const t = p.craft.timers[kind];
    if (!t || t.counter <= 0) {
      continue;
    }
    if (kind === "Smith" && ctx.rng.random(SMITH_FX_CHANCE) === 1) {
      smithFx(room, p);
    }
    if (t.counter === 1) {
      out.push(...finish(p, kind, t.job, ctx, now));
    }
    t.counter -= 1;
    if (t.counter <= 0 && p.craft.timers[kind] === t) {
      delete p.craft.timers[kind];
    }
  }
  if (!isCrafting(p)) {
    p.craft.at = null;
  }
  return out;
}

/**
 * The smith animation: a cast of `BSmith` at sprite 112 ± 32 in the facing direction, to everyone
 * on the map, the smith included.
 */
function smithFx(room: Room, p: Player): void {
  const me = playerLoc(p);
  const [dx, dy] = FACING_DELTA[p.facing];
  const h = me.h + dx * 32;
  const v = me.v + dy * 32;
  queueCast(room, {
    owner: p.name,
    ownerId: p.id,
    name: "BSmith",
    casterH: h,
    casterV: v,
    h,
    v,
    power: 1,
  });
}
