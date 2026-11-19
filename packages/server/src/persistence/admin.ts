/**
 * Admin rows: character lookups, the audit log and the cheat log (bans: moderation.ts). Plain functions taking the
 * `Db` first.
 */
import { type AuditTrailRow, MODERATION_COMMANDS } from "@secondstaronline/shared";

import type { Role } from "./accounts.ts";
import type { Db } from "./database.ts";

/** A character with its account, by name ignoring case (names are unique, NOCASE). */
export interface CharacterAccount {
  characterId: string;
  accountId: string;
  name: string;
  role: Role;
  classCode: number;
}

export function findCharacterAccount(db: Db, name: string): CharacterAccount | null {
  const row = db
    .query<
      { character_id: string; account_id: string; name: string; role: Role; class_code: number },
      [string]
    >(
      `SELECT c.id AS character_id, a.id AS account_id, c.name, a.role, c.class_code
       FROM characters c
       JOIN accounts a ON a.id = c.account_id
       WHERE c.name = ? LIMIT 1`,
    )
    .get(name);
  return row
    ? {
        characterId: row.character_id,
        accountId: row.account_id,
        name: row.name,
        role: row.role,
        classCode: row.class_code,
      }
    : null;
}

export function setClassCode(db: Db, characterId: string, code: number, now: string): void {
  db.query("UPDATE characters SET class_code = ?, updated_at = ? WHERE id = ?").run(
    code,
    now,
    characterId,
  );
}

export interface AuditEntry {
  /** The acting account's id, or `cli` for the server command line. */
  actor: string;
  command: string;
  target?: string | null;
  before?: unknown;
  after?: unknown;
}

const json = (v: unknown) => (v === undefined ? null : JSON.stringify(v));

export function insertAudit(db: Db, e: AuditEntry, now: string): void {
  db.query(
    "INSERT INTO audit_log (id, actor, command, target, before, after, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(
    Bun.randomUUIDv7(),
    e.actor,
    e.command,
    e.target ?? null,
    json(e.before),
    json(e.after),
    now,
  );
}

export interface AuditRow {
  actor: string;
  command: string;
  target: string | null;
  before: string | null;
  after: string | null;
  createdAt: string;
}

/** Forgets audit rows older than `days` days (0 keeps them). */
export function pruneAudit(db: Db, now: string, days: number): void {
  if (days <= 0) {
    return;
  }
  const cutoff = new Date(Date.parse(now) - days * 86_400_000).toISOString();
  db.query("DELETE FROM audit_log WHERE created_at < ?").run(cutoff);
}

/** The newest `limit` audit rows, oldest first, with the actor's account name where it has one. */
export function recentAudit(db: Db, limit: number): AuditRow[] {
  return db
    .query<
      {
        actor: string;
        command: string;
        target: string | null;
        before: string | null;
        after: string | null;
        created_at: string;
      },
      [number]
    >(
      `SELECT COALESCE(a.username, l.actor) AS actor, l.command, l.target, l.before, l.after, l.created_at
       FROM audit_log l LEFT JOIN accounts a ON a.id = l.actor
       ORDER BY l.created_at DESC, l.id DESC LIMIT ?`,
    )
    .all(limit)
    .reverse()
    .map((r) => ({
      actor: r.actor,
      command: r.command,
      target: r.target,
      before: r.before,
      after: r.after,
      createdAt: r.created_at,
    }));
}

/**
 * `/auditlog`: the newest `limit` staff actions by `accountId` or to `name`, oldest first. Bans,
 * jails, IP bans and pardons come from the moderation log, which keeps their reasons; the audit
 * log's copy of each is left out.
 */
export function auditTrail(
  db: Db,
  q: { accountId: string | null; name: string; limit: number },
): AuditTrailRow[] {
  const moderated = Object.values(MODERATION_COMMANDS);
  // Numbered after ?1-?3, which the query names itself.
  const marks = moderated.map((_, i) => `?${i + 4}`).join(", ");
  const actions = Object.entries(MODERATION_COMMANDS)
    .map(([a, c]) => `WHEN '${a}' THEN '${c}'`)
    .join(" ");
  return db
    .query<
      {
        at: string;
        actor: string;
        action: string;
        target: string | null;
        before: string | null;
        after: string | null;
        reason: string | null;
        expires_at: string | null;
        permanent: number;
      },
      (string | number | null)[]
    >(
      `SELECT * FROM (
         SELECT l.created_at AS at, l.id, COALESCE(a.username, l.actor) AS actor,
           l.command AS action, l.target, l.before, l.after, NULL AS reason, NULL AS expires_at,
           0 AS permanent
         FROM audit_log l LEFT JOIN accounts a ON a.id = l.actor
         WHERE (l.actor = ?1 OR l.target = ?2 COLLATE NOCASE) AND l.command NOT IN (${marks})
         UNION ALL
         SELECT m.created_at, m.id, m.actor_name, CASE m.action ${actions} END,
           COALESCE(m.character_name, m.address), NULL, NULL, m.reason, m.expires_at,
           m.action IN ('ban', 'jail', 'ipban') AND m.expires_at IS NULL
         FROM moderation_log m
         WHERE m.actor_id = ?1 OR m.account_id = ?1 OR m.character_name = ?2 COLLATE NOCASE
       ) ORDER BY at DESC, id DESC LIMIT ?3`,
    )
    .all(q.accountId, q.name, q.limit, ...moderated)
    .reverse()
    .map((r) => ({
      at: r.at,
      actor: r.actor,
      action: r.action,
      target: r.target,
      before: r.before,
      after: r.after,
      reason: r.reason,
      expiresAt: r.expires_at,
      permanent: r.permanent === 1,
    }));
}

export function insertCheat(
  db: Db,
  e: { name: string; ip: string; reason: string },
  now: string,
): void {
  db.query("INSERT INTO cheat_log (id, name, ip, reason, created_at) VALUES (?, ?, ?, ?, ?)").run(
    Bun.randomUUIDv7(),
    e.name,
    e.ip,
    e.reason,
    now,
  );
}

/** The newest `limit` cheat log entries, oldest first (1.6 appended to the file). */
export function recentCheats(
  db: Db,
  limit: number,
): { name: string; ip: string; reason: string }[] {
  return db
    .query<{ name: string; ip: string; reason: string }, [number]>(
      "SELECT name, ip, reason FROM cheat_log ORDER BY created_at DESC, id DESC LIMIT ?",
    )
    .all(limit)
    .reverse();
}
