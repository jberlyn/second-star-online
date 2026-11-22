/**
 * Monster attacks on players (formula `mitigation.pve`). The original rolled once per frame per
 * visible monster on each client against that client's own player; the server rolls once per
 * (monster, player) per tick, so each player's hazard is the original's.
 */
import {
  advancedText,
  anyMatch,
  content,
  damagedForm,
  EQUIP_FIELD,
  type Fighter,
  FLICKER_FRAMES,
  monsterHitsPlayer,
  monsterReaches,
  type Rng,
  rollArmourBreak,
  rollBlockGain,
  rollParryGain,
  shattersText,
  skillIndex,
} from "@secondstaronline/shared";

import { logTransform } from "../admin/activity.ts";
import { onHolyShield } from "../spells/geometry.ts";
import { type Player, statsOf, type World, type WorldMap } from "../world/world.ts";
import { hasFlag, type NpcStore } from "./npcfiles.ts";
import { isFootprint, type MonsterSlot, species } from "./slots.ts";

/** Floatie colours: 6 damage and Shield, 103 Parry and Block. */
export const HIT_COLOR = 6;
export const DODGE_COLOR = 103;

export interface AttackOutcome {
  victim: Player;
  slot: MonsterSlot;
  /** The floatie: a number, "Parry" or "Block". */
  text: string;
  color: number;
  /** A damage number carries the splat and `hitsound`, as a player's hit does. */
  splat: boolean;
  /** Skill-gain lines for the victim. */
  lines: string[];
}

/**
 * The attack table value, or null for a name with no entry, which never melees (a bug fixed: 1.6
 * hit for 35 with any name its table did not list, such as a shopkeeper's).
 */
export function monsterAttackValue(name: string): number | null {
  return species(name)?.attack ?? null;
}

export interface MonsterAttackCtx {
  rng: Rng;
  /** The NPC files (`FLG|Passive`). */
  npcs: NpcStore;
  /** True when the victim takes no damage (the `invulnerable` permission). */
  invulnerable(p: Player): boolean;
  /** Where a broken piece of armour is logged (the activity log); absent in unit tests. */
  world?: World;
  /** Frames per player step: where the victim's sprite is for the Holy Shield test. */
}

/**
 * One monster's attack block for one victim. Returns the outcome when the monster acted, else
 * null. It never holds up the monster's walk (a bug fixed: in 1.6 an unprovoked Passive monster's
 * roll of 1 left its `stepFrame` early and skipped that frame's walk tick).
 */
export function monsterAttack(
  map: WorldMap,
  slot: MonsterSlot,
  p: Player,
  ctx: MonsterAttackCtx,
): AttackOutcome | null {
  const m = slot.live;
  if (!m || p.loading > 0 || p.deadLock > 0) {
    return null;
  }
  const sp = species(m.name);
  // Officers also fight a wanted player on a no-fight map.
  const canFight =
    map.flags.canFight === "X" ||
    (anyMatch(content().monsters.rules.officer, m.name) && p.char.wanted);
  // Webs never attack (body 92), nor does a name with no attack entry.
  const attack = monsterAttackValue(m.name);
  if (p.dontHitMeAgain || !canFight || sp?.body === 92 || attack === null) {
    return null;
  }
  if (ctx.rng.random(10) !== 1) {
    return null;
  }
  if (hasFlag(ctx.npcs, m.name, "Passive") && !p.npcAttackFlag) {
    return null;
  }
  // A monster never melees an Airship rider, after the `random(10)` draw and the Passive gate, so
  // the RNG order is unchanged.
  if (p.vehicle) {
    return null;
  }
  if (p.deathPause >= 1) {
    return null;
  }
  if (!monsterReaches({ x: m.x, y: m.y, footprint: isFootprint(m.name) }, p)) {
    return null;
  }
  return hitMe2(slot, p, attack, ctx);
}

/** The monster's hit on a player. */
function hitMe2(
  slot: MonsterSlot,
  p: Player,
  attack: number,
  ctx: MonsterAttackCtx,
): AttackOutcome | null {
  const m = slot.live as NonNullable<MonsterSlot["live"]>;
  if (ctx.invulnerable(p)) {
    return null; // no damage, from monsters or players
  }
  // Holy Shield never hits an innocent.
  if (!p.char.wanted && anyMatch(content().monsters.rules.sparesInnocent, m.name)) {
    return null;
  }
  // A roll ignored while you blink names no one (a bug fixed: 1.6 recorded the attacker first).
  if (p.flicker > 0) {
    return null;
  }
  p.lastToHitMe = `a ${m.name}`;
  p.lastToHitId = null;
  p.hitAge = 0;
  const f = fighterOf(p);
  const map = p.map;
  const shielded = onHolyShield(p, map.slots);
  const hit = monsterHitsPlayer(attack, f, p.defenseBonus, ctx.rng, shielded, p.lastToHitMe);
  const lines: string[] = [];
  const parry = skillIndex("Parry");
  const block = skillIndex("Block");
  const gainParry = () => {
    if (rollParryGain(p.char.skills[parry] ?? 0, ctx.rng)) {
      p.char.skills[parry] = (p.char.skills[parry] ?? 0) + 1;
      lines.push(advancedText("Parry"));
    }
  };
  const gainBlock = () => {
    if (rollBlockGain(p.char.skills[block] ?? 0, p.char.skills[parry] ?? 0, ctx.rng)) {
      p.char.skills[block] = (p.char.skills[block] ?? 0) + 1;
      lines.push(advancedText("Block"));
    }
  };
  p.flicker = FLICKER_FRAMES;
  p.vitalsDirty = true;
  if (hit.kind === "shield") {
    // "6:Shield", then the Parry skill gain.
    gainParry();
    return { victim: p, slot, text: "Shield", color: HIT_COLOR, splat: false, lines };
  }
  if (hit.kind === "parry" || hit.kind === "block") {
    if (hit.kind === "parry") {
      gainParry();
    } else {
      gainBlock();
    }
    return {
      victim: p,
      slot,
      text: hit.kind === "parry" ? "Parry" : "Block",
      color: DODGE_COLOR,
      splat: false,
      lines,
    };
  }
  if (hit.kind !== "hit") {
    return null;
  }
  p.char.vitals.hp = Math.max(0, p.char.vitals.hp - hit.lost);
  // The armour break roll against the last attacker; the number shown is the hit points lost.
  const lastToHitMe = p.lastToHitMe ?? "";
  const broken = rollArmourBreak(p.char.equip, statsOf(p).sta, p.char.hunger, lastToHitMe, ctx.rng);
  if (broken) {
    const field = EQUIP_FIELD[broken];
    lines.push(shattersText(p.char.equip[field]));
    const was = p.char.equip[field];
    p.char.equip[field] = damagedForm(was);
    if (ctx.world) {
      logTransform(ctx.world, p, was, p.char.equip[field], { broke: true });
    }
    p.invDirty = true;
    p.lookDirty = true;
  }
  gainParry();
  gainBlock();
  return { victim: p, slot, text: String(hit.lost), color: HIT_COLOR, splat: true, lines };
}

/** The rules' view of a player. */
export function fighterOf(p: Player): Fighter {
  const s = statsOf(p);
  return {
    level: p.char.vitals.level,
    str: s.str,
    sta: s.sta,
    int: s.int,
    wis: s.wis,
    spd: s.spd,
    skills: p.char.skills,
    equip: p.char.equip,
    faction: p.char.faction,
    attackBonus: p.attackBonus,
    wanted: p.char.wanted,
  };
}
