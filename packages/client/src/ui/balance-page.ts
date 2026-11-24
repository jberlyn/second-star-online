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
function withValue(value: unknown, path: readonly string[], n: number): unknown {
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

/** A value as the page writes it: frames also in seconds. */
export function shownValue(v: unknown, f: BalanceFieldView): string {
  if (typeof v !== "number") {
    return "none";
  }
  if (f.unit === "frames") {
    const s = v / FPS;
    return `${v} (${Number.isInteger(s) ? s : s.toFixed(2)} s)`;
  }
  if (f.unit === "random") {
    return v === 0 ? "no roll" : `random(${v})`;
  }
  return String(v);
}

/** Why a typed value is refused, or null. */
export function fieldError(text: string, f: BalanceFieldView): string | null {
  const t = text.trim();
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
  inputs: { field: BalanceFieldView; input: HTMLInputElement; info: HTMLElement }[];
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
      "The game's global numbers: hulls and the cannon for now, with spells, regeneration, hunger, death, timings and combat rolls to follow. Each value shows what plays now, the pack's value and the engine's default. Changes go into the content draft, published from the Content page.",
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
  el.append(draftLine, loading, cards);

  let seq = 0;
  /** The newest view request's seq: an older answer never replaces a newer view. */
  let shownSeq = -1;
  /** Saves waiting for their answer, by seq: the row the answer is for. */
  const saving = new Map<number, string>();
  const rows = new Map<string, RowUi>();
  let groupsShown = "";

  const dirty = (r: RowUi) =>
    r.inputs.some(
      ({ field, input }) => input.value.trim() !== String(at(r.filled.value, field.path)),
    );

  const errors = (r: RowUi) =>
    r.inputs.map(({ field, input }) => fieldError(input.value, field)).filter((e) => e !== null);

  const fill = (r: RowUi) => {
    r.filled = { value: structuredClone(r.view.draft), fingerprint: r.view.fingerprint };
    for (const { field, input } of r.inputs) {
      input.value = String(at(r.view.draft, field.path) ?? "");
    }
  };

  const update = (r: RowUi) => {
    const v = r.view;
    for (const { field, info } of r.inputs) {
      const pack = v.pack === null ? null : at(v.pack, field.path);
      const parts = [`Now ${shownValue(at(v.published, field.path), field)}`];
      parts.push(pack === null ? "no pack value" : `pack ${shownValue(pack, field)}`);
      parts.push(`engine default ${shownValue(at(v.engine, field.path), field)}`);
      parts.push(`limits ${field.min} to ${field.max}`);
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
      input.readOnly = r.busy;
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
        data = withValue(data, field.path, Number(input.value.trim()));
      }
    }
    r.busy = true;
    r.status.textContent = "Saving…";
    r.status.className = "balance-status";
    seq += 1;
    saving.set(seq, rowId(r.view));
    actions.set(seq, {
      part: r.view.part,
      key: r.view.key,
      op,
      data,
      expect: op === "set" ? r.filled.fingerprint : r.view.fingerprint,
    });
    update(r);
  };

  const makeRow = (v: BalanceRowView): RowUi => {
    const sec = document.createElement("section");
    sec.className = "balance-row";
    sec.dataset.row = rowId(v);
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
      const input = noAutofill(action(document.createElement("input"), "balance-value"));
      input.type = "number";
      input.min = String(f.min);
      input.max = String(f.max);
      input.step = "1";
      input.dataset.path = f.path.join(".");
      input.id = `balance-${rowId(v).replace(/[^A-Za-z0-9]/g, "-")}-${f.path.join("-")}`;
      const label = document.createElement("label");
      label.className = "control-panel-field-label";
      label.htmlFor = input.id;
      label.textContent = f.unit === "frames" ? `${f.label} (frames, 20 a second)` : f.label;
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
      input.addEventListener("input", () => {
        r.status.textContent = "";
        update(r);
      });
      fields.append(wrap);
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
    const shape = JSON.stringify(view.groups.map((g) => [g.id, g.rows.map(rowId)]));
    if (shape !== groupsShown) {
      // New rows (a new release): rebuild, keeping what is being edited where the row stays.
      const kept = new Map(
        [...rows].filter(([, r]) => dirty(r)).map(([id, r]) => [id, r] as const),
      );
      rows.clear();
      cards.replaceChildren(
        ...view.groups.map((g) => {
          const card = document.createElement("section");
          card.className = "balance-card";
          card.dataset.group = g.id;
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
          return card;
        }),
      );
      groupsShown = shape;
    }
    for (const g of view.groups) {
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

  const ask = () => {
    seq += 1;
    shownSeq = seq;
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
      const row = saving.get(msg.seq);
      if (row !== undefined) {
        saving.delete(msg.seq);
        const r = rows.get(row);
        // The answer's view is newer than the one shown unless a view asked after the save was
        // answered first; an older view never replaces a newer one.
        const newer = msg.seq >= shownSeq;
        if (r) {
          r.busy = false;
          if (msg.result) {
            if (msg.result.ok) {
              // Saved: the row shows what the draft now holds (the newest view of it).
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
                  ...(msg.result.problems ?? []).map((p) => `${p.where}: ${p.message}`),
                ].join(" ");
            r.status.className = msg.result.ok
              ? "balance-status"
              : "balance-status balance-status-error";
          }
        }
        if (newer) {
          shownSeq = msg.seq;
          show(msg.view);
        } else if (r) {
          // The row's buttons follow its save finishing, whichever view is shown.
          update(r);
        }
        return;
      }
      if (msg.seq < shownSeq) {
        return;
      }
      shownSeq = msg.seq;
      show(msg.view);
    },
    published() {
      if (el.isConnected) {
        ask();
      }
    },
    reset() {
      seq += 1;
      shownSeq = seq;
      saving.clear();
      rows.clear();
      groupsShown = "";
      cards.replaceChildren();
      loading.hidden = false;
      draftLine.hidden = true;
    },
  };
}
