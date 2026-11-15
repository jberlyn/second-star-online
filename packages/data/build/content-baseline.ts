/** Fingerprints protect release baseline rows and their ordering. */
import { createHash } from "node:crypto";

export type RowFingerprint = [key: string, hash: string];
/** `"<file>#/<path>"` to the fingerprints of the list's rows, in order. */
export type OriginalsFile = Record<string, RowFingerprint[]>;

const KEY_FIELDS = [
  "name",
  "code",
  "file",
  "npc",
  "skill",
  "item",
  "pattern",
  "deed",
  "house",
  "handler",
] as const;

function canonical(v: unknown): string {
  if (Array.isArray(v)) {
    return `[${v.map(canonical).join(",")}]`;
  }
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

/** First 16 hex characters of the SHA-256 of the row's JSON with keys sorted. */
export function rowHash(row: unknown): string {
  return createHash("sha256").update(canonical(row)).digest("hex").slice(0, 16);
}

/** A name to show for a row in a message: its first identifying field, else its index. */
export function rowKey(row: unknown, index: number): string {
  if (row !== null && typeof row === "object" && !Array.isArray(row)) {
    const o = row as Record<string, unknown>;
    for (const f of KEY_FIELDS) {
      const v = o[f];
      if (typeof v === "string" || typeof v === "number") {
        return String(v);
      }
    }
  }
  return String(index);
}

export function fingerprintRows(rows: readonly unknown[]): RowFingerprint[] {
  return rows.map((r, i) => [rowKey(r, i), rowHash(r)]);
}

/** Every non-empty list reachable from `root` without passing through another list, by path. */
export function listsOf(root: unknown): Map<string, unknown[]> {
  const out = new Map<string, unknown[]>();
  const walk = (v: unknown, path: string): void => {
    if (Array.isArray(v)) {
      if (v.length > 0) {
        out.set(path === "" ? "/" : path, v);
      }
      return;
    }
    if (v !== null && typeof v === "object") {
      for (const [k, child] of Object.entries(v)) {
        walk(child, `${path}/${k}`);
      }
    }
  };
  walk(root, "");
  return out;
}

/** The fingerprint file for content files given as parsed JSON, by file name. */
export function fingerprintLists(files: Record<string, unknown>): OriginalsFile {
  const out: OriginalsFile = {};
  for (const file of Object.keys(files).sort()) {
    for (const [path, rows] of [...listsOf(files[file])].sort(([a], [b]) => (a < b ? -1 : 1))) {
      out[`${file}#${path}`] = fingerprintRows(rows);
    }
  }
  return out;
}

/**
 * Checks that `originals` is a subsequence of `rows` (same relative order; rows may be added
 * anywhere). Returns null when it is, else the first original row that is missing or changed.
 */
export function findMissingBaseline(
  originals: readonly RowFingerprint[],
  rows: readonly unknown[],
): { index: number; key: string } | null {
  let at = 0;
  for (let i = 0; i < originals.length; i++) {
    const [key, hash] = originals[i] as RowFingerprint;
    while (at < rows.length && rowHash(rows[at]) !== hash) {
      at++;
    }
    if (at >= rows.length) {
      return { index: i, key };
    }
    at++;
  }
  return null;
}
