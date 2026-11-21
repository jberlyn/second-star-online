/**
 * The input layer: the keyboard becomes intents, `move{held, turn}` on every change and
 * `step{dir, turn}` on each press.
 *
 * Two fixed layouts, read from a table so a later Settings window can rebind them:
 *
 * - Classic (1.6): arrows move, Alt/Option + arrow turns in place, Tab attacks while held,
 *   Ctrl picks up or uses. Matched by the typed key (`e.key`), as 1.6 did.
 * - Modern (the default, an SSO addition): W A S D move, Shift + W A S D turns, Space attacks
 *   while held, E picks up or uses. Matched by the physical key (`e.code`), so the keys sit in
 *   the same place on AZERTY or Dvorak. Ctrl is no key here: next to W, Ctrl+W closes the tab.
 *   Tab and Alt are swallowed with no action, so Tab cannot move focus to a button that Space
 *   would then press, and Alt cannot open the browser's menu bar.
 *
 * In both, several directions held resolve Left > Right > Up > Down, on the client and again
 * on the server, and the attack is one hold state: `attack{held}` on every change; held repeats.
 */
import { type Dir, resolveHeld } from "@secondstaronline/shared";

export type ControlLayout = "modern" | "classic";

export const DEFAULT_LAYOUT: ControlLayout = "modern";

/** Reads a saved layout; anything else (nothing saved, an old value) is the default. */
export function parseLayout(saved: string | null): ControlLayout {
  return saved === "classic" || saved === "modern" ? saved : DEFAULT_LAYOUT;
}

interface Layout {
  /** Which event field the keys below name. */
  by: "key" | "code";
  dirs: Readonly<Record<string, Dir>>;
  attack: readonly string[];
  action: readonly string[];
  turn: readonly string[];
  /** The modifier flag that, held with a direction, turns in place. */
  turnFlag: "altKey" | "shiftKey";
  /** Keys taken from the browser with no action. */
  swallow: readonly string[];
}

export const LAYOUTS: Readonly<Record<ControlLayout, Layout>> = {
  classic: {
    by: "key",
    dirs: { ArrowLeft: "L", ArrowRight: "R", ArrowUp: "U", ArrowDown: "D" },
    attack: ["Tab"],
    action: ["Control"],
    turn: ["Alt"],
    turnFlag: "altKey",
    swallow: [],
  },
  modern: {
    by: "code",
    dirs: { KeyA: "L", KeyD: "R", KeyW: "U", KeyS: "D" },
    attack: ["Space"],
    action: ["KeyE"],
    turn: ["ShiftLeft", "ShiftRight"],
    turnFlag: "shiftKey",
    swallow: ["Tab", "AltLeft", "AltRight"],
  },
};

/** The parts of a KeyboardEvent the input layer reads. */
export interface KeyPress {
  key: string;
  code?: string;
  altKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
  repeat?: boolean;
}

export interface InputSink {
  move(held: Dir | null, turn: boolean): void;
  step(dir: Dir, turn: boolean): void;
  /** The attack hold state changed. */
  attack(held: boolean): void;
  /** The action key: pick up or use the faced item. */
  action(): void;
}

export interface InputState {
  layout: ControlLayout;
  keys: Partial<Record<Dir, boolean>>;
  /** The turn modifier (Alt in Classic, Shift in Modern) held. */
  turnKey: boolean;
  /** The attack key held. */
  attackKey: boolean;
}

export function createInputState(layout: ControlLayout = "classic"): InputState {
  return {
    layout,
    keys: {},
    turnKey: false,
    attackKey: false,
  };
}

/** Switches layout, releasing anything held under the old one first. */
export function setLayout(s: InputState, sink: InputSink, layout: ControlLayout): void {
  if (s.layout !== layout) {
    releaseAll(s, sink);
    s.layout = layout;
  }
}

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
  return s.turnKey;
}

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

const name = (l: Layout, e: KeyPress) => (l.by === "code" ? (e.code ?? "") : e.key);

/** Returns true when the game used the key, so the caller stops the browser's own action. */
export function keyDown(s: InputState, sink: InputSink, e: KeyPress): boolean {
  if (e.key === "Meta" || e.metaKey) {
    // macOS swallows keyup for non-modifier keys pressed with Command; release any held keys
    // and let the browser handle the shortcut without leaving a direction stuck.
    releaseAll(s, sink);
    return false;
  }
  const l = LAYOUTS[s.layout];
  const k = name(l, e);
  if (l.action.includes(k)) {
    if (!e.repeat) {
      sink.action();
    }
    return true;
  }
  if (l.attack.includes(k)) {
    if (!e.repeat) {
      setAttack(s, sink, true);
    }
    return true; // and no focus change or button press
  }
  if (l.swallow.includes(k)) {
    return true;
  }
  const before = { held: heldDir(s), turn: turnActive(s) };
  if (l.turn.includes(k)) {
    if (!e.repeat) {
      s.turnKey = true;
      update(s, sink, before, false);
    }
    return true;
  }
  const dir = Object.hasOwn(l.dirs, k) ? l.dirs[k] : undefined;
  if (!dir) {
    return false;
  }
  if (e.repeat) {
    return true;
  }
  s.turnKey = e[l.turnFlag] === true;
  const isNew = !s.keys[dir];
  s.keys[dir] = true;
  update(s, sink, before, isNew);
  return true;
}

export function keyUp(s: InputState, sink: InputSink, e: KeyPress): boolean {
  if (e.key === "Meta") {
    releaseAll(s, sink);
    return false;
  }
  const l = LAYOUTS[s.layout];
  const k = name(l, e);
  if (l.attack.includes(k)) {
    setAttack(s, sink, false);
    return true;
  }
  if (l.action.includes(k) || l.swallow.includes(k)) {
    return true;
  }
  const before = { held: heldDir(s), turn: turnActive(s) };
  if (l.turn.includes(k)) {
    // If the other modifier key is still down, keep turning.
    s.turnKey = e[l.turnFlag] === true;
    update(s, sink, before, false);
    return true;
  }
  const dir = Object.hasOwn(l.dirs, k) ? l.dirs[k] : undefined;
  if (!dir) {
    return false;
  }
  s.keys[dir] = false;
  update(s, sink, before, false);
  return true;
}

/** Releases everything (window blur, a layout change). */
export function releaseAll(s: InputState, sink: InputSink): void {
  const before = { held: heldDir(s), turn: turnActive(s) };
  s.keys = {};
  s.turnKey = false;
  update(s, sink, before, false);
  setAttack(s, sink, false);
}
