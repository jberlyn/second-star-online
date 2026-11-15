/** Operator setting overrides. Defaults live in ../settings.ts. */
import type { Db } from "./database.ts";

export function loadSettingOverrides(db: Db): Map<string, string> {
  const rows = db
    .query<{ key: string; value: string }, []>("SELECT key, value FROM settings")
    .all();
  return new Map(rows.map((r) => [r.key, r.value]));
}

export function saveSettingOverride(db: Db, key: string, value: unknown, now: string): void {
  db.query(
    "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  ).run(key, JSON.stringify(value), now);
}
