/**
 * The Settings window: the operator's typed settings forms. It takes the File Editor's place in
 * menu 502 but not its look: 1.6 had no settings screen, so this is a plain SSO panel (the File
 * Editor and its path-based file access are removed).
 *
 * - A sidebar lists the pages the server sends (`SettingPage`), grouped by what an operator is
 *   trying to do, with a search over every setting's label and explanation; a result opens its
 *   page at that setting. Each setting's explanation is always shown under it (hover-only hints
 *   never show on a tablet).
 * - Each page is saved on its own. Only the open page can hold changes: leaving it with unsaved
 *   changes (another page, a search result on one, or the close button) asks first, and the
 *   changes are discarded if the operator goes on.
 * - A length of time is typed as time ("30s", "5m", "1d 12h") and sent in whole seconds.
 * - A changed setting is marked and can be reset to its default; the footer counts the page's
 *   unsaved changes and its sidebar link gets a dot.
 * - Save checks the page's values here first, then sends them. The server applies them for
 *   everyone online at once (the same step as `/Refresh`) or refuses the save whole, and the
 *   refusal is shown on the setting at fault. Revert asks the server for what it holds.
 *
 * Pages of other kinds (such as roles) will draw their own editors in the same pane.
 *
 * Save and Revert stand for the File Editor's Save and Load (its members 2 and 3).
 */
import {
  formatTimeLength,
  parseTimeLength,
  prizeLineOk,
  type SettingPage,
  type SettingRow,
} from "@secondstaronline/shared";

import { action, gameInput } from "./action.ts";
import type { GameWindow, WindowLayer } from "./window.ts";

export const SETTINGS_SIZE = { w: 720, h: 500 } as const;

/** The rows' controls stand for the File Editor's fields (SSO's panel replaces them). */

/** The footer after a save the server applied. */
export const SETTINGS_SAVED = "Saved. Everyone online now has these settings.";

export interface SettingsActions {
  /** SAVE: the open page's values by key. */
  save(values: Record<string, unknown>): void;
  /** REVERT: ask for the values the server holds. */
  load(): void;
}

export type SettingsResult = { ok: true } | { ok: false; key: string | null; text: string };

export interface SettingsWindow {
  window: GameWindow;
  /**
   * Fills the pages and opens the window (the server's `settings` reply). It stays on the open
   * page when that page still exists, and the rows show what the server holds.
   */
  show(pages: readonly SettingPage[], rows: readonly SettingRow[]): void;
  /** The server's answer to a save (`settingsResult`). */
  result(r: SettingsResult): void;
  /** The open page's values as the controls hold them now. */
  values(): Record<string, unknown>;
  /** The open page's id. */
  readonly page: string | null;
}

interface Point {
  map: string;
  x: number;
  y: number;
}

const isPoint = (v: unknown): v is Point =>
  typeof v === "object" && v !== null && "map" in v && "x" in v && "y" in v;

/** A map name as the server's schema takes it (server/src/settings.ts `point`, `hazardMap`). */
const MAP_NAME = /^x-?\d+y-?\d+$/;
/** The playfield's tiles (server/src/settings.ts `point`: x 1-17, y 1-12). */
const TILE_X = { min: 1, max: 17 } as const;
const TILE_Y = { min: 1, max: 12 } as const;
/** `portalTargets` holds at most 30 (1.6 read only the first 30). */
const MAX_POINTS = 30;

/** `treasureMaps` holds at most 100 (server/src/settings.ts). */
const MAX_MAPS = 100;

/** One map name per line; blank lines are dropped. */
export function parseMaps(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
}

/** The login news's length cap (server/src/settings.ts `NEWS_MAX`). */
const TEXT_MAX = 1000;

/** The Assassin prizes are four lines, blanks kept (server/src/settings.ts `assassinPrizes`). */
const PRIZE_LINES = 4;

/** One prize per line, first to fourth place; blank lines are kept, extra lines dropped. */
export function parsePrizes(text: string): string[] {
  const lines = text.split("\n").map((l) => l.trim());
  return Array.from({ length: PRIZE_LINES }, (_, k) => lines[k] ?? "");
}

/** `x1000y992 5 5` per line. */
export function pointsText(v: unknown): string {
  return Array.isArray(v)
    ? v
        .filter(isPoint)
        .map((p) => `${p.map} ${p.x} ${p.y}`)
        .join("\n")
    : "";
}

/** The reverse of `pointsText`: a line that is not three words stays as its text. */
export function parsePoints(text: string): unknown[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "")
    .map((l) => {
      const [map, x, y, ...rest] = l.split(/\s+/);
      return rest.length > 0 || y === undefined ? l : { map, x: Number(x), y: Number(y) };
    });
}

/** A duration as the window names it: "30s", or "0 (off)" where 0 has a meaning. */
function durationValueText(r: SettingRow, seconds: number): string {
  return seconds === 0 && r.zero ? `0 (${r.zero})` : formatTimeLength(seconds);
}

/** A value as the row's "Reset to default" names it. */
export function valueText(r: SettingRow, v: unknown): string {
  switch (r.kind) {
    case "bool":
      return v === true ? "on" : "off";
    case "choice":
      return r.choices?.find((c) => c.value === v)?.label ?? String(v);
    case "map":
      return typeof v === "string" && v !== "" ? v : "none";
    case "point":
      return isPoint(v) ? `${v.map} ${v.x} ${v.y}` : "none";
    case "points":
      return Array.isArray(v) && v.length > 0 ? `${v.length} targets` : "none";
    case "maps":
      return Array.isArray(v) && v.length > 0 ? `${v.length} maps` : "none";
    case "zone":
      return String(v);
    case "prizes":
      return Array.isArray(v) ? v.join(", ") : "";
    case "text":
      return typeof v === "string" && v !== "" ? v : "none";
    case "int":
      return `${Number(v)}`;
    case "duration":
      return durationValueText(r, Number(v));
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function wholeIn(v: unknown, min: number, max: number, what: string): string | null {
  if (typeof v !== "number" || !Number.isInteger(v)) {
    return `Enter a whole number for ${what}.`;
  }
  const n = (x: number) => x.toLocaleString("en-US");
  return v < min || v > max ? `Enter ${what} from ${n(min)} to ${n(max)}.` : null;
}

/** Why a row's value would be refused, checked as the server's schemas do; null when fine. */
export function checkValue(r: SettingRow, v: unknown): string | null {
  switch (r.kind) {
    case "bool":
      return null;
    case "choice":
      return r.choices?.some((c) => c.value === v) ? null : "Pick one from the list.";
    case "int":
      return wholeIn(
        v,
        r.min ?? Number.MIN_SAFE_INTEGER,
        r.max ?? Number.MAX_SAFE_INTEGER,
        "a number",
      );
    case "duration": {
      if (typeof v !== "number" || !Number.isInteger(v)) {
        return "Write a time like 30s, 5m, 2h or 7d.";
      }
      const min = r.min ?? 0;
      const max = r.max ?? Number.MAX_SAFE_INTEGER;
      if (v >= min && v <= max) {
        return null;
      }
      return min === 0
        ? `Enter a time up to ${formatTimeLength(max)}${r.zero ? `, or 0 for ${r.zero}` : ""}.`
        : `Enter a time from ${formatTimeLength(min)} to ${formatTimeLength(max)}.`;
    }
    case "map":
      return v === null || (typeof v === "string" && MAP_NAME.test(v))
        ? null
        : "Enter a map name like x1000y992, or leave it empty for none.";
    case "point": {
      const p = v as Point;
      if (!MAP_NAME.test(p.map)) {
        return "Enter a map name like x1000y992.";
      }
      return wholeIn(p.x, TILE_X.min, TILE_X.max, "x") ?? wholeIn(p.y, TILE_Y.min, TILE_Y.max, "y");
    }
    case "points": {
      const list = v as unknown[];
      if (list.length > MAX_POINTS) {
        return `Enter at most ${MAX_POINTS} targets.`;
      }
      const bad = list.findIndex(
        (p) =>
          !isPoint(p) ||
          !MAP_NAME.test(p.map) ||
          wholeIn(p.x, TILE_X.min, TILE_X.max, "x") !== null ||
          wholeIn(p.y, TILE_Y.min, TILE_Y.max, "y") !== null,
      );
      return bad < 0
        ? null
        : `Line ${bad + 1}: write a map and a tile, like x1000y992 5 5 (x 1-17, y 1-12).`;
    }
    case "maps": {
      const list = v as unknown[];
      if (list.length > MAX_MAPS) {
        return `Enter at most ${MAX_MAPS} maps.`;
      }
      const bad = list.findIndex((m) => typeof m !== "string" || !MAP_NAME.test(m));
      return bad < 0 ? null : `Line ${bad + 1}: write a map name, like x1000y992.`;
    }
    case "zone":
      return typeof v === "string" && v !== "" ? null : "Pick a time zone from the list.";
    case "prizes": {
      const list = v as unknown[];
      const bad = list.findIndex((l) => typeof l !== "string" || l.length > 60 || !prizeLineOk(l));
      return bad < 0
        ? null
        : `Line ${bad + 1}: write an item, an amount like 1000 Gold, or leave it empty.`;
    }
    case "text":
      return typeof v === "string" && v.length <= TEXT_MAX
        ? null
        : `Enter at most ${TEXT_MAX} characters.`;
  }
}

/** The time zones offered (the browser's list, with UTC first). */
function timeZones(): string[] {
  const all =
    typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  return ["UTC", ...all.filter((z) => z !== "UTC")];
}

/** One row's controls: read the value, write one (reset), and what it is. */
interface RowState {
  row: SettingRow;
  el: HTMLElement;
  read(): unknown;
  write(v: unknown): void;
  /** Marks the row changed or not and shows or hides its reset button. */
  refresh(): void;
  setError(text: string | null): void;
  focus(): void;
}

const input = (type: string, cls: string, label: string) => {
  const el = gameInput("settings-value");
  el.type = type;
  el.className = cls;
  el.setAttribute("aria-label", label);
  return el;
};
const num = (v: string) => (v.trim() === "" ? Number.NaN : Number(v));

/** One setting's row: its label, control, explanation, error and reset button. */
function createRow(r: SettingRow, onChange: () => void): RowState {
  const row = document.createElement("div");
  row.className = `settings-row settings-kind-${r.kind}`;
  row.dataset.key = r.key;

  const label = document.createElement("label");
  label.className = "settings-label";
  const dot = document.createElement("span");
  dot.className = "settings-dot";
  dot.setAttribute("aria-hidden", "true"); // the footer counts the changes
  const name = document.createElement("span");
  name.textContent = r.label;
  label.append(dot, name);

  const control = document.createElement("div");
  control.className = "settings-control";

  const help = document.createElement("p");
  help.className = "settings-help";
  help.id = `settings-help-${r.key}`;
  help.textContent = r.tooltip;

  const error = document.createElement("p");
  error.className = "settings-error";
  error.id = `settings-error-${r.key}`;
  error.hidden = true;

  const reset = action(document.createElement("button"), "settings-reset");
  reset.type = "button";
  reset.className = "settings-reset";
  reset.textContent = `Reset to default (${valueText(r, r.default)})`;

  let read: () => unknown = () => r.value;
  let write: (v: unknown) => void = () => {};
  const fields: HTMLElement[] = [];

  switch (r.kind) {
    case "bool": {
      const box = input("checkbox", "settings-check", r.label);
      read = () => box.checked;
      write = (v) => {
        box.checked = v === true;
      };
      fields.push(box);
      control.append(box);
      break;
    }
    case "int": {
      const n = input("number", "settings-int", r.label);
      if (r.min !== undefined) {
        n.min = String(r.min);
      }
      if (r.max !== undefined) {
        n.max = String(r.max);
      }
      n.step = "1";
      read = () => num(n.value);
      write = (v) => {
        n.value = String(v);
      };
      fields.push(n);
      control.append(n);
      break;
    }
    case "duration": {
      const d = input("text", "settings-duration", r.label);
      d.placeholder = "30s, 5m, 2h, 7d";
      d.spellcheck = false;
      d.autocomplete = "off";
      // A field that is not a time reads as its text, so the check can name the fault.
      read = () => parseTimeLength(d.value, r.zero) ?? d.value;
      write = (v) => {
        d.value = typeof v === "number" ? formatTimeLength(v) : String(v);
      };
      fields.push(d);
      control.append(d);
      if (r.zero) {
        // Beside the label, so every row's field keeps the same right edge.
        const hint = document.createElement("span");
        hint.className = "settings-unit settings-zero";
        hint.textContent = `0 = ${r.zero}`;
        label.append(hint);
      }
      break;
    }
    case "choice": {
      const sel = action(document.createElement("select"), "settings-value");
      sel.className = "settings-choice";
      sel.setAttribute("aria-label", r.label);
      for (const c of r.choices ?? []) {
        const o = document.createElement("option");
        o.value = c.value;
        o.textContent = c.label;
        sel.append(o);
      }
      read = () => sel.value;
      write = (v) => {
        sel.value = typeof v === "string" ? v : "";
      };
      fields.push(sel);
      control.append(sel);
      break;
    }
    case "zone": {
      const sel = action(document.createElement("select"), "settings-value");
      sel.className = "settings-zone";
      sel.setAttribute("aria-label", r.label);
      const zones = timeZones();
      if (typeof r.value === "string" && !zones.includes(r.value)) {
        zones.push(r.value);
      }
      for (const z of zones) {
        const o = document.createElement("option");
        o.value = z;
        o.textContent = z;
        sel.append(o);
      }
      read = () => sel.value;
      write = (v) => {
        sel.value = typeof v === "string" ? v : "UTC";
      };
      fields.push(sel);
      control.append(sel);
      break;
    }
    case "map": {
      const m = input("text", "settings-map", r.label);
      m.placeholder = "none";
      m.spellcheck = false;
      read = () => (m.value.trim() === "" ? null : m.value.trim());
      write = (v) => {
        m.value = typeof v === "string" ? v : "";
      };
      fields.push(m);
      control.append(m);
      break;
    }
    case "point": {
      const m = input("text", "settings-map", `${r.label}: map`);
      m.placeholder = "x1000y992";
      m.spellcheck = false;
      const x = input("number", "settings-xy", `${r.label}: x`);
      x.min = String(TILE_X.min);
      x.max = String(TILE_X.max);
      const y = input("number", "settings-xy", `${r.label}: y`);
      y.min = String(TILE_Y.min);
      y.max = String(TILE_Y.max);
      const tag = (t: string) => {
        const s = document.createElement("span");
        s.className = "settings-unit";
        s.textContent = t;
        return s;
      };
      read = () => ({ map: m.value.trim(), x: num(x.value), y: num(y.value) });
      write = (v) => {
        const p = isPoint(v) ? v : { map: "", x: 1, y: 1 };
        m.value = p.map;
        x.value = String(p.x);
        y.value = String(p.y);
      };
      fields.push(m, x, y);
      control.append(m, tag("x"), x, tag("y"), y);
      break;
    }
    case "points": {
      const t = action(document.createElement("textarea"), "settings-value");
      t.className = "settings-points";
      t.setAttribute("aria-label", `${r.label}: one "map x y" per line`);
      t.placeholder = "None. One per line: map x y, like x1000y992 5 5";
      t.spellcheck = false;
      t.rows = 3;
      read = () => parsePoints(t.value);
      write = (v) => {
        t.value = pointsText(v);
      };
      fields.push(t);
      control.append(t);
      break;
    }
    case "maps": {
      const t = action(document.createElement("textarea"), "settings-value");
      t.className = "settings-points";
      t.setAttribute("aria-label", `${r.label}: one map name per line`);
      t.placeholder = "None. One map per line, like x1000y992";
      t.spellcheck = false;
      t.rows = 3;
      read = () => parseMaps(t.value);
      write = (v) => {
        t.value = Array.isArray(v) ? v.filter((m) => typeof m === "string").join("\n") : "";
      };
      fields.push(t);
      control.append(t);
      break;
    }
    case "prizes": {
      const t = action(document.createElement("textarea"), "settings-value");
      t.className = "settings-points";
      t.setAttribute(
        "aria-label",
        `${r.label}: first, second, third and fourth place, one per line`,
      );
      t.placeholder = "Long Sword\n1000 Gold\n500 Gold\nKnife";
      t.spellcheck = false;
      t.rows = 4;
      read = () => parsePrizes(t.value);
      write = (v) => {
        t.value = Array.isArray(v) ? v.map((m) => String(m)).join("\n") : "";
      };
      fields.push(t);
      control.append(t);
      break;
    }
    case "text": {
      const t = action(document.createElement("textarea"), "settings-value");
      t.className = "settings-points";
      t.setAttribute("aria-label", r.label);
      t.rows = 3;
      t.maxLength = TEXT_MAX;
      read = () => t.value;
      write = (v) => {
        t.value = typeof v === "string" ? v : "";
      };
      fields.push(t);
      control.append(t);
      break;
    }
  }
  write(r.value);
  if (fields[0]) {
    fields[0].id = `settings-field-${r.key}`;
    label.htmlFor = fields[0].id;
  }
  for (const f of fields) {
    f.setAttribute("aria-describedby", `${help.id} ${error.id}`);
  }

  const state: RowState = {
    row: r,
    el: row,
    read,
    write,
    refresh() {
      const v = read();
      row.classList.toggle("settings-changed", !same(v, r.value));
      reset.hidden = same(v, r.default);
    },
    setError(text) {
      error.textContent = text ?? "";
      error.hidden = text === null;
      row.classList.toggle("settings-invalid", text !== null);
    },
    focus() {
      row.scrollIntoView?.({ block: "nearest" });
      fields[0]?.focus();
    },
  };
  const changed = () => {
    state.setError(null);
    state.refresh();
    onChange();
  };
  for (const f of fields) {
    f.addEventListener("input", changed);
    f.addEventListener("change", changed);
  }
  reset.addEventListener("click", () => {
    write(structuredClone(r.default));
    changed();
  });

  const head = document.createElement("div");
  head.className = "settings-head";
  head.append(label, control);
  row.append(head, help, error, reset);
  state.refresh();
  return state;
}

/** What a search matches: the label, the explanation and the key. */
function matches(r: SettingRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  return q !== "" && [r.label, r.tooltip, r.key].some((text) => text.toLowerCase().includes(q));
}

export function createSettingsWindow(layer: WindowLayer, actions: SettingsActions): SettingsWindow {
  const stage = document.createElement("div");
  stage.className = "settings";

  // ---- the sidebar: search, then one link per page ----
  const nav = document.createElement("nav");
  nav.className = "settings-nav";
  nav.setAttribute("aria-label", "Settings pages");
  const search = gameInput("settings-search");
  search.type = "search";
  search.className = "settings-search";
  search.placeholder = "Search settings";
  search.setAttribute("aria-label", "Search settings");
  search.spellcheck = false;
  const links = document.createElement("div");
  links.className = "settings-links";
  nav.append(search, links);

  // ---- the page: title, rows (or search results), footer ----
  const pane = document.createElement("div");
  pane.className = "settings-pane";
  const title = document.createElement("h2");
  title.className = "settings-title";
  const intro = document.createElement("p");
  intro.className = "settings-intro";
  intro.textContent = "Changes apply to everyone online as soon as you save this page.";
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

  const button = (id: string, cls: string, label: string, onClick: () => void) => {
    const b = action(document.createElement("button"), id);
    b.type = "button";
    b.className = `settings-btn ${cls}`;
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  };

  // ---- leaving a page with unsaved changes asks first ----
  const confirm = document.createElement("div");
  confirm.className = "settings-confirm";
  confirm.hidden = true;
  // Escape in the box is Keep editing.
  const confirmBox = action(document.createElement("div"), "settings-confirm");
  confirmBox.className = "settings-confirm-box";
  confirmBox.setAttribute("aria-modal", "true");
  const confirmText = document.createElement("p");
  confirmText.id = "settings-confirm-text";
  confirmBox.setAttribute("aria-labelledby", confirmText.id);
  let pendingLeave: (() => void) | null = null;
  // The box is an alert dialog only while it shows, so a closed one is not taken for an alert.
  const closeConfirm = () => {
    confirm.hidden = true;
    confirmBox.removeAttribute("role");
    pendingLeave = null;
  };
  const stay = button("settings-stay", "settings-stay", "Keep editing", () => {
    closeConfirm();
    search.focus();
  });
  const discard = button("settings-discard", "settings-discard", "Discard changes", () => {
    const go = pendingLeave;
    closeConfirm();
    go?.();
  });
  confirmBox.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      stay.click();
    }
  });
  const confirmButtons = document.createElement("div");
  confirmButtons.className = "settings-confirm-buttons";
  confirmButtons.append(stay, discard);
  confirmBox.append(confirmText, confirmButtons);
  confirm.append(confirmBox);

  let pages: SettingPage[] = [];
  let rows: SettingRow[] = [];
  let current: string | null = null;
  /** The current page's rows; only this page can hold changes. */
  const states: RowState[] = [];

  const values = () => {
    const out: Record<string, unknown> = {};
    for (const s of states) {
      out[s.row.key] = s.read();
    }
    return out;
  };
  const changes = () => states.filter((s) => !same(s.read(), s.row.value)).length;
  const pageTitle = (id: string | null) => pages.find((p) => p.id === id)?.title ?? "";

  /** "2 unsaved changes" from the rows as they stand; the page's link gets a dot. */
  const countChanges = () => {
    const n = changes();
    status.classList.remove("settings-status-error", "settings-status-ok");
    status.textContent =
      n === 0 ? "No unsaved changes" : `${n} unsaved change${n === 1 ? "" : "s"}`;
    for (const a of links.children) {
      (a as HTMLElement).classList.toggle(
        "settings-changed",
        n > 0 && (a as HTMLElement).dataset.page === current,
      );
    }
  };
  const setStatus = (text: string, kind: "ok" | "error") => {
    status.textContent = text;
    status.classList.toggle("settings-status-ok", kind === "ok");
    status.classList.toggle("settings-status-error", kind === "error");
  };

  /** Draws a page's rows from what the server holds, dropping any changes. */
  const render = (id: string) => {
    current = id;
    states.length = 0;
    for (const r of rows) {
      if (r.page === id) {
        states.push(createRow(r, countChanges));
      }
    }
    title.textContent = pageTitle(id);
    list.replaceChildren(...states.map((s) => s.el));
    for (const a of links.children) {
      const on = (a as HTMLElement).dataset.page === id;
      if (on) {
        a.setAttribute("aria-current", "page");
      } else {
        a.removeAttribute("aria-current");
      }
    }
    countChanges();
  };

  /**
   * Runs `go` now, or after the operator agrees to drop this page's changes. `closing`: the
   * window is closing, not changing page.
   */
  const leave = (go: () => void, closing = false) => {
    const n = changes();
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

  /** Opens a page (asking first if this one has changes), then focuses `key`'s row if given. */
  const goTo = (id: string, key?: string) => {
    const focusRow = () => {
      clearSearch();
      if (id !== current) {
        render(id);
        list.scrollTop = 0;
      }
      if (key) {
        states.find((s) => s.row.key === key)?.focus();
      }
    };
    if (id === current) {
      focusRow();
    } else {
      leave(focusRow);
    }
  };

  const showResults = () => {
    const q = search.value;
    if (q.trim() === "") {
      clearSearch();
      return;
    }
    const found = rows.filter((r) => matches(r, q));
    const items = found.map((r) => {
      const b = action(document.createElement("button"), "settings-result");
      b.type = "button";
      b.className = "settings-result";
      b.dataset.key = r.key;
      const name = document.createElement("span");
      name.className = "settings-result-label";
      name.textContent = r.label;
      const where = document.createElement("span");
      where.className = "settings-result-page";
      where.textContent = pageTitle(r.page);
      const help = document.createElement("span");
      help.className = "settings-result-help";
      help.textContent = r.tooltip;
      b.append(name, where, help);
      b.addEventListener("click", () => goTo(r.page, r.key));
      return b;
    });
    if (items.length === 0) {
      const none = document.createElement("p");
      none.className = "settings-none";
      none.textContent = `No setting matches “${q.trim()}”.`;
      results.replaceChildren(none);
    } else {
      results.replaceChildren(...items);
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

  const save = () => {
    let first: RowState | null = null;
    for (const s of states) {
      const err = checkValue(s.row, s.read());
      s.setError(err);
      if (err && !first) {
        first = s;
      }
    }
    if (first) {
      clearSearch();
      setStatus(`Check ${first.row.label} before saving.`, "error");
      first.focus();
      return;
    }
    status.textContent = "Saving…";
    actions.save(values());
  };

  footer.append(
    status,
    button("settings-revert", "settings-revert", "Revert", () => actions.load()),
    button("settings-save", "settings-save", "Save", save),
  );
  pane.append(title, intro, list, results, footer);
  stage.append(nav, pane, confirm);

  const win = layer.create({
    title: "Settings",
    name: "settings",
    width: SETTINGS_SIZE.w,
    height: SETTINGS_SIZE.h,
    body: stage,
    onClose: closeConfirm,
    // The close button asks too; a close by script (a demotion) does not.
    beforeClose: () => {
      if (changes() === 0) {
        return true;
      }
      leave(() => win.close(), true);
      return false;
    },
  });

  return {
    window: win,
    show(nextPages, nextRows) {
      pages = [...nextPages];
      rows = [...nextRows];
      links.replaceChildren(
        ...pages.map((p) => {
          const a = action(document.createElement("button"), "settings-page");
          a.type = "button";
          a.className = "settings-link";
          a.dataset.page = p.id;
          const dot = document.createElement("span");
          dot.className = "settings-dot";
          dot.setAttribute("aria-hidden", "true"); // the footer counts the changes
          const name = document.createElement("span");
          name.textContent = p.title;
          a.append(name, dot);
          a.addEventListener("click", () => goTo(p.id));
          return a;
        }),
      );
      // After a save or Revert the rows come again: stay on the page and keep the place. Opening
      // moves the window to the top of the layer, which resets its scroll, so restore it after.
      const stayOn = win.isOpen && pages.some((p) => p.id === current);
      const top = stayOn ? list.scrollTop : 0;
      closeConfirm();
      render(stayOn && current ? current : (pages[0]?.id ?? ""));
      if (search.value.trim() !== "") {
        showResults();
      }
      win.open();
      list.scrollTop = top;
    },
    result(r) {
      if (r.ok) {
        setStatus(SETTINGS_SAVED, "ok");
        return;
      }
      const s = states.find((x) => x.row.key === r.key);
      if (s) {
        clearSearch();
        s.setError(r.text);
        s.focus();
        setStatus(`Not saved. Check ${s.row.label}.`, "error");
      } else {
        setStatus(`Not saved. ${r.text}`, "error");
      }
    },
    values,
    get page() {
      return current;
    },
  };
}
