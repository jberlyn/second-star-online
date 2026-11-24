/**
 * Issue #30, stage 0: the item resolver (shared `resolveItem`) says what an item plays now, from
 * the name tables. Its round trip: for every Classic catalogue item, a world whose item tables hold
 * only the rows the resolver found for it, each rewritten to name that item exactly, must play the
 * item exactly as Classic does (slot, Strength, menu, use, behaviours, armour, gear, attack power,
 * weapon skills, breaking). That is the premise of the item editor's definitions (#30 stage 2):
 * an item's rules, written as exact rows, decide what the shared tables decided.
 */
import { afterAll, describe, expect, test } from "bun:test";

import { classicData } from "@secondstaronline/data/classic";
import {
  buildContentStore,
  type ContentData,
  content,
  exactRowsFor,
  installContent,
  isItemTable,
  nameTables,
  resolveItem,
  weaponSkillList,
} from "@secondstaronline/shared";

import { plays } from "./helpers/item-plays.ts";

const classic = content();
afterAll(() => installContent(classic));

type Obj = Record<string, unknown>;

/**
 * Classic with every item table holding only the resolver's answer for `name`, as exact rows
 * (shared `exactRowsFor`): nothing of the original tables is left, so a row the resolver misses is
 * missing from the world too. A single name test the item does not pass names nothing.
 */
function worldFor(name: string): ContentData {
  const classicD = classicData as unknown as Partial<ContentData>;
  const rows = exactRowsFor(name, resolveItem(name, classicD));
  const d = structuredClone(classicData) as unknown as Record<string, Obj>;
  const keys = [...nameTables(classicD).keys()].filter(isItemTable);
  for (const key of keys) {
    const [ds, path] = key.split(" ") as [string, string];
    if (path.includes("[]")) {
      throw new Error(`item table inside a list: ${key}`);
    }
    const parts = path.split(".");
    let o = d[ds] as Obj;
    for (const part of parts.slice(0, -1)) {
      o = o[part] as Obj;
    }
    const last = parts.at(-1) as string;
    const mine = rows.get(key) ?? [];
    o[last] = Array.isArray(o[last])
      ? mine
      : (mine[0] ?? { match: "exact", pattern: "\u0000 names nothing" });
  }
  for (const key of rows.keys()) {
    expect(keys).toContain(key);
  }
  return d as unknown as ContentData;
}

describe("the item resolver (#30 stage 0)", () => {
  const names = classicData.items.items.map((i) => i.name);

  test("finds the rows an item plays, and which decide", () => {
    const sword = resolveItem("Long Sword");
    const slots = sword.find((h) => h.key === "itemRules equip.slots");
    expect(slots?.info.wins).toBe("last");
    expect(slots?.deciding.map((r) => r.raw.slot)).toEqual(["LeftHand"]);
    const base = sword.find((h) => h.key === "attPower attPower.base");
    expect(base?.deciding.map((r) => r.pattern)).toEqual(["Long Sword"]);
    // An exact weapon block also covers its masterworks, as combat reads it.
    const blocks = resolveItem("Sword of Hope +1").find(
      (h) => h.key === "attPower attPower.skillBlocks",
    );
    expect(blocks?.rows.map((r) => `${r.match} ${r.pattern}`)).toContain("exact Sword of Hope");
    // A block with no weapon test applies to every weapon, so even an unknown name has it.
    expect(resolveItem("No Such Thing At All").map((h) => h.key)).toEqual([
      "attPower attPower.skillBlocks",
    ]);
  });

  test("every Classic item plays the same from only its own rows, written for it", () => {
    let checked = 0;
    // Names the game meets at run time too: a +N weapon, a masterwork, a carried container's #id
    // and an engine fixture (which no behaviour row ever names).
    const runtime = ["Long Sword+3", "Knight's Sword +1", "Gold Axe+2", "Crate#12", "Bob's Door"];
    for (const name of [...names, ...runtime]) {
      installContent(classic);
      const before = plays(name);
      const rows = exactRowsFor(name, resolveItem(name));
      installContent(buildContentStore(worldFor(name)));
      try {
        expect({ name, ...plays(name) }).toEqual({ name, ...before });
        // Resolving the item again in its own world gives the same exact rows: they are stable.
        expect(Object.fromEntries(exactRowsFor(name, resolveItem(name)))).toEqual(
          Object.fromEntries(rows),
        );
      } finally {
        installContent(classic);
      }
      checked++;
    }
    expect(checked).toBe(names.length + runtime.length);
  });
});

describe("the item resolver reads each table as the game does", () => {
  const classicD = classicData as unknown as Partial<ContentData>;
  const hit = (name: string, key: string, d: Partial<ContentData> = classicD) =>
    resolveItem(name, d).find((h) => h.key === key);
  const withRules = (patch: (r: ContentData["itemRules"]) => void): Partial<ContentData> => {
    const itemRules = structuredClone(classicData.itemRules);
    patch(itemRules);
    return { ...classicD, itemRules };
  };

  test("a weapon's trained skills and its place on the break list", () => {
    expect(
      hit("Long Sword", "classes skillGain.weaponSkills")?.deciding.map((r) => r.raw.skills),
    ).toEqual([weaponSkillList("Long Sword")]);
    expect(weaponSkillList("Long Sword").length).toBeGreaterThan(0);
    expect(hit("Long Sword", "itemRules breaks.weapon.items")?.rows.map((r) => r.pattern)).toEqual([
      "Long Sword",
    ]);
    expect(hit("Plate Helm", "itemRules breaks.armour.items")?.rows.map((r) => r.raw.slot)).toEqual(
      ["HeadE"],
    );
  });

  test("skill blocks: the every-weapon block, and only the tiers whose weapon test passes", () => {
    const blocks = hit("Long Sword", "attPower attPower.skillBlocks");
    expect(blocks?.rows.some((r) => r.match === "any")).toBe(true);
    const knifeOnly = {
      ...classicD,
      attPower: {
        attPower: {
          ...classicData.attPower.attPower,
          skillBlocks: [
            {
              weaponMatch: "exact" as const,
              pattern: "Knife",
              tiers: [
                {
                  subWeapon: { match: "exact" as const, pattern: "Long Sword" },
                  when: null,
                  op: "add" as const,
                  value: 50,
                },
              ],
            },
            {
              weaponMatch: "contains" as const,
              pattern: "Sword",
              tiers: [
                {
                  subWeapon: { match: "exact" as const, pattern: "Broad Sword" },
                  when: null,
                  op: "add" as const,
                  value: 7,
                },
                { subWeapon: null, when: null, op: "add" as const, value: 2 },
              ],
            },
          ],
        },
      },
    };
    const mine = hit("Long Sword", "attPower attPower.skillBlocks", knifeOnly);
    expect(mine?.rows.map((r) => r.raw.tiers)).toEqual([
      [{ subWeapon: null, when: null, op: "add", value: 2 }],
    ]);
    // No answer of its own for the tier's weapon test: it is part of its block's.
    expect(resolveItem("Long Sword", knifeOnly).some((h) => h.key.includes("subWeapon"))).toBe(
      false,
    );
  });

  test("every base roll that draws is kept, in order (the Gold Axe draws its Axe roll first)", () => {
    const base = hit("Gold Axe", "attPower attPower.base");
    expect(base?.deciding.map((r) => r.pattern)).toEqual(["Axe", "Gold Axe"]);
  });

  test("requirements and the paperdoll test the name without its +N, overrides by exact name", () => {
    const needs = withRules((r) => {
      r.requires = [
        { match: "exact", pattern: "Long Sword", on: "equip", needs: "level", atLeast: 5 },
      ] as ContentData["itemRules"]["requires"];
    });
    expect(hit("Long Sword+3", "itemRules requires", needs)?.rows.length).toBe(1);
    expect(
      hit("Sword of Hope +1", "itemRules paperdoll.aliases")?.deciding.map((r) => r.raw.becomes),
    ).toEqual(["Broad Sword"]);
    const containsOverride = {
      ...classicD,
      attPower: {
        attPower: {
          ...classicData.attPower.attPower,
          exactOverrides: [{ match: "contains" as const, pattern: "Sword", flat: 1, randomN: 0 }],
        },
      },
    };
    expect(hit("Long Sword", "attPower attPower.exactOverrides", containsOverride)).toBeUndefined();
    expect(hit("Sword", "attPower attPower.exactOverrides", containsOverride)?.rows.length).toBe(1);
  });

  test("swing cooldowns decide per worn slot", () => {
    const two = withRules((r) => {
      r.swing.cooldowns = [
        { slot: "weapon", match: "exact", pattern: "Long Sword", atDelay: 10, actionDelay: 10 },
        { slot: "ring", match: "exact", pattern: "Long Sword", atDelay: 2, actionDelay: 2 },
      ] as ContentData["itemRules"]["swing"]["cooldowns"];
    });
    expect(
      hit("Long Sword", "itemRules swing.cooldowns", two)?.deciding.map((r) => r.raw.slot),
    ).toEqual(["weapon", "ring"]);
  });

  test("a book's read lines are no meal line; exact rows keep a shared counter and a tip's text", () => {
    expect(hit("Firebolt Book", "itemRules use.messages")).toBeUndefined();
    const axe = exactRowsFor("Gold Axe", resolveItem("Gold Axe", classicD)).get("itemRules tools");
    expect(axe?.find((r) => r.can === "Chop")).toMatchObject({
      match: "exact",
      pattern: "Gold Axe",
      counter: "Axe",
    });
    const door = "Bob's Opened Door";
    const tip = exactRowsFor(door, resolveItem(door, classicD)).get("itemRules ground.tipNames");
    expect(tip).toEqual([{ match: "exact", pattern: door, name: "Bob's Door" }]);
  });

  test("masterworks come from the data given, with no store needed", () => {
    const noMasterworks = {
      ...classicD,
      craft: { ...classicData.craft, stations: {} },
    } as Partial<ContentData>;
    const block = (d: Partial<ContentData>) =>
      hit("Sword of Hope +1", "attPower attPower.skillBlocks", d)?.rows.map((r) => r.pattern);
    expect(block(classicD)).toContain("Sword of Hope");
    expect(block(noMasterworks)).not.toContain("Sword of Hope");
  });
});
