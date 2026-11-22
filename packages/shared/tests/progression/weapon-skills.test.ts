/**
 * Weapons that trained nothing: the Dragon Sword and Steel Scimitar had no kill skill-gain row,
 * and the exact-name rows (skill gain and attack-power skill blocks) missed the masterworks a
 * repair makes, such as Knight's Sword +1 and Sword of Hope +1.
 */
import { describe, expect, test } from "bun:test";

import { classicData } from "@secondstaronline/data/classic";

const { classes: classesData } = classicData;

import { attackPower } from "../../src/rules/combat/attpower.ts";
import {
  type Fighter,
  NO_EQUIPMENT,
  NO_FACTION,
  skillIndex,
} from "../../src/rules/core/fighter.ts";
import type { Rng } from "../../src/rules/core/lingo.ts";
import { masterworkBase, weaponIs } from "../../src/rules/crafting/masterwork.ts";
import { weaponSkillList } from "../../src/rules/progression/skillgain.ts";

const SWORD = ["Slash", "Thrust", "Swordsmanship", "Fencing"];

function fighter(weapon: string, skills: Record<string, number> = {}): Fighter {
  const s = [...classesData.creation.startingSkills[1].values];
  for (const [name, v] of Object.entries(skills)) {
    s[skillIndex(name)] = v;
  }
  return {
    level: 1,
    str: 1,
    sta: 1,
    int: 1,
    wis: 1,
    spd: 1,
    skills: s,
    equip: { ...NO_EQUIPMENT, weapon },
    faction: { ...NO_FACTION },
    attackBonus: 0,
    wanted: false,
  };
}
const minRng: Rng = { random: (n) => (n >= 1 ? 1 : 0) };

describe("kill skill gain by weapon", () => {
  test("bug fixed: the Dragon Sword and Steel Scimitar train the sword skills", () => {
    expect(weaponSkillList("Dragon Sword")).toEqual(SWORD);
    expect(weaponSkillList("Steel Scimitar")).toEqual(SWORD);
  });

  test("bug fixed: a masterwork trains what its base weapon trains", () => {
    for (const n of [1, 2, 3, 4]) {
      expect(weaponSkillList(`Knight's Sword +${n}`)).toEqual(weaponSkillList("Knight's Sword"));
    }
    expect(weaponSkillList("Knight's Sword +1")).toEqual([
      "Slash",
      "Thrust",
      "Swordsmanship",
      "Heavy Arms",
    ]);
    expect(weaponSkillList("Sword of Hope +1")).toEqual(weaponSkillList("Sword of Hope"));
    expect(weaponSkillList("Star Sword +2")).toEqual(weaponSkillList("Star Sword"));
  });

  test("an exact row still needs the name: a longer name is not a masterwork", () => {
    expect(masterworkBase("Knight's Sword +2")).toBe("Knight's Sword");
    expect(masterworkBase("Knight's Sword")).toBe("Knight's Sword");
    expect(weaponIs("Knight's Sword +3", "Knight's Sword")).toBe(true);
    expect(weaponIs("Knight's Sword +9", "Knight's Sword")).toBe(false);
    expect(weaponIs("Damaged Sword, Knight", "Knight's Sword")).toBe(false);
  });
});

describe("attack-power skill blocks", () => {
  test("bug fixed: Sword of Hope +1 gets the Heavy Arms bonus of the Sword of Hope", () => {
    // The Heavy Arms tiers' share of the power: six tiers at Heavy Arms 99.
    const heavyArms = (weapon: string) =>
      attackPower(fighter(weapon, { "Heavy Arms": 99, Slash: 0, Thrust: 0 }), minRng).power -
      attackPower(fighter(weapon, { "Heavy Arms": 0, Slash: 0, Thrust: 0 }), minRng).power;
    expect(heavyArms("Sword of Hope")).toBe(6);
    expect(heavyArms("Sword of Hope +1")).toBe(6);
  });
});
