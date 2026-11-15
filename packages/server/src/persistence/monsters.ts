/**
 * Map roster slots and their live monsters. Replaces 1.6's client-written monster file per map: the
 * server owns the state, writes it on spawns and deaths and periodically, and restores it on boot,
 * so a damaged monster is still damaged after a restart.
 */
import type { Facing } from "@secondstaronline/shared";

import type { Db } from "./database.ts";

export interface SlotRecord {
  slot: number;
  species: string | null;
  live: { name: string; hp: number; x: number; y: number; facing: Facing } | null;
  lastHp: number | null;
  /** The tile the editor placed the roster entry on, or null. */
  home?: { x: number; y: number } | null;
}

interface SlotRow {
  slot: number;
  species: string | null;
  live_name: string | null;
  hp: number;
  x: number;
  y: number;
  facing: Facing;
  last_hp: number | null;
  home_x: number | null;
  home_y: number | null;
}

/** The four slots of a map; slots with no row are empty. */
export function loadSlots(db: Db, mapId: string): SlotRecord[] {
  const rows = db
    .query<SlotRow, [string]>(
      "SELECT slot, species, live_name, hp, x, y, facing, last_hp, home_x, home_y FROM map_slots WHERE map_id = ?",
    )
    .all(mapId);
  return [1, 2, 3, 4].map((slot) => {
    const r = rows.find((x) => x.slot === slot);
    if (!r) {
      return { slot, species: null, live: null, lastHp: null, home: null };
    }
    return {
      slot,
      species: r.species,
      live:
        r.live_name === null
          ? null
          : { name: r.live_name, hp: r.hp, x: r.x, y: r.y, facing: r.facing },
      lastHp: r.last_hp,
      home: r.home_x === null || r.home_y === null ? null : { x: r.home_x, y: r.home_y },
    };
  });
}

export function saveSlots(db: Db, mapId: string, slots: readonly SlotRecord[], now: string): void {
  const q = db.prepare(
    `INSERT INTO map_slots (map_id, slot, species, live_name, hp, x, y, facing, last_hp, home_x,
       home_y, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (map_id, slot) DO UPDATE SET species = excluded.species,
       live_name = excluded.live_name, hp = excluded.hp, x = excluded.x, y = excluded.y,
       facing = excluded.facing, last_hp = excluded.last_hp, home_x = excluded.home_x,
       home_y = excluded.home_y, updated_at = excluded.updated_at`,
  );
  for (const s of slots) {
    q.run(
      mapId,
      s.slot,
      s.species,
      s.live?.name ?? null,
      s.live?.hp ?? 0,
      s.live?.x ?? 0,
      s.live?.y ?? 0,
      s.live?.facing ?? "S",
      s.lastHp,
      s.home?.x ?? null,
      s.home?.y ?? null,
      now,
    );
  }
}
