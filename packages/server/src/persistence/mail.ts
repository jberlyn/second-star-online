/** Mailboxes: one row per message. Callers own transactions. */
import type { Db } from "./database.ts";

export interface MailRow {
  id: number;
  from: string;
  subject: string;
  body: string;
}

/** The character's mailbox, oldest first. */
export function loadMail(db: Db, ownerId: string): MailRow[] {
  return db
    .query<MailRow, [string]>(
      "SELECT id, sender AS `from`, subject, body FROM mail WHERE owner_id = ? ORDER BY id",
    )
    .all(ownerId);
}

/** Adds a message, then drops the oldest past `cap`. The sender is the name the server stamped. */
export function addMail(
  db: Db,
  ownerId: string,
  msg: { from: string; subject: string; body: string },
  sentAt: string,
  cap: number,
): void {
  db.query(
    "INSERT INTO mail (owner_id, sender, subject, body, sent_at) VALUES (?, ?, ?, ?, ?)",
  ).run(ownerId, msg.from, msg.subject, msg.body, sentAt);
  db.query(
    `DELETE FROM mail WHERE owner_id = ? AND id NOT IN
       (SELECT id FROM mail WHERE owner_id = ? ORDER BY id DESC LIMIT ?)`,
  ).run(ownerId, ownerId, cap);
}

/** Deletes one of the owner's own messages; another's id matches nothing. */
export function deleteMail(db: Db, ownerId: string, id: number): void {
  db.query("DELETE FROM mail WHERE owner_id = ? AND id = ?").run(ownerId, id);
}

/** A character by name, ignoring case (the column is NOCASE), or null. */
export function findCharacterByName(db: Db, name: string): { id: string; name: string } | null {
  return (
    db
      .query<{ id: string; name: string }, [string]>(
        "SELECT id, name FROM characters WHERE name = ?",
      )
      .get(name) ?? null
  );
}
