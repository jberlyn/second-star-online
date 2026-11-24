/**
 * The art library: PNG decoding and encoding, keying, mirroring north frames and packing atlases.
 * The asset build uses it for the shipped packs, and the server for operators' uploads (issue
 * #29). Never the client (it inflates with node:zlib).
 */
export { applyKey, BLACK, GREEN, type KeyRule, WHITE } from "./key.ts";
export {
  centreLine2,
  mirrorBody,
  mirrorPaperdoll,
  northEntity,
  PAPERDOLL_AXIS,
  STANDING_FRAME,
} from "./mirror.ts";
export {
  MAX_SHEET,
  PADDING,
  type PackItem,
  type PackResult,
  type Placement,
  pack,
} from "./pack.ts";
export {
  blit,
  createRgba,
  type DecodeOptions,
  decodePng,
  encodePng,
  pngSize,
  type Rgba,
} from "./png.ts";
