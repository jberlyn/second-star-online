/** Map tiles (issue #29, stage 6): codes, references, sheets, bulk matching and draft rows. */
import { describe, expect, test } from "bun:test";

import { classicData } from "@secondstaronline/data/classic";

import {
  artRowFingerprint,
  chunkNewTiles,
  contentTileSchema,
  cutTileCell,
  EDITOR_MESSAGE_BYTES,
  mapCodes,
  matchTile,
  nextTileCodes,
  planTile,
  removedTileCodes,
  TILES_PER_CHANGE,
  type TilePlanInput,
  tileFingerprint,
  tileImageProblem,
  tileRefs,
  tileSheetGrid,
} from "../../src/index.ts";

const input = (over: Partial<TilePlanInput> = {}): TilePlanInput => ({
  catalogue: [
    { code: "G1", member: 1 },
    { code: "S3", name: "Tree", member: 55 },
    { code: "N2" },
    { code: "N2" },
  ],
  walkable: [{ code: "G1" }],
  art: [],
  taken: new Set(["g1", "s3", "n2"]),
  packTiles: new Set(["g1", "s3"]),
  refs: new Map([["g1", ["the blank map's ground"]]]),
  ...over,
});

const solid = (w: number, h: number, alpha = 255) => {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data.set([10, 20, 30, alpha], i * 4);
  }
  return { width: w, height: h, data };
};

describe("codes", () => {
  test("the first free codes skip every taken one, case ignored", () => {
    expect(nextTileCodes(new Set(["aa", "ab"]), 2)).toEqual(["AC", "AD"]);
    expect(nextTileCodes(new Set(), 0)).toEqual([]);
    const all = new Set<string>();
    for (const a of "abcdefghijklmnopqrstuvwxyz0123456789") {
      for (const b of "abcdefghijklmnopqrstuvwxyz0123456789") {
        all.add(a + b);
      }
    }
    expect(nextTileCodes(all, 1)).toBeNull();
  });

  test("a map's codes, lower case", () => {
    expect([...mapCodes([["G1 g1 S3"], ["5A"]])].sort()).toEqual(["5a", "g1", "s3"]);
  });

  test("Classic's content names its tiles: defaults, gathering, farming, houses", () => {
    const refs = tileRefs(classicData);
    expect(refs.get(classicData.tiles.defaults.ground.toLowerCase())).toContain(
      "the blank map's ground",
    );
    const node = classicData.gather.harvest[0];
    expect(refs.get((node?.tile ?? "").toLowerCase())).toContain("a gathering node");
    expect([...refs.values()].flat().some((w) => w.startsWith("house "))).toBe(true);
    expect(refs.get("k2")).toContain("the newspaper stand");
  });
});

describe("sheets and pictures", () => {
  test("a tileset's sides are multiples of 32, at most 2048", () => {
    expect(tileSheetGrid(96, 64)).toEqual({ cols: 3, rows: 2 });
    expect(tileSheetGrid(33, 32)).toContain("multiples of 32");
    expect(tileSheetGrid(2080, 32)).toContain("at most 2048");
  });

  test("a cell is copied out of its sheet", () => {
    const sheet = solid(64, 32);
    sheet.data.set([1, 2, 3, 255], (0 * 64 + 32) * 4);
    const cell = cutTileCell(sheet, 1, 0);
    expect([...cell.data.subarray(0, 4)]).toEqual([1, 2, 3, 255]);
  });

  test("a tile is exactly 32×32 and shows something", () => {
    expect(tileImageProblem(solid(32, 32), "alpha")).toBeNull();
    expect(tileImageProblem(solid(33, 32), "alpha")).toContain("exactly 32×32");
    expect(tileImageProblem(solid(32, 32, 0), "alpha")).toBe("it shows nothing");
  });

  test("a bulk file matches a tile by code, then by name; anything else is new", () => {
    const cat = input().catalogue;
    expect(matchTile("g1", cat)).toEqual({ kind: "tile", code: "G1" });
    expect(matchTile("tree", cat)).toEqual({ kind: "tile", code: "S3" });
    expect(matchTile("Forest", cat)).toEqual({ kind: "new" });
  });
});

describe("draft rows", () => {
  test("adding tiles writes the catalogue, the walkable list and an art row each", () => {
    const plan = planTile(
      {
        op: "add",
        transparency: "green",
        tiles: [
          { file: "a".repeat(64), walkable: true, name: " Moss " },
          { file: "b".repeat(64), walkable: false },
        ],
      },
      input(),
    );
    if (!plan.ok) {
      throw new Error(plan.error);
    }
    expect(plan.codes).toEqual(["AA", "AB"]);
    expect(plan.rows.map((r) => `${r.ref.dataset}/${r.ref.part}/${r.ref.key ?? ""}`)).toEqual([
      "tiles/catalogue/",
      "tiles/walkable/",
      "art/tiles/AA",
      "art/tiles/AB",
    ]);
    expect(((plan.rows[0]?.data ?? []) as { code: string; name?: string }[]).slice(-2)).toEqual([
      { code: "AA", name: "Moss" },
      { code: "AB" },
    ]);
    expect(plan.rows[1]?.data).toEqual([{ code: "G1" }, { code: "AA" }]);
    expect(plan.rows[2]?.data).toEqual({ code: "AA", file: "a".repeat(64), transparency: "green" });
  });

  test("a repaint or removal made over a newer upload is refused", () => {
    const art = [{ code: "S3", file: "c".repeat(64) }];
    expect(
      planTile(
        { op: "set", code: "s3", file: "d".repeat(64), transparency: "alpha", expect: null },
        input({ art }),
      ),
    ).toMatchObject({ ok: false });
    const fp = artRowFingerprint(art[0]);
    const ok = planTile(
      { op: "set", code: "s3", file: "d".repeat(64), transparency: "alpha", expect: fp },
      input({ art }),
    );
    expect(ok.ok && ok.rows[0]?.ref.key).toBe("S3");
    expect(planTile({ op: "remove", code: "G1" }, input())).toEqual({
      ok: false,
      error: "Tile G1 has no upload to take out.",
    });
  });

  test("an edit changes every catalogue entry with the code (Classic lists N2 twice)", () => {
    const plan = planTile(
      { op: "edit", code: "n2", name: "Sand", walkable: true, flags: ["sea", "sea"] },
      input(),
    );
    if (!plan.ok) {
      throw new Error(plan.error);
    }
    const cat = plan.rows[0]?.data as { code: string; name?: string; flags?: string[] }[];
    expect(cat.filter((t) => t.code === "N2")).toEqual([
      { code: "N2", name: "Sand", flags: ["sea"] },
      { code: "N2", name: "Sand", flags: ["sea"] },
    ]);
    expect(plan.rows[1]?.data).toEqual([{ code: "G1" }, { code: "N2" }]);
  });

  test("a tile a map or content uses is not taken out", () => {
    expect(planTile({ op: "delete", code: "G1" }, input())).toMatchObject({ ok: false });
    expect(
      planTile({ op: "delete", code: "S3" }, input({ maps: new Map([["s3", ["x1y1"]]]) })),
    ).toEqual({
      ok: false,
      error: "Tile S3 is still used: 1 map (x1y1). Take it off those first.",
    });
    const plan = planTile({ op: "delete", code: "N2" }, input());
    expect(
      plan.ok && ((plan.rows[0]?.data ?? []) as { code: string }[]).map((t) => t.code),
    ).toEqual(["G1", "S3"]);
  });

  test("the codes a catalogue change takes out", () => {
    expect(
      removedTileCodes([{ code: "G1" }, { code: "N2" }, { code: "N2" }], [{ code: "g1" }]),
    ).toEqual(["N2"]);
  });
});

describe("frames", () => {
  const frameBytes = (tiles: { file: string; walkable: boolean; name?: string }[]) =>
    new TextEncoder().encode(
      JSON.stringify({
        t: "contentTile",
        seq: 2 ** 31,
        change: { op: "add", transparency: "green", tiles },
      }),
    ).length;

  test("a big tileset goes as several changes, each one frame, however long its names", () => {
    // 384 cells (a 768×512 sheet) with the longest names, in characters of three UTF-8 bytes.
    const tiles = Array.from({ length: 600 }, (_, i) => ({
      file: (i % 10).toString().repeat(64),
      walkable: i % 2 === 0,
      name: "雪".repeat(80),
    }));
    const chunks = chunkNewTiles(tiles);
    expect(chunks.flat()).toEqual(tiles);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(TILES_PER_CHANGE);
      expect(frameBytes(c)).toBeLessThanOrEqual(EDITOR_MESSAGE_BYTES);
      expect(
        contentTileSchema.safeParse({
          t: "contentTile",
          seq: 1,
          change: { op: "add", transparency: "green", tiles: c },
        }).success,
      ).toBe(true);
    }
    // Plain cells of a 768×512 sheet: still under the frame cap.
    const plain = Array.from({ length: 384 }, () => ({ file: "a".repeat(64), walkable: true }));
    for (const c of chunkNewTiles(plain)) {
      expect(frameBytes(c)).toBeLessThanOrEqual(EDITOR_MESSAGE_BYTES);
    }
  });
});

describe("names and stale panels", () => {
  test("a name several tiles share matches none of them", () => {
    const cat = [
      { code: "A1", name: "Wall" },
      { code: "A2", name: "wall" },
      { code: "A3", name: "Gate" },
    ];
    expect(matchTile("WALL", cat)).toEqual({ kind: "ambiguous", codes: ["A1", "A2"] });
    expect(matchTile("a2", cat)).toEqual({ kind: "tile", code: "A2" });
  });

  test("an edit or removal from a panel that saw the tile differently is refused", () => {
    const i = input();
    const seen = tileFingerprint(i.catalogue, i.walkable, "S3");
    expect(
      planTile({ op: "edit", code: "S3", name: "Oak", walkable: false, flags: [], seen }, i).ok,
    ).toBe(true);
    const renamed = input({
      catalogue: i.catalogue.map((t) => (t.code === "S3" ? { ...t, name: "Oak" } : t)),
    });
    expect(planTile({ op: "delete", code: "S3", seen }, renamed)).toMatchObject({
      ok: false,
      error: expect.stringContaining("changed since you opened it"),
    });
  });
});
