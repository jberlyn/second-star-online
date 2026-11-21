/**
 * The World Editor's rules. Pure functions shared by the editor screen and the server's save
 * validation.
 *
 * - The screen is frames 262-288, resting on 263; entering it resets the tool to Pencil, palette
 *   page 1, layer 1, tile G1, and loads the map the player is on.
 * - Painting puts the selected tile into the chosen layer at the pointer while the button is down:
 *   Pencil one tile, Bucket the whole layer, Fat brush a plus shape.
 * - The save writes the layers, the field-12 flags from the toggles, the fog, both exits, the three
 *   signs and the header; the placed monsters become the roster and the live monsters; the placed
 *   items become the map's item file.
 */
import { itemsData, monstersData, type Tile, tilesData } from "@secondstaronline/data";

import { MAP_HEIGHT, MAP_WIDTH } from "../../constants.ts";
import { lingoWord } from "../core/lingo.ts";
import { houseMapName, mapName } from "../core/maps.ts";
import { TILE_DEFAULTS } from "../core/tiles.ts";
import { isWhitelisted } from "../core/walk.ts";

/**
 * A map exit (map field 13 or 18, `MX:MY:LX:LY:`): the target map and tile. `house` marks a house's
 * exit, written `H<slot><mx>:H<slot><my>:11:` by the build: its target is the interior
 * `xH<slot><mx>yH<slot><my>`.
 */
export interface MapExit {
  mx: number;
  my: number;
  x: number;
  y: number;
  house?: 1 | 2;
}

/** The map an exit leads to (`"x" & MX & "y" & MY`). */
export function exitTarget(e: MapExit): string {
  return e.house ? houseMapName(e.mx, e.my, e.house) : mapName(e.mx, e.my);
}

/** Map field 12 items 6-10. */
export interface MapFog {
  tex: string;
  blend: number;
  r: number;
  g: number;
  b: number;
}

/** The fog a map has when none was chosen. */
export const NO_FOG: MapFog = { tex: "NoTex", blend: 0, r: 255, g: 255, b: 255 };

/** Map field 12 items 1, 2, 3 and 5 as the editor's toggles write them. */
export interface EditorFlags {
  canFight: string;
  fctSpwn: string;
  isIndoors: string;
  canPvp: string;
}

/** A monster or NPC placed in the editor (sprites 180-183): the tile it was put on. */
export interface EditorMob {
  name: string;
  x: number;
  y: number;
}

/** An item placed in the editor (sprites 158-177). */
export interface EditorItem {
  name: string;
  x: number;
  y: number;
}

/** Everything one editor save writes for a map. */
export interface EditorMap {
  mx: number;
  my: number;
  /** Layers 1-4 (1, 2, 3, S), each 12 rows of 17 space-separated codes. */
  layers: [string[], string[], string[], string[]];
  flags: EditorFlags;
  /** Field 17, the map header field. */
  header: string;
  signs: [string, string, string];
  exit1: MapExit | null;
  exit2: MapExit | null;
  fog: MapFog;
  /** Sprites 180-183 in order: the four roster slots; null where nothing is placed. */
  mobs: [EditorMob | null, EditorMob | null, EditorMob | null, EditorMob | null];
  /** At most 20 (sprites 158-177). */
  items: EditorItem[];
}

/** Item sprites 158-177: the most items one map's editor can hold. */
export const EDITOR_ITEM_SLOTS = 20;

/** Bounds on free text. Not game rules: the original fields had none. */
export const SIGN_MAX = 1000;
export const HEADER_MAX = 200;

/**
 * The MONSTER list (field `MONSTER`), 36 names in its order. None is an art-less body, so no filter
 * is needed here. Also drives game rules via `contains`: monsters lean toward players
 * (`leansToward`), get no quests (`questGive`, `askForQuest`), and get no treasure rumours
 * (`sayTreasure`).
 */
export const EDITOR_MONSTERS: readonly string[] = monstersData.editorLists.worldEditor.monsters;

/** The NPC list (field `NPC`), 56 names in its order. */
export const EDITOR_NPCS: readonly string[] = monstersData.editorLists.worldEditor.npcs;

/**
 * The ITEM list (field `ITEM`): "Delete", then
 * the item content's `editorItems`. "Delete" is not an item: with it selected, clicking a placed
 * item removes it and clicking the map places nothing.
 */
export const EDITOR_ITEMS: readonly string[] = ["Delete", ...itemsData.editorItems];

/** The FOGTEX list: Internal members #448-456 by name. */
export const FOG_TEXTURES: readonly string[] = [
  "NoTex",
  "Cloudy1",
  "Cloudy2",
  "Cloudy3",
  "Whispy",
  "Compass",
  "Wicked",
  "Splotchy",
  "Gazing",
];

/** The BLENDLEVEL list: 0 to 250 by 10, then 255. */
export const BLEND_LEVELS: readonly number[] = [
  ...Array.from({ length: 26 }, (_, i) => i * 10),
  255,
];

/**
 * Palette pages: 10 original pages of 60 MapGFX members from 1, 61, … 541, plus added pages for
 * memberless tiles.
 */
export const ORIGINAL_PALETTE_PAGES = 10;
export const PALETTE_PAGE_SIZE = 60;
/** Paging stops once the first tile would pass 589: the last original page has 49 tiles. */
export const PALETTE_LAST_MEMBER = 589;

/** Slots left empty on page 10 (members 590-600 hold no tile): added tiles fill them first. */
const PAGE_10_FREE = PALETTE_PAGE_SIZE * ORIGINAL_PALETTE_PAGES - PALETTE_LAST_MEMBER;

/** Palette page count for a catalogue: 10, plus a page per 60 added tiles beyond page 10's free slots. */
export function palettePagesOf(catalogue: readonly Tile[]): number {
  const added = catalogue.filter((t) => t.member === undefined).length;
  return ORIGINAL_PALETTE_PAGES + Math.ceil(Math.max(0, added - PAGE_10_FREE) / PALETTE_PAGE_SIZE);
}

export const PALETTE_PAGES = palettePagesOf(tilesData.catalogue);

/**
 * Pure palette page lookup: pages 1-10 show original tiles by MapGFX member (stopping at 589);
 * added tiles (no `member`), in catalogue order, fill page 10's free slots (50-60) first, then
 * pages 11+, 60 per page. Every other slot is empty (the client leaves it blank).
 */
export function palettePageOf(catalogue: readonly Tile[], page: number): string[] {
  if (page >= 1) {
    const added = catalogue.filter((t) => t.member === undefined);
    if (page > ORIGINAL_PALETTE_PAGES) {
      const offset = PAGE_10_FREE + (page - ORIGINAL_PALETTE_PAGES - 1) * PALETTE_PAGE_SIZE;
      return added.slice(offset, offset + PALETTE_PAGE_SIZE).map((t) => t.code);
    }
    const byMember = new Map<number, string>();
    for (const t of catalogue) {
      if (t.member !== undefined) {
        byMember.set(t.member, t.code);
      }
    }
    const start = (page - 1) * PALETTE_PAGE_SIZE + 1;
    const out: string[] = [];
    for (let m = start; m < start + PALETTE_PAGE_SIZE && m <= PALETTE_LAST_MEMBER; m++) {
      const code = byMember.get(m);
      if (code) {
        out.push(code);
      }
    }
    if (page === ORIGINAL_PALETTE_PAGES) {
      out.push(...added.slice(0, PAGE_10_FREE).map((t) => t.code));
    }
    return out;
  }
  return [];
}

/**
 * The tile codes on palette page `page` (1..`PALETTE_PAGES`), in sprite order 5-64.
 */
export function palettePage(page: number): string[] {
  return palettePageOf(tilesData.catalogue, page);
}

/** Step a palette page with wraparound across `pages` pages. */
export function stepPaletteOf(page: number, delta: 1 | -1, pages: number): number {
  const n = page + delta;
  return n > pages ? 1 : n < 1 ? pages : n;
}

/** The next palette page: `+ 1` wraps `PALETTE_PAGES` → 1, `- 1` wraps 1 → `PALETTE_PAGES`. */
export function stepPalette(page: number, delta: 1 | -1): number {
  return stepPaletteOf(page, delta, PALETTE_PAGES);
}

/** Every tile code the palette offers: the only codes a save may hold. */
export const PALETTE_CODES: ReadonlySet<string> = new Set(
  Array.from({ length: PALETTE_PAGES }, (_, i) => palettePage(i + 1)).flat(),
);

/**
 * The BLOCKED TILE box (sprite 142): ticked (`YAY`) when the selected tile is not on the walkable
 * whitelist.
 */
export function tileBlocked(code: string): boolean {
  return !isWhitelisted(code);
}

/** Splits rows into a 12 × 17 grid of codes (`line[y].word[x]`). */
function grid(rows: readonly string[]): string[][] {
  return Array.from({ length: MAP_HEIGHT }, (_, y) =>
    Array.from({ length: MAP_WIDTH }, (_, x) => lingoWord(rows[y] ?? "", x + 1)),
  );
}

function rowsOf(g: string[][]): string[] {
  return g.map((r) => r.join(" "));
}

export type Brush = "pencil" | "bucket" | "fat";

/**
 * One paint at tile (x, y) of a layer: returns the new rows. brush 2 fills the whole layer
 * first, 3 paints the plus shape bounded by the map dimensions (`MAP_WIDTH` × `MAP_HEIGHT`); then
 * the tile itself is always put.
 */
export function paint(
  rows: readonly string[],
  brush: Brush,
  code: string,
  x: number,
  y: number,
): string[] {
  const g = grid(rows);
  const put = (px: number, py: number) => {
    const row = g[py - 1];
    if (row && px >= 1 && px <= MAP_WIDTH) {
      row[px - 1] = code;
    }
  };
  if (brush === "bucket") {
    for (let py = 1; py <= MAP_HEIGHT; py++) {
      for (let px = 1; px <= MAP_WIDTH; px++) {
        put(px, py);
      }
    }
  }
  if (brush === "fat") {
    put(x, y);
    if (x + 1 <= MAP_WIDTH) {
      put(x + 1, y);
    }
    if (x - 1 >= 1) {
      put(x - 1, y);
    }
    if (y - 1 >= 1) {
      put(x, y - 1);
    }
    if (y + 1 <= MAP_HEIGHT) {
      put(x, y + 1);
    }
  }
  put(x, y);
  return rowsOf(g);
}

/** The three faction boxes, sprites 150 (W), 151 (M) and 152 (A). */
export interface FactionBoxes {
  w: boolean;
  m: boolean;
  a: boolean;
}

/**
 * A click on a faction box: W, M and A are mutually exclusive, clearing the other two and toggling
 * themselves.
 */
export function clickFaction(b: FactionBoxes, which: "w" | "m" | "a"): FactionBoxes {
  if (which === "w") {
    return { w: !b.w, m: false, a: false };
  }
  if (which === "m") {
    return { w: false, m: !b.m, a: false };
  }
  return { w: false, m: false, a: !b.a };
}

/** Item 2 from the boxes: the last ticked of W, M, A wins, else "X". */
export function factionFlag(b: FactionBoxes): string {
  return b.a ? "A" : b.m ? "M" : b.w ? "W" : "X";
}

/** The boxes as a loaded map sets them. */
export function factionBoxes(fctSpwn: string): FactionBoxes {
  const f = fctSpwn.toUpperCase();
  return { w: f === "W", m: f === "M", a: f === "A" };
}

/** The four layer buttons, sprites 93 (S), 90 (3), 91 (2) and 92 (1), top to bottom. */
export interface LayerButtons {
  /** `xLayer`: the layer the brush paints. */
  layer: 1 | 2 | 3 | 4;
  /** Which buttons show their "on" member. */
  lit: { s: boolean; l3: boolean; l2: boolean; l1: boolean };
}

/** The buttons on entry: layer 1, `l1on` lit (the score's members on channels 90-93). */
export const START_LAYERS: LayerButtons = {
  layer: 1,
  lit: { s: false, l3: false, l2: false, l1: true },
};

/**
 * A click on a layer button: clicking a lit button does nothing (keeps that single layer selected),
 * and clicking an unlit button selects and lights only that layer.
 */
export function clickLayer(b: LayerButtons, button: "s" | "l3" | "l2" | "l1"): LayerButtons {
  if (b.lit[button]) {
    return b;
  }
  const layer = button === "s" ? 4 : button === "l3" ? 3 : button === "l2" ? 2 : 1;
  return {
    layer,
    lit: { s: button === "s", l3: button === "l3", l2: button === "l2", l1: button === "l1" },
  };
}

const row = (code: string) => Array(MAP_WIDTH).fill(code).join(" ");

/**
 * What LOAD shows for a map that does not exist: the blank-map field, used when the reply has
 * no `#`. Layer 1 is `TILE_DEFAULTS.ground` (H1), layers 2 and 3 are `TILE_DEFAULTS.empty` (G3)
 * with one `TILE_DEFAULTS.shadow` (5A) mark on layer 3 at (7, 6) because the field has it, layer S
 * `TILE_DEFAULTS.shadow` (5A); field 12 `O:O:X:None`, so SAFE AREA is ticked and the faction item
 * is "O" (no box); no header, signs, exits or fog. No mobs or items exist for it.
 */
export function blankMap(mx: number, my: number): EditorMap {
  const l3 = Array.from({ length: MAP_HEIGHT }, () => row(TILE_DEFAULTS.empty));
  const l3Row6 = Array<string>(MAP_WIDTH).fill(TILE_DEFAULTS.empty);
  l3Row6[6] = TILE_DEFAULTS.shadow;
  l3[5] = l3Row6.join(" ");
  return {
    mx,
    my,
    layers: [
      Array.from({ length: MAP_HEIGHT }, () => row(TILE_DEFAULTS.ground)),
      Array.from({ length: MAP_HEIGHT }, () => row(TILE_DEFAULTS.empty)),
      l3,
      Array.from({ length: MAP_HEIGHT }, () => row(TILE_DEFAULTS.shadow)),
    ],
    flags: { canFight: "O", fctSpwn: "O", isIndoors: "X", canPvp: "X" },
    header: "",
    signs: ["", "", ""],
    exit1: null,
    exit2: null,
    fog: { ...NO_FOG },
    mobs: [null, null, null, null],
    items: [],
  };
}

const lower = (list: readonly string[]) => new Set(list.map((s) => s.toLowerCase()));
const MOB_NAMES = lower([...EDITOR_MONSTERS, ...EDITOR_NPCS]);
const FOG_NAMES = lower(FOG_TEXTURES);

/** The canonical list spelling of a placed name (comparison ignores case), or null. */
export function editorMobName(name: string): string | null {
  const want = name.toLowerCase();
  return (
    EDITOR_MONSTERS.find((n) => n.toLowerCase() === want) ??
    EDITOR_NPCS.find((n) => n.toLowerCase() === want) ??
    null
  );
}

/** Why an exit cannot be saved, or null: it needs a whole-number map and a tile on the map. */
export function exitError(e: MapExit | null): string | null {
  return e && !(Number.isInteger(e.mx) && Number.isInteger(e.my) && inTile(e.x, e.y))
    ? "An exit needs a whole-number map and a tile on the map."
    : null;
}

const inTile = (x: number, y: number) =>
  Number.isInteger(x) &&
  Number.isInteger(y) &&
  x >= 1 &&
  x <= MAP_WIDTH &&
  y >= 1 &&
  y <= MAP_HEIGHT;

/**
 * Why a save is refused, or null when it is valid (editor writes are validated). `itemOk` says
 * whether a placed item name may exist on the ground (the `/drop` rule, server-side).
 */
export function editorMapError(m: EditorMap, itemOk: (name: string) => boolean): string | null {
  for (let l = 0; l < 4; l++) {
    const rows = m.layers[l] ?? [];
    if (rows.length !== MAP_HEIGHT) {
      return `Layer ${l + 1} must have ${MAP_HEIGHT} rows.`;
    }
    for (const r of rows) {
      const codes = r.split(" ");
      if (codes.length !== MAP_WIDTH || codes.some((c) => !PALETTE_CODES.has(c))) {
        return `Layer ${l + 1} has a row that is not ${MAP_WIDTH} palette tiles.`;
      }
    }
  }
  const f = m.flags;
  if (![f.canFight, f.isIndoors, f.canPvp].every((v) => v === "O" || v === "X")) {
    return "A map flag is not O or X.";
  }
  if (!["X", "W", "M", "A", "O"].includes(f.fctSpwn)) {
    return "The faction flag is not W, M, A or X.";
  }
  if (m.header.length > HEADER_MAX || m.signs.some((s) => s.length > SIGN_MAX)) {
    return "A header or sign is too long.";
  }
  for (const e of [m.exit1, m.exit2]) {
    const bad = exitError(e);
    if (bad) {
      return bad;
    }
  }
  const fog = m.fog;
  if (
    !FOG_NAMES.has(fog.tex.toLowerCase()) ||
    !BLEND_LEVELS.includes(fog.blend) ||
    ![fog.r, fog.g, fog.b].every((c) => Number.isInteger(c) && c >= 0 && c <= 255)
  ) {
    return "The fog settings are not valid.";
  }
  for (const mob of m.mobs) {
    if (mob && (!MOB_NAMES.has(mob.name.toLowerCase()) || !inTile(mob.x, mob.y))) {
      return "A placed monster is not on the lists or not on the map.";
    }
  }
  if (m.items.length > EDITOR_ITEM_SLOTS) {
    return `At most ${EDITOR_ITEM_SLOTS} items can be placed.`;
  }
  for (const it of m.items) {
    if (!itemOk(it.name) || !inTile(it.x, it.y)) {
      return "A placed item is not a known item or not on the map.";
    }
  }
  return null;
}

/** The four text fields of an exit panel: map x, map y, tile x, tile y. */
export type ExitFields = [string, string, string, string];

export const EMPTY_EXIT_FIELDS: ExitFields = ["", "", "", ""];

/**
 * The exit panel's fields after LOAD: resets to empty fields when the map has no exit so a save
 * never recreates a stale exit from an earlier map.
 */
export function exitFieldsAfterLoad(e: MapExit | null): ExitFields {
  if (!e) {
    return [...EMPTY_EXIT_FIELDS];
  }
  const h = e.house ? `H${e.house}` : "";
  return [`${h}${e.mx}`, `${h}${e.my}`, String(e.x), String(e.y)];
}

/**
 * An exit from its fields as SAVE writes them: all empty is no exit; anything else must be whole
 * numbers, which the server checks (`editorMapError`).
 */
export function exitFromFields(f: ExitFields): MapExit | null {
  if (f.every((v) => v.trim() === "")) {
    return null;
  }
  // A house's exit shows as `H1<mx>`/`H1<my>` (or H2), as the build wrote it.
  const hx = /^H([12])(-?\d+)$/i.exec(f[0].trim());
  const hy = /^H([12])(-?\d+)$/i.exec(f[1].trim());
  // A blank field among filled ones is no number (not 0), so the save check refuses the exit.
  const num = (v: string) => (v.trim() === "" ? Number.NaN : Number(v.trim()));
  const [, , x, y] = f.map(num);
  if (hx && hy && hx[1] === hy[1]) {
    return {
      mx: Number(hx[2]),
      my: Number(hy[2]),
      x: x ?? Number.NaN,
      y: y ?? Number.NaN,
      house: hx[1] === "1" ? 1 : 2,
    };
  }
  const [mx, my] = f.map(num);
  return { mx: mx ?? Number.NaN, my: my ?? Number.NaN, x: x ?? Number.NaN, y: y ?? Number.NaN };
}
