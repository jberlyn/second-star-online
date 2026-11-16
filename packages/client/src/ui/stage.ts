/**
 * Original-art placement. Every UI piece has its rect on the original
 * 800×600 stage (from the score, assets/original/main/layout/frame-N.json). A `Stage` lays the
 * pieces out at those rects inside an 800×600 box that the shell scales as a unit.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface StageItem extends Rect {
  el: HTMLElement;
  /** Score channel: higher draws on top. Omit to let positioned children use their own channels. */
  z?: number;
  /** Plain art can be repeated in several regions; controls cannot. */
  art?: boolean;
}

export const STAGE_W = 800;
export const STAGE_H = 600;
/**
 * Room a Director `#scroll` field needs beside it for its bar: Director drew the bar outside the
 * field, 3 px clear of it and 16 px wide (chat x 765-780 beside a field ending at 762; spellbook
 * x 775-790 beside one ending at 772, measured in Director). Boxes with `.director-scroll` are
 * this much wider than their field, so the browser's bar lands where Director's did.
 */
export const DIRECTOR_BAR_W = 19;

export function place(el: HTMLElement, r: Rect, z?: number): void {
  el.style.position = "absolute";
  el.style.left = `${r.x}px`;
  el.style.top = `${r.y}px`;
  el.style.width = `${r.w}px`;
  el.style.height = `${r.h}px`;
  if (z !== undefined) {
    el.style.zIndex = String(z);
  }
}

/** An <img> of a UI file (decoded `internal:<member>` art), drawn at its own size. */
export function artImg(src: string, alt = ""): HTMLImageElement {
  const img = document.createElement("img");
  img.src = src;
  img.alt = alt;
  img.draggable = false;
  img.className = "art";
  return img;
}

/** Builds an 800×600 stage with every item at its original rect. */
export function wholeStage(items: readonly StageItem[]): HTMLElement {
  const stage = document.createElement("div");
  stage.className = "stage";
  for (const it of items) {
    place(it.el, it, it.z);
    stage.append(it.el);
  }
  return stage;
}

/**
 * Scale for the whole 800×600 frame in a box  `extraH` is height
 * the frame needs beyond the stage, in stage pixels (the 20 px menu bar above it).
 */
export function fitScale(boxW: number, boxH: number, sharpPixels: boolean, extraH = 0): number {
  const s = Math.min(boxW / STAGE_W, boxH / (STAGE_H + extraH));
  if (sharpPixels && s >= 1) {
    return Math.floor(s);
  }
  return s;
}
