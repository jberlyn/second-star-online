/** Build strictly validated game modules from editable content and retained art metadata. */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { z } from "zod";

import { churchMapDataSchema } from "../schema/church-map.ts";
import { DATASET_FILES, DATASET_SCHEMAS, type SchemaDatasetId } from "../schema/datasets.ts";
import { jailMapDataSchema } from "../schema/jail-map.ts";
import { npcFilesDataSchema } from "../schema/npcfiles.ts";
import { type PackManifest, packManifestSchema } from "../schema/pack.ts";
import { rectsDataSchema } from "../schema/rects.ts";
import { seedMapDataSchema } from "../schema/seed-map.ts";
import { tilesDataSchema } from "../schema/tiles.ts";
import { listAdded } from "./assets-lib/added.ts";
import { keyedAdded, keyedOriginal } from "./assets-lib/load.ts";
import { centreLine2, standingFrameOf } from "./assets-lib/mirror.ts";
import { originalSidecarKey, readOriginalSidecars } from "./assets-lib/original-sidecars.ts";
import { pngSize } from "./assets-lib/png.ts";
import type { ManifestBitmap } from "./assets-lib/select.ts";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const CONTENT = join(import.meta.dir, "..", "content");
const CAST_MANIFEST = join(
  REPO_ROOT,
  "assets",
  "original",
  "main",
  "layout",
  "cast-manifest.jsonl",
);
const ADDED_DIR = join(REPO_ROOT, "assets", "added");
export const GENERATED_DIR = join(import.meta.dir, "..", "src", "generated");
/** The built Classic pack (committed, like the generated modules). */
export const CLASSIC_PACK_DIR = join(import.meta.dir, "..", "packs", "classic");
/** The Classic pack's source manifest. */
const PACK_SOURCE = "pack.json";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Obj = { [key: string]: Json };

interface Module {
  /** Module name: the file stem under content/ and src/generated/, and the schema file. */
  module: string;
  schema: z.ZodType;
  /** Exported names and the schema module type they carry. */
  dataName: string;
  typeName: string;
  /** False keeps it out of the generated index (imported through its own subpath). */
  index?: false;
}

/** The modules written to src/generated/, in index order: the seed maps (operator data, not pack rows). */
export const MODULES: readonly Module[] = [
  {
    module: "jail-map",
    schema: jailMapDataSchema,
    dataName: "jailMapData",
    typeName: "JailMapData",
  },
  {
    module: "church-map",
    schema: churchMapDataSchema,
    dataName: "churchMapData",
    typeName: "ChurchMapData",
  },
  {
    module: "seed-map",
    schema: seedMapDataSchema,
    dataName: "seedMapData",
    typeName: "SeedMapData",
  },
];

/**
 * The member rects of casts FX, Chars and Inventory from the cast manifest (schema/rects.ts): the first
 * member of each name, lower-cased; then the rect of each added `fx`, `bodies` and `items` image
 * (width and height from the PNG, registration point from its sidecar: the same bounding rect
 * Director's `intersects` uses for an original). A mirrored north frame's regX is moved by
 * the flip, as the asset build makes it (build/assets-lib/mirror.ts) when its sidecar says so.
 * Pure apart from reading the manifest, assets/original-sidecars.json, the mirrored bodies'
 * standing frames and assets/added/.
 */
export function renderRects(
  manifest = CAST_MANIFEST,
  addedDir = ADDED_DIR,
  repoRoot = REPO_ROOT,
): { [key: string]: Json } {
  const originalSides = readOriginalSidecars(repoRoot);
  const out: { fx: Obj; chars: Obj; items: Obj } = { fx: {}, chars: {}, items: {} };
  const rows = readFileSync(manifest, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as Obj)
    .filter(
      (r) =>
        (r.cast === "FX" || r.cast === "Chars" || r.cast === "Inventory") && r.type === "bitmap",
    )
    .sort((a, b) => Number(a.member) - Number(b.member));
  const firstChars = new Map<string, Obj>();
  for (const r of rows) {
    if (r.cast === "Chars" && !firstChars.has(String(r.name))) {
      firstChars.set(String(r.name), r);
    }
  }
  /** A mirrored body's centre line, from its standing frame as the asset build keys it. */
  const originalLine = (name: string): number => {
    const standing = firstChars.get(standingFrameOf(name) ?? "");
    if (!standing) {
      throw new Error(
        `Chars ${name}: mirrored, but there is no ${standingFrameOf(name)} to centre it on`,
      );
    }
    const b = standing as unknown as ManifestBitmap;
    return centreLine2(keyedOriginal(repoRoot, b), Number(b.regX));
  };
  for (const r of rows) {
    const table = r.cast === "FX" ? out.fx : r.cast === "Chars" ? out.chars : out.items;
    const key = String(r.name).toLowerCase();
    const rect = r.rect;
    if (key === "" || key in table || !Array.isArray(rect)) {
      continue;
    }
    const w = Number(rect[2]) - Number(rect[0]);
    const h = Number(rect[3]) - Number(rect[1]);
    const regX =
      r.cast === "Chars" && originalSides.get(originalSidecarKey("Chars", String(r.name)))?.mirrored
        ? w - Number(r.regX) - originalLine(String(r.name))
        : Number(r.regX);
    table[key] = [w, h, regX, Number(r.regY)];
  }
  const addedTable = { fx: out.fx, bodies: out.chars, items: out.items } as const;
  const addedArt = listAdded(addedDir).art;
  const addedLine = (name: string): number => {
    const standing = addedArt.find((x) => x.group === "bodies" && x.name === standingFrameOf(name));
    if (!standing) {
      throw new Error(
        `assets/added/bodies/${name}.png: mirrored, but there is no ${standingFrameOf(name)} to centre it on`,
      );
    }
    return centreLine2(keyedAdded(standing.png, standing.side), standing.side.regX);
  };
  for (const a of addedArt) {
    if (a.group !== "fx" && a.group !== "bodies" && a.group !== "items") {
      continue; // tiles and paperdoll layers have no rect
    }
    const table = addedTable[a.group];
    const key = a.name.toLowerCase();
    if (key in table) {
      throw new Error(
        `assets/added/${a.group}/${a.name}.png collides with an original ${a.group === "fx" ? "FX" : a.group === "bodies" ? "Chars" : "Inventory"} member`,
      );
    }
    const { width, height } = pngSize(new Uint8Array(readFileSync(a.png)));
    const regX = a.side.mirrored ? width - a.side.regX - addedLine(a.name) : a.side.regX;
    table[key] = [width, height, regX, a.side.regY];
  }
  const sorted = (t: Obj): Obj =>
    Object.fromEntries(
      Object.keys(t)
        .sort()
        .map((k) => [k, t[k] ?? null]),
    );
  return { fx: sorted(out.fx), chars: sorted(out.chars), items: sorted(out.items) };
}

/** The header line of a generated module. */
const HEADER = (from: string) =>
  `// Generated by packages/data/build/data.ts from packages/data/${from}.\n// Do not edit: run \`bun run data:build\`.\n`;

/** The NPC files as content/npc-files.json holds them (schema/npcfiles.ts). */
export function readNpcFiles(contentDir = CONTENT): unknown {
  return npcFilesDataSchema.parse(
    JSON.parse(readFileSync(join(contentDir, "npc-files.json"), "utf8")),
  );
}

/** Renders every generated module. Reads editable content and retained art metadata. */
export function renderDataModules(contentDir = CONTENT): Map<string, string> {
  const out = new Map<string, string>();
  const index: string[] = [];
  for (const m of MODULES) {
    const data = JSON.parse(readFileSync(join(contentDir, `${m.module}.json`), "utf8")) as Json;
    const from = `content/${m.module}.json`;
    const parsed = m.schema.safeParse(data);
    if (!parsed.success) {
      throw new Error(`${from} does not match its schema:\n${parsed.error.message}`);
    }
    if (m.module === "seed-map" || m.module === "jail-map" || m.module === "church-map") {
      const seed = seedMapDataSchema.parse(data);
      const tiles = tilesDataSchema.parse(
        JSON.parse(readFileSync(join(contentDir, "tiles.json"), "utf8")),
      );
      const codes = new Set(tiles.catalogue.map((tile) => tile.code));
      for (const layer of seed.layers) {
        for (const row of layer) {
          for (const code of row.split(" ")) {
            if (!codes.has(code)) {
              throw new Error(`${from} references unknown tile ${code}`);
            }
          }
        }
      }
    }
    const base = m.module;
    out.set(
      `${base}.ts`,
      `${HEADER(from)}import type { ${m.typeName} } from "../../schema/${base}.ts";\n\n` +
        `export const ${m.dataName}: ${m.typeName} = ${JSON.stringify(data, null, 2)};\n`,
    );
    if (m.index !== false) {
      index.push(`export { ${m.dataName} } from "./${base}.ts";`);
    }
  }
  out.set("index.ts", `${HEADER("content/*.json")}${index.join("\n")}\n`);
  return out;
}

/** A dataset as the Classic pack carries it: the content file, or the rects built from the art. */
function classicDataset(id: SchemaDatasetId, contentDir: string): Json {
  if (id === "rects") {
    return rectsDataSchema.parse(renderRects()) as Json;
  }
  if (id === "npcFiles") {
    return readNpcFiles(contentDir) as Json;
  }
  const from = `content/${DATASET_FILES[id]}.json`;
  const data = JSON.parse(readFileSync(join(contentDir, `${DATASET_FILES[id]}.json`), "utf8"));
  const parsed = DATASET_SCHEMAS[id].safeParse(data);
  if (!parsed.success) {
    throw new Error(`${from} does not match its schema:\n${parsed.error.message}`);
  }
  return data as Json;
}

/** The SHA-256 (first 16 hex) of a pack's data files, in dataset order. */
export function packContentHash(files: Map<string, string>): string {
  const h = createHash("sha256");
  for (const id of Object.keys(DATASET_FILES) as SchemaDatasetId[]) {
    const path = `data/${DATASET_FILES[id]}.json`;
    h.update(`${path}\n${files.get(path) ?? ""}\n`);
  }
  return h.digest("hex").slice(0, 16);
}

/** The Classic pack's source manifest (`content/pack.json`). */
export function readPackSource(contentDir = CONTENT): PackManifest {
  return packManifestSchema.parse(JSON.parse(readFileSync(join(contentDir, PACK_SOURCE), "utf8")));
}

/** The pack's version with the patch number raised by one. */
export function bumpPatch(version: string): string {
  const [major = 0, minor = 0, patch = 0] = version.split(".").map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

export interface RenderedPack {
  /** Path inside the pack folder → file text. */
  files: Map<string, string>;
  /** The manifest the pack carries. */
  manifest: PackManifest;
  /** Whether `content/pack.json` records a different hash (the content changed: bump it). */
  sourceStale: boolean;
}

/**
 * Renders the Classic pack: `data/<file>.json` for every dataset, validated by its schema, and
 * `manifest.json` from `content/pack.json`. When the data's hash differs from the one the source
 * manifest records, the content changed since that version: the build bumps the patch version
 * and records the new hash (`sourceStale`), and `data:check` fails until it has.
 */
export function renderClassicPack(contentDir = CONTENT): RenderedPack {
  const files = new Map<string, string>();
  for (const id of Object.keys(DATASET_FILES) as SchemaDatasetId[]) {
    const data = classicDataset(id, contentDir);
    const text = id === "rects" ? JSON.stringify(data) : JSON.stringify(data, null, 2);
    files.set(`data/${DATASET_FILES[id]}.json`, `${text}\n`);
  }
  const source = readPackSource(contentDir);
  const contentHash = packContentHash(files);
  const sourceStale = source.contentHash !== contentHash;
  const manifest: PackManifest = sourceStale
    ? { ...source, version: bumpPatch(source.version), contentHash }
    : source;
  files.set("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
  return { files, manifest, sourceStale };
}

/** Every file under `dir`, relative, with forward slashes. */
function listFiles(dir: string, prefix = ""): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  const out: string[] = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${name.name}` : name.name;
    if (name.isDirectory()) {
      out.push(...listFiles(join(dir, name.name), rel));
    } else {
      out.push(rel);
    }
  }
  return out;
}

/** Like `findStaleModules`, for the files of a built pack folder (nested paths). */
export function findStalePack(files: Map<string, string>, dir = CLASSIC_PACK_DIR): string[] {
  const problems: string[] = [];
  // The art folder is built by `bun run assets:build` and gitignored, so it is not checked here.
  const onDisk = listFiles(dir).filter((f) => !f.startsWith("art/"));
  for (const [name, text] of files) {
    if (!onDisk.includes(name)) {
      problems.push(`missing: ${name}`);
    } else if (readFileSync(join(dir, name), "utf8") !== text) {
      problems.push(`stale: ${name}`);
    }
  }
  for (const name of onDisk) {
    if (!files.has(name)) {
      problems.push(`extra: ${name}`);
    }
  }
  return problems.sort();
}

/**
 * Compares `modules` with the files in `dir` and describes every difference: a module
 * whose file is missing or differs, and a file in `dir` that the build would not write.
 * Empty when the directory is current.
 */
export function findStaleModules(modules: Map<string, string>, dir = GENERATED_DIR): string[] {
  const problems: string[] = [];
  const onDisk = existsSync(dir) ? readdirSync(dir) : [];
  for (const [name, text] of modules) {
    if (!onDisk.includes(name)) {
      problems.push(`missing: ${name}`);
    } else if (readFileSync(join(dir, name), "utf8") !== text) {
      problems.push(`stale: ${name}`);
    }
  }
  for (const name of onDisk) {
    if (!modules.has(name)) {
      problems.push(`extra: ${name}`);
    }
  }
  return problems.sort();
}

if (import.meta.main) {
  const modules = renderDataModules();
  const pack = renderClassicPack();
  if (process.argv.includes("--check")) {
    const stale = findStaleModules(modules);
    const stalePack = findStalePack(pack.files);
    const lines: string[] = [];
    if (stale.length > 0) {
      lines.push(
        "data:check: packages/data/src/generated/ is out of date. Run `bun run data:build`.",
        ...stale.map((p) => `  ${p}`),
      );
    }
    if (pack.sourceStale) {
      lines.push(
        "data:check: the Classic content changed but content/pack.json still records the old hash. Run `bun run data:build` to bump the pack version.",
      );
    }
    if (stalePack.length > 0) {
      lines.push(
        "data:check: packages/data/packs/classic/ is out of date. Run `bun run data:build`.",
        ...stalePack.map((p) => `  ${p}`),
      );
    }
    if (lines.length > 0) {
      console.error(lines.join("\n"));
      process.exit(1);
    }
    console.log(
      `data:check: all ${modules.size} generated modules and the Classic pack (v${pack.manifest.version}) are current`,
    );
  } else {
    rmSync(GENERATED_DIR, { recursive: true, force: true });
    mkdirSync(GENERATED_DIR, { recursive: true });
    for (const [name, text] of modules) {
      writeFileSync(join(GENERATED_DIR, name), text);
    }
    if (pack.sourceStale) {
      writeFileSync(join(CONTENT, PACK_SOURCE), `${JSON.stringify(pack.manifest, null, 2)}\n`);
      console.log(
        `data:build: the Classic content changed, so the pack is now v${pack.manifest.version}`,
      );
    }
    // The art folder belongs to the asset build: keep it.
    rmSync(join(CLASSIC_PACK_DIR, "data"), { recursive: true, force: true });
    rmSync(join(CLASSIC_PACK_DIR, "manifest.json"), { force: true });
    mkdirSync(join(CLASSIC_PACK_DIR, "data"), { recursive: true });
    for (const [name, text] of pack.files) {
      writeFileSync(join(CLASSIC_PACK_DIR, name), text);
    }
    console.log(
      `data:build wrote ${modules.size} modules to packages/data/src/generated/ and the Classic pack (v${pack.manifest.version}) to packages/data/packs/classic/`,
    );
  }
}
