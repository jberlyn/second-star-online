/**
 * Kill XP, level-up, regen, hunger and the death penalty. Pure functions over plain state.
 */
import type { BalanceLevels, Monster } from "@secondstaronline/data";

import { content } from "../../content/store.ts";
import { gearBonus } from "../combat/gear.ts";
import type { Equipment } from "../core/fighter.ts";
import type { Rng } from "../core/lingo.ts";
import { firstMatch } from "../core/patterns.ts";

/**
 * A species' base kill XP for the kind of kill (`xpMelee` or `xpSpell`). A species that sets
 * neither works it out from its level (the balance row `killXp.fromLevel`), and a name with no
 * species gives `killXp.noSpecies` (1.6: 30).
 */
export function speciesKillXp(sp: Monster | null | undefined, kind: "melee" | "spell"): number {
  const k = content().balance.killXp;
  if (!sp) {
    return k.noSpecies;
  }
  const own = kind === "melee" ? sp.xpMelee : sp.xpSpell;
  return own ?? k.fromLevel.flat + k.fromLevel.perLevel * (sp.level ?? 0);
}

/**
 * Kill XP before the levels adjust it (the balance row `killXp`): the base (`speciesKillXp`), plus
 * the worn gear's `killXp` (`item-rules.json` `gear`; Classic: the Ring of Experience's 5), the
 * monster's fixed kill XP in its place (`rules.killXp`; Classic: Cow and Holy Shield, 5), plus
 * `bonus` (1.6's `Regged`, always 10), then `thresholdBonus` for each of `thresholds` the value
 * is above, tested on the growing value (1.6: +10 for each of > 100 … > 400). Used for melee and
 * spell kills alike.
 */
export function meleeKillXp(base: number, monsterName: string, equip: Equipment): number {
  const k = content().balance.killXp;
  let xp = base + gearBonus(equip, "killXp");
  const override = firstMatch(content().monsters.rules.killXp, monsterName);
  if (override) {
    xp = override.xp;
  }
  xp += k.bonus;
  for (const t of k.thresholds) {
    if (xp > t) {
      xp += k.thresholdBonus;
    }
  }
  return xp;
}

/**
 * What a kill adds, by the balance row `killXp.adjust`: `minusLevel` `max(0, XP − level)` (1.6),
 * `none` the XP whatever the level, `levelDifference` the XP scaled by the monster's level against
 * the killer's (a monster with no level counts as the killer's level): `belowPercent` less for
 * each level it is below, `abovePercent` more for each level above, between 0 and `maxPercent`
 * percent, rounded down.
 */
export function xpGained(killXp: number, level: number, monsterLevel?: number): number {
  const k = content().balance.killXp;
  switch (k.adjust) {
    case "none":
      return Math.max(0, killXp);
    case "levelDifference": {
      const d = (monsterLevel ?? level) - level;
      const pct = 100 + (d >= 0 ? d * k.abovePercent : d * k.belowPercent);
      return Math.max(0, Math.floor((killXp * Math.min(Math.max(pct, 0), k.maxPercent)) / 100));
    }
    default:
      return Math.max(0, killXp - level);
  }
}

/**
 * The level players see for a monster or NPC (issue #42): its species' `level` when the balance
 * row `levels.showMonsterLevels` is `shown`, else undefined (Classic: never shown, as in 1.6).
 */
export function shownMonsterLevel(name: string): number | undefined {
  if (content().balance.levels.showMonsterLevels !== "shown") {
    return undefined;
  }
  return content().monster(name)?.level;
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

// ---- the level curve -----------------------------------------------------------------------

/** No XP figure goes past this (a steep curve stops growing here). */
const XP_CEILING = Number.MAX_SAFE_INTEGER;

/** The curve's own figure for level L (≥ 1): its `firstLevels` entry, else the formula. */
function curveValue(l: BalanceLevels, level: number): number {
  const listed = l.firstLevels[level - 1];
  if (listed !== undefined) {
    return listed;
  }
  const v =
    (l.start + l.perLevel * level ** l.exponent) * (1 + l.growthPercent / 100) ** (level - 1);
  return Number.isFinite(v) ? Math.min(Math.floor(v), XP_CEILING) : XP_CEILING;
}

/**
 * The XP that leaving `level` takes (the balance row `levels`): with `perLevel` counting the
 * curve's figure for it, with `total` the step between the running totals that reach it and the
 * next level. At least 1, so a flat curve still levels; 0 at the cap (no more levels) and below
 * level 1. 1.6: 30 at level 1, 400 at 2, then 400 + 2 × level.
 */
export function levelCost(level: number, l: BalanceLevels = content().balance.levels): number {
  if (level < 1 || (l.cap !== undefined && level >= l.cap)) {
    return 0;
  }
  const v = curveValue(l, level);
  if (l.counting === "perLevel") {
    return Math.max(1, v);
  }
  const before = level === 1 ? 0 : curveValue(l, level - 1);
  return Math.max(1, v - before);
}

const TOTALS = new WeakMap<BalanceLevels, number[]>();

/** The running XP total that reaches `level` from level 1 (0 at level 1 and below). */
export function levelTotal(level: number, l: BalanceLevels = content().balance.levels): number {
  let totals = TOTALS.get(l);
  if (!totals) {
    totals = [0, 0];
    TOTALS.set(l, totals);
  }
  const want = Math.max(1, Math.floor(level));
  for (let n = totals.length; n <= want; n++) {
    const prev = totals[n - 1] ?? 0;
    totals.push(Math.min(prev + levelCost(n - 1, l), XP_CEILING));
  }
  return totals[want] ?? 0;
}

/** Whether `level` is the curve's highest. */
export function atLevelCap(level: number, l: BalanceLevels = content().balance.levels): boolean {
  return l.cap !== undefined && level >= l.cap;
}

/**
 * The XP bar's figures (issue #42): with `perLevel` counting the XP within the level against
 * what the level takes (1.6's display); with `total` the running total against the total that
 * reaches the next level. `need` is null at the level cap.
 */
export function expShown(
  v: Pick<Vitals, "level" | "exp" | "expNeeded">,
  l: BalanceLevels = content().balance.levels,
): { have: number; need: number | null } {
  const capped = atLevelCap(v.level, l) || v.expNeeded <= 0;
  if (l.counting === "total") {
    const base = levelTotal(v.level, l);
    return { have: base + v.exp, need: capped ? null : base + v.expNeeded };
  }
  return { have: v.exp, need: capped ? null : v.expNeeded };
}

/**
 * The level check after XP is added: one level for each `expNeeded` the XP reaches, carrying what
 * is left over, with HPmax and SPmax raised by the balance row's `hpPerLevel` and `spPerLevel`
 * (1.6: 1 each); no heal. At the level cap `expNeeded` is 0 and no level is gained. Returns the
 * number of levels gained (a bug fixed: 1.6 reset the XP to 0 and gained at most one level a kill).
 */
export function checkLevelUp(v: Vitals): number {
  const l = content().balance.levels;
  let levels = 0;
  while (v.exp >= v.expNeeded && v.expNeeded > 0) {
    v.exp -= v.expNeeded;
    v.level += 1;
    v.expNeeded = levelCost(v.level, l);
    v.hpMax += l.hpPerLevel;
    v.spMax += l.spPerLevel;
    levels += 1;
  }
  return levels;
}

/**
 * A saved character under the world's curve now (issue #42): an operator who changes the curve
 * keeps every character's level and the XP they hold within it. The XP the level takes is worked
 * out again, and XP that now reaches it levels them at once, as a kill would (each level adding
 * its HP and SP max), so a character never holds more XP than its level takes. Returns the levels
 * gained; a Classic character's figures never change.
 */
export function syncLevel(v: Vitals): number {
  if (v.level < 1) {
    return 0;
  }
  v.expNeeded = levelCost(v.level);
  return checkLevelUp(v);
}

// ---- regen -----------------------------------------------------------------------------

/**
 * The regen target: the balance row `regen.periodFrames`, less the faction perk `regeneration`
 * (Classic: an Adventurer's 5·(tier + 1)), at least 1. 1.6's was `60 − speed + (90 − perk)`; speed
 * was always 1 (1.6 stored a Speed stat that nothing could raise; SSO dropped it), so the period is
 * 149, or 144 down to 99 for an Adventurer.
 */
export function regenTarget(regeneration: number): number {
  return Math.max(1, content().balance.regen.periodFrames - regeneration);
}

/**
 * One frame of the regen timer. The counter starts at 1 at login and is raised first; when it
 * reaches the target it acts and starts again from 1, so at the usual target of 149 regen fires every 148 frames.
 * Hunger above the balance row `hunger.regenAbove` regenerates `regen.regenerate` HP and SP, below
 * `hunger.starveBelow` starves `regen.starve` of each (floor 1) (1.6: above 500 regenerates 1, below 50
 * starves 1), and in between the
 * period passes with no change (a bug fixed: 1.6 reset the counter only on a regen or a starve and
 * tested for exact equality, so it stalled until the next login). Mutates `v` and returns the new
 * counter.
 */
export function regenTick(counter: number, target: number, hunger: number, v: Vitals): number {
  const c = counter + 1;
  if (c < target) {
    return c;
  }
  const { regen, hunger: h } = content().balance;
  if (hunger > h.regenAbove) {
    v.hp = Math.min(v.hp + regen.regenerate, v.hpMax);
    v.sp = Math.min(v.sp + regen.regenerate, v.spMax);
  }
  if (hunger < h.starveBelow) {
    if (v.hp > 1) {
      v.hp = Math.max(1, v.hp - regen.starve);
    }
    if (v.sp > 1) {
      v.sp = Math.max(1, v.sp - regen.starve);
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
  if (rng.random(content().balance.hunger.loseOneIn) === 1 && h > 0) {
    h -= 1;
  }
  const warning = h !== hunger && h < 2000 ? (HUNGER_WARNINGS[h] ?? null) : null;
  return { hunger: h, warning };
}

/** Hunger after a death: the balance row `hunger.afterDeath` (1.6: 40,000). */
export function deathHunger(): number {
  return content().balance.hunger.afterDeath;
}

// ---- death -----------------------------------------------------------------------------

/** HP and SP after a death: the balance row `death` (1.6: 1 and 1), at most the full HP and SP. */
export function deathVitals(v: Vitals): void {
  const d = content().balance.death;
  v.hp = Math.max(1, Math.min(d.hp, v.hpMax));
  if (v.spMax > 0) {
    v.sp = Math.min(d.sp, v.spMax);
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

/** The death pause: no monster rolls against you for the balance row `death.pauseFrames` (1.6: 90). */
export function deathPauseFrames(): number {
  return content().balance.death.pauseFrames;
}
