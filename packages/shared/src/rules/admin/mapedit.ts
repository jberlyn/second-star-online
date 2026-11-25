/**
 * The Control Panel's World page's editing model (issue #33): pure operations on a map as the
 * editors hold it (`EditorMap`), the ones the in-game World Editor had (pencil, the fat brush, the
 * whole-layer bucket) and SSO's own (flood fill, rectangle fill, eyedropper, select with copy, cut
 * and paste, stamps, undo and redo). Coordinates are 1-based tiles, as the map files and the
 * in-game editor use them. Every operation returns a new map; nothing here touches the world.
 */
import { MAP_HEIGHT, MAP_WIDTH } from "../../constants.ts";
import { TILE_DEFAULTS } from "../core/tiles.ts";
import { type EditorMap, paint } from "./worldedit.ts";

/** A layer index: 0-2 are layers 1-3, 3 is layer S. */
export type LayerIndex = 0 | 1 | 2 | 3;
export const LAYERS: readonly LayerIndex[] = [0, 1, 2, 3];

/** What an emptied tile holds on a layer (a cut, a new map): ground, empty, empty, shadow. */
export function emptyTile(layer: LayerIndex): string {
  return layer === 0
    ? TILE_DEFAULTS.ground
    : layer === 3
      ? TILE_DEFAULTS.shadow
      : TILE_DEFAULTS.empty;
}

/** A rectangle of tiles, 1-based and inclusive, in any corner order. */
export interface TileRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The rectangle with its corners in order and kept on the map. */
export function normRect(r: TileRect): TileRect {
  const clampX = (n: number) => Math.min(MAP_WIDTH, Math.max(1, n));
  const clampY = (n: number) => Math.min(MAP_HEIGHT, Math.max(1, n));
  return {
    x0: clampX(Math.min(r.x0, r.x1)),
    y0: clampY(Math.min(r.y0, r.y1)),
    x1: clampX(Math.max(r.x0, r.x1)),
    y1: clampY(Math.max(r.y0, r.y1)),
  };
}

/** A layer's rows as a grid of codes, `g[y - 1][x - 1]`. */
export function gridOf(rows: readonly string[]): string[][] {
  return Array.from({ length: MAP_HEIGHT }, (_, y) => {
    const cells = (rows[y] ?? "").split(" ");
    return Array.from({ length: MAP_WIDTH }, (_, x) => cells[x] ?? "");
  });
}

/** A grid back as a layer's rows. */
export function rowsOfGrid(g: readonly (readonly string[])[]): string[] {
  return g.map((r) => r.join(" "));
}

/** The code at a tile of a layer ("" off the map). */
export function codeAt(map: EditorMap, layer: LayerIndex, x: number, y: number): string {
  return gridOf(map.layers[layer])[y - 1]?.[x - 1] ?? "";
}

/** The map with one layer's rows replaced. */
function withLayer(map: EditorMap, layer: LayerIndex, rows: string[]): EditorMap {
  const layers = [...map.layers] as EditorMap["layers"];
  layers[layer] = rows;
  return { ...map, layers };
}

/** The in-game editor's brushes: pencil, fat (a plus of five) and bucket (the whole layer). */
export function brush(
  map: EditorMap,
  layer: LayerIndex,
  kind: "pencil" | "fat" | "bucket",
  code: string,
  x: number,
  y: number,
): EditorMap {
  return withLayer(map, layer, paint(map.layers[layer], kind, code, x, y));
}

/** Flood fill: every tile joined to (x, y) by edges and holding its code takes `code`. */
export function floodFill(
  map: EditorMap,
  layer: LayerIndex,
  code: string,
  x: number,
  y: number,
): EditorMap {
  const g = gridOf(map.layers[layer]);
  const from = g[y - 1]?.[x - 1];
  if (from === undefined || from === code) {
    return map;
  }
  const todo: [number, number][] = [[x, y]];
  while (todo.length > 0) {
    const [px, py] = todo.pop() as [number, number];
    const row = g[py - 1];
    if (!row || px < 1 || px > MAP_WIDTH || row[px - 1] !== from) {
      continue;
    }
    row[px - 1] = code;
    todo.push([px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]);
  }
  return withLayer(map, layer, rowsOfGrid(g));
}

/** Every tile of a rectangle takes `code`. */
export function fillRect(map: EditorMap, layer: LayerIndex, code: string, r: TileRect): EditorMap {
  const n = normRect(r);
  const g = gridOf(map.layers[layer]);
  for (let y = n.y0; y <= n.y1; y++) {
    for (let x = n.x0; x <= n.x1; x++) {
      (g[y - 1] as string[])[x - 1] = code;
    }
  }
  return withLayer(map, layer, rowsOfGrid(g));
}

/** A copied rectangle: its size, and the codes of each layer it took (null for one it did not). */
export interface Clip {
  w: number;
  h: number;
  layers: [string[][] | null, string[][] | null, string[][] | null, string[][] | null];
}

/** Copies a rectangle of the given layers. */
export function copyRect(map: EditorMap, r: TileRect, layers: readonly LayerIndex[]): Clip {
  const n = normRect(r);
  const clip: Clip = { w: n.x1 - n.x0 + 1, h: n.y1 - n.y0 + 1, layers: [null, null, null, null] };
  for (const l of layers) {
    const g = gridOf(map.layers[l]);
    clip.layers[l] = g.slice(n.y0 - 1, n.y1).map((row) => row.slice(n.x0 - 1, n.x1));
  }
  return clip;
}

/** Empties a rectangle of the given layers (`EMPTY_TILE`): a cut, or Delete on a selection. */
export function clearRect(map: EditorMap, r: TileRect, layers: readonly LayerIndex[]): EditorMap {
  let m = map;
  for (const l of layers) {
    m = fillRect(m, l, emptyTile(l), r);
  }
  return m;
}

/** Pastes a clip with its top-left corner at (x, y); what falls off the map is left out. */
export function pasteClip(map: EditorMap, clip: Clip, x: number, y: number): EditorMap {
  let m = map;
  for (const l of LAYERS) {
    const src = clip.layers[l];
    if (!src) {
      continue;
    }
    const g = gridOf(m.layers[l]);
    src.forEach((row, dy) => {
      row.forEach((code, dx) => {
        const tx = x + dx;
        const ty = y + dy;
        if (tx >= 1 && tx <= MAP_WIDTH && ty >= 1 && ty <= MAP_HEIGHT) {
          (g[ty - 1] as string[])[tx - 1] = code;
        }
      });
    });
    m = withLayer(m, l, rowsOfGrid(g));
  }
  return m;
}

/**
 * Undo and redo over whole maps (a map is small: four layers of 12 rows). `push` records the map
 * as it was before a change; a new change after an undo drops the redo side.
 */
export class MapHistory {
  private past: EditorMap[] = [];
  private future: EditorMap[] = [];
  constructor(private readonly limit = 200) {}

  /** Records `before`, the map as it was before a change now being made. */
  push(before: EditorMap): void {
    this.past.push(structuredClone(before));
    if (this.past.length > this.limit) {
      this.past.shift();
    }
    this.future = [];
  }

  /** The map to show after an undo, given the map shown now; null with nothing to undo. */
  undo(now: EditorMap): EditorMap | null {
    const prev = this.past.pop();
    if (!prev) {
      return null;
    }
    this.future.push(structuredClone(now));
    return prev;
  }

  /** The map to show after a redo; null with nothing to redo. */
  redo(now: EditorMap): EditorMap | null {
    const next = this.future.pop();
    if (!next) {
      return null;
    }
    this.past.push(structuredClone(now));
    return next;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }
  clear(): void {
    this.past = [];
    this.future = [];
  }
}
