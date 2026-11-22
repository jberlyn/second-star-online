/**
 * NPC files (`DAT/NPC/<name>.txt`) as the 1.6 readers see them, and the NPC editor's rules ("NPC
 * editor").
 *
 * A file is lines of `TAG|data` separated by RETURN (the original reader split on CR only), at
 * most `NPC_MAX_LINES` of them. Every reader reads the whole file. 1.6's readers each looked at a
 * window of lines: buying and selling 1-80, gold given 1-60, monster drops (`INV|`) 1-80, chatter
 * (`RND|`) 1-20 and the Bio 1-100, and a line past its window did nothing; SSO drops the windows.
 * With no `GLD|` line the shopkeeper's till starts at 0. `FLG|`, `SPL|` and `BNK|` are found by
 * `contains`. An empty file reads EMPTY: the NPC never moves and opens no Bio.
 */

import { type ContentStore, content, onContent } from "../../content/store.ts";
import { lingoContains, lingoEq, lingoWord } from "../core/lingo.ts";
import { parseTrn } from "../progression/promotion.ts";

/** The longest file the editor shows and saves (the NPC editor's display routine). */
export const NPC_MAX_LINES = 100;
/** SSO's limit on one line (the longest archived line is 170 characters). */
export const NPC_MAX_LINE = 255;

/** The tags the archive's files use (`NPC Scripting.txt` lists all but OWN and BNK). */
export const NPC_TAGS = [
  "BIO",
  "PRO",
  "SEL",
  "BUY",
  "GLD",
  "INV",
  "OWN",
  "FLG",
  "TRN",
  "RND",
  "SPL",
  "BNK",
] as const;

/** The flags a reader tests (`FLG|Still`; `FLG|Passive`). */
export const NPC_FLAGS = ["Still", "Passive"] as const;

/** The `SPL|` tags the monster spell casters test, in their order. */
export let NPC_SPELL_TAGS: readonly string[];

export interface NpcSell {
  item: string;
  price: number;
  stock: number;
  line: number;
}
export interface NpcBuy {
  item: string;
  price: number;
  line: number;
}

/** One `TRN|` line: the class as typed, its price and its file line. */
export interface NpcTrain {
  cls: string;
  price: number;
  line: number;
}

/** One NPC file, parsed. The first eight fields are the data build's `Npc` record. */
export interface NpcFile {
  name: string;
  bio: string[];
  profile: string[];
  chatter: string[];
  sells: NpcSell[];
  buys: NpcBuy[];
  /** `TRN|` lines, in file order. */
  trains: NpcTrain[];
  /** The `GLD|` value, or null with no such line. */
  gold: number | null;
  banker: boolean;
  /** The file line of `GLD|`, or null (the windows above decide who reads it). */
  goldLine: number | null;
  /** `FLG|` lines, whole. */
  flags: string[];
  /** `SPL|` lines, whole. */
  spells: string[];
  /** `INV|` lines, in file order (the quantity is part of the name). */
  loot: { item: string; oneIn: number }[];
  /** The file is empty: EMPTY NPC data. */
  empty: boolean;
  /** The lines joined by CR, as stored. */
  text: string;
}

/** Split a file into lines at CR, CRLF or LF; browser input can use any of these. */
export function npcLines(text: string): string[] {
  return text === "" ? [] : text.split(/\r\n|\r|\n/);
}

const TAG_RX = /^(BIO|PRO|SEL|BUY|GLD|INV|OWN|FLG|TRN|RND|SPL|BNK)\|(.*)$/;

/** Parse a field as a whole number, or return null. */
function int(s: string | undefined): number | null {
  const t = (s ?? "").trim();
  return /^-?\d+$/.test(t) ? Number.parseInt(t, 10) : null;
}

/** Parses a file's text (an archived file, or an NPC editor save). */
export function parseNpcFile(name: string, text: string): NpcFile {
  const lines = npcLines(text);
  const f: NpcFile = {
    name,
    bio: [],
    profile: [],
    chatter: [],
    sells: [],
    buys: [],
    trains: [],
    gold: null,
    banker: false,
    goldLine: null,
    flags: [],
    spells: [],
    loot: [],
    empty: text === "",
    text: lines.join("\r"),
  };
  lines.forEach((l, i) => {
    const line = i + 1;
    // The monster loot routine tests whether a line contains "INV|" and reads the part after "|".
    if (lingoContains(l, "INV|")) {
      const parts = (l.split("|")[1] ?? "").split(":");
      f.loot.push({ item: parts[0] ?? "", oneIn: int(parts[1]) ?? 0 });
    }
    const m = TAG_RX.exec(l);
    if (!m) {
      return;
    }
    const tag = m[1];
    const data = m[2] ?? "";
    const parts = data.split(":");
    switch (tag) {
      case "BIO":
        f.bio.push(data);
        break;
      case "PRO":
        f.profile.push(data);
        break;
      case "RND":
        f.chatter.push(data);
        break;
      case "SEL":
        f.sells.push({
          item: parts[0] ?? "",
          price: int(parts[1]) ?? 0,
          stock: int(parts[2]) ?? 0,
          line,
        });
        break;
      case "BUY":
        f.buys.push({ item: parts[0] ?? "", price: int(parts[1]) ?? 0, line });
        break;
      case "TRN":
        f.trains.push({ ...parseTrn(data), line });
        break;
      case "GLD":
        f.gold = int(data);
        f.goldLine = line;
        break;
      case "FLG":
        f.flags.push(l);
        break;
      case "SPL":
        f.spells.push(l);
        break;
      case "BNK":
        f.banker = true;
        break;
    }
  });
  return f;
}

/**
 * What LOAD's display routine does to the file text: lossless display preserving all lines
 * (including `OWN|`, empty lines, lines past `NPC_MAX_LINES`, and every first character). Returns
 * CR-delimited text, preserving whether the file has a trailing line ending.
 */
export function showNpcScript(text: string): string {
  return npcLines(text).join("\r");
}

/** A shop ledger's lines, as the economy keeps them (keyed by file line). */
export interface LedgerView {
  gold: number | null;
  lines: readonly {
    line: number;
    kind: "SEL" | "BUY";
    item: string;
    price: number;
    stock: number | null;
  }[];
}

/**
 * The file as the server would hold it now: in 1.6 the shop's stock and gold live in the file, so a
 * sale rewrote its line as `SEL|<item>:<price>:<stock>` and a payment or gift rewrote `GLD|<n>`.
 * Lines whose numbers did not change keep their text.
 */
export function liveNpcText(f: NpcFile, ledger: LedgerView | null): string {
  if (!ledger) {
    return f.text;
  }
  const lines = npcLines(f.text);
  for (const l of ledger.lines) {
    const s = f.sells.find((x) => x.line === l.line);
    if (l.kind === "SEL" && s && lingoEq(s.item, l.item) && l.stock !== s.stock) {
      lines[l.line - 1] = `SEL|${s.item}:${s.price}:${l.stock}`;
    }
  }
  if (f.goldLine !== null && ledger.gold !== null && ledger.gold !== f.gold) {
    lines[f.goldLine - 1] = `GLD|${ledger.gold}`;
  } else if (f.goldLine === null && ledger.gold !== null && ledger.gold !== 0) {
    // A shopkeeper without a GLD| line has a till from 0; once it holds gold the file shows it.
    while (lines.length > 0 && lines[lines.length - 1] === "") {
      lines.pop();
    }
    lines.push(`GLD|${ledger.gold}`);
  }
  return lines.join("\r");
}

/**
 * The editor's lists in their order: `MONed` (36 names) and
 * `NPCed` (56 names). The same names as the World Editor's
 * MONSTER and NPC lists, in a different order. Both set the selected name: they are NPC file names.
 * `NPC_EDITOR_NPCS` also drives the `isNpced` spawn gate (`random(60) <= 2`).
 */
export let NPC_EDITOR_MONSTERS: readonly string[];
export let NPC_EDITOR_NPCS: readonly string[];

onContent((c) => {
  NPC_SPELL_TAGS = c.monsters.casting.spells.map((s) => s.tag);
  NPC_EDITOR_MONSTERS = c.monsters.editorLists.npcEditor.monsters;
  NPC_EDITOR_NPCS = c.monsters.editorLists.npcEditor.npcs;
});

/** The list spelling of a name the editor may load and save (comparison ignores case), or null. */
export function npcEditorName(name: string): string | null {
  const want = name.toLowerCase();
  return (
    NPC_EDITOR_MONSTERS.find((n) => n.toLowerCase() === want) ??
    NPC_EDITOR_NPCS.find((n) => n.toLowerCase() === want) ??
    null
  );
}

// ---- the editor's checks ----

/**
 * The item of a `SEL|`, `BUY|` or `INV|` line written by its display name, rewritten to the item's
 * key (decision 3 of issue #27: text written by operators is resolved when saved, so a later rename
 * never breaks it). An `INV|` line's leading count stays. Every other line is unchanged.
 */
export function resolveNpcItemNames(
  lines: readonly string[],
  store: ContentStore = content(),
): string[] {
  return lines.map((l) => {
    const m = /^(SEL|BUY|INV)\|([^:|]*)(:.*)?$/.exec(l);
    if (!m) {
      return l;
    }
    const [, tag, name = "", rest = ""] = m;
    const count = tag === "INV" ? /^(\d+ )(.+)$/.exec(name) : null;
    const bare = count ? (count[2] as string) : name;
    if (store.item(bare)) {
      return l;
    }
    const item = store.itemNamed(bare);
    return item ? `${tag}|${count ? count[1] : ""}${item.name}${rest}` : l;
  });
}

/** A catalogue item by name or spelling. A retired item is none: no shop may sell or buy it. */
const catalogue = (name: string, store: ContentStore = content()) =>
  store.items.items.some(
    (i) =>
      !i.retired && (lingoEq(i.name, name) || (i.variants ?? []).some((v) => lingoEq(v, name))),
  );

/** A shop line's item: a catalogue name or one of its archived spellings (`apple`, `knife`). */
export function npcShopItemOk(name: string, store: ContentStore = content()): boolean {
  return catalogue(name, store);
}

/**
 * A drop line's item: what a shop sells, an Inventory fixture, `N Gold` (a positive integer
 * followed by "gold", as `/drop` takes it), or `N <crystals>` ("5 Blue Crystals").
 */
export function npcLootItemOk(name: string, store: ContentStore = content()): boolean {
  if (catalogue(name, store) || store.items.fixtures.some((f) => lingoEq(f, name))) {
    return true;
  }
  const n = Number.parseInt(lingoWord(name, 1), 10);
  if (!(n > 0) || !/^\d+$/.test(lingoWord(name, 1))) {
    return false;
  }
  if (lingoEq(lingoWord(name, 2), "gold")) {
    return true;
  }
  const rest = name.trim().slice(lingoWord(name, 1).length).trim();
  return lingoContains(rest, "Crystals") && catalogue(rest, store);
}

const MAX_INT = 2_000_000_000;
const count = (s: string | undefined, min: number) => {
  const t = (s ?? "").trim();
  if (!/^\d+$/.test(t)) {
    return false;
  }
  const n = Number.parseInt(t, 10);
  return n >= min && n <= MAX_INT;
};

export interface NpcFileCheck {
  /** Why the save is refused, or null. */
  error: string | null;
  /** What the save keeps that does nothing in play, by line. */
  warnings: string[];
}

/** Lines of an editor save: the field ends with a RETURN, which ends no extra line. */
export function editorLines(text: string): string[] {
  const lines = npcLines(text);
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

/**
 * Checks an NPC editor save. Refused: what would break the file or make an item that does not
 * exist. Saved with a warning: what lies outside the line window that reads it, or does nothing.
 */
export function checkNpcFile(
  lines: readonly string[],
  store: ContentStore = content(),
): NpcFileCheck {
  const warnings: string[] = [];
  const fail = (n: number, why: string): NpcFileCheck => ({
    error: `Line ${n}: ${why}`,
    warnings: [],
  });
  if (lines.length > NPC_MAX_LINES) {
    return { error: `An NPC file holds at most ${NPC_MAX_LINES} lines.`, warnings: [] };
  }
  let golds = 0;
  for (const [i, l] of lines.entries()) {
    const n = i + 1;
    if (l === "") {
      continue;
    }
    if (l.length > NPC_MAX_LINE) {
      return fail(n, `a line holds at most ${NPC_MAX_LINE} characters.`);
    }
    // A backtick ends the save's text, and `*` and `^` split the map's NPC bundle.
    if (/[`*^]/.test(l)) {
      return fail(n, "the characters ` * ^ cannot be used.");
    }
    if ([...l].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) {
      return fail(n, "the line holds a character that cannot be printed.");
    }
    const bar = l.indexOf("|");
    const tag = bar < 0 ? "" : l.slice(0, bar);
    if (!(NPC_TAGS as readonly string[]).includes(tag)) {
      return fail(n, `unknown tag "${bar < 0 ? l : `${tag}|`}" (${NPC_TAGS.join(", ")}).`);
    }
    const data = l.slice(bar + 1);
    if (data.includes("|")) {
      return fail(n, 'only one "|" per line.');
    }
    const p = data.split(":");
    switch (tag) {
      case "SEL": {
        if (p.length !== 3) {
          return fail(n, "SEL|<item>:<price>:<stock>.");
        }
        if (!npcShopItemOk(p[0] ?? "", store)) {
          return fail(n, `"${p[0]}" is not an item.`);
        }
        if (!count(p[1], 0) || !count(p[2], 0)) {
          return fail(n, "price and stock are whole numbers from 0.");
        }
        // Every SEL| line can be bought, wherever it is (1.6 could not buy a non-crystal line
        // from line 17, nor any line after 80).
        break;
      }
      case "BUY":
        if (p.length < 2 || p.length > 3) {
          return fail(n, "BUY|<item>:<price>.");
        }
        if (!npcShopItemOk(p[0] ?? "", store)) {
          return fail(n, `"${p[0]}" is not an item.`);
        }
        if (!count(p[1], 0)) {
          return fail(n, "the price is a whole number from 0.");
        }
        break;
      case "GLD":
        golds += 1;
        if (golds > 1) {
          return fail(n, "an NPC has one GLD| line.");
        }
        if (!count(data, 0)) {
          return fail(n, "GLD|<gold>, a whole number from 0.");
        }
        break;
      case "INV":
        if (p.length !== 2) {
          return fail(n, "INV|<item>:<one in N>.");
        }
        if (!npcLootItemOk(p[0] ?? "", store)) {
          return fail(n, `"${p[0]}" is not an item.`);
        }
        if (!count(p[1], 1)) {
          return fail(n, "the chance is a whole number from 1.");
        }
        break;
      case "TRN":
        if (p.length !== 2 || (p[0] ?? "") === "") {
          return fail(n, "TRN|<class>:<price>.");
        }
        if (!count(p[1], 0)) {
          return fail(n, "the price is a whole number from 0.");
        }
        if (!store.classes.classes.some((c) => c.promotion && lingoEq(c.name, p[0] ?? ""))) {
          warnings.push(`Line ${n}: no class "${p[0]}" can be trained: 1.6 has no rule for it.`);
        }
        break;
      case "FLG":
        if (!NPC_FLAGS.some((f) => lingoContains(l, `FLG|${f}`))) {
          warnings.push(`Line ${n}: only FLG|Still and FLG|Passive do anything.`);
        }
        break;
      case "SPL":
        if (!store.monsters.casting.spells.some((s) => lingoContains(l, `SPL|${s.tag}`))) {
          warnings.push(`Line ${n}: no monster casts "${data}".`);
        }
        break;
    }
  }
  return { error: null, warnings };
}

/** The editor's alerts. */
export const NPC_EDIT_TEXT = {
  /** The NPC was created. */
  saved: "NPC has been successfully saved.",
  /** SSO: a refused save. */
  refused: (why: string) => `The NPC was not saved. ${why}`,
  /** SSO: LOAD of a file the save check would refuse for its length. */
  tooLong: (lines: number) =>
    `This file has ${lines} lines. An NPC file holds at most ${NPC_MAX_LINES} lines, so remove ${lines - NPC_MAX_LINES} before saving.`,
} as const;
