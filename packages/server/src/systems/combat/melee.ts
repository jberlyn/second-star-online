/**
 * The player's melee swing.
 *
 * - The key poll: a held key swings when the player may attack, on a fight map or from a `6P` tile
 *   of a no-fight map (a bug fixed: 1.6 skipped that check on an arena tile, so it swung every 14
 *   frames). Anywhere else on a no-fight map, "You cannot fight here!"
 *   once per press (a bug fixed: 1.6 said it every frame). Hold stops the swing as it stops a step
 *   (a bug fixed: 1.6 polled the key before the Hold gate).
 * - The swing itself, the hit test on monsters and the monster hit.
 */
import { itemRulesData, monstersData } from "@secondstaronline/data";
import {
  ATTACK_ANIM_FRAMES,
  ATTACK_LATCH_TICKS,
  advancedText,
  attackPower,
  bowRefusal,
  CANNON_RELOAD_FRAMES,
  CANNON_TEXT,
  type CrystalColour,
  can,
  cannonballSlot,
  checkLevelUp,
  crystalSlotIn,
  damagedForm,
  FACING_DELTA,
  FLICKER_FRAMES,
  firstMatch,
  invDelSlot,
  isArenaTile,
  LEVEL_UP_TEXT,
  lingoContains,
  meleeDamageVsMonster,
  meleeKillXp,
  meleeReaches,
  monsterDrawnTile,
  pvpHit,
  type Rng,
  rollBlockGain,
  rollKillSkillGain,
  rollLoot,
  rollParryGain,
  rollWeaponBreak,
  type SwingSound,
  shattersText,
  skillIndex,
  startSwing,
  swingBlocked,
  xpGained,
} from "@secondstaronline/shared";

import { isCrafting } from "../crafting/craft.ts";
import { type GatherCtx, type GatherEvents, preSwing, toolSwing } from "../crafting/gather.ts";
import { addGround, ItemOut } from "../inventory/items.ts";
import { DODGE_COLOR, fighterOf, HIT_COLOR } from "../monsters/attack.ts";
import { hasFlag, npcFileNamed } from "../monsters/npcfiles.ts";
import { defenseOf, isFootprint, type MonsterSlot, species } from "../monsters/slots.ts";
import { fireCannonball, shootArrow, swingFireballs } from "../spells/cast.ts";
import { onHolyShield } from "../spells/geometry.ts";
import { type Outgoing, type Player, type Room, statsOf, type World } from "../world/world.ts";

// Shared so the client can predict the same attack lock.
export { ATTACK_ANIM_FRAMES, ATTACK_LATCH_TICKS } from "@secondstaronline/shared";

/** Records an `attack{held}` change. A press starts the latch; a new press may refuse again. */
export function setAttackHeld(p: Player, held: boolean): void {
  if (held && !p.attackHeld) {
    p.attackPress = 0;
    p.cannonArmed = true;
  }
  if (held !== p.attackHeld) {
    p.attackRefused = null;
  }
  p.attackHeld = held;
}

/** Standing on a `6P` tile of layer 1. */
export function onArenaTile(room: Room, x: number, y: number): boolean {
  return isArenaTile(room.map.layers[0], x, y);
}

export interface SwingEvents {
  /** The swing itself (animation and sound for everyone). */
  swing: {
    atDelay: number;
    actionDelay: number;
    sound: SwingSound;
  } | null;
  /** Melee hits on monsters, in slot order. */
  hits: { slot: MonsterSlot; dmg: number; kill: boolean }[];
  /** Chat lines for the swinger (crystals, skill gains, level-up). */
  lines: string[];
  /** A line for everyone online (the Overlord kill). */
  broadcast: string | null;
  /** "You cannot fight here!" this tick (once per press). */
  cannotFight: boolean;
  /** PvP outcomes: the victim's floatie and their own chat lines. */
  pvp: { victim: Player; text: string; color: number; splat: boolean; lines: string[] }[];
  /** Ground-item events and other players' messages (loot hand-off). */
  out: Outgoing[];
}

export interface MeleeCtx {
  rng: Rng;
  /** Wall-clock ms, for loot decay. */
  now?: number;
  /** Minutes before monster loot decays (setting `lootDecay`, in minutes). */
  lootDecayMinutes?: number;
  /** Where loot is recorded; without it (unit tests) kills drop nothing. */
  world?: World;
  /** Frames per player step (setting `stepFrames`): where a fireball or arrow starts. */
  /** A Lightning Assassin's game is running (`ltass`): one landed hit kills. */
  lightning?: boolean;
}

/** One player's attack poll and, when it fires, the swing. */
export function pollAttack(room: Room, p: Player, ctx: MeleeCtx): SwingEvents {
  const ev: SwingEvents = {
    swing: null,
    hits: [],
    lines: [],
    broadcast: null,
    cannotFight: false,
    pvp: [],
    out: [],
  };
  const press = p.attackPress;
  if (press !== null) {
    p.attackPress = press + 1 > ATTACK_LATCH_TICKS ? null : press + 1;
  }
  // The attack key is polled only while 1.6's client-side input lock is off and no craft runs.
  if (p.deadLock > 0 || p.loading > 0 || p.keyLock || isCrafting(p)) {
    return ev;
  }
  const held = p.attackHeld || press !== null;
  if (!held) {
    return ev;
  }
  if (p.spell.hold > 0) {
    return ev;
  }
  if (p.vehicle === "Battleship") {
    pollCannon(room, p, ev);
    return ev;
  }
  if (room.map.flags.canFight === "O" && !onArenaTile(room, p.x, p.y)) {
    // The press is answered: a tap released before the next tick must not be refused again.
    p.attackPress = null;
    ev.cannotFight = refuseOnce(p, CANNOT_FIGHT);
    return ev;
  }
  if (p.timers.canAttack) {
    workAttack(room, p, ctx, ev);
  }
  return ev;
}

/**
 * The Battleship's cannon (an SSO addition): one shot a press, forward along the facing, when
 * loaded and with a `Cannonball` in the bag. A rider is never in an arena, so on a no-fight map it
 * cannot fire even over arena tiles.
 */
function pollCannon(room: Room, p: Player, ev: SwingEvents): void {
  if (room.map.flags.canFight === "O") {
    p.attackPress = null;
    ev.cannotFight = refuseOnce(p, CANNOT_FIGHT);
    return;
  }
  if (!p.cannonArmed || p.cannonReload > 0) {
    return;
  }
  const slot = cannonballSlot(p.char.bag);
  if (slot < 0) {
    p.attackPress = null;
    if (refuseOnce(p, CANNON_TEXT.noAmmo)) {
      ev.lines.push(CANNON_TEXT.noAmmo);
    }
    return;
  }
  invDelSlot(p.char.bag, slot, 1);
  p.invDirty = true;
  p.attackPress = null;
  p.cannonArmed = false;
  p.cannonReload = CANNON_RELOAD_FRAMES;
  fireCannonball(room, p);
}

/** The no-fight map's refusal, as `attackRefused` records it. */
const CANNOT_FIGHT = "cannotFight";

/** True the first time `line` is refused during this hold of the attack key. */
function refuseOnce(p: Player, line: string): boolean {
  if (p.attackRefused === line) {
    return false;
  }
  p.attackRefused = line;
  return true;
}

/**
 * The crystal a bow shot spends: the last bag line containing "<Colour> Cry", as a 0-based slot, or
 * -1.
 */
export function crystalSlot(p: Player, colour: CrystalColour): number {
  return crystalSlotIn(p.char.bag, colour);
}

/** The swing and the hits it makes. */
function workAttack(room: Room, p: Player, ctx: MeleeCtx, ev: SwingEvents): void {
  const t = p.timers;
  // An attack delay above 0 exits; then aboard an Airship the delay becomes 15, no swing, silent.
  if (t.atDelay <= 0 && p.vehicle) {
    t.atDelay = 15;
    return;
  }
  if (swingBlocked(t)) {
    return;
  }
  // A bow with no arrows, or no crystal for them, is refused before the swing starts.
  const refusal = bowRefusal(p.char.equip, p.char.bag);
  if (refusal) {
    p.attackPress = null;
    if (refuseOnce(p, refusal)) {
      ev.lines.push(refusal);
    }
    return;
  }
  startSwing(t, p.char.equip, p.char.skills);
  // The Fire Staff's and Firesword's fireballs came between 1.6's bar reset and the cooldowns;
  // neither of those draws, so after `startSwing` keeps the original draw order.
  swingFireballs(room, p, { rng: ctx.rng });
  // The Watering Bucket's sprinkle and the Fishing Pole's cast come next, before the attack power:
  // fishing sets the attack delay to 20.
  const gctx = gatherCtx(ctx);
  const gev: GatherEvents = { sound: undefined, lines: ev.lines, out: ev.out };
  if (gctx) {
    const atDelay = preSwing(room, p, gctx, gev);
    if (atDelay !== null) {
      t.atDelay = atDelay;
    }
  }
  const f = fighterOf(p);
  const ap = attackPower(f, ctx.rng, (c) => crystalSlot(p, c) >= 0);
  p.attackPress = null;
  if (ap.crystal) {
    // One crystal is removed before the shot.
    invDelSlot(p.char.bag, crystalSlot(p, ap.crystal), 1);
    p.invDirty = true;
  }
  // 1.6 added its power bar's +0/+3/+5/+7 here; SSO has no power bar.
  const power = ap.power;
  t.canAttack = false;
  t.atkAnim = ATTACK_ANIM_FRAMES;
  const weapon = f.equip.weapon;
  ev.swing = {
    atDelay: t.atDelay,
    actionDelay: t.actionDelay,
    sound: swingSound(weapon),
  };
  // Shooting arrows: a bow with one of the six `<Colour> Arrows` and a crystal of that colour, the
  // same test `attackPower` makes (one without the crystal has already returned). Any other
  // off-hand melees. An arrow's monster damage is never sent: it flies as a spell FX
  // (spells/cast.ts).
  const arrowing = ap.crystal !== null;
  // The tool's own tile (the tool blocks of 1.6's swing handler) comes before the monster hits; the
  // swing stays an ordinary attack.
  if (gctx) {
    toolSwing(room, p, gctx, gev);
    if (gev.sound !== undefined) {
      ev.swing.sound = gev.sound;
    }
  }
  // The Attack message carries a colour letter only for an arrow shot; peers treat any other swing
  // as melee.
  if (ap.crystal !== null) {
    shootArrow(room, p, ap.crystal, power);
  }
  for (const o of room.players) {
    o.lastWeaponSeen = weapon; // every client sees it, the attacker's own too
  }
  for (const slot of room.map.slots) {
    const m = slot.live;
    if (!m) {
      continue;
    }
    const _sp = species(m.name);
    if (!meleeReaches(p, { x: m.x, y: m.y, footprint: isFootprint(m.name) })) {
      continue;
    }
    const dmg = meleeDamageVsMonster(
      power,
      { name: m.name, defense: defenseOf(m.name) },
      weapon,
      ctx.rng,
    );
    if (arrowing) {
      continue;
    }
    smash(room, p, slot, dmg, ctx, ev);
  }
  if (arrowing) {
    gainOnShot(p, ctx, ev);
  }
  // A melee swing hurts players too, even when it also hit a monster (a bug fixed: 1.6's Attack
  // message then carried the monster damage, which other players read as an arrow shot).
  if (!arrowing) {
    pvpSwing(room, p, power, weapon, ctx, ev);
  }
}

/** The gathering context, when the swing has a world to drop into (not in unit tests). */
function gatherCtx(ctx: MeleeCtx): GatherCtx | null {
  if (!ctx.world) {
    return null;
  }
  return {
    world: ctx.world,
    rng: ctx.rng,
    now: ctx.now ?? 0,
    lootDecayMinutes: ctx.lootDecayMinutes ?? 30,
  };
}

/** Archery (and Martial Arts with a crossbow) on every arrow shot. */
function gainOnShot(p: Player, ctx: MeleeCtx, ev: SwingEvents): void {
  const gain = (skill: string) => {
    const i = skillIndex(skill);
    const v = p.char.skills[i] ?? 0;
    if (v > 0 && v < 100 && ctx.rng.random(v) === 1) {
      p.char.skills[i] = v + 1;
      ev.lines.push(advancedText(skill));
    }
  };
  gain("Archery");
  if (lingoContains(p.char.equip.weapon, "Crossbow")) {
    gain("MartialArts");
  }
}

/**
 * Every other player's reaction to the swing, and the hit on them. The attacker must be allowed to
 * swing (already checked); the victim's map must allow PvP or the victim stand on a `6P` tile.
 * An `invulnerable` role is never hurt, as monsters never hurt them (a bug fixed: 1.6's player hit had no
 * immortal check).
 */
function pvpSwing(
  room: Room,
  p: Player,
  power: number,
  weapon: string,
  ctx: MeleeCtx,
  ev: SwingEvents,
): void {
  const [dx, dy] = FACING_DELTA[p.facing];
  const fx = p.x + dx;
  const fy = p.y + dy;
  for (const v of room.players) {
    // A rider is never hit by a swing: the victim's sprite name contains "57-".
    if (
      v === p ||
      v.vehicle ||
      v.deadLock > 0 ||
      v.loading > 0 ||
      v.flicker > 0 ||
      can(v.role, "invulnerable")
    ) {
      continue;
    }
    const pvpOff = room.map.flags.canPvp === "O" && !onArenaTile(room, v.x, v.y);
    if (pvpOff) {
      continue;
    }
    let hit = (p.x === v.x && p.y === v.y) || (fx === v.x && fy === v.y);
    if (!hit && v.stepFrames > 0) {
      // A victim part-way through a step is also hit on the tile it is leaving (a bug fixed: 1.6
      // compared the old Y with both coordinates of the faced tile).
      const [vdx, vdy] = FACING_DELTA[v.facing];
      hit = fx === v.x - vdx && fy === v.y - vdy;
    }
    if (!hit) {
      continue;
    }
    v.lastToHitMe = p.name;
    v.lastToHitId = p.id;
    v.hitAge = 0;
    const shielded = onHolyShield(v, room.map.slots);
    const r = pvpHit(power, fighterOf(v), weapon, v.defenseBonus, ctx.rng, shielded);
    v.flicker = FLICKER_FRAMES;
    v.vitalsDirty = true;
    const lines: string[] = [];
    const parry = skillIndex("Parry");
    const block = skillIndex("Block");
    const gainParry = () => {
      if (rollParryGain(v.char.skills[parry] ?? 0, ctx.rng)) {
        v.char.skills[parry] = (v.char.skills[parry] ?? 0) + 1;
        lines.push(advancedText("Parry"));
      }
    };
    const gainBlock = () => {
      if (rollBlockGain(v.char.skills[block] ?? 0, v.char.skills[parry] ?? 0, ctx.rng)) {
        v.char.skills[block] = (v.char.skills[block] ?? 0) + 1;
        lines.push(advancedText("Block"));
      }
    };
    if (r.kind === "shield") {
      // "6:Shield" with no `hitsound`, then the Parry skill gain.
      gainParry();
      ev.pvp.push({ victim: v, text: "Shield", color: HIT_COLOR, splat: false, lines });
      continue;
    }
    if (r.kind === "parry" || r.kind === "block") {
      (r.kind === "parry" ? gainParry : gainBlock)();
      ev.pvp.push({
        victim: v,
        text: r.kind === "parry" ? "Parry" : "Block",
        color: DODGE_COLOR,
        splat: false,
        lines,
      });
      continue;
    }
    if (r.kind !== "hit") {
      continue;
    }
    // HP loses the attack power, floor 0, floatie with splat and sound, then both gains.
    v.char.vitals.hp = Math.max(0, v.char.vitals.hp - r.dmg);
    if (ctx.lightning) {
      // `ltass`: floored at 1 instead, so the frame script's own death test never fires; the death
      // script runs after the floatie, the gains and the save.
      v.char.vitals.hp = Math.max(1, v.char.vitals.hp);
      v.lightningDeath = true;
    }
    gainParry();
    gainBlock();
    ev.pvp.push({ victim: v, text: String(r.dmg), color: HIT_COLOR, splat: true, lines });
  }
}

/**
 * The swing sound: none for the Watering Bucket, Hoe and Fishing Pole, `LaserSword` for a laser
 * sword, else `swordswing`.
 */
export function swingSound(weapon: string): SwingSound {
  const row = firstMatch(itemRulesData.swing.sounds, weapon);
  return row ? row.sound : "swordswing";
}

/** A melee hit on the server's one copy of the monster. */
function smash(
  room: Room,
  p: Player,
  slot: MonsterSlot,
  dmg: number,
  ctx: MeleeCtx,
  ev: SwingEvents,
): void {
  const m = slot.live;
  if (!m) {
    return;
  }
  const sp = species(m.name);
  // The hitter's weapon break roll comes first.
  const e = p.char.equip;
  if (rollWeaponBreak(e, statsOf(p).sta, p.char.hunger, m.name, ctx.rng)) {
    ev.lines.push(shattersText(e.weapon));
    e.weapon = damagedForm(e.weapon);
    p.invDirty = true;
    p.lookDirty = true;
  }
  // Any melee hit on a Passive monster provokes it for everyone here.
  if (hasFlag(room.npcs, m.name, "Passive")) {
    for (const o of room.players) {
      o.npcAttackFlag = true;
    }
  }
  m.hp -= dmg;
  slot.dirty = true;
  if (m.hp >= 0) {
    ev.hits.push({ slot, dmg, kill: false });
    return;
  }
  // Death is HP < 0. The kill block does not exit, but the sprite has already been moved off the
  // stage, so the splat and floatie land off-screen.
  slot.live = null;
  ev.hits.push({ slot, dmg, kill: true });
  // The monster's loot drops on the tile it is drawn nearest.
  const loot = rollLoot(npcFileNamed(room.npcs, m.name)?.loot ?? null, ctx.rng);
  if (loot && ctx.world) {
    const io = new ItemOut(room);
    const decayMs = (ctx.lootDecayMinutes ?? 30) * 60_000;
    const at = monsterDrawnTile(m.x, m.y, m.fromX, m.fromY, m.anim);
    addGround({ world: ctx.world, rng: ctx.rng, now: ctx.now ?? 0 }, room, io, {
      item: loot,
      x: at.x,
      y: at.y,
      kind: "loot",
      expiresAt: (ctx.now ?? 0) + decayMs,
    });
    ev.out.push(...io.out);
  }
  // Kill XP for the hitter; the name check is server-side moot.
  const v = p.char.vitals;
  if (v.level < 1) {
    return;
  }
  const killXp = meleeKillXp(sp?.xpMelee ?? 30, m.name, p.char.equip.ring);
  const broadcast = firstMatch(monstersData.rules.killBroadcasts, m.name);
  if (broadcast) {
    ev.broadcast = broadcast.text.replace("{}", p.name);
  }
  v.exp += xpGained(killXp, v.level);
  p.vitalsDirty = true;
  // Skill gain, then the level check.
  const f = fighterOf(p);
  for (const s of rollKillSkillGain(f, sp?.body ?? 0, ctx.rng)) {
    ev.lines.push(advancedText(s));
  }
  // One line for each level gained.
  for (let n = checkLevelUp(v); n > 0; n--) {
    ev.lines.push(LEVEL_UP_TEXT);
  }
}
