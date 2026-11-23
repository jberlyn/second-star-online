import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { classicData } from "@secondstaronline/data/classic";
import { RELEASE_PACK_DIRS } from "@secondstaronline/data/packs";
import { startingCharacter } from "@secondstaronline/shared";

import { readPackBlob } from "../src/content/packs.ts";
import { rowHash } from "../src/content/rows.ts";
import { ContentService } from "../src/content/service.ts";
import { insertCharacter as insertCurrent } from "../src/persistence/characters.ts";
import { type Db, openDatabase } from "../src/persistence/database.ts";
import {
  appliedMigrations,
  loadMigrations,
  MIGRATIONS_DIR,
  migrate,
  runMigrations,
} from "../src/persistence/migrations.ts";

/**
 * `insertCharacter` writes today's columns. On a schema from before drop_unused_stats, Agility,
 * Speed and Aim are first given a default of 1 (what 1.6 always saved), so the insert fits; on one
 * from before skills_by_key, the skills are written by position.
 */
function insertCharacter(db: Db, input: Parameters<typeof insertCurrent>[1]): string {
  const cols = db.query("PRAGMA table_info(characters)").all() as {
    name: string;
    dflt_value: string | null;
  }[];
  for (const c of cols) {
    if (["agi", "spd", "aim"].includes(c.name) && c.dflt_value === null) {
      db.run(`ALTER TABLE characters DROP COLUMN ${c.name}`);
      db.run(`ALTER TABLE characters ADD COLUMN ${c.name} INTEGER NOT NULL DEFAULT 1`);
    }
  }
  // Before skills_by_key, a character's skills were rows by position (1 = Slash).
  const bySkillNumber =
    (
      db.query("PRAGMA table_info(character_skills)").all() as { name: string; type: string }[]
    ).find((c) => c.name === "skill")?.type === "INTEGER";
  if (!bySkillNumber) {
    return insertCurrent(db, input);
  }
  const id = insertCurrent(db, { ...input, start: { ...input.start, skills: [] } });
  input.start.skills.forEach((v, i) => {
    db.run("INSERT INTO character_skills (character_id, skill, value) VALUES (?, ?, ?)", [
      id,
      i + 1,
      v,
    ]);
  });
  return id;
}

/** Classic's 38 skills in their saved order, and the Skills page name 1.6 gave each. */
const classicSkillNames = classicData.classes.skills.map((s) => s.skill);
const panelName = (skill: string) =>
  classicData.classes.skills.find((s) => s.skill === skill)?.display ?? skill;

/** The settings migration 59 (bindings_and_jail) seeds on every server, left out where a test is about others. */
const SEEDED = "'jailPoint', 'bellMap'";

/** The Classic pack's manifest, as a pack blob stores one. */
const classicManifest = () =>
  JSON.parse(
    readFileSync(
      join(MIGRATIONS_DIR, "..", "..", "data", "packs", "classic", "manifest.json"),
      "utf8",
    ),
  );

describe("migrations (real SQL on in-memory SQLite)", () => {
  test("applies the shipped migrations once", () => {
    const db = openDatabase();
    const first = migrate(db);
    expect(first.applied).toContain("20261104_01_accounts.sql");
    const second = migrate(db);
    expect(second.applied).toEqual([]);
    expect(second.skipped).toEqual(first.applied);
  });

  test("renames an operator-placed Workbench without moving it", () => {
    const db = openDatabase();
    const migrations = loadMigrations().filter((m) => !m.name.endsWith("_carpentry_bench.sql"));
    runMigrations(db, migrations);
    db.run(`
      INSERT INTO ground_items (id, map_id, x, y, item, kind, created_at)
      SELECT 'bench', id, 5, 6, 'workbench', 'admin', '2026-11-21'
      FROM maps WHERE mx = 1000 AND my = 992 AND slot = 0
    `);
    migrate(db);
    expect(db.query("SELECT item, x, y, kind FROM ground_items WHERE id = 'bench'").get()).toEqual({
      item: "Carpentry Bench",
      x: 5,
      y: 6,
      kind: "admin",
    });
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
      loadMigrations(MIGRATIONS_DIR).filter(
        (m) => !m.name.startsWith("20261112_26") && m.name < "20261123_58",
      ),
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
    runMigrations(
      db,
      loadMigrations(MIGRATIONS_DIR).filter((m) => m.name < "20261123_58"),
    );
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
  test("fallback_point renames the Respawn point setting and gives characters without a respawn point its tile", () => {
    for (const override of [null, { map: "x0y0", x: 3, y: 2 }, { map: "x9y9", x: 1, y: 1 }]) {
      const db = openDatabase();
      const all = loadMigrations(MIGRATIONS_DIR);
      runMigrations(
        db,
        all.filter((m) => m.name < "20261118_35"),
      );
      const seed = db.query("SELECT id FROM maps WHERE mx = 1000 AND my = 992").get() as {
        id: string;
      };
      const jail = db.query("SELECT id FROM maps WHERE mx = 0 AND my = 0").get() as { id: string };
      if (override) {
        db.run("INSERT INTO settings (key, value, updated_at) VALUES ('respawnPoint', ?, 'now')", [
          JSON.stringify(override),
        ]);
      }
      db.run(
        "INSERT INTO accounts (id, username, password_hash, created_at, updated_at) VALUES ('a1', 'old', 'x', 'now', 'now')",
      );
      const make = (name: string) =>
        insertCharacter(db, {
          accountId: "a1",
          start: startingCharacter({
            name,
            sex: 1,
            head: 1,
            classCode: 1,
            str: 1,
            sta: 1,
            int: 1,
            wis: 1,
            dex: 1,
          }),
          position: { mapId: seed.id, x: 6, y: 4, facing: "S" },
          now: "now",
        });
      const none = make("none");
      const own = make("own");
      db.run(
        "UPDATE characters SET respawn_map_id = NULL, respawn_x = NULL, respawn_y = NULL WHERE id = ?",
        [none],
      );
      db.run("UPDATE characters SET respawn_x = 2, respawn_y = 3 WHERE id = ?", [own]);
      runMigrations(db, all);
      const point = (id: string) =>
        db
          .query("SELECT respawn_map_id, respawn_x, respawn_y FROM characters WHERE id = ?")
          .get(id);
      // A point already saved is kept.
      expect(point(own)).toEqual({ respawn_map_id: seed.id, respawn_x: 2, respawn_y: 3 });
      if (override === null) {
        expect(point(none)).toEqual({ respawn_map_id: seed.id, respawn_x: 5, respawn_y: 5 });
      } else if (override.map === "x0y0") {
        expect(point(none)).toEqual({ respawn_map_id: jail.id, respawn_x: 3, respawn_y: 2 });
      } else {
        // The setting names a missing map: no point, and the fallback point covers it.
        expect(point(none)).toEqual({ respawn_map_id: null, respawn_x: null, respawn_y: null });
      }
      expect(db.query(`SELECT key FROM settings WHERE key NOT IN (${SEEDED})`).all()).toEqual(
        override ? [{ key: "fallbackPoint" }] : [],
      );
    }
  });

  test("duration_settings moves duration overrides to their new keys, in whole seconds", () => {
    const db = openDatabase();
    const all = loadMigrations(MIGRATIONS_DIR);
    runMigrations(
      db,
      all.filter((m) => m.name < "20261119_37"),
    );
    const old: Record<string, string> = {
      saveIntervalTicks: "1200",
      broadcastCooldownFrames: "0",
      chatCooldownFrames: "5",
      resumeGraceMs: "1500",
      npcChatterSeconds: "45",
      lootDecayMinutes: "60",
      jailMinutes: "40",
      banMinutes: "0",
      ipBanMinutes: "1440",
      addressHistoryDays: "7",
      chatLogRetentionDays: '"lots"',
      startPoint: JSON.stringify({ map: "x1y1", x: 2, y: 3 }),
    };
    for (const [key, value] of Object.entries(old)) {
      db.run("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, 'then')", [key, value]);
    }
    runMigrations(
      db,
      all.filter((m) => m.name < "20261119_38"),
    );
    const rows = db.query("SELECT key, value, updated_at FROM settings ORDER BY key").all() as {
      key: string;
      value: string;
      updated_at: string;
    }[];
    expect(Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]))).toEqual({
      saveInterval: 60,
      broadcastCooldown: 0,
      // 5 frames is a quarter second: a wait that was on stays on.
      chatCooldown: 1,
      resumeGrace: 2,
      npcChatter: 45,
      lootDecay: 3600,
      jailSentence: 2400,
      banLength: 0,
      ipBanLength: 86_400,
      addressHistory: 604_800,
      // A value that was not a number is dropped, as the loader ignored it.
      startPoint: { map: "x1y1", x: 2, y: 3 },
    });
    expect(rows.every((r) => r.updated_at === "then")).toBe(true);
  });

  test("infrastructure_config drops the settings that moved to SSO_* variables", () => {
    const db = openDatabase();
    const all = loadMigrations(MIGRATIONS_DIR);
    runMigrations(
      db,
      all.filter((m) => m.name < "20261119_38"),
    );
    for (const [key, value] of [
      ["saveInterval", "60"],
      ["resumeGrace", "2"],
      ["socketsPerIp", "4"],
      ["chatCooldown", "5"],
    ] as const) {
      db.run("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, 'then')", [key, value]);
    }
    runMigrations(db, all);
    expect(db.query(`SELECT key, value FROM settings WHERE key NOT IN (${SEEDED})`).all()).toEqual([
      { key: "chatCooldown", value: "5" },
    ]);
  });

  test("divergence: restore_death_penalty raises max HP and SP to 19 + level, never lowering them", () => {
    const db = openDatabase();
    const all = loadMigrations(MIGRATIONS_DIR);
    runMigrations(
      db,
      all.filter((m) => m.name < "20261119_39"),
    );
    const seed = db.query("SELECT id FROM maps WHERE mx = 1000 AND my = 992").get() as {
      id: string;
    };
    db.run(
      "INSERT INTO accounts (id, username, password_hash, created_at, updated_at) VALUES ('a1', 'old', 'x', 'now', 'now')",
    );
    const make = (name: string, level: number, hpMax: number, spMax: number) => {
      const id = insertCharacter(db, {
        accountId: "a1",
        start: startingCharacter({
          name,
          sex: 1,
          head: 1,
          classCode: 1,
          str: 1,
          sta: 1,
          int: 1,
          wis: 1,
          dex: 1,
        }),
        position: { mapId: seed.id, x: 6, y: 4, facing: "S" },
        now: "now",
      });
      db.run("UPDATE characters SET level = ?, hp_max = ?, sp_max = ? WHERE id = ?", [
        level,
        hpMax,
        spMax,
        id,
      ]);
      return id;
    };
    // Weakened twice at level 31; untouched at level 5; above the line (a promotion's SP).
    const weak = make("weak", 31, 48, 48);
    const fine = make("fine", 5, 24, 24);
    const high = make("high", 2, 21, 90);
    runMigrations(db, all);
    const max = (id: string) =>
      db.query("SELECT hp_max, sp_max FROM characters WHERE id = ?").get(id);
    expect(max(weak)).toEqual({ hp_max: 50, sp_max: 50 });
    expect(max(fine)).toEqual({ hp_max: 24, sp_max: 24 });
    expect(max(high)).toEqual({ hp_max: 21, sp_max: 90 });
  });

  test("divergence: death_drop_settings turns Drops on death off where drops were off", () => {
    for (const [old, after] of [
      ["false", [{ key: "deathDrops", value: '"off"' }]],
      ["true", []],
      [null, []],
    ] as const) {
      const db = openDatabase();
      const all = loadMigrations(MIGRATIONS_DIR);
      runMigrations(
        db,
        all.filter((m) => m.name < "20261119_40"),
      );
      if (old !== null) {
        db.run("INSERT INTO settings (key, value, updated_at) VALUES ('dropOnDeath', ?, 'then')", [
          old,
        ]);
      }
      runMigrations(db, all);
      expect(
        db.query(`SELECT key, value FROM settings WHERE key NOT IN (${SEEDED})`).all(),
      ).toEqual([...after]);
    }
  });

  test("bug fixed: singular_crystals renames saved crystals, merges their stacks and is safe to run again on the world", () => {
    const db = openDatabase();
    const all = loadMigrations(MIGRATIONS_DIR);
    const mig = all.find((m) => m.name.endsWith("_singular_crystals.sql"));
    const icon = { member: 514, castLib: 9, asset: "bitmaps/319437_Blue_Crystals.png" };
    expect(mig).toBeDefined();
    runMigrations(
      db,
      all.filter((m) => m !== mig),
    );
    const seed = db.query("SELECT id FROM maps WHERE mx = 1000 AND my = 992").get() as {
      id: string;
    };
    db.run(
      "INSERT INTO accounts (id, username, password_hash, created_at, updated_at) VALUES ('a1', 'old', 'x', 'now', 'now')",
    );
    const id = insertCharacter(db, {
      accountId: "a1",
      start: startingCharacter({
        name: "Miner",
        sex: 1,
        head: 1,
        classCode: 1,
        str: 1,
        sta: 1,
        int: 1,
        wis: 1,
        dex: 1,
      }),
      position: { mapId: seed.id, x: 6, y: 4, facing: "S" },
      now: "now",
    });
    db.run("DELETE FROM inventory WHERE character_id = ?", [id]);
    const line = (slot: number, item: string, qty: number) =>
      db.run("INSERT INTO inventory (id, character_id, slot, item, qty) VALUES (?, ?, ?, ?, ?)", [
        `i${slot}`,
        id,
        slot,
        item,
        qty,
      ]);
    // An operator's test stack of the artless singular, the bag's plural, Coched's "red crystal".
    line(1, "Blue Crystals", 50);
    line(2, "Apple", 3);
    line(3, "Blue Crystal", 100);
    line(4, "Red Crystals", 4);
    line(5, "red crystal", 2);
    line(6, "Damaged Sword, Knight's", 1);
    db.run(
      "INSERT INTO vault_items (character_id, position, item) VALUES (?, 1, 'White Crystals')",
      [id],
    );
    db.run(
      "INSERT INTO container_items (name, position, item) VALUES ('Crate#7', 1, 'green crystals')",
    );
    const ground = (gid: string, item: string) =>
      db.run(
        "INSERT INTO ground_items (id, map_id, x, y, item, kind, created_at) VALUES (?, ?, 5, 5, ?, 'drop', 'now')",
        [gid, seed.id, item],
      );
    ground("g1", "20 Blue Crystals");
    ground("g2", "996 Yellow Crystals");
    ground("g3", "Purple Crystals");
    ground("g4", "15 Gold");
    ground("g5", "Crystal Axe");
    db.run(
      "INSERT INTO npc_files (npc, text, saved_by, updated_at) VALUES ('Galor', ?, 'a1', 'now')",
      [
        "BIO|Sells Blue Crystals: the best\rSEL|Blue Crystals:7:9\rBUY|red crystal:1\rINV|5 White Crystals:10",
      ],
    );
    db.run("INSERT INTO quests (line, text) VALUES (1, 'Tela:Red Crystals:Blue Crystals')");
    db.run("INSERT INTO quests (line, text) VALUES (2, 'Edwin:scroll:Airship Deed')");
    db.run("INSERT INTO quests (line, text) VALUES (3, 'Dantan:Blue Crystals:Blue Crystals')");
    db.run(
      "INSERT INTO content_rows (dataset, part, row_key, op, data, base_data, seq, updated_by, updated_at) VALUES ('items', 'items', 'Blue Crystals', 'set', ?, ?, 1, 'a1', 'now'), ('items', 'items', 'Blue Crystal', 'remove', NULL, NULL, 2, 'a1', 'now'), ('items', 'items', 'Red Crystals', 'set', ?, NULL, 3, 'a1', 'now'), ('items', 'items', 'Red Crystal', 'set', ?, NULL, 4, 'a1', 'now'), ('npcFiles', 'files', 'Tela', 'set', ?, NULL, 5, 'a1', 'now'), ('items', 'items', 'Damaged Sword, Knight', 'set', ?, NULL, 6, 'a1', 'now'), ('items', 'items', 'Damaged Sword, Knight''s', 'set', ?, NULL, 7, 'a1', 'now')",
      [
        // The plural, renamed, with the original art and no sprite (Classic v1.0.0's row).
        JSON.stringify({
          name: "Blue Crystals",
          display: "Sky Shard",
          variants: ["Blue crystals"],
          icon,
        }),
        JSON.stringify({ name: "Blue Crystals", variants: ["Blue crystals"], icon }),
        JSON.stringify({ name: "Red Crystals", display: "Ember", icon: "added" }),
        // The artless singular, given art by the operator: the plural's change takes the key.
        JSON.stringify({ name: "Red Crystal", icon: "added" }),
        JSON.stringify({ name: "Tela", text: "SEL|Blue Crystals:7:9\rINV|5 Red Crystals:3" }),
        // Both damaged Knight swords given art: the one with the new key keeps it.
        JSON.stringify({ name: "Damaged Sword, Knight", display: "Notched Blade", icon: "added" }),
        JSON.stringify({ name: "Damaged Sword, Knight's", icon: "added" }),
      ],
    );
    // A waiting removal of Green Crystals that replaces its copies keeps its world cleanup.
    db.run(
      "INSERT INTO content_draft (dataset, part, row_key, op, data, author_account_id, author, updated_at) VALUES ('items', 'items', 'Green Crystals', 'remove', NULL, 'a1', 'A', 'now')",
    );
    db.run(
      "INSERT INTO content_draft_actions (kind, entry_key, action, author_account_id, author, updated_at) VALUES ('item', 'Green Crystals', ?, 'a1', 'A', 'now')",
      [JSON.stringify({ copies: "replace", replacement: "White Crystals" })],
    );

    runMigrations(db, all);
    const check = (content: boolean) => {
      expect(
        db
          .query("SELECT slot, item, qty FROM inventory WHERE character_id = ? ORDER BY slot")
          .all(id),
      ).toEqual([
        { slot: 1, item: "Blue Crystal", qty: 150 },
        { slot: 2, item: "Apple", qty: 3 },
        { slot: 4, item: "Red Crystal", qty: 6 },
        { slot: 6, item: "Damaged Sword, Knight", qty: 1 },
      ]);
      expect(db.query("SELECT item FROM vault_items").all()).toEqual([{ item: "White Crystal" }]);
      expect(db.query("SELECT item FROM container_items").all()).toEqual([
        { item: "Green Crystal" },
      ]);
      expect(
        db.query("SELECT id, item FROM ground_items WHERE id LIKE 'g%' ORDER BY id").all(),
      ).toEqual([
        { id: "g1", item: "20 Blue Crystal" },
        { id: "g2", item: "996 Yellow Crystal" },
        { id: "g3", item: "Purple Crystal" },
        { id: "g4", item: "15 Gold" },
        { id: "g5", item: "Crystal Axe" },
      ]);
      // Shop and drop lines are renamed (and any other mention before a colon, which only names
      // the item as it is now called).
      expect(db.query("SELECT text FROM npc_files WHERE npc = 'Galor'").get()).toEqual({
        text: "BIO|Sells Blue Crystal: the best\rSEL|Blue Crystal:7:9\rBUY|Red Crystal:1\rINV|5 White Crystal:10",
      });
      expect(db.query("SELECT text FROM quests ORDER BY line").all()).toEqual([
        { text: "Tela:Red Crystal:Blue Crystal" },
        { text: "Edwin:scroll:Airship Deed" },
        { text: "Dantan:Blue Crystal:Blue Crystal" },
      ]);
      if (!content) {
        return;
      }
      // The change to the plural follows it; the change to the artless singular goes with it.
      const rows = db
        .query<{ row_key: string; op: string; data: string; base_data: string | null }, []>(
          "SELECT row_key, op, data, base_data FROM content_rows ORDER BY seq",
        )
        .all()
        .map((r) => ({ ...r, data: JSON.parse(r.data) }));
      expect(rows).toEqual([
        {
          row_key: "Blue Crystal",
          op: "set",
          // A changed crystal takes the pack's name, spellings and picture.
          data: {
            name: "Blue Crystal",
            display: "Sky Shard",
            variants: ["Blue Crystals", "Blue crystals", "blue crystals"],
            icon,
            sprite: "Blue Crystals",
          },
          // The pack base stays as it was, so the Content page shows what the pack changed.
          base_data: JSON.stringify({ name: "Blue Crystals", variants: ["Blue crystals"], icon }),
        },
        {
          row_key: "Red Crystal",
          op: "set",
          data: {
            name: "Red Crystal",
            display: "Ember",
            icon: "added",
            variants: ["Red Crystals"],
          },
          base_data: null,
        },
        {
          row_key: "Tela",
          op: "set",
          data: { name: "Tela", text: "SEL|Blue Crystal:7:9\rINV|5 Red Crystal:3" },
          base_data: null,
        },
        {
          row_key: "Damaged Sword, Knight",
          op: "set",
          data: { name: "Damaged Sword, Knight", display: "Notched Blade", icon: "added" },
          base_data: null,
        },
      ]);
      expect(db.query("SELECT row_key, op FROM content_draft").all()).toEqual([
        { row_key: "Green Crystal", op: "remove" },
      ]);
      expect(db.query("SELECT entry_key, action FROM content_draft_actions").all()).toEqual([
        {
          entry_key: "Green Crystal",
          action: JSON.stringify({ copies: "replace", replacement: "White Crystal" }),
        },
      ]);
    };
    check(true);
    // Running it again changes nothing in the world (the runner applies it once, so the operator's
    // content rows are only rewritten the one time).
    db.run((mig as { sql: string }).sql);
    check(false);
  });

  test("divergence: drop_unused_stats keeps every character and drops Agility, Speed and Aim, class points too", () => {
    const db = openDatabase();
    const all = loadMigrations(MIGRATIONS_DIR);
    runMigrations(
      db,
      all.filter((m) => m.name < "20261122_57"),
    );
    const map = db.query("SELECT id FROM maps LIMIT 1").get() as { id: string };
    db.run(
      "INSERT INTO accounts (id, username, password_hash, created_at, updated_at) VALUES ('a1', 'old', 'x', 'now', 'now')",
    );
    db.run(
      `INSERT INTO characters (id, account_id, name, sex, head, class_code, level, hp, hp_max, sp,
        sp_max, exp, exp_needed, str, sta, agi, dex, int, wis, spd, aim, gold, profile,
        hunger, break_count, map_id, x, y, facing, created_at, updated_at)
       VALUES ('c1', 'a1', 'Ann', 1, 1, 1, 1, 20, 20, 20, 20, 0, 30, 12, 11, 3, 10, 9, 8, 5, 1, 0, '',
        40000, 0, ?, 5, 5, 'S', 'now', 'now')`,
      [map.id],
    );
    // A class change, a draft and an imported pack that gave Speed or Agility points.
    const cls = JSON.stringify({ code: 50, statBonus: { spd: 2, agi: 1, wis: 1 } });
    db.run(
      `INSERT INTO content_rows (dataset, part, row_key, op, data, base_hash, base_data, seq,
        updated_by, updated_at) VALUES ('classes', 'classes', '50', 'set', ?, NULL, NULL, 1, 'op', 'now')`,
      [cls],
    );
    db.run(
      `INSERT INTO content_draft (dataset, part, row_key, op, data, author_account_id, author,
        updated_at) VALUES ('classes', 'classes', '50', 'set', ?, 'a1', 'op', 'now')`,
      [cls],
    );
    db.run(
      `INSERT INTO content_packs (id, name, version, position, source, data, installed_at)
       VALUES ('extra', 'Extra', '1', 1, 'imported', ?, 'now')`,
      [
        JSON.stringify({
          manifest: { id: "extra" },
          data: { classes: { classes: [JSON.parse(cls)] } },
        }),
      ],
    );
    runMigrations(db, all);
    expect(db.query("SELECT str, sta, dex, int, wis FROM characters").all()).toEqual([
      { str: 12, sta: 11, dex: 10, int: 9, wis: 8 },
    ]);
    const bonus = (sql: string) =>
      JSON.parse((db.query(sql).get() as { b: string }).b) as Record<string, number>;
    expect(bonus("SELECT json_extract(data, '$.statBonus') AS b FROM content_rows")).toEqual({
      wis: 1,
    });
    expect(bonus("SELECT json_extract(data, '$.statBonus') AS b FROM content_draft")).toEqual({
      wis: 1,
    });
    expect(
      bonus(
        "SELECT json_extract(data, '$.data.classes.classes[0].statBonus') AS b FROM content_packs WHERE id = 'extra'",
      ),
    ).toEqual({ wis: 1 });
    const cols = (db.query("PRAGMA table_info(characters)").all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(cols.filter((c) => ["agi", "spd", "aim"].includes(c))).toEqual([]);
  });

  test("skills_by_key saves skills, edit logs and the content's classes by skill key", () => {
    const db = openDatabase();
    runMigrations(
      db,
      loadMigrations(MIGRATIONS_DIR).filter((m) => m.name < "20261123_58"),
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
    // An operator skill the server recorded at 39, and a row no record names.
    db.run("INSERT INTO content_skills (skill, idx) VALUES ('Swimming', 39)");
    // A live skill only an imported pack supplies (no Classic or operator row).
    db.run("INSERT INTO content_skills (skill, idx) VALUES ('Gliding', 42)");
    db.run(
      "INSERT INTO character_skills (character_id, skill, value) VALUES (?, 39, 7), (?, 40, 8)",
      [id, id],
    );
    const before = Array.from({ length: 38 }, (_, i) => i + 1);
    const after = before.map((v, i) => (i === 7 ? 50 : v));
    db.run(
      "INSERT INTO character_edits (id, created_at, actor_account_id, actor_name, character_id, character, reason, changes) VALUES ('e1', 'now', 'a1', 'God', ?, 'old', 'test', ?)",
      [
        id,
        JSON.stringify([
          { field: "gold", before: 1, after: 2 },
          { field: "skills", before, after },
        ]),
      ],
    );
    // The operator's layer: a changed Classic skill, a changed page list, changed starting skills.
    const classicSkill = { index: 4, skill: "HeavyArms" };
    const creation = {
      classes: { "1": "Knight", "2": "Mage", "3": "Ranger" },
      startingSkills: {
        "1": { values: [25, 20], valuesWritten: 47, nonDefault: { Slash: 25, Thrust: 20 } },
        // Out of a skill's 0 to 100, which the old rows allowed.
        "2": { values: [0, 150, 1, 1, 1, 1, 1, 30], valuesWritten: 49, nonDefault: {} },
        "3": { values: [10], valuesWritten: 49, nonDefault: { Slash: 10 } },
      },
      skillsWritten: "",
      statBudget: { rule: "" },
    };
    const base = {
      ...creation,
      classes: { "1": "Fighter", "2": "Mage", "3": "Ranger" },
      startingSkills: {
        ...creation.startingSkills,
        "1": { values: [20, 20], valuesWritten: 47, nonDefault: { Slash: 20, Thrust: 20 } },
        "2": { values: [1, 1, 1, 1, 1, 1, 1, 30], valuesWritten: 49, nonDefault: { Magery: 30 } },
      },
    };
    const row = db.prepare(
      "INSERT INTO content_rows (dataset, part, row_key, op, data, base_hash, base_data, seq, updated_by, updated_at) VALUES ('classes', ?, ?, 'set', ?, 'h', ?, ?, 'God', 'now')",
    );
    row.run("skills", "HeavyArms", JSON.stringify(classicSkill), JSON.stringify(classicSkill), 1);
    row.run("skills", "Meditation", JSON.stringify({ index: 12, skill: "Meditation" }), null, 2);
    // The page as Classic had it (35 rows), with Slash renamed and Thrust left out.
    const classicPanel = classicSkillNames.flatMap((skill, i) =>
      ["Meditation", "TerrainNavigating", "ItemIdentification"].includes(skill)
        ? []
        : [{ name: panelName(skill), index: i + 1 }],
    );
    const panel = classicPanel
      .filter((r) => r.index !== 2)
      .map((r) => (r.index === 1 ? { ...r, name: "Slashing" } : r));
    row.run("skillPanel", "", JSON.stringify(panel), null, 3);
    // A draft page that shows Meditation again, under another name.
    db.run(
      "INSERT INTO content_draft (dataset, part, row_key, op, data, author_account_id, author, updated_at) VALUES ('classes', 'skillPanel', '', 'set', ?, 'a1', 'God', 'now')",
      [
        JSON.stringify([
          // Leaves out Shoveling (37) and Farming (38): one the operator removed, one the draft
          // removes.
          ...classicPanel.filter((r) => r.index < 37),
          { name: "Calm", index: 12 },
        ]),
      ],
    );
    db.run(
      "INSERT INTO content_rows (dataset, part, row_key, op, data, base_hash, base_data, seq, updated_by, updated_at) VALUES ('classes', 'skills', 'Shoveling', 'remove', NULL, 'h', NULL, 9, 'God', 'now')",
    );
    db.run(
      "INSERT INTO content_draft (dataset, part, row_key, op, data, author_account_id, author, updated_at) VALUES ('classes', 'skills', 'Farming', 'remove', NULL, 'a1', 'God', 'now')",
    );
    row.run("creation", "", JSON.stringify(creation), JSON.stringify(base), 4);
    db.run(
      "INSERT INTO content_draft (dataset, part, row_key, op, data, author_account_id, author, updated_at) VALUES ('classes', 'skills', 'Swimming', 'set', ?, 'a1', 'God', 'now')",
      [JSON.stringify({ index: 39, skill: "Swimming" })],
    );
    // A drafted Classic skill row in the old shape, a skill only the draft adds, and drafted
    // starting values that name it, with an empty label.
    const draftRow = db.prepare(
      "INSERT INTO content_draft (dataset, part, row_key, op, data, author_account_id, author, updated_at) VALUES ('classes', ?, ?, 'set', ?, 'a1', 'God', 'now')",
    );
    draftRow.run("skills", "HeavyArms", JSON.stringify({ index: 4, skill: "HeavyArms" }));
    draftRow.run("skills", "Climbing", JSON.stringify({ index: 41, skill: "Climbing" }));
    const draftValues = Array.from({ length: 41 }, (_, i) => (i === 40 ? 6 : i < 2 ? 20 : 1));
    draftRow.run(
      "creation",
      "",
      JSON.stringify({
        ...creation,
        classes: { "1": "", "2": "Mage", "3": "Ranger" },
        startingSkills: {
          ...creation.startingSkills,
          "1": { ...creation.startingSkills["1"], values: draftValues },
        },
      }),
    );
    // An imported pack's classes in the old shape.
    const pack = {
      manifest: { id: "extra" },
      data: {
        classes: {
          skills: [
            { index: 1, skill: "Slash" },
            { index: 2, skill: "Tinkering" },
            { index: 3, skill: "Secret" },
            { index: 4, skill: "Gliding" },
          ],
          skillPanel: [
            { name: "Slash", index: 1 },
            { name: "Tinker", index: 2 },
            // A second row for one skill (the old schema allowed it): the first wins.
            { name: "Tinkerer", index: 2 },
          ],
          creation: {
            classes: { "1": "A", "2": "B", "3": "C" },
            startingSkills: {
              "1": { values: [5, 1, 2], valuesWritten: 3, nonDefault: {} },
              "2": { values: [1], valuesWritten: 1, nonDefault: {} },
              "3": { values: [1, 9], valuesWritten: 2, nonDefault: {} },
            },
            skillsWritten: "",
          },
        },
      },
    };
    db.run(
      "INSERT INTO content_packs (id, name, version, position, source, data, installed_at) VALUES ('extra', 'Extra', '1.0.0', 1, 'imported', ?, 'now')",
      [JSON.stringify(pack)],
    );

    runMigrations(db, loadMigrations(MIGRATIONS_DIR));

    const skills = Object.fromEntries(
      (
        db.query("SELECT skill, value FROM character_skills WHERE character_id = ?").all(id) as {
          skill: string;
          value: number;
        }[]
      ).map((r) => [r.skill, r.value]),
    );
    expect(Object.keys(skills)).toHaveLength(40);
    expect([skills.Slash, skills.Thrust, skills.Magery, skills.fire, skills.Farming]).toEqual([
      2, 4, 16, 42, 76,
    ]);
    expect([skills.Swimming, skills["#40"]]).toEqual([7, 8]);
    expect(
      db.query("SELECT name FROM sqlite_master WHERE name = 'content_skills'").get(),
    ).toBeNull();
    expect(() =>
      db.run("INSERT INTO character_skills (character_id, skill, value) VALUES (?, '', 1)", [id]),
    ).toThrow();

    const changes = JSON.parse(
      (db.query("SELECT changes FROM character_edits WHERE id = 'e1'").get() as { changes: string })
        .changes,
    );
    expect(changes[0]).toEqual({ field: "gold", before: 1, after: 2 });
    // Only the skill the edit moved.
    expect(changes[1]).toEqual({ field: "skills", before: { Magery: 8 }, after: { Magery: 50 } });

    const rows = new Map(
      (
        db
          .query("SELECT part, row_key, data FROM content_rows WHERE dataset = 'classes'")
          .all() as { part: string; row_key: string; data: string }[]
      ).map((r) => [`${r.part}/${r.row_key}`, JSON.parse(r.data)]),
    );
    expect(rows.get("skills/HeavyArms")).toEqual({ skill: "HeavyArms", display: "Heavy Arms" });
    expect(rows.get("skills/Meditation")).toEqual({ skill: "Meditation", hidden: true });
    // The operator's page: Slash renamed, Thrust hidden; nothing else changed.
    expect(rows.get("skills/Slash")).toEqual({ skill: "Slash", display: "Slashing" });
    expect(rows.get("skills/Thrust")).toEqual({ skill: "Thrust", hidden: true });
    expect([...rows.keys()].filter((k) => k.startsWith("skills/")).sort()).toEqual([
      "skills/Gliding",
      "skills/HeavyArms",
      "skills/Meditation",
      "skills/Shoveling",
      "skills/Slash",
      "skills/Thrust",
    ]);
    expect(rows.get("skills/Shoveling")).toBeNull();
    // The operator's page did not show the pack's Gliding.
    expect(rows.get("skills/Gliding")).toEqual({ skill: "Gliding", hidden: true });
    expect(rows.has("skillPanel/")).toBe(false);
    // The draft's page: Meditation shown as Calm, over the published rows.
    const drafted = new Map(
      (
        db
          .query("SELECT part, row_key, data FROM content_draft WHERE dataset = 'classes'")
          .all() as { part: string; row_key: string; data: string }[]
      ).map((r) => [`${r.part}/${r.row_key}`, JSON.parse(r.data)]),
    );
    expect(drafted.get("skills/Meditation")).toEqual({ skill: "Meditation", display: "Calm" });
    // Shown again by the draft's page, as Classic shows it.
    expect(drafted.get("skills/Slash")).toEqual({ skill: "Slash" });
    expect(drafted.get("skills/Thrust")).toEqual({ skill: "Thrust" });
    expect(drafted.has("skillPanel/")).toBe(false);
    // Removed skills stay removed: the draft's page does not bring them back as hidden.
    expect(
      db
        .query("SELECT row_key, op FROM content_draft WHERE row_key IN ('Farming', 'Shoveling')")
        .all(),
    ).toEqual([{ row_key: "Farming", op: "remove" }]);
    // The drafted HeavyArms row keeps the name it shows by.
    expect(drafted.get("skills/HeavyArms")).toEqual({ skill: "HeavyArms", display: "Heavy Arms" });
    // The drafted Fighter: no label (it was empty), and the draft-only skill kept by key.
    expect(drafted.get("startClasses/1")).toEqual({
      code: 1,
      skills: { Slash: 20, Thrust: 20, Climbing: 6 },
    });
    expect(drafted.get("creation/")).toEqual({ statBudget: { rule: "" } });
    expect(rows.get("creation/")).toEqual({ statBudget: { rule: "" } });
    // Only Fighter changed: it becomes a start class row with its label and values by key.
    expect(rows.get("startClasses/1")).toEqual({
      code: 1,
      label: "Knight",
      skills: { Slash: 25, Thrust: 20 },
    });
    // Mage's values, kept within 0 to 100.
    expect(rows.get("startClasses/2")).toEqual({
      code: 2,
      label: "Mage",
      skills: { Slash: 0, Thrust: 100, Magery: 30 },
    });
    expect(rows.has("startClasses/3")).toBe(false);
    expect(
      JSON.parse(
        (
          db.query("SELECT data FROM content_draft WHERE row_key = 'Swimming'").get() as {
            data: string;
          }
        ).data,
      ),
      // Drafted, but not on the drafted page, so not shown: hidden.
    ).toEqual({ skill: "Swimming", hidden: true });

    const migrated = JSON.parse(
      (db.query("SELECT data FROM content_packs WHERE id = 'extra'").get() as { data: string })
        .data,
    );
    expect(migrated.data.classes.skillPanel).toBeUndefined();
    expect(migrated.data.classes.creation).toEqual({});
    expect(migrated.data.classes.skills).toEqual([
      { skill: "Slash" },
      { skill: "Tinkering", display: "Tinker" },
      { skill: "Secret", hidden: true },
      { skill: "Gliding", hidden: true },
    ]);
    expect(migrated.data.classes.startClasses).toEqual([
      { code: 1, label: "A", skills: { Slash: 5, Secret: 2 } },
      { code: 3, label: "C", skills: { Tinkering: 9 } },
      { code: 2, label: "B", skills: {} },
    ]);
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  test("bindings_and_jail keeps the jail and the bell where 1.6 had them, and fills older packs' bindings", () => {
    const db = openDatabase();
    const all = loadMigrations(MIGRATIONS_DIR);
    runMigrations(
      db,
      all.filter((m) => m.name < "20261123_59"),
    );
    // An imported pack made before stage 2 binds only skills; another already binds its own start.
    const pack = (id: string, bindings: unknown) =>
      db.run(
        "INSERT INTO content_packs (id, name, version, position, source, data, installed_at) VALUES (?, ?, '1.0.0', ?, 'imported', ?, 'now')",
        [id, id, id === "old" ? 1 : 2, JSON.stringify({ manifest: {}, data: { bindings } })],
      );
    pack("old", { skills: { parry: "Parry" } });
    pack("own", {
      skills: {},
      start: { hp: 9, sp: 9, bag: [] },
      currency: { item: "Shell" },
    });
    expect(db.query("SELECT key FROM settings").all()).toEqual([]);
    runMigrations(db, all);
    expect(db.query("SELECT key, value FROM settings ORDER BY key").all()).toEqual([
      { key: "bellMap", value: '"x999y999"' },
      { key: "jailPoint", value: '{"map":"x0y0","x":4,"y":4}' },
    ]);
    const bindings = (id: string) =>
      JSON.parse(
        (
          db
            .query(
              "SELECT json_extract(data, '$.data.bindings') AS b FROM content_packs WHERE id = ?",
            )
            .get(id) as { b: string }
        ).b,
      );
    const { skills: _skills, ...classic } = classicData.bindings;
    expect(bindings("old")).toEqual({ ...classic, skills: { parry: "Parry" } });
    expect(bindings("own")).toEqual({
      ...classic,
      skills: {},
      start: { hp: 9, sp: 9, bag: [] },
      currency: { item: "Shell" },
    });
  });

  test("bindings_and_jail keeps an operator's own jail and bell", () => {
    const db = openDatabase();
    const all = loadMigrations(MIGRATIONS_DIR);
    runMigrations(
      db,
      all.filter((m) => m.name < "20261123_59"),
    );
    db.run(
      "INSERT INTO settings (key, value, updated_at) VALUES ('jailPoint', '{\"map\":\"x5y5\",\"x\":2,\"y\":2}', 'then'), ('bellMap', 'null', 'then')",
    );
    runMigrations(db, all);
    expect(db.query("SELECT key, value, updated_at FROM settings ORDER BY key").all()).toEqual([
      { key: "bellMap", value: "null", updated_at: "then" },
      { key: "jailPoint", value: '{"map":"x5y5","x":2,"y":2}', updated_at: "then" },
    ]);
  });

  test("item_behaviours gives older imported packs Classic's behaviour, kill XP and Piano rows and keeps a pack's own", () => {
    const db = openDatabase();
    const all = loadMigrations(MIGRATIONS_DIR);
    runMigrations(
      db,
      all.filter((m) => m.name < "20261123_60"),
    );
    // A pack blob keeps each dataset under its file name (content/packs.ts `readPackBlob`).
    const pack = (id: string, itemRules: unknown) =>
      db.run(
        "INSERT INTO content_packs (id, name, version, position, source, data, installed_at) VALUES (?, ?, '1.0.0', ?, 'imported', ?, 'now')",
        [
          id,
          id,
          id === "old" ? 1 : 2,
          JSON.stringify({ manifest: {}, data: { "item-rules": itemRules } }),
        ],
      );
    // "old" is Classic's item rules as they were before this stage.
    // Classic's item rules before stage 3, and so before stage 5's tool sections too.
    const classic = classicData.itemRules;
    const {
      behaviours: _b,
      tools: _tools,
      ladders: _ladders,
      requires: _requires,
      ...before
    } = structuredClone(classic);
    before.gear = before.gear.filter((g) => g.power !== "killXp");
    before.use.refusals = before.use.refusals.filter((r) => r.pattern !== "Piano");
    pack("old", before);
    const own = [{ match: "exact", pattern: "Lockpick", behaviour: "key" }];
    const ownGear = [
      { slot: "ring", match: "exact", pattern: "Lucky Ring", power: "killXp", add: 2 },
    ];
    const ownUse = { refusals: [{ match: "exact", pattern: "PIANO", text: "Hush." }] };
    pack("own", { use: ownUse, gear: ownGear, behaviours: own });
    // An operator's published gear section and a drafted use section, from before the upgrade.
    const operatorGear = [
      { slot: "ring", match: "exact", pattern: "Argon's Ring", power: "attack", add: 4 },
    ];
    db.run(
      "INSERT INTO content_rows (dataset, part, row_key, op, data, seq, updated_by, updated_at) VALUES ('itemRules', 'gear', '', 'set', ?, 1, 'a', 'then')",
      [JSON.stringify(operatorGear)],
    );
    db.run(
      "INSERT INTO content_draft (dataset, part, row_key, op, data, author_account_id, author, updated_at) VALUES ('itemRules', 'use', '', 'set', ?, 'a', 'A', 'then')",
      [JSON.stringify({ refusals: [] })],
    );
    // The publish that made the gear row: undo compares the live row with its "after".
    const beforeGear = classic.gear.filter((g) => g.power !== "killXp");
    db.run(
      "INSERT INTO content_publishes (id, created_at, actor_account_id, actor_name, summary, changes, hash) VALUES ('p1', 'then', 'a', 'A', '', ?, 'h')",
      [
        JSON.stringify([
          {
            dataset: "itemRules",
            part: "gear",
            key: null,
            before: { op: "set", data: beforeGear },
            after: { op: "set", data: operatorGear },
          },
          { dataset: "casino", part: "slots", key: null, before: null, after: null },
        ]),
      ],
    );
    runMigrations(db, all);
    runMigrations(db, all);
    const rules = (id: string) =>
      JSON.parse(
        (
          db
            .query(
              "SELECT json_extract(data, '$.data.\"item-rules\"') AS r FROM content_packs WHERE id = ?",
            )
            .get(id) as { r: string }
        ).r,
      );
    expect(rules("old")).toEqual(classic);
    // Stage 5 gives every pack's item rules the tools and ladders Classic's gathering implied.
    const stage5 = { tools: classic.tools, ladders: classic.ladders, requires: [] };
    expect(rules("own")).toEqual({ use: ownUse, gear: ownGear, behaviours: own, ...stage5 });
    // The old pack loads again.
    const old = db.query("SELECT data FROM content_packs WHERE id = 'old'").get() as {
      data: string;
    };
    const blob = JSON.parse(old.data);
    const classicManifest = JSON.parse(
      readFileSync(
        join(MIGRATIONS_DIR, "..", "..", "data", "packs", "classic", "manifest.json"),
        "utf8",
      ),
    );
    blob.manifest = { ...classicManifest, id: "old", art: undefined };
    expect(readPackBlob(JSON.stringify(blob)).data.itemRules).toEqual(classic);
    const killXp = classic.gear.filter((g) => g.power === "killXp");
    const row = (table: string) =>
      JSON.parse(
        (
          db.query(`SELECT data FROM ${table} WHERE dataset = 'itemRules'`).get() as {
            data: string;
          }
        ).data,
      );
    expect(row("content_rows")).toEqual([...operatorGear, ...killXp]);
    const changes = JSON.parse(
      (
        db.query("SELECT changes FROM content_publishes WHERE id = 'p1'").get() as {
          changes: string;
        }
      ).changes,
    );
    expect(rowHash(changes[0].after.data)).toBe(rowHash(row("content_rows")));
    expect(changes[0].before.data).toEqual(classic.gear);
    expect(changes[1]).toEqual({
      dataset: "casino",
      part: "slots",
      key: null,
      before: null,
      after: null,
    });
    expect(row("content_draft")).toEqual({
      refusals: classic.use.refusals.filter((r) => r.pattern === "Piano"),
    });
  });

  test("spells_by_effect gives older spell rows the school, power and food of the spell their effect runs", () => {
    const db = openDatabase();
    const all = loadMigrations(MIGRATIONS_DIR);
    runMigrations(
      db,
      all.filter((m) => m.name < "20261123_61"),
    );
    const classic = classicData.spells;
    // Classic's spells as they were before this stage: no school, power table or food.
    const strip = (s: (typeof classic.spells)[number]) => {
      const { school: _s, power: _p, creates: _c, ...rest } = structuredClone(s);
      return rest;
    };
    const byName = (n: string) => {
      const s = classic.spells.find((x) => x.name === n);
      if (!s) {
        throw new Error(n);
      }
      return s;
    };
    // An operator's spell on Fireball's effect, with its own name and runs.
    const iceball = {
      ...strip(byName("Fireball")),
      name: "Iceball",
      fx: byName("Fireball").fx.map((f) => ({
        ...f,
        member: f.member.replace("Fireball", "Iceball"),
      })),
    };
    // A pack's own spell that already names its school keeps it, and gains only what it lacks.
    const own = {
      ...strip(byName("Splash")),
      name: "Drench",
      school: { skill: "Water", line: "Wet!" },
    };
    db.run(
      "INSERT INTO content_packs (id, name, version, position, source, data, installed_at) VALUES ('old', 'old', '1.0.0', 1, 'imported', ?, 'now')",
      [
        JSON.stringify({
          manifest: {},
          data: { spells: { spells: [...classic.spells.map(strip), own] } },
        }),
      ],
    );
    db.run(
      "INSERT INTO content_rows (dataset, part, row_key, op, data, seq, updated_by, updated_at) VALUES ('spells', 'spells', 'Iceball', 'set', ?, 1, 'a', 'then')",
      [JSON.stringify(iceball)],
    );
    db.run(
      "INSERT INTO content_draft (dataset, part, row_key, op, data, author_account_id, author, updated_at) VALUES ('spells', 'spells', 'Create Food', 'set', ?, 'a', 'A', 'then')",
      [JSON.stringify(strip(byName("Create Food")))],
    );
    db.run(
      "INSERT INTO content_publishes (id, created_at, actor_account_id, actor_name, summary, changes, hash) VALUES ('p1', 'then', 'a', 'A', '', ?, 'h')",
      [
        JSON.stringify([
          {
            dataset: "spells",
            part: "spells",
            key: "Iceball",
            before: null,
            after: { op: "set", data: iceball },
          },
        ]),
      ],
    );
    runMigrations(db, all);
    runMigrations(db, all);
    const pack = JSON.parse(
      (
        db
          .query(
            "SELECT json_extract(data, '$.data.spells') AS s FROM content_packs WHERE id = 'old'",
          )
          .get() as { s: string }
      ).s,
    );
    // Drench keeps its own school and gains Splash's power table, which it had none of.
    expect(pack).toEqual({
      spells: [...classic.spells, { ...own, power: byName("Splash").power }],
      power: classic.power,
    });
    const row = (table: string) =>
      JSON.parse(
        (db.query(`SELECT data FROM ${table} WHERE dataset = 'spells'`).get() as { data: string })
          .data,
      );
    const fire = byName("Fireball");
    expect(row("content_rows")).toEqual({ ...iceball, school: fire.school, power: fire.power });
    expect(row("content_draft")).toEqual(byName("Create Food"));
    const changes = JSON.parse(
      (
        db.query("SELECT changes FROM content_publishes WHERE id = 'p1'").get() as {
          changes: string;
        }
      ).changes,
    );
    expect(rowHash(changes[0].after.data)).toBe(rowHash(row("content_rows")));
    expect(changes[0].before).toBeNull();
  });

  test("monster_flags gives older species the flags their body gave them and keeps a row's own", () => {
    const db = openDatabase();
    const all = loadMigrations(MIGRATIONS_DIR);
    runMigrations(
      db,
      all.filter((m) => m.name < "20261123_62"),
    );
    const classic = classicData.monsters.monsters;
    const strip = (m: (typeof classic)[number]) => {
      const { flags: _f, ...rest } = structuredClone(m);
      return rest;
    };
    const ghoul = classic.find((m) => m.name === "Ghoul");
    if (!ghoul) {
      throw new Error("Ghoul");
    }
    // An operator's species drawn as a Ghoul behaved as one; a pack's own flags stay.
    const iceGhoul = { ...strip(ghoul), name: "Ice Ghoul" };
    const tame = { ...strip(ghoul), name: "Tame Ghoul", flags: { unclickable: true } };
    db.run(
      "INSERT INTO content_packs (id, name, version, position, source, data, installed_at) VALUES ('old', 'old', '1.0.0', 1, 'imported', ?, 'now')",
      [
        JSON.stringify({
          manifest: {},
          data: { monsters: { monsters: [...classic.map(strip), tame] } },
        }),
      ],
    );
    db.run(
      "INSERT INTO content_rows (dataset, part, row_key, op, data, seq, updated_by, updated_at) VALUES ('monsters', 'monsters', 'Ice Ghoul', 'set', ?, 1, 'a', 'then')",
      [JSON.stringify(iceGhoul)],
    );
    db.run(
      "INSERT INTO content_publishes (id, created_at, actor_account_id, actor_name, summary, changes, hash) VALUES ('p1', 'then', 'a', 'A', '', ?, 'h')",
      [
        JSON.stringify([
          {
            dataset: "monsters",
            part: "monsters",
            key: "Ice Ghoul",
            before: null,
            after: { op: "set", data: iceGhoul },
          },
        ]),
      ],
    );
    runMigrations(db, all);
    runMigrations(db, all);
    const pack = JSON.parse(
      (
        db
          .query(
            "SELECT json_extract(data, '$.data.monsters.monsters') AS m FROM content_packs WHERE id = 'old'",
          )
          .get() as { m: string }
      ).m,
    );
    expect(pack).toEqual([...classic, tame]);
    const row = JSON.parse(
      (
        db.query("SELECT data FROM content_rows WHERE dataset = 'monsters'").get() as {
          data: string;
        }
      ).data,
    );
    expect(row).toEqual({ ...iceGhoul, flags: ghoul.flags });
    const changes = JSON.parse(
      (
        db.query("SELECT changes FROM content_publishes WHERE id = 'p1'").get() as {
          changes: string;
        }
      ).changes,
    );
    expect(rowHash(changes[0].after.data)).toBe(rowHash(row));
  });

  test("factions_as_content saves factions, powers, map spawns and edit logs by key and reshapes older content", () => {
    const db = openDatabase();
    const all = loadMigrations(MIGRATIONS_DIR);
    runMigrations(
      db,
      all.filter((m) => m.name < "20261123_63"),
    );
    const map = db.query("SELECT id FROM maps LIMIT 1").get() as { id: string };
    db.run(
      "INSERT INTO accounts (id, username, password_hash, created_at, updated_at) VALUES ('a1', 'old', 'x', 'now', 'now')",
    );
    for (const [id, name, faction] of [
      ["c0", "Nan", 0],
      ["c1", "Ann", 1],
      ["c2", "Bob", 2],
      ["c3", "Cat", 3],
    ] as const) {
      db.run(
        `INSERT INTO characters (id, account_id, name, sex, head, class_code, level, hp, hp_max, sp,
          sp_max, exp, exp_needed, str, sta, dex, int, wis, gold, profile, hunger, break_count,
          map_id, x, y, facing, faction, faction_count, created_at, updated_at)
         VALUES (?, 'a1', ?, 1, 1, 1, 1, 20, 20, 20, 20, 0, 30, 5, 5, 5, 5, 5, 0, '', 40000, 0, ?, 5,
          5, 'S', ?, 100, 'now', 'now')`,
        [id, name, map.id, faction],
      );
    }
    db.run("DELETE FROM faction_powers");
    db.run("INSERT INTO faction_powers (id, mage, warrior, adventurer) VALUES (1, 30, 120, 4)");
    // A fresh database has three maps (the seed map, the jail and the church).
    const spawns = ["W", "a", "O"];
    const mapIds = (
      db.query("SELECT id FROM maps ORDER BY id LIMIT 3").all() as { id: string }[]
    ).map((m) => m.id);
    mapIds.forEach((id, i) => {
      db.run("UPDATE maps SET fct_spwn = ? WHERE id = ?", [spawns[i] ?? "X", id]);
    });
    db.run(
      `INSERT INTO character_edits (id, created_at, actor_account_id, actor_name, character_id,
        character, reason, changes) VALUES ('e1', 'then', 'a1', 'A', 'c1', 'Ann', 'r', ?)`,
      [
        JSON.stringify([
          { field: "faction", before: 0, after: 1 },
          { field: "hunger", before: 1, after: 2 },
        ]),
      ],
    );
    // Classic's social data as it was before this stage, in an imported pack and as an operator's
    // changed Mage row, factionRules and Bio texts.
    const classic = classicData.social;
    const oldRow = (f: (typeof classic.factions)[number], id: number) => {
      const {
        key: _k,
        member: _m,
        startPower: _s,
        bio: _b,
        perks: _p,
        ...rest
      } = structuredClone(f);
      return { id, ...rest };
    };
    const ids = { mage: 1, warrior: 2, adventurer: 3 } as Record<string, number>;
    const oldFactions = classic.factions.map((f) => oldRow(f, ids[f.key] ?? 0));
    const {
      tiers: _t,
      perkDefaults: _d,
      editorBoxes: _e,
      ...restRules
    } = structuredClone(classic.factionRules);
    const oldRules = { ...restRules, powers: { file: "f", archived: "27:123:0" } };
    const oldBios = structuredClone(classic.bios) as unknown as {
      texts: Record<string, { text: string }>;
    };
    oldBios.texts.mages = { text: "Loyal to the Mages" };
    oldBios.texts.warriors = { text: "Loyal to the Warriors" };
    oldBios.texts.adventurers = { text: "Loyal to the Adventurers" };
    db.run(
      "INSERT INTO content_packs (id, name, version, position, source, data, installed_at) VALUES ('old', 'old', '1.0.0', 1, 'imported', ?, 'now')",
      [
        JSON.stringify({
          manifest: {},
          data: { social: { factions: oldFactions, factionRules: oldRules, bios: oldBios } },
        }),
      ],
    );
    const angry = { ...oldFactions[0], leader: "Angry Angela" };
    const myBios = structuredClone(oldBios);
    myBios.texts.mages = { text: "Sworn to the Mages" };
    // A Bio line changed in the texts alone, with no change of that faction's row.
    myBios.texts.warriors = { text: "Sworn to the Warriors" };
    const put = (part: string, key: string, data: unknown) =>
      db.run(
        "INSERT INTO content_rows (dataset, part, row_key, op, data, seq, updated_by, updated_at) VALUES ('social', ?, ?, 'set', ?, 1, 'a', 'then')",
        [part, key, JSON.stringify(data)],
      );
    put("factions", "1", angry);
    put("factionRules", "", oldRules);
    put("bios", "", myBios);
    db.run(
      "INSERT INTO content_publishes (id, created_at, actor_account_id, actor_name, summary, changes, hash) VALUES ('p1', 'then', 'a', 'A', '', ?, 'h')",
      [
        JSON.stringify([
          {
            dataset: "social",
            part: "factions",
            key: "1",
            before: null,
            after: { op: "set", data: angry },
          },
        ]),
      ],
    );
    runMigrations(db, all);
    expect(db.query("SELECT name, faction FROM characters ORDER BY name").all()).toEqual([
      { name: "Ann", faction: "mage" },
      { name: "Bob", faction: "warrior" },
      { name: "Cat", faction: "adventurer" },
      { name: "Nan", faction: null },
    ]);
    expect(db.query("SELECT faction, power FROM faction_power ORDER BY faction").all()).toEqual([
      { faction: "adventurer", power: 4 },
      { faction: "mage", power: 30 },
      { faction: "warrior", power: 120 },
    ]);
    const spawned = mapIds.map(
      (id) => (db.query("SELECT fct_spwn AS f FROM maps WHERE id = ?").get(id) as { f: string }).f,
    );
    expect(spawned).toEqual(["warrior", "adventurer", ""]);
    const edit = JSON.parse(
      (db.query("SELECT changes FROM character_edits").get() as { changes: string }).changes,
    );
    expect(edit).toEqual([
      { field: "faction", before: null, after: "mage" },
      { field: "hunger", before: 1, after: 2 },
    ]);
    const social = JSON.parse(
      (
        db
          .query(
            "SELECT json_extract(data, '$.data.social') AS s FROM content_packs WHERE id = 'old'",
          )
          .get() as { s: string }
      ).s,
    );
    expect(social.factions).toEqual(classic.factions);
    expect(social.factionRules).toEqual({
      ...classic.factionRules,
    });
    expect(social.bios).toEqual(classic.bios);
    const rows = db
      .query(
        "SELECT part, row_key AS k, data FROM content_rows WHERE dataset = 'social' ORDER BY part, row_key",
      )
      .all() as { part: string; k: string; data: string }[];
    const mage = classic.factions.find((f) => f.key === "mage");
    // The operator's own Bio line for the Mages moved onto the Mage row.
    expect(rows.map((r) => [r.part, r.k]).sort()).toEqual([
      ["bios", ""],
      ["factionRules", ""],
      ["factions", "mage"],
      ["factions", "warrior"],
    ]);
    const warrior = classic.factions.find((f) => f.key === "warrior");
    const warriorRow = rows.find((r) => r.k === "warrior");
    expect(JSON.parse(warriorRow?.data ?? "")).toEqual({
      ...warrior,
      bio: "Sworn to the Warriors",
    });
    expect(JSON.parse(rows[2]?.data ?? "")).toEqual({
      ...mage,
      leader: "Angry Angela",
      bio: "Sworn to the Mages",
    });
    expect(JSON.parse(rows[1]?.data ?? "")).toEqual(classic.factionRules);
    expect(JSON.parse(rows[0]?.data ?? "")).toEqual(classic.bios);
    const changes = JSON.parse(
      (
        db.query("SELECT changes FROM content_publishes WHERE id = 'p1'").get() as {
          changes: string;
        }
      ).changes,
    );
    expect(changes[0].key).toBe("mage");
    expect(changes[0].after.data.key).toBe("mage");
    expect(changes[0].after.data.leader).toBe("Angry Angela");
    // The log's row matches the live one, so the publish can still be undone.
    expect(rowHash(changes[0].after.data)).toBe(rowHash(JSON.parse(rows[2]?.data ?? "")));
  });

  test("spells_by_effect keeps an operator's Magery binding in the base power", () => {
    const db = openDatabase();
    const all = loadMigrations(MIGRATIONS_DIR);
    runMigrations(
      db,
      all.filter((m) => m.name < "20261123_61"),
    );
    const { magery: _m, ...unbound } = classicData.bindings.skills;
    db.run(
      "INSERT INTO content_rows (dataset, part, row_key, op, data, seq, updated_by, updated_at) VALUES ('bindings', 'skills', '', 'set', ?, 1, 'a', 'then')",
      [JSON.stringify(unbound)],
    );
    runMigrations(db, all);
    runMigrations(db, all);
    const rows = db
      .query(
        "SELECT data, base_hash AS h FROM content_rows WHERE dataset = 'spells' AND part = 'power'",
      )
      .all() as { data: string; h: string }[];
    expect(rows.length).toBe(1);
    // Magery was unbound, so the base power reads no skill, as before the upgrade.
    expect(JSON.parse(rows[0]?.data ?? "")).toEqual({ ...classicData.spells.power, base: [] });
    expect(rows[0]?.h).toBe(rowHash(classicData.spells.power));
  });

  test("factions_as_content gives house templates their faction by key", () => {
    const db = openDatabase();
    const all = loadMigrations(MIGRATIONS_DIR);
    runMigrations(
      db,
      all.filter((m) => m.name < "20261123_63"),
    );
    const type = structuredClone(classicData.houses.types[0]) as unknown as {
      house: string;
      template: { flags: { fctSpwn: string } };
    };
    const withSpawn = (house: string, f: string) => {
      const t = structuredClone(type);
      t.house = house;
      t.template.flags.fctSpwn = f;
      return t;
    };
    db.run(
      "INSERT INTO content_packs (id, name, version, position, source, data, installed_at) VALUES ('old', 'old', '1.0.0', 1, 'imported', ?, 'now')",
      [JSON.stringify({ manifest: {}, data: { houses: { types: [withSpawn("Hut", "X")] } } })],
    );
    db.run(
      "INSERT INTO content_rows (dataset, part, row_key, op, data, seq, updated_by, updated_at) VALUES ('houses', 'types', 'Barracks', 'set', ?, 1, 'a', 'then')",
      [JSON.stringify(withSpawn("Barracks", "W"))],
    );
    runMigrations(db, all);
    const packFlag = (
      db
        .query(
          "SELECT json_extract(data, '$.data.houses.types[0].template.flags.fctSpwn') AS f FROM content_packs WHERE id = 'old'",
        )
        .get() as { f: string }
    ).f;
    const rowFlag = (
      db
        .query(
          "SELECT json_extract(data, '$.template.flags.fctSpwn') AS f FROM content_rows WHERE dataset = 'houses'",
        )
        .get() as { f: string }
    ).f;
    expect([packFlag, rowFlag]).toEqual(["", "warrior"]);
  });

  test("tools_and_harvest turns older gathering tools into tool rows, ladders, harvest nodes and yields", () => {
    const db = openDatabase();
    const all = loadMigrations(MIGRATIONS_DIR);
    runMigrations(
      db,
      all.filter((m) => m.name < "20261123_64"),
    );
    // Classic's gather.json as it was before this stage.
    const oldGather = JSON.parse(
      readFileSync(join(import.meta.dir, "fixtures", "gather-before-stage5.json"), "utf8"),
    );
    const oldGathering = oldGather.gathering as Record<string, unknown>;
    const {
      tools: _tools,
      ladders: _ladders,
      requires: _requires,
      ...oldRules
    } = structuredClone(classicData.itemRules);
    const oldSkills = {
      ...classicData.bindings.skills,
      axeFighting: "AxeFighting",
      mining: "Mining",
    };
    // An imported pack that renamed Axe Fighting and bound no Mining.
    const { mining: _m, ...packSkills } = { ...oldSkills, axeFighting: "Woodcraft" };
    db.run(
      "INSERT INTO content_packs (id, name, version, position, source, data, installed_at) VALUES ('old', 'old', '1.0.0', 1, 'imported', ?, 'now')",
      [
        JSON.stringify({
          manifest: {},
          data: {
            gather: oldGather,
            "item-rules": oldRules,
            bindings: { ...classicData.bindings, skills: packSkills },
          },
        }),
      ],
    );
    // An operator who made Logs drop 1 in 2, and a draft that bound Mining to Digging.
    const opGathering = { ...structuredClone(oldGathering), logs: { item: "Logs", chance: 2 } };
    db.run(
      "INSERT INTO content_rows (dataset, part, row_key, op, data, seq, updated_by, updated_at) VALUES ('gather', 'gathering', '', 'set', ?, 1, 'a', 'then')",
      [JSON.stringify(opGathering)],
    );
    db.run(
      "INSERT INTO content_draft (dataset, part, row_key, op, data, author_account_id, author, updated_at) VALUES ('bindings', 'skills', '', 'set', ?, 'a', 'A', 'then')",
      [JSON.stringify({ ...packSkills, mining: "Digging" })],
    );
    // The draft also reverts the operator's gathering to the pack's.
    db.run(
      "INSERT INTO content_draft (dataset, part, row_key, op, data, author_account_id, author, updated_at) VALUES ('gather', 'gathering', '', 'revert', NULL, 'a', 'A', 'then')",
    );
    db.run(
      "INSERT INTO content_publishes (id, created_at, actor_account_id, actor_name, summary, changes, hash) VALUES ('p1', 'then', 'a', 'A', '', ?, 'h')",
      [
        JSON.stringify([
          {
            dataset: "gather",
            part: "gathering",
            key: null,
            before: null,
            after: { op: "set", data: opGathering },
          },
        ]),
      ],
    );
    runMigrations(db, all);
    // Run again by hand once it is recorded, it changes nothing.
    const dump = () =>
      JSON.stringify(
        ["content_packs", "content_rows", "content_draft", "content_publishes"].map((t) =>
          db.query(`SELECT * FROM ${t} ORDER BY 1, 2, 3`).all(),
        ),
      );
    const once = dump();
    const sql = all.find((m) => m.name === "20261123_64_tools_and_harvest.sql")?.sql ?? "";
    db.run(sql);
    expect(dump()).toBe(once);

    const pack = JSON.parse(
      (db.query("SELECT data FROM content_packs WHERE id = 'old'").get() as { data: string }).data,
    ) as { data: Record<string, Record<string, unknown>> };
    const classic = classicData;
    expect(pack.data.gather?.gathering).toEqual(classic.gather.gathering);
    expect(pack.data.gather?.harvest).toEqual(classic.gather.harvest);
    expect(pack.data.gather?.yields).toEqual(classic.gather.yields);
    // Axe's ladder reads the renamed skill; with Mining unbound, no Mining ladder.
    expect(pack.data["item-rules"]?.tools).toEqual(
      classic.itemRules.tools.filter((t) => t.ladder !== "mining"),
    );
    const { mining: _cm, ...ladders } = classic.itemRules.ladders;
    expect(pack.data["item-rules"]?.ladders).toEqual({
      ...ladders,
      axe: { ...classic.itemRules.ladders.axe, skill: "Woodcraft" },
    });
    expect(pack.data["item-rules"]?.requires).toEqual([]);
    expect(pack.data.bindings?.skills).toEqual({ ...classic.bindings.skills });
    // The converted pack loads: every dataset passes its schema.
    const manifest = JSON.parse(
      readFileSync(
        join(MIGRATIONS_DIR, "..", "..", "data", "packs", "classic", "manifest.json"),
        "utf8",
      ),
    );
    const loaded = readPackBlob(
      JSON.stringify({ ...pack, manifest: { ...manifest, id: "old", art: undefined } }),
    );
    expect(loaded.data.gather?.harvest).toEqual(classic.gather.harvest);

    const rows = (table: string) =>
      Object.fromEntries(
        (
          db.query(`SELECT dataset, part, data FROM ${table}`).all() as {
            dataset: string;
            part: string;
            data: string;
          }[]
        ).map((r) => [`${r.dataset}/${r.part}`, JSON.parse(r.data)]),
      );
    // The operator's gathering keeps its Logs change, now as a yields row; nothing else differs.
    const op = rows("content_rows");
    expect(Object.keys(op).sort()).toEqual(["gather/gathering", "gather/yields"]);
    expect(op["gather/gathering"]).toEqual(classic.gather.gathering);
    expect(op["gather/yields"]).toEqual({
      ...classic.gather.yields,
      Logs: { kind: "chance", item: "Logs", chance: 2 },
    });
    // The draft binds Mining (the pack left it unbound) to Digging: Mining's ladder comes back,
    // reading it, over the pack's Woodcraft axe. Its revert of the gathering reverts the yields.
    const draft = rows("content_draft");
    expect(Object.keys(draft).sort()).toEqual([
      "bindings/skills",
      "gather/gathering",
      "gather/yields",
      "itemRules/ladders",
      "itemRules/tools",
    ]);
    const { axeFighting: _a, ...unbound } = classic.bindings.skills as Record<string, string>;
    expect(draft["bindings/skills"]).toEqual(unbound);
    expect(draft["itemRules/tools"]).toEqual(classic.itemRules.tools);
    expect(draft["itemRules/ladders"]).toEqual({
      ...classic.itemRules.ladders,
      axe: { ...classic.itemRules.ladders.axe, skill: "Woodcraft" },
      mining: { ...classic.itemRules.ladders.mining, skill: "Digging" },
    });
    const ops = Object.fromEntries(
      (
        db.query("SELECT dataset, part, op FROM content_draft").all() as {
          dataset: string;
          part: string;
          op: string;
        }[]
      ).map((r) => [`${r.dataset}/${r.part}`, r.op]),
    );
    expect(ops["gather/yields"]).toBe("revert");
    expect(draft["gather/yields"]).toBeNull();
    const changes = JSON.parse(
      (
        db.query("SELECT changes FROM content_publishes WHERE id = 'p1'").get() as {
          changes: string;
        }
      ).changes,
    );
    expect(changes[0].after.data).toEqual(classic.gather.gathering);
    // The publish also made the yields row, so undoing it takes that away again.
    expect(changes.map((c: { part: string }) => c.part)).toEqual(["gathering", "yields"]);
    expect(changes[1].before).toBeNull();
    expect(rowHash(changes[1].after.data)).toBe(rowHash(op["gather/yields"]));
  });

  test("tools_and_harvest: undoing an older gathering publish still undoes it", () => {
    const db = openDatabase();
    const all = loadMigrations(MIGRATIONS_DIR);
    runMigrations(
      db,
      all.filter((m) => m.name < "20261123_64"),
    );
    const oldGather = JSON.parse(
      readFileSync(join(import.meta.dir, "fixtures", "gather-before-stage5.json"), "utf8"),
    );
    // An operator who made Logs drop 1 in 2, in a publish of its own.
    const logs2 = { ...oldGather.gathering, logs: { item: "Logs", chance: 2 } };
    db.run(
      "INSERT INTO content_rows (dataset, part, row_key, op, data, seq, updated_by, updated_at) VALUES ('gather', 'gathering', '', 'set', ?, 1, 'a', 'then')",
      [JSON.stringify(logs2)],
    );
    db.run(
      "INSERT INTO content_publishes (id, created_at, actor_account_id, actor_name, summary, changes, hash) VALUES ('p1', 'then', 'a', 'A', '', ?, 'h')",
      [
        JSON.stringify([
          {
            dataset: "gather",
            part: "gathering",
            key: null,
            before: null,
            after: { op: "set", data: logs2, baseHash: null, baseData: null },
          },
        ]),
      ],
    );
    runMigrations(db, all);
    const service = new ContentService({ db, now: () => "x", releasePacks: RELEASE_PACK_DIRS });
    expect(service.publishedContent().gather?.yields.Logs).toEqual({
      kind: "chance",
      item: "Logs",
      chance: 2,
    });
    const u = service.undo({ accountId: "a", name: "A" }, "p1");
    expect(u.ok).toBe(true);
    expect(service.publishedContent().gather?.yields.Logs).toEqual(classicData.gather.yields.Logs);
    expect(service.publishedContent().gather?.gathering).toEqual(classicData.gather.gathering);
  });

  test("tools_and_harvest keeps odd older gathering valid, undo chains working and pack notices quiet", () => {
    const db = openDatabase();
    const all = loadMigrations(MIGRATIONS_DIR);
    runMigrations(
      db,
      all.filter((m) => m.name < "20261123_64"),
    );
    const oldGather = JSON.parse(
      readFileSync(join(import.meta.dir, "fixtures", "gather-before-stage5.json"), "utf8"),
    );
    // A pack whose gathering 1.6's engine took as it was: a Saw felling trees after the Axe, a
    // tool training a skill no gain row rolls, a ragged shovel test and a slow rod.
    const g = structuredClone(oldGather.gathering);
    g.tools.push(
      {
        tool: "Saw",
        match: "=",
        counter: "Chop",
        skill: "Lumberjacking",
        tiles: { from: "S3", to: "P3" },
        successSound: null,
        hitSound: null,
        imp: "LumberjackImp",
      },
      {
        tool: "Hammer",
        match: "=",
        counter: "Mine",
        skill: "Slash",
        tiles: { from: "6P", to: "6Q" },
        successSound: null,
        hitSound: null,
        imp: "SlashImp",
      },
    );
    g.shovelLayer1 = { test: "*G1**H1*X*" };
    g.fishing.atDelay = 2000;
    g.logs.chance = 2;
    db.run(
      "INSERT INTO content_packs (id, name, version, position, source, data, installed_at) VALUES ('old', 'old', '1.0.0', 1, 'imported', ?, 'now')",
      [
        JSON.stringify({
          manifest: { ...classicManifest(), id: "old", name: "old", art: undefined },
          data: { gather: { ...oldGather, gathering: g } },
        }),
      ],
    );
    // The operator then made Logs 1 in 4 (p1), and bound Mining to Archery (p2).
    const opG = { ...structuredClone(g), logs: { item: "Logs", chance: 4 } };
    const opB = { ...classicData.bindings.skills, axeFighting: "AxeFighting", mining: "Archery" };
    db.run(
      "INSERT INTO content_rows (dataset, part, row_key, op, data, seq, updated_by, updated_at) VALUES ('gather', 'gathering', '', 'set', ?, 1, 'a', 'then')",
      [JSON.stringify(opG)],
    );
    db.run(
      "INSERT INTO content_rows (dataset, part, row_key, op, data, seq, updated_by, updated_at) VALUES ('bindings', 'skills', '', 'set', ?, 2, 'a', 'then')",
      [JSON.stringify(opB)],
    );
    const state = (data: unknown) => ({ op: "set", data, baseHash: null, baseData: null });
    const publish = (id: string, at: string, change: Record<string, unknown>) =>
      db.run(
        "INSERT INTO content_publishes (id, created_at, actor_account_id, actor_name, summary, changes, hash) VALUES (?, ?, 'a', 'A', '', ?, 'h')",
        [id, at, JSON.stringify([change])],
      );
    publish("p1", "2026-11-22T01:00:00.000Z", {
      dataset: "gather",
      part: "gathering",
      key: null,
      before: null,
      after: state(opG),
    });
    publish("p2", "2026-11-22T02:00:00.000Z", {
      dataset: "bindings",
      part: "skills",
      key: null,
      before: null,
      after: state(opB),
    });
    runMigrations(db, all);

    const pack = JSON.parse(
      (db.query("SELECT data FROM content_packs WHERE id = 'old'").get() as { data: string }).data,
    ) as { data: { gather: { harvest: Record<string, unknown>[] } } };
    // It loads: every dataset passes its schema.
    const loaded = readPackBlob(JSON.stringify(pack));
    const harvest = loaded.data.gather?.harvest ?? [];
    const tiles = harvest.map((n) => `${n.tile}:${(n.tools ?? ["*"]).join("/")}`);
    // The Saw's node comes before the Axe's open one, so each tool keeps its own.
    expect(tiles.indexOf("S3:Saw")).toBeLessThan(tiles.indexOf("S3:*"));
    expect(harvest.find((n) => n.tools?.[0] === "Hammer")?.gains).toBe(false);
    expect(harvest.find((n) => n.can === "Dig")?.under).toEqual(["G1", "H1"]);

    const service = new ContentService({ db, now: () => "x", releasePacks: RELEASE_PACK_DIRS });
    const live = service.publishedContent();
    expect(live.itemRules?.ladders.fishing?.steps).toEqual([{ delay: 1000 }]);
    expect(live.itemRules?.ladders.mining?.skill).toBe("Archery");
    expect(live.gather?.yields.Logs).toMatchObject({ chance: 4 });
    // The rows the migration made are based on the pack's sections: no notice says a pack changed.
    const made = ["harvest", "yields", "tools", "ladders"];
    expect(service.notices().filter((n) => made.includes(n.part))).toEqual([]);
    expect(
      (db.query("SELECT part FROM content_rows ORDER BY part").all() as { part: string }[]).map(
        (r) => r.part,
      ),
    ).toEqual(["gathering", "ladders", "skills", "tools", "yields"]);
    // Each publish undoes, the later first, and puts back what it changed.
    const actor = { accountId: "a", name: "A" };
    expect(service.undo(actor, "p2").ok).toBe(true);
    expect(service.publishedContent().itemRules?.ladders.mining?.skill).toBe("Mining");
    const u1 = service.undo(actor, "p1");
    expect(u1.ok ? "" : JSON.stringify(u1)).toBe("");
    expect(service.publishedContent().gather?.yields.Logs).toMatchObject({ chance: 2 });
    expect(service.publishedContent().itemRules?.ladders.fishing?.steps).toEqual([{ delay: 1000 }]);
  });
});
