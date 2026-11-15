import type { Clock } from "../../src/clock.ts";

/** A clock that only moves when told to (salvaged `ManualClock`, now a test helper). */
export function manualClock(start = 1000): Clock & { advance(ms: number): void } {
  let t = start;
  return {
    now: () => t,
    advance(ms: number) {
      if (ms < 0) {
        throw new Error("Cannot advance time backwards");
      }
      t += ms;
    },
  };
}
