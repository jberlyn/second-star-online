/**
 * Recolours an original item icon onto a colour ramp and writes it, with its sidecar, as added art
 * in assets/added/items/. The burned foods, Raw Meat and Cooked Meat were made with it:
 *
 *   bun tools/recolour-icon.ts "Orc Meat" "Burned Orc Meat" char
 *
 * Each pixel's brightness, stretched over the sprite's own darkest to lightest, picks a colour on
 * the ramp, so outlines and shading keep their shape. The green background stays green for the
 * build to key. The `char` ramp is greys and black, with soot flecks. The source may be an added
 * icon (Raw Meat for Burned Meat).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { decodePng, encodePng } from "../packages/data/build/assets-lib/png.ts";

type Rgb = readonly [number, number, number];
const RAMPS: Record<string, readonly Rgb[]> = {
  char: [
    [6, 6, 6],
    [22, 22, 22],
    [40, 40, 40],
    [64, 64, 64],
    [98, 98, 98],
    [136, 136, 136],
  ],
  raw: [
    [40, 4, 10],
    [110, 16, 32],
    [176, 40, 56],
    [222, 96, 108],
    [246, 160, 164],
  ],
  cooked: [
    [30, 14, 4],
    [84, 40, 14],
    [132, 72, 28],
    [180, 116, 54],
    [222, 170, 104],
  ],
};

const ROOT = resolve(import.meta.dir, "..");
const ADDED = join(ROOT, "assets", "added", "items");
const [from, to, rampName] = process.argv.slice(2);
const ramp = rampName ? RAMPS[rampName] : undefined;
if (!from || !to || !ramp) {
  console.error(`usage: bun tools/recolour-icon.ts <source item> <new item> <${Object.keys(RAMPS).join("|")}>`);
  process.exit(1);
}

/** The source's PNG and registration point: an added icon, else the original Inventory member. */
function source(name: string): { png: string; regX: number; regY: number } {
  const added = join(ADDED, `${name}.png`);
  if (existsSync(added)) {
    const side = JSON.parse(readFileSync(join(ADDED, `${name}.json`), "utf8"));
    return { png: added, regX: side.regX, regY: side.regY };
  }
  const manifest = join(ROOT, "assets", "original", "main", "layout", "cast-manifest.jsonl");
  for (const line of readFileSync(manifest, "utf8").split("\n")) {
    if (!line) {
      continue;
    }
    const m = JSON.parse(line);
    if (m.cast === "Inventory" && m.name === name && m.asset) {
      return {
        png: join(ROOT, "assets", "original", "main", m.asset),
        regX: m.regX,
        regY: m.regY,
      };
    }
  }
  throw new Error(`no Inventory icon named ${name}`);
}

const src = source(from);
const img = decodePng(new Uint8Array(readFileSync(src.png)));
const d = img.data;
const at = (i: number) => d[i] ?? 0;
const isKey = (i: number) => at(i) === 0 && at(i + 1) === 255 && at(i + 2) === 0;
const lum = (i: number) => 0.299 * at(i) + 0.587 * at(i + 1) + 0.114 * at(i + 2);
let lo = 255;
let hi = 0;
for (let i = 0; i < d.length; i += 4) {
  if (!isKey(i)) {
    lo = Math.min(lo, lum(i));
    hi = Math.max(hi, lum(i));
  }
}
for (let i = 0; i < d.length; i += 4) {
  if (isKey(i)) {
    continue;
  }
  let t = hi > lo ? (lum(i) - lo) / (hi - lo) : 0;
  if (rampName === "char") {
    t **= 1.25;
    const p = i / 4;
    const x = p % img.width;
    const y = Math.floor(p / img.width);
    if (t > 0.15 && (((x * 73856093) ^ (y * 19349663)) >>> 0) % 5 === 0) {
      t *= 0.55;
    }
  }
  const f = t * (ramp.length - 1);
  const k = Math.min(ramp.length - 2, Math.floor(f));
  const u = f - k;
  const a = ramp[k] as Rgb;
  const b = ramp[k + 1] as Rgb;
  for (let c = 0; c < 3; c++) {
    d[i + c] = Math.round(a[c] * (1 - u) + b[c] * u);
  }
  d[i + 3] = 255;
}
writeFileSync(join(ADDED, `${to}.png`), encodePng(img));
const side = {
  group: "items",
  regX: src.regX,
  regY: src.regY,
  key: "green",
  prov: "authored",
  note: `${from}'s icon recoloured on the ${rampName} ramp (tools/recolour-icon.ts)`,
};
writeFileSync(join(ADDED, `${to}.json`), `${JSON.stringify(side)}\n`);
console.log(`assets/added/items/${to}.png`);
