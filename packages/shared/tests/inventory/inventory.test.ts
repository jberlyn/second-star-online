/** Golden tests for the bag, equipment, use, armour, breaks, ground items and paperdoll rules. */
import { describe, expect, test } from "bun:test";

import { classicData } from "@secondstaronline/data/classic";

const { classes: classesData } = classicData;

import npcsData from "@secondstaronline/data/test-fixtures/npc-expectations";

import { content } from "../../src/content/store.ts";
import {
  armourRows,
  breakOdds,
  damagedForm,
  elementalRows,
  pvpHit,
  rollArmourBreak,
  rollWeaponBreak,
  shattersText,
} from "../../src/rules/combat/armour.ts";
import { attackPower, bowRefusal } from "../../src/rules/combat/attpower.ts";
import { monsterHitsPlayer } from "../../src/rules/combat/combat.ts";
import {
  type Equipment,
  type Fighter,
  NO_EQUIPMENT,
  NO_FACTION,
  skillIndex,
} from "../../src/rules/core/fighter.ts";
import type { Rng } from "../../src/rules/core/lingo.ts";
import {
  checkEquip,
  EQUIP_TEXT,
  equipSlotFor,
  menuAction,
  strengthRequirement,
  useItem,
} from "../../src/rules/inventory/equip.ts";
import {
  amountPath,
  blocksMonster,
  blocksPlayer,
  clickGate,
  ctrlGate,
  fixedInPlace,
  groundPicture,
  groundPictureTopLeft,
  tilePixel,
} from "../../src/rules/inventory/ground.ts";
import {
  type Bag,
  crystalColour,
  crystalPile,
  emptyBag,
  invAdd,
  invDelSlot,
  isCrystal,
  pileToItem,
} from "../../src/rules/inventory/inventory.ts";
import {
  normaliseLook,
  paperdollLayers,
  portraitLayers,
} from "../../src/rules/inventory/paperdoll.ts";
import {
  DEFAULT_DEATH_DROPS,
  type DeathDropRules,
  type DeathDropVictim,
  dropsOnDeath,
  rollDeathDrop,
  rollLoot,
} from "../../src/rules/monsters/loot.ts";

/** Ctrl by a player of middling Strength away from their own premises. */
const STRANGER = { str: 50, mine: false };

function scripted(results: readonly number[]): Rng & { calls: number[] } {
  let i = 0;
  const calls: number[] = [];
  return {
    calls,
    random(n) {
      calls.push(n);
      const r = results[Math.min(i, results.length - 1)] ?? 0;
      i += 1;
      return n >= 1 ? Math.min(r, n) : 0;
    },
  };
}

function fighter(over: Partial<Fighter> = {}): Fighter {
  return {
    level: 1,
    str: 10,
    sta: 10,
    int: 1,
    wis: 1,
    spd: 1,
    skills: [...classesData.creation.startingSkills[1].values],
    equip: { ...NO_EQUIPMENT },
    faction: { ...NO_FACTION },
    attackBonus: 0,
    wanted: false,
    ...over,
  };
}
const gear = (e: Partial<Equipment>): Equipment => ({ ...NO_EQUIPMENT, ...e });
const zeroSkills = () => Array(38).fill(0) as number[];

describe("bag (InvAdd)", () => {
  test("stacks on an exact name, case-insensitive, and the stack takes the incoming spelling", () => {
    const inv = { bag: emptyBag(), gold: 0 };
    inv.bag[3] = { item: "Chain Boots", qty: 1 };
    expect(invAdd(inv, "Chain boots", 1, scripted([1]))).toEqual({
      kind: "bag",
      slot: 3,
      item: "Chain boots",
    });
    expect(inv.bag[3]).toEqual({ item: "Chain boots", qty: 2 });
  });
  test("otherwise the lowest empty line", () => {
    const inv = { bag: emptyBag(), gold: 0 };
    inv.bag[0] = { item: "Apple", qty: 2 };
    expect(invAdd(inv, "Knife", 1, scripted([1]))).toMatchObject({ slot: 1 });
  });
  test('a name containing " Gold" adds the first word as an integer to gold', () => {
    const inv = { bag: emptyBag(), gold: 5 };
    expect(invAdd(inv, "10 gold", 1, scripted([1]))).toEqual({ kind: "gold", amount: 10 });
    expect(inv.gold).toBe(15);
  });
  test("a full bag with no stack adds nothing", () => {
    const bag: Bag = emptyBag().map((_, i) => ({ item: `X${i}`, qty: 1 }));
    expect(invAdd({ bag, gold: 0 }, "Apple", 1, scripted([1]))).toEqual({ kind: "full" });
  });
  test("Crate and Cauldron get #random(999999)", () => {
    const inv = { bag: emptyBag(), gold: 0 };
    expect(invAdd(inv, "Crate", 1, scripted([4242]))).toMatchObject({ item: "Crate#4242" });
    expect(invAdd(inv, "Cauldron", 1, scripted([7]))).toMatchObject({ item: "Cauldron#7" });
  });
  test("a crystal pile is n of <Colour> Crystal", () => {
    expect(pileToItem("5 Blue Crystal")).toEqual({ item: "Blue Crystal", qty: 5 });
    expect(pileToItem("5 blue crystal")).toEqual({ item: "Blue Crystal", qty: 5 });
    expect(pileToItem("Apple")).toEqual({ item: "Apple", qty: 1 });
    expect(pileToItem("15 Gold")).toEqual({ item: "15 Gold", qty: 1 });
  });
  test("bug fixed: crystals are named in the singular and matched by their whole name", () => {
    expect(crystalColour("Blue Crystal")).toBe("Blue");
    expect(crystalColour(" white CRYSTAL ")).toBe("White");
    // Anything that only contains the words is not a crystal; 1.6's plural still counts, so a
    // stored copy the migration missed works, and a pile of them picks up singular.
    expect(crystalColour("Blue Crystals")).toBe("Blue");
    expect(crystalColour("Blue Crystal Ring")).toBeNull();
    expect(crystalColour("Crystal Axe")).toBeNull();
    expect(crystalColour("Black Crystal")).toBeNull();
    expect(isCrystal("Purple Crystal")).toBe(true);
    expect(crystalPile("20 Red Crystal")).toEqual({ item: "Red Crystal", qty: 20 });
    expect(crystalPile("Red Crystal")).toBeNull();
    expect(crystalPile("20 red crystals")).toEqual({ item: "Red Crystal", qty: 20 });
    expect(crystalPile("20 Gold")).toBeNull();
    for (const c of ["Blue", "Red", "Green", "Yellow", "Purple", "White"]) {
      const item = content().item(`${c} Crystal`);
      expect(item?.icon).not.toBeNull();
      expect(item?.variants).toContain(`${c} Crystals`);
    }
  });
  test("removal is by slot, blanking at 0", () => {
    const bag = emptyBag();
    bag[0] = { item: "Apple", qty: 1 };
    expect(invDelSlot(bag, 0, 2)).toBe(false);
    expect(invDelSlot(bag, 0, 1)).toBe(true);
    expect(bag[0]).toBeNull();
  });
});

describe("equip", () => {
  test("the slot table: Knife LeftHand, Leather Armor Body, Apple No", () => {
    expect(equipSlotFor("Knife")).toBe("LeftHand");
    expect(equipSlotFor("Leather Armor")).toBe("Body");
    expect(equipSlotFor("Apple")).toBe("No");
  });
  test('bug fixed: only the Bo itself matches "Bo"; books and the Boat Deed cannot be equipped', () => {
    expect(equipSlotFor("Bo")).toBe("LeftHand");
    expect(equipSlotFor("Fireball Book")).toBe("No");
    expect(equipSlotFor("Book")).toBe("No");
    expect(equipSlotFor("Boat Deed")).toBe("No");
    // Bows and boots keep their own rows.
    expect(equipSlotFor("Wooden Bow")).toBe("LeftHand");
    expect(equipSlotFor("Chain Boots")).toBe("Feet");
    expect(equipSlotFor("Bowmaster's Ring")).toBe("Ring");
  });
  test("bug fixed: a Catfish Sandwich cannot be equipped; alchemy sand still goes in the right hand", () => {
    expect(equipSlotFor("Catfish Sandwich")).toBe("No");
    expect(equipSlotFor("Purple Sand")).toBe("RightHand");
  });
  test("bug fixed: the Dragon Sword is wielded in the left hand", () => {
    expect(checkEquip("Dragon Sword", { str: 26, wanted: false, equip: gear({}) })).toEqual({
      ok: true,
      slot: "LeftHand",
    });
    expect(strengthRequirement("Dragon Sword")).toBe(26);
  });
  test("bug fixed: the Dragon Sword hits for 12 plus up to 8 and is drawn with the Fire Sword's art", () => {
    // Every draw but random(8) answers 1; no skills, Strength 1: nothing else adds.
    const rolls = (eight: number): Rng => ({ random: (n) => (n === 8 ? eight : n >= 1 ? 1 : 0) });
    const f = fighter({ str: 1, skills: zeroSkills(), equip: gear({ weapon: "Dragon Sword" }) });
    expect(attackPower(f, rolls(1)).power).toBe(12 + 1);
    expect(attackPower(f, rolls(8)).power).toBe(12 + 8);
    expect(normaliseLook(gear({ weapon: "Dragon Sword" })).weapon).toBe("Fire Sword");
  });
  test('bug fixed: "You cannot equip the ..." ends with a full stop', () => {
    expect(checkEquip("Apple", { str: 99, wanted: false, equip: gear({}) })).toEqual({
      ok: false,
      text: "You cannot equip the Apple.",
    });
  });
  test("strength comes first", () => {
    expect(strengthRequirement("Pharaoh Sword")).toBe(28);
    expect(checkEquip("Pharaoh Sword", { str: 27, wanted: false, equip: gear({}) })).toEqual({
      ok: false,
      text: EQUIP_TEXT.weak,
    });
  });
  test("two-handed rules", () => {
    expect(
      checkEquip("Small Shield", { str: 99, wanted: false, equip: gear({ weapon: "War Hammer" }) }),
    ).toEqual({ ok: false, text: EQUIP_TEXT.twoHandedHeld });
    expect(
      checkEquip("War Hammer", {
        str: 99,
        wanted: false,
        equip: gear({ offHand: "Small Shield" }),
      }),
    ).toEqual({ ok: false, text: EQUIP_TEXT.shieldHeld });
  });
  test("murder gear needs the flag", () => {
    expect(checkEquip("Murder Helm", { str: 99, wanted: false, equip: gear({}) })).toEqual({
      ok: false,
      text: EQUIP_TEXT.vile,
    });
    expect(checkEquip("Murder Helm", { str: 99, wanted: true, equip: gear({}) })).toEqual({
      ok: true,
      slot: "Head",
    });
  });
  test("bug fixed: an occupied slot is no refusal (the server swaps)", () => {
    expect(
      checkEquip("Knife", { str: 99, wanted: false, equip: gear({ weapon: "Dagger" }) }),
    ).toEqual({ ok: true, slot: "LeftHand" });
  });
  test("the menu swaps Equip for Cook/Mix/Build/Smith/Storage", () => {
    expect(menuAction("Knife")).toBe("Equip");
    expect(menuAction("Orc Meat")).toBe("Cook");
    expect(menuAction("Potion Bottle")).toBe("Mix");
    expect(menuAction("Logs")).toBe("Build");
    expect(menuAction("Damaged Sword, Long")).toBe("Smith");
    expect(menuAction("Crate#12")).toBe("Storage");
  });
});

describe("use", () => {
  const v = { hp: 10, hpMax: 20, sp: 10, spMax: 20, hunger: 1000 };
  test("Apple: HP 1 + random(3), Hunger +1750", () => {
    const rng = scripted([2]);
    expect(useItem("Apple", v, rng)).toEqual({
      consume: true,
      lines: ["You eat an apple."],
      hp: 13,
      sp: 10,
      hunger: 2750,
      argon: false,
    });
    expect(rng.calls).toEqual([3]);
  });
  test("HP is capped at HPmax, hunger is not", () => {
    expect(useItem("Yeti Burger", { ...v, hp: 19 }, scripted([8]))).toMatchObject({ hp: 20 });
  });
  test("bug fixed: a stuffed player is refused and keeps the food", () => {
    const rng = scripted([3]);
    expect(useItem("Apple", { ...v, hunger: 35000 }, rng)).toEqual({
      consume: false,
      lines: ["You're stuffed!"],
      hp: 10,
      sp: 10,
      hunger: 35000,
      argon: false,
    });
    expect(rng.calls).toEqual([]);
  });
  test('bug fixed: the bite that fills you only says the eat line; "You\'re stuffed!" is the refusal', () => {
    const out = useItem("Apple", { ...v, hunger: 34000 }, scripted([1]));
    expect(out).toMatchObject({ consume: true, lines: ["You eat an apple."] });
    expect(out.hunger).toBeGreaterThan(34999);
  });
  test("bug fixed: Purple Potion says its line once and is refused when stuffed", () => {
    const out = useItem("Purple Potion", v, scripted([1]));
    expect(out).toMatchObject({
      consume: true,
      argon: true,
      lines: ["The power of argon flows through your body."],
    });
    expect(useItem("Purple Potion", { ...v, hunger: 40000 }, scripted([1]))).toMatchObject({
      consume: false,
      argon: false,
      lines: ["You're stuffed!"],
    });
  });
  test("a potion's line names it", () => {
    expect(useItem("Blue Potion", v, scripted([1])).lines).toEqual(["You drink the Blue Potion."]);
  });
  test('not on the whitelist: "You cannot use the X." and nothing is consumed', () => {
    expect(useItem("Knife", v, scripted([1]))).toMatchObject({
      consume: false,
      lines: ["You cannot use the Knife."],
    });
    expect(useItem("Potion Bottle", v, scripted([1])).consume).toBe(false);
  });
  test("burned food is refused with its own line and kept", () => {
    for (const name of ["Burned Orc Meat", "Burned Fish", "Burned Meat", "burned pig"]) {
      expect(useItem(name, v, scripted([1]))).toMatchObject({
        consume: false,
        lines: ["That doesn't look very tasty."],
        hp: v.hp,
        hunger: v.hunger,
      });
    }
  });
  test("Raw Meat is eaten like the other raw meats; Cooked Meat like a cooked meal", () => {
    expect(useItem("Raw Meat", v, scripted([1]))).toMatchObject({
      consume: true,
      lines: ["You eat some raw meat. You're disgusting."],
      hunger: v.hunger + 1800,
    });
    expect(useItem("Cooked Meat", v, scripted([1]))).toMatchObject({
      consume: true,
      lines: ["You eat the cooked meat."],
      hunger: v.hunger + 3200,
    });
  });
});

describe("armour and PvP", () => {
  test("a +N item also matches its contains row", () => {
    expect(armourRows(20, gear({ body: "Chain Armor+2" }), "HitMe")).toBe(14);
  });
  test("HitMe2 column: Fire Armor -6, Ceramic Armor no row", () => {
    expect(armourRows(20, gear({ body: "Fire Armor" }), "HitMe2")).toBe(14);
    expect(armourRows(20, gear({ body: "Ceramic Armor" }), "HitMe2")).toBe(20);
    expect(armourRows(20, gear({ body: "Ceramic Armor" }), "HitMe")).toBe(17);
  });
  test("elemental rows are exact", () => {
    expect(elementalRows(10, gear({ body: "Ice Armor" }), "HitMe", "Ice Sword")).toBe(3);
    expect(elementalRows(10, gear({ body: "Ice Armor" }), "HitMe", "Ice Sword +1")).toBe(10);
  });
  test("PvP parry: base random(90), then one draw per threshold passed", () => {
    const rng = scripted([2, 2, 2, 2, 2]);
    pvpHit(10, fighter({ skills: zeroSkills() }), "Knife", 0, rng);
    // random(3) for the attack, then one parry draw and one block draw at skill 0.
    expect(rng.calls).toEqual([3, 90, 90]);
    const skills = zeroSkills();
    skills[skillIndex("Parry")] = 15;
    const at15 = scripted([2]);
    pvpHit(10, fighter({ skills }), "Knife", 0, at15);
    expect(at15.calls).toEqual([3, 90, 90, 90, 90]);
  });
  test("bug fixed: the faction-3 parry/block bonus clamps a draw pushed below 1 to 1 in PvP, as against monsters", () => {
    const adventurer = fighter({ skills: zeroSkills(), faction: { ...NO_FACTION, id: 3 } });
    // PvP: random(3) = 2; parry draw 3 − 4 < 1 → 1, a parry.
    const pvp = scripted([2, 3]);
    expect(pvpHit(10, adventurer, "Knife", 0, pvp)).toEqual({ kind: "parry" });
    expect(pvp.calls).toEqual([3, 90]);
    // Parry 9 − 4 = 5 misses; block 7 − 10 → 1, a block.
    expect(pvpHit(10, adventurer, "Knife", 0, scripted([2, 9, 7]))).toEqual({ kind: "block" });
    // Against a monster the same low draw clamps to 1: random(90) = 8 − 10 → 1, a parry.
    expect(monsterHitsPlayer(10, adventurer, 0, scripted([2, 8]))).toEqual({ kind: "parry" });
  });
  test("bug fixed: PvP Block 0 can block", () => {
    // random(3) = 3, parry random(90) = 2, block random(90) = 1.
    const rng = scripted([3, 2, 1]);
    expect(pvpHit(10, fighter({ skills: zeroSkills() }), "Knife", 0, rng)).toEqual({
      kind: "block",
    });
    expect(pvpHit(10, fighter({ skills: zeroSkills() }), "Knife", 0, scripted([3, 2]))).toEqual({
      kind: "hit",
      dmg: 13,
    });
  });
  test("bug fixed: a Holy Shield gives Shield in PvP before any draw", () => {
    const rng = scripted([1]);
    expect(pvpHit(10, fighter({ skills: zeroSkills() }), "Knife", 0, rng, true)).toEqual({
      kind: "shield",
    });
    expect(rng.calls).toEqual([]);
  });
  test("HitMe2 runs the armour rows before random(3)", () => {
    const f = fighter({ equip: gear({ body: "Leather Armor" }), skills: zeroSkills() });
    expect(monsterHitsPlayer(10, f, 0, scripted([1, 2, 2]))).toEqual({ kind: "hit", lost: 9 });
  });
});

describe("breaks", () => {
  test("odds 1 + 3·Sta + 600 (+500 weapons) plus the hunger terms", () => {
    expect(breakOdds(10, 1000, 600)).toBe(631);
    expect(breakOdds(10, 45000, 500)).toBe(661);
  });
  test("armour: draw the break chance first, then up to four three-way slot picks", () => {
    const e = gear({ head: "Plate Helm" });
    const rng = scripted([1, 1, 3, 1, 2]);
    expect(rollArmourBreak(e, 10, 1000, "a Goblin", rng)).toBe("Head");
    expect(rng.calls).toEqual([631, 3, 3, 3, 3]);
    const none = scripted([1, 1]);
    expect(rollArmourBreak(gear({}), 10, 1000, "a Goblin", none)).toBeNull();
    expect(none.calls).toEqual([631, 3, 3, 3, 3]);
  });
  test('bug fixed: the armour exclusion list matches "a <name>"', () => {
    const slime = scripted([1, 1]);
    expect(rollArmourBreak(gear({ body: "Chain Armor" }), 1, 0, "a Slime", slime)).toBeNull();
    expect(slime.calls).toEqual([]);
    expect(rollArmourBreak(gear({ body: "Chain Armor" }), 1, 0, "a Goblin", scripted([1, 1]))).toBe(
      "Body",
    );
  });
  test("weapon: exclusions and the exact list before the draw", () => {
    const rng = scripted([1]);
    expect(rollWeaponBreak(gear({ weapon: "Long Sword" }), 1, 0, "Slime", rng)).toBe(false);
    expect(rollWeaponBreak(gear({ weapon: "Knife" }), 1, 0, "Orc", rng)).toBe(false);
    expect(rng.calls).toEqual([]);
    expect(rollWeaponBreak(gear({ weapon: "Long Sword" }), 1, 0, "Orc", rng)).toBe(true);
    expect(rng.calls).toEqual([504]);
  });
  test("the damaged form, last contains rule wins", () => {
    expect(damagedForm("Long Sword")).toBe("Damaged Sword, Long");
    expect(damagedForm("Leather Armor")).toBe("Leather Armor");
    expect(shattersText("Long Sword")).toBe("Your Long Sword shatters in battle!");
  });
});

describe("arrows and crystals", () => {
  test('bug fixed: "green crystals", not "geen"', () => {
    const f = fighter({ equip: gear({ weapon: "Wooden Bow", offHand: "Green Arrows" }) });
    expect(attackPower(f, scripted([1]), () => false).outOfCrystals).toBe(
      "You don't have any green crystals left!",
    );
    expect(bowRefusal(f.equip, [])).toBe("You don't have any green crystals left!");
  });
});

describe("ground items", () => {
  test("tile pixel 32x+14, 32y-3", () => {
    expect(tilePixel(5, 8)).toEqual({ px: 174, py: 253 });
  });
  test("loot never blocks; fixtures do", () => {
    const who = { level: 1, skills: zeroSkills() };
    expect(blocksPlayer("Apple", who)).toBe(false);
    expect(blocksPlayer("15 Gold", who)).toBe(false);
    expect(blocksPlayer("Windmill", who)).toBe(true);
    expect(blocksPlayer("Bob's Newspaper", who)).toBe(true);
    expect(blocksPlayer("Experience Platform", { ...who, level: 21 })).toBe(false);
  });
  test("bug fixed: the Experience Platform names the level it checks (21 passes)", () => {
    const who = { level: 20, skills: zeroSkills() };
    for (const gate of [
      ctrlGate("Experience Platform", STRANGER),
      clickGate("Experience Platform"),
    ]) {
      expect(gate).toMatchObject({
        kind: "text",
        text: "You must be level 21 or higher to pass this platform.",
      });
    }
    expect(blocksPlayer("Experience Platform", who)).toBe(true);
    expect(blocksPlayer("Experience Platform", { ...who, level: 21 })).toBe(false);
  });
  test("bug fixed: Holy Water and newspapers stop monsters as they stop players", () => {
    expect(blocksMonster("Holy Water")).toBe(true);
    expect(blocksMonster("Bob's Newspaper")).toBe(true);
    expect(blocksMonster("Windmill")).toBe(true);
    expect(blocksMonster("Apple")).toBe(false);
  });
  test("gold piles: small 1-49, medium 50-99, large 100+", () => {
    expect(groundPicture("2 Gold")).toBe("SmallGold");
    expect(groundPicture("50 Gold")).toBe("MediumGold");
    expect(groundPicture("100 gold")).toBe("LargeGold");
    expect(groundPicture("5 Blue Crystal")).toBe("BlueCrystal");
    // The named pictures, last match seen.
    expect(groundPicture("Cauldron#12")).toBe("CauldronPic");
    expect(groundPicture("Cauldron")).toBe("Cauldron");
    expect(groundPicture("Wind Cabinet#3")).toBe("WindCabinetPic");
    expect(groundPicture("Crate#4")).toBe("CratePic");
    expect(groundPicture("Treasure Map")).toBe("MapPic");
  });
  test("custom pictures sit at (1, 1) of a 32x32 scratch member, reg (16, -2)", () => {
    // The crystal picture's own regpoint (3, -4) plays no part.
    expect(groundPictureTopLeft(100, 200)).toEqual({ x: 85, y: 203 });
  });
  test("a click views a painting and Ctrl takes it, as a click uses and Ctrl carries", () => {
    expect(clickGate("Painting#12")).toEqual({ kind: "view" });
    expect(ctrlGate("Painting#12", STRANGER)).toEqual({ kind: "take" });
  });
  test("bug fixed: a fixture the world placed is fixed in place; a player's own is not", () => {
    for (const n of [
      "Copy Machine",
      "Large Rock",
      "Table",
      "Campfire",
      "Piano",
      "Knight Statue",
      "Universal Bank",
      "Painting#12",
      "Experience Platform",
    ]) {
      expect(fixedInPlace(n, true)).toBe(true);
    }
    expect(fixedInPlace("Table", false)).toBe(false);
    expect(fixedInPlace("Apple", true)).toBe(false);
    expect(fixedInPlace("15 Gold", true)).toBe(false);
  });
});

describe("loot and the death drop", () => {
  const slime = npcsData.lootTables.find((t) => t.npc === "Slime")?.lines ?? null;
  test("Slime's table: the archived INV| lines", () => {
    expect(slime).toEqual([
      { item: "2 Gold", oneIn: 1 },
      { item: "3 Gold", oneIn: 1 },
      { item: "12 Gold", oneIn: 5 },
      { item: "Leather Armor", oneIn: 60 },
    ]);
  });
  test("two draws: the line, then random(N) = 1", () => {
    const rng = scripted([3, 1]);
    expect(rollLoot(slime, rng)).toBe("12 Gold");
    expect(rng.calls).toEqual([4, 5]);
    const one = scripted([1, 1]);
    expect(rollLoot(slime, one)).toBe("2 Gold");
    expect(one.calls).toEqual([4, 1]);
    expect(rollLoot(null, scripted([1]))).toBeNull();
  });
  const victim = (over: Partial<DeathDropVictim> = {}): DeathDropVictim => ({
    bag: emptyBag(),
    gold: 0,
    level: 10,
    wanted: false,
    killedByPlayer: false,
    inVehicle: false,
    ...over,
  });
  const rules = (over: Partial<DeathDropRules> = {}): DeathDropRules => ({
    ...DEFAULT_DEATH_DROPS,
    ...over,
  });
  test("divergence: whose deaths drop: off, wanted only (the default), killed by a player, everyone", () => {
    expect(DEFAULT_DEATH_DROPS.who).toBe("wanted");
    const plain = victim();
    const pk = victim({ killedByPlayer: true });
    const wanted = victim({ wanted: true });
    const table = (["off", "wanted", "pvp", "everyone"] as const).map((who) =>
      [plain, pk, wanted].map((v) => dropsOnDeath(v, rules({ who }))),
    );
    expect(table).toEqual([
      [false, false, false],
      [false, false, true],
      [false, true, true],
      [true, true, true],
    ]);
  });
  test("divergence: below the protected level nothing drops, unless wanted", () => {
    const r = rules({ who: "everyone", minLevel: 5 });
    expect(dropsOnDeath(victim({ level: 4 }), r)).toBe(false);
    expect(dropsOnDeath(victim({ level: 5 }), r)).toBe(true);
    expect(dropsOnDeath(victim({ level: 4, wanted: true }), r)).toBe(true);
  });
  test("a death that does not drop draws nothing", () => {
    const bag = emptyBag();
    bag[0] = { item: "Apple", qty: 2 };
    const rng = scripted([1, 1]);
    expect(rollDeathDrop(victim({ bag, gold: 5 }), rules(), rng)).toEqual({ kind: "none" });
    expect(rng.calls).toEqual([]);
  });
  test("bug fixed: the death drop picks one of the bag's items at random; crystals never", () => {
    const bag = emptyBag();
    bag[0] = { item: "Apple", qty: 2 };
    bag[3] = { item: "Blue Crystal", qty: 5 };
    bag[5] = { item: "Knife", qty: 1 };
    bag[13] = { item: "Bread", qty: 1 }; // line 14 counts too
    const who = victim({ bag, wanted: true });
    // Three items (the crystals are skipped): random(3) picks among Apple, Knife and Bread.
    const rng = scripted([3]);
    expect(rollDeathDrop(who, rules(), rng)).toEqual({ kind: "item", slot: 13 });
    expect(rng.calls).toEqual([3]);
    expect(rollDeathDrop(who, rules(), scripted([2]))).toEqual({ kind: "item", slot: 5 });
    expect(rollDeathDrop(who, rules(), scripted([1]))).toEqual({ kind: "item", slot: 0 });
    // Only whole crystal names count: a "Crystal Axe" can drop.
    expect(isCrystal("Blue Crystal")).toBe(true);
    expect(isCrystal("red crystal")).toBe(true);
    expect(isCrystal("Crystal Axe")).toBe(false);
    const axe = emptyBag();
    axe[0] = { item: "Crystal Axe", qty: 1 };
    expect(rollDeathDrop({ ...who, bag: axe }, rules(), scripted([1]))).toEqual({
      kind: "item",
      slot: 0,
    });
    // Only crystals: nothing drops.
    const crystals = emptyBag();
    crystals[0] = { item: "Red Crystal", qty: 9 };
    expect(rollDeathDrop({ ...who, bag: crystals }, rules(), scripted([1]))).toEqual({
      kind: "none",
    });
  });
  test("gold over the cap is redrawn as random(cap), unless wanted or the cap is 0", () => {
    const everyone = rules({ who: "everyone" });
    const capped = scripted([1, 250, 120]);
    expect(rollDeathDrop(victim({ gold: 300 }), everyone, capped)).toEqual({
      kind: "gold",
      amount: 120,
    });
    expect(capped.calls).toEqual([2, 300, 200]);
    const wanted = scripted([1, 250]);
    expect(rollDeathDrop(victim({ gold: 300, wanted: true }), everyone, wanted)).toEqual({
      kind: "gold",
      amount: 250,
    });
    expect(wanted.calls).toEqual([2, 300]);
    const uncapped = scripted([1, 250]);
    expect(
      rollDeathDrop(victim({ gold: 300 }), rules({ who: "everyone", goldCap: 0 }), uncapped),
    ).toEqual({
      kind: "gold",
      amount: 250,
    });
  });
  test("divergence: what drops: gold only, or items only, with no coin toss", () => {
    const bag = emptyBag();
    bag[0] = { item: "Knife", qty: 1 };
    const who = victim({ bag, gold: 50, wanted: true });
    const gold = scripted([20]);
    expect(rollDeathDrop(who, rules({ kind: "gold" }), gold)).toEqual({ kind: "gold", amount: 20 });
    expect(gold.calls).toEqual([50]);
    expect(rollDeathDrop({ ...who, gold: 0 }, rules({ kind: "gold" }), scripted([1]))).toEqual({
      kind: "none",
    });
    const items = scripted([1]);
    expect(rollDeathDrop(who, rules({ kind: "items" }), items)).toEqual({ kind: "item", slot: 0 });
    expect(items.calls).toEqual([1]);
  });
});

describe("paperdoll", () => {
  test("bare character: BIM, DEFBOD, bare feet, head", () => {
    expect(paperdollLayers({ head: 3, equip: gear({}) }, "F1", "S")).toEqual([
      "BIM",
      "DEFBOD-F1-S",
      "Bare Feet-F1-S",
      "Head3-F1-S",
    ]);
  });
  test("knife is drawn as Dagger, in front facing E and S, behind facing W", () => {
    expect(paperdollLayers({ head: 1, equip: gear({ weapon: "Knife" }) }, "F2", "W")).toEqual([
      "BIM",
      "Dagger-F2-W",
      "DEFBOD-F2-W",
      "Bare Feet-F2-W",
      "Head1-F2-W",
    ]);
    expect(paperdollLayers({ head: 1, equip: gear({ weapon: "Knife" }) }, "F2", "E")).toEqual([
      "BIM",
      "DEFBOD-F2-E",
      "Bare Feet-F2-E",
      "Head1-F2-E",
      "Dagger-F2-E",
    ]);
    expect(paperdollLayers({ head: 1, equip: gear({ weapon: "Knife" }) }, "F2", "N")).not.toContain(
      "Dagger-F2-N",
    );
  });
  test("design change: the Level row's head is the hairstyle or equipped helmet", () => {
    expect(portraitLayers({ head: 4 })).toEqual(["Head4-F2-S"]);
    expect(portraitLayers({ head: 4, equip: gear({ weapon: "Knife" }) })).toEqual(["Head4-F2-S"]);
    // A worn helmet replaces the head, after the renderer's `+N` strip.
    expect(portraitLayers({ head: 4, equip: gear({ head: "Plate Helm+2" }) })).toEqual([
      "Plate Helm-F2-S",
    ]);
    // Clothing does not hide the Stats portrait.
    expect(portraitLayers({ head: 2, equip: gear({ body: "Ninja Outfit" }) })).toEqual([
      "Head2-F2-S",
    ]);
    expect(
      portraitLayers({
        head: 2,
        equip: gear({ body: "Robe of Invisibility", head: "Plate Helm" }),
      }),
    ).toEqual(["Plate Helm-F2-S"]);
  });
  test("a helm replaces the head; armour replaces DEFBOD", () => {
    expect(
      paperdollLayers(
        { head: 1, equip: gear({ head: "Plate Helm", body: "Chain Armor+1" }) },
        "F1",
        "E",
      ),
    ).toEqual(["BIM", "Chain Armor-F1-E", "Bare Feet-F1-E", "Plate Helm-F1-E"]);
  });
  test("bug fixed: boots are drawn over the body from the Feet slot; gloves are worn in the Ring slot", () => {
    const layers = paperdollLayers(
      { head: 1, equip: gear({ feet: "Chain Boots+1", ring: "Gauntlets" }) },
      "F1",
      "S",
    );
    expect(layers).toEqual([
      "BIM",
      "DEFBOD-F1-S",
      "Chain Boots-F1-S",
      "Gauntlets-F1-S",
      "Head1-F1-S",
    ]);
    expect(
      paperdollLayers({ head: 1, equip: gear({ ring: "Ruby Ring" }) }, "F1", "S"),
    ).toHaveLength(4);
  });
  test("SSO: with no boots the feet are bare, over whatever shoes the body paints", () => {
    const plate = (feet: string) =>
      paperdollLayers({ head: 1, equip: gear({ body: "Plate Armor", feet }) }, "F2", "N");
    expect(plate("")).toEqual(["BIM", "Plate Armor-F2-N", "Bare Feet-F2-N", "Head1-F2-N"]);
    expect(plate("Gold Boots")).toEqual([
      "BIM",
      "Plate Armor-F2-N",
      "Gold Boots-F2-N",
      "Head1-F2-N",
    ]);
  });
  test("shields are never drawn facing E", () => {
    expect(
      paperdollLayers({ head: 1, equip: gear({ offHand: "Steel Shield" }) }, "F1", "E"),
    ).toEqual(["BIM", "DEFBOD-F1-E", "Bare Feet-F1-E", "Head1-F1-E"]);
  });
});

describe("the amount dialog's branches", () => {
  const at = (o: Partial<Parameters<typeof amountPath>[0]>) =>
    amountPath({ gold: true, enough: true, playerAhead: false, monsterAhead: false, ...o });
  test("balance first, then a player ahead, then gold's monster exit, else the drop", () => {
    expect(at({ enough: false, playerAhead: true })).toBe("short");
    expect(at({ playerAhead: true, monsterAhead: true })).toBe("give");
    expect(at({ monsterAhead: true })).toBe("monster");
    expect(at({ gold: false, monsterAhead: true })).toBe("drop");
    expect(at({})).toBe("drop");
  });
});

describe("paperdoll aliases", () => {
  test("weapon, shield, helm, body and ring names are rewritten to the layers that are drawn", () => {
    const look = (e: Partial<Equipment>) => normaliseLook(gear(e));
    expect(look({ weapon: "knife" }).weapon).toBe("Dagger");
    expect(look({ weapon: "Ice Hammer" }).weapon).toBe("Mining Hammer");
    expect(look({ offHand: "Steel Arrows" }).shield).toBe("Arrows");
    expect(look({ offHand: "Saw" }).shield).toBe("NOTHING");
    expect(look({ weapon: "Katana" }).weapon).toBe("Short Sword");
    expect(look({ weapon: "Scimitar+2" }).weapon).toBe("Short Sword");
    expect(look({ head: "Damaged Helm" }).helm).toBe("NOTHING");
    expect(look({ body: "Titanium Armor" }).body).toBe("Argon's Plate");
    expect(look({ body: "Damaged Armor" }).body).toBe("DEFBOD");
    expect(look({ ring: "Gold Ring" }).gloves).toBe("NOTHING");
  });
});
