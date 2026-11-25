/**
 * Issue #34: exporting the operator's layer as a pack file and importing it on another server,
 * merged into the draft or installed as a pack (in play from the next start). A file is checked
 * whole before anything changes: its data against its manifest's hash, its files against theirs.
 * An imported pack that would stop a start is left out, so the Control Panel can remove it.
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createRgba, encodePng } from "@secondstaronline/data/art";
import {
  type ContentPackPreview,
  PACK_DOWNLOAD_PATH,
  UPLOAD_TICKET_HEADER,
} from "@secondstaronline/shared";

import { readPackFile } from "../src/content/pack-file.ts";
import type { ContentActor } from "../src/content/service.ts";
import { type RunningServer, startServer } from "../src/main.ts";
import { manualClock } from "./helpers/manual-clock.ts";

const ADMIN: ContentActor = { accountId: "acc-admin", name: "Admin" };

let dir = "";
let logSpy: { mockRestore(): void } | null = null;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sso-packs-"));
  logSpy = spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  logSpy?.mockRestore();
  rmSync(dir, { recursive: true, force: true });
});

function start(name: string): RunningServer {
  const clientDir = join(dir, "client");
  mkdirSync(clientDir, { recursive: true });
  writeFileSync(join(clientDir, "index.html"), "<!doctype html><title>x</title>");
  const server = startServer({
    dbPath: join(dir, `${name}.sqlite`),
    port: 0,
    development: false,
    clientDir,
    clock: manualClock(),
    autoTick: false,
    isoNow: () => "2026-11-25T00:00:00.000Z",
    rng: { random: (n) => (n >= 1 ? 1 : 0) },
    onLag: () => {},
  });
  server.db
    .query(
      "INSERT OR IGNORE INTO accounts (id, username, password_hash, role, created_at, updated_at) VALUES (?, ?, 'x', 'administrator', 'now', 'now')",
    )
    .run(ADMIN.accountId, "admin");
  return server;
}

function picture(): Uint8Array {
  const img = createRgba(12, 12);
  for (let i = 0; i < 12 * 12; i++) {
    img.data.set([40, 90, 200, 255], i * 4);
  }
  return encodePng(img);
}

/** A server whose operator added an item with an uploaded picture and removed a help topic. */
async function authored(server: RunningServer): Promise<{ topic: string }> {
  const up = server.content.upload(server.content.uploadTicket(ADMIN), "image", picture()).body as {
    file: string;
  };
  const set = (dataset: string, part: string, key: string, data: unknown) =>
    server.content.draftSet(
      ADMIN,
      { dataset: dataset as never, part, key },
      data === null ? "remove" : "set",
      data,
    );
  expect(set("items", "items", "Frost Sword", { name: "Frost Sword", icon: "added" }).ok).toBe(
    true,
  );
  expect(
    set("art", "items", "Frost Sword", { name: "Frost Sword", file: up.file, regX: 6, regY: 6 }).ok,
  ).toBe(true);
  const topic = server.content.publishedContent().help.topics.at(-1)?.file as string;
  expect(set("help", "topics", topic, null).ok).toBe(true);
  expect(server.content.publish(ADMIN, server.content.draftRev(), "authored").ok).toBe(true);
  return { topic };
}

async function exported(server: RunningServer, version = "1.0.0"): Promise<string> {
  const ticket = server.content.uploadTicket(ADMIN);
  const url = new URL(PACK_DOWNLOAD_PATH, server.url);
  url.search = new URLSearchParams({ id: "frost", name: "Frost", version }).toString();
  const res = await fetch(url, { headers: { [UPLOAD_TICKET_HEADER]: ticket } });
  expect(res.status).toBe(200);
  expect(res.headers.get("content-disposition")).toContain(`frost-${version}.ssopack.json`);
  return await res.text();
}

async function posted(
  server: RunningServer,
  text: string,
): Promise<{ ok: boolean; preview?: ContentPackPreview; error?: string }> {
  const res = await fetch(new URL("/upload/pack", server.url), {
    method: "POST",
    body: text,
    headers: { [UPLOAD_TICKET_HEADER]: server.content.uploadTicket(ADMIN) },
  });
  return (await res.json()) as { ok: boolean; preview?: ContentPackPreview; error?: string };
}

describe("exporting and importing packs (issue #34)", () => {
  test("an export holds the published layer: rows, removals and the files its art names", async () => {
    const a = start("a");
    try {
      const { topic } = await authored(a);
      // A draft change is not exported: what plays is.
      a.content.draftSet(ADMIN, { dataset: "items", part: "items", key: "Draft Only" }, "set", {
        name: "Draft Only",
        icon: "added",
      });
      const file = readPackFile(await exported(a));
      expect(file.pack.manifest).toMatchObject({ id: "frost", format: 2, version: "1.0.0" });
      expect(file.pack.manifest.builtOn).toEqual([{ id: "classic", version: expect.any(String) }]);
      const items = (file.pack.data.items as { items: { name: string }[] }).items;
      expect(items.map((i) => i.name)).toEqual(["Frost Sword"]);
      expect(file.pack.removals).toEqual([{ dataset: "help", part: "topics", key: topic }]);
      expect(file.files).toHaveLength(1);
      // An NPCs page save is exported as the row it plays as; read back here, nothing changes.
      a.db
        .query(
          "INSERT INTO npc_files (npc, text, saved_by, updated_at) VALUES ('Amber', 'BIO|Saved live', 'acc-admin', 'now')",
        )
        .run();
      const again = await posted(a, await exported(a));
      expect(again.preview).toMatchObject({ added: [], changed: [], removed: [] });
    } finally {
      await a.stop();
    }
  });

  test("a merge puts the rows in the draft, the files in the uploads; a publish plays them", async () => {
    const a = start("a");
    const b = start("b");
    try {
      const { topic } = await authored(a);
      const text = await exported(a);
      const r = await posted(b, text);
      expect(r.ok).toBe(true);
      const p = r.preview as ContentPackPreview;
      expect(p.added).toEqual(
        expect.arrayContaining(["items/items/Frost Sword", "art/items/Frost Sword"]),
      );
      expect(p.removed).toEqual([`help/topics/${topic}`]);
      expect(p.install.ok).toBe(true);
      expect(p.files).toBe(1);
      // Nothing changed yet.
      expect(b.content.draft()).toEqual([]);
      const applied = b.content.applyImport(ADMIN, p.importId, "merge");
      expect(applied.ok).toBe(true);
      expect(b.content.draft().length).toBe(3);
      expect(b.content.check()).toEqual([]);
      expect(b.content.publish(ADMIN, b.content.draftRev(), "merged").ok).toBe(true);
      expect(b.content.store().item("Frost Sword")).toBeDefined();
      expect(b.content.publishedContent().help.topics.some((t) => t.file === topic)).toBe(false);
      // The waiting file is used once.
      expect(b.content.applyImport(ADMIN, p.importId, "merge").ok).toBe(false);
    } finally {
      await a.stop();
      await b.stop();
    }
  });

  test("an install records the pack, in play from the next start; an update and a removal follow it", async () => {
    const a = start("a");
    let c = start("c");
    try {
      const { topic } = await authored(a);
      const r = await posted(c, await exported(a));
      const applied = c.content.applyImport(ADMIN, r.preview?.importId as string, "install");
      expect(applied.ok).toBe(true);
      expect(c.content.packsView().packs.find((p) => p.id === "frost")?.state).toBe("next start");
      expect(c.content.store().item("Frost Sword")).toBeUndefined();
      await c.stop();
      c = start("c");
      expect(c.content.packsView().packs.find((p) => p.id === "frost")).toMatchObject({
        state: "loaded",
        source: "imported",
        version: "1.0.0",
      });
      expect(c.content.store().item("Frost Sword")).toBeDefined();
      expect(c.content.publishedContent().help.topics.some((t) => t.file === topic)).toBe(false);
      // The pack's picture is drawn from the uploads.
      const index = (await (await fetch(new URL("/assets/index.json", c.url))).json()) as {
        atlases: { items: { sprites: Record<string, number[]> } };
      };
      expect(index.atlases.items.sprites["frost sword"]).toBeDefined();
      // The same version again is refused; another one updates it.
      const again = await posted(c, await exported(a));
      expect(again.preview?.install.ok).toBe(false);
      const v2 = await posted(c, await exported(a, "1.1.0"));
      expect(v2.preview?.install).toMatchObject({ ok: true, updates: "1.0.0" });
      // Removed, it leaves at the next start.
      expect(c.content.removeImportedPack(ADMIN, "frost").ok).toBe(true);
      expect(c.content.removeImportedPack(ADMIN, "classic").ok).toBe(false);
      expect(c.content.packsView().packs.find((p) => p.id === "frost")?.state).toBe(
        "removed at next start",
      );
      await c.stop();
      c = start("c");
      expect(c.content.store().item("Frost Sword")).toBeUndefined();
    } finally {
      await a.stop();
      await c.stop();
    }
  });

  test("a changed file, a release pack's id and a file that is not a pack are refused whole", async () => {
    const a = start("a");
    const b = start("b");
    try {
      await authored(a);
      const text = await exported(a);
      const changed = text.replace('"Frost Sword"', '"Frost Swore"');
      expect((await posted(b, changed)).error).toContain("contentHash");
      const asClassic = JSON.parse(text) as { manifest: { id: string } };
      asClassic.manifest.id = "classic";
      const r = await posted(b, JSON.stringify(asClassic));
      expect(r.preview?.install.ok).toBe(false);
      expect(r.preview?.install.errors[0]).toContain("release pack");
      expect((await posted(b, "not json")).ok).toBe(false);
      // Without a live ticket nothing is read.
      const res = await fetch(new URL("/upload/pack", b.url), { method: "POST", body: text });
      expect(res.status).toBe(403);
    } finally {
      await a.stop();
      await b.stop();
    }
  });

  test("an imported pack that cannot load is left out at start, and can be removed", async () => {
    let s = start("s");
    s.db
      .query(
        "INSERT INTO content_packs (id, name, version, position, source, data, installed_at) VALUES ('broken', 'Broken', '1.0.0', 9, 'imported', '{\"manifest\":{}}', 'now')",
      )
      .run();
    await s.stop();
    s = start("s");
    try {
      const v = s.content.packsView();
      expect(v.leftOut).toContain("Broken");
      expect(v.packs.find((p) => p.id === "broken")?.state).toBe("left out");
      expect(s.content.store().item("Long Sword")).toBeDefined();
      expect(s.content.removeImportedPack(ADMIN, "broken").ok).toBe(true);
    } finally {
      await s.stop();
    }
  });

  test("a player shop's file is world data and never exported", async () => {
    const a = start("a");
    try {
      a.db.exec("PRAGMA foreign_keys = OFF");
      a.db
        .query(
          "INSERT INTO player_shops (npc, owner_id, interior, created_at) VALUES ('Bob''s Shop', 'nobody', 'x', 'now')",
        )
        .run();
      a.db
        .query(
          "INSERT INTO npc_files (npc, text, saved_by, updated_at) VALUES ('Bob''s Shop', 'SEL|Apple:5:1', 'x', 'now')",
        )
        .run();
      const file = readPackFile(await exported(a));
      const files = (file.pack.data.npcFiles as { files: { name: string }[] } | undefined)?.files;
      expect(files?.some((f) => f.name === "Bob's Shop") ?? false).toBe(false);
    } finally {
      await a.stop();
    }
  });

  test("the same version is not installed again; one waiting file per account, and Cancel lets it go", async () => {
    const a = start("a");
    const b = start("b");
    try {
      await authored(a);
      const text = await exported(a);
      const r = await posted(b, text);
      const p = r.preview as ContentPackPreview;
      expect(b.content.applyImport(ADMIN, p.importId, "install").ok).toBe(true);
      // Posted again: the same version is refused at the preview and at the apply.
      const again = (await posted(b, text)).preview as ContentPackPreview;
      expect(again.install.ok).toBe(false);
      const applied = b.content.applyImport(ADMIN, again.importId, "install");
      expect(applied.ok).toBe(false);
      // One waiting file per account: the second post replaced the first.
      const third = (await posted(b, text)).preview as ContentPackPreview;
      expect(b.content.applyImport(ADMIN, again.importId, "merge").ok).toBe(false);
      b.content.cancelImport(ADMIN, third.importId);
      expect(b.content.applyImport(ADMIN, third.importId, "merge").ok).toBe(false);
    } finally {
      await a.stop();
      await b.stop();
    }
  });

  test("a pack's keys are checked as an operator's are: an engine fixture's name is refused", async () => {
    const a = start("a");
    const b = start("b");
    try {
      await authored(a);
      const text = await exported(a);
      const o = JSON.parse(text) as {
        manifest: { contentHash: string };
        data: { items: { items: { name: string; icon: string }[] } };
        removals: unknown[];
      };
      o.data.items.items.push({ name: "Exit", icon: "added" });
      const { packContentHash } = await import("../src/content/pack-file.ts");
      o.manifest.contentHash = packContentHash(o.data as never, o.removals as never);
      const p = (await posted(b, JSON.stringify(o))).preview as ContentPackPreview;
      expect(p.install.ok).toBe(false);
      expect(p.install.errors.join(" ")).toContain("Exit");
      expect(p.merge.problems.join(" ")).toContain("Exit");
    } finally {
      await a.stop();
      await b.stop();
    }
  });

  test("a ticket whose holder lost the Content page downloads and posts nothing", async () => {
    const a = start("a");
    try {
      const ticket = a.content.uploadTicket(ADMIN);
      a.db.query("UPDATE accounts SET role = 'moderator' WHERE id = ?").run(ADMIN.accountId);
      const url = new URL(PACK_DOWNLOAD_PATH, a.url);
      url.search = new URLSearchParams({ id: "frost", name: "Frost", version: "1.0.0" }).toString();
      expect((await fetch(url, { headers: { [UPLOAD_TICKET_HEADER]: ticket } })).status).toBe(403);
      const res = await fetch(new URL("/upload/pack", a.url), {
        method: "POST",
        body: "{}",
        headers: { [UPLOAD_TICKET_HEADER]: ticket },
      });
      expect(res.status).toBe(403);
    } finally {
      await a.stop();
    }
  });

  test("an update installs in place, names the rows it takes away, and a merge over a changed draft is refused", async () => {
    const a = start("a");
    let c = start("c");
    try {
      await authored(a);
      const v1 = (await posted(c, await exported(a))).preview as ContentPackPreview;
      expect(c.content.applyImport(ADMIN, v1.importId, "install").ok).toBe(true);
      await c.stop();
      c = start("c");
      // v2 no longer has the sword.
      a.content.draftSet(
        ADMIN,
        { dataset: "art", part: "items", key: "Frost Sword" },
        "remove",
        null,
      );
      a.content.draftSet(
        ADMIN,
        { dataset: "items", part: "items", key: "Frost Sword" },
        "remove",
        null,
      );
      expect(a.content.publish(ADMIN, a.content.draftRev(), "v2").ok).toBe(true);
      const v2 = (await posted(c, await exported(a, "1.1.0"))).preview as ContentPackPreview;
      expect(v2.install.updates).toBe("1.0.0");
      expect(v2.removed.some((r) => r.startsWith("items/items/Frost Sword"))).toBe(true);
      expect(c.content.applyImport(ADMIN, v2.importId, "install").ok).toBe(true);
      expect(c.content.packsView().packs.find((p) => p.id === "frost")).toMatchObject({
        state: "next start",
        version: "1.1.0",
      });
      await c.stop();
      c = start("c");
      expect(c.content.store().item("Frost Sword")).toBeUndefined();
      // A merge checked against one draft is refused once the draft has changed.
      const m = (await posted(c, await exported(a, "1.2.0"))).preview as ContentPackPreview;
      c.content.draftSet(ADMIN, { dataset: "items", part: "items", key: "Other" }, "set", {
        name: "Other",
        icon: "added",
      });
      expect(c.content.applyImport(ADMIN, m.importId, "merge").ok).toBe(false);
    } finally {
      await a.stop();
      await c.stop();
    }
  });

  test("a pack a start cannot read keeps its uploaded files from the sweep", async () => {
    let s = start("s");
    const hash = "a".repeat(64);
    s.db
      .query(
        "INSERT INTO content_packs (id, name, version, position, source, data, installed_at) VALUES ('old', 'Old', '1.0.0', 9, 'imported', ?, 'now')",
      )
      .run(
        JSON.stringify({
          manifest: { id: "old" },
          data: { art: { items: [{ name: "Thing", file: hash, regX: 1, regY: 1 }] } },
        }),
      );
    await s.stop();
    s = start("s");
    try {
      expect(s.content.packRowHashes().has(hash)).toBe(true);
      expect(s.content.problems().content.some((p) => p.where === "packs")).toBe(true);
    } finally {
      await s.stop();
    }
  });
});
