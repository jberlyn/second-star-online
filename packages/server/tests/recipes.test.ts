/**
 * Recipe crafting in the sim (issue #45): Ctrl at a recipe station or Use on a crafting tool opens
 * the crafting window; Make X runs crafts one after another until they are made, the materials run
 * out, the crafter moves, attacks or stops; a recipe book teaches its recipes; learned recipes are
 * saved (real SQL on in-memory SQLite). Classic has no recipe stations, so none of it reaches it.
 */
import { afterEach, describe, expect, test } from "bun:test";

import type { Recipe, RecipeStation } from "@secondstaronline/data";
import { classicData } from "@secondstaronline/data/classic";
import {
  buildContentStore,
  type ContentData,
  installContent,
  RECIPE_TEXT,
  type RecipeWindowView,
  type ServerMsg,
  skillIndex,
} from "@secondstaronline/shared";

import { recipeProblems } from "../src/content/validate.ts";
import { createGame } from "../src/game.ts";
import { openDatabase } from "../src/persistence/database.ts";
import { migrate } from "../src/persistence/migrations.ts";
import { loadRecipes, saveRecipes } from "../src/persistence/recipes.ts";
import {
  cancelRecipeRun,
  recipeCloseIntent,
  recipeMakeIntent,
  recipeRunning,
  recipeStopIntent,
} from "../src/systems/crafting/recipes.ts";
import { actionIntent, type ItemCtx, useIntent } from "../src/systems/inventory/items.ts";
import type { Room } from "../src/systems/world/world.ts";
import { player, rngByN, setup, testMap } from "./helpers/sim.ts";

type Out = { to: string; msg: ServerMsg }[];

const lines = (out: Out, to: string): string[] =>
  out.flatMap((o) => (o.to === to && o.msg.t === "chat" ? [o.msg.text] : []));
const windows = (out: Out, to: string): (RecipeWindowView | null)[] =>
  out.flatMap((o) => (o.to === to && o.msg.t === "recipes" ? [o.msg.view] : []));

const forge: RecipeStation = {
  name: "Forge",
  at: ["Anvil"],
  tools: [{ item: "Blacksmith Hammer", tier: 1 }],
  aboveLevel: "show",
};
const fletching: RecipeStation = { name: "Fletching", opens: ["Knife"], aboveLevel: "hide" };
const dagger: Recipe = {
  name: "Iron Dagger",
  station: "Forge",
  materials: [{ item: "Chunk of Iron", qty: 2 }],
  output: { item: "Dagger", qty: 1 },
  skill: "Blacksmithing",
  level: 0,
  time: [{ level: 0, frames: 10 }],
};
const arrows: Recipe = {
  name: "Arrows",
  station: "Fletching",
  materials: [{ item: "Logs", qty: 1 }],
  output: { item: "Arrow", qty: 15 },
  skill: "Carpentry",
  level: 0,
  time: [{ level: 0, frames: 5 }],
  book: "Fletching Book",
};

function withRecipes(): ContentData {
  const d = structuredClone(classicData) as ContentData;
  d.craft.recipeStations = [forge, fletching];
  d.craft.recipes = [dagger, arrows];
  return d;
}

afterEach(() => installContent(buildContentStore(classicData as ContentData)));

/** A crafter at (5, 6) facing north at an Anvil on (5, 5). */
function bench(recipes = true) {
  if (recipes) {
    installContent(buildContentStore(withRecipes()));
  }
  const map = testMap("x1000y992");
  const s = setup([map], undefined, rngByN());
  const a = player("a", map, 5, 6);
  a.facing = "N";
  s.join(a);
  const room = s.world.rooms.get(map.name) as Room;
  map.ground.push({ id: "st", item: "Anvil", x: 5, y: 5, kind: "admin", expiresAt: null });
  const ctx = { world: s.world, rng: rngByN(), stepLength: 16 } as unknown as ItemCtx;
  const ctrl = () => {
    a.itemPause = 0;
    return actionIntent(ctx, room, a);
  };
  const use = (slot: number) => {
    a.itemPause = 0;
    return useIntent(ctx, room, a, slot);
  };
  return { ...s, map, room, a, ctrl, use };
}

describe("Classic", () => {
  test("Ctrl at an Anvil opens no crafting window: Classic has no recipe stations", () => {
    const k = bench(false);
    expect(windows(k.ctrl(), "a")).toEqual([]);
    expect(k.a.recipe.window).toBeNull();
  });
});

describe("the crafting window", () => {
  test("Ctrl at a recipe station opens its window with its recipes", () => {
    const k = bench();
    k.a.char.bag[0] = { item: "Chunk of Iron", qty: 4 };
    const [view] = windows(k.ctrl(), "a");
    expect(view?.station).toBe("Forge");
    expect(view?.rows.map((r) => [r.name, r.state, r.affordable])).toEqual([
      ["Iron Dagger", "tool", 2],
    ]);
    expect(k.a.recipe.window).toBe("Forge");
  });

  test("Use on a crafting tool opens its station anywhere", () => {
    const k = bench();
    k.a.char.bag[0] = { item: "Knife", qty: 1 };
    k.a.recipe.known.add("arrows");
    const [view] = windows(k.use(1), "a");
    expect(view?.station).toBe("Fletching");
    expect(view?.rows.map((r) => r.name)).toEqual(["Arrows"]);
  });

  test("Make X makes one after another and stops when they are made", () => {
    const k = bench();
    k.a.char.bag[0] = { item: "Chunk of Iron", qty: 6 };
    k.a.char.bag[1] = { item: "Blacksmith Hammer", qty: 1 };
    k.ctrl();
    const start = recipeMakeIntent(k.room, k.a, "Iron Dagger", 2);
    expect(windows(start, "a")[0]?.run).toEqual({ recipe: "Iron Dagger", left: 2 });
    expect(lines(k.run(9), "a")).toEqual([]);
    expect(lines(k.run(1), "a")).toEqual(["You make Dagger."]);
    expect(lines(k.run(10), "a")).toEqual(["You make Dagger."]);
    expect(k.a.recipe.run).toBeNull();
    expect(k.a.char.bag[0]).toEqual({ item: "Chunk of Iron", qty: 2 });
    expect(k.a.char.bag[2]).toEqual({ item: "Dagger", qty: 2 });
    // The keys stay free (RuneScape's way): no lock is ever sent.
    expect(k.a.keyLock).toBe(false);
  });

  test("a run ends when the materials run out, with what is missing", () => {
    const k = bench();
    k.a.char.bag[0] = { item: "Chunk of Iron", qty: 3 };
    k.a.char.bag[1] = { item: "Blacksmith Hammer", qty: 1 };
    k.ctrl();
    recipeMakeIntent(k.room, k.a, "Iron Dagger", 10_000);
    expect(lines(k.run(20), "a")).toEqual([
      "You make Dagger.",
      "You don't have enough Chunk of Iron.",
    ]);
    expect(k.a.recipe.run).toBeNull();
  });

  test("moving or turning off the spot ends the run, with nothing taken", () => {
    const k = bench();
    k.a.char.bag[0] = { item: "Chunk of Iron", qty: 4 };
    k.a.char.bag[1] = { item: "Blacksmith Hammer", qty: 1 };
    k.ctrl();
    recipeMakeIntent(k.room, k.a, "Iron Dagger", 2);
    expect(recipeRunning(k.a)).toBe(true);
    k.a.facing = "E";
    expect(lines(k.run(1), "a")).toEqual([RECIPE_TEXT.stopped]);
    expect(k.a.recipe.run).toBeNull();
    expect(k.a.char.bag[0]).toEqual({ item: "Chunk of Iron", qty: 4 });
  });

  test("Stop, an attack and closing the window", () => {
    const k = bench();
    k.a.char.bag[0] = { item: "Chunk of Iron", qty: 4 };
    k.a.char.bag[1] = { item: "Blacksmith Hammer", qty: 1 };
    k.ctrl();
    recipeMakeIntent(k.room, k.a, "Iron Dagger", 2);
    // Closing the window leaves the run going.
    recipeCloseIntent(k.a);
    expect(k.a.recipe.run).not.toBeNull();
    expect(lines(recipeStopIntent(k.a), "a")).toEqual([RECIPE_TEXT.stopped]);
    expect(k.a.recipe.run).toBeNull();
    k.ctrl();
    recipeMakeIntent(k.room, k.a, "Iron Dagger", 2);
    expect(lines(cancelRecipeRun(k.a), "a")).toEqual([RECIPE_TEXT.stopped]);
    expect(lines(cancelRecipeRun(k.a), "a")).toEqual([]);
  });

  test("a recipe that cannot be made is refused at Make; one from another station is ignored", () => {
    const k = bench();
    k.a.char.bag[0] = { item: "Chunk of Iron", qty: 4 };
    k.ctrl();
    expect(lines(recipeMakeIntent(k.room, k.a, "Iron Dagger", 1), "a")).toEqual([
      "You need a Blacksmith Hammer to make this.",
    ]);
    expect(recipeMakeIntent(k.room, k.a, "Arrows", 1)).toEqual([]);
    expect(k.a.recipe.run).toBeNull();
  });

  test("a recipe above the level is refused", () => {
    const d = withRecipes();
    d.craft.recipes = [{ ...dagger, level: 50 }];
    installContent(buildContentStore(d));
    const k = bench(false);
    k.a.char.skills[skillIndex("Blacksmithing")] = 10;
    k.a.char.bag[0] = { item: "Chunk of Iron", qty: 4 };
    k.a.char.bag[1] = { item: "Blacksmith Hammer", qty: 1 };
    const [view] = windows(k.ctrl(), "a");
    expect(view?.rows.map((r) => r.state)).toEqual(["level"]);
    expect(lines(recipeMakeIntent(k.room, k.a, "Iron Dagger", 1), "a")).toEqual([
      "You need Blacksmithing 50 to make this.",
    ]);
  });
});

describe("recipe books", () => {
  test("a book teaches its recipes and is used up; one that teaches nothing new is kept", () => {
    const k = bench();
    k.a.char.bag[0] = { item: "Fletching Book", qty: 2 };
    expect(lines(k.use(1), "a")).toEqual(["You learn a new recipe."]);
    expect([...k.a.recipe.known]).toEqual(["arrows"]);
    expect(k.a.recipe.knownDirty).toBe(true);
    expect(k.a.char.bag[0]).toEqual({ item: "Fletching Book", qty: 1 });
    expect(lines(k.use(1), "a")).toEqual([RECIPE_TEXT.known]);
    expect(k.a.char.bag[0]).toEqual({ item: "Fletching Book", qty: 1 });
  });

  test("an unlearned recipe is hidden at a station that hides locked recipes", () => {
    const k = bench();
    k.a.char.bag[0] = { item: "Knife", qty: 1 };
    expect(windows(k.use(1), "a")[0]?.rows).toEqual([]);
  });

  test("learned recipes are saved with the character and come back at the next login", async () => {
    const db = openDatabase();
    migrate(db);
    const g = createGame({
      db,
      send: () => {},
      isoNow: () => "2026-11-26T00:00:00.000Z",
      rng: rngByN(),
      minute: () => 0,
    });
    const made = await g.create({
      t: "create",
      name: "Fletcher",
      password: "pw",
      sex: 1,
      head: 1,
      classCode: 1,
      str: 11,
      sta: 11,
      int: 11,
      wis: 11,
      dex: 11,
    });
    expect(made.ok).toBe(true);
    const l = await g.login("Fletcher", "pw");
    if (!l.ok) {
      throw new Error(l.text);
    }
    const id = l.characterId;
    expect(loadRecipes(db, id)).toEqual([]);
    saveRecipes(db, id, ["arrows", "bows"]);
    expect(loadRecipes(db, id)).toEqual(["arrows", "bows"]);
    g.enter(id, false);
    expect([...(g.world.players.get(id)?.recipe.known ?? [])]).toEqual(["arrows", "bows"]);
    // A recipe learned in play is written with the character's next save.
    const p = g.world.players.get(id);
    p?.recipe.known.add("shafts");
    if (p) {
      p.recipe.knownDirty = true;
    }
    g.saveAll();
    expect(loadRecipes(db, id)).toEqual(["arrows", "bows", "shafts"]);
    db.run("DELETE FROM characters WHERE id = ?", [id]);
    expect(loadRecipes(db, id)).toEqual([]);
  });
});

describe("publish checks", () => {
  test("a recipe at no recipe station, and an item opening two stations, are problems", () => {
    const d = withRecipes();
    d.craft.recipes = [{ ...dagger, station: "Kiln" }];
    d.craft.recipeStations = [forge, { ...fletching, at: ["Anvil"] }];
    expect(recipeProblems(d).map((p) => p.message)).toEqual([
      "it is made at Kiln, which is not a recipe station: pick one, or add it",
      "Anvil already is the station item of Forge: one item opens one station",
    ]);
    expect(recipeProblems(withRecipes())).toEqual([]);
    expect(recipeProblems(classicData as ContentData)).toEqual([]);
  });
});
