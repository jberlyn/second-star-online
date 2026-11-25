/**
 * The vehicles as content rows (issue #44): `houses.json` `vehicles`, each keyed by its name, which
 * is what a character rides and what a parked one is called (`Bob's Boat`). The engine keeps the
 * mechanics (crossing tiles, boarding from a shore or a pad, parking, the hull, sinking, the
 * cannon's shot); a row picks the options. A name no row has (a vehicle since removed) rides and
 * parks as nothing: a rider is on foot to every rule, and a parked one is an ordinary item.
 *
 * Pure lookups over the content store, rebuilt on every install.
 */
import type { TileSet, VehicleRow } from "@secondstaronline/data";

import { MAP_HEIGHT, MAP_WIDTH } from "../../constants.ts";
import { content, onContent } from "../../content/store.ts";
import { lingoWord } from "../core/lingo.ts";
import { FLAG_LAYER, tileHas } from "../core/tiles.ts";

export type { TileSet, VehicleRow };

/** A vehicle's name (a `vehicles` row's key): `Boat`, `Battleship`, `Airship` in Classic. */
export type Vehicle = string;

let BY_NAME = new Map<string, VehicleRow>();
let BY_BODY = new Map<number, VehicleRow>();
/** `'s <name>` endings (lower case) with their rows, longest first. */
let ENDINGS: (readonly [string, VehicleRow])[] = [];

onContent((c) => {
  const rows = c.houses.vehicles ?? [];
  BY_NAME = new Map(rows.map((r) => [r.name.toLowerCase(), r]));
  BY_BODY = new Map();
  for (const r of rows) {
    // Two rows with one rider body are refused at publish; the first keeps it meanwhile.
    if (!BY_BODY.has(r.rider)) {
      BY_BODY.set(r.rider, r);
    }
  }
  ENDINGS = rows
    .map((r) => [`'s ${r.name.toLowerCase()}`, r] as const)
    .sort((a, b) => b[0].length - a[0].length);
});

/** The world's vehicle rows, in content order. */
export function vehicleRows(): readonly VehicleRow[] {
  return content().houses.vehicles ?? [];
}

/** Whether the world has any vehicle. */
export function vehiclesExist(): boolean {
  return BY_NAME.size > 0;
}

/** A vehicle's row by its name (case ignored), or null for none or a name no row has. */
export function vehicleRow(vehicle: Vehicle | null | undefined): VehicleRow | null {
  return vehicle ? (BY_NAME.get(vehicle.toLowerCase()) ?? null) : null;
}

/** A `pad` vehicle flies (the Airship's mechanics). */
export function vehicleFlies(vehicle: Vehicle | null | undefined): boolean {
  return vehicleRow(vehicle)?.boards === "pad";
}

/** A `shore` vehicle sails (the Boat's mechanics). */
export function vehicleSails(vehicle: Vehicle | null | undefined): boolean {
  return vehicleRow(vehicle)?.boards === "shore";
}

/** The body a rider of the vehicle shows, or null when no row has the name. */
export function riderBody(vehicle: Vehicle | null | undefined): number | null {
  return vehicleRow(vehicle)?.rider ?? null;
}

/** The vehicle a body number means: a vehicle's rider body (Classic's 55-57), or null. */
export function vehicleOfBody(body: number | null | undefined): Vehicle | null {
  return body === null || body === undefined ? null : (BY_BODY.get(body)?.name ?? null);
}

/** The vehicle a parked ground item is (`<owner>'s <vehicle>`, case ignored), or null. */
export function vehicleOfItem(item: string): Vehicle | null {
  const lower = item.toLowerCase();
  const hit = ENDINGS.find(([e]) => lower.length > e.length && lower.endsWith(e));
  return hit ? hit[1].name : null;
}

/** What a vehicle's lines call it, as written: its `display`, else its name. */
export function vehicleTitle(vehicle: Vehicle): string {
  const row = vehicleRow(vehicle);
  return row?.display ?? row?.name ?? vehicle;
}

/** A vehicle's name in a sentence, lower case: "boat", "battleship", "airship". */
export function vehicleNoun(vehicle: Vehicle): string {
  return vehicleTitle(vehicle).toLowerCase();
}

/** Whether a vehicle goes on the sea (its `over` names the `sea` flag): 1.6's water lines. */
export function seaGoing(vehicle: Vehicle): boolean {
  const over = vehicleRow(vehicle)?.moves.over;
  return over !== undefined && over !== "any" && (over.flags ?? []).includes("sea");
}

/**
 * Whether a tile, by its layer-1 and layer-2 codes, is one of a set: a flag read on the layer it
 * lives on, a code on either layer (case ignored).
 */
export function tileSetHas(set: TileSet, layer1Code: string, layer2Code: string): boolean {
  for (const flag of set.flags ?? []) {
    if (tileHas(FLAG_LAYER[flag] === 1 ? layer1Code : layer2Code, flag)) {
      return true;
    }
  }
  const a = layer1Code.toLowerCase();
  const b = layer2Code.toLowerCase();
  return (set.codes ?? []).some((c) => {
    const l = c.toLowerCase();
    return l === a || l === b;
  });
}

/** Whether a vehicle crosses a tile with these layer-1 and layer-2 codes (`moves`). */
export function vehicleCrosses(row: VehicleRow, layer1Code: string, layer2Code: string): boolean {
  const { over, except } = row.moves;
  if (over !== "any" && !tileSetHas(over, layer1Code, layer2Code)) {
    return false;
  }
  return !except || !tileSetHas(except, layer1Code, layer2Code);
}

/** Layers 1 and 2's codes at map tile (x, y); "" off the map. */
function codesAt(
  layer1: readonly string[],
  layer2: readonly string[],
  x: number,
  y: number,
): [string, string] {
  if (x < 1 || x > MAP_WIDTH || y < 1 || y > MAP_HEIGHT) {
    return ["", ""];
  }
  return [lingoWord(layer1[y - 1] ?? "", x), lingoWord(layer2[y - 1] ?? "", x)];
}

/** Whether a vehicle may move onto map tile (x, y); never off the map (the edge rule decides). */
export function vehicleCrossesAt(
  row: VehicleRow,
  layer1: readonly string[],
  layer2: readonly string[],
  x: number,
  y: number,
): boolean {
  if (x < 1 || x > MAP_WIDTH || y < 1 || y > MAP_HEIGHT) {
    return false;
  }
  const [a, b] = codesAt(layer1, layer2, x, y);
  return vehicleCrosses(row, a, b);
}

/** Whether map tile (x, y) is one of a `pad` vehicle's landing pads (`lands`). */
export function vehicleLandsAt(
  row: VehicleRow,
  layer1: readonly string[],
  layer2: readonly string[],
  x: number,
  y: number,
): boolean {
  if (!row.lands || x < 1 || x > MAP_WIDTH || y < 1 || y > MAP_HEIGHT) {
    return false;
  }
  const [a, b] = codesAt(layer1, layer2, x, y);
  return tileSetHas(row.lands, a, b);
}

/**
 * A vehicle's walk grid, `grid[y-1][x-1]`, as `footWalkGrid`'s. Classic's Boat crosses layer-1
 * sea (W1 N1 D2 I2 V2): layer 2's shoreline art over the water does not stop it, so it can reach
 * the shore (1.6 named a water grid but never built it, so its ships would have sailed over land:
 * an SSO addition). Classic's Airship crosses everything but layer-2 `airshipBlock` tiles.
 */
export function vehicleWalkGrid(
  row: VehicleRow,
  layer1: readonly string[],
  layer2: readonly string[],
): boolean[][] {
  const grid: boolean[][] = [];
  for (let y = 1; y <= MAP_HEIGHT; y++) {
    const r: boolean[] = [];
    for (let x = 1; x <= MAP_WIDTH; x++) {
      r.push(vehicleCrossesAt(row, layer1, layer2, x, y));
    }
    grid.push(r);
  }
  return grid;
}
