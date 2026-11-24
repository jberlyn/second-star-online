/**
 * The Control Panel's Items page (issue #30): every item in a searchable list, and a form for the
 * one open, showing what it plays now and where each rule comes from (its own definition, or the
 * pack's rows that match it). Saving writes the item's definition (`items/definitions/<name>`): one
 * record of its rules, which the content store compiles into exact rows that win in every table.
 * An SSO page: 1.6 kept its items' rules in its scripts.
 *
 * Changes go into the content store's shared draft, so the Content page publishes, undoes and
 * notices them like any other row. A change carries the item as the page showed it (`fingerprint`),
 * and the server refuses it if someone changed the item since (here or in the Content page's JSON
 * editor). Pictures use #29's panels, made by the Content page; removing an item goes through the
 * Content page's where-used report and removal form (#28).
 *
 * Refreshes never touch a form being edited: its fields and fingerprint stay as they were filled,
 * while its tags and sources follow the server.
 */
import type { ItemDefinition } from "@secondstaronline/data";
import type {
  ContentItemsView,
  ContentItemView,
  ContentProblemView,
  ContentRowRef,
  ItemListEntry,
} from "@secondstaronline/shared";
import { definesBehaviours } from "@secondstaronline/shared";

import { action, noAutofill } from "./action.ts";
import type { ItemPanels } from "./content-page.ts";
import { pageHeading, panelButton } from "./control-panel-kit.ts";

/** An Items page change as the page sends it. */
export interface ItemChange {
  name: string;
  op: "set" | "revert" | "discard" | "rename" | "create";
  data?: unknown;
  display?: string;
  copyFrom?: string;
  expect?: string;
}

export interface ItemsPageActions {
  /** Asks for the view, with the form of `name`. */
  view(seq: number, name?: string): void;
  /** Sends one change; the answer is a `contentItems` with `result`. */
  set(seq: number, change: ItemChange): void;
  /** Opens the Content page, where the draft is published. */
  openContent(): void;
  /** Opens the Content page at a row (an item's removal, a notice). */
  openContentRow(row: ContentRowRef): void;
  /** #29's picture and worn panels (null with no art). */
  panels(saved: () => void): ItemPanels | null;
}

/** The answer the server sends the page. */
export interface ItemsAnswer {
  t: "contentItems";
  seq: number;
  view: ContentItemsView;
  result?: { ok: boolean; text: string; problems?: ContentProblemView[] };
}

export interface ItemsPage {
  readonly el: HTMLElement;
  onShow(): void;
  /** Unsaved changes: the open form's (not while its save is on its way) and its panels'. */
  changes(): number;
  /** Puts the form back to what the server last showed. */
  discard(): void;
  receive(msg: ItemsAnswer): void;
  /** A publish or undo went live: ask again. */
  published(): void;
  /** A new session, or the permission went: drop everything. */
  reset(): void;
  /** Opens an item's form. */
  open(name: string): void;
}

type Obj = Record<string, unknown>;

/** A value's JSON with keys sorted and empty parts left out, to tell whether two forms differ. */
export function canonical(v: unknown): string {
  return JSON.stringify(clean(v) ?? null);
}

/** A definition with empty lists and objects (and undefined values) left out, keys sorted. */
export function clean(v: unknown): unknown {
  if (Array.isArray(v)) {
    return v.map((x) => clean(x) ?? null);
  }
  if (v !== null && typeof v === "object") {
    const out: Obj = {};
    for (const k of Object.keys(v as Obj).sort()) {
      const x = clean((v as Obj)[k]);
      if (
        x === undefined ||
        (Array.isArray(x) && x.length === 0) ||
        (x !== null && typeof x === "object" && !Array.isArray(x) && Object.keys(x).length === 0)
      ) {
        continue;
      }
      out[k] = x;
    }
    return out;
  }
  return v;
}

/** The range of `flat + random(n)`: "Always 6", "Rolls 7 to 12". */
export function rollRange(flat: number, randomN: number | null): string {
  return !randomN ? `Always ${flat}` : `Rolls ${flat + 1} to ${flat + randomN}`;
}

/** The definition's keys each group of the form holds. */
const GROUP_KEYS: Record<string, readonly (keyof ItemDefinition)[]> = {
  equip: ["slot", "strength", "twoHanded", "behaviours"],
  attack: ["attack", "trains"],
  armour: ["armour", "elemental", "spellDefense", "gear", "cooldowns", "sound"],
  use: ["use"],
};

const GROUP_TITLES: Record<string, string> = {
  equip: "Equip",
  attack: "Attack",
  armour: "Armour and gear",
  use: "Use",
};

const KIND_TEXT: Record<ItemListEntry["kind"], string> = {
  weapon: "Weapon",
  armour: "Armour",
  food: "Food",
  other: "Other",
};

/** A column of a list of records (attack rolls, armour rows, use effects). */
interface Column {
  key: string;
  label: string;
  kind: "int" | "intOrNull" | "bool" | "select" | "text";
  min?: number;
  max?: number;
  options?: () => string[];
}

/** A list of records in the definition, at a path: its columns and a new record. */
interface ListSpec {
  id: string;
  label: string;
  path: string[];
  help: string;
  columns: Column[];
  fresh(): Obj;
  /** A row's preview (a roll's range). */
  preview?(row: Obj): string;
}

/** The value at `path`. */
function at(v: unknown, path: readonly string[]): unknown {
  let o = v;
  for (const p of path) {
    o = o !== null && typeof o === "object" ? (o as Obj)[p] : undefined;
  }
  return o;
}

/** Sets `path` to `n` (undefined deletes it), making objects on the way. */
function put(root: Obj, path: readonly string[], n: unknown): void {
  let o = root;
  path.forEach((p, i) => {
    if (i === path.length - 1) {
      if (n === undefined) {
        delete o[p];
      } else {
        o[p] = n;
      }
      return;
    }
    const next = o[p];
    if (next === null || typeof next !== "object") {
      o[p] = {};
    }
    o = o[p] as Obj;
  });
}

export function createItemsPage(actions: ItemsPageActions): ItemsPage {
  const el = document.createElement("div");
  el.className = "items-page balance-page";
  el.append(
    pageHeading(
      "Items",
      "Every item's rules in one form: its slot, Strength, attack, armour, gear, what Use does and the skills it trains. Saving gives the item a definition of its own, which plays instead of the pack's rows that match it. Changes go into the content draft, published from the Content page.",
    ),
  );
  const draftLine = document.createElement("div");
  draftLine.className = "balance-draft";
  draftLine.hidden = true;
  const draftText = document.createElement("span");
  draftLine.append(
    draftText,
    panelButton("items-open-content", "Review and publish on the Content page", () =>
      actions.openContent(),
    ),
  );

  // ---- a new item ----
  const newBox = document.createElement("details");
  newBox.className = "items-new";
  const newSummary = action(document.createElement("summary"), "items-new-toggle");
  newSummary.textContent = "New item";
  const field = (
    label: string,
    input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
    id: string,
    help = "",
  ) => {
    input.id = id;
    const wrap = document.createElement("div");
    wrap.className = "control-panel-field balance-field";
    const l = document.createElement("label");
    l.className = "control-panel-field-label";
    l.htmlFor = id;
    l.textContent = label;
    wrap.append(l, input);
    if (help) {
      const h = document.createElement("p");
      h.className = "control-panel-field-help";
      h.textContent = help;
      wrap.append(h);
    }
    return wrap;
  };
  const newName = noAutofill(action(document.createElement("input"), "items-new-name"));
  newName.maxLength = 40;
  const newDisplay = noAutofill(action(document.createElement("input"), "items-new-display"));
  newDisplay.maxLength = 40;
  const newFrom = noAutofill(action(document.createElement("input"), "items-new-copy"));
  const namesList = document.createElement("datalist");
  namesList.id = "items-names";
  newFrom.setAttribute("list", namesList.id);
  const newStatus = document.createElement("p");
  newStatus.className = "balance-status";
  newStatus.setAttribute("role", "status");
  const createBtn = panelButton(
    "items-create",
    "Make it in the draft",
    () => {
      const name = newName.value.trim();
      if (name === "") {
        newStatus.textContent = "Give it a name.";
        return;
      }
      seq += 1;
      saving.set(seq, { name, create: true });
      createBtn.disabled = true;
      newStatus.textContent = "Saving…";
      const from = newFrom.value.trim();
      actions.set(seq, {
        name,
        op: "create",
        ...(newDisplay.value.trim() ? { display: newDisplay.value.trim() } : {}),
        ...(from
          ? {
              copyFrom:
                list.find((i) => i.display.toLowerCase() === from.toLowerCase())?.name ?? from,
            }
          : {}),
      });
    },
    "primary",
  );
  newBox.append(
    newSummary,
    field(
      "Name",
      newName,
      "items-new-name",
      "Its permanent key: rules, maps and saved characters name it by this, so it never changes. Rename it later by its display name.",
    ),
    field(
      "Display name",
      newDisplay,
      "items-new-display",
      "What players see. Leave it empty to show the name.",
    ),
    field(
      "Copy the rules and picture of",
      newFrom,
      "items-new-copy",
      "Optional: an item it starts as (the safe way to make a new sword). Change what you like after.",
    ),
    namesList,
    createBtn,
    newStatus,
  );

  // ---- the list ----
  const listBox = document.createElement("section");
  listBox.className = "items-list-box";
  const search = noAutofill(action(document.createElement("input"), "items-search"));
  search.type = "search";
  search.placeholder = "Find an item";
  const kindSel = action(document.createElement("select"), "items-kind");
  for (const [v, t] of [
    ["all", "Every kind"],
    ["weapon", "Weapons"],
    ["armour", "Armour"],
    ["food", "Food"],
    ["other", "Other"],
    ["changed", "Changed or yours"],
    ["retired", "Retired"],
  ]) {
    const o = document.createElement("option");
    o.value = v as string;
    o.textContent = t as string;
    kindSel.append(o);
  }
  const listEl = document.createElement("ul");
  listEl.className = "items-list";
  listEl.setAttribute("aria-label", "Items");
  const listCount = document.createElement("p");
  listCount.className = "control-panel-field-help";
  listBox.append(
    field("Find", search, "items-search"),
    field("Show", kindSel, "items-kind"),
    listCount,
    listEl,
  );

  // ---- the form ----
  const form = document.createElement("section");
  form.className = "items-form";
  form.hidden = true;
  const title = document.createElement("h2");
  title.className = "content-section-title";
  const tags = document.createElement("div");
  tags.className = "balance-tags";
  const noticeLine = document.createElement("p");
  noticeLine.className = "balance-stale";
  noticeLine.hidden = true;
  const noticeText = document.createElement("span");
  noticeLine.append(
    noticeText,
    " ",
    panelButton("items-notice", "Answer it on the Content page", () => {
      if (shown) {
        actions.openContentRow({ dataset: "items", part: "definitions", key: shown.name });
      }
    }),
  );
  const stale = document.createElement("p");
  stale.className = "balance-stale";
  stale.hidden = true;
  stale.textContent =
    "Someone changed this item since you started editing it: saving will be refused. Drop your edit to see theirs.";
  // Identity: the display name and the pictures.
  const identity = document.createElement("section");
  identity.className = "balance-row";
  const identityTitle = document.createElement("h3");
  identityTitle.className = "balance-row-title";
  identityTitle.textContent = "Name and pictures";
  const display = noAutofill(action(document.createElement("input"), "items-display"));
  display.maxLength = 40;
  const renameBtn = panelButton("items-rename", "Rename in the draft", () => {
    if (shown) {
      send({
        name: shown.name,
        op: "rename",
        display: display.value.trim(),
        expect: shown.fingerprint,
      });
    }
  });
  const removeBtn = panelButton(
    "items-remove",
    "Remove or retire… (where it is used)",
    () => {
      if (shown) {
        actions.openContentRow({ dataset: "items", part: "items", key: shown.name });
      }
    },
    "danger",
  );
  const picturesHost = document.createElement("div");
  picturesHost.className = "items-pictures-host";
  identity.append(
    identityTitle,
    field("Display name", display, "items-display", "What players see; empty shows its name."),
    renameBtn,
    removeBtn,
    picturesHost,
  );
  // The rule groups: one fieldset, locked while a save is on its way.
  const rules = document.createElement("fieldset");
  rules.className = "items-rules";
  const groupsEl = document.createElement("div");
  rules.append(groupsEl);
  const status = document.createElement("p");
  status.className = "balance-status";
  status.setAttribute("role", "status");
  const saveBtn = panelButton(
    "items-save",
    "Save to the draft",
    () => {
      if (shown) {
        send({ name: shown.name, op: "set", data: clean(work), expect: filled.fingerprint });
      }
    },
    "primary",
  );
  const undoEditBtn = panelButton("items-undo-edit", "Drop my edit", () => {
    fill();
    status.textContent = "";
    update();
  });
  const revertBtn = panelButton("items-revert", "Play the pack's rules again", () => {
    if (shown) {
      send({ name: shown.name, op: "revert", expect: shown.fingerprint });
    }
  });
  const dropBtn = panelButton("items-discard", "Drop the draft's changes", () => {
    if (shown) {
      send({ name: shown.name, op: "discard", expect: shown.fingerprint });
    }
  });
  const buttons = document.createElement("div");
  buttons.className = "content-buttons";
  buttons.append(saveBtn, undoEditBtn, revertBtn, dropBtn);
  form.append(title, tags, noticeLine, stale, identity, rules, buttons, status);
  const loading = document.createElement("p");
  loading.className = "balance-loading";
  loading.textContent = "Loading…";
  const layout = document.createElement("div");
  layout.className = "items-layout";
  layout.append(listBox, form);
  el.append(draftLine, newBox, loading, layout);

  // ---- state ----
  let seq = 0;
  /** Answers to requests sent before the last `reset` are dropped. */
  let resetSeq = -1;
  /** The newest view applied: an older one never replaces it. */
  let appliedSeq = -1;
  /** Saves waiting for their answer: the item each is for. */
  const saving = new Map<number, { name: string; create?: boolean; op?: ItemChange["op"] }>();
  let list: ItemListEntry[] = [];
  /** The item open, as asked (its form shows once the server answers). */
  let openName: string | null = null;
  /** The open item's view. */
  let shown: ContentItemView | null = null;
  /** The form's working definition, and what it was filled from. */
  let work: Obj = {};
  let filled: { value: string; fingerprint: string; display: string; slot: unknown } = {
    value: "",
    fingerprint: "",
    display: "",
    slot: undefined,
  };
  let busy = false;
  /** Fields whose text does not read (their errors). */
  const invalid = new Map<HTMLElement, string>();
  let panels: ItemPanels | null | undefined;

  /** Forgets the errors of fields no longer on the page (redrawn from the working definition). */
  const forgetGone = () => {
    for (const el of [...invalid.keys()]) {
      if (!el.isConnected) {
        invalid.delete(el);
      }
    }
  };
  /** The rules section has an edit (or text that does not read) not yet saved. */
  const rulesDirty = () => shown !== null && (canonical(work) !== filled.value || invalid.size > 0);
  /** The display name has an edit not yet renamed. */
  const nameDirty = () => shown !== null && display.value.trim() !== filled.display;
  const dirty = () => rulesDirty() || nameDirty();

  const send = (change: ItemChange) => {
    if (busy) {
      return;
    }
    // What the server's message check would refuse unanswered is refused here, before the form
    // locks waiting for an answer that would never come.
    const tooLong =
      change.name.trim().length > 80
        ? "That item's name is longer than 80 characters."
        : (change.display ?? "").length > 40
          ? "A display name is at most 40 characters."
          : null;
    if (tooLong) {
      status.textContent = tooLong;
      status.className = "balance-status balance-status-error";
      return;
    }
    // Locked before the request goes, so nothing typed from here on can be lost.
    busy = true;
    status.textContent = "Saving…";
    status.className = "balance-status";
    update();
    seq += 1;
    saving.set(seq, { name: change.name, op: change.op });
    actions.set(seq, change);
  };

  const ask = () => {
    seq += 1;
    actions.view(seq, openName ?? undefined);
  };

  // ---- the form's controls ----
  const choices = () => shown?.choices;
  const intInput = (
    value: unknown,
    min: number,
    max: number,
    nullable: boolean,
    label: string,
    write: (n: number | null | undefined) => void,
    id: string,
  ) => {
    const input = noAutofill(action(document.createElement("input"), id));
    input.type = "number";
    input.min = String(min);
    input.max = String(max);
    input.step = "1";
    input.value = typeof value === "number" ? String(value) : "";
    if (nullable) {
      input.placeholder = "none";
    }
    input.addEventListener("input", () => {
      const t = input.value.trim();
      if (t === "" && nullable) {
        invalid.delete(input);
        write(null);
      } else if (!/^-?\d+$/.test(t) || Number(t) < min || Number(t) > max) {
        invalid.set(input, `${label}: a whole number from ${min} to ${max}`);
      } else {
        invalid.delete(input);
        write(Number(t));
      }
      edited();
    });
    return input;
  };
  const select = (
    value: string,
    options: readonly (readonly [string, string])[],
    id: string,
    write: (v: string) => void,
  ) => {
    const sel = action(document.createElement("select"), id);
    for (const [v, t] of options) {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = t;
      sel.append(o);
    }
    sel.value = value;
    sel.addEventListener("change", () => {
      write(sel.value);
      edited();
    });
    return sel;
  };
  const check = (on: boolean, label: string, id: string, write: (on: boolean) => void) => {
    const wrap = document.createElement("label");
    wrap.className = "items-check";
    const box = action(document.createElement("input"), id);
    box.type = "checkbox";
    box.checked = on;
    box.addEventListener("change", () => {
      write(box.checked);
      edited();
    });
    wrap.append(box, ` ${label}`);
    return wrap;
  };
  let fieldIds = 0;
  const labelled = (label: string, control: HTMLElement, help = "") => {
    const wrap = document.createElement("div");
    wrap.className = "control-panel-field balance-field";
    const l = document.createElement("label");
    l.className = "control-panel-field-label";
    fieldIds += 1;
    control.id ||= `items-field-${fieldIds}`;
    l.htmlFor = control.id;
    l.textContent = label;
    wrap.append(l, control);
    if (help) {
      const h = document.createElement("p");
      h.className = "control-panel-field-help";
      h.textContent = help;
      wrap.append(h);
    }
    return wrap;
  };

  /** A list of records: a table of rows, each removable, and an Add button. */
  const listEditor = (spec: ListSpec) => {
    const box = document.createElement("div");
    box.className = "items-list-editor";
    box.dataset.list = spec.id;
    const head = document.createElement("h4");
    head.className = "items-list-title";
    head.textContent = spec.label;
    const help = document.createElement("p");
    help.className = "control-panel-field-help";
    help.textContent = spec.help;
    const rowsEl = document.createElement("div");
    const draw = () => {
      const arr = (at(work, spec.path) as Obj[] | undefined) ?? [];
      rowsEl.replaceChildren(
        ...arr.map((row, i) => {
          const line = document.createElement("div");
          line.className = "items-list-row";
          const preview = document.createElement("span");
          preview.className = "control-panel-field-help balance-preview";
          const showPreview = () => {
            if (spec.preview) {
              preview.textContent = spec.preview(row);
            }
          };
          for (const c of spec.columns) {
            const id = `items-${spec.id}-${c.key}`;
            let control: HTMLElement;
            if (c.kind === "int" || c.kind === "intOrNull") {
              control = intInput(
                row[c.key],
                c.min ?? 0,
                c.max ?? 9999,
                c.kind === "intOrNull",
                `${spec.label} ${i + 1}: ${c.label}`,
                (n) => {
                  row[c.key] = n;
                  showPreview();
                },
                id,
              );
            } else if (c.kind === "bool") {
              control = check(row[c.key] === true, c.label, id, (on) => {
                if (on) {
                  row[c.key] = true;
                } else {
                  delete row[c.key];
                }
                showPreview();
              });
            } else if (c.kind === "select") {
              const opts = (c.options?.() ?? []).map((o) => [o, o] as const);
              control = select(String(row[c.key] ?? ""), opts, id, (v) => {
                row[c.key] = v;
              });
            } else {
              const t = noAutofill(action(document.createElement("input"), id));
              t.value = String(row[c.key] ?? "");
              t.addEventListener("input", () => {
                row[c.key] = t.value;
                edited();
              });
              control = t;
            }
            line.append(c.kind === "bool" ? control : labelled(c.label, control));
          }
          line.append(
            panelButton(`items-${spec.id}-remove`, "Remove", () => {
              arr.splice(i, 1);
              put(work, spec.path, arr.length > 0 ? arr : undefined);
              draw();
              // Only the redrawn list's errors go: another field's text that does not read stays
              // refused, so Save never sends its old value.
              forgetGone();
              edited();
            }),
            preview,
          );
          showPreview();
          return line;
        }),
      );
    };
    const add = panelButton(
      `items-${spec.id}-add`,
      `Add ${spec.label.toLowerCase().replace(/s$/, "")}`,
      () => {
        const arr = (at(work, spec.path) as Obj[] | undefined) ?? [];
        arr.push(spec.fresh());
        put(work, spec.path, arr);
        draw();
        edited();
      },
    );
    draw();
    box.append(head, help, rowsEl, add);
    return box;
  };

  const ROLL_COLUMNS: Column[] = [
    { key: "flat", label: "Fixed", kind: "int", min: -9999, max: 9999 },
    { key: "randomN", label: "+ random(n)", kind: "int", min: 0, max: 9999 },
    { key: "strengthHalf", label: "+ random(Strength) / 2", kind: "bool" },
  ];
  const rollPreview = (r: Obj) =>
    `${rollRange(Number(r.flat ?? 0), Number(r.randomN ?? 0))}${r.strengthHalf ? ", + random(Strength) / 2" : ""}`;

  /** Builds the four rule groups from `work`. */
  const drawGroups = () => {
    const c = choices();
    if (!c || !shown) {
      groupsEl.replaceChildren();
      return;
    }
    const item = shown;
    const group = (id: string, ...controls: HTMLElement[]) => {
      const sec = document.createElement("section");
      sec.className = "balance-row items-group";
      sec.dataset.group = id;
      const h = document.createElement("h3");
      h.className = "balance-row-title";
      h.textContent = GROUP_TITLES[id] ?? id;
      const from = document.createElement("ul");
      from.className = "items-sources";
      for (const s of item.sources.filter((x) => x.group === id)) {
        const li = document.createElement("li");
        li.textContent = `${s.label}: ${s.from}`;
        from.append(li);
      }
      const fromHead = document.createElement("p");
      fromHead.className = "control-panel-field-help";
      fromHead.textContent = item.defined
        ? "In the draft it plays its own definition:"
        : "What it plays now comes from:";
      sec.append(h, fromHead, from, ...controls);
      if (item.pack) {
        const pack = item.pack;
        sec.append(
          panelButton(`items-pack-${id}`, "Use the pack's rules here", () => {
            for (const k of GROUP_KEYS[id] ?? []) {
              const v = (pack as Obj)[k];
              put(work, [k], v === undefined ? undefined : structuredClone(v));
            }
            drawGroups();
            forgetGone();
            edited();
          }),
        );
      }
      return sec;
    };
    // The same test the server uses: a name whose behaviours are its base item's.
    const masterwork = !definesBehaviours(item.name);
    const equip = group(
      "equip",
      labelled(
        "Slot",
        select(
          String(work.slot ?? ""),
          [
            ["", "None (not equipped)"],
            ...c.slots.map((s) => [s, s === "No" ? "No (Equip refuses it)" : s] as const),
          ],
          "items-slot",
          (v) => put(work, ["slot"], v === "" ? undefined : v),
        ),
        "1.6's weapon hand is LeftHand; RightHand holds a shield.",
      ),
      labelled(
        "Strength needed",
        intInput(
          work.strength,
          0,
          200,
          true,
          "Strength needed",
          (n) => put(work, ["strength"], n ?? undefined),
          "items-strength",
        ),
        "Empty: none.",
      ),
      check(work.twoHanded === true, "Takes both hands", "items-two-handed", (on) =>
        put(work, ["twoHanded"], on ? true : undefined),
      ),
    );
    if (masterwork) {
      const p = document.createElement("p");
      p.className = "control-panel-field-help";
      p.textContent = "A +N masterwork takes its behaviours from the item it is made from.";
      equip.append(p);
    } else {
      const behaviours = document.createElement("div");
      behaviours.className = "items-checks";
      behaviours.dataset.list = "behaviours";
      const has = new Set((work.behaviours as string[] | undefined) ?? []);
      for (const b of c.behaviours) {
        behaviours.append(
          check(has.has(b), b, `items-behaviour-${b}`, (on) => {
            if (on) {
              has.add(b);
            } else {
              has.delete(b);
            }
            put(
              work,
              ["behaviours"],
              has.size > 0 ? c.behaviours.filter((x) => has.has(x)) : undefined,
            );
          }),
        );
      }
      equip.append(
        labelled("Behaviours", behaviours, "What it does: a bow, a key, a sword for Firesword…"),
      );
    }
    // Attack.
    const tiers = noAutofill(action(document.createElement("textarea"), "items-tiers"));
    tiers.rows = 4;
    tiers.value =
      work.attack && (work.attack as Obj).blocks
        ? JSON.stringify((work.attack as Obj).blocks, null, 1)
        : "";
    tiers.addEventListener("input", () => {
      const t = tiers.value.trim();
      if (t === "") {
        invalid.delete(tiers);
        put(work, ["attack", "blocks"], undefined);
      } else {
        try {
          const v = JSON.parse(t) as unknown;
          if (!Array.isArray(v)) {
            throw new Error("a list");
          }
          invalid.delete(tiers);
          put(work, ["attack", "blocks"], v);
        } catch {
          invalid.set(tiers, "Skill tiers: a JSON list of blocks");
        }
      }
      edited();
    });
    const trains = document.createElement("div");
    trains.className = "items-checks";
    trains.dataset.list = "trains";
    const trained = new Set(
      ((work.trains as string[] | undefined) ?? []).map((s) => s.toLowerCase()),
    );
    for (const s of c.skills) {
      trains.append(
        check(trained.has(s.toLowerCase()), s, `items-trains-${s.replace(/\W/g, "-")}`, (on) => {
          if (on) {
            trained.add(s.toLowerCase());
          } else {
            trained.delete(s.toLowerCase());
          }
          const list = c.skills.filter((x) => trained.has(x.toLowerCase()));
          put(work, ["trains"], list.length > 0 ? list : undefined);
        }),
      );
    }
    const attack = group(
      "attack",
      listEditor({
        id: "base",
        label: "Attack rolls",
        path: ["attack", "base"],
        help: "Its attack power: each roll draws in turn and the last stands (the Gold Axe draws an Axe's roll first).",
        columns: ROLL_COLUMNS,
        fresh: () => ({ flat: 1, randomN: 6 }),
        preview: rollPreview,
      }),
      listEditor({
        id: "overrides",
        label: "Override rolls",
        path: ["attack", "overrides"],
        help: "Rolled after the gear bonus, replacing the power: few items have any.",
        columns: ROLL_COLUMNS,
        fresh: () => ({ flat: 1, randomN: 6 }),
        preview: rollPreview,
      }),
      labelled(
        "Skill tiers (JSON)",
        tiers,
        'The skill tiers added to its power, block by block: [{"tiers":[{"subWeapon":null,"when":["Slash > 10"],"op":"add","value":1}]}]. Empty: none.',
      ),
      labelled("Trains", trains, "The skills a kill with it trains. None ticked: it trains none."),
    );
    // Armour and gear.
    const sound = noAutofill(action(document.createElement("input"), "items-sound"));
    sound.value = typeof work.sound === "string" ? work.sound : "";
    sound.placeholder = "the default swing";
    sound.disabled = work.sound === null;
    sound.addEventListener("input", () => {
      put(work, ["sound"], sound.value.trim() === "" ? undefined : sound.value.trim());
      edited();
    });
    const armour = group(
      "armour",
      listEditor({
        id: "armour",
        label: "Armour rows",
        path: ["armour"],
        help: "Mitigation while worn in the row's slot (HitMe, and HitMe2 or none).",
        columns: [
          { key: "slot", label: "Slot", kind: "select", options: () => c.slotVars },
          { key: "hitMe", label: "HitMe", kind: "int", min: -999, max: 999 },
          { key: "hitMe2", label: "HitMe2", kind: "intOrNull", min: -999, max: 999 },
        ],
        fresh: () => ({ slot: c.slotVars[0] ?? "BodyE", hitMe: 1, hitMe2: null }),
      }),
      listEditor({
        id: "elemental",
        label: "Elemental armour",
        path: ["elemental"],
        help: "Armour against a trigger (a spell effect), while worn in the slot.",
        columns: [
          { key: "handler", label: "Handler", kind: "select", options: () => ["HitMe", "HitMe2"] },
          { key: "trigger", label: "Trigger", kind: "text" },
          { key: "slot", label: "Slot", kind: "select", options: () => c.slotVars },
          { key: "delta", label: "Adds", kind: "int", min: -999, max: 999 },
        ],
        fresh: () => ({ handler: "HitMe", trigger: "", slot: c.slotVars[0] ?? "BodyE", delta: 1 }),
      }),
      listEditor({
        id: "spellDefense",
        label: "Spell defence",
        path: ["spellDefense"],
        help: "Spell damage it takes off (or adds) while worn in the slot.",
        columns: [
          { key: "slot", label: "Slot", kind: "select", options: () => c.slotVars },
          { key: "delta", label: "Takes off", kind: "int", min: -999, max: 999 },
        ],
        fresh: () => ({ slot: c.slotVars[0] ?? "BodyE", delta: 1 }),
      }),
      listEditor({
        id: "gear",
        label: "Gear bonuses",
        path: ["gear"],
        help: "Power it adds while worn in the slot.",
        columns: [
          { key: "slot", label: "Slot", kind: "select", options: () => c.wornSlots },
          { key: "power", label: "Power", kind: "select", options: () => c.powers },
          { key: "add", label: "Adds", kind: "int", min: -999, max: 999 },
        ],
        fresh: () => ({ slot: c.wornSlots[0] ?? "ring", power: c.powers[0] ?? "attack", add: 1 }),
      }),
      listEditor({
        id: "cooldowns",
        label: "Swing cooldowns",
        path: ["cooldowns"],
        help: "The swing delays it sets while worn in the slot (one per slot; frames, 20 a second).",
        columns: [
          { key: "slot", label: "Slot", kind: "select", options: () => c.wornSlots },
          { key: "atDelay", label: "Swing delay", kind: "int", min: 0, max: 1000 },
          { key: "actionDelay", label: "Action delay", kind: "int", min: 0, max: 1000 },
        ],
        fresh: () => ({ slot: "weapon", atDelay: 10, actionDelay: 10 }),
      }),
      labelled("Swing sound", sound, "A sound's name; empty plays the default swing."),
      check(work.sound === null, "Swings silently", "items-silent-swing", (on) => {
        put(work, ["sound"], on ? null : undefined);
        sound.disabled = on;
        sound.value = "";
      }),
    );
    // Use.
    const message = noAutofill(action(document.createElement("input"), "items-use-message"));
    message.value = String(at(work, ["use", "message"]) ?? "");
    message.addEventListener("input", () => {
      put(work, ["use", "message"], message.value === "" ? undefined : message.value);
      edited();
    });
    const refusal = noAutofill(action(document.createElement("input"), "items-use-refusal"));
    refusal.value = String(at(work, ["use", "refusal"]) ?? "");
    refusal.addEventListener("input", () => {
      put(work, ["use", "refusal"], refusal.value.trim() === "" ? undefined : refusal.value);
      edited();
    });
    const use = group(
      "use",
      check(at(work, ["use", "usable"]) === true, "Use accepts it", "items-usable", (on) =>
        put(work, ["use", "usable"], on ? true : undefined),
      ),
      check(
        at(work, ["use", "silent"]) === true,
        "Use says and does nothing",
        "items-use-silent",
        (on) => put(work, ["use", "silent"], on ? true : undefined),
      ),
      listEditor({
        id: "effects",
        label: "Use effects",
        path: ["use", "effects"],
        help: "Each adds a fixed amount plus random(n) to the stat when used (food raises Hunger).",
        columns: [
          { key: "stat", label: "Stat", kind: "select", options: () => c.stats },
          { key: "flat", label: "Fixed", kind: "int", min: -99999, max: 99999 },
          { key: "randomN", label: "+ random(n)", kind: "intOrNull", min: 0, max: 99999 },
        ],
        fresh: () => ({ stat: "Hunger", flat: 1000, randomN: null }),
        preview: (r) =>
          rollRange(Number(r.flat ?? 0), r.randomN === null ? null : Number(r.randomN ?? 0)),
      }),
      labelled(
        "Eat or drink line",
        message,
        '" & SelInventory & " marks the item\'s name. Empty: none.',
      ),
      labelled("Refusal line", refusal, 'Shown in place of "You cannot use the X." Empty: none.'),
    );
    groupsEl.replaceChildren(equip, attack, armour, use);
  };

  /** Fills the rules from the view (what the draft holds). */
  const fillRules = () => {
    if (!shown) {
      return;
    }
    work = structuredClone(shown.form) as Obj;
    filled = { ...filled, value: canonical(work), fingerprint: shown.fingerprint };
    invalid.clear();
    drawGroups();
  };
  /** Fills the display name from the view. */
  const fillName = () => {
    if (!shown) {
      return;
    }
    display.value = shown.display;
    filled = { ...filled, display: shown.display };
  };
  /** Fills the whole form from the view. */
  const fill = () => {
    fillRules();
    fillName();
  };

  const edited = () => {
    status.textContent = "";
    update();
  };

  const update = () => {
    const v = shown;
    if (!v) {
      return;
    }
    title.textContent = v.display && v.display !== v.name ? `${v.display} (${v.name})` : v.name;
    const t: string[] = [];
    t.push(
      v.inPack
        ? v.defined || v.edited
          ? "Has its own definition"
          : "Plays the pack's rules"
        : "Your item",
    );
    if (v.retired) {
      t.push("Retired");
    }
    if (v.pending.definition === "set") {
      t.push("Definition changed in the draft");
    } else if (v.pending.definition !== null) {
      t.push("Definition dropped in the draft");
    }
    if (v.pending.catalogue !== null) {
      t.push("Name or picture changed in the draft");
    }
    tags.replaceChildren(
      ...t.map((x) => {
        const s = document.createElement("span");
        s.className = "balance-tag";
        s.textContent = x;
        return s;
      }),
    );
    noticeLine.hidden = v.notice === null;
    noticeText.textContent = v.notice?.note ?? "";
    const isDirty = dirty();
    stale.hidden = !(isDirty && filled.fingerprint !== v.fingerprint);
    const errs = [...invalid.values()];
    saveBtn.disabled = busy || !isDirty || errs.length > 0;
    undoEditBtn.hidden = !isDirty;
    undoEditBtn.disabled = busy;
    revertBtn.textContent = v.inPack ? "Play the pack's rules again" : "Drop its definition";
    revertBtn.hidden = !(v.defined || v.edited);
    revertBtn.disabled = busy;
    dropBtn.hidden = v.pending.definition === null && v.pending.catalogue === null;
    dropBtn.disabled = busy;
    renameBtn.disabled = busy || !nameDirty();
    removeBtn.disabled = busy;
    // A form being saved takes no typing until the answer comes.
    rules.disabled = busy;
    display.readOnly = busy;
    if (errs.length > 0) {
      status.textContent = errs.join(". ");
      status.className = "balance-status balance-status-error";
    }
  };
  display.addEventListener("input", () => update());

  const drawList = () => {
    const words = search.value
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w !== "");
    const kind = kindSel.value;
    const rows = list.filter((i) => {
      const text = `${i.display} ${i.name}`.toLowerCase();
      if (!words.every((w) => text.includes(w))) {
        return false;
      }
      if (kind === "retired") {
        return i.retired;
      }
      if (kind === "changed") {
        return i.state !== "pack" || i.pending;
      }
      return kind === "all" || i.kind === kind;
    });
    listCount.textContent = `${rows.length} of ${list.length} items`;
    listEl.replaceChildren(
      ...rows.map((i) => {
        const li = document.createElement("li");
        const b = action(document.createElement("button"), "items-open");
        b.type = "button";
        b.className = "items-list-item";
        b.dataset.item = i.name;
        if (openName && i.name.toLowerCase() === openName.toLowerCase()) {
          b.setAttribute("aria-current", "true");
        }
        const name = document.createElement("span");
        name.textContent = i.display === i.name ? i.name : `${i.display} (${i.name})`;
        const meta = document.createElement("span");
        meta.className = "items-list-meta";
        meta.textContent = [
          KIND_TEXT[i.kind],
          i.state === "yours" ? "yours" : i.state === "edited" ? "changed" : "",
          i.retired ? "retired" : "",
          i.pending ? "in the draft" : "",
        ]
          .filter((x) => x !== "")
          .join(" · ");
        b.append(name, " ", meta);
        b.addEventListener("click", () => openItem(i.name));
        li.append(b);
        return li;
      }),
    );
  };
  search.addEventListener("input", drawList);
  kindSel.addEventListener("change", drawList);

  const showPanels = (name: string) => {
    if (panels === undefined) {
      panels = actions.panels(() => {
        // A picture change is in the draft: the list and the form's tags catch up.
        if (el.isConnected) {
          ask();
        }
        if (openName) {
          panels?.show(openName);
        }
      });
      if (panels) {
        picturesHost.append(panels.el);
      }
    }
    panels?.show(name);
  };

  const openItem = (name: string) => {
    if (shown && (dirty() || busy || panels?.pending())) {
      status.textContent = busy
        ? "Wait for the save to finish."
        : `${shown.display || shown.name} has unsaved changes: save them or drop your edit first.`;
      status.className = "balance-status balance-status-error";
      return;
    }
    openName = name;
    shown = null;
    form.hidden = true;
    status.textContent = "";
    drawList();
    ask();
  };

  const show = (view: ContentItemsView) => {
    loading.hidden = true;
    list = view.items;
    namesList.replaceChildren(
      ...list.map((i) => {
        const o = document.createElement("option");
        o.value = i.display;
        return o;
      }),
    );
    drawList();
    const total = view.itemDraft + view.otherDraft;
    draftLine.hidden = total === 0;
    draftText.textContent =
      total === 0
        ? ""
        : `The draft holds ${view.itemDraft === 1 ? "1 item change" : `${view.itemDraft} item changes`}${view.otherDraft > 0 ? ` and ${view.otherDraft} other ${view.otherDraft === 1 ? "change" : "changes"}` : ""}, live once published. `;
    const item = view.item;
    if (!openName) {
      return;
    }
    if (!item || item.name.toLowerCase() !== openName.toLowerCase()) {
      // Closed only when the item itself is gone (removed in the draft by someone), not when an
      // answer carries no form (a refused New item).
      const open = openName.toLowerCase();
      if (shown && !view.items.some((i) => i.name.toLowerCase() === open)) {
        shown = null;
        form.hidden = true;
        openName = null;
        panels?.clear();
      }
      return;
    }
    const first = shown === null || shown.name !== item.name;
    shown = item;
    form.hidden = false;
    if (first) {
      fill();
    } else if (!busy) {
      // Each section catches up on its own: an edit in one is never lost to a refresh of the other.
      if (!rulesDirty()) {
        fillRules();
      } else if (canonical(item.form) === filled.value) {
        // The rules the edit started from are still the draft's (only the name or picture moved):
        // the edit stays saveable.
        filled = { ...filled, fingerprint: item.fingerprint };
      }
      if (!nameDirty()) {
        fillName();
      }
    }
    const slot = item.form.slot;
    if (first) {
      filled = { ...filled, slot };
      showPanels(item.name);
    } else if (slot !== filled.slot) {
      // A new equip slot (saved): the worn panel appears or goes.
      filled = { ...filled, slot };
      panels?.show(item.name);
    }
    update();
  };

  return {
    el,
    onShow: ask,
    changes: () => (dirty() && !busy ? 1 : 0) + (panels?.pending() ? 1 : 0),
    discard() {
      if (!busy) {
        fill();
        // Pictures or frames set up and not saved go too.
        if (shown) {
          panels?.show(shown.name, true);
        }
        status.textContent = "";
        update();
      }
    },
    receive(msg) {
      if (msg.seq <= resetSeq) {
        return;
      }
      const newer = msg.seq >= appliedSeq;
      const save = saving.get(msg.seq);
      if (save !== undefined) {
        saving.delete(msg.seq);
        if (save.create) {
          createBtn.disabled = false;
          newStatus.textContent = [
            msg.result?.text ?? "",
            ...(msg.result?.problems ?? []).map((p) => `${p.where}: ${p.message}`),
          ].join(" ");
          if (
            msg.result?.ok &&
            msg.view.item &&
            !(shown && (dirty() || busy || panels?.pending()))
          ) {
            newName.value = "";
            newDisplay.value = "";
            newFrom.value = "";
            openName = msg.view.item.name;
            shown = null;
          }
        } else if (openName && save.name.toLowerCase() === openName.toLowerCase()) {
          busy = false;
          if (msg.result) {
            if (msg.result.ok && newer && msg.view.item) {
              // Saved: the section saved shows what the draft now holds; an unsaved edit in the
              // other section stays (a rename keeps rule edits, a rules save keeps a typed name).
              shown = msg.view.item;
              if (save.op === "rename") {
                fillName();
              } else if (save.op === "discard") {
                fill();
              } else {
                fillRules();
              }
            }
            status.textContent = msg.result.ok
              ? msg.result.text
              : [
                  msg.result.text,
                  ...(msg.result.problems ?? []).map((p) =>
                    p.message.includes(`"${p.where}"`) ? p.message : `${p.where}: ${p.message}`,
                  ),
                ].join(" ");
            status.className = msg.result.ok
              ? "balance-status"
              : "balance-status balance-status-error";
          }
        }
        if (newer) {
          appliedSeq = msg.seq;
          show(msg.view);
        } else {
          update();
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
      list = [];
      openName = null;
      shown = null;
      work = {};
      filled = { value: "", fingerprint: "", display: "", slot: undefined };
      busy = false;
      invalid.clear();
      panels?.clear();
      search.value = "";
      kindSel.value = "all";
      newName.value = "";
      newDisplay.value = "";
      newFrom.value = "";
      newStatus.textContent = "";
      createBtn.disabled = false;
      status.textContent = "";
      listEl.replaceChildren();
      groupsEl.replaceChildren();
      form.hidden = true;
      loading.hidden = false;
      draftLine.hidden = true;
    },
    open(name) {
      openItem(name);
    },
  };
}
