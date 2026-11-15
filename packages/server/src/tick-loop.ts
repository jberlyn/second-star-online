/**
 * Fixed 20 Hz step loop: one tick = one original frame.
 *
 * The loop calls one `onTick(tick)`; the sim's own step function fixes the per-system order.
 *
 * A class is used because the loop has a lifecycle (start/stop).
 */
import { TICK_MS } from "@secondstaronline/shared";

import type { Clock } from "./clock.ts";

export interface TickLoopOptions {
  clock: Clock;
  onTick: (tick: number) => void;
  tickMs?: number;
  /**
   * After a stall, run at most this many ticks to catch up and drop the rest of the backlog.
   * Example: a 2 s stall replays 10 ticks (0.5 s) instead of fast-forwarding 40 frames.
   */
  maxCatchUpTicks?: number;
  /** How often the wall-clock poll runs, in ms. */
  pollMs?: number;
  /** Called with the number of ticks dropped each time a stall clamps the backlog. */
  onDropped?: (n: number) => void;
}

export class TickLoop {
  readonly tickMs: number;
  readonly maxCatchUpTicks: number;
  private readonly clock: Clock;
  private readonly onTick: (tick: number) => void;
  private readonly pollMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTime = 0;
  private accumulator = 0;
  private currentTick = 0;
  private dropped = 0;
  private maxLate = 0;
  private readonly onDropped: ((n: number) => void) | undefined;

  constructor(options: TickLoopOptions) {
    this.clock = options.clock;
    this.onTick = options.onTick;
    this.tickMs = options.tickMs ?? TICK_MS;
    this.maxCatchUpTicks = options.maxCatchUpTicks ?? 10;
    this.pollMs = options.pollMs ?? Math.max(1, Math.floor(this.tickMs / 10));
    this.onDropped = options.onDropped;
  }

  /** Ticks dropped by `poll()` so far (never by `step()`). */
  get droppedTicks(): number {
    return this.dropped;
  }

  /**
   * The worst lateness of a tick since the last call, in ms: how long after its due time the poll
   * that ran it came. Timer jitter shows here. Reading resets it.
   */
  takeLateness(): number {
    const late = this.maxLate;
    this.maxLate = 0;
    return late;
  }

  get tick(): number {
    return this.currentTick;
  }

  get running(): boolean {
    return this.timer !== null;
  }

  start(): void {
    if (this.timer !== null) {
      return;
    }
    this.lastTime = this.clock.now();
    this.accumulator = 0;
    this.timer = setInterval(() => this.poll(), this.pollMs);
  }

  stop(): void {
    if (this.timer === null) {
      return;
    }
    clearInterval(this.timer);
    this.timer = null;
  }

  /** Reads the clock and runs every tick that is due. Returns how many ran. */
  poll(): number {
    const now = this.clock.now();
    const elapsed = now - this.lastTime;
    this.lastTime = now;
    if (elapsed <= 0) {
      return 0;
    }
    const total = this.accumulator + elapsed;
    const cap = this.maxCatchUpTicks * this.tickMs;
    if (total >= this.tickMs) {
      // How far past its due time this poll is: what is left after the whole ticks it owes.
      this.maxLate = Math.max(this.maxLate, total - this.tickMs);
    }
    if (total > cap) {
      const dropped = Math.floor(total / this.tickMs) - this.maxCatchUpTicks;
      if (dropped > 0) {
        this.dropped += dropped;
        this.onDropped?.(dropped);
      }
    }
    this.accumulator = Math.min(total, cap);
    return this.drain();
  }

  /** Advances by `deltaMs` without the clock (tests and replays). Returns how many ticks ran. */
  step(deltaMs: number = this.tickMs): number {
    this.accumulator += deltaMs;
    return this.drain();
  }

  private drain(): number {
    let ran = 0;
    while (this.accumulator >= this.tickMs) {
      this.accumulator -= this.tickMs;
      this.currentTick += 1;
      this.onTick(this.currentTick);
      ran += 1;
    }
    return ran;
  }
}
