/**
 * World events (issue #3): counters, offerings and counter perks, over the Classic pack's orb war
 * and over an operator's own world events.
 */
import { afterEach, describe, expect, test } from "bun:test";

import { classicData } from "@secondstaronline/data/classic";
import {
  addToCounter,
  attackPower,
  basePower,
  buildContentStore,
  type ContentData,
  counterCommand,
  counterPerkBonus,
  counterValue,
  driftCounters,
  type Fighter,
  factionRows,
  findOffering,
  installContent,
  makeOffering,
  NO_EQUIPMENT,
  NO_FACTION,
  offeringText,
  reconcileCounters,
} from "@secondstaronline/shared";

const FIRE_MAGE = 21;
const WATER_MAGE = 22;
const WIND_MAGE = 23;

/** Installs Classic with its events replaced by `events`. */
function withEvents(events: ContentData["events"]): void {
  const d = structuredClone(classicData) as ContentData;
  d.events = events;
  installContent(buildContentStore(d));
}

afterEach(() => {
  installContent(buildContentStore(classicData));
});

const caster = (classCode: number, counters?: Record<string, number>) => ({
  skills: Array(38).fill(0) as number[],
  equip: { ...NO_EQUIPMENT },
  faction: { ...NO_FACTION },
  classCode,
  ...(counters ? { counters } : {}),
});

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

describe("counters", () => {
  test("design change: Classic's four elements start at 25 of 100, and a saved value is kept inside the bounds", () => {
    expect(reconcileCounters({})).toEqual({ Fire: 25, Water: 25, Earth: 25, Wind: 25 });
    // A saved value is matched ignoring case, kept within 0-100; one no counter has is dropped.
    expect(reconcileCounters({ fire: 40, Wind: 140, Gone: 3 })).toEqual({
      Fire: 40,
      Water: 25,
      Earth: 25,
      Wind: 100,
    });
    expect(counterValue({}, "earth")).toBe(25);
    expect(counterValue({ Earth: -5 }, "Earth")).toBe(0);
  });

  test("a change stops at the counter's lowest and highest, and an unknown counter is left alone", () => {
    expect(addToCounter({ Fire: 99 }, "Fire", 5)).toEqual({ Fire: 100 });
    expect(addToCounter({ Fire: 1 }, "fire", -5)).toEqual({ Fire: 0 });
    expect(addToCounter({ Fire: 1 }, "Nope", 5)).toEqual({ Fire: 1 });
  });

  test("drift: a counter moves back toward its start on its minutes, never past it", () => {
    expect(driftCounters({ Fire: 30, Wind: 20, Water: 25 }, 59)).toBeNull();
    expect(driftCounters({ Fire: 30, Wind: 20, Water: 25 }, 60)).toEqual({
      Fire: 29,
      Wind: 21,
      Water: 25,
    });
    expect(driftCounters({ Fire: 25, Water: 25, Earth: 25, Wind: 25 }, 120)).toBeNull();
    withEvents({
      counters: [
        { name: "Tide", start: 0, min: 0, max: 10, drift: { everyMinutes: 5, by: 4, toward: 10 } },
      ],
      offerings: [],
      perks: [],
    });
    expect(driftCounters({ Tide: 8 }, 5)).toEqual({ Tide: 10 });
    expect(driftCounters({}, 10)).toEqual({ Tide: 4 });
  });
});

describe("offerings", () => {
  test("an offering is found by the dropped item and the placed item, case, #id and +N ignored", () => {
    expect(findOffering("wind orb", "Fire Orb Platform#12")?.name).toBe(
      "Wind Orb on the Fire Orb Platform",
    );
    expect(findOffering("Wind Orb +2", "fire orb platform")?.name).toBe(
      "Wind Orb on the Fire Orb Platform",
    );
    expect(findOffering("Wind Orb", "Mage Master Platform")).toBeUndefined();
    expect(findOffering("Apple", "Fire Orb Platform")).toBeUndefined();
  });

  test("design change: an orb on another element's platform moves 1 from the orb's element to the platform's", () => {
    const o = findOffering("Wind Orb", "Fire Orb Platform");
    if (!o) {
      throw new Error("no offering");
    }
    const r = makeOffering(o, FIRE_MAGE, { Fire: 25, Wind: 25 });
    expect(r).toEqual({
      kind: "made",
      counters: { Fire: 26, Wind: 24 },
      keepsItem: false,
      message:
        "You drop the wind orb onto the fire platform...you sense something powerful has just happened...",
      announce: [
        { text: "You feel the wind magic within you weaken.", classes: [WIND_MAGE] },
        { text: "You feel the fire magic within you grow stronger.", classes: [FIRE_MAGE] },
      ],
    });
  });

  test("design change: an element at zero cannot be weakened further, and the orb stays", () => {
    const o = findOffering("Wind Orb", "Water Orb Platform");
    if (!o) {
      throw new Error("no offering");
    }
    expect(makeOffering(o, WATER_MAGE, { Wind: 0, Water: 60 })).toEqual({
      kind: "refused",
      text: "You get the sense that the wind mages are already weakened enough.",
    });
  });

  test('bug fixed: the same element\'s orb does no good, and 1.6\'s "a earth" reads "an earth"', () => {
    const fire = findOffering("Fire Orb", "Fire Orb Platform");
    const earth = findOffering("Earth Orb", "Earth Orb Platform");
    if (!fire || !earth) {
      throw new Error("no offering");
    }
    expect(makeOffering(fire, FIRE_MAGE, {})).toMatchObject({
      kind: "made",
      counters: {},
      keepsItem: true,
      message: "Dropping a fire orb will do no good here.",
      announce: [],
    });
    expect(makeOffering(earth, FIRE_MAGE, {})).toMatchObject({
      message: "Dropping an earth orb will do no good here.",
      keepsItem: true,
    });
  });

  test("an operator's offering: class test, checks in order, several changes, texts filled in", () => {
    withEvents({
      counters: [
        { name: "Wishes", start: 0, min: 0, max: 3 },
        { name: "Luck", start: 10, min: 0, max: 20 },
      ],
      offerings: [
        {
          name: "Coin in the well",
          item: "Gold Coin",
          onto: "Wishing Well",
          classes: [2],
          classRefusal: "Only a mage's wish is heard.",
          checks: [
            { counter: "Wishes", atMost: 2, refusal: "The well is full." },
            { counter: "Luck", atLeast: 5, refusal: "Your luck has run out." },
          ],
          changes: [
            { counter: "Wishes", add: 1 },
            { counter: "Luck", add: -5 },
          ],
          message: "The {item} sinks into the {onto}.",
          announce: [{ text: "{player} made a wish." }],
        },
      ],
      perks: [],
    });
    const o = findOffering("Gold Coin", "Wishing Well");
    if (!o) {
      throw new Error("no offering");
    }
    expect(makeOffering(o, 1, {})).toEqual({
      kind: "refused",
      text: "Only a mage's wish is heard.",
    });
    expect(makeOffering(o, 2, { Wishes: 3, Luck: 0 })).toEqual({
      kind: "refused",
      text: "The well is full.",
    });
    expect(makeOffering(o, 2, { Wishes: 1, Luck: 4 })).toEqual({
      kind: "refused",
      text: "Your luck has run out.",
    });
    expect(makeOffering(o, 2, { Wishes: 1, Luck: 10 })).toEqual({
      kind: "made",
      counters: { Wishes: 2, Luck: 5 },
      keepsItem: false,
      message: "The {item} sinks into the {onto}.",
      announce: [{ text: "{player} made a wish.", classes: null }],
    });
    expect(
      offeringText("{player} drops the {item} into the {onto}.", {
        player: "Al",
        item: "Gold Coin",
        onto: "Wishing Well",
      }),
    ).toBe("Al drops the Gold Coin into the Wishing Well.");
  });
});

describe("counter perks", () => {
  test("design change: an element mage's spell power rises 1 for each 10 its element holds over 25, and falls below it", () => {
    const base = basePower(caster(FIRE_MAGE));
    expect(basePower(caster(FIRE_MAGE, { Fire: 25 }))).toBe(base);
    expect(basePower(caster(FIRE_MAGE, { Fire: 34 }))).toBe(base);
    expect(basePower(caster(FIRE_MAGE, { Fire: 45 }))).toBe(base + 2);
    expect(basePower(caster(FIRE_MAGE, { Fire: 100 }))).toBe(base + 7);
    expect(basePower(caster(FIRE_MAGE, { Fire: 5 }))).toBe(base - 2);
    // Only the element's own mages: a Water Mage reads the Water counter.
    expect(basePower(caster(WATER_MAGE, { Fire: 100, Water: 25 }))).toBe(
      basePower(caster(WATER_MAGE)),
    );
    expect(counterPerkBonus(1, "spellPower", { Fire: 100 })).toBe(0);
  });

  test("an operator's melee and defence perks, bounded, for everyone or a class and the classes inheriting it", () => {
    const d = structuredClone(classicData) as ContentData;
    d.classes.classes.push({
      ...(d.classes.classes[0] as ContentData["classes"]["classes"][number]),
      code: 90,
      name: "Knight",
      inherits: 1,
    });
    d.events = {
      counters: [{ name: "Siege", start: 0, min: -100, max: 100 }],
      offerings: [],
      perks: [
        {
          name: "Rally",
          counter: "Siege",
          kind: "melee",
          classes: [1],
          from: 0,
          every: 10,
          value: 2,
          most: 6,
        },
        {
          name: "Walls",
          counter: "Siege",
          kind: "defence",
          from: 0,
          every: 25,
          value: 1,
          least: -1,
        },
      ],
    };
    installContent(buildContentStore(d));
    expect(counterPerkBonus(1, "melee", { Siege: 55 })).toBe(6);
    expect(counterPerkBonus(90, "melee", { Siege: 25 })).toBe(4);
    expect(counterPerkBonus(2, "melee", { Siege: 55 })).toBe(0);
    expect(counterPerkBonus(2, "defence", { Siege: -99 })).toBe(-1);
    expect(counterPerkBonus(2, "defence", { Siege: 60 })).toBe(2);
    expect(counterPerkBonus(2, "defence", undefined)).toBe(0);
    const rng = { random: () => 1 };
    const plain = attackPower(fighter({ classCode: 1 }), rng).power;
    expect(attackPower(fighter({ classCode: 1, counters: { Siege: 30 } }), rng).power).toBe(
      plain + 6,
    );
    expect(factionRows(20, fighter({ counters: { Siege: 50 } }))).toBe(18);
  });
});

describe("/counter", () => {
  test("lists, sets inside the bounds, resets, and says what is wrong", () => {
    expect(counterCommand("")).toEqual({ kind: "list" });
    expect(counterCommand("fire 140")).toMatchObject({ kind: "set", value: 100 });
    expect(counterCommand("Wind -3")).toMatchObject({ kind: "set", value: 0 });
    expect(counterCommand("Water reset")).toMatchObject({ kind: "set", value: 25 });
    expect(counterCommand("Fire")).toEqual({
      kind: "error",
      text: "Usage: /counter, /counter <name> <number> or /counter <name> reset",
    });
    expect(counterCommand("Fire lots")).toMatchObject({ kind: "error" });
    expect(counterCommand("Ice 3")).toEqual({
      kind: "error",
      text: "There is no counter called Ice.",
    });
  });
});
