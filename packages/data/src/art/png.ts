/**
 * A small PNG decoder and encoder (Bun built-ins only).
 * Compression is `node:zlib` (Bun's built-in, which writes the zlib wrapper PNG needs) and
 * the chunk checksum is `Bun.hash.crc32`.
 *
 * Decodes every standard PNG (any colour type, bit depth and interlacing), since operators upload
 * whatever their art tools export (issue #29). Encodes RGBA only, with a fixed filter choice and
 * compression level, so the same pixels always give the same bytes.
 */
import { deflateSync, inflateSync } from "node:zlib";

export interface Rgba {
  width: number;
  height: number;
  /** width × height × 4 bytes, row-major, straight (not premultiplied) alpha. */
  data: Uint8Array;
}

const SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function createRgba(width: number, height: number): Rgba {
  return { width, height, data: new Uint8Array(width * height * 4) };
}

/** The width and height from the IHDR, after checking the signature. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } {
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== SIGNATURE[i]) {
      throw new Error("not a PNG file");
    }
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

export interface DecodeOptions {
  /**
   * Refuse an image wider or taller than this before inflating it (an upload names its own size,
   * so a hostile one could ask for gigabytes). Default: no limit, for the build's trusted files.
   */
  maxSide?: number;
}

/** Adam7's seven passes: start column, start row, column step, row step. */
const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const;

/** Samples per pixel for each colour type. */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
/** The bit depths each colour type allows. */
const DEPTHS: Record<number, readonly number[]> = {
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  3: [1, 2, 4, 8],
  4: [8, 16],
  6: [8, 16],
};

/**
 * Decodes any standard PNG to 8-bit RGBA: greyscale, RGB, indexed (with its `tRNS` alphas),
 * grey+alpha and RGBA, at every bit depth the format allows (16-bit samples keep their high
 * byte), interlaced or not, with a `tRNS` colour key for greyscale and RGB. Throws on anything
 * malformed, naming what.
 */
export function decodePng(bytes: Uint8Array, options: DecodeOptions = {}): Rgba {
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== SIGNATURE[i]) {
      throw new Error("not a PNG file");
    }
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = -1;
  let interlace = 0;
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  let ended = false;
  while (p + 8 <= bytes.length) {
    const len = view.getUint32(p);
    if (p + 12 + len > bytes.length) {
      throw new Error("PNG file is cut short");
    }
    const type = String.fromCharCode(...bytes.subarray(p + 4, p + 8));
    const body = bytes.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") {
      if (len < 13) {
        throw new Error("PNG header is cut short");
      }
      width = view.getUint32(p + 8);
      height = view.getUint32(p + 12);
      depth = body[8] ?? 0;
      colorType = body[9] ?? -1;
      interlace = body[12] ?? 0;
      if (!(colorType in DEPTHS)) {
        throw new Error(`unsupported PNG colour type ${colorType}`);
      }
      if (!DEPTHS[colorType]?.includes(depth)) {
        throw new Error(`unsupported PNG bit depth ${depth} for colour type ${colorType}`);
      }
      if (interlace !== 0 && interlace !== 1) {
        throw new Error(`unsupported PNG interlace method ${interlace}`);
      }
      if (width < 1 || height < 1) {
        throw new Error("PNG image is empty");
      }
      if (options.maxSide !== undefined && (width > options.maxSide || height > options.maxSide)) {
        throw new Error(
          `the image is ${width}×${height}; images may be at most ${options.maxSide}×${options.maxSide}`,
        );
      }
    } else if (type === "PLTE") {
      palette = body;
    } else if (type === "tRNS") {
      trns = body;
    } else if (type === "IDAT") {
      idat.push(body);
    } else if (type === "IEND") {
      ended = true;
      break;
    }
    p += 12 + len;
  }
  if (colorType < 0) {
    throw new Error("PNG file has no header");
  }
  if (!ended && idat.length === 0) {
    throw new Error("PNG file has no image data");
  }
  if (colorType === 3 && !palette) {
    throw new Error("indexed PNG has no palette");
  }
  const channels = CHANNELS[colorType] as number;
  const bitsPP = channels * depth;
  const bytesPP = Math.max(1, bitsPP >> 3);
  const rowBytes = (w: number) => Math.ceil((w * bitsPP) / 8);
  // Every byte the passes need, so a bomb stops at the size the header promised.
  const passes =
    interlace === 1
      ? ADAM7.map(([x0, y0, dx, dy]) => ({
          x0,
          y0,
          dx,
          dy,
          w: Math.ceil((width - x0) / dx),
          h: Math.ceil((height - y0) / dy),
        })).filter((q) => q.w > 0 && q.h > 0)
      : [{ x0: 0, y0: 0, dx: 1, dy: 1, w: width, h: height }];
  const expected = passes.reduce((n, q) => n + q.h * (rowBytes(q.w) + 1), 0);
  let raw: Uint8Array;
  try {
    raw = new Uint8Array(inflateSync(Buffer.concat(idat), { maxOutputLength: expected + 1 }));
  } catch {
    throw new Error("PNG image data is damaged");
  }
  if (raw.length < expected) {
    throw new Error("PNG image data is cut short");
  }
  const out = createRgba(width, height);
  const maxSample = (1 << Math.min(depth, 8)) - 1;
  // The tRNS colour key for greyscale and RGB, in sample units of the image's own depth.
  const key =
    trns && colorType === 0 && trns.length >= 2
      ? [(trns[0] as number) * 256 + (trns[1] as number)]
      : trns && colorType === 2 && trns.length >= 6
        ? [0, 2, 4].map((i) => (trns?.[i] as number) * 256 + (trns?.[i + 1] as number))
        : null;
  let offset = 0;
  for (const q of passes) {
    const stride = rowBytes(q.w);
    let prev = new Uint8Array(stride);
    let line = new Uint8Array(stride);
    for (let y = 0; y < q.h; y++) {
      const base = offset + y * (stride + 1);
      const filter = raw[base];
      for (let x = 0; x < stride; x++) {
        const v = raw[base + 1 + x] ?? 0;
        const a = x >= bytesPP ? (line[x - bytesPP] ?? 0) : 0;
        const b = prev[x] ?? 0;
        const c = x >= bytesPP ? (prev[x - bytesPP] ?? 0) : 0;
        let r: number;
        switch (filter) {
          case 0:
            r = v;
            break;
          case 1:
            r = v + a;
            break;
          case 2:
            r = v + b;
            break;
          case 3:
            r = v + ((a + b) >> 1);
            break;
          case 4:
            r = v + paeth(a, b, c);
            break;
          default:
            throw new Error(`bad PNG filter ${filter}`);
        }
        line[x] = r & 255;
      }
      // One sample: its full value (for the colour key) and its 8-bit value.
      const sample = (x: number, ch: number): [number, number] => {
        if (depth === 16) {
          const i = (x * channels + ch) * 2;
          const hi = line[i] ?? 0;
          return [hi * 256 + (line[i + 1] ?? 0), hi];
        }
        if (depth === 8) {
          const v = line[x * channels + ch] ?? 0;
          return [v, v];
        }
        const bit = (x * channels + ch) * depth;
        const v = ((line[bit >> 3] ?? 0) >> (8 - depth - (bit & 7))) & maxSample;
        return [v, colorType === 3 ? v : Math.round((v * 255) / maxSample)];
      };
      const row = q.y0 + y * q.dy;
      for (let x = 0; x < q.w; x++) {
        const o = (row * width + q.x0 + x * q.dx) * 4;
        if (colorType === 3) {
          const [i] = sample(x, 0);
          if (!palette || i * 3 + 2 >= palette.length) {
            throw new Error(`PNG pixel uses palette entry ${i}, past the palette's end`);
          }
          out.data[o] = palette[i * 3] as number;
          out.data[o + 1] = palette[i * 3 + 1] as number;
          out.data[o + 2] = palette[i * 3 + 2] as number;
          out.data[o + 3] = trns && i < trns.length ? (trns[i] as number) : 255;
        } else if (colorType === 2 || colorType === 6) {
          const r = sample(x, 0);
          const g = sample(x, 1);
          const b = sample(x, 2);
          out.data[o] = r[1];
          out.data[o + 1] = g[1];
          out.data[o + 2] = b[1];
          out.data[o + 3] =
            colorType === 6
              ? sample(x, 3)[1]
              : key && r[0] === key[0] && g[0] === key[1] && b[0] === key[2]
                ? 0
                : 255;
        } else {
          const g = sample(x, 0);
          out.data[o] = g[1];
          out.data[o + 1] = g[1];
          out.data[o + 2] = g[1];
          out.data[o + 3] = colorType === 4 ? sample(x, 1)[1] : key && g[0] === key[0] ? 0 : 255;
        }
      }
      [prev, line] = [line, prev];
    }
    offset += q.h * (stride + 1);
  }
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) {
    return a;
  }
  if (pb <= pc) {
    return b;
  }
  return c;
}

/**
 * Encodes RGBA. Each row uses whichever of the five filters gives the smallest sum of
 * absolute byte values (the usual heuristic); ties go to the lower filter number, so the
 * output is fully determined by the pixels.
 */
export function encodePng(img: Rgba): Uint8Array {
  const { width, height, data } = img;
  const stride = width * 4;
  const filtered = new Uint8Array((stride + 1) * height);
  const candidates = Array.from({ length: 5 }, () => new Uint8Array(stride));
  for (let y = 0; y < height; y++) {
    const row = data.subarray(y * stride, (y + 1) * stride);
    const up = y > 0 ? data.subarray((y - 1) * stride, y * stride) : new Uint8Array(stride);
    let best = 0;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let f = 0; f < 5; f++) {
      const cand = candidates[f] as Uint8Array;
      let score = 0;
      for (let x = 0; x < stride; x++) {
        const v = row[x] ?? 0;
        const a = x >= 4 ? (row[x - 4] ?? 0) : 0;
        const b = up[x] ?? 0;
        const c = x >= 4 ? (up[x - 4] ?? 0) : 0;
        let r: number;
        if (f === 0) {
          r = v;
        } else if (f === 1) {
          r = v - a;
        } else if (f === 2) {
          r = v - b;
        } else if (f === 3) {
          r = v - ((a + b) >> 1);
        } else {
          r = v - paeth(a, b, c);
        }
        r &= 255;
        cand[x] = r;
        score += r < 128 ? r : 256 - r;
      }
      if (score < bestScore) {
        bestScore = score;
        best = f;
      }
    }
    filtered[y * (stride + 1)] = best;
    filtered.set(candidates[best] as Uint8Array, y * (stride + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const hv = new DataView(ihdr.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const idat = new Uint8Array(deflateSync(filtered, { level: 9 }));
  return concat([
    SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) {
    out[4 + i] = type.charCodeAt(i);
  }
  out.set(body, 8);
  v.setUint32(8 + body.length, Bun.hash.crc32(out.subarray(4, 8 + body.length)) >>> 0);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Copies `src` into `dst` at (dx, dy), replacing pixels (no blending). */
export function blit(dst: Rgba, src: Rgba, dx: number, dy: number): void {
  for (let y = 0; y < src.height; y++) {
    const from = y * src.width * 4;
    dst.data.set(src.data.subarray(from, from + src.width * 4), ((dy + y) * dst.width + dx) * 4);
  }
}
