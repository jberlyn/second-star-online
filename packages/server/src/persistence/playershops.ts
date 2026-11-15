/**
 * Player shops: which shopkeeper belongs to whom and which interior it stands in. Its file is an
 * `npc_files` row and its till and stock an `npc_shops` ledger. Callers own transactions: a build
 * writes the shop, its file and the interior's roster together.
 */
import type { Db } from "./database.ts";

export interface StoredPlayerShop {
  npc: string;
  ownerId: string;
  interior: string;
}

export function loadPlayerShops(db: Db): StoredPlayerShop[] {
  return db
    .query<StoredPlayerShop, []>(
      "SELECT npc, owner_id AS ownerId, interior FROM player_shops ORDER BY created_at, npc",
    )
    .all();
}

export function insertPlayerShop(db: Db, s: StoredPlayerShop, now: string): void {
  db.query(
    "INSERT INTO player_shops (npc, owner_id, interior, created_at) VALUES (?, ?, ?, ?)",
  ).run(s.npc, s.ownerId, s.interior, now);
}

/**
 * Deletes the shops of an interior with their NPC files and ledgers. Returns the shopkeepers'
 * names.
 */
export function deletePlayerShops(db: Db, interior: string): string[] {
  const names = db
    .query<{ npc: string }, [string]>("SELECT npc FROM player_shops WHERE interior = ?")
    .all(interior)
    .map((r) => r.npc);
  for (const npc of names) {
    db.query("DELETE FROM npc_shop_lines WHERE npc = ?").run(npc);
    db.query("DELETE FROM npc_shops WHERE npc = ?").run(npc);
    db.query("DELETE FROM npc_files WHERE npc = ?").run(npc);
    db.query("DELETE FROM player_shops WHERE npc = ?").run(npc);
  }
  return names;
}
