import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RELEASE_PACK_DIRS } from "@secondstaronline/data/packs";
import {
  buildContentStore,
  type ContentData,
  type ContentStore,
  installContent,
} from "@secondstaronline/shared";

import { readPackDir } from "../src/content/packs.ts";
import { applyRows, mergePacks, rowHash, rowsOf, rowValue } from "../src/content/rows.ts";
import { type ContentActor, ContentService } from "../src/content/service.ts";
import { badKeyForm, nameProblems, skillProblems } from "../src/content/validate.ts";
import {
  contentRows,
  insertPack,
  installedPacks,
  upsertContentRow,
} from "../src/persistence/content.ts";
import { openDatabase } from "../src/persistence/database.ts";
import { migrate } from "../src/persistence/migrations.ts";
import { parseDrop } from "../src/systems/admin/drop.ts";
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

const seen = (service: ContentService) =>
  service
    .draft()
    .map((d) => ({ dataset: d.dataset, part: d.part, key: d.key, updatedAt: d.updatedAt }));

const classic = readPackDir(RELEASE_PACK_DIRS.classic as string);

describe("the Classic pack", () => {
  test("loads every dataset and matches its schemas", () => {
    expect(classic.manifest.id).toBe("classic");
    expect(Object.keys(classic.data).sort()).toHaveLength(16);
  });

  test("a server with only Classic installed builds the Classic store unchanged", () => {
    const { service, db } = setup();
    expect(service.publishedContent()).toEqual(classic.data as never);
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
    expect(merged.casino?.slots.cost).toBe(99);
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
    expect(service.store().casino.slots.cost).not.toBe(25);
    expect(service.draft()[0]?.author).toBe("Admin");
    const r = service.publish(ADMIN, seen(service), "Cheaper slots");
    expect(r.ok).toBe(true);
    expect(service.store().casino.slots.cost).toBe(25);
    expect(published).toHaveLength(1);
    expect(published[0]?.casino.slots.cost).toBe(25);
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
    expect(service.store().casino.slots.cost).not.toBe(30);
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
    expect(again.store().casino.slots.cost).toBe(25);
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

  test("removing a keyed row drops it; sections cannot be removed", () => {
    const { service } = setup();
    expect(
      service.draftSet(ADMIN, { dataset: "casino", part: "slots", key: null }, "remove", null).ok,
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
    expect(service.store().casino.slots.cost).toBe(30);
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
      expect(s.store().casino.slots.cost).toBe(77);
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
      expect(s.store().casino.slots.cost).toBe(25);
      expect(s.store().casino.slots.spinFrames).not.toBe(3);
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
      expect(s.store().casino.slots.cost).toBe(25);
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
      expect(s.store().casino.slots.spinFrames).toBe(3);
      expect(s.store().casino.slots.cost).toBe(classic.data.casino?.slots.cost as number);
      expect(s.notices()).toEqual([]);
      expect(s.undo(ADMIN, r.ok ? r.value.id : "").ok).toBe(true);
      expect(s.store().casino.slots.cost).toBe(25);
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
      expect(s.store().casino.blackjack.maxBid).toBe(5);
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
  test("a skill keeps its index, indices run 1 to n, and a trained skill cannot be removed", () => {
    const { service } = setup();
    const skills = service.publishedContent().classes.skills;
    const ref = { dataset: "classes" as const, part: "skills", key: skills[0]?.skill as string };
    service.draftSet(ADMIN, ref, "set", { ...skills[0], index: skills[1]?.index });
    expect(service.check().some((p) => p.message.includes("cannot change"))).toBe(true);
    expect(service.check().some((p) => p.message.includes("from 1 to"))).toBe(true);
    service.draftDiscard(ref);
    // Removing a skill: refused (here the classes' starting values already outnumber the skills).
    const published = service.publishedContent();
    const without = {
      ...published,
      classes: { ...published.classes, skills: published.classes.skills.slice(0, -1) },
    };
    expect(skillProblems(without, published).map((p) => p.message)).toContain(
      "a skill characters have trained cannot be removed",
    );
    const added = { dataset: "classes" as const, part: "skills", key: "Swimming" };
    service.draftSet(ADMIN, added, "set", { index: skills.length + 1, skill: "Swimming" });
    expect(service.check()).toEqual([]);
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
      "names an item that does not exist: Moonblade",
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
    casino.slots.spinFrames = 3;
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
