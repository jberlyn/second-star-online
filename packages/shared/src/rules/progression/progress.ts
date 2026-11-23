/**
 * Skill progression (issue #37 stage 6): every place a skill rises calls `train` with its source.
 * Each skill's model and settings are content (`classes.json` `progression` and each skill's own
 * `progression`); the guard and dice order of each source are code, kept as 1.6 had them:
 *
 * - `defend` rolls first, then tests 0 < skill < cap and the requirement (Parry, Block);
 * - `kill` tests 0 < skill < cap, rolls, then tests the monster's cap and the requirement;
 * - `shot`, `cast` and `hit` test 0 < skill < cap, then roll;
 * - `gather` and `craft` test min <= skill < cap, then roll.
 *
 * The `xp` model rolls no chance: an action gives XP (its formula, or the harvest node's, recipe's
 * or monster's own amount), and the skill's level follows its curve. The level is the skill's
 * value, so every rule that reads a skill reads the level.
 */
import type {
  Cap,
  ChanceSettings,
  Curve,
  Formula,
  ProgressionSource,
  XpSettings,
} from "@secondstaronline/data";

import { content, onContent } from "../../content/store.ts";
import { type Faction, SKILL_KEYS, skillDisplay, skillValue } from "../core/fighter.ts";
import type { Rng } from "../core/lingo.ts";
import { factionPerk } from "../social/factions.ts";

/** No skill rises past this. */
export const SKILL_MAX = 100;

/** What progression reads of a character, and the skill values and XP it raises in place. */
export interface Trainee {
  level: number;
  str: number;
  sta: number;
  int: number;
  wis: number;
  dex?: number;
  skills: number[];
  /** Each skill's running XP total, by skill index; read and raised for `xp`-model skills. */
  skillXp?: number[];
  faction: Faction;
}

/** What a source passes besides the skill: values formulas read, and amounts that replace them. */
export interface TrainExtra {
  /** The tool's tier (`tier`), 0 without one. */
  tier?: number;
  /** A hit's damage (`damage`), already capped at the target's HP left. */
  damage?: number;
  /** The XP the harvest node, recipe or monster gives, replacing the skill's own amount. */
  xp?: number;
  /** The killed monster's skill cap (`monsterCap`). */
  monsterCap?: number;
  /** A cap that replaces the settings' (a spell school's own `cap`). */
  cap?: number;
}

type Resolved =
  | { model: "chance"; on: Partial<Record<ProgressionSource, ChanceSettings>> }
  | {
      model: "xp";
      cap: Cap | undefined;
      /** The running total that reaches each level, 0 to `SKILL_MAX` (Infinity past the curve). */
      totals: number[];
      curve: Curve;
      on: Partial<Record<ProgressionSource, XpSettings>>;
    };

let RESOLVED: Resolved[] = [];
const TOTALS = new Map<string, number[]>();

/** Field by field, a skill's settings over the world default; `false` turns the source off. */
function merge<T extends object>(base: T | false | undefined, own: T | false | undefined) {
  if (own === false) {
    return undefined;
  }
  const b = base === false ? undefined : base;
  return own === undefined ? b : { ...b, ...own };
}

onContent((c) => {
  const p = c.classes.progression;
  TOTALS.clear();
  for (const [name, curve] of Object.entries(p.curves)) {
    TOTALS.set(name, curveTotals(curve));
  }
  RESOLVED = c.classes.skills.map((row): Resolved => {
    const prog = row.progression ?? { model: "chance" as const };
    const on: Record<string, object | undefined> = {};
    const defaults = prog.model === "chance" ? p.defaults.chance : p.defaults.xp;
    for (const source of Object.keys(defaults).concat(Object.keys(prog.on ?? {}))) {
      const s = source as ProgressionSource;
      on[s] = merge<object>(defaults[s], prog.on?.[s]);
    }
    if (prog.model === "chance") {
      return { model: "chance", on };
    }
    const curve = (Object.hasOwn(p.curves, prog.curve) ? p.curves[prog.curve] : undefined) ?? {
      counting: "perLevel",
    };
    return {
      model: "xp",
      cap: prog.cap,
      curve,
      totals: TOTALS.get(prog.curve) ?? curveTotals(curve),
      on,
    };
  });
});

// ---- formulas ----------------------------------------------------------------------------

const RANDOM = /^(?:(\d+) \+ )?random\((\d+)\)$/;

/** What a formula reads. */
interface Reading {
  t: Trainee;
  /** The trained skill's value. */
  skill: number;
  tier: number;
  damage: number;
}

/** A stat table's value for a stat. */
function tableValue(name: string, t: Trainee): number | undefined {
  const tables = content().classes.progression.tables;
  const table = Object.hasOwn(tables, name) ? tables[name] : undefined;
  if (!table) {
    return undefined;
  }
  const stat = statOf(table.stat, t) ?? 0;
  let v = table.start;
  for (const tier of table.tiers) {
    if (stat > tier.above) {
      v += tier.add;
    }
  }
  return v;
}

function statOf(name: string, t: Trainee): number | undefined {
  switch (name) {
    case "strength":
      return t.str;
    case "stamina":
      return t.sta;
    case "intelligence":
      return t.int;
    case "wisdom":
      return t.wis;
    case "dexterity":
      return t.dex ?? 0;
    case "level":
      return t.level;
  }
  return undefined;
}

/** A name's value: a stat, the trained skill, level, tier, damage, a stat table or a skill. */
function read(name: string, r: Reading): number {
  switch (name) {
    case "skill":
      return r.skill;
    case "tier":
      return r.tier;
    case "damage":
      return r.damage;
  }
  return statOf(name, r.t) ?? tableValue(name, r.t) ?? skillValue(r.t.skills, name);
}

/**
 * A formula's value: rows applied in order to a result that starts at 0, each only when every
 * `when` condition holds. A `random(n)` row rolls only when it applies, in row order.
 */
function evalFormula(f: Formula, r: Reading, rng: Rng): number {
  if (typeof f === "number") {
    return f;
  }
  let out = 0;
  for (const row of f) {
    const applies = (row.when ?? []).every((cond) => {
      const [name = "", op, n] = cond.split(" ");
      const v = read(name, r);
      return op === "<" ? v < Number(n) : v > Number(n);
    });
    if (!applies) {
      continue;
    }
    let v: number;
    if (typeof row.value === "number") {
      v = row.value;
    } else {
      const m = RANDOM.exec(row.value);
      v = m ? Number(m[1] ?? 0) + rng.random(Number(m[2])) : read(row.value, r);
    }
    switch (row.op) {
      case "set":
        out = v;
        break;
      case "add":
        out += v;
        break;
      case "subtract":
        out -= v;
        break;
      case "multiply":
        out *= v;
        break;
    }
  }
  return out;
}

/** A formula as an item's teaching reads it: no skill or tool, only the reader's stats. */
export function evalTeaching(f: Formula, t: Trainee, skill: number, rng: Rng): number {
  return evalFormula(f, { t, skill, tier: 0, damage: 0 }, rng);
}

// ---- curves ------------------------------------------------------------------------------

/** The curve formula's value at a level: only `level` is read, and curves roll no dice. */
function curveFormula(f: Formula, level: number): number {
  const noDice: Rng = { random: () => 0 };
  const t: Trainee = {
    level,
    str: 0,
    sta: 0,
    int: 0,
    wis: 0,
    skills: [],
    faction: { key: null, tier: 0 },
  };
  return evalFormula(f, { t, skill: 0, tier: 0, damage: 0 }, noDice);
}

/**
 * The running XP total that reaches each level, 0 to `SKILL_MAX`. Leaving level L takes `table[L]`
 * while the table lasts, then the formula at L: the XP from L to L + 1 (`perLevel`) or the total
 * that reaches L + 1 (`total`). Levels past the curve are never reached (Infinity).
 */
export function curveTotals(c: Curve): number[] {
  const out = [0];
  let total = 0;
  for (let level = 0; level < SKILL_MAX; level++) {
    const need =
      c.table?.[level] ?? (c.formula === undefined ? null : curveFormula(c.formula, level));
    if (need === null || !Number.isFinite(need) || (c.cap !== undefined && level >= c.cap)) {
      total = Infinity;
    } else {
      total = c.counting === "total" ? Math.max(total, need) : total + Math.max(0, need);
    }
    out.push(total);
  }
  return out;
}

/** An `xp` skill's XP held inside its level's range (a model switch or curve change moved it). */
function heldXp(
  xp: number,
  level: number,
  totals: readonly number[],
  /** The skill's level cap: at it, XP past the next level's total is the last action's and stays. */
  cap = SKILL_MAX,
): number {
  const lo = totals[Math.min(level, SKILL_MAX)] ?? 0;
  if (!Number.isFinite(lo)) {
    return xp;
  }
  const next = level >= cap ? Infinity : (totals[level + 1] ?? Infinity);
  const hi = Number.isFinite(next) ? Math.max(lo, next - 1) : Infinity;
  return Math.min(Math.max(xp, lo), hi);
}

/** What the Skills page shows of an `xp` skill: the XP so far and the XP the next level takes. */
export interface XpShown {
  have: number;
  /** Null at the level cap or past the curve. */
  need: number | null;
}

/**
 * An `xp` skill's progress as its curve counts it, or null for a `chance` skill: within the level
 * (`perLevel`) or the running total against the next level's total (`total`).
 */
export function xpShown(i: number, level: number, xp: number): XpShown | null {
  const r = RESOLVED[i];
  if (r?.model !== "xp") {
    return null;
  }
  const lo = r.totals[Math.min(level, SKILL_MAX)] ?? 0;
  if (!Number.isFinite(lo)) {
    return { have: xp, need: null };
  }
  const next = level >= SKILL_MAX ? Infinity : (r.totals[level + 1] ?? Infinity);
  const ceiling = Math.min(
    SKILL_MAX,
    r.curve.cap ?? SKILL_MAX,
    typeof r.cap === "number" ? r.cap : SKILL_MAX,
  );
  // XP the server sends is already held to the level's range; at or past the next level's total it
  // is a capped skill's (a faction or Mage cap the client does not know), shown with no target.
  const done = !Number.isFinite(next) || level >= ceiling || xp >= next;
  const have = Math.max(xp, lo);
  if (r.curve.counting === "total") {
    return { have, need: done ? null : next };
  }
  return { have: have - lo, need: done ? null : next - lo };
}

/** The XP totals of the `xp`-model skills, by key, for the Skills page; null when none are. */
export function xpByKey(
  skills: readonly number[],
  xp: readonly number[] | undefined,
  faction: Faction,
): Record<string, number> | null {
  let out: Record<string, number> | null = null;
  RESOLVED.forEach((r, i) => {
    const key = SKILL_KEYS[i];
    if (r.model === "xp" && key !== undefined) {
      out ??= {};
      out[key] = heldXp(xp?.[i] ?? 0, skills[i] ?? 0, r.totals, capOf(r, faction));
    }
  });
  return out;
}

/**
 * An XP figure as the Skills page writes it: in full up to 99,999 (with thousands commas), then
 * `k` or `M` (or `B`) to three significant figures: "13.0M", "512k".
 */
export function formatXp(n: number): string {
  if (n < 100_000) {
    return Math.trunc(n).toLocaleString("en-US");
  }
  const units: [number, string][] = [
    [1e3, "k"],
    [1e6, "M"],
    [1e9, "B"],
  ];
  let u = n >= 1e9 ? 2 : n >= 1e6 ? 1 : 0;
  // 999,600 rounds to 1000k: it shows as 1.00M.
  if (u < 2 && Number((n / (units[u]?.[0] ?? 1)).toPrecision(3)) >= 1000) {
    u += 1;
  }
  const [size, unit] = units[u] ?? [1, ""];
  // Three significant figures of the rounded value: 9,999,000 is 10.0M, not 10.00M.
  const v = Number((n / size).toPrecision(3));
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)}${unit}`;
}

// ---- training ----------------------------------------------------------------------------

/** A cap's value for a faction. */
export function capValue(cap: Cap | undefined, f: Faction): number {
  if (cap === undefined) {
    return SKILL_MAX;
  }
  if (cap === "faction") {
    return factionPerk(f, "skillCap");
  }
  if (cap === "mage") {
    return factionPerk(f, "mageCap");
  }
  return cap;
}

/**
 * The highest level skill `i` may reach: 100, and for an `xp` skill its curve's and its own cap. A
 * `chance` skill's caps are per source.
 */
export function levelCap(t: Trainee, i: number): number {
  const r = RESOLVED[i];
  return r?.model === "xp" ? capOf(r, t.faction) : SKILL_MAX;
}

/** An `xp` skill's level cap: 100, its curve's, and its own (or `over`, a source's own cap). */
function capOf(r: Extract<Resolved, { model: "xp" }>, f: Faction, over?: number): number {
  return Math.min(SKILL_MAX, r.curve.cap ?? SKILL_MAX, over ?? capValue(r.cap, f));
}

/**
 * Each skill's XP total as it is kept: inside its level's range for an `xp` skill (a curve change or
 * a switch from `chance` moved it), 0 for a `chance` skill (so a switch to `xp` starts the skill at
 * its level's total, never at XP from before). Run on load, save and publish; never changes a level.
 */
export function normaliseXp(
  skills: readonly number[],
  xp: readonly number[],
  faction: Faction,
): number[] {
  return RESOLVED.map((r, i) =>
    r.model === "xp" ? heldXp(xp[i] ?? 0, skills[i] ?? 0, r.totals, capOf(r, faction)) : 0,
  );
}

/** The skill trains from this source at all (it has settings for it). */
export function trainsFrom(i: number, source: ProgressionSource): boolean {
  return RESOLVED[i]?.on[source] !== undefined;
}

/** The model a skill uses. */
export function progressionModel(i: number): "chance" | "xp" {
  return RESOLVED[i]?.model ?? "chance";
}

/**
 * One action's training of skill `i` from `source`: raises the skill (and its XP) in place and
 * returns the levels gained (0 or 1 for `chance`; any number for `xp`). A skill with no settings
 * for the source, or none in the world, never trains and rolls nothing.
 */
export function train(
  t: Trainee,
  i: number,
  source: ProgressionSource,
  rng: Rng,
  extra: TrainExtra = {},
): number {
  const r = RESOLVED[i];
  if (!r) {
    return 0;
  }
  return r.model === "chance"
    ? trainChance(t, i, source, r.on[source], rng, extra)
    : trainXp(t, i, r, r.on[source], rng, extra);
}

function requirementMet(t: Trainee, s: ChanceSettings | XpSettings): boolean {
  return !s.requires || skillValue(t.skills, s.requires.skill) > s.requires.above;
}

function trainChance(
  t: Trainee,
  i: number,
  source: ProgressionSource,
  s: ChanceSettings | undefined,
  rng: Rng,
  extra: TrainExtra,
): number {
  if (!s || s.roll === undefined) {
    return 0;
  }
  const roll = s.roll;
  const v = t.skills[i] ?? 0;
  // No skill rises past 100, whatever a cap says.
  const cap = Math.min(SKILL_MAX, extra.cap ?? capValue(s.cap, t.faction));
  const reading: Reading = { t, skill: v, tier: extra.tier ?? 0, damage: extra.damage ?? 0 };
  const n = () => evalFormula(roll, reading, rng);
  let ok: boolean;
  switch (source) {
    case "defend":
      // 1.6 rolled before testing anything.
      ok = rng.random(n()) === 1 && v < cap && v > 0 && requirementMet(t, s);
      break;
    case "kill": {
      if (!(v > 0 && v < cap)) {
        return 0;
      }
      const hit = rng.random(n()) === 1;
      ok = (!s.monsterCap || v < (extra.monsterCap ?? Infinity)) && hit && requirementMet(t, s);
      break;
    }
    case "gather":
    case "craft":
      if (v < (s.min ?? 0) || v >= cap) {
        return 0;
      }
      ok = rng.random(n()) === 1 && requirementMet(t, s);
      break;
    default:
      if (!(v > 0 && v < cap)) {
        return 0;
      }
      ok = rng.random(n()) === 1 && requirementMet(t, s);
  }
  if (!ok) {
    return 0;
  }
  t.skills[i] = v + 1;
  return 1;
}

/** Adds XP to an `xp` skill and raises its level to match; returns the levels gained. */
export function addXp(
  t: Trainee,
  i: number,
  amount: number,
  /** The highest level this XP may reach (an item's `upTo`), besides the skill's caps. */
  upTo = SKILL_MAX,
  /** A cap that replaces the skill's own (a spell school's `cap`); the curve's still holds. */
  over?: number,
): number {
  const r = RESOLVED[i];
  if (r?.model !== "xp" || !t.skillXp) {
    return 0;
  }
  const cap = Math.min(upTo, capOf(r, t.faction, over));
  let level = t.skills[i] ?? 0;
  const gain = Math.trunc(amount);
  if (level >= cap || !(gain > 0)) {
    return 0;
  }
  const xp = heldXp(t.skillXp[i] ?? 0, level, r.totals, cap) + gain;
  let gained = 0;
  while (level < cap && xp >= (r.totals[level + 1] ?? Infinity)) {
    level += 1;
    gained += 1;
  }
  t.skillXp[i] = xp;
  t.skills[i] = level;
  return gained;
}

/**
 * Raises an `xp` skill's level by points (an item's teaching without `xp`): its XP moves to the new
 * level's start. A `chance` skill just takes the value.
 */
export function setLevel(t: Trainee, i: number, level: number): void {
  t.skills[i] = level;
  const r = RESOLVED[i];
  if (r?.model === "xp" && t.skillXp) {
    const lo = r.totals[Math.min(level, SKILL_MAX)] ?? 0;
    t.skillXp[i] = Number.isFinite(lo) ? Math.max(t.skillXp[i] ?? 0, lo) : (t.skillXp[i] ?? 0);
  }
}

function trainXp(
  t: Trainee,
  i: number,
  r: Extract<Resolved, { model: "xp" }>,
  s: XpSettings | undefined,
  rng: Rng,
  extra: TrainExtra,
): number {
  if (!s || !requirementMet(t, s)) {
    return 0;
  }
  const level = t.skills[i] ?? 0;
  if (level >= capOf(r, t.faction, extra.cap)) {
    return 0;
  }
  let amount = extra.xp;
  if (amount === undefined) {
    if (s.xp === undefined) {
      return 0;
    }
    const reading: Reading = { t, skill: level, tier: extra.tier ?? 0, damage: extra.damage ?? 0 };
    amount = evalFormula(s.xp, reading, rng);
  }
  return addXp(t, i, amount, SKILL_MAX, extra.cap);
}

/**
 * The line for a level gained, the world's `progression.line` with `{skill}` as the skill's display
 * name ("You have advanced in the art of Punch!").
 */
export function advancedText(skill: string): string {
  return content().classes.progression.line.replaceAll("{skill}", skillDisplay(skill));
}

/** One line per level gained by skill `i`. */
export function advancedLines(i: number, levels: number): string[] {
  const key = SKILL_KEYS[i] ?? "";
  return Array.from({ length: levels }, () => advancedText(key));
}
