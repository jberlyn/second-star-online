/**
 * A deterministic shelf packer. Sprites are sorted by height,
 * then width, then name, and placed left to right in rows; a sheet is at most 2048×2048 and
 * a group that does not fit spills into further sheets. The same input always gives the
 * same layout.
 */

export const MAX_SHEET = 2048;
/** Transparent gap between sprites, so linear sampling never bleeds a neighbour in. */
export const PADDING = 1;

export interface PackItem {
  name: string;
  w: number;
  h: number;
}

export interface Placement {
  name: string;
  sheet: number;
  x: number;
  y: number;
}

export interface PackResult {
  placements: Placement[];
  /** Used size of each sheet. */
  sheets: { w: number; h: number }[];
}

export function pack(items: readonly PackItem[], max = MAX_SHEET): PackResult {
  const sorted = [...items].sort(
    (a, b) => b.h - a.h || b.w - a.w || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );
  const placements: Placement[] = [];
  const sheets: { w: number; h: number }[] = [];
  let sheet = 0;
  let x = 0;
  let y = 0;
  let rowH = 0;
  let used = { w: 0, h: 0 };
  for (const it of sorted) {
    if (it.w > max || it.h > max) {
      throw new Error(`${it.name} (${it.w}×${it.h}) exceeds ${max}²`);
    }
    if (x + it.w > max) {
      x = 0;
      y += rowH + PADDING;
      rowH = 0;
    }
    if (y + it.h > max) {
      sheets.push(used);
      sheet += 1;
      x = 0;
      y = 0;
      rowH = 0;
      used = { w: 0, h: 0 };
    }
    placements.push({ name: it.name, sheet, x, y });
    used = { w: Math.max(used.w, x + it.w), h: Math.max(used.h, y + it.h) };
    x += it.w + PADDING;
    rowH = Math.max(rowH, it.h);
  }
  if (sorted.length > 0) {
    sheets.push(used);
  }
  return { placements, sheets };
}
