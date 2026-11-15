/** The High Score Statue's top-10 rows. Callers own transactions. */
import type { AssassinEntry } from "@secondstaronline/shared";

import type { Db } from "./database.ts";

/** The table in rank order. */
export function loadHighScores(db: Db): AssassinEntry[] {
  return db
    .query<{ character_id: string; name: string; points: number }, []>(
      "SELECT character_id, name, points FROM high_scores ORDER BY rank",
    )
    .all()
    .map((r) => ({ id: r.character_id, name: r.name, points: r.points }));
}

/** Writes the whole table (at most ten rows). */
export function saveHighScores(db: Db, table: readonly AssassinEntry[]): void {
  db.query("DELETE FROM high_scores").run();
  const put = db.query(
    "INSERT INTO high_scores (rank, character_id, name, points) VALUES (?, ?, ?, ?)",
  );
  for (const [k, e] of table.entries()) {
    put.run(k + 1, e.id, e.name, e.points);
  }
}
