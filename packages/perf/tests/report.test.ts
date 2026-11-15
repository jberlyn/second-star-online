import { describe, expect, test } from "bun:test";

import type { BotsLine } from "../src/bots.ts";
import { reportMarkdown, type ServerLine, summarize, targetsOf } from "../src/report.ts";

const serverLine = (t: number, total: number[], extra: Partial<ServerLine> = {}): ServerLine => ({
  t,
  online: 10,
  tick: { ticks: total.length, dropped: 0 },
  raw: { total, phases: { rooms: total.map((x) => x / 2), deliver: total.map((x) => x / 4) } },
  maxLateMs: 3,
  dropped: 0,
  gateway: {
    messagesOut: 200,
    bytesOut: 20480,
    messagesIn: 50,
    bytesIn: 2000,
    maxBacklog: 2048,
    closedBehind: 0,
    encodeMs: 40,
    sendMs: 160,
    online: 10,
  },
  rss: 100 * 1024 * 1024,
  heapUsed: 0,
  dbBytes: 0,
  walBytes: 0,
  rowsWritten: 4,
  ...extra,
});
const botLine = (t: number, extra: Partial<BotsLine> = {}): BotsLine => ({
  t,
  bots: 10,
  online: 10,
  messagesIn: 0,
  bytesIn: 0,
  messagesOut: 0,
  snapsPredicting: 0,
  snapsServer: 0,
  snapsTimeout: 0,
  walkTicks: 600,
  delays: [100, 200],
  closes: {},
  logins: 0,
  denied: 0,
  deaths: 0,
  actions: {},
  ...extra,
});

describe("perf report", () => {
  const server = [
    serverLine(1000, [1, 2, 3, 4]),
    serverLine(2000, [1, 2, 3, 100], { dropped: 2 }),
    serverLine(3000, [1, 2, 3, 4], { dropped: 2 }),
  ];
  const bots = [botLine(2000, { snapsPredicting: 1 }), botLine(3000, { closes: { "4007": 1 } })];

  test("pools ticks after the ramp and reads traffic per player", () => {
    const s = summarize("town", "home", server, bots, 2000);
    expect(s.seconds).toBe(2);
    expect(s.tick).toEqual({ p50: 2, p99: 100, max: 100 });
    expect(s.phases.rooms).toEqual({ p50: 1, p99: 50, max: 50 });
    expect(s.dropped).toBe(2); // 0 before the ramp ended, 2 on the last line
  });

  test("traffic and snaps", () => {
    const s = summarize("town", "p150", server, bots, 1000);
    expect(s.dropped).toBe(2);
    expect(s.messagesPerPlayerSec).toBe(20);
    expect(s.kbPerPlayerSec).toBe(2);
    expect(s.totalKbPerSec).toBe(20);
    expect(s.maxBacklogKb).toBe(2);
    expect(s.rssMb).toBe(100);
    expect(s.rowsPerSec).toBe(4);
    expect([s.encodeMsPerSec, s.sendMsPerSec]).toEqual([40, 160]);
    // 1200 walk ticks = 1 minute; 1 snap while predicting.
    expect(s.snapsPredictingPerMin).toBe(1);
    expect(s.closes).toEqual({ "4007": 1 });
    expect(s.delayMs).toEqual({ p50: 100, p99: 200 });
  });

  test("targets mark a slow tick and a dropped tick as missed", () => {
    const s = summarize("world200", "p150", server, bots, 1000);
    const t = targetsOf(s);
    expect(t.find((x) => x.name === "tick p99 < 25 ms")?.ok).toBe(false);
    expect(t.find((x) => x.name === "no dropped ticks")?.ok).toBe(false);
    expect(t.find((x) => x.name.startsWith("snaps while predicting"))?.ok).toBe(false);
  });

  test("the markdown names the host, the table and the missed targets", () => {
    const s = summarize("world200", "p150", server, bots, 1000);
    const md = reportMarkdown("Host: test", [s]);
    expect(md).toContain("Host: test");
    expect(md).toContain("| world200 | p150 |");
    expect(md).toContain("**MISSED**");
  });
});
