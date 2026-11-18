/**
 * NPC shops.
 *
 * Pure rules over a ledger (the NPC file's `GLD|`, `SEL|` and `BUY|` lines) and a buyer's gold and
 * bag. The order of checks and the texts follow the 1.6 server's NPC buy and sell handlers, with its
 * bugs fixed (see the economy entries in docs/divergences.md); the client's price, item name and
 * file name are replaced by a line the server owns, so items are bought and sold by line.
 */
import {
  addSlotFor,
  type Bag,
  invAdd,
  isUniqueContainer,
  lingoEq,
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
  /** The till: `GLD|`, or 0 with no such line. Null only in a ledger saved before tills were kept. */
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
 * A fresh ledger from an NPC file (the archive's, or an NPC editor save). The till is the `GLD|`
 * line wherever it is, or 0 with none (1.6 read it only among lines 1-80, and a shopkeeper without
 * one gave goods away and paid nothing).
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
  return { npc: n.name, gold: n.gold ?? 0, lines, dirty: false, goldLine: n.goldLine };
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
  /** The out-of-stock refusal, by name (1.6 read the name from an empty sprite and printed none). */
  outOfStock: (npc: string) => `${npc} says "Sorry but I'm out of that particular item."`,
  /** The `errsel` message. */
  sellError: "Error in trying to sell!",
  /** The `sqa` message. */
  notEnoughToSell: "You don't have enough of those to sell!",
  /** The `sqa` message. */
  dontHave: "You don't have that item.",
  /** The refusal when the NPC cannot pay, by name. */
  cantAffordToBuy: (npc: string) => `${npc} says "I'm sorry but I can't afford to buy that."`,
  /** A container with something stored in it is not bought (1.6 bought it and lost the contents). */
  notEmpty: (npc: string) => `${npc} says "Empty that out before you sell it to me."`,
  /** The thanks for every purchase and every sale, once, by name. */
  thanks: (npc: string) => `${npc} says "Thanks for the business!"`,
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
      /** The buyer after the trade. */
      buyer: Buyer;
      texts: string[];
      /** A container sold empty: its (empty) storage is forgotten. */
      soldContainer?: string;
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
 * 1. the price × count against the buyer's gold ("You don't have enough gold to buy this!");
 * 2. the line's own stock ("<NPC> says "Sorry but I'm out of that particular item."");
 * 3. room: a stack of exactly this item or an empty bag line; a bare container needs one empty
 *    line per container, since each gets its own `#id` ("You don't have enough room…");
 * 4. the price × count is charged and goes into the shopkeeper's till;
 * 5. the line's stock goes down, the items go into the bag and the shopkeeper thanks you.
 *
 * SSO fixes 1.6's bugs here: the chosen line is the one bought, at any line number (1.6's nested
 * loops shared a counter, so line 17 and later always read out of stock and an earlier match could
 * take a prefix's stock); a shopkeeper with no gold line charges into a till from 0; a full bag
 * holding "Orc Pot
 * Pie" no longer passes for "Pie"; each container bought gets its own id; refusals and thanks name
 * the shopkeeper. `taken` names container ids already in use.
 */
export function npcBuy(
  shop: ShopLedger,
  lineNo: number,
  count: number,
  buyer: Buyer,
  rng: Rng,
  taken?: (item: string) => boolean,
): ShopResult {
  const sel = shop.lines.find((l) => l.line === lineNo && l.kind === "SEL");
  if (!sel || count < 1) {
    return { ok: false, text: SHOP_TEXT.outOfStock(shop.npc) };
  }
  const item = sel.item;
  const cost = sel.price * count;
  if (buyer.gold < cost) {
    return { ok: false, text: SHOP_TEXT.cannotAfford };
  }
  if (count > (sel.stock ?? 0)) {
    return { ok: false, text: SHOP_TEXT.outOfStock(shop.npc) };
  }
  const container = isUniqueContainer(item);
  const roomy = container
    ? buyer.bag.filter((l) => l === null).length >= count
    : addSlotFor(buyer.bag, item) >= 0;
  if (!roomy) {
    return { ok: false, text: SHOP_TEXT.noRoom };
  }
  const ledger = cloneLedger(shop);
  const line = ledger.lines.find((l) => l.line === lineNo && l.kind === "SEL");
  if (!line) {
    return { ok: false, text: SHOP_TEXT.outOfStock(shop.npc) };
  }
  line.stock = (line.stock ?? 0) - count;
  const after = cloneBuyer(buyer);
  after.gold -= cost;
  ledger.gold = (ledger.gold ?? 0) + cost;
  ledger.dirty = true;
  if (container) {
    const fresh = new Set<string>();
    const used = (n: string) => fresh.has(n.toLowerCase()) || (taken?.(n) ?? false);
    for (let i = 0; i < count; i++) {
      const r = invAdd(after, item, 1, rng, used);
      if (r.kind === "bag") {
        fresh.add(r.item.toLowerCase());
      }
    }
  } else {
    invAdd(after, item, count, rng);
  }
  return { ok: true, ledger, buyer: after, texts: [SHOP_TEXT.thanks(shop.npc)] };
}

/** The container names the sell OK swaps for a bag slot's `Name#n`. */
const SELL_CONTAINERS = ["Wind Cabinet", "Cabinet", "Crate"] as const;

/**
 * The bag line a sale of `item` takes, and its count. A list line naming a Crate, Cabinet or Wind
 * Cabinet sells one bag `Crate#n`/`Cabinet#n`/`Wind Cabinet#n` of exactly that kind, an empty one
 * when you have one (`stored` gives a container's stored line count), else the first.
 */
export function sellName(
  item: string,
  count: number,
  bag: Bag,
  stored: (name: string) => number = () => 0,
): { item: string; count: number } {
  const kind = SELL_CONTAINERS.find((c) => lingoEq(item, c));
  if (!kind) {
    return { item, count };
  }
  const held = bag.filter(
    (l): l is NonNullable<typeof l> =>
      l !== null && lingoEq(l.item.split("#")[0] ?? "", kind) && l.item.includes("#"),
  );
  const pick = held.find((l) => stored(l.item) === 0) ?? held[0];
  return pick ? { item: pick.item, count: 1 } : { item, count };
}

/**
 * Selling `count` against the BUY line at file line `lineNo`, in order:
 * 1. a Crate, Cabinet or Wind Cabinet line sells one container of that kind from the bag;
 * 2. no such BUY line → "Error in trying to sell!" (`errsel`);
 * 3. a bag line holding exactly the item with fewer than `count` → "You don't have enough of those
 *    to sell!";
 * 4. no bag line holding the item → "You don't have that item.";
 * 5. a container with anything stored in it is refused, so its contents are never lost;
 * 6. the NPC pays price × count from its till (0 with no `GLD|` line); with too little, "<NPC> says
 *    "I'm sorry but I can't afford to buy that."" and nothing changes;
 * 7. the SEL line for exactly that item gets the count back as stock, and the NPC thanks you once.
 *
 * The bag removal takes the count and rewrites the slot under the line's spelling: Picha1's `long
 * sword` renames `Long Sword`.
 */
export function npcSell(
  shop: ShopLedger,
  lineNo: number,
  count: number,
  seller: Buyer,
  stored: (name: string) => number = () => 0,
): ShopResult {
  const buy = shop.lines.find((l) => l.line === lineNo && l.kind === "BUY");
  if (!buy || count < 1) {
    return { ok: false, text: SHOP_TEXT.sellError };
  }
  const sold = sellName(buy.item, count, seller.bag, stored);
  const old = sold.item;
  const n = sold.count;
  const base = old.includes("#") ? (old.split("#")[0] ?? old) : old;
  for (const l of seller.bag) {
    if (l && lingoEq(l.item, old) && l.qty < n) {
      return { ok: false, text: SHOP_TEXT.notEnoughToSell };
    }
  }
  const slot = seller.bag.findIndex((l) => l !== null && lingoEq(l.item, old));
  if (slot < 0) {
    return { ok: false, text: SHOP_TEXT.dontHave };
  }
  const container = base !== old;
  if (container && stored(old) > 0) {
    return { ok: false, text: SHOP_TEXT.notEmpty(shop.npc) };
  }
  const ledger = cloneLedger(shop);
  const after = cloneBuyer(seller);
  const pay = buy.price * n;
  const till = ledger.gold ?? 0;
  if (till - pay < 0) {
    return { ok: false, text: SHOP_TEXT.cantAffordToBuy(shop.npc) };
  }
  ledger.gold = till - pay;
  after.gold += pay;
  const restock = ledger.lines.find((l) => l.kind === "SEL" && lingoEq(l.item, base));
  if (restock) {
    restock.stock = (restock.stock ?? 0) + n;
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
  return {
    ok: true,
    ledger,
    buyer: after,
    texts: [SHOP_TEXT.thanks(shop.npc)],
    ...(container ? { soldContainer: old } : {}),
  };
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
