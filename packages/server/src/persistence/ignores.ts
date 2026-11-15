/** Ignore lists per account. Callers own transactions. */
import type { Db } from "./database.ts";

/** The account's list in order (empty when it has none). */
export function loadIgnores(db: Db, accountId: string): string[] {
  return db
    .query<{ entry: string }, [string]>(
      "SELECT entry FROM ignores WHERE account_id = ? ORDER BY position",
    )
    .all(accountId)
    .map((r) => r.entry);
}

/** Replaces the account's list. */
export function saveIgnores(db: Db, accountId: string, list: readonly string[]): void {
  db.query("DELETE FROM ignores WHERE account_id = ?").run(accountId);
  const ins = db.query("INSERT INTO ignores (account_id, position, entry) VALUES (?, ?, ?)");
  list.forEach((entry, i) => {
    ins.run(accountId, i + 1, entry);
  });
}
