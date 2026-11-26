/**
 * Recipe crafting (issue #45): recipe stations and their recipes, made through the crafting window
 * a quantity at a time (RuneScape's "Make X"). An SSO addition beside the four Classic stations
 * (craft.ts), which keep their own rules: a world with no recipe stations (Classic) plays as 1.6.
 *
 * Pure functions over the content and a crafter's view; the server runs the timers. Names match
 * exactly, ignoring case.
 */
import type { Recipe, RecipeStation } from "@secondstaronline/data";

import { content } from "../../content/store.ts";
import { skillDisplay, skillValue } from "../core/fighter.ts";
import { lingoEq, type Rng } from "../core/lingo.ts";
import { classListWords } from "../core/requirements.ts";
import { type AddResult, type Bag, invAdd } from "../inventory/inventory.ts";
import { masterworkChance, rollMasterwork } from "./masterwork.ts";
import { lineAt, oddsAt, rollChance } from "./odds.ts";

export type { Recipe, RecipeStation };

/** The lines the crafting window and its runs say. SSO lines: 1.6 had no recipes. */
export const RECIPE_TEXT = {
  needTool: (tool: string) => `You need a ${tool} to make this.`,
  needTier: "You need a better tool to make this.",
  needLevel: (skill: string, level: number) => `You need ${skill} ${level} to make this.`,
  unlearned: "You have not learned how to make this.",
  missing: (item: string) => `You don't have enough ${item}.`,
  full: "Your bag is too full to make this.",
  notHere: "You are no longer at the station.",
  stopped: "You stop crafting.",
  made: (qty: number, item: string) => (qty > 1 ? `You make ${qty} ${item}.` : `You make ${item}.`),
  failed: (recipe: string) => `You fail to make ${recipe}.`,
  failedInto: (item: string) => `You fail, and make ${item} instead.`,
  learned: (n: number) => (n === 1 ? "You learn a new recipe." : `You learn ${n} new recipes.`),
  known: "You already know everything this teaches.",
} as const;

const stations = (): readonly RecipeStation[] => content().craft.recipeStations ?? [];
const recipes = (): readonly Recipe[] => content().craft.recipes ?? [];

/** A recipe station by name, or null. */
export function recipeStation(name: string): RecipeStation | null {
  return stations().find((s) => lingoEq(s.name, name)) ?? null;
}

/** A recipe by name, or null. */
export function recipeNamed(name: string): Recipe | null {
  return recipes().find((r) => lingoEq(r.name, name)) ?? null;
}

/** The recipe station worked at a ground item (Ctrl on it), or null. */
export function stationAt(item: string): RecipeStation | null {
  return stations().find((s) => s.at?.some((a) => lingoEq(a, item))) ?? null;
}

/** The recipe station a bag item opens when used, or null. */
export function stationOpenedBy(item: string): RecipeStation | null {
  return stations().find((s) => s.opens?.some((a) => lingoEq(a, item))) ?? null;
}

/** A station's recipes, in content order. */
export function stationRecipes(station: RecipeStation): Recipe[] {
  return recipes().filter((r) => lingoEq(r.station, station.name));
}

/** The recipes a recipe book teaches. */
export function recipesTaughtBy(item: string): Recipe[] {
  return recipes().filter((r) => r.book !== undefined && lingoEq(r.book, item));
}

/** What a recipe's checks read of the crafter. */
export interface RecipeCrafter {
  bag: Bag;
  /** The items held in either hand. */
  held: readonly string[];
  skills: readonly number[];
  /** The recipes the crafter has learned, by name, lower case. */
  known: ReadonlySet<string>;
  /** The crafter's class (issue #15), for a recipe only some classes may make. */
  classCode?: number;
}

/** The crafter's class may make the recipe (issue #15): a recipe with no `classes`, any. */
export function recipeForClass(recipe: Recipe, c: RecipeCrafter): boolean {
  return (
    recipe.classes === undefined ||
    (c.classCode !== undefined && recipe.classes.includes(c.classCode))
  );
}

/** How many of `item` the bag holds, over every line with exactly that name. */
export function countInBag(bag: Bag, item: string): number {
  let n = 0;
  for (const l of bag) {
    if (l && lingoEq(l.item, item)) {
      n += l.qty;
    }
  }
  return n;
}

/**
 * The best tier among the station's tools the crafter holds or carries: null when the station
 * takes no tools, 0 when it takes some and the crafter has none.
 */
export function toolTier(
  station: RecipeStation,
  c: Pick<RecipeCrafter, "bag" | "held">,
): number | null {
  if (!station.tools?.length) {
    return null;
  }
  let best = 0;
  for (const t of station.tools) {
    const has = c.held.some((h) => lingoEq(h, t.item)) || countInBag(c.bag, t.item) > 0;
    if (has && t.tier > best) {
      best = t.tier;
    }
  }
  return best;
}

/** Tiers the crafter's tool is above the recipe's lowest (0 with no tool). */
function tiersAbove(recipe: Recipe, tier: number | null): number {
  return tier === null ? 0 : Math.max(0, tier - (recipe.tier ?? 1));
}

/**
 * The chance one craft succeeds at a skill and tool tier: the recipe's odds plus `tierBonus` points
 * a tier above its lowest; 1 when it has no odds.
 */
export function recipeChance(recipe: Recipe, skill: number, tier: number | null): number {
  if (!recipe.odds) {
    return 1;
  }
  return Math.min(
    1,
    oddsAt(recipe.odds, skill) + ((recipe.tierBonus ?? 0) * tiersAbove(recipe, tier)) / 100,
  );
}

/**
 * The frames one craft takes at a skill and tool tier: the time rows (in a straight line between
 * two, flat past the ends), then `tierSpeed` percent quicker a tier above the lowest. At least 1.
 */
export function recipeFrames(recipe: Recipe, skill: number, tier: number | null): number {
  const base = lineAt(
    recipe.time.map((t) => ({ level: t.level, value: t.frames })),
    skill,
  );
  const quicker = Math.min(90, (recipe.tierSpeed ?? 0) * tiersAbove(recipe, tier));
  return Math.max(1, Math.round((base * (100 - quicker)) / 100));
}

/** A recipe's state for one crafter, as the window shows it. */
export type RecipeState = "ready" | "missing" | "tool" | "level" | "unlearned";

/** The first thing that stops a crafter making a recipe now, or "ready". */
export function recipeState(recipe: Recipe, station: RecipeStation, c: RecipeCrafter): RecipeState {
  if (!recipeForClass(recipe, c)) {
    return "unlearned";
  }
  if (recipe.book !== undefined && !c.known.has(recipe.name.toLowerCase())) {
    return "unlearned";
  }
  if (skillValue(c.skills, recipe.skill) < recipe.level) {
    return "level";
  }
  const tier = toolTier(station, c);
  if (tier !== null && tier < (recipe.tier ?? 1)) {
    return "tool";
  }
  const short = [...recipe.materials, ...(recipe.keeps ?? [])].some(
    (m) => countInBag(c.bag, m.item) < totalOf(recipe, m.item),
  );
  return short ? "missing" : "ready";
}

/** How many of `item` one craft needs in the bag, materials and kept items together. */
function totalOf(recipe: Recipe, item: string): number {
  let n = 0;
  for (const m of [...recipe.materials, ...(recipe.keeps ?? [])]) {
    if (lingoEq(m.item, item)) {
      n += m.qty;
    }
  }
  return n;
}

/** The refusal for a recipe that cannot be made now, or null. */
export function recipeRefusal(
  recipe: Recipe,
  station: RecipeStation,
  c: RecipeCrafter,
): string | null {
  if (!recipeForClass(recipe, c)) {
    return `Only ${classListWords(recipe.classes ?? [])} can make this.`;
  }
  switch (recipeState(recipe, station, c)) {
    case "ready":
      return null;
    case "unlearned":
      return RECIPE_TEXT.unlearned;
    case "level":
      return RECIPE_TEXT.needLevel(skillDisplay(recipe.skill), recipe.level);
    case "tool": {
      const tools = station.tools ?? [];
      if (toolTier(station, c) === 0) {
        const want =
          tools.filter((t) => t.tier >= (recipe.tier ?? 1)).sort((a, b) => a.tier - b.tier)[0] ??
          tools[0];
        return RECIPE_TEXT.needTool(want?.item ?? "tool");
      }
      return RECIPE_TEXT.needTier;
    }
    case "missing": {
      const short = [...recipe.materials, ...(recipe.keeps ?? [])].find(
        (m) => countInBag(c.bag, m.item) < totalOf(recipe, m.item),
      );
      return RECIPE_TEXT.missing(short?.item ?? recipe.name);
    }
  }
}

/** How many crafts the bag's materials allow (kept items are not used up). */
export function craftsAffordable(recipe: Recipe, bag: Bag): number {
  let n = Number.POSITIVE_INFINITY;
  for (const m of recipe.materials) {
    const used = recipe.materials
      .filter((x) => lingoEq(x.item, m.item))
      .reduce((a, x) => a + x.qty, 0);
    const kept = (recipe.keeps ?? [])
      .filter((x) => lingoEq(x.item, m.item))
      .reduce((a, x) => a + x.qty, 0);
    const have = countInBag(bag, m.item) - kept;
    n = Math.min(n, Math.max(0, Math.floor(have / used)));
  }
  return Number.isFinite(n) ? n : 0;
}

/** One recipe line of the crafting window. */
export interface RecipeRow {
  name: string;
  category: string;
  output: { item: string; qty: number };
  skill: string;
  level: number;
  xp: number | null;
  materials: { item: string; qty: number; have: number }[];
  keeps: { item: string; qty: number; have: number }[];
  state: RecipeState;
  /** What stops it being made now, in the words a Make would be refused with; null when ready. */
  why: string | null;
  /** How many the bag's materials allow now. */
  affordable: number;
  /** The chance one succeeds now, 0 to 1. */
  chance: number;
  /** The chance a success comes out a masterwork, 0 to 1 (0: it has none). */
  masterwork: number;
}

/** The crafting window's rows for a station: recipes above the level are left out when hidden. */
export function stationRows(station: RecipeStation, c: RecipeCrafter): RecipeRow[] {
  const tier = toolTier(station, c);
  const out: RecipeRow[] = [];
  for (const r of stationRecipes(station)) {
    // A recipe for other classes is never listed (issue #15).
    if (!recipeForClass(r, c)) {
      continue;
    }
    const state = recipeState(r, station, c);
    const hide = (r.aboveLevel ?? station.aboveLevel) === "hide";
    if (hide && (state === "level" || state === "unlearned")) {
      continue;
    }
    const skill = skillValue(c.skills, r.skill);
    const line = (m: { item: string; qty: number }) => ({
      item: m.item,
      qty: m.qty,
      have: countInBag(c.bag, m.item),
    });
    out.push({
      name: r.name,
      category: r.category ?? "",
      output: { ...r.output },
      skill: skillDisplay(r.skill),
      level: r.level,
      xp: r.xp ?? null,
      materials: r.materials.map(line),
      keeps: (r.keeps ?? []).map(line),
      state,
      why: recipeRefusal(r, station, c),
      affordable: craftsAffordable(r, c.bag),
      chance: recipeChance(r, skill, tier),
      masterwork: masterworkChance(r.output.item, skill),
    });
  }
  return out;
}

/** Takes `qty` of `item` from the bag's lines with exactly that name, first lines first. */
function takeQty(bag: Bag, item: string, qty: number): void {
  let left = qty;
  for (let i = 0; i < bag.length && left > 0; i++) {
    const l = bag[i];
    if (l && lingoEq(l.item, item)) {
      const take = Math.min(left, l.qty);
      l.qty -= take;
      left -= take;
      if (l.qty <= 0) {
        bag[i] = null;
      }
    }
  }
}

/** One finished craft of a recipe. */
export interface RecipeFinish {
  /** Whether the craft went ahead (its materials were taken). */
  done: boolean;
  /** The line for the crafter. */
  line: string;
  /** Whether the recipe's output was made (the skill trains). */
  made: boolean;
  added: AddResult | null;
}

/**
 * One craft on `inv` in place: the materials are taken and the chance rolled; a success adds the
 * output (or its masterwork, by the crafter's `skill`), a failure the failure output (if any). If
 * the bag has no room for what comes out, nothing changes and the crafter is told the bag is too
 * full. `addName` lets the server mint a built container's id. The caller has already checked
 * `recipeRefusal`.
 */
export function finishRecipe(
  inv: { bag: Bag; gold: number },
  recipe: Recipe,
  chance: number,
  rng: Rng,
  addName: (name: string) => string = (n) => n,
  skill = 0,
): RecipeFinish {
  if (craftsAffordable(recipe, inv.bag) < 1) {
    return {
      done: false,
      line: RECIPE_TEXT.missing(recipe.materials[0]?.item ?? recipe.name),
      made: false,
      added: null,
    };
  }
  const bag: Bag = inv.bag.map((l) => (l ? { ...l } : null));
  for (const m of recipe.materials) {
    takeQty(bag, m.item, m.qty);
  }
  const ok = rollChance(chance, rng);
  // A success may come out a masterwork (`masterworks`, by the recipe's skill).
  const out = ok
    ? { ...recipe.output, item: rollMasterwork(recipe.output.item, skill, rng) }
    : recipe.failure;
  const trial = { bag, gold: inv.gold };
  let added: AddResult | null = null;
  if (out) {
    added = invAdd(trial, addName(out.item), out.qty, rng);
    if (added.kind === "full") {
      return { done: false, line: RECIPE_TEXT.full, made: false, added: null };
    }
  }
  inv.bag.splice(0, inv.bag.length, ...trial.bag);
  inv.gold = trial.gold;
  const line = ok
    ? RECIPE_TEXT.made(recipe.output.qty, out?.item ?? recipe.output.item)
    : out
      ? RECIPE_TEXT.failedInto(out.item)
      : RECIPE_TEXT.failed(recipe.output.item);
  return { done: true, line, made: ok, added };
}
