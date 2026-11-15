/**
 * The input layer: the keyboard becomes intents, `move{held, turn}` on every change and
 * `step{dir, turn}` on each press.
 *
 * - Several arrows held resolve Left > Right > Up > Down, on the client and
 *   again on the server.
 * - Turn in place: Alt/Option + arrow.
 * - Chat: Enter opens the chat input; arrows then move only the caret.
 * - Attack: Tab, as one hold state: `attack{held}` on every
 *   change; held repeats.
 */
import { type Dir, resolveHeld } from "@secondstaronline/shared";

export interface InputSink {
  move(held: Dir | null, turn: boolean): void;
  step(dir: Dir, turn: boolean): void;
  /** The attack hold state changed. */
  attack(held: boolean): void;
  /** Ctrl: pick up the faced item. */
  action(): void;
}

export interface InputState {
  keys: Partial<Record<Dir, boolean>>;
  alt: boolean;
  /** Tab held. */
  attackKey: boolean;
}

export function createInputState(): InputState {
  return {
    keys: {},
    alt: false,
    attackKey: false,
  };
}

/** The attack key is Tab, as in 1.6. */
export const ATTACK_KEY = "Tab";

function setAttack(s: InputState, sink: InputSink, down: boolean): void {
  if (s.attackKey !== down) {
    s.attackKey = down;
    sink.attack(down);
  }
}

export function heldDir(s: InputState): Dir | null {
  return resolveHeld(s.keys);
}

export function turnActive(s: InputState): boolean {
  return s.alt;
}

const KEY_DIR: Record<string, Dir> = {
  ArrowLeft: "L",
  ArrowRight: "R",
  ArrowUp: "U",
  ArrowDown: "D",
};

/**
 * Applies a held-set change and emits intents: a `step` for a new press (with the resolved
 * direction, so priority holds for taps too) and a `move` whenever the held state changes.
 */
function update(
  s: InputState,
  sink: InputSink,
  before: { held: Dir | null; turn: boolean },
  pressed: boolean,
) {
  const held = heldDir(s);
  const turn = turnActive(s);
  if (pressed && held) {
    sink.step(held, turn);
  }
  if (held !== before.held || turn !== before.turn) {
    sink.move(held, turn);
  }
}

/** Ctrl; one action per press here. */
export const ACTION_KEY = "Control";

export function keyDown(
  s: InputState,
  sink: InputSink,
  key: string,
  altKey: boolean,
  repeat = false,
): boolean {
  if (key === ACTION_KEY) {
    if (!repeat) {
      sink.action();
    }
    return true;
  }
  if (key === ATTACK_KEY) {
    setAttack(s, sink, true);
    return true; // and no focus change
  }
  const before = { held: heldDir(s), turn: turnActive(s) };
  if (key === "Alt") {
    s.alt = true;
    update(s, sink, before, false);
    return true;
  }
  const dir = KEY_DIR[key];
  if (!dir) {
    return false;
  }
  s.alt = altKey;
  const isNew = !s.keys[dir];
  s.keys[dir] = true;
  update(s, sink, before, isNew);
  return true;
}

export function keyUp(s: InputState, sink: InputSink, key: string): boolean {
  if (key === ATTACK_KEY) {
    setAttack(s, sink, false);
    return true;
  }
  const before = { held: heldDir(s), turn: turnActive(s) };
  if (key === "Alt") {
    s.alt = false;
    update(s, sink, before, false);
    return true;
  }
  const dir = KEY_DIR[key];
  if (!dir) {
    return false;
  }
  s.keys[dir] = false;
  update(s, sink, before, false);
  return true;
}

/** Releases everything (window blur). */
export function releaseAll(s: InputState, sink: InputSink): void {
  const before = { held: heldDir(s), turn: turnActive(s) };
  s.keys = {};
  s.alt = false;
  update(s, sink, before, false);
  setAttack(s, sink, false);
}
