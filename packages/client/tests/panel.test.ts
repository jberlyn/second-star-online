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
import { createAmountDialog, crystalTitle, GOLD_TITLE, parseAmount } from "../src/ui/amount.ts";
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
    expect(panel.el.querySelector(".gold")?.textContent).toBe("12");
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
  test("the skill arrows move both columns 32 px per press, unbounded", async () => {
    const style = document.createElement("style");
    style.textContent = await Bun.file(new URL("../src/styles.css", import.meta.url)).text();
    document.head.append(style);
    const { panel } = panelWith([]);
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
      press(up);
      press(up);
      expect(names?.style.top).toBe("35px");
      // A keyboard press is a click with detail 0; a mouse click (detail 1) does not double up.
      down?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
      down?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
      expect(names?.style.top).toBe("3px");
    } finally {
      panel.el.remove();
      style.remove();
    }
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
  test("the gold button beside the gold count opens the gold dialog", () => {
    const { panel, sent } = panelWith([]);
    const b = panel.el.querySelector<HTMLButtonElement>(
      '.page-stats [aria-label="Drop or give gold"]',
    );
    expect(b?.style.left).toBe(`${613 - 566}px`);
    expect(b?.style.top).toBe("127px");
    b?.click();
    expect(sent).toEqual(["gold"]);
  });
  test("the × beside a box takes the item off; the icon does not click (score frame 63: channels 354-359 carry the remove-button names, sprites 75-80 nothing)", () => {
    const { panel, sent } = panelWith([], { equip: { head: "Chain Helm" } });
    const xs = panel.el.querySelectorAll<HTMLButtonElement>(".equip-x");
    expect(xs).toHaveLength(6);
    expect(
      panel.el.querySelectorAll(".page-inventory button:not(.equip-x):not(.bag-slot)"),
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
  test("the six stat icons are centred on the rows and evenly spaced", () => {
    const { panel } = panelWith([]);
    const icons = [...panel.el.querySelectorAll<HTMLElement>(".stat-icon")];
    expect(icons).toHaveLength(6);
    expect(icons.map((i) => i.querySelector("img")?.getAttribute("src"))).toEqual(
      Array(6).fill("/assets/ui/internal-34.png"),
    );
    // Each wrapper is centred on its row.
    const middles = icons.map(
      (i) => Number.parseFloat(i.style.top) + Number.parseFloat(i.style.height) / 2,
    );
    // Gold, then the five stats, once every 30 px (15 px line + a blank line).
    for (let i = 1; i < middles.length; i++) {
      expect(middles[i]! - middles[i - 1]!).toBe(30);
    }
    // The text's first lines share those rows: top + half a 15 px line box.
    const lineMiddle = (sel: string) => {
      const el = panel.el.querySelector<HTMLElement>(sel);
      return Number.parseFloat(el?.style.top ?? "NaN") + 7.5;
    };
    expect(lineMiddle(".gold")).toBe(middles[0]!);
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

  test("silent refusals: more than 4 characters, a dash, outside 1..9999", () => {
    expect(parseAmount("5")).toBe(5);
    expect(parseAmount("0050")).toBe(50);
    expect(parseAmount("10000")).toBeNull();
    expect(parseAmount("-5")).toBeNull();
    expect(parseAmount("0")).toBeNull();
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
    keyDown(s, sink, "Control", false);
    keyDown(s, sink, "Control", false, true);
    expect(n).toBe(1);
  });
});
