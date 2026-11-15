/**
 * Golden tests for the gathering rules: each test pins one behaviour of 1.6.
 */
import { describe, expect, test } from "bun:test";

import type { Rng } from "../../src/rules/core/lingo.ts";
import {
  asksAboutTreasure,
  buildTreasure,
  canPlant,
  castLine,
  fishFor,
  fishingOffset,
  gatherTool,
  hitCounter,
  isFishingWater,
  newGatherCounters,
  type RegrowthHooks,
  regrowthFrame,
  rollChunk,
  rollLogs,
  rollMiningFind,
  rollSkillGain,
  rumourLine,
  seedTile,
  shovelLayer1Ok,
  skillGainRule,
  sprinkleOffset,
  TREASURE,
  tileAt,
  wateredTile,
  withTile,
} from "../../src/rules/crafting/gather.ts";

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
  test('the axe name contains "Axe" (Gold Axe too); the rest are exact', () => {
    expect(gatherTool("Gold Axe")?.counter).toBe("Chop");
    expect(gatherTool("Shovel")?.counter).toBe("Dig");
    expect(gatherTool("Golden Shovel")).toBeNull();
    expect(gatherTool("ice hammer")?.counter).toBe("Mine");
    expect(gatherTool("Fire Hammer")?.counter).toBe("Mine");
    expect(gatherTool("Watering Bucket")?.counter).toBe("Watering");
    expect(gatherTool("Long Sword")).toBeNull();
  });

  test("kept bug: the first success takes table − 1 hits, later ones the table", () => {
    const c = newGatherCounters();
    const hits = (skill: number) => {
      let n = 0;
      do {
        n += 1;
      } while (!hitCounter(c, "Chop", skill));
      return n;
    };
    expect(hits(0)).toBe(17); // 18 at skill >= 0
    expect(hits(0)).toBe(18);
    // The counter sits at 1: one hit takes it to 0, the next reloads (3 at skill > 90) to 2.
    expect(hits(95)).toBe(3);
    expect(hits(95)).toBe(3);
  });

  test("kept bug: one Mine counter serves all three hammers", () => {
    const c = newGatherCounters();
    for (let i = 0; i < 16; i++) {
      expect(hitCounter(c, gatherTool("Mining Hammer")?.counter ?? "Mine", 0)).toBe(false);
    }
    // The 17th hit, with another hammer, completes the same count.
    expect(hitCounter(c, gatherTool("Ice Hammer")?.counter ?? "Mine", 0)).toBe(true);
  });

  test("tiles off the map are EMPTY", () => {
    expect(tileAt(grass, 0, 5)).toBe("");
    expect(tileAt(grass, 5, 13)).toBe("");
    expect(tileAt(grass, 17, 12)).toBe("G3");
    expect(withTile(grass, 18, 1, "P3")).toBeNull();
    expect(tileAt(withTile(grass, 3, 4, "P3") ?? [], 3, 4)).toBe("P3");
  });

  test("kept bug: the shovel's layer-1 test is real only on row 1, and (17, 1) never digs", () => {
    const layer1 = [row([...Array(16).fill("G1"), "H1"]), row(["D6", ...Array(16).fill("W1")])];
    for (let y = 2; y <= 12; y++) {
      expect(shovelLayer1Ok(layer1, 5, y)).toBe(true); // EMPTY line: contained
    }
    expect(shovelLayer1Ok(layer1, 5, 1)).toBe(true);
    expect(shovelLayer1Ok(layer1, 17, 1)).toBe(false); // "H1#D6"
    expect(shovelLayer1Ok([row(Array(17).fill("W1"))], 5, 1)).toBe(false);
  });
});

describe("drops", () => {
  test("kept bug: Lumberjacking 0 rolls random(3) but never drops logs", () => {
    expect(rollLogs(0, rngByN({ 3: [1] }))).toBeNull();
    expect(rollLogs(1, rngByN({ 3: [1] }))).toBe("Logs");
    expect(rollLogs(50, rngByN({ 3: [2] }))).toBeNull();
  });

  test("a find: count, colour, three ore rolls, then random(5)", () => {
    const rng = rngByN({ 2: [2], 28: [8], 5: [1] });
    expect(rollMiningFind(15, rng)).toBe("2 Yellow Crystals");
    // Mining 15: count random(1) then random(2), colour random(30) then random(28) (every true line
    // draws), ore 25/55/155, find random(5).
    expect(rng.calls).toEqual([1, 2, 30, 28, 25, 55, 155, 5]);
  });

  test("kept bug: ore odds are constant, Star overrides Steel overrides Iron", () => {
    for (const skill of [1, 40, 96]) {
      // At 96 the count's > 70 and > 80 lines draw random(5) first.
      const fives = skill > 70 ? [5, 5, 1] : [1];
      const rng = rngByN({ 25: [1], 55: [1], 155: [1], 5: fives });
      expect(rollMiningFind(skill, rng)).toBe("Chunk of Star");
    }
    expect(rollMiningFind(40, rngByN({ 25: [1], 5: [1] }))).toBe("Chunk of Iron");
  });

  test("kept bug: at Mining 97 and above the unset pool counts as zero, giving Steel 1/30 and Star 1/130 but no Iron", () => {
    const rng = rngByN({ 5: [5, 5, 1] });
    expect(rollMiningFind(97, rng)).toMatch(/ Crystals$/);
    expect(rng.calls).toEqual([
      1, 2, 3, 3, 3, 4, 4, 5, 5, 6, 30, 28, 26, 24, 22, 20, 18, 16, 14, 12, 0, 30, 130, 5,
    ]);
    // The colour's own random(30) comes first, so the 30 queue gives it a value before Steel's.
    expect(rollMiningFind(97, rngByN({ 30: [30, 1], 5: [5, 5, 1] }))).toBe("Chunk of Steel");
    // Star overrides Steel.
    expect(rollMiningFind(97, rngByN({ 30: [30, 1], 130: [1], 5: [5, 5, 1] }))).toBe(
      "Chunk of Star",
    );
  });

  test("Mining 0 rolls the ores and the find but drops nothing", () => {
    const rng = rngByN({ 25: [1], 5: [1] });
    expect(rollMiningFind(0, rng)).toBeNull();
    expect(rng.calls).toEqual([25, 55, 155, 5]);
  });

  test("Ice and Fire Hammers: a chunk on random(130) = 1, with Mining > 0", () => {
    expect(rollChunk("Ice Hammer", 5, rngByN({ 130: [1] }))).toBe("Chunk of Ice");
    expect(rollChunk("Fire Hammer", 5, rngByN({ 130: [1] }))).toBe("Chunk of Fire");
    expect(rollChunk("Fire Hammer", 0, rngByN({ 130: [1] }))).toBeNull();
  });
});

describe("fishing", () => {
  test("only layer-1 W1, N1, D2 and I2 are water; the offsets of the cast", () => {
    expect(["W1", "N1", "D2", "I2"].every(isFishingWater)).toBe(true);
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

  test("kept bug: Fishing 0 never catches nor rises; the unset chance still consumes one draw", () => {
    const rng = rngByN();
    expect(castLine(0, 5, false, rng)).toEqual({ fish: null, gained: false, antiMacro: 5 });
    expect(rng.calls).toEqual([0]);
  });

  test("a catch and a skill-up each spend the anti-macro counter; the Imp rolls every cast", () => {
    expect(castLine(20, 5, false, rngByN({ 28: [1], 16: [1] }))).toEqual({
      fish: "Trout",
      gained: true,
      antiMacro: 3,
    });
    // No bite: the Imp still rolls while the count lasts.
    const rng = rngByN({ 16: [2] });
    expect(castLine(20, 5, false, rng)).toEqual({ fish: null, gained: false, antiMacro: 5 });
    expect(rng.calls).toEqual([28, 16]); // FishCheck 28 at Fishing 11-20
    // At 0 nothing but the bite roll.
    const spent = rngByN({ 28: [1] });
    expect(castLine(20, 0, false, spent)).toEqual({ fish: null, gained: false, antiMacro: 0 });
    expect(spent.calls).toEqual([28]);
  });

  test("the last allowance goes to the catch, so no Imp roll follows", () => {
    const rng = rngByN({ 28: [1] });
    expect(castLine(20, 1, false, rng)).toEqual({ fish: "Trout", gained: false, antiMacro: 0 });
    expect(rng.calls).toEqual([28]);
  });

  test("kept bug: a cast mid-step catches nothing", () => {
    expect(castLine(20, 5, true, rngByN({ 28: [1] })).fish).toBeNull();
  });
});

describe("farming", () => {
  test('seeds plant on SL; the test is `"*SL*" contains`, so off the map passes', () => {
    expect(seedTile("Seeds")).toBe("UL");
    expect(seedTile("Magic Seeds")).toBe("VL");
    expect(seedTile("Premium Seeds")).toBe("WL");
    expect(seedTile("Flower Seeds")).toBe("AM");
    expect(seedTile("Rose Seeds")).toBe("BM");
    expect(seedTile("Apple")).toBeNull();
    expect(canPlant("SL")).toBe(true);
    expect(canPlant("TL")).toBe(false);
    expect(canPlant("")).toBe(true);
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
    regrowthFrame(false, h, rng);
    expect(changes).toEqual(["3,4:S3", "7,8:B8"]);
  });

  test("the checks wait out the post-death respawn timer; DoVeg does not", () => {
    const l2 = withTile(grass, 2, 2, "XL") ?? [];
    const { h, changes } = hooks(l2);
    regrowthFrame(true, h, rngByN({ 600: [1], 17: [2], 12: [2] }));
    expect(changes).toEqual(["2,2+Corn"]);
  });

  test("CheckVeg makes at most one change: grown → seeded, seeded → soil", () => {
    const { h, changes } = hooks(withTile(grass, 2, 2, "XL") ?? []);
    // r = 2: trees, rock, ice, fire, holes, veg (all on (2, 2)), DoVeg.
    regrowthFrame(false, h, rngByN({ 600: [2], 17: Array(7).fill(2), 12: Array(7).fill(2) }));
    expect(changes).toEqual(["2,2:UL"]);
  });

  test("DoVeg leaves the plant grown and skips a tile with a ground item", () => {
    const l2 = withTile(grass, 2, 2, "ZL") ?? [];
    const free = hooks(l2);
    regrowthFrame(false, free.h, rngByN({ 600: [9], 17: [9, 2], 12: [9, 2] }));
    expect(free.changes).toEqual(["2,2+Watermelon"]);
    const taken = hooks(l2, true);
    regrowthFrame(false, taken.h, rngByN({ 600: [9], 17: [9, 2], 12: [9, 2] }));
    expect(taken.changes).toEqual([]);
  });

  test("a roll of 30 or more does nothing", () => {
    const rng = rngByN({ 600: [30] });
    const { h, changes } = hooks(grass);
    regrowthFrame(false, h, rng);
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
    expect(TREASURE.items.length).toBeGreaterThan(0);
    expect(TREASURE.originalMaps.length).toBeGreaterThan(0);
    expect(TREASURE.chance).toBe(5);
    expect(TREASURE.text).toBe("*** You uncover some treasure in your digging!");
  });
});

describe("treasure rumours", () => {
  test('the keywords; kept bug: the first word can never match "the treasure"', () => {
    expect(asksAboutTreasure("Treasure please")).toBe(true);
    expect(asksAboutTreasure("heard any treasure lately")).toBe(true);
    expect(asksAboutTreasure("is there treasure anywhere")).toBe(true);
    expect(asksAboutTreasure("any rumors?")).toBe(true);
    expect(asksAboutTreasure("the treasure is mine")).toBe(false);
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
      ].map((s) => [s, skillGainRule(s)?.chance]),
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
    expect(skillGainRule("Mining")?.text).toBe("You have advanced in the art of Mining!");
  });

  test("kept bug: a skill at 0 never rises, and 100 is the cap", () => {
    const rng = rngByN({ 12: [1, 1, 1] });
    expect(rollSkillGain("Lumberjacking", 0, rng)).toBe(false);
    expect(rollSkillGain("Lumberjacking", 100, rng)).toBe(false);
    expect(rng.calls).toEqual([]);
    expect(rollSkillGain("Lumberjacking", 99, rng)).toBe(true);
  });
});
