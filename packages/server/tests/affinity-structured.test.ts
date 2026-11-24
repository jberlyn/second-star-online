/**
 * Issue #31, stage 1: a melee affinity's extra roll is a part (`randomN`), not `"random(n)"` text,
 * and migration 70 gives every stored copy (an imported pack's, the operator's rows and their pack
 * bases, the draft's and the publish log's) the new shape, so each old row plays exactly as before.
 */
import { afterAll, describe, expect, test } from "bun:test";

import type { MeleeAffinity, MonstersData } from "@secondstaronline/data";
import { classicData } from "@secondstaronline/data/classic";
import { RELEASE_PACK_DIRS } from "@secondstaronline/data/packs";
import { DATASET_SCHEMAS } from "@secondstaronline/data/schema";
import {
  buildContentStore,
  type ContentData,
  content,
  installContent,
  meleeDamageVsMonster,
  type Rng,
} from "@secondstaronline/shared";

import { rowHash } from "../src/content/rows.ts";
import { type ContentActor, ContentService } from "../src/content/service.ts";
import { openDatabase } from "../src/persistence/database.ts";
import { loadMigrations, MIGRATIONS_DIR, runMigrations } from "../src/persistence/migrations.ts";

const classic = content();
afterAll(() => installContent(classic));
const ADMIN: ContentActor = { accountId: "a", name: "Admin" };
const AFF = classicData.monsters.meleeAffinities;

/** A row in the shape before migration 70: `deltaRandom` text, or null for no roll. */
type Legacy = Omit<MeleeAffinity, "randomN"> & { deltaRandom: string | null };
const legacy = (r: MeleeAffinity): Legacy => {
  const { randomN, ...rest } = r;
  return { ...rest, deltaRandom: randomN > 0 ? `random(${randomN})` : null };
};

/** The database at migration 69, ready for old rows. */
function before70() {
  const db = openDatabase();
  const all = loadMigrations(MIGRATIONS_DIR);
  runMigrations(
    db,
    all.filter((m) => m.name < "20261125_70"),
  );
  return { db, all };
}

describe("structured melee affinities (#31 stage 1)", () => {
  test("Classic's rows are parts: the Sword of Hope's two rolls are randomN 6, the rest 0", () => {
    expect(AFF.filter((r) => r.randomN > 0).map((r) => [r.monster, r.randomN])).toEqual([
      ["Overlord", 6],
      ["Dark", 6],
    ]);
    expect(JSON.stringify(classicData.monsters)).not.toContain("deltaRandom");
  });

  test("the old text form and a negative roll are refused", () => {
    const withRow = (row: unknown) =>
      DATASET_SCHEMAS.monsters.safeParse({ ...classicData.monsters, meleeAffinities: [row] })
        .success;
    const ok = AFF[0] as MeleeAffinity;
    expect(withRow(ok)).toBe(true);
    expect(withRow(legacy(ok))).toBe(false);
    expect(withRow({ ...ok, randomN: -1 })).toBe(false);
  });
});

describe("the structured affinity migration", () => {
  test("reshapes every stored copy and leaves undo and notices working", () => {
    const { db, all } = before70();
    const oldMonsters = { ...classicData.monsters, meleeAffinities: AFF.map(legacy) };
    const hope = (r: MeleeAffinity) => r.monster === "Overlord" && r.weapon === "Hope";
    const mine = AFF.map((r) => (hope(r) ? { ...r, delta: 20 } : r));
    const oldMine = mine.map(legacy);
    const oldBase = AFF.map(legacy);
    db.run(
      "INSERT INTO content_packs (id, name, version, position, source, data, installed_at) VALUES ('old', 'Old', '1.0.0', 1, 'imported', ?, 'now')",
      [JSON.stringify({ manifest: {}, data: { monsters: oldMonsters } })],
    );
    db.run(
      "INSERT INTO content_rows (dataset, part, row_key, op, data, base_hash, base_data, seq, updated_by, updated_at) VALUES ('monsters', 'meleeAffinities', '', 'set', ?, ?, ?, 1, 'a', 'then')",
      [JSON.stringify(oldMine), rowHash(oldBase), JSON.stringify(oldBase)],
    );
    db.run(
      "INSERT INTO content_draft (dataset, part, row_key, op, data, author_account_id, author, updated_at) VALUES ('monsters', 'meleeAffinities', '', 'set', ?, 'a', 'A', 'then')",
      [JSON.stringify(oldMine)],
    );
    db.run(
      "INSERT INTO content_publishes (id, created_at, actor_account_id, actor_name, summary, changes, hash) VALUES ('p1', 'then', 'a', 'A', '', ?, 'h')",
      [
        JSON.stringify([
          { dataset: "casino", part: "slots", key: null, before: null, after: null },
          {
            dataset: "monsters",
            part: "meleeAffinities",
            key: null,
            before: null,
            after: { op: "set", data: oldMine, baseHash: rowHash(oldBase), baseData: oldBase },
          },
        ]),
      ],
    );
    runMigrations(db, all);
    runMigrations(db, all);

    const one = <T>(sql: string): T => JSON.parse((db.query(sql).get() as { v: string }).v) as T;
    expect(
      one<MonstersData>(
        "SELECT json_extract(data, '$.data.monsters') AS v FROM content_packs WHERE id = 'old'",
      ),
    ).toEqual(classicData.monsters);
    expect(one("SELECT data AS v FROM content_rows WHERE dataset = 'monsters'")).toEqual(mine);
    expect(one("SELECT base_data AS v FROM content_rows WHERE dataset = 'monsters'")).toEqual(AFF);
    expect(db.query("SELECT base_hash FROM content_rows WHERE dataset = 'monsters'").get()).toEqual(
      { base_hash: null },
    );
    expect(one("SELECT data AS v FROM content_draft WHERE dataset = 'monsters'")).toEqual(mine);
    const changes = one<Record<string, unknown>[]>(
      "SELECT changes AS v FROM content_publishes WHERE id = 'p1'",
    );
    expect(changes[0]).toEqual({
      dataset: "casino",
      part: "slots",
      key: null,
      before: null,
      after: null,
    });
    expect(changes[1]?.after).toEqual({ op: "set", data: mine, baseHash: null, baseData: AFF });

    // The server loads it: the operator's row plays, no notice says the pack changed it, and the
    // old publish still undoes.
    db.run("DELETE FROM content_packs WHERE id = 'old'");
    const s = new ContentService({ db, now: () => "x", releasePacks: RELEASE_PACK_DIRS });
    expect(s.publishedContent().monsters?.meleeAffinities.find(hope)).toMatchObject({
      delta: 20,
      randomN: 6,
    });
    expect(s.notices().filter((n) => n.dataset === "monsters")).toEqual([]);
    expect(s.undo(ADMIN, "p1").ok).toBe(true);
    expect(s.publishedContent().monsters?.meleeAffinities).toEqual(AFF);
  });
});

describe("the migration's speed", () => {
  test("250 affinity publishes (4.8 MB) and 10,000 other monster changes migrate in seconds", () => {
    const { db, all } = before70();
    const old = AFF.map(legacy);
    const ins = db.prepare(
      "INSERT INTO content_publishes (id, created_at, actor_account_id, actor_name, summary, changes, hash) VALUES (?, 'then', 'a', 'A', '', ?, 'h')",
    );
    for (let i = 0; i < 250; i++) {
      const side = { op: "set", data: old, baseHash: "x", baseData: old };
      ins.run(
        `p${i}`,
        JSON.stringify([
          { dataset: "monsters", part: "meleeAffinities", key: null, before: side, after: side },
        ]),
      );
    }
    const slime = classicData.monsters.monsters[0];
    for (let i = 0; i < 10_000; i++) {
      ins.run(
        `q${i}`,
        JSON.stringify([
          {
            dataset: "monsters",
            part: "monsters",
            key: "Slime",
            before: null,
            after: { op: "set", data: slime },
          },
        ]),
      );
    }
    const t = performance.now();
    runMigrations(db, all);
    // About 0.7 s here; it was 9 s when each field edit rebuilt the whole change.
    expect(performance.now() - t).toBeLessThan(5000);
    const last = db.query("SELECT changes FROM content_publishes WHERE id = 'p249'").get() as {
      changes: string;
    };
    expect(JSON.parse(last.changes)[0].after.data).toEqual(AFF);
  }, 60_000);
});

describe("the migration plays every legacy roll as before", () => {
  /** 1.6's reader of the old row: `delta`, then any truthy text's first digits, drawn. */
  function oldDamage(rows: Legacy[], weapon: string, monster: string, rng: Rng): number {
    let dmg = 30;
    for (const a of rows) {
      if (weapon.includes(a.weapon) && monster === a.monster) {
        dmg += a.delta;
        if (a.deltaRandom) {
          dmg += rng.random(Number(/\d+/.exec(a.deltaRandom)?.[0]));
        }
      }
    }
    return dmg;
  }
  function recorder(high: boolean): Rng & { draws: number[] } {
    const draws: number[] = [];
    return {
      draws,
      random(n) {
        draws.push(n);
        return n >= 1 ? (high ? n : 1) : 0;
      },
    };
  }
  function migrate(rows: Legacy[]): MeleeAffinity[] {
    const { db, all } = before70();
    db.run(
      "INSERT INTO content_rows (dataset, part, row_key, op, data, seq, updated_by, updated_at) VALUES ('monsters', 'meleeAffinities', '', 'set', ?, 1, 'a', 'then')",
      [JSON.stringify(rows)],
    );
    runMigrations(db, all);
    const r = db.query("SELECT data FROM content_rows WHERE dataset = 'monsters'").get() as {
      data: string;
    };
    return JSON.parse(r.data) as MeleeAffinity[];
  }

  test("null, empty, random(n), spaced and random(0) (which drew once and gave 0)", () => {
    const row = (deltaRandom: string | null, delta = 3): Legacy => ({
      weapon: "Sword",
      weaponMatch: "contains",
      monster: "Orc",
      monsterMatch: "exact",
      delta,
      deltaRandom,
    });
    const rows = [
      row(null),
      row(""),
      row("random(6)"),
      row(" random( 4 ) "),
      row("random(0)", 5),
      row("random(00)", -2),
    ];
    const migrated = migrate(rows);
    expect(migrated.map((r) => [r.delta, r.randomN])).toEqual([
      [3, 0],
      [3, 0],
      [3, 6],
      [3, 4],
      [4, 1],
      [-3, 1],
    ]);
    expect(JSON.stringify(migrated)).not.toContain("deltaRandom");
    const d = structuredClone(classicData) as unknown as ContentData;
    d.monsters.meleeAffinities = migrated;
    installContent(buildContentStore(d));
    try {
      for (const high of [false, true]) {
        const a = recorder(high);
        const b = recorder(high);
        const was = oldDamage(rows, "Long Sword", "Orc", a);
        // Defense 0, so only the rows (and no floor) decide.
        const now = meleeDamageVsMonster(30, { name: "Orc", defense: 0 }, "Long Sword", b);
        // As many draws, in the same places: a `random(0)` drew too (Lingo gave it 0).
        expect([now, b.draws.length, b.draws.filter((n) => n > 1)]).toEqual([
          was,
          a.draws.length,
          a.draws.filter((n) => n > 1),
        ]);
      }
    } finally {
      installContent(classic);
    }
  });

  test("any bound the old schema took loads: leading zeros, 16+ digits, random(0) at the lowest delta", () => {
    const row = (deltaRandom: string | null, delta = 3): Legacy => ({
      weapon: "Sword",
      weaponMatch: "contains",
      monster: "Orc",
      monsterMatch: "exact",
      delta,
      deltaRandom,
    });
    const rows = [
      row("random(0000000000000006)"),
      row("random(1000000000000000)"),
      row("random(99999999999999999999)"),
      row(`random(${"9".repeat(308)})`),
      // The largest 309 digits that still read as a finite number (Number.MAX_VALUE).
      row(`random(${(2n ** 1024n - 2n ** 970n - 1n).toString()})`),
      row("random(0)", -Number.MAX_SAFE_INTEGER),
      row("   "),
    ];
    const migrated = migrate(rows);
    // Each n is the very number the old reader drew: `Number(digits)`.
    expect(migrated.map((r) => r.randomN)).toEqual([
      6,
      1e15,
      Number("99999999999999999999"),
      Number("9".repeat(308)),
      Number.MAX_VALUE,
      1,
      1,
    ]);
    expect(migrated.map((r) => r.delta)).toEqual([3, 3, 3, 3, 3, -(2 ** 53), 2]);
    // And the world loads them.
    expect(
      DATASET_SCHEMAS.monsters.safeParse({ ...classicData.monsters, meleeAffinities: migrated })
        .success,
    ).toBe(true);
    for (const high of [false, true]) {
      const draws = (rs: Legacy[]) => {
        const r = recorder(high);
        oldDamage(rs, "Long Sword", "Orc", r);
        return r.draws.length;
      };
      expect(draws([rows[6] as Legacy])).toBe(1);
    }
  });

  test("a roll it can't read stops the upgrade, naming it, instead of a world that won't load", () => {
    for (const bad of [
      "banana",
      "random(x)",
      "random(1 2)",
      "2+random(3)",
      "random(3)+2",
      "RANDOM(3)",
      // From 2^1024 - 2^970 the old reader read Infinity, which no row can hold.
      `random(${(2n ** 1024n - 2n ** 970n).toString()})`,
      `random(${"9".repeat(309)})`,
    ]) {
      expect(() =>
        migrate([
          {
            weapon: "Sword",
            weaponMatch: "contains",
            monster: "Orc",
            monsterMatch: "exact",
            delta: 1,
            deltaRandom: bad,
          },
        ]),
      ).toThrow(/unreadable_melee_affinity_roll_70/);
    }
  });
});
