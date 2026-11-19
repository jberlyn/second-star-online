import { describe, expect, test } from "bun:test";

import { classesData } from "@secondstaronline/data";

import {
  type Fighter,
  NO_EQUIPMENT,
  NO_FACTION,
  skillValue,
} from "../../src/rules/core/fighter.ts";
import type { Rng } from "../../src/rules/core/lingo.ts";
import {
  checkLevelUp,
  deathText,
  deathVitals,
  hungerTick,
  meleeKillXp,
  regenTarget,
  regenTick,
  type Vitals,
  xpGained,
} from "../../src/rules/progression/progression.ts";
import {
  monsterSkillCap,
  rollKillSkillGain,
  weaponSkillList,
  wisAdd,
} from "../../src/rules/progression/skillgain.ts";

const minRng: Rng = { random: (n) => (n >= 1 ? 1 : 0) };
const maxRng: Rng = { random: (n) => (n >= 1 ? n : 0) };

const vitals = (): Vitals => ({
  level: 1,
  hp: 20,
  hpMax: 20,
  sp: 20,
  spMax: 20,
  exp: 0,
  expNeeded: 30,
});

describe("kill XP", () => {
  test("Slime: 14 + Regged 10, less the level: 23 at level 1", () => {
    expect(meleeKillXp(14, "Slime", "NOTHING")).toBe(24);
    expect(xpGained(24, 1)).toBe(23);
  });
  test("the > 100 … > 400 bonuses test the growing value", () => {
    expect(meleeKillXp(85, "Orc Lord", "NOTHING")).toBe(95);
    expect(meleeKillXp(91, "x", "NOTHING")).toBe(111); // 101 > 100 → 111
    expect(meleeKillXp(625, "Overlord", "NOTHING")).toBe(705);
  });
  test("Ring of Experience +5, but Cow is set to 5 after it", () => {
    expect(meleeKillXp(14, "Slime", "Ring of Experience")).toBe(29);
    expect(meleeKillXp(30, "Cow", "Ring of Experience")).toBe(15);
  });
  test("a level above the XP gives nothing", () => {
    expect(xpGained(24, 30)).toBe(0);
  });
});

describe("level-up", () => {
  test("bug fixed: the overflow carries over and a big kill can raise several levels; no heal", () => {
    const v = vitals();
    v.hp = 5;
    v.exp = 46;
    expect(checkLevelUp(v)).toBe(1);
    expect(v).toEqual({ level: 2, hp: 5, hpMax: 21, sp: 20, spMax: 21, exp: 16, expNeeded: 400 });
    v.exp = 2000;
    // 2000 − 400 (to 3) − 406 (to 4) − 408 (to 5) − 410 (to 6) = 376, short of the 412 for 7.
    expect(checkLevelUp(v)).toBe(4);
    expect(v).toMatchObject({ level: 6, exp: 376, expNeeded: 412, hpMax: 25, spMax: 25, hp: 5 });
  });
  test("short of the XP needed, nothing changes", () => {
    const v = { ...vitals(), exp: 29 };
    expect(checkLevelUp(v)).toBe(0);
    expect(v).toEqual({ ...vitals(), exp: 29 });
  });
  test("ExpNeeded = 400 + 2·level after level 2", () => {
    const v = { ...vitals(), level: 9, exp: 418, expNeeded: 418 };
    checkLevelUp(v);
    expect(v.expNeeded).toBe(420);
  });
});

describe("regen", () => {
  test("target 60 − speed + 90 = 149 at speed 1", () => {
    expect(regenTarget(1, null)).toBe(149);
    expect(regenTarget(1, 0)).toBe(144);
  });
  test("the counter starts at 1 and is raised first, so regen fires every 148 frames", () => {
    const v = { ...vitals(), hp: 10, sp: 10 };
    let c = 1;
    const fired: number[] = [];
    for (let f = 1; f <= 400; f++) {
      const before = v.hp;
      c = regenTick(c, 149, 50000, v);
      if (v.hp !== before) {
        fired.push(f);
      }
    }
    expect(fired).toEqual([148, 296]);
  });
  test("bug fixed: a period with 50 <= Hunger <= 500 passes with no change and regen goes on", () => {
    const v = { ...vitals(), hp: 10 };
    let c = 1;
    for (let f = 1; f <= 147; f++) {
      c = regenTick(c, 149, 50000, v);
    }
    c = regenTick(c, 149, 300, v); // frame 148 on the target with hunger 300: no change, a reset
    expect(c).toBe(1);
    expect(v.hp).toBe(10);
    for (let f = 0; f < 148; f++) {
      c = regenTick(c, 149, 50000, v);
    }
    expect(v.hp).toBe(11);
  });
  test("bug fixed: a counter already past a lowered target fires on the next frame", () => {
    const v = { ...vitals(), hp: 10 };
    expect(regenTick(140, 120, 50000, v)).toBe(1);
    expect(v.hp).toBe(11);
  });
  test("starving takes 1 HP and SP per period, floor 1", () => {
    const v = { ...vitals(), hp: 2, sp: 1 };
    expect(regenTick(148, 149, 10, v)).toBe(1);
    expect(v.hp).toBe(1);
    expect(v.sp).toBe(1);
  });
});

describe("hunger", () => {
  test("random(3) = 1 takes one; immortals never get hungry", () => {
    expect(hungerTick(100, false, minRng).hunger).toBe(99);
    expect(hungerTick(100, false, maxRng).hunger).toBe(100);
    expect(hungerTick(100, true, minRng).hunger).toBe(100);
  });
  test("bug fixed: a warning prints once, on the frame hunger drops onto the value", () => {
    expect(hungerTick(1501, false, minRng).warning).toBe("You are very hungry.");
    expect(hungerTick(1500, false, maxRng).warning).toBeNull();
    expect(hungerTick(1500, false, minRng).warning).toBeNull();
    expect(hungerTick(1001, false, minRng).warning).toBe(
      "You are extremely hungry, you need to eat.",
    );
    expect(hungerTick(501, false, minRng).warning).toBe("You are starving!");
  });
  test("bug fixed: over many frames each warning prints exactly once", () => {
    let rolls = 0;
    const third: Rng = { random: () => (rolls++ % 3 === 0 ? 1 : 2) };
    let h = 1600;
    const lines: string[] = [];
    while (h > 400) {
      const r = hungerTick(h, false, third);
      h = r.hunger;
      if (r.warning) {
        lines.push(r.warning);
      }
    }
    expect(lines).toEqual([
      "You are very hungry.",
      "You are extremely hungry, you need to eat.",
      "You are starving!",
    ]);
  });
});

describe("death", () => {
  test("divergence: a death never lowers HPmax or SPmax, wanted or not", () => {
    const v = vitals();
    v.hp = 0;
    deathVitals(v);
    expect(v).toMatchObject({ hp: 1, sp: 1, hpMax: 20, spMax: 20 });
  });
  test("the death message line", () => {
    expect(deathText("Bob", "a Slime")).toBe("*** Bob was just killed by a Slime.");
    expect(deathText("Bob", null)).toBe("Bob was just killed.");
  });
});

describe("kill skill gain", () => {
  const f = (): Fighter => ({
    level: 1,
    str: 1,
    sta: 1,
    int: 1,
    wis: 1,
    spd: 1,
    skills: [...classesData.creation.startingSkills[1].values],
    equip: { ...NO_EQUIPMENT },
    faction: { ...NO_FACTION },
    attackBonus: 0,
    wanted: false,
  });
  test("a Dark Scimitar trains Unholy Combat, Slash, Thrust, Swordsmanship and Fencing", () => {
    expect(weaponSkillList("Dark Scimitar")).toEqual([
      "Unholy Combat",
      "Slash",
      "Thrust",
      "Swordsmanship",
      "Fencing",
    ]);
  });
  test("bare hands train Punch and Martial Arts", () => {
    expect(weaponSkillList("NOTHING")).toEqual(["Punch", "Martial Arts"]);
  });
  test("Slime (body 30) caps kill gains at 30", () => {
    expect(monsterSkillCap(30, 1)).toBe(30);
    expect(monsterSkillCap(30, 21)).toBe(48);
  });
  test("WisAdd 30 minus the Wisdom tiers", () => {
    expect(wisAdd(1)).toBe(30);
    expect(wisAdd(24)).toBe(0);
  });
  test("Punch rises on random(Punch + WisAdd) = 1", () => {
    const x = f();
    expect(rollKillSkillGain(x, 30, minRng)).toEqual(["Punch", "MartialArts"]);
    expect(skillValue(x.skills, "Punch")).toBe(2);
    expect(rollKillSkillGain(f(), 30, maxRng)).toEqual([]);
  });
});
