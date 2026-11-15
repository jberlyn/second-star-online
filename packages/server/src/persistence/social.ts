/**
 * Faction powers and the quest lines: the server's copies of 1.6's faction power file and quest
 * file. Callers own transactions.
 */
import type { Db } from "./database.ts";

/** Mage, Warrior and Adventurer power, in `factions.txt`'s order. */
export type FactionPowers = [number, number, number];

/** The powers, or null before the first start has seeded them. */
export function loadFactionPowers(db: Db): FactionPowers | null {
  const row = db
    .query<{ mage: number; warrior: number; adventurer: number }, []>(
      "SELECT mage, warrior, adventurer FROM faction_powers WHERE id = 1",
    )
    .get();
  return row ? [row.mage, row.warrior, row.adventurer] : null;
}

export function saveFactionPowers(db: Db, p: FactionPowers): void {
  db.query(
    `INSERT INTO faction_powers (id, mage, warrior, adventurer) VALUES (1, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET mage = excluded.mage, warrior = excluded.warrior,
       adventurer = excluded.adventurer`,
  ).run(p[0], p[1], p[2]);
}

/** The 40 quest lines in order, or null before the first start has seeded them. */
export function loadQuestLines(db: Db): string[] | null {
  const rows = db
    .query<{ line: number; text: string }, []>("SELECT line, text FROM quests ORDER BY line")
    .all();
  if (rows.length === 0) {
    return null;
  }
  const out = Array.from({ length: 40 }, () => "");
  for (const r of rows) {
    out[r.line - 1] = r.text;
  }
  return out;
}

/** Writes quest line `line` (1-40). */
export function saveQuestLine(db: Db, line: number, text: string): void {
  db.query(
    "INSERT INTO quests (line, text) VALUES (?, ?) ON CONFLICT (line) DO UPDATE SET text = excluded.text",
  ).run(line, text);
}
