/**
 * Kill XP, level-up, regen, hunger and the death penalty. Pure functions over plain state.
 */
import { monstersData } from "@secondstaronline/data";

import { lingoEq, type Rng } from "../core/lingo.ts";
import { firstMatch } from "../core/patterns.ts";

/**
 * Melee kill XP before the level is taken off: the species' table value, Ring of Experience +5 (Cow
 * and Holy Shield set to 5 after it), `Regged` (always 1) +10, then +10 for each of > 100 … > 400,
 * tested on the growing value.
 */
export function meleeKillXp(base: number, monsterName: string, ring: string): number {
  let xp = base;
  if (lingoEq(ring, "Ring of Experience")) {
    xp += 5;
  }
  const override = firstMatch(monstersData.rules.killXp, monsterName);
  if (override) {
    xp = override.xp;
  }
  xp += 10;
  for (const t of [100, 150, 200, 250, 300, 350, 400]) {
    if (xp > t) {
      xp += 10;
    }
  }
  return xp;
}

/** What a kill adds: `max(0, XP − level)`. */
export function xpGained(killXp: number, level: number): number {
  return Math.max(0, killXp - level);
}

export interface Vitals {
  level: number;
  hp: number;
  hpMax: number;
  sp: number;
  spMax: number;
  exp: number;
  expNeeded: number;
}

/** The level-up line. */
export const LEVEL_UP_TEXT = "You have become more powerful!";

/**
 * The original's level check after a kill, after the XP is added: at most one level, the overflow
 * is lost, HPmax and SPmax +1, no heal. Returns true on a level-up.
 */
export function checkLevelUp(v: Vitals): boolean {
  if (v.exp < v.expNeeded) {
    return false;
  }
  v.exp = 0;
  v.level += 1;
  v.expNeeded = v.level === 2 ? 400 : 400 + v.level + v.level;
  v.hpMax += 1;
  v.spMax += 1;
  return true;
}

// ---- regen -----------------------------------------------------------------------------

/**
 * The regen target `60 − speed + speed increase`: 90, less 5·(Adventurer bonus + 1) for an Adventurer with
 * Adventurer bonus 0..9.
 */
export function regenTarget(speed: number, adventurerBonus: number | null): number {
  let inc = 90;
  if (adventurerBonus !== null && adventurerBonus >= 0 && adventurerBonus <= 9) {
    inc -= 5 * (adventurerBonus + 1);
  }
  return 60 - speed + inc;
}

/**
 * One frame of the regen timer. The counter starts at 1 at login, is raised first, and acts only on
 * exact equality with the target, so with speed 1 regen fires every 148 frames. For 50 ≤ Hunger ≤
 * 500 nothing resets it and regen stalls until the next login (a kept bug: 1.6 did this). Mutates
 * `v` and returns the new counter.
 */
export function regenTick(counter: number, target: number, hunger: number, v: Vitals): number {
  const c = counter + 1;
  if (c !== target) {
    return c;
  }
  let next = c;
  if (hunger > 500) {
    v.hp = Math.min(v.hp + 1, v.hpMax);
    v.sp = Math.min(v.sp + 1, v.spMax);
    next = 1;
  }
  if (hunger < 50) {
    if (v.hp > 1) {
      v.hp -= 1;
    }
    if (v.sp > 1) {
      v.sp -= 1;
    }
    next = 1;
  }
  return next;
}

// ---- hunger ----------------------------------------------------------------------------

/** The original's hunger-check texts at exact values. */
export const HUNGER_WARNINGS: Readonly<Record<number, string>> = {
  1500: "You are very hungry.",
  1000: "You are extremely hungry, you need to eat.",
  500: "You are starving!",
};

/**
 * One frame of hunger: unless immortal, `random(3) = 1` and Hunger > 0 takes 1; below 2000 the
 * exact-value warnings print, every frame Hunger sits on the value (a kept bug: 1.6 repeated them).
 */
export function hungerTick(
  hunger: number,
  immortal: boolean,
  rng: Rng,
): { hunger: number; warning: string | null } {
  if (immortal) {
    return { hunger, warning: null };
  }
  let h = hunger;
  if (rng.random(3) === 1 && h > 0) {
    h -= 1;
  }
  const warning = h < 2000 ? (HUNGER_WARNINGS[h] ?? null) : null;
  return { hunger: h, warning };
}

/** Hunger after a death. */
export const DEATH_HUNGER = 40000;

// ---- death -----------------------------------------------------------------------------

export const DEATH_PENALTY_TEXT = "*** Your downfall in battle has caused you to become weakened.";

/**
 * The forced death penalty: `DeathPenalty = "X"` is forced, so every non-arena death rolls
 * `random(5) = 1` (wanted: `random(1)`) for HPmax −1 and SPmax −1, each only if above 2. Returns
 * true when the penalty text prints.
 */
export function rollDeathPenalty(v: Vitals, wanted: boolean, rng: Rng): boolean {
  if (rng.random(wanted ? 1 : 5) !== 1) {
    return false;
  }
  if (v.hpMax > 2) {
    v.hpMax -= 1;
  }
  if (v.spMax > 2) {
    v.spMax -= 1;
  }
  return true;
}

/** HP and SP after a death. */
export function deathVitals(v: Vitals): void {
  v.hp = 1;
  if (v.spMax > 0) {
    v.sp = 1;
  }
}

/** The death message, sent to everyone and shown in colour 8. */
export function deathText(name: string, killer: string | null): string {
  return killer ? `*** ${name} was just killed by ${killer}.` : `${name} was just killed.`;
}

/**
 * The 80-tick busy-wait at 60 ticks a second, as frames: the dead player's intents are ignored for
 * this long.
 */
export const DEATH_LOCK_FRAMES = 27;

/** The death pause, 90 frames: no monster rolls against you for 90 frames. */
export const DEATH_PAUSE_FRAMES = 90;
