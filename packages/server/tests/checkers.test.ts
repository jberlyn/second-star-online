/**
 * Sim tests: the Checkers Table.
 */
import { describe, expect, test } from "bun:test";

import { type Piece, type ServerMsg, startBoard } from "@secondstaronline/shared";

import { ckClose, ckDisconnect, ckMove, ckSit } from "../src/systems/casino/checkers.ts";
import { actionIntent, pickupIntent } from "../src/systems/inventory/items.ts";
import { warp } from "../src/systems/world/tick.ts";
import type { CkTable, GroundItem, Player } from "../src/systems/world/world.ts";
import { player, rngByN, setup, testMap } from "./helpers/sim.ts";

type Out = { to: string; msg: ServerMsg }[];
const chat = (msgs: Out, to: string) =>
  msgs.flatMap((m) => (m.to === to && m.msg.t === "chat" ? [m.msg.text] : []));
const views = (msgs: Out, to: string) =>
  msgs.flatMap((m) => (m.to === to && m.msg.t === "ck" && m.msg.open ? [m.msg] : []));

const STAND = "This is Checkers table, but you must be standing beside it to play!";
const START = "*** The Checkers Game Has Started. It's Alice's (black) turn.";

function scene() {
  const map = testMap("x1000y992");
  const other = testMap("x1001y992");
  const s = setup([map, other]);
  const table: GroundItem = {
    id: "ck",
    item: "Checkers Table",
    x: 10,
    y: 5,
    kind: "drop",
    expiresAt: null,
  };
  map.ground.push(table);
  const join = (name: string, x: number, y = 5): Player => {
    const p = player(name, map, x, y);
    s.join(p);
    return p;
  };
  const key = "x1000y992:10:5";
  const tbl = () => s.world.casinoTables.get(key) as CkTable;
  const seated = () => {
    const a = join("Alice", 9);
    const b = join("Bob", 11);
    ckSit(s.world, a, table);
    ckSit(s.world, b, table);
    return { a, b };
  };
  return { ...s, map, other, table, join, key, tbl, seated, rng: rngByN() };
}

describe("sitting and the start", () => {
  test("the window opens on the side you stand; the stand text shows every time, there is no joined-blackjack gate", () => {
    const t = scene();
    const far = t.join("Far", 3);
    expect(chat(ckSit(t.world, far, t.table), "Far")).toEqual([STAND]);
    expect(chat(ckSit(t.world, far, t.table), "Far")).toEqual([STAND]);
    const a = t.join("Alice", 9);
    const out = ckSit(t.world, a, t.table);
    expect(views(out, "Alice")[0]?.names).toEqual(["Alice", ""]);
    expect(a.casino).toEqual({ key: t.key, side: 1 });
    expect(a.keyLock).toBe(true);
    expect(t.tbl().turn).toBe(0);
  });

  test("kept bug: the first player sees the start line twice, the newcomer once", () => {
    const t = scene();
    const a = t.join("Alice", 9);
    const b = t.join("Bob", 11);
    ckSit(t.world, a, t.table);
    const out = ckSit(t.world, b, t.table);
    expect(chat(out, "Alice")).toEqual([START, START]);
    expect(chat(out, "Bob")).toEqual([START]);
    expect(t.tbl().turn).toBe(1);
    expect(views(out, "Bob")[0]?.names).toEqual(["Alice", "Bob"]);
    expect(views(out, "Bob")[0]?.pieces).toEqual(startBoard());
  });

  test("a taken seat, a third player, a longer name, an open screen all refuse", () => {
    const t = scene();
    t.seated();
    const c = t.join("Carol", 9);
    expect(chat(ckSit(t.world, c, t.table), "Carol")).toEqual(["That seat is taken."]);
    const d = t.join("Dan", 11);
    d.keyLock = true;
    expect(ckSit(t.world, d, t.table)).toEqual([]);
    const e = t.join("Eve", 9);
    expect(ckSit(t.world, e, { ...t.table, item: "Checkers Table 2" })).toEqual([]);
  });
});

describe("moves", () => {
  test("only on your turn, only the legal move; the new turn goes to both views", () => {
    const t = scene();
    const { a, b } = t.seated();
    // Black piece 8 (index 8: channel 10 at 73,214) moves up-right to 105,182.
    expect(ckMove(t.world, b, 12, 1, 1)).toEqual([]); // White, not Bob's turn
    expect(ckMove(t.world, a, 12, 1, 1)).toEqual([]); // White's piece, Alice's turn
    expect(ckMove(t.world, a, 8, 0, -1)).toEqual([]); // not a diagonal
    const out = ckMove(t.world, a, 8, 1, -1);
    expect(views(out, "Alice")[0]?.moved).toEqual({ turn: 2 });
    expect(views(out, "Bob")[0]?.moved).toEqual({ turn: 2 });
    expect(t.tbl().board[8]).toEqual({ h: 105, v: 182, m: "Black" });
    expect(t.tbl().turn).toBe(2);
    expect(ckMove(t.world, a, 9, 1, -1)).toEqual([]); // Alice again: not her turn
  });

  test("a capture, then a king, then the win line from the loser to the map", () => {
    const t = scene();
    const { a, b } = t.seated();
    const tbl = t.tbl();
    const gone = (p: Piece): Piece => ({ ...p, h: p.h - 864, v: p.v - 864 });
    tbl.board = startBoard().map((p, i) => (i === 0 || i === 12 ? p : gone(p)));
    tbl.board[0] = { h: 105, v: 118, m: "Black" };
    tbl.board[12] = { h: 73, v: 86, m: "White" };
    // Black jumps White: 105,118 -> 41,54 (a king there is checked after).
    const out = ckMove(t.world, a, 0, -1, -1);
    // White has no piece left: Bob (White) is the loser and says it to his map.
    expect(chat(out, "Alice")).toEqual(["*** Alice has won the game!"]);
    expect(chat(out, "Bob")).toEqual(["*** Alice has won the game!"]);
    // The loser moves first, with no start line.
    expect(t.tbl().turn).toBe(2);
    expect(t.tbl().board).toEqual(startBoard());
    expect(views(out, "Alice")[0]?.moved).toEqual({ turn: 2 });
    expect(chat(out, "Alice")).not.toContain(START);
    const next = ckMove(t.world, b, 20, 1, 1);
    expect(views(next, "Bob")[0]?.moved).toEqual({ turn: 1 });
  });

  test("the win line is dropped for someone ignoring the loser", () => {
    const t = scene();
    const { a } = t.seated();
    const c = t.join("Carol", 2);
    c.ignore = ["Bob"];
    const tbl = t.tbl();
    tbl.board = startBoard().map((p, i) =>
      i === 0 || i === 12 ? p : { ...p, h: p.h - 864, v: p.v - 864 },
    );
    tbl.board[0] = { h: 105, v: 118, m: "Black" };
    tbl.board[12] = { h: 73, v: 86, m: "White" };
    const out = ckMove(t.world, a, 0, -1, -1);
    expect(chat(out, "Carol")).toEqual([]);
    expect(chat(out, "Alice")).toHaveLength(1);
  });

  test("kept bug: no multi-jump, no win by blocking: pieces left means play goes on", () => {
    const t = scene();
    const { a } = t.seated();
    const tbl = t.tbl();
    tbl.board = startBoard().map((p, i) =>
      i === 0 || i === 12 || i === 13 ? p : { ...p, h: p.h - 864, v: p.v - 864 },
    );
    tbl.board[0] = { h: 169, v: 214, m: "Black" };
    tbl.board[12] = { h: 137, v: 182, m: "White" };
    tbl.board[13] = { h: 73, v: 118, m: "White" };
    const out = ckMove(t.world, a, 0, -1, -1);
    expect(tbl.board[0]).toEqual({ h: 105, v: 150, m: "Black" });
    expect(views(out, "Bob")[0]?.moved).toEqual({ turn: 2 });
  });
});

describe("leaving", () => {
  test("close frees the seat and the stayer's board waits with the name blank", () => {
    const t = scene();
    const { a, b } = t.seated();
    ckMove(t.world, a, 8, 1, -1);
    const out = ckClose(t.world, b);
    expect(b.keyLock).toBe(false);
    expect(b.casino).toBeNull();
    const v = views(out, "Alice")[0];
    expect(v?.names).toEqual(["Alice", ""]);
    expect(v?.pieces).toEqual(startBoard());
    expect(chat(out, "Alice")).toEqual([]);
    expect(t.tbl().turn).toBe(0);
    const c = t.join("Carol", 11);
    const join = ckSit(t.world, c, t.table);
    expect(chat(join, "Alice")).toEqual([START, START]);
    ckClose(t.world, a);
    ckClose(t.world, c);
    expect(t.world.casinoTables.size).toBe(0);
  });

  test("a dropped connection frees the seat at once", () => {
    const t = scene();
    const { a, b } = t.seated();
    const out = ckDisconnect(t.world, b);
    expect(views(out, "Alice")[0]?.names).toEqual(["Alice", ""]);
    expect(b.casino).toBeNull();
    expect(a.casino).not.toBeNull();
  });

  test("kept bug: the window stays across a map change and play goes on", () => {
    const t = scene();
    const { a, b } = t.seated();
    warp(t.world, a, t.other, 3, 3);
    a.keyLock = false;
    expect(a.casino).toEqual({ key: t.key, side: 1 });
    const out = ckMove(t.world, a, 8, 1, -1);
    expect(views(out, "Bob")[0]?.moved).toEqual({ turn: 2 });
    expect(ckMove(t.world, b, 20, 1, 1).length).toBeGreaterThan(0);
  });
});

describe("the item click", () => {
  test("a click and Ctrl both reach the table, with the click's 40-frame pause first", () => {
    const t = scene();
    const ctx = { world: t.world, rng: t.rng, now: 1_000_000 };
    const a = t.join("Alice", 9);
    const room = t.world.rooms.get(t.map.name) as never;
    a.itemPause = 0;
    pickupIntent(ctx, room, a, t.table.id);
    expect(a.casino).not.toBeNull();
    expect(a.itemPause).toBeGreaterThan(0);
    const b = t.join("Bob", 11);
    b.facing = "W";
    b.itemPause = 0;
    actionIntent(ctx, room, b);
    expect(b.casino).not.toBeNull();
  });
});
