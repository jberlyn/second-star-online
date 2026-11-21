/**
 * The Player Settings window (issue #21): same layout and style as Server Settings (`settings.ts`),
 * with six pages (Controls, Display, Sound, Chat, Social & privacy, Accessibility), search across
 * every option and keybind, per-option descriptions, Save & Revert, and unsaved-changes prompts.
 *
 * Settings save per account on the server while logged in, and cache locally for pre-login screens
 * (title, login and creation). On pre-login screens Social & privacy shows a login notice.
 */
import {
  bindingsEqual,
  type ControlSet,
  cloneBindings,
  defaultPlayerPrefs,
  effectiveBindings,
  formatKeyCode,
  hasCtrlShortcutWarning,
  IGNORE_ADD_MAX,
  isValidBindCode,
  KEY_ACTIONS,
  type KeyAction,
  type KeyActionGroup,
  type KeyBindings,
  mergePlayerPrefs,
  type PlayerPreferences,
  type PlayerPrefsPatch,
  presetBindings,
  RESERVED_KEY_CODES,
  type RebindDisplacement,
  rebindKey,
  stripReturns,
} from "@secondstaronline/shared";

import { action, gameInput } from "./action.ts";
import { SETTINGS_SIZE } from "./settings.ts";
import type { GameWindow, WindowLayer } from "./window.ts";

export type PlayerSettingsPageId =
  | "controls"
  | "display"
  | "sound"
  | "chat"
  | "social"
  | "accessibility";

export interface PlayerSettingsActions {
  /** Save the current page's changed values (applied immediately; persisted to server when logged in). */
  save(patch: PlayerPrefsPatch, requestId: number): void;
  /** Add an entry to the account's ignore list (applied live, as `/ignore`). */
  ignoreAdd(name: string): void;
  /** Remove an entry from the account's ignore list (applied live, as `/unignore`). */
  ignoreRemove(name: string): void;
  /** Called right before entering key-capture mode so held gameplay keys can be released. */
  onCaptureStart?(): void;
}

export interface PlayerSettingsWindow {
  window: GameWindow;
  /** True while a keybind button is listening for the player's next keypress. */
  isCapturing(): boolean;
  /** True while the unsaved-changes confirmation dialog is visible. */
  isConfirmOpen(): boolean;
  /** Opens the window (or raises it without discarding edits if already open). */
  open(prefs: PlayerPreferences, ignores: readonly string[], loggedIn: boolean): void;
  /** Updates the saved baseline (after login/update); preserves any unsaved edits on the open page. */
  sync(prefs: PlayerPreferences, ignores: readonly string[], loggedIn: boolean): void;
  /** Updates the ignore list live (from `/ignore`, `/unignore`, or Settings ignore controls). */
  setIgnores(list: readonly string[], statusText?: string, ok?: boolean): void;
  /** Server (or local) reply to Save. */
  saveResult(ok: boolean, text: string, requestId?: number, serverPrefs?: PlayerPreferences): void;
  /** Removes global key-capture listeners when the app stops. */
  dispose(): void;
  readonly page: PlayerSettingsPageId;
}

interface PageMeta {
  readonly id: PlayerSettingsPageId;
  readonly title: string;
  readonly intro: string;
}

export const PLAYER_SETTINGS_PAGES: readonly PageMeta[] = [
  {
    id: "controls",
    title: "Controls",
    intro: "Choose Modern, Classic 1.6 or Custom controls and bind keys for actions and windows.",
  },
  {
    id: "display",
    title: "Display",
    intro: "Scaling, floating windows and combat numbers.",
  },
  {
    id: "sound",
    title: "Sound",
    intro: "Master and category volumes, notification chimes and background tab audio.",
  },
  {
    id: "chat",
    title: "Chat",
    intro: "Chat text size, timestamps, NPC chatter and logon/logoff lines.",
  },
  {
    id: "social",
    title: "Social & privacy",
    intro: "Who may message, trade or invite you, plus your account ignore list.",
  },
  {
    id: "accessibility",
    title: "Accessibility",
    intro: "High-contrast health and spell bars and larger hover tips.",
  },
];

type SimplePrefKey = Exclude<keyof PlayerPreferences, "controlSet" | "keyBindings">;

interface ChoiceItem {
  readonly value: string;
  readonly label: string;
}

interface OptionDef {
  readonly key: SimplePrefKey;
  readonly page: Exclude<PlayerSettingsPageId, "controls">;
  readonly label: string;
  readonly help: string;
  readonly kind: "bool" | "choice" | "range";
  readonly choices?: readonly ChoiceItem[];
}

export const PLAYER_OPTION_DEFS: readonly OptionDef[] = [
  // Display
  {
    key: "gameSize",
    page: "display",
    label: "Game size",
    help: "Fit window scales smoothly to fill your window. Whole pixels only uses crisp integer scaling.",
    kind: "choice",
    choices: [
      { value: "fit", label: "Fit window" },
      { value: "sharp", label: "Whole pixels only" },
    ],
  },
  {
    key: "rememberWindowPositions",
    page: "display",
    label: "Remember floating window positions",
    help: "Reopen floating windows (Friend's List, Who's Online, IMs) where you dragged them on this browser.",
    kind: "bool",
  },
  {
    key: "showDamageNumbers",
    page: "display",
    label: "Show damage numbers",
    help: "Display floating damage numbers and combat text over players and monsters.",
    kind: "bool",
  },

  // Sound
  {
    key: "sfxEnabled",
    page: "sound",
    label: "Sound effects",
    help: "Turn all game sound effects and chimes on or off.",
    kind: "bool",
  },
  {
    key: "masterVolume",
    page: "sound",
    label: "Master volume",
    help: "Overall loudness for every sound in the game.",
    kind: "range",
  },
  {
    key: "combatVolume",
    page: "sound",
    label: "Combat volume",
    help: "Weapon swings, melee and PvP hits, monster kills and cannon fire.",
    kind: "range",
  },
  {
    key: "spellsVolume",
    page: "sound",
    label: "Spells volume",
    help: "Spell casts, impacts, heals and spell kills.",
    kind: "range",
  },
  {
    key: "worldVolume",
    page: "sound",
    label: "World volume",
    help: "Interface clicks, shops, crafting, gathering, casino tables, church bell and chimes.",
    kind: "range",
  },
  {
    key: "imChime",
    page: "sound",
    label: "Instant message chime",
    help: "Play a gentle chime when another player sends you an instant message.",
    kind: "bool",
  },
  {
    key: "friendLogonSound",
    page: "sound",
    label: "Friend logon sound",
    help: "Play a soft chime when someone on your Friend's List logs on.",
    kind: "bool",
  },
  {
    key: "backgroundAudio",
    page: "sound",
    label: "Play sound in background tab",
    help: "Keep playing game sounds and chimes while this browser tab is in the background.",
    kind: "bool",
  },

  // Chat
  {
    key: "chatTextSize",
    page: "chat",
    label: "Text size",
    help: "Font size of lines in the main chat log. Classic matches 1.6's Arial 12.",
    kind: "choice",
    choices: [
      { value: "small", label: "Small" },
      { value: "classic", label: "Classic (Arial 12)" },
      { value: "large", label: "Large" },
    ],
  },
  {
    key: "chatTimestamps",
    page: "chat",
    label: "Timestamps",
    help: "Show the local time ([HH:MM]) before each line in the main chat log.",
    kind: "bool",
  },
  {
    key: "showNpcChatter",
    page: "chat",
    label: "Show NPC chatter",
    help: "Show ambient NPC dialogue lines on your map. Shop, bank and quest replies always show.",
    kind: "bool",
  },
  {
    key: "presenceChatLines",
    page: "chat",
    label: "Logon and logoff lines",
    help: 'Print "<name> has logged on." and "<name> has logged off." in chat. Off matches 1.6.',
    kind: "choice",
    choices: [
      { value: "off", label: "Off" },
      { value: "friends", label: "Friends only" },
      { value: "everyone", label: "Everyone" },
    ],
  },

  // Social & privacy
  {
    key: "imFrom",
    page: "social",
    label: "Instant messages from",
    help: "Who can send you instant messages. Staff can always message you.",
    kind: "choice",
    choices: [
      { value: "everyone", label: "Everyone" },
      { value: "friends", label: "Friends only" },
    ],
  },
  {
    key: "tradeFrom",
    page: "social",
    label: "Trade requests from",
    help: "Who can open a trade window with you. Refused requesters are told in chat.",
    kind: "choice",
    choices: [
      { value: "everyone", label: "Everyone" },
      { value: "friends", label: "Friends only" },
      { value: "none", label: "No one" },
    ],
  },
  {
    key: "guildInvitesFrom",
    page: "social",
    label: "Guild invitations from",
    help: "Who can invite you to a guild with /invite. Refused leaders are told in chat.",
    kind: "choice",
    choices: [
      { value: "everyone", label: "Everyone" },
      { value: "friends", label: "Friends only" },
      { value: "none", label: "No one" },
    ],
  },

  // Accessibility
  {
    key: "colorblindBars",
    page: "accessibility",
    label: "Colour-blind health & spell bars",
    help: "Use high-contrast amber/gold (HP) and sky-cyan (SP) bars instead of 1.6's dark red and blue fills.",
    kind: "bool",
  },
  {
    key: "largerHoverTips",
    page: "accessibility",
    label: "Larger hover tips",
    help: "Increase the text size and padding of hover tooltips over the playfield and panel.",
    kind: "bool",
  },
];

const DEFAULTS = defaultPlayerPrefs();

const GROUP_TITLES: Readonly<Record<KeyActionGroup, string>> = {
  movement: "Movement & combat",
  chat: "Chat",
  windows: "Windows & panel tabs",
};

interface SearchEntry {
  readonly id: string;
  readonly page: PlayerSettingsPageId;
  readonly label: string;
  readonly help: string;
}

const SEARCH_ENTRIES: readonly SearchEntry[] = [
  {
    id: "controlSet",
    page: "controls",
    label: "Control set",
    help: "Modern (WASD, Space, E, Shift), Classic (1.6: Arrows, Tab, Ctrl, Alt), or Custom key bindings.",
  },
  ...KEY_ACTIONS.map((a) => ({
    id: `bind:${a.id}`,
    page: "controls" as const,
    label: a.label,
    help: a.help,
  })),
  ...PLAYER_OPTION_DEFS.map((d) => ({
    id: d.key,
    page: d.page,
    label: d.label,
    help: d.help,
  })),
  {
    id: "ignore-list",
    page: "social",
    label: "Ignore list",
    help: "View, add or remove ignored players (the same account list /ignore uses).",
  },
];

function optionValueText(d: OptionDef, v: unknown): string {
  if (d.kind === "bool") {
    return v === true ? "on" : "off";
  }
  if (d.kind === "range") {
    return `${Number(v)}%`;
  }
  return d.choices?.find((c) => c.value === v)?.label ?? String(v);
}

const pageTitle = (id: PlayerSettingsPageId) =>
  PLAYER_SETTINGS_PAGES.find((p) => p.id === id)?.title ?? "";

const pageIntro = (id: PlayerSettingsPageId) =>
  PLAYER_SETTINGS_PAGES.find((p) => p.id === id)?.intro ?? "";

const matches = (entry: SearchEntry, q: string) => {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return false;
  }
  const hay = `${entry.label} ${entry.help} ${pageTitle(entry.page)}`.toLowerCase();
  return words.every((w) => hay.includes(w));
};

const makeButton = (id: string, cls: string, label: string, onClick: () => void) => {
  const b = action(document.createElement("button"), id);
  b.type = "button";
  b.className = `settings-btn ${cls}`;
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
};

interface SimpleRowState {
  def: OptionDef;
  el: HTMLElement;
  read(): unknown;
  write(v: unknown): void;
  refresh(): void;
  focus(): void;
  setDisabled(off: boolean): void;
}

export function createPlayerSettingsWindow(
  layer: WindowLayer,
  actions: PlayerSettingsActions,
): PlayerSettingsWindow {
  const stage = document.createElement("div");
  stage.className = "settings player-settings";

  const nav = document.createElement("nav");
  nav.className = "settings-nav";
  nav.setAttribute("aria-label", "Player settings pages");

  const search = gameInput("player-settings-search");
  search.type = "search";
  search.className = "settings-search";
  search.placeholder = "Search settings";
  search.setAttribute("aria-label", "Search settings");
  search.spellcheck = false;

  const links = document.createElement("div");
  links.className = "settings-links";
  nav.append(search, links);

  const pane = document.createElement("div");
  pane.className = "settings-pane";

  const title = document.createElement("h2");
  title.className = "settings-title";

  const intro = document.createElement("p");
  intro.className = "settings-intro";

  const list = document.createElement("div");
  list.className = "settings-list";

  const results = document.createElement("div");
  results.className = "settings-results";
  results.hidden = true;

  const footer = document.createElement("div");
  footer.className = "settings-footer";

  const status = document.createElement("span");
  status.className = "settings-status";
  status.setAttribute("role", "status");

  // ---- unsaved changes confirmation overlay ----
  const confirm = document.createElement("div");
  confirm.className = "settings-confirm";
  confirm.hidden = true;
  const confirmBox = action(document.createElement("div"), "player-settings-confirm");
  confirmBox.className = "settings-confirm-box";
  confirmBox.setAttribute("aria-modal", "true");
  const confirmText = document.createElement("p");
  confirmText.id = "player-settings-confirm-text";
  confirmBox.setAttribute("aria-labelledby", confirmText.id);
  let pendingLeave: (() => void) | null = null;
  const closeConfirm = () => {
    confirm.hidden = true;
    confirmBox.removeAttribute("role");
    pendingLeave = null;
  };
  const stay = makeButton("player-settings-stay", "settings-stay", "Keep editing", () => {
    closeConfirm();
    search.focus();
  });
  const discard = makeButton(
    "player-settings-discard",
    "settings-discard",
    "Discard changes",
    () => {
      const go = pendingLeave;
      closeConfirm();
      go?.();
    },
  );
  confirmBox.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      stay.click();
    } else if (e.key === "Tab") {
      e.preventDefault();
      (document.activeElement === stay ? discard : stay).focus();
    }
  });
  const confirmButtons = document.createElement("div");
  confirmButtons.className = "settings-confirm-buttons";
  confirmButtons.append(stay, discard);
  confirmBox.append(confirmText, confirmButtons);
  confirm.append(confirmBox);

  // ---- state ----
  let saved: PlayerPreferences = defaultPlayerPrefs();
  let ignores: string[] = [];
  let loggedIn = false;
  let current: PlayerSettingsPageId = "controls";

  // Draft state for simple rows on the open page.
  const simpleRows: SimpleRowState[] = [];

  // Draft state for Controls page.
  let draftControlSet: ControlSet = saved.controlSet;
  let draftBindings: KeyBindings = effectiveBindings(saved);
  let capture: { action: KeyAction; slot: 0 | 1; button: HTMLButtonElement } | null = null;
  let undoState: {
    beforeSet: ControlSet;
    beforeBindings: KeyBindings;
    text: string;
  } | null = null;
  let controlsRowEls = new Map<string, HTMLElement>();
  let ignoreListEl: HTMLElement | null = null;
  let ignoreSectionEl: HTMLElement | null = null;
  let nextReqId = 0;
  let pendingSave: { id: number; before: PlayerPreferences } | null = null;

  const stopCapture = () => {
    if (!capture) {
      return;
    }
    capture.button.classList.remove("listening");
    const curCode = draftBindings[capture.action][capture.slot];
    capture.button.textContent = formatKeyCode(curCode) || "Unset";
    capture = null;
  };

  const onCaptureKeyDown = (e: KeyboardEvent) => {
    if (!capture) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (e.isComposing || e.repeat) {
      return;
    }
    const target = capture;
    if (e.key === "Escape" || e.code === "Escape") {
      stopCapture();
      return;
    }
    const code = e.code;
    if (!code) {
      stopCapture();
      setStatus("That key cannot be bound.", "error");
      return;
    }
    if (RESERVED_KEY_CODES.has(code) || e.key === "Meta" || !isValidBindCode(code)) {
      stopCapture();
      setStatus("That key is reserved and cannot be bound.", "error");
      return;
    }
    const beforeSet = draftControlSet;
    const beforeBindings = cloneBindings(draftBindings);
    const res = rebindKey(draftBindings, target.action, target.slot, code);
    stopCapture();
    if (res.rejected) {
      setStatus("That key cannot be bound.", "error");
      return;
    }
    draftBindings = res.next;
    draftControlSet = "custom";
    if (res.displaced) {
      const displacedMeta = KEY_ACTIONS.find((a) => a.id === res.displaced?.action);
      undoState = {
        beforeSet,
        beforeBindings,
        text: `Moved ${formatKeyCode(res.displaced.code)} from ${displacedMeta?.label ?? res.displaced.action} (left unset).`,
      };
    } else {
      undoState = null;
    }
    renderControls();
  };
  const onCaptureBlur = () => stopCapture();
  const onCapturePointerDown = (e: PointerEvent) => {
    if (!capture) {
      return;
    }
    const t = e.target;
    if (t instanceof Node && capture.button.contains(t)) {
      return;
    }
    stopCapture();
  };
  window.addEventListener("keydown", onCaptureKeyDown, true);
  window.addEventListener("blur", onCaptureBlur);
  window.addEventListener("pointerdown", onCapturePointerDown, true);

  const setStatus = (text: string, kind: "normal" | "ok" | "error") => {
    status.textContent = text;
    status.classList.toggle("settings-status-ok", kind === "ok");
    status.classList.toggle("settings-status-error", kind === "error");
  };

  const countUnsaved = (): number => {
    if (current === "controls") {
      const savedEffective = effectiveBindings(saved);
      let n = draftControlSet !== saved.controlSet ? 1 : 0;
      for (const { id } of KEY_ACTIONS) {
        if (
          draftBindings[id][0] !== savedEffective[id][0] ||
          draftBindings[id][1] !== savedEffective[id][1]
        ) {
          n += 1;
        }
      }
      return n;
    }
    return simpleRows.filter((r) => r.read() !== saved[r.def.key]).length;
  };

  const updateFooterAndDots = () => {
    const n = countUnsaved();
    setStatus(
      n === 0 ? "No unsaved changes" : `${n} unsaved change${n === 1 ? "" : "s"}`,
      "normal",
    );
    for (const a of links.children) {
      const el = a as HTMLElement;
      el.classList.toggle("settings-changed", n > 0 && el.dataset.page === current);
    }
  };

  // ---- Controls page renderer ----
  const renderControls = () => {
    stopCapture();
    controlsRowEls = new Map();
    const frag = document.createDocumentFragment();
    const savedEffective = effectiveBindings(saved);

    // 1. Control set selector row
    const setRow = document.createElement("div");
    setRow.className = "settings-row settings-kind-choice";
    setRow.dataset.key = "controlSet";
    setRow.classList.toggle("settings-changed", draftControlSet !== saved.controlSet);
    controlsRowEls.set("controlSet", setRow);

    const setLabel = document.createElement("label");
    setLabel.className = "settings-label";
    const setDot = document.createElement("span");
    setDot.className = "settings-dot";
    setDot.setAttribute("aria-hidden", "true");
    const setName = document.createElement("span");
    setName.textContent = "Control set";
    setLabel.append(setDot, setName);

    const sel = action(document.createElement("select"), "player-settings-control-set");
    sel.className = "settings-choice";
    sel.setAttribute("aria-label", "Control set");
    const presets: { value: ControlSet; label: string }[] = [
      { value: "modern", label: "Modern (WASD, Space, E, Shift)" },
      { value: "classic", label: "Classic (1.6: Arrows, Tab, Ctrl, Alt)" },
      { value: "custom", label: "Custom" },
    ];
    for (const p of presets) {
      const opt = document.createElement("option");
      opt.value = p.value;
      opt.textContent = p.label;
      sel.append(opt);
    }
    sel.value = draftControlSet;
    sel.addEventListener("change", () => {
      const next = sel.value as ControlSet;
      draftControlSet = next;
      undoState = null;
      if (next === "modern" || next === "classic") {
        draftBindings = presetBindings(next);
      } else {
        draftBindings = cloneBindings(draftBindings);
      }
      renderControls();
    });

    const setCtrl = document.createElement("div");
    setCtrl.className = "settings-control";
    setCtrl.append(sel);
    const setHead = document.createElement("div");
    setHead.className = "settings-head";
    setHead.append(setLabel, setCtrl);

    const setHelp = document.createElement("p");
    setHelp.className = "settings-help";
    setHelp.textContent =
      "Modern puts movement and actions on the left hand with panel hotkeys. Classic matches First Star Online 1.6 exactly. Rebinding any key switches to Custom.";

    const setReset = action(document.createElement("button"), "player-settings-reset");
    setReset.type = "button";
    setReset.className = "settings-reset";
    setReset.textContent = "Reset to default (Modern)";
    setReset.hidden =
      draftControlSet === "modern" && bindingsEqual(draftBindings, presetBindings("modern"));
    setReset.addEventListener("click", () => {
      draftControlSet = "modern";
      draftBindings = presetBindings("modern");
      undoState = null;
      renderControls();
    });

    setRow.append(setHead, setHelp, setReset);
    frag.append(setRow);

    // 2. Soft Ctrl+W/T/N browser shortcut warning
    if (hasCtrlShortcutWarning(draftBindings)) {
      const warn = document.createElement("div");
      warn.className = "pset-warning";
      warn.setAttribute("role", "alert");
      warn.textContent =
        "Ctrl is bound alongside W, T or N. In a browser, Ctrl+W, Ctrl+T and Ctrl+N close or open tabs and windows and the game cannot block them.";
      frag.append(warn);
    }

    // 3. Undo banner after a conflict steal
    if (undoState) {
      const banner = document.createElement("div");
      banner.className = "pset-undo-banner";
      banner.setAttribute("role", "status");
      const msg = document.createElement("span");
      msg.textContent = undoState.text;
      const undoBtn = action(document.createElement("button"), "player-settings-undo");
      undoBtn.type = "button";
      undoBtn.className = "settings-reset pset-undo-btn";
      undoBtn.textContent = "Undo";
      const snap = undoState;
      undoBtn.addEventListener("click", () => {
        draftControlSet = snap.beforeSet;
        draftBindings = cloneBindings(snap.beforeBindings);
        undoState = null;
        renderControls();
      });
      banner.append(msg, undoBtn);
      frag.append(banner);
    }

    // 4. Keybinding rows grouped cleanly
    const referenceDefaults =
      draftControlSet === "classic" ? presetBindings("classic") : presetBindings("modern");
    for (const group of ["movement", "chat", "windows"] as const) {
      const heading = document.createElement("h3");
      heading.className = "pset-group-title";
      heading.textContent = GROUP_TITLES[group];
      frag.append(heading);

      for (const meta of KEY_ACTIONS) {
        if (meta.group !== group) {
          continue;
        }
        const row = document.createElement("div");
        row.className = "settings-row pset-bind-row";
        row.dataset.key = `bind:${meta.id}`;
        const slot = draftBindings[meta.id];
        const savedSlot = savedEffective[meta.id];
        const changed = slot[0] !== savedSlot[0] || slot[1] !== savedSlot[1];
        row.classList.toggle("settings-changed", changed);
        controlsRowEls.set(`bind:${meta.id}`, row);

        const label = document.createElement("div");
        label.className = "settings-label";
        const dot = document.createElement("span");
        dot.className = "settings-dot";
        dot.setAttribute("aria-hidden", "true");
        const name = document.createElement("span");
        name.textContent = meta.label;
        label.append(dot, name);

        const ctrl = document.createElement("div");
        ctrl.className = "settings-control pset-key-slots";
        for (const s of [0, 1] as const) {
          const code = slot[s];
          const pair = document.createElement("span");
          pair.className = "pset-key-pair";
          const btn = action(document.createElement("button"), "player-settings-bind");
          btn.type = "button";
          btn.className = "pset-key-btn";
          btn.dataset.bind = meta.id;
          btn.dataset.slot = String(s);
          btn.textContent = formatKeyCode(code) || "Unset";
          btn.classList.toggle("unset", code === null);
          btn.setAttribute(
            "aria-label",
            `${meta.label} ${s === 0 ? "primary" : "secondary"} key: ${formatKeyCode(code) || "Unset"}`,
          );
          btn.addEventListener("click", () => {
            if (capture && capture.button === btn) {
              stopCapture();
              return;
            }
            stopCapture();
            actions.onCaptureStart?.();
            capture = { action: meta.id, slot: s, button: btn };
            btn.classList.add("listening");
            btn.textContent = "Press a key…";
          });
          const clr = action(document.createElement("button"), "player-settings-unbind");
          clr.type = "button";
          clr.className = "pset-key-clear";
          clr.textContent = "×";
          clr.title = "Clear key";
          clr.setAttribute(
            "aria-label",
            `Clear ${meta.label} ${s === 0 ? "primary" : "secondary"} key`,
          );
          clr.hidden = code === null;
          clr.addEventListener("click", () => {
            stopCapture();
            const res = rebindKey(draftBindings, meta.id, s, null);
            draftBindings = res.next;
            draftControlSet = "custom";
            undoState = null;
            renderControls();
          });
          pair.append(btn, clr);
          ctrl.append(pair);
        }

        const head = document.createElement("div");
        head.className = "settings-head";
        head.append(label, ctrl);

        const help = document.createElement("p");
        help.className = "settings-help";
        help.textContent = meta.help;

        const defSlot = referenceDefaults[meta.id];
        const differsDefault = slot[0] !== defSlot[0] || slot[1] !== defSlot[1];
        const reset = action(document.createElement("button"), "player-settings-reset");
        reset.type = "button";
        reset.className = "settings-reset";
        const defText = [formatKeyCode(defSlot[0]), formatKeyCode(defSlot[1])]
          .filter(Boolean)
          .join(", ");
        reset.textContent = `Reset to default (${defText || "Unset"})`;
        reset.hidden = !differsDefault;
        reset.addEventListener("click", () => {
          stopCapture();
          const beforeSet = draftControlSet;
          const beforeBindings = cloneBindings(draftBindings);
          const displaced: RebindDisplacement[] = [];
          const r0 = rebindKey(draftBindings, meta.id, 0, defSlot[0]);
          if (r0.displaced && r0.displaced.action !== meta.id) {
            displaced.push(r0.displaced);
          }
          const r1 = rebindKey(r0.next, meta.id, 1, defSlot[1]);
          if (r1.displaced && r1.displaced.action !== meta.id) {
            displaced.push(r1.displaced);
          }
          draftBindings = r1.next;
          draftControlSet = "custom";
          if (displaced.length > 0) {
            const parts = displaced.map((d) => {
              const otherMeta = KEY_ACTIONS.find((a) => a.id === d.action);
              return `${formatKeyCode(d.code)} from ${otherMeta?.label ?? d.action}`;
            });
            undoState = {
              beforeSet,
              beforeBindings,
              text: `Moved ${parts.join(" and ")} (left unset).`,
            };
          } else {
            undoState = null;
          }
          renderControls();
        });

        row.append(head, help, reset);
        frag.append(row);
      }
    }

    list.replaceChildren(frag);
    updateFooterAndDots();
  };

  // ---- Simple row builder ----
  const createSimpleRow = (def: OptionDef): SimpleRowState => {
    const row = document.createElement("div");
    row.className = `settings-row settings-kind-${def.kind}`;
    row.dataset.key = def.key;

    const label = document.createElement("label");
    label.className = "settings-label";
    const dot = document.createElement("span");
    dot.className = "settings-dot";
    dot.setAttribute("aria-hidden", "true");
    const name = document.createElement("span");
    name.textContent = def.label;
    label.append(dot, name);

    const control = document.createElement("div");
    control.className = "settings-control";

    const help = document.createElement("p");
    help.className = "settings-help";
    help.textContent = def.help;

    const defVal = DEFAULTS[def.key];
    const reset = action(document.createElement("button"), "player-settings-reset");
    reset.type = "button";
    reset.className = "settings-reset";
    reset.textContent = `Reset to default (${optionValueText(def, defVal)})`;

    let read: () => unknown = () => saved[def.key];
    let write: (v: unknown) => void = () => {};
    let focusEl: HTMLElement = row;
    let disableEl: HTMLInputElement | HTMLSelectElement | null = null;

    if (def.kind === "bool") {
      const box = gameInput("player-settings-value");
      box.type = "checkbox";
      box.className = "settings-check";
      box.setAttribute("aria-label", def.label);
      read = () => box.checked;
      write = (v) => {
        box.checked = v === true;
      };
      focusEl = box;
      disableEl = box;
      control.append(box);
    } else if (def.kind === "choice") {
      const sel = action(document.createElement("select"), "player-settings-value");
      sel.className = "settings-choice";
      sel.setAttribute("aria-label", def.label);
      for (const c of def.choices ?? []) {
        const opt = document.createElement("option");
        opt.value = c.value;
        opt.textContent = c.label;
        sel.append(opt);
      }
      read = () => sel.value;
      write = (v) => {
        sel.value = String(v);
      };
      focusEl = sel;
      disableEl = sel;
      control.append(sel);
    } else {
      const slider = gameInput("player-settings-value");
      slider.type = "range";
      slider.min = "0";
      slider.max = "100";
      slider.step = "1";
      slider.className = "pset-range";
      slider.setAttribute("aria-label", def.label);
      const val = document.createElement("span");
      val.className = "pset-range-val";
      read = () => Number(slider.value);
      write = (v) => {
        const n = Math.max(0, Math.min(100, Math.round(Number(v))));
        slider.value = String(n);
        val.textContent = `${n}%`;
      };
      slider.addEventListener("input", () => {
        val.textContent = `${slider.value}%`;
      });
      focusEl = slider;
      disableEl = slider;
      control.append(slider, val);
    }

    const head = document.createElement("div");
    head.className = "settings-head";
    head.append(label, control);
    row.append(head, help, reset);

    const refresh = () => {
      const cur = read();
      row.classList.toggle("settings-changed", cur !== saved[def.key]);
      reset.hidden = cur === defVal;
    };
    const onInput = () => {
      refresh();
      updateFooterAndDots();
    };
    disableEl?.addEventListener("input", onInput);
    disableEl?.addEventListener("change", onInput);
    reset.addEventListener("click", () => {
      write(defVal);
      onInput();
    });

    write(saved[def.key]);
    refresh();

    return {
      def,
      el: row,
      read,
      write,
      refresh,
      focus() {
        row.scrollIntoView?.({ block: "nearest" });
        focusEl.focus();
      },
      setDisabled(off) {
        if (disableEl) {
          disableEl.disabled = off;
        }
        reset.disabled = off;
      },
    };
  };

  // ---- Ignore list section (Social & privacy) ----
  const renderIgnoreRows = () => {
    if (!ignoreListEl) {
      return;
    }
    if (ignores.length === 0) {
      const none = document.createElement("p");
      none.className = "settings-none";
      none.textContent = "Your ignore list is empty.";
      ignoreListEl.replaceChildren(none);
      return;
    }
    ignoreListEl.replaceChildren(
      ...ignores.map((entry) => {
        const row = document.createElement("div");
        row.className = "staff-row pset-ignore-row";
        row.setAttribute("role", "listitem");
        const name = document.createElement("span");
        name.className = "staff-row-name";
        name.textContent = entry;
        const rm = makeButton("player-settings-ignore-remove", "roles-delete", "Remove", () => {
          actions.ignoreRemove(entry);
        });
        rm.disabled = !loggedIn;
        rm.setAttribute("aria-label", `Unignore ${entry}`);
        row.append(name, rm);
        return row;
      }),
    );
  };

  const buildIgnoreSection = (): HTMLElement => {
    const sec = document.createElement("div");
    sec.className = "settings-row pset-ignore";
    sec.dataset.key = "ignore-list";

    const heading = document.createElement("h3");
    heading.className = "pset-group-title";
    heading.textContent = "Ignore list";

    const help = document.createElement("p");
    help.className = "settings-help";
    help.textContent =
      "Ignored players' local chat, broadcasts, guild chat and instant messages are hidden. Changes apply immediately and match /ignore.";

    const addBar = document.createElement("div");
    addBar.className = "staff-add pset-ignore-add";
    const input = gameInput("player-settings-ignore-name");
    input.className = "staff-name";
    input.placeholder = "Player name";
    input.maxLength = IGNORE_ADD_MAX;
    input.spellcheck = false;
    input.disabled = !loggedIn;
    input.setAttribute("aria-label", "Player name to ignore");
    const addBtn = makeButton("player-settings-ignore-add", "settings-save", "Ignore", () => {
      if (!loggedIn) {
        return;
      }
      const name = stripReturns(input.value).trim();
      if (name === "") {
        setStatus("Enter a player name.", "error");
        return;
      }
      if (name.length > IGNORE_ADD_MAX) {
        setStatus(`Names can be at most ${IGNORE_ADD_MAX} characters.`, "error");
        return;
      }
      actions.ignoreAdd(name);
      input.value = "";
    });
    addBtn.disabled = !loggedIn;
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addBtn.click();
      }
    });
    addBar.append(input, addBtn);

    const listEl = document.createElement("div");
    listEl.className = "staff-list pset-ignore-list";
    listEl.setAttribute("role", "list");
    ignoreListEl = listEl;
    renderIgnoreRows();

    sec.append(heading, help, addBar, listEl);
    return sec;
  };

  // ---- Page render ----
  const renderPage = (id: PlayerSettingsPageId) => {
    stopCapture();
    current = id;
    simpleRows.length = 0;
    ignoreListEl = null;
    ignoreSectionEl = null;
    title.textContent = pageTitle(id);
    intro.textContent = pageIntro(id);

    for (const a of links.children) {
      const on = (a as HTMLElement).dataset.page === id;
      if (on) {
        a.setAttribute("aria-current", "page");
      } else {
        a.removeAttribute("aria-current");
      }
    }

    const socialLocked = id === "social" && !loggedIn;
    saveButton.disabled = socialLocked;
    revertButton.disabled = socialLocked;

    if (id === "controls") {
      draftControlSet = saved.controlSet;
      draftBindings = effectiveBindings(saved);
      undoState = null;
      renderControls();
      return;
    }

    const frag = document.createDocumentFragment();
    if (socialLocked) {
      const notice = document.createElement("div");
      notice.className = "pset-warning";
      notice.textContent =
        "Log in to change your social, privacy and ignore list settings. These are stored on your account.";
      frag.append(notice);
    }
    for (const def of PLAYER_OPTION_DEFS) {
      if (def.page !== id) {
        continue;
      }
      const r = createSimpleRow(def);
      if (socialLocked) {
        r.setDisabled(true);
      }
      simpleRows.push(r);
      frag.append(r.el);
    }
    if (id === "social") {
      ignoreSectionEl = buildIgnoreSection();
      frag.append(ignoreSectionEl);
    }
    list.replaceChildren(frag);
    updateFooterAndDots();
  };

  // ---- Navigation & search ----
  const leave = (go: () => void, closing = false) => {
    stopCapture();
    const n = countUnsaved();
    if (n === 0) {
      go();
      return;
    }
    const what = closing ? "close the window" : "leave this page";
    confirmText.textContent = `You have ${n === 1 ? "an unsaved change" : `${n} unsaved changes`} on ${pageTitle(current)}. If you ${what}, ${n === 1 ? "it" : "they"} will be discarded.`;
    pendingLeave = go;
    confirm.hidden = false;
    confirmBox.setAttribute("role", "alertdialog");
    stay.focus();
  };

  const clearSearch = () => {
    search.value = "";
    results.hidden = true;
    results.replaceChildren();
    list.hidden = false;
  };

  const focusEntry = (entryId: string) => {
    if (current === "controls") {
      const row = controlsRowEls.get(entryId);
      row?.scrollIntoView?.({ block: "nearest" });
      row?.querySelector<HTMLElement>("select, button")?.focus();
      return;
    }
    if (entryId === "ignore-list") {
      ignoreSectionEl?.scrollIntoView?.({ block: "nearest" });
      ignoreSectionEl?.querySelector<HTMLElement>("input")?.focus();
      return;
    }
    simpleRows.find((r) => r.def.key === entryId)?.focus();
  };

  const goTo = (id: PlayerSettingsPageId, entryId?: string) => {
    const arrive = () => {
      clearSearch();
      if (id !== current) {
        renderPage(id);
        list.scrollTop = 0;
      }
      if (entryId) {
        focusEntry(entryId);
      }
    };
    if (id === current) {
      arrive();
    } else {
      leave(arrive);
    }
  };

  const showResults = () => {
    const q = search.value;
    if (q.trim() === "") {
      clearSearch();
      return;
    }
    const found = SEARCH_ENTRIES.filter((e) => matches(e, q));
    if (found.length === 0) {
      const none = document.createElement("p");
      none.className = "settings-none";
      none.textContent = `No setting matches “${q.trim()}”.`;
      results.replaceChildren(none);
    } else {
      results.replaceChildren(
        ...found.map((e) => {
          const b = action(document.createElement("button"), "player-settings-result");
          b.type = "button";
          b.className = "settings-result";
          b.dataset.key = e.id;
          const name = document.createElement("span");
          name.className = "settings-result-label";
          name.textContent = e.label;
          const where = document.createElement("span");
          where.className = "settings-result-page";
          where.textContent = pageTitle(e.page);
          const help = document.createElement("span");
          help.className = "settings-result-help";
          help.textContent = e.help;
          b.append(name, where, help);
          b.addEventListener("click", () => goTo(e.page, e.id));
          return b;
        }),
      );
    }
    results.hidden = false;
    list.hidden = true;
  };
  search.addEventListener("input", showResults);
  search.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && search.value !== "") {
      e.preventDefault();
      e.stopPropagation();
      clearSearch();
    }
  });

  const refreshControlsChangedState = () => {
    const savedEffective = effectiveBindings(saved);
    controlsRowEls
      .get("controlSet")
      ?.classList.toggle("settings-changed", draftControlSet !== saved.controlSet);
    for (const { id } of KEY_ACTIONS) {
      const slot = draftBindings[id];
      const savedSlot = savedEffective[id];
      const changed = slot[0] !== savedSlot[0] || slot[1] !== savedSlot[1];
      controlsRowEls.get(`bind:${id}`)?.classList.toggle("settings-changed", changed);
    }
  };

  // ---- Save & Revert ----
  const saveCurrentPage = () => {
    stopCapture();
    if (current === "social" && !loggedIn) {
      return;
    }
    const patch: PlayerPrefsPatch = {};
    if (current === "controls") {
      const savedEffective = effectiveBindings(saved);
      const setChanged = draftControlSet !== saved.controlSet;
      const bindingsChanged = !bindingsEqual(draftBindings, savedEffective);
      if (setChanged) {
        patch.controlSet = draftControlSet;
      }
      if (bindingsChanged || (setChanged && draftControlSet === "custom")) {
        patch.keyBindings = cloneBindings(draftBindings);
      }
    } else {
      for (const r of simpleRows) {
        const val = r.read();
        if (val !== saved[r.def.key]) {
          (patch as Record<string, unknown>)[r.def.key] = val;
        }
      }
    }
    if (Object.keys(patch).length === 0) {
      setStatus("No changes to save.", "normal");
      return;
    }
    const before: PlayerPreferences = { ...saved, keyBindings: cloneBindings(saved.keyBindings) };
    saved = mergePlayerPrefs(patch, saved);
    if (current === "controls") {
      refreshControlsChangedState();
    } else {
      for (const r of simpleRows) {
        r.refresh();
      }
    }
    for (const a of links.children) {
      const el = a as HTMLElement;
      el.classList.toggle("settings-changed", false);
    }
    const reqId = ++nextReqId;
    pendingSave = { id: reqId, before };
    setStatus("Saving…", "normal");
    actions.save(patch, reqId);
  };

  const revertCurrentPage = () => {
    stopCapture();
    renderPage(current);
  };

  const revertButton = makeButton(
    "player-settings-revert",
    "settings-revert",
    "Revert",
    revertCurrentPage,
  );
  const saveButton = makeButton("player-settings-save", "settings-save", "Save", saveCurrentPage);
  footer.append(status, revertButton, saveButton);

  pane.append(title, intro, list, results, footer);
  stage.append(nav, pane, confirm);

  // Build sidebar links once.
  links.replaceChildren(
    ...PLAYER_SETTINGS_PAGES.map((p) => {
      const a = action(document.createElement("button"), "player-settings-page");
      a.type = "button";
      a.className = "settings-link";
      a.dataset.page = p.id;
      const dot = document.createElement("span");
      dot.className = "settings-dot";
      dot.setAttribute("aria-hidden", "true");
      const name = document.createElement("span");
      name.textContent = p.title;
      a.append(name, dot);
      a.addEventListener("click", () => goTo(p.id));
      return a;
    }),
  );

  const win = layer.create({
    title: "Settings",
    name: "player-settings",
    width: SETTINGS_SIZE.w,
    height: SETTINGS_SIZE.h,
    body: stage,
    onClose: () => {
      stopCapture();
      closeConfirm();
    },
    beforeClose: () => {
      if (countUnsaved() === 0) {
        return true;
      }
      leave(() => win.close(), true);
      return false;
    },
  });

  const applyBaselinePreservingEdits = (
    nextPrefs: PlayerPreferences,
    nextIgnores: readonly string[],
    isLoggedIn: boolean,
  ) => {
    const prevSaved = saved;
    const prevLoggedIn = loggedIn;
    saved = { ...nextPrefs, keyBindings: cloneBindings(nextPrefs.keyBindings) };
    ignores = [...nextIgnores];
    loggedIn = isLoggedIn;
    if (!win.isOpen) {
      return;
    }
    if (current === "controls") {
      const prevEffective = effectiveBindings(prevSaved);
      const wasDirty =
        draftControlSet !== prevSaved.controlSet || !bindingsEqual(draftBindings, prevEffective);
      if (!wasDirty) {
        const top = list.scrollTop;
        draftControlSet = saved.controlSet;
        draftBindings = effectiveBindings(saved);
        undoState = null;
        renderControls();
        list.scrollTop = top;
      } else {
        refreshControlsChangedState();
        updateFooterAndDots();
      }
      return;
    }
    const dirtyDraft = new Map<SimplePrefKey, unknown>();
    for (const r of simpleRows) {
      const cur = r.read();
      if (cur !== prevSaved[r.def.key]) {
        dirtyDraft.set(r.def.key, cur);
      }
    }
    if (current === "social" && prevLoggedIn !== loggedIn) {
      const top = list.scrollTop;
      renderPage(current);
      for (const r of simpleRows) {
        if (dirtyDraft.has(r.def.key)) {
          r.write(dirtyDraft.get(r.def.key));
          r.refresh();
        }
      }
      updateFooterAndDots();
      list.scrollTop = top;
      return;
    }
    for (const r of simpleRows) {
      if (!dirtyDraft.has(r.def.key)) {
        r.write(saved[r.def.key]);
      }
      r.refresh();
    }
    if (current === "social") {
      renderIgnoreRows();
    }
    const n = countUnsaved();
    for (const a of links.children) {
      const el = a as HTMLElement;
      el.classList.toggle("settings-changed", n > 0 && el.dataset.page === current);
    }
    if (n > 0) {
      setStatus(`${n} unsaved change${n === 1 ? "" : "s"}`, "normal");
    } else if (!status.classList.contains("settings-status-ok") && !pendingSave) {
      setStatus("No unsaved changes", "normal");
    }
  };

  return {
    window: win,
    isCapturing: () => capture !== null,
    isConfirmOpen: () => !confirm.hidden,
    open(nextPrefs, nextIgnores, isLoggedIn) {
      if (win.isOpen) {
        // Raising an already-open Settings window preserves unsaved edits and any confirm dialog.
        win.open();
        applyBaselinePreservingEdits(nextPrefs, nextIgnores, isLoggedIn);
        return;
      }
      saved = { ...nextPrefs, keyBindings: cloneBindings(nextPrefs.keyBindings) };
      ignores = [...nextIgnores];
      loggedIn = isLoggedIn;
      pendingSave = null;
      closeConfirm();
      renderPage(current);
      if (search.value.trim() !== "") {
        showResults();
      }
      win.open();
      list.scrollTop = 0;
    },
    sync(nextPrefs, nextIgnores, isLoggedIn) {
      applyBaselinePreservingEdits(nextPrefs, nextIgnores, isLoggedIn);
    },
    setIgnores(nextList, statusText, ok) {
      ignores = [...nextList];
      renderIgnoreRows();
      if (statusText && win.isOpen && current === "social") {
        setStatus(statusText, ok === false ? "error" : "ok");
      }
    },
    saveResult(ok, text, requestId, serverPrefs) {
      if (requestId !== undefined) {
        if (!pendingSave || pendingSave.id !== requestId) {
          return;
        }
      }
      const prev = pendingSave;
      pendingSave = null;
      if (!ok) {
        const rollback = serverPrefs ?? prev?.before;
        if (rollback) {
          saved = { ...rollback, keyBindings: cloneBindings(rollback.keyBindings) };
          if (win.isOpen) {
            if (current === "controls") {
              refreshControlsChangedState();
            } else {
              for (const r of simpleRows) {
                r.refresh();
              }
            }
            const n = countUnsaved();
            for (const a of links.children) {
              const el = a as HTMLElement;
              el.classList.toggle("settings-changed", n > 0 && el.dataset.page === current);
            }
          }
        }
        setStatus(text, "error");
        return;
      }
      const n = countUnsaved();
      setStatus(n > 0 ? `${text} (${n} unsaved)` : text, "ok");
    },
    dispose() {
      stopCapture();
      window.removeEventListener("keydown", onCaptureKeyDown, true);
      window.removeEventListener("blur", onCaptureBlur);
      window.removeEventListener("pointerdown", onCapturePointerDown, true);
    },
    get page() {
      return current;
    },
  };
}
