/**
 * Gear only some classes may equip (`item-rules.json` `equip.classes`, an item definition's
 * `classes`): one or more class codes, the last matching row deciding, a masterwork counting as
 * its item. Classic has none, so every class wears everything, as in 1.6.
 */
import { afterEach, describe, expect, test } from "bun:test";

import { classicData } from "@secondstaronline/data/classic";

import { buildContentStore, type ContentData, installContent } from "../../src/content/store.ts";
import { NO_EQUIPMENT } from "../../src/rules/core/fighter.ts";
import {
  checkEquip,
  classesText,
  EQUIP_TEXT,
  equipClasses,
} from "../../src/rules/inventory/equip.ts";

// Classic's classes: 1 Fighter, 2 Mage, 3 Ranger.
const FIGHTER = 1;
const MAGE = 2;
const RANGER = 3;

function install(more: (d: ContentData) => void): void {
  const d = structuredClone(classicData) as ContentData;
  more(d);
  installContent(buildContentStore(d));
}

afterEach(() => installContent(buildContentStore(classicData as ContentData)));

const who = (classCode: number, str = 99) => ({
  classCode,
  str,
  wanted: false,
  equip: NO_EQUIPMENT,
  level: 1,
  skills: [],
});

describe("gear only some classes may equip", () => {
  test("Classic limits no gear to a class", () => {
    expect(classicData.itemRules.equip.classes).toBeUndefined();
    expect(equipClasses("Leather Armor")).toBeNull();
    expect(checkEquip("Leather Armor", who(MAGE))).toEqual({ ok: true, slot: "Body" });
  });

  test("a listed class may equip it; any other is told which classes may", () => {
    install((d) => {
      d.itemRules.equip.classes = [
        { match: "exact", pattern: "Leather Armor", classes: [RANGER, FIGHTER] },
      ];
    });
    expect(checkEquip("Leather Armor", who(RANGER))).toEqual({ ok: true, slot: "Body" });
    expect(checkEquip("Leather Armor", who(FIGHTER))).toEqual({ ok: true, slot: "Body" });
    expect(checkEquip("Leather Armor", who(MAGE))).toEqual({
      ok: false,
      text: "Only a Ranger or a Fighter can equip this.",
    });
  });

  test("a masterwork, or a copy with an #id, counts as its item", () => {
    install((d) => {
      d.itemRules.equip.classes = [{ match: "exact", pattern: "Leather Armor", classes: [RANGER] }];
    });
    expect(equipClasses("Leather Armor +1")).toEqual([RANGER]);
    expect(checkEquip("Leather Armor +1", who(MAGE))).toEqual({
      ok: false,
      text: "Only a Ranger can equip this.",
    });
  });

  test("the last matching row decides", () => {
    install((d) => {
      d.itemRules.equip.classes = [
        { match: "contains", pattern: "Leather", classes: [RANGER] },
        { match: "exact", pattern: "Leather Cap", classes: [MAGE, RANGER] },
      ];
    });
    expect(equipClasses("Leather Boots")).toEqual([RANGER]);
    expect(equipClasses("Leather Cap")).toEqual([MAGE, RANGER]);
  });

  test("1.6's own gates come first: too weak is said before the class", () => {
    install((d) => {
      d.itemRules.equip.classes = [{ match: "exact", pattern: "Plate Armor", classes: [FIGHTER] }];
    });
    expect(checkEquip("Plate Armor", who(MAGE, 0))).toEqual({ ok: false, text: EQUIP_TEXT.weak });
    expect(checkEquip("Plate Armor", who(MAGE)).ok).toBe(false);
  });

  test("an item's definition sets its classes", () => {
    install((d) => {
      d.items.definitions = [
        ...(d.items.definitions ?? []),
        { name: "Leather Cap", slot: "Head", classes: [MAGE] },
      ];
    });
    expect(equipClasses("Leather Cap")).toEqual([MAGE]);
    expect(checkEquip("Leather Cap", who(RANGER)).ok).toBe(false);
    expect(checkEquip("Leather Cap", who(MAGE)).ok).toBe(true);
  });

  test("the refusal names the classes with their articles", () => {
    expect(classesText([MAGE])).toBe("Only a Mage can equip this.");
    expect(classesText([FIGHTER, MAGE, RANGER])).toBe(
      "Only a Fighter, a Mage or a Ranger can equip this.",
    );
    expect(classesText([99])).toBe("Only a class 99 can equip this.");
  });
});
