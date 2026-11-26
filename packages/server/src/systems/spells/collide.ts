/**
 * Spell collision and effects: the collision test on players and the hit and death checks on
 * monsters, run once on the server against its own state.
 */
import {
  bodySpellTicks,
  can,
  cannonballSweep,
  cannonballTile,
  cannonDamage,
  checkLevelUp,
  content,
  createFood,
  type DeltaEvent,
  EFFECT_TEXT,
  filledLines,
  firstMatch,
  flickerFrames,
  fxEffect,
  fxMember,
  hasBehaviour,
  hullHitDamage,
  invAdd,
  inxitionText,
  isCannonball,
  LEVEL_UP_TEXT,
  lingoContains,
  meleeKillXp,
  monsterDrawnTile,
  monsterFlags,
  morphBody,
  type PlayerSpellBranch,
  playerSpellAmount,
  type Rng,
  radarText,
  rectsIntersect,
  rollLoot,
  type SpellTarget,
  smokeBody,
  speciesKillXp,
  spellByName,
  spellHitOnMonster,
  spellOfFx,
  treeBody,
  vehicleOfItem,
  weaponSkillList,
  xpGained,
} from "@secondstaronline/shared";

import { logActivity, logPlaced } from "../admin/activity.ts";
import { onArenaTile } from "../combat/melee.ts";
import { addGround, type ItemCtx, ItemOut } from "../inventory/items.ts";
import { gainOnHit } from "../monsters/attack.ts";
import { chatterOut } from "../monsters/npc.ts";
import { hasFlag, npcFileNamed } from "../monsters/npcfiles.ts";
import { defenseOf, type MonsterSlot, species } from "../monsters/slots.ts";
import { spawnHp } from "../monsters/spawn.ts";
import { downed } from "../progression/vitals.ts";
import type { Outgoing, Player, Room, SpellFx } from "../world/world.ts";
import { fxRect, monsterRect, playerRect } from "./geometry.ts";

/** Spell damage on a player shows in colour 6 with no splat or sound; heals in 5. */
export const SPELL_HIT_COLOR = 6;
export const SPELL_HEAL_COLOR = 5;
/** Monster floaties: 124 with splat and `hitsound`, heals 46. */
export const MONSTER_SPELL_HIT_COLOR = 124;
export const MONSTER_SPELL_HEAL_COLOR = 46;

export interface CollideCtx {
  rng: Rng;
  item: ItemCtx;
  /** Minutes before monster loot decays (the balance row `drops.lootDecaySeconds`). */
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
  /** Kill broadcasts for every player who hears the killer, as a melee kill sends them. */
  broadcasts: { from: string; text: string }[];
}

const tell = (out: Outgoing[], p: Player, text: string) =>
  out.push({ to: p.id, msg: { t: "chat", text, color: 0 } });

/**
 * Whether player-versus-player spells are off here: the map's `CanPeeVeePee`, or "X" on a `6P` tile
 * (the same field test as the arena death, on any of the map's 12 rows). A rider follows the map's
 * flag alone: arenas are for players on foot (an SSO rule).
 */
function pvpOff(room: Room, p: Player): boolean {
  return room.map.flags.canPvp === "O" && (p.vehicle !== null || !onArenaTile(room, p.x, p.y));
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
  if (p.deadLock > 0 || p.loading > 0 || p.flicker >= 1 || downed(p)) {
    return;
  }
  const me = playerRect(p, ctx.tick);
  const v = p.char.vitals;
  const off = pvpOff(room, p);
  const target = (): SpellTarget => ({ equip: p.char.equip, magicShield: p.spell.magicDef > 0 });
  // A role that takes no damage is untouched by harmful spells (a bug fixed: SSO's early immortals,
  // safe from monsters and melee, could still be killed by a spell).
  const invulnerable = can(p.role, "invulnerable");
  const damage = (fx: SpellFx, spellDmg: number) => {
    if (invulnerable) {
      return;
    }
    // Aboard, the hit wears the hull by a fixed amount instead (an SSO addition).
    const aboard = p.vehicle !== null && p.hull !== null;
    const dmg = aboard ? hullHitDamage() : spellDmg;
    if (aboard && p.hull !== null) {
      p.hull = p.hull <= dmg ? 0 : p.hull - dmg;
    } else {
      const left = v.hp;
      v.hp = v.hp <= dmg ? 0 : v.hp - dmg;
      trainHitter(room, fx, Math.min(dmg, left), ctx, res);
    }
    p.lastToHitMe = fx.owner;
    // A monster's spell has no owner id.
    p.lastToHitId = fx.ownerId ?? null;
    p.hitAge = 0;
    p.flicker = flickerFrames(); // the hit flicker starts
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
    // A cannonball shot is handled by `cannonballHits`.
    if (!r || !rectsIntersect(r, me) || isCannonball(fx.name)) {
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
      damage(fx, playerSpellAmount("Arrows", P, target(), ctx.rng, own(fx)));
    }
    if (has("Whirlwind")) {
      if (spared(fx) || invulnerable) {
        continue;
      }
      if (v.sp > 0) {
        v.sp -= 1;
        p.vitalsDirty = true;
      }
    }
    // A buff whose length works out to 0 frames (a balance row of 0, or no power) does nothing at
    // all: no bonus that no counter would ever take away, and no message (an SSO safeguard).
    const fireSwordLasts = P * content().balance.buffs.fireSwordPerPower;
    if (has("Firesword-3") && fireSwordLasts > 0) {
      if (hasBehaviour(p.char.equip.weapon, "sword")) {
        p.spell.fireSword = fireSwordLasts;
        tell(res.out, p, EFFECT_TEXT.fireswordOn);
      } else {
        tell(res.out, p, EFFECT_TEXT.fireswordNoSword);
      }
    }
    // A buff cast again while it runs restarts its time, the longer of the two, and never adds
    // (a bug fixed: 1.6 added Magic Shield's, Stone Skin's and Argon's Fist's counters, and Stone
    // Skin's bonus, on each cast).
    const shieldLasts = P * content().balance.buffs.magicShieldPerPower;
    if (has("Magic Shield-3") && shieldLasts > 0) {
      p.spell.magicDef = Math.max(p.spell.magicDef, shieldLasts);
      tell(res.out, p, EFFECT_TEXT.magicShield);
    }
    const diminish = content().balance.buffs.diminishHunger;
    if (has("Diminish Hunger-3") && diminish.add > 0 && p.char.hunger < diminish.below) {
      p.char.hunger += diminish.add;
      tell(res.out, p, EFFECT_TEXT.hunger);
    }
    const skinLasts = P * content().balance.buffs.stoneSkinPerPower;
    if (has("Stone Skin-9") && skinLasts > 0) {
      p.defenseBonus = content().balance.buffs.stoneSkinBonus;
      p.spell.defenseCounter = Math.max(p.spell.defenseCounter, skinLasts);
      tell(res.out, p, EFFECT_TEXT.stoneSkin);
    }
    if (has("Dispel Illusions-3")) {
      // The body reverts with no vehicle: an Airship rider keeps the airship.
      if (!p.vehicle) {
        setBody(p, null, res);
      }
    }
    if (has("Argon's Fist-3") && argonsFist(p)) {
      tell(res.out, p, EFFECT_TEXT.argon);
    }
    if (has("Inxition-3")) {
      res.out.push(...chatterOut(room, inxitionText(p.name, v.expNeeded, v.exp), p.name));
    }
    if (has("Create Food-3")) {
      // The cast spell's own items (a spell may run Create Food's FX with a list of its own).
      const spell = fx.castSpell ? spellByName(fx.castSpell) : spellOfFx(fx.name);
      const food = createFood(filledLines(p.char.bag), spell?.creates ?? [], ctx.rng);
      if (food.text) {
        tell(res.out, p, food.text);
      }
      if (food.item) {
        // Stacks, or takes the first empty line.
        const r = invAdd(p.char, food.item, 1, ctx.rng);
        if (r.kind !== "full") {
          logActivity(ctx.item.world, p, "spell", {
            item: food.item,
            qty: 1,
            details: { spell: spell?.name ?? "Create Food" },
          });
        }
        p.invDirty = true;
      }
    }
    if (has("major heal-3")) {
      heal(playerSpellAmount("major heal", P, target(), ctx.rng, own(fx)));
    }
    if (has("minor heal-3")) {
      heal(playerSpellAmount("minor heal", P, target(), ctx.rng, own(fx)));
    }
    // Morph, Nature Shift and Smoke Bomb do nothing in a vehicle or as a boss (not built); Hold
    // the same, its vehicle test first.
    // A world that binds no such body (`bindings.json` `bodies`) has the spell do nothing.
    if (has("morph-3")) {
      if (p.vehicle) {
        continue;
      }
      const body = morphBody(P, ctx.rng);
      if (body !== null) {
        setBody(p, body, res, bodySpellTicks(castSpellOf(fx)));
      }
    }
    if (has("Nature Shift-3")) {
      if (p.vehicle) {
        continue;
      }
      const tree = treeBody();
      if (tree !== null) {
        setBody(p, tree, res, bodySpellTicks(castSpellOf(fx)));
      }
    }
    if (has("Smoke Bomb-3")) {
      if (p.vehicle) {
        continue;
      }
      const smoke = smokeBody();
      if (smoke !== null) {
        p.spell.smokeBomb = P;
        setBody(p, smoke, res, bodySpellTicks(castSpellOf(fx)));
      }
    }
    if (has("Hold-3")) {
      if (p.vehicle || spared(fx)) {
        continue;
      }
      const holdLasts = P * content().balance.buffs.holdPerPower;
      if (holdLasts > 0) {
        p.spell.hold = holdLasts;
        tell(res.out, p, EFFECT_TEXT.hold);
      }
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
        damage(fx, playerSpellAmount(branch, P, target(), ctx.rng, own(fx)));
      }
    }
  }
}

/**
 * A player's spell or arrow that did damage trains its owner (the `hit` source): an arrow the
 * owner's weapon skills, a spell its school. A cannonball trains nothing.
 */
function trainHitter(room: Room, fx: SpellFx, damage: number, ctx: CollideCtx, res: CollideOut) {
  const owner = fx.ownerId ? room.players.find((o) => o.id === fx.ownerId) : undefined;
  if (!owner || isCannonball(fx.name)) {
    return;
  }
  let skills: readonly string[];
  if (lingoContains(fx.name, " Arrows")) {
    // The bow it left, not whatever the shooter holds when it lands.
    skills = weaponSkillList(fx.firedFrom ?? owner.char.equip.weapon);
  } else {
    const spell = fx.castSpell ? spellByName(fx.castSpell) : spellOfFx(fx.name);
    skills = spell?.school ? [spell.school.skill] : [];
  }
  for (const line of gainOnHit(owner, skills, damage, ctx.rng)) {
    tell(res.out, owner, line);
  }
}

/**
 * Argon's Fist, from the spell or a Purple Potion: the attack bonus, and its counter restarted at
 * the balance row `buffs.argonFrames` (1.6: 400 frames) unless more is left. False, and nothing
 * given, when that row is 0.
 */
export function argonsFist(p: Player): boolean {
  const frames = content().balance.buffs.argonFrames;
  // At 0 frames there is nothing to count down, so no bonus is given (it would never end).
  if (frames <= 0) {
    return false;
  }
  p.attackBonus = 1;
  p.timers.attackCounter = Math.max(p.timers.attackCounter, frames);
  return true;
}

/** The spell an FX run was cast as: the cast's own spell, else the spell whose run it is. */
function castSpellOf(fx: { castSpell?: string | null; name: string }) {
  return fx.castSpell ? spellByName(fx.castSpell) : spellOfFx(fx.name);
}

/**
 * The cast spell's own amounts (its `amount`), which replace its effect's for its hits. Only a
 * spell cast from a spellbook says which spell it is: a free fireball, a monster's cast or a map
 * hazard reuses a spell's FX without being that spell, so it takes the effect's amounts.
 */
function own(fx: { castSpell?: string | null; name: string }) {
  return fx.castSpell ? spellByName(fx.castSpell)?.amount : undefined;
}

/**
 * Changes or reverts a body: everyone on the map sees the new body; the target's morph counter is
 * set by a change (to `ticks`, the spell's `lasts`) and left by a revert.
 */
export function setBody(
  p: Player,
  body: number | null,
  res: { events: DeltaEvent[] },
  ticks = 0,
): void {
  if (body !== null) {
    p.spell.morph = ticks;
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
      if (isCannonball(fx.name)) {
        continue;
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
      const P = fx.power;
      const r = ctx.rng;
      if (lingoContains(mem, "Radar-5")) {
        // Every client that sees it adds the line to chat: everyone here.
        for (const o of room.players) {
          tell(res.out, o, `The ${m.name} has ${m.hp} hit points.`);
        }
      }
      const hit = spellHitOnMonster(mem, monsterFlags(m.name), defenseOf(m.name), P, r, own(fx));
      if (!hit) {
        continue;
      }
      // A monster dies below 0 HP, so it had `hp + 1` to lose.
      const left = m.hp + 1;
      m.hp += hit.heal ? hit.n : -hit.n;
      if (!hit.heal) {
        trainHitter(room, fx, Math.min(hit.n, left), ctx, res);
      }
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
 * The Battleship's cannonball shots (an SSO addition), after each FX step: a shot stops at the
 * first player, monster or parked vehicle its shadow has passed over since the last test
 * (`cannonballSweep`, from the edge of the rider's tile at first; the vehicle by tile), and everyone sees it go. A player takes
 * `cannonDamage` off HP, or off the hull aboard, armour or not; a monster the same, whatever its
 * defense. Players are passed over where the map's PvP is off (a rider's shot is never an arena
 * hit), as are the shooter and anyone dead or loading. A parked vehicle stops the shot unharmed.
 */
export function cannonballHits(room: Room, ctx: CollideCtx, res: CollideOut): void {
  for (const fx of room.fx) {
    if (fx.gone || !isCannonball(fx.name)) {
      continue;
    }
    const r = cannonballSweep(fx.sweptTo ?? fx, fx);
    fx.sweptTo = { h: fx.h, v: fx.v };
    const pvpOn = room.map.flags.canPvp !== "O";
    const victim = room.players.find(
      (p) =>
        pvpOn &&
        p.id !== fx.ownerId &&
        p.deadLock === 0 &&
        p.loading === 0 &&
        rectsIntersect(r, playerRect(p, ctx.tick)),
    );
    const slot = victim
      ? undefined
      : room.map.slots.find((sl) => {
          const mr = sl.live ? monsterRect(sl) : null;
          return mr !== null && rectsIntersect(r, mr);
        });
    const t = cannonballTile(fx.h, fx.v);
    const vehicle =
      victim || slot
        ? undefined
        : room.map.ground.find((g) => g.x === t.x && g.y === t.y && vehicleOfItem(g.item));
    if (!victim && !slot && !vehicle) {
      continue;
    }
    fx.gone = true;
    res.events.push({ e: "fxend", slot: fx.slot, name: fx.name });
    if (victim) {
      shellPlayer(victim, fx, ctx, res);
    } else if (slot) {
      shellMonster(room, slot, fx, ctx, res);
    }
  }
  room.fx = room.fx.filter((f) => !f.gone);
}

/** A cannonball hit on a player: off the hull aboard, off HP on foot. */
function shellPlayer(p: Player, fx: SpellFx, ctx: CollideCtx, res: CollideOut): void {
  if (can(p.role, "invulnerable")) {
    return;
  }
  // A shell on a player already downed neither hurts nor takes the kill (see `downed`).
  if (downed(p)) {
    return;
  }
  const dmg = cannonDamage(ctx.rng);
  const v = p.char.vitals;
  if (p.vehicle !== null && p.hull !== null) {
    p.hull = p.hull <= dmg ? 0 : p.hull - dmg;
  } else {
    v.hp = v.hp <= dmg ? 0 : v.hp - dmg;
  }
  p.lastToHitMe = fx.owner;
  p.lastToHitId = fx.ownerId ?? null;
  p.hitAge = 0;
  p.flicker = flickerFrames();
  p.vitalsDirty = true;
  res.events.push({ e: "phit", id: p.id, text: String(dmg), color: SPELL_HIT_COLOR });
}

/** A cannonball hit on a monster: a spell's floatie, a Passive monster provoked, the death check. */
function shellMonster(
  room: Room,
  slot: MonsterSlot,
  fx: SpellFx,
  ctx: CollideCtx,
  res: CollideOut,
): void {
  const m = slot.live;
  if (!m) {
    return;
  }
  const dmg = cannonDamage(ctx.rng);
  m.hp -= dmg;
  slot.dirty = true;
  if (fx.ownerId !== null && hasFlag(room.npcs, m.name, "Passive")) {
    for (const o of room.players) {
      o.npcAttackFlag = true;
    }
  }
  const kill = checkForDead(room, slot, fx, ctx, res);
  res.events.push({
    e: "mspell",
    slot: slot.slot,
    text: String(dmg),
    color: MONSTER_SPELL_HIT_COLOR,
    splat: true,
    kill,
  });
}

/**
 * The death check: above 0 HP is capped at the species' own hit points (a bug fixed: 1.6 capped it
 * from a table that defaulted to 200, so a heal lifted a 1 HP Pig to 200); below 0 the monster
 * dies for everyone. Only the FX's owner, a player on this map, sends `M<k>Cncl`, drops the loot,
 * gains the spell table's XP and sends the kill broadcast (a bug fixed: 1.6 announced an
 * Overlord's death only after a melee kill); a monster's or the Server Spirit's kill gives nothing.
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
    // A caster who has left the map still made the kill: logged, though it earns nothing.
    const away = fx.ownerId ? ctx.item.world.players.get(fx.ownerId) : undefined;
    if (away) {
      logActivity(ctx.item.world, away, "kill", {
        other: m.name,
        at: { map: room.map.name, x: m.x, y: m.y },
        details: { by: "spell", away: true },
      });
    }
    return true;
  }
  logActivity(ctx.item.world, owner, "kill", { other: m.name, details: { by: "spell" } });
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
    logPlaced(ctx.item.world, owner, "loot", loot, {
      other: m.name,
      at: { map: room.map.name, x: at.x, y: at.y },
    });
    res.out.push(...io.out);
  }
  const v = owner.char.vitals;
  if (v.level < 1) {
    return true;
  }
  const xp = meleeKillXp(speciesKillXp(sp, "spell"), m.name, owner.char.equip);
  const broadcast = firstMatch(content().monsters.rules.killBroadcasts, m.name);
  if (broadcast) {
    res.broadcasts.push({ from: owner.name, text: broadcast.text.replace("{}", owner.name) });
  }
  v.exp += xpGained(xp, v.level, sp?.level);
  owner.vitalsDirty = true;
  // One line for each level gained.
  for (let n = checkLevelUp(v); n > 0; n--) {
    tell(res.out, owner, LEVEL_UP_TEXT);
  }
  return true;
}
