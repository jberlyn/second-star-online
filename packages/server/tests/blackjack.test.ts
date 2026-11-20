/**
 * Sim tests: the Blackjack Table.
 */
import { describe, expect, test } from "bun:test";

import type { ServerMsg } from "@secondstaronline/shared";
import { ADMINISTRATOR } from "@secondstaronline/shared";

import { adminWarp } from "../src/systems/admin/commands.ts";
import { openEditor } from "../src/systems/admin/worldedit.ts";
import {
  bjBid,
  bjHit,
  bjLeave,
  bjSit,
  bjStand,
  savedGold,
  tablePlayers,
} from "../src/systems/casino/blackjack.ts";
import {
  type CasinoDeps,
  casinoLeave,
  casinoReturn,
  casinoTick,
} from "../src/systems/casino/index.ts";
import { slotOpen } from "../src/systems/casino/slots.ts";
import { actionIntent, pickupIntent } from "../src/systems/inventory/items.ts";
import { warp } from "../src/systems/world/tick.ts";
import type { BjTable, GroundItem, Player } from "../src/systems/world/world.ts";
import { player, rngByN, setup, testMap } from "./helpers/sim.ts";

type Out = { to: string; msg: ServerMsg }[];
const chat = (msgs: Out, to: string) =>
  msgs.flatMap((m) => (m.to === to && m.msg.t === "chat" ? [m.msg.text] : []));
const views = (msgs: Out, to: string) =>
  msgs.flatMap((m) => (m.to === to && m.msg.t === "bj" && m.msg.open ? [m.msg] : []));

const STAND = "This is blackjack table, but you must be standing beside it to play!";

/** `cards` are the `random(13)` rolls (1-9 = crd51-crd59, 10-13 = crd60), in deal order. */
function scene(cards: number[] = []) {
  const map = testMap("x1000y992");
  const other = testMap("x1001y992");
  const s = setup([map, other]);
  const rng = rngByN({ 13: cards });
  const table: GroundItem = {
    id: "bj",
    item: "Blackjack Table",
    x: 10,
    y: 5,
    kind: "drop",
    expiresAt: null,
  };
  map.ground.push(table);
  const offline: [string, number][] = [];
  const deps: CasinoDeps = {
    graceTicks: 600,
    addGoldOffline: (id, d) => offline.push([id, d]),
  };
  const join = (name: string, x: number, y = 5): Player => {
    const p = player(name, map, x, y);
    p.char.gold = 100;
    s.join(p);
    return p;
  };
  const sit = (p: Player, g: GroundItem = table) => bjSit(s.world, p, g);
  const key = "x1000y992:10:5";
  const tbl = () => s.world.casinoTables.get(key) as BjTable;
  /** Alice west, Bob east, both bid, the deal done. */
  const dealt = (bidA = 50, bidB = 30) => {
    const a = join("Alice", 9);
    const b = join("Bob", 11);
    sit(a);
    sit(b);
    bjBid(s.world, a, String(bidA), rng);
    const out = bjBid(s.world, b, String(bidB), rng);
    return { a, b, out };
  };
  return { ...s, map, other, table, join, sit, tbl, deps, offline, rng, dealt, key };
}

describe("sitting", () => {
  test("west is Player 1, east Player 2; the newcomer gets 'You take a seat', the sitter 'has joined'", () => {
    const t = scene();
    const a = t.join("Alice", 9);
    const b = t.join("Bob", 11);
    const first = t.sit(a);
    expect(first.flatMap((m) => (m.msg.t === "chat" ? [m.msg.text] : []))).toEqual([]);
    expect(a.casino).toEqual({ key: t.key, side: 1 });
    expect(a.keyLock).toBe(true);
    const out = t.sit(b);
    expect(chat(out, "Alice")).toEqual(["Bob has joined the table!"]);
    expect(chat(out, "Bob")).toEqual(["You take a seat at Alice's table!"]);
    expect(b.casino).toEqual({ key: t.key, side: 2 });
    const v = views(out, "Bob")[0];
    expect(v?.names).toEqual(["Alice", "Bob"]);
    expect(v?.fields).toEqual(["0", "0"]);
    expect(v?.sfx).toEqual(["shuffle"]);
  });

  test("the wrong-spot text shows every time, even after opening a table or slot panel", () => {
    const t = scene();
    const far = t.join("Far", 3);
    expect(chat(t.sit(far), "Far")).toEqual([STAND]);
    expect(chat(t.sit(far), "Far")).toEqual([STAND]);
    const a = t.join("Alice", 9);
    t.sit(a);
    bjLeave(t.world, a, t.deps);
    a.x = 3;
    expect(chat(t.sit(a), "Alice")).toEqual([STAND]);
    const s2 = t.join("Slotter", 5, 6);
    s2.facing = "N";
    t.map.ground.push({
      id: "sm",
      item: "Slot Machine",
      x: 5,
      y: 5,
      kind: "drop",
      expiresAt: null,
    });
    slotOpen(s2, t.map.ground.find((g) => g.id === "sm") as GroundItem);
    s2.slot = null;
    s2.keyLock = false;
    expect(chat(t.sit(s2), "Slotter")).toEqual([STAND]);
  });

  test("divergence: a taken seat, a third player, a longer name, and an open casino screen all refuse", () => {
    const t = scene();
    const a = t.join("Alice", 9);
    const b = t.join("Bob", 11);
    t.sit(a);
    t.sit(b);
    const c = t.join("Carol", 9, 5);
    c.x = 9;
    expect(chat(t.sit(c), "Carol")).toEqual(["That seat is taken."]);
    expect(c.casino).toBeNull();
    const d = t.join("Dan", 11);
    expect(chat(t.sit(d), "Dan")).toEqual(["That seat is taken."]);
    const e = t.join("Eve", 9, 6);
    e.x = 9;
    e.y = 5;
    e.keyLock = true;
    expect(t.sit(e)).toEqual([]);
    const f = t.join("Fay", 9, 4);
    f.slot = { spin: 0 };
    f.y = 5;
    expect(t.sit(f)).toEqual([]);
    const g = t.join("Gus", 9, 7);
    g.x = 9;
    g.y = 5;
    expect(bjSit(t.world, g, { ...t.table, item: "Blackjack Table 2" })).toEqual([]);
  });

  test("joining resets the table and releases a lock in place, hold returned", () => {
    const t = scene();
    const a = t.join("Alice", 9);
    t.sit(a);
    bjBid(t.world, a, "40", t.rng);
    expect(a.char.gold).toBe(60);
    t.sit(t.join("Bob", 11));
    expect(a.char.gold).toBe(100);
    expect(t.tbl().locked).toEqual([null, null]);
  });
});

describe("bids and the deal", () => {
  test("divergence: gold drops at the lock, the excess returns when both lock, four cards P1 P1 P2 P2", () => {
    const t = scene([1, 10, 5, 6]); // A, 10 | 5, 6
    const a = t.join("Alice", 9);
    const b = t.join("Bob", 11);
    t.sit(a);
    t.sit(b);
    const first = bjBid(t.world, a, "50", t.rng);
    expect(a.char.gold).toBe(50);
    expect(chat(first, "Bob")).toEqual(["Alice makes a bid of 50."]);
    const out = bjBid(t.world, b, "30", t.rng);
    expect(a.char.gold).toBe(70);
    expect(b.char.gold).toBe(70);
    expect(chat(out, "Alice")).toEqual([
      "Bob makes a bid of 30.",
      "The bid is set at 30 gold.",
      "You are currently holding 21.",
    ]);
    expect(chat(out, "Bob")).toEqual([
      "Bob makes a bid of 30.",
      "The bid is set at 30 gold.",
      "You are currently holding 11.",
    ]);
    expect(t.tbl().hands).toEqual([
      [51, 60],
      [55, 56],
    ]);
    const av = views(out, "Alice").at(-1);
    expect(av?.hands).toEqual([
      [51, 60],
      [55, "back"],
    ]);
    expect(av?.fields).toEqual(["30", "30"]);
    expect(av?.sfx).toEqual(["deal", "deal", "deal", "deal"]);
    expect(views(out, "Bob").at(-1)?.hands).toEqual([
      [51, "back"],
      [55, 56],
    ]);
  });

  test("bid texts come from the server: max, short gold, negative nothing, a locked side ignores", () => {
    const t = scene();
    const a = t.join("Alice", 9);
    t.sit(a);
    expect(chat(bjBid(t.world, a, "100000", t.rng), "Alice")).toEqual([
      "You can't bid more than 99999!!",
    ]);
    expect(chat(bjBid(t.world, a, "101", t.rng), "Alice")).toEqual([
      "You don't have enough gold to make this bid!",
    ]);
    expect(bjBid(t.world, a, "-5", t.rng)).toEqual([]);
    expect(a.char.gold).toBe(100);
    bjBid(t.world, a, "10", t.rng);
    expect(bjBid(t.world, a, "20", t.rng)).toEqual([]);
    expect(a.char.gold).toBe(90);
  });
});

describe("play and settlement", () => {
  test("Hit and Stand gates; a fifth card stands you at once", () => {
    // P1: 2, 2 (4); P2: 10, 10 (20); then P1 hits 2, 2, 2 -> 5 cards of 2 = 10
    const t = scene([2, 2, 10, 10, 2, 2, 2, 2]);
    const a = t.join("Alice", 9);
    const b = t.join("Bob", 11);
    expect(bjHit(t.world, a, t.rng)).toEqual([]); // not seated
    t.sit(a);
    t.sit(b);
    expect(bjHit(t.world, a, t.rng)).toEqual([]); // no cards yet
    bjBid(t.world, a, "10", t.rng);
    bjBid(t.world, b, "10", t.rng);
    let lastHit: Out = [];
    for (let i = 0; i < 3; i += 1) {
      lastHit = bjHit(t.world, a, t.rng);
    }
    expect(t.tbl().hands[0]).toHaveLength(5);
    expect(t.tbl().holds).toEqual([true, false]);
    expect(chat(lastHit, "Bob")).toEqual(["Alice holds."]);
    expect(bjHit(t.world, a, t.rng)).toEqual([]);
    expect(bjStand(t.world, a)).toEqual([]); // already holding
  });

  test("a bust stands you at once", () => {
    const t = scene([10, 10, 1, 1, 10]); // P1 10+10=20, P2 A+A=13; P1 hits 10 -> 30
    const { a, b } = t.dealt(10, 10);
    const out = bjHit(t.world, a, t.rng);
    expect(chat(out, "Alice")).toEqual(["You are currently holding 30.", "Alice holds."]);
    expect(t.tbl().holds).toEqual([true, false]);
    const end = bjStand(t.world, b);
    expect(chat(end, "Alice")).toContain("Bob has won the game!!!");
  });

  test("both bust, different totals: single draw line and refund", () => {
    // P1: 10, 10 + hit 10 = 30; P2: 10, 10 + hit 9 = 29.
    const t = scene([10, 10, 10, 10, 10, 9]);
    const { a, b } = t.dealt(30, 50);
    const lines = chat([...bjHit(t.world, a, t.rng), ...bjHit(t.world, b, t.rng)], "Alice");
    expect(lines.filter((l) => l === "The game is a draw!!!")).toHaveLength(1);
    expect(lines.some((l) => l.endsWith("has won the game!!!"))).toBe(false);
    expect(a.char.gold).toBe(100);
    expect(b.char.gold).toBe(100);
  });

  test("equal busts print the draw line once and refund; an equal non-bust hand once", () => {
    const t = scene([10, 10, 10, 10, 10, 10]);
    const { a, b } = t.dealt(20, 20);
    const lines = chat([...bjHit(t.world, a, t.rng), ...bjHit(t.world, b, t.rng)], "Alice");
    expect(lines.filter((l) => l === "The game is a draw!!!")).toHaveLength(1);
    expect(lines.some((l) => l.endsWith("has won the game!!!"))).toBe(false);
    expect(a.char.gold).toBe(100);
    expect(b.char.gold).toBe(100);
    const u = scene([10, 8, 10, 8]);
    const d = u.dealt(5, 5);
    const l2 = chat([...bjStand(u.world, d.a), ...bjStand(u.world, d.b)], "Alice");
    expect(l2.filter((l) => l === "The game is a draw!!!")).toHaveLength(1);
    expect(d.a.char.gold).toBe(100);
  });

  test("the winner takes the stake and both hands show; the table resets after exactly 40 ticks with the fields kept", () => {
    const t = scene([10, 9, 10, 8]); // 19 v 18
    const { a, b } = t.dealt(50, 30);
    bjStand(t.world, a);
    const out = bjStand(t.world, b);
    expect(a.char.gold).toBe(70 + 60);
    expect(b.char.gold).toBe(70);
    const v = views(out, "Alice").at(-1);
    expect(v?.hands).toEqual([
      [60, 59],
      [60, 58],
    ]);
    expect(v?.sfx).toEqual(["cash"]);
    for (let i = 0; i < 39; i += 1) {
      expect(casinoTick(t.world, t.deps)).toEqual([]);
    }
    const reset = casinoTick(t.world, t.deps);
    expect(views(reset, "Alice")[0]?.hands).toEqual([[], []]);
    expect(views(reset, "Alice")[0]?.sfx).toEqual(["shuffle"]);
    expect(views(reset, "Alice")[0]?.fields).toEqual(["30", "30"]);
    expect(t.tbl().phase).toBe("bids");
    expect(bjBid(t.world, a, "5", t.rng).length).toBeGreaterThan(0);
  });
});

describe("leaving", () => {
  test("before the deal your hold goes back, the stayer is told and the table resets", () => {
    const t = scene();
    const a = t.join("Alice", 9);
    const b = t.join("Bob", 11);
    t.sit(a);
    t.sit(b);
    bjBid(t.world, a, "40", t.rng);
    const out = bjLeave(t.world, b, t.deps);
    expect(chat(out, "Alice")).toEqual(["Bob has left the table!"]);
    expect(out.some((m) => m.to === "Bob" && m.msg.t === "bj" && !m.msg.open)).toBe(true);
    expect(b.keyLock).toBe(false);
    expect(b.casino).toBeNull();
    expect(a.char.gold).toBe(100);
    expect(t.tbl().locked).toEqual([null, null]);
    bjLeave(t.world, a, t.deps);
    expect(t.world.casinoTables.size).toBe(0);
  });

  test("divergence: mid-hand Leave forfeits the stake to the opponent", () => {
    const t = scene([10, 9, 10, 8]);
    const { a, b } = t.dealt(50, 30);
    const out = bjLeave(t.world, b, t.deps);
    expect(chat(out, "Alice")).toEqual(["Bob has left the table!"]);
    expect(a.char.gold).toBe(70 + 60);
    expect(b.char.gold).toBe(70);
    expect(t.tbl().seats).toEqual([{ id: "Alice", name: "Alice", awayIn: 0 }, null]);
    expect(t.tbl().phase).toBe("bids");
  });

  test("during the show Leave moves nothing", () => {
    const t = scene([10, 9, 10, 8]);
    const { a, b } = t.dealt(50, 30);
    bjStand(t.world, a);
    bjStand(t.world, b);
    const before = [a.char.gold, b.char.gold];
    bjLeave(t.world, b, t.deps);
    expect([a.char.gold, b.char.gold]).toEqual(before);
  });

  test("a map change leaves the blackjack seat, closes the window, and forfeits a mid-hand stake", () => {
    const t = scene([10, 9, 10, 8]);
    const { a, b } = t.dealt(50, 30);
    const wOut = warp(t.world, a, t.other, 3, 3, t.deps);
    expect(wOut.some((m) => m.to === "Alice" && m.msg.t === "bj" && !m.msg.open)).toBe(true);
    expect(chat(wOut, "Bob")).toEqual(["Alice has left the table!"]);
    expect(a.casino).toBeNull();
    expect(b.char.gold).toBe(70 + 60);
    expect(bjStand(t.world, a)).toEqual([]);
  });

  test("a five-card hand stands automatically and cannot hit again", () => {
    const t = scene([2, 2, 10, 10, 2, 2, 2]);
    const { a } = t.dealt(1, 1);
    for (let i = 0; i < 3; i += 1) {
      bjHit(t.world, a, t.rng);
    }
    expect(t.tbl().holds[0]).toBe(true);
    const calls = t.rng.calls.length;
    expect(bjHit(t.world, a, t.rng)).toEqual([]);
    expect(t.rng.calls.length).toBe(calls);
    expect(a.casino).not.toBeNull();
  });
});

describe("a dropped connection", () => {
  test("mid-hand the seat waits; the opponent's stand prints but settlement waits; a return reopens the table as it was", () => {
    const t = scene([10, 9, 10, 8]);
    const { a, b } = t.dealt(50, 30);
    const mates = tablePlayers(t.world, b);
    expect(mates).toHaveLength(2);
    expect(casinoLeave(t.world, b, t.deps)).toEqual([]);
    expect(t.tbl().seats[1]?.awayIn).toBe(600);
    expect(savedGold(t.world, b)).toBe(100); // 70 live + the 30 held
    t.world.players.delete("Bob");
    const stand = bjStand(t.world, a);
    expect(chat(stand, "Alice")).toEqual(["Alice holds."]);
    expect(a.char.gold).toBe(70);
    // Bob comes back with a freshly loaded purse (saved gold) and a new Player.
    const b2 = player("Bob", t.map, 11, 5);
    b2.char.gold = 100;
    t.join("Bob", 11);
    t.world.players.delete("Bob");
    t.world.players.set("Bob", b2);
    const back = casinoReturn(t.world, b2);
    expect(b2.casino).toEqual({ key: t.key, side: 2 });
    expect(b2.keyLock).toBe(true);
    expect(b2.char.gold).toBe(70);
    expect(chat(back, "Bob")).toEqual([]);
    expect(views(back, "Bob")[0]?.hands).toEqual([
      [60, "back"],
      [60, 58],
    ]);
    // Now Bob stands: the held hand settles.
    bjStand(t.world, b2);
    expect(a.char.gold).toBe(70 + 60);
  });

  test("divergence: past the grace the stake is forfeit: the opponent gains, the dropped player's saved row loses the hold", () => {
    const t = scene([10, 9, 10, 8]);
    const { a, b } = t.dealt(50, 30);
    casinoLeave(t.world, b, { ...t.deps, graceTicks: 3 });
    t.world.players.delete("Bob");
    expect(casinoTick(t.world, t.deps)).toEqual([]);
    const tbl = t.tbl();
    tbl.seats[1] = tbl.seats[1] && { ...tbl.seats[1], awayIn: 2 };
    casinoTick(t.world, t.deps);
    const out = casinoTick(t.world, t.deps);
    expect(chat(out, "Alice")).toEqual(["Bob has left the table!"]);
    expect(a.char.gold).toBe(70 + 60);
    expect(t.offline).toEqual([["Bob", -30]]);
    expect(t.tbl().seats[1]).toBeNull();
    expect(t.tbl().phase).toBe("bids");
  });

  test("before the deal a disconnect frees the seat at once with the left line and the hold back", () => {
    const t = scene();
    const a = t.join("Alice", 9);
    const b = t.join("Bob", 11);
    t.sit(a);
    t.sit(b);
    bjBid(t.world, b, "25", t.rng);
    const out = casinoLeave(t.world, b, t.deps);
    expect(chat(out, "Alice")).toEqual(["Bob has left the table!"]);
    expect(b.char.gold).toBe(100);
    expect(savedGold(t.world, b)).toBe(100);
    expect(t.tbl().seats[1]).toBeNull();
  });

  test("crash safety: a save mid-hand writes gold plus the held stake", () => {
    const t = scene([10, 9, 10, 8]);
    const { a, b } = t.dealt(50, 30);
    expect(a.char.gold).toBe(70);
    expect(savedGold(t.world, a)).toBe(100);
    expect(savedGold(t.world, b)).toBe(100);
  });

  test("adminWarp mid-hand while opponent is in reconnect grace credits addGoldOffline and clears table", () => {
    const t = scene([10, 9, 10, 8]);
    const { a, b } = t.dealt(50, 30);
    casinoLeave(t.world, b, t.deps);
    t.world.players.delete("Bob");
    const out = adminWarp(t.world, a, t.other.name, 3, 3, {
      loadMap: (n) => (n === t.other.name ? t.other : t.map),
      casino: t.deps,
    });
    expect(out.some((m) => m.to === "Alice" && m.msg.t === "bj" && !m.msg.open)).toBe(true);
    expect(a.casino).toBeNull();
    expect(a.invDirty).toBe(true);
    expect(t.offline).toEqual([["Bob", 30]]);
    expect(t.world.casinoTables.size).toBe(0);
  });

  test("openEditor mid-hand while opponent is in reconnect grace credits addGoldOffline and clears table", () => {
    const t = scene([10, 9, 10, 8]);
    const { a, b } = t.dealt(50, 30);
    a.role = ADMINISTRATOR;
    casinoLeave(t.world, b, t.deps);
    t.world.players.delete("Bob");
    const out = openEditor(
      t.world,
      a,
      (n) => (n === t.map.name ? t.map : null),
      { mx: 1000, my: 992 },
      t.deps,
    );
    expect(out.some((m) => m.to === "Alice" && m.msg.t === "bj" && !m.msg.open)).toBe(true);
    expect(a.casino).toBeNull();
    expect(a.editing).toBe("world");
    expect(a.invDirty).toBe(true);
    expect(t.offline).toEqual([["Bob", 30]]);
    expect(t.world.casinoTables.size).toBe(0);
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
