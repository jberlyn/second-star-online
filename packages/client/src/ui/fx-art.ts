/**
 * Spell effects on the Content page (issue #29, stage 5): a panel that uploads an effect run's
 * frames (and its trail), as separate `<run>-1.png` files or one strip, with no JSON to write. It
 * plays the run at the game's speed beside a player (flying along its axis when it is a
 * projectile), draws each frame's hit box, lets the anchor be dragged, shows every frame and what
 * is wrong with it, and offers a guide strip to draw on. A "Spell effects" section lists every
 * run the content and the engine draw, makes new ones and takes many files at once.
 *
 * A run is named by its member. From a spell's row, saving can make the spell play every uploaded
 * frame (its row's `lastFrame` and `frames`) in the same change. What the panel writes goes
 * through the `contentFx` intent; publishing the draft makes it live. The panel is a component of
 * its own, for the spell editor to come.
 */
import type { ArtFx } from "@secondstaronline/data";
import {
  artRowFingerprint,
  type ContentFxArtView,
  defaultFxAnchor,
  FX_RUN_MAX,
  FX_TILE_CENTRE,
  type FxChange,
  type FxFrameFile,
  type FxFrameReport,
  type FxRunUse,
  type FxSheetLayout,
  fxCell,
  fxFrameFileName,
  fxFrameReport,
  fxSheetCell,
  fxUsersText,
  guessFxSheet,
  guessTransparency,
  PAPERDOLL_REG,
  type PictureTransparency,
  type Pixels,
  paperdollLayersWith,
  STEPFRAMES_PER_FRAME,
  spriteCentre,
  stripFrames,
  TICK_HZ,
  visibleBounds,
} from "@secondstaronline/shared";

import { type Assets, drawSprite } from "../assets.ts";
import { action } from "./action.ts";
import { type StoredUpload, uploadUrl } from "./art-uploads.ts";
import { clampOffset, OFFSET_MAX } from "./body-art.ts";
import { createTable, formField, panelButton } from "./control-panel-kit.ts";
import { keyed, loadPixels } from "./item-art.ts";
import { guideLink, pixelCanvas } from "./worn-art.ts";

// ---- what the panel reads (pure) --------------------------------------------------------------

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** What a panel shows: a spell's run, a run by name, or a new run. */
export type FxTarget =
  | { kind: "spell"; spell: string; run?: string }
  | { kind: "run"; run: string }
  | { kind: "new" };

/** The draft's upload for a run, if any. */
export const fxUpload = (view: ContentFxArtView, run: string): ArtFx | undefined =>
  view.art.find((a) => same(a.name, run));

/** Who draws a run, and how many frames of it show. */
export const fxUse = (view: ContentFxArtView, run: string): FxRunUse | undefined =>
  view.runs.find((r) => same(r.member, run));

/** Where a run's frames will come from once the draft is published. */
export type FxSource =
  | { kind: "upload"; art: ArtFx }
  | { kind: "pack"; frames: number; trail: number }
  | { kind: "none" };

export function fxSource(view: ContentFxArtView, run: string): FxSource {
  const art = fxUpload(view, run);
  if (art) {
    return { kind: "upload", art };
  }
  const p = view.packRuns[run.toLowerCase()];
  return p ? { kind: "pack", ...p } : { kind: "none" };
}

/** One run worth listing: what draws it, or an upload nothing draws. */
export interface FxListed {
  member: string;
  use: FxRunUse | undefined;
}

/** Every run worth listing: the ones drawn (those that show frames), and uploads nothing draws. */
export function fxList(view: ContentFxArtView): FxListed[] {
  const out: FxListed[] = view.runs
    .filter((r) => r.needs > 0)
    .map((use) => ({ member: use.member, use }));
  for (const a of view.art) {
    if (!out.some((r) => same(r.member, a.name))) {
      out.push({ member: a.name, use: fxUse(view, a.name) });
    }
  }
  return out.sort((a, b) => a.member.localeCompare(b.member));
}

/** The runs a name could be: every run drawn, uploaded or in a pack. */
export function knownRuns(view: ContentFxArtView): string[] {
  const names = new Map<string, string>();
  for (const r of view.runs) {
    names.set(r.member.toLowerCase(), r.member);
  }
  for (const a of view.art) {
    names.set(a.name.toLowerCase(), names.get(a.name.toLowerCase()) ?? a.name);
  }
  for (const k of Object.keys(view.packRuns)) {
    if (!names.has(k)) {
      names.set(k, k);
    }
  }
  return [...names.values()].sort((a, b) => a.localeCompare(b));
}

/** What a bulk file's name stands for: a run (by member, case ignored). */
export type FxMatch = { kind: "run"; run: string } | { kind: "none"; why: string };

export function matchFx(stem: string, view: ContentFxArtView): FxMatch {
  const known = knownRuns(view);
  // `xFirebolt` is Firebolt's trail when no run of its own is called that.
  const run =
    known.find((r) => same(r, stem)) ??
    (/^x/i.test(stem) ? known.find((r) => same(r, stem.slice(1))) : undefined);
  return run
    ? { kind: "run", run: fxUse(view, run)?.member ?? fxUpload(view, run)?.name ?? run }
    : { kind: "none", why: `No effect run is called ${stem}.` };
}

/** Who a repaint changes, every one named: "Repaints Crush for spell Crush." */
export function fxRepaintText(view: ContentFxArtView, run: string): string {
  const use = fxUse(view, run);
  return use && use.users.length > 0
    ? `Repaints ${run} for ${fxUsersText(use)}.`
    : `Repaints ${run}, which nothing draws yet.`;
}

/** How many frames show, in words: "shows 30 frames", "cycles 3 frames as it flies". */
export function showsText(use: FxRunUse | undefined): string {
  if (!use || use.needs === 0) {
    return "is not shown by anything";
  }
  const trail = use.trail > 0 ? `, with a ${use.trail}-frame trail` : "";
  if (use.show === "projectile") {
    return `cycles frames 1 to ${use.needs} as it flies${trail}`;
  }
  return `shows ${use.needs} frame${use.needs === 1 ? "" : "s"}${trail}`;
}

/** The files chosen for one run: a single strip, or frames named `-1` (trail `x<run>-1`). */
export type FxFiles =
  | { kind: "sheet"; file: string }
  | {
      kind: "frames";
      stem: string;
      frames: { file: string; n: number }[];
      trail: { file: string; n: number }[];
    }
  | { kind: "bad"; error: string };

/**
 * Sorts the files chosen for one run. Given the run, `<run>-<n>.png` are its frames and
 * `x<run>-<n>.png` its trail's, so a trail frame chosen on its own goes to the trail; without
 * it, a lone name is the run and a name beside its `x` twin is the trail.
 */
export function fxFiles(names: readonly string[], run?: string): FxFiles {
  if (names.length === 1 && fxFrameFileName(names[0] as string) === null) {
    return { kind: "sheet", file: names[0] as string };
  }
  if (run !== undefined && run.trim() !== "") {
    // The run names only its trail: `x<run>-<n>` goes to the trail, and the other files (one
    // name, whatever it is, so a hand-matched line's frames are taken) are its frames.
    const frames: { file: string; n: number }[] = [];
    const trail: { file: string; n: number }[] = [];
    let stem: string | null = null;
    for (const file of names) {
      const f = fxFrameFileName(file);
      if (!f) {
        return {
          kind: "bad",
          error: `${file} names no frame: name frames like ${run}-1.png (its trail's like x${run}-1.png), or choose one strip on its own`,
        };
      }
      const isTrail = same(f.stem, `x${run}`);
      if (!isTrail) {
        if (stem !== null && !same(stem, f.stem)) {
          return {
            kind: "bad",
            error:
              "The files name more than one run: choose one run's frames (and its trail's) at a time.",
          };
        }
        stem = f.stem;
      }
      const into = isTrail ? trail : frames;
      if (into.some((x) => x.n === f.n)) {
        return {
          kind: "bad",
          error: `Two files are for ${isTrail ? "trail " : ""}frame ${f.n}.`,
        };
      }
      into.push({ file, n: f.n });
    }
    frames.sort((a, b) => a.n - b.n);
    trail.sort((a, b) => a.n - b.n);
    return { kind: "frames", stem: run, frames, trail };
  }
  const parsed: { file: string; stem: string; n: number }[] = [];
  for (const file of names) {
    const f = fxFrameFileName(file);
    if (!f) {
      return {
        kind: "bad",
        error: `${file} names no frame: name frames like Crush-1.png (a trail's like xCrush-1.png), or choose one strip on its own`,
      };
    }
    parsed.push({ file, ...f });
  }
  const stems = [...new Set(parsed.map((p) => p.stem.toLowerCase()))];
  let base: string;
  if (stems.length === 1) {
    base = stems[0] as string;
  } else if (stems.length === 2 && stems.some((s) => stems.includes(`x${s}`))) {
    base = stems.find((s) => stems.includes(`x${s}`)) as string;
  } else {
    return {
      kind: "bad",
      error:
        "The files name more than one run: choose one run's frames (and its trail's) at a time.",
    };
  }
  const frames: { file: string; n: number }[] = [];
  const trail: { file: string; n: number }[] = [];
  for (const p of parsed) {
    const into = p.stem.toLowerCase() === base ? frames : trail;
    if (into.some((x) => x.n === p.n)) {
      return {
        kind: "bad",
        error: `Two files are for ${into === trail ? "trail " : ""}frame ${p.n}.`,
      };
    }
    into.push({ file: p.file, n: p.n });
  }
  frames.sort((a, b) => a.n - b.n);
  trail.sort((a, b) => a.n - b.n);
  const stem = parsed.find((p) => p.stem.toLowerCase() === base)?.stem ?? base;
  return { kind: "frames", stem, frames, trail };
}

/** A bulk upload's files grouped by the run each names (a trail's files with their run's). */
export interface FxGroup {
  stem: string;
  files: string[];
}

export function groupFxFiles(names: readonly string[]): FxGroup[] {
  const stemOf = (file: string) =>
    fxFrameFileName(file)?.stem ?? file.replace(/\.png$/i, "").trim();
  const stems = new Set(names.map((n) => stemOf(n).toLowerCase()));
  const groups: FxGroup[] = [];
  for (const file of names) {
    let stem = stemOf(file);
    // `xCrush-1.png` joins Crush's group when Crush's frames are chosen too.
    if (fxFrameFileName(file) && /^x/i.test(stem) && stems.has(stem.slice(1).toLowerCase())) {
      stem = stem.slice(1);
    }
    const g = groups.find((x) => same(x.stem, stem));
    if (g) {
      g.files.push(file);
    } else {
      groups.push({ stem, files: [file] });
    }
  }
  return groups;
}

/** Whether frame numbers run 1 to n with none missing: what is missing otherwise. */
export function framesInOrder(ns: readonly number[]): string {
  const missing: number[] = [];
  const top = Math.max(0, ...ns);
  for (let n = 1; n <= top; n++) {
    if (!ns.includes(n)) {
      missing.push(n);
    }
  }
  return missing.length === 0
    ? ""
    : `frame${missing.length === 1 ? "" : "s"} ${missing.join(", ")} missing`;
}

/**
 * The anchor every frame of a run gets by default: frame 1's visible middle on `centre`, measured
 * once its transparency is applied (a green backdrop is not part of what shows).
 */
export function runAnchor(
  first: Pixels | null,
  centre: { x: number; y: number },
  transparency: PictureTransparency,
): { regX: number; regY: number } {
  return defaultFxAnchor(first ? keyed(first, transparency) : null, centre);
}

/**
 * A frame's anchor when frames differ in size: the run's anchor, kept on the same spot of each
 * frame's middle (frame 1's size is the reference).
 */
export function sizedAnchor(
  anchor: { regX: number; regY: number },
  ref: { width: number; height: number } | null,
  img: { width: number; height: number } | null,
): { regX: number; regY: number } {
  if (!ref || !img) {
    return anchor;
  }
  return {
    regX: anchor.regX + Math.floor((img.width - ref.width) / 2),
    regY: anchor.regY + Math.floor((img.height - ref.height) / 2),
  };
}

/** The frames as saved: each anchor moved by the offset (right and down). */
export function savedFxFrames(
  frames: readonly { file: string; regX: number; regY: number }[],
  offset: { x: number; y: number },
): FxFrameFile[] {
  return frames.map((f) => ({ file: f.file, regX: f.regX - offset.x, regY: f.regY - offset.y }));
}

/** Whether every anchor of a set fits the art schema's range (±2048). */
export const inRange = (frames: readonly FxFrameFile[]) =>
  frames.every((f) => Math.abs(f.regX) <= 2048 && Math.abs(f.regY) <= 2048);

/** Where an effect's frames centre by default: the pack's first frame of the run it behaves as. */
export function effectCentre(a: Assets, effect: string): { x: number; y: number } {
  return spriteCentre(a.sprite("fx", `${effect}-1`)) ?? FX_TILE_CENTRE;
}

/** The frames a run would show once saved (with `fit`, a point run shows all it has). */
export function shownCount(use: FxRunUse | undefined, count: number, fit: boolean): number {
  if (!use) {
    return count;
  }
  return fit && use.show === "point" ? count : use.needs;
}

/** What the templates say about effect runs. */
export const FX_RULES = `An effect run is frames 1 to n, each up to 512×512. It steps two frames a tick and the screen draws once a tick, so players see frames 1, 3, 5 … (20 a second), while every frame counts for hits. A spell's row says how many show: a run placed at the click shows frames 1 to its lastFrame, a projectile cycles frames 1 to 3 as it flies, and the engine's own runs (fishing, smithing, the slot machine, arrows, cannon shots) have fixed lengths. Each spell's effect acts on a set frame (Crush hits on frame 18, a heal on frame 3), so its run must show at least that many. A trail (xName-1 …) follows the runs whose effect has one. Upload separate PNGs named like Crush-1.png (the trail's like xCrush-1.png), or one strip of equal cells read left to right and top to bottom: the run's frames on its first rows (wrapping onto more rows, so the strip stays within 2048 px), then the trail's on the rows after. Every frame is anchored at the same spot: by default the first frame's middle lands where the run it behaves as lands (or on the tile's middle); drag the preview to move them all. What shows of each frame is its hit box.`;

/** The bare player, for scale. */
const bareLayers = (head: number) =>
  paperdollLayersWith({ aliases: [], has: () => false }, { head }, "F2", "S").filter(
    (l) => !same(l, "BIM"),
  );

/** A guide cell's size, and the largest side an upload may have (the server's IMAGE_MAX_SIDE). */
const GUIDE_CELL = 96;
const IMAGE_MAX_SIDE = 2048;
const GUIDE_MAX_WIDTH = IMAGE_MAX_SIDE;

/**
 * A guide strip's layout for a run of `count` frames and `trail` trail frames: 96 px cells, as many
 * across as fit the 2048 px upload limit (21), the run's frames wrapping onto more rows and the
 * trail's on rows after them. It is the layout the strip cutter reads.
 */
export function guideLayout(count: number, trail = 0): { cell: number } & FxSheetLayout {
  const n = Math.max(1, Math.min(FX_RUN_MAX, count));
  const across = Math.min(n, Math.floor(GUIDE_MAX_WIDTH / GUIDE_CELL));
  return {
    cell: GUIDE_CELL,
    across,
    runRows: Math.ceil(n / across),
    trailRows: trail > 0 ? Math.ceil(Math.min(trail, FX_RUN_MAX) / across) : 0,
  };
}

/**
 * A guide strip: a cell for each frame (and each trail frame, on the rows after), each with the
 * target tile, the player standing on it faintly, and the effect's point marked.
 */
export async function fxGuideSheet(
  a: Assets,
  head: number,
  count: number,
  trail: number,
): Promise<string> {
  await a.loadGroup("paperdoll").catch(() => {});
  const n = count || 8;
  const { across, cell, runRows, trailRows } = guideLayout(n, trail);
  const c = document.createElement("canvas");
  c.width = across * cell;
  c.height = (runRows + trailRows) * cell;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    return "";
  }
  const cells = [
    ...Array.from({ length: n }, (_, i) => fxCell(i, 0, { w: cell, h: cell }, across)),
    ...Array.from({ length: trailRows > 0 ? trail : 0 }, (_, i) =>
      fxCell(i, runRows, { w: cell, h: cell }, across),
    ),
  ];
  for (const { x: x0, y: y0 } of cells) {
    // The point: the tile's middle at the cell's middle.
    const px = x0 + cell / 2;
    const py = y0 + cell / 2 - FX_TILE_CENTRE.y;
    ctx.globalAlpha = 0.35;
    for (const l of bareLayers(head)) {
      drawSprite(ctx, a, "paperdoll", l, px - PAPERDOLL_REG.x, py - PAPERDOLL_REG.y, true);
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
    ctx.strokeRect(px - 16 + 0.5, py + 2 + 0.5, 31, 31);
    ctx.fillStyle = "rgba(255, 0, 255, 0.6)";
    ctx.fillRect(px - 1, py - 1, 3, 3);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.12)";
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, cell - 1, cell - 1);
  }
  return c.toDataURL("image/png");
}

// ---- the panel --------------------------------------------------------------------------------

export interface FxArtOptions {
  assets: Assets;
  /** Uploads one PNG; the stored file, or why it was refused. */
  upload(file: File): Promise<{ ok: true; stored: StoredUpload } | { ok: false; error: string }>;
  /** Cuts an uploaded strip into its run's and trail's frame files (nothing goes in the draft). */
  slice(
    sheet: string,
    layout: FxSheetLayout,
  ): Promise<
    | { ok: true; cell: { w: number; h: number }; frames: string[]; trail: string[] }
    | { ok: false; error: string }
  >;
  /** Puts one effect change in the draft (the server makes it as a whole). */
  apply(change: FxChange): Promise<{ ok: boolean; text: string; run?: string }>;
  decode?(src: string | Blob): Promise<Pixels | null>;
  /** The draft changed (the spells whose rows it changed, if any): the page refreshes. */
  saved(spells: string[]): void;
}

export interface FxArtPicker {
  readonly el: HTMLElement;
  show(target: FxTarget, view: ContentFxArtView): void;
  clear(): void;
  /** Frames set up but not yet saved to the draft. */
  pending(): boolean;
  /** What it shows, or null when hidden. */
  current(): FxTarget | null;
  /** What it last showed, kept when it is cleared (a spell's chosen run survives a reload). */
  remembered(): FxTarget | null;
}

/** A frame being set up: its stored file, its pixels and its anchor before the offset. */
interface FxFrameWork {
  file: string;
  /** Null when the browser could not read it: kept as it is, unseen in the preview. */
  raw: Pixels | null;
  regX: number;
  regY: number;
}

interface FxWorking {
  frames: FxFrameWork[];
  /** Null for no trail upload (a pack's trail of the name, if any, still shows). */
  trail: FxFrameWork[] | null;
  offset: { x: number; y: number };
  transparency: PictureTransparency;
  /** From the run's spell: its row plays every uploaded frame. */
  fit: boolean;
}

/** The screen draws once a tick; a run steps two frames a tick, so frames 1, 3, 5 … are seen. */
const FRAME_MS = 1000 / TICK_HZ;
/** The pause between plays, in ticks. */
const REST_TICKS = 6;
/** A projectile flies this many ticks before the preview starts it again. */
const FLIGHT_TICKS = 12;

/**
 * What the preview shows on display tick `step`: the frame (0-based; null between plays) and, for
 * a projectile stepping `px` a frame, how far it has moved. A run steps two frames a tick, so a
 * play shows frames 1, 3, 5 … and starts again from frame 1 on a whole tick; a projectile moves
 * two steps a tick in its own direction (left and up are negative) and cycles frames 1-3.
 */
export function previewAt(
  step: number,
  frames: number,
  px: number | null,
): { index: number | null; moved: number } {
  if (px !== null) {
    const t = (step % FLIGHT_TICKS) * STEPFRAMES_PER_FRAME;
    return { index: frames > 0 ? t % Math.min(3, frames) : null, moved: px * t };
  }
  const shownTicks = Math.ceil(frames / STEPFRAMES_PER_FRAME);
  const t = (step % (shownTicks + REST_TICKS)) * STEPFRAMES_PER_FRAME;
  return { index: t < frames ? t : null, moved: 0 };
}

/** Whether the live atlas draws a run's frame from an upload (an operator sheet). */
function liveIsUpload(a: Assets, name: string): boolean {
  const s = a.sprite("fx", name);
  return s !== undefined && (a.index.atlases.fx?.sheets[s[0]] ?? "").startsWith("operator/");
}

export function createFxArtPicker(opts: FxArtOptions, idPrefix = "fx-art"): FxArtPicker {
  const a = opts.assets;
  const decode = opts.decode ?? loadPixels;
  const el = document.createElement("section");
  el.className = "item-art fx-art";
  el.setAttribute("aria-label", "Effect");
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

  let target: FxTarget | null = null;
  let lastTarget: FxTarget | null = null;
  let view: ContentFxArtView | null = null;
  /** The run shown (null for a new one until it is named). */
  let run: string | null = null;
  let working: FxWorking | null = null;
  let pristine = false;
  let loading = false;
  let generation = 0;
  type Shown = { img: Pixels; regX: number; regY: number };
  /** Frame by frame, 1:1 with the working frames (null where a frame could not be read). */
  let shown: (Shown | null)[] = [];
  let shownTrail: (Shown | null)[] = [];
  let canvases: (HTMLCanvasElement | null)[] = [];
  let trailCanvases: (HTMLCanvasElement | null)[] = [];
  let reports: FxFrameReport[] = [];
  let trailReports: FxFrameReport[] = [];

  // ---- run chooser (a spell with several runs) and the new run's name ----
  const runSel = action(document.createElement("select"), `${idPrefix}-run`);
  runSel.setAttribute("aria-label", "Which of the spell's runs");
  const runRow = formField("Run", runSel);
  runSel.addEventListener("change", () => {
    if (target?.kind === "spell" && view) {
      show({ kind: "spell", spell: target.spell, run: runSel.value }, view);
    }
  });
  const nameInput = action(document.createElement("input"), `${idPrefix}-name`);
  nameInput.type = "text";
  nameInput.maxLength = 80;
  nameInput.placeholder = "The run's name, as a spell's fx row names it";
  const nameRow = formField("Run name", nameInput);
  // A new run's name decides what it draws for: its notes and the fit box follow it.
  nameInput.addEventListener("input", () => (working ? sync() : updateButtons()));

  // ---- previews ----
  const previews = document.createElement("div");
  previews.className = "item-art-previews";
  const motion = document.createElement("canvas");
  motion.className = "item-art-preview fx-art-motion";
  motion.setAttribute("role", "img");
  const scale = document.createElement("canvas");
  scale.className = "item-art-preview fx-art-scale";
  scale.setAttribute("role", "img");
  scale.setAttribute(
    "aria-label",
    "One frame on its tile beside a player, for scale: drag it to move every frame",
  );
  scale.style.touchAction = "none";
  const strip = document.createElement("canvas");
  strip.className = "item-art-preview fx-art-strip";
  strip.setAttribute("role", "img");
  strip.setAttribute("aria-label", "Every frame in order, the trail below");
  const figure = (c: HTMLCanvasElement, caption: string) => {
    const f = document.createElement("figure");
    f.className = "item-art-figure";
    const cap = document.createElement("figcaption");
    cap.textContent = caption;
    f.append(c, cap);
    return f;
  };
  const frameSel = action(document.createElement("input"), `${idPrefix}-frame`);
  frameSel.type = "number";
  frameSel.min = "1";
  frameSel.step = "1";
  frameSel.value = "1";
  frameSel.setAttribute("aria-label", "The frame shown beside the player");
  frameSel.addEventListener("change", () => drawAll());
  const scaleFig = figure(scale, "Beside a player (drag to move it)");
  scaleFig.prepend(frameSel);
  previews.append(
    figure(motion, "Playing at the game's speed beside a player; the box is the hit box."),
    scaleFig,
    figure(strip, "Every frame: red is wrong, grey is never shown"),
  );

  // ---- controls ----
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
  const fit = action(document.createElement("input"), `${idPrefix}-fit`);
  fit.type = "checkbox";
  const fitLabel = document.createElement("label");
  fitLabel.className = "item-art-check";
  const fitText = document.createElement("span");
  fitLabel.append(fit, fitText);
  const controls = document.createElement("div");
  controls.className = "item-art-controls";
  controls.append(
    formField("Transparency", transparency),
    formField("Move right (px)", offX),
    formField("Move down (px)", offY),
    fitLabel,
  );
  const notes = document.createElement("div");
  notes.className = "item-art-notes";

  // A strip's layout, guessed and changeable.
  const across = action(document.createElement("input"), `${idPrefix}-across`);
  across.type = "number";
  across.min = "1";
  across.max = String(FX_RUN_MAX);
  across.step = "1";
  const runRows = action(document.createElement("input"), `${idPrefix}-run-rows`);
  runRows.type = "number";
  runRows.min = "1";
  runRows.max = String(FX_RUN_MAX);
  runRows.step = "1";
  const trailRows = action(document.createElement("input"), `${idPrefix}-trail-rows`);
  trailRows.type = "number";
  trailRows.min = "0";
  trailRows.max = String(FX_RUN_MAX);
  trailRows.step = "1";
  const recut = panelButton(`${idPrefix}-recut`, "Cut the strip again", () => {
    if (lastStrip && !loading && !busy) {
      void cutStrip(lastStrip, {
        across: Number(across.value),
        runRows: Number(runRows.value),
        trailRows: Number(trailRows.value),
      });
    }
  });
  const stripRow = document.createElement("div");
  stripRow.className = "content-buttons";
  stripRow.append(
    formField("Frames across", across),
    formField("Rows of the run", runRows),
    formField("Rows of its trail", trailRows),
    recut,
  );
  stripRow.hidden = true;

  const file = action(document.createElement("input"), `${idPrefix}-files`);
  file.type = "file";
  file.multiple = true;
  file.accept = ".png,image/png";
  file.setAttribute("aria-label", "Frame PNGs named like Crush-1.png, or one strip");
  file.addEventListener("change", () => {
    const list = [...(file.files ?? [])];
    file.value = "";
    if (list.length > 0) {
      void addFiles(list);
    }
  });
  const guide = guideLink(
    `${idPrefix}-guide`,
    () => run ?? "effect",
    () => {
      if (!view) {
        return Promise.resolve("");
      }
      const use = run ? fxUse(view, run) : undefined;
      return fxGuideSheet(a, view.head, use?.needs ?? 8, use?.trail ?? 0);
    },
  );

  const runName = () => (run ?? nameInput.value).trim();
  const change = (): FxChange | null => {
    if (!working || !view) {
      return null;
    }
    const name = runName();
    const use = fxUse(view, name);
    return {
      op: "set",
      run: name,
      frames: savedFxFrames(working.frames, working.offset),
      trail: working.trail ? savedFxFrames(working.trail, working.offset) : null,
      transparency: working.transparency,
      seen: use?.users ?? [],
      ...(fitOffered() && working.fit ? { fit: true } : {}),
      // The upload as this panel saw it: a save over someone else's newer one is refused.
      expect: artRowFingerprint(fxUpload(view, name)),
    };
  };
  const saveBtn = panelButton(
    `${idPrefix}-save`,
    "Save the frames to the draft",
    () => {
      const c = change();
      if (c) {
        void commit(c);
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
      if (run !== null && view) {
        void commit({ op: "remove", run, expect: artRowFingerprint(fxUpload(view, run)) });
      }
    },
    "danger",
  );
  const uploadRow = document.createElement("div");
  uploadRow.className = "content-buttons";
  uploadRow.append(file, guide);
  const buttons = document.createElement("div");
  buttons.className = "content-buttons";
  buttons.append(saveBtn, cancelBtn, removeBtn);
  const repaintNote = document.createElement("p");
  repaintNote.className = "item-art-rules fx-art-repaints";
  repaintNote.hidden = true;
  const rulesText = document.createElement("p");
  rulesText.className = "item-art-rules";
  rulesText.textContent = FX_RULES;
  const editor = document.createElement("div");
  editor.className = "item-art-editor";
  editor.append(previews, controls);
  el.append(
    title,
    runRow,
    nameRow,
    state,
    source,
    editor,
    notes,
    repaintNote,
    buttons,
    status,
    uploadRow,
    stripRow,
    rulesText,
  );

  /** The run's use as the draft has it. */
  const useNow = () => (view ? fxUse(view, runName()) : undefined);
  /** Whether saving can make the run's spell play every frame. */
  const fitOffered = () => {
    const use = useNow();
    return use?.spell !== undefined && (use.show === "point" || use.show === "projectile");
  };

  let busy = false;
  async function commit(c: FxChange): Promise<void> {
    if (busy) {
      return;
    }
    busy = true;
    updateButtons();
    status.textContent = "Saving…";
    // The panel may show something else by the time the answer comes: then it changes nothing
    // of what is shown now (only the page refreshes).
    const sent = generation;
    // Only a save from a spell's run with `fit` changes the spell's row.
    const spell = c.op === "set" && c.fit ? useNow()?.spell : undefined;
    const spells = spell !== undefined ? [spell] : [];
    try {
      const r = await opts.apply(c);
      if (sent !== generation) {
        if (r.ok) {
          opts.saved(spells);
        }
        return;
      }
      status.textContent = r.text;
      if (r.ok) {
        pristine = true;
        // A new run is shown under its name from now on.
        if (c.op === "set" && target?.kind === "new") {
          target = { kind: "run", run: r.run ?? c.run };
          lastTarget = target;
          run = target.run;
        }
        opts.saved(spells);
      }
    } finally {
      busy = false;
      updateButtons();
    }
  }

  // One entry per frame, so frame i stays frame i when one cannot be read.
  const keyedFrames = (frames: readonly FxFrameWork[], w: FxWorking): (Shown | null)[] =>
    frames.map((f) =>
      f.raw
        ? {
            img: keyed(f.raw, w.transparency),
            regX: f.regX - w.offset.x,
            regY: f.regY - w.offset.y,
          }
        : null,
    );

  function sync(): void {
    reports = [];
    trailReports = [];
    canvases = [];
    trailCanvases = [];
    const lines: { text: string; error: boolean }[] = [];
    const use = useNow();
    if (working) {
      transparency.value = working.transparency;
      offX.value = String(working.offset.x);
      offY.value = String(working.offset.y);
      fit.checked = working.fit;
      shown = keyedFrames(working.frames, working);
      shownTrail = working.trail ? keyedFrames(working.trail, working) : [];
      working.frames.forEach((f, i) => {
        if (!f.raw) {
          lines.push({
            text: `Frame ${i + 1} could not be read for the preview; it is kept`,
            error: false,
          });
          reports.push({ errors: [], warnings: [] });
          return;
        }
        const r = fxFrameReport(keyed(f.raw, working?.transparency ?? "alpha"), `Frame ${i + 1}`);
        reports.push(r);
      });
      (working.trail ?? []).forEach((f, i) => {
        if (!f.raw) {
          trailReports.push({ errors: [], warnings: [] });
          return;
        }
        trailReports.push(
          fxFrameReport(keyed(f.raw, working?.transparency ?? "alpha"), `Trail frame ${i + 1}`),
        );
      });
      for (const r of [...reports, ...trailReports]) {
        for (const e of r.errors) {
          lines.push({ text: e, error: true });
        }
        for (const w of r.warnings) {
          lines.push({ text: w, error: false });
        }
      }
      const count = working.frames.length;
      const needs = shownCount(use, count, fitOffered() && working.fit);
      if (use && fitOffered() && working.fit && use.show === "point" && count < use.trigger) {
        lines.push({
          text: `Spell ${use.spell} acts on frame ${use.trigger} of its effect (${use.effect}), so its run needs at least ${use.trigger} frames: add frames, or untick the box to keep it showing ${use.needs}.`,
          error: true,
        });
      }
      if (use && count < needs) {
        lines.push({
          text: `${runName()} ${showsText(use)} but there are ${count}: add frames${fitOffered() ? ", or tick the box to make its spell play only these" : ""}.`,
          error: true,
        });
      } else if (use && use.needs > 0 && count > needs) {
        lines.push({
          text: `Frames ${needs + 1} to ${count} are never shown${fitOffered() && use.show === "point" ? ": tick the box to make its spell play them all" : ""}.`,
          error: false,
        });
      }
      const trailNeeds = use ? Math.min(use.trail, needs) : 0;
      if (working.trail && working.trail.length < trailNeeds) {
        lines.push({
          text: `The trail shows ${trailNeeds} frames but there are ${working.trail.length}.`,
          error: true,
        });
      } else if (!working.trail && trailNeeds > 0) {
        const pack = view?.packRuns[runName().toLowerCase()]?.trail ?? 0;
        lines.push({
          text:
            pack >= trailNeeds
              ? "No trail uploaded: the pack's trail keeps showing behind it."
              : `No trail uploaded: its ${trailNeeds}-frame trail will show nothing (name trail frames like x${runName()}-1.png, or put them on a strip's second row).`,
          error: false,
        });
      }
      if (
        !inRange(savedFxFrames(working.frames, working.offset)) ||
        !inRange(savedFxFrames(working.trail ?? [], working.offset))
      ) {
        lines.push({
          text: "Moved this far, a frame's anchor is past 2048 px: move it back nearer its tile.",
          error: true,
        });
      }
      canvases = shown.map((x) => (x ? pixelCanvas(x.img) : null));
      trailCanvases = shownTrail.map((x) => (x ? pixelCanvas(x.img) : null));
    } else {
      shown = [];
      shownTrail = [];
    }
    // The spell row's length, when saving can change it.
    if (working && fitOffered() && use) {
      const count = working.frames.length;
      fitText.textContent =
        use.show === "point"
          ? ` Spell ${use.spell} plays all ${count} frames (it shows ${use.needs} now). This is how long its effect shows, and can hit.`
          : ` Spell ${use.spell}'s row records ${count} frames (a projectile still cycles 1 to 3).`;
      fitLabel.hidden = false;
    } else {
      fitLabel.hidden = true;
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

  /** Whether the working set can be saved: frames enough and nothing wrong with any. */
  const complete = () => {
    if (!working || runName() === "") {
      return false;
    }
    const use = useNow();
    const count = working.frames.length;
    const needs = shownCount(use, count, fitOffered() && working.fit);
    const trailNeeds = use ? Math.min(use.trail, needs) : 0;
    const triggerShort =
      use !== undefined &&
      fitOffered() &&
      working.fit &&
      use.show === "point" &&
      count < use.trigger;
    return (
      count >= 1 &&
      !triggerShort &&
      count >= (use ? needs : 1) &&
      (working.trail === null || working.trail.length >= trailNeeds) &&
      ![...reports, ...trailReports].some((r) => r.errors.length > 0) &&
      inRange(savedFxFrames(working.frames, working.offset)) &&
      inRange(savedFxFrames(working.trail ?? [], working.offset))
    );
  };

  function updateButtons(): void {
    const pending = working !== null && !pristine;
    saveBtn.hidden = !pending;
    saveBtn.disabled = busy || !complete();
    saveBtn.textContent = run === null ? "Save as a new run" : `Save to ${run}`;
    // Before a save repaints a run others draw, every one of them is named.
    const name = runName();
    const repaints =
      pending && view !== null && name !== "" && (fxUse(view, name)?.users.length ?? 0) > 0
        ? fxRepaintText(view, name)
        : "";
    repaintNote.textContent = repaints;
    repaintNote.hidden = repaints === "";
    cancelBtn.hidden = !pending;
    removeBtn.hidden = pending || run === null || !(view && fxUpload(view, run));
    removeBtn.disabled = busy;
    file.disabled = loading || busy || (run === null && nameInput.value.trim() === "");
    recut.disabled = loading || busy || lastStrip === null;
    nameRow.hidden = target?.kind !== "new" || run !== null;
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
  transparency.addEventListener("change", () => {
    if (working) {
      working.transparency = transparency.value === "green" ? "green" : "alpha";
      pristine = false;
      sync();
    }
  });
  fit.addEventListener("change", () => {
    if (working) {
      working.fit = fit.checked;
      pristine = false;
      sync();
    }
  });

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
    shown = keyedFrames(working.frames, working);
    shownTrail = working.trail ? keyedFrames(working.trail, working) : [];
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
    run !== null &&
    !fxUpload(view, run) &&
    liveIsUpload(a, `${run}-1`);

  /** How many frames (and trail frames) the preview plays. */
  function playCount(): { frames: number; trail: number } {
    const use = useNow();
    if (working) {
      const n = shownCount(use, working.frames.length, fitOffered() && working.fit);
      const t = use ? Math.min(use.trail, n) : 0;
      return {
        frames: use && use.needs > 0 ? n : working.frames.length,
        trail: working.trail ? Math.min(t || working.trail.length, working.trail.length) : t,
      };
    }
    return { frames: use?.needs ?? 0, trail: use?.trail ?? 0 };
  }

  /** What one frame draws, for the extents: the working frame, else the live atlas's. */
  function frameBox(
    trail: boolean,
    i: number,
  ): { w: number; h: number; regX: number; regY: number } | null {
    const s = (trail ? shownTrail : shown)[i];
    if (s) {
      return { w: s.img.width, h: s.img.height, regX: s.regX, regY: s.regY };
    }
    if (working && (!trail || working.trail !== null)) {
      return null;
    }
    if (run === null || comingBack()) {
      return null;
    }
    const sp = a.sprite("fx", `${trail ? "x" : ""}${run}-${i + 1}`);
    return sp ? { w: sp[3], h: sp[4], regX: sp[5], regY: sp[6] } : null;
  }

  /** Draws frame `i` (0-based) of the run or its trail with its point at (x, y), and its box. */
  function drawFrame(
    ctx: CanvasRenderingContext2D,
    trail: boolean,
    i: number,
    x: number,
    y: number,
    box: boolean,
  ): void {
    const s = (trail ? shownTrail : shown)[i];
    if (s) {
      const c = (trail ? trailCanvases : canvases)[i];
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
    const fromAtlas = !working || (trail && working.trail === null);
    if (fromAtlas && run !== null && !comingBack()) {
      const name = `${trail ? "x" : ""}${run}-${i + 1}`;
      drawSprite(ctx, a, "fx", name, x, y);
      const sp = box ? a.sprite("fx", name) : undefined;
      if (sp) {
        ctx.strokeStyle = "rgba(255, 255, 0, 0.8)";
        ctx.strokeRect(x - sp[5] + 0.5, y - sp[6] + 0.5, sp[3] - 1, sp[4] - 1);
      }
    }
  }

  function drawTile(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    ctx.fillStyle = "#3f7a34";
    ctx.fillRect(x - 16, y + 2, 32, 32);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.3)";
    ctx.strokeRect(x - 16 + 0.5, y + 2 + 0.5, 31, 31);
  }

  /** The box round every frame (and the player's tile), from the effect's point. */
  let ext = { left: -16, top: -6, right: 16, bottom: 39 };
  let flight = 0;
  /** Bumped by every draw and by clear: a draw still waiting for its atlases is dropped. */
  let drawSeq = 0;
  function drawAll(): void {
    const { frames, trail } = playCount();
    let left = -16;
    let top = -PAPERDOLL_REG.y;
    let right = 16;
    let bottom = 39;
    for (const [t, n] of [
      [false, frames],
      [true, trail],
    ] as const) {
      for (let i = 0; i < Math.max(n, t ? shownTrail.length : shown.length); i++) {
        const b = frameBox(t, i);
        if (b) {
          left = Math.min(left, -b.regX);
          top = Math.min(top, -b.regY);
          right = Math.max(right, b.w - b.regX);
          bottom = Math.max(bottom, b.h - b.regY);
        }
      }
    }
    ext = { left, top, right, bottom };
    const use = useNow();
    flight = use?.projectile
      ? Math.abs(use.projectile.px) * FLIGHT_TICKS * STEPFRAMES_PER_FRAME
      : 0;
    const w = right - left;
    const h = bottom - top;
    // The player's tile, then the effect's (wide enough for either, and for a flight).
    const along = use?.projectile?.axis === "locH" ? flight : 0;
    const down = use?.projectile?.axis === "locV" ? flight : 0;
    motion.width = 48 + w + along;
    motion.height = h + down;
    scale.width = 48 + w;
    scale.height = h;
    // Every frame shown, uploaded or the pack's, sets the strip's cells.
    const count = Math.max(frames, shown.length, 1);
    const trailCount = Math.max(trail, shownTrail.length);
    const boxes = [
      ...Array.from({ length: count }, (_, i) => frameBox(false, i)),
      ...Array.from({ length: trailCount }, (_, i) => frameBox(true, i)),
    ].filter((b) => b !== null);
    const cellW = Math.max(32, ...boxes.map((b) => b.w));
    const cellH = Math.max(32, ...boxes.map((b) => b.h));
    strip.width = Math.min(4096, Math.max(count, trailCount) * cellW);
    strip.height = (trailCount > 0 ? 2 : 1) * cellH;
    frameSel.max = String(count);
    const mine = ++drawSeq;
    void a
      .loadGroup("fx")
      .catch(() => {})
      .then(() => a.loadGroup("paperdoll").catch(() => {}))
      .then(() => {
        if (mine !== drawSeq) {
          return;
        }
        drawMotion();
        drawScale();
        drawStrip(cellW, cellH);
      });
  }

  let step = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  /** The player standing on the first tile, and the effect's point on the next. */
  function stage(ctx: CanvasRenderingContext2D, room = false): { x: number; y: number } {
    // A projectile flying left or up starts that far in, so its whole flight shows.
    const p = room ? useNow()?.projectile : undefined;
    const dx = p?.axis === "locH" && p.px < 0 ? flight : 0;
    const dy = p?.axis === "locV" && p.px < 0 ? flight : 0;
    const y = -ext.top + dy;
    const px = 24 + dx;
    const x = 48 - ext.left + dx;
    drawTile(ctx, px, y);
    drawTile(ctx, x, y);
    if (view) {
      for (const l of bareLayers(view.head)) {
        drawSprite(ctx, a, "paperdoll", l, px - PAPERDOLL_REG.x, y - PAPERDOLL_REG.y, true);
      }
    }
    return { x, y };
  }

  function drawMotion(): void {
    const ctx = motion.getContext("2d");
    if (!ctx) {
      return;
    }
    ctx.clearRect(0, 0, motion.width, motion.height);
    const { x, y } = stage(ctx, true);
    const { frames, trail } = playCount();
    const use = useNow();
    if (frames === 0) {
      return;
    }
    if (use?.projectile) {
      const at = previewAt(step, frames, use.projectile.px);
      const fx = x + (use.projectile.axis === "locH" ? at.moved : 0);
      const fy = y + (use.projectile.axis === "locV" ? at.moved : 0);
      if (at.index !== null) {
        drawFrame(ctx, false, at.index, fx, fy, true);
      }
      return;
    }
    const t = previewAt(step, frames, null).index;
    if (t !== null) {
      drawFrame(ctx, false, t, x, y, true);
      if (t < trail) {
        drawFrame(ctx, true, t, x, y, false);
      }
    }
  }

  function drawScale(): void {
    const ctx = scale.getContext("2d");
    if (!ctx) {
      return;
    }
    ctx.clearRect(0, 0, scale.width, scale.height);
    const { x, y } = stage(ctx);
    // Any frame shown, the working set's or the pack's.
    const count = Math.max(playCount().frames, shown.length, 1);
    const i = Math.max(0, Math.min(Number(frameSel.value) - 1 || 0, count - 1));
    drawFrame(ctx, false, i, x, y, false);
    // The effect's point.
    ctx.fillStyle = "#ff40ff";
    ctx.fillRect(x - 1, y - 1, 3, 3);
  }

  function drawStrip(cellW: number, cellH: number): void {
    const ctx = strip.getContext("2d");
    if (!ctx) {
      return;
    }
    ctx.clearRect(0, 0, strip.width, strip.height);
    ctx.fillStyle = "#26301f";
    ctx.fillRect(0, 0, strip.width, strip.height);
    const { frames, trail } = playCount();
    const rows: [boolean, number, number][] = [[false, Math.max(frames, shown.length, 1), frames]];
    if (trail > 0 || shownTrail.length > 0) {
      rows.push([true, Math.max(trail, shownTrail.length), trail]);
    }
    rows.forEach(([isTrail, n, needs], row) => {
      for (let i = 0; i < n; i++) {
        const x = i * cellW;
        const y = row * cellH;
        if (x >= strip.width) {
          break;
        }
        const s = (isTrail ? shownTrail : shown)[i];
        const c = (isTrail ? trailCanvases : canvases)[i];
        if (s && c) {
          ctx.drawImage(
            c,
            x + Math.floor((cellW - s.img.width) / 2),
            y + Math.floor((cellH - s.img.height) / 2),
          );
        } else if (
          (!working || (isTrail && working.trail === null)) &&
          run !== null &&
          !comingBack()
        ) {
          const name = `${isTrail ? "x" : ""}${run}-${i + 1}`;
          const sp = a.sprite("fx", name);
          if (sp) {
            drawSprite(
              ctx,
              a,
              "fx",
              name,
              x + Math.floor((cellW - sp[3]) / 2),
              y + Math.floor((cellH - sp[4]) / 2),
              true,
            );
          }
        }
        const rep = (isTrail ? trailReports : reports)[i];
        const missing =
          working !== null && i >= (isTrail ? (working.trail?.length ?? n) : working.frames.length);
        if ((rep?.errors.length ?? 0) > 0 || (missing && i < needs)) {
          ctx.strokeStyle = "#ff4040";
          ctx.strokeRect(x + 0.5, y + 0.5, cellW - 1, cellH - 1);
        } else if (i >= needs && needs > 0) {
          ctx.fillStyle = "rgba(128, 128, 128, 0.5)";
          ctx.fillRect(x, y, cellW, cellH);
        }
      }
    });
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
      drawMotion();
    }, FRAME_MS);
  }
  function stopTimer(): void {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  function base(): FxWorking {
    if (working) {
      return {
        ...working,
        frames: [...working.frames],
        trail: working.trail ? [...working.trail] : null,
      };
    }
    return { frames: [], trail: null, offset: { x: 0, y: 0 }, transparency: "alpha", fit: true };
  }

  /** The run's anchor for a new first frame: its middle where the run it behaves as lands. */
  const anchorFor = (first: Pixels | null, transparency: PictureTransparency) => {
    const use = useNow();
    return runAnchor(first, effectCentre(a, use?.effect ?? runName()), transparency);
  };

  let lastStrip: { file: File; raw: Pixels; stored: string } | null = null;

  async function cutStrip(
    s: { file: File; raw: Pixels; stored: string },
    layout: FxSheetLayout,
  ): Promise<void> {
    const mine = ++generation;
    // The strip can be cut again now, whatever comes of this cut.
    updateButtons();
    const cell = fxSheetCell(s.raw.width, s.raw.height, layout);
    if ("error" in cell) {
      status.textContent = `${s.file.name}: ${cell.error}.`;
      return;
    }
    const local = stripFrames(s.raw, cell, layout);
    if ("error" in local) {
      status.textContent = `${s.file.name}: ${local.error}.`;
      return;
    }
    status.textContent = `Cutting ${s.file.name}…`;
    loading = true;
    updateButtons();
    try {
      const cut = await opts.slice(s.stored, layout);
      if (mine !== generation) {
        return;
      }
      if (!cut.ok) {
        status.textContent = `Refused: ${cut.error}`;
        return;
      }
      const b = base();
      const raws = local.frames;
      const transparency = guessTransparency(s.raw);
      const anchor = anchorFor(raws[0] ?? null, transparency);
      // A strip is the whole run afresh: its own anchor, offset and transparency.
      working = {
        frames: cut.frames.map((f, i) => ({ file: f, raw: raws[i] ?? null, ...anchor })),
        trail:
          cut.trail.length > 0
            ? cut.trail.map((f, i) => ({ file: f, raw: local.trail[i] ?? null, ...anchor }))
            : null,
        offset: { x: 0, y: 0 },
        transparency,
        fit: b.fit,
      };
      pristine = false;
      status.textContent = `${s.file.name} is cut into ${cut.frames.length} frame${cut.frames.length === 1 ? "" : "s"}${cut.trail.length > 0 ? ` and a ${cut.trail.length}-frame trail` : ""} of ${cell.w}×${cell.h}: check the preview, then save them to the draft.`;
      sync();
      startTimer();
    } finally {
      if (mine === generation) {
        loading = false;
        updateButtons();
      }
    }
  }

  async function addFiles(list: File[]): Promise<void> {
    const mine = ++generation;
    if (!view) {
      return;
    }
    const files = fxFiles(
      list.map((f) => f.name),
      runName(),
    );
    if (files.kind === "bad") {
      status.textContent = files.error;
      return;
    }
    status.textContent = `Uploading ${list.length === 1 ? (list[0]?.name ?? "") : `${list.length} files`}…`;
    loading = true;
    updateButtons();
    try {
      await addSorted(list, files, mine);
    } finally {
      if (mine === generation) {
        loading = false;
        updateButtons();
      }
    }
  }

  /** What a picture too large to upload is told, or "" when it fits. */
  const tooLarge = (name: string, raw: Pixels) =>
    raw.width > IMAGE_MAX_SIDE || raw.height > IMAGE_MAX_SIDE
      ? `${name} is ${raw.width}×${raw.height}; uploads may be at most ${IMAGE_MAX_SIDE} px a side (wrap a long strip onto more rows).`
      : "";

  async function addSorted(
    list: File[],
    files: Exclude<FxFiles, { kind: "bad" }>,
    mine: number,
  ): Promise<void> {
    if (files.kind === "sheet") {
      const f = list[0] as File;
      const raw = await decode(f);
      if (mine !== generation) {
        return;
      }
      if (!raw) {
        status.textContent = "The browser could not read that strip.";
        return;
      }
      const big = tooLarge(f.name, raw);
      if (big) {
        status.textContent = big;
        return;
      }
      const use = useNow();
      const guess = guessFxSheet(raw.width, raw.height, use?.needs ?? 0, use?.trail ?? 0) ?? {
        across: Math.max(1, use?.needs ?? 1),
        runRows: 1,
        trailRows: 0,
      };
      across.value = String(guess.across);
      runRows.value = String(guess.runRows);
      trailRows.value = String(guess.trailRows);
      stripRow.hidden = false;
      const stored = await opts.upload(f);
      if (mine !== generation) {
        return;
      }
      if (!stored.ok) {
        status.textContent = `Refused: ${stored.error}`;
        return;
      }
      lastStrip = { file: f, raw, stored: stored.stored.file };
      await cutStrip(lastStrip, guess);
      return;
    }
    // Frame files replace a strip: its layout no longer applies.
    lastStrip = null;
    stripRow.hidden = true;
    const b = base();
    const freshRun = files.frames.some((x) => x.n === 1);
    if (b.frames.length === 0 && files.frames.length === 0) {
      status.textContent =
        "Upload the run's own frames first (from frame 1): its trail is anchored with them.";
      return;
    }
    // Frames named by number land at that number: a reopened upload keeps the frames not chosen.
    const all = [
      ...files.frames.map((x) => ({ ...x, trail: false })),
      ...files.trail.map((x) => ({ ...x, trail: true })),
    ];
    const uploaded: { n: number; trail: boolean; file: string; raw: Pixels }[] = [];
    for (const x of all) {
      const f = list.find((l) => l.name === x.file) as File;
      const [stored, raw] = await Promise.all([opts.upload(f), decode(f)]);
      if (mine !== generation) {
        return;
      }
      if (!stored.ok) {
        status.textContent = `${x.file} refused: ${stored.error}`;
        return;
      }
      if (!raw) {
        status.textContent = `The browser could not read ${x.file}.`;
        return;
      }
      uploaded.push({ n: x.n, trail: x.trail, file: stored.stored.file, raw });
    }
    const newFirst = uploaded.find((u) => !u.trail && u.n === 1)?.raw ?? null;
    let anchor: { regX: number; regY: number };
    let ref: Pixels | null;
    if (freshRun && newFirst) {
      // A run afresh from frame 1 starts afresh: its transparency and anchor are read from its new
      // first frame, and the old offset is kept only in the trail frames it leaves as they were.
      if (b.trail) {
        b.trail = b.trail.map((f) => ({
          ...f,
          regX: f.regX - b.offset.x,
          regY: f.regY - b.offset.y,
        }));
      }
      b.offset = { x: 0, y: 0 };
      b.transparency = guessTransparency(newFirst);
      b.frames = [];
      anchor = anchorFor(newFirst, b.transparency);
      ref = newFirst;
    } else {
      const f0 = b.frames[0] as FxFrameWork;
      anchor = { regX: f0.regX, regY: f0.regY };
      ref = f0.raw;
    }
    const place = (into: FxFrameWork[], u: (typeof uploaded)[number]) => {
      const at = u.n - 1;
      const prev = into[at];
      // A replaced frame keeps its own anchor's place (sized to the new picture); a new one
      // takes the run's.
      const a0 = prev
        ? sizedAnchor({ regX: prev.regX, regY: prev.regY }, prev.raw, u.raw)
        : sizedAnchor(anchor, ref, u.raw);
      into[at] = { file: u.file, raw: u.raw, ...a0 };
    };
    // A trail that starts at frame 1 is the trail afresh, anchored with the run.
    if (uploaded.some((u) => u.trail && u.n === 1)) {
      b.trail = [];
    }
    for (const u of uploaded) {
      if (u.trail) {
        b.trail ??= [];
        place(b.trail, u);
      } else {
        place(b.frames, u);
      }
    }
    // A gap in the numbering can't be saved (later frames would move up one): nothing changes.
    const hole = [b.frames, b.trail ?? []]
      .map((arr) =>
        framesInOrder([...arr.keys()].filter((i) => arr[i] !== undefined).map((i) => i + 1)),
      )
      .find((h) => h !== "");
    if (hole) {
      status.textContent = `With these files the run would have ${hole}: choose ${hole.includes(",") ? "them" : "it"} too.`;
      return;
    }
    working = b;
    pristine = false;
    status.textContent = `${uploaded.length} frame${uploaded.length === 1 ? "" : "s"} uploaded: check the preview, then save them to the draft.`;
    sync();
    startTimer();
  }

  function fillRuns(t: Extract<FxTarget, { kind: "spell" }>, v: ContentFxArtView): string | null {
    const spell = v.spells.find((s) => same(s.name, t.spell));
    const runs = spell?.fx.map((f) => f.member) ?? [];
    runSel.replaceChildren(
      ...runs.map((r) => {
        const o = document.createElement("option");
        o.value = r;
        const use = fxUse(v, r);
        o.textContent = `${r} · ${showsText(use)}`;
        return o;
      }),
    );
    const chosen = runs.find((r) => t.run !== undefined && same(r, t.run)) ?? runs[0] ?? null;
    if (chosen) {
      runSel.value = chosen;
    }
    runRow.hidden = runs.length < 2;
    return chosen;
  }

  function show(t: FxTarget, v: ContentFxArtView): void {
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
    lastStrip = null;
    stripRow.hidden = true;
    frameSel.value = "1";
    if (t.kind === "spell") {
      const chosen = fillRuns(t, v);
      if (!chosen) {
        clear();
        return;
      }
      run = chosen;
      title.textContent = "Effect";
      runRow.hidden = (v.spells.find((s) => same(s.name, t.spell))?.fx.length ?? 0) < 2;
    } else if (t.kind === "run") {
      runRow.hidden = true;
      run = fxUse(v, t.run)?.member ?? fxUpload(v, t.run)?.name ?? t.run;
      title.textContent = `Effect ${run}`;
    } else {
      runRow.hidden = true;
      run = null;
      nameInput.value = "";
      title.textContent = "New effect";
    }
    el.hidden = false;
    if (run === null) {
      state.textContent =
        "Name the run as a spell's fx row will name it (or as an engine run is named, to repaint it), then upload its frames or a strip.";
      source.textContent = "";
      motion.setAttribute("aria-label", "The new run playing");
      sync();
      stopTimer();
      return;
    }
    const use = fxUse(v, run);
    state.textContent = `${run} ${showsText(use)}. Drawn by ${fxUsersText(use)}.`;
    motion.setAttribute("aria-label", `${run} playing beside a player`);
    const n = run;
    const src = fxSource(v, n);
    if (src.kind === "upload") {
      source.textContent =
        "It draws your upload. Choose frames to replace some (by number), or a strip to replace them all.";
      loading = true;
      sync();
      const all = [...src.art.frames, ...(src.art.trail ?? [])];
      void Promise.all(all.map((f) => decode(uploadUrl({ file: f.file, ext: "png" })))).then(
        (raws) => {
          if (mine !== generation) {
            return;
          }
          loading = false;
          const k = src.art.frames.length;
          working = {
            frames: src.art.frames.map((f, i) => ({ ...f, raw: raws[i] ?? null })),
            trail: src.art.trail
              ? src.art.trail.map((f, i) => ({ ...f, raw: raws[k + i] ?? null }))
              : null,
            offset: { x: 0, y: 0 },
            transparency: src.art.transparency ?? "alpha",
            fit: true,
          };
          pristine = true;
          sync();
        },
      );
    } else if (src.kind === "pack") {
      source.textContent = comingBackFor(v, n)
        ? "It will draw the pack's run once the draft is published (the draft takes out the upload that replaced it; the preview cannot show the pack's until then)."
        : `It draws the pack's ${src.frames} frame${src.frames === 1 ? "" : "s"}${src.trail > 0 ? ` and ${src.trail}-frame trail` : ""}. Upload frames or a strip to replace them.`;
      sync();
    } else {
      source.textContent = "It has no frames yet: upload its frames or a strip.";
      sync();
    }
    startTimer();
  }

  const comingBackFor = (v: ContentFxArtView, n: string) =>
    !fxUpload(v, n) && liveIsUpload(a, `${n}-1`);

  function clear(): void {
    generation += 1;
    drawSeq += 1;
    loading = false;
    target = null;
    view = null;
    run = null;
    working = null;
    lastStrip = null;
    el.hidden = true;
    stopTimer();
  }

  return {
    el,
    show,
    clear,
    pending: () => !el.hidden && working !== null && !pristine,
    current: () => (el.hidden ? null : target),
    remembered: () => lastTarget,
  };
}

// ---- the Spell effects section ----------------------------------------------------------------

export type SpellEffectsOptions = FxArtOptions;

export interface SpellEffects {
  pending(): boolean;
  /** Drops frames set up in the section's panel. */
  discard(): void;
  readonly el: HTMLElement;
  setView(view: ContentFxArtView): void;
  reset(): void;
}

/** One run's files in a bulk upload. */
interface FxBulkLine {
  group: FxGroup;
  files: File[];
  /** What it attaches to: typed or matched (a run's name). */
  name: string;
  match: FxMatch;
  /** From the run's spell: its row plays every uploaded frame. */
  fit: boolean;
  raws: Map<string, Pixels | null> | null;
  done: string;
}

/** A bulk line's frames as pixels, ready to check: the run's and the trail's, in order. */
export function bulkFxFrames(
  names: readonly string[],
  raws: ReadonlyMap<string, Pixels | null>,
  shows: { needs: number; trail: number },
  run?: string,
): { frames: Pixels[]; trail: Pixels[]; layout: FxSheetLayout | null } | { error: string } {
  const sorted = fxFiles(names, run);
  if (sorted.kind === "bad") {
    return { error: sorted.error };
  }
  if (sorted.kind === "sheet") {
    const raw = raws.get(sorted.file);
    if (!raw) {
      return { error: `The browser could not read ${sorted.file}.` };
    }
    if (raw.width > IMAGE_MAX_SIDE || raw.height > IMAGE_MAX_SIDE) {
      return {
        error: `${sorted.file} is ${raw.width}×${raw.height}; uploads may be at most ${IMAGE_MAX_SIDE} px a side (wrap a long strip onto more rows).`,
      };
    }
    const layout = guessFxSheet(raw.width, raw.height, shows.needs, shows.trail);
    if (!layout) {
      return {
        error: `${sorted.file}: its cells are not square, so its layout cannot be guessed: open the run and cut it by hand.`,
      };
    }
    const cell = fxSheetCell(raw.width, raw.height, layout);
    if ("error" in cell) {
      return { error: `${sorted.file}: ${cell.error}.` };
    }
    const cut = stripFrames(raw, cell, layout);
    if ("error" in cut) {
      return { error: `${sorted.file}: ${cut.error}.` };
    }
    return { ...cut, layout };
  }
  const gap =
    framesInOrder(sorted.frames.map((f) => f.n)) || framesInOrder(sorted.trail.map((f) => f.n));
  if (sorted.frames.length === 0) {
    return { error: "Only trail frames: upload the run's own frames (from 1) with its trail." };
  }
  if (gap || sorted.frames[0]?.n !== 1) {
    return { error: `The frames must run from 1 with none missing (${gap || "frame 1 missing"}).` };
  }
  const read = (list: { file: string }[]): Pixels[] | string => {
    const out: Pixels[] = [];
    for (const f of list) {
      const raw = raws.get(f.file);
      if (!raw) {
        return `The browser could not read ${f.file}.`;
      }
      out.push(raw);
    }
    return out;
  };
  const frames = read(sorted.frames);
  const trail = read(sorted.trail);
  if (typeof frames === "string") {
    return { error: frames };
  }
  if (typeof trail === "string") {
    return { error: trail };
  }
  return { frames, trail, layout: null };
}

/** What is wrong with a bulk line for `use`: a frame that shows nothing, too few frames. */
export function bulkFxErrors(
  cut: { frames: Pixels[]; trail: Pixels[] },
  transparency: PictureTransparency,
  use: FxRunUse | undefined,
  fit: boolean,
): string {
  const errors: string[] = [];
  cut.frames.forEach((p, i) => {
    errors.push(...fxFrameReport(keyed(p, transparency), `Frame ${i + 1}`).errors);
  });
  cut.trail.forEach((p, i) => {
    errors.push(...fxFrameReport(keyed(p, transparency), `Trail frame ${i + 1}`).errors);
  });
  const fits = fit && use?.spell !== undefined && use.show === "point";
  if (fits && use && cut.frames.length < use.trigger) {
    errors.push(
      `spell ${use.spell} acts on frame ${use.trigger} of its effect, so its run needs at least ${use.trigger} frames`,
    );
  }
  const needs = shownCount(use, cut.frames.length, fits);
  if (use && cut.frames.length < needs) {
    errors.push(`${use.member} ${showsText(use)} but there are ${cut.frames.length}`);
  }
  const trailNeeds = use ? Math.min(use.trail, needs) : 0;
  if (cut.trail.length > 0 && cut.trail.length < trailNeeds) {
    errors.push(`its trail shows ${trailNeeds} frames but there are ${cut.trail.length}`);
  }
  return errors.join("; ");
}

export function createSpellEffects(opts: SpellEffectsOptions): SpellEffects {
  const decode = opts.decode ?? loadPixels;
  const el = document.createElement("div");
  el.className = "item-pictures spell-effects";
  let view: ContentFxArtView | null = null;
  let lines: FxBulkLine[] = [];
  const status = document.createElement("p");
  status.className = "item-art-status";
  status.setAttribute("role", "status");
  const rules = document.createElement("p");
  rules.className = "item-art-rules";
  rules.textContent = `${FX_RULES} For many runs at once, name each strip (Crush.png) or set of frames (Crush-1.png, and xCrush-1.png for its trail) after its run. A strip's cells must be square for its layout to be guessed; open the run to cut any other strip by hand.`;

  const files = action(document.createElement("input"), "fx-files");
  files.type = "file";
  files.multiple = true;
  files.accept = ".png,image/png";
  files.setAttribute("aria-label", "Effect strips and frames named after their runs");
  files.addEventListener("change", () => {
    const list = [...(files.files ?? [])];
    files.value = "";
    addFiles(list);
  });
  const nameListId = "fx-names";
  const nameList = document.createElement("datalist");
  nameList.id = nameListId;

  const lineUse = (l: FxBulkLine) =>
    view && l.match.kind === "run" ? fxUse(view, l.match.run) : undefined;
  const lineFits = (l: FxBulkLine) => {
    const use = lineUse(l);
    return use?.spell !== undefined && use.show === "point";
  };
  const lineCut = (l: FxBulkLine) => {
    if (l.raws === null) {
      return null;
    }
    return bulkFxFrames(
      l.files.map((f) => f.name),
      l.raws,
      { needs: lineUse(l)?.needs ?? 0, trail: lineUse(l)?.trail ?? 0 },
      l.match.kind === "run" ? l.match.run : undefined,
    );
  };
  const lineTransparency = (l: FxBulkLine): PictureTransparency => {
    const first = l.raws ? [...l.raws.values()].find((r) => r !== null) : null;
    return first ? guessTransparency(first) : "alpha";
  };

  const lineCheck = (l: FxBulkLine): string => {
    if (!view) {
      return "";
    }
    const sorted = fxFiles(
      l.files.map((f) => f.name),
      l.match.kind === "run" ? l.match.run : undefined,
    );
    if (sorted.kind === "bad") {
      return sorted.error;
    }
    if (l.raws === null) {
      return "Reading…";
    }
    if (l.match.kind === "none") {
      return l.match.why;
    }
    const cut = lineCut(l);
    if (!cut || "error" in cut) {
      return cut?.error ?? "Reading…";
    }
    const wrong = bulkFxErrors(cut, lineTransparency(l), lineUse(l), l.fit && lineFits(l));
    if (wrong) {
      return wrong;
    }
    // Lines clash by the run they write.
    const key = l.match.run.toLowerCase();
    if (
      lines.some(
        (o) => o !== l && !o.done && o.match.kind === "run" && o.match.run.toLowerCase() === key,
      )
    ) {
      return "Another line is for the same run: change one, or clear the list.";
    }
    return "";
  };

  const table = createTable<FxBulkLine>({
    label: "Effects to attach",
    empty: "No files chosen.",
    key: (l) => `${l.group.stem}:${lines.indexOf(l)}`,
    columns: [
      { label: "Files", cell: (l) => l.group.files.join(", ") },
      {
        label: "For",
        cell: (l) => {
          const input = action(document.createElement("input"), "fx-for");
          input.type = "text";
          input.setAttribute("list", nameListId);
          input.setAttribute("aria-label", `The run ${l.group.stem} is for`);
          input.value = l.name;
          input.disabled = attaching || l.done !== "";
          input.placeholder = "Not matched: a run's name";
          input.addEventListener("change", () => {
            l.name = input.value.trim();
            l.match = view ? matchFx(l.name, view) : { kind: "none", why: "" };
            redraw();
          });
          return input;
        },
      },
      {
        label: "Makes",
        cell: (l) => {
          if (l.done || !view || l.match.kind !== "run") {
            return "";
          }
          const text = fxRepaintText(view, l.match.run);
          if (!lineFits(l)) {
            return text;
          }
          const box = action(document.createElement("input"), "fx-fit");
          box.type = "checkbox";
          box.checked = l.fit;
          box.disabled = attaching;
          const use = lineUse(l);
          box.setAttribute("aria-label", `Spell ${use?.spell ?? ""} plays every frame`);
          box.addEventListener("change", () => {
            l.fit = box.checked;
            redraw();
          });
          const label = document.createElement("label");
          label.className = "item-art-check";
          label.append(box, ` spell ${use?.spell ?? ""} plays every frame`);
          const cell = document.createElement("div");
          cell.append(text, label);
          return cell;
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
    const added = groupFxFiles(list.map((f) => f.name)).map((group): FxBulkLine => {
      const match = matchFx(group.stem, v);
      return {
        group,
        files: group.files.map((n) => list.find((f) => f.name === n) as File),
        name: match.kind === "none" ? "" : group.stem,
        match,
        fit: true,
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
        ? `${unmatched.map((l) => (l.match as { why: string }).why).join(" ")} Pick ${unmatched.length === 1 ? "its run" : "theirs"} by hand.`
        : "Every file matches a run.";
    redraw();
  }

  const attach = panelButton("fx-attach", "Attach the effects", () => void attachAll(), "primary");
  let attaching = false;
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
    const spells: string[] = [];
    // What each line writes, and how, is fixed when Attach is pressed: a draft that changes while
    // the files upload (and re-matches the lines) changes nothing for this batch.
    const v = view;
    const jobs = lines
      .filter((x) => !x.done && lineCheck(x) === "" && x.match.kind === "run")
      .map((l) => {
        const run = (l.match as { run: string }).run;
        const use = fxUse(v, run);
        return {
          l,
          run,
          expect: artRowFingerprint(fxUpload(v, run)),
          seen: use?.users ?? [],
          fit: l.fit && lineFits(l),
          spell: use?.spell,
          effect: use?.effect ?? run,
          shows: { needs: use?.needs ?? 0, trail: use?.trail ?? 0 },
        };
      });
    try {
      for (const job of jobs) {
        if (mine !== batch) {
          return;
        }
        const r = await attachOne(job, mine);
        if (mine !== batch) {
          return;
        }
        job.l.done = r.ok ? r.text : `Not saved: ${r.text}`;
        saved += r.ok ? 1 : 0;
        if (r.ok && job.fit && job.spell !== undefined) {
          spells.push(job.spell);
        }
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
        : `${saved} run${saved === 1 ? " is" : "s are"} in the draft.`;
    if (saved > 0) {
      opts.saved(spells);
    }
  }

  async function attachOne(
    job: {
      l: FxBulkLine;
      run: string;
      expect: string | null;
      seen: string[];
      fit: boolean;
      effect: string;
      shows: { needs: number; trail: number };
    },
    mine: number,
  ): Promise<{ ok: boolean; text: string }> {
    const { l } = job;
    const names = l.files.map((f) => f.name);
    const sorted = fxFiles(names, job.run);
    const raws = l.raws;
    if (sorted.kind === "bad" || raws === null) {
      return { ok: false, text: sorted.kind === "bad" ? sorted.error : "Still reading the files." };
    }
    const cut = bulkFxFrames(names, raws, job.shows, job.run);
    if ("error" in cut) {
      return { ok: false, text: cut.error };
    }
    const transparency = lineTransparency(l);
    const anchor = runAnchor(
      cut.frames[0] ?? null,
      effectCentre(opts.assets, job.effect),
      transparency,
    );
    const ref = cut.frames[0] ?? null;
    let frames: FxFrameFile[] = [];
    let trail: FxFrameFile[] = [];
    if (sorted.kind === "sheet") {
      const layout = cut.layout as FxSheetLayout;
      const up = await opts.upload(l.files[0] as File);
      if (!up.ok) {
        return { ok: false, text: up.error };
      }
      const s = await opts.slice(up.stored.file, layout);
      if (!s.ok) {
        return { ok: false, text: s.error };
      }
      frames = s.frames.map((f) => ({ file: f, ...anchor }));
      trail = s.trail.map((f) => ({ file: f, ...anchor }));
    } else {
      for (const [list, into, pix] of [
        [sorted.frames, frames, cut.frames],
        [sorted.trail, trail, cut.trail],
      ] as const) {
        for (const [i, x] of list.entries()) {
          const up = await opts.upload(l.files.find((f) => f.name === x.file) as File);
          if (!up.ok) {
            return { ok: false, text: `${x.file}: ${up.error}` };
          }
          into.push({ file: up.stored.file, ...sizedAnchor(anchor, ref, pix[i] ?? null) });
        }
      }
    }
    // The list may have been cleared (or the page reset) while the files uploaded.
    if (mine !== batch) {
      return { ok: false, text: "The list was cleared." };
    }
    return opts.apply({
      op: "set",
      run: job.run,
      frames,
      trail: trail.length > 0 ? trail : null,
      transparency,
      seen: job.seen,
      expect: job.expect,
      ...(job.fit ? { fit: true } : {}),
    });
  }

  const clear = panelButton("fx-clear", "Clear the list", () => {
    batch += 1;
    lines = [];
    status.textContent = "";
    redraw();
  });

  const picker = createFxArtPicker(opts, "fx");
  const newBtn = panelButton("fx-new", "New effect", () => {
    if (view) {
      picker.show({ kind: "new" }, view);
      picker.el.scrollIntoView?.({ block: "nearest" });
    }
  });
  const runsTitle = document.createElement("h4");
  runsTitle.className = "item-art-title";
  const runs = createTable<FxListed>({
    label: "Effect runs",
    empty: "The content draws no effects.",
    key: (r) => r.member.toLowerCase(),
    open: {
      id: "fx-open",
      run: (r) => {
        if (view) {
          picker.show({ kind: "run", run: r.member }, view);
          picker.el.scrollIntoView?.({ block: "nearest" });
        }
      },
    },
    columns: [
      { label: "Run", cell: (r) => r.member },
      { label: "Drawn by", cell: (r) => fxUsersText(r.use) },
      { label: "Shows", cell: (r) => (r.use && r.use.needs > 0 ? String(r.use.needs) : "—") },
      {
        label: "Frames",
        cell: (r) => {
          if (!view) {
            return "";
          }
          const src = fxSource(view, r.member);
          return src.kind === "upload"
            ? `Your upload (${src.art.frames.length})`
            : src.kind === "pack"
              ? `The pack's (${src.frames})`
              : "None";
        },
      },
    ],
  });

  function redraw(): void {
    table.setRows(lines);
    attach.disabled = attaching || !lines.some((l) => !l.done && lineCheck(l) === "");
    files.disabled = attaching;
    clear.disabled = attaching;
    const all = view ? fxList(view) : [];
    const none = all.filter((r) => view && fxSource(view, r.member).kind === "none").length;
    runsTitle.textContent = `Effect runs (${all.length}${none > 0 ? `, ${none} with no frames` : ""})`;
    runs.setRows(all);
  }

  const row = document.createElement("div");
  row.className = "content-buttons";
  row.append(files, attach, clear);
  const newRow = document.createElement("div");
  newRow.className = "content-buttons";
  newRow.append(newBtn);
  el.append(rules, row, nameList, table.el, status, runsTitle, newRow, runs.el, picker.el);
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
      nameList.replaceChildren(
        ...knownRuns(v).map((n) => {
          const o = document.createElement("option");
          o.value = n;
          return o;
        }),
      );
      // Lines still waiting match against the draft as it is now.
      for (const l of lines) {
        if (!l.done && l.name) {
          l.match = matchFx(l.name, v);
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
