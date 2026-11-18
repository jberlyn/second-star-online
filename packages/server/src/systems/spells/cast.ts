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
  castEffect,
  crystalLine,
  crystalsFor,
  directional,
  fireballForm,
  fxForEffect,
  invDelSlot,
  isHarmful,
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
} from "@secondstaronline/shared";

import { onArenaTile } from "../combat/melee.ts";
import { type MonsterSlot, monsterView } from "../monsters/slots.ts";
import { placeMonster } from "../monsters/spawn.ts";
import type { Outgoing, Player, Room } from "../world/world.ts";
import { queueCast } from "./fx.ts";
import { playerLoc, playerRect, type Rect } from "./geometry.ts";

export interface CastCtx {
  rng: Rng;
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

/** The cast for one click at stage (h, v). */
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
  // The spellbook page, the armed cursor and the mouse bounds. The page and the cursor are the
  // client's; the bounds are checked here.
  if (!(h > 8 && v > 5 && h < 580 && v < 420)) {
    return res;
  }
  const t = p.timers;
  if (t.actionDelay > 0) {
    return res;
  }
  // Set before every later check, so a failed cast still costs the delay (a kept 1.6 bug).
  t.actionDelay = CAST_DELAY;
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
  const sp = spCost(spell, p.char.equip.body);
  if (sp === 0) {
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
  if (need) {
    const line = crystalLine(p.char.bag, need.colour);
    const have = line >= 0 ? (p.char.bag[line]?.qty ?? 0) : 0;
    if (have < need.count) {
      res.out.push(tell(p, CAST_TEXT.crystals(spell)));
      return res;
    }
    invDelSlot(p.char.bag, line, need.count);
    p.invDirty = true;
  }
  vit.sp -= sp;
  p.vitalsDirty = true;
  res.changed = true;

  const me = playerLoc(p);
  let eff = effect;
  if (lingoEq(eff, "Fireball")) {
    eff = directional("Fireball", me.h, me.v, h, v);
  }
  if (lingoEq(eff, "Wind Wave")) {
    eff = directional("Wind wave", me.h, me.v, h, v);
  }
  const power = spellPower(eff, {
    skills: p.char.skills,
    equip: p.char.equip,
    faction: p.char.faction,
  });
  if (lingoEq(eff, "Bolt")) {
    eff = boltForm(p.facing);
  }
  // Portal: sprite 5 at the mouse must touch no player sprite 112-157, yours included. SP and
  // crystals are already spent when it fails (a kept 1.6 bug).
  if (lingoEq(eff, "Portal")) {
    const marker = spriteRect(PORTAL_MARKER, h, v);
    if (room.players.some((o) => rectsIntersect(marker, playerRect(o)))) {
      res.out.push(tell(p, CAST_TEXT.portal));
      return res;
    }
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
  // The summon tile: `(mouse − sprite110.topLeft)/32 + 1`, sprite 110 at (30, 31).
  const tx = lingoDiv(h - 30, 32) + 1;
  const ty = lingoDiv(v - 31, 32) + 1;
  const summoned = summon(room, p, eff, spell, tx, ty, ctx.rng);
  res.out.push(...summoned.out);
  res.slotsChanged = summoned.changed;
  return res;
}

// ---- summons -------------------------------------------------------

/** The on-foot walk grid, matched exactly: the tile's "x<X>y<Y>*" entry is in the blocked list. */
function walkBlocked(room: Room, x: number, y: number): boolean {
  return room.map.walk[y - 1]?.[x - 1] === false;
}

/**
 * The summons' blocked-tile test looks for "x<X>y<Y>" with no `*`, so "x1y1" also matches the
 * entries "x1y10*", "x1y11*" and "x1y12*" (a kept 1.6 bug: Summon Creature's blocked test matches
 * part of a tile name).
 */
export function npcBlockedSubstring(room: Room, x: number, y: number): boolean {
  return blockedSubstring(room.map.walk, x, y);
}

/**
 * The same substring test over any walk grid: the on-foot list (the Pig drop, which aboard an
 * Airship reads the airship's list) or the summons' list.
 */
export function blockedSubstring(grid: boolean[][], x: number, y: number): boolean {
  const want = `x${x}y${y}`;
  for (let by = 1; by <= MAP_HEIGHT; by += 1) {
    for (let bx = 1; bx <= MAP_WIDTH; bx += 1) {
      if (grid[by - 1]?.[bx - 1] === false && `x${bx}y${by}*`.includes(want)) {
        return true;
      }
    }
  }
  return false;
}

/** The grave tiles of layer 2. */
function isGrave(room: Room, x: number, y: number): boolean {
  const row = room.map.layers[1][y - 1];
  return row !== undefined && tileHas(lingoWord(row, x), "grave");
}

/**
 * Web, Illusionary Spikes, Summon Creature, Holy Shield and Raise Dead: the monster takes the first
 * slot of 1-4 without a live monster, or the summon fails silently while its cost is still paid (a
 * kept 1.6 bug). A tile off the 17×12 map fails silently too.
 */
function summon(
  room: Room,
  p: Player,
  eff: string,
  spell: string,
  x: number,
  y: number,
  rng: Rng,
): { out: Outgoing[]; changed: boolean } {
  const none = { out: [], changed: false };
  const noFight = room.map.flags.canFight === "O";
  let at = { x, y };
  let isSummon = false;
  if (lingoEq(eff, "Web") || lingoEq(eff, "Illusionary Spikes")) {
    if (noFight) {
      return { out: [tell(p, CAST_TEXT.summon)], changed: false };
    }
    if (walkBlocked(room, x, y)) {
      return none;
    }
    isSummon = true;
  } else if (lingoEq(eff, "Summon Creature")) {
    if (npcBlockedSubstring(room, x, y)) {
      return none;
    }
    isSummon = true;
  } else if (lingoEq(eff, "Holy Shield")) {
    if (npcBlockedSubstring(room, x, y)) {
      return none;
    }
    if (noFight) {
      return { out: [tell(p, CAST_TEXT.summon)], changed: false };
    }
    isSummon = true;
  } else if (lingoEq(eff, "Raise Dead")) {
    // 1.6 sets the monster's drop-down and stay-here flags only on a grave; unset they read 0. The
    // Zombie rises one tile below a grave: the clicked tile's, or the one above the click.
    if (isGrave(room, x, y)) {
      at = { x, y: y + 1 };
    } else if (isGrave(room, x, y - 1)) {
      at = { x, y };
    } else {
      return none;
    }
    isSummon = true;
  }
  const spec = isSummon ? summonFor(spell) : null;
  if (!spec) {
    return none;
  }
  const monster =
    spec.skilled && (p.char.skills[skillIndex(spec.skilled.skill)] ?? 0) > spec.skilled.above
      ? spec.skilled.monster
      : spec.monster;
  return placeSummon(room, monster, at, rng);
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
 * The tail of a dropped Pig: the substring test on the on-foot list (no `*`) → silent exit; else
 * the first free slot takes a live Pig. No Sorcery test and no no-fight test. The Pig has already
 * left the bag.
 */
export function summonPig(
  room: Room,
  x: number,
  y: number,
  rng: Rng,
): { out: Outgoing[]; changed: boolean } {
  if (npcBlockedSubstring(room, x, y)) {
    return { out: [], changed: false };
  }
  return placeSummon(room, "Pig", { x, y }, rng);
}

// ---- the other senders ----------------------------------------------------------------

/**
 * The Fire Staff's and Firesword's free fireballs in the attack routine, after the bar reset and
 * before the cooldowns. Their cast message carries the mouse, which a fireball never reads (it
 * starts beside the caster and flies by facing), so none is sent here.
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
