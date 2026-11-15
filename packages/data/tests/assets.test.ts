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
import { applyKey, ruleForUsage } from "../build/assets-lib/key.ts";
import { pack } from "../build/assets-lib/pack.ts";
import { createRgba, decodePng, encodePng } from "../build/assets-lib/png.ts";
import type { AssetIndex } from "../src/assets.ts";

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
    // palette 169 is #3333CC, so ink 36 keeps the amount dialog's black boxes
    expect(ruleForUsage([{ ink: 36, back: ["pal", 169], blend: 0, frames: 13 }], "opaque")).toEqual(
      { kind: "color", rgb: [0x33, 0x33, 0xcc] },
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
    const index = JSON.parse(readFileSync(join(a, "index.json"), "utf8")) as AssetIndex;
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
    // The 37 sounds some 1.6 script plays: the bell is the MP3, not its
    // 44-byte WAV stub; the 13 unused ones are not built.
    expect(Object.keys(index.sounds)).toHaveLength(37);
    expect(index.sounds.churchy).toBe("sounds/churchy.mp3");
    expect(index.sounds["stone skin"]).toBe("sounds/stone-skin.wav");
    expect(index.sounds.monsterhitme).toBeUndefined();
    expect(readFileSync(join(a, "sounds/fx.wav")).readUInt32LE(24)).toBe(14092);
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
    const index = JSON.parse(readFileSync(join(tmp, "d", "index.json"), "utf8")) as AssetIndex;
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
    const index = JSON.parse(readFileSync(join(tmp, "e", "index.json"), "utf8")) as AssetIndex;
    for (const g of ["tiles", "bodies", "paperdoll", "fx", "items"] as const) {
      expect(index.atlases[g].sprites["added test"]?.slice(3), g).toEqual([8, 8, 3, 4]);
    }
  }, 60_000);

  test("an added sound is copied and listed", () => {
    const dir = fresh("added-sound");
    put(dir, "sounds", "Test Chime.wav", wav());
    put(dir, "sounds", "Test Chime.json", soundSide());
    build(dir, "f");
    const index = JSON.parse(readFileSync(join(tmp, "f", "index.json"), "utf8")) as AssetIndex;
    expect(index.sounds["test chime"]).toBe("sounds/test-chime.wav");
    expect(readFileSync(join(tmp, "f", "sounds/test-chime.wav"))).toEqual(Buffer.from(wav()));
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
    const h = (o: string) =>
      (JSON.parse(readFileSync(join(tmp, o, "index.json"), "utf8")) as AssetIndex).inputHash;
    expect(h("m1")).toBe(h("m2"));
    put(b, "sounds", "Chime.json", soundSide({ note: "changed" }));
    build(b, "m3");
    expect(h("m3")).not.toBe(h("m1"));
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
