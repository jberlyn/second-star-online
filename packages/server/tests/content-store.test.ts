import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RELEASE_PACK_DIRS } from "@secondstaronline/data/packs";
import { EMPTY_ART } from "@secondstaronline/data/schema";
import {
  buildContentStore,
  type ContentData,
  type ContentStore,
  content,
  installContent,
} from "@secondstaronline/shared";

import { readPackDir } from "../src/content/packs.ts";
import { overviewOf, rowDetailOf } from "../src/content/page.ts";
import {
  applyRows,
  mergePacks,
  rowHash,
  rowsOf,
  rowValue,
  withOptionalDatasets,
} from "../src/content/rows.ts";
import { type ContentActor, ContentService } from "../src/content/service.ts";
import {
  badKeyForm,
  nameProblems,
  referenceProblems,
  skillProblems,
} from "../src/content/validate.ts";
import {
  contentRows,
  insertPack,
  installedPacks,
  upsertContentRow,
} from "../src/persistence/content.ts";
import { openDatabase } from "../src/persistence/database.ts";
import { migrate } from "../src/persistence/migrations.ts";
import { saveNpcFile } from "../src/persistence/npcfiles.ts";
import { parseDrop } from "../src/systems/admin/drop.ts";
import { VAULT_TEXT } from "../src/systems/economy/vault.ts";
import { groundView, inventoryView } from "../src/systems/world/world.ts";
import { player, testMap } from "./helpers/sim.ts";

const ADMIN: ContentActor = { accountId: "acc-admin", name: "Admin" };
const OTHER: ContentActor = { accountId: "acc-other", name: "Other" };

function setup(opts: { releasePacks?: Record<string, string> } = {}) {
  const db = openDatabase();
  migrate(db);
  let t = 0;
  const published: ContentStore[] = [];
  const service = new ContentService({
    db,
    now: () => new Date(Date.UTC(2026, 10, 22, 0, 0, t++)).toISOString(),
    releasePacks: opts.releasePacks ?? RELEASE_PACK_DIRS,
    onPublish: (s) => published.push(s),
  });
  return { db, service, published };
}

/** The draft's revision as the admin last saw it (what Publish sends). */
const seen = (service: ContentService) => service.draftRev();

const classic = readPackDir(RELEASE_PACK_DIRS.classic as string);

describe("the Classic pack", () => {
  test("loads every dataset and matches its schemas", () => {
    expect(classic.manifest.id).toBe("classic");
    // Every dataset but the uploaded art, which Classic leaves out (its art is its atlases).
    expect(Object.keys(classic.data).sort()).toHaveLength(17);
    expect(classic.data.art).toBeUndefined();
  });

  test("a server with only Classic installed builds the Classic store unchanged", () => {
    const { service, db } = setup();
    expect(service.publishedContent()).toEqual(withOptionalDatasets(classic.data) as never);
    expect(service.publishedContent().art).toEqual(EMPTY_ART);
    expect(installedPacks(db)[0]?.version).toBe(classic.manifest.version);
    expect(service.store().hash).toBe(service.clientCopy().hash);
  });

  test("the client copy leaves out the server-only datasets", () => {
    const { service } = setup();
    const body = JSON.parse(service.clientCopy().json) as { data: Record<string, unknown> };
    expect(body.data.npcFiles).toBeUndefined();
    expect(body.data.rects).toBeUndefined();
    expect(body.data.items).toBeDefined();
  });
});

describe("rows", () => {
  test("keyed lists are rows by key; other fields are one row each", () => {
    const rows = rowsOf({ casino: classic.data.casino, items: classic.data.items });
    expect(rows.find((r) => r.dataset === "items" && r.key === "Ale")?.part).toBe("items");
    expect(rows.find((r) => r.dataset === "casino" && r.part === "blackjack")?.key).toBeNull();
    expect(rows.filter((r) => r.dataset === "items" && r.part === "items")).toHaveLength(
      classic.data.items?.items.length as number,
    );
  });

  test("a set replaces a row where it stands, a new key appends, a remove drops it", () => {
    const items = classic.data.items as NonNullable<typeof classic.data.items>;
    const next = applyRows({ items }, [
      { dataset: "items", part: "items", key: "ale", op: "set", data: { name: "Ale", icon: null } },
      {
        dataset: "items",
        part: "items",
        key: "Moonblade",
        op: "set",
        data: { name: "Moonblade", icon: null },
      },
      { dataset: "items", part: "items", key: "Adventurer's Head", op: "remove", data: null },
    ]);
    const names = next.items?.items.map((i) => i.name) ?? [];
    expect(names.at(-1)).toBe("Moonblade");
    expect(names).not.toContain("Adventurer's Head");
    expect(names.indexOf("Ale")).toBe(items.items.findIndex((i) => i.name === "Ale") - 1);
    expect(next.items?.items.find((i) => i.name === "Ale")?.icon).toBeNull();
    // The pack's rows are never edited in place.
    expect(items.items.find((i) => i.name === "Ale")?.icon).not.toBeNull();
  });

  test("a later pack's rows replace an earlier pack's and add new keys", () => {
    const later = {
      casino: {
        ...classic.data.casino,
        slots: { ...classic.data.casino?.slots, cost: 99 },
      } as never,
      items: { ...classic.data.items, items: [{ name: "Moonblade", icon: null }] } as never,
    };
    const merged = mergePacks([classic.data, later]);
    expect(merged.casino?.slots?.cost).toBe(99);
    expect(merged.items?.items.at(-1)?.name).toBe("Moonblade");
    expect(merged.items?.items.length).toBe((classic.data.items?.items.length ?? 0) + 1);
  });

  test("row hashes ignore key order", () => {
    expect(rowHash({ a: 1, b: [1, 2] })).toBe(rowHash({ b: [1, 2], a: 1 }));
    expect(rowHash({ a: 1 })).not.toBe(rowHash({ a: 2 }));
  });
});

describe("the key and name rules", () => {
  test("new keys may not use the forms that carry state in stored names", () => {
    expect(badKeyForm("Moonblade")).toBeNull();
    expect(badKeyForm("Bag#2")).not.toBeNull();
    expect(badKeyForm("15 Gold")).not.toBeNull();
    expect(badKeyForm("Sword+2")).not.toBeNull();
  });

  test("display names are unique ignoring case and may not be another entry's key", () => {
    const packKeys = new Set(["ale", "mead"]);
    expect(
      nameProblems("items", [{ name: "Ale" }, { name: "Mead", display: "ALE" }], packKeys),
    ).toHaveLength(2);
    expect(
      nameProblems("items", [{ name: "Ale", display: "Brown Ale" }, { name: "Mead" }], packKeys),
    ).toEqual([]);
  });
});

describe("draft and publish", () => {
  test("a published edit changes the store, and the publish swaps it in", () => {
    const { service, published } = setup();
    const slots = { ...service.publishedContent().casino.slots, cost: 25 };
    expect(
      service.draftSet(ADMIN, { dataset: "casino", part: "slots", key: null }, "set", slots),
    ).toEqual({
      ok: true,
      value: undefined,
    });
    // The draft is not live until it is published.
    expect(service.store().casino.slots!.cost).not.toBe(25);
    expect(service.draft()[0]?.author).toBe("Admin");
    const r = service.publish(ADMIN, seen(service), "Cheaper slots");
    expect(r.ok).toBe(true);
    expect(service.store().casino.slots!.cost).toBe(25);
    expect(published).toHaveLength(1);
    expect(published[0]?.casino.slots?.cost).toBe(25);
    expect(service.draft()).toEqual([]);
    expect(service.history()[0]?.summary).toBe("Cheaper slots");
  });

  test("an edit that breaks the schema is refused when it is drafted", () => {
    const { service } = setup();
    const r = service.draftSet(ADMIN, { dataset: "casino", part: "slots", key: null }, "set", {
      cost: "free",
    });
    expect(r.ok).toBe(false);
    expect(service.draft()).toEqual([]);
  });

  test("an added item gets its creation name as its key, and the key never changes", () => {
    const { service } = setup();
    const ref = { dataset: "items" as const, part: "items", key: "Moonblade" };
    expect(service.draftSet(ADMIN, ref, "set", { name: "Moonblade", icon: null }).ok).toBe(true);
    expect(service.publish(ADMIN, seen(service), "").ok).toBe(true);
    expect(service.store().item("moonblade")?.name).toBe("Moonblade");
    const renamed = service.draftSet(ADMIN, ref, "set", { name: "Moonsword", icon: null });
    expect(renamed.ok).toBe(false);
    expect(
      service.draftSet(ADMIN, ref, "set", { name: "Moonblade", display: "Moonsword", icon: null })
        .ok,
    ).toBe(true);
  });

  test("the pre-publish checks refuse a broken reference and a duplicate display name", () => {
    const { service } = setup();
    // Ale is named by nothing the checks follow; Boat Deed is named by its deed row.
    expect(
      service.draftSet(ADMIN, { dataset: "items", part: "items", key: "Ale" }, "remove", null).ok,
    ).toBe(true);
    expect(
      service.draftSet(ADMIN, { dataset: "items", part: "items", key: "Boat Deed" }, "remove", null)
        .ok,
    ).toBe(true);
    const problems = service.check();
    expect(problems.some((p) => p.message.includes("Boat Deed"))).toBe(true);
    const r = service.publish(ADMIN, seen(service), "");
    expect(r.ok).toBe(false);
    expect(service.draft()).toHaveLength(2);
  });

  test("a new item may not take an engine fixture's name; a pack's Street Lamp stays", () => {
    const { service } = setup();
    for (const name of ["Hawks's Board", "Exit2", "Bob's Airship"]) {
      const ref = { dataset: "items" as const, part: "items", key: name };
      expect(service.draftSet(ADMIN, ref, "set", { name, icon: null }).ok).toBe(true);
    }
    const problems = service.check().map((p) => p.where);
    expect(problems).toEqual(
      expect.arrayContaining([
        "items/items/Hawks's Board",
        "items/items/Exit2",
        "items/items/Bob's Airship",
      ]),
    );
    expect(problems.some((w) => w.includes("Street Lamp"))).toBe(false);
    expect(service.publish(ADMIN, seen(service), "").ok).toBe(false);
  });

  test("one shared draft: a publish is refused when another admin changed the draft since", () => {
    const { service } = setup();
    const slots = { ...service.publishedContent().casino.slots, cost: 25 };
    service.draftSet(ADMIN, { dataset: "casino", part: "slots", key: null }, "set", slots);
    const mine = seen(service);
    service.draftSet(OTHER, { dataset: "casino", part: "slots", key: null }, "set", {
      ...slots,
      cost: 30,
    });
    expect(service.draft()[0]?.author).toBe("Other");
    const r = service.publish(ADMIN, mine, "");
    expect(r.ok).toBe(false);
    expect(service.store().casino.slots!.cost).not.toBe(30);
  });

  test("operator changes are stored per row with the pack row they were based on", () => {
    const { service, db } = setup();
    const slots = { ...service.publishedContent().casino.slots, cost: 25 };
    service.draftSet(ADMIN, { dataset: "casino", part: "slots", key: null }, "set", slots);
    service.publish(ADMIN, seen(service), "");
    const [row] = contentRows(db);
    expect(row).toMatchObject({ dataset: "casino", part: "slots", key: null, op: "set" });
    expect(row?.baseHash).toBe(rowHash(classic.data.casino?.slots));
  });

  test("the operator layer survives a restart", () => {
    const { service, db } = setup();
    const slots = { ...service.publishedContent().casino.slots, cost: 25 };
    service.draftSet(ADMIN, { dataset: "casino", part: "slots", key: null }, "set", slots);
    service.publish(ADMIN, seen(service), "");
    const again = new ContentService({ db, now: () => "x", releasePacks: RELEASE_PACK_DIRS });
    expect(again.store().casino.slots!.cost).toBe(25);
    expect(again.store().hash).toBe(service.store().hash);
  });

  test("revert drops the operator row, so the pack row shows again", () => {
    const { service } = setup();
    const ref = { dataset: "casino" as const, part: "slots", key: null };
    service.draftSet(ADMIN, ref, "set", { ...service.publishedContent().casino.slots, cost: 25 });
    service.publish(ADMIN, seen(service), "");
    expect(service.draftSet(ADMIN, ref, "revert", null).ok).toBe(true);
    service.publish(ADMIN, seen(service), "");
    expect(service.store().casino.slots).toEqual(classic.data.casino?.slots as never);
  });

  test("an optional section (a casino game) can be taken out, and put back by reverting", () => {
    const { service } = setup();
    const slots = { dataset: "casino" as const, part: "slots", key: null };
    expect(service.draftSet(ADMIN, slots, "remove", null)).toMatchObject({ ok: true });
    expect(service.check()).toEqual([]);
    const made = service.publish(ADMIN, service.draftRev(), "No slots");
    expect(made.ok).toBe(true);
    expect(service.publishedContent().casino.slots).toBeUndefined();
    expect(service.store().casino.slots).toBeUndefined();
    // Gone, it cannot be removed again; reverting brings the pack's back.
    expect(service.draftSet(ADMIN, slots, "remove", null).ok).toBe(false);
    expect(service.draftSet(ADMIN, slots, "revert", null)).toMatchObject({ ok: true });
    expect(service.publish(ADMIN, service.draftRev(), "Slots back").ok).toBe(true);
    expect(service.publishedContent().casino.slots).toEqual(classic.data.casino?.slots as never);
    // The Content page lists it either way.
    const { datasets } = overviewOf(service);
    expect(datasets.find((d) => d.id === "casino")?.parts.map((p) => p.part)).toEqual([
      "slots",
      "blackjack",
      "checkers",
    ]);
  });

  test("removing a keyed row drops it; only an optional section can be removed", () => {
    const { service } = setup();
    expect(
      service.draftSet(ADMIN, { dataset: "craft", part: "stations", key: null }, "remove", null).ok,
    ).toBe(false);
    expect(
      service.draftSet(ADMIN, { dataset: "help", part: "topics", key: "nope" }, "remove", null).ok,
    ).toBe(false);
    const topic = service.publishedContent().help.topics[0]?.file as string;
    expect(
      service.draftSet(ADMIN, { dataset: "help", part: "topics", key: topic }, "remove", null).ok,
    ).toBe(true);
    expect(service.publish(ADMIN, seen(service), "").ok).toBe(true);
    expect(service.store().help.topics.some((t) => t.file === topic)).toBe(false);
  });

  test("operator rows read from the database are checked against the same schemas at start-up", () => {
    const { db } = setup();
    upsertContentRow(db, {
      dataset: "casino",
      part: "slots",
      key: null,
      op: "set",
      data: { cost: "free" },
      baseHash: null,
      baseData: null,
      updatedBy: "x",
      updatedAt: "x",
    });
    expect(
      () => new ContentService({ db, now: () => "x", releasePacks: RELEASE_PACK_DIRS }),
    ).toThrow(/no longer match the schemas[\s\S]*casino\/slots/);
  });

  test("the collision rects cannot be changed", () => {
    const { service } = setup();
    expect(service.draftSet(ADMIN, { dataset: "rects", part: "fx", key: null }, "set", {}).ok).toBe(
      false,
    );
  });
});

describe("undo", () => {
  test("undoes a publish as a whole", () => {
    const { service } = setup();
    const before = service.store().hash;
    service.draftSet(ADMIN, { dataset: "casino", part: "slots", key: null }, "set", {
      ...service.publishedContent().casino.slots,
      cost: 25,
    });
    service.draftSet(ADMIN, { dataset: "items", part: "items", key: "Moonblade" }, "set", {
      name: "Moonblade",
      icon: null,
    });
    const p = service.publish(ADMIN, seen(service), "two");
    if (!p.ok) {
      throw new Error(p.error);
    }
    const u = service.undo(ADMIN, p.value.id);
    expect(u.ok).toBe(true);
    expect(service.store().hash).toBe(before);
    expect(service.store().item("Moonblade")).toBeUndefined();
    expect(service.history()[1]?.undoneBy).toBe(u.ok ? u.value.id : "");
    expect(service.undo(ADMIN, p.value.id).ok).toBe(false);
  });

  test("is refused, naming the rows, when something it touched changed since", () => {
    const { service } = setup();
    const ref = { dataset: "casino" as const, part: "slots", key: null };
    const slots = service.publishedContent().casino.slots;
    service.draftSet(ADMIN, ref, "set", { ...slots, cost: 25 });
    const p = service.publish(ADMIN, seen(service), "");
    service.draftSet(ADMIN, ref, "set", { ...slots, cost: 30 });
    service.publish(ADMIN, seen(service), "");
    const u = service.undo(ADMIN, p.ok ? p.value.id : "");
    expect(u.ok).toBe(false);
    expect(u.ok ? "" : u.error).toContain("casino/slots");
    expect(service.store().casino.slots!.cost).toBe(30);
  });
});

describe("pack updates", () => {
  /** A copy of the Classic pack in a temp folder, with a change made to it. */
  function changedClassic(change: (dir: string) => void, version = "9.0.0"): string {
    const dir = mkdtempSync(join(tmpdir(), "sso-pack-"));
    cpSync(RELEASE_PACK_DIRS.classic as string, dir, { recursive: true });
    change(dir);
    const m = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({ ...m, version }));
    return dir;
  }
  const editJson = (dir: string, file: string, fn: (d: Record<string, unknown>) => void) => {
    const p = join(dir, "data", file);
    const d = JSON.parse(readFileSync(p, "utf8"));
    fn(d);
    writeFileSync(p, JSON.stringify(d));
  };

  test("rows the operator has not changed pick up the new version automatically", () => {
    const { db } = setup();
    const dir = changedClassic((d) =>
      editJson(d, "casino.json", (c) => {
        (c.slots as Record<string, unknown>).cost = 77;
      }),
    );
    try {
      const s = new ContentService({ db, now: () => "x", releasePacks: { classic: dir } });
      expect(s.store().casino.slots!.cost).toBe(77);
      expect(s.notices()).toEqual([]);
      expect(s.installedPacks()[0]).toMatchObject({
        version: "9.0.0",
        updatedFrom: classic.manifest.version,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a changed row the operator customised keeps their version and shows a notice", () => {
    const { db, service } = setup();
    const ref = { dataset: "casino" as const, part: "slots", key: null };
    service.draftSet(ADMIN, ref, "set", { ...service.publishedContent().casino.slots, cost: 25 });
    service.publish(ADMIN, seen(service), "");
    const dir = changedClassic((d) =>
      editJson(d, "casino.json", (c) => {
        (c.slots as Record<string, unknown>).spinFrames = 3;
      }),
    );
    try {
      const s = new ContentService({ db, now: () => "y", releasePacks: { classic: dir } });
      expect(s.store().casino.slots!.cost).toBe(25);
      expect(s.store().casino.slots!.spinFrames).not.toBe(3);
      const [n] = s.notices();
      expect(n).toMatchObject({
        dataset: "casino",
        part: "slots",
        packName: "Classic",
        packVersion: "9.0.0",
      });
      expect((n?.now as { spinFrames: number } | undefined)?.spinFrames).toBe(3);
      expect((n?.yours as { cost: number } | undefined)?.cost).toBe(25);
      // Dismiss keeps the operator's row and stops the notice.
      expect(s.dismissNotice(ADMIN, ref).ok).toBe(true);
      expect(s.notices()).toEqual([]);
      expect(s.store().casino.slots!.cost).toBe(25);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("accept takes the pack's version, as a publish that can be undone", () => {
    const { db, service } = setup();
    const ref = { dataset: "casino" as const, part: "slots", key: null };
    service.draftSet(ADMIN, ref, "set", { ...service.publishedContent().casino.slots, cost: 25 });
    service.publish(ADMIN, seen(service), "");
    const dir = changedClassic((d) =>
      editJson(d, "casino.json", (c) => {
        (c.slots as Record<string, unknown>).spinFrames = 3;
      }),
    );
    try {
      const s = new ContentService({ db, now: () => "z", releasePacks: { classic: dir } });
      const r = s.acceptNotice(ADMIN, ref);
      expect(r.ok).toBe(true);
      expect(s.store().casino.slots!.spinFrames).toBe(3);
      expect(s.store().casino.slots!.cost).toBe(classic.data.casino?.slots?.cost as number);
      expect(s.notices()).toEqual([]);
      expect(s.undo(ADMIN, r.ok ? r.value.id : "").ok).toBe(true);
      expect(s.store().casino.slots!.cost).toBe(25);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a version bump that leaves a customised row as it was shows no notice", () => {
    const { db, service } = setup();
    service.draftSet(ADMIN, { dataset: "casino", part: "slots", key: null }, "set", {
      ...service.publishedContent().casino.slots,
      cost: 25,
    });
    service.publish(ADMIN, seen(service), "");
    const dir = changedClassic((d) =>
      editJson(d, "casino.json", (c) => {
        (c.blackjack as Record<string, unknown>).maxBid = 5;
      }),
    );
    try {
      const s = new ContentService({ db, now: () => "x", releasePacks: { classic: dir } });
      expect(s.notices()).toEqual([]);
      expect(s.store().casino.blackjack!.maxBid).toBe(5);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("installed packs", () => {
  test("an imported pack is a read-only layer stored in the database, loaded after Classic", () => {
    const { db } = setup();
    const manifest = { ...classic.manifest, id: "frost", name: "Frost", version: "1.0.0" };
    insertPack(
      db,
      {
        id: "frost",
        name: "Frost",
        version: "1.0.0",
        source: "imported",
        data: JSON.stringify({
          manifest,
          data: { items: { ...classic.data.items, items: [{ name: "Frost Wand", icon: null }] } },
        }),
      },
      "now",
    );
    const s = new ContentService({ db, now: () => "x", releasePacks: RELEASE_PACK_DIRS });
    expect(s.store().item("Frost Wand")?.name).toBe("Frost Wand");
    expect(s.store().item("Ale")?.name).toBe("Ale");
    expect(s.installedPacks().map((p) => p.id)).toEqual(["classic", "frost"]);
  });

  test("a pack the release no longer ships stops the server with a clear message", () => {
    const { db } = setup();
    expect(() => new ContentService({ db, now: () => "x", releasePacks: {} })).toThrow(
      /does not ship it/,
    );
  });

  test("rowValue finds keyed rows ignoring case", () => {
    expect(rowValue(classic.data, { dataset: "items", part: "items", key: "ALE" })).toBeDefined();
  });
});

describe("the protocol carries an item's art separately from its key", () => {
  afterEach(() => installContent(buildContentStore(classic.data as ContentData)));

  test("a ground item and a bag or worn item name their sprite only when it differs", () => {
    const data = structuredClone(classic.data) as ContentData;
    const sword = data.items.items.find(
      (i) => i.name === "Long Sword",
    ) as (typeof data.items.items)[0];
    sword.sprite = "Knife";
    installContent(buildContentStore(data));
    const g = (item: string) => groundView({ id: "g", item, x: 1, y: 1 } as never);
    expect(g("Long Sword")).toMatchObject({ name: "Long Sword", sprite: "Knife" });
    expect(g("Cannonball")).toMatchObject({ name: "Cannonball", sprite: "CannonballBag" });
    expect(g("Ale").sprite).toBeUndefined();
    const p = player("p1", testMap("x1y1"), 3, 3);
    p.char.bag[0] = { item: "Long Sword", qty: 1 };
    p.char.bag[1] = { item: "Ale", qty: 2 };
    p.char.equip.ring = "Cannonball";
    expect(inventoryView(p).sprites).toEqual({
      "Long Sword": "Knife",
      Cannonball: "CannonballBag",
    });
    p.char.bag[0] = null;
    p.char.equip.ring = "NOTHING";
    expect(inventoryView(p).sprites).toBeUndefined();
  });
});

describe("review fixes", () => {
  test("skills may be added or removed; two spelled alike, or a binding to no skill, are refused", () => {
    const { service } = setup();
    const skill = (key: string) => ({ dataset: "classes" as const, part: "skills", key });
    // Characters keep each skill by key, so a skill nothing else names may go.
    service.draftSet(ADMIN, skill("Meditation"), "remove", null);
    service.draftSet(ADMIN, skill("Swimming"), "set", { skill: "Swimming" });
    expect(service.check()).toEqual([]);
    service.draftSet(ADMIN, skill("Heavy arms"), "set", { skill: "Heavy arms" });
    expect(service.check().map((p) => p.message)).toContain(
      "its name reads the same as HeavyArms (case and spaces are ignored)",
    );
    service.draftDiscard(skill("Heavy arms"));
    // A skill a binding names cannot go without the binding: unbind it to turn the mechanic off.
    // (Classic's medals and Bios name Parry too.)
    const fromBindings = () =>
      service
        .check()
        .filter((p) => p.where === "bindings/skills")
        .map((p) => p.message);
    // Nor while a progression names it: Block's needs Parry over 50.
    expect(service.draftSet(ADMIN, skill("Parry"), "remove", null)).toMatchObject({
      ok: false,
      error:
        "Parry cannot be removed: Block depends on it (a requirement or a formula in the progression names it). Change that progression first.",
    });
    service.draftSet(ADMIN, skill("Block"), "set", { skill: "Block" });
    service.draftSet(ADMIN, skill("Parry"), "remove", null);
    expect(fromBindings()).toEqual(["names a skill that does not exist: Parry"]);
    const bindings = { dataset: "bindings" as const, part: "skills", key: null };
    const { parry: _parry, ...unbound } = service.publishedContent().bindings.skills;
    service.draftSet(ADMIN, bindings, "set", unbound);
    expect(fromBindings()).toEqual([]);
    service.draftSet(ADMIN, bindings, "set", { ...unbound, block: "Blok" });
    expect(fromBindings()).toEqual(["names a skill that does not exist: Blok"]);
  });

  test("a skill other progressions name cannot be removed, and the refusal says which", () => {
    const { service } = setup();
    const skill = (key: string) => ({ dataset: "classes" as const, part: "skills", key });
    // Carpentry needs Lumberjacking over 20; Farming's roll reads it.
    service.draftSet(ADMIN, skill("Carpentry"), "set", {
      skill: "Carpentry",
      progression: {
        model: "chance",
        on: { craft: { roll: 9, cap: 100, requires: { skill: "Lumberjacking", above: 20 } } },
      },
    });
    service.draftSet(ADMIN, skill("Farming"), "set", {
      skill: "Farming",
      progression: {
        model: "chance",
        on: { gather: { roll: [{ op: "set", value: "Lumberjacking" }], cap: 100 } },
      },
    });
    expect(service.draftSet(ADMIN, skill("Lumberjacking"), "remove", null)).toMatchObject({
      ok: false,
      error:
        "Lumberjacking cannot be removed: Carpentry and Farming depend on it (a requirement or a formula in the progression names it). Change that progression first.",
    });
  });

  test("a published skill keeps its key's exact spelling", () => {
    const { service } = setup();
    // Drafting refuses it, as for every key.
    expect(
      service.draftSet(ADMIN, { dataset: "classes", part: "skills", key: "Slash" }, "set", {
        skill: "slash",
      }).ok,
    ).toBe(false);
    // So does the publish check, for a key that arrives another way (a pack's new version).
    const published = service.publishedContent();
    const respelled = structuredClone(published);
    (respelled.classes.skills[0] as { skill: string }).skill = "slash";
    expect(skillProblems(respelled, published).map((p) => p.message)).toEqual([
      "a skill's key cannot be spelled another way (it is Slash)",
    ]);
  });

  test("a pack that binds a skill to no skill is named at start, and every publish names it", () => {
    const { db } = setup();
    const dir = mkdtempSync(join(tmpdir(), "sso-pack-"));
    cpSync(RELEASE_PACK_DIRS.classic as string, dir, { recursive: true });
    const file = join(dir, "data", "bindings.json");
    const bindings = JSON.parse(readFileSync(file, "utf8"));
    bindings.skills.parry = "Parri";
    writeFileSync(file, JSON.stringify(bindings));
    const lines: string[] = [];
    try {
      const service = new ContentService({
        db,
        now: () => "x",
        releasePacks: { classic: dir },
        log: (l) => lines.push(l),
      });
      expect(lines).toContain(
        "content: bindings/skills: names a skill that does not exist: Parri (that mechanic is off)",
      );
      // Not this publish's doing, but it is named until it is fixed.
      service.draftSet(ADMIN, { dataset: "casino", part: "slots", key: null }, "set", {
        ...service.publishedContent().casino.slots,
        cost: 7,
      });
      expect(service.check().map((p) => p.message)).toEqual([
        "names a skill that does not exist: Parri",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("undo runs every publish check: it cannot strand a reference a later publish made", () => {
    const { service } = setup();
    service.draftSet(ADMIN, { dataset: "items", part: "items", key: "Moonblade" }, "set", {
      name: "Moonblade",
      icon: null,
    });
    const first = service.publish(ADMIN, seen(service), "Add Moonblade");
    const quests = service
      .publishedContent()
      .quests.current.map((q, i) => (i === 0 ? { ...q, reward: "Moonblade" } : q));
    service.draftSet(ADMIN, { dataset: "quests", part: "current", key: null }, "set", quests);
    expect(service.publish(ADMIN, seen(service), "Reward it").ok).toBe(true);
    const undo = service.undo(ADMIN, first.ok ? first.value.id : "");
    expect(undo.ok).toBe(false);
    expect(undo.ok ? [] : undo.problems?.map((p) => p.message)).toContain(
      "names an item that does not exist (or is retired): Moonblade",
    );
    expect(service.store().item("Moonblade")).toBeDefined();
  });

  test("a publish logs the hash of the store it installs, even when it edits an earlier added row", () => {
    const { service } = setup();
    for (const name of ["Alpha Blade", "Beta Blade"]) {
      service.draftSet(ADMIN, { dataset: "items", part: "items", key: name }, "set", {
        name,
        icon: null,
      });
    }
    service.publish(ADMIN, seen(service), "");
    service.draftSet(ADMIN, { dataset: "items", part: "items", key: "Alpha Blade" }, "set", {
      name: "Alpha Blade",
      display: "First Blade",
      icon: null,
    });
    const p = service.publish(ADMIN, seen(service), "");
    expect(p.ok ? p.value.hash : "").toBe(service.store().hash);
    const names = service.store().items.items.map((i) => i.name);
    expect(names.indexOf("Alpha Blade")).toBeLessThan(names.indexOf("Beta Blade"));
  });

  test("the last few published stores stay fetchable by hash", () => {
    const { service } = setup();
    const first = service.store().hash;
    service.draftSet(ADMIN, { dataset: "casino", part: "slots", key: null }, "set", {
      ...service.publishedContent().casino.slots,
      cost: 25,
    });
    service.publish(ADMIN, seen(service), "");
    expect(service.clientCopyFor(first)?.hash).toBe(first);
    expect(service.clientCopyFor(service.store().hash)?.hash).toBe(service.store().hash);
    expect(service.clientCopyFor("0000000000000000")).toBeUndefined();
  });

  test("the store's hash covers the format, so a format-only change names a new file", () => {
    const { service } = setup();
    const body = JSON.parse(service.clientCopy().json).data;
    const bare = createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 16);
    expect(service.clientCopy().hash).not.toBe(bare);
  });

  test("a quest written with an item's display name is stored with its key", () => {
    const { service } = setup();
    service.draftSet(ADMIN, { dataset: "items", part: "items", key: "Ale" }, "set", {
      ...(service.store().item("Ale") as object),
      display: "Brown Ale",
    });
    const quests = service
      .publishedContent()
      .quests.current.map((q, i) => (i === 0 ? { ...q, reward: "brown ale" } : q));
    service.draftSet(ADMIN, { dataset: "quests", part: "current", key: null }, "set", quests);
    const stored = service.draft().find((d) => d.dataset === "quests")?.data as {
      reward: string;
    }[];
    expect(stored[0]?.reward).toBe("Ale");
    expect(service.check()).toEqual([]);
  });
});

describe("second review fixes", () => {
  test("a field name off the object's prototype is no field: __proto__ and toString are refused", () => {
    const { service } = setup();
    for (const part of ["__proto__", "toString", "constructor"]) {
      expect(service.draftSet(ADMIN, { dataset: "casino", part, key: null }, "set", null).ok).toBe(
        false,
      );
    }
    expect(service.draft()).toEqual([]);
    expect(Object.getPrototypeOf(service.store().casino)).toBe(Object.prototype);
  });

  test("removing a row the operator added leaves nothing behind", () => {
    const { service, db } = setup();
    const ref = { dataset: "items" as const, part: "items", key: "Moonblade" };
    service.draftSet(ADMIN, ref, "set", { name: "Moonblade", icon: null });
    service.publish(ADMIN, seen(service), "");
    service.draftSet(ADMIN, ref, "remove", null);
    const p = service.publish(ADMIN, seen(service), "");
    expect(contentRows(db).some((r) => r.key === "Moonblade")).toBe(false);
    expect(service.store().item("Moonblade")).toBeUndefined();
    // Undo brings it back.
    expect(service.undo(ADMIN, p.ok ? p.value.id : "").ok).toBe(true);
    expect(service.store().item("Moonblade")).toBeDefined();
  });

  test("a pack notice names the pack that supplies the row, not the newest pack", () => {
    const { db, service } = setup();
    insertPack(
      db,
      {
        id: "frost",
        name: "Frost",
        version: "1.0.0",
        source: "imported",
        data: JSON.stringify({
          manifest: { ...classic.manifest, id: "frost", name: "Frost", version: "1.0.0" },
          data: { items: { ...classic.data.items, items: [{ name: "Frost Wand", icon: null }] } },
        }),
      },
      "now",
    );
    const s1 = new ContentService({ db, now: () => "a", releasePacks: RELEASE_PACK_DIRS });
    const ref = { dataset: "casino" as const, part: "slots", key: null };
    s1.draftSet(ADMIN, ref, "set", { ...s1.publishedContent().casino.slots, cost: 25 });
    s1.publish(ADMIN, seen(s1), "");
    void service;
    const dir = mkdtempSync(join(tmpdir(), "sso-pack-"));
    cpSync(RELEASE_PACK_DIRS.classic as string, dir, { recursive: true });
    const file = join(dir, "data", "casino.json");
    const casino = JSON.parse(readFileSync(file, "utf8"));
    casino.slots!.spinFrames = 3;
    writeFileSync(file, JSON.stringify(casino));
    const m = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({ ...m, version: "1.1.0" }));
    try {
      const s2 = new ContentService({ db, now: () => "b", releasePacks: { classic: dir } });
      expect(s2.notices()[0]).toMatchObject({ packName: "Classic", packVersion: "1.1.0" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("/drop by a renamed item's display name puts down its key", () => {
    const data = structuredClone(classic.data) as ContentData;
    const ale = data.items.items.find((i) => i.name === "Ale") as (typeof data.items.items)[0];
    ale.display = "Brown Ale";
    installContent(buildContentStore(data));
    try {
      expect(parseDrop("Brown Ale")).toEqual({ item: "Ale", qty: 1 });
      expect(parseDrop("ale")).toEqual({ item: "ale", qty: 1 });
      expect(parseDrop("3 Brown Ale")).toEqual({ item: "Ale", qty: 3 });
    } finally {
      installContent(buildContentStore(classic.data as ContentData));
    }
  });
});

describe("third review fixes", () => {
  test("a skill name written in another row must be a skill: a typo is refused before it is live", () => {
    const { service } = setup();
    const medals = structuredClone(service.publishedContent().social.medals) as {
      awards: { skill?: string }[];
    };
    const award = medals.awards.find((a) => typeof a.skill === "string") as { skill: string };
    award.skill = "Fishin";
    expect(
      service.draftSet(ADMIN, { dataset: "social", part: "medals", key: null }, "set", medals).ok,
    ).toBe(true);
    expect(service.check().map((p) => p.message)).toContain(
      "names a skill that does not exist: Fishin",
    );
    expect(service.publish(ADMIN, seen(service), "").ok).toBe(false);
    // Case and spaces are ignored, as the rules read skill names.
    award.skill = "martial arts";
    service.draftSet(ADMIN, { dataset: "social", part: "medals", key: null }, "set", medals);
    expect(service.check()).toEqual([]);
  });

  test("a new skill whose name reads like an existing one (spaces ignored) is refused", () => {
    const { service } = setup();
    service.draftSet(ADMIN, { dataset: "classes", part: "skills", key: "Martial Arts" }, "set", {
      skill: "Martial Arts",
    });
    expect(service.check().some((p) => p.message.includes("reads the same as MartialArts"))).toBe(
      true,
    );
  });

  test("an NPC file saved here gets the NPC Editor's handling: names resolve to keys, bad lines are refused", () => {
    const { service, db } = setup();
    service.draftSet(ADMIN, { dataset: "items", part: "items", key: "Ale" }, "set", {
      ...(service.store().item("Ale") as object),
      display: "Fine Ale",
    });
    service.publish(ADMIN, seen(service), "");
    // The server installs each published store; the NPC checks read the installed one.
    installContent(service.store());
    const file = service.publishedContent().npcFiles.files.find((f) => f.text.includes("SEL|")) as {
      name: string;
      text: string;
    };
    const ref = { dataset: "npcFiles" as const, part: "files", key: file.name };
    expect(
      service.draftSet(ADMIN, ref, "set", { ...file, text: `${file.text}\rSEL|Fine Ale:5:5` }).ok,
    ).toBe(true);
    const stored = service.draft()[0]?.data as { text: string };
    expect(stored.text.endsWith("SEL|Ale:5:5")).toBe(true);
    const bad = service.draftSet(ADMIN, ref, "set", { ...file, text: "SEL|Nothing At All:5:5" });
    expect(bad.ok).toBe(false);
    // An NPC with an NPC Editor save: the row says the save is what plays.
    saveNpcFile(db, { npc: file.name, text: file.text }, "acc", "now");
    expect(rowDetailOf(service, ref)?.note).toContain("NPC Editor");
    installContent(buildContentStore(classic.data as ContentData));
  });
});

describe("fourth review fixes", () => {
  test("an empty skill name is a broken reference too", () => {
    const { service } = setup();
    const medals = structuredClone(service.publishedContent().social.medals) as {
      awards: { skill: string }[];
    };
    (medals.awards[0] as { skill: string }).skill = "";
    service.draftSet(ADMIN, { dataset: "social", part: "medals", key: null }, "set", medals);
    expect(service.check().map((p) => p.message)).toContain(
      "names a skill that does not exist: (nothing)",
    );
  });

  test("a second broken reference beside an existing one is still reported", () => {
    const { service } = setup();
    const base = structuredClone(classic.data) as ContentData;
    base.quests.current = base.quests.current.map((q, n) =>
      n === 0 ? { ...q, wants: "Nothing Here" } : q,
    );
    const next = structuredClone(base);
    next.quests.current = next.quests.current.map((q, n) =>
      n === 1 ? { ...q, wants: "Nothing Here" } : q,
    );
    expect(referenceProblems(base, base)).toEqual([]);
    expect(referenceProblems(next, base).map((p) => p.message)).toEqual([
      "names an item that does not exist (or is retired): Nothing Here",
    ]);
  });

  test("an attack-power condition or value combat cannot read is refused when drafted", () => {
    const { service } = setup();
    const ap = structuredClone(service.publishedContent().attPower.attPower);
    const tier = ap.skillBlocks.flatMap((b) => b.tiers).find((t) => t.when) as {
      when: string[];
      value: unknown;
    };
    tier.when = ["Archery >= 10"];
    expect(
      service.draftSet(ADMIN, { dataset: "attPower", part: "attPower", key: null }, "set", ap).ok,
    ).toBe(false);
    tier.when = ["Archery > 9"];
    tier.value = "random(ten)";
    expect(
      service.draftSet(ADMIN, { dataset: "attPower", part: "attPower", key: null }, "set", ap).ok,
    ).toBe(false);
  });

  test("undo is refused when a later publish touched its row, even if it put it back", () => {
    const { service } = setup();
    const ref = { dataset: "casino" as const, part: "slots", key: null };
    const slots = service.publishedContent().casino.slots;
    service.draftSet(ADMIN, ref, "set", { ...slots, cost: 25 });
    const a = service.publish(ADMIN, seen(service), "A");
    service.draftSet(ADMIN, ref, "set", { ...slots, cost: 30 });
    service.publish(ADMIN, seen(service), "B");
    service.draftSet(ADMIN, ref, "set", { ...slots, cost: 25 });
    service.publish(ADMIN, seen(service), "C");
    const u = service.undo(ADMIN, a.ok ? a.value.id : "");
    expect(u.ok).toBe(false);
    expect(service.store().casino.slots!.cost).toBe(25);
  });

  test("a later publish and its undo cancel out, so the earlier publish can still be undone", () => {
    const { service } = setup();
    const ref = { dataset: "casino" as const, part: "slots", key: null };
    const slots = service.publishedContent().casino.slots;
    service.draftSet(ADMIN, ref, "set", { ...slots, cost: 25 });
    const a = service.publish(ADMIN, seen(service), "A");
    service.draftSet(ADMIN, ref, "set", { ...slots, cost: 30 });
    const b = service.publish(ADMIN, seen(service), "B");
    expect(service.undo(ADMIN, b.ok ? b.value.id : "").ok).toBe(true);
    expect(service.undo(ADMIN, a.ok ? a.value.id : "").ok).toBe(true);
    expect(service.store().casino.slots).toEqual(classic.data.casino?.slots as never);
  });

  test("an NPC file may sell an item added in the same draft; removing an item a shop sells is refused", () => {
    const { service } = setup();
    service.draftSet(ADMIN, { dataset: "items", part: "items", key: "Moonblade" }, "set", {
      name: "Moonblade",
      icon: null,
    });
    const file = service.publishedContent().npcFiles.files.find((f) => f.text.includes("SEL|")) as {
      name: string;
      text: string;
    };
    const ref = { dataset: "npcFiles" as const, part: "files", key: file.name };
    expect(
      service.draftSet(ADMIN, ref, "set", { ...file, text: `${file.text}\rSEL|Moonblade:5:5` }).ok,
    ).toBe(true);
    expect(service.publish(ADMIN, seen(service), "").ok).toBe(true);
    service.draftSet(ADMIN, { dataset: "items", part: "items", key: "Moonblade" }, "remove", null);
    expect(service.check().some((p) => p.where === `npcFiles/files/${file.name}`)).toBe(true);
  });

  test("the draft revision changes with every save, even within one millisecond", () => {
    const { db } = setup();
    const service = new ContentService({
      db,
      now: () => "2026-11-22T00:00:00.000Z",
      releasePacks: RELEASE_PACK_DIRS,
    });
    const ref = { dataset: "casino" as const, part: "slots", key: null };
    const slots = service.publishedContent().casino.slots;
    service.draftSet(ADMIN, ref, "set", { ...slots, cost: 25 });
    const first = service.draftRev();
    service.draftSet(ADMIN, ref, "set", { ...slots, cost: 26 });
    expect(service.draftRev()).not.toBe(first);
    expect(service.publish(ADMIN, first, "").ok).toBe(false);
  });
});

describe("fifth review fixes", () => {
  test("a row every schema accepts but a rule cannot read is refused before it is written", () => {
    const { service } = setup();
    const stations = structuredClone(service.publishedContent().craft.stations) as {
      texts: Record<string, unknown>;
    };
    delete stations.texts[Object.keys(stations.texts)[0] as string];
    const ref = { dataset: "craft" as const, part: "stations", key: null };
    expect(service.draftSet(ADMIN, ref, "set", stations).ok).toBe(true);
    expect(service.check().some((p) => p.message.startsWith("a rule cannot read it"))).toBe(true);
    const before = service.store().hash;
    expect(service.publish(ADMIN, seen(service), "").ok).toBe(false);
    expect(service.store().hash).toBe(before);
    // The installed store is put back after the trial.
    expect(content().craft.stations.texts).toEqual(classic.data.craft?.stations.texts as never);
  });

  test("stat words are read exactly as each rule reads them; the Bio score's skills are checked", () => {
    const { service } = setup();
    const bios = structuredClone(service.publishedContent().social.bios);
    bios.score.counted.push("hpmax");
    service.draftSet(ADMIN, { dataset: "social", part: "bios", key: null }, "set", bios);
    expect(service.check().map((p) => p.message)).toContain(
      "names a skill that does not exist: hpmax",
    );
    service.draftDiscard({ dataset: "social", part: "bios", key: null });
    const ground = structuredClone(service.publishedContent().itemRules.ground);
    (ground.platforms[0] as { needs: string }).needs = "Level";
    service.draftSet(ADMIN, { dataset: "itemRules", part: "ground", key: null }, "set", ground);
    expect(service.check().map((p) => p.message)).toContain(
      "names a skill that does not exist: Level",
    );
  });

  test("each chat room is listed once", () => {
    const { service } = setup();
    const chat = structuredClone(service.publishedContent().social.chat);
    (chat.rooms[4] as { key: string }).key = chat.rooms[0]?.key as string;
    expect(
      service.draftSet(ADMIN, { dataset: "social", part: "chat", key: null }, "set", chat).ok,
    ).toBe(false);
  });
});

describe("council review fixes", () => {
  const slotsRef = { dataset: "casino" as const, part: "slots", key: null };

  test("an NPC Editor save counts: removing an item only a saved shop sells is refused", () => {
    const { db, service } = setup();
    service.draftSet(ADMIN, { dataset: "items", part: "items", key: "Moonblade" }, "set", {
      name: "Moonblade",
      icon: null,
    });
    expect(service.publish(ADMIN, seen(service), "").ok).toBe(true);
    service.draftSet(ADMIN, { dataset: "items", part: "items", key: "Moonblade" }, "remove", null);
    expect(service.check()).toEqual([]);
    // The check is asked again once the NPC Editor saves a shop that sells it.
    saveNpcFile(db, { npc: "Amber", text: "BIO|Name: Amber\rSEL|Moonblade:5:5" }, "Admin", "x");
    expect(service.check().map((p) => p.where)).toContain("npcFiles/files/Amber");
    expect(service.publish(ADMIN, seen(service), "").ok).toBe(false);
  });

  test("crafting and the quest pools are checked for the items they name", () => {
    const { service } = setup();
    service.draftSet(
      ADMIN,
      { dataset: "items", part: "items", key: "Burned Fish" },
      "remove",
      null,
    );
    expect(service.check().map((p) => p.where)).toContain("craft/stations");
    service.draftDiscard({ dataset: "items", part: "items", key: "Burned Fish" });
    const pools = structuredClone(service.publishedContent().quests.pools);
    (pools.rewards[0] as { item: string }).item = "NonExistentSword";
    service.draftSet(ADMIN, { dataset: "quests", part: "pools", key: null }, "set", pools);
    expect(service.check().map((p) => p.message)).toContain(
      "names an item that does not exist (or is retired): NonExistentSword",
    );
  });

  test("a quest pool written with an item's display name is stored with its key", () => {
    const { service } = setup();
    const ale = service.publishedContent().items.items.find((i) => i.name === "Ale");
    service.draftSet(ADMIN, { dataset: "items", part: "items", key: "Ale" }, "set", {
      ...ale,
      display: "Brown Ale",
    });
    const pools = structuredClone(service.publishedContent().quests.pools);
    (pools.wanted[0] as { item: string }).item = "Brown Ale";
    service.draftSet(ADMIN, { dataset: "quests", part: "pools", key: null }, "set", pools);
    expect(service.publish(ADMIN, seen(service), "").ok).toBe(true);
    expect(service.store().quests.pools.wanted[0]?.item).toBe("Ale");
  });

  test("a later change, its undo, its redo and the redo's undo cancel out", () => {
    const { service } = setup();
    const slots = service.publishedContent().casino.slots;
    service.draftSet(ADMIN, slotsRef, "set", { ...slots, cost: 25 });
    const a = service.publish(ADMIN, seen(service), "A");
    service.draftSet(ADMIN, slotsRef, "set", { ...slots, cost: 30 });
    const b = service.publish(ADMIN, seen(service), "B");
    const ub = service.undo(ADMIN, b.ok ? b.value.id : "");
    const redo = service.undo(ADMIN, ub.ok ? ub.value.id : "");
    expect(redo.ok).toBe(true);
    expect(service.store().casino.slots!.cost).toBe(30);
    // With the redo live, A cannot be undone underneath it, and B says to undo the redo.
    expect(service.undo(ADMIN, a.ok ? a.value.id : "").ok).toBe(false);
    const again = service.undo(ADMIN, b.ok ? b.value.id : "");
    expect(again.ok ? "" : again.error).toContain("undo the redo");
    expect(service.undo(ADMIN, redo.ok ? redo.value.id : "").ok).toBe(true);
    expect(service.store().casino.slots!.cost).toBe(25);
    expect(service.undo(ADMIN, a.ok ? a.value.id : "").ok).toBe(true);
    expect(service.store().casino.slots).toEqual(classic.data.casino?.slots as never);
  });

  test("skills have no fixed order: two new ones drafted in any order are accepted", () => {
    const { service } = setup();
    const skill = (name: string) =>
      service.draftSet(ADMIN, { dataset: "classes", part: "skills", key: name }, "set", {
        skill: name,
      });
    skill("Swimming");
    skill("Climbing");
    expect(service.check()).toEqual([]);
    expect(service.publish(ADMIN, seen(service), "").ok).toBe(true);
    expect(
      service
        .store()
        .classes.skills.slice(-2)
        .map((s) => s.skill),
    ).toEqual(["Swimming", "Climbing"]);
  });

  test("an attack-power condition is read as combat reads it: an unknown skill is refused", () => {
    const { service } = setup();
    const ap = structuredClone(service.publishedContent().attPower.attPower);
    const tier = ap.skillBlocks.flatMap((b) => b.tiers).find((t) => t.when?.length) as {
      when: string[];
    };
    tier.when = ["Slash2 > 5"];
    const r = service.draftSet(
      ADMIN,
      { dataset: "attPower", part: "attPower", key: null },
      "set",
      ap,
    );
    expect(r.ok ? service.check().map((p) => p.message) : [r.error]).toContainEqual(
      expect.stringContaining("Slash2"),
    );
  });

  test("a crafting line a player only meets mid-craft is still read when it is installed", () => {
    const { service } = setup();
    const stations = structuredClone(service.publishedContent().craft.stations) as {
      texts: Record<string, unknown>;
    };
    delete stations.texts.smithBegin;
    service.draftSet(ADMIN, { dataset: "craft", part: "stations", key: null }, "set", stations);
    expect(service.check().some((p) => p.message.includes("smithBegin"))).toBe(true);
  });

  test("vault and container lines name a renamed item as players see it", () => {
    const before = content();
    const items = structuredClone(before.items);
    const ale = items.items.find((i) => i.name === "Ale");
    if (ale) {
      ale.display = "Brown Ale";
    }
    try {
      installContent(buildContentStore({ ...before, items }));
      expect(VAULT_TEXT.drop("Ale")).toBe("You drop a Brown Ale into the container.");
      expect(VAULT_TEXT.dropMany(2, "Ale")).toBe("You drop 2 Brown Ale into the container.");
      expect(VAULT_TEXT.take("Ale")).toBe("You take a Brown Ale out of the container.");
    } finally {
      installContent(before);
    }
  });

  test("removing a row only the draft adds is refused: discard it instead", () => {
    const { service } = setup();
    const ref = { dataset: "items" as const, part: "items", key: "TempItem" };
    service.draftSet(ADMIN, ref, "set", { name: "TempItem", icon: null });
    const r = service.draftSet(ADMIN, ref, "remove", null);
    expect(r.ok ? "" : r.error).toContain("discard the change instead");
  });

  test("a pack row put back after its removal keeps the pack's spelling of its key", () => {
    const { service } = setup();
    const ref = { dataset: "items" as const, part: "items", key: "Burned Fish" };
    const row = rowValue(service.packContent(), ref) as Record<string, unknown>;
    service.draftSet(ADMIN, ref, "remove", null);
    const r = service.draftSet(ADMIN, { ...ref, key: "burned fish" }, "set", {
      ...row,
      name: "BURNED FISH",
    });
    expect(r.ok).toBe(false);
    expect(service.draftSet(ADMIN, ref, "set", row).ok).toBe(true);
  });

  test("a release that reorders the skills starts: characters keep their skills by key", () => {
    const { db } = setup();
    const dir = mkdtempSync(join(tmpdir(), "sso-pack-"));
    cpSync(RELEASE_PACK_DIRS.classic as string, dir, { recursive: true });
    const file = join(dir, "data", "classes.json");
    const classes = JSON.parse(readFileSync(file, "utf8"));
    classes.skills.reverse();
    writeFileSync(file, JSON.stringify(classes));
    try {
      const service = new ContentService({ db, now: () => "x", releasePacks: { classic: dir } });
      expect(service.store().classes.skills[0]?.skill).toBe("Farming");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a release with two skills spelled alike stops the start, and its version waits for a start that works", () => {
    const { db } = setup();
    const before = installedPacks(db)[0]?.version;
    const dir = mkdtempSync(join(tmpdir(), "sso-pack-"));
    cpSync(RELEASE_PACK_DIRS.classic as string, dir, { recursive: true });
    const file = join(dir, "data", "classes.json");
    const classes = JSON.parse(readFileSync(file, "utf8"));
    classes.skills.push({ skill: "S lash" });
    writeFileSync(file, JSON.stringify(classes));
    const m = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({ ...m, version: "9.0.0" }));
    try {
      expect(
        () => new ContentService({ db, now: () => "x", releasePacks: { classic: dir } }),
      ).toThrow(/skills the rules cannot tell apart/);
      expect(installedPacks(db)[0]?.version).toBe(before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
