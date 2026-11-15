/**
 * Map fog (map field 12 items 6-10), as the original builds it and the World Editor
 * previews it:
 * 1. the fog bitmap (Internal #424, 272×192) is filled with the map's colour;
 * 2. the texture is copied, then the fog bitmap is copied over it at `blendLevel 90` (90/255);
 * 3. the texture's own alpha is put back (`extractAlpha`/`setAlpha`);
 * 4. sprite 111 (544×384 over the playfield, locZ 903: above layer 3) shows it at the map's
 *    blend level. A no-texture setting hides it.
 * The textures are 272×192 with their registration point at the centre, stretched ×2.
 */
import type { MapFog } from "@secondstaronline/shared";

import type { Assets } from "./assets.ts";

/** The fog texture names to their Internal members (cast-manifest: cloudy1 448, compass 450, …). */
export const FOG_MEMBERS: Readonly<Record<string, number>> = {
  cloudy1: 448,
  compass: 450,
  wicked: 451,
  whispy: 452,
  splotchy: 453,
  gazing: 454,
  cloudy3: 455,
  cloudy2: 456,
};

/** `copyPixels … [#blendLevel: 90]`. */
export const FOG_TINT = 90 / 255;

const cache = new Map<string, HTMLImageElement>();

function image(src: string): Promise<HTMLImageElement | null> {
  const hit = cache.get(src);
  if (hit?.complete) {
    return Promise.resolve(hit);
  }
  return new Promise((resolve) => {
    const img = hit ?? new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    if (!hit) {
      cache.set(src, img);
      img.src = src;
    }
  });
}

/** The tinted 272×192 texture, or null for `NoTex` (or an unknown name). */
export async function fogLayer(assets: Assets, fog: MapFog): Promise<HTMLCanvasElement | null> {
  const member = FOG_MEMBERS[fog.tex.toLowerCase()];
  if (member === undefined || fog.blend <= 0) {
    return null;
  }
  const img = await image(assets.ui("internal", member));
  if (!img || typeof document === "undefined") {
    return null;
  }
  const c = document.createElement("canvas");
  c.width = 272;
  c.height = 192;
  const ctx = c.getContext("2d");
  if (!ctx) {
    return null;
  }
  ctx.drawImage(img, 0, 0);
  // The colour goes only where the texture has pixels: its alpha is restored afterwards.
  ctx.globalCompositeOperation = "source-atop";
  ctx.globalAlpha = FOG_TINT;
  ctx.fillStyle = `rgb(${fog.r},${fog.g},${fog.b})`;
  ctx.fillRect(0, 0, 272, 192);
  return c;
}

/** Draws a fog layer stretched over a 544×384 area at the map's blend level. */
export function drawFog(
  ctx: CanvasRenderingContext2D,
  layer: HTMLCanvasElement | null,
  blend: number,
): void {
  if (!layer) {
    return;
  }
  ctx.save();
  ctx.globalAlpha = Math.min(255, blend) / 255;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(layer, 0, 0, 544, 384);
  ctx.restore();
}
