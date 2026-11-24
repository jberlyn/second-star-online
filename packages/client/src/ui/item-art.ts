/**
 * Item pictures on the Content page (issue #29, stage 2): a picker that uploads or chooses an
 * item's picture with no JSON to write, previews it in the bag, its equipment box and on the
 * ground, and fills in the anchor and transparency; and a bulk upload that attaches PNGs named
 * after items to those items. The picker is a component of its own, for the item editor (#30).
 *
 * What it writes is ordinary draft rows: `art/items/<item key>` for an upload (the picture's file,
 * anchor and transparency), and the item row's `sprite` when the item should draw another
 * picture. Publishing the draft makes them live.
 */
import type { ArtItem, Item } from "@secondstaronline/data";
import {
  applyTransparency,
  bagPicture,
  type ContentItemArtView,
  CURRENCY_PILES,
  type CurrencyPile,
  defaultItemAnchor,
  equipSlotFor,
  groundDrawOffset,
  groundPicture,
  groundPictureTopLeft,
  guessTransparency,
  ITEM_TILE_ANCHOR,
  isUniqueContainer,
  itemPictureReport,
  itemSprite,
  type PictureChange,
  type PictureReport,
  type PictureSettings,
  type PictureTransparency,
  type Pixels,
  pictureOf,
  showsClockFace,
} from "@secondstaronline/shared";

import { type Assets, drawSprite } from "../assets.ts";
import { action } from "./action.ts";
import { type StoredUpload, uploadUrl } from "./art-uploads.ts";
import { createTable, formField, panelButton } from "./control-panel-kit.ts";
import { BAG_X, BAG_Y, boxCentre, EQUIP_BOX } from "./panel.ts";

// ---- what the picker reads (pure) -------------------------------------------------------------

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** The picture an item draws: its `sprite`, else its key. */
export const pictureName = (item: Item): string => pictureOf(item);

/** The uploaded picture of that name in the draft, if any (names ignore case). */
export function artNamed(view: ContentItemArtView, name: string): ArtItem | undefined {
  return view.art.find((a) => same(a.name, name));
}

/** Whether a picture of that name will be drawn once the draft is published: an upload or a pack's. */
export function pictureExists(view: ContentItemArtView, name: string): boolean {
  return artNamed(view, name) !== undefined || view.packPictures.includes(name.toLowerCase());
}

/** The items other than `except` that draw the picture `name`. */
export function drawnBy(view: ContentItemArtView, name: string, except?: string): Item[] {
  return view.items.filter(
    (i) => (except === undefined || !same(i.name, except)) && same(pictureName(i), name),
  );
}

/** A file in a bulk upload and the item it attaches to. */
export interface FileMatch {
  file: string;
  item: Item | null;
  /** How it matched: the item's key, or the name players see. */
  by: "key" | "display" | null;
}

/** The name a file stands for: without its `.png`. */
export const fileStem = (file: string) => file.replace(/\.png$/i, "").trim();

/**
 * Matches files to items by name, ignoring case: the key first, then the name players see.
 * Retired items take no new picture (no more of them can be made).
 */
export function matchFiles(files: readonly string[], items: readonly Item[]): FileMatch[] {
  const live = items.filter((i) => !i.retired);
  return files.map((file) => {
    const stem = fileStem(file);
    const byKey = live.find((i) => same(i.name, stem));
    if (byKey) {
      return { file, item: byKey, by: "key" };
    }
    const byDisplay = live.find((i) => i.display !== undefined && same(i.display, stem));
    return byDisplay ? { file, item: byDisplay, by: "display" } : { file, item: null, by: null };
  });
}

/** What draws an item's picture now. */
export type PictureSource =
  | { kind: "upload"; art: ArtItem }
  | { kind: "pack"; name: string }
  | { kind: "none" };

/** Where an item's picture will come from once the draft is published: an upload, a pack, or nowhere. */
export function pictureSource(item: Item, view: ContentItemArtView): PictureSource {
  const name = pictureName(item);
  const art = artNamed(view, name);
  if (art) {
    return { kind: "upload", art };
  }
  return view.packPictures.includes(name.toLowerCase()) ? { kind: "pack", name } : { kind: "none" };
}

/**
 * The shared pictures the engine shows for the item in place of its own, view by view: a pool
 * picture (cabinets, crates, crystals, player art, maps), the currency's piles or the clock face.
 */
export function poolPictures(
  item: Item,
  currency: string | null,
): { bag?: string; ground?: string } {
  const out: { bag?: string; ground?: string } = {};
  const bag = bagPicture(item.name);
  if (!same(bag, itemSprite(item.name))) {
    out.bag = bag;
  }
  if (currency !== null && same(item.name, currency)) {
    out.ground = "SmallGold, MediumGold or LargeGold";
    return out;
  }
  // A carried container is placed with an `#id`, and shows its kind's picture then.
  const placed = isUniqueContainer(item.name) ? `${item.name}#1` : item.name;
  const ground = groundPicture(placed);
  if (ground !== placed) {
    out.ground = ground;
  } else if (showsClockFace(item.name)) {
    out.ground = "the clock face for the time";
  }
  return out;
}

/** What the picker says about those shared pictures. */
export function poolNotes(item: Item, currency: string | null): { bag?: string; ground?: string } {
  const p = poolPictures(item, currency);
  const out: { bag?: string; ground?: string } = {};
  if (p.bag) {
    out.bag = `In the bag it shows ${p.bag}, the picture every item like it shares.`;
  }
  if (currency !== null && same(item.name, currency)) {
    out.ground =
      "On the ground a pile of it shows SmallGold (1 to 49), MediumGold (50 to 99) or LargeGold (100 or more), whatever the currency is called: set those below.";
  } else if (p.ground === "the clock face for the time") {
    out.ground = "On the ground it shows the clock face for the time.";
  } else if (p.ground) {
    out.ground = `On the ground it shows ${p.ground}, the picture every item like it shares.`;
  }
  return out;
}

// ---- pixels -----------------------------------------------------------------------------------

/** Decodes a PNG (a URL or a file) to its pixels, or null when the browser cannot draw it. */
export async function loadPixels(src: string | Blob): Promise<Pixels | null> {
  const url = typeof src === "string" ? src : URL.createObjectURL(src);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("the picture could not be read"));
      i.src = url;
    });
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx || c.width === 0 || c.height === 0) {
      return null;
    }
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height);
    return { width: d.width, height: d.height, data: d.data };
  } catch {
    return null;
  } finally {
    if (typeof src !== "string") {
      URL.revokeObjectURL(url);
    }
  }
}

/** A copy of the pixels with the transparency applied. */
export function keyed(raw: Pixels, transparency: PictureTransparency): Pixels {
  const out = { width: raw.width, height: raw.height, data: new Uint8ClampedArray(raw.data) };
  applyTransparency(out, transparency);
  return out;
}

/** The settings a fresh upload starts with: its likely transparency, centred on the tile. */
export function freshSettings(
  file: string,
  raw: Pixels,
  maxSide: number,
): { settings: PictureSettings; report: PictureReport } {
  const transparency = guessTransparency(raw);
  const report = itemPictureReport(keyed(raw, transparency), transparency, maxSide);
  const anchor = report.bounds ? defaultItemAnchor(report.bounds) : { regX: 0, regY: 0 };
  return { settings: { file, transparency, ...anchor }, report };
}

/** A 32×32 pure green PNG: paint over it, and the green left over is see-through. */
export function templateUrl(): string {
  const c = document.createElement("canvas");
  c.width = 32;
  c.height = 32;
  const ctx = c.getContext("2d");
  if (!ctx) {
    return "";
  }
  ctx.fillStyle = "#00ff00";
  ctx.fillRect(0, 0, 32, 32);
  return c.toDataURL("image/png");
}

export function templateLink(
  id: string,
  download = "item-picture-template.png",
): HTMLAnchorElement {
  const a = action(document.createElement("a"), id);
  a.className = "item-art-template";
  a.textContent = "Download a 32×32 template";
  a.download = download;
  a.href = "#";
  a.addEventListener("click", () => {
    a.href = templateUrl();
  });
  return a;
}

/** What the templates say about an item picture. */
export const ITEM_PICTURE_RULES =
  "An item picture is a PNG: 32×32 fits a bag slot and the equipment boxes. See-through pixels (or pure green, when you choose it) are left out; the box round what shows is its hit box, and it is centred on its tile unless you drag it. The template is pure green, so whatever you leave green is see-through.";

// ---- previews ---------------------------------------------------------------------------------

/** What a preview draws: an atlas sprite the game has, or an upload's pixels with its settings. */
type PreviewSource =
  | { kind: "atlas"; name: string }
  | { kind: "pixels"; canvas: HTMLCanvasElement; settings: PictureSettings; report: PictureReport }
  | { kind: "none" };

/** The pixels on a canvas, for drawing. */
function pixelCanvas(p: Pixels): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = p.width;
  c.height = p.height;
  const ctx = c.getContext("2d");
  if (ctx) {
    ctx.putImageData(new ImageData(new Uint8ClampedArray(p.data), p.width, p.height), 0, 0);
  }
  return c;
}

/** The stage area the bag and box preview shows: the inventory page's bag and boxes. */
const PANEL_CROP = { x: 597, y: 96, w: 204, h: 304 } as const;
/** The ground preview: 3×3 tiles, the item on the middle one. */
const GROUND = { tiles: 3, tile: 32 } as const;
const GROUND_TILE = { x: 32, y: 32 } as const;
/** The item's anchor on the ground preview. */
const GROUND_ANCHOR = {
  x: GROUND_TILE.x + ITEM_TILE_ANCHOR.x,
  y: GROUND_TILE.y + ITEM_TILE_ANCHOR.y,
} as const;
/** The tile the ground preview is laid with (both shipped packs have this grass). */
const GRASS = "g1";

function loadedImg(src: string): Promise<HTMLImageElement | null> {
  if (!src) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => resolve(null);
    i.src = src;
  });
}

/** The panel art behind the bag and boxes, per asset set, once loaded (a failed load is retried). */
const panelArt = new WeakMap<Assets, Promise<(HTMLImageElement | null)[]>>();

/** Draws a picture in the first bag slot and centred in the equipment box it is worn in. */
async function drawPanel(
  c: HTMLCanvasElement,
  a: Assets,
  src: PreviewSource,
  slotOf: string,
  /** Whether this draw is still the latest (checked after every wait). */
  current: () => boolean = () => true,
): Promise<void> {
  const ctx = c.getContext("2d");
  if (!ctx) {
    return;
  }
  if (src.kind === "atlas") {
    await a.loadGroup("items").catch(() => {});
  }
  let art = panelArt.get(a);
  if (!art) {
    art = Promise.all([
      loadedImg(a.ui("internal", 188)),
      loadedImg(a.ui("internal", 186)),
      loadedImg(a.ui("inventory", 1)),
    ]);
    panelArt.set(a, art);
  }
  const imgs = await art;
  if (imgs.some((i) => i === null)) {
    panelArt.delete(a);
  }
  const [page, frame, boxes] = imgs;
  if (!current()) {
    return;
  }
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.fillStyle = "#3b2a1a";
  ctx.fillRect(0, 0, c.width, c.height);
  const at = (img: HTMLImageElement | null | undefined, x: number, y: number) => {
    if (img) {
      ctx.drawImage(img, x - PANEL_CROP.x, y - PANEL_CROP.y);
    }
  };
  at(page, 597, 53);
  at(frame, 566, 0);
  const inv = a.index.ui["inventory:1"];
  at(boxes, 693 - (inv?.regX ?? 67), 335 - (inv?.regY ?? 55));
  const slot = equipSlotFor(slotOf);
  const box = EQUIP_BOX.find((b) => b.slot === slot) ?? EQUIP_BOX[1];
  const centre = box ? boxCentre(box.col, box.row) : { x: 0, y: 0 };
  const bag = { x: BAG_X(0) - PANEL_CROP.x, y: BAG_Y(0) - PANEL_CROP.y };
  const cx = centre.x - PANEL_CROP.x;
  const cy = centre.y - PANEL_CROP.y;
  if (src.kind === "atlas") {
    drawSprite(ctx, a, "items", src.name, bag.x, bag.y);
    const s = a.sprite("items", src.name);
    if (s) {
      drawSprite(
        ctx,
        a,
        "items",
        src.name,
        Math.round(cx - s[3] / 2 + s[5]),
        Math.round(cy - s[4] / 2 + s[6]),
      );
    }
  } else if (src.kind === "pixels") {
    const { settings: s, report: r } = src;
    ctx.drawImage(src.canvas, bag.x - s.regX, bag.y - s.regY);
    if (r.bounds) {
      // The box centres the visible pixels (the game draws the trimmed picture).
      ctx.drawImage(
        src.canvas,
        r.bounds.x,
        r.bounds.y,
        r.bounds.w,
        r.bounds.h,
        Math.round(cx - r.bounds.w / 2),
        Math.round(cy - r.bounds.h / 2),
        r.bounds.w,
        r.bounds.h,
      );
    }
  }
}

/** How the ground preview pastes the picture: by its anchor, or by its corner (a pool picture). */
type GroundMode = "anchor" | "corner";

/** Draws the picture on grass, with its hit box and anchor when asked. */
async function drawGround(
  c: HTMLCanvasElement,
  a: Assets,
  src: PreviewSource,
  mode: GroundMode,
  guides: boolean,
  /** The item's own ground offset (`ground.offsets`), as the playfield adds it. */
  offset: { dx: number; dy: number } = { dx: 0, dy: 0 },
  current: () => boolean = () => true,
): Promise<void> {
  const ctx = c.getContext("2d");
  if (!ctx) {
    return;
  }
  await Promise.all([a.loadGroup("tiles"), a.loadGroup("items")].map((p) => p.catch(() => {})));
  if (!current()) {
    return;
  }
  const anchor = { x: GROUND_ANCHOR.x + offset.dx, y: GROUND_ANCHOR.y + offset.dy };
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.fillStyle = "#3f7a34";
  ctx.fillRect(0, 0, c.width, c.height);
  for (let ty = 0; ty < GROUND.tiles; ty++) {
    for (let tx = 0; tx < GROUND.tiles; tx++) {
      drawSprite(ctx, a, "tiles", GRASS, tx * GROUND.tile, ty * GROUND.tile, true);
    }
  }
  // The scratch member a pool picture is pasted into: (1, 1) inside the tile.
  const corner = groundPictureTopLeft(anchor.x, anchor.y);
  let box: { x: number; y: number; w: number; h: number } | null = null;
  if (src.kind === "atlas") {
    const s = a.sprite("items", src.name);
    if (mode === "corner") {
      drawSprite(ctx, a, "items", src.name, corner.x, corner.y, true);
      if (s) {
        box = { x: corner.x + (s[7] ?? 0), y: corner.y + (s[8] ?? 0), w: s[3], h: s[4] };
      }
    } else {
      drawSprite(ctx, a, "items", src.name, anchor.x, anchor.y);
      if (s) {
        box = { x: anchor.x - s[5], y: anchor.y - s[6], w: s[3], h: s[4] };
      }
    }
  } else if (src.kind === "pixels") {
    const { settings: s, report: r } = src;
    const x = mode === "corner" ? corner.x : anchor.x - s.regX;
    const y = mode === "corner" ? corner.y : anchor.y - s.regY;
    ctx.drawImage(src.canvas, x, y);
    if (r.bounds) {
      box = { x: x + r.bounds.x, y: y + r.bounds.y, w: r.bounds.w, h: r.bounds.h };
    }
  }
  if (guides) {
    if (box) {
      ctx.strokeStyle = "#ff00ff";
      ctx.lineWidth = 1;
      ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1);
    }
    if (mode === "anchor") {
      ctx.fillStyle = "#ffff00";
      ctx.fillRect(anchor.x - 2, anchor.y, 5, 1);
      ctx.fillRect(anchor.x, anchor.y - 2, 1, 5);
    }
  }
}

function previewCanvas(w: number, h: number, label: string, cls: string): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  c.className = `item-art-preview ${cls}`;
  c.setAttribute("role", "img");
  c.setAttribute("aria-label", label);
  return c;
}

function messages(report: PictureReport | null, extra: readonly string[] = []): HTMLElement {
  const ul = document.createElement("ul");
  ul.className = "item-art-messages";
  for (const e of report?.errors ?? []) {
    const li = document.createElement("li");
    li.className = "item-art-error";
    li.textContent = e;
    ul.append(li);
  }
  for (const w of [...(report?.warnings ?? []), ...extra]) {
    const li = document.createElement("li");
    li.className = "item-art-warning";
    li.textContent = w;
    ul.append(li);
  }
  return ul;
}

// ---- the picker -------------------------------------------------------------------------------

export interface ItemArtOptions {
  assets: Assets;
  /** Uploads one PNG; the stored file, or why it was refused. */
  upload(file: File): Promise<{ ok: true; stored: StoredUpload } | { ok: false; error: string }>;
  /** Puts one picture change in the draft (the server makes it as a whole). */
  apply(change: PictureChange): Promise<{ ok: boolean; text: string }>;
  /** Decodes a picture to pixels (default: through a canvas). */
  decode?(src: string | Blob): Promise<Pixels | null>;
  /** The draft changed: the page refreshes what it shows. */
  saved(): void;
}

export interface ItemArtPicker {
  readonly el: HTMLElement;
  /** Shows an item's picture (the view is the draft's, from `contentItemArt`). */
  show(item: Item, view: ContentItemArtView): void;
  clear(): void;
  /** A picture set up but not yet saved to the draft. */
  pending(): boolean;
}

/** An editable picture: an upload being set up, or a saved one being changed. */
interface Working {
  raw: Pixels;
  settings: PictureSettings;
}

/** The anchor and transparency controls and the previews of one picture. */
interface PictureEditor {
  el: HTMLElement;
  /** Draws the picture (an atlas sprite, or the working upload). */
  draw(src: { kind: "atlas"; name: string } | { kind: "none" } | null): void;
  /** The upload being set up, or null. */
  working: Working | null;
  setWorking(w: Working | null): void;
  report(): PictureReport | null;
}

function createPictureEditor(
  a: Assets,
  mode: GroundMode,
  maxSide: () => number,
  /** The item the picture is for (its slot, its ground offset), or "" for an engine picture. */
  nameOf: () => string,
  /** The shared pictures the game shows in place of this one, view by view. */
  poolOf: () => { bag?: string; ground?: string },
  /** After every redraw: `edited` when the admin changed the settings (not when shown). */
  onChange: (edited: boolean) => void,
  idPrefix: string,
): PictureEditor {
  const el = document.createElement("div");
  el.className = "item-art-editor";
  const previews = document.createElement("div");
  previews.className = "item-art-previews";
  const panel =
    mode === "anchor"
      ? previewCanvas(
          PANEL_CROP.w,
          PANEL_CROP.h,
          "In the bag and the equipment box",
          "item-art-panel",
        )
      : null;
  const ground = previewCanvas(
    GROUND.tiles * GROUND.tile,
    GROUND.tiles * GROUND.tile,
    mode === "anchor" ? "On the ground: drag to move the picture on its tile" : "On the ground",
    "item-art-ground",
  );
  const figure = (c: HTMLCanvasElement, caption: () => string) => {
    const f = document.createElement("figure");
    f.className = "item-art-figure";
    const cap = document.createElement("figcaption");
    f.append(c, cap);
    return { el: f, label: () => (cap.textContent = caption()) };
  };
  const panelFig = panel
    ? figure(panel, () => {
        const where =
          equipSlotFor(nameOf()) === "No"
            ? "In the bag, and in the weapon box for its size (it is not worn)"
            : "In the bag and its equipment box";
        const bag = poolOf().bag;
        return bag ? `${where}. In the game its bag line shows ${bag}.` : where;
      })
    : null;
  const groundFig = figure(ground, () => {
    const where =
      mode === "anchor" ? "On the ground: drag it to move it on its tile" : "On the ground";
    const shared = poolOf().ground;
    return shared ? `${where}. In the game the ground shows ${shared}.` : where;
  });
  if (panelFig) {
    previews.append(panelFig.el);
  }
  previews.append(groundFig.el);

  const guides = action(document.createElement("input"), `${idPrefix}-guides`);
  guides.type = "checkbox";
  guides.checked = true;
  const guidesLabel = document.createElement("label");
  guidesLabel.className = "item-art-check";
  guidesLabel.append(guides, " Show the hit box and the anchor");

  const transparency = action(document.createElement("select"), `${idPrefix}-transparency`);
  for (const [value, label] of [
    ["alpha", "Its own see-through pixels"],
    ["green", "Pure green is see-through"],
  ] as const) {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = label;
    transparency.append(o);
  }
  const regX = action(document.createElement("input"), `${idPrefix}-regx`);
  regX.type = "number";
  regX.step = "1";
  const regY = action(document.createElement("input"), `${idPrefix}-regy`);
  regY.type = "number";
  regY.step = "1";
  const centre = panelButton(`${idPrefix}-centre`, "Centre on the tile", () => {
    const w = ed.working;
    const r = ed.report();
    if (w && r?.bounds) {
      w.settings = { ...w.settings, ...defaultItemAnchor(r.bounds) };
      sync(true);
    }
  });
  const controls = document.createElement("div");
  controls.className = "item-art-controls";
  controls.append(formField("Transparency", transparency));
  if (mode === "anchor") {
    controls.append(
      formField("Anchor x", regX, "From the picture's left edge."),
      formField("Anchor y", regY, "From its top edge."),
      centre,
    );
  }
  controls.append(guidesLabel);
  const notes = document.createElement("div");
  notes.className = "item-art-notes";
  el.append(previews, controls, notes);

  let shown: { kind: "atlas"; name: string } | { kind: "none" } | null = null;
  let keyedCanvas: HTMLCanvasElement | null = null;
  let lastReport: PictureReport | null = null;

  const source = (): PreviewSource => {
    const w = ed.working;
    if (w && keyedCanvas && lastReport) {
      return { kind: "pixels", canvas: keyedCanvas, settings: w.settings, report: lastReport };
    }
    return shown ?? { kind: "none" };
  };
  /** Bumped on every redraw: an older draw still waiting for its sheets draws nothing. */
  let drawGen = 0;
  const redraw = () => {
    panelFig?.label();
    groundFig.label();
    const src = source();
    const mine = ++drawGen;
    const current = () => mine === drawGen;
    if (panel) {
      void drawPanel(panel, a, src, nameOf(), current);
    }
    const name = nameOf();
    void drawGround(
      ground,
      a,
      src,
      mode,
      guides.checked,
      name ? groundDrawOffset(name) : undefined,
      current,
    );
  };
  /** Re-keys the working picture and redraws, after a change to its settings. */
  const sync = (edited: boolean) => {
    const w = ed.working;
    controls.hidden = w === null;
    if (w) {
      const k = keyed(w.raw, w.settings.transparency);
      lastReport = itemPictureReport(k, w.settings.transparency, maxSide());
      keyedCanvas = pixelCanvas(k);
      transparency.value = w.settings.transparency;
      regX.value = String(w.settings.regX);
      regY.value = String(w.settings.regY);
      notes.replaceChildren(messages(lastReport));
    } else {
      lastReport = null;
      keyedCanvas = null;
      notes.replaceChildren();
    }
    redraw();
    onChange(edited);
  };
  transparency.addEventListener("change", () => {
    if (ed.working) {
      ed.working.settings = {
        ...ed.working.settings,
        transparency: transparency.value === "green" ? "green" : "alpha",
      };
      sync(true);
    }
  });
  const number = (input: HTMLInputElement, key: "regX" | "regY") =>
    input.addEventListener("change", () => {
      const n = Math.round(Number(input.value));
      if (ed.working && Number.isFinite(n)) {
        ed.working.settings = { ...ed.working.settings, [key]: Math.max(-2048, Math.min(2048, n)) };
        sync(true);
      }
    });
  number(regX, "regX");
  number(regY, "regY");
  guides.addEventListener("change", redraw);

  // Dragging the picture on the ground moves its anchor the other way.
  let drag: { x: number; y: number; regX: number; regY: number; id: number } | null = null;
  if (mode === "anchor") {
    ground.addEventListener("pointerdown", (e) => {
      if (!ed.working) {
        return;
      }
      drag = {
        x: e.clientX,
        y: e.clientY,
        regX: ed.working.settings.regX,
        regY: ed.working.settings.regY,
        id: e.pointerId,
      };
      ground.setPointerCapture?.(e.pointerId);
    });
    ground.addEventListener("pointermove", (e) => {
      if (!drag || e.pointerId !== drag.id || !ed.working) {
        return;
      }
      const scale = ground.clientWidth > 0 ? ground.clientWidth / ground.width : 1;
      const dx = Math.round((e.clientX - drag.x) / scale);
      const dy = Math.round((e.clientY - drag.y) / scale);
      ed.working.settings = { ...ed.working.settings, regX: drag.regX - dx, regY: drag.regY - dy };
      regX.value = String(ed.working.settings.regX);
      regY.value = String(ed.working.settings.regY);
      redraw();
    });
    const end = (e: PointerEvent) => {
      if (drag && e.pointerId === drag.id) {
        drag = null;
        sync(true);
      }
    };
    ground.addEventListener("pointerup", end);
    ground.addEventListener("pointercancel", end);
  }

  const ed: PictureEditor = {
    el,
    working: null,
    draw(src) {
      shown = src;
      sync(false);
    },
    setWorking(w) {
      ed.working = w;
      sync(false);
    },
    report: () => lastReport,
  };
  controls.hidden = true;
  return ed;
}

/** The pictures that will exist once the draft is published, for "choose a picture". */
function pictureChoices(view: ContentItemArtView): string[] {
  const names = new Map<string, string>();
  for (const k of view.packPictures) {
    names.set(k, k);
  }
  // Prefer the spelling the content uses.
  for (const r of view.art) {
    names.set(r.name.toLowerCase(), r.name);
  }
  for (const i of view.items) {
    if (names.has(i.name.toLowerCase())) {
      names.set(i.name.toLowerCase(), i.name);
    }
  }
  return [...names.values()].sort((x, y) => x.localeCompare(y));
}

let pickerIds = 0;

/** Whether the live atlas draws `name` from an upload (an operator sheet), not a pack's own. */
function liveIsUpload(a: Assets, name: string): boolean {
  const s = a.sprite("items", name);
  return s !== undefined && (a.index.atlases.items.sheets[s[0]] ?? "").startsWith("operator/");
}

/** The settings of a saved upload, to edit it. */
const savedSettings = (art: ArtItem): PictureSettings => ({
  file: art.file,
  regX: art.regX,
  regY: art.regY,
  transparency: art.transparency ?? "alpha",
});

export function createItemArtPicker(opts: ItemArtOptions): ItemArtPicker {
  const a = opts.assets;
  const decode = opts.decode ?? loadPixels;
  const el = document.createElement("section");
  el.className = "item-art";
  el.setAttribute("aria-label", "Picture");
  el.hidden = true;
  const title = document.createElement("h4");
  title.className = "item-art-title";
  title.textContent = "Picture";
  const state = document.createElement("p");
  state.className = "item-art-state";
  const pools = document.createElement("ul");
  pools.className = "item-art-pools";
  const status = document.createElement("p");
  status.className = "item-art-status";
  status.setAttribute("role", "status");

  let item: Item | null = null;
  let view: ContentItemArtView | null = null;
  /** The item shown last, kept through `clear` (the page clears the picker while a row reloads). */
  let lastKey: string | null = null;
  /** The editor shows the saved upload, unchanged: nothing to save. */
  let pristine = false;
  /**
   * Bumped whenever what the editor shows changes hands (another item, a new file, Cancel): a
   * picture still loading for an older one is dropped when it arrives.
   */
  let generation = 0;

  const editor = createPictureEditor(
    a,
    "anchor",
    () => view?.maxSide ?? 512,
    () => item?.name ?? "",
    () => (item && view ? poolPictures(item, view.currency) : {}),
    (edited) => {
      if (edited) {
        pristine = false;
      }
      updateButtons();
    },
    "item-art",
  );

  // Upload a picture.
  const file = action(document.createElement("input"), "item-art-file");
  file.type = "file";
  file.accept = ".png,image/png";
  file.setAttribute("aria-label", "A PNG picture for this item");
  file.addEventListener("change", () => {
    const f = file.files?.[0];
    file.value = "";
    if (f) {
      void uploadOne(f);
    }
  });
  async function uploadOne(f: File): Promise<void> {
    const mine = ++generation;
    const forItem = item;
    const maxSide = view?.maxSide ?? 512;
    if (!forItem) {
      return;
    }
    status.textContent = `Uploading ${f.name}…`;
    const [stored, raw] = await Promise.all([opts.upload(f), decode(f)]);
    // Another file, another item or Cancel since: this one is no longer wanted.
    if (mine !== generation || item !== forItem) {
      return;
    }
    if (!stored.ok) {
      status.textContent = `Refused: ${stored.error}`;
      return;
    }
    if (!raw) {
      status.textContent = "The browser could not read that picture.";
      return;
    }
    const { settings } = freshSettings(stored.stored.file, raw, maxSide);
    pristine = false;
    editor.setWorking({ raw, settings });
    status.textContent = `${f.name} is uploaded: check the preview, then save it to the draft.`;
  }

  // Choose an existing picture.
  pickerIds += 1;
  const listId = `item-art-choices-${pickerIds}`;
  const choices = document.createElement("datalist");
  choices.id = listId;
  const choose = action(document.createElement("input"), "item-art-choose");
  choose.type = "text";
  choose.setAttribute("list", listId);
  choose.placeholder = "A picture the game has";
  const useBtn = panelButton("item-art-use", "Use this picture", () => {
    if (!item || !view) {
      return;
    }
    const want = choose.value.trim();
    const known = pictureChoices(view).find((n) => same(n, want));
    if (!known) {
      status.textContent = `There is no picture called ${want || "that"}.`;
      return;
    }
    void commit({ op: "choose", item: item.name, picture: known });
  });

  const saveBtn = panelButton(
    "item-art-save",
    "Save the picture to the draft",
    () => {
      const w = editor.working;
      if (item && w) {
        void commit({ op: "upload", item: item.name, art: w.settings });
      }
    },
    "primary",
  );
  const cancelBtn = panelButton("item-art-cancel", "Cancel", () => {
    if (item && view) {
      show(item, view);
    }
  });
  const removeBtn = panelButton(
    "item-art-remove",
    "Remove the upload",
    () => {
      if (item) {
        void commit({ op: "remove", item: item.name });
      }
    },
    "danger",
  );

  let busy = false;
  async function commit(change: PictureChange): Promise<void> {
    if (busy) {
      return;
    }
    busy = true;
    status.textContent = "Saving…";
    try {
      const r = await opts.apply(change);
      status.textContent = r.text;
      if (r.ok) {
        opts.saved();
      }
    } finally {
      busy = false;
    }
  }

  function updateButtons(): void {
    const pending = editor.working !== null && !pristine;
    const r = editor.report();
    saveBtn.hidden = !pending;
    saveBtn.disabled = !r || r.errors.length > 0;
    cancelBtn.hidden = !pending;
    removeBtn.hidden = !(item && view && artNamed(view, item.name)) || pending;
  }

  const uploadRow = document.createElement("div");
  uploadRow.className = "content-buttons";
  uploadRow.append(file, templateLink("item-art-template"));
  const chooseRow = document.createElement("div");
  chooseRow.className = "content-buttons";
  chooseRow.append(choose, choices, useBtn);
  const rules = document.createElement("p");
  rules.className = "item-art-rules";
  rules.textContent = ITEM_PICTURE_RULES;
  const buttons = document.createElement("div");
  buttons.className = "content-buttons";
  buttons.append(saveBtn, cancelBtn, removeBtn);

  // The currency's piles, pasted by their corner.
  const piles = document.createElement("div");
  piles.className = "item-art-piles";

  el.append(title, state, pools, editor.el, buttons, status, uploadRow, chooseRow, rules, piles);

  function drawPiles(): void {
    piles.replaceChildren();
    if (!item || !view || view.currency === null || !same(item.name, view.currency)) {
      return;
    }
    const h = document.createElement("h5");
    h.className = "item-art-title";
    h.textContent = "Ground piles";
    const p = document.createElement("p");
    p.className = "item-art-rules";
    p.textContent =
      "A pile on the ground is pasted by its top-left corner, 1 px inside its tile (1.6's way): draw it on the 32×32 template where it should sit.";
    piles.append(h, p);
    for (const pile of CURRENCY_PILES) {
      piles.append(pileEditor(pile.name, pile.label, view));
    }
  }

  function pileEditor(name: CurrencyPile, label: string, v: ContentItemArtView): HTMLElement {
    const box = document.createElement("div");
    box.className = "item-art-pile";
    box.dataset.pile = name;
    const head = document.createElement("p");
    head.className = "item-art-state";
    const id = `item-art-pile-${name.toLowerCase()}`;
    let unchanged = false;
    /** This pile editor's own generation (see the picker's). */
    let pileGen = 0;
    const pickerGen = generation;
    const ed = createPictureEditor(
      a,
      "corner",
      () => v.maxSide,
      () => "",
      () => ({}),
      (edited) => {
        if (edited) {
          unchanged = false;
        }
        save.hidden = ed.working === null || unchanged;
        save.disabled = (ed.report()?.errors.length ?? 1) > 0;
      },
      id,
    );
    const input = action(document.createElement("input"), `${id}-file`);
    input.type = "file";
    input.accept = ".png,image/png";
    input.setAttribute("aria-label", `A PNG for the ${label.toLowerCase()}`);
    const save = panelButton(`${id}-save`, "Save to the draft", () => {
      if (ed.working) {
        void commit({ op: "pile", pile: name, art: ed.working.settings });
      }
    });
    save.hidden = true;
    const upload = artNamed(v, name);
    const remove = panelButton(
      `${id}-remove`,
      "Remove the upload",
      () => void commit({ op: "pile", pile: name, art: null }),
      "danger",
    );
    remove.hidden = !upload;
    input.addEventListener("change", () => {
      const f = input.files?.[0];
      input.value = "";
      if (!f) {
        return;
      }
      const mine = ++pileGen;
      void (async () => {
        const [stored, raw] = await Promise.all([opts.upload(f), decode(f)]);
        if (mine !== pileGen || pickerGen !== generation) {
          return;
        }
        if (!stored.ok || !raw) {
          status.textContent = stored.ok
            ? "The browser could not read that picture."
            : `Refused: ${stored.error}`;
          return;
        }
        unchanged = false;
        ed.setWorking({
          raw,
          settings: freshSettings(stored.stored.file, raw, v.maxSide).settings,
        });
      })();
    });
    const packHas = v.packPictures.includes(name.toLowerCase());
    head.textContent = `${label}: ${upload ? "your upload" : packHas ? "the pack's picture" : "no picture"} (${name}).`;
    if (upload) {
      const mine = pileGen;
      void decode(uploadUrl({ file: upload.file, ext: "png" })).then((raw) => {
        // A file chosen meanwhile wins over the saved one.
        if (raw && mine === pileGen && pickerGen === generation) {
          unchanged = true;
          ed.setWorking({ raw, settings: savedSettings(upload) });
        }
      });
    } else {
      ed.draw(packHas && !liveIsUpload(a, name) ? { kind: "atlas", name } : { kind: "none" });
    }
    const row = document.createElement("div");
    row.className = "content-buttons";
    row.append(input, save, remove);
    box.append(head, ed.el, row);
    return box;
  }

  function show(it: Item, v: ContentItemArtView): void {
    const mine = ++generation;
    // Showing the same item again (after a save) keeps what the last action said.
    if (lastKey === null || !same(lastKey, it.name)) {
      status.textContent = "";
    }
    lastKey = it.name;
    item = it;
    view = v;
    el.hidden = false;
    pristine = false;
    editor.setWorking(null);
    choices.replaceChildren(
      ...pictureChoices(v).map((n) => {
        const o = document.createElement("option");
        o.value = n;
        return o;
      }),
    );
    choose.value = "";
    const src = pictureSource(it, v);
    const name = pictureName(it);
    const borrowed = it.sprite !== undefined && !same(it.sprite, it.name);
    const others = drawnBy(v, name, it.name).map((i) => i.name);
    const sharing =
      others.length > 0
        ? ` ${listNames(others)} draw${others.length === 1 ? "s" : ""} it too.`
        : "";
    if (src.kind === "upload" && borrowed) {
      // Another picture's upload: changed from its own row (or the currency's piles), not here,
      // where saving would make a copy of it for this item.
      state.textContent = `It draws the uploaded picture ${src.art.name}.${sharing} Change that picture from ${src.art.name}'s own row; uploading here gives this item a picture of its own.`;
      editor.draw(
        liveIsUpload(a, src.art.name) ? { kind: "atlas", name: src.art.name } : { kind: "none" },
      );
    } else if (src.kind === "upload") {
      state.textContent = `It draws its own upload.${sharing}`;
      editor.draw(null);
      void decode(uploadUrl({ file: src.art.file, ext: "png" })).then((raw) => {
        // Only if nothing else was shown or chosen meanwhile.
        if (mine !== generation) {
          return;
        }
        if (!raw) {
          status.textContent = "Its uploaded picture could not be read for the preview.";
          return;
        }
        pristine = true;
        editor.setWorking({ raw, settings: savedSettings(src.art) });
      });
    } else if (src.kind === "pack") {
      // The live atlas may still draw an upload the draft takes out; the pack's comes back then.
      const comingBack = liveIsUpload(a, src.name);
      state.textContent = comingBack
        ? `It will draw the pack's picture ${src.name} once the draft is published (the draft takes out the upload that replaced it; the preview cannot show the pack's until then).${sharing}`
        : borrowed
          ? `It draws ${src.name}, a picture the game already has.${sharing}`
          : `It draws the pack's picture.${sharing} Upload one to replace it.`;
      editor.draw(comingBack ? { kind: "none" } : { kind: "atlas", name: src.name });
    } else {
      state.textContent = borrowed
        ? `It draws ${name}, which has no picture: upload one, or choose a picture the game has.`
        : "It has no picture yet: upload one, or choose a picture the game has.";
      editor.draw({ kind: "none" });
    }
    const notes = poolNotes(it, v.currency);
    pools.replaceChildren(
      ...[notes.bag, notes.ground]
        .filter((n): n is string => n !== undefined)
        .map((n) => {
          const li = document.createElement("li");
          li.textContent = n;
          return li;
        }),
    );
    drawPiles();
    updateButtons();
  }

  return {
    el,
    show,
    pending: () => !el.hidden && editor.working !== null && !pristine,
    clear() {
      generation += 1;
      item = null;
      view = null;
      el.hidden = true;
      editor.setWorking(null);
      piles.replaceChildren();
    },
  };
}

function listNames(names: readonly string[]): string {
  const shown = names.slice(0, 3);
  const more = names.length - shown.length;
  const head =
    shown.length <= 1 ? (shown[0] ?? "") : `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}`;
  return more > 0 ? `${shown.join(", ")} and ${more} more` : head;
}

// ---- bulk upload ------------------------------------------------------------------------------

export interface ItemPicturesOptions extends ItemArtOptions {
  /** Opens an item's row (and its picker) in the row editor. */
  openItem(key: string): void;
}

export interface ItemPictures {
  readonly el: HTMLElement;
  /** The draft's items and pictures changed: list again. */
  setView(view: ContentItemArtView): void;
  /** Logged out or the page reset: forget the list. */
  reset(): void;
}

/** One file of a bulk upload. */
interface BulkLine {
  file: File;
  /** The item it attaches to (matched by name, or picked by hand). */
  item: string;
  by: FileMatch["by"];
  replace: boolean;
  upload: { ok: true; stored: StoredUpload } | { ok: false; error: string } | null;
  raw: Pixels | null;
  settings: PictureSettings | null;
  report: PictureReport | null;
  /** What became of it. */
  done: string;
}

export function createItemPictures(opts: ItemPicturesOptions): ItemPictures {
  const decode = opts.decode ?? loadPixels;
  const el = document.createElement("div");
  el.className = "item-pictures";
  let view: ContentItemArtView | null = null;
  let lines: BulkLine[] = [];
  const status = document.createElement("p");
  status.className = "item-art-status";
  status.setAttribute("role", "status");

  const rules = document.createElement("p");
  rules.className = "item-art-rules";
  rules.textContent = `${ITEM_PICTURE_RULES} Name each file after its item (Iron Sword.png): files are matched to item keys, then to the names players see, ignoring case.`;

  const files = action(document.createElement("input"), "item-pictures-files");
  files.type = "file";
  files.multiple = true;
  files.accept = ".png,image/png";
  files.setAttribute("aria-label", "PNG pictures named after their items");
  files.addEventListener("change", () => {
    const list = [...(files.files ?? [])];
    files.value = "";
    void addFiles(list);
  });

  const itemListId = "item-pictures-items";
  const itemList = document.createElement("datalist");
  itemList.id = itemListId;

  /** Whether the item will have a picture once the draft is published. */
  const hasPicture = (it: Item) => view !== null && pictureExists(view, pictureName(it));
  /** The live item a name stands for: its key, else the name players see. */
  const itemOf = (key: string) =>
    view?.items.find((i) => !i.retired && same(i.name, key)) ??
    view?.items.find((i) => !i.retired && i.display !== undefined && same(i.display, key)) ??
    null;

  const table = createTable<BulkLine>({
    label: "Pictures to attach",
    empty: "No files chosen.",
    key: (l) => `${l.file.name}:${lines.indexOf(l)}`,
    columns: [
      { label: "File", cell: (l) => l.file.name },
      {
        label: "Item",
        cell: (l) => {
          const input = action(document.createElement("input"), "item-pictures-item");
          input.type = "text";
          input.setAttribute("list", itemListId);
          input.setAttribute("aria-label", `The item ${l.file.name} is for`);
          input.value = l.item;
          input.placeholder = "Not matched: pick an item";
          input.addEventListener("change", () => {
            const it = itemOf(input.value.trim());
            l.item = it?.name ?? input.value.trim();
            l.by = null;
            l.replace = it ? hasPicture(it) : false;
            redraw();
          });
          return input;
        },
      },
      {
        label: "Replaces",
        cell: (l) => {
          const it = itemOf(l.item);
          if (l.done || !it || !hasPicture(it)) {
            return "";
          }
          const box = action(document.createElement("input"), "item-pictures-replace");
          box.type = "checkbox";
          box.checked = l.replace;
          box.setAttribute("aria-label", `Replace ${it.name}'s picture`);
          box.addEventListener("change", () => {
            l.replace = box.checked;
          });
          const label = document.createElement("label");
          label.className = "item-art-check";
          label.append(box, " its picture");
          return label;
        },
      },
      {
        label: "Check",
        cell: (l) => {
          if (l.done) {
            return l.done;
          }
          if (!l.upload) {
            return "Uploading…";
          }
          if (!l.upload.ok) {
            return `Refused: ${l.upload.error}`;
          }
          if (!l.raw) {
            return "The browser could not read it.";
          }
          const it = itemOf(l.item);
          if (!it) {
            return l.item ? `There is no item ${l.item}.` : "Pick its item.";
          }
          if (clashes(l)) {
            return `Another file is for ${it.name} too: pick a different item for one of them, or clear the list.`;
          }
          return l.report && l.report.errors.length + l.report.warnings.length === 0
            ? "Ready."
            : messages(l.report);
        },
      },
    ],
  });

  /** Bumped by Clear: uploads still running for a cleared list stop. */
  let batch = 0;
  /** The currency and items the game always draws with shared pictures need none of their own. */
  const engineDrawn = (i: Item): boolean => {
    if (view?.currency && same(i.name, view.currency)) {
      return true;
    }
    const p = poolPictures(i, view?.currency ?? null);
    return p.bag !== undefined && p.ground !== undefined;
  };
  async function addFiles(list: File[]): Promise<void> {
    if (!view || list.length === 0) {
      return;
    }
    const v = view;
    const matches = matchFiles(
      list.map((f) => f.name),
      v.items,
    );
    const added = list.map((file, i): BulkLine => {
      const m = matches[i] as FileMatch;
      return {
        file,
        item: m.item?.name ?? "",
        by: m.by,
        replace: m.item ? hasPicture(m.item) : false,
        upload: null,
        raw: null,
        settings: null,
        report: null,
        done: "",
      };
    });
    lines = [...lines.filter((l) => !l.done), ...added];
    redraw();
    const mine = batch;
    for (const l of added) {
      if (mine !== batch) {
        return;
      }
      const [stored, raw] = await Promise.all([opts.upload(l.file), decode(l.file)]);
      l.upload = stored;
      l.raw = raw;
      if (stored.ok && raw) {
        const fresh = freshSettings(stored.stored.file, raw, v.maxSide);
        l.settings = fresh.settings;
        l.report = fresh.report;
      }
      redraw();
    }
    if (mine !== batch) {
      return;
    }
    const unmatched = added.filter((l) => !l.item).length;
    status.textContent =
      unmatched > 0
        ? `${unmatched} file${unmatched === 1 ? " matches" : "s match"} no item: pick ${unmatched === 1 ? "its item" : "their items"} by hand.`
        : "Every file matches an item.";
  }

  const attach = panelButton(
    "item-pictures-attach",
    "Attach to their items",
    () => void attachAll(),
    "primary",
  );

  /** A waiting line whose item another waiting line is also for: neither is attached. */
  const clashes = (l: BulkLine): boolean => {
    const it = itemOf(l.item);
    return (
      it !== null &&
      lines.some((o) => o !== l && !o.done && same(itemOf(o.item)?.name ?? "", it.name))
    );
  };

  /** True while a batch is being put in the draft: the list and Attach wait. */
  let attaching = false;
  async function attachAll(): Promise<void> {
    if (!view || attaching) {
      return;
    }
    attaching = true;
    redraw();
    let saved = 0;
    try {
      // The batch as it stands now: clashing lines wait for the operator to choose.
      const batch = lines.filter((l) => !l.done && !clashes(l));
      for (const l of batch) {
        const it = itemOf(l.item);
        if (!it || !l.settings || !l.report || l.report.errors.length > 0) {
          continue;
        }
        if (hasPicture(it) && !l.replace) {
          l.done = "Skipped: it keeps its picture.";
          continue;
        }
        const r = await opts.apply({ op: "upload", item: it.name, art: l.settings });
        l.done = r.ok ? `In the draft for ${it.name}.` : `Not saved: ${r.text}`;
        if (r.ok) {
          saved += 1;
        }
        redraw();
      }
    } finally {
      attaching = false;
    }
    redraw();
    status.textContent =
      saved === 0
        ? "Nothing was attached."
        : `${saved} picture${saved === 1 ? " is" : "s are"} in the draft.`;
    if (saved > 0) {
      opts.saved();
    }
  }

  const clear = panelButton("item-pictures-clear", "Clear the list", () => {
    batch += 1;
    lines = [];
    status.textContent = "";
    redraw();
  });

  // Items with no picture at all.
  const missingTitle = document.createElement("h4");
  missingTitle.className = "item-art-title";
  const missing = createTable<Item>({
    label: "Items without a picture",
    empty: "Every item has a picture.",
    key: (i) => i.name,
    open: { id: "item-pictures-open", run: (i) => opts.openItem(i.name) },
    columns: [
      { label: "Item", cell: (i) => i.name },
      { label: "Players see", cell: (i) => i.display ?? "" },
    ],
  });

  function redraw(): void {
    table.setRows(lines);
    attach.disabled =
      attaching ||
      !lines.some(
        (l) =>
          !l.done &&
          itemOf(l.item) &&
          l.settings &&
          (l.report?.errors.length ?? 1) === 0 &&
          !clashes(l),
      );
    files.disabled = attaching;
    clear.disabled = attaching;
    const none = (view?.items ?? []).filter((i) => !i.retired && !hasPicture(i) && !engineDrawn(i));
    missingTitle.textContent = `Items without a picture (${none.length})`;
    missing.setRows(none);
  }

  const row = document.createElement("div");
  row.className = "content-buttons";
  row.append(files, templateLink("item-pictures-template"), attach, clear);
  el.append(rules, row, itemList, table.el, status, missingTitle, missing.el);
  redraw();

  return {
    el,
    reset() {
      batch += 1;
      lines = [];
      view = null;
      status.textContent = "";
      redraw();
    },
    setView(v) {
      view = v;
      itemList.replaceChildren(
        ...v.items
          .filter((i) => !i.retired)
          .map((i) => {
            const o = document.createElement("option");
            o.value = i.name;
            return o;
          }),
      );
      redraw();
    },
  };
}
