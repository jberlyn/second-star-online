/**
 * The crafting stations on the server: the Cook, Mix, Build and Smith buttons, their per-character
 * timers in the frame script, and the completions with the server's own side (`snx38`, `itremovv`).
 * The rules are in shared/rules/crafting/craft.ts; this applies them to the player.
 */
import {
  buildDone,
  CRAFT_ORDER,
  CRAFT_SOUND,
  type CraftDone,
  type CraftJob,
  type CraftKind,
  cookDone,
  FACING_DELTA,
  ID_CONTAINERS,
  invAdd,
  lingoEq,
  mixDone,
  type Rng,
  rollSkillGain,
  SMITH_FX_CHANCE,
  skillGainRule,
  skillIndex,
  smithDone,
  snx38,
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
  /** The last Cook or Mix action, shared by both. */
  lact: string | null;
  /** The last food cooked: read by a Raw Meat completion. */
  lastFood: string | null;
  /** The last potion mixed: read by a sandwich brew. */
  lastPotion: string | null;
}

export function newCraftState(): CraftState {
  return { timers: {}, lact: null, lastFood: null, lastPotion: null };
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
export function craftIntent(room: Room, p: Player, slot: number, ctx: CraftCtx): Outgoing[] {
  if (p.deadLock > 0 || p.loading > 0) {
    return [];
  }
  const c = p.craft;
  const r = startCraft(
    {
      bag: p.char.bag,
      leftHand: p.char.equip.weapon,
      rightHand: p.char.equip.offHand,
      skill: (s) => skillOf(p, s),
      facing: (station) => facing(room, p, station),
      keyLock: p.keyLock,
      itemPause: p.itemPause,
      lastFood: c.lastFood,
      lastPotion: c.lastPotion,
    },
    slot,
    ctx.rng,
  );
  const out = r.lines.map((l) => tell(p, l));
  const s = r.started;
  if (!s) {
    return out;
  }
  // The same kind restarts its counter and overwrites its job.
  c.timers[s.kind] = { counter: s.frames, job: s.job };
  if (s.lact !== undefined) {
    c.lact = s.lact;
  }
  if (s.lastFood !== undefined) {
    c.lastFood = s.lastFood;
  }
  if (s.lastPotion !== undefined) {
    c.lastPotion = s.lastPotion;
  }
  if (s.bagChanged) {
    p.invDirty = true;
  }
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

/** The server's `itremovv`: `InvAdd` of one; a full bag adds nothing, silently. */
function itremovv(p: Player, item: string, ctx: CraftCtx, now: number): void {
  let name = item;
  if (ID_CONTAINERS.some((k) => lingoEq(name, k))) {
    name = `${name}#${mintContainerId(ctx.world, now)}`;
  }
  const added = invAdd(p.char, name, 1, ctx.rng);
  if (added.kind !== "full") {
    p.invDirty = true;
  }
}

/** A completion's client side, then what the server does with what it sent. */
function complete(p: Player, kind: CraftKind, d: CraftDone, ctx: CraftCtx, now: number) {
  const out: Outgoing[] = d.lines.map((l) => tell(p, l));
  if (d.unlock) {
    p.keyLock = false;
    out.push(lock(p, false));
  }
  const send = d.send;
  if (send?.kind === "itremovv") {
    itremovv(p, send.item, ctx, now);
  }
  if (send?.kind === "snx38") {
    // The masterwork reads the server's skill, not the client's.
    const r = snx38(p.char, send.item, send.chunk, send.which, skillOf(p, SKILL[kind]), ctx.rng);
    if (r.reached) {
      if (r.added) {
        p.invDirty = true;
      }
      // `InvAdd`, then `x391100`/`x9371100` (SmithImp, CookImp), then the line.
      gain(p, kind, ctx.rng, out);
      out.push(tell(p, r.line));
    }
  }
  if (d.imp) {
    gain(p, kind, ctx.rng, out);
  }
  return out;
}

function finish(p: Player, kind: CraftKind, job: CraftJob, ctx: CraftCtx, now: number) {
  const c = p.craft;
  const skill = skillOf(p, SKILL[kind]);
  switch (job.kind) {
    case "Smith":
      return complete(p, kind, smithDone(job.item, job.chunk, skill), ctx, now);
    case "Cook":
      return complete(p, kind, cookDone(job.raw, c.lact, c.lastFood, skill, ctx.rng), ctx, now);
    case "Mix":
      return complete(p, kind, mixDone(c.lact, c.lastPotion, skill, ctx.rng), ctx, now);
    case "Build":
      return complete(p, kind, buildDone(skill, ctx.rng), ctx, now);
  }
}

/**
 * The four counters at their place in the frame script, after the item-action pause: Smith (whose FX
 * roll comes before its completion test), Cook, Build, Mix. Each fires on the frame it reads 1,
 * then counts down. Nothing cancels a craft: walking, map changes and death leave it running, as
 * in 1.6.
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
