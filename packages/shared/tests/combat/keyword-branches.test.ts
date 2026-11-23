/**
 * Branches of the name-based combat and drawing rules that no other test reached (issue #37's
 * coverage baseline): the bow-only ring bonus, the Purple Potion, the wide
 * monsters' reach, the shield and arrow layers by facing, and the Radar lines.
 */
import { describe, expect, test } from "bun:test";

import {
  attackPower,
  type Fighter,
  monsterReaches,
  NO_EQUIPMENT,
  NO_FACTION,
  paperdollLayers,
  type Rng,
  radarText,
  skillIndex,
} from "../../src/index.ts";

/** Every draw answers `v`. */
const always = (v: number): Rng & { calls: number[] } => {
  const calls: number[] = [];
  return {
    calls,
    random(n) {
      calls.push(n);
      return Math.min(v, n);
    },
  };
};

function fighter(o: Partial<Fighter> = {}): Fighter {
  return {
    level: 1,
    str: 10,
    sta: 10,
    int: 10,
    wis: 10,
    skills: Array(38).fill(0),
    equip: { ...NO_EQUIPMENT },
    faction: NO_FACTION,
    attackBonus: 0,
    wanted: false,
    ...o,
  };
}

describe("attack power branches", () => {
  test("Bowmaster's Ring adds 4 to a bow shot from Archery 30, and nothing to a sword", () => {
    const bow = { ...NO_EQUIPMENT, weapon: "Wooden Bow", offHand: "Blue Arrows" };
    const archer = (archery: number, ring: string) => {
      const skills = Array(38).fill(0) as number[];
      skills[skillIndex("Archery")] = archery;
      return attackPower(fighter({ skills, equip: { ...bow, ring } }), always(1), () => true).power;
    };
    expect(archer(50, "Bowmaster's Ring") - archer(50, NO_EQUIPMENT.ring)).toBe(4);
    // Below Archery 30 the bow's skill tiers set the power, so the ring's bonus is lost.
    expect(archer(20, "Bowmaster's Ring")).toBe(archer(20, NO_EQUIPMENT.ring));
    const sword = { ...NO_EQUIPMENT, weapon: "Long Sword" };
    expect(
      attackPower(fighter({ equip: { ...sword, ring: "Bowmaster's Ring" } }), always(1)).power,
    ).toBe(attackPower(fighter({ equip: sword }), always(1)).power);
  });

  test("the Purple Potion's attack bonus adds 1", () => {
    const equip = { ...NO_EQUIPMENT, weapon: "Long Sword" };
    const base = attackPower(fighter({ equip }), always(1)).power;
    expect(attackPower(fighter({ equip, attackBonus: 400 }), always(1)).power).toBe(base + 1);
  });
});

describe("monster reach", () => {
  test("a wide monster (Overlord, Mutant Worm) reaches from any of its six cells", () => {
    const mon = { x: 5, y: 5, footprint: true };
    expect(monsterReaches(mon, { x: 8, y: 5 })).toBe(true); // beside the cell at (7, 5)
    expect(monsterReaches(mon, { x: 7, y: 3 })).toBe(true); // above the cell at (7, 4)
    expect(monsterReaches({ ...mon, footprint: false }, { x: 8, y: 5 })).toBe(false);
  });
});

describe("paperdoll shield and arrow layers", () => {
  const look = (offHand: string) => ({
    head: 1,
    equip: { ...NO_EQUIPMENT, weapon: "Long Sword", offHand },
  });

  test("a shield is drawn over the body facing south and west, behind the head facing north", () => {
    for (const facing of ["S", "W"] as const) {
      const out = paperdollLayers(look("Wooden Shield"), "F1", facing);
      expect(out).toContain(`Wooden Shield-F1-${facing}`);
      expect(out).toContain(`Head1-F1-${facing}`);
      expect(out.indexOf(`Wooden Shield-F1-${facing}`)).toBeGreaterThan(
        out.indexOf(`Head1-F1-${facing}`),
      );
    }
    const north = paperdollLayers(look("Wooden Shield"), "F1", "N");
    expect(north).toContain("Wooden Shield-F1-N");
    expect(north).toContain("Head1-F1-N");
    expect(north.indexOf("Wooden Shield-F1-N")).toBeLessThan(north.indexOf("Head1-F1-N"));
    expect(paperdollLayers(look("Wooden Shield"), "F1", "E")).not.toContain("Wooden Shield-F1-E");
  });

  test("arrows (drawn as Arrows) go behind the body facing south and west, and last facing north", () => {
    const south = paperdollLayers(look("Blue Arrows"), "F1", "S");
    expect(south).toContain("Arrows-F1-S");
    expect(south).toContain("DEFBOD-F1-S");
    expect(south.indexOf("Arrows-F1-S")).toBeLessThan(south.indexOf("DEFBOD-F1-S"));
    const north = paperdollLayers(look("Blue Arrows"), "F1", "N");
    expect(north.at(-1)).toBe("Arrows-F1-N");
  });
});

describe("Radar", () => {
  test("the line names the gold, the hit points or the spell points by random(3)", () => {
    const v = { gold: 12, hp: 34, sp: 56 };
    expect(radarText("Ann", v, always(1))).toBe("*** Ann is carrying 12 Gold.");
    expect(radarText("Ann", v, always(2))).toBe("*** Ann has 34 Hit Points.");
    expect(radarText("Ann", v, always(3))).toBe("*** Ann has 56 Spell Points.");
  });
});
