/**
 * The Balance page on the server (issue #19, stage 1; spell amounts, buffs, regeneration, hunger
 * and death in balance-spells.test.ts): the `balance` dataset's rows with their
 * engine default, pack value and current value; changes go into the shared draft, refused when
 * the row changed since the page showed it or a value is outside its limits; a publish takes
 * effect at once with no restart; reverting brings the pack's value (or the engine's default)
 * back; a Minimal world plays the engine's defaults.
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { classicData } from "@secondstaronline/data/classic";
import { RELEASE_PACK_DIRS } from "@secondstaronline/data/packs";
import { balanceDataSchema } from "@secondstaronline/data/schema";
import {
  BALANCE_DEFAULTS,
  type BalanceRowView,
  buildContentStore,
  type ContentData,
  cannonDamage,
  cannonReloadFrames,
  content,
  fullBalance,
  hullHitDamage,
  hullMax,
  hullRepairPerMinute,
  installContent,
} from "@secondstaronline/shared";

import { contentIntent } from "../src/content/page.ts";
import { type ContentActor, ContentService } from "../src/content/service.ts";
import { type RunningServer, startServer } from "../src/main.ts";
import { openDatabase } from "../src/persistence/database.ts";
import { migrate } from "../src/persistence/migrations.ts";
import { manualClock } from "./helpers/manual-clock.ts";

const ADMIN: ContentActor = { accountId: "acc-admin", name: "Admin" };
const OTHER: ContentActor = { accountId: "acc-other", name: "Other" };

describe("the balance dataset and its defaults", () => {
  test("Classic's balance.json is exactly the engine's defaults (1.6's values and SSO's for its additions)", () => {
    expect(fullBalance(classicData.balance)).toEqual(fullBalance(undefined));
    expect(classicData.balance).toEqual({
      spellEffects: BALANCE_DEFAULTS.spellEffects,
      spellHits: BALANCE_DEFAULTS.spellHits,
      buffs: BALANCE_DEFAULTS.buffs,
      castPower: BALANCE_DEFAULTS.castPower,
      regen: BALANCE_DEFAULTS.regen,
      hunger: BALANCE_DEFAULTS.hunger,
      death: BALANCE_DEFAULTS.death,
      drops: BALANCE_DEFAULTS.drops,
      timings: BALANCE_DEFAULTS.timings,
      combat: BALANCE_DEFAULTS.combat,
      monsters: BALANCE_DEFAULTS.monsters,
      vehicles: BALANCE_DEFAULTS.vehicles,
      cannon: BALANCE_DEFAULTS.cannon,
      killXp: BALANCE_DEFAULTS.killXp,
      levels: BALANCE_DEFAULTS.levels,
    });
  });

  test("a world that leaves the dataset or a part out plays the defaults for it", () => {
    const d = structuredClone(classicData) as ContentData;
    d.balance = { cannon: { damage: { flat: 20, randomN: 0 }, reloadFrames: 40 } };
    const store = buildContentStore(d);
    expect(store.balance.cannon).toEqual({ damage: { flat: 20, randomN: 0 }, reloadFrames: 40 });
    expect(store.balance.vehicles).toEqual(BALANCE_DEFAULTS.vehicles);
    expect(store.balance.regen).toEqual(BALANCE_DEFAULTS.regen);
  });

  test("values outside their limits, and hull rows (now each vehicle's own), are refused by the schema", () => {
    const bad = [
      { vehicles: { hullHit: -1, repairPerMinute: 1 } },
      { vehicles: { hullHit: 2, repairPerMinute: 100_001 } },
      { cannon: { damage: { flat: 10_001, randomN: 3 }, reloadFrames: 100 } },
      { cannon: { damage: { flat: 13, randomN: 1001 }, reloadFrames: 100 } },
      { cannon: { damage: { flat: 13, randomN: 3 }, reloadFrames: 0 } },
      { cannon: { damage: { flat: 13, randomN: 3 }, reloadFrames: 72_001 } },
      // A vehicle's full hull is its `houses.vehicles` row's (issue #44).
      { hulls: [{ vehicle: "Boat", hull: 60 }] },
      { vehicles: { hullHit: 2.5, repairPerMinute: 1 } },
      { other: 1 },
    ];
    for (const b of bad) {
      expect(balanceDataSchema.safeParse(b).success).toBe(false);
    }
    expect(balanceDataSchema.safeParse({}).success).toBe(true);
  });

  test("the engine reads the installed store's balance", () => {
    const d = structuredClone(classicData) as ContentData;
    d.balance = {
      vehicles: { hullHit: 7, repairPerMinute: 4 },
      cannon: { damage: { flat: 20, randomN: 0 }, reloadFrames: 40 },
    };
    // The full hull is the vehicle row's (issue #44).
    for (const v of d.houses.vehicles ?? []) {
      if (v.name === "Boat") {
        v.hull = 33;
      }
    }
    try {
      installContent(buildContentStore(d));
      expect(hullMax("Boat")).toBe(33);
      expect(hullHitDamage()).toBe(7);
      expect(hullRepairPerMinute()).toBe(4);
      expect(cannonReloadFrames()).toBe(40);
      // randomN 0 rolls nothing: no draw at all.
      const draws: number[] = [];
      expect(
        cannonDamage({
          random: (n) => {
            draws.push(n);
            return 1;
          },
        }),
      ).toBe(20);
      expect(draws).toEqual([]);
    } finally {
      installContent(buildContentStore(classicData as ContentData));
    }
  });
});

describe("a pack update to balance rows (issue #19)", () => {
  test("only the row the new pack changed gets a notice; accept and dismiss work, live", () => {
    const db = openDatabase();
    migrate(db);
    let t = 0;
    const service = (packs: Record<string, string>) =>
      new ContentService({
        db,
        now: () => new Date(Date.UTC(2026, 10, 24, 0, 0, t++)).toISOString(),
        releasePacks: packs,
        onPublish: (s) => installContent(s),
      });
    const dir = mkdtempSync(join(tmpdir(), "sso-balance-pack-"));
    try {
      // Pack 1.0 (today's Classic): the operator overrides the cannon and the hull wear.
      const s1 = service(RELEASE_PACK_DIRS);
      expect(
        s1.draftSet(ADMIN, { dataset: "balance", part: "cannon", key: null }, "set", {
          damage: { flat: 13, randomN: 3 },
          reloadFrames: 70,
        }).ok,
      ).toBe(true);
      expect(
        s1.draftSet(ADMIN, { dataset: "balance", part: "vehicles", key: null }, "set", {
          hullHit: 9,
          repairPerMinute: 1,
        }).ok,
      ).toBe(true);
      expect(s1.publish(ADMIN, s1.draftRev(), "").ok).toBe(true);
      expect(s1.notices()).toEqual([]);
      // The next pack version changes only the cannon's reload (100 → 65).
      cpSync(RELEASE_PACK_DIRS.classic as string, dir, { recursive: true });
      const file = join(dir, "data", "balance.json");
      const balance = JSON.parse(readFileSync(file, "utf8"));
      balance.cannon = { ...balance.cannon, reloadFrames: 65 };
      writeFileSync(file, JSON.stringify(balance));
      const m = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
      writeFileSync(join(dir, "manifest.json"), JSON.stringify({ ...m, version: "9.9.9" }));
      const s2 = service({ ...RELEASE_PACK_DIRS, classic: dir });
      // Only the cannon's row: the hull wear's pack value did not change.
      expect(s2.notices().map((n) => [n.dataset, n.part, n.key, n.packVersion])).toEqual([
        ["balance", "cannon", null, "9.9.9"],
      ]);
      expect(s2.notices()[0]?.now).toEqual({ damage: { flat: 13, randomN: 3 }, reloadFrames: 65 });
      // The operator's values still play until answered.
      expect(cannonReloadFrames()).toBe(70);
      expect(hullHitDamage()).toBe(9);
      // Accept: the pack's new value plays at once; undo brings the operator's back.
      const cannon = { dataset: "balance" as const, part: "cannon", key: null };
      const accepted = s2.acceptNotice(ADMIN, cannon);
      expect(accepted.ok).toBe(true);
      expect(cannonReloadFrames()).toBe(65);
      expect(hullHitDamage()).toBe(9);
      expect(s2.notices()).toEqual([]);
      expect(s2.undo(ADMIN, accepted.ok ? accepted.value.id : "").ok).toBe(true);
      expect(cannonReloadFrames()).toBe(70);
      // Back to waiting; dismiss keeps the operator's value and the notice goes.
      expect(s2.notices().map((n) => n.part)).toEqual(["cannon"]);
      expect(s2.dismissNotice(ADMIN, cannon).ok).toBe(true);
      expect(s2.notices()).toEqual([]);
      expect(cannonReloadFrames()).toBe(70);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      installContent(buildContentStore(classicData as ContentData));
    }
  });
});

describe("the Balance page on a running server", () => {
  const dirs: string[] = [];
  let logSpy: ReturnType<typeof spyOn> | null = null;
  beforeEach(() => {
    logSpy = spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy?.mockRestore();
    for (const d of dirs.splice(0)) {
      rmSync(d, { recursive: true, force: true });
    }
  });

  function start(pack?: "minimal"): RunningServer {
    const dir = mkdtempSync(join(tmpdir(), "sso-balance-"));
    dirs.push(dir);
    const clientDir = join(dir, "client");
    mkdirSync(clientDir);
    writeFileSync(join(clientDir, "index.html"), "<!doctype html><title>x</title>");
    const server = startServer({
      dbPath: join(dir, "world.sqlite"),
      port: 0,
      development: false,
      clientDir,
      clock: manualClock(),
      autoTick: false,
      isoNow: () => "2026-11-24T00:00:00.000Z",
      rng: { random: (n) => (n >= 1 ? 1 : 0) },
      onLag: () => {},
      ...(pack ? { content: pack } : {}),
    });
    for (const a of [ADMIN, OTHER]) {
      server.db
        .query(
          "INSERT OR IGNORE INTO accounts (id, username, password_hash, role, created_at, updated_at) VALUES (?, ?, 'x', 'administrator', 'now', 'now')",
        )
        .run(a.accountId, a.name.toLowerCase());
    }
    return server;
  }

  const row = (s: RunningServer, part: string, key: string | null = null): BalanceRowView => {
    const r = s.content
      .balanceView()
      .groups.flatMap((g) => g.rows)
      .find((x) => x.part === part && x.key === key);
    if (!r) {
      throw new Error(`no row ${part}/${key}`);
    }
    return r;
  };

  test("each row shows the engine default, the pack's value and what plays, as Classic sets them", async () => {
    const server = start();
    try {
      const view = server.content.balanceView();
      expect(view.groups.map((g) => g.id)).toEqual([
        "spells",
        "buffs",
        "vitals",
        "drops",
        "levels",
        "timings",
        "combat",
        "monsters",
        "vehicles",
      ]);
      expect(
        view.groups.find((g) => g.id === "vehicles")?.rows.map((r) => `${r.part}/${r.key ?? ""}`),
      ).toEqual(["vehicles/", "cannon/"]);
      // Each vehicle's full hull is its own row's, named on the card (issue #44).
      expect(view.groups.find((g) => g.id === "vehicles")?.elsewhere).toEqual([
        {
          label: "Boat hull",
          row: { dataset: "houses", part: "vehicles", key: "Boat" },
          now: "full hull 60",
        },
        {
          label: "Battleship hull",
          row: { dataset: "houses", part: "vehicles", key: "Battleship" },
          now: "full hull 150",
        },
        {
          label: "Airship hull",
          row: { dataset: "houses", part: "vehicles", key: "Airship" },
          now: "full hull 80",
        },
      ]);
      const cannon = row(server, "cannon");
      expect(cannon).toMatchObject({
        engine: BALANCE_DEFAULTS.cannon,
        pack: BALANCE_DEFAULTS.cannon,
        published: BALANCE_DEFAULTS.cannon,
        draft: BALANCE_DEFAULTS.cannon,
        edited: false,
        pending: null,
        notice: null,
      });
      expect(row(server, "cannon").fields.map((f) => f.path.join("."))).toEqual([
        "damage.flat",
        "damage.randomN",
        "reloadFrames",
      ]);
    } finally {
      await server.stop();
    }
  });

  test("a change goes into the shared draft, and a publish makes it play at once", async () => {
    const server = start();
    try {
      const cannon = row(server, "cannon");
      const r = server.content.draftBalance(ADMIN, {
        part: "cannon",
        key: null,
        op: "set",
        data: { damage: { flat: 13, randomN: 3 }, reloadFrames: 90 },
        expect: cannon.fingerprint,
      });
      expect(r).toEqual({ ok: true, value: "Cannon is in the draft." });
      expect(row(server, "cannon")).toMatchObject({
        published: { reloadFrames: 100 },
        draft: { reloadFrames: 90 },
        pending: "set",
      });
      // The draft is the content store's: the Content page lists it and publishes it.
      expect(server.content.draft().map((d) => `${d.dataset}/${d.part}/${d.key}`)).toEqual([
        "balance/cannon/null",
      ]);
      expect(cannonReloadFrames()).toBe(100);
      expect(server.content.publish(ADMIN, server.content.draftRev(), "Faster cannons").ok).toBe(
        true,
      );
      expect(cannonReloadFrames()).toBe(90);
      expect(content().balance.cannon.reloadFrames).toBe(90);
      expect(row(server, "cannon")).toMatchObject({
        published: { reloadFrames: 90 },
        edited: true,
        pending: null,
      });
    } finally {
      await server.stop();
    }
  });

  test("a save over a row someone changed since is refused, and so is a value outside its limits", async () => {
    const server = start();
    try {
      const seen = row(server, "vehicles").fingerprint;
      expect(
        server.content.draftBalance(OTHER, {
          part: "vehicles",
          key: null,
          op: "set",
          data: { hullHit: 3, repairPerMinute: 1 },
          expect: seen,
        }).ok,
      ).toBe(true);
      const stale = server.content.draftBalance(ADMIN, {
        part: "vehicles",
        key: null,
        op: "set",
        data: { hullHit: 9, repairPerMinute: 1 },
        expect: seen,
      });
      expect(stale).toEqual({
        ok: false,
        error: "Hull wear and repair changed since you opened it: look at it again before saving.",
      });
      expect(row(server, "vehicles").draft).toEqual({ hullHit: 3, repairPerMinute: 1 });
      const tooBig = server.content.draftBalance(ADMIN, {
        part: "vehicles",
        key: null,
        op: "set",
        data: { hullHit: 3, repairPerMinute: 100_001 },
        expect: row(server, "vehicles").fingerprint,
      });
      expect(tooBig.ok).toBe(false);
      // Named by the page's field, not the dataset's path.
      expect(tooBig.ok ? [] : (tooBig.problems ?? []).map((p) => p.where)).toEqual([
        "Hull mended each minute parked",
      ]);
      // A row the page does not edit is refused, whatever it is.
      expect(
        server.content.draftBalance(ADMIN, {
          part: "hulls",
          key: "Car",
          op: "set",
          data: { vehicle: "Car", hull: 5 },
          expect: "0".repeat(16),
        }),
      ).toEqual({ ok: false, error: "the Balance page has no row hulls/Car" });
    } finally {
      await server.stop();
    }
  });

  test("reset brings the pack's value back (on publish), and discard drops a draft change", async () => {
    const server = start();
    try {
      const set = (reloadFrames: number) =>
        server.content.draftBalance(ADMIN, {
          part: "cannon",
          key: null,
          op: "set",
          data: { damage: { flat: 13, randomN: 3 }, reloadFrames },
          expect: row(server, "cannon").fingerprint,
        });
      expect(set(10).ok).toBe(true);
      // Discard: the draft's change goes.
      expect(
        server.content.draftBalance(ADMIN, {
          part: "cannon",
          key: null,
          op: "discard",
          data: null,
          expect: row(server, "cannon").fingerprint,
        }),
      ).toEqual({ ok: true, value: "Cannon: the draft's change is gone." });
      expect(server.content.draft()).toEqual([]);
      // Published, then reset: the revert waits in the draft until it is published.
      expect(set(10).ok).toBe(true);
      expect(server.content.publish(ADMIN, server.content.draftRev(), "").ok).toBe(true);
      expect(cannonReloadFrames()).toBe(10);
      expect(
        server.content.draftBalance(ADMIN, {
          part: "cannon",
          key: null,
          op: "revert",
          data: null,
          expect: row(server, "cannon").fingerprint,
        }),
      ).toEqual({ ok: true, value: "Cannon goes back to the pack's value when published." });
      expect(row(server, "cannon")).toMatchObject({
        pending: "revert",
        draft: { reloadFrames: 100 },
      });
      expect(server.content.publish(ADMIN, server.content.draftRev(), "").ok).toBe(true);
      expect(cannonReloadFrames()).toBe(100);
      expect(row(server, "cannon").edited).toBe(false);
      // Undo brings the change back, as for any content publish.
      const last = server.content.history()[0];
      expect(last && server.content.undo(ADMIN, last.id).ok).toBe(true);
      expect(cannonReloadFrames()).toBe(10);
    } finally {
      await server.stop();
    }
  });

  test("a Minimal world has no balance rows of its own and plays the engine's defaults", async () => {
    const server = start("minimal");
    try {
      expect(content().balance).toEqual(fullBalance(undefined));
      const cannon = row(server, "cannon");
      expect(cannon.pack).toBeNull();
      expect(cannon.published).toEqual(BALANCE_DEFAULTS.cannon);
      const r = server.content.draftBalance(ADMIN, {
        part: "cannon",
        key: null,
        op: "set",
        data: { damage: { flat: 5, randomN: 0 }, reloadFrames: 20 },
        expect: cannon.fingerprint,
      });
      expect(r.ok).toBe(true);
      expect(server.content.publish(ADMIN, server.content.draftRev(), "").ok).toBe(true);
      expect(cannonReloadFrames()).toBe(20);
      expect(
        server.content.draftBalance(ADMIN, {
          part: "cannon",
          key: null,
          op: "revert",
          data: null,
          expect: row(server, "cannon").fingerprint,
        }),
      ).toEqual({
        ok: true,
        value: "Cannon goes back to the engine's default when published.",
      });
    } finally {
      await server.stop();
    }
  });

  test("the intents answer with the view, and a refusal with its reason", async () => {
    const server = start();
    try {
      const asked = contentIntent(server.content, ADMIN, { t: "contentBalance", seq: 4 });
      expect(asked).toMatchObject({ t: "contentBalance", seq: 4 });
      const refused = contentIntent(server.content, ADMIN, {
        t: "contentBalanceSet",
        seq: 5,
        part: "vehicles",
        key: null,
        op: "set",
        data: { hullHit: 1, repairPerMinute: 1 },
        expect: "f".repeat(16),
      });
      expect(refused).toMatchObject({
        t: "contentBalance",
        seq: 5,
        result: { ok: false, text: expect.stringContaining("changed since you opened it") },
      });
    } finally {
      await server.stop();
    }
  });

  test("saving a row back to what plays drops its draft change instead of staging an override", async () => {
    const server = start();
    try {
      const set = (reloadFrames: number) =>
        server.content.draftBalance(ADMIN, {
          part: "cannon",
          key: null,
          op: "set",
          data: { reloadFrames, damage: { randomN: 3, flat: 13 } },
          expect: row(server, "cannon").fingerprint,
        });
      expect(set(70).ok).toBe(true);
      expect(row(server, "cannon").pending).toBe("set");
      // Back to the 100 that plays (written in another key order): the draft change goes.
      expect(set(100)).toEqual({ ok: true, value: "Cannon is back to what plays now." });
      expect(server.content.draft()).toEqual([]);
      // With nothing in the draft, the same value is refused as no change.
      expect(set(100)).toMatchObject({ ok: false, error: "Cannon already plays that value." });
      // No operator row came of it, so a pack update has nothing to notice.
      expect(row(server, "cannon").edited).toBe(false);
      // A Minimal-style row the pack does not set compares with the engine's default.
      expect(
        server.content.draftBalance(ADMIN, {
          part: "vehicles",
          key: null,
          op: "set",
          data: row(server, "vehicles").published,
          expect: row(server, "vehicles").fingerprint,
        }).ok,
      ).toBe(false);
    } finally {
      await server.stop();
    }
  });

  test("the Content page's JSON editor names the balance row's revision, so it cannot write over a Balance page save", async () => {
    const server = start();
    try {
      const ref = { dataset: "balance", part: "cannon", key: null };
      // The first operator opens the cannon row on the Content page.
      const opened = contentIntent(server.content, ADMIN, { t: "contentRow", seq: 1, ...ref });
      const revision = (opened as { row: { revision?: string } }).row.revision;
      expect(revision).toBe(row(server, "cannon").fingerprint);
      // Another saves it from the Balance page meanwhile.
      expect(
        server.content.draftBalance(OTHER, {
          part: "cannon",
          key: null,
          op: "set",
          data: { damage: { flat: 13, randomN: 3 }, reloadFrames: 80 },
          expect: row(server, "cannon").fingerprint,
        }).ok,
      ).toBe(true);
      // The first one's stale save, discard and revert are refused; so is one naming no revision.
      const draft = (seq: number, expect?: string) =>
        contentIntent(server.content, ADMIN, {
          t: "contentDraft",
          seq,
          ...ref,
          op: "set",
          data: { damage: { flat: 13, randomN: 3 }, reloadFrames: 70 },
          ...(expect ? { expect } : {}),
        });
      for (const r of [
        draft(2, revision),
        draft(3),
        contentIntent(server.content, ADMIN, {
          t: "contentDiscard",
          seq: 4,
          ...ref,
          expect: revision,
        }),
        contentIntent(server.content, ADMIN, {
          t: "contentDraft",
          seq: 5,
          ...ref,
          op: "revert",
          data: null,
          expect: revision,
        }),
      ]) {
        expect(r).toMatchObject({
          ok: false,
          text: expect.stringContaining("changed since you opened it"),
        });
      }
      expect(row(server, "cannon").draft).toEqual({
        damage: { flat: 13, randomN: 3 },
        reloadFrames: 80,
      });
      // Opened again, it saves; the draft list carries the revision its Discard sends.
      const again = contentIntent(server.content, ADMIN, { t: "contentRow", seq: 6, ...ref }) as {
        row: { revision?: string };
      };
      expect(draft(7, again.row.revision)).toMatchObject({ ok: true });
      const listed = server.content.balanceRevision({
        dataset: "balance",
        part: "cannon",
        key: null,
      });
      const overview = contentIntent(server.content, ADMIN, { t: "contentOverview", seq: 8 }) as {
        overview: { draft: { part: string; key: string | null; revision?: string }[] };
      };
      expect(overview.overview.draft.find((d) => d.part === "cannon")?.revision).toBe(listed ?? "");
      expect(
        contentIntent(server.content, ADMIN, {
          t: "contentDiscard",
          seq: 9,
          ...ref,
          expect: listed ?? "",
        }),
      ).toMatchObject({ ok: true });
      // Every other row names a plain revision too (the Control Panel's forms save with it), and
      // a change naming none is still taken (a script, a test).
      const spell = contentIntent(server.content, ADMIN, {
        t: "contentRow",
        seq: 10,
        dataset: "spells",
        part: "spells",
        key: "Firebolt",
      }) as {
        row: { revision?: string; published: Record<string, unknown>; schema?: unknown };
      };
      expect(spell.row.revision).toMatch(/^[0-9a-f]{16}$/);
      // The row carries its shape, for the Control Panel's form: one spell's fields.
      expect(spell.row.schema).toMatchObject({ type: "object", properties: { sp: {} } });
      const spellRef = { dataset: "spells", part: "spells", key: "Firebolt" };
      const changed = { ...spell.row.published, sp: 41 };
      expect(
        contentIntent(server.content, ADMIN, {
          t: "contentDraft",
          seq: 11,
          ...spellRef,
          op: "set",
          data: changed,
          expect: spell.row.revision ?? "",
        }),
      ).toMatchObject({ ok: true });
      // A form opened before that save is refused: the row changed since.
      expect(
        contentIntent(server.content, ADMIN, {
          t: "contentDraft",
          seq: 12,
          ...spellRef,
          op: "set",
          data: { ...changed, sp: 42 },
          expect: spell.row.revision ?? "",
        }),
      ).toMatchObject({ ok: false });
      expect(
        contentIntent(server.content, ADMIN, {
          t: "contentDraft",
          seq: 13,
          ...spellRef,
          op: "set",
          data: { ...changed, sp: 43 },
        }),
      ).toMatchObject({ ok: true });
    } finally {
      await server.stop();
    }
  });

  test("an optional section opens even when the world leaves it out, to be added back", async () => {
    const server = start();
    try {
      const open = (part: string) =>
        contentIntent(server.content, ADMIN, {
          t: "contentRow",
          seq: 1,
          dataset: "casino",
          part,
          key: null,
        }) as { row: { optional?: boolean; published: unknown; schema?: unknown } | null };
      expect(open("checkers").row?.optional).toBe(true);
      // A section every world needs is not optional.
      const casting = contentIntent(server.content, ADMIN, {
        t: "contentRow",
        seq: 2,
        dataset: "monsters",
        part: "rules",
        key: null,
      }) as { row: { optional?: boolean } };
      expect(casting.row.optional).toBeUndefined();
      // Turned off and published: the row still opens, empty, with its shape to add it back.
      expect(
        contentIntent(server.content, ADMIN, {
          t: "contentDraft",
          seq: 3,
          dataset: "casino",
          part: "checkers",
          key: null,
          op: "remove",
          data: null,
        }),
      ).toMatchObject({ ok: true });
      expect(server.content.publish(ADMIN, server.content.draftRev(), "").ok).toBe(true);
      const gone = open("checkers").row;
      expect(gone).toMatchObject({ optional: true, published: null });
      expect(gone?.schema).toMatchObject({ type: "object" });
    } finally {
      await server.stop();
    }
  });

  test("a pack update to a row the operator changed shows on its row", async () => {
    const server = start();
    try {
      expect(
        server.content.draftBalance(ADMIN, {
          part: "cannon",
          key: null,
          op: "set",
          data: { damage: { flat: 13, randomN: 3 }, reloadFrames: 70 },
          expect: row(server, "cannon").fingerprint,
        }).ok,
      ).toBe(true);
      expect(server.content.publish(ADMIN, server.content.draftRev(), "").ok).toBe(true);
      // The operator row was based on the pack's 100; pretend the pack has since shipped another.
      server.db
        .query(
          "UPDATE content_rows SET base_hash = 'ffffffffffffffff' WHERE dataset = 'balance' AND part = 'cannon'",
        )
        .run();
      expect(row(server, "cannon").notice).toMatchObject({
        packName: "Classic",
        now: BALANCE_DEFAULTS.cannon,
      });
    } finally {
      await server.stop();
    }
  });
});
