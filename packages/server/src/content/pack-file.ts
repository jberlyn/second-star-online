/**
 * Exported pack files (issue #34): one JSON file holding a pack's manifest (format 2), its datasets
 * as a pack folder's `data/*.json` holds them, the rows it removes from the packs under it, and the
 * uploaded art and sound files its art rows name (base64, by content hash). Reading one checks
 * everything a pack folder's reader does, plus each file against its hash and the data against the
 * manifest's `contentHash`. Pure apart from hashing.
 */
import {
  DATASET_FILES,
  EXPORT_PACK_FORMAT,
  type PackManifest,
  type SchemaDatasetId,
} from "@secondstaronline/data/schema";
import type { ContentData } from "@secondstaronline/shared";

import { sha256 } from "../persistence/art-files.ts";
import { checkUpload } from "./art.ts";
import { type LoadedPack, type PackBlob, readPackObject } from "./packs.ts";
import { type RowRef, rowHash } from "./rows.ts";

/** The most an exported pack file may weigh. */
export const PACK_FILE_MAX_BYTES = 64 * 1024 * 1024;

/** An uploaded art or sound file a pack carries. */
export interface PackFileEntry {
  kind: "art" | "sounds";
  hash: string;
  ext: "png" | "wav" | "mp3" | "ogg";
  bytes: Uint8Array;
}

/** A pack file read and checked. */
export interface ReadPackFile {
  pack: LoadedPack;
  /** What the database keeps for an installed imported pack (no files: they go to the uploads). */
  blob: PackBlob;
  files: PackFileEntry[];
}

/** A pack's datasets by file stem, as a pack folder names them. */
function byStem(data: Partial<ContentData>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const id of Object.keys(DATASET_FILES) as SchemaDatasetId[]) {
    const v = (data as Record<string, unknown>)[id];
    if (v !== undefined) {
      out[DATASET_FILES[id]] = v;
    }
  }
  return out;
}

/** The hash of a pack's data and removals, as its manifest records it. */
export function packContentHash(
  data: Record<string, unknown>,
  removals: readonly RowRef[],
): string {
  return rowHash({ data, removals });
}

/** Builds an exported pack file's text. */
export function buildPackFile(p: {
  id: string;
  name: string;
  version: string;
  sso: string;
  builtOn: { id: string; version: string }[];
  exportedAt: string;
  data: Partial<ContentData>;
  removals: RowRef[];
  files: PackFileEntry[];
}): string {
  const data = byStem(p.data);
  const manifest: PackManifest = {
    id: p.id,
    name: p.name,
    version: p.version,
    format: EXPORT_PACK_FORMAT,
    sso: p.sso,
    contentHash: packContentHash(data, p.removals),
    builtOn: p.builtOn,
    exportedAt: p.exportedAt,
  };
  const files: Record<string, string> = {};
  for (const f of p.files) {
    files[`${f.kind}/${f.hash}.${f.ext}`] = Buffer.from(f.bytes).toString("base64");
  }
  return JSON.stringify({ manifest, data, removals: p.removals, files });
}

const FILE_NAME = /^(art|sounds)\/([0-9a-f]{64})\.(png|wav|mp3|ogg)$/;

/** Reads an exported pack file. Throws, saying what is wrong, on anything invalid. */
export function readPackFile(text: string): ReadPackFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("the file is not a pack: it is not JSON");
  }
  const o = raw as { manifest?: unknown; data?: unknown; removals?: unknown; files?: unknown };
  if (!o || typeof o !== "object" || !o.manifest || !o.data || typeof o.data !== "object") {
    throw new Error("the file is not a pack: it needs a manifest and data");
  }
  const blob: PackBlob = {
    manifest: o.manifest,
    data: o.data as Record<string, unknown>,
    ...(o.removals !== undefined ? { removals: o.removals } : {}),
  };
  const pack = readPackObject(blob);
  if (packContentHash(blob.data, pack.removals) !== pack.manifest.contentHash) {
    throw new Error(
      `pack ${pack.manifest.id}: its data does not match its manifest's contentHash (the file was changed after it was exported)`,
    );
  }
  const files: PackFileEntry[] = [];
  const raws = o.files ?? {};
  if (typeof raws !== "object" || Array.isArray(raws)) {
    throw new Error(`pack ${pack.manifest.id}: its files are not a map of name to base64`);
  }
  for (const [name, b64] of Object.entries(raws as Record<string, unknown>)) {
    const m = FILE_NAME.exec(name);
    if (!m || typeof b64 !== "string") {
      throw new Error(`pack ${pack.manifest.id}: ${name} is not an art or sound file name`);
    }
    const kind = m[1] as "art" | "sounds";
    const hash = m[2] as string;
    const ext = m[3] as PackFileEntry["ext"];
    if ((kind === "art") !== (ext === "png")) {
      throw new Error(`pack ${pack.manifest.id}: ${name}: art is png, sounds are wav, mp3 or ogg`);
    }
    const bytes = new Uint8Array(Buffer.from(b64, "base64"));
    if (sha256(bytes) !== hash) {
      throw new Error(`pack ${pack.manifest.id}: ${name} does not match its hash`);
    }
    const check = checkUpload(bytes, kind === "art" ? "image" : "sound");
    if (!check.ok) {
      throw new Error(`pack ${pack.manifest.id}: ${name}: ${check.error}`);
    }
    if (check.ext !== ext) {
      throw new Error(`pack ${pack.manifest.id}: ${name} is a ${check.ext} file`);
    }
    files.push({ kind, hash, ext, bytes });
  }
  return { pack, blob, files };
}
