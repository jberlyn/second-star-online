/**
 * Faction powers and the quest lines: the server's copies of 1.6's faction power file and quest
 * file. Callers own transactions.
 */
import type { Db } from "./database.ts";

/** Each faction's power, by faction key (1.6's `factions.txt`). */
export type FactionPowers = Record<string, number>;

/**
 * The saved powers, by faction key, or null before the first start has saved any. A faction with
 * no saved power has its content's `startPower` (shared `factionPower`).
 */
export function loadFactionPowers(db: Db): FactionPowers | null {
  const rows = db
    .query<{ faction: string; power: number }, []>(
      "SELECT faction, power FROM faction_power ORDER BY faction",
    )
    .all();
  return rows.length === 0 ? null : Object.fromEntries(rows.map((r) => [r.faction, r.power]));
}

/** Saves every power held, by key; a faction's saved power stays when the world drops it. */
export function saveFactionPowers(db: Db, p: Readonly<FactionPowers>): void {
  const put = db.query(
    `INSERT INTO faction_power (faction, power) VALUES (?, ?)
     ON CONFLICT (faction) DO UPDATE SET power = excluded.power`,
  );
  // One row per faction: another spelling of the key (by case) is an older entry, and goes.
  const others = db.query(
    "DELETE FROM faction_power WHERE lower(faction) = lower(?) AND faction != ?",
  );
  for (const [faction, power] of Object.entries(p)) {
    others.run(faction, faction);
    put.run(faction, power);
  }
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
