/**
 * Client: the item menu's Cook, Mix, Build, Smith and Storage send their intents, the key lock
 * stops the bag, and Smith's two sounds play.
 */
import { describe, expect, test } from "bun:test";

import type { AssetIndex } from "@secondstaronline/data";
import { emptyBag, NO_EQUIPMENT } from "@secondstaronline/shared";

import type { Assets } from "../src/assets.ts";
import { spellSounds } from "../src/sfx.ts";
import { createPanel } from "../src/ui/panel.ts";

const fakeAssets: Assets = {
  index: { version: 1, inputHash: "", atlases: {} as AssetIndex["atlases"], ui: {}, sounds: {} },
  sheets: {},
  loadGroup: async () => {},
  sprite: () => undefined,
  ui: (cast, member) => `/assets/ui/${cast}-${member}.png`,
  hash: null,
  reload: async () => [],
  onReload: () => {},
};

function panelWith(items: string[], locked = false) {
  const sent: string[] = [];
  const panel = createPanel(fakeAssets, {
    use: (s) => sent.push(`use ${s}`),
    equip: (s) => sent.push(`equip ${s}`),
    drop: (s) => sent.push(`drop ${s}`),
    give: (s) => sent.push(`give ${s}`),
    craft: (s) => sent.push(`craft ${s}`),
    storage: (s) => sent.push(`storage ${s}`),
    unequip: (s) => sent.push(`unequip ${s}`),
    crystals: () => {},
    oneCrystal: () => {},
    stack: () => {},
    arrange: () => {},
    gold: () => {},
    sound: () => {},
    canModify: () => true,
    slotClicked: () => !locked,
    say: () => {},
  });
  const bag = emptyBag();
  items.forEach((item, i) => {
    bag[i] = { item, qty: 1 };
  });
  panel.setInventory({ gold: 0, bag, equip: { ...NO_EQUIPMENT } }, 1);
  return { panel, sent };
}

describe("the crafting buttons", () => {
  test("Cook, Mix, Build and Smith send craft; Storage sends storage; each names its action", () => {
    const items = ["Trout", "Potion Bottle", "Logs", "Damaged Sword, Long", "Crate#4"];
    const { panel, sent } = panelWith(items);
    const slots = panel.el.querySelectorAll<HTMLButtonElement>(".bag-slot");
    const cases: [number, string, string][] = [
      [0, "Cook", "inventory-cook"],
      [1, "Mix", "inventory-mix"],
      [2, "Build", "inventory-build"],
      [3, "Smith", "inventory-smith"],
      [4, "Storage", "inventory-storage"],
    ];
    for (const [slot, label, action] of cases) {
      slots[slot]?.click();
      const b = panel.menu.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);
      expect(b?.dataset.action).toBe(action);
      b?.click();
    }
    expect(sent).toEqual(["craft 1", "craft 2", "craft 3", "craft 4", "storage 5"]);
  });

  test("while a craft holds the key lock the bag ignores clicks", () => {
    const { panel, sent } = panelWith(["Logs"], true);
    panel.el.querySelector<HTMLButtonElement>(".bag-slot")?.click();
    expect(panel.menu.hidden).toBe(true);
    expect(sent).toEqual([]);
  });
});

describe("the smith's FX sounds", () => {
  test("BSmith plays Swordhit2 on random(2) = 1, else Swordhit1, on channel 4", () => {
    expect(spellSounds("BSmith", () => 1)).toContainEqual({ name: "Swordhit2", ch: 4 });
    expect(spellSounds("BSmith", () => 2)).toContainEqual({ name: "Swordhit1", ch: 4 });
  });
});
