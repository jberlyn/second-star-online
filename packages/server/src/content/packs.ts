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
  type PackManifest,
  packManifestSchema,
  type SchemaDatasetId,
} from "@secondstaronline/data/schema";
import type { ContentData } from "@secondstaronline/shared";

/** A pack's manifest and validated datasets (a pack may leave datasets out). */
export interface LoadedPack {
  manifest: PackManifest;
  data: Partial<ContentData>;
  /** The folder holding the pack's art (`<pack>/<manifest.art>`), when it has art there. */
  artDir: string | null;
}

/** An imported pack as the database stores it: the manifest and each dataset by file stem. */
export interface PackBlob {
  manifest: unknown;
  data: Record<string, unknown>;
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
  return {
    manifest,
    data: data as Partial<ContentData>,
    artDir: artDir && existsSync(join(artDir, "index.json")) ? artDir : null,
  };
}

/** Reads an imported pack from the JSON the database keeps. Throws on anything invalid. */
export function readPackBlob(json: string): LoadedPack {
  const blob = JSON.parse(json) as PackBlob;
  const manifest = packManifestSchema.parse(blob.manifest);
  const data: Record<string, unknown> = {};
  for (const id of Object.keys(DATASET_FILES) as SchemaDatasetId[]) {
    const value = blob.data?.[DATASET_FILES[id]];
    if (value !== undefined) {
      data[id] = validDataset(manifest.id, id, value);
    }
  }
  // An imported pack's art arrives with art uploads (#29) and pack import (#34).
  return { manifest, data: data as Partial<ContentData>, artDir: null };
}
