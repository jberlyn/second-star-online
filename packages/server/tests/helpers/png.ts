/** A real PNG for the art tests: `w`×`h`, colour type 2 (RGB) or 6 (RGBA), 8 bits, no interlace. */
import { deflateSync } from "node:zlib";

const table = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  return t;
})();
const crc = (b: Uint8Array) => {
  let c = 0xffffffff;
  for (const x of b) {
    c = (table[(c ^ x) & 0xff] as number) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Uint8Array): Uint8Array => {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) {
    out[4 + i] = type.charCodeAt(i);
  }
  out.set(data, 8);
  v.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)));
  return out;
};

export function makePng(
  w = 64,
  h = 64,
  opts: { colour?: 2 | 6; depth?: number; interlace?: number; noise?: number } = {},
): Uint8Array {
  const colour = opts.colour ?? 2;
  const channels = colour === 6 ? 4 : 3;
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, w);
  v.setUint32(4, h);
  ihdr[8] = opts.depth ?? 8;
  ihdr[9] = colour;
  ihdr[12] = opts.interlace ?? 0;
  const raw = new Uint8Array(h * (1 + w * channels));
  let s = opts.noise ?? 0;
  for (let y = 0; y < h; y++) {
    for (let i = 0; i < w * channels; i++) {
      s = (s * 1103515245 + 12345) >>> 0;
      raw[y * (1 + w * channels) + 1 + i] = opts.noise ? (s >>> 16) & 0xff : (x(i) + y) & 0xff;
    }
  }
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", new Uint8Array(deflateSync(raw))),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
const x = (i: number) => i * 3;

export const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
