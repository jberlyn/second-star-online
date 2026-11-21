/**
 * The Battleship's cannonball: a shaded iron ball after the 1.6 `Cannonball` bag icon, smaller,
 * with a casting seam and pits that turn frame to frame so the shot spins instead of gliding.
 * `bun packages/data/build/art/cannonball.ts [--preview <dir>]` writes, with their sidecars:
 *
 * - `assets/added/fx/CannonballShot<L|R|U|D>-<1..4>.png`: the 11 px shot with its shadow on the
 *   water, the frames the `CannonballShot<dir>` FX cycles through;
 * - `assets/added/items/CannonballBag.png`: the 13 px picture the `Cannonball` item shows (the 1.6
 *   member stays in the items atlas, unused).
 *
 * Then run `bun run data:build`. `--preview` also writes a 6x preview sheet there. The light falls
 * from the upper left, as on the ships.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createRgba, decodePng, encodePng } from "../assets-lib/png.ts";

const ROOT = join(import.meta.dir, "../../../..");
const FX = join(ROOT, "assets/added/fx");
const ITEMS = join(ROOT, "assets/added/items");
const previewAt = process.argv.indexOf("--preview");
const OUT = previewAt > 0 ? process.argv[previewAt + 1] : null;
if (previewAt > 0 && !OUT) {
  throw new Error("usage: bun packages/data/build/art/cannonball.ts [--preview <dir>]");
}
mkdirSync(FX, { recursive: true });
mkdirSync(ITEMS, { recursive: true });
type V = [number, number, number];
const icon = decodePng(
  new Uint8Array(
    readFileSync(
      join(import.meta.dir, "../../../../assets/original/main/bitmaps/372516_Cannonball.png"),
    ),
  ),
);
// Palette: the icon's own colours (minus its background grey).
const bg = [icon.data[0], icon.data[1], icon.data[2]].join();
const pal: V[] = [];
for (let q = 0; q < icon.data.length; q += 4) {
  const c: V = [icon.data[q] ?? 0, icon.data[q + 1] ?? 0, icon.data[q + 2] ?? 0];
  if (c.join() !== bg && !pal.some((p) => p.join() === c.join())) {
    pal.push(c);
  }
}
const snap = (c: V): V =>
  pal.reduce(
    (b, p) => {
      const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
      return d < b[0] ? ([d, p] as [number, V]) : b;
    },
    [1e9, pal[0]] as [number, V],
  )[1];
// Seeded pits fixed on the ball.
let seed = 7;
const rnd = () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};
const pits: { n: V; r: number; k: number }[] = [];
for (let i = 0; i < 7; i++) {
  const z = rnd() * 2 - 1,
    t = rnd() * Math.PI * 2,
    s = Math.sqrt(1 - z * z);
  pits.push({
    n: [s * Math.cos(t), s * Math.sin(t), z],
    r: 0.22 + rnd() * 0.14,
    k: 0.35 + rnd() * 0.25,
  });
}
const L = (() => {
  const l: V = [-0.45, -0.6, 0.66];
  const m = Math.hypot(...l);
  return l.map((x) => x / m) as V;
})();
const H = (() => {
  const h: V = [L[0], L[1], L[2] + 1];
  const m = Math.hypot(...h);
  return h.map((x) => x / m) as V;
})();
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function rot(n: V, axis: "z" | "x", a: number): V {
  const c = Math.cos(a),
    s = Math.sin(a);
  return axis === "z"
    ? [n[0] * c - n[1] * s, n[0] * s + n[1] * c, n[2]]
    : [n[0], n[1] * c - n[2] * s, n[1] * s + n[2] * c];
}
/** One frame: ball of diameter D (outline included) with a shadow `sh` px below, or none. */
function ball(D: number, axis: "z" | "x", ang: number, sh: number) {
  const SS = 6,
    W = D,
    Hh = D + sh,
    R = (D - 2) / 2,
    cx = D / 2,
    cy = D / 2;
  const img = createRgba(W, Hh);
  const _inside = (x: number, y: number) => Math.hypot(x - cx, y - cy) <= R + 0.5;
  for (let y = 0; y < Hh; y++) {
    for (let x = 0; x < W; x++) {
      const q = (y * W + x) * 4;
      let acc: V = [0, 0, 0],
        cov = 0;
      for (let a = 0; a < SS; a++) {
        for (let b = 0; b < SS; b++) {
          const px = x + (b + 0.5) / SS,
            py = y + (a + 0.5) / SS,
            nx = (px - cx) / R,
            ny = (py - cy) / R,
            rr = nx * nx + ny * ny;
          if (rr > 1) {
            continue;
          }
          const n: V = [nx, ny, Math.sqrt(1 - rr)];
          const obj = rot(n, axis, -ang);
          // Texture symmetric under a half turn about the spin axis, so 4 frames of 45 deg loop.
          const twin = rot(obj, axis, Math.PI);
          let pit = 0;
          for (const o of [obj, twin]) {
            for (const p of pits) {
              const d = Math.acos(Math.min(1, dot(o, p.n)));
              if (d < p.r) {
                pit = Math.max(pit, p.k * (1 - d / p.r));
              }
            }
          }
          // Casting seam: a great circle through the spin axis (y=0 plane for z spin, z=0... for x spin).
          const seamD = Math.abs(axis === "z" ? obj[1] : obj[2]);
          if (seamD < 0.2) {
            pit = Math.max(pit, 0.85 * (1 - seamD / 0.2));
          }
          const diff = Math.max(0, dot(n, L)),
            spec = Math.max(0, dot(n, H)) ** 18;
          let v = 0.2 + 0.62 * diff + 0.55 * spec * (1 - pit);
          v *= 1 - 0.55 * pit;
          v *= 0.92 + 0.16 * rnd(); // grain
          const g = Math.max(0, Math.min(255, v * 235));
          acc = [acc[0] + g * 0.97, acc[1] + g * 0.98, acc[2] + g * 1.03];
          cov++;
        }
      }
      if (cov / (SS * SS) >= 0.45) {
        const c = snap(acc.map((t) => t / cov) as V);
        img.data.set([c[0], c[1], c[2], 255], q);
      }
    }
  }
  // Silhouette outline.
  const solid = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < W && y < Hh && img.data[(y * W + x) * 4 + 3] === 255;
  const edge: number[] = [];
  for (let y = 0; y < Hh; y++) {
    for (let x = 0; x < W; x++) {
      if (
        !solid(x, y) &&
        (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))
      ) {
        edge.push((y * W + x) * 4);
      }
    }
  }
  for (const q of edge) {
    img.data.set([0, 0, 0, 255], q);
  }
  // Shadow on the water below the ball.
  if (sh > 0) {
    const sy = cy + sh,
      rx = R * 0.9,
      ry = R * 0.45;
    for (let y = 0; y < Hh; y++) {
      for (let x = 0; x < W; x++) {
        const q = (y * W + x) * 4;
        if (img.data[q + 3]) {
          continue;
        }
        if (((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - sy) / ry) ** 2 <= 1) {
          img.data.set([8, 16, 60, 110], q);
        }
      }
    }
  }
  return img;
}
const FR = 4,
  dirs = { L: ["z", -1], R: ["z", 1], U: ["x", 1], D: ["x", -1] } as const;
const frames: { name: string; img: ReturnType<typeof createRgba> }[] = [];
for (const [d, [axis, sgn]] of Object.entries(dirs)) {
  for (let f = 0; f < FR; f++) {
    frames.push({
      name: `CannonballShot${d}-${f + 1}`,
      img: ball(11, axis, (sgn * f * Math.PI) / FR, 8),
    });
  }
}
const iconImg = ball(13, "z", 0.4, 0);
const sidecar = (group: string, regX: number, regY: number, note: string) =>
  `${JSON.stringify({ group, regX, regY, key: "none", prov: "authored", note }, null, 2)}\n`;
const WORD = { L: "west", R: "east", U: "north", D: "south" } as Record<string, string>;
// The ball's centre sits 6 px below the FX loc, the height a Battleship rider's loc is drawn at
// (cannon.ts `cannonballTile`), with its shadow on the water below.
for (const f of frames) {
  const [, d, n] = /^CannonballShot(.)-(\d)$/.exec(f.name) ?? [];
  writeFileSync(join(FX, `${f.name}.png`), encodePng(f.img));
  writeFileSync(
    join(FX, `${f.name}.json`),
    sidecar("fx", 5, -1, `Battleship cannonball flying ${WORD[d ?? ""]}, spin frame ${n}`),
  );
}
// Centred where the 1.6 icon's ball is centred, 3 px left of and 15 px below its regpoint.
writeFileSync(join(ITEMS, "CannonballBag.png"), encodePng(iconImg));
writeFileSync(
  join(ITEMS, "CannonballBag.json"),
  sidecar("items", 9, -9, "Cannonball, a 13 px version of the 1.6 bag icon (cannonball.ts)"),
);
if (OUT) {
  writePreview(OUT);
}

function writePreview(OUT: string) {
  mkdirSync(OUT, { recursive: true });
  // Preview sheet at 6x on sea blue: rows per direction, plus icons old/new.
  const SC = 6,
    CW = 20,
    rows = 5,
    cols = FR + 1;
  const sheet = createRgba(cols * CW * SC, rows * CW * SC);
  for (let p = 0; p < sheet.data.length; p += 4) {
    sheet.data.set([24, 52, 150, 255], p);
  }
  const put = (im: { width: number; height: number; data: Uint8Array }, cx: number, cy: number) => {
    for (let y = 0; y < im.height; y++) {
      for (let x = 0; x < im.width; x++) {
        const q = (y * im.width + x) * 4,
          a = (im.data[q + 3] ?? 0) / 255;
        if (!a) {
          continue;
        }
        for (let i = 0; i < SC; i++) {
          for (let j = 0; j < SC; j++) {
            const d = (((cy + y) * SC + i) * sheet.width + (cx + x) * SC + j) * 4;
            for (let k = 0; k < 3; k++) {
              sheet.data[d + k] = (sheet.data[d + k] ?? 0) * (1 - a) + (im.data[q + k] ?? 0) * a;
            }
          }
        }
      }
    }
  };
  Object.keys(dirs).forEach((_d, r) => {
    for (let f = 0; f < FR; f++) {
      const fr = frames[r * FR + f];
      if (fr) {
        put(fr.img, f * CW + 4, r * CW + 2);
      }
    }
  });
  // Last row: the 1.6 icon (bg keyed) then the new icon.
  const keyed = createRgba(icon.width, icon.height);
  for (let q = 0; q < icon.data.length; q += 4) {
    if ([icon.data[q], icon.data[q + 1], icon.data[q + 2]].join() !== bg) {
      keyed.data.set([icon.data[q] ?? 0, icon.data[q + 1] ?? 0, icon.data[q + 2] ?? 0, 255], q);
    }
  }
  put(keyed, 0 * CW + 0, 4 * CW + 0);
  put(iconImg, 1 * CW + 4, 4 * CW + 4);
  writeFileSync(join(OUT, "icon16-keyed.png"), encodePng(keyed));
  writeFileSync(join(OUT, "cannonball-preview.png"), encodePng(sheet));
}
