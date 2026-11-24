/**
 * Uploaded art and sounds (issue #29): checking an upload, checking the `art` dataset's rows
 * before a publish, and building the operator's atlases and hit rects from them.
 *
 * An upload is checked when it arrives (a PNG any art tool exports, or a WAV, MP3 or OGG) and
 * stored by its hash; the rows that name it are checked again at publish (every file there, every
 * frame the right shape). The build turns the rows into one atlas per group, the same way the
 * asset build packs the shipped packs: each image keyed (its alpha, or 1.6's green), north frames
 * marked `mirrored` flipped, items, bodies and FX trimmed to their visible pixels (so a sprite's
 * hit rect is what you see, as Director cropped 1.6's members), then packed. The same input
 * always gives the same sheets, named by their hash.
 */
import { createHash } from "node:crypto";

import type {
  ArtData,
  ArtFrameId,
  AtlasGroup,
  AtlasIndex,
  AtlasSprite,
  MemberRect,
  PackArtIndex,
  RectsData,
} from "@secondstaronline/data";
import {
  applyKey,
  blit,
  centreLine2,
  createRgba,
  decodePng,
  encodePng,
  GREEN,
  MAX_SHEET,
  mirrorBody,
  mirrorPaperdoll,
  pack,
  type Rgba,
} from "@secondstaronline/data/art";
import { ART_FRAME_IDS, type ArtSoundFormat } from "@secondstaronline/data/schema";
import {
  ALL_FRAME_IDS,
  BODY_FRAMES,
  blankCell,
  bodySheetCell,
  cutCell,
  type FxSheetLayout,
  fxSheetCell,
  stripFrames,
  tileShows,
  visibleBounds,
  WORN_CELL,
  WORN_SHEET,
} from "@secondstaronline/shared";

import type { ArtFiles } from "../persistence/art-files.ts";
import type { ContentProblem } from "./validate.ts";

/** The largest file an upload may be. */
export const UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
/** An uploaded image's largest side: an atlas sheet's. */
export const IMAGE_MAX_SIDE = MAX_SHEET;
/** A worn layer frame's largest size: the character it is pasted on. */
export const WORN_FRAME = { w: 46, h: 45 } as const;
/** The largest item picture, body frame and FX frame. */
export const SPRITE_MAX_SIDE = 512;
/** How many bytes of decoded pixels the library keeps between builds (a 2048² image is 16 MiB). */
export const DECODED_BUDGET = 128 * 1024 * 1024;
/** Paperdoll layers are pasted at the character's top-left; the atlas records its anchor. */
const PAPERDOLL_REG = [25, 6] as const;

export type UploadKind = "image" | "sound";

export type UploadCheck =
  | { ok: true; kind: "image"; ext: "png"; width: number; height: number }
  | { ok: true; kind: "sound"; ext: ArtSoundFormat }
  | { ok: false; error: string };

/** A sound file's format from its first bytes, or null. */
export function soundFormatOf(b: Uint8Array): ArtSoundFormat | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") {
    return "wav";
  }
  if (b.length >= 4 && ascii(0, 4) === "OggS") {
    return "ogg";
  }
  if (
    b.length >= 3 &&
    ((b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) ||
      (b[0] === 0xff && ((b[1] as number) & 0xe0) === 0xe0))
  ) {
    return "mp3";
  }
  return null;
}

/** Checks an upload's bytes before they are stored. */
export function checkUpload(bytes: Uint8Array, kind: UploadKind): UploadCheck {
  if (bytes.length === 0) {
    return { ok: false, error: "the file is empty" };
  }
  if (bytes.length > UPLOAD_MAX_BYTES) {
    return {
      ok: false,
      error: `the file is ${mb(bytes.length)}; uploads may be at most ${mb(UPLOAD_MAX_BYTES)}`,
    };
  }
  if (kind === "sound") {
    const ext = soundFormatOf(bytes);
    return ext
      ? { ok: true, kind: "sound", ext }
      : { ok: false, error: "the file is not a WAV, MP3 or OGG sound" };
  }
  try {
    const img = decodePng(bytes, { maxSide: IMAGE_MAX_SIDE });
    return { ok: true, kind: "image", ext: "png", width: img.width, height: img.height };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Cuts a worn sheet (issue #29, stage 3) into its frames: rows N, E, S, W of frames F1-F4, each a
 * 46×45 cell. A blank cell (every pixel see-through, or every pixel pure green: blank whichever way
 * the transparency is read) is left out, and so is F4-S, which is never drawn. The cells keep
 * their pixels exactly; transparency and mirroring are applied when the atlas is built.
 */
export function sliceWornSheet(sheet: Rgba): Map<ArtFrameId, Rgba> | string {
  if (sheet.width !== WORN_SHEET.w || sheet.height !== WORN_SHEET.h) {
    return `the sheet is ${sheet.width}×${sheet.height}; a worn sheet is ${WORN_SHEET.w}×${WORN_SHEET.h} (rows N, E, S and W of frames F1 to F4, each ${WORN_CELL.w}×${WORN_CELL.h})`;
  }
  const out = new Map<ArtFrameId, Rgba>();
  for (const id of ALL_FRAME_IDS) {
    if (id === "f4-s") {
      continue;
    }
    const cell = cutCell(sheet, id) as Rgba;
    if (!blankCell(cell)) {
      out.set(id, cell);
    }
  }
  return out.size > 0 ? out : "every cell of the sheet is blank";
}

/**
 * Cuts a body sheet (issue #29, stage 4) into its 16 frames: rows N, E, S, W of frames F1-F4,
 * every cell the same size (the sheet's width and height divided by 4), at most 512×512. Every
 * cell is kept, blank or not: a body draws all 16, and the page reports a frame that shows
 * nothing. The cells keep their pixels exactly.
 */
export function sliceBodySheet(
  sheet: Rgba,
): { cell: { w: number; h: number }; frames: Map<ArtFrameId, Rgba> } | string {
  const cell = bodySheetCell(sheet.width, sheet.height);
  if ("error" in cell) {
    return cell.error;
  }
  const frames = new Map<ArtFrameId, Rgba>();
  for (const id of BODY_FRAMES) {
    frames.set(id, cutCell(sheet, id, cell) as Rgba);
  }
  return { cell, frames };
}

/**
 * Cuts an effect strip (issue #29, stage 5) into its run's frames and its trail's: rows of
 * `across` equal cells, at most 512×512, the run's `runRows` then the trail's `trailRows`. Trailing blank cells of each row are dropped (a trail
 * shorter than its run); a blank cell before a row's last drawn one is refused. The cells keep
 * their pixels exactly.
 */
export function sliceFxSheet(
  sheet: Rgba,
  layout: FxSheetLayout,
): { cell: { w: number; h: number }; frames: Rgba[]; trail: Rgba[] } | string {
  const cell = fxSheetCell(sheet.width, sheet.height, layout);
  if ("error" in cell) {
    return cell.error;
  }
  const cut = stripFrames(sheet, cell, layout);
  if ("error" in cut) {
    return cut.error;
  }
  return { cell, frames: cut.frames as Rgba[], trail: cut.trail as Rgba[] };
}

/** "a WAV", "an MP3", "an OGG". */
const article = (format: string) => (format === "wav" ? "a" : "an");

const mb = (n: number) => `${(n / (1024 * 1024)).toFixed(n < 1024 * 1024 ? 2 : 1)} MB`;

/** One sprite ready to pack: keyed, flipped and trimmed. */
interface Prepared {
  group: AtlasGroup;
  key: string;
  img: Rgba;
  regX: number;
  regY: number;
  /** Where a trimmed picture's visible pixels began (items only: pasted by their corner). */
  trimX?: number;
  trimY?: number;
}

/** A sprite or sound the operator's art supplies, by group, for the usage checks. */
export interface ArtKeys {
  sprites: Record<AtlasGroup, Set<string>>;
  sounds: Set<string>;
}

/** The atlases, sounds and hit rects built from the `art` rows. */
export interface BuiltArt {
  /** Identifies the input: the same rows always build the same art. */
  hash: string;
  /** The operator's art as a pack's index: sheets named `<group>-<hash>.png` in the cache. */
  index: PackArtIndex;
  /** The sheets' bytes, by file name. */
  sheets: Map<string, Uint8Array>;
  rects: Pick<RectsData, "fx" | "chars" | "items">;
}

const NO_GROUPS = (): Record<AtlasGroup, Set<string>> => ({
  tiles: new Set(),
  bodies: new Set(),
  paperdoll: new Set(),
  fx: new Set(),
  items: new Set(),
});

/** Crops to the visible pixels, moving the anchor with them; null when nothing is visible. */
export function trim(
  img: Rgba,
  regX: number,
  regY: number,
): { img: Rgba; regX: number; regY: number } | null {
  const b = visibleBounds(img);
  if (!b) {
    return null;
  }
  if (b.x === 0 && b.y === 0 && b.w === img.width && b.h === img.height) {
    return { img, regX, regY };
  }
  const [x0, y0] = [b.x, b.y];
  const out = createRgba(b.w, b.h);
  for (let y = 0; y < out.height; y++) {
    const from = ((y0 + y) * img.width + x0) * 4;
    out.data.set(img.data.subarray(from, from + out.width * 4), y * out.width * 4);
  }
  return { img: out, regX: regX - x0, regY: regY - y0 };
}

/**
 * The art library over the file store: decodes each stored image once, and builds the operator's
 * art from the `art` rows. Builds are remembered by their input, so checking a draft and then
 * publishing it builds once.
 */
export class ArtLibrary {
  /** Decoded images, most recently used last, up to `DECODED_BUDGET` bytes of pixels. */
  private readonly decoded = new Map<string, Rgba | string>();
  private decodedBytes = 0;
  private readonly builds = new Map<string, { built: BuiltArt; problems: ContentProblem[] }>();

  constructor(readonly files: ArtFiles) {}

  /** A stored image, decoded, or why it cannot be read. */
  image(hash: string): Rgba | string {
    let img = this.decoded.get(hash);
    if (img !== undefined) {
      // Most recently used goes last.
      this.decoded.delete(hash);
      this.decoded.set(hash, img);
    } else {
      const bytes = this.files.read("art", hash, "png");
      if (!bytes) {
        // Not remembered: the file may be uploaded next.
        return "its file is missing";
      } else {
        try {
          img = decodePng(bytes, { maxSide: IMAGE_MAX_SIDE });
        } catch (e) {
          img = (e as Error).message;
        }
      }
      this.decoded.set(hash, img);
      this.decodedBytes += typeof img === "string" ? 0 : img.data.length;
      for (const [k, v] of this.decoded) {
        if (this.decodedBytes <= DECODED_BUDGET || k === hash) {
          break;
        }
        this.decoded.delete(k);
        this.decodedBytes -= typeof v === "string" ? 0 : v.data.length;
      }
    }
    return img;
  }

  /** A file was stored: forget builds that may have missed it. */
  stored(hash: string): void {
    this.decoded.delete(hash);
    for (const [k, v] of this.builds) {
      if (v.problems.length > 0) {
        this.builds.delete(k);
      }
    }
  }

  /** The art's problems: files missing or damaged, frames of the wrong shape, clashing names. */
  problems(art: ArtData): ContentProblem[] {
    return this.run(art).problems;
  }

  /** The operator's atlases, sounds and rects (built from the rows that pass their checks). */
  build(art: ArtData): BuiltArt {
    return this.run(art).built;
  }

  private run(art: ArtData): { built: BuiltArt; problems: ContentProblem[] } {
    const hash = createHash("sha256").update(JSON.stringify(art)).digest("hex").slice(0, 16);
    let done = this.builds.get(hash);
    if (!done) {
      done = this.compute(art, hash);
      // A handful of recent inputs: the published art and a draft or two.
      if (this.builds.size >= 4) {
        this.builds.delete(this.builds.keys().next().value as string);
      }
      this.builds.set(hash, done);
    }
    return done;
  }

  private compute(art: ArtData, hash: string): { built: BuiltArt; problems: ContentProblem[] } {
    const problems: ContentProblem[] = [];
    const prepared: Prepared[] = [];
    const where = (part: string, key: string) => `art/${part}/${key}`;
    const load = (part: string, key: string, label: string, file: string): Rgba | null => {
      const img = this.image(file);
      if (typeof img === "string") {
        problems.push({ where: where(part, key), message: `${label}: ${img}` });
        return null;
      }
      // Keying works in place, so each use gets its own copy.
      return { width: img.width, height: img.height, data: img.data.slice() };
    };
    const keyed = (img: Rgba, transparency: string | undefined) => {
      if (transparency === "green") {
        applyKey(img, { kind: "color", rgb: GREEN });
      }
      return img;
    };
    const tooBig = (img: Rgba, w: number, h: number) => img.width > w || img.height > h;
    const visible = (
      part: string,
      key: string,
      label: string,
      img: Rgba,
      regX: number,
      regY: number,
    ) => {
      const t = trim(img, regX, regY);
      if (!t) {
        problems.push({ where: where(part, key), message: `${label} has no visible pixels` });
      }
      return t;
    };

    for (const row of art.items) {
      const img = load("items", row.name, "the picture", row.file);
      if (!img) {
        continue;
      }
      if (tooBig(img, SPRITE_MAX_SIDE, SPRITE_MAX_SIDE)) {
        problems.push({
          where: where("items", row.name),
          message: `the picture is ${img.width}×${img.height}; item pictures may be at most ${SPRITE_MAX_SIDE}×${SPRITE_MAX_SIDE}`,
        });
        continue;
      }
      const t = visible(
        "items",
        row.name,
        "the picture",
        keyed(img, row.transparency),
        row.regX,
        row.regY,
      );
      if (t) {
        const { img: tImg, regX, regY } = t;
        prepared.push({
          group: "items",
          key: row.name.toLowerCase(),
          img: tImg,
          regX,
          regY,
          trimX: row.regX - regX,
          trimY: row.regY - regY,
        });
      }
    }

    for (const row of art.paperdoll) {
      const ids = ART_FRAME_IDS.filter((f) => row.frames[f]);
      if (ids.length === 0) {
        problems.push({
          where: where("paperdoll", row.name),
          message: "a worn layer needs a frame",
        });
        continue;
      }
      if (row.frames["f4-s"]) {
        problems.push({
          where: where("paperdoll", row.name),
          message: "f4-s is never drawn (a character attacking south shows f3-s)",
        });
      }
      for (const f of ids) {
        const frame = row.frames[f] as { file: string };
        const img = load("paperdoll", row.name, f, frame.file);
        if (!img) {
          continue;
        }
        if (tooBig(img, WORN_FRAME.w, WORN_FRAME.h)) {
          problems.push({
            where: where("paperdoll", row.name),
            message: `${f} is ${img.width}×${img.height}; worn frames are at most ${WORN_FRAME.w}×${WORN_FRAME.h}, drawn from the character's top-left`,
          });
          continue;
        }
        let out = keyed(img, row.transparency);
        if (row.mirrored && f.endsWith("-n")) {
          try {
            out = mirrorPaperdoll(out, f);
          } catch (e) {
            problems.push({ where: where("paperdoll", row.name), message: (e as Error).message });
            continue;
          }
        }
        prepared.push({
          group: "paperdoll",
          key: `${row.name}-${f}`.toLowerCase(),
          img: out,
          regX: PAPERDOLL_REG[0],
          regY: PAPERDOLL_REG[1],
        });
      }
    }

    for (const row of art.bodies) {
      const missing = ART_FRAME_IDS.filter((f) => !row.frames[f]);
      if (missing.length > 0) {
        problems.push({
          where: where("bodies", row.name),
          message: `a body needs all 16 frames; missing ${missing.join(", ")}`,
        });
        continue;
      }
      const imgs = new Map<string, { img: Rgba; regX: number; regY: number }>();
      for (const f of ART_FRAME_IDS) {
        const frame = row.frames[f] as { file: string; regX: number; regY: number };
        const img = load("bodies", row.name, f, frame.file);
        if (!img) {
          continue;
        }
        if (tooBig(img, SPRITE_MAX_SIDE, SPRITE_MAX_SIDE)) {
          problems.push({
            where: where("bodies", row.name),
            message: `${f} is ${img.width}×${img.height}; body frames may be at most ${SPRITE_MAX_SIDE}×${SPRITE_MAX_SIDE}`,
          });
          continue;
        }
        imgs.set(f, { img: keyed(img, row.transparency), regX: frame.regX, regY: frame.regY });
      }
      if (imgs.size < ART_FRAME_IDS.length) {
        continue;
      }
      // North frames flip about the standing frame's centre line, as the asset build does.
      const standing = imgs.get("f2-n") as { img: Rgba; regX: number };
      const line2 = row.mirrored ? centreLine2(standing.img, standing.regX) : 0;
      for (const f of ART_FRAME_IDS) {
        let { img, regX, regY } = imgs.get(f) as { img: Rgba; regX: number; regY: number };
        if (row.mirrored && f.endsWith("-n")) {
          ({ img, regX } = mirrorBody(img, regX, line2));
        }
        const t = visible("bodies", row.name, f, img, regX, regY);
        if (t) {
          prepared.push({ group: "bodies", key: `${row.name}-${f}`, ...t });
        }
      }
    }

    for (const row of art.fx) {
      const runs: [string, typeof row.frames][] = [[row.name, row.frames]];
      if (row.trail) {
        runs.push([`x${row.name}`, row.trail]);
      }
      for (const [member, frames] of runs) {
        frames.forEach((frame, i) => {
          const label = `${member}-${i + 1}`;
          const img = load("fx", row.name, label, frame.file);
          if (!img) {
            return;
          }
          if (tooBig(img, SPRITE_MAX_SIDE, SPRITE_MAX_SIDE)) {
            problems.push({
              where: where("fx", row.name),
              message: `${label} is ${img.width}×${img.height}; effect frames may be at most ${SPRITE_MAX_SIDE}×${SPRITE_MAX_SIDE}`,
            });
            return;
          }
          const t = visible(
            "fx",
            row.name,
            label,
            keyed(img, row.transparency),
            frame.regX,
            frame.regY,
          );
          if (t) {
            prepared.push({ group: "fx", key: label.toLowerCase(), ...t });
          }
        });
      }
    }

    for (const row of art.tiles) {
      const img = load("tiles", row.code, "the tile", row.file);
      if (img && (img.width !== 32 || img.height !== 32)) {
        // A tile is pasted at its cell's top-left: any other size would overlap or leave a gap.
        problems.push({
          where: where("tiles", row.code),
          message: `the tile is ${img.width}×${img.height}; a tile is exactly 32×32`,
        });
        continue;
      }
      if (img && !tileShows(img, row.transparency ?? "alpha")) {
        // Pasted whole, a tile that shows nothing would leave a hole wherever a map has it.
        problems.push({ where: where("tiles", row.code), message: "the tile shows nothing" });
        continue;
      }
      if (img) {
        prepared.push({
          group: "tiles",
          key: row.code.toLowerCase(),
          img: keyed(img, row.transparency),
          regX: 0,
          regY: 0,
        });
      }
    }

    const sounds: Record<string, string> = {};
    for (const row of art.sounds) {
      const bytes = this.files.read("sounds", row.file, row.format);
      if (!bytes) {
        // Stored under another format: the row names the wrong one.
        const other = (["wav", "mp3", "ogg"] as const).find(
          (f) => f !== row.format && this.files.read("sounds", row.file, f),
        );
        problems.push({
          where: where("sounds", row.name),
          message: other
            ? `its file is ${article(other)} ${other.toUpperCase()} sound, not ${article(row.format)} ${row.format.toUpperCase()}`
            : "its file is missing",
        });
        continue;
      }
      if (soundFormatOf(bytes) !== row.format) {
        problems.push({
          where: where("sounds", row.name),
          message: `its file is not ${article(row.format)} ${row.format.toUpperCase()} sound`,
        });
        continue;
      }
      sounds[row.name.toLowerCase()] = `sounds/${row.file}.${row.format}`;
    }

    // Two rows that make the same sprite (an FX run `a` with a trail, beside a run `xa`).
    const seen = new Map<string, Prepared>();
    const unique: Prepared[] = [];
    for (const p of prepared) {
      const id = `${p.group}:${p.key}`;
      if (seen.has(id)) {
        problems.push({
          where: `art/${p.group}`,
          message: `two rows make the sprite ${p.key}`,
        });
        continue;
      }
      seen.set(id, p);
      unique.push(p);
    }

    const atlases = {} as Record<AtlasGroup, AtlasIndex>;
    const sheets = new Map<string, Uint8Array>();
    const rects: BuiltArt["rects"] = { fx: {}, chars: {}, items: {} };
    for (const group of ["bodies", "fx", "items", "paperdoll", "tiles"] as const) {
      const mine = unique.filter((p) => p.group === group);
      const layout = pack(mine.map((p) => ({ name: p.key, w: p.img.width, h: p.img.height })));
      const imgs = layout.sheets.map((s) => createRgba(Math.max(1, s.w), Math.max(1, s.h)));
      const sprites: Record<string, AtlasSprite> = {};
      const byKey = new Map(mine.map((p) => [p.key, p]));
      for (const pl of [...layout.placements].sort((a, b) => (a.name < b.name ? -1 : 1))) {
        const p = byKey.get(pl.name) as Prepared;
        blit(imgs[pl.sheet] as Rgba, p.img, pl.x, pl.y);
        sprites[p.key] =
          p.trimX || p.trimY
            ? [
                pl.sheet,
                pl.x,
                pl.y,
                p.img.width,
                p.img.height,
                p.regX,
                p.regY,
                p.trimX ?? 0,
                p.trimY ?? 0,
              ]
            : [pl.sheet, pl.x, pl.y, p.img.width, p.img.height, p.regX, p.regY];
        const rect: MemberRect = [p.img.width, p.img.height, p.regX, p.regY];
        if (group === "fx") {
          rects.fx[p.key] = rect;
        } else if (group === "bodies") {
          rects.chars[p.key] = rect;
        } else if (group === "items") {
          rects.items[p.key] = rect;
        }
      }
      const names = imgs.map((img) => {
        const bytes = encodePng(img);
        const name = `${group}-${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}.png`;
        sheets.set(name, bytes);
        return name;
      });
      atlases[group] = { sheets: names, sprites };
    }
    return {
      built: {
        hash,
        index: { version: 1, inputHash: hash, atlases, sounds },
        sheets,
        rects,
      },
      problems,
    };
  }
}

/** The data with the operator's hit rects over the packs' (an upload replaces a pack's sprite). */
export function withArtRects<T extends { rects: RectsData }>(data: T, rects: BuiltArt["rects"]): T {
  if (
    Object.keys(rects.fx).length === 0 &&
    Object.keys(rects.chars).length === 0 &&
    Object.keys(rects.items).length === 0
  ) {
    return data;
  }
  // An uploaded run (or trail) is the whole run: the packs' frames after its last are not hit.
  const hidden = fxTailHidden(Object.keys(rects.fx));
  const packFx = Object.fromEntries(Object.entries(data.rects.fx).filter(([k]) => !hidden(k)));
  return {
    ...data,
    rects: {
      fx: { ...packFx, ...rects.fx },
      chars: { ...data.rects.chars, ...rects.chars },
      items: { ...data.rects.items, ...rects.items },
    },
  };
}

/** The sprites and sounds an index supplies. */
export function keysOf(index: Pick<PackArtIndex, "atlases" | "sounds">): ArtKeys {
  const sprites = NO_GROUPS();
  for (const g of Object.keys(sprites) as AtlasGroup[]) {
    for (const k of Object.keys(index.atlases[g]?.sprites ?? {})) {
      sprites[g].add(k);
    }
  }
  return { sprites, sounds: new Set(Object.keys(index.sounds)) };
}

/**
 * Which of the packs' FX keys an operator's FX keys hide (issue #29, stage 5): an uploaded run,
 * or an uploaded trail (`x<run>-<n>`), is the whole of it, so the packs' frames of the same name
 * after its last one are not drawn or hit. A pack's trail stays when only the run is uploaded.
 */
export function fxTailHidden(operatorKeys: Iterable<string>): (packKey: string) => boolean {
  const last = new Map<string, number>();
  for (const k of operatorKeys) {
    const m = /^(.*)-(\d+)$/.exec(k.toLowerCase());
    if (m) {
      const run = m[1] as string;
      last.set(run, Math.max(last.get(run) ?? 0, Number(m[2])));
    }
  }
  return (packKey) => {
    const m = /^(.*)-(\d+)$/.exec(packKey.toLowerCase());
    if (!m) {
      return false;
    }
    const top = last.get(m[1] as string);
    return top !== undefined && Number(m[2]) > top;
  };
}
