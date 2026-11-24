/**
 * Issue #30, stage 1: attack power in structured parts. A base roll is `{ flat, randomN,
 * strengthHalf? }` and a tier value a number or `{ flat, randomN }`; formula text is gone. Classic
 * plays as before (attack-golden.test.ts). Here: the limits every save, publish and undo checks, a
 * published change playing at once, and the migration that gives every stored copy (an imported
 * pack, the operator's rows and their pack baselines, the draft, the publish log) the new shape.
 */
import { afterAll, describe, expect, test } from "bun:test";

import type { AttPowerData } from "@secondstaronline/data";
import { classicData } from "@secondstaronline/data/classic";
import { RELEASE_PACK_DIRS } from "@secondstaronline/data/packs";
import {
  attackPower,
  content,
  type Fighter,
  installContent,
  lingoDiv,
  NO_EQUIPMENT,
  NO_FACTION,
  type Rng,
  rollBase,
} from "@secondstaronline/shared";

import { rowHash } from "../src/content/rows.ts";
import { type ContentActor, ContentService } from "../src/content/service.ts";
import { openDatabase } from "../src/persistence/database.ts";
import { loadMigrations, MIGRATIONS_DIR, runMigrations } from "../src/persistence/migrations.ts";

const classic = content();
afterAll(() => installContent(classic));

const ADMIN: ContentActor = { accountId: "acc-admin", name: "Admin" };
const REF = { dataset: "attPower" as const, part: "attPower", key: null };
const AP = classicData.attPower.attPower;

const high: Rng = { random: (n) => n };

function swordsman(weapon: string): Fighter {
  return {
    level: 1,
    str: 1,
    sta: 10,
    int: 10,
    wis: 10,
    skills: Array(content().classes.skills.length).fill(0) as number[],
    equip: { ...NO_EQUIPMENT, weapon },
    faction: NO_FACTION,
    attackBonus: 0,
    wanted: false,
  };
}

function service() {
  const db = openDatabase();
  runMigrations(db, loadMigrations(MIGRATIONS_DIR));
  let t = 0;
  const s = new ContentService({
    db,
    now: () => new Date(Date.UTC(2026, 10, 24, 0, 0, t++)).toISOString(),
    releasePacks: RELEASE_PACK_DIRS,
    onPublish: (store) => installContent(store),
  });
  return { db, s };
}

const withBase = (ap: AttPowerData["attPower"], pattern: string, row: Record<string, unknown>) => ({
  ...ap,
  base: ap.base.map((r) => (r.pattern === pattern ? { ...r, ...row } : r)),
});

describe("structured attack power (#30 stage 1)", () => {
  test("Classic's rows are parts only: no formula text, the Gold Axe's Strength roll a switch", () => {
    const text = JSON.stringify(classicData.attPower);
    expect(text).not.toContain('"expr"');
    expect(text).not.toContain('"extra"');
    expect(text).not.toContain("random(");
    expect(AP.base.filter((r) => r.strengthHalf).map((r) => r.pattern)).toEqual(["Gold Axe"]);
    expect(AP.exactOverrides.find((r) => r.pattern === "Wooden Bow")?.randomN).toBe(0);
  });

  test("a draft out of the limits, or in the old text form, is refused", () => {
    const { s } = service();
    const refused = (ap: unknown) => s.draftSet(ADMIN, REF, "set", ap).ok === false;
    expect(refused(withBase(AP, "Knife", { flat: 1.5 }))).toBe(true);
    expect(refused(withBase(AP, "Knife", { randomN: -1 }))).toBe(true);
    expect(refused(withBase(AP, "Knife", { randomN: 2.5 }))).toBe(true);
    expect(refused(withBase(AP, "Knife", { expr: "2 + random(3)" }))).toBe(true);
    expect(refused(withBase(AP, "Gold Axe", { extra: "random(strength) / 2" }))).toBe(true);
    const tiered = structuredClone(AP);
    const tier = tiered.skillBlocks
      .flatMap((b) => b.tiers)
      .find((t) => typeof t.value === "object");
    expect(tier).toBeDefined();
    (tier as { value: unknown }).value = "1 + random(2)";
    expect(refused(tiered)).toBe(true);
    (tier as { value: unknown }).value = { flat: 1, randomN: 100000 };
    expect(refused(tiered)).toBe(true);
    (tier as { value: unknown }).value = { flat: 1, randomN: 2, extra: 1 };
    expect(refused(tiered)).toBe(true);
    // Any whole `flat` and any `randomN` from 0, as the rows before this shape allowed, so a world
    // written then still loads.
    expect(
      s.draftSet(ADMIN, REF, "set", withBase(AP, "Knife", { flat: -1, randomN: 10000 })).ok,
    ).toBe(true);
  });

  test("a published roll plays at once, a Strength roll can be switched on, and undo puts it back", () => {
    const { s } = service();
    // Knife: 2 + random(3) at its highest, and nothing else for a beginner.
    expect(attackPower(swordsman("Knife"), high).power).toBe(5);
    s.draftSet(
      ADMIN,
      REF,
      "set",
      withBase(AP, "Knife", { flat: 20, randomN: 0, strengthHalf: true }),
    );
    const p = s.publish(ADMIN, s.draftRev(), "Knives");
    expect(p.ok).toBe(true);
    // 20 with no roll, then random(strength 1) / 2 = 0: the Strength roll is the first draw.
    const draws: number[] = [];
    const rec: Rng = {
      random: (n) => {
        draws.push(n);
        return n;
      },
    };
    expect(attackPower(swordsman("Knife"), rec).power).toBe(20);
    expect(draws[0]).toBe(1);
    expect(s.undo(ADMIN, p.ok ? p.value.id : "").ok).toBe(true);
    expect(attackPower(swordsman("Knife"), high).power).toBe(5);
  });
});

/** Attack power as it was stored before this stage: display text, the Gold Axe's `extra`, null rolls, tier text. */
function oldShape(ap: AttPowerData): unknown {
  const base = (r: AttPowerData["attPower"]["base"][number]) => {
    const { strengthHalf, ...rest } = r;
    return {
      ...rest,
      expr: r.randomN > 0 ? `${r.flat} + random(${r.randomN})` : String(r.flat),
      randomN: r.randomN > 0 ? r.randomN : null,
      ...(strengthHalf ? { extra: "random(strength) / 2" } : {}),
    };
  };
  const value = (v: number | { flat: number; randomN: number }) =>
    typeof v === "number"
      ? v
      : v.flat === 0
        ? `random(${v.randomN})`
        : `${v.flat} + random(${v.randomN})`;
  return {
    attPower: {
      ...ap.attPower,
      base: ap.attPower.base.map(base),
      exactOverrides: ap.attPower.exactOverrides.map(base),
      skillBlocks: ap.attPower.skillBlocks.map((b) => ({
        ...b,
        tiers: b.tiers.map((t) => ({ ...t, value: value(t.value) })),
      })),
    },
  };
}

describe("the structured attack power migration", () => {
  test("reshapes every stored copy, keeps the progression formulas, and leaves undo and notices working", () => {
    const db = openDatabase();
    const all = loadMigrations(MIGRATIONS_DIR);
    runMigrations(
      db,
      all.filter((m) => m.name < "20261124_68"),
    );
    const oldClassic = oldShape(classicData.attPower) as { attPower: Record<string, unknown> };
    // The text form really is the old one: a tier written "2 + random(3)" and the Gold Axe's switch.
    expect(JSON.stringify(oldClassic)).toContain('"value":"2 + random(3)"');
    expect(JSON.stringify(oldClassic)).toContain('"extra":"random(strength) / 2"');
    const mine = structuredClone(classicData.attPower.attPower);
    mine.base = mine.base.map((r) => (r.pattern === "Gold Axe" ? { ...r, flat: 7 } : r));
    const oldMine = (oldShape({ attPower: mine }) as { attPower: unknown }).attPower;
    const oldSpells = {
      power: { base: [{ when: ["Magery > 10"], op: "add", value: "random(2)" }], tables: {} },
    };
    db.run(
      "INSERT INTO content_packs (id, name, version, position, source, data, installed_at) VALUES ('old', 'Old', '1.0.0', 1, 'imported', ?, 'now')",
      [JSON.stringify({ manifest: {}, data: { attpower: oldClassic, spells: oldSpells } })],
    );
    db.run(
      "INSERT INTO content_rows (dataset, part, row_key, op, data, base_hash, base_data, seq, updated_by, updated_at) VALUES ('attPower', 'attPower', '', 'set', ?, ?, ?, 1, 'a', 'then')",
      [JSON.stringify(oldMine), rowHash(oldClassic.attPower), JSON.stringify(oldClassic.attPower)],
    );
    // A progression formula keeps its text: classes.json is not attack power.
    const formula = [{ op: "set", value: "1 + random(5)" }];
    db.run(
      "INSERT INTO content_rows (dataset, part, row_key, op, data, seq, updated_by, updated_at) VALUES ('classes', 'formulaProbe', '', 'set', ?, 2, 'a', 'then')",
      [JSON.stringify(formula)],
    );
    db.run(
      "INSERT INTO content_draft (dataset, part, row_key, op, data, author_account_id, author, updated_at) VALUES ('attPower', 'attPower', '', 'set', ?, 'a', 'A', 'then')",
      [JSON.stringify(oldMine)],
    );
    db.run(
      "INSERT INTO content_publishes (id, created_at, actor_account_id, actor_name, summary, changes, hash) VALUES ('p1', 'then', 'a', 'A', '', ?, 'h')",
      [
        JSON.stringify([
          { dataset: "casino", part: "slots", key: null, before: null, after: null },
          {
            dataset: "attPower",
            part: "attPower",
            key: null,
            before: null,
            after: {
              op: "set",
              data: oldMine,
              baseHash: rowHash(oldClassic.attPower),
              baseData: oldClassic.attPower,
            },
          },
        ]),
      ],
    );
    runMigrations(db, all);
    runMigrations(db, all);

    const one = <T>(sql: string): T => JSON.parse((db.query(sql).get() as { v: string }).v) as T;
    expect(
      one("SELECT json_extract(data, '$.data.attpower') AS v FROM content_packs WHERE id = 'old'"),
    ).toEqual(classicData.attPower);
    expect(
      one(
        "SELECT json_extract(data, '$.data.spells.power.base') AS v FROM content_packs WHERE id = 'old'",
      ),
    ).toEqual([{ when: ["Magery > 10"], op: "add", value: { flat: 0, randomN: 2 } }]);
    expect(one("SELECT data AS v FROM content_rows WHERE dataset = 'attPower'")).toEqual(mine);
    expect(one("SELECT base_data AS v FROM content_rows WHERE dataset = 'attPower'")).toEqual(AP);
    expect(db.query("SELECT base_hash FROM content_rows WHERE dataset = 'attPower'").get()).toEqual(
      {
        base_hash: null,
      },
    );
    expect(one("SELECT data AS v FROM content_rows WHERE dataset = 'classes'")).toEqual(formula);
    expect(one("SELECT data AS v FROM content_draft WHERE dataset = 'attPower'")).toEqual(mine);
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
    expect(changes[1]?.after).toEqual({ op: "set", data: mine, baseHash: null, baseData: AP });

    // The server loads it: the operator's Gold Axe plays, no notice says the pack changed it, and
    // the old publish still undoes.
    db.run("DELETE FROM content_packs WHERE id = 'old'");
    db.run("DELETE FROM content_rows WHERE dataset = 'classes'");
    const s = new ContentService({ db, now: () => "x", releasePacks: RELEASE_PACK_DIRS });
    expect(
      s.publishedContent().attPower?.attPower.base.find((r) => r.pattern === "Gold Axe"),
    ).toEqual({
      match: "contains",
      pattern: "Gold Axe",
      flat: 7,
      randomN: 6,
      strengthHalf: true,
    });
    expect(s.notices().filter((n) => n.dataset === "attPower")).toEqual([]);
    expect(s.undo(ADMIN, "p1").ok).toBe(true);
    expect(s.publishedContent().attPower?.attPower).toEqual(AP);
  });
});

describe("the migration plays every legacy roll as before", () => {
  /** HEAD's base roll: a null roll draws nothing; `extra` ran only on a base row, when set. */
  type Legacy = { flat: number; randomN: number | null; extra?: string };
  function oldRoll(row: Legacy, str: number, rng: Rng, isBase: boolean): number {
    let power = row.flat + (row.randomN === null ? 0 : rng.random(row.randomN));
    if (isBase && row.extra) {
      power += lingoDiv(rng.random(str), 2);
    }
    return power;
  }
  /** The game's Rng: a bound below 1 draws and gives 0. */
  function recorder(high: boolean): Rng & { draws: number[] } {
    const draws: number[] = [];
    return {
      draws,
      random(n) {
        draws.push(n);
        return n < 1 ? 0 : high ? n : 1;
      },
    };
  }

  test("rolls of 0 or below, wide values and the Strength switch survive the reshaping", () => {
    const legacyBase: (Legacy & { match: string; pattern: string; expr: string })[] = [
      { match: "contains", pattern: "Knife", expr: "5 + random(0)", flat: 5, randomN: 0 },
      { match: "contains", pattern: "Dagger", expr: "-1", flat: -1, randomN: -1 },
      { match: "contains", pattern: "Club", expr: "x", flat: 0, randomN: -3 },
      {
        match: "contains",
        pattern: "Axe",
        expr: "10000 + random(10000)",
        flat: 10000,
        randomN: 10000,
        extra: "",
      },
      { match: "contains", pattern: "Gold Axe", expr: "y", flat: 6, randomN: null, extra: "z" },
    ];
    const legacyOverrides = [
      { match: "exact", pattern: "Gold Axe", expr: "2", flat: 2, randomN: null, extra: "z" },
    ];
    const legacy = {
      ...structuredClone(classicData.attPower.attPower),
      base: legacyBase,
      exactOverrides: legacyOverrides,
      skillBlocks: [],
    };
    const db = openDatabase();
    const all = loadMigrations(MIGRATIONS_DIR);
    runMigrations(
      db,
      all.filter((m) => m.name < "20261124_68"),
    );
    db.run(
      "INSERT INTO content_rows (dataset, part, row_key, op, data, seq, updated_by, updated_at) VALUES ('attPower', 'attPower', '', 'set', ?, 1, 'a', 'then')",
      [JSON.stringify(legacy)],
    );
    runMigrations(db, all);
    runMigrations(db, all);
    // The world starts on it.
    const s = new ContentService({ db, now: () => "x", releasePacks: RELEASE_PACK_DIRS });
    const ap = s.publishedContent().attPower?.attPower;
    expect(ap).toBeDefined();
    const rows = [
      ...(ap?.base ?? []).map((r, i) => [r, legacyBase[i], true] as const),
      ...(ap?.exactOverrides ?? []).map((r, i) => [r, legacyOverrides[i], false] as const),
    ];
    expect(rows.length).toBe(6);
    for (const [now, was, isBase] of rows) {
      for (const high of [false, true]) {
        const a = recorder(high);
        const b = recorder(high);
        const before = oldRoll(was as Legacy, 16, a, isBase);
        expect({ p: was?.pattern, v: rollBase(now, 16, b), d: b.draws.length }).toEqual({
          p: was?.pattern,
          v: before,
          d: a.draws.length,
        });
      }
    }
    // An empty `extra` and an override's `extra` never rolled Strength, so they don't now.
    expect(ap?.base[3]?.strengthHalf).toBeUndefined();
    expect(ap?.base[4]?.strengthHalf).toBe(true);
    expect(ap?.exactOverrides[0]?.strengthHalf).toBeUndefined();
  });
});

describe("the migration reads every tier value the older schemas took", () => {
  function migrateSpells(values: unknown[]) {
    const db = openDatabase();
    const all = loadMigrations(MIGRATIONS_DIR);
    runMigrations(
      db,
      all.filter((m) => m.name < "20261124_68"),
    );
    const spells = {
      power: { base: values.map((value) => ({ when: null, op: "add", value })), tables: {} },
    };
    db.run(
      "INSERT INTO content_rows (dataset, part, row_key, op, data, seq, updated_by, updated_at) VALUES ('spells', 'power', '', 'set', ?, 1, 'a', 'then')",
      [JSON.stringify(spells)],
    );
    return () => {
      runMigrations(db, all);
      const row = db.query("SELECT data FROM content_rows WHERE dataset = 'spells'").get() as {
        data: string;
      };
      return (JSON.parse(row.data) as typeof spells).power.base.map((r) => r.value);
    };
  }

  test("spaces, signs, either order and random(0) (which drew once and gave 0)", () => {
    const run = migrateSpells([
      " 5 ",
      "+5",
      "-12",
      "2+random(3)",
      " 2 + random( 3 ) ",
      "random(3) + 2",
      "random(4)",
      "random(0)",
      "7 + random(0)",
      9,
    ]);
    expect(run()).toEqual([
      5,
      5,
      -12,
      { flat: 2, randomN: 3 },
      { flat: 2, randomN: 3 },
      { flat: 2, randomN: 3 },
      { flat: 0, randomN: 4 },
      { flat: -1, randomN: 1 },
      { flat: 6, randomN: 1 },
      9,
    ]);
  });

  test("a value it can't read stops the upgrade, naming it, instead of a world that won't load", () => {
    for (const bad of ["banana", "2*random(3)", "random(3)+x", "123456"]) {
      const run = migrateSpells([bad]);
      expect(run).toThrow(/unreadable_attack_power_value_68/);
    }
  });

  test("a long publish log migrates quickly", () => {
    const db = openDatabase();
    const all = loadMigrations(MIGRATIONS_DIR);
    runMigrations(
      db,
      all.filter((m) => m.name < "20261124_68"),
    );
    const old = (
      JSON.parse(JSON.stringify(classicData.attPower)) as { attPower: Record<string, unknown> }
    ).attPower;
    const legacy = {
      ...old,
      base: (old.base as Record<string, unknown>[]).map((r) => ({
        ...r,
        expr: "x",
        randomN: r.randomN === 0 ? null : r.randomN,
      })),
    };
    const change = {
      dataset: "attPower",
      part: "attPower",
      key: null,
      before: { op: "set", data: legacy, baseHash: "h", baseData: legacy },
      after: { op: "set", data: legacy, baseHash: "h", baseData: legacy },
    };
    for (let i = 0; i < 50; i++) {
      db.run(
        "INSERT INTO content_publishes (id, created_at, actor_account_id, actor_name, summary, changes, hash) VALUES (?, 'then', 'a', 'A', '', ?, 'h')",
        [`p${i}`, JSON.stringify([change])],
      );
    }
    const t0 = performance.now();
    runMigrations(db, all);
    expect(performance.now() - t0).toBeLessThan(5000);
    const one = db.query("SELECT changes FROM content_publishes WHERE id = 'p49'").get() as {
      changes: string;
    };
    expect(one.changes).not.toContain('"expr"');
  });
});
