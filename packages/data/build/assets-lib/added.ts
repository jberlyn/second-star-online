/**
 * What is in assets/added/: art for the five atlas groups
 * (`<group>/<name>.png`) and sounds (`sounds/<name>.wav|.mp3`), each with a sidecar `.json`.
 * Both builds read it through here, so the asset build and the data build can't disagree about it.
 * Throws, naming the file, on anything that is not exactly that.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { type AddedArt, type AddedSound, addedAssetSchema } from "../../schema/added-asset.ts";
import { checkMirroredFlags } from "../../src/art/mirror.ts";

export const ART_GROUPS = ["bodies", "fx", "items", "paperdoll", "tiles"] as const;
export type ArtGroup = (typeof ART_GROUPS)[number];
/** Every folder assets/added/ may hold. */
export const ADDED_GROUPS = [...ART_GROUPS, "sounds"] as const;

export interface AddedArtFile {
  group: ArtGroup;
  name: string;
  png: string;
  json: string;
  side: AddedArt;
}

export interface AddedSoundFile {
  name: string;
  ext: ".wav" | ".mp3";
  file: string;
  json: string;
  side: AddedSound;
}

export interface AddedFiles {
  art: AddedArtFile[];
  sounds: AddedSoundFile[];
}

/** Where the build writes an added sound, by the same rule as an original's `soundFile`. */
export const addedSoundFile = (name: string, ext: string): string =>
  `sounds/${name.toLowerCase().replaceAll(" ", "-")}${ext}`;

const isWav = (b: Uint8Array): boolean =>
  b.length >= 12 &&
  String.fromCharCode(...b.subarray(0, 4)) === "RIFF" &&
  String.fromCharCode(...b.subarray(8, 12)) === "WAVE";

const isMp3 = (b: Uint8Array): boolean =>
  b.length >= 3 &&
  ((b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) ||
    (b[0] === 0xff && ((b[1] as number) & 0xe0) === 0xe0));

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Lists and checks assets/added/. A missing folder gives empty lists. */
export function listAdded(addedDir: string): AddedFiles {
  const out: AddedFiles = { art: [], sounds: [] };
  if (!existsSync(addedDir)) {
    return out;
  }
  const rel = (group: string, f: string) => `assets/added/${group}/${f}`;
  const readSide = (path: string, group: string, f: string) => {
    let side: ReturnType<typeof addedAssetSchema.parse>;
    try {
      side = addedAssetSchema.parse(JSON.parse(readFileSync(path, "utf8")));
    } catch (e) {
      throw new Error(`${rel(group, f)}: ${(e as Error).message}`);
    }
    if (side.group !== group) {
      throw new Error(`${rel(group, f)}: group is ${side.group}, folder is ${group}`);
    }
    return side;
  };
  for (const group of readdirSync(addedDir).sort()) {
    if (group === "README.md") {
      continue;
    }
    if (!(ADDED_GROUPS as readonly string[]).includes(group)) {
      throw new Error(
        `assets/added/${group}: not a folder the build knows (${ADDED_GROUPS.join(", ")})`,
      );
    }
    const dir = join(addedDir, group);
    const files = readdirSync(dir).sort();
    const mediaExts = group === "sounds" ? [".wav", ".mp3"] : [".png"];
    const media = new Map<string, string>();
    const sides = new Set<string>();
    for (const f of files) {
      const dot = f.lastIndexOf(".");
      const ext = dot < 0 ? "" : f.slice(dot).toLowerCase();
      if (ext === ".json") {
        sides.add(f.slice(0, dot));
      } else if (mediaExts.includes(ext)) {
        if (media.has(f.slice(0, dot))) {
          throw new Error(`${rel(group, f)}: two files named ${f.slice(0, dot)}`);
        }
        media.set(f.slice(0, dot), ext);
      } else {
        throw new Error(
          `${rel(group, f)}: only ${[...mediaExts, ".json"].join(", ")} files go here`,
        );
      }
    }
    for (const n of sides) {
      if (!media.has(n)) {
        throw new Error(`${rel(group, `${n}.json`)} has no ${mediaExts.join(" or ")} file`);
      }
    }
    for (const n of [...media.keys()].sort(cmp)) {
      const ext = media.get(n) as string;
      const f = `${n}${ext}`;
      if (!sides.has(n)) {
        throw new Error(`${rel(group, f)} has no sidecar .json`);
      }
      const jsonPath = join(dir, `${n}.json`);
      const side = readSide(jsonPath, group, `${n}.json`);
      if (group === "sounds") {
        const bytes = new Uint8Array(readFileSync(join(dir, f)));
        if (ext === ".wav" ? !isWav(bytes) : !isMp3(bytes)) {
          throw new Error(`${rel(group, f)} is not a ${ext === ".wav" ? "WAV" : "MP3"} file`);
        }
        out.sounds.push({
          name: n,
          ext: ext as ".wav" | ".mp3",
          file: join(dir, f),
          json: jsonPath,
          side: side as AddedSound,
        });
      } else {
        out.art.push({
          group: group as ArtGroup,
          name: n,
          png: join(dir, f),
          json: jsonPath,
          side: side as AddedArt,
        });
      }
    }
  }
  checkMirroredFlags(
    out.art.map((a) => ({
      group: a.group,
      name: a.name,
      mirrored: a.side.mirrored === true,
      file: `assets/added/${a.group}/${a.name}.png`,
    })),
  );
  const seen = new Map<string, string>();
  for (const s of out.sounds) {
    for (const k of [`name:${s.name.toLowerCase()}`, `file:${addedSoundFile(s.name, s.ext)}`]) {
      const prev = seen.get(k);
      if (prev !== undefined) {
        throw new Error(
          `assets/added/sounds/${s.name}${s.ext} and ${prev} are the same sound name (case is ignored)`,
        );
      }
      seen.set(k, `assets/added/sounds/${s.name}${s.ext}`);
    }
  }
  return out;
}
