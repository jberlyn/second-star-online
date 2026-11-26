/**
 * Class promotions: at a trainer (1.6's buy and go routines and the four texts of the trainer
 * script, with the checks in 1.6's order) and, for a path that allows it, from the player's Class
 * window (issue #15). A promotion takes one of the class's ways in (`classes.ts`).
 *
 * What SSO keeps for 1.6's promotions (Classic's rows): the order of checks, the texts, the `< min`
 * test, Paladin's SPmax floor and the `random(10)` skill grants. A bug fixed: 1.6's character
 * refresh and skill re-sort undid the grants at once, so no promotion ever gave its skill; SSO
 * applies them, and never lowers a skill (1.6's grant overwrote the skill with the roll). The gold
 * charge is made by the server.
 *
 * A path (issue #15) is checked in the same order; its refusals say what is missing.
 */
import { className } from "../admin/admin.ts";
import { findSkillIndex, skillDisplay } from "../core/fighter.ts";
import { lingoEq, lingoInteger, type Rng } from "../core/lingo.ts";
import { countInBag } from "../crafting/recipes.ts";
import { type Bag, invAdd } from "../inventory/inventory.ts";
import { atTrainer, type ClassWay, classNamed, fromWindow, waysInto } from "./classes.ts";

/** The texts; `npc` is the speaker. */
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
  /** A path's unmet requirements (issue #15). */
  needMore: (npc: string, missing: string) => `${npc}: You still need ${missing}.`,
  /** A path's items, not held. */
  needItems: (npc: string, missing: string) => `${npc}: You are ready, but you need ${missing}.`,
  /** What the promotion gives has no room in the bag. */
  bagFull: (npc: string) => `${npc}: Your bag is too full for what this gives.`,
} as const;

/** The Class window's texts (issue #15): the same lines with no speaker. */
export const CLASS_WINDOW_TEXT = {
  notHere: "You can't change to that class from here.",
  needMore: (missing: string) => `You still need ${missing}.`,
  noFunds: (gold: number) => `You need ${gold.toLocaleString("en-US")} gold.`,
  needItems: (missing: string) => `You need ${missing}.`,
  bagFull: "Your bag is too full for what this gives.",
  congrats: (cls: string) => `Congratulations, you are now a ${cls}!`,
} as const;

/** A `TRN|<class>:<price>` line: the class as typed and the price as an integer (empty = 0). */
export function parseTrn(data: string): { cls: string; price: number } {
  const parts = data.split(":");
  return { cls: parts[0] ?? "", price: lingoInteger(parts[1] ?? "") ?? 0 };
}

/** What a promotion reads. `skills` is every skill value in the classes data's order. */
export interface PromotionState {
  classCode: number;
  gold: number;
  hpMax: number;
  spMax: number;
  skills: readonly number[];
  /** The character's level (a path's `level` requirement); 0 when absent. */
  level?: number;
  /** The bag (a path's items); empty when absent. */
  bag?: Bag;
  /** The spellbook's lines (a path's spells); empty when absent. */
  spellbook?: readonly string[];
}

/** What a promotion changed. */
export interface PromotionChange {
  classCode: number;
  gold: number;
  hpMax: number;
  spMax: number;
  skills: number[];
  /** The bag after the path's items were taken and given, or null when it did not change. */
  bag: Bag | null;
  /** Spells the path added to the spellbook, in order. */
  spells: string[];
}

export interface PromotionResult {
  /** The chat lines, in order (all the buyer's own chat). */
  texts: string[];
  /** `heal2` on channel 3 follows the congratulation (and each branch). */
  sound: boolean;
  /**
   * The new class, gold, vitals and skills (every value), or null when nothing changed. The class's
   * stat points are not here: they are calculated from the class (`classStatBonus`).
   */
  result: PromotionChange | null;
}

/** A requirement's current value: a vital, the level, or a skill by its name. */
export function requirementValue(s: PromotionState, stat: string): number {
  if (stat === "HPmax") {
    return s.hpMax;
  }
  if (stat === "SPmax") {
    return s.spMax;
  }
  if (stat === "level") {
    return s.level ?? 0;
  }
  // Found as every other rule finds a skill (case and spaces ignored), as the publish checks it.
  const i = findSkillIndex(stat);
  return i === undefined ? 0 : (s.skills[i] ?? 0);
}

/** A requirement as players read it: "Slash 30", "level 20", "full HP 40". */
export function requirementLabel(needs: string, atLeast: number): string {
  if (needs === "level") {
    return `level ${atLeast}`;
  }
  if (needs === "HPmax") {
    return `full HP ${atLeast}`;
  }
  if (needs === "SPmax") {
    return `full SP ${atLeast}`;
  }
  return `${skillDisplay(needs)} ${atLeast}`;
}

/** Words joined as a list: "a", "a and b", "a, b and c". */
function listWords(words: readonly string[]): string {
  return words.length <= 1
    ? (words[0] ?? "")
    : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** Where a way stands for a character: each check, met or not. */
export interface WayStatus {
  requires: { label: string; have: number; atLeast: number; met: boolean }[];
  /** The gold it takes (the trainer's price added at a trainer). */
  gold: { need: number; have: number; met: boolean };
  items: { item: string; qty: number; have: number; keep: boolean; met: boolean }[];
  /** Every check holds. */
  ready: boolean;
}

/** Where way `w` stands for `s`, with `price` (a trainer's) added to the path's gold. */
export function wayStatus(w: ClassWay, s: PromotionState, price = 0): WayStatus {
  const requires = w.requires.map((r) => {
    const have = requirementValue(s, r.needs);
    return {
      label: requirementLabel(r.needs, r.atLeast),
      have,
      atLeast: r.atLeast,
      met: have >= r.atLeast,
    };
  });
  const need = price + w.gold;
  const gold = { need, have: s.gold, met: need <= s.gold };
  const items = w.items.map((it) => {
    const have = s.bag ? countInBag(s.bag, it.item) : 0;
    return { item: it.item, qty: it.qty, have, keep: it.keep === true, met: have >= it.qty };
  });
  return {
    requires,
    gold,
    items,
    ready: requires.every((r) => r.met) && gold.met && items.every((i) => i.met),
  };
}

const itemWords = (rows: { item: string; qty: number }[]) =>
  listWords(rows.map((r) => (r.qty === 1 ? r.item : `${r.qty} ${r.item}`)));

/**
 * Applies way `w` for `price` (already checked): gold, the vitals floors, then 1.6's rolled skills
 * (one `random(10)` each, in order) or the path's fixed ones, then the items taken and given and
 * the spells. Null when the bag has no room for what it gives.
 */
function applyWay(s: PromotionState, w: ClassWay, price: number, rng: Rng): PromotionChange | null {
  let spMax = s.spMax;
  let hpMax = s.hpMax;
  if (w.grants.spMax !== undefined) {
    spMax = Math.max(spMax, w.grants.spMax);
  }
  if (w.grants.hpMax !== undefined) {
    hpMax = Math.max(hpMax, w.grants.hpMax);
  }
  const skills = [...s.skills];
  for (const name of w.rollSkills) {
    const i = findSkillIndex(name);
    if (i !== undefined) {
      skills[i] = Math.max(skills[i] ?? 0, rng.random(10));
    }
  }
  for (const g of w.grants.skills ?? []) {
    const i = findSkillIndex(g.skill);
    if (i !== undefined) {
      skills[i] = Math.max(skills[i] ?? 0, g.to);
    }
  }
  let bag: Bag | null = null;
  let gold = s.gold - price - w.gold;
  const given = w.grants.items ?? [];
  const taken = w.items.filter((it) => !it.keep);
  if (given.length > 0 || taken.length > 0) {
    const next = (s.bag ?? []).map((l) => (l ? { ...l } : null));
    for (const it of taken) {
      let left = it.qty;
      for (let i = 0; i < next.length && left > 0; i++) {
        const l = next[i];
        if (l && lingoEq(l.item, it.item)) {
          const n = Math.min(left, l.qty);
          l.qty -= n;
          left -= n;
          if (l.qty <= 0) {
            next[i] = null;
          }
        }
      }
    }
    const inv = { bag: next, gold };
    for (const it of given) {
      if (invAdd(inv, it.item, it.qty, rng).kind === "full") {
        return null;
      }
    }
    bag = inv.bag;
    gold = inv.gold;
  }
  const book = s.spellbook ?? [];
  const spells: string[] = [];
  for (const spell of w.grants.spells ?? []) {
    if (!book.includes(spell) && !spells.includes(spell)) {
      spells.push(spell);
    }
  }
  return { classCode: w.to.code, gold, hpMax, spMax, skills, bag, spells };
}

/**
 * Buying class `typed` for `price` from the trainer `npc`. In 1.6's order: (1) the class you
 * already are -> "learned all", whatever the class; (2) no way into `typed` at a trainer ->
 * nothing at all, no text and no charge (the original's if-chain on the typed class falls
 * through); (3) no way from the current class -> `cantDoIt`; (4) no way whose requirements hold ->
 * `focused` (a path: what is still needed); (5) price over gold -> `noFunds`; then a path's items;
 * (6) the charge, the new class, the congratulation, the floors and the grants. The new class's
 * stat points come with the class (`classStatBonus`); a promotion stores none (a design change:
 * 1.6 added them to the stored stats).
 */
export function promoteClass(
  s: PromotionState,
  typed: string,
  price: number,
  npc: string,
  rng: Rng,
): PromotionResult {
  const nothing: PromotionResult = { texts: [], sound: false, result: null };
  const say = (text: string): PromotionResult => ({ texts: [text], sound: false, result: null });
  const current = className(s.classCode) ?? "";
  if (lingoEq(current, typed)) {
    return say(PROMOTION_TEXT.learnedAll(npc, typed));
  }
  const target = classNamed(typed);
  const ways = target ? waysInto(target.code).filter(atTrainer) : [];
  if (ways.length === 0) {
    return nothing;
  }
  const mine = ways.filter((w) => w.from.includes(s.classCode));
  if (mine.length === 0) {
    return say(PROMOTION_TEXT.cantDoIt(npc, current));
  }
  const statuses = mine.map((w) => ({ w, st: wayStatus(w, s, price) }));
  const able = statuses.find((x) => x.st.requires.every((r) => r.met));
  if (!able) {
    // A path says what it still needs; 1.6's promotion alone keeps 1.6's line.
    const first = statuses.find((x) => !x.w.legacy) ?? statuses[0];
    if (!first || first.w.legacy) {
      return say(PROMOTION_TEXT.focused(npc, current));
    }
    const missing = first.st.requires.filter((r) => !r.met).map((r) => r.label);
    return say(PROMOTION_TEXT.needMore(npc, listWords(missing)));
  }
  if (!able.st.gold.met) {
    return say(PROMOTION_TEXT.noFunds(npc));
  }
  const short = able.st.items.filter((i) => !i.met);
  if (short.length > 0) {
    return say(PROMOTION_TEXT.needItems(npc, itemWords(short)));
  }
  const result = applyWay(s, able.w, price, rng);
  if (!result) {
    return say(PROMOTION_TEXT.bagFull(npc));
  }
  return {
    texts: [PROMOTION_TEXT.congrats(npc, able.w.to.name)],
    sound: true,
    result,
  };
}

/**
 * Changing to class `code` from the Class window (issue #15): only a path that allows it, from the
 * current class, with every check met; the same order as at a trainer, with no price.
 */
export function promoteFromWindow(s: PromotionState, code: number, rng: Rng): PromotionResult {
  const say = (text: string): PromotionResult => ({ texts: [text], sound: false, result: null });
  const ways = waysInto(code).filter((w) => fromWindow(w) && w.from.includes(s.classCode));
  if (ways.length === 0 || code === s.classCode) {
    return say(CLASS_WINDOW_TEXT.notHere);
  }
  const statuses = ways.map((w) => ({ w, st: wayStatus(w, s) }));
  const able = statuses.find((x) => x.st.requires.every((r) => r.met));
  if (!able) {
    const first = statuses[0];
    const missing = (first?.st.requires ?? []).filter((r) => !r.met).map((r) => r.label);
    return say(CLASS_WINDOW_TEXT.needMore(listWords(missing)));
  }
  if (!able.st.gold.met) {
    return say(CLASS_WINDOW_TEXT.noFunds(able.st.gold.need));
  }
  const short = able.st.items.filter((i) => !i.met);
  if (short.length > 0) {
    return say(CLASS_WINDOW_TEXT.needItems(itemWords(short)));
  }
  const result = applyWay(s, able.w, 0, rng);
  if (!result) {
    return say(CLASS_WINDOW_TEXT.bagFull);
  }
  return { texts: [CLASS_WINDOW_TEXT.congrats(able.w.to.name)], sound: true, result };
}
