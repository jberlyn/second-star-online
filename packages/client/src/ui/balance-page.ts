/**
 * The Control Panel's Balance page (issue #19): the world's global balance numbers, in plain words,
 * one card at a time behind tabs (Search looks across every card). Each value says what it was
 * originally (the installed packs' value, or the engine's default when no pack sets one) and what
 * players have now when that differs; a fixed amount and its roll are typed as one "from … to …"
 * range. A value you changed is marked, and its tab carries a dot. An SSO page: 1.6 kept these
 * numbers in its code.
 *
 * Changes go into the content store's shared draft as rows of the `balance` dataset, so the
 * Content page publishes, undoes and notices them like any other row. A save carries the row as
 * the page showed it (`fingerprint`), and the server refuses it if someone changed the row since.
 *
 * Refreshes never touch a row being edited: its inputs and fingerprint stay as they were filled,
 * while its "original / live" lines follow the server.
 */
import type {
  BalanceFieldView,
  BalanceRowView,
  ContentBalanceView,
  ContentProblemView,
  ContentRowRef,
} from "@secondstaronline/shared";

import { action, noAutofill } from "./action.ts";
import { pageHeading, panelButton } from "./control-panel-kit.ts";
import { rollBounds, rollFrom } from "./items-page.ts";

/** A row change as the page sends it. */
export interface BalanceChange {
  part: string;
  key: string | null;
  op: "set" | "revert" | "discard";
  data: unknown;
  expect: string;
}

export interface BalancePageActions {
  /** Asks for the view. */
  view(seq: number): void;
  /** Sends one row change; the answer is a `contentBalance` with `result`. */
  set(seq: number, change: BalanceChange): void;
  /** Opens the Content page, where the draft is published. */
  openContent(): void;
  /** Opens the Content page at a row of another dataset (house rest, in `houses`). */
  openContentRow(row: ContentRowRef): void;
}

/** The answer the server sends the page. */
export interface BalanceAnswer {
  t: "contentBalance";
  seq: number;
  view: ContentBalanceView;
  result?: { ok: boolean; text: string; problems?: ContentProblemView[] };
}

export interface BalancePage {
  readonly el: HTMLElement;
  onShow(): void;
  /** Rows with unsaved values (a row whose save is on its way is not one). */
  changes(): number;
  /** Puts every edited row back to what the server last showed. */
  discard(): void;
  receive(msg: BalanceAnswer): void;
  /** A publish or undo went live (a balance-only one included): ask again. */
  published(): void;
  /** A new session, or the permission went: drop everything. */
  reset(): void;
}

/** Frames a second (the game's tick rate). */
const FPS = 20;

const rowId = (r: { part: string; key: string | null }) => `${r.part}/${r.key ?? ""}`;

/** The value at `path` inside a row. */
function at(value: unknown, path: readonly string[]): unknown {
  let v = value;
  for (const p of path) {
    v = v !== null && typeof v === "object" ? (v as Record<string, unknown>)[p] : undefined;
  }
  return v;
}

/** A copy of `value` with `path` set to `n`. */
function withValue(value: unknown, path: readonly string[], n: unknown): unknown {
  const out = structuredClone(value ?? {}) as Record<string, unknown>;
  let o = out;
  path.forEach((p, i) => {
    if (i === path.length - 1) {
      o[p] = n;
    } else {
      const next = o[p];
      o[p] = next !== null && typeof next === "object" ? next : {};
      o = o[p] as Record<string, unknown>;
    }
  });
  return out;
}

/** Seconds as the largest whole-ish unit: 1800 → "30 min", 90 → "1.5 min", 86400 → "1 day". */
export function duration(s: number): string {
  const n = (x: number) => String(Number(x.toFixed(2)));
  if (s >= 86_400) {
    return `${n(s / 86_400)} day${s === 86_400 ? "" : "s"}`;
  }
  if (s >= 3_600) {
    return `${n(s / 3_600)} h`;
  }
  if (s >= 60) {
    return `${n(s / 60)} min`;
  }
  return `${s} s`;
}

/** Frames in seconds, to two places at most (148 → 7.4). */
const seconds = (frames: number) => String(Number((frames / FPS).toFixed(2)));

/** A `steps` value's entries as `[number, value]` pairs (an entry missing a part is skipped). */
function stepPairs(v: unknown, f: BalanceFieldView): [number, string | number][] {
  const st = f.steps;
  if (!st || !Array.isArray(v)) {
    return [];
  }
  return v.flatMap((e) => {
    const o = e as Record<string, unknown>;
    const k = o?.[st.key];
    const x = o?.[st.value];
    return typeof k === "number" && (typeof x === "string" || typeof x === "number")
      ? [[k, x] as [number, string | number]]
      : [];
  });
}

/**
 * A `steps` field's typed lines as its entries, or why they are refused. Each line is
 * `<number>: <value>`; blank lines are skipped; the entries keep the order typed.
 */
export function stepValues(text: string, f: BalanceFieldView): Record<string, unknown>[] | string {
  const st = f.steps;
  if (!st) {
    return `${f.label}: not a list of steps`;
  }
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
  if (f.maxItems !== undefined && lines.length > f.maxItems) {
    return `${f.label}: at most ${f.maxItems} lines`;
  }
  const out: Record<string, unknown>[] = [];
  const seen = new Set<number>();
  for (const line of lines) {
    const m = /^(\d+)\s*:\s*(.*)$/.exec(line);
    if (!m) {
      return `${f.label}: each line a whole number, a colon, then ${st.valueKind === "text" ? "the words" : "a whole number"} (${st.example})`;
    }
    const n = Number(m[1]);
    const rest = (m[2] ?? "").trim();
    if (n < f.min || n > f.max) {
      return `${f.label}: each number from ${f.min} to ${f.max}`;
    }
    if (seen.has(n)) {
      return `${f.label}: ${n} is there twice`;
    }
    seen.add(n);
    if (st.valueKind === "text") {
      if (rest.length < st.valueMin) {
        return `${f.label}: words after the colon on every line`;
      }
      if (rest.length > st.valueMax) {
        return `${f.label}: at most ${st.valueMax} characters after a colon`;
      }
      out.push({ [st.key]: n, [st.value]: rest });
    } else {
      if (!/^\d+$/.test(rest)) {
        return `${f.label}: a whole number after each colon`;
      }
      const x = Number(rest);
      if (x < st.valueMin || x > st.valueMax) {
        return `${f.label}: each from ${st.valueMin} to ${st.valueMax} after the colon`;
      }
      out.push({ [st.key]: n, [st.value]: x });
    }
  }
  return out;
}

/** A value as its input holds it: a list's entries separated by commas, steps one a line. */
export function inputText(v: unknown, f: BalanceFieldView): string {
  if (f.unit === "list") {
    return Array.isArray(v) ? v.join(", ") : "";
  }
  if (f.unit === "steps") {
    return stepPairs(v, f)
      .map(([k, x]) => `${k}: ${x}`)
      .join("\n");
  }
  return String(v ?? "");
}

/** A list field's typed entries, or null when one is not a whole number. */
export function listValues(text: string): number[] | null {
  const parts = text
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x !== "");
  return parts.every((x) => /^\d+$/.test(x)) ? parts.map(Number) : null;
}

/** A value as the page writes it: frames also in seconds, a counter as the interval it gives. */
export function shownValue(v: unknown, f: BalanceFieldView): string {
  if (f.unit === "steps") {
    const pairs = stepPairs(v, f);
    return pairs.length === 0 ? "none" : pairs.map(([k, x]) => `${k}: ${x}`).join(" · ");
  }
  if (f.unit === "list") {
    return Array.isArray(v) ? (v.length === 0 ? "none" : v.join(", ")) : "none";
  }
  if (f.unit === "choice") {
    return f.choices?.find((c) => c.value === v)?.label ?? (typeof v === "string" ? v : "none");
  }
  if (typeof v !== "number") {
    return "none";
  }
  if (f.unit === "frames") {
    return `${v} (${seconds(v)} s)`;
  }
  if (f.unit === "passFrames") {
    // Counted down in both actor passes, so twice a frame.
    return `${v} (${seconds(v / 2)} s)`;
  }
  if (f.unit === "random") {
    return v === 0 ? "no roll" : `1 to ${v}`;
  }
  if (f.unit === "power") {
    return v === 0 ? "none" : `power × ${v}`;
  }
  if (f.unit === "oneIn") {
    return `1 in ${v}`;
  }
  if (f.unit === "seconds") {
    return `${v} s (${duration(v)})`;
  }
  if (f.unit === "counter") {
    // The counter starts at 1, so it acts every target − 1 frames (every frame at 1 or 2).
    const every = Math.max(1, v - 1);
    return `${v} (every ${every} frame${every === 1 ? "" : "s"}, ${seconds(every)} s)`;
  }
  return String(v);
}

/** A copy of `value` without the key at `path`. */
function without(value: unknown, path: readonly string[]): unknown {
  const out = structuredClone(value ?? {}) as Record<string, unknown>;
  let o: Record<string, unknown> | undefined = out;
  path.forEach((p, i) => {
    if (!o) {
      return;
    }
    if (i === path.length - 1) {
      delete o[p];
    } else {
      const next = o[p];
      o = next !== null && typeof next === "object" ? (next as Record<string, unknown>) : undefined;
    }
  });
  return out;
}

/** The parent path of a field (the amount it is a part of), as a key. */
const parentKey = (f: BalanceFieldView) => f.path.slice(0, -1).join(".");

/** The powers an amount's range is previewed at. */
const PREVIEW_POWERS = [1, 10, 50];

/**
 * An amount's range as the page previews it from its typed parts, or null when a part does not
 * read: `flat + power × P + random(n)` at a few powers (just `flat + random(n)` with no power).
 */
export function amountPreview(flat: string, power: string | null, randomN: string): string | null {
  const nums = [flat, power ?? "0", randomN].map((t) => t.trim());
  if (!nums.every((t) => /^\d+$/.test(t))) {
    return null;
  }
  const [f, pw, n] = nums.map(Number) as [number, number, number];
  const range = (P: number) => {
    const base = f + pw * P;
    return n === 0 ? `${base}` : `${base + 1} to ${base + n}`;
  };
  // Neutral words: an amount is damage, a heal, a power or a body's roll.
  if (power === null || pw === 0) {
    return n === 0 ? `Always ${range(0)}` : `Rolls ${range(0)}`;
  }
  return PREVIEW_POWERS.map((P) => `power ${P}: ${range(P)}`).join(" · ");
}

/** Why the typed parts of each optional amount are refused: filled in part. */
function partialErrors(fields: readonly { field: BalanceFieldView; input: FieldInput }[]) {
  const groups = new Map<string, { label: string; blank: number; all: number }>();
  for (const { field, input } of fields) {
    if (!field.optional) {
      continue;
    }
    const g = groups.get(parentKey(field)) ?? { label: field.label, blank: 0, all: 0 };
    g.all += 1;
    if (input.value.trim() === "") {
      g.blank += 1;
    }
    groups.set(parentKey(field), g);
  }
  return [...groups.values()]
    .filter((g) => g.blank > 0 && g.blank < g.all)
    .map((g) => `${g.label}: fill every part, or leave them all empty`);
}

/** Why a typed value is refused, or null. */
export function fieldError(text: string, f: BalanceFieldView): string | null {
  const t = text.trim();
  if (f.unit === "steps") {
    const got = stepValues(t, f);
    return typeof got === "string" ? got : null;
  }
  if (f.unit === "choice") {
    return f.choices?.some((c) => c.value === t) ? null : `${f.label}: pick one`;
  }
  if (f.unit === "list") {
    const values = listValues(t);
    if (values === null) {
      return `${f.label}: whole numbers, separated by commas`;
    }
    if (values.some((n) => n < f.min || n > f.max)) {
      return `${f.label}: each from ${f.min} to ${f.max}`;
    }
    if (f.maxItems !== undefined && values.length > f.maxItems) {
      return `${f.label}: at most ${f.maxItems}`;
    }
    return null;
  }
  if (t === "" && f.optional) {
    return null;
  }
  if (!/^-?\d+$/.test(t)) {
    return `${f.label}: a whole number`;
  }
  const n = Number(t);
  if (n < f.min || n > f.max) {
    return `${f.label}: from ${f.min} to ${f.max}`;
  }
  return null;
}

/** An amount's fixed part and roll typed as one range. */
interface RangeUi {
  key: string;
  label: string;
  optional: boolean;
  from: HTMLInputElement;
  to: HTMLInputElement;
  flat: { field: BalanceFieldView; input: HTMLInputElement };
  randomN: { field: BalanceFieldView; input: HTMLInputElement };
  info: HTMLElement;
}

/** A fixed part and a roll as words: "7 to 12", "5", or "none". */
export function rangeText(flat: unknown, randomN: unknown): string {
  if (typeof flat !== "number") {
    return "none";
  }
  const b = rollBounds(flat, typeof randomN === "number" ? randomN : 0);
  return b.from === b.to ? String(b.from) : `${b.from} to ${b.to}`;
}

/**
 * Why a typed range is refused, or the fixed part and roll it stands for. `random(n)` rolls 1 to
 * n, so a range that rolls starts one above its fixed part: one starting at the fixed part's
 * lowest value can only be fixed.
 */
export function readRange(
  fromText: string,
  toText: string,
  label: string,
  flat: { min: number; max: number },
  randomN: { min: number; max: number },
): { flat: number; randomN: number } | string {
  const f = fromText.trim();
  const t = toText.trim();
  if (!/^-?\d+$/.test(f) || !/^-?\d+$/.test(t) || Number(t) < Number(f)) {
    return `${label}: whole numbers, "to" no lower than "from"`;
  }
  const from = Number(f);
  const to = Number(t);
  const r = rollFrom(from, to);
  if (r.flat < flat.min) {
    return from === to || from < flat.min
      ? `${label}: from ${flat.min} at the lowest`
      : `${label}: a range can't start at ${from}; start it at ${from + 1}, or make it a fixed ${from}`;
  }
  if (r.flat > flat.max) {
    return `${label}: "from" is at most ${flat.max + (r.randomN > 0 ? 1 : 0)}`;
  }
  if (r.randomN > randomN.max) {
    return `${label}: "from" and "to" at most ${randomN.max - 1} apart`;
  }
  return r;
}

/** A field's input: a box, a pick, or (steps) lines. */
type FieldInput = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/** The text a field's input holds, in the form `inputText` writes it (so an untouched one is clean). */
function typedText(input: FieldInput, f: BalanceFieldView): string {
  if (f.unit === "list") {
    return (listValues(input.value) ?? []).join(", ");
  }
  if (f.unit === "steps") {
    const got = stepValues(input.value, f);
    return typeof got === "string" ? input.value : inputText(got, f);
  }
  return input.value.trim();
}

/** One row's card section. */
interface RowUi {
  el: HTMLElement;
  view: BalanceRowView;
  inputs: {
    field: BalanceFieldView;
    input: FieldInput;
    info: HTMLElement;
  }[];
  /** Each amount's range preview, by the amount's path. */
  previews: Map<string, HTMLElement>;
  /** The draft value and fingerprint the inputs were filled from. */
  filled: { value: unknown; fingerprint: string };
  badges: HTMLElement;
  status: HTMLElement;
  stale: HTMLElement;
  save: HTMLButtonElement;
  reset: HTMLButtonElement;
  drop: HTMLButtonElement;
  /** Puts the fields back as they were filled: shown only while the row is edited. */
  undoEdit: HTMLButtonElement;
  /** Its amounts typed as "from … to …" (a fixed part and a roll, kept in the hidden inputs). */
  ranges: RangeUi[];
  /** A range's error, by the amount's path, while its from/to do not read. */
  rangeErrors: Map<string, string>;
  busy: boolean;
}

/** Which cards a Balance panel shows, and where it sits. */
export interface BalancePageOptions {
  /** The cards (`BalanceGroupView.id`) it shows; all of them when left out. */
  only?: readonly string[];
  /** The cards it leaves out (shown on other pages). */
  except?: readonly string[];
  /** Shown as a tab of another page: no heading of its own. */
  embedded?: boolean;
  /** Its first request number, so two panels' answers are told apart (each range 100 000 000). */
  seqBase?: number;
}

/** The cards that live on other pages: the spell effects (Spells) and the vehicles (Houses). */
export const SPELL_BALANCE_GROUPS: readonly string[] = ["spells", "buffs"];
export const VEHICLE_BALANCE_GROUPS: readonly string[] = ["vehicles"];

export function createBalancePage(
  actions: BalancePageActions,
  opts: BalancePageOptions = {},
): BalancePage {
  const el = document.createElement("div");
  el.className = "balance-page plain-editor";
  if (!opts.embedded) {
    el.append(
      pageHeading(
        "Game Rules",
        "The numbers that apply to the whole game rather than to one item or creature: hunger and death, levels and experience, timings, combat and how monsters move and spawn. Pick a tab, or search. Saving puts your changes with the other unpublished changes: players get them once you publish.",
      ),
    );
  }
  const draftLine = document.createElement("div");
  draftLine.className = "balance-draft";
  draftLine.hidden = true;
  const draftText = document.createElement("span");
  const toContent = panelButton("balance-open-content", "Review and publish…", () =>
    actions.openContent(),
  );
  draftLine.append(draftText, toContent);
  const loading = document.createElement("p");
  loading.className = "balance-loading";
  loading.textContent = "Loading…";
  const cards = document.createElement("div");
  cards.className = "balance-cards";
  // Narrows the cards to the rows whose names (a card's, a row's or a field's) hold the words.
  const searchWrap = document.createElement("div");
  searchWrap.className = "control-panel-field balance-search";
  const search = noAutofill(action(document.createElement("input"), "balance-search"));
  search.type = "search";
  search.id = "balance-search";
  search.placeholder = "Search every tab (hunger, cannon, parry…)";
  const searchLabel = document.createElement("label");
  searchLabel.className = "control-panel-field-label";
  searchLabel.htmlFor = search.id;
  searchLabel.textContent = "Search";
  const noMatch = document.createElement("p");
  noMatch.className = "balance-no-match";
  noMatch.hidden = true;
  noMatch.textContent = "Nothing matches.";
  searchWrap.append(searchLabel, search);
  // One card at a time: a tab for each, and All.
  const strip = document.createElement("div");
  strip.className = "control-panel-tabs balance-tabs";
  strip.setAttribute("role", "tablist");
  strip.setAttribute("aria-label", "Balance groups");
  strip.hidden = true;
  el.append(draftLine, searchWrap, strip, loading, noMatch, cards);

  let seq = opts.seqBase ?? 0;
  /** Answers to requests sent before the last `reset` (a new session) are dropped. */
  let resetSeq = -1;
  /** The newest view applied: an older one never replaces it, whichever arrives first. */
  let appliedSeq = -1;
  /** Saves waiting for their answer, by seq: the row the answer is for. */
  const saving = new Map<number, string>();
  const rows = new Map<string, RowUi>();
  let groupsShown = "";
  /** Each "elsewhere" line's value, by `<group>:<index>`. */
  const elsewhereNow = new Map<string, HTMLElement>();
  /** The tab chosen: a card's id, or "all". */
  let chosen = "";

  const dirty = (r: RowUi) =>
    r.rangeErrors.size > 0 ||
    r.inputs.some(
      ({ field, input }) =>
        typedText(input, field) !== inputText(at(r.filled.value, field.path), field),
    );

  const errors = (r: RowUi) => [
    ...r.inputs.map(({ field, input }) => fieldError(input.value, field)).filter((e) => e !== null),
    ...partialErrors(r.inputs),
    ...r.rangeErrors.values(),
  ];

  /** The typed value of the field at `path` in a row, or null when the row has none there. */
  const typed = (r: RowUi, path: string) =>
    r.inputs.find(({ field }) => field.path.join(".") === path)?.input.value ?? null;

  const updatePreviews = (r: RowUi) => {
    for (const [key, el] of r.previews) {
      const flat = typed(r, `${key}.flat`) ?? "";
      const randomN = typed(r, `${key}.randomN`) ?? "";
      const blank = [flat, typed(r, `${key}.power`) ?? "", randomN].every((t) => t.trim() === "");
      // Only an optional amount can be left empty: a required one empty is an error, not "none".
      const optional = r.inputs.some(({ field }) => parentKey(field) === key && field.optional);
      const text = blank
        ? optional
          ? "None of its own"
          : null
        : amountPreview(flat, typed(r, `${key}.power`), randomN);
      el.textContent = text ?? "";
      el.hidden = text === null;
    }
  };

  /** Shows each range's hidden fixed part and roll as its from/to. */
  const fillRanges = (r: RowUi) => {
    r.rangeErrors.clear();
    for (const g of r.ranges) {
      const flat = g.flat.input.value.trim();
      if (flat === "") {
        g.from.value = "";
        g.to.value = "";
      } else {
        const b = rollBounds(Number(flat), Number(g.randomN.input.value.trim() || "0"));
        g.from.value = String(b.from);
        g.to.value = String(b.to);
      }
    }
  };

  const fill = (r: RowUi) => {
    r.filled = { value: structuredClone(r.view.draft), fingerprint: r.view.fingerprint };
    for (const { field, input } of r.inputs) {
      input.value = inputText(at(r.view.draft, field.path), field);
    }
    fillRanges(r);
  };

  /** "Original: 5", and what players have now when that differs. */
  const infoText = (original: string, live: string) =>
    live === original ? `Original: ${original}` : `Original: ${original} · players have ${live}`;

  const update = (r: RowUi) => {
    const v = r.view;
    updatePreviews(r);
    const original = v.pack ?? v.engine;
    for (const { field, info } of r.inputs) {
      info.textContent = infoText(
        shownValue(at(original, field.path), field),
        shownValue(at(v.published, field.path), field),
      );
    }
    for (const g of r.ranges) {
      const path = g.key.split(".").filter((x) => x !== "");
      const of = (value: unknown) =>
        rangeText(at(value, [...path, "flat"]), at(value, [...path, "randomN"]));
      g.info.textContent = infoText(of(original), of(v.published));
    }
    const tags: [string, string][] = [];
    if (v.edited || v.pending === "set") {
      tags.push(["Changed by you", "changed"]);
    }
    if (v.pending === "set") {
      tags.push(["Unpublished changes", "pending"]);
    } else if (v.pending === "revert" || v.pending === "remove") {
      tags.push(["Back to the original once published", "pending"]);
    }
    if (v.notice) {
      tags.push([
        `${v.notice.packName} ${v.notice.packVersion} changed this: review it under Publish Changes`,
        "pending",
      ]);
    }
    r.badges.replaceChildren(
      ...tags.map(([t, kind]) => {
        const s = document.createElement("span");
        s.className = `balance-tag items-tag-${kind}`;
        s.textContent = t;
        return s;
      }),
    );
    const isDirty = dirty(r);
    // Someone else changed the row while it was being edited: saving would be refused.
    r.stale.hidden = !(isDirty && r.filled.fingerprint !== v.fingerprint);
    const errs = errors(r);
    r.save.disabled = r.busy || !isDirty || errs.length > 0;
    // A row's Save shows once something in it is changed (and while its save is on its way).
    r.save.hidden = !isDirty && !r.busy;
    r.reset.title =
      v.pack === null
        ? "Puts back the game's default value once published."
        : "Puts back the pack's value once published.";
    r.reset.hidden = !(v.edited && v.pending === null) && v.pending !== "set";
    r.reset.disabled = r.busy;
    r.drop.title = "Takes this change out of the draft: players keep what they have now.";
    r.drop.hidden = v.pending === null;
    r.drop.disabled = r.busy;
    r.undoEdit.hidden = !isDirty;
    r.undoEdit.disabled = r.busy;
    // A row being saved takes no typing until the answer comes: the answer fills the row with
    // what the draft now holds, which would silently drop a value typed meanwhile.
    for (const { input } of r.inputs) {
      if (input instanceof HTMLSelectElement) {
        input.disabled = r.busy;
      } else {
        input.readOnly = r.busy;
      }
    }
    for (const g of r.ranges) {
      g.from.readOnly = r.busy;
      g.to.readOnly = r.busy;
    }
    if (errs.length > 0) {
      r.status.textContent = errs.join(". ");
      r.status.className = "balance-status balance-status-error";
    }
  };

  const send = (r: RowUi, op: BalanceChange["op"]) => {
    if (r.busy) {
      return;
    }
    let data: unknown = null;
    if (op === "set") {
      if (errors(r).length > 0) {
        return;
      }
      data = r.filled.value;
      for (const { field, input } of r.inputs) {
        const t = input.value.trim();
        // An optional amount left empty is taken out (its parts are all empty: `errors`), and an
        // optional value of the row's own (the highest level) with it.
        data =
          t === "" && field.optional
            ? without(data, field.path.length > 1 ? field.path.slice(0, -1) : field.path)
            : withValue(
                data,
                field.path,
                field.unit === "choice"
                  ? t
                  : field.unit === "list"
                    ? (listValues(t) ?? [])
                    : field.unit === "steps"
                      ? stepValues(t, field)
                      : Number(t),
              );
      }
    }
    const change: BalanceChange = {
      part: r.view.part,
      key: r.view.key,
      op,
      data,
      expect: op === "set" ? r.filled.fingerprint : r.view.fingerprint,
    };
    // Locked before the request goes, so nothing typed from here on can be lost.
    r.busy = true;
    r.status.textContent = "Saving…";
    r.status.className = "balance-status";
    update(r);
    seq += 1;
    saving.set(seq, rowId(r.view));
    actions.set(seq, change);
  };

  /** A field's label with its unit in words. */
  const labelText = (f: BalanceFieldView) =>
    f.unit === "frames"
      ? `${f.label} (in 1/20ths of a second)`
      : f.unit === "passFrames"
        ? `${f.label} (in 1/40ths of a second)`
        : f.unit === "seconds"
          ? `${f.label} (seconds)`
          : f.label;

  const makeRow = (v: BalanceRowView): RowUi => {
    const sec = document.createElement("section");
    sec.className = "balance-row";
    sec.dataset.row = rowId(v);
    sec.dataset.words = [v.label, ...v.fields.map((f) => f.label)].join(" ");
    const h = document.createElement("h3");
    h.className = "balance-row-title";
    h.textContent = v.label;
    const badges = document.createElement("div");
    badges.className = "balance-tags";
    const fields = document.createElement("div");
    fields.className = "balance-fields";
    const r: RowUi = {
      el: sec,
      view: v,
      inputs: [],
      previews: new Map(),
      filled: { value: null, fingerprint: "" },
      badges,
      status: document.createElement("p"),
      stale: document.createElement("p"),
      save: panelButton("balance-save", "Save changes", () => send(r, "set"), "primary"),
      reset: panelButton("balance-reset", "Restore the original", () => send(r, "revert")),
      drop: panelButton("balance-discard", "Cancel unpublished changes", () => send(r, "discard")),
      undoEdit: panelButton("balance-undo-edit", "Undo changes", () => {
        fill(r);
        r.status.textContent = "";
        update(r);
      }),
      busy: false,
      ranges: [],
      rangeErrors: new Map(),
    };
    const edited = () => {
      r.status.textContent = "";
      update(r);
    };
    const pathOf = (f: BalanceFieldView) => f.path.join(".");
    const sibling = (f: BalanceFieldView, last: string) =>
      v.fields.find((g) => pathOf(g) === [...f.path.slice(0, -1), last].join("."));
    /** An amount's fixed part with its roll beside it: typed together as from … to …. */
    const pairOf = (f: BalanceFieldView) => {
      if (f.path.at(-1) !== "flat" || f.unit !== "count") {
        return undefined;
      }
      const roll = sibling(f, "randomN");
      return roll?.unit === "random" ? roll : undefined;
    };
    const inRange = new Set(
      v.fields.filter((f) => pairOf(f)).flatMap((f) => [pathOf(f), pathOf(pairOf(f) as never)]),
    );
    const idBase = `balance-${rowId(v).replace(/[^A-Za-z0-9]/g, "-")}`;
    for (const f of v.fields) {
      const roll = pairOf(f);
      if (inRange.has(pathOf(f)) && !roll) {
        // The roll of a range: its hidden input came with the fixed part.
        continue;
      }
      const wrap = document.createElement("div");
      wrap.className = "control-panel-field balance-field";
      const label = document.createElement("label");
      label.className = "control-panel-field-label";
      const info = document.createElement("p");
      info.className = "control-panel-field-help balance-info";
      if (roll) {
        // The fixed part and the roll, held in hidden inputs the row reads and sends as before.
        const hidden = (g: BalanceFieldView) => {
          const i = document.createElement("input");
          i.type = "hidden";
          i.dataset.path = pathOf(g);
          return i;
        };
        const flatIn = hidden(f);
        const rollIn = hidden(roll);
        const key = parentKey(f);
        const from = noAutofill(action(document.createElement("input"), "balance-range-from"));
        const to = noAutofill(action(document.createElement("input"), "balance-range-to"));
        for (const [i, word] of [
          [from, "from"],
          [to, "to"],
        ] as const) {
          i.type = "number";
          i.step = "1";
          i.dataset.range = `${key}.${word}`;
          i.setAttribute("aria-label", `${f.label} ${word}`);
          if (f.optional) {
            i.placeholder = "None";
          }
        }
        from.id = `${idBase}-${f.path.slice(0, -1).join("-")}-from`;
        label.htmlFor = from.id;
        label.textContent = f.label;
        info.id = `${from.id}-info`;
        from.setAttribute("aria-describedby", info.id);
        to.setAttribute("aria-describedby", info.id);
        const pair = document.createElement("div");
        pair.className = "items-range-pair";
        pair.append(from, " to ", to);
        const g: RangeUi = {
          key,
          label: f.label,
          optional: f.optional === true,
          from,
          to,
          flat: { field: f, input: flatIn },
          randomN: { field: roll, input: rollIn },
          info,
        };
        const read = () => {
          r.rangeErrors.delete(key);
          if (from.value.trim() === "" && to.value.trim() === "" && g.optional) {
            flatIn.value = "";
            rollIn.value = "";
          } else {
            const got = readRange(from.value, to.value, f.label, f, roll);
            if (typeof got === "string") {
              r.rangeErrors.set(key, got);
            } else {
              flatIn.value = String(got.flat);
              rollIn.value = String(got.randomN);
            }
          }
          edited();
        };
        from.addEventListener("input", read);
        to.addEventListener("input", read);
        wrap.append(label, pair, info, flatIn, rollIn);
        for (const help of [f.help, roll.help]) {
          if (help) {
            const p = document.createElement("p");
            p.className = "control-panel-field-help";
            p.textContent = help;
            wrap.append(p);
          }
        }
        r.inputs.push({ field: f, input: flatIn, info: document.createElement("p") });
        r.inputs.push({ field: roll, input: rollIn, info: document.createElement("p") });
        r.ranges.push(g);
        fields.append(wrap);
        // An amount with a power multiple previews its whole range at a few powers.
        if (sibling(f, "power")) {
          const preview = document.createElement("p");
          preview.className = "control-panel-field-help balance-preview";
          preview.setAttribute("aria-live", "polite");
          wrap.append(preview);
          r.previews.set(key, preview);
        }
        continue;
      }
      let input: FieldInput;
      if (f.unit === "steps") {
        const lines = noAutofill(action(document.createElement("textarea"), "balance-value"));
        lines.className = "balance-steps";
        lines.rows = 4;
        lines.placeholder = f.steps?.example ?? "";
        lines.title = "One a line: a number, a colon, then the value";
        input = lines;
      } else if (f.unit === "choice") {
        const sel = action(document.createElement("select"), "balance-value");
        for (const c of f.choices ?? []) {
          const o = document.createElement("option");
          o.value = c.value;
          o.textContent = c.label;
          sel.append(o);
        }
        input = sel;
      } else if (f.unit === "list") {
        const list = noAutofill(action(document.createElement("input"), "balance-value"));
        list.placeholder = "none";
        list.title = `Whole numbers from ${f.min} to ${f.max}, separated by commas`;
        input = list;
      } else {
        const num = noAutofill(action(document.createElement("input"), "balance-value"));
        num.type = "number";
        num.min = String(f.min);
        num.max = String(f.max);
        num.step = "1";
        num.title = `From ${f.min} to ${f.max}`;
        input = num;
      }
      input.dataset.path = pathOf(f);
      input.id = `${idBase}-${f.path.join("-")}`;
      label.htmlFor = input.id;
      label.textContent = labelText(f);
      if (f.optional && input instanceof HTMLInputElement) {
        input.placeholder = "None";
      }
      info.id = `${input.id}-info`;
      input.setAttribute("aria-describedby", info.id);
      wrap.append(label, input, info);
      if (f.help) {
        const help = document.createElement("p");
        help.className = "control-panel-field-help";
        help.textContent = f.help;
        wrap.append(help);
      }
      input.addEventListener(f.unit === "choice" ? "change" : "input", edited);
      fields.append(wrap);
      r.inputs.push({ field: f, input, info });
    }
    r.status.className = "balance-status";
    r.status.setAttribute("role", "status");
    r.stale.className = "balance-stale";
    r.stale.hidden = true;
    r.stale.textContent =
      "Someone changed this while you were editing it, so saving will be refused. Undo your changes to see theirs.";
    const saveButtons = document.createElement("div");
    saveButtons.className = "content-buttons";
    saveButtons.append(r.save, r.undoEdit);
    const resetButtons = document.createElement("div");
    resetButtons.className = "content-buttons items-reset-buttons";
    resetButtons.append(r.reset, r.drop);
    const buttons = document.createElement("div");
    buttons.className = "items-actions";
    buttons.append(saveButtons, resetButtons);
    sec.append(h, badges, fields, r.stale, buttons, r.status);
    fill(r);
    return r;
  };

  /** A row the operator changed (published or in the draft): its card's tab carries a dot. */
  const changedByYou = (v: BalanceRowView) => v.edited || v.pending === "set";

  const drawTabs = (view: ContentBalanceView) => {
    if (!view.groups.some((g) => g.id === chosen) && chosen !== "all") {
      chosen = view.groups[0]?.id ?? "all";
    }
    strip.replaceChildren(
      ...[...view.groups.map((g) => [g.id, g.title] as const), ["all", "All"] as const].map(
        ([id, title]) => {
          const b = action(document.createElement("button"), "balance-tab");
          b.type = "button";
          b.className = "control-panel-tab";
          b.setAttribute("role", "tab");
          b.dataset.tab = id;
          b.textContent = title;
          b.addEventListener("click", () => {
            chosen = id;
            applySearch();
          });
          return b;
        },
      ),
    );
    strip.hidden = view.groups.length < 2;
  };

  /** Marks each tab whose card holds a value changed by you. */
  const markTabs = (view: ContentBalanceView) => {
    for (const g of view.groups) {
      const b = strip.querySelector<HTMLButtonElement>(`[data-tab="${g.id}"]`);
      const used = g.rows.some(changedByYou);
      b?.classList.toggle("control-panel-tab-used", used);
      if (b && used) {
        b.title = "Has values changed by you";
      } else {
        b?.removeAttribute("title");
      }
    }
  };

  // Arrow keys, Home and End move between tabs, choosing as they go.
  strip.addEventListener("keydown", (e) => {
    const tabs = [...strip.querySelectorAll<HTMLButtonElement>("button")];
    const i = tabs.findIndex((b) => b.dataset.tab === chosen);
    const next =
      e.key === "ArrowRight"
        ? (i + 1) % tabs.length
        : e.key === "ArrowLeft"
          ? (i - 1 + tabs.length) % tabs.length
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? tabs.length - 1
              : -1;
    if (next < 0) {
      return;
    }
    e.preventDefault();
    chosen = tabs[next]?.dataset.tab ?? chosen;
    applySearch();
    tabs[next]?.focus();
  });

  const show = (view: ContentBalanceView) => {
    loading.hidden = true;
    const shape = JSON.stringify(
      view.groups.map((g) => [g.id, g.rows.map(rowId), (g.elsewhere ?? []).map((e) => e.label)]),
    );
    if (shape !== groupsShown) {
      // New rows (a new release): rebuild, keeping what is being edited where the row stays.
      // A row being saved is kept too, still locked (a Reset or Drop leaves it clean but busy).
      const kept = new Map(
        [...rows].filter(([, r]) => dirty(r) || r.busy).map(([id, r]) => [id, r] as const),
      );
      rows.clear();
      elsewhereNow.clear();
      cards.replaceChildren(
        ...view.groups.map((g) => {
          const card = document.createElement("section");
          card.className = "balance-card";
          card.dataset.group = g.id;
          card.dataset.words = g.title;
          const t = document.createElement("h2");
          t.className = "content-section-title";
          t.textContent = g.title;
          const p = document.createElement("p");
          p.className = "content-section-intro items-intro";
          p.textContent = g.help;
          card.append(t, p);
          for (const v of g.rows) {
            const r = kept.get(rowId(v)) ?? makeRow(v);
            r.view = v;
            // A card of one row named as the card says its name once.
            const title = r.el.querySelector<HTMLElement>(".balance-row-title");
            if (title) {
              title.hidden = g.rows.length === 1 && v.label === g.title;
            }
            rows.set(rowId(v), r);
            card.append(r.el);
          }
          (g.elsewhere ?? []).forEach((e, i) => {
            const line = document.createElement("div");
            line.className = "balance-elsewhere";
            line.dataset.words = e.label;
            const label = document.createElement("strong");
            label.textContent = `${e.label}: `;
            const now = document.createElement("span");
            elsewhereNow.set(`${g.id}:${i}`, now);
            const open = panelButton("balance-open-row", "Change it on its page", () =>
              actions.openContentRow(e.row),
            );
            open.dataset.row = `${e.row.dataset}/${e.row.part}`;
            line.append(label, now, " ", open);
            card.append(line);
          });
          return card;
        }),
      );
      groupsShown = shape;
      drawTabs(view);
      applySearch();
    }
    for (const g of view.groups) {
      (g.elsewhere ?? []).forEach((e, i) => {
        const now = elsewhereNow.get(`${g.id}:${i}`);
        if (now) {
          now.textContent = e.now;
        }
      });
      for (const v of g.rows) {
        const r = rows.get(rowId(v));
        if (!r) {
          continue;
        }
        r.view = v;
        // A row being edited keeps its inputs and what they were filled from.
        if (!dirty(r) && !r.busy) {
          fill(r);
        }
        update(r);
      }
    }
    markTabs(view);
    const mine = view.groups.flatMap((g) => g.rows).filter((r) => r.pending !== null).length;
    const total = mine + view.otherDraft;
    draftLine.hidden = total === 0 || opts.embedded === true;
    draftText.textContent =
      total === 0
        ? ""
        : `${total === 1 ? "1 unpublished change" : `${total} unpublished changes`}${view.otherDraft > 0 && mine > 0 ? ` (${mine} to balance)` : mine === 0 ? " (none to balance)" : ""}. Players get them once you publish. `;
  };

  /**
   * Shows the chosen tab's card; while Search holds words, every card's rows whose words hold
   * them all, whichever tab is chosen.
   */
  const applySearch = () => {
    const words = search.value
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w !== "");
    const searching = words.length > 0;
    strip.classList.toggle("balance-tabs-searching", searching);
    for (const b of strip.querySelectorAll<HTMLButtonElement>("button")) {
      const on = !searching && b.dataset.tab === chosen;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = b.dataset.tab === chosen ? 0 : -1;
    }
    let shown = 0;
    for (const card of cards.querySelectorAll<HTMLElement>(".balance-card")) {
      const title = (card.dataset.words ?? "").toLowerCase();
      let any = false;
      for (const rowEl of card.querySelectorAll<HTMLElement>(".balance-row, .balance-elsewhere")) {
        const text = `${title} ${rowEl.dataset.words ?? ""}`.toLowerCase();
        const hit = words.every((w) => text.includes(w));
        rowEl.hidden = !hit;
        any ||= hit;
      }
      const inTab = searching || chosen === "all" || card.dataset.group === chosen;
      card.hidden = !(any && inTab);
      shown += any && inTab ? 1 : 0;
    }
    noMatch.hidden = shown > 0 || cards.childElementCount === 0;
  };
  search.addEventListener("input", applySearch);

  const ask = () => {
    seq += 1;
    actions.view(seq);
  };

  return {
    el,
    onShow: ask,
    // A row whose save is on its way is not unsaved: leaving the page lets the save finish.
    changes: () => [...rows.values()].filter((r) => dirty(r) && !r.busy).length,
    discard() {
      for (const r of rows.values()) {
        if (r.busy) {
          continue;
        }
        fill(r);
        r.status.textContent = "";
        update(r);
      }
    },
    receive(answer) {
      if (answer.seq <= resetSeq) {
        return;
      }
      const shown = (id: string) =>
        (opts.only === undefined || opts.only.includes(id)) && !opts.except?.includes(id);
      const msg =
        opts.only || opts.except
          ? {
              ...answer,
              view: { ...answer.view, groups: answer.view.groups.filter((g) => shown(g.id)) },
            }
          : answer;
      // An answer's view is newer than the one shown unless a later request's answer came first.
      const newer = msg.seq >= appliedSeq;
      const row = saving.get(msg.seq);
      if (row !== undefined) {
        saving.delete(msg.seq);
        const r = rows.get(row);
        if (r) {
          r.busy = false;
          if (msg.result) {
            if (msg.result.ok) {
              // Saved: the row shows what the draft now holds (the newest view of it: the save's,
              // or one answered after it).
              if (newer) {
                r.view =
                  msg.view.groups.flatMap((g) => g.rows).find((x) => rowId(x) === row) ?? r.view;
              }
              fill(r);
            }
            r.status.textContent = msg.result.ok
              ? msg.result.text
              : [
                  msg.result.text,
                  // The server names the page's fields; a message that already names its field
                  // stands alone.
                  ...(msg.result.problems ?? []).map((p) =>
                    p.message.includes(`"${p.where}"`) ? p.message : `${p.where}: ${p.message}`,
                  ),
                ].join(" ");
            r.status.className = msg.result.ok
              ? "balance-status"
              : "balance-status balance-status-error";
          }
        }
        if (newer) {
          appliedSeq = msg.seq;
          show(msg.view);
        } else if (r) {
          // The row's buttons follow its save finishing, whichever view is shown.
          update(r);
        }
        return;
      }
      if (!newer) {
        return;
      }
      appliedSeq = msg.seq;
      show(msg.view);
    },
    published() {
      if (el.isConnected) {
        ask();
      }
    },
    reset() {
      seq += 1;
      resetSeq = seq;
      appliedSeq = seq;
      saving.clear();
      rows.clear();
      groupsShown = "";
      chosen = "";
      cards.replaceChildren();
      strip.replaceChildren();
      strip.hidden = true;
      elsewhereNow.clear();
      search.value = "";
      noMatch.hidden = true;
      loading.hidden = false;
      draftLine.hidden = true;
    },
  };
}
