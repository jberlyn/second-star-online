import { describe, expect, test } from "bun:test";

import { startingCharacter } from "@secondstaronline/shared";

import { insertCharacter } from "../src/persistence/characters.ts";
import { openDatabase } from "../src/persistence/database.ts";
import {
  appliedMigrations,
  loadMigrations,
  MIGRATIONS_DIR,
  migrate,
  runMigrations,
} from "../src/persistence/migrations.ts";

describe("migrations (real SQL on in-memory SQLite)", () => {
  test("applies the shipped migrations once", () => {
    const db = openDatabase();
    const first = migrate(db);
    expect(first.applied).toContain("20261104_01_accounts.sql");
    const second = migrate(db);
    expect(second.applied).toEqual([]);
    expect(second.skipped).toEqual(first.applied);
  });

  test("applies pending migrations in name order, each in its own transaction", () => {
    const db = openDatabase();
    runMigrations(db, [
      { name: "20260101_02_b.sql", sql: "INSERT INTO t VALUES (2);" },
      { name: "20260101_01_a.sql", sql: "CREATE TABLE t (v INTEGER);" },
    ]);
    expect(db.query("SELECT v FROM t").all()).toEqual([{ v: 2 }]);
  });

  test("a failing migration rolls back and is not recorded", () => {
    const db = openDatabase();
    expect(() =>
      runMigrations(db, [
        {
          name: "20260101_01_bad.sql",
          sql: "CREATE TABLE t (v INTEGER); INSERT INTO nope VALUES (1);",
        },
      ]),
    ).toThrow();
    expect(appliedMigrations(db).size).toBe(0);
    expect(db.query("SELECT name FROM sqlite_master WHERE name = 't'").all()).toEqual([]);
  });

  test("rejects a badly named migration", () => {
    const db = openDatabase();
    expect(() => runMigrations(db, [{ name: "add_stuff.sql", sql: "" }])).toThrow(/YYYYMMDD/);
  });

  test("enables foreign keys", () => {
    const db = openDatabase();
    expect(db.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  });

  test("the seed map is named Test map; a title already given is kept", () => {
    const fresh = openDatabase();
    migrate(fresh);
    expect(fresh.query("SELECT title FROM maps WHERE mx = 1000 AND my = 992").get()).toEqual({
      title: "Test map",
    });
    // A database migrated before this one, with a title an operator set.
    const old = openDatabase();
    runMigrations(
      old,
      loadMigrations(MIGRATIONS_DIR).filter((m) => !m.name.startsWith("20261109_24")),
    );
    old.run("UPDATE maps SET title = 'Home' WHERE mx = 1000 AND my = 992");
    runMigrations(old, loadMigrations(MIGRATIONS_DIR));
    expect(old.query("SELECT title FROM maps WHERE mx = 1000 AND my = 992").get()).toEqual({
      title: "Home",
    });
  });

  test("skills are open-ended: rows kept, 39 accepted, 0 refused (open_skills migration)", () => {
    const db = openDatabase();
    runMigrations(
      db,
      loadMigrations(MIGRATIONS_DIR).filter((m) => !m.name.startsWith("20261112_26")),
    );
    const map = db.query("SELECT id FROM maps LIMIT 1").get() as { id: string };
    db.run(
      "INSERT INTO accounts (id, username, password_hash, created_at, updated_at) VALUES ('a1', 'old', 'x', 'now', 'now')",
    );
    const start = startingCharacter({
      name: "old",
      sex: 1,
      head: 1,
      classCode: 1,
      str: 1,
      sta: 1,
      int: 1,
      wis: 1,
      dex: 1,
    });
    const id = insertCharacter(db, {
      accountId: "a1",
      start,
      position: { mapId: map.id, x: 5, y: 5, facing: "N" },
      now: "now",
    });
    db.run("UPDATE character_skills SET value = skill * 2 WHERE character_id = ?", [id]);
    expect((db.query("SELECT COUNT(*) AS n FROM character_skills").get() as { n: number }).n).toBe(
      38,
    );
    // Before the migration: skill 39 is refused.
    expect(() =>
      db.run("INSERT INTO character_skills (character_id, skill, value) VALUES (?, 39, 1)", [id]),
    ).toThrow();
    runMigrations(db, loadMigrations(MIGRATIONS_DIR));
    const rows = db
      .query("SELECT skill, value FROM character_skills WHERE character_id = ? ORDER BY skill")
      .all(id) as { skill: number; value: number }[];
    expect(rows).toEqual(
      Array.from({ length: 38 }, (_, i) => ({ skill: i + 1, value: (i + 1) * 2 })),
    );
    db.run("INSERT INTO character_skills (character_id, skill, value) VALUES (?, 39, 1)", [id]);
    expect(() =>
      db.run("INSERT INTO character_skills (character_id, skill, value) VALUES (?, 0, 1)", [id]),
    ).toThrow();
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});
