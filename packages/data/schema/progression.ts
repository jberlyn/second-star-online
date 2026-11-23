/**
 * Schema for skill progression (issue #37 stage 6): how each skill rises, in `classes.json`.
 *
 * A skill picks a **model**: `chance` (1.6's: a `random(n) = 1` roll per action, one point on a
 * hit, below a cap) or `xp` (XP per action against a level curve). The **sources** are engine
 * events; which skills each trains is decided elsewhere (the weapon's `weaponSkills` row, the
 * skill bindings, a harvest node's `skill`, a spell's `school`):
 *
 * - `kill`: the weapon's skills, when its holder kills a monster;
 * - `shot`: the bound Archery (and Martial Arts with a crossbow) on each arrow shot;
 * - `defend`: the bound Parry and Block when struck;
 * - `cast`: the bound Magery and the spell's school on each cast;
 * - `gather`: a harvest node's skill, and the bound Fishing on each cast of the line;
 * - `craft`: the bound crafting skill of each craft;
 * - `hit`: the weapon's skills (or a spell's school) on each hit that does damage.
 *
 * World `defaults` per model and source apply to every skill; a skill's `on` overrides them field
 * by field, and `false` turns a source off for that skill. Each source keeps its own guard and
 * dice order in code, so the Classic numbers play exactly as in 1.6.
 */
import { z } from "zod";

/** The engine's progression sources. */
export const PROGRESSION_SOURCES = [
  "kill",
  "shot",
  "defend",
  "cast",
  "gather",
  "craft",
  "hit",
] as const;
export const progressionSourceSchema = z.enum(PROGRESSION_SOURCES);
export type ProgressionSource = z.infer<typeof progressionSourceSchema>;

/** The names a formula may read besides skills and stat tables. */
export const FORMULA_STATS = [
  "strength",
  "stamina",
  "intelligence",
  "wisdom",
  "dexterity",
] as const;

/**
 * A name a formula reads: a stat (`strength`, `stamina`, `intelligence`, `wisdom`, `dexterity`),
 * `skill` (the skill being trained), any skill by key, `level`, `tier` (the tool's tier, 0 without
 * one), `damage` (a hit's damage, capped at the target's HP left; `hit` only) or a stat table's
 * name (`progression.tables`). The publish check refuses unknown names.
 */
const formulaName = z.string().regex(/^[A-Za-z_]\w*$/);

/**
 * One row of a formula, in attack power's tier form: `when` (every `<name> <op> <n>` condition,
 * op `<` or `>`) gates the row; `op` applies `value` to the running result (which starts at 0).
 * `value` is a number, `random(n)` / `a + random(n)`, or a name.
 */
export const formulaRowSchema = z.strictObject({
  when: z
    .array(z.string().regex(/^[A-Za-z_]\w* [<>] -?\d{1,7}$/))
    .nullable()
    .optional(),
  op: z.enum(["set", "add", "subtract", "multiply"]),
  value: z.union([
    z.number().int().min(-999_999).max(999_999),
    z.string().regex(/^(?:(?:\d{1,6} \+ )?random\([1-9]\d{0,5}\))$/),
    formulaName,
  ]),
});
/** A formula: rows applied in order to a result that starts at 0. A bare number is `[set n]`. */
export const formulaSchema = z.union([
  z.number().int().min(-999_999).max(999_999),
  z.array(formulaRowSchema).min(1),
]);
export type FormulaRow = z.infer<typeof formulaRowSchema>;
export type Formula = z.infer<typeof formulaSchema>;

/**
 * A cap: `faction` (the faction perk `skillCap`), `mage` (the perk `mageCap`) or a fixed value. No
 * skill goes past 100.
 */
export const capSchema = z.union([
  z.literal("faction"),
  z.literal("mage"),
  z.number().int().min(0).max(100),
]);
export type Cap = z.infer<typeof capSchema>;

/** Another skill must be above a value (Classic: Thrust needs Slash over 30). */
export const progressionRequiresSchema = z.strictObject({
  skill: z.string().min(1),
  above: z.number().int().min(-1).max(100),
});

/**
 * A source's `chance` settings. `roll` is the `n` of `random(n) = 1`; `cap` the value the skill
 * must be below; `requires` is tested after the roll, as 1.6 tested it; `monsterCap` (kill only)
 * also needs the skill below the killed monster's cap (`monsters.json` `skillCaps`); `min` (gather
 * and craft) is the lowest value that rolls: the other sources need the skill above 0.
 */
export const chanceSettingsSchema = z.strictObject({
  roll: formulaSchema.optional(),
  cap: capSchema.optional(),
  requires: progressionRequiresSchema.nullable().optional(),
  monsterCap: z.boolean().optional(),
  min: z.number().int().min(0).max(100).optional(),
});
export type ChanceSettings = z.infer<typeof chanceSettingsSchema>;

/**
 * A source's `xp` settings: the XP each action gives (a harvest node's, craft recipe's or monster's
 * own `xp` replaces it), and an optional skill that must be above a value first.
 */
export const xpSettingsSchema = z.strictObject({
  xp: formulaSchema.optional(),
  requires: progressionRequiresSchema.nullable().optional(),
});
export type XpSettings = z.infer<typeof xpSettingsSchema>;

/** Settings by source; `false` turns a source off. */
function sources<T extends z.ZodType>(settings: T) {
  const v = z.union([settings, z.literal(false)]).optional();
  return z.strictObject({ kill: v, shot: v, defend: v, cast: v, gather: v, craft: v, hit: v });
}
const chanceSourcesSchema = sources(chanceSettingsSchema);
const xpSourcesSchema = sources(xpSettingsSchema);

/**
 * A skill's progression. Absent: `chance` with the world defaults. `curve` and `cap` are read by the
 * `xp` model only (its level cap; the curve's own `cap` applies too).
 */
export const skillProgressionSchema = z.discriminatedUnion("model", [
  z.strictObject({ model: z.literal("chance"), on: chanceSourcesSchema.optional() }),
  z.strictObject({
    model: z.literal("xp"),
    curve: z.string().min(1),
    cap: capSchema.optional(),
    on: xpSourcesSchema.optional(),
  }),
]);
export type SkillProgression = z.infer<typeof skillProgressionSchema>;

/**
 * A stat table: `start`, plus `add` for every tier whose stat is above `above`, in order (Classic's
 * `wisdomBonus`: 30, less 5, 7, 8, 5, 2 and 3 as Wisdom passes 5, 10, 15, 20, 22 and 23).
 */
export const statTableSchema = z.strictObject({
  stat: z.enum([...FORMULA_STATS, "level"]),
  start: z.number().int().min(-999_999).max(999_999),
  tiers: z.array(
    z.strictObject({
      above: z.number().int().min(-1).max(999_999),
      add: z.number().int().min(-999_999).max(999_999),
    }),
  ),
});
export type StatTable = z.infer<typeof statTableSchema>;

/**
 * A level curve (shared with character levels, #42): what leaving each level takes. Level L reads
 * `table[L]` while the table lasts, then `formula` (which may read only `level`, L). `counting`
 * says how the table and formula are read and shown: `perLevel`, the XP from L to L + 1 (counted
 * from 0 within each level, leftovers carried); `total`, the running total that reaches L + 1. XP
 * is saved as a running total either way. `cap` is the highest level the curve reaches.
 */
export const curveSchema = z.strictObject({
  counting: z.enum(["perLevel", "total"]),
  table: z.array(z.number().int().min(0).max(1_000_000_000_000)).optional(),
  formula: formulaSchema.optional(),
  cap: z.number().int().min(1).max(100).optional(),
});
export type Curve = z.infer<typeof curveSchema>;

/** The world's progression settings. */
export const progressionSchema = z.strictObject({
  /**
   * The line printed when any skill rises, `{skill}` being its display name. An `xp` skill prints
   * it once per level gained.
   */
  line: z.string().min(1).max(200),
  tables: z.record(formulaName, statTableSchema),
  curves: z.record(z.string().min(1), curveSchema),
  defaults: z.strictObject({ chance: chanceSourcesSchema, xp: xpSourcesSchema }),
});
export type ProgressionData = z.infer<typeof progressionSchema>;

// ---- the publish check ---------------------------------------------------------------------

/** The largest roll or XP amount a formula may give. */
export const FORMULA_MAX = 1_000_000_000;
/** The largest running XP total a curve may need. */
export const CURVE_MAX = 1_000_000_000_000;

interface Range {
  lo: number;
  hi: number;
}

export interface ProgressionIssue {
  path: (string | number)[];
  message: string;
}

const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();

/** What a name can read: the range a formula's value may take. */
function nameRange(
  name: string,
  ctx: { skills: Set<string>; tables: Record<string, StatTable>; damage: boolean; curve: boolean },
): Range | string {
  if (ctx.curve) {
    return name === "level"
      ? { lo: 0, hi: 100 }
      : `a curve's formula reads only level, not ${name}`;
  }
  if ((FORMULA_STATS as readonly string[]).includes(name)) {
    return { lo: 0, hi: 1000 };
  }
  if (name === "skill") {
    return { lo: 0, hi: 100 };
  }
  if (name === "level") {
    return { lo: 1, hi: 1000 };
  }
  if (name === "tier") {
    return { lo: 0, hi: 99_999 };
  }
  if (name === "damage") {
    return ctx.damage ? { lo: 0, hi: 1_000_000 } : "only a hit's formula reads damage";
  }
  const table = Object.hasOwn(ctx.tables, name) ? ctx.tables[name] : undefined;
  if (table) {
    return tableRange(table);
  }
  if (ctx.skills.has(norm(name))) {
    return { lo: 0, hi: 100 };
  }
  return `${name} is not a stat, skill, table, level, tier or damage`;
}

/** A stat table's lowest and highest value over every stat value. */
export function tableRange(t: StatTable): Range {
  const points = [-Infinity, ...t.tiers.map((r) => r.above + 1)];
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of points) {
    let v = t.start;
    for (const r of t.tiers) {
      if (p > r.above) {
        v += r.add;
      }
    }
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  return { lo, hi };
}

const RANDOM = /^(?:(\d+) \+ )?random\((\d+)\)$/;

/** A formula's range, or the problems found in it. */
export function formulaRange(
  f: Formula,
  ctx: { skills: Set<string>; tables: Record<string, StatTable>; damage: boolean; curve: boolean },
): { range: Range; problems: ProgressionIssue[] } {
  const problems: ProgressionIssue[] = [];
  if (typeof f === "number") {
    return { range: { lo: f, hi: f }, problems };
  }
  let r: Range = { lo: 0, hi: 0 };
  f.forEach((row, i) => {
    let v: Range;
    if (typeof row.value === "number") {
      v = { lo: row.value, hi: row.value };
    } else {
      const m = RANDOM.exec(row.value);
      if (m) {
        if (ctx.curve) {
          problems.push({ path: [i, "value"], message: "a curve cannot roll random" });
        }
        const a = Number(m[1] ?? 0);
        v = { lo: a + 1, hi: a + Number(m[2]) };
      } else {
        const n = nameRange(row.value, ctx);
        if (typeof n === "string") {
          problems.push({ path: [i, "value"], message: n });
          v = { lo: 0, hi: 0 };
        } else {
          v = n;
        }
      }
    }
    for (const [j, cond] of (row.when ?? []).entries()) {
      const name = cond.split(" ")[0] ?? "";
      const n = nameRange(name, ctx);
      if (typeof n === "string") {
        problems.push({ path: [i, "when", j], message: n });
      }
    }
    let next: Range;
    switch (row.op) {
      case "set":
        next = v;
        break;
      case "add":
        next = { lo: r.lo + v.lo, hi: r.hi + v.hi };
        break;
      case "subtract":
        next = { lo: r.lo - v.hi, hi: r.hi - v.lo };
        break;
      case "multiply": {
        const p = [r.lo * v.lo, r.lo * v.hi, r.hi * v.lo, r.hi * v.hi];
        next = { lo: Math.min(...p), hi: Math.max(...p) };
        break;
      }
    }
    // A gated row may or may not apply.
    r = row.when?.length ? { lo: Math.min(r.lo, next.lo), hi: Math.max(r.hi, next.hi) } : next;
  });
  return { range: r, problems };
}

/** What leaving level `level` takes on a curve (`table`, then `formula`), or null past both. */
export function curveNeed(c: Curve, level: number, formula: (f: Formula, level: number) => number) {
  const t = c.table?.[level];
  if (t !== undefined) {
    return t;
  }
  return c.formula === undefined ? null : formula(c.formula, level);
}

/** A formula with no names but `level` and no dice: what a curve evaluates. */
export function evalCurveFormula(f: Formula, level: number): number {
  if (typeof f === "number") {
    return f;
  }
  let r = 0;
  for (const row of f) {
    const applies = (row.when ?? []).every((cond) => {
      const [, op, n] = cond.split(" ");
      return op === "<" ? level < Number(n) : level > Number(n);
    });
    if (!applies) {
      continue;
    }
    const v = typeof row.value === "number" ? row.value : level;
    r = row.op === "set" ? v : row.op === "add" ? r + v : row.op === "subtract" ? r - v : r * v;
  }
  return r;
}

/**
 * Checks a world's progression against its skills: every formula reads only names it may, and
 * can give a usable result (a roll or XP amount of at least 1 and at most `FORMULA_MAX`); every
 * curve covers its levels with whole, never-falling totals; every `xp` skill names a curve; and
 * every requirement names a skill.
 */
export function checkProgression(
  p: ProgressionData,
  skillRows: readonly { skill: string; progression?: SkillProgression | undefined }[],
): ProgressionIssue[] {
  const out: ProgressionIssue[] = [];
  const skills = new Set(skillRows.map((s) => norm(s.skill)));
  for (const name of Object.keys(p.tables)) {
    if (
      skills.has(norm(name)) ||
      (FORMULA_STATS as readonly string[]).includes(name) ||
      ["skill", "level", "tier", "damage"].includes(name)
    ) {
      out.push({
        path: ["progression", "tables", name],
        message: `${name} is already a name formulas read`,
      });
    }
  }
  const settings = (
    s: ChanceSettings | XpSettings,
    source: ProgressionSource,
    path: (string | number)[],
    /** The skill whose progression it is, or null for the world's defaults. */
    owner: string | null,
  ) => {
    const whose =
      owner === null ? `The default ${source} progression` : `${owner}'s ${source} progression`;
    if (s.requires && !skills.has(norm(s.requires.skill))) {
      out.push({
        path: [...path, "requires", "skill"],
        message: `${whose} needs ${s.requires.skill}, which is not in skills`,
      });
    }
    if ("monsterCap" in s && s.monsterCap && source !== "kill") {
      out.push({ path: [...path, "monsterCap"], message: "only a kill has a monster's cap" });
    }
    if ("min" in s && s.min !== undefined && source !== "gather" && source !== "craft") {
      out.push({ path: [...path, "min"], message: "only gather and craft read min" });
    }
    const f = "roll" in s ? s.roll : "xp" in s ? s.xp : undefined;
    const key = "roll" in s ? "roll" : "xp";
    if (f === undefined) {
      return;
    }
    const { range, problems } = formulaRange(f, {
      skills,
      tables: p.tables,
      damage: source === "hit",
      curve: false,
    });
    for (const q of problems) {
      out.push({ path: [...path, key, ...q.path], message: `${whose}: ${q.message}` });
    }
    if (problems.length === 0 && range.hi < 1) {
      out.push({ path: [...path, key], message: `can never be 1 or more (at most ${range.hi})` });
    }
    if (problems.length === 0 && range.hi > FORMULA_MAX) {
      out.push({ path: [...path, key], message: `can reach ${range.hi}, over ${FORMULA_MAX}` });
    }
  };
  const sourcesOf = (
    on: Partial<Record<ProgressionSource, ChanceSettings | XpSettings | false>> | undefined,
    path: (string | number)[],
    owner: string | null,
  ) => {
    for (const source of PROGRESSION_SOURCES) {
      const s = on?.[source];
      if (s) {
        settings(s, source, [...path, source], owner);
      }
    }
  };
  sourcesOf(p.defaults.chance, ["progression", "defaults", "chance"], null);
  sourcesOf(p.defaults.xp, ["progression", "defaults", "xp"], null);
  for (const [name, c] of Object.entries(p.curves)) {
    const path = ["progression", "curves", name];
    const problems =
      c.formula === undefined
        ? []
        : formulaRange(c.formula, { skills, tables: {}, damage: false, curve: true }).problems;
    for (const q of problems) {
      out.push({ path: [...path, "formula", ...q.path], message: q.message });
    }
    if (problems.length > 0) {
      continue;
    }
    let total = 0;
    let last = 0;
    for (let level = 0; level < (c.cap ?? 100); level++) {
      const need = curveNeed(c, level, evalCurveFormula);
      if (need === null) {
        out.push({ path, message: `says nothing for level ${level}: add table rows or a formula` });
        break;
      }
      if (!Number.isInteger(need) || need < 0) {
        out.push({
          path,
          message: `level ${level} needs ${need}, not a whole number of 0 or more`,
        });
        break;
      }
      if (c.counting === "total" && need < last) {
        out.push({ path, message: `level ${level}'s total ${need} is below level ${level - 1}'s` });
        break;
      }
      last = need;
      total = c.counting === "total" ? need : total + need;
      if (total > CURVE_MAX) {
        out.push({ path, message: `reaches ${total} XP by level ${level + 1}, over ${CURVE_MAX}` });
        break;
      }
    }
  }
  skillRows.forEach((row, i) => {
    const prog = row.progression;
    if (!prog) {
      return;
    }
    const path = ["skills", i, "progression"];
    if (prog.model === "xp" && !Object.hasOwn(p.curves, prog.curve)) {
      out.push({ path: [...path, "curve"], message: `${prog.curve} is not in progression.curves` });
    }
    sourcesOf(prog.on, [...path, "on"], row.skill);
  });
  return out;
}

/** Every skill name a formula reads (a `value` or a `when` condition's name). */
function formulaNames(f: Formula | undefined): string[] {
  if (f === undefined || typeof f === "number") {
    return [];
  }
  return f.flatMap((row) => [
    ...(typeof row.value === "string" && !RANDOM.test(row.value) ? [row.value] : []),
    ...(row.when ?? []).map((c) => c.split(" ")[0] ?? ""),
  ]);
}

/**
 * What depends on skill `name` in the world's progression: each skill whose own progression names
 * it (a `requires` or a formula), by key, and "the world's defaults" when they do. A skill may not
 * be removed while anything does.
 */
export function skillDependents(
  p: ProgressionData,
  skillRows: readonly { skill: string; progression?: SkillProgression | undefined }[],
  name: string,
): string[] {
  const target = norm(name);
  const names = (
    on: Partial<Record<ProgressionSource, ChanceSettings | XpSettings | false>> | undefined,
  ) =>
    PROGRESSION_SOURCES.flatMap((source) => {
      const s = on?.[source];
      if (!s) {
        return [];
      }
      return [
        ...(s.requires ? [s.requires.skill] : []),
        ...formulaNames("roll" in s ? s.roll : undefined),
        ...formulaNames("xp" in s ? s.xp : undefined),
      ];
    }).map(norm);
  const out = skillRows
    .filter((r) => norm(r.skill) !== target && names(r.progression?.on).includes(target))
    .map((r) => r.skill);
  if ([...names(p.defaults.chance), ...names(p.defaults.xp)].includes(target)) {
    out.push("the world's defaults");
  }
  return out;
}
