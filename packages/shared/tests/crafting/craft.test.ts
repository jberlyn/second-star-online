/**
 * Golden tests for the crafting stations and the Cauldron: each test pins one behaviour of 1.6, or
 * one fixed bug from the bug ledger ("bug fixed:").
 */
import { describe, expect, test } from "bun:test";

import type { Rng } from "../../src/rules/core/lingo.ts";
import {
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
    skill: (s) => skills[s] ?? 0,
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

  test("bug fixed: a broken Knight's Sword repairs, under either damaged name", () => {
    expect(repairResult("Damaged Sword, Knight")).toBe("Knight's Sword");
    expect(repairResult("Damaged Sword, Knight's")).toBe("Knight's Sword");
    expect(smithChunk("Damaged Sword, Knight's")).toBe("Chunk of Steel");
    const legacy = inv(bagOf(["Damaged Sword, Knight's", 1], ["Chunk of Steel", 1]));
    const job: CraftJob = {
      kind: "Smith",
      item: "Damaged Sword, Knight's",
      chunk: "Chunk of Steel",
    };
    expect(finishCraft(legacy, job, 0, rngByN()).lines).toEqual(["Your Knight's Sword is ready!"]);
    expect(legacy.bag[0]).toEqual({ item: "Knight's Sword", qty: 1 });
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

  test("bug fixed: a burned meal uses up its raw food, like failed brews and builds", () => {
    const i = inv(bagOf(["Trout", 2]));
    const r = finishCraft(i, { kind: "Cook", raw: "Trout" }, 1, rngByN({ 3: [1] }));
    expect(r).toEqual({ reached: true, lines: [CRAFT_TEXT.burned], added: null, gain: false });
    expect(i.bag[0]).toEqual({ item: "Trout", qty: 1 });
  });

  test("bug fixed: each cook rolls its own burn; Raw Meat cannot be cooked at all", () => {
    // No session food carries over: a failed cook does not make the next one burn.
    const first = inv(bagOf(["Trout", 2]));
    finishCraft(first, { kind: "Cook", raw: "Trout" }, 1, rngByN({ 3: [1] }));
    const next = finishCraft(first, { kind: "Cook", raw: "Trout" }, 1, rngByN());
    expect(next.lines).toEqual(["Your Trout Fillet is ready!"]);
    // Raw Meat has no recipe, so the Cook button refuses it rather than saying "Your  is ready!".
    expect(cookResult("Raw Meat")).toBeNull();
    const v = view({ bag: bagOf(["Raw Meat", 1]), facing: at("Stove"), skills: { Cooking: 1 } });
    expect(startCraft(v, 1)).toEqual({ lines: [CRAFT_TEXT.cantCook], started: null });
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
    crystal: "Red Crystals",
    potion: "Red Potion",
  };

  test("checks the lab, the sand, the crystal; nothing is taken at the start", () => {
    const bag = bagOf(["Potion Bottle", 2], ["Red Crystals", 3]);
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
    expect(bag[1]).toEqual({ item: "Red Crystals", qty: 3 });
  });

  test("completion takes the bottle and the crystal; the held sand is a tool", () => {
    const i = inv(bagOf(["Potion Bottle", 1], ["Red Crystals", 1]));
    expect(finishCraft(i, job, 0, rngByN())).toMatchObject({
      reached: true,
      lines: ["Your potion is ready!"],
      gain: true,
    });
    expect(i.bag[0]).toEqual({ item: "Red Potion", qty: 1 });
    expect(i.bag[1]).toBeNull();
  });

  test("a failed brew uses up the bottle and the crystal", () => {
    const i = inv(bagOf(["Potion Bottle", 1], ["Red Crystals", 2]));
    const r = finishCraft(i, job, 0, rngByN({ 3: [1] }));
    expect(r).toEqual({ reached: true, lines: [CRAFT_TEXT.potionOff], added: null, gain: false });
    expect(i.bag[0]).toBeNull();
    expect(i.bag[1]).toEqual({ item: "Red Crystals", qty: 1 });
  });

  test("bug fixed: only a real sand mixes; a Catfish Sandwich is refused", () => {
    const bag = bagOf(["Potion Bottle", 1]);
    const v = view({ bag, facing: at("Alchemy Lab"), rightHand: "Catfish Sandwich" });
    expect(startCraft(v, 1)).toEqual({ lines: [CRAFT_TEXT.noSand], started: null });
    expect(bag[0]).toEqual({ item: "Potion Bottle", qty: 1 });
  });
});

describe("Build", () => {
  test("bug fixed: carpentry needs the Saw and Carpentry 1, like cooking's skill rule", () => {
    expect(startCraft(view({ bag: bagOf(["Logs", 2]) }), 1).lines).toEqual([CRAFT_TEXT.noSaw]);
    const bag = bagOf(["Logs", 2]);
    expect(startCraft(view({ bag, rightHand: "Saw" }), 1)).toEqual({
      lines: ["You aren't skilled in carpentry, you'd just ruin the logs"],
      started: null,
    });
    const r = startCraft(view({ bag, rightHand: "Saw", skills: { Carpentry: 1 } }), 1);
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

  test("bug fixed: ingredients match by exact name; the Magic Shield Book recipes work", () => {
    expect(cauldronBrew(["Gold Axe", "Chunk of Star"])).toBeNull();
    expect(cauldronBrew(["Axe", "Chunk of Star"])).toEqual(["Gold Axe"]);
    expect(cauldronBrew(["Magic Shield Book", "Small Shield"])).toEqual(["Magic Shield"]);
    expect(cauldronBrew(["White Robe", "Magic Shield Book"])).toEqual(["Wizard's Robe"]);
  });
});
