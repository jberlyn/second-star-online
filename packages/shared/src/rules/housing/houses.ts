/**
 * Housing rules: deeds, the placement ghost and checks, the build, the do-not-drop flag, rest regen and the
 * decay list. Pure functions over `houseData`, the generated house records.
 */
import { type HouseType, houseData } from "@secondstaronline/data";

import type { MapExit } from "../admin/worldedit.ts";
import { lingoContains, lingoEq } from "../core/lingo.ts";
import { houseMapName } from "../core/maps.ts";
import { TILE_DEFAULTS } from "../core/tiles.ts";
import type { Vehicle } from "../movement/movement.ts";

export type { HouseType };

export type StageRect = { left: number; top: number; right: number; bottom: number };

export type DeedUse =
  | { kind: "nothing"; text: string | null }
  | { kind: "vehicle"; vehicle: Vehicle }
  | { kind: "place"; type: HouseType };

/**
 * What a deed's Use does: build a vehicle, place a house, or nothing. A deed that builds nothing
 * (the Stone Guild Hall, which has no art or template) says why and is kept.
 */
export function deedUse(item: string): DeedUse | null {
  const d = houseData.deeds.find((x) => lingoEq(x.deed, item));
  if (!d) {
    return null;
  }
  if (d.use === "airship" || d.use === "boat" || d.use === "battleship") {
    const vehicle = ({ airship: "Airship", boat: "Boat", battleship: "Battleship" } as const)[
      d.use
    ];
    return { kind: "vehicle", vehicle };
  }
  const type = d.use === "place" ? houseType(d.house ?? "") : null;
  return type ? { kind: "place", type } : { kind: "nothing", text: d.text };
}

export function houseType(house: string): HouseType | null {
  return houseData.types.find((t) => lingoEq(t.house, house)) ?? null;
}

/**
 * The ghost's stage rect over the hovered tile: sprite 360 at `(32·x + 15, 32·y + 13)` plus the
 * type's shift, drawn by its member's size and regpoint.
 */
export function ghostRect(t: HouseType, hx: number, hy: number): StageRect {
  const h = hx * 32 + houseData.ghost.baseX + t.ghost.shiftX;
  const v = hy * 32 + houseData.ghost.baseY + t.ghost.shiftY;
  const left = h - t.ghost.regX;
  const top = v - t.ghost.regY;
  return { left, top, right: left + t.ghost.width, bottom: top + t.ghost.height };
}

/** The footprint's top-left tile: one up and one left of the hovered tile, for every house. */
export function houseAnchor(t: HouseType, hx: number, hy: number): { x: number; y: number } {
  return { x: hx + t.anchor.dx, y: hy + t.anchor.dy };
}

const wordAt = (rows: readonly string[], x: number, y: number): string =>
  (rows[y - 1] ?? "").split(" ").filter((w) => w !== "")[x - 1] ?? "";

/**
 * The ground under the whole footprint, on every row: each layer-1 tile must be one of the build
 * codes (`8R`, `8U`, `8V`, exact, case ignored) and each layer-2 tile `G3` (a 17-wide row has no
 * word 18, so nothing hangs off the map).
 */
export function terrainOk(
  t: HouseType,
  ax: number,
  ay: number,
  layer1: readonly string[],
  layer2: readonly string[],
): boolean {
  const codes = houseData.placement.terrain.layer1Codes;
  for (let dy = 0; dy < t.footprint.h; dy++) {
    for (let dx = 0; dx < t.footprint.w; dx++) {
      const ground = wordAt(layer1, ax + dx, ay + dy);
      if (!codes.some((c) => lingoEq(c, ground))) {
        return false;
      }
      if (!lingoEq(wordAt(layer2, ax + dx, ay + dy), TILE_DEFAULTS.empty)) {
        return false;
      }
    }
  }
  return true;
}

/** Whether tile (x, y) is under the footprint of a house anchored at `a`. */
export function inFootprint(t: HouseType, a: { x: number; y: number }, x: number, y: number) {
  return x >= a.x && x < a.x + t.footprint.w && y >= a.y && y < a.y + t.footprint.h;
}

export interface PlacementInput {
  type: HouseType;
  /** The hovered tile (before the correction). */
  hx: number;
  hy: number;
  layer1: readonly string[];
  layer2: readonly string[];
  /** The tiles taken by ground items, monsters and players on the map (the builder too). */
  obstacles: readonly { x: number; y: number }[];
  hasExit: boolean;
  hasExit2: boolean;
  /** The builder's guild, or "" (TempSave `Guild`). */
  guild: string;
}

export type PlacementResult =
  | { ok: false; text: string }
  | { ok: true; anchor: { x: number; y: number }; slot: 1 | 2 };

/**
 * The click's checks in 1.6's order: edges, terrain, overlap, slots, guild. The > 17 ground-item
 * refusal is lifted (an SSO divergence).
 */
export function checkPlacement(i: PlacementInput): PlacementResult {
  const pl = houseData.placement;
  const a = houseAnchor(i.type, i.hx, i.hy);
  const e = pl.edge;
  if (a.x < e.minX || a.y < e.minY || a.x > e.maxX || a.y > e.maxY) {
    return { ok: false, text: e.text };
  }
  if (!terrainOk(i.type, a.x, a.y, i.layer1, i.layer2)) {
    return { ok: false, text: pl.terrain.text };
  }
  if (i.obstacles.some((o) => inFootprint(i.type, a, o.x, o.y))) {
    return { ok: false, text: pl.obstacles };
  }
  if (i.hasExit && i.hasExit2) {
    return { ok: false, text: pl.slots };
  }
  if (i.guild === "" && lingoContains(i.type.house, "Guild")) {
    return { ok: false, text: pl.guild };
  }
  return { ok: true, anchor: a, slot: i.hasExit ? 2 : 1 };
}

const fill = (s: string, owner: string, guild: string) =>
  s.replaceAll("<name>", owner).replaceAll("<guild>", guild);

export interface HousePlan {
  interior: string;
  /** The outdoor exit field (13 for slot 1, 18 for slot 2). */
  exit: MapExit;
  outdoorItems: { item: string; x: number; y: number }[];
  /** Layer-2 tiles, written only where the map still holds `G3`. */
  tiles: { code: string; x: number; y: number }[];
  title: string;
  /** Field 16, the Sign 3 slot: the owner. */
  sign3: string;
  /** Field 13 of the interior: back to the tile below the outdoor Exit. */
  exitBack: MapExit;
  interiorItems: { item: string; x: number; y: number }[];
  /** The blueprint's item 1 (mailbox or lamp, as recorded) and item 2 (the exit). */
  item1: { item: string; x: number; y: number } | null;
  item2: { item: string; x: number; y: number };
}

/** What the house builder writes, for a house at `anchor` on map (mx, my). */
export function planHouse(
  t: HouseType,
  anchor: { x: number; y: number },
  slot: 1 | 2,
  mx: number,
  my: number,
  owner: string,
  guild: string,
): HousePlan {
  const b = houseData.build;
  const exitItem = {
    item: slot === 1 ? "Exit" : "Exit2",
    x: anchor.x + b.exit.dx,
    y: anchor.y + b.exit.dy,
  };
  const outdoorItems = [exitItem];
  let item1: HousePlan["item1"] = null;
  if (t.mailbox) {
    item1 = { item: `${owner}'s Mailbox`, x: anchor.x + b.mailbox.dx, y: anchor.y + b.mailbox.dy };
    outdoorItems.push(item1);
  }
  if (t.lamp) {
    item1 = { item: "Street Lamp", x: anchor.x + b.lamp.dx, y: anchor.y + b.lamp.dy };
    outdoorItems.push(item1);
  }
  return {
    interior: houseMapName(mx, my, slot),
    exit: { mx, my, x: b.arrival.x, y: b.arrival.y, house: slot },
    outdoorItems,
    tiles: t.tiles.map(([code, dx, dy]) => ({ code, x: anchor.x + dx, y: anchor.y + dy })),
    title: fill(b.headers[t.header], owner, guild),
    sign3: owner,
    exitBack: { mx, my, x: exitItem.x, y: exitItem.y + 1 },
    interiorItems: t.interiorItems.map((i) => ({ ...i, item: fill(i.item, owner, guild) })),
    item1,
    item2: exitItem,
  };
}

/**
 * The do-not-drop flag, worked out afresh from the room you are in: 0 where the header names you
 * ("<name>'s ", exactly; 1.6 matched by substring, so Bob passed in "Jimbob's House") or is exactly
 * "Hall of the <guild>" for your guild; 1 anywhere else. Nothing carries over from an earlier
 * click or drop.
 */
export function headDrop(header: string, name: string, guild: string): 0 | 1 {
  if (header.toLowerCase().startsWith(`${name.toLowerCase()}'s `)) {
    return 0;
  }
  if (guild !== "" && lingoEq(header, `Hall of the ${guild}`)) {
    return 0;
  }
  return 1;
}

export const isFurniture = (item: string): boolean =>
  houseData.furnitureDrop.items.some((f) => lingoEq(item, f));

/** Rest regen: `random(10) = 1` on a house map, then y < 11. */
export const REST_REGEN = houseData.restRegen;

/** The five-minute countdown: each online player's clock check refreshes their houses. */
export const HOUSE_CLOCK_FRAMES = houseData.decay.clockFrames;

/** A house goes once its owner's last month is this many calendar months back. */
export const HOUSE_STALE_MONTHS = houseData.decay.staleAfterMonths;

/** One house-list entry: the house (its interior) and the calendar month its owner was last seen. */
export interface HouseListEntry {
  ownerId: string;
  ownerName: string;
  map: string;
  /** The interior map the house built, which names the house (two houses can share a map). */
  interior: string;
  /** `YYYY-MM` in the house decay time zone. */
  month: string;
}

/** A `YYYY-MM` month as a count of months, or null when it is not one. */
export function monthIndex(month: string): number | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) {
    return null;
  }
  const mm = Number(m[2]);
  return mm >= 1 && mm <= 12 ? Number(m[1]) * 12 + mm - 1 : null;
}

/** The last-login update: every entry of the owner gets `month`. */
export function refreshOwner(list: HouseListEntry[], ownerId: string, month: string): boolean {
  let changed = false;
  for (const e of list) {
    if (e.ownerId === ownerId && e.month !== month) {
      e.month = month;
      changed = true;
    }
  }
  return changed;
}

/**
 * The decay sweep: each entry whose owner was last seen `HOUSE_STALE_MONTHS` or more months before
 * `month` (the year counts) demolishes that one house, once, and leaves the list. The owner's other
 * houses are judged by their own entries, and every removal stays removed.
 */
export function sweep(
  list: readonly HouseListEntry[],
  month: string,
): { demolish: HouseListEntry[]; list: HouseListEntry[] } {
  const now = monthIndex(month);
  if (now === null) {
    return { demolish: [], list: [...list] };
  }
  const stale = (e: HouseListEntry) => {
    const seen = monthIndex(e.month);
    return seen !== null && now - seen >= HOUSE_STALE_MONTHS;
  };
  // An entry with no interior (written before houses were named by it) stands for its owner and map.
  const key = (e: HouseListEntry) => e.interior || `${e.ownerId} ${e.map}`;
  const demolish: HouseListEntry[] = [];
  const gone = new Set<string>();
  for (const e of list) {
    if (stale(e) && !gone.has(key(e))) {
      gone.add(key(e));
      demolish.push({ ...e });
    }
  }
  return { demolish, list: list.filter((e) => !gone.has(key(e))) };
}
