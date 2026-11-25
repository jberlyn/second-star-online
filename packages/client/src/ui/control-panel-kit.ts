/**
 * Shared parts for Control Panel pages (control-panel.ts): a page heading, a data table, a labelled form
 * field and a confirmation box. They are plain SSO controls, not original art (1.6 had no Control Panel),
 * styled to match the Server Settings page. Every interactive control carries a semantic action.
 */
import { action } from "./action.ts";

/** A page's title and the line under it. */
export function pageHeading(title: string, intro = ""): HTMLElement {
  const head = document.createElement("header");
  head.className = "control-panel-heading";
  const h = document.createElement("h1");
  h.className = "control-panel-heading-title";
  h.textContent = title;
  head.append(h);
  if (intro) {
    const p = document.createElement("p");
    p.className = "control-panel-heading-intro";
    p.textContent = intro;
    head.append(p);
  }
  return head;
}

/** A plain Control Panel button. `kind` picks its look: the page's main action, a danger or plain. */
export function panelButton(
  id: string,
  label: string,
  onClick: () => void,
  kind: "primary" | "danger" | "plain" = "plain",
): HTMLButtonElement {
  const b = action(document.createElement("button"), id);
  b.type = "button";
  b.className = `control-panel-btn control-panel-btn-${kind}`;
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

export interface TableColumn<T> {
  /** Shown in the header. */
  label: string;
  /** The cell: text, or an element (a link or a button). */
  cell(row: T): string | Node;
  /** Right-aligns the column (numbers). */
  numeric?: boolean;
}

export interface TableOptions<T> {
  /** What the table lists, for screen readers (`aria-label`). */
  label: string;
  columns: readonly TableColumn<T>[];
  /** Shown in place of the rows when there are none. */
  empty: string;
  /** Each row's key, kept on the row as `data-key`. */
  key(row: T): string;
  /** Makes each row a button: Enter, Space or a click runs it. */
  open?: { id: string; run(row: T): void };
}

export interface PanelTable<T> {
  readonly el: HTMLElement;
  setRows(rows: readonly T[]): void;
}

/** A table of rows, with a header and an empty message. */
export function createTable<T>(opts: TableOptions<T>): PanelTable<T> {
  const wrap = document.createElement("div");
  wrap.className = "control-panel-table-wrap";
  const table = document.createElement("table");
  table.className = "control-panel-table";
  table.setAttribute("aria-label", opts.label);
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const c of opts.columns) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = c.label;
    if (c.numeric) {
      th.className = "control-panel-num";
    }
    headRow.append(th);
  }
  head.append(headRow);
  const body = document.createElement("tbody");
  table.append(head, body);
  const empty = document.createElement("p");
  empty.className = "control-panel-table-empty";
  empty.textContent = opts.empty;
  wrap.append(table, empty);

  return {
    el: wrap,
    setRows(rows) {
      body.replaceChildren(
        ...rows.map((r) => {
          const tr = document.createElement("tr");
          tr.dataset.key = opts.key(r);
          for (const c of opts.columns) {
            const td = document.createElement("td");
            if (c.numeric) {
              td.className = "control-panel-num";
            }
            td.append(c.cell(r));
            tr.append(td);
          }
          const open = opts.open;
          if (open) {
            action(tr, open.id);
            tr.tabIndex = 0;
            tr.classList.add("control-panel-row-open");
            // A control inside a cell (a button, link or field) does its own job, not the row's.
            const own = (e: Event) =>
              e.target instanceof Element &&
              e.target !== tr &&
              e.target.closest("a, button, input, select, textarea, [role='button']") !== null;
            tr.addEventListener("click", (e) => {
              if (!own(e)) {
                open.run(r);
              }
            });
            tr.addEventListener("keydown", (e) => {
              if (e.target === tr && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                open.run(r);
              }
            });
          }
          return tr;
        }),
      );
      empty.hidden = rows.length > 0;
      table.hidden = rows.length === 0;
    },
  };
}

let fieldIds = 0;

/** A form field: its label, the control, and help text always shown under it (no hover hints). */
export function formField(
  label: string,
  control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  help = "",
): HTMLElement {
  const row = document.createElement("div");
  row.className = "control-panel-field";
  fieldIds += 1;
  control.id ||= `control-panel-field-${fieldIds}`;
  const l = document.createElement("label");
  l.className = "control-panel-field-label";
  l.htmlFor = control.id;
  l.textContent = label;
  row.append(l, control);
  if (help) {
    const h = document.createElement("p");
    h.className = "control-panel-field-help";
    h.id = `${control.id}-help`;
    h.textContent = help;
    control.setAttribute("aria-describedby", h.id);
    row.append(h);
  }
  return row;
}

/**
 * Keeps Tab and Shift+Tab inside `box`'s controls (its enabled buttons and inputs, a checkbox
 * included), so a question cannot be tabbed past.
 */
export function trapTab(box: HTMLElement, e: KeyboardEvent): void {
  if (e.key !== "Tab") {
    return;
  }
  const stops = [
    ...box.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]):not([type="hidden"])',
    ),
  ];
  // The box itself (focused by a click on its text) counts as outside the controls.
  const first = stops[0];
  const last = stops.at(-1);
  if (!first || !last) {
    return;
  }
  const active = document.activeElement;
  const outside = active === box || !box.contains(active);
  if (e.shiftKey && (active === first || outside)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (active === last || outside)) {
    e.preventDefault();
    first.focus();
  }
}

export interface ConfirmOptions {
  text: string;
  /** The button that goes on. */
  confirm: string;
  /** The button that stays. */
  cancel: string;
  /** The confirm button is a danger (deleting, discarding). */
  danger?: boolean;
  /** Lines listed under the question: what the change will do, one per line. */
  list?: readonly string[];
  /** A checkbox under the question (off unless `checked`), with a hint shown under it. */
  check?: { action: string; label: string; checked?: boolean; hint?: string };
}

/** What `confirmChoice` answers: the button, and the checkbox's state when it has one. */
export interface ConfirmChoice {
  yes: boolean;
  checked: boolean;
}

/**
 * Asks a question over `host`: resolves true for the confirm button, false for cancel or Escape.
 * Only one box shows at a time in a host; asking again answers the open box false. Focus stays in
 * the box while it is open and goes back to where it was when it closes.
 */
export function confirmBox(host: HTMLElement, opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => openConfirm(host, opts, (c) => resolve(c.yes)));
}

/** `confirmBox`, answering with the checkbox's state too (`opts.check`). */
export function confirmChoice(host: HTMLElement, opts: ConfirmOptions): Promise<ConfirmChoice> {
  return new Promise((resolve) => openConfirm(host, opts, resolve));
}

function openConfirm(
  host: HTMLElement,
  opts: ConfirmOptions,
  resolve: (c: ConfirmChoice) => void,
): void {
  host
    .querySelector<HTMLElement>(".control-panel-confirm")
    ?.dispatchEvent(new Event("control-panel-cancel"));
  const before = document.activeElement;
  const shade = action(document.createElement("div"), "control-panel-confirm-backdrop");
  shade.className = "control-panel-confirm";
  const box = action(document.createElement("div"), "control-panel-confirm");
  box.className = "control-panel-confirm-box";
  // Clicking the question's text keeps focus in the box, so Escape and Tab still work.
  box.tabIndex = -1;
  box.setAttribute("role", "alertdialog");
  box.setAttribute("aria-modal", "true");
  const p = document.createElement("p");
  fieldIds += 1;
  p.id = `control-panel-confirm-text-${fieldIds}`;
  p.textContent = opts.text;
  box.setAttribute("aria-labelledby", p.id);
  let list: HTMLUListElement | null = null;
  if (opts.list && opts.list.length > 0) {
    list = document.createElement("ul");
    list.className = "control-panel-confirm-list";
    for (const line of opts.list) {
      const li = document.createElement("li");
      li.textContent = line;
      list.append(li);
    }
  }
  let check: HTMLInputElement | null = null;
  let checkRow: HTMLElement | null = null;
  if (opts.check) {
    check = action(document.createElement("input"), opts.check.action);
    check.type = "checkbox";
    check.checked = opts.check.checked === true;
    const label = document.createElement("label");
    label.className = "control-panel-confirm-check";
    label.append(check, ` ${opts.check.label}`);
    checkRow = document.createElement("div");
    checkRow.append(label);
    if (opts.check.hint) {
      const hint = document.createElement("p");
      hint.className = "control-panel-confirm-hint";
      hint.textContent = opts.check.hint;
      checkRow.append(hint);
    }
  }
  const done = (yes: boolean) => {
    shade.remove();
    if (before instanceof HTMLElement && before.isConnected) {
      before.focus();
    }
    resolve({ yes, checked: check?.checked === true });
  };
  const stay = panelButton("control-panel-confirm-cancel", opts.cancel, () => done(false));
  const go = panelButton(
    "control-panel-confirm-ok",
    opts.confirm,
    () => done(true),
    opts.danger ? "danger" : "primary",
  );
  const buttons = document.createElement("div");
  buttons.className = "control-panel-confirm-buttons";
  buttons.append(stay, go);
  box.append(p, ...(list ? [list] : []), ...(checkRow ? [checkRow] : []), buttons);
  box.addEventListener("keydown", (e) => {
    trapTab(box, e);
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      done(false);
    }
  });
  shade.addEventListener("control-panel-cancel", () => done(false));
  // A click on the dimmed backdrop does not move focus out from under the question.
  shade.addEventListener("pointerdown", (e) => {
    if (e.target === shade) {
      e.preventDefault();
    }
  });
  shade.append(box);
  host.append(shade);
  stay.focus();
}

/** The label a section's tab shows: its `data-tab`, or its title. */
function tabLabel(sec: HTMLElement): string {
  return (
    sec.dataset.tab ??
    sec.querySelector(":scope > .balance-row-title, :scope > summary")?.textContent?.trim() ??
    ""
  );
}

/** The tab that shows every section at once. */
export const ALL_SECTIONS = "All";

export interface SectionTabs {
  /** The tab strip: put it at the top of the form. */
  readonly el: HTMLElement;
  /** The label of the tab showing (`ALL_SECTIONS` for all of them). */
  selected(): string;
  /** Shows the section with this label (or every section). */
  select(label: string): void;
}

/**
 * Turns a long editor form into tabs, one section at a time, so an item's or a monster's rules
 * need no scrolling. The sections are `form`'s `.balance-row` elements (not one inside another),
 * however a page draws and redraws them: the strip follows the form as it changes, a section the
 * page hides has no tab, and the tab chosen stays chosen from one record to the next (the Attack
 * tab stays open as you move from sword to sword). The last tab shows every section.
 */
export function sectionTabs(form: HTMLElement, id: string): SectionTabs {
  const strip = document.createElement("div");
  strip.className = "control-panel-tabs";
  strip.setAttribute("role", "tablist");
  strip.setAttribute("aria-label", "Sections");
  strip.hidden = true;
  let chosen = "";
  let labels: string[] = [];
  let sections: HTMLElement[] = [];

  const collect = () =>
    [...form.querySelectorAll<HTMLElement>(".balance-row")].filter(
      (s) =>
        !s.hidden &&
        !strip.contains(s) &&
        !s.parentElement?.closest(".balance-row") &&
        // A section inside a part the page hid (a form not open) has no tab either.
        !s.parentElement?.closest("[hidden]") &&
        tabLabel(s) !== "",
    );

  const show = () => {
    const current = labels.includes(chosen) || chosen === ALL_SECTIONS ? chosen : labels[0];
    for (const s of sections) {
      s.classList.toggle(
        "control-panel-tab-hidden",
        current !== ALL_SECTIONS && tabLabel(s) !== current,
      );
    }
    // A section that saves on its own (`data-own-save`): the form's Save bar steps aside.
    form.classList.toggle(
      "control-panel-own-save",
      current !== ALL_SECTIONS &&
        sections.some((s) => tabLabel(s) === current && s.dataset.ownSave !== undefined),
    );
    for (const b of strip.querySelectorAll<HTMLButtonElement>("button")) {
      const on = b.dataset.tab === current;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
    }
  };

  const sync = () => {
    sections = collect();
    const next = sections.map(tabLabel);
    if (next.join("\n") !== labels.join("\n")) {
      labels = next;
      strip.replaceChildren(
        ...[...labels, ALL_SECTIONS].map((label) => {
          const b = action(document.createElement("button"), `${id}-tab`);
          b.type = "button";
          b.className = "control-panel-tab";
          b.setAttribute("role", "tab");
          b.dataset.tab = label;
          b.textContent = label;
          b.addEventListener("click", () => select(label));
          return b;
        }),
      );
      strip.hidden = labels.length < 2;
    }
    show();
  };

  const select = (label: string) => {
    chosen = label;
    show();
  };

  // Arrow keys, Home and End move between tabs (the tab pattern), choosing as they go.
  strip.addEventListener("keydown", (e) => {
    const tabs = [...strip.querySelectorAll<HTMLButtonElement>("button")];
    const at = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) {
      return;
    }
    const to =
      e.key === "ArrowRight"
        ? (at + 1) % tabs.length
        : e.key === "ArrowLeft"
          ? (at - 1 + tabs.length) % tabs.length
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? tabs.length - 1
              : -1;
    const tab = tabs[to];
    if (tab) {
      e.preventDefault();
      select(tab.dataset.tab ?? "");
      tab.focus();
    }
  });

  let queued = false;
  new MutationObserver((records) => {
    if (queued || records.every((r) => strip.contains(r.target))) {
      return;
    }
    queued = true;
    queueMicrotask(() => {
      queued = false;
      sync();
    });
  }).observe(form, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["hidden"],
  });
  sync();

  return {
    el: strip,
    selected: () =>
      labels.includes(chosen) || chosen === ALL_SECTIONS ? chosen : (labels[0] ?? ""),
    select,
  };
}

/**
 * Where a record's rules come from (its own definition, or the pack's rows), folded away under a
 * one-line summary so it does not crowd the fields.
 */
export function sourcesNote(head: string, lines: readonly string[]): HTMLElement {
  const box = document.createElement("details");
  box.className = "control-panel-sources";
  const summary = action(document.createElement("summary"), "control-panel-sources-toggle");
  summary.textContent = `${head.replace(/:$/, "")} (${lines.length})`;
  const ul = document.createElement("ul");
  ul.className = "items-sources";
  for (const line of lines) {
    const li = document.createElement("li");
    li.textContent = line;
    ul.append(li);
  }
  box.append(summary, ul);
  return box;
}

/** A form's bar of actions and its status line, kept in view at the bottom as the form scrolls. */
export function formActions(...parts: HTMLElement[]): HTMLElement {
  const bar = document.createElement("div");
  bar.className = "control-panel-form-actions";
  bar.append(...parts);
  return bar;
}
