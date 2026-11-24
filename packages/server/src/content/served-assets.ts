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
import { type BuiltArt, fxTailHidden } from "./art.ts";

/** Where a pack's art is served, under `/assets/`: `packs/<id>/<file>`. */
export const PACK_ART_PREFIX = "packs/";
/** Where the operator's built sheets and uploaded sounds are served, under `/assets/`. */
export const OPERATOR_ART_PREFIX = "operator/";
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
  const sounds = { ...engine.sounds };
  for (const { id, art, prefix } of packs) {
    const base = prefix ?? `${PACK_ART_PREFIX}${id}/`;
    const v = prefix === undefined && art.inputHash ? `?v=${art.inputHash}` : "";
    for (const [group, atlas] of Object.entries(art.atlases) as [
      AtlasGroup,
      AssetIndex["atlases"][AtlasGroup],
    ][]) {
      const into = atlases[group] ?? { sheets: [], sprites: {} };
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
      sounds[name] = `${base}${file}${v}`;
    }
  }
  return { ...engine, atlases, sounds };
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
    const packs: { id: string; art: PackArtIndex; prefix?: string }[] = this.opts
      .packs()
      .filter((p): p is { id: string; artDir: string } => p.artDir !== null)
      .map((p) => ({
        id: p.id,
        art: JSON.parse(readFileSync(join(p.artDir, ASSET_INDEX_FILE), "utf8")) as PackArtIndex,
      }));
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
    const bytes = this.opts.files.read(kind, hash, ext);
    return bytes ? { bytes, type: MIME[ext] ?? "application/octet-stream" } : null;
  }
}

const MIME: Record<string, string> = {
  png: "image/png",
  wav: "audio/wav",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
};
