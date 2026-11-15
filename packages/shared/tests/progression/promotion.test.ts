/** Class promotions at a trainer. */
import { describe, expect, test } from "bun:test";

import { classesData } from "@secondstaronline/data";

import { findClass } from "../../src/rules/admin/admin.ts";
import {
  PROMOTION_TEXT,
  type PromotionState,
  parseTrn,
  promoteClass,
} from "../../src/rules/progression/promotion.ts";

const skillIndex = (name: string) => classesData.skills.find((s) => s.skill === name)?.index ?? 0;

/** A character of class `cls` with every skill 1 except `skills`. */
function state(
  cls: string,
  over: Partial<PromotionState> = {},
  skills: Record<string, number> = {},
): PromotionState {
  const values = Array<number>(38).fill(1);
  for (const [k, v] of Object.entries(skills)) {
    values[skillIndex(k) - 1] = v;
  }
  return {
    classCode: findClass(cls)?.code ?? 0,
    gold: 1000,
    hpMax: 20,
    spMax: 20,
    skills: values,
    stats: { str: 10, sta: 10, agi: 1, dex: 10, int: 10, wis: 10, spd: 1 },
    ...over,
  };
}

const NPC = "Fire God";

describe("the checks, in 1.6's order", () => {
  test("learned all: your own class, as typed, with or without a branch", () => {
    const r = promoteClass(state("Mage"), "fire mage", 0, NPC);
    expect(r.result).toBeNull();
    expect(promoteClass(state("Fire Mage"), "fire mage", 0, NPC)).toEqual({
      texts: [`${NPC}: You have learned all there is to the art of the fire mage.`],
      sound: false,
      result: null,
    });
    expect(promoteClass(state("Immortal"), "Immortal", 5, NPC).texts).toEqual([
      PROMOTION_TEXT.learnedAll(NPC, "Immortal"),
    ]);
  });

  test("no branch: nothing, no text, no charge (the if-chain falls through)", () => {
    for (const typed of ["Ninja", "Fire Mge", "Swordsman", "Immortal", ""]) {
      expect(promoteClass(state("Fighter"), typed, 5, NPC)).toEqual({
        texts: [],
        sound: false,
        result: null,
      });
    }
  });

  test("cantDoIt: the current class is not in the list", () => {
    expect(promoteClass(state("Fighter", {}, { Magery: 99 }), "Fire Mage", 100, NPC)).toEqual({
      texts: ["Fire God: It is impossible for a Fighter to learn this."],
      sound: false,
      result: null,
    });
  });

  test("focused: min - 1 refuses, min passes", () => {
    const low = promoteClass(state("Fighter", {}, { Slash: 29 }), "Grunt", 0, "Trainer");
    expect(low.texts).toEqual([
      "Trainer: You are focused properly, but still need more experience as a Fighter.",
    ]);
    expect(low.result).toBeNull();
    expect(
      promoteClass(state("Fighter", {}, { Slash: 30 }), "Grunt", 0, "Trainer").result,
    ).not.toBeNull();
  });

  test("noFunds: price = gold + 1 refuses, price = gold passes", () => {
    const s = state("Fighter", { gold: 100 }, { Slash: 30 });
    expect(promoteClass(s, "Grunt", 101, NPC).texts).toEqual([PROMOTION_TEXT.noFunds(NPC)]);
    expect(promoteClass(s, "Grunt", 101, NPC).result).toBeNull();
    const ok = promoteClass(s, "Grunt", 100, NPC);
    expect(ok.result?.gold).toBe(0);
  });

  test("success: gold - price, the new class, the congratulation, heal2", () => {
    const r = promoteClass(state("Fighter", { gold: 150 }, { Slash: 30 }), "grunt", 100, NPC);
    expect(r.texts).toEqual(["Fire God: Congratulations, you are now a Grunt!"]);
    expect(r.sound).toBe(true);
    expect(r.result).toMatchObject({ classCode: 4, gold: 50, spMax: 20 });
  });

  test("a free line (price 0) trains; a missing price reads as 0", () => {
    expect(
      promoteClass(state("Fighter", { gold: 0 }, { Slash: 30 }), "Grunt", 0, NPC).result?.gold,
    ).toBe(0);
    expect(parseTrn("Bard")).toEqual({ cls: "Bard", price: 0 });
  });
});

describe("the 16 branches against classes.json", () => {
  const table: [string, number, string[], string, number][] = [
    ["Grunt", 4, ["Fighter"], "Slash", 30],
    ["Illusionist", 7, ["Mage"], "Magery", 30],
    ["Wizard", 8, ["Priest"], "Blessing", 30],
    ["Sorcerer", 9, ["Ninja", "Necromancer"], "HPmax", 59],
    ["Paladin", 10, ["Ninja"], "MartialArts", 35],
    ["Druid", 11, ["Illusionist"], "SPmax", 30],
    ["Dragoon", 14, ["Swordsman"], "Swordsmanship", 40],
    ["Priest", 15, ["Mage", "Ranger"], "Magery", 30],
    ["Necromancer", 16, ["Warlock"], "SPmax", 50],
    ["Bard", 19, ["Swordsman", "Priest", "Archer"], "HPmax", 35],
    ["Barbarian", 20, ["Grunt", "Brawler"], "Slash", 60],
    ["Fire Mage", 21, ["Paladin", "Sorcerer", "Death Knight"], "Magery", 70],
    ["Water Mage", 22, ["Paladin", "Sorcerer", "Death Knight"], "Magery", 70],
    ["Wind Mage", 23, ["Paladin", "Sorcerer", "Death Knight"], "Magery", 70],
    ["Earth Mage", 24, ["Paladin", "Sorcerer", "Death Knight"], "Magery", 70],
    ["Archer", 26, ["Ranger"], "HPmax", 40],
  ];
  test("exactly 16 promotions, and the table matches the data", () => {
    expect(table).toHaveLength(16);
    for (const [name, code, from, stat, min] of table) {
      const c = classesData.classes.find((k) => k.name === name);
      expect([name, c?.code, c?.promotion?.from, c?.promotion?.requirement]).toEqual([
        name,
        code,
        from,
        { stat, min },
      ]);
    }
  });

  test.each(table)(
    "%s: every `from` class at the requirement is promoted, one below is not",
    (name, code, from, stat, min) => {
      for (const f of from) {
        const at = (v: number) => {
          const vitals: Partial<PromotionState> = {};
          const skills: Record<string, number> = {};
          if (stat === "HPmax") {
            vitals.hpMax = v;
          } else if (stat === "SPmax") {
            vitals.spMax = v;
          } else {
            skills[stat] = v;
          }
          return state(f, { gold: 10, ...vitals }, skills);
        };
        expect(promoteClass(at(min), name, 10, NPC).result?.classCode).toBe(code);
        expect(promoteClass(at(min - 1), name, 10, NPC).texts[0]).toContain("focused properly");
      }
    },
  );
});

describe("stat changes", () => {
  test("Druid +3 Dex/Wis/Int", () => {
    const r = promoteClass(state("Illusionist", { spMax: 30 }), "Druid", 0, NPC).result;
    expect(r?.stats).toMatchObject({ dex: 13, wis: 13, int: 13, str: 10 });
  });
  test("Bard Wis +1", () => {
    const r = promoteClass(state("Priest", { hpMax: 35 }), "Bard", 0, NPC).result;
    expect(r?.stats.wis).toBe(11);
  });
  test("Barbarian Str +1", () => {
    const r = promoteClass(state("Grunt", {}, { Slash: 60 }), "Barbarian", 0, NPC).result;
    expect(r?.stats.str).toBe(11);
  });
  test("Paladin SPmax raised to 1 when below, left alone at 5", () => {
    expect(
      promoteClass(state("Ninja", { spMax: 0 }, { MartialArts: 35 }), "Paladin", 0, NPC).result
        ?.spMax,
    ).toBe(1);
    expect(
      promoteClass(state("Ninja", { spMax: 5 }, { MartialArts: 35 }), "Paladin", 0, NPC).result
        ?.spMax,
    ).toBe(5);
  });
});

describe("kept bug", () => {
  test("kept bug: Promotion skill grants are undone: no promotion returns a skill", () => {
    const cases: [string, string, Record<string, number>][] = [
      ["Fighter", "Grunt", { Slash: 30 }],
      ["Ranger", "Archer", {}],
      ["Ninja", "Paladin", { MartialArts: 35 }],
      ["Swordsman", "Dragoon", { Swordsmanship: 40 }],
      ["Paladin", "Fire Mage", { Magery: 70 }],
    ];
    for (const [from, to, skills] of cases) {
      const s = state(from, { hpMax: 40 }, skills);
      const r = promoteClass(s, to, 0, NPC);
      expect([to, r.result !== null]).toEqual([to, true]);
      // The result carries no skills at all: the server keeps the live values.
      expect(Object.keys(r.result ?? {}).sort()).toEqual(["classCode", "gold", "spMax", "stats"]);
    }
  });
});

describe("parseTrn", () => {
  test("class and price", () => {
    expect(parseTrn("Fire Mage:10000")).toEqual({ cls: "Fire Mage", price: 10000 });
    expect(parseTrn("Bard:")).toEqual({ cls: "Bard", price: 0 });
    expect(parseTrn("Grunt:x")).toEqual({ cls: "Grunt", price: 0 });
  });
});
