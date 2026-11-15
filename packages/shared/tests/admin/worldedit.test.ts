/** The World Editor's rules. */
import { describe, expect, test } from "bun:test";

import { itemsData, monstersData, tilesData } from "@secondstaronline/data";

import {
  blankMap,
  clickFaction,
  clickLayer,
  EDITOR_ITEMS,
  EDITOR_MONSTERS,
  EDITOR_NPCS,
  EMPTY_EXIT_FIELDS,
  editorMapError,
  exitFieldsAfterLoad,
  exitFromFields,
  factionBoxes,
  factionFlag,
  groundDrawOffset,
  groundLayer,
  paint,
  palettePage,
  palettePageOf,
  palettePagesOf,
  START_LAYERS,
  stepPalette,
  stepPaletteOf,
  tileBlocked,
} from "../../src/index.ts";

const rows = (code: string) => Array.from({ length: 12 }, () => Array(17).fill(code).join(" "));
const at = (r: string[], x: number, y: number) => r[y - 1]?.split(" ")[x - 1];

describe("palette", () => {
  test("page 1 is MapGFX members 1-60 in sprite order: G1 H1 O1 B1 F1 T1 … (score channels 5-64)", () => {
    const p = palettePage(1);
    expect(p.length).toBe(60);
    expect(p.slice(0, 6)).toEqual(["G1", "H1", "O1", "B1", "F1", "T1"]);
    expect(p.slice(54)).toEqual(["S3", "W3", "N3", "A3", "C3", "D3"]);
  });
  test("page 10 stops at member 589", () => {
    expect(palettePage(10).length).toBe(49);
  });
  test("the arrows wrap 10 → 1 and 1 → 10", () => {
    expect(stepPalette(10, 1)).toBe(1);
    expect(stepPalette(1, -1)).toBe(10);
    expect(stepPalette(3, 1)).toBe(4);
  });
  test("BLOCKED TILE is ticked when the whitelist lacks the tile", () => {
    expect(tileBlocked("G1")).toBe(false);
    expect(tileBlocked("S3")).toBe(true);
  });
  test("added tiles fill page 10's free slots first, then pages 11+, 60 a page, in file order", () => {
    const withAdded = (n: number) => [
      ...tilesData.catalogue,
      ...Array.from({ length: n }, (_, i) => ({ code: `Z${String(i).padStart(2, "0")}` })),
    ];
    for (const [n, pages] of [
      [0, 10],
      [11, 10],
      [12, 11],
      [71, 11],
      [72, 12],
    ] as const) {
      expect(palettePagesOf(withAdded(n))).toBe(pages);
    }
    expect(palettePageOf(withAdded(0), 10)).toHaveLength(49);
    expect(palettePageOf(withAdded(0), 11)).toEqual([]);
    const p10 = palettePageOf(withAdded(12), 10);
    expect(p10).toHaveLength(60);
    expect(p10.slice(49)).toEqual(
      Array.from({ length: 11 }, (_, i) => `Z${String(i).padStart(2, "0")}`),
    );
    expect(palettePageOf(withAdded(12), 11)).toEqual(["Z11"]);
    expect(palettePageOf(withAdded(71), 11)).toHaveLength(60);
    expect(palettePageOf(withAdded(72), 12)).toEqual(["Z71"]);
    expect(palettePageOf(withAdded(11), 1)).toEqual(palettePageOf(tilesData.catalogue, 1));
    expect(stepPaletteOf(11, 1, 11)).toBe(1);
    expect(stepPaletteOf(1, -1, 11)).toBe(11);
    expect(stepPaletteOf(10, 1, 10)).toBe(1);
  });
});

describe("painting", () => {
  test("Pencil puts one tile", () => {
    const r = paint(rows("G1"), "pencil", "S3", 4, 5);
    expect(at(r, 4, 5)).toBe("S3");
    expect(r.join(" ").split("S3").length - 1).toBe(1);
  });
  test("Bucket fills the whole layer", () => {
    expect(paint(rows("G1"), "bucket", "W1", 1, 1)).toEqual(rows("W1"));
  });
  test("the Fat brush paints a plus (`LBrush`)", () => {
    const r = paint(rows("G1"), "fat", "S3", 5, 5);
    for (const [x, y] of [
      [5, 5],
      [6, 5],
      [4, 5],
      [5, 4],
      [5, 6],
    ] as const) {
      expect(at(r, x, y)).toBe("S3");
    }
    expect(r.join(" ").split("S3").length - 1).toBe(5);
  });
  test("kept bug: the Fat brush stops at column 12 and row 9 (the right and lower neighbours are bounded by 13 and 10)", () => {
    const right = paint(rows("G1"), "fat", "S3", 12, 5);
    expect(at(right, 13, 5)).toBe("G1");
    expect(at(paint(rows("G1"), "fat", "S3", 11, 5), 12, 5)).toBe("S3");
    const down = paint(rows("G1"), "fat", "S3", 5, 9);
    expect(at(down, 5, 10)).toBe("G1");
    expect(at(paint(rows("G1"), "fat", "S3", 5, 8), 5, 9)).toBe("S3");
    // The left and upper arms stop only at the edge.
    const corner = paint(rows("G1"), "fat", "S3", 1, 1);
    expect(corner.join(" ").split("S3").length - 1).toBe(3);
  });
});

describe("toggles", () => {
  test("W and M clear the others; kept bug: A does not clear W", () => {
    const w = clickFaction({ w: false, m: false, a: false }, "w");
    expect(w).toEqual({ w: true, m: false, a: false });
    expect(clickFaction(w, "m")).toEqual({ w: false, m: true, a: false });
    const wa = clickFaction(w, "a");
    expect(wa).toEqual({ w: true, m: false, a: true });
  });
  test("the save writes the last ticked of W, M, A", () => {
    expect(factionFlag({ w: true, m: false, a: true })).toBe("A");
    expect(factionFlag({ w: false, m: false, a: false })).toBe("X");
    expect(factionBoxes("M")).toEqual({ w: false, m: true, a: false });
  });
  test("layer buttons select their layer; a lit 1, 2 or 3 does nothing (no script on l1on-l3on)", () => {
    const l2 = clickLayer(START_LAYERS, "l2");
    expect(l2.layer).toBe(2);
    expect(clickLayer(l2, "l2")).toBe(l2);
    expect(clickLayer(START_LAYERS, "s").layer).toBe(4);
  });
  test("kept bug: the lit S button selects layer 3 and stays lit", () => {
    const s = clickLayer(START_LAYERS, "s");
    const after = clickLayer(s, "s");
    expect(after.layer).toBe(3);
    expect(after.lit).toEqual({ s: true, l3: true, l2: false, l1: false });
  });
});

describe("LOAD and SAVE", () => {
  test("a map that does not exist shows BlankMapData", () => {
    const m = blankMap(5, 6);
    expect(m.layers[0]).toEqual(rows("H1"));
    expect(m.layers[1]).toEqual(rows("G3"));
    expect(at(m.layers[2], 7, 6)).toBe("5A");
    expect(m.layers[2].join(" ").split("5A").length - 1).toBe(1);
    expect(m.layers[3]).toEqual(rows("5A"));
    expect(m.flags).toEqual({ canFight: "O", fctSpwn: "O", isIndoors: "X", canPvp: "X" });
  });
  test("kept bug: exit panels keep the last map's exits (a map without an exit leaves the panel as it was)", () => {
    const prev = exitFieldsAfterLoad(EMPTY_EXIT_FIELDS, { mx: 3, my: 4, x: 5, y: 6 });
    expect(prev).toEqual(["3", "4", "5", "6"]);
    expect(exitFieldsAfterLoad(prev, null)).toEqual(["3", "4", "5", "6"]);
    expect(exitFromFields(["", " ", "", ""])).toBeNull();
    expect(exitFromFields(prev)).toEqual({ mx: 3, my: 4, x: 5, y: 6 });
  });
  test("the save is checked: palette codes, 12 rows of 17, listed monsters, ≤ 20 items, fog", () => {
    const ok = () => true;
    expect(editorMapError(blankMap(1, 1), ok)).toBeNull();
    const bad = blankMap(1, 1);
    bad.layers[0] = [...bad.layers[0].slice(0, 11)];
    expect(editorMapError(bad, ok)).not.toBeNull();
    const code = blankMap(1, 1);
    code.layers[1][0] = code.layers[1][0]?.replace("G3", "ZZ") ?? "";
    expect(editorMapError(code, ok)).not.toBeNull();
    const mob = blankMap(1, 1);
    mob.mobs[0] = { name: "Dragon", x: 1, y: 1 };
    expect(editorMapError(mob, ok)).not.toBeNull();
    mob.mobs[0] = { name: "slime", x: 1, y: 1 };
    expect(editorMapError(mob, ok)).toBeNull();
    const items = blankMap(1, 1);
    items.items = Array.from({ length: 21 }, () => ({ name: "Exit", x: 1, y: 1 }));
    expect(editorMapError(items, ok)).not.toBeNull();
    const fog = blankMap(1, 1);
    fog.fog = { tex: "Cloudy1", blend: 15, r: 0, g: 0, b: 0 };
    expect(editorMapError(fog, ok)).not.toBeNull();
    fog.fog.blend = 150;
    expect(editorMapError(fog, ok)).toBeNull();
    const exit = blankMap(1, 1);
    exit.exit1 = { mx: 1, my: 2, x: 18, y: 1 };
    expect(editorMapError(exit, ok)).not.toBeNull();
  });
  test("the lists are the cast's fields: 36 monsters, 56 NPCs, 46 items", () => {
    expect(EDITOR_MONSTERS.length).toBe(36);
    expect(EDITOR_NPCS.length).toBe(56);
    expect(EDITOR_MONSTERS).toEqual(monstersData.editorLists.worldEditor.monsters);
    expect(EDITOR_NPCS).toEqual(monstersData.editorLists.worldEditor.npcs);
    expect(EDITOR_ITEMS.length).toBe(46);
    // "Delete" is not an item; the other 45 are `editorItems` of the item content.
    expect(EDITOR_ITEMS[0]).toBe("Delete");
    expect(EDITOR_ITEMS.slice(1)).toEqual(itemsData.editorItems);
  });
});

describe("ground items in play", () => {
  test("Exit and Exit2 are under the map; Rays over characters; Chimney over layer 3", () => {
    expect(groundLayer("Exit")).toBe("hidden");
    expect(groundLayer("exit2")).toBe("hidden");
    expect(groundLayer("Left Ray")).toBe("overChars");
    expect(groundLayer("Chimney")).toBe("overLayer3");
    expect(groundLayer("Sign 1")).toBe("items");
  });
  test("Rays sit 15 px right and 10 px up of their tile", () => {
    expect(groundDrawOffset("Right Ray")).toEqual({ dx: 15, dy: -10 });
    expect(groundDrawOffset("Apple")).toEqual({ dx: 0, dy: 0 });
  });
});
