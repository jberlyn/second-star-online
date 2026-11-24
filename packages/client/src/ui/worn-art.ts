/**
 * Worn frame sets on the Content page (issue #29, stage 3): a panel that uploads a worn layer's
 * frames, as separate `<layer>-f1-e.png` files or one 184×180 sheet, with no JSON to write. It
 * previews the layer walking and attacking on the bare character, in the order the game stacks
 * it, shows each frame and what is wrong with it, and offers a guide sheet to draw on. A
 * "Worn layers" section lists every layer the content draws and takes many files at once.
 *
 * A layer is named by key: the worn item's key after the layer aliases. What the panel writes is
 * the layer's `art/paperdoll` row (every frame it keeps, `mirrored`, the transparency) through the
 * `contentWorn` intent; publishing the draft makes it live. The panel is a component of its own,
 * for the item editor (#30).
 */
import type { ArtFrameId, ArtWorn } from "@secondstaronline/data";
import {
  ALL_FRAME_IDS,
  type BodyFrame,
  blankCell,
  type ContentWornArtView,
  cutCell,
  equipmentOf,
  type Facing,
  frameFileName,
  guessTransparency,
  isNorthFrame,
  type Look,
  lingoEq,
  mirrorWorn,
  missingFrames,
  type PaperdollRules,
  type PictureTransparency,
  type Pixels,
  paperdollLayersWith,
  paperdollRulesOf,
  sheetCell,
  unusedFrames,
  WORN_CELL,
  WORN_FACINGS,
  WORN_FRAMES,
  WORN_MIRROR_AXIS,
  WORN_SHEET,
  WORN_SLOT_NAMES,
  WORN_STEPS,
  type WornChange,
  type WornFrameReport,
  type WornLayerUse,
  wornByText,
  wornFrameReport,
} from "@secondstaronline/shared";

import { type Assets, drawSprite } from "../assets.ts";
import { action } from "./action.ts";
import { type StoredUpload, uploadUrl } from "./art-uploads.ts";
import { createTable, formField, panelButton } from "./control-panel-kit.ts";
import { keyed, loadPixels } from "./item-art.ts";

// ---- what the panel reads (pure) --------------------------------------------------------------

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

type WornItem = ContentWornArtView["items"][number];

/** What a panel shows: an item's layer, or a layer by name (the engine's, an alias's). */
export type WornTarget = { kind: "item"; item: string } | { kind: "layer"; layer: string };

/** The draft's upload for a layer, if any. */
export function wornUpload(view: ContentWornArtView, layer: string): ArtWorn | undefined {
  return view.art.find((a) => same(a.name, layer));
}

/** The content's use of a layer: its frames and who draws it. */
export function wornUse(view: ContentWornArtView, layer: string): WornLayerUse | undefined {
  return view.layers.find((l) => same(l.name, layer));
}

/** The frames the packs draw for a layer. */
export const packFrames = (view: ContentWornArtView, layer: string): ArtFrameId[] =>
  view.packLayers[layer.toLowerCase()] ?? [];

/** Where a layer's frames will come from once the draft is published. */
export type WornSource =
  | { kind: "upload"; art: ArtWorn }
  | { kind: "pack"; frames: ArtFrameId[] }
  | { kind: "none" };

export function wornSource(view: ContentWornArtView, layer: string): WornSource {
  const art = wornUpload(view, layer);
  if (art) {
    return { kind: "upload", art };
  }
  const frames = packFrames(view, layer);
  return frames.length > 0 ? { kind: "pack", frames } : { kind: "none" };
}

/** Every layer worth listing: the ones content draws, and uploads nothing draws. */
export function wornLayerList(view: ContentWornArtView): WornLayerUse[] {
  const out = [...view.layers];
  for (const a of view.art) {
    if (!out.some((l) => same(l.name, a.name))) {
      out.push({ name: a.name, needs: [], wornBy: [], engine: [] });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** What a set of files is: one sheet, a set of frames, or neither (with why). */
export type WornFiles =
  | { kind: "sheet"; file: string }
  | { kind: "frames"; frames: { file: string; frame: ArtFrameId }[] }
  | { kind: "bad"; error: string };

/** Sorts the files chosen for one layer: a single sheet, or frames named `-f1-e`. */
export function wornFiles(
  names: readonly string[],
  hint = `name frames like Moonblade-f1-e.png, or choose one ${WORN_SHEET.w}×${WORN_SHEET.h} sheet on its own`,
): WornFiles {
  if (names.length === 1 && frameFileName(names[0] as string) === null) {
    return { kind: "sheet", file: names[0] as string };
  }
  const frames: { file: string; frame: ArtFrameId }[] = [];
  for (const file of names) {
    const f = frameFileName(file);
    if (!f) {
      return {
        kind: "bad",
        error: `${file} names no frame: ${hint}`,
      };
    }
    if (frames.some((x) => x.frame === f.frame)) {
      return { kind: "bad", error: `Two files are for ${f.frame}.` };
    }
    frames.push({ file, frame: f.frame });
  }
  return { kind: "frames", frames };
}

/** A bulk upload's files grouped by the layer each names: `Moonblade-f1-e.png`, `Moonblade.png`. */
export interface WornGroup {
  stem: string;
  files: string[];
}

export function groupWornFiles(names: readonly string[]): WornGroup[] {
  const groups: WornGroup[] = [];
  for (const file of names) {
    const stem = frameFileName(file)?.stem ?? file.replace(/\.png$/i, "").trim();
    const g = groups.find((x) => same(x.stem, stem));
    if (g) {
      g.files.push(file);
    } else {
      groups.push({ stem, files: [file] });
    }
  }
  return groups;
}

/**
 * The layer a name stands for: an item's key, then the name players see (each its layer after the
 * aliases), then a layer's own name. Retired items take no new art. Null with why when none does.
 */
export function matchWornLayer(
  stem: string,
  view: ContentWornArtView,
): { layer: string; by: "key" | "display" | "layer" } | { layer: null; why: string } {
  const live = view.items.filter((i) => !i.retired);
  const item =
    live.find((i) => same(i.name, stem)) ??
    live.find((i) => i.display !== undefined && same(i.display, stem));
  if (item) {
    return item.layer === null
      ? { layer: null, why: `${item.name} draws nothing when worn (an alias makes it NOTHING).` }
      : { layer: item.layer, by: same(item.name, stem) ? "key" : "display" };
  }
  const layer = wornLayerList(view).find((l) => same(l.name, stem));
  return layer
    ? { layer: layer.name, by: "layer" }
    : { layer: null, why: `No item or layer is called ${stem}.` };
}

/** What the panel says about who draws a layer and why, for an item. */
export function wornItemText(item: WornItem, use: WornLayerUse | undefined): string {
  const where = `Worn ${WORN_SLOT_NAMES[item.slot]}.`;
  const rule = (a: WornItem["aliases"][number]) =>
    `${a.match === "exact" ? "the exact name" : "a name containing"} "${a.pattern}" becomes ${a.becomes}`;
  if (item.layer === null) {
    return `${where} It draws nothing when worn: the alias rule (${item.aliases.map(rule).join("; ")}) makes it NOTHING.`;
  }
  const others = [...(use?.engine ?? []), ...(use?.wornBy ?? []).map((w) => w.item)].filter(
    (n) => !same(n, item.name),
  );
  const shared =
    others.length > 0
      ? ` It shares it with ${listNames(others)}: an upload repaints them all.`
      : "";
  if (item.aliases.length > 0) {
    return `${where} It draws the layer ${item.layer}, through the alias rule ${item.aliases.map(rule).join(", then ")}.${shared}`;
  }
  return `${where} It draws its own layer, ${item.layer}.${shared}`;
}

function listNames(names: readonly string[]): string {
  const shown = names.slice(0, 3);
  const more = names.length - shown.length;
  if (more > 0) {
    return `${shown.join(", ")} and ${more} more`;
  }
  return shown.length <= 1
    ? (shown[0] ?? "")
    : `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}`;
}

/** The renderer's rules as the draft has them. */
const draftRules = (view: ContentWornArtView): PaperdollRules =>
  paperdollRulesOf({
    behaviours: view.rules.behaviours,
    paperdoll: { aliases: view.rules.aliases },
  });

/** The character a layer is previewed on, or null: the bare character with the layer on top. */
export function previewLook(
  view: ContentWornArtView,
  target: WornTarget,
  layer: string,
): Look | null {
  const item =
    target.kind === "item"
      ? view.items.find((i) => same(i.name, target.item))
      : (view.items.find((i) => i.layer !== null && same(i.layer, layer) && !i.retired) ??
        view.items.find((i) => i.layer !== null && same(i.layer, layer)));
  if (item) {
    return { head: view.head, equip: equipmentOf({ [item.slot]: item.name }) };
  }
  const head = /^head(\d+)$/i.exec(layer);
  if (head) {
    return { head: Number(head[1]) };
  }
  return wornUse(view, layer)?.engine.length ? { head: view.head } : null;
}

/** The layers stacked for one frame, bottom to top, each with whether it is the previewed one. */
export function previewStack(
  rules: PaperdollRules,
  look: Look | null,
  head: number,
  layer: string,
  frame: BodyFrame,
  facing: Facing,
): { name: string; mine: boolean }[] {
  const mine = (name: string) => lingoEq(name, `${layer}-${frame}-${facing}`);
  if (look) {
    return paperdollLayersWith(rules, look, frame, facing).map((name) => ({
      name,
      mine: mine(name),
    }));
  }
  return [
    ...paperdollLayersWith(rules, { head }, frame, facing).map((name) => ({ name, mine: false })),
    { name: `${layer}-${frame}-${facing}`, mine: true },
  ];
}

// ---- pixels -----------------------------------------------------------------------------------

/** One cell of a sheet's pixels. */
export const sheetFrame = (sheet: Pixels, id: ArtFrameId): Pixels => cutCell(sheet, id);

export function pixelCanvas(p: Pixels): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = p.width;
  c.height = p.height;
  const ctx = c.getContext("2d");
  if (ctx && p.width > 0 && p.height > 0) {
    ctx.putImageData(new ImageData(new Uint8ClampedArray(p.data), p.width, p.height), 0, 0);
  }
  return c;
}

/** A frame as the game will draw it: keyed, and flipped when it is a mirrored north frame. */
function shownFrame(
  raw: Pixels,
  id: ArtFrameId,
  mirrored: boolean,
  t: PictureTransparency,
): Pixels {
  const k = keyed(raw, t);
  return mirrored && isNorthFrame(id) ? mirrorWorn(k) : k;
}

// ---- the guide sheet --------------------------------------------------------------------------

/** What the templates say about worn frames. */
export const WORN_RULES = `A worn layer is up to 15 frames, each at most ${WORN_CELL.w}×${WORN_CELL.h} and pasted at the character's top-left: walking F1 to F3 facing north, east, south and west, and attacking F4 facing north, east and west (attacking south shows F3). Upload separate PNGs named like Moonblade-f1-e.png, or one ${WORN_SHEET.w}×${WORN_SHEET.h} sheet: rows north, east, south and west, columns F1 to F4. Blank cells are left out. Draw on the guide sheet on a layer of your own and export only that layer: the guide shows the bare character in each frame the layer needs and greys out the frames the game never draws.`;

/** Why `mirrored` is on unless the operator turns it off. */
export const MIRRORED_NOTE = `1.6 drew its characters' back views as if seen from the front (from behind, the weapon looks to be in the left hand), and old 1.6 art is drawn that way, so this starts ticked: the game flips each north frame about the body's centre line when it builds the art. Untick it if you drew the back views the right way round. A flipped north frame must leave column ${WORN_MIRROR_AXIS + 1} empty.`;

/**
 * A guide sheet for a layer: the bare character (as the game draws it, north frames flipped back
 * the 1.6 way when `mirrored`) in each frame the layer needs, the frames never drawn hatched grey,
 * and the mirror line marked on the north row.
 */
export async function guideSheet(
  a: Assets,
  rules: PaperdollRules,
  head: number,
  needs: readonly ArtFrameId[],
  mirrored: boolean,
): Promise<string> {
  await a.loadGroup("paperdoll").catch(() => {});
  const c = document.createElement("canvas");
  c.width = WORN_SHEET.w;
  c.height = WORN_SHEET.h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    return "";
  }
  const want = new Set(needs.length > 0 ? needs : WORN_FRAMES);
  for (const id of ALL_FRAME_IDS) {
    const { x, y } = sheetCell(id);
    if (!want.has(id)) {
      hatch(ctx, x, y);
      continue;
    }
    const [frame, facing] = id.toUpperCase().split("-") as [BodyFrame, Facing];
    const cell = document.createElement("canvas");
    cell.width = WORN_CELL.w;
    cell.height = WORN_CELL.h;
    const cc = cell.getContext("2d", { willReadFrequently: true });
    if (!cc) {
      continue;
    }
    for (const l of paperdollLayersWith(rules, { head }, frame, facing)) {
      if (!same(l, "BIM")) {
        drawSprite(cc, a, "paperdoll", l, 0, 0, true);
      }
    }
    if (mirrored && isNorthFrame(id)) {
      const d = cc.getImageData(0, 0, WORN_CELL.w, WORN_CELL.h);
      const flipped = mirrorWorn({ width: d.width, height: d.height, data: d.data });
      cc.clearRect(0, 0, WORN_CELL.w, WORN_CELL.h);
      cc.putImageData(
        new ImageData(new Uint8ClampedArray(flipped.data), flipped.width, flipped.height),
        0,
        0,
      );
    }
    ctx.globalAlpha = 0.5;
    ctx.drawImage(cell, x, y);
    ctx.globalAlpha = 1;
    if (mirrored && isNorthFrame(id)) {
      ctx.fillStyle = "#ff0000";
      ctx.fillRect(x + WORN_MIRROR_AXIS + 1, y, 1, WORN_CELL.h);
    }
  }
  return c.toDataURL("image/png");
}

/** Grey diagonal lines over a cell: a frame the game never draws. */
export function hatch(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = "#8a8a8a";
  for (let k = 0; k < WORN_CELL.w + WORN_CELL.h; k += 6) {
    for (let t = 0; t < WORN_CELL.h; t++) {
      const px = k - t;
      if (px >= 0 && px < WORN_CELL.w) {
        ctx.fillRect(x + px, y + t, 1, 1);
      }
    }
  }
}

export function guideLink(
  id: string,
  name: () => string,
  url: () => Promise<string>,
): HTMLAnchorElement {
  const link = action(document.createElement("a"), id);
  link.className = "item-art-template";
  link.textContent = "Download a guide sheet";
  link.href = "#";
  link.addEventListener("click", (e) => {
    if (link.dataset.ready === "1") {
      delete link.dataset.ready;
      return;
    }
    e.preventDefault();
    void url().then((u) => {
      if (!u) {
        return;
      }
      link.href = u;
      link.download = `${name()}-guide.png`;
      link.dataset.ready = "1";
      link.click();
    });
  });
  return link;
}

// ---- the panel --------------------------------------------------------------------------------

export interface WornArtOptions {
  assets: Assets;
  /** Uploads one PNG; the stored file, or why it was refused. */
  upload(file: File): Promise<{ ok: true; stored: StoredUpload } | { ok: false; error: string }>;
  /** Cuts an uploaded sheet into frame files (nothing goes in the draft). */
  slice(
    sheet: string,
  ): Promise<
    { ok: true; frames: Partial<Record<ArtFrameId, string>> } | { ok: false; error: string }
  >;
  /** Puts one worn change in the draft (the server makes it as a whole). */
  apply(change: WornChange): Promise<{ ok: boolean; text: string }>;
  decode?(src: string | Blob): Promise<Pixels | null>;
  /** The draft changed: the page refreshes what it shows. */
  saved(): void;
}

export interface WornArtPicker {
  readonly el: HTMLElement;
  /** Shows an item's layer, or a layer by name (the view is the draft's, from `contentWornArt`). */
  show(target: WornTarget, view: ContentWornArtView): void;
  clear(): void;
  /** Frames set up but not yet saved to the draft. */
  pending(): boolean;
  /** What it shows, or null when hidden. */
  current(): WornTarget | null;
}

/** The frames worth keeping: never F4-S, and only frames a wearer draws when something wears it. */
export function keptFrames<T>(
  frames: Iterable<[ArtFrameId, T]>,
  use: WornLayerUse | undefined,
): [ArtFrameId, T][] {
  const needs = new Set(use?.needs ?? []);
  return [...frames].filter(([id]) => id !== "f4-s" && (needs.size === 0 || needs.has(id)));
}

/** A frame being set up: its stored file and its pixels. */
interface WornFrame {
  file: string;
  /** Null when the browser could not read it: it is kept as it is, unseen in the preview. */
  raw: Pixels | null;
}

/** A layer's frames being set up, or a saved upload being changed. */
interface WornWorking {
  frames: Map<ArtFrameId, WornFrame>;
  mirrored: boolean;
  transparency: PictureTransparency;
}

/** The previews' timing: a walk step every 150 ms (F1, F2, F3, F2). */
const STEP_MS = 150;
const WALK: readonly BodyFrame[] = ["F1", "F2", "F3", "F2"];
/** The walking and attacking preview: the four facings side by side. */
const PREVIEW_GAP = 8;

/** Whether the live atlas draws a layer frame from an upload (an operator sheet). */
function liveIsUpload(a: Assets, name: string): boolean {
  const s = a.sprite("paperdoll", name);
  return s !== undefined && (a.index.atlases.paperdoll.sheets[s[0]] ?? "").startsWith("operator/");
}

export function createWornArtPicker(opts: WornArtOptions, idPrefix = "worn-art"): WornArtPicker {
  const a = opts.assets;
  const decode = opts.decode ?? loadPixels;
  const el = document.createElement("section");
  el.className = "item-art worn-art";
  el.setAttribute("aria-label", "Worn picture");
  el.hidden = true;
  const title = document.createElement("h4");
  title.className = "item-art-title";
  title.textContent = "Worn picture";
  const state = document.createElement("p");
  state.className = "item-art-state";
  const source = document.createElement("p");
  source.className = "item-art-state";
  const status = document.createElement("p");
  status.className = "item-art-status";
  status.setAttribute("role", "status");

  let target: WornTarget | null = null;
  /** The saved upload's frames are still loading. */
  let loading = false;
  /** The target shown last, kept through `clear` (the page clears the panel while a row reloads). */
  let lastTarget: WornTarget | null = null;
  let view: ContentWornArtView | null = null;
  let layer: string | null = null;
  let look: Look | null = null;
  let rules: PaperdollRules | null = null;
  let working: WornWorking | null = null;
  /** The working set is the saved upload, unchanged. */
  let pristine = false;
  /** Bumped when what is shown changes hands: a load for an older one is dropped. */
  let generation = 0;
  /** The frames as the game will draw them, and their checks. */
  let shown = new Map<ArtFrameId, HTMLCanvasElement>();
  let reports = new Map<ArtFrameId, WornFrameReport>();

  // ---- previews ----
  const previews = document.createElement("div");
  previews.className = "item-art-previews";
  const motion = document.createElement("canvas");
  motion.width = WORN_FACINGS.length * WORN_CELL.w + (WORN_FACINGS.length - 1) * PREVIEW_GAP;
  motion.height = WORN_CELL.h;
  motion.className = "item-art-preview worn-art-motion";
  motion.setAttribute("role", "img");
  const grid = document.createElement("canvas");
  grid.width = WORN_SHEET.w;
  grid.height = WORN_SHEET.h;
  grid.className = "item-art-preview worn-art-grid";
  grid.setAttribute("role", "img");
  grid.setAttribute(
    "aria-label",
    "Every frame on the sheet: rows north, east, south and west, columns F1 to F4",
  );
  const doll = document.createElement("canvas");
  doll.width = WORN_CELL.w;
  doll.height = WORN_CELL.h;
  doll.className = "item-art-preview worn-art-doll";
  doll.setAttribute("role", "img");
  doll.setAttribute("aria-label", "In the inventory's paperdoll");
  const figure = (c: HTMLCanvasElement, caption: string) => {
    const f = document.createElement("figure");
    f.className = "item-art-figure";
    const cap = document.createElement("figcaption");
    cap.textContent = caption;
    f.append(c, cap);
    return f;
  };
  const mode = action(document.createElement("select"), `${idPrefix}-mode`);
  for (const [value, label] of [
    ["walk", "Walking"],
    ["attack", "Attacking"],
  ] as const) {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = label;
    mode.append(o);
  }
  const motionFig = figure(motion, "Facing north, east, south and west");
  motionFig.prepend(mode);
  previews.append(
    motionFig,
    figure(doll, "In the inventory (F2 facing south)"),
    figure(
      grid,
      "Every frame: red is missing or wrong, grey is never drawn, blue marks the mirror line",
    ),
  );

  // ---- controls ----
  const mirrored = action(document.createElement("input"), `${idPrefix}-mirrored`);
  mirrored.type = "checkbox";
  mirrored.checked = true;
  const mirroredLabel = document.createElement("label");
  mirroredLabel.className = "item-art-check";
  mirroredLabel.append(mirrored, " North frames are drawn 1.6-style (as seen from the front)");
  const mirroredNote = document.createElement("p");
  mirroredNote.className = "item-art-rules";
  mirroredNote.textContent = MIRRORED_NOTE;
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
  const controls = document.createElement("div");
  controls.className = "item-art-controls";
  controls.append(formField("Transparency", transparency), mirroredLabel, mirroredNote);
  const notes = document.createElement("div");
  notes.className = "item-art-notes";

  const file = action(document.createElement("input"), `${idPrefix}-files`);
  file.type = "file";
  file.multiple = true;
  file.accept = ".png,image/png";
  file.setAttribute("aria-label", "Frame PNGs named like Moonblade-f1-e.png, or one sheet");
  file.addEventListener("change", () => {
    const list = [...(file.files ?? [])];
    file.value = "";
    if (list.length > 0) {
      void addFiles(list);
    }
  });
  const guide = guideLink(
    `${idPrefix}-guide`,
    () => layer ?? "worn",
    () =>
      view && rules
        ? guideSheet(a, rules, view.head, layerUse()?.needs ?? [], mirrored.checked)
        : Promise.resolve(""),
  );

  const saveBtn = panelButton(
    `${idPrefix}-save`,
    "Save the frames to the draft",
    () => {
      if (layer && working) {
        void commit({
          op: "set",
          layer,
          // A frame no wearer draws is left out (the panel said so).
          frames: Object.fromEntries(
            keptFrames(working.frames, layerUse()).map(([id, f]) => [id, f.file]),
          ),
          mirrored: working.mirrored,
          transparency: working.transparency,
        });
      }
    },
    "primary",
  );
  const cancelBtn = panelButton(`${idPrefix}-cancel`, "Cancel", () => {
    if (target && view) {
      show(target, view);
    }
  });
  const removeBtn = panelButton(
    `${idPrefix}-remove`,
    "Remove the upload",
    () => {
      if (layer) {
        void commit({ op: "remove", layer });
      }
    },
    "danger",
  );
  const ownBtn = panelButton(`${idPrefix}-own`, "Give it a layer of its own", () => {
    if (target?.kind === "item") {
      void commit({ op: "ownLayer", item: target.item });
    }
  });

  const uploadRow = document.createElement("div");
  uploadRow.className = "content-buttons";
  uploadRow.append(file, guide);
  const buttons = document.createElement("div");
  buttons.className = "content-buttons";
  buttons.append(saveBtn, cancelBtn, removeBtn, ownBtn);
  const rulesText = document.createElement("p");
  rulesText.className = "item-art-rules";
  rulesText.textContent = WORN_RULES;
  const editor = document.createElement("div");
  editor.className = "item-art-editor";
  editor.append(previews, controls);
  el.append(title, state, source, editor, notes, buttons, status, uploadRow, rulesText);

  const layerUse = () => (view && layer ? wornUse(view, layer) : undefined);

  let busy = false;
  async function commit(change: WornChange): Promise<void> {
    if (busy) {
      return;
    }
    busy = true;
    status.textContent = "Saving…";
    try {
      const r = await opts.apply(change);
      status.textContent = r.text;
      if (r.ok) {
        pristine = true;
        opts.saved();
      }
    } finally {
      busy = false;
    }
  }

  /** Checks every working frame and the set, and redraws. */
  function sync(): void {
    shown = new Map();
    reports = new Map();
    const use = layerUse();
    const lines: { text: string; error: boolean }[] = [];
    if (working) {
      mirrored.checked = working.mirrored;
      transparency.value = working.transparency;
      for (const [id, f] of working.frames) {
        if (!f.raw) {
          lines.push({ text: `${id} could not be read for the preview; it is kept`, error: false });
          continue;
        }
        const k = keyed(f.raw, working.transparency);
        const r = wornFrameReport(k, id, working.mirrored, use ? use.needs.includes(id) : null);
        reports.set(id, r);
        shown.set(id, pixelCanvas(shownFrame(f.raw, id, working.mirrored, working.transparency)));
        for (const e of r.errors) {
          lines.push({ text: e, error: true });
        }
        for (const w of r.warnings) {
          lines.push({ text: w, error: false });
        }
      }
      const row = { frames: Object.fromEntries([...working.frames.keys()].map((id) => [id, {}])) };
      const missing = missingFrames(row as Pick<ArtWorn, "frames">, use);
      if (missing.length > 0) {
        lines.push({
          text: `Publishing waits for ${missing.join(", ")}: ${wornByText(use)} draw${(use?.engine.length ?? 0) + (use?.wornBy.length ?? 0) > 1 ? "" : "s"} them.`,
          error: false,
        });
      }
    }
    const ul = document.createElement("ul");
    ul.className = "item-art-messages";
    for (const l of lines) {
      const li = document.createElement("li");
      li.className = l.error ? "item-art-error" : "item-art-warning";
      li.textContent = l.text;
      ul.append(li);
    }
    notes.replaceChildren(ul);
    controls.hidden = working === null;
    updateButtons();
    drawStill();
  }

  function updateButtons(): void {
    const pending = working !== null && !pristine;
    saveBtn.hidden = !pending;
    saveBtn.disabled = [...reports.values()].some((r) => r.errors.length > 0);
    cancelBtn.hidden = !pending;
    removeBtn.hidden = pending || !(view && layer && wornUpload(view, layer));
    const t = target;
    const item = t?.kind === "item" ? view?.items.find((i) => same(i.name, t.item)) : undefined;
    ownBtn.hidden = !item?.ownLayerPossible;
    uploadRow.hidden = layer === null;
    // Frames chosen while the saved ones load would be added to an empty set and save over them.
    file.disabled = loading || busy;
  }

  mirrored.addEventListener("change", () => {
    if (working) {
      working.mirrored = mirrored.checked;
      pristine = false;
      sync();
    }
  });
  transparency.addEventListener("change", () => {
    if (working) {
      working.transparency = transparency.value === "green" ? "green" : "alpha";
      pristine = false;
      sync();
    }
  });
  mode.addEventListener("change", () => drawMotion());

  /** Draws one frame of the character with the layer at (x, 0). */
  function drawCell(
    ctx: CanvasRenderingContext2D,
    x: number,
    frame: BodyFrame,
    facing: Facing,
  ): void {
    if (!view || !rules || !layer) {
      return;
    }
    const id = `${frame}-${facing}`.toLowerCase() as ArtFrameId;
    for (const l of previewStack(rules, look, view.head, layer, frame, facing)) {
      if (l.mine && working) {
        const c = shown.get(id);
        if (c) {
          ctx.drawImage(c, x, 0);
        }
      } else if (!(l.mine && comingBack())) {
        drawSprite(ctx, a, "paperdoll", l.name, x, 0, true);
      }
    }
  }

  /** The live atlas still draws an upload the draft takes out: the pack's comes back on publish. */
  const comingBack = () =>
    !working &&
    view !== null &&
    layer !== null &&
    !wornUpload(view, layer) &&
    WORN_FRAMES.some((f) => liveIsUpload(a, `${layer}-${f}`));

  let step = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  function drawMotion(): void {
    const ctx = motion.getContext("2d");
    if (!ctx) {
      return;
    }
    ctx.clearRect(0, 0, motion.width, motion.height);
    ctx.fillStyle = "#3f7a34";
    ctx.fillRect(0, 0, motion.width, motion.height);
    WORN_FACINGS.forEach((facing, i) => {
      const frame: BodyFrame =
        mode.value === "attack"
          ? facing === "S"
            ? "F3"
            : "F4"
          : (WALK[step % WALK.length] as BodyFrame);
      drawCell(ctx, i * (WORN_CELL.w + PREVIEW_GAP), frame, facing);
    });
  }

  function drawStill(): void {
    void a
      .loadGroup("paperdoll")
      .catch(() => {})
      .then(() => {
        const dc = doll.getContext("2d");
        if (dc) {
          dc.clearRect(0, 0, doll.width, doll.height);
          drawCell(dc, 0, "F2", "S");
        }
        drawGrid();
        drawMotion();
      });
  }

  function drawGrid(): void {
    const ctx = grid.getContext("2d");
    if (!ctx || !view || !layer) {
      return;
    }
    ctx.clearRect(0, 0, grid.width, grid.height);
    ctx.fillStyle = "#26301f";
    ctx.fillRect(0, 0, grid.width, grid.height);
    const use = layerUse();
    const needs = new Set(use?.needs ?? []);
    const packHas = new Set(working ? [] : packFrames(view, layer));
    for (const id of ALL_FRAME_IDS) {
      const { x, y } = sheetCell(id);
      const drawnAtAll =
        WORN_FRAMES.includes(id) && (use === undefined || needs.has(id) || needs.size === 0);
      const has = working ? working.frames.has(id) : packHas.has(id);
      if (!drawnAtAll) {
        hatch(ctx, x, y);
      }
      if (working) {
        const c = shown.get(id);
        if (c) {
          ctx.drawImage(c, x, y);
        }
      } else if (has && !comingBack()) {
        drawSprite(ctx, a, "paperdoll", `${layer}-${id}`, x, y, true);
      }
      const r = reports.get(id);
      const bad = (r?.errors.length ?? 0) > 0;
      const missing = needs.has(id) && !has;
      if (bad || missing) {
        ctx.strokeStyle = "#ff4040";
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, WORN_CELL.w - 1, WORN_CELL.h - 1);
      }
      if (working?.mirrored && isNorthFrame(id) && drawnAtAll) {
        ctx.fillStyle = "rgba(80, 220, 255, 0.8)";
        ctx.fillRect(x + WORN_MIRROR_AXIS + 1, y, 1, WORN_CELL.h);
      }
    }
    ctx.strokeStyle = "#000";
    for (let i = 1; i < WORN_STEPS.length; i++) {
      ctx.beginPath();
      ctx.moveTo(i * WORN_CELL.w + 0.5, 0);
      ctx.lineTo(i * WORN_CELL.w + 0.5, grid.height);
      ctx.stroke();
    }
    for (let i = 1; i < WORN_FACINGS.length; i++) {
      ctx.beginPath();
      ctx.moveTo(0, i * WORN_CELL.h + 0.5);
      ctx.lineTo(grid.width, i * WORN_CELL.h + 0.5);
      ctx.stroke();
    }
  }

  function startTimer(): void {
    if (timer !== null) {
      return;
    }
    timer = setInterval(() => {
      if (!el.isConnected || el.hidden) {
        stopTimer();
        return;
      }
      step += 1;
      if (mode.value === "walk") {
        drawMotion();
      }
    }, STEP_MS);
  }
  function stopTimer(): void {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  /** The working set to add files to: what is being set up, else the saved upload. */
  function base(): WornWorking {
    if (working) {
      return { ...working, frames: new Map(working.frames) };
    }
    return { frames: new Map(), mirrored: true, transparency: "alpha" };
  }

  async function addFiles(list: File[]): Promise<void> {
    const mine = ++generation;
    if (!layer || !view) {
      return;
    }
    const files = wornFiles(list.map((f) => f.name));
    if (files.kind === "bad") {
      status.textContent = files.error;
      return;
    }
    status.textContent = `Uploading ${list.length === 1 ? (list[0]?.name ?? "") : `${list.length} files`}…`;
    if (files.kind === "sheet") {
      const f = list[0] as File;
      const raw = await decode(f);
      if (mine !== generation) {
        return;
      }
      if (!raw) {
        status.textContent = "The browser could not read that sheet.";
        return;
      }
      if (raw.width !== WORN_SHEET.w || raw.height !== WORN_SHEET.h) {
        status.textContent = `${f.name} is ${raw.width}×${raw.height}; a worn sheet is ${WORN_SHEET.w}×${WORN_SHEET.h}. Frames on their own are named like ${layer}-f1-e.png.`;
        return;
      }
      const stored = await opts.upload(f);
      if (mine !== generation) {
        return;
      }
      if (!stored.ok) {
        status.textContent = `Refused: ${stored.error}`;
        return;
      }
      const cut = await opts.slice(stored.stored.file);
      if (mine !== generation) {
        return;
      }
      if (!cut.ok) {
        status.textContent = `Refused: ${cut.error}`;
        return;
      }
      const b = base();
      // A sheet is the whole set.
      const frames = new Map<ArtFrameId, WornFrame>();
      for (const id of ALL_FRAME_IDS) {
        const hash = cut.frames[id];
        if (hash) {
          frames.set(id, { file: hash, raw: sheetFrame(raw, id) });
        }
      }
      working = {
        frames,
        mirrored: b.mirrored,
        transparency: guessTransparency(raw),
      };
      pristine = false;
      status.textContent = `${f.name} is cut into ${frames.size} frame${frames.size === 1 ? "" : "s"}: check the preview, then save them to the draft.`;
      sync();
      return;
    }
    const b = base();
    let first: Pixels | null = null;
    for (const { file: name, frame } of files.frames) {
      const f = list.find((x) => x.name === name) as File;
      const [stored, raw] = await Promise.all([opts.upload(f), decode(f)]);
      if (mine !== generation) {
        return;
      }
      if (!stored.ok) {
        status.textContent = `${name} refused: ${stored.error}`;
        return;
      }
      if (!raw) {
        status.textContent = `The browser could not read ${name}.`;
        return;
      }
      first ??= raw;
      b.frames.set(frame, { file: stored.stored.file, raw });
    }
    if (!working && first) {
      b.transparency = guessTransparency(first);
    }
    working = b;
    pristine = false;
    status.textContent = `${files.frames.length} frame${files.frames.length === 1 ? "" : "s"} uploaded: check the preview, then save them to the draft.`;
    sync();
  }

  function show(t: WornTarget, v: ContentWornArtView): void {
    const mine = ++generation;
    const sameTarget =
      lastTarget !== null &&
      lastTarget.kind === t.kind &&
      same(
        lastTarget.kind === "item" ? lastTarget.item : lastTarget.layer,
        t.kind === "item" ? t.item : t.layer,
      );
    if (!sameTarget) {
      status.textContent = "";
    }
    target = t;
    lastTarget = t;
    loading = false;
    view = v;
    rules = draftRules(v);
    working = null;
    pristine = false;
    const item = t.kind === "item" ? v.items.find((i) => same(i.name, t.item)) : undefined;
    if (t.kind === "item" && !item) {
      clear();
      return;
    }
    if (item) {
      layer = item.layer;
    } else if (t.kind === "layer") {
      layer = wornLayerList(v).find((l) => same(l.name, t.layer))?.name ?? t.layer;
    }
    el.hidden = false;
    const use = layer ? wornUse(v, layer) : undefined;
    look = layer ? previewLook(v, t, layer) : null;
    title.textContent = item ? "Worn picture" : `Worn layer: ${layer}`;
    motion.setAttribute(
      "aria-label",
      `${layer ?? "Nothing"} walking or attacking, facing north, east, south and west`,
    );
    state.textContent = item
      ? wornItemText(item, use)
      : `Drawn by ${wornByText(use)}.${use && use.needs.length > 0 ? ` It needs ${use.needs.length} frames.` : " Nothing wears it: any frames will do."}`;
    if (layer === null) {
      source.textContent = "";
      sync();
      stopTimer();
      return;
    }
    const src = wornSource(v, layer);
    const needs = use?.needs.length ?? 0;
    if (src.kind === "upload") {
      const have = WORN_FRAMES.filter((f) => src.art.frames[f]).length;
      source.textContent = `It draws your upload (${have} frame${have === 1 ? "" : "s"}${needs > 0 ? ` of the ${needs} it needs` : ""}). Choose frames to replace some, or a sheet to replace them all.`;
      loading = true;
      sync();
      const entries = ALL_FRAME_IDS.flatMap((id) => {
        const fr = src.art.frames[id];
        return fr ? [[id, fr.file] as const] : [];
      });
      void Promise.all(entries.map(([, f]) => decode(uploadUrl({ file: f, ext: "png" })))).then(
        (raws) => {
          if (mine !== generation) {
            return;
          }
          loading = false;
          const frames = new Map<ArtFrameId, WornFrame>();
          // A frame the browser cannot read is kept, so a save never drops it.
          entries.forEach(([id, f], i) => {
            frames.set(id, { file: f, raw: raws[i] ?? null });
          });
          working = {
            frames,
            mirrored: src.art.mirrored === true,
            transparency: src.art.transparency ?? "alpha",
          };
          pristine = true;
          sync();
        },
      );
    } else if (src.kind === "pack") {
      source.textContent = comingBackFor(v, layer)
        ? "It will draw the pack's layer once the draft is published (the draft takes out the upload that replaced it; the preview cannot show the pack's until then)."
        : `It draws the pack's layer (${src.frames.filter((f) => WORN_FRAMES.includes(f)).length} frames). Upload frames or a sheet to replace it.`;
      sync();
    } else {
      source.textContent = "It has no worn picture yet: upload its frames or a sheet.";
      sync();
    }
    startTimer();
  }

  const comingBackFor = (v: ContentWornArtView, l: string) =>
    !wornUpload(v, l) && WORN_FRAMES.some((f) => liveIsUpload(a, `${l}-${f}`));

  function clear(): void {
    generation += 1;
    loading = false;
    target = null;
    view = null;
    layer = null;
    working = null;
    el.hidden = true;
    stopTimer();
  }

  return {
    el,
    show,
    clear,
    pending: () => !el.hidden && working !== null && !pristine,
    current: () => (el.hidden ? null : target),
  };
}

// ---- the Worn layers section ------------------------------------------------------------------

export type WornLayersOptions = WornArtOptions;

export interface WornLayers {
  /** Frames set up in the section's panel but not yet saved. */
  pending(): boolean;
  /** Drops frames set up in the section's panel. */
  discard(): void;
  readonly el: HTMLElement;
  setView(view: ContentWornArtView): void;
  reset(): void;
}

/** One layer's files in a bulk upload. */
interface WornBulkLine {
  group: WornGroup;
  files: File[];
  /** The layer it attaches to (matched by name, or picked by hand). */
  layer: string;
  replace: boolean;
  /** Why the layer typed for it takes no frames, if it does not. */
  note: string;
  /** Each file's pixels once read (null while reading), to check the frames before attaching. */
  raws: Map<string, Pixels | null> | null;
  done: string;
}

/**
 * The transparency a bulk line is saved with, and checked with: a sheet's own guess (it replaces
 * every frame), else the upload's it joins, else the first frame's guess.
 */
export function bulkTransparency(
  names: readonly string[],
  raws: ReadonlyMap<string, Pixels | null>,
  existing: ArtWorn | undefined,
): PictureTransparency {
  const sorted = wornFiles(names);
  if (sorted.kind === "sheet") {
    const raw = raws.get(sorted.file);
    return raw ? guessTransparency(raw) : "alpha";
  }
  if (existing) {
    return existing.transparency ?? "alpha";
  }
  const first = sorted.kind === "frames" ? raws.get(sorted.frames[0]?.file ?? "") : null;
  return first ? guessTransparency(first) : "alpha";
}

/**
 * Whether a bulk line's north frames are flipped: a sheet replaces the layer and takes the
 * section's box; frames joining an upload take that upload's setting, so its other frames stay as
 * they were drawn.
 */
export function bulkMirrored(
  names: readonly string[],
  existing: ArtWorn | undefined,
  box: boolean,
): boolean {
  return wornFiles(names).kind === "frames" && existing ? existing.mirrored === true : box;
}

/**
 * What is wrong with a bulk line's frames: a sheet of the wrong size, a frame too large, or a
 * flipped north frame with pixels past the mirror line. A frame no wearer draws is left out, so it
 * is not held against the line. "" when nothing is.
 */
export function bulkFrameErrors(
  names: readonly string[],
  raws: ReadonlyMap<string, Pixels | null>,
  mirrored: boolean,
  transparency: PictureTransparency,
  use?: WornLayerUse,
): string {
  const sorted = wornFiles(names);
  if (sorted.kind === "bad") {
    return sorted.error;
  }
  const needed = (id: ArtFrameId) =>
    use === undefined || use.needs.length === 0 ? null : use.needs.includes(id);
  const errors: string[] = [];
  const check = (raw: Pixels, id: ArtFrameId) => {
    errors.push(...wornFrameReport(keyed(raw, transparency), id, mirrored, needed(id)).errors);
  };
  if (sorted.kind === "sheet") {
    const raw = raws.get(sorted.file);
    if (!raw) {
      return `The browser could not read ${sorted.file}.`;
    }
    if (raw.width !== WORN_SHEET.w || raw.height !== WORN_SHEET.h) {
      return `${sorted.file} is ${raw.width}×${raw.height}; a worn sheet is ${WORN_SHEET.w}×${WORN_SHEET.h}.`;
    }
    for (const id of ALL_FRAME_IDS) {
      const cell = sheetFrame(raw, id);
      // A blank cell is left out by the server.
      if (!blankCell(cell)) {
        check(cell, id);
      }
    }
  } else {
    for (const { file, frame } of sorted.frames) {
      const raw = raws.get(file);
      if (!raw) {
        return `The browser could not read ${file}.`;
      }
      check(raw, frame);
    }
  }
  return errors.join("; ");
}

export function createWornLayers(opts: WornLayersOptions): WornLayers {
  const decode = opts.decode ?? loadPixels;
  const el = document.createElement("div");
  el.className = "item-pictures worn-layers";
  let view: ContentWornArtView | null = null;
  let lines: WornBulkLine[] = [];
  const status = document.createElement("p");
  status.className = "item-art-status";
  status.setAttribute("role", "status");
  const rules = document.createElement("p");
  rules.className = "item-art-rules";
  rules.textContent = `${WORN_RULES} Name each sheet after its layer or item (Moonblade.png), and each frame after it too (Moonblade-f1-e.png): names are matched to item keys, then to the names players see (each item's layer), then to layer names, ignoring case. A file's frames are added to the layer's upload; a sheet replaces it.`;

  const mirrored = action(document.createElement("input"), "worn-layers-mirrored");
  mirrored.type = "checkbox";
  mirrored.checked = true;
  const mirroredLabel = document.createElement("label");
  mirroredLabel.className = "item-art-check";
  mirroredLabel.append(mirrored, " North frames are drawn 1.6-style (as seen from the front)");
  const mirroredNote = document.createElement("p");
  mirroredNote.className = "item-art-rules";
  mirroredNote.textContent = MIRRORED_NOTE;
  // The mirror line only binds flipped north frames: check the list again.
  mirrored.addEventListener("change", () => redraw());

  const files = action(document.createElement("input"), "worn-layers-files");
  files.type = "file";
  files.multiple = true;
  files.accept = ".png,image/png";
  files.setAttribute("aria-label", "Worn sheets and frames named after their layers or items");
  files.addEventListener("change", () => {
    const list = [...(files.files ?? [])];
    files.value = "";
    addFiles(list);
  });
  const guide = guideLink(
    "worn-layers-guide",
    () => "worn",
    () =>
      view
        ? guideSheet(opts.assets, draftRules(view), view.head, WORN_FRAMES, mirrored.checked)
        : Promise.resolve(""),
  );

  const layerListId = "worn-layers-names";
  const layerList = document.createElement("datalist");
  layerList.id = layerListId;

  const lineCheck = (l: WornBulkLine): string => {
    if (!view) {
      return "";
    }
    const sorted = wornFiles(l.files.map((f) => f.name));
    if (sorted.kind === "bad") {
      return sorted.error;
    }
    if (l.raws === null) {
      return "Reading…";
    }
    const names = l.files.map((f) => f.name);
    const frames = bulkFrameErrors(
      names,
      l.raws,
      bulkMirrored(names, l.layer ? wornUpload(view, l.layer) : undefined, mirrored.checked),
      bulkTransparency(names, l.raws, l.layer ? wornUpload(view, l.layer) : undefined),
      l.layer ? wornUse(view, l.layer) : undefined,
    );
    if (frames) {
      return frames;
    }
    if (!l.layer) {
      return l.note || "Pick its layer.";
    }
    if (same(l.layer, "BIM") || same(l.layer, "NOTHING")) {
      return `${l.layer} is not a layer that can be uploaded.`;
    }
    if (lines.some((o) => o !== l && !o.done && same(o.layer, l.layer))) {
      return `Another line is for ${l.layer} too: pick a different layer for one of them, or clear the list.`;
    }
    return "";
  };

  const table = createTable<WornBulkLine>({
    label: "Worn layers to attach",
    empty: "No files chosen.",
    key: (l) => `${l.group.stem}:${lines.indexOf(l)}`,
    columns: [
      { label: "Files", cell: (l) => l.group.files.join(", ") },
      {
        label: "Layer",
        cell: (l) => {
          const input = action(document.createElement("input"), "worn-layers-layer");
          input.type = "text";
          input.setAttribute("list", layerListId);
          input.setAttribute("aria-label", `The layer ${l.group.stem} is for`);
          input.value = l.layer;
          input.disabled = attaching || l.done !== "";
          input.placeholder = "Not matched: pick a layer";
          input.addEventListener("change", () => {
            const typed = input.value.trim();
            const m = view ? matchWornLayer(typed, view) : null;
            // An item that draws nothing when worn takes no frames; a name nothing draws yet is a
            // new layer.
            const item = view?.items.some(
              (i) => same(i.name, typed) || (i.display !== undefined && same(i.display, typed)),
            );
            l.layer = m?.layer ?? (item ? "" : typed);
            l.note = m && m.layer === null && item ? m.why : "";
            l.replace =
              view !== null && l.layer !== "" && wornSource(view, l.layer).kind !== "none";
            redraw();
          });
          return input;
        },
      },
      {
        label: "Replaces",
        cell: (l) => {
          if (l.done || !view || !l.layer || wornSource(view, l.layer).kind === "none") {
            return "";
          }
          const box = action(document.createElement("input"), "worn-layers-replace");
          box.type = "checkbox";
          box.checked = l.replace;
          box.disabled = attaching;
          box.setAttribute("aria-label", `Replace ${l.layer}'s frames`);
          box.addEventListener("change", () => {
            l.replace = box.checked;
          });
          const label = document.createElement("label");
          label.className = "item-art-check";
          label.append(box, " its frames");
          return label;
        },
      },
      { label: "Check", cell: (l) => l.done || lineCheck(l) || "Ready." },
    ],
  });

  function addFiles(list: File[]): void {
    if (!view || list.length === 0) {
      return;
    }
    const v = view;
    const added = groupWornFiles(list.map((f) => f.name)).map((group): WornBulkLine => {
      const m = matchWornLayer(group.stem, v);
      const layer = m.layer ?? "";
      return {
        group,
        files: group.files.map((n) => list.find((f) => f.name === n) as File),
        layer,
        replace: layer !== "" && wornSource(v, layer).kind !== "none",
        raws: null,
        note: "",
        done: "",
      };
    });
    lines = [...lines.filter((l) => !l.done), ...added];
    const mine = batch;
    for (const l of added) {
      void Promise.all(l.files.map((f) => decode(f))).then((raws) => {
        if (mine === batch) {
          l.raws = new Map(l.files.map((f, i) => [f.name, raws[i] ?? null]));
          redraw();
        }
      });
    }
    const unmatched = added.filter((l) => !l.layer);
    status.textContent =
      unmatched.length > 0
        ? `${unmatched.map((l) => (matchWornLayer(l.group.stem, v) as { why?: string }).why ?? l.group.stem).join(" ")} Pick ${unmatched.length === 1 ? "its layer" : "their layers"} by hand.`
        : "Every file matches a layer.";
    redraw();
  }

  const attach = panelButton(
    "worn-layers-attach",
    "Attach to their layers",
    () => void attachAll(),
    "primary",
  );
  let attaching = false;
  /** Bumped by Clear: a batch still running for a cleared list stops. */
  let batch = 0;
  /** The batch attaching now: one a Clear or Discard has cut short is no longer unsaved work. */
  let activeBatch = -1;
  async function attachAll(): Promise<void> {
    if (!view || attaching) {
      return;
    }
    attaching = true;
    const mine = batch;
    activeBatch = mine;
    redraw();
    let saved = 0;
    try {
      for (const l of lines.filter((x) => !x.done && lineCheck(x) === "")) {
        if (mine !== batch || !view) {
          return;
        }
        // The line's layer as it is now: its box is locked until the batch is done.
        const layer = l.layer;
        if (wornSource(view, layer).kind !== "none" && !l.replace) {
          l.done = "Skipped: it keeps its frames.";
          continue;
        }
        const r = await attachOne(l, layer, view, mine);
        if (mine !== batch) {
          return;
        }
        l.done = r.ok ? `In the draft for ${layer}.` : `Not saved: ${r.text}`;
        saved += r.ok ? 1 : 0;
        redraw();
      }
    } finally {
      attaching = false;
      // A batch cut short by Clear or a reset still gives the controls back.
      redraw();
    }
    status.textContent =
      saved === 0
        ? "Nothing was attached."
        : `${saved} layer${saved === 1 ? " is" : "s are"} in the draft.`;
    if (saved > 0) {
      opts.saved();
    }
  }

  /** Uploads one line's files and puts the layer in the draft, checked as the list showed it. */
  async function attachOne(
    l: WornBulkLine,
    layer: string,
    v: ContentWornArtView,
    mine: number,
  ): Promise<{ ok: boolean; text: string }> {
    const names = l.files.map((f) => f.name);
    const sorted = wornFiles(names);
    const raws = l.raws;
    if (sorted.kind === "bad" || raws === null) {
      return { ok: false, text: sorted.kind === "bad" ? sorted.error : "Still reading the files." };
    }
    const existing = wornUpload(v, layer);
    const use = wornUse(v, layer);
    const transparency = bulkTransparency(names, raws, existing);
    const flip = bulkMirrored(names, existing, mirrored.checked);
    const wrong = bulkFrameErrors(names, raws, flip, transparency, use);
    if (wrong) {
      return { ok: false, text: wrong };
    }
    const frames = new Map<ArtFrameId, string>();
    if (sorted.kind === "sheet") {
      const up = await opts.upload(l.files[0] as File);
      if (!up.ok) {
        return { ok: false, text: up.error };
      }
      const cut = await opts.slice(up.stored.file);
      if (!cut.ok) {
        return { ok: false, text: cut.error };
      }
      for (const [id, file] of Object.entries(cut.frames)) {
        frames.set(id as ArtFrameId, file);
      }
    } else {
      // Frames join the upload's own.
      for (const [id, fr] of Object.entries(existing?.frames ?? {})) {
        frames.set(id as ArtFrameId, fr.file);
      }
      for (const { file: name, frame } of sorted.frames) {
        const up = await opts.upload(l.files.find((x) => x.name === name) as File);
        if (!up.ok) {
          return { ok: false, text: `${name}: ${up.error}` };
        }
        frames.set(frame, up.stored.file);
      }
    }
    // The list may have been cleared (or discarded, or the page reset) while the files uploaded.
    if (mine !== batch) {
      return { ok: false, text: "The list was cleared." };
    }
    return opts.apply({
      op: "set",
      layer,
      frames: Object.fromEntries(keptFrames(frames, use)),
      mirrored: flip,
      transparency,
    });
  }

  const clear = panelButton("worn-layers-clear", "Clear the list", () => {
    batch += 1;
    lines = [];
    status.textContent = "";
    redraw();
  });

  // Every layer, and a panel for the one opened.
  const layersTitle = document.createElement("h4");
  layersTitle.className = "item-art-title";
  const picker = createWornArtPicker(opts, "worn-layer");
  const layers = createTable<WornLayerUse>({
    label: "Worn layers",
    empty: "The content draws no worn layers.",
    key: (u) => u.name,
    open: {
      id: "worn-layers-open",
      run: (u) => {
        if (view) {
          picker.show({ kind: "layer", layer: u.name }, view);
          picker.el.scrollIntoView?.({ block: "nearest" });
        }
      },
    },
    columns: [
      { label: "Layer", cell: (u) => u.name },
      { label: "Drawn by", cell: (u) => wornByText(u) },
      {
        label: "Frames",
        cell: (u) => {
          if (!view) {
            return "";
          }
          const src = wornSource(view, u.name);
          if (src.kind === "none") {
            return u.needs.length > 0 ? "None" : "";
          }
          if (src.kind === "pack") {
            return "The pack's";
          }
          const missing = missingFrames(src.art, u).length;
          const unused = unusedFrames(src.art, u).length;
          return `Your upload${missing > 0 ? `, ${missing} missing` : ""}${unused > 0 ? `, ${unused} never drawn` : ""}`;
        },
      },
    ],
  });

  function redraw(): void {
    table.setRows(lines);
    attach.disabled = attaching || !lines.some((l) => !l.done && lineCheck(l) === "");
    files.disabled = attaching;
    mirrored.disabled = attaching;
    clear.disabled = attaching;
    const all = view ? wornLayerList(view) : [];
    const none = all.filter(
      (u) => view && u.needs.length > 0 && wornSource(view, u.name).kind === "none",
    ).length;
    layersTitle.textContent = `Worn layers (${all.length}${none > 0 ? `, ${none} with no frames` : ""})`;
    layers.setRows(all);
  }

  const row = document.createElement("div");
  row.className = "content-buttons";
  row.append(files, guide, attach, clear);
  el.append(
    rules,
    mirroredLabel,
    mirroredNote,
    row,
    layerList,
    table.el,
    status,
    layersTitle,
    layers.el,
    picker.el,
  );
  redraw();

  return {
    el,
    // Files chosen and not yet attached, or a batch still attaching, are unsaved work too.
    pending: () =>
      picker.pending() || (attaching && activeBatch === batch) || lines.some((l) => !l.done),
    discard() {
      // A batch still uploading writes nothing more.
      batch += 1;
      lines = [];
      status.textContent = "";
      picker.clear();
      redraw();
    },
    reset() {
      batch += 1;
      lines = [];
      view = null;
      status.textContent = "";
      picker.clear();
      redraw();
    },
    setView(v) {
      view = v;
      layerList.replaceChildren(
        ...[
          ...wornLayerList(v).map((u) => u.name),
          ...v.items.filter((i) => !i.retired && i.layer !== null).map((i) => i.name),
        ].map((n) => {
          const o = document.createElement("option");
          o.value = n;
          return o;
        }),
      );
      // The open panel shows the draft as it is now, unless frames are being set up in it.
      const open = picker.current();
      if (open && !picker.pending()) {
        picker.show(open, v);
      }
      redraw();
    },
  };
}
