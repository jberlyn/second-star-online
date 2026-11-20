/**
 * Moderation rows: the moderation log, the bans, IP bans, jails and mutes in force, and the addresses each
 * account has played from. Plain functions taking the `Db` first. A row whose `expires_at` has
 * passed is no longer in force; the readers return it anyway and the rules (`isActive`) decide.
 */
import {
  type AddressSeen,
  canonicalIp,
  type IpBanRecord,
  type ModerationAction,
  type ModerationEntry,
  type ModerationLogRow,
  type ModerationRecord,
  type NamedRecord,
} from "@secondstaronline/shared";

import type { Db } from "./database.ts";

interface RecordRow {
  log_id: string;
  actor_id: string;
  actor_name: string;
  actor_role: string;
  reason: string;
  created_at: string;
  expires_at: string | null;
}

const RECORD_COLUMNS = "log_id, actor_id, actor_name, actor_role, reason, created_at, expires_at";

const toRecord = (r: RecordRow): ModerationRecord => ({
  actorId: r.actor_id,
  actorName: r.actor_name,
  actorRole: r.actor_role,
  reason: r.reason,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
});

interface IpRow extends RecordRow {
  ip_key: string;
  address: string;
  source_account_id: string | null;
}

const toIpBan = (r: IpRow): IpBanRecord => ({
  ...toRecord(r),
  key: r.ip_key,
  address: r.address,
  sourceAccountId: r.source_account_id,
});

/** The account's ban, in force or lapsed, or null. */
export function accountBan(db: Db, accountId: string): ModerationRecord | null {
  const row = db
    .query<RecordRow, [string]>(`SELECT ${RECORD_COLUMNS} FROM account_bans WHERE account_id = ?`)
    .get(accountId);
  return row ? toRecord(row) : null;
}

/** The character's sentence, in force or lapsed, or null. */
export function characterJail(db: Db, characterId: string): ModerationRecord | null {
  const row = db
    .query<RecordRow, [string]>(`SELECT ${RECORD_COLUMNS} FROM jails WHERE character_id = ?`)
    .get(characterId);
  return row ? toRecord(row) : null;
}

/** The account's mute, in force or lapsed, or null. */
export function accountMute(db: Db, accountId: string): ModerationRecord | null {
  const row = db
    .query<RecordRow, [string]>(`SELECT ${RECORD_COLUMNS} FROM mutes WHERE account_id = ?`)
    .get(accountId);
  return row ? toRecord(row) : null;
}

/** The IP ban on an address key, in force or lapsed, or null. */
export function ipBan(db: Db, key: string): IpBanRecord | null {
  const row = db
    .query<IpRow, [string]>(
      `SELECT ip_key, address, source_account_id, ${RECORD_COLUMNS} FROM ip_bans WHERE ip_key = ?`,
    )
    .get(key);
  return row ? toIpBan(row) : null;
}

/** The IP bans made on the addresses of an account (`/banip <name>`). */
export function ipBansFrom(db: Db, accountId: string): IpBanRecord[] {
  return db
    .query<IpRow, [string]>(
      `SELECT ip_key, address, source_account_id, ${RECORD_COLUMNS} FROM ip_bans
       WHERE source_account_id = ? ORDER BY created_at, ip_key`,
    )
    .all(accountId)
    .map(toIpBan);
}

/** Logs one action and applies it to the table it changes, in one transaction. */
export function recordModeration(db: Db, e: ModerationEntry): string {
  const id = Bun.randomUUIDv7();
  db.transaction(() => {
    const replaces = currentLogId(db, e);
    db.query(
      `INSERT INTO moderation_log (id, action, account_id, character_name, ip_key, address,
         actor_id, actor_name, actor_role, reason, expires_at, replaces, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      e.action,
      e.accountId ?? null,
      e.characterName ?? null,
      e.ipKey ?? null,
      e.address ?? null,
      e.actorId,
      e.actorName,
      e.actorRole,
      e.reason,
      e.expiresAt,
      replaces,
      e.createdAt,
    );
    const values = [
      id,
      e.actorId,
      e.actorName,
      e.actorRole,
      e.reason,
      e.createdAt,
      e.expiresAt,
    ] as const;
    switch (e.action) {
      case "ban":
        db.query(
          `INSERT OR REPLACE INTO account_bans (account_id, ${RECORD_COLUMNS})
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(need(e.accountId), ...values);
        return;
      case "unban":
        db.query("DELETE FROM account_bans WHERE account_id = ?").run(need(e.accountId));
        return;
      case "jail":
        db.query(
          `INSERT OR REPLACE INTO jails (character_id, ${RECORD_COLUMNS})
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(need(e.characterId), ...values);
        return;
      case "unjail":
        db.query("DELETE FROM jails WHERE character_id = ?").run(need(e.characterId));
        return;
      case "mute":
        db.query(
          `INSERT OR REPLACE INTO mutes (account_id, ${RECORD_COLUMNS})
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(need(e.accountId), ...values);
        return;
      case "unmute":
        db.query("DELETE FROM mutes WHERE account_id = ?").run(need(e.accountId));
        return;
      case "ipban":
        db.query(
          `INSERT OR REPLACE INTO ip_bans (ip_key, address, source_account_id, ${RECORD_COLUMNS})
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(need(e.ipKey), need(e.address), e.sourceAccountId ?? null, ...values);
        return;
      case "unipban":
        db.query("DELETE FROM ip_bans WHERE ip_key = ?").run(need(e.ipKey));
        return;
      case "pardon":
        return;
    }
  })();
  return id;
}

const need = (v: string | null | undefined): string => {
  if (!v) {
    throw new Error("moderation entry is missing its target");
  }
  return v;
};

/** The log id of the row this action replaces or lifts, if any. */
function currentLogId(db: Db, e: ModerationEntry): string | null {
  const get = (sql: string, key: string | null | undefined) =>
    key ? (db.query<{ log_id: string }, [string]>(sql).get(key)?.log_id ?? null) : null;
  switch (e.action) {
    case "ban":
    case "unban":
      return get("SELECT log_id FROM account_bans WHERE account_id = ?", e.accountId);
    case "jail":
    case "unjail":
      return get("SELECT log_id FROM jails WHERE character_id = ?", e.characterId);
    case "mute":
    case "unmute":
      return get("SELECT log_id FROM mutes WHERE account_id = ?", e.accountId);
    case "ipban":
    case "unipban":
      return get("SELECT log_id FROM ip_bans WHERE ip_key = ?", e.ipKey);
    default:
      return null;
  }
}

/**
 * Notes a login or resume from `ip` (already a valid gateway address) and forgets this account's
 * addresses not seen for `keepDays` days (0 keeps them).
 */
export function noteAddress(
  db: Db,
  accountId: string,
  ip: string,
  now: string,
  keepDays: number,
): void {
  if (ip === "") {
    return;
  }
  if (keepDays > 0) {
    const cutoff = new Date(Date.parse(now) - keepDays * 86_400_000).toISOString();
    db.query("DELETE FROM account_addresses WHERE account_id = ? AND last_seen < ?").run(
      accountId,
      cutoff,
    );
  }
  const c = canonicalIp(ip);
  const address = c?.address ?? ip;
  const key = c?.key ?? ip;
  db.query(
    `INSERT INTO account_addresses (account_id, address, ip_key, first_seen, last_seen, logins)
     VALUES (?, ?, ?, ?, ?, 1)
     ON CONFLICT (account_id, address) DO UPDATE SET last_seen = excluded.last_seen,
       logins = logins + 1`,
  ).run(accountId, address, key, now, now);
}

/** The addresses an account has played from, the latest first. */
export function accountAddresses(db: Db, accountId: string): AddressSeen[] {
  return db
    .query<{ address: string; ip_key: string; last_seen: string }, [string]>(
      `SELECT address, ip_key, last_seen FROM account_addresses WHERE account_id = ?
       ORDER BY last_seen DESC, address`,
    )
    .all(accountId)
    .map((r) => ({ address: r.address, key: r.ip_key, lastSeen: r.last_seen }));
}

/** The characters seen from an address key, the latest first. */
export function charactersAt(db: Db, key: string): { name: string; lastSeen: string }[] {
  return db
    .query<{ name: string; last_seen: string }, [string]>(
      `SELECT c.name, MAX(a.last_seen) AS last_seen FROM account_addresses a
       JOIN characters c ON c.account_id = a.account_id
       WHERE a.ip_key = ? GROUP BY c.id ORDER BY last_seen DESC, c.name`,
    )
    .all(key)
    .map((r) => ({ name: r.name, lastSeen: r.last_seen }));
}

/** The account bans in force at `now`, the newest first. */
export function activeBans(db: Db, now: string): NamedRecord[] {
  return db
    .query<RecordRow & { name: string }, [string]>(
      `SELECT c.name, b.log_id, b.actor_id, b.actor_name, b.actor_role, b.reason, b.created_at,
              b.expires_at
       FROM account_bans b JOIN characters c ON c.account_id = b.account_id
       WHERE b.expires_at IS NULL OR b.expires_at > ?
       ORDER BY b.created_at DESC, c.name`,
    )
    .all(now)
    .map((r) => ({ ...toRecord(r), name: r.name }));
}

/** The sentences in force at `now`, the newest first. */
export function activeJails(db: Db, now: string): NamedRecord[] {
  return db
    .query<RecordRow & { name: string }, [string]>(
      `SELECT c.name, j.log_id, j.actor_id, j.actor_name, j.actor_role, j.reason, j.created_at,
              j.expires_at
       FROM jails j JOIN characters c ON c.id = j.character_id
       WHERE j.expires_at IS NULL OR j.expires_at > ?
       ORDER BY j.created_at DESC, c.name`,
    )
    .all(now)
    .map((r) => ({ ...toRecord(r), name: r.name }));
}

/** The mutes in force at `now`, the newest first. */
export function activeMutes(db: Db, now: string): NamedRecord[] {
  return db
    .query<RecordRow & { name: string }, [string]>(
      `SELECT c.name, m.log_id, m.actor_id, m.actor_name, m.actor_role, m.reason, m.created_at,
              m.expires_at
       FROM mutes m JOIN characters c ON c.account_id = m.account_id
       WHERE m.expires_at IS NULL OR m.expires_at > ?
       ORDER BY m.created_at DESC, c.name`,
    )
    .all(now)
    .map((r) => ({ ...toRecord(r), name: r.name }));
}

/** The IP bans in force at `now`, the newest first, with the name of the account they came from. */
export function activeIpBans(db: Db, now: string): (IpBanRecord & { sourceName: string | null })[] {
  return db
    .query<IpRow & { source_name: string | null }, [string]>(
      `SELECT i.ip_key, i.address, i.source_account_id, i.log_id, i.actor_id, i.actor_name,
              i.actor_role, i.reason, i.created_at, i.expires_at,
              (SELECT c.name FROM characters c WHERE c.account_id = i.source_account_id LIMIT 1)
                AS source_name
       FROM ip_bans i WHERE i.expires_at IS NULL OR i.expires_at > ?
       ORDER BY i.created_at DESC, i.ip_key`,
    )
    .all(now)
    .map((r) => ({ ...toIpBan(r), sourceName: r.source_name }));
}

/**
 * An account's moderation history, oldest first, the newest `limit`: its bans, jails and pardons and
 * the IP bans made on its addresses by name.
 */
export function moderationHistory(db: Db, accountId: string, limit: number): ModerationLogRow[] {
  return db
    .query<
      {
        action: ModerationAction;
        address: string | null;
        actor_name: string;
        actor_role: string;
        reason: string;
        created_at: string;
        expires_at: string | null;
      },
      [string, number]
    >(
      `SELECT action, address, actor_name, actor_role, reason, created_at, expires_at
       FROM moderation_log WHERE account_id = ?
       ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .all(accountId, limit)
    .reverse()
    .map((r) => ({
      action: r.action,
      address: r.address,
      actorName: r.actor_name,
      actorRole: r.actor_role,
      reason: r.reason,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
    }));
}

/** The actor of a row the server writes itself, such as an expiry. */
export const SYSTEM_ACTOR = {
  actorId: "system",
  actorName: "system",
  actorRole: "System",
} as const;

/**
 * Every ban, IP ban, sentence and mute whose end has passed leaves its active table with a lift row
 * in `moderation_log` (`unban`, `unipban`, `unjail`, `unmute` by `system`, reason "Expired"), dated
 * when it ended, so the log shows every end, whether the player was online or not. Returns how
 * many ended.
 */
export function expireModeration(db: Db, now: string): number {
  const base = { ...SYSTEM_ACTOR, reason: "Expired", expiresAt: null };
  const ended: ModerationEntry[] = [
    ...db
      .query<{ account_id: string; expires_at: string }, [string]>(
        "SELECT account_id, expires_at FROM account_bans WHERE expires_at IS NOT NULL AND expires_at <= ?",
      )
      .all(now)
      .map((r) => ({
        ...base,
        action: "unban" as const,
        accountId: r.account_id,
        createdAt: r.expires_at,
      })),
    ...db
      .query<{ account_id: string; expires_at: string }, [string]>(
        "SELECT account_id, expires_at FROM mutes WHERE expires_at IS NOT NULL AND expires_at <= ?",
      )
      .all(now)
      .map((r) => ({
        ...base,
        action: "unmute" as const,
        accountId: r.account_id,
        createdAt: r.expires_at,
      })),
    ...db
      .query<
        {
          character_id: string;
          account_id: string | null;
          name: string | null;
          expires_at: string;
        },
        [string]
      >(
        `SELECT j.character_id, c.account_id, c.name, j.expires_at
         FROM jails j LEFT JOIN characters c ON c.id = j.character_id
         WHERE j.expires_at IS NOT NULL AND j.expires_at <= ?`,
      )
      .all(now)
      .map((r) => ({
        ...base,
        action: "unjail" as const,
        characterId: r.character_id,
        accountId: r.account_id,
        characterName: r.name,
        createdAt: r.expires_at,
      })),
    ...db
      .query<{ ip_key: string; address: string; expires_at: string }, [string]>(
        "SELECT ip_key, address, expires_at FROM ip_bans WHERE expires_at IS NOT NULL AND expires_at <= ?",
      )
      .all(now)
      .map((r) => ({
        ...base,
        action: "unipban" as const,
        ipKey: r.ip_key,
        address: r.address,
        createdAt: r.expires_at,
      })),
  ];
  db.transaction(() => {
    for (const e of ended) {
      recordModeration(db, e);
    }
  })();
  return ended.length;
}

/**
 * Startup housekeeping: lapsed bans, IP bans, sentences and mutes end with a lift row
 * (`expireModeration`), and addresses not seen for `addressDays` days are forgotten (0 keeps them).
 */
export function pruneModeration(db: Db, now: string, addressDays: number): void {
  db.transaction(() => {
    expireModeration(db, now);
    pruneAddresses(db, now, addressDays);
  })();
}

/** Forgets addresses not seen for `addressDays` days (0 keeps them). */
export function pruneAddresses(db: Db, now: string, addressDays: number): void {
  if (addressDays <= 0) {
    return;
  }
  const cutoff = new Date(Date.parse(now) - addressDays * 86_400_000).toISOString();
  db.query("DELETE FROM account_addresses WHERE last_seen < ?").run(cutoff);
}

/**
 * Puts IP bans carried over from before keys in their standard form: an address and its key (the
 * IPv6 /64). A row that is no address is lifted and logged; two that share a key keep the first.
 */
export function normalizeIpBans(db: Db, now: string): void {
  const rows = db
    .query<{ ip_key: string; address: string }, []>(
      "SELECT ip_key, address FROM ip_bans ORDER BY created_at, ip_key",
    )
    .all();
  db.transaction(() => {
    for (const r of rows) {
      const c = canonicalIp(r.address);
      if (c && c.key === r.ip_key && c.address === r.address) {
        continue;
      }
      if (!c || (c.key !== r.ip_key && ipBan(db, c.key))) {
        recordModeration(db, {
          action: "unipban",
          ipKey: r.ip_key,
          address: r.address,
          actorId: "system",
          actorName: "system",
          actorRole: "System",
          reason: c ? "Same address as another ban" : "Not an address",
          expiresAt: null,
          createdAt: now,
        });
        continue;
      }
      db.query("UPDATE ip_bans SET ip_key = ?, address = ? WHERE ip_key = ?").run(
        c.key,
        c.address,
        r.ip_key,
      );
      db.query("UPDATE moderation_log SET ip_key = ?, address = ? WHERE ip_key = ?").run(
        c.key,
        c.address,
        r.ip_key,
      );
    }
  })();
}
