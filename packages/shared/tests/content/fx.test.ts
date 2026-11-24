/**
 * Spell effect runs (issue #29, stage 5): who draws each run and how many frames show, the strip
 * a run is uploaded in, where its frames are anchored, and the draft rows a change writes.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { ArtFx } from "@secondstaronline/data";
import { classicData } from "@secondstaronline/data/classic";
import { DATASET_SCHEMAS } from "@secondstaronline/data/schema";

import golden from "../../../data/tests/art-golden.json";
import {
  artRowFingerprint,
  defaultFxAnchor,
  FX_TRIGGER_FRAMES,
  type FxContent,
  type FxPlanInput,
  type FxSpellRow,
  type FxSpellRun,
  fxFrameFileName,
  fxFramesOf,
  fxNameClash,
  fxRuns,
  fxSheetCell,
  fxTriggerProblems,
  guessFxSheet,
  orphanedFxUploads,
  type Pixels,
  planFx,
  spriteCentre,
  stepFx,
  stripFrames,
} from "../../src/index.ts";

const FILE = "a".repeat(64);
const classic = classicData as unknown as FxContent;

/** An image `w`×`h` with one dot at (x, y) (none when x is negative). */
const img = (w: number, h: number, dots: [number, number][] = [[1, 1]]): Pixels => {
  const data = new Uint8Array(w * h * 4);
  for (const [x, y] of dots) {
    data.set([200, 30, 30, 255], (y * w + x) * 4);
  }
  return { width: w, height: h, data };
};

describe("what draws a run", () => {
  test("Classic: a point run shows to its lastFrame, a projectile cycles three, a trail follows", () => {
    const runs = fxRuns(classic);
    expect(runs.get("crush")).toMatchObject({ show: "point", needs: 30, trail: 0, spell: "Crush" });
    expect(runs.get("firebolt")).toMatchObject({ needs: 16, trail: 16 });
    expect(runs.get("hold")).toMatchObject({ needs: 7, trail: 7 });
    expect(runs.get("fireballl")).toMatchObject({
      show: "projectile",
      needs: 3,
      projectile: { axis: "locH", px: -8 },
    });
    // 1.6's dead spells show nothing.
    expect(runs.get("bless")).toMatchObject({ show: "none", needs: 0 });
    // xSmokeoBomb is a run of its own (frame 9 is never shown).
    expect(runs.get("xsmokeobomb")).toMatchObject({ needs: 8, trail: 0 });
  });

  test("the engine's runs and the names content gives them", () => {
    const runs = fxRuns(classic);
    expect(runs.get("sprinkle")).toMatchObject({ show: "engine", needs: 5, content: true });
    expect(runs.get("slot machine")).toMatchObject({ needs: 52, content: true });
    expect(runs.get("fishing")).toMatchObject({ needs: 13, content: false, users: ["fishing"] });
    expect(runs.get("bsmith")).toMatchObject({ needs: 13, content: false });
    expect(runs.get("blue arrowsr")).toMatchObject({ needs: 1, users: ["Blue Arrows"] });
    expect(runs.get("cannonballshotd")).toMatchObject({ needs: 4 });
  });

  test("Classic's art draws every frame its runs show", () => {
    // The Classic pack's FX keys, from the art golden (the built atlases are not committed).
    const keys = Object.keys(golden.classic)
      .filter((k) => k.startsWith("fx:"))
      .map((k) => k.slice(3));
    const frames = fxFramesOf(keys);
    for (const use of fxRuns(classic).values()) {
      for (let n = 1; n <= use.needs; n++) {
        expect(`${use.member} ${frames.get(use.member.toLowerCase())?.has(n)}`).toBe(
          `${use.member} true`,
        );
      }
      for (let n = 1; n <= use.trail; n++) {
        expect(frames.get(`x${use.member.toLowerCase()}`)?.has(n)).toBe(true);
      }
    }
  });

  test("without their mechanic, the engine's runs are not drawn", () => {
    const bare = {
      ...classic,
      gather: { gathering: {} },
      casino: {},
      items: { items: [] },
      bindings: { cannon: {} },
    } as unknown as FxContent;
    const runs = fxRuns(bare);
    expect(runs.has("fishing")).toBe(false);
    expect(runs.has("blue arrowsr")).toBe(false);
    expect(runs.has("cannonballshotd")).toBe(false);
    expect(runs.has("slot machine")).toBe(false);
    expect(runs.get("bsmith")?.users).toEqual(["smithing"]);
  });
});

describe("strips and frame files", () => {
  test("a strip's cells: rows for the run, then for its trail, equal cells up to 512", () => {
    const L = (across: number, runRows: number, trailRows = 0) => ({ across, runRows, trailRows });
    expect(fxSheetCell(320, 64, L(5, 1))).toEqual({ w: 64, h: 64 });
    expect(fxSheetCell(320, 128, L(5, 1, 1))).toEqual({ w: 64, h: 64 });
    expect(fxSheetCell(321, 64, L(5, 1))).toMatchObject({
      error: expect.stringContaining("divide by 5"),
    });
    expect(fxSheetCell(1026, 513, L(2, 1))).toMatchObject({
      error: expect.stringContaining("512"),
    });
    expect(fxSheetCell(64, 64, L(0, 1))).toMatchObject({ error: expect.any(String) });
    expect(fxSheetCell(64, 64, L(1, 0))).toMatchObject({ error: expect.any(String) });
  });

  test("the layout is guessed from square cells and the frames the run shows", () => {
    expect(guessFxSheet(320, 64, 0, 0)).toEqual({ across: 5, runRows: 1, trailRows: 0 });
    // Five frames and a trail: the second row is the trail.
    expect(guessFxSheet(320, 128, 5, 5)).toEqual({ across: 5, runRows: 1, trailRows: 1 });
    // Neon 1: 30 frames wrapped into rows of 21 (the guide's layout): two rows.
    expect(guessFxSheet(21 * 96, 2 * 96, 30, 0)).toEqual({ across: 21, runRows: 2, trailRows: 0 });
    // Firebolt's 16 frames and 16 trail frames, rows of 8: two rows each.
    expect(guessFxSheet(8 * 64, 4 * 64, 16, 16)).toEqual({ across: 8, runRows: 2, trailRows: 2 });
    expect(guessFxSheet(101, 30, 0, 0)).toBeNull();
  });

  test("a strip drops trailing blank cells, and refuses one before the last drawn", () => {
    // Four 10×10 cells across, two rows: run frames 1-3 drawn, trail frames 1-2.
    const dots: [number, number][] = [
      [1, 1],
      [11, 1],
      [21, 1],
      [1, 11],
      [11, 11],
    ];
    const one = { across: 4, runRows: 1, trailRows: 0 };
    const cut = stripFrames(img(40, 20, dots), { w: 10, h: 10 }, { ...one, trailRows: 1 });
    expect("error" in cut ? cut.error : [cut.frames.length, cut.trail.length]).toEqual([3, 2]);
    const gap = stripFrames(
      img(40, 10, [
        [1, 1],
        [21, 1],
      ]),
      { w: 10, h: 10 },
      one,
    );
    expect(gap).toEqual({ error: expect.stringContaining("frame 2 of the strip shows nothing") });
    expect(stripFrames(img(40, 10, []), { w: 10, h: 10 }, one)).toEqual({
      error: expect.stringContaining("run rows show nothing"),
    });
    // Neon 1: a run wrapped onto a second row reads left to right, top to bottom.
    const wrapped = stripFrames(
      img(20, 20, [
        [1, 1],
        [11, 1],
        [1, 11],
      ]),
      { w: 10, h: 10 },
      { across: 2, runRows: 2, trailRows: 0 },
    );
    expect("error" in wrapped ? wrapped.error : wrapped.frames.length).toBe(3);
  });

  test("frame files are named <run>-<n>.png", () => {
    expect(fxFrameFileName("Crush-3.png")).toEqual({ stem: "Crush", n: 3 });
    expect(fxFrameFileName("xFirebolt-12.PNG")).toEqual({ stem: "xFirebolt", n: 12 });
    expect(fxFrameFileName("Crush.png")).toBeNull();
    expect(fxFrameFileName("Crush-0.png")).toBeNull();
  });
});

describe("the anchor", () => {
  test("frame 1's visible middle lands on the centre given (the tile's by default)", () => {
    const first = img(20, 20, [
      [4, 6],
      [8, 10],
    ]);
    // Visible box x 4-8, y 6-10: middle (6, 8). The tile's middle is 18 px below the point.
    expect(defaultFxAnchor(first)).toEqual({ regX: 6, regY: 8 - 18 });
    expect(defaultFxAnchor(first, { x: 3, y: -40 })).toEqual({ regX: 3, regY: 48 });
  });

  test("a pack sprite's visible middle, from its point", () => {
    // [sheet, x, y, w, h, regX, regY]: a 10×20 sprite anchored at (5, 30).
    expect(spriteCentre([0, 0, 0, 10, 20, 5, 30])).toEqual({ x: 0, y: -20 });
    expect(spriteCentre(undefined)).toBeNull();
  });
});

describe("changes", () => {
  const frames = (n: number) => Array.from({ length: n }, () => ({ file: FILE, regX: 1, regY: 2 }));
  const input = (over: Partial<FxPlanInput> = {}): FxPlanInput => ({
    runs: fxRuns(classic),
    spells: classic.spells.spells as FxSpellRow[],
    art: [],
    packRuns: new Set(["crush", "firebolt", "xfirebolt"]),
    ...over,
  });
  const seen = (run: string) => fxRuns(classic).get(run.toLowerCase())?.users ?? [];

  test("a run with frames enough is written whole; too few is refused", () => {
    const ok = planFx(
      {
        op: "set",
        run: "Crush",
        frames: frames(30),
        trail: null,
        transparency: "alpha",
        seen: seen("Crush"),
      },
      input(),
    );
    expect(ok).toMatchObject({ ok: true, run: "Crush" });
    expect(ok.ok && ok.rows).toEqual([
      {
        ref: { dataset: "art", part: "fx", key: "Crush" },
        op: "set",
        data: { name: "Crush", frames: frames(30) },
      },
    ]);
    const short = planFx(
      {
        op: "set",
        run: "Crush",
        frames: frames(8),
        trail: null,
        transparency: "alpha",
        seen: seen("Crush"),
      },
      input(),
    );
    expect(short).toEqual({ ok: false, error: expect.stringContaining("shows 30 frames") });
  });

  test("from its spell, the spell plays every uploaded frame, in the same change", () => {
    const r = planFx(
      {
        op: "set",
        run: "crush",
        frames: frames(20),
        trail: null,
        transparency: "green",
        seen: seen("Crush"),
        fit: true,
      },
      input(),
    );
    if (!r.ok) {
      throw new Error(r.error);
    }
    expect(r.rows.map((x) => `${x.ref.dataset}/${x.ref.key}`)).toEqual([
      "art/Crush",
      "spells/Crush",
    ]);
    const spell = r.rows[1]?.data as FxSpellRow;
    expect(spell.fx[0]).toMatchObject({ member: "Crush", frames: 20, lastFrame: 20 });
    expect((r.rows[0]?.data as ArtFx | undefined)?.transparency).toBe("green");
  });

  test("a projectile's row records the count, but it still cycles three", () => {
    const r = planFx(
      {
        op: "set",
        run: "FireballL",
        frames: frames(2),
        trail: null,
        transparency: "alpha",
        seen: seen("FireballL"),
        fit: true,
      },
      input(),
    );
    expect(r).toEqual({ ok: false, error: expect.stringContaining("shows 3 frames") });
  });

  test("a trail shorter than its run's shows is refused", () => {
    const r = planFx(
      {
        op: "set",
        run: "Firebolt",
        frames: frames(16),
        trail: frames(4),
        transparency: "alpha",
        seen: seen("Firebolt"),
      },
      input(),
    );
    expect(r).toEqual({ ok: false, error: expect.stringContaining("trail shows 16 frames") });
  });

  test("a repaint for someone the panel did not name is refused", () => {
    const r = planFx(
      { op: "set", run: "Crush", frames: frames(30), trail: null, transparency: "alpha", seen: [] },
      input(),
    );
    expect(r).toEqual({ ok: false, error: expect.stringContaining("is now drawn by spell Crush") });
  });

  test("names that would draw another run's frames are refused", () => {
    const i = input();
    expect(fxNameClash("xFirebolt", false, i)).toContain("Firebolt's trail");
    expect(fxNameClash("Crush-2", false, i)).toContain("frame number");
    expect(fxNameClash("SmokeoBomb", true, i)).toContain("xSmokeoBomb is a run of its own");
    expect(fxNameClash("Sparkle", true, i)).toBeNull();
  });

  test("a run nothing draws can be uploaded; taking an upload out", () => {
    const art: ArtFx[] = [{ name: "Sparkle", frames: frames(3) }];
    expect(
      planFx(
        {
          op: "set",
          run: "Sparkle",
          frames: frames(3),
          trail: null,
          transparency: "alpha",
          seen: [],
        },
        input(),
      ),
    ).toMatchObject({ ok: true });
    expect(planFx({ op: "remove", run: "sparkle" }, input({ art }))).toEqual({
      ok: true,
      run: "Sparkle",
      rows: [{ ref: { dataset: "art", part: "fx", key: "Sparkle" }, op: "remove", data: null }],
    });
    expect(planFx({ op: "remove", run: "Crush" }, input({ art }))).toEqual({
      ok: false,
      error: "Crush has no upload to take out.",
    });
  });

  test("a spell that goes takes the uploads only it drew", () => {
    const spell = (classic.spells.spells as FxSpellRow[]).find(
      (s) => s.name === "Crush",
    ) as FxSpellRow;
    const art: ArtFx[] = [
      { name: "Crush", frames: frames(30) },
      { name: "Sparkle", frames: frames(3) },
    ];
    const without = fxRuns({
      ...classic,
      spells: { spells: classic.spells.spells.filter((s) => s.name !== "Crush") },
    });
    expect(orphanedFxUploads(spell, art, without)).toEqual(["Crush"]);
  });
});

describe("a run already on the map when a publish shortens it", () => {
  test("a frame past the new last frame ends instead of counting up", () => {
    // Crush shows 30 frames in Classic; one at frame 31 (its run shortened since) ends at once.
    const fx = { name: "Crush", frame: 31, h: 100, v: 100, gone: false };
    stepFx(fx);
    expect(fx.gone).toBe(true);
    const at = { name: "Crush", frame: 29, h: 100, v: 100, gone: false };
    stepFx(at);
    expect([at.frame, at.gone]).toEqual([30, false]);
    stepFx(at);
    expect(at.gone).toBe(true);
  });
});

describe("review fixes (Sol, stage 5)", () => {
  const frames = (n: number) => Array.from({ length: n }, () => ({ file: FILE, regX: 1, regY: 2 }));

  test("Sol 1: a run's lastFrame and frames go up to 99, as an art row's frames do", () => {
    const spells = structuredClone(classicData.spells);
    expect(DATASET_SCHEMAS.spells.safeParse(spells).success).toBe(true);
    const crush = spells.spells.find((x) => x.name === "Crush");
    const fx = crush?.fx[0] as { lastFrame: number | null; frames: number };
    fx.lastFrame = 100;
    expect(DATASET_SCHEMAS.spells.safeParse(spells).success).toBe(false);
    fx.lastFrame = 99;
    fx.frames = 100;
    expect(DATASET_SCHEMAS.spells.safeParse(spells).success).toBe(false);
  });

  test("Sol 3: a save over an upload that changed since the panel saw it is refused", () => {
    const art: ArtFx[] = [{ name: "Sparkle", frames: frames(3) }];
    const input = {
      runs: fxRuns(classic),
      spells: classic.spells.spells as FxSpellRow[],
      art,
      packRuns: new Set<string>(),
    };
    const seenRow = artRowFingerprint(art[0]);
    expect(artRowFingerprint(undefined)).toBeNull();
    const set = {
      op: "set" as const,
      run: "Sparkle",
      frames: frames(3),
      trail: null,
      transparency: "alpha" as const,
      seen: [],
    };
    expect(planFx({ ...set, expect: seenRow }, input).ok).toBe(true);
    // Someone else saved four frames meanwhile.
    const newer = { ...input, art: [{ name: "Sparkle", frames: frames(4) }] };
    expect(planFx({ ...set, expect: seenRow }, newer)).toEqual({
      ok: false,
      error: expect.stringContaining("changed since you opened it"),
    });
    expect(planFx({ op: "remove", run: "Sparkle", expect: seenRow }, newer).ok).toBe(false);
    // A run the panel saw with no upload, uploaded since.
    expect(planFx({ ...set, expect: null }, input).ok).toBe(false);
  });

  test("Sol 9: a retired arrow still fires, so its runs stay in use until it is removed", () => {
    const retired = {
      ...classic,
      items: {
        items: classic.items.items.map((i) =>
          i.name === "Blue Arrows" ? { ...i, retired: true } : i,
        ),
      },
    } as FxContent;
    expect(fxRuns(retired).get("blue arrowsr")).toMatchObject({ needs: 1 });
  });
});

describe("review fixes (Neon, stage 5)", () => {
  const frames = (n: number) => Array.from({ length: n }, () => ({ file: FILE, regX: 1, regY: 2 }));

  test("Neon 2: the trigger table names every frame the engine's code acts on", () => {
    // The members the server's collision code and the shared hit rules compare against.
    const root = join(import.meta.dir, "../../../");
    const sources = [
      "server/src/systems/spells/collide.ts",
      "shared/src/rules/spells/spells.ts",
    ].map((f) => readFileSync(join(root, f), "utf8"));
    const named = new Map<string, number>();
    for (const src of sources) {
      for (const m of src.matchAll(/"([A-Za-z' ]+)-(\d+)"/g)) {
        const k = (m[1] as string).toLowerCase();
        named.set(k, Math.max(named.get(k) ?? 0, Number(m[2])));
      }
    }
    expect(named.size).toBeGreaterThan(20);
    expect(Object.fromEntries([...named].sort())).toEqual(
      Object.fromEntries(Object.entries(FX_TRIGGER_FRAMES).sort()),
    );
  });

  test("Neon 2: fitting a spell's run below the frame its effect acts on is refused", () => {
    const input = {
      runs: fxRuns(classic),
      spells: classic.spells.spells as FxSpellRow[],
      art: [],
      packRuns: new Set(["crush"]),
    };
    const set = {
      op: "set" as const,
      run: "Crush",
      trail: null,
      transparency: "alpha" as const,
      seen: ["spell Crush"],
      fit: true,
    };
    expect(planFx({ ...set, frames: frames(17) }, input)).toEqual({
      ok: false,
      error: expect.stringContaining("acts on frame 18"),
    });
    expect(planFx({ ...set, frames: frames(18) }, input).ok).toBe(true);
  });

  test("Neon 2: a spell row newly shown short of its effect's frame is a problem; an old one is not", () => {
    const short = structuredClone(classicData) as unknown as FxContent;
    const crush = short.spells.spells.find((x) => x.name === "Crush");
    (crush?.fx[0] as FxSpellRun).lastFrame = 10;
    expect(fxTriggerProblems(short, classic)).toEqual([
      {
        where: "spells/spells/Crush",
        message:
          "Crush shows 10 frames, but its effect (Crush) acts on frame 18: spell Crush would do nothing",
      },
    ]);
    expect(fxTriggerProblems(short, short)).toEqual([]);
    expect(fxTriggerProblems(classic)).toEqual([]);
  });
});

test("Neon 1: with no exact fit, the strip's layout nearest the frames shown is guessed", () => {
  // 20 frames of 32 px wrapped into two rows of 12 for Crush, which shows 30.
  expect(guessFxSheet(12 * 32, 2 * 32, 30, 0)).toEqual({ across: 12, runRows: 2, trailRows: 0 });
});
