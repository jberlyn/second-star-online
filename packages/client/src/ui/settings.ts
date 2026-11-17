/**
 * The Settings window: the operator's typed settings forms. It takes the File Editor's place in
 * menu 502 but not its look: 1.6 had no settings screen, so this is a plain SSO panel (the File
 * Editor and its path-based file access are removed).
 *
 * - The settings are grouped in sections (`SettingRow.group`), each with its explanation
 *   always shown under it (every setting carries one; hover-only hints never show on a
 *   tablet).
 * - A number counted in frames, milliseconds or minutes shows the time it stands for.
 * - A changed setting is marked and can be reset to its default; the footer counts the
 *   unsaved changes.
 * - Save checks each value here first, then sends every value. The server applies them for
 *   everyone online at once (the same step as `/Refresh`) or refuses the save whole, and the
 *   refusal is shown on the setting at fault. Revert asks the server for what it holds.
 *
 * Save and Revert stand for the File Editor's Save and Load (its members 2 and 3).
 */
import { prizeLineOk, type SettingRow } from "@secondstaronline/shared";

import { action, gameInput } from "./action.ts";
import type { GameWindow, WindowLayer } from "./window.ts";

export const SETTINGS_SIZE = { w: 560, h: 460 } as const;

/** The rows' controls stand for the File Editor's fields (SSO's panel replaces them). */

/** The footer after a save the server applied. */
export const SETTINGS_SAVED = "Saved. Everyone online now has these settings.";

export interface SettingsActions {
  /** SAVE: every row's value by key. */
  save(values: Record<string, unknown>): void;
  /** REVERT: ask for the values the server holds. */
  load(): void;
}

export type SettingsResult = { ok: true } | { ok: false; key: string | null; text: string };

export interface SettingsWindow {
  window: GameWindow;
  /** Fills the rows and opens the window (the server's `settings` reply). */
  show(rows: readonly SettingRow[]): void;
  /** The server's answer to a save (`settingsResult`). */
  result(r: SettingsResult): void;
  /** The values as the controls hold them now. */
  values(): Record<string, unknown>;
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

/** "0.8 s", "50 s", "6 min 40 s", "2 h 5 min". */
export function durationText(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "";
  }
  if (seconds < 60) {
    return `${Math.round(seconds * 100) / 100} s`;
  }
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const parts = [h ? `${h} h` : "", m ? `${m} min` : "", s ? `${s} s` : ""];
  return parts.filter((p) => p !== "").join(" ");
}

/** What a number of `unit` lasts: frames are 1/20 s (the original ran its puppet tempo at 20). */
export function unitSeconds(n: number, unit: NonNullable<SettingRow["unit"]>): number {
  switch (unit) {
    case "frames":
      return n / 20;
    case "ms":
      return n / 1000;
    case "minutes":
      return n * 60;
  }
}

const UNIT_WORD: Record<NonNullable<SettingRow["unit"]>, string> = {
  frames: "frames",
  ms: "ms",
  minutes: "min",
};

/** A value as the row's "Reset to default" names it. */
export function valueText(r: SettingRow, v: unknown): string {
  switch (r.kind) {
    case "bool":
      return v === true ? "on" : "off";
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
    case "int": {
      const n = Number(v);
      return r.unit
        ? `${n} ${UNIT_WORD[r.unit]} (${durationText(unitSeconds(n, r.unit))})`
        : `${n}`;
    }
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
    case "int":
      return wholeIn(
        v,
        r.min ?? Number.MIN_SAFE_INTEGER,
        r.max ?? Number.MAX_SAFE_INTEGER,
        "a number",
      );
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

export function createSettingsWindow(layer: WindowLayer, actions: SettingsActions): SettingsWindow {
  const stage = document.createElement("div");
  stage.className = "settings";

  const intro = document.createElement("p");
  intro.className = "settings-intro";
  intro.textContent = "Changes apply to everyone online as soon as you save.";

  const list = document.createElement("div");
  list.className = "settings-list";

  const footer = document.createElement("div");
  footer.className = "settings-footer";
  const status = document.createElement("span");
  status.className = "settings-status";
  status.setAttribute("role", "status");

  const button = (member: 2 | 3, label: string, onClick: () => void) => {
    // Save and Revert stand for the File Editor's Save and Load.
    const b = action(
      document.createElement("button"),
      member === 2 ? "settings-save" : "settings-revert",
    );
    b.type = "button";
    b.className = `settings-btn settings-${member === 2 ? "save" : "revert"}`;
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  };

  const states: RowState[] = [];
  const values = () => {
    const out: Record<string, unknown> = {};
    for (const s of states) {
      out[s.row.key] = s.read();
    }
    return out;
  };

  /** "2 unsaved changes" from the rows as they stand. */
  const countChanges = () => {
    const n = states.filter((s) => !same(s.read(), s.row.value)).length;
    status.classList.remove("settings-status-error", "settings-status-ok");
    status.textContent =
      n === 0 ? "No unsaved changes" : `${n} unsaved change${n === 1 ? "" : "s"}`;
  };
  const setStatus = (text: string, kind: "ok" | "error") => {
    status.textContent = text;
    status.classList.toggle("settings-status-ok", kind === "ok");
    status.classList.toggle("settings-status-error", kind === "error");
  };

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
      setStatus(`Check ${first.row.label} before saving.`, "error");
      first.focus();
      return;
    }
    status.textContent = "Saving…";
    actions.save(values());
  };

  footer.append(
    status,
    button(3, "Revert", () => actions.load()),
    button(2, "Save", save),
  );
  stage.append(intro, list, footer);

  const win = layer.create({
    title: "Settings",
    name: "settings",
    width: SETTINGS_SIZE.w,
    height: SETTINGS_SIZE.h,
    body: stage,
  });

  const input = (type: string, cls: string, label: string) => {
    const el = gameInput("settings-value");
    el.type = type;
    el.className = cls;
    el.setAttribute("aria-label", label);
    return el;
  };
  const num = (v: string) => (v.trim() === "" ? Number.NaN : Number(v));

  const rowFor = (r: SettingRow): RowState => {
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
        control.append(...fields);
        if (r.unit) {
          const unit = r.unit;
          const hint = document.createElement("span");
          hint.className = "settings-unit";
          const show = () => {
            const v = read() as number;
            const t = durationText(unitSeconds(v, unit));
            hint.textContent =
              Number.isFinite(v) && t !== "" ? `${UNIT_WORD[unit]} = ${t}` : UNIT_WORD[unit];
          };
          const update = write;
          write = (v) => {
            update(v);
            show();
          };
          for (const f of fields) {
            f.addEventListener("input", show);
          }
          control.append(hint);
        }
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
      countChanges();
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
  };

  return {
    window: win,
    show(rows) {
      states.length = 0;
      const sections: HTMLElement[] = [];
      let body: HTMLElement | null = null;
      let group: string | null = null;
      for (const r of rows) {
        if (r.group !== group || !body) {
          group = r.group;
          const section = document.createElement("section");
          section.className = "settings-section";
          const h = document.createElement("h3");
          h.textContent = r.group;
          section.append(h);
          sections.push(section);
          body = section;
        }
        const s = rowFor(r);
        states.push(s);
        body.append(s.el);
      }
      // After a save or Revert the rows come again: keep the operator's place. Opening moves
      // the window to the top of the layer, which resets its scroll, so restore it after.
      const top = win.isOpen ? list.scrollTop : 0;
      list.replaceChildren(...sections);
      countChanges();
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
        s.setError(r.text);
        s.focus();
        setStatus(`Not saved. Check ${s.row.label}.`, "error");
      } else {
        setStatus(`Not saved. ${r.text}`, "error");
      }
    },
    values,
  };
}
