/**
 * NPC shops.
 *
 * Pure rules over a ledger (the NPC file's `GLD|`, `SEL|` and `BUY|` lines) and a buyer's gold and
 * bag. The order of checks, the texts and the kept bugs are the 1.6 server's NPC buy and sell handlers;
 * the client's price, item name and file name are replaced by a line the server owns, so items are
 * bought by line.
 */
import {
  type Bag,
  bagText,
  invAdd,
  lingoContains,
  lingoEq,
  NPC_WINDOW,
  type NpcFile,
  type Rng,
} from "@secondstaronline/shared";

export interface ShopLine {
  /** The file line (the inner-loop bug depends on it). */
  line: number;
  kind: "SEL" | "BUY";
  item: string;
  price: number;
  /** SEL lines only. */
  stock: number | null;
}

export interface ShopLedger {
  npc: string;
  /** `GLD|`, or null with no such line. */
  gold: number | null;
  /** In file order. */
  lines: ShopLine[];
  /** Changed since the last write. */
  dirty: boolean;
  /**
   * The file line of `GLD|`, or null: gifts add to it only among lines 1-60. Not stored: it comes
   * from the file.
   */
  goldLine?: number | null;
}

/**
 * A fresh ledger from an NPC file (the archive's, or an NPC editor save). `GLD|` counts for buying
 * and selling only among lines 1-80: further down the goods are free and sales unpaid, as with no
 * `GLD|` line.
 */
export function ledgerFromTemplate(n: NpcFile): ShopLedger {
  const lines: ShopLine[] = [
    ...n.sells.map((s) => ({
      line: s.line,
      kind: "SEL" as const,
      item: s.item,
      price: s.price,
      stock: s.stock,
    })),
    ...n.buys.map((b) => ({
      line: b.line,
      kind: "BUY" as const,
      item: b.item,
      price: b.price,
      stock: null,
    })),
  ].sort((a, b) => a.line - b.line);
  const gold = n.goldLine !== null && n.goldLine <= NPC_WINDOW.buy ? n.gold : null;
  return { npc: n.name, gold, lines, dirty: false, goldLine: n.goldLine };
}

/** A line as the file holds it, for the server's `contains` tests. */
export function lineText(l: ShopLine): string {
  return l.kind === "SEL" ? `SEL|${l.item}:${l.price}:${l.stock}` : `BUY|${l.item}:${l.price}`;
}

export const SHOP_TEXT = {
  /** The `cannotaffford` message. */
  cannotAfford: "You don't have enough gold to buy this!",
  /** The `sqa` message. */
  noRoom: "You don't have enough room in your inventory!",
  /**
   * The out-of-stock refusal: the name comes from sprite 207, which is empty in every game frame,
   * so it is blank (1.6 did the same: the refusal names nobody).
   */
  outOfStock: ` says "Sorry but I'm out of that particular item."`,
  /** The `errsel` message. */
  sellError: "Error in trying to sell!",
  /** The `sqa` message. */
  notEnoughToSell: "You don't have enough of those to sell!",
  /** The `sqa` message. */
  dontHave: "You don't have that item.",
  /** The refusal when the NPC cannot pay, with the same blank name. */
  cantAffordToBuy: ` says "I'm sorry but I can't afford to buy that."`,
  /** The sale thanks, handled inline with no name. */
  thanks: "Thanks for the business!",
} as const;

export interface Buyer {
  gold: number;
  bag: Bag;
}

/** One reply line: chat text in colour 0. */
export type ShopResult =
  | { ok: false; text: string }
  | {
      ok: true;
      /** The ledger after the trade (to keep and write). */
      ledger: ShopLedger;
      /** The buyer after the trade, or unchanged when `InvAdd` found no room. */
      buyer: Buyer;
      texts: string[];
    };

const cloneLedger = (l: ShopLedger): ShopLedger => ({
  ...l,
  lines: l.lines.map((x) => ({ ...x })),
});
const cloneBuyer = (b: Buyer): Buyer => ({
  gold: b.gold,
  bag: b.bag.map((l) => (l ? { ...l } : null)),
});

/**
 * Buying `count` of the SEL line at file line `lineNo`, in order:
 * 1. the price × count against the buyer's gold (`cannotaffford`);
 * 2. an empty bag line, or the bag text containing `<item>-` (substring: a full bag with an "Orc
 *    Pot Pie" passes for "Pie"), else "You don't have enough room…";
 * 3. every line containing `SEL|<item>` from line 1 (`contains`, so a prefix): count over stock
 *  is `NEI`; stock goes down. A non-crystal match runs a 15-slot inner loop using the outer loop's
 *  own index, leaving it at 16: a match on a line below 17 skips to line 17, and a
 *    match on line 17 or later is found again and again until its stock is short, so it always
 *    ends in `NEI` with nothing written (a kept 1.6 bug: the Fortress Guild Hall Deed cannot be
 *    bought). Crystals skip that loop;
 * 4. with a `GLD|` line, the last matched line's price × count is charged (`cannotaffford` if it
 *    goes negative) and added to the NPC's gold; with none, nothing is charged;
 * 5. `InvAdd`: on no room nothing is added and the buyer's file is not written (the charge is
 *    lost), but the NPC's file still is: stock down, gold up.
 */
export function npcBuy(
  shop: ShopLedger,
  lineNo: number,
  count: number,
  buyer: Buyer,
  rng: Rng,
): ShopResult {
  const sel = shop.lines.find((l) => l.line === lineNo && l.kind === "SEL");
  if (!sel || count < 1) {
    return { ok: false, text: SHOP_TEXT.outOfStock };
  }
  const item = sel.item;
  if (buyer.gold < sel.price * count) {
    return { ok: false, text: SHOP_TEXT.cannotAfford };
  }
  const roomy = buyer.bag.some((l) => l === null) || lingoContains(bagText(buyer.bag), `${item}-`);
  if (!roomy) {
    return { ok: false, text: SHOP_TEXT.noRoom };
  }
  const ledger = cloneLedger(shop);
  const crystal = lingoContains(item, "Crystal");
  const want = `SEL|${item}`;
  let unitPrice = sel.price;
  let from = 1;
  for (const l of ledger.lines) {
    if (l.line < from || l.line > 80 || l.kind !== "SEL" || !lingoContains(lineText(l), want)) {
      continue;
    }
    const stock = l.stock ?? 0;
    if (count > stock) {
      return { ok: false, text: SHOP_TEXT.outOfStock };
    }
    if (!crystal && l.line >= 17) {
      // `x` is set back to 16 and this line matches again on every pass.
      return { ok: false, text: SHOP_TEXT.outOfStock };
    }
    l.stock = stock - count;
    unitPrice = l.price;
    if (!crystal) {
      from = 17;
    }
  }
  const after = cloneBuyer(buyer);
  if (ledger.gold !== null) {
    const cost = unitPrice * count;
    if (after.gold - cost < 0) {
      return { ok: false, text: SHOP_TEXT.cannotAfford };
    }
    after.gold -= cost;
    ledger.gold += cost;
  }
  ledger.dirty = true;
  const added = invAdd(after, item, count, rng);
  return { ok: true, ledger, buyer: added.kind === "full" ? buyer : after, texts: [] };
}

/** The container names the sell OK swaps for a bag slot's `Name#n`. */
const SELL_CONTAINERS = ["Crate", "Cabinet", "Wind Cabinet"] as const;

/**
 * The name the sell OK sends for a list line, and its count: a line naming a Crate, Cabinet or Wind
 * Cabinet takes the lowest bag line holding `Crate#`/`Cabinet#`/`Wind Cabinet#` and sells one.
 * "Cabinet" also finds a Wind Cabinet.
 */
export function sellName(item: string, count: number, bag: Bag): { item: string; count: number } {
  let picked: string | null = null;
  for (const c of SELL_CONTAINERS) {
    if (!lingoContains(item, c)) {
      continue;
    }
    for (let i = bag.length - 1; i >= 0; i -= 1) {
      const l = bag[i];
      if (l && lingoContains(`${l.item}-${l.qty}`, `${c}#`)) {
        picked = l.item;
      }
    }
  }
  return picked === null ? { item, count } : { item: picked, count: 1 };
}

/**
 * Selling `count` against the BUY line at file line `lineNo`, in order:
 * 1. `Crate#n`, `Cabinet#n` and `Wind Cabinet#n` are looked up by their base name;
 * 2. no `BUY|<item>:<price>` in the file → "Error in trying to sell!" (`errsel`);
 * 3. any bag line containing `<item>-` with fewer than `count` → "You don't have enough of those
 *    to sell!";
 * 4. no bag line holding the item → "You don't have that item." (SSO takes it from the line that
 *    holds exactly this item, where 1.6 removed by substring);
 * 5. with a `GLD|` line the NPC pays price × count, and "I'm sorry but I can't afford to buy
 *    that." when its gold would go negative; with none the item goes for nothing;
 * 6. every SEL line containing `SEL|<item>` (a prefix: Trout also matches Trout Fillet) gets the
 *    count back as stock and its own "Thanks for the business!";
 * 7. The bag removal takes the count and rewrites the slot as `<sent name>-<rest>`, so it takes the
 *    line's spelling: Picha1's `long sword` renames `Long Sword`.
 */
export function npcSell(
  shop: ShopLedger,
  lineNo: number,
  count: number,
  seller: Buyer,
): ShopResult {
  const buy = shop.lines.find((l) => l.line === lineNo && l.kind === "BUY");
  if (!buy || count < 1) {
    return { ok: false, text: SHOP_TEXT.sellError };
  }
  const sold = sellName(buy.item, count, seller.bag);
  const old = sold.item;
  const n = sold.count;
  let base = old;
  if (lingoContains(old, "Cabinet")) {
    base = "Cabinet";
  }
  if (lingoContains(old, "Wind Cabinet")) {
    base = "Wind Cabinet";
  }
  if (lingoContains(old, "Crate")) {
    base = "Crate";
  }
  const file = shop.lines.map(lineText).join("\r");
  if (!lingoContains(file, `BUY|${base}:${buy.price}`)) {
    return { ok: false, text: SHOP_TEXT.sellError };
  }
  for (const l of seller.bag) {
    if (l && lingoContains(`${l.item}-${l.qty}`, `${old}-`) && l.qty < n) {
      return { ok: false, text: SHOP_TEXT.notEnoughToSell };
    }
  }
  const slot = seller.bag.findIndex((l) => l !== null && lingoEq(l.item, old));
  if (slot < 0) {
    return { ok: false, text: SHOP_TEXT.dontHave };
  }
  const ledger = cloneLedger(shop);
  const after = cloneBuyer(seller);
  const pay = buy.price * n;
  if (ledger.gold !== null) {
    if (ledger.gold - pay < 0) {
      return { ok: false, text: SHOP_TEXT.cantAffordToBuy };
    }
    ledger.gold -= pay;
    after.gold += pay;
  }
  const texts: string[] = [];
  for (const l of ledger.lines) {
    if (l.kind === "SEL" && l.line <= 80 && lingoContains(lineText(l), `SEL|${base}`)) {
      l.stock = (l.stock ?? 0) + n;
      texts.push(SHOP_TEXT.thanks);
    }
  }
  ledger.dirty = true;
  const line = after.bag[slot];
  if (line) {
    line.item = old;
    line.qty -= n;
    if (line.qty <= 0) {
      after.bag[slot] = null;
    }
  }
  return { ok: true, ledger, buyer: after, texts };
}

/** The buy window's rows: every SEL line (1.6's window showed only the first 30). */
export function sellList(shop: ShopLedger): { line: number; item: string; price: number }[] {
  return shop.lines
    .filter((l) => l.kind === "SEL")
    .map((l) => ({ line: l.line, item: l.item, price: l.price }));
}

/** The sell window's rows: every BUY line, not filtered to the bag (1.6 had no filter). */
export function buyList(shop: ShopLedger): { line: number; item: string; price: number }[] {
  return shop.lines
    .filter((l) => l.kind === "BUY")
    .map((l) => ({ line: l.line, item: l.item, price: l.price }));
}
