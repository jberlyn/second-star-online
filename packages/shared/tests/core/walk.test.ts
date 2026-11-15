import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import {
  airshipWalkGrid,
  footBlocked,
  footWalkGrid,
  isWhitelisted,
} from "../../src/rules/core/walk.ts";

const layer = z.array(z.string().refine((row) => row.trim().split(/\s+/).length === 17)).length(12);
const grid = z.array(z.string().regex(/^[.#]{17}$/)).length(12);
const fixture = z
  .array(
    z.strictObject({
      id: z.string().regex(/^case-\d{2}$/),
      layers: z.strictObject({ "1": layer, "2": layer }),
      walk: z.strictObject({ playerOnFoot: grid, playerAirship: grid }),
    }),
  )
  .length(27)
  .refine((cases) => new Set(cases.map((item) => item.id)).size === cases.length);
const maps = fixture.parse(
  JSON.parse(readFileSync(join(import.meta.dir, "../fixtures/walk-grids.json"), "utf8")),
);

test("walk fixture rejects malformed grids and duplicate cases", () => {
  const malformed = structuredClone(maps);
  malformed[0]!.walk.playerOnFoot[0] = ".";
  expect(fixture.safeParse(malformed).success).toBe(false);
  const duplicate = structuredClone(maps);
  duplicate[1]!.id = duplicate[0]!.id;
  expect(fixture.safeParse(duplicate).success).toBe(false);
});

describe("on-foot walkable whitelist", () => {
  test("G1 grass is walkable, W1 water is not", () => {
    expect(footBlocked("G1", "G3")).toBe(false);
    expect(footBlocked("W1", "G3")).toBe(true);
  });

  test("a layer-2 code off the whitelist blocks, even on the original's do-not-block list", () => {
    expect(isWhitelisted("S3")).toBe(false); // tree
    expect(footBlocked("G1", "S3")).toBe(true);
    for (const overlayOnly of ["M5", "Q5", "R5", "G6", "Q7"]) {
      expect(footBlocked("G1", overlayOnly)).toBe(!isWhitelisted(overlayOnly));
    }
  });

  test("`contains` is case-insensitive and a missing word (EMPTY) is walkable", () => {
    expect(isWhitelisted("g1")).toBe(true);
    expect(isWhitelisted("")).toBe(true);
    expect(isWhitelisted("Sk11")).toBe(false); // swapped skull names never match
  });

  test(`reproduces the recorded foot grids for all ${maps.length} original maps`, () => {
    expect(maps.length).toBe(27);
    for (const map of maps) {
      const grid = footWalkGrid(map.layers["1"], map.layers["2"]);
      const drawn = grid.map((row) => row.map((ok) => (ok ? "." : "#")).join(""));
      expect({ id: map.id, grid: drawn }).toEqual({ id: map.id, grid: map.walk.playerOnFoot });
    }
  });
});

describe("Airship walk grid", () => {
  test(`airshipWalkGrid reproduces the recorded airship grids for all ${maps.length} original maps`, () => {
    for (const map of maps) {
      const grid = airshipWalkGrid(map.layers["2"]);
      const drawn = grid.map((row) => row.map((ok) => (ok ? "." : "#")).join(""));
      expect({ id: map.id, grid: drawn }).toEqual({ id: map.id, grid: map.walk.playerAirship });
    }
  });

  test("only layer-2 D8 I8 E8 J8 K8 L8 block, case ignored", () => {
    const row = `${["d8", "G1", "J8", "W1"].join(" ")} ${Array(13).fill("G1").join(" ")}`;
    const grid = airshipWalkGrid([row]);
    expect(grid[0]?.slice(0, 4)).toEqual([false, true, false, true]);
  });
});
