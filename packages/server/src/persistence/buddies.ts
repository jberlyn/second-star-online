/** Buddy lists per account. Callers own transactions. */
import type { Db } from "./database.ts";

/** The account's items in order (empty when it has none). */
export function loadBuddies(db: Db, accountId: string): string[] {
  return db
    .query<{ entry: string }, [string]>(
      "SELECT entry FROM buddies WHERE account_id = ? ORDER BY position",
    )
    .all(accountId)
    .map((r) => r.entry);
}

/** Replaces the account's list. */
export function saveBuddies(db: Db, accountId: string, items: readonly string[]): void {
  db.query("DELETE FROM buddies WHERE account_id = ?").run(accountId);
  const ins = db.query("INSERT INTO buddies (account_id, position, entry) VALUES (?, ?, ?)");
  items.forEach((entry, i) => {
    ins.run(accountId, i + 1, entry);
  });
}
