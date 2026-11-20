/**
 * Melee timers, the power bar, hit tests and damage. Pure functions over plain state; the server
 * sim calls them in the original frame order.
 *
 * Implements the original's routines:
 * - The attack handler: gates, cooldowns, bar bonus.
 * - The frame script's bar and re-arm; the shared action delay.
 * - The monster hit test: own tile, faced tile, 3x2 footprint, damage.
 * - The monster reach test; HitMe2; the parry and block gains; the hit flicker.
 */
import { gatherData, itemRulesData, monstersData } from "@secondstaronline/data";

import { type Equipment, type Fighter, skillValue } from "../core/fighter.ts";
import { lingoContains, lingoEq, type Rng } from "../core/lingo.ts";
import { ruleMatches } from "../core/patterns.ts";
import { FACING_DELTA, type Facing } from "../movement/movement.ts";
import { armourRows, elementalRows, factionRows, randomAndDefense } from "./armour.ts";

/** Power-bar sprite 63 members (Internal #473, #472, #474, #475). */
export type BarMember = 473 | 472 | 474 | 475;

export interface AttackTimers {
  /** The attack delay: frames until the attack re-arms. */
  atDelay: number;
  /** The action delay: shared melee/cast lock. */
  actionDelay: number;
  /** The can-attack flag: set when the attack delay is 0 at the top of a frame. */
  canAttack: boolean;
  /** The power-up bar, 0..100. */
  bar: number;
  /** The member sprite 63 shows; the attack handler reads it, not the value. */
  barMember: BarMember;
  /** The attack counter (Argon's Fist, Purple Potion): the bar grows 2 per frame. */
  attackCounter: number;
  /** Your own sprite's attack counter: frames of attack animation; no step starts while > 0. */
  atkAnim: number;
}

export function newAttackTimers(): AttackTimers {
  return {
    atDelay: 0,
    actionDelay: 0,
    canAttack: false,
    bar: 0,
    barMember: 473,
    attackCounter: 0,
    atkAnim: 0,
  };
}

/** The bar member for a value, if the value lands in one of the 4-wide windows. */
export function barMemberFor(bar: number): BarMember | null {
  if (bar >= 0 && bar <= 3) {
    return 473;
  }
  if (bar >= 25 && bar <= 28) {
    return 472;
  }
  if (bar >= 50 && bar <= 53) {
    return 474;
  }
  if (bar >= 75 && bar <= 78) {
    return 475;
  }
  return null;
}

/** The attack bonus from the bar member: +0, +3, +5, +7. */
export function barBonus(m: BarMember): number {
  return m === 472 ? 3 : m === 474 ? 5 : m === 475 ? 7 : 0;
}

/**
 * A press is kept this many ticks before the player re-arms, so a tap that arrives slightly early
 * is not lost (SSO's own rule, a divergence: 1.6 polled the key).
 */
export const ATTACK_LATCH_TICKS = 2;

/** Frames the attack animation runs. No step starts while it runs. */
export const ATTACK_ANIM_FRAMES = 5;

/**
 * The player sprite's per-frame countdowns. Runs before the frame script, so a lock set at frame t
 * first counts down at t+1.
 */
export function tickSpriteTimers(t: AttackTimers): void {
  if (t.actionDelay > 0) {
    t.actionDelay -= 1;
  }
  if (t.atkAnim > 0) {
    t.atkAnim -= 1;
  }
}

/**
 * The frame script's attack block: count the attack delay down, then re-arm and grow the bar while
 * it is 0. Counting down first lets a held key swing every `atDelay` frames, as the cooldown says
 * (a bug fixed: 1.6 re-armed before the countdown, one frame late).
 */
export function tickAttackTimers(t: AttackTimers): void {
  if (t.atDelay > 0) {
    t.atDelay -= 1;
  }
  if (t.atDelay === 0) {
    t.canAttack = true;
    if (t.bar < 100) {
      if (t.attackCounter > 0) {
        t.bar += 1;
      }
      t.bar += 1;
      t.barMember = barMemberFor(t.bar) ?? t.barMember;
    }
  }
}

/** The axe ladder: the first step whose skill bound is above your Axe Fighting sets the delay. */
const AXE_LADDER: readonly (readonly [number, number])[] = [
  [10, 25],
  [20, 22],
  [30, 21],
  [40, 20],
  [50, 19],
  [60, 18],
  [70, 17],
  [80, 16],
  [90, 15],
];

/** The Mining Hammer ladder: 15 below Mining 10, one frame faster per 10 skill, 7 from 80 on. */
const MINING_LADDER: readonly (readonly [number, number])[] = [
  [10, 15],
  [20, 14],
  [30, 13],
  [40, 12],
  [50, 11],
  [60, 10],
  [70, 9],
  [80, 8],
  [Number.POSITIVE_INFINITY, 7],
];

/** The first ladder step whose bound is above `skill`, or null when none is. */
function ladderStep(ladder: readonly (readonly [number, number])[], skill: number): number | null {
  return ladder.find(([lt]) => skill < lt)?.[1] ?? null;
}

/**
 * The cooldowns a swing sets: 14/14, Ring of Quickness 10/10. An axe below Axe Fighting 90 and a
 * Mining Hammer use their skill ladders, the lowest matching step winning (bugs fixed: 1.6 let the
 * last step win, so every skill below 90 got 15 for an axe and 7 for a hammer, and a hammer at 90+
 * fell back to 14). A Fishing Pole waits 20, less the Ring of Quickness's speed-up (a bug fixed: 1.6
 * set 20 after the ring and so ignored it).
 */
export function swingCooldowns(
  equip: Equipment,
  skills: readonly number[],
): { atDelay: number; actionDelay: number } {
  const BASE = 14;
  let atDelay = BASE;
  let actionDelay = BASE;
  // `swing.cooldowns`: each matching row sets both delays, so the last one wins (Ring of
  // Quickness 10/10).
  for (const row of itemRulesData.swing.cooldowns) {
    if (ruleMatches(equip[row.slot], row)) {
      atDelay = row.atDelay;
      actionDelay = row.actionDelay;
    }
  }
  const quickness = BASE - atDelay;
  if (lingoContains(equip.weapon, "Axe")) {
    atDelay = ladderStep(AXE_LADDER, skillValue(skills, "AxeFighting")) ?? atDelay;
  }
  if (lingoContains(equip.weapon, "Mining")) {
    atDelay = ladderStep(MINING_LADDER, skillValue(skills, "Mining")) ?? atDelay;
  }
  if (lingoContains(equip.weapon, "Fishing")) {
    atDelay = FISHING_POLE_AT_DELAY - quickness;
  }
  return { atDelay, actionDelay };
}

/** A Fishing Pole's attack delay without the Ring of Quickness. */
const FISHING_POLE_AT_DELAY = gatherData.gathering.fishing.atDelay;

/**
 * The attack handler's early gates. The frame-number gates always pass in play, and the Airship's refusal
 * is the server's `workAttack`. `itemActionPause` and `canModify` come from the bow lock and
 * dialogs.
 */
export function swingBlocked(t: AttackTimers, itemActionPause = 0, canModify = true): boolean {
  return t.atDelay > 0 || t.actionDelay > 0 || itemActionPause > 0 || !canModify;
}

/**
 * Starts a swing: reads the bar bonus, resets the bar value (not its member) and sets the
 * cooldowns. Returns the bonus.
 */
export function startSwing(t: AttackTimers, equip: Equipment, skills: readonly number[]): number {
  const bonus = barBonus(t.barMember);
  t.bar = 0;
  const cd = swingCooldowns(equip, skills);
  t.atDelay = cd.atDelay;
  t.actionDelay = cd.actionDelay;
  return bonus;
}

// ---- hitting monsters ------------------------------------------------------------------

/** Overlord and Mutant Worm: anchor plus (+1,0), (+2,0), (0,-1), (+1,-1), (+2,-1). */
export const FOOTPRINT_CELLS: readonly (readonly [number, number])[] = [
  [1, 0],
  [2, 0],
  [0, -1],
  [1, -1],
  [2, -1],
];

/**
 * The monster hit test's tile check: any tile of the monster (its main tile, plus the five extra
 * cells of a footprint monster) is my tile or my faced tile (a bug fixed: 1.6 tested the extra
 * cells against the faced tile only).
 */
export function meleeReaches(
  me: { x: number; y: number; facing: Facing },
  mon: { x: number; y: number; footprint: boolean },
): boolean {
  const [dx, dy] = FACING_DELTA[me.facing];
  const fx = me.x + dx;
  const fy = me.y + dy;
  const cells: readonly (readonly [number, number])[] = mon.footprint
    ? [[0, 0], ...FOOTPRINT_CELLS]
    : [[0, 0]];
  return cells.some(([cx, cy]) => {
    const x = mon.x + cx;
    const y = mon.y + cy;
    return (x === me.x && y === me.y) || (x === fx && y === fy);
  });
}

/**
 * Melee damage to a monster (formula `attpower.vsMonster`): attack power − Defense, then every
 * matching affinity row in source order, then `< 1 → random(3)`.
 */
export function meleeDamageVsMonster(
  attPower: number,
  monster: { name: string; defense: number },
  weapon: string,
  rng: Rng,
): number {
  let dmg = attPower - monster.defense;
  for (const a of monstersData.meleeAffinities) {
    if (!lingoContains(weapon, a.weapon)) {
      continue;
    }
    const hit =
      a.monsterMatch === "exact"
        ? lingoEq(monster.name, a.monster)
        : lingoContains(monster.name, a.monster);
    if (hit) {
      dmg += a.delta;
      if (a.deltaRandom) {
        dmg += rng.random(Number(/\d+/.exec(a.deltaRandom)?.[0]));
      }
    }
  }
  if (dmg < 1) {
    dmg = rng.random(3);
  }
  return dmg;
}

// ---- monsters hitting players ----------------------------------------------------------

/**
 * The monster reach test: the monster (or any footprint cell) is on my tile or orthogonally next to it. Both tiles
 * are logical tiles, which change at the start of a step.
 */
export function monsterReaches(
  mon: { x: number; y: number; footprint: boolean },
  me: { x: number; y: number },
): boolean {
  const cells: (readonly [number, number])[] = [[0, 0]];
  if (mon.footprint) {
    cells.push([1, 0], [2, 0], [0, -1], [1, -1], [2, -1]);
  }
  return cells.some(([cx, cy]) => {
    const x = mon.x + cx;
    const y = mon.y + cy;
    return (
      (x === me.x && y === me.y) ||
      (x === me.x + 1 && y === me.y) ||
      (x === me.x - 1 && y === me.y) ||
      (x === me.x && y === me.y + 1) ||
      (x === me.x && y === me.y - 1)
    );
  });
}

/**
 * The parry/block ladder: `random(90)` until the skill is over 20, as against players (a bug fixed:
 * 1.6 drew `random(3000)` until the skill was over 10, so a new character almost never parried).
 */
function dodgeRoll(skill: number, factionAdventurer: boolean, rng: Rng): number {
  let n = rng.random(90);
  const ladder: [number, number][] = [
    [10, 90],
    [20, 85],
    [30, 80],
    [40, 70],
    [50, 60],
    [60, 50],
    [70, 40],
    [80, 35],
    [90, 31],
    [96, 24],
  ];
  for (const [gt, r] of ladder) {
    if (skill > gt) {
      n = rng.random(r);
    }
  }
  if (factionAdventurer) {
    n -= 10;
  }
  if (n < 1) {
    n = 1;
  }
  return n;
}

export type MonsterHit =
  | { kind: "none" }
  | { kind: "parry" | "block" | "shield" }
  /** `lost` comes off HP, and is the number shown. */
  | { kind: "hit"; lost: number };

/**
 * HitMe2 from the attack value onward, for a player who is not invulnerable and not in i-frames: the
 * armour rows (`hitMe2` column), `+N`, the elemental rows against `attacker` ("a Yeti"), faction,
 * then `+ random(3)`, the defense bonus, `< 2 → random(3)`, then the parry and block ladders.
 * `shielded`: an innocent on a Holy Shield's exact sprite position gets "Shield" before any draw
 * (a bug fixed: 1.6 rolled the parry and block dice first and threw them away). The elemental rows
 * change the hit points lost, not only the number shown (a bug fixed: 1.6 applied them after the
 * hit point loss).
 */
export function monsterHitsPlayer(
  attack: number,
  f: Fighter,
  defenseBonus: number,
  rng: Rng,
  shielded = false,
  attacker = "",
): MonsterHit {
  if (shielded) {
    return { kind: "shield" };
  }
  let power = armourRows(attack, f.equip, "HitMe2");
  power = elementalRows(power, f.equip, "HitMe2", attacker);
  power = factionRows(power, f);
  power = randomAndDefense(power, defenseBonus, rng);
  const adventurer = f.faction.id === 3;
  if (dodgeRoll(skillValue(f.skills, "Parry"), adventurer, rng) === 1) {
    return { kind: "parry" };
  }
  if (dodgeRoll(skillValue(f.skills, "Block"), adventurer, rng) === 1) {
    return { kind: "block" };
  }
  return { kind: "hit", lost: power };
}

/** The parry gain: `random(Parry) = 1` and 0 < Parry < 100. */
export function rollParryGain(parry: number, rng: Rng): boolean {
  return rng.random(parry) === 1 && parry < 100 && parry > 0;
}

/** The block gain: also needs Parry > 50. */
export function rollBlockGain(block: number, parry: number, rng: Rng): boolean {
  return rng.random(block) === 1 && block < 100 && block > 0 && parry > 50;
}

/** The hit flicker: 40 frames of i-frames. */
export const FLICKER_FRAMES = 40;
