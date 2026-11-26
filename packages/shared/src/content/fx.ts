/**
 * Spell effect runs (issue #29, stage 5): who draws each run and how many frames, where an
 * uploaded frame's anchor goes by default, the strip sheet the Content page takes a run in, the
 * checks on each frame, and the draft rows a change writes.
 *
 * A run is named by its member: `Crush` draws `Crush-1` … `Crush-30`, and a trail `xFirebolt-1` …
 * follows a run whose effect has one. How many frames show is the engine's: a point run shows
 * frames 1 to its row's `lastFrame` (two a tick), a projectile cycles frames 1-3 as it flies, and
 * the engine's own runs (fishing, smithing, the slot machine, arrows, cannon shots) have fixed
 * lengths. Every FX member belongs to one spell row at most (the spells schema refuses
 * duplicates). Everything here is pure and takes content as data.
 */
import type { ArtFx } from "@secondstaronline/data";

import { ARROW_COLOURS } from "../rules/combat/attpower.ts";
import { lingoEq } from "../rules/core/lingo.ts";
import { fxTriggerFrame, OTHER_LAST_FRAME, TRAILS } from "../rules/spells/spellfx.ts";
import { faintEdges, type Pixels, visibleBounds } from "./picture.ts";
import { blankCell } from "./worn.ts";

// ---- what draws a run -------------------------------------------------------------------------

/** How a run's frames are shown. */
export type FxShow =
  /** Frames 1 to the spell row's `lastFrame`, then gone. */
  | "point"
  /** Frames 1, 2, 3, 1… while it flies along its row's axis. */
  | "projectile"
  /** A length the engine fixes (fishing, smithing, the slot machine, arrows, cannon shots). */
  | "engine"
  /** Never shown: a spell row with no `lastFrame` and no projectile (1.6's dead spells). */
  | "none";

/** One run the content or the engine draws. */
export interface FxRunUse {
  /** The member as content names it ("FireballL"). */
  member: string;
  /** The run it behaves as (its spell row's `effect`; the member itself otherwise). */
  effect: string;
  show: FxShow;
  /** The frames shown: 1 to `needs` (0 for a run never shown). */
  needs: number;
  /** The trail frames shown, `x<member>-1` …: 0 for a run with no trail. */
  trail: number;
  /**
   * The last frame its effect acts on (`FX_TRIGGER_FRAMES`): a spell's run that shows fewer never
   * hits, heals or does what the spell does. 0 for a run that only shows.
   */
  trigger: number;
  /** Who draws it, for messages: "spell Crush", "the casino's slot machine", "fishing". */
  users: string[];
  /** The spell (by key) whose `fx` row it is, if any. */
  spell?: string;
  /** A projectile's step per frame, from its row. */
  projectile?: { axis: "locH" | "locV"; px: number };
  /** Named by content (a spell row, gathering's sprinkle, the casino), not only the engine. */
  content: boolean;
  /** A harvest node's strike run (issue #41): content names it and its length, so its frames are checked. */
  strike?: true;
}

/** A spell's `fx` row, as the plan reads and writes it. */
export interface FxSpellRun {
  member: string;
  effect: string;
  frames: number;
  lastFrame: number | null;
  projectile: { axis: "locH" | "locV"; px: number } | null;
  [k: string]: unknown;
}

/** A spell row, as the plan reads and writes it. */
export interface FxSpellRow {
  name: string;
  display?: string;
  fx: FxSpellRun[];
  [k: string]: unknown;
}

/** What `fxRuns` reads. */
export interface FxContent {
  spells: { spells: readonly FxSpellRow[] };
  gather: {
    gathering: { fishing?: unknown; sprinkle?: { fx: string } };
    harvest: readonly { tile: string; strikeFx?: { fx: string; frames: number } }[];
  };
  casino: { slots?: { fx: string } };
  items: { items: readonly { name: string; retired?: boolean }[] };
  bindings: { cannon: { ammo?: string } };
}

/** A projectile cycles these frames as it flies. */
export const PROJECTILE_FRAMES = 3;
/** A cannon shot spins through these frames (`cannonballFrame`). */
export const CANNON_SHOT_FRAMES = 4;
/** An arrow shows one frame as it flies. */
export const ARROW_FRAMES = 1;

/** The trail frames a run of `effect` shows, given its own frames shown. */
function trailOf(effect: string, needs: number): number {
  const t = TRAILS[effect.toLowerCase()];
  return t === undefined ? 0 : Math.min(t, needs);
}

/** The frames a spell row shows, and how. */
export function spellRunShows(row: FxSpellRun): { show: FxShow; needs: number } {
  if (row.lastFrame !== null) {
    return { show: "point", needs: row.lastFrame };
  }
  if (row.projectile) {
    return { show: "projectile", needs: PROJECTILE_FRAMES };
  }
  return { show: "none", needs: 0 };
}

/** Every run the content and the engine draw, by member in lower case, in the order first named. */
export function fxRuns(data: FxContent): Map<string, FxRunUse> {
  const out = new Map<string, FxRunUse>();
  const note = (u: Omit<FxRunUse, "users">, who: string) => {
    const k = u.member.toLowerCase();
    const had = out.get(k);
    if (had) {
      if (!had.users.includes(who)) {
        had.users.push(who);
      }
      had.content ||= u.content;
      return;
    }
    out.set(k, { ...u, users: [who] });
  };
  for (const spell of data.spells.spells) {
    for (const row of spell.fx) {
      const { show, needs } = spellRunShows(row);
      note(
        {
          member: row.member,
          effect: row.effect,
          show,
          needs,
          trail: trailOf(row.effect, needs),
          trigger: fxTriggerFrame(row.effect),
          spell: spell.name,
          ...(row.projectile ? { projectile: row.projectile } : {}),
          content: true,
        },
        `spell ${spell.name}`,
      );
    }
  }
  // A name content gives an engine run: its length is the engine's (or its spell row's).
  const named = (name: string | undefined, who: string) => {
    if (!name) {
      return;
    }
    const fixed = OTHER_LAST_FRAME[name.toLowerCase()];
    note(
      {
        member: name,
        effect: name,
        show: fixed === undefined ? "none" : "engine",
        needs: fixed ?? 0,
        trail: 0,
        trigger: 0,
        content: true,
      },
      who,
    );
  };
  named(data.gather.gathering.sprinkle?.fx, "gathering's sprinkle");
  // A harvest node's strike run (issue #41) shows the frames its row asks for, like a point run.
  for (const node of data.gather.harvest) {
    if (node.strikeFx) {
      note(
        {
          member: node.strikeFx.fx,
          effect: node.strikeFx.fx,
          show: "point",
          needs: node.strikeFx.frames,
          trail: 0,
          trigger: 0,
          content: true,
          strike: true,
        },
        `harvesting tile ${node.tile}`,
      );
    }
  }
  named(data.casino.slots?.fx, "the casino's slot machine");
  // The engine's own runs, drawn by name while their mechanic is in the content.
  const engine = (member: string, needs: number, who: string) =>
    note(
      { member, effect: member, show: "engine", needs, trail: 0, trigger: 0, content: false },
      who,
    );
  if (data.gather.gathering.fishing) {
    engine("Fishing", OTHER_LAST_FRAME.fishing ?? 13, "fishing");
  }
  engine("BSmith", OTHER_LAST_FRAME.bsmith ?? 13, "smithing");
  for (const colour of ARROW_COLOURS) {
    // A retired arrow still fires while players hold copies, so it counts until it is removed.
    if (data.items.items.some((i) => lingoEq(i.name, `${colour} Arrows`))) {
      for (const d of ["L", "R", "U", "D"]) {
        engine(`${colour} Arrows${d}`, ARROW_FRAMES, `${colour} Arrows`);
      }
    }
  }
  if (data.bindings.cannon.ammo !== undefined) {
    for (const d of ["L", "R", "U", "D"]) {
      engine(`CannonballShot${d}`, CANNON_SHOT_FRAMES, "the Battleship's cannon");
    }
  }
  return out;
}

/** Who draws a run, every one named: "spell Crush", "fishing and gathering's sprinkle". */
export function fxUsersText(use: FxRunUse | undefined): string {
  const names = use?.users ?? [];
  if (names.length === 0) {
    return "nothing";
  }
  return names.length === 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** The runs a set of FX atlas keys draws, with how many frames of each (`crush-30` → crush: 30). */
export function fxFramesOf(keys: Iterable<string>): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  for (const k of keys) {
    const m = /^(.*)-(\d{1,2})$/.exec(k.toLowerCase());
    if (m) {
      const run = m[1] as string;
      const s = out.get(run) ?? new Set<number>();
      s.add(Number(m[2]));
      out.set(run, s);
    }
  }
  return out;
}

// ---- frames, the strip and the anchor ---------------------------------------------------------

/** The largest side an effect frame may have. */
export const FX_FRAME_MAX = 512;
/** The most frames a run (or its trail) may have (the art schema's limit). */
export const FX_RUN_MAX = 99;

/**
 * Where the target tile's centre is from an effect's point: a run placed at a click stands at the
 * character's point there (the tile's horizontal centre, 2 px above its top).
 */
export const FX_TILE_CENTRE = { x: 0, y: 18 } as const;

/**
 * Where a run's frames are anchored by default: the visible middle of `first` (the run's first
 * frame) goes where `centre` says, from the effect's point: the middle of the pack's first frame
 * of the run it behaves as, or the target tile's centre. Every frame of the run gets the same
 * anchor, so the animation keeps its own motion.
 */
export function defaultFxAnchor(
  first: Pixels | null,
  centre: { x: number; y: number } = FX_TILE_CENTRE,
): { regX: number; regY: number } {
  const b = first ? visibleBounds(first) : null;
  if (!first || !b) {
    const w = first?.width ?? 0;
    const h = first?.height ?? 0;
    return { regX: Math.floor(w / 2) - centre.x, regY: Math.floor(h / 2) - centre.y };
  }
  return {
    regX: b.x + Math.floor(b.w / 2) - centre.x,
    regY: b.y + Math.floor(b.h / 2) - centre.y,
  };
}

/** The visible middle of an atlas sprite (`[sheet, x, y, w, h, regX, regY]`), from its point. */
export function spriteCentre(s: readonly number[] | undefined): { x: number; y: number } | null {
  if (!s) {
    return null;
  }
  const [, , , w = 0, h = 0, regX = 0, regY = 0] = s;
  return { x: Math.floor(w / 2) - regX, y: Math.floor(h / 2) - regY };
}

/**
 * How a strip is laid out: rows of `across` equal cells, read left to right and top to bottom; the
 * run's frames fill its first `runRows` rows and its trail's the `trailRows` after them. Long runs
 * wrap onto more rows, so a strip stays within the 2048 px upload limit.
 */
export interface FxSheetLayout {
  across: number;
  runRows: number;
  trailRows: number;
}

/**
 * A strip's cell size in `layout`, every cell the same size and at most `FX_FRAME_MAX` a side. An
 * error when the sheet cannot be cut so.
 */
export function fxSheetCell(
  width: number,
  height: number,
  layout: FxSheetLayout,
): { w: number; h: number } | { error: string } {
  const { across, runRows, trailRows } = layout;
  if (!Number.isInteger(across) || across < 1 || across > FX_RUN_MAX) {
    return { error: `a strip has 1 to ${FX_RUN_MAX} frames across` };
  }
  if (!Number.isInteger(runRows) || runRows < 1 || !Number.isInteger(trailRows) || trailRows < 0) {
    return { error: "a strip has at least one row for the run, and any number for its trail" };
  }
  const rows = runRows + trailRows;
  if (width === 0 || height === 0 || width % across !== 0 || height % rows !== 0) {
    return {
      error: `the sheet is ${width}×${height}; ${rows} row${rows === 1 ? "" : "s"} of ${across} frame${across === 1 ? "" : "s"} needs its width to divide by ${across} and its height by ${rows}`,
    };
  }
  const w = width / across;
  const h = height / rows;
  if (w > FX_FRAME_MAX || h > FX_FRAME_MAX) {
    return {
      error: `the sheet's cells are ${w}×${h}; effect frames may be at most ${FX_FRAME_MAX}×${FX_FRAME_MAX}`,
    };
  }
  return { w, h };
}

/** The smallest square cell a strip's layout is guessed with (smaller ones are typed in). */
const GUESS_MIN_CELL = 8;

/**
 * The layout a strip of `width`×`height` most likely has: square cells, the run's rows holding
 * the `needs` frames it shows (and, when it shows a trail, rows for the trail after them). With
 * nothing to go by, one row. Null when no square cells fit.
 */
export function guessFxSheet(
  width: number,
  height: number,
  needs: number,
  trail: number,
): FxSheetLayout | null {
  let best: { layout: FxSheetLayout; score: number } | null = null;
  for (let across = 1; across <= FX_RUN_MAX; across++) {
    if (width % across !== 0) {
      continue;
    }
    const s = width / across;
    if (s > FX_FRAME_MAX || s < GUESS_MIN_CELL || height % s !== 0) {
      continue;
    }
    const rows = height / s;
    // More cells than a run and its trail can hold is not a strip of square frames.
    if (across * rows > 2 * FX_RUN_MAX) {
      continue;
    }
    const options: FxSheetLayout[] = [{ across, runRows: rows, trailRows: 0 }];
    if (needs > 0 && trail > 0) {
      const runRows = Math.ceil(needs / across);
      if (runRows >= 1 && runRows < rows) {
        options.push({ across, runRows, trailRows: rows - runRows });
      }
    }
    for (const layout of options) {
      const cells = layout.across * layout.runRows;
      // Rows that just hold the frames shown fit best; then a trail; then larger cells.
      const fits = needs > 0 ? cells >= needs && cells - layout.across < needs : rows === 1;
      // Short of an exact fit, the cell count nearest the frames shown (a run being shortened).
      const near = needs > 0 ? -Math.abs(cells - needs) / 1000 : 0;
      const score = (fits ? 4 : 0) + (layout.trailRows > 0 ? 2 : 0) + near + s / 1_000_000;
      if (!best || score > best.score) {
        best = { layout, score };
      }
    }
  }
  return best?.layout ?? null;
}

/** Where cell `i` (0-based, reading order from `row`) is on a strip `across` cells wide. */
export const fxCell = (i: number, row: number, cell: { w: number; h: number }, across = 1) => ({
  x: (i % across) * cell.w,
  y: (row + Math.floor(i / across)) * cell.h,
});

/** Cuts cell `i` (reading order from `row`) out of a strip. */
export function cutFxCell(
  sheet: Pixels,
  i: number,
  row: number,
  cell: { w: number; h: number },
  across = Math.max(1, Math.floor(sheet.width / cell.w)),
): Pixels {
  const { x, y } = fxCell(i, row, cell, across);
  const data = new Uint8Array(cell.w * cell.h * 4);
  for (let dy = 0; dy < cell.h; dy++) {
    const from = ((y + dy) * sheet.width + x) * 4;
    data.set(sheet.data.subarray(from, from + cell.w * 4), dy * cell.w * 4);
  }
  return { width: cell.w, height: cell.h, data };
}

/** Whether a cell shows nothing, whichever way its transparency is read. */
const blank = (img: Pixels) => blankCell(img);

/**
 * A strip's frames: the run's cells, then the trail's, each in reading order. Trailing blank cells
 * are dropped (a run that does not fill its last row, a trail shorter than its run), and a blank
 * cell before the last drawn one is an error (every frame of a run is drawn).
 */
export function stripFrames(
  sheet: Pixels,
  cell: { w: number; h: number },
  layout: FxSheetLayout,
): { frames: Pixels[]; trail: Pixels[] } | { error: string } {
  const across = layout.across;
  const block = (fromRow: number, rows: number, what: string): Pixels[] | string => {
    const cells = Array.from({ length: across * rows }, (_, i) =>
      cutFxCell(sheet, i, fromRow, cell, across),
    );
    let last = cells.length - 1;
    while (last >= 0 && blank(cells[last] as Pixels)) {
      last -= 1;
    }
    const kept = cells.slice(0, last + 1);
    const gap = kept.findIndex(blank);
    if (gap >= 0) {
      return `${what} ${gap + 1} of the strip shows nothing: every frame of a run is drawn`;
    }
    if (kept.length > FX_RUN_MAX) {
      return `the strip has ${kept.length} ${what}s; a run has at most ${FX_RUN_MAX}`;
    }
    return kept;
  };
  const frames = block(0, layout.runRows, "frame");
  if (typeof frames === "string") {
    return { error: frames };
  }
  if (frames.length === 0) {
    return { error: "the strip's run rows show nothing" };
  }
  const trail = layout.trailRows > 0 ? block(layout.runRows, layout.trailRows, "trail frame") : [];
  if (typeof trail === "string") {
    return { error: trail };
  }
  return { frames, trail };
}

/** A frame file's name: `Crush-3.png` is frame 3 of Crush, `xFirebolt-2.png` a trail frame. */
export function fxFrameFileName(file: string): { stem: string; n: number } | null {
  const m = /^(.+)-(\d{1,2})\.png$/i.exec(file.trim());
  if (!m) {
    return null;
  }
  const n = Number(m[2]);
  return n >= 1 && n <= FX_RUN_MAX ? { stem: (m[1] as string).trim(), n } : null;
}

// ---- checks -----------------------------------------------------------------------------------

/** What the Content page says about one effect frame before it is saved. */
export interface FxFrameReport {
  errors: string[];
  warnings: string[];
}

/** Checks one frame, already keyed with its transparency: its size and whether anything shows. */
export function fxFrameReport(img: Pixels, label: string): FxFrameReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (img.width > FX_FRAME_MAX || img.height > FX_FRAME_MAX) {
    errors.push(
      `${label} is ${img.width}×${img.height}; effect frames may be at most ${FX_FRAME_MAX}×${FX_FRAME_MAX}`,
    );
  }
  const b = visibleBounds(img);
  if (b === null) {
    errors.push(`${label} shows nothing: every frame of a run is drawn`);
  } else {
    const faint = faintEdges(img, b);
    if (faint.length > 0) {
      warnings.push(
        `${label}'s ${faint.join(", ")} edge${faint.length === 1 ? " is" : "s are"} nearly invisible but still hits`,
      );
    }
  }
  return { errors, warnings };
}

/**
 * The frames a run would show once saved: with `fit` (from its spell's row, a point run plays all
 * it has), the upload's count; otherwise what its use shows.
 */
export function fxNeedsAfter(use: FxRunUse | undefined, count: number, fit: boolean): number {
  if (!use) {
    return 0;
  }
  return fit && use.show === "point" ? count : use.needs;
}

/** Whether `fit` would change the run's spell row (its `lastFrame` or `frames`). */
export function fitChanges(use: FxRunUse | undefined, row: FxSpellRun | undefined, count: number) {
  if (!use || !row) {
    return false;
  }
  return (use.show === "point" && row.lastFrame !== count) || row.frames !== count;
}

// ---- changes ----------------------------------------------------------------------------------

/**
 * A short fingerprint of an art row as a panel saw it (null for none), so a save made over another
 * admin's newer one is refused instead of overwriting it. FNV-1a over the row's JSON.
 */
export function artRowFingerprint(row: unknown): string | null {
  if (row === undefined || row === null) {
    return null;
  }
  const text = JSON.stringify(row);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** A frame being saved: its stored file and its anchor. */
export interface FxFrameFile {
  file: string;
  regX: number;
  regY: number;
}

/** One effect run change, as the Content page asks for it. */
export type FxChange =
  | {
      /** Paint a run: its frames, and its trail (null for none: the pack's trail, if any, shows). */
      op: "set";
      run: string;
      frames: FxFrameFile[];
      trail: FxFrameFile[] | null;
      transparency: "alpha" | "green";
      /** Who the panel said draws the run: refused if that has changed since. */
      seen: string[];
      /**
       * From the run's spell: its row plays every uploaded frame (a point run's `lastFrame`, and
       * any run's `frames`, become the upload's count).
       */
      fit?: boolean;
      /** The run's upload as the panel saw it (`artRowFingerprint`; null for none). */
      expect?: string | null;
    }
  /** Take a run's upload out (a pack's run of that name comes back). */
  | { op: "remove"; run: string; expect?: string | null };

/** One row an effect change writes. */
export type FxRowChange =
  | {
      ref: { dataset: "art"; part: "fx"; key: string };
      op: "set" | "remove";
      data: ArtFx | null;
    }
  | {
      ref: { dataset: "spells"; part: "spells"; key: string };
      op: "set";
      data: FxSpellRow;
    };

/** What an effect plan reads: the draft's runs, spells and uploads, and the pack's runs. */
export interface FxPlanInput {
  runs: ReadonlyMap<string, FxRunUse>;
  spells: readonly FxSpellRow[];
  art: readonly ArtFx[];
  /** The runs the installed packs draw, by lower-case member. */
  packRuns: ReadonlySet<string>;
}

const sameSet = (a: readonly string[], b: readonly string[]) => {
  const x = a.map((s) => s.toLowerCase()).sort();
  const y = b.map((s) => s.toLowerCase()).sort();
  return x.length === y.length && x.every((s, i) => s === y[i]);
};

/** Why a run's name cannot hold its frames (or its trail), or null when it can. */
export function fxNameClash(
  run: string,
  withTrail: boolean,
  input: Pick<FxPlanInput, "runs" | "art" | "packRuns">,
): string | null {
  const name = run.trim();
  if (name === "" || name.length > 80) {
    return "A run's name is 1 to 80 characters.";
  }
  if (/-\d+$/.test(name)) {
    return `${name} ends in a frame number: name the run without it.`;
  }
  const known = (n: string) => {
    const k = n.toLowerCase();
    return input.runs.has(k) || input.packRuns.has(k) || input.art.some((a) => lingoEq(a.name, n));
  };
  // `xName` is Name's trail: a run of that name and a trail of Name would draw the same frames.
  const m = /^x(.+)$/i.exec(name);
  if (m && known(m[1] as string)) {
    const base = m[1] as string;
    const hasTrail =
      input.art.some((a) => lingoEq(a.name, base) && a.trail !== undefined) ||
      (input.runs.get(base.toLowerCase())?.trail ?? 0) > 0;
    if (hasTrail) {
      return `${name} is ${base}'s trail: upload it as ${base}'s trail instead.`;
    }
  }
  // A pack's `xName` beside its Name is Name's own trail; a run content draws or an upload of
  // that name is another run.
  const own = `x${name}`;
  if (
    withTrail &&
    (input.runs.has(own.toLowerCase()) || input.art.some((a) => lingoEq(a.name, own)))
  ) {
    return `x${name} is a run of its own, so ${name} cannot have a trail.`;
  }
  return null;
}

/**
 * The rows an effect change writes, against the draft. An upload replaces the run's whole row; from
 * its spell (`fit`), the spell's row plays every uploaded frame in the same change. A run shown
 * for more frames than the upload has is refused, so a pack's frames never fill the gap.
 */
export function planFx(
  change: FxChange,
  input: FxPlanInput,
): { ok: true; run: string; rows: FxRowChange[] } | { ok: false; error: string } {
  const own = input.art.find((a) => lingoEq(a.name, change.run.trim()));
  // Saved over another admin's newer upload of the run: refused, so neither overwrites the other.
  if (change.expect !== undefined && artRowFingerprint(own) !== change.expect) {
    return {
      ok: false,
      error: `${own?.name ?? change.run}'s upload changed since you opened it (someone else saved it): reopen it to see it before saving.`,
    };
  }
  if (change.op === "remove") {
    return own
      ? {
          ok: true,
          run: own.name,
          rows: [{ ref: artRef(own.name), op: "remove", data: null }],
        }
      : { ok: false, error: `${change.run} has no upload to take out.` };
  }
  const run = change.run.trim();
  const clash = fxNameClash(run, change.trail !== null && change.trail.length > 0, input);
  if (clash) {
    return { ok: false, error: clash };
  }
  if (change.frames.length < 1 || change.frames.length > FX_RUN_MAX) {
    return { ok: false, error: `A run has 1 to ${FX_RUN_MAX} frames.` };
  }
  if (change.trail !== null && (change.trail.length < 1 || change.trail.length > FX_RUN_MAX)) {
    return { ok: false, error: `A trail has 1 to ${FX_RUN_MAX} frames.` };
  }
  const use = input.runs.get(run.toLowerCase());
  // The panel listed who draws the run: a repaint for someone it did not name is refused.
  if (!sameSet(use?.users ?? [], change.seen)) {
    return {
      ok: false,
      error: `${run} is now drawn by ${fxUsersText(use)}: reopen it to see who a repaint changes.`,
    };
  }
  const count = change.frames.length;
  const rows: FxRowChange[] = [];
  let needs = use?.needs ?? 0;
  if (change.fit) {
    const spell = use?.spell
      ? input.spells.find((s) => lingoEq(s.name, use.spell as string))
      : undefined;
    const row = spell?.fx.find((f) => lingoEq(f.member, run));
    if (!spell || !row || !use) {
      return { ok: false, error: `No spell's row draws ${run}, so there is no length to fit.` };
    }
    if (use.show === "point") {
      // Shortened below the frame its effect acts on, the spell would stop working.
      if (count < use.trigger) {
        return {
          ok: false,
          error: `Spell ${use.spell} acts on frame ${use.trigger} of its effect (${use.effect}), so its run needs at least ${use.trigger} frames: add frames, or keep it showing ${use.needs}.`,
        };
      }
      needs = count;
    }
    if (fitChanges(use, row, count)) {
      rows.push({
        ref: { dataset: "spells", part: "spells", key: spell.name },
        op: "set",
        data: {
          ...spell,
          fx: spell.fx.map((f) =>
            f === row
              ? { ...f, frames: count, ...(use.show === "point" ? { lastFrame: count } : {}) }
              : f,
          ),
        },
      });
    }
  }
  if (count < needs) {
    return {
      ok: false,
      error: `${run} shows ${needs} frames but the upload has ${count}${use?.spell && use.show === "point" ? `: add frames, or let spell ${use.spell} play only ${count}` : ""}.`,
    };
  }
  const trailNeeds = trailOf(use?.effect ?? run, needs);
  if (change.trail !== null && change.trail.length < trailNeeds) {
    return {
      ok: false,
      error: `${run}'s trail shows ${trailNeeds} frames but the upload has ${change.trail.length}.`,
    };
  }
  const anchored = (f: FxFrameFile) => ({ file: f.file, regX: f.regX, regY: f.regY });
  const name = own?.name ?? use?.member ?? run;
  rows.unshift({
    ref: artRef(name),
    op: "set",
    data: {
      name,
      frames: change.frames.map(anchored),
      ...(change.trail !== null ? { trail: change.trail.map(anchored) } : {}),
      ...(change.transparency === "green" ? { transparency: "green" as const } : {}),
    },
  });
  return { ok: true, run: name, rows };
}

const artRef = (key: string) => ({ dataset: "art" as const, part: "fx" as const, key });

/**
 * The runs a removed spell drew that nothing else draws once it is gone (its uploads go with it):
 * `runs` is what the content draws without the spell.
 */
export function orphanedFxUploads(
  spell: FxSpellRow,
  art: readonly ArtFx[],
  runs: ReadonlyMap<string, FxRunUse>,
): string[] {
  return spell.fx.flatMap((f) => {
    const a = art.find((x) => lingoEq(x.name, f.member));
    return a && !runs.has(a.name.toLowerCase()) ? [a.name] : [];
  });
}

/**
 * Spell runs that hide before the frame their effect acts on (a row's `lastFrame` below
 * `FX_TRIGGER_FRAMES`): the spell would cast and do nothing. With `before`, only the runs that
 * were not short there are told (the change being checked made them short).
 */
export function fxTriggerProblems(
  data: FxContent,
  before?: FxContent,
): { where: string; message: string }[] {
  const was = before ? fxRuns(before) : null;
  const out: { where: string; message: string }[] = [];
  for (const use of fxRuns(data).values()) {
    if (use.spell === undefined || use.show !== "point" || use.needs >= use.trigger) {
      continue;
    }
    const old = was?.get(use.member.toLowerCase());
    if (old && old.show === "point" && old.needs < old.trigger) {
      continue;
    }
    out.push({
      where: `spells/spells/${use.spell}`,
      message: `${use.member} shows ${use.needs} frames, but its effect (${use.effect}) acts on frame ${use.trigger}: spell ${use.spell} would do nothing`,
    });
  }
  return out;
}
