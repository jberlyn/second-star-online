/**
 * Player preferences: stored per account on the server and cached in the browser for pre-login
 * screens. Pure rules, defaults, validation and key-rebinding helpers shared by server and client.
 */
import { z } from "zod";

export type ControlSet = "modern" | "classic" | "custom";

export type KeyAction =
  | "moveUp"
  | "moveDown"
  | "moveLeft"
  | "moveRight"
  | "turn"
  | "attack"
  | "action"
  | "chat"
  | "commandChat"
  | "tabStats"
  | "tabInventory"
  | "tabSkills"
  | "tabSpellbook"
  | "windowFriends"
  | "windowWho";

export type KeyActionGroup = "movement" | "chat" | "windows";

export interface KeyActionMeta {
  readonly id: KeyAction;
  readonly label: string;
  readonly help: string;
  readonly group: KeyActionGroup;
}

export const KEY_ACTIONS: readonly KeyActionMeta[] = [
  {
    id: "moveUp",
    label: "Move up",
    help: "Walk north. Holding several directions resolves Left > Right > Up > Down.",
    group: "movement",
  },
  {
    id: "moveDown",
    label: "Move down",
    help: "Walk south.",
    group: "movement",
  },
  {
    id: "moveLeft",
    label: "Move left",
    help: "Walk west.",
    group: "movement",
  },
  {
    id: "moveRight",
    label: "Move right",
    help: "Walk east.",
    group: "movement",
  },
  {
    id: "turn",
    label: "Turn in place",
    help: "Hold with a movement key to face that direction without stepping.",
    group: "movement",
  },
  {
    id: "attack",
    label: "Attack",
    help: "Swing at the tile you face. Hold to keep attacking.",
    group: "movement",
  },
  {
    id: "action",
    label: "Pick up / Use",
    help: "Pick up, open or use whatever is on the tile you face.",
    group: "movement",
  },
  {
    id: "chat",
    label: "Open chat",
    help: "Focus the chat box to type a message.",
    group: "chat",
  },
  {
    id: "commandChat",
    label: "Open chat with /",
    help: "Focus the chat box with a slash already typed, ready for a command.",
    group: "chat",
  },
  {
    id: "tabStats",
    label: "Stats tab",
    help: "Switch the right panel to your character's stats and gold.",
    group: "windows",
  },
  {
    id: "tabInventory",
    label: "Inventory tab",
    help: "Switch the right panel to your bag and equipment.",
    group: "windows",
  },
  {
    id: "tabSkills",
    label: "Skills tab",
    help: "Switch the right panel to your skills list.",
    group: "windows",
  },
  {
    id: "tabSpellbook",
    label: "Spellbook tab",
    help: "Switch the right panel to your spells.",
    group: "windows",
  },
  {
    id: "windowFriends",
    label: "Friend's List",
    help: "Open or close your online friends window.",
    group: "windows",
  },
  {
    id: "windowWho",
    label: "Who's Online",
    help: "Open or close the list of players online.",
    group: "windows",
  },
];

/** Primary and secondary physical key codes (`KeyboardEvent.code`), null when unbound. */
export type KeySlot = [string | null, string | null];
export type KeyBindings = Record<KeyAction, KeySlot>;

export type GameSizeMode = "fit" | "sharp";
export type ChatTextSize = "small" | "classic" | "large";
export type PresenceChatMode = "off" | "friends" | "everyone";
export type ImPrivacy = "everyone" | "friends";
export type InvitePrivacy = "everyone" | "friends" | "none";

export interface PlayerPreferences {
  // Controls
  controlSet: ControlSet;
  keyBindings: KeyBindings;

  // Display
  gameSize: GameSizeMode;
  rememberWindowPositions: boolean;
  showDamageNumbers: boolean;

  // Sound
  sfxEnabled: boolean;
  masterVolume: number;
  combatVolume: number;
  spellsVolume: number;
  worldVolume: number;
  imChime: boolean;
  friendLogonSound: boolean;
  backgroundAudio: boolean;

  // Chat
  chatTextSize: ChatTextSize;
  chatTimestamps: boolean;
  showNpcChatter: boolean;
  presenceChatLines: PresenceChatMode;

  // Social & privacy
  imFrom: ImPrivacy;
  tradeFrom: InvitePrivacy;
  guildInvitesFrom: InvitePrivacy;

  // Accessibility
  colorblindBars: boolean;
  largerHoverTips: boolean;
}

/** Keys that cannot be bound: Escape cancels capture/chat; Meta drops keyups on macOS. */
export const RESERVED_KEY_CODES: ReadonlySet<string> = new Set([
  "Escape",
  "MetaLeft",
  "MetaRight",
  "OSLeft",
  "OSRight",
]);

/** Valid `KeyboardEvent.code` format (e.g. `KeyW`, `ShiftLeft`, `NumpadEnter`, `F12`). */
const KEY_CODE_RE = /^[A-Za-z][A-Za-z0-9]{0,23}$/;

export function isValidBindCode(code: unknown): code is string {
  return typeof code === "string" && KEY_CODE_RE.test(code) && !RESERVED_KEY_CODES.has(code);
}

/** Modern control set: WASD + Space + E + Shift, plus panel/window hotkeys. */
export const MODERN_BINDINGS: Readonly<KeyBindings> = {
  moveUp: ["KeyW", null],
  moveDown: ["KeyS", null],
  moveLeft: ["KeyA", null],
  moveRight: ["KeyD", null],
  turn: ["ShiftLeft", "ShiftRight"],
  attack: ["Space", null],
  action: ["KeyE", null],
  chat: ["Enter", "NumpadEnter"],
  commandChat: ["Slash", null],
  tabStats: ["KeyC", null],
  tabInventory: ["KeyI", null],
  tabSkills: ["KeyK", null],
  tabSpellbook: ["KeyB", null],
  windowFriends: ["KeyF", null],
  windowWho: ["KeyO", null],
};

/** Classic 1.6 control set: Arrows + Alt + Tab + Ctrl; no extra hotkeys. */
export const CLASSIC_BINDINGS: Readonly<KeyBindings> = {
  moveUp: ["ArrowUp", null],
  moveDown: ["ArrowDown", null],
  moveLeft: ["ArrowLeft", null],
  moveRight: ["ArrowRight", null],
  turn: ["AltLeft", "AltRight"],
  attack: ["Tab", null],
  action: ["ControlLeft", "ControlRight"],
  chat: ["Enter", "NumpadEnter"],
  commandChat: ["Slash", null],
  tabStats: [null, null],
  tabInventory: [null, null],
  tabSkills: [null, null],
  tabSpellbook: [null, null],
  windowFriends: [null, null],
  windowWho: [null, null],
};

export function cloneBindings(b: Readonly<KeyBindings>): KeyBindings {
  const out = {} as KeyBindings;
  for (const { id } of KEY_ACTIONS) {
    out[id] = [b[id][0], b[id][1]];
  }
  return out;
}

export function presetBindings(set: "modern" | "classic"): KeyBindings {
  return cloneBindings(set === "classic" ? CLASSIC_BINDINGS : MODERN_BINDINGS);
}

/** The active bindings for a preferences object (presets override stored custom slots). */
export function effectiveBindings(
  prefs: Pick<PlayerPreferences, "controlSet" | "keyBindings">,
): KeyBindings {
  if (prefs.controlSet === "modern") {
    return presetBindings("modern");
  }
  if (prefs.controlSet === "classic") {
    return presetBindings("classic");
  }
  return cloneBindings(prefs.keyBindings);
}

export function bindingsEqual(a: Readonly<KeyBindings>, b: Readonly<KeyBindings>): boolean {
  for (const { id } of KEY_ACTIONS) {
    if (a[id][0] !== b[id][0] || a[id][1] !== b[id][1]) {
      return false;
    }
  }
  return true;
}

/** True when two PlayerPreferences objects have identical settings and bindings. */
export function prefsEqual(
  a: Readonly<PlayerPreferences>,
  b: Readonly<PlayerPreferences>,
): boolean {
  return (
    a.controlSet === b.controlSet &&
    bindingsEqual(a.keyBindings, b.keyBindings) &&
    a.gameSize === b.gameSize &&
    a.rememberWindowPositions === b.rememberWindowPositions &&
    a.showDamageNumbers === b.showDamageNumbers &&
    a.sfxEnabled === b.sfxEnabled &&
    a.masterVolume === b.masterVolume &&
    a.combatVolume === b.combatVolume &&
    a.spellsVolume === b.spellsVolume &&
    a.worldVolume === b.worldVolume &&
    a.imChime === b.imChime &&
    a.friendLogonSound === b.friendLogonSound &&
    a.backgroundAudio === b.backgroundAudio &&
    a.chatTextSize === b.chatTextSize &&
    a.chatTimestamps === b.chatTimestamps &&
    a.showNpcChatter === b.showNpcChatter &&
    a.presenceChatLines === b.presenceChatLines &&
    a.imFrom === b.imFrom &&
    a.tradeFrom === b.tradeFrom &&
    a.guildInvitesFrom === b.guildInvitesFrom &&
    a.colorblindBars === b.colorblindBars &&
    a.largerHoverTips === b.largerHoverTips
  );
}

/** Non-social preference fields carried from pre-login / legacy browser storage into an uninitialized account. */
export function localSyncPatch(prefs: Readonly<PlayerPreferences>): PlayerPrefsPatch {
  return {
    controlSet: prefs.controlSet,
    keyBindings: cloneBindings(prefs.keyBindings),
    gameSize: prefs.gameSize,
    rememberWindowPositions: prefs.rememberWindowPositions,
    showDamageNumbers: prefs.showDamageNumbers,
    sfxEnabled: prefs.sfxEnabled,
    masterVolume: prefs.masterVolume,
    combatVolume: prefs.combatVolume,
    spellsVolume: prefs.spellsVolume,
    worldVolume: prefs.worldVolume,
    imChime: prefs.imChime,
    friendLogonSound: prefs.friendLogonSound,
    backgroundAudio: prefs.backgroundAudio,
    chatTextSize: prefs.chatTextSize,
    chatTimestamps: prefs.chatTimestamps,
    showNpcChatter: prefs.showNpcChatter,
    presenceChatLines: prefs.presenceChatLines,
    colorblindBars: prefs.colorblindBars,
    largerHoverTips: prefs.largerHoverTips,
  };
}

/** Default player preferences (Modern controls, 1.6-compatible defaults where noted). */
export function defaultPlayerPrefs(): PlayerPreferences {
  return {
    controlSet: "modern",
    keyBindings: presetBindings("modern"),

    gameSize: "fit",
    rememberWindowPositions: true,
    showDamageNumbers: true,

    sfxEnabled: true,
    masterVolume: 100,
    combatVolume: 100,
    spellsVolume: 100,
    worldVolume: 100,
    imChime: true,
    friendLogonSound: true,
    backgroundAudio: true,

    chatTextSize: "classic",
    chatTimestamps: false,
    showNpcChatter: true,
    presenceChatLines: "off",

    imFrom: "everyone",
    tradeFrom: "everyone",
    guildInvitesFrom: "everyone",

    colorblindBars: false,
    largerHoverTips: false,
  };
}

export interface RebindDisplacement {
  action: KeyAction;
  slot: 0 | 1;
  code: string;
}

/**
 * Assigns `code` (or null to unbind) to `action`'s `slot` (0 primary, 1 secondary). If `code` is
 * already bound elsewhere, it moves from that action/slot (leaving it unset) and reports it as
 * `displaced` so the UI can offer Undo. Reserved codes are ignored.
 */
export function rebindKey(
  bindings: Readonly<KeyBindings>,
  action: KeyAction,
  slot: 0 | 1,
  code: string | null,
): { next: KeyBindings; displaced: RebindDisplacement | null; rejected: boolean } {
  const next = cloneBindings(bindings);
  if (code === null) {
    next[action][slot] = null;
    return { next, displaced: null, rejected: false };
  }
  if (!isValidBindCode(code)) {
    return { next, displaced: null, rejected: true };
  }
  if (next[action][slot] === code) {
    return { next, displaced: null, rejected: false };
  }
  let displaced: RebindDisplacement | null = null;
  for (const { id } of KEY_ACTIONS) {
    for (const s of [0, 1] as const) {
      if (id === action && s === slot) {
        continue;
      }
      if (next[id][s] === code) {
        next[id][s] = null;
        displaced = { action: id, slot: s, code };
      }
    }
  }
  next[action][slot] = code;
  return { next, displaced, rejected: false };
}

/**
 * True when Ctrl is bound alongside W, T or N: in a browser, Ctrl+W/T/N closes or opens tabs and
 * windows and pages cannot block it.
 */
export function hasCtrlShortcutWarning(bindings: Readonly<KeyBindings>): boolean {
  let hasCtrl = false;
  let hasTabKey = false;
  for (const { id } of KEY_ACTIONS) {
    for (const code of bindings[id]) {
      if (code === "ControlLeft" || code === "ControlRight") {
        hasCtrl = true;
      } else if (code === "KeyW" || code === "KeyT" || code === "KeyN") {
        hasTabKey = true;
      }
    }
  }
  return hasCtrl && hasTabKey;
}

const KEY_LABELS: Readonly<Record<string, string>> = {
  Space: "Space",
  Tab: "Tab",
  Enter: "Enter",
  NumpadEnter: "Num Enter",
  Backspace: "Backspace",
  Delete: "Del",
  Insert: "Ins",
  Home: "Home",
  End: "End",
  PageUp: "PgUp",
  PageDown: "PgDn",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  ShiftLeft: "L Shift",
  ShiftRight: "R Shift",
  ControlLeft: "L Ctrl",
  ControlRight: "R Ctrl",
  AltLeft: "L Alt",
  AltRight: "R Alt",
  Slash: "/",
  Backslash: "\\",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Semicolon: ";",
  Quote: "'",
  Backquote: "`",
  Comma: ",",
  Period: ".",
  CapsLock: "Caps",
  NumpadAdd: "Num +",
  NumpadSubtract: "Num -",
  NumpadMultiply: "Num *",
  NumpadDivide: "Num /",
  NumpadDecimal: "Num .",
};

/** Readable label for a `KeyboardEvent.code`, or "" when unbound. */
export function formatKeyCode(code: string | null): string {
  if (!code) {
    return "";
  }
  const known = KEY_LABELS[code];
  if (known) {
    return known;
  }
  if (/^Key[A-Z]$/.test(code)) {
    return code.slice(3);
  }
  if (/^Digit[0-9]$/.test(code)) {
    return code.slice(5);
  }
  if (/^Numpad[0-9]$/.test(code)) {
    return `Num ${code.slice(6)}`;
  }
  return code;
}

/** First bound key label for an action (primary, falling back to secondary), or "" when unbound. */
export function primaryKeyLabel(bindings: Readonly<KeyBindings>, action: KeyAction): string {
  const [first, second] = bindings[action];
  return formatKeyCode(first ?? second);
}

/** Refusal lines for Social & privacy settings, matching 1.6/SSO chat tone. */
export const PRIVACY_TEXT = {
  imFriendsOnly: (name: string) => `${name} is only accepting instant messages from friends.`,
  tradeNone: (name: string) => `${name} is not accepting trade requests.`,
  tradeFriendsOnly: (name: string) => `${name} is only accepting trade requests from friends.`,
  guildNone: (name: string) => `${name} is not accepting guild invitations.`,
  guildFriendsOnly: (name: string) => `${name} is only accepting guild invitations from friends.`,
} as const;

const keyCodeSchema = z
  .string()
  .refine((v) => isValidBindCode(v), "Invalid or reserved key")
  .nullable();

const keySlotSchema = z.tuple([keyCodeSchema, keyCodeSchema]);

export const keyBindingsSchema = z.strictObject({
  moveUp: keySlotSchema,
  moveDown: keySlotSchema,
  moveLeft: keySlotSchema,
  moveRight: keySlotSchema,
  turn: keySlotSchema,
  attack: keySlotSchema,
  action: keySlotSchema,
  chat: keySlotSchema,
  commandChat: keySlotSchema,
  tabStats: keySlotSchema,
  tabInventory: keySlotSchema,
  tabSkills: keySlotSchema,
  tabSpellbook: keySlotSchema,
  windowFriends: keySlotSchema,
  windowWho: keySlotSchema,
});

const volumeSchema = z.number().int().min(0).max(100);

/** Strict schema for a partial or full preferences save from a client. */
export const playerPrefsPatchSchema = z.strictObject({
  controlSet: z.enum(["modern", "classic", "custom"]).optional(),
  keyBindings: keyBindingsSchema.optional(),
  gameSize: z.enum(["fit", "sharp"]).optional(),
  rememberWindowPositions: z.boolean().optional(),
  showDamageNumbers: z.boolean().optional(),
  sfxEnabled: z.boolean().optional(),
  masterVolume: volumeSchema.optional(),
  combatVolume: volumeSchema.optional(),
  spellsVolume: volumeSchema.optional(),
  worldVolume: volumeSchema.optional(),
  imChime: z.boolean().optional(),
  friendLogonSound: z.boolean().optional(),
  backgroundAudio: z.boolean().optional(),
  chatTextSize: z.enum(["small", "classic", "large"]).optional(),
  chatTimestamps: z.boolean().optional(),
  showNpcChatter: z.boolean().optional(),
  presenceChatLines: z.enum(["off", "friends", "everyone"]).optional(),
  imFrom: z.enum(["everyone", "friends"]).optional(),
  tradeFrom: z.enum(["everyone", "friends", "none"]).optional(),
  guildInvitesFrom: z.enum(["everyone", "friends", "none"]).optional(),
  colorblindBars: z.boolean().optional(),
  largerHoverTips: z.boolean().optional(),
});

export type PlayerPrefsPatch = z.infer<typeof playerPrefsPatchSchema>;

function clampVol(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v)
    ? Math.max(0, Math.min(100, Math.round(v)))
    : fallback;
}

function sanitizeBindings(raw: unknown, fallback: KeyBindings): KeyBindings {
  const out = cloneBindings(fallback);
  if (!raw || typeof raw !== "object") {
    return out;
  }
  const obj = raw as Record<string, unknown>;
  const used = new Set<string>();
  for (const { id } of KEY_ACTIONS) {
    const slot = obj[id];
    if (!Array.isArray(slot)) {
      continue;
    }
    const clean = (v: unknown): string | null => {
      if (v === null || v === undefined) {
        return null;
      }
      if (!isValidBindCode(v) || used.has(v)) {
        return null;
      }
      used.add(v);
      return v;
    };
    out[id] = [clean(slot[0]), clean(slot[1])];
  }
  return out;
}

/**
 * Merges a stored or partial JSON object over defaults. Safe against missing keys (schema
 * evolution) and invalid values.
 */
export function mergePlayerPrefs(
  raw: unknown,
  base: PlayerPreferences = defaultPlayerPrefs(),
): PlayerPreferences {
  const out: PlayerPreferences = { ...base, keyBindings: cloneBindings(base.keyBindings) };
  if (!raw || typeof raw !== "object") {
    return out;
  }
  const r = raw as Record<string, unknown>;
  if (r.controlSet === "modern" || r.controlSet === "classic" || r.controlSet === "custom") {
    out.controlSet = r.controlSet;
  }
  if (r.keyBindings !== undefined) {
    const fallback =
      out.controlSet === "classic" ? presetBindings("classic") : presetBindings("modern");
    out.keyBindings = sanitizeBindings(r.keyBindings, fallback);
  }
  if (r.gameSize === "fit" || r.gameSize === "sharp") {
    out.gameSize = r.gameSize;
  }
  if (typeof r.rememberWindowPositions === "boolean") {
    out.rememberWindowPositions = r.rememberWindowPositions;
  }
  if (typeof r.showDamageNumbers === "boolean") {
    out.showDamageNumbers = r.showDamageNumbers;
  }
  if (typeof r.sfxEnabled === "boolean") {
    out.sfxEnabled = r.sfxEnabled;
  }
  out.masterVolume = clampVol(r.masterVolume, out.masterVolume);
  out.combatVolume = clampVol(r.combatVolume, out.combatVolume);
  out.spellsVolume = clampVol(r.spellsVolume, out.spellsVolume);
  out.worldVolume = clampVol(r.worldVolume, out.worldVolume);
  if (typeof r.imChime === "boolean") {
    out.imChime = r.imChime;
  }
  if (typeof r.friendLogonSound === "boolean") {
    out.friendLogonSound = r.friendLogonSound;
  }
  if (typeof r.backgroundAudio === "boolean") {
    out.backgroundAudio = r.backgroundAudio;
  }
  if (r.chatTextSize === "small" || r.chatTextSize === "classic" || r.chatTextSize === "large") {
    out.chatTextSize = r.chatTextSize;
  }
  if (typeof r.chatTimestamps === "boolean") {
    out.chatTimestamps = r.chatTimestamps;
  }
  if (typeof r.showNpcChatter === "boolean") {
    out.showNpcChatter = r.showNpcChatter;
  }
  if (
    r.presenceChatLines === "off" ||
    r.presenceChatLines === "friends" ||
    r.presenceChatLines === "everyone"
  ) {
    out.presenceChatLines = r.presenceChatLines;
  }
  if (r.imFrom === "everyone" || r.imFrom === "friends") {
    out.imFrom = r.imFrom;
  }
  if (r.tradeFrom === "everyone" || r.tradeFrom === "friends" || r.tradeFrom === "none") {
    out.tradeFrom = r.tradeFrom;
  }
  if (
    r.guildInvitesFrom === "everyone" ||
    r.guildInvitesFrom === "friends" ||
    r.guildInvitesFrom === "none"
  ) {
    out.guildInvitesFrom = r.guildInvitesFrom;
  }
  if (typeof r.colorblindBars === "boolean") {
    out.colorblindBars = r.colorblindBars;
  }
  if (typeof r.largerHoverTips === "boolean") {
    out.largerHoverTips = r.largerHoverTips;
  }
  return out;
}
