/**
 * The Control Panel's Activity Log page (issue #25): what players did with items and gold, who they
 * fought, how they progressed and when they came and went. 1.6 had nothing like it; it is a plain
 * SSO page built from the Control Panel's shared parts.
 *
 * - **Player timeline:** every event for one character, newest first.
 * - **Item flow:** every movement of one item across all players, with totals gained and lost by
 *   event type.
 *
 * Both filter by event type (one type or a whole group) and by UTC date. A player named in a row
 * opens their timeline, and an item opens its flow. Older rows load a page at a time. Laid out like
 * the content editors: the three views are tabs, the filters one row, and on a wide screen the rows
 * fill the window and scroll on their own, with an item's totals beside them.
 *
 * - **Reconciliation** (issue #35): the newest item reconciliation runs, newest first, each with the
 *   items whose count differs from what the log expects and the items with unlogged changes. Run
 *   now starts one. An item opens its flow. Each run folds away under its heading; the newest is
 *   open.
 */
import {
  ACTIVITY_GROUP_LABELS,
  ACTIVITY_GROUPS,
  ACTIVITY_PAGE,
  ACTIVITY_QUERY_MAX,
  ACTIVITY_TYPE_LABELS,
  type ActivityGroup,
  type ActivityRow,
  type ActivityTotal,
  type ActivityType,
  activitySummary,
  type ReconcileItem,
  type ReconcileRunView,
} from "@secondstaronline/shared";

import { action, gameInput } from "./action.ts";
import { createTable, formField, pageHeading, panelButton, tabStrip } from "./control-panel-kit.ts";

export type ActivityScope = "character" | "item";

/** What the page shows: a timeline or a flow (a search), or the reconciliation runs. */
export type ActivityMode = ActivityScope | "reconcile";

/** A request for the reconciliation runs (`reconcileQuery`), or a run now (`reconcileRun`). */
export interface ReconcileRequest {
  seq: number;
  run: boolean;
}

/** The server's answer (`reconcile`). */
export interface ReconcileReply {
  seq: number;
  runs: ReconcileRunView[];
  text?: string;
}

/** One request for a page of rows (the `activityQuery` intent without its `t`). */
export interface ActivityRequest {
  seq: number;
  scope: ActivityScope;
  name: string;
  types: ActivityType[];
  since: string | null;
  until: string | null;
  before: { at: string; id: string } | null;
  limit: number;
}

/** The server's answer (`activity`). */
export interface ActivityReply {
  seq: number;
  rows: ActivityRow[];
  more: boolean;
  totals?: ActivityTotal[];
  totalsCapped?: number;
  error?: string;
}

export interface ActivityLogPage {
  readonly el: HTMLElement;
  /** Shows the rows of the answer to the latest request; older answers are ignored. */
  receive(msg: ActivityReply): void;
  /** Shows the reconciliation runs of the answer to the latest request. */
  receiveReconcile(msg: ReconcileReply): void;
  /** The page came into view: the reconciliation runs are asked for again when they are shown. */
  onShow(): void;
  /** Opens a character's timeline or an item's flow and asks for it. */
  show(scope: ActivityScope, name: string): void;
  /** Forgets the search and its results (a logout, or the permission lost). */
  reset(): void;
}

/** `2026-11-22T09:15:03.120Z` → `2026-11-22 09:15:03`. */
export function activityTime(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
}

/** A `<input type=date>` value as the start of that UTC day, or null. */
export function dayStart(value: string): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : null;
}

/** The start of the UTC day after a date input's value, so the day itself is included. */
export function dayAfter(value: string): string | null {
  const start = dayStart(value);
  if (start === null) {
    return null;
  }
  return new Date(Date.parse(start) + 86_400_000).toISOString();
}

/** A type filter's value: "" for every type, `group:<id>` for a group, or one type. */
export function typesFor(value: string): ActivityType[] {
  if (value === "") {
    return [];
  }
  if (value.startsWith("group:")) {
    const g = value.slice(6) as ActivityGroup;
    return [...(ACTIVITY_GROUPS[g] ?? [])];
  }
  return value in ACTIVITY_TYPE_LABELS ? [value as ActivityType] : [];
}

const SCOPE_TEXT: Record<
  ActivityScope,
  { label: string; help: string; placeholder: string; empty: string }
> = {
  character: {
    label: "Character",
    placeholder: "A character's name, even a deleted one",
    help: "A character's name. A deleted character is still found by the name it had.",
    empty: "Nothing is logged for this character with these filters.",
  },
  item: {
    label: "Item",
    placeholder: "Such as Steel Sword, or Gold for the gold",
    help: "An item's name as the bag shows it, such as Steel Sword or Blue Crystal. The currency's name (Gold) shows every change to the gold.",
    empty: "Nothing is logged for this item with these filters.",
  },
};

/** A run's heading: when, who ran it, and what it found. */
export function runHeading(r: ReconcileRunView): string {
  const who = r.by === null ? "nightly run" : `run by ${r.by}`;
  const found = r.baseline
    ? `baseline taken of ${r.items} item${r.items === 1 ? "" : "s"}`
    : r.mismatches === 0
      ? `all ${r.items} item${r.items === 1 ? "" : "s"} match`
      : `${r.mismatches} of ${r.items} item${r.items === 1 ? "" : "s"} differ`;
  return `${activityTime(r.at)}, ${who}: ${found}`;
}

/** A signed number, `+3` or `-2` (0 as `0`). */
export function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

export function createActivityLogPage(opts: {
  query(req: ActivityRequest): void;
  reconcile?(req: ReconcileRequest): void;
}): ActivityLogPage {
  const root = document.createElement("section");
  root.className = "activity-log";
  root.append(
    pageHeading(
      "Activity Log",
      "Item and gold movements, kills and deaths, level and skill gains, logins and map changes. Times are UTC.",
    ),
  );

  let scope: ActivityScope = "character";
  let mode: ActivityMode = "character";
  let seq = 0;
  let reconcileSeq = 0;
  /** The filters of the rows on screen, for asking for older ones. */
  let shown: Omit<ActivityRequest, "seq" | "before" | "limit"> | null = null;
  let rows: ActivityRow[] = [];

  // ---- the views, as tabs --------------------------------------------------------------------
  const modes = tabStrip<ActivityMode>(
    "activity-modes",
    "Show",
    [
      { key: "character", label: "Player timeline", action: "activity-mode-timeline" },
      { key: "item", label: "Item flow", action: "activity-mode-item" },
      { key: "reconcile", label: "Item count check", action: "activity-mode-reconcile" },
    ],
    (m) => setMode(m),
  );
  modes.el.classList.add("activity-tabs");

  // ---- the filters ---------------------------------------------------------------------------
  const form = document.createElement("form");
  form.className = "activity-filters";
  const name = gameInput("activity-name");
  name.type = "text";
  name.maxLength = ACTIVITY_QUERY_MAX;
  name.spellcheck = false;
  const nameField = formField(SCOPE_TEXT.character.label, name, SCOPE_TEXT.character.help);
  const type = action(document.createElement("select"), "activity-type");
  const all = document.createElement("option");
  all.value = "";
  all.textContent = "All types";
  type.append(all);
  for (const [g, types] of Object.entries(ACTIVITY_GROUPS) as [
    ActivityGroup,
    readonly ActivityType[],
  ][]) {
    const og = document.createElement("optgroup");
    og.label = ACTIVITY_GROUP_LABELS[g];
    const whole = document.createElement("option");
    whole.value = `group:${g}`;
    whole.textContent = `All ${ACTIVITY_GROUP_LABELS[g].toLowerCase()}`;
    og.append(whole);
    for (const t of types) {
      const o = document.createElement("option");
      o.value = t;
      o.textContent = ACTIVITY_TYPE_LABELS[t];
      og.append(o);
    }
    type.append(og);
  }
  const since = gameInput("activity-since");
  since.type = "date";
  const until = gameInput("activity-until");
  until.type = "date";
  const show = panelButton("activity-show", "Show", () => ask(), "primary");
  // Enter in the name asks too.
  name.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      ask();
    }
  });
  form.append(
    nameField,
    formField("Type", type),
    formField("From (UTC day)", since),
    formField("To (UTC day, included)", until),
    show,
  );
  form.addEventListener("submit", (e) => e.preventDefault());

  // ---- the results ---------------------------------------------------------------------------
  const status = document.createElement("p");
  status.className = "activity-status";
  status.setAttribute("role", "status");

  const totals = createTable<ActivityTotal>({
    label: "Totals by type",
    columns: [
      { label: "Type", cell: (t) => ACTIVITY_TYPE_LABELS[t.type] },
      { label: "Gained", cell: (t) => String(t.gained), numeric: true },
      { label: "Lost", cell: (t) => String(t.lost), numeric: true },
      { label: "Events", cell: (t) => String(t.rows), numeric: true },
    ],
    empty: "",
    key: (t) => t.type,
  });
  // Beside the rows on a wide screen, under them on a narrow one.
  const totalsBox = document.createElement("aside");
  totalsBox.className = "activity-totals";
  const totalsTitle = document.createElement("h2");
  totalsTitle.className = "activity-subtitle";
  totalsTitle.textContent = "Totals";
  totalsBox.append(totalsTitle, totals.el);
  totalsBox.hidden = true;

  /** A name that opens its timeline or flow. */
  const link = (id: string, text: string, to: ActivityScope) => {
    const b = action(document.createElement("button"), id);
    b.type = "button";
    b.className = "activity-link";
    b.textContent = text;
    b.addEventListener("click", () => open(to, text));
    return b;
  };

  const table = createTable<ActivityRow>({
    label: "Activity",
    columns: [
      { label: "Time (UTC)", cell: (r) => activityTime(r.at) },
      { label: "Type", cell: (r) => ACTIVITY_TYPE_LABELS[r.type] },
      {
        label: "Character",
        cell: (r) =>
          r.character === null
            ? "World"
            : scope === "item"
              ? link("activity-player", r.character, "character")
              : r.character,
      },
      { label: "What", cell: (r) => summaryCell(r) },
      {
        label: "With",
        cell: (r) =>
          r.other === null
            ? ""
            : r.otherIsPlayer
              ? link("activity-player", r.other, "character")
              : r.other,
      },
      {
        label: "Where",
        cell: (r) => (r.map === null ? "" : r.x === null ? r.map : `${r.map} (${r.x}, ${r.y})`),
      },
    ],
    empty: "",
    key: (r) => r.id,
  });
  table.el.hidden = true;

  /** The summary, with the item as a link to its flow when on a timeline. */
  const summaryCell = (r: ActivityRow): Node => {
    const cell = document.createElement("span");
    cell.className = r.type === "unlogged" ? "activity-what activity-unlogged" : "activity-what";
    const text = activitySummary({ ...r, other: null });
    if (scope === "character" && r.item !== null) {
      const i = text.indexOf(r.item);
      if (i >= 0) {
        cell.append(
          text.slice(0, i),
          link("activity-item", r.item, "item"),
          text.slice(i + r.item.length),
        );
        return cell;
      }
    }
    cell.textContent = text;
    return cell;
  };

  const more = panelButton("activity-more", "Show older", () => {
    const last = rows.at(-1);
    if (shown && last) {
      send({ ...shown, before: { at: last.at, id: last.id } });
    }
  });
  more.hidden = true;

  // ---- reconciliation ------------------------------------------------------------------------
  const search = document.createElement("div");
  search.className = "activity-search";
  const rowsBox = document.createElement("div");
  rowsBox.className = "activity-rows";
  rowsBox.append(table.el, more);
  const results = document.createElement("div");
  results.className = "activity-results";
  results.append(rowsBox, totalsBox);
  search.append(form, status, results);

  const recon = document.createElement("div");
  recon.className = "activity-reconcile";
  recon.hidden = true;
  const reconIntro = document.createElement("p");
  reconIntro.className = "activity-reconcile-intro";
  reconIntro.textContent =
    "A run saves the world, counts every item and the gold wherever they are held, and compares the count with the last run's plus what the log says was made and ended since. A difference is a source or sink the log missed, or a dupe. Runs happen nightly and when you choose Run now.";
  const runNow = panelButton(
    "activity-reconcile-run",
    "Run now",
    () => askReconcile(true),
    "primary",
  );
  const reconStatus = document.createElement("p");
  reconStatus.className = "activity-status activity-reconcile-status";
  reconStatus.setAttribute("role", "status");
  const reconHead = document.createElement("div");
  reconHead.className = "activity-reconcile-head";
  reconHead.append(reconIntro, runNow);
  const runsBox = document.createElement("div");
  runsBox.className = "activity-runs";
  recon.append(reconHead, reconStatus, runsBox);

  /** The item's name, as a link to its flow (the currency's flow is every change to the gold). */
  const itemCell = (r: ReconcileItem): string | Node =>
    link("activity-reconcile-item", r.item, "item");

  const drawRuns = (runs: readonly ReconcileRunView[]) => {
    runsBox.replaceChildren();
    for (const [i, r] of runs.entries()) {
      // Each run folds under its heading, the newest open, so older runs are a click away rather
      // than a long scroll down.
      const section = document.createElement("details");
      section.className = "activity-run";
      section.open = i === 0;
      const summary = action(document.createElement("summary"), "activity-reconcile-toggle");
      const h = document.createElement("h2");
      h.className = "activity-subtitle";
      h.textContent = runHeading(r);
      summary.append(h);
      if (!r.baseline && r.mismatches > 0) {
        section.classList.add("activity-run-differs");
      }
      section.append(summary);
      if (r.rows.length > 0) {
        const t = createTable<ReconcileItem>({
          label: `Run of ${activityTime(r.at)}`,
          columns: [
            { label: "Item", cell: itemCell },
            { label: "Last run", cell: (x) => String(x.baseline), numeric: true },
            { label: "Made", cell: (x) => String(x.made), numeric: true },
            { label: "Ended", cell: (x) => String(x.ended), numeric: true },
            { label: "Expected", cell: (x) => String(x.expected), numeric: true },
            { label: "Counted", cell: (x) => String(x.actual), numeric: true },
            { label: "Difference", cell: (x) => differenceCell(x.difference), numeric: true },
            { label: "Unlogged", cell: (x) => signed(x.unlogged), numeric: true },
          ],
          empty: "",
          key: (x) => (x.currency ? "" : x.item.toLowerCase()),
        });
        t.setRows(r.rows);
        section.append(t.el);
      }
      if (r.more > 0) {
        const p = document.createElement("p");
        p.className = "activity-status";
        p.textContent = `${r.more} more item${r.more === 1 ? "" : "s"} not shown.`;
        section.append(p);
      }
      runsBox.append(section);
    }
  };

  const differenceCell = (n: number): Node => {
    const span = document.createElement("span");
    span.textContent = signed(n);
    if (n !== 0) {
      span.className = "activity-unlogged";
    }
    return span;
  };

  const askReconcile = (run: boolean) => {
    if (!opts.reconcile) {
      return;
    }
    reconcileSeq += 1;
    runNow.disabled = true;
    reconStatus.textContent = run ? "Running…" : "Loading…";
    opts.reconcile({ seq: reconcileSeq, run });
  };

  root.append(modes.el, search, recon);

  // ---- behaviour -----------------------------------------------------------------------------
  const setMode = (m: ActivityMode) => {
    if (m === "reconcile") {
      if (mode !== "reconcile") {
        mode = "reconcile";
        drawScope();
        askReconcile(false);
      }
      return;
    }
    setScope(m);
  };

  const setScope = (s: ActivityScope) => {
    const was = mode;
    mode = s;
    if (s === scope && was === s) {
      return;
    }
    if (s === scope) {
      drawScope();
      return;
    }
    scope = s;
    drawScope();
    name.value = "";
    clear("");
    name.focus();
  };

  const drawScope = () => {
    modes.show(mode);
    search.hidden = mode === "reconcile";
    // Totals belong to an item's flow: a timeline's rows take the whole width.
    results.classList.toggle("activity-results-flow", scope === "item");
    recon.hidden = mode !== "reconcile";
    const text = SCOPE_TEXT[scope];
    const label = nameField.querySelector("label");
    const help = nameField.querySelector("p");
    if (label) {
      label.textContent = text.label;
    }
    if (help) {
      help.textContent = text.help;
    }
    name.placeholder = text.placeholder;
  };

  const clear = (message: string) => {
    shown = null;
    rows = [];
    table.setRows([]);
    table.el.hidden = true;
    totalsBox.hidden = true;
    more.hidden = true;
    status.textContent = message;
  };

  const send = (req: Omit<ActivityRequest, "seq" | "limit">) => {
    seq += 1;
    shown = {
      scope: req.scope,
      name: req.name,
      types: req.types,
      since: req.since,
      until: req.until,
    };
    more.disabled = true;
    if (req.before === null) {
      status.textContent = "Loading…";
    }
    opts.query({ ...req, seq, limit: ACTIVITY_PAGE });
  };

  const ask = () => {
    const n = name.value.trim();
    if (n === "") {
      clear(scope === "character" ? "Type a character's name." : "Type an item's name.");
      return;
    }
    // A new search starts empty: nothing of the last one stays on screen.
    clear("");
    send({
      scope,
      name: n,
      types: typesFor(type.value),
      since: dayStart(since.value),
      until: dayAfter(until.value),
      before: null,
    });
  };

  const open = (s: ActivityScope, n: string) => {
    scope = s;
    mode = s;
    drawScope();
    name.value = n;
    type.value = "";
    ask();
  };

  drawScope();
  status.textContent = "Type a character's name and choose Show.";

  return {
    el: root,
    receive(msg) {
      if (msg.seq !== seq || !shown) {
        return;
      }
      more.disabled = false;
      if (msg.error) {
        clear(msg.error);
        return;
      }
      rows = [...rows, ...msg.rows];
      table.setRows(rows);
      table.el.hidden = rows.length === 0;
      more.hidden = !msg.more;
      if (msg.totals) {
        totals.setRows(msg.totals);
        totalsBox.hidden = msg.totals.length === 0;
        totalsTitle.textContent =
          msg.totalsCapped === undefined
            ? "Totals"
            : `Totals over the newest ${msg.totalsCapped.toLocaleString("en")} events`;
      }
      status.textContent =
        rows.length === 0
          ? SCOPE_TEXT[shown.scope].empty
          : `${rows.length}${msg.more ? "+" : ""} event${rows.length === 1 ? "" : "s"}, newest first.`;
    },
    receiveReconcile(msg) {
      if (msg.seq !== reconcileSeq) {
        return;
      }
      runNow.disabled = false;
      drawRuns(msg.runs);
      reconStatus.textContent =
        msg.text ?? (msg.runs.length === 0 ? "No run yet: Run now takes the baseline." : "");
    },
    onShow() {
      if (mode === "reconcile") {
        askReconcile(false);
      }
    },
    show: open,
    reset() {
      seq += 1;
      reconcileSeq += 1;
      runNow.disabled = false;
      runsBox.replaceChildren();
      reconStatus.textContent = "";
      scope = "character";
      mode = "character";
      drawScope();
      name.value = "";
      type.value = "";
      since.value = "";
      until.value = "";
      clear("Type a character's name and choose Show.");
    },
  };
}
