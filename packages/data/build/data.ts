/** Build strictly validated game modules from editable content and retained art metadata. */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { z } from "zod";

import { attPowerDataSchema } from "../schema/attpower.ts";
import { casinoDataSchema } from "../schema/casino.ts";
import { churchMapDataSchema } from "../schema/church-map.ts";
import { classesDataSchema } from "../schema/classes.ts";
import { craftDataSchema } from "../schema/craft.ts";
import { gatherDataSchema } from "../schema/gather.ts";
import { helpDataSchema } from "../schema/help.ts";
import { houseDataSchema } from "../schema/houses.ts";
import { itemRulesDataSchema } from "../schema/item-rules.ts";
import { itemsDataSchema } from "../schema/items.ts";
import { jailMapDataSchema } from "../schema/jail-map.ts";
import { monstersDataSchema } from "../schema/monsters.ts";
import { npcFilesDataSchema } from "../schema/npcfiles.ts";
import { questDataSchema } from "../schema/quests.ts";
import { rectsDataSchema } from "../schema/rects.ts";
import { seedMapDataSchema } from "../schema/seed-map.ts";
import { socialDataSchema } from "../schema/social.ts";
import { spellsDataSchema } from "../schema/spells.ts";
import { tilesDataSchema } from "../schema/tiles.ts";
import { listAdded } from "./assets-lib/added.ts";
import { pngSize } from "./assets-lib/png.ts";

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

/** The modules written to src/generated/, in index order. */
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
  {
    module: "tiles",
    schema: tilesDataSchema,
    dataName: "tilesData",
    typeName: "TilesData",
  },
  {
    module: "items",
    schema: itemsDataSchema,
    dataName: "itemsData",
    typeName: "ItemsData",
  },
  {
    module: "classes",
    schema: classesDataSchema,
    dataName: "classesData",
    typeName: "ClassesData",
  },
  {
    module: "attpower",
    schema: attPowerDataSchema,
    dataName: "attPowerData",
    typeName: "AttPowerData",
  },
  {
    module: "item-rules",
    schema: itemRulesDataSchema,
    dataName: "itemRulesData",
    typeName: "ItemRulesData",
  },
  {
    module: "monsters",
    schema: monstersDataSchema,
    dataName: "monstersData",
    typeName: "MonstersData",
  },
  {
    module: "help",
    schema: helpDataSchema,
    dataName: "helpData",
    typeName: "HelpData",
  },
  {
    module: "spells",
    schema: spellsDataSchema,
    dataName: "spellsData",
    typeName: "SpellsData",
  },
  {
    module: "gather",
    schema: gatherDataSchema,
    dataName: "gatherData",
    typeName: "GatherData",
  },
  {
    module: "craft",
    schema: craftDataSchema,
    dataName: "craftData",
    typeName: "CraftData",
  },
  {
    module: "houses",
    schema: houseDataSchema,
    dataName: "houseData",
    typeName: "HouseData",
  },
  {
    module: "social",
    schema: socialDataSchema,
    dataName: "socialData",
    typeName: "SocialData",
  },
  {
    module: "casino",
    schema: casinoDataSchema,
    dataName: "casinoData",
    typeName: "CasinoData",
  },
  {
    module: "quests",
    schema: questDataSchema,
    dataName: "questData",
    typeName: "QuestData",
  },
];

/**
 * The member rects of casts FX, Chars and Inventory from the cast manifest (schema/rects.ts): the first
 * member of each name, lower-cased; then the rect of each added `fx`, `bodies` and `items` image
 * (width and height from the PNG, registration point from its sidecar: the same bounding rect
 * Director's `intersects` uses for an original). Pure apart from reading the manifest and
 * assets/added/.
 */
export function renderRects(
  manifest = CAST_MANIFEST,
  addedDir = ADDED_DIR,
): { [key: string]: Json } {
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
  for (const r of rows) {
    const table = r.cast === "FX" ? out.fx : r.cast === "Chars" ? out.chars : out.items;
    const key = String(r.name).toLowerCase();
    const rect = r.rect;
    if (key === "" || key in table || !Array.isArray(rect)) {
      continue;
    }
    const w = Number(rect[2]) - Number(rect[0]);
    const h = Number(rect[3]) - Number(rect[1]);
    table[key] = [w, h, Number(r.regX), Number(r.regY)];
  }
  const addedTable = { fx: out.fx, bodies: out.chars, items: out.items } as const;
  for (const a of listAdded(addedDir).art) {
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
    table[key] = [width, height, a.side.regX, a.side.regY];
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
  // Server only: kept off the index, imported through `@secondstaronline/data/rects`.
  const rects = rectsDataSchema.parse(renderRects());
  out.set(
    "rects.ts",
    "// Generated by packages/data/build/data.ts from assets/original/main/layout/cast-manifest.jsonl\n" +
      "// and assets/added/.\n" +
      "// Do not edit: run `bun run data:build`.\n" +
      'import type { RectsData } from "../../schema/rects.ts";\n\n' +
      `export const rectsData: RectsData = ${JSON.stringify(rects)};\n`,
  );
  // Server only: the NPC files as text, through `@secondstaronline/data/npcfiles`.
  out.set(
    "npcfiles.ts",
    `${HEADER("content/npc-files.json")}import type { NpcFilesData } from "../../schema/npcfiles.ts";\n\n` +
      `export const npcFilesData: NpcFilesData = ${JSON.stringify(readNpcFiles(contentDir), null, 1)};\n`,
  );
  out.set("index.ts", `${HEADER("content/*.json")}${index.join("\n")}\n`);
  return out;
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
  if (process.argv.includes("--check")) {
    const stale = findStaleModules(modules);
    if (stale.length > 0) {
      const lines: string[] = [];
      if (stale.length > 0) {
        lines.push(
          "data:check: packages/data/src/generated/ is out of date. Run `bun run data:build`.",
          ...stale.map((p) => `  ${p}`),
        );
      }
      console.error(lines.join("\n"));
      process.exit(1);
    }
    console.log(`data:check: all ${modules.size} generated modules are current`);
  } else {
    rmSync(GENERATED_DIR, { recursive: true, force: true });
    mkdirSync(GENERATED_DIR, { recursive: true });
    for (const [name, text] of modules) {
      writeFileSync(join(GENERATED_DIR, name), text);
    }
    console.log(`data:build wrote ${modules.size} modules to packages/data/src/generated/`);
  }
}
