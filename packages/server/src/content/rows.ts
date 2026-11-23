/**
 * The content store's rows. A dataset's top-level field is either a keyed list (each entry is a
 * row, keyed by one field: an item by its name) or one row of its own (a "section": a text table,
 * a rule list). Packs supply rows; the operator layer changes, adds or removes them (removals are
 * markers); the merged store is the packs in install order with the operator rows on top. Pack
 * rows are never edited in place. Pure.
 */
import { createHash } from "node:crypto";

import { type ContentData, DATASET_IDS, type DatasetId } from "@secondstaronline/shared";

/**
 * The keyed lists, by dataset and field, with the field that keys each entry. Keys compare
 * ignoring case (as 1.6 compared names). Every other top-level field is a section.
 */
export const KEYED_LISTS: Partial<Record<DatasetId, Record<string, string>>> = {
  items: { items: "name" },
  monsters: { monsters: "name" },
  spells: { spells: "name" },
  classes: { classes: "code", skills: "skill", startClasses: "code" },
  help: { topics: "file" },
  npcFiles: { files: "name" },
  houses: { deeds: "deed", types: "house" },
  social: { factions: "id" },
};

/** Datasets operators cannot change: the collision rects are built from the art. */
export const READ_ONLY_DATASETS: readonly DatasetId[] = ["rects"];

/** Where a row lives: a section (`key` null) or one entry of a keyed list. */
export interface RowRef {
  dataset: DatasetId;
  part: string;
  key: string | null;
}

/** A row and its value. */
export interface Row extends RowRef {
  value: unknown;
}

/** The field that keys `part`'s entries, or null when `part` is a section. */
export function keyField(dataset: DatasetId, part: string): string | null {
  return KEYED_LISTS[dataset]?.[part] ?? null;
}

/** A row's id for messages and logs: `items/items/Ale`, `casino/blackjack`. */
export function rowLabel(r: RowRef): string {
  return r.key === null ? `${r.dataset}/${r.part}` : `${r.dataset}/${r.part}/${r.key}`;
}

/** Whether two refs name the same row (keys ignore case). */
export function sameRow(a: RowRef, b: RowRef): boolean {
  return (
    a.dataset === b.dataset &&
    a.part === b.part &&
    (a.key === null
      ? b.key === null
      : b.key !== null && a.key.toLowerCase() === b.key.toLowerCase())
  );
}

function canonical(v: unknown): string {
  if (Array.isArray(v)) {
    return `[${v.map(canonical).join(",")}]`;
  }
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

/**
 * A row's hash: the first 16 hex characters of the SHA-256 of its JSON with keys sorted (the
 * content baseline's fingerprint), so the same row hashes the same in every pack version.
 */
export function rowHash(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex").slice(0, 16);
}

/** Every row of a set of datasets, in order. */
export function rowsOf(data: Partial<ContentData>): Row[] {
  const out: Row[] = [];
  for (const dataset of DATASET_IDS) {
    const d = data[dataset] as Record<string, unknown> | undefined;
    if (!d) {
      continue;
    }
    for (const [part, value] of Object.entries(d)) {
      const field = keyField(dataset, part);
      if (field && Array.isArray(value)) {
        for (const entry of value) {
          out.push({
            dataset,
            part,
            key: String((entry as Record<string, unknown>)[field]),
            value: entry,
          });
        }
      } else {
        out.push({ dataset, part, key: null, value });
      }
    }
  }
  return out;
}

/** The value of one row in a set of datasets, or undefined when it has none. */
export function rowValue(data: Partial<ContentData>, ref: RowRef): unknown {
  const d = data[ref.dataset] as Record<string, unknown> | undefined;
  const part = d?.[ref.part];
  if (ref.key === null) {
    return part;
  }
  const field = keyField(ref.dataset, ref.part);
  if (!field || !Array.isArray(part)) {
    return undefined;
  }
  const k = ref.key.toLowerCase();
  return part.find((e) => String((e as Record<string, unknown>)[field]).toLowerCase() === k);
}

/** One change a layer makes to a row. */
export interface LayerRow extends RowRef {
  op: "set" | "remove";
  /** The row's JSON for `set`. */
  data: unknown;
}

/**
 * Applies changes to a set of datasets, returning new datasets (touched fields are copied, the
 * rest shared). A `set` of a keyed entry replaces it where it stands, or appends it when new;
 * a `remove` drops it; a `set` of a section replaces the field.
 */
export function applyRows<T extends Partial<ContentData>>(base: T, rows: readonly LayerRow[]): T {
  const out = { ...base } as Record<string, Record<string, unknown>>;
  const copied = new Set<string>();
  for (const r of rows) {
    const d = out[r.dataset];
    if (!d) {
      continue;
    }
    if (!copied.has(r.dataset)) {
      out[r.dataset] = { ...d };
      copied.add(r.dataset);
    }
    const ds = out[r.dataset] as Record<string, unknown>;
    if (r.key === null) {
      if (r.op === "set") {
        ds[r.part] = r.data;
      }
      continue;
    }
    const field = keyField(r.dataset, r.part);
    const list = Array.isArray(ds[r.part]) ? [...(ds[r.part] as unknown[])] : [];
    const k = r.key.toLowerCase();
    const at = list.findIndex(
      (e) => String((e as Record<string, unknown>)[field ?? ""]).toLowerCase() === k,
    );
    if (r.op === "remove") {
      if (at >= 0) {
        list.splice(at, 1);
      }
    } else if (at >= 0) {
      list[at] = r.data;
    } else {
      list.push(r.data);
    }
    ds[r.part] = list;
  }
  return out as T;
}

/**
 * Merges packs in install order: the first pack that has a dataset supplies it whole; each later
 * pack's rows replace the earlier ones with the same key (or the whole section) and add new
 * keys at the end.
 */
export function mergePacks(packs: readonly Partial<ContentData>[]): Partial<ContentData> {
  let merged: Partial<ContentData> = {};
  for (const pack of packs) {
    const firstTime: Partial<ContentData> = {};
    const later: LayerRow[] = [];
    for (const dataset of DATASET_IDS) {
      if (!pack[dataset]) {
        continue;
      }
      if (!merged[dataset]) {
        (firstTime as Record<string, unknown>)[dataset] = pack[dataset];
      } else {
        for (const r of rowsOf({ [dataset]: pack[dataset] })) {
          later.push({ ...r, op: "set", data: r.value });
        }
      }
    }
    merged = applyRows({ ...merged, ...firstTime }, later);
  }
  return merged;
}

/** The datasets every store needs; a merge missing one cannot be installed. */
export function missingDatasets(data: Partial<ContentData>): DatasetId[] {
  return DATASET_IDS.filter((d) => data[d] === undefined);
}
