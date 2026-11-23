import { describe, expect, test } from "bun:test";

import { classicData } from "@secondstaronline/data/classic";

import { buildContentStore, type ContentData, installContent } from "../../src/content/store.ts";
import { SKILL_KEYS, skillIndex } from "../../src/rules/core/fighter.ts";

const { classes: classesData } = classicData;

import { mapName, neighbourMapName, parseMapName } from "../../src/rules/core/maps.ts";
import { paperdollLayers } from "../../src/rules/inventory/paperdoll.ts";
import {
  type CreationChoice,
  creationError,
  HEADS_BY_SEX,
  nameError,
  nextHead,
  prevHead,
  START_CLASSES,
  startingCharacter,
  statsError,
} from "../../src/rules/progression/creation.ts";

const base: CreationChoice = {
  name: "alice",
  sex: 1,
  head: 1,
  classCode: 1,
  str: 11,
  sta: 11,
  int: 11,
  wis: 11,
  dex: 11,
};

describe("name rules", () => {
  test("letters only, any case", () => {
    expect(nameError("alice")).toBeNull();
    expect(nameError("Alice")).toBeNull();
    for (const bad of ["al1ce", "al ice", "al_ice", "al:ice", 'al"ice', "alïce"]) {
      expect(nameError(bad)).toBe("You can ONLY have letters in your user name!");
    }
  });

  test("Admin, Guide and Guardian are refused anywhere in the name", () => {
    for (const bad of ["admin", "superADMIN", "guidebook", "Guardianx"]) {
      expect(nameError(bad)).toContain("reserve for the game staff");
    }
  });

  test("monster names are allowed: the mlists check has an empty body", () => {
    expect(nameError("Slime")).toBeNull();
    expect(nameError("x")).toBeNull();
  });

  test("empty and over-20 names are refused (loops over 20 characters)", () => {
    expect(nameError("")).not.toBeNull();
    expect(nameError("a".repeat(20))).toBeNull();
    expect(nameError("a".repeat(21))).not.toBeNull();
  });
});

describe("stats (the + and − buttons)", () => {
  test("50 points, each of the five stats 1..20", () => {
    expect(statsError({ str: 20, sta: 20, int: 13, wis: 1, dex: 1 })).toBeNull(); // 50 spent
    expect(statsError({ str: 20, sta: 20, int: 14, wis: 1, dex: 1 })).not.toBeNull(); // 51
    expect(statsError({ str: 21, sta: 1, int: 1, wis: 1, dex: 1 })).not.toBeNull();
    expect(statsError({ str: 0, sta: 1, int: 1, wis: 1, dex: 1 })).not.toBeNull();
    expect(statsError({ str: 1, sta: 1, int: 1, wis: 1, dex: 1 })).toBeNull(); // nothing spent
  });
});

describe("heads (the head arrows)", () => {
  test("each sex has its own head cycle; the right arrow steps forward", () => {
    expect(HEADS_BY_SEX).toEqual({ 1: [1, 3, 4, 5, 6, 9, 10], 2: [2, 7, 8, 11] });
    expect(nextHead(1, 10)).toBe(1);
    expect(nextHead(2, 11)).toBe(2);
    expect(nextHead(1, 6)).toBe(9);
  });

  test("bug fixed: the left arrow steps back through the cycle", () => {
    expect(prevHead(1, 1)).toBe(10);
    expect(prevHead(1, 9)).toBe(6);
    expect(prevHead(2, 2)).toBe(11);
    expect(prevHead(2, 8)).toBe(7);
    for (const sex of [1, 2] as const) {
      for (const head of HEADS_BY_SEX[sex]) {
        expect(prevHead(sex, nextHead(sex, head))).toBe(head);
      }
    }
  });

  test("a head from the other sex's cycle is refused", () => {
    expect(creationError({ ...base, sex: 1, head: 2 })).not.toBeNull();
    expect(creationError({ ...base, sex: 2, head: 2 })).toBeNull();
    expect(creationError({ ...base, head: 12 })).not.toBeNull(); // no art past HEAD11
  });
});

describe("starting record", () => {
  test("kept on purpose: vitals are the literal 20/20/20/20 for every class, Fighter included", () => {
    for (const classCode of [1, 2, 3] as const) {
      const c = startingCharacter({ ...base, classCode });
      expect([c.hp, c.hpMax, c.sp, c.spMax, c.exp, c.expNeeded, c.level]).toEqual([
        20, 20, 20, 20, 0, 30, 1,
      ]);
    }
  });

  test("class skills: Fighter Slash/Thrust 20, Ranger Slash 10 Magery 10 Archery 20, Mage Magery 30", () => {
    expect(startingCharacter({ ...base, classCode: 1 }).skills.slice(0, 3)).toEqual([20, 20, 1]);
    const ranger = startingCharacter({ ...base, classCode: 3 }).skills;
    expect([ranger[0], ranger[7], ranger[10]]).toEqual([10, 10, 20]);
    expect(startingCharacter({ ...base, classCode: 2 }).skills[7]).toBe(30);
    expect(startingCharacter(base).skills).toHaveLength(classesData.skills.length);
  });

  test("Classic offers Fighter, Ranger and Mage, in the screen's order", () => {
    expect(START_CLASSES.map((c) => [c.code, c.label])).toEqual([
      [1, "Fighter"],
      [3, "Ranger"],
      [2, "Mage"],
    ]);
  });

  test("the start classes come from content, their skills by key wherever the skills sit", () => {
    const d = structuredClone(classicData) as ContentData;
    // Parry moves to the end, and a fourth class starts with some.
    const parry = d.classes.skills.splice(2, 1)[0];
    d.classes.skills.push(parry as (typeof d.classes.skills)[number]);
    d.classes.startClasses.push({ code: 4, label: "Squire", skills: { Parry: 5, Slash: 7 } });
    installContent(buildContentStore(d));
    try {
      expect(START_CLASSES.map((c) => c.label)).toEqual(["Fighter", "Ranger", "Mage", "Squire"]);
      expect(creationError({ ...base, classCode: 4 })).toBeNull();
      // A class the screen does not offer is refused, even one that exists.
      expect(creationError({ ...base, classCode: 5 })).toBe("Choose a class.");
      const squire = startingCharacter({ ...base, classCode: 4 }).skills;
      expect(SKILL_KEYS.at(-1)).toBe("Parry");
      expect(squire[skillIndex("Parry")]).toBe(5);
      expect(squire[skillIndex("Slash")]).toBe(7);
      expect(squire.filter((v) => v !== 1)).toHaveLength(2);
      // Fighter's Slash and Thrust follow their keys, not their old positions.
      const fighter = startingCharacter({ ...base, classCode: 1 }).skills;
      expect([fighter[skillIndex("Slash")], fighter[skillIndex("Thrust")]]).toEqual([20, 20]);
    } finally {
      installContent(buildContentStore(classicData));
    }
  });

  test("a start class's label defaults to its class's name", () => {
    const d = structuredClone(classicData) as ContentData;
    const fighter = d.classes.classes.find((c) => c.code === 1);
    if (fighter) {
      fighter.name = "Knight";
    }
    installContent(buildContentStore(d));
    try {
      expect(START_CLASSES[0]?.label).toBe("Knight");
    } finally {
      installContent(buildContentStore(classicData));
    }
  });

  test("other fields and the starting bag", () => {
    const c = startingCharacter(base);
    expect(c).toMatchObject({
      gold: 0,
      hunger: 50000,
      breakCount: 100,
      profile: "I have not edited my profile yet",
    });
    expect(c.bag).toEqual([
      { item: "Apple", qty: 2 },
      { item: "Knife", qty: 1 },
    ]);
  });

  test("only the five stats the screen raises are kept", () => {
    expect(startingCharacter(base).stats).toEqual({
      str: base.str,
      sta: base.sta,
      int: base.int,
      wis: base.wis,
      dex: base.dex,
    });
  });
});

describe("map names", () => {
  test("x<MX>y<MY>, negatives allowed, neighbours by ±1", () => {
    expect(parseMapName("x1000y992")).toEqual({ mx: 1000, my: 992 });
    expect(parseMapName("x0y-1")).toEqual({ mx: 0, my: -1 });
    expect(parseMapName("xH11000yH1992")).toBeNull(); // house map: no neighbours
    expect(mapName(3, -4)).toBe("x3y-4");
    expect(neighbourMapName("x1000y992", 1, 0)).toBe("x1001y992");
    expect(neighbourMapName("x1000y992", 0, -1)).toBe("x1000y991");
  });
});

describe("bare paperdoll (the original's character render)", () => {
  test("BIM, then DEFBOD, bare feet, then the head", () => {
    expect(paperdollLayers({ head: 7 }, "F3", "W")).toEqual([
      "BIM",
      "DEFBOD-F3-W",
      "Bare Feet-F3-W",
      "Head7-F3-W",
    ]);
  });
});
