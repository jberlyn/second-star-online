/**
 * Worn frame sets (issue #29, stage 3): the layer an item draws, the frames the renderer asks a
 * layer for, the sheet, the frame checks and the rows a change writes. The needs are worked out by
 * asking the renderer itself, frame by frame, so they cannot drift from what the game draws.
 */
import { describe, expect, test } from "bun:test";

import type { ArtFrameId, ArtWorn } from "@secondstaronline/data";
import { classicData } from "@secondstaronline/data/classic";

import type { Pixels } from "../../src/content/picture.ts";
import { buildContentStore, installContent } from "../../src/content/store.ts";
import {
  ALL_FRAME_IDS,
  blankCell,
  frameFileName,
  framesDrawn,
  mirrorWorn,
  missingFrames,
  ownLayerPossible,
  paperdollRulesOf,
  pastMirrorLine,
  planWorn,
  sheetCell,
  unusedFrames,
  WORN_FRAMES,
  WORN_SHEET,
  wornFrameReport,
  wornLayerOf,
  wornLayers,
} from "../../src/content/worn.ts";
import { equipmentOf } from "../../src/rules/inventory/inventory.ts";
import { paperdollLayers, paperdollLayersWith } from "../../src/rules/inventory/paperdoll.ts";

const rules = classicData.itemRules;

/** A `w`×`h` picture with one opaque pixel at each of `dots`. */
function dots(w: number, h: number, ...at: [number, number][]): Pixels {
  const data = new Uint8Array(w * h * 4);
  for (const [x, y] of at) {
    data.set([200, 30, 30, 255], (y * w + x) * 4);
  }
  return { width: w, height: h, data };
}

describe("which layer an item draws", () => {
  test("an item draws its own key in its slot's layer", () => {
    expect(wornLayerOf(rules, "Chain Helm")).toEqual({
      slot: "Head",
      layer: "Chain Helm",
      aliases: [],
      ownLayerPossible: false,
    });
    expect(wornLayerOf(rules, "Apple")).toBeNull();
  });

  test("aliases rewrite it, and only exact rows naming the item alone can be taken out", () => {
    const knight = wornLayerOf(rules, "Knight's Sword");
    expect(knight?.layer).toBe("Broad Sword");
    expect(knight?.ownLayerPossible).toBe(true);
    const scimitar = wornLayerOf(rules, "Steel Scimitar");
    if (scimitar) {
      expect(scimitar.layer).toBe("Short Sword");
      expect(scimitar.ownLayerPossible).toBe(false);
    }
    // A ring draws nothing (contains "Ring" becomes NOTHING).
    const ring = classicData.items.items.find(
      (i) => wornLayerOf(rules, i.name)?.slot === "Ring" && i.name.includes("Ring"),
    );
    expect(ring).toBeDefined();
    expect(wornLayerOf(rules, ring?.name ?? "")?.layer).toBeNull();
  });
});

describe("the frames a layer needs", () => {
  test("Classic's layers need exactly the frames Classic's art has", () => {
    const layers = wornLayers(classicData);
    const needs = (name: string) => layers.get(name.toLowerCase())?.needs.length;
    // Worn on the body, head, feet and hands, and the engine's bare body, feet and heads: 15.
    for (const n of [
      "Chain Armor",
      "Chain Helm",
      "Chain Boots",
      "Gauntlets",
      "DEFBOD",
      "Bare Feet",
      "Head1",
    ]) {
      expect(needs(n)).toBe(15);
    }
    // A weapon is never drawn facing north except attacking: 12.
    expect(needs("Broad Sword")).toBe(12);
    expect(layers.get("broad sword")?.needs).not.toContain("f1-n");
    // A shield or a quiver is never drawn facing east: 11.
    expect(needs("Small Shield")).toBe(11);
    expect(needs("Arrows")).toBe(11);
    expect(layers.get("arrows")?.needs).not.toContain("f2-e");
    // The Torch is hidden facing north as well: 7.
    expect(needs("Torch")).toBe(7);
    // No layer ever needs F4-S.
    for (const u of layers.values()) {
      expect(u.needs).not.toContain("f4-s");
    }
    expect(layers.get("broad sword")?.wornBy.map((w) => w.item)).toContain("Knight's Sword");
  });

  test("the rules given are the renderer's: the live store draws the same", () => {
    installContent(buildContentStore(classicData));
    const pd = paperdollRulesOf(rules);
    for (const equip of [
      equipmentOf({ LeftHand: "Knight's Sword", RightHand: "Arrows", Head: "Chain Helm" }),
      equipmentOf({ RightHand: "Torch", Body: "Damaged Armor" }),
    ]) {
      for (const id of WORN_FRAMES) {
        const [frame, facing] = id.toUpperCase().split("-") as ["F1", "N"];
        expect(paperdollLayersWith(pd, { head: 3, equip }, frame, facing)).toEqual(
          paperdollLayers({ head: 3, equip }, frame, facing),
        );
      }
    }
    expect(framesDrawn(pd, "RightHand", "Torch", "Torch")).toEqual([
      "f1-s",
      "f2-s",
      "f3-s",
      "f1-w",
      "f2-w",
      "f3-w",
      "f4-w",
    ]);
  });

  test("a set's gaps and its frames nothing draws", () => {
    const layers = wornLayers(classicData);
    const sword = layers.get("broad sword");
    const frames: ArtWorn["frames"] = { "f1-n": { file: "a".repeat(64) } };
    expect(missingFrames({ frames }, sword)).toHaveLength(12);
    expect(unusedFrames({ frames }, sword)).toEqual(["f1-n"]);
    // A layer nothing wears needs nothing.
    expect(missingFrames({ frames }, undefined)).toEqual([]);
  });
});

describe("the sheet and the frame files", () => {
  test("rows N, E, S, W of F1-F4, each 46×45", () => {
    expect(WORN_SHEET).toEqual({ cols: 4, rows: 4, w: 184, h: 180 });
    expect(sheetCell("f1-n")).toEqual({ x: 0, y: 0 });
    expect(sheetCell("f4-e")).toEqual({ x: 138, y: 45 });
    expect(sheetCell("f2-w")).toEqual({ x: 46, y: 135 });
    expect(ALL_FRAME_IDS).toHaveLength(16);
  });

  test("frame files are named after their layer and frame", () => {
    expect(frameFileName("Moonblade-f1-e.png")).toEqual({ stem: "Moonblade", frame: "f1-e" });
    expect(frameFileName("Moon Blade-F3-N.PNG")).toEqual({ stem: "Moon Blade", frame: "f3-n" });
    expect(frameFileName("moonblade_f2s.png")).toEqual({ stem: "moonblade", frame: "f2-s" });
    expect(frameFileName("Moonblade.png")).toBeNull();
  });
});

describe("frame checks", () => {
  test("size, the mirror line, empty frames and frames never drawn", () => {
    const ok = wornFrameReport(dots(46, 45, [10, 10]), "f1-e", true, true);
    expect(ok).toEqual({ errors: [], warnings: [], empty: false });
    expect(wornFrameReport(dots(47, 45, [1, 1]), "f1-e", false, true).errors).toHaveLength(1);
    // Column 45 is past the line only on a mirrored north frame.
    const edge = dots(46, 45, [45, 3]);
    expect(wornFrameReport(edge, "f2-n", true, true).errors[0]).toContain("column 45");
    expect(wornFrameReport(edge, "f2-n", false, true).errors).toEqual([]);
    expect(wornFrameReport(edge, "f2-e", true, true).errors).toEqual([]);
    expect(wornFrameReport(dots(46, 45), "f1-e", false, true).warnings).toEqual([
      "f1-e shows nothing",
    ]);
    expect(wornFrameReport(dots(46, 45, [1, 1]), "f1-n", false, false).warnings).toEqual([
      "f1-n is never drawn for this layer; it is left out",
    ]);
    expect(wornFrameReport(dots(46, 45, [1, 1]), "f4-s", false, true).warnings[0]).toContain(
      "never drawn",
    );
  });

  test("the flip is mirrorPaperdoll's: column x lands on 44 - x", () => {
    expect(pastMirrorLine(dots(46, 45, [44, 0]))).toBeNull();
    const flipped = mirrorWorn(dots(46, 45, [9, 2], [35, 4]));
    expect(flipped.width).toBe(45);
    expect(flipped.data[(2 * 45 + 35) * 4 + 3]).toBe(255);
    expect(flipped.data[(4 * 45 + 9) * 4 + 3]).toBe(255);
  });
});

describe("planning a change", () => {
  const items = classicData.items.items;
  const file = (c: string) => c.repeat(64);

  test("an upload replaces the layer's row, keeps its spelling and leaves out f4-s", () => {
    const art: ArtWorn[] = [{ name: "Broad Sword", frames: { "f1-e": { file: file("a") } } }];
    const r = planWorn(
      {
        op: "set",
        layer: "broad sword",
        frames: { "f2-e": file("b"), "f4-s": file("c") } as Partial<Record<ArtFrameId, string>>,
        mirrored: true,
        transparency: "green",
      },
      rules,
      items,
      art,
    );
    expect(r).toEqual({
      ok: true,
      rows: [
        {
          ref: { dataset: "art", part: "paperdoll", key: "Broad Sword" },
          op: "set",
          data: {
            name: "Broad Sword",
            frames: { "f2-e": { file: file("b") } },
            mirrored: true,
            transparency: "green",
          },
        },
      ],
    });
    expect(
      planWorn(
        { op: "set", layer: "x", frames: {}, mirrored: false, transparency: "alpha" },
        rules,
        items,
        art,
      ).ok,
    ).toBe(false);
    expect(planWorn({ op: "remove", layer: "BROAD SWORD" }, rules, items, art)).toEqual({
      ok: true,
      rows: [
        {
          ref: { dataset: "art", part: "paperdoll", key: "Broad Sword" },
          op: "remove",
          data: null,
        },
      ],
    });
    expect(planWorn({ op: "remove", layer: "Axe" }, rules, items, art).ok).toBe(false);
  });

  test("its own layer takes out only exact rows that name the item alone", () => {
    const r = planWorn({ op: "ownLayer", item: "knight's sword" }, rules, items, []);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const row = r.rows[0];
      expect(row?.ref).toEqual({ dataset: "itemRules", part: "paperdoll", key: null });
      const aliases = (row?.data as typeof rules.paperdoll | undefined)?.aliases ?? [];
      expect(aliases).toHaveLength(rules.paperdoll.aliases.length - 1);
      expect(aliases.some((a) => a.pattern === "Knight's Sword")).toBe(false);
    }
    expect(planWorn({ op: "ownLayer", item: "Chain Helm" }, rules, items, []).ok).toBe(false);
    expect(planWorn({ op: "ownLayer", item: "Apple" }, rules, items, []).ok).toBe(false);
  });
});

describe("review fixes (Sol)", () => {
  test("its own layer is refused when another item's alias chain runs through the same row", () => {
    const rules2 = structuredClone(rules);
    rules2.paperdoll.aliases = [
      { layer: "weapon", match: "exact", pattern: "Other Sword", becomes: "Moon Sword" },
      { layer: "weapon", match: "exact", pattern: "Moon Sword", becomes: "Broad Sword" },
    ];
    rules2.equip.slots = [
      ...rules2.equip.slots,
      { match: "exact", pattern: "Moon Sword", slot: "LeftHand" },
      { match: "exact", pattern: "Other Sword", slot: "LeftHand" },
    ];
    const items = [{ name: "Moon Sword" }, { name: "Other Sword" }];
    expect(wornLayerOf(rules2, "Moon Sword")?.ownLayerPossible).toBe(true);
    expect(ownLayerPossible(rules2, items, "Moon Sword")).toBe(false);
    const r = planWorn({ op: "ownLayer", item: "Moon Sword" }, rules2, items, []);
    expect(r).toEqual({
      ok: false,
      error:
        "Taking out Moon Sword's alias rows would also change what Other Sword draws: change paperdoll.aliases in the item rules by hand.",
    });
    expect(ownLayerPossible(rules, classicData.items.items, "Knight's Sword")).toBe(true);
  });

  test("a frame no wearer draws is only a warning, whatever is wrong with it", () => {
    const wide = dots(47, 45, [1, 1]);
    expect(wornFrameReport(wide, "f4-s", true, true).errors).toEqual([]);
    expect(wornFrameReport(wide, "f1-n", true, false).errors).toEqual([]);
    expect(wornFrameReport(wide, "f1-e", true, true).errors).toHaveLength(1);
  });
});

describe("review fixes (Neon)", () => {
  test("its own layer is refused when a later rule still renames it, or for an upgraded copy", () => {
    const rules2 = structuredClone(rules);
    rules2.paperdoll.aliases = [
      { layer: "weapon", match: "exact", pattern: "Steel Scimitar", becomes: "Broad Sword" },
      { layer: "weapon", match: "contains", pattern: "Scimitar", becomes: "Short Sword" },
    ];
    const items = [{ name: "Steel Scimitar" }];
    expect(planWorn({ op: "ownLayer", item: "Steel Scimitar" }, rules2, items, [])).toEqual({
      ok: false,
      error:
        "Without its own alias rows another rule still renames Steel Scimitar's layer: change paperdoll.aliases in the item rules by hand.",
    });
    expect(ownLayerPossible(rules, classicData.items.items, "Knight's Sword +1")).toBe(false);
    const plus = planWorn(
      { op: "ownLayer", item: "Knight's Sword +1" },
      rules,
      classicData.items.items,
      [],
    );
    expect(plus.ok ? "" : plus.error).toContain("upgraded copy");
  });

  test("a blank cell is see-through or pure green throughout", () => {
    const green = dots(4, 4);
    for (let i = 0; i < green.data.length; i += 4) {
      green.data.set([0, 255, 0, 255], i);
    }
    expect(blankCell(dots(4, 4))).toBe(true);
    expect(blankCell(green)).toBe(true);
    expect(blankCell(dots(4, 4, [1, 1]))).toBe(false);
  });
});
