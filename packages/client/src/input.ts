/**
 * The input layer: the keyboard becomes intents, `move{held, turn}` on every change and
 * `step{dir, turn}` on each press.
 *
 * Supports the Modern preset (default, physical `e.code`), Classic 1.6 preset (arrows, Alt, Tab,
 * Ctrl matched by `e.key`), and Custom per-action rebinds (`e.code`, primary + secondary key).
 *
 * In every layout, several directions held resolve Left > Right > Up > Down on the client and
 * again on the server, and attack is one hold state: `attack{held}` on every change; held repeats.
 */
import {
  bindingsEqual,
  type ControlSet,
  type Dir,
  effectiveBindings,
  type KeyAction,
  type KeyBindings,
  presetBindings,
  resolveHeld,
} from "@secondstaronline/shared";

export type ControlLayout = ControlSet;

export const DEFAULT_LAYOUT: ControlLayout = "modern";

/** Reads a saved layout; anything else (nothing saved, an old value) is the default. */
export function parseLayout(saved: string | null): ControlLayout {
  return saved === "classic" || saved === "modern" || saved === "custom" ? saved : DEFAULT_LAYOUT;
}

interface ClassicTable {
  by: "key";
  dirs: Readonly<Record<string, Dir>>;
  attack: readonly string[];
  action: readonly string[];
  turn: readonly string[];
  turnFlag: "altKey";
  swallow: readonly string[];
}

interface CodeTable {
  by: "code";
  dirs: Readonly<Record<string, Dir>>;
  attack: readonly string[];
  action: readonly string[];
  turn: readonly string[];
  /** Keys taken from the browser with no action. */
  swallow: readonly string[];
}

type ActiveTable = ClassicTable | CodeTable;

export const LAYOUTS = {
  classic: {
    by: "key" as const,
    dirs: { ArrowLeft: "L", ArrowRight: "R", ArrowUp: "U", ArrowDown: "D" } as Readonly<
      Record<string, Dir>
    >,
    attack: ["Tab"] as readonly string[],
    action: ["Control"] as readonly string[],
    turn: ["Alt"] as readonly string[],
    turnFlag: "altKey" as const,
    swallow: [] as readonly string[],
  },
  modern: {
    by: "code" as const,
    dirs: { KeyA: "L", KeyD: "R", KeyW: "U", KeyS: "D" } as Readonly<Record<string, Dir>>,
    attack: ["Space"] as readonly string[],
    action: ["KeyE"] as readonly string[],
    turn: ["ShiftLeft", "ShiftRight"] as readonly string[],
    turnFlag: "shiftKey" as const,
    swallow: ["Tab", "AltLeft", "AltRight"] as readonly string[],
  },
} as const;

const nonNull = (slot: readonly [string | null, string | null]): string[] =>
  slot.filter((c): c is string => c !== null);

function modifierFlagFor(code: string): "altKey" | "shiftKey" | "ctrlKey" | null {
  if (code === "AltLeft" || code === "AltRight") {
    return "altKey";
  }
  if (code === "ShiftLeft" || code === "ShiftRight") {
    return "shiftKey";
  }
  if (code === "ControlLeft" || code === "ControlRight") {
    return "ctrlKey";
  }
  return null;
}

function buildCodeTable(bindings: KeyBindings): CodeTable {
  const dirs: Record<string, Dir> = {};
  for (const c of nonNull(bindings.moveLeft)) {
    dirs[c] = "L";
  }
  for (const c of nonNull(bindings.moveRight)) {
    dirs[c] = "R";
  }
  for (const c of nonNull(bindings.moveUp)) {
    dirs[c] = "U";
  }
  for (const c of nonNull(bindings.moveDown)) {
    dirs[c] = "D";
  }
  const attack = nonNull(bindings.attack);
  const action = nonNull(bindings.action);
  const turn = nonNull(bindings.turn);
  // Collect all bound codes across every action so we only swallow unbound Tab / Alt.
  const allBound = new Set<string>();
  for (const slot of Object.values(bindings)) {
    for (const c of slot) {
      if (c) {
        allBound.add(c);
      }
    }
  }
  const swallow = ["Tab", "AltLeft", "AltRight"].filter((c) => !allBound.has(c));
  return {
    by: "code",
    dirs,
    attack,
    action,
    turn,
    swallow,
  };
}

/** Fallback `e.key` → `e.code` for synthetic tests that omit `code`. */
function fallbackCode(e: KeyPress): string {
  if (e.code) {
    return e.code;
  }
  if (e.key === " ") {
    return "Space";
  }
  if (e.key === "/") {
    return "Slash";
  }
  if (/^[a-zA-Z]$/.test(e.key)) {
    return `Key${e.key.toUpperCase()}`;
  }
  if (/^[0-9]$/.test(e.key)) {
    return `Digit${e.key}`;
  }
  if (e.key === "Shift") {
    return "ShiftLeft";
  }
  if (e.key === "Alt") {
    return "AltLeft";
  }
  if (e.key === "Control") {
    return "ControlLeft";
  }
  return e.key;
}

/** The parts of a KeyboardEvent the input layer reads. */
export interface KeyPress {
  key: string;
  code?: string;
  altKey?: boolean;
  shiftKey?: boolean;
  ctrlKey?: boolean;
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
  bindings: KeyBindings;
  /** Compiled lookup table for movement/attack/action/turn. */
  table: ActiveTable;
  keys: Partial<Record<Dir, boolean>>;
  /** Physical key IDs currently held per direction (supports primary + secondary binds). */
  heldDirKeys: Record<Dir, Set<string>>;
  /** Physical key IDs currently held for Attack (supports primary + secondary binds). */
  heldAttackKeys: Set<string>;
  /** Bound turn keys currently held (tracks both modifier and non-modifier turn keys). */
  heldTurnKeys: Set<string>;
  /** The turn modifier (Alt in Classic, Shift in Modern, or custom turn key) held. */
  turnKey: boolean;
  /** The attack key held. */
  attackKey: boolean;
}

function compileTable(layout: ControlLayout, bindings: KeyBindings): ActiveTable {
  if (layout === "classic") {
    return LAYOUTS.classic;
  }
  return buildCodeTable(effectiveBindings({ controlSet: layout, keyBindings: bindings }));
}

export function createInputState(
  layout: ControlLayout = "classic",
  bindings?: KeyBindings,
): InputState {
  const b = bindings
    ? effectiveBindings({ controlSet: layout, keyBindings: bindings })
    : presetBindings(layout === "classic" ? "classic" : "modern");
  return {
    layout,
    bindings: b,
    table: compileTable(layout, b),
    keys: {},
    heldDirKeys: { L: new Set(), R: new Set(), U: new Set(), D: new Set() },
    heldAttackKeys: new Set(),
    heldTurnKeys: new Set(),
    turnKey: false,
    attackKey: false,
  };
}

/** Switches layout, releasing anything held under the old one only when controls actually change. */
export function setLayout(
  s: InputState,
  sink: InputSink,
  layout: ControlLayout,
  bindings?: KeyBindings,
): void {
  const nextBindings = bindings
    ? effectiveBindings({ controlSet: layout, keyBindings: bindings })
    : presetBindings(layout === "classic" ? "classic" : "modern");
  if (s.layout === layout && bindingsEqual(s.bindings, nextBindings)) {
    return;
  }
  releaseAll(s, sink);
  s.layout = layout;
  s.bindings = nextBindings;
  s.table = compileTable(layout, nextBindings);
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

const keyId = (t: ActiveTable, e: KeyPress) => (t.by === "code" ? fallbackCode(e) : e.key);

/** Prunes held modifier codes whose keyup was missed (only when the flag is explicitly false). */
function pruneStaleTurnModifiers(heldTurnKeys: Set<string>, e: KeyPress): void {
  if (e.shiftKey === false) {
    heldTurnKeys.delete("ShiftLeft");
    heldTurnKeys.delete("ShiftRight");
  }
  if (e.altKey === false) {
    heldTurnKeys.delete("AltLeft");
    heldTurnKeys.delete("AltRight");
  }
  if (e.ctrlKey === false) {
    heldTurnKeys.delete("ControlLeft");
    heldTurnKeys.delete("ControlRight");
  }
}

function isTurnHeld(t: ActiveTable, heldTurnKeys: Set<string>, e: KeyPress): boolean {
  if (t.by === "key") {
    return e[t.turnFlag] === true;
  }
  pruneStaleTurnModifiers(heldTurnKeys, e);
  return heldTurnKeys.size > 0;
}

/** Returns true when the game used the key, so the caller stops the browser's own action. */
export function keyDown(s: InputState, sink: InputSink, e: KeyPress): boolean {
  if (e.key === "Meta" || e.metaKey) {
    // macOS swallows keyup for non-modifier keys pressed with Command; release any held keys
    // and let the browser handle the shortcut without leaving a direction stuck.
    releaseAll(s, sink);
    return false;
  }
  const t = s.table;
  const k = keyId(t, e);
  if (t.action.includes(k)) {
    if (!e.repeat) {
      sink.action();
    }
    return true;
  }
  if (t.attack.includes(k)) {
    if (!e.repeat) {
      s.heldAttackKeys.add(k);
      setAttack(s, sink, true);
    }
    return true; // and no focus change or button press
  }
  if (t.swallow.includes(k)) {
    return true;
  }
  const before = { held: heldDir(s), turn: turnActive(s) };
  if (t.turn.includes(k)) {
    if (!e.repeat) {
      s.heldTurnKeys.add(k);
      s.turnKey = true;
      update(s, sink, before, false);
    }
    return true;
  }
  const dir = Object.hasOwn(t.dirs, k) ? t.dirs[k] : undefined;
  if (!dir) {
    return false;
  }
  if (e.repeat) {
    return true;
  }
  s.turnKey = isTurnHeld(t, s.heldTurnKeys, e);
  const isNew = !s.keys[dir];
  s.heldDirKeys[dir].add(k);
  s.keys[dir] = true;
  update(s, sink, before, isNew);
  return true;
}

export function keyUp(s: InputState, sink: InputSink, e: KeyPress): boolean {
  if (e.key === "Meta") {
    releaseAll(s, sink);
    return false;
  }
  const t = s.table;
  const k = keyId(t, e);
  if (t.attack.includes(k)) {
    s.heldAttackKeys.delete(k);
    if (s.heldAttackKeys.size === 0) {
      setAttack(s, sink, false);
    }
    return true;
  }
  if (t.action.includes(k) || t.swallow.includes(k)) {
    return true;
  }
  const before = { held: heldDir(s), turn: turnActive(s) };
  if (t.turn.includes(k)) {
    s.heldTurnKeys.delete(k);
    // Keep turning while another bound turn key is still down.
    s.turnKey = isTurnHeld(t, s.heldTurnKeys, e);
    update(s, sink, before, false);
    return true;
  }
  const dir = Object.hasOwn(t.dirs, k) ? t.dirs[k] : undefined;
  if (!dir) {
    return false;
  }
  s.heldDirKeys[dir].delete(k);
  if (s.heldDirKeys[dir].size === 0) {
    delete s.keys[dir];
  }
  update(s, sink, before, false);
  return true;
}

/** Releases everything (window blur, a layout change). */
export function releaseAll(s: InputState, sink: InputSink): void {
  const before = { held: heldDir(s), turn: turnActive(s) };
  s.keys = {};
  for (const dir of ["L", "R", "U", "D"] as const) {
    s.heldDirKeys[dir].clear();
  }
  s.heldAttackKeys.clear();
  s.heldTurnKeys.clear();
  s.turnKey = false;
  update(s, sink, before, false);
  setAttack(s, sink, false);
}

export type OneShotAction =
  | "chat"
  | "commandChat"
  | "tabStats"
  | "tabInventory"
  | "tabSkills"
  | "tabSpellbook"
  | "windowFriends"
  | "windowWho";

const ONE_SHOT_ACTIONS: readonly OneShotAction[] = [
  "chat",
  "commandChat",
  "tabStats",
  "tabInventory",
  "tabSkills",
  "tabSpellbook",
  "windowFriends",
  "windowWho",
];

function isCodeBoundAnywhere(bindings: KeyBindings, code: string): boolean {
  for (const slot of Object.values(bindings)) {
    if (slot[0] === code || slot[1] === code) {
      return true;
    }
  }
  return false;
}

/**
 * Matches a non-movement hotkey (chat, slash-chat, panel tabs, Friends/Who windows). Returns null
 * when browser modifiers (Ctrl/Alt/Meta) are held unless the action itself is bound to one.
 */
export function matchOneShotAction(s: InputState, e: KeyPress): OneShotAction | null {
  if (e.metaKey || e.key === "Meta") {
    return null;
  }
  const bindings = s.bindings;
  const hasCode = Boolean(e.code);
  const code = fallbackCode(e);
  // Ignore modified shortcuts (Ctrl+I, Alt+F, etc.) unless the key itself IS a modifier.
  if ((e.ctrlKey || e.altKey) && modifierFlagFor(code) === null) {
    return null;
  }
  // Exact physical code match first (honours Custom rebinds cleanly).
  for (const act of ONE_SHOT_ACTIONS) {
    const slot = bindings[act];
    if (slot[0] === code || slot[1] === code) {
      return act;
    }
  }
  // Layout-independent `/` shortcut (issue #20) when `commandChat` includes `Slash`:
  // in Custom mode, never hijack a physical key that the player bound to another action.
  if (
    e.key === "/" &&
    !e.ctrlKey &&
    !e.altKey &&
    bindings.commandChat.includes("Slash") &&
    (s.layout !== "custom" || !hasCode || !isCodeBoundAnywhere(bindings, code))
  ) {
    return "commandChat";
  }
  // Synthetic tests without `e.code`: match key "Enter" when either Enter key is bound to chat.
  if (
    !hasCode &&
    e.key === "Enter" &&
    (bindings.chat.includes("Enter") || bindings.chat.includes("NumpadEnter"))
  ) {
    return "chat";
  }
  return null;
}

export function actionBindingLabel(s: InputState, act: KeyAction): string {
  const [first, second] = s.bindings[act];
  return first ?? second ?? "";
}
