/**
 * Masterworks for every craft (`craft.json` `masterworks`): a successful craft of a listed item
 * may come out as one of its masterworks, by a chance at the craft's skill, in the crafting
 * window's recipes and the Classic stations alike. Classic has none, so it rolls as before.
 */
import { afterEach, describe, expect, test } from "bun:test";

import type { Masterwork, Recipe } from "@secondstaronline/data";
import { classicData } from "@secondstaronline/data/classic";

import { buildContentStore, type ContentData, installContent } from "../../src/content/store.ts";
import { skillIndex } from "../../src/rules/core/fighter.ts";
import type { Rng } from "../../src/rules/core/lingo.ts";
import { type CraftJob, finishCraft } from "../../src/rules/crafting/craft.ts";
import {
  masterworkBase,
  masterworkChance,
  masterworksOf,
  rollMasterwork,
  weaponIs,
} from "../../src/rules/crafting/masterwork.ts";
import { finishRecipe, stationRows } from "../../src/rules/crafting/recipes.ts";
import { type Bag, emptyBag } from "../../src/rules/inventory/inventory.ts";

/** Answers `random(n)` from per-n queues; otherwise `n` (never 1 unless n = 1). */
function rngByN(queues: Record<number, number[]> = {}): Rng & { calls: number[] } {
  const calls: number[] = [];
  return {
    calls,
    random(n) {
      calls.push(n);
      const q = queues[n];
      return q && q.length > 0 ? (q.shift() as number) : n;
    },
  };
}

function bagOf(...lines: [string, number][]): Bag {
  const bag = emptyBag();
  lines.forEach(([item, qty], i) => {
    bag[i] = { item, qty };
  });
  return bag;
}

const always = [{ level: 0, percent: 100 }];
const leather: Masterwork = {
  item: "Leather Armor",
  odds: [
    { level: 10, percent: 0 },
    { level: 60, percent: 10 },
  ],
  results: [
    { item: "Leather Armor +1", weight: 3 },
    { item: "Leather Armor +2", weight: 1 },
  ],
};
const tanning: Recipe = {
  name: "Leather Armor",
  station: "Tanning Rack",
  materials: [{ item: "Hide", qty: 3 }],
  output: { item: "Leather Armor", qty: 1 },
  skill: "Carpentry",
  level: 10,
  time: [{ level: 0, frames: 100 }],
};

function install(rows: Masterwork[], more: (d: ContentData) => void = () => {}): void {
  const d = structuredClone(classicData) as ContentData;
  d.craft.masterworks = rows;
  more(d);
  installContent(buildContentStore(d));
}

afterEach(() => installContent(buildContentStore(classicData as ContentData)));

describe("the masterwork roll", () => {
  test("Classic has no masterworks: a craft draws no extra dice", () => {
    expect(classicData.craft.masterworks).toBeUndefined();
    const rng = rngByN();
    expect(rollMasterwork("Leather Armor", 99, rng)).toBe("Leather Armor");
    expect(rng.calls).toEqual([]);
    expect(masterworkChance("Leather Armor", 99)).toBe(0);
  });

  test("the chance follows the crafting skill in a straight line between levels", () => {
    install([leather]);
    expect(masterworkChance("Leather Armor", 5)).toBe(0);
    expect(masterworkChance("leather armor", 35)).toBeCloseTo(0.05);
    expect(masterworkChance("Leather Armor", 99)).toBeCloseTo(0.1);
  });

  test("a hit picks a masterwork by weight; a miss keeps the item", () => {
    install([{ ...leather, odds: always }]);
    // Weights 3 and 1: rolls 1 to 3 make the +1, a roll of 4 the +2.
    expect(rollMasterwork("Leather Armor", 50, rngByN({ 4: [3] }))).toBe("Leather Armor +1");
    expect(rollMasterwork("Leather Armor", 50, rngByN({ 4: [4] }))).toBe("Leather Armor +2");
    install([leather]);
    // 10% at 60: a roll of 1001 out of 10000 misses, and no masterwork is picked.
    const miss = rngByN({ 10000: [1001] });
    expect(rollMasterwork("Leather Armor", 60, miss)).toBe("Leather Armor");
    expect(miss.calls).toEqual([10_000]);
  });

  test("a masterwork's base is its item, so rules written for the item cover it", () => {
    install([leather]);
    expect(masterworkBase("Leather Armor +2")).toBe("Leather Armor");
    expect(weaponIs("Leather Armor +1", "Leather Armor")).toBe(true);
    expect(masterworksOf("Leather Armor")).toEqual(["Leather Armor +1", "Leather Armor +2"]);
    // The Classic smithing table's masterworks still count.
    expect(masterworkBase("Knight's Sword +3")).toBe("Knight's Sword");
  });
});

describe("every craft can make a masterwork", () => {
  test("a crafting window recipe: the output comes out a masterwork by the recipe's skill", () => {
    install([{ ...leather, odds: always }]);
    const inv = { bag: bagOf(["Hide", 3]), gold: 0 };
    const r = finishRecipe(inv, tanning, 1, rngByN({ 4: [1] }), (n) => n, 50);
    expect(r).toMatchObject({ done: true, made: true, line: "You make Leather Armor +1." });
    expect(inv.bag[0]).toEqual({ item: "Leather Armor +1", qty: 1 });
  });

  test("a recipe's failure never makes a masterwork", () => {
    install([{ ...leather, odds: always }]);
    const inv = { bag: bagOf(["Hide", 3]), gold: 0 };
    const failing = { ...tanning, failure: { item: "Scraps", qty: 1 } };
    const r = finishRecipe(inv, failing, 0, rngByN(), (n) => n, 50);
    expect(r.made).toBe(false);
    expect(inv.bag[0]).toEqual({ item: "Scraps", qty: 1 });
  });

  test("the crafting window shows the masterwork chance at the crafter's skill", () => {
    install([leather], (d) => {
      d.craft.recipeStations = [{ name: "Tanning Rack", at: ["Tanning Rack"], aboveLevel: "show" }];
      d.craft.recipes = [tanning];
    });
    const skills = Array.from({ length: 64 }, () => 0);
    skills[skillIndex("Carpentry")] = 60;
    const rows = stationRows(
      { name: "Tanning Rack", at: ["Tanning Rack"], aboveLevel: "show" },
      { bag: bagOf(["Hide", 3]), held: ["NOTHING", "NOTHING"], skills, known: new Set() },
    );
    expect(rows[0]?.masterwork).toBeCloseTo(0.1);
  });

  test("Classic cooking: a successful meal can come out a masterwork", () => {
    install([
      { item: "Trout Fillet", odds: always, results: [{ item: "Trout Fillet +1", weight: 1 }] },
    ]);
    const i = { bag: bagOf(["Trout", 1]), gold: 0 };
    const r = finishCraft(i, { kind: "Cook", raw: "Trout" }, 50, rngByN());
    expect(r).toMatchObject({
      reached: true,
      gain: true,
      lines: ["Your Trout Fillet +1 is ready!"],
    });
    expect(i.bag[0]).toEqual({ item: "Trout Fillet +1", qty: 1 });
  });

  test("Classic smithing: its own table decides the items it lists; any other repair rolls the shared row", () => {
    install([
      { item: "Knight's Sword", odds: always, results: [{ item: "Knight's Sword +9", weight: 1 }] },
      { item: "Demon Helm", odds: always, results: [{ item: "Demon Helm +1", weight: 1 }] },
    ]);
    const knight: CraftJob = {
      kind: "Smith",
      item: "Damaged Sword, Knight",
      chunk: "Chunk of Steel",
    };
    const k = { bag: bagOf(["Damaged Sword, Knight", 1], ["Chunk of Steel", 1]), gold: 0 };
    // The smithing pool's miss (a roll of 250) keeps the plain sword: the shared row is not rolled.
    expect(finishCraft(k, knight, 0, rngByN()).lines).toEqual(["Your Knight's Sword is ready!"]);
    const demon: CraftJob = { kind: "Smith", item: "Damaged Helm, Demon", chunk: "Chunk of Steel" };
    const h = { bag: bagOf(["Damaged Helm, Demon", 1], ["Chunk of Steel", 1]), gold: 0 };
    expect(finishCraft(h, demon, 0, rngByN()).lines).toEqual(["Your Demon Helm +1 is ready!"]);
  });

  test("Classic plays as before: a repair with no masterworks draws only the smithing pool", () => {
    const rng = rngByN();
    const h = { bag: bagOf(["Damaged Helm, Demon", 1], ["Chunk of Steel", 1]), gold: 0 };
    const job: CraftJob = { kind: "Smith", item: "Damaged Helm, Demon", chunk: "Chunk of Steel" };
    expect(finishCraft(h, job, 0, rng).lines).toEqual(["Your Demon Helm is ready!"]);
    expect(rng.calls).toEqual([250]);
  });
});
