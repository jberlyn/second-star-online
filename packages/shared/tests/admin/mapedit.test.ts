/**
 * Issue #33, stage 1: the World page's editing model. The in-game editor's brushes (pencil, fat,
 * whole-layer bucket) paint as before; SSO's flood fill takes only the joined tiles of one code,
 * rectangle fill and clear take exactly their rectangle, copy and paste carry the chosen layers and
 * clip at the map's edge, and undo and redo walk the history, a new change dropping the redo side.
 */
import { describe, expect, test } from "bun:test";

import {
  blankMap,
  brush,
  clearRect,
  codeAt,
  copyRect,
  emptyTile,
  fillRect,
  floodFill,
  MapHistory,
  normRect,
  pasteClip,
} from "../../src/index.ts";

const base = () => blankMap(1000, 992);
const count = (m: ReturnType<typeof base>, layer: 0 | 1 | 2 | 3, code: string) =>
  m.layers[layer]
    .join(" ")
    .split(" ")
    .filter((c) => c === code).length;

describe("the World page's editing model (issue #33)", () => {
  test("the in-game brushes: pencil one tile, fat a plus of five, bucket the whole layer", () => {
    const m = base();
    expect(count(brush(m, 1, "pencil", "W1", 5, 5), 1, "W1")).toBe(1);
    expect(count(brush(m, 1, "fat", "W1", 5, 5), 1, "W1")).toBe(5);
    expect(count(brush(m, 1, "fat", "W1", 1, 1), 1, "W1")).toBe(3);
    expect(count(brush(m, 1, "bucket", "W1", 5, 5), 1, "W1")).toBe(17 * 12);
    // The map given is never changed.
    expect(count(m, 1, "W1")).toBe(0);
  });

  test("flood fill takes only the tiles joined to the one clicked that share its code", () => {
    // A wall across row 6 splits the layer in two.
    let m = fillRect(base(), 0, "R1", { x0: 1, y0: 6, x1: 17, y1: 6 });
    m = floodFill(m, 0, "W1", 3, 3);
    expect(count(m, 0, "W1")).toBe(17 * 5);
    expect(codeAt(m, 0, 3, 9)).toBe(emptyTile(0));
    // Filling with the code it already has changes nothing.
    expect(floodFill(m, 0, "W1", 3, 3)).toBe(m);
  });

  test("a rectangle fills or clears exactly its tiles, corners in any order, kept on the map", () => {
    expect(normRect({ x0: 20, y0: 0, x1: 3, y1: 4 })).toEqual({ x0: 3, y0: 1, x1: 17, y1: 4 });
    const m = fillRect(base(), 2, "T1", { x0: 4, y0: 4, x1: 2, y1: 2 });
    expect(count(m, 2, "T1")).toBe(9);
    const cleared = clearRect(m, { x0: 2, y0: 2, x1: 3, y1: 3 }, [2]);
    expect(count(cleared, 2, "T1")).toBe(5);
    expect(codeAt(cleared, 2, 2, 2)).toBe(emptyTile(2));
  });

  test("copy and paste carry the chosen layers and clip at the map's edge", () => {
    let m = fillRect(base(), 0, "A1", { x0: 1, y0: 1, x1: 2, y1: 2 });
    m = fillRect(m, 1, "B1", { x0: 1, y0: 1, x1: 2, y1: 2 });
    const clip = copyRect(m, { x0: 1, y0: 1, x1: 2, y1: 2 }, [0]);
    expect([clip.w, clip.h, clip.layers[1]]).toEqual([2, 2, null]);
    const pasted = pasteClip(m, clip, 16, 11);
    expect(codeAt(pasted, 0, 17, 12)).toBe("A1");
    // Only layer 1 was copied; the second layer there is as it was.
    expect(codeAt(pasted, 1, 17, 12)).toBe(emptyTile(1));
    // What falls off the map is left out.
    expect(count(pasted, 0, "A1")).toBe(4 + 4);
    expect(count(pasteClip(m, clip, 17, 12), 0, "A1")).toBe(4 + 1);
  });

  test("undo and redo walk the history; a new change drops the redo side", () => {
    const h = new MapHistory();
    const a = base();
    const b = brush(a, 0, "pencil", "Z1", 1, 1);
    h.push(a);
    const c = brush(b, 0, "pencil", "Z2", 2, 1);
    h.push(b);
    expect(h.undo(c)).toEqual(b);
    expect(h.undo(b)).toEqual(a);
    expect(h.canUndo).toBe(false);
    expect(h.redo(a)).toEqual(b);
    expect(h.canRedo).toBe(true);
    h.push(b);
    expect(h.canRedo).toBe(false);
    expect(h.undo(a)).toEqual(b);
  });
});
