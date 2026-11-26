/**
 * Schema migrations: numbered `.sql` files, each applied once, in its own transaction.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { Db } from "./database.ts";
import { moveKillXp } from "./kill-xp-content.ts";
import { churchMapSql, jailMapSql, seedMapSql } from "./seed-map.ts";
import { splitSqlStatements } from "./sql-split.ts";
import { moveVehicleContent } from "./vehicle-content.ts";

/** `YYYYMMDD_NN_<name>.sql` */
export const MIGRATION_FILE_PATTERN = /^\d{8}_\d{2}_[\w-]+\.sql$/;

/** First line of a migration that must run with foreign keys off (a table rebuild). */
export const FOREIGN_KEYS_OFF = "-- migrate: foreign_keys off";

/** The migrations shipped with the server. */
export const MIGRATIONS_DIR = join(import.meta.dir, "..", "..", "migrations");

export interface Migration {
  name: string;
  sql: string;
  /** Code that runs after the SQL, in the same transaction (a move SQL cannot express). */
  code?: (db: Db) => void;
}

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

export function loadMigrations(dir: string = MIGRATIONS_DIR): Migration[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => {
      if (!MIGRATION_FILE_PATTERN.test(name)) {
        throw new Error(`Invalid migration name '${name}': expected YYYYMMDD_NN_<name>.sql`);
      }
      const sql = readFileSync(join(dir, name), "utf8");
      // Keep historical schema SQL intact. Only a fresh installation applies this migration;
      // seed content belongs to the same transaction and is never an upgrade-time map rewrite.
      const seed = dir === MIGRATIONS_DIR && name === "20261104_02_characters_and_world.sql";
      if (dir === MIGRATIONS_DIR && name === "20261115_27_jail_map.sql") {
        return { name, sql: `${sql}\n${jailMapSql()}\n` };
      }
      if (dir === MIGRATIONS_DIR && name === "20261115_28_church_map.sql") {
        return { name, sql: `${sql}\n${churchMapSql()}\n` };
      }
      if (dir === MIGRATIONS_DIR && name === "20261125_73_vehicles_as_content.sql") {
        return { name, sql, code: moveVehicleContent };
      }
      if (dir === MIGRATIONS_DIR && name === "20261126_75_kill_xp_on_species.sql") {
        return { name, sql, code: moveKillXp };
      }
      return { name, sql: seed ? `${sql}\n${seedMapSql()}\n` : sql };
    });
}

export function appliedMigrations(db: Db): Set<string> {
  ensureMigrationsTable(db);
  const rows = db.query<{ name: string }, []>("SELECT name FROM _migrations ORDER BY id").all();
  return new Set(rows.map((r) => r.name));
}

export function runMigrations(db: Db, migrations: readonly Migration[]): MigrationResult {
  const done = appliedMigrations(db);
  const result: MigrationResult = { applied: [], skipped: [] };
  const record = db.prepare("INSERT INTO _migrations (name) VALUES (?)");
  for (const m of [...migrations].sort((a, b) => a.name.localeCompare(b.name))) {
    if (!MIGRATION_FILE_PATTERN.test(m.name)) {
      throw new Error(`Invalid migration name '${m.name}': expected YYYYMMDD_NN_<name>.sql`);
    }
    if (done.has(m.name)) {
      result.skipped.push(m.name);
      continue;
    }
    // A migration that rebuilds a referenced table (SQLite's 12-step ALTER) declares it on its
    // first line; foreign keys can only be switched off outside a transaction.
    const rebuild = m.sql.startsWith(FOREIGN_KEYS_OFF);
    if (rebuild) {
      db.run("PRAGMA foreign_keys = OFF;");
    }
    // Only rows the rebuild breaks count: a database may already hold orphans it did not make.
    const violations = () =>
      new Set(
        db
          .query("PRAGMA foreign_key_check")
          .all()
          .map((r) => JSON.stringify(r)),
      );
    const before = rebuild ? violations() : new Set<string>();
    try {
      db.transaction(() => {
        // One statement at a time: bun:sqlite's multi-statement run raises only the last
        // statement's runtime error, so a failing statement earlier in a migration was skipped.
        // Any failure now throws, and the transaction rolls the whole migration back.
        for (const [n, stmt] of splitSqlStatements(m.sql).entries()) {
          try {
            db.run(stmt);
          } catch (e) {
            throw new Error(
              `${m.name}: statement ${n + 1} failed: ${e instanceof Error ? e.message : String(e)}`,
              { cause: e },
            );
          }
        }
        m.code?.(db);
        if (rebuild) {
          const broken = [...violations()].filter((v) => !before.has(v));
          if (broken.length > 0) {
            throw new Error(`${m.name}: foreign key check failed (${broken.length} rows)`);
          }
        }
        record.run(m.name);
      })();
    } finally {
      if (rebuild) {
        db.run("PRAGMA foreign_keys = ON;");
      }
    }
    done.add(m.name);
    result.applied.push(m.name);
  }
  return result;
}

/** Loads the shipped migrations and applies the pending ones. */
export function migrate(db: Db, dir: string = MIGRATIONS_DIR): MigrationResult {
  return runMigrations(db, loadMigrations(dir));
}

function ensureMigrationsTable(db: Db): void {
  db.run(`CREATE TABLE IF NOT EXISTS _migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
}
