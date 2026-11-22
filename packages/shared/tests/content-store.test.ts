import { afterEach, describe, expect, test } from "bun:test";

import { classicData } from "@secondstaronline/data/classic";

import {
  BJ_MAX_BID,
  buildContentStore,
  type ContentData,
  content,
  EDITOR_ITEMS,
  installContent,
  onContent,
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
