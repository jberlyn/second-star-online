/**
 * A small PNG decoder and encoder (Bun built-ins only).
 * Compression is `node:zlib` (Bun's built-in, which writes the zlib wrapper PNG needs) and
 * the chunk checksum is `Bun.hash.crc32`.
 *
 * Decodes 8-bit greyscale, grey+alpha, RGB and RGBA, non-interlaced: every cast bitmap is
 * 8-bit RGBA, and new art in assets/added/ must be one of these. Encodes RGBA only, with a
 * fixed filter choice and compression level, so the same pixels always give the same bytes.
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

export function decodePng(bytes: Uint8Array): Rgba {
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== SIGNATURE[i]) {
      throw new Error("not a PNG file");
    }
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 8;
  let width = 0;
  let height = 0;
  let colorType = -1;
  const idat: Uint8Array[] = [];
  while (p + 8 <= bytes.length) {
    const len = view.getUint32(p);
    const type = String.fromCharCode(...bytes.subarray(p + 4, p + 8));
    const body = bytes.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") {
      width = view.getUint32(p + 8);
      height = view.getUint32(p + 12);
      const depth = body[8];
      colorType = body[9] ?? -1;
      const interlace = body[12];
      if (depth !== 8) {
        throw new Error(`unsupported PNG bit depth ${depth}`);
      }
      if (interlace !== 0) {
        throw new Error("interlaced PNGs are not supported");
      }
      if (![0, 2, 4, 6].includes(colorType)) {
        throw new Error(`unsupported PNG colour type ${colorType}`);
      }
    } else if (type === "IDAT") {
      idat.push(body);
    } else if (type === "IEND") {
      break;
    }
    p += 12 + len;
  }
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType] ?? 4;
  const raw = new Uint8Array(inflateSync(Buffer.concat(idat)));
  const stride = width * channels;
  const out = createRgba(width, height);
  let prev = new Uint8Array(stride);
  let line = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const base = y * (stride + 1);
    const filter = raw[base];
    for (let x = 0; x < stride; x++) {
      const v = raw[base + 1 + x] ?? 0;
      const a = x >= channels ? (line[x - channels] ?? 0) : 0;
      const b = prev[x] ?? 0;
      const c = x >= channels ? (prev[x - channels] ?? 0) : 0;
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
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const i = x * channels;
      if (channels === 4) {
        out.data.set(line.subarray(i, i + 4), o);
      } else if (channels === 3) {
        out.data[o] = line[i] ?? 0;
        out.data[o + 1] = line[i + 1] ?? 0;
        out.data[o + 2] = line[i + 2] ?? 0;
        out.data[o + 3] = 255;
      } else {
        const g = line[i] ?? 0;
        out.data[o] = g;
        out.data[o + 1] = g;
        out.data[o + 2] = g;
        out.data[o + 3] = channels === 2 ? (line[i + 1] ?? 0) : 255;
      }
    }
    [prev, line] = [line, prev];
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
