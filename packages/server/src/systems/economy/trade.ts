/**
 * Player-to-player trade.
 *
 * 1.6's flow, held by the server: A picks Trade from B's menu and A's window opens; A's Trade sends
 * A's offer and opens B's window; B's Trade sends B's; only A can Accept, and the server moves
 * everything in one go. An offer cannot change once sent. Equipment is never listed.
 *
 * SSO: both names come from the sessions and B's Trade press is B's consent; Accept checks B is
 * still on A's map instead of the sprite slot after B's; a trade ends when either player changes
 * map or leaves; a third player cannot take over or redirect an open trade.
 */
import {
  addSlotFor,
  type Bag,
  lingoEq,
  type TradeOfferMsg,
  type TradeView,
} from "@secondstaronline/shared";

import type { Outgoing, Player, Trade, TradeOffer, World } from "../world/world.ts";

export const TRADE_TEXT = {
  self: "You can't trade with yourself!",
  initiating: (a: string) => `${a} is initiating a trade with you.`,
  selected: (b: string) => `${b} has selected the items to trade. Accept or cancel the trade.`,
  youAccept: "You accept the trade...",
  accepts: (a: string) => `${a} accepts the trade...`,
  gone: (b: string) => `${b} is no longer in your area, you cannot trade.`, // TW 2:72-76
  youCancel: "You cancel the trade.",
  cancelled: "Trade cancelled.",
  problem: "There was a problem with the transaction. Try again!",
} as const;

const tell = (p: Player, text: string): Outgoing => ({
  to: p.id,
  msg: { t: "chat", text, color: 0 },
});

const lines = (o: TradeOffer | null) =>
  o ? { gold: o.gold, items: o.items.map((i) => ({ item: i.item, qty: i.qty })) } : null;

/** What `p` sees of `t`. A sees B's offer only after B's Trade; B sees A's from the start. */
export function tradeView(t: Trade, p: Player, partner: string): TradeView {
  const isA = t.a === p.id;
  return {
    you: isA ? "a" : "b",
    self: p.name,
    partner,
    mine: lines(isA ? t.aOffer : t.bOffer),
    theirs: lines(isA ? t.bOffer : t.aOffer),
  };
}

const view = (p: Player, v: TradeView | null): Outgoing => ({
  to: p.id,
  msg: { t: "trade", trade: v },
});

function end(world: World, t: Trade): void {
  world.trades.delete(t.id);
  for (const id of [t.a, t.b]) {
    const q = world.players.get(id);
    if (q && q.trade === t.id) {
      q.trade = null;
    }
  }
}

/** The menu's Trade on another player. */
export function openTrade(world: World, p: Player, targetId: string): Outgoing[] {
  if (targetId === p.id) {
    return [tell(p, TRADE_TEXT.self)];
  }
  const b = world.players.get(targetId);
  // A trade already in progress exits silently; so does a player not on your map.
  if (!b || b.map !== p.map || p.trade) {
    return [];
  }
  const t: Trade = { id: Bun.randomUUIDv7(), a: p.id, b: b.id, aOffer: null, bOffer: null };
  world.trades.set(t.id, t);
  p.trade = t.id;
  return [view(p, tradeView(t, p, b.name))];
}

/**
 * The window's Trade button: each amount is clamped to what you hold and lines of 0 are left out;
 * the offer is then locked.
 */
export function offerTrade(world: World, p: Player, msg: TradeOfferMsg): Outgoing[] {
  const t = p.trade ? world.trades.get(p.trade) : undefined;
  if (!t) {
    return [];
  }
  const isA = t.a === p.id;
  const other = world.players.get(isA ? t.b : t.a);
  if (!other) {
    return cancelTrade(world, p);
  }
  if (isA ? t.aOffer !== null : t.aOffer === null || t.bOffer !== null) {
    return [];
  }
  const offer: TradeOffer = { gold: Math.min(msg.gold, p.char.gold), items: [] };
  const seen = new Set<number>();
  for (const it of msg.items) {
    const line = p.char.bag[it.slot - 1];
    if (!line || seen.has(it.slot)) {
      continue;
    }
    seen.add(it.slot);
    const qty = Math.min(it.qty, line.qty);
    if (qty > 0) {
      offer.items.push({ slot: it.slot, item: line.item, qty });
    }
  }
  if (isA) {
    // B must not be in another trade: in 1.6 A's first send took B over (closed).
    if (other.trade !== null && other.trade !== t.id) {
      end(world, t);
      return [view(p, null), tell(p, TRADE_TEXT.cancelled)];
    }
    t.aOffer = offer;
    other.trade = t.id;
    return [
      view(p, tradeView(t, p, other.name)),
      view(other, tradeView(t, other, p.name)),
      tell(other, TRADE_TEXT.initiating(p.name)),
    ];
  }
  t.bOffer = offer;
  return [
    view(p, tradeView(t, p, other.name)),
    view(other, tradeView(t, other, p.name)),
    tell(other, TRADE_TEXT.selected(p.name)),
  ];
}

/** Cancel on either side. */
export function cancelTrade(world: World, p: Player): Outgoing[] {
  const t = p.trade ? world.trades.get(p.trade) : undefined;
  if (!t) {
    p.trade = null;
    return [view(p, null)];
  }
  const isA = t.a === p.id;
  const other = world.players.get(isA ? t.b : t.a);
  end(world, t);
  const out: Outgoing[] = [view(p, null)];
  if (isA) {
    out.push(tell(p, TRADE_TEXT.youCancel));
  }
  // The receiver resets only if its window is open: B's opens with A's offer.
  if (other && (!isA || t.aOffer !== null)) {
    out.push(view(other, null), tell(other, TRADE_TEXT.cancelled));
  }
  return out;
}

/**
 * A trader changed map or left: the trade ends for both, each told "Trade cancelled." (the
 * leaver only if still connected and its window was open).
 */
export function leaveTrade(world: World, p: Player): Outgoing[] {
  const t = p.trade ? world.trades.get(p.trade) : undefined;
  if (!t) {
    return [];
  }
  const isA = t.a === p.id;
  const other = world.players.get(isA ? t.b : t.a);
  end(world, t);
  const out: Outgoing[] = [];
  if (world.players.has(p.id)) {
    out.push(view(p, null), tell(p, TRADE_TEXT.cancelled));
  }
  if (other && (!isA || t.aOffer !== null)) {
    out.push(view(other, null), tell(other, TRADE_TEXT.cancelled));
  }
  return out;
}

interface Side {
  gold: number;
  bag: Bag;
}

const clone = (s: Side): Side => ({ gold: s.gold, bag: s.bag.map((l) => (l ? { ...l } : null)) });

function take(s: Side, o: TradeOffer): boolean {
  s.gold -= o.gold;
  if (s.gold < 0) {
    return false;
  }
  for (const it of o.items) {
    const line = s.bag[it.slot - 1];
    if (!line || !lingoEq(line.item, it.item) || line.qty < it.qty) {
      return false;
    }
    line.qty -= it.qty;
    if (line.qty === 0) {
      s.bag[it.slot - 1] = null;
    }
  }
  return true;
}

function give(s: Side, o: TradeOffer): boolean {
  s.gold += o.gold;
  for (const it of o.items) {
    const i = addSlotFor(s.bag, it.item);
    if (i < 0) {
      return false;
    }
    const line = s.bag[i];
    if (line) {
      line.qty += it.qty;
    } else {
      s.bag[i] = { item: it.item, qty: it.qty };
    }
  }
  return true;
}

/**
 * The settlement: subtract A's lines from A, B's from B, then add B's to A and A's to B (each
 * stacks on an exact name, else the lowest empty line, after its own side gave). Any failure
 * changes nothing. Null on failure.
 */
export function settle(
  a: Side,
  b: Side,
  ao: TradeOffer,
  bo: TradeOffer,
): { a: Side; b: Side } | null {
  const na = clone(a);
  const nb = clone(b);
  if (!take(na, ao) || !take(nb, bo) || !give(na, bo) || !give(nb, ao)) {
    return null;
  }
  return { a: na, b: nb };
}

/** Accept (A only). */
export function acceptTrade(world: World, p: Player): Outgoing[] {
  const t = p.trade ? world.trades.get(p.trade) : undefined;
  if (!t || t.a !== p.id || !t.aOffer || !t.bOffer) {
    return [];
  }
  const b = world.players.get(t.b);
  if (!b || b.map !== p.map) {
    // The window stays open and the partner is told nothing (TW 2:72-76).
    return [tell(p, TRADE_TEXT.gone(b?.name ?? ""))];
  }
  end(world, t);
  const out: Outgoing[] = [
    view(p, null),
    tell(p, TRADE_TEXT.youAccept),
    view(b, null),
    tell(b, TRADE_TEXT.accepts(p.name)),
  ];
  const r = settle(p.char, b.char, t.aOffer, t.bOffer);
  if (!r) {
    out.push(tell(p, TRADE_TEXT.problem), tell(b, TRADE_TEXT.problem));
    return out;
  }
  p.char.gold = r.a.gold;
  p.char.bag = r.a.bag;
  b.char.gold = r.b.gold;
  b.char.bag = r.b.bag;
  p.invDirty = true;
  b.invDirty = true;
  return out;
}
