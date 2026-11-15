/**
 * Gold, bag lines and equipment. Callers own transactions: an item movement writes the inventory
 * and the ground in one.
 */
import {
  BAG_SLOTS,
  type Bag,
  EQUIP_FIELD,
  EQUIP_SLOTS,
  type Equipment,
  emptyBag,
  NO_EQUIPMENT,
  NOTHING,
} from "@secondstaronline/shared";

import type { Db } from "./database.ts";

export interface StoredInventory {
  gold: number;
  bag: Bag;
  equip: Equipment;
}

export function loadInventory(db: Db, characterId: string): StoredInventory {
  const gold =
    db
      .query<{ gold: number }, [string]>("SELECT gold FROM characters WHERE id = ?")
      .get(characterId)?.gold ?? 0;
  const bag = emptyBag();
  for (const r of db
    .query<{ slot: number; item: string; qty: number }, [string]>(
      "SELECT slot, item, qty FROM inventory WHERE character_id = ? ORDER BY slot",
    )
    .all(characterId)) {
    if (r.slot >= 1 && r.slot <= BAG_SLOTS) {
      bag[r.slot - 1] = { item: r.item, qty: r.qty };
    }
  }
  const equip: Equipment = { ...NO_EQUIPMENT };
  for (const r of db
    .query<{ slot: string; item: string }, [string]>(
      "SELECT slot, item FROM equipment WHERE character_id = ?",
    )
    .all(characterId)) {
    const field = EQUIP_FIELD[r.slot as keyof typeof EQUIP_FIELD];
    if (field) {
      equip[field] = r.item;
    }
  }
  return { gold, bag, equip };
}

/**
 * Moves gold on a character that is not logged in (a blackjack forfeit past the grace): the saved
 * gold never goes below 0.
 */
export function addGoldOffline(db: Db, characterId: string, delta: number): void {
  db.query("UPDATE characters SET gold = MAX(gold + ?, 0) WHERE id = ?").run(delta, characterId);
}

/** Rewrites a character's gold, bag and equipment. */
export function saveInventory(
  db: Db,
  characterId: string,
  inv: StoredInventory,
  now: string,
): void {
  db.query("UPDATE characters SET gold = ?, updated_at = ? WHERE id = ?").run(
    inv.gold,
    now,
    characterId,
  );
  db.query("DELETE FROM inventory WHERE character_id = ?").run(characterId);
  const line = db.prepare(
    "INSERT INTO inventory (id, character_id, slot, item, qty) VALUES (?, ?, ?, ?, ?)",
  );
  inv.bag.forEach((l, i) => {
    if (l) {
      line.run(Bun.randomUUIDv7(), characterId, i + 1, l.item, l.qty);
    }
  });
  db.query("DELETE FROM equipment WHERE character_id = ?").run(characterId);
  const eq = db.prepare("INSERT INTO equipment (character_id, slot, item) VALUES (?, ?, ?)");
  for (const slot of EQUIP_SLOTS) {
    const item = inv.equip[EQUIP_FIELD[slot]];
    if (item !== NOTHING) {
      eq.run(characterId, slot, item);
    }
  }
}
