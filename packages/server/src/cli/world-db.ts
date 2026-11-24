/**
 * The database the operator commands (`maps:check`, `admin:role`, `admin:audit`, `admin:chatlog`)
 * read: an established world only. Only the server creates a world, since only it seeds the chosen
 * pack; a command run first would otherwise make a bare database that the server then took for an
 * established world and never seeded. So a missing file, or one the server has not finished creating,
 * is refused, and nothing is written to it.
 */
import { existsSync } from "node:fs";

import { worldState } from "../content/world-seed.ts";
import { type Db, openDatabase, openDatabaseReadOnly } from "../persistence/database.ts";
import { migrate } from "../persistence/migrations.ts";

/** Refused: there is no established world at the path. */
export class NoWorldError extends Error {}

/**
 * Opens the established world at `path`, migrated as the server would. Throws `NoWorldError` when
 * the file does not exist, or the server has not created (or not finished creating) its world.
 */
export function openWorldDatabase(path: string): Db {
  const missing = () =>
    new NoWorldError(
      `${path}: no world here yet. Start the server once on it (SSO_DB as for the server) to create the world, then run this again.`,
    );
  if (path === ":memory:" || !existsSync(path)) {
    throw missing();
  }
  // Looked at read-only first, so a refused file is left exactly as it was.
  const peek = openDatabaseReadOnly(path);
  let state: ReturnType<typeof worldState>;
  try {
    state = worldState(peek);
  } finally {
    peek.close();
  }
  if (state !== "established") {
    throw missing();
  }
  const db = openDatabase(path);
  try {
    migrate(db);
    return db;
  } catch (err) {
    db.close();
    throw err;
  }
}
