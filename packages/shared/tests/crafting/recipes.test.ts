/**
 * Recipe crafting's rules (issue #45): recipe stations and recipes, the window's rows, the odds
 * and time by level with tool tiers, and one craft's materials and outputs. Classic has none.
 */
import { afterEach, describe, expect, test } from "bun:test";

import type { Recipe, RecipeStation } from "@secondstaronline/data";
import { classicData } from "@secondstaronline/data/classic";

import { buildContentStore, type ContentData, installContent } from "../../src/content/store.ts";
import { skillIndex } from "../../src/rules/core/fighter.ts";
import type { Rng } from "../../src/rules/core/lingo.ts";
import {
  craftsAffordable,
  finishRecipe,
  RECIPE_TEXT,
  type RecipeCrafter,
  recipeChance,
  recipeFrames,
  recipeNamed,
  recipeRefusal,
  recipeState,
  recipeStation,
  recipesTaughtBy,
  stationAt,
  stationOpenedBy,
  stationRows,
  toolTier,
} from "../../src/rules/crafting/recipes.ts";
import type { Bag } from "../../src/rules/inventory/inventory.ts";

const forge: RecipeStation = {
  name: "Forge",
  at: ["Anvil"],
  tools: [
    { item: "Blacksmith Hammer", tier: 1 },
    { item: "Gold Hammer", tier: 3 },
  ],
  aboveLevel: "show",
};
const fletching: RecipeStation = { name: "Fletching", opens: ["Knife"], aboveLevel: "hide" };

const dagger: Recipe = {
  name: "Iron Dagger",
  station: "Forge",
  category: "Daggers",
  materials: [{ item: "Chunk of Iron", qty: 2 }],
  output: { item: "Dagger", qty: 1 },
  skill: "Blacksmithing",
  level: 10,
  xp: 25,
  time: [
    { level: 10, frames: 100 },
    { level: 60, frames: 50 },
  ],
};
const sword: Recipe = {
  name: "Long Sword",
  station: "Forge",
  category: "Swords",
  materials: [
    { item: "Chunk of Iron", qty: 3 },
    { item: "Logs", qty: 1 },
  ],
  keeps: [{ item: "Sword Mould", qty: 1 }],
  tier: 2,
  output: { item: "Long Sword", qty: 1 },
  failure: { item: "Chunk of Iron", qty: 1 },
  skill: "Blacksmithing",
  level: 40,
  odds: [
    { level: 40, percent: 50 },
    { level: 80, percent: 100 },
  ],
  tierBonus: 10,
  tierSpeed: 20,
  time: [{ level: 0, frames: 200 }],
};
const arrows: Recipe = {
  name: "Arrows",
  station: "Fletching",
  materials: [{ item: "Logs", qty: 1 }],
  output: { item: "Arrow", qty: 15 },
  skill: "Carpentry",
  level: 30,
  time: [{ level: 0, frames: 40 }],
  book: "Fletching Book",
};

function install(): void {
  const d = structuredClone(classicData) as ContentData;
  d.craft.recipeStations = [forge, fletching];
  d.craft.recipes = [dagger, sword, arrows];
  installContent(buildContentStore(d));
}

afterEach(() => installContent(buildContentStore(classicData as ContentData)));

const crafter = (
  bag: Bag,
  levels: Record<string, number> = {},
  more: Partial<RecipeCrafter> = {},
) => {
  const skills = Array.from({ length: 64 }, () => 0);
  for (const [k, v] of Object.entries(levels)) {
    skills[skillIndex(k)] = v;
  }
  return { bag, held: ["NOTHING", "NOTHING"], skills, known: new Set<string>(), ...more };
};
const bag = (...lines: [string, number][]): Bag => {
  const b: Bag = Array.from({ length: 15 }, () => null);
  lines.forEach(([item, qty], i) => {
    b[i] = { item, qty };
  });
  return b;
};
/** `random(10000)` answers these in turn, then 10000. */
const dice = (...rolls: number[]): Rng => ({
  random: (n) => (n === 10_000 && rolls.length > 0 ? (rolls.shift() as number) : n),
});

describe("recipe stations", () => {
  test("Classic has no recipe stations or recipes: its Anvil and tools open nothing", () => {
    expect(stationAt("Anvil")).toBeNull();
    expect(stationOpenedBy("Knife")).toBeNull();
    expect(recipeNamed("Iron Dagger")).toBeNull();
    expect(classicData.craft.recipeStations).toBeUndefined();
    expect(classicData.craft.recipes).toBeUndefined();
  });

  test("a station is found by its ground item or the bag item that opens it, ignoring case", () => {
    install();
    expect(stationAt("anvil")?.name).toBe("Forge");
    expect(stationOpenedBy("KNIFE")?.name).toBe("Fletching");
    expect(recipeStation("forge")?.name).toBe("Forge");
    expect(recipesTaughtBy("Fletching Book").map((r) => r.name)).toEqual(["Arrows"]);
  });

  test("the best tool held or in the bag sets the tier; none is 0, a station with no tools null", () => {
    install();
    expect(toolTier(forge, crafter(bag()))).toBe(0);
    expect(toolTier(forge, crafter(bag(["Blacksmith Hammer", 1])))).toBe(1);
    expect(
      toolTier(
        forge,
        crafter(bag(["Blacksmith Hammer", 1]), {}, { held: ["Gold Hammer", "NOTHING"] }),
      ),
    ).toBe(3);
    expect(toolTier(fletching, crafter(bag()))).toBeNull();
  });
});

describe("odds and time", () => {
  test("time runs in a straight line between its levels and is flat past the ends", () => {
    install();
    expect(recipeFrames(dagger, 0, 1)).toBe(100);
    expect(recipeFrames(dagger, 35, 1)).toBe(75);
    expect(recipeFrames(dagger, 99, 1)).toBe(50);
  });

  test("a better tool adds its tier bonus to the odds and its speed to the time", () => {
    install();
    expect(recipeChance(sword, 40, 2)).toBeCloseTo(0.5);
    expect(recipeChance(sword, 60, 2)).toBeCloseTo(0.75);
    // Tier 3 is one above the recipe's lowest (2): +10 points, 20% quicker.
    expect(recipeChance(sword, 40, 3)).toBeCloseTo(0.6);
    expect(recipeFrames(sword, 40, 3)).toBe(160);
    expect(recipeChance(sword, 99, 3)).toBe(1);
  });

  test("a recipe with no odds never fails", () => {
    install();
    expect(recipeChance(dagger, 10, 1)).toBe(1);
  });
});

describe("what stops a craft", () => {
  test("learning, then level, then tool, then materials", () => {
    install();
    const none = crafter(bag(["Logs", 5]), { Carpentry: 10 });
    expect(recipeState(arrows, fletching, none)).toBe("unlearned");
    expect(recipeRefusal(arrows, fletching, none)).toBe(RECIPE_TEXT.unlearned);
    const learned = { ...none, known: new Set(["arrows"]) };
    expect(recipeState(arrows, fletching, learned)).toBe("level");
    expect(recipeRefusal(arrows, fletching, learned)).toBe("You need Carpentry 30 to make this.");
    const sm = crafter(bag(["Chunk of Iron", 9], ["Logs", 1], ["Sword Mould", 1]), {
      Blacksmithing: 50,
    });
    expect(recipeRefusal(sword, forge, sm)).toBe("You need a Gold Hammer to make this.");
    sm.bag[5] = { item: "Blacksmith Hammer", qty: 1 };
    expect(recipeRefusal(sword, forge, sm)).toBe(RECIPE_TEXT.needTier);
    sm.bag[5] = { item: "Gold Hammer", qty: 1 };
    expect(recipeRefusal(sword, forge, sm)).toBeNull();
    sm.bag[2] = null; // the mould is needed, though never used up
    expect(recipeRefusal(sword, forge, sm)).toBe("You don't have enough Sword Mould.");
  });

  test("crafts affordable count materials only; a kept item is not used up", () => {
    install();
    expect(craftsAffordable(sword, bag(["Chunk of Iron", 10], ["Logs", 2]))).toBe(2);
    expect(craftsAffordable(dagger, bag(["Chunk of Iron", 3], ["Chunk of Iron", 4]))).toBe(3);
    expect(craftsAffordable(dagger, bag())).toBe(0);
  });
});

describe("the crafting window's rows", () => {
  test("a station that hides recipes above the level leaves them out; one that shows them locks them", () => {
    install();
    const low = crafter(bag(["Chunk of Iron", 2]), { Blacksmithing: 10, Carpentry: 10 });
    const forgeRows = stationRows(forge, low);
    expect(forgeRows.map((r) => [r.name, r.state])).toEqual([
      ["Iron Dagger", "tool"],
      ["Long Sword", "level"],
    ]);
    expect(forgeRows[0]?.materials).toEqual([{ item: "Chunk of Iron", qty: 2, have: 2 }]);
    expect(forgeRows[0]).toMatchObject({
      category: "Daggers",
      xp: 25,
      affordable: 1,
      chance: 1,
      why: "You need a Blacksmith Hammer to make this.",
    });
    expect(stationRows(fletching, low)).toEqual([]);
  });

  test("a recipe's own choice overrides its station's", () => {
    install();
    const d = structuredClone(classicData) as ContentData;
    d.craft.recipeStations = [forge, fletching];
    d.craft.recipes = [dagger, { ...sword, aboveLevel: "hide" }, { ...arrows, aboveLevel: "show" }];
    installContent(buildContentStore(d));
    const low = crafter(bag(), { Blacksmithing: 10 });
    expect(stationRows(forge, low).map((r) => r.name)).toEqual(["Iron Dagger"]);
    expect(stationRows(fletching, low).map((r) => [r.name, r.state])).toEqual([
      ["Arrows", "unlearned"],
    ]);
  });
});

describe("one craft", () => {
  test("a success takes the materials and adds the output's quantity", () => {
    install();
    const inv = { bag: bag(["Logs", 3]), gold: 0 };
    const r = finishRecipe(inv, arrows, 1, dice());
    expect(r).toMatchObject({ done: true, made: true, line: "You make 15 Arrow." });
    expect(inv.bag[0]).toEqual({ item: "Logs", qty: 2 });
    expect(inv.bag[1]).toEqual({ item: "Arrow", qty: 15 });
  });

  test("a failure uses the materials and makes the failure output; a kept item stays", () => {
    install();
    const inv = { bag: bag(["Chunk of Iron", 3], ["Logs", 1], ["Sword Mould", 1]), gold: 0 };
    const r = finishRecipe(inv, sword, 0.5, dice(9000));
    expect(r).toMatchObject({
      done: true,
      made: false,
      line: "You fail, and make Chunk of Iron instead.",
    });
    expect(inv.bag.slice(0, 3)).toEqual([
      { item: "Chunk of Iron", qty: 1 },
      null,
      { item: "Sword Mould", qty: 1 },
    ]);
  });

  test("a failure with no failure output makes nothing", () => {
    install();
    const inv = { bag: bag(["Chunk of Iron", 2]), gold: 0 };
    const r = finishRecipe(inv, { ...dagger, odds: [{ level: 0, percent: 0 }] }, 0, dice());
    expect(r).toMatchObject({ done: true, made: false, line: "You fail to make Dagger." });
    expect(inv.bag.every((l) => l === null)).toBe(true);
  });

  test("a full bag changes nothing and says so", () => {
    install();
    const lines: [string, number][] = Array.from({ length: 15 }, (_, i) => [`Thing${i}`, 1]);
    lines[0] = ["Chunk of Iron", 2];
    const inv = { bag: bag(...lines), gold: 0 };
    const before = structuredClone(inv.bag);
    const r = finishRecipe(
      inv,
      { ...dagger, materials: [{ item: "Chunk of Iron", qty: 1 }] },
      1,
      dice(),
    );
    expect(r).toMatchObject({ done: false, line: RECIPE_TEXT.full });
    expect(inv.bag).toEqual(before);
  });
});
