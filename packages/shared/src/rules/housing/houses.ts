/**
 * Housing rules: deeds, the placement ghost and checks, the build, the do-not-drop flag, rest regen and the
 * decay list. Pure functions over `houseData`, the generated house records.
 */
import { type HouseType, houseData } from "@secondstaronline/data";

import type { MapExit } from "../admin/worldedit.ts";
import { lingoContains, lingoEq } from "../core/lingo.ts";
import { houseMapName } from "../core/maps.ts";
import { TILE_DEFAULTS } from "../core/tiles.ts";
import { rectsIntersect } from "../spells/spellfx.ts";

export type { HouseType };

export type StageRect = { left: number; top: number; right: number; bottom: number };

/** What a deed's Use does: nothing, the airship, or placement. */
export function deedUse(
  item: string,
): { kind: "nothing" | "airship" } | { kind: "place"; type: HouseType } | null {
  const d = houseData.deeds.find((x) => lingoEq(x.deed, item));
  if (!d) {
    return null;
  }
  if (d.use !== "place") {
    return { kind: d.use };
  }
  // Stone Guild Hall sets the current house but has no art, template or builder.
  const type = houseData.types.find((t) => lingoEq(t.house, d.house ?? ""));
  return type ? { kind: "place", type } : { kind: "nothing" };
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

/** The footprint's top-left tile: the Small Farm keeps the hovered row. */
export function houseAnchor(t: HouseType, hx: number, hy: number): { x: number; y: number } {
  return { x: hx + t.anchor.dx, y: hy + t.anchor.dy };
}

const wordAt = (rows: readonly string[], x: number, y: number): string =>
  (rows[y - 1] ?? "").split(" ").filter((w) => w !== "")[x - 1] ?? "";

/**
 * Layer 1 and layer 2. Layer 1 counts `8R`/`8U`/`8V` (a `contains` test) on the first three columns
 * of each row, reading rows above `layer1MaxRow` from the map's NPC and monster fields, which never
 * match; columns 4-5 never count; it needs 9. Layer 2 needs `G3` on the whole footprint (a 17-wide
 * row has no word 18).
 */
export function terrainOk(
  t: HouseType,
  ax: number,
  ay: number,
  layer1: readonly string[],
  layer2: readonly string[],
): boolean {
  const tr = houseData.placement.terrain;
  const good1 = `*${tr.layer1Codes.join("*")}`;
  let n1 = 0;
  for (let dy = 0; dy < 3; dy++) {
    const y = ay + dy;
    for (let dx = 0; dx < tr.layer1Columns; dx++) {
      const w = y > tr.layer1MaxRow ? "" : wordAt(layer1, ax + dx, y);
      if (lingoContains(good1, `*${w}*`)) {
        n1 += 1;
      }
    }
  }
  if (n1 < tr.layer1Need) {
    return false;
  }
  for (let dy = 0; dy < t.footprint.h; dy++) {
    for (let dx = 0; dx < t.footprint.w; dx++) {
      if (!lingoContains(`*${TILE_DEFAULTS.empty}*`, `*${wordAt(layer2, ax + dx, ay + dy)}*`)) {
        return false;
      }
    }
  }
  return true;
}

export interface PlacementInput {
  type: HouseType;
  /** The hovered tile (before the correction). */
  hx: number;
  hy: number;
  layer1: readonly string[];
  layer2: readonly string[];
  /** Bounding rects of the ground items, monsters and players on the map (the builder too). */
  obstacles: readonly StageRect[];
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
  const ghost = ghostRect(i.type, i.hx, i.hy);
  if (i.obstacles.some((r) => rectsIntersect(ghost, r))) {
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
    outdoorItems.push({ item: "Street Lamp", x: anchor.x + b.lamp.dx, y: anchor.y + b.lamp.dy });
    // Recorded one row up, so demolition misses it.
    item1 = { item: "Street Lamp", x: anchor.x + b.lamp.dx, y: anchor.y + b.lamp.recordDy };
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
 * The do-not-drop flag: 1 unless the header names you ("<name>'s"); 0 if it is your guild's hall. Nothing
 * sets it to 0 otherwise, so it keeps `prev`. 1.6 matched by substring (Bob passed in "Jimbob's
 * House"); SSO matches the owner exactly: the header must start with "<name>'s ", or be exactly
 * "Hall of the <guild>".
 */
export function headDrop(prev: 0 | 1, header: string, name: string, guild: string): 0 | 1 {
  let flag = prev;
  const owner = `${name.toLowerCase()}'s `;
  if (!header.toLowerCase().startsWith(owner)) {
    flag = 1;
  }
  if (guild !== "" && lingoEq(header, `Hall of the ${guild}`)) {
    flag = 0;
  }
  return flag;
}

export const isFurniture = (item: string): boolean =>
  houseData.furnitureDrop.items.some((f) => lingoEq(item, f));

/** Rest regen: `random(10) = 1` on a house map, then y < 11. */
export const REST_REGEN = houseData.restRegen;

/** The five-minute countdown. */
export const HOUSE_CLOCK_FRAMES = houseData.decay.clockFrames;

/** `random(50) = 1` → the old-house cleanup. */
export const HOUSE_SWEEP_ODDS = houseData.decay.sweepOdds;

/** One `houselist.txt` entry (`*<user>+<map>+<month>|`). */
export interface HouseListEntry {
  ownerId: string;
  ownerName: string;
  map: string;
  month: string;
}

/** The last-login update: every entry of the owner, among the first 500, gets `month`. */
export function refreshOwner(list: HouseListEntry[], ownerName: string, month: string): boolean {
  let changed = false;
  for (const e of list.slice(0, houseData.decay.listCap)) {
    if (lingoEq(e.ownerName, ownerName) && e.month !== month) {
      e.month = month;
      changed = true;
    }
  }
  return changed;
}

/**
 * The old-house cleanup: every entry whose month is neither this month nor the last calls the house
 * remover, which demolishes every house of that owner and rewrites the list from the sweep's own
 * stale copy (Lingo passes the list by value). So only the last owner removed leaves the list;
 * earlier ones come back. Returns the demolitions in order (duplicates included, as 1.6 called
 * its house removal for each) and the list as last written.
 */
export function sweep(
  list: readonly HouseListEntry[],
  month: string,
): { demolish: { ownerId: string; ownerName: string; map: string }[]; list: HouseListEntry[] } {
  const keep = houseData.decay.keep[month] ?? [];
  const stale = list.slice(0, houseData.decay.listCap);
  const demolish: { ownerId: string; ownerName: string; map: string }[] = [];
  let written: HouseListEntry[] = [...list];
  for (const e of stale) {
    if (keep.includes(Number(e.month))) {
      continue;
    }
    const others: HouseListEntry[] = [];
    for (const f of stale) {
      if (lingoEq(f.ownerName, e.ownerName)) {
        demolish.push({ ownerId: f.ownerId, ownerName: f.ownerName, map: f.map });
      } else {
        others.push({ ...f });
      }
    }
    written = others;
  }
  return { demolish, list: written };
}
