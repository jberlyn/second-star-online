/**
 * Fingerprints of built art, for the pinning test in art-golden.test.ts: every sprite by its key,
 * size, anchor and pixels, and every sound by its bytes, with nothing about where the packer put
 * a sprite or what a sheet is called. Issue #29 moves the packer, keyer and mirror out of the
 * asset build so the server can run them; this is what says the Classic and Minimal packs' art
 * (and the engine's own) came out the same.
 *
 * Run `bun packages/data/tests/art-fingerprint.ts --update` to rewrite art-golden.json after a
 * deliberate art change (review the diff: only the sprites you changed should move).
 */
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildAssets } from "../build/assets.ts";
import { decodePng, type Rgba } from "../src/art/png.ts";
import type { AssetIndex, AtlasGroup, PackArtIndex } from "../src/assets.ts";

export const ART_GOLDEN = join(import.meta.dir, "art-golden.json");

/** `<group>:<key>` (or `sound:<name>`, `ui:<id>`) → a short hash of what is drawn or played. */
export type ArtPrints = Record<string, string>;

const short = (h: ReturnType<typeof createHash>) => h.digest("hex").slice(0, 16);

/** One art index's sprites and sounds, with its files read from `dir`. */
function printIndex(dir: string, index: PackArtIndex | AssetIndex): ArtPrints {
  const out: ArtPrints = {};
  for (const group of Object.keys(index.atlases).sort() as AtlasGroup[]) {
    const atlas = index.atlases[group];
    const sheets: Rgba[] = atlas.sheets.map((f) =>
      decodePng(new Uint8Array(readFileSync(join(dir, f)))),
    );
    for (const key of Object.keys(atlas.sprites).sort()) {
      const [sheet, x, y, w, h, regX, regY] = atlas.sprites[key] as number[] as [
        number,
        number,
        number,
        number,
        number,
        number,
        number,
      ];
      const img = sheets[sheet] as Rgba;
      const hash = createHash("sha256").update(`${w},${h},${regX},${regY};`);
      for (let row = 0; row < h; row++) {
        const from = ((y + row) * img.width + x) * 4;
        hash.update(img.data.subarray(from, from + w * 4));
      }
      out[`${group}:${key}`] = short(hash);
    }
  }
  for (const name of Object.keys(index.sounds).sort()) {
    out[`sound:${name}`] = short(
      createHash("sha256").update(readFileSync(join(dir, index.sounds[name] as string))),
    );
  }
  if ("ui" in index) {
    for (const id of Object.keys(index.ui).sort()) {
      const f = index.ui[id] as AssetIndex["ui"][string];
      out[`ui:${id}`] = short(
        createHash("sha256")
          .update(`${f.w},${f.h},${f.regX},${f.regY};`)
          .update(readFileSync(join(dir, f.file))),
      );
    }
  }
  return out;
}

/** The engine's, Classic's and Minimal's art, built from the repo into a scratch folder. */
export function fingerprintBuild(): { engine: ArtPrints; classic: ArtPrints; minimal: ArtPrints } {
  const dir = mkdtempSync(join(tmpdir(), "sso-art-golden-"));
  try {
    buildAssets({ outDir: dir, force: true });
    const read = <T>(f: string) => JSON.parse(readFileSync(join(dir, f), "utf8")) as T;
    return {
      engine: printIndex(dir, read<AssetIndex>("index.json")),
      classic: printIndex(join(dir, "classic-art"), read<PackArtIndex>("classic-art/index.json")),
      minimal: printIndex(join(dir, "minimal-art"), read<PackArtIndex>("minimal-art/index.json")),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  if (!process.argv.includes("--update")) {
    console.error("usage: bun packages/data/tests/art-fingerprint.ts --update");
    process.exit(2);
  }
  writeFileSync(ART_GOLDEN, `${JSON.stringify(fingerprintBuild(), null, 1)}\n`);
  console.log(`wrote ${ART_GOLDEN}`);
}
