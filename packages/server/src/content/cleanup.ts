/**
 * Where content refers to an item or a monster, and the cleanup that goes into the draft with its
 * removal (issue #28): each reference is removed (the recipe, shop line, drop or list entry that
 * holds it), replaced with another item or monster, or left for the operator, in which case the
 * pre-publish checks name it until it is fixed. A reference whose entry cannot go without breaking
 * its row (a station's one tool, a roll table's entry) is never removed: it is left, or replaced.
 * Pure.
 */
import { type ContentData, lingoContains, lingoEq } from "@secondstaronline/shared";

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
  // The player-shop list names crystals in the singular (`Blue Crystal`).
  const singular = /^(.+ Crystal)s$/i.exec(key)?.[1];
  return [key, ...(item?.variants ?? []), ...(singular ? [singular] : [])];
}

/** Whether a reference's name is one of `spellings` (a drop line may carry a count: `5 Fish`). */
function names(r: Reference, spellings: readonly string[]): boolean {
  const n = r.name.trim();
  if (spellings.some((s) => lingoEq(s, n))) {
    return true;
  }
  // Only crystals drop as a counted pile; `INV|50 Gold` is gold, not the Gold item.
  const counted = r.kind === "lootItem" ? /^\d+ (.+ Crystals)$/i.exec(n) : null;
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

/** An NPC file line with its item rewritten (a crystal drop's count stays). */
function npcLineAs(line: string, item: string): string {
  const m = /^(SEL|BUY|INV)\|([^:|]*)(.*)$/.exec(line);
  if (!m) {
    return line;
  }
  const [, tag, name = "", rest = ""] = m;
  // Only crystals drop as a counted pile (`INV|5 Blue Crystals`, one crystal is `1 ...`); any other
  // item drops one, named bare.
  if (tag === "INV" && lingoContains(item, " Crystals")) {
    return `${tag}|${/^(\d+) /.exec(name)?.[1] ?? "1"} ${item}${rest}`;
  }
  return `${tag}|${item}${rest}`;
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
  /**
   * Whether a cleaned row still matches its schema. A removal that would break it (a list that
   * must keep one entry) is not made: its references are left, for the operator to replace.
   */
  rowOk: (ref: RowRef, value: unknown) => boolean = () => true,
): CleanupResult {
  const left: Reference[] = [];
  const byRow = new Map<string, { ref: RowRef; uses: Reference[] }>();
  for (const u of uses) {
    if (skip.some((s) => sameRow(s, u.row))) {
      continue;
    }
    if (mode === "leave" || u.fixed || (mode === "remove" && u.drop === null)) {
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
    // A reference whose drop is the whole row (a deed: the row is the item's) removes the row, in
    // either mode: writing another item into it would change the row's own key.
    if (rowUses.some((u) => u.drop?.length === 0)) {
      if (keyField(ref.dataset, ref.part) !== null) {
        rows.push({ ref, op: "remove", data: null });
      } else {
        left.push(...rowUses);
      }
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
      // A shop that already sold the replacement keeps one line for it.
      if (rowUses.some((u) => u.npcLine)) {
        const text = String(getAt(value, ["text"]));
        setAt(value, ["text"], mergeShopLines(text.split(/\r\n?|\n/), replacement).join("\r"));
      }
      rows.push({ ref, op: "set", data: value });
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
    if (!rowOk(ref, value)) {
      left.push(...rowUses);
      continue;
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

/** The item a `SEL|`, `BUY|` or `INV|` line names (a drop's count left off), or null. */
function lineItem(line: string): string | null {
  const m = /^(SEL|BUY|INV)\|([^:|]*)/.exec(line);
  if (!m) {
    return null;
  }
  const name = (m[2] as string).trim();
  return m[1] === "INV" && /^\d+ .+ Crystals$/i.test(name) ? name.replace(/^\d+ /, "") : name;
}

/**
 * An NPC file's text with the shop and drop lines naming one of `spellings` removed or rewritten
 * (`replace`), or null when no line names it. The NPC Editor's saves and player shops' files are
 * cleaned with this, as the content's NPC file rows are by `cleanUses`.
 */
export function npcTextCleaned(
  text: string,
  spellings: readonly string[],
  mode: "remove" | "replace",
  replacement = "",
): string | null {
  const lines = text.split(/\r\n?|\n/);
  let changed = false;
  const out: string[] = [];
  for (const line of lines) {
    const item = lineItem(line);
    if (item === null || !spellings.some((s) => lingoEq(s, item))) {
      out.push(line);
      continue;
    }
    changed = true;
    if (mode === "replace") {
      out.push(npcLineAs(line, replacement));
    }
  }
  return changed ? (mode === "replace" ? mergeShopLines(out, replacement) : out).join("\r") : null;
}

/**
 * One `SEL|` line and one `BUY|` line per item for `item`: a replacement that a shop already sold
 * joins the line it had (the first line's price, the stocks added), so no shop lists it twice.
 */
function mergeShopLines(lines: readonly string[], item: string): string[] {
  const out: string[] = [];
  let sel = -1;
  let buy = false;
  for (const line of lines) {
    const m = /^(SEL|BUY)\|([^:|]*)(.*)$/.exec(line);
    if (!m || !lingoEq((m[2] as string).trim(), item)) {
      out.push(line);
      continue;
    }
    if (m[1] === "BUY") {
      if (!buy) {
        out.push(line);
        buy = true;
      }
      continue;
    }
    if (sel < 0) {
      sel = out.length;
      out.push(line);
      continue;
    }
    const stock = (l: string) => Number(/:(\d+)$/.exec(l)?.[1] ?? 0);
    const first = out[sel] as string;
    out[sel] = first.replace(/:(\d+)$/, `:${stock(first) + stock(line)}`);
  }
  return out;
}

/** How many a shop's `SEL|` lines naming one of `spellings` hold in stock. */
export function shopStockOf(text: string, spellings: readonly string[]): number {
  let n = 0;
  for (const line of text.split(/\r\n?|\n/)) {
    const m = /^SEL\|([^:|]*):[^:]*:(\d+)/.exec(line);
    if (m && spellings.some((s) => lingoEq(s, (m[1] as string).trim()))) {
      n += Number(m[2]);
    }
  }
  return n;
}

/** Whether an NPC file names one of `spellings` in a shop or drop line. */
export function npcTextNames(text: string, spellings: readonly string[]): boolean {
  return npcTextCleaned(text, spellings, "remove") !== null;
}
