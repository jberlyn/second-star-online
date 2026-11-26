/**
 * Draws the spell effects, cast sounds and book icons for the seven spells that had no art in 1.6
 * (Bless, Weaken, Haste, Poison Dart, Replenish, Holy Weapon, Identify), and writes them with
 * their sidecars as added assets:
 *
 *   bun tools/spell-art.ts [--preview <dir>]
 *
 * - `assets/added/fx/<Spell>-<n>.png`: each spell's FX run (Poison Dart flies, as
 *   `Poison Dart<L|R|U|D>-<1..3>`);
 * - `assets/added/sounds/<spell>.wav`: each spell's cast sound, 16-bit mono at 22050 Hz;
 * - `assets/added/items/<Haste|Poison Dart> Book.png`: the standard 1.6 spell book picture.
 *
 * Everything is drawn procedurally from fixed seeds, so a run always writes the same bytes. The
 * look follows the 1.6 effects: chunky shapes on a green key, a 1px outline in a dark shade of
 * each colour, a white core and "+" sparkles. `--preview` also writes a 4x contact sheet per spell
 * there. Run `bun run assets:build` and `bun run data:build` afterwards.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { createRgba, decodePng, encodePng, type Rgba } from "../packages/data/src/art/png.ts";

const ROOT = resolve(import.meta.dir, "..");
const FX = join(ROOT, "assets", "added", "fx");
const SOUNDS = join(ROOT, "assets", "added", "sounds");
const ITEMS = join(ROOT, "assets", "added", "items");
const previewAt = process.argv.indexOf("--preview");
const PREVIEW = previewAt > 0 ? process.argv[previewAt + 1] : null;
if (previewAt > 0 && !PREVIEW) {
  throw new Error("usage: bun tools/spell-art.ts [--preview <dir>]");
}

// ---------------------------------------------------------------------------------------------
// Drawing

type Rgb = readonly [number, number, number];
/** A colour ramp: outline, dark, mid, bright, pale, white. */
type Ramp = readonly [Rgb, Rgb, Rgb, Rgb, Rgb, Rgb];

const RAMPS = {
  aqua: [[0, 60, 72], [0, 120, 140], [20, 180, 200], [90, 225, 235], [180, 250, 250], [255, 255, 255]],
  gold: [[110, 70, 0], [190, 130, 10], [240, 185, 30], [255, 220, 90], [255, 244, 180], [255, 255, 255]],
  yellow: [[120, 86, 0], [205, 160, 0], [250, 210, 20], [255, 238, 90], [255, 252, 200], [255, 255, 255]],
  holy: [[120, 85, 10], [190, 140, 30], [235, 195, 70], [255, 230, 130], [255, 248, 205], [255, 255, 255]],
  murk: [[8, 0, 12], [26, 6, 38], [48, 16, 70], [72, 30, 100], [110, 60, 140], [150, 100, 180]],
  violet: [[30, 0, 50], [80, 20, 120], [140, 50, 200], [190, 110, 245], [225, 180, 255], [248, 235, 255]],
  bone: [[40, 20, 50], [90, 60, 110], [150, 120, 170], [200, 180, 215], [232, 222, 240], [255, 255, 255]],
  blue: [[0, 22, 80], [20, 64, 170], [60, 124, 240], [130, 190, 255], [205, 235, 255], [255, 255, 255]],
  venom: [[10, 50, 12], [30, 110, 24], [70, 180, 34], [140, 228, 62], [204, 248, 150], [240, 255, 230]],
  steel: [[16, 16, 22], [52, 48, 56], [96, 90, 96], [150, 144, 140], [200, 196, 190], [240, 240, 236]],
} satisfies Record<string, readonly Rgb[]>;
type RampName = keyof typeof RAMPS;
const RAMP_NAMES = Object.keys(RAMPS) as RampName[];

/** The green key colour; no ramp may use it. */
const KEY: Rgb = [0, 255, 0];
for (const ramp of Object.values(RAMPS)) {
  for (const c of ramp) {
    if (c[0] === KEY[0] && c[1] === KEY[1] && c[2] === KEY[2]) {
      throw new Error("a ramp uses the green key colour");
    }
  }
}

/** Levels: 1 dark … 5 white. Level 0 is the outline, added by `finish`. -1 is empty. */
class Canvas {
  readonly level: Int8Array;
  readonly ramp: Uint8Array;
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.level = new Int8Array(w * h).fill(-1);
    this.ramp = new Uint8Array(w * h);
  }

  /** Plots a pixel, keeping whichever of it and what is there is brighter (or replacing, `force`). */
  put(x: number, y: number, level: number, ramp: RampName, force = false): void {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || py < 0 || px >= this.w || py >= this.h || level < 1) {
      return;
    }
    const i = py * this.w + px;
    const lv = Math.min(5, Math.round(level));
    if (force || lv > (this.level[i] ?? -1)) {
      this.level[i] = lv;
      this.ramp[i] = RAMP_NAMES.indexOf(ramp);
    }
  }

  get(x: number, y: number): number {
    return x < 0 || y < 0 || x >= this.w || y >= this.h ? -1 : (this.level[y * this.w + x] ?? -1);
  }

  disc(cx: number, cy: number, r: number, level: number, ramp: RampName, force = false): void {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r + 0.3) {
          this.put(x, y, level, ramp, force);
        }
      }
    }
  }

  /** A lit ball: mid rim, bright body, pale core and a white glint up and to the left. */
  orb(cx: number, cy: number, r: number, ramp: RampName): void {
    this.disc(cx, cy, r, 2, ramp);
    if (r >= 1.5) {
      this.disc(cx, cy, r - 1, 3, ramp);
    }
    if (r >= 2.5) {
      this.disc(cx - 0.5, cy - 0.5, r - 2, 4, ramp);
    }
    this.put(cx - Math.floor(r / 2), cy - Math.floor(r / 2), 5, ramp);
  }

  line(x0: number, y0: number, x1: number, y1: number, level: number, ramp: RampName, force = false): void {
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
    for (let k = 0; k <= n; k++) {
      this.put(x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n, level, ramp, force);
    }
  }

  /** An ellipse outline; `front` levels the lower (nearer) half and `back` the upper half. */
  ellipse(cx: number, cy: number, rx: number, ry: number, front: number, back: number, ramp: RampName, force = false): void {
    const steps = Math.max(24, Math.ceil(8 * (rx + ry)));
    for (let k = 0; k < steps; k++) {
      const a = (k / steps) * Math.PI * 2;
      const s = Math.sin(a);
      this.put(cx + rx * Math.cos(a), cy + ry * s, s >= 0 ? front : back, ramp, force && s >= 0);
    }
  }

  /** A "+" star: a white centre and arms that dim towards their ends. */
  sparkle(cx: number, cy: number, arm: number, ramp: RampName, top = 5, force = false): void {
    this.put(cx, cy, top, ramp, true);
    for (let k = 1; k <= arm; k++) {
      const lv = Math.max(top - k, top - 2);
      this.put(cx + k, cy, lv, ramp, force);
      this.put(cx - k, cy, lv, ramp, force);
      this.put(cx, cy + k, lv, ramp, force);
      this.put(cx, cy - k, lv, ramp, force);
    }
  }

  /** Adds the 1px outline around every shape and returns the image on the green key. */
  finish(): Rgba {
    const { w, h } = this;
    const out = createRgba(w, h);
    const outline = new Int16Array(w * h).fill(-1);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (this.get(x, y) >= 0) {
          continue;
        }
        let best = -1;
        let bestRamp = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const lv = this.get(x + dx, y + dy);
          if (lv > best) {
            best = lv;
            bestRamp = this.ramp[(y + dy) * w + x + dx] ?? 0;
          }
        }
        if (best >= 1) {
          outline[y * w + x] = bestRamp;
        }
      }
    }
    for (let i = 0; i < w * h; i++) {
      const lv = this.level[i] ?? -1;
      let c: Rgb = KEY;
      if (lv >= 0) {
        c = RAMPS[RAMP_NAMES[this.ramp[i] ?? 0] as RampName][lv] as Rgb;
      } else if ((outline[i] ?? -1) >= 0) {
        c = RAMPS[RAMP_NAMES[outline[i] ?? 0] as RampName][0] as Rgb;
      }
      out.data.set([c[0], c[1], c[2], 255], i * 4);
    }
    return out;
  }
}

/** A seeded generator (mulberry32), so every run draws the same frames. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

// ---------------------------------------------------------------------------------------------
// The FX runs

interface Run {
  member: string;
  spell: string;
  frames: Rgba[];
  /** Note suffix, e.g. "flying west, frame". */
  what?: string;
}

/** Replenish: aqua rings and aqua-and-gold bubbles of light swirling up, with gold sparkles. */
function replenish(): Run {
  const W = 32;
  const H = 36;
  const N = 9;
  const bubbles = Array.from({ length: 10 }, (_, k) => ({
    start: k * 0.5 - 0.8,
    phase: k * 2.4,
    r: k % 3 === 0 ? 2.5 : 2,
    ramp: (k % 2 === 0 ? "aqua" : "gold") as RampName,
  }));
  const frames: Rgba[] = [];
  for (let f = 0; f < N; f++) {
    const c = new Canvas(W, H);
    // Rings rising from the feet, wide in the middle of their climb.
    for (let i = 0; i < 3; i++) {
      const p = (f - 1.6 * i) / 4.5;
      if (p < 0 || p > 1) {
        continue;
      }
      const rx = 7 + 6 * Math.sin(Math.PI * p);
      c.ellipse(16, 31 - p * 24, rx, rx * 0.3, p > 0.8 ? 3 : 4, 2, "aqua");
    }
    // Bubbles spiralling up around the body.
    for (const b of bubbles) {
      const q = (f - b.start) / 4.5;
      if (q < 0 || q > 1) {
        continue;
      }
      const a = b.phase + q * Math.PI * 1.6;
      const x = 16 + 10 * Math.sin(a) * (1 - 0.35 * q);
      const y = 32 - q * 28;
      c.orb(x, y, q > 0.8 ? 1.5 : b.r, b.ramp);
    }
    // Gold sparkles, most in the middle of the cast.
    const r = rng(100 + f);
    const n = [1, 2, 3, 4, 4, 3, 3, 2, 1][f] ?? 0;
    for (let k = 0; k < n; k++) {
      c.sparkle(4 + Math.floor(r() * 24), 4 + Math.floor(r() * 26), r() < 0.4 ? 2 : 1, "gold");
    }
    frames.push(c.finish());
  }
  return { member: "Replenish", spell: "Replenish", frames };
}

/**
 * Haste: two yellow-white wind ribbons spiralling up round a glowing column, bright comet heads
 * racing up them. Full height by frame 3 (when the spell takes hold), gone from the feet up by 9.
 */
function haste(): Run {
  const W = 32;
  const H = 44;
  const N = 9;
  const cx = 16;
  const top = 2;
  const bottom = 41;
  const reach = [0.4, 0.75, 1, 1, 1, 1, 1, 1, 1]; // how high the ribbons have climbed
  const gone = [0, 0, 0, 0, 0, 0, 0.2, 0.5, 0.8]; // how much has faded from the bottom
  const frames: Rgba[] = [];
  for (let f = 0; f < N; f++) {
    const c = new Canvas(W, H);
    const hi = reach[f] ?? 1;
    const lo = gone[f] ?? 0;
    const yAt = (u: number) => bottom - u * (bottom - top);
    // The column the ribbons wind round: a soft glow of dashes rushing upward.
    for (let y = Math.ceil(yAt(hi)); y <= Math.floor(yAt(lo)); y++) {
      const run = (((y + f * 5) % 8) + 8) % 8; // 0..7: a 6-pixel dash, then a 2-pixel gap
      if (run >= 6) {
        c.put(cx, y, 1, "yellow");
        continue;
      }
      const lv = (run === 0 ? 4 : run < 3 ? 3 : 2) - (f >= 7 ? 1 : 0);
      c.put(cx, y, lv, "yellow");
      if (run < 4) {
        c.put(cx - 1, y, lv - 1, "yellow");
        c.put(cx + 1, y, lv - 1, "yellow");
      }
    }
    // Two ribbons, half a turn apart, turning as they climb.
    for (let k = 0; k < 2; k++) {
      for (let u = lo; u <= hi; u += 0.0025) {
        const a = u * Math.PI * 2 * 1.1 + k * Math.PI + f * 1.3;
        const rx = 4 + 8 * u;
        const x = cx + rx * Math.sin(a);
        const y = yAt(u);
        const front = Math.cos(a) >= 0;
        // Comet heads: brightness ramps up to a head that runs up the ribbon frame by frame.
        const phase = (((u - f * 0.22 - k * 0.5) % 0.5) + 0.5) % 0.5; // 0..0.5, head at 0.5
        const glow = phase / 0.5;
        let lv = 1 + Math.round(glow * glow * 4);
        if (f >= 7) {
          lv -= f - 6;
        }
        if (front) {
          c.put(x, y, lv, "yellow", true);
          if (glow > 0.4) {
            c.put(x, y + 1, lv - 1, "yellow", true);
          }
          if (glow > 0.8) {
            c.put(x + 1, y, lv, "yellow", true);
          }
        } else {
          c.put(x, y, lv - 1, "yellow");
        }
      }
    }
    // Small sparkles thrown off the swirl, and a pair of speed ticks at the sides.
    const r = rng(260 + f);
    const sparks = [1, 2, 3, 3, 3, 3, 2, 1, 1][f] ?? 0;
    for (let k = 0; k < sparks; k++) {
      const u = lo + r() * (hi - lo);
      const side = r() < 0.5 ? -1 : 1;
      c.sparkle(cx + side * (6 + Math.floor(u * 8) + Math.floor(r() * 3)), yAt(u), f >= 2 && f <= 5 && k === 0 ? 2 : 1, "yellow", f >= 7 ? 4 : 5);
    }
    if (f >= 1 && f <= 6) {
      for (const side of [-1, 1]) {
        const y = yAt(lo + ((f * 0.3 + (side > 0 ? 0.5 : 0)) % 1) * (hi - lo));
        c.line(cx + side * 14, y, cx + side * 14, y + 4, 3, "yellow");
        c.put(cx + side * 14, y, 5, "yellow");
      }
    }
    frames.push(c.finish());
  }
  return { member: "Haste", spell: "Haste", frames };
}

/** Bless: a pale-gold beam from above, a halo over the head, a glow at the feet, white sparkles. */
function bless(): Run {
  const W = 34;
  const H = 50;
  const N = 10;
  const cx = 17;
  const reach = [12, 28, 44, 47, 47, 47, 47, 47, 47, 47];
  const width = [3, 5, 6, 7, 7, 6, 7, 5, 4, 2];
  const motes = Array.from({ length: 10 }, (_, k) => {
    const r = rng(300 + k);
    return { x: cx - 9 + Math.floor(r() * 19), y0: Math.floor(r() * 20) - 14, start: Math.floor(r() * 6) };
  });
  const frames: Rgba[] = [];
  for (let f = 0; f < N; f++) {
    const c = new Canvas(W, H);
    const bottom = reach[f] ?? 47;
    const half = (width[f] ?? 2) / 2;
    // The beam: white down its middle, gold at its edges, softening at its foot.
    for (let y = 0; y <= bottom; y++) {
      const fade = clamp01((bottom - y) / 4);
      const hw = half * (0.6 + 0.4 * fade) + (y < 8 ? (8 - y) * 0.15 : 0);
      for (let x = Math.floor(cx - hw); x <= Math.ceil(cx + hw); x++) {
        const d = Math.abs(x - cx) / Math.max(0.5, hw);
        if (d > 1) {
          continue;
        }
        const lv = d < 0.3 ? 5 : d < 0.65 ? 4 : 3;
        c.put(x, y, f >= 8 ? lv - 1 : lv - (fade < 0.5 ? 1 : 0), "holy");
      }
    }
    // Light pooling at the feet.
    if (f >= 2 && f <= 8) {
      const g = [0, 0, 5, 8, 10, 11, 11, 9, 6][f] ?? 0;
      c.ellipse(cx, 46, g, Math.max(1, g * 0.25), 3, 2, "holy");
      if (g > 6) {
        c.ellipse(cx, 46, g - 4, Math.max(1, (g - 4) * 0.25), 4, 3, "holy");
      }
    }
    // The halo, drawn over the beam at the front.
    if (f >= 2 && f <= 8) {
      const hr = [0, 0, 6, 9, 10, 10, 10, 9, 7][f] ?? 0;
      c.ellipse(cx, 9 + Math.sin(f) * 0.6, hr, Math.max(1.2, hr * 0.32), 4, 3, "gold", true);
      if (f >= 3 && f <= 7) {
        c.put(cx - hr, 9, 5, "gold", true);
      }
    }
    // Sparkles drifting down through the light.
    for (const m of motes) {
      if (f < m.start) {
        continue;
      }
      const y = m.y0 + (f - m.start) * 6 + 10;
      if (y > 46) {
        continue;
      }
      const big = (f + m.x) % 4 === 0;
      c.sparkle(m.x, y, big ? 2 : 1, "holy", f >= 8 ? 4 : 5);
    }
    frames.push(c.finish());
  }
  return { member: "Bless", spell: "Bless", frames };
}

/** Holy Weapon: an upright white-gold blade of light, its crossguard a cross, rays pulsing out. */
function holyWeapon(): Run {
  const W = 34;
  const H = 50;
  const N = 10;
  const cx = 17;
  const cy = 25;
  const scale = [0.35, 0.65, 0.9, 1, 1, 1, 1, 0.95, 0.75, 0.5];
  const frames: Rgba[] = [];
  for (let f = 0; f < N; f++) {
    const c = new Canvas(W, H);
    const s = scale[f] ?? 1;
    const dim = f >= 8 ? 1 : 0;
    const guard = cy + 7 * s;
    // Rays: long on the diagonals, short between, sliding outward frame by frame.
    if (f >= 2 && f <= 8) {
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4 + Math.PI / 8;
        const long = k % 2 === 0;
        const r0 = 6 + ((f * 3 + (long ? 0 : 2)) % 7);
        const len = long ? 6 : 3;
        const lv = (long ? 3 : 2) + ((f + k) % 2) - dim;
        c.line(cx + r0 * Math.cos(a), cy - 2 + r0 * Math.sin(a), cx + (r0 + len) * Math.cos(a), cy - 2 + (r0 + len) * Math.sin(a), lv, "holy");
      }
    }
    // The blade, point up.
    const tip = cy - 21 * s;
    for (let y = Math.floor(tip); y <= guard; y++) {
      const fromTip = y - tip;
      const hw = Math.min(2 * s + 0.3, fromTip * 0.45);
      for (let x = Math.floor(cx - hw); x <= Math.ceil(cx + hw); x++) {
        const d = Math.abs(x - cx);
        c.put(x, y, (d < 0.5 ? 5 : d <= 1 ? 4 : 3) - dim, "holy");
      }
    }
    // The crossguard.
    const gw = 8 * s;
    for (let x = Math.floor(cx - gw); x <= Math.ceil(cx + gw); x++) {
      const d = Math.abs(x - cx) / Math.max(1, gw);
      c.put(x, guard, (d < 0.5 ? 5 : 4) - dim, "holy");
      c.put(x, guard + 1, 3 - dim, "holy");
      if (s >= 0.9) {
        c.put(x, guard - 1, 3 - dim, "holy");
      }
    }
    c.orb(cx - gw, guard, s >= 0.9 ? 1.5 : 1, "gold");
    c.orb(cx + gw, guard, s >= 0.9 ? 1.5 : 1, "gold");
    // The grip and pommel.
    const end = guard + 9 * s;
    c.line(cx, guard + 2, cx, end, 3 - dim, "gold");
    if (s >= 0.6) {
      c.line(cx - 1, guard + 2, cx - 1, end - 1, 2, "gold");
      c.line(cx + 1, guard + 2, cx + 1, end - 1, 2, "gold");
    }
    c.orb(cx, end + 1, s >= 0.9 ? 2 : 1, "gold");
    // A glint running up the blade, then a flash at the point.
    if (f >= 3 && f <= 6) {
      c.sparkle(cx, guard - 4 - (f - 3) * 5, f === 5 ? 3 : 2, "holy");
    }
    if (f === 7) {
      c.sparkle(cx, tip + 1, 3, "holy");
    }
    if (f === 4 || f === 6) {
      c.sparkle(cx - 10, cy - 12 + f, 1, "gold");
      c.sparkle(cx + 10, cy - 6 - f, 1, "gold");
    }
    frames.push(c.finish());
  }
  return { member: "Holy Weapon", spell: "Holy Weapon", frames };
}

const SKULL = [
  ".#####.",
  "#######",
  "#oo#oo#",
  "#oo#oo#",
  "###o###",
  ".#####.",
  ".#.#.#.",
];

/** Weaken: a dark miasma with violet wisps winding inward and down, and a drooping skull. */
function weaken(): Run {
  const W = 40;
  const H = 40;
  const N = 9;
  const cx = 20;
  const cy = 20;
  const blobs = Array.from({ length: 9 }, (_, k) => {
    const r = rng(400 + k);
    const a = (k / 9) * Math.PI * 2 + r();
    const d = 4 + r() * 7;
    return { x: cx + Math.cos(a) * d * 1.2, y: cy + 2 + Math.sin(a) * d * 0.8, r: 3 + r() * 3, wob: r() * 6 };
  });
  const frames: Rgba[] = [];
  for (let f = 0; f < N; f++) {
    const c = new Canvas(W, H);
    const grow = [0.35, 0.6, 0.85, 1, 1, 1, 0.95, 0.8, 0.6][f] ?? 1;
    const dark = f >= 6 ? 1 : 0;
    // The miasma, slumping as it plays.
    for (const b of blobs) {
      const r = b.r * grow + Math.sin(f * 1.3 + b.wob) * 0.7;
      const x = cx + (b.x - cx) * grow;
      const y = cy + (b.y - cy) * grow + f * 0.5;
      c.disc(x, y, r, 1, "murk");
      if (r > 3) {
        c.disc(x - 1, y - 1, r - 2.5, 2 - dark, "murk");
      }
    }
    const tex = rng(450 + f);
    for (let k = 0; k < 18 * grow; k++) {
      const x = cx - 12 + Math.floor(tex() * 24);
      const y = cy - 8 + Math.floor(tex() * 20);
      if (c.get(x, y) >= 1) {
        c.put(x, y, 3 - dark, "murk", true);
      }
    }
    // Wisps winding in towards the middle and sinking.
    for (let k = 0; k < 4; k++) {
      const head = clamp01(f * 0.16 + k * 0.06);
      const tail = Math.max(0, head - 0.45);
      if (f >= 8) {
        continue;
      }
      for (let u = tail; u <= head; u += 0.01) {
        const rad = 18 * (1 - u) + 2;
        const a = (k * Math.PI) / 2 + u * Math.PI * 1.4 + 0.4;
        const x = cx + rad * Math.cos(a);
        const y = cy + rad * Math.sin(a) * 0.85 + u * 4 + f * 0.4;
        const along = (u - tail) / Math.max(0.01, head - tail);
        c.put(x, y, Math.max(1, 2 + Math.round(along * 2) - dark), "violet", true);
      }
      // A drop falling from the wisp's head.
      if (f >= 2) {
        const a = (k * Math.PI) / 2 + head * Math.PI * 1.4 + 0.4;
        const rad = 18 * (1 - head) + 2;
        c.put(cx + rad * Math.cos(a), cy + rad * Math.sin(a) * 0.85 + head * 4 + f * 0.4 + 3, 3 - dark, "violet");
      }
    }
    // The skull rises out of the murk, then droops and darkens.
    if (f >= 2 && f <= 7) {
      const top = cy - 6 + Math.max(0, f - 4) * 1.5 + (f === 2 ? 2 : 0);
      const lv = [0, 0, 2, 3, 4, 4, 3, 2][f] ?? 2;
      for (let y = 0; y < SKULL.length; y++) {
        const row = SKULL[y] ?? "";
        for (let x = 0; x < row.length; x++) {
          const ch = row[x];
          if (ch === "#") {
            c.put(cx - 3 + x, top + y, lv - (y >= 5 ? 1 : 0), "bone", true);
          } else if (ch === "o") {
            c.put(cx - 3 + x, top + y, 1, "murk", true);
          }
        }
      }
      if (f === 4) {
        c.put(cx - 2, top + 2, 4, "violet", true);
        c.put(cx + 2, top + 2, 4, "violet", true);
      }
    }
    frames.push(c.finish());
  }
  return { member: "Weaken", spell: "Weaken", frames };
}

/** Identify: a blue-white eye in a rune ring that opens, glints and closes. */
function identify(): Run {
  const W = 30;
  const H = 30;
  const N = 8;
  const cx = 15;
  const cy = 15;
  const open = [0.12, 0.45, 0.85, 1, 1, 1, 0.55, 0.15];
  const ring = [5, 9, 12, 12, 12, 12, 11, 7];
  const frames: Rgba[] = [];
  for (let f = 0; f < N; f++) {
    const c = new Canvas(W, H);
    const o = open[f] ?? 0;
    const rx = 10;
    const hgt = 6.5 * o;
    // The rune ring: dashes round a circle, turning.
    const rr = ring[f] ?? 0;
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4 + f * 0.25;
      const a2 = a + 0.35;
      c.line(cx + rr * Math.cos(a), cy + rr * Math.sin(a), cx + rr * Math.cos(a2), cy + rr * Math.sin(a2), f >= 6 ? 2 : 3, "blue");
    }
    // The eye: pale white inside, blue lids.
    for (let x = -rx; x <= rx; x++) {
      const t = 1 - (x / rx) ** 2;
      const up = cy - hgt * t;
      const lo = cy + hgt * t * 0.85;
      for (let y = Math.floor(up); y <= Math.ceil(lo); y++) {
        c.put(cx + x, y, 4, "blue");
      }
      c.put(cx + x, up, 2, "blue", true);
      c.put(cx + x, lo, 2, "blue", true);
      if (Math.abs(x) < rx - 2 && o > 0.5) {
        c.put(cx + x, up - 1, 1, "blue", true);
      }
    }
    // Iris and pupil, clipped by the lids.
    const ir = Math.min(4, hgt * 0.85);
    if (ir >= 1) {
      for (let y = Math.floor(cy - ir); y <= Math.ceil(cy + ir); y++) {
        for (let x = Math.floor(cx - ir); x <= Math.ceil(cx + ir); x++) {
          const d2 = (x - cx) ** 2 + (y - cy) ** 2;
          const t = 1 - ((x - cx) / rx) ** 2;
          const inside = y > cy - hgt * t && y < cy + hgt * t * 0.85;
          if (d2 <= ir * ir + 0.3 && inside) {
            c.put(x, y, d2 <= 2.3 ? 1 : d2 <= (ir - 1) ** 2 + 0.3 ? 3 : 2, "blue", true);
          }
        }
      }
      c.put(cx - 1, cy - 1, 5, "blue", true);
    }
    // The glint.
    if (f === 3 || f === 4) {
      c.sparkle(cx + 6, cy - 6, f === 4 ? 3 : 2, "blue", 5, true);
      c.put(cx + 2, cy - 2, 5, "blue", true);
    }
    if (f === 5) {
      c.sparkle(cx + 9, cy - 9, 2, "blue");
      c.sparkle(cx - 10, cy + 8, 1, "blue");
    }
    frames.push(c.finish());
  }
  return { member: "Identify", spell: "Identify", frames };
}

/** Poison Dart, flying west: a dark dart, a green tip dripping venom, a wiggling trail of drops. */
function poisonDartLeft(): Rgba[] {
  const W = 22;
  const H = 9;
  const frames: Rgba[] = [];
  for (let f = 0; f < 3; f++) {
    const c = new Canvas(W, H);
    // Trail of drops behind the dart, wiggling up and down from frame to frame.
    const trail = [
      [7, 6, 3],
      [11, 2, 3],
      [14, 6, 2],
      [18, 2, 2],
    ] as const;
    trail.forEach(([x, y, lv], k) => {
      const wy = y + Math.round(Math.sin(((f + k) * Math.PI * 2) / 3));
      c.put(x, wy, lv + 1, "venom");
      c.put(x, wy + 1, lv, "venom");
    });
    // Shaft.
    c.line(5, 4, 17, 4, 3, "steel", true);
    c.put(6, 4, 4, "steel", true);
    // Fletching.
    c.line(16, 3, 18, 2, 2, "steel", true);
    c.line(16, 5, 18, 6, 2, "steel", true);
    c.line(17, 4, 19, 4, 2, "steel", true);
    // The tip, point to the left.
    c.put(1, 4, 4, "venom", true);
    c.line(2, 3, 2, 5, 3, "venom", true);
    c.line(3, 3, 3, 5, 3, "venom", true);
    c.put(4, 4, 2, "venom", true);
    c.put(2, 4, 5, "venom", true);
    // A drop of venom hanging from the tip, falling and re-forming.
    const drip = [
      [3, 6],
      [4, 7],
      [3, 7],
    ][f] ?? [3, 6];
    c.put(drip[0] ?? 3, drip[1] ?? 6, 3, "venom");
    if (f === 1) {
      c.put(3, 6, 2, "venom");
    }
    frames.push(c.finish());
  }
  return frames;
}

function flipX(img: Rgba): Rgba {
  const out = createRgba(img.width, img.height);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const s = (y * img.width + x) * 4;
      out.data.set(img.data.subarray(s, s + 4), (y * img.width + (img.width - 1 - x)) * 4);
    }
  }
  return out;
}

function flipY(img: Rgba): Rgba {
  const out = createRgba(img.width, img.height);
  for (let y = 0; y < img.height; y++) {
    const s = y * img.width * 4;
    out.data.set(img.data.subarray(s, s + img.width * 4), (img.height - 1 - y) * img.width * 4);
  }
  return out;
}

/** Turns an image a quarter turn clockwise, so a left-pointing dart points up. */
function rotateCw(img: Rgba): Rgba {
  const out = createRgba(img.height, img.width);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const s = (y * img.width + x) * 4;
      out.data.set(img.data.subarray(s, s + 4), (x * out.width + (img.height - 1 - y)) * 4);
    }
  }
  return out;
}

function poisonDart(): Run[] {
  const left = poisonDartLeft();
  const up = left.map(rotateCw);
  return [
    { member: "Poison DartL", spell: "Poison Dart", what: "flying west, frame", frames: left },
    { member: "Poison DartR", spell: "Poison Dart", what: "flying east, frame", frames: left.map(flipX) },
    { member: "Poison DartU", spell: "Poison Dart", what: "flying north, frame", frames: up },
    { member: "Poison DartD", spell: "Poison Dart", what: "flying south, frame", frames: up.map(flipY) },
  ];
}

// ---------------------------------------------------------------------------------------------
// Sounds

const RATE = 22050;

/** Normalises to a -6 dBFS peak, fades the ends and writes a 16-bit mono WAV. */
function wav(samples: Float32Array): Uint8Array {
  const n = samples.length;
  const fadeIn = Math.floor(RATE * 0.004);
  const fadeOut = Math.floor(RATE * 0.03);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    let v = samples[i] ?? 0;
    if (i < fadeIn) {
      v *= i / fadeIn;
    }
    if (i >= n - fadeOut) {
      v *= (n - 1 - i) / fadeOut;
    }
    samples[i] = v;
    peak = Math.max(peak, Math.abs(v));
  }
  const gain = peak > 0 ? 0.5 / peak : 0;
  const bytes = new Uint8Array(44 + n * 2);
  const view = new DataView(bytes.buffer);
  const text = (at: number, s: string) => {
    for (let k = 0; k < s.length; k++) {
      bytes[at + k] = s.charCodeAt(k);
    }
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + n * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, RATE, true);
  view.setUint32(28, RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, (samples[i] ?? 0) * gain)) * 32767), true);
  }
  return bytes;
}

function buffer(seconds: number): Float32Array {
  return new Float32Array(Math.floor(RATE * seconds));
}

/** Adds a bell-like note: a sine with a soft octave and an inharmonic partial, decaying. */
function bell(out: Float32Array, at: number, freq: number, amp: number, decay: number, len: number): void {
  const start = Math.floor(at * RATE);
  const n = Math.min(out.length - start, Math.floor(len * RATE));
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const env = Math.min(1, t / 0.004) * Math.exp(-t / decay);
    const v =
      Math.sin(2 * Math.PI * freq * t) +
      0.35 * Math.sin(2 * Math.PI * freq * 2 * t) * Math.exp(-t / (decay * 0.5)) +
      0.15 * Math.sin(2 * Math.PI * freq * 2.76 * t) * Math.exp(-t / (decay * 0.3));
    out[start + i] = (out[start + i] ?? 0) + v * env * amp;
  }
}

/** A state-variable band-pass, its centre following `centre(t)`. */
function bandpass(input: Float32Array, centre: (t: number) => number, q: number): Float32Array {
  const out = new Float32Array(input.length);
  let low = 0;
  let band = 0;
  for (let i = 0; i < input.length; i++) {
    const f = 2 * Math.sin((Math.PI * Math.min(centre(i / RATE), RATE / 6)) / RATE);
    low += f * band;
    const high = (input[i] ?? 0) - low - q * band;
    band += f * high;
    out[i] = band;
  }
  return out;
}

function noise(seconds: number, seed: number): Float32Array {
  const r = rng(seed);
  const out = buffer(seconds);
  for (let i = 0; i < out.length; i++) {
    out[i] = r() * 2 - 1;
  }
  return out;
}

const SOUND_MAKERS: Record<string, { note: string; make: () => Float32Array }> = {
  replenish: {
    note: "Warm rising arpeggio chime, made for Replenish",
    make() {
      const out = buffer(0.85);
      [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, k) => bell(out, k * 0.075, f, k === 4 ? 0.5 : 0.7, 0.22, 0.85));
      // A soft warm pad underneath.
      for (let i = 0; i < out.length; i++) {
        const t = i / RATE;
        const env = Math.min(1, t / 0.15) * Math.exp(-t / 0.35);
        out[i] = (out[i] ?? 0) + env * 0.25 * (Math.sin(2 * Math.PI * 261.6 * t) + 0.5 * Math.sin(2 * Math.PI * 392 * t));
      }
      return out;
    },
  },
  haste: {
    note: "Quick upward whoosh with a light tick, made for Haste",
    make() {
      const len = 0.45;
      const swept = bandpass(noise(len, 11), (t) => 350 * Math.pow(12, Math.min(1, t / 0.32)), 0.35);
      for (let i = 0; i < swept.length; i++) {
        const t = i / RATE;
        swept[i] = (swept[i] ?? 0) * Math.sin(Math.PI * Math.min(1, t / 0.36)) ** 1.5;
      }
      // The tick at the top of the sweep.
      const at = Math.floor(0.33 * RATE);
      for (let i = 0; i < 0.03 * RATE; i++) {
        const t = i / RATE;
        swept[at + i] = (swept[at + i] ?? 0) + 0.6 * Math.sign(Math.sin(2 * Math.PI * 2600 * t)) * Math.exp(-t / 0.006);
      }
      return swept;
    },
  },
  bless: {
    note: "Bright bell and choir major chord shimmer, made for Bless",
    make() {
      const out = buffer(1.0);
      const chord = [523.25, 659.25, 783.99, 1046.5];
      for (let i = 0; i < out.length; i++) {
        const t = i / RATE;
        const env = Math.min(1, t / 0.12) * Math.exp(-Math.max(0, t - 0.12) / 0.4);
        let v = 0;
        for (const f of chord) {
          for (const detune of [-0.004, 0.004]) {
            const vib = 1 + 0.003 * Math.sin(2 * Math.PI * 5.5 * t);
            const ph = 2 * Math.PI * f * (1 + detune) * vib * t;
            v += Math.sin(ph) + 0.25 * Math.sin(2 * ph) + 0.12 * Math.sin(3 * ph);
          }
        }
        out[i] = v * env * 0.12;
      }
      [2093, 2637, 3136, 2349, 3520].forEach((f, k) => bell(out, 0.05 + k * 0.11, f, 0.18, 0.08, 0.3));
      return out;
    },
  },
  "holy weapon": {
    note: "Metallic shing with a bright ring, made for Holy Weapon",
    make() {
      const len = 0.85;
      const out = buffer(len);
      // The scrape: bright noise, rising.
      const scrape = bandpass(noise(0.12, 21), (t) => 3000 + t * 20000, 0.5);
      for (let i = 0; i < scrape.length; i++) {
        const t = i / RATE;
        out[i] = (scrape[i] ?? 0) * Math.sin(Math.PI * (t / 0.12)) * 1.2;
      }
      // The ring: inharmonic metal partials.
      const partials: [number, number, number][] = [
        [1480, 0.5, 0.35],
        [2210, 0.45, 0.25],
        [3330, 0.3, 0.16],
        [4120, 0.2, 0.1],
        [5080, 0.12, 0.06],
      ];
      const start = Math.floor(0.05 * RATE);
      for (let i = 0; start + i < out.length; i++) {
        const t = i / RATE;
        let v = 0;
        for (const [f, a, d] of partials) {
          v += a * Math.sin(2 * Math.PI * f * t) * Math.exp(-t / d);
        }
        out[start + i] = (out[start + i] ?? 0) + v * Math.min(1, t / 0.003) * (1 + 0.15 * Math.sin(2 * Math.PI * 9 * t));
      }
      return out;
    },
  },
  weaken: {
    note: "Low descending warble, made for Weaken",
    make() {
      const out = buffer(0.9);
      let ph = 0;
      let ph2 = 0;
      let lp = 0;
      for (let i = 0; i < out.length; i++) {
        const t = i / RATE;
        const f = 150 * Math.pow(0.45, t / 0.9) * (1 + 0.06 * Math.sin(2 * Math.PI * 7 * t));
        ph += f / RATE;
        ph2 += (f * 1.012) / RATE;
        const saw = 2 * (ph % 1) - 1 + (2 * (ph2 % 1) - 1);
        lp += 0.08 * (saw - lp);
        const env = Math.min(1, t / 0.06) * (1 - t / 0.9) ** 0.6;
        out[i] = (lp + 0.4 * Math.sin(2 * Math.PI * ph * 0.5)) * env;
      }
      return out;
    },
  },
  "poison dart": {
    note: "Short thwip, made for Poison Dart",
    make() {
      const out = buffer(0.3);
      const hiss = bandpass(noise(0.3, 31), (t) => 4000 * Math.exp(-t / 0.05) + 600, 0.6);
      let ph = 0;
      for (let i = 0; i < out.length; i++) {
        const t = i / RATE;
        const f = 1400 * Math.exp(-t / 0.035) + 220;
        ph += f / RATE;
        out[i] = (0.6 * Math.sin(2 * Math.PI * ph) + 0.9 * (hiss[i] ?? 0)) * Math.min(1, t / 0.003) * Math.exp(-t / 0.06);
      }
      return out;
    },
  },
  identify: {
    note: "Soft sparkly two-note twinkle, made for Identify",
    make() {
      const out = buffer(0.65);
      bell(out, 0, 1318.5, 0.6, 0.12, 0.65);
      bell(out, 0.13, 1975.5, 0.6, 0.2, 0.52);
      [3951, 3520, 4699].forEach((f, k) => bell(out, 0.18 + k * 0.06, f, 0.12, 0.04, 0.2));
      return out;
    },
  },
};

// ---------------------------------------------------------------------------------------------
// Writing

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

/** A 4x sheet of one spell's runs, a row each, on a checkerboard where the green key is. */
function sheet(runs: Run[], scale = 4): Rgba {
  const pad = 4;
  const rowW = (r: Run) => r.frames.reduce((a, f) => a + f.width * scale + pad, pad);
  const rowH = (r: Run) => Math.max(...r.frames.map((f) => f.height)) * scale + pad;
  const w = Math.max(...runs.map(rowW));
  const h = runs.reduce((a, r) => a + rowH(r), pad);
  const out = createRgba(w, h);
  for (let i = 0; i < w * h; i++) {
    out.data.set([60, 60, 70, 255], i * 4);
  }
  let oy = pad;
  for (const run of runs) {
    let ox = pad;
    for (const img of run.frames) {
      for (let y = 0; y < img.height * scale; y++) {
        for (let x = 0; x < img.width * scale; x++) {
          const s = (Math.floor(y / scale) * img.width + Math.floor(x / scale)) * 4;
          let c = [img.data[s] ?? 0, img.data[s + 1] ?? 0, img.data[s + 2] ?? 0];
          if (c[0] === 0 && c[1] === 255 && c[2] === 0) {
            const g = ((x >> 3) + (y >> 3)) & 1 ? 40 : 52;
            c = [g, g, g];
          }
          out.data.set([c[0] ?? 0, c[1] ?? 0, c[2] ?? 0, 255], ((oy + y) * w + ox + x) * 4);
        }
      }
      ox += img.width * scale + pad;
    }
    oy += rowH(run);
  }
  return out;
}

mkdirSync(FX, { recursive: true });
mkdirSync(SOUNDS, { recursive: true });
mkdirSync(ITEMS, { recursive: true });

const spells: Run[][] = [[replenish()], [haste()], [bless()], [holyWeapon()], [weaken()], [identify()], poisonDart()];
for (const runs of spells) {
  for (const run of runs) {
    const first = run.frames[0];
    if (!first || run.frames.some((f) => f.width !== first.width || f.height !== first.height)) {
      throw new Error(`${run.member}: every frame must be the same size`);
    }
    run.frames.forEach((img, k) => {
      const name = `${run.member}-${k + 1}`;
      writeFileSync(join(FX, `${name}.png`), encodePng(img));
      writeJson(join(FX, `${name}.json`), {
        group: "fx",
        regX: Math.floor(img.width / 2),
        regY: Math.floor(img.height / 2),
        key: "green",
        prov: "authored",
        note: `${run.spell}, ${run.what ?? "frame"} ${k + 1}`,
      });
    });
    console.log(`${run.member}: ${run.frames.length} frames, ${first.width}x${first.height}`);
  }
  if (PREVIEW) {
    mkdirSync(PREVIEW, { recursive: true });
    const spell = runs[0]?.spell ?? "spell";
    writeFileSync(join(PREVIEW, `${spell.replaceAll(" ", "-").toLowerCase()}.png`), encodePng(sheet(runs)));
  }
}

for (const [name, sound] of Object.entries(SOUND_MAKERS)) {
  const samples = sound.make();
  writeFileSync(join(SOUNDS, `${name}.wav`), wav(samples));
  writeJson(join(SOUNDS, `${name}.json`), { group: "sounds", prov: "authored", note: sound.note });
  console.log(`${name}.wav: ${(samples.length / RATE).toFixed(2)} s`);
}

// The spell book: every 1.6 spell book uses the same picture.
const manifest = join(ROOT, "assets", "original", "main", "layout", "cast-manifest.jsonl");
const bookRow = readFileSync(manifest, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line) as { name: string; asset?: string; regX?: number; regY?: number })
  .find((row) => row.name === "Replenish Book");
if (!bookRow?.asset) {
  throw new Error("Replenish Book is missing from the cast manifest");
}
const book = decodePng(new Uint8Array(readFileSync(join(ROOT, "assets", "original", "main", bookRow.asset))));
for (const item of ["Haste Book", "Poison Dart Book"]) {
  writeFileSync(join(ITEMS, `${item}.png`), encodePng(book));
  writeJson(join(ITEMS, `${item}.json`), {
    group: "items",
    regX: bookRow.regX,
    regY: bookRow.regY,
    key: "green",
    prov: "authored",
    note: `${item}: the standard 1.6 spell book picture (copied from Replenish Book)`,
  });
  console.log(`${item}.png: ${book.width}x${book.height}`);
}
