/** Golden tests for the shared spell rules. */
import { describe, expect, test } from "bun:test";

import { classicData } from "@secondstaronline/data/classic";

const { spells: spellsData } = classicData;

import { castSchema } from "../../src/protocol/spells.ts";
import {
  type Faction,
  type Fighter,
  NO_EQUIPMENT,
  NO_FACTION,
  skillIndex,
} from "../../src/rules/core/fighter.ts";
import type { Rng } from "../../src/rules/core/lingo.ts";
import { skillCaps } from "../../src/rules/progression/skillgain.ts";
import { newFx, placeFx, stepFx } from "../../src/rules/spells/spellfx.ts";
import {
  BOOK_TEXT,
  baseSpell,
  bookDex,
  type Caster,
  castMageCap,
  crystalLine,
  directional,
  fxEffect,
  inCastBounds,
  inxitionText,
  isHarmful,
  isInert,
  morphBody,
  morphCounterFor,
  playerSpellAmount,
  runBook,
  SKILL_BOOK_CAP,
  type SpellTarget,
  savedSpellbook,
  spCost,
  spellDefense,
  spellHitOnMonster,
  spellImp,
  spellPower,
  spellTable,
} from "../../src/rules/spells/spells.ts";

/** `random(n)` answers from a list, then `n`. */
function queue(results: number[] = []): Rng & { calls: number[] } {
  const calls: number[] = [];
  return {
    calls,
    random(n) {
      calls.push(n);
      return results.length > 0 ? (results.shift() as number) : n;
    },
  };
}

const skills = (set: Record<string, number> = {}) => {
  const s = Array(38).fill(0) as number[];
  for (const [k, v] of Object.entries(set)) {
    s[skillIndex(k)] = v;
  }
  return s;
};
const caster = (set: Record<string, number> = {}, body = "NOTHING"): Caster => ({
  skills: skills(set),
  equip: { ...NO_EQUIPMENT, body },
  faction: { ...NO_FACTION },
});

describe("costs", () => {
  test("SSO: every spell costs a whole SP amount of at least 0 in any armour and a crystal count of at least 1; the cast message carries no cost", () => {
    const bodies = [
      "NOTHING",
      ...spellsData.spells.flatMap((s) => (s.spByBody ?? []).map((r) => r.pattern)),
    ];
    for (const s of spellsData.spells) {
      for (const body of bodies) {
        const sp = spCost(s.name, body);
        expect(Number.isInteger(sp) && sp >= 0).toBe(true);
      }
      if (s.crystals) {
        expect(Number.isInteger(s.crystals.count) && s.crystals.count >= 1).toBe(true);
      }
    }
    expect(Object.keys(castSchema.shape).sort()).toEqual(["spell", "t", "x", "y"]);
  });
});

describe("the cast checks", () => {
  test("bug fixed: a cast click must be on the playfield [30, 31, 574, 415]", () => {
    expect(inCastBounds(30, 31)).toBe(true);
    expect(inCastBounds(573, 414)).toBe(true);
    // 1.6's margin: 8 < H < 580, 5 < V < 420.
    expect(inCastBounds(9, 6)).toBe(false);
    expect(inCastBounds(29, 100)).toBe(false);
    expect(inCastBounds(100, 30)).toBe(false);
    expect(inCastBounds(574, 100)).toBe(false);
    expect(inCastBounds(100, 415)).toBe(false);
    expect(inCastBounds(579, 419)).toBe(false);
  });
  test("bug fixed: the spells 1.6 gave no effect are inert, by name or effect", () => {
    for (const s of ["Bless", "weaken", "Haste", "Poison Dart", "Replenish", "Holy Weapon"]) {
      expect(isInert(s)).toBe(true);
    }
    expect(isInert("Identify")).toBe(true);
    for (const s of ["Minor Heal", "Radar", "Fireball", "Hold"]) {
      expect(isInert(s)).toBe(false);
    }
  });
  test("the harmful set has 11 spells and not Hold, Raise Dead or Summon Creature", () => {
    for (const s of ["Fireball", "WIND WAVE", "Holy Shield", "Web", "Bolt"]) {
      expect(isHarmful(s)).toBe(true);
    }
    for (const s of ["Hold", "Raise Dead", "Summon Creature", "Minor Heal"]) {
      expect(isHarmful(s)).toBe(false);
    }
  });
  test("Holy Weapon costs 10 SP though it places nothing", () => {
    expect(spCost("Holy Weapon", "NOTHING")).toBe(10);
  });
  test("SP cascade: Firesword 22 (24 then 22), Identify 0", () => {
    expect(spCost("Firesword", "NOTHING")).toBe(22);
    expect(spCost("Identify", "NOTHING")).toBe(0);
    expect(spCost("minor heal", "NOTHING")).toBe(5);
  });
  test('bug fixed: Smoke Bomb costs 25 in a body named exactly "Ninja", like any other body', () => {
    expect(spCost("Smoke Bomb", "Ninja")).toBe(25);
    expect(spCost("Smoke Bomb", "NOTHING")).toBe(25);
    expect(spCost("Smoke Bomb", "Ninja Outfit")).toBe(17);
    expect(spCost("Smoke Bomb", "Royal Ninja Uniform")).toBe(13);
  });
  test("bug fixed: crystal loading takes the last bag line holding that crystal, by its whole name", () => {
    const bag = [
      { item: "Red Crystal" },
      null,
      { item: "Red Crystal" },
      { item: "Blue Crystal" },
      // 1.6 took any line containing "<Colour> Cry".
      { item: "Red Crystal Ring" },
    ];
    expect(crystalLine(bag, "Red")).toBe(2);
    expect(crystalLine(bag, "Green")).toBe(-1);
  });
});

describe("SPower", () => {
  test("base power: 1 + Magery tiers + gear", () => {
    expect(spellPower("Radar", caster({ Magery: 95 }, "Wizard's Robe"))).toBe(1 + 9 + 5 + 0);
  });
  test("Wrath school: +2 at > 0 then +1 per tier", () => {
    expect(spellPower("Meteor", caster({ Wrath: 31 }))).toBe(1 + 2 + 3);
  });
  test("bug fixed: Fireball and Wind Wave get their school bonus by the base name", () => {
    const c = caster({ Fire: 99, Wind: 99 });
    const school = 2 + 1 + 1 + 1 + 1 + 1 + 2 + 4;
    expect(spellPower("Fireball", c)).toBe(1 + school);
    expect(spellPower("Wind Wave", c)).toBe(1 + school);
    expect(spellPower("Firebolt", c)).toBe(1 + school);
    // A directional name is not a spell name: the caller works out the power first.
    expect(spellPower("FireballL", c)).toBe(1);
  });
  test("Bolt gets Wrath before its rename", () => {
    expect(spellPower("Bolt", caster({ Wrath: 5 }))).toBe(3);
  });
  test("Smoke Bomb's power replaces the base: MartialArts table and ninja bodies", () => {
    expect(spellPower("Smoke Bomb", caster({ MartialArts: 5, Magery: 99 }))).toBe(25);
    expect(spellPower("Smoke Bomb", caster({ MartialArts: 95 }, "Royal Ninja Uniform"))).toBe(580);
  });
});

describe("direction", () => {
  test("the larger axis wins; LEFT and UP by default; a tie gives the R form", () => {
    expect(directional("Fireball", 200, 200, 100, 190)).toBe("FireballL");
    expect(directional("Fireball", 200, 200, 205, 300)).toBe("FireballD");
    expect(directional("Fireball", 200, 200, 210, 190)).toBe("FireballR");
    expect(directional("Wind wave", 200, 200, 200, 200)).toBe("Wind waveR");
    expect(directional("Wind wave", 200, 200, 190, 190)).toBe("Wind waveR");
  });
});

describe("SpellImp", () => {
  test("Magery then the school, each random(skill) = 1", () => {
    const s = skills({ Magery: 5, Wrath: 4 });
    const lines = spellImp("Meteor", s, { ...NO_FACTION }, queue([1, 1]));
    expect(lines).toEqual([
      "You have advanced in the art of magery!",
      "You have advanced in the art of Wrath!",
    ]);
    expect(s[skillIndex("Magery")]).toBe(6);
  });
  test("bug fixed: Bolt and Wind Wave raise their school from their directional names", () => {
    const s = skills({ Magery: 0, Wrath: 4, Wind: 4 });
    expect(spellImp("BoltR", s, { ...NO_FACTION }, queue([1]))).toEqual([
      "You have advanced in the art of Wrath!",
    ]);
    expect(spellImp("Wind waveU", s, { ...NO_FACTION }, queue([1]))).toEqual([
      "You have advanced in the art of Wind!",
    ]);
    expect(s[skillIndex("Wrath")]).toBe(5);
    expect(s[skillIndex("Wind")]).toBe(5);
  });
  test("a cast Fireball trains Magery and Fire from its directional name", () => {
    const s = skills({ Magery: 3, Fire: 3 });
    expect(spellImp("FireballU", s, { ...NO_FACTION }, queue([1, 1]))).toHaveLength(2);
  });
  test("baseSpell reads a directional name as its spell", () => {
    expect(baseSpell("FireballL")).toBe("Fireball");
    expect(baseSpell("BoltD")).toBe("Bolt");
    expect(baseSpell("Wind waveR")).toBe("Wind Wave");
    expect(baseSpell("Firebolt")).toBe("Firebolt");
    expect(baseSpell("Blue ArrowsL")).toBe("Blue ArrowsL");
  });
  test("arrows and the smoke puff skip it", () => {
    const r = queue([1, 1]);
    expect(spellImp("Blue ArrowsL", skills({ Magery: 3 }), { ...NO_FACTION }, r)).toEqual([]);
    expect(spellImp("xSmokeoBomb", skills({ Magery: 3 }), { ...NO_FACTION }, r)).toEqual([]);
    expect(r.calls).toEqual([]);
  });
  test("Mage skill cap 30; Mage faction 50/60/70/90/100", () => {
    expect(castMageCap(NO_FACTION)).toBe(30);
    expect(castMageCap({ key: "mage", tier: 3 })).toBe(90);
    expect(castMageCap({ key: "mage", tier: 4 })).toBe(100);
  });
  test("bug fixed: a Mage faction bonus of 3 caps Mage skill at 90 from kills and casts alike", () => {
    const faction: Faction = { key: "mage", tier: 3 };
    const mage: Fighter = {
      level: 1,
      str: 10,
      sta: 10,
      int: 1,
      wis: 1,
      skills: Array(38).fill(1) as number[],
      equip: { ...NO_EQUIPMENT },
      faction,
      attackBonus: 0,
      wanted: false,
    };
    expect(skillCaps(mage).mage).toBe(90);
    expect(castMageCap(faction)).toBe(90);
    for (const tier of [0, 1, 2, 3, 4, 9]) {
      const f = { ...faction, tier };
      expect(skillCaps({ ...mage, faction: f }).mage).toBe(castMageCap(f));
    }
  });
});

describe("books", () => {
  test("bug fixed: the Dex table's typos: Argon's Fist Book needs 10, any Bolt book 24", () => {
    expect(bookDex("Argon's Fist Book")).toBe(10);
    expect(bookDex("Bolt Spell Book")).toBe(24);
    expect(bookDex("Bolt Book")).toBe(24);
    expect(bookDex("Firebolt Book")).toBe(20);
    expect(bookDex("Portal Book")).toBe(26);
  });
  test("RunBook: the last contains match wins: Firebolt Book teaches Firebolt", () => {
    const book: string[] = [];
    expect(runBook("Firebolt Book", [], book, queue())).toMatchObject({
      kind: "spell",
      spell: "Firebolt",
    });
    expect(book).toEqual(["Firebolt"]);
  });
  test("bug fixed: the Radar and Haste books teach their spells", () => {
    expect(runBook("Radar Book", [], [], queue())).toMatchObject({ kind: "spell", spell: "Radar" });
    expect(runBook("Haste Book", [], [], queue())).toMatchObject({ kind: "spell", spell: "Haste" });
  });
  test("already known: an exact line", () => {
    expect(runBook("Hold Book", [], ["Hold"], queue())).toEqual({
      kind: "none",
      lines: [BOOK_TEXT.known],
    });
  });
  test("bug fixed: combat books add 1 + random(5) below 77 and stop at 77", () => {
    const s = skills({ Parry: 70 });
    expect(runBook("Parry Book", s, [], queue([3]))).toMatchObject({ kind: "skill" });
    expect(s[skillIndex("Parry")]).toBe(74);
    expect(runBook("Parry Book", s, [], queue([5]))).toMatchObject({ kind: "skill" });
    expect(s[skillIndex("Parry")]).toBe(SKILL_BOOK_CAP);
    expect(runBook("Parry Book", s, [], queue())).toEqual({
      kind: "none",
      lines: [BOOK_TEXT.nothingMore],
    });
  });
  test("bug fixed: the saved spellbook keeps every spell, Identify and the 30th line included", () => {
    const names = spellsData.spells.map((s) => s.name);
    expect(names.length).toBeGreaterThan(29);
    expect(savedSpellbook(["Identify", ...names.filter((n) => n !== "Identify")])).toEqual([
      "Identify",
      ...names.filter((n) => n !== "Identify"),
    ]);
    expect(savedSpellbook(["Minor Heal", "Nonsense"])).toEqual(["Minor Heal"]);
  });
});

describe("effects", () => {
  test("Morph: N = 3 + P + random(5), the last threshold passed", () => {
    expect(morphBody(1, queue([1]))).toBe(30);
    expect(morphBody(8, queue([5]))).toBe(31);
    expect(morphBody(20, queue([5]))).toBe(40);
  });
  test("morph counter: 1300 below 300, unchanged at exactly 300", () => {
    expect(morphCounterFor(80, 0)).toBe(1300);
    expect(morphCounterFor(300, 7)).toBe(7);
  });
  test("Inxition: the band for ExpNeeded − exp; 10000 or more is the bare name", () => {
    expect(inxitionText("Ann", 400, 380)).toBe(
      "Ann will become more powerful within only a few more fights.",
    );
    expect(inxitionText("Ann", 20000, 0)).toBe("Ann");
  });
});

describe("FX", () => {
  test("placement offsets: fireball ±32, wind ±33, Bolt's fixed offsets, splash V − 32", () => {
    const c = { h: 200, v: 200 };
    const t = { h: 50, v: 60 };
    expect(placeFx("FireballL", c, t)).toEqual({ h: 168, v: 200 });
    expect(placeFx("Wind waveD", c, t)).toEqual({ h: 200, v: 233 });
    expect(placeFx("BoltR", c, t)).toEqual({ h: 230, v: 195 });
    expect(placeFx("BoltD", c, t)).toEqual({ h: 193, v: 240 });
    expect(placeFx("Splash", c, t)).toEqual({ h: 50, v: 28 });
    expect(placeFx("Minor Heal", c, t)).toEqual(t);
    expect(placeFx("Blue ArrowsU", c, t)).toEqual({ h: 50, v: 28 });
  });
  test("the dead spells place nothing: Bless, Haste, Weaken, Poison Dart, Replenish, Holy Weapon", () => {
    for (const n of [
      "Bless",
      "Haste",
      "Weaken",
      "Poison Dart",
      "Replenish",
      "Holy Weapon",
      "Identify",
    ]) {
      expect(placeFx(n, { h: 1, v: 1 }, { h: 1, v: 1 })).toBeNull();
    }
  });
  test("a point FX shows frames 1..last, then hides: minor heal 7 ", () => {
    const fx = newFx("Minor Heal", { h: 100, v: 100 });
    let shown = 1;
    while (!fx.gone) {
      stepFx(fx);
      if (!fx.gone) {
        shown += 1;
      }
    }
    expect(shown).toBe(7);
  });
  test("a fireball moves 8 px a frame, loops frames 1-3 and goes past H 550 ", () => {
    const fx = newFx("FireballR", { h: 540, v: 100 });
    stepFx(fx);
    expect([fx.h, fx.frame, fx.gone]).toEqual([548, 2, false]);
    stepFx(fx);
    expect([fx.h, fx.frame, fx.gone]).toEqual([556, 3, true]);
  });
  test("an arrow never waits on the mask; it flies 8 px a call until its edge test hides it ", () => {
    const fx = newFx("Blue ArrowsL", { h: 50, v: 100 });
    stepFx(fx);
    expect([fx.h, fx.gone]).toEqual([42, false]);
    stepFx(fx);
    expect([fx.h, fx.gone]).toEqual([34, false]);
    stepFx(fx);
    expect([fx.h, fx.gone]).toEqual([26, true]); // locH < 34
  });
  test("a FX at locV <= 0 never steps ", () => {
    const fx = newFx("Splash", { h: 100, v: -10 });
    stepFx(fx);
    expect(fx.frame).toBe(1);
  });
});

describe("spell hits lifted out of the collision handlers", () => {
  test("spellHitOnMonster: Splash on a species it heals (Classic: the Dragon Hatchling, body 36) heals 10 + P + random(5)", () => {
    const rng = queue([4]);
    expect(spellHitOnMonster("splash-18", { healedBy: ["Splash"] }, 0, 7, rng)).toEqual({
      n: 21,
      heal: true,
      splat: true,
    });
    expect(rng.calls).toEqual([5]);
  });

  test("spellHitOnMonster: Arrows below 1 after defense draw random(2)", () => {
    const rng = queue([2]);
    expect(spellHitOnMonster("Fire Arrows-1", {}, 9, 3, rng)).toEqual({
      n: 2,
      heal: false,
      splat: true,
    });
    expect(rng.calls).toEqual([2]);
  });

  test("playerSpellAmount: Arrows deal P + random(2), then the spell-defense lookup adds random(3)", () => {
    const rng = queue([2, 1]);
    expect(playerSpellAmount("Arrows", 5, BARE, rng)).toBe(8);
    expect(rng.calls).toEqual([2, 3]);
  });

  test("playerSpellAmount: Minor Heal heals 2 + P + random(2) and draws no spell-defense lookup", () => {
    const rng = queue([1]);
    expect(playerSpellAmount("minor heal", 4, BARE, rng)).toBe(7);
    expect(rng.calls).toEqual([2]);
  });

  test("playerSpellAmount: Firebolt and Splash skip the spell-defense lookup, as in 1.6", () => {
    const shielded: SpellTarget = { ...BARE, magicShield: true };
    expect(playerSpellAmount("firebolt", 3, shielded, queue([1]))).toBe(12);
    expect(playerSpellAmount("Splash", 3, shielded, queue([1]))).toBe(24);
  });
});

/** No armour, no Magic Shield. */
const BARE: SpellTarget = { equip: { ...NO_EQUIPMENT }, magicShield: false };

describe("the spell-defense lookup", () => {
  const wearing = (e: Partial<SpellTarget["equip"]>, magicShield = false): SpellTarget => ({
    equip: { ...NO_EQUIPMENT, ...e },
    magicShield,
  });
  test("bug fixed: robes and Magic Shield lower spell damage; metal armour raises it", () => {
    // 20 + random(3) bare.
    expect(spellDefense(20, BARE, queue([2]))).toBe(22);
    // Necromancer's Robe −4, Crown −3, Small Shield −1.
    const robed = wearing({ body: "Necromancer's Robe", head: "Crown", offHand: "Small Shield" });
    expect(spellDefense(20, robed, queue([2]))).toBe(20 - 8 + 2);
    // Plate Armor +4, War Helm +5, Knight Shield +6.
    const plate = wearing({ body: "Plate Armor", head: "War Helm", offHand: "Knight Shield" });
    expect(spellDefense(20, plate, queue([2]))).toBe(20 + 15 + 2);
    // Magic Shield −5.
    expect(spellDefense(20, wearing({}, true), queue([2]))).toBe(20 - 5 + 2);
  });
  test("bug fixed: an amount brought below 1 becomes random(3); exactly one draw either way", () => {
    const rng = queue([2]);
    const robed = wearing({ body: "Necromancer's Robe", head: "Pharaoh Helm" }, true);
    expect(spellDefense(5, robed, rng)).toBe(2);
    expect(rng.calls).toEqual([3]);
  });
  test("the rows are `contains`, so a damaged or +N item counts", () => {
    expect(spellDefense(10, wearing({ body: "Lord's Armor +2" }), queue([1]))).toBe(10 - 5 + 1);
  });
});

describe("worn items add to the power", () => {
  test("gear adds to the power: White Robe +2, Wizard's Robe +5, Ceramic Armor +5, Mage's Ring +3", () => {
    const power = (equip: Partial<Caster["equip"]>) =>
      spellPower("Minor Heal", {
        skills: skills(),
        equip: { ...NO_EQUIPMENT, ...equip },
        faction: NO_FACTION,
      });
    const bare = power({});
    expect(power({ body: "White Robe" }) - bare).toBe(2);
    expect(power({ body: "Wizard's Robe" }) - bare).toBe(5);
    expect(power({ body: "Ceramic Armor" }) - bare).toBe(5);
    expect(power({ ring: "Mage's Ring" }) - bare).toBe(3);
    // The slot counts: a Wizard's Robe in the ring slot adds nothing.
    expect(power({ ring: "Wizard's Robe" })).toBe(bare);
  });
  test("Necromancer's Robe adds 5 to Black Arts; the Ninja bodies add 60 and 80 to Martial Arts", () => {
    const cast = (spell: string, body: string) =>
      spellPower(spell, {
        skills: skills(),
        equip: { ...NO_EQUIPMENT, body },
        faction: NO_FACTION,
      });
    expect(cast("Raise Dead", "Necromancer's Robe") - cast("Raise Dead", "NOTHING")).toBe(5);
    expect(cast("Smoke Bomb", "Ninja Outfit") - cast("Smoke Bomb", "NOTHING")).toBe(60);
    expect(cast("Smoke Bomb", "Royal Ninja Uniform") - cast("Smoke Bomb", "NOTHING")).toBe(80);
  });
});

describe("spell table and effect mapping", () => {
  test("a row's effect drives the cast, the FX and the hits: spellTable with an Ice Shard row (effect Firebolt) maps Ice Shard -> Firebolt and Ice Shard-12 -> Firebolt-12; an Ice Ball row (effect Fireball) gives Ice BallL for FireballL", () => {
    const firebolt = spellsData.spells.find((s) => s.name === "Firebolt")!;
    const fireball = spellsData.spells.find((s) => s.name === "Fireball")!;
    const iceShard = {
      ...firebolt,
      name: "Ice Shard",
      id: 89,
      effect: "Firebolt",
      fx: firebolt.fx.map((f) => ({ ...f, member: "Ice Shard", effect: f.member })),
    };
    const iceBall = {
      ...fireball,
      name: "Ice Ball",
      id: 90,
      effect: "Fireball",
      fx: fireball.fx.map((f) => ({
        ...f,
        member: f.member.replace("Fireball", "Ice Ball"),
        effect: f.member,
      })),
    };
    const t = spellTable([...spellsData.spells, iceShard, iceBall]);
    expect(t.castEffect("Ice Shard")).toBe("Firebolt");
    expect(`${t.fxEffect("Ice Shard")}-12`).toBe("Firebolt-12");
    expect(t.fxForEffect("Ice Ball", "FireballL")).toBe("Ice BallL");
    expect(t.fxEffect("Ice BallL")).toBe("FireballL");
  });

  test("1.6 FX names come back unchanged from fxEffect (every run member, arrows, BSmith)", () => {
    for (const s of spellsData.spells) {
      for (const f of s.fx) {
        expect(fxEffect(f.member)).toBe(f.member);
        expect(fxEffect(f.member.toLowerCase())).toBe(f.member.toLowerCase());
      }
    }
    for (const name of ["Blue ArrowsR", "BSmith", "Fishing", "Slot Machine", "sprinkle", "Music"]) {
      expect(fxEffect(name)).toBe(name);
    }
  });

  test("spell FX frames come from the row: Splash 28, Whirlwind 60; the non-spell FX keep theirs: Slot Machine 52", () => {
    const steps = (name: string) => {
      const fx = newFx(name, { h: 100, v: 100 });
      let count = 1;
      for (let i = 0; i < 100; i++) {
        stepFx(fx);
        if (fx.gone) {
          break;
        }
        count += 1;
      }
      return count;
    };
    expect(steps("Splash")).toBe(28);
    expect(steps("Whirlwind")).toBe(60);
    expect(steps("Slot Machine")).toBe(52);
  });
});
