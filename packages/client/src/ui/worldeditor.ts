/**
 * The World Editor: frames 262-288, resting on 263, every piece at its score rect (top-left = loc −
 * regpoint, assets/original/main/layout/score-spans.jsonl). The server
 * checks everything a save holds.
 *
 * On entering: Pencil, palette page 1, layer 1, tile G1, the chat strip empty; the map you were on
 * is loaded.
 *
 * - Canvas (channel 1, its own click script): with a tile selected, holding the button paints
 *   wherever the pointer goes until it is released; with a monster, NPC or item selected, a click
 *   places it in the first free sprite. Placed items take the click on their tile (the ground-item
 *   click script): Delete removes, a sign opens its text, an exit opens its panel. A placed
 *   monster's sprite takes the click and does nothing (its click script exits on an empty slot).
 * - Palette (channels 5-64, its tile-select script), its page arrows (members 24 and 14), the
 *   BLOCKED TILE box (sprite 142).
 * - Layers 1, 2, 3, S (members 74-78) and the brushes (85-88), LOAD (5), SAVE (6), the map arrows
 *   (30-33), the header, the flag boxes, the lists (17-20, 46, 47), the clear boxes (138-140), the
 *   colour gradient (62), the exit and sign panels (15, 34, Internal 91, Internal 10), the chat
 *   strip (55, 56).
 */

import { monstersData } from "@secondstaronline/data";
import {
  BLEND_LEVELS,
  type Brush,
  clickFaction,
  clickLayer,
  EDITOR_ITEM_SLOTS,
  EDITOR_ITEMS,
  EDITOR_MONSTERS,
  EDITOR_NPCS,
  type EditorItem,
  type EditorMap,
  type EditorMob,
  EMPTY_EXIT_FIELDS,
  type ExitFields,
  exitFieldsAfterLoad,
  exitFromFields,
  type FactionBoxes,
  FOG_TEXTURES,
  factionBoxes,
  factionFlag,
  type LayerButtons,
  MAP_HEIGHT,
  MAP_WIDTH,
  PALETTE_PAGES,
  paint,
  palettePage,
  START_LAYERS,
  stepPaletteOf,
  TILE_DEFAULTS,
  tileBlocked,
} from "@secondstaronline/shared";

import { type Assets, drawSprite } from "../assets.ts";
import { drawFog, fogLayer } from "../fog.ts";
import { action } from "./action.ts";
import type { Screen } from "./screens.ts";
import { artImg, type Rect, type StageItem } from "./stage.ts";

export interface WorldEditorActions {
  load(mx: number, my: number): void;
  save(map: EditorMap): void;
}

export interface WorldEditor {
  screen: Screen;
  /** A map arrived. */
  show(map: EditorMap, exists: boolean): void;
  /** A chat line: the editor's own chat strip shows it too. */
  addChat(text: string): void;
  /** The map as SAVE would send it. */
  current(): EditorMap;
  /** Test hooks: a click or drag on the canvas at a tile. */
  canvasDown(x: number, y: number): void;
  canvasUp(x: number, y: number): void;
}

/** "Close the chat before placing a tile please." on 1 drag-frame in 20. */
export const CHAT_OPEN_TEXT = "Close the chat before placing a tile please.";

const editorAction = (label: string) => `editor-${label.toLowerCase().replaceAll(" ", "-")}`;

/** The canvas: sprite 1 at [16, 33], 544×384. */
const CANVAS: Rect = { x: 16, y: 33, w: 544, h: 384 };

/** Palette sprite k (0-59): 6 columns from x 590, rows from y 46 (centres), 32×32. */
function paletteRect(k: number): Rect {
  const col = k % 6;
  const row = Math.floor(k / 6);
  const ys = [46, 81, 116, 151, 185, 220, 255, 290, 325, 360];
  return { x: 590 + 35 * col - 16, y: (ys[row] ?? 46) - 16, w: 32, h: 32 };
}

const BODY = new Map(monstersData.monsters.map((m) => [m.name.toLowerCase(), m.body]));

function hitButton(label: string, origin: string, onClick: (e: MouseEvent) => void) {
  const b = action(document.createElement("button"), origin);
  b.type = "button";
  b.className = "hit";
  b.setAttribute("aria-label", label);
  b.addEventListener("click", onClick);
  return b;
}

function textField(label: string, origin: string, cls: string): HTMLInputElement {
  const i = action(document.createElement("input"), origin);
  i.type = "text";
  i.className = `field ${cls}`;
  i.spellcheck = false;
  i.setAttribute("aria-label", label);
  return i;
}

/** A scroll list field whose lines select on click (members 17-20, 46, 47). */
function list(
  label: string,
  origin: string,
  lines: readonly string[],
  onPick: (line: string) => void,
) {
  const box = action(document.createElement("div"), origin);
  box.className = "we-list";
  box.setAttribute("role", "listbox");
  box.setAttribute("aria-label", label);
  const rows: HTMLDivElement[] = [];
  for (const line of lines) {
    const row = document.createElement("div");
    row.className = "we-row";
    row.textContent = line;
    row.setAttribute("role", "option");
    rows.push(row);
    box.append(row);
  }
  box.addEventListener("click", (e) => {
    const row = (e.target as HTMLElement).closest(".we-row");
    for (const r of rows) {
      r.classList.toggle("on", r === row);
    }
    // A click below the last line clears the selection.
    onPick(row instanceof HTMLDivElement ? (row.textContent ?? "") : "");
  });
  const clear = () => {
    for (const r of rows) {
      r.classList.remove("on");
    }
  };
  return { box, clear };
}

/** The palette's pages; a test passes its own to give the catalogue an added tile. */
export interface PaletteSource {
  pages: number;
  page: (page: number) => string[];
}

export function createWorldEditor(
  assets: Assets,
  actions: WorldEditorActions,
  palette: PaletteSource = { pages: PALETTE_PAGES, page: palettePage },
): WorldEditor {
  const items: StageItem[] = [];
  const add = (el: HTMLElement, r: Rect, z: number, art = false) => {
    items.push({ el, ...r, z, art });
    return el;
  };
  const art = (m: number, alt = "") => artImg(assets.ui("worldedit", m), alt);

  // ---- state -------------------------------------------------------------------------------
  let map: EditorMap | null = null;
  let tile = TILE_DEFAULTS.editorTile;
  let page = 1;
  let brush: Brush = "pencil";
  let layers: LayerButtons = START_LAYERS;
  let clickType: "tile" | "npc" | "monster" | "item" = "tile";
  let npcSel = "";
  let monSel = "";
  let itemSel = "";
  let faction: FactionBoxes = { w: false, m: false, a: false };
  const flags = { safe: false, noPvp: false, indoor: false };
  let exit1: ExitFields = [...EMPTY_EXIT_FIELDS];
  let exit2: ExitFields = [...EMPTY_EXIT_FIELDS];
  let whichSign: 1 | 2 | 3 = 1;
  let chatOpen = false;
  /** Sprite 292 swapped to a blank member by the sign panel's background until editor exit. */
  let exitXGone = false;
  let mobs: (EditorMob | null)[] = [null, null, null, null];
  let placed: (EditorItem | null)[] = Array(EDITOR_ITEM_SLOTS).fill(null);
  let fogTex: HTMLCanvasElement | null = null;

  // ---- background and canvas ---------------------------------------------------------------
  add(art(1, "World Editor"), { x: 0, y: 0, w: 800, h: 600 }, 2, true);
  const canvas = action(document.createElement("canvas"), "editor-map");
  canvas.width = CANVAS.w;
  canvas.height = CANVAS.h;
  canvas.className = "we-canvas";
  canvas.setAttribute("aria-label", "Map");
  add(canvas, CANVAS, 3);
  const grid = document.createElement("canvas");

  // ---- top bar: X, Y, brushes, LOAD, SAVE --------------------------------------------------
  const fx = textField("Map X", editorAction("Map X"), "we-xy");
  const fy = textField("Map Y", editorAction("Map Y"), "we-xy");
  add(fx, { x: 35, y: 11, w: 50, h: 12 }, 73);
  add(fy, { x: 105, y: 11, w: 50, h: 12 }, 74);
  const brushImgs = [art(89), art(86), art(87)];
  (["pencil", "bucket", "fat"] as const).forEach((b, i) => {
    // Members 85-87 (the "off" art of the three brushes): only the "off" member has a script.
    const btn = hitButton(
      ["Pencil", "Paint bucket", "Fat brush"][i] as string,
      editorAction(["Pencil", "Paint bucket", "Fat brush"][i] as string),
      () => {
        if (brush !== b) {
          brush = b;
          drawBrushes();
        }
      },
    );
    btn.append(brushImgs[i] as HTMLImageElement);
    add(btn, { x: 415 + 15 * i, y: 11, w: 13, h: 14 }, 75 + i);
  });
  const drawBrushes = () => {
    const members = [
      brush === "pencil" ? 89 : 85,
      brush === "bucket" ? 90 : 86,
      brush === "fat" ? 91 : 87,
    ];
    brushImgs.forEach((img, i) => {
      img.src = assets.ui("worldedit", members[i] as number);
    });
  };
  const readXY = (): { mx: number; my: number } | null => {
    const mx = Number.parseInt(fx.value, 10);
    const my = Number.parseInt(fy.value, 10);
    return Number.isNaN(mx) || Number.isNaN(my) ? null : { mx, my };
  };
  const load = () => {
    const xy = readXY();
    if (xy) {
      actions.load(xy.mx, xy.my);
    }
  };
  const loadBtn = hitButton("Load", editorAction("Load"), load);
  loadBtn.append(art(5, "LOAD"));
  add(loadBtn, { x: 457, y: 5, w: 52, h: 24 }, 3);
  const saveBtn = hitButton("Save", editorAction("Save"), () => {
    const m = current();
    if (m) {
      actions.save(m);
    }
  });
  saveBtn.append(art(6, "SAVE"));
  add(saveBtn, { x: 505, y: 5, w: 52, h: 24 }, 4);

  // ---- layer buttons (S, 3, 2, 1 top to bottom; members 74-78) -----------------------
  const layerDefs = [
    {
      key: "s",
      label: "Shadow layer",
      on: 74,
      off: 75,
      rect: { x: 3, y: 28, w: 11, h: 12 },
      ch: 93,
    },
    { key: "l3", label: "Layer 3", on: 79, off: 76, rect: { x: 3, y: 43, w: 11, h: 12 }, ch: 90 },
    { key: "l2", label: "Layer 2", on: 80, off: 77, rect: { x: 3, y: 58, w: 11, h: 12 }, ch: 91 },
    { key: "l1", label: "Layer 1", on: 81, off: 78, rect: { x: 3, y: 73, w: 11, h: 13 }, ch: 92 },
  ] as const;
  const layerImgs = layerDefs.map((d) => {
    const img = art(d.off);
    const btn = hitButton(d.label, editorAction(d.label), () => {
      layers = clickLayer(layers, d.key);
      drawLayerButtons();
    });
    btn.append(img);
    add(btn, d.rect, d.ch);
    return img;
  });
  const drawLayerButtons = () => {
    layerDefs.forEach((d, i) => {
      (layerImgs[i] as HTMLImageElement).src = assets.ui(
        "worldedit",
        layers.lit[d.key] ? d.on : d.off,
      );
    });
  };

  // ---- map arrows (members 30-33) ----------------------------------------------------
  for (const [label, m, rect, ch, dx, dy] of [
    ["Map west", 30, { x: 4, y: 215, w: 15, h: 45 }, 299, -1, 0],
    ["Map east", 31, { x: 555, y: 215, w: 15, h: 45 }, 300, 1, 0],
    ["Map north", 32, { x: 275, y: 17, w: 45, h: 15 }, 297, 0, -1],
    ["Map south", 33, { x: 275, y: 406, w: 45, h: 15 }, 298, 0, 1],
  ] as const) {
    const btn = hitButton(label, editorAction(label), () => {
      const xy = readXY();
      if (!xy) {
        return;
      }
      fx.value = String(xy.mx + dx);
      fy.value = String(xy.my + dy);
      load();
    });
    btn.append(art(m));
    add(btn, rect, ch);
  }

  // ---- palette ------------------------------------------------------------------------------
  const paletteBtns: HTMLButtonElement[] = [];
  for (let k = 0; k < 60; k++) {
    const c = document.createElement("canvas");
    c.width = 32;
    c.height = 32;
    const btn = hitButton("Tile", editorAction("Tile"), () => {
      const code = btn.dataset.code;
      if (!code) {
        return;
      }
      clickType = "tile";
      tile = code;
      drawPaletteMarks();
    });
    btn.append(c);
    paletteBtns.push(btn);
    add(btn, paletteRect(k), 5 + k);
  }
  const selBox = art(4);
  add(selBox, { x: 571, y: 27, w: 38, h: 38 }, 70, true);
  const blockedImg = art(11, "Blocked tile");
  add(blockedImg, { x: 727, y: 431, w: 14, h: 14 }, 142, true);
  const drawPalette = () => {
    const codes = palette.page(page);
    paletteBtns.forEach((btn, k) => {
      const code = codes[k];
      // 1.6 left a sprite past member 589 on its old member, so page 10's last 11 slots showed
      // stale tiles and could be clicked. SSO diverges: an empty slot on any page is blank and
      // unclickable.
      if (!code) {
        delete btn.dataset.code;
        btn.removeAttribute("aria-label");
        btn.disabled = true;
        (btn.firstChild as HTMLCanvasElement).getContext("2d")?.clearRect(0, 0, 32, 32);
      }
      if (code) {
        btn.disabled = false;
        btn.dataset.code = code;
        btn.setAttribute("aria-label", `Tile ${code}`);
        const c = btn.firstChild as HTMLCanvasElement;
        const ctx = c.getContext("2d");
        if (ctx) {
          // Ink 0 (copy) on channels 5-64 (frame 261): a tile's keyed green shows as green.
          ctx.fillStyle = "rgb(0,255,0)";
          ctx.fillRect(0, 0, 32, 32);
          drawSprite(ctx, assets, "tiles", code, 0, 0, true);
        }
      }
    });
    drawPaletteMarks();
  };
  const drawPaletteMarks = () => {
    const k = paletteBtns.findIndex((b) => b.dataset.code === tile);
    // Sprite 70 moves onto the clicked tile; it stays where it was on a page change.
    if (k >= 0 && clickType === "tile") {
      const r = paletteRect(k);
      selBox.style.left = `${r.x - 3}px`;
      selBox.style.top = `${r.y - 3}px`;
    }
    blockedImg.src = assets.ui("worldedit", tileBlocked(tile) ? 12 : 11);
  };
  const pageBtn = (m: 24 | 14, delta: 1 | -1, rect: Rect, ch: number, label: string) => {
    const btn = hitButton(label, editorAction(label), () => {
      page = stepPaletteOf(page, delta, palette.pages);
      drawPalette();
    });
    btn.append(art(m));
    add(btn, rect, ch);
  };
  pageBtn(24, -1, { x: 784, y: 26, w: 16, h: 70 }, 71, "Previous tiles");
  pageBtn(14, 1, { x: 784, y: 98, w: 16, h: 70 }, 65, "Next tiles");

  // ---- header -------------------------------------------------------------------------------
  const hddr = document.createElement("div");
  hddr.className = "we-label";
  hddr.textContent = "Header:";
  // Hddr (channel 67, [25, 439, 352, 455]) lies over most of the header field (66); it is a label
  // and passes clicks to the field (.we-label, pointer-events: none).
  add(hddr, { x: 25, y: 439, w: 327, h: 16 }, 67, true);
  const header = textField("Header", editorAction("Header"), "we-header");
  add(header, { x: 84, y: 439, w: 319, h: 16 }, 66);

  // ---- flag boxes ---------------------------------------
  const box = (label: string, ch: number, rect: Rect, onClick: () => void) => {
    const img = art(11);
    const btn = hitButton(label, editorAction(label), () => {
      onClick();
      drawBoxes();
    });
    btn.append(img);
    add(btn, rect, ch);
    return img;
  };
  const safeImg = box("Safe area", 145, { x: 671, y: 456, w: 14, h: 14 }, () => {
    flags.safe = !flags.safe;
  });
  const pvpImg = box("No PvP", 144, { x: 671, y: 472, w: 14, h: 14 }, () => {
    flags.noPvp = !flags.noPvp;
  });
  const indoorImg = box("Indoor", 147, { x: 671, y: 488, w: 14, h: 14 }, () => {
    flags.indoor = !flags.indoor;
  });
  const fW = box("Faction W", 150, { x: 671, y: 505, w: 14, h: 14 }, () => {
    faction = clickFaction(faction, "w");
  });
  const fM = box("Faction M", 151, { x: 715, y: 505, w: 14, h: 14 }, () => {
    faction = clickFaction(faction, "m");
  });
  const fA = box("Faction A", 152, { x: 756, y: 505, w: 14, h: 14 }, () => {
    faction = clickFaction(faction, "a");
  });
  const drawBoxes = () => {
    const set = (img: HTMLImageElement, on: boolean) => {
      img.src = assets.ui("worldedit", on ? 12 : 11);
    };
    set(safeImg, flags.safe);
    set(pvpImg, flags.noPvp);
    set(indoorImg, flags.indoor);
    set(fW, faction.w);
    set(fM, faction.m);
    set(fA, faction.a);
  };

  // ---- lists --------------------------------------------------------------------------------
  const npcList = list("NPCs", editorAction("NPCs"), EDITOR_NPCS, (l) => {
    npcSel = l;
    clickType = "npc";
  });
  add(npcList.box, { x: 21, y: 512, w: 87, h: 61 }, 68);
  const monList = list("Monsters", editorAction("Monsters"), EDITOR_MONSTERS, (l) => {
    monSel = l;
    clickType = "monster";
  });
  add(monList.box, { x: 120, y: 513, w: 95, h: 60 }, 69);
  const itemList = list("Items", editorAction("Items"), EDITOR_ITEMS, (l) => {
    itemSel = l;
    clickType = "item";
  });
  add(itemList.box, { x: 243, y: 513, w: 94, h: 60 }, 72);
  let fog = { tex: "NoTex", blend: 0, r: 255, g: 255, b: 255 };
  const fogList = list("Fog texture", editorAction("Fog texture"), FOG_TEXTURES, (l) => {
    // The fog texture is set by name; NoTex clears the preview but keeps the blend.
    fog = { ...fog, tex: l };
    void redrawFog();
  });
  add(fogList.box, { x: 362, y: 513, w: 71, h: 60 }, 78);
  const blendList = list(
    "Blend level",
    editorAction("Blend level"),
    BLEND_LEVELS.map(String),
    (l) => {
      // An empty line gives VOID, read as 0 (an assumption: 1.6's files do not say).
      fog = { ...fog, blend: Number.parseInt(l, 10) || 0 };
      void redrawFog();
    },
  );
  add(blendList.box, { x: 439, y: 513, w: 40, h: 60 }, 79);

  // ---- clear boxes (members 138-140) ----------------------------------------------------
  const clearMobs = () => {
    mobs = [null, null, null, null];
    draw();
  };
  for (const [label, ch, rect, act] of [
    ["Clear NPCs", 138, { x: 21, y: 495, w: 15, h: 14 }, clearMobs],
    ["Clear monsters", 139, { x: 117, y: 494, w: 15, h: 14 }, clearMobs],
    [
      "Clear items",
      140,
      { x: 239, y: 494, w: 15, h: 14 },
      () => {
        // Every item, and the sign texts.
        placed = Array(EDITOR_ITEM_SLOTS).fill(null);
        if (map) {
          map.signs = ["", "", ""];
        }
        signText.value = "";
        draw();
      },
    ],
  ] as const) {
    const btn = hitButton(label, editorAction(label), act);
    btn.append(art(10));
    add(btn, rect, ch);
  }

  // ---- colour gradient ------------------------------------------------
  const gradient = art(62, "Fog colour");
  const pick = hitButton("Fog colour", editorAction("Fog colour"), (e) => {
    const r = pick.getBoundingClientRect();
    const scale = r.width > 0 ? r.width / 36 : 1;
    const px = Math.floor((e.clientX - r.left) / scale);
    const py = Math.floor((e.clientY - r.top) / scale);
    const c = document.createElement("canvas");
    c.width = 36;
    c.height = 53;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx || !gradient.complete) {
      return;
    }
    ctx.drawImage(gradient, 0, 0);
    const d = ctx.getImageData(
      Math.max(0, Math.min(35, px)),
      Math.max(0, Math.min(52, py)),
      1,
      1,
    ).data;
    fog = { ...fog, r: d[0] ?? 0, g: d[1] ?? 0, b: d[2] ?? 0 };
    void redrawFog();
  });
  pick.append(gradient);
  add(pick, { x: 502, y: 516, w: 36, h: 53 }, 357);

  // ---- exit panels (sprites 290-295 and 275-280; member 15 closes both) ----------
  const exitPanel = (n: 1 | 2) => {
    const el = document.createElement("div");
    el.className = "we-panel";
    el.hidden = true;
    const ok = hitButton("OK", editorAction("OK"), () => {
      panel1.el.hidden = true;
      panel2.el.hidden = true;
      readExitFields();
    });
    ok.append(art(n === 1 ? 15 : 34, "OK"));
    const fieldIds = n === 1 ? [25, 26, 27, 28] : [49, 50, 51, 52];
    const labels = ["Exit map X", "Exit map Y", "Exit tile X", "Exit tile Y"];
    const rects: Rect[] =
      n === 1
        ? [
            { x: 176, y: 178, w: 47, h: 12 },
            { x: 177, y: 197, w: 47, h: 12 },
            { x: 278, y: 178, w: 24, h: 16 },
            { x: 277, y: 196, w: 22, h: 16 },
          ]
        : [
            { x: 177, y: 178, w: 44, h: 16 },
            { x: 177, y: 197, w: 47, h: 16 },
            { x: 279, y: 177, w: 24, h: 16 },
            { x: 278, y: 196, w: 22, h: 16 },
          ];
    const base: Rect =
      n === 1 ? { x: 111, y: 171, w: 205, h: 67 } : { x: 108, y: 169, w: 210, h: 72 };
    const bg = art(16);
    bg.style.cssText = `position:absolute;left:0;top:0;width:${base.w}px;height:${base.h}px`;
    el.append(bg);
    const inputs = fieldIds.map((_m, i) => {
      const input = textField(labels[i] as string, editorAction(labels[i] as string), "we-exit");
      const r = rects[i] as Rect;
      input.style.cssText = `position:absolute;left:${r.x - base.x}px;top:${r.y - base.y}px;width:${r.w}px;height:${r.h}px`;
      el.append(input);
      return input;
    });
    const okRect: Rect =
      n === 1 ? { x: 256, y: 213, w: 60, h: 25 } : { x: 258, y: 213, w: 60, h: 25 };
    ok.style.cssText = `position:absolute;left:${okRect.x - base.x}px;top:${okRect.y - base.y}px;width:60px;height:25px`;
    el.append(ok);
    add(el, base, n === 1 ? 8900 : 8910);
    return { el, inputs };
  };
  const panel1 = exitPanel(1);
  const panel2 = exitPanel(2);
  const readExitFields = () => {
    exit1 = panel1.inputs.map((i) => i.value) as ExitFields;
    exit2 = panel2.inputs.map((i) => i.value) as ExitFields;
  };
  const writeExitFields = () => {
    panel1.inputs.forEach((i, k) => {
      i.value = exit1[k] ?? "";
    });
    panel2.inputs.forEach((i, k) => {
      i.value = exit2[k] ?? "";
    });
  };
  const showExitPanel = (n: 1 | 2) => {
    const p = n === 1 ? panel1 : panel2;
    p.el.hidden = false;
    if (n === 1) {
      // Showing the exit panel makes 290-295 visible again; 292 keeps its blank member once
      // swapped.
      (panel1.inputs[0] as HTMLInputElement).hidden = exitXGone;
      (panel1.inputs[1] as HTMLInputElement).hidden = false;
      (panel1.inputs[2] as HTMLInputElement).hidden = false;
    }
  };

  // ---- sign panel (286-288; Internal 91 saves it, Internal 10 is its background) -----
  const signPanel = document.createElement("div");
  signPanel.className = "we-panel";
  signPanel.hidden = true;
  const signBg = action(document.createElement("div"), "editor-sign-background");
  signBg.className = "we-sign-bg";
  signBg.append(artImg(assets.ui("internal", 10)));
  signBg.addEventListener("click", () => {
    // With exit panel 1 open, its map X field (sprite 292) becomes
    // blank and 292-294 hide (kept bug: 1.6 did it, so the sign panel breaks the
    // exit panel's map X field).
    if (!panel1.el.hidden && !(panel1.inputs[0] as HTMLInputElement).hidden) {
      exitXGone = true;
      (panel1.inputs[0] as HTMLInputElement).hidden = true;
      (panel1.inputs[1] as HTMLInputElement).hidden = true;
      (panel1.inputs[2] as HTMLInputElement).hidden = true;
    }
  });
  const signText = action(document.createElement("textarea"), "editor-sign-text");
  signText.className = "field we-sign";
  signText.setAttribute("aria-label", "Sign text");
  const signOk = hitButton("OK", "editor-sign-save", () => {
    if (map) {
      map.signs[whichSign - 1] = signText.value;
    }
    signPanel.hidden = true;
  });
  signOk.append(artImg(assets.ui("internal", 91), "OK"));
  signBg.style.cssText = "position:absolute;left:0;top:0;width:285px;height:113px";
  signText.style.cssText = "position:absolute;left:26px;top:20px;width:228px;height:54px";
  signOk.style.cssText = "position:absolute;left:224px;top:64px;width:39px;height:29px";
  signPanel.append(signBg, signText, signOk);
  add(signPanel, { x: 72, y: 138, w: 285, h: 113 }, 9995);
  const showSign = (n: 1 | 2 | 3) => {
    whichSign = n;
    signText.value = map?.signs[n - 1] ?? "";
    signPanel.hidden = false;
  };

  // ---- chat strip (356 closed/open, 362 the editor's chat) -----------------------------------
  const chatBar = action(document.createElement("div"), "editor-chat-toggle");
  chatBar.className = "we-chatbar";
  const chatImg = art(56);
  chatImg.classList.add("we-chatimg");
  chatBar.append(chatImg);
  chatBar.addEventListener("click", (e) => {
    if (!chatOpen) {
      chatOpen = true;
    } else {
      // The open strip closes only left of x 67.
      const r = chatBar.getBoundingClientRect();
      const scale = r.width > 0 ? r.width / 387 : 1;
      const stageX = 15 + (e.clientX - r.left) / scale;
      if (stageX >= 67) {
        return;
      }
      chatOpen = false;
    }
    drawChat();
  });
  // The strip takes clicks only on the member it shows: the closed member [15, 465, 402, 479]
  // closed, the open member [15, 389, 402, 479] open (frame 261 channel 356). A closed strip sized
  // like it covered the header field and opened the chat instead.
  add(chatBar, { x: 15, y: 465, w: 387, h: 14 }, 9998);
  const chatLog = document.createElement("div");
  chatLog.className = "we-chat";
  chatLog.setAttribute("aria-label", "Chat");
  add(chatLog, { x: 21, y: 401, w: 373, h: 74 }, 9999);
  const drawChat = () => {
    chatImg.src = assets.ui("worldedit", chatOpen ? 55 : 56);
    // The open member is 387×90 from y 389; the closed one 387×14 from y 465 (registration points).
    chatBar.style.top = chatOpen ? "389px" : "465px";
    chatBar.style.height = chatOpen ? "90px" : "14px";
    chatLog.hidden = !chatOpen;
  };

  // ---- the canvas ------------------------------------------------------------------------------
  const gridReady = (() => {
    const img = new Image();
    return new Promise<void>((resolve) => {
      img.onload = () => {
        // WorldEdit #35, ink 36: its white is transparent; blend 229 (score channel 400).
        grid.width = 544;
        grid.height = 384;
        const g = grid.getContext("2d", { willReadFrequently: true });
        if (g) {
          g.drawImage(img, 0, 0);
          const d = g.getImageData(0, 0, 544, 384);
          for (let i = 0; i < d.data.length; i += 4) {
            if (d.data[i] === 255 && d.data[i + 1] === 255 && d.data[i + 2] === 255) {
              d.data[i + 3] = 0;
            }
          }
          g.putImageData(d, 0, 0);
        }
        resolve();
      };
      img.onerror = () => resolve();
      img.src = assets.ui("worldedit", 35);
    });
  })();
  const redrawFog = async () => {
    fogTex = await fogLayer(assets, fog);
    draw();
  };
  const draw = () => {
    const ctx = canvas.getContext("2d");
    if (!ctx || !map) {
      return;
    }
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgb(0,255,0)";
    ctx.fillRect(0, 0, CANVAS.w, CANVAS.h);
    // Channels 1 (layer 1), 102 (S, blend 178), 100 (2), 101 (3): locZ 1-4.
    const drawRows = (rows: readonly string[], alpha: number) => {
      ctx.globalAlpha = alpha;
      for (let y = 1; y <= MAP_HEIGHT; y++) {
        const codes = (rows[y - 1] ?? "").split(" ");
        for (let x = 1; x <= MAP_WIDTH; x++) {
          const code = codes[x - 1];
          if (code) {
            drawSprite(ctx, assets, "tiles", code, (x - 1) * 32, (y - 1) * 32, true);
          }
        }
      }
      ctx.globalAlpha = 1;
    };
    drawRows(map.layers[0], 1);
    drawRows(map.layers[3], 178 / 255);
    drawRows(map.layers[1], 1);
    drawRows(map.layers[2], 1);
    drawFog(ctx, fogTex, fog.blend);
    ctx.globalAlpha = 229 / 255;
    ctx.drawImage(grid, 0, 0);
    ctx.globalAlpha = 1;
    // Placed items at (X·32, Y·32 − 3) on the stage, monsters at Y·32 − 2.
    for (const it of placed) {
      if (it) {
        drawSprite(ctx, assets, "items", it.name, it.x * 32 - 16, it.y * 32 - 36);
      }
    }
    for (const m of mobs) {
      const body = m ? BODY.get(m.name.toLowerCase()) : undefined;
      if (m && body !== undefined) {
        drawSprite(ctx, assets, "bodies", `${body}-F2-S`, m.x * 32 - 16, m.y * 32 - 35);
      }
    }
  };

  /** The tile under a canvas pixel: the pixel position divided by 32, plus 1. */
  const tileAt = (e: PointerEvent | MouseEvent) => {
    const r = canvas.getBoundingClientRect();
    const scale = r.width > 0 ? r.width / CANVAS.w : 1;
    return {
      x: Math.floor((e.clientX - r.left) / scale / 32) + 1,
      y: Math.floor((e.clientY - r.top) / scale / 32) + 1,
    };
  };
  let down: { x: number; y: number } | null = null;
  let loop = 0;
  const paintAt = (x: number, y: number) => {
    if (!map || clickType !== "tile") {
      return;
    }
    if (chatOpen) {
      if (Math.floor(Math.random() * 20) === 0) {
        addChat(CHAT_OPEN_TEXT);
      }
      return;
    }
    // The original's bounds: x below 18 and y below 13.
    if (x > MAP_WIDTH || y > MAP_HEIGHT || x < 1 || y < 1) {
      return;
    }
    const l = layers.layer - 1;
    map.layers[l] = paint(map.layers[l] as string[], brush, tile, x, y);
    draw();
  };
  const placedAt = (x: number, y: number) => placed.findIndex((it) => it?.x === x && it?.y === y);
  const mobAt = (x: number, y: number) => mobs.findIndex((m) => m?.x === x && m?.y === y);
  /** A click on a placed item's sprite (the ground-item click script). */
  const clickItem = (k: number, x: number, y: number) => {
    const it = placed[k];
    if (!it) {
      return;
    }
    if (clickType === "item" && itemSel === "Delete") {
      placed[k] = null;
      draw();
      return;
    }
    const name = it.name.toLowerCase();
    const sign = name === "sign 1" ? 1 : name === "sign 2" ? 2 : name === "sign 3" ? 3 : null;
    if (sign) {
      showSign(sign);
      return;
    }
    if (name === "exit" || name === "exit2") {
      showExitPanel(name === "exit" ? 1 : 2);
      // With an item selected it is also placed on the same tile.
      if (clickType === "item") {
        place(itemSel, x, y);
      }
    }
  };
  const place = (name: string, x: number, y: number) => {
    const free = placed.indexOf(null);
    if (free < 0 || !name) {
      return;
    }
    placed[free] = { name, x, y };
    draw();
  };
  /** A click on the canvas itself (its mouse-up). */
  const clickCanvas = (x: number, y: number) => {
    if (clickType === "monster" || clickType === "npc") {
      const name = clickType === "monster" ? monSel : npcSel;
      const free = mobs.indexOf(null);
      if (free < 0 || !name) {
        return;
      }
      mobs[free] = { name, x, y };
      draw();
      return;
    }
    if (clickType === "item") {
      if (itemSel === "Delete") {
        return;
      }
      place(itemSel, x, y);
      if (itemSel === "Exit") {
        showExitPanel(1);
      } else if (itemSel === "Exit2") {
        showExitPanel(2);
      } else if (itemSel === "Sign 1" || itemSel === "Sign 2" || itemSel === "Sign 3") {
        showSign(Number(itemSel.slice(5)) as 1 | 2 | 3);
      }
    }
  };
  const canvasDown = (x: number, y: number) => {
    // A placed item or monster sprite is on top and takes the press.
    if (placedAt(x, y) >= 0 || mobAt(x, y) >= 0) {
      down = null;
      return;
    }
    down = { x, y };
    paintAt(x, y);
  };
  const canvasUp = (x: number, y: number) => {
    const k = placedAt(x, y);
    const wasDown = down;
    down = null;
    if (k >= 0) {
      clickItem(k, x, y);
      return;
    }
    if (mobAt(x, y) >= 0 || !wasDown) {
      return;
    }
    clickCanvas(x, y);
  };
  let last = { x: 0, y: 0 };
  canvas.addEventListener("pointerdown", (e) => {
    last = tileAt(e);
    canvasDown(last.x, last.y);
    if (down) {
      canvas.setPointerCapture?.(e.pointerId);
      // `repeat while the mouseDown`: paints every frame until the button is up.
      const step = () => {
        if (!down) {
          return;
        }
        paintAt(last.x, last.y);
        loop = requestAnimationFrame(step);
      };
      loop = requestAnimationFrame(step);
    }
  });
  canvas.addEventListener("pointermove", (e) => {
    if (down) {
      last = tileAt(e);
    }
  });
  canvas.addEventListener("pointerup", (e) => {
    cancelAnimationFrame(loop);
    const t = tileAt(e);
    canvasUp(t.x, t.y);
  });
  canvas.addEventListener("pointercancel", () => {
    cancelAnimationFrame(loop);
    down = null;
  });

  // ---- showing and saving --------------------------------------------------------------------
  const show = (m: EditorMap, _exists: boolean) => {
    map = {
      ...m,
      layers: [[...m.layers[0]], [...m.layers[1]], [...m.layers[2]], [...m.layers[3]]],
      signs: [...m.signs],
    };
    fx.value = String(m.mx);
    fy.value = String(m.my);
    header.value = m.header;
    flags.safe = m.flags.canFight === "O";
    flags.noPvp = m.flags.canPvp === "O";
    flags.indoor = m.flags.isIndoors === "O";
    faction = factionBoxes(m.flags.fctSpwn);
    exit1 = exitFieldsAfterLoad(m.exit1);
    exit2 = exitFieldsAfterLoad(m.exit2);
    writeExitFields();
    fog = { ...m.fog };
    mobs = [...m.mobs];
    placed = Array(EDITOR_ITEM_SLOTS).fill(null);
    m.items.slice(0, EDITOR_ITEM_SLOTS).forEach((it, i) => {
      placed[i] = { ...it };
    });
    panel1.el.hidden = true;
    panel2.el.hidden = true;
    signPanel.hidden = true;
    drawBoxes();
    void Promise.all([
      assets.loadGroup("tiles"),
      assets.loadGroup("items"),
      assets.loadGroup("bodies"),
      gridReady,
    ]).then(() => {
      drawPalette();
      void redrawFog();
    });
    draw();
  };

  const current = (): EditorMap => {
    readExitFields();
    const base = map ?? {
      mx: 0,
      my: 0,
      layers: [[], [], [], []] as EditorMap["layers"],
      signs: ["", "", ""] as EditorMap["signs"],
    };
    const xy = readXY() ?? { mx: base.mx, my: base.my };
    const fogOut =
      fog.tex.toLowerCase() === "notex"
        ? { tex: "NoTex", blend: 0, r: 255, g: 255, b: 255 }
        : { ...fog };
    return {
      mx: xy.mx,
      my: xy.my,
      layers: base.layers,
      flags: {
        canFight: flags.safe ? "O" : "X",
        fctSpwn: factionFlag(faction),
        isIndoors: flags.indoor ? "O" : "X",
        canPvp: flags.noPvp ? "O" : "X",
      },
      header: header.value,
      signs: [...base.signs],
      exit1: exitFromFields(exit1),
      exit2: exitFromFields(exit2),
      fog: fogOut,
      mobs: [mobs[0] ?? null, mobs[1] ?? null, mobs[2] ?? null, mobs[3] ?? null],
      items: placed.filter((it): it is EditorItem => it !== null),
    };
  };

  const addChat = (text: string) => {
    const line = document.createElement("div");
    line.textContent = text;
    chatLog.append(line);
    chatLog.scrollTop = chatLog.scrollHeight;
  };

  drawBrushes();
  drawLayerButtons();
  drawChat();

  return {
    screen: { items },
    show,
    addChat,
    current,
    canvasDown,
    canvasUp,
  };
}
