/**
 * The Blackjack Table.
 *
 * 1.6 dealt and settled on the clients; here the server holds the table. A bid is held from the
 * purse when it locks; a hand is a forfeit to the opponent when you leave mid-hand or stay away
 * past the reconnect grace. Leaving or changing map frees the seat.
 */
import {
  BJ_HAND_SIZE,
  BJ_RESET_FRAMES,
  BJ_TEXT,
  bidCheck,
  casinoSide,
  drawCard,
  fill,
  handTotal,
  isBlackjackTable,
  outcome,
  stake,
} from "@secondstaronline/shared";

import type { Rng } from "../../rng.ts";
import type { BjTable, GroundItem, Outgoing, Player, World } from "../world/world.ts";
import {
  bjViews,
  chat,
  dropIfEmpty,
  otherSide,
  seatedTell,
  seatPlayer,
  tableKey,
} from "./tables.ts";

export interface CasinoDeps {
  /** Ticks of reconnect grace (`SSO_RECONNECT_GRACE`, config.ts). */
  graceTicks: number;
  /** Gold for a character that is not logged in. */
  addGoldOffline(id: string, delta: number): void;
}

const idx = (side: 1 | 2): 0 | 1 => (side === 1 ? 0 : 1);

function bjTableOf(world: World, p: Player): { table: BjTable; side: 1 | 2 } | null {
  if (!p.casino || !p.casino.key.startsWith(`${p.map.name}:`)) {
    return null;
  }
  const t = world.casinoTables.get(p.casino.key);
  return t?.game === "blackjack" ? { table: t, side: p.casino.side } : null;
}

const giveGold = (p: Player, n: number): void => {
  if (n !== 0) {
    p.char.gold += n;
    p.invDirty = true;
  }
};

/** The connected players at `p`'s table, `p` first (those whose gold a table change can move). */
export function tablePlayers(world: World, p: Player): Player[] {
  const t = p.casino ? world.casinoTables.get(p.casino.key) : undefined;
  const mates = t ? ([1, 2] as const).flatMap((s) => seatPlayer(world, t, s) ?? []) : [];
  return [p, ...mates.filter((m) => m !== p)];
}

/** The gold held for `p` (the saved purse counts it until the hand settles). */
export function heldBy(world: World, p: Player): number {
  const t = bjTableOf(world, p);
  return t ? t.table.held[idx(t.side)] : 0;
}

/** What a save writes: the live purse plus the stake held at the table. */
export function savedGold(world: World, p: Player): number {
  return p.char.gold + heldBy(world, p);
}

/** Held gold goes back to the purses (a join, a leave before the deal). */
function releaseHolds(world: World, table: BjTable): void {
  for (const s of [1, 2] as const) {
    const p = seatPlayer(world, table, s);
    if (p) {
      giveGold(p, table.held[idx(s)]);
      table.held[idx(s)] = 0;
    }
  }
}

/** The table reset: cards cleared, locks and holds off; the fields stay. */
function resetTable(table: BjTable): void {
  table.hands = [[], []];
  table.locked = [null, null];
  table.holds = [false, false];
  table.stake = null;
  table.phase = "bids";
  table.resetIn = 0;
}

/** `BlackJackTableClick` from a click or Ctrl. */
export function bjSit(world: World, p: Player, g: GroundItem): Outgoing[] {
  if (!isBlackjackTable(g.item) || p.keyLock || p.slot !== null || p.casino !== null) {
    return [];
  }
  const side = casinoSide(p, g);
  if (side === null) {
    return [chat(p.id, BJ_TEXT.stand)];
  }
  const key = tableKey(p.map.name, g.x, g.y);
  let table = world.casinoTables.get(key);
  if (table && table.game !== "blackjack") {
    return [];
  }
  if (!table) {
    table = {
      game: "blackjack",
      key,
      seats: [null, null],
      locked: [null, null],
      held: [0, 0],
      fields: ["", ""],
      stake: null,
      hands: [[], []],
      holds: [false, false],
      phase: "bids",
      resetIn: 0,
    };
    world.casinoTables.set(key, table);
  }
  if (table.seats[idx(side)]) {
    return [chat(p.id, BJ_TEXT.taken)];
  }
  table.seats[idx(side)] = { id: p.id, name: p.name, awayIn: 0 };
  p.casino = { key, side };
  p.keyLock = true;
  // The join resets the table; a lock in place is released and its hold returned.
  releaseHolds(world, table);
  resetTable(table);
  table.fields[idx(side)] = "0";
  const out: Outgoing[] = [];
  const opp = seatPlayer(world, table, otherSide(side));
  if (opp) {
    table.fields[idx(otherSide(side))] = "0";
    out.push(chat(opp.id, fill(BJ_TEXT.joined, { USER: p.name })));
    out.push(chat(p.id, fill(BJ_TEXT.seat, { USER: opp.name })));
  }
  out.push(...bjViews(world, table, ["shuffle"]));
  return out;
}

/** The two bids are in: the stake, the excess back, the deal. */
function startHand(world: World, table: BjTable, rng: Rng): Outgoing[] {
  const [b1, b2] = [table.locked[0] ?? 0, table.locked[1] ?? 0];
  const s = stake(b1, b2);
  table.stake = s;
  const out = seatedTell(world, table, fill(BJ_TEXT.stake, { N: s }));
  for (const side of [1, 2] as const) {
    const p = seatPlayer(world, table, side);
    const over = table.held[idx(side)] - s;
    if (p && over > 0) {
      giveGold(p, over);
    }
    table.held[idx(side)] = Math.min(table.held[idx(side)], s);
    table.fields[idx(side)] = String(s);
  }
  // P1, P1, P2, P2.
  table.hands[0].push(drawCard(rng), drawCard(rng));
  table.hands[1].push(drawCard(rng), drawCard(rng));
  table.phase = "play";
  for (const side of [1, 2] as const) {
    const p = seatPlayer(world, table, side);
    if (p) {
      out.push(chat(p.id, fill(BJ_TEXT.holding, { N: handTotal(table.hands[idx(side)]) })));
    }
  }
  out.push(...bjViews(world, table, ["deal", "deal", "deal", "deal"]));
  return out;
}

/** The bid buttons' check and the server's own bid check; the bid is held at the lock. */
export function bjBid(world: World, p: Player, text: string, rng: Rng): Outgoing[] {
  const t = bjTableOf(world, p);
  if (!t || t.table.phase !== "bids" || t.table.locked[idx(t.side)] !== null) {
    return [];
  }
  const { table, side } = t;
  const r = bidCheck(text, p.char.gold);
  if (r.kind === "none") {
    return [];
  }
  if (r.kind === "max") {
    return [chat(p.id, BJ_TEXT.bidMax)];
  }
  if (r.kind === "poor") {
    return [chat(p.id, BJ_TEXT.noGold)];
  }
  giveGold(p, -r.bid);
  table.held[idx(side)] = r.bid;
  table.locked[idx(side)] = r.bid;
  table.fields[idx(side)] = String(r.bid);
  const out = seatedTell(world, table, fill(BJ_TEXT.bid, { USER: p.name, BID: r.bid }));
  if (table.locked[0] !== null && table.locked[1] !== null) {
    out.push(...startHand(world, table, rng));
  } else {
    out.push(...bjViews(world, table));
  }
  return out;
}

/**
 * The hit and stand buttons' gates: seated, both first cards dealt, the hand running, you not
 * holding.
 */
function playGate(world: World, p: Player): { table: BjTable; side: 1 | 2 } | null {
  const t = bjTableOf(world, p);
  if (!t) {
    return null;
  }
  const { table, side } = t;
  if (table.phase !== "play" || !table.hands[0].length || !table.hands[1].length) {
    return null;
  }
  return table.holds[idx(side)] ? null : t;
}

/** Both hold: the hand settles unless someone is away. */
function settle(world: World, table: BjTable): Outgoing[] {
  const lines = outcome(handTotal(table.hands[0]), handTotal(table.hands[1]));
  const out: Outgoing[] = [];
  for (const l of lines) {
    const text =
      l === "draw" ? BJ_TEXT.draw : fill(BJ_TEXT.won, { USER: table.seats[idx(l)]?.name ?? "" });
    out.push(...seatedTell(world, table, text));
  }
  const last = lines[lines.length - 1];
  const pot = table.held[0] + table.held[1];
  for (const side of [1, 2] as const) {
    const p = seatPlayer(world, table, side);
    if (p) {
      giveGold(
        p,
        last === "draw" || last === undefined ? table.held[idx(side)] : last === side ? pot : 0,
      );
    }
  }
  table.held = [0, 0];
  table.phase = "shown";
  table.resetIn = BJ_RESET_FRAMES;
  out.push(...bjViews(world, table, ["cash"]));
  return out;
}

const bothHere = (world: World, table: BjTable): boolean =>
  seatPlayer(world, table, 1) !== null && seatPlayer(world, table, 2) !== null;

/** Stand: 1.6 ran this on every client, and Player 1's client settled the hand. */
function stand(world: World, table: BjTable, side: 1 | 2): Outgoing[] {
  table.holds[idx(side)] = true;
  const out = seatedTell(
    world,
    table,
    fill(BJ_TEXT.holds, { USER: table.seats[idx(side)]?.name ?? "" }),
  );
  if (table.holds[0] && table.holds[1] && bothHere(world, table)) {
    out.push(...settle(world, table));
  }
  return out;
}

export function bjStand(world: World, p: Player): Outgoing[] {
  const g = playGate(world, p);
  return g ? stand(world, g.table, g.side) : [];
}

/**
 * Hit: a card into your first empty slot, followed by the running total; a total over 21 or a
 * full five-card hand automatically stands you.
 */
export function bjHit(world: World, p: Player, rng: Rng): Outgoing[] {
  const g = playGate(world, p);
  if (!g) {
    return [];
  }
  const hand = g.table.hands[idx(g.side)];
  if (hand.length >= BJ_HAND_SIZE) {
    return [];
  }
  hand.push(drawCard(rng));
  const total = handTotal(hand);
  const out: Outgoing[] = [chat(p.id, fill(BJ_TEXT.holding, { N: total }))];
  out.push(...bjViews(world, g.table, ["deal"]));
  if (total > 21 || hand.length >= BJ_HAND_SIZE) {
    out.push(...stand(world, g.table, g.side));
  }
  return out;
}

/**
 * Removes a seat. Before the deal your hold goes back; mid-hand it is a forfeit: the opponent gets
 * both holds; during the show nothing is held. The opponent sees `left` and a reset. `offline` is a
 * drop past the grace (the loser's saved gold includes the hold).
 */
function dropSeat(
  world: World,
  table: BjTable,
  side: 1 | 2,
  deps: CasinoDeps,
  offline: boolean,
): Outgoing[] {
  const out: Outgoing[] = [];
  const me = table.seats[idx(side)];
  const oppSide = otherSide(side);
  const opp = seatPlayer(world, table, oppSide);
  if (table.phase === "play") {
    const pot = table.held[0] + table.held[1];
    const oppSeat = table.seats[idx(oppSide)];
    if (opp) {
      giveGold(opp, pot);
    } else if (oppSeat) {
      // The winner is away too: their saved gold already holds their own stake.
      deps.addGoldOffline(oppSeat.id, table.held[idx(side)]);
    }
    if (offline && me) {
      deps.addGoldOffline(me.id, -table.held[idx(side)]);
    }
    // A forfeit by a connected leaver: their saved row holds purse + stake (`savedGold`), so it
    // must be written again now the stake is gone, or a re-login brings the stake back while the
    // winner keeps it.
    const leaver = offline ? undefined : seatPlayer(world, table, side);
    if (leaver) {
      leaver.invDirty = true;
    }
    table.held = [0, 0];
  } else {
    const mine = table.held[idx(side)];
    const p = seatPlayer(world, table, side);
    if (p) {
      giveGold(p, mine);
    }
    table.held[idx(side)] = 0;
  }
  table.seats[idx(side)] = null;
  table.fields[idx(side)] = "";
  if (table.seats[idx(oppSide)]) {
    // The leaver's lock is gone with the reset; the stayer's hold comes back.
    releaseHolds(world, table);
    resetTable(table);
    if (opp) {
      out.push(chat(opp.id, fill(BJ_TEXT.left, { USER: me?.name ?? "" })));
    }
    const oppSeat = table.seats[idx(oppSide)];
    if (oppSeat && oppSeat.awayIn > 0) {
      // An away stayer has nobody to tell: their seat goes with the hand.
      table.seats[idx(oppSide)] = null;
    }
    out.push(...bjViews(world, table, ["shuffle"]));
  }
  dropIfEmpty(world, table);
  return out;
}

/** Leave, any time. */
export function bjLeave(world: World, p: Player, deps: CasinoDeps): Outgoing[] {
  const t = bjTableOf(world, p);
  if (!t) {
    return [];
  }
  const out = dropSeat(world, t.table, t.side, deps, false);
  p.casino = null;
  p.keyLock = false;
  out.push({ to: p.id, msg: { t: "bj", open: false } });
  return out;
}

/**
 * A dropped connection, before the player leaves the world: mid-hand the seat waits the grace and
 * the saved gold keeps the hold; otherwise it is a Leave.
 */
export function bjDisconnect(world: World, p: Player, deps: CasinoDeps): Outgoing[] {
  const t = bjTableOf(world, p);
  if (!t) {
    return [];
  }
  const seat = t.table.seats[idx(t.side)];
  if (t.table.phase === "play" && seat) {
    seat.awayIn = Math.max(1, deps.graceTicks);
    return [];
  }
  const out = dropSeat(world, t.table, t.side, deps, false);
  p.casino = null;
  return out;
}

/** A resume or a fresh login inside the grace: the table reopens as it was, with no line. */
export function bjReturn(world: World, p: Player): Outgoing[] {
  for (const table of world.casinoTables.values()) {
    if (table.game !== "blackjack") {
      continue;
    }
    for (const side of [1, 2] as const) {
      const seat = table.seats[idx(side)];
      if (seat && seat.id === p.id && seat.awayIn > 0) {
        seat.awayIn = 0;
        seat.name = p.name;
        p.casino = { key: table.key, side };
        p.keyLock = true;
        // The loaded purse includes the hold; take it out again.
        giveGold(p, -Math.min(table.held[idx(side)], p.char.gold));
        const out: Outgoing[] = bjViews(world, table).filter((o) => o.to === p.id);
        if (table.holds[0] && table.holds[1] && table.phase === "play") {
          out.push(...settle(world, table));
        }
        return out;
      }
    }
  }
  return [];
}

/** One tick: the 40-frame reset and the grace. */
export function bjTick(world: World, table: BjTable, deps: CasinoDeps): Outgoing[] {
  const out: Outgoing[] = [];
  if (table.phase === "shown") {
    table.resetIn -= 1;
    if (table.resetIn <= 0) {
      resetTable(table);
      out.push(...bjViews(world, table, ["shuffle"]));
    }
  }
  for (const side of [1, 2] as const) {
    const seat = table.seats[idx(side)];
    if (seat && seat.awayIn > 0) {
      seat.awayIn -= 1;
      if (seat.awayIn === 0) {
        out.push(...dropSeat(world, table, side, deps, true));
      }
    }
  }
  return out;
}
