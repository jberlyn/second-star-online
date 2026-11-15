/**
 * The perf rig's server-side output: once a second, one JSON line with the last second's tick
 * timing by phase, the gateway's traffic, memory and the database's growth. Only written when
 * `SSO_PERF_OUT` is set; the rig reads it. Never read by the game.
 */
import { appendFileSync } from "node:fs";

import type { GatewayStats } from "./gateway/server.ts";
import type { Db } from "./persistence/database.ts";
import type { TickStats, TickWindow } from "./tick-stats.ts";

export interface PerfSources {
  path: string;
  db: Db;
  /** The database file, or null for `:memory:`. */
  dbPath: string | null;
  stats: TickStats;
  traffic(): GatewayStats;
  dropped(): number;
  /** Worst timer lateness since the last read. */
  lateness(): number;
  now(): number;
}

export interface PerfLine {
  t: number;
  online: number;
  tick: TickWindow;
  /** Every tick's time this second, total and by phase, for pooling into percentiles. */
  raw: ReturnType<TickStats["raw"]>;
  maxLateMs: number;
  dropped: number;
  gateway: GatewayStats;
  /** CPU time the process used this second (ms): user + system. */
  cpuMs: number;
  rss: number;
  heapUsed: number;
  dbBytes: number;
  walBytes: number;
  rowsWritten: number;
}

function fileSize(path: string): number {
  const f = Bun.file(path);
  return f.size;
}

/** Returns the function to call once a second. */
export function createPerfWriter(src: PerfSources): () => PerfLine {
  let lastChanges = 0;
  let lastDropped = 0;
  let lastCpu = process.cpuUsage();
  const changes = (): number =>
    Number((src.db.query("SELECT total_changes() AS n").get() as { n: number }).n);
  lastChanges = changes();
  return () => {
    const total = changes();
    const droppedTotal = src.dropped();
    const window = src.stats.window();
    const raw = src.stats.raw();
    src.stats.reset();
    const gateway = src.traffic();
    const mem = process.memoryUsage();
    const cpu = process.cpuUsage(lastCpu);
    lastCpu = process.cpuUsage();
    const line: PerfLine = {
      t: src.now(),
      online: gateway.online,
      tick: { ...window, dropped: droppedTotal - lastDropped },
      raw,
      maxLateMs: src.lateness(),
      dropped: droppedTotal,
      gateway,
      cpuMs: Math.round((cpu.user + cpu.system) / 1000),
      rss: mem.rss,
      heapUsed: mem.heapUsed,
      dbBytes: src.dbPath ? fileSize(src.dbPath) : 0,
      walBytes: src.dbPath ? fileSize(`${src.dbPath}-wal`) : 0,
      rowsWritten: total - lastChanges,
    };
    lastChanges = total;
    lastDropped = droppedTotal;
    appendFileSync(src.path, `${JSON.stringify(line)}\n`);
    return line;
  };
}
