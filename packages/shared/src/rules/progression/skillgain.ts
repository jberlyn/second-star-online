/**
 * Kill skill gain: the skills the weapon trains (classes `skillGain.weaponSkills`), each by its
 * `kill` progression, capped by the killed monster's body (monsters `skillCaps`). 1.6 ran it on the
 * killer's client before the level check.
 */
import { content } from "../../content/store.ts";
import { type Faction, type Fighter, findSkillIndex, SKILL_KEYS } from "../core/fighter.ts";
import { lingoContains, type Rng } from "../core/lingo.ts";
import { excepted } from "../core/patterns.ts";
import { weaponIs } from "../crafting/masterwork.ts";
import { factionPerk } from "../social/factions.ts";
import { train } from "./progress.ts";

/** The skills the weapon trains: the last matching row wins; an exact row covers its masterworks. */
export function weaponSkillList(weapon: string): readonly string[] {
  let out: readonly string[] = [];
  for (const row of content().classes.skillGain.weaponSkills) {
    const hit =
      !excepted(row, weapon) &&
      (row.match === "exact" ? weaponIs(weapon, row.weapon) : lingoContains(weapon, row.weapon));
    if (hit) {
      out = row.skills;
    }
  }
  return out;
}

/**
 * The Mage skill cap, for kills and casts alike: the faction perk `mageCap` (Classic: 30, or for
 * the Mage faction 50/60/70/90/100 by tier 0/1/2/3/4 and over). A bug fixed: 1.6's kill path used
 * 80 at tier 3 and its cast path 90.
 */
export function mageSkillCap(f: Faction): number {
  return factionPerk(f, "mageCap");
}

/**
 * The skill caps by faction (kill path): the perks `skillCap` (Classic: 50; Warriors 55, 60, 70,
 * 80, 90 by tier, then 100; Adventurers 55 … 75, then 80) and `mageCap`.
 */
export function skillCaps(f: Fighter): { max: number; mage: number } {
  return { max: factionPerk(f.faction, "skillCap"), mage: mageSkillCap(f.faction) };
}

/** The skill cap by the killed monster's body, plus the Intelligence tiers. */
export function monsterSkillCap(body: number, intelligence: number): number {
  const caps = content().monsters.skillCaps;
  let cap = caps.default;
  for (const row of caps.byBody) {
    if (row.body === String(body)) {
      cap = row.skillCap;
    }
  }
  for (const t of caps.intelligenceTiers) {
    if (intelligence > t.intelligenceGt) {
      cap += t.add;
    }
  }
  return cap;
}

/**
 * Trains every skill the weapon trains, in the weapon row's list order (Classic's lists are in 1.6's
 * order), by each skill's `kill` progression. Each `chance` skill needs skill > 0, below its cap
 * and (with `monsterCap`) below the monster's cap. Mutates `f.skills` (and XP); returns the key of
 * each skill that rose, once per level gained.
 * 1.6's `oSkills contains` was a substring test on the comma list of shown names; the list's
 * entries are matched to skills by name here (case and spaces ignored), so a skill's `display`
 * may change without it stopping training. For Classic's lists the two agree.
 */
export function rollKillSkillGain(
  f: Fighter,
  monsterBody: number,
  rng: Rng,
  /** The killed species' own `skillXp`, for `xp` skills. */
  xp?: number,
): string[] {
  const monsterCap = monsterSkillCap(monsterBody, f.int);
  const gained: string[] = [];
  const seen = new Set<number>();
  for (const name of weaponSkillList(f.equip.weapon)) {
    // A skill the world does not have is never rolled; a skill listed twice trains once.
    const i = findSkillIndex(name);
    if (i === undefined || seen.has(i)) {
      continue;
    }
    seen.add(i);
    const levels = train(f, i, "kill", rng, xp === undefined ? { monsterCap } : { monsterCap, xp });
    for (let n = 0; n < levels; n++) {
      gained.push(SKILL_KEYS[i] ?? name);
    }
  }
  return gained;
}
