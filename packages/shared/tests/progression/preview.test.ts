/**
 * Issue #38: the Control Panel's previews run the game's own rules. A `chance` preview's chance at
 * each value is the chance `train` raises the skill (its guards and dice, enumerated); an `xp`
 * preview's actions per level are the actions `train` takes; the gathering preview's swings per
 * success are the counter's.
 */
import { describe, expect, test } from "bun:test";

import type { ChanceSettings, ProgressionSource } from "@secondstaronline/data";
import { classicData } from "@secondstaronline/data/classic";

import { buildContentStore, type ContentData, installContent } from "../../src/content/store.ts";
import { NO_FACTION, skillIndex } from "../../src/rules/core/fighter.ts";
import type { Rng } from "../../src/rules/core/lingo.ts";
import {
  chancePreview,
  formulaOutcomes,
  nodeToolTiers,
  type PreviewContext,
  xpPreview,
} from "../../src/rules/progression/preview.ts";
import { sourceSettings, type Trainee, train } from "../../src/rules/progression/progress.ts";

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

const STATS = { level: 1, str: 5, sta: 5, int: 5, wis: 5, dex: 5 };

function trainee(values: Record<string, number>): Trainee {
  const skills = classicData.classes.skills.map(() => 0);
  for (const [k, v] of Object.entries(values)) {
    skills[skillIndex(k)] = v;
  }
  return { ...STATS, skills, skillXp: skills.map(() => 0), faction: NO_FACTION };
}

/**
 * The exact chance `train` raises skill `name` from `v`: every sequence of dice it can draw,
 * weighted by its probability (each `random(n)` answered with every value 1..n in turn).
 */
function trainChance(name: string, source: ProgressionSource, v: number, others = 0): number {
  let total = 0;
  const walk = (prefix: number[], weight: number): void => {
    const bounds: number[] = [];
    let call = 0;
    const rng: Rng = {
      random(n) {
        const i = call++;
        bounds[i] = n;
        return n >= 1 ? (prefix[i] ?? 1) : 0;
      },
    };
    const values: Record<string, number> = { Slash: others, Parry: others, Punch: others };
    values[name] = v;
    const t = trainee(values);
    const rose = train(t, skillIndex(name), source, rng) === 1;
    const i = prefix.length;
    if (i < bounds.length && (bounds[i] ?? 0) >= 1) {
      const n = Math.floor(bounds[i] ?? 1);
      // The last die decides the gain; below it, branch on every value.
      for (let d = 1; d <= n; d++) {
        walk([...prefix, d], weight / n);
      }
      return;
    }
    if (rose) {
      total += weight;
    }
  };
  walk([], 1);
  return total;
}

const ctx = (o: Partial<PreviewContext> = {}): PreviewContext => ({
  stats: STATS,
  tables: classicData.classes.progression.tables,
  otherSkills: 0,
  tier: 0,
  caps: { faction: 50, mage: 30 },
  damage: 0,
  monsterCap: null,
  ...o,
});

describe("a chance preview says what train does", () => {
  test("Thrust's kill roll (skill + 40 - stamina + the Wisdom table, needs Slash over 30)", () => {
    const row = classicData.classes.skills.find((s) => s.skill === "Thrust");
    const s = sourceSettings(classicData.classes.progression, row?.progression, "kill");
    for (const others of [0, 40]) {
      const preview = chancePreview(
        "Thrust",
        "kill",
        s as ChanceSettings,
        ctx({ otherSkills: others }),
      );
      for (const v of [0, 1, 20, 59, 99, 100]) {
        expect(preview[v]?.chance).toBeCloseTo(trainChance("Thrust", "kill", v, others), 10);
      }
      expect(preview[0]?.why).not.toBeNull();
    }
  });

  test("a roll with dice is enumerated: the mean of 1 / roll", () => {
    const roll = [{ op: "set" as const, value: "10 + random(4)" }];
    withContent(
      (d) => {
        const punch = d.classes.skills.find((s) => s.skill === "Punch");
        if (punch) {
          punch.progression = { model: "chance", on: { hit: { roll, cap: 50 } } };
        }
      },
      () => {
        const preview = chancePreview("Punch", "hit", { roll, cap: 50 }, ctx());
        const expected = (1 / 11 + 1 / 12 + 1 / 13 + 1 / 14) / 4;
        for (const v of [1, 30, 49]) {
          expect(preview[v]?.chance).toBeCloseTo(expected, 12);
          expect(trainChance("Punch", "hit", v)).toBeCloseTo(expected, 12);
        }
        // At its cap it never rises, as train says.
        expect(preview[50]?.chance).toBe(0);
        expect(trainChance("Punch", "hit", 50)).toBe(0);
      },
    );
  });

  test("defend rolls first: its guards are tested after", () => {
    const s = sourceSettings(
      classicData.classes.progression,
      undefined,
      "defend",
    ) as ChanceSettings;
    const preview = chancePreview("Parry", "defend", s, ctx());
    for (const v of [0, 1, 50, 100]) {
      expect(preview[v]?.chance).toBeCloseTo(trainChance("Parry", "defend", v), 10);
    }
  });
});

describe("an xp preview's actions are train's", () => {
  test("a table then a formula, at a fixed amount and at a formula's", () => {
    const curve = { counting: "perLevel" as const, table: [0, 30, 45], formula: 100 };
    const xp = [
      { op: "set" as const, value: 7 },
      { op: "add" as const, value: "skill" },
    ];
    withContent(
      (d) => {
        d.classes.progression.curves.test = curve;
        const punch = d.classes.skills.find((s) => s.skill === "Punch");
        if (punch) {
          punch.progression = { model: "xp", curve: "test", on: { hit: { xp } } };
        }
      },
      () => {
        const rows = xpPreview("Punch", curve, 100, { xp }, ctx());
        const t = trainee({ Punch: 1 });
        const i = skillIndex("Punch");
        const rng: Rng = { random: () => 1 };
        for (const level of [1, 2, 3, 4]) {
          let actions = 0;
          while ((t.skills[i] ?? 0) === level) {
            train(t, i, "hit", rng);
            actions += 1;
          }
          // Each level's count, from 0 XP with leftovers carried, as the preview counts it.
          expect(rows[level]?.perAction).toBe(7 + level);
          expect(actions).toBe(rows[level]?.actions ?? -1);
        }
        expect(rows[0]).toMatchObject({ level: 0, total: 0, need: 0 });
        expect(rows[1]).toMatchObject({ total: 0, need: 30, actions: 4 });
      },
    );
  });

  test("a fixed amount's actions per level are exact", () => {
    const curve = {
      counting: "total" as const,
      formula: [
        { op: "set" as const, value: "level" },
        { op: "multiply" as const, value: 100 },
      ],
    };
    withContent(
      (d) => {
        d.classes.progression.curves.test = curve;
        const punch = d.classes.skills.find((s) => s.skill === "Punch");
        if (punch) {
          punch.progression = { model: "xp", curve: "test", on: { hit: { xp: 30 } } };
        }
      },
      () => {
        const rows = xpPreview("Punch", curve, 100, { xp: 30 }, ctx());
        const t = trainee({ Punch: 1 });
        const i = skillIndex("Punch");
        const rng: Rng = { random: () => 1 };
        for (const level of [1, 2, 3, 4, 5]) {
          let actions = 0;
          while ((t.skills[i] ?? 0) === level) {
            train(t, i, "hit", rng);
            actions += 1;
          }
          expect(actions).toBe(rows[level]?.actions ?? -1);
        }
      },
    );
  });
});

describe("formula outcomes", () => {
  test("every die is enumerated with its probability", () => {
    const t = trainee({});
    const out = formulaOutcomes(
      [
        { op: "set", value: "random(2)" },
        { op: "add", value: "random(3)" },
      ],
      { t, skill: 0 },
      { tables: {}, skill: () => 0 },
    );
    const byValue = Object.fromEntries(out.map((o) => [o.value, o.p]));
    expect(byValue[2]).toBeCloseTo(1 / 6);
    expect(byValue[3]).toBeCloseTo(2 / 6);
    expect(byValue[4]).toBeCloseTo(2 / 6);
    expect(byValue[5]).toBeCloseTo(1 / 6);
  });
});

describe("review fixes (issue #38)", () => {
  test("deterministic awards carry their remainder across a level boundary", () => {
    // 75 XP at level 0 and 30 from level 1, 100 a level: two actions reach level 1 with 150,
    // and two more reach level 2 at 210.
    const curve = { counting: "perLevel" as const, formula: 100 };
    const xp = [
      { op: "set" as const, value: 30 },
      { when: ["skill < 1"], op: "set" as const, value: 75 },
    ];
    withContent(
      (d) => {
        d.classes.progression.curves.test = curve;
        const punch = d.classes.skills.find((s) => s.skill === "Punch");
        if (punch) {
          punch.progression = { model: "xp", curve: "test", on: { hit: { xp } } };
        }
      },
      () => {
        const rows = xpPreview("Punch", curve, 100, { xp }, ctx());
        expect(rows.slice(0, 3).map((r) => r.actions)).toEqual([2, 2, 3]);
        const t = trainee({ Punch: 0 });
        const i = skillIndex("Punch");
        const rng: Rng = { random: () => 1 };
        for (const level of [0, 1, 2]) {
          let actions = 0;
          while ((t.skills[i] ?? 0) === level) {
            train(t, i, "hit", rng);
            actions += 1;
          }
          expect(actions).toBe(rows[level]?.actions ?? -1);
        }
        expect(rows[1]?.estimate).toBe(false);
        // Dice make the count an estimate.
        const dice = xpPreview(
          "Punch",
          curve,
          100,
          { xp: [{ op: "set", value: "random(4)" }] },
          ctx(),
        );
        expect(dice[1]?.estimate).toBe(true);
      },
    );
  });

  test("a fixed amount (a node's) gives nothing when the requirement refuses", () => {
    const curve = { counting: "perLevel" as const, formula: 100 };
    const req = { requires: { skill: "Slash", above: 30 } };
    expect(xpPreview("Punch", curve, 100, req, ctx(), 50)[1]?.perAction).toBe(0);
    expect(xpPreview("Punch", curve, 100, req, ctx({ otherSkills: 31 }), 50)[1]?.perAction).toBe(
      50,
    );
    // No settings for the source: the node's amount gives nothing, as trainXp refuses.
    expect(xpPreview("Punch", curve, 100, undefined, ctx(), 50)[1]?.perAction).toBe(0);
  });

  test("a kill's monster cap and a hit's damage are the preview's inputs", () => {
    const s = sourceSettings(classicData.classes.progression, undefined, "kill") as ChanceSettings;
    const capped = chancePreview("Slash", "kill", s, ctx({ monsterCap: 20 }));
    expect(capped[25]?.chance).toBe(0);
    expect(capped[19]?.chance).toBeGreaterThan(0);
    const hit = { roll: [{ op: "set" as const, value: "damage" }], cap: 100 };
    expect(chancePreview("Slash", "hit", hit, ctx({ damage: 8 }))[10]?.chance).toBeCloseTo(1 / 8);
  });

  test("a node's tools: only the exact tools it names, each at its best tier", () => {
    const tools = [
      { match: "contains" as const, pattern: "Hammer", can: "Mine", tier: 1 },
      { match: "exact" as const, pattern: "Gold Hammer", can: "Mine", tier: 3 },
      { match: "exact" as const, pattern: "Ice Hammer", can: "Mine", tier: 2 },
      { match: "contains" as const, pattern: "Axe", can: "Chop", tier: 1 },
    ];
    expect(nodeToolTiers({ can: "Mine", tools: ["Ice Hammer"] }, tools)).toEqual([
      { tool: "Ice Hammer", tier: 2 },
    ]);
    expect(nodeToolTiers({ can: "Mine" }, tools).map((t) => t.tier)).toEqual([1, 3, 2]);
  });

  test("a random award keeps its fractional mean; a hit's XP reads the damage; none at the cap", () => {
    const curve = { counting: "perLevel" as const, formula: 10, cap: 3 };
    const half = xpPreview(
      "Punch",
      curve,
      100,
      {
        xp: [
          { op: "set", value: "random(2)" },
          { op: "subtract", value: 1 },
        ],
      },
      ctx(),
    );
    expect(half[1]).toMatchObject({ perAction: 0.5, estimate: true });
    expect(half[1]?.actions).toBe(20);
    const dmg = xpPreview(
      "Punch",
      curve,
      100,
      { xp: [{ op: "set", value: "damage" }] },
      ctx({ damage: 5 }),
    );
    expect(dmg[1]?.perAction).toBe(5);
    expect(dmg[3]).toMatchObject({ perAction: 0, actions: null });
  });
});
