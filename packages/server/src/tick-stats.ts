/**
 * Tick timing: a probe the game calls at the seams of a tick, and the windowed statistics the
 * operator log line and the perf rig read. Pure: the clock is passed in, and a game with no probe
 * does none of this (it is a dependency like `Clock`).
 */

/** The stretches a tick is split into, in the order they run. */
export type TickPhase = "rooms" | "world" | "players" | "deliver" | "sql" | "commit";

export const TICK_PHASES: readonly TickPhase[] = [
  "rooms",
  "world",
  "players",
  "deliver",
  "sql",
  "commit",
];

/** What the game calls; `createTickProbe` implements it. */
export interface TickProbe {
  begin(): void;
  phase(name: TickPhase): void;
  end(): void;
}

export type PhaseTimes = Partial<Record<TickPhase, number>>;

export interface Spread {
  p50: number;
  p99: number;
  max: number;
}

export interface TickWindow {
  ticks: number;
  dropped: number;
  total: Spread;
  phases: Record<TickPhase, Spread>;
}

/**
 * Stamps each phase of a tick: `phase(name)` closes the span since the previous stamp under
 * `name`; `end()` closes what is left under "commit" (the transaction's own commit).
 * `onTick` gets the tick's total and its phases.
 */
export function createTickProbe(
  now: () => number,
  onTick: (totalMs: number, phases: PhaseTimes) => void,
): TickProbe {
  let start = 0;
  let last = 0;
  let phases: PhaseTimes = {};
  return {
    begin() {
      start = last = now();
      phases = {};
    },
    phase(name) {
      const t = now();
      phases[name] = (phases[name] ?? 0) + (t - last);
      last = t;
    },
    end() {
      const t = now();
      phases.commit = (phases.commit ?? 0) + (t - last);
      onTick(t - start, phases);
    },
  };
}

/** The p-th percentile (0-1) of an ascending list, nearest rank. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const rank = Math.ceil(p * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))] ?? 0;
}

function spread(values: number[]): Spread {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 0.5),
    p99: percentile(sorted, 0.99),
    max: sorted[sorted.length - 1] ?? 0,
  };
}

export interface TickStats {
  record(totalMs: number, phases?: PhaseTimes): void;
  addDropped(n: number): void;
  /** The window so far (at most a minute of ticks: sorting it is cheap). */
  window(): TickWindow;
  /** Every tick's time in the window, as recorded (the perf rig pools them across seconds). */
  raw(): { total: number[]; phases: Record<TickPhase, number[]> };
  reset(): void;
}

export function createTickStats(): TickStats {
  let totals: number[] = [];
  let perPhase: Record<TickPhase, number[]> = emptyPhases();
  let dropped = 0;
  function emptyPhases(): Record<TickPhase, number[]> {
    return { rooms: [], world: [], players: [], deliver: [], sql: [], commit: [] };
  }
  return {
    record(totalMs, phases) {
      totals.push(totalMs);
      if (phases) {
        for (const name of TICK_PHASES) {
          perPhase[name].push(phases[name] ?? 0);
        }
      }
    },
    addDropped(n) {
      dropped += n;
    },
    window() {
      const phases = {} as Record<TickPhase, Spread>;
      for (const name of TICK_PHASES) {
        phases[name] = spread(perPhase[name]);
      }
      return { ticks: totals.length, dropped, total: spread(totals), phases };
    },
    raw() {
      const round = (v: number[]) => v.map((x) => Math.round(x * 100) / 100);
      const phases = {} as Record<TickPhase, number[]>;
      for (const name of TICK_PHASES) {
        phases[name] = round(perPhase[name]);
      }
      return { total: round(totals), phases };
    },
    reset() {
      totals = [];
      perPhase = emptyPhases();
      dropped = 0;
    },
  };
}

/** A tick over this many ms is worth the operator's attention (half the 50 ms budget). */
export const SLOW_TICK_MS = 25;

/**
 * The one line the operator sees: null when the window had no dropped tick and no tick over 25 ms,
 * else `tick lag in the last minute: p99 4.1 ms, worst 31.2 ms, 3 ticks dropped, 87 online`.
 */
export function lagLine(window: TickWindow, online: number): string | null {
  if (window.dropped === 0 && window.total.max <= SLOW_TICK_MS) {
    return null;
  }
  return (
    `tick lag in the last minute: p99 ${window.total.p99.toFixed(1)} ms, ` +
    `worst ${window.total.max.toFixed(1)} ms, ${window.dropped} ticks dropped, ${online} online`
  );
}
