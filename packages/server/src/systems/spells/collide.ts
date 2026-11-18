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
  lingoContains,
  meleeKillXp,
  monsterDrawnTile,
  morphBody,
  morphCounterFor,
  playerSpellAmount,
  type Rng,
  radarText,
  rectsIntersect,
  rollLoot,
  spellHitOnMonster,
  xpGained,
} from "@secondstaronline/shared";

import { onArenaTile } from "../combat/melee.ts";
import { addGround, type ItemCtx, ItemOut } from "../inventory/items.ts";
import { chatterOut } from "../monsters/npc.ts";
import { npcFileNamed } from "../monsters/npcfiles.ts";
import { defenseOf, type MonsterSlot, species } from "../monsters/slots.ts";
import type { Outgoing, Player, Room, SpellFx } from "../world/world.ts";
import { fxRect, monsterMember, monsterRect, playerRect } from "./geometry.ts";

/** Spell damage on a player shows in colour 6 with no splat or sound; heals in 5. */
export const SPELL_HIT_COLOR = 6;
export const SPELL_HEAL_COLOR = 5;
/** Monster floaties: 124 with splat and `hitsound`, heals 46. */
export const MONSTER_SPELL_HIT_COLOR = 124;
export const MONSTER_SPELL_HEAL_COLOR = 46;
/** The spell path's level-up line, with its stray "a". */
export const SPELL_LEVEL_UP_TEXT = "You have become a more powerful!";

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
 * before the loop. FX are visited by slot; each branch is a `contains` on the member name, and the
 * harmful branches (and Morph, Nature Shift, Smoke Bomb and Hold's own exits) leave the whole
 * handler, so your own harmful spell shields you from the other spells that frame (a kept 1.6
 * bug).
 */
export function playerCollision(room: Room, p: Player, ctx: CollideCtx, res: CollideOut): void {
  if (p.deadLock > 0 || p.loading > 0 || p.flicker >= 1) {
    return;
  }
  const me = playerRect(p, ctx.tick);
  const v = p.char.vitals;
  const off = pvpOff(room, p);
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
    if (has("Radar")) {
      res.out.push(
        ...chatterOut(
          room,
          radarText(p.name, { gold: p.char.gold, hp: v.hp, sp: v.sp }, ctx.rng),
          p.name,
        ),
      );
    }
    if (has("Arrows")) {
      if (mine(fx) || off) {
        return;
      }
      damage(fx, playerSpellAmount("Arrows", P, ctx.rng));
    }
    if (has("Whirlwind")) {
      if (mine(fx) || off) {
        return;
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
    if (has("Magic Shield-3")) {
      p.spell.magicDef += P * 70;
      tell(res.out, p, EFFECT_TEXT.magicShield);
    }
    if (has("Diminish Hunger-3") && p.char.hunger < 35000) {
      p.char.hunger += 3000;
      tell(res.out, p, EFFECT_TEXT.hunger);
    }
    if (has("Stone Skin-9")) {
      p.defenseBonus += 1;
      p.spell.defenseCounter += P * 30;
      tell(res.out, p, EFFECT_TEXT.stoneSkin);
    }
    if (has("Dispel Illusions-3")) {
      // The body reverts with no vehicle: an Airship rider keeps the airship.
      if (!p.vehicle) {
        setBody(p, null, res);
      }
    }
    if (has("Argon's Fist-3")) {
      p.attackBonus = 1;
      p.timers.attackCounter += 400;
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
      heal(playerSpellAmount("major heal", P, ctx.rng));
    }
    if (has("minor heal-3")) {
      heal(playerSpellAmount("minor heal", P, ctx.rng));
    }
    // Morph, Nature Shift and Smoke Bomb exit the whole handler in a vehicle or as a boss (not
    // built); Hold the same, its vehicle test first.
    if (has("morph-3")) {
      if (p.vehicle) {
        return;
      }
      setBody(p, morphBody(P, ctx.rng), res);
    }
    if (has("Nature Shift-3")) {
      if (p.vehicle) {
        return;
      }
      setBody(p, 80, res);
    }
    if (has("Smoke Bomb-3")) {
      if (p.vehicle) {
        return;
      }
      p.spell.smokeBomb = P;
      setBody(p, 100, res);
    }
    if (has("Hold-3")) {
      if (p.vehicle || mine(fx)) {
        return;
      }
      p.spell.hold = P * 8;
      tell(res.out, p, EFFECT_TEXT.hold);
    }
    if (has("crush")) {
      if (mine(fx) || off) {
        return;
      }
      damage(fx, playerSpellAmount("crush", P, ctx.rng));
    }
    if (has("firebolt")) {
      if (mine(fx) || off) {
        return;
      }
      damage(fx, playerSpellAmount("firebolt", P, ctx.rng));
    }
    if (has("Splash")) {
      if (mine(fx) || off) {
        return;
      }
      damage(fx, playerSpellAmount("Splash", P, ctx.rng));
    }
    if (has("meteor")) {
      if (mine(fx) || off) {
        return;
      }
      damage(fx, playerSpellAmount("meteor", P, ctx.rng));
    }
    if (has("Fireball")) {
      if (mine(fx) || off) {
        return;
      }
      damage(fx, playerSpellAmount("Fireball", P, ctx.rng));
    }
    if (has("Bolt") && !has("fire")) {
      if (mine(fx) || off) {
        return;
      }
      damage(fx, playerSpellAmount("Bolt", P, ctx.rng));
    }
    if (has("wind wave")) {
      if (mine(fx) || off) {
        return;
      }
      damage(fx, playerSpellAmount("wind wave", P, ctx.rng));
    }
  }
}

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
 * A hit needs the spell-hit lockout at 0 and sets it to 16, so the first FX of the frame wins.
 * Every effect is an exact member, but Radar (name contains "Radar-5", no lockout) and arrows
 * (name contains " Arrows").
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
      if (!fr || !mr || !rectsIntersect(fr, mr) || m.hitCountb >= 1) {
        continue;
      }
      const body = monsterMember(slot);
      const mem = fxMember({ name: fxEffect(fx.name), frame: fx.frame });
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
      slot.dirty = true;
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
 * The death check: above 0 the heal cap clamps HP (default 200); below 0 the monster dies for
 * everyone. Only the FX's owner, a player on this map, sends `M<k>Cncl`, drops the loot and gains
 * the spell table's XP; a monster's or the Server Spirit's kill gives nothing.
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
    const cap = sp?.healCap ?? 200;
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
    tell(res.out, owner, SPELL_LEVEL_UP_TEXT);
  }
  return true;
}
