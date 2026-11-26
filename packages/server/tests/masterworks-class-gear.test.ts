/**
 * Masterworks for every craft and gear only some classes may equip, at the server: the publish
 * checks, the references a removal cleans up, the equip intent and the character editor. Classic
 * has neither, so none of it reaches it.
 */
import { afterEach, describe, expect, test } from "bun:test";

import { classicData } from "@secondstaronline/data/classic";
import {
  buildContentStore,
  type ContentData,
  deriveEdit,
  type EditableCharacter,
  installContent,
  type ServerMsg,
  wearBreaks,
} from "@secondstaronline/shared";

import {
  brokenReferences,
  classGearProblems,
  masterworkProblems,
  schemaProblems,
} from "../src/content/validate.ts";
import { equipIntent, type ItemCtx } from "../src/systems/inventory/items.ts";
import { addPlayer, createWorld, type Room, type World } from "../src/systems/world/world.ts";
import { player, rngByN, testMap } from "./helpers/sim.ts";

const FIGHTER = 1;
const RANGER = 3;

const data = (more: (d: ContentData) => void): ContentData => {
  const d = structuredClone(classicData) as ContentData;
  more(d);
  return d;
};

afterEach(() => installContent(buildContentStore(classicData as ContentData)));

describe("masterworks: the publish checks", () => {
  test("Classic has none and passes", () => {
    expect(masterworkProblems(classicData as ContentData)).toEqual([]);
  });

  test("a masterwork is made from one item, across both tables; a masterwork is never a base", () => {
    const d = data((d) => {
      d.craft.masterworks = [
        {
          item: "Leather Armor",
          odds: [{ level: 0, percent: 5 }],
          results: [{ item: "Plate Armor +1", weight: 1 }],
        },
        {
          item: "Plate Armor +2",
          odds: [{ level: 0, percent: 5 }],
          results: [{ item: "Leather Cap", weight: 1 }],
        },
      ];
    });
    expect(masterworkProblems(d).map((p) => p.message)).toEqual([
      "Plate Armor +1 is already the masterwork of Plate Armor: a masterwork is made from one item",
      "Plate Armor +2 is itself a masterwork of Plate Armor: give the masterworks to Plate Armor",
    ]);
  });

  test("a masterwork row is refused for an item, or a masterwork, the catalogue lacks", () => {
    const d = data((d) => {
      d.craft.masterworks = [
        {
          item: "Leather Armor",
          odds: [{ level: 0, percent: 5 }],
          results: [{ item: "Leather Armor +9", weight: 1 }],
        },
      ];
    });
    const broken = brokenReferences(d).filter((r) => r.where.startsWith("craft/masterworks"));
    expect(broken.map((r) => r.name)).toEqual(["Leather Armor +9"]);
  });

  test("the schema refuses a masterwork that is its own item", () => {
    const d = data((d) => {
      d.craft.masterworks = [
        {
          item: "Leather Armor",
          odds: [{ level: 0, percent: 5 }],
          results: [{ item: "leather armor", weight: 1 }],
        },
      ];
    });
    const problems = schemaProblems(d);
    expect(problems.map((p) => p.message).join("\n")).toContain(
      "a masterwork must be a different item from the one it is made from",
    );
  });
});

describe("class gear: the publish checks", () => {
  test("every listed class must be a class, in a rule row or an item's definition", () => {
    expect(classGearProblems(classicData as ContentData)).toEqual([]);
    const d = data((d) => {
      d.itemRules.equip.classes = [
        { match: "exact", pattern: "Leather Armor", classes: [RANGER, 42] },
      ];
      d.items.definitions = [
        ...(d.items.definitions ?? []),
        { name: "Leather Cap", slot: "Head", classes: [77] },
      ];
    });
    expect(classGearProblems(d)).toEqual([
      {
        where: "itemRules/equip/classes/1 (Leather Armor)",
        message:
          "class 42 is not a class: pick the classes that may equip it from the Classes tab's list",
      },
      {
        where: "items/definitions/Leather Cap",
        message:
          "class 77 is not a class: pick the classes that may equip it from the Classes tab's list",
      },
    ]);
  });
});

describe("class gear in play", () => {
  type Out = { to: string; msg: ServerMsg }[];
  const chat = (out: Out, to: string) =>
    out.flatMap((m) => (m.to === to && m.msg.t === "chat" ? [m.msg.text] : []));

  test("Equip refuses a class the gear does not list, and keeps it in the bag", () => {
    installContent(
      buildContentStore(
        data((d) => {
          d.itemRules.equip.classes = [
            { match: "exact", pattern: "Leather Armor", classes: [RANGER] },
          ];
        }),
      ),
    );
    const map = testMap("x1000y992");
    const world: World = createWorld();
    const ctx = (): ItemCtx => ({ world, rng: rngByN(), now: 1_000_000 });
    const p = player("A", map, 5, 5);
    addPlayer(world, p);
    p.loading = 0;
    const room = world.rooms.get(map.name) as Room;
    p.char.classCode = FIGHTER;
    p.char.bag[0] = { item: "Leather Armor +1", qty: 1 };
    expect(chat(equipIntent(ctx(), room, p, 1), "A")).toEqual(["Only a Ranger can equip this."]);
    expect(p.char.bag[0]).toEqual({ item: "Leather Armor +1", qty: 1 });
    p.char.classCode = RANGER;
    equipIntent(ctx(), room, p, 1);
    expect(p.char.equip.body).toBe("Leather Armor +1");
  });

  test("the character editor refuses putting class gear on another class", () => {
    installContent(
      buildContentStore(
        data((d) => {
          d.itemRules.equip.classes = [
            { match: "exact", pattern: "Leather Armor", classes: [RANGER] },
          ];
        }),
      ),
    );
    const b: EditableCharacter = {
      classCode: FIGHTER,
      level: 5,
      exp: 10,
      expNeeded: 410,
      hp: 20,
      hpMax: 24,
      sp: 20,
      spMax: 24,
      str: 10,
      sta: 10,
      dex: 10,
      int: 10,
      wis: 10,
      skills: {},
      hunger: 30000,
      faction: null,
      factionCount: 0,
      wanted: false,
      respawn: { map: "x1000y992", x: 5, y: 5 },
      gold: 100,
      bank: null,
      bag: Array.from({ length: 15 }, () => null),
      equip: {
        weapon: "NOTHING",
        offHand: "NOTHING",
        head: "NOTHING",
        body: "NOTHING",
        feet: "NOTHING",
        ring: "NOTHING",
      },
      vault: [],
      spellbook: [],
      position: { map: "x1000y992", x: 5, y: 5 },
      sex: 1,
      head: 1,
    };
    const onBody = { equip: { ...b.equip, body: "Leather Armor" } };
    expect(wearBreaks(b, deriveEdit(b, onBody), 99)).toEqual([
      "Leather Armor: Only a Ranger can equip this.",
    ]);
    const ranger = { ...b, classCode: RANGER };
    expect(wearBreaks(ranger, deriveEdit(ranger, onBody), 99)).toEqual([]);
  });
});
