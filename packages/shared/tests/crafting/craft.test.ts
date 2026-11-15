/**
 * Golden tests for the crafting stations and the Cauldron: each test pins one behaviour of 1.6.
 */
import { describe, expect, test } from "bun:test";

import type { Rng } from "../../src/rules/core/lingo.ts";
import {
  buildDone,
  CRAFT_ORDER,
  CRAFT_TEXT,
  type CraftView,
  carpentryResult,
  cauldronBrew,
  cookDone,
  craftKind,
  craftTimer,
  failurePool,
  masterwork,
  masterworkPool,
  mixDone,
  rollFailure,
  smithChunk,
  snx38,
  startCraft,
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
    lastFood: null,
    lastPotion: null,
    ...over,
  };
}

const at =
  (...stations: string[]) =>
  (s: string) =>
    stations.includes(s);

describe("timers and the failure table", () => {
  test("kept bug: Blacksmithing 11-20 is slower than 10 and below", () => {
    expect(craftTimer("Smith", 10)).toBe(300);
    expect(craftTimer("Smith", 11)).toBe(460);
    expect(craftTimer("Smith", 21)).toBe(400);
    expect(craftTimer("Smith", 99)).toBe(12);
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

  test("kept bug: crafting skill exactly 10 never fails, and draws nothing", () => {
    expect(failurePool(0)).toBe(3);
    expect(failurePool(9)).toBe(3);
    expect(failurePool(10)).toBeNull();
    expect(failurePool(11)).toBe(5);
    expect(failurePool(41)).toBe(9);
    expect(failurePool(95)).toBe(100);
    const rng = rngByN({ 3: [1] });
    expect(rollFailure(10, rng)).toBe(false);
    expect(rng.calls).toEqual([]);
    expect(rollFailure(0, rng)).toBe(true);
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
    const full = bagOf(...Array.from({ length: 15 }, (_, i): [string, number] => [`X${i}`, 1]));
    full[0] = { item, qty: 1 };
    expect(startCraft(view({ bag: full }), 1, rngByN()).lines).toEqual([CRAFT_TEXT.noAnvil]);
    const anvil = at("Anvil");
    expect(startCraft(view({ bag: full, facing: anvil }), 1, rngByN()).lines).toEqual([
      "Your inventory is too crowded!",
    ]);
    const bag = bagOf([item, 1]);
    expect(startCraft(view({ bag, facing: anvil }), 1, rngByN()).lines).toEqual([
      "You need to equip a blacksmith tool to repair this!",
    ]);
    const hammer = { bag, facing: anvil, leftHand: "Blacksmith Hammer" };
    expect(startCraft(view(hammer), 1, rngByN()).lines).toEqual([
      "You need a Chunk of Steel to repair this!",
    ]);
    bag[1] = { item: "Chunk of Steel", qty: 1 };
    const r = startCraft(view(hammer), 1, rngByN());
    expect(r.lines).toEqual(["You begin to smith the Damaged Helm, Demon..."]);
    expect(r.started?.job).toEqual({ kind: "Smith", item, chunk: "Chunk of Steel" });
    // Nothing is taken at the start (the scratch value is built and discarded).
    expect(bag[0]).toEqual({ item, qty: 1 });
    expect(bag[1]).toEqual({ item: "Chunk of Steel", qty: 1 });
  });

  test("Iron by default; 20 named rows", () => {
    expect(smithChunk("Damaged Sword, Long")).toBe("Chunk of Iron");
    expect(smithChunk("Damaged Armor, Lord's")).toBe("Chunk of Star");
    expect(smithChunk("Damaged Sword, Fire")).toBe("Chunk of Fire");
  });

  test("a lock or Ctrl's pause stops every button silently", () => {
    const bag = bagOf([item, 1]);
    expect(startCraft(view({ bag, keyLock: true }), 1, rngByN())).toEqual({
      lines: [],
      started: null,
    });
    expect(startCraft(view({ bag, itemPause: 5 }), 1, rngByN()).lines).toEqual([]);
  });

  test("the masterwork pool and table", () => {
    expect(masterworkPool(50)).toBe(250);
    expect(masterworkPool(51)).toBe(100);
    expect(masterworkPool(99)).toBe(35);
    expect(masterwork("Knight's Sword", 4)).toBe("Knight's Sword +4");
    expect(masterwork("Long Sword", 1)).toBe("Long Sword"); // no row: no +N
  });

  test("kept bug: Chain Helm and Steel Shield give +1 on two rolls", () => {
    expect(masterwork("Chain Helm", 1)).toBe("Chain Helm +1");
    expect(masterwork("Chain Helm", 2)).toBe("Chain Helm +1");
    expect(masterwork("Steel Shield", 2)).toBe("Steel Shield +1");
  });

  test("snx38 S: one of each taken, the server's skill rolls the pool", () => {
    const inv = { bag: bagOf([item, 1], ["Chunk of Steel", 2]), gold: 0 };
    const r = snx38(inv, item, "Chunk of Steel", "S", 0, rngByN());
    expect(r).toMatchObject({ reached: true, line: "Your Demon Helm is ready!" });
    expect(inv.bag[0]).toEqual({ item: "Demon Helm", qty: 1 });
    expect(inv.bag[1]).toEqual({ item: "Chunk of Steel", qty: 1 });
    const knight = { bag: bagOf(["Damaged Sword, Knight", 1], ["Chunk of Steel", 1]), gold: 0 };
    const k = snx38(
      knight,
      "Damaged Sword, Knight",
      "Chunk of Steel",
      "S",
      99,
      rngByN({ 35: [3] }),
    );
    expect(k.line).toBe("Your Knight's Sword +3 is ready!");
  });

  test("divergence: a chunk gone at completion repairs nothing", () => {
    const inv = { bag: bagOf([item, 3]), gold: 0 };
    const r = snx38(inv, item, "Chunk of Steel", "S", 0, rngByN());
    expect(r.reached).toBe(false);
    expect(inv.bag[0]).toEqual({ item, qty: 3 });
  });

  test("a damaged name with no repair keeps its inputs, says 'Your  is ready!'", () => {
    const inv = { bag: bagOf(["Damaged Sword, Knight's", 1], ["Chunk of Iron", 1]), gold: 0 };
    const r = snx38(inv, "Damaged Sword, Knight's", "Chunk of Iron", "S", 0, rngByN());
    expect(r).toMatchObject({ reached: true, added: null, line: "Your  is ready!" });
    expect(inv.bag[0]).toEqual({ item: "Damaged Sword, Knight's", qty: 1 });
  });
});

describe("Cook", () => {
  test("checks the stove before the skill; no full stop on 'burn it'", () => {
    const bag = bagOf(["Trout", 1]);
    expect(startCraft(view({ bag }), 1, rngByN()).lines).toEqual([CRAFT_TEXT.noStove]);
    expect(startCraft(view({ bag, facing: at("Stove") }), 1, rngByN()).lines).toEqual([
      "You aren't skilled in cooking, you'd just burn it",
    ]);
    const r = startCraft(view({ bag, facing: at("Stove"), skills: { Cooking: 1 } }), 1, rngByN());
    expect(r.lines).toEqual(["You begin to cook the Trout."]);
    expect(r.started?.frames).toBe(200);
    expect(bag[0]).toEqual({ item: "Trout", qty: 1 }); // nothing taken until snx38
    const fire = startCraft(
      view({ bag, facing: at("Campfire"), skills: { Cooking: 1 } }),
      1,
      rngByN(),
    );
    expect(fire.started?.frames).toBe(400);
  });

  test("the burn that counts is rolled at completion; a burn sends nothing", () => {
    expect(cookDone("Trout", "Trout", null, 1, rngByN({ 3: [1] }))).toMatchObject({
      lines: [CRAFT_TEXT.burned],
      send: null,
      unlock: true,
    });
    expect(cookDone("Trout", "Trout", "Bad Food", 1, rngByN()).send).toMatchObject({
      kind: "snx38",
      item: "Trout",
      which: "C",
    });
  });

  test("kept bug: Raw Meat burns while the session's chosen food is 'Bad Food'", () => {
    const bag = bagOf(["Trout", 1], ["Raw Meat", 1]);
    const v = view({ bag, facing: at("Stove"), skills: { Cooking: 1 } });
    // A Trout click whose own roll fails writes "Bad Food", which a Trout click never resets.
    const first = startCraft(v, 1, rngByN({ 3: [1] }));
    expect(first.started?.lastFood).toBe("Bad Food");
    expect(cookDone("Raw Meat", "Raw Meat", "Bad Food", 1, rngByN()).lines).toEqual([
      CRAFT_TEXT.burned,
    ]);
    // With no earlier cook it is VOID: the Raw Meat is sent, and the server has no recipe.
    expect(cookDone("Raw Meat", "Raw Meat", null, 1, rngByN()).send?.kind).toBe("snx38");
    // A Pig click resets it.
    const pig = startCraft({ ...v, bag: bagOf(["Pig", 1]), lastFood: "Bad Food" }, 1, rngByN());
    expect(pig.started?.lastFood).toBe("Cooked Pig");
  });

  test("kept bug: Yeti Meat cooks into Yeti Meat", () => {
    const inv = { bag: bagOf(["Yeti Meat", 2]), gold: 0 };
    expect(snx38(inv, "Yeti Meat", "", "C", 1, rngByN()).line).toBe("Your Yeti Meat is ready!");
    expect(inv.bag[0]).toEqual({ item: "Yeti Meat", qty: 2 });
  });

  test("kept bug: cooking a Pig can turn a Cooked Pig back into a Pig", () => {
    const inv = { bag: bagOf(["Cooked Pig", 3], ["Pig", 1]), gold: 0 };
    snx38(inv, "Pig", "", "C", 1, rngByN());
    expect(inv.bag[0]).toEqual({ item: "Pig", qty: 2 });
    expect(inv.bag[1]).toEqual({ item: "Pig", qty: 1 });
    expect(inv.bag[2]).toEqual({ item: "Cooked Pig", qty: 1 });
  });

  test("kept bug: a full bag still says 'is ready!' and keeps the raw stack", () => {
    const lines = Array.from({ length: 15 }, (_, i): [string, number] => [`X${i}`, 1]);
    lines[0] = ["Trout", 2];
    const inv = { bag: bagOf(...lines), gold: 0 };
    const r = snx38(inv, "Trout", "", "C", 1, rngByN());
    expect(r).toMatchObject({ reached: true, added: null, line: "Your Trout Fillet is ready!" });
    expect(inv.bag[0]).toEqual({ item: "Trout", qty: 2 });
    // A last Trout frees its own slot, so the fillet fits.
    const one = { bag: bagOf(...lines.map(([n]): [string, number] => [n, 1])), gold: 0 };
    expect(snx38(one, "Trout", "", "C", 1, rngByN()).added?.kind).toBe("bag");
    expect(one.bag[0]).toEqual({ item: "Trout Fillet", qty: 1 });
  });
});

describe("Mix", () => {
  test("checks the lab, the sand, the crystal; takes crystal and bottle at the start", () => {
    const bag = bagOf(["Potion Bottle", 2], ["Red Crystals", 3]);
    expect(startCraft(view({ bag }), 1, rngByN()).lines).toEqual([CRAFT_TEXT.noLab]);
    const lab = at("Alchemy Lab");
    expect(startCraft(view({ bag, facing: lab }), 1, rngByN()).lines).toEqual([CRAFT_TEXT.noSand]);
    expect(
      startCraft(view({ bag, facing: lab, rightHand: "Blue Sand" }), 1, rngByN()).lines,
    ).toEqual(["You need 1 blue crystal to create this potion!"]);
    const r = startCraft(view({ bag, facing: lab, rightHand: "Red Sand" }), 1, rngByN());
    expect(r.lines).toEqual(["You begin to mix the potion."]);
    expect(r.started?.lastPotion).toBe("Red Potion");
    expect(bag[0]).toEqual({ item: "Potion Bottle", qty: 1 });
    expect(bag[1]).toEqual({ item: "Red Crystals", qty: 2 });
  });

  test("kept bug: the sand is never consumed", () => {
    const bag = bagOf(["Potion Bottle", 1], ["Red Crystals", 1]);
    const v = view({ bag, facing: at("Alchemy Lab"), rightHand: "Red Sand" });
    startCraft(v, 1, rngByN());
    expect(v.rightHand).toBe("Red Sand");
    expect(bag.every((l) => l === null)).toBe(true);
  });

  test("completion: the sand picks its potion; 'Your potion is ready!' before the server", () => {
    expect(mixDone("Red Sand", "Bad Potion", 0, rngByN())).toEqual({
      lines: ["Your potion is ready!"],
      send: { kind: "itremovv", item: "Red Potion" },
      unlock: true,
      imp: "Alchemy",
    });
    expect(mixDone("Red Sand", null, 0, rngByN({ 3: [1] })).lines).toEqual([CRAFT_TEXT.potionOff]);
  });

  test("kept bug: sandwich alchemy brews the last potion, or a Bad Potion after a failed start", () => {
    const bag = bagOf(["Potion Bottle", 1]);
    const v = view({ bag, facing: at("Alchemy Lab"), rightHand: "Catfish Sandwich" });
    const r = startCraft({ ...v, lastPotion: "Blue Potion" }, 1, rngByN());
    expect(r.lines).toEqual(["You begin to mix the potion."]); // no crystal
    expect(r.started?.lastPotion).toBe("Blue Potion");
    expect(mixDone("Catfish Sandwich", "Blue Potion", 0, rngByN()).send).toEqual({
      kind: "itremovv",
      item: "Blue Potion",
    });
    expect(mixDone("Catfish Sandwich", "Bad Potion", 0, rngByN()).lines).toEqual([
      CRAFT_TEXT.potionOff,
    ]);
  });

  test("kept bug: sandwich alchemy before any brew prints nothing and keeps the keys locked", () => {
    expect(mixDone("Catfish Sandwich", null, 0, rngByN())).toEqual({
      lines: [],
      send: null,
      unlock: false,
      imp: null,
    });
  });
});

describe("Build", () => {
  test("kept bug: carpentry needs no station and no skill; the Saw before the selection", () => {
    expect(startCraft(view({ bag: bagOf(["Logs", 2]) }), 1, rngByN()).lines).toEqual([
      CRAFT_TEXT.noSaw,
    ]);
    const bag = bagOf(["Logs", 2]);
    const r = startCraft(view({ bag, rightHand: "Saw" }), 1, rngByN());
    expect(r.lines).toEqual(["You begin to build something..."]);
    expect(bag[0]).toEqual({ item: "Logs", qty: 1 });
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

  test("kept bug: 'Your built a Chair!'; a failure says so", () => {
    expect(buildDone(0, rngByN()).lines).toEqual(["Your built a Chair!"]);
    expect(buildDone(0, rngByN({ 3: [1] })).lines).toEqual([CRAFT_TEXT.buildFailed]);
  });
});

describe("the Cauldron", () => {
  test("contains on the whole text, the last recipe wins", () => {
    expect(cauldronBrew(["Chunk of Star"])).toBeNull();
    expect(cauldronBrew(["Chunk of Star", "Silver Crown"])).toBe("Gold Crown");
    expect(cauldronBrew(["Silver Crown", "Chunk of Star", "Axe"])).toBe("Gold Axe");
  });

  test("kept bug: 'Axe' matches Gold Axe; the two 'Magic Shield Spell Book' recipes never fire", () => {
    expect(cauldronBrew(["Gold Axe", "Chunk of Star"])).toBe("Gold Axe");
    expect(cauldronBrew(["Magic Shield Book", "Small Shield"])).toBeNull();
    expect(cauldronBrew(["White Robe", "Magic Shield Book"])).toBeNull();
  });
});
