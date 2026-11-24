/**
 * Reloading the art when an operator publishes (issue #29): the index is fetched again, the groups
 * whose sheets changed are reported (and drawn from the new index), and listeners such as the
 * sounds hear about it.
 */
import { describe, expect, test } from "bun:test";

import type { AssetIndex, AtlasGroup } from "@secondstaronline/data";

import { loadAssets } from "../src/assets.ts";

const none = { sheets: [], sprites: {} };
function index(items: string, sounds: Record<string, string> = {}): AssetIndex {
  return {
    version: 1,
    inputHash: "",
    atlases: {
      tiles: none,
      bodies: none,
      paperdoll: none,
      fx: none,
      items: { sheets: [items], sprites: { sword: [0, 1, 2, 3, 4, 5, 6] } },
    },
    ui: {},
    sounds,
  };
}

describe("reloading the art", () => {
  test("swaps the index in and names the groups that changed", async () => {
    let served = index("packs/classic/items-0.png?v=1");
    const fetchImpl = (async () => Response.json(served)) as unknown as typeof fetch;
    const assets = await loadAssets(fetchImpl);
    const heard: AtlasGroup[][] = [];
    assets.onReload((changed) => {
      heard.push(changed);
    });
    expect(await assets.reload()).toEqual([]);
    expect(heard).toEqual([]);
    served = index("operator/items-abc.png");
    expect(await assets.reload()).toEqual(["items"]);
    expect(assets.index.atlases.items.sheets).toEqual(["operator/items-abc.png"]);
    expect(assets.sprite("items", "Sword")?.[3]).toBe(3);
    expect(heard).toEqual([["items"]]);
    // A sound alone changing is news too (the sounds reload), with no atlas changed.
    served = index("operator/items-abc.png", { crack: "operator/sounds/x.wav" });
    expect(await assets.reload()).toEqual([]);
    expect(heard).toEqual([["items"], []]);
  });
});
