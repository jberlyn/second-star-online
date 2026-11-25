/**
 * Maps: operator-authored screens addressed by grid position. The World Editor writes
 * them. House interiors share the grid position of their outdoor map with a slot of 1 or 2.
 */
import { anyMapName, houseMapName, type MapExit, type MapFog } from "@secondstaronline/shared";

import type { Db } from "./database.ts";

export interface MapRecord {
  id: string;
  mx: number;
  my: number;
  /** 0 for a grid map; 1 or 2 for the house interior behind its Exit or Exit2. */
  slot: 0 | 1 | 2;
  /** `x<mx>y<my>`, or `xH<slot><mx>yH<slot><my>` for an interior. */
  name: string;
  /** Map field 17, the header. */
  title: string;
  /** Layers 1-4, each 12 rows of 17 space-separated codes. */
  layers: [string[], string[], string[], string[]];
  flags: MapFlags;
  /** Fields 13 and 18, or null when the exit panel was left empty. */
  exit1: MapExit | null;
  exit2: MapExit | null;
  /** Fields 14-16: the Sign 1-3 texts. */
  signs: [string, string, string];
  /** Field 12 items 6-10. */
  fog: MapFog;
}

/**
 * Map field 12 items 1, 2, 3 and 5 as the original reads them: "O" turns fighting / PvP off; the faction spawn swap
 * (1.6's W, M, A or X) is a faction key, or "" for none.
 */
export interface MapFlags {
  canFight: string;
  fctSpwn: string;
  isIndoors: string;
  canPvp: string;
}

interface MapRow {
  id: string;
  mx: number;
  my: number;
  slot: number;
  title: string;
  layer1: string;
  layer2: string;
  layer3: string;
  layer4: string;
  can_fight: string;
  fct_spwn: string;
  is_indoors: string;
  can_pvp: string;
  exit1: string | null;
  exit2: string | null;
  sign1: string;
  sign2: string;
  sign3: string;
  fog_tex: string;
  fog_blend: number;
  fog_r: number;
  fog_g: number;
  fog_b: number;
}

const COLUMNS =
  "id, mx, my, slot, title, layer1, layer2, layer3, layer4, can_fight, fct_spwn, is_indoors, can_pvp, " +
  "exit1, exit2, sign1, sign2, sign3, fog_tex, fog_blend, fog_r, fog_g, fog_b";

export function findMapByCoords(
  db: Db,
  mx: number,
  my: number,
  slot: 0 | 1 | 2 = 0,
): MapRecord | null {
  const row = db
    .query<MapRow, [number, number, number]>(
      `SELECT ${COLUMNS} FROM maps WHERE mx = ? AND my = ? AND slot = ?`,
    )
    .get(mx, my, slot);
  return row ? toRecord(row) : null;
}

/** Every map, in coordinate order. */
export function listMaps(db: Db): MapRecord[] {
  return db
    .query<MapRow, []>(`SELECT ${COLUMNS} FROM maps ORDER BY mx, my, slot`)
    .all()
    .map(toRecord);
}

export function findMapById(db: Db, id: string): MapRecord | null {
  const row = db.query<MapRow, [string]>(`SELECT ${COLUMNS} FROM maps WHERE id = ?`).get(id);
  return row ? toRecord(row) : null;
}

/**
 * Writes a map as the editor saved it: updates the row at its grid position, or creates one (a new
 * map is made by saving at new X/Y). Returns the map's id. The caller owns the transaction.
 */
export function saveMap(
  db: Db,
  input: Omit<MapRecord, "id" | "name" | "slot"> & { slot?: 0 | 1 | 2 },
  now: string,
): string {
  const m = { ...input, slot: input.slot ?? 0 };
  const existing = db
    .query<{ id: string }, [number, number, number]>(
      "SELECT id FROM maps WHERE mx = ? AND my = ? AND slot = ?",
    )
    .get(m.mx, m.my, m.slot);
  const id = existing?.id ?? Bun.randomUUIDv7();
  const values = [
    m.title,
    JSON.stringify(m.layers[0]),
    JSON.stringify(m.layers[1]),
    JSON.stringify(m.layers[2]),
    JSON.stringify(m.layers[3]),
    m.flags.canFight,
    m.flags.fctSpwn,
    m.flags.isIndoors,
    m.flags.canPvp,
    m.exit1 ? JSON.stringify(m.exit1) : null,
    m.exit2 ? JSON.stringify(m.exit2) : null,
    m.signs[0],
    m.signs[1],
    m.signs[2],
    m.fog.tex,
    m.fog.blend,
    m.fog.r,
    m.fog.g,
    m.fog.b,
  ] as const;
  if (existing) {
    db.query(
      `UPDATE maps SET title = ?, layer1 = ?, layer2 = ?, layer3 = ?, layer4 = ?, can_fight = ?,
       fct_spwn = ?, is_indoors = ?, can_pvp = ?, exit1 = ?, exit2 = ?, sign1 = ?, sign2 = ?,
       sign3 = ?, fog_tex = ?, fog_blend = ?, fog_r = ?, fog_g = ?, fog_b = ?, updated_at = ?
       WHERE id = ?`,
    ).run(...values, now, id);
  } else {
    db.query(
      `INSERT INTO maps (id, mx, my, slot, title, layer1, layer2, layer3, layer4, can_fight,
       fct_spwn, is_indoors, can_pvp, exit1, exit2, sign1, sign2, sign3, fog_tex, fog_blend,
       fog_r, fog_g, fog_b, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, m.mx, m.my, m.slot, ...values, now, now);
  }
  return id;
}

/**
 * Writes a map's four layers after gathering, seeds or regrowth changed tiles, as 1.6 rewrote the
 * map file for a tile change. Not an editor save, so no version is kept. The caller owns the
 * transaction.
 */
export function saveMapLayers(
  db: Db,
  id: string,
  layers: readonly [readonly string[], readonly string[], readonly string[], readonly string[]],
  now: string,
): void {
  db.query(
    "UPDATE maps SET layer1 = ?, layer2 = ?, layer3 = ?, layer4 = ?, updated_at = ? WHERE id = ?",
  ).run(
    JSON.stringify(layers[0]),
    JSON.stringify(layers[1]),
    JSON.stringify(layers[2]),
    JSON.stringify(layers[3]),
    now,
    id,
  );
}

/** Keeps the map as it was before an editor save ("versioned"). */
export function insertMapVersion(
  db: Db,
  v: { mapId: string; savedBy: string; data: unknown },
  now: string,
): void {
  db.query(
    "INSERT INTO map_versions (id, map_id, saved_by, data, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(Bun.randomUUIDv7(), v.mapId, v.savedBy, JSON.stringify(v.data), now);
}

export function countMapVersions(db: Db, mapId: string): number {
  return (
    db
      .query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM map_versions WHERE map_id = ?")
      .get(mapId)?.n ?? 0
  );
}

/**
 * A map's two exit fields after a house is built (the exit coordinates go into items 13 and 18). The
 * caller owns the transaction.
 */
export function saveMapExits(
  db: Db,
  id: string,
  exit1: MapExit | null,
  exit2: MapExit | null,
  now: string,
): void {
  db.query("UPDATE maps SET exit1 = ?, exit2 = ?, updated_at = ? WHERE id = ?").run(
    exit1 ? JSON.stringify(exit1) : null,
    exit2 ? JSON.stringify(exit2) : null,
    now,
    id,
  );
}

/**
 * Deletes a map row and, through its foreign keys, its roster, ground items and versions (a
 * demolished house's interior). The caller owns the transaction.
 */
export function deleteMap(db: Db, id: string): void {
  db.query("UPDATE characters SET respawn_map_id = NULL WHERE respawn_map_id = ?").run(id);
  db.query("DELETE FROM maps WHERE id = ?").run(id);
}

const slotOf = (n: number): 0 | 1 | 2 => (n === 1 ? 1 : n === 2 ? 2 : 0);

function toRecord(row: MapRow): MapRecord {
  const rows = (text: string) => JSON.parse(text) as string[];
  const exit = (text: string | null) => (text ? (JSON.parse(text) as MapExit) : null);
  return {
    id: row.id,
    mx: row.mx,
    my: row.my,
    slot: slotOf(row.slot),
    name: anyMapName(row.mx, row.my, slotOf(row.slot)),
    title: row.title,
    layers: [rows(row.layer1), rows(row.layer2), rows(row.layer3), rows(row.layer4)],
    flags: {
      canFight: row.can_fight,
      fctSpwn: row.fct_spwn,
      isIndoors: row.is_indoors,
      canPvp: row.can_pvp,
    },
    exit1: exit(row.exit1),
    exit2: exit(row.exit2),
    signs: [row.sign1, row.sign2, row.sign3],
    fog: {
      tex: row.fog_tex,
      blend: row.fog_blend,
      r: row.fog_r,
      g: row.fog_g,
      b: row.fog_b,
    },
  };
}

/** A shop owner's `title` (`Header`). */
export function saveMapTitle(db: Db, id: string, title: string, now: string): void {
  db.query("UPDATE maps SET title = ?, updated_at = ? WHERE id = ?").run(title, now, id);
}

/** The names of every house interior map (slot 1 or 2) in the database (orphan sweep). */
export function listInteriorMapNames(db: Db): string[] {
  return db
    .query<{ mx: number; my: number; slot: 1 | 2 }, []>(
      "SELECT mx, my, slot FROM maps WHERE slot > 0",
    )
    .all()
    .map((r) => houseMapName(r.mx, r.my, r.slot));
}

/** One grid map as the Control Panel's World page lists it (issue #33). */
export interface MapListing {
  mx: number;
  my: number;
  name: string;
  title: string;
  /** The species its roster names, in slot order (empty slots left out). */
  roster: string[];
  /** The items placed on it in an editor (`admin` ground items). */
  items: string[];
}

/** Every grid map (no house interiors) with its roster and placed items. */
export function listMapPlacements(db: Db): MapListing[] {
  const maps = db
    .query<{ id: string; mx: number; my: number; title: string }, []>(
      "SELECT id, mx, my, title FROM maps WHERE slot = 0 ORDER BY mx, my",
    )
    .all();
  const roster = new Map<string, string[]>();
  for (const r of db
    .query<{ map_id: string; species: string }, []>(
      "SELECT map_id, species FROM map_slots WHERE species IS NOT NULL ORDER BY map_id, slot",
    )
    .all()) {
    roster.set(r.map_id, [...(roster.get(r.map_id) ?? []), r.species]);
  }
  const items = new Map<string, string[]>();
  for (const r of db
    .query<{ map_id: string; item: string }, []>(
      "SELECT map_id, item FROM ground_items WHERE kind = 'admin' ORDER BY map_id, created_at",
    )
    .all()) {
    items.set(r.map_id, [...(items.get(r.map_id) ?? []), r.item]);
  }
  return maps.map((m) => ({
    mx: m.mx,
    my: m.my,
    name: anyMapName(m.mx, m.my, 0),
    title: m.title,
    roster: roster.get(m.id) ?? [],
    items: items.get(m.id) ?? [],
  }));
}

/** A map's saved versions, newest first: who saved over each, and when. */
export function listMapVersions(
  db: Db,
  mapId: string,
  limit = 50,
): { id: string; savedBy: string; at: string; data: unknown }[] {
  return db
    .query<{ id: string; saved_by: string; created_at: string; data: string }, [string, number]>(
      "SELECT id, saved_by, created_at, data FROM map_versions WHERE map_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
    )
    .all(mapId, limit)
    .map((r) => ({
      id: r.id,
      savedBy: r.saved_by,
      at: r.created_at,
      data: JSON.parse(r.data) as unknown,
    }));
}

/**
 * The id of a map's newest version, or null: every save (and restore) adds one, so it tells two
 * saves of the same content apart.
 */
export function latestMapVersionId(db: Db, mapId: string): string | null {
  return (
    db
      .query<{ id: string }, [string]>(
        "SELECT id FROM map_versions WHERE map_id = ? ORDER BY created_at DESC, id DESC LIMIT 1",
      )
      .get(mapId)?.id ?? null
  );
}

/** One saved version's data (`versionData`), or null. */
export function mapVersionData(db: Db, mapId: string, id: string): unknown {
  const row = db
    .query<{ data: string }, [string, string]>(
      "SELECT data FROM map_versions WHERE map_id = ? AND id = ?",
    )
    .get(mapId, id);
  return row ? (JSON.parse(row.data) as unknown) : null;
}
