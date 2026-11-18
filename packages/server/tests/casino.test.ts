/**
 * Sim tests: the Slot Machine.
 */
import { describe, expect, test } from "bun:test";

import type { ServerMsg } from "@secondstaronline/shared";

import { slotClose, slotPull } from "../src/systems/casino/slots.ts";
import { actionIntent, type ItemCtx, pickupIntent } from "../src/systems/inventory/items.ts";
import { tick, warp } from "../src/systems/world/tick.ts";
import type { GroundItem, Player, Room } from "../src/systems/world/world.ts";
import { NO_CASINO, player, rngByN, setup, testMap } from "./helpers/sim.ts";

type Out = { to: string; msg: ServerMsg }[];
const chat = (msgs: Out, to: string) =>
  msgs.flatMap((m) => (m.to === to && m.msg.t === "chat" ? [m.msg.text] : []));
const ofType = (msgs: Out, t: ServerMsg["t"]) =>
  msgs.filter((m) => m.msg.t === t).map((m) => m.msg);

const STAND = "This is a slot machine. You need to be standing in front of it to play.";

function scene(reels: number[] = [1, 2, 3]) {
  const map = testMap("x1000y992");
  const other = testMap("x1001y992");
  const s = setup([map, other]);
  const rng = rngByN({ 4: reels });
  const machine: GroundItem = {
    id: "sm",
    item: "Slot Machine",
    x: 5,
    y: 5,
    kind: "drop",
    expiresAt: null,
  };
  map.ground.push(machine);
  const join = (name: string, x = 5, y = 6, facing: Player["facing"] = "N"): Player => {
    const p = player(name, map, x, y);
    p.facing = facing;
    p.char.gold = 100;
    s.join(p);
    return p;
  };
  const room = (): Room => s.world.rooms.get(map.name) as Room;
  const ctx = (): ItemCtx => ({ world: s.world, rng, now: 1_000_000 });
  const deps = {
    loadMap: (n: string) => (n === other.name ? other : map),
    casino: NO_CASINO,
    saveIntervalTicks: 600,
    rng,
  };
  const run = (n: number) => {
    const all: Out = [];
    for (let i = 0; i < n; i += 1) {
      all.push(...tick(s.world, deps).out);
    }
    return all;
  };
  const click = (p: Player, id = "sm") => {
    p.itemPause = 0;
    return pickupIntent(ctx(), room(), p, id);
  };
  return { ...s, map, other, join, room, ctx, click, run, deps, rng };
}

describe("opening the panel", () => {
  test("south of the machine, facing N: the panel opens and the keys lock", () => {
    const t = scene();
    const a = t.join("Alice");
    const out = t.click(a);
    expect(ofType(out, "slot")).toEqual([{ t: "slot", open: true }]);
    expect(a.slot).toEqual({ spin: 0 });
    expect(a.keyLock).toBe(true);
  });

  test("each refusal prints the stand text: wrong facing, wrong tile, mid-step", () => {
    const t = scene();
    for (const [x, y, facing, steps] of [
      [5, 6, "E", 0],
      [6, 6, "N", 0],
      [5, 7, "N", 0],
      [5, 6, "N", 4],
    ] as const) {
      const a = t.join(`P${x}${y}${facing}${steps}`, x, y, facing);
      a.stepFrames = steps;
      expect(chat(t.click(a), a.id)).toEqual([STAND]);
      expect(a.slot).toBeNull();
      expect(a.keyLock).toBe(false);
    }
  });

  test("any item containing 'Slot Machine' opens and plays, including 'Slot Machine 2'", () => {
    const t = scene();
    t.map.ground.push({
      id: "sm2",
      item: "Slot Machine 2",
      x: 8,
      y: 5,
      kind: "drop",
      expiresAt: null,
    });
    const a = t.join("Alice", 8, 6, "N");
    expect(ofType(t.click(a, "sm2"), "slot")).toEqual([{ t: "slot", open: true }]);
    expect(a.slot).toEqual({ spin: 0 });
  });

  test("a second click or Ctrl with the panel open does nothing", () => {
    const t = scene();
    const a = t.join("Alice");
    t.click(a);
    a.keyLock = false; // as a map change frees the keys
    expect(t.click(a)).toEqual([]);
    a.itemPause = 0;
    expect(actionIntent(t.ctx(), t.room(), a)).toEqual([]);
    expect(a.slot).toEqual({ spin: 0 });
  });

  test("Ctrl on the faced machine opens it", () => {
    const t = scene();
    const a = t.join("Alice");
    expect(ofType(actionIntent(t.ctx(), t.room(), a), "slot")).toEqual([{ t: "slot", open: true }]);
  });
});

describe("pulling", () => {
  test("the FX is queued at the player; the result comes 30 ticks later, not 29", () => {
    const t = scene([2, 3, 2]);
    const a = t.join("Alice");
    t.click(a);
    const out = slotPull(t.room(), a);
    expect(out).toEqual([{ to: "Alice", msg: { t: "slotSpin" } }]);
    expect(t.room().fxQueue).toHaveLength(1);
    expect(t.room().fxQueue[0]).toMatchObject({ name: "Slot Machine", owner: "Alice" });
    const before = a.char.gold;
    const early = t.run(29);
    expect(ofType(early, "slotResult")).toEqual([]);
    expect(a.char.gold).toBe(before);
    const result = t.run(1);
    expect(ofType(result, "slotResult")).toEqual([
      { t: "slotResult", reels: [2, 3, 2], win: true },
    ]);
    expect(chat(result, "Alice")).toEqual(["You won!!!!"]);
    expect(a.char.gold).toBe(100 - 5 + 50);
    // One gold change per pull: the inventory goes out once, with the gold.
    expect(ofType(result, "inv")).toHaveLength(1);
    expect(a.slot).toEqual({ spin: 0 });
  });

  test("a loss takes 5 and prints the lose line", () => {
    const t = scene([1, 2, 3]);
    const a = t.join("Alice");
    t.click(a);
    slotPull(t.room(), a);
    const out = t.run(30);
    expect(chat(out, "Alice")).toEqual(["You lost. try again?"]);
    expect(a.char.gold).toBe(95);
  });

  test("a second pull mid-spin and a pull with the panel closed are ignored", () => {
    const t = scene();
    const a = t.join("Alice");
    expect(slotPull(t.room(), a)).toEqual([]);
    expect(t.room().fxQueue).toHaveLength(0);
    t.click(a);
    slotPull(t.room(), a);
    expect(slotPull(t.room(), a)).toEqual([]);
    expect(t.room().fxQueue).toHaveLength(1);
    t.run(30);
    expect(a.char.gold).toBe(95);
  });

  test("a short slot pull returns the lever and prints the gold line without closing the panel", () => {
    const t = scene();
    const a = t.join("Alice");
    a.char.gold = 3;
    t.click(a);
    const out = slotPull(t.room(), a);
    expect(out.map((m) => m.msg.t)).toEqual(["slotResult", "chat"]);
    expect(ofType(out, "slotResult")).toEqual([{ t: "slotResult", reels: null, win: false }]);
    expect(chat(out, "Alice")).toEqual(["You don't have enough gold to play!"]);
    expect(a.slot).toEqual({ spin: 0 });
    expect(a.keyLock).toBe(true);
    expect(t.room().fxQueue).toHaveLength(0);
    expect(a.char.gold).toBe(3);
  });

  test("Close mid-spin is ignored; Close idle frees the keys", () => {
    const t = scene();
    const a = t.join("Alice");
    t.click(a);
    slotPull(t.room(), a);
    slotClose(a);
    expect(a.slot).not.toBeNull();
    expect(a.keyLock).toBe(true);
    t.run(30);
    slotClose(a);
    expect(a.slot).toBeNull();
    expect(a.keyLock).toBe(false);
  });

  test("gold gone during the spin charges nothing, prints the line, reels null", () => {
    const t = scene([2, 3, 2]);
    const a = t.join("Alice");
    t.click(a);
    slotPull(t.room(), a);
    a.char.gold = 2;
    const out = t.run(30);
    expect(ofType(out, "slotResult")).toEqual([{ t: "slotResult", reels: null, win: false }]);
    expect(chat(out, "Alice")).toEqual(["You don't have enough gold to play!"]);
    expect(a.char.gold).toBe(2);
    expect(a.slot).toEqual({ spin: 0 });
  });

  test("the slot panel closes on a map change and a pull away from a machine closes it", () => {
    const t = scene([1, 1, 1]);
    const a = t.join("Alice");
    t.click(a);
    const wOut = warp(t.world, a, t.other, 3, 3, NO_CASINO);
    expect(ofType(wOut, "slot")).toEqual([{ t: "slot", open: false }]);
    expect(a.slot).toBeNull();
    expect(a.keyLock).toBe(false);
    const room = t.world.rooms.get(t.other.name) as Room;
    expect(slotPull(room, a)).toEqual([]);
    expect(room.fxQueue).toHaveLength(0);
    // Moving away from the machine on the same map also closes the panel on pull.
    const b = t.join("Bob");
    t.click(b);
    b.x = 1;
    expect(ofType(slotPull(t.room(), b), "slot")).toEqual([{ t: "slot", open: false }]);
    expect(b.slot).toBeNull();
    expect(b.keyLock).toBe(false);
  });

  test("Slot Machine 2 opens and settles via slotPull", () => {
    const t = scene([4, 4, 4]);
    t.map.ground[0] = {
      id: "sm",
      item: "Slot Machine 2",
      x: 5,
      y: 5,
      kind: "drop",
      expiresAt: null,
    };
    const a = t.join("Alice");
    t.click(a);
    expect(a.slot).toEqual({ spin: 0 });
    expect(ofType(slotPull(t.room(), a), "slotSpin")).toHaveLength(1);
    const out = t.run(30);
    expect(ofType(out, "slotResult")).toEqual([{ t: "slotResult", reels: [4, 4, 4], win: true }]);
    expect(a.char.gold).toBe(100 - 5 + 80);
  });
});
