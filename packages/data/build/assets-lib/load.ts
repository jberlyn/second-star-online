/**
 * Reading an atlas image as the asset build packs it: an original member from the extracted
 * bitmaps, or an added file, keyed by its rule. Both builds read images through here, so the data
 * build's hit rects see the same pixels as the atlas.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { AddedArt } from "../../schema/added-asset.ts";
import { decodePng, type Rgba } from "../../src/art/png.ts";
import { applyKey, GREEN, type KeyRule } from "./key.ts";
import type { ManifestBitmap } from "./select.ts";

export const MAIN_ROOT = "assets/original/main";
export const rootOf = (b: Pick<ManifestBitmap, "root">): string => b.root ?? MAIN_ROOT;

/**
 * Bit 0x10 of the bitmap's CASt flags byte 22 marks a bitmap whose alpha channel Director
 * uses: every cast bitmap with partial alpha has it, bar one tile (the asset notes left
 * the byte undecoded). Without it Director ignores the channel, and many extracted
 * PNGs store alpha 0 on every pixel (the frame art, Internal #186-191), so the channel is
 * reset to opaque before keying.
 */
export const USES_ALPHA = 0x10;

function ignoreAlpha(img: Rgba): Rgba {
  for (let i = 3; i < img.data.length; i += 4) {
    img.data[i] = 255;
  }
  return img;
}

/** An original member's image, not yet keyed. */
export function loadOriginal(
  repoRoot: string,
  b: Pick<ManifestBitmap, "root" | "asset" | "flags22">,
): Rgba {
  const img = decodePng(new Uint8Array(readFileSync(join(repoRoot, rootOf(b), b.asset))));
  return ((b.flags22 ?? 0) & USES_ALPHA) === 0 ? ignoreAlpha(img) : img;
}

/** Atlas members are drawn with ink 36 on green, so their green is keyed out. */
export const ATLAS_RULE: KeyRule = { kind: "color", rgb: GREEN };

/** The keying rule an added sidecar's `key` names. */
export function ruleForSidecar(key: AddedArt["key"]): KeyRule {
  switch (key) {
    case "green":
      return { kind: "color", rgb: GREEN };
    case "white":
      return { kind: "color", rgb: [255, 255, 255] };
    case "matte":
      return { kind: "matte" };
    case "none":
      return { kind: "none" };
  }
}

/** An original atlas member as packed, keyed. */
export function keyedOriginal(
  repoRoot: string,
  b: Pick<ManifestBitmap, "root" | "asset" | "flags22">,
): Rgba {
  const img = loadOriginal(repoRoot, b);
  applyKey(img, ATLAS_RULE);
  return img;
}

/** An added image as packed, keyed by its sidecar. */
export function keyedAdded(png: string, side: AddedArt): Rgba {
  const img = decodePng(new Uint8Array(readFileSync(png)));
  applyKey(img, ruleForSidecar(side.key));
  return img;
}
