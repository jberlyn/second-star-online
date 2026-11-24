/**
 * Monster bodies on the Content page (issue #29, stage 4): a panel that uploads a body's 16
 * frames, as separate `<name>-f1-e.png` files or one sheet, with no JSON to write. It previews the
 * body walking and attacking facing every way on its tile, beside a player for scale, with the
 * hit box drawn and the anchor draggable, shows each frame and what is wrong with it, and offers a
 * guide sheet to draw on. A "Bodies" section lists every body the content draws, makes new ones
 * and takes many files at once.
 *
 * A body is named by its number. The server picks a new body's number (from 1000) in the same
 * draft change that stores its frames and, from a monster's row, gives it to that monster. What
 * the panel writes goes through the `contentBody` intent; publishing the draft makes it live. The
 * panel is a component of its own, for the monster editor (#31).
 */
import type { ArtBody, ArtFrameId } from "@secondstaronline/data";
import {
  BODY_FRAMES,
  type BodyChange,
  type BodyFrame,
  type BodyFrameReport,
  type BodyFrameSet,
  type BodyUse,
  bodyCentreLine2,
  bodyFrameReport,
  bodySheetCell,
  bodyUsersText,
  type ContentBodyArtView,
  cutCell,
  defaultBodyAnchor,
  type Facing,
  guessTransparency,
  isNorthFrame,
  mirrorBodyFrame,
  mirrorWorn,
  PAPERDOLL_REG,
  PAPERDOLL_SIZE,
  type PictureTransparency,
  type Pixels,
  paperdollLayersWith,
  sheetCell,
  visibleBounds,
  WORN_CELL,
  WORN_FACINGS,
  WORN_SHEET,
  WORN_STEPS,
} from "@secondstaronline/shared";

import { type Assets, drawSprite } from "../assets.ts";
import { action } from "./action.ts";
import { type StoredUpload, uploadUrl } from "./art-uploads.ts";
import { createTable, formField, panelButton } from "./control-panel-kit.ts";
import { keyed, loadPixels } from "./item-art.ts";
import { groupWornFiles, guideLink, pixelCanvas, type WornGroup, wornFiles } from "./worn-art.ts";

// ---- what the panel reads (pure) --------------------------------------------------------------

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** What a panel shows: a monster's body, a body by number, or a new body. */
export type BodyTarget =
  | { kind: "monster"; monster: string }
  | { kind: "body"; body: number }
  | { kind: "new" };

/** The draft's upload for a body, if any. */
export const bodyUpload = (view: ContentBodyArtView, body: number): ArtBody | undefined =>
  view.art.find((a) => a.name === String(body));

/** The content's use of a body: who draws it. */
export const bodyUse = (view: ContentBodyArtView, body: number): BodyUse | undefined =>
  view.bodies.find((b) => b.body === body);

/** Where a body's frames will come from once the draft is published. */
export type BodySource = { kind: "upload"; art: ArtBody } | { kind: "pack" } | { kind: "none" };

export function bodySource(view: ContentBodyArtView, body: number): BodySource {
  const art = bodyUpload(view, body);
  if (art) {
    return { kind: "upload", art };
  }
  return view.packBodies.includes(body) ? { kind: "pack" } : { kind: "none" };
}

/** Every body worth listing: the ones content draws, and uploads nothing draws. */
export function bodyList(view: ContentBodyArtView): BodyUse[] {
  const out = [...view.bodies];
  for (const a of view.art) {
    const n = Number(a.name);
    if (!out.some((b) => b.body === n)) {
      out.push({ body: n, users: [], monsters: [] });
    }
  }
  return out.sort((a, b) => a.body - b.body);
}

/** The bodies a monster can be given: every upload and every pack body, in number order. */
export function availableBodies(view: ContentBodyArtView): number[] {
  return [...new Set([...view.art.map((a) => Number(a.name)), ...view.packBodies])].sort(
    (a, b) => a - b,
  );
}

/** A monster's body when it is an upload only that monster draws (an upload replaces it). */
export function ownBody(view: ContentBodyArtView, monster: string): number | null {
  const m = view.monsters.find((x) => same(x.name, monster));
  if (!m || !bodyUpload(view, m.body)) {
    return null;
  }
  const use = bodyUse(view, m.body);
  return use && use.users.length === 1 && use.monsters.length === 1 ? m.body : null;
}

/** What a bulk file's name stands for: a body by number, or a monster (by key, then display). */
export type BodyMatch =
  | { kind: "body"; body: number }
  | { kind: "monster"; monster: string; by: "key" | "display"; replaces: number | null }
  | { kind: "none"; why: string };

export function matchBody(stem: string, view: ContentBodyArtView): BodyMatch {
  if (/^\d{1,4}$/.test(stem)) {
    const n = Number(stem);
    const known =
      n >= 1 && (bodySource(view, n).kind !== "none" || view.bodies.some((b) => b.body === n));
    return known
      ? { kind: "body", body: n }
      : {
          kind: "none",
          why: `There is no body ${stem}: name a new body's files after its monster, or use New body.`,
        };
  }
  const m =
    view.monsters.find((x) => same(x.name, stem)) ??
    view.monsters.find((x) => x.display !== undefined && same(x.display, stem));
  if (m) {
    return {
      kind: "monster",
      monster: m.name,
      by: same(m.name, stem) ? "key" : "display",
      replaces: ownBody(view, m.name),
    };
  }
  return { kind: "none", why: `No monster or body is called ${stem}.` };
}

/** What the panel says about a monster's body. */
export function monsterBodyText(view: ContentBodyArtView, monster: string): string {
  const m = view.monsters.find((x) => same(x.name, monster));
  if (!m) {
    return "";
  }
  const use = bodyUse(view, m.body);
  const others = bodyUsersText(use, `monster ${m.name}`);
  return others === "nothing"
    ? `It draws body ${m.body}, which nothing else draws.`
    : `It draws body ${m.body}, shared with ${others}: repainting it repaints them all.`;
}

/** Everything a repaint of a body changes, every user named: "Repaints body 30 for …". */
export function repaintText(view: ContentBodyArtView, body: number): string {
  const users = bodyUse(view, body)?.users ?? [];
  return users.length === 0
    ? `Repaints body ${body}, which nothing draws yet.`
    : `Repaints body ${body} for ${users.length === 1 ? users[0] : `${users.slice(0, -1).join(", ")} and ${users.at(-1)}`}.`;
}

/** The files chosen for one body: a single sheet, or frames named `-f1-e`. */
export const bodyFiles = (names: readonly string[]) =>
  wornFiles(
    names,
    "name frames like Orc-f1-e.png, or choose one sheet on its own (four rows of four frames)",
  );

/**
 * The anchor for a new image of `w`×`h` taking the place of `prev`: shifted from its default as
 * much as `prev` was from its own (so a saved offset survives a frame being replaced), or the
 * default when there was no readable frame before.
 */
export function carriedAnchor(
  prev: { raw: Pixels | null; regX: number; regY: number } | undefined,
  w: number,
  h: number,
): { regX: number; regY: number } {
  const d = defaultBodyAnchor(w, h);
  if (!prev?.raw) {
    return d;
  }
  const was = defaultBodyAnchor(prev.raw.width, prev.raw.height);
  return { regX: d.regX + (prev.regX - was.regX), regY: d.regY + (prev.regY - was.regY) };
}

/** The scale preview's height: the body's extent and the player's frame, from the same point. */
export function scaleHeight(ext: { top: number; bottom: number }): number {
  return (
    Math.max(-ext.top, PAPERDOLL_REG.y) + Math.max(ext.bottom, PAPERDOLL_SIZE.h - PAPERDOLL_REG.y)
  );
}

/** How far the panel moves a body's frames, each way. */
export const OFFSET_MAX = 1024;
/** An offset typed or dragged, whole and within ±`OFFSET_MAX`. */
export const clampOffset = (n: number) =>
  Math.max(-OFFSET_MAX, Math.min(OFFSET_MAX, Math.round(n)));
/** Whether every saved anchor fits the art schema's range (±2048). */
export const anchorsInRange = (frames: BodyFrameSet["frames"]) =>
  Object.values(frames).every(
    (f) => f === undefined || (Math.abs(f.regX) <= 2048 && Math.abs(f.regY) <= 2048),
  );

/** A frame's anchor: its default for its size, moved by the panel's offset (right and down). */
export function anchorFor(
  w: number,
  h: number,
  offset: { x: number; y: number },
): { regX: number; regY: number } {
  const d = defaultBodyAnchor(w, h);
  return { regX: d.regX - offset.x, regY: d.regY - offset.y };
}

/** The flips the game makes: every north frame about the standing frame's (F2-N) centre line. */
export function shownBodyFrames(
  frames: ReadonlyMap<ArtFrameId, { raw: Pixels | null; regX: number; regY: number }>,
  mirrored: boolean,
  transparency: PictureTransparency,
): Map<ArtFrameId, { img: Pixels; regX: number; regY: number }> {
  const out = new Map<ArtFrameId, { img: Pixels; regX: number; regY: number }>();
  const standing = frames.get("f2-n");
  const line2 =
    mirrored && standing?.raw
      ? bodyCentreLine2(keyed(standing.raw, transparency), standing.regX)
      : 0;
  for (const [id, f] of frames) {
    if (!f.raw) {
      continue;
    }
    const k = keyed(f.raw, transparency);
    if (mirrored && isNorthFrame(id)) {
      const m = mirrorBodyFrame(k, f.regX, line2);
      out.set(id, { img: m.img, regX: m.regX, regY: f.regY });
    } else {
      out.set(id, { img: k, regX: f.regX, regY: f.regY });
    }
  }
  return out;
}

/** The box round what a set of anchored frames covers, from the walker's point. */
export function extentOf(frames: Iterable<{ w: number; h: number; regX: number; regY: number }>): {
  left: number;
  top: number;
  right: number;
  bottom: number;
} {
  // The tile itself: 16 px each side of the point, from 2 px to 34 px below it.
  let left = -16;
  let top = 2;
  let right = 16;
  let bottom = 34;
  for (const f of frames) {
    left = Math.min(left, -f.regX);
    top = Math.min(top, -f.regY);
    right = Math.max(right, f.w - f.regX);
    bottom = Math.max(bottom, f.h - f.regY);
  }
  return { left, top, right, bottom };
}

// ---- the guide sheet --------------------------------------------------------------------------

/** What the templates say about body frames. */
export const BODY_RULES = `A body is 16 frames: walking F1 to F3 and attacking F4, facing north, east, south and west, each up to 512×512. Monsters only walk; F4 shows when a player morphed into the body attacks. Upload separate PNGs named like Orc-f1-e.png, or one sheet: rows north, east, south and west, columns F1 to F4, every cell the same size. A frame stands where a player stands: its middle on the tile's middle and its bottom 5 px below the tile, so a 46×45 frame lines up with a player's character; drag the preview to move every frame together. What shows of each frame is its hit box. The guide sheet is 46×45 cells with a player and their tile drawn faintly.`;

/** Why `mirrored` is on unless the operator turns it off. */
export const BODY_MIRRORED_NOTE =
  "1.6 drew most monsters' back views as if seen from the front, and old 1.6 art is drawn that way, so this starts ticked: the game flips each north frame about the body's centre line (taken from F2 facing north) when it builds the art. Untick it if you drew the back views the right way round.";

/** The bare player, for the guide and for scale. */
const bareLayers = (head: number, frame: BodyFrame, facing: Facing) =>
  paperdollLayersWith({ aliases: [], has: () => false }, { head }, frame, facing).filter(
    (l) => !same(l, "BIM"),
  );

/**
 * A guide sheet: 46×45 cells (rows N, E, S, W; columns F1-F4), each with the player in that
 * frame and their tile drawn faintly (north frames flipped back the 1.6 way when `mirrored`).
 */
export async function bodyGuideSheet(a: Assets, head: number, mirrored: boolean): Promise<string> {
  await a.loadGroup("paperdoll").catch(() => {});
  const c = document.createElement("canvas");
  c.width = WORN_SHEET.w;
  c.height = WORN_SHEET.h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    return "";
  }
  for (const id of BODY_FRAMES) {
    const { x, y } = sheetCell(id);
    const [frame, facing] = id.toUpperCase().split("-") as [BodyFrame, Facing];
    const cell = document.createElement("canvas");
    cell.width = WORN_CELL.w;
    cell.height = WORN_CELL.h;
    const cc = cell.getContext("2d", { willReadFrequently: true });
    if (!cc) {
      continue;
    }
    for (const l of bareLayers(head, frame, facing)) {
      drawSprite(cc, a, "paperdoll", l, 0, 0, true);
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
    // The tile the body stands on: 16 px each side of the point, 2 to 34 px below it.
    ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
    ctx.strokeRect(x + PAPERDOLL_REG.x - 16 + 0.5, y + PAPERDOLL_REG.y + 2 + 0.5, 31, 31);
    ctx.globalAlpha = 0.4;
    ctx.drawImage(cell, x, y);
    ctx.globalAlpha = 1;
  }
  return c.toDataURL("image/png");
}

// ---- the panel --------------------------------------------------------------------------------

export interface BodyArtOptions {
  assets: Assets;
  /** Uploads one PNG; the stored file, or why it was refused. */
  upload(file: File): Promise<{ ok: true; stored: StoredUpload } | { ok: false; error: string }>;
  /** Cuts an uploaded body sheet into its 16 frame files (nothing goes in the draft). */
  slice(
    sheet: string,
  ): Promise<
    | { ok: true; cell: { w: number; h: number }; frames: Partial<Record<ArtFrameId, string>> }
    | { ok: false; error: string }
  >;
  /** Puts one body change in the draft (the server makes it as a whole). */
  apply(change: BodyChange): Promise<{ ok: boolean; text: string; body?: number }>;
  decode?(src: string | Blob): Promise<Pixels | null>;
  /** The draft changed: the page refreshes what it shows. */
  saved(): void;
}

export interface BodyArtPicker {
  readonly el: HTMLElement;
  show(target: BodyTarget, view: ContentBodyArtView): void;
  clear(): void;
  /** Frames set up but not yet saved to the draft. */
  pending(): boolean;
  /** What it shows, or null when hidden. */
  current(): BodyTarget | null;
}

/** A frame being set up: its stored file, its pixels and its anchor before the offset. */
interface BodyFrameWork {
  file: string;
  /** Null when the browser could not read it: kept as it is, unseen in the preview. */
  raw: Pixels | null;
  regX: number;
  regY: number;
}

interface BodyWorking {
  frames: Map<ArtFrameId, BodyFrameWork>;
  /** How far every frame is moved from its anchor, right and down. */
  offset: { x: number; y: number };
  mirrored: boolean;
  transparency: PictureTransparency;
}

/** The frames as saved: each anchor moved by the offset. */
export function savedFrames(
  frames: ReadonlyMap<ArtFrameId, { file: string; regX: number; regY: number }>,
  offset: { x: number; y: number },
): BodyFrameSet["frames"] {
  const out: BodyFrameSet["frames"] = {};
  for (const [id, f] of frames) {
    out[id] = { file: f.file, regX: f.regX - offset.x, regY: f.regY - offset.y };
  }
  return out;
}

const STEP_MS = 150;
const WALK: readonly BodyFrame[] = ["F1", "F2", "F3", "F2"];
const GAP = 8;

/** Whether the live atlas draws a body frame from an upload (an operator sheet). */
function liveIsUpload(a: Assets, name: string): boolean {
  const s = a.sprite("bodies", name);
  return s !== undefined && (a.index.atlases.bodies.sheets[s[0]] ?? "").startsWith("operator/");
}

export function createBodyArtPicker(opts: BodyArtOptions, idPrefix = "body-art"): BodyArtPicker {
  const a = opts.assets;
  const decode = opts.decode ?? loadPixels;
  const el = document.createElement("section");
  el.className = "item-art body-art";
  el.setAttribute("aria-label", "Body");
  el.hidden = true;
  const title = document.createElement("h4");
  title.className = "item-art-title";
  const state = document.createElement("p");
  state.className = "item-art-state";
  const source = document.createElement("p");
  source.className = "item-art-state";
  const status = document.createElement("p");
  status.className = "item-art-status";
  status.setAttribute("role", "status");

  let target: BodyTarget | null = null;
  let lastTarget: BodyTarget | null = null;
  let view: ContentBodyArtView | null = null;
  /** The body shown (null for a new one). */
  let body: number | null = null;
  let working: BodyWorking | null = null;
  let pristine = false;
  let loading = false;
  let generation = 0;
  let shown = new Map<ArtFrameId, { img: Pixels; regX: number; regY: number }>();
  let canvases = new Map<ArtFrameId, HTMLCanvasElement>();
  let reports = new Map<ArtFrameId, BodyFrameReport>();

  // ---- previews ----
  const previews = document.createElement("div");
  previews.className = "item-art-previews";
  const motion = document.createElement("canvas");
  motion.className = "item-art-preview body-art-motion";
  motion.setAttribute("role", "img");
  const scale = document.createElement("canvas");
  scale.className = "item-art-preview body-art-scale";
  scale.setAttribute("role", "img");
  scale.setAttribute(
    "aria-label",
    "Standing on its tile beside a player, for scale: drag it to move every frame",
  );
  scale.style.touchAction = "none";
  const grid = document.createElement("canvas");
  grid.className = "item-art-preview body-art-grid";
  grid.setAttribute("role", "img");
  grid.setAttribute(
    "aria-label",
    "Every frame: rows north, east, south and west, columns F1 to F4",
  );
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
    ["attack", "Attacking (players morphed into it)"],
  ] as const) {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = label;
    mode.append(o);
  }
  const motionFig = figure(
    motion,
    "Facing north, east, south and west; the box is the hit box. Monsters only walk: F4, the attack frame, shows when a player morphed into the body attacks.",
  );
  motionFig.prepend(mode);
  const scaleFig = figure(scale, "Beside a player (drag to move it)");
  previews.append(motionFig, scaleFig, figure(grid, "Every frame: red is missing or wrong"));

  // ---- controls ----
  const mirrored = action(document.createElement("input"), `${idPrefix}-mirrored`);
  mirrored.type = "checkbox";
  mirrored.checked = true;
  const mirroredLabel = document.createElement("label");
  mirroredLabel.className = "item-art-check";
  mirroredLabel.append(mirrored, " North frames are drawn 1.6-style (as seen from the front)");
  const mirroredNote = document.createElement("p");
  mirroredNote.className = "item-art-rules";
  mirroredNote.textContent = BODY_MIRRORED_NOTE;
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
  const offX = action(document.createElement("input"), `${idPrefix}-right`);
  offX.type = "number";
  offX.step = "1";
  offX.min = String(-OFFSET_MAX);
  offX.max = String(OFFSET_MAX);
  const offY = action(document.createElement("input"), `${idPrefix}-down`);
  offY.type = "number";
  offY.step = "1";
  offY.min = String(-OFFSET_MAX);
  offY.max = String(OFFSET_MAX);
  const controls = document.createElement("div");
  controls.className = "item-art-controls";
  controls.append(
    formField("Transparency", transparency),
    formField("Move right (px)", offX),
    formField("Move down (px)", offY),
    mirroredLabel,
    mirroredNote,
  );
  const notes = document.createElement("div");
  notes.className = "item-art-notes";

  const file = action(document.createElement("input"), `${idPrefix}-files`);
  file.type = "file";
  file.multiple = true;
  file.accept = ".png,image/png";
  file.setAttribute("aria-label", "Frame PNGs named like Orc-f1-e.png, or one sheet");
  file.addEventListener("change", () => {
    const list = [...(file.files ?? [])];
    file.value = "";
    if (list.length > 0) {
      void addFiles(list);
    }
  });
  const guide = guideLink(
    `${idPrefix}-guide`,
    () => (body === null ? "body" : `body-${body}`),
    () => (view ? bodyGuideSheet(a, view.head, mirrored.checked) : Promise.resolve("")),
  );

  const change = (): BodyFrameSet | null =>
    working
      ? {
          frames: savedFrames(working.frames, working.offset),
          mirrored: working.mirrored,
          transparency: working.transparency,
        }
      : null;
  const saveBtn = panelButton(
    `${idPrefix}-save`,
    "Save the frames to the draft",
    () => {
      const c = change();
      if (!c || !target) {
        return;
      }
      if (body === null) {
        void commit({ op: "new", ...c });
      } else if (
        target.kind === "monster" &&
        ownBody(view as ContentBodyArtView, target.monster) === null
      ) {
        // A shared body (or a pack's) gets a body of its own for this monster.
        void commit({ op: "new", monster: target.monster, ...c });
      } else if (target.kind === "monster") {
        // The monster's own body: the server refuses it if another has started drawing it since.
        void commit({ op: "set", body, owner: target.monster, ...c });
      } else {
        void commit({ op: "set", body, ...c });
      }
    },
    "primary",
  );
  const repaintBtn = panelButton(`${idPrefix}-repaint`, "Repaint the shared body", () => {
    const c = change();
    if (c && body !== null) {
      void commit({ op: "set", body, ...c });
    }
  });
  const cancelBtn = panelButton(`${idPrefix}-cancel`, "Cancel", () => {
    if (target && view) {
      show(target, view);
    }
  });
  const removeBtn = panelButton(
    `${idPrefix}-remove`,
    "Remove the upload",
    () => {
      if (body !== null) {
        void commit({ op: "remove", body });
      }
    },
    "danger",
  );

  // Choosing another body for a monster.
  const choose = action(document.createElement("select"), `${idPrefix}-choose`);
  choose.setAttribute("aria-label", "Another body for it");
  const chooseBtn = panelButton(`${idPrefix}-use`, "Use this body", () => {
    if (target?.kind === "monster" && choose.value) {
      void commit({ op: "choose", monster: target.monster, body: Number(choose.value) });
    }
  });
  const chooseThumb = document.createElement("canvas");
  chooseThumb.className = "item-art-preview body-art-thumb";
  chooseThumb.width = 64;
  chooseThumb.height = 64;
  chooseThumb.setAttribute("role", "img");
  chooseThumb.setAttribute("aria-label", "The chosen body standing, facing south");
  const chooseRow = document.createElement("div");
  chooseRow.className = "content-buttons";
  chooseRow.append(formField("Or give it another body", choose), chooseThumb, chooseBtn);
  choose.addEventListener("change", () => void drawThumb());

  const uploadRow = document.createElement("div");
  uploadRow.className = "content-buttons";
  uploadRow.append(file, guide);
  const buttons = document.createElement("div");
  buttons.className = "content-buttons";
  buttons.append(saveBtn, repaintBtn, cancelBtn, removeBtn);
  const repaintNote = document.createElement("p");
  repaintNote.className = "item-art-rules body-art-repaints";
  repaintNote.hidden = true;
  const rulesText = document.createElement("p");
  rulesText.className = "item-art-rules";
  rulesText.textContent = BODY_RULES;
  const editor = document.createElement("div");
  editor.className = "item-art-editor";
  editor.append(previews, controls);
  el.append(
    title,
    state,
    source,
    editor,
    notes,
    repaintNote,
    buttons,
    status,
    uploadRow,
    chooseRow,
    rulesText,
  );

  let busy = false;
  async function commit(c: BodyChange): Promise<void> {
    if (busy) {
      return;
    }
    busy = true;
    updateButtons();
    status.textContent = "Saving…";
    // The panel may show something else by the time the answer comes: then it changes nothing
    // of what is shown now (only the page refreshes).
    const sent = generation;
    try {
      const r = await opts.apply(c);
      if (sent !== generation) {
        if (r.ok) {
          opts.saved();
        }
        return;
      }
      status.textContent = r.text;
      if (r.ok) {
        pristine = true;
        // A new body opened on its own is shown under its number from now on.
        if (c.op === "new" && target?.kind === "new" && r.body !== undefined) {
          target = { kind: "body", body: r.body };
          lastTarget = target;
        }
        opts.saved();
      }
    } finally {
      busy = false;
      updateButtons();
    }
  }

  /** The working frames as the game will draw them, each anchor moved by the offset. */
  const shownOf = (w: BodyWorking) =>
    shownBodyFrames(
      new Map(
        [...w.frames].map(([id, f]) => [
          id,
          { raw: f.raw, regX: f.regX - w.offset.x, regY: f.regY - w.offset.y },
        ]),
      ),
      w.mirrored,
      w.transparency,
    );

  function sync(): void {
    reports = new Map();
    canvases = new Map();
    const lines: { text: string; error: boolean }[] = [];
    if (working) {
      mirrored.checked = working.mirrored;
      transparency.value = working.transparency;
      offX.value = String(working.offset.x);
      offY.value = String(working.offset.y);
      shown = shownOf(working);
      for (const id of BODY_FRAMES) {
        const f = working.frames.get(id);
        if (!f) {
          lines.push({ text: `${id} is missing: a body needs all 16 frames`, error: true });
          continue;
        }
        if (!f.raw) {
          lines.push({ text: `${id} could not be read for the preview; it is kept`, error: false });
          continue;
        }
        const r = bodyFrameReport(keyed(f.raw, working.transparency), id);
        reports.set(id, r);
        for (const e of r.errors) {
          lines.push({ text: e, error: true });
        }
        for (const w of r.warnings) {
          lines.push({ text: w, error: false });
        }
      }
      for (const [id, s] of shown) {
        canvases.set(id, pixelCanvas(s.img));
      }
      if (!anchorsInRange(savedFrames(working.frames, working.offset))) {
        lines.push({
          text: "Moved this far, a frame's anchor is past 2048 px: move it back nearer its tile.",
          error: true,
        });
      }
    } else {
      shown = new Map();
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
    drawAll();
  }

  /** Whether the working set can be saved: all 16 frames and nothing wrong with any. */
  const complete = () =>
    working !== null &&
    BODY_FRAMES.every((id) => working?.frames.has(id)) &&
    ![...reports.values()].some((r) => r.errors.length > 0) &&
    anchorsInRange(savedFrames(working.frames, working.offset));

  function updateButtons(): void {
    const pending = working !== null && !pristine;
    const t = target;
    const shared =
      t?.kind === "monster" && view !== null && body !== null && ownBody(view, t.monster) === null;
    saveBtn.hidden = !pending;
    saveBtn.disabled = busy || !complete();
    saveBtn.textContent =
      body === null
        ? "Save as a new body"
        : shared && t?.kind === "monster"
          ? `Save as a new body for ${t.monster}`
          : `Save to body ${body}`;
    repaintBtn.hidden = !pending || !shared;
    repaintBtn.disabled = busy || !complete();
    repaintBtn.textContent = `Repaint body ${body} for all who draw it`;
    // Before any save that repaints a body others draw, every one of them is named.
    const repaints =
      pending && body !== null && view !== null && (shared || t?.kind === "body")
        ? repaintText(view, body)
        : "";
    repaintNote.textContent = repaints;
    repaintNote.hidden = repaints === "";
    cancelBtn.hidden = !pending;
    removeBtn.hidden = pending || body === null || !(view && bodyUpload(view, body));
    removeBtn.disabled = busy;
    chooseRow.hidden = t?.kind !== "monster" || pending;
    chooseBtn.disabled = busy;
    file.disabled = loading || busy;
  }

  const setOffset = (x: number, y: number) => {
    if (working && Number.isFinite(x) && Number.isFinite(y)) {
      working.offset = { x: clampOffset(x), y: clampOffset(y) };
      pristine = false;
      sync();
    }
  };
  offX.addEventListener("change", () => setOffset(Number(offX.value), working?.offset.y ?? 0));
  offY.addEventListener("change", () => setOffset(working?.offset.x ?? 0, Number(offY.value)));
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

  // Dragging the scale preview moves every frame.
  let drag: { x: number; y: number; ox: number; oy: number; id: number } | null = null;
  scale.addEventListener("pointerdown", (e) => {
    if (!working) {
      return;
    }
    drag = {
      x: e.clientX,
      y: e.clientY,
      ox: working.offset.x,
      oy: working.offset.y,
      id: e.pointerId,
    };
    scale.setPointerCapture?.(e.pointerId);
  });
  scale.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id || !working) {
      return;
    }
    const k = scale.getBoundingClientRect().width / scale.width || 1;
    working.offset = {
      x: clampOffset(drag.ox + (e.clientX - drag.x) / k),
      y: clampOffset(drag.oy + (e.clientY - drag.y) / k),
    };
    pristine = false;
    offX.value = String(working.offset.x);
    offY.value = String(working.offset.y);
    shown = shownOf(working);
    updateButtons();
    drawAll();
  });
  const endDrag = (e: PointerEvent) => {
    if (drag && e.pointerId === drag.id) {
      drag = null;
      sync();
    }
  };
  scale.addEventListener("pointerup", endDrag);
  scale.addEventListener("pointercancel", endDrag);

  /** The live atlas still draws an upload the draft takes out: the pack's comes back on publish. */
  const comingBack = () =>
    !working &&
    view !== null &&
    body !== null &&
    !bodyUpload(view, body) &&
    BODY_FRAMES.some((f) => liveIsUpload(a, `${body}-${f}`));

  /** What one frame draws, for the extents: the working frame, else the live atlas's. */
  function frameBox(id: ArtFrameId): { w: number; h: number; regX: number; regY: number } | null {
    const s = shown.get(id);
    if (s) {
      return { w: s.img.width, h: s.img.height, regX: s.regX, regY: s.regY };
    }
    if (working || body === null || comingBack()) {
      return null;
    }
    const sp = a.sprite("bodies", `${body}-${id}`);
    return sp ? { w: sp[3], h: sp[4], regX: sp[5], regY: sp[6] } : null;
  }

  /** Draws a frame with its anchor at (x, y), and its hit box. */
  function drawFrame(
    ctx: CanvasRenderingContext2D,
    id: ArtFrameId,
    x: number,
    y: number,
    box: boolean,
  ): void {
    const s = shown.get(id);
    if (s) {
      const c = canvases.get(id);
      if (c) {
        ctx.drawImage(c, x - s.regX, y - s.regY);
      }
      const b = box ? visibleBounds(s.img) : null;
      if (b) {
        ctx.strokeStyle = "rgba(255, 255, 0, 0.8)";
        ctx.strokeRect(x - s.regX + b.x + 0.5, y - s.regY + b.y + 0.5, b.w - 1, b.h - 1);
      }
      return;
    }
    if (!working && body !== null && !comingBack()) {
      drawSprite(ctx, a, "bodies", `${body}-${id}`, x, y);
      const sp = box ? a.sprite("bodies", `${body}-${id}`) : undefined;
      if (sp) {
        ctx.strokeStyle = "rgba(255, 255, 0, 0.8)";
        ctx.strokeRect(x - sp[5] + 0.5, y - sp[6] + 0.5, sp[3] - 1, sp[4] - 1);
      }
    }
  }

  /** A tile under the walker's point at (x, y). */
  function drawTile(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    ctx.fillStyle = "#3f7a34";
    ctx.fillRect(x - 16, y + 2, 32, 32);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.3)";
    ctx.strokeRect(x - 16 + 0.5, y + 2 + 0.5, 31, 31);
  }

  let ext = { left: -16, top: 2, right: 16, bottom: 34 };
  /** Bumped by every draw and by clear: a draw still waiting for its atlases is dropped. */
  let drawSeq = 0;
  function drawAll(): void {
    const boxes = BODY_FRAMES.flatMap((id) => {
      const b = frameBox(id);
      return b ? [b] : [];
    });
    ext = extentOf(boxes);
    const w = ext.right - ext.left;
    const h = ext.bottom - ext.top;
    motion.width = WORN_FACINGS.length * w + (WORN_FACINGS.length - 1) * GAP;
    motion.height = h;
    // Two tiles: the player's and the body's (wide enough for either).
    scale.width = Math.max(32, -ext.left) + 32 + Math.max(w, 46);
    // Tall enough for the player (anchored 6 px into its 46×45 frame) and the body, however far
    // the body is dragged up or down.
    scale.height = scaleHeight(ext);
    const cellW = Math.max(...boxes.map((b) => b.w), 1);
    const cellH = Math.max(...boxes.map((b) => b.h), 1);
    grid.width = WORN_STEPS.length * cellW;
    grid.height = WORN_FACINGS.length * cellH;
    // A later draw (or a clear) supersedes this one: its canvases may have other sizes by then.
    const mine = ++drawSeq;
    void a
      .loadGroup("bodies")
      .catch(() => {})
      .then(() => a.loadGroup("paperdoll").catch(() => {}))
      .then(() => {
        if (mine !== drawSeq) {
          return;
        }
        drawMotion();
        drawScale();
        drawGrid(cellW, cellH);
      });
  }

  let step = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  function drawMotion(): void {
    const ctx = motion.getContext("2d");
    if (!ctx) {
      return;
    }
    ctx.clearRect(0, 0, motion.width, motion.height);
    const w = ext.right - ext.left;
    WORN_FACINGS.forEach((facing, i) => {
      const frame: BodyFrame =
        mode.value === "attack" ? "F4" : (WALK[step % WALK.length] as BodyFrame);
      const x = i * (w + GAP) - ext.left;
      const y = -ext.top;
      drawTile(ctx, x, y);
      drawFrame(ctx, `${frame}-${facing}`.toLowerCase() as ArtFrameId, x, y, true);
    });
  }

  function drawScale(): void {
    const ctx = scale.getContext("2d");
    if (!ctx || !view) {
      return;
    }
    ctx.clearRect(0, 0, scale.width, scale.height);
    const y = Math.max(-ext.top, PAPERDOLL_REG.y);
    const px = 25;
    const bx = px + 32 + Math.max(0, -ext.left - 16);
    drawTile(ctx, px, y);
    drawTile(ctx, bx, y);
    for (const l of bareLayers(view.head, "F2", "S")) {
      drawSprite(ctx, a, "paperdoll", l, px - PAPERDOLL_REG.x, y - PAPERDOLL_REG.y, true);
    }
    drawFrame(ctx, "f2-s", bx, y, false);
    // The anchor: the walker's point.
    ctx.fillStyle = "#ff40ff";
    ctx.fillRect(bx - 1, y - 1, 3, 3);
  }

  function drawGrid(cellW: number, cellH: number): void {
    const ctx = grid.getContext("2d");
    if (!ctx) {
      return;
    }
    ctx.clearRect(0, 0, grid.width, grid.height);
    ctx.fillStyle = "#26301f";
    ctx.fillRect(0, 0, grid.width, grid.height);
    for (const id of BODY_FRAMES) {
      const { x, y } = sheetCell(id, { w: cellW, h: cellH });
      const s = shown.get(id);
      const c = canvases.get(id);
      if (s && c) {
        ctx.drawImage(c, x + Math.floor((cellW - s.img.width) / 2), y + (cellH - s.img.height));
      } else if (!working && body !== null && !comingBack()) {
        const sp = a.sprite("bodies", `${body}-${id}`);
        if (sp) {
          drawSprite(
            ctx,
            a,
            "bodies",
            `${body}-${id}`,
            x + Math.floor((cellW - sp[3]) / 2),
            y + cellH - sp[4],
            true,
          );
        }
      }
      const bad =
        (reports.get(id)?.errors.length ?? 0) > 0 || (working !== null && !working.frames.has(id));
      if (bad) {
        ctx.strokeStyle = "#ff4040";
        ctx.strokeRect(x + 0.5, y + 0.5, cellW - 1, cellH - 1);
      }
    }
  }

  /** Bumped by every thumbnail drawn: an older one still loading draws nothing. */
  let thumbSeq = 0;
  async function drawThumb(): Promise<void> {
    const ctx = chooseThumb.getContext("2d");
    if (!ctx) {
      return;
    }
    const mine = ++thumbSeq;
    ctx.clearRect(0, 0, chooseThumb.width, chooseThumb.height);
    const n = Number(choose.value);
    if (!view || !n) {
      return;
    }
    const up = bodyUpload(view, n);
    const f = up?.frames["f2-s"];
    if (f) {
      const raw = await decode(uploadUrl({ file: f.file, ext: "png" }));
      if (raw && mine === thumbSeq) {
        const k = keyed(raw, up.transparency ?? "alpha");
        ctx.drawImage(pixelCanvas(k), 32 - f.regX, 40 - f.regY);
      }
      return;
    }
    await a.loadGroup("bodies").catch(() => {});
    // A pack body whose upload the draft takes out: the live atlas still draws the upload, which
    // is not what it will be, so nothing is shown until the publish.
    if (mine === thumbSeq && view && !comingBackFor(view, n)) {
      drawSprite(ctx, a, "bodies", `${n}-f2-s`, 32, 40);
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

  function base(): BodyWorking {
    if (working) {
      return { ...working, frames: new Map(working.frames) };
    }
    return { frames: new Map(), offset: { x: 0, y: 0 }, mirrored: true, transparency: "alpha" };
  }

  async function addFiles(list: File[]): Promise<void> {
    const mine = ++generation;
    if (!view) {
      return;
    }
    const files = bodyFiles(list.map((f) => f.name));
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
      const cell = bodySheetCell(raw.width, raw.height);
      if ("error" in cell) {
        status.textContent = `${f.name}: ${cell.error}. Frames on their own are named like Orc-f1-e.png.`;
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
      const anchor = defaultBodyAnchor(cell.w, cell.h);
      const frames = new Map<ArtFrameId, BodyFrameWork>();
      for (const id of BODY_FRAMES) {
        const hash = cut.frames[id];
        if (hash) {
          frames.set(id, { file: hash, raw: cutCell(raw, id, cell), ...anchor });
        }
      }
      // A sheet is the whole set, laid out afresh.
      working = {
        frames,
        offset: { x: 0, y: 0 },
        mirrored: b.mirrored,
        transparency: guessTransparency(raw),
      };
      pristine = false;
      status.textContent = `${f.name} is cut into 16 frames of ${cell.w}×${cell.h}: check the preview, then save them to the draft.`;
      sync();
      startTimer();
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
      // A new frame keeps the shift the frame it replaces had from its own default anchor (a
      // reopened upload's frames carry their saved anchors); a frame new to the set stands at
      // its size's default. The panel's offset moves it with the rest either way.
      b.frames.set(frame, {
        file: stored.stored.file,
        raw,
        ...carriedAnchor(b.frames.get(frame), raw.width, raw.height),
      });
    }
    if (!working && first) {
      b.transparency = guessTransparency(first);
    }
    working = b;
    pristine = false;
    const left = BODY_FRAMES.length - b.frames.size;
    status.textContent = `${files.frames.length} frame${files.frames.length === 1 ? "" : "s"} uploaded${left > 0 ? `; ${left} still to come` : ""}: check the preview, then save them to the draft.`;
    sync();
    startTimer();
  }

  function fillChoose(v: ContentBodyArtView, current: number | null): void {
    choose.replaceChildren(
      ...availableBodies(v).map((n) => {
        const o = document.createElement("option");
        o.value = String(n);
        const use = bodyUse(v, n);
        o.textContent = `${n}${bodyUpload(v, n) ? " (yours)" : ""}${use ? ` · ${bodyUsersText(use)}` : ""}`;
        return o;
      }),
    );
    if (current !== null) {
      choose.value = String(current);
    }
  }

  function show(t: BodyTarget, v: ContentBodyArtView): void {
    const mine = ++generation;
    const sameTarget = lastTarget !== null && JSON.stringify(lastTarget) === JSON.stringify(t);
    if (!sameTarget) {
      status.textContent = "";
    }
    target = t;
    lastTarget = t;
    loading = false;
    view = v;
    working = null;
    pristine = false;
    if (t.kind === "monster") {
      const m = v.monsters.find((x) => same(x.name, t.monster));
      if (!m) {
        clear();
        return;
      }
      body = m.body;
      title.textContent = "Body";
      state.textContent = monsterBodyText(v, m.name);
      fillChoose(v, m.body);
      void drawThumb();
    } else if (t.kind === "body") {
      body = t.body;
      title.textContent = `Body ${t.body}`;
      state.textContent = `Drawn by ${bodyUsersText(bodyUse(v, t.body))}.`;
    } else {
      body = null;
      title.textContent = "New body";
      state.textContent =
        v.next === null
          ? "Every body number is taken."
          : `It takes the next free number (${v.next} now) when it is saved. Give it to a monster afterwards from the monster's row.`;
    }
    el.hidden = false;
    motion.setAttribute(
      "aria-label",
      `${body === null ? "The new body" : `Body ${body}`} walking or attacking, facing north, east, south and west`,
    );
    if (body === null) {
      source.textContent = "Upload its frames or a sheet.";
      sync();
      stopTimer();
      return;
    }
    const n = body;
    const src = bodySource(v, n);
    if (src.kind === "upload") {
      source.textContent =
        "It draws your upload. Choose frames to replace some, or a sheet to replace them all.";
      loading = true;
      sync();
      const entries = BODY_FRAMES.flatMap((id) => {
        const fr = src.art.frames[id];
        return fr ? [[id, fr] as const] : [];
      });
      void Promise.all(
        entries.map(([, f]) => decode(uploadUrl({ file: f.file, ext: "png" }))),
      ).then((raws) => {
        if (mine !== generation) {
          return;
        }
        loading = false;
        const frames = new Map<ArtFrameId, BodyFrameWork>();
        entries.forEach(([id, f], i) => {
          frames.set(id, { file: f.file, raw: raws[i] ?? null, regX: f.regX, regY: f.regY });
        });
        working = {
          frames,
          offset: { x: 0, y: 0 },
          mirrored: src.art.mirrored === true,
          transparency: src.art.transparency ?? "alpha",
        };
        pristine = true;
        sync();
      });
    } else if (src.kind === "pack") {
      source.textContent = comingBackFor(v, n)
        ? "It will draw the pack's body once the draft is published (the draft takes out the upload that replaced it; the preview cannot show the pack's until then)."
        : "It draws the pack's body. Upload frames or a sheet to replace it.";
      sync();
    } else {
      source.textContent = "It has no picture yet: upload its frames or a sheet.";
      sync();
    }
    startTimer();
  }

  const comingBackFor = (v: ContentBodyArtView, n: number) =>
    !bodyUpload(v, n) && BODY_FRAMES.some((f) => liveIsUpload(a, `${n}-${f}`));

  function clear(): void {
    generation += 1;
    thumbSeq += 1;
    drawSeq += 1;
    loading = false;
    target = null;
    view = null;
    body = null;
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

// ---- the Bodies section -----------------------------------------------------------------------

export type BodiesOptions = BodyArtOptions;

export interface Bodies {
  pending(): boolean;
  /** Drops frames set up in the section's panel. */
  discard(): void;
  readonly el: HTMLElement;
  setView(view: ContentBodyArtView): void;
  reset(): void;
}

/** One body's files in a bulk upload. */
interface BodyBulkLine {
  group: WornGroup;
  files: File[];
  /** What it attaches to: typed or matched (a body number, or a monster's key or name). */
  name: string;
  match: BodyMatch;
  replace: boolean;
  raws: Map<string, Pixels | null> | null;
  done: string;
}

/**
 * What is wrong with a bulk line's frames: a sheet that cannot be cut, a frame missing, too large
 * or showing nothing. "" when nothing is.
 */
export function bulkBodyErrors(
  names: readonly string[],
  raws: ReadonlyMap<string, Pixels | null>,
  transparency: PictureTransparency,
): string {
  const sorted = bodyFiles(names);
  if (sorted.kind === "bad") {
    return sorted.error;
  }
  const errors: string[] = [];
  if (sorted.kind === "sheet") {
    const raw = raws.get(sorted.file);
    if (!raw) {
      return `The browser could not read ${sorted.file}.`;
    }
    const cell = bodySheetCell(raw.width, raw.height);
    if ("error" in cell) {
      return `${sorted.file}: ${cell.error}.`;
    }
    for (const id of BODY_FRAMES) {
      errors.push(...bodyFrameReport(keyed(cutCell(raw, id, cell), transparency), id).errors);
    }
    return errors.join("; ");
  }
  const have = new Set(sorted.frames.map((f) => f.frame));
  const missing = BODY_FRAMES.filter((f) => !have.has(f));
  if (missing.length > 0) {
    return `A body needs all 16 frames; missing ${missing.join(", ")}.`;
  }
  for (const { file, frame } of sorted.frames) {
    const raw = raws.get(file);
    if (!raw) {
      return `The browser could not read ${file}.`;
    }
    errors.push(...bodyFrameReport(keyed(raw, transparency), frame).errors);
  }
  return errors.join("; ");
}

/** The transparency a bulk line is saved with: the sheet's or first frame's guess. */
export function bulkBodyTransparency(
  names: readonly string[],
  raws: ReadonlyMap<string, Pixels | null>,
): PictureTransparency {
  const sorted = bodyFiles(names);
  const first =
    sorted.kind === "sheet"
      ? raws.get(sorted.file)
      : sorted.kind === "frames"
        ? raws.get(sorted.frames[0]?.file ?? "")
        : null;
  return first ? guessTransparency(first) : "alpha";
}

/** Where a bulk line writes: a body by number, or a new body for a monster ("" for none). */
export function bulkDestination(match: BodyMatch, replace: boolean): string {
  if (match.kind === "body") {
    return `body:${match.body}`;
  }
  if (match.kind === "monster") {
    return match.replaces !== null && replace
      ? `body:${match.replaces}`
      : `monster:${match.monster.toLowerCase()}`;
  }
  return "";
}

/** The change a bulk line makes once its files are stored. */
export function bulkBodyChange(
  match: BodyMatch,
  replace: boolean,
  set: BodyFrameSet,
): BodyChange | null {
  if (match.kind === "body") {
    return { op: "set", body: match.body, ...set };
  }
  if (match.kind === "monster") {
    return match.replaces !== null && replace
      ? { op: "set", body: match.replaces, owner: match.monster, ...set }
      : { op: "new", monster: match.monster, ...set };
  }
  return null;
}

export function createBodies(opts: BodiesOptions): Bodies {
  const decode = opts.decode ?? loadPixels;
  const el = document.createElement("div");
  el.className = "item-pictures bodies";
  let view: ContentBodyArtView | null = null;
  let lines: BodyBulkLine[] = [];
  const status = document.createElement("p");
  status.className = "item-art-status";
  status.setAttribute("role", "status");
  const rules = document.createElement("p");
  rules.className = "item-art-rules";
  rules.textContent = `${BODY_RULES} For many bodies at once, name each sheet (Orc.png) or set of frames (Orc-f1-e.png) after its monster's key or the name players see, or after a body's number to repaint that body. A monster's files make it a new body, unless it already has an upload of its own, which they replace.`;

  const mirrored = action(document.createElement("input"), "bodies-mirrored");
  mirrored.type = "checkbox";
  mirrored.checked = true;
  const mirroredLabel = document.createElement("label");
  mirroredLabel.className = "item-art-check";
  mirroredLabel.append(mirrored, " North frames are drawn 1.6-style (as seen from the front)");
  const mirroredNote = document.createElement("p");
  mirroredNote.className = "item-art-rules";
  mirroredNote.textContent = BODY_MIRRORED_NOTE;

  const files = action(document.createElement("input"), "bodies-files");
  files.type = "file";
  files.multiple = true;
  files.accept = ".png,image/png";
  files.setAttribute("aria-label", "Body sheets and frames named after their monsters or numbers");
  files.addEventListener("change", () => {
    const list = [...(files.files ?? [])];
    files.value = "";
    addFiles(list);
  });
  const guide = guideLink(
    "bodies-guide",
    () => "body",
    () => (view ? bodyGuideSheet(opts.assets, view.head, mirrored.checked) : Promise.resolve("")),
  );
  const nameListId = "bodies-names";
  const nameList = document.createElement("datalist");
  nameList.id = nameListId;

  const lineCheck = (l: BodyBulkLine): string => {
    if (!view) {
      return "";
    }
    const sorted = bodyFiles(l.files.map((f) => f.name));
    if (sorted.kind === "bad") {
      return sorted.error;
    }
    if (l.raws === null) {
      return "Reading…";
    }
    const names = l.files.map((f) => f.name);
    const frames = bulkBodyErrors(names, l.raws, bulkBodyTransparency(names, l.raws));
    if (frames) {
      return frames;
    }
    if (l.match.kind === "none") {
      return l.match.why;
    }
    // Lines clash by where they write: `Orc.png` replacing Orc's own body 1000 and `1000.png`.
    const key = bulkDestination(l.match, l.replace);
    if (lines.some((o) => o !== l && !o.done && bulkDestination(o.match, o.replace) === key)) {
      return "Another line is for the same body or monster: change one, or clear the list.";
    }
    return "";
  };

  const table = createTable<BodyBulkLine>({
    label: "Bodies to attach",
    empty: "No files chosen.",
    key: (l) => `${l.group.stem}:${lines.indexOf(l)}`,
    columns: [
      { label: "Files", cell: (l) => l.group.files.join(", ") },
      {
        label: "For",
        cell: (l) => {
          const input = action(document.createElement("input"), "bodies-for");
          input.type = "text";
          input.setAttribute("list", nameListId);
          input.setAttribute("aria-label", `The monster or body ${l.group.stem} is for`);
          input.value = l.name;
          input.disabled = attaching || l.done !== "";
          input.placeholder = "Not matched: a monster or a body number";
          input.addEventListener("change", () => {
            l.name = input.value.trim();
            l.match = view ? matchBody(l.name, view) : { kind: "none", why: "" };
            l.replace = true;
            redraw();
          });
          return input;
        },
      },
      {
        label: "Makes",
        cell: (l) => {
          if (l.done) {
            return "";
          }
          if (l.match.kind === "body") {
            return view ? repaintText(view, l.match.body) : `Repaints body ${l.match.body}.`;
          }
          if (l.match.kind !== "monster") {
            return "";
          }
          if (l.match.replaces === null) {
            return `A new body for ${l.match.monster}`;
          }
          const box = action(document.createElement("input"), "bodies-replace");
          box.type = "checkbox";
          box.checked = l.replace;
          box.disabled = attaching;
          box.setAttribute("aria-label", `Replace body ${l.match.replaces}`);
          box.addEventListener("change", () => {
            l.replace = box.checked;
            // Where it writes changed: the clash check runs again.
            redraw();
          });
          const label = document.createElement("label");
          label.className = "item-art-check";
          label.append(box, ` replaces body ${l.match.replaces} (else a new body)`);
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
    const added = groupWornFiles(list.map((f) => f.name)).map((group): BodyBulkLine => {
      const match = matchBody(group.stem, v);
      return {
        group,
        files: group.files.map((n) => list.find((f) => f.name === n) as File),
        name: match.kind === "none" ? "" : group.stem,
        match,
        replace: true,
        raws: null,
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
    const unmatched = added.filter((l) => l.match.kind === "none");
    status.textContent =
      unmatched.length > 0
        ? `${unmatched.map((l) => (l.match as { why: string }).why).join(" ")} Pick ${unmatched.length === 1 ? "its monster or body" : "theirs"} by hand.`
        : "Every file matches a monster or a body.";
    redraw();
  }

  const attach = panelButton(
    "bodies-attach",
    "Attach the bodies",
    () => void attachAll(),
    "primary",
  );
  let attaching = false;
  let batch = 0;
  async function attachAll(): Promise<void> {
    if (!view || attaching) {
      return;
    }
    attaching = true;
    const mine = batch;
    redraw();
    let saved = 0;
    // What each line writes, and how, is fixed when Attach is pressed: a draft that changes while
    // the files upload (and re-matches the lines) changes nothing for this batch.
    const flip = mirrored.checked;
    const jobs = lines
      .filter((x) => !x.done && lineCheck(x) === "")
      .map((l) => ({ l, match: l.match, replace: l.replace }));
    try {
      for (const { l, match, replace } of jobs) {
        if (mine !== batch) {
          return;
        }
        const r = await attachOne(l, match, replace, flip, mine);
        if (mine !== batch) {
          return;
        }
        l.done = r.ok ? r.text : `Not saved: ${r.text}`;
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
        : `${saved} bod${saved === 1 ? "y is" : "ies are"} in the draft.`;
    if (saved > 0) {
      opts.saved();
    }
  }

  async function attachOne(
    l: BodyBulkLine,
    match: BodyMatch,
    replace: boolean,
    flip: boolean,
    mine: number,
  ): Promise<{ ok: boolean; text: string }> {
    const names = l.files.map((f) => f.name);
    const sorted = bodyFiles(names);
    const raws = l.raws;
    if (sorted.kind === "bad" || raws === null) {
      return { ok: false, text: sorted.kind === "bad" ? sorted.error : "Still reading the files." };
    }
    const transparency = bulkBodyTransparency(names, raws);
    const wrong = bulkBodyErrors(names, raws, transparency);
    if (wrong) {
      return { ok: false, text: wrong };
    }
    const frames = new Map<ArtFrameId, { file: string; regX: number; regY: number }>();
    if (sorted.kind === "sheet") {
      const up = await opts.upload(l.files[0] as File);
      if (!up.ok) {
        return { ok: false, text: up.error };
      }
      const cut = await opts.slice(up.stored.file);
      if (!cut.ok) {
        return { ok: false, text: cut.error };
      }
      const anchor = defaultBodyAnchor(cut.cell.w, cut.cell.h);
      for (const [id, f] of Object.entries(cut.frames)) {
        frames.set(id as ArtFrameId, { file: f, ...anchor });
      }
    } else {
      for (const { file: name, frame } of sorted.frames) {
        const raw = raws.get(name) as Pixels;
        const up = await opts.upload(l.files.find((x) => x.name === name) as File);
        if (!up.ok) {
          return { ok: false, text: `${name}: ${up.error}` };
        }
        frames.set(frame, { file: up.stored.file, ...defaultBodyAnchor(raw.width, raw.height) });
      }
    }
    const change = bulkBodyChange(match, replace, {
      frames: savedFrames(frames, { x: 0, y: 0 }),
      mirrored: flip,
      transparency,
    });
    // The list may have been cleared (or the page reset) while the files uploaded.
    if (mine !== batch) {
      return { ok: false, text: "The list was cleared." };
    }
    return change ? opts.apply(change) : { ok: false, text: "Pick a monster or a body." };
  }

  const clear = panelButton("bodies-clear", "Clear the list", () => {
    batch += 1;
    lines = [];
    status.textContent = "";
    redraw();
  });

  const picker = createBodyArtPicker(opts, "body");
  const newBtn = panelButton("bodies-new", "New body", () => {
    if (view) {
      picker.show({ kind: "new" }, view);
      picker.el.scrollIntoView?.({ block: "nearest" });
    }
  });
  const bodiesTitle = document.createElement("h4");
  bodiesTitle.className = "item-art-title";
  const bodies = createTable<BodyUse>({
    label: "Bodies",
    empty: "The content draws no bodies.",
    key: (u) => String(u.body),
    open: {
      id: "bodies-open",
      run: (u) => {
        if (view) {
          picker.show({ kind: "body", body: u.body }, view);
          picker.el.scrollIntoView?.({ block: "nearest" });
        }
      },
    },
    columns: [
      { label: "Body", cell: (u) => String(u.body) },
      { label: "Drawn by", cell: (u) => bodyUsersText(u) },
      {
        label: "Frames",
        cell: (u) => {
          if (!view) {
            return "";
          }
          const src = bodySource(view, u.body);
          return src.kind === "upload"
            ? "Your upload"
            : src.kind === "pack"
              ? "The pack's"
              : "None";
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
    const all = view ? bodyList(view) : [];
    const none = all.filter((u) => view && bodySource(view, u.body).kind === "none").length;
    bodiesTitle.textContent = `Bodies (${all.length}${none > 0 ? `, ${none} with no frames` : ""})`;
    bodies.setRows(all);
  }

  const row = document.createElement("div");
  row.className = "content-buttons";
  row.append(files, guide, attach, clear);
  const newRow = document.createElement("div");
  newRow.className = "content-buttons";
  newRow.append(newBtn);
  el.append(
    rules,
    mirroredLabel,
    mirroredNote,
    row,
    nameList,
    table.el,
    status,
    bodiesTitle,
    newRow,
    bodies.el,
    picker.el,
  );
  redraw();

  return {
    el,
    pending: () => picker.pending(),
    discard: () => picker.clear(),
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
      nameList.replaceChildren(
        ...[...v.monsters.map((m) => m.name), ...bodyList(v).map((b) => String(b.body))].map(
          (n) => {
            const o = document.createElement("option");
            o.value = n;
            return o;
          },
        ),
      );
      // Lines still waiting match against the draft as it is now.
      for (const l of lines) {
        if (!l.done && l.name) {
          l.match = matchBody(l.name, v);
        }
      }
      const open = picker.current();
      if (open && !picker.pending() && open.kind !== "new") {
        picker.show(open, v);
      }
      redraw();
    },
  };
}
