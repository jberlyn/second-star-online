/**
 * Golden tests for the crafting stations and the Cauldron: each test pins one behaviour of 1.6, or
 * one fixed 1.6 bug ("bug fixed:").
 */
import { describe, expect, test } from "bun:test";

import { classicData } from "@secondstaronline/data/classic";

const { craft: craftData, items: itemsData } = classicData;

import { buildContentStore, type ContentData, installContent } from "../../src/content/store.ts";
import { damagedForm } from "../../src/rules/combat/armour.ts";
import type { Rng } from "../../src/rules/core/lingo.ts";
import {
  burnedResult,
  CRAFT_ORDER,
  CRAFT_TEXT,
  type CraftJob,
  type CraftView,
  carpentryResult,
  cauldronBrew,
  cookResult,
  craftKind,
  craftTimer,
  failurePool,
  finishCraft,
  masterwork,
  masterworkPool,
  repairResult,
  rollFailure,
  smithChunk,
  startCraft,
  takeByName,
} from "../../src/rules/crafting/craft.ts";
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

function view(over: Partial<CraftView> & { skills?: Record<string, number> }): CraftView {
  const skills = over.skills ?? {};
  return {
    bag: emptyBag(),
    leftHand: "NOTHING",
    rightHand: "NOTHING",
    // The view reads a craft's bound skill: Classic binds Cooking to Cooking and so on.
    skill: (b) => skills[classicData.bindings.skills[b] ?? ""] ?? 0,
    facing: () => false,
    keyLock: false,
    itemPause: 0,
    ...over,
  };
}

const at =
  (...stations: string[]) =>
  (s: string) =>
    stations.includes(s);

/** Fifteen filled slots: the bag is full. */
function fullBag(...first: [string, number][]): Bag {
  const lines = Array.from({ length: 15 }, (_, i): [string, number] => [`X${i}`, 1]);
  first.forEach((l, i) => {
    lines[i] = l;
  });
  return bagOf(...lines);
}

const inv = (bag: Bag) => ({ bag, gold: 0 });

describe("timers and the failure table", () => {
  test("bug fixed: Blacksmithing only ever gets faster as the skill rises", () => {
    expect(craftTimer("Smith", 0)).toBe(500);
    expect(craftTimer("Smith", 10)).toBe(500);
    expect(craftTimer("Smith", 11)).toBe(460);
    expect(craftTimer("Smith", 21)).toBe(400);
    expect(craftTimer("Smith", 99)).toBe(12);
    for (let s = 1; s <= 100; s++) {
      expect(craftTimer("Smith", s)).toBeLessThanOrEqual(craftTimer("Smith", s - 1));
    }
  });

  test("food, potion and carpentry share one table; a Campfire doubles cooking", () => {
    for (const k of ["Cook", "Mix", "Build"] as const) {
      expect(craftTimer(k, 0)).toBe(200);
      expect(craftTimer(k, 11)).toBe(190);
      expect(craftTimer(k, 91)).toBe(20);
    }
    expect(craftTimer("Cook", 0, true)).toBe(400);
    expect(craftTimer("Mix", 0, true)).toBe(200);
  });

  test("bug fixed: crafting skill exactly 10 can fail, at the odds of the skills below it", () => {
    expect(failurePool(0)).toBe(3);
    expect(failurePool(9)).toBe(3);
    expect(failurePool(10)).toBe(3);
    expect(failurePool(11)).toBe(5);
    expect(failurePool(41)).toBe(9);
    expect(failurePool(95)).toBe(100);
    const rng = rngByN({ 3: [1] });
    expect(rollFailure(10, rng)).toBe(true);
    expect(rng.calls).toEqual([3]);
    for (let s = 0; s <= 100; s++) {
      expect(failurePool(s)).not.toBeNull();
    }
  });

  test("the failure roll draws for every true line and the last draw decides", () => {
    // Carpentry 55: > 10, > 20, > 40, > 50 are true, so random(5), random(7), random(9), random(11).
    const early = rngByN({ 5: [1], 11: [2] });
    expect(rollFailure(55, early)).toBe(false);
    expect(early.calls).toEqual([5, 7, 9, 11]);
    expect(rollFailure(55, rngByN({ 5: [2], 11: [1] }))).toBe(true);
    // Under 10 only the first line is true: one random(3).
    const low = rngByN({ 3: [1] });
    expect(rollFailure(9, low)).toBe(true);
    expect(low.calls).toEqual([3]);
  });

  test("the counters run Smith, Cook, Build, Mix in one frame", () => {
    expect(CRAFT_ORDER).toEqual(["Smith", "Cook", "Build", "Mix"]);
  });

  test("the buttons exist only for their items", () => {
    expect(craftKind("Trout")).toBe("Cook");
    expect(craftKind("Raw Meat")).toBe("Cook");
    expect(craftKind("Potion Bottle")).toBe("Mix");
    expect(craftKind("Logs")).toBe("Build");
    expect(craftKind("Damaged Sword, Long")).toBe("Smith");
    expect(craftKind("Cooked Pig")).toBeNull();
    expect(craftKind("Cooked Meat")).toBeNull();
    expect(craftKind("Crate#4")).toBeNull();
  });
});

describe("Smith", () => {
  const item = "Damaged Helm, Demon";

  test("checks in order: anvil, a full bag, the hammer, the chunk", () => {
    const full = fullBag([item, 1]);
    expect(startCraft(view({ bag: full }), 1).lines).toEqual([CRAFT_TEXT.noAnvil]);
    const anvil = at("Anvil");
    expect(startCraft(view({ bag: full, facing: anvil }), 1).lines).toEqual([
      "Your inventory is too crowded!",
    ]);
    const bag = bagOf([item, 1]);
    expect(startCraft(view({ bag, facing: anvil }), 1).lines).toEqual([
      "You need to equip a blacksmith tool to repair this!",
    ]);
    const hammer = { bag, facing: anvil, leftHand: "Blacksmith Hammer" };
    expect(startCraft(view(hammer), 1).lines).toEqual([
      "You need a Chunk of Steel to repair this!",
    ]);
    bag[1] = { item: "Chunk of Steel", qty: 1 };
    const r = startCraft(view(hammer), 1);
    expect(r.lines).toEqual(["You begin to smith the Damaged Helm, Demon..."]);
    expect(r.started?.job).toEqual({ kind: "Smith", item, chunk: "Chunk of Steel" });
    // Nothing is taken at the start.
    expect(bag[0]).toEqual({ item, qty: 1 });
    expect(bag[1]).toEqual({ item: "Chunk of Steel", qty: 1 });
  });

  test("Iron by default; named rows", () => {
    expect(smithChunk("Damaged Sword, Long")).toBe("Chunk of Iron");
    expect(smithChunk("Damaged Armor, Lord's")).toBe("Chunk of Star");
    expect(smithChunk("Damaged Sword, Fire")).toBe("Chunk of Fire");
  });

  test("a lock or Ctrl's pause stops every button silently", () => {
    const bag = bagOf([item, 1]);
    expect(startCraft(view({ bag, keyLock: true }), 1)).toEqual({ lines: [], started: null });
    expect(startCraft(view({ bag, itemPause: 5 }), 1).lines).toEqual([]);
  });

  test("the masterwork pool and table", () => {
    expect(masterworkPool(50)).toBe(250);
    expect(masterworkPool(51)).toBe(100);
    expect(masterworkPool(99)).toBe(35);
    expect(masterwork("Knight's Sword", 4)).toBe("Knight's Sword +4");
    expect(masterwork("Long Sword", 1)).toBe("Long Sword"); // no row: no +N
  });

  test("bug fixed: each masterwork bonus has one roll, and every row can come up", () => {
    expect(masterwork("Chain Helm", 1)).toBe("Chain Helm +1");
    expect(masterwork("Chain Helm", 2)).toBe("Chain Helm");
    expect(masterwork("Steel Shield", 1)).toBe("Steel Shield +1");
    expect(masterwork("Steel Shield", 2)).toBe("Steel Shield");
    // Leather Armor never breaks, so nothing repairs into it: it has no masterwork row.
    expect(masterwork("Leather Armor", 1)).toBe("Leather Armor");
  });

  test("bug fixed: a broken Knight's Sword repairs", () => {
    // It breaks into the name that has art and a repair; 1.6's artless "Damaged Sword, Knight's"
    // is not in the Classic pack (a migration renames old copies).
    expect(damagedForm("Knight's Sword")).toBe("Damaged Sword, Knight");
    expect(repairResult("Damaged Sword, Knight")).toBe("Knight's Sword");
    expect(smithChunk("Damaged Sword, Knight")).toBe("Chunk of Steel");
    const bag = inv(bagOf(["Damaged Sword, Knight", 1], ["Chunk of Steel", 1]));
    const job: CraftJob = { kind: "Smith", item: "Damaged Sword, Knight", chunk: "Chunk of Steel" };
    expect(finishCraft(bag, job, 0, rngByN()).lines).toEqual(["Your Knight's Sword is ready!"]);
    expect(bag.bag[0]).toEqual({ item: "Knight's Sword", qty: 1 });
  });

  test("an item with no repair cannot be started", () => {
    const bag = bagOf(["Damaged Sword", 1], ["Chunk of Iron", 1]);
    const v = view({ bag, facing: at("Anvil"), leftHand: "Blacksmith Hammer" });
    expect(startCraft(v, 1)).toEqual({ lines: [CRAFT_TEXT.cantRepair], started: null });
  });

  test("completion: one of each taken, the server's skill rolls the pool", () => {
    const i = inv(bagOf([item, 1], ["Chunk of Steel", 2]));
    const r = finishCraft(i, { kind: "Smith", item, chunk: "Chunk of Steel" }, 0, rngByN());
    expect(r).toMatchObject({ reached: true, gain: true, lines: ["Your Demon Helm is ready!"] });
    expect(i.bag[0]).toEqual({ item: "Demon Helm", qty: 1 });
    expect(i.bag[1]).toEqual({ item: "Chunk of Steel", qty: 1 });
    const knight = inv(bagOf(["Damaged Sword, Knight", 1], ["Chunk of Steel", 1]));
    const job: CraftJob = { kind: "Smith", item: "Damaged Sword, Knight", chunk: "Chunk of Steel" };
    const k = finishCraft(knight, job, 99, rngByN({ 35: [3] }));
    expect(k.lines).toEqual(["Your Knight's Sword +3 is ready!"]);
  });

  test("divergence: a chunk gone at completion repairs nothing", () => {
    const i = inv(bagOf([item, 3]));
    const r = finishCraft(i, { kind: "Smith", item, chunk: "Chunk of Steel" }, 0, rngByN());
    expect(r.reached).toBe(false);
    expect(i.bag[0]).toEqual({ item, qty: 3 });
  });
});

describe("Cook", () => {
  test("checks the stove, the skill and the recipe; nothing is taken at the start", () => {
    const bag = bagOf(["Trout", 1]);
    expect(startCraft(view({ bag }), 1).lines).toEqual([CRAFT_TEXT.noStove]);
    expect(startCraft(view({ bag, facing: at("Stove") }), 1).lines).toEqual([
      "You aren't skilled in cooking, you'd just burn it",
    ]);
    const r = startCraft(view({ bag, facing: at("Stove"), skills: { Cooking: 1 } }), 1);
    expect(r.lines).toEqual(["You begin to cook the Trout."]);
    expect(r.started?.frames).toBe(200);
    expect(bag[0]).toEqual({ item: "Trout", qty: 1 });
    const fire = startCraft(view({ bag, facing: at("Campfire"), skills: { Cooking: 1 } }), 1);
    expect(fire.started?.frames).toBe(400);
  });

  test("a world that binds no cooking skill has no cooking: the button does nothing", () => {
    const bag = bagOf(["Trout", 1]);
    const v = view({ bag, facing: at("Stove"), skills: { Cooking: 50 } });
    const unbound = { ...v, skill: (b: string) => (b === "cooking" ? undefined : 50) };
    expect(startCraft(unbound, 1)).toEqual({ lines: [], started: null });
    expect(startCraft(v, 1).started).not.toBeNull();
  });

  test("bug fixed: a burned meal uses up its raw food and makes its burned form", () => {
    const i = inv(bagOf(["Trout", 2]));
    const r = finishCraft(i, { kind: "Cook", raw: "Trout" }, 1, rngByN({ 3: [1] }));
    expect(r).toMatchObject({ reached: true, lines: [CRAFT_TEXT.burned], gain: false });
    expect(r.added?.kind).toBe("bag");
    expect(i.bag[0]).toEqual({ item: "Trout", qty: 1 });
    expect(i.bag[1]).toEqual({ item: "Burned Trout", qty: 1 });
    // A second burn stacks on the first.
    finishCraft(i, { kind: "Cook", raw: "Trout" }, 1, rngByN({ 3: [1] }));
    expect(i.bag[0]).toBeNull();
    expect(i.bag[1]).toEqual({ item: "Burned Trout", qty: 2 });
  });

  test("every cookable has a burned form: a catalogue item with art and no Cook button", () => {
    const recipes = craftData.stations.cook!.recipes;
    expect(recipes.map((r) => [r.input, r.burned])).toEqual([
      ["Cyclops Meat", "Burned Cyclops Meat"],
      ["Orc Meat", "Burned Orc Meat"],
      ["Raw Fish", "Burned Fish"],
      ["Trout", "Burned Trout"],
      ["Catfish", "Burned Catfish"],
      ["Swordfish", "Burned Swordfish"],
      ["Yeti Meat", "Burned Yeti Meat"],
      ["Squid", "Burned Squid"],
      ["Pig", "Burned Pig"],
      ["Raw Meat", "Burned Meat"],
    ]);
    for (const r of recipes) {
      expect(burnedResult(r.input)).toBe(r.burned);
      const row = itemsData.items.find((i) => i.name === r.burned);
      expect(row?.icon, r.burned).toBe("added");
      expect(craftKind(r.burned), r.burned).toBeNull();
    }
    expect(burnedResult("Cooked Pig")).toBeNull();
  });

  test("a burn on a full bag says so, makes nothing and keeps the raw stack", () => {
    const i = inv(fullBag(["Orc Meat", 2]));
    const r = finishCraft(i, { kind: "Cook", raw: "Orc Meat" }, 1, rngByN({ 3: [1] }));
    expect(r).toEqual({ reached: true, lines: [CRAFT_TEXT.crowded], added: null, gain: false });
    expect(i.bag[0]).toEqual({ item: "Orc Meat", qty: 2 });
    // A last Orc Meat frees its own slot, so the burned meat fits.
    const one = inv(fullBag(["Orc Meat", 1]));
    const burned = finishCraft(one, { kind: "Cook", raw: "Orc Meat" }, 1, rngByN({ 3: [1] }));
    expect(burned.lines).toEqual([CRAFT_TEXT.burned]);
    expect(one.bag[0]).toEqual({ item: "Burned Orc Meat", qty: 1 });
  });

  test("bug fixed: each cook rolls its own burn", () => {
    // No session food carries over: a failed cook does not make the next one burn.
    const first = inv(bagOf(["Trout", 2]));
    finishCraft(first, { kind: "Cook", raw: "Trout" }, 1, rngByN({ 3: [1] }));
    const next = finishCraft(first, { kind: "Cook", raw: "Trout" }, 1, rngByN());
    expect(next.lines).toEqual(["Your Trout Fillet is ready!"]);
  });

  test("every item with a Cook button has a recipe, so the no-recipe refusal never shows", () => {
    const cooks = itemsData.items.filter((i) => craftKind(i.name) === "Cook").map((i) => i.name);
    expect(cooks.length).toBeGreaterThan(0);
    expect(cooks.filter((n) => cookResult(n) === null)).toEqual([]);
    expect(CRAFT_TEXT.cantCook).toBe("You don't know how to cook that.");
  });

  test("Raw Meat cooks into Cooked Meat and burns into Burned Meat", () => {
    expect(cookResult("Raw Meat")).toBe("Cooked Meat");
    const v = view({ bag: bagOf(["Raw Meat", 1]), facing: at("Stove"), skills: { Cooking: 1 } });
    expect(startCraft(v, 1).lines).toEqual(["You begin to cook the Raw Meat."]);
    const ok = inv(bagOf(["Raw Meat", 1]));
    const r = finishCraft(ok, { kind: "Cook", raw: "Raw Meat" }, 1, rngByN());
    expect(r).toMatchObject({ lines: ["Your Cooked Meat is ready!"], gain: true });
    expect(ok.bag[0]).toEqual({ item: "Cooked Meat", qty: 1 });
    const bad = inv(bagOf(["Raw Meat", 1]));
    finishCraft(bad, { kind: "Cook", raw: "Raw Meat" }, 1, rngByN({ 3: [1] }));
    expect(bad.bag[0]).toEqual({ item: "Burned Meat", qty: 1 });
  });

  test("bug fixed: Yeti Meat cooks into a Yeti Burger", () => {
    expect(cookResult("Yeti Meat")).toBe("Yeti Burger");
    const i = inv(bagOf(["Yeti Meat", 2]));
    const r = finishCraft(i, { kind: "Cook", raw: "Yeti Meat" }, 1, rngByN());
    expect(r.lines).toEqual(["Your Yeti Burger is ready!"]);
    expect(i.bag[0]).toEqual({ item: "Yeti Meat", qty: 1 });
    expect(i.bag[1]).toEqual({ item: "Yeti Burger", qty: 1 });
  });

  test("bug fixed: cooking a Pig takes the Pig, never a Cooked Pig", () => {
    const i = inv(bagOf(["Cooked Pig", 3], ["Pig", 1]));
    finishCraft(i, { kind: "Cook", raw: "Pig" }, 1, rngByN());
    expect(i.bag[0]).toEqual({ item: "Cooked Pig", qty: 4 });
    expect(i.bag[1]).toBeNull();
    // The removal matches whole names only.
    const b = bagOf(["Cooked Pig", 1]);
    expect(takeByName(b, "Pig")).toBe(false);
    expect(b[0]).toEqual({ item: "Cooked Pig", qty: 1 });
  });

  test("bug fixed: a full bag says so, makes nothing and keeps the raw stack", () => {
    const i = inv(fullBag(["Trout", 2]));
    const r = finishCraft(i, { kind: "Cook", raw: "Trout" }, 1, rngByN());
    expect(r).toEqual({ reached: true, lines: [CRAFT_TEXT.crowded], added: null, gain: false });
    expect(i.bag[0]).toEqual({ item: "Trout", qty: 2 });
    // A last Trout frees its own slot, so the fillet fits.
    const one = inv(fullBag(["Trout", 1]));
    expect(finishCraft(one, { kind: "Cook", raw: "Trout" }, 1, rngByN()).added?.kind).toBe("bag");
    expect(one.bag[0]).toEqual({ item: "Trout Fillet", qty: 1 });
  });
});

describe("Mix", () => {
  const job: CraftJob = {
    kind: "Mix",
    bottle: "Potion Bottle",
    crystal: "Red Crystal",
    potion: "Red Potion",
  };

  test("checks the lab, the sand, the crystal; nothing is taken at the start", () => {
    const bag = bagOf(["Potion Bottle", 2], ["Red Crystal", 3]);
    expect(startCraft(view({ bag }), 1).lines).toEqual([CRAFT_TEXT.noLab]);
    const lab = at("Alchemy Lab");
    expect(startCraft(view({ bag, facing: lab }), 1).lines).toEqual([CRAFT_TEXT.noSand]);
    expect(startCraft(view({ bag, facing: lab, rightHand: "Blue Sand" }), 1).lines).toEqual([
      "You need 1 blue crystal to create this potion!",
    ]);
    const r = startCraft(view({ bag, facing: lab, rightHand: "Red Sand" }), 1);
    expect(r.lines).toEqual(["You begin to mix the potion."]);
    expect(r.started?.job).toEqual(job);
    expect(bag[0]).toEqual({ item: "Potion Bottle", qty: 2 });
    expect(bag[1]).toEqual({ item: "Red Crystal", qty: 3 });
  });

  test("kept on purpose: completion takes the bottle and the crystal; the held sand is a tool", () => {
    const i = inv(bagOf(["Potion Bottle", 1], ["Red Crystal", 1]));
    expect(finishCraft(i, job, 0, rngByN())).toMatchObject({
      reached: true,
      lines: ["Your potion is ready!"],
      gain: true,
    });
    expect(i.bag[0]).toEqual({ item: "Red Potion", qty: 1 });
    expect(i.bag[1]).toBeNull();
  });

  test("a failed brew uses up the bottle and the crystal", () => {
    const i = inv(bagOf(["Potion Bottle", 1], ["Red Crystal", 2]));
    const r = finishCraft(i, job, 0, rngByN({ 3: [1] }));
    expect(r).toEqual({ reached: true, lines: [CRAFT_TEXT.potionOff], added: null, gain: false });
    expect(i.bag[0]).toBeNull();
    expect(i.bag[1]).toEqual({ item: "Red Crystal", qty: 1 });
  });

  test("bug fixed: only a real sand mixes; a Catfish Sandwich is refused", () => {
    const bag = bagOf(["Potion Bottle", 1]);
    const v = view({ bag, facing: at("Alchemy Lab"), rightHand: "Catfish Sandwich" });
    expect(startCraft(v, 1)).toEqual({ lines: [CRAFT_TEXT.noSand], started: null });
    expect(bag[0]).toEqual({ item: "Potion Bottle", qty: 1 });
  });
});

describe("Build", () => {
  test("design change: carpentry requires facing a Carpentry Bench before checking the Saw", () => {
    const bag = bagOf(["Logs", 2]);
    for (const facing of [at("Table"), at("Carpentry Bench#1")]) {
      expect(startCraft(view({ bag, facing }), 1)).toEqual({
        lines: [CRAFT_TEXT.noCarpentryBench],
        started: null,
      });
    }
  });

  test("bug fixed: carpentry needs the Saw and Carpentry 1, like cooking's skill rule", () => {
    const facing = at("Carpentry Bench");
    const bag = bagOf(["Logs", 2]);
    expect(startCraft(view({ bag, facing }), 1).lines).toEqual([CRAFT_TEXT.noSaw]);
    expect(startCraft(view({ bag, facing, rightHand: "Saw" }), 1)).toEqual({
      lines: ["You aren't skilled in carpentry, you'd just ruin the logs"],
      started: null,
    });
    const r = startCraft(view({ bag, facing, rightHand: "Saw", skills: { Carpentry: 1 } }), 1);
    expect(r.lines).toEqual(["You begin to build something..."]);
    expect(r.started?.job).toEqual({ kind: "Build", logs: "Logs" });
    expect(bag[0]).toEqual({ item: "Logs", qty: 2 }); // taken at completion
  });

  test("the pick by Carpentry, every band drawing its roll", () => {
    expect(carpentryResult(0, rngByN())).toBe("Chair");
    expect(carpentryResult(20, rngByN())).toBe("Stool");
    expect(carpentryResult(27, rngByN())).toBe("Table");
    expect(carpentryResult(40, rngByN({ 4: [1] }))).toBe("Crate");
    expect(carpentryResult(70, rngByN({ 6: [6] }))).toBe("Cabinet");
    expect(carpentryResult(95, rngByN({ 7: [7] }))).toBe("Wind Cabinet");
    const rng = rngByN();
    carpentryResult(0, rng);
    expect(rng.calls).toEqual([7, 6, 5, 4]);
  });

  test("bug fixed: 'You built a Chair!'; a failure says so and uses the Logs", () => {
    const i = inv(bagOf(["Logs", 2]));
    expect(finishCraft(i, { kind: "Build", logs: "Logs" }, 1, rngByN()).lines).toEqual([
      "You built a Chair!",
    ]);
    expect(i.bag[0]).toEqual({ item: "Logs", qty: 1 });
    expect(i.bag[1]).toEqual({ item: "Chair", qty: 1 });
    const failed = finishCraft(i, { kind: "Build", logs: "Logs" }, 1, rngByN({ 3: [1] }));
    expect(failed.lines).toEqual([CRAFT_TEXT.buildFailed]);
    expect(i.bag[0]).toBeNull();
  });

  test("bug fixed: a full bag keeps the Logs and makes nothing", () => {
    const i = inv(fullBag(["Logs", 2]));
    const r = finishCraft(i, { kind: "Build", logs: "Logs" }, 1, rngByN());
    expect(r.lines).toEqual([CRAFT_TEXT.crowded]);
    expect(i.bag[0]).toEqual({ item: "Logs", qty: 2 });
  });
});

describe("the Cauldron", () => {
  test("a brew needs both ingredients and swaps them for the result", () => {
    expect(cauldronBrew(["Chunk of Star"])).toBeNull();
    expect(cauldronBrew(["Chunk of Star", "Silver Crown"])).toEqual(["Gold Crown"]);
    // The rest of the contents stay.
    expect(cauldronBrew(["Pie", "Silver Crown", "Chunk of Star", "Axe"])).toEqual([
      "Pie",
      "Axe",
      "Gold Crown",
    ]);
  });

  test("bug fixed: ingredients match by exact name; the Magic Shield Book recipe works", () => {
    expect(cauldronBrew(["Gold Axe", "Chunk of Star"])).toBeNull();
    expect(cauldronBrew(["Axe", "Chunk of Star"])).toEqual(["Gold Axe"]);
    expect(cauldronBrew(["White Robe", "Magic Shield Book"])).toEqual(["Wizard's Robe"]);
  });

  test("bug fixed: no recipe brews the artless Magic Shield item", () => {
    expect(cauldronBrew(["Magic Shield Book", "Small Shield"])).toBeNull();
  });
});

describe("craft XP (#37 stage 6)", () => {
  test("the XP comes from the row that made the result: the last matching repair", () => {
    const d = structuredClone(classicData) as ContentData;
    d.craft.stations.smith!.repairs.push(
      { input: "Damaged Sword, Knight", output: "Knight's Sword", xp: 40 },
      { input: "Damaged Sword, Knight", output: "Knight's Sword", xp: 90 },
    );
    installContent(buildContentStore(d));
    try {
      const bag = inv(bagOf(["Damaged Sword, Knight", 1], ["Chunk of Steel", 1]));
      const job: CraftJob = {
        kind: "Smith",
        item: "Damaged Sword, Knight",
        chunk: "Chunk of Steel",
      };
      expect(finishCraft(bag, job, 0, rngByN()).xp).toBe(90);
    } finally {
      installContent(buildContentStore(classicData as ContentData));
    }
  });

  test("Classic's rows give no XP of their own", () => {
    const bag = inv(bagOf(["Damaged Sword, Knight", 1], ["Chunk of Steel", 1]));
    const job: CraftJob = { kind: "Smith", item: "Damaged Sword, Knight", chunk: "Chunk of Steel" };
    expect(finishCraft(bag, job, 0, rngByN()).xp).toBeUndefined();
  });
});
