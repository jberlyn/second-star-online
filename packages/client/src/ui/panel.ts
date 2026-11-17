/**
 * The right panel: the four tabs and their pages, built from the original
 * art at the score positions of frames 50-61 (Stats), 63 (Inventory) and 65 (Skills)
 * (assets/original/main/layout/frame-50.json, frame-63.json, score-spans.jsonl). Spellbook (frame
 * 67, spellbook.ts). Positions are 800×600 stage coordinates; the panel element spans the stage
 * rect [566, 0, 800, 410].
 *
 * - Bag: slot x is centred on (617 + 37·col, 116/153/190) at its icon's regpoint; the quantity
 *   shows only above 1 (Arial 10 bold white, the bag's quantity fields).
 * - Equipment boxes (Inventory #1, 135×113 at [626, 280, 761, 393]): Head, LeftHand, Feet on the
 *   left (x 646), Body, RightHand, Ring on the right (x 746), at y 281/320/359. Clicking one takes
 *   the item off.
 * - The item menu: Use, Equip (or Cook/Mix/Build/Smith/Storage), Drop, Give at the pointer; it
 *   hides when the pointer leaves it.
 * - Stats (frames 50-61): labels "Strength … Mysticism" (the stat label field), values STR, STA,
 *   INT, WIS, DEX (the stat value fields) and Gold (field Gold at (668, 126)). Gold and the five
 *   stats sit on one 30 px row grid, each icon centred on its row (see the stats page). The gold
 *   drop button (Internal #118, channel 2, matte, loc (619, 133), drawn 14×13 at
 *   [613, 127, 627, 140] on the Game Area frame 50; the score's 18×15 is stale, the sprite is
 *   unstretched) opens the amount dialog.
 * - Spellbook (frame 67): the spell list, Info and the cast button (spellbook.ts).
 * - Skills (frame 65): the 35 rows of 1.6's fixed list (`classesData.skillPanel`): names
 *   (the skill name field, Arial 12 bold) at (620, 117) and values (the skill value field,
 *   Arial 12) at (736, 117), one per line. The arrows #162 (up, loc (609, 122)) and #161 (down,
 *   (609, 274)) move both columns 32 px on mouse-down with no limit either way.
 */
import { type AtlasGroup, classesData, TAB_ART, TAB_HIT, TAB_ROW_Y } from "@secondstaronline/data";
import {
  bagPicture,
  displayName,
  type EquipSlot,
  type EquipView,
  type InventoryView,
  lingoContains,
  menuAction,
  PAPERDOLL_SIZE,
  paperdollLayers,
} from "@secondstaronline/shared";

import { type Assets, drawSprite } from "../assets.ts";
import { type Sfx, SOUND } from "../sfx.ts";
import { action as tagAction } from "./action.ts";
import { createSpellbook, type Spellbook } from "./spellbook.ts";
import { artImg } from "./stage.ts";

export type Tab = "stats" | "inventory" | "skills" | "spellbook";

export interface PanelActions {
  use(slot: number): void;
  /** False while the client refuses Use itself (the mail compose pane is up). */
  canUse?(): boolean;
  equip(slot: number): void;
  drop(slot: number): void;
  give(slot: number): void;
  /** Cook, Mix, Build or Smith (members 25, 22, 105, 138); the server picks the button. */
  craft?(slot: number): void;
  /** Storage on a carried container. */
  storage?(slot: number): void;
  unequip(slot: EquipSlot): void;
  /** Drop or Give on crystals opens the amount dialog. */
  crystals(slot: number, colour: string): void;
  /** The gold button beside the gold count opens the amount dialog. */
  gold(): void;
  /** Plays a sound. */
  sound(s: Sfx): void;
  /**
   * The unequip × markers' and item menu's exits before their click: the key lock and Ctrl's
   * action pause. SSO has no wait for the server's reply.
   */
  canModify(): boolean;
  /**
   * A bag slot was clicked: it first hides the PROCESSING box, then exits while a window
   * holds the key lock. False stops the click there.
   */
  slotClicked?(): boolean;
  /** A chat line for you alone (the spellbook's Info). */
  say(text: string): void;
}

export interface Panel {
  /** The panel, 234×410, positioned by the shell. */
  el: HTMLElement;
  /** The item menu. */
  menu: HTMLElement;
  /** The 800×600 layer the menu is drawn in (stage coordinates). */
  menuLayer: HTMLElement;
  tab: Tab;
  setTab(t: Tab): void;
  setInventory(inv: InventoryView, head: number): void;
  setStats(s: { str: number; sta: number; int: number; wis: number; dex: number }): void;
  setSkills(skills: readonly number[]): void;
  /** The Spellbook page (frame 67). */
  spellbook: Spellbook;
}

const PANEL_X = 566;

function at(el: HTMLElement, x: number, y: number, w?: number, h?: number): HTMLElement {
  el.style.position = "absolute";
  el.style.left = `${x - PANEL_X}px`;
  el.style.top = `${y}px`;
  if (w !== undefined) {
    el.style.width = `${w}px`;
  }
  if (h !== undefined) {
    el.style.height = `${h}px`;
  }
  return el;
}

/** A UI file placed with its regpoint on (x, y). */
function uiAt(a: Assets, cast: string, member: number, x: number, y: number): HTMLImageElement {
  const f = a.index.ui[`${cast}:${member}`];
  const img = artImg(a.ui(cast, member));
  at(img, x - (f?.regX ?? 0), y - (f?.regY ?? 0), f?.w, f?.h);
  return img;
}

/** An atlas sprite as a small canvas with its regpoint on (x, y); empty if there is no art. */
function spriteCanvas(
  a: Assets,
  group: AtlasGroup,
  name: string,
  x: number,
  y: number,
): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.className = "sprite";
  const s = a.sprite(group, name);
  if (!s) {
    // No member of that name: nothing is drawn.
    c.width = 1;
    c.height = 1;
    at(c, x, y, 1, 1);
    return c;
  }
  const [, , , w, h, rx, ry] = s;
  c.width = w;
  c.height = h;
  at(c, x - rx, y - ry, w, h);
  const paint = () => {
    const ctx = c.getContext("2d");
    if (ctx) {
      drawSprite(ctx, a, group, name, rx, ry);
    }
  };
  if (a.sheets[group]) {
    paint();
  } else {
    void a.loadGroup(group).then(paint);
  }
  return c;
}

function field(text: string, cls: string): HTMLElement {
  const el = document.createElement("div");
  el.className = `field ${cls}`;
  el.textContent = text;
  return el;
}

const BAG_X = (i: number) => 617 + 37 * (i % 5);
const BAG_Y = (i: number) => [116, 153, 190][Math.floor(i / 5)] as number;
/** The bag's quantity field rects (frame-63.json channels 220-234). */
const QTY_X = [612, 649, 683, 722, 755];
const QTY_Y = [139, 177, 219];

/**
 * The six boxes of Inventory #1 (loc (693, 335) less its regpoint (67, 55): [626, 280]):
 * 35×35, columns at x 626 and 726, rows at y 280, 318 and 358, measured from the art.
 * Sprites 75-80 had their locs at (646/746, 281/320/359), each icon on its own regpoint;
 * SSO centres each icon in its box, and likewise the × markers and the paperdoll.
 */
const BOX_X = { left: 626, right: 726 } as const;
const BOX_Y = [280, 318, 358] as const;
const BOX_SIZE = 35;
const boxCentre = (col: keyof typeof BOX_X, row: number) => ({
  x: BOX_X[col] + BOX_SIZE / 2,
  y: (BOX_Y[row] as number) + BOX_SIZE / 2,
});

const EQUIP_BOX: {
  slot: EquipSlot;
  col: keyof typeof BOX_X;
  row: number;
  field: keyof EquipView;
}[] = [
  { slot: "Head", col: "left", row: 0, field: "head" },
  { slot: "LeftHand", col: "left", row: 1, field: "weapon" },
  { slot: "Feet", col: "left", row: 2, field: "feet" },
  { slot: "Body", col: "right", row: 0, field: "body" },
  { slot: "RightHand", col: "right", row: 1, field: "offHand" },
  { slot: "Ring", col: "right", row: 2, field: "ring" },
];

/** An atlas sprite drawn with its bitmap centred on (cx, cy), whatever its regpoint. */
function centredCanvas(a: Assets, group: AtlasGroup, name: string, cx: number, cy: number) {
  const s = a.sprite(group, name);
  const w = s?.[3] ?? 1;
  const h = s?.[4] ?? 1;
  // spriteCanvas puts the regpoint on (x, y): shift so the bitmap's centre lands on (cx, cy).
  return spriteCanvas(
    a,
    group,
    name,
    Math.round(cx - w / 2 + (s?.[5] ?? 0)),
    Math.round(cy - h / 2 + (s?.[6] ?? 0)),
  );
}

/** The menu buttons that replace Equip. */
const ACTION_ART: Record<string, { group: "ui" | AtlasGroup; name: string | number }> = {
  Equip: { group: "ui", name: 52 },
  Cook: { group: "ui", name: 25 },
  Mix: { group: "items", name: "MixButton" },
  Build: { group: "items", name: "BuildButton" },
  Smith: { group: "items", name: "BSmith" },
  Storage: { group: "items", name: "StorageButton" },
};

/** Inventory members of the buttons drawn from the item atlas (MixButton #22, BuildButton
 * #105, BSmith #138, StorageButton #70). */
const ACTION_MEMBER: Record<string, number> = { Mix: 22, Build: 105, Smith: 138, Storage: 70 };

export function createPanel(a: Assets, act: PanelActions): Panel {
  const el = document.createElement("div");
  el.className = "panel-page";
  el.style.position = "relative";
  el.style.width = "234px";
  el.style.height = "410px";
  const bg = uiAt(a, "internal", 188, 597 + 102, 53 + 135);
  bg.classList.add("panel-bg");
  el.append(bg);

  // ---- tabs (Internal #130-133; highlights #206-#209 at their tab) ----------------------
  // The build cuts each bitmap out of its wood with a mask and erases the four copies baked into #186, so
  // each crop can sit on the common row without dragging a rectangle of wood with it. The
  // selected version is the same tab's larger bitmap, centred on the same point.
  const tabCrop = (
    tab: (typeof TAB_ART)[number],
    selected: boolean,
    visible: boolean,
  ): HTMLDivElement => {
    const [cx, cy, cw, ch] = selected ? tab.selectedCrop : tab.crop;
    const [sw, sh] = selected ? tab.selectedSource : tab.source;
    const wrap = document.createElement("div");
    wrap.className = selected ? "tab-on" : "tab-icon";
    wrap.hidden = !visible;
    at(wrap, Math.round(tab.x - cw / 2), Math.round(TAB_ROW_Y - ch / 2), cw, ch);
    const img = artImg(a.ui("internal", selected ? tab.selected : tab.member));
    img.style.position = "absolute";
    img.style.left = `${-cx}px`;
    img.style.top = `${-cy}px`;
    img.style.width = `${sw}px`;
    img.style.height = `${sh}px`;
    wrap.append(img);
    return wrap;
  };
  const highlight = {} as Record<Tab, HTMLElement>;
  const tabLabels: Record<Tab, string> = {
    stats: "Stats",
    inventory: "Inventory",
    skills: "Skills",
    spellbook: "Spellbook",
  };
  for (const tab of TAB_ART) {
    const t = tab.tab;
    highlight[t] = tabCrop(tab, true, t === "stats");
    const icon = tabCrop(tab, false, true);
    // Each tab has its own script.
    const b = tagAction(document.createElement("button"), `panel-tab-${t}`);
    b.type = "button";
    b.className = "tab-hit";
    b.setAttribute("aria-label", tabLabels[t]);
    at(
      b,
      Math.round(tab.x - TAB_HIT.w / 2),
      Math.round(TAB_ROW_Y - TAB_HIT.h / 2),
      TAB_HIT.w,
      TAB_HIT.h,
    );
    b.addEventListener("click", () => {
      // Every click, the open tab's too.
      act.sound(SOUND.tab);
      panel.setTab(t);
    });
    el.append(icon, highlight[t], b);
  }

  // ---- inventory page ------------------------------------------------------------------
  const invPage = document.createElement("div");
  invPage.className = "page page-inventory";
  invPage.append(uiAt(a, "inventory", 1, 693, 335));
  const bagLayer = document.createElement("div");
  const equipLayer = document.createElement("div");
  const doll = document.createElement("canvas");
  doll.width = PAPERDOLL_SIZE.w;
  doll.height = PAPERDOLL_SIZE.h;
  doll.className = "doll";
  // Sprite 82 sat at [673, 319] in the score; SSO centres the bare character in the middle box
  // of Inventory #1 (art x 50-84, y 26-79 → stage x 676-710, y 306-359), using the bare body's
  // drawn pixels so the figure stays put when gear is added (a divergence: 1.6 drew
  // it at its score loc).
  const DOLL_BOX = { x: 676, y: 306, w: 35, h: 54 };
  at(doll, 673, 319, PAPERDOLL_SIZE.w, PAPERDOLL_SIZE.h);
  invPage.append(bagLayer, equipLayer, doll);

  // The × markers (Internal #75, channels 354-359) are the unequip buttons: each carries its slot's
  // take-off behaviour, and the equipment icons (sprites 75-80) carry none, so clicking an item
  // does nothing (score frame 63). The Inventory tab shows all six, Head's included. Drawn at the
  // member's own 15×14 (the sprites are unstretched; the score's 11×11 is stale). 1.6 put them at
  // [608/768, 288/328/368], 3 px left of the left boxes and 7 px right of the right ones, about 2
  // px above the row centres; SSO centres them on their box rows, 8 px out from the boxes on both
  // sides. Above the icons and doll, as their locZ 354-359 put them.
  const MARK_W = 15;
  const MARK_H = 14;
  let equipNow: EquipView | undefined;
  const marks = new Map<EquipSlot, HTMLButtonElement>();
  for (const box of EQUIP_BOX) {
    const c = boxCentre(box.col, box.row);
    const x = box.col === "left" ? BOX_X.left - 8 : BOX_X.right + BOX_SIZE + 8;
    const left = Math.round(x - MARK_W / 2);
    const top = Math.round(c.y - MARK_H / 2);
    const mark = artImg(a.ui("internal", 75));
    at(mark, left, top, MARK_W, MARK_H);
    const hit = tagAction(
      document.createElement("button"),
      `inventory-unequip-${box.slot.toLowerCase()}`,
    );
    hit.type = "button";
    hit.className = "equip-x";
    at(hit, left, top, MARK_W, MARK_H);
    // Each × exits silently on an empty slot, then clicks after its locks (1.6's Ring × clicked
    // before its empty-slot test).
    hit.addEventListener("click", () => {
      const item = equipNow?.[box.field] ?? "NOTHING";
      if (item === "NOTHING") {
        return;
      }
      if (act.canModify()) {
        act.sound(SOUND.click);
      }
      act.unequip(box.slot);
    });
    marks.set(box.slot, hit);
    invPage.append(mark, hit);
  }

  // ---- stats page ----------------------------------------------------------------------
  const statsPage = document.createElement("div");
  statsPage.className = "page page-stats";
  // Gold and the five stats are one column of icons on a common 30 px row grid. The icons
  // are a single 24×177 strip (Internal #34, its regpoint 14/90 puts it at [635, 124]) whose
  // glyphs are unevenly spaced and of uneven height, so each slice gets its own clipping box
  // and is centred on its row. Each slice is an odd number of rows (one transparent row pads
  // the two even-height glyphs), which keeps every box on a whole stage pixel. The text
  // fields use the same grid: Arial 12 bold on a 15 px line with a blank line between rows is
  // a 30 px pitch, gold row included.
  const ICON_X = 635;
  const ROW_H = 30;
  const GOLD_MID = 133.5; // the gold field (668, 126) on its 15 px line
  const STAT_ICONS: readonly [cropTop: number, height: number][] = [
    [0, 15], // gold
    [26, 21], // Strength (bicep; its pixels are rows 27-46)
    [64, 15], // Stamina (heart)
    [93, 23], // Intelligence (bulb)
    [130, 15], // Wisdom (brain)
    [156, 21], // Mysticism (wand; its pixels are rows 157-176)
  ];
  const icons = STAT_ICONS.map(([cropTop, h], row) => {
    const clip = document.createElement("div");
    clip.className = "stat-icon";
    at(clip, ICON_X, GOLD_MID + row * ROW_H - h / 2, 24, h);
    const img = artImg(a.ui("internal", 34));
    img.style.position = "absolute";
    img.style.left = "0";
    img.style.top = `${-cropTop}px`;
    img.style.width = "24px";
    img.style.height = "177px";
    clip.append(img);
    return clip;
  });
  const labels = field("Strength\n\nStamina\n\nIntelligence\n\nWisdom\n\nMysticism", "stat-labels");
  // Both fields start on the first stat row, 30 px below the gold row's 15 px line.
  at(labels, 668, 156, 88, 160);
  const values = field("", "stat-values");
  at(values, 613, 156, 27, 175);
  const gold = field("", "gold");
  at(gold, 668, 126, 88, 16);
  // Internal #118 at its own 14×13, loc (619, 133) less its regpoint (6, 6) (frame-50.json).
  const goldButton = tagAction(document.createElement("button"), "inventory-gold");
  goldButton.type = "button";
  goldButton.className = "gold-button";
  goldButton.setAttribute("aria-label", "Drop or give gold");
  at(goldButton, 613, 127, 14, 13);
  const goldArt = artImg(a.ui("internal", 118));
  goldArt.style.position = "absolute";
  goldArt.style.left = "0";
  goldArt.style.top = "0";
  goldArt.style.width = "14px";
  goldArt.style.height = "13px";
  goldButton.append(goldArt);
  goldButton.addEventListener("click", () => act.gold());
  statsPage.append(...icons, labels, values, gold, goldButton);

  // ---- skills page ---------------------------------------------------------------------
  const skillsPage = document.createElement("div");
  skillsPage.className = "page page-skills";
  const clip = document.createElement("div");
  clip.className = "skills-clip";
  // The backdrop's rect y 114-278 clips the columns, as 1.6; the rows start 3 px inside it, at y
  // 117.
  at(clip, 620, 114, 143, 165);
  const names = field("", "skill-names");
  const amounts = field("", "skill-values");
  names.style.position = "absolute";
  amounts.style.position = "absolute";
  names.style.top = "3px";
  amounts.style.top = "3px";
  amounts.style.left = "116px";
  clip.append(names, amounts);
  // Sprites 22/23 move by 32 px per press with no limit; the backdrop clips the columns, as 1.6.
  let offset = 0;
  const scrollBy = (dy: number) => {
    offset += dy;
    names.style.top = `${3 + offset}px`;
    amounts.style.top = `${3 + offset}px`;
  };
  const arrow = (member: number, y: number, label: string, dy: number) => {
    const f = a.index.ui[`internal:${member}`];
    // Up is channel 24 (#162), down is 25 (#161), score frame 65.
    const b = tagAction(
      document.createElement("button"),
      member === 162 ? "skills-scroll-up" : "skills-scroll-down",
    );
    b.type = "button";
    b.className = "skill-arrow";
    b.setAttribute("aria-label", label);
    at(b, 609 - (f?.regX ?? 6), y - (f?.regY ?? 6), f?.w ?? 12, f?.h ?? 12);
    const img = artImg(a.ui("internal", member));
    img.style.position = "absolute";
    img.style.left = "0";
    img.style.top = "0";
    img.style.width = "100%";
    img.style.height = "100%";
    b.append(img);
    // 1.6 acts on mouseDown; a keyboard press (click with detail 0) does the same.
    b.addEventListener("pointerdown", () => scrollBy(dy));
    b.addEventListener("click", (e) => {
      if (e.detail === 0) {
        scrollBy(dy);
      }
    });
    return b;
  };
  const up = arrow(162, 122, "Scroll skills up", 32);
  const down = arrow(161, 274, "Scroll skills down", -32);
  skillsPage.append(uiAt(a, "internal", 223, 694, 80), clip, up, down);

  el.append(statsPage, invPage, skillsPage);

  // ---- the item menu (Inventory #50-56; sprites 95-100) -----------------------------------
  // The menu is drawn in stage coordinates, above everything (locZ 7000-7005); the shell places
  // this layer.
  const menuLayer = document.createElement("div");
  menuLayer.className = "menu-layer";
  const menu = document.createElement("div");
  menu.className = "item-menu";
  menu.hidden = true;
  menuLayer.append(menu);
  // The menu's leave script is the background sprite 95's `mouseLeave`: the
  // menu goes when the pointer leaves the background's rectangle. The buttons lie inside it,
  // so moving between them keeps it open.
  let menuBg: HTMLElement | null = null;
  document.addEventListener("pointermove", (e) => {
    if (menu.hidden || !menuBg) {
      return;
    }
    const r = menuBg.getBoundingClientRect();
    const inside =
      e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom;
    if (!inside) {
      menu.hidden = true;
    }
  });
  let menuSlot = 0;
  const openMenu = (slot: number, name: string, x: number, y: number) => {
    menuSlot = slot;
    menu.replaceChildren();
    // Background at (mouseH − 60, mouseV) with reg (64, 32); buttons share its loc.
    const lx = x - 60;
    const ly = y;
    const place = (node: HTMLElement, rx: number, ry: number, w: number, h: number) => {
      node.style.position = "absolute";
      node.style.left = `${lx - rx}px`;
      node.style.top = `${ly - ry}px`;
      node.style.width = `${w}px`;
      node.style.height = `${h}px`;
      menu.append(node);
      return node;
    };
    // The leave test itself listens on the document (above), which has no action annotation.
    menuBg = place(
      tagAction(artImg(a.ui("inventory", 50)), "inventory-menu-dismiss"),
      64,
      32,
      161,
      45,
    );
    const title = document.createElement("div");
    title.className = "field sel-title";
    title.textContent = displayName(name);
    title.style.position = "absolute";
    title.style.left = `${lx - 103}px`;
    title.style.top = `${ly - 22}px`;
    title.style.width = "240px";
    menu.append(title);
    const button = (
      label: string,
      _member: number,
      art: HTMLElement,
      rx: number,
      ry: number,
      w: number,
      h: number,
      go: () => void,
      ready: () => boolean = () => true,
    ) => {
      // Each button is its member's own script, swapped onto sprites 97-100.
      const b = tagAction(
        document.createElement("button"),
        `inventory-${label.toLowerCase().replaceAll(" ", "-")}`,
      );
      b.type = "button";
      b.className = "menu-btn-art";
      b.setAttribute("aria-label", label);
      b.append(art);
      place(b, rx, ry, w, h);
      b.addEventListener("click", () => {
        menu.hidden = true; // every button hides the menu first
        // Every button clicks only when its action goes ahead: not refused by the client, and
        // past the key lock and the item pause (1.6 clicked first, before every check, and Give
        // never clicked).
        if (!ready()) {
          return;
        }
        const locked = !act.canModify();
        go();
        if (!locked) {
          act.sound(SOUND.click);
        }
      });
    };
    const isCrystal = lingoContains(name, "Crystals");
    const colour = name.split(" ")[0]?.toLowerCase() ?? "";
    button(
      "Use",
      51,
      artImg(a.ui("inventory", 51)),
      54,
      5,
      28,
      11,
      () => act.use(menuSlot),
      () => act.canUse?.() !== false,
    );
    const action = menuAction(name);
    const art = ACTION_ART[action] ?? { group: "ui", name: 52 };
    if (art.group === "ui") {
      const f = a.index.ui[`inventory:${art.name}`];
      button(
        action,
        art.name as number,
        artImg(a.ui("inventory", art.name as number)),
        f?.regX ?? 23,
        f?.regY ?? 5,
        f?.w ?? 39,
        f?.h ?? 14,
        () => (action === "Equip" ? act.equip(menuSlot) : act.craft?.(menuSlot)), // or Cook
        () => action === "Equip" || act.craft !== undefined,
      );
    } else {
      const s = a.sprite(art.group, art.name as string);
      const c = spriteCanvas(a, art.group, art.name as string, 0, 0);
      c.style.position = "static";
      // Mix, Build, Smith and Storage.
      button(
        action,
        ACTION_MEMBER[action] ?? 52,
        c,
        s?.[5] ?? 0,
        s?.[6] ?? 0,
        s?.[3] ?? 0,
        s?.[4] ?? 0,
        () => (action === "Storage" ? act.storage?.(menuSlot) : act.craft?.(menuSlot)),
        () => (action === "Storage" ? act.storage : act.craft) !== undefined,
      );
    }
    button("Drop", 53, artImg(a.ui("inventory", 53)), -20, 5, 36, 13, () =>
      isCrystal ? act.crystals(menuSlot, colour) : act.drop(menuSlot),
    );
    button("Give", 56, artImg(a.ui("inventory", 56)), -57, 5, 31, 11, () =>
      isCrystal ? act.crystals(menuSlot, colour) : act.give(menuSlot),
    );
    menu.hidden = false;
  };

  let inventory: InventoryView | null = null;
  let headNo = 1;

  /** The bare character's drawn bounds, centred once in the box (needs canvas pixel reads). */
  let dollCentred = false;
  const centreDoll = () => {
    if (dollCentred) {
      return;
    }
    const probe = document.createElement("canvas");
    probe.width = PAPERDOLL_SIZE.w;
    probe.height = PAPERDOLL_SIZE.h;
    const pc = probe.getContext("2d", { willReadFrequently: true });
    if (!pc || typeof pc.getImageData !== "function") {
      return;
    }
    for (const l of paperdollLayers({ head: headNo }, "F2", "S")) {
      drawSprite(pc, a, "paperdoll", l, 0, 0, true);
    }
    let data: Uint8ClampedArray;
    try {
      data = pc.getImageData(0, 0, probe.width, probe.height).data;
    } catch {
      return;
    }
    let x0 = probe.width;
    let y0 = probe.height;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < probe.height; y++) {
      for (let x = 0; x < probe.width; x++) {
        if ((data[(y * probe.width + x) * 4 + 3] ?? 0) > 0) {
          x0 = Math.min(x0, x);
          y0 = Math.min(y0, y);
          x1 = Math.max(x1, x);
          y1 = Math.max(y1, y);
        }
      }
    }
    if (x1 < 0) {
      return;
    }
    const left = DOLL_BOX.x + DOLL_BOX.w / 2 - (x0 + x1 + 1) / 2;
    const top = DOLL_BOX.y + DOLL_BOX.h / 2 - (y0 + y1 + 1) / 2;
    at(doll, Math.round(left), Math.round(top), PAPERDOLL_SIZE.w, PAPERDOLL_SIZE.h);
    dollCentred = true;
  };

  const drawDoll = () => {
    const ctx = doll.getContext("2d");
    if (!ctx) {
      return;
    }
    ctx.clearRect(0, 0, doll.width, doll.height);
    const layers = paperdollLayers({ head: headNo, equip: inventory?.equip }, "F2", "S");
    const paint = () => {
      centreDoll();
      ctx.clearRect(0, 0, doll.width, doll.height);
      for (const l of layers) {
        drawSprite(ctx, a, "paperdoll", l, 0, 0, true);
      }
    };
    if (a.sheets.paperdoll) {
      paint();
    } else {
      void a.loadGroup("paperdoll").then(paint);
    }
  };

  // ---- spellbook page (frame 67) ---------------------------------------------------------
  const spellbook = createSpellbook(a, {
    sound: (sfx) => act.sound(sfx),
    say: (text) => act.say(text),
  });
  el.append(spellbook.page);

  const panel: Panel = {
    el,
    menu,
    menuLayer,
    tab: "stats",
    spellbook,
    setTab(t) {
      if (t !== "spellbook") {
        // Leaving frame 67 ends sprite 44's span: member 199 again (an assumption: 1.6's files do
        // not say).
        spellbook.disarm();
      }
      panel.tab = t;
      for (const [k, img] of Object.entries(highlight)) {
        img.hidden = k !== t;
      }
      statsPage.hidden = t !== "stats";
      invPage.hidden = t !== "inventory";
      skillsPage.hidden = t !== "skills";
      spellbook.page.hidden = t !== "spellbook";
      menu.hidden = true;
    },
    setInventory(inv, head) {
      inventory = inv;
      headNo = head;
      gold.textContent = String(inv.gold);
      bagLayer.replaceChildren();
      inv.bag.forEach((line, i) => {
        const x = BAG_X(i);
        const y = BAG_Y(i);
        // Bag clicks are on channels 45-59, slot i on channel 45 + i (score frame 63).
        const hit = tagAction(document.createElement("button"), "inventory-select-slot");
        hit.type = "button";
        hit.className = "bag-slot";
        at(hit, x - 16, y + 4, 32, 34);
        hit.setAttribute(
          "aria-label",
          line ? `${displayName(line.item)}, ${line.qty}` : `Empty slot ${i + 1}`,
        );
        if (line) {
          bagLayer.append(spriteCanvas(a, "items", bagPicture(line.item), x, y));
          if (line.qty > 1) {
            const q = field(String(line.qty), "qty");
            at(q, QTY_X[i % 5] as number, QTY_Y[Math.floor(i / 5)] as number, 39, 13);
            bagLayer.append(q);
          }
          hit.addEventListener("click", (e) => {
            if (act.slotClicked && !act.slotClicked()) {
              return;
            }
            // Stage coordinates from the panel's own box, whatever the frame is scaled to.
            const r = panel.el.getBoundingClientRect();
            const scale = r.width / 234 || 1;
            openMenu(
              i + 1,
              line.item,
              PANEL_X + (e.clientX - r.left) / scale,
              (e.clientY - r.top) / scale,
            );
          });
        }
        bagLayer.append(hit);
      });
      equipNow = inv.equip;
      equipLayer.replaceChildren();
      for (const box of EQUIP_BOX) {
        const item = inv.equip[box.field];
        // The icon itself is not clickable (sprites 75-80 carry no behaviour, score frame 63).
        if (item !== "NOTHING") {
          const c = boxCentre(box.col, box.row);
          equipLayer.append(centredCanvas(a, "items", item, c.x, c.y));
        }
        marks
          .get(box.slot)
          ?.setAttribute(
            "aria-label",
            item === "NOTHING" ? `${box.slot}: empty` : `${box.slot}: take off ${item}`,
          );
      }
      drawDoll();
    },
    setStats(s) {
      values.textContent = `${s.str}\n\n${s.sta}\n\n${s.int}\n\n${s.wis}\n\n${s.dex}`;
    },
    setSkills(skills) {
      const rows = classesData.skillPanel;
      names.textContent = rows.map((r) => r.name).join("\n");
      amounts.textContent = rows.map((r) => skills[r.index - 1] ?? 0).join("\n");
    },
  };
  panel.setTab("stats");
  return panel;
}
