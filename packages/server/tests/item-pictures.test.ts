/**
 * Item pictures (issue #29, stage 2): whether an item has a picture is whether the art draws it
 * (so `/drop` takes a new item once it has one, with no `icon` to keep in step), an item's upload
 * goes with the item unless another item still draws it, and the Content page's picker gets the
 * draft's items and pictures in one answer.
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createRgba, encodePng } from "@secondstaronline/data/art";
import { classicData } from "@secondstaronline/data/classic";
import { buildContentStore, type ContentData, installContent } from "@secondstaronline/shared";

import { usedArt } from "../src/content/art-usage.ts";
import { contentIntent } from "../src/content/page.ts";
import type { ContentActor } from "../src/content/service.ts";
import type { ContentWorld } from "../src/content/world.ts";
import { type RunningServer, startServer } from "../src/main.ts";
import { hasItemPicture, parseDrop } from "../src/systems/admin/drop.ts";
import { manualClock } from "./helpers/manual-clock.ts";

const ADMIN: ContentActor = { accountId: "acc-admin", name: "Admin" };

/** A 12×12 red square with a 2 px see-through border. */
function square(): Uint8Array {
  const img = createRgba(12, 12);
  for (let y = 2; y < 10; y++) {
    for (let x = 2; x < 10; x++) {
      img.data.set([200, 30, 30, 255], (y * 12 + x) * 4);
    }
  }
  return encodePng(img);
}

describe("an item has a picture when the art draws it", () => {
  test("Classic's items with an icon are exactly the ones whose picture the art draws", () => {
    installContent(buildContentStore(classicData));
    const mismatched = classicData.items.items.filter(
      (i) => hasItemPicture(i.name) !== (i.icon !== null),
    );
    expect(mismatched.map((i) => i.name)).toEqual([]);
    // Gold and the containers have none: /drop refuses them, as before.
    expect(parseDrop("Cabinet")).toBeNull();
    expect(parseDrop("Long Sword")).toEqual({ item: "Long Sword", qty: 1 });
  });

  test("a new item needs no icon: it is dropped once it draws a picture", () => {
    const d = structuredClone(classicData) as ContentData;
    d.items.items.push({ name: "Moonblade" }, { name: "Starblade", sprite: "Long Sword" });
    installContent(buildContentStore(d));
    try {
      expect(parseDrop("Moonblade")).toBeNull();
      expect(parseDrop("Starblade")).toEqual({ item: "Starblade", qty: 1 });
      d.rects.items.moonblade = [8, 8, 4, 4];
      installContent(buildContentStore(d));
      expect(parseDrop("Moonblade")).toEqual({ item: "Moonblade", qty: 1 });
    } finally {
      installContent(buildContentStore(classicData));
    }
  });
});

describe("item pictures on a running server", () => {
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

  function start(): RunningServer {
    const dir = mkdtempSync(join(tmpdir(), "sso-item-art-"));
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
    });
    server.db
      .query(
        "INSERT OR IGNORE INTO accounts (id, username, password_hash, role, created_at, updated_at) VALUES (?, ?, 'x', 'administrator', 'now', 'now')",
      )
      .run(ADMIN.accountId, "admin");
    return server;
  }

  /** Publishes a new item with an uploaded picture, and a second item, `also`, if given. */
  function withPicture(server: RunningServer, also: Record<string, unknown>[] = []): void {
    const up = server.content.upload(server.content.uploadTicket(ADMIN), "image", square());
    if (!up.body.ok) {
      throw new Error(up.body.error);
    }
    const file = up.body;
    const set = (dataset: string, part: string, key: string, data: unknown) =>
      expect(server.content.draftSet(ADMIN, { dataset, part, key } as never, "set", data).ok).toBe(
        true,
      );
    set("items", "items", "Moonblade", { name: "Moonblade" });
    for (const row of also) {
      set("items", "items", String(row.name), row);
    }
    set("art", "items", "Moonblade", { name: "Moonblade", file: file.file, regX: 6, regY: -6 });
    const pub = server.content.publish(ADMIN, server.content.draftRev(), "moonblade");
    expect(pub.ok).toBe(true);
  }

  test("an uploaded picture lets /drop make the item", async () => {
    const server = start();
    try {
      expect(parseDrop("Moonblade")).toBeNull();
      withPicture(server);
      expect(parseDrop("Moonblade")).toEqual({ item: "Moonblade", qty: 1 });
    } finally {
      await server.stop();
    }
  });

  test("removing an item takes its upload with it; retiring it keeps the picture", async () => {
    const server = start();
    try {
      withPicture(server);
      const removal = {
        kind: "item" as const,
        key: "Moonblade",
        content: "remove" as const,
        replacement: null,
        refundGold: 0,
      };
      expect(server.content.draftRemoval(ADMIN, { ...removal, copies: "retire" }).ok).toBe(true);
      expect(server.content.draft().map((d) => `${d.dataset}/${d.key}:${d.op}`)).toEqual([
        "items/Moonblade:set",
      ]);
      server.content.draftDiscard({ dataset: "items", part: "items", key: "Moonblade" });
      expect(server.content.draftRemoval(ADMIN, { ...removal, copies: "purge" }).ok).toBe(true);
      expect(
        server.content
          .draft()
          .map((d) => `${d.dataset}/${d.key}:${d.op}`)
          .sort(),
      ).toEqual(["art/Moonblade:remove", "items/Moonblade:remove"]);
      expect(server.content.check()).toEqual([]);
    } finally {
      await server.stop();
    }
  });

  test("an upload another item still draws stays when its own item goes", async () => {
    const server = start();
    try {
      withPicture(server, [{ name: "Sunblade", sprite: "Moonblade" }]);
      expect(
        server.content.draftRemoval(ADMIN, {
          kind: "item",
          key: "Moonblade",
          content: "remove",
          replacement: null,
          copies: "purge",
          refundGold: 0,
        }).ok,
      ).toBe(true);
      expect(server.content.draft().map((d) => `${d.dataset}/${d.key}:${d.op}`)).toEqual([
        "items/Moonblade:remove",
      ]);
      expect(server.content.check()).toEqual([]);
    } finally {
      await server.stop();
    }
  });

  test("a picture change keeps an edit made to the row meanwhile, and is made whole", async () => {
    const server = start();
    try {
      withPicture(server, [{ name: "Sunblade", sprite: "Long Sword" }]);
      // Another admin renames Sunblade after the picker loaded it.
      server.content.draftSet(ADMIN, { dataset: "items", part: "items", key: "Sunblade" }, "set", {
        name: "Sunblade",
        sprite: "Long Sword",
        display: "Sun Blade",
      });
      const file = server.content.draftContent().art.items[0]?.file as string;
      const r = server.content.draftPicture(ADMIN, {
        op: "upload",
        item: "sunblade",
        art: { file, regX: 6, regY: -6, transparency: "green" },
      });
      expect(r).toEqual({ ok: true, value: "Sunblade's picture is in the draft." });
      const d = server.content.draftContent();
      expect(d.items.items.find((i) => i.name === "Sunblade")).toEqual({
        name: "Sunblade",
        display: "Sun Blade",
      });
      expect(d.art.items.find((a) => a.name === "Sunblade")).toEqual({
        name: "Sunblade",
        file,
        regX: 6,
        regY: -6,
        transparency: "green",
      });
      // A picture nothing draws is refused, and nothing is written.
      const before = server.content.draftRev();
      expect(
        server.content.draftPicture(ADMIN, {
          op: "choose",
          item: "Sunblade",
          picture: "No Such Picture",
        }),
      ).toMatchObject({ ok: false, error: "There is no picture called No Such Picture." });
      expect(server.content.draftRev()).toBe(before);
      // Choosing a pack picture takes out the draft-only upload: its draft change is dropped.
      expect(
        server.content.draftPicture(ADMIN, {
          op: "choose",
          item: "Sunblade",
          picture: "Long Sword",
        }).ok,
      ).toBe(true);
      expect(server.content.draft().some((r) => r.dataset === "art" && r.key === "Sunblade")).toBe(
        false,
      );
      expect(server.content.check()).toEqual([]);
    } finally {
      await server.stop();
    }
  });

  test("removing an item that borrows another's upload leaves that upload; its own goes", async () => {
    const server = start();
    try {
      withPicture(server, [{ name: "Sunblade", sprite: "Moonblade" }]);
      // Sunblade also has an upload of its own, unused while it borrows Moonblade's.
      const file = server.content.draftContent().art.items[0]?.file as string;
      server.content.draftSet(ADMIN, { dataset: "art", part: "items", key: "Sunblade" }, "set", {
        name: "Sunblade",
        file,
        regX: 1,
        regY: 1,
      });
      expect(server.content.publish(ADMIN, server.content.draftRev(), "own").ok).toBe(true);
      expect(
        server.content.draftRemoval(ADMIN, {
          kind: "item",
          key: "Sunblade",
          content: "remove",
          replacement: null,
          copies: "purge",
          refundGold: 0,
        }).ok,
      ).toBe(true);
      expect(
        server.content
          .draft()
          .map((d) => `${d.dataset}/${d.key}:${d.op}`)
          .sort(),
      ).toEqual(["art/Sunblade:remove", "items/Sunblade:remove"]);
    } finally {
      await server.stop();
    }
  });

  test("a retirement that settles into a removal at publish takes the item's upload too", async () => {
    const server = start();
    try {
      withPicture(server);
      expect(
        server.content.draftRemoval(ADMIN, {
          kind: "item",
          key: "Moonblade",
          content: "remove",
          replacement: null,
          copies: "retire",
          refundGold: 0,
        }).ok,
      ).toBe(true);
      // Nobody holds a copy, so the publish removes the item outright.
      const world: ContentWorld = {
        usage: () => [],
        holders: () => 0,
        begin: () => {},
        tell: () => {},
        apply: () => [],
        problems: () => [],
        rollback: () => {},
        commit: () => {},
      };
      const pub = server.content.publish(ADMIN, server.content.draftRev(), "retire", world);
      expect(pub.ok).toBe(true);
      const live = server.content.publishedContent();
      expect(live.items.items.some((i) => i.name === "Moonblade")).toBe(false);
      expect(live.art.items.some((a) => a.name === "Moonblade")).toBe(false);
    } finally {
      await server.stop();
    }
  });

  test("the currency's piles count as in use", () => {
    const used = usedArt(classicData as ContentData).sprites.items;
    expect(used.get("smallgold")).toBe("the currency's piles");
    expect(used.has("largegold")).toBe(true);
  });

  test("the picker's view: the draft's items, their pictures and the currency", async () => {
    const server = start();
    try {
      withPicture(server);
      server.content.draftSet(ADMIN, { dataset: "items", part: "items", key: "Duskblade" }, "set", {
        name: "Duskblade",
        sprite: "Moonblade",
      });
      const reply = contentIntent(server.content, ADMIN, { t: "contentItemArt", seq: 4 });
      if (reply.t !== "contentItemArt") {
        throw new Error(reply.t);
      }
      expect(reply.seq).toBe(4);
      expect(reply.view.currency).toBe("Gold");
      expect(reply.view.maxSide).toBe(512);
      expect(reply.view.packPictures).toContain("long sword");
      expect(reply.view.items.find((i) => i.name === "Duskblade")).toEqual({
        name: "Duskblade",
        sprite: "Moonblade",
      });
      expect(reply.view.art).toEqual([
        { name: "Moonblade", file: expect.any(String), regX: 6, regY: -6 },
      ]);
    } finally {
      await server.stop();
    }
  });
});
