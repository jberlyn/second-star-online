/**
 * Golden rules: paintings, photos and newspapers.
 */
import { describe, expect, test } from "bun:test";

import {
  ART_TEXT,
  artBagFull,
  artRef,
  blankPaint,
  clickGate,
  ctrlGate,
  fillPaint,
  getPaintPixel,
  inOval,
  kitTileOk,
  lensOk,
  NEWS_TEXT,
  newspaperAuthor,
  type PaintImage,
  type PaintTool,
  paintAt,
  paintHit,
  paintPoint,
  photoCrop,
  quantise,
  standName,
  useDeferred,
} from "../../src/index.ts";

/** A random source returning the numbers in `seq` in turn. */
const seq = (...v: number[]) => {
  let i = 0;
  return { random: () => v[i++ % v.length] as number };
};
const px = (img: PaintImage, x: number, y: number) => getPaintPixel(img, x, y);
const tool = (n: PaintTool) => n;

describe("gate routing", () => {
  test("click: 's Newspaper before Painting before door/exit", () => {
    expect(clickGate("Alice's Newspaper", 10)).toEqual({ kind: "newspaper" });
    expect(clickGate("Painting#12", 10)).toEqual({ kind: "view" });
    expect(clickGate("Photo#12", 10)).toEqual({ kind: "view" });
    expect(clickGate("Doorman's Newspaper", 10)).toEqual({ kind: "newspaper" });
    expect(clickGate("front door", 10)).toEqual({ kind: "silent" });
  });
  test("click: names are cut at # first", () => {
    // Item 1 of "Photo#12" is "Photo"; a `#` tail never makes a name a painting.
    expect(clickGate("Photo#12", 10)).toEqual({ kind: "view" });
    expect(clickGate("Bag#Painting", 10)).not.toEqual({ kind: "view" });
    expect(clickGate("Bag#Alice's Newspaper", 10)).not.toEqual({ kind: "newspaper" });
  });
  test("Ctrl: Doorman's Newspaper is silent, door/exit first", () => {
    expect(ctrlGate("Doorman's Newspaper")).toEqual({ kind: "silent" });
    expect(ctrlGate("Alexit's Newspaper")).toEqual({ kind: "silent" });
    expect(ctrlGate("Alice's Newspaper")).toEqual({ kind: "newspaper" });
  });
  test("Ctrl: the newspaper comes after Universal Mail", () => {
    expect(ctrlGate("Universal Mail's Newspaper")).toEqual({ kind: "mail", universal: true });
  });
  test("Ctrl still takes a painting and a photo (the Ctrl handler has no Painting branch)", () => {
    expect(ctrlGate("Painting#12")).toEqual({ kind: "take" });
    expect(ctrlGate("Photo#12")).toEqual({ kind: "take" });
  });
  test("Film, Canvas, Painting and Photo leave the deferred list", () => {
    for (const n of ["Film", "Canvas", "Painting#1", "Photo#1"]) {
      expect(useDeferred(n)).toBe(false);
    }
    expect(useDeferred("Piano")).toBe(false); // Use on a Piano has its line
  });
  test("kept bug: music is silent: the Ocarina's use does nothing", () => {
    // The music reset is empty and nothing else runs, so the server answers nothing at all.
    expect(useDeferred("Ocarina")).toBe(true);
    expect(useDeferred("ocarina")).toBe(true);
  });
});

describe("5-5-5 levels (member is 16-bit)", () => {
  test("level = v >> 3, shown as (l << 3) | (l >> 2)", () => {
    expect(quantise(0)).toBe(0);
    expect(quantise(255)).toBe(255);
    expect(quantise(7)).toBe(0);
    expect(quantise(8)).toBe(8);
    expect(quantise(100)).toBe((12 << 3) | (12 >> 2));
  });
  test("values past 0-255 clamp before quantising", () => {
    expect(quantise(-5)).toBe(0);
    expect(quantise(300)).toBe(255);
  });
  test("a blank image is black and Fill paints every pixel", () => {
    const img = blankPaint();
    expect(px(img, 0, 0)).toEqual([0, 0, 0]);
    fillPaint(img, [255, 255, 255]);
    expect(px(img, 63, 63)).toEqual([255, 255, 255]);
    expect(px(img, 64, 0)).toBeNull();
  });
});

describe("brushes", () => {
  const colour: [number, number, number] = [200, 100, 50];
  test("ovals: 1×1 and 2×2 are full, 4×4 loses its corners", () => {
    expect(inOval(16, 16, 16, 16, 17, 17)).toBe(true);
    for (const [x, y] of [
      [15, 15],
      [16, 15],
      [15, 16],
      [16, 16],
    ] as const) {
      expect(inOval(x, y, 15, 15, 17, 17)).toBe(true);
    }
    expect(inOval(14, 14, 14, 14, 18, 18)).toBe(false);
    expect(inOval(15, 14, 14, 14, 18, 18)).toBe(true);
    expect(inOval(14, 15, 14, 14, 18, 18)).toBe(true);
  });
  test("tool 1: one pixel at blend 150", () => {
    const img = blankPaint();
    paintAt(img, tool(1), 10, 10, colour, seq(1));
    // round(200*150/255) = 118 → level 14 → 112|3 = 115; the pixel left of it is untouched.
    expect(px(img, 10, 10)).toEqual([
      quantise(Math.round((200 * 150) / 255)),
      quantise(Math.round((100 * 150) / 255)),
      quantise(Math.round((50 * 150) / 255)),
    ]);
    expect(px(img, 9, 10)).toEqual([0, 0, 0]);
    expect(px(img, 11, 10)).toEqual([0, 0, 0]);
  });
  test("tool 2: a 2×2 at blend 100, then a 4×4 oval at 70", () => {
    const img = blankPaint();
    paintAt(img, tool(2), 10, 10, colour, seq(1));
    const centre = px(img, 10, 10) as number[];
    const rim = px(img, 8, 10) as number[]; // inside the 4×4 only: blend 70
    expect(centre[0]).toBeGreaterThan(rim[0] as number);
    expect(px(img, 7, 10)).toEqual([0, 0, 0]);
    expect(px(img, 8, 8)).toEqual([0, 0, 0]); // the 4×4's corner is cut
  });
  test("tool 3: four ovals of 2, 4, 6, 8 at blends 20, 20, 10, 8", () => {
    const img = blankPaint();
    paintAt(img, tool(3), 20, 20, [255, 0, 0], seq(1));
    const c = px(img, 20, 20) as number[];
    const edge = px(img, 17, 20) as number[];
    expect(c[0]).toBeGreaterThan(edge[0] as number);
    expect(edge[0]).toBeGreaterThan(0);
  });
  test("tool 4: three ovals of 2, 4, 6 at blends 80, 70, 60", () => {
    const img = blankPaint();
    paintAt(img, tool(4), 20, 20, [255, 0, 0], seq(1));
    expect(px(img, 20, 20)?.[0]).toBeGreaterThan(160);
    expect(px(img, 16, 20)?.[0]).toBe(0);
  });
  test("white paints nothing with the brushes, Fill still fills white (ink 36)", () => {
    const img = blankPaint();
    for (const t of [1, 2, 3, 4] as const) {
      paintAt(img, t, 30, 30, [255, 255, 255], seq(1));
    }
    expect(px(img, 30, 30)).toEqual([0, 0, 0]);
    fillPaint(img, [255, 255, 255]);
    expect(px(img, 30, 30)).toEqual([255, 255, 255]);
  });
  test("a brush skips out-of-image pixels", () => {
    const img = blankPaint();
    paintAt(img, tool(4), 0, 0, colour, seq(1));
    expect(px(img, 0, 0)?.[0]).toBeGreaterThan(0);
  });
});

describe("darken, lighten, charcoal and jooky", () => {
  test("tool 5 adds 14 at the centre and 8 on the four arms", () => {
    const img = blankPaint();
    fillPaint(img, [64, 64, 64]);
    const b = quantise(64); // every write lands on the 5-bit grid
    paintAt(img, tool(5), 10, 10, [0, 0, 0], seq(1));
    expect(px(img, 10, 10)).toEqual([quantise(b + 14), quantise(b + 14), quantise(b + 14)]);
    expect(px(img, 11, 10)).toEqual([quantise(b + 8), quantise(b + 8), quantise(b + 8)]);
    expect(px(img, 9, 10)?.[0]).toBe(quantise(b + 8));
    expect(px(img, 10, 9)?.[0]).toBe(quantise(b + 8));
    expect(px(img, 10, 11)?.[0]).toBe(quantise(b + 8));
    expect(px(img, 11, 11)).toEqual([b, b, b]);
  });
  test("tool 6 subtracts the same, and 0 and 255 clamp", () => {
    const img = blankPaint();
    paintAt(img, tool(6), 10, 10, [0, 0, 0], seq(1));
    expect(px(img, 10, 10)).toEqual([0, 0, 0]);
    fillPaint(img, [255, 255, 255]);
    paintAt(img, tool(5), 10, 10, [0, 0, 0], seq(1));
    expect(px(img, 10, 10)).toEqual([255, 255, 255]);
    paintAt(img, tool(6), 10, 10, [0, 0, 0], seq(1));
    expect(px(img, 10, 10)).toEqual([quantise(241), quantise(241), quantise(241)]);
  });
  test("charcoal: 11 pixels, each channel loses random(8) in turn", () => {
    const img = blankPaint();
    fillPaint(img, [128, 128, 128]);
    // The centre pixel draws 8, 7, 6 for R, G, B; each result is put back on the 5-bit grid, so a
    // draw under 5 can vanish (132 - 4 = 128 is still level 16).
    const b = quantise(128);
    paintAt(img, tool(7), 20, 20, [0, 0, 0], seq(8, 7, 6));
    expect(px(img, 20, 20)).toEqual([quantise(b - 8), quantise(b - 7), quantise(b - 6)]);
    // The 11 offsets of the source: (0,0) (+1,0) (-1,0) (0,-1) (0,+1) (+2,0) (-2,0) (-1,-2)
    // (1,-2) (1,1) (-1,1).
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, -1],
      [0, 1],
      [2, 0],
      [-2, 0],
      [-1, -2],
      [1, -2],
      [1, 1],
      [-1, 1],
    ] as const) {
      expect(px(img, 20 + dx, 20 + dy)).not.toEqual([b, b, b]);
    }
    expect(px(img, 20, 22)).toEqual([b, b, b]);
  });
  test("jooky: the strictly largest channel loses random(8), the others random(2)", () => {
    const img = blankPaint();
    fillPaint(img, [128, 128, 128]);
    const b = quantise(128);
    paintAt(img, tool(8), 20, 20, [200, 10, 10], seq(8, 2, 1));
    expect(px(img, 20, 20)).toEqual([quantise(b - 8), quantise(b - 2), quantise(b - 1)]);
  });
  test("jooky on black or grey does nothing and draws nothing", () => {
    const img = blankPaint();
    fillPaint(img, [128, 128, 128]);
    let draws = 0;
    paintAt(img, tool(8), 20, 20, [90, 90, 90], {
      random: () => {
        draws++;
        return 1;
      },
    });
    expect(draws).toBe(0);
    expect(px(img, 20, 20)).toEqual([quantise(128), quantise(128), quantise(128)]);
    // Two channels tied for the largest: none strictly largest.
    paintAt(img, tool(8), 20, 20, [200, 200, 10], seq(1));
    expect(px(img, 20, 20)).toEqual([quantise(128), quantise(128), quantise(128)]);
  });
});

describe("the paint screen's hit tests", () => {
  test("paintPoint truncates toward zero (Lingo integer division)", () => {
    expect(paintPoint({ x: 245, y: 83 }, { x: 242, y: 81 })).toEqual({ x: 0, y: 0 });
    expect(paintPoint({ x: 250, y: 90 }, { x: 242, y: 81 })).toEqual({ x: 2, y: 2 });
    // Left of or above the image: -1 / 4 = 0 in Lingo, not -1.
    expect(paintPoint({ x: 240, y: 80 }, { x: 242, y: 81 })).toEqual({ x: 0, y: 0 });
    expect(paintPoint({ x: 230, y: 70 }, { x: 242, y: 81 })).toEqual({ x: -3, y: -2 });
  });
  test("Cancel, Fill, the canvas area and Save, bounds exclusive", () => {
    expect(paintHit(391, 347)).toEqual({ kind: "cancel" });
    expect(paintHit(390, 347)).toEqual({ kind: "none" });
    expect(paintHit(458, 358)).toEqual({ kind: "cancel" });
    expect(paintHit(222, 80)).toEqual({ kind: "fill" });
    expect(paintHit(221, 80)).toEqual({ kind: "none" });
    expect(paintHit(300, 200)).toEqual({ kind: "canvas" });
    expect(paintHit(236, 200)).toEqual({ kind: "none" });
    expect(paintHit(460, 350)).toEqual({ kind: "save" });
    expect(paintHit(459, 350)).toEqual({ kind: "none" });
    expect(paintHit(500, 358)).toEqual({ kind: "save" });
  });
  test("tools 1-8, the tool buttons' order and bounds", () => {
    expect(paintHit(130, 100)).toEqual({ kind: "tool", tool: 1 });
    expect(paintHit(117, 100)).toEqual({ kind: "none" });
    expect(paintHit(190, 100)).toEqual({ kind: "tool", tool: 2 });
    expect(paintHit(130, 140)).toEqual({ kind: "tool", tool: 3 });
    expect(paintHit(190, 140)).toEqual({ kind: "tool", tool: 4 });
    expect(paintHit(130, 190)).toEqual({ kind: "tool", tool: 5 });
    expect(paintHit(190, 190)).toEqual({ kind: "tool", tool: 6 });
    expect(paintHit(130, 250)).toEqual({ kind: "tool", tool: 7 });
    expect(paintHit(190, 250)).toEqual({ kind: "tool", tool: 8 });
    // Tool 1 has no upper bound but y < 120; y 120-128 at x 130 belongs to nothing.
    expect(paintHit(130, 125)).toEqual({ kind: "none" });
  });
  test("the colour pick region, exclusive", () => {
    expect(paintHit(132, 307)).toEqual({ kind: "pick" });
    expect(paintHit(131, 307)).toEqual({ kind: "none" });
    expect(paintHit(232, 365)).toEqual({ kind: "pick" });
    expect(paintHit(233, 365)).toEqual({ kind: "none" });
  });
});

describe("photos and the bag", () => {
  test("lensOk: 72<h<533 and 67<v<377, exclusive", () => {
    expect(lensOk(73, 68)).toBe(true);
    expect(lensOk(532, 376)).toBe(true);
    expect(lensOk(72, 200)).toBe(false);
    expect(lensOk(533, 200)).toBe(false);
    expect(lensOk(200, 67)).toBe(false);
    expect(lensOk(200, 377)).toBe(false);
  });
  test("photoCrop: the lens loc ± 32 in playfield pixels (stage origin 30,31)", () => {
    expect(photoCrop(300, 200)).toEqual({ x: 238, y: 137, w: 64, h: 64 });
  });
  test("artBagFull: more than 14 non-empty lines among 1-15", () => {
    const line = (n: number) => Array.from({ length: n }, (_, i) => `Item${i}`);
    expect(artBagFull([...line(14), ""])).toBe(false);
    expect(artBagFull(line(15))).toBe(true);
    expect(artBagFull(line(3))).toBe(false);
  });
  test("artRef: Painting before Photo, id after #", () => {
    expect(artRef("Painting#123")).toEqual({ kind: "painting", id: "123" });
    expect(artRef("Photo#9")).toEqual({ kind: "photo", id: "9" });
    expect(artRef("Painting of a Photo#5")).toEqual({ kind: "painting", id: "5" });
    expect(artRef("Painting")).toEqual({ kind: "painting", id: "" });
    expect(artRef("Sword")).toBeNull();
  });
  test("texts are 1.6's", () => {
    expect(ART_TEXT.needCamera).toBe("You must equip a camera to take a picture!");
    expect(ART_TEXT.noPicture).toBe("You can't take a picture here!");
    expect(ART_TEXT.viewPhoto).toBe("You view the photo, please wait...");
    expect(ART_TEXT.viewItem("Painting")).toBe("You view the Painting, please wait...");
    expect(ART_TEXT.author("Alice")).toBe("Author: Alice");
    expect(ART_TEXT.saved).toBe("...Saved!");
  });
});

describe("the newspaper", () => {
  test("newspaperAuthor is the part before '", () => {
    expect(newspaperAuthor("Alice's Newspaper")).toBe("Alice");
    expect(newspaperAuthor("King's Newspaper")).toBe("King");
  });
  test("standName is the owner + 's Newspaper", () => {
    expect(standName("Alice")).toBe("Alice's Newspaper");
  });
  test("kitTileOk: the layer 1 tile at x, y is K2, ignoring case", () => {
    const rows = ["A1 A1 A1", "A1 K2 A1", "k2 A1 A1"];
    expect(kitTileOk(rows, 2, 2)).toBe(true);
    expect(kitTileOk(rows, 1, 3)).toBe(true);
    expect(kitTileOk(rows, 1, 1)).toBe(false);
    expect(kitTileOk(rows, 9, 9)).toBe(false);
  });
  test("texts", () => {
    expect(NEWS_TEXT.view).toBe("You view the newspaper");
    expect(NEWS_TEXT.saved).toBe("Newspaper saved!");
    expect(NEWS_TEXT.noStand).toBe("You can't put a newspaper stand here!");
  });
});
