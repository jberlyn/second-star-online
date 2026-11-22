/**
 * The player hub's reads (issue #26): the Characters page's search and everything saved about one
 * character, gathered from the tables the game saves them in. Plain functions taking the `Db` first.
 */
import type { CharacterMatch, StoredCharacter } from "../systems/admin/characters.ts";
import { findCharacterById, loadSkills } from "./characters.ts";
import type { Db } from "./database.ts";
import { loadBank, loadVault } from "./economy.ts";
import { loadInventory } from "./inventory.ts";
import { findMapById } from "./maps.ts";
import { loadSpellbook } from "./spells.ts";

/**
 * Characters whose name contains `query`, ignoring case: names that start with it first, then the
 * most recently saved. An empty query lists the most recently saved.
 */
export function searchCharacters(db: Db, query: string, limit: number): CharacterMatch[] {
  const q = query.trim().toLowerCase();
  // Names are letters only, but escape LIKE's wildcards anyway.
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const starts = `${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return db
    .query<
      {
        id: string;
        name: string;
        level: number;
        class_code: number;
        role: string | null;
        updated_at: string;
      },
      [string, string, number]
    >(
      `SELECT c.id, c.name, c.level, c.class_code, a.role, c.updated_at
       FROM characters c JOIN accounts a ON a.id = c.account_id
       WHERE lower(c.name) LIKE ?1 ESCAPE '\\'
       ORDER BY lower(c.name) LIKE ?2 ESCAPE '\\' DESC, c.updated_at DESC, c.name
       LIMIT ?3`,
    )
    .all(like, starts, limit)
    .map((r) => ({
      id: r.id,
      name: r.name,
      level: r.level,
      classCode: r.class_code,
      roleId: r.role,
      updatedAt: r.updated_at,
    }));
}

export function loadStoredCharacter(db: Db, id: string): StoredCharacter | null {
  const record = findCharacterById(db, id);
  if (!record) {
    return null;
  }
  const mapName = (mapId: string) => findMapById(db, mapId)?.name ?? mapId;
  return {
    record,
    mapName: mapName(record.position.mapId),
    respawnMapName: record.respawn ? mapName(record.respawn.mapId) : null,
    skills: loadSkills(db, id),
    inventory: loadInventory(db, id),
    bank: loadBank(db, id),
    vault: loadVault(db, id),
    spellbook: loadSpellbook(db, id),
    ...characterTimes(db, id),
  };
}

/** When the character was last saved and when its account was made. */
export function characterTimes(db: Db, id: string): { updatedAt: string; accountCreated: string } {
  const r = db
    .query<{ updated_at: string; created_at: string }, [string]>(
      `SELECT c.updated_at, a.created_at FROM characters c JOIN accounts a ON a.id = c.account_id
       WHERE c.id = ?`,
    )
    .get(id);
  return { updatedAt: r?.updated_at ?? "", accountCreated: r?.created_at ?? "" };
}
