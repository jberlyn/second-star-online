/**
 * Asset build. Bun only.
 *
 * Reads the cast manifests in assets/original/<movie>/layout/ and the original bitmaps and sounds in
 * assets/original/ (listed in assets/original/usage.md), plus new art and sounds in assets/added/, and
 * writes the gitignored packages/data/assets/:
 * - atlases for the playfield casts (tiles = MapGFX, bodies = Chars, paperdoll = Characters,
 *   fx = FX, items = Inventory),
 *   each sheet at most 2048², with an index of name → sheet, rect and registration point;
 * - the UI art (the Internal cast, and the sub-movie windows in `UI_SUB_MOVIES`) as single
 *   files, keyed `<cast>:<member>` (`internal:186`) or `<movie>:<member>` (`whowindow:3`);
 * - index.json (types in src/assets.ts).
 *
 * Keying happens here, per member (build/assets-lib/key.ts). Playfield casts are always drawn with
 * ink 36 on green (score usage; the original's character renderer copies paperdoll layers with ink 36), so their
 * green becomes transparent. Layer-1 tiles were drawn with copy ink; the playfield fills
 * layer 1 with green first, so a keyed tile looks exactly as it did.
 *
 * Deterministic: inputs sorted, fixed packing and fixed PNG settings. Skipped when the input
 * hash matches the existing index (so `bun run dev` only builds the first time).
 *
 * Run: `bun run assets:build` (add `--force` to rebuild anyway). It also rewrites
 * assets/original/usage.md when that list is out of date.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import { centreLine2, mirrorBody, mirrorPaperdoll, standingFrameOf } from "../src/art/mirror.ts";
import { pack } from "../src/art/pack.ts";
import { blit, createRgba, decodePng, encodePng, type Rgba } from "../src/art/png.ts";
import type {
  AssetIndex,
  AtlasGroup,
  AtlasIndex,
  AtlasSprite,
  PackArtIndex,
  UiFile,
} from "../src/assets.ts";
import { addedSoundFile, listAdded } from "./assets-lib/added.ts";
import { applyKey, type KeyRule, ruleForUsage } from "./assets-lib/key.ts";
import { ATLAS_RULE, loadOriginal, MAIN_ROOT, rootOf, ruleForSidecar } from "./assets-lib/load.ts";
import {
  checkOriginalSidecars,
  ORIGINAL_SIDECARS_PATH,
  originalSidecarKey,
  readOriginalSidecars,
} from "./assets-lib/original-sidecars.ts";
import { derivePanelTabs } from "./assets-lib/panel-tabs.ts";
import {
  GROUP_CAST,
  MAIN_MOVIE,
  type ManifestBitmap,
  type ManifestSound,
  selectMembers,
  soundFile,
  UI_SUB_MOVIES,
  type Use,
  uiFile,
} from "./assets-lib/select.ts";

export const ASSETS_DIR = join(import.meta.dir, "..", "assets");
/**
 * Where the Classic pack's art goes: its atlases and its sounds (gitignored, like ASSETS_DIR). The
 * engine keeps the interface's own art, the UI files and `ENGINE_SOUNDS`, in ASSETS_DIR.
 */
export const CLASSIC_ART_DIR = join(import.meta.dir, "..", "packs", "classic", "art");
/** Where the Minimal pack's art goes (gitignored, like CLASSIC_ART_DIR). */
export const MINIMAL_ART_DIR = join(import.meta.dir, "..", "packs", "minimal", "art");
/**
 * The list of the pictures the Minimal pack carries (relative to the repo), by atlas group and
 * lower-case key: the grass, empty and shadow tiles, the bare body and the first two heads, and
 * the three gold piles. They are copies of Classic's, packed from the same sources.
 */
export const MINIMAL_ART_LIST = "packages/data/minimal/pictures.json";

/**
 * Reads the Minimal pack's art list: every atlas group, each a list of sprite keys. A repo without
 * one (a test's) builds a Minimal pack with no art.
 */
function readMinimalArt(path: string): Record<AtlasGroup, string[]> {
  const raw = existsSync(path)
    ? (JSON.parse(readFileSync(path, "utf8")) as Partial<Record<AtlasGroup, string[]>>)
    : {};
  const out = {} as Record<AtlasGroup, string[]>;
  for (const group of Object.keys(GROUP_CAST) as AtlasGroup[]) {
    out[group] = (raw[group] ?? []).map((k) => k.toLowerCase()).sort();
  }
  return out;
}

/** Packs sources into sheets: each sprite's sheet, place, size and anchor, in key order. */
function packAtlas(
  sources: readonly Source[],
  images: ReadonlyMap<string, Rgba>,
): { sheets: Rgba[]; sprites: Record<string, AtlasSprite>; layout: { w: number; h: number }[] } {
  const layout = pack(
    sources.map((s) => {
      const img = images.get(s.key) as Rgba;
      return { name: s.key, w: img.width, h: img.height };
    }),
  );
  const sheets = layout.sheets.map((sz) => createRgba(Math.max(1, sz.w), Math.max(1, sz.h)));
  const sprites: Record<string, AtlasSprite> = {};
  const placed = new Map(layout.placements.map((p) => [p.name, p]));
  for (const s of [...sources].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))) {
    const p = placed.get(s.key);
    const img = images.get(s.key);
    if (!p || !img) {
      continue;
    }
    blit(sheets[p.sheet] as Rgba, img, p.x, p.y);
    sprites[s.key] = [p.sheet, p.x, p.y, img.width, img.height, s.regX, s.regY];
  }
  return { sheets, sprites, layout: layout.sheets };
}

/** The interface's click sounds: engine art, served whatever packs are installed. */
export const ENGINE_SOUNDS: readonly string[] = ["clicksound", "clicksound2"];
const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
/** Bump when the build's output format or rules change, so the cache is invalidated. */
const BUILD_VERSION = 17;

interface Source {
  name: string;
  key: string;
  img: () => Rgba;
  regX: number;
  regY: number;
  rule: KeyRule;
  /** A north frame stored mirrored (src/art/mirror.ts), flipped after keying. */
  mirrored: boolean;
}

export interface BuildOptions {
  repoRoot?: string;
  outDir?: string;
  /**
   * Where the Classic pack's atlases and sounds go: CLASSIC_ART_DIR, or `<outDir>/classic-art` when
   * `outDir` is given.
   */
  packArtDir?: string;
  addedDir?: string;
  /**
   * Where the Minimal pack's atlases go: MINIMAL_ART_DIR, or `<outDir>/minimal-art` when `outDir`
   * is given.
   */
  minimalArtDir?: string;
  /** The list of the Minimal pack's pictures (default `packages/data/minimal/pictures.json` in the repo). */
  minimalArtList?: string;
  force?: boolean;
}

export interface BuildStats {
  skipped: boolean;
  files: number;
  bytes: number;
  sheets: Record<string, { w: number; h: number }[]>;
  sprites: Record<string, number>;
  uiFiles: number;
}

const mainManifestPath = "assets/original/main/layout/cast-manifest.jsonl";
const subManifestPath = (movie: string) =>
  `assets/original/sub/${movie}/layout/cast-manifest.jsonl`;

function parseRows<T>(text: string, type: string): T[] {
  return text
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as T & { type: string; asset: unknown })
    .filter((r) => r.type === type && r.asset);
}

const byCastThenMember = (a: ManifestBitmap, b: ManifestBitmap) =>
  a.castLib - b.castLib || a.member - b.member;

/** The main movie's bitmaps, sorted by cast then member. */
function readManifest(repoRoot: string): ManifestBitmap[] {
  return parseRows<ManifestBitmap>(readFileSync(join(repoRoot, mainManifestPath), "utf8"), "bitmap")
    .map((b) => ({ ...b, movie: MAIN_MOVIE, castName: b.cast }))
    .sort(byCastThenMember);
}

/** Every sub-movie with a manifest, in a fixed (case-insensitive) order. */
export function subMovies(repoRoot: string): string[] {
  const dir = join(repoRoot, "assets", "original", "sub");
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter((m) => existsSync(join(repoRoot, subManifestPath(m))))
    .sort((a, b) => {
      const [x, y] = [a.toLowerCase(), b.toLowerCase()];
      return x < y ? -1 : x > y ? 1 : a < b ? -1 : a > b ? 1 : 0;
    });
}

/** Sub-movie bitmaps, named by movie so their keys never collide with the main movie's. */
function readSubManifests(repoRoot: string): ManifestBitmap[] {
  return subMovies(repoRoot).flatMap((movie) =>
    parseRows<ManifestBitmap>(
      readFileSync(join(repoRoot, subManifestPath(movie)), "utf8"),
      "bitmap",
    )
      .map((b) => ({
        ...b,
        cast: movie,
        castName: b.cast,
        movie,
        root: `assets/original/sub/${movie}`,
      }))
      .sort(byCastThenMember),
  );
}

/** The sound members of every movie. */
function readSounds(repoRoot: string): ManifestSound[] {
  const rows = parseRows<ManifestSound>(
    readFileSync(join(repoRoot, mainManifestPath), "utf8"),
    "sound",
  ).map((r) => ({ ...r, movie: MAIN_MOVIE }));
  for (const movie of subMovies(repoRoot)) {
    rows.push(
      ...parseRows<ManifestSound>(
        readFileSync(join(repoRoot, subManifestPath(movie)), "utf8"),
        "sound",
      ).map((r) => ({ ...r, movie })),
    );
  }
  return rows;
}

/** Hash of every input file and the build version. */
function inputHash(
  repoRoot: string,
  bitmaps: ManifestBitmap[],
  sounds: ManifestSound[],
  addedDir: string,
  minimalArt: string,
): string {
  const h = new Bun.CryptoHasher("sha256");
  h.update(`v${BUILD_VERSION}\n`);
  h.update(`minimal ${minimalArt}\n`);
  h.update(readFileSync(join(repoRoot, mainManifestPath)));
  h.update(readFileSync(join(repoRoot, ORIGINAL_SIDECARS_PATH)));
  for (const movie of UI_SUB_MOVIES) {
    const path = join(repoRoot, subManifestPath(movie));
    if (existsSync(path)) {
      h.update(movie);
      h.update(readFileSync(path));
    }
  }
  for (const b of bitmaps) {
    h.update(readFileSync(join(repoRoot, rootOf(b), b.asset)));
  }
  for (const snd of sounds) {
    h.update(readFileSync(join(repoRoot, MAIN_ROOT, snd.asset[0] as string)));
  }
  const added = listAdded(addedDir);
  const hashFile = (path: string) => {
    h.update(relative(addedDir, path));
    h.update(readFileSync(path));
  };
  for (const s of added.art) {
    hashFile(s.png);
    hashFile(s.json);
  }
  for (const s of added.sounds) {
    hashFile(s.file);
    hashFile(s.json);
  }
  for (const f of [
    "assets-lib/added.ts",
    "assets-lib/key.ts",
    "assets-lib/load.ts",
    "assets-lib/original-sidecars.ts",
    "assets-lib/panel-tab-masks.ts",
    "assets-lib/panel-tabs.ts",
    "assets-lib/select.ts",
    "assets.ts",
    "../src/art/key.ts",
    "../src/art/mirror.ts",
    "../src/art/pack.ts",
    "../src/art/png.ts",
    "../src/panel-tabs.ts",
    "../schema/added-asset.ts",
    "../schema/original-sidecars.ts",
  ]) {
    h.update(readFileSync(join(import.meta.dir, f)));
  }
  return h.digest("hex");
}

export function buildAssets(options: BuildOptions = {}): BuildStats {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const outDir = options.outDir ?? ASSETS_DIR;
  const addedDir = options.addedDir ?? join(repoRoot, "assets", "added");
  const bitmaps = readManifest(repoRoot);
  const subBitmaps = readSubManifests(repoRoot);
  const selection = selectMembers(bitmaps, subBitmaps, readSounds(repoRoot));
  const minimalArt = readMinimalArt(options.minimalArtList ?? join(repoRoot, MINIMAL_ART_LIST));
  const hash = inputHash(
    repoRoot,
    [...bitmaps, ...subBitmaps.filter((b) => UI_SUB_MOVIES.includes(b.cast))],
    selection.sounds,
    addedDir,
    JSON.stringify(minimalArt),
  );
  const indexPath = join(outDir, "index.json");
  // A build into another folder (a test) keeps the pack's art beside it, never in the real pack.
  const packArtDir =
    options.packArtDir ?? (options.outDir ? join(options.outDir, "classic-art") : CLASSIC_ART_DIR);
  const packIndexPath = join(packArtDir, "index.json");
  const minimalArtDir =
    options.minimalArtDir ??
    (options.outDir ? join(options.outDir, "minimal-art") : MINIMAL_ART_DIR);
  const minimalIndexPath = join(minimalArtDir, "index.json");
  if (
    !options.force &&
    existsSync(indexPath) &&
    existsSync(packIndexPath) &&
    existsSync(minimalIndexPath)
  ) {
    try {
      const old = JSON.parse(readFileSync(indexPath, "utf8")) as AssetIndex;
      const oldPack = JSON.parse(readFileSync(packIndexPath, "utf8")) as PackArtIndex;
      const oldMinimal = JSON.parse(readFileSync(minimalIndexPath, "utf8")) as PackArtIndex;
      if (old.inputHash === hash && oldPack.inputHash === hash && oldMinimal.inputHash === hash) {
        return { skipped: true, files: 0, bytes: 0, sheets: {}, sprites: {}, uiFiles: 0 };
      }
    } catch {
      // rebuild
    }
  }

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(join(outDir, "ui"), { recursive: true });
  const stats: BuildStats = {
    skipped: false,
    files: 0,
    bytes: 0,
    sheets: {},
    sprites: {},
    uiFiles: 0,
  };
  const write = (rel: string, bytes: Uint8Array | string) => {
    writeFileSync(join(outDir, rel), bytes);
    stats.files += 1;
    stats.bytes += typeof bytes === "string" ? Buffer.byteLength(bytes) : bytes.length;
  };
  const load = (b: ManifestBitmap) => () => loadOriginal(repoRoot, b);

  const atlases = {} as Record<AtlasGroup, AtlasIndex>;
  const minimalAtlases = {} as Record<AtlasGroup, AtlasIndex>;
  const minimalSheets = new Map<string, Uint8Array>();
  const added = listAdded(addedDir);
  const originalSides = readOriginalSidecars(repoRoot);
  const groups = Object.keys(GROUP_CAST).sort() as AtlasGroup[];
  checkOriginalSidecars(
    groups.flatMap((group) =>
      selection.atlas[group].map(({ b, name }) => ({ group, cast: b.cast, name })),
    ),
    originalSides,
  );
  for (const group of groups) {
    const byKey = new Map<string, Source>();
    for (const { b, name } of selection.atlas[group]) {
      const side = originalSides.get(originalSidecarKey(b.cast, name));
      byKey.set(name.toLowerCase(), {
        name,
        key: name.toLowerCase(),
        img: load(b),
        regX: b.regX,
        regY: b.regY,
        rule: ATLAS_RULE,
        mirrored: side?.mirrored === true,
      });
    }
    for (const s of added.art.filter((x) => x.group === group)) {
      const key = s.name.toLowerCase();
      if (byKey.has(key)) {
        throw new Error(
          `assets/added/${group}/${s.name}.png collides with an original ${GROUP_CAST[group]} member`,
        );
      }
      const side = s.side;
      byKey.set(key, {
        name: s.name,
        key,
        img: () => decodePng(new Uint8Array(readFileSync(s.png))),
        regX: side.regX,
        regY: side.regY,
        rule: ruleForSidecar(side.key),
        mirrored: side.mirrored === true,
      });
    }
    const sources = [...byKey.values()];
    const images = new Map<string, Rgba>();
    for (const s of sources) {
      const img = s.img();
      applyKey(img, s.rule);
      images.set(s.key, img);
    }
    // Each mirrored body's centre line, from its standing north frame before any is flipped.
    const lines = new Map<string, number>();
    for (const s of sources) {
      const standing = standingFrameOf(s.name)?.toLowerCase();
      if (group !== "bodies" || !s.mirrored || !standing || lines.has(standing)) {
        continue;
      }
      const from = byKey.get(standing);
      if (!from) {
        throw new Error(
          `bodies ${s.name}: mirrored, but there is no ${standingFrameOf(s.name)} to centre it on`,
        );
      }
      lines.set(standing, centreLine2(images.get(standing) as Rgba, from.regX));
    }
    for (const s of sources) {
      if (!s.mirrored) {
        continue;
      }
      const img = images.get(s.key) as Rgba;
      if (group === "paperdoll") {
        images.set(s.key, mirrorPaperdoll(img, `${group} ${s.name}`));
      } else {
        const line2 = lines.get(standingFrameOf(s.name)?.toLowerCase() ?? "") as number;
        const flipped = mirrorBody(img, s.regX, line2);
        images.set(s.key, flipped.img);
        s.regX = flipped.regX;
      }
    }
    const packed = packAtlas(sources, images);
    const files = packed.sheets.map((sheet, i) => {
      const file = `${group}-${i}.png`;
      write(file, encodePng(sheet));
      return file;
    });
    atlases[group] = { sheets: files, sprites: packed.sprites };
    stats.sheets[group] = packed.layout;
    stats.sprites[group] = sources.length;
    // The Minimal pack's few pictures, packed on their own from the same keyed images.
    const wanted = new Set(minimalArt[group]);
    // A build with other inputs (a test's added folder) packs the listed pictures it has; the
    // data tests check that the real build has them all.
    const mine = sources.filter((s) => wanted.has(s.key));
    const small = packAtlas(mine, images);
    const minimalFiles = small.sheets.map((sheet, i) => {
      const file = `${group}-${i}.png`;
      minimalSheets.set(file, encodePng(sheet));
      return file;
    });
    minimalAtlases[group] = { sheets: minimalFiles, sprites: small.sprites };
  }

  const ui: Record<string, UiFile> = {};
  const uiImages = new Map<string, Rgba>();
  for (const b of selection.ui) {
    const img = load(b)();
    applyKey(img, ruleForUsage(b.scoreUsage, b.keyHint));
    uiImages.set(`${b.cast.toLowerCase()}:${b.member}`, img);
  }
  // The panel's tab icons are matted out of their wood and the four baked copies are
  // erased from Internal #186 (see assets-lib/panel-tabs.ts).
  const derived = derivePanelTabs(uiImages);
  for (const b of selection.ui) {
    const id = `${b.cast.toLowerCase()}:${b.member}`;
    const derivedImg = b.cast.toLowerCase() === "internal" ? derived.get(b.member) : undefined;
    const img = derivedImg ?? (uiImages.get(id) as Rgba);
    const file = uiFile(b);
    write(file, encodePng(img));
    ui[id] = { file, w: img.width, h: img.height, regX: b.regX, regY: b.regY };
    stats.uiFiles += 1;
  }

  mkdirSync(join(outDir, "sounds"), { recursive: true });
  const sounds: Record<string, string> = {};
  for (const snd of selection.sounds) {
    // The first asset is the media: `churchy`'s is the MP3; its 44-byte WAV is the empty
    // `snd ` chunk's wrapper. "stone skin" has a space; the file does not.
    const src = snd.asset[0] as string;
    const file = soundFile(snd);
    write(file, new Uint8Array(readFileSync(join(repoRoot, MAIN_ROOT, src))));
    sounds[snd.name.toLowerCase()] = file;
  }

  for (const snd of added.sounds) {
    const key = snd.name.toLowerCase();
    if (key in sounds) {
      throw new Error(
        `assets/added/sounds/${snd.name}${snd.ext} collides with an original Audio member`,
      );
    }
    const file = addedSoundFile(snd.name, snd.ext);
    write(file, new Uint8Array(readFileSync(snd.file)));
    sounds[key] = file;
  }

  // The Classic pack's art: every atlas sheet and every sound but the interface's clicks move to
  // the pack's art folder, with an index of their own. The engine index keeps the UI files.
  rmSync(packArtDir, { recursive: true, force: true });
  mkdirSync(join(packArtDir, "sounds"), { recursive: true });
  const move = (rel: string) => {
    writeFileSync(join(packArtDir, rel), readFileSync(join(outDir, rel)));
    rmSync(join(outDir, rel));
  };
  for (const group of groups) {
    for (const sheet of atlases[group].sheets) {
      move(sheet);
    }
  }
  const engineSounds: Record<string, string> = {};
  const packSounds: Record<string, string> = {};
  for (const [name, file] of Object.entries(sounds)) {
    if (ENGINE_SOUNDS.includes(name)) {
      engineSounds[name] = file;
    } else {
      move(file);
      packSounds[name] = file;
    }
  }
  const packIndex: PackArtIndex = { version: 1, inputHash: hash, atlases, sounds: packSounds };
  writeFileSync(packIndexPath, `${JSON.stringify(packIndex)}\n`);
  // The Minimal pack's art: its atlases and no sounds.
  rmSync(minimalArtDir, { recursive: true, force: true });
  mkdirSync(minimalArtDir, { recursive: true });
  for (const [file, bytes] of minimalSheets) {
    writeFileSync(join(minimalArtDir, file), bytes);
  }
  const minimalIndex: PackArtIndex = {
    version: 1,
    inputHash: hash,
    atlases: minimalAtlases,
    sounds: {},
  };
  writeFileSync(join(minimalArtDir, "index.json"), `${JSON.stringify(minimalIndex)}\n`);
  const noAtlases = Object.fromEntries(
    groups.map((g) => [g, { sheets: [], sprites: {} }]),
  ) as unknown as Record<AtlasGroup, AtlasIndex>;
  const index: AssetIndex = {
    version: 1,
    inputHash: hash,
    atlases: noAtlases,
    ui,
    sounds: engineSounds,
  };
  write("index.json", `${JSON.stringify(index)}\n`);
  return stats;
}

export const USAGE_PATH = "assets/original/usage.md";

const useText = (u: Use): string => {
  switch (u.kind) {
    case "atlas":
      return `atlas ${u.group}${u.as ? ` as ${u.as}` : ""}`;
    case "ui":
      return `ui ${u.file}`;
    case "sound":
      return `sound ${u.file}`;
    case "none":
      return `not built: ${u.reason}`;
  }
};

/**
 * The text of assets/original/usage.md: one row per original bitmap and sound member, in manifest
 * order, saying where the asset build puts it or why it does not.
 */
export function renderUsage(repoRoot: string = REPO_ROOT): string {
  const main = readManifest(repoRoot);
  const sub = readSubManifests(repoRoot);
  const sounds = readSounds(repoRoot);
  const sel = selectMembers(main, sub, sounds);
  const esc = (t: string) => t.replaceAll("|", "\\|");
  const rows: string[] = [];
  for (const movie of [MAIN_MOVIE, ...subMovies(repoRoot)]) {
    const members: { castLib: number; member: number; line: string }[] = [];
    for (const b of [...main, ...sub]) {
      if (b.movie === movie) {
        const use = sel.bitmapUse.get(b) as Use;
        members.push({
          castLib: b.castLib,
          member: b.member,
          line: `| ${movie} | ${b.castName} | ${b.member} | ${esc(b.name)} | bitmap | ${esc(b.asset)} | ${esc(useText(use))} |`,
        });
      }
    }
    for (const snd of sounds) {
      if (snd.movie === movie) {
        const use = sel.soundUse.get(snd) as Use;
        members.push({
          castLib: snd.castLib,
          member: snd.member,
          line: `| ${movie} | ${snd.cast} | ${snd.member} | ${esc(snd.name)} | sound | ${esc(snd.asset.join(", "))} | ${esc(useText(use))} |`,
        });
      }
    }
    members.sort((a, b) => a.castLib - b.castLib || a.member - b.member);
    rows.push(...members.map((m) => m.line));
  }
  return `# Original assets

Every bitmap and sound extracted from First Star Online 1.6's main movie and its 24 sub-movies,
copied byte for byte (scripts, field text and the Director movies are not copied). The folders
are the extractor's layout: \`main/{bitmaps,sounds,layout}/\` and \`sub/<movie>/{bitmaps,sounds,layout}/\`, and
the \`file\` column is relative to the movie's folder here. Member names, sizes and registration
points are in \`<movie>/layout/cast-manifest.jsonl\`.

The last column says what \`bun run assets:build\` does with the member:

- \`atlas <group>\`: packed into that sprite atlas under its own name (\`as <Name>\`: under the bag
  pool's name);
- \`ui <file>\`: written as one file in \`packages/data/assets/\`;
- \`sound <file>\`: copied into the Classic pack's sounds folder, except for the engine's interface sounds
  (\`clicksound\` and \`clicksound2\`) in \`packages/data/assets/sounds/\`;
- \`not built: <reason>\`: left out.

"Built" means the build ships it, not that something draws or plays it in the game. New art
and sounds go in \`assets/added/\`, which this list does not cover.

Generated by \`bun run assets:build\` (do not edit by hand); a test fails when it is out of date.

| movie | cast | # | name | type | file | SSO |
| --- | --- | --- | --- | --- | --- | --- |
${rows.join("\n")}
`;
}

if (import.meta.main) {
  const started = performance.now();
  const stats = buildAssets({ force: process.argv.includes("--force") });
  if (stats.skipped) {
    console.log("assets:build: up to date");
  } else {
    const mb = (stats.bytes / 1e6).toFixed(1);
    console.log(
      `assets:build: ${stats.files} files, ${mb} MB in ${((performance.now() - started) / 1000).toFixed(1)} s`,
    );
    for (const [g, sheets] of Object.entries(stats.sheets)) {
      console.log(
        `  ${g}: ${stats.sprites[g]} sprites on ${sheets.map((s) => `${s.w}×${s.h}`).join(", ")}`,
      );
    }
    console.log(`  ui: ${stats.uiFiles} files`);
  }
  const usagePath = join(REPO_ROOT, USAGE_PATH);
  const usage = renderUsage();
  if (!existsSync(usagePath) || readFileSync(usagePath, "utf8") !== usage) {
    writeFileSync(usagePath, usage);
    console.log("assets:build: usage.md updated");
  }
}
