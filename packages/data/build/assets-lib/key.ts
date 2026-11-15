/**
 * Build-time keying: turns
 * Director inks into PNG alpha, per member, so nothing is keyed at runtime.
 *
 * - ink 36 (background transparent): pixels exactly the sprite's background colour vanish.
 *   Game sprites use green (0,255,0); UI sprites use white.
 * - ink 8 (matte): white connected to the image's edge vanishes.
 * - ink 32 with a blend: the whole image is drawn at blend/255 opacity (127 ≈ 50 %).
 * - ink 0 (copy): opaque.
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

export interface ScoreUsage {
  ink: number;
  /** RGB, or `["pal", index]` for a palette colour. */
  back: readonly (number | string)[];
  blend: number;
  frames: number;
}

/**
 * The rule for a UI member: its most-used score appearance, else its border-derived
 * `keyHint` (members only code places).
 */
export function ruleForUsage(usage: readonly ScoreUsage[] | undefined, keyHint: string): KeyRule {
  const top = [...(usage ?? [])].sort((a, b) => b.frames - a.frames)[0];
  if (top) {
    if (top.ink === 36) {
      const [r, g, b] = top.back;
      if (
        top.back.length === 3 &&
        typeof r === "number" &&
        typeof g === "number" &&
        typeof b === "number"
      ) {
        return { kind: "color", rgb: [r, g, b] };
      }
      // A palette index (['pal', n]). Index 5 is green: the original's character renderer keys
      // the green-backed paperdoll layers with `#bgColor: 5`, and the two
      // members scored with it (the login Cancel/OK, Internal #201/#202) are green-backed.
      // The only other index in the score, 169, is used by Internal #120/#126 alone (the
      // amount dialog's OK and Cancel, channels 89 and 92 of frames 50-67). On the runtime
      // palette 169 is #3333CC (measured in the running 1.6);
      // neither member has that colour, so ink 36 removes nothing and the black boxes stay
      // (keying white there erased the letters and left the box).
      if (top.back[0] === "pal" && top.back[1] === 5) {
        return { kind: "color", rgb: GREEN };
      }
      if (top.back[0] === "pal" && top.back[1] === 169) {
        return { kind: "color", rgb: [0x33, 0x33, 0xcc] };
      }
      if (keyHint === "green") {
        return { kind: "color", rgb: GREEN };
      }
      return { kind: "color", rgb: WHITE };
    }
    if (top.ink === 8) {
      return { kind: "matte" };
    }
    if (top.ink === 32 && top.blend > 0) {
      return { kind: "blend", alpha: top.blend / 255 };
    }
    return { kind: "none" };
  }
  if (keyHint === "green") {
    return { kind: "color", rgb: GREEN };
  }
  if (keyHint === "white") {
    return { kind: "color", rgb: WHITE };
  }
  return { kind: "none" };
}

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
