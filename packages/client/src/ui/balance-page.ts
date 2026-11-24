/**
 * The Control Panel's Balance page (issue #19): the world's global balance numbers, grouped in
 * cards. Each value shows what plays now, the installed packs' value and the engine's default,
 * with its limits; an edited row is marked, and Reset puts the pack's value back (the engine's
 * default when no pack sets one). An SSO page: 1.6 kept these numbers in its code.
 *
 * Changes go into the content store's shared draft as rows of the `balance` dataset, so the
 * Content page publishes, undoes and notices them like any other row. A save carries the row as
 * the page showed it (`fingerprint`), and the server refuses it if someone changed the row since.
 *
 * Refreshes never touch a row being edited: its inputs and fingerprint stay as they were filled,
 * while its "now / pack / default" line follows the server.
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

/** A value as the page writes it: frames also in seconds, a counter as the interval it gives. */
export function shownValue(v: unknown, f: BalanceFieldView): string {
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
    return v === 0 ? "no roll" : `random(${v})`;
  }
  if (f.unit === "power") {
    return v === 0 ? "no power" : `${v} × power`;
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
    return `${v}: acts every ${every} frame${every === 1 ? "" : "s"} (${seconds(every)} s)`;
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
function partialErrors(
  fields: readonly { field: BalanceFieldView; input: HTMLInputElement | HTMLSelectElement }[],
) {
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
  if (f.unit === "choice") {
    return f.choices?.some((c) => c.value === t) ? null : `${f.label}: pick one`;
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

/** One row's card section. */
interface RowUi {
  el: HTMLElement;
  view: BalanceRowView;
  inputs: {
    field: BalanceFieldView;
    input: HTMLInputElement | HTMLSelectElement;
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
  busy: boolean;
}

export function createBalancePage(actions: BalancePageActions): BalancePage {
  const el = document.createElement("div");
  el.className = "balance-page";
  el.append(
    pageHeading(
      "Balance",
      "The game's global numbers: spell amounts, buffs, regeneration, hunger, death, death drops and loot, timings, combat rolls, hulls and the cannon. Each value shows what plays now, the pack's value and the engine's default. Changes go into the content draft, published from the Content page.",
    ),
  );
  const draftLine = document.createElement("div");
  draftLine.className = "balance-draft";
  draftLine.hidden = true;
  const draftText = document.createElement("span");
  const toContent = panelButton(
    "balance-open-content",
    "Review and publish on the Content page",
    () => actions.openContent(),
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
  search.placeholder = "Find a value (hunger, cannon, parry…)";
  const searchLabel = document.createElement("label");
  searchLabel.className = "control-panel-field-label";
  searchLabel.htmlFor = search.id;
  searchLabel.textContent = "Find";
  const noMatch = document.createElement("p");
  noMatch.className = "balance-no-match";
  noMatch.hidden = true;
  noMatch.textContent = "Nothing matches.";
  searchWrap.append(searchLabel, search);
  el.append(draftLine, searchWrap, loading, noMatch, cards);

  let seq = 0;
  /** The newest view request's seq: an older answer never replaces a newer view. */
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

  const dirty = (r: RowUi) =>
    r.inputs.some(
      ({ field, input }) => input.value.trim() !== String(at(r.filled.value, field.path) ?? ""),
    );

  const errors = (r: RowUi) => [
    ...r.inputs.map(({ field, input }) => fieldError(input.value, field)).filter((e) => e !== null),
    ...partialErrors(r.inputs),
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

  const fill = (r: RowUi) => {
    r.filled = { value: structuredClone(r.view.draft), fingerprint: r.view.fingerprint };
    for (const { field, input } of r.inputs) {
      input.value = String(at(r.view.draft, field.path) ?? "");
    }
  };

  const update = (r: RowUi) => {
    const v = r.view;
    updatePreviews(r);
    for (const { field, info } of r.inputs) {
      const pack = v.pack === null ? null : at(v.pack, field.path);
      const parts = [`Now ${shownValue(at(v.published, field.path), field)}`];
      parts.push(pack === null ? "no pack value" : `pack ${shownValue(pack, field)}`);
      parts.push(`engine default ${shownValue(at(v.engine, field.path), field)}`);
      if (field.unit !== "choice") {
        parts.push(`limits ${field.min} to ${field.max}`);
      }
      info.textContent = parts.join(" · ");
    }
    const tags: string[] = [];
    if (v.edited) {
      tags.push(v.pack === null ? "Changed from the engine default" : "Changed from the pack");
    }
    if (v.pending === "set") {
      tags.push("Changed in the draft");
    } else if (v.pending === "revert" || v.pending === "remove") {
      tags.push("Reset in the draft");
    }
    if (v.notice) {
      tags.push(
        `${v.notice.packName} v${v.notice.packVersion} changed this: answer it on the Content page`,
      );
    }
    r.badges.replaceChildren(
      ...tags.map((t) => {
        const s = document.createElement("span");
        s.className = "balance-tag";
        s.textContent = t;
        return s;
      }),
    );
    const isDirty = dirty(r);
    // Someone else changed the row while it was being edited: saving would be refused.
    r.stale.hidden = !(isDirty && r.filled.fingerprint !== v.fingerprint);
    const errs = errors(r);
    r.save.disabled = r.busy || !isDirty || errs.length > 0;
    r.reset.textContent = v.pack === null ? "Reset to the engine default" : "Reset to the pack";
    r.reset.hidden = !(v.edited && v.pending === null) && v.pending !== "set";
    r.reset.disabled = r.busy;
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
        // An optional amount left empty is taken out (its parts are all empty: `errors`).
        data =
          t === "" && field.optional
            ? without(data, field.path.slice(0, -1))
            : withValue(data, field.path, field.unit === "choice" ? t : Number(t));
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
      save: panelButton("balance-save", "Save to the draft", () => send(r, "set"), "primary"),
      reset: panelButton("balance-reset", "Reset to the pack", () => send(r, "revert")),
      drop: panelButton("balance-discard", "Drop the draft's change", () => send(r, "discard")),
      undoEdit: panelButton("balance-undo-edit", "Drop my edit", () => {
        fill(r);
        r.status.textContent = "";
        update(r);
      }),
      busy: false,
    };
    for (const f of v.fields) {
      const wrap = document.createElement("div");
      wrap.className = "control-panel-field balance-field";
      let input: HTMLInputElement | HTMLSelectElement;
      if (f.unit === "choice") {
        const sel = action(document.createElement("select"), "balance-value");
        for (const c of f.choices ?? []) {
          const o = document.createElement("option");
          o.value = c.value;
          o.textContent = c.label;
          sel.append(o);
        }
        input = sel;
      } else {
        const num = noAutofill(action(document.createElement("input"), "balance-value"));
        num.type = "number";
        num.min = String(f.min);
        num.max = String(f.max);
        num.step = "1";
        input = num;
      }
      input.dataset.path = f.path.join(".");
      input.id = `balance-${rowId(v).replace(/[^A-Za-z0-9]/g, "-")}-${f.path.join("-")}`;
      const label = document.createElement("label");
      label.className = "control-panel-field-label";
      label.htmlFor = input.id;
      label.textContent =
        f.unit === "frames"
          ? `${f.label} (frames, 20 a second)`
          : f.unit === "seconds"
            ? `${f.label} (seconds)`
            : f.label;
      if (f.optional && input instanceof HTMLInputElement) {
        input.placeholder = "none";
      }
      const info = document.createElement("p");
      info.className = "control-panel-field-help balance-info";
      info.id = `${input.id}-info`;
      input.setAttribute("aria-describedby", info.id);
      wrap.append(label, input, info);
      if (f.help) {
        const help = document.createElement("p");
        help.className = "control-panel-field-help";
        help.textContent = f.help;
        wrap.append(help);
      }
      input.addEventListener(f.unit === "choice" ? "change" : "input", () => {
        r.status.textContent = "";
        update(r);
      });
      fields.append(wrap);
      // The last part of an amount carries the amount's range preview.
      if (
        f.path.at(-1) === "randomN" &&
        v.fields.some((g) => g.path.join(".") === `${parentKey(f)}.flat`)
      ) {
        const preview = document.createElement("p");
        preview.className = "control-panel-field-help balance-preview";
        preview.setAttribute("aria-live", "polite");
        wrap.append(preview);
        r.previews.set(parentKey(f), preview);
      }
      r.inputs.push({ field: f, input, info });
    }
    r.status.className = "balance-status";
    r.status.setAttribute("role", "status");
    r.stale.className = "balance-stale";
    r.stale.hidden = true;
    r.stale.textContent =
      "Someone changed this row since you started editing it: saving will be refused. Drop your edit to see theirs.";
    const buttons = document.createElement("div");
    buttons.className = "content-buttons";
    buttons.append(r.save, r.undoEdit, r.reset, r.drop);
    sec.append(h, badges, fields, r.stale, buttons, r.status);
    fill(r);
    return r;
  };

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
          p.className = "content-section-intro";
          p.textContent = g.help;
          card.append(t, p);
          for (const v of g.rows) {
            const r = kept.get(rowId(v)) ?? makeRow(v);
            r.view = v;
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
            const open = panelButton("balance-open-row", "Edit on the Content page", () =>
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
    const mine = view.groups.flatMap((g) => g.rows).filter((r) => r.pending !== null).length;
    const total = mine + view.otherDraft;
    draftLine.hidden = total === 0;
    draftText.textContent =
      total === 0
        ? ""
        : `The draft holds ${mine === 1 ? "1 balance change" : `${mine} balance changes`}${view.otherDraft > 0 ? ` and ${view.otherDraft} other ${view.otherDraft === 1 ? "change" : "changes"}` : ""}, live once published. `;
  };

  /** Shows only the rows (and cards) whose words hold every word typed in Find. */
  const applySearch = () => {
    const words = search.value
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w !== "");
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
      card.hidden = !any;
      shown += any ? 1 : 0;
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
    receive(msg) {
      if (msg.seq <= resetSeq) {
        return;
      }
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
      cards.replaceChildren();
      elsewhereNow.clear();
      search.value = "";
      noMatch.hidden = true;
      loading.hidden = false;
      draftLine.hidden = true;
    },
  };
}
