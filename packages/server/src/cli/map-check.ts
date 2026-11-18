/**
 * Operator command line: lists the travel that leads nowhere, so it can be fixed before players
 * find it. Exits, edges, `/warp` and Portal refuse a map that is not there, so a dangling exit
 * only reads "You cannot go that way." in play. It reports:
 *
 * - an Exit or Exit2 whose target map does not exist;
 * - an `Exit` or `Exit2` tile on a map with no such exit set;
 * - a start point, respawn point or Portal target setting whose map does not exist.
 *
 * Builders may add an exit before its map, so the World Editor saves it regardless.
 *
 * Run: `bun run maps:check` (SSO_DB as for the server).
 */
import { exitTarget, lingoEq } from "@secondstaronline/shared";

import { type Db, openDatabase } from "../persistence/database.ts";
import { listMaps } from "../persistence/maps.ts";
import { migrate } from "../persistence/migrations.ts";
import { loadSettingOverrides } from "../persistence/settings.ts";
import { resolveSettings } from "../settings.ts";

/** The report's lines for a migrated database; empty when every exit and point leads somewhere. */
export function mapCheck(db: Db): string[] {
  const maps = listMaps(db);
  const names = new Set(maps.map((m) => m.name));
  const lines: string[] = [];
  const tiles = db.query<{ x: number; y: number; item: string }, [string]>(
    "SELECT x, y, item FROM ground_items WHERE map_id = ? ORDER BY y, x",
  );
  for (const m of maps) {
    for (const [field, e] of [
      ["Exit", m.exit1],
      ["Exit2", m.exit2],
    ] as const) {
      if (e && !names.has(exitTarget(e))) {
        lines.push(
          `${m.name}: ${field} leads to ${exitTarget(e)} (${e.x}, ${e.y}), which does not exist`,
        );
      }
    }
    for (const t of tiles.all(m.id)) {
      const field = lingoEq(t.item, "Exit") ? "Exit" : lingoEq(t.item, "Exit2") ? "Exit2" : null;
      const set = field === "Exit" ? m.exit1 : m.exit2;
      if (field && !set) {
        lines.push(`${m.name}: an ${field} tile at (${t.x}, ${t.y}) has no ${field} set`);
      }
    }
  }
  const settings = resolveSettings(loadSettingOverrides(db));
  const points = [
    ["startPoint", settings.startPoint],
    ["respawnPoint", settings.respawnPoint],
    ...settings.portalTargets.map((t, i) => [`portalTargets ${i + 1}`, t] as const),
  ] as const;
  for (const [name, pt] of points) {
    if (!names.has(pt.map)) {
      lines.push(`setting ${name}: ${pt.map} (${pt.x}, ${pt.y}) does not exist`);
    }
  }
  return lines;
}

if (import.meta.main) {
  const db = openDatabase(process.env.SSO_DB ?? "sso.sqlite");
  migrate(db);
  const lines = mapCheck(db);
  db.close();
  for (const line of lines) {
    console.log(line);
  }
  if (lines.length === 0) {
    console.log("Every exit and setting point leads to a map.");
  }
  process.exit(lines.length === 0 ? 0 : 1);
}
