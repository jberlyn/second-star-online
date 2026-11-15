/**
 * The `Clock` dependency: anything that reads time takes one as an argument. Production uses
 * `systemClock`; tests use a manual clock (tests/helpers). It has the one method callers need.
 */
export type Clock = { now(): number };

/** Monotonic milliseconds. */
export const systemClock: Clock = { now: () => performance.now() };
