/**
 * Classes as a first-class part of the engine (issue #15): inheritance, perks, how skills train in
 * a class, HP and SP per level, paths into a class at a trainer and from the Class window, class
 * requirements, class-only recipes and the Bio's class line. Classic's classes set none of these,
 * so its play is unchanged (the replay and behaviour goldens pin that).
 */
import { afterEach, describe, expect, test } from "bun:test";

import type { ClassRow } from "@secondstaronline/data";

import { buildContentStore, content, installContent } from "../../src/content/store.ts";
import { factionRows } from "../../src/rules/combat/armour.ts";
import { attackPower } from "../../src/rules/combat/attpower.ts";
import {
  type Fighter,
  NO_EQUIPMENT,
  NO_FACTION,
  skillIndex,
} from "../../src/rules/core/fighter.ts";
import type { Rng } from "../../src/rules/core/lingo.ts";
import { requirementMet, requirementText } from "../../src/rules/core/requirements.ts";
import { recipeForClass, stationRows } from "../../src/rules/crafting/recipes.ts";
import { emptyBag } from "../../src/rules/inventory/inventory.ts";
import {
  classPerk,
  classPerkLines,
  classSkillCap,
  classTrainPercent,
  classWindowOn,
  resolvedClass,
  scaledRoll,
  waysInto,
  waysOutOf,
} from "../../src/rules/progression/classes.ts";
import { startingCharacter } from "../../src/rules/progression/creation.ts";
import { train } from "../../src/rules/progression/progress.ts";
import { checkLevelUp } from "../../src/rules/progression/progression.ts";
import {
  CLASS_WINDOW_TEXT,
  PROMOTION_TEXT,
  type PromotionState,
  promoteClass,
  promoteFromWindow,
} from "../../src/rules/progression/promotion.ts";
import { classStatBonus } from "../../src/rules/progression/stats.ts";
import { bioClassLine, bioTitle } from "../../src/rules/social/bios.ts";

const classic = content();
afterEach(() => installContent(classic));

/** Classic with its classes changed by `edit` (and its social data by `social`). */
function withClasses(
  edit: (classes: ClassRow[]) => void,
  social: (s: typeof classic.social) => void = () => {},
): void {
  const classes = structuredClone(classic.classes);
  edit(classes.classes as ClassRow[]);
  const soc = structuredClone(classic.social);
  social(soc);
  installContent(buildContentStore({ ...classic, classes, social: soc }));
}

const row = (classes: ClassRow[], code: number): ClassRow => {
  const r = classes.find((c) => c.code === code);
  if (!r) {
    throw new Error(`no class ${code}`);
  }
  return r;
};

const ones: Rng = { random: (n) => (n >= 1 ? 1 : 0) };
const tops: Rng = { random: (n) => (n >= 1 ? n : 0) };

function fighter(over: Partial<Fighter> = {}): Fighter {
  return {
    level: 1,
    str: 10,
    sta: 10,
    int: 10,
    wis: 10,
    skills: Array<number>(content().classes.skills.length).fill(1),
    equip: { ...NO_EQUIPMENT },
    faction: { ...NO_FACTION },
    attackBonus: 0,
    wanted: false,
    ...over,
  };
}

/** A Fighter's promotion state with every skill 1 but `skills`. */
function state(over: Partial<PromotionState> = {}, skills: Record<string, number> = {}) {
  const values = Array<number>(content().classes.skills.length).fill(1);
  for (const [k, v] of Object.entries(skills)) {
    values[skillIndex(k)] = v;
  }
  return {
    classCode: 1,
    gold: 1000,
    hpMax: 20,
    spMax: 20,
    level: 1,
    skills: values,
    bag: emptyBag(),
    spellbook: [],
    ...over,
  } satisfies PromotionState;
}

describe("Classic sets nothing new", () => {
  test("no class has perks, training, paths, a description or a parent", () => {
    for (const c of classic.classes.classes) {
      expect(c.perks ?? []).toEqual([]);
      expect(c.training).toBeUndefined();
      expect(c.paths ?? []).toEqual([]);
      expect(c.description).toBeUndefined();
      expect(c.inherits).toBeUndefined();
    }
    expect(classWindowOn()).toBe(false);
    expect(classSkillCap(1, 0)).toBeUndefined();
    expect(classTrainPercent(1, 0)).toBe(100);
  });
});

describe("inheritance", () => {
  test("a class starts from the one it inherits and replaces kind by kind, up the chain", () => {
    withClasses((cs) => {
      // Fighter → Grunt (4) → Barbarian (16 in Classic? any code): build a chain 1 ← 4 ← 2.
      Object.assign(row(cs, 1), {
        statBonus: { str: 2, sta: 1 },
        perks: [
          { kind: "melee", value: 2 },
          { kind: "defence", value: 1 },
        ],
        training: { cap: 60, skills: [{ skill: "Slash", cap: 90, percent: 150 }] },
      });
      Object.assign(row(cs, 4), {
        inherits: 1,
        statBonus: { str: 5 },
        perks: [{ kind: "melee", value: 4 }],
      });
      Object.assign(row(cs, 2), { inherits: 4, training: { percent: 50 } });
    });
    expect(classStatBonus(4)).toEqual({ str: 5, sta: 1 });
    expect(classPerk(4, "melee")).toBe(4);
    expect(classPerk(4, "defence")).toBe(1);
    expect(classPerk(2, "melee")).toBe(4);
    const slash = skillIndex("Slash");
    const thrust = skillIndex("Thrust");
    expect(classSkillCap(2, slash)).toBe(90);
    expect(classSkillCap(2, thrust)).toBe(60);
    expect(classTrainPercent(2, slash)).toBe(150);
    expect(classTrainPercent(2, thrust)).toBe(50);
    // A class that inherits nothing has only its own.
    expect(resolvedClass(3).perks).toEqual({});
  });

  test("a loop in the chain stops where it comes round", () => {
    withClasses((cs) => {
      Object.assign(row(cs, 1), { inherits: 2, perks: [{ kind: "melee", value: 1 }] });
      Object.assign(row(cs, 2), { inherits: 1, perks: [{ kind: "spellPower", value: 3 }] });
    });
    expect(classPerk(1, "melee")).toBe(1);
    expect(classPerk(1, "spellPower")).toBe(3);
    expect(classPerk(2, "melee")).toBe(1);
  });
});

describe("perks add to the faction's", () => {
  test("melee attack power and defence", () => {
    const sword = { ...NO_EQUIPMENT, weapon: "Long Sword" };
    const before = attackPower(fighter({ equip: sword, classCode: 1 }), tops).power;
    const hit = factionRows(20, fighter({ classCode: 1 }));
    withClasses((cs) => {
      row(cs, 1).perks = [
        { kind: "melee", value: 3 },
        { kind: "defence", value: 2 },
      ];
    });
    expect(attackPower(fighter({ equip: sword, classCode: 1 }), tops).power).toBe(before + 3);
    expect(factionRows(20, fighter({ classCode: 1 }))).toBe(hit - 2);
    // Another class has none.
    expect(attackPower(fighter({ equip: sword, classCode: 2 }), tops).power).toBe(before);
  });

  test("HP and SP each level replace the Balance page's", () => {
    withClasses((cs) => {
      row(cs, 1).perks = [
        { kind: "hpPerLevel", value: 5 },
        { kind: "spPerLevel", value: 0 },
      ];
    });
    const v = { level: 1, exp: 10_000, expNeeded: 30, hp: 20, hpMax: 20, sp: 20, spMax: 20 };
    const levels = checkLevelUp(v as never, 1);
    expect(levels).toBeGreaterThan(1);
    expect(v.hpMax).toBe(20 + 5 * levels);
    expect(v.spMax).toBe(20);
    const w = { level: 1, exp: 10_000, expNeeded: 30, hp: 20, hpMax: 20, sp: 20, spMax: 20 };
    const n = checkLevelUp(w as never, 2);
    expect(w.hpMax).toBe(20 + n);
  });
});

describe("how skills train in a class", () => {
  const slash = () => skillIndex("Slash");

  test("without a class cap, the faction's (the world default outside one) holds, as in 1.6", () => {
    const f = fighter({ classCode: 1 });
    f.skills[slash()] = 50;
    expect(train(f, slash(), "kill", ones, { monsterCap: 100 })).toBe(0);
  });

  test("a class cap is the ceiling: outside a faction it is not held at 50", () => {
    withClasses((cs) => {
      row(cs, 1).training = { skills: [{ skill: "Slash", cap: 80 }] };
    });
    const f = fighter({ classCode: 1 });
    f.skills[slash()] = 60;
    expect(train(f, slash(), "kill", ones, { monsterCap: 100 })).toBe(1);
    f.skills[slash()] = 80;
    expect(train(f, slash(), "kill", ones, { monsterCap: 100 })).toBe(0);
  });

  test("a faction the character is in can only lower it", () => {
    withClasses((cs) => {
      row(cs, 1).training = { cap: 80 };
    });
    // A Warrior at tier 0 has the skill cap 55.
    const f = fighter({ classCode: 1, faction: { key: "warrior", tier: 0 } });
    f.skills[slash()] = 55;
    expect(train(f, slash(), "kill", ones, { monsterCap: 100 })).toBe(0);
    f.skills[slash()] = 54;
    expect(train(f, slash(), "kill", ones, { monsterCap: 100 })).toBe(1);
  });

  test("speed scales the chance roll; 0 never rises and rolls nothing", () => {
    expect(scaledRoll(30, 100)).toBe(30);
    expect(scaledRoll(30, 200)).toBe(15);
    expect(scaledRoll(30, 50)).toBe(60);
    expect(scaledRoll(1, 300)).toBe(1);
    withClasses((cs) => {
      row(cs, 1).training = { skills: [{ skill: "Slash", percent: 200 }] };
      row(cs, 2).training = { percent: 0 };
    });
    const sizes: number[] = [];
    const spy: Rng = {
      random: (n) => {
        sizes.push(n);
        return 1;
      },
    };
    const f = fighter({ classCode: 1 });
    f.skills[slash()] = 20;
    train(f, slash(), "kill", spy, { monsterCap: 100 });
    const g = fighter({ classCode: 3 });
    g.skills[slash()] = 20;
    train(g, slash(), "kill", spy, { monsterCap: 100 });
    // Twice as fast: half the roll of a class with no speed.
    expect(sizes[0]).toBe(Math.round((sizes[1] ?? 0) / 2));
    const h = fighter({ classCode: 2 });
    h.skills[slash()] = 20;
    sizes.length = 0;
    expect(train(h, slash(), "kill", spy, { monsterCap: 100 })).toBe(0);
    expect(sizes).toEqual([]);
  });
});

describe("paths at a trainer", () => {
  const grunt = (cs: ClassRow[]) => row(cs, 4);

  test("a path's requirements are named when not met; its gold and items are taken", () => {
    withClasses((cs) => {
      grunt(cs).promotion = null;
      grunt(cs).paths = [
        {
          from: [1],
          requires: [
            { needs: "Slash", atLeast: 30 },
            { needs: "level", atLeast: 5 },
          ],
          gold: 100,
          items: [
            { item: "Iron Bar", qty: 2 },
            { item: "Knife", qty: 1, keep: true },
          ],
          grants: {
            skills: [{ skill: "Thrust", to: 15 }],
            items: [{ item: "Apple", qty: 3 }],
            spells: ["Minor Heal"],
            hpMax: 30,
          },
        },
      ];
    });
    const low = promoteClass(state({}, { Slash: 29 }), "Grunt", 50, "Trainer", ones);
    expect(low.texts).toEqual([PROMOTION_TEXT.needMore("Trainer", "Slash 30 and level 5")]);
    const able = { level: 5 };
    // The TRN line's price and the path's gold together.
    expect(
      promoteClass(state({ ...able, gold: 149 }, { Slash: 30 }), "Grunt", 50, "T", ones).texts,
    ).toEqual([PROMOTION_TEXT.noFunds("T")]);
    expect(
      promoteClass(state({ ...able, gold: 150 }, { Slash: 30 }), "Grunt", 50, "T", ones).texts,
    ).toEqual([PROMOTION_TEXT.needItems("T", "2 Iron Bar and Knife")]);
    const bag = emptyBag();
    bag[0] = { item: "Iron Bar", qty: 3 };
    bag[1] = { item: "Knife", qty: 1 };
    const s = state({ ...able, gold: 150, bag, spellbook: ["Bolt"] }, { Slash: 30, Thrust: 20 });
    const r = promoteClass(s, "Grunt", 50, "T", ones);
    expect(r.texts).toEqual(["T: Congratulations, you are now a Grunt!"]);
    expect(r.result).toMatchObject({ classCode: 4, gold: 0, hpMax: 30, spMax: 20 });
    // Thrust was already above 15: it keeps its value.
    expect(r.result?.skills[skillIndex("Thrust")]).toBe(20);
    expect(r.result?.bag?.[0]).toEqual({ item: "Iron Bar", qty: 1 });
    expect(r.result?.bag?.[1]).toEqual({ item: "Knife", qty: 1 });
    expect(r.result?.bag?.some((l) => l?.item === "Apple" && l.qty === 3)).toBe(true);
    expect(r.result?.spells).toEqual(["Minor Heal"]);
    // The state passed in is never changed.
    expect(s.bag[0]).toEqual({ item: "Iron Bar", qty: 3 });
  });

  test("a full bag refuses before anything is taken", () => {
    withClasses((cs) => {
      grunt(cs).promotion = null;
      grunt(cs).paths = [{ from: [1], grants: { items: [{ item: "Apple", qty: 1 }] } }];
    });
    const bag = emptyBag().map((_, i) => ({ item: `Rock${i}`, qty: 1 }));
    const r = promoteClass(state({ bag }), "Grunt", 0, "T", ones);
    expect(r.texts).toEqual([PROMOTION_TEXT.bagFull("T")]);
    expect(r.result).toBeNull();
  });

  test("a path from the window only is not taken at a trainer", () => {
    withClasses((cs) => {
      grunt(cs).promotion = null;
      grunt(cs).paths = [{ from: [1], where: "anywhere" }];
    });
    expect(promoteClass(state(), "Grunt", 0, "T", ones)).toEqual({
      texts: [],
      sound: false,
      result: null,
    });
    expect(promoteFromWindow(state(), 4, ones).result?.classCode).toBe(4);
  });

  test("1.6's promotion and a path both lead in; the first whose requirements hold is taken", () => {
    // A path's missing requirements are named before 1.6's line.
    withClasses((cs) => {
      grunt(cs).paths = [{ from: [1], requires: [{ needs: "Slash", atLeast: 40 }] }];
    });
    expect(promoteClass(state({}, { Slash: 20 }), "Grunt", 0, "T", ones).texts).toEqual([
      PROMOTION_TEXT.needMore("T", "Slash 40"),
    ]);
    withClasses((cs) => {
      grunt(cs).paths = [{ from: [2], requires: [{ needs: "Magery", atLeast: 40 }] }];
    });
    expect(waysInto(4).map((w) => w.legacy)).toEqual([true, false]);
    expect(waysOutOf(2).map((w) => w.to.code)).toContain(4);
    // A Mage with Magery 40 takes the path (no roll: 1.6's grant is the legacy way's).
    const mage = state({ classCode: 2 }, { Magery: 40 });
    const r = promoteClass(mage, "Grunt", 0, "T", tops);
    expect(r.result?.classCode).toBe(4);
    expect(r.result?.skills[skillIndex("Thrust")]).toBe(1);
    // A Fighter still takes 1.6's way, with its roll.
    const fighterR = promoteClass(state({}, { Slash: 30 }), "Grunt", 0, "T", tops);
    expect(fighterR.result?.skills[skillIndex("Thrust")]).toBe(10);
  });
});

describe("the Class window", () => {
  test("any description or path turns it on", () => {
    withClasses((cs) => {
      row(cs, 1).description = "A fighter.";
    });
    expect(classWindowOn()).toBe(true);
  });

  test("only a path the window may take, from your class, every check met", () => {
    withClasses((cs) => {
      row(cs, 4).paths = [
        { from: [1], where: "both", requires: [{ needs: "Slash", atLeast: 30 }], gold: 10 },
      ];
    });
    expect(promoteFromWindow(state(), 5, ones).texts).toEqual([CLASS_WINDOW_TEXT.notHere]);
    expect(promoteFromWindow(state(), 4, ones).texts).toEqual([
      CLASS_WINDOW_TEXT.needMore("Slash 30"),
    ]);
    expect(promoteFromWindow(state({ gold: 5 }, { Slash: 30 }), 4, ones).texts).toEqual([
      CLASS_WINDOW_TEXT.noFunds(10),
    ]);
    const r = promoteFromWindow(state({}, { Slash: 30 }), 4, ones);
    expect(r.texts).toEqual([CLASS_WINDOW_TEXT.congrats("Grunt")]);
    expect(r.result).toMatchObject({ classCode: 4, gold: 990 });
    // 1.6's promotion is never taken from the window.
    withClasses(() => {});
    expect(promoteFromWindow(state({}, { Slash: 30 }), 4, ones).texts).toEqual([
      CLASS_WINDOW_TEXT.notHere,
    ]);
  });

  test("a respec is just a path back", () => {
    withClasses((cs) => {
      row(cs, 1).paths = [{ from: [4], where: "anywhere", gold: 500 }];
    });
    const r = promoteFromWindow(state({ classCode: 4 }), 1, ones);
    expect(r.result).toMatchObject({ classCode: 1, gold: 500 });
  });

  test("what a class gives, in plain words", () => {
    withClasses((cs) => {
      Object.assign(row(cs, 1), {
        statBonus: { dex: 2 },
        perks: [{ kind: "melee", value: 3 }],
        training: { cap: 70, percent: 150, skills: [{ skill: "Slash", cap: 99 }] },
      });
    });
    expect(classPerkLines(1, (i) => content().classes.skills[i]?.skill ?? "")).toEqual([
      "+2 Dexterity",
      "+3 melee attack power",
      "Skills rise to 70 at most",
      "Skills train at 150% speed",
      "Slash rises to 99 at most",
    ]);
  });
});

describe("class requirements", () => {
  test("met by the listed classes only, refused in their names", () => {
    const r = { needs: "class", atLeast: 0, classes: [3, 13] };
    expect(requirementMet(r, { level: 1, skills: [], classCode: 3 })).toBe(true);
    expect(requirementMet(r, { level: 1, skills: [], classCode: 1 })).toBe(false);
    expect(requirementMet(r, { level: 1, skills: [] })).toBe(false);
    expect(requirementText(r, "cast")).toBe(
      `Only a Ranger or ${/^[aeiou]/i.test(content().classes.classes.find((c) => c.code === 13)?.name ?? "") ? "an" : "a"} ${content().classes.classes.find((c) => c.code === 13)?.name} can cast this.`,
    );
  });

  test("a recipe for some classes is left out of the window for the rest", () => {
    const recipe = { classes: [3] } as Parameters<typeof recipeForClass>[0];
    const crafter = { bag: emptyBag(), held: [], skills: [], known: new Set<string>() };
    expect(recipeForClass(recipe, { ...crafter, classCode: 3 })).toBe(true);
    expect(recipeForClass(recipe, { ...crafter, classCode: 1 })).toBe(false);
    expect(recipeForClass({} as typeof recipe, crafter)).toBe(true);
    // No Classic station has class-only recipes: its rows are as before.
    for (const st of classic.craft.recipeStations ?? []) {
      expect(stationRows(st, { ...crafter, classCode: 1 })).toEqual(stationRows(st, crafter));
    }
  });
});

describe("the Bio's class line", () => {
  const skills = () => {
    const s = Array<number>(content().classes.skills.length).fill(1);
    s[skillIndex("Slash")] = 50;
    return s;
  };

  test("1.6: the title from skills, whatever the class", () => {
    expect(bioClassLine(skills(), 2)).toBe("Grunt");
    expect(bioTitle(skills(), 2)).toBe("Grunt");
  });

  test("the operator's choice: the class, or both; a title row may test the class", () => {
    withClasses(
      () => {},
      (soc) => {
        soc.bios.classLine = "both";
        soc.bios.titles.push({ tests: [], classes: [2], title: "Battle Mage" });
      },
    );
    expect(bioClassLine(skills(), 2)).toBe("Mage, Battle Mage");
    expect(bioClassLine(skills(), 1)).toBe("Fighter, Grunt");
    withClasses(
      () => {},
      (soc) => {
        soc.bios.classLine = "class";
      },
    );
    expect(bioClassLine(skills(), 2)).toBe("Mage");
  });
});

describe("a start class's kit", () => {
  test("added after the world's starting bag, as far as the bag goes", () => {
    const classes = structuredClone(classic.classes);
    const ranger = classes.startClasses.find((c) => c.code === 3);
    if (ranger) {
      ranger.kit = [
        { item: "Bow", qty: 1 },
        { item: "Arrows", qty: 20 },
      ];
    }
    installContent(buildContentStore({ ...classic, classes }));
    const choice = { name: "Ann", sex: 1, head: 1, str: 11, sta: 11, int: 11, wis: 11, dex: 11 };
    const world = classic.bindings.start.bag.map((l) => ({ item: l.item, qty: l.qty }));
    expect(startingCharacter({ ...choice, classCode: 3 } as never).bag).toEqual([
      ...world,
      { item: "Bow", qty: 1 },
      { item: "Arrows", qty: 20 },
    ]);
    expect(startingCharacter({ ...choice, classCode: 1 } as never).bag).toEqual(world);
  });
});
