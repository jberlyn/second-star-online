/**
 * The Control Panel's Content page (issue #27): the live content store, built from the installed
 * packs (Classic by default) plus the operator's changes. 1.6 had nothing like it (content was
 * compiled into the client and server); it is a plain SSO page built from the Control Panel's
 * shared parts, and it lets content change before the item and balance editors exist.
 *
 * - **Installed packs**, with the version each runs at, and the **pack updates**: a row a newer
 *   pack version changed after you customised it, with the pack's old and new versions and yours,
 *   to take the pack's version or keep yours.
 * - **The draft**: the one shared draft, each change with its author, its pre-publish checks and
 *   Publish. A publish another admin's change would overwrite is refused.
 * - **Rows**: every row of a dataset field (an item, a text table) with its state, and an editor
 *   for one row's JSON that saves to the draft.
 * - **Where it is used** and **Remove** for an item or a monster (issue #28, content-usage.ts):
 *   the rows and the world's places that hold it, and a removal with its cleanup.
 * - **Item pictures** (issue #29, item-art.ts): a picture panel in an item row's editor, and a bulk
 *   upload that attaches PNGs named after items.
 * - **Publish history**, with Undo for a whole publish, and what each publish did to the world.
 * - **Problems**: references nothing resolves, in content and in the world.
 */
import type {
  ContentDraftView,
  ContentItemArtView,
  ContentListing,
  ContentNoticeView,
  ContentOverview,
  ContentProblemView,
  ContentPublishView,
  ContentRowDetail,
  ContentRowRef,
  ContentRowStatus,
  ContentUsageView,
  PictureChange,
} from "@secondstaronline/shared";

import type { Assets } from "../assets.ts";
import { action, gameInput } from "./action.ts";
import { createArtUploader, postUpload } from "./art-uploads.ts";
import { drawRemovals, drawUsage, type RemovalPlan, removalForm } from "./content-usage.ts";
import {
  confirmBox,
  createTable,
  formField,
  pageHeading,
  panelButton,
} from "./control-panel-kit.ts";
import { createItemArtPicker, createItemPictures } from "./item-art.ts";

/** What the page asks the server for (each answer comes back with its `seq`). */
export interface ContentPageActions {
  overview(seq: number): void;
  list(seq: number, dataset: string, part: string): void;
  row(seq: number, ref: ContentRowRef): void;
  draft(seq: number, ref: ContentRowRef, op: "set" | "remove" | "revert", data: unknown): void;
  discard(seq: number, ref: ContentRowRef): void;
  publish(seq: number, summary: string, draftRev: string): void;
  undo(seq: number, id: string): void;
  notice(seq: number, ref: ContentRowRef, accept: boolean): void;
  /** Where an item or a monster is used. */
  usage(seq: number, kind: "item" | "monster", key: string): void;
  /** Puts a removal with its cleanup in the draft. */
  remove(seq: number, plan: RemovalPlan): void;
  /** The references nothing resolves. */
  problems(seq: number): void;
  /** A ticket for uploading art and sounds (issue #29). */
  uploadTicket(seq: number): void;
  /** The draft's items and their pictures, for the item picture picker. */
  itemArt(seq: number): void;
  /** One picture change, made in the draft as a whole by the server. */
  picture(seq: number, change: PictureChange): void;
  /** Opens a character's hub (a holder in a usage report). */
  openCharacter(name: string): void;
}

export type ContentReply =
  | { t: "contentOverview"; seq: number; overview: ContentOverview }
  | { t: "contentList"; seq: number; listing: ContentListing | null; error?: string }
  | { t: "contentRow"; seq: number; row: ContentRowDetail | null; error?: string }
  | { t: "contentUsage"; seq: number; usage: ContentUsageView | null; error?: string }
  | {
      t: "contentProblems";
      seq: number;
      content: ContentProblemView[];
      world: ContentProblemView[];
    }
  | { t: "contentResult"; seq: number; ok: boolean; text: string; problems?: ContentProblemView[] }
  | { t: "contentUploadTicket"; seq: number; ticket: string; maxBytes: number }
  | { t: "contentItemArt"; seq: number; view: ContentItemArtView };

export interface ContentPage {
  readonly el: HTMLElement;
  /** The page was shown: ask for the overview (and the rows on screen). */
  onShow(): void;
  receive(msg: ContentReply): void;
  /** The published store changed (a publish by anyone): refresh what is on screen. */
  published(): void;
  /** Unsaved JSON in the row editor. */
  changes(): number;
  discard(): void;
  reset(): void;
}

/** Just a row's ref (a notice or draft row carries more, which an intent's strict schema refuses). */
export function refOf(r: ContentRowRef): ContentRowRef {
  return { dataset: r.dataset, part: r.part, key: r.key };
}

/** `items/items/Ale`, `casino/blackjack`. */
export function refLabel(r: ContentRowRef): string {
  return r.key === null ? `${r.dataset}/${r.part}` : `${r.dataset}/${r.part}/${r.key}`;
}

const OP_TEXT: Record<ContentDraftView["op"], string> = {
  set: "Change",
  remove: "Remove",
  revert: "Back to the pack's version",
};

const STATUS_TEXT: Record<ContentRowStatus, string> = {
  pack: "As the pack has it",
  changed: "Changed",
  added: "Added",
  removed: "Removed",
};

/** The item or monster a row is, or null for any other row. */
export function entryOf(r: ContentRowRef): { kind: "item" | "monster"; key: string } | null {
  if (r.key === null) {
    return null;
  }
  if (r.dataset === "items" && r.part === "items") {
    return { kind: "item", key: r.key };
  }
  if (r.dataset === "monsters" && r.part === "monsters") {
    return { kind: "monster", key: r.key };
  }
  return null;
}

/** `2026-11-22T09:15:03.120Z` → `2026-11-22 09:15`. */
const when = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;

/** Pretty JSON, or "(none)". */
export function pretty(v: unknown): string {
  return v === null || v === undefined ? "(none)" : JSON.stringify(v, null, 2);
}

/**
 * A line diff of two texts (longest common subsequence): each line of the result is kept,
 * added or removed. Small inputs only (one row's JSON).
 */
export function lineDiff(a: string, b: string): { kind: "same" | "add" | "del"; text: string }[] {
  const x = a.split("\n");
  const y = b.split("\n");
  const n = x.length;
  const m = y.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const row = lcs[i] as number[];
      row[j] =
        x[i] === y[j]
          ? ((lcs[i + 1] as number[])[j + 1] as number) + 1
          : Math.max((lcs[i + 1] as number[])[j] as number, row[j + 1] as number);
    }
  }
  const out: { kind: "same" | "add" | "del"; text: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      out.push({ kind: "same", text: x[i] as string });
      i++;
      j++;
    } else if (((lcs[i + 1] as number[])[j] as number) >= ((lcs[i] as number[])[j + 1] as number)) {
      out.push({ kind: "del", text: x[i] as string });
      i++;
    } else {
      out.push({ kind: "add", text: y[j] as string });
      j++;
    }
  }
  for (; i < n; i++) {
    out.push({ kind: "del", text: x[i] as string });
  }
  for (; j < m; j++) {
    out.push({ kind: "add", text: y[j] as string });
  }
  return out;
}

/** A `<pre>` showing how `b` differs from `a`, line by line. */
function diffBlock(label: string, a: unknown, b: unknown): HTMLElement {
  const box = document.createElement("figure");
  box.className = "content-diff";
  const cap = document.createElement("figcaption");
  cap.textContent = label;
  const pre = document.createElement("pre");
  for (const line of lineDiff(pretty(a), pretty(b))) {
    const span = document.createElement("span");
    span.className = `content-diff-${line.kind}`;
    span.textContent = `${line.kind === "add" ? "+ " : line.kind === "del" ? "- " : "  "}${line.text}\n`;
    pre.append(span);
  }
  box.append(cap, pre);
  return box;
}

function section(title: string, intro = ""): { el: HTMLElement; body: HTMLElement } {
  const el = document.createElement("section");
  el.className = "content-section";
  const h = document.createElement("h2");
  h.className = "content-section-title";
  h.textContent = title;
  el.append(h);
  if (intro) {
    const p = document.createElement("p");
    p.className = "content-section-intro";
    p.textContent = intro;
    el.append(p);
  }
  const body = document.createElement("div");
  el.append(body);
  return { el, body };
}

function problemList(problems: readonly ContentProblemView[]): HTMLElement {
  const ul = document.createElement("ul");
  ul.className = "content-problems";
  for (const p of problems) {
    const li = document.createElement("li");
    const where = document.createElement("code");
    where.textContent = p.where;
    li.append(where, `: ${p.message}`);
    ul.append(li);
  }
  return ul;
}

export function createContentPage(actions: ContentPageActions, assets?: Assets): ContentPage {
  const root = document.createElement("section");
  root.className = "content-page";
  root.append(
    pageHeading(
      "Content",
      "The game's items, monsters, NPCs, rules and texts: the installed packs plus your changes. Changes collect in one draft shared by every admin, and go live for everyone when published, without a restart.",
    ),
  );

  let seq = 0;
  const next = () => ++seq;
  let overview: ContentOverview | null = null;
  /** The answers we wait for, by kind. */
  let overviewSeq = -1;
  let listSeq = -1;
  let rowSeq = -1;
  let resultSeq = -1;
  let usageSeq = -1;
  let problemsSeq = -1;
  /** What the last action was, to know what to refresh after its result. */
  let afterResult: () => void = () => {};
  /**
   * Whether the last action was the row editor's (save, remove, revert, discard its change): only
   * its result is the editor's to show, and only it makes the editor's text the saved text.
   */
  let resultInEditor = false;

  const status = document.createElement("p");
  status.className = "content-status";
  status.setAttribute("role", "status");
  status.hidden = true;
  const say = (text: string, problems: readonly ContentProblemView[] = []) => {
    status.replaceChildren(text);
    if (problems.length > 0) {
      status.append(problemList(problems));
    }
    status.hidden = text === "";
  };
  root.append(status);

  // ---- installed packs ------------------------------------------------------------------------
  const packs = section(
    "Installed packs",
    "Packs are read-only layers loaded in this order. Your changes sit on top and are never overwritten by a pack update.",
  );
  const packTable = createTable<ContentOverview["packs"][number]>({
    label: "Installed packs",
    empty: "No packs are installed.",
    key: (p) => p.id,
    columns: [
      { label: "Pack", cell: (p) => p.name },
      { label: "Version", cell: (p) => `v${p.version}` },
      {
        label: "Source",
        cell: (p) => (p.source === "release" ? "Ships with the server" : "Imported"),
      },
      {
        label: "",
        cell: (p) => (p.updatedFrom ? `Updated from v${p.updatedFrom} at the last start` : ""),
      },
    ],
  });
  packs.body.append(packTable.el);

  // ---- pack updates ---------------------------------------------------------------------------
  const notices = section(
    "Pack updates",
    "A newer pack version changed these rows after you customised them. Your version stays live until you choose.",
  );
  const noticeList = document.createElement("div");
  notices.body.append(noticeList);
  const drawNotices = (list: readonly ContentNoticeView[]) => {
    notices.el.hidden = list.length === 0;
    noticeList.replaceChildren(
      ...list.map((n) => {
        const box = document.createElement("article");
        box.className = "content-notice";
        box.dataset.row = refLabel(n);
        const p = document.createElement("p");
        p.textContent = `${n.packName} v${n.packVersion} changed ${refLabel(n)}, which you have ${n.yoursOp === "remove" ? "removed" : "customised"}.`;
        const diffs = document.createElement("div");
        diffs.className = "content-diffs";
        diffs.append(
          diffBlock(`What ${n.packName} changed`, n.was, n.now),
          diffBlock(`Yours, against ${n.packName}'s new version`, n.now, n.yours),
        );
        const buttons = document.createElement("div");
        buttons.className = "content-buttons";
        buttons.append(
          panelButton("content-notice-accept", `Use ${n.packName}'s version`, () => {
            void confirmBox(root, {
              text: `Replace your version of ${refLabel(n)} with ${n.packName}'s? It goes live at once (you can undo it from the history).`,
              confirm: `Use ${n.packName}'s version`,
              cancel: "Keep mine",
            }).then((yes) => {
              if (yes) {
                resultSeq = next();
                resultInEditor = false;
                afterResult = refreshAll;
                actions.notice(resultSeq, refOf(n), true);
              }
            });
          }),
          panelButton("content-notice-dismiss", "Keep mine", () => {
            resultSeq = next();
            resultInEditor = false;
            afterResult = refreshAll;
            actions.notice(resultSeq, refOf(n), false);
          }),
        );
        box.append(p, diffs, buttons);
        return box;
      }),
    );
  };

  // ---- the draft ------------------------------------------------------------------------------
  const draft = section(
    "Draft",
    "Pending changes, shared by every admin. They are checked before publishing: the schemas first, then the key and name rules and the references between rows.",
  );
  const draftTable = createTable<ContentDraftView>({
    label: "Draft changes",
    empty: "The draft is empty: open a row below to change it.",
    key: refLabel,
    open: { id: "content-draft-open", run: (d) => openRow(d) },
    columns: [
      { label: "Row", cell: refLabel },
      { label: "Change", cell: (d) => OP_TEXT[d.op] },
      { label: "By", cell: (d) => d.author },
      { label: "When (UTC)", cell: (d) => when(d.updatedAt) },
      {
        label: "",
        cell: (d) =>
          panelButton("content-draft-discard", "Discard", () => {
            resultSeq = next();
            resultInEditor = false;
            afterResult = refreshAll;
            actions.discard(resultSeq, refOf(d));
          }),
      },
    ],
  });
  const checks = document.createElement("div");
  checks.className = "content-checks";
  const summary = gameInput("content-summary");
  summary.type = "text";
  summary.maxLength = 200;
  summary.placeholder = "What this publish changes";
  const publishBtn = panelButton(
    "content-publish",
    "Publish",
    () => {
      if (!overview || overview.draft.length === 0) {
        return;
      }
      const count = overview.draft.length;
      const draftRev = overview.draftRev;
      void confirmBox(root, {
        text: `Publish ${count} change${count === 1 ? "" : "s"}? They go live for every player at once.`,
        confirm: "Publish",
        cancel: "Not yet",
      }).then((yes) => {
        if (yes) {
          resultSeq = next();
          resultInEditor = false;
          afterResult = () => {
            summary.value = "";
            refreshAll();
          };
          actions.publish(resultSeq, summary.value, draftRev);
        }
      });
    },
    "primary",
  );
  const publishRow = document.createElement("div");
  publishRow.className = "content-publish";
  publishRow.append(formField("Summary", summary, "Shown in the publish history."), publishBtn);
  let removals = drawRemovals([]);
  draft.body.append(draftTable.el, checks, removals, publishRow);

  // ---- rows -----------------------------------------------------------------------------------
  const rows = section(
    "Rows",
    "Every row of a dataset field: one entry of a keyed list (an item, a monster), or the whole field (a text table, a rule list).",
  );
  const datasetSel = action(document.createElement("select"), "content-dataset");
  const partSel = action(document.createElement("select"), "content-part");
  const filter = gameInput("content-filter");
  filter.type = "search";
  filter.placeholder = "Filter";
  const pickers = document.createElement("div");
  pickers.className = "content-pickers";
  const addBtn = panelButton("content-add", "Add a row", () => addRow());
  pickers.append(
    formField("Dataset", datasetSel),
    formField("Field", partSel),
    formField("Find", filter),
    addBtn,
  );
  let listing: ContentListing | null = null;
  const rowTable = createTable<ContentListing["rows"][number]>({
    label: "Rows",
    empty: "No rows.",
    key: (r) => r.key ?? "",
    open: {
      id: "content-row-open",
      run: (r) => listing && openRow({ dataset: listing.dataset, part: listing.part, key: r.key }),
    },
    columns: [
      { label: "Row", cell: (r) => r.key ?? (listing ? `${listing.dataset}/${listing.part}` : "") },
      { label: "State", cell: (r) => STATUS_TEXT[r.status] },
      { label: "Draft", cell: (r) => (r.draft ? OP_TEXT[r.draft] : "") },
    ],
  });
  rows.body.append(pickers, rowTable.el);

  const drawList = () => {
    const f = filter.value.trim().toLowerCase();
    rowTable.setRows(
      (listing?.rows ?? []).filter((r) => f === "" || (r.key ?? "").toLowerCase().includes(f)),
    );
    addBtn.hidden = !listing?.keyField;
  };
  filter.addEventListener("input", drawList);

  const fillParts = () => {
    const ds = overview?.datasets.find((d) => d.id === datasetSel.value);
    const keep = partSel.value;
    partSel.replaceChildren(
      ...(ds?.parts ?? []).map((p) => {
        const o = document.createElement("option");
        o.value = p.part;
        o.textContent = p.keyed ? `${p.part} (${p.rows} rows)` : p.part;
        return o;
      }),
    );
    if (ds?.parts.some((p) => p.part === keep)) {
      partSel.value = keep;
    }
  };
  const askList = () => {
    if (!datasetSel.value || !partSel.value) {
      return;
    }
    listSeq = next();
    actions.list(listSeq, datasetSel.value, partSel.value);
  };
  datasetSel.addEventListener("change", () => {
    fillParts();
    askList();
  });
  partSel.addEventListener("change", askList);

  // ---- item pictures (issue #29) --------------------------------------------------------------
  /** Draft changes waiting for their result, by seq (the picture picker's saves). */
  const resultWaits = new Map<number, (r: { ok: boolean; text: string }) => void>();
  const itemArtWaits = new Map<number, (v: ContentItemArtView) => void>();
  /** Ticket requests waiting for their answer, by seq. */
  const ticketWaits = new Map<number, (t: { ticket: string; maxBytes: number }) => void>();
  const ticket = (): Promise<{ ticket: string; maxBytes: number }> =>
    new Promise((resolve, reject) => {
      const s = next();
      ticketWaits.set(s, resolve);
      actions.uploadTicket(s);
      setTimeout(() => {
        if (ticketWaits.delete(s)) {
          reject(new Error("the server did not answer"));
        }
      }, 15_000);
    });
  /** The draft's items and pictures, as the picker needs them. */
  const askItemArt = (): Promise<ContentItemArtView> =>
    new Promise((resolve, reject) => {
      const s = next();
      itemArtWaits.set(s, resolve);
      actions.itemArt(s);
      setTimeout(() => {
        if (itemArtWaits.delete(s)) {
          reject(new Error("the server did not answer"));
        }
      }, 15_000);
    });
  const artOptions = assets
    ? {
        assets,
        async upload(file: File) {
          try {
            const t = await ticket();
            if (file.size > t.maxBytes) {
              return {
                ok: false as const,
                error: `the file is ${Math.ceil(file.size / 1024)} KB; uploads may be at most ${Math.floor(t.maxBytes / 1024)} KB`,
              };
            }
            return (
              (await postUpload(file, "image", t.ticket)) ?? {
                ok: false as const,
                error: "the server did not answer",
              }
            );
          } catch (e) {
            return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
          }
        },
        apply(change: PictureChange) {
          return new Promise<{ ok: boolean; text: string }>((resolve) => {
            const s = next();
            resultWaits.set(s, resolve);
            actions.picture(s, change);
            setTimeout(() => {
              if (resultWaits.delete(s)) {
                resolve({ ok: false, text: "The server did not answer." });
              }
            }, 15_000);
          });
        },
        saved() {
          refreshAll();
          const ref = editing;
          if (!ref) {
            return;
          }
          if (!editor.hidden && json.value !== loaded) {
            // Unsaved JSON in the editor stays; only the picture panel catches up.
            editorState.textContent = `${editorState.textContent?.replace(/ The draft changed this row's picture.*$/, "") ?? ""} The draft changed this row's picture: your unsaved JSON is kept, and saving it writes your version.`;
            if (ref.key !== null) {
              showPicker(ref.key);
            }
          } else {
            openRow(ref);
          }
        },
      }
    : null;
  const picker = artOptions ? createItemArtPicker(artOptions) : null;
  /** Shows the picker for the item row open in the editor (the draft's version of it). */
  let pickerSeq = 0;
  function showPicker(key: string): void {
    if (!picker) {
      return;
    }
    const mine = ++pickerSeq;
    void askItemArt()
      .then((view) => {
        const item = view.items.find((i) => i.name.toLowerCase() === key.toLowerCase());
        if (mine !== pickerSeq || !editing || editing.key?.toLowerCase() !== key.toLowerCase()) {
          return;
        }
        if (item) {
          picker.show(item, view);
        } else {
          picker.clear();
        }
        pictures?.setView(view);
      })
      .catch(() => picker.clear());
  }
  function hidePicker(): void {
    pickerSeq += 1;
    picker?.clear();
  }

  // ---- the row editor -------------------------------------------------------------------------
  const editor = document.createElement("div");
  editor.className = "content-editor";
  editor.hidden = true;
  const editorTitle = document.createElement("h3");
  editorTitle.className = "content-editor-title";
  const editorState = document.createElement("p");
  editorState.className = "content-editor-state";
  const packView = document.createElement("details");
  packView.className = "content-editor-pack";
  const packSummary = document.createElement("summary");
  packSummary.textContent = "The pack's version";
  const packPre = document.createElement("pre");
  packView.append(packSummary, packPre);
  const json = action(document.createElement("textarea"), "content-json");
  json.className = "content-json";
  json.spellcheck = false;
  json.rows = 18;
  const editorError = document.createElement("div");
  editorError.className = "content-editor-error";
  editorError.setAttribute("role", "alert");
  const saveBtn = panelButton("content-save", "Save to draft", () => saveRow(), "primary");
  const removeBtn = panelButton("content-remove", "Remove", () => removeRow(), "danger");
  const revertBtn = panelButton("content-revert", "Back to the pack's version", () => revertRow());
  const discardBtn = panelButton("content-discard", "Discard the draft change", () => {
    if (editing) {
      resultSeq = next();
      resultInEditor = true;
      afterResult = refreshAll;
      actions.discard(resultSeq, editing);
    }
  });
  const closeBtn = panelButton("content-close", "Close", () => closeEditor());
  const editorButtons = document.createElement("div");
  editorButtons.className = "content-buttons";
  editorButtons.append(saveBtn, removeBtn, revertBtn, discardBtn, closeBtn);
  const usageBox = document.createElement("div");
  usageBox.className = "content-usage-box";
  const removalBox = document.createElement("div");
  removalBox.className = "content-removal-box";
  editor.append(
    editorTitle,
    editorState,
    usageBox,
    removalBox,
    packView,
    picker?.el ?? document.createElement("div"),
    formField(
      "JSON",
      json,
      'One row\'s JSON. The key field never changes: to rename, set "display".',
    ),
    editorError,
    editorButtons,
  );
  rows.body.append(editor);

  /** The row being edited (null while adding a new one before it has a key). */
  let editing: ContentRowRef | null = null;
  /** The edited row's own key field (null for a whole field): not the list on screen's. */
  let editingKeyField: string | null = null;
  /** The JSON as it was loaded, to tell whether it changed. */
  let loaded = "";

  const showError = (text: string, problems: readonly ContentProblemView[] = []) => {
    editorError.replaceChildren(text);
    if (problems.length > 0) {
      editorError.append(problemList(problems));
    }
  };

  /** The usage report of the row open in the editor, once it has come. */
  let usage: ContentUsageView | null = null;

  function askUsage(r: ContentRowRef): void {
    const entry = entryOf(r);
    usage = null;
    usageBox.replaceChildren();
    removalBox.replaceChildren();
    if (!entry) {
      usageSeq = -1;
      return;
    }
    usageSeq = next();
    actions.usage(usageSeq, entry.kind, entry.key);
  }

  function openRow(r: ContentRowRef): void {
    const ref = refOf(r);
    // A usage report still on its way belongs to the row being left.
    usageSeq = -1;
    usage = null;
    usageBox.replaceChildren();
    removalBox.replaceChildren();
    editing = ref;
    editingKeyField = null;
    hidePicker();
    editor.hidden = false;
    editorTitle.textContent = refLabel(ref);
    editorState.textContent = "Loading…";
    json.value = "";
    loaded = "";
    showError("");
    rowSeq = next();
    actions.row(rowSeq, ref);
  }

  function addRow(): void {
    if (!listing?.keyField) {
      return;
    }
    // A new row has no usage report, and the last row's removal form goes with it.
    usage = null;
    usageSeq = -1;
    usageBox.replaceChildren();
    removalBox.replaceChildren();
    editing = { dataset: listing.dataset, part: listing.part, key: null };
    editingKeyField = listing.keyField;
    hidePicker();
    editor.hidden = false;
    json.readOnly = false;
    saveBtn.hidden = false;
    editorTitle.textContent = `New row in ${listing.dataset}/${listing.part}`;
    editorState.textContent = `Its "${listing.keyField}" is its key, which never changes.`;
    packView.hidden = true;
    json.value = `{\n  "${listing.keyField}": ""\n}`;
    loaded = json.value;
    showError("");
    removeBtn.hidden = true;
    revertBtn.hidden = true;
    discardBtn.hidden = true;
    json.focus();
  }

  function showRow(d: ContentRowDetail): void {
    editingKeyField = d.keyField;
    editorTitle.textContent = refLabel(d);
    const parts = [d.status ? STATUS_TEXT[d.status] : "Not published yet"];
    if (d.draft) {
      parts.push(`in the draft (${OP_TEXT[d.draft.op]}, by ${d.draft.author})`);
    }
    if (d.readOnly) {
      parts.push("built from the art: it cannot be changed here");
    }
    if (d.note) {
      parts.push(d.note);
    }
    editorState.textContent = parts.join(", ");
    packView.hidden = d.pack === null;
    packPre.textContent = pretty(d.pack);
    const shown = d.draft?.op === "set" ? d.draft.data : (d.published ?? d.pack);
    json.value = pretty(shown);
    json.readOnly = d.readOnly;
    loaded = json.value;
    saveBtn.hidden = d.readOnly;
    removeBtn.hidden = d.readOnly || d.keyField === null || d.published === null;
    if (d.published !== null && entryOf(d)) {
      askUsage(d);
    }
    revertBtn.hidden = d.readOnly || d.pack === null || d.status === "pack" || d.status === null;
    discardBtn.hidden = d.draft === null;
    // An item's picture, as the draft has it (one the draft removes has none to pick).
    if (d.dataset === "items" && d.part === "items" && d.key !== null && d.draft?.op !== "remove") {
      showPicker(d.key);
    } else {
      hidePicker();
    }
  }

  function closeEditor(): void {
    usage = null;
    usageSeq = -1;
    usageBox.replaceChildren();
    removalBox.replaceChildren();
    editor.hidden = true;
    editing = null;
    editingKeyField = null;
    hidePicker();
    loaded = "";
    json.value = "";
  }

  function saveRow(): void {
    if (!editing) {
      return;
    }
    let data: unknown;
    try {
      data = JSON.parse(json.value);
    } catch (e) {
      showError(`That is not valid JSON: ${(e as Error).message}`);
      return;
    }
    let ref = editing;
    if (ref.key === null && editingKeyField) {
      const k = (data as Record<string, unknown> | null)?.[editingKeyField];
      if (typeof k !== "string" && typeof k !== "number") {
        showError(`The row needs its "${editingKeyField}".`);
        return;
      }
      // The key travels in the message, which takes 1 to 80 characters: say so here rather than
      // send a message the server must drop.
      const key = String(k);
      if (key.trim() === "" || key.length > 80) {
        showError(`Its "${editingKeyField}" is its key: 1 to 80 characters.`);
        return;
      }
      ref = { ...ref, key: String(k) };
    }
    showError("");
    const saved = ref;
    resultSeq = next();
    resultInEditor = true;
    afterResult = () => {
      refreshAll();
      openRow(saved);
    };
    actions.draft(resultSeq, ref, "set", data);
  }

  function removeRow(): void {
    const ref = editing;
    if (!ref || ref.key === null) {
      return;
    }
    // An item or a monster is removed with its cleanup, once its usage report is in.
    if (entryOf(ref)) {
      if (!usage) {
        showError("Wait for the usage report before removing it.");
        return;
      }
      const u = usage;
      removalBox.replaceChildren(
        removalForm(u, root, {
          submit: (plan) => {
            resultSeq = next();
            resultInEditor = true;
            afterResult = () => {
              removalBox.replaceChildren();
              refreshAll();
              openRow(ref);
            };
            actions.remove(resultSeq, plan);
          },
          cancel: () => removalBox.replaceChildren(),
        }),
      );
      return;
    }
    void confirmBox(root, {
      text: `Add the removal of ${refLabel(ref)} to the draft?`,
      confirm: "Remove",
      cancel: "Keep it",
      danger: true,
    }).then((yes) => {
      if (yes) {
        resultSeq = next();
        resultInEditor = true;
        afterResult = () => {
          refreshAll();
          openRow(ref);
        };
        actions.draft(resultSeq, ref, "remove", null);
      }
    });
  }

  function revertRow(): void {
    const ref = editing;
    if (!ref) {
      return;
    }
    resultSeq = next();
    resultInEditor = true;
    afterResult = () => {
      refreshAll();
      openRow(ref);
    };
    actions.draft(resultSeq, ref, "revert", null);
  }

  // ---- publish history ------------------------------------------------------------------------
  // ---- art and sounds (issue #29) -------------------------------------------------------------
  const artSection = section(
    "Art and sounds",
    "Upload PNG pictures and WAV, MP3 or OGG sounds. Each file is checked and stored on the server under the hash of its bytes, and goes live when an art row in the draft names it (under art: items, paperdoll, bodies, fx, tiles or sounds) and the draft is published.",
  );
  const uploader = createArtUploader({ ticket });
  artSection.body.append(uploader.el);

  const picturesSection = section(
    "Item pictures",
    "Upload many item pictures at once, and see which items have none. Open an item's row to upload, choose or adjust its picture with a preview.",
  );
  const pictures = artOptions
    ? createItemPictures({
        ...artOptions,
        openItem(key) {
          openRow({ dataset: "items", part: "items", key });
          editor.scrollIntoView?.({ block: "start" });
        },
      })
    : null;
  if (pictures) {
    picturesSection.body.append(pictures.el);
  } else {
    picturesSection.el.hidden = true;
  }
  const refreshPictures = () => {
    if (pictures) {
      void askItemArt()
        .then((v) => pictures.setView(v))
        .catch(() => {});
    }
  };

  const history = section("Publish history", "Newest first. Undo takes a whole publish back.");
  const historyTable = createTable<ContentPublishView>({
    label: "Publish history",
    empty: "Nothing has been published yet.",
    key: (p) => p.id,
    columns: [
      { label: "When (UTC)", cell: (p) => when(p.at) },
      { label: "By", cell: (p) => p.actorName },
      {
        label: "Summary",
        cell: (p) => {
          if (p.cleanup.length === 0) {
            return p.summary;
          }
          const cell = document.createElement("div");
          const ul = document.createElement("ul");
          ul.className = "content-usage-list";
          for (const line of p.cleanup) {
            const li = document.createElement("li");
            li.textContent = line;
            ul.append(li);
          }
          cell.append(p.summary, ul);
          return cell;
        },
      },
      { label: "Rows", cell: (p) => p.rows.join(", ") },
      {
        label: "",
        cell: (p) => {
          if (p.undoneBy) {
            return "Undone";
          }
          return panelButton("content-undo", "Undo", () => {
            void confirmBox(root, {
              text: `Undo "${p.summary}"? Every row it changed goes back as it was before, live at once.${p.cleanup.length > 0 ? " What it did to the world (deleted, replaced or despawned) is not undone." : ""}`,
              confirm: "Undo",
              cancel: "Keep it",
              danger: true,
            }).then((yes) => {
              if (yes) {
                resultSeq = next();
                resultInEditor = false;
                afterResult = refreshAll;
                actions.undo(resultSeq, p.id);
              }
            });
          });
        },
      },
    ],
  });
  history.body.append(historyTable.el);

  // ---- problems -------------------------------------------------------------------------------
  const problemsSection = section(
    "Problems",
    "References nothing resolves. They never stop the game: an unknown item shows by its name with no picture, and an unknown monster spawns as a stand-in. Content's own are as the packs shipped them, or left by a change.",
  );
  const problemsBody = document.createElement("div");
  problemsBody.className = "content-problems-body";
  problemsSection.body.append(
    panelButton("content-problems-check", "Look for problems", () => {
      problemsSeq = next();
      problemsBody.replaceChildren("Looking…");
      actions.problems(problemsSeq);
    }),
    problemsBody,
  );
  const drawProblems = (contentList: ContentProblemView[], world: ContentProblemView[]) => {
    const part = (title: string, list: ContentProblemView[], none: string) => {
      const h = document.createElement("h4");
      h.className = "content-usage-title";
      h.textContent = `${title} (${list.length})`;
      if (list.length === 0) {
        const p = document.createElement("p");
        p.className = "content-checks-ok";
        p.textContent = none;
        return [h, p];
      }
      return [h, problemList(list)];
    };
    problemsBody.replaceChildren(
      ...part("In the world", world, "Every stored item and spawn names something that exists."),
      ...part("In content", contentList, "Every reference in content resolves."),
    );
  };

  root.append(
    packs.el,
    notices.el,
    draft.el,
    rows.el,
    picturesSection.el,
    artSection.el,
    history.el,
    problemsSection.el,
  );

  function refreshAll(): void {
    overviewSeq = next();
    actions.overview(overviewSeq);
    askList();
    refreshPictures();
  }

  function drawOverview(o: ContentOverview): void {
    overview = o;
    packTable.setRows(o.packs);
    drawNotices(o.notices);
    draftTable.setRows(o.draft);
    checks.replaceChildren();
    if (o.draft.length > 0) {
      if (o.problems.length === 0) {
        const ok = document.createElement("p");
        ok.className = "content-checks-ok";
        ok.textContent = "Every check passes.";
        checks.append(ok);
      } else {
        const bad = document.createElement("p");
        bad.textContent = "Fix these before publishing:";
        checks.append(bad, problemList(o.problems));
      }
    }
    const nextRemovals = drawRemovals(o.removals ?? []);
    removals.replaceWith(nextRemovals);
    removals = nextRemovals;
    publishBtn.disabled = o.draft.length === 0 || o.problems.length > 0;
    historyTable.setRows(o.history);
    if (datasetSel.options.length === 0) {
      datasetSel.replaceChildren(
        ...o.datasets.map((d) => {
          const opt = document.createElement("option");
          opt.value = d.id;
          opt.textContent = d.readOnly ? `${d.id} (read-only)` : d.id;
          return opt;
        }),
      );
      fillParts();
      askList();
    }
  }

  return {
    el: root,
    onShow: refreshAll,
    receive(msg) {
      switch (msg.t) {
        case "contentUploadTicket": {
          const wait = ticketWaits.get(msg.seq);
          ticketWaits.delete(msg.seq);
          wait?.({ ticket: msg.ticket, maxBytes: msg.maxBytes });
          return;
        }
        case "contentItemArt": {
          const wait = itemArtWaits.get(msg.seq);
          itemArtWaits.delete(msg.seq);
          wait?.(msg.view);
          return;
        }
        case "contentOverview":
          if (msg.seq === overviewSeq) {
            drawOverview(msg.overview);
          }
          return;
        case "contentList":
          if (msg.seq === listSeq) {
            listing = msg.listing;
            if (msg.error) {
              say(msg.error);
            }
            drawList();
          }
          return;
        case "contentRow":
          if (msg.seq === rowSeq) {
            if (msg.row) {
              showRow(msg.row);
            } else {
              editorState.textContent = msg.error ?? "There is no such row.";
            }
          }
          return;
        case "contentUsage":
          if (msg.seq === usageSeq) {
            usage = msg.usage;
            usageBox.replaceChildren(
              msg.usage
                ? drawUsage(msg.usage, {
                    openRow: (r) => openRow(r),
                    openCharacter: (name) => actions.openCharacter(name),
                  })
                : (msg.error ?? ""),
            );
          }
          return;
        case "contentProblems":
          if (msg.seq === problemsSeq) {
            drawProblems(msg.content, msg.world);
          }
          return;
        case "contentResult":
          if (resultWaits.has(msg.seq)) {
            const wait = resultWaits.get(msg.seq);
            resultWaits.delete(msg.seq);
            wait?.({ ok: msg.ok, text: msg.text });
            return;
          }
          if (msg.seq === resultSeq) {
            if (msg.ok) {
              say(msg.text);
              if (resultInEditor) {
                loaded = json.value;
              }
              afterResult();
            } else if (resultInEditor && !editor.hidden) {
              showError(msg.text, msg.problems ?? []);
              say("");
            } else {
              say(msg.text, msg.problems ?? []);
            }
          }
          return;
      }
    },
    published() {
      if (root.isConnected) {
        refreshAll();
      }
    },
    changes: () => (!editor.hidden && json.value !== loaded ? 1 : 0) + (picker?.pending() ? 1 : 0),
    discard: () => closeEditor(),
    reset() {
      overview = null;
      listing = null;
      // Answers still awaited belong to the session that ended.
      for (const wait of resultWaits.values()) {
        wait({ ok: false, text: "The session ended." });
      }
      resultWaits.clear();
      ticketWaits.clear();
      itemArtWaits.clear();
      pictures?.reset();
      problemsBody.replaceChildren();
      closeEditor();
      datasetSel.replaceChildren();
      partSel.replaceChildren();
      say("");
    },
  };
}
