/**
 * Map tiles (issue #29, stage 6): a tileset is cut into its tiles, new tiles get codes no pack,
 * content or map uses, in the same change as their catalogue, walkable and art rows; a tile is
 * repainted, renamed, made walkable and taken out; a publish refuses a tile with no picture or one
 * taken out while a map or content still uses it, and a tile taken out takes its rows with it.
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createRgba, encodePng, type Rgba } from "@secondstaronline/data/art";
import {
  artRowFingerprint,
  content,
  isWhitelisted,
  tileFingerprint,
} from "@secondstaronline/shared";

import { contentIntent, overviewOf } from "../src/content/page.ts";
import type { ContentActor } from "../src/content/service.ts";
import { type RunningServer, startServer } from "../src/main.ts";
import { listMaps, saveMapLayers } from "../src/persistence/maps.ts";
import { manualClock } from "./helpers/manual-clock.ts";

const ADMIN: ContentActor = { accountId: "acc-admin", name: "Admin" };

/** A picture of `cols` × `rows` 32×32 cells; a cell in `blank` ("col,row") is left empty. */
function sheet(cols: number, rows: number, blank: string[] = [], size = 32): Rgba {
  const img = createRgba(cols * size, rows * size);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (blank.includes(`${c},${r}`)) {
        continue;
      }
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          img.data.set([40 + c, 80 + r, 120, 255], ((r * size + y) * img.width + c * size + x) * 4);
        }
      }
    }
  }
  return img;
}

describe("tiles on a running server", () => {
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
    const dir = mkdtempSync(join(tmpdir(), "sso-tile-art-"));
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

  function upload(server: RunningServer, img: Rgba): string {
    const up = server.content.upload(server.content.uploadTicket(ADMIN), "image", encodePng(img));
    if (!up.body.ok) {
      throw new Error(up.body.error);
    }
    return up.body.file;
  }

  /** One 32×32 tile picture, uploaded. */
  const tileFile = (server: RunningServer, shade = 0) => {
    const img = sheet(1, 1);
    img.data[0] = shade;
    return upload(server, img);
  };

  const world = (server: RunningServer) => server.game.contentWorld;

  test("a tileset is cut into its tiles; cells that show nothing are left out", async () => {
    const server = start();
    try {
      const r = server.content.tileSheet(upload(server, sheet(3, 2, ["1,0"])), "alpha");
      if (!r.ok) {
        throw new Error(r.error);
      }
      expect(r.grid).toEqual({ cols: 3, rows: 2 });
      expect(r.cells.map((c) => `${c.col},${c.row}`)).toEqual(["0,0", "2,0", "0,1", "1,1", "2,1"]);
      // A side that is not a multiple of 32 is refused.
      const odd = server.content.tileSheet(upload(server, sheet(1, 1, [], 33)), "alpha");
      expect(odd.ok ? "" : odd.error).toContain("multiples of 32");
      // Every cell blank: nothing to add.
      const none = server.content.tileSheet(upload(server, sheet(2, 1, ["0,0", "1,0"])), "alpha");
      expect(none.ok ? "" : none.error).toContain("shows nothing");
    } finally {
      await server.stop();
    }
  });

  test("new tiles get free codes with their catalogue, walkable and art rows, and publish", async () => {
    const server = start();
    try {
      // A code a map already uses (left over from a tile taken out) is never given out again.
      const free = server.content.tileArtView(world(server)).next as string;
      expect(free).toMatch(/^[A-Z0-9]{2}$/);
      const map = listMaps(server.db)[0];
      if (!map) {
        throw new Error("no seeded map");
      }
      const layer2 = [...map.layers[1]];
      layer2[0] = (layer2[0] ?? "").replace(/^\S+/, free);
      saveMapLayers(
        server.db,
        map.id,
        [map.layers[0], layer2, map.layers[2], map.layers[3]],
        "now",
      );
      const view = server.content.tileArtView(world(server));
      expect(view.next).not.toBe(free);
      expect(view.maps[free.toLowerCase()]?.names).toEqual([map.name]);

      const r = server.content.draftTile(
        ADMIN,
        {
          op: "add",
          transparency: "alpha",
          tiles: [
            { file: tileFile(server, 1), walkable: true, name: "Moss" },
            { file: tileFile(server, 2), walkable: false },
          ],
        },
        world(server),
      );
      if (!r.ok) {
        throw new Error(r.error);
      }
      const [a, b] = r.value.codes as [string, string];
      expect(a).toBe(view.next as string);
      expect(r.value.codes).not.toContain(free);
      expect(new Set(r.value.codes).size).toBe(2);
      expect(
        server.content
          .draft()
          .map((d) => `${d.dataset}/${d.part}/${d.key ?? ""}`)
          .sort(),
      ).toEqual([`art/tiles/${a}`, `art/tiles/${b}`, "tiles/catalogue/", "tiles/walkable/"].sort());
      expect(server.content.check()).toEqual([]);
      expect(server.content.publish(ADMIN, server.content.draftRev(), "", world(server)).ok).toBe(
        true,
      );
      // Live: in the catalogue, the walk test and the served art.
      expect(content().tiles.catalogue.find((t) => t.code === a)).toEqual({
        code: a,
        name: "Moss",
      });
      expect(isWhitelisted(a)).toBe(true);
      expect(isWhitelisted(b)).toBe(false);
      const sprites = server.content.builtArt()?.index.atlases.tiles.sprites ?? {};
      expect(sprites[a.toLowerCase()]).toBeDefined();
      expect(sprites[b.toLowerCase()]).toBeDefined();
    } finally {
      await server.stop();
    }
  });

  test("every picture is checked before anything is written", async () => {
    const server = start();
    try {
      const add = (file: string, transparency: "alpha" | "green" = "alpha") =>
        server.content.draftTile(
          ADMIN,
          { op: "add", transparency, tiles: [{ file, walkable: true }] },
          world(server),
        );
      expect(add(upload(server, sheet(2, 1)))).toEqual({
        ok: false,
        error: "tile 1: it is 64×32; a tile is exactly 32×32",
      });
      expect(add(upload(server, sheet(1, 1, ["0,0"])))).toEqual({
        ok: false,
        error: "tile 1: it shows nothing",
      });
      // Pure green with green keyed out shows nothing either.
      const green = createRgba(32, 32);
      for (let i = 0; i < 32 * 32; i++) {
        green.data.set([0, 255, 0, 255], i * 4);
      }
      expect(add(upload(server, green), "green")).toEqual({
        ok: false,
        error: "tile 1: it shows nothing",
      });
      expect(add("f".repeat(64)).ok).toBe(false);
      expect(server.content.draft()).toEqual([]);
    } finally {
      await server.stop();
    }
  });

  test("a tile is repainted, renamed and made walkable; a stale repaint is refused", async () => {
    const server = start();
    try {
      const first = server.content.draftTile(
        ADMIN,
        { op: "set", code: "G1", file: tileFile(server, 3), transparency: "alpha", expect: null },
        world(server),
      );
      expect(first.ok ? first.value.text : first.error).toBe("Tile G1's picture is in the draft.");
      // A second panel opened before the first save still thinks G1 has no upload.
      const stale = server.content.draftTile(
        ADMIN,
        { op: "set", code: "G1", file: tileFile(server, 4), transparency: "alpha", expect: null },
        world(server),
      );
      expect(stale.ok ? "" : stale.error).toContain("changed since you opened it");
      const fp = artRowFingerprint(server.content.tileArtView().art.find((x) => x.code === "G1"));
      expect(
        server.content.draftTile(ADMIN, { op: "remove", code: "g1", expect: fp }, world(server)).ok,
      ).toBe(true);

      const before = server.content.tileArtView();
      const walkable = before.walkable.includes("S3");
      const edit = server.content.draftTile(
        ADMIN,
        { op: "edit", code: "S3", name: "Old Tree", walkable: !walkable, flags: ["grave"] },
        world(server),
      );
      expect(edit.ok ? edit.value.text : edit.error).toBe("Tile S3's changes are in the draft.");
      const after = server.content.tileArtView();
      expect(after.catalogue.find((t) => t.code === "S3")).toMatchObject({
        name: "Old Tree",
        flags: ["grave"],
      });
      expect(after.walkable.includes("S3")).toBe(!walkable);
      // Nothing changed: refused.
      const again = server.content.draftTile(
        ADMIN,
        { op: "edit", code: "S3", name: "Old Tree", walkable: !walkable, flags: ["grave"] },
        world(server),
      );
      expect(again.ok).toBe(false);
    } finally {
      await server.stop();
    }
  });

  test("a tile in use is not taken out; a tile taken out takes its rows when published", async () => {
    const server = start();
    try {
      // G1 is the editor's first tile and on seeded maps.
      const used = server.content.draftTile(ADMIN, { op: "delete", code: "H1" }, world(server));
      expect(used.ok ? "" : used.error).toContain("is still used");
      expect(used.ok ? "" : used.error).toContain("the blank map's ground");

      const add = server.content.draftTile(
        ADMIN,
        {
          op: "add",
          transparency: "alpha",
          tiles: [{ file: tileFile(server, 5), walkable: true }],
        },
        world(server),
      );
      if (!add.ok) {
        throw new Error(add.error);
      }
      const code = add.value.codes[0] as string;
      expect(server.content.publish(ADMIN, server.content.draftRev(), "", world(server)).ok).toBe(
        true,
      );

      const del = server.content.draftTile(ADMIN, { op: "delete", code }, world(server));
      expect(del.ok ? del.value.text : del.error).toContain("out of the catalogue");
      // Only the catalogue is in the draft: discarding it would keep the walkable row and upload.
      expect(server.content.draft().map((d) => `${d.dataset}/${d.part}`)).toEqual([
        "tiles/catalogue",
      ]);
      expect(server.content.check()).toEqual([]);
      expect(server.content.publish(ADMIN, server.content.draftRev(), "", world(server)).ok).toBe(
        true,
      );
      expect(content().tiles.catalogue.some((t) => t.code === code)).toBe(false);
      expect(content().tiles.walkable.some((w) => w.code === code)).toBe(false);
      expect(server.content.publishedContent().art.tiles.some((t) => t.code === code)).toBe(false);
    } finally {
      await server.stop();
    }
  });

  test("a publish refuses a new tile with no picture, and one taken out that a map still uses", async () => {
    const server = start();
    try {
      const cat = server.content.publishedContent().tiles.catalogue;
      const ref = { dataset: "tiles", part: "catalogue", key: null } as const;
      expect(server.content.draftSet(ADMIN, ref, "set", [...cat, { code: "QQ" }]).ok).toBe(true);
      expect(server.content.check().map((p) => p.message)).toContain("tile QQ has no picture");
      server.content.draftDiscard(ref);

      // A seeded map uses its ground tile: taking it out through the JSON is refused at publish.
      const map = listMaps(server.db)[0];
      const onMap = (map?.layers[0][0] ?? "").split(" ")[0] as string;
      expect(
        server.content.draftSet(
          ADMIN,
          ref,
          "set",
          cat.filter((t) => t.code.toLowerCase() !== onMap.toLowerCase()),
        ).ok,
      ).toBe(true);
      const r = server.content.publish(ADMIN, server.content.draftRev(), "", world(server));
      expect(r.ok).toBe(false);
      const messages = r.ok ? [] : (r.problems ?? []).map((p) => p.message);
      expect(messages.some((m) => m.includes(`tile ${onMap} is taken out but is still on`))).toBe(
        true,
      );
    } finally {
      await server.stop();
    }
  });

  /** Adds one new tile and publishes it; its code. */
  function publishedTile(server: RunningServer, shade: number): string {
    const add = server.content.draftTile(
      ADMIN,
      {
        op: "add",
        transparency: "alpha",
        tiles: [{ file: tileFile(server, shade), walkable: true }],
      },
      world(server),
    );
    if (!add.ok) {
      throw new Error(add.error);
    }
    const r = server.content.publish(ADMIN, server.content.draftRev(), "", world(server));
    expect(r.ok ? "ok" : JSON.stringify(r)).toBe("ok");
    return add.value.codes[0] as string;
  }

  /** Paints `code` on the first seeded map's top-left square. */
  function paint(server: RunningServer, code: string): string {
    const map = listMaps(server.db)[0];
    if (!map) {
      throw new Error("no seeded map");
    }
    const layer1 = [...map.layers[0]];
    layer1[0] = (layer1[0] ?? "").replace(/^\S+/, code);
    saveMapLayers(server.db, map.id, [layer1, map.layers[1], map.layers[2], map.layers[3]], "now");
    return map.name;
  }

  test("undoing a publish that added a tile a map now uses is refused", async () => {
    const server = start();
    try {
      const code = publishedTile(server, 7);
      const id = server.content.history()[0]?.id as string;
      paint(server, code);
      const r = server.content.undo(ADMIN, id, world(server));
      expect(r.ok).toBe(false);
      expect(r.ok ? [] : (r.problems ?? []).map((p) => p.message)).toEqual([
        expect.stringContaining(`tile ${code} is taken out but is still on`),
      ]);
      // The Content page's checks say so before anyone presses Publish, too.
      const cat = server.content.publishedContent().tiles.catalogue;
      server.content.draftSet(
        ADMIN,
        { dataset: "tiles", part: "catalogue", key: null },
        "set",
        cat.filter((t) => t.code !== code),
      );
      expect(
        overviewOf(server.content, world(server)).problems.map((p) => p.message),
      ).toContainEqual(expect.stringContaining(`tile ${code} is taken out but is still on`));
    } finally {
      await server.stop();
    }
  });

  test("a tile added and taken out before its first publish leaves nothing behind", async () => {
    const server = start();
    try {
      const add = server.content.draftTile(
        ADMIN,
        {
          op: "add",
          transparency: "alpha",
          tiles: [{ file: tileFile(server, 8), walkable: true }],
        },
        world(server),
      );
      if (!add.ok) {
        throw new Error(add.error);
      }
      const code = add.value.codes[0] as string;
      expect(server.content.draftTile(ADMIN, { op: "delete", code }, world(server)).ok).toBe(true);
      // Its upload and walkable row went with it, and the catalogue is back as published: the
      // draft holds nothing, so there is nothing to publish (and no override is left behind).
      expect(server.content.draft()).toEqual([]);
      expect(server.content.publish(ADMIN, server.content.draftRev(), "", world(server)).ok).toBe(
        false,
      );
      const live = server.content.publishedContent();
      expect(live.art.tiles.some((t) => t.code === code)).toBe(false);
      expect(live.tiles.walkable.some((w) => w.code === code)).toBe(false);
    } finally {
      await server.stop();
    }
  });

  test("a tile code is never given out twice, and a stale panel cannot act on another tile", async () => {
    const server = start();
    try {
      const code = publishedTile(server, 9);
      const view = server.content.tileArtView(world(server));
      const seen = tileFingerprint(
        view.catalogue,
        view.walkable.map((c) => ({ code: c })),
        code,
      );
      // Taken out and published: its code stays taken.
      expect(server.content.draftTile(ADMIN, { op: "delete", code, seen }, world(server)).ok).toBe(
        true,
      );
      expect(server.content.publish(ADMIN, server.content.draftRev(), "", world(server)).ok).toBe(
        true,
      );
      const again = publishedTile(server, 10);
      expect(again).not.toBe(code);
      // A panel that saw the tile before a rename is refused.
      const view2 = server.content.tileArtView(world(server));
      const seen2 = tileFingerprint(
        view2.catalogue,
        view2.walkable.map((c) => ({ code: c })),
        again,
      );
      expect(
        server.content.draftTile(
          ADMIN,
          { op: "edit", code: again, name: "Moss", walkable: true, flags: [], seen: seen2 },
          world(server),
        ).ok,
      ).toBe(true);
      const stale = server.content.draftTile(
        ADMIN,
        { op: "delete", code: again, seen: seen2 },
        world(server),
      );
      expect(stale.ok ? "" : stale.error).toContain("changed since you opened it");
    } finally {
      await server.stop();
    }
  });

  test("a tile picture that shows nothing is refused at publish, however it was written", async () => {
    const server = start();
    try {
      const blank = upload(server, sheet(1, 1, ["0,0"]));
      // The JSON editor writes the art row itself, past the panel's checks.
      server.content.draftSet(ADMIN, { dataset: "art", part: "tiles", key: "G1" }, "set", {
        code: "G1",
        file: blank,
      });
      expect(server.content.check().map((p) => `${p.where}: ${p.message}`)).toContainEqual(
        expect.stringContaining("the tile shows nothing"),
      );
    } finally {
      await server.stop();
    }
  });

  test("a code a publish had stays taken after that publish is undone", async () => {
    const server = start();
    try {
      const code = publishedTile(server, 11);
      const id = server.content.history()[0]?.id as string;
      expect(server.content.undo(ADMIN, id, world(server)).ok).toBe(true);
      expect(server.content.publishedContent().tiles.catalogue.some((t) => t.code === code)).toBe(
        false,
      );
      expect(publishedTile(server, 12)).not.toBe(code);
    } finally {
      await server.stop();
    }
  });

  test("a publish leaves art staged for a tile the catalogue does not list yet", async () => {
    const server = start();
    try {
      // The JSON editor stages a picture first; the catalogue row comes in a later publish.
      const file = tileFile(server, 13);
      server.content.draftSet(ADMIN, { dataset: "art", part: "tiles", key: "Q7" }, "set", {
        code: "Q7",
        file,
      });
      expect(server.content.publish(ADMIN, server.content.draftRev(), "", world(server)).ok).toBe(
        true,
      );
      expect(server.content.publishedContent().art.tiles.some((t) => t.code === "Q7")).toBe(true);
    } finally {
      await server.stop();
    }
  });

  test("a tileset over the limit is refused before anything is stored; one tile is its own file", async () => {
    const server = start();
    try {
      const big = upload(server, sheet(64, 9));
      const r = server.content.tileSheet(big, "alpha", world(server));
      expect(r.ok ? "" : r.error).toContain("one file may add at most 512");
      const one = upload(server, sheet(1, 1));
      const single = server.content.tileSheet(one, "alpha", world(server));
      expect(single.ok ? single.cells : []).toEqual([{ col: 0, row: 0, file: one }]);
    } finally {
      await server.stop();
    }
  });

  test("an engine fixture's long code is refused a picture or walkability, with why", async () => {
    const server = start();
    try {
      const fixture = server.content
        .publishedContent()
        .tiles.catalogue.find((t) => t.code.length !== 2)?.code as string;
      expect(fixture).toBeDefined();
      const set = server.content.draftTile(
        ADMIN,
        { op: "set", code: fixture, file: tileFile(server, 14), transparency: "alpha" },
        world(server),
      );
      expect(set.ok ? "" : set.error).toContain("not a 2-character tile code");
      const walk = server.content.draftTile(
        ADMIN,
        { op: "edit", code: fixture, name: "Bells", walkable: true, flags: [] },
        world(server),
      );
      expect(walk.ok ? "" : walk.error).toContain("cannot be made walkable");
      // Naming it is fine.
      expect(
        server.content.draftTile(
          ADMIN,
          { op: "edit", code: fixture, name: "Bells", walkable: false, flags: [] },
          world(server),
        ).ok,
      ).toBe(true);
    } finally {
      await server.stop();
    }
  });

  test("the intent answers with the codes the server gave", async () => {
    const server = start();
    try {
      const reply = contentIntent(
        server.content,
        ADMIN,
        {
          t: "contentTile",
          seq: 4,
          change: {
            op: "add",
            transparency: "alpha",
            tiles: [{ file: tileFile(server, 6), walkable: false }],
          },
        },
        world(server),
      );
      expect(reply).toMatchObject({ t: "contentResult", seq: 4, ok: true });
      expect((reply as { codes?: string[] }).codes).toHaveLength(1);
    } finally {
      await server.stop();
    }
  });
});
