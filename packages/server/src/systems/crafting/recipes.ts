/**
 * Recipe crafting on the server (issue #45): the crafting window of a recipe station, its Make X
 * runs and the recipes a character has learned. An SSO addition beside the four Classic stations
 * (craft.ts): a world with no recipe stations never reaches any of this.
 *
 * The keys stay free while a run goes (RuneScape's way): moving, turning, dying, a map change or an
 * attack ends it, as does the window's Stop. The rules are in shared/rules/crafting/recipes.ts.
 */
import {
  advancedLines,
  FACING_DELTA,
  findSkillIndex,
  finishRecipe,
  ID_CONTAINERS,
  lingoEq,
  RECIPE_TEXT,
  type Recipe,
  type RecipeCrafter,
  type RecipeStation,
  type RecipeWindowView,
  type Rng,
  recipeChance,
  recipeFrames,
  recipeNamed,
  recipeRefusal,
  recipeStation,
  recipesTaughtBy,
  skillValue,
  stationRows,
  toolTier,
  train,
} from "@secondstaronline/shared";

import { holdingsOf, logBagChange } from "../admin/activity.ts";
import { fighterOf } from "../monsters/attack.ts";
import type { Outgoing, Player, Room, World } from "../world/world.ts";
import { mintContainerId } from "./craft.ts";

/** A running Make X. */
export interface RecipeRun {
  station: string;
  recipe: string;
  /** Crafts still to make, the one under way included. */
  left: number;
  /** Frames until the one under way finishes. */
  counter: number;
  /** Where the crafter stood and faced when it started; leaving it ends the run. */
  at: { map: string; x: number; y: number; facing: Player["facing"] };
}

/** A player's recipe crafting. */
export interface RecipeState {
  /** The recipes learned (from a recipe book), by name, lower case. Saved with the character. */
  known: Set<string>;
  /** `known` changed since it was saved. */
  knownDirty: boolean;
  /** The recipe station whose window is open, or null. */
  window: string | null;
  run: RecipeRun | null;
}

export function newRecipeState(known: readonly string[] = []): RecipeState {
  return {
    known: new Set(known.map((k) => k.toLowerCase())),
    knownDirty: false,
    window: null,
    run: null,
  };
}

/** The recipes a character knows, as saved. */
export function savedRecipes(s: RecipeState): string[] {
  return [...s.known].sort();
}

export interface RecipeCtx {
  world: World;
  rng: Rng;
  now: number;
}

const tell = (p: Player, text: string): Outgoing => ({
  to: p.id,
  msg: { t: "chat", text, color: 0 },
});

function crafterOf(p: Player): RecipeCrafter {
  return {
    bag: p.char.bag,
    held: [p.char.equip.weapon, p.char.equip.offHand],
    skills: p.char.skills,
    known: p.recipe.known,
    classCode: p.char.classCode,
  };
}

/** The faced tile holds the station's item, and the crafter stands still. */
function facingStation(room: Room, p: Player, station: RecipeStation): boolean {
  if (p.stepFrames > 0 || !station.at?.length) {
    return false;
  }
  const [dx, dy] = FACING_DELTA[p.facing];
  return room.map.ground.some(
    (g) =>
      g.x === p.x + dx && g.y === p.y + dy && (station.at ?? []).some((a) => lingoEq(g.item, a)),
  );
}

/** The crafter can work the station from here: facing it, or carrying an item that opens it. */
function atStation(room: Room, p: Player, station: RecipeStation): boolean {
  if (facingStation(room, p, station)) {
    return true;
  }
  return (station.opens ?? []).some((o) =>
    p.char.bag.some((l) => l !== null && lingoEq(l.item, o)),
  );
}

/** The window as the crafter sees it now. */
function view(p: Player, station: RecipeStation): RecipeWindowView {
  const run = p.recipe.run;
  return {
    station: station.name,
    rows: stationRows(station, crafterOf(p)),
    run: run ? { recipe: run.recipe, left: run.left } : null,
  };
}

/** The window's message, if it is open on a station that still exists. */
function refresh(p: Player): Outgoing[] {
  const name = p.recipe.window;
  if (name === null) {
    return [];
  }
  const station = recipeStation(name);
  if (!station) {
    p.recipe.window = null;
    return [{ to: p.id, msg: { t: "recipes", view: null } }];
  }
  return [{ to: p.id, msg: { t: "recipes", view: view(p, station) } }];
}

/** Opens the crafting window on a recipe station (Ctrl at its item, or Use on an item that opens it). */
export function openRecipeWindow(p: Player, station: RecipeStation): Outgoing[] {
  p.recipe.window = station.name;
  return refresh(p);
}

/** The window closed on the client; a running Make X carries on. */
export function recipeCloseIntent(p: Player): Outgoing[] {
  p.recipe.window = null;
  return [];
}

/** The skill a recipe trains, by its index, or undefined when the world has no such skill. */
function skillIndexOf(recipe: Recipe): number | undefined {
  return findSkillIndex(recipe.skill);
}

/** The frames the next craft of a run takes. */
function framesFor(p: Player, station: RecipeStation, recipe: Recipe): number {
  return recipeFrames(
    recipe,
    skillValue(p.char.skills, recipe.skill),
    toolTier(station, crafterOf(p)),
  );
}

/** The window's Make: starts a Make X of `count`, replacing any run under way. */
export function recipeMakeIntent(
  room: Room,
  p: Player,
  recipeName: string,
  count: number,
): Outgoing[] {
  if (p.deadLock > 0 || p.loading > 0 || p.recipe.window === null) {
    return [];
  }
  const station = recipeStation(p.recipe.window);
  const recipe = recipeNamed(recipeName);
  if (!station || !recipe || !lingoEq(recipe.station, station.name)) {
    return [];
  }
  if (!atStation(room, p, station)) {
    return [tell(p, RECIPE_TEXT.notHere)];
  }
  const refusal = recipeRefusal(recipe, station, crafterOf(p));
  if (refusal !== null) {
    return [tell(p, refusal)];
  }
  p.recipe.run = {
    station: station.name,
    recipe: recipe.name,
    left: count,
    counter: framesFor(p, station, recipe),
    at: { map: p.map.name, x: p.x, y: p.y, facing: p.facing },
  };
  return refresh(p);
}

/** Ends the running Make X with a line, and refreshes the window. */
function stopRun(p: Player, line: string | null): Outgoing[] {
  if (!p.recipe.run) {
    return [];
  }
  p.recipe.run = null;
  return [...(line ? [tell(p, line)] : []), ...refresh(p)];
}

/** The window's Stop. */
export function recipeStopIntent(p: Player): Outgoing[] {
  return stopRun(p, RECIPE_TEXT.stopped);
}

/** A map change, an attack or anything else that ends a run at once. */
export function cancelRecipeRun(p: Player): Outgoing[] {
  return stopRun(p, RECIPE_TEXT.stopped);
}

/** Whether a Make X is under way where it started (the station animates). */
export function recipeRunning(p: Player): boolean {
  const run = p.recipe.run;
  return (
    run !== null &&
    p.deadLock === 0 &&
    run.at.map === p.map.name &&
    run.at.x === p.x &&
    run.at.y === p.y &&
    run.at.facing === p.facing
  );
}

/** A built Crate, Cabinet, Wind Cabinet or Cauldron gets a minted id as it enters the bag. */
function withId(world: World, now: number) {
  return (name: string) =>
    ID_CONTAINERS.some((k) => lingoEq(name, k)) ? `${name}#${mintContainerId(world, now)}` : name;
}

/**
 * A frame of a running Make X: it ends when the crafter left the spot, and each craft that comes
 * due takes its materials and rolls its chance, then the next starts until none are left.
 */
export function recipeStep(room: Room, p: Player, ctx: RecipeCtx): Outgoing[] {
  const run = p.recipe.run;
  if (!run) {
    return [];
  }
  const station = recipeStation(run.station);
  const recipe = recipeNamed(run.recipe);
  if (!station || !recipe || !recipeRunning(p) || !atStation(room, p, station)) {
    return stopRun(p, RECIPE_TEXT.stopped);
  }
  run.counter -= 1;
  if (run.counter > 0) {
    return [];
  }
  const refusal = recipeRefusal(recipe, station, crafterOf(p));
  if (refusal !== null) {
    return stopRun(p, refusal);
  }
  const skill = skillValue(p.char.skills, recipe.skill);
  const chance = recipeChance(recipe, skill, toolTier(station, crafterOf(p)));
  const before = holdingsOf(p.char);
  const r = finishRecipe(p.char, recipe, chance, ctx.rng, withId(ctx.world, ctx.now), skill);
  if (!r.done) {
    return stopRun(p, r.line);
  }
  logBagChange(ctx.world, p, "craft", before, holdingsOf(p.char), {
    details: { recipe: recipe.name, failed: r.made ? null : true },
  });
  p.invDirty = true;
  const out: Outgoing[] = [tell(p, r.line)];
  if (r.made) {
    const i = skillIndexOf(recipe);
    if (i !== undefined) {
      const levels = train(
        fighterOf(p),
        i,
        "craft",
        ctx.rng,
        recipe.xp === undefined ? {} : { xp: recipe.xp },
      );
      out.push(...advancedLines(i, levels).map((l) => tell(p, l)));
    }
  }
  run.left -= 1;
  if (run.left <= 0) {
    p.recipe.run = null;
  } else {
    run.counter = framesFor(p, station, recipe);
  }
  out.push(...refresh(p));
  return out;
}

/**
 * Using a recipe book: it teaches the recipes naming it that the reader does not know, and is used
 * up. One that teaches nothing new is kept. Null when the item teaches no recipe.
 */
export function readRecipeBook(
  p: Player,
  item: string,
): { lines: string[]; consume: boolean } | null {
  const taught = recipesTaughtBy(item);
  if (taught.length === 0) {
    return null;
  }
  const fresh = taught.filter((r) => !p.recipe.known.has(r.name.toLowerCase()));
  if (fresh.length === 0) {
    return { lines: [RECIPE_TEXT.known], consume: false };
  }
  for (const r of fresh) {
    p.recipe.known.add(r.name.toLowerCase());
  }
  p.recipe.knownDirty = true;
  return { lines: [RECIPE_TEXT.learned(fresh.length)], consume: true };
}

/** The crafting window's refresh after the bag changed some other way (a pickup, a trade). */
export function recipeWindowRefresh(p: Player): Outgoing[] {
  return refresh(p);
}
