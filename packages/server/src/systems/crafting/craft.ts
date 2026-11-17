/**
 * The crafting stations on the server: the Cook, Mix, Build and Smith buttons, their per-character
 * timers in the frame script, and their completions, which take the materials and make the result.
 * The rules are in shared/rules/crafting/craft.ts; this applies them to the player.
 */
import {
  CRAFT_ORDER,
  CRAFT_SOUND,
  CRAFT_TEXT,
  type CraftJob,
  type CraftKind,
  FACING_DELTA,
  finishCraft,
  ID_CONTAINERS,
  lingoEq,
  type Rng,
  rollSkillGain,
  SMITH_FX_CHANCE,
  skillGainRule,
  skillIndex,
  startCraft,
} from "@secondstaronline/shared";

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
}

export function newCraftState(): CraftState {
  return { timers: {} };
}

/** True while any craft is running. */
export function isCrafting(p: Player): boolean {
  return Object.keys(p.craft.timers).length > 0;
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
  p.keyLock = false;
  return [lock(p, false), tell(p, CRAFT_TEXT.interrupted)];
}

export interface CraftCtx {
  world: World;
  rng: Rng;
}

const skillOf = (p: Player, skill: string) => p.char.skills[skillIndex(skill)] ?? 0;

const SKILL: Record<CraftKind, string> = {
  Smith: "Blacksmithing",
  Cook: "Cooking",
  Mix: "Alchemy",
  Build: "Carpentry",
};

const tell = (p: Player, text: string): Outgoing => ({
  to: p.id,
  msg: { t: "chat", text, color: 0 },
});
const lock = (p: Player, on: boolean): Outgoing => ({ to: p.id, msg: { t: "lock", on } });

/** A skill handler's roll and, on a hit, the point and its line. */
function gain(p: Player, kind: CraftKind, rng: Rng, out: Outgoing[]): void {
  const skill = SKILL[kind];
  const v = skillOf(p, skill);
  if (rollSkillGain(skill, v, rng)) {
    p.char.skills[skillIndex(skill)] = v + 1;
    out.push(tell(p, skillGainRule(skill)?.text ?? ""));
  }
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
  const skill = skillOf(p, SKILL[kind]);
  const r = finishCraft(p.char, job, skill, ctx.rng, withId(ctx, now));
  if (!r.reached) {
    return out;
  }
  // A failure uses up the materials even though nothing is added.
  p.invDirty = true;
  out.push(...r.lines.map((l) => tell(p, l)));
  if (r.gain) {
    gain(p, kind, ctx.rng, out);
  }
  return out;
}

/**
 * The four counters at their place in the frame script, after the item-action pause: Smith (whose FX
 * roll comes before its completion test), Cook, Build, Mix. Each fires on the frame it reads 1,
 * then counts down. A map change (a warp, an exit, a death's respawn) ends them (`cancelCrafts`).
 */
export function craftStep(room: Room, p: Player, ctx: CraftCtx, now: number): Outgoing[] {
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
