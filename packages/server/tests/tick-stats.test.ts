import { describe, expect, test } from "bun:test";

import { createTickProbe, createTickStats, lagLine, percentile } from "../src/tick-stats.ts";

describe("tick stats", () => {
  test("percentile is the nearest rank", () => {
    const v = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(v, 0.5)).toBe(50);
    expect(percentile(v, 0.99)).toBe(99);
    expect(percentile(v, 1)).toBe(100);
    expect(percentile([], 0.99)).toBe(0);
  });

  test("the probe closes each span under the phase that ends it; the rest is commit", () => {
    let t = 0;
    const seen: { total: number; phases: Record<string, number | undefined> }[] = [];
    const probe = createTickProbe(
      () => t,
      (total, phases) => seen.push({ total, phases: { ...phases } }),
    );
    probe.begin();
    t = 2;
    probe.phase("rooms");
    t = 3;
    probe.phase("world");
    t = 7;
    probe.phase("players");
    t = 12;
    probe.phase("deliver");
    t = 13;
    probe.phase("sql");
    t = 15;
    probe.end();
    expect(seen).toHaveLength(1);
    expect(seen[0]?.total).toBe(15);
    expect(seen[0]?.phases).toEqual({
      rooms: 2,
      world: 1,
      players: 4,
      deliver: 5,
      sql: 1,
      commit: 2,
    });
    const sum = Object.values(seen[0]?.phases ?? {}).reduce((a, b) => (a ?? 0) + (b ?? 0), 0);
    expect(sum).toBe(15);
  });

  test("a window keeps p50, p99 and worst, per phase, and resets", () => {
    const stats = createTickStats();
    for (let i = 1; i <= 100; i++) {
      stats.record(i, { rooms: i / 2 });
    }
    stats.addDropped(3);
    const w = stats.window();
    expect(w.ticks).toBe(100);
    expect(w.dropped).toBe(3);
    expect(w.total).toEqual({ p50: 50, p99: 99, max: 100 });
    expect(w.phases.rooms).toEqual({ p50: 25, p99: 49.5, max: 50 });
    expect(w.phases.sql).toEqual({ p50: 0, p99: 0, max: 0 });
    stats.reset();
    expect(stats.window().ticks).toBe(0);
    expect(stats.window().dropped).toBe(0);
  });

  test("the lag line prints for a 30 ms tick or a dropped tick, and not for a clean minute", () => {
    const clean = createTickStats();
    for (let i = 0; i < 1200; i++) {
      clean.record(4);
    }
    expect(lagLine(clean.window(), 87)).toBeNull();

    const slow = createTickStats();
    for (let i = 0; i < 1199; i++) {
      slow.record(4);
    }
    slow.record(31.2);
    slow.addDropped(3);
    expect(lagLine(slow.window(), 87)).toBe(
      "tick lag in the last minute: p99 4.0 ms, worst 31.2 ms, 3 ticks dropped, 87 online",
    );

    const justSlow = createTickStats();
    justSlow.record(26);
    expect(lagLine(justSlow.window(), 1)).toContain("worst 26.0 ms, 0 ticks dropped, 1 online");
    const dropOnly = createTickStats();
    dropOnly.record(1);
    dropOnly.addDropped(1);
    expect(lagLine(dropOnly.window(), 1)).not.toBeNull();
  });
});
