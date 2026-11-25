/**
 * The Control Panel's progression and gathering previews (issue #38), computed with the game's own
 * rules, so a preview says what play does: a formula through `formulaValue` (the evaluator `train`
 * runs), a `chance` source's guards through `chanceRolls` and `chanceCounts`, an `xp` curve through
 * `curveTotals`, and a harvest node through `hitsPerSuccess` and `yieldOdds`. Pure: the page passes
 * the draft's tables and skills, never the installed store's.
 */
import type {
  ChanceSettings,
  Curve,
  Formula,
  HarvestNode,
  ProgressionSource,
  StatTable,
  XpSettings,
  YieldTable,
} from "@secondstaronline/data";

import type { Rng } from "../core/lingo.ts";
import { ruleMatches } from "../core/patterns.ts";
import { fishCheck, fishFor, hitsPerSuccess, yieldOdds } from "../crafting/gather.ts";
import {
  chanceCounts,
  chanceRolls,
  curveTotals,
  type FormulaEnv,
  formulaValue,
  SKILL_MAX,
  type Trainee,
} from "./progress.ts";

/** The character a preview imagines: a level and the five stats. */
export interface PreviewStats {
  level: number;
  str: number;
  sta: number;
  int: number;
  wis: number;
  dex: number;
}

/** What a preview reads besides the trained skill. */
export interface PreviewContext {
  stats: PreviewStats;
  /** The draft's stat tables. */
  tables: Readonly<Record<string, StatTable>>;
  /** Every other skill's value (a formula or a requirement that names one). */
  otherSkills: number;
  /** The tool's tier (`tier`), 0 without one. */
  tier: number;
  /**
   * What a `faction` and a `mage` cap stand for: the faction perks' values (an unaffiliated
   * character's are the world's `perkDefaults`).
   */
  caps: { faction: number; mage: number };
  /** A hit's damage (`damage`, the `hit` source's), already capped at the target's HP left. */
  damage: number;
  /** The killed monster's skill cap (a `kill` with `monsterCap`); null for none. */
  monsterCap: number | null;
}

const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();

/** The most dice combinations a formula is enumerated over before it is sampled. */
const MAX_OUTCOMES = 4096;
/** How many draws a formula with more combinations than that is sampled with. */
const SAMPLES = 2000;

/**
 * Every value a formula can give, with its probability: each `random(n)` it rolls (only the rows
 * that apply roll, in row order) is enumerated, and a formula with more than `MAX_OUTCOMES`
 * combinations is sampled with a fixed seed instead.
 */
export function formulaOutcomes(
  f: Formula,
  at: { t: Trainee; skill: number; tier?: number; damage?: number },
  env: FormulaEnv,
): { value: number; p: number }[] {
  if (typeof f === "number") {
    return [{ value: f, p: 1 }];
  }
  const out = new Map<number, number>();
  // An odometer over the dice: `picks` are the values given so far, `bounds` what each call asked.
  let picks: number[] = [];
  let combos = 1;
  for (;;) {
    const bounds: number[] = [];
    let call = 0;
    const rng: Rng = {
      random(n) {
        const i = call++;
        const b = n >= 1 ? Math.floor(n) : 0;
        bounds[i] = b;
        if (b === 0) {
          return 0;
        }
        return picks[i] ?? 1;
      },
    };
    const value = formulaValue(f, at, env, rng);
    combos = bounds.reduce((n, b) => n * Math.max(1, b), 1);
    if (combos > MAX_OUTCOMES) {
      break;
    }
    out.set(value, (out.get(value) ?? 0) + 1 / combos);
    // The next combination: the last die that can go up does, and every die after it starts over.
    let i = bounds.length - 1;
    const next = bounds.map((_, j) => picks[j] ?? 1);
    while (i >= 0 && (next[i] ?? 1) >= Math.max(1, bounds[i] ?? 1)) {
      i -= 1;
    }
    if (i < 0) {
      return [...out].map(([value, p]) => ({ value, p }));
    }
    next[i] = (next[i] ?? 1) + 1;
    picks = next.slice(0, i + 1);
  }
  // Too many combinations: sample (a fixed seed, so a preview reads the same each time).
  out.clear();
  let a = 0x2f6b_4d1c;
  const rng: Rng = {
    random(n) {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      return n >= 1 ? 1 + Math.floor(r * Math.floor(n)) : 0;
    },
  };
  for (let k = 0; k < SAMPLES; k++) {
    const value = formulaValue(f, at, env, rng);
    out.set(value, (out.get(value) ?? 0) + 1 / SAMPLES);
  }
  return [...out].map(([value, p]) => ({ value, p }));
}

/** A formula's mean value. */
export function formulaMean(
  f: Formula,
  at: { t: Trainee; skill: number; tier?: number; damage?: number },
  env: FormulaEnv,
): number {
  return formulaOutcomes(f, at, env).reduce((m, o) => m + o.value * o.p, 0);
}

/** The trainee and formula environment a preview imagines at skill value `v`. */
function imagined(skill: string, v: number, ctx: PreviewContext): { t: Trainee; env: FormulaEnv } {
  const t: Trainee = {
    level: ctx.stats.level,
    str: ctx.stats.str,
    sta: ctx.stats.sta,
    int: ctx.stats.int,
    wis: ctx.stats.wis,
    dex: ctx.stats.dex,
    skills: [],
    faction: { key: null, tier: 0 },
  };
  const env: FormulaEnv = {
    tables: ctx.tables,
    skill: (name) => (norm(name) === norm(skill) ? v : ctx.otherSkills),
  };
  return { t, env };
}

/** A requirement's test at value `v` of the trained skill. */
function requirementOk(
  s: ChanceSettings | XpSettings,
  skill: string,
  v: number,
  ctx: PreviewContext,
): boolean {
  if (!s.requires) {
    return true;
  }
  const have = norm(s.requires.skill) === norm(skill) ? v : ctx.otherSkills;
  return have > s.requires.above;
}

/** A cap as the preview reads it: a `faction` or `mage` cap is the context's; never past 100. */
export function previewCap(cap: ChanceSettings["cap"], ctx: PreviewContext): number {
  const c =
    cap === undefined
      ? SKILL_MAX
      : typeof cap === "number"
        ? cap
        : cap === "faction"
          ? ctx.caps.faction
          : ctx.caps.mage;
  return Math.min(SKILL_MAX, c);
}

/** One row of a `chance` source's preview. */
export interface ChancePreviewRow {
  value: number;
  /** The chance one action raises the skill from this value (0 to 1). */
  chance: number;
  /** Why it cannot rise here, or null when it can. */
  why: string | null;
}

/**
 * A `chance` source's chance to advance at each value from 0 to 100: the source's guards, the
 * requirement and (with `monsterCap`) a monster's cap as `train` tests them, and the mean of
 * 1 / `roll` over the formula's dice.
 */
export function chancePreview(
  skill: string,
  source: ProgressionSource,
  s: ChanceSettings,
  ctx: PreviewContext,
): ChancePreviewRow[] {
  const cap = previewCap(s.cap, ctx);
  const monsterCap = ctx.monsterCap ?? undefined;
  const rows: ChancePreviewRow[] = [];
  for (let v = 0; v <= SKILL_MAX; v++) {
    if (s.roll === undefined) {
      rows.push({ value: v, chance: 0, why: "no roll" });
      continue;
    }
    const counts = chanceCounts(source, s, v, cap, monsterCap, requirementOk(s, skill, v, ctx));
    if (!chanceRolls(source, s, v, cap) || !counts) {
      const why =
        v >= cap
          ? `at its cap (${cap})`
          : !requirementOk(s, skill, v, ctx)
            ? `needs ${s.requires?.skill} above ${s.requires?.above}`
            : source === "gather" || source === "craft"
              ? `below its minimum (${s.min ?? 0})`
              : s.monsterCap && monsterCap !== undefined && v >= monsterCap
                ? `at the monster's cap (${monsterCap})`
                : "at 0 it never rises";
      rows.push({ value: v, chance: 0, why });
      continue;
    }
    const { t, env } = imagined(skill, v, ctx);
    const chance = formulaOutcomes(
      s.roll,
      { t, skill: v, tier: ctx.tier, damage: ctx.damage },
      env,
    ).reduce((m, o) => m + (o.value >= 1 ? o.p / Math.floor(o.value) : 0), 0);
    rows.push({ value: v, chance, why: null });
  }
  return rows;
}

/** One level of an `xp` skill's preview. */
export interface XpPreviewRow {
  level: number;
  /** The running XP total that reaches this level. */
  total: number;
  /** The XP from this level to the next (null at the last level). */
  need: number | null;
  /** The XP one action gives at this level (its mean when it rolls dice; 0: none here). */
  perAction: number;
  /** `perAction` rolls dice, so the actions are an estimate from its mean. */
  estimate: boolean;
  /**
   * The actions spent at this level, playing from level 0 with leftovers carried as `addXp`
   * carries them (a level jumped over takes 0); null when it is never left.
   */
  actions: number | null;
}

/**
 * An `xp` skill's level table (the XP to reach each level, from `curveTotals`) and the actions
 * each level takes, at `xp` per action (a node's, recipe's or monster's fixed amount) or the
 * source's formula at each level. The runtime's guards come first, as `trainXp` tests them (no
 * settings for the source, or an unmet requirement, gives nothing, even with a fixed amount).
 * Levels stop at the skill's cap.
 */
export function xpPreview(
  skill: string,
  curve: Curve,
  cap: number,
  s: XpSettings | undefined,
  ctx: PreviewContext,
  xp?: number,
): XpPreviewRow[] {
  const totals = curveTotals(curve);
  const top = Math.min(SKILL_MAX, cap, curve.cap ?? SKILL_MAX);
  /** What one action gives at a level: whole XP as `addXp` adds it. */
  const award = (level: number): { each: number; estimate: boolean } => {
    // At its cap an action gives nothing, as `trainXp` refuses it.
    if (level >= top || !s || !requirementOk(s, skill, level, ctx)) {
      return { each: 0, estimate: false };
    }
    if (xp !== undefined) {
      return { each: Math.max(0, Math.trunc(xp)), estimate: false };
    }
    if (s.xp === undefined) {
      return { each: 0, estimate: false };
    }
    const { t, env } = imagined(skill, level, ctx);
    const out = formulaOutcomes(s.xp, { t, skill: level, tier: ctx.tier, damage: ctx.damage }, env);
    const mean = out.reduce((m, o) => m + Math.max(0, Math.trunc(o.value)) * o.p, 0);
    return { each: mean, estimate: out.length > 1 };
  };
  // Play it: from level 0 and 0 XP, each level's awards in turn, the remainder carried.
  const actions = new Map<number, number>();
  let level = 0;
  let have = 0;
  while (level < top) {
    const next = totals[level + 1] ?? Infinity;
    const { each } = award(level);
    if (!Number.isFinite(next) || !(each > 0)) {
      break;
    }
    const n = Math.max(0, Math.ceil((next - have) / each));
    actions.set(level, n);
    have += n * each;
    level += 1;
    while (level < top && have >= (totals[level + 1] ?? Infinity)) {
      actions.set(level, 0);
      level += 1;
    }
  }
  const rows: XpPreviewRow[] = [];
  for (let l = 0; l <= top; l++) {
    const total = totals[l] ?? Infinity;
    if (!Number.isFinite(total)) {
      break;
    }
    const next = l < top ? (totals[l + 1] ?? Infinity) : Infinity;
    const { each, estimate } = award(l);
    rows.push({
      level: l,
      total,
      need: Number.isFinite(next) ? next - total : null,
      perAction: each,
      estimate,
      actions: actions.get(l) ?? null,
    });
  }
  return rows;
}

/**
 * The tools that can work a harvest node and their tiers, as `nodeTool` resolves them: a use of
 * the node's kind, by one of the node's exact `tools` when it names them (each tool at its best
 * tier for the kind), else every tool row of the kind.
 */
export function nodeToolTiers(
  node: Pick<HarvestNode, "can" | "tools">,
  tools: readonly { match: "exact" | "contains"; pattern: string; can: string; tier: number }[],
): { tool: string; tier: number }[] {
  const rows = tools.filter((t) => t.can === node.can);
  if (!node.tools) {
    return rows.map((t) => ({
      tool: t.match === "exact" ? t.pattern : `any "${t.pattern}"`,
      tier: t.tier,
    }));
  }
  return node.tools.flatMap((name) => {
    const tiers = rows.filter((r) => ruleMatches(name, r)).map((r) => r.tier);
    return tiers.length > 0 ? [{ tool: name, tier: Math.max(...tiers) }] : [];
  });
}

/** One cell of a harvest node's preview: a skill value with a tool tier. */
export interface GatherPreviewRow {
  skill: number;
  tier: number;
  /** Null when the node can be worked; else why not. */
  why: string | null;
  /** The swings each success takes (`hitsPerSuccess`); null when it never succeeds. */
  hits: number | null;
  /** The chance a swing succeeds. */
  success: number;
  /** The chance a success drops from the yield table. */
  drop: number;
  /** The drops a swing yields, on average. */
  perSwing: number;
}

/**
 * A harvest node at each skill value and tool tier: whether it can be worked (the node's tier and
 * requirement), the swings a success takes, the chance a swing succeeds, the chance a success drops
 * from its yield table (an ore strike: `findChance`) and the yield per swing.
 */
export function gatherPreview(
  node: HarvestNode,
  data: {
    counterTable: readonly { gt: number; value: number }[];
    yields: Readonly<Record<string, YieldTable>>;
    findChance?: number;
  },
  skills: readonly number[],
  tiers: readonly number[],
  /** The gatherer's level and other skills, for a requirement. */
  who: { level: number; otherSkills: number },
): GatherPreviewRow[] {
  const table =
    node.yield !== undefined && Object.hasOwn(data.yields, node.yield)
      ? data.yields[node.yield]
      : undefined;
  const rows: GatherPreviewRow[] = [];
  for (const tier of tiers) {
    for (const v of skills) {
      const r = node.requires;
      const have = !r
        ? 0
        : r.needs === "level"
          ? who.level
          : norm(r.needs) === norm(node.skill)
            ? v
            : who.otherSkills;
      const why =
        r && have < r.atLeast
          ? `needs ${r.needs} ${r.atLeast}`
          : tier < (node.tier ?? 1)
            ? `needs tier ${node.tier ?? 1}`
            : null;
      const loaded = hitsPerSuccess(data.counterTable, v);
      const hits = loaded >= 1 ? loaded : null;
      const success = why === null && hits !== null ? 1 / hits : 0;
      const drop = !table
        ? 0
        : table.kind === "ore"
          ? data.findChance && data.findChance >= 1
            ? 1 / Math.floor(data.findChance)
            : 0
          : 1 / Math.max(1, Math.floor(yieldOdds(table, v)));
      rows.push({ skill: v, tier, why, hits, success, drop, perSwing: success * drop });
    }
  }
  return rows;
}

/** The fish a Fishing skill bites with, and the chance of a bite (`fishFor`, `fishCheck`). */
export function fishingPreview(
  fishing: {
    bands: readonly { lt: number; fish: string }[];
    fishCheck: readonly { gt: number; value: number }[];
  },
  skills: readonly number[],
): { skill: number; fish: string | null; bite: number }[] {
  return skills.map((v) => {
    const n = fishCheck(v, fishing.fishCheck);
    return { skill: v, fish: fishFor(v, fishing.bands), bite: n >= 1 ? 1 / Math.floor(n) : 0 };
  });
}
