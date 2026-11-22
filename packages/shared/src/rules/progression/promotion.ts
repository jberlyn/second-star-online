/**
 * Class promotions at a trainer: the buy and go routines and the four texts of the trainer script,
 * with the checks in 1.6's order.
 *
 * What SSO keeps: the order of checks, the texts, the `< min` test, Paladin's SPmax floor and the
 * `random(10)` skill grants. A bug fixed: 1.6's character refresh and skill re-sort undid the
 * grants at once, so no promotion ever gave its skill; SSO applies them, and never lowers a skill
 * (1.6's grant overwrote the skill with the roll). The gold charge is made by the server.
 */
import { content } from "../../content/store.ts";
import { className } from "../admin/admin.ts";
import { findSkillIndex } from "../core/fighter.ts";
import { lingoEq, lingoInteger, type Rng } from "../core/lingo.ts";

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

/** What `promoteClass` reads. `skills` is every skill value in the classes data's order. */
export interface PromotionState {
  classCode: number;
  gold: number;
  hpMax: number;
  spMax: number;
  skills: readonly number[];
}

export interface PromotionResult {
  /** The chat lines, in order (all the buyer's own chat). */
  texts: string[];
  /** `heal2` on channel 3 follows the congratulation (and each branch). */
  sound: boolean;
  /**
   * The new class, gold, SPmax and skills (every value), or null when nothing changed. The class's
   * stat points are not here: they are calculated from the class (`classStatBonus`).
   */
  result: {
    classCode: number;
    gold: number;
    spMax: number;
    skills: number[];
  } | null;
}

/** A requirement's current value: a vital, or a skill by its name in the classes data. */
function statValue(s: PromotionState, stat: string): number {
  if (stat === "HPmax") {
    return s.hpMax;
  }
  if (stat === "SPmax") {
    return s.spMax;
  }
  // Found as every other rule finds a skill (case and spaces ignored), as the publish checks it.
  const i = findSkillIndex(stat);
  return i === undefined ? 0 : (s.skills[i] ?? 0);
}

/**
 * Buying class `typed` for `price` from the trainer `npc`. In 1.6's order: (1) the class you
 * already are -> "learned all", whatever the class; (2) no branch for `typed` -> nothing at all, no
 * text and no charge (the original's if-chain on the typed class falls through); (3) the current
 * class not in the branch's `from` list -> `cantDoIt`; (4) the requirement below its minimum ->
 * `focused`; (5) price over gold -> `noFunds`; (6) gold -= price, the new class, the
 * congratulation, the SPmax floor, then each granted skill raised to `random(10)` if below it. The
 * new class's stat points come with the class (`classStatBonus`); a promotion stores none (a design
 * change: 1.6 added them to the stored stats).
 */
export function promoteClass(
  s: PromotionState,
  typed: string,
  price: number,
  npc: string,
  rng: Rng,
): PromotionResult {
  const nothing: PromotionResult = { texts: [], sound: false, result: null };
  const current = className(s.classCode) ?? "";
  if (lingoEq(current, typed)) {
    return { texts: [PROMOTION_TEXT.learnedAll(npc, typed)], sound: false, result: null };
  }
  const branch = content().classes.classes.find((c) => c.promotion && lingoEq(c.name, typed));
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
  let spMax = s.spMax;
  for (const change of rule.statChanges) {
    spMax = Math.max(spMax, change.atLeast);
  }
  const skills = [...s.skills];
  for (const name of rule.skillGrants) {
    const i = findSkillIndex(name);
    if (i !== undefined) {
      skills[i] = Math.max(skills[i] ?? 0, rng.random(10));
    }
  }
  return {
    texts: [PROMOTION_TEXT.congrats(npc, branch.name)],
    sound: true,
    result: { classCode: branch.code, gold: s.gold - price, spMax, skills },
  };
}
