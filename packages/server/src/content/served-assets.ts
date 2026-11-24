/**
 * The asset index clients load (`/assets/index.json`): the engine's own art (the UI files and the
 * interface's sounds), each installed pack's atlases and sounds in load order, and the operator's
 * uploaded art on top (issue #29). Built at start and again on each publish, not per request, and
 * identified by a hash the `content` message carries, so a client online during a publish loads
 * only what changed.
 *
 * Every art file has a URL that names one version of it, so browsers may keep it for good: a
 * pack's files carry `?v=<the pack's input hash>`, and the operator's sheets and sounds are named
 * by their content's hash.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ASSET_INDEX_FILE,
  type AssetIndex,
  type AtlasGroup,
  type PackArtIndex,
} from "@secondstaronline/data";

import type { ArtFiles } from "../persistence/art-files.ts";
import { type BuiltArt, fxTailHidden, nullRecord } from "./art.ts";

/** Where a pack's art is served, under `/assets/`: `packs/<id>/<file>`. */
export const PACK_ART_PREFIX = "packs/";
/** Where the operator's built sheets and uploaded sounds are served, under `/assets/`. */
export const OPERATOR_ART_PREFIX = "operator/";
/**
 * Where a pack's art rows are served once built (issue #29, stage 8), under `/assets/`:
 * `operator/packs/<id>/<sheet>` and `operator/packs/<id>/sounds/<hash>.<ext>`. Named by content
 * hashes like the operator's, so cached for good.
 */
export const PACK_ROWS_PREFIX = `${OPERATOR_ART_PREFIX}packs/`;
/** Where uploads are served as they were stored (the Content page's previews), under `/assets/`. */
export const UPLOADS_PREFIX = "uploads/";

/**
 * The engine's index with each pack's art merged in, in order: a later pack's sprite or sound of
 * the same name wins. A pack's files are named under `packs/<id>/` with `?v=<input hash>` (when it
 * has one), or under its own `prefix` (the operator's, whose names are already hashes).
 */
export function mergePackArt(
  engine: AssetIndex,
  packs: readonly { id: string; art: PackArtIndex; prefix?: string }[],
): AssetIndex {
  const atlases = structuredClone(engine.atlases);
  // Names are operator text: every record merged into is prototype-free, so `__proto__` or
  // `constructor` is only ever an entry of its own (issue #29).
  for (const atlas of Object.values(atlases)) {
    atlas.sprites = nullRecord(atlas.sprites);
  }
  const sounds = nullRecord(engine.sounds);
  for (const { id, art, prefix } of packs) {
    const base = prefix ?? `${PACK_ART_PREFIX}${id}/`;
    const v = prefix === undefined && art.inputHash ? `?v=${art.inputHash}` : "";
    for (const [group, atlas] of Object.entries(art.atlases) as [
      AtlasGroup,
      AssetIndex["atlases"][AtlasGroup],
    ][]) {
      const into = atlases[group] ?? { sheets: [], sprites: nullRecord() };
      // The operator's runs and trails are whole: the packs' frames after an uploaded run's last
      // are not drawn (issue #29, stage 5).
      if (prefix !== undefined && group === "fx") {
        const hidden = fxTailHidden(Object.keys(atlas.sprites));
        for (const name of Object.keys(into.sprites)) {
          if (hidden(name)) {
            delete into.sprites[name];
          }
        }
      }
      const offset = into.sheets.length;
      into.sheets.push(...atlas.sheets.map((f) => `${base}${f}${v}`));
      for (const [name, sprite] of Object.entries(atlas.sprites)) {
        const [sheet, ...rest] = sprite;
        into.sprites[name] = [sheet + offset, ...rest] as typeof sprite;
      }
      atlases[group] = into;
    }
    for (const [name, file] of Object.entries(art.sounds)) {
      // The engine's own sounds (the frame's clicks) stay the engine's.
      if (Object.hasOwn(engine.sounds, name.toLowerCase())) {
        continue;
      }
      sounds[name.toLowerCase()] = `${base}${file}${v}`;
    }
  }
  return { ...engine, atlases, sounds };
}

/** A layer of the packs' art, in the order the served index lays them. */
export interface PackArtLayer {
  id: string;
  art: PackArtIndex;
  /** Where its files are served: absent for a pack's built atlases (`packs/<id>/`). */
  prefix?: string;
}

/**
 * The installed packs' art in the order the served index lays it: each pack's built atlases,
 * then its art rows (issue #29, stage 8), then the next pack's. The server folds hit rects and
 * the packs' sprite and sound keys in the same order, so what is drawn is what is hit.
 */
export function packArtLayers(
  packs: readonly { id: string; artDir: string | null }[],
  rows: readonly { id: string; built: BuiltArt }[],
): PackArtLayer[] {
  const out: PackArtLayer[] = [];
  for (const p of packs) {
    if (p.artDir !== null) {
      out.push({
        id: p.id,
        art: JSON.parse(readFileSync(join(p.artDir, ASSET_INDEX_FILE), "utf8")) as PackArtIndex,
      });
    }
    const own = rows.find((r) => r.id === p.id);
    if (own) {
      out.push({ id: p.id, art: own.built.index, prefix: `${PACK_ROWS_PREFIX}${p.id}/` });
    }
  }
  return out;
}

export interface ServedIndex {
  json: string;
  /** Identifies this index: the `content` message carries it. */
  hash: string;
}

export interface ServedAssetsOptions {
  /** The engine's art folder (packages/data/assets). */
  engineDir: string;
  /** The installed packs' art folders, in load order. */
  packs: () => readonly { id: string; artDir: string | null }[];
  /** The operator's art as the published store draws it (null: none). */
  built: () => BuiltArt | null;
  files: ArtFiles;
  /** Each installed pack's art rows as built, in install order (issue #29, stage 8). */
  packRows?: () => readonly { id: string; built: BuiltArt }[];
  /** A file a pack carries in its `files/` folder (checked against its name), or null. */
  packFile?: (
    kind: "art" | "sounds",
    hash: string,
    ext: "png" | "wav" | "mp3" | "ogg",
  ) => Uint8Array | null;
}

/** How many published builds' sheets stay served, for clients that loaded an index just before. */
const KEEP_BUILDS = 3;

export class ServedAssets {
  private current: ServedIndex = { json: "{}", hash: "" };
  /** The sheets of the last few published builds, by build. */
  private readonly builds = new Map<string, ReadonlyMap<string, Uint8Array>>();

  constructor(private readonly opts: ServedAssetsOptions) {
    this.refresh();
  }

  /** Builds the index again from the engine, the installed packs and the published art. */
  refresh(): void {
    const engine = JSON.parse(
      readFileSync(join(this.opts.engineDir, ASSET_INDEX_FILE), "utf8"),
    ) as AssetIndex;
    const packs = packArtLayers(this.opts.packs(), this.opts.packRows?.() ?? []);
    const built = this.opts.built();
    if (built) {
      packs.push({ id: "operator", art: built.index, prefix: OPERATOR_ART_PREFIX });
      this.builds.delete(built.hash);
      this.builds.set(built.hash, built.sheets);
      while (this.builds.size > KEEP_BUILDS) {
        this.builds.delete(this.builds.keys().next().value as string);
      }
    }
    const json = JSON.stringify(mergePackArt(engine, packs));
    this.current = {
      json,
      hash: createHash("sha256").update(json).digest("hex").slice(0, 16),
    };
  }

  index(): ServedIndex {
    return this.current;
  }

  /**
   * An operator file by its path under `operator/`: a built sheet (`<group>-<hash>.png`) or an
   * uploaded sound (`sounds/<hash>.<ext>`); or an upload as stored, under `uploads/`
   * (`art/<hash>.png`, `sounds/<hash>.<ext>`). Null when there is none.
   */
  file(path: string): { bytes: Uint8Array; type: string } | null {
    if (path.startsWith(PACK_ROWS_PREFIX)) {
      // A pack's built art rows: a sheet, or a sound its rows name.
      const [id = "", ...rest] = path.slice(PACK_ROWS_PREFIX.length).split("/");
      const own = this.opts.packRows?.().find((r) => r.id === id);
      const rel = rest.join("/");
      if (!own) {
        return null;
      }
      const sheet = own.built.sheets.get(rel);
      if (sheet) {
        return { bytes: sheet, type: "image/png" };
      }
      return rel.startsWith("sounds/") && Object.values(own.built.index.sounds).includes(rel)
        ? this.stored(rel)
        : null;
    }
    if (path.startsWith(OPERATOR_ART_PREFIX)) {
      const rel = path.slice(OPERATOR_ART_PREFIX.length);
      for (const sheets of this.builds.values()) {
        const sheet = sheets.get(rel);
        if (sheet) {
          return { bytes: sheet, type: "image/png" };
        }
      }
      return this.stored(`sounds/${rel.startsWith("sounds/") ? rel.slice(7) : "-"}`);
    }
    if (path.startsWith(UPLOADS_PREFIX)) {
      return this.stored(path.slice(UPLOADS_PREFIX.length));
    }
    return null;
  }

  private stored(rel: string): { bytes: Uint8Array; type: string } | null {
    const m = /^(art|sounds)\/([0-9a-f]{64})\.(png|wav|mp3|ogg)$/.exec(rel);
    if (!m) {
      return null;
    }
    const [, kind, hash, ext] = m as unknown as [string, "art" | "sounds", string, "png"];
    if ((kind === "art") !== (ext === "png")) {
      return null;
    }
    const bytes =
      this.opts.files.read(kind, hash, ext) ?? this.opts.packFile?.(kind, hash, ext) ?? null;
    return bytes ? { bytes, type: MIME[ext] ?? "application/octet-stream" } : null;
  }
}

const MIME: Record<string, string> = {
  png: "image/png",
  wav: "audio/wav",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
};
