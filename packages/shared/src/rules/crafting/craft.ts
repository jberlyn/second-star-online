/**
 * The four crafting stations and the Cauldron. Pure functions over plain data: the server owns the
 * state, runs the timers and sends the lines.
 *
 * Names match without regard to case; substring matches also ignore case.
 */
import type { CraftData } from "@secondstaronline/data";

import { onContent } from "../../content/store.ts";
import { lingoEq, type Rng } from "../core/lingo.ts";
import { menuAction } from "../inventory/equip.ts";
import { type AddResult, type Bag, invAdd } from "../inventory/inventory.ts";
import { crystalLine } from "../spells/spells.ts";

let ST: CraftData["stations"];

export type CraftKind = "Smith" | "Cook" | "Mix" | "Build";

/** The order the four counters run in one frame. */
export let CRAFT_ORDER: readonly CraftKind[];

/** `random(30) = 1` per frame of a smithing craft sends the BSmith FX. */
export let SMITH_FX_CHANCE: number;

const t = (key: string): string => {
  const v = ST.texts[key];
  if (!v) {
    throw new Error(`crafting text ${key} missing`);
  }
  return v.text;
};
/**
 * A line with `{}` slots, read when the content is installed (not when a player first needs it),
 * so a missing line is refused by the publish checks' trial install instead of failing a craft.
 */
const fill = (key: string): ((...args: string[]) => string) => {
  const text = t(key);
  return (...args) => {
    let i = 0;
    return text.replace(/\{\}/g, () => args[i++] ?? "");
  };
};

/** Every crafting line, from the crafting data. */
const craftTextOf = () =>
  ({
    noAnvil: t("noAnvil"),
    noCarpentryBench: t("noCarpentryBench"),
    crowded: t("crowded"),
    noHammer: t("noHammer"),
    needChunk: fill("needChunk") as (chunk: string) => string,
    smithBegin: fill("smithBegin") as (item: string) => string,
    noStove: t("noStove"),
    unskilled: t("unskilled"), // no full stop
    cantCook: t("cantCook"),
    cookBegin: fill("cookBegin") as (item: string) => string,
    burned: t("burned"),
    noLab: t("noLab"),
    noSand: t("noSand"),
    mixBegin: t("mixBegin"),
    potionOff: t("potionOff"),
    potionReady: t("potionReady"),
    noSaw: t("noSaw"),
    unskilledBuild: t("unskilledBuild"), // no full stop, like cooking's
    buildBegin: t("buildBegin"),
    buildFailed: t("buildFailed"),
    built: fill("built") as (name: string) => string,
    ready: fill("ready") as (item: string) => string,
    cantRepair: t("cantRepair"),
    interrupted: t("interrupted"),
    fizzle: t("fizzle"),
    puff: t("puff"),
  }) as const;
export let CRAFT_TEXT: ReturnType<typeof craftTextOf>;

/** The start sounds on channel 3, after the click; Cook has none. */
export const CRAFT_SOUND: Record<CraftKind, string | null> = {
  Smith: "Swordhit3",
  Cook: null,
  Mix: "PotionMix",
  Build: "sawbbb",
};

/** The crafting button the item menu gives a name, if any. */
export function craftKind(name: string): CraftKind | null {
  const a = menuAction(name);
  return a === "Cook" || a === "Mix" || a === "Build" || a === "Smith" ? a : null;
}

/** Check every row whose threshold is below the skill; the last match wins, else the default. */
export function cascade(
  table: { default: number; rows: readonly { gt: number; value: number }[] },
  skill: number,
): number {
  let v = table.default;
  for (const r of table.rows) {
    if (skill > r.gt) {
      v = r.value;
    }
  }
  return v;
}

/** A craft's frames from its skill; a Campfire doubles the cooking timer after the table. */
export function craftTimer(kind: CraftKind, skill: number, campfire = false): number {
  const table = {
    Smith: ST.smith.timer,
    Cook: ST.cook.timer,
    Mix: ST.mix.timer,
    Build: ST.build.timer,
  }[kind];
  const v = cascade(table, skill);
  return kind === "Cook" && campfire ? v * 2 : v;
}

/** The failure pool for a skill: 1 in 3 up to 10, then 1 in 5 above 10, and so on. */
export function failurePool(skill: number): number | null {
  let n: number | null = null;
  for (const r of ST.failure.rows) {
    if ("lt" in r ? skill < r.lt : skill > r.gt) {
      n = r.value;
    }
  }
  return n;
}

/**
 * The failure roll: every true row draws its own `random(n)` in order and the last draw decides
 * (a roll of 1), so Carpentry 55 draws `random(5)`, `random(7)`, `random(9)`, `random(11)`. Same
 * odds as one draw from `failurePool`.
 */
export function rollFailure(skill: number, rng: Rng): boolean {
  let roll: number | null = null;
  for (const r of ST.failure.rows) {
    if ("lt" in r ? skill < r.lt : skill > r.gt) {
      roll = rng.random(r.value);
    }
  }
  return roll === 1;
}

// ---- the bag ---------------------------------------------------------------------------------

/** The first slot (0-based) holding exactly `name`, or -1. */
export function firstSlotNamed(bag: Bag, name: string): number {
  return bag.findIndex((l) => l !== null && lingoEq(l.item, name));
}

/** Takes one `name` from the first slot holding exactly that item; false when there is none. */
export function takeByName(bag: Bag, name: string): boolean {
  const i = firstSlotNamed(bag, name);
  const line = bag[i];
  if (i < 0 || !line) {
    return false;
  }
  line.qty -= 1;
  if (line.qty <= 0) {
    bag[i] = null;
  }
  return true;
}

/** Bag slots holding anything (the smith counts sprites 45-59 that are not NOTHING). */
export function occupiedSlots(bag: Bag): number {
  return bag.filter((l) => l !== null).length;
}

// ---- starting a craft ------------------------------------------------------------------------

/** What a craft button reads (the client's globals in 1.6, the server's state in SSO). */
export interface CraftView {
  bag: Bag;
  /** `LeftHandE`, `RightHandE`. */
  leftHand: string;
  rightHand: string;
  skill: (name: string) => number;
  /** True when the faced tile holds a ground item with exactly this name and you stand still. */
  facing: (station: string) => boolean;
  keyLock: boolean;
  itemPause: number;
}

/**
 * A started craft's job, carried until its counter reaches 1. Nothing is taken at the start: the
 * materials named here are taken when the craft finishes.
 */
export type CraftJob =
  | { kind: "Smith"; item: string; chunk: string }
  | { kind: "Cook"; raw: string }
  | { kind: "Mix"; bottle: string; crystal: string; potion: string }
  | { kind: "Build"; logs: string };

export interface CraftStarted {
  kind: CraftKind;
  job: CraftJob;
  frames: number;
}

export interface CraftStartResult {
  lines: string[];
  started: CraftStarted | null;
}

const none = (lines: string[] = []): CraftStartResult => ({ lines, started: null });

/**
 * A crafting button on bag slot `slot` (1-based), with every check in the original's order. The
 * button is the one the menu would show for the slot's item. Nothing is taken from the bag. The
 * click and the menu hide happen first, on the client.
 */
export function startCraft(v: CraftView, slot: number): CraftStartResult {
  const line = v.bag[slot - 1] ?? null;
  const kind = line ? craftKind(line.item) : null;
  // Every button starts with the same two checks: the key lock-out, then the pause between item
  // actions.
  if (!kind || v.keyLock || v.itemPause > 0 || !line) {
    return none();
  }
  const item = line.item;
  switch (kind) {
    case "Smith":
      return startSmith(v, item);
    case "Cook":
      return startCook(v, item);
    case "Mix":
      return startMix(v, item);
    case "Build":
      return startBuild(v, item);
  }
}

/** The chunk a damaged item needs: Iron by default, 21 named rows. */
export function smithChunk(item: string): string {
  let chunk = ST.smith.chunkDefault;
  for (const r of ST.smith.chunks) {
    if (lingoEq(item, r.item)) {
      chunk = r.chunk;
    }
  }
  return chunk;
}

function startSmith(v: CraftView, item: string): CraftStartResult {
  if (!v.facing(ST.smith.station)) {
    return none([CRAFT_TEXT.noAnvil]);
  }
  if (occupiedSlots(v.bag) > ST.smith.maxOccupied) {
    return none([CRAFT_TEXT.crowded]);
  }
  if (!lingoEq(v.leftHand, ST.smith.tool)) {
    return none([CRAFT_TEXT.noHammer]);
  }
  if (repairResult(item) === null) {
    return none([CRAFT_TEXT.cantRepair]);
  }
  const chunk = smithChunk(item);
  // Any bag line whose icon is the chunk's member: an exact name.
  if (!v.bag.some((l) => l !== null && lingoEq(l.item, chunk))) {
    return none([CRAFT_TEXT.needChunk(chunk)]);
  }
  return {
    lines: [CRAFT_TEXT.smithBegin(item)],
    started: {
      kind: "Smith",
      job: { kind: "Smith", item, chunk },
      frames: craftTimer("Smith", v.skill("Blacksmithing")),
    },
  };
}

function startCook(v: CraftView, item: string): CraftStartResult {
  // The station list in the crafting data is the only copy: every station except the Campfire (the
  // `doubles` entry, tested below) is a stove.
  const stove = ST.cook.stations.some((st) => !lingoEq(st, ST.cook.doubles) && v.facing(st));
  const campfire = v.facing(ST.cook.doubles);
  if (!stove && !campfire) {
    return none([CRAFT_TEXT.noStove]);
  }
  const cooking = v.skill("Cooking");
  if (cooking < ST.cook.minSkill) {
    return none([CRAFT_TEXT.unskilled]);
  }
  if (cookResult(item) === null) {
    return none([CRAFT_TEXT.cantCook]);
  }
  return {
    lines: [CRAFT_TEXT.cookBegin(item)],
    started: {
      kind: "Cook",
      job: { kind: "Cook", raw: item },
      // A Campfire on the faced tile doubles it, even with a Stove there too.
      frames: craftTimer("Cook", cooking, campfire),
    },
  };
}

function startMix(v: CraftView, item: string): CraftStartResult {
  if (!v.facing(ST.mix.station)) {
    return none([CRAFT_TEXT.noLab]);
  }
  // The held sand is the alchemist's tool, like the Hammer and the Saw: one of the six sands
  // exactly, never used up. It picks the potion and the crystal it needs.
  const sand = ST.mix.sands.find((s) => lingoEq(v.rightHand, s.sand));
  if (!sand) {
    return none([CRAFT_TEXT.noSand]);
  }
  const colour = sand.crystal.split(" ")[0] ?? "";
  const c = crystalLine(v.bag, colour);
  if (c < 0 || (v.bag[c]?.qty ?? 0) <= 0 || firstSlotNamed(v.bag, sand.crystal) < 0) {
    return none([sand.need]);
  }
  return {
    lines: [CRAFT_TEXT.mixBegin],
    started: {
      kind: "Mix",
      job: { kind: "Mix", bottle: item, crystal: sand.crystal, potion: sand.potion },
      frames: craftTimer("Mix", v.skill("Alchemy")),
    },
  };
}

function startBuild(v: CraftView, item: string): CraftStartResult {
  if (!v.facing(ST.build.station)) {
    return none([CRAFT_TEXT.noCarpentryBench]);
  }
  if (!lingoEq(v.rightHand, ST.build.tool)) {
    return none([CRAFT_TEXT.noSaw]);
  }
  const carpentry = v.skill("Carpentry");
  if (carpentry < ST.build.minSkill) {
    return none([CRAFT_TEXT.unskilledBuild]);
  }
  return {
    lines: [CRAFT_TEXT.buildBegin],
    started: {
      kind: "Build",
      job: { kind: "Build", logs: item },
      frames: craftTimer("Build", carpentry),
    },
  };
}

// ---- completion ------------------------------------------------------------------------------

/** The last matching row of `rows` for `item`, or null. */
function recipeFor(rows: readonly { input: string; output: string }[], item: string) {
  let out: string | null = null;
  for (const r of rows) {
    if (lingoEq(item, r.input)) {
      out = r.output;
    }
  }
  return out;
}

/** What a damaged item repairs into, or null when it cannot be repaired. */
export function repairResult(item: string): string | null {
  return recipeFor(ST.smith.repairs, item);
}

/** What a raw food cooks into, or null when it cannot be cooked. */
export function cookResult(item: string): string | null {
  return recipeFor(ST.cook.recipes, item);
}

/** What a raw food becomes when it burns, or null when it cannot be cooked. */
export function burnedResult(item: string): string | null {
  return recipeFor(
    ST.cook.recipes.map((r) => ({ input: r.input, output: r.burned })),
    item,
  );
}

/** The masterwork pool by skill: 250, then 100 (>50) … 35 (>98). */
export function masterworkPool(skill: number): number {
  return cascade(ST.smith.masterworkPool, skill);
}

/** A repaired item's `+N` from a roll of its pool. */
export function masterwork(item: string, roll: number): string {
  const row = ST.smith.masterwork.find((m) => lingoEq(m.item, item));
  return row?.outcomes.find((o) => o.roll === roll)?.result ?? item;
}

/**
 * The item-built step's pick: each band below `lt` overwrites the last, drawing its own
 * `random(pool)` as 1.6 did. Crates and Cabinets come back bare: the server mints their id.
 */
export function carpentryResult(carpentry: number, rng: Rng): string {
  let result = "";
  for (const b of ST.build.bands) {
    if (carpentry >= b.lt) {
      continue;
    }
    if (b.pool === null) {
      result = b.results[0]?.item ?? result;
      continue;
    }
    const roll = rng.random(b.pool);
    result = b.results.find((r) => r.roll === roll)?.item ?? result;
  }
  return result;
}

/** A finished craft. */
export interface CraftFinish {
  /** False when a material is gone at completion: nothing changes and nothing is said. */
  reached: boolean;
  lines: string[];
  /** The item added, or null (a failure that makes nothing, or no room in the bag). */
  added: AddResult | null;
  /** The craft made something, so the skill handler rolls. */
  gain: boolean;
}

/** The materials a job takes when it finishes. */
function materials(job: CraftJob): string[] {
  switch (job.kind) {
    case "Smith":
      return [job.item, job.chunk];
    case "Cook":
      return [job.raw];
    case "Mix":
      return [job.bottle, job.crystal];
    case "Build":
      return [job.logs];
  }
}

/**
 * A craft's completion on `inv` in place. The materials are taken now, by exact name; if any is
 * gone the craft ends silently and nothing changes. Cooking, alchemy and carpentry then roll their
 * failure: a failure uses the materials up, and a burn makes the raw food's burned form while a
 * failed brew or build makes nothing. A success makes the result (a repair rolls its masterwork on
 * the server's skill). If the bag has no room for what is made, nothing is taken, nothing is made
 * and the crafter is told the bag is too crowded. `addName` lets the server mint a built
 * container's id.
 */
export function finishCraft(
  inv: { bag: Bag; gold: number },
  job: CraftJob,
  skill: number,
  rng: Rng,
  addName: (name: string) => string = (n) => n,
): CraftFinish {
  const bag: Bag = inv.bag.map((l) => (l ? { ...l } : null));
  if (!materials(job).every((m) => takeByName(bag, m))) {
    return { reached: false, lines: [], added: null, gain: false };
  }
  const commit = () => {
    inv.bag.splice(0, inv.bag.length, ...bag);
  };
  /** Adds `name` and keeps the change, or says the bag is too crowded and changes nothing. */
  const make = (name: string, line: string, gain: boolean): CraftFinish => {
    const trial = { bag, gold: inv.gold };
    const added = invAdd(trial, addName(name), 1, rng);
    if (added.kind === "full") {
      return { reached: true, lines: [CRAFT_TEXT.crowded], added: null, gain: false };
    }
    commit();
    inv.gold = trial.gold;
    return { reached: true, lines: [line], added, gain };
  };
  let result: string | null;
  let failed: string | null = null;
  let spoiled: string | null = null;
  switch (job.kind) {
    case "Smith": {
      result = repairResult(job.item);
      const pool = masterworkPool(skill);
      const roll = rng.random(pool);
      if (result !== null) {
        result = masterwork(result, roll);
      }
      break;
    }
    case "Cook":
      result = cookResult(job.raw);
      failed = CRAFT_TEXT.burned;
      spoiled = burnedResult(job.raw);
      break;
    case "Mix":
      result = job.potion;
      failed = CRAFT_TEXT.potionOff;
      break;
    case "Build":
      result = carpentryResult(skill, rng);
      failed = CRAFT_TEXT.buildFailed;
      break;
  }
  if (failed !== null && rollFailure(skill, rng)) {
    if (spoiled !== null) {
      return make(spoiled, failed, false);
    }
    commit();
    return { reached: true, lines: [failed], added: null, gain: false };
  }
  if (result === null || result === "") {
    return { reached: false, lines: [], added: null, gain: false };
  }
  const line =
    job.kind === "Mix"
      ? CRAFT_TEXT.potionReady
      : job.kind === "Build"
        ? CRAFT_TEXT.built(result)
        : CRAFT_TEXT.ready(result);
  return make(result, line, true);
}

/**
 * The Cauldron's recipes on its contents: the first recipe whose two ingredients are both there,
 * each by its exact name. A brew takes one of each ingredient, adds the result and leaves the rest
 * of the contents alone. Null is a fizzle.
 */
export function cauldronBrew(lines: readonly string[]): string[] | null {
  for (const r of ST.cauldron.recipes) {
    const next = [...lines];
    const ok = r.requires.every((need) => {
      const i = next.findIndex((l) => lingoEq(l, need));
      if (i < 0) {
        return false;
      }
      next.splice(i, 1);
      return true;
    });
    if (ok) {
      return [...next, r.result];
    }
  }
  return null;
}

/** The Cauldron's name test on Drop (name contains "Cauldron#") and capacity. */
export let CAULDRON: { readonly match: string; readonly capacity: number };

onContent((c) => {
  ST = c.craft.stations;
  CRAFT_ORDER = ST.frameOrder.order;
  SMITH_FX_CHANCE = ST.frameOrder.smithFxChance;
  CRAFT_TEXT = craftTextOf();
  CAULDRON = { match: ST.cauldron.match, capacity: ST.cauldron.capacity };
});
