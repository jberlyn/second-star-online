import { afterEach, describe, expect, test } from "bun:test";

import { classicData } from "@secondstaronline/data/classic";

import {
  BJ_MAX_BID,
  bagPicture,
  buildContentStore,
  type ContentData,
  content,
  displayName,
  EDITOR_ITEMS,
  groundMember,
  groundTipName,
  installContent,
  itemLabel,
  itemSprite,
  monsterLabel,
  onContent,
  resolveNpcItemNames,
  skillIndex,
  tileName,
  WALK_WHITELIST,
} from "../src/index.ts";

const classic = buildContentStore(classicData as ContentData);

afterEach(() => installContent(classic));

/** Classic with one change, as a publish would build it. */
function changed(fn: (d: ContentData) => void): ContentData {
  const d = structuredClone(classicData) as ContentData;
  fn(d);
  return d;
}

describe("the content store holder", () => {
  test("a store swaps in one step, and every rebuilt value follows it", () => {
    const next = changed((d) => {
      d.casino.blackjack.maxBid = 5;
      d.tiles.walkable.push({ code: "Z9" } as never);
      d.items.editorItems.push("Moonblade");
      d.classes.skills.push({ index: 99, skill: "Swimming" });
      const first = d.tiles.catalogue[0] as { code: string; name?: string };
      first.name = "Renamed tile";
    });
    installContent(buildContentStore(next, "abc"));
    expect(content().hash).toBe("abc");
    expect(BJ_MAX_BID).toBe(5);
    expect(WALK_WHITELIST).toContain("Z9\r");
    expect(EDITOR_ITEMS.at(-1)).toBe("Moonblade");
    expect(skillIndex("Swimming")).toBe(98);
    expect(tileName(classicData.tiles.catalogue[0]?.code as string)).toBe("Renamed tile");
    installContent(classic);
    expect(BJ_MAX_BID).toBe(classicData.casino.blackjack.maxBid);
    expect(EDITOR_ITEMS).not.toContain("Moonblade");
  });

  test("callbacks run now when a store is installed, then on every install, in order", () => {
    const seen: string[] = [];
    onContent((s) => seen.push(`a:${s.hash}`));
    onContent((s) => seen.push(`b:${s.hash}`));
    installContent(buildContentStore(classicData as ContentData, "x"));
    expect(seen).toEqual(["a:", "b:", "a:x", "b:x"]);
  });

  test("the store finds items and monsters by name, ignoring case", () => {
    expect(content().item("ale")?.name).toBe("Ale");
    expect(
      content().monster(classicData.monsters.monsters[0]?.name.toUpperCase() as string),
    ).toBeDefined();
    expect(content().item("no such item")).toBeUndefined();
  });
});

describe("renamed items", () => {
  /** Classic with Long Sword shown as "Longblade", drawn with Knife's art. */
  const renamed = () =>
    buildContentStore(
      changed((d) => {
        const sword = d.items.items.find(
          (i) => i.name === "Long Sword",
        ) as (typeof d.items.items)[0];
        sword.display = "Longblade";
        sword.sprite = "Knife";
      }),
    );

  test("players see the display name, keeping a stored name's count, id and level", () => {
    installContent(renamed());
    expect(itemLabel("Long Sword")).toBe("Longblade");
    expect(itemLabel("long sword")).toBe("Longblade");
    expect(itemLabel("Long Sword+3")).toBe("Longblade+3");
    expect(itemLabel("2 Long Sword")).toBe("2 Longblade");
    expect(itemLabel("Ale")).toBe("Ale");
    expect(groundTipName("Long Sword")).toBe("Longblade");
    expect(groundTipName("Long Sword+2")).toBe("Longblade+2");
    // Rules and logs still go by the key.
    expect(displayName("Long Sword")).toBe("Long Sword");
  });

  test("the art follows the sprite key, not the name", () => {
    installContent(renamed());
    expect(itemSprite("Long Sword")).toBe("Knife");
    expect(bagPicture("Long Sword")).toBe("Knife");
    expect(groundMember("Long Sword")).toBe("Knife");
    installContent(classic);
    expect(bagPicture("Long Sword")).toBe("Long Sword");
    // The Cannonball's added icon is its sprite key (issue #2).
    expect(bagPicture("Cannonball")).toBe("CannonballBag");
  });

  test("text an operator writes resolves a display name to the key when saved", () => {
    installContent(renamed());
    expect(content().itemNamed("longblade")?.name).toBe("Long Sword");
    expect(content().itemNamed("Long Sword")?.name).toBe("Long Sword");
    expect(
      resolveNpcItemNames([
        "SEL|Longblade:100:5",
        "BUY|longblade:50",
        "INV|2 Longblade:10",
        "BIO|Longblade",
      ]),
    ).toEqual([
      "SEL|Long Sword:100:5",
      "BUY|Long Sword:50",
      "INV|2 Long Sword:10",
      "BIO|Longblade",
    ]);
  });
});

describe("renamed monsters", () => {
  test("players see a species' display name", () => {
    const first = classicData.monsters.monsters[0]?.name as string;
    installContent(
      buildContentStore(
        changed((d) => {
          (d.monsters.monsters[0] as { display?: string }).display = "Gloomrat";
        }),
      ),
    );
    expect(monsterLabel(first)).toBe("Gloomrat");
    expect(monsterLabel("Nobody")).toBe("Nobody");
  });
});
