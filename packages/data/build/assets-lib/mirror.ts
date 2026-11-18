/**
 * North frames stored mirrored. 1.6's back views of the paperdoll and of most bodies were drawn
 * as if seen from the front, so from behind the character holds its weapon in the left hand and
 * its shield in the right. The asset build flips every frame whose sidecar says
 * `"mirrored": true` (an added file's own sidecar, or an original's entry in
 * assets/original-sidecars.json) before packing it, so the atlas holds it the right way round and
 * nothing that draws it needs to know.
 */
import { createRgba, type Rgba } from "./png.ts";

const NORTH = /^(.*)-F\d-N$/i;

/** The layer or body a north frame belongs to (`Small Shield` for `Small Shield-F2-N`), or null. */
export function northEntity(name: string): string | null {
  return NORTH.exec(name)?.[1] ?? null;
}

/**
 * Paperdoll layers are pasted at the 46×45 composite's top-left, so a layer is flipped about the
 * body's centre line, not its registration point (25, 6): the default body covers columns 9 to 35
 * in every north frame, and column x becomes `PAPERDOLL_AXIS - x`, leaving the body in place.
 */
export const PAPERDOLL_AXIS = 44;

/** A paperdoll layer flipped about the body's centre line. Throws if a pixel would be cut off. */
export function mirrorPaperdoll(img: Rgba, label: string): Rgba {
  const out = createRgba(PAPERDOLL_AXIS + 1, img.height);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const from = (y * img.width + x) * 4;
      if (img.data[from + 3] === 0) {
        continue;
      }
      if (x > PAPERDOLL_AXIS) {
        throw new Error(`${label}: column ${x} is past the paperdoll's mirror line`);
      }
      out.data.set(img.data.subarray(from, from + 4), (y * out.width + PAPERDOLL_AXIS - x) * 4);
    }
  }
  return out;
}

/**
 * Where a body's figure stands: twice the mean x of its opaque pixel centres, measured from the
 * registration point and rounded, so a flip about it maps whole pixels to whole pixels. A body's
 * north frames all flip about the line taken from its standing frame, F2-N (`STANDING_FRAME`),
 * so a monster faces away from where it stood facing south, and its walk and attack frames stay
 * in step. 1.6's registration points sit off the figure's centre by up to 6 pixels, so a flip
 * about them would slide the body sideways when it turned.
 */
export function centreLine2(img: Rgba, regX: number): number {
  let sum = 0;
  let n = 0;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.data[(y * img.width + x) * 4 + 3]) {
        sum += x + 0.5;
        n += 1;
      }
    }
  }
  return n === 0 ? 0 : Math.round(2 * (sum / n - regX));
}

/** The north frame a body's centre line is taken from. */
export const STANDING_FRAME = "F2";

/** The name of the frame a body's centre line comes from (`31-F2-N` for `31-F4-N`). */
export function standingFrameOf(name: string): string | null {
  const entity = northEntity(name);
  return entity === null ? null : `${entity}-${STANDING_FRAME}-N`;
}

/**
 * A body frame flipped about the vertical line `line2 / 2` pixels right of its registration point
 * (`centreLine2`): the image reversed, and regX moved so the figure stays where it was.
 */
export function mirrorBody(img: Rgba, regX: number, line2: number): { img: Rgba; regX: number } {
  const out = createRgba(img.width, img.height);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const from = (y * img.width + x) * 4;
      out.data.set(img.data.subarray(from, from + 4), (y * img.width + img.width - 1 - x) * 4);
    }
  }
  return { img: out, regX: img.width - regX - line2 };
}

/** One atlas image and its `mirrored` flag, named for errors by `file`. */
export interface MirrorFlag {
  group: string;
  name: string;
  mirrored: boolean;
  file: string;
}

/**
 * Checks `mirrored` flags: only on north frames of paperdoll layers and bodies, and the same on
 * every north frame of one layer or body. Throws naming the file.
 */
export function checkMirroredFlags(images: readonly MirrorFlag[]): void {
  const byEntity = new Map<string, MirrorFlag>();
  for (const a of images) {
    const entity = northEntity(a.name);
    if (a.mirrored && (entity === null || (a.group !== "paperdoll" && a.group !== "bodies"))) {
      throw new Error(
        `${a.file}: "mirrored" is only for north frames (-F<n>-N) of paperdoll layers and bodies`,
      );
    }
    if (entity === null) {
      continue;
    }
    const key = `${a.group}/${entity.toLowerCase()}`;
    const prev = byEntity.get(key);
    if (prev && prev.mirrored !== a.mirrored) {
      throw new Error(
        `${a.file}: "mirrored" must match on every north frame of ${entity} (${prev.file} differs)`,
      );
    }
    byEntity.set(key, a);
  }
}
