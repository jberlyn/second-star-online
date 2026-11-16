/**
 * The right panel's tab art is opaque: each Internal member is a crop of the wooden panel with
 * its glyph baked in, and Internal #186 has all four small glyphs baked in too. Moving them to
 * one row would drag their rectangular wood patches along, so this build step:
 *
 * - erases the four small glyphs from Internal #186, filling each row by interpolating the
 *   clean wood to its left and right (the grain runs horizontally, so the fill blends in);
 * - turns each tab bitmap into a matte: the glyph is the part that differs from the cleaned
 *   #186 wood at the same stage position, closed and filled to keep the solid silhouette;
 * - keeps the bitmap's own size and alpha-keys everything outside the glyph, so the client can
 *   clip each icon to its `TAB_ART` crop and centre it without seams.
 *
 * Deterministic: a fixed threshold, neighbour order and seed component.
 */
import { TAB_ART } from "../../src/panel-tabs.ts";
import { createRgba, type Rgba } from "./png.ts";

const PANEL_MEMBER = 186;
const PANEL_STAGE_X = 566;
/** Per-channel sum of |source − wood|; 30 keeps anti-aliased glyph edges. */
const MATTE_THRESHOLD = 30;

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

/** A reddish-brown panel-wood pixel, as opposed to the glyph's grey, green or black. */
function woodLike(src: Rgba, i: number): boolean {
  const r = src.data[i * 4] as number;
  const g = src.data[i * 4 + 1] as number;
  const b = src.data[i * 4 + 2] as number;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  // Nearly black is the glyph's outline unless it is a dark red wood shadow.
  if (max < 45) {
    return r > b + 8 && g >= b;
  }
  // The stats face is bright orange; the wood's red is darker.
  if (r > 150 && g > 60) {
    return false;
  }
  if (max - min <= 25 && max >= 70) {
    return false; // grey/white armour and eyes
  }
  if (g > r + 8 || b > r + 8) {
    return false; // green gems, blue armour trim
  }
  if (r > b + 40 && g > b + 40 && Math.abs(r - g) < 50) {
    return false; // yellow hat and glow
  }
  return r > g && g >= b && r - b > 20;
}

/**
 * Takes wood-coloured pixels off the silhouette's edge. The matte is grown from a colour
 * difference that includes a little of the grain; trimming only edge-connected wood leaves the
 * glyph's own dark outline and interior colours alone.
 */
function trimWood(mask: Uint8Array, src: Rgba): Uint8Array {
  const { width: w, height: h } = src;
  let current = mask;
  for (let pass = 0; pass < 3; pass++) {
    const next = current.slice();
    let changed = false;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!current[i]) {
          continue;
        }
        const edge =
          x === 0 ||
          y === 0 ||
          x === w - 1 ||
          y === h - 1 ||
          !current[i - 1] ||
          !current[i + 1] ||
          !current[i - w] ||
          !current[i + w];
        if (edge && woodLike(src, i)) {
          next[i] = 0;
          changed = true;
        }
      }
    }
    current = next;
    if (!changed) {
      break;
    }
  }
  return current;
}

function matteMask(src: Rgba, wood: Rgba, stageX: number, stageY: number): Uint8Array {
  const { width: w, height: h } = src;
  let mask: Uint8Array<ArrayBufferLike> = new Uint8Array(w * h);
  const lx = stageX - PANEL_STAGE_X;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sp = at(src, x, y);
      const wp = at(wood, lx + x, stageY + y);
      const diff =
        Math.abs((src.data[sp] as number) - (wood.data[wp] as number)) +
        Math.abs((src.data[sp + 1] as number) - (wood.data[wp + 1] as number)) +
        Math.abs((src.data[sp + 2] as number) - (wood.data[wp + 2] as number));
      mask[y * w + x] = diff > MATTE_THRESHOLD ? 1 : 0;
    }
  }
  // Close one-pixel gaps in outlines, then keep the glyph's own component: its centre is
  // inside every tab glyph, while the wood around it is not.
  const dilate = (m: Uint8Array): Uint8Array => {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!m[y * w + x]) {
          continue;
        }
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
              out[ny * w + nx] = 1;
            }
          }
        }
      }
    }
    return out;
  };
  const erode = (m: Uint8Array): Uint8Array => {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!m[y * w + x]) {
          continue;
        }
        let solid = true;
        for (let dy = -1; dy <= 1 && solid; dy++) {
          for (let dx = -1; dx <= 1 && solid; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            solid = nx >= 0 && nx < w && ny >= 0 && ny < h && m[ny * w + nx] === 1;
          }
        }
        out[y * w + x] = solid ? 1 : 0;
      }
    }
    return out;
  };
  mask = erode(dilate(mask));

  const component = (seed: number): number[] => {
    if (!mask[seed]) {
      return [];
    }
    const seen = new Uint8Array(w * h);
    const stack = [seed];
    seen[seed] = 1;
    const pixels: number[] = [];
    while (stack.length > 0) {
      const i = stack.pop() as number;
      pixels.push(i);
      const x = i % w;
      const y = (i - x) / w;
      const neighbours = [
        y > 0 ? i - w : -1,
        y + 1 < h ? i + w : -1,
        x > 0 ? i - 1 : -1,
        x + 1 < w ? i + 1 : -1,
      ];
      for (const n of neighbours) {
        if (n >= 0 && mask[n] && !seen[n]) {
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
    return pixels;
  };
  const centre = Math.floor(h / 2) * w + Math.floor(w / 2);
  const chosen = component(centre);
  const glyph = chosen.length > 0 ? chosen : component(mask.indexOf(1));
  const kept = new Uint8Array(w * h);
  for (const i of glyph) {
    kept[i] = 1;
  }
  // Fill holes: flood the outside through false pixels; what the flood cannot reach is inside.
  const outside = new Uint8Array(w * h);
  const stack: number[] = [];
  const visit = (i: number) => {
    if (!kept[i] && !outside[i]) {
      outside[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    visit(x);
    visit((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    visit(y * w);
    visit(y * w + w - 1);
  }
  while (stack.length > 0) {
    const i = stack.pop() as number;
    const x = i % w;
    const y = (i - x) / w;
    if (y > 0) {
      visit(i - w);
    }
    if (y + 1 < h) {
      visit(i + w);
    }
    if (x > 0) {
      visit(i - 1);
    }
    if (x + 1 < w) {
      visit(i + 1);
    }
  }
  for (let i = 0; i < kept.length; i++) {
    if (!kept[i] && !outside[i]) {
      kept[i] = 1;
    }
  }
  return trimWood(kept, src);
}

/** Keeps only the glyph pixels inside `crop`; everything else becomes transparent. */
function matte(
  src: Rgba,
  wood: Rgba,
  original: readonly [x: number, y: number],
  crop: readonly [x: number, y: number, w: number, h: number],
): Rgba {
  const mask = matteMask(src, wood, original[0], original[1]);
  const [cx, cy, cw, ch] = crop;
  const out = createRgba(src.width, src.height);
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      if (x < cx || x >= cx + cw || y < cy || y >= cy + ch) {
        continue;
      }
      if (!mask[y * src.width + x]) {
        continue;
      }
      const sp = at(src, x, y);
      const op = at(out, x, y);
      out.data[op] = src.data[sp] as number;
      out.data[op + 1] = src.data[sp + 1] as number;
      out.data[op + 2] = src.data[sp + 2] as number;
      out.data[op + 3] = 255;
    }
  }
  return out;
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
  const wood = cleanPanel(panel);
  out.set(PANEL_MEMBER, wood);
  for (const tab of TAB_ART) {
    const small = ui.get(id(tab.member));
    if (small) {
      out.set(tab.member, matte(small, wood, tab.original, tab.crop));
    }
    const selected = ui.get(id(tab.selected));
    if (selected) {
      out.set(tab.selected, matte(selected, wood, tab.selectedOriginal, tab.selectedCrop));
    }
  }
  return out;
}
