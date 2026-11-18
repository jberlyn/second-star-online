/**
 * Spell collision and effects: the collision test on players and the hit and death checks on
 * monsters, run once on the server against its own state.
 */
import {
  checkLevelUp,
  createFood,
  type DeltaEvent,
  EFFECT_TEXT,
  FLICKER_FRAMES,
  filledLines,
  fxEffect,
  fxMember,
  invAdd,
  inxitionText,
  LEVEL_UP_TEXT,
  lingoContains,
  meleeKillXp,
  monsterDrawnTile,
  morphBody,
  morphCounterFor,
  type PlayerSpellBranch,
  playerSpellAmount,
  type Rng,
  radarText,
  rectsIntersect,
  rollLoot,
  type SpellTarget,
  spellHitOnMonster,
  xpGained,
} from "@secondstaronline/shared";

import { onArenaTile } from "../combat/melee.ts";
import { addGround, type ItemCtx, ItemOut } from "../inventory/items.ts";
import { chatterOut } from "../monsters/npc.ts";
import { hasFlag, npcFileNamed } from "../monsters/npcfiles.ts";
import { defenseOf, type MonsterSlot, species } from "../monsters/slots.ts";
import { spawnHp } from "../monsters/spawn.ts";
import type { Outgoing, Player, Room, SpellFx } from "../world/world.ts";
import { fxRect, monsterMember, monsterRect, playerRect } from "./geometry.ts";

/** Spell damage on a player shows in colour 6 with no splat or sound; heals in 5. */
export const SPELL_HIT_COLOR = 6;
export const SPELL_HEAL_COLOR = 5;
/** Monster floaties: 124 with splat and `hitsound`, heals 46. */
export const MONSTER_SPELL_HIT_COLOR = 124;
export const MONSTER_SPELL_HEAL_COLOR = 46;

export interface CollideCtx {
  rng: Rng;
  item: ItemCtx;
  /** Minutes before monster loot decays (setting `lootDecayMinutes`). */
  lootDecayMinutes: number;
  /** The world tick: which of F2, F3, F1 a standing Airship rider shows. */
  tick?: number;
}

export interface CollideOut {
  events: DeltaEvent[];
  out: Outgoing[];
  /** Players to send through a portal. */
  portals: Player[];
  /** A monster died: write the slots. */
  slotsChanged: boolean;
}

const tell = (out: Outgoing[], p: Player, text: string) =>
  out.push({ to: p.id, msg: { t: "chat", text, color: 0 } });

/**
 * Whether player-versus-player spells are off here: the map's `CanPeeVeePee`, or "X" on a `6P` tile
 * (the same field test as the arena death, rows 1-9 only).
 */
function pvpOff(room: Room, p: Player): boolean {
  return room.map.flags.canPvp === "O" && !onArenaTile(room, p.x, p.y);
}

/**
 * The spell collision for one player: only while not dead and not flickering, read once
 * before the loop. FX are visited by slot; each branch is a `contains` on the member name. A
 * branch that does not apply to you (your own harmful spell, a player's harmful spell where PvP is
 * off, a body change in a vehicle) skips only that FX (a bug fixed: 1.6 left the whole handler, so
 * your own spell shielded you from the others that frame).
 *
 * The PvP flag stops players' spells only: a monster's spell, which only maps where fighting is on
 * see, lands wherever it falls (a bug fixed: 1.6 tested every spell against the PvP flag). Hold
 * obeys it like the harmful spells (a bug fixed: 1.6's Hold tested only for a vehicle and its
 * caster).
 */
export function playerCollision(room: Room, p: Player, ctx: CollideCtx, res: CollideOut): void {
  if (p.deadLock > 0 || p.loading > 0 || p.flicker >= 1) {
    return;
  }
  const me = playerRect(p, ctx.tick);
  const v = p.char.vitals;
  const off = pvpOff(room, p);
  const target = (): SpellTarget => ({ equip: p.char.equip, magicShield: p.spell.magicDef > 0 });
  const damage = (fx: SpellFx, dmg: number) => {
    v.hp = v.hp <= dmg ? 0 : v.hp - dmg;
    p.lastToHitMe = fx.owner;
    // A monster's spell has no owner id.
    p.lastToHitId = fx.ownerId ?? null;
    p.hitAge = 0;
    p.flicker = FLICKER_FRAMES; // the hit flicker starts
    p.vitalsDirty = true;
    res.events.push({ e: "phit", id: p.id, text: String(dmg), color: SPELL_HIT_COLOR });
  };
  const heal = (n: number) => {
    v.hp = Math.min(v.hp + n, v.hpMax);
    p.vitalsDirty = true;
    res.events.push({ e: "phit", id: p.id, text: String(n), color: SPELL_HEAL_COLOR });
  };
  const mine = (fx: SpellFx) => fx.ownerId === p.id;
  /** A harmful spell that does not touch you: your own, or a player's where PvP is off. */
  const spared = (fx: SpellFx) => mine(fx) || (off && fx.ownerId !== null);
  for (const fx of room.fx) {
    const r = fxRect(fx);
    if (!r || !rectsIntersect(r, me)) {
      continue;
    }
    const m = fxMember({ name: fxEffect(fx.name), frame: fx.frame });
    const P = fx.power;
    const has = (s: string) => lingoContains(m, s);
    if (!p.keyLock && has("Portal-3")) {
      res.portals.push(p);
    }
    // One line for each player a Radar passes over (a bug fixed: 1.6 sent one every frame).
    if (has("Radar") && !fx.radarSeen?.has(p.id)) {
      fx.radarSeen ??= new Set();
      fx.radarSeen.add(p.id);
      res.out.push(
        ...chatterOut(
          room,
          radarText(p.name, { gold: p.char.gold, hp: v.hp, sp: v.sp }, ctx.rng),
          p.name,
        ),
      );
    }
    if (has("Arrows")) {
      if (spared(fx)) {
        continue;
      }
      damage(fx, playerSpellAmount("Arrows", P, target(), ctx.rng));
    }
    if (has("Whirlwind")) {
      if (spared(fx)) {
        continue;
      }
      if (v.sp > 0) {
        v.sp -= 1;
        p.vitalsDirty = true;
      }
    }
    if (has("Firesword-3")) {
      if (lingoContains(p.char.equip.weapon, "Sword")) {
        p.spell.fireSword = P * 40;
        tell(res.out, p, EFFECT_TEXT.fireswordOn);
      } else {
        tell(res.out, p, EFFECT_TEXT.fireswordNoSword);
      }
    }
    // A buff cast again while it runs restarts its time, the longer of the two, and never adds
    // (a bug fixed: 1.6 added Magic Shield's, Stone Skin's and Argon's Fist's counters, and Stone
    // Skin's bonus, on each cast).
    if (has("Magic Shield-3")) {
      p.spell.magicDef = Math.max(p.spell.magicDef, P * 70);
      tell(res.out, p, EFFECT_TEXT.magicShield);
    }
    if (has("Diminish Hunger-3") && p.char.hunger < 35000) {
      p.char.hunger += 3000;
      tell(res.out, p, EFFECT_TEXT.hunger);
    }
    if (has("Stone Skin-9")) {
      p.defenseBonus = STONE_SKIN_BONUS;
      p.spell.defenseCounter = Math.max(p.spell.defenseCounter, P * 30);
      tell(res.out, p, EFFECT_TEXT.stoneSkin);
    }
    if (has("Dispel Illusions-3")) {
      // The body reverts with no vehicle: an Airship rider keeps the airship.
      if (!p.vehicle) {
        setBody(p, null, res);
      }
    }
    if (has("Argon's Fist-3")) {
      argonsFist(p);
      tell(res.out, p, EFFECT_TEXT.argon);
    }
    if (has("Inxition-3")) {
      res.out.push(...chatterOut(room, inxitionText(p.name, v.expNeeded, v.exp), p.name));
    }
    if (has("Create Food-3")) {
      const food = createFood(filledLines(p.char.bag), ctx.rng);
      tell(res.out, p, food.text);
      if (food.item) {
        // Stacks, or takes the first empty line.
        invAdd(p.char, food.item, 1, ctx.rng);
        p.invDirty = true;
      }
    }
    if (has("major heal-3")) {
      heal(playerSpellAmount("major heal", P, target(), ctx.rng));
    }
    if (has("minor heal-3")) {
      heal(playerSpellAmount("minor heal", P, target(), ctx.rng));
    }
    // Morph, Nature Shift and Smoke Bomb do nothing in a vehicle or as a boss (not built); Hold
    // the same, its vehicle test first.
    if (has("morph-3")) {
      if (p.vehicle) {
        continue;
      }
      setBody(p, morphBody(P, ctx.rng), res);
    }
    if (has("Nature Shift-3")) {
      if (p.vehicle) {
        continue;
      }
      setBody(p, 80, res);
    }
    if (has("Smoke Bomb-3")) {
      if (p.vehicle) {
        continue;
      }
      p.spell.smokeBomb = P;
      setBody(p, 100, res);
    }
    if (has("Hold-3")) {
      if (p.vehicle || spared(fx)) {
        continue;
      }
      p.spell.hold = P * 8;
      tell(res.out, p, EFFECT_TEXT.hold);
    }
    // The harmful branches. Bolt's test leaves out Firebolt.
    const hits: [boolean, PlayerSpellBranch][] = [
      [has("crush"), "crush"],
      [has("firebolt"), "firebolt"],
      [has("Splash"), "Splash"],
      [has("meteor"), "meteor"],
      [has("Fireball"), "Fireball"],
      [has("Bolt") && !has("fire"), "Bolt"],
      [has("wind wave"), "wind wave"],
    ];
    for (const [hit, branch] of hits) {
      if (hit && !spared(fx)) {
        damage(fx, playerSpellAmount(branch, P, target(), ctx.rng));
      }
    }
  }
}

/** Stone Skin's defense bonus. */
export const STONE_SKIN_BONUS = 1;

/**
 * Argon's Fist, from the spell or a Purple Potion: the attack bonus, and its counter restarted at
 * 400 frames unless more is left.
 */
export function argonsFist(p: Player): void {
  p.attackBonus = 1;
  p.timers.attackCounter = Math.max(p.timers.attackCounter, ARGON_FRAMES);
}

/** Argon's Fist's counter. */
export const ARGON_FRAMES = 400;

/**
 * Changes or reverts a body: everyone on the map sees the new body; the target's morph counter is
 * set by a change and left by a revert.
 */
export function setBody(p: Player, body: number | null, res: { events: DeltaEvent[] }): void {
  if (body !== null) {
    p.spell.morph = morphCounterFor(body, p.spell.morph);
  }
  p.spell.body = body;
  res.events.push({ e: "body", id: p.id, body });
}

/**
 * The monsters' spell hits, once per frame from the mover: each monster against each FX by slot.
 * A hit needs the spell-hit lockout at 0 and sets it to 16, so the first FX of the frame wins. The
 * one exception is the FX that set the lockout reaching a different hit frame: Meteor's frame 19
 * after its frame 13 (a bug fixed: 1.6's lockout swallowed Meteor's second hit). Every effect is
 * an exact member, but Radar (name contains "Radar-5", no lockout) and arrows (name contains
 * " Arrows"). A player's harmful spell provokes a Passive monster as a melee hit does (a bug fixed:
 * in 1.6 only melee did).
 */
export function monsterHits(room: Room, ctx: CollideCtx, res: CollideOut): void {
  for (const slot of room.map.slots) {
    for (const fx of room.fx) {
      const m = slot.live;
      if (!m) {
        break;
      }
      const fr = fxRect(fx);
      const mr = monsterRect(slot);
      if (!fr || !mr || !rectsIntersect(fr, mr)) {
        continue;
      }
      const mem = fxMember({ name: fxEffect(fx.name), frame: fx.frame });
      const ownSecondHit = m.lockedBy?.fx === fx && m.lockedBy.member !== mem;
      if (m.hitCountb >= 1 && !ownSecondHit) {
        continue;
      }
      const body = monsterMember(slot);
      const P = fx.power;
      const r = ctx.rng;
      if (lingoContains(mem, "Radar-5")) {
        // Every client that sees it adds the line to chat: everyone here.
        for (const o of room.players) {
          tell(res.out, o, `The ${m.name} has ${m.hp} hit points.`);
        }
      }
      const hit = spellHitOnMonster(mem, body, defenseOf(m.name), P, r);
      if (!hit) {
        continue;
      }
      m.hp += hit.heal ? hit.n : -hit.n;
      m.hitCountb = 16;
      m.lockedBy = { fx, member: mem };
      slot.dirty = true;
      if (!hit.heal && fx.ownerId !== null && hasFlag(room.npcs, m.name, "Passive")) {
        for (const o of room.players) {
          o.npcAttackFlag = true;
        }
      }
      const kill = checkForDead(room, slot, fx, ctx, res);
      res.events.push({
        e: "mspell",
        slot: slot.slot,
        text: String(hit.n),
        color: hit.heal ? MONSTER_SPELL_HEAL_COLOR : MONSTER_SPELL_HIT_COLOR,
        splat: hit.splat,
        kill,
      });
    }
  }
}

/**
 * The death check: above 0 HP is capped at the species' own hit points (a bug fixed: 1.6 capped it
 * from a table that defaulted to 200, so a heal lifted a 1 HP Pig to 200); below 0 the monster
 * dies for everyone. Only the FX's owner, a player on this map, sends `M<k>Cncl`, drops the loot
 * and gains the spell table's XP; a monster's or the Server Spirit's kill gives nothing.
 */
function checkForDead(
  room: Room,
  slot: MonsterSlot,
  fx: SpellFx,
  ctx: CollideCtx,
  res: CollideOut,
): boolean {
  const m = slot.live;
  if (!m) {
    return false;
  }
  const sp = species(m.name);
  if (m.hp > 0) {
    const cap = spawnHp(m.name);
    if (m.hp > cap) {
      m.hp = cap;
    }
  }
  if (m.hp >= 0) {
    return false;
  }
  slot.live = null;
  slot.dirty = true;
  res.slotsChanged = true;
  const owner = fx.ownerId ? room.players.find((o) => o.id === fx.ownerId) : undefined;
  if (!owner) {
    return true;
  }
  // The loot drops on the tile the monster is drawn nearest, then the XP.
  const loot = rollLoot(npcFileNamed(room.npcs, m.name)?.loot ?? null, ctx.rng);
  if (loot) {
    const at = monsterDrawnTile(m.x, m.y, m.fromX, m.fromY, m.anim);
    const io = new ItemOut(room);
    addGround(ctx.item, room, io, {
      item: loot,
      x: at.x,
      y: at.y,
      kind: "loot",
      expiresAt: ctx.item.now + ctx.lootDecayMinutes * 60_000,
    });
    res.out.push(...io.out);
  }
  const v = owner.char.vitals;
  if (v.level < 1) {
    return true;
  }
  const xp = meleeKillXp(sp?.xpSpell ?? 30, m.name, owner.char.equip.ring);
  v.exp += xpGained(xp, v.level);
  owner.vitalsDirty = true;
  // One line for each level gained.
  for (let n = checkLevelUp(v); n > 0; n--) {
    tell(res.out, owner, LEVEL_UP_TEXT);
  }
  return true;
}
