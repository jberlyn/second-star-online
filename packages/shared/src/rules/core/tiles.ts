/**
 * Tile flags, hover names and single-valued tile defaults read from the content store, rebuilt on
 * every install.
 */
import type { TileFlag as DataTileFlag, TilesData } from "@secondstaronline/data";

import { onContent } from "../../content/store.ts";

export type TileFlag = "sea" | "airshipBlock" | "dock" | "arena" | "grave";

const _flagCheck: Record<DataTileFlag, TileFlag> = {
  sea: "sea",
  airshipBlock: "airshipBlock",
  dock: "dock",
  arena: "arena",
  grave: "grave",
} satisfies Record<TileFlag, DataTileFlag>;
void _flagCheck;

const noFlags = <T>(make: () => T): Record<TileFlag, T> => ({
  sea: make(),
  airshipBlock: make(),
  dock: make(),
  arena: make(),
  grave: make(),
});

let CODES_BY_FLAG: Record<TileFlag, string[]> = noFlags(() => []);
let LOWER_SETS_BY_FLAG: Record<TileFlag, Set<string>> = noFlags(() => new Set());
let NAMES = new Map<string, string>();
/** Single-valued tile defaults (`ground`, `empty`, `shadow`, `editorTile`). */
export let TILE_DEFAULTS: TilesData["defaults"];

onContent((c) => {
  CODES_BY_FLAG = noFlags(() => []);
  LOWER_SETS_BY_FLAG = noFlags(() => new Set());
  NAMES = new Map();
  TILE_DEFAULTS = c.tiles.defaults;
  for (const tile of c.tiles.catalogue) {
    for (const flag of tile.flags ?? []) {
      CODES_BY_FLAG[flag].push(tile.code);
      LOWER_SETS_BY_FLAG[flag].add(tile.code.toLowerCase());
    }
    if (tile.name) {
      NAMES.set(tile.code.toLowerCase(), tile.name);
    }
  }
});

/** Catalogue tile codes carrying `flag`, in catalogue order. */
export function tileCodes(flag: TileFlag): readonly string[] {
  return CODES_BY_FLAG[flag];
}

/** Whether `code` has `flag` (case-insensitive comparison against the flagged catalogue codes). */
export function tileHas(code: string, flag: TileFlag): boolean {
  return LOWER_SETS_BY_FLAG[flag].has(code.toLowerCase());
}

/**
 * What the playfield hover tip calls a layer-2 tile (`catalogue[].name`, compared in any case), or
 * null for a tile it never names. An SSO addition: 1.6 named no tiles.
 */
export function tileName(code: string): string | null {
  return NAMES.get(code.toLowerCase()) ?? null;
}
