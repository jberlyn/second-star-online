import { describe, expect, test } from "bun:test";

import { classicData } from "@secondstaronline/data/classic";

const { gather: gatherData } = classicData;

import { TILE_DEFAULTS, tileName } from "../../src/rules/core/tiles.ts";

const G = gatherData.gathering;

describe("tile hover names", () => {
  test("design change: trees, rocks and crops are named, and so is what they turn into", () => {
    expect(tileName("S3")).toBe("Tree");
    expect(tileName("P3")).toBe("Tree Stump");
    expect(tileName("B8")).toBe("Rock");
    expect(tileName("1G")).toBe("Ice Block");
    expect(tileName("6O")).toBe("Fire Rock");
    expect(tileName("UL")).toBe("Corn Seedling");
    // The plant is not called "Corn", so the tip tells the plant from the Corn it drops.
    expect(tileName("XL")).toBe("Corn Plant");
    expect(tileName("xl")).toBe("Corn Plant");
  });

  test("design change: every tile a tool, seed or watering changes has a name, before and after", () => {
    const codes = new Set<string>();
    for (const node of gatherData.harvest) {
      codes.add(node.tile).add(node.becomes);
    }
    for (const s of G.farming!.seeds) {
      codes.add(s.plants);
    }
    for (const w of G.farming!.watering) {
      codes.add(w.from).add(w.to);
    }
    // The shovel digs plain empty ground (`G3`), which is left unnamed so most tiles stay quiet.
    codes.delete(TILE_DEFAULTS.empty);
    expect([...codes].filter((c) => tileName(c) === null)).toEqual([]);
  });

  test("design change: plain ground, water and unknown tiles have no name", () => {
    expect(tileName(TILE_DEFAULTS.empty)).toBeNull();
    expect(tileName(TILE_DEFAULTS.ground)).toBeNull();
    for (const water of G.fishing!.waterTiles) {
      expect(tileName(water)).toBeNull();
    }
    expect(tileName("")).toBeNull();
  });
});
