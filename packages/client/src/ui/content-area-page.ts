/**
 * A Control Panel editor page built from content forms (schema-form.ts): one page per area of the
 * game (Spells, Houses and vehicles, Quests…), in plain words, so nothing needs editing as JSON.
 * The page shows one tab at a time. A tab holds:
 *
 * - **records**: a list of a part's entries (each spell, each house type), with Search and a New
 *   button, beside the open entry's form;
 * - **settings**: a card per section (a text table, a rule list), each with its form;
 * - **custom**: another page's panel shown as one of this page's tabs.
 *
 * Every form saves into the content store's shared draft, like the other editor pages: what you
 * save waits with the other unpublished changes until it is published on Publish Changes. Each
 * save names the row's revision as it was opened, so a save over someone else's newer change is
 * refused. An SSO page: 1.6 had no content editor.
 */
import type { ContentListing, ContentRowDetail, ContentRowStatus } from "@secondstaronline/shared";

import { action, noAutofill } from "./action.ts";
import type { ContentRequests } from "./content-requests.ts";
import {
  confirmBox,
  formActions,
  pageHeading,
  panelButton,
  sectionTabs,
} from "./control-panel-kit.ts";
import {
  blank,
  type FormWords,
  type JsonSchema,
  type SchemaForm,
  schemaForm,
} from "./schema-form.ts";

/** One part of the content an area edits. */
export interface AreaPart {
  dataset: string;
  part: string;
  /** The card's or list's title. */
  title: string;
  /** A line saying what it is for. */
  help: string;
  /** What one entry is called ("spell", "house type"), for a keyed part's list. */
  noun?: string;
  /** Entries may not be added or removed here (another page does it, or the engine fixes them). */
  fixed?: boolean;
  /**
   * Removing an entry asks what happens to everything that uses it (a vehicle's riders, parked
   * ones and deeds): Remove opens that form, with this label, instead of removing it outright.
   */
  removeVia?: { label: string; run(key: string): void };
  /** How an entry is listed, from its key (a class's name by its number); its key when left out. */
  labelOf?: (key: string) => string;
  /** A picture panel shown above an entry's form (a spell's cast effect), saving on its own. */
  panel?: () => RecordPanelLike | null;
  /**
   * A preview under an entry's form, drawn from the form as it reads now (a recipe's chance and
   * time by level), redrawn as it changes; null shows none.
   */
  preview?: (value: unknown) => HTMLElement | null;
}

/** A picture panel for one entry (content-page.ts's `RecordPanel`). */
export interface RecordPanelLike {
  readonly el: HTMLElement;
  show(key: string, force?: boolean): void;
  clear(): void;
  pending(): boolean;
}

/** One tab of an area page. */
export type AreaTab =
  | { kind: "records"; label: string; help: string; part: AreaPart }
  | { kind: "settings"; label: string; help: string; parts: AreaPart[] }
  | {
      kind: "custom";
      label: string;
      help: string;
      el: HTMLElement;
      onShow?(): void;
      changes?(): number;
      discard?(): void;
    };

export interface AreaConfig {
  /** The page id: its controls' actions start with it. */
  id: string;
  title: string;
  intro: string;
  tabs: AreaTab[];
}

export interface AreaPageDeps {
  requests: ContentRequests;
  /** The words for a part's form. */
  words(dataset: string, part: string): FormWords;
  /** Opens Publish Changes, where the unpublished changes are published. */
  openContent(): void;
}

export interface AreaPage {
  readonly el: HTMLElement;
  onShow(): void;
  /** Forms with unsaved changes. */
  changes(): number;
  discard(): void;
  /** A publish or undo went live: forms not being edited show what plays now. */
  published(): void;
  /** Shows the tab with this label. */
  showTab(label: string): void;
  /** Opens an entry of a records tab by its key (a link from another page). */
  open(dataset: string, part: string, key: string | null): void;
  reset(): void;
}

const STATUS_TEXT: Record<ContentRowStatus, string> = {
  pack: "Original",
  changed: "Changed by you",
  added: "Added by you",
  removed: "Removed",
};

/** The value a row's form starts from: the draft's when it changes it, else what plays. */
export function startValue(row: ContentRowDetail): unknown {
  if (row.draft?.op === "set") {
    return row.draft.data;
  }
  if (row.draft?.op === "revert") {
    return row.pack;
  }
  return row.published ?? row.pack;
}

/** The tags a row shows: where it comes from, and what the draft will do to it. */
export function rowTags(row: {
  status: ContentRowStatus | null;
  draft: { op: "set" | "remove" | "revert" } | null;
}): { text: string; kind: string }[] {
  const out: { text: string; kind: string }[] = [];
  if (row.status) {
    out.push({
      text: STATUS_TEXT[row.status],
      kind: row.status === "pack" ? "original" : "changed",
    });
  }
  if (row.draft?.op === "set") {
    out.push({ text: "Unpublished changes", kind: "pending" });
  } else if (row.draft?.op === "revert") {
    out.push({ text: "Back to the original once published", kind: "pending" });
  } else if (row.draft?.op === "remove") {
    out.push({ text: "Removed once published", kind: "pending" });
  }
  return out;
}

/** A value's JSON with its keys in order, so two readings compare whatever order fields came in. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) {
    return `[${v.map(canonical).join(",")}]`;
  }
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

/** One row's form with its tags, its Save bar and its status line. */
interface RowEditor {
  readonly el: HTMLElement;
  /** Unsaved changes in the form. */
  dirty(): boolean;
  /** Shows a row (or a new one, not saved yet: `fresh`). */
  show(row: ContentRowDetail, fresh?: boolean): void;
  clear(): void;
}

function rowEditor(
  id: string,
  deps: AreaPageDeps,
  part: AreaPart,
  /** After a save or a discard: the row changed in the draft. */
  saved: (key: string | null, gone: boolean) => void,
): RowEditor {
  const box = document.createElement("div");
  box.className = "content-area-row";
  const tags = document.createElement("div");
  tags.className = "balance-tags";
  const note = document.createElement("p");
  note.className = "control-panel-field-help";
  note.hidden = true;
  const holder = document.createElement("div");
  holder.className = "content-area-form";
  const previewBox = document.createElement("div");
  previewBox.className = "content-area-preview";
  const status = document.createElement("p");
  status.className = "balance-status";
  status.setAttribute("role", "status");

  let row: ContentRowDetail | null = null;
  let form: SchemaForm | null = null;
  let start: unknown = null;
  /** The form as it first read: the form puts a row's fields in its own order, so a row is
   * unchanged while the form reads the same as it did when drawn. */
  let firstReading = "";
  const reading = () => {
    const c = current();
    return c.ok ? canonical(c.value) : `!${c.error}`;
  };
  let isNew = false;
  let busy = false;

  const say = (text: string, error = false) => {
    status.textContent = text;
    status.classList.toggle("balance-status-error", error);
  };

  const current = (): { ok: true; value: unknown } | { ok: false; error: string } => {
    if (!form) {
      return { ok: false, error: "Nothing is open." };
    }
    try {
      return { ok: true, value: form.value() };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  };
  const dirty = () => {
    if (!form || !row) {
      return false;
    }
    if (isNew) {
      return true;
    }
    return reading() !== firstReading;
  };

  const save = panelButton(`${id}-save`, "Save changes", () => void doSave(), "primary");
  const undo = panelButton(`${id}-undo`, "Undo changes", () => {
    if (row) {
      draw(row, isNew);
      say("");
    }
  });
  const restore = panelButton(`${id}-restore`, "Restore the original", () => void doRevert());
  const cancel = panelButton(`${id}-cancel`, "Cancel unpublished changes", () => void doDiscard());
  const remove = panelButton(
    `${id}-remove`,
    part.removeVia?.label ?? "Remove",
    () => void doRemove(),
    "danger",
  );
  const left = document.createElement("div");
  left.className = "content-buttons";
  left.append(save, undo);
  const right = document.createElement("div");
  right.className = "content-buttons";
  right.append(restore, cancel, remove);
  const bar = document.createElement("div");
  bar.className = "items-actions";
  bar.append(left, right);
  const actionsBar = formActions(bar, status);
  box.append(tags, note, holder, previewBox, actionsBar);
  /** Redraws the preview from the form as it reads now; a form that does not read keeps the last. */
  const drawPreview = () => {
    if (!part.preview) {
      return;
    }
    const c = current();
    if (!c.ok) {
      return;
    }
    const el = part.preview(c.value);
    previewBox.replaceChildren(...(el ? [el] : []));
  };

  const buttons = () => {
    const d = dirty();
    save.disabled = busy || !d || row?.readOnly === true;
    undo.disabled = busy || !d;
    const st = row?.status ?? null;
    restore.hidden = isNew || st !== "changed" || row?.draft?.op === "revert";
    cancel.hidden = isNew || !row?.draft;
    // A section is removed only when the world may leave it out (a casino game): turned off.
    const section = row?.key === null;
    remove.hidden =
      isNew ||
      part.fixed === true ||
      (section && row?.optional !== true) ||
      (section && row?.published === null) ||
      st === "removed" ||
      row?.draft?.op === "remove";
    remove.textContent = section ? "Turn this off" : (part.removeVia?.label ?? "Remove");
    for (const b of [restore, cancel, remove]) {
      b.disabled = busy;
    }
  };

  const draw = (r: ContentRowDetail, fresh: boolean) => {
    row = r;
    isNew = fresh;
    start = fresh ? null : startValue(r);
    tags.replaceChildren(
      ...(fresh ? [{ text: "New, not saved yet", kind: "pending" }] : rowTags(r)).map((t) => {
        const s = document.createElement("span");
        s.className = `balance-tag items-tag-${t.kind}`;
        s.textContent = t.text;
        return s;
      }),
    );
    note.textContent = r.note ?? "";
    note.hidden = !r.note;
    const value = fresh ? r.draft?.data : start;
    form = schemaForm((r.schema ?? {}) as JsonSchema, value, deps.words(part.dataset, part.part), {
      id,
      onInput: () => {
        say("");
        buttons();
        drawPreview();
      },
      readOnly: r.readOnly,
    });
    holder.replaceChildren(form.el);
    drawPreview();
    firstReading = reading();
    buttons();
  };

  const answer = (ok: boolean, text: string, okText: string) => {
    busy = false;
    if (ok) {
      say(text || okText);
    } else {
      say(text, true);
    }
    buttons();
  };

  const doSave = async () => {
    if (!row) {
      return;
    }
    const c = current();
    if (!c.ok) {
      say(c.error, true);
      return;
    }
    let key = row.key;
    if (row.keyField && c.value && typeof c.value === "object") {
      const named = (c.value as Record<string, unknown>)[row.keyField];
      if (typeof named === "string" || typeof named === "number") {
        key = String(named);
      }
    }
    if (
      row.keyField &&
      !isNew &&
      key !== null &&
      row.key !== null &&
      key.toLowerCase() !== row.key.toLowerCase()
    ) {
      say(
        `The ${row.keyField} can't change once saved: it is how the game finds this ${part.noun ?? "entry"}. Make a new one instead.`,
        true,
      );
      return;
    }
    busy = true;
    buttons();
    say("Saving…");
    try {
      const ref = { dataset: row.dataset, part: row.part, key };
      const a = await deps.requests.draft(ref, "set", c.value, isNew ? undefined : row.revision);
      answer(
        a.ok,
        a.ok ? "" : a.text,
        "Saved with your unpublished changes. Players get it once you publish it on the Publish Changes page.",
      );
      if (a.ok) {
        saved(key, false);
      }
    } catch (e) {
      answer(false, (e as Error).message, "");
    }
  };

  const doRevert = async () => {
    if (!row) {
      return;
    }
    const yes = await confirmBox(box, {
      text: "Put this back as the installed pack has it once your changes are published?",
      confirm: "Restore the original",
      cancel: "Keep it",
    });
    if (!yes || !row) {
      return;
    }
    busy = true;
    buttons();
    try {
      const a = await deps.requests.draft(row, "revert", null, row.revision);
      answer(
        a.ok,
        a.ok ? "" : a.text,
        "It goes back to the original when your changes are published.",
      );
      if (a.ok) {
        saved(row.key, false);
      }
    } catch (e) {
      answer(false, (e as Error).message, "");
    }
  };

  const doDiscard = async () => {
    if (!row) {
      return;
    }
    const yes = await confirmBox(box, {
      text: "Take this out of the unpublished changes? What plays now stays as it is.",
      confirm: "Cancel unpublished changes",
      cancel: "Keep them",
      danger: true,
    });
    if (!yes || !row) {
      return;
    }
    busy = true;
    buttons();
    try {
      const a = await deps.requests.discard(row, row.revision);
      answer(a.ok, a.ok ? "" : a.text, "Unpublished changes cancelled.");
      if (a.ok) {
        saved(row.key, row.status === null);
      }
    } catch (e) {
      answer(false, (e as Error).message, "");
    }
  };

  const doRemove = async () => {
    if (!row) {
      return;
    }
    if (part.removeVia && row.key !== null) {
      part.removeVia.run(row.key);
      return;
    }
    const section = row.key === null;
    const yes = await confirmBox(box, {
      text: section
        ? `Turn off ${part.title}? The world goes without it once your changes are published. You can add it back here.`
        : `Remove ${row.key}? It goes when your changes are published, and the checks before publishing name anything that still uses it.`,
      confirm: section ? "Turn it off" : "Remove",
      cancel: "Keep it",
      danger: true,
    });
    if (!yes || !row) {
      return;
    }
    busy = true;
    buttons();
    try {
      const a = await deps.requests.draft(row, "remove", null, row.revision);
      answer(
        a.ok,
        a.ok ? "" : a.text,
        section
          ? "It is turned off when your changes are published."
          : "It is removed when your changes are published.",
      );
      if (a.ok) {
        saved(row.key, false);
      }
    } catch (e) {
      answer(false, (e as Error).message, "");
    }
  };

  buttons();
  return {
    el: box,
    dirty,
    show(r, fresh = false) {
      // The same row again (after its own save) keeps the line saying what happened.
      const sameRow =
        row !== null &&
        !isNew &&
        row.dataset === r.dataset &&
        row.part === r.part &&
        row.key === r.key;
      if (!sameRow) {
        say("");
      }
      busy = false;
      draw(r, fresh);
    },
    clear() {
      row = null;
      form = null;
      holder.replaceChildren();
      previewBox.replaceChildren();
      tags.replaceChildren();
      say("");
      buttons();
    },
  };
}

/** A settings tab's card: one section's form. */
interface Card {
  readonly el: HTMLElement;
  load(force: boolean): void;
  dirty(): boolean;
}

function settingsCard(id: string, deps: AreaPageDeps, part: AreaPart): Card {
  const el = document.createElement("section");
  el.className = "content-area-card";
  el.dataset.part = `${part.dataset}/${part.part}`;
  const h = document.createElement("h3");
  h.className = "balance-row-title";
  h.textContent = part.title;
  const help = document.createElement("p");
  help.className = "items-intro";
  help.textContent = part.help;
  const loading = document.createElement("p");
  loading.className = "balance-loading";
  loading.textContent = "Loading…";
  // After its own save the card shows what the draft now holds, whatever the form had.
  const editor = rowEditor(`${id}-${part.part}`, deps, part, () => load(true, true));
  const missing = document.createElement("div");
  missing.className = "content-area-missing";
  missing.hidden = true;
  const missingText = document.createElement("p");
  missingText.className = "control-panel-field-help";
  missingText.textContent = "This world goes without it.";
  let missingRow: ContentRowDetail | null = null;
  missing.append(
    missingText,
    panelButton(`${id}-${part.part}-add`, "Add it", () => {
      if (!missingRow) {
        return;
      }
      missing.hidden = true;
      editor.el.hidden = false;
      editor.show(
        {
          ...missingRow,
          draft: { op: "set", data: blank((missingRow.schema ?? {}) as JsonSchema), author: "" },
        },
        true,
      );
    }),
  );
  el.append(h, help, loading, missing, editor.el);
  let loaded = false;
  /** `own`: after the card's own save (a refresh never drops what is being edited). */
  const load = (force: boolean, own = false) => {
    if ((loaded && !force) || (force && !own && editor.dirty())) {
      return;
    }
    loaded = true;
    deps.requests
      .row({ dataset: part.dataset, part: part.part, key: null })
      .then((row) => {
        loading.hidden = true;
        if (editor.dirty() && !own) {
          return;
        }
        // An optional section the world leaves out: offered to add, starting blank.
        const absent =
          row.optional === true &&
          row.published === null &&
          (row.draft === null || row.draft.op === "remove");
        missing.hidden = !absent;
        editor.el.hidden = absent;
        if (!absent) {
          editor.show(row);
        } else {
          missingRow = row;
        }
      })
      .catch((e: Error) => {
        loaded = false;
        loading.hidden = false;
        loading.textContent = e.message;
      });
  };
  return { el, load, dirty: () => editor.dirty() };
}

/** A records tab: a part's entries beside the open one's form. */
interface Records {
  readonly el: HTMLElement;
  load(force: boolean): void;
  open(key: string): void;
  dirty(): boolean;
}

function recordsView(id: string, deps: AreaPageDeps, part: AreaPart): Records {
  const el = document.createElement("div");
  el.className = "items-layout content-area-records";
  const listBox = document.createElement("div");
  listBox.className = "items-list-box";
  const search = noAutofill(action(document.createElement("input"), `${id}-search`));
  search.type = "search";
  search.placeholder = "Search";
  search.setAttribute("aria-label", `Search ${part.title.toLowerCase()}`);
  search.className = "content-area-search";
  const newBtn = panelButton(`${id}-new`, `+ New ${part.noun ?? "entry"}`, () => startNew());
  newBtn.hidden = part.fixed === true;
  const count = document.createElement("p");
  count.className = "items-list-meta";
  const list = document.createElement("ul");
  list.className = "items-list";
  list.setAttribute("aria-label", part.title);
  listBox.append(newBtn, search, count, list);

  const formBox = document.createElement("section");
  formBox.className = "items-form";
  formBox.hidden = true;
  const head = document.createElement("div");
  head.className = "items-form-head";
  const title = document.createElement("h2");
  title.className = "content-section-title";
  const copy = panelButton(`${id}-copy`, `Copy as a new ${part.noun ?? "entry"}`, () =>
    startCopy(),
  );
  copy.hidden = part.fixed === true;
  head.append(title, copy);
  const editor = rowEditor(id, deps, part, (key, gone) => {
    void refresh().then(() => {
      if (key !== null && !gone) {
        open(key);
      } else {
        close();
      }
    });
  });
  // The entry's picture panel, made when the page is first drawn (it may need the art loaded).
  let panel: RecordPanelLike | null | undefined;
  const panelBox = document.createElement("div");
  panelBox.className = "content-area-panel";
  const getPanel = () => {
    if (panel === undefined && part.panel) {
      panel = part.panel();
      if (panel) {
        panelBox.append(panel.el);
      }
    }
    return panel ?? null;
  };
  formBox.append(head, panelBox, editor.el);
  const empty = document.createElement("p");
  empty.className = "items-empty-form";
  empty.textContent = `Pick a ${part.noun ?? "entry"} from the list to see and change it.`;
  el.append(listBox, empty, formBox);

  let listing: ContentListing | null = null;
  let openKey: string | null = null;
  let loaded = false;

  const draw = () => {
    const words = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const label = (key: string | null) => (key === null ? "" : (part.labelOf?.(key) ?? key));
    const rows = (listing?.rows ?? []).filter((r) =>
      words.every((w) => `${r.key ?? ""} ${label(r.key)}`.toLowerCase().includes(w)),
    );
    count.textContent = `${rows.length} of ${listing?.rows.length ?? 0}`;
    list.replaceChildren(
      ...rows.map((r) => {
        const li = document.createElement("li");
        const b = action(document.createElement("button"), `${id}-open`);
        b.type = "button";
        b.className = "items-list-item";
        b.textContent = label(r.key);
        b.setAttribute("aria-current", String(r.key === openKey));
        const meta = rowTags({ status: r.status, draft: r.draft ? { op: r.draft } : null })
          .filter((t) => t.text !== "Original")
          .map((t) => t.text)
          .join(" · ");
        if (meta) {
          const m = document.createElement("span");
          m.className = "items-list-meta";
          m.textContent = ` ${meta}`;
          b.append(m);
        }
        b.addEventListener("click", () => {
          if (r.key !== null) {
            void guardOpen(r.key);
          }
        });
        li.append(b);
        return li;
      }),
    );
  };
  search.addEventListener("input", draw);

  const refresh = async () => {
    try {
      listing = await deps.requests.list(part.dataset, part.part);
      count.textContent = "";
      draw();
    } catch (e) {
      count.textContent = (e as Error).message;
    }
  };

  const close = () => {
    getPanel()?.clear();
    openKey = null;
    formBox.hidden = true;
    empty.hidden = false;
    editor.clear();
    draw();
  };

  const guardOpen = async (key: string) => {
    if (editor.dirty() || getPanel()?.pending()) {
      const yes = await confirmBox(el, {
        text: "You have unsaved changes. Leave them?",
        confirm: "Discard changes",
        cancel: "Stay",
        danger: true,
      });
      if (!yes) {
        return;
      }
    }
    open(key);
  };

  const open = (key: string) => {
    openKey = key;
    draw();
    deps.requests
      .row({ dataset: part.dataset, part: part.part, key })
      .then((row) => {
        if (openKey !== key) {
          return;
        }
        title.textContent = row.key === null ? part.title : (part.labelOf?.(row.key) ?? row.key);
        copy.hidden = part.fixed === true || row.keyField === null;
        formBox.hidden = false;
        empty.hidden = true;
        editor.show(row);
        getPanel()?.show(key);
      })
      .catch((e: Error) => {
        empty.hidden = false;
        empty.textContent = e.message;
      });
  };

  /** A new entry's form, from `value` (blank, or a copy), named `name`. */
  const fresh = (name: string, value: unknown) => {
    const schema = (listing?.schema ?? {}) as JsonSchema;
    const keyField = listing?.keyField ?? null;
    const data =
      value !== null && typeof value === "object" && keyField
        ? { ...(value as Record<string, unknown>), [keyField]: name }
        : value;
    openKey = null;
    getPanel()?.clear();
    draw();
    title.textContent = name || `New ${part.noun ?? "entry"}`;
    copy.hidden = true;
    formBox.hidden = false;
    empty.hidden = true;
    editor.show(
      {
        dataset: part.dataset,
        part: part.part,
        key: name || null,
        keyField,
        readOnly: false,
        status: null,
        pack: null,
        published: null,
        draft: { op: "set", data, author: "" },
        schema,
      },
      true,
    );
  };

  const startNew = async () => {
    if (editor.dirty()) {
      const yes = await confirmBox(el, {
        text: "You have unsaved changes. Leave them?",
        confirm: "Discard changes",
        cancel: "Stay",
        danger: true,
      });
      if (!yes) {
        return;
      }
    }
    fresh("", blank((listing?.schema ?? {}) as JsonSchema));
  };

  const startCopy = async () => {
    if (openKey === null) {
      return;
    }
    const from = openKey;
    const row = await deps.requests.row({ dataset: part.dataset, part: part.part, key: from });
    fresh(`${from} copy`, structuredClone(startValue(row)));
  };

  return {
    el,
    load(force) {
      if (loaded && !force) {
        return;
      }
      loaded = true;
      void refresh().then(() => {
        if (openKey !== null && !editor.dirty()) {
          open(openKey);
        }
      });
    },
    open: (key) => {
      void refresh().then(() => open(key));
    },
    dirty: () => editor.dirty() || getPanel()?.pending() === true,
  };
}

export function createAreaPage(cfg: AreaConfig, deps: AreaPageDeps): AreaPage {
  const el = document.createElement("div");
  el.className = `plain-editor content-area-page ${cfg.id}-page`;
  const bar = document.createElement("div");
  bar.className = "balance-draft";
  const barText = document.createElement("span");
  barText.textContent =
    "Changes you save here wait with your other unpublished changes until you publish them.";
  bar.append(barText, panelButton(`${cfg.id}-publish`, "Review and publish…", deps.openContent));
  const form = document.createElement("div");
  form.className = "content-area-tabs";
  const tabs = sectionTabs(form, cfg.id);
  el.append(pageHeading(cfg.title, cfg.intro), bar, tabs.el, form);

  /** `shown`: the page is being shown (not a publish refreshing what is on it). */
  type Live = { load(force: boolean, shown?: boolean): void; dirty(): number; discard(): void };
  const lives: Live[] = [];
  const records = new Map<string, Records>();

  for (const t of cfg.tabs) {
    const sec = document.createElement("section");
    // A list beside a form, or another editor page, fills the window (each part scrolls alone).
    sec.className = `balance-row content-area-tab${t.kind === "settings" ? "" : " content-area-fill"}`;
    sec.dataset.tab = t.label;
    const h = document.createElement("h2");
    h.className = "balance-row-title";
    h.textContent = t.label;
    const help = document.createElement("p");
    help.className = "items-intro";
    help.textContent = t.help;
    sec.append(h, help);
    if (t.kind === "records") {
      const r = recordsView(`${cfg.id}-${t.part.part}`, deps, t.part);
      records.set(`${t.part.dataset}/${t.part.part}`, r);
      sec.append(r.el);
      lives.push({
        load: (force) => r.load(force),
        dirty: () => (r.dirty() ? 1 : 0),
        discard: () => r.load(true),
      });
    } else if (t.kind === "settings") {
      const cards = t.parts.map((p) => settingsCard(cfg.id, deps, p));
      sec.append(...cards.map((c) => c.el));
      lives.push({
        load: (force) => {
          for (const c of cards) {
            c.load(force);
          }
        },
        dirty: () => cards.filter((c) => c.dirty()).length,
        discard: () => {
          // Reloading a card keeps unsaved changes; rebuilding drops them.
          for (const c of cards) {
            c.el.remove();
          }
          const fresh = t.parts.map((p) => settingsCard(cfg.id, deps, p));
          cards.splice(0, cards.length, ...fresh);
          sec.append(...fresh.map((c) => c.el));
          for (const c of fresh) {
            c.load(true);
          }
        },
      });
    } else {
      sec.append(t.el);
      lives.push({
        // Shown with the page; a publish reaches the editor from the app, not through here.
        load: (_force, shown) => {
          if (shown) {
            // The editor may have been shown on a page of its own since (another role's).
            if (t.el.parentElement !== sec) {
              sec.append(t.el);
            }
            t.onShow?.();
          }
        },
        dirty: () => t.changes?.() ?? 0,
        discard: () => t.discard?.(),
      });
    }
    form.append(sec);
  }

  // A new session: everything loads again when the page is next shown.
  let stale = false;
  return {
    el,
    onShow() {
      for (const l of lives) {
        l.load(stale, true);
      }
      stale = false;
    },
    changes: () => lives.reduce((n, l) => n + l.dirty(), 0),
    discard() {
      for (const l of lives) {
        l.discard();
      }
    },
    published() {
      // A page not on screen catches up when it is next shown.
      if (!el.isConnected) {
        stale = true;
        return;
      }
      for (const l of lives) {
        l.load(true);
      }
    },
    showTab: (label) => tabs.select(label),
    open(dataset, part, key) {
      const tab = cfg.tabs.find(
        (t) =>
          (t.kind === "records" && t.part.dataset === dataset && t.part.part === part) ||
          (t.kind === "settings" && t.parts.some((p) => p.dataset === dataset && p.part === part)),
      );
      if (!tab) {
        return;
      }
      tabs.select(tab.label);
      const r = records.get(`${dataset}/${part}`);
      if (r && key !== null) {
        r.open(key);
      } else {
        // A settings card: bring it into view.
        queueMicrotask(() =>
          el.querySelector(`[data-part="${dataset}/${part}"]`)?.scrollIntoView({ block: "start" }),
        );
      }
    },
    reset() {
      stale = true;
    },
  };
}
