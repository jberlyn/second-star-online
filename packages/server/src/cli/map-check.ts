/**
 * Operator command line: lists the travel that leads nowhere, so it can be fixed before players
 * find it. Exits, edges, `/warp` and Portal refuse a map that is not there, so a dangling exit
 * only reads "You cannot go that way." in play. It reports:
 *
 * - an Exit or Exit2 whose target map does not exist;
 * - an `Exit` or `Exit2` tile on a map with no such exit set;
 * - a start point, fallback point, jail, church bell map or Portal target setting whose map does not
 *   exist;
 * - a start point, fallback point or jail whose tile cannot hold a player, or a start or fallback
 *   point on the jail's map (the content contract).
 *
 * Builders may add an exit before its map, so the World Editor saves it regardless.
 *
 * Run: `bun run maps:check` (SSO_DB as for the server).
 */
import "../content-classic.ts";

import { RELEASE_PACK_DIRS } from "@secondstaronline/data/packs";
import {
  exitTarget,
  installContent,
  lingoEq,
  mapName,
  parseMapName,
} from "@secondstaronline/shared";

import {
  CONTRACT_POINTS,
  type ContractPoint,
  jailMapProblem,
  pointProblem,
} from "../content/contract.ts";
import { ContentService } from "../content/service.ts";
import type { Db } from "../persistence/database.ts";
import { peekGround } from "../persistence/ground.ts";
import { listMaps } from "../persistence/maps.ts";
import { loadSettingOverrides } from "../persistence/settings.ts";
import { resolveSettings } from "../settings.ts";
import { openWorldDatabase } from "./world-db.ts";

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
    ["fallbackPoint", settings.fallbackPoint],
    ["jailPoint", settings.jailPoint],
    ...settings.portalTargets.map((t, i) => [`portalTargets ${i + 1}`, t] as const),
  ] as const;
  // A setting may spell a grid map another way (`x00y0`); the game reads it as that map.
  const canon = (name: string) => {
    const c = parseMapName(name);
    return c ? mapName(c.mx, c.my) : name;
  };
  for (const [name, pt] of points) {
    if (!names.has(canon(pt.map))) {
      lines.push(`setting ${name}: ${pt.map} (${pt.x}, ${pt.y}) does not exist`);
    }
  }
  if (settings.bellMap !== null && !names.has(canon(settings.bellMap))) {
    lines.push(`setting bellMap: ${settings.bellMap} does not exist`);
  }
  // A point whose map exists must also hold a player: a walkable tile, nothing in the way.
  const byName = new Map(maps.map((m) => [m.name, m]));
  for (const key of Object.keys(CONTRACT_POINTS) as ContractPoint[]) {
    const pt = settings[key];
    const m = byName.get(canon(pt.map));
    const problem = m
      ? pointProblem(pt, () => ({
          layers: m.layers,
          ground: peekGround(db, m.id, new Date().toISOString()),
        }))
      : null;
    if (problem !== null) {
      lines.push(`setting ${key}: ${problem}`);
    }
    const onJail = jailMapProblem(key, settings);
    if (onJail !== null) {
      lines.push(`setting ${key}: ${onJail}`);
    }
  }
  return lines;
}

if (import.meta.main) {
  let db: Db;
  try {
    db = openWorldDatabase(process.env.SSO_DB ?? "sso.sqlite");
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(2);
  }
  // Judge the maps by the server's own content: its packs and the operator's published changes.
  installContent(
    new ContentService({
      db,
      now: () => new Date().toISOString(),
      releasePacks: RELEASE_PACK_DIRS,
    }).store(),
  );
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
