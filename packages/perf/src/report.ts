/**
 * Turns a run's JSON lines (the server's `SSO_PERF_OUT` and the bot processes') into the
 * summary table and the targets. Pure: fixed lines give a fixed
 * report, so it is tested without running anything.
 */
import type { BotsLine } from "./bots.ts";

export interface ServerLine {
  t: number;
  online: number;
  tick: { ticks: number; dropped: number };
  raw: { total: number[]; phases: Record<string, number[]> };
  maxLateMs: number;
  dropped: number;
  gateway: {
    messagesOut: number;
    bytesOut: number;
    messagesIn: number;
    bytesIn: number;
    maxBacklog: number;
    closedBehind: number;
    encodeMs?: number;
    sendMs?: number;
    online: number;
  };
  cpuMs?: number;
  rss: number;
  heapUsed: number;
  dbBytes: number;
  walBytes: number;
  rowsWritten: number;
}

export interface Spread {
  p50: number;
  p99: number;
  max: number;
}

export interface Summary {
  scenario: string;
  profile: string;
  seconds: number;
  online: number;
  tick: Spread;
  phases: Record<string, Spread>;
  dropped: number;
  maxLateMs: number;
  messagesPerPlayerSec: number;
  kbPerPlayerSec: number;
  totalKbPerSec: number;
  maxBacklogKb: number;
  /** Share of the measured time spent encoding and sending (ms per second). */
  encodeMsPerSec: number;
  sendMsPerSec: number;
  closedBehind: number;
  /** The server's CPU use, as a share of one core (0-100). */
  cpuPercent: number;
  rssMb: number;
  rowsPerSec: number;
  snapsPredictingPerMin: number;
  snapsServerPerMin: number;
  snapsTimeoutPerMin: number;
  delayMs: { p50: number; p99: number };
  closes: Record<string, number>;
  denied: number;
  deaths: number;
  /** What the bots did and saw, summed over the measured time. */
  actions: Record<string, number>;
}

export type Target = { name: string; ok: boolean; value: string };

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))] ?? 0;
}
function spread(values: number[]): Spread {
  const s = [...values].sort((a, b) => a - b);
  return { p50: pct(s, 0.5), p99: pct(s, 0.99), max: s[s.length - 1] ?? 0 };
}
const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Summarises the measured part of a run: every server line from `fromT` on (after the ramp),
 * and the bot lines over the same time.
 */
export function summarize(
  scenario: string,
  profile: string,
  serverLines: ServerLine[],
  botLines: BotsLine[],
  fromT: number,
): Summary {
  const lines = serverLines.filter((l) => l.t >= fromT);
  const bots = botLines.filter((l) => l.t >= fromT);
  const secs = Math.max(1, lines.length);
  const total: number[] = [];
  const phases: Record<string, number[]> = {};
  for (const l of lines) {
    total.push(...l.raw.total);
    for (const [name, v] of Object.entries(l.raw.phases)) {
      const list = phases[name] ?? [];
      list.push(...v);
      phases[name] = list;
    }
  }
  const sum = (f: (l: ServerLine) => number) => lines.reduce((a, l) => a + f(l), 0);
  const online = lines.length > 0 ? sum((l) => l.online) / lines.length : 0;
  const msgs = sum((l) => l.gateway.messagesOut);
  const bytes = sum((l) => l.gateway.bytesOut);
  const walkTicks = bots.reduce((a, l) => a + l.walkTicks, 0);
  const walkMin = Math.max(walkTicks / 20 / 60, 1e-9);
  const closes: Record<string, number> = {};
  for (const l of bots) {
    for (const [c, n] of Object.entries(l.closes)) {
      closes[c] = (closes[c] ?? 0) + n;
    }
  }
  const actions: Record<string, number> = {};
  for (const l of bots) {
    for (const [a, n] of Object.entries(l.actions ?? {})) {
      actions[a] = (actions[a] ?? 0) + n;
    }
  }
  const delays = bots.flatMap((l) => l.delays).sort((a, b) => a - b);
  const droppedAt = (l: ServerLine | undefined) => l?.dropped ?? 0;
  const before = serverLines.filter((l) => l.t < fromT).at(-1);
  const last = lines.at(-1);
  return {
    scenario,
    profile,
    seconds: lines.length,
    online: r1(online),
    tick: spread(total),
    phases: Object.fromEntries(Object.entries(phases).map(([k, v]) => [k, spread(v)])),
    dropped: droppedAt(last) - droppedAt(before),
    maxLateMs: Math.max(0, ...lines.map((l) => l.maxLateMs)),
    messagesPerPlayerSec: r1(msgs / secs / Math.max(online, 1)),
    kbPerPlayerSec: r1(bytes / 1024 / secs / Math.max(online, 1)),
    totalKbPerSec: r1(bytes / 1024 / secs),
    encodeMsPerSec: r1(sum((l) => l.gateway.encodeMs ?? 0) / secs),
    sendMsPerSec: r1(sum((l) => l.gateway.sendMs ?? 0) / secs),
    maxBacklogKb: r1(Math.max(0, ...lines.map((l) => l.gateway.maxBacklog)) / 1024),
    closedBehind: sum((l) => l.gateway.closedBehind),
    cpuPercent: r1(sum((l) => l.cpuMs ?? 0) / secs / 10),
    rssMb: r1(Math.max(0, ...lines.map((l) => l.rss)) / 1024 / 1024),
    rowsPerSec: r1(sum((l) => l.rowsWritten) / secs),
    snapsPredictingPerMin: r1(bots.reduce((a, l) => a + l.snapsPredicting, 0) / walkMin),
    snapsServerPerMin: r1(bots.reduce((a, l) => a + l.snapsServer, 0) / walkMin),
    snapsTimeoutPerMin: r1(bots.reduce((a, l) => a + l.snapsTimeout, 0) / walkMin),
    delayMs: { p50: pct(delays, 0.5), p99: pct(delays, 0.99) },
    closes,
    denied: bots.reduce((a, l) => a + l.denied, 0),
    deaths: bots.reduce((a, l) => a + l.deaths, 0),
    actions,
  };
}

/** The performance targets for one run. */
export function targetsOf(s: Summary): Target[] {
  const out: Target[] = [];
  const crowd = s.scenario.startsWith("world") || s.scenario === "burst" || s.scenario === "town";
  if (crowd && s.scenario !== "burst") {
    out.push({ name: "tick p99 < 25 ms", ok: s.tick.p99 < 25, value: `${r1(s.tick.p99)} ms` });
    out.push({ name: "no dropped ticks", ok: s.dropped === 0, value: String(s.dropped) });
  }
  if (crowd && s.profile === "p150" && s.scenario !== "burst") {
    out.push({
      name: "snaps while predicting < 1 per minute of walking",
      ok: s.snapsPredictingPerMin < 1,
      value: String(s.snapsPredictingPerMin),
    });
  }
  return out;
}

export function reportMarkdown(host: string, summaries: Summary[]): string {
  const rows: string[] = [];
  rows.push("# Perf report", "", host, "");
  rows.push(
    "| scenario | profile | online | tick p50 / p99 / worst ms | dropped | late ms | msgs/player/s | KB/player/s | total KB/s | backlog KB | cpu % | rss MB | rows/s | snaps/min walking (pred / server / timeout) | answer p50 / p99 ms |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
  );
  for (const s of summaries) {
    rows.push(
      `| ${s.scenario} | ${s.profile} | ${s.online} | ${r1(s.tick.p50)} / ${r1(s.tick.p99)} / ${r1(s.tick.max)} | ${s.dropped} | ${r1(s.maxLateMs)} | ${s.messagesPerPlayerSec} | ${s.kbPerPlayerSec} | ${s.totalKbPerSec} | ${s.maxBacklogKb} | ${s.cpuPercent} | ${s.rssMb} | ${s.rowsPerSec} | ${s.snapsPredictingPerMin} / ${s.snapsServerPerMin} / ${s.snapsTimeoutPerMin} | ${s.delayMs.p50} / ${s.delayMs.p99} |`,
    );
  }
  rows.push("", "## Delivery (ms per second spent)", "");
  for (const s of summaries) {
    rows.push(
      `- ${s.scenario} @ ${s.profile}: encode ${s.encodeMsPerSec}, socket send ${s.sendMsPerSec}`,
    );
  }
  rows.push("", "## Phases (p50 / p99 ms)", "");
  for (const s of summaries) {
    const ph = Object.entries(s.phases)
      .map(([k, v]) => `${k} ${r1(v.p50)}/${r1(v.p99)}`)
      .join(", ");
    rows.push(`- ${s.scenario} @ ${s.profile}: ${ph}`);
  }
  rows.push("", "## Targets", "");
  for (const s of summaries) {
    for (const t of targetsOf(s)) {
      rows.push(
        `- ${t.ok ? "met" : "**MISSED**"}: ${s.scenario} @ ${s.profile}: ${t.name} (${t.value})`,
      );
    }
    const did = Object.entries(s.actions)
      .map(([a, n]) => `${a}×${n}`)
      .join(", ");
    rows.push(`- bot actions, ${s.scenario} @ ${s.profile}: ${did}, deaths ${s.deaths}`);
    const closes = Object.entries(s.closes);
    if (closes.length > 0) {
      rows.push(
        `- closes seen by bots, ${s.scenario} @ ${s.profile}: ${closes.map(([c, n]) => `${c}×${n}`).join(", ")}`,
      );
    }
  }
  return `${rows.join("\n")}\n`;
}
