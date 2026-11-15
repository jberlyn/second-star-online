/**
 * The check on an uploaded painting or photo. Pure, standard library only: no decoder, only the
 * structure. 1.6 stored whatever the client sent.
 */

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const CRC_TABLE = (() => {
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

function crc32(bytes: Uint8Array, from: number, to: number): number {
  let c = 0xffffffff;
  for (let i = from; i < to; i++) {
    c = (CRC_TABLE[(c ^ (bytes[i] as number)) & 0xff] as number) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Is `bytes` a PNG of exactly `size`×`size`, 8 bits a channel, colour type 2 (RGB) or 6 (RGBA),
 * not interlaced, within `max` bytes? The 8-byte signature, IHDR first, every chunk's length in
 * bounds and its CRC right, at least one IDAT, and IEND last with nothing after it.
 */
export function isPng(bytes: Uint8Array, size: number, max: number): boolean {
  if (bytes.length > max || bytes.length < 8 + 25 + 12) {
    return false;
  }
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== SIGNATURE[i]) {
      return false;
    }
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 8;
  let first = true;
  let idat = false;
  while (at + 12 <= bytes.length) {
    const len = view.getUint32(at);
    const end = at + 12 + len;
    if (end > bytes.length) {
      return false;
    }
    const type = String.fromCharCode(
      bytes[at + 4] as number,
      bytes[at + 5] as number,
      bytes[at + 6] as number,
      bytes[at + 7] as number,
    );
    if (crc32(bytes, at + 4, at + 8 + len) !== view.getUint32(at + 8 + len)) {
      return false;
    }
    if (first) {
      if (type !== "IHDR" || len !== 13) {
        return false;
      }
      const depth = bytes[at + 8 + 8];
      const colour = bytes[at + 8 + 9];
      const compression = bytes[at + 8 + 10];
      const filter = bytes[at + 8 + 11];
      const interlace = bytes[at + 8 + 12];
      if (
        view.getUint32(at + 8) !== size ||
        view.getUint32(at + 12) !== size ||
        depth !== 8 ||
        (colour !== 2 && colour !== 6) ||
        compression !== 0 ||
        filter !== 0 ||
        interlace !== 0
      ) {
        return false;
      }
      first = false;
    } else if (type === "IDAT") {
      idat = true;
    } else if (type === "IEND") {
      return len === 0 && idat && end === bytes.length;
    }
    at = end;
  }
  return false;
}

/** A 64×64 art image: see `isPng`. */
export const isPng64 = (bytes: Uint8Array, max: number) => isPng(bytes, 64, max);
