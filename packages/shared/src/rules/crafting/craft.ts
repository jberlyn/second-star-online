/**
 * The four crafting stations and the Cauldron. Pure functions over plain data: the server owns the
 * state, runs the timers and sends the lines.
 *
 * Names match without regard to case; substring matches also ignore case.
 */
import { type CraftData, craftData } from "@secondstaronline/data";

import { lingoContains, lingoEq, type Rng } from "../core/lingo.ts";
import { menuAction } from "../inventory/equip.ts";
import { type AddResult, BAG_SLOTS, type Bag, bagText, invAdd } from "../inventory/inventory.ts";
import { crystalLine } from "../spells/spells.ts";

const ST: CraftData["stations"] = craftData.stations;

export type CraftKind = "Smith" | "Cook" | "Mix" | "Build";

/** The order the four counters run in one frame. */
export const CRAFT_ORDER: readonly CraftKind[] = ST.frameOrder.order;

/** `random(30) = 1` per frame of a smithing craft sends the BSmith FX. */
export const SMITH_FX_CHANCE = ST.frameOrder.smithFxChance;

const t = (key: string): string => {
  const v = ST.texts[key];
  if (!v) {
    throw new Error(`crafting text ${key} missing`);
  }
  return v.text;
};
const fill = (key: string, ...args: string[]): string => {
  let i = 0;
  return t(key).replace(/\{\}/g, () => args[i++] ?? "");
};

/** Every crafting line, from the generated crafting data. */
export const CRAFT_TEXT = {
  noAnvil: t("noAnvil"),
  crowded: t("crowded"),
  noHammer: t("noHammer"),
  needChunk: (chunk: string) => fill("needChunk", chunk),
  smithBegin: (item: string) => fill("smithBegin", item),
  noStove: t("noStove"),
  unskilled: t("unskilled"), // no full stop
  cookBegin: (item: string) => fill("cookBegin", item),
  burned: t("burned"),
  noLab: t("noLab"),
  noSand: t("noSand"),
  mixBegin: t("mixBegin"),
  potionOff: t("potionOff"),
  potionReady: t("potionReady"),
  noSaw: t("noSaw"),
  buildBegin: t("buildBegin"),
  buildFailed: t("buildFailed"),
  built: (name: string) => fill("built", name), // (sic)
  ready: (item: string) => fill("ready", item),
  fizzle: t("fizzle"),
  puff: t("puff"),
} as const;

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

/** The failure pool for a skill, or null at exactly 10, which no row matches. */
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
 * odds as one draw from `failurePool`; nothing is drawn at exactly 10.
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

// ---- the bag, as 1.6's substring searches read it --------------------------------------------

/** The text of one bag line, `Name-qty`, or "". */
const lineText = (bag: Bag, i: number): string => {
  const l = bag[i];
  return l ? `${l.item}-${l.qty}` : "";
};

/** The first slot (0-based) whose text contains `<name>-`, or -1. */
export function firstSlotContaining(bag: Bag, name: string): number {
  for (let i = 0; i < BAG_SLOTS; i++) {
    if (lineText(bag, i) !== "" && lingoContains(lineText(bag, i), `${name}-`)) {
      return i;
    }
  }
  return -1;
}

/**
 * the original's bag-delete routine called for one item, as 1.6 wrote it: take one from the first
 * slot containing `<name>-` and write the line back as `<name>-<rest>`, so a match on "Cooked
 * Pig-3" for "Pig" becomes "Pig-2" (a kept bug: cooking a Pig can turn a Cooked Pig back into a
 * Pig). False (and nothing changed) when no slot matches.
 */
export function takeByName(bag: Bag, name: string): boolean {
  const i = firstSlotContaining(bag, name);
  const line = bag[i];
  if (i < 0 || !line) {
    return false;
  }
  const rest = line.qty - 1;
  bag[i] = rest > 0 ? { item: name, qty: rest } : null;
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
  /**
   * The chosen food, the chosen potion and the last action (client globals; per character in SSO).
   */
  lastFood: string | null;
  lastPotion: string | null;
}

/** A started craft's job, carried until its counter reaches 1. */
export type CraftJob =
  | { kind: "Smith"; item: string; chunk: string }
  | { kind: "Cook"; raw: string }
  | { kind: "Mix" }
  | { kind: "Build" };

export interface CraftStarted {
  kind: CraftKind;
  job: CraftJob;
  frames: number;
  /** Bag changes made at the start (Mix's crystal and bottle, Build's Logs): done on `bag`. */
  bagChanged: boolean;
  /** The last action when the button writes it (Cook, Mix). */
  lact?: string;
  lastFood?: string | null;
  lastPotion?: string | null;
}

export interface CraftStartResult {
  lines: string[];
  started: CraftStarted | null;
}

const none = (lines: string[] = []): CraftStartResult => ({ lines, started: null });

/**
 * A crafting button on bag slot `slot` (1-based), with every check in the original's order. The
 * button is the one the menu would show for the slot's item. Removals at the start are made on
 * `v.bag` in place. The click and the menu hide happen first, on the client.
 */
export function startCraft(v: CraftView, slot: number, rng: Rng): CraftStartResult {
  const line = v.bag[slot - 1] ?? null;
  const kind = line ? craftKind(line.item) : null;
  // Every button starts with the same two checks: the key lock-out, then the pause between item
  // actions. Mix also tests the modify flag, which is 0 exactly while a pause runs.
  if (!kind || v.keyLock || v.itemPause > 0 || !line) {
    return none();
  }
  const item = line.item;
  switch (kind) {
    case "Smith":
      return startSmith(v, item);
    case "Cook":
      return startCook(v, item, rng);
    case "Mix":
      return startMix(v, slot, item, rng);
    case "Build":
      return startBuild(v, slot, item);
  }
}

/** The chunk a damaged item needs: Iron by default, 20 named rows. */
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
      bagChanged: false,
    },
  };
}

/** Cooking's food choice for a name in `rows` (Orc Meat has two rows, picked by `waka`). */
function foodFor(rows: readonly { item: string; food: string }[], name: string, waka: number) {
  const hits = rows.filter((r) => lingoEq(r.item, name));
  if (hits.length === 0) {
    return null;
  }
  return (hits.length > 1 && waka !== 1 ? hits[1] : hits[0])?.food ?? null;
}

function startCook(v: CraftView, item: string, rng: Rng): CraftStartResult {
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
  // The chosen food: five names write it, and any click's failed roll writes "Bad Food".
  const waka = rng.random(2);
  let lastFood = v.lastFood;
  const food = foodFor(ST.cook.clickFoods, item, waka);
  if (food !== null) {
    lastFood = food;
  }
  if (rollFailure(cooking, rng)) {
    lastFood = "Bad Food";
  }
  return {
    lines: [CRAFT_TEXT.cookBegin(item)],
    started: {
      kind: "Cook",
      job: { kind: "Cook", raw: item },
      // A Campfire on the faced tile doubles it, even with a Stove there too.
      frames: craftTimer("Cook", cooking, campfire),
      bagChanged: false,
      lact: item,
      lastFood,
    },
  };
}

function startMix(v: CraftView, slot: number, item: string, rng: Rng): CraftStartResult {
  if (!v.facing(ST.mix.station)) {
    return none([CRAFT_TEXT.noLab]);
  }
  if (!lingoContains(v.rightHand, ST.mix.sandMatch)) {
    return none([CRAFT_TEXT.noSand]);
  }
  // The six exact sands each need their crystal, taken at once (the crystal-removal routine).
  const sand = ST.mix.sands.find((s) => lingoEq(v.rightHand, s.sand));
  if (sand) {
    const colour = sand.crystal.split(" ")[0] ?? "";
    // The crystal loader reads the last line containing "<Colour> Cry", with its own count.
    const c = crystalLine(v.bag, colour);
    if (c < 0 || (v.bag[c]?.qty ?? 0) <= 0) {
      return none([sand.need]);
    }
    // The server: the client's slot must contain "<Colour> Crystals-", then the bag-delete routine
    // takes from the first slot that does.
    const text = bagText(v.bag).split(":")[c] ?? "";
    if (lingoContains(text, `${sand.crystal}-`)) {
      takeByName(v.bag, sand.crystal);
    }
  }
  // The item-removal message `"<item>:<slot>"`: the slot must contain "<item>-", then the first
  // match goes.
  const bottleText = bagText(v.bag).split(":")[slot - 1] ?? "";
  if (lingoContains(bottleText, `${item}-`)) {
    takeByName(v.bag, item);
  }
  let lastPotion = v.lastPotion;
  if (sand) {
    lastPotion = sand.potion;
  }
  if (rollFailure(v.skill("Alchemy"), rng)) {
    lastPotion = "Bad Potion";
  }
  return {
    lines: [CRAFT_TEXT.mixBegin],
    started: {
      kind: "Mix",
      job: { kind: "Mix" },
      frames: craftTimer("Mix", v.skill("Alchemy")),
      bagChanged: true,
      lact: v.rightHand,
      lastPotion,
    },
  };
}

function startBuild(v: CraftView, slot: number, item: string): CraftStartResult {
  if (!lingoEq(v.rightHand, ST.build.tool)) {
    return none([CRAFT_TEXT.noSaw]);
  }
  const text = bagText(v.bag).split(":")[slot - 1] ?? "";
  if (lingoContains(text, `${item}-`)) {
    takeByName(v.bag, item);
  }
  // The click-time pick and roll are overwritten by the item-built step: not drawn.
  return {
    lines: [CRAFT_TEXT.buildBegin],
    started: {
      kind: "Build",
      job: { kind: "Build" },
      frames: craftTimer("Build", v.skill("Carpentry")),
      bagChanged: true,
    },
  };
}

// ---- completion ------------------------------------------------------------------------------

/** What a completion asks the server to do. */
export interface CraftDone {
  /** Lines printed on the client before anything is sent (burns, "Your potion is ready!"). */
  lines: string[];
  /** `snx38` (Cook, Smith) or `itremovv` (Mix, Build). */
  send:
    | { kind: "snx38"; item: string; chunk: string; skill: number; which: "C" | "S" }
    | { kind: "itremovv"; item: string }
    | null;
  /** The completion frees the keys; the sandwich brew with no potion yet does not. */
  unlock: boolean;
  /** The client's skill handler run after the send (AlchemyImp, CarpentryImp). */
  imp: "Alchemy" | "Carpentry" | null;
}

/**
 * The food-cooked step: the food is re-derived from the last action; any other name keeps the
 * session's chosen food, so after a failed click Raw Meat burns. The burn rolled here decides; a
 * burn sends nothing, so the raw item stays.
 */
export function cookDone(
  raw: string,
  lact: string | null,
  lastFood: string | null,
  cooking: number,
  rng: Rng,
): CraftDone {
  const waka = rng.random(2);
  let food = (lact !== null ? foodFor(ST.cook.doneFoods, lact, waka) : null) ?? lastFood;
  if (rollFailure(cooking, rng)) {
    food = "Bad Food";
  }
  if (food !== null && lingoEq(food, "Bad Food")) {
    return { lines: [CRAFT_TEXT.burned], send: null, unlock: true, imp: null };
  }
  return {
    lines: [],
    send: { kind: "snx38", item: raw, chunk: "", skill: cooking, which: "C" },
    unlock: true,
    imp: null,
  };
}

/**
 * The potion-mixed step: an exact sand picks its potion; anything else (the Catfish Sandwich) keeps
 * the session's chosen potion. "Your potion is ready!" prints before the server acts. With no
 * potion at all nothing prints, nothing is sent and the keys stay locked.
 */
export function mixDone(
  lact: string | null,
  lastPotion: string | null,
  alchemy: number,
  rng: Rng,
): CraftDone {
  let potion = lastPotion;
  const sand = lact !== null ? ST.mix.sands.find((s) => lingoEq(lact, s.sand)) : undefined;
  if (sand) {
    potion = sand.potion;
  }
  if (rollFailure(alchemy, rng)) {
    potion = "Bad Potion";
  }
  if (potion !== null && lingoEq(potion, "Bad Potion")) {
    return { lines: [CRAFT_TEXT.potionOff], send: null, unlock: true, imp: null };
  }
  if (potion !== null && lingoContains(potion, "Potion")) {
    return {
      lines: [CRAFT_TEXT.potionReady],
      send: { kind: "itremovv", item: potion },
      unlock: true,
      imp: "Alchemy",
    };
  }
  return { lines: [], send: null, unlock: false, imp: null };
}

/**
 * The item-built step's pick: each band below `lt` overwrites the last, drawing its own
 * `random(pool)` as 1.6 did. Crates and Cabinets come back bare: `invAdd` mints their id.
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

/** The item-built step: the pick, then the failure roll; "Your built a <name>!" (sic). */
export function buildDone(carpentry: number, rng: Rng): CraftDone {
  const result = carpentryResult(carpentry, rng);
  if (rollFailure(carpentry, rng)) {
    return { lines: [CRAFT_TEXT.buildFailed], send: null, unlock: true, imp: null };
  }
  return {
    lines: [CRAFT_TEXT.built(result)],
    send: { kind: "itremovv", item: result },
    unlock: true,
    imp: "Carpentry",
  };
}

/** Finishing a smith prints nothing and sends `snx38 "<item>:<chunk>:<skill>:S"`. */
export function smithDone(item: string, chunk: string, smithing: number): CraftDone {
  return {
    lines: [],
    send: { kind: "snx38", item, chunk, skill: smithing, which: "S" },
    unlock: true,
    imp: null,
  };
}

// ---- the server's side -----------------------------------------------------------------------

/** The server's result names: the 33 repairs, then the nine dishes. */
export function snx38Result(item: string): string | null {
  let out: string | null = null;
  for (const r of [...ST.smith.repairs, ...ST.cook.recipes]) {
    if (lingoEq(item, r.input)) {
      out = r.output;
    }
  }
  return out;
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

export interface Snx38Result {
  /** False when 1.6's server exited silently: nothing changes and nothing is sent. */
  reached: boolean;
  /** The item added, or null (no recipe, or the bag full): the inputs then stay. */
  added: AddResult | null;
  /** "Your <item> is ready!" ("Your  is ready!" with no recipe). */
  line: string;
}

/**
 * `snx38` on `inv` in place. Takes one of the item and of the chunk by 1.6's substring rule, maps
 * the name, rolls the masterwork on the **server's** skill, then adds the result. 1.6 decremented
 * in memory and wrote only through `InvAdd`, so with no recipe or a full bag nothing is written and
 * the inputs stay; the skill roll and the line still come. A chunk missing at completion ends it
 * silently (1.6 reused the item's slot).
 */
export function snx38(
  inv: { bag: Bag; gold: number },
  item: string,
  chunk: string,
  which: "C" | "S",
  skill: number,
  rng: Rng,
  addName: (name: string) => string = (n) => n,
): Snx38Result {
  const bag: Bag = inv.bag.map((l) => (l ? { ...l } : null));
  if (!takeByName(bag, item)) {
    return { reached: false, added: null, line: "" };
  }
  if (chunk !== "" && !takeByName(bag, chunk)) {
    return { reached: false, added: null, line: "" };
  }
  let result = snx38Result(item);
  let roll = rng.random(250);
  if (which === "S") {
    const pool = masterworkPool(skill);
    if (pool !== 250) {
      roll = rng.random(pool);
    }
    if (result !== null) {
      result = masterwork(result, roll);
    }
  }
  if (result === null) {
    return { reached: true, added: null, line: CRAFT_TEXT.ready("") };
  }
  const trial = { bag, gold: inv.gold };
  const added = invAdd(trial, addName(result), 1, rng);
  if (added.kind === "full") {
    return { reached: true, added: null, line: CRAFT_TEXT.ready(result) };
  }
  inv.bag.splice(0, inv.bag.length, ...trial.bag);
  inv.gold = trial.gold;
  return { reached: true, added, line: CRAFT_TEXT.ready(result) };
}

/**
 * The Cauldron's recipes on its whole text: `contains` both ingredients, the last matching recipe
 * wins. Null is a fizzle.
 */
export function cauldronBrew(lines: readonly string[]): string | null {
  const text = lines.join("\n");
  let out: string | null = null;
  for (const r of ST.cauldron.recipes) {
    if (lingoContains(text, r.requires[0]) && lingoContains(text, r.requires[1])) {
      out = r.result;
    }
  }
  return out;
}

/** The Cauldron's name test on Drop (name contains "Cauldron#") and capacity. */
export const CAULDRON = { match: ST.cauldron.match, capacity: ST.cauldron.capacity } as const;
