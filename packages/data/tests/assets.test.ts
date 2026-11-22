import { afterAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildAssets, renderUsage, USAGE_PATH } from "../build/assets.ts";
import { listAdded } from "../build/assets-lib/added.ts";
import { applyKey, ruleForUsage } from "../build/assets-lib/key.ts";
import { keyedOriginal } from "../build/assets-lib/load.ts";
import { centreLine2, mirrorBody, mirrorPaperdoll } from "../build/assets-lib/mirror.ts";
import {
  checkOriginalSidecars,
  readOriginalSidecars,
} from "../build/assets-lib/original-sidecars.ts";
import { pack } from "../build/assets-lib/pack.ts";
import { TAB_MASKS } from "../build/assets-lib/panel-tab-masks.ts";
import { applyTabMask, mendPanelSeam, PANEL_SEAM } from "../build/assets-lib/panel-tabs.ts";
import { createRgba, decodePng, encodePng, type Rgba } from "../build/assets-lib/png.ts";
import type { ManifestBitmap } from "../build/assets-lib/select.ts";
import { renderRects } from "../build/data.ts";
import type { AssetIndex, PackArtIndex } from "../src/assets.ts";

/**
 * A test build's index as the server serves it: the engine's index with the Classic pack's art
 * (`<outDir>/classic-art/`) merged in, its file paths relative to `outDir`.
 */
function readBuilt(outDir: string): AssetIndex {
  const engine = JSON.parse(readFileSync(join(outDir, "index.json"), "utf8")) as AssetIndex;
  const art = JSON.parse(
    readFileSync(join(outDir, "classic-art", "index.json"), "utf8"),
  ) as PackArtIndex;
  const atlases = Object.fromEntries(
    Object.entries(art.atlases).map(([g, a]) => [
      g,
      { sheets: a.sheets.map((f) => `classic-art/${f}`), sprites: a.sprites },
    ]),
  ) as AssetIndex["atlases"];
  const sounds = { ...engine.sounds };
  for (const [k, f] of Object.entries(art.sounds)) {
    sounds[k] = `classic-art/${f}`;
  }
  return { ...engine, atlases, sounds };
}

import { TAB_ART } from "../src/panel-tabs.ts";

const tmp = mkdtempSync(join(tmpdir(), "sso-assets-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("PNG codec (Bun only)", () => {
  test("round-trips RGBA exactly", () => {
    const img = createRgba(5, 3);
    for (let i = 0; i < img.data.length; i++) {
      img.data[i] = (i * 37) & 255;
    }
    expect(decodePng(encodePng(img))).toEqual(img);
  });

  test("decodes an original cast bitmap (G1 grass, 32×32 RGBA)", () => {
    const g1 = decodePng(
      new Uint8Array(
        readFileSync(join(import.meta.dir, "../../../assets/original/main/bitmaps/408431_G1.png")),
      ),
    );
    expect([g1.width, g1.height]).toEqual([32, 32]);
    expect([...g1.data.subarray(0, 4)]).toEqual([17, 102, 61, 255]);
  });
});

describe("panel tab masks", () => {
  test("every tab icon has a mask that covers its crop box", () => {
    for (const tab of TAB_ART) {
      for (const [member, crop] of [
        [tab.member, tab.crop],
        [tab.selected, tab.selectedCrop],
      ] as const) {
        const mask = TAB_MASKS[member] as readonly string[];
        expect(mask).toHaveLength(crop[3]);
        for (const row of mask) {
          expect(row).toMatch(new RegExp(`^[#.]{${crop[2]}}$`));
        }
        // The glyph is centred in its crop, so the centre is always kept.
        expect(mask[Math.floor(crop[3] / 2)]?.[Math.floor(crop[2] / 2)]).toBe("#");
      }
    }
    expect(Object.keys(TAB_MASKS).map(Number).sort()).toEqual(
      TAB_ART.flatMap((t) => [t.member, t.selected]).sort(),
    );
  });

  test("keeps only the masked pixels inside the crop", () => {
    const src = createRgba(4, 3);
    src.data.fill(200);
    const out = applyTabMask(src, ["#.", ".#"], [1, 1, 2, 2]);
    const alphas = [];
    for (let i = 3; i < out.data.length; i += 4) {
      alphas.push(out.data[i]);
    }
    expect(alphas).toEqual([0, 0, 0, 0, 0, 255, 0, 0, 0, 0, 255, 0]);
    expect([...out.data.subarray(20, 24)]).toEqual([200, 200, 200, 255]);
    expect(() => applyTabMask(src, ["#."], [1, 1, 2, 2])).toThrow();
  });
});

describe("panel seam (Internal #186)", () => {
  const original = decodePng(
    new Uint8Array(
      readFileSync(
        join(import.meta.dir, "../../../assets/original/main/bitmaps/362527_Gui_test.png"),
      ),
    ),
  );
  const lum = (img: ReturnType<typeof createRgba>, x: number, y: number) => {
    const p = (y * img.width + x) * 4;
    return (img.data[p] as number) + (img.data[p + 1] as number) + (img.data[p + 2] as number);
  };
  /** The vertical offset (-2..2) that best lines column `x + 1` up with column `x`. */
  const bestShift = (img: ReturnType<typeof createRgba>, x: number, y0: number, y1: number) => {
    let best = 0;
    let cost = Number.POSITIVE_INFINITY;
    for (const d of [0, -1, 1, -2, 2]) {
      let s = 0;
      for (let y = y0; y <= y1; y++) {
        s += Math.abs(lum(img, x, y) - lum(img, x + 1, y + d));
      }
      if (s < cost) {
        cost = s;
        best = d;
      }
    }
    return best;
  };
  const { x0, x1, y0, y1, both } = PANEL_SEAM;

  test("the original's grain steps a pixel at both strip joins", () => {
    expect(bestShift(original, x1, y0, y1)).toBe(1);
    expect(bestShift(original, x0 - 1, both, y1)).toBe(-1);
  });

  test("the mended wood lines up across the strip", () => {
    const mended = mendPanelSeam(original);
    for (let x = x0 - 1; x <= x1; x++) {
      expect([x, bestShift(mended, x, y0, y1)]).toEqual([x, 0]);
      expect([x, bestShift(mended, x, both, y1)]).toEqual([x, 0]);
    }
    // Only the strip changes.
    for (let y = 0; y < original.height; y++) {
      for (const x of [x0 - 1, x1 + 1]) {
        expect(lum(mended, x, y)).toBe(lum(original, x, y));
      }
    }
  });
});

describe("keying", () => {
  test("ink 36 keys the exact background colour; matte keys only edge-connected white", () => {
    const img = createRgba(3, 1);
    img.data.set([0, 255, 0, 255, 0, 254, 0, 255, 255, 255, 255, 255]);
    applyKey(img, { kind: "color", rgb: [0, 255, 0] });
    expect([img.data[3], img.data[7], img.data[11]]).toEqual([0, 255, 255]);

    const m = createRgba(3, 3);
    m.data.fill(255);
    m.data.set([0, 0, 0, 255], 4 * 1); // a black pixel on the top edge
    applyKey(m, { kind: "matte" });
    expect(m.data[4 * 4 + 3]).toBe(0); // centre white touches the edge through others
    expect(m.data[1 * 4 + 3]).toBe(255);
  });

  test("UI rule follows the most-used score appearance, then keyHint", () => {
    expect(
      ruleForUsage([{ ink: 32, back: [255, 255, 255], blend: 127, frames: 29 }], "opaque"),
    ).toEqual({
      kind: "blend",
      alpha: 127 / 255,
    });
    expect(ruleForUsage([{ ink: 8, back: [255, 255, 255], blend: 0, frames: 2 }], "white")).toEqual(
      { kind: "matte" },
    );
    expect(ruleForUsage(undefined, "green")).toEqual({ kind: "color", rgb: [0, 255, 0] });
    // 1.6 kept the amount dialog's black button boxes (palette 169 is #3333CC); SSO keys black
    expect(ruleForUsage([{ ink: 36, back: ["pal", 169], blend: 0, frames: 13 }], "opaque")).toEqual(
      { kind: "color", rgb: [0, 0, 0] },
    );
    expect(ruleForUsage([], "opaque")).toEqual({ kind: "none" });
  });
});

describe("packer", () => {
  test("is deterministic and spills to a second sheet when full", () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ name: `s${i}`, w: 40, h: 40 }));
    const a = pack(items, 100);
    expect(pack([...items].reverse(), 100)).toEqual(a);
    expect(a.sheets.length).toBe(3); // 2×2 per 100² sheet with 1 px padding
  });
});

describe("asset build", () => {
  test("building twice gives identical bytes", () => {
    const a = join(tmp, "a");
    const b = join(tmp, "b");
    const empty = join(tmp, "no-added");
    buildAssets({ outDir: a, addedDir: empty, force: true });
    buildAssets({ outDir: b, addedDir: empty, force: true });
    const files = (dir: string): string[] =>
      readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((d) => d.isFile())
        .map((d) => join(d.parentPath, d.name).slice(dir.length))
        .sort();
    expect(files(a)).toEqual(files(b));
    for (const f of files(a)) {
      expect(Bun.hash(readFileSync(join(a, f)))).toBe(Bun.hash(readFileSync(join(b, f))));
    }
    const index = readBuilt(join(a));
    // Every sheet ≤ 2048², and the first sprites drawn are present.
    for (const g of Object.values(index.atlases)) {
      for (const s of Object.values(g.sprites)) {
        expect(s[1] + s[3]).toBeLessThanOrEqual(2048);
        expect(s[2] + s[4]).toBeLessThanOrEqual(2048);
      }
    }
    expect(index.atlases.tiles.sprites.g1).toBeDefined();
    expect(index.atlases.tiles.sprites.s3).toBeDefined();
    expect(index.atlases.paperdoll.sprites["defbod-f2-s"]?.slice(5)).toEqual([25, 6]);
    expect(index.atlases.paperdoll.sprites["head11-f1-w"]).toBeDefined();
    expect(index.atlases.bodies.sprites["sp112-f2-s"]).toBeUndefined(); // scratch members skipped
    expect(index.ui["internal:186"]).toMatchObject({ w: 234, h: 600 });
    // The tab bitmaps are cut out by their masks and the baked copies are gone from #186.
    const alpha = (img: { width: number; data: Uint8Array }, x: number, y: number) =>
      img.data[(y * img.width + x) * 4 + 3];
    for (const tab of TAB_ART) {
      for (const [member, source, crop] of [
        [tab.member, tab.source, tab.crop],
        [tab.selected, tab.selectedSource, tab.selectedCrop],
      ] as const) {
        const img = decodePng(
          new Uint8Array(readFileSync(join(a, "ui", `internal-${member}.png`))),
        );
        expect([img.width, img.height]).toEqual([...source]);
        // Opaque exactly where the hand-drawn mask says, transparent everywhere else.
        const mask = TAB_MASKS[member] as readonly string[];
        for (let y = 0; y < img.height; y++) {
          for (let x = 0; x < img.width; x++) {
            const inMask = mask[y - crop[1]]?.[x - crop[0]] === "#";
            expect(alpha(img, x, y)).toBe(inMask ? 255 : 0);
          }
        }
      }
    }
    const panel = decodePng(new Uint8Array(readFileSync(join(a, "ui", "internal-186.png"))));
    const original = decodePng(
      new Uint8Array(
        readFileSync(
          join(import.meta.dir, "../../../assets/original/main/bitmaps/362527_Gui_test.png"),
        ),
      ),
    );
    let erased = 0;
    for (const tab of TAB_ART) {
      const [, h] = tab.source;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < tab.source[0]; x++) {
          const p = ((tab.original[1] + y) * panel.width + tab.original[0] - 566 + x) * 4;
          if (panel.data[p] !== original.data[p] || panel.data[p + 1] !== original.data[p + 1]) {
            erased += 1;
          }
        }
      }
    }
    expect(erased).toBeGreaterThan(500);
    // The 37 sounds some 1.6 script plays: the bell is the MP3, not its
    // 44-byte WAV stub; the 13 unused ones are not built.
    expect(Object.keys(index.sounds)).toHaveLength(37);
    // The bell is the Classic pack's; the interface's clicks are the engine's own.
    expect(index.sounds.churchy).toBe("classic-art/sounds/churchy.mp3");
    expect(index.sounds.clicksound).toBe("sounds/clicksound.wav");
    expect(index.sounds["stone skin"]).toBe("classic-art/sounds/stone-skin.wav");
    expect(index.sounds.monsterhitme).toBeUndefined();
    expect(readFileSync(join(a, "classic-art/sounds/fx.wav")).readUInt32LE(24)).toBe(14092);
    // A rerun with the same inputs is skipped.
    expect(buildAssets({ outDir: a, addedDir: empty }).skipped).toBe(true);
  }, 60_000);

  test("new art whose name collides with an original member fails the build", () => {
    const added = join(tmp, "added");
    mkdirSync(join(added, "tiles"), { recursive: true });
    writeFileSync(join(added, "tiles", "G1.png"), encodePng(createRgba(32, 32)));
    writeFileSync(
      join(added, "tiles", "G1.json"),
      JSON.stringify({
        group: "tiles",
        regX: 16,
        regY: 16,
        key: "none",
        prov: "authored",
        note: "test",
      }),
    );
    expect(() => buildAssets({ outDir: join(tmp, "c"), addedDir: added, force: true })).toThrow(
      /collides/,
    );
  }, 60_000);

  test("new art with a sidecar lands in its atlas", () => {
    const added = join(tmp, "added2");
    mkdirSync(join(added, "tiles"), { recursive: true });
    writeFileSync(join(added, "tiles", "SSO Test Tile.png"), encodePng(createRgba(32, 32)));
    writeFileSync(
      join(added, "tiles", "SSO Test Tile.json"),
      JSON.stringify({
        group: "tiles",
        regX: 16,
        regY: 16,
        key: "green",
        prov: "authored",
        note: "test",
      }),
    );
    buildAssets({ outDir: join(tmp, "d"), addedDir: added, force: true });
    const index = readBuilt(join(tmp, "d"));
    expect(index.atlases.tiles.sprites["sso test tile"]?.slice(3)).toEqual([32, 32, 16, 16]);
  }, 60_000);

  const artSide = (group: string, extra: object = {}) =>
    JSON.stringify({
      group,
      regX: 3,
      regY: 4,
      key: "none",
      prov: "authored",
      note: "test",
      ...extra,
    });
  const soundSide = (extra: object = {}) =>
    JSON.stringify({ group: "sounds", prov: "authored", note: "test", ...extra });
  /** A WAV with a header and no samples. */
  const wav = () => {
    const b = Buffer.alloc(44);
    b.write("RIFF", 0);
    b.writeUInt32LE(36, 4);
    b.write("WAVEfmt ", 8);
    b.writeUInt32LE(16, 16);
    b.writeUInt16LE(1, 20);
    b.writeUInt16LE(1, 22);
    b.writeUInt32LE(8000, 24);
    b.writeUInt32LE(8000, 28);
    b.writeUInt16LE(1, 32);
    b.writeUInt16LE(8, 34);
    b.write("data", 36);
    return new Uint8Array(b);
  };
  const put = (dir: string, group: string, file: string, bytes: Uint8Array | string) => {
    mkdirSync(join(dir, group), { recursive: true });
    writeFileSync(join(dir, group, file), bytes);
  };
  const fresh = (name: string) => join(tmp, name);
  const build = (dir: string, out: string) =>
    buildAssets({ outDir: join(tmp, out), addedDir: dir, force: true });

  test("added art lands in its atlas, in every group", () => {
    const dir = fresh("added-groups");
    for (const g of ["tiles", "bodies", "paperdoll", "fx", "items"]) {
      put(dir, g, "Added Test.png", encodePng(createRgba(8, 8)));
      put(dir, g, "Added Test.json", artSide(g));
    }
    build(dir, "e");
    const index = readBuilt(join(tmp, "e"));
    for (const g of ["tiles", "bodies", "paperdoll", "fx", "items"] as const) {
      expect(index.atlases[g].sprites["added test"]?.slice(3), g).toEqual([8, 8, 3, 4]);
    }
  }, 60_000);

  test("an added sound is copied and listed", () => {
    const dir = fresh("added-sound");
    put(dir, "sounds", "Test Chime.wav", wav());
    put(dir, "sounds", "Test Chime.json", soundSide());
    build(dir, "f");
    const index = readBuilt(join(tmp, "f"));
    expect(index.sounds["test chime"]).toBe("classic-art/sounds/test-chime.wav");
    expect(readFileSync(join(tmp, "f", "classic-art/sounds/test-chime.wav"))).toEqual(
      Buffer.from(wav()),
    );
    expect(Object.keys(index.sounds)).toHaveLength(38);
  }, 60_000);

  test("an added sound named like an original fails", () => {
    const dir = fresh("added-sound-dup");
    put(dir, "sounds", "Splash.wav", wav());
    put(dir, "sounds", "Splash.json", soundSide());
    expect(() => build(dir, "g")).toThrow(/collides with an original Audio member/);
  }, 60_000);

  test("an unknown folder fails", () => {
    const dir = fresh("added-unknown");
    put(dir, "icons", "X.png", encodePng(createRgba(8, 8)));
    expect(() => build(dir, "h")).toThrow(/assets\/added\/icons/);
  }, 60_000);

  test("a PNG with no sidecar fails", () => {
    const dir = fresh("added-nosidecar");
    put(dir, "fx", "Lonely-1.png", encodePng(createRgba(8, 8)));
    expect(() => build(dir, "i")).toThrow(/assets\/added\/fx\/Lonely-1.png has no sidecar/);
  }, 60_000);

  test("a sidecar whose group is not its folder fails", () => {
    const dir = fresh("added-wronggroup");
    put(dir, "fx", "Odd-1.png", encodePng(createRgba(8, 8)));
    put(dir, "fx", "Odd-1.json", artSide("items"));
    expect(() => build(dir, "j")).toThrow(/group is items, folder is fx/);
  }, 60_000);

  test("a sound sidecar with regX fails", () => {
    const dir = fresh("added-soundreg");
    put(dir, "sounds", "Chime.wav", wav());
    put(dir, "sounds", "Chime.json", soundSide({ regX: 1 }));
    expect(() => build(dir, "k")).toThrow(/Chime.json/);
  }, 60_000);

  test("a file that is not a WAV fails", () => {
    const dir = fresh("added-notwav");
    put(dir, "sounds", "Chime.wav", "hello, not audio at all");
    put(dir, "sounds", "Chime.json", soundSide());
    expect(() => build(dir, "l")).toThrow(/Chime.wav is not a WAV file/);
  }, 60_000);

  test("the input hash follows added files by relative path and content", () => {
    const a = fresh("added-hash-a");
    const b = fresh("added-hash-b");
    for (const d of [a, b]) {
      put(d, "sounds", "Chime.wav", wav());
      put(d, "sounds", "Chime.json", soundSide());
    }
    build(a, "m1");
    build(b, "m2");
    const h = (o: string) => readBuilt(join(tmp, o)).inputHash;
    expect(h("m1")).toBe(h("m2"));
    put(b, "sounds", "Chime.json", soundSide({ note: "changed" }));
    build(b, "m3");
    expect(h("m3")).not.toBe(h("m1"));
  }, 60_000);
});

describe("mirrored north frames", () => {
  const dot = (w: number, h: number, x: number, y: number) => {
    const img = createRgba(w, h);
    img.data.set([1, 2, 3, 255], (y * w + x) * 4);
    return img;
  };
  const opaque = (img: Rgba) => {
    const at: [number, number][] = [];
    for (let i = 3; i < img.data.length; i += 4) {
      if (img.data[i]) {
        at.push([((i - 3) / 4) % img.width, Math.floor((i - 3) / 4 / img.width)]);
      }
    }
    return at;
  };

  test("bug fixed: from behind, a character holds the shield in the left hand and the weapon in the right", () => {
    // The first test's build, reused through the input hash (built here when run alone).
    const a = join(tmp, "a");
    buildAssets({ outDir: a, addedDir: join(tmp, "no-added") });
    const index = readBuilt(join(a));
    // North frames are flipped about the body's centre line (column 22); the body stays put.
    const sheets = new Map<string, Rgba>();
    const centreX = (group: "paperdoll" | "bodies", name: string): number => {
      const [sheet, sx, sy, w, h] = index.atlases[group].sprites[name] as number[];
      const file = index.atlases[group].sheets[sheet as number] as string;
      if (!sheets.has(file)) {
        sheets.set(file, decodePng(new Uint8Array(readFileSync(join(a, file)))));
      }
      const img = sheets.get(file) as Rgba;
      let sum = 0;
      let n = 0;
      for (let y = 0; y < (h as number); y++) {
        for (let x = 0; x < (w as number); x++) {
          if (img.data[(((sy as number) + y) * img.width + (sx as number) + x) * 4 + 3]) {
            sum += x;
            n += 1;
          }
        }
      }
      return sum / n;
    };
    expect(centreX("paperdoll", "small shield-f2-s")).toBeGreaterThan(22);
    expect(centreX("paperdoll", "small shield-f2-n")).toBeLessThan(22);
    expect(centreX("paperdoll", "short sword-f3-s")).toBeLessThan(22);
    expect(centreX("paperdoll", "short sword-f4-n")).toBeGreaterThan(22);
    expect(Math.abs(centreX("paperdoll", "defbod-f2-n") - 22)).toBeLessThan(0.5);
    // A listed body's north frames are its 1.6 frames reversed, standing where they stood: the
    // standing frame's figure keeps its place to within the half pixel the centre line rounds to.
    // The server's hit rects move with them. The Lizard Warrior is not flipped.
    const repo = join(import.meta.dir, "../../..");
    const manifest = new Map<string, ManifestBitmap>();
    for (const line of readFileSync(
      join(repo, "assets/original/main/layout/cast-manifest.jsonl"),
      "utf8",
    ).split("\n")) {
      const r = line ? (JSON.parse(line) as ManifestBitmap) : null;
      if (r?.cast === "Chars" && r.type === "bitmap" && !manifest.has(r.name)) {
        manifest.set(r.name, r);
      }
    }
    const rects = renderRects() as { chars: Record<string, number[]> };
    const centreOf = (img: Rgba, regX: number) => {
      let sum = 0;
      let n = 0;
      for (let i = 3; i < img.data.length; i += 4) {
        if (img.data[i]) {
          sum += ((i - 3) / 4) % img.width;
          n += 1;
        }
      }
      return sum / n - regX;
    };
    let bodies = 0;
    for (const key of readOriginalSidecars(repo).keys()) {
      if (!key.startsWith("Chars/")) {
        continue;
      }
      const name = key.slice("Chars/".length);
      const b = manifest.get(name) as ManifestBitmap;
      const [sheet, sx, sy, w, h, regX] = index.atlases.bodies.sprites[
        name.toLowerCase()
      ] as number[];
      const file = index.atlases.bodies.sheets[sheet as number] as string;
      if (!sheets.has(file)) {
        sheets.set(file, decodePng(new Uint8Array(readFileSync(join(a, file)))));
      }
      const atlasSheet = sheets.get(file) as Rgba;
      const built = createRgba(w as number, h as number);
      for (let y = 0; y < built.height; y++) {
        built.data.set(
          atlasSheet.data.subarray(
            (((sy as number) + y) * atlasSheet.width + (sx as number)) * 4,
            (((sy as number) + y) * atlasSheet.width + (sx as number) + built.width) * 4,
          ),
          y * built.width * 4,
        );
      }
      const original = keyedOriginal(repo, b);
      expect(opaque(built), name).toEqual(
        opaque(original)
          .map(([x, y]): [number, number] => [original.width - 1 - x, y])
          .sort((p, q) => p[1] - q[1] || p[0] - q[0]),
      );
      if (name.endsWith("-F2-N")) {
        expect(
          Math.abs(centreOf(built, regX as number) - centreOf(original, b.regX)),
          name,
        ).toBeLessThanOrEqual(0.5);
      }
      expect(rects.chars[name.toLowerCase()]?.[2], name).toBe(regX);
      bodies += 1;
    }
    expect(bodies).toBe(137);
    expect(index.atlases.bodies.sprites["41-f2-n"]?.slice(5)).toEqual([16, 9]);
    expect(rects.chars["41-f2-n"]?.[2]).toBe(16);
  }, 60_000);

  test("a paperdoll layer flips about the body's centre line, column x to 44 - x", () => {
    expect(opaque(mirrorPaperdoll(dot(30, 5, 9, 2), "t"))).toEqual([[35, 2]]);
    expect(opaque(mirrorPaperdoll(dot(46, 45, 22, 0), "t"))).toEqual([[22, 0]]);
    expect(() => mirrorPaperdoll(dot(46, 45, 45, 0), "Test-F1-N")).toThrow(/Test-F1-N: column 45/);
  });

  test("a body frame flips about its own centre line, so the figure stays put", () => {
    // Two pixels, at columns 1 and 2, registration point 5: the figure is centred 3 left of it.
    const img = dot(10, 4, 1, 3);
    img.data.set([1, 2, 3, 255], (3 * 10 + 2) * 4);
    expect(centreLine2(img, 5)).toBe(-6);
    const flipped = mirrorBody(img, 5, -6);
    expect(opaque(flipped.img)).toEqual([
      [7, 3],
      [8, 3],
    ]);
    // Measured from the registration point, the figure still spans -4 to -3.
    expect(flipped.regX).toBe(11);
    expect([7 - flipped.regX, 8 - flipped.regX]).toEqual([-4, -3]);
    // A line through the registration point is a flip about it.
    expect(mirrorBody(img, 5, 0).regX).toBe(5);
  });

  /**
   * Bodies whose 1.6 back view is drawn mirrored. Left out: Lizard Warrior (41), Elf (50) and
   * Dwarf (60), whose back views are already right, and the bodies whose north frames copy the
   * south frames (30, 36, 37, 40, 42, 45, 46, 47, 52, 80, 90, 92, 99, 444, 502, 891).
   */
  const MIRRORED_BODIES = [
    1, 3, 5, 6, 31, 32, 33, 34, 35, 38, 51, 57, 58, 59, 61, 62, 89, 91, 94, 100, 200, 201, 202, 203,
    204, 207, 210, 311, 445, 477, 498, 621, 622, 858,
  ];

  test("original sidecars: every paperdoll north frame and the listed bodies' north frames are mirrored, nothing else", () => {
    const a = join(tmp, "a");
    buildAssets({ outDir: a, addedDir: join(tmp, "no-added") });
    const index = readBuilt(join(a));
    const north = /^(.*)-f\d-n$/;
    const expected = [
      ...Object.keys(index.atlases.paperdoll.sprites)
        .filter((k) => north.test(k))
        .map((k) => `paperdoll:${k}`),
      ...Object.keys(index.atlases.bodies.sprites)
        .filter((k) => MIRRORED_BODIES.includes(Number(north.exec(k)?.[1])))
        .map((k) => `bodies:${k}`),
    ].sort();
    const groupOf: Record<string, string> = { Characters: "paperdoll", Chars: "bodies" };
    const sides = readOriginalSidecars(join(import.meta.dir, "../../.."));
    const actual = [...sides].map(([key, side]) => {
      expect(side).toEqual({ mirrored: true });
      const [cast, name] = [key.slice(0, key.indexOf("/")), key.slice(key.indexOf("/") + 1)];
      return `${groupOf[cast]}:${name.toLowerCase()}`;
    });
    expect(actual.sort()).toEqual(expected);
    expect(expected).toContain("paperdoll:small shield-f2-n");
    expect(expected).not.toContain("bodies:41-f2-n");
    expect(expected).toHaveLength(267 + 137);
  }, 60_000);

  test("a build without original-sidecars.json fails instead of leaving art uncorrected", () => {
    const repo = mkdtempSync(join(tmp, "no-sidecars-"));
    expect(() => readOriginalSidecars(repo)).toThrow(/original-sidecars\.json is missing/);
  });

  test("the image build copies original-sidecars.json in", () => {
    const dockerfile = readFileSync(join(import.meta.dir, "../../../Dockerfile"), "utf8");
    expect(dockerfile).toContain(
      "COPY assets/original-sidecars.json ./assets/original-sidecars.json",
    );
  });

  test("an original sidecar must name a built member, and its flags pass the added-art checks", () => {
    const members = [
      { group: "bodies", cast: "Chars", name: "31-F1-N" },
      { group: "bodies", cast: "Chars", name: "31-F2-N" },
      { group: "bodies", cast: "Chars", name: "31-F2-S" },
    ];
    const m = (entries: [string, object][]) => new Map(entries) as never;
    expect(() =>
      checkOriginalSidecars(
        members,
        m([
          ["Chars/31-F1-N", { mirrored: true }],
          ["Chars/31-F2-N", { mirrored: true }],
        ]),
      ),
    ).not.toThrow();
    expect(() =>
      checkOriginalSidecars(members, m([["Chars/999-F1-N", { mirrored: true }]])),
    ).toThrow(/Chars\/999-F1-N is not an original member built into an atlas/);
    expect(() =>
      checkOriginalSidecars(members, m([["Chars/31-F2-S", { mirrored: true }]])),
    ).toThrow(/\(Chars\/31-F2-S\): "mirrored" is only for north frames/);
    expect(() =>
      checkOriginalSidecars(members, m([["Chars/31-F1-N", { mirrored: true }]])),
    ).toThrow(/must match on every north frame of 31/);
  });

  const side = (group: string, extra: object = {}) =>
    JSON.stringify({ group, regX: 3, regY: 1, key: "none", prov: "authored", note: "t", ...extra });
  const put = (
    dir: string,
    group: string,
    name: string,
    sidecar: string,
    img = dot(10, 4, 1, 3),
  ) => {
    mkdirSync(join(dir, group), { recursive: true });
    writeFileSync(join(dir, group, `${name}.png`), encodePng(img));
    writeFileSync(join(dir, group, `${name}.json`), sidecar);
  };

  test('"mirrored" is refused off a north frame, outside paperdoll and bodies, and when it differs between north frames', () => {
    const south = join(tmp, "mirror-south");
    put(south, "paperdoll", "Test Boots-F1-S", side("paperdoll", { mirrored: true }));
    expect(() => listAdded(south)).toThrow(/Test Boots-F1-S.png: "mirrored" is only for north/);
    const fx = join(tmp, "mirror-fx");
    put(fx, "fx", "Spark-F1-N", side("fx", { mirrored: true }));
    expect(() => listAdded(fx)).toThrow(/Spark-F1-N.png: "mirrored" is only for north/);
    const mixed = join(tmp, "mirror-mixed");
    put(mixed, "bodies", "900-F1-N", side("bodies", { mirrored: true }));
    put(mixed, "bodies", "900-F2-N", side("bodies"));
    expect(() => listAdded(mixed)).toThrow(/must match on every north frame of 900/);
    const off = join(tmp, "mirror-false");
    put(off, "bodies", "900-F1-N", side("bodies", { mirrored: false }));
    expect(() => listAdded(off)).toThrow(/900-F1-N.json/);
  });

  test("added art marked mirrored is flipped in the atlas and its hit rect", () => {
    const dir = join(tmp, "mirror-added");
    for (const f of ["F1", "F2", "F3", "F4"]) {
      put(dir, "bodies", `900-${f}-N`, side("bodies", { mirrored: true }));
      put(dir, "paperdoll", `Test Boots-${f}-N`, side("paperdoll", { mirrored: true }));
    }
    put(dir, "bodies", "900-F2-S", side("bodies"));
    buildAssets({ outDir: join(tmp, "mirror-out"), addedDir: dir, force: true });
    const index = readBuilt(join(tmp, "mirror-out"));
    // One pixel at column 1, registration point 3: flipped in place, regX moves to 10.
    expect(index.atlases.bodies.sprites["900-f2-n"]?.slice(3)).toEqual([10, 4, 10, 1]);
    expect(index.atlases.bodies.sprites["900-f2-s"]?.slice(3)).toEqual([10, 4, 3, 1]);
    expect(index.atlases.paperdoll.sprites["test boots-f2-n"]?.slice(3)).toEqual([45, 4, 3, 1]);
    const rects = renderRects(undefined, dir) as { chars: Record<string, number[]> };
    expect(rects.chars["900-f2-n"]).toEqual([10, 4, 10, 1]);
    expect(rects.chars["900-f2-s"]).toEqual([10, 4, 3, 1]);
  }, 60_000);
});

describe("original assets (assets/original/)", () => {
  const repo = join(import.meta.dir, "../../..");
  const usage = readFileSync(join(repo, USAGE_PATH), "utf8");
  const rows = usage
    .split("\n")
    .filter((l) => l.startsWith("| ") && !l.startsWith("| movie") && !l.startsWith("| ---"))
    .map((l) => l.slice(2, -2).split(/(?<!\\) \| /));
  const [MOVIE, , , , TYPE, FILE, SSO] = [0, 1, 2, 3, 4, 5, 6];
  const folder = (movie: string) => (movie === "main" ? "main" : `sub/${movie}`);

  test("usage.md is current (run `bun run assets:build` to rewrite it)", () => {
    expect(usage === renderUsage()).toBe(true);
  });

  test("every frame of the default body has bare feet to cover its painted shoes", () => {
    const frames = readFileSync(
      join(repo, "assets/original/main/layout/cast-manifest.jsonl"),
      "utf8",
    )
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => (JSON.parse(l) as { name?: string }).name ?? "")
      .filter((n) => n.startsWith("DEFBOD-"));
    expect(frames.length).toBe(15);
    for (const n of frames) {
      const bare = n.replace("DEFBOD-", "Bare Feet-");
      expect(existsSync(join(repo, "assets/added/paperdoll", `${bare}.png`))).toBe(true);
    }
  });

  test("every copied file is listed, and every listed file exists", () => {
    const listed = new Set(
      rows.flatMap((r) =>
        (r[FILE] as string)
          .split(", ")
          .map((f) => `${folder(r[MOVIE] as string)}/${f.replaceAll("\\|", "|")}`),
      ),
    );
    const onDisk = new Set<string>();
    const walk = (rel: string) => {
      for (const e of readdirSync(join(repo, "assets/original", rel), { withFileTypes: true })) {
        if (e.isDirectory()) {
          walk(`${rel}/${e.name}`);
        } else if (/\/(bitmaps|sounds)$/.test(rel)) {
          onDisk.add(`${rel}/${e.name}`);
        }
      }
    };
    walk("main");
    walk("sub");
    expect([...listed].filter((f) => !existsSync(join(repo, "assets/original", f)))).toEqual([]);
    expect([...onDisk].filter((f) => !listed.has(f))).toEqual([]);
    expect(onDisk.size).toBe(listed.size);
  });

  test("the main movie includes 50 sounds: 37 played, 13 not", () => {
    const main = rows.filter((r) => r[MOVIE] === "main");
    expect(main.filter((r) => r[TYPE] === "bitmap").length).toBe(4391);
    const sounds = main.filter((r) => r[TYPE] === "sound");
    expect(sounds.length).toBe(50);
    expect(sounds.filter((r) => (r[SSO] as string).startsWith("sound ")).length).toBe(37);
    expect(sounds.filter((r) => (r[SSO] as string).includes("nothing plays")).length).toBe(13);
  });
});

describe("ship rider frames (assets/added/bodies/55-*, 56-*)", () => {
  const ASSETS = join(import.meta.dir, "../../../assets");
  test("the east frame lands on the docked picture's pixels, so boarding moves nothing", () => {
    for (const [body, pic] of [
      [55, "319491_BoatPic.png"],
      [56, "319492_BattleshipPic.png"],
    ] as const) {
      const docked = decodePng(readFileSync(join(ASSETS, "original/main/bitmaps", pic)));
      const rider = decodePng(readFileSync(join(ASSETS, `added/bodies/${body}-f1-e.png`)));
      const { regX, regY } = JSON.parse(
        readFileSync(join(ASSETS, `added/bodies/${body}-f1-e.json`), "utf8"),
      );
      // The rider's point is (16, -2) from the tile; a ground picture is pasted at (1, 1).
      const offX = 16 - regX - 1;
      const offY = -2 - regY - 1;
      let mismatched = 0;
      for (let y = 0; y < docked.height; y++) {
        for (let x = 0; x < docked.width; x++) {
          const d = (y * docked.width + x) * 4;
          const rgb = [docked.data[d], docked.data[d + 1], docked.data[d + 2]];
          if (rgb.join() === "0,255,0") {
            continue;
          }
          const rx = x - offX;
          const ry = y - offY;
          const r = (ry * rider.width + rx) * 4;
          const got = [rider.data[r], rider.data[r + 1], rider.data[r + 2], rider.data[r + 3]];
          if (got.join() !== [...rgb, 255].join()) {
            mismatched++;
          }
        }
      }
      expect({ body, mismatched }).toEqual({ body, mismatched: 0 });
    }
  });
});
