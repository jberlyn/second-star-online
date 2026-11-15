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
import { itemRulesData, monstersData } from "@secondstaronline/data";

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
 * The frame script's attack block: re-arm and grow the bar while the attack delay is 0, then count
 * it down. Runs before the key poll, so a held key attacks every delay + 1 frames (a
 * kept bug: a held attack re-arms one frame late).
 */
export function tickAttackTimers(t: AttackTimers): void {
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
  if (t.atDelay > 0) {
    t.atDelay -= 1;
  }
}

/**
 * The cooldowns a swing sets: 14/14, Ring of Quickness 10/10, the axe and mining cascades (the last
 * true `<` wins: 15 and 7 below skill 90), fishing 20 after the ring.
 */
export function swingCooldowns(
  equip: Equipment,
  skills: readonly number[],
): { atDelay: number; actionDelay: number } {
  let atDelay = 14;
  let actionDelay = 14;
  // `swing.cooldowns`: each matching row sets both delays, so the last one wins (Ring of
  // Quickness 10/10).
  for (const row of itemRulesData.swing.cooldowns) {
    if (ruleMatches(equip[row.slot], row)) {
      atDelay = row.atDelay;
      actionDelay = row.actionDelay;
    }
  }
  if (lingoContains(equip.weapon, "Axe")) {
    const axe = skillValue(skills, "AxeFighting");
    const cascade: [number, number][] = [
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
    for (const [lt, d] of cascade) {
      if (axe < lt) {
        atDelay = d;
      }
    }
  }
  if (lingoContains(equip.weapon, "Mining")) {
    const mining = skillValue(skills, "Mining");
    for (let i = 0; i < 9; i++) {
      if (mining < 10 * (i + 1)) {
        atDelay = 15 - i;
      }
    }
  }
  if (lingoContains(equip.weapon, "Fishing")) {
    atDelay = 20;
  }
  return { atDelay, actionDelay };
}

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
 * The monster hit test's tile check: the monster's tile is my tile or my faced tile; for a
 * footprint monster the faced tile is also tested against the five extra cells (never my own tile:
 * a kept bug, the 3x2 footprint counts only on the faced tile).
 */
export function meleeReaches(
  me: { x: number; y: number; facing: Facing },
  mon: { x: number; y: number; footprint: boolean },
): boolean {
  const [dx, dy] = FACING_DELTA[me.facing];
  const fx = me.x + dx;
  const fy = me.y + dy;
  if (mon.x === me.x && mon.y === me.y) {
    return true;
  }
  if (mon.x === fx && mon.y === fy) {
    return true;
  }
  if (mon.footprint) {
    return FOOTPRINT_CELLS.some(([cx, cy]) => mon.x + cx === fx && mon.y + cy === fy);
  }
  return false;
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

/** The parry/block ladder: `random(3000)` until the skill is over 10. */
function dodgeRoll(skill: number, factionAdventurer: boolean, rng: Rng): number {
  let n = rng.random(3000);
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
  /** `lost` comes off HP; the number shown is `monsterHitShown` after the break draws. */
  | { kind: "hit"; lost: number };

/**
 * HitMe2 from the attack value onward, for a player who is not immortal and not in i-frames: the
 * armour rows (`hitMe2` column), `+N`, faction, then `+ random(3)`, the defense bonus, `< 2 →
 * random(3)`, then the parry and block ladders. `shielded`: an innocent on a Holy Shield's exact
 * sprite position gets "Shield" after those draws.
 */
export function monsterHitsPlayer(
  attack: number,
  f: Fighter,
  defenseBonus: number,
  rng: Rng,
  shielded = false,
): MonsterHit {
  const r = monsterDodge(attack, f, defenseBonus, rng);
  return shielded ? { kind: "shield" } : r;
}

function monsterDodge(attack: number, f: Fighter, defenseBonus: number, rng: Rng): MonsterHit {
  let power = armourRows(attack, f.equip, "HitMe2");
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

/**
 * The number a monster hit shows: after the HP loss and the armour break draws, the
 * elemental rows against `LastToHitMe` ("a Yeti"), then `< 1 → random(3)` (a kept bug: elemental
 * armour against monsters is applied after the HP loss).
 */
export function monsterHitShown(
  lost: number,
  equip: Equipment,
  lastToHitMe: string,
  rng: Rng,
): number {
  let shown = elementalRows(lost, equip, "HitMe2", lastToHitMe);
  if (shown < 1) {
    shown = rng.random(3);
  }
  return shown;
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
