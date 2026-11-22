/**
 * The activity log's rows (systems/admin/activity.ts appends them; the game writes them once a
 * tick). Plain functions taking the `Db` first.
 */
import {
  type ActivityRow,
  type ActivityTotal,
  type ActivityType,
  isActivityType,
} from "@secondstaronline/shared";

import type { ActivityEntry } from "../systems/admin/activity.ts";
import type { Db } from "./database.ts";

/** Writes `entries` in order; an entry without a time takes `now`. The caller owns the transaction. */
export function insertActivity(db: Db, entries: readonly ActivityEntry[], now: string): void {
  if (entries.length === 0) {
    return;
  }
  const q = db.query(
    `INSERT INTO activity_log (id, created_at, type, account_id, character_id, character, other_id,
       other, item, qty, gold, map, x, y, details)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const e of entries) {
    q.run(
      Bun.randomUUIDv7(),
      e.at ?? now,
      e.type,
      e.accountId,
      e.characterId,
      e.character,
      e.otherId,
      e.other,
      e.item,
      e.qty,
      e.gold,
      e.map,
      e.x,
      e.y,
      e.details ? JSON.stringify(e.details) : null,
    );
  }
}

/** Which rows a query reads: one character's timeline, or every movement of one item. */
export type ActivityScope = { characterId: string } | { name: string } | { item: string };

export interface ActivityQuery {
  scope: ActivityScope;
  /** Only these types; every type when empty. */
  types: readonly ActivityType[];
  /** ISO times: from `since`, before `until`. */
  since: string | null;
  until: string | null;
  /** Rows older than this row (the next page: the last row of the page before). */
  before: { at: string; id: string } | null;
  limit: number;
}

interface Raw {
  id: string;
  created_at: string;
  type: string;
  character: string;
  other_id: string | null;
  other: string | null;
  item: string | null;
  qty: number;
  gold: number;
  map: string | null;
  x: number | null;
  y: number | null;
  details: string | null;
}

/** The newest `limit` rows matching `q`, newest first. */
export function activityRows(db: Db, q: ActivityQuery): ActivityRow[] {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if ("characterId" in q.scope) {
    where.push("character_id = ?");
    args.push(q.scope.characterId);
  } else if ("name" in q.scope) {
    where.push("character = ? COLLATE NOCASE");
    args.push(q.scope.name);
  } else {
    where.push("item = ? COLLATE NOCASE");
    args.push(q.scope.item);
  }
  if (q.types.length > 0) {
    where.push(`type IN (${q.types.map(() => "?").join(", ")})`);
    args.push(...q.types);
  }
  if (q.since) {
    where.push("created_at >= ?");
    args.push(q.since);
  }
  if (q.until) {
    where.push("created_at < ?");
    args.push(q.until);
  }
  if (q.before) {
    // A row value, so the index on (…, created_at, id) seeks to it.
    where.push("(created_at, id) < (?, ?)");
    args.push(q.before.at, q.before.id);
  }
  args.push(q.limit);
  return db
    .query<Raw, (string | number)[]>(
      `SELECT id, created_at, type, character, other_id, other, item, qty, gold, map, x, y, details
       FROM activity_log WHERE ${where.join(" AND ")}
       ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .all(...args)
    .map(toRow);
}

function toRow(r: Raw): ActivityRow {
  let details: ActivityRow["details"] = null;
  if (r.details) {
    try {
      details = JSON.parse(r.details) as ActivityRow["details"];
    } catch {
      details = null;
    }
  }
  return {
    id: r.id,
    at: r.created_at,
    // A type a later version dropped still reads as something.
    type: isActivityType(r.type) ? r.type : "unlogged",
    character: r.character,
    other: r.other,
    otherIsPlayer: r.other_id !== null,
    item: r.item,
    qty: r.qty,
    gold: r.gold,
    map: r.map,
    x: r.x,
    y: r.y,
    details,
  };
}

/**
 * Per type, the items gained and lost across the newest `cap` rows of `item` in the time range
 * (`capped` when older rows were left out). The cap bounds the work: the query runs on the game's
 * thread.
 */
export function activityItemTotals(
  db: Db,
  item: string,
  since: string | null,
  until: string | null,
  cap = Number.MAX_SAFE_INTEGER,
): { totals: ActivityTotal[]; capped: boolean } {
  const where = ["item = ? COLLATE NOCASE"];
  const args: string[] = [item];
  if (since) {
    where.push("created_at >= ?");
    args.push(since);
  }
  if (until) {
    where.push("created_at < ?");
    args.push(until);
  }
  const rows = db
    .query<{ type: string; gained: number; lost: number; rows: number }, (string | number)[]>(
      `SELECT type, SUM(CASE WHEN qty > 0 THEN qty ELSE 0 END) AS gained,
         SUM(CASE WHEN qty < 0 THEN -qty ELSE 0 END) AS lost, COUNT(*) AS rows
       FROM (SELECT type, qty FROM activity_log WHERE ${where.join(" AND ")}
         ORDER BY created_at DESC, id DESC LIMIT ?)
       GROUP BY type ORDER BY type`,
    )
    .all(...args, cap);
  // Capped only when a row past the cap exists: exactly `cap` rows is all of them.
  const counted = rows.reduce((n, r) => n + r.rows, 0);
  const older =
    counted >= cap &&
    db
      .query<{ one: number }, (string | number)[]>(
        `SELECT 1 AS one FROM activity_log WHERE ${where.join(" AND ")}
         ORDER BY created_at DESC, id DESC LIMIT 1 OFFSET ?`,
      )
      .get(...args, cap) !== null;
  return {
    totals: rows
      .filter((r) => isActivityType(r.type))
      .map((r) => ({ type: r.type as ActivityType, gained: r.gained, lost: r.lost, rows: r.rows })),
    capped: older,
  };
}

/** Forgets rows older than `days` days (0 keeps them). */
export function pruneActivity(db: Db, now: string, days: number): void {
  if (days <= 0) {
    return;
  }
  const cutoff = new Date(Date.parse(now) - days * 86_400_000).toISOString();
  db.query("DELETE FROM activity_log WHERE created_at < ?").run(cutoff);
}
