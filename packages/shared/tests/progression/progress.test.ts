/**
 * Skill progression as content (#37 stage 6): the `chance` model's per-source guards and dice, the
 * world defaults and a skill's overrides, the `xp` model and its curves, and the publish check.
 */
import { describe, expect, test } from "bun:test";

import { classicData } from "@secondstaronline/data/classic";
import { checkProgression } from "@secondstaronline/data/schema";

import { buildContentStore, type ContentData, installContent } from "../../src/content/store.ts";
import { NO_FACTION, skillIndex } from "../../src/rules/core/fighter.ts";
import type { Rng } from "../../src/rules/core/lingo.ts";
import {
  addXp,
  advancedText,
  curveTotals,
  formatXp,
  normaliseXp,
  type Trainee,
  train,
  xpByKey,
  xpShown,
} from "../../src/rules/progression/progress.ts";
import { runBook } from "../../src/rules/spells/spells.ts";

function withContent(change: (d: ContentData) => void, body: () => void): void {
  const d = structuredClone(classicData) as ContentData;
  change(d);
  installContent(buildContentStore(d));
  try {
    body();
  } finally {
    installContent(buildContentStore(classicData as ContentData));
  }
}

/** Records every `random(n)` and answers from `answers`, then `n` (never 1 unless n = 1). */
function rec(answers: number[] = []): Rng & { drawn: number[] } {
  const drawn: number[] = [];
  return {
    drawn,
    random(n) {
      drawn.push(n);
      return answers.shift() ?? n;
    },
  };
}

function trainee(values: Record<string, number> = {}, o: Partial<Trainee> = {}): Trainee {
  const skills = classicData.classes.skills.map(() => 0);
  for (const [k, v] of Object.entries(values)) {
    skills[skillIndex(k)] = v;
  }
  return {
    level: 1,
    str: 5,
    sta: 5,
    int: 5,
    wis: 5,
    dex: 5,
    skills,
    skillXp: skills.map(() => 0),
    faction: NO_FACTION,
    ...o,
  };
}

describe("the chance model's sources keep 1.6's guards and dice", () => {
  test("defend rolls before it tests anything, even at 0 or 100", () => {
    for (const v of [0, 100]) {
      const rng = rec([1]);
      const t = trainee({ Parry: v });
      expect(train(t, skillIndex("Parry"), "defend", rng)).toBe(0);
      expect(rng.drawn).toEqual([v]);
    }
  });

  test("Block needs Parry over 50, tested after the roll", () => {
    const rng = rec([1, 1]);
    expect(train(trainee({ Block: 10, Parry: 50 }), skillIndex("Block"), "defend", rng)).toBe(0);
    expect(train(trainee({ Block: 10, Parry: 51 }), skillIndex("Block"), "defend", rng)).toBe(1);
    expect(rng.drawn).toEqual([10, 10]);
  });

  test("kill tests 0 < skill < cap first, rolls, then the monster's cap", () => {
    const none = rec();
    expect(train(trainee({ Punch: 0 }), skillIndex("Punch"), "kill", none)).toBe(0);
    expect(train(trainee({ Punch: 50 }), skillIndex("Punch"), "kill", none)).toBe(0);
    expect(none.drawn).toEqual([]);
    const rng = rec([1]);
    const t = trainee({ Punch: 20 });
    expect(train(t, skillIndex("Punch"), "kill", rng, { monsterCap: 20 })).toBe(0);
    // Wisdom 5: random(20 + 30).
    expect(rng.drawn).toEqual([50]);
  });

  test("gather and craft roll from 0 and stop at their cap", () => {
    const rng = rec([1]);
    const t = trainee({ Mining: 0 });
    expect(train(t, skillIndex("Mining"), "gather", rng)).toBe(1);
    expect(rng.drawn).toEqual([22]);
    expect(t.skills[skillIndex("Mining")]).toBe(1);
    const capped = rec();
    expect(train(trainee({ Cooking: 100 }), skillIndex("Cooking"), "craft", capped)).toBe(0);
    expect(capped.drawn).toEqual([]);
  });

  test("a skill with no settings for a source rolls nothing", () => {
    const rng = rec();
    // Classic has no `hit` settings, and Mining none for crafting.
    expect(train(trainee({ Mining: 10 }), skillIndex("Mining"), "craft", rng)).toBe(0);
    expect(train(trainee({ Slash: 10 }), skillIndex("Slash"), "hit", rng)).toBe(0);
    expect(rng.drawn).toEqual([]);
  });
});

describe("defaults, overrides and formulas", () => {
  test("a skill's override replaces the default field by field; false turns a source off", () => {
    withContent(
      (d) => {
        const slash = d.classes.skills.find((s) => s.skill === "Slash");
        const punch = d.classes.skills.find((s) => s.skill === "Punch");
        if (slash && punch) {
          slash.progression = { model: "chance", on: { kill: { cap: 10 } } };
          punch.progression = { model: "chance", on: { kill: false } };
        }
      },
      () => {
        // The default roll, the skill's own cap.
        const rng = rec([1]);
        expect(train(trainee({ Slash: 9 }), skillIndex("Slash"), "kill", rng)).toBe(1);
        expect(rng.drawn).toEqual([39]);
        expect(train(trainee({ Slash: 10 }), skillIndex("Slash"), "kill", rec())).toBe(0);
        const off = rec();
        expect(train(trainee({ Punch: 9 }), skillIndex("Punch"), "kill", off)).toBe(0);
        expect(off.drawn).toEqual([]);
      },
    );
  });

  test("formulas read stats, skills, tables, tier and damage, and roll dice only where they apply", () => {
    withContent(
      (d) => {
        const mining = d.classes.skills.find((s) => s.skill === "Mining");
        if (mining) {
          mining.progression = {
            model: "chance",
            on: {
              gather: {
                roll: [
                  { op: "set", value: "dexterity" },
                  { op: "multiply", value: 2 },
                  { op: "add", value: "Slash" },
                  { when: ["tier > 1"], op: "subtract", value: "random(3)" },
                  { when: ["strength > 50"], op: "add", value: "random(9)" },
                ],
                cap: 100,
              },
            },
          };
        }
      },
      () => {
        const rng = rec([2, 1]);
        const t = trainee({ Mining: 5, Slash: 7 }, { dex: 4 });
        // 4 × 2 + 7 − random(3) = 13; Strength 5 rolls no random(9); then random(13) = 1.
        expect(train(t, skillIndex("Mining"), "gather", rng, { tier: 2 })).toBe(1);
        expect(rng.drawn).toEqual([3, 13]);
      },
    );
  });
});

describe("the xp model", () => {
  const xpWorld = (d: ContentData) => {
    d.classes.progression.curves.steady = {
      counting: "perLevel",
      table: [0, 100],
      formula: [
        { op: "set", value: "level" },
        { op: "multiply", value: 10 },
        { op: "add", value: 100 },
      ],
    };
    d.classes.progression.curves.runescape = { counting: "total", table: [0, 83, 174, 276, 388] };
    d.classes.progression.defaults.xp = {
      hit: {
        xp: [
          { op: "set", value: "damage" },
          { op: "multiply", value: 4 },
        ],
      },
      gather: { xp: 25 },
    };
    const mining = d.classes.skills.find((s) => s.skill === "Mining");
    const slash = d.classes.skills.find((s) => s.skill === "Slash");
    if (mining && slash) {
      mining.progression = { model: "xp", curve: "steady" };
      slash.progression = { model: "xp", curve: "runescape", cap: 4 };
    }
  };

  test("curves count per level or as a running total; past the table the formula runs", () => {
    // Leaving 0 takes 0, 1 takes 100, 2 takes 120, 3 takes 130 …
    expect(
      curveTotals({
        counting: "perLevel",
        table: [0, 100],
        formula: [
          { op: "set", value: "level" },
          { op: "multiply", value: 10 },
          { op: "add", value: 100 },
        ],
      }).slice(0, 5),
    ).toEqual([0, 0, 100, 220, 350]);
    const rs = curveTotals({ counting: "total", table: [0, 83, 174], cap: 3 });
    expect(rs.slice(0, 5)).toEqual([0, 0, 83, 174, Infinity]);
  });

  test("an action gives XP and the level follows; a node's own XP replaces the skill's", () => {
    withContent(xpWorld, () => {
      const t = trainee({ Mining: 1 });
      const i = skillIndex("Mining");
      expect(train(t, i, "gather", rec())).toBe(0);
      expect(t.skillXp?.[i]).toBe(25);
      // 230 XP more reaches 255: past 100 (level 2) and 220 (level 3).
      expect(train(t, i, "gather", rec(), { xp: 230 })).toBe(2);
      expect(t.skills[i]).toBe(3);
      expect(xpShown(i, 3, 255)).toEqual({ have: 35, need: 130 });
      expect(xpByKey(t.skills, t.skillXp, NO_FACTION)).toEqual({ Mining: 255, Slash: 0 });
    });
  });

  test("a hit's XP reads its damage; the skill's cap stops it", () => {
    withContent(xpWorld, () => {
      const t = trainee({ Slash: 0 });
      const i = skillIndex("Slash");
      // 50 damage gives 200 XP: past 0 (level 1), 83 (2) and 174 (3).
      expect(train(t, i, "hit", rec(), { damage: 50 })).toBe(3);
      expect(xpShown(i, 3, 200)).toEqual({ have: 200, need: 276 });
      // 200 more passes 276 and 388, but the skill stops at its cap of 4.
      expect(train(t, i, "hit", rec(), { damage: 50 })).toBe(1);
      expect(t.skills[i]).toBe(4);
      expect(xpShown(i, 4, 400)).toEqual({ have: 400, need: null });
      // The XP past the cap's level stays what is sent and saved.
      expect(xpByKey(t.skills, t.skillXp, NO_FACTION)?.Slash).toBe(400);
      expect(train(t, i, "hit", rec(), { damage: 50 })).toBe(0);
    });
  });

  test("XP outside the level's range (a model switch, a curve change) is held inside it", () => {
    withContent(xpWorld, () => {
      const i = skillIndex("Mining");
      // A chance skill at 3 switched to xp: its XP starts at level 3's total.
      const t = trainee({ Mining: 3 });
      expect(xpShown(i, 3, 0)).toEqual({ have: 0, need: 130 });
      expect(addXp(t, i, 1)).toBe(0);
      expect(t.skillXp?.[i]).toBe(221);
      // Far more than the level's range: held below the next level, never raising the skill.
      const skills = t.skills.map((v, k) => (k === i ? 3 : v));
      const held =
        normaliseXp(
          skills,
          skills.map(() => 99_999),
          NO_FACTION,
        )[i] ?? 0;
      expect(held).toBe(349);
      expect(xpShown(i, 3, held)).toEqual({ have: 129, need: 130 });
    });
  });

  test("the line is the world's, with the skill's display name", () => {
    expect(advancedText("MartialArts")).toBe("You have advanced in the art of Martial Arts!");
    withContent(
      (d) => {
        d.classes.progression.line = "{skill} improves!";
      },
      () => expect(advancedText("Punch")).toBe("Punch improves!"),
    );
  });
});

test("XP figures stay short: in full to 99,999, then k and M to three figures", () => {
  expect(formatXp(212)).toBe("212");
  expect(formatXp(99_999)).toBe("99,999");
  expect(formatXp(512_340)).toBe("512k");
  expect(formatXp(13_034_431)).toBe("13.0M");
  expect(formatXp(999_600)).toBe("1.00M");
  expect(formatXp(9_999_000)).toBe("10.0M");
});

describe("the publish check", () => {
  const check = (change: (d: ContentData) => void) => {
    const d = structuredClone(classicData) as ContentData;
    change(d);
    return checkProgression(d.classes.progression, d.classes.skills).map((p) => p.message);
  };

  test("Classic passes", () => {
    expect(check(() => {})).toEqual([]);
  });

  test("unknown names, damage outside a hit, rolls that can never succeed and runaway XP", () => {
    expect(
      check((d) => {
        d.classes.progression.defaults.chance.shot = { roll: [{ op: "set", value: "luck" }] };
        d.classes.progression.defaults.chance.cast = { roll: [{ op: "set", value: "damage" }] };
        d.classes.progression.defaults.chance.craft = { roll: [{ op: "set", value: 0 }] };
        d.classes.progression.defaults.xp.hit = {
          xp: [
            { op: "set", value: "damage" },
            { op: "multiply", value: 999_999 },
          ],
        };
      }),
    ).toEqual([
      "The default shot progression: luck is not a stat, skill, table, level, tier or damage",
      "The default cast progression: only a hit's formula reads damage",
      "can never be 1 or more (at most 0)",
      "can reach 999999000000, over 1000000000",
    ]);
  });

  test("curves must cover their levels with whole, never-falling totals; xp skills name one", () => {
    expect(
      check((d) => {
        d.classes.progression.curves.short = { counting: "perLevel", table: [10, 20] };
        d.classes.progression.curves.falling = { counting: "total", table: [0, 50, 40] };
        d.classes.progression.curves.dice = {
          counting: "perLevel",
          formula: [{ op: "set", value: "random(5)" }],
        };
        const s = d.classes.skills.find((r) => r.skill === "Mining");
        if (s) {
          s.progression = { model: "xp", curve: "missing" };
        }
      }),
    ).toEqual([
      "says nothing for level 2: add table rows or a formula",
      "level 2's total 40 is below level 1's",
      "a curve cannot roll random",
      "missing is not in progression.curves",
    ]);
  });
});

describe("review fixes", () => {
  const world = (d: ContentData) => {
    d.classes.progression.curves.flat = { counting: "perLevel", formula: 100 };
    d.classes.progression.defaults.xp = { cast: { xp: 500 } };
    const wizardry = d.classes.skills.find((s) => s.skill === "Wizardry");
    if (wizardry) {
      wizardry.progression = { model: "xp", curve: "flat" };
    }
  };

  test("a cap a source passes (a spell school's) holds an xp skill too", () => {
    withContent(world, () => {
      const t = trainee({ Wizardry: 18 });
      const i = skillIndex("Wizardry");
      expect(train(t, i, "cast", rec(), { cap: 20 })).toBe(2);
      expect(t.skills[i]).toBe(20);
      expect(train(t, i, "cast", rec(), { cap: 20 })).toBe(0);
    });
  });

  test("no chance skill rises past 100, whatever its cap says", () => {
    const rng = rec([1]);
    expect(
      train(trainee({ MartialArts: 100 }), skillIndex("MartialArts"), "cast", rng, { cap: 120 }),
    ).toBe(0);
    expect(rng.drawn).toEqual([]);
  });

  test("XP is kept as 0 for chance skills and inside the level for xp skills", () => {
    withContent(world, () => {
      const skills = classicData.classes.skills.map(() => 5);
      const xp = classicData.classes.skills.map(() => 580);
      const out = normaliseXp(skills, xp, NO_FACTION);
      // Wizardry on a 100-per-level curve at level 5: 580 is inside 500-599.
      expect(out[skillIndex("Wizardry")]).toBe(580);
      expect(out[skillIndex("Slash")]).toBe(0);
      // Switched to chance and back, it starts at its level's total.
      expect(
        normaliseXp(
          skills,
          out.map((v, i) => (i === skillIndex("Wizardry") ? 0 : v)),
          NO_FACTION,
        )[skillIndex("Wizardry")],
      ).toBe(500);
    });
  });
});

test("the publish check reads names and curves as their own, never Object's", () => {
  const d = structuredClone(classicData) as ContentData;
  d.classes.progression.defaults.chance.shot = { roll: [{ op: "set", value: "constructor" }] };
  const s = d.classes.skills.find((r) => r.skill === "Mining");
  if (s) {
    s.progression = { model: "xp", curve: "toString" };
  }
  expect(checkProgression(d.classes.progression, d.classes.skills).map((p) => p.message)).toEqual([
    "The default shot progression: constructor is not a stat, skill, table, level, tier or damage",
    "toString is not in progression.curves",
  ]);
});

test("a spell school's cap replaces an xp skill's own, as it does a chance skill's", () => {
  withContent(
    (d) => {
      d.classes.progression.curves.flat = { counting: "perLevel", formula: 100 };
      d.classes.progression.defaults.xp = { cast: { xp: 100 } };
      const ma = d.classes.skills.find((s) => s.skill === "MartialArts");
      if (ma) {
        ma.progression = { model: "xp", curve: "flat", cap: "mage" };
      }
    },
    () => {
      // The Mage cap is 30 for no faction; Smoke Bomb's school cap of 100 replaces it.
      const t = trainee({ MartialArts: 30 });
      const i = skillIndex("MartialArts");
      expect(train(t, i, "cast", rec())).toBe(0);
      expect(train(t, i, "cast", rec(), { cap: 100 })).toBe(1);
    },
  );
});

test("a book at the skill's own cap teaches nothing and stays", () => {
  withContent(
    (d) => {
      d.classes.progression.curves.flat = { counting: "perLevel", formula: 100 };
      const slash = d.classes.skills.find((s) => s.skill === "Slash");
      if (slash) {
        slash.progression = { model: "xp", curve: "flat", cap: "faction" };
      }
      const book = d.itemRules.use.skillBooks.find((b) => b.skill === "Slash");
      if (book) {
        book.xp = 500;
      }
    },
    () => {
      // The faction cap is 50 with no faction.
      const t = trainee({ Slash: 50 });
      expect(runBook("Slash Book", t, [], rec()).kind).toBe("none");
      expect(t.skills[skillIndex("Slash")]).toBe(50);
    },
  );
});

test("a book whose formula gives nothing this read keeps the book and says so", () => {
  withContent(
    (d) => {
      const book = d.itemRules.use.skillBooks.find((b) => b.skill === "Slash");
      if (book) {
        // 3 − random(4): 0 or less on a roll of 3 or 4.
        book.points = [
          { op: "set", value: 3 },
          { op: "subtract", value: "random(4)" },
        ];
      }
    },
    () => {
      const t = trainee({ Slash: 10 });
      expect(runBook("Slash Book", t, [], rec([4]))).toEqual({
        kind: "none",
        lines: ["There is nothing more you can learn from this book."],
      });
      expect(t.skills[skillIndex("Slash")]).toBe(10);
      expect(runBook("Slash Book", t, [], rec([1])).kind).toBe("skill");
      expect(t.skills[skillIndex("Slash")]).toBe(12);
    },
  );
});
