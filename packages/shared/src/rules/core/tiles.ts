/**
 * Tile flags and single-valued tile defaults read from `@secondstaronline/data`.
 */
import { type TileFlag as DataTileFlag, tilesData } from "@secondstaronline/data";

export type TileFlag = "sea" | "airshipBlock" | "dock" | "arena" | "grave";

const _flagCheck: Record<DataTileFlag, TileFlag> = {
  sea: "sea",
  airshipBlock: "airshipBlock",
  dock: "dock",
  arena: "arena",
  grave: "grave",
} satisfies Record<TileFlag, DataTileFlag>;
void _flagCheck;

const CODES_BY_FLAG: Record<TileFlag, readonly string[]> = {
  sea: [],
  airshipBlock: [],
  dock: [],
  arena: [],
  grave: [],
};

const LOWER_SETS_BY_FLAG: Record<TileFlag, ReadonlySet<string>> = {
  sea: new Set(),
  airshipBlock: new Set(),
  dock: new Set(),
  arena: new Set(),
  grave: new Set(),
};

for (const tile of tilesData.catalogue) {
  if (!tile.flags) {
    continue;
  }
  for (const flag of tile.flags) {
    (CODES_BY_FLAG[flag] as string[]).push(tile.code);
    (LOWER_SETS_BY_FLAG[flag] as Set<string>).add(tile.code.toLowerCase());
  }
}

/** Catalogue tile codes carrying `flag`, in catalogue order. */
export function tileCodes(flag: TileFlag): readonly string[] {
  return CODES_BY_FLAG[flag];
}

/** Whether `code` has `flag` (case-insensitive comparison against the flagged catalogue codes). */
export function tileHas(code: string, flag: TileFlag): boolean {
  return LOWER_SETS_BY_FLAG[flag].has(code.toLowerCase());
}

/** Single-valued tile defaults (`ground`, `empty`, `shadow`, `editorTile`). */
export const TILE_DEFAULTS = tilesData.defaults;
