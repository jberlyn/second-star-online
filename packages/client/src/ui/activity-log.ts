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
 * opens their timeline, and an item opens its flow. Older rows load a page at a time.
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
} from "@secondstaronline/shared";

import { action, gameInput } from "./action.ts";
import { createTable, formField, pageHeading, panelButton } from "./control-panel-kit.ts";

export type ActivityScope = "character" | "item";

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

const SCOPE_TEXT: Record<ActivityScope, { label: string; help: string; empty: string }> = {
  character: {
    label: "Character",
    help: "A character's name. A deleted character is still found by the name it had.",
    empty: "Nothing is logged for this character with these filters.",
  },
  item: {
    label: "Item",
    help: "An item's name as the bag shows it, such as Steel Sword or Blue Crystals.",
    empty: "Nothing is logged for this item with these filters.",
  },
};

export function createActivityLogPage(opts: {
  query(req: ActivityRequest): void;
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
  let seq = 0;
  /** The filters of the rows on screen, for asking for older ones. */
  let shown: Omit<ActivityRequest, "seq" | "before" | "limit"> | null = null;
  let rows: ActivityRow[] = [];

  // ---- the mode switch -----------------------------------------------------------------------
  const modes = document.createElement("div");
  modes.className = "activity-modes";
  modes.setAttribute("role", "group");
  modes.setAttribute("aria-label", "Show");
  const timelineBtn = panelButton("activity-mode-timeline", "Player timeline", () =>
    setScope("character"),
  );
  const itemBtn = panelButton("activity-mode-item", "Item flow", () => setScope("item"));
  modes.append(timelineBtn, itemBtn);

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
    formField("From", since, "UTC day."),
    formField("To", until, "UTC day, included."),
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
  const totalsBox = document.createElement("div");
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
          scope === "item" ? link("activity-player", r.character, "character") : r.character,
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

  root.append(modes, form, status, totalsBox, table.el, more);

  // ---- behaviour -----------------------------------------------------------------------------
  const setScope = (s: ActivityScope) => {
    if (s === scope) {
      return;
    }
    scope = s;
    drawScope();
    name.value = "";
    clear("");
    name.focus();
  };

  const drawScope = () => {
    timelineBtn.setAttribute("aria-pressed", String(scope === "character"));
    itemBtn.setAttribute("aria-pressed", String(scope === "item"));
    const text = SCOPE_TEXT[scope];
    const label = nameField.querySelector("label");
    const help = nameField.querySelector("p");
    if (label) {
      label.textContent = text.label;
    }
    if (help) {
      help.textContent = text.help;
    }
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
    show: open,
    reset() {
      seq += 1;
      scope = "character";
      drawScope();
      name.value = "";
      type.value = "";
      since.value = "";
      until.value = "";
      clear("Type a character's name and choose Show.");
    },
  };
}
