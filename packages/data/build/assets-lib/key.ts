/**
 * Build-time keying rules: which rule (src/art/key.ts) each original member takes, from how 1.6's
 * score drew it (its ink and background colour).
 */
import { BLACK, GREEN, type KeyRule, WHITE } from "../../src/art/key.ts";

export { applyKey, BLACK, GREEN, type KeyRule, WHITE } from "../../src/art/key.ts";

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
      // neither member has that colour, so in 1.6 ink 36 removed nothing and the buttons sat
      // in black boxes on the dialog's #101010 panel. SSO keys their black instead, so the
      // letters sit on the panel (keying white erases the letters and leaves the box).
      if (top.back[0] === "pal" && top.back[1] === 5) {
        return { kind: "color", rgb: GREEN };
      }
      if (top.back[0] === "pal" && top.back[1] === 169) {
        return { kind: "color", rgb: BLACK };
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
