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

/** Keeps Tab and Shift+Tab inside `box`'s buttons, so a question cannot be tabbed past. */
export function trapTab(box: HTMLElement, e: KeyboardEvent): void {
  if (e.key !== "Tab") {
    return;
  }
  const stops = [...box.querySelectorAll<HTMLElement>("button:not([disabled])")];
  // The box itself (focused by a click on its text) counts as outside the buttons.
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
}

/**
 * Asks a question over `host`: resolves true for the confirm button, false for cancel or Escape.
 * Only one box shows at a time in a host; asking again answers the open box false. Focus stays in
 * the box while it is open and goes back to where it was when it closes.
 */
export function confirmBox(host: HTMLElement, opts: ConfirmOptions): Promise<boolean> {
  host
    .querySelector<HTMLElement>(".control-panel-confirm")
    ?.dispatchEvent(new Event("control-panel-cancel"));
  const before = document.activeElement;
  return new Promise((resolve) => {
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
    const done = (yes: boolean) => {
      shade.remove();
      if (before instanceof HTMLElement && before.isConnected) {
        before.focus();
      }
      resolve(yes);
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
    box.append(p, buttons);
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
  });
}
