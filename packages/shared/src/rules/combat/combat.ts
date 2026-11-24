/**
 * Melee timers, hit tests and damage. Pure functions over plain state; the server sim calls them in
 * the original frame order.
 *
 * Implements the original's routines:
 * - The attack handler: gates and cooldowns. SSO has no power bar (a deliberate difference: 1.6's
 *   bar added +3/+5/+7 to a swing left idle long enough; see docs/differences-from-fso.md).
 * - The frame script's re-arm; the shared action delay.
 * - The monster hit test: own tile, faced tile, 3x2 footprint, damage.
 * - The monster reach test; HitMe2; the parry and block gains; the hit flicker.
 */

import { content } from "../../content/store.ts";
import {
  boundSkillIndex,
  boundSkillValue,
  type Equipment,
  type Fighter,
  findSkillIndex,
} from "../core/fighter.ts";
import { lingoContains, lingoEq, type Rng } from "../core/lingo.ts";
import { ruleMatches } from "../core/patterns.ts";
import { FACING_DELTA, type Facing } from "../movement/movement.ts";
import { factionPerk } from "../social/factions.ts";
import { armourRows, elementalRows, factionRows, randomAndDefense } from "./armour.ts";

export interface AttackTimers {
  /** The attack delay: frames until the attack re-arms. */
  atDelay: number;
  /** The action delay: shared melee/cast lock. */
  actionDelay: number;
  /** The can-attack flag: set when the attack delay is 0 at the top of a frame. */
  canAttack: boolean;
  /** The attack counter: frames left of Argon's Fist or a Purple Potion (`attackBonus`). */
  attackCounter: number;
  /** Your own sprite's attack counter: frames of attack animation; no step starts while > 0. */
  atkAnim: number;
}

export function newAttackTimers(): AttackTimers {
  return {
    atDelay: 0,
    actionDelay: 0,
    canAttack: false,
    attackCounter: 0,
    atkAnim: 0,
  };
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
 * The frame script's attack block: count the attack delay down, then re-arm while it is 0.
 * Counting down first lets a held key swing every `atDelay` frames, as the cooldown says (a bug
 * fixed: 1.6 re-armed before the countdown, one frame late). 1.6 also grew the power bar here; SSO
 * has none.
 */
export function tickAttackTimers(t: AttackTimers): void {
  if (t.atDelay > 0) {
    t.atDelay -= 1;
  }
  if (t.atDelay === 0) {
    t.canAttack = true;
  }
}

/**
 * A ladder's step for a skill: the first step whose `below` is above it (or that has no `below`), or
 * null when none is.
 */
function ladderStep(
  steps: readonly { below?: number | undefined; delay: number }[],
  skill: number,
): number | null {
  return steps.find((st) => st.below === undefined || skill < st.below)?.delay ?? null;
}

/**
 * The cooldowns a swing sets: 14/14, Ring of Quickness 10/10. A weapon with a swing ladder takes
 * the attack delay from it (Classic: an axe below Axe Fighting 90 and a Mining Hammer by their skill,
 * the lowest matching step winning — bugs fixed: 1.6 let the last step win, so every skill below 90
 * got 15 for an axe and 7 for a hammer, and a hammer at 90+ fell back to 14; a Fishing Pole waits
 * 20, less the Ring of Quickness's speed-up — a bug fixed: 1.6 set 20 after the ring and so ignored
 * it).
 */
export function swingCooldowns(
  equip: Equipment,
  skills: readonly number[],
): { atDelay: number; actionDelay: number } {
  const BASE = content().balance.timings.swingBaseFrames;
  let atDelay = BASE;
  let actionDelay = BASE;
  // `swing.cooldowns`: each matching row sets both delays, so the last one wins (Ring of
  // Quickness 10/10).
  for (const row of content().itemRules.swing.cooldowns) {
    if (ruleMatches(equip[row.slot], row)) {
      atDelay = row.atDelay;
      actionDelay = row.actionDelay;
    }
  }
  // Gear's speed-up, never a slow-down (a swing base below the gear's delay gives none).
  const quickness = Math.max(0, BASE - atDelay);
  // The weapon's swing ladder (`item-rules.json` `tools`, last match with a `ladder`): an Axe's by
  // Axe Fighting, a Mining Hammer's by Mining, a Fishing Pole's flat 20 less the gear's speed-up. A
  // ladder whose skill the world does not have is off: the delay stays as the gear set it.
  let ladder: string | undefined;
  for (const row of content().itemRules.tools) {
    if (row.ladder !== undefined && ruleMatches(equip.weapon, row)) {
      ladder = row.ladder;
    }
  }
  const ladders = content().itemRules.ladders;
  const l = ladder !== undefined && Object.hasOwn(ladders, ladder) ? ladders[ladder] : undefined;
  const at = l?.skill === undefined ? undefined : findSkillIndex(l.skill);
  if (l && (l.skill === undefined || at !== undefined)) {
    const step = ladderStep(l.steps, at === undefined ? 0 : (skills[at] ?? 0));
    if (step !== null) {
      // A step less the gear's speed-up never drops below 1, or the attack would never rearm.
      atDelay = Math.max(1, l.gearSpeedUp ? step - quickness : step);
    }
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

/** Starts a swing: sets the cooldowns. 1.6 also read and reset its power bar here. */
export function startSwing(t: AttackTimers, equip: Equipment, skills: readonly number[]): void {
  const cd = swingCooldowns(equip, skills);
  t.atDelay = cd.atDelay;
  t.actionDelay = cd.actionDelay;
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
  for (const a of content().monsters.meleeAffinities) {
    if (!lingoContains(weapon, a.weapon)) {
      continue;
    }
    const hit =
      a.monsterMatch === "exact"
        ? lingoEq(monster.name, a.monster)
        : lingoContains(monster.name, a.monster);
    if (hit) {
      dmg += a.delta;
      if (a.randomN > 0) {
        dmg += rng.random(a.randomN);
      }
    }
  }
  const floor = content().balance.combat.meleeFloor;
  if (dmg < floor.below) {
    dmg = rng.random(floor.randomN);
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
function dodgeRoll(skill: number, bonus: number, rng: Rng): number {
  let n = rng.random(content().balance.combat.dodgeBaseRandomN);
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
  n -= bonus;
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
  // The perk `monsterDodge` lowers both rolls (Classic: an Adventurer's 10).
  const dodge = factionPerk(f.faction, "monsterDodge");
  // A world that binds no Parry (or Block) skill has no parrying (or blocking): no roll at all.
  const parry = boundSkillIndex("parry");
  if (parry !== undefined && dodgeRoll(f.skills[parry] ?? 0, dodge, rng) === 1) {
    return { kind: "parry" };
  }
  const block = boundSkillIndex("block");
  if (block !== undefined && dodgeRoll(f.skills[block] ?? 0, dodge, rng) === 1) {
    return { kind: "block" };
  }
  return { kind: "hit", lost: power };
}

/** The hit flicker's i-frames (`balance.timings.flickerFrames`; Classic 40). */
export function flickerFrames(): number {
  return content().balance.timings.flickerFrames;
}
