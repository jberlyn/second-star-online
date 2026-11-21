/**
 * The Boat (55) and Battleship (56) rider frames, built from 1.6's docked `BoatPic` and
 * `BattleshipPic` so a ship looks the same parked and ridden, as 1.6's Airship rider frames reuse
 * its `AirshipPic` hull. `bun packages/data/build/art/ships.ts [--preview <dir>]` writes
 * `assets/added/bodies/5{5,6}-*.png` with their sidecars; then run `bun run data:build`.
 *
 * - East is the docked sprite, west its mirror.
 * - North and south are cut from the docked sprite's own pixels, so no colour or texture is
 *   invented: its deck, read across and turned so the planks run fore and aft, is the deck seen
 *   from above; a short band of its hull planking is the stern (north) or, tapered, the bow's V
 *   (south); its sail columns, mirrored, are the sail face on (darker from behind). The waterline
 *   sits on the docked sprite's water row.
 * - F1-F4 are the swell the client holds 0.4 s each: the hull dips 1 px on F3 and F4 while the wake
 *   stays put and shimmers on F2 and F4.
 * - The Battleship's `fire1-3` frames add a broadside of smoke along its sides to F1.
 *
 * Every frame is drawn on the docked picture's 32 px grid, so the east frames land on the docked
 * ship's pixels; the client also draws a parked ship with them, so it bobs at its mooring.
 * `--preview` writes a 6x contact sheet.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createRgba, decodePng, encodePng, type Rgba } from "../assets-lib/png.ts";

const ROOT = join(import.meta.dir, "../../../..");
const BMP = join(ROOT, "assets/original/main/bitmaps");
const BODIES = join(ROOT, "assets/added/bodies");
const previewAt = process.argv.indexOf("--preview");
const PREVIEW = previewAt > 0 ? process.argv[previewAt + 1] : null;
if (previewAt > 0 && !PREVIEW) {
  throw new Error("usage: bun packages/data/build/art/ships.ts [--preview <dir>]");
}

const T = 32;
/**
 * The rider's registration point in the frame's 32 px grid. The rider's point is (16, -2) from its
 * tile's top left (`walkerPixel`), and 1.6 pastes a ground picture at (1, 1) of the tile
 * (`groundPictureTopLeft`), so the grid starts 1 px right of and below the tile: the docked ship
 * and the boarded one land on the same pixels.
 */
const REG_X = 15;
const REG_Y = -3;

type Px = readonly [number, number, number];
type Grid = (Px | null)[][];
type Dir = "n" | "s" | "e" | "w";

const isBlack = (p: Px | null) => p !== null && p[0] < 20 && p[1] < 20 && p[2] < 20;
const blank = (): Grid => Array.from({ length: T }, () => Array<Px | null>(T).fill(null));

/** A docked sprite as a grid, its green key transparent. */
function docked(file: string): Grid {
  const im = decodePng(new Uint8Array(readFileSync(join(BMP, file))));
  return Array.from({ length: im.height }, (_, y) =>
    Array.from({ length: im.width }, (_, x): Px | null => {
      const q = (y * im.width + x) * 4;
      const p: Px = [im.data[q] ?? 0, im.data[q + 1] ?? 0, im.data[q + 2] ?? 0];
      const keyed = p[0] === 0 && p[1] === 255 && p[2] === 0;
      return (im.data[q + 3] ?? 0) === 0 || keyed ? null : p;
    }),
  );
}
const at = (g: Grid, x: number, y: number): Px | null => g[y]?.[x] ?? null;
const cut = (g: Grid, x: number, y: number, w: number, h: number): Grid =>
  Array.from({ length: h }, (_, r) => Array.from({ length: w }, (_, c) => at(g, x + c, y + r)));
/**
 * Each row's non-black pixels from x to x+span (skipping the columns in `skip`), packed left and
 * cut to w: the docked hull's bands without the rigging and shadow that a straight cut would
 * mirror into shapes.
 */
function bands(g: Grid, x: number, y: number, w: number, h: number, span: number, skip: Skip) {
  return Array.from({ length: h }, (_, r) => {
    const row: Px[] = [];
    for (let c = x; c < x + span; c++) {
      const p = at(g, c, y + r);
      if (c >= skip[0] && c < skip[1]) {
        continue;
      }
      if (p && !isBlack(p)) {
        row.push(p);
      }
    }
    return Array.from({ length: w }, (_, i) => row[Math.min(i, row.length - 1)] ?? null);
  });
}
type Skip = readonly [number, number];
/** The piece and its mirror side by side. */
const mirrorJoin = (g: Grid): Grid => g.map((row) => [...row, ...[...row].reverse()]);
const mirror = (g: Grid): Grid => g.map((row) => [...row].reverse());
const transpose = (g: Grid): Grid => (g[0] ?? []).map((_, c) => g.map((row) => row[c] ?? null));
const shade = (g: Grid, k: number): Grid =>
  g.map((row) => row.map((p) => (p ? ([p[0] * k, p[1] * k, p[2] * k] as const) : null)));
/** Each row resampled to width(r), symmetric about the centre (nearest, never doubling a pixel). */
function taper(g: Grid, width: (r: number) => number): Grid {
  const W = g[0]?.length ?? 0;
  return g.map((row, r) => {
    const w = Math.max(2, Math.round(width(r)));
    const out = Array<Px | null>(W).fill(null);
    const x0 = Math.floor((W - w) / 2);
    const half = w / 2;
    for (let i = 0; i < w; i++) {
      const t = i < half ? i / half : (w - 1 - i) / half;
      const src = Math.min(W / 2 - 1, Math.round(t * (W / 2 - 1)));
      out[x0 + i] = (i < half ? row[src] : row[W - 1 - src]) ?? null;
    }
    return out;
  });
}
function paste(dst: Grid, g: Grid, x: number, y: number) {
  g.forEach((row, r) => {
    row.forEach((p, c) => {
      const line = dst[y + r];
      if (p && line && x + c >= 0 && x + c < T) {
        line[x + c] = p;
      }
    });
  });
}
const centred = (g: Grid) => T / 2 - Math.floor((g[0]?.length ?? 0) / 2);
const BLACK: Px = [0, 0, 0];
/** A 1 px black outline round the silhouette, as the docked art has. */
function outline(g: Grid): Grid {
  const o = g.map((r) => [...r]);
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      if (at(g, x, y)) {
        continue;
      }
      const edge = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].some(([dx = 0, dy = 0]) => {
        const p = at(g, x + dx, y + dy);
        return p !== null && !isBlack(p);
      });
      const line = o[y];
      if (edge && line) {
        line[x] = BLACK;
      }
    }
  }
  return o;
}

interface Spec {
  file: string;
  /** The left half of the sail, read from the docked sprite. */
  sail: { x: number; y: number; w: number; h: number };
  /** Hull planking below the rail, read across: the stern face and the bow's V. */
  hull: { x: number; y: number; w: number; h: number; span: number; skip: Skip };
  /** Deck, read across and turned so its planks run fore and aft. */
  deck: { x: number; y: number; w: number; h: number; span: number; skip: Skip };
  /** The docked sprite's water row and the half-width of water taken from it. */
  waterY: number;
  waterW: number;
  /** How far down the deck the sail stands, 0 at the far end and 1 at the near end. */
  sailFoot: number;
}

const BOAT: Spec = {
  file: "319491_BoatPic.png",
  sail: { x: 12, y: 5, w: 4, h: 13 },
  hull: { x: 1, y: 21, w: 8, h: 7, span: 26, skip: [0, 0] },
  deck: { x: 3, y: 13, w: 9, h: 8, span: 9, skip: [0, 0] },
  waterY: 28,
  waterW: 9,
  sailFoot: 0.4,
};
const BATTLESHIP: Spec = {
  file: "319492_BattleshipPic.png",
  sail: { x: 11, y: 3, w: 4, h: 16 },
  hull: { x: 1, y: 21, w: 9, h: 8, span: 28, skip: [10, 16] },
  deck: { x: 1, y: 20, w: 9, h: 9, span: 26, skip: [9, 18] },
  waterY: 29,
  waterW: 10,
  sailFoot: 0.4,
};

/** The four still views of a ship, on its tile. */
function views(s: Spec): Record<Dir, Grid> {
  const src = docked(s.file);
  // Wood showing beside the sail takes the sail pixel next to it.
  const sailCut = cut(src, s.sail.x, s.sail.y, s.sail.w, s.sail.h).map((row) =>
    row.map((p, i) => {
      if (isBlack(p)) {
        return null;
      }
      return p && p[0] > p[2] + 40 && p[0] > p[1] + 20 ? (row[i + 1] ?? p) : p;
    }),
  );
  const sail = mirrorJoin(sailCut);
  // Round the sail's top corners.
  sail[0] = (sail[0] ?? []).map((p, i, a) => (i === 0 || i === a.length - 1 ? null : p));
  const h = s.hull;
  const face = mirrorJoin(bands(src, h.x, h.y, h.w, h.h, h.span, h.skip));
  const d = s.deck;
  const deck = mirrorJoin(transpose(bands(src, d.x, d.y, d.w, d.h, d.span, d.skip)));
  const water = mirrorJoin(cut(src, 1, s.waterY, s.waterW, 1));
  const W = face[0]?.length ?? 0;
  const FH = face.length;
  const DH = deck.length;
  const faceY = s.waterY - FH;
  const deckY = faceY - DH;
  const sailY = deckY + Math.round(DH * s.sailFoot) - sail.length;

  // North: the stern toward the camera, the deck narrowing to the bow above it.
  const n = blank();
  const nDeck = taper(deck, (r) => W * Math.min(1, 0.3 + 1.1 * Math.sqrt(r / (DH - 1))));
  paste(n, nDeck, centred(nDeck), deckY);
  paste(n, shade(sail, 0.82), centred(sail), sailY);
  paste(n, face, centred(face), faceY);
  const north = outline(n);
  paste(north, water, centred(water), s.waterY);

  // South: the bow toward the camera, the deck from the flat stern down to the bow's V.
  const so = blank();
  const sDeck = taper(deck, (r) => W * (0.78 + 0.22 * (r / (DH - 1))));
  const sFace = taper(face, (r) => W * (1 - 0.75 * (r / (FH - 1)) ** 1.3));
  paste(so, sDeck, centred(sDeck), deckY);
  paste(so, sail, centred(sail), sailY);
  paste(so, sFace, centred(sFace), faceY);
  const south = outline(so);
  const bowWater = taper(water, () => W * 0.45);
  paste(south, bowWater, centred(bowWater), s.waterY);

  return { n: north, s: south, e: src, w: mirror(src) };
}

/**
 * Water and wake: the blues and the purple waterline of the docked sprites, from row `WAKE_ROW`
 * down. The sails use some of the same pale blues higher up.
 */
const WAKE_ROW = 24;
const WATER = new Set(
  [
    [179, 190, 236],
    [104, 128, 233],
    [0, 32, 178],
    [0, 16, 87],
    [89, 116, 232],
    [48, 75, 194],
    [0, 11, 61],
    [149, 165, 235],
    [134, 153, 234],
    [164, 178, 236],
    [209, 215, 238],
    [89, 43, 133],
    [93, 33, 95],
  ].map((c) => c.join()),
);
const isWater = (p: Px | null, y: number) => y >= WAKE_ROW && p !== null && WATER.has(p.join());

/** Swell frame f (1-4): the hull dips 1 px on F3 and F4; the wake shimmers on F2 and F4. */
function swell(g: Grid, f: number): Grid {
  const o = blank();
  const bob = f >= 3 ? 1 : 0;
  g.forEach((row, y) => {
    row.forEach((p, x) => {
      if (!isWater(p, y)) {
        return;
      }
      const sx = f % 2 === 0 ? x + (y % 2 ? 1 : -1) : x;
      const line = o[y];
      if (line && sx >= 0 && sx < T) {
        line[sx] = p;
      }
    });
  });
  g.forEach((row, y) => {
    row.forEach((p, x) => {
      const line = o[y + bob];
      if (p && !isWater(p, y) && line) {
        line[x] = p;
      }
    });
  });
  return o;
}

// ---------- the Battleship's broadside ----------
const SMOKE: Px[] = [
  [250, 250, 250],
  [224, 224, 224],
  [192, 192, 192],
  [160, 160, 160],
];
const FLASH: Px[] = [
  [255, 255, 255],
  [210, 205, 47],
  [207, 161, 57],
];
/** Smoke puffs (outlined discs, lit from the upper left) for broadside frame 1-3. */
function broadside(g: Grid, dir: Dir, ph: number): Grid {
  const o = g.map((r) => [...r]);
  const r = [1.6, 2.4, 2.6][ph - 1] ?? 2.4;
  const puffs: [number, number][] =
    dir === "e" || dir === "w"
      ? [7, 12, 17, 22].map((x) => [dir === "e" ? x : T - 1 - x, 25 - (ph - 1) * 0.5])
      : [19, 24].flatMap((y): [number, number][] => [
          [6 - (ph - 1) * 0.5, y],
          [T - 7 + (ph - 1) * 0.5, y],
        ]);
  const set = (x: number, y: number, p: Px) => {
    const line = o[y];
    if (line && x >= 0 && x < T) {
      line[x] = p;
    }
  };
  // Outlines first, so neighbouring puffs merge into one cloud.
  for (const pass of ["ring", "fill"] as const) {
    for (const [cx, cy] of puffs) {
      const R = pass === "ring" ? r + 1 : r;
      for (let y = Math.floor(cy - R); y <= Math.ceil(cy + R); y++) {
        for (let x = Math.floor(cx - R); x <= Math.ceil(cx + R); x++) {
          const dx = x - cx;
          const dy = y - cy;
          const dist = Math.hypot(dx, dy);
          if (dist > R) {
            continue;
          }
          if (pass === "ring") {
            set(x, y, BLACK);
            continue;
          }
          const lit = (-dx - dy) / (R * 1.4) + 0.5;
          let p = SMOKE[Math.max(0, Math.min(3, Math.round((1 - lit) * 3)))] ?? BLACK;
          if (ph === 1 && dist < r * 0.6) {
            p = FLASH[Math.min(2, Math.floor(dist * 2))] ?? p;
          }
          // The last frame thins out: every other pixel of the cloud's lower half shows through.
          if (ph === 3 && dy > 0 && (x + y) % 2 === 0) {
            const under = g[y]?.[x] ?? null;
            if (under) {
              set(x, y, under);
              continue;
            }
          }
          set(x, y, p);
        }
      }
    }
  }
  return o;
}

// ---------- output ----------
interface Frame {
  name: string;
  grid: Grid;
  note: string;
}
const FACING: Record<Dir, string> = { n: "north", s: "south", e: "east", w: "west" };
const frames: Frame[] = [];
for (const [body, noun, spec] of [
  [55, "Boat", BOAT],
  [56, "Battleship", BATTLESHIP],
] as const) {
  const v = views(spec);
  for (const dir of ["n", "s", "e", "w"] as const) {
    for (let f = 1; f <= 4; f++) {
      frames.push({
        name: `${body}-f${f}-${dir}`,
        grid: swell(v[dir], f),
        note: `${noun} rider, ${FACING[dir]}-facing swell frame ${f}, from the docked ${noun}Pic`,
      });
    }
    if (body === 56) {
      for (let ph = 1; ph <= 3; ph++) {
        frames.push({
          name: `${body}-fire${ph}-${dir}`,
          grid: broadside(v[dir], dir, ph),
          note: `${noun} rider, ${FACING[dir]}-facing broadside frame ${ph}`,
        });
      }
    }
  }
}

/**
 * The frame trimmed to its pixels, with the registration point moved to match. The top is padded
 * up to the registration point, 2 px above the tile, so the frame's rect holds it as every body's
 * does: the server tests spell and arrow hits against these rects, and a shot aimed at the
 * rider's tile aims there.
 */
function trimmed(g: Grid): { img: Rgba; regX: number; regY: number } {
  let x0 = T;
  let y0 = T;
  let x1 = -1;
  let y1 = -1;
  g.forEach((row, y) => {
    row.forEach((p, x) => {
      if (p) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    });
  });
  y0 = Math.min(y0, REG_Y);
  const img = createRgba(x1 - x0 + 1, y1 - y0 + 1);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const p = at(g, x, y);
      if (!p) {
        continue;
      }
      const q = ((y - y0) * img.width + (x - x0)) * 4;
      img.data[q] = Math.round(p[0]);
      img.data[q + 1] = Math.round(p[1]);
      img.data[q + 2] = Math.round(p[2]);
      img.data[q + 3] = 255;
    }
  }
  return { img, regX: REG_X - x0, regY: REG_Y - y0 };
}

mkdirSync(BODIES, { recursive: true });
for (const fr of frames) {
  const { img, regX, regY } = trimmed(fr.grid);
  writeFileSync(join(BODIES, `${fr.name}.png`), encodePng(img));
  const sidecar = { group: "bodies", regX, regY, key: "none", prov: "authored", note: fr.note };
  writeFileSync(join(BODIES, `${fr.name}.json`), `${JSON.stringify(sidecar, null, 2)}\n`);
}

if (PREVIEW) {
  // A contact sheet at 6x on 1.6's W1 water: rows 55 S E N W, 56 S E N W; columns F1-F4, fire1-3.
  const Z = 6;
  const water = decodePng(new Uint8Array(readFileSync(join(BMP, "408439_W1.png"))));
  const order: Dir[] = ["s", "e", "n", "w"];
  const sheet = createRgba(7 * T * Z, 8 * T * Z);
  const put = (x: number, y: number, rgb: readonly number[]) => {
    for (let sy = 0; sy < Z; sy++) {
      for (let sx = 0; sx < Z; sx++) {
        const q = ((y * Z + sy) * sheet.width + x * Z + sx) * 4;
        sheet.data[q] = rgb[0] ?? 0;
        sheet.data[q + 1] = rgb[1] ?? 0;
        sheet.data[q + 2] = rgb[2] ?? 0;
        sheet.data[q + 3] = 255;
      }
    }
  };
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 7; col++) {
      for (let y = 0; y < T; y++) {
        for (let x = 0; x < T; x++) {
          const q = (y * water.width + x) * 4;
          const rgb = [water.data[q] ?? 0, water.data[q + 1] ?? 0, water.data[q + 2] ?? 0];
          put(col * T + x, row * T + y, rgb);
        }
      }
    }
  }
  for (const fr of frames) {
    const [body, label = "", dir = "s"] = fr.name.split("-");
    const row = (body === "55" ? 0 : 4) + order.indexOf(dir as Dir);
    const col = label.startsWith("fire") ? 3 + Number(label.slice(4)) : Number(label.slice(1)) - 1;
    fr.grid.forEach((line, y) => {
      line.forEach((p, x) => {
        if (p) {
          put(col * T + x, row * T + y, p);
        }
      });
    });
  }
  mkdirSync(PREVIEW, { recursive: true });
  writeFileSync(join(PREVIEW, "ships-sheet.png"), encodePng(sheet));
}
console.log(`ships: wrote ${frames.length} frames to ${BODIES}`);
