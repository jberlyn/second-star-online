/**
 * NPC shop ledgers, bank accounts and personal vaults. Callers own transactions: a purchase writes
 * the buyer's inventory and the NPC's ledger in one.
 */
import type { Db } from "./database.ts";

export interface StoredShopLine {
  line: number;
  kind: "SEL" | "BUY";
  item: string;
  price: number;
  stock: number | null;
}

export interface StoredShop {
  npc: string;
  gold: number | null;
  lines: StoredShopLine[];
}

/** A saved ledger, or null when the NPC still has its template state. */
export function loadShop(db: Db, npc: string): StoredShop | null {
  const head = db
    .query<{ gold: number | null }, [string]>("SELECT gold FROM npc_shops WHERE npc = ?")
    .get(npc);
  if (!head) {
    return null;
  }
  const lines = db
    .query<StoredShopLine, [string]>(
      "SELECT line, kind, item, price, stock FROM npc_shop_lines WHERE npc = ? ORDER BY line",
    )
    .all(npc);
  return { npc, gold: head.gold, lines };
}

/** Writes a whole ledger (it has at most a few dozen lines). */
export function saveShop(db: Db, shop: StoredShop, now: string): void {
  db.query(
    "INSERT INTO npc_shops (npc, gold, updated_at) VALUES (?, ?, ?) ON CONFLICT(npc) DO UPDATE SET gold = excluded.gold, updated_at = excluded.updated_at",
  ).run(shop.npc, shop.gold, now);
  db.query("DELETE FROM npc_shop_lines WHERE npc = ?").run(shop.npc);
  const ins = db.prepare(
    "INSERT INTO npc_shop_lines (npc, line, kind, item, price, stock) VALUES (?, ?, ?, ?, ?, ?)",
  );
  for (const l of shop.lines) {
    ins.run(shop.npc, l.line, l.kind, l.item, l.price, l.stock);
  }
}

/** The bank balance, or null when the character has no account yet. */
export function loadBank(db: Db, characterId: string): number | null {
  return (
    db
      .query<{ balance: number }, [string]>(
        "SELECT balance FROM bank_accounts WHERE character_id = ?",
      )
      .get(characterId)?.balance ?? null
  );
}

export function saveBank(db: Db, characterId: string, balance: number, now: string): void {
  db.query(
    "INSERT INTO bank_accounts (character_id, balance, updated_at) VALUES (?, ?, ?) ON CONFLICT(character_id) DO UPDATE SET balance = excluded.balance, updated_at = excluded.updated_at",
  ).run(characterId, balance, now);
}

/** The personal vault's lines in order. */
export function loadVault(db: Db, characterId: string): string[] {
  return db
    .query<{ item: string }, [string]>(
      "SELECT item FROM vault_items WHERE character_id = ? ORDER BY position",
    )
    .all(characterId)
    .map((r) => r.item);
}

export function saveVault(db: Db, characterId: string, items: readonly string[]): void {
  db.query("DELETE FROM vault_items WHERE character_id = ?").run(characterId);
  const ins = db.prepare("INSERT INTO vault_items (character_id, position, item) VALUES (?, ?, ?)");
  items.forEach((item, i) => {
    ins.run(characterId, i + 1, item);
  });
}

/** Drops a ledger, so the NPC's file is its state again (an NPC editor save). */
export function deleteShop(db: Db, npc: string): void {
  db.query("DELETE FROM npc_shop_lines WHERE npc = ?").run(npc);
  db.query("DELETE FROM npc_shops WHERE npc = ?").run(npc);
}
