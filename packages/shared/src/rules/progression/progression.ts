/**
 * Kill XP, level-up, regen, hunger and the death penalty. Pure functions over plain state.
 */
import { content } from "../../content/store.ts";
import { gearBonus } from "../combat/gear.ts";
import type { Equipment } from "../core/fighter.ts";
import type { Rng } from "../core/lingo.ts";
import { firstMatch } from "../core/patterns.ts";

/**
 * Melee kill XP before the level is taken off: the species' table value, plus the worn gear's
 * `killXp` (`item-rules.json` `gear`; Classic: the Ring of Experience's 5), the `killXp`
 * overrides after it (Cow and Holy Shield set to 5), `Regged` (always 1) +10, then +10 for each of
 * > 100 … > 400, tested on the growing value.
 */
export function meleeKillXp(base: number, monsterName: string, equip: Equipment): number {
  let xp = base + gearBonus(equip, "killXp");
  const override = firstMatch(content().monsters.rules.killXp, monsterName);
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
 * The level check after a kill, after the XP is added: one level for each `expNeeded` the XP
 * reaches, carrying what is left over, with HPmax and SPmax +1 each; no heal. Returns the number of
 * levels gained (a bug fixed: 1.6 reset the XP to 0 and gained at most one level a kill).
 */
export function checkLevelUp(v: Vitals): number {
  let levels = 0;
  while (v.exp >= v.expNeeded && v.expNeeded > 0) {
    v.exp -= v.expNeeded;
    v.level += 1;
    v.expNeeded = v.level === 2 ? 400 : 400 + v.level + v.level;
    v.hpMax += 1;
    v.spMax += 1;
    levels += 1;
  }
  return levels;
}

// ---- regen -----------------------------------------------------------------------------

/**
 * The regen target `60 − speed + speed increase`: 90, less the faction perk `regeneration` (Classic:
 * an Adventurer's 5·(tier + 1)). Speed is always 1 (1.6 stored a Speed stat that nothing could
 * raise; SSO dropped it), so the target is 149, or 144 down to 99 for an Adventurer.
 */
export function regenTarget(regeneration: number): number {
  const speed = 1;
  const inc = 90 - regeneration;
  return 60 - speed + inc;
}

/**
 * One frame of the regen timer. The counter starts at 1 at login and is raised first; when it
 * reaches the target it acts and starts again from 1, so at the usual target of 149 regen fires every 148 frames.
 * Hunger above 500 regenerates 1 HP and SP, below 50 starves 1 of each (floor 1), and in between the
 * period passes with no change (a bug fixed: 1.6 reset the counter only on a regen or a starve and
 * tested for exact equality, so it stalled until the next login). Mutates `v` and returns the new
 * counter.
 */
export function regenTick(counter: number, target: number, hunger: number, v: Vitals): number {
  const c = counter + 1;
  if (c < target) {
    return c;
  }
  if (hunger > 500) {
    v.hp = Math.min(v.hp + 1, v.hpMax);
    v.sp = Math.min(v.sp + 1, v.spMax);
  }
  if (hunger < 50) {
    if (v.hp > 1) {
      v.hp -= 1;
    }
    if (v.sp > 1) {
      v.sp -= 1;
    }
  }
  return 1;
}

// ---- hunger ----------------------------------------------------------------------------

/** The original's hunger-check texts at exact values. */
export const HUNGER_WARNINGS: Readonly<Record<number, string>> = {
  1500: "You are very hungry.",
  1000: "You are extremely hungry, you need to eat.",
  500: "You are starving!",
};

/**
 * One frame of hunger: unless the role never gets hungry (1.6: an immortal), `random(3) = 1` and Hunger > 0 takes 1; a warning prints on
 * the frame Hunger drops onto its value (a bug fixed: 1.6 printed it on every frame Hunger sat on
 * the value, about three times).
 */
export function hungerTick(
  hunger: number,
  noHunger: boolean,
  rng: Rng,
): { hunger: number; warning: string | null } {
  if (noHunger) {
    return { hunger, warning: null };
  }
  let h = hunger;
  if (rng.random(3) === 1 && h > 0) {
    h -= 1;
  }
  const warning = h !== hunger && h < 2000 ? (HUNGER_WARNINGS[h] ?? null) : null;
  return { hunger: h, warning };
}

/** Hunger after a death. */
export const DEATH_HUNGER = 40000;

// ---- death -----------------------------------------------------------------------------

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
