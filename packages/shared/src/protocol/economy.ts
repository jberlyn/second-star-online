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
  /**
   * A trainer's row for a class with paths (issue #15): what it needs and whether the buyer has it,
   * shown when the row is picked. Absent for 1.6's promotions, whose trainers say nothing more.
   */
  note?: string;
}

/** The player's Class window (issue #15): open it, or change class from it. */
export const classOpenSchema = z.strictObject({ t: z.literal("classOpen") });
export const classPromoteSchema = z.strictObject({
  t: z.literal("classPromote"),
  code: z.number().int().min(1).max(1_000_000),
});

/** One check of a way into a class, as the Class window lists it. */
export interface ClassCheckView {
  label: string;
  met: boolean;
}

/** A class as the Class window shows it. */
export interface ClassCardView {
  code: number;
  name: string;
  description: string | null;
  /** An item picture's name, or null. */
  icon: string | null;
  /** What the class gives, a line each ("+2 melee power"). */
  perks: string[];
}

/** One way out of your class (issue #15). */
export interface ClassWayView {
  to: ClassCardView;
  /** What the path says about itself, or null. */
  text: string | null;
  /** The trainers (NPC names) that teach it; empty for a path taken only from the window. */
  trainers: string[];
  /** The window's Change button may take it. */
  here: boolean;
  /** Each requirement, the gold and the items, in that order. */
  checks: ClassCheckView[];
  /** What it gives, a line each ("Slash raised to 20"). */
  grants: string[];
  /** Every check holds. */
  ready: boolean;
}

/** The Class window's contents. */
export interface ClassWindowView {
  current: ClassCardView;
  ways: ClassWayView[];
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
  /** You, and your partner, have accepted the offers as they stand. */
  mineAccepted: boolean;
  theirsAccepted: boolean;
}

export type EconomyServerMsg =
  /**
   * An NPC's Bio window: titled with its name, the `BIO|` and `PRO|` lines, Buy when it has `SEL|`,
   * Sell when it has `BUY|`.
   */
  | {
      t: "bio";
      name: string;
      /** The NPC's level, when the world shows monster levels and its species has one (#42). */
      level?: number;
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
  /**
   * A buy or sell was handled: the PROCESSING box goes (sprite 370). `ok` marks a buy or sale that
   * went through, which plays the cash sound.
   */
  | { t: "processed"; ok?: boolean }
  /**
   * The open vault's or container's lines. `open` opens the window (and locks the keys); `closed`
   * shuts it (access lost or the map changed), freeing the keys.
   */
  | { t: "vault"; items: string[]; open: boolean; closed?: boolean }
  /** The trade window's state for you. */
  | { t: "trade"; trade: TradeView | null }
  /** Opens or refreshes the Class window (issue #15). */
  | { t: "classWindow"; view: ClassWindowView };
