/**
 * Where content refers to an item or a monster, and the cleanup that goes into the draft with its
 * removal (issue #28): each reference is removed (the recipe, shop line, drop or list entry that
 * holds it), replaced with another item or monster, or left for the operator, in which case the
 * pre-publish checks name it until it is fixed. A reference whose entry cannot go without breaking
 * its row (a station's one tool, a roll table's entry) is never removed: it is left, or replaced.
 * Pure.
 */
import { type ContentData, lingoEq } from "@secondstaronline/shared";

import { keyField, type RowRef, rowLabel, rowValue, sameRow } from "./rows.ts";
import { type JsonPath, type Reference, referencesOf } from "./validate.ts";

/** What can be removed with cleanup: an item or a monster (NPCs are monsters). */
export type EntryKind = "item" | "monster";

/** What happens to the references content holds to a removed entry. */
export type ContentCleanup = "remove" | "replace" | "leave";

const ITEM_KINDS = new Set<Reference["kind"]>(["item", "itemOrFixture", "shopItem", "lootItem"]);

/** The spellings that name an entry: an item's key and its archived spellings, a monster's key. */
export function spellingsOf(data: ContentData, kind: EntryKind, key: string): string[] {
  if (kind === "monster") {
    return [key];
  }
  const item = data.items.items.find((i) => lingoEq(i.name, key));
  return [key, ...(item?.variants ?? [])];
}

/** Whether a reference's name is one of `spellings` (a drop line may carry a count: `5 Fish`). */
function names(r: Reference, spellings: readonly string[]): boolean {
  const n = r.name.trim();
  if (spellings.some((s) => lingoEq(s, n))) {
    return true;
  }
  const counted = r.kind === "lootItem" ? /^\d+ (.+)$/.exec(n) : null;
  return counted !== null && spellings.some((s) => lingoEq(s, (counted[1] as string).trim()));
}

/**
 * Every reference content holds to an item or a monster, by any of `spellings` (by default the
 * entry's spellings in `data`).
 */
export function usesOf(
  data: ContentData,
  kind: EntryKind,
  key: string,
  spellings: readonly string[] = spellingsOf(data, kind, key),
): Reference[] {
  return referencesOf(data).filter(
    (r) =>
      (kind === "item" ? ITEM_KINDS.has(r.kind) : r.kind === "monster" || r.kind === "npc") &&
      names(r, spellings),
  );
}

/** One row a cleanup changes: its new JSON, or its removal. */
export interface CleanupRow {
  ref: RowRef;
  op: "set" | "remove";
  data: unknown;
}

export interface CleanupResult {
  rows: CleanupRow[];
  /** References the cleanup left as they were (left by choice, or not removable). */
  left: Reference[];
}

const isObject = (v: unknown): v is Record<string, unknown> | unknown[] =>
  v !== null && typeof v === "object";

function getAt(root: unknown, path: JsonPath): unknown {
  let at = root;
  for (const step of path) {
    if (!isObject(at)) {
      return undefined;
    }
    at = (at as Record<string | number, unknown>)[step];
  }
  return at;
}

function setAt(root: unknown, path: JsonPath, value: unknown): void {
  const parent = getAt(root, path.slice(0, -1));
  if (isObject(parent)) {
    (parent as Record<string | number, unknown>)[path.at(-1) as string | number] = value;
  }
}

/** An NPC file line with its item rewritten (a drop's count stays). */
function npcLineAs(line: string, item: string): string {
  const m = /^(SEL|BUY|INV)\|([^:|]*)(.*)$/.exec(line);
  if (!m) {
    return line;
  }
  const [, tag, name = "", rest = ""] = m;
  const count = tag === "INV" ? /^(\d+ )/.exec(name) : null;
  return `${tag}|${count ? count[1] : ""}${item}${rest}`;
}

const isPrefix = (a: JsonPath, b: JsonPath) =>
  a.length < b.length && a.every((step, i) => b[i] === step);

/**
 * The rows a cleanup changes. `remove` drops each removable reference's entry (and leaves the
 * others); `replace` writes `replacement` in place of every reference; `leave` changes nothing.
 * References inside `skip` rows (the removed entry's own rows) are not touched.
 */
export function cleanUses(
  data: ContentData,
  uses: readonly Reference[],
  mode: ContentCleanup,
  replacement = "",
  skip: readonly RowRef[] = [],
): CleanupResult {
  const left: Reference[] = [];
  const byRow = new Map<string, { ref: RowRef; uses: Reference[] }>();
  for (const u of uses) {
    if (skip.some((s) => sameRow(s, u.row))) {
      continue;
    }
    if (mode === "leave" || (mode === "remove" && u.drop === null)) {
      left.push(u);
      continue;
    }
    const label = rowLabel(u.row).toLowerCase();
    const entry = byRow.get(label) ?? { ref: u.row, uses: [] };
    entry.uses.push(u);
    byRow.set(label, entry);
  }
  const rows: CleanupRow[] = [];
  for (const { ref, uses: rowUses } of byRow.values()) {
    const value = structuredClone(rowValue(data, ref));
    if (value === undefined) {
      continue;
    }
    if (mode === "replace") {
      for (const u of rowUses) {
        if (u.npcLine) {
          const lines = String(getAt(value, ["text"])).split(/\r\n?|\n/);
          const i = u.path[1] as number;
          lines[i] = npcLineAs(lines[i] ?? "", replacement);
          setAt(value, ["text"], lines.join("\r"));
        } else {
          setAt(value, u.path, replacement);
        }
      }
      rows.push({ ref, op: "set", data: value });
      continue;
    }
    // Remove: a reference whose drop is the whole row removes it (only a keyed row can go).
    if (rowUses.some((u) => u.drop?.length === 0)) {
      if (keyField(ref.dataset, ref.part) !== null) {
        rows.push({ ref, op: "remove", data: null });
      } else {
        left.push(...rowUses);
      }
      continue;
    }
    // Each entry once, deepest first and from the end of each list, and none inside another that
    // also goes, so no index moves under a later removal.
    const drops: JsonPath[] = [];
    for (const u of rowUses) {
      const d = u.drop as JsonPath;
      if (!drops.some((x) => x.length === d.length && x.every((s, i) => s === d[i]))) {
        drops.push(d);
      }
    }
    const kept = drops.filter((d) => !drops.some((other) => isPrefix(other, d)));
    kept.sort((a, b) => {
      if (a.length !== b.length) {
        return b.length - a.length;
      }
      return Number(b.at(-1)) - Number(a.at(-1));
    });
    for (const d of kept) {
      if (rowUses.some((u) => u.npcLine && u.drop === d)) {
        continue; // NPC lines are removed together below
      }
      const list = getAt(value, d.slice(0, -1));
      if (Array.isArray(list)) {
        list.splice(d.at(-1) as number, 1);
      }
    }
    const npcLines = kept.filter((d) => rowUses.some((u) => u.npcLine && u.drop === d));
    if (npcLines.length > 0) {
      const gone = new Set(npcLines.map((d) => d[1] as number));
      const lines = String(getAt(value, ["text"])).split(/\r\n?|\n/);
      setAt(value, ["text"], lines.filter((_, i) => !gone.has(i)).join("\r"));
    }
    rows.push({ ref, op: "set", data: value });
  }
  return { rows, left };
}

/** A reference as the Content page lists it. */
export interface UseView {
  /** The row that holds it, to open it. */
  row: RowRef;
  /** The row's label and where in it (`craft/stations` → `cook.recipes[3].output`). */
  where: string;
  /** What it names as written. */
  name: string;
  /** Whether a cleanup can remove it (else it is replaced or fixed by hand). */
  removable: boolean;
}

/** A reference for the Content page. */
export function useView(u: Reference): UseView {
  const at = u.npcLine
    ? `line ${(u.path[1] as number) + 1}`
    : u.path
        .map((p) => (typeof p === "number" ? `[${p}]` : `.${p}`))
        .join("")
        .replace(/^\./, "");
  return {
    row: u.row,
    where: at ? `${u.where} → ${at}` : u.where,
    name: u.name,
    removable: u.drop !== null,
  };
}
