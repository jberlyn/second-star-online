/**
 * `/auditlog`: what staff did, by a character's account or to that character, from the audit log
 * (admin commands, editor saves, settings and role changes, `/chatlog` and `/cheatfile` looks) and
 * the moderation log (bans, jails, IP bans and pardons, with their reasons). 1.6 kept neither.
 * Pure.
 */

/** One entry, as the server reads it from either log. */
export interface AuditTrailRow {
  /** ISO time, UTC. */
  at: string;
  /** Who acted: the account's name for an audit row, the character's for a moderation row. */
  actor: string;
  /** `/warp`, `editSave`, `settings`, or a moderation action shown as its command (`/ban`). */
  action: string;
  target: string | null;
  /** Audit rows: the values before and after, as stored (JSON). */
  before: string | null;
  after: string | null;
  /** Moderation rows: why, and when it ends (null with `permanent` true: never). */
  reason: string | null;
  expiresAt: string | null;
  permanent: boolean;
}

/** Entries `/auditlog` shows when no count is given, and the most it shows. */
export const AUDITLOG_DEFAULT = 10;
export const AUDITLOG_MAX = 100;

/** The moderation actions as the commands that make them. */
export const MODERATION_COMMANDS = {
  ban: "/ban",
  unban: "/unban",
  ipban: "/banip",
  unipban: "/unbanip",
  jail: "/jail",
  unjail: "/unjail",
  pardon: "/pardon",
} as const;

/** `/auditlog <name> [count]`. Null for a missing name or a second word that is not a count. */
export function parseAuditlogArgs(typed: string): { name: string; limit: number } | null {
  const [, name, count, ...rest] = typed.trim().split(/\s+/);
  if (!name || rest.length > 0 || (count !== undefined && !/^\d+$/.test(count))) {
    return null;
  }
  const n = count === undefined ? AUDITLOG_DEFAULT : Number(count);
  return { name, limit: Math.min(AUDITLOG_MAX, Math.max(1, n)) };
}

const when = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;

/**
 * A stored JSON value as text: a string bare, anything else as JSON, cut to 80 characters; null for
 * none (a stored `null`).
 */
function shown(json: string | null): string | null {
  if (json === null) {
    return null;
  }
  let v: unknown;
  try {
    v = JSON.parse(json);
  } catch {
    v = json;
  }
  if (v === null) {
    return null;
  }
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 80 ? `${s.slice(0, 79)}…` : s;
}

/**
 * An `/auditlog` line: `2026-11-18 09:14:02 UTC Mod /jail Bob (until 2026-11-18 09:44:02 UTC,
 * "spamming")` or `2026-11-18 10:02:45 UTC King /setclass Bob: 1 -> 7`.
 */
export function auditlogLine(r: AuditTrailRow): string {
  const head = `${when(r.at)} ${r.actor} ${r.action}${r.target ? ` ${r.target}` : ""}`;
  if (r.reason !== null) {
    const notes: string[] = [];
    if (r.permanent) {
      notes.push("permanent");
    } else if (r.expiresAt) {
      notes.push(`until ${when(r.expiresAt)}`);
    }
    if (r.reason !== "") {
      notes.push(`"${r.reason}"`);
    }
    return notes.length > 0 ? `${head} (${notes.join(", ")})` : head;
  }
  const before = shown(r.before);
  const after = shown(r.after);
  if (before !== null && after !== null) {
    return `${head}: ${before} -> ${after}`;
  }
  return after !== null ? `${head}: ${after}` : head;
}

export const AUDITLOG_TEXT = {
  usage: `Usage: /auditlog <name> [count, default ${AUDITLOG_DEFAULT}, up to ${AUDITLOG_MAX}]`,
  header: (name: string, shown: number) =>
    `* Audit log for ${name}, by or to them, the last ${shown} entries:`,
  none: (name: string) => `No staff action is logged by or to ${name}.`,
} as const;
