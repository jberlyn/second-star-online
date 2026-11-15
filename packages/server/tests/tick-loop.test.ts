import { describe, expect, test } from "bun:test";

import { TICK_MS } from "@secondstaronline/shared";

import { TickLoop } from "../src/tick-loop.ts";
import { manualClock } from "./helpers/manual-clock.ts";

function loopWithLog(maxCatchUpTicks?: number) {
  const clock = manualClock();
  const ticks: number[] = [];
  const loop = new TickLoop({ clock, onTick: (t) => ticks.push(t), maxCatchUpTicks });
  return { clock, ticks, loop };
}

describe("tick loop", () => {
  test("a tick is 50 ms", () => {
    expect(TICK_MS).toBe(50);
  });

  test("step() runs one tick per 50 ms and carries the remainder", () => {
    const { loop, ticks } = loopWithLog();
    expect(loop.step(120)).toBe(2);
    expect(loop.step(30)).toBe(1); // 20 left over + 30
    expect(ticks).toEqual([1, 2, 3]);
    expect(loop.tick).toBe(3);
  });

  test("poll() follows the clock", () => {
    const { loop, clock, ticks } = loopWithLog();
    loop.start();
    clock.advance(49);
    expect(loop.poll()).toBe(0);
    clock.advance(1);
    expect(loop.poll()).toBe(1);
    clock.advance(0);
    expect(loop.poll()).toBe(0);
    loop.stop();
    expect(ticks).toEqual([1]);
  });

  test("after a stall it catches up at most maxCatchUpTicks and drops the rest", () => {
    const { loop, clock } = loopWithLog(10);
    loop.start();
    clock.advance(2000); // 40 frames late
    expect(loop.poll()).toBe(10);
    clock.advance(50);
    expect(loop.poll()).toBe(1);
    loop.stop();
  });

  test("start/stop are idempotent", () => {
    const { loop } = loopWithLog();
    loop.start();
    loop.start();
    expect(loop.running).toBe(true);
    loop.stop();
    loop.stop();
    expect(loop.running).toBe(false);
  });

  test("a 2 s stall runs 10 ticks and drops 30 (maxCatchUpTicks 10)", () => {
    const dropped: number[] = [];
    const clock = manualClock();
    const loop = new TickLoop({
      clock,
      onTick: () => {},
      maxCatchUpTicks: 10,
      onDropped: (n) => dropped.push(n),
    });
    loop.start();
    clock.advance(2000);
    expect(loop.poll()).toBe(10);
    expect(loop.droppedTicks).toBe(30);
    expect(dropped).toEqual([30]);
    expect(loop.takeLateness()).toBe(1950);
    expect(loop.takeLateness()).toBe(0);
  });

  test("nothing is dropped when polled on time or within the catch-up window", () => {
    const { loop, clock } = loopWithLog(10);
    loop.start();
    for (let i = 0; i < 20; i++) {
      clock.advance(50);
      loop.poll();
    }
    clock.advance(500); // exactly the window: 10 ticks owed, all run
    expect(loop.poll()).toBe(10);
    expect(loop.droppedTicks).toBe(0);
  });

  test("step() never drops", () => {
    const { loop } = loopWithLog(10);
    expect(loop.step(5000)).toBe(100);
    expect(loop.droppedTicks).toBe(0);
  });
});
