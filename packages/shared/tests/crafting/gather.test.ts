/**
 * Golden tests for the gathering rules: each test pins one behaviour of 1.6, or one fixed 1.6 bug
 * ("bug fixed:").
 */
import { describe, expect, test } from "bun:test";

import { classicData } from "@secondstaronline/data/classic";

import {
  buildContentStore,
  type ContentData,
  content,
  installContent,
} from "../../src/content/store.ts";
import { NO_FACTION, skillIndex } from "../../src/rules/core/fighter.ts";
import type { Rng } from "../../src/rules/core/lingo.ts";
import {
  asksAboutTreasure,
  buildTreasure,
  canPlant,
  castLine,
  FISHING_LAYERS,
  fishCheck,
  fishFor,
  fishingOffset,
  fishingSpot,
  harvestNode,
  hitCounter,
  isFishingWater,
  newGatherCounters,
  nodeTier,
  nodeTool,
  orePool,
  type RegrowthHooks,
  regrowthFrame,
  rollMiningFind,
  rollYield,
  rumourLine,
  seedTile,
  sprinkleOffset,
  TREASURE,
  tierText,
  tileAt,
  toolCan,
  toolUses,
  underOk,
  wateredTile,
  withTile,
  workedNode,
} from "../../src/rules/crafting/gather.ts";
import { train } from "../../src/rules/progression/progress.ts";

/** Skill `skill` at `value`, trained once from `source`: whether it rose. */
function gainAt(skill: string, source: "gather" | "craft", value: number, rng: Rng): boolean {
  const skills = content().classes.skills.map(() => 0);
  skills[skillIndex(skill)] = value;
  const t = { level: 1, str: 1, sta: 1, int: 1, wis: 1, skills, faction: NO_FACTION };
  return train(t, skillIndex(skill), source, rng) === 1;
}

/** A cast of the line and, as the server does next, the Fishing gain (the `gather` source). */
function fish(skill: number, left: number, rng: Rng) {
  const r = castLine(skill, left, rng);
  const gained = r.trains && gainAt("Fishing", "gather", skill, rng);
  return { fish: r.fish, gained, antiMacro: r.antiMacro };
}

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

const row = (codes: string[]) => codes.join(" ");
const grass = Array.from({ length: 12 }, () => row(Array(17).fill("G3")));

describe("tools and counters", () => {
  test('Classic\'s tools: an axe contains "Axe" (Gold Axe too); the rest are exact', () => {
    expect(toolCan("Gold Axe", "Chop")).toEqual({ can: "Chop", tier: 1, counter: "Axe" });
    expect(toolCan("Shovel", "Dig")?.counter).toBe("Shovel");
    expect(toolCan("Golden Shovel", "Dig")).toBeNull();
    expect(toolCan("ice hammer", "Mine")?.counter).toBe("Ice Hammer");
    expect(toolCan("Fire Hammer", "Mine")?.counter).toBe("Fire Hammer");
    expect(toolCan("Watering Bucket", "Water")?.counter).toBe("Watering Bucket");
    expect(toolCan("Fishing Pole", "Fish")?.counter).toBe("Fishing");
    expect(toolUses("Long Sword")).toEqual([]);
  });

  test("Classic's nodes: each hammer works only its own rock; any axe fells a tree", () => {
    const rock = harvestNode("B8");
    const ice = harvestNode("1g");
    const tree = harvestNode("S3");
    expect(rock?.becomes).toBe("O8");
    expect(ice?.becomes).toBe("0Z");
    expect(harvestNode("G1")).toBeNull();
    expect(harvestNode("")).toBeNull();
    if (!rock || !ice || !tree) {
      throw new Error("Classic's nodes are missing");
    }
    expect(nodeTool("Mining Hammer", rock)?.counter).toBe("Mining Hammer");
    expect(nodeTool("Ice Hammer", rock)).toBeNull();
    expect(nodeTool("Mining Hammer", ice)).toBeNull();
    expect(nodeTool("Ice Hammer", ice)?.counter).toBe("Ice Hammer");
    expect(nodeTool("Gold Axe", tree)?.counter).toBe("Axe");
    expect(nodeTool("Shovel", tree)).toBeNull();
    expect(nodeTier(tree)).toBe(1);
    expect(tierText(tree)).toBe("You need a better tool to chop this.");
  });

  test("nodes may share a tile: the first one the swung tool can work decides", () => {
    const d = structuredClone(classicData) as ContentData;
    d.gather.harvest.push({
      tile: "B8",
      can: "Mine",
      tools: ["Ice Hammer"],
      becomes: "0Z",
      skill: "Mining",
      gains: false,
      hitSound: null,
      successSound: null,
    });
    installContent(buildContentStore(d));
    try {
      expect(workedNode("Mining Hammer", "B8")?.node.becomes).toBe("O8");
      expect(workedNode("Ice Hammer", "B8")?.node.becomes).toBe("0Z");
      expect(workedNode("Axe", "B8")).toBeNull();
    } finally {
      installContent(buildContentStore(classicData));
    }
  });

  test("nodes may share a tile over different grounds: the ground test picks among them", () => {
    const d = structuredClone(classicData) as ContentData;
    d.gather.harvest.push({
      tile: "G3",
      can: "Dig",
      tools: ["Shovel"],
      under: ["S1"],
      becomes: "2K",
      skill: "Shoveling",
      gains: false,
      hitSound: null,
      successSound: null,
    });
    installContent(buildContentStore(d));
    try {
      const layer1 = (code: string) => Array.from({ length: 12 }, () => row(Array(17).fill(code)));
      const on = (code: string) =>
        workedNode("Shovel", "G3", (n) => underOk(n, layer1(code), 5, 5))?.node.becomes ?? null;
      expect(on("G1")).toBe("1K");
      expect(on("S1")).toBe("2K");
      expect(on("W1")).toBeNull();
    } finally {
      installContent(buildContentStore(classicData));
    }
  });

  test("bug fixed: every success takes exactly the table's number of hits, the first too", () => {
    const c = newGatherCounters();
    const hits = (skill: number) => {
      let n = 0;
      do {
        n += 1;
      } while (!hitCounter(c, "Axe", skill));
      return n;
    };
    expect(hits(0)).toBe(18); // 18 at skill >= 0
    expect(hits(0)).toBe(18);
    expect(hits(95)).toBe(3); // 3 at skill > 90
    expect(hits(95)).toBe(3);
  });

  test("bug fixed: each hammer keeps its own count", () => {
    const c = newGatherCounters();
    for (let i = 0; i < 17; i++) {
      expect(hitCounter(c, "Mining Hammer", 0)).toBe(false);
    }
    // Switching hammers starts that hammer's own count.
    expect(hitCounter(c, "Ice Hammer", 0)).toBe(false);
    expect(hitCounter(c, "Mining Hammer", 0)).toBe(true);
  });

  test("tiles off the map are EMPTY", () => {
    expect(tileAt(grass, 0, 5)).toBe("");
    expect(tileAt(grass, 5, 13)).toBe("");
    expect(tileAt(grass, 17, 12)).toBe("G3");
    expect(withTile(grass, 18, 1, "P3")).toBeNull();
    expect(tileAt(withTile(grass, 3, 4, "P3") ?? [], 3, 4)).toBe("P3");
  });

  test("bug fixed: the shovel checks the ground under every tile, on every row", () => {
    const layer1 = [
      row([...Array(16).fill("G1"), "H1"]),
      row(["D6", ...Array(16).fill("W1")]),
      ...Array.from({ length: 10 }, () => row([...Array(8).fill("O1"), ...Array(9).fill("N1")])),
    ];
    const dig = harvestNode("G3");
    if (!dig) {
      throw new Error("Classic's dig node is missing");
    }
    expect(underOk(dig, layer1, 5, 1)).toBe(true);
    expect(underOk(dig, layer1, 17, 1)).toBe(true); // H1: no longer joined to row 2
    expect(underOk(dig, layer1, 1, 2)).toBe(false); // D6
    expect(underOk(dig, layer1, 5, 2)).toBe(false); // W1 water
    expect(underOk(dig, layer1, 8, 12)).toBe(true); // O1
    expect(underOk(dig, layer1, 9, 12)).toBe(false); // N1 water
    expect(underOk(dig, layer1, 0, 5)).toBe(false); // off the map
    // A node with no ground test works anywhere.
    const tree = harvestNode("S3");
    expect(tree && underOk(tree, layer1, 1, 2)).toBe(true);
  });
});

describe("drops", () => {
  test("bug fixed: Lumberjacking 0 drops logs like any other skill", () => {
    expect(rollYield("Logs", 0, rngByN({ 3: [1] }))).toBe("Logs");
    expect(rollYield("Logs", 1, rngByN({ 3: [1] }))).toBe("Logs");
    expect(rollYield("Logs", 50, rngByN({ 3: [2] }))).toBeNull();
  });

  test("a yield table the store lacks, or none, drops nothing and draws nothing", () => {
    const rng = rngByN({ 3: [1] });
    expect(rollYield(undefined, 50, rng)).toBeNull();
    expect(rollYield("Nothing Here", 50, rng)).toBeNull();
    expect(rng.calls).toEqual([]);
  });

  test("a find: count, colour, three ore rolls, then random(5)", () => {
    const rng = rngByN({ 2: [2], 28: [8], 5: [1] });
    expect(rollMiningFind(15, rng)).toBe("2 Yellow Crystal");
    // Mining 15: count random(1) then random(2), colour random(30) then random(28) (every true line
    // draws), ore 95/125/225, find random(5).
    expect(rng.calls).toEqual([1, 2, 30, 28, 95, 125, 225, 5]);
  });

  test("bug fixed: ore odds improve as Mining rises, and never get worse at 97", () => {
    expect(orePool(0)).toBe(100);
    expect(orePool(9)).toBe(100);
    expect(orePool(10)).toBe(95);
    expect(orePool(55)).toBe(60);
    expect(orePool(96)).toBe(25);
    expect(orePool(97)).toBe(25);
    expect(orePool(100)).toBe(25);
    for (let s = 1; s <= 100; s++) {
      expect(orePool(s)).toBeLessThanOrEqual(orePool(s - 1));
    }
    // Iron, Steel (+30) and Star (+130) all roll at 97, from 25, 55 and 155.
    const rng = rngByN({ 5: [5, 5, 1] });
    expect(rollMiningFind(97, rng)).toMatch(/ Crystal$/);
    expect(rng.calls.slice(-4)).toEqual([25, 55, 155, 5]);
    expect(rollMiningFind(97, rngByN({ 25: [1], 5: [5, 5, 1] }))).toBe("Chunk of Iron");
  });

  test("Star overrides Steel overrides Iron", () => {
    const rng = rngByN({ 100: [1], 130: [1], 230: [1], 5: [1] });
    expect(rollMiningFind(1, rng)).toBe("Chunk of Star");
    expect(rollMiningFind(1, rngByN({ 100: [1], 130: [1], 5: [1] }))).toBe("Chunk of Steel");
  });

  test("bug fixed: Mining 0 finds crystals, ore and chunks", () => {
    const rng = rngByN({ 100: [1], 5: [1] });
    expect(rollMiningFind(0, rng)).toBe("Chunk of Iron");
    expect(rng.calls).toEqual([100, 130, 230, 5]);
    expect(rollMiningFind(0, rngByN({ 5: [1] }))).toBe("1 Blue Crystal");
    expect(rollYield("Mining", 0, rngByN({ 100: [1], 5: [1] }))).toBe("Chunk of Iron");
    expect(rollYield("Chunk of Ice", 5, rngByN({ 130: [1] }))).toBe("Chunk of Ice");
    expect(rollYield("Chunk of Fire", 5, rngByN({ 130: [1] }))).toBe("Chunk of Fire");
    expect(rollYield("Chunk of Fire", 0, rngByN({ 130: [1] }))).toBe("Chunk of Fire");
  });
});

describe("fishing", () => {
  test("bug fixed: W1, N1, D2 and I2 are water on either layer; the offsets of the cast", () => {
    expect(["W1", "N1", "D2", "I2"].every(isFishingWater)).toBe(true);
    expect(FISHING_LAYERS).toEqual([1, 2]);
    expect(isFishingWater("G1")).toBe(false);
    expect(fishingOffset("E")).toEqual([18, -3]);
    expect(fishingOffset("W")).toEqual([-21, -2]);
    expect(fishingOffset("N")).toEqual([-5, -17]);
    expect(fishingOffset("S")).toEqual([-5, 19]);
  });

  test("one fish per band", () => {
    expect(fishFor(1)).toBe("Raw Fish");
    expect(fishFor(15)).toBe("Trout");
    expect(fishFor(40)).toBe("Catfish");
    expect(fishFor(60)).toBe("Swordfish");
    expect(fishFor(80)).toBe("Squid");
    expect(fishFor(100)).toBe("Squid");
  });

  test("bug fixed: Fishing 0 catches at the lowest skill's odds and can rise", () => {
    expect(fishCheck(0)).toBe(30);
    expect(fishCheck(1)).toBe(30);
    const rng = rngByN({ 30: [1], 16: [1] });
    expect(fish(0, 5, rng)).toEqual({ fish: "Raw Fish", gained: true, antiMacro: 4 });
    expect(rng.calls).toEqual([30, 16]);
  });

  test("bug fixed: only a catch spends the anti-macro counter; the Imp rolls every cast", () => {
    expect(fish(20, 5, rngByN({ 28: [1], 16: [1] }))).toEqual({
      fish: "Trout",
      gained: true,
      antiMacro: 4,
    });
    // No bite: the Imp still rolls while the count lasts, and a skill-up costs nothing.
    const rng = rngByN({ 16: [1] });
    expect(fish(20, 5, rng)).toEqual({ fish: null, gained: true, antiMacro: 5 });
    expect(rng.calls).toEqual([28, 16]); // FishCheck 28 at Fishing 11-20
    // At 0 nothing but the bite roll.
    const spent = rngByN({ 28: [1] });
    expect(fish(20, 0, spent)).toEqual({ fish: null, gained: false, antiMacro: 0 });
    expect(spent.calls).toEqual([28]);
  });

  test("design change: the allowance belongs to a tile; only another tile refills it", () => {
    const here = { mapId: "m", x: 5, y: 6, left: 0 };
    expect(fishingSpot(here, "m", 5, 6)).toBe(here);
    expect(fishingSpot(here, "m", 6, 6)).toEqual({ mapId: "m", x: 6, y: 6, left: 5 });
    expect(fishingSpot(here, "n", 5, 6)).toEqual({ mapId: "n", x: 5, y: 6, left: 5 });
    expect(fishingSpot(undefined, "m", 5, 6)).toEqual({ mapId: "m", x: 5, y: 6, left: 5 });
  });

  test("the last allowance goes to the catch, so no Imp roll follows", () => {
    const rng = rngByN({ 28: [1] });
    expect(fish(20, 1, rng)).toEqual({ fish: "Trout", gained: false, antiMacro: 0 });
    expect(rng.calls).toEqual([28]);
  });
});

describe("farming", () => {
  test("bug fixed: seeds plant only on SL; off the map nothing can be planted", () => {
    expect(seedTile("Seeds")).toBe("UL");
    expect(seedTile("Magic Seeds")).toBe("VL");
    expect(seedTile("Premium Seeds")).toBe("WL");
    expect(seedTile("Flower Seeds")).toBe("AM");
    expect(seedTile("Rose Seeds")).toBe("BM");
    expect(seedTile("Apple")).toBeNull();
    expect(canPlant("SL")).toBe(true);
    expect(canPlant("TL")).toBe(false);
    expect(canPlant("")).toBe(false);
    expect(canPlant("S")).toBe(false);
  });

  test("watering advances a seeded tile; anything else is wasted", () => {
    expect(wateredTile("UL")).toBe("XL");
    expect(wateredTile("BM")).toBe("DM");
    expect(wateredTile("SL")).toBeNull();
  });

  test("the sprinkle is sent on every swing not facing north", () => {
    expect(sprinkleOffset("N")).toBeNull();
    expect(sprinkleOffset("E")).toEqual([10, 25]);
    expect(sprinkleOffset("W")).toEqual([-15, 25]);
    expect(sprinkleOffset("S")).toEqual([-8, 35]);
  });
});

describe("regrowth", () => {
  const hooks = (layer2: string[], ground = false) => {
    const changes: string[] = [];
    let rows = layer2;
    const h: RegrowthHooks = {
      layer2: () => rows,
      hasGround: () => ground,
      setTile: (x, y, code) => {
        rows = withTile(rows, x, y, code) ?? rows;
        changes.push(`${x},${y}:${code}`);
      },
      produce: (x, y, item) => changes.push(`${x},${y}+${item}`),
    };
    return { h, changes };
  };

  test("a roll under 6 checks trees then rock, each sampling its own tile", () => {
    const l2 = withTile(withTile(grass, 3, 4, "P3") ?? [], 7, 8, "O8") ?? [];
    const { h, changes } = hooks(l2);
    const rng = rngByN({ 600: [5], 17: [3, 7, 1, 1], 12: [4, 8, 1, 1] });
    regrowthFrame(h, rng);
    expect(changes).toEqual(["3,4:S3", "7,8:B8"]);
  });

  test("CheckVeg makes at most one change: grown → seeded, seeded → soil", () => {
    const { h, changes } = hooks(withTile(grass, 2, 2, "XL") ?? []);
    // r = 2: trees, rock, ice, fire, holes, veg (all on (2, 2)), DoVeg.
    regrowthFrame(h, rngByN({ 600: [2], 17: Array(7).fill(2), 12: Array(7).fill(2) }));
    expect(changes).toEqual(["2,2:UL"]);
  });

  test("DoVeg leaves the plant grown and skips a tile with a ground item", () => {
    const l2 = withTile(grass, 2, 2, "ZL") ?? [];
    const free = hooks(l2);
    regrowthFrame(free.h, rngByN({ 600: [9], 17: [9, 2], 12: [9, 2] }));
    expect(free.changes).toEqual(["2,2+Watermelon"]);
    const taken = hooks(l2, true);
    regrowthFrame(taken.h, rngByN({ 600: [9], 17: [9, 2], 12: [9, 2] }));
    expect(taken.changes).toEqual([]);
  });

  test("a roll of 30 or more does nothing", () => {
    const rng = rngByN({ 600: [30] });
    const { h, changes } = hooks(grass);
    regrowthFrame(h, rng);
    expect(changes).toEqual([]);
    expect(rng.calls).toEqual([600]);
  });
});

describe("treasure", () => {
  test("BuildTreasureList keeps only its last pass", () => {
    const rng = rngByN({ 29: [...Array(69).fill(1), 14], 2: [...Array(69).fill(1), 2] });
    expect(buildTreasure(["x1y1", "x2y2"], rng)).toEqual({ map: "x2y2", item: "Steel Shield" });
    expect(buildTreasure([], rngByN())).toBeNull();
  });

  test("the original's lists", () => {
    // The 29 items and 21 maps of 1.6 are checked in packages/data/tests/content-baseline.test.ts.
    expect(TREASURE!.items.length).toBeGreaterThan(0);
    expect(TREASURE!.originalMaps.length).toBeGreaterThan(0);
    expect(TREASURE!.chance).toBe(5);
    expect(TREASURE!.text).toBe("*** You uncover some treasure in your digging!");
  });
});

describe("treasure rumours", () => {
  test('bug fixed: the keywords, including a line starting "the treasure"', () => {
    expect(asksAboutTreasure("Treasure please")).toBe(true);
    expect(asksAboutTreasure("heard any treasure lately")).toBe(true);
    expect(asksAboutTreasure("is there treasure anywhere")).toBe(true);
    expect(asksAboutTreasure("any rumors?")).toBe(true);
    expect(asksAboutTreasure("the treasure is mine")).toBe(true);
    expect(asksAboutTreasure("The Treasure please")).toBe(true);
    expect(asksAboutTreasure("the treasury")).toBe(false);
    expect(asksAboutTreasure("treasures")).toBe(false);
  });

  test("the two lines", () => {
    expect(rumourLine("Cril", "Port Town", 1)).toBe(
      'Cril says "Word has it that some treasure was buried near Port Town."',
    );
    expect(rumourLine("Vin", "Port Town", 2)).toBe(
      'Vin says "A man came in here earlier and said he heard some treasure was near Port Town."',
    );
  });
});

describe("skill gain", () => {
  test("the nine handlers' rolls and lines", () => {
    const rolls = Object.fromEntries(
      [
        "Lumberjacking",
        "Shoveling",
        "Farming",
        "Mining",
        "Fishing",
        "Cooking",
        "Blacksmithing",
        "Alchemy",
        "Carpentry",
      ].map((s) => {
        const on = content().classes.skills.find((r) => r.skill === s)?.progression?.on;
        const settings = on?.gather || on?.craft || undefined;
        return [s, settings && "roll" in settings ? settings.roll : undefined];
      }),
    );
    expect(rolls).toEqual({
      Lumberjacking: 12,
      Shoveling: 12,
      Farming: 12,
      Mining: 22,
      Fishing: 16,
      Cooking: 8,
      Blacksmithing: 9,
      Alchemy: 15,
      Carpentry: 9,
    });
  });

  test("bug fixed: a skill at 0 can rise; 100 is the cap", () => {
    for (const [skill, source] of [
      ["Lumberjacking", "gather"],
      ["Blacksmithing", "craft"],
      ["Alchemy", "craft"],
      ["Carpentry", "craft"],
      ["Fishing", "gather"],
    ] as const) {
      expect(gainAt(skill, source, 0, { random: () => 1 })).toBe(true);
    }
    const rng = rngByN({ 12: [1, 1] });
    expect(gainAt("Lumberjacking", "gather", 100, rng)).toBe(false);
    expect(rng.calls).toEqual([]);
    expect(gainAt("Lumberjacking", "gather", 99, rng)).toBe(true);
  });
});
