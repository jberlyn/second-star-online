/**
 * Worn frame sets (issue #29, stage 3): a sheet is cut into frames, a layer's change goes in the
 * draft as a whole, a publish is refused while an uploaded layer lacks frames its wearers need,
 * an item only uses the layer it actually draws, and an item that goes takes its own layer with it.
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ArtFrameId } from "@secondstaronline/data";
import { createRgba, decodePng, encodePng, type Rgba } from "@secondstaronline/data/art";
import { classicData } from "@secondstaronline/data/classic";
import { type ContentData, sheetCell, WORN_SHEET } from "@secondstaronline/shared";

import { sliceWornSheet } from "../src/content/art.ts";
import { usedArt, wornSetProblems } from "../src/content/art-usage.ts";
import type { ContentActor } from "../src/content/service.ts";
import { type RunningServer, startServer } from "../src/main.ts";
import type { ArtFiles } from "../src/persistence/art-files.ts";
import { manualClock } from "./helpers/manual-clock.ts";

const ADMIN: ContentActor = { accountId: "acc-admin", name: "Admin" };

/** The frames a shield (worn in the off hand, never seen facing east) needs. */
const SHIELD_FRAMES: ArtFrameId[] = [
  "f1-n",
  "f2-n",
  "f3-n",
  "f4-n",
  "f1-s",
  "f2-s",
  "f3-s",
  "f1-w",
  "f2-w",
  "f3-w",
  "f4-w",
];

/** A worn sheet with a dot of its own colour in each of `cells`; the rest see-through. */
function sheet(cells: readonly ArtFrameId[], background = [0, 0, 0, 0]): Rgba {
  const img = createRgba(WORN_SHEET.w, WORN_SHEET.h);
  for (let i = 0; i < img.data.length; i += 4) {
    img.data.set(background, i);
  }
  cells.forEach((id, n) => {
    const { x, y } = sheetCell(id);
    img.data.set([10 + n, 20, 30, 255], ((y + 20) * img.width + x + 20) * 4);
  });
  return img;
}

describe("cutting a worn sheet", () => {
  test("each filled cell becomes a 46×45 frame, exactly; blank cells and f4-s are left out", () => {
    const cut = sliceWornSheet(sheet(["f1-n", "f3-e", "f4-s"]));
    if (typeof cut === "string") {
      throw new Error(cut);
    }
    expect([...cut.keys()]).toEqual(["f1-n", "f3-e"]);
    const f3e = cut.get("f3-e") as Rgba;
    expect([f3e.width, f3e.height]).toEqual([46, 45]);
    expect([...f3e.data.subarray((20 * 46 + 20) * 4, (20 * 46 + 20) * 4 + 4)]).toEqual([
      11, 20, 30, 255,
    ]);
  });

  test("a cell of pure green is blank too, whichever way the transparency is read", () => {
    const cut = sliceWornSheet(sheet(["f2-s"], [0, 255, 0, 255]));
    expect(typeof cut === "string" ? cut : [...cut.keys()]).toEqual(["f2-s"]);
  });

  test("a sheet of the wrong size, or with nothing on it, is refused with the reason", () => {
    expect(sliceWornSheet(createRgba(46, 45))).toContain("a worn sheet is 184×180");
    expect(sliceWornSheet(sheet([]))).toBe("every cell of the sheet is blank");
  });
});

describe("what a worn item uses", () => {
  test("only the layer it draws: after the aliases, and nothing for an item never worn", () => {
    const used = usedArt(classicData).sprites.paperdoll;
    expect(used.get("broad sword")).toBe("item Broad Sword");
    // Knight's Sword draws Broad Sword (an alias), never a layer of its own name.
    expect(used.has("knight's sword")).toBe(false);
    expect(used.has("apple")).toBe(false);
    // The engine's own layers are always in use.
    expect(used.get("bare feet")).toBe("every character");
    expect(used.get("head1")).toBe("the Male heads");
  });
});

describe("gaps a change makes (review fix)", () => {
  const withShield = (frames: ArtFrameId[]): ContentData => {
    const d = structuredClone(classicData) as ContentData;
    d.items.items.push({ name: "Star Shield" });
    d.art.paperdoll.push({
      name: "Star Shield",
      frames: Object.fromEntries(frames.map((f) => [f, { file: "a".repeat(64) }])),
    });
    return d;
  };

  test("fixing part of an old gap leaves the rest of it alone; a frame newly missing is named", () => {
    const published = withShield(SHIELD_FRAMES.filter((f) => f !== "f1-n" && f !== "f2-n"));
    // Adding f1-n leaves only the old f2-n gap: nothing new.
    expect(
      wornSetProblems(withShield(SHIELD_FRAMES.filter((f) => f !== "f2-n")), published),
    ).toEqual([]);
    // Taking out f3-n as well is new, and the message names every frame still missing.
    expect(
      wornSetProblems(
        withShield(SHIELD_FRAMES.filter((f) => !["f1-n", "f2-n", "f3-n"].includes(f))),
        published,
      ).map((p) => p.message),
    ).toEqual(["Star Shield is missing f1-n, f2-n, f3-n, which Star Shield draws"]);
  });
});

describe("worn sets on a running server", () => {
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
    const dir = mkdtempSync(join(tmpdir(), "sso-worn-art-"));
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

  /** Uploads a sheet and cuts it into frames. */
  function cut(server: RunningServer, cells: readonly ArtFrameId[]) {
    const up = server.content.upload(
      server.content.uploadTicket(ADMIN),
      "image",
      encodePng(sheet(cells)),
    );
    if (!up.body.ok) {
      throw new Error(up.body.error);
    }
    const r = server.content.wornSheet(up.body.file);
    if (!r.ok) {
      throw new Error(r.error);
    }
    return r.frames;
  }

  test("a sheet's frames are stored like uploads; nothing goes in the draft", async () => {
    const server = start();
    try {
      const frames = cut(server, ["f1-n", "f2-w"]);
      expect(Object.keys(frames)).toEqual(["f1-n", "f2-w"]);
      expect(server.content.draft()).toEqual([]);
      const f = server.content.wornSheet("0".repeat(64));
      expect(f).toEqual({ ok: false, error: "the sheet cannot be read: its file is missing" });
      // Each frame is a stored PNG of its own.
      const lib = (server.content as unknown as { art: { files: ArtFiles } }).art;
      const bytes = lib.files.read("art", frames["f2-w"] as string, "png") as Uint8Array;
      expect(decodePng(bytes).width).toBe(46);
    } finally {
      await server.stop();
    }
  });

  test("a publish waits until an uploaded layer has every frame its wearers need", async () => {
    const server = start();
    try {
      server.content.draftSet(
        ADMIN,
        { dataset: "items", part: "items", key: "Star Shield" },
        "set",
        { name: "Star Shield" },
      );
      const some = cut(server, ["f1-n", "f2-s"]);
      const set = (frames: Partial<Record<ArtFrameId, string>>) =>
        server.content.draftWorn(ADMIN, {
          op: "set",
          layer: "star shield",
          frames,
          mirrored: true,
          transparency: "alpha",
        });
      expect(set(some)).toEqual({ ok: true, value: "star shield's worn frames are in the draft." });
      expect(server.content.check()).toEqual([
        {
          where: "art/paperdoll/star shield",
          message:
            "star shield is missing f2-n, f3-n, f4-n, f1-s, f3-s, f1-w, f2-w, f3-w, f4-w, which Star Shield draws",
        },
      ]);
      expect(server.content.publish(ADMIN, server.content.draftRev(), "").ok).toBe(false);

      // The view names the layer, its needs and its wearer, from the draft.
      const view = server.content.wornArtView();
      expect(view.items.find((i) => i.name === "Star Shield")).toEqual({
        name: "Star Shield",
        slot: "RightHand",
        layer: "Star Shield",
        aliases: [],
        ownLayerPossible: false,
      });
      expect(view.layers.find((l) => l.name === "Star Shield")?.needs).toEqual(
        SHIELD_FRAMES.slice().sort(
          (a, b) =>
            ["n", "e", "s", "w"].indexOf(a.slice(3)) - ["n", "e", "s", "w"].indexOf(b.slice(3)) ||
            a.localeCompare(b),
        ),
      );
      expect(view.art.map((a) => a.name)).toEqual(["star shield"]);
      expect(view.packLayers["broad sword"]).toHaveLength(12);
      expect(view.head).toBe(1);

      // With every frame (and an east frame nothing draws, which does no harm) it publishes.
      expect(set(cut(server, [...SHIELD_FRAMES, "f1-e"])).ok).toBe(true);
      expect(server.content.check()).toEqual([]);
      expect(server.content.publish(ADMIN, server.content.draftRev(), "star shield").ok).toBe(true);
      const sprites = server.content.builtArt()?.index.atlases.paperdoll.sprites ?? {};
      expect(Object.keys(sprites)).toContain("star shield-f4-w");
      // North frames are flipped about the mirror line: 45 px wide.
      expect(sprites["star shield-f1-n"]?.[3]).toBe(45);
      expect(sprites["star shield-f1-s"]?.[3]).toBe(46);
    } finally {
      await server.stop();
    }
  });

  test("a gap a publish already had is not held against the next change", async () => {
    const server = start();
    try {
      // An upload for a layer nothing wears needs only one frame.
      expect(
        server.content.draftWorn(ADMIN, {
          op: "set",
          layer: "Star Shield",
          frames: cut(server, ["f1-s"]),
          mirrored: false,
          transparency: "alpha",
        }).ok,
      ).toBe(true);
      expect(server.content.publish(ADMIN, server.content.draftRev(), "").ok).toBe(true);
      // Making Star Shield an item opens a gap; publishing that item is refused for it...
      server.content.draftSet(
        ADMIN,
        { dataset: "items", part: "items", key: "Star Shield" },
        "set",
        { name: "Star Shield" },
      );
      expect(server.content.check().map((p) => p.where)).toEqual(["art/paperdoll/Star Shield"]);
    } finally {
      await server.stop();
    }
  });

  test("an item gets its own layer when only exact aliases name it", async () => {
    const server = start();
    try {
      const r = server.content.draftWorn(ADMIN, { op: "ownLayer", item: "knight's sword" });
      expect(r).toEqual({
        ok: true,
        value: "Knight's Sword draws a layer of its own in the draft.",
      });
      const view = server.content.wornArtView();
      expect(view.items.find((i) => i.name === "Knight's Sword")?.layer).toBe("Knight's Sword");
      expect(view.rules.aliases.some((a) => a.pattern === "Knight's Sword")).toBe(false);
      expect(
        server.content.draftWorn(ADMIN, { op: "ownLayer", item: "Steel Scimitar" }),
      ).toMatchObject({
        ok: false,
      });
    } finally {
      await server.stop();
    }
  });

  test("removing an item takes its own worn layer with it, unless another item still wears it", async () => {
    const server = start();
    try {
      const frames = cut(server, SHIELD_FRAMES);
      server.content.draftSet(
        ADMIN,
        { dataset: "items", part: "items", key: "Star Shield" },
        "set",
        { name: "Star Shield" },
      );
      server.content.draftWorn(ADMIN, {
        op: "set",
        layer: "Star Shield",
        frames,
        mirrored: false,
        transparency: "alpha",
      });
      expect(server.content.publish(ADMIN, server.content.draftRev(), "").ok).toBe(true);
      const removal = {
        kind: "item" as const,
        key: "Star Shield",
        content: "remove" as const,
        replacement: null,
        refundGold: 0,
        copies: "purge" as const,
      };
      expect(server.content.draftRemoval(ADMIN, removal).ok).toBe(true);
      expect(
        server.content
          .draft()
          .map((d) => `${d.dataset}/${d.part}/${d.key}:${d.op}`)
          .sort(),
      ).toEqual(["art/paperdoll/Star Shield:remove", "items/items/Star Shield:remove"]);
      expect(server.content.check()).toEqual([]);
    } finally {
      await server.stop();
    }
  });

  test("the usage check refuses taking out a layer an item still wears", async () => {
    const server = start();
    try {
      const d = server.content.draftContent() as ContentData;
      expect(usedArt(d).sprites.paperdoll.has("star shield")).toBe(false);
      server.content.draftSet(
        ADMIN,
        { dataset: "items", part: "items", key: "Star Shield" },
        "set",
        { name: "Star Shield" },
      );
      server.content.draftWorn(ADMIN, {
        op: "set",
        layer: "Star Shield",
        frames: cut(server, SHIELD_FRAMES),
        mirrored: false,
        transparency: "alpha",
      });
      expect(server.content.publish(ADMIN, server.content.draftRev(), "").ok).toBe(true);
      expect(server.content.draftWorn(ADMIN, { op: "remove", layer: "star shield" }).ok).toBe(true);
      expect(server.content.check()).toContainEqual({
        where: "art/paperdoll",
        message: "removing the worn layer star shield leaves item Star Shield with nothing to draw",
      });
    } finally {
      await server.stop();
    }
  });
});
