/**
 * Issue #42: monster levels and the kill XP and level curve as content (the balance rows `killXp`
 * and `levels`). Classic must play exactly as before, pinned against 1.6's formulas written out
 * here; the other models are checked by what they give.
 */
import { afterEach, describe, expect, test } from "bun:test";

import type { BalanceData, BalanceLevels } from "@secondstaronline/data";
import { classicData } from "@secondstaronline/data/classic";

import { BALANCE_DEFAULTS } from "../../src/content/balance.ts";
import {
  buildContentStore,
  type ContentData,
  content,
  installContent,
} from "../../src/content/store.ts";
import {
  deriveEdit,
  type EditableCharacter,
  editErrors,
} from "../../src/rules/admin/character-edit.ts";
import { NO_EQUIPMENT } from "../../src/rules/core/fighter.ts";
import { withMonsterLevel } from "../../src/rules/inventory/inventory.ts";
import {
  checkLevelUp,
  expShown,
  levelCost,
  levelTotal,
  meleeKillXp,
  shownMonsterLevel,
  speciesKillXp,
  syncLevel,
  type Vitals,
  xpGained,
} from "../../src/rules/progression/progression.ts";

/** 1.6's kill XP, as SSO played it before #42. */
function classicKillXp(base: number, ring: boolean, override: number | null): number {
  let xp = base + (ring ? 5 : 0);
  if (override !== null) {
    xp = override;
  }
  xp += 10;
  for (const t of [100, 150, 200, 250, 300, 350, 400]) {
    if (xp > t) {
      xp += 10;
    }
  }
  return xp;
}

/** 1.6's XP needed at a level, as SSO played it before #42. */
const classicNeed = (level: number) => (level <= 1 ? 30 : level === 2 ? 400 : 400 + 2 * level);

const ringed = { ...NO_EQUIPMENT, ring: "Ring of Experience" };

/** Installs Classic with balance rows and monster changes of the test's own. */
function install(
  balance: Partial<Pick<BalanceData, "killXp" | "levels">>,
  monsters: Record<
    string,
    { level?: number; xpMelee?: number | null; xpSpell?: number | null }
  > = {},
) {
  const d = structuredClone(classicData) as ContentData;
  d.balance = { ...d.balance, ...balance };
  for (const m of d.monsters.monsters) {
    const change = monsters[m.name];
    if (!change) {
      continue;
    }
    if (change.level !== undefined) {
      m.level = change.level;
    }
    for (const k of ["xpMelee", "xpSpell"] as const) {
      if (change[k] === null) {
        delete m[k];
      }
    }
  }
  installContent(buildContentStore(d));
}

const levels = (over: Partial<BalanceLevels>): BalanceLevels => ({
  ...BALANCE_DEFAULTS.levels,
  ...over,
});

const vitals = (over: Partial<Vitals> = {}): Vitals => ({
  level: 1,
  hp: 20,
  hpMax: 20,
  sp: 20,
  spMax: 20,
  exp: 0,
  expNeeded: 30,
  ...over,
});

afterEach(() => installContent(buildContentStore(classicData as ContentData)));

describe("Classic plays 1.6's kill XP and level curve exactly", () => {
  test("kill XP for every base from 0 to 700, with and without the ring, and Cow's override", () => {
    for (let base = 0; base <= 700; base++) {
      expect(meleeKillXp(base, "Slime", NO_EQUIPMENT)).toBe(classicKillXp(base, false, null));
      expect(meleeKillXp(base, "Slime", ringed)).toBe(classicKillXp(base, true, null));
      expect(meleeKillXp(base, "Cow", ringed)).toBe(classicKillXp(base, true, 5));
    }
    for (const level of [0, 1, 5, 30, 200]) {
      expect(xpGained(24, level, 99)).toBe(Math.max(0, 24 - level));
    }
  });

  test("each species' base is its own melee and spell XP; a name with no species gives 30", () => {
    for (const sp of classicData.monsters.monsters) {
      expect(speciesKillXp(sp, "melee")).toBe(sp.xpMelee as number);
      expect(speciesKillXp(sp, "spell")).toBe(sp.xpSpell as number);
    }
    expect(speciesKillXp(undefined, "melee")).toBe(30);
  });

  test("the XP each level takes, levels 1 to 2000: 30, 400, then 400 + 2 × level", () => {
    for (let level = 1; level <= 2000; level++) {
      expect(levelCost(level)).toBe(classicNeed(level));
    }
    expect(levelTotal(1)).toBe(0);
    expect(levelTotal(3)).toBe(430);
    expect(levelTotal(4)).toBe(430 + 406);
  });

  test("a level-up adds 1 HP and SP max; a saved character's figures never change on login", () => {
    const v = vitals({ exp: 46 });
    expect(checkLevelUp(v)).toBe(1);
    expect(v).toMatchObject({ level: 2, exp: 16, expNeeded: 400, hpMax: 21, spMax: 21 });
    for (let level = 1; level <= 300; level++) {
      const saved = vitals({ level, exp: classicNeed(level) - 1, expNeeded: classicNeed(level) });
      const before = { ...saved };
      expect(syncLevel(saved)).toBe(0);
      expect(saved).toEqual(before);
    }
  });

  test("monster levels are hidden, and the XP bar shows XP within the level", () => {
    expect(classicData.monsters.monsters.some((m) => m.level !== undefined)).toBe(false);
    expect(shownMonsterLevel("Slime")).toBeUndefined();
    expect(expShown({ level: 5, exp: 12, expNeeded: 410 })).toEqual({ have: 12, need: 410 });
  });
});

describe("a fixed-XP model with a steep curve (RuneScape-like)", () => {
  test("every kill gives the same XP, whatever the killer's level", () => {
    install({ killXp: { ...BALANCE_DEFAULTS.killXp, adjust: "none", bonus: 0, thresholds: [] } });
    expect(meleeKillXp(14, "Slime", NO_EQUIPMENT)).toBe(14);
    expect(xpGained(14, 1)).toBe(14);
    expect(xpGained(14, 90)).toBe(14);
  });

  test("a compounding curve: each level takes 10% more than the last", () => {
    const l = levels({ firstLevels: [], start: 100, perLevel: 0, growthPercent: 10 });
    expect([1, 2, 3, 4].map((n) => levelCost(n, l))).toEqual([100, 110, 121, 133]);
    // Squared: start + perLevel × level².
    const sq = levels({ firstLevels: [], start: 0, perLevel: 50, exponent: 2 });
    expect([1, 2, 3, 10].map((n) => levelCost(n, sq))).toEqual([50, 200, 450, 5000]);
  });

  test("counted as a running total: the figures are the totals, and the bar shows the total", () => {
    const l = levels({ counting: "total", firstLevels: [83, 174, 276], start: 0, perLevel: 100 });
    // Level 1 → 2 takes 83, 2 → 3 takes 91, 3 → 4 takes 102; then 100 × level as totals.
    expect([1, 2, 3].map((n) => levelCost(n, l))).toEqual([83, 91, 102]);
    expect(levelCost(4, l)).toBe(400 - 276);
    expect(levelTotal(4, l)).toBe(276);
    expect(expShown({ level: 3, exp: 10, expNeeded: 102 }, l)).toEqual({ have: 184, need: 276 });
  });
});

describe("kill XP by level difference", () => {
  test("more for a monster above you, less below, never past the most percent", () => {
    install({ killXp: { ...BALANCE_DEFAULTS.killXp, adjust: "levelDifference" } });
    // 10% less a level below, 5% more a level above, at most 150%.
    expect(xpGained(100, 10, 10)).toBe(100);
    expect(xpGained(100, 10, 14)).toBe(120);
    expect(xpGained(100, 10, 40)).toBe(150);
    expect(xpGained(100, 10, 7)).toBe(70);
    expect(xpGained(100, 10, 0)).toBe(0);
    // A monster with no level counts as the killer's.
    expect(xpGained(100, 10, undefined)).toBe(100);
  });
});

describe("monster levels", () => {
  test("a species with a level and no XP of its own takes its XP from the level", () => {
    install({}, { Slime: { level: 4, xpMelee: null } });
    // 10 + 5 × 4; the spell XP it keeps is its own (Classic's Slime: 14).
    expect(speciesKillXp(content().monster("Slime"), "melee")).toBe(30);
    expect(speciesKillXp(content().monster("Slime"), "spell")).toBe(14);
  });

  test("shown only when the world shows them: 'Wolf (level 3)'", () => {
    install({}, { Slime: { level: 3 } });
    expect(shownMonsterLevel("Slime")).toBeUndefined();
    install({ levels: levels({ showMonsterLevels: "shown" }) }, { Slime: { level: 3 } });
    expect(shownMonsterLevel("Slime")).toBe(3);
    expect(shownMonsterLevel("Orc")).toBeUndefined();
    expect(withMonsterLevel("Slime", 3)).toBe("Slime (level 3)");
    expect(withMonsterLevel("Orc", undefined)).toBe("Orc");
  });
});

describe("level cap, level rewards and curve changes", () => {
  test("at the highest level nothing more levels and the XP still counts", () => {
    install({ levels: levels({ cap: 3 }) });
    expect(levelCost(2)).toBe(400);
    expect(levelCost(3)).toBe(0);
    const v = vitals({ level: 2, exp: 5000, expNeeded: 400 });
    expect(checkLevelUp(v)).toBe(1);
    expect(v).toMatchObject({ level: 3, exp: 4600, expNeeded: 0 });
    expect(expShown(v)).toEqual({ have: 4600, need: null });
  });

  test("each level gives the HP and SP max the world sets", () => {
    install({ levels: levels({ hpPerLevel: 5, spPerLevel: 0 }) });
    const v = vitals({ exp: 30 });
    checkLevelUp(v);
    expect(v).toMatchObject({ level: 2, hpMax: 25, spMax: 20 });
  });

  test("a changed curve keeps the level and the XP held; XP that now reaches the level levels up", () => {
    install({ levels: levels({ firstLevels: [], start: 100, perLevel: 0 }) });
    const kept = vitals({ level: 7, exp: 50, expNeeded: 414 });
    expect(syncLevel(kept)).toBe(0);
    expect(kept).toMatchObject({ level: 7, exp: 50, expNeeded: 100 });
    const over = vitals({ level: 7, exp: 250, expNeeded: 414 });
    expect(syncLevel(over)).toBe(2);
    expect(over).toMatchObject({ level: 9, exp: 50, expNeeded: 100, hpMax: 22 });
  });

  test("the character editor follows the world's curve and rewards", () => {
    const l = levels({ firstLevels: [], start: 100, perLevel: 0, hpPerLevel: 3, spPerLevel: 2 });
    const before: EditableCharacter = {
      classCode: 1,
      level: 1,
      exp: 0,
      expNeeded: 30,
      hp: 20,
      hpMax: 20,
      sp: 20,
      spMax: 20,
      str: 10,
      sta: 10,
      dex: 10,
      int: 10,
      wis: 10,
      skills: {},
      hunger: 40000,
      faction: null,
      factionCount: 0,
      wanted: false,
      respawn: null,
      gold: 0,
      bank: null,
      bag: Array(15).fill(null),
      equip: { ...NO_EQUIPMENT },
      vault: [],
      spellbook: [],
      position: { map: "x", x: 1, y: 1 },
      sex: 1,
      head: 1,
    };
    const after = deriveEdit(before, { level: 4 }, l);
    expect(after).toMatchObject({ level: 4, expNeeded: 100, hpMax: 29, spMax: 26 });
    // At the highest level any XP is allowed.
    const capped = deriveEdit(before, { level: 4, exp: 99_999 }, levels({ cap: 4 }));
    expect(capped.expNeeded).toBe(0);
    expect(editErrors(before, capped).filter((e) => e.startsWith("Experience"))).toEqual([]);
  });
});
