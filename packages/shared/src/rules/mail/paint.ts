/**
 * Paintings and photos. Pure rules over the generated `socialData.art`.
 *
 * The painting is member "Painting", 64×64 and 16-bit: every pixel the tools write is stored at 5
 * bits a channel, `level = v >> 3`, shown as `(l << 3) | (l >> 2)`. The tools run on the client
 * only; the server receives the finished PNG.
 */
import { socialData } from "@secondstaronline/data";

import type { Rng } from "../core/lingo.ts";

const A = socialData.art;

const fill = (s: string, v: Record<string, string>) =>
  s.replace(/\{([A-Z]+)\}/g, (_m, k: string) => v[k] ?? "");
const ax = (k: keyof typeof A.texts) => A.texts[k].text;

/** Every art text, verbatim. */
export const ART_TEXT = {
  paintFull: ax("paintFull"),
  paintSaving: ax("paintSaving"),
  photoFull: ax("photoFull"),
  photoSaving: ax("photoSaving"),
  saved: ax("saved"),
  viewPhoto: ax("viewPhoto"),
  viewItem: (name: string) => fill(ax("viewItem"), { NAME: name }),
  author: (name: string) => fill(ax("author"), { NAME: name }),
  needCamera: ax("needCamera"),
  noPicture: ax("noPicture"),
  notInFront: (name: string) => fill(ax("notInFront"), { NAME: name }),
} as const;

/** The painting's side in pixels (member 505) and its on-screen scale. */
export const PAINT_SIZE = A.size;
export const PAINT_SCALE = A.scale;
/** `lensOk`'s bounds. */
export const LENS = A.lens;

/** A 64×64 image of displayed RGB triples (always on the 5-bit grid). */
export interface PaintImage {
  readonly data: Uint8ClampedArray;
}

/** `v` clamped to 0-255 and put on the 5-bit grid: `(l << 3) | (l >> 2)` with `l = v >> 3`. */
export function quantise(v: number): number {
  const l = Math.max(0, Math.min(255, Math.trunc(v))) >> 3;
  return (l << 3) | (l >> 2);
}

/** Using a canvas fills the member black when no canvas is held. */
export function blankPaint(): PaintImage {
  return { data: new Uint8ClampedArray(PAINT_SIZE * PAINT_SIZE * 3) };
}

/** Fill: the whole image in one colour. */
export function fillPaint(img: PaintImage, rgb: readonly [number, number, number]): void {
  const q = rgb.map(quantise);
  for (let i = 0; i < img.data.length; i += 3) {
    img.data[i] = q[0] as number;
    img.data[i + 1] = q[1] as number;
    img.data[i + 2] = q[2] as number;
  }
}

/** Load 64×64 RGB(A) pixels (a decoded PNG or a crop), quantised, into the image. */
export function setPaintPixels(img: PaintImage, rgba: ArrayLike<number>, channels: 3 | 4): void {
  for (let i = 0, j = 0; i < img.data.length; i += 3, j += channels) {
    img.data[i] = quantise(rgba[j] ?? 0);
    img.data[i + 1] = quantise(rgba[j + 1] ?? 0);
    img.data[i + 2] = quantise(rgba[j + 2] ?? 0);
  }
}

export function getPaintPixel(
  img: PaintImage,
  x: number,
  y: number,
): [number, number, number] | null {
  if (x < 0 || y < 0 || x >= PAINT_SIZE || y >= PAINT_SIZE) {
    return null;
  }
  const i = (y * PAINT_SIZE + x) * 3;
  return [img.data[i] as number, img.data[i + 1] as number, img.data[i + 2] as number];
}

function setPaintPixel(
  img: PaintImage,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
): void {
  if (x < 0 || y < 0 || x >= PAINT_SIZE || y >= PAINT_SIZE) {
    return;
  }
  const i = (y * PAINT_SIZE + x) * 3;
  img.data[i] = quantise(r);
  img.data[i + 1] = quantise(g);
  img.data[i + 2] = quantise(b);
}

/**
 * Is pixel (x, y) of a filled `#oval` over `[l, t, r, b)` set? The pixel's centre is inside
 * the ellipse, so 1×1 and 2×2 are full and 4×4 loses its corners.
 */
export function inOval(x: number, y: number, l: number, t: number, r: number, b: number): boolean {
  if (x < l || x >= r || y < t || y >= b) {
    return false;
  }
  const rx = (r - l) / 2;
  const ry = (b - t) / 2;
  const dx = (x + 0.5 - (l + r) / 2) / rx;
  const dy = (y + 0.5 - (t + b) / 2) / ry;
  return dx * dx + dy * dy <= 1;
}

/** A random roll from 1 through n. */
const rand = (rnd: Rng, n: number) => rnd.random(n);

/** The 11 pixels of the charcoal and jooky tools, in source order. */
export const SMUDGE_OFFSETS: readonly (readonly [number, number])[] = [
  [0, 0],
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
];
/** The darken and lighten pixels: the centre first, then the arms. */
const SHADE_OFFSETS: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 0],
  [-1, 0],
  [0, -1],
  [0, 1],
];

/** The tool numbers: 1-4 brushes, 5 darken, 6 lighten, 7 charcoal, 8 jooky. */
export type PaintTool = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/**
 * One paint: tool `tool` at image pixel (`sx`, `sy`) with the current colour `rgb`. `rnd(n)`
 * draws uniformly from 1 through n. Out-of-image pixels are skipped.
 */
export function paintAt(
  img: PaintImage,
  tool: PaintTool,
  sx: number,
  sy: number,
  rgb: readonly [number, number, number],
  rnd: Rng,
): void {
  if (tool <= 4) {
    // Every colour paints, pure white included (1.6 drew the brush with ink 36, white
    // transparent, so white left no mark).
    const def = A.tools[tool - 1];
    if (!def) {
      return;
    }
    def.blends.forEach((blend, n) => {
      const rect = def.rects[n];
      if (!rect) {
        return;
      }
      const [l, t, r, b] = rect;
      for (let y = t; y < b; y++) {
        for (let x = l; x < r; x++) {
          if (!inOval(x, y, l, t, r, b)) {
            continue;
          }
          const px = sx - 16 + x;
          const py = sy - 16 + y;
          const cur = getPaintPixel(img, px, py);
          if (!cur) {
            continue;
          }
          const mix = (s: number, d: number) => Math.round((s * blend + d * (255 - blend)) / 255);
          setPaintPixel(img, px, py, mix(rgb[0], cur[0]), mix(rgb[1], cur[1]), mix(rgb[2], cur[2]));
        }
      }
    });
    return;
  }
  if (tool === 5 || tool === 6) {
    // Tool 5 adds, tool 6 subtracts: the centre by `centre`, the arms by `arm`.
    const sign = tool === 5 ? 1 : -1;
    SHADE_OFFSETS.forEach(([dx, dy], i) => {
      const cur = getPaintPixel(img, sx + dx, sy + dy);
      if (!cur) {
        return;
      }
      const d = sign * (i === 0 ? A.shade.centre : A.shade.arm);
      setPaintPixel(img, sx + dx, sy + dy, cur[0] + d, cur[1] + d, cur[2] + d);
    });
    return;
  }
  if (tool === 7) {
    for (const [dx, dy] of SMUDGE_OFFSETS) {
      const cur = getPaintPixel(img, sx + dx, sy + dy);
      // The draws happen even off the image in 1.6 (reading outside the original image returns a
      // colour); SSO skips the pixel and its draws.
      if (!cur) {
        continue;
      }
      const r = cur[0] - rand(rnd, 8);
      const g = cur[1] - rand(rnd, 8);
      const b = cur[2] - rand(rnd, 8);
      setPaintPixel(img, sx + dx, sy + dy, r, g, b);
    }
    return;
  }
  // Tool 8: the colour's strictly largest channel loses `random(8)`, the others `random(2)`; with
  // no strictly largest channel (black, greys) nothing changes.
  const [R, G, B] = rgb;
  const dom = R > G && R > B ? 0 : G > R && G > B ? 1 : B > R && B > G ? 2 : -1;
  if (dom < 0) {
    return;
  }
  for (const [dx, dy] of SMUDGE_OFFSETS) {
    const cur = getPaintPixel(img, sx + dx, sy + dy);
    if (!cur) {
      continue;
    }
    const out = cur.map((v, c) => v - rand(rnd, c === dom ? 8 : 2));
    setPaintPixel(img, sx + dx, sy + dy, out[0] as number, out[1] as number, out[2] as number);
  }
}

/**
 * The paint point from the pointer: `(mouse − sprite 398's top-left) / 4`, using integer division
 * (truncating toward zero).
 */
export function paintPoint(
  mouse: { x: number; y: number },
  topLeft: { x: number; y: number },
): { x: number; y: number } {
  return {
    x: Math.trunc((mouse.x - topLeft.x) / PAINT_SCALE) + 0,
    y: Math.trunc((mouse.y - topLeft.y) / PAINT_SCALE) + 0,
  };
}

export type PaintHit =
  | { kind: "cancel" }
  | { kind: "fill" }
  | { kind: "canvas" }
  | { kind: "save" }
  | { kind: "tool"; tool: PaintTool }
  | { kind: "pick" }
  | { kind: "none" };

/** Sprite 395's `mouseDown`, in order, bounds exclusive, stage coordinates. */
export function paintHit(x: number, y: number): PaintHit {
  const inside = (l: number, r: number, t: number, b: number) => x > l && x < r && y > t && y < b;
  if (x < 459 && x > 390 && y > 346 && y < 359) {
    return { kind: "cancel" };
  }
  if (inside(221, 234, 79, 95)) {
    return { kind: "fill" };
  }
  if (inside(236, 504, 76, 339)) {
    return { kind: "canvas" };
  }
  if (inside(459, 501, 346, 359)) {
    return { kind: "save" };
  }
  if (x > 117 && x < 155 && y < 120) {
    return { kind: "tool", tool: 1 };
  }
  if (x > 171 && x < 221 && y < 129) {
    return { kind: "tool", tool: 2 };
  }
  if (inside(117, 155, 129, 160)) {
    return { kind: "tool", tool: 3 };
  }
  if (inside(171, 221, 131, 159)) {
    return { kind: "tool", tool: 4 };
  }
  if (inside(120, 157, 172, 210)) {
    return { kind: "tool", tool: 5 };
  }
  if (inside(173, 213, 168, 208)) {
    return { kind: "tool", tool: 6 };
  }
  if (inside(120, 157, 210, 280)) {
    return { kind: "tool", tool: 7 };
  }
  if (inside(173, 213, 210, 280)) {
    return { kind: "tool", tool: 8 };
  }
  if (inside(131, 233, 306, 366)) {
    return { kind: "pick" };
  }
  return { kind: "none" };
}

/** The photo routine's test on the lens loc. */
export function lensOk(h: number, v: number): boolean {
  return h > LENS.hMin && h < LENS.hMax && v > LENS.vMin && v < LENS.vMax;
}

/**
 * The photo crop rectangle in the playfield's own pixels: the lens loc ± 32, minus the
 * playfield's stage origin 30,31 (the photo frame's layout).
 */
export function photoCrop(h: number, v: number): { x: number; y: number; w: number; h: number } {
  return { x: h - 30 - 32, y: v - 31 - 32, w: PAINT_SIZE, h: PAINT_SIZE };
}

/**
 * The art bag test: more than 14 non-empty lines among `Inventory` lines 1-15. `bag` is the lines
 * in order; an empty line is "" or whitespace-free empty.
 */
export function artBagFull(bag: readonly string[]): boolean {
  let n = 0;
  for (let i = 0; i < A.bagLines; i++) {
    if ((bag[i] ?? "") !== "") {
      n++;
    }
  }
  return n > A.bagMax;
}

/**
 * A name containing "Painting" takes precedence over one containing "Photo". Return the kind
 * and the second part of the name split on `#`; return null for any other name.
 */
export function artRef(name: string): { kind: "painting" | "photo"; id: string } | null {
  const lower = name.toLowerCase();
  const kind = lower.includes("painting") ? "painting" : lower.includes("photo") ? "photo" : null;
  if (!kind) {
    return null;
  }
  return { kind, id: name.split("#")[1] ?? "" };
}
