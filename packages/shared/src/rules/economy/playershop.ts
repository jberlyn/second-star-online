/**
 * Player shops. A Small Shop's build makes a shopkeeper with 1.6's name generator (the original's
 * name builder) and file (the NPC creator). Its owner runs it with commands typed in chat: the
 * client's checks and texts (the shop-settings check) and the server's file rules and replies
 * (`ShopCommand`).
 *
 * The rules here work on the shop's file as lines. SSO reads a line's tag from its start (`SEL|`,
 * `GLD|`, `PRO|`), where 1.6 tested `contains`, and the owner by character id. An item is matched
 * by its exact name: setting a price or removing an item touches only that item's own lines (1.6
 * dropped every line that contained the name, and lost empty lines and lines past 30).
 */
import { type ContentStore, onContent } from "../../content/store.ts";
import { lingoContains, lingoEq, lingoInteger, lingoWord, type Rng } from "../core/lingo.ts";

// ---- the shopkeeper -------------------------------------------------------------------------

/**
 * The name builder's parts in order: `random(17)`, `random(5)`, `random(5)`, `random(5)`,
 * `random(11)`.
 */
export const SHOPKEEPER_NAME_PARTS = {
  first: ["B", "C", "D", "F", "G", "H", "J", "K", "L", "M", "N", "P", "R", "S", "T", "V", "Z"],
  vowel: ["a", "e", "i", "o", "u"],
  middle: ["st", "ch", "gh", "l", "m"],
  // `random(11)`: 4-8 give a letter, 1-3 and 9-11 nothing.
  last: ["", "", "", "r", "m", "b", "d", "g", "", "", ""],
} as const;

/** One name from the name builder: Letter1 & Letter2 & Letter3 & Letter4 & Letter5. */
export function shopkeeperName(rng: Rng): string {
  const p = SHOPKEEPER_NAME_PARTS;
  const pick = (list: readonly string[]) => list[rng.random(list.length) - 1] ?? "";
  return pick(p.first) + pick(p.vowel) + pick(p.middle) + pick(p.vowel) + pick(p.last);
}

let MLISTS: string;

/**
 * A name the monster renderer would read as a listed monster: the monster list contains the name.
 * Of the 12,750 generated names, Galor, Helum, Tela and Teli are merchants, and 12 (Demo, Galo,
 * Gela, Helu, Kele, Lime, Noli, Resti, Rista, Rosti, Some, Vela) lie inside a listed name and
 * match no member.
 */
export function inMonsterList(name: string): boolean {
  return lingoContains(MLISTS, name);
}

/**
 * The shopkeeper's name: the name builder's, rolled again while it is taken (an NPC file, the
 * archive's, an editor save or another shop's) or the monster list contains it (1.6 overwrote the
 * file). Gives up after `tries` rolls (null).
 */
export function rollShopkeeperName(
  rng: Rng,
  taken: (name: string) => boolean,
  tries = 1000,
): string | null {
  for (let i = 0; i < tries; i++) {
    const n = shopkeeperName(rng);
    if (!taken(n) && !inMonsterList(n)) {
      return n;
    }
  }
  return null;
}

/** Where the NPC creator puts the shopkeeper: roster slot 1, (10, 4), 1 HP (1.6 gave 128). */
export const SHOPKEEPER = { slot: 1, x: 10, y: 4, hp: 1 } as const;

/** The NPC creator's NPC file, its lines joined by RETURN with none after the last. */
export function shopkeeperFile(owner: string, name: string): string {
  return [
    `OWN|${owner}`,
    `BIO|Name: ${name}`,
    "BIO|Class: Shopkeeper",
    "PRO|",
    "GLD|0",
    "SEL|Apple:2:0",
    "BUY|Apple:1",
  ].join("\r");
}

/**
 * A shopkeeper's file with its `OWN|` line naming `owner` (a house transfer, issue #36). Only an
 * existing line is rewritten, in place, so every other line keeps its number and the ledger built
 * from the file still matches it; a file without one is returned as it is.
 */
export function withShopOwner(text: string, owner: string): string {
  const lines = text.split("\r");
  const at = lines.findIndex((l) => /^OWN\|/i.test(l));
  if (at < 0) {
    return text;
  }
  lines[at] = `OWN|${owner}`;
  return lines.join("\r");
}

// ---- the client's checks (SH) ---------------------------------------------------------------

export const SHOP_TEXT = {
  /** Printed by the client (the chat line printer). */
  wrongItem: "The item chosen is incorrect.",
  notEmployee: (n: string) => `${n} is not your employee!`,
  maxItems: (n: string) => `${n} is currently selling the maximum number of items allowed!`,
  added: (n: string) => `${n} says "OK boss, I've added the item!"`,
  notSelling: (n: string) => `${n} says "I'm not currently selling that item, boss!"`,
  inStock: (n: string) => `${n} says "We have that in stock, you need to buy it all back first."`,
  removed: (n: string) => `${n} says "OK boss, I removed the item!"`,
  steal: (n: string) => `${n} says "I don't think my boss would like you trying to steal from us."`,
  tooMuch: (n: string) => `${n} says "I don't have that much gold!"`,
  hereGold: (n: string) => `${n} says "Here's the gold."`,
  /** 1.6 left off the closing quote. */
  till: (n: string, g: number) => `${n} says "I have ${g} gold in the register..."`,
  /** 1.6 added a plain "s" to every name ("Chunk of Irons", "Fishs"). */
  stock: (n: string, k: string, item: string) => `${n} says "I have ${k} ${item} in stock."`,
  profile: (n: string) => `${n}'s profile has been updated.`,
  title: "Your shop title has been updated.",
  noTitle: "You can't change the title of this area!",
} as const;

export type ShopCommand =
  | { kind: "set"; npc: string; item: string; sell: number; buy: number }
  | { kind: "remove"; npc: string; item: string }
  | { kind: "register"; npc: string; amount: number }
  | { kind: "inventory"; npc: string }
  | { kind: "profile"; npc: string; text: string }
  | { kind: "title"; npc: string; text: string }
  /** The client refused it with a line of its own. */
  | { kind: "refused"; text: string }
  /** The client recognised the command and dropped it without a word. */
  | { kind: "silent" };

let WHITELIST: ContentStore["items"]["playerShopWhitelist"];

/**
 * The item equals `<name>` for a whitelist line (ignoring case). The list names crystals in the
 * singular ("Blue Crystal"), as the bag does (in 1.6 the bag held "Blue Crystals", so no shop
 * could stock crystals).
 */
export function onShopWhitelist(item: string): boolean {
  return WHITELIST.some((w) => lingoEq(w, item));
}

/**
 * The text after the first two words, with up to `spaces` leading spaces deleted: deleting the
 * first word twice leaves the spaces that followed each word, so a single-spaced line loses them
 * all.
 */
function rest(line: string, spaces: number): string {
  const m = /^\s*\S+\s+\S+/.exec(line);
  let t = m ? line.slice(m[0].length) : "";
  for (let i = 0; i < spaces && t.startsWith(" "); i++) {
    t = t.slice(1);
  }
  return t;
}

/**
 * Scans the first 25 positions and removes spaces, skipping the next character after a deletion.
 */
function stripPriceSpaces(s: string): string {
  const c = [...s];
  for (let x = 1; x <= 25; x++) {
    if (c[x - 1] === " ") {
      c.splice(x - 1, 1);
    }
  }
  return c.join("");
}

/** The server cuts each field at the first colon. */
const field = (s: string) => s.split(":")[0] ?? "";

/**
 * The shop-settings check on a said line: on a house map (the map name contains "H"), word 1 must
 * equal the name of one of the screen's four roster sprites in slot order (an empty slot keeps the
 * name read before it), word 2 the command (comparison ignores case). Returns null when the line is
 * no command. `line` is the typed line with one leading space deleted (the chat send routine).
 */
export function parseShopCommand(
  line: string,
  mapName: string,
  slots: readonly (string | null)[],
): ShopCommand | null {
  if (!lingoContains(mapName, "H")) {
    return null;
  }
  const w1 = lingoWord(line, 1);
  const w2 = lingoWord(line, 2);
  let cur: string | null = null;
  for (let pass = 0; pass < 4; pass++) {
    cur = slots[pass] ?? cur;
    if (cur === null || !lingoEq(w1, cur)) {
      continue;
    }
    const npc = cur;
    if (lingoEq(w2, "set")) {
      const t = rest(line, 3);
      const eq = t.split("=");
      const item = eq[0] ?? "";
      if (!onShopWhitelist(item)) {
        return { kind: "refused", text: SHOP_TEXT.wrongItem };
      }
      const prices = stripPriceSpaces(eq[1] ?? "").split(",");
      const sell = lingoInteger(prices[0] ?? "");
      const buy = lingoInteger(prices[1] ?? "");
      if (sell === null || buy === null || sell < 1 || buy < 1 || sell > 9999 || buy > 9999) {
        return { kind: "silent" };
      }
      return { kind: "set", npc, item, sell, buy };
    }
    if (lingoEq(w2, "remove")) {
      return { kind: "remove", npc, item: field(rest(line, 4)) };
    }
    if (lingoEq(w2, "register")) {
      const n = lingoInteger(rest(line, 4));
      return n === null || n < 1 ? { kind: "silent" } : { kind: "register", npc, amount: n };
    }
    if (lingoEq(w2, "inventory")) {
      return { kind: "inventory", npc };
    }
    if (lingoEq(w2, "profile")) {
      const t = rest(line, 4);
      return /[\r\n]/.test(t) ? { kind: "silent" } : { kind: "profile", npc, text: field(t) };
    }
    if (lingoEq(w2, "title")) {
      const t = rest(line, 4);
      return /[\r\n#]/.test(t) ? { kind: "silent" } : { kind: "title", npc, text: field(t) };
    }
  }
  return null;
}

// ---- the server's file rules (SV) -----------------------------------------------------------

/** The lines the profile command reads (the first 30 lines). */
export const SHOP_LINES = 30;

/** Most items a player shop can sell. */
export const SHOP_MAX_ITEMS = 10;

const tag = (line: string, t: string) => line.toUpperCase().startsWith(`${t}|`);
/** The nth colon-separated part of a `SEL|item:price:stock` or `BUY|item:price` line's data. */
const selPart = (line: string, n: number) => (line.slice(4).split(":")[n - 1] ?? "").trim();
/** The line is `<t>|<item>:…` for exactly this item (case ignored). */
const isItemLine = (line: string, t: "SEL" | "BUY", item: string) =>
  tag(line, t) && lingoEq(selPart(line, 1), item.trim());

/** The lines without trailing empty ones, then `add`, then the closing RETURN. */
function withTail(lines: readonly string[], ...add: string[]): string[] {
  const out = [...lines];
  while (out.length > 0 && out[out.length - 1] === "") {
    out.pop();
  }
  return [...out, ...add, ""];
}

export interface ShopRewrite {
  /** The file's new lines, or null when nothing is written. */
  lines: string[] | null;
  /** The reply to the sender (`sqa`). */
  text: string;
}

/**
 * Setting prices. Not the owner: refused. An item already for sale (a `SEL|` line for exactly its
 * name) is re-priced where it stands, keeping its stock and its place in the list. A new item is
 * refused once the shop sells ten items, else `SEL|<item>:<sell>:0` and `BUY|<item>:<buy>` are
 * added at the end with the name as typed. No other line changes.
 */
export function setPrices(
  lines: readonly string[],
  owner: boolean,
  npc: string,
  item: string,
  sell: number,
  buy: number,
): ShopRewrite {
  if (!owner) {
    return { lines: null, text: SHOP_TEXT.notEmployee(npc) };
  }
  const at = lines.findIndex((l) => isItemLine(l, "SEL", item));
  if (at < 0) {
    if (lines.filter((l) => tag(l, "SEL")).length >= SHOP_MAX_ITEMS) {
      return { lines: null, text: SHOP_TEXT.maxItems(npc) };
    }
    return {
      lines: withTail(lines, `SEL|${item}:${sell}:0`, `BUY|${item}:${buy}`),
      text: SHOP_TEXT.added(npc),
    };
  }
  const out = [...lines];
  const old = out[at] ?? "";
  const name = selPart(old, 1);
  out[at] = `SEL|${name}:${sell}:${selPart(old, 3) || "0"}`;
  const b = out.findIndex((l) => isItemLine(l, "BUY", name));
  if (b >= 0) {
    out[b] = `BUY|${name}:${buy}`;
  } else {
    out.splice(at + 1, 0, `BUY|${name}:${buy}`);
  }
  return { lines: out, text: SHOP_TEXT.added(npc) };
}

/**
 * Removing an item. Not the owner, or no `SEL|` line for exactly that item: refused. With stock
 * left: refused. Otherwise its `SEL|` and `BUY|` lines go and every other line stays.
 */
export function removeItem(
  lines: readonly string[],
  owner: boolean,
  npc: string,
  item: string,
): ShopRewrite {
  if (!owner) {
    return { lines: null, text: SHOP_TEXT.notEmployee(npc) };
  }
  const sel = lines.find((l) => isItemLine(l, "SEL", item));
  if (sel === undefined) {
    return { lines: null, text: SHOP_TEXT.notSelling(npc) };
  }
  if ((lingoInteger(selPart(sel, 3)) ?? 0) > 0) {
    return { lines: null, text: SHOP_TEXT.inStock(npc) };
  }
  const out = lines.filter((l) => !isItemLine(l, "SEL", item) && !isItemLine(l, "BUY", item));
  return { lines: withTail(out), text: SHOP_TEXT.removed(npc) };
}

/**
 * Taking gold from the till: not the owner → the steal line; every `GLD|` line, wherever it is,
 * loses the amount (a bug fixed: 1.6 read it only among lines 1-30, while a sale credits it
 * anywhere), and a till below 0 refuses. With no `GLD|` line 1.6 paid the owner from nothing; SSO
 * refuses that too. Returns the new lines and the gold paid, or null lines when nothing moves.
 */
export function register(
  lines: readonly string[],
  owner: boolean,
  npc: string,
  amount: number,
): ShopRewrite & { paid: number } {
  if (!owner) {
    return { lines: null, text: SHOP_TEXT.steal(npc), paid: 0 };
  }
  const out = [...lines];
  let till: number | null = null;
  out.forEach((l, i) => {
    if (tag(l, "GLD")) {
      till = (lingoInteger(l.slice(4)) ?? 0) - amount;
      out[i] = `GLD|${till}`;
    }
  });
  if (till === null || till < 0) {
    return { lines: null, text: SHOP_TEXT.tooMuch(npc), paid: 0 };
  }
  return { lines: out, text: SHOP_TEXT.hereGold(npc), paid: amount };
}

/**
 * `Inventory`: nothing for anyone but the owner, who gets one till line per `GLD|` line, wherever
 * it is (1.6 read lines 1-30 only), and then one line per item for sale. Only the owner hears them (1.6 said the stock to the room).
 */
export function shopStockLines(lines: readonly string[], owner: boolean, npc: string): string[] {
  if (!owner) {
    return [];
  }
  return [
    ...lines
      .filter((l) => tag(l, "GLD"))
      .map((l) => SHOP_TEXT.till(npc, lingoInteger(l.slice(4)) ?? 0)),
    ...lines
      .filter((l) => tag(l, "SEL"))
      .map((l) => SHOP_TEXT.stock(npc, selPart(l, 3), selPart(l, 1))),
  ];
}

/**
 * `Profile`: nothing for anyone but the owner; every `PRO|` line among 1-30 becomes `PRO|<text>`,
 * and the reply comes even when there is none.
 */
export function profile(
  lines: readonly string[],
  owner: boolean,
  npc: string,
  text: string,
): ShopRewrite | null {
  if (!owner) {
    return null;
  }
  const out = lines.map((l, i) => (i < SHOP_LINES && tag(l, "PRO") ? `PRO|${text}` : l));
  return { lines: out, text: SHOP_TEXT.profile(npc) };
}

onContent((c) => {
  WHITELIST = c.items.playerShopWhitelist;
  MLISTS = c.monsters.monsters.map((m) => m.name).join("\r");
});
