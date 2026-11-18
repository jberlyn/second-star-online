import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

  test("the seed map is named Willowbrook Wilds; a title already given is kept", () => {
    const fresh = openDatabase();
    migrate(fresh);
    expect(fresh.query("SELECT title FROM maps WHERE mx = 1000 AND my = 992").get()).toEqual({
      title: "Willowbrook Wilds",
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

  test("upgrades preserve both the old seed landscape and operator-authored maps", () => {
    for (const customized of [false, true]) {
      const existing = openDatabase();
      // Raw historical SQL reproduces a released database before the newest schema migration.
      runMigrations(
        existing,
        loadMigrations()
          .filter(
            (m) =>
              !m.name.startsWith("20261112_26") &&
              !m.name.includes("jail_map") &&
              !m.name.includes("church_map"),
          )
          .map((m) => ({
            name: m.name,
            sql: readFileSync(join(MIGRATIONS_DIR, m.name), "utf8"),
          })),
      );
      if (customized) {
        existing.run("UPDATE maps SET title = 'My forest', layer1 = replace(layer1, 'G1', 'H1')");
      }
      const before = existing.query("SELECT * FROM maps ORDER BY id").all();
      const settings = existing.query("SELECT * FROM settings ORDER BY key").all();
      migrate(existing);
      expect(
        existing.query("SELECT title FROM maps WHERE mx = 0 AND my = 0 AND slot = 0").get(),
      ).toEqual({ title: "Jail" });
      expect(
        existing.query("SELECT title FROM maps WHERE mx = 999 AND my = 999 AND slot = 0").get(),
      ).toEqual({ title: "Church of the Bells" });
      expect(
        existing
          .query(
            `SELECT * FROM maps WHERE NOT (
              (mx = 0 AND my = 0 AND slot = 0) OR (mx = 999 AND my = 999 AND slot = 0)
            ) ORDER BY id`,
          )
          .all(),
      ).toEqual(before);
      expect(existing.query("SELECT * FROM settings ORDER BY key").all()).toEqual(settings);
      migrate(existing);
      expect(
        existing
          .query(
            `SELECT * FROM maps WHERE NOT (
              (mx = 0 AND my = 0 AND slot = 0) OR (mx = 999 AND my = 999 AND slot = 0)
            ) ORDER BY id`,
          )
          .all(),
      ).toEqual(before);
      existing.close();
    }
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

  test("calculated_medals takes each held medal's points off the stored stats and drops the field", () => {
    const db = openDatabase();
    const all = loadMigrations(MIGRATIONS_DIR);
    runMigrations(
      db,
      all.filter((m) => m.name < "20261118_32"),
    );
    const map = db.query("SELECT id FROM maps LIMIT 1").get() as { id: string };
    db.run(
      "INSERT INTO accounts (id, username, password_hash, created_at, updated_at) VALUES ('a1', 'old', 'x', 'now', 'now')",
    );
    const insert = (id: string, name: string, medals: string, str: number, sta: number) =>
      db.run(
        `INSERT INTO characters (id, account_id, name, sex, head, class_code, level, hp, hp_max, sp,
          sp_max, exp, exp_needed, str, sta, agi, dex, int, wis, spd, aim, gold, profile, medals,
          hunger, break_count, map_id, x, y, facing, created_at, updated_at)
         VALUES (?, 'a1', ?, 1, 1, 1, 1, 20, 20, 20, 20, 0, 30, ?, ?, 1, 5, 5, 5, 1, 1, 0, '', ?,
          40000, 0, ?, 5, 5, 'S', 'now', 'now')`,
        [id, name, str, sta, medals, map.id],
      );
    // Slash (95: +1 Str) and Blacksmithing (92: +2 Str, +2 Sta); 1 cannot drop below 1.
    insert("c1", "Ann", "95-92-", 20, 12);
    insert("c2", "Bob", "", 20, 12);
    insert("c3", "Cat", "92-", 1, 1);
    runMigrations(db, all);
    const rows = db.query("SELECT name, str, sta FROM characters ORDER BY name").all() as {
      name: string;
      str: number;
      sta: number;
    }[];
    expect(rows).toEqual([
      { name: "Ann", str: 17, sta: 10 },
      { name: "Bob", str: 20, sta: 12 },
      { name: "Cat", str: 1, sta: 1 },
    ]);
    const cols = db.query("PRAGMA table_info(characters)").all() as { name: string }[];
    expect(cols.some((c) => c.name === "medals")).toBe(false);
  });

  test("calculated_class_stats takes the current class's promotion points off the stored stats", () => {
    const db = openDatabase();
    const all = loadMigrations(MIGRATIONS_DIR);
    runMigrations(
      db,
      all.filter((m) => m.name < "20261118_33"),
    );
    const map = db.query("SELECT id FROM maps LIMIT 1").get() as { id: string };
    db.run(
      "INSERT INTO accounts (id, username, password_hash, created_at, updated_at) VALUES ('a1', 'old', 'x', 'now', 'now')",
    );
    const insert = (id: string, name: string, cls: number, str: number, dex: number) =>
      db.run(
        `INSERT INTO characters (id, account_id, name, sex, head, class_code, level, hp, hp_max, sp,
          sp_max, exp, exp_needed, str, sta, agi, dex, int, wis, spd, aim, gold, profile,
          hunger, break_count, map_id, x, y, facing, created_at, updated_at)
         VALUES (?, 'a1', ?, 1, 1, ?, 1, 20, 20, 20, 20, 0, 30, ?, 10, 1, ?, 10, 10, 1, 1, 0, '',
          40000, 0, ?, 5, 5, 'S', 'now', 'now')`,
        [id, name, cls, str, dex, map.id],
      );
    insert("c1", "Ann", 11, 10, 13); // Druid: +3 Dex, Int, Wis
    insert("c2", "Bob", 20, 11, 10); // Barbarian: +1 Str
    insert("c3", "Cat", 4, 10, 10); // Grunt: none
    runMigrations(db, all);
    const rows = db
      .query("SELECT name, str, dex, int, wis FROM characters ORDER BY name")
      .all() as { name: string; str: number; dex: number; int: number; wis: number }[];
    expect(rows).toEqual([
      { name: "Ann", str: 10, dex: 10, int: 7, wis: 7 },
      { name: "Bob", str: 10, dex: 10, int: 10, wis: 10 },
      { name: "Cat", str: 10, dex: 10, int: 10, wis: 10 },
    ]);
  });
});
