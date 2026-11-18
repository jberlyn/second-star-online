/**
 * The spellbook rows (migrations/20261106_06_spells.sql, uncapped by 20261118_34). Plain functions
 * over the database. The caller passes the saved form (`savedSpellbook`,
 * shared/rules/spells/spells.ts); these functions store exactly what they get.
 */
import type { Db } from "./database.ts";

export function loadSpellbook(db: Db, characterId: string): string[] {
  return db
    .query<{ spell: string }, [string]>(
      "SELECT spell FROM character_spells WHERE character_id = ? ORDER BY line",
    )
    .all(characterId)
    .map((r) => r.spell);
}

/** Replaces the character's spellbook rows with `lines`. */
export function saveSpellbook(db: Db, characterId: string, lines: readonly string[]): void {
  db.prepare("DELETE FROM character_spells WHERE character_id = ?").run(characterId);
  const ins = db.prepare(
    "INSERT INTO character_spells (character_id, line, spell) VALUES (?, ?, ?)",
  );
  lines.forEach((spell, i) => {
    ins.run(characterId, i + 1, spell);
  });
}
