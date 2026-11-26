/**
 * Reading content packs. A pack is a manifest plus one JSON file per dataset, each validated by
 * that dataset's schema. A pack shipped in the release is read from its folder in the release
 * image; an imported pack is read from the JSON the database keeps for it.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  DATASET_FILES,
  DATASET_SCHEMAS,
  EXPORT_PACK_FORMAT,
  type PackManifest,
  packManifestSchema,
  type SchemaDatasetId,
  type WorldSeed,
  worldItemProblems,
  worldSeedSchema,
} from "@secondstaronline/data/schema";
import { type ContentData, DATASET_IDS, type DatasetId } from "@secondstaronline/shared";

import { withFishingCast } from "../persistence/fishing-cast-content.ts";
import { keyField, partOf, READ_ONLY_DATASETS, type RowRef } from "./rows.ts";

/** A pack's manifest and validated datasets (a pack may leave datasets out). */
export interface LoadedPack {
  manifest: PackManifest;
  data: Partial<ContentData>;
  /** The folder holding the pack's art (`<pack>/<manifest.art>`), when it has art there. */
  artDir: string | null;
  /**
   * The folder holding the files the pack's art rows name (`<pack>/<manifest.files>`), or null:
   * they come from the server's upload store (issue #29, stage 8).
   */
  filesDir: string | null;
  /** The world a new database created with this pack starts from (`manifest.world`). */
  world: WorldSeed | null;
  /** The rows it removes from the packs under it (an exported pack's, issue #34). */
  removals: RowRef[];
}

/** An imported pack as the database stores it: the manifest and each dataset by file stem. */
export interface PackBlob {
  manifest: unknown;
  data: Record<string, unknown>;
  /** An exported pack's removals (issue #34). */
  removals?: unknown;
}

/** Reads a pack's removals: each a dataset, one of its fields and a key (null for a section). */
export function readRemovals(packId: string, value: unknown): RowRef[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.length > 100_000) {
    throw new Error(`pack ${packId}: its removals are not a list`);
  }
  return value.map((r, i) => {
    const o = r as { dataset?: unknown; part?: unknown; key?: unknown } | null;
    const dataset = o?.dataset;
    const part = o?.part;
    const key = o?.key;
    const known =
      typeof dataset === "string" &&
      (DATASET_IDS as readonly string[]).includes(dataset) &&
      !(READ_ONLY_DATASETS as readonly string[]).includes(dataset) &&
      typeof part === "string";
    const where = known ? partOf(dataset as DatasetId, part as string) : null;
    const keyed = known ? keyField(dataset as DatasetId, part as string) !== null : false;
    // A keyed list's entry is removed by its key; a whole field only when the world may leave it out.
    const ok =
      where !== null &&
      (keyed
        ? typeof key === "string" && key.length > 0 && key.length <= 200
        : key === null && where.optional);
    if (!ok) {
      throw new Error(`pack ${packId}: removal ${i + 1} does not name a row it can remove`);
    }
    return { dataset: dataset as DatasetId, part: part as string, key: key as string | null };
  });
}

/** Validates one dataset of a pack, naming the pack and file in the error. */
function validDataset(packId: string, id: SchemaDatasetId, value: unknown): unknown {
  const parsed = DATASET_SCHEMAS[id].safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `pack ${packId}: data/${DATASET_FILES[id]}.json does not match its schema:\n${parsed.error.message}`,
    );
  }
  return value;
}

/**
 * Validates one dataset of an exported pack (format 2, issue #34), which holds only the rows it
 * changes: each field it has is checked on its own; the store the packs make is checked whole
 * when they are merged.
 */
function validPartial(packId: string, id: SchemaDatasetId, value: unknown): unknown {
  const where = `pack ${packId}: data/${DATASET_FILES[id]}.json`;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${where} is not an object`);
  }
  const shape = (
    DATASET_SCHEMAS[id] as unknown as {
      shape?: Record<string, { safeParse(v: unknown): { success: boolean; error?: unknown } }>;
    }
  ).shape;
  for (const [part, v] of Object.entries(value)) {
    const field = shape && Object.hasOwn(shape, part) ? shape[part] : undefined;
    if (!field) {
      throw new Error(`${where} has a field "${part}" its dataset does not`);
    }
    const parsed = field.safeParse(v);
    if (!parsed.success) {
      throw new Error(`${where}: ${part} does not match its schema:\n${String(parsed.error)}`);
    }
  }
  return value;
}

/** Reads a pack folder (`manifest.json`, `data/<file>.json`). Throws on anything invalid. */
export function readPackDir(dir: string): LoadedPack {
  const manifest = packManifestSchema.parse(
    JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")),
  );
  const data: Record<string, unknown> = {};
  for (const id of Object.keys(DATASET_FILES) as SchemaDatasetId[]) {
    const file = join(dir, "data", `${DATASET_FILES[id]}.json`);
    if (existsSync(file)) {
      data[id] = validDataset(manifest.id, id, JSON.parse(readFileSync(file, "utf8")));
    }
  }
  const artDir = manifest.art ? join(dir, manifest.art) : null;
  let world: WorldSeed | null = null;
  if (manifest.world) {
    const parsed = worldSeedSchema.safeParse(
      JSON.parse(readFileSync(join(dir, manifest.world), "utf8")),
    );
    if (!parsed.success) {
      throw new Error(
        `pack ${manifest.id}: ${manifest.world} does not match its schema:\n${parsed.error.message}`,
      );
    }
    world = parsed.data;
    // A placed pile of more than one gives its count as `qty`, except the currency and crystals.
    const items = data.items as { items: { name: string }[]; fixtures: string[] } | undefined;
    const bindings = data.bindings as { currency: { item?: string | null } } | undefined;
    const problems = worldItemProblems(
      world,
      [...(items?.items.map((i) => i.name) ?? []), ...(items?.fixtures ?? [])],
      bindings?.currency.item ?? null,
    );
    if (problems.length > 0) {
      throw new Error(
        `pack ${manifest.id}: ${manifest.world} places items it cannot:\n${problems.join("\n")}`,
      );
    }
  }
  return {
    manifest,
    data: data as Partial<ContentData>,
    artDir: artDir && existsSync(join(artDir, "index.json")) ? artDir : null,
    filesDir: manifest.files ? join(dir, manifest.files) : null,
    world,
    removals: [],
  };
}

/** Reads an imported pack from the JSON the database keeps. Throws on anything invalid. */
export function readPackBlob(json: string): LoadedPack {
  return readPackObject(JSON.parse(json) as PackBlob);
}

/** Reads an imported pack already parsed. Throws on anything invalid. */
export function readPackObject(blob: PackBlob): LoadedPack {
  if (!blob || typeof blob !== "object") {
    throw new Error("the pack is not an object");
  }
  const parsed = packManifestSchema.safeParse(blob.manifest);
  if (!parsed.success) {
    throw new Error(`the pack's manifest is not valid:\n${parsed.error.message}`);
  }
  const manifest = parsed.data;
  const data: Record<string, unknown> = {};
  const stems = new Set(Object.values(DATASET_FILES) as string[]);
  for (const stem of Object.keys(blob.data ?? {})) {
    if (!stems.has(stem)) {
      throw new Error(`pack ${manifest.id}: data/${stem}.json is not a dataset`);
    }
  }
  for (const id of Object.keys(DATASET_FILES) as SchemaDatasetId[]) {
    let value = blob.data?.[DATASET_FILES[id]];
    // A pack exported before fishing's cast became content (migration 76) plays what it played.
    if (id === "gather" && value && typeof value === "object") {
      const g = value as { gathering?: unknown };
      const filled = withFishingCast(g.gathering);
      if (filled) {
        value = { ...g, gathering: filled };
      }
    }
    if (value !== undefined) {
      data[id] =
        manifest.format === EXPORT_PACK_FORMAT
          ? validPartial(manifest.id, id, value)
          : validDataset(manifest.id, id, value);
    }
  }
  // An imported pack has no built atlases; its art rows' files are stored with the uploads (#34).
  return {
    manifest,
    data: data as Partial<ContentData>,
    artDir: null,
    filesDir: null,
    world: null,
    removals: readRemovals(manifest.id, blob.removals),
  };
}
