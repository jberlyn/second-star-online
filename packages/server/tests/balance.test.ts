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
      vehicles: BALANCE_DEFAULTS.vehicles,
      cannon: BALANCE_DEFAULTS.cannon,
      hulls: BALANCE_DEFAULTS.hulls,
    });
  });

  test("a world that leaves the dataset or a part out plays the defaults for it", () => {
    const d = structuredClone(classicData) as ContentData;
    d.balance = { hulls: [{ vehicle: "Airship", hull: 999 }] };
    const store = buildContentStore(d);
    expect(store.balance.hulls).toEqual([
      { vehicle: "Boat", hull: 60 },
      { vehicle: "Airship", hull: 999 },
      { vehicle: "Battleship", hull: 150 },
    ]);
    expect(store.balance.vehicles).toEqual(BALANCE_DEFAULTS.vehicles);
    expect(store.balance.cannon).toEqual(BALANCE_DEFAULTS.cannon);
  });

  test("values outside their limits, and a vehicle given two hulls, are refused by the schema", () => {
    const bad = [
      { vehicles: { hullHit: -1, repairPerMinute: 1 } },
      { vehicles: { hullHit: 2, repairPerMinute: 100_001 } },
      { cannon: { damage: { flat: 10_001, randomN: 3 }, reloadFrames: 100 } },
      { cannon: { damage: { flat: 13, randomN: 1001 }, reloadFrames: 100 } },
      { cannon: { damage: { flat: 13, randomN: 3 }, reloadFrames: 0 } },
      { cannon: { damage: { flat: 13, randomN: 3 }, reloadFrames: 72_001 } },
      { hulls: [{ vehicle: "Boat", hull: 0 }] },
      { hulls: [{ vehicle: "Car", hull: 10 }] },
      {
        hulls: [
          { vehicle: "Boat", hull: 10 },
          { vehicle: "Boat", hull: 20 },
        ],
      },
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
      hulls: [{ vehicle: "Boat", hull: 33 }],
    };
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
      // Pack 1.0 (today's Classic): the operator overrides the Boat and Airship hulls.
      const s1 = service(RELEASE_PACK_DIRS);
      for (const [vehicle, hull] of [
        ["Boat", 70],
        ["Airship", 90],
      ] as const) {
        expect(
          s1.draftSet(ADMIN, { dataset: "balance", part: "hulls", key: vehicle }, "set", {
            vehicle,
            hull,
          }).ok,
        ).toBe(true);
      }
      expect(s1.publish(ADMIN, s1.draftRev(), "").ok).toBe(true);
      expect(s1.notices()).toEqual([]);
      // The next pack version changes only the Boat's hull (60 → 65).
      cpSync(RELEASE_PACK_DIRS.classic as string, dir, { recursive: true });
      const file = join(dir, "data", "balance.json");
      const balance = JSON.parse(readFileSync(file, "utf8"));
      balance.hulls = balance.hulls.map((h: { vehicle: string; hull: number }) =>
        h.vehicle === "Boat" ? { ...h, hull: 65 } : h,
      );
      writeFileSync(file, JSON.stringify(balance));
      const m = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
      writeFileSync(join(dir, "manifest.json"), JSON.stringify({ ...m, version: "9.9.9" }));
      const s2 = service({ ...RELEASE_PACK_DIRS, classic: dir });
      // Only the Boat's row: the Airship's pack value did not change.
      expect(s2.notices().map((n) => [n.dataset, n.part, n.key, n.packVersion])).toEqual([
        ["balance", "hulls", "Boat", "9.9.9"],
      ]);
      expect(s2.notices()[0]?.now).toEqual({ vehicle: "Boat", hull: 65 });
      // The operator's values still play until answered.
      expect(hullMax("Boat")).toBe(70);
      expect(hullMax("Airship")).toBe(90);
      // Accept: the pack's new value plays at once; undo brings the operator's back.
      const boat = { dataset: "balance" as const, part: "hulls", key: "Boat" };
      const accepted = s2.acceptNotice(ADMIN, boat);
      expect(accepted.ok).toBe(true);
      expect(hullMax("Boat")).toBe(65);
      expect(hullMax("Airship")).toBe(90);
      expect(s2.notices()).toEqual([]);
      expect(s2.undo(ADMIN, accepted.ok ? accepted.value.id : "").ok).toBe(true);
      expect(hullMax("Boat")).toBe(70);
      // Back to waiting; dismiss keeps the operator's value and the notice goes.
      expect(s2.notices().map((n) => n.key)).toEqual(["Boat"]);
      expect(s2.dismissNotice(ADMIN, boat).ok).toBe(true);
      expect(s2.notices()).toEqual([]);
      expect(hullMax("Boat")).toBe(70);
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
      expect(view.groups.map((g) => g.id)).toEqual(["spells", "buffs", "vitals", "vehicles"]);
      expect(view.groups[3]?.rows.map((r) => `${r.part}/${r.key ?? ""}`)).toEqual([
        "hulls/Boat",
        "hulls/Airship",
        "hulls/Battleship",
        "vehicles/",
        "cannon/",
      ]);
      const boat = row(server, "hulls", "Boat");
      expect(boat).toMatchObject({
        engine: { vehicle: "Boat", hull: 60 },
        pack: { vehicle: "Boat", hull: 60 },
        published: { vehicle: "Boat", hull: 60 },
        draft: { vehicle: "Boat", hull: 60 },
        edited: false,
        pending: null,
        notice: null,
      });
      expect(boat.fields).toEqual([
        expect.objectContaining({ path: ["hull"], min: 1, max: 100_000 }),
      ]);
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
      const boat = row(server, "hulls", "Boat");
      const r = server.content.draftBalance(ADMIN, {
        part: "hulls",
        key: "Boat",
        op: "set",
        data: { vehicle: "Boat", hull: 90 },
        expect: boat.fingerprint,
      });
      expect(r).toEqual({ ok: true, value: "Boat hull is in the draft." });
      expect(row(server, "hulls", "Boat")).toMatchObject({
        published: { hull: 60 },
        draft: { hull: 90 },
        pending: "set",
      });
      // The draft is the content store's: the Content page lists it and publishes it.
      expect(server.content.draft().map((d) => `${d.dataset}/${d.part}/${d.key}`)).toEqual([
        "balance/hulls/Boat",
      ]);
      expect(hullMax("Boat")).toBe(60);
      expect(server.content.publish(ADMIN, server.content.draftRev(), "Tougher boats").ok).toBe(
        true,
      );
      expect(hullMax("Boat")).toBe(90);
      expect(content().balance.hulls[0]).toEqual({ vehicle: "Boat", hull: 90 });
      expect(row(server, "hulls", "Boat")).toMatchObject({
        published: { hull: 90 },
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
      const set = (hull: number) =>
        server.content.draftBalance(ADMIN, {
          part: "hulls",
          key: "Airship",
          op: "set",
          data: { vehicle: "Airship", hull },
          expect: row(server, "hulls", "Airship").fingerprint,
        });
      expect(set(10).ok).toBe(true);
      // Discard: the draft's change goes.
      expect(
        server.content.draftBalance(ADMIN, {
          part: "hulls",
          key: "Airship",
          op: "discard",
          data: null,
          expect: row(server, "hulls", "Airship").fingerprint,
        }),
      ).toEqual({ ok: true, value: "Airship hull: the draft's change is gone." });
      expect(server.content.draft()).toEqual([]);
      // Published, then reset: the revert waits in the draft until it is published.
      expect(set(10).ok).toBe(true);
      expect(server.content.publish(ADMIN, server.content.draftRev(), "").ok).toBe(true);
      expect(hullMax("Airship")).toBe(10);
      expect(
        server.content.draftBalance(ADMIN, {
          part: "hulls",
          key: "Airship",
          op: "revert",
          data: null,
          expect: row(server, "hulls", "Airship").fingerprint,
        }),
      ).toEqual({ ok: true, value: "Airship hull goes back to the pack's value when published." });
      expect(row(server, "hulls", "Airship")).toMatchObject({
        pending: "revert",
        draft: { hull: 80 },
      });
      expect(server.content.publish(ADMIN, server.content.draftRev(), "").ok).toBe(true);
      expect(hullMax("Airship")).toBe(80);
      expect(row(server, "hulls", "Airship").edited).toBe(false);
      // Undo brings the change back, as for any content publish.
      const last = server.content.history()[0];
      expect(last && server.content.undo(ADMIN, last.id).ok).toBe(true);
      expect(hullMax("Airship")).toBe(10);
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
        value: "Battleship cannon goes back to the engine's default when published.",
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
      const set = (hull: number) =>
        server.content.draftBalance(ADMIN, {
          part: "hulls",
          key: "Boat",
          op: "set",
          data: { hull, vehicle: "Boat" },
          expect: row(server, "hulls", "Boat").fingerprint,
        });
      expect(set(70).ok).toBe(true);
      expect(row(server, "hulls", "Boat").pending).toBe("set");
      // Back to the 60 that plays (written in another key order): the draft change goes.
      expect(set(60)).toEqual({ ok: true, value: "Boat hull is back to what plays now." });
      expect(server.content.draft()).toEqual([]);
      // With nothing in the draft, the same value is refused as no change.
      expect(set(60)).toMatchObject({ ok: false, error: "Boat hull already plays that value." });
      // No operator row came of it, so a pack update has nothing to notice.
      expect(row(server, "hulls", "Boat").edited).toBe(false);
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
      const ref = { dataset: "balance", part: "hulls", key: "Boat" };
      // The first operator opens the Boat row on the Content page.
      const opened = contentIntent(server.content, ADMIN, { t: "contentRow", seq: 1, ...ref });
      const revision = (opened as { row: { revision?: string } }).row.revision;
      expect(revision).toBe(row(server, "hulls", "Boat").fingerprint);
      // Another saves it from the Balance page meanwhile.
      expect(
        server.content.draftBalance(OTHER, {
          part: "hulls",
          key: "Boat",
          op: "set",
          data: { vehicle: "Boat", hull: 80 },
          expect: row(server, "hulls", "Boat").fingerprint,
        }).ok,
      ).toBe(true);
      // The first one's stale save, discard and revert are refused; so is one naming no revision.
      const draft = (seq: number, expect?: string) =>
        contentIntent(server.content, ADMIN, {
          t: "contentDraft",
          seq,
          ...ref,
          op: "set",
          data: { vehicle: "Boat", hull: 70 },
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
      expect(row(server, "hulls", "Boat").draft).toEqual({ vehicle: "Boat", hull: 80 });
      // Opened again, it saves; the draft list carries the revision its Discard sends.
      const again = contentIntent(server.content, ADMIN, { t: "contentRow", seq: 6, ...ref }) as {
        row: { revision?: string };
      };
      expect(draft(7, again.row.revision)).toMatchObject({ ok: true });
      const listed = server.content.balanceRevision({
        dataset: "balance",
        part: "hulls",
        key: "Boat",
      });
      const overview = contentIntent(server.content, ADMIN, { t: "contentOverview", seq: 8 }) as {
        overview: { draft: { part: string; key: string | null; revision?: string }[] };
      };
      expect(overview.overview.draft.find((d) => d.key === "Boat")?.revision).toBe(listed ?? "");
      expect(
        contentIntent(server.content, ADMIN, {
          t: "contentDiscard",
          seq: 9,
          ...ref,
          expect: listed ?? "",
        }),
      ).toMatchObject({ ok: true });
      // Rows of other datasets name no revision, as before.
      const items = contentIntent(server.content, ADMIN, {
        t: "contentRow",
        seq: 10,
        dataset: "items",
        part: "items",
        key: "Apple",
      }) as { row: { revision?: string } };
      expect(items.row.revision).toBeUndefined();
    } finally {
      await server.stop();
    }
  });

  test("a pack update to a row the operator changed shows on its row", async () => {
    const server = start();
    try {
      expect(
        server.content.draftBalance(ADMIN, {
          part: "hulls",
          key: "Boat",
          op: "set",
          data: { vehicle: "Boat", hull: 70 },
          expect: row(server, "hulls", "Boat").fingerprint,
        }).ok,
      ).toBe(true);
      expect(server.content.publish(ADMIN, server.content.draftRev(), "").ok).toBe(true);
      // The operator row was based on the pack's 60; pretend the pack has since shipped 65.
      server.db
        .query(
          "UPDATE content_rows SET base_hash = 'ffffffffffffffff' WHERE dataset = 'balance' AND part = 'hulls'",
        )
        .run();
      expect(row(server, "hulls", "Boat").notice).toMatchObject({
        packName: "Classic",
        now: { vehicle: "Boat", hull: 60 },
      });
    } finally {
      await server.stop();
    }
  });
});
