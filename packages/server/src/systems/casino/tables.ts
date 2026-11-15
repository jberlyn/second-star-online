/**
 * Shared parts of the Blackjack and Checkers tables: a table is a `World.casinoTables` entry kept
 * while anyone is seated, keyed by the table item's tile. The server sends each seated player a
 * whole view after every change (small, and it makes a resume one message).
 */
import { CHAT_COLOR } from "@secondstaronline/shared";

import type { BjTable, CasinoTable, CkTable, Outgoing, Player, World } from "../world/world.ts";

export const tableKey = (map: string, x: number, y: number): string => `${map}:${x}:${y}`;

export const chat = (to: string, text: string): Outgoing => ({
  to,
  msg: { t: "chat", text, color: CHAT_COLOR.normal },
});

/** The seat's player when they are connected (not in a grace), else null. */
export function seatPlayer(world: World, table: CasinoTable, side: 1 | 2): Player | null {
  const seat = table.seats[side - 1];
  return seat && seat.awayIn === 0 ? (world.players.get(seat.id) ?? null) : null;
}

export const otherSide = (side: 1 | 2): 1 | 2 => (side === 1 ? 2 : 1);

/** A chat line to each connected seat. */
export function seatedTell(world: World, table: CasinoTable, text: string): Outgoing[] {
  return ([1, 2] as const).flatMap((s) => {
    const p = seatPlayer(world, table, s);
    return p ? [chat(p.id, text)] : [];
  });
}

/** One blackjack view, as `side` sees it: the opponent's second card is hidden until `shown`. */
export function bjView(
  table: BjTable,
  side: 1 | 2,
  sfx: ("shuffle" | "deal" | "cash")[],
): Outgoing["msg"] {
  const hide = (hand: number[], mine: boolean): (number | "back")[] =>
    hand.map((c, i) => (!mine && i === 1 && table.phase !== "shown" ? "back" : c));
  return {
    t: "bj",
    open: true,
    side,
    names: [table.seats[0]?.name ?? "", table.seats[1]?.name ?? ""],
    fields: [...table.fields],
    locked: [table.locked[0] !== null, table.locked[1] !== null],
    hands: [hide(table.hands[0], side === 1), hide(table.hands[1], side === 2)],
    sfx,
  };
}

export function bjViews(
  world: World,
  table: BjTable,
  sfx: ("shuffle" | "deal" | "cash")[] = [],
): Outgoing[] {
  return ([1, 2] as const).flatMap((s) => {
    const p = seatPlayer(world, table, s);
    return p ? [{ to: p.id, msg: bjView(table, s, sfx) }] : [];
  });
}

export function ckView(table: CkTable, side: 1 | 2, moved?: { turn: 1 | 2 }): Outgoing["msg"] {
  return {
    t: "ck",
    open: true,
    side,
    names: [table.seats[0]?.name ?? "", table.seats[1]?.name ?? ""],
    pieces: table.board.map((p) => ({ ...p })),
    ...(moved ? { moved } : {}),
  };
}

export function ckViews(world: World, table: CkTable, moved?: { turn: 1 | 2 }): Outgoing[] {
  return ([1, 2] as const).flatMap((s) => {
    const p = seatPlayer(world, table, s);
    return p ? [{ to: p.id, msg: ckView(table, s, moved) }] : [];
  });
}

/** Deletes a table when nobody is seated (an away seat still counts). */
export function dropIfEmpty(world: World, table: CasinoTable): void {
  if (!table.seats[0] && !table.seats[1]) {
    world.casinoTables.delete(table.key);
  }
}
