/** Class promotions at a trainer. */
import { describe, expect, test } from "bun:test";

import { classicData } from "@secondstaronline/data/classic";

const { classes: classesData } = classicData;

import { buildContentStore, content, installContent } from "../../src/content/store.ts";
import { findClass } from "../../src/rules/admin/admin.ts";
import type { Rng } from "../../src/rules/core/lingo.ts";
import {
  PROMOTION_TEXT,
  type PromotionState,
  parseTrn,
  promoteClass,
} from "../../src/rules/progression/promotion.ts";
import { classStatBonus, effectiveStats } from "../../src/rules/progression/stats.ts";

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
    ...over,
  };
}

const NPC = "Fire God";
/** Every roll is its highest: a grant of `random(10)` rolls 10. */
const rng: Rng = { random: (n) => n };

describe("the checks, in 1.6's order", () => {
  test("learned all: your own class, as typed, with or without a branch", () => {
    const r = promoteClass(state("Mage"), "fire mage", 0, NPC, rng);
    expect(r.result).toBeNull();
    expect(promoteClass(state("Fire Mage"), "fire mage", 0, NPC, rng)).toEqual({
      texts: [`${NPC}: You have learned all there is to the art of the fire mage.`],
      sound: false,
      result: null,
    });
    expect(promoteClass(state("Immortal"), "Immortal", 5, NPC, rng).texts).toEqual([
      PROMOTION_TEXT.learnedAll(NPC, "Immortal"),
    ]);
  });

  test("no branch: nothing, no text, no charge (the if-chain falls through)", () => {
    for (const typed of ["Ninja", "Fire Mge", "Swordsman", "Immortal", ""]) {
      expect(promoteClass(state("Fighter"), typed, 5, NPC, rng)).toEqual({
        texts: [],
        sound: false,
        result: null,
      });
    }
  });

  test("cantDoIt: the current class is not in the list", () => {
    expect(promoteClass(state("Fighter", {}, { Magery: 99 }), "Fire Mage", 100, NPC, rng)).toEqual({
      texts: ["Fire God: It is impossible for a Fighter to learn this."],
      sound: false,
      result: null,
    });
  });

  test("focused: min - 1 refuses, min passes", () => {
    const low = promoteClass(state("Fighter", {}, { Slash: 29 }), "Grunt", 0, "Trainer", rng);
    expect(low.texts).toEqual([
      "Trainer: You are focused properly, but still need more experience as a Fighter.",
    ]);
    expect(low.result).toBeNull();
    expect(
      promoteClass(state("Fighter", {}, { Slash: 30 }), "Grunt", 0, "Trainer", rng).result,
    ).not.toBeNull();
  });

  test("a requirement names its skill as every rule does: case and spaces ignored", () => {
    const before = content();
    const classes = structuredClone(before.classes);
    const grunt = classes.classes.find((c) => c.name === "Grunt");
    if (grunt?.promotion?.requirement) {
      grunt.promotion.requirement.stat = "slash";
    }
    try {
      installContent(buildContentStore({ ...before, classes }));
      expect(
        promoteClass(state("Fighter", {}, { Slash: 30 }), "Grunt", 0, "Trainer", rng).result,
      ).not.toBeNull();
    } finally {
      installContent(before);
    }
  });

  test("noFunds: price = gold + 1 refuses, price = gold passes", () => {
    const s = state("Fighter", { gold: 100 }, { Slash: 30 });
    expect(promoteClass(s, "Grunt", 101, NPC, rng).texts).toEqual([PROMOTION_TEXT.noFunds(NPC)]);
    expect(promoteClass(s, "Grunt", 101, NPC, rng).result).toBeNull();
    const ok = promoteClass(s, "Grunt", 100, NPC, rng);
    expect(ok.result?.gold).toBe(0);
  });

  test("success: gold - price, the new class, the congratulation, heal2", () => {
    const r = promoteClass(state("Fighter", { gold: 150 }, { Slash: 30 }), "grunt", 100, NPC, rng);
    expect(r.texts).toEqual(["Fire God: Congratulations, you are now a Grunt!"]);
    expect(r.sound).toBe(true);
    expect(r.result).toMatchObject({ classCode: 4, gold: 50, spMax: 20 });
  });

  test("a free line (price 0) trains; a missing price reads as 0", () => {
    expect(
      promoteClass(state("Fighter", { gold: 0 }, { Slash: 30 }), "Grunt", 0, NPC, rng).result?.gold,
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
        expect(promoteClass(at(min), name, 10, NPC, rng).result?.classCode).toBe(code);
        expect(promoteClass(at(min - 1), name, 10, NPC, rng).texts[0]).toContain(
          "focused properly",
        );
      }
    },
  );
});

describe("class stat points", () => {
  const base = { str: 10, sta: 10, dex: 10, int: 10, wis: 10 };
  const code = (name: string) => findClass(name)?.code ?? 0;
  test("Druid +3 Dex/Wis/Int, Bard +1 Wis, Barbarian +1 Str; other classes none", () => {
    expect(classStatBonus(code("Druid"))).toEqual({ dex: 3, wis: 3, int: 3 });
    expect(classStatBonus(code("Bard"))).toEqual({ wis: 1 });
    expect(classStatBonus(code("Barbarian"))).toEqual({ str: 1 });
    for (const c of classesData.classes) {
      if (!["Druid", "Bard", "Barbarian"].includes(c.name)) {
        expect([c.name, classStatBonus(c.code)]).toEqual([c.name, {}]);
      }
    }
  });
  test("calculated from the current class: a promotion stores no stat points", () => {
    const r = promoteClass(state("Illusionist", { spMax: 30 }), "Druid", 0, NPC, rng).result;
    expect(r && "stats" in r).toBe(false);
    expect(effectiveStats(base, r?.classCode ?? 0, [])).toEqual({
      ...base,
      dex: 13,
      wis: 13,
      int: 13,
    });
    // Leaving the class (an operator's /class) takes its points away.
    expect(effectiveStats(base, code("Illusionist"), [])).toEqual(base);
  });
  test("Paladin SPmax raised to 1 when below, left alone at 5", () => {
    expect(
      promoteClass(state("Ninja", { spMax: 0 }, { MartialArts: 35 }), "Paladin", 0, NPC, rng).result
        ?.spMax,
    ).toBe(1);
    expect(
      promoteClass(state("Ninja", { spMax: 5 }, { MartialArts: 35 }), "Paladin", 0, NPC, rng).result
        ?.spMax,
    ).toBe(5);
  });
});

describe("skill grants", () => {
  test("bug fixed: each promotion raises its skills to a roll of 1-10", () => {
    const cases: [string, string, Record<string, number>, string[]][] = [
      ["Fighter", "Grunt", { Slash: 30 }, ["Thrust"]],
      ["Mage", "Illusionist", { Magery: 30 }, ["Illusion"]],
      ["Priest", "Wizard", { Blessing: 30 }, ["Wizardry"]],
      ["Ninja", "Sorcerer", {}, ["Sorcery"]],
      ["Ninja", "Paladin", { MartialArts: 35 }, ["Fencing", "Magery"]],
      ["Swordsman", "Dragoon", { Swordsmanship: 40 }, ["Block", "Fencing"]],
      ["Mage", "Priest", { Magery: 30 }, ["Blessing"]],
      ["Warlock", "Necromancer", {}, ["BlackArts"]],
      ["Priest", "Bard", {}, ["Musicianship"]],
      ["Grunt", "Barbarian", { Slash: 60 }, ["HammerWielding"]],
      ["Paladin", "Fire Mage", { Magery: 70 }, ["fire"]],
      ["Paladin", "Water Mage", { Magery: 70 }, ["Water"]],
      ["Paladin", "Wind Mage", { Magery: 70 }, ["wind"]],
      ["Paladin", "Earth Mage", { Magery: 70 }, ["Earth"]],
      ["Ranger", "Archer", {}, ["Archery"]],
    ];
    for (const [from, to, skills, granted] of cases) {
      const s = state(from, { hpMax: 60, spMax: 60 }, skills);
      const r = promoteClass(s, to, 0, NPC, rng).result;
      const changed = classesData.skills
        .filter((k) => r?.skills[k.index - 1] !== s.skills[k.index - 1])
        .map((k) => k.skill);
      expect([to, changed.sort()]).toEqual([to, [...granted].sort()]);
      for (const g of granted) {
        expect(r?.skills[skillIndex(g) - 1]).toBe(10);
      }
    }
  });
  test("Druid grants no skill", () => {
    const s = state("Illusionist", { spMax: 30 });
    expect(promoteClass(s, "Druid", 0, NPC, rng).result?.skills).toEqual([...s.skills]);
  });
  test("a grant never lowers a skill already above the roll", () => {
    const low: Rng = { random: () => 3 };
    const s = state("Fighter", {}, { Slash: 30, Thrust: 25 });
    expect(promoteClass(s, "Grunt", 0, NPC, low).result?.skills[skillIndex("Thrust") - 1]).toBe(25);
    const t = state("Fighter", {}, { Slash: 30, Thrust: 1 });
    expect(promoteClass(t, "Grunt", 0, NPC, low).result?.skills[skillIndex("Thrust") - 1]).toBe(3);
  });
  test("a refused promotion rolls nothing", () => {
    const calls: number[] = [];
    const spy: Rng = {
      random: (n) => {
        calls.push(n);
        return n;
      },
    };
    promoteClass(state("Fighter", {}, { Slash: 29 }), "Grunt", 0, NPC, spy);
    expect(calls).toEqual([]);
  });
});

describe("parseTrn", () => {
  test("class and price", () => {
    expect(parseTrn("Fire Mage:10000")).toEqual({ cls: "Fire Mage", price: 10000 });
    expect(parseTrn("Bard:")).toEqual({ cls: "Bard", price: 0 });
    expect(parseTrn("Grunt:x")).toEqual({ cls: "Grunt", price: 0 });
  });
});
