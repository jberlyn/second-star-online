/**
 * The file store for uploaded art and sounds (issue #29). Files are named by the SHA-256 of their
 * bytes, so the same upload is stored once and a name never changes what it holds:
 *
 * - `<root>/art/<hash>.png`: uploaded images;
 * - `<root>/sounds/<hash>.<wav|mp3|ogg>`: uploaded sounds.
 *
 * The atlases built from them are kept in memory and built again at start, so nothing here needs
 * rebuilding after a restore.
 *
 * The database holds only references (the `art` dataset's rows), so a file is written before the
 * row that names it is committed, and `sweep` removes files nothing names any more. The root is
 * `<database name>-content/` beside the database file (`artFilesDir`); a world in memory keeps its
 * files in memory too.
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import type { Db } from "./database.ts";

export type ArtFileKind = "art" | "sounds";

/** An image or sound file's extension: `png`, or the sound's format. */
export type ArtFileExt = "png" | "wav" | "mp3" | "ogg";

export interface StoredArtFile {
  kind: ArtFileKind;
  hash: string;
  ext: ArtFileExt;
  bytes: number;
  /** When the file was stored (ms since the epoch): the sweep spares fresh uploads. */
  storedAt: number;
}

export interface ArtFiles {
  /** Stores bytes (once per content) and returns their hash. */
  put(kind: ArtFileKind, ext: ArtFileExt, bytes: Uint8Array): string;
  /** A stored file's bytes, or null. */
  read(kind: ArtFileKind, hash: string, ext: ArtFileExt): Uint8Array | null;
  /** Every stored upload. */
  list(): StoredArtFile[];
  remove(kind: ArtFileKind, hash: string, ext: ArtFileExt): void;
}

export const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

const HASH = /^[0-9a-f]{64}$/;
const EXTS: Record<ArtFileKind, readonly ArtFileExt[]> = {
  art: ["png"],
  sounds: ["wav", "mp3", "ogg"],
};

function checkName(kind: ArtFileKind, hash: string, ext: ArtFileExt): void {
  if (!HASH.test(hash) || !EXTS[kind].includes(ext)) {
    throw new Error(`not a stored file: ${kind}/${hash}.${ext}`);
  }
}

/**
 * The folder a database's uploads live in: `<name>-content/` beside it (`sso-content/` for
 * `sso.sqlite`). One folder per database, so starting another world beside it never sweeps this
 * world's files as unused.
 */
export function artFilesDir(dbPath: string): string {
  const full = resolve(dbPath);
  const stem = basename(full).replace(/\.(sqlite3?|db)$/i, "");
  return join(dirname(full), `${stem}-content`);
}

/** Files on disk under `root`. Writes go to a temporary name first, then are renamed in place. */
export function diskArtFiles(root: string): ArtFiles {
  const dir = (k: ArtFileKind) => join(root, k);
  const write = (path: string, bytes: Uint8Array) => {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, bytes);
    renameSync(tmp, path);
  };
  return {
    put(kind, ext, bytes) {
      const hash = sha256(bytes);
      checkName(kind, hash, ext);
      const path = join(dir(kind), `${hash}.${ext}`);
      if (existsSync(path)) {
        // Uploaded again: fresh, so the sweep's grace starts over.
        const now = new Date();
        utimesSync(path, now, now);
      } else {
        write(path, bytes);
      }
      return hash;
    },
    read(kind, hash, ext) {
      checkName(kind, hash, ext);
      const path = join(dir(kind), `${hash}.${ext}`);
      return existsSync(path) ? new Uint8Array(readFileSync(path)) : null;
    },
    list() {
      const out: StoredArtFile[] = [];
      for (const kind of ["art", "sounds"] as const) {
        if (!existsSync(dir(kind))) {
          continue;
        }
        for (const f of readdirSync(dir(kind)).sort()) {
          const [hash = "", ext = ""] = f.split(".");
          if (HASH.test(hash) && EXTS[kind].includes(ext as ArtFileExt) && f === `${hash}.${ext}`) {
            const st = statSync(join(dir(kind), f));
            out.push({ kind, hash, ext: ext as ArtFileExt, bytes: st.size, storedAt: st.mtimeMs });
          }
        }
      }
      return out;
    },
    remove(kind, hash, ext) {
      checkName(kind, hash, ext);
      rmSync(join(dir(kind), `${hash}.${ext}`), { force: true });
    },
  };
}

/** Files in memory: a world in memory, and tests. */
export function memoryArtFiles(now: () => number = Date.now): ArtFiles {
  const files = new Map<string, { bytes: Uint8Array; storedAt: number }>();
  return {
    put(kind, ext, bytes) {
      const hash = sha256(bytes);
      checkName(kind, hash, ext);
      const k = `${kind}/${hash}.${ext}`;
      const had = files.get(k);
      files.set(k, { bytes: had?.bytes ?? bytes.slice(), storedAt: now() });
      return hash;
    },
    read(kind, hash, ext) {
      checkName(kind, hash, ext);
      return files.get(`${kind}/${hash}.${ext}`)?.bytes ?? null;
    },
    list() {
      return [...files.entries()].sort().map(([k, v]) => {
        const [kind, name = ""] = k.split("/") as [ArtFileKind, string];
        const [hash = "", ext = ""] = name.split(".");
        return { kind, hash, ext: ext as ArtFileExt, bytes: v.bytes.length, storedAt: v.storedAt };
      });
    },
    remove(kind, hash, ext) {
      files.delete(`${kind}/${hash}.${ext}`);
    },
  };
}

/** An upload nothing names yet is kept this long (it may be on its way into the draft). */
export const SWEEP_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * Every file hash the content store's tables name: operator rows (and the pack rows they were
 * based on), the draft, every publish (so undo can bring a file back) and imported packs.
 */
export function referencedArtFiles(db: Db): Set<string> {
  const out = new Set<string>();
  const scan = (text: string | null) => {
    for (const m of text?.matchAll(/[0-9a-f]{64}/g) ?? []) {
      out.add(m[0]);
    }
  };
  for (const r of db
    .query<{ a: string | null; b: string | null }, []>(
      "SELECT data AS a, base_data AS b FROM content_rows",
    )
    .all()) {
    scan(r.a);
    scan(r.b);
  }
  for (const [sql] of [
    ["SELECT data AS a FROM content_draft"],
    ["SELECT changes AS a FROM content_publishes"],
    ["SELECT data AS a FROM content_packs"],
  ] as const) {
    for (const r of db.query<{ a: string | null }, []>(sql).all()) {
      scan(r.a);
    }
  }
  return out;
}

/**
 * Removes uploads nothing names any more and that are older than the grace period. Returns how
 * many went.
 */
export function sweepArtFiles(db: Db, files: ArtFiles, nowMs: number): number {
  const used = referencedArtFiles(db);
  let n = 0;
  for (const f of files.list()) {
    if (!used.has(f.hash) && nowMs - f.storedAt > SWEEP_GRACE_MS) {
      files.remove(f.kind, f.hash, f.ext);
      n += 1;
    }
  }
  return n;
}
