/**
 * The right panel's tab art is opaque: each Internal member is a crop of the wooden panel with
 * its glyph baked in, and Internal #186 has all four small glyphs baked in too. Moving them to
 * one row would drag their rectangular wood patches along, so this build step:
 *
 * - erases the four small glyphs from Internal #186, filling each row by interpolating the
 *   clean wood to its left and right (the grain runs horizontally, so the fill blends in);
 * - cuts each tab bitmap out of its wood with a hand-drawn mask (`panel-tab-masks.ts`). The
 *   grain inside the tab crops does not match #186 closely enough to key it by colour: dark
 *   grain lines touching a glyph's outline came away with it;
 * - keeps the bitmap's own size and makes everything outside the mask transparent, so the
 *   client can clip each icon to its `TAB_ART` crop and centre it without seams.
 */

import { createRgba, type Rgba } from "../../src/art/png.ts";
import { TAB_ART } from "../../src/panel-tabs.ts";
import { TAB_MASKS } from "./panel-tab-masks.ts";

const PANEL_MEMBER = 186;
const PANEL_STAGE_X = 566;

const id = (member: number) => `internal:${member}`;
const at = (img: Rgba, x: number, y: number) => (y * img.width + x) * 4;

function copy(img: Rgba): Rgba {
  const out = createRgba(img.width, img.height);
  out.data.set(img.data);
  return out;
}

/** Averages `count` pixels to the left/right of `x`, staying inside the image. */
function side(
  img: Rgba,
  x: number,
  y: number,
  step: number,
  count: number,
): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < count; i++) {
    const px = at(img, x + step * i, y);
    r += img.data[px] as number;
    g += img.data[px + 1] as number;
    b += img.data[px + 2] as number;
  }
  return [r / count, g / count, b / count];
}

/**
 * Erases the four small tab glyphs from #186. For every row of a glyph's rectangle, the clean
 * wood just outside the rectangle is averaged on each side and blended across it.
 */
export function cleanPanel(panel: Rgba): Rgba {
  const out = copy(panel);
  for (const tab of TAB_ART) {
    const [stageX, stageY] = tab.original;
    const [w, h] = tab.source;
    const x0 = stageX - PANEL_STAGE_X;
    for (let y = stageY; y < stageY + h; y++) {
      const left = side(panel, x0 - 1, y, -1, 3);
      const right = side(panel, x0 + w, y, 1, 3);
      for (let x = x0; x < x0 + w; x++) {
        const t = (x - x0 + 1) / (w + 1);
        const px = at(out, x, y);
        for (let c = 0; c < 3; c++) {
          out.data[px + c] = Math.round((left[c] as number) * (1 - t) + (right[c] as number) * t);
        }
        out.data[px + 3] = 255;
      }
    }
  }
  return out;
}

/**
 * The wood below the page area of #186 was pasted together from strips, and two of the joins
 * are a pixel out: below the page hole (rows 279-439), columns 71 onwards sit 1 px lower than
 * column 70, and on rows 392-439 columns 60 onwards also sit 1 px higher than column 59. Each
 * grain line steps at x 70|71 (stage x 636|637) and, lower down, at 59|60.
 */
export const PANEL_SEAM = {
  /** The strip between the two joins. */
  x0: 60,
  x1: 70,
  /** Rows where the 70|71 join is a pixel out. */
  y0: 279,
  y1: 439,
  /** The first row where the 59|60 join is a pixel out too. */
  both: 392,
} as const;

/** Linear blend of column `x` sampled at fractional row `y` (clamped to the image). */
function sampleColumn(img: Rgba, x: number, y: number, c: number): number {
  const ya = Math.max(0, Math.min(img.height - 1, Math.floor(y)));
  const yb = Math.min(img.height - 1, ya + 1);
  const t = y - Math.floor(y);
  return (
    (img.data[at(img, x, ya) + c] as number) * (1 - t) +
    (img.data[at(img, x, yb) + c] as number) * t
  );
}

/**
 * Mends the strip seam in #186 (see `PANEL_SEAM`) by shifting the strip's columns down. Where
 * only the 70|71 join is out, the 1 px is spread across the strip, a twelfth more per column,
 * so no single column steps; where both joins are out, the whole strip moves down 1 px, which
 * closes both. The shift eases in and out over a few rows so no grain line breaks vertically.
 */
export function mendPanelSeam(panel: Rgba): Rgba {
  const out = copy(panel);
  const { x0, x1, y0, y1, both } = PANEL_SEAM;
  const ease = 8;
  for (let y = y0; y <= y1 + ease; y++) {
    // 0 → 1 as the rows enter the both-joins span, and 1 → 0 after the seam ends.
    const full = Math.max(0, Math.min(1, (y - (both - ease)) / ease));
    const fade = y <= y1 ? 1 : 1 - (y - y1) / (ease + 1);
    for (let x = x0; x <= x1; x++) {
      const ramp = (x - x0 + 1) / (x1 - x0 + 2);
      const d = (ramp + (1 - ramp) * full) * fade;
      const px = at(out, x, y);
      for (let c = 0; c < 3; c++) {
        // Row y0 is the hole's edge: nothing above it is wood.
        out.data[px + c] = Math.round(sampleColumn(panel, x, Math.max(y0, y - d), c));
      }
    }
  }
  return out;
}

/**
 * Keeps the pixels its hand-drawn mask marks inside `crop`; everything else becomes
 * transparent. The mask must cover the crop exactly.
 */
export function applyTabMask(
  src: Rgba,
  mask: readonly string[],
  crop: readonly [x: number, y: number, w: number, h: number],
): Rgba {
  const [cx, cy, cw, ch] = crop;
  if (mask.length !== ch || mask.some((row) => row.length !== cw || /[^#.]/.test(row))) {
    throw new Error(`tab mask does not match its ${cw}x${ch} crop`);
  }
  const out = createRgba(src.width, src.height);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      if (mask[y]?.[x] !== "#") {
        continue;
      }
      const sp = at(src, cx + x, cy + y);
      out.data[sp] = src.data[sp] as number;
      out.data[sp + 1] = src.data[sp + 1] as number;
      out.data[sp + 2] = src.data[sp + 2] as number;
      out.data[sp + 3] = 255;
    }
  }
  return out;
}

function masked(
  src: Rgba,
  member: number,
  crop: readonly [x: number, y: number, w: number, h: number],
): Rgba {
  const mask = TAB_MASKS[member];
  if (!mask) {
    throw new Error(`no tab mask for Internal #${member}`);
  }
  return applyTabMask(src, mask, crop);
}

/**
 * Transforms Internal #186 and the eight tab members, keyed by member. Missing members are
 * left alone so a subset build still works.
 */
export function derivePanelTabs(ui: ReadonlyMap<string, Rgba>): Map<number, Rgba> {
  const panel = ui.get(id(PANEL_MEMBER));
  const out = new Map<number, Rgba>();
  if (!panel) {
    return out;
  }
  const wood = mendPanelSeam(cleanPanel(panel));
  out.set(PANEL_MEMBER, wood);
  for (const tab of TAB_ART) {
    const small = ui.get(id(tab.member));
    if (small) {
      out.set(tab.member, masked(small, tab.member, tab.crop));
    }
    const selected = ui.get(id(tab.selected));
    if (selected) {
      out.set(tab.selected, masked(selected, tab.selected, tab.selectedCrop));
    }
  }
  return out;
}
