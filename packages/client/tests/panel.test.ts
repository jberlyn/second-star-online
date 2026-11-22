/**
 * Client tests: the right panel, the crystal dialog, ground items and looks in the model,
 * and Ctrl.
 */
import { describe, expect, test } from "bun:test";

import { type AssetIndex, classesData, TAB_ART, TAB_ROW_Y } from "@secondstaronline/data";
import { type EquipView, emptyBag, NO_EQUIPMENT } from "@secondstaronline/shared";

import type { Assets } from "../src/assets.ts";
import { createInputState, keyDown } from "../src/input.ts";
import { applyDelta, createModel } from "../src/model.ts";
import type { Sfx } from "../src/sfx.ts";
import {
  createAmountDialog,
  crystalTitle,
  GOLD_TITLE,
  parseAmount,
  stackTitle,
} from "../src/ui/amount.ts";
import { createHoverTips } from "../src/ui/hovertip.ts";
import { createPanel } from "../src/ui/panel.ts";

const fakeAssets: Assets = {
  index: { version: 1, inputHash: "", atlases: {} as AssetIndex["atlases"], ui: {}, sounds: {} },
  sheets: {},
  loadGroup: async () => {},
  sprite: () => undefined,
  ui: (cast, member) => `/assets/ui/${cast}-${member}.png`,
};

function panelWith(
  bag: { item: string; qty: number }[],
  opts: { locked?: () => boolean; equip?: Partial<EquipView> } = {},
) {
  const sent: string[] = [];
  const sounds: Sfx[] = [];
  const panel = createPanel(fakeAssets, {
    use: (s) => sent.push(`use ${s}`),
    equip: (s) => sent.push(`equip ${s}`),
    drop: (s) => sent.push(`drop ${s}`),
    give: (s) => sent.push(`give ${s}`),
    unequip: (s) => sent.push(`unequip ${s}`),
    crystals: (s, c) => sent.push(`crystals ${s} ${c}`),
    oneCrystal: (s, mode) => sent.push(`oneCrystal ${s} ${mode}`),
    stack: (s, name, mode) => sent.push(`stack ${s} ${name} ${mode}`),
    arrange: (from, to) => sent.push(`arrange ${from} ${to}`),
    gold: () => sent.push("gold"),
    sound: (x) => sounds.push(x),
    canModify: () => !(opts.locked?.() ?? false),
    say: () => {},
  });
  const b = emptyBag();
  bag.forEach((l, i) => {
    b[i] = l;
  });
  const equip = { ...NO_EQUIPMENT, weapon: "Knife", ...opts.equip };
  panel.setInventory({ gold: 12, bag: b, equip }, 1);
  return { panel, sent, sounds };
}

describe("the right panel (frames 50-65)", () => {
  test("15 bag slots; the quantity shows only above 1", () => {
    const { panel } = panelWith([
      { item: "Apple", qty: 2 },
      { item: "Knife", qty: 1 },
    ]);
    expect(panel.el.querySelectorAll(".bag-slot")).toHaveLength(15);
    expect([...panel.el.querySelectorAll(".qty")].map((q) => q.textContent)).toEqual(["2"]);
    expect(panel.el.querySelector(".gold-amount")?.textContent).toBe("12");
  });
  test("the tabs switch pages; Stats is first", () => {
    const { panel } = panelWith([]);
    expect(panel.tab).toBe("stats");
    const inv = panel.el.querySelector<HTMLButtonElement>('[aria-label="Inventory"]');
    inv?.click();
    expect(panel.tab).toBe("inventory");
    expect(panel.el.querySelector<HTMLElement>(".page-inventory")?.hidden).toBe(false);
    expect(panel.el.querySelector<HTMLElement>(".page-stats")?.hidden).toBe(true);
  });
  test("design change: hovering a tab or a bag item shows its name in a purple box below the pointer", () => {
    const { panel } = panelWith([
      { item: "Apple", qty: 2 },
      { item: "Knife", qty: 1 },
    ]);
    const tip = panel.tips.el;
    expect(tip.hidden).toBe(true);
    // The box is framed by the item menu's own background, Inventory #50.
    expect(tip.style.borderImageSource).toContain("/assets/ui/inventory-50.png");
    const hover = (el: Element | null, x: number, y: number) =>
      el?.dispatchEvent(
        new PointerEvent("pointermove", { pointerType: "mouse", clientX: x, clientY: y }),
      );
    const leave = (el: Element | null) =>
      el?.dispatchEvent(new PointerEvent("pointerleave", { pointerType: "mouse" }));
    const names: string[] = [];
    for (const tab of TAB_ART) {
      const b = panel.el.querySelector(`[data-action="panel-tab-${tab.tab}"]`);
      hover(b, tab.x, 34);
      names.push(tip.textContent ?? "");
      // Its top-left corner sits level with the pointer, just below the arrow.
      expect([tip.style.left, tip.style.top]).toEqual([`${tab.x}px`, "54px"]);
      leave(b);
      expect(tip.hidden).toBe(true);
    }
    const slots = panel.el.querySelectorAll(".bag-slot");
    hover(slots[0] ?? null, 617, 137);
    names.push(tip.textContent ?? "");
    // It follows the pointer.
    hover(slots[0] ?? null, 620, 140);
    expect([tip.style.left, tip.style.top]).toEqual(["620px", "160px"]);
    hover(slots[1] ?? null, 654, 137);
    names.push(tip.textContent ?? "");
    leave(slots[1] ?? null);
    // An empty slot names nothing.
    hover(slots[2] ?? null, 691, 137);
    expect(tip.hidden).toBe(true);
    expect(names).toEqual(["Stats", "Inventory", "Skills", "Spellbook", "Apple (2)", "Knife"]);
  });
  test("design change: a touch shows no tip, and a press, the item menu or a drag hides it", () => {
    const { panel } = panelWith([{ item: "Apple", qty: 2 }]);
    // The drag ends on the document's pointer-up, as in the game.
    document.body.append(panel.el, panel.menuLayer);
    const tip = panel.tips.el;
    const slot = panel.el.querySelector(".bag-slot");
    const ev = (type: string, pointerType = "mouse") =>
      slot?.dispatchEvent(
        new PointerEvent(type, {
          pointerType,
          pointerId: 1,
          button: 0,
          clientX: 617,
          clientY: 137,
          bubbles: true,
        }),
      );
    ev("pointermove", "touch");
    expect(tip.hidden).toBe(true);
    ev("pointermove");
    expect(tip.hidden).toBe(false);
    // A press may start a drag: no tip until it ends.
    ev("pointerdown");
    expect(tip.hidden).toBe(true);
    ev("pointermove");
    expect(tip.hidden).toBe(true);
    ev("pointerup");
    // The click opens the item menu, which sits at the pointer: no tip while it is up.
    slot?.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 617, clientY: 137 }));
    expect(panel.menu.hidden).toBe(false);
    ev("pointermove");
    expect(tip.hidden).toBe(true);
    panel.menu.hidden = true;
    ev("pointermove");
    expect(tip.hidden).toBe(false);
    panel.el.remove();
    panel.menuLayer.remove();
  });
  test("design change: a worn item names itself in its equipment box; an empty box names nothing", () => {
    // panelWith wields a Knife (the LeftHand box, stage [626, 318] to [661, 353]).
    const { panel } = panelWith([]);
    document.body.append(panel.el, panel.menuLayer);
    panel.setTab("inventory");
    const tip = panel.tips.el;
    // happy-dom does no layout: panel-local coordinates are client coordinates.
    const move = (stageX: number, stageY: number, pointerType = "mouse") =>
      panel.el.dispatchEvent(
        new PointerEvent("pointermove", {
          pointerType,
          clientX: stageX - 566,
          clientY: stageY,
          bubbles: true,
        }),
      );
    move(643, 335, "touch");
    expect(tip.hidden).toBe(true);
    move(643, 335);
    expect([tip.hidden, tip.textContent]).toEqual([false, "Knife"]);
    // The Head box above it is empty.
    move(643, 297);
    expect(tip.hidden).toBe(true);
    move(643, 335);
    // Another tab hides the boxes.
    panel.setTab("stats");
    move(643, 335);
    expect(tip.hidden).toBe(true);
    panel.el.remove();
    panel.menuLayer.remove();
  });
  test("design change: the tip stays on the stage, sliding left at the right edge and flipping up at the bottom", () => {
    const layer = document.createElement("div");
    const tips = createHoverTips(layer, "/frame.png");
    // happy-dom does no layout: give the box a size.
    Object.defineProperty(tips.el, "offsetWidth", { value: 60 });
    Object.defineProperty(tips.el, "offsetHeight", { value: 17 });
    const owner = {};
    tips.showFor(owner, "Spellbook", 780, 34);
    expect([tips.el.style.left, tips.el.style.top]).toEqual(["740px", "54px"]);
    tips.showFor(owner, "Slime", 300, 590);
    expect([tips.el.style.left, tips.el.style.top]).toEqual(["300px", "571px"]);
    // Nothing under the pointer hides it; another owner's release leaves it be.
    tips.release({});
    expect(tips.el.hidden).toBe(false);
    tips.showFor(owner, null, 300, 590);
    expect(tips.el.hidden).toBe(true);
  });
  test("the four tab icons share a row and an even pitch", () => {
    const { panel } = panelWith([]);
    const icons = [...panel.el.querySelectorAll<HTMLElement>(".tab-icon")];
    expect(icons).toHaveLength(4);
    const middle = (el: HTMLElement): [number, number] => [
      Number.parseFloat(el.style.left) + Number.parseFloat(el.style.width) / 2,
      Number.parseFloat(el.style.top) + Number.parseFloat(el.style.height) / 2,
    ];
    const centres = icons.map(middle);
    for (const [i, tab] of TAB_ART.entries()) {
      // Wrapper coordinates are panel-local; the panel starts at stage x 566.
      expect(Math.abs((centres[i]?.[0] ?? 0) + 566 - tab.x)).toBeLessThanOrEqual(0.5);
      expect(Math.abs((centres[i]?.[1] ?? 0) - TAB_ROW_Y)).toBeLessThanOrEqual(0.5);
      const img = icons[i]?.querySelector("img");
      expect(img?.getAttribute("src")).toBe(`/assets/ui/internal-${tab.member}.png`);
      // The wrapper clips the member to its matte box; the bitmap keeps its own size.
      expect([img?.style.left, img?.style.top]).toEqual([`${-tab.crop[0]}px`, `${-tab.crop[1]}px`]);
      expect([img?.style.width, img?.style.height]).toEqual([
        `${tab.source[0]}px`,
        `${tab.source[1]}px`,
      ]);
    }
    for (let i = 1; i < centres.length; i++) {
      expect(
        Math.abs((centres[i]?.[0] ?? 0) - (centres[i - 1]?.[0] ?? 0) - 43),
      ).toBeLessThanOrEqual(1);
    }
    // The selected versions centre on the same points as their small icons.
    const selected = [...panel.el.querySelectorAll<HTMLElement>(".tab-on")];
    expect(selected).toHaveLength(4);
    for (const [i, el] of selected.entries()) {
      const [x, y] = middle(el);
      expect(Math.abs(x - (centres[i]?.[0] ?? 0))).toBeLessThanOrEqual(0.5);
      expect(Math.abs(y - TAB_ROW_Y)).toBeLessThanOrEqual(0.5);
      expect(el.querySelector("img")?.getAttribute("src")).toBe(
        `/assets/ui/internal-${TAB_ART[i]?.selected}.png`,
      );
    }
  });
  test("only the open tab shows its large icon, #206-#209", async () => {
    const style = document.createElement("style");
    style.textContent = await Bun.file(new URL("../src/styles.css", import.meta.url)).text();
    document.head.append(style);
    const { panel } = panelWith([]);
    document.body.append(panel.el);
    const shown = () =>
      [...panel.el.querySelectorAll<HTMLElement>(".tab-on")]
        .filter((el) => !el.hidden)
        .map((el) => Number(el.querySelector("img")?.src.match(/internal-(\d+)\.png$/)?.[1]));
    try {
      expect(shown()).toEqual([206]);
      panel.el.querySelector<HTMLButtonElement>('[aria-label="Skills"]')?.click();
      expect(shown()).toEqual([208]);
    } finally {
      panel.el.remove();
      style.remove();
    }
  });
  test("skills show 1.6's fixed 35 rows with display names (the stats text)", () => {
    const { panel } = panelWith([]);
    const skills = Array.from({ length: classesData.skills.length }, (_, i) => i + 1);
    panel.setSkills(skills);
    const names = panel.el.querySelector(".skill-names")?.textContent?.split("\n") ?? [];
    const values = panel.el.querySelector(".skill-values")?.textContent?.split("\n") ?? [];
    expect(names).toHaveLength(classesData.skillPanel.length);
    expect(names.slice(0, 5)).toEqual(["Slash", "Thrust", "Parry", "Heavy Arms", "Axe Fighting"]);
    expect(names.slice(17, 21)).toEqual(["Fire", "Water", "Wind", "Earth"]);
    expect(names.at(-1)).toBe("Farming");
    expect(names).not.toContain("Meditation");
    expect(names).not.toContain("Terrain Navigating");
    expect(names).not.toContain("Item Identification");
    // Row n shows the value of skill `skillPanel[n].index`: Heavy Arms (row 4) is skill 4;
    // Meditation (skill 12) is skipped, so Blessing (row 12) is skill 13.
    expect(values[3]).toBe("4");
    expect(values[11]).toBe("13");
    expect(values.at(-1)).toBe("38");
  });
  test("the skill arrows move both columns 32 px per press", async () => {
    const style = document.createElement("style");
    style.textContent = await Bun.file(new URL("../src/styles.css", import.meta.url)).text();
    document.head.append(style);
    const { panel } = panelWith([]);
    panel.setSkills(Array.from({ length: classesData.skills.length }, () => 0));
    document.body.append(panel.el);
    try {
      const up = panel.el.querySelector<HTMLButtonElement>('[aria-label="Scroll skills up"]');
      const down = panel.el.querySelector<HTMLButtonElement>('[aria-label="Scroll skills down"]');
      expect(up).not.toBeNull();
      expect(down).not.toBeNull();
      expect(getComputedStyle(down as HTMLElement).pointerEvents).not.toBe("none");
      const names = panel.el.querySelector<HTMLElement>(".skill-names");
      const amounts = panel.el.querySelector<HTMLElement>(".skill-values");
      const press = (b: HTMLElement | null) =>
        b?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      press(down);
      press(down);
      expect(names?.style.top).toBe("-61px"); // 3 px inside the clip, less two presses
      expect(amounts?.style.top).toBe("-61px");
      press(up);
      expect(names?.style.top).toBe("-29px");
      // A keyboard press is a click with detail 0; a mouse click (detail 1) does not double up.
      up?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
      up?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
      expect(names?.style.top).toBe("3px");
    } finally {
      panel.el.remove();
      style.remove();
    }
  });
  test("bug fixed: the skills list stops at its first and last rows", () => {
    const { panel } = panelWith([]);
    panel.setSkills(Array.from({ length: classesData.skills.length }, () => 0));
    const up = panel.el.querySelector<HTMLButtonElement>('[aria-label="Scroll skills up"]');
    const down = panel.el.querySelector<HTMLButtonElement>('[aria-label="Scroll skills down"]');
    const names = panel.el.querySelector<HTMLElement>(".skill-names");
    const amounts = panel.el.querySelector<HTMLElement>(".skill-values");
    const press = (b: HTMLElement | null, n = 1) => {
      for (let i = 0; i < n; i++) {
        b?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      }
    };
    // Up at the start does nothing (1.6 slid the first row 32 px down per press).
    press(up, 3);
    expect(names?.style.top).toBe("3px");
    // Down stops with the last row's bottom 3 px above the clip's 165 px bottom edge.
    const rows = classesData.skillPanel.length;
    const lastTop = 165 - 3 - rows * 15;
    press(down, 40);
    expect(names?.style.top).toBe(`${lastTop}px`);
    expect(amounts?.style.top).toBe(`${lastTop}px`);
    expect(lastTop + rows * 15).toBe(162);
    // The press that reaches the end moved less than 32 px; one up press is a full step back.
    expect((3 - lastTop) % 32).not.toBe(0);
    press(up);
    expect(names?.style.top).toBe(`${lastTop + 32}px`);
  });
  test("the skills clip is the backdrop's 165 px at y 114, so row 12 is outside it", () => {
    const { panel } = panelWith([]);
    const clip = panel.el.querySelector<HTMLElement>(".skills-clip");
    expect([clip?.style.top, clip?.style.height]).toEqual(["114px", "165px"]);
    // Rows start 3 px inside the clip (y 117) and are 15 px apart: row 12 begins at 3 + 12 * 15.
    expect(panel.el.querySelector<HTMLElement>(".skill-names")?.style.top).toBe("3px");
    expect(3 + 12 * 15).toBeGreaterThanOrEqual(165);
  });
  test("a slot opens the menu; Equip is Mix for a Potion Bottle", () => {
    const { panel, sent } = panelWith([
      { item: "Potion Bottle", qty: 1 },
      { item: "Knife", qty: 1 },
    ]);
    const slots = panel.el.querySelectorAll<HTMLButtonElement>(".bag-slot");
    slots[0]?.click();
    expect(panel.menu.hidden).toBe(false);
    expect(panel.menu.querySelector('[aria-label="Mix"]')).not.toBeNull();
    expect(panel.menu.querySelector('[aria-label="Equip"]')).toBeNull();
    slots[1]?.click();
    panel.menu.querySelector<HTMLButtonElement>('[aria-label="Equip"]')?.click();
    expect(sent).toEqual(["equip 2"]);
    expect(panel.menu.hidden).toBe(true);
  });
  test("Drop on crystals opens the amount dialog instead", () => {
    const { panel, sent } = panelWith([{ item: "Blue Crystals", qty: 5 }]);
    panel.el.querySelector<HTMLButtonElement>(".bag-slot")?.click();
    panel.menu.querySelector<HTMLButtonElement>('[aria-label="Drop"]')?.click();
    expect(sent).toEqual(["crystals 1 blue"]);
  });
  test("divergence: Drop and Give on a single crystal go at once, without the amount dialog", () => {
    const { panel, sent } = panelWith([{ item: "Red Crystals", qty: 1 }]);
    const pick = (button: string) => {
      panel.el.querySelector<HTMLButtonElement>(".bag-slot")?.click();
      panel.menu.querySelector<HTMLButtonElement>(`[aria-label="${button}"]`)?.click();
    };
    pick("Drop");
    pick("Give");
    expect(sent).toEqual(["oneCrystal 1 drop", "oneCrystal 1 give"]);
  });
  test("divergence: Drop and Give on a stack of more than one ask how many; a single item goes at once", () => {
    const { panel, sent } = panelWith([
      { item: "Long Sword", qty: 3 },
      { item: "Knife", qty: 1 },
    ]);
    const slots = panel.el.querySelectorAll<HTMLButtonElement>(".bag-slot");
    const pick = (slot: number, button: string) => {
      slots[slot]?.click();
      panel.menu.querySelector<HTMLButtonElement>(`[aria-label="${button}"]`)?.click();
    };
    pick(0, "Drop");
    pick(0, "Give");
    pick(1, "Drop");
    pick(1, "Give");
    expect(sent).toEqual([
      "stack 1 Long Sword drop",
      "stack 1 Long Sword give",
      "drop 2",
      "give 2",
    ]);
  });
  test("design change: gold sits in a box below the XP bar on Inventory, its button opening the gold dialog", () => {
    const { panel, sent } = panelWith([]);
    panel.setInventory({ gold: 1234567, bag: emptyBag(), equip: { ...NO_EQUIPMENT } }, 1);
    // Not on Stats any more.
    expect(panel.el.querySelector(".page-stats .gold-box, .page-stats .gold-button")).toBeNull();
    const box = panel.el.querySelector<HTMLElement>(".page-inventory .gold-box");
    // The XP bar's width (stage x 600-789), just below its slot (y 101-105) and above the bag.
    expect([box?.style.left, box?.style.top, box?.style.width, box?.style.height]).toEqual([
      `${600 - 566}px`,
      "114px",
      "189px",
      "20px",
    ]);
    // Left to right: the drop/give button, the SmallGold picture, the amount.
    const kids = [...(box?.children ?? [])].map((c) => c.className);
    expect(kids).toEqual(["gold-button", "small-gold", "gold-amount"]);
    expect(box?.querySelector(".gold-amount")?.textContent).toBe("1,234,567");
    expect(box?.getAttribute("aria-label")).toBe("1,234,567 gold");
    const b = box?.querySelector<HTMLButtonElement>('[aria-label="Drop or give gold"]');
    expect(b?.dataset.action).toBe("inventory-gold");
    expect(b?.querySelector("img")?.getAttribute("src")).toBe("/assets/ui/internal-118.png");
    b?.click();
    expect(sent).toEqual(["gold"]);
  });
  test("the SmallGold picture is drawn from the bag's own item art, not the large pile", async () => {
    const drawn: string[] = [];
    const assets: Assets = {
      ...fakeAssets,
      sheets: { items: [{} as CanvasImageSource] } as unknown as Assets["sheets"],
      sprite: (group, name) => {
        drawn.push(`${group}:${name}`);
        return [0, 0, 0, 11, 8, 0, 0];
      },
    };
    createPanel(assets, {} as Parameters<typeof createPanel>[1]);
    expect(drawn).toContain("items:SmallGold");
    expect(drawn.some((d) => /LargeGold|MediumGold/.test(d))).toBe(false);
  });
  test("the bag sits 22 px lower to fit the gold box, and the full bag still clears the equipment", () => {
    const full = Array.from({ length: 15 }, (_, i) => ({ item: `Apple${i}`, qty: 2 }));
    const { panel } = panelWith(full);
    const slots = [...panel.el.querySelectorAll<HTMLElement>(".bag-slot")];
    const tops = slots.map((s) => Number.parseFloat(s.style.top));
    expect([tops[0], tops[5], tops[10]]).toEqual([142, 179, 216]);
    // Below the gold box (y 114-134) and above the equipment boxes (y 280).
    expect(Math.min(...tops)).toBeGreaterThanOrEqual(134);
    expect(Math.max(...tops) + 34).toBeLessThanOrEqual(280);
    const qty = [...panel.el.querySelectorAll<HTMLElement>(".qty")].map((q) =>
      Number.parseFloat(q.style.top),
    );
    expect(Math.max(...qty) + 13).toBeLessThanOrEqual(280);
  });
  test("the × beside a box takes the item off; the icon does not click (score frame 63: channels 354-359 carry the remove-button names, sprites 75-80 nothing)", () => {
    const { panel, sent } = panelWith([], { equip: { head: "Chain Helm" } });
    const xs = panel.el.querySelectorAll<HTMLButtonElement>(".equip-x");
    expect(xs).toHaveLength(6);
    expect(
      panel.el.querySelectorAll(
        ".page-inventory button:not(.equip-x):not(.bag-slot):not(.gold-button)",
      ),
    ).toHaveLength(0);
    panel.el.querySelector<HTMLButtonElement>('[aria-label="LeftHand: take off Knife"]')?.click();
    expect(sent).toEqual(["unequip LeftHand"]);
  });
  test("the Head × is shown and works", () => {
    const { panel, sent } = panelWith([], { equip: { head: "Chain Helm" } });
    const head = panel.el.querySelector<HTMLButtonElement>(
      '[aria-label="Head: take off Chain Helm"]',
    );
    expect(head?.className).toBe("equip-x");
    // 8 px left of the box at x 626, centred: round(618 - 15 / 2) = 611.
    expect(head?.style.left).toBe(`${611 - 566}px`);
    head?.click();
    expect(sent).toEqual(["unequip Head"]);
  });
  test("the × follows the inventory: after a refresh it unequips the new item, or nothing", () => {
    const { panel, sent } = panelWith([]);
    const lh = () => panel.el.querySelectorAll<HTMLButtonElement>(".equip-x")[1];
    panel.setInventory({ gold: 0, bag: emptyBag(), equip: { ...NO_EQUIPMENT } }, 1);
    expect(lh()?.getAttribute("aria-label")).toBe("LeftHand: empty");
    lh()?.click();
    expect(sent).toEqual([]);
  });
  test("Stats show Strength, Stamina, Intelligence, Wisdom, Mysticism ", () => {
    const { panel } = panelWith([]);
    panel.setStats({ str: 11, sta: 12, int: 13, wis: 14, dex: 15 });
    expect(panel.el.querySelector(".stat-values")?.textContent).toBe("11\n\n12\n\n13\n\n14\n\n15");
  });
  test("design change: Level sits above Strength in Gold's old row, on the value and label columns", () => {
    const { panel } = panelWith([]);
    panel.setLevel(12);
    const value = panel.el.querySelector<HTMLElement>(".page-stats .level-value");
    const label = panel.el.querySelector<HTMLElement>(".page-stats .level-label");
    expect([value?.textContent, label?.textContent]).toEqual(["12", "Level"]);
    const values = panel.el.querySelector<HTMLElement>(".stat-values");
    const labels = panel.el.querySelector<HTMLElement>(".stat-labels");
    // The columns the stats use, one 30 px row above Strength (1.6's gold field at (668, 126)).
    expect(value?.style.left).toBe(values?.style.left);
    expect(label?.style.left).toBe(labels?.style.left);
    expect(
      Number.parseFloat(values?.style.top ?? "") - Number.parseFloat(value?.style.top ?? ""),
    ).toBe(30);
    expect(label?.style.top).toBe("126px");
  });
  test("the six stat icons are centred on the rows and evenly spaced, the head first", () => {
    const { panel } = panelWith([]);
    const icons = [...panel.el.querySelectorAll<HTMLElement>(".stat-head, .stat-icon")];
    expect(icons).toHaveLength(6);
    expect(icons.slice(1).map((i) => i.querySelector("img")?.getAttribute("src"))).toEqual(
      Array(5).fill("/assets/ui/internal-34.png"),
    );
    // Each icon is centred on its row and on the icon column (x 635-659).
    const middles = icons.map(
      (i) => Number.parseFloat(i.style.top) + Number.parseFloat(i.style.height) / 2,
    );
    for (const i of icons) {
      expect(Number.parseFloat(i.style.left) + Number.parseFloat(i.style.width) / 2).toBe(
        635 + 12 - 566,
      );
    }
    // Level, then the five stats, once every 30 px (15 px line + a blank line).
    for (let i = 1; i < middles.length; i++) {
      expect(middles[i]! - middles[i - 1]!).toBe(30);
    }
    // The text's first lines share those rows: top + half a 15 px line box.
    const lineMiddle = (sel: string) => {
      const el = panel.el.querySelector<HTMLElement>(sel);
      return Number.parseFloat(el?.style.top ?? "NaN") + 7.5;
    };
    expect(lineMiddle(".level-label")).toBe(middles[0]!);
    expect(lineMiddle(".level-value")).toBe(middles[0]!);
    expect(lineMiddle(".stat-labels")).toBe(middles[1]!);
    expect(lineMiddle(".stat-values")).toBe(middles[1]!);
  });
});

describe("panel sounds", () => {
  const CLICK = { name: "Clicksound2", ch: 3 };
  test("every tab click plays Clicksound on channel 3, the open tab's too", () => {
    const { panel, sounds } = panelWith([]);
    for (const label of ["Stats", "Inventory", "Skills", "Spellbook"]) {
      panel.el.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)?.click();
    }
    expect(sounds).toEqual(Array(4).fill({ name: "Clicksound", ch: 3 }));
  });
  test("divergence: the item menu clicks only past its locks and the client's refusals; Give too", () => {
    let locked = true;
    const { panel, sent, sounds } = panelWith(
      [
        { item: "Knife", qty: 1 },
        { item: "Potion Bottle", qty: 1 },
      ],
      { locked: () => locked },
    );
    const slots = panel.el.querySelectorAll<HTMLButtonElement>(".bag-slot");
    const press = (slot: number, label: string) => {
      slots[slot]?.click();
      panel.menu.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)?.click();
    };
    press(0, "Use");
    press(0, "Equip");
    press(0, "Drop");
    press(0, "Give");
    expect(sounds).toEqual([]);
    expect(sent).toEqual(["use 1", "equip 1", "drop 1", "give 1"]); // the server makes the same test
    locked = false;
    press(0, "Use");
    press(0, "Equip");
    press(0, "Drop");
    press(0, "Give");
    expect(sounds).toEqual(Array(4).fill(CLICK));
    press(1, "Mix"); // no craft handler: nothing goes, so no click
    expect(sounds).toHaveLength(4);
  });
  test("divergence: a Use the client refuses makes no click", () => {
    const sounds: Sfx[] = [];
    const panel = createPanel(fakeAssets, {
      use: () => sounds.push({ name: "used", ch: 0 }),
      canUse: () => false,
      equip: () => {},
      drop: () => {},
      give: () => {},
      unequip: () => {},
      crystals: () => {},
      oneCrystal: () => {},
      stack: () => {},
      arrange: () => {},
      gold: () => {},
      sound: (x) => sounds.push(x),
      canModify: () => true,
      say: () => {},
    });
    const b = emptyBag();
    b[0] = { item: "Apple", qty: 1 };
    panel.setInventory({ gold: 0, bag: b, equip: NO_EQUIPMENT }, 1);
    panel.el.querySelector<HTMLButtonElement>(".bag-slot")?.click();
    panel.menu.querySelector<HTMLButtonElement>('[aria-label="Use"]')?.click();
    expect(sounds).toEqual([]);
  });
  test("unequip clicks after its locks and its empty-slot exit", () => {
    let locked = true;
    const { panel, sent, sounds } = panelWith([], { locked: () => locked });
    const knife = () =>
      panel.el.querySelector<HTMLButtonElement>('[aria-label="LeftHand: take off Knife"]');
    knife()?.click();
    expect(sounds).toEqual([]);
    expect(sent).toEqual(["unequip LeftHand"]); // the server makes the same test
    locked = false;
    knife()?.click();
    expect(sounds).toEqual([CLICK]);
    panel.el.querySelector<HTMLButtonElement>('[aria-label="Head: empty"]')?.click();
    expect(sounds).toHaveLength(1);
  });
  test("divergence: the empty Ring × is silent like the other boxes, sending nothing", () => {
    const { panel, sent, sounds } = panelWith([]);
    panel.el.querySelector<HTMLButtonElement>('[aria-label="Ring: empty"]')?.click();
    expect(sounds).toEqual([]);
    expect(sent).toEqual([]);
  });
});

describe("the amount dialog", () => {
  const dialog = () => {
    const d = createAmountDialog(fakeAssets);
    const input = d.el.querySelector("input") as HTMLInputElement;
    const ok = d.el.querySelector('[aria-label="OK"]') as HTMLButtonElement;
    const title = d.el.querySelector(".amount-title") as HTMLElement;
    return { d, input, ok, title };
  };
  test("gold: the title and the amount reset to 0; OK sends n", () => {
    const { d, input, ok, title } = dialog();
    const got: number[] = [];
    d.open(GOLD_TITLE, "0", (n) => got.push(n));
    expect(title.textContent).toBe("How Much Gold Do You Want To Give/Drop?");
    expect(input.value).toBe("0");
    input.value = "50";
    ok.click();
    expect(got).toEqual([50]);
    expect(d.el.hidden).toBe(true);
  });
  test("a click in the amount field selects its line", () => {
    const { d, input } = dialog();
    d.open(GOLD_TITLE, "0", () => {});
    document.body.append(d.el);
    input.setSelectionRange(1, 1);
    input.click();
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 1]);
    d.el.remove();
  });
  test("OK hides the dialog before its silent refusals", () => {
    const { d, ok } = dialog();
    const got: number[] = [];
    d.open(GOLD_TITLE, "0", (n) => got.push(n));
    ok.click(); // "0" is refused, silently
    expect(got).toEqual([]);
    expect(d.el.hidden).toBe(true);
  });
  test("divergence: the title fills the top box's interior, not 1.6's high-left field", () => {
    const { title } = dialog();
    // Internal #119's top box is local x 13-239, y 12-46; 1.6's field (#125) was [22, 14, 213, 46].
    expect([title.style.left, title.style.top, title.style.width, title.style.height]).toEqual([
      "13px",
      "12px",
      "227px",
      "35px",
    ]);
  });
  test("crystals keep the last amount; the saved field text is 2", () => {
    const { d, input, title } = dialog();
    d.open(crystalTitle("blue", "drop"), null, () => {});
    expect(title.textContent).toBe("Drop how many blue crystals?");
    expect(input.value).toBe("2");
    d.close();
    d.open(GOLD_TITLE, "0", () => {});
    d.close();
    d.open(crystalTitle("red", "give"), null, () => {});
    expect(title.textContent).toBe("Give how many red crystals?");
    expect(input.value).toBe("0");
  });

  test("divergence: a stack asks how many of its item, starting at 1 and selected", () => {
    const { d, input, title } = dialog();
    document.body.append(d.el);
    d.open(stackTitle("Long Sword", "drop"), "1", () => {});
    expect(title.textContent).toBe("Drop how many Long Sword?");
    expect(input.value).toBe("1");
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 1]);
    d.open(stackTitle("Apple", "give"), "1", () => {});
    expect(title.textContent).toBe("Give how many Apple?");
    d.el.remove();
  });

  test("silent refusals: more than 4 characters, a dash, outside 1..9999", () => {
    expect(parseAmount("5")).toBe(5);
    expect(parseAmount("0050")).toBe(50);
    expect(parseAmount("10000")).toBeNull();
    expect(parseAmount("-5")).toBeNull();
    expect(parseAmount("0")).toBeNull();
  });
});

describe("drag to rearrange the bag (SSO; 1.6 had none)", () => {
  // happy-dom lays nothing out, so the panel's box is at (0, 0) with scale 1: client coordinates
  // are panel-local. Slot 1 spans x 35-67, y 142-176; slot 2 starts at x 72.
  const pointer = (target: EventTarget, type: string, x: number, y: number) =>
    target.dispatchEvent(
      new PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, button: 0, bubbles: true }),
    );
  const bag = () => [
    { item: "Long Sword", qty: 3 },
    { item: "Knife", qty: 1 },
  ];
  test("dragging a slot onto another sends both slots, and the click after it opens no menu", () => {
    const { panel, sent, sounds } = panelWith(bag());
    const slots = panel.el.querySelectorAll<HTMLButtonElement>(".bag-slot");
    pointer(slots[0] as HTMLElement, "pointerdown", 50, 130);
    pointer(document, "pointermove", 70, 130);
    expect(panel.el.querySelector(".drag-ghost")).not.toBeNull();
    pointer(document, "pointermove", 160, 197); // slot 9: x 146-178, row 2 y 179-213
    pointer(document, "pointerup", 160, 197);
    slots[0]?.click();
    expect(sent).toEqual(["arrange 1 9"]);
    expect(sounds).toHaveLength(1);
    expect(panel.menu.hidden).toBe(true);
    expect(panel.el.querySelector(".drag-ghost")).toBeNull();
  });
  test("a press that moves less than 4 pixels is still a click", () => {
    const { panel, sent } = panelWith(bag());
    const slot = panel.el.querySelector<HTMLButtonElement>(".bag-slot") as HTMLButtonElement;
    pointer(slot, "pointerdown", 50, 130);
    pointer(document, "pointermove", 52, 131);
    pointer(document, "pointerup", 52, 131);
    slot.click();
    expect(sent).toEqual([]);
    expect(panel.menu.hidden).toBe(false);
  });
  test("letting go off the bag, or on the same slot, sends nothing", () => {
    const { panel, sent } = panelWith(bag());
    const slot = panel.el.querySelector<HTMLButtonElement>(".bag-slot") as HTMLButtonElement;
    pointer(slot, "pointerdown", 50, 130);
    pointer(document, "pointermove", 50, 300);
    pointer(document, "pointerup", 50, 300);
    pointer(slot, "pointerdown", 50, 130);
    pointer(document, "pointermove", 60, 150);
    pointer(document, "pointerup", 60, 150);
    expect(sent).toEqual([]);
  });
  test("an empty slot cannot be picked up, and nothing moves while the bag is locked", () => {
    let locked = false;
    const { panel, sent } = panelWith(bag(), { locked: () => locked });
    const slots = panel.el.querySelectorAll<HTMLButtonElement>(".bag-slot");
    pointer(slots[5] as HTMLElement, "pointerdown", 50, 165);
    pointer(document, "pointermove", 90, 130);
    pointer(document, "pointerup", 90, 130);
    locked = true;
    pointer(slots[0] as HTMLElement, "pointerdown", 50, 130);
    pointer(document, "pointermove", 90, 130);
    pointer(document, "pointerup", 90, 130);
    expect(sent).toEqual([]);
  });
  // The equipment boxes, panel-local: left column x 60-95, right x 160-195; the hand row y 318-353.
  const dragTo = (panel: { el: HTMLElement }, slot: number, x: number, y: number) => {
    const hit = panel.el.querySelectorAll<HTMLButtonElement>(".bag-slot")[slot - 1] as HTMLElement;
    const at = { x: 50 + 37 * (slot - 1), y: 130 };
    pointer(hit, "pointerdown", at.x, at.y);
    pointer(document, "pointermove", x, y);
    pointer(document, "pointerup", x, y);
  };
  const gear = () => [
    { item: "Long Sword", qty: 1 },
    { item: "Wooden Shield", qty: 1 },
    { item: "Apple", qty: 2 },
  ];
  test("an item let go on its own equipment box is equipped", () => {
    const { panel, sent, sounds } = panelWith(gear());
    dragTo(panel, 1, 75, 335); // the weapon box
    dragTo(panel, 2, 175, 335); // the shield box
    expect(sent).toEqual(["equip 1", "equip 2"]);
    expect(sounds).toHaveLength(2);
  });
  test("an item let go on another item's box, or one that cannot be worn, goes back", () => {
    const { panel, sent } = panelWith(gear());
    dragTo(panel, 2, 75, 335); // a shield on the weapon box
    dragTo(panel, 1, 75, 295); // a sword on the head box
    dragTo(panel, 3, 75, 335); // an Apple
    expect(sent).toEqual([]);
  });
  test("nothing is equipped by dragging while the bag is locked", () => {
    let locked = false;
    const { panel, sent } = panelWith(gear(), { locked: () => locked });
    const hit = panel.el.querySelector<HTMLButtonElement>(".bag-slot") as HTMLElement;
    pointer(hit, "pointerdown", 50, 130);
    pointer(document, "pointermove", 75, 335);
    locked = true;
    pointer(document, "pointerup", 75, 335);
    expect(sent).toEqual([]);
  });
});

describe("ground items and looks in the model", () => {
  test("gadd, gdel and look", () => {
    const m = createModel();
    applyDelta(m, [{ e: "gadd", item: { id: "g", name: "Apple", x: 3, y: 4 } }]);
    expect(m.ground.get("g")).toEqual({ id: "g", name: "Apple", x: 3, y: 4 });
    applyDelta(m, [{ e: "gdel", id: "g" }]);
    expect(m.ground.size).toBe(0);
  });
});

describe("Ctrl", () => {
  test("one action per press, not on key repeat", () => {
    const s = createInputState();
    let n = 0;
    const sink = { move() {}, step() {}, attack() {}, action: () => n++ };
    keyDown(s, sink, { key: "Control" });
    keyDown(s, sink, { key: "Control", repeat: true });
    expect(n).toBe(1);
  });
});
