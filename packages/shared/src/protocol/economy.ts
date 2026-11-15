/** NPCs, shops, the vault and player-to-player trade. */
import { z } from "zod";

/** Click or tap a monster or NPC (sprites 180-183). */
export const npcClickSchema = z.strictObject({
  t: z.literal("npcClick"),
  slot: z.number().int().min(1).max(4),
});

/** The Bio window closed (`closeWindow`). */
export const npcCloseSchema = z.strictObject({ t: z.literal("npcClose") });

/** The Bio window's Buy or Sell button. */
export const shopListSchema = z.strictObject({
  t: z.literal("shopList"),
  mode: z.enum(["buy", "sell", "train"]),
});

/**
 * Not a game rule: an upper bound on a shop count. The original's quantity field had no limit and
 * the server compared it with stock.
 */
export const SHOP_COUNT_MAX = 9_999_999;

/** A file line of the open shop. */
const shopLine = z.number().int().min(1).max(10_000);

/** The buy OK: `count` of a SEL line. */
export const buySchema = z.strictObject({
  t: z.literal("buy"),
  line: shopLine,
  count: z.number().int().min(1).max(SHOP_COUNT_MAX),
});

/** The sell OK: `count` against a BUY line. */
export const sellSchema = z.strictObject({
  t: z.literal("sell"),
  line: shopLine,
  count: z.number().int().min(1).max(SHOP_COUNT_MAX),
});

/** The train OK: the `TRN|` line of the open list. */
export const trainSchema = z.strictObject({ t: z.literal("train"), line: shopLine });

/** CANCEL on the shop or vault window. */
export const shopCancelSchema = z.strictObject({ t: z.literal("shopCancel") });

/** The vault window's OK on a line: 1-based. */
export const vaultTakeSchema = z.strictObject({
  t: z.literal("vaultTake"),
  index: z.number().int().min(1).max(200),
});

/** The player menu's Trade on a player by id. */
export const tradeOpenSchema = z.strictObject({ t: z.literal("tradeOpen"), id: z.uuid() });

/**
 * The trade window's Trade button (either side's): gold and bag lines by slot. The server
 * clamps each amount to what you hold.
 */
export const tradeOfferSchema = z.strictObject({
  t: z.literal("tradeOffer"),
  gold: z
    .number()
    .int()
    .min(0)
    .max(2 ** 31),
  items: z
    .array(
      z.strictObject({
        slot: z.number().int().min(1).max(15),
        qty: z
          .number()
          .int()
          .min(1)
          .max(2 ** 31),
      }),
    )
    .max(15),
});

/** Accept (initiator only). */
export const tradeAcceptSchema = z.strictObject({ t: z.literal("tradeAccept") });

/** Cancel. */
export const tradeCancelSchema = z.strictObject({ t: z.literal("tradeCancel") });

/** One shop row: the item, its price and the file line it came from. */
export interface ShopRow {
  line: number;
  item: string;
  price: number;
}

/** One offered line in the trade window. */
export interface TradeLineView {
  item: string;
  qty: number;
}

/**
 * The trade window as you see it: `you` is "a" (you opened it) or "b". `mine` and `theirs`
 * are the locked offers, packed in offer order.
 */
export interface TradeView {
  you: "a" | "b";
  /** Your name and your partner's, for the Trader1 and Trader2 fields. */
  self: string;
  partner: string;
  mine: { gold: number; items: TradeLineView[] } | null;
  theirs: { gold: number; items: TradeLineView[] } | null;
}

export type EconomyServerMsg =
  /**
   * An NPC's Bio window: titled with its name, the `BIO|` and `PRO|` lines, Buy when it has `SEL|`,
   * Sell when it has `BUY|`.
   */
  | {
      t: "bio";
      name: string;
      bio: string[];
      profile: string[];
      buy: boolean;
      sell: boolean;
      train: boolean;
    }
  /**
   * A shop's sell or buy list: `buy` shows the buy OK, `sell` the sell OK. Rows
   * carry their file line, which the OK sends back.
   */
  | { t: "shop"; mode: "buy" | "sell" | "train"; rows: ShopRow[] }
  /** A buy or sell was handled: the PROCESSING box goes (sprite 370). */
  | { t: "processed" }
  /** The personal vault's lines. */
  | { t: "vault"; items: string[]; open: boolean }
  /** The trade window's state for you. */
  | { t: "trade"; trade: TradeView | null };
