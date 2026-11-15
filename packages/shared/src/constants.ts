/**
 * Simulation timing: one server tick = one original frame. The gameplay loop forces
 * `puppetTempo(20)`.
 */
export const TICK_HZ = 20;
export const TICK_MS = 1000 / TICK_HZ;

/**
 * Director sends every `actorList` object (sprite behaviours, monsters, the `timer`) two
 * `stepFrame` calls per drawn frame, while frame-script counters (`N24`) run once. Measured
 * 2026-11-08 in the running 1.6 (scenes 1, 2 and 5 of a recorded session). The server
 * tick and the client's prediction run the whole actor phase this many times per tick; every
 * counter keeps the script's literal value (16 for a foot step, 40 for the hit flicker, ...).
 */
export const STEPFRAMES_PER_FRAME = 2;

/** One map screen is 17×12 tiles of 32 px Coordinates are 1-based. */
export const MAP_WIDTH = 17;
export const MAP_HEIGHT = 12;
export const TILE_PX = 32;
