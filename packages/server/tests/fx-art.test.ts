/**
 * Spell effect runs (issue #29, stage 5): a strip is cut into its run's and trail's frames, a run
 * is saved whole (from its spell, with the spell playing every frame), a publish refuses a spell
 * run drawn short, and a spell that goes takes its own uploads with it.
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createRgba, encodePng, type Rgba } from "@secondstaronline/data/art";
import { classicData } from "@secondstaronline/data/classic";
import { content, type FxFrameFile, fxRuns } from "@secondstaronline/shared";

import { fxTailHidden, sliceFxSheet, withArtRects } from "../src/content/art.ts";
import { newFxGaps, usedArt } from "../src/content/art-usage.ts";
import { contentIntent } from "../src/content/page.ts";
import { mergePackArt } from "../src/content/served-assets.ts";
import type { ContentActor } from "../src/content/service.ts";
import { type RunningServer, startServer } from "../src/main.ts";
import { manualClock } from "./helpers/manual-clock.ts";

const ADMIN: ContentActor = { accountId: "acc-admin", name: "Admin" };

/** A strip of `across` × `rows` cells of `size`, the first `drawn[row]` cells of each row drawn. */
function strip(size: number, across: number, drawn: number[]): Rgba {
  const img = createRgba(size * across, size * drawn.length);
  drawn.forEach((n, row) => {
    for (let i = 0; i < n; i++) {
      for (let dy = 2; dy < size - 2; dy++) {
        for (let dx = 2; dx < size - 2; dx++) {
          img.data.set(
            [10 + i, 20 + row, 30, 255],
            ((row * size + dy) * img.width + i * size + dx) * 4,
          );
        }
      }
    }
  });
  return img;
}

describe("cutting a strip", () => {
  test("one row, or two (the run, then its trail); trailing blank cells are dropped", () => {
    const cut = sliceFxSheet(strip(16, 5, [5, 3]), { across: 5, runRows: 1, trailRows: 1 });
    if (typeof cut === "string") {
      throw new Error(cut);
    }
    expect(cut.cell).toEqual({ w: 16, h: 16 });
    expect([cut.frames.length, cut.trail.length]).toEqual([5, 3]);
    // Frame 4 is the fourth cell: colour 10 + 3.
    const f4 = cut.frames[3] as Rgba;
    expect([...f4.data.subarray((5 * 16 + 5) * 4, (5 * 16 + 5) * 4 + 4)]).toEqual([
      13, 20, 30, 255,
    ]);
  });

  test("a strip that does not divide, or with a blank frame inside it, is refused", () => {
    expect(sliceFxSheet(strip(16, 5, [5]), { across: 3, runRows: 1, trailRows: 0 })).toContain(
      "divide by 3",
    );
    const gap = strip(16, 3, [3]);
    gap.data.fill(0, 0, gap.data.length);
    expect(sliceFxSheet(gap, { across: 3, runRows: 1, trailRows: 0 })).toContain(
      "run rows show nothing",
    );
  });
});

describe("what draws a run", () => {
  test("spell runs that show frames, their trails, and the engine's runs count as in use", () => {
    const used = usedArt(classicData).sprites.fx;
    expect(used.get("crush")).toBe("spell Crush");
    expect(used.get("xfirebolt")).toBe("spell Firebolt");
    // A run with no trail has no trail in use; the runs SSO drew for 1.6's dead spells show.
    expect(used.has("xcrush")).toBe(false);
    expect(used.get("bless")).toBe("spell Bless");
    expect(used.get("fishing")).toBe("fishing");
  });
});

describe("effects on a running server", () => {
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
    const dir = mkdtempSync(join(tmpdir(), "sso-fx-art-"));
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

  /** Uploads a strip of `n` 16×16 frames (and `trail` trail frames) and cuts it. */
  function frames(
    server: RunningServer,
    n: number,
    trail = 0,
  ): { frames: FxFrameFile[]; trail: FxFrameFile[] } {
    const across = Math.max(n, trail);
    const r = server.content.fxSheet(
      upload(server, strip(16, across, trail > 0 ? [n, trail] : [n])),
      { across, runRows: 1, trailRows: trail > 0 ? 1 : 0 },
    );
    if (!r.ok) {
      throw new Error(r.error);
    }
    const anchored = (file: string) => ({ file, regX: 8, regY: 8 });
    return { frames: r.frames.map(anchored), trail: r.trail.map(anchored) };
  }

  const seen = (server: RunningServer, run: string) =>
    fxRuns(server.content.draftContent()).get(run.toLowerCase())?.users ?? [];

  /** A new spell that behaves as Minor Heal (which acts on frame 3), with one point run of `n` frames named `member`. */
  function sparkle(server: RunningServer, member: string, n: number) {
    const crush = classicData.spells.spells.find((s) => s.name === "Minor Heal");
    const row = {
      ...crush,
      name: "Sparkle",
      id: null,
      book: null,
      fx: [{ ...crush?.fx[0], member, effect: "Minor Heal", frames: n, lastFrame: n }],
    };
    const r = server.content.draftSet(
      ADMIN,
      { dataset: "spells", part: "spells", key: "Sparkle" },
      "set",
      row,
    );
    expect(r.ok ? "ok" : r.error).toBe("ok");
  }

  test("from its spell, a run's frames and the spell's length go in as one change, and publish", async () => {
    const server = start();
    try {
      const set = frames(server, 20);
      const r = server.content.draftFx(ADMIN, {
        op: "set",
        run: "crush",
        ...set,
        trail: null,
        transparency: "alpha",
        seen: seen(server, "Crush"),
        fit: true,
      });
      expect(r).toEqual({
        ok: true,
        value: {
          text: "Crush's frames are in the draft, and its spell plays all 20.",
          run: "Crush",
        },
      });
      expect(
        server.content
          .draft()
          .map((d) => `${d.dataset}/${d.key}`)
          .sort(),
      ).toEqual(["art/Crush", "spells/Crush"]);
      expect(server.content.check()).toEqual([]);
      expect(server.content.publish(ADMIN, server.content.draftRev(), "").ok).toBe(true);
      const sprites = server.content.builtArt()?.index.atlases.fx.sprites ?? {};
      expect(Object.keys(sprites).filter((k) => k.startsWith("crush-")).length).toBe(20);
      expect(content().spells.spells.find((s) => s.name === "Crush")?.fx[0]?.lastFrame).toBe(20);
      // The view shows the upload and the spell's new length.
      const view = server.content.fxArtView();
      expect(view.art.map((a) => a.name)).toEqual(["Crush"]);
      expect(view.runs.find((u) => u.member === "Crush")?.needs).toBe(20);
      expect(view.packRuns.crush).toEqual({ frames: 30, trail: 0 });
    } finally {
      await server.stop();
    }
  });

  test("a run with fewer frames than it shows, or a repaint the panel did not list, is refused", async () => {
    const server = start();
    try {
      const set = frames(server, 8);
      const base = {
        op: "set" as const,
        run: "Crush",
        ...set,
        trail: null,
        transparency: "alpha" as const,
      };
      expect(server.content.draftFx(ADMIN, { ...base, seen: seen(server, "Crush") })).toMatchObject(
        {
          ok: false,
          error: expect.stringContaining("shows 30 frames but the upload has 8"),
        },
      );
      expect(server.content.draftFx(ADMIN, { ...base, seen: [], fit: true })).toMatchObject({
        ok: false,
        error: expect.stringContaining("is now drawn by spell Crush"),
      });
      expect(server.content.draft()).toEqual([]);
    } finally {
      await server.stop();
    }
  });

  test("every frame is checked before anything is written: there, at most 512, showing something", async () => {
    const server = start();
    try {
      const set = frames(server, 30);
      const base = {
        op: "set" as const,
        run: "Crush",
        trail: null,
        transparency: "alpha" as const,
        seen: seen(server, "Crush"),
      };
      const blank = upload(server, createRgba(16, 16));
      const big = upload(server, strip(600, 1, [1]));
      const swap = (i: number, file: string) =>
        set.frames.map((f, j) => (j === i ? { ...f, file } : f));
      expect(server.content.draftFx(ADMIN, { ...base, frames: swap(4, blank) })).toEqual({
        ok: false,
        error: "frame 5 shows nothing: every frame of a run is drawn",
      });
      expect(server.content.draftFx(ADMIN, { ...base, frames: swap(0, big) })).toEqual({
        ok: false,
        error: "frame 1 is 600×600; effect frames may be at most 512×512",
      });
      expect(
        server.content.draftFx(ADMIN, { ...base, frames: swap(2, "0".repeat(64)) }),
      ).toMatchObject({
        ok: false,
        error: expect.stringContaining("frame 3:"),
      });
      // Pure green read as see-through is blank too.
      const green = createRgba(16, 16);
      for (let i = 0; i < green.data.length; i += 4) {
        green.data.set([0, 255, 0, 255], i);
      }
      expect(
        server.content.draftFx(ADMIN, {
          ...base,
          frames: swap(1, upload(server, green)),
          transparency: "green",
        }),
      ).toMatchObject({ ok: false, error: expect.stringContaining("frame 2 shows nothing") });
      expect(server.content.draft()).toEqual([]);
    } finally {
      await server.stop();
    }
  });

  test("a trail is saved with its run; the page's answer names the run", async () => {
    const server = start();
    try {
      const set = frames(server, 16, 16);
      const reply = contentIntent(server.content, ADMIN, {
        t: "contentFx",
        seq: 4,
        change: {
          op: "set",
          run: "firebolt",
          frames: set.frames,
          trail: set.trail,
          transparency: "alpha",
          seen: seen(server, "Firebolt"),
        },
      });
      expect(reply).toMatchObject({ t: "contentResult", seq: 4, ok: true, run: "Firebolt" });
      expect(server.content.draftContent().art.fx[0]?.trail).toHaveLength(16);
      expect(server.content.check()).toEqual([]);
      const sheet = contentIntent(server.content, ADMIN, {
        t: "contentFxSheet",
        seq: 5,
        sheet: upload(server, strip(16, 4, [4])),
        across: 3,
        runRows: 1,
        trailRows: 0,
      });
      expect(sheet).toMatchObject({
        t: "contentFxSheet",
        frames: null,
        error: expect.stringContaining("divide by 3"),
      });
    } finally {
      await server.stop();
    }
  });

  test("a spell run newly named with nothing to draw is refused at publish; an old gap is not", async () => {
    const server = start();
    try {
      sparkle(server, "Sparkle", 3);
      expect(server.content.check()).toContainEqual({
        where: "art/fx",
        message:
          "the effect Sparkle has no frames 1 to 3, so spell Sparkle would show (and hit with) nothing there",
      });
      const set = frames(server, 3);
      expect(
        server.content.draftFx(ADMIN, {
          op: "set",
          run: "Sparkle",
          ...set,
          trail: null,
          transparency: "alpha",
          seen: seen(server, "Sparkle"),
        }).ok,
      ).toBe(true);
      expect(server.content.check()).toEqual([]);
      expect(server.content.publish(ADMIN, server.content.draftRev(), "").ok).toBe(true);
      // Its row now shows 5 frames: the upload has 3, so the pack cannot fill 4 and 5.
      const row = server.content.draftContent().spells.spells.find((s) => s.name === "Sparkle");
      server.content.draftSet(ADMIN, { dataset: "spells", part: "spells", key: "Sparkle" }, "set", {
        ...row,
        fx: [{ ...row?.fx[0], lastFrame: 5 }],
      });
      expect(server.content.check()).toContainEqual({
        where: "art/fx/Sparkle",
        message: "Sparkle is missing frames 4 to 5, which spell Sparkle shows",
      });
    } finally {
      await server.stop();
    }
  });

  test("a spell that goes takes its own uploads with it when published; discarding the removal keeps them", async () => {
    const server = start();
    try {
      sparkle(server, "Sparkle", 3);
      const set = frames(server, 3);
      server.content.draftFx(ADMIN, {
        op: "set",
        run: "Sparkle",
        ...set,
        trail: null,
        transparency: "alpha",
        seen: seen(server, "Sparkle"),
      });
      expect(server.content.publish(ADMIN, server.content.draftRev(), "").ok).toBe(true);
      // Sol 5: a newer upload only the draft has, then the spell's removal, then discarding it.
      const newer = frames(server, 3);
      expect(
        server.content.draftFx(ADMIN, {
          op: "set",
          run: "Sparkle",
          ...newer,
          trail: null,
          transparency: "green",
          seen: seen(server, "Sparkle"),
        }).ok,
      ).toBe(true);
      const ref = { dataset: "spells", part: "spells", key: "Sparkle" } as const;
      expect(server.content.draftSet(ADMIN, ref, "remove", null).ok).toBe(true);
      // The removal is worked out at publish: the draft holds only the spell's own row.
      expect(
        server.content
          .draft()
          .map((d) => `${d.op} ${d.dataset}/${d.key}`)
          .sort(),
      ).toEqual(["remove spells/Sparkle", "set art/Sparkle"]);
      expect(server.content.draftDiscard(ref).ok).toBe(true);
      expect(server.content.draftContent().art.fx[0]?.transparency).toBe("green");
      // Removed again and published, the upload goes with it.
      expect(server.content.draftSet(ADMIN, ref, "remove", null).ok).toBe(true);
      expect(server.content.check()).toEqual([]);
      expect(server.content.publish(ADMIN, server.content.draftRev(), "").ok).toBe(true);
      expect(server.content.publishedContent().art.fx).toEqual([]);
      expect(
        server.content.publishedContent().spells.spells.some((x) => x.name === "Sparkle"),
      ).toBe(false);
    } finally {
      await server.stop();
    }
  });

  test("taking an upload out brings the pack's run back; one only the draft adds is dropped", async () => {
    const server = start();
    try {
      const set = frames(server, 30);
      server.content.draftFx(ADMIN, {
        op: "set",
        run: "Crush",
        ...set,
        trail: null,
        transparency: "alpha",
        seen: seen(server, "Crush"),
      });
      expect(server.content.draftFx(ADMIN, { op: "remove", run: "crush" })).toMatchObject({
        ok: true,
        value: { run: "Crush" },
      });
      expect(server.content.draft()).toEqual([]);
      expect(server.content.draftFx(ADMIN, { op: "remove", run: "Crush" })).toEqual({
        ok: false,
        error: "Crush has no upload to take out.",
      });
    } finally {
      await server.stop();
    }
  });
});

describe("review fixes (Sol, stage 5)", () => {
  test("Sol 1: the gap check is bounded by the frames there are, whatever a row's lastFrame", () => {
    const huge = structuredClone(classicData);
    const crush = huge.spells.spells.find((x) => x.name === "Crush");
    (crush?.fx[0] as { lastFrame: number }).lastFrame = 1_000_000_000;
    const packs = {
      sprites: {
        fx: new Set(Array.from({ length: 30 }, (_, i) => `crush-${i + 1}`)),
        items: new Set<string>(),
        paperdoll: new Set<string>(),
        bodies: new Set<string>(),
        tiles: new Set<string>(),
      },
      sounds: new Set<string>(),
    };
    const started = performance.now();
    const problems = newFxGaps(huge, classicData, packs);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(problems).toContainEqual({
      where: "art/fx",
      message:
        "the effect Crush has no frames 31 to 1000000000, so spell Crush would show (and hit with) nothing there",
    });
  });

  test("Sol 2: an uploaded run hides the packs' frames after its last; a pack trail stays", () => {
    const hidden = fxTailHidden(["bsmith-1", "xfirebolt-1", "xfirebolt-2"]);
    expect(hidden("bsmith-1")).toBe(false);
    expect(hidden("bsmith-2")).toBe(true);
    expect(hidden("bsmith-13")).toBe(true);
    expect(hidden("xfirebolt-3")).toBe(true);
    // Firebolt's own run is not uploaded: its pack frames stay.
    expect(hidden("firebolt-5")).toBe(false);
    const sprite = [0, 0, 0, 4, 4, 2, 2] as const;
    const pack = {
      version: 1,
      inputHash: "p",
      atlases: {
        fx: {
          sheets: ["fx-0.png"],
          sprites: Object.fromEntries(
            [...Array.from({ length: 13 }, (_, i) => `bsmith-${i + 1}`), "xfishing-1"].map((k) => [
              k,
              sprite,
            ]),
          ),
        },
      },
      sounds: {},
    };
    const operator = {
      version: 1,
      inputHash: "o",
      atlases: { fx: { sheets: ["fx-o.png"], sprites: { "bsmith-1": sprite } } },
      sounds: {},
    };
    const engine = { version: 1, atlases: {}, sounds: {}, ui: {} };
    const merged = mergePackArt(engine as never, [
      { id: "classic", art: pack as never },
      { id: "operator", art: operator as never, prefix: "operator/" },
    ]);
    const keys = Object.keys(merged.atlases.fx?.sprites ?? {});
    expect(keys.filter((k) => k.startsWith("bsmith"))).toEqual(["bsmith-1"]);
    expect(merged.atlases.fx?.sprites["bsmith-1"]?.[0]).toBe(1);
    expect(keys).toContain("xfishing-1");
    // And the hit rects: the pack's frames after the upload's last are not hit.
    const rect = [4, 4, 2, 2] as [number, number, number, number];
    const packRects: Record<string, [number, number, number, number]> = {
      "bsmith-1": rect,
      "bsmith-2": rect,
      "crush-1": rect,
    };
    const withRects = withArtRects(
      { rects: { fx: packRects, chars: {}, items: {} } },
      { fx: { "bsmith-1": [8, 8, 4, 4] }, chars: {}, items: {} },
    );
    expect(withRects.rects.fx).toEqual({ "bsmith-1": [8, 8, 4, 4], "crush-1": rect });
  });

  test("Sol 1: a spell row whose run shows more than 99 frames is refused", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sso-fx-art-"));
    const clientDir = join(dir, "client");
    mkdirSync(clientDir);
    writeFileSync(join(clientDir, "index.html"), "<!doctype html><title>x</title>");
    const spy = spyOn(console, "log").mockImplementation(() => {});
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
    try {
      const crush = classicData.spells.spells.find((x) => x.name === "Crush");
      const r = server.content.draftSet(
        ADMIN,
        { dataset: "spells", part: "spells", key: "Crush" },
        "set",
        { ...crush, fx: [{ ...crush?.fx[0], lastFrame: 1_000_000 }] },
      );
      expect(r.ok).toBe(false);
    } finally {
      await server.stop();
      spy.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("review fixes (Neon, stage 5)", () => {
  test("Neon 2: a publish that shows a spell's run short of its effect's frame is refused", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sso-fx-art-"));
    const clientDir = join(dir, "client");
    mkdirSync(clientDir);
    writeFileSync(join(clientDir, "index.html"), "<!doctype html><title>x</title>");
    const spy = spyOn(console, "log").mockImplementation(() => {});
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
    try {
      const crush = classicData.spells.spells.find((x) => x.name === "Crush");
      const r = server.content.draftSet(
        ADMIN,
        { dataset: "spells", part: "spells", key: "Crush" },
        "set",
        { ...crush, fx: [{ ...crush?.fx[0], lastFrame: 10 }] },
      );
      expect(r.ok).toBe(true);
      expect(server.content.check()).toContainEqual({
        where: "spells/spells/Crush",
        message:
          "Crush shows 10 frames, but its effect (Crush) acts on frame 18: spell Crush would do nothing",
      });
    } finally {
      await server.stop();
      spy.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
