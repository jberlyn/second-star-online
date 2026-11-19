/**
 * The chat log's rows (systems/chat/log.ts appends them; the game writes them once a tick). Plain
 * functions taking the `Db` first.
 */
import type { ChatChannel, ChatLogRow, ChatOutcome } from "@secondstaronline/shared";

import type { ChatLogEntry } from "../systems/world/world.ts";
import type { Db } from "./database.ts";

/** Writes `entries` in order; an entry without a time takes `now`. The caller owns the transaction. */
export function insertChatLog(db: Db, entries: readonly ChatLogEntry[], now: string): void {
  if (entries.length === 0) {
    return;
  }
  const q = db.query(
    `INSERT INTO chat_log (id, created_at, channel, account_id, character_id, sender, target, text,
       outcome, heard, ignored, muffled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const e of entries) {
    q.run(
      Bun.randomUUIDv7(),
      e.at ?? now,
      e.channel,
      e.accountId,
      e.characterId,
      e.sender,
      e.target,
      e.text,
      e.outcome,
      e.heard ?? null,
      e.ignored ?? null,
      e.muffled ?? null,
    );
  }
}

export interface ChatLogQuery {
  /** Lines this character sent, and IMs and away replies sent to them; every line when absent. */
  name?: string;
  channel?: ChatChannel | null;
  /** ISO times: from `since`, before `until`. */
  since?: string | null;
  until?: string | null;
  limit: number;
}

/** The newest `limit` lines matching `q`, oldest first. */
export function chatLogLines(db: Db, q: ChatLogQuery): ChatLogRow[] {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (q.name !== undefined) {
    where.push(
      `(sender = ? COLLATE NOCASE
        OR (target = ? COLLATE NOCASE AND channel IN ('im', 'awayReply')))`,
    );
    args.push(q.name, q.name);
  }
  if (q.channel) {
    where.push("channel = ?");
    args.push(q.channel);
  }
  if (q.since) {
    where.push("created_at >= ?");
    args.push(q.since);
  }
  if (q.until) {
    where.push("created_at < ?");
    args.push(q.until);
  }
  args.push(q.limit);
  return db
    .query<
      {
        created_at: string;
        channel: ChatChannel;
        sender: string;
        target: string | null;
        text: string;
        outcome: ChatOutcome;
        heard: number | null;
        ignored: number | null;
        muffled: number | null;
      },
      (string | number)[]
    >(
      `SELECT created_at, channel, sender, target, text, outcome, heard, ignored, muffled
       FROM chat_log ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .all(...args)
    .reverse()
    .map((r) => ({
      at: r.created_at,
      channel: r.channel,
      sender: r.sender,
      target: r.target,
      text: r.text,
      outcome: r.outcome,
      heard: r.heard,
      ignored: r.ignored,
      muffled: r.muffled,
    }));
}

/** Forgets lines older than `days` days (0 keeps them). */
export function pruneChatLog(db: Db, now: string, days: number): void {
  if (days <= 0) {
    return;
  }
  const cutoff = new Date(Date.parse(now) - days * 86_400_000).toISOString();
  db.query("DELETE FROM chat_log WHERE created_at < ?").run(cutoff);
}
