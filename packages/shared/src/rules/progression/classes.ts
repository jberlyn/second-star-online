/**
 * Classes as the engine reads them (issue #15): what a class adds to its holders' play (stat
 * points, perks, how skills train) once its `inherits` chain is followed, and the ways into and out
 * of it (1.6's `promotion` and the class's `paths`). Pure; the results are cached per content.
 *
 * A class that `inherits` another starts from that class's resolved values and replaces them kind
 * by kind: each stat of `statBonus`, each perk kind, the class-wide training cap and speed, and each
 * skill's own. A loop in the chain stops where it comes back round.
 */
import type { ClassPath, ClassPerkKind, ClassRow } from "@secondstaronline/data";

import { content, onContent } from "../../content/store.ts";
import { findSkillIndex } from "../core/fighter.ts";
import { lingoEq } from "../core/lingo.ts";

type StatKey = "str" | "sta" | "dex" | "int" | "wis";

/** A class's values with its chain followed. */
export interface ResolvedClass {
  statBonus: Partial<Record<StatKey, number>>;
  perks: Partial<Record<ClassPerkKind, number>>;
  /** The class-wide training cap and speed; undefined when the chain sets none. */
  cap: number | undefined;
  percent: number | undefined;
  /** Each skill's own, by skill index. */
  skillCaps: Map<number, number>;
  skillPercents: Map<number, number>;
}

const EMPTY: ResolvedClass = {
  statBonus: {},
  perks: {},
  cap: undefined,
  percent: undefined,
  skillCaps: new Map(),
  skillPercents: new Map(),
};

let CACHE = new Map<number, ResolvedClass>();
let WAYS: ClassWay[] | null = null;
onContent(() => {
  CACHE = new Map();
  WAYS = null;
});

/** The class with code `code`, or undefined. */
export function classRow(code: number | undefined): ClassRow | undefined {
  return code === undefined ? undefined : content().classes.classes.find((c) => c.code === code);
}

/** The class named `name` (case ignored, as 1.6 compared names), or undefined. */
export function classNamed(name: string): ClassRow | undefined {
  return content().classes.classes.find((c) => lingoEq(c.name, name));
}

/** The class and the classes it inherits from, nearest first; a loop stops where it repeats. */
export function classChain(code: number | undefined): ClassRow[] {
  const out: ClassRow[] = [];
  const seen = new Set<number>();
  let row = classRow(code);
  while (row && !seen.has(row.code)) {
    out.push(row);
    seen.add(row.code);
    row = classRow(row.inherits);
  }
  return out;
}

/** Class `code`'s values, its chain followed (the farthest first, each nearer one on top). */
export function resolvedClass(code: number | undefined): ResolvedClass {
  if (code === undefined) {
    return EMPTY;
  }
  const hit = CACHE.get(code);
  if (hit) {
    return hit;
  }
  const out: ResolvedClass = {
    statBonus: {},
    perks: {},
    cap: undefined,
    percent: undefined,
    skillCaps: new Map(),
    skillPercents: new Map(),
  };
  for (const row of classChain(code).reverse()) {
    Object.assign(out.statBonus, row.statBonus ?? {});
    for (const p of row.perks ?? []) {
      out.perks[p.kind] = p.value;
    }
    const t = row.training;
    if (t?.cap !== undefined) {
      out.cap = t.cap;
    }
    if (t?.percent !== undefined) {
      out.percent = t.percent;
    }
    for (const s of t?.skills ?? []) {
      const i = findSkillIndex(s.skill);
      if (i === undefined) {
        continue;
      }
      if (s.cap !== undefined) {
        out.skillCaps.set(i, s.cap);
      }
      if (s.percent !== undefined) {
        out.skillPercents.set(i, s.percent);
      }
    }
  }
  CACHE.set(code, out);
  return out;
}

/** A class perk's value, or undefined when the class (and its chain) does not set it. */
export function classPerk(code: number | undefined, kind: ClassPerkKind): number | undefined {
  return resolvedClass(code).perks[kind];
}

/** A class perk to add to the faction perk of the same kind: 0 when unset. */
export function classPerkBonus(code: number | undefined, kind: ClassPerkKind): number {
  return classPerk(code, kind) ?? 0;
}

/**
 * The highest value skill `i` rises to in class `code`: the skill's own cap, else the class-wide
 * one; undefined when the class sets neither (the world's caps alone apply, as in 1.6).
 */
export function classSkillCap(code: number | undefined, i: number): number | undefined {
  const r = resolvedClass(code);
  return r.skillCaps.get(i) ?? r.cap;
}

/** How fast skill `i` trains in class `code`, in percent: 100 when the class sets nothing. */
export function classTrainPercent(code: number | undefined, i: number): number {
  const r = resolvedClass(code);
  return r.skillPercents.get(i) ?? r.percent ?? 100;
}

/** A chance roll's `n` (of `random(n) = 1`) at a speed: 0% never rises (Infinity). */
export function scaledRoll(n: number, percent: number): number {
  if (percent === 100) {
    return n;
  }
  if (percent <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(1, Math.round((n * 100) / percent));
}

/** An XP amount at a speed. */
export function scaledXp(amount: number, percent: number): number {
  return percent === 100 ? amount : Math.trunc((amount * percent) / 100);
}

// ---- ways into a class ------------------------------------------------------------------------

/**
 * One way into a class: a `paths` row, or 1.6's `promotion` read as one (`legacy`: its `from`
 * names, its one requirement, its SPmax floor and its skills raised to a roll of 1 to 10, with
 * 1.6's trainer texts).
 */
export interface ClassWay {
  to: ClassRow;
  /** The classes it is taken from, by code. */
  from: number[];
  where: "trainer" | "anywhere" | "both";
  requires: { needs: string; atLeast: number }[];
  gold: number;
  items: { item: string; qty: number; keep?: true }[];
  grants: NonNullable<ClassPath["grants"]>;
  /** 1.6's skill grants: each raised to a roll of 1 to 10 if below it. */
  rollSkills: string[];
  text: string | undefined;
  legacy: boolean;
}

/** Every way into every class, in class order (1.6's promotion first, then the paths). */
export function allClassWays(): ClassWay[] {
  if (WAYS) {
    return WAYS;
  }
  const classes = content().classes.classes;
  const out: ClassWay[] = [];
  for (const to of classes) {
    const p = to.promotion;
    if (p) {
      const spMax = p.statChanges.reduce<number | undefined>(
        (m, c) => Math.max(m ?? 0, c.atLeast),
        undefined,
      );
      out.push({
        to,
        from: classes.filter((c) => p.from.some((f) => lingoEq(f, c.name))).map((c) => c.code),
        where: "trainer",
        requires: [{ needs: p.requirement.stat, atLeast: p.requirement.min }],
        gold: 0,
        items: [],
        grants: spMax === undefined ? {} : { spMax },
        rollSkills: [...p.skillGrants],
        text: undefined,
        legacy: true,
      });
    }
    for (const path of to.paths ?? []) {
      out.push({
        to,
        from: [...path.from],
        where: path.where ?? "trainer",
        requires: path.requires ?? [],
        gold: path.gold ?? 0,
        items: path.items ?? [],
        grants: path.grants ?? {},
        rollSkills: [],
        text: path.text,
        legacy: false,
      });
    }
  }
  WAYS = out;
  return out;
}

/** The ways into class `code`. */
export function waysInto(code: number): ClassWay[] {
  return allClassWays().filter((w) => w.to.code === code);
}

/** The ways out of class `code`: every way whose `from` lists it. */
export function waysOutOf(code: number): ClassWay[] {
  return allClassWays().filter((w) => w.from.includes(code));
}

/** A way can be taken at a trainer. */
export const atTrainer = (w: ClassWay) => w.where !== "anywhere";
/** A way can be taken from the Class window. */
export const fromWindow = (w: ClassWay) => w.where !== "trainer";

// ---- words for players -------------------------------------------------------------------------

const signed = (v: number) => (v >= 0 ? `+${v}` : String(v));

const STAT_WORDS: Record<StatKey, string> = {
  str: "Strength",
  sta: "Stamina",
  dex: "Dexterity",
  int: "Intelligence",
  wis: "Wisdom",
};

/** Each perk as players read it. */
const PERK_WORDS: Record<ClassPerkKind, (v: number) => string> = {
  spellPower: (v) => `${signed(v)} spell power`,
  melee: (v) => `${signed(v)} melee attack power`,
  defence: (v) => `${signed(v)} defence (damage taken)`,
  regeneration: (v) => `HP and SP come back faster (${signed(v)})`,
  pvpParry: (v) => `Parries players more often (${signed(v)})`,
  pvpBlock: (v) => `Blocks players more often (${signed(v)})`,
  monsterDodge: (v) => `Dodges monsters more often (${signed(v)})`,
  hpPerLevel: (v) => `${signed(v)} full HP each level`,
  spPerLevel: (v) => `${signed(v)} full SP each level`,
};

/**
 * What class `code` gives, a line each, its chain followed: its stat points, its perks, then how
 * skills train in it. `skillName` turns a skill index into the name players see.
 */
export function classPerkLines(code: number, skillName: (i: number) => string): string[] {
  const r = resolvedClass(code);
  const out: string[] = [];
  for (const [k, v] of Object.entries(r.statBonus) as [StatKey, number][]) {
    if (v !== 0) {
      out.push(`${signed(v)} ${STAT_WORDS[k]}`);
    }
  }
  for (const [k, v] of Object.entries(r.perks) as [ClassPerkKind, number][]) {
    out.push(PERK_WORDS[k](v));
  }
  if (r.cap !== undefined) {
    out.push(`Skills rise to ${r.cap} at most`);
  }
  if (r.percent !== undefined && r.percent !== 100) {
    out.push(r.percent === 0 ? "Skills never rise" : `Skills train at ${r.percent}% speed`);
  }
  for (const [i, cap] of r.skillCaps) {
    out.push(`${skillName(i)} rises to ${cap} at most`);
  }
  for (const [i, percent] of r.skillPercents) {
    out.push(
      percent === 0 ? `${skillName(i)} never rises` : `${skillName(i)} trains at ${percent}% speed`,
    );
  }
  return out;
}

/** What a way gives, a line each, as players read it. */
export function wayGrantLines(w: ClassWay, skillName: (key: string) => string): string[] {
  const out: string[] = [];
  for (const s of w.rollSkills) {
    out.push(`${skillName(s)} raised to a roll of 1 to 10`);
  }
  for (const s of w.grants.skills ?? []) {
    out.push(`${skillName(s.skill)} raised to ${s.to}`);
  }
  if (w.grants.hpMax !== undefined) {
    out.push(`Full HP raised to ${w.grants.hpMax}`);
  }
  if (w.grants.spMax !== undefined) {
    out.push(`Full SP raised to ${w.grants.spMax}`);
  }
  for (const it of w.grants.items ?? []) {
    out.push(`Gives ${it.qty === 1 ? it.item : `${it.qty} ${it.item}`}`);
  }
  for (const spell of w.grants.spells ?? []) {
    out.push(`Teaches ${spell}`);
  }
  return out;
}

/**
 * The world uses the player's Class window (issue #15): some class has a description or a path.
 * Classic's classes have neither, so its players never see the window, as in 1.6.
 */
export function classWindowOn(): boolean {
  return content().classes.classes.some(
    (c) => c.description !== undefined || (c.paths?.length ?? 0) > 0,
  );
}
