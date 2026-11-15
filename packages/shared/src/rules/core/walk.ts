/**
 * Tile walkability on foot — the walkable whitelist (the tile data's
 * `blockedListX` list).
 *
 * Ported from `RenderMap`:
 * - The walkable list is the blocked-list field, a CR-separated list of the codes that may be
 *   walked on.
 * - Layer 1, on foot (no vehicle): blocked unless the walkable list contains the tile.
 *   Water W1 N1 D2 I2 V2 only skips the red debug overlay; it still blocks.
 * - Layer 2, on foot (no boat or airship flag): the same test. The do-not-block list
 *   (M5 Q5 … Q7) only changes the overlay; both branches block alike.
 *
 * The Airship grid is `airshipWalkGrid`. Not yet ported (later slices): the minute-dependent skull
 * swap 9C-9F → Sk11-Sk24, and the Boat, monster and sea-creature grids.
 */
import { tilesData } from "@secondstaronline/data";

import { MAP_HEIGHT, MAP_WIDTH } from "../../constants.ts";
import { lingoContains, lingoWord } from "./lingo.ts";
import { tileCodes, tileHas } from "./tiles.ts";

/**
 * The blocked-list field text (`WALK_WHITELIST`): one code per line, CR-terminated, as in the cast
 * member.
 */
export const WALK_WHITELIST: string = `${tilesData.walkable.map((t) => t.code).join("\r")}\r`;

/**
 * Whether the walkable list contains the tile: a missing word (EMPTY) is contained, so it is
 * walkable.
 */
export function isWhitelisted(code: string, whitelist: string = WALK_WHITELIST): boolean {
  return lingoContains(whitelist, code);
}

/** On foot, a tile blocks when its layer-1 or layer-2 code is not on the whitelist. */
export function footBlocked(
  layer1Code: string,
  layer2Code: string,
  whitelist: string = WALK_WHITELIST,
): boolean {
  return !isWhitelisted(layer1Code, whitelist) || !isWhitelisted(layer2Code, whitelist);
}

/**
 * Walk grid for a player on foot. `layer1` and `layer2` are the 12 map rows, each a line of
 * space-separated tile codes. Returns `grid[y-1][x-1] === true` when (x, y) is walkable.
 */
export function footWalkGrid(
  layer1: readonly string[],
  layer2: readonly string[],
  whitelist: string = WALK_WHITELIST,
): boolean[][] {
  const grid: boolean[][] = [];
  for (let y = 1; y <= MAP_HEIGHT; y++) {
    const row: boolean[] = [];
    const line1 = layer1[y - 1] ?? "";
    const line2 = layer2[y - 1] ?? "";
    for (let x = 1; x <= MAP_WIDTH; x++) {
      row.push(!footBlocked(lingoWord(line1, x), lingoWord(line2, x), whitelist));
    }
    grid.push(row);
  }
  return grid;
}

/** Off-screen is not "walkable" here: edge crossing is handled by the edge-wrap rule. */
export function isWalkable(grid: readonly (readonly boolean[])[], x: number, y: number): boolean {
  return grid[y - 1]?.[x - 1] === true;
}

/**
 * Layer-2 codes that block an Airship (the airship flag set): D8 I8 E8 J8 K8 L8, matched
 * ignoring case.
 */
export const AIRSHIP_BLOCK: readonly string[] = tileCodes("airshipBlock");

/**
 * Walk grid for a player aboard an Airship: blocked only where the map data row, layer 2, holds one
 * of `AIRSHIP_BLOCK`. Water, walls and trees do not stop it. Same shape as `footWalkGrid`.
 */
export function airshipWalkGrid(layer2: readonly string[]): boolean[][] {
  const grid: boolean[][] = [];
  for (let y = 1; y <= MAP_HEIGHT; y++) {
    const row: boolean[] = [];
    const line = layer2[y - 1] ?? "";
    for (let x = 1; x <= MAP_WIDTH; x++) {
      const code = lingoWord(line, x);
      row.push(!tileHas(code, "airshipBlock"));
    }
    grid.push(row);
  }
  return grid;
}
