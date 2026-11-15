/**
 * Monster attacks on players (formula `mitigation.pve`). The original rolled once per frame per
 * visible monster on each client against that client's own player; the server rolls once per
 * (monster, player) per tick, so each player's hazard is the original's.
 */
import { monstersData } from "@secondstaronline/data";
import {
  advancedText,
  anyMatch,
  damagedForm,
  EQUIP_FIELD,
  type Fighter,
  FLICKER_FRAMES,
  monsterHitShown,
  monsterHitsPlayer,
  monsterReaches,
  type Rng,
  rollArmourBreak,
  rollBlockGain,
  rollParryGain,
  shattersText,
  skillIndex,
} from "@secondstaronline/shared";

import { onHolyShield } from "../spells/geometry.ts";
import type { Player, WorldMap } from "../world/world.ts";
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
  /** Skill-gain lines for the victim. */
  lines: string[];
}

/** The attack table value: a name with no entry hits for 35, as in 1.6. */
export function monsterAttackValue(name: string): number {
  return species(name)?.attack ?? 35;
}

export interface MonsterAttackCtx {
  rng: Rng;
  /** The NPC files (`FLG|Passive`). */
  npcs: NpcStore;
  /** True when the victim is an immortal. */
  immortal(p: Player): boolean;
  /** Frames per player step: where the victim's sprite is for the Holy Shield test. */
}

/**
 * One monster's attack block for one victim. Returns the outcome when the monster acted, and
 * `stall` when a Passive monster's roll left its `stepFrame` early (the walk tick is skipped).
 */
export function monsterAttack(
  map: WorldMap,
  slot: MonsterSlot,
  p: Player,
  ctx: MonsterAttackCtx,
): { outcome: AttackOutcome | null; stall: boolean } {
  const m = slot.live;
  const none = { outcome: null, stall: false };
  if (!m || p.loading > 0 || p.deadLock > 0) {
    return none;
  }
  const sp = species(m.name);
  // Officers also fight a wanted player on a no-fight map.
  const canFight =
    map.flags.canFight === "X" || (anyMatch(monstersData.rules.officer, m.name) && p.char.wanted);
  // Webs never attack (body 92).
  if (p.dontHitMeAgain || !canFight || sp?.body === 92) {
    return none;
  }
  if (ctx.rng.random(10) !== 1) {
    return none;
  }
  if (hasFlag(ctx.npcs, m.name, "Passive") && !p.npcAttackFlag) {
    return { outcome: null, stall: true };
  }
  // A monster never melees an Airship rider, after the `random(10)` draw and the Passive gate, so
  // the RNG order is unchanged.
  if (p.vehicle) {
    return none;
  }
  if (p.deathPause >= 1) {
    return none;
  }
  if (!monsterReaches({ x: m.x, y: m.y, footprint: isFootprint(m.name) }, p)) {
    return none;
  }
  return { outcome: hitMe2(slot, p, ctx), stall: false };
}

/** The monster's hit on a player. */
function hitMe2(slot: MonsterSlot, p: Player, ctx: MonsterAttackCtx): AttackOutcome | null {
  const m = slot.live as NonNullable<MonsterSlot["live"]>;
  if (ctx.immortal(p)) {
    return null; // 1.6's player-versus-player hit ignores immortals; only the monster hit checks
  }
  // Holy Shield never hits an innocent.
  if (!p.char.wanted && anyMatch(monstersData.rules.sparesInnocent, m.name)) {
    return null;
  }
  p.lastToHitMe = `a ${m.name}`; // before the i-frame test
  p.lastToHitId = null;
  if (p.flicker > 0) {
    return null;
  }
  const f = fighterOf(p);
  const map = p.map;
  const shielded = onHolyShield(p, map.slots);
  const hit = monsterHitsPlayer(monsterAttackValue(m.name), f, p.defenseBonus, ctx.rng, shielded);
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
    return { victim: p, slot, text: "Shield", color: HIT_COLOR, lines };
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
      lines,
    };
  }
  if (hit.kind !== "hit") {
    return null;
  }
  p.char.vitals.hp = Math.max(0, p.char.vitals.hp - hit.lost);
  // The armour break roll against the last attacker comes between the HP loss and the shown number.
  const lastToHitMe = p.lastToHitMe ?? "";
  const broken = rollArmourBreak(
    p.char.equip,
    p.char.stats.sta,
    p.char.hunger,
    lastToHitMe,
    ctx.rng,
  );
  if (broken) {
    const field = EQUIP_FIELD[broken];
    lines.push(shattersText(p.char.equip[field]));
    p.char.equip[field] = damagedForm(p.char.equip[field]);
    p.invDirty = true;
    p.lookDirty = true;
  }
  const shown = monsterHitShown(hit.lost, p.char.equip, lastToHitMe, ctx.rng);
  gainParry();
  gainBlock();
  return { victim: p, slot, text: String(shown), color: HIT_COLOR, lines };
}

/** The rules' view of a player. */
export function fighterOf(p: Player): Fighter {
  const s = p.char.stats;
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
