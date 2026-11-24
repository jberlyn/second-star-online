/**
 * Opens the SQLite database: bun:sqlite, WAL, synchronous API.
 */
import { Database } from "bun:sqlite";

/** The `Db` dependency. */
export type Db = Database;

/**
 * How long a statement waits for another process's lock before failing with SQLITE_BUSY. Only
 * another process can hold one: the operator commands (`admin:role`, `admin:audit`), or a server
 * that is still closing the file. The wait blocks the game thread, so it is short: a lock held
 * for a few milliseconds costs that much, and a stuck one fails within a second as it did before.
 */
export const BUSY_TIMEOUT_MS = 1000;

/** `path` defaults to an in-memory database (tests, bot E2E). */
/** An existing file opened read-only, to look at it without changing it. Throws when it is missing. */
export function openDatabaseReadOnly(path: string): Db {
  return new Database(path, { readonly: true });
}

export function openDatabase(path = ":memory:"): Db {
  const db = new Database(path, { create: true, strict: true });
  // First, so the pragmas below also wait instead of failing on a locked file.
  db.run(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS};`);
  db.run("PRAGMA foreign_keys = ON;");
  if (path !== ":memory:") {
    db.run("PRAGMA journal_mode = WAL;");
    db.run("PRAGMA synchronous = NORMAL;");
  }
  return db;
}
