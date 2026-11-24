/**
 * The PNG decoder reads whatever operators' art tools export (issue #29): indexed, low bit depths,
 * 16-bit, colour keys and interlacing, and refuses damaged or oversized files before inflating.
 */
import { describe, expect, test } from "bun:test";
import { deflateSync } from "node:zlib";

import { createRgba, decodePng, encodePng } from "../src/art/png.ts";

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(body, 8);
  view.setUint32(8 + body.length, Bun.hash.crc32(out.subarray(4, 8 + body.length)));
  return out;
}

/** A PNG from raw (unfiltered) scanlines: each row gets filter 0. */
function png(opts: {
  w: number;
  h: number;
  type: number;
  depth: number;
  interlace?: 0 | 1;
  /** The filtered stream's rows without their filter byte (one array per row, every pass in order). */
  rows: number[][];
  plte?: number[];
  trns?: number[];
}): Uint8Array {
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, opts.w);
  v.setUint32(4, opts.h);
  ihdr[8] = opts.depth;
  ihdr[9] = opts.type;
  ihdr[12] = opts.interlace ?? 0;
  const raw = new Uint8Array(opts.rows.flatMap((r) => [0, ...r]));
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    ...(opts.plte ? [chunk("PLTE", new Uint8Array(opts.plte))] : []),
    ...(opts.trns ? [chunk("tRNS", new Uint8Array(opts.trns))] : []),
    chunk("IDAT", new Uint8Array(deflateSync(raw))),
    chunk("IEND", new Uint8Array()),
  ];
  return new Uint8Array(Buffer.concat(parts));
}

const px = (img: { width: number; data: Uint8Array }, x: number, y: number) =>
  Array.from(img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));

describe("PNG decoder", () => {
  test("an indexed 2-bit image takes its palette and tRNS alphas", () => {
    // 3 pixels: indices 0, 1, 2 packed in one byte (00 01 10 xx).
    const img = decodePng(
      png({
        w: 3,
        h: 1,
        type: 3,
        depth: 2,
        rows: [[0b00011000]],
        plte: [0, 255, 0, 200, 10, 20, 1, 2, 3],
        trns: [0, 128],
      }),
    );
    expect(px(img, 0, 0)).toEqual([0, 255, 0, 0]);
    expect(px(img, 1, 0)).toEqual([200, 10, 20, 128]);
    expect(px(img, 2, 0)).toEqual([1, 2, 3, 255]);
  });

  test("1-bit greyscale scales to 0 and 255", () => {
    const img = decodePng(png({ w: 2, h: 1, type: 0, depth: 1, rows: [[0b01000000]] }));
    expect(px(img, 0, 0)).toEqual([0, 0, 0, 255]);
    expect(px(img, 1, 0)).toEqual([255, 255, 255, 255]);
  });

  test("16-bit RGBA keeps each sample's high byte", () => {
    const img = decodePng(
      png({
        w: 1,
        h: 1,
        type: 6,
        depth: 16,
        rows: [[0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0]],
      }),
    );
    expect(px(img, 0, 0)).toEqual([0x12, 0x56, 0x9a, 0xde]);
  });

  test("an RGB tRNS colour key makes that colour transparent", () => {
    const img = decodePng(
      png({
        w: 2,
        h: 1,
        type: 2,
        depth: 8,
        rows: [[0, 255, 0, 9, 9, 9]],
        trns: [0, 0, 0, 255, 0, 0],
      }),
    );
    expect(px(img, 0, 0)).toEqual([0, 255, 0, 0]);
    expect(px(img, 1, 0)).toEqual([9, 9, 9, 255]);
  });

  test("an interlaced image lands each pass's pixels where Adam7 puts them", () => {
    // 2×2 greyscale: pass 1 has (0,0); pass 6 has (1,0); pass 7 has row 1 (0,1) and (1,1).
    const img = decodePng(
      png({ w: 2, h: 2, type: 0, depth: 8, interlace: 1, rows: [[10], [20], [30, 40]] }),
    );
    expect([px(img, 0, 0)[0], px(img, 1, 0)[0], px(img, 0, 1)[0], px(img, 1, 1)[0]]).toEqual([
      10, 20, 30, 40,
    ]);
  });

  test("round-trips what it encodes", () => {
    const src = createRgba(3, 2);
    src.data.set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    expect(decodePng(encodePng(src))).toEqual(src);
  });

  test("an image past maxSide is refused before it is inflated", () => {
    const big = png({ w: 4000, h: 1, type: 0, depth: 8, rows: [] });
    expect(() => decodePng(big, { maxSide: 2048 })).toThrow("at most 2048×2048");
  });

  test("damaged and truncated files are refused", () => {
    expect(() => decodePng(new Uint8Array([1, 2, 3]))).toThrow("not a PNG file");
    const good = png({
      w: 2,
      h: 2,
      type: 0,
      depth: 8,
      rows: [
        [1, 2],
        [3, 4],
      ],
    });
    expect(() => decodePng(good.subarray(0, good.length - 20))).toThrow();
    const short = png({ w: 2, h: 2, type: 0, depth: 8, rows: [[1, 2]] });
    expect(() => decodePng(short)).toThrow("cut short");
    expect(() =>
      decodePng(png({ w: 1, h: 1, type: 3, depth: 8, rows: [[5]], plte: [0, 0, 0] })),
    ).toThrow("past the palette's end");
    expect(() => decodePng(png({ w: 1, h: 1, type: 2, depth: 4, rows: [[0]] }))).toThrow(
      "bit depth",
    );
  });
});
