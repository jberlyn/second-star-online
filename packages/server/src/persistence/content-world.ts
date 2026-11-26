/**
 * The database side of removing content in use (issue #28): the copies of an item and the roster
 * slots of a monster held by offline characters and maps not loaded, and the writes a published
 * cleanup makes to them. The game passes this to `createContentWorld` (systems never touch the
 * database themselves). Callers own the transaction.
 */
import { anyMapName } from "@secondstaronline/shared";

import type { Db } from "./database.ts";
import { type StoredShop, saveShop } from "./economy.ts";
import { saveNpcFile } from "./npcfiles.ts";

/** A character table that stores item names. */
export type CharacterItemTable = "inventory" | "equipment" | "vault_items";

/** One stored item of a character: a bag line, a worn slot or a vault line. */
export interface StoredCharacterItem {
  table: CharacterItemTable;
  characterId: string;
  accountId: string;
  name: string;
  item: string;
  qty: number;
  /** The row within the character: an inventory row id, an equipment slot or a vault position. */
  row: string | number;
}

/** `... AND col NOT IN (?, ?)` for a skip list, or "". */
const notIn = (column: string, skip: readonly string[]) =>
  skip.length > 0 ? ` AND ${column} NOT IN (${skip.map(() => "?").join(",")})` : "";

/** `LIKE` tests for stored names containing any of `likes` (case ignored), or "" for every row. */
const likeAny = (column: string, likes: readonly string[]) =>
  likes.length > 0 ? ` AND (${likes.map(() => `${column} LIKE ? ESCAPE '\\'`).join(" OR ")})` : "";
const likeArgs = (likes: readonly string[]) =>
  likes.map((s) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);

const ROW_COLUMN: Record<CharacterItemTable, string> = {
  inventory: "t.id",
  equipment: "t.slot",
  vault_items: "t.position",
};

interface MapCols {
  mx: number;
  my: number;
  mslot: number;
}
const mapOf = (r: MapCols): string => anyMapName(r.mx, r.my, r.mslot as 0 | 1 | 2);

export function contentWorldStore(db: Db) {
  return {
    /** Stored items of characters not in `skip`, whose name contains one of `likes` (or all). */
    characterItems(
      table: CharacterItemTable,
      likes: readonly string[],
      skip: readonly string[],
    ): StoredCharacterItem[] {
      const qty = table === "inventory" ? "t.qty" : "1";
      return db
        .query<
          {
            row: string | number;
            character_id: string;
            item: string;
            qty: number;
            name: string;
            account_id: string;
          },
          string[]
        >(
          `SELECT ${ROW_COLUMN[table]} AS row, t.character_id, t.item, ${qty} AS qty, c.name, c.account_id
           FROM ${table} t JOIN characters c ON c.id = t.character_id
           WHERE 1 = 1${likeAny("t.item", likes)}${notIn("t.character_id", skip)}`,
        )
        .all(...likeArgs(likes), ...skip)
        .map((r) => ({
          table,
          characterId: r.character_id,
          accountId: r.account_id,
          name: r.name,
          item: r.item,
          qty: r.qty,
          row: r.row,
        }));
    },

    deleteCharacterItem(i: StoredCharacterItem): void {
      if (i.table === "inventory") {
        db.query("DELETE FROM inventory WHERE id = ?").run(String(i.row));
      } else if (i.table === "equipment") {
        db.query("DELETE FROM equipment WHERE character_id = ? AND slot = ?").run(
          i.characterId,
          String(i.row),
        );
      } else {
        throw new Error("a vault line is rewritten with its vault (setVault)");
      }
    },

    renameCharacterItem(i: StoredCharacterItem, item: string): void {
      if (i.table === "inventory") {
        db.query("UPDATE inventory SET item = ? WHERE id = ?").run(item, String(i.row));
      } else if (i.table === "equipment") {
        db.query("UPDATE equipment SET item = ? WHERE character_id = ? AND slot = ?").run(
          item,
          i.characterId,
          String(i.row),
        );
      } else {
        db.query("UPDATE vault_items SET item = ? WHERE character_id = ? AND position = ?").run(
          item,
          i.characterId,
          Number(i.row),
        );
      }
    },

    /** Sets an offline bag line's count (a replaced line merged into a stack). */
    setInventoryQty(id: string, qty: number): void {
      db.query("UPDATE inventory SET qty = ? WHERE id = ?").run(qty, id);
    },

    /** The characters saved in class `code` (issue #15), by id. */
    classHolderIds(code: number): string[] {
      return db
        .query<{ id: string }, [number]>("SELECT id FROM characters WHERE class_code = ?")
        .all(code)
        .map((r) => r.id);
    },

    /** One character's class (an online one moved by a class's removal, issue #15). */
    setClassOf(id: string, code: number, now: string): void {
      db.query("UPDATE characters SET class_code = ?, updated_at = ? WHERE id = ?").run(
        code,
        now,
        id,
      );
    },

    /** Every character in class `from` moves to `to` (a class's removal, issue #15). */
    moveClass(from: number, to: number, now: string): number {
      return db
        .query("UPDATE characters SET class_code = ?, updated_at = ? WHERE class_code = ?")
        .run(to, now, from).changes;
    },

    /** How many characters have a value of the skill stored under `key` (issue #38). */
    skillHolders(key: string): number {
      return (
        db
          .query<{ n: number }, [string]>(
            "SELECT count(DISTINCT character_id) AS n FROM character_skills WHERE skill = ?",
          )
          .get(key)?.n ?? 0
      );
    },

    /** Writes a player shop's rewritten file and its new ledger. */
    saveShopFile(npc: string, text: string, ledger: StoredShop, by: string, now: string): void {
      saveNpcFile(db, { npc, text }, by, now);
      saveShop(db, ledger, now);
    },

    vault(characterId: string): string[] {
      return db
        .query<{ item: string }, [string]>(
          "SELECT item FROM vault_items WHERE character_id = ? ORDER BY position",
        )
        .all(characterId)
        .map((r) => r.item);
    },

    setVault(characterId: string, items: readonly string[]): void {
      db.query("DELETE FROM vault_items WHERE character_id = ?").run(characterId);
      const ins = db.prepare(
        "INSERT INTO vault_items (character_id, position, item) VALUES (?, ?, ?)",
      );
      items.forEach((item, i) => {
        ins.run(characterId, i + 1, item);
      });
    },

    addGold(characterId: string, gold: number): void {
      db.query("UPDATE characters SET gold = gold + ? WHERE id = ?").run(gold, characterId);
    },

    /** Ground items on maps not in `skip`, whose name contains one of `likes` (or all). */
    groundItems(
      likes: readonly string[],
      skip: readonly string[],
    ): { id: string; item: string; qty: number; map: string }[] {
      return db
        .query<{ id: string; item: string; qty: number } & MapCols, string[]>(
          `SELECT g.id, g.item, g.qty, m.mx AS mx, m.my AS my, m.slot AS mslot
           FROM ground_items g JOIN maps m ON m.id = g.map_id
           WHERE 1 = 1${likeAny("g.item", likes)}${notIn("g.map_id", skip)}`,
        )
        .all(...likeArgs(likes), ...skip)
        .map((r) => ({ id: r.id, item: r.item, qty: r.qty, map: mapOf(r) }));
    },

    /** Every map not in `skip`, with its four tile layers (issue #29, stage 6). */
    mapLayers(skip: readonly string[]): { map: string; layers: string[][] }[] {
      return db
        .query<
          { layer1: string; layer2: string; layer3: string; layer4: string } & MapCols,
          string[]
        >(
          `SELECT m.layer1, m.layer2, m.layer3, m.layer4, m.mx AS mx, m.my AS my, m.slot AS mslot
           FROM maps m WHERE 1 = 1${notIn("m.id", skip)}`,
        )
        .all(...skip)
        .map((r) => ({
          map: mapOf(r),
          layers: [r.layer1, r.layer2, r.layer3, r.layer4].map((l) => {
            try {
              const rows = JSON.parse(l) as unknown;
              return Array.isArray(rows) ? rows.map(String) : [];
            } catch {
              return [];
            }
          }),
        }));
    },

    /** Characters not in `skip` riding `vehicle` (case ignored), or any vehicle (null): #44. */
    riders(
      vehicle: string | null,
      skip: readonly string[],
    ): { id: string; accountId: string; name: string; vehicle: string; hull: number | null }[] {
      return db
        .query<
          { id: string; account_id: string; name: string; vehicle: string; hull: number | null },
          string[]
        >(
          `SELECT id, account_id, name, vehicle, hull FROM characters
           WHERE ${vehicle === null ? "vehicle IS NOT NULL" : "vehicle = ? COLLATE NOCASE"}${notIn("id", skip)}`,
        )
        .all(...(vehicle === null ? [] : [vehicle]), ...skip)
        .map((r) => ({
          id: r.id,
          accountId: r.account_id,
          name: r.name,
          vehicle: r.vehicle,
          hull: r.hull,
        }));
    },

    /** Puts a character aboard another vehicle, or on foot (null), where they are. */
    setRider(id: string, vehicle: string | null, hull: number | null): void {
      db.query("UPDATE characters SET vehicle = ?, hull = ? WHERE id = ?").run(
        vehicle,
        vehicle ? hull : null,
        id,
      );
    },

    /**
     * A parked vehicle become another (issue #44): its new name, and what no longer applies taken
     * off: a deed has no owner, hull, parking time or mooring; a flying vehicle no mooring.
     */
    reparkGround(
      id: string,
      item: string,
      clear: { owner: boolean; hull: boolean; facing: boolean },
    ): void {
      db.query(
        `UPDATE ground_items SET item = ?, qty = 1${clear.owner ? ", owner_id = NULL" : ""}${clear.hull ? ", hull = NULL, parked_at = NULL" : ""}${clear.facing ? ", facing = NULL" : ""} WHERE id = ?`,
      ).run(item, id);
    },

    deleteGround(id: string): void {
      db.query("DELETE FROM ground_items WHERE id = ?").run(id);
    },

    renameGround(id: string, item: string, qty: number): void {
      db.query("UPDATE ground_items SET item = ?, qty = ? WHERE id = ?").run(item, qty, id);
    },

    /** Roster slots of maps not in `skip` that hold a species or a live monster. */
    rosterSlots(
      skip: readonly string[],
    ): { species: string | null; liveName: string | null; map: string }[] {
      return db
        .query<{ species: string | null; live_name: string | null } & MapCols, string[]>(
          `SELECT s.species, s.live_name, m.mx AS mx, m.my AS my, m.slot AS mslot
           FROM map_slots s JOIN maps m ON m.id = s.map_id
           WHERE (s.species IS NOT NULL OR s.live_name IS NOT NULL)${notIn("s.map_id", skip)}`,
        )
        .all(...skip)
        .map((r) => ({ species: r.species, liveName: r.live_name, map: mapOf(r) }));
    },

    /** Sets every roster slot of `key` on maps not in `skip` to `species` (null clears it). */
    replaceSpecies(key: string, species: string | null, skip: readonly string[]): number {
      return (
        species === null
          ? db
              .query(
                `UPDATE map_slots SET species = NULL, home_x = NULL, home_y = NULL WHERE lower(species) = lower(?)${notIn("map_id", skip)}`,
              )
              .run(key, ...skip)
          : db
              .query(
                `UPDATE map_slots SET species = ? WHERE lower(species) = lower(?)${notIn("map_id", skip)}`,
              )
              .run(species, key, ...skip)
      ).changes;
    },

    /** Removes every live `key` on maps not in `skip`. */
    despawn(key: string, skip: readonly string[]): number {
      return db
        .query(
          `UPDATE map_slots SET live_name = NULL, hp = 0 WHERE lower(live_name) = lower(?)${notIn("map_id", skip)}`,
        )
        .run(key, ...skip).changes;
    },
  };
}
