/** Named containers: `container_items`, one row per line. Callers own the transaction. */
import type { Db } from "./database.ts";

/** Every container's lines, by name, in order. */
export function loadContainers(db: Db): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const rows = db
    .query<{ name: string; item: string }, []>(
      "SELECT name, item FROM container_items ORDER BY name, position",
    )
    .all();
  for (const r of rows) {
    const lines = out.get(r.name) ?? [];
    lines.push(r.item);
    out.set(r.name, lines);
  }
  return out;
}

/** Rewrites one container (`file(...).write`). */
export function saveContainer(db: Db, name: string, items: readonly string[]): void {
  db.query("DELETE FROM container_items WHERE name = ?").run(name);
  const ins = db.prepare("INSERT INTO container_items (name, position, item) VALUES (?, ?, ?)");
  items.forEach((item, i) => {
    ins.run(name, i + 1, item);
  });
}
