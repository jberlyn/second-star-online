/**
 * Class promotions at a trainer: the buy and go routines and the four texts of the trainer script,
 * with the checks in 1.6's order.
 *
 * What SSO keeps: the order of checks, the texts, the `< min` test, the stat changes. What it does
 * not: the `random(10)` skill grants, which 1.6's character refresh and skill re-sort undo at
 * once, and the client-side gold charge, which the server now makes.
 */
import { classesData } from "@secondstaronline/data";

import { className } from "../admin/admin.ts";
import { lingoEq, lingoInteger } from "../core/lingo.ts";

/** The five texts; `npc` is the speaker. */
export const PROMOTION_TEXT = {
  /** `typed` is the class as the TRN line spells it (the original's shop-item variable). */
  learnedAll: (npc: string, typed: string) =>
    `${npc}: You have learned all there is to the art of the ${typed}.`,
  cantDoIt: (npc: string, current: string) =>
    `${npc}: It is impossible for a ${current} to learn this.`,
  focused: (npc: string, current: string) =>
    `${npc}: You are focused properly, but still need more experience as a ${current}.`,
  noFunds: (npc: string) => `${npc}: You are ready, but lack the proper funds.`,
  congrats: (npc: string, cls: string) => `${npc}: Congratulations, you are now a ${cls}!`,
} as const;

/** A `TRN|<class>:<price>` line: the class as typed and the price as an integer (empty = 0). */
export function parseTrn(data: string): { cls: string; price: number } {
  const parts = data.split(":");
  return { cls: parts[0] ?? "", price: lingoInteger(parts[1] ?? "") ?? 0 };
}

/** The character stats a promotion can change (lower-case keys of the stat block). */
export interface PromotionStats {
  str: number;
  sta: number;
  agi: number;
  dex: number;
  int: number;
  wis: number;
  spd: number;
}

/** What `promoteClass` reads. `skills` is every skill value in the classes data's order. */
export interface PromotionState {
  classCode: number;
  gold: number;
  hpMax: number;
  spMax: number;
  skills: readonly number[];
  stats: PromotionStats;
}

export interface PromotionResult {
  /** The chat lines, in order (all the buyer's own chat). */
  texts: string[];
  /** `heal2` on channel 3 follows the congratulation (and each branch). */
  sound: boolean;
  /** The new class, gold and stats, or null when nothing changed. */
  result: { classCode: number; gold: number; spMax: number; stats: PromotionStats } | null;
}

/** 1.6's stat variable names to the stat block's keys. */
const STAT_KEY: Record<string, keyof PromotionStats> = {
  strength: "str",
  Stamina: "sta",
  Agility: "agi",
  Dexterity: "dex",
  Intelligence: "int",
  Wisdom: "wis",
  speed: "spd",
};

/** A requirement's current value: a vital, or a skill by its name in the classes data. */
function statValue(s: PromotionState, stat: string): number {
  if (stat === "HPmax") {
    return s.hpMax;
  }
  if (stat === "SPmax") {
    return s.spMax;
  }
  const skill = classesData.skills.find((k) => k.skill === stat);
  return skill ? (s.skills[skill.index - 1] ?? 0) : 0;
}

/**
 * Buying class `typed` for `price` from the trainer `npc`. In 1.6's order: (1) the class you
 * already are -> "learned all", whatever the class; (2) no branch for `typed` -> nothing at all, no
 * text and no charge (the original's if-chain on the typed class falls through); (3) the current
 * class not in the branch's `from` list -> `cantDoIt`; (4) the requirement below its minimum ->
 * `focused`; (5) price over gold -> `noFunds`; (6) gold -= price, the new class, the
 * congratulation, the stat changes.
 */
export function promoteClass(
  s: PromotionState,
  typed: string,
  price: number,
  npc: string,
): PromotionResult {
  const nothing: PromotionResult = { texts: [], sound: false, result: null };
  const current = className(s.classCode) ?? "";
  if (lingoEq(current, typed)) {
    return { texts: [PROMOTION_TEXT.learnedAll(npc, typed)], sound: false, result: null };
  }
  const branch = classesData.classes.find((c) => c.promotion && lingoEq(c.name, typed));
  const rule = branch?.promotion;
  if (!branch || !rule) {
    return nothing;
  }
  if (!rule.from.some((f) => lingoEq(f, current))) {
    return { texts: [PROMOTION_TEXT.cantDoIt(npc, current)], sound: false, result: null };
  }
  if (statValue(s, rule.requirement.stat) < rule.requirement.min) {
    return { texts: [PROMOTION_TEXT.focused(npc, current)], sound: false, result: null };
  }
  if (price > s.gold) {
    return { texts: [PROMOTION_TEXT.noFunds(npc)], sound: false, result: null };
  }
  const stats = { ...s.stats };
  let spMax = s.spMax;
  for (const change of rule.statChanges) {
    if ("atLeast" in change) {
      spMax = spMax < change.atLeast ? change.atLeast : spMax;
    } else {
      const key = STAT_KEY[change.stat];
      if (key) {
        stats[key] += change.delta;
      }
    }
  }
  return {
    texts: [PROMOTION_TEXT.congrats(npc, branch.name)],
    sound: true,
    result: { classCode: branch.code, gold: s.gold - price, spMax, stats },
  };
}
