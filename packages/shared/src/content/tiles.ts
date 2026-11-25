/**
 * Map tiles (issue #29, stage 6): which codes are taken, what content names each tile, how a
 * tileset sheet is cut, how bulk files match tiles, and the draft rows a tile change writes.
 *
 * A tile is a 32×32 picture pasted at its cell's top-left, named by a code. The walk test reads
 * codes ignoring case (`lingoContains` over the walkable list), so codes are compared that way
 * everywhere here. New tiles get their code from the server: two characters, uppercase letters
 * and digits, never one a pack, the draft, the content or any map already uses, so a tile left on
 * a map after its row went never comes back as something else. Everything here is pure.
 */
import type { ArtTile } from "@secondstaronline/data";

import { artRowFingerprint } from "./fx.ts";
import {
  applyTransparency,
  type PictureTransparency,
  type Pixels,
  visibleBounds,
} from "./picture.ts";

/** A tile's picture is exactly this square. */
export const TILE_SIZE = 32;
/** The largest side a tileset sheet may have (the upload limit). */
export const TILE_SHEET_MAX = 2048;
/** The characters a new tile's code is made of. */
export const TILE_CODE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
/** What a new tile is told when every code is taken. */
export const NO_TILE_CODES = `No tile codes left (new tiles use two of ${TILE_CODE_CHARS.length} letters and digits).`;
/** The flags a tile may carry (the tiles schema's `tileFlagSchema`). */
export const TILE_FLAGS = ["sea", "airshipBlock", "dock", "arena", "grave"] as const;
export type TileFlagName = (typeof TILE_FLAGS)[number];
/** How many tiles one change may add. */
export const TILES_PER_CHANGE = 512;
/** How many tiles one tileset file may add. */
export const TILES_PER_SHEET = 512;

const low = (s: string) => s.toLowerCase();

/** A catalogue entry as the tile panels read it. */
export interface TileRow {
  code: string;
  name?: string;
  member?: number;
  flags?: TileFlagName[];
}

/** What `tileRefs` reads: the tile tables and the rows that name tiles by code. */
export interface TileContent {
  tiles: {
    walkable: readonly { code: string }[];
    catalogue: readonly TileRow[];
    defaults: { ground: string; empty: string; shadow: string; editorTile: string };
  };
  gather: {
    harvest: readonly { tile: string; under?: readonly string[]; becomes: string }[];
    gathering?: {
      fishing?: { waterTiles: readonly string[] };
      farming?: {
        seeds: readonly { plants: string }[];
        watering: readonly { from: string; to: string }[];
        produce: readonly { tile: string }[];
      };
      regrowth?: { checks: readonly { tiles: readonly { from: string; to: string }[] }[] };
    };
  };
  social?: { newspaper?: { standTile: { text: string } } };
  houses: {
    types: readonly {
      house: string;
      tiles: readonly (readonly [string, number, number])[];
      template: { layers: readonly (readonly string[])[] };
    }[];
    placement: { terrain: { layer1Codes: readonly string[] } };
    /** The vehicles' tile sets (issue #44). */
    vehicles?: readonly {
      name: string;
      moves: {
        over: "any" | { codes?: readonly string[] };
        except?: { codes?: readonly string[] };
      };
      lands?: { codes?: readonly string[] };
    }[];
  };
}

/** Every code content rows name, by lower-case code, with who names it ("gathering", …). */
export function tileRefs(data: TileContent): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const note = (code: string | undefined, who: string) => {
    if (!code) {
      return;
    }
    const k = low(code);
    const list = out.get(k) ?? [];
    if (!list.includes(who)) {
      list.push(who);
    }
    out.set(k, list);
  };
  const d = data.tiles.defaults;
  note(d.ground, "the blank map's ground");
  note(d.empty, "the empty tile");
  note(d.shadow, "the shadow tile");
  note(d.editorTile, "the World Editor's first tile");
  for (const n of data.gather.harvest) {
    note(n.tile, "a gathering node");
    note(n.becomes, "a gathering node");
    for (const u of n.under ?? []) {
      note(u, "a gathering node");
    }
  }
  const a = data.gather.gathering;
  for (const w of a?.fishing?.waterTiles ?? []) {
    note(w, "fishing");
  }
  for (const s of a?.farming?.seeds ?? []) {
    note(s.plants, "farming");
  }
  for (const w of a?.farming?.watering ?? []) {
    note(w.from, "farming");
    note(w.to, "farming");
  }
  for (const p of a?.farming?.produce ?? []) {
    note(p.tile, "farming");
  }
  for (const c of a?.regrowth?.checks ?? []) {
    for (const t of c.tiles) {
      note(t.from, "regrowth");
      note(t.to, "regrowth");
    }
  }
  for (const h of data.houses.types) {
    for (const [code] of h.tiles) {
      note(code, `house ${h.house}`);
    }
    for (const layer of h.template.layers) {
      for (const line of layer) {
        for (const code of line.split(" ")) {
          note(code, `house ${h.house}'s interior`);
        }
      }
    }
  }
  for (const c of data.houses.placement.terrain.layer1Codes) {
    note(c, "house placement");
  }
  for (const v of data.houses.vehicles ?? []) {
    const { over, except } = v.moves;
    for (const c of [
      ...(over === "any" ? [] : (over.codes ?? [])),
      ...(except?.codes ?? []),
      ...(v.lands?.codes ?? []),
    ]) {
      note(c, `the ${v.name}`);
    }
  }
  note(data.social?.newspaper?.standTile.text, "the newspaper stand");
  return out;
}

/** Every code a map's layers use, lower case. */
export function mapCodes(layers: readonly (readonly string[])[]): Set<string> {
  const out = new Set<string>();
  for (const layer of layers) {
    for (const line of layer) {
      for (const code of line.split(" ")) {
        if (code) {
          out.add(low(code));
        }
      }
    }
  }
  return out;
}

/** The first `n` free codes (none of `taken`, lower case), or null when there are not enough. */
export function nextTileCodes(taken: ReadonlySet<string>, n: number): string[] | null {
  const out: string[] = [];
  for (const a of TILE_CODE_CHARS) {
    for (const b of TILE_CODE_CHARS) {
      const code = a + b;
      if (!taken.has(low(code))) {
        out.push(code);
        if (out.length === n) {
          return out;
        }
      }
    }
  }
  return n === 0 ? [] : null;
}

// ---- sheets -----------------------------------------------------------------------------------

/** How a sheet is cut into tiles, or why it cannot be. */
export function tileSheetGrid(
  width: number,
  height: number,
): { cols: number; rows: number } | string {
  if (width % TILE_SIZE !== 0 || height % TILE_SIZE !== 0 || width === 0 || height === 0) {
    return `the picture is ${width}×${height}; a tile is ${TILE_SIZE}×${TILE_SIZE} and a tileset's sides are multiples of ${TILE_SIZE}`;
  }
  if (width > TILE_SHEET_MAX || height > TILE_SHEET_MAX) {
    return `the picture is ${width}×${height}; a tileset may be at most ${TILE_SHEET_MAX}×${TILE_SHEET_MAX}`;
  }
  return { cols: width / TILE_SIZE, rows: height / TILE_SIZE };
}

/** One 32×32 cell of a sheet, copied out. */
export function cutTileCell(
  img: Pixels,
  col: number,
  row: number,
): { width: number; height: number; data: Uint8Array } {
  const out = {
    width: TILE_SIZE,
    height: TILE_SIZE,
    data: new Uint8Array(TILE_SIZE * TILE_SIZE * 4),
  };
  for (let y = 0; y < TILE_SIZE; y++) {
    const from = ((row * TILE_SIZE + y) * img.width + col * TILE_SIZE) * 4;
    out.data.set(img.data.subarray(from, from + TILE_SIZE * 4), y * TILE_SIZE * 4);
  }
  return out;
}

/** Whether a tile shows anything once its transparency is applied. */
export function tileShows(img: Pixels, transparency: PictureTransparency): boolean {
  const copy = { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
  applyTransparency(copy, transparency);
  return visibleBounds(copy) !== null;
}

/** What is wrong with a tile's picture, or null when nothing is. */
export function tileImageProblem(img: Pixels, transparency: PictureTransparency): string | null {
  if (img.width !== TILE_SIZE || img.height !== TILE_SIZE) {
    return `it is ${img.width}×${img.height}; a tile is exactly ${TILE_SIZE}×${TILE_SIZE}`;
  }
  return tileShows(img, transparency) ? null : "it shows nothing";
}

// ---- bulk matching ----------------------------------------------------------------------------

/**
 * What a bulk file's name stands for: an existing tile (by code, then by a name only one tile
 * has), several tiles sharing that name (the file must be named by code instead), or a new one.
 */
export type TileMatch =
  | { kind: "tile"; code: string }
  | { kind: "ambiguous"; codes: string[] }
  | { kind: "new" };

/** A file's name without its folder and `.png`. */
export const tileStem = (file: string) =>
  file
    .replace(/^.*[\\/]/, "")
    .replace(/\.png$/i, "")
    .trim();

export function matchTile(stem: string, catalogue: readonly TileRow[]): TileMatch {
  const byCode = catalogue.find((t) => low(t.code) === low(stem));
  if (byCode) {
    return { kind: "tile", code: byCode.code };
  }
  const named = [
    ...new Set(
      catalogue.filter((t) => t.name !== undefined && low(t.name) === low(stem)).map((t) => t.code),
    ),
  ];
  if (named.length > 1) {
    return { kind: "ambiguous", codes: named };
  }
  return named[0] !== undefined ? { kind: "tile", code: named[0] } : { kind: "new" };
}

// ---- changes ----------------------------------------------------------------------------------

/** A new tile being added. */
export interface NewTile {
  file: string;
  /** Shown by the hover tip when it is on layer 2 (absent: never named, as Classic's scenery). */
  name?: string;
  walkable: boolean;
}

/** One tile change, as the Content page asks for it. */
export type TileChange =
  /** New tiles: the server gives each its code, with its catalogue, walkable and art rows. */
  | { op: "add"; tiles: NewTile[]; transparency: PictureTransparency }
  /** Paint a tile that exists; `expect` is its upload as the panel saw it (null for none). */
  | {
      op: "set";
      code: string;
      file: string;
      transparency: PictureTransparency;
      expect?: string | null;
    }
  /** Take a tile's upload out (a pack's picture comes back). */
  | { op: "remove"; code: string; expect?: string | null }
  /**
   * A tile's name, whether it is walkable, and its flags. `seen` is the tile as the panel showed
   * it (`tileFingerprint`); the change is refused if the tile changed since.
   */
  | {
      op: "edit";
      code: string;
      name: string | null;
      walkable: boolean;
      flags: TileFlagName[];
      seen?: string | null;
    }
  /** Take a tile out of the catalogue (its walkable and art rows go when the draft is published). */
  | { op: "delete"; code: string; seen?: string | null };

/**
 * A tile's name, flags and walkability as a panel shows them, for the stale-panel check of an
 * edit or a removal. Its picture is checked on its own (`expect`), so saving one half of the panel
 * never makes the other half stale. A code is never given out twice, so a tile taken out and
 * another made later never pass for each other.
 */
export function tileFingerprint(
  catalogue: readonly TileRow[],
  walkable: readonly { code: string }[],
  code: string,
): string | null {
  const entry = catalogue.find((t) => low(t.code) === low(code));
  if (!entry) {
    return null;
  }
  return artRowFingerprint({
    entry,
    walkable: walkable.some((w) => low(w.code) === low(code)),
  });
}

/**
 * Whether a code can be walkable or have an uploaded picture: both name tiles by 2 characters.
 * Classic's catalogue also lists engine fixtures by longer names (`CHURCH`, `BTileX`).
 */
export const isTileCode = (code: string) => code.length === 2;

/**
 * The most a tile change's frame may weigh (UTF-8 bytes of its JSON), under the editor frame
 * allowance (`EDITOR_MESSAGE_BYTES`, 32 KB) with room for the envelope.
 */
export const TILE_CHANGE_BYTES = 24_000;

const utf8Bytes = (text: string) => new TextEncoder().encode(text).length;

/**
 * New tiles split into `add` changes that each fit one frame: at most `TILES_PER_CHANGE` tiles and
 * `TILE_CHANGE_BYTES` of JSON. A tileset of hundreds of cells goes as several changes.
 */
export function chunkNewTiles<T extends NewTile>(tiles: readonly T[]): T[][] {
  const out: T[][] = [];
  // The envelope: `{"t":"contentTile","seq":…,"change":{"op":"add","transparency":"green","tiles":[]}}`.
  const envelope = 120;
  let chunk: T[] = [];
  let bytes = envelope;
  for (const t of tiles) {
    const size = utf8Bytes(JSON.stringify(t)) + 1;
    if (
      chunk.length > 0 &&
      (chunk.length >= TILES_PER_CHANGE || bytes + size > TILE_CHANGE_BYTES)
    ) {
      out.push(chunk);
      chunk = [];
      bytes = envelope;
    }
    chunk.push(t);
    bytes += size;
  }
  if (chunk.length > 0) {
    out.push(chunk);
  }
  return out;
}

/** A row a tile change writes. */
export type TileRowChange =
  | {
      ref: { dataset: "tiles"; part: "catalogue" | "walkable"; key: null };
      op: "set";
      data: unknown;
    }
  | { ref: { dataset: "art"; part: "tiles"; key: string }; op: "set"; data: ArtTile }
  | { ref: { dataset: "art"; part: "tiles"; key: string }; op: "remove"; data: null };

/** What `planTile` reads, from the draft. */
export interface TilePlanInput {
  catalogue: readonly TileRow[];
  walkable: readonly { code: string }[];
  art: readonly ArtTile[];
  /** Every code taken (lower case): packs, draft, content, maps. */
  taken: ReadonlySet<string>;
  /** Codes the packs draw (lower case). */
  packTiles: ReadonlySet<string>;
  /** Content rows naming each code (`tileRefs` of the draft). */
  refs: ReadonlyMap<string, readonly string[]>;
  /** Maps using each code (lower case), when the world is known. */
  maps?: ReadonlyMap<string, readonly string[]>;
  /** The codes the published catalogue has (lower case): a tile not among them is the draft's own. */
  published?: ReadonlySet<string>;
}

export type TilePlan =
  | { ok: true; rows: TileRowChange[]; codes: string[] }
  | { ok: false; error: string };

const catalogueRef = { dataset: "tiles", part: "catalogue", key: null } as const;
const walkableRef = { dataset: "tiles", part: "walkable", key: null } as const;
const artRef = (code: string) => ({ dataset: "art", part: "tiles", key: code }) as const;

/** Who uses a tile, for messages: "2 maps (x1y1, x2y2), a gathering node". */
export function tileUsersText(
  code: string,
  refs: ReadonlyMap<string, readonly string[]>,
  maps?: ReadonlyMap<string, readonly string[]>,
): string {
  const parts: string[] = [];
  const m = maps?.get(low(code)) ?? [];
  if (m.length > 0) {
    parts.push(`${m.length === 1 ? "1 map" : `${m.length} maps`} (${m.join(", ")})`);
  }
  parts.push(...(refs.get(low(code)) ?? []));
  return parts.join(", ");
}

/** Works out the rows a tile change writes, or why it is refused. */
export function planTile(change: TileChange, input: TilePlanInput): TilePlan {
  const find = (code: string) => input.catalogue.filter((t) => low(t.code) === low(code));
  const upload = (code: string) => input.art.find((a) => low(a.code) === low(code));
  const isWalkable = (code: string) => input.walkable.some((w) => low(w.code) === low(code));

  if (change.op === "add") {
    if (change.tiles.length === 0) {
      return { ok: false, error: "Choose at least one tile to add." };
    }
    if (change.tiles.length > TILES_PER_CHANGE) {
      return { ok: false, error: `At most ${TILES_PER_CHANGE} tiles can be added at once.` };
    }
    const codes = nextTileCodes(input.taken, change.tiles.length);
    if (!codes) {
      return { ok: false, error: NO_TILE_CODES };
    }
    const catalogue = [...input.catalogue];
    const walkable = [...input.walkable];
    const rows: TileRowChange[] = [];
    change.tiles.forEach((t, i) => {
      const code = codes[i] as string;
      const name = t.name?.trim();
      catalogue.push({ code, ...(name ? { name } : {}) });
      if (t.walkable) {
        walkable.push({ code });
      }
      rows.push({
        ref: artRef(code),
        op: "set",
        data: {
          code,
          file: t.file,
          ...(change.transparency === "green" ? { transparency: "green" as const } : {}),
        },
      });
    });
    rows.unshift({ ref: catalogueRef, op: "set", data: catalogue });
    if (walkable.length !== input.walkable.length) {
      rows.splice(1, 0, { ref: walkableRef, op: "set", data: walkable });
    }
    return { ok: true, rows, codes };
  }

  const entries = find(change.code);
  if (entries.length === 0) {
    return { ok: false, error: `There is no tile ${change.code}.` };
  }
  const code = (entries[0] as TileRow).code;
  const art = upload(code);
  if (
    (change.op === "edit" || change.op === "delete") &&
    change.seen !== undefined &&
    tileFingerprint(input.catalogue, input.walkable, code) !== change.seen
  ) {
    return {
      ok: false,
      error: `Tile ${code} changed since you opened it: open it again to see it as it is now.`,
    };
  }

  const fixture = `${code} is not a 2-character tile code (the catalogue lists it for an engine fixture), so it cannot`;
  if ((change.op === "set" || change.op === "remove") && !isTileCode(code)) {
    return { ok: false, error: `${fixture} have a picture of its own.` };
  }
  if (change.op === "edit" && !isTileCode(code) && change.walkable !== isWalkable(code)) {
    return { ok: false, error: `${fixture} be made walkable.` };
  }

  switch (change.op) {
    case "set": {
      if (change.expect !== undefined && artRowFingerprint(art) !== change.expect) {
        return {
          ok: false,
          error: `Tile ${code}'s upload changed since you opened it: open it again to see the new one.`,
        };
      }
      return {
        ok: true,
        codes: [code],
        rows: [
          {
            ref: artRef(art?.code ?? code),
            op: "set",
            data: {
              code: art?.code ?? code,
              file: change.file,
              ...(change.transparency === "green" ? { transparency: "green" as const } : {}),
            },
          },
        ],
      };
    }
    case "remove": {
      if (!art) {
        return { ok: false, error: `Tile ${code} has no upload to take out.` };
      }
      if (change.expect !== undefined && artRowFingerprint(art) !== change.expect) {
        return {
          ok: false,
          error: `Tile ${code}'s upload changed since you opened it: open it again to see the new one.`,
        };
      }
      return {
        ok: true,
        codes: [code],
        rows: [{ ref: artRef(art.code), op: "remove", data: null }],
      };
    }
    case "edit": {
      const name = change.name?.trim() || undefined;
      const flags = [...new Set(change.flags)].filter((f) => TILE_FLAGS.includes(f));
      const catalogue = input.catalogue.map((t) => {
        if (low(t.code) !== low(code)) {
          return t;
        }
        const { name: _n, flags: _f, ...rest } = t;
        return {
          ...rest,
          ...(name !== undefined ? { name } : {}),
          ...(flags.length > 0 ? { flags } : {}),
        };
      });
      const rows: TileRowChange[] = [];
      if (JSON.stringify(catalogue) !== JSON.stringify(input.catalogue)) {
        rows.push({ ref: catalogueRef, op: "set", data: catalogue });
      }
      if (change.walkable !== isWalkable(code)) {
        const walkable = change.walkable
          ? [...input.walkable, { code }]
          : input.walkable.filter((w) => low(w.code) !== low(code));
        rows.push({ ref: walkableRef, op: "set", data: walkable });
      }
      if (rows.length === 0) {
        return { ok: false, error: `Tile ${code} is already like that.` };
      }
      return { ok: true, codes: [code], rows };
    }
    case "delete": {
      const k = low(code);
      const maps = input.maps?.get(k) ?? [];
      const refs = input.refs.get(k) ?? [];
      if (maps.length > 0 || refs.length > 0) {
        return {
          ok: false,
          error: `Tile ${code} is still used: ${tileUsersText(code, input.refs, input.maps)}. Take it off those first.`,
        };
      }
      const rows: TileRowChange[] = [
        { ref: catalogueRef, op: "set", data: input.catalogue.filter((t) => low(t.code) !== k) },
      ];
      // A tile the published catalogue never had is the draft's own: its walkable row and upload
      // go now, so nothing of it is left to publish. A published tile's go when the draft is
      // published, so discarding the removal keeps them.
      if (input.published && !input.published.has(k)) {
        if (isWalkable(code)) {
          rows.push({
            ref: walkableRef,
            op: "set",
            data: input.walkable.filter((w) => low(w.code) !== k),
          });
        }
        if (art) {
          rows.push({ ref: artRef(art.code), op: "remove", data: null });
        }
      }
      return { ok: true, codes: [code], rows };
    }
  }
}

/**
 * Codes the published catalogue had that `next` no longer has: their walkable tokens and uploads
 * go when the draft is published (worked out then, so discarding the removal keeps them).
 */
export function removedTileCodes(
  published: readonly TileRow[],
  next: readonly TileRow[],
): string[] {
  const still = new Set(next.map((t) => low(t.code)));
  const out = new Map<string, string>();
  for (const t of published) {
    if (!still.has(low(t.code))) {
      out.set(low(t.code), t.code);
    }
  }
  return [...out.values()];
}
