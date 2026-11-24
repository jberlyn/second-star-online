import { describe, expect, test } from "bun:test";

import { openDatabase } from "../src/persistence/database.ts";
import { loadMigrations, runMigrations } from "../src/persistence/migrations.ts";
import { splitSqlStatements } from "../src/persistence/sql-split.ts";

describe("splitSqlStatements", () => {
  test("splits on semicolons and drops blank and comment-only parts", () => {
    expect(splitSqlStatements("SELECT 1; SELECT 2;\n\n-- tail\n")).toEqual([
      "SELECT 1",
      "SELECT 2",
    ]);
    expect(splitSqlStatements(";;  ;")).toEqual([]);
    expect(splitSqlStatements("SELECT 1")).toEqual(["SELECT 1"]);
  });

  test("a ; inside a string, quoted name, JSON text or comment does not split", () => {
    const sql = [
      "INSERT INTO t VALUES ('a;b', 'it''s; fine')",
      'SELECT "odd;name", `also;odd`, [and;this] FROM x',
      `UPDATE t SET doc = '{"a":";","b":[1,2]}'`,
      "SELECT 1 -- a comment; still a comment\n + 1",
      "SELECT /* block; comment */ 2",
    ];
    expect(splitSqlStatements(`${sql.join(";\n")};`)).toEqual(sql);
  });

  test("a trigger body runs to its own END, past CASE … END and inner statements", () => {
    const trig = `CREATE TEMP TRIGGER tg AFTER INSERT ON t BEGIN
  UPDATE t SET a = CASE WHEN new.a > 0 THEN 1 ELSE 2 END WHERE rowid = new.rowid;
  INSERT INTO log VALUES ('x;y');
END`;
    expect(splitSqlStatements(`SELECT 0; ${trig}; SELECT 3;`)).toEqual([
      "SELECT 0",
      trig,
      "SELECT 3",
    ]);
    expect(
      splitSqlStatements("CREATE TRIGGER t2 AFTER DELETE ON t BEGIN DELETE FROM u; END;"),
    ).toHaveLength(1);
    // Not a trigger: the word only appears later, or as part of a name.
    expect(splitSqlStatements("CREATE TABLE trigger_log (a); SELECT 1;")).toHaveLength(2);
  });

  test("an unterminated quote or trigger body is an error, not a silent split", () => {
    expect(() => splitSqlStatements("SELECT 'oops; SELECT 2;")).toThrow(/unterminated/);
    expect(() => splitSqlStatements("CREATE TRIGGER t AFTER INSERT ON x BEGIN SELECT 1;")).toThrow(
      /END/,
    );
  });

  test("every shipped migration splits into statements", () => {
    for (const m of loadMigrations()) {
      const parts = splitSqlStatements(m.sql);
      expect(parts.length).toBeGreaterThan(0);
      for (const p of parts) {
        expect(p.endsWith(";")).toBe(false);
      }
    }
  });
});

describe("runMigrations runs each statement on its own", () => {
  test("a failing statement in the middle aborts the migration and rolls it back", () => {
    const db = openDatabase(":memory:");
    runMigrations(db, [
      { name: "20990101_01_base.sql", sql: "CREATE TABLE t (a INTEGER NOT NULL);" },
    ]);
    const bad = {
      name: "20990101_02_bad.sql",
      // The NULL insert fails at run time; bun:sqlite's multi-statement run used to skip it and
      // carry on to the third statement.
      sql: "INSERT INTO t VALUES (1);\nINSERT INTO t VALUES (NULL);\nINSERT INTO t VALUES (3);\n",
    };
    expect(() => runMigrations(db, [bad])).toThrow(
      /20990101_02_bad\.sql: statement 2 failed: NOT NULL/,
    );
    expect(db.query("SELECT a FROM t").all()).toEqual([]);
    expect(db.query("SELECT name FROM _migrations WHERE name = ?").all(bad.name)).toEqual([]);
  });

  test("a run-time error in a SELECT in the middle is no longer skipped", () => {
    const db = openDatabase(":memory:");
    const m = {
      name: "20990101_01_overflow.sql",
      sql: "CREATE TABLE t (a);\nSELECT abs(-9223372036854775808);\nINSERT INTO t VALUES (1);",
    };
    expect(() => runMigrations(db, [m])).toThrow(/statement 2 failed: integer overflow/);
    expect(db.query("SELECT name FROM sqlite_master WHERE name = 't'").all()).toEqual([]);
  });
});
