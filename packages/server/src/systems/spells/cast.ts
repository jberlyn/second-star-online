/**
 * Casting: the `cast` intent runs 1.6's spell-cast routine in its original order on the server's
 * own state, then sends the cast message (fx.ts) and any summon.
 *
 * Also the other senders of cast messages: the Fire Staff and Firesword fireballs and arrows.
 */
import {
  boltForm,
  CAST_DELAY,
  CAST_TEXT,
  cannonballName,
  castEffect,
  crystalLine,
  crystalsFor,
  directional,
  fireballForm,
  fxForEffect,
  inCastBounds,
  invDelSlot,
  isHarmful,
  isInert,
  lingoContains,
  lingoDiv,
  lingoEq,
  lingoWord,
  MAP_HEIGHT,
  MAP_WIDTH,
  type Rng,
  rectsIntersect,
  skillIndex,
  spCost,
  spellPower,
  spriteRect,
  summonFor,
  tileHas,
  tileLoc,
} from "@secondstaronline/shared";

import { onArenaTile } from "../combat/melee.ts";
import { type MonsterSlot, monsterView } from "../monsters/slots.ts";
import { placeMonster } from "../monsters/spawn.ts";
import type { Outgoing, Player, Room } from "../world/world.ts";
import { queueCast } from "./fx.ts";
import { playerLoc, playerRect, type Rect } from "./geometry.ts";

export interface CastCtx {
  rng: Rng;
  /** Whether Portal has a destination whose map exists (`portalOpen`); absent: it has. */
  portalOpen?: () => boolean;
  /** Frames per player step (setting `stepFrames`). */
}

export interface CastResult {
  out: Outgoing[];
  /** SP or the inventory changed: send `vitals`/`inv` now. */
  changed: boolean;
  /** A summon took a roster slot: write the map's slots. */
  slotsChanged: boolean;
}

/** The portal marker sprite 5 (Internal #173, 47×68, reg 24, 17), at the mouse. */
const PORTAL_MARKER: [number, number, number, number] = [47, 68, 24, 17];

const tell = (p: Player, text: string): Outgoing => ({
  to: p.id,
  msg: { t: "chat", text, color: 0 },
});

/**
 * The cast for one click at stage (h, v). Every refusal comes before anything is spent: the action
 * delay, SP and crystals are taken only by a cast that goes ahead (a bug fixed: 1.6 set the delay
 * first and took the cost before Portal's and the summons' own tests).
 */
export function castIntent(
  room: Room,
  p: Player,
  spell: string,
  h: number,
  v: number,
  ctx: CastCtx,
): CastResult {
  const res: CastResult = { out: [], changed: false, slotsChanged: false };
  // A vehicle cannot cast: silent, and nothing is spent.
  if (p.vehicle) {
    return res;
  }
  // The spellbook field contains the selected spell: the server holds the list, and only a listed line
  // (or the empty selection) can be sent.
  if (spell !== "" && !p.spell.book.some((l) => lingoEq(l, spell))) {
    return res;
  }
  // The spellbook page and the armed cursor are the client's; the click must be on the playfield.
  if (!inCastBounds(h, v)) {
    return res;
  }
  const t = p.timers;
  if (t.actionDelay > 0) {
    return res;
  }
  // The map is loading or the player is dead.
  if (p.loading > 0 || p.deadLock > 0) {
    return res;
  }
  const safeMap = room.map.flags.canFight === "O" && !onArenaTile(room, p.x, p.y);
  const effect = castEffect(spell);
  // The harmful gate. Hold joins it on safe maps (a divergence: in 1.6 Hold was not harmful, so it
  // could pin a player in town).
  if (safeMap && (isHarmful(spell) || lingoEq(effect, "Hold"))) {
    res.out.push(tell(p, CAST_TEXT.harmful));
    return res;
  }
  if (spell === "") {
    return res;
  }
  if (isInert(spell)) {
    res.out.push(tell(p, CAST_TEXT.inert));
    return res;
  }
  const sp = spCost(spell, p.char.equip.body);
  if (sp === 0) {
    return res;
  }
  // A Portal with nowhere to send anyone is refused before anything is spent (a bug fixed: 1.6's
  // empty warp sent its users to the start point).
  if (lingoEq(effect, "Portal") && ctx.portalOpen && !ctx.portalOpen()) {
    res.out.push(tell(p, CAST_TEXT.portalClosed));
    return res;
  }
  const vit = p.char.vitals;
  if (sp > vit.sp) {
    res.out.push(tell(p, CAST_TEXT.sp(sp)));
    return res;
  }
  // The last "<Colour> Cry" line must hold enough crystals. 1.6 checked the client's own count and
  // sent the removal afterwards, which allowed free casts; SSO checks and removes in the same step.
  const need = crystalsFor(spell);
  const line = need ? crystalLine(p.char.bag, need.colour) : -1;
  if (need) {
    const have = line >= 0 ? (p.char.bag[line]?.qty ?? 0) : 0;
    if (have < need.count) {
      res.out.push(tell(p, CAST_TEXT.crystals(spell)));
      return res;
    }
  }
  // Portal: sprite 5 at the mouse must touch no other player's sprite 112-157.
  if (lingoEq(effect, "Portal")) {
    const marker = spriteRect(PORTAL_MARKER, h, v);
    if (room.players.some((o) => o !== p && rectsIntersect(marker, playerRect(o)))) {
      res.out.push(tell(p, CAST_TEXT.portal));
      return res;
    }
  }
  // The summon tile: `(mouse − sprite110.topLeft)/32 + 1`, sprite 110 at (30, 31).
  const tx = lingoDiv(h - 30, 32) + 1;
  const ty = lingoDiv(v - 31, 32) + 1;
  const plan = planSummon(room, p, effect, spell, tx, ty);
  if (plan.refuse) {
    res.out.push(tell(p, CAST_TEXT.summon));
    return res;
  }

  t.actionDelay = CAST_DELAY;
  if (need) {
    invDelSlot(p.char.bag, line, need.count);
    p.invDirty = true;
  }
  vit.sp -= sp;
  p.vitalsDirty = true;
  res.changed = true;

  const power = spellPower(effect, {
    skills: p.char.skills,
    equip: p.char.equip,
    faction: p.char.faction,
  });
  const me = playerLoc(p);
  let eff = effect;
  if (lingoEq(eff, "Fireball")) {
    eff = directional("Fireball", me.h, me.v, h, v);
  }
  if (lingoEq(eff, "Wind Wave")) {
    eff = directional("Wind wave", me.h, me.v, h, v);
  }
  if (lingoEq(eff, "Bolt")) {
    eff = boltForm(p.facing);
  }
  queueCast(room, {
    owner: p.name,
    ownerId: p.id,
    name: fxForEffect(spell, eff),
    casterH: me.h,
    casterV: me.v,
    h,
    v,
    power,
  });
  if (plan.place) {
    const summoned = placeSummon(room, plan.place.monster, plan.place.at, ctx.rng);
    res.out.push(...summoned.out);
    res.slotsChanged = summoned.changed;
  }
  return res;
}

// ---- summons -------------------------------------------------------

/**
 * Whether a monster may not stand on tile (x, y): the walk grid's own entry for that tile (a bug
 * fixed: 1.6 searched the blocked list for "x<X>y<Y>" with no closing `*`, so x1y1 read as blocked
 * when only x1y10, x1y11 or x1y12 was).
 */
export function npcBlocked(grid: boolean[][], x: number, y: number): boolean {
  return grid[y - 1]?.[x - 1] === false;
}

/** The grave tiles of layer 2. */
function isGrave(room: Room, x: number, y: number): boolean {
  const row = room.map.layers[1][y - 1];
  return row !== undefined && tileHas(lingoWord(row, x), "grave");
}

/** What a summon spell will place, decided before anything is spent. */
interface SummonPlan {
  /** The summon cannot go ahead: "You cannot summon here!" and nothing spent. */
  refuse: boolean;
  /** The monster and tile, for a summon spell that goes ahead. */
  place: { monster: string; at: { x: number; y: number } } | null;
}

/**
 * Web, Illusionary Spikes, Summon Creature, Holy Shield and Raise Dead. A summon is refused, and
 * costs nothing, on a tile off the map or one a monster cannot stand on, when all four monster
 * slots are taken, and (all but Summon Creature, whose Pig or Cow harms no one) where fighting is
 * off. Raise Dead needs a grave on the clicked tile or the one above it; the Zombie rises on the
 * tile below the grave either way, as 1.6 meant.
 */
function planSummon(
  room: Room,
  p: Player,
  effect: string,
  spell: string,
  x: number,
  y: number,
): SummonPlan {
  const is = (n: string) => lingoEq(effect, n);
  if (
    !is("Web") &&
    !is("Illusionary Spikes") &&
    !is("Summon Creature") &&
    !is("Holy Shield") &&
    !is("Raise Dead")
  ) {
    return { refuse: false, place: null };
  }
  const no: SummonPlan = { refuse: true, place: null };
  if (!is("Summon Creature") && room.map.flags.canFight === "O") {
    return no;
  }
  let at = { x, y };
  if (is("Raise Dead")) {
    if (isGrave(room, x, y)) {
      at = { x, y: y + 1 };
    } else if (!isGrave(room, x, y - 1)) {
      return no;
    }
  }
  if (
    at.x < 1 ||
    at.x > MAP_WIDTH ||
    at.y < 1 ||
    at.y > MAP_HEIGHT ||
    npcBlocked(room.map.walk, at.x, at.y) ||
    room.map.slots.every((s: MonsterSlot) => s.live !== null)
  ) {
    return no;
  }
  const spec = summonFor(spell);
  if (!spec) {
    return { refuse: false, place: null };
  }
  const monster =
    spec.skilled && (p.char.skills[skillIndex(spec.skilled.skill)] ?? 0) > spec.skilled.above
      ? spec.skilled.monster
      : spec.monster;
  return { refuse: false, place: { monster, at } };
}

/**
 * The summon tail shared by every summoner: off the 17×12 map fails silently, the first free slot
 * of 1-4 takes the monster, or the summon fails silently, and the room sees `mspawn`.
 */
function placeSummon(
  room: Room,
  monster: string,
  at: { x: number; y: number },
  rng: Rng,
): { out: Outgoing[]; changed: boolean } {
  const none = { out: [], changed: false };
  if (at.x < 1 || at.x > MAP_WIDTH || at.y < 1 || at.y > MAP_HEIGHT) {
    return none;
  }
  const slot = room.map.slots.find((s: MonsterSlot) => !s.live);
  if (!slot) {
    return none;
  }
  slot.live = placeMonster(monster, at.x, at.y, rng);
  slot.dirty = true;
  const out: Outgoing[] = room.players.map((o) => ({
    to: o.id,
    msg: { t: "delta", events: [{ e: "mspawn", monster: monsterView(slot) }] },
  }));
  return { out, changed: true };
}

/**
 * The tail of a dropped Pig: a tile a monster cannot stand on → silent exit; else the first free
 * slot takes a live Pig. No Sorcery test and no no-fight test.
 */
export function summonPig(
  room: Room,
  x: number,
  y: number,
  rng: Rng,
): { out: Outgoing[]; changed: boolean } {
  if (npcBlocked(room.map.walk, x, y)) {
    return { out: [], changed: false };
  }
  return placeSummon(room, "Pig", { x, y }, rng);
}

// ---- the other senders ----------------------------------------------------------------

/**
 * The Fire Staff's and Firesword's free fireballs in the attack routine, after the bar reset and
 * before the cooldowns. Their cast message carries the mouse, which a fireball never reads (it
 * starts beside the caster and flies by facing), so none is sent here. They train no skill (a bug
 * fixed: 1.6's skill gain ran on any name containing "Fireball", so a free swing trained Magery and
 * Fire).
 */
export function swingFireballs(room: Room, p: Player, ctx: CastCtx): void {
  const weapon = p.char.equip.weapon;
  const staff = p.char.skills[skillIndex("StaffFighting")] ?? 0;
  const me = playerLoc(p);
  const send = (power: number) =>
    queueCast(room, {
      owner: p.name,
      ownerId: p.id,
      name: fireballForm(p.facing),
      casterH: me.h,
      casterV: me.v,
      h: me.h,
      v: me.v,
      power,
      train: false,
    });
  if (lingoEq(weapon, "Fire Staff")) {
    let power = 1 + ctx.rng.random(3);
    if (staff > 20) {
      power += 1;
    }
    if (staff > 40) {
      power += 2;
    }
    if (staff > 80) {
      power += 3;
    }
    if (staff > 99) {
      power += 5;
    }
    const always = staff === 100 ? 2 : 0;
    if (ctx.rng.random(power) + always > 2) {
      send(power);
    }
  }
  if (lingoContains(weapon, "sword") && p.spell.fireSword > 0) {
    send(4 + ctx.rng.random(3));
  }
}

/**
 * An arrow shot (1.6's attack routine): each client casts `<Colour> Arrows<dir>` itself, owned by
 * the shooter, from the shooter's tile `(x·32+14, y·32−3)` with caster loc 0:0 (so no cast skill gain),
 * power the shot's attack power.
 */
export function shootArrow(room: Room, p: Player, colour: string, power: number): void {
  const dir = { E: "R", W: "L", N: "U", S: "D" }[p.facing];
  queueCast(room, {
    owner: p.name,
    ownerId: p.id,
    name: `${colour} Arrows${dir}`,
    casterH: 0,
    casterV: 0,
    h: p.x * 32 + 14,
    v: p.y * 32 - 3,
    power,
  });
}

export type { Rect };

/**
 * A Battleship's shot (an SSO addition): `CannonballShot<dir>`, owned by the rider, placed 48 px out
 * from the rider's loc along the facing. It trains no skill.
 */
export function fireCannonball(room: Room, p: Player): void {
  const at = tileLoc(p.x, p.y);
  queueCast(room, {
    owner: p.name,
    ownerId: p.id,
    name: cannonballName(p.facing),
    casterH: at.h,
    casterV: at.v,
    h: at.h,
    v: at.v,
    power: 0,
    train: false,
  });
}
