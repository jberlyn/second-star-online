/**
 * The Control Panel's Gathering page on the server (issue #38): the harvest nodes (each on its
 * tile), fishing, farming and the hit counter, edited in the shared content draft. A node's save
 * writes the `gather` sections it touches (`harvest`, the `yields` table it rolls, and the
 * `gathering` regrowth check that turns its spent tile back) as one change, refused when it brings
 * a new problem. New activity kinds need code: the page edits the kinds the engine has.
 */

import { z } from "zod";

import { harvestNodeSchema, toolCanSchema, yieldTableSchema } from "@secondstaronline/data/schema";
import {
  type ContentData,
  type ContentGatheringView,
  type ContentProblemView,
  compileDefinitions,
  isProduceCheck,
  lingoEq,
  sourceSettings,
} from "@secondstaronline/shared";

import type { DraftRow } from "../persistence/content.ts";
import { type RowRef, rowHash, rowValue, sameRow } from "./rows.ts";
import type { ContentActor, ContentResult, ContentService } from "./service.ts";
import { capsOf } from "./skills-page.ts";

const fail = (error: string, problems?: ContentProblemView[]) =>
  ({ ok: false, error, ...(problems ? { problems } : {}) }) as const;

const HARVEST: RowRef = { dataset: "gather", part: "harvest", key: null };
const YIELDS: RowRef = { dataset: "gather", part: "yields", key: null };
const GATHERING: RowRef = { dataset: "gather", part: "gathering", key: null };

type Gather = ContentData["gather"];

/** The regrowth check whose tiles turn a node's spent tile back into it, or null. */
function regrowsOf(g: Gather, node: { tile: string; becomes: string }): string | null {
  return (
    g.gathering.regrowth.checks.find((c) =>
      c.tiles.some((t) => lingoEq(t.from, node.becomes) && lingoEq(t.to, node.tile)),
    )?.handler ?? null
  );
}

/** A node as the page last showed it: its place, fields, yield table and regrowth. */
function nodeFingerprint(g: Gather, index: number): string | null {
  const node = g.harvest[index];
  if (!node) {
    return null;
  }
  return rowHash({
    index,
    node,
    yield:
      node.yield !== undefined && Object.hasOwn(g.yields, node.yield) ? g.yields[node.yield] : null,
    regrows: regrowsOf(g, node),
  });
}

/**
 * The pack's node a draft node stands for: the one at the same place with the same tile, else the
 * first with its tile (a node is known by the tile it harvests); -1 for a node of the operator's own.
 */
function packIndexOf(pack: Gather, node: { tile: string }, index: number): number {
  const same = pack.harvest[index];
  if (same && lingoEq(same.tile, node.tile)) {
    return index;
  }
  return pack.harvest.findIndex((n) => lingoEq(n.tile, node.tile));
}

/** A node with its yield table and regrowth, as "Restore the original" puts it back. */
function nodeWhole(g: Gather, index: number) {
  const node = g.harvest[index];
  if (!node) {
    return null;
  }
  return {
    node,
    yield:
      node.yield !== undefined && Object.hasOwn(g.yields, node.yield)
        ? (g.yields[node.yield] ?? null)
        : null,
    regrows: regrowsOf(g, node),
  };
}

/** A yield table as the page loaded it (null: the name has none). */
const yieldFingerprint = (t: unknown) => (t === undefined || t === null ? null : rowHash(t));

const counterFingerprint = (g: Gather) => rowHash({ counter: g.gathering.counterTable });
const fishingFingerprint = (g: Gather) => rowHash({ fishing: g.gathering.fishing ?? null });
const farmingFingerprint = (g: Gather) => rowHash({ farming: g.gathering.farming ?? null });
const wholeFingerprint = (g: Gather, draft: readonly DraftRow[]) =>
  rowHash({
    g,
    pending: [HARVEST, YIELDS, GATHERING].map((r) => draft.find((x) => sameRow(x, r))?.op ?? null),
  });

/**
 * The effect runs a node's strike can name, each once whatever its case: the runs content draws
 * and the uploads (in their own spelling), then the packs' other runs (their atlas keys are lower
 * case). Trails are left out: a trail is drawn with its run, never alone.
 */
function effectChoices(service: ContentService): string[] {
  const fx = service.fxArtView();
  const names = new Map<string, string>();
  for (const n of [
    ...fx.runs.map((r) => r.member),
    ...fx.art.map((a) => a.name),
    ...Object.keys(fx.packRuns),
  ]) {
    if (!names.has(n.toLowerCase())) {
      names.set(n.toLowerCase(), n);
    }
  }
  return [...names.values()].sort((a, b) => a.localeCompare(b));
}

/** The Gathering page's view. */
export function gatheringView(service: ContentService): ContentGatheringView {
  const draft = service.draft();
  const d = service.draftContent(draft);
  const g = d.gather;
  const pack = service.packContent().gather;
  const compiled = compileDefinitions(d);
  const sounds = service.soundArtView();
  const p = d.classes.progression;
  const gatherRows = draft.filter((r) => r.dataset === "gather");
  return {
    nodes: g.harvest.map((node, index) => ({
      index,
      node: structuredClone(node),
      yield:
        node.yield !== undefined && Object.hasOwn(g.yields, node.yield)
          ? structuredClone(g.yields[node.yield] ?? null)
          : null,
      yieldSharedWith: g.harvest
        .map((n, i) => (i !== index && node.yield !== undefined && n.yield === node.yield ? i : -1))
        .filter((i) => i >= 0),
      regrows: regrowsOf(g, node),
      fingerprint: nodeFingerprint(g, index) ?? "",
      ...(() => {
        const original = nodeWhole(pack, packIndexOf(pack, node, index));
        return original
          ? {
              pack: structuredClone(original),
              differs: rowHash(original) !== rowHash(nodeWhole(g, index)),
            }
          : { pack: null, differs: false };
      })(),
    })),
    counter: {
      rows: structuredClone(g.gathering.counterTable),
      fingerprint: counterFingerprint(g),
      pack: structuredClone(pack.gathering.counterTable),
      differs: rowHash(pack.gathering.counterTable) !== rowHash(g.gathering.counterTable),
    },
    fishing: {
      data: structuredClone(g.gathering.fishing ?? null),
      fingerprint: fishingFingerprint(g),
      skill: d.bindings.skills.fishing ?? null,
      pack: structuredClone(pack.gathering.fishing ?? null),
      differs: rowHash(pack.gathering.fishing ?? null) !== rowHash(g.gathering.fishing ?? null),
    },
    farming: {
      data: structuredClone(g.gathering.farming ?? null),
      fingerprint: farmingFingerprint(g),
      pack: structuredClone(pack.gathering.farming ?? null),
      differs: rowHash(pack.gathering.farming ?? null) !== rowHash(g.gathering.farming ?? null),
    },
    regrowth: {
      roll: g.gathering.regrowth.roll,
      tiles: g.gathering.regrowth.tileRoll[0] * g.gathering.regrowth.tileRoll[1],
      checks: g.gathering.regrowth.checks.map((c) => ({
        handler: c.handler,
        below: c.below,
        produce: isProduceCheck(c),
      })),
    },
    findChance: g.gathering.mining?.findChance ?? null,
    tools: compiled.itemRules.tools
      .filter((t) => t.can !== undefined)
      .map((t) => ({
        pattern: t.pattern,
        match: t.match,
        can: t.can as string,
        tier: t.tier ?? 1,
      })),
    skills: d.classes.skills.map((s) => {
      const prog = s.progression;
      const curve =
        prog?.model === "xp" && Object.hasOwn(p.curves, prog.curve) ? p.curves[prog.curve] : null;
      return {
        skill: s.skill,
        display: s.display ?? s.skill,
        model: prog?.model ?? "chance",
        gather: structuredClone(sourceSettings(p, prog, "gather") ?? null),
        curve: structuredClone(curve ?? null),
        cap: prog?.model === "xp" ? (prog.cap ?? null) : null,
      };
    }),
    tables: structuredClone(p.tables),
    caps: capsOf(d),
    choices: {
      cans: toolCanSchema.options.filter((c) => c !== "Fish" && c !== "Water"),
      sounds: [
        ...new Set([...Object.keys(sounds.packSounds), ...sounds.art.map((a) => a.name)]),
      ].sort(),
      effects: effectChoices(service),
      tiles: d.tiles.catalogue.map((t) => ({ code: t.code, name: t.name ?? "" })),
      items: d.items.items
        .filter((i) => !i.retired)
        .map((i) => i.name)
        .sort(),
      yields: Object.keys(g.yields).sort(),
    },
    yields: structuredClone(g.yields),
    yieldFingerprints: Object.fromEntries(
      Object.entries(g.yields).map(([k, t]) => [k, yieldFingerprint(t) as string]),
    ),
    pending: gatherRows.length > 0,
    otherDraft: draft.length - gatherRows.length,
    fingerprint: wholeFingerprint(g, draft),
  };
}

/** A node's save: its fields, the yield table it rolls (by name) and its regrowth check. */
const nodeFormSchema = z.strictObject({
  node: harvestNodeSchema,
  /** The yield table, written under `node.yield` (null: the node names none, or keeps it as is). */
  yieldTable: yieldTableSchema.nullable().optional(),
  /**
   * The table under that name as the page loaded it into the form (`yieldFingerprints`; null: it
   * had none). Required with `yieldTable`, so an edit never writes over a newer one.
   */
  yieldExpect: z.string().max(64).nullable().optional(),
  /** The regrowth check that turns its spent tile back (null: none). */
  regrows: z.string().min(1).max(80).nullable().optional(),
});

/** A harvestable tile's fields, as the Gathering page names them. */
const NODE_FIELDS: Record<string, string> = {
  tile: "Tile",
  becomes: "Turns into",
  can: "Tool action",
  tools: "Only these tools",
  tier: "Lowest tool tier",
  under: "Only on this ground",
  requires: "Requirement",
  skill: "Skill",
  gains: "Each harvest trains the skill",
  xp: "XP per harvest",
  yield: "Drop table",
  treasure: "Can dig up the buried treasure",
  hitSound: "Swing sound",
  successSound: "Harvest sound",
};

/** The gathering section's parts, as the page names them. */
const GATHERING_FIELDS: Record<string, string> = {
  counterTable: "Swings per harvest",
  fishing: "Fishing",
  farming: "Farming",
  regrowth: "Grows back",
  mining: "Mining",
};

/** Fishing's and farming's fields, as their tabs name them. */
const PART_FIELDS: Record<string, Record<string, string>> = {
  fishing: {
    waterTiles: "Water tiles",
    antiMacroStart: "Catches before a spot runs out",
    stoppedText: "Message when a spot runs out",
    bands: "Fish by skill",
    fishCheck: "Bite chance by skill",
  },
  farming: {
    seedTest: "Seeds plant on",
    seeds: "Seeds",
    wateringSkill: "Watering skill",
    watering: "What watering grows",
    produce: "Crops",
  },
};

/** A yield table's fields. */
const YIELD_FIELDS: Record<string, string> = {
  item: "Item it drops",
  chance: "Chance per harvest",
  bySkill: "Better odds with more skill",
};

/** `label`, with the row number after it when the next part is an index ("Only these tools 2"). */
function labelled(label: string, rest: readonly string[]): string {
  const n = rest[0];
  return n !== undefined && /^\d+$/.test(n) ? `${label} ${Number(n) + 1}` : label;
}

/**
 * A refused change's problems as the page says them: a node's by its number and the form's label
 * ("Node 2: Only these tools 1"), a yield table's by its name and field.
 */
export function gatheringFieldProblems(
  problems: readonly { where: string; message: string }[],
): { where: string; message: string }[] {
  return problems.map((p) => {
    const node = /^gather\/harvest\/(\d+)(?:\/(.+))?$/.exec(p.where);
    if (node) {
      const [field = "", ...rest] = node[2]?.split("/") ?? [];
      const label = NODE_FIELDS[field];
      const what = label ? labelled(label, rest) : node[2]?.replaceAll("/", " ");
      return {
        where: `Node ${Number(node[1]) + 1}${what ? `: ${what}` : ""}`,
        message: p.message,
      };
    }
    const y = /^gather\/yields\/?([^/]*)\/?(.*)$/.exec(p.where);
    if (y) {
      const [field = "", ...rest] = y[2]?.split("/").filter((x) => x !== "") ?? [];
      const label = YIELD_FIELDS[field];
      return {
        where: `Drop table ${y[1] ?? ""}${label ? `: ${labelled(label, rest)}` : ""}`.trim(),
        message: p.message,
      };
    }
    const g = /^gather\/gathering\/?(.*)$/.exec(p.where);
    if (g) {
      const [field = "", sub = "", ...rest] = g[1]?.split("/").filter((x) => x !== "") ?? [];
      const label = GATHERING_FIELDS[field];
      const subLabel = PART_FIELDS[field]?.[sub];
      return {
        where: !label
          ? g[1]
            ? g[1].replaceAll("/", " ")
            : "Gathering"
          : subLabel
            ? `${label}: ${labelled(subLabel, rest)}`
            : labelled(
                label,
                [sub, ...rest].filter((x) => x !== ""),
              ),
        message: p.message,
      };
    }
    return p;
  });
}

/**
 * The gathering section with node `index`'s regrowth pair (spent tile back to its tile) in check
 * `handler`, or in none. The pair it had before (`was`, its tile and spent tile before the change)
 * stays wherever another node still turns back the same way. A produce check (`isProduceCheck`)
 * never takes a pair: one would turn it into a tile check and stop its produce. A tile check left
 * with no pairs stays a tile check (`produce: false`).
 */
function withRegrowth(
  g: Gather,
  index: number,
  node: { tile: string; becomes: string } | null,
  was: { tile: string; becomes: string } | null,
  handler: string | null,
): Gather["gathering"] | string {
  const gathering = g.gathering;
  const target =
    handler === null ? null : gathering.regrowth.checks.find((c) => c.handler === handler);
  if (handler !== null && !target) {
    return `there is no regrowth check ${handler}`;
  }
  if (target && isProduceCheck(target)) {
    return `${handler} drops farming produce: a node's tile cannot regrow there`;
  }
  const pairOf = (n: { tile: string; becomes: string }) => (t: { from: string; to: string }) =>
    lingoEq(t.from, n.becomes) && lingoEq(t.to, n.tile);
  const sharedBy = (n: { tile: string; becomes: string }) =>
    g.harvest.some(
      (o, j) => j !== index && lingoEq(o.tile, n.tile) && lingoEq(o.becomes, n.becomes),
    );
  const drop = [node, was].filter(
    (n): n is { tile: string; becomes: string } => n !== null && !sharedBy(n),
  );
  return {
    ...gathering,
    regrowth: {
      ...gathering.regrowth,
      checks: gathering.regrowth.checks.map((c) => {
        if (isProduceCheck(c)) {
          return c;
        }
        let tiles = c.tiles.filter((t) => !drop.some((n) => pairOf(n)(t)));
        if (node && c === target && !tiles.some(pairOf(node))) {
          tiles = [...tiles, { from: node.becomes, to: node.tile }];
        }
        return tiles.length === 0 ? { ...c, tiles, produce: false } : { ...c, tiles };
      }),
    },
  };
}

type Rows = { ref: RowRef; op: DraftRow["op"] | "discard"; data: unknown }[];

/**
 * One Gathering page change (issue #38): a node's fields (`node`), a new node (`newNode`), a
 * node's removal (`removeNode`), fishing's, farming's or the hit counter's tables, or `discard`.
 * Refused when the part changed since the page showed it (`expect`).
 */
export function draftGatheringChange(
  service: ContentService,
  actor: ContentActor,
  change: {
    op: "node" | "newNode" | "removeNode" | "fishing" | "farming" | "counter" | "discard";
    index?: number;
    data?: unknown;
    expect?: string;
  },
): ContentResult<string> {
  const draft = service.draft();
  const d = service.draftContent(draft);
  const g = d.gather;
  const stale = "It changed since you opened it: look at it again before saving.";
  const pack = service.packContent();
  const operator = service.operatorRows();
  /**
   * A row put back to exactly the pack's value is no change of the operator's: their row reverts
   * (or the draft's change to it goes), so "Restore the original" leaves nothing behind.
   */
  const settle = (rows: Rows): Rows =>
    rows.flatMap((r) => {
      if (r.op !== "set" || rowHash(r.data) !== rowHash(rowValue(pack, r.ref) ?? null)) {
        return [r];
      }
      if (operator.some((x) => sameRow(x, r.ref))) {
        return [{ ref: r.ref, op: "revert", data: null }];
      }
      return draft.some((x) => sameRow(x, r.ref))
        ? [{ ref: r.ref, op: "discard", data: null }]
        : [];
    });
  const write = (planned: Rows, ok: string, what: string): ContentResult<string> => {
    const rows = settle(planned);
    if (rows.length === 0) {
      return fail(`${what} already plays that: nothing to save.`);
    }
    const r = service.draftChange(actor, rows);
    if (!r.ok) {
      return r.problems
        ? fail(`${what} was not saved.`, gatheringFieldProblems(r.problems))
        : fail(r.error);
    }
    // Every row back to the pack's: it plays the original again, not a change of yours.
    if (rows.every((x) => x.op === "revert" || x.op === "discard")) {
      const later = rows.some((x) => x.op === "revert") ? " once published" : "";
      return { ok: true, value: `${what} plays the original again${later}.` };
    }
    return { ok: true, value: ok };
  };
  switch (change.op) {
    case "discard": {
      if (change.expect !== wholeFingerprint(g, draft)) {
        return fail(stale);
      }
      const rows: Rows = [HARVEST, YIELDS, GATHERING]
        .filter((r) => draft.some((x) => sameRow(x, r)))
        .map((ref) => ({ ref, op: "discard", data: null }));
      if (rows.length === 0) {
        return fail("Gathering has no change in the draft.");
      }
      return write(rows, "The draft's gathering changes are gone.", "Gathering");
    }
    case "counter": {
      if (change.expect !== counterFingerprint(g)) {
        return fail(stale);
      }
      const next = { ...g.gathering, counterTable: change.data };
      return rowHash(next) === rowHash(g.gathering)
        ? fail("The hit counter already plays that: nothing to save.")
        : write(
            [{ ref: GATHERING, op: "set", data: next }],
            "The hit counter is in the draft.",
            "The hit counter",
          );
    }
    case "fishing":
    case "farming": {
      const fp = change.op === "fishing" ? fishingFingerprint(g) : farmingFingerprint(g);
      if (change.expect !== fp) {
        return fail(stale);
      }
      const next: Record<string, unknown> = { ...g.gathering };
      if (change.data === null || change.data === undefined) {
        delete next[change.op];
      } else {
        next[change.op] = change.data;
      }
      const label = change.op === "fishing" ? "Fishing" : "Farming";
      return rowHash(next) === rowHash(g.gathering)
        ? fail(`${label} already plays that: nothing to save.`)
        : write([{ ref: GATHERING, op: "set", data: next }], `${label} is in the draft.`, label);
    }
    case "removeNode": {
      const i = change.index ?? -1;
      if (nodeFingerprint(g, i) === null) {
        return fail(`There is no node ${i + 1}.`);
      }
      if (change.expect !== nodeFingerprint(g, i)) {
        return fail(stale);
      }
      const node = g.harvest[i];
      const rows: Rows = [{ ref: HARVEST, op: "set", data: g.harvest.filter((_, j) => j !== i) }];
      // Its regrowth pair goes with it, unless another node still turns back the same way.
      if (node && regrowsOf(g, node) !== null) {
        const next = withRegrowth(g, i, null, node, null);
        if (typeof next !== "string" && rowHash(next) !== rowHash(g.gathering)) {
          rows.unshift({ ref: GATHERING, op: "set", data: next });
        }
      }
      return write(rows, `Node ${i + 1} is removed in the draft.`, `Node ${i + 1}`);
    }
    case "node":
    case "newNode": {
      const parsed = nodeFormSchema.safeParse(change.data);
      if (!parsed.success) {
        return fail(
          "The node was not saved.",
          parsed.error.issues.map((x) => {
            const [top, field, ...rest] = x.path.map(String);
            const label =
              top === "node" && field !== undefined
                ? NODE_FIELDS[field]
                : top === "yieldTable"
                  ? YIELD_FIELDS[field ?? ""]
                  : undefined;
            return {
              where: label
                ? labelled(label, rest)
                : top === "yieldTable"
                  ? "Drop table"
                  : top === "regrows"
                    ? "Grows back"
                    : x.path.length > 0
                      ? x.path.join(" ")
                      : "Node",
              message: x.message,
            };
          }),
        );
      }
      const form = parsed.data;
      const isNew = change.op === "newNode";
      const i = isNew ? g.harvest.length : (change.index ?? -1);
      const was = isNew ? null : (g.harvest[i] ?? null);
      if (!isNew) {
        if (!was) {
          return fail(`There is no node ${i + 1}.`);
        }
        if (change.expect !== nodeFingerprint(g, i)) {
          return fail(stale);
        }
      }
      const rows: Rows = [];
      if (form.yieldTable) {
        const name = form.node.yield;
        if (name === undefined) {
          return fail("Name the yield table the node rolls.");
        }
        const had = Object.hasOwn(g.yields, name) ? g.yields[name] : undefined;
        if (rowHash(had ?? null) !== rowHash(form.yieldTable)) {
          if (form.yieldExpect === undefined || form.yieldExpect !== yieldFingerprint(had)) {
            return fail(
              `Yield table ${name} changed since you opened it (or the save named no revision): look at it again before saving.`,
            );
          }
          rows.push({ ref: YIELDS, op: "set", data: { ...g.yields, [name]: form.yieldTable } });
        }
      }
      if (form.regrows !== undefined) {
        const now = was ? regrowsOf(g, was) : null;
        const moved =
          was && (!lingoEq(was.tile, form.node.tile) || !lingoEq(was.becomes, form.node.becomes));
        if (form.regrows !== now || moved) {
          const next = withRegrowth(g, i, form.node, was, form.regrows);
          if (typeof next === "string") {
            return fail(next);
          }
          if (rowHash(next) !== rowHash(g.gathering)) {
            rows.push({ ref: GATHERING, op: "set", data: next });
          }
        }
      }
      if (isNew || rowHash(was) !== rowHash(form.node)) {
        const harvest = [...g.harvest];
        harvest[i] = form.node;
        rows.push({ ref: HARVEST, op: "set", data: harvest });
      }
      return write(
        rows,
        isNew ? `Node ${i + 1} is in the draft.` : `Node ${i + 1} is in the draft.`,
        `Node ${i + 1}`,
      );
    }
  }
}
