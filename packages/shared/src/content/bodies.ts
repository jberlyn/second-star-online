/**
 * Monster body frame sets (issue #29, stage 4): who draws each body number, the sheet the Content
 * page takes a body in, where a frame's anchor goes by default, how north frames are flipped, the
 * checks on each frame, and the draft rows a change writes.
 *
 * A body is named by its number (`55` draws `55-f2-s` …). Every walk and attack frame is needed,
 * each anchored at the walker's point (the tile's horizontal centre, 2 px above its top, where a
 * player's 46×45 character is pasted at 25, 6). Uploaded bodies are numbered by the server, from
 * 1000, so an operator never types one. Everything here is pure and takes content as data.
 */
import type { ArtBody, ArtFrameId } from "@secondstaronline/data";

import { lingoEq } from "../rules/core/lingo.ts";
import { PAPERDOLL_REG, PAPERDOLL_SIZE } from "../rules/inventory/paperdoll.ts";
import { faintEdges, type Pixels, visibleBounds } from "./picture.ts";
import { ALL_FRAME_IDS, WORN_FACINGS, WORN_STEPS } from "./worn.ts";

// ---- numbers and who draws them ---------------------------------------------------------------

/** Body numbers run 1 to 9999 everywhere (`BODY_MAX` in the data schema). */
export const BODY_NUMBER_MAX = 9999;

/** Whether a value is a body number (1 to 9999). */
export const isBodyNumber = (n: unknown): n is number =>
  typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= BODY_NUMBER_MAX;

/** One body the content draws, and who draws it. */
export interface BodyUse {
  body: number;
  /** Who draws it, for messages: "monster Orc", "the Morph bodies", "the Boat". */
  users: string[];
  /** The monsters (by key) whose body it is. */
  monsters: string[];
}

/** What `bodyUses` reads. */
export interface BodyContent {
  monsters: {
    monsters: readonly { name: string; body: number }[];
    generic: { body: number };
  };
  bindings: {
    bodies?: {
      morph?: readonly { body: number }[];
      tree?: number;
    };
  };
  /** The vehicles' rider bodies (issue #44). */
  houses?: { vehicles?: readonly { name: string; rider: number }[] };
}

/** Every body the content draws, by number, in the order first named. */
export function bodyUses(data: BodyContent): Map<number, BodyUse> {
  const out = new Map<number, BodyUse>();
  const note = (body: number | undefined, who: string, monster?: string) => {
    if (body === undefined || !isBodyNumber(body)) {
      return;
    }
    let u = out.get(body);
    if (!u) {
      u = { body, users: [], monsters: [] };
      out.set(body, u);
    }
    if (!u.users.includes(who)) {
      u.users.push(who);
    }
    if (monster !== undefined) {
      u.monsters.push(monster);
    }
  };
  for (const m of data.monsters.monsters) {
    note(m.body, `monster ${m.name}`, m.name);
  }
  note(data.monsters.generic.body, "the generic monster");
  const b = data.bindings.bodies;
  for (const row of b?.morph ?? []) {
    note(row.body, "the Morph bodies");
  }
  note(b?.tree, "the tree body");
  for (const v of data.houses?.vehicles ?? []) {
    note(v.rider, `the ${v.name}`);
  }
  return out;
}

/** Who draws a body, for messages: "monster Orc, monster Goblin and 2 more", "nothing". */
export function bodyUsersText(use: BodyUse | undefined, except?: string): string {
  const names = (use?.users ?? []).filter((n) => except === undefined || !lingoEq(n, except));
  if (names.length === 0) {
    return "nothing";
  }
  const shown = names.slice(0, 3);
  const more = names.length - shown.length;
  if (more > 0) {
    return `${shown.join(", ")} and ${more} more`;
  }
  return shown.length === 1
    ? (shown[0] ?? "")
    : `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}`;
}

/** The body numbers a set of atlas keys draws (`55-f2-s` → 55; FX-like names are skipped). */
export function bodyNumbersOf(keys: Iterable<string>): Set<number> {
  const out = new Set<number>();
  for (const k of keys) {
    const m = /^(\d{1,4})-f[1-4]-[nesw]$/i.exec(k);
    if (m) {
      out.add(Number(m[1]));
    }
  }
  return out;
}

// ---- frames, the sheet and the anchor ---------------------------------------------------------

/** Every frame a body needs: walking F1-F3 and attacking F4, facing every way. */
export const BODY_FRAMES: readonly ArtFrameId[] = ALL_FRAME_IDS;

/** The largest side a body frame may have. */
export const BODY_FRAME_MAX = 512;

/** The guide sheet: four rows (N, E, S, W) of four frames (F1-F4), each the player's 46×45. */
export const BODY_GUIDE_CELL = PAPERDOLL_SIZE;

/**
 * A body sheet's cell size: the sheet is four rows (N, E, S, W) of four frames (F1-F4), every
 * cell the same size, at most `BODY_FRAME_MAX` a side. An error when the sheet cannot be cut so.
 */
export function bodySheetCell(
  width: number,
  height: number,
): { w: number; h: number } | { error: string } {
  const cols = WORN_STEPS.length;
  const rows = WORN_FACINGS.length;
  if (width % cols !== 0 || height % rows !== 0 || width === 0 || height === 0) {
    return {
      error: `the sheet is ${width}×${height}; a body sheet is four rows (north, east, south, west) of four frames (F1 to F4), so its width and height divide by 4`,
    };
  }
  const w = width / cols;
  const h = height / rows;
  if (w > BODY_FRAME_MAX || h > BODY_FRAME_MAX) {
    return {
      error: `the sheet's cells are ${w}×${h}; body frames may be at most ${BODY_FRAME_MAX}×${BODY_FRAME_MAX}`,
    };
  }
  return { w, h };
}

/**
 * Where a body frame's anchor goes by default: it stands where a player's character stands. A
 * frame's horizontal centre is 2 px left of the walker's point and its bottom 39 px below it, so a
 * 46×45 frame lands exactly where the paperdoll does (25, 6).
 */
export function defaultBodyAnchor(w: number, h: number): { regX: number; regY: number } {
  return {
    regX: Math.floor(w / 2) + (PAPERDOLL_REG.x - Math.floor(PAPERDOLL_SIZE.w / 2)),
    regY: h - (PAPERDOLL_SIZE.h - PAPERDOLL_REG.y),
  };
}

// ---- mirrored north frames --------------------------------------------------------------------

/**
 * Twice the figure's centre line, measured from the anchor (`centreLine2` in the asset build):
 * twice the mean x of the visible pixel centres less regX, rounded, so a flip about it maps whole
 * pixels to whole pixels. A body's north frames all flip about the line of its standing frame,
 * F2-N, so its walk and attack frames stay in step.
 */
export function bodyCentreLine2(img: Pixels, regX: number): number {
  let sum = 0;
  let n = 0;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.data[(y * img.width + x) * 4 + 3]) {
        sum += x + 0.5;
        n += 1;
      }
    }
  }
  return n === 0 ? 0 : Math.round(2 * (sum / n - regX));
}

/** A body frame flipped about its centre line (`mirrorBody` in the asset build). */
export function mirrorBodyFrame(
  img: Pixels,
  regX: number,
  line2: number,
): { img: Pixels; regX: number } {
  const out = new Uint8Array(img.width * img.height * 4);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const from = (y * img.width + x) * 4;
      out.set(img.data.subarray(from, from + 4), (y * img.width + img.width - 1 - x) * 4);
    }
  }
  return {
    img: { width: img.width, height: img.height, data: out },
    regX: img.width - regX - line2,
  };
}

// ---- checks -----------------------------------------------------------------------------------

/** What the Content page says about one body frame before it is saved. */
export interface BodyFrameReport {
  errors: string[];
  warnings: string[];
}

/** Checks one frame, already keyed with its transparency: its size and whether anything shows. */
export function bodyFrameReport(img: Pixels, id: ArtFrameId): BodyFrameReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (img.width > BODY_FRAME_MAX || img.height > BODY_FRAME_MAX) {
    errors.push(
      `${id} is ${img.width}×${img.height}; body frames may be at most ${BODY_FRAME_MAX}×${BODY_FRAME_MAX}`,
    );
  }
  const b = visibleBounds(img);
  if (b === null) {
    errors.push(`${id} shows nothing: every frame of a body is drawn`);
  } else {
    const faint = faintEdges(img, b);
    if (faint.length > 0) {
      warnings.push(
        `${id}'s ${faint.join(", ")} edge${faint.length === 1 ? " is" : "s are"} nearly invisible but still clickable`,
      );
    }
  }
  return { errors, warnings };
}

/** The frames a body lacks: every one of the 16 is drawn. */
export const missingBodyFrames = (frames: Partial<Record<ArtFrameId, unknown>>): ArtFrameId[] =>
  BODY_FRAMES.filter((f) => !frames[f]);

// ---- changes ----------------------------------------------------------------------------------

/** A frame being saved: its stored file and its anchor. */
export interface BodyFrameFile {
  file: string;
  regX: number;
  regY: number;
}

/** How a body's frames are saved: every frame, `mirrored`, the transparency. */
export interface BodyFrameSet {
  frames: Partial<Record<ArtFrameId, BodyFrameFile>>;
  mirrored: boolean;
  transparency: "alpha" | "green";
}

/** One body change, as the Content page asks for it. */
export type BodyChange =
  /**
   * Paint a body that exists (a pack's, an upload's, or one content names). With `owner`, it is
   * that monster's own body being replaced: refused unless the monster still draws it alone.
   */
  | ({ op: "set"; body: number; owner?: string } & BodyFrameSet)
  /** A body under the next free number, given to a monster when one is named. */
  | ({ op: "new"; monster?: string; from?: number } & BodyFrameSet)
  /** Take a body's upload out (a pack's picture of that number comes back). */
  | { op: "remove"; body: number }
  /** Give a monster another body that exists. */
  | { op: "choose"; monster: string; body: number; from?: number };

/** A monster row as the plan reads and writes it. */
export interface BodyMonsterRow {
  name: string;
  body: number;
  [k: string]: unknown;
}

/** One row a body change writes. */
export type BodyRowChange =
  | {
      ref: { dataset: "art"; part: "bodies"; key: string };
      op: "set" | "remove";
      data: ArtBody | null;
    }
  | {
      ref: { dataset: "monsters"; part: "monsters"; key: string };
      op: "set";
      data: BodyMonsterRow;
    };

/** What a body plan reads: the draft's monsters and uploads, and which numbers exist. */
export interface BodyPlanInput {
  monsters: readonly BodyMonsterRow[];
  art: readonly ArtBody[];
  /** Whether a body has a picture once the draft is published (a pack's or an upload's). */
  exists(body: number): boolean;
  /** The number a new body takes (the first free one from 1000), or null with none left. */
  nextNumber: number | null;
  /** What a new body is told when every number is taken. */
  noNumbers: string;
  /** Who draws each body in the draft (for a replacement of a monster's own body). */
  uses?: (body: number) => BodyUse | undefined;
}

/**
 * The rows a body change writes, against the draft. An upload replaces the body's whole row (all
 * 16 frames); a new body takes `nextNumber` and, given a monster, becomes its body in the same
 * change.
 */
export function planBody(
  change: BodyChange,
  input: BodyPlanInput,
): { ok: true; body: number; rows: BodyRowChange[] } | { ok: false; error: string } {
  const monster = (name: string) => input.monsters.find((m) => lingoEq(m.name, name));
  if (change.op === "choose") {
    const m = monster(change.monster);
    if (!m) {
      return { ok: false, error: `There is no monster ${change.monster}.` };
    }
    // The body the panel showed it with (issue #31): another's change since is not undone.
    if (change.from !== undefined && m.body !== change.from) {
      return {
        ok: false,
        error: `${m.name} draws body ${m.body} now, not ${change.from}: someone changed it since you opened it. Look at it again.`,
      };
    }
    if (!isBodyNumber(change.body)) {
      return { ok: false, error: `Body numbers run 1 to ${BODY_NUMBER_MAX}.` };
    }
    if (!input.exists(change.body)) {
      return { ok: false, error: `Body ${change.body} has no picture.` };
    }
    return {
      ok: true,
      body: change.body,
      rows: [monsterRow({ ...m, body: change.body })],
    };
  }
  if (change.op === "remove") {
    const own = input.art.find((a) => a.name === String(change.body));
    return own
      ? { ok: true, body: change.body, rows: [{ ref: artRef(own.name), op: "remove", data: null }] }
      : { ok: false, error: `Body ${change.body} has no upload to take out.` };
  }
  const missing = missingBodyFrames(change.frames);
  if (missing.length > 0) {
    return { ok: false, error: `A body needs all 16 frames; missing ${missing.join(", ")}.` };
  }
  const frames: ArtBody["frames"] = {};
  for (const id of BODY_FRAMES) {
    const f = change.frames[id] as BodyFrameFile;
    frames[id] = { file: f.file, regX: f.regX, regY: f.regY };
  }
  const settings = {
    ...(change.mirrored ? { mirrored: true as const } : {}),
    ...(change.transparency === "green" ? { transparency: "green" as const } : {}),
  };
  if (change.op === "set") {
    if (!isBodyNumber(change.body)) {
      return { ok: false, error: `Body numbers run 1 to ${BODY_NUMBER_MAX}.` };
    }
    if (change.owner !== undefined) {
      // A monster's own body, as the page saw it: still its body, and still drawn by it alone.
      const m = monster(change.owner);
      if (!m) {
        return { ok: false, error: `There is no monster ${change.owner}.` };
      }
      if (m.body !== change.body) {
        return {
          ok: false,
          error: `${m.name} no longer draws body ${change.body} (it draws ${m.body} now): reopen its row.`,
        };
      }
      const others = (input.uses?.(change.body)?.users ?? []).filter(
        (u) => !lingoEq(u, `monster ${m.name}`),
      );
      if (others.length > 0) {
        return {
          ok: false,
          error: `Body ${change.body} is now also drawn by ${others.join(", ")}: reopen ${m.name}'s row to give it a new body, or repaint body ${change.body} for everyone.`,
        };
      }
    }
    const name = String(change.body);
    return {
      ok: true,
      body: change.body,
      rows: [{ ref: artRef(name), op: "set", data: { name, frames, ...settings } }],
    };
  }
  const m = change.monster === undefined ? undefined : monster(change.monster);
  if (change.monster !== undefined && !m) {
    return { ok: false, error: `There is no monster ${change.monster}.` };
  }
  if (m && change.from !== undefined && m.body !== change.from) {
    return {
      ok: false,
      error: `${m.name} draws body ${m.body} now, not ${change.from}: someone changed it since you opened it. Look at it again.`,
    };
  }
  if (input.nextNumber === null) {
    return { ok: false, error: input.noNumbers };
  }
  const body = input.nextNumber;
  const name = String(body);
  const rows: BodyRowChange[] = [
    { ref: artRef(name), op: "set", data: { name, frames, ...settings } },
  ];
  if (m) {
    rows.push(monsterRow({ ...m, body }));
  }
  return { ok: true, body, rows };
}

const artRef = (key: string) => ({ dataset: "art" as const, part: "bodies" as const, key });

function monsterRow(m: BodyMonsterRow): BodyRowChange {
  return { ref: { dataset: "monsters", part: "monsters", key: m.name }, op: "set", data: m };
}
