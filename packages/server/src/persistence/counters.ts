/**
 * The world counters (issue #3): each counter's value by name. Callers own transactions.
 */
import type { Db } from "./database.ts";

/** Every saved counter value, by name. */
export function loadCounters(db: Db): Record<string, number> {
  const rows = db
    .query<{ name: string; value: number }, []>(
      "SELECT name, value FROM world_counters ORDER BY name",
    )
    .all();
  return Object.fromEntries(rows.map((r) => [r.name, r.value]));
}

/**
 * Saves every value held, by name. Another spelling of the name (by case) is an older row, and
 * goes; a counter not held keeps its row.
 */
export function saveCounters(db: Db, counters: Readonly<Record<string, number>>): void {
  const put = db.query(
    `INSERT INTO world_counters (name, value) VALUES (?, ?)
     ON CONFLICT (name) DO UPDATE SET value = excluded.value`,
  );
  const others = db.query("DELETE FROM world_counters WHERE lower(name) = lower(?) AND name != ?");
  for (const [name, value] of Object.entries(counters)) {
    others.run(name, name);
    put.run(name, value);
  }
}
