/**
 * Generates the Boat (55) and Battleship (56) rider frames into `assets/added/bodies/`:
 * `bun packages/data/build/art/ships.ts [--preview <dir>]`, then `bun run data:build`.
 *
 * Each ship is a small parametric 3D model, point-splatted through the game's three-quarter camera
 * (pitch 35 deg), in the airship's "shrunk-down painting" style:
 * paint at SS× with smooth lighting and wood grain, box-filter down to 1×, snap to the palette
 * taken from the airship and ship art, then outline the silhouette only.
 * Coordinates are 1× pixels relative to the registration point: the tile is x -16..15, y 2..33.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createRgba, decodePng, encodePng, type Rgba } from "../assets-lib/png.ts";

const ROOT = join(import.meta.dir, "../../../..");
const BODIES = join(ROOT, "assets/added/bodies");
const previewAt = process.argv.indexOf("--preview");
const PREVIEW = previewAt > 0 ? process.argv[previewAt + 1] : null;
const SS = 4;
const SIZE = 96,
  RX = 48,
  RY = 56; // 1× working canvas, reg at (RX, RY)
type V3 = [number, number, number];

// ---------- palette ----------
const PAL: V3[] = JSON.parse(readFileSync(join(import.meta.dir, "ship-palette.json"), "utf8"));
PAL.push(
  [128, 116, 100],
  [178, 166, 146],
  [214, 204, 182],
  [236, 230, 214],
  [250, 247, 238],
  [110, 52, 22],
  [150, 82, 38],
  [170, 30, 40],
  [210, 60, 50],
  [235, 110, 70],
  [255, 220, 120],
  [255, 170, 60],
  [230, 230, 236],
  [250, 250, 250],
);
const nearest = (c: V3): V3 => {
  let best: V3 = [0, 0, 0],
    bd = 1e18;
  for (const p of PAL) {
    const dr = c[0] - p[0],
      dg = c[1] - p[1],
      db = c[2] - p[2];
    const rm = (c[0] + p[0]) / 2;
    const d = (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
};

// ---------- noise ----------
const hash = (x: number, y: number, s = 0) => {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};
const smooth = (t: number) => t * t * (3 - 2 * t);
const vnoise = (x: number, y: number, s = 0) => {
  const xi = Math.floor(x),
    yi = Math.floor(y),
    xf = smooth(x - xi),
    yf = smooth(y - yi);
  const a = hash(xi, yi, s),
    b = hash(xi + 1, yi, s),
    c = hash(xi, yi + 1, s),
    d = hash(xi + 1, yi + 1, s);
  return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
};
const lerp = (a: V3, b: V3, t: number): V3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const ramp = (stops: V3[], t: number): V3 => {
  t = Math.max(0, Math.min(0.9999, t)) * (stops.length - 1);
  const i = Math.floor(t);
  return lerp(stops[i] ?? [0, 0, 0], stops[i + 1] ?? [0, 0, 0], t - i);
};
const mul = (c: V3, k: number): V3 => [c[0] * k, c[1] * k, c[2] * k];

// ---------- hi-res canvas ----------
const HW = SIZE * SS;
class Layer {
  r = new Float32Array(HW * HW);
  g = new Float32Array(HW * HW);
  b = new Float32Array(HW * HW);
  a = new Float32Array(HW * HW);
  put(i: number, c: V3, alpha = 1) {
    const ia = 1 - alpha;
    this.r[i] = c[0] * alpha + (this.r[i] ?? 0) * ia;
    this.g[i] = c[1] * alpha + (this.g[i] ?? 0) * ia;
    this.b[i] = c[2] * alpha + (this.b[i] ?? 0) * ia;
    this.a[i] = alpha + (this.a[i] ?? 0) * ia;
  }
  /** Fill wherever `inside(u,v)` holds, with colour from `shade(u,v)`; u,v are 1× reg-relative coords. */
  fill(
    bbox: [number, number, number, number],
    inside: (u: number, v: number) => boolean,
    shade: (u: number, v: number) => V3 | null,
    alpha = 1,
  ) {
    const [x0, y0, x1, y1] = bbox;
    for (let Y = Math.floor((y0 + RY) * SS); Y < Math.ceil((y1 + RY) * SS); Y++) {
      for (let X = Math.floor((x0 + RX) * SS); X < Math.ceil((x1 + RX) * SS); X++) {
        if (X < 0 || Y < 0 || X >= HW || Y >= HW) {
          continue;
        }
        const u = (X + 0.5) / SS - RX,
          v = (Y + 0.5) / SS - RY;
        if (!inside(u, v)) {
          continue;
        }
        const c = shade(u, v);
        if (c) {
          this.put(Y * HW + X, c, alpha);
        }
      }
    }
  }
}
const ellFill = (
  L: Layer,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  shade: (u: number, v: number) => V3 | null,
  alpha = 1,
) =>
  L.fill(
    [cx - rx - 1, cy - ry - 1, cx + rx + 1, cy + ry + 1],
    (u, v) => ((u - cx) / rx) ** 2 + ((v - cy) / ry) ** 2 <= 1,
    shade,
    alpha,
  );

// ---------- materials ----------
const WOOD: V3[] = [
  [30, 10, 6],
  [62, 20, 10],
  [96, 32, 12],
  [128, 44, 16],
  [158, 62, 24],
  [190, 110, 50],
  [205, 145, 70],
];
const STREAK: V3 = [235, 205, 160];
const GREY: V3[] = [
  [40, 40, 44],
  [80, 80, 84],
  [120, 120, 124],
  [165, 165, 168],
  [205, 205, 208],
  [240, 240, 240],
];
const SAIL_W: V3[] = [
  [118, 108, 96],
  [170, 160, 142],
  [212, 202, 180],
  [236, 230, 214],
  [250, 247, 238],
];
const MAST: V3[] = [
  [36, 14, 6],
  [80, 32, 12],
  [118, 52, 20],
  [150, 82, 38],
  [186, 122, 64],
];
const ROPE: V3 = [52, 30, 20];
const SAIL_D: V3[] = [
  [38, 38, 42],
  [70, 70, 74],
  [104, 104, 108],
  [140, 140, 144],
  [176, 176, 180],
  [214, 214, 216],
];
const BRASS: [V3, V3, V3, V3] = [
  [90, 70, 10],
  [155, 151, 9],
  [210, 205, 47],
  [240, 232, 140],
];
const GLASS: [V3, V3, V3] = [
  [120, 70, 10],
  [207, 161, 57],
  [255, 230, 140],
];

// ---------- 3D: ships as parametric surfaces, point-splatted through the game's angled camera ----------
/**
 * Ship space: x toward the bow, y to the side, z up (z = 0 is the waterline). World: X right on
 * screen, Y away from the viewer, Z up. The camera looks down at PITCH from the horizontal, like
 * the game's three-quarter view: things further away (larger Y) sit higher on screen.
 */
type Dir = "e" | "w" | "n" | "s";
type Ship = "boat" | "battleship";
interface Opts {
  f: number;
  fire: boolean;
  fireFrame?: number;
}
type P3 = [number, number, number];

const PITCH = (35 * Math.PI) / 180;
let SCALE = 1.25;
const CP = Math.cos(PITCH),
  SP = Math.sin(PITCH);
const ORIGIN_Y = 20; // where the ship's centre at the waterline lands, below the reg point
const toCam: P3 = [0, -CP, SP];
const LIGHT = (() => {
  const l: P3 = [-0.5, -0.35, 0.8];
  const n = Math.hypot(...l);
  return l.map((v) => v / n) as P3;
})();
const dot = (a: P3, b: P3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: P3, b: P3): P3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: P3, b: P3): P3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: P3): P3 => {
  const n = Math.hypot(...a) || 1;
  return [a[0] / n, a[1] / n, a[2] / n];
};

class Scene {
  S = new Layer();
  W = new Layer();
  depth = new Float32Array(HW * HW).fill(1e9);
  rope = new Float32Array(HW * HW).fill(1e9);
  constructor(
    public dir: Dir,
    public bob: number,
  ) {}
  world(p: P3): P3 {
    const x = p[0] * SCALE,
      y = p[1] * SCALE,
      z = p[2] * SCALE;
    const Z = z + this.bob;
    switch (this.dir) {
      case "e":
        return [x, y, Z];
      case "w":
        return [-x, -y, Z];
      case "s":
        return [y, -x, Z]; // bow toward the viewer
      case "n":
        return [-y, x, Z];
    }
  }
  worldN(n: P3): P3 {
    const [x, y, z] = n;
    return this.dir === "e"
      ? [x, y, z]
      : this.dir === "w"
        ? [-x, -y, z]
        : this.dir === "s"
          ? [y, -x, z]
          : [-y, x, z];
  }
  project(P: P3) {
    return { sx: P[0], sy: ORIGIN_Y - P[2] * CP - P[1] * SP, d: P[1] * CP - P[2] * SP };
  }
  splat(p: P3, c: V3) {
    const P = this.world(p);
    if (P[2] < -0.05) {
      return; // under water
    }
    const { sx, sy, d } = this.project(P);
    const X = Math.floor((sx + RX) * SS),
      Y = Math.floor((sy + RY) * SS);
    if (X < 0 || Y < 0 || X >= HW || Y >= HW) {
      return;
    }
    const i = Y * HW + X;
    if (d >= (this.depth[i] ?? 0)) {
      return;
    }
    this.depth[i] = d;
    this.S.r[i] = c[0];
    this.S.g[i] = c[1];
    this.S.b[i] = c[2];
    this.S.a[i] = 1;
  }
  /** A rope: a hairline that survives the shrink as a 1px line where it is not hidden. */
  line(a: P3, b: P3) {
    const n = Math.ceil(Math.hypot(...sub(b, a)) * SS * 3 * SCALE);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const P = this.world([
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
      ]);
      if (P[2] < 0) {
        continue;
      }
      const { sx, sy, d } = this.project(P);
      const X = Math.floor((sx + RX) * SS),
        Y = Math.floor((sy + RY) * SS);
      if (X < 0 || Y < 0 || X >= HW || Y >= HW) {
        continue;
      }
      const i2 = Y * HW + X;
      this.rope[i2] = Math.min(this.rope[i2] ?? 1e9, d);
    }
  }
  box(c: P3, size: P3, mat: (k: number, face: number) => V3) {
    const [cx, cy, cz] = c,
      [hx, hy, hz] = [size[0] / 2, size[1] / 2, size[2] / 2];
    const faces: ((u: number, v: number) => P3)[] = [
      (u, v) => [cx - hx + 2 * hx * u, cy - hy + 2 * hy * v, cz + hz],
      (u, v) => [cx - hx + 2 * hx * u, cy - hy, cz - hz + 2 * hz * v],
      (u, v) => [cx - hx + 2 * hx * u, cy + hy, cz - hz + 2 * hz * v],
      (u, v) => [cx - hx, cy - hy + 2 * hy * u, cz - hz + 2 * hz * v],
      (u, v) => [cx + hx, cy - hy + 2 * hy * u, cz - hz + 2 * hz * v],
    ];
    for (const [i, f] of faces.entries()) {
      this.surf(f, (_u, _v, _p, k) => mat(k, i));
    }
  }
  disc(c: P3, r: number, mat: (k: number) => V3) {
    this.surf(
      (u, v) => [
        c[0] + r * v * Math.cos(u * Math.PI * 2),
        c[1] + r * v * Math.sin(u * Math.PI * 2),
        c[2],
      ],
      (_u, _v, _p, k) => mat(k),
    );
  }
  /** Lighting for a ship-space normal, two-sided. */
  light(n: P3) {
    let N = norm(this.worldN(n));
    if (dot(N, toCam) < 0) {
      N = [-N[0], -N[1], -N[2]];
    }
    const diff = Math.max(0, dot(N, LIGHT));
    const h = norm([LIGHT[0] + toCam[0], LIGHT[1] + toCam[1], LIGHT[2] + toCam[2]]);
    const spec = Math.max(0, dot(N, h)) ** 24;
    return { k: 0.42 + 0.78 * diff, spec };
  }
  /** A parametric surface: f(u, v) in ship space over [0,1]², coloured by `mat`. */
  surf(
    f: (u: number, v: number) => P3,
    mat: (u: number, v: number, p: P3, k: number, spec: number) => V3 | null,
    density = 1,
  ) {
    // pick a step so splats land at most ~0.6 hi-res pixels apart
    let lu = 0,
      lv = 0;
    for (let i = 0; i < 8; i++) {
      lu = Math.max(
        lu,
        Math.hypot(...sub(f(1, i / 7), f(0, i / 7))) +
          Math.hypot(...sub(f(0.5, i / 7), f(0, i / 7))),
      );
      lv = Math.max(
        lv,
        Math.hypot(...sub(f(i / 7, 1), f(i / 7, 0))) +
          Math.hypot(...sub(f(i / 7, 0.5), f(i / 7, 0))),
      );
    }
    const nu = Math.ceil(lu * SS * 1.8 * density) + 1,
      nv = Math.ceil(lv * SS * 1.8 * density) + 1;
    const e = 1e-3;
    for (let a = 0; a <= nu; a++) {
      for (let b = 0; b <= nv; b++) {
        const u = a / nu,
          v = b / nv;
        const p = f(u, v);
        const du = sub(f(Math.min(1, u + e), v), f(Math.max(0, u - e), v));
        const dv = sub(f(u, Math.min(1, v + e)), f(u, Math.max(0, v - e)));
        const { k, spec } = this.light(cross(du, dv));
        const c = mat(u, v, p, k, spec);
        if (c) {
          this.splat(p, c);
        }
      }
    }
  }
  cylinder(a: P3, b: P3, r: number, mat: V3[], lift = 0) {
    const ax = norm(sub(b, a));
    const ref: P3 = Math.abs(ax[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const e1 = norm(cross(ax, ref)),
      e2 = cross(ax, e1);
    this.surf(
      (u, v) => {
        const t = u * Math.PI * 2;
        return [
          a[0] + (b[0] - a[0]) * v + (e1[0] * Math.cos(t) + e2[0] * Math.sin(t)) * r,
          a[1] + (b[1] - a[1]) * v + (e1[1] * Math.cos(t) + e2[1] * Math.sin(t)) * r,
          a[2] + (b[2] - a[2]) * v + (e1[2] * Math.cos(t) + e2[2] * Math.sin(t)) * r,
        ];
      },
      (_u, _v, _p, k, spec) => lerp(ramp(mat, k * 0.75 + lift), [255, 245, 225], spec * 0.6),
    );
  }
  sphere(c: P3, r: number, mat: (k: number, facing: number, p: P3) => V3) {
    this.surf(
      (u, v) => {
        const t = u * Math.PI * 2,
          ph = v * Math.PI;
        return [
          c[0] + r * Math.sin(ph) * Math.cos(t),
          c[1] + r * Math.sin(ph) * Math.sin(t),
          c[2] + r * Math.cos(ph),
        ];
      },
      (_u, _v, p, k) => {
        const n = norm(this.worldN(sub(p, c)));
        return mat(k, dot(n, toCam), p);
      },
    );
  }
  /** Foam/darkening on the water layer, at a ship-space point on the waterline. */
  water(p: P3, rx: number, c: V3, alpha: number, dy = 0) {
    const P = this.world([p[0], p[1], 0]);
    const { sx, sy } = this.project([P[0], P[1], 0]);
    ellFill(this.W, sx, sy + dy, rx * SCALE, rx * SCALE * 0.6, () => c, alpha);
  }
}

/** A foam crest: a white core with a mid-blue rim, so it reads on light and dark water alike. */
function crest(sc: Scene, p: P3, r: number, k: number) {
  sc.water(p, r + 0.45, [40, 70, 190], 0.9);
  sc.water(p, r, lerp([215, 225, 250], [255, 255, 255], k), 0.95);
}

// ---------- hulls ----------
interface HullSpec {
  L: number;
  B: number;
  draft: number;
  rail: (s: number) => number; // rail height above water
  bulwark: number;
  widest: number; // where the hull is broadest, 0 = stern .. 1 = bow
  transom: number; // stern half-width as a fraction of B
}
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const halfBeam = (h: HullSpec, s: number) => {
  if (s <= h.widest) {
    return h.B * (h.transom + (1 - h.transom) * Math.sin(((s / h.widest) * Math.PI) / 2));
  }
  const t = (s - h.widest) / (1 - h.widest);
  return h.B * Math.max(0, 1 - t * t) ** 0.62;
};
/** Half-width at height z: narrower toward the keel. */
const halfWidth = (h: HullSpec, s: number, z: number) => {
  const q = Math.max(0, Math.min(1, (z + h.draft) / (h.rail(s) + h.draft)));
  return halfBeam(h, s) * (0.5 + 0.5 * Math.sqrt(q));
};

const BOAT: HullSpec = {
  L: 30,
  B: 5.2,
  draft: 3,
  bulwark: 1.3,
  widest: 0.38,
  transom: 0.6,
  rail: (s) => 4.4 + 3.2 * (1 - smoothstep(0, 0.4, s)) + 2.4 * smoothstep(0.55, 1, s),
};
const POOP = 0.24; // the battleship's raised stern deck runs from the stern to here
const BATTLESHIP: HullSpec = {
  L: 36,
  B: 8.6,
  draft: 4,
  bulwark: 1.8,
  widest: 0.4,
  transom: 0.78,
  rail: (s) => 7 + (s < POOP ? 4.5 : 0) + 2.6 * smoothstep(0.6, 1, s),
};

function hull(sc: Scene, h: HullSpec, big: boolean, f: number) {
  const X = (s: number) => h.L * (s - 0.5);
  const deckZ = (s: number) => h.rail(s) - h.bulwark;
  const side =
    (sg: 1 | -1) =>
    (u: number, v: number): P3 => {
      const s = u,
        z = -h.draft + (h.rail(s) + h.draft) * v;
      return [X(s), sg * halfWidth(h, s, z), z];
    };
  const sideMat = (u: number, _v: number, p: P3, k: number, spec: number): V3 => {
    const z = p[2],
      rail = h.rail(u);
    const t = 1 - Math.max(0, z) / rail; // 0 at the rail, 1 at the waterline
    let c = ramp(WOOD, 0.25 + (1 - t) * 0.55 + (vnoise(p[0] * 0.5, z * 0.8, 3) - 0.5) * 0.15);
    if (((z + 10) / 1.5) % 1 < 0.2) {
      c = mul(c, 0.72); // plank seams
    }
    const st = vnoise(p[0] * 0.16, Math.floor((z + 10) / 1.5) * 3.1, 7);
    if (st > 0.55) {
      c = lerp(c, STREAK, Math.min(1, (st - 0.55) * 4) * (0.4 + 0.6 * (1 - t)));
    }
    if (rail - z < 0.6) {
      c = big ? BRASS[2] : [240, 226, 200]; // rail cap seen side-on
    }
    if (big) {
      if (Math.abs(z - 2.6) < 0.35) {
        c = BRASS[1];
      }
      if (Math.abs(z - 4.2) < 0.8 && [-10, -3.5, 3, 9.5].some((gx) => Math.abs(p[0] - gx) < 0.9)) {
        c = [24, 18, 16];
      }
      if (
        u < POOP &&
        Math.abs(z - (rail - 2.2)) < 0.7 &&
        Math.abs(((p[0] - X(0)) % 2.6) - 1.3) < 0.55
      ) {
        c = GLASS[1];
      }
    }
    if (t > 0.8) {
      c = lerp(c, [70, 30, 90], (t - 0.8) * 1.5);
    }
    return lerp(mul(c, k), [255, 240, 215], spec * 0.5);
  };
  sc.surf(side(1), sideMat);
  sc.surf(side(-1), sideMat);
  // transom
  sc.surf(
    (u, v) => {
      const z = -h.draft + (h.rail(0) + h.draft) * v;
      const w = halfWidth(h, 0, z);
      return [X(0), (u * 2 - 1) * w, z];
    },
    (_u, _v, p, k) => {
      const rail = h.rail(0),
        z = p[2];
      let c = ramp(WOOD, 0.35 + (z / rail) * 0.4 + (vnoise(p[1], z, 8) - 0.5) * 0.15);
      if (rail - z < 0.6) {
        c = big ? BRASS[2] : [240, 226, 200];
      }
      const win = big ? [-4.5, -1.5, 1.5, 4.5] : [-1.8, 1.8];
      if (
        Math.abs(z - (rail - (big ? 2.4 : 1.8))) < 0.7 &&
        win.some((wx) => Math.abs(p[1] - wx) < 0.6)
      ) {
        c = GLASS[2];
      }
      if (big && Math.abs(z - (rail - 4)) < 0.3) {
        c = BRASS[1];
      }
      return mul(c, k);
    },
  );
  // deck
  const inset = 0.7;
  sc.surf(
    (u, v) => {
      const s = u;
      const w = halfBeam(h, s) - inset;
      return [X(s), (v * 2 - 1) * Math.max(0, w), deckZ(s)];
    },
    (_u, _v, p, k) => {
      let c = ramp(WOOD, 0.8 + (vnoise(p[0] * 0.4, p[1] * 0.9, 2) - 0.5) * 0.25);
      if (((p[1] + 20) / 1.3) % 1 < 0.25) {
        c = mul(c, 0.62);
      }
      const st = vnoise(p[0] * 0.2, Math.floor((p[1] + 20) / 1.3) * 2.3, 13);
      if (st > 0.6) {
        c = lerp(c, STREAK, (st - 0.6) * 2.5);
      }
      if (big && Math.abs(p[1]) < 0.9 && Math.abs(((p[0] + 50) % 5) - 2.5) < 0.9) {
        c = [60, 30, 20]; // hatches
      }
      return mul(c, 0.75 + k * 0.35);
    },
  );
  // inner bulwark and rail cap, seen from above
  for (const sg of [1, -1] as const) {
    sc.surf(
      (u, v) => {
        const s = u;
        const w = halfBeam(h, s) - inset;
        return [X(s), sg * Math.max(0, w), deckZ(s) + h.bulwark * v];
      },
      (_u, _v, p, k) => mul(ramp(WOOD, 0.18 + (vnoise(p[0], p[2], 4) - 0.5) * 0.1), 0.6 + k * 0.4),
    );
    sc.surf(
      (u, v) => {
        const s = u;
        const w = halfBeam(h, s);
        return [X(s), sg * Math.max(0, w - inset * v), h.rail(s)];
      },
      (_u, _v, _p, k) => mul(big ? BRASS[2] : [235, 220, 195], 0.6 + k * 0.4),
    );
  }
  sc.surf(
    (u, v) => {
      const w = halfBeam(h, 0);
      return [X(0) + inset * v, (u * 2 - 1) * w, h.rail(0)];
    },
    (_u, _v, _p, k) => mul(big ? BRASS[2] : [235, 220, 195], 0.6 + k * 0.4),
  );
  if (big) {
    // the poop deck's forward wall
    const s = POOP,
      w = halfBeam(h, s) - inset;
    sc.surf(
      (u, v) => [X(s), (u * 2 - 1) * w, deckZ(s + 0.01) + (deckZ(s - 0.01) - deckZ(s + 0.01)) * v],
      (_u, v, p, k) => {
        let c = ramp(GREY, 0.35 + v * 0.2);
        if (v > 0.85) {
          c = BRASS[2];
        }
        if (Math.abs(p[1]) < 1 && v < 0.7) {
          c = ramp(WOOD, 0.3);
        }
        return mul(c, k);
      },
    );
    // cannons
    for (const gx of [-10, -3.5, 3, 9.5]) {
      for (const sg of [1, -1]) {
        const s = gx / h.L + 0.5,
          w = halfWidth(h, s, 4.2);
        sc.cylinder([gx, sg * (w - 0.5), 4.2], [gx, sg * (w + 2.2), 4.2], 0.6, GREY);
      }
    }
  }
  // water: dark band hugging the hull, foam along it, a bow wave and a short wake
  for (let s = 0; s <= 1; s += 0.03) {
    for (const sg of [1, -1]) {
      const w = halfWidth(h, s, 0);
      sc.water([X(s), sg * w, 0], 1.0, [16, 36, 130], 0.85, 1.6);
    }
  }
  for (let s = 0.04; s <= 1; s += 0.07) {
    for (const sg of [1, -1]) {
      const w = halfWidth(h, s, 0),
        k = vnoise(s * 9 + f * 0.9, sg, 11);
      if (k < 0.2) {
        continue;
      }
      crest(sc, [X(s), sg * (w + 1.7 + k * 0.5), 0], 0.55 + k * 0.45, k);
    }
  }
  for (let i = 0; i < 4; i++) {
    for (const sg of [1, -1]) {
      const k = vnoise(i * 1.3 + f, sg * 3, 12);
      crest(sc, [X(1) + 1.5 - i * 1.1, sg * (1.6 + i * 1.1), 0], 0.6 + k * 0.3, 1);
      if (i < 3) {
        crest(
          sc,
          [X(0) - 2 - i * 1.7, sg * (halfBeam(h, 0) * 0.5 + i * 0.6) + Math.sin(i + f) * 0.4, 0],
          0.45 + k * 0.35,
          k,
        );
      }
    }
  }
}

// ---------- rigging ----------
/** A square sail hung across the ship from a yard, bellied toward the bow by the wind astern. */
const BRACE = (40 * Math.PI) / 180; // yards braced round, so the sails show from the side too
function sail(sc: Scene, mx: number, zTop: number, zBot: number, hw: number, mat: V3[], f: number) {
  const belly = 2.2 + (f % 2) * 0.4;
  const cb = Math.cos(BRACE),
    sb = Math.sin(BRACE);
  sc.surf(
    (u, v) => {
      const a = u * 2 - 1;
      const lat = a * hw * (1 - 0.1 * v);
      const fwd = 0.6 + belly * (1 - a * a) * Math.sin(Math.PI * (0.1 + 0.9 * v)) * (0.6 + 0.4 * v);
      return [mx + fwd * cb + lat * sb, -fwd * sb + lat * cb, zTop - (zTop - zBot) * v];
    },
    (u, v, p, k) => {
      let c = ramp(
        mat,
        (mat === SAIL_D ? k * 0.62 : k * 0.85 + 0.1) -
          v * 0.1 +
          (vnoise(p[1] * 0.6, p[2] * 0.6, 3) - 0.5) * 0.12,
      );
      if (Math.abs(((v * (zTop - zBot)) % 3) - 1.5) < 0.18) {
        c = mul(c, 0.88); // reef bands
      }
      if ((u * hw * 2) % 2.2 < 0.3) {
        c = mul(c, 0.9); // canvas cloths
      }
      return c;
    },
  );
  const yh = hw + 1;
  sc.cylinder(
    [mx + 0.6 * cb - yh * sb, -0.6 * sb - yh * cb, zTop + 0.3],
    [mx + 0.6 * cb + yh * sb, -0.6 * sb + yh * cb, zTop + 0.3],
    0.45,
    GREY,
    0.1,
  );
}
function mast(sc: Scene, mx: number, z0: number, z1: number, r = 0.85) {
  sc.cylinder([mx, 0, z0], [mx, 0, z1], r, MAST, 0.15);
}
/** A sail furled on its yard: a fat roll of canvas. */
function furled(sc: Scene, mx: number, z: number, hw: number, mat: V3[]) {
  const cb = Math.cos(BRACE),
    sb = Math.sin(BRACE),
    yh = hw + 1;
  const a: P3 = [mx + 0.6 * cb - yh * sb, -0.6 * sb - yh * cb, z],
    b: P3 = [mx + 0.6 * cb + yh * sb, -0.6 * sb + yh * cb, z];
  sc.cylinder(a, b, 0.45, GREY, 0.1);
  const a2: P3 = [a[0] + 0.5 * cb, a[1] - 0.5 * sb, z - 0.7],
    b2: P3 = [b[0] + 0.5 * cb, b[1] - 0.5 * sb, z - 0.7];
  sc.cylinder(
    [a2[0] * 0.85 + b2[0] * 0.15, a2[1] * 0.85 + b2[1] * 0.15, a2[2]],
    [a2[0] * 0.15 + b2[0] * 0.85, a2[1] * 0.15 + b2[1] * 0.85, b2[2]],
    0.75,
    mat,
    0.05,
  );
}
/** Shrouds from below the masthead to both rails, and a stay forward. */
function shrouds(sc: Scene, h: HullSpec, mx: number, zTop: number, forward: P3) {
  const s = mx / h.L + 0.5;
  for (const sg of [1, -1]) {
    for (const dx of [-1.5, -3.2]) {
      const s2 = (mx + dx) / h.L + 0.5;
      sc.line([mx, 0, zTop], [mx + dx, sg * halfBeam(h, s2), h.rail(s2)]);
    }
  }
  void s;
  sc.line([mx, 0, zTop + 0.5], forward);
}
/** A pennant streaming toward the bow from the masthead. */
function pennant(sc: Scene, mx: number, z: number, f: number, len = 5) {
  sc.surf(
    (u, v) => [mx + u * len, Math.sin(u * 4 + f * 1.6) * 0.7 * u, z - v * 2.8 * (1 - u * 0.6)],
    (u, _v, _p, k) =>
      ramp(
        [
          [90, 10, 20],
          [170, 30, 40],
          [220, 70, 55],
        ],
        k * 0.8 + Math.sin(u * 4 + f * 1.6) * 0.15,
      ),
  );
}
function puff(sc: Scene, c: P3, r: number, flash: boolean, thin: boolean) {
  const g = (k: number) => ramp(GREY, (thin ? 0.6 : 0.45) + k * 0.45);
  sc.sphere(c, r, (k, facing) =>
    flash && facing > 0.6 ? lerp([255, 150, 40], [255, 240, 170], (facing - 0.6) * 2.5) : g(k),
  );
  sc.sphere([c[0] + r * 0.6, c[1], c[2] + r * 0.7], r * 0.7, g);
  if (!flash) {
    sc.sphere([c[0] - r * 0.7, c[1], c[2] + r * 0.4], r * 0.6, g);
  }
}

function drawShip(ship: Ship, dir: Dir, o: Opts): Scene {
  const bob = [0, 0.5, 0, -0.5][o.f - 1] ?? 0;
  const big = ship === "battleship";
  SCALE = big ? 1.05 : 1.15;
  const sc = new Scene(dir, bob);
  if (!big) {
    hull(sc, BOAT, false, o.f);
    mast(sc, 1, 2, 22);
    sail(sc, 1, 20, 9.5, 7, SAIL_W, o.f);
    pennant(sc, 1, 22.5, o.f, 6);
    shrouds(sc, BOAT, 1, 19, [BOAT.L * 0.5, 0, BOAT.rail(1)]);
    sc.line([1, 0, 21], [-BOAT.L * 0.5 + 0.5, 0, BOAT.rail(0)]);
    // oars shipped along the rails, blades aft
    for (const sg of [1, -1]) {
      const w = halfBeam(BOAT, 0.5);
      sc.cylinder(
        [7, sg * (w - 0.2), BOAT.rail(0.6) + 0.5],
        [-7, sg * (w + 0.4), BOAT.rail(0.35) + 0.5],
        0.32,
        WOOD,
        0.35,
      );
      sc.box([-8, sg * (w + 0.5), BOAT.rail(0.3) + 0.5], [2.6, 0.3, 1.1], (k) =>
        ramp(WOOD, 0.3 + k * 0.45),
      );
    }
    // a crate and a barrel on deck
    const dz = BOAT.rail(0.6) - BOAT.bulwark;
    sc.box([5.5, 1.3, dz + 0.8], [2, 2, 1.6], (k, face) =>
      mul(ramp(WOOD, face === 0 ? 0.75 : 0.5), 0.5 + k * 0.5),
    );
    sc.cylinder(
      [-4, -1.2, BOAT.rail(0.36) - BOAT.bulwark],
      [-4, -1.2, BOAT.rail(0.36) - BOAT.bulwark + 1.8],
      0.95,
      WOOD,
      0.1,
    );
    sc.disc([-4, -1.2, BOAT.rail(0.36) - BOAT.bulwark + 1.8], 0.95, (k) =>
      ramp(WOOD, 0.4 + k * 0.3),
    );
    // stern lantern
    sc.sphere([BOAT.L * -0.5 + 0.8, 0, BOAT.rail(0) + 1.4], 0.8, (_k, facing) =>
      lerp(GLASS[1], GLASS[2], facing),
    );
    sc.cylinder(
      [BOAT.L * -0.5 + 0.8, 0, BOAT.rail(0)],
      [BOAT.L * -0.5 + 0.8, 0, BOAT.rail(0) + 0.8],
      0.25,
      WOOD,
    );
  } else {
    hull(sc, BATTLESHIP, true, o.f);
    mast(sc, -5, 3, 31, 1);
    mast(sc, 8, 4, 27, 0.95);
    // courses furled so the deck shows; topsails and topgallants set
    furled(sc, -5, 14, 10.5, SAIL_D);
    sail(sc, -5, 23.5, 15.5, 9.5, SAIL_D, o.f);
    sail(sc, -5, 29.5, 24.5, 6.5, SAIL_D, o.f + 1);
    furled(sc, 8, 12.5, 9.5, SAIL_D);
    sail(sc, 8, 21, 14, 8.5, SAIL_D, o.f + 1);
    sail(sc, 8, 26, 22, 5.6, SAIL_D, o.f);
    pennant(sc, -5, 31.5, o.f, 7.5);
    // fighting top on the mainmast
    sc.disc([-5, 0, 16.2], 1.9, (k) => ramp(MAST, 0.35 + k * 0.4));
    sc.cylinder([-5, 0, 15.6], [-5, 0, 16.2], 1.9, MAST, 0);
    // rigging
    const bs: P3 = [BATTLESHIP.L * 0.5 + 4, 0, BATTLESHIP.rail(1) + 3];
    shrouds(sc, BATTLESHIP, -5, 28, [8, 0, 26]);
    shrouds(sc, BATTLESHIP, 8, 25, bs);
    sc.line([-5, 0, 30], [-BATTLESHIP.L * 0.5 + 1, 0, BATTLESHIP.rail(0)]);
    // stern lanterns
    for (const sg of [1, -1]) {
      const p: P3 = [
        -BATTLESHIP.L * 0.5 + 0.6,
        sg * halfBeam(BATTLESHIP, 0) * 0.8,
        BATTLESHIP.rail(0) + 1.2,
      ];
      sc.cylinder([p[0], p[1], p[2] - 1.2], [p[0], p[1], p[2] - 0.6], 0.2, MAST);
      sc.sphere(p, 0.75, (_k, facing) => lerp(GLASS[1], GLASS[2], facing));
    }
    // bowsprit
    sc.cylinder(
      [BATTLESHIP.L * 0.5 - 2, 0, BATTLESHIP.rail(1) - 0.5],
      [BATTLESHIP.L * 0.5 + 4, 0, BATTLESHIP.rail(1) + 3],
      0.45,
      WOOD,
      0.15,
    );
    if (o.fire) {
      for (const gx of [-10, -3.5, 3, 9.5]) {
        for (const sg of [1, -1]) {
          const w = halfWidth(BATTLESHIP, gx / BATTLESHIP.L + 0.5, 4.2);
          const ph = o.fireFrame ?? 1;
          const out = [2.4, 3.8, 5][ph - 1] ?? 5,
            r = [1.8, 2.5, 2.2][ph - 1] ?? 2.2;
          puff(
            sc,
            [gx + (ph - 1) * 0.6, sg * (w + out), 4.4 + (ph - 1) * 0.9],
            r,
            ph === 1,
            ph === 3,
          );
        }
      }
    }
  }
  return sc;
}

function render(ship: Ship, dir: Dir, o: Opts): Px[] {
  const sc = drawShip(ship, dir, o);
  return bake(sc);
}

// ---------- downsample, quantise, outline ----------
type Px = V3 | null;
function bake(sc: Scene): Px[] {
  const { S, W } = sc;
  const N = SIZE * SIZE;
  const out: Px[] = new Array(N).fill(null);
  const down = (L: Layer, X: number, Y: number) => {
    let r = 0,
      g = 0,
      b = 0,
      a = 0;
    for (let y = 0; y < SS; y++) {
      for (let x = 0; x < SS; x++) {
        const i = (Y * SS + y) * HW + X * SS + x;
        r += L.r[i] ?? 0;
        g += L.g[i] ?? 0;
        b += L.b[i] ?? 0;
        a += L.a[i] ?? 0;
      }
    }
    return { c: (a > 0 ? [r / a, g / a, b / a] : [0, 0, 0]) as V3, a: a / (SS * SS) };
  };
  const col: (V3 | null)[] = new Array(N).fill(null);
  const depth = new Float32Array(N).fill(1e9);
  const ropeCov = new Float32Array(N);
  for (let Y = 0; Y < SIZE; Y++) {
    for (let X = 0; X < SIZE; X++) {
      const s = down(S, X, Y);
      let dsum = 0,
        dn = 0,
        rc = 0;
      for (let y = 0; y < SS; y++) {
        for (let x = 0; x < SS; x++) {
          const i = (Y * SS + y) * HW + X * SS + x;
          const di = sc.depth[i] ?? 1e9;
          if (di < 1e8) {
            dsum += di;
            dn++;
          }
          if ((sc.rope[i] ?? 1e9) < di) {
            rc++;
          }
        }
      }
      ropeCov[Y * SIZE + X] = rc / (SS * SS);
      if (s.a >= 0.45) {
        col[Y * SIZE + X] = s.c;
        depth[Y * SIZE + X] = dsum / dn;
      }
    }
  }
  const solid = (i: number) => col[i] !== null;
  const nb = (X: number, Y: number) =>
    (
      [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const
    )
      .map(([dx, dy]): [number, number] => [X + dx, Y + dy])
      .filter(([x, y]) => x >= 0 && y >= 0 && x < SIZE && y < SIZE)
      .map(([x, y]) => y * SIZE + x);
  // shading: a darker band just inside the silhouette, and a seam on whatever lies behind a nearer part
  const SEAM = 2.2 * SCALE;
  for (let Y = 0; Y < SIZE; Y++) {
    for (let X = 0; X < SIZE; X++) {
      const i = Y * SIZE + X;
      const c = col[i];
      if (!c) {
        continue;
      }
      let k = 1;
      const ns = nb(X, Y);
      if (ns.some((j) => !solid(j))) {
        k = 0.68;
      } else if (ns.some((j) => (depth[j] ?? 1e9) < (depth[i] ?? 1e9) - SEAM)) {
        k = 0.62;
      }
      const j = (hash(X, Y, 99) - 0.5) * 14;
      out[i] = nearest([c[0] * k + j, c[1] * k + j, c[2] * k + j]);
    }
  }
  // ropes: a 1px dark line wherever they are not hidden
  for (let i = 0; i < N; i++) {
    if ((ropeCov[i] ?? 0) >= 0.12) {
      const under = out[i];
      out[i] = under ? nearest(lerp(under, ROPE, 0.75)) : ROPE;
    }
  }
  // silhouette outline
  const isOutline = new Array(N).fill(false);
  for (let Y = 0; Y < SIZE; Y++) {
    for (let X = 0; X < SIZE; X++) {
      const i = Y * SIZE + X;
      if (solid(i) || out[i]) {
        continue;
      }
      if (nb(X, Y).some((j) => solid(j))) {
        out[i] = [0, 0, 0];
        isOutline[i] = true;
      }
    }
  }
  // water under everything else; light foam kept a pixel clear of the outline
  for (let Y = 0; Y < SIZE; Y++) {
    for (let X = 0; X < SIZE; X++) {
      const i = Y * SIZE + X;
      if (out[i]) {
        continue;
      }
      const w = down(W, X, Y);
      if (w.a < 0.4) {
        continue;
      }
      const light = w.c[0] + w.c[1] + w.c[2] > 400;
      if (light && nb(X, Y).some((j) => isOutline[j])) {
        continue;
      }
      out[i] = nearest(w.c);
    }
  }
  return out;
}

// ---------- output ----------
interface Frame {
  name: string;
  px: Px[];
  ship: Ship;
  dir: Dir;
  label: string;
}
const frames: Frame[] = [];
const BODY = { boat: 55, battleship: 56 } as const;
for (const ship of ["boat", "battleship"] as Ship[]) {
  for (const dir of ["n", "s", "e", "w"] as Dir[]) {
    for (let f = 1; f <= 4; f++) {
      frames.push({
        name: `${BODY[ship]}-f${f}-${dir}`,
        px: render(ship, dir, { f, fire: false }),
        ship,
        dir,
        label: `f${f}`,
      });
    }
    if (ship === "battleship") {
      for (let ff = 1; ff <= 3; ff++) {
        frames.push({
          name: `${BODY[ship]}-fire${ff}-${dir}`,
          px: render(ship, dir, { f: 1, fire: true, fireFrame: ff }),
          ship,
          dir,
          label: `fire${ff}`,
        });
      }
    }
  }
}
const boxes = new Map<string, { x0: number; y0: number; x1: number; y1: number }>();
for (const fr of frames) {
  const k = `${fr.ship}-${fr.dir}${fr.label.startsWith("fire") ? `-${fr.label}` : ""}`;
  const b = boxes.get(k) ?? { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 };
  fr.px.forEach((c, i) => {
    if (!c) {
      return;
    }
    const x = i % SIZE,
      y = Math.floor(i / SIZE);
    b.x0 = Math.min(b.x0, x);
    b.x1 = Math.max(b.x1, x);
    b.y0 = Math.min(b.y0, y);
    b.y1 = Math.max(b.y1, y);
  });
  boxes.set(k, b);
}
mkdirSync(BODIES, { recursive: true });
/** A value that must exist, or a build error naming it. */
function must<T>(v: T | undefined, what: string): T {
  if (v === undefined) {
    throw new Error(`missing ${what}`);
  }
  return v;
}
const rendered: { fr: Frame; rgba: Rgba; regX: number; regY: number }[] = [];
for (const fr of frames) {
  const key = `${fr.ship}-${fr.dir}${fr.label.startsWith("fire") ? `-${fr.label}` : ""}`;
  const b = must(boxes.get(key), key);
  const w = b.x1 - b.x0 + 1,
    h = b.y1 - b.y0 + 1;
  const rgba = createRgba(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = fr.px[(b.y0 + y) * SIZE + b.x0 + x];
      if (!c) {
        continue;
      }
      const q = (y * w + x) * 4;
      rgba.data[q] = c[0];
      rgba.data[q + 1] = c[1];
      rgba.data[q + 2] = c[2];
      rgba.data[q + 3] = 255;
    }
  }
  const regX = RX - b.x0,
    regY = RY - b.y0;
  writeFileSync(join(BODIES, `${fr.name}.png`), encodePng(rgba));
  writeFileSync(
    join(BODIES, `${fr.name}.json`),
    `${JSON.stringify(
      {
        group: "bodies",
        regX,
        regY,
        key: "none",
        prov: "authored",
        note: `${fr.ship === "boat" ? "Boat" : "Battleship"} rider, ${{ n: "north", s: "south", e: "east", w: "west" }[fr.dir]}-facing ${fr.label.startsWith("fire") ? `broadside frame ${fr.label.slice(4)}` : `frame ${fr.label.slice(1)}`}`,
      },
      null,
      2,
    )}\n`,
  );
  rendered.push({ fr, rgba, regX, regY });
}

// Previews (a contact sheet, a preview on water, a close-up beside the airship), only on request.
if (PREVIEW) {
  writePreviews(PREVIEW);
}

function writePreviews(OUT: string) {
  mkdirSync(OUT, { recursive: true });
  const blitAt = (dst: Rgba, src: Rgba, dx: number, dy: number, scale = 1) => {
    for (let y = 0; y < src.height; y++) {
      for (let x = 0; x < src.width; x++) {
        const q = (y * src.width + x) * 4;
        if ((src.data[q + 3] ?? 0) < 128) {
          continue;
        }
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const X = dx + x * scale + sx,
              Y = dy + y * scale + sy;
            if (X < 0 || Y < 0 || X >= dst.width || Y >= dst.height) {
              continue;
            }
            const o = (Y * dst.width + X) * 4;
            dst.data[o] = src.data[q] ?? 0;
            dst.data[o + 1] = src.data[q + 1] ?? 0;
            dst.data[o + 2] = src.data[q + 2] ?? 0;
            dst.data[o + 3] = 255;
          }
        }
      }
    }
  };
  const CW = 60,
    CH = 64,
    CRX = 30,
    CRY = 36,
    cols = 7,
    rows = 8;
  const order: Dir[] = ["s", "e", "n", "w"];
  const layout = (fr: Frame) => ({
    row: (fr.ship === "boat" ? 0 : 4) + order.indexOf(fr.dir),
    col: fr.label.startsWith("fire")
      ? 3 + Number(fr.label.slice(4))
      : Number(fr.label.slice(1)) - 1,
  });
  const sheet = createRgba(cols * CW, rows * CH);
  for (const r of rendered) {
    const { row, col } = layout(r.fr);
    blitAt(sheet, r.rgba, col * CW + CRX - r.regX, row * CH + CRY - r.regY);
  }
  writeFileSync(join(OUT, "boats-sheet.png"), encodePng(sheet));
  writeFileSync(
    join(OUT, "boats-sheet.json"),
    `${JSON.stringify(
      {
        cell: { w: CW, h: CH, regX: CRX, regY: CRY },
        rows: ["55 S", "55 E", "55 N", "55 W", "56 S", "56 E", "56 N", "56 W"],
        cols: ["f1", "f2", "f3", "f4", "fire1 (56 only)", "fire2", "fire3"],
        frames: Object.fromEntries(
          rendered.map((r) => {
            const { row, col } = layout(r.fr);
            return [
              r.fr.name,
              {
                x: col * CW + CRX - r.regX,
                y: row * CH + CRY - r.regY,
                w: r.rgba.width,
                h: r.rgba.height,
                regX: r.regX,
                regY: r.regY,
              },
            ];
          }),
        ),
      },
      null,
      2,
    )}\n`,
  );

  // preview on water with references
  const A = join(ROOT, "packages/data/assets/");
  const idx = JSON.parse(readFileSync(join(A, "index.json"), "utf8"));
  const sheets: Record<string, Rgba> = {};
  const sprite = (atlas: string, name: string) => {
    const s = idx.atlases[atlas].sprites[name];
    const f = idx.atlases[atlas].sheets[s[0]];
    sheets[f] ??= decodePng(new Uint8Array(readFileSync(join(A, f))));
    const src = sheets[f];
    const out = createRgba(s[3], s[4]);
    for (let y = 0; y < s[4]; y++) {
      for (let x = 0; x < s[3]; x++) {
        for (let c = 0; c < 4; c++) {
          out.data[(y * s[3] + x) * 4 + c] =
            src.data[((s[2] + y) * src.width + s[1] + x) * 4 + c] ?? 0;
        }
      }
    }
    return { img: out, regX: s[5], regY: s[6] };
  };
  const SC = 3,
    PW = cols * CW * SC,
    PH = (rows * CH + 80) * SC;
  const prev = createRgba(PW, PH);
  const water = sprite("tiles", "n1").img;
  for (let ty = 0; ty < PH / SC; ty += 32) {
    for (let tx = 0; tx < PW / SC; tx += 32) {
      blitAt(prev, water, tx * SC, ty * SC, SC);
    }
  }
  for (const r of rendered) {
    const { row, col } = layout(r.fr);
    blitAt(prev, r.rgba, (col * CW + CRX - r.regX) * SC, (row * CH + CRY - r.regY) * SC, SC);
  }
  const refs: [string, string][] = [
    ["bodies", "57-f2-e"],
    ["bodies", "57-f1-s"],
    ["items", "boatpic"],
    ["items", "battleshippic"],
    ["bodies", "200-f1-s"],
  ];
  refs.forEach(([a, n], i) => {
    const s = sprite(a, n);
    blitAt(
      prev,
      s.img,
      (i * CW + CRX - (a === "items" ? 16 : s.regX)) * SC,
      (rows * CH + 40 - (a === "items" ? 24 : s.regY)) * SC,
      SC,
    );
  });
  writeFileSync(join(OUT, "boats-preview.png"), encodePng(prev));
  // close-up of frame 1 per ship/direction next to the airship
  const pick = ["55-f1-s", "55-f1-e", "55-f1-n", "56-f1-s", "56-f1-e", "56-f1-n"].map((n) =>
    must(
      rendered.find((r) => r.fr.name === n),
      n,
    ),
  );
  const airE = sprite("bodies", "57-f2-e"),
    airS = sprite("bodies", "57-f1-s");
  const items = [{ img: airS.img }, { img: airE.img }, ...pick.map((p) => ({ img: p.rgba }))];
  const Z = 6,
    cw = items.reduce((a, i) => a + i.img.width + 3, 0),
    ch = Math.max(...items.map((i) => i.img.height));
  const zoom = createRgba(cw * Z, ch * Z);
  for (let p = 0; p < zoom.data.length; p += 4) {
    zoom.data[p] = 40;
    zoom.data[p + 1] = 80;
    zoom.data[p + 2] = 140;
    zoom.data[p + 3] = 255;
  }
  let zx = 0;
  for (const i of items) {
    blitAt(zoom, i.img, zx * Z, (ch - i.img.height) * Z, Z);
    zx += i.img.width + 3;
  }
  writeFileSync(join(OUT, "boats-closeup.png"), encodePng(zoom));
  // water test: frame 1 of every ship/direction on the lake tile (N1) and the sea tile (W1)
  {
    const names = [
      "55-f1-n",
      "55-f1-e",
      "55-f1-s",
      "55-f1-w",
      "56-f1-n",
      "56-f1-e",
      "56-f1-s",
      "56-f1-w",
    ];
    const Z = 3,
      cw = 64,
      ch = 64,
      img = createRgba(names.length * cw * Z, 2 * ch * Z);
    ["n1", "w1"].forEach((t, row) => {
      const tile = sprite("tiles", t).img;
      for (let ty = 0; ty < ch; ty += 32) {
        for (let tx = 0; tx < names.length * cw; tx += 32) {
          blitAt(img, tile, tx * Z, (row * ch + ty) * Z, Z);
        }
      }
      names.forEach((n, i) => {
        const r = must(
          rendered.find((q) => q.fr.name === n),
          n,
        );
        blitAt(img, r.rgba, (i * cw + 32 - r.regX) * Z, (row * ch + 26 - r.regY) * Z, Z);
      });
    });
    writeFileSync(join(OUT, "boats-water-test.png"), encodePng(img));
  }
}

console.log([...boxes].map(([k, b]) => `${k} ${b.x1 - b.x0 + 1}x${b.y1 - b.y0 + 1}`).join(", "));
