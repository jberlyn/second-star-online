/** Ground items by map (loot decay). Callers own transactions. */
import type { Db } from "./database.ts";

export type GroundKind = "loot" | "drop" | "admin";

export interface StoredGroundItem {
  id: string;
  mapId: string;
  x: number;
  y: number;
  item: string;
  /** How many the pile holds: 1, except an immortal's counted `/drop`. */
  qty: number;
  kind: GroundKind;
  /** ISO time the item decays, or null (only loot decays). */
  expiresAt: string | null;
  /** The character who built or parked an Airship, else null. */
  ownerId?: string | null;
}

interface Row {
  id: string;
  map_id: string;
  x: number;
  y: number;
  item: string;
  qty: number;
  kind: GroundKind;
  expires_at: string | null;
  owner_id: string | null;
}

/** A map's ground items in creation order, after deleting the ones already decayed. */
export function loadGround(db: Db, mapId: string, now: string): StoredGroundItem[] {
  db.query(
    "DELETE FROM ground_items WHERE map_id = ? AND expires_at IS NOT NULL AND expires_at <= ?",
  ).run(mapId, now);
  return db
    .query<Row, [string]>(
      "SELECT id, map_id, x, y, item, qty, kind, expires_at, owner_id FROM ground_items WHERE map_id = ? ORDER BY id",
    )
    .all(mapId)
    .map((r) => ({
      id: r.id,
      mapId: r.map_id,
      x: r.x,
      y: r.y,
      item: r.item,
      qty: r.qty,
      kind: r.kind,
      expiresAt: r.expires_at,
      ownerId: r.owner_id,
    }));
}

export function insertGround(db: Db, g: StoredGroundItem, now: string): void {
  db.query(
    "INSERT INTO ground_items (id, map_id, x, y, item, qty, kind, expires_at, owner_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(g.id, g.mapId, g.x, g.y, g.item, g.qty, g.kind, g.expiresAt, g.ownerId ?? null, now);
}

export function deleteGround(db: Db, id: string): void {
  db.query("DELETE FROM ground_items WHERE id = ?").run(id);
}

/** A door or switch renamed in place, as 1.6's door and switch handler did. */
export function renameGround(db: Db, id: string, item: string): void {
  db.query("UPDATE ground_items SET item = ? WHERE id = ?").run(item, id);
}
