/**
 * Keying: turns a colour (or a white matte, or a blend) into PNG alpha, so nothing is keyed at
 * runtime. The asset build picks a rule per original member (build/assets-lib/key.ts); the server
 * applies an operator upload's rule when it packs the operator's atlases (issue #29).
 *
 * - `color`: pixels exactly that colour vanish (ink 36: green for game sprites, white for UI).
 * - `matte`: white connected to the image's edge vanishes (ink 8).
 * - `blend`: the whole image at that opacity (ink 32 with a blend).
 * - `none`: opaque, or the PNG's own alpha.
 */
import type { Rgba } from "./png.ts";

export type KeyRule =
  | { kind: "none" }
  | { kind: "color"; rgb: readonly [number, number, number] }
  | { kind: "matte" }
  | { kind: "blend"; alpha: number };

export const GREEN = [0, 255, 0] as const;
export const WHITE = [255, 255, 255] as const;
export const BLACK = [0, 0, 0] as const;

/** Applies a rule in place. */
export function applyKey(img: Rgba, rule: KeyRule): void {
  const d = img.data;
  switch (rule.kind) {
    case "none":
      return;
    case "color": {
      const [r, g, b] = rule.rgb;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] === r && d[i + 1] === g && d[i + 2] === b) {
          d[i + 3] = 0;
        }
      }
      return;
    }
    case "blend": {
      for (let i = 3; i < d.length; i += 4) {
        d[i] = Math.round((d[i] ?? 0) * rule.alpha);
      }
      return;
    }
    case "matte": {
      const { width: w, height: h } = img;
      const isWhite = (p: number) =>
        d[p * 4] === 255 && d[p * 4 + 1] === 255 && d[p * 4 + 2] === 255;
      const seen = new Uint8Array(w * h);
      const stack: number[] = [];
      for (let x = 0; x < w; x++) {
        stack.push(x, (h - 1) * w + x);
      }
      for (let y = 0; y < h; y++) {
        stack.push(y * w, y * w + w - 1);
      }
      while (stack.length > 0) {
        const p = stack.pop() as number;
        if (seen[p] || !isWhite(p)) {
          continue;
        }
        seen[p] = 1;
        d[p * 4 + 3] = 0;
        const x = p % w;
        const y = (p - x) / w;
        if (x > 0) {
          stack.push(p - 1);
        }
        if (x < w - 1) {
          stack.push(p + 1);
        }
        if (y > 0) {
          stack.push(p - w);
        }
        if (y < h - 1) {
          stack.push(p + w);
        }
      }
      return;
    }
  }
}
