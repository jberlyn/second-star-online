/**
 * Admin rows: character lookups, the audit log and the cheat log (bans: moderation.ts). Plain functions taking the
 * `Db` first.
 */
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
