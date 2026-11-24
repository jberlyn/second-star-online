/**
 * Which live sprites the Content page's panels treat as an operator upload (issue #29): only the
 * operator's own sheets. A pack's art is the pack's, whether its built atlases (`packs/<id>/`) or
 * its art rows, which the server builds and serves under `operator/packs/<id>/` (stage 8).
 */
import { describe, expect, test } from "bun:test";

import { type Assets, drawnFromUpload } from "../src/assets.ts";

function assets(sheet: string): Assets {
  const sprite = [0, 0, 0, 8, 8, 4, 4];
  const atlas = {
    sheets: [sheet],
    sprites: { gold: sprite, "1000-f1-s": sprite, "boom-1": sprite },
  };
  return {
    index: {
      atlases: { items: atlas, bodies: atlas, paperdoll: atlas, fx: atlas, tiles: atlas },
      sounds: {},
      ui: {},
    },
    sprite: (group: string, name: string) =>
      (atlas.sprites as Record<string, number[]>)[name] && group ? sprite : undefined,
  } as unknown as Assets;
}

describe("an upload is the operator's own sheet", () => {
  test("an operator sheet is an upload", () => {
    expect(drawnFromUpload(assets("operator/items-abc.png"), "items", "gold")).toBe(true);
    expect(drawnFromUpload(assets("operator/bodies-abc.png"), "bodies", "1000-f1-s")).toBe(true);
  });

  test("a pack's art rows and built atlases are the pack's", () => {
    for (const group of ["items", "bodies", "paperdoll", "fx"] as const) {
      const name = group === "bodies" ? "1000-f1-s" : group === "fx" ? "boom-1" : "gold";
      expect(drawnFromUpload(assets("operator/packs/mypack/items-abc.png"), group, name)).toBe(
        false,
      );
      expect(drawnFromUpload(assets("packs/classic/items-0.png?v=1"), group, name)).toBe(false);
    }
  });

  test("a sprite nothing draws is no upload", () => {
    expect(drawnFromUpload(assets("operator/items-abc.png"), "items", "nothing")).toBe(false);
  });
});
