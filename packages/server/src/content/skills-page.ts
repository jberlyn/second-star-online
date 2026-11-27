/**
 * The Control Panel's Skills page on the server (issue #38): the skills in Skills-page order, one
 * skill's form (its name and place, who starts with it, its progression per source, its curve),
 * what trains it, and its removal through the where-used flow. Every change goes into the shared
 * content draft as ordinary rows, written as one change and refused when it brings a new problem.
 *
 * The rows a skill's form writes:
 * - `classes/skills/<key>`: its display name, `hidden` and progression;
 * - `classes/startClasses/<code>`: its start value in each start class;
 * - `classes/classes/<code>`: the promotions that grant it;
 * - `classes/skillOrder`: its place on the Skills page;
 * - `classes/progression`: the curve an `xp` skill levels by.
 */

import { z } from "zod";

import type { Curve } from "@secondstaronline/data";
import { curveSchema, skillProgressionSchema } from "@secondstaronline/data/schema";
import {
  type ContentData,
  type ContentProblemView,
  type ContentSkillsView,
  type ContentSkillUsage,
  type ContentSkillView,
  perkDefault,
  type SkillListEntry,
  type SkillTrainer,
  skillPageOrder,
} from "@secondstaronline/shared";

import type { DraftRow } from "../persistence/content.ts";
import { type RowRef, rowHash, rowLabel, rowValue, sameRow } from "./rows.ts";
import type { ContentActor, ContentResult, ContentService } from "./service.ts";
import { type JsonPath, referencesOf } from "./validate.ts";
import type { ContentWorld } from "./world.ts";

const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();
const fail = (error: string, problems?: ContentProblemView[]) =>
  ({ ok: false, error, ...(problems ? { problems } : {}) }) as const;

const skillRef = (key: string): RowRef => ({ dataset: "classes", part: "skills", key });
const PROGRESSION: RowRef = { dataset: "classes", part: "progression", key: null };
const ORDER: RowRef = { dataset: "classes", part: "skillOrder", key: null };
const startRef = (code: number): RowRef => ({
  dataset: "classes",
  part: "startClasses",
  key: String(code),
});
const classRef = (code: number): RowRef => ({
  dataset: "classes",
  part: "classes",
  key: String(code),
});

/** The progression sources, in the form's order. */
const SOURCES = ["kill", "shot", "defend", "cast", "gather", "craft", "hit"] as const;

/** The skill row in `d`, by any spelling. */
function skillRow(d: ContentData, key: string) {
  return d.classes.skills.find((s) => norm(s.skill) === norm(key));
}

/** What a `faction` and a `mage` cap are for an unaffiliated character. */
export const capsOf = (d: ContentData) => ({
  faction: perkDefault(d.social.factionRules, "skillCap"),
  mage: perkDefault(d.social.factionRules, "mageCap"),
});

/** A curve as the page loaded it (null: the name has none). */
export const curveFingerprint = (c: unknown) => (c === undefined || c === null ? null : rowHash(c));

/** A skill's place in the list. */
const indexOf = (d: ContentData, key: string) =>
  d.classes.skills.findIndex((s) => norm(s.skill) === norm(key));

/** The rows a skill's form reads, for its fingerprint and the pending marks. */
function formRefs(d: ContentData, key: string): RowRef[] {
  return [
    skillRef(key),
    PROGRESSION,
    ORDER,
    ...d.classes.startClasses.map((sc) => startRef(sc.code)),
    ...d.classes.classes.filter((c) => c.promotion).map((c) => classRef(c.code)),
  ];
}

/** What the skill's form shows, from `d`. */
function formState(d: ContentData, key: string) {
  const row = skillRow(d, key);
  if (!row) {
    return null;
  }
  const order = skillPageOrder(d.classes).findIndex((s) => s.skill === row.skill) + 1;
  const prog = row.progression;
  const curveName = prog?.model === "xp" ? prog.curve : null;
  return {
    row,
    order,
    starts: d.classes.startClasses.map((sc): [number, number | null] => [
      sc.code,
      sc.skills[row.skill] ?? null,
    ]),
    grants: d.classes.classes
      .filter((c) => c.promotion?.skillGrants.includes(row.skill))
      .map((c) => c.code),
    curve:
      curveName !== null && Object.hasOwn(d.classes.progression.curves, curveName)
        ? { name: curveName, curve: d.classes.progression.curves[curveName] as Curve }
        : null,
  };
}

/**
 * A skill as the Skills page last showed it: its form and what the draft holds for the rows the
 * form writes. A change naming another is refused. Null when the draft has no such skill.
 */
export function skillFingerprint(
  service: ContentService,
  key: string,
  draft: readonly DraftRow[] = service.draft(),
): string | null {
  const d = service.draftContent(draft);
  const state = formState(d, key);
  if (!state) {
    return null;
  }
  return rowHash({
    state,
    pending: formRefs(d, state.row.skill).map((r) => draft.find((x) => sameRow(x, r))?.op ?? null),
  });
}

/** What trains or reads a skill, from a reference to it. */
function trainerOf(d: ContentData, row: RowRef, path: JsonPath): SkillTrainer | null {
  const at = `${row.dataset}/${row.part}`;
  const n = (i: unknown) => Number(i);
  switch (at) {
    case "classes/skillGain": {
      const w = d.classes.skillGain.weaponSkills[n(path[1])];
      if (!w) {
        return null;
      }
      return {
        kind: "weapon",
        text:
          w.match === "exact"
            ? `${w.weapon}: a kill or a hit with it trains it (weapon skill row ${n(path[1]) + 1})`
            : `Any weapon whose name contains "${w.weapon}": a kill or a hit trains it (weapon skill row ${n(path[1]) + 1})`,
        page: "content",
        row: { dataset: "classes", part: "skillGain", key: null },
      };
    }
    case "items/definitions": {
      const item = String(row.key);
      const what =
        path[0] === "trains"
          ? "a kill or a hit with it trains it"
          : path[0] === "requires"
            ? "needs it to be used"
            : path[0] === "use"
              ? "teaches it (a skill book)"
              : path[0] === "ground"
                ? "a platform it makes needs it"
                : "its attack power reads it";
      return {
        kind: path[0] === "use" ? "book" : "item",
        text: `${item}: ${what}`,
        page: "items",
        item,
      };
    }
    case "gather/harvest": {
      const node = d.gather.harvest[n(path[0])];
      if (!node) {
        return null;
      }
      return {
        kind: "node",
        text:
          path[1] === "skill"
            ? `${node.can} tile ${node.tile}: each success ${node.gains ? "trains it" : "reads it (it does not train)"}`
            : `${node.can} tile ${node.tile}: needs it`,
        page: "gathering",
        node: n(path[0]),
      };
    }
    case "craft/recipes": {
      const r = (d.craft.recipes ?? []).find((x) => x.name === row.key);
      return {
        kind: "recipe",
        text: `${row.key}: each success trains it${r ? ` (needs ${r.level})` : ""}`,
        page: "content",
        row,
      };
    }
    case "gather/gathering":
      return {
        kind: "watering",
        text: "Watering: a Water tool's hit counter reads it",
        page: "gathering",
      };
    case "bindings/skills": {
      const b = String(path[0]);
      const crafts: Record<string, string> = {
        blacksmithing: "The smithing recipes",
        cooking: "The cooking recipes",
        alchemy: "The alchemy recipes",
        carpentry: "The carpentry recipes",
      };
      if (crafts[b]) {
        return {
          kind: "recipe",
          text: `${crafts[b]}: each craft trains it (the ${b} binding)`,
          page: "content",
          row: { dataset: "craft", part: "stations", key: null },
        };
      }
      if (b === "fishing") {
        const t = d.gather.gathering.fishing?.trains ?? { cast: true, catch: false };
        const when =
          t.cast && t.catch
            ? "each cast of the line and each catch train it"
            : t.catch
              ? "each catch trains it"
              : t.cast
                ? "each cast of the line trains it"
                : "nothing trains it";
        return {
          kind: "fishing",
          text: `Fishing: ${when} (the fishing binding)`,
          page: "gathering",
        };
      }
      return {
        kind: "binding",
        text:
          b === "magery"
            ? "Every cast trains it and reads it for power (the magery binding)"
            : `The ${b} binding: the engine reads it`,
        page: "content",
        row: { dataset: "bindings", part: "skills", key: null },
      };
    }
    case "classes/classes": {
      const c = d.classes.classes.find((x) => String(x.code) === row.key);
      const name = c?.name ?? row.key;
      return {
        kind: "promotion",
        text:
          path[0] === "training"
            ? `${name}: sets how it trains in the class`
            : path[0] === "paths"
              ? path[2] === "grants"
                ? `A way into ${name}: grants it`
                : `A way into ${name}: needs it`
              : path[1] === "skillGrants"
                ? `Promotion to ${name}: grants it`
                : `Promotion to ${name}: needs it`,
        page: "content",
        row,
      };
    }
    case "classes/startClasses":
      // Shown in the form's start values.
      return null;
    case "spells/spells":
      return {
        kind: "spell",
        text:
          path[0] === "school"
            ? `${row.key}: its school (each cast trains it)`
            : `${row.key}: its summon reads it`,
        page: "content",
        row,
      };
    case "itemRules/use":
      return {
        kind: "book",
        text: `Skill book row ${n(path[1]) + 1}: teaches it`,
        page: "content",
        row,
      };
    default:
      return {
        kind: "other",
        text: `${rowLabel(row)}: reads it`,
        page: "content",
        row,
      };
  }
}

/** One reference to a skill: a row, where in it, and what clearing it does. */
interface SkillUse {
  id: string;
  row: RowRef;
  path: JsonPath;
  where: string;
  /** What clearing drops, or null when it can only be pointed at another skill. */
  clear: { path: JsonPath; how: "entry" | "key" | "null" } | null;
  clears: string;
}

const isIndex = (p: unknown): p is number => typeof p === "number";

/** What clearing a reference drops: the list entry or the field that holds it, or null. */
function clearOf(row: RowRef, path: JsonPath): SkillUse["clear"] {
  const at = `${row.dataset}/${row.part}`;
  const p = path;
  // A formula row that reads it (a progression's roll or XP, a skill book's points or XP) goes.
  const f = p.findIndex(
    (x, i) => (x === "roll" || x === "xp" || x === "points") && isIndex(p[i + 1]),
  );
  if (f >= 0) {
    return { path: p.slice(0, f + 2), how: "entry" };
  }
  switch (at) {
    case "itemRules/ladders":
      // A ladder without a skill reads none.
      return { path: [p[0] as string, "skill"], how: "key" };
    case "classes/skillGain":
      // The skill from the row's list (a row left with none goes too).
      return { path: p.slice(0, 4), how: "entry" };
    case "classes/classes":
      // Issue #15: a class's own training row, a path's requirement or grant, goes.
      if (p[0] === "training") {
        return { path: p.slice(0, 3), how: "entry" };
      }
      if (p[0] === "paths") {
        return { path: p.slice(0, p[2] === "grants" ? 5 : 4), how: "entry" };
      }
      return p[1] === "skillGrants" ? { path: p.slice(0, 3), how: "entry" } : null;
    case "classes/startClasses":
      return { path: p, how: "key" };
    case "items/definitions":
      if (p[0] === "trains" || p[0] === "requires") {
        return { path: p.slice(0, 2), how: "entry" };
      }
      if (p[0] === "ground") {
        return { path: p.slice(0, 3), how: "entry" };
      }
      if (p[0] === "use") {
        return { path: ["use", "skillBook"], how: "key" };
      }
      // An attack block's tier: the tier goes.
      return isIndex(p[4]) ? { path: p.slice(0, 5), how: "entry" } : null;
    case "gather/harvest":
      return p[1] === "requires" ? { path: [p[0] as number, "requires"], how: "key" } : null;
    case "itemRules/requires":
      return { path: p.slice(0, 1), how: "entry" };
    case "itemRules/use":
    case "itemRules/ground":
      return { path: p.slice(0, 2), how: "entry" };
    case "spells/spells":
      // A summon's skilled form is nullable: it becomes null.
      return p[0] === "school"
        ? { path: ["school"], how: "key" }
        : { path: ["summon", "skilled"], how: "null" };
    case "social/assassin":
      return { path: p.slice(0, 3), how: "entry" };
    case "social/bios":
      return p[0] === "titles"
        ? { path: p.slice(0, 4), how: "entry" }
        : { path: p.slice(0, 3), how: "entry" };
    case "social/medals":
      return { path: p.slice(0, 2), how: "entry" };
    case "attPower/attPower":
      return { path: p.slice(0, 4), how: "entry" };
    case "spells/power": {
      // A tier: `base[i]` or `tables.<name>.tiers[i]`.
      const i = p.indexOf("when");
      return i > 0 ? { path: p.slice(0, i), how: "entry" } : null;
    }
    case "classes/skills":
    case "classes/progression": {
      // A requirement goes; a formula row naming it goes.
      const r = p.indexOf("requires");
      if (r >= 0) {
        return { path: p.slice(0, r + 1), how: "key" };
      }
      const f = p.findIndex((x) => x === "roll" || x === "xp");
      return f >= 0 && isIndex(p[f + 1]) ? { path: p.slice(0, f + 2), how: "entry" } : null;
    }
  }
  return null;
}

/** The progression references to a skill: other skills' requirements and formulas, the defaults. */
function progressionUses(d: ContentData, key: string): { row: RowRef; path: JsonPath }[] {
  const out: { row: RowRef; path: JsonPath }[] = [];
  const target = norm(key);
  const scan = (row: RowRef, base: JsonPath, on: Record<string, unknown> | undefined) => {
    for (const source of SOURCES) {
      const s = on?.[source] as Record<string, unknown> | false | undefined;
      if (!s) {
        continue;
      }
      const req = s.requires as { skill?: string } | null | undefined;
      if (req?.skill && norm(req.skill) === target) {
        out.push({ row, path: [...base, source, "requires", "skill"] });
      }
      for (const k of ["roll", "xp"]) {
        const f = s[k];
        if (!Array.isArray(f)) {
          continue;
        }
        f.forEach((r: { value?: unknown; when?: string[] | null }, i) => {
          if (typeof r.value === "string" && norm(r.value) === target) {
            out.push({ row, path: [...base, source, k, i, "value"] });
          }
          (r.when ?? []).forEach((c, j) => {
            if (norm(c.split(" ")[0] ?? "") === target) {
              out.push({ row, path: [...base, source, k, i, "when", j] });
            }
          });
        });
      }
    }
  };
  for (const s of d.classes.skills) {
    if (norm(s.skill) !== target && s.progression?.on) {
      scan(skillRef(s.skill), ["progression", "on"], s.progression.on as Record<string, unknown>);
    }
  }
  scan(PROGRESSION, ["defaults", "chance"], d.classes.progression.defaults.chance);
  scan(PROGRESSION, ["defaults", "xp"], d.classes.progression.defaults.xp);
  return out;
}

/** The formula rows a skill book reads it in: a legacy book row's or a definition's points or XP. */
function bookFormulaUses(d: ContentData, key: string): { row: RowRef; path: JsonPath }[] {
  const out: { row: RowRef; path: JsonPath }[] = [];
  const target = norm(key);
  const scan = (row: RowRef, base: JsonPath, book: Record<string, unknown> | undefined) => {
    for (const k of ["points", "xp"]) {
      const f = book?.[k];
      if (!Array.isArray(f)) {
        continue;
      }
      f.forEach((r: { value?: unknown; when?: string[] | null }, i) => {
        if (typeof r.value === "string" && norm(r.value) === target) {
          out.push({ row, path: [...base, k, i, "value"] });
        }
        (r.when ?? []).forEach((c, j) => {
          if (norm(c.split(" ")[0] ?? "") === target) {
            out.push({ row, path: [...base, k, i, "when", j] });
          }
        });
      });
    }
  };
  d.itemRules.use.skillBooks.forEach((b, i) => {
    scan({ dataset: "itemRules", part: "use", key: null }, ["skillBooks", i], b);
  });
  for (const def of d.items.definitions ?? []) {
    scan(
      { dataset: "items", part: "definitions", key: def.name },
      ["use", "skillBook"],
      def.use?.skillBook as Record<string, unknown> | undefined,
    );
  }
  return out;
}

/** Every reference to a skill in `d`, but the bindings (which refuse a removal). */
function usesIn(d: ContentData, key: string): SkillUse[] {
  const target = norm(key);
  const found = [
    ...referencesOf(d)
      .filter(
        (r) =>
          r.kind === "skill" &&
          norm(r.name) === target &&
          !(r.row.dataset === "bindings" && r.row.part === "skills"),
      )
      .map((r) => ({ row: r.row, path: r.path })),
    ...progressionUses(d, key),
    ...bookFormulaUses(d, key),
  ];
  const formula = (path: JsonPath) =>
    path.some((x) => x === "roll" || x === "points" || x === "xp") &&
    (path.at(-1) === "value" || path.at(-2) === "when");
  return found.map(({ row, path }) => {
    const clear = clearOf(row, path);
    const label = trainerOf(d, row, path)?.text ?? rowLabel(row);
    return {
      id: `${rowLabel(row)}|${path.join("/")}`,
      row,
      path,
      where:
        row.dataset === "classes" && row.part === "startClasses"
          ? `Start class ${row.key}: its start value`
          : row.dataset === "classes" && row.part === "skills"
            ? `${row.key}'s progression (${String(path[2])}): ${path.includes("requires") ? "its requirement" : "a formula row"}`
            : row.dataset === "classes" && row.part === "progression"
              ? `The world's default ${String(path[1])} progression (${String(path[2])})`
              : formula(path)
                ? `${label}: a formula row reads it`
                : label,
      clear,
      clears: clear === null ? "" : clearText(row, clear),
    };
  });
}

function clearText(row: RowRef, clear: NonNullable<SkillUse["clear"]>): string {
  const at = `${row.dataset}/${row.part}`;
  if (at === "classes/skillGain") {
    return "the skill comes off the weapon's row (a row left with none goes)";
  }
  if (at === "classes/startClasses") {
    return "the class no longer sets it";
  }
  if (clear.path.includes("requires")) {
    return "the requirement goes";
  }
  if (clear.path.includes("roll") || clear.path.includes("xp")) {
    return "the formula row goes";
  }
  return clear.how === "key" ? `${String(clear.path.at(-1))} goes` : "that entry goes";
}

/** The bindings in `d` that name a skill. */
function bindingsOf(d: ContentData, key: string): string[] {
  return Object.entries(d.bindings.skills)
    .filter(([, v]) => typeof v === "string" && norm(v) === norm(key))
    .map(([b]) => b);
}

// ---- the view ------------------------------------------------------------------------------

/** The Skills page's view: the list and, with `key`, that skill's form. */
export function skillsView(service: ContentService, key?: string): ContentSkillsView {
  const draft = service.draft();
  const d = service.draftContent(draft);
  const pack = service.packContent();
  const operator = service.operatorRows();
  const inPack = (k: string) => skillRow(pack, k) !== undefined;
  const changed = (k: string) => operator.some((r) => sameRow(r, skillRef(k)));
  const skills = skillPageOrder(d.classes).map(
    (s): SkillListEntry => ({
      skill: s.skill,
      display: s.display ?? s.skill,
      hidden: s.hidden === true,
      model: s.progression?.model ?? "chance",
      state: !inPack(s.skill) ? "yours" : changed(s.skill) ? "edited" : "pack",
      pending: draft.some((r) => sameRow(r, skillRef(s.skill))),
    }),
  );
  const classesRows = draft.filter((r) => r.dataset === "classes");
  const row = key === undefined ? undefined : skillRow(d, key);
  return {
    skills,
    skill: row ? skillView(service, row.skill, draft) : null,
    progression: structuredClone(d.classes.progression),
    keys: d.classes.skills.map((s) => s.skill),
    curveFingerprints: Object.fromEntries(
      Object.entries(d.classes.progression.curves).map(([k, c]) => [k, curveFingerprint(c) ?? ""]),
    ),
    caps: capsOf(d),
    otherDraft: draft.length - classesRows.length,
    skillDraft: classesRows.length,
  };
}

function skillView(
  service: ContentService,
  key: string,
  draft: readonly DraftRow[],
): ContentSkillView {
  const d = service.draftContent(draft);
  const state = formState(d, key);
  if (!state) {
    throw new Error(`no skill ${key}`);
  }
  const { row } = state;
  const trains: SkillTrainer[] = [];
  const seen = new Set<string>();
  for (const r of referencesOf(d)) {
    if (r.kind !== "skill" || norm(r.name) !== norm(key)) {
      continue;
    }
    const t = trainerOf(d, r.row, r.path);
    if (t && !seen.has(t.text)) {
      seen.add(t.text);
      trains.push(t);
    }
  }
  for (const u of progressionUses(d, key)) {
    trains.push({
      kind: "other",
      text:
        u.row.dataset === "classes" && u.row.part === "skills"
          ? `${u.row.key}'s ${String(u.path[2])} progression reads it`
          : `The world's default ${String(u.path[1])} progression (${String(u.path[2])}) reads it`,
      page: "content",
      row: u.row,
    });
  }
  const curveName = state.curve?.name;
  const notice = service.notices().find((n) => sameRow(n, skillRef(key)));
  return {
    skill: row.skill,
    row: structuredClone(row),
    order: state.order,
    inPack: skillRow(service.packContent(), key) !== undefined,
    published: skillRow(service.publishedContent(), key) !== undefined,
    starts: d.classes.startClasses.map((sc) => ({
      code: sc.code,
      label: sc.label ?? d.classes.classes.find((c) => c.code === sc.code)?.name ?? String(sc.code),
      value: sc.skills[row.skill] ?? null,
    })),
    promotions: d.classes.classes
      .filter((c) => c.promotion)
      .map((c) => ({
        code: c.code,
        name: c.name,
        grants: c.promotion?.skillGrants.includes(row.skill) ?? false,
      })),
    curve: state.curve
      ? {
          name: state.curve.name,
          curve: structuredClone(state.curve.curve) as NonNullable<
            ContentSkillView["curve"]
          >["curve"],
          sharedWith: d.classes.skills
            .filter(
              (s) =>
                s.skill !== row.skill &&
                s.progression?.model === "xp" &&
                s.progression.curve === curveName,
            )
            .map((s) => s.skill),
        }
      : null,
    trains,
    bindings: bindingsOf(d, key),
    // Any field of its form the draft changes (a start value or its place included).
    pending:
      draft.some((r) => sameRow(r, skillRef(row.skill))) ||
      rowHash(formFields(service.publishedContent(), row.skill)) !==
        rowHash(formFields(d, row.skill)),
    fingerprint: skillFingerprint(service, row.skill, draft) ?? "",
    ...packFormOf(service.packContent(), d, row.skill),
    notice: notice
      ? {
          packName: notice.packName,
          packVersion: notice.packVersion,
          note:
            notice.note ??
            `${notice.packName} v${notice.packVersion} changed this skill: answer it on the Publish Changes page.`,
        }
      : null,
  };
}

// ---- changes -------------------------------------------------------------------------------

/** What a Skills page save may carry. */
const skillFormSchema = z.strictObject({
  display: z.string().trim().max(40).optional(),
  hidden: z.boolean().optional(),
  /** Null: the `chance` model with the world's defaults. */
  progression: skillProgressionSchema.nullable().optional(),
  /** Its place on the Skills page, from 1. */
  order: z.number().int().min(1).max(1000).optional(),
  /** Start values by start class code (null: not set, so 1). */
  starts: z.record(z.string(), z.number().int().min(0).max(100).nullable()).optional(),
  /** The promotions (class codes) that grant it. */
  grants: z.array(z.number().int()).max(1000).optional(),
  /** The `xp` curve it levels by, written to the world's curves under `name`. */
  curve: z
    .strictObject({
      name: z.string().trim().min(1).max(40),
      curve: curveSchema,
      /**
       * The curve under `name` as the page loaded it into the form (`curveFingerprints`; null:
       * none). Required to change it, so an edit never writes over a newer one.
       */
      expect: z.string().max(64).nullable().optional(),
    })
    .nullable()
    .optional(),
});
type SkillForm = z.infer<typeof skillFormSchema>;

/**
 * A key a new skill may have: a letter, then letters, digits and underscores (Classic's keys are
 * all such), so every formula and condition can name it.
 */
const NEW_KEY = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

/** Each way a skill goes up, as the Skills page names it. */
const SOURCE_LABELS: Record<string, string> = {
  kill: "Killing a monster",
  shot: "Shooting arrows",
  defend: "Being attacked",
  cast: "Casting spells",
  gather: "Gathering",
  craft: "Crafting",
  hit: "Landing a hit",
};

/** A source's settings, as the Skills page labels them. */
const SETTING_LABELS: Record<string, string> = {
  roll: "Chance to go up",
  xp: "XP earned each time",
  cap: "Stops going up at",
  min: "Can go up from",
  monsterCap: "Also stops at the killed monster's skill cap",
  requires: "Only once another skill is high enough",
};

/** The skill's own fields, as the Skills page labels them. */
const SKILL_LABELS: Record<string, string> = {
  display: "Name players see",
  hidden: "Hide it from players' Skills page",
  skill: "ID",
};

/** A refused change's problems as the page says them: by the form's labels where it can. */
export function skillFieldProblems(
  key: string,
  problems: readonly { where: string; message: string }[],
  /** The skill's place in the list: a schema names it by its index. */
  index = -1,
): { where: string; message: string }[] {
  const owns = [`classes/skills/${key}`.toLowerCase(), `classes/skills/${index}`];
  return problems.map((p) => {
    const w = p.where.toLowerCase();
    const own = owns.find((o) => w === o || w.startsWith(`${o}/`));
    if (own) {
      const rest = p.where.slice(own.length).split("/").filter(Boolean);
      if (rest[0] === "progression" && rest[1] === "on" && rest[2]) {
        const row =
          rest[4] !== undefined && /^\d+$/.test(rest[4]) ? `, step ${Number(rest[4]) + 1}` : "";
        const field = rest[3] ? `: ${SETTING_LABELS[rest[3]] ?? rest[3]}${row}` : "";
        return {
          where: `How it goes up, ${SOURCE_LABELS[rest[2]] ?? rest[2]}${field}`,
          message: p.message,
        };
      }
      if (rest[0] === "progression") {
        return {
          where: rest[1] === "cap" ? "Stops levelling at" : "How it goes up",
          message: p.message,
        };
      }
      return { where: rest[0] ? (SKILL_LABELS[rest[0]] ?? rest[0]) : key, message: p.message };
    }
    if (w.startsWith("classes/progression/curves")) {
      return { where: "Level curve", message: p.message };
    }
    if (w.startsWith("classes/startclasses")) {
      return { where: "Starting values", message: p.message };
    }
    return p;
  });
}

/**
 * The form as `published` holds the skill, to write over the draft `d` (a discard): the start
 * classes and promotions are the draft's, each at the published value for this skill.
 */
function publishedForm(published: ContentData, d: ContentData, key: string): SkillForm | null {
  const ps = formState(published, key);
  if (!ps) {
    return null;
  }
  const pubStarts = new Map(ps.starts);
  const dCurve = ps.curve
    ? Object.hasOwn(d.classes.progression.curves, ps.curve.name)
      ? d.classes.progression.curves[ps.curve.name]
      : undefined
    : undefined;
  return {
    display: ps.row.display ?? "",
    hidden: ps.row.hidden === true,
    progression: ps.row.progression ?? null,
    order: ps.order,
    starts: Object.fromEntries(
      d.classes.startClasses.map((sc) => [String(sc.code), pubStarts.get(sc.code) ?? null]),
    ),
    grants: ps.grants.filter((code) =>
      d.classes.classes.some((c) => c.code === code && c.promotion),
    ),
    ...(ps.curve ? { curve: { ...ps.curve, expect: curveFingerprint(dCurve) } } : {}),
  };
}

/**
 * What the pack plays for skill `key`'s form, as the page fills it (null for a skill of the
 * operator's own), and whether the draft's form differs from it.
 */
function packFormOf(
  pack: ContentData,
  d: ContentData,
  key: string,
): Pick<ContentSkillView, "pack" | "differs"> {
  const ps = formState(pack, key);
  if (!ps) {
    return { pack: null, differs: false };
  }
  const pubStarts = new Map(ps.starts);
  const packForm = {
    display: ps.row.display ?? "",
    hidden: ps.row.hidden === true,
    progression: ps.row.progression ? structuredClone(ps.row.progression) : null,
    order: ps.order,
    starts: Object.fromEntries(
      d.classes.startClasses.map((sc) => [String(sc.code), pubStarts.get(sc.code) ?? null]),
    ),
    grants: ps.grants.filter((code) =>
      d.classes.classes.some((c) => c.code === code && c.promotion),
    ),
    curve: ps.curve ? { name: ps.curve.name, curve: structuredClone(ps.curve.curve) } : null,
  };
  return {
    pack: packForm,
    differs: rowHash(formFields(pack, key)) !== rowHash(formFields(d, key)),
  };
}

/** The skill's form fields in `d`, for whether the draft changes them. */
function formFields(d: ContentData, key: string) {
  const st = formState(d, key);
  return st
    ? {
        row: st.row,
        order: st.order,
        starts: Object.fromEntries(st.starts.filter(([, v]) => v !== null)),
        grants: st.grants,
        curve: st.curve,
      }
    : null;
}

/** The rows a form writes for skill `key`, from the draft `d`; empty when nothing changes. */
function formRows(
  d: ContentData,
  key: string,
  form: SkillForm,
  isNew: boolean,
): { ref: RowRef; op: "set"; data: unknown }[] | string {
  const current = skillRow(d, key);
  const rows: { ref: RowRef; op: "set"; data: unknown }[] = [];
  // The curve first: an `xp` skill must name a curve the world has.
  if (form.curve) {
    const p = d.classes.progression;
    const was = Object.hasOwn(p.curves, form.curve.name) ? p.curves[form.curve.name] : undefined;
    if (rowHash(was ?? null) !== rowHash(form.curve.curve)) {
      if (form.curve.expect === undefined || form.curve.expect !== curveFingerprint(was)) {
        return `The level curve ${form.curve.name} changed since you opened it (or the save named no revision): look at it again before saving.`;
      }
      rows.push({
        ref: PROGRESSION,
        op: "set",
        data: { ...p, curves: { ...p.curves, [form.curve.name]: form.curve.curve } },
      });
    }
  }
  const next: Record<string, unknown> = { ...(current ?? { skill: key }) };
  if (form.display !== undefined) {
    if (form.display === "" || form.display === key) {
      delete next.display;
    } else {
      next.display = form.display;
    }
  }
  if (form.hidden !== undefined) {
    if (form.hidden) {
      next.hidden = true;
    } else {
      delete next.hidden;
    }
  }
  if (form.progression !== undefined) {
    if (form.progression === null) {
      delete next.progression;
    } else {
      next.progression = form.progression;
    }
  }
  if (isNew || rowHash(next) !== rowHash(current)) {
    rows.push({ ref: skillRef(key), op: "set", data: next });
  }
  for (const [code, value] of Object.entries(form.starts ?? {})) {
    const sc = d.classes.startClasses.find((x) => String(x.code) === code);
    if (!sc) {
      return `there is no start class ${code}`;
    }
    const have = sc.skills[key] ?? null;
    if (have === value) {
      continue;
    }
    const skills = { ...sc.skills };
    if (value === null) {
      delete skills[key];
    } else {
      skills[key] = value;
    }
    rows.push({ ref: startRef(sc.code), op: "set", data: { ...sc, skills } });
  }
  if (form.grants) {
    const want = new Set(form.grants);
    for (const code of want) {
      if (!d.classes.classes.some((c) => c.code === code && c.promotion)) {
        return `class ${code} has no promotion`;
      }
    }
    for (const c of d.classes.classes) {
      if (!c.promotion) {
        continue;
      }
      const has = c.promotion.skillGrants.includes(key);
      if (has === want.has(c.code)) {
        continue;
      }
      const skillGrants = has
        ? c.promotion.skillGrants.filter((g) => g !== key)
        : [...c.promotion.skillGrants, key];
      rows.push({
        ref: classRef(c.code),
        op: "set",
        data: { ...c, promotion: { ...c.promotion, skillGrants } },
      });
    }
  }
  if (form.order !== undefined) {
    const keys = skillPageOrder(d.classes).map((s) => s.skill);
    if (isNew) {
      keys.push(key);
    }
    const at = keys.indexOf(key);
    const to = Math.min(form.order, keys.length) - 1;
    if (at !== to) {
      keys.splice(at, 1);
      keys.splice(to, 0, key);
      rows.push({ ref: ORDER, op: "set", data: keys });
    }
  }
  return rows;
}

/**
 * One Skills page change (issue #38): `set` the skill's form, `create` a new skill, or `discard`
 * the draft's change to its row. Refused when the skill changed since the page showed it.
 */
export function draftSkillChange(
  service: ContentService,
  actor: ContentActor,
  change: {
    key: string;
    op: "set" | "create" | "discard" | "revert";
    data?: unknown;
    expect?: string;
  },
): ContentResult<string> {
  const draft = service.draft();
  const d = service.draftContent(draft);
  const parsed =
    change.op === "discard" || change.op === "revert"
      ? null
      : skillFormSchema.safeParse(change.data ?? {});
  if (parsed && !parsed.success) {
    return fail(
      "The skill was not saved.",
      parsed.error.issues.map((i) => ({
        where: i.path.length > 0 ? i.path.join(" ") : "Form",
        message: i.message,
      })),
    );
  }
  const form = parsed?.data ?? {};
  if (change.op === "create") {
    const key = change.key.trim();
    if (!NEW_KEY.test(key)) {
      return fail(
        "A skill's key is one word: a letter, then letters, digits and underscores (formulas name skills by it).",
      );
    }
    const clash = d.classes.skills.find((s) => norm(s.skill) === norm(key));
    if (clash) {
      return fail(`There is already a skill ${clash.skill}.`);
    }
    // A key characters' values were once stored under keeps its exact spelling (they come back).
    const rows = formRows(d, key, { order: d.classes.skills.length + 1, ...form }, true);
    if (typeof rows === "string") {
      return fail(rows);
    }
    const r = service.draftChange(actor, rows);
    if (!r.ok) {
      return r.problems
        ? fail(`${key} was not made.`, skillFieldProblems(key, r.problems, d.classes.skills.length))
        : fail(r.error);
    }
    return { ok: true, value: `${key} is in the draft.` };
  }
  const row = skillRow(d, change.key);
  if (!row) {
    return fail(`There is no skill ${change.key}.`);
  }
  const key = row.skill;
  const label = row.display ?? key;
  if (skillFingerprint(service, key, draft) !== change.expect) {
    return fail(`${label} changed since you opened it: look at it again before saving.`);
  }
  if (change.op === "revert") {
    return revertSkill(service, actor, d, draft, key, label);
  }
  if (change.op === "discard") {
    const published = service.publishedContent();
    const rows: { ref: RowRef; op: DraftRow["op"] | "discard"; data: unknown }[] = [];
    if (skillRow(published, key) === undefined) {
      // A skill only the draft has takes its start values, grants and place with it.
      const cleanup = removalRows(d, key, new Map(), true);
      if (typeof cleanup === "string") {
        return fail(cleanup);
      }
      rows.push(...cleanup, { ref: skillRef(key), op: "discard", data: null });
    } else {
      // Every field of the form back to what is published; other skills' changes in the same rows
      // (a start class, a promotion, the order, the curves) stay.
      const back = publishedForm(published, d, key);
      const plan = back ? formRows(d, key, back, false) : [];
      if (typeof plan === "string") {
        return fail(plan);
      }
      for (const r of plan) {
        const pub =
          sameRow(r.ref, ORDER) && published.classes.skillOrder === undefined
            ? skillPageOrder(published.classes).map((x) => x.skill)
            : rowValue(published, r.ref);
        const inDraft = draft.some((x) => sameRow(x, r.ref));
        if (rowHash(r.data) === rowHash(pub ?? null)) {
          if (inDraft) {
            rows.push({ ref: r.ref, op: "discard", data: null });
          }
        } else {
          rows.push(r);
        }
      }
    }
    if (rows.length === 0) {
      return fail(`${label} has no change in the draft.`);
    }
    const r = service.draftChange(actor, rows);
    return r.ok
      ? { ok: true, value: `${label}: the draft's change is gone.` }
      : r.problems
        ? fail(
            `${label}'s change was not dropped.`,
            skillFieldProblems(key, r.problems, indexOf(d, key)),
          )
        : fail(r.error);
  }
  const rows = formRows(d, key, form, false);
  if (typeof rows === "string") {
    return fail(rows);
  }
  if (rows.length === 0) {
    return fail(`${label} already plays that: nothing to save.`);
  }
  const r = service.draftChange(actor, rows);
  if (!r.ok) {
    return r.problems
      ? fail(`${label} was not saved.`, skillFieldProblems(key, r.problems, indexOf(d, key)))
      : fail(r.error);
  }
  return { ok: true, value: `${label} is in the draft.` };
}

/**
 * Puts a pack's skill back to what the pack plays for it: each row its form writes goes back to
 * the pack's value (a row of the operator's own reverts, a draft change that only held it is
 * dropped), and a row other skills' changes share keeps theirs.
 */
function revertSkill(
  service: ContentService,
  actor: ContentActor,
  d: ContentData,
  draft: readonly DraftRow[],
  key: string,
  label: string,
): ContentResult<string> {
  const pack = service.packContent();
  const back = publishedForm(pack, d, key);
  if (!back) {
    return fail(`${label} is yours, not the pack's: there is no original to restore.`);
  }
  const plan = formRows(d, key, back, false);
  if (typeof plan === "string") {
    return fail(plan);
  }
  const operator = service.operatorRows();
  const rows: { ref: RowRef; op: DraftRow["op"] | "discard"; data: unknown }[] = [];
  for (const r of plan) {
    const original =
      sameRow(r.ref, ORDER) && pack.classes.skillOrder === undefined
        ? skillPageOrder(pack.classes).map((x) => x.skill)
        : rowValue(pack, r.ref);
    if (rowHash(r.data) !== rowHash(original ?? null)) {
      rows.push(r);
    } else if (operator.some((x) => sameRow(x, r.ref))) {
      rows.push({ ref: r.ref, op: "revert", data: null });
    } else if (draft.some((x) => sameRow(x, r.ref))) {
      rows.push({ ref: r.ref, op: "discard", data: null });
    }
  }
  if (rows.length === 0) {
    return fail(`${label} already plays the original.`);
  }
  const r = service.draftChange(actor, rows);
  return r.ok
    ? { ok: true, value: `${label} plays the original again once published.` }
    : r.problems
      ? fail(`${label} was not restored.`, skillFieldProblems(key, r.problems, indexOf(d, key)))
      : fail(r.error);
}

// ---- removal -------------------------------------------------------------------------------

/** Where a skill is used, for its removal: every reference, the bindings and the characters. */
export function skillUsage(
  service: ContentService,
  key: string,
  world?: ContentWorld,
): ContentResult<ContentSkillUsage> {
  const d = service.draftContent();
  const row = skillRow(d, key);
  if (!row) {
    return fail(`There is no skill ${key}.`);
  }
  return {
    ok: true,
    value: {
      skill: row.skill,
      display: row.display ?? row.skill,
      uses: usesIn(d, row.skill).map((u) => ({
        id: u.id,
        where: u.where,
        clearable: u.clear !== null,
        clears: u.clears,
      })),
      characters: world?.skillHolders?.(row.skill) ?? 0,
      bindings: bindingsOf(d, row.skill),
      fingerprint: usageFingerprint(service, row.skill),
    },
  };
}

/**
 * A removal report as it was built: the skill's form, every reference with what it holds now,
 * and the bindings. A removal names it, so a reference added or changed since is never cleared
 * unseen.
 */
function usageFingerprint(service: ContentService, key: string): string {
  const draft = service.draft();
  const d = service.draftContent(draft);
  return rowHash({
    form: skillFingerprint(service, key, draft),
    uses: usesIn(d, key).map((u) => [u.id, getAt(rowValue(d, u.row), u.path) ?? null]),
    bindings: bindingsOf(d, key),
  });
}

/** Marks what a cleared reference drops, swept once every reference is done. */
const DROP = Symbol("drop");

function getAt(root: unknown, path: JsonPath): unknown {
  let at = root;
  for (const step of path) {
    if (at === null || typeof at !== "object") {
      return undefined;
    }
    at = (at as Record<string | number, unknown>)[step];
  }
  return at;
}

function setAt(root: unknown, path: JsonPath, value: unknown): void {
  const parent = getAt(root, path.slice(0, -1));
  if (parent !== null && typeof parent === "object") {
    (parent as Record<string | number, unknown>)[path.at(-1) as string | number] = value;
  }
}

/** Drops every marked entry and key; a weapon row or formula left empty goes too. */
function sweep(v: unknown): unknown {
  if (Array.isArray(v)) {
    return v.filter((x) => x !== DROP).map(sweep);
  }
  if (v !== null && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      if (x !== DROP) {
        out[k] = sweep(x);
      }
    }
    return out;
  }
  return v;
}

/**
 * The rows a skill's removal writes before its own: each reference cleared or pointed at another
 * skill (`choices` by reference id; a reference with no choice is cleared), and its place on the
 * Skills page. `quiet` (a draft-only skill's discard) clears only its start values, grants and
 * place.
 */
function removalRows(
  d: ContentData,
  key: string,
  choices: ReadonlyMap<string, { action: "clear" | "replace"; to?: string }>,
  quiet = false,
): { ref: RowRef; op: "set"; data: unknown }[] | string {
  const touched = new Map<string, { ref: RowRef; value: unknown }>();
  const working = (ref: RowRef) => {
    const id = rowLabel(ref).toLowerCase();
    let t = touched.get(id);
    if (!t) {
      t = { ref, value: structuredClone(rowValue(d, ref)) };
      touched.set(id, t);
    }
    return t;
  };
  const uses = usesIn(d, key).filter(
    (u) =>
      !quiet ||
      (u.row.dataset === "classes" && (u.row.part === "startClasses" || u.row.part === "classes")),
  );
  for (const u of uses) {
    const choice = choices.get(u.id) ?? { action: "clear" as const };
    const t = working(u.row);
    if (choice.action === "replace") {
      const to = choice.to ? skillRow(d, choice.to) : undefined;
      if (!to || norm(to.skill) === norm(key)) {
        return `${u.where}: pick another skill to point it at.`;
      }
      const last = u.path.at(-1);
      if (u.row.dataset === "classes" && u.row.part === "startClasses") {
        const skills = (t.value as { skills: Record<string, number> }).skills;
        const v = skills[String(last)];
        delete skills[String(last)];
        if (v !== undefined && skills[to.skill] === undefined) {
          skills[to.skill] = v;
        }
        continue;
      }
      const was = getAt(t.value, u.path);
      const cond = typeof was === "string" ? /^(\S+) ([<>] -?\d+)$/.exec(was) : null;
      // A formula or a condition names a skill as one word: a key with a space cannot be named.
      const named = u.path.at(-1) === "value" || u.path.at(-2) === "when" || cond !== null;
      if (named && !/^[A-Za-z_]\w*$/.test(to.skill)) {
        return `${u.where}: a formula cannot name ${to.skill} (a key with a space): pick another skill, or clear it.`;
      }
      setAt(
        t.value,
        u.path,
        cond && norm(cond[1] ?? "") === norm(key) ? `${to.skill} ${cond[2]}` : to.skill,
      );
      continue;
    }
    if (!u.clear) {
      return `${u.where}: it cannot be cleared, only pointed at another skill.`;
    }
    if (u.clear.how === "key" && u.row.dataset === "classes" && u.row.part === "startClasses") {
      delete (t.value as { skills: Record<string, number> }).skills[String(u.path.at(-1))];
      continue;
    }
    setAt(t.value, u.clear.path, u.clear.how === "null" ? null : DROP);
  }
  const rows: { ref: RowRef; op: "set"; data: unknown }[] = [];
  for (const t of touched.values()) {
    let value = sweep(t.value);
    // A weapon skill row left with no skills goes; a formula left with no rows goes.
    if (t.ref.dataset === "classes" && t.ref.part === "skillGain") {
      const g = value as { weaponSkills: { skills: string[] }[] };
      value = { ...g, weaponSkills: g.weaponSkills.filter((w) => w.skills.length > 0) };
    }
    // A Bio title left with no tests goes.
    if (t.ref.dataset === "social" && t.ref.part === "bios") {
      const b = value as { titles: { tests?: unknown[] }[] };
      value = { ...b, titles: b.titles.filter((x) => !x.tests || x.tests.length > 0) };
    }
    // An item definition's list left empty goes (a list it has must hold one).
    if (t.ref.dataset === "items" && t.ref.part === "definitions") {
      value = withoutEmpty(value, [["trains"], ["requires"], ["ground", "platforms"]]);
    }
    value = dropEmptyFormulas(value);
    rows.push({ ref: t.ref, op: "set", data: value });
  }
  if (d.classes.skillOrder?.some((k) => norm(k) === norm(key))) {
    rows.push({
      ref: ORDER,
      op: "set",
      data: d.classes.skillOrder.filter((k) => norm(k) !== norm(key)),
    });
  }
  return rows;
}

/** `v` without the lists at `paths` that are empty. */
function withoutEmpty(v: unknown, paths: readonly string[][]): unknown {
  const out = structuredClone(v) as Record<string, unknown>;
  for (const path of paths) {
    const parent = getAt(out, path.slice(0, -1)) as Record<string, unknown> | undefined;
    const last = path.at(-1) as string;
    if (parent && Array.isArray(parent[last]) && (parent[last] as unknown[]).length === 0) {
      delete parent[last];
    }
  }
  return out;
}

/** A progression's `roll` or `xp` formula left with no rows is left out. */
function dropEmptyFormulas(v: unknown): unknown {
  if (Array.isArray(v)) {
    return v.map(dropEmptyFormulas);
  }
  if (v !== null && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      if ((k === "roll" || k === "xp" || k === "points") && Array.isArray(x) && x.length === 0) {
        continue;
      }
      out[k] = dropEmptyFormulas(x);
    }
    return out;
  }
  return v;
}

/** What `contentSkillRemove`'s `refs` may carry. */
const removalChoicesSchema = z
  .array(
    z.strictObject({
      id: z.string().min(1).max(400),
      action: z.enum(["clear", "replace"]),
      to: z.string().min(1).max(80).optional(),
    }),
  )
  .max(10_000);

/**
 * Removes a skill in the draft (issue #38): each reference cleared or pointed at another skill as
 * `refs` says, then the skill. Characters' stored values stay (a skill that returns finds them).
 * Refused while a binding names it, or when it changed since `expect`.
 */
export function draftSkillRemoval(
  service: ContentService,
  actor: ContentActor,
  removal: { key: string; refs: unknown; expect?: string },
): ContentResult<string> {
  const draft = service.draft();
  const d = service.draftContent(draft);
  const row = skillRow(d, removal.key);
  if (!row) {
    return fail(`There is no skill ${removal.key}.`);
  }
  const key = row.skill;
  const label = row.display ?? key;
  if (usageFingerprint(service, key) !== removal.expect) {
    return fail(
      `${label} or what names it changed since you looked: look at its uses again before removing it.`,
    );
  }
  const bound = bindingsOf(d, key);
  if (bound.length > 0) {
    return fail(
      `${label} cannot be removed while the ${bound.join(", ")} binding${bound.length === 1 ? " names" : "s name"} it: point ${bound.length === 1 ? "it" : "them"} at another skill first (Which skill does what, on the Skills & Classes page).`,
    );
  }
  const parsed = removalChoicesSchema.safeParse(removal.refs ?? []);
  if (!parsed.success) {
    return fail("The removal's choices do not read.");
  }
  const current = usesIn(d, key);
  const known = new Set(current.map((u) => u.id));
  const choices = new Map<string, { action: "clear" | "replace"; to?: string }>();
  for (const c of parsed.data) {
    if (!known.has(c.id)) {
      return fail(`${label}'s uses changed since you looked: look at them again.`);
    }
    choices.set(c.id, c);
  }
  // Every reference the report listed needs its own choice.
  const unanswered = current.filter((u) => !choices.has(u.id));
  if (unanswered.length > 0) {
    return fail(`Choose what happens to every use: ${unanswered.map((u) => u.where).join("; ")}.`);
  }
  const cleanup = removalRows(d, key, choices);
  if (typeof cleanup === "string") {
    return fail(cleanup);
  }
  const published = skillRow(service.publishedContent(), key) !== undefined;
  const rows: { ref: RowRef; op: DraftRow["op"] | "discard"; data: unknown }[] = [
    ...cleanup,
    { ref: skillRef(key), op: published ? "remove" : "discard", data: null },
  ];
  const r = service.draftChange(actor, rows);
  if (!r.ok) {
    return r.problems
      ? fail(`${label} was not removed.`, skillFieldProblems(key, r.problems, indexOf(d, key)))
      : fail(r.error);
  }
  return {
    ok: true,
    value: `${label} will be removed when the draft is published${cleanup.length > 0 ? `; ${cleanup.length} other row${cleanup.length === 1 ? "" : "s"} changed with it` : ""}. Characters keep their values of it, which come back if it returns.`,
  };
}
