/**
 * The Checkers Table. The server holds the pieces, the turn and nothing else: the selection and the
 * turn marker are the client's own. The seat survives a map change; a drop or closing the window
 * frees it.
 */
import {
  CK_TEXT,
  casinoSide,
  checkersMove,
  fill,
  heardSqa,
  isCheckersTable,
  loser,
  promote,
  startBoard,
} from "@secondstaronline/shared";

import { hears } from "../chat/ignore.ts";
import type { CkTable, GroundItem, Outgoing, Player, World } from "../world/world.ts";
import { chat, ckViews, dropIfEmpty, otherSide, seatPlayer, tableKey } from "./tables.ts";

const idx = (side: 1 | 2): 0 | 1 => (side === 1 ? 0 : 1);

function ckTableOf(world: World, p: Player): { table: CkTable; side: 1 | 2 } | null {
  const t = p.casino ? world.casinoTables.get(p.casino.key) : undefined;
  return p.casino && t?.game === "checkers" ? { table: t, side: p.casino.side } : null;
}

/** The click or Ctrl on a checkers table, which also joins the game. */
export function ckSit(world: World, p: Player, g: GroundItem): Outgoing[] {
  if (!isCheckersTable(g.item) || p.keyLock || p.slot !== null || p.casino !== null) {
    return [];
  }
  const side = casinoSide(p, g);
  if (side === null) {
    return [chat(p.id, CK_TEXT.stand)];
  }
  const key = tableKey(p.map.name, g.x, g.y);
  let table = world.casinoTables.get(key);
  if (table && table.game !== "checkers") {
    return [];
  }
  if (!table) {
    table = { game: "checkers", key, seats: [null, null], board: startBoard(), turn: 0 };
    world.casinoTables.set(key, table);
  }
  if (table.seats[idx(side)]) {
    return [chat(p.id, CK_TEXT.taken)];
  }
  table.seats[idx(side)] = { id: p.id, name: p.name, awayIn: 0 };
  p.casino = { key, side };
  p.keyLock = true;
  table.board = startBoard();
  const first = seatPlayer(world, table, otherSide(side));
  const out: Outgoing[] = [];
  if (first) {
    // Both sides known: the board resets and Black moves. The first player sees the start line
    // twice, the newcomer once.
    table.turn = 1;
    const line = fill(CK_TEXT.start, { USER: table.seats[0]?.name ?? "" });
    out.push(chat(first.id, line), chat(first.id, line), chat(p.id, line));
  } else {
    table.turn = 0;
  }
  out.push(...ckViews(world, table));
  return out;
}

/** A piece move, then the checks after each message. */
export function ckMove(world: World, p: Player, piece: number, dh: number, dv: number): Outgoing[] {
  const t = ckTableOf(world, p);
  if (!t || !t.table.seats[0] || !t.table.seats[1] || t.table.turn !== t.side) {
    return [];
  }
  const { table, side } = t;
  const r = checkersMove(table.board, piece, side, dh, dv);
  if (r.kind === "none") {
    return [];
  }
  table.board = promote(r.board, piece);
  const lost = loser(table.board);
  if (lost === null) {
    table.turn = otherSide(side);
    return ckViews(world, table, { turn: table.turn });
  }
  // The loser's client says the win line to its map and the board resets; the winning move's
  // your-turn message arrives after the reset, so the loser moves first.
  const loserPlayer = seatPlayer(world, table, lost);
  const winnerName = table.seats[idx(otherSide(lost))]?.name ?? "";
  const out: Outgoing[] = [];
  if (loserPlayer) {
    const text = fill(CK_TEXT.win, { USER: winnerName });
    const room = world.rooms.get(loserPlayer.map.name);
    for (const o of room ? room.players : [loserPlayer]) {
      if (hears(o, loserPlayer.name)) {
        out.push(chat(o.id, heardSqa(text, o.map.name, o.y)));
      }
    }
  }
  table.board = startBoard();
  table.turn = lost;
  out.push(...ckViews(world, table, { turn: lost }));
  return out;
}

function leaveSeat(world: World, table: CkTable, side: 1 | 2): Outgoing[] {
  table.seats[idx(side)] = null;
  // The stayer's board resets and waits for a new opponent.
  table.board = startBoard();
  table.turn = 0;
  const out = ckViews(world, table);
  dropIfEmpty(world, table);
  return out;
}

/** Closing the window quits; a drop or logout does the same. */
export function ckClose(world: World, p: Player): Outgoing[] {
  const t = ckTableOf(world, p);
  if (!t) {
    return [];
  }
  p.casino = null;
  p.keyLock = false;
  return leaveSeat(world, t.table, t.side);
}

/** A dropped connection frees the seat at once. */
export function ckDisconnect(world: World, p: Player): Outgoing[] {
  const t = ckTableOf(world, p);
  if (!t) {
    return [];
  }
  p.casino = null;
  return leaveSeat(world, t.table, t.side);
}
