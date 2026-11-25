/**
 * The Control Panel's NPCs page (issue #32): every NPC file in a searchable list, and the open one
 * as forms, one per section (Bio, profile, chatter, shop, till, banker, trainer, loot, spells and
 * flags), or as its text, kept in step: switching views carries the edit across. An SSO page: 1.6
 * edited NPC files as text in the NPC Editor window.
 *
 * - The file is what the server's readers read, so the forms only write the lines a section holds;
 *   every other line (`OWN|`, blank lines, an unknown tag) stays where it is, and an unchanged entry
 *   keeps its line exactly (shared `npcModel`/`withNpcModel`).
 * - Validation as you type runs the server's own check (`checkNpcFile`) on the text a save would send.
 * - A save applies at once, outside the draft, as the NPC Editor's always did, and names the revision
 *   the edit started from: one over a file changed since is refused.
 */
import {
  type ContentNpcsView,
  type ContentNpcView,
  checkNpcFile,
  editorLines,
  type NpcListEntry,
  type NpcModel,
  npcFieldOk,
  npcModel,
  resolveNpcItemNames,
  withNpcModel,
} from "@secondstaronline/shared";

import { action, noAutofill } from "./action.ts";
import { pageHeading, panelButton } from "./control-panel-kit.ts";

export interface NpcsPageActions {
  view(seq: number, name?: string): void;
  save(seq: number, name: string, text: string, expect: string | null): void;
  /** Opens a monster on the Monsters page. */
  openMonster(name: string): void;
  /** Whether the Monsters page may be opened (its permission). */
  canOpenMonster?(): boolean;
}

export interface NpcsAnswer {
  t: "contentNpcs";
  seq: number;
  view: ContentNpcsView;
  result?: { ok: boolean; text: string };
}

export interface NpcsPage {
  readonly el: HTMLElement;
  onShow(): void;
  changes(): number;
  discard(): void;
  receive(msg: NpcsAnswer): void;
  reset(): void;
  open(name: string): void;
}

type Sections = Omit<ReturnType<typeof npcModel>, "mixed" | "lines">;

/** The text a save sends for `work` over the file it was filled from. */
export function npcText(base: string, work: Sections): string {
  return withNpcModel(base, work);
}

/** The server's check of a file's text, as a save would run it: its error, or its warnings. */
export function npcCheck(text: string): { error: string | null; warnings: string[] } {
  const lines = resolveNpcItemNames(editorLines(text));
  return checkNpcFile(lines);
}

const LIST_FILTERS: readonly (readonly [string, string])[] = [
  ["all", "Every NPC"],
  ["files", "With a file"],
  ["npc", "On an NPC list"],
  ["shop", "Shopkeepers"],
  ["banker", "Bankers"],
  ["trainer", "Trainers"],
  ["loot", "Drops loot"],
  ["species", "Monsters"],
];

export function createNpcsPage(actions: NpcsPageActions): NpcsPage {
  const el = document.createElement("div");
  el.className = "npcs-page items-page balance-page";
  el.append(
    pageHeading(
      "NPCs",
      "Every NPC file: its Bio, what it says, what it sells and buys, its till, whether it banks or trains, and what it drops, casts and does. Edit the sections, or the file as text. Saving applies at once, for everyone, and starts its shop again from the saved stock; it does not wait for the content draft.",
    ),
  );
  let ids = 0;
  const labelled = (label: string, control: HTMLElement, help = "") => {
    const wrap = document.createElement("div");
    wrap.className = "control-panel-field balance-field";
    const l = document.createElement("label");
    l.className = "control-panel-field-label";
    ids += 1;
    control.id ||= `npcs-field-${ids}`;
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
  const say = (p: HTMLElement, text: string, ok = true) => {
    p.textContent = text;
    p.className = ok ? "balance-status" : "balance-status balance-status-error";
  };

  // ---- the list ----
  const listBox = document.createElement("section");
  listBox.className = "items-list-box";
  const search = noAutofill(action(document.createElement("input"), "npcs-search"));
  search.type = "search";
  search.placeholder = "Find an NPC";
  search.id = "npcs-search";
  const filter = action(document.createElement("select"), "npcs-filter");
  filter.id = "npcs-filter";
  for (const [v, t] of LIST_FILTERS) {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = t;
    filter.append(o);
  }
  const listEl = document.createElement("ul");
  listEl.className = "items-list";
  listEl.setAttribute("aria-label", "NPCs");
  const listCount = document.createElement("p");
  listCount.className = "control-panel-field-help";
  listBox.append(labelled("Find", search), labelled("Show", filter), listCount, listEl);

  // ---- the form ----
  const form = document.createElement("section");
  form.className = "items-form";
  form.hidden = true;
  const title = document.createElement("h2");
  title.className = "content-section-title";
  const live = document.createElement("p");
  live.className = "balance-stale";
  live.textContent =
    "Saving applies at once, for everyone: it does not wait for the draft. Its shop starts again from the stock saved here.";
  const monsterLink = panelButton(
    "npcs-open-monster",
    "Open its stats on the Monsters page",
    () => {
      if (shown) {
        actions.openMonster(shown.name);
      }
    },
  );
  const stale = document.createElement("p");
  stale.className = "balance-stale";
  stale.hidden = true;
  stale.textContent =
    "Someone changed this NPC file since you started editing it: saving will be refused. Drop your edit to see theirs.";
  const modeSel = action(document.createElement("select"), "npcs-mode");
  modeSel.id = "npcs-mode";
  for (const [v, t] of [
    ["forms", "Sections"],
    ["text", "Text"],
  ]) {
    const o = document.createElement("option");
    o.value = v as string;
    o.textContent = t as string;
    modeSel.append(o);
  }
  const sectionsEl = document.createElement("fieldset");
  sectionsEl.className = "items-rules";
  const textArea = noAutofill(action(document.createElement("textarea"), "npcs-text"));
  textArea.id = "npcs-text";
  textArea.className = "content-json";
  textArea.rows = 20;
  textArea.spellcheck = false;
  const textBox = labelled(
    "The file",
    textArea,
    "One line per entry: BIO|, PRO|, RND|, SEL|item:price:stock, BUY|item:price, GLD|gold, TRN|class:price, BNK|, INV|item:1 in N, SPL|spell, FLG|flag.",
  );
  const checkBox = document.createElement("div");
  checkBox.className = "npcs-check";
  checkBox.setAttribute("role", "status");
  const status = document.createElement("p");
  status.className = "balance-status";
  status.setAttribute("role", "status");
  const saveBtn = panelButton(
    "npcs-save",
    "Save now",
    () => {
      if (!shown || busy) {
        return;
      }
      const text = currentText();
      if (text === null) {
        return;
      }
      busy = true;
      seq += 1;
      saving.set(seq, shown.name);
      say(status, "Saving…");
      update();
      actions.save(seq, shown.name, text, filledRevision);
    },
    "primary",
  );
  const undoBtn = panelButton("npcs-undo", "Drop my edit", () => {
    fill();
    status.textContent = "";
    update();
  });
  const buttons = document.createElement("div");
  buttons.className = "content-buttons";
  buttons.append(saveBtn, undoBtn);
  form.append(
    title,
    live,
    monsterLink,
    stale,
    labelled("Edit as", modeSel),
    sectionsEl,
    textBox,
    checkBox,
    buttons,
    status,
  );
  const itemsList = document.createElement("datalist");
  itemsList.id = "npcs-items";
  const loading = document.createElement("p");
  loading.className = "balance-loading";
  loading.textContent = "Loading…";
  const layout = document.createElement("div");
  layout.className = "items-layout";
  layout.append(listBox, form);
  el.append(itemsList, loading, layout);

  // ---- state ----
  let seq = 0;
  let resetSeq = -1;
  let appliedSeq = -1;
  const saving = new Map<number, string>();
  let list: NpcListEntry[] = [];
  let choices: ContentNpcsView["choices"] | null = null;
  let openName: string | null = null;
  let shown: ContentNpcView | null = null;
  /** The file's text and revision the edit started from. */
  let base = "";
  /** The file's text as the page showed it: what "unsaved" compares against (never moved by a view switch). */
  let loaded = "";
  let filledRevision: string | null = null;
  let work: Sections = emptySections();
  let mode: "forms" | "text" = "forms";
  let busy = false;
  /** Fields whose text does not read. */
  const invalid = new Map<HTMLElement, string>();

  function emptySections(): Sections {
    const { mixed: _m, lines: _l, ...s } = npcModel("");
    return s;
  }
  const modelOf = (text: string) => {
    const { mixed, lines, ...s } = npcModel(text);
    return { s, mixed, lines };
  };
  /** The text a save would send, or null while a field does not read. */
  const currentText = (): string | null => {
    if (mode === "text") {
      return textArea.value;
    }
    if (invalid.size > 0) {
      return null;
    }
    try {
      return npcText(base, work);
    } catch {
      return null;
    }
  };
  const dirty = () => {
    if (!shown) {
      return false;
    }
    const t = currentText();
    return t === null || editorLines(t).join("\r") !== editorLines(loaded).join("\r");
  };

  const ask = () => {
    seq += 1;
    actions.view(seq, openName ?? undefined);
  };

  // ---- controls ----
  const edited = () => {
    status.textContent = "";
    update();
  };
  const linesArea = (
    key: "bio" | "profile" | "chatter" | "spells" | "flags",
    label: string,
    help: string,
  ) => {
    const area = noAutofill(action(document.createElement("textarea"), `npcs-${key}`));
    area.rows = Math.max(2, Math.min(8, (work[key] as string[]).length + 1));
    area.value = (work[key] as string[]).join("\n");
    area.addEventListener("input", () => {
      // A blank Bio, profile or chatter line is a line of its own (`PRO|`); a blank flag is nothing.
      const lines =
        key === "flags" || key === "spells"
          ? area.value.split("\n").filter((l) => l !== "")
          : area.value === ""
            ? []
            : area.value.split("\n");
      const bad = lines.find((l) => !npcFieldOk(l.replace(/:/g, "")));
      if (bad !== undefined) {
        invalid.set(area, `${label}: "${bad}" cannot hold | \` * ^`);
      } else {
        invalid.delete(area);
        (work[key] as string[]) = lines;
      }
      edited();
    });
    return labelled(label, area, help);
  };
  const num = (
    value: number,
    min: number,
    label: string,
    write: (n: number) => void,
  ): HTMLInputElement => {
    const input = noAutofill(action(document.createElement("input"), "npcs-number"));
    input.type = "number";
    input.min = String(min);
    input.step = "1";
    input.value = String(value);
    input.addEventListener("input", () => {
      const t = input.value.trim();
      if (!/^\d+$/.test(t) || Number(t) < min || !Number.isSafeInteger(Number(t))) {
        invalid.set(input, `${label}: a whole number from ${min}`);
      } else {
        invalid.delete(input);
        write(Number(t));
      }
      edited();
    });
    return input;
  };
  const text = (value: string, label: string, write: (t: string) => void, listId = "") => {
    const input = noAutofill(action(document.createElement("input"), "npcs-text-field"));
    input.value = value;
    if (listId) {
      input.setAttribute("list", listId);
    }
    input.addEventListener("input", () => {
      if (input.value.trim() === "" || !npcFieldOk(input.value)) {
        invalid.set(input, `${label}: one name, without | : \` * ^`);
      } else {
        invalid.delete(input);
        write(input.value.trim());
      }
      edited();
    });
    return input;
  };
  /** A table of entries: one row each, removable, and an Add button. */
  const rows = <T>(
    id: string,
    label: string,
    help: string,
    get: () => T[],
    fresh: () => T,
    cells: (row: T, i: number) => HTMLElement[],
  ) => {
    const box = document.createElement("div");
    box.className = "items-list-editor";
    box.dataset.list = id;
    const head = document.createElement("h4");
    head.className = "items-list-title";
    head.textContent = label;
    const h = document.createElement("p");
    h.className = "control-panel-field-help";
    h.textContent = help;
    const body = document.createElement("div");
    /** A field of this table that does not read: rows wait, so its text is never redrawn away. */
    const blocked = (except?: HTMLElement) => {
      // A row being removed takes its own fields' errors with it.
      const bad = [...invalid.entries()].find(
        ([k]) => body.contains(k) && !(except?.contains(k) ?? false),
      );
      if (bad) {
        say(status, `${bad[1]}: fix it before adding or removing a row.`, false);
      }
      return bad !== undefined;
    };
    const draw = () => {
      body.replaceChildren(
        ...get().map((row, i) => {
          const line = document.createElement("div");
          line.className = "items-list-row";
          line.append(
            ...cells(row, i),
            panelButton(`npcs-${id}-remove`, "Remove", () => {
              if (blocked(line)) {
                return;
              }
              get().splice(i, 1);
              draw();
              for (const k of [...invalid.keys()]) {
                if (!k.isConnected) {
                  invalid.delete(k);
                }
              }
              edited();
            }),
          );
          return line;
        }),
      );
    };
    draw();
    box.append(
      head,
      h,
      body,
      panelButton(`npcs-${id}-add`, `Add`, () => {
        if (blocked()) {
          return;
        }
        get().push(fresh());
        draw();
        edited();
      }),
    );
    return box;
  };

  const drawSections = (mixed: number[], kept: { line: number; text: string }[]) => {
    if (mixed.length > 0) {
      const p = document.createElement("p");
      p.className = "balance-stale";
      p.textContent = `Line ${mixed.join(", ")} is read two ways at once (a drop line inside another line): edit the file as text.`;
      sectionsEl.replaceChildren(p);
      return;
    }
    const c = choices;
    const sec = (titleText: string, ...kids: HTMLElement[]) => {
      const s = document.createElement("section");
      s.className = "balance-row items-group";
      const h = document.createElement("h3");
      h.className = "balance-row-title";
      h.textContent = titleText;
      s.append(h, ...kids);
      return s;
    };
    const keptNote = document.createElement("p");
    keptNote.className = "control-panel-field-help";
    keptNote.textContent =
      kept.length === 0
        ? ""
        : `Kept as they are (edit them as text): ${kept.map((k) => `line ${k.line} "${k.text}"`).join(", ")}.`;
    const banker = document.createElement("label");
    banker.className = "items-check";
    const bankBox = action(document.createElement("input"), "npcs-banker");
    bankBox.type = "checkbox";
    bankBox.checked = work.banker.length > 0;
    bankBox.addEventListener("change", () => {
      work.banker = bankBox.checked ? (work.banker.length > 0 ? work.banker : [""]) : [];
      edited();
    });
    banker.append(bankBox, " A banker (opens the bank)");
    const spellBox = document.createElement("div");
    spellBox.className = "items-checks";
    spellBox.dataset.list = "spells";
    const has = new Set(work.spells.map((x) => x.toLowerCase()));
    for (const tag of [
      ...(c?.spellTags ?? []),
      ...work.spells.filter(
        (x) => !(c?.spellTags ?? []).some((t) => t.toLowerCase() === x.toLowerCase()),
      ),
    ]) {
      const l = document.createElement("label");
      l.className = "items-check";
      const b = action(document.createElement("input"), "npcs-spell");
      b.type = "checkbox";
      b.checked = has.has(tag.toLowerCase());
      b.addEventListener("change", () => {
        work.spells = b.checked
          ? [...work.spells, tag]
          : work.spells.filter((x) => x.toLowerCase() !== tag.toLowerCase());
        edited();
      });
      l.append(b, ` ${tag}`);
      spellBox.append(l);
    }
    sectionsEl.replaceChildren(
      sec(
        "Bio and talk",
        linesArea("bio", "Bio", "The Bio window's lines, one per line."),
        linesArea("profile", "Profile", "The profile lines, one per line."),
        linesArea("chatter", "Chatter", "Lines it says to the map now and then, one per line."),
      ),
      sec(
        "Shop",
        rows(
          "sells",
          "Sells",
          "What it sells: the item, its price and the stock it starts with (the live stock shows here).",
          () => work.sells,
          () => ({ item: "", price: 1, stock: 1 }),
          (r, i) => [
            labelled(
              "Item",
              text(
                r.item,
                `Sells ${i + 1}: item`,
                (t) => {
                  r.item = t;
                },
                itemsList.id,
              ),
            ),
            labelled(
              "Price",
              num(r.price, 0, `Sells ${i + 1}: price`, (n) => {
                r.price = n;
              }),
            ),
            labelled(
              "Stock",
              num(r.stock, 0, `Sells ${i + 1}: stock`, (n) => {
                r.stock = n;
              }),
            ),
          ],
        ),
        rows(
          "buys",
          "Buys",
          "What it buys from players, and the price it pays.",
          () => work.buys,
          () => ({ item: "", price: 1 }),
          (r, i) => [
            labelled(
              "Item",
              text(
                r.item,
                `Buys ${i + 1}: item`,
                (t) => {
                  r.item = t;
                },
                itemsList.id,
              ),
            ),
            labelled(
              "Price",
              num(r.price, 0, `Buys ${i + 1}: price`, (n) => {
                r.price = n;
              }),
            ),
          ],
        ),
        rows(
          "gold",
          "Till",
          "The gold it holds to pay for what it buys (one line; the live till shows here). None: a till from 0.",
          () => work.gold as unknown as { v: number }[],
          () => 0 as unknown as { v: number },
          (_r, i) => [
            labelled(
              "Gold",
              num(work.gold[i] ?? 0, 0, "Till", (n) => {
                work.gold[i] = n;
              }),
            ),
          ],
        ),
        banker,
      ),
      sec(
        "Trainer",
        rows(
          "trains",
          "Promotes to",
          "A class it promotes a player to, and the price.",
          () => work.trains,
          () => ({ cls: c?.classes[0] ?? "", price: 1000 }),
          (r, i) => [
            labelled(
              "Class",
              text(
                r.cls,
                `Trainer ${i + 1}: class`,
                (t) => {
                  r.cls = t;
                },
                "npcs-classes",
              ),
            ),
            labelled(
              "Price",
              num(r.price, 0, `Trainer ${i + 1}: price`, (n) => {
                r.price = n;
              }),
            ),
          ],
        ),
      ),
      sec(
        "Loot, spells and flags",
        rows(
          "loot",
          "Loot",
          "A kill picks one line at random, then drops it 1 in N times. A count before the item drops a pile: 15 Gold.",
          () => work.loot,
          () => ({ item: "", oneIn: 1 }),
          (r, i) => [
            labelled(
              "Item",
              text(
                r.item,
                `Loot ${i + 1}: item`,
                (t) => {
                  r.item = t;
                },
                itemsList.id,
              ),
            ),
            labelled(
              "1 in",
              num(r.oneIn, 1, `Loot ${i + 1}: 1 in`, (n) => {
                r.oneIn = n;
              }),
            ),
          ],
        ),
        labelled("Spells it casts", spellBox),
        linesArea(
          "flags",
          "Flags",
          "One per line. Passive: it fights only once attacked. Still: it never walks.",
        ),
      ),
      keptNote,
    );
    const classes = document.createElement("datalist");
    classes.id = "npcs-classes";
    for (const k of c?.classes ?? []) {
      const o = document.createElement("option");
      o.value = k;
      classes.append(o);
    }
    sectionsEl.append(classes);
  };

  /** Shows the open file in the mode chosen, from `base` and `work`. */
  const drawForm = () => {
    if (!shown) {
      return;
    }
    sectionsEl.hidden = mode !== "forms";
    textBox.hidden = mode !== "text";
    if (mode === "forms") {
      const m = modelOf(npcText(base, work));
      drawSections(
        m.mixed,
        m.lines
          .filter((l) => l.kind === null && l.text !== "")
          .map((l) => ({ line: l.line, text: l.text })),
      );
    }
  };

  const fill = () => {
    if (!shown) {
      return;
    }
    base = shown.text;
    loaded = shown.text;
    filledRevision = shown.revision;
    const m = modelOf(base);
    work = m.s;
    invalid.clear();
    // A file read two ways opens as text.
    if (m.mixed.length > 0) {
      mode = "text";
      modeSel.value = "text";
    }
    textArea.value = base.replace(/\r\n|\r/g, "\n");
    drawForm();
  };

  modeSel.addEventListener("change", () => {
    const next = modeSel.value === "text" ? "text" : "forms";
    if (next === mode) {
      return;
    }
    if (next === "text") {
      // The sections' edit becomes the text.
      const t = currentText();
      if (t === null) {
        modeSel.value = "forms";
        say(status, "Fix the fields marked first.", false);
        return;
      }
      textArea.value = t.replace(/\r\n|\r/g, "\n");
    } else {
      // The text's edit becomes the sections: the text is the new base.
      const m = modelOf(textArea.value);
      if (m.mixed.length > 0) {
        modeSel.value = "text";
        say(
          status,
          `Line ${m.mixed.join(", ")} is read two ways at once: fix it as text first.`,
          false,
        );
        return;
      }
      base = textArea.value;
      work = m.s;
      invalid.clear();
    }
    mode = next;
    drawForm();
    update();
  });
  textArea.addEventListener("input", () => edited());

  const update = () => {
    const v = shown;
    if (!v) {
      return;
    }
    title.textContent = v.exists ? v.name : `${v.name} (no file yet)`;
    monsterLink.hidden = !v.species || actions.canOpenMonster?.() === false;
    const isDirty = dirty();
    stale.hidden = !(isDirty && v.revision !== filledRevision);
    const t = currentText();
    const errs = [...invalid.values()];
    if (errs.length > 0) {
      checkBox.textContent = errs.join(". ");
      checkBox.className = "npcs-check balance-status-error";
    } else if (t !== null) {
      const r = npcCheck(t);
      checkBox.textContent = r.error
        ? `A save would be refused: ${r.error}`
        : r.warnings.length > 0
          ? r.warnings.join(" ")
          : "";
      checkBox.className = r.error ? "npcs-check balance-status-error" : "npcs-check";
    }
    const refused = t === null || npcCheck(t).error !== null;
    saveBtn.disabled = busy || refused || !(isDirty || !v.exists);
    saveBtn.textContent = v.exists ? "Save now" : "Make its NPC file now";
    undoBtn.hidden = !isDirty;
    undoBtn.disabled = busy;
    sectionsEl.disabled = busy;
    textArea.readOnly = busy;
  };

  const drawList = () => {
    const words = search.value
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w !== "");
    const f = filter.value as keyof NpcListEntry | "all" | "files";
    const shownRows = list.filter((n) => {
      if (!words.every((w) => n.name.toLowerCase().includes(w))) {
        return false;
      }
      return f === "all" ? true : f === "files" ? n.file : n[f as keyof NpcListEntry] === true;
    });
    listCount.textContent = `${shownRows.length} of ${list.length} NPCs`;
    listEl.replaceChildren(
      ...shownRows.map((n) => {
        const li = document.createElement("li");
        const b = action(document.createElement("button"), "npcs-open");
        b.type = "button";
        b.className = "items-list-item";
        b.dataset.npc = n.name;
        if (openName && n.name.toLowerCase() === openName.toLowerCase()) {
          b.setAttribute("aria-current", "true");
        }
        const name = document.createElement("span");
        name.textContent = n.name;
        const meta = document.createElement("span");
        meta.className = "items-list-meta";
        meta.textContent = [
          n.file ? "" : "no file",
          n.shop ? "shop" : "",
          n.banker ? "banker" : "",
          n.trainer ? "trainer" : "",
          n.loot ? "loot" : "",
          n.species ? "monster" : "",
        ]
          .filter((x) => x !== "")
          .join(" · ");
        b.append(name, " ", meta);
        b.addEventListener("click", () => openNpc(n.name));
        li.append(b);
        return li;
      }),
    );
  };
  search.addEventListener("input", drawList);
  filter.addEventListener("change", drawList);

  const openNpc = (name: string) => {
    if (shown && (dirty() || busy)) {
      say(
        status,
        busy
          ? "Wait for the save to finish."
          : `${shown.name} has unsaved changes: save them or drop your edit first.`,
        false,
      );
      return;
    }
    openName = name;
    shown = null;
    form.hidden = true;
    status.textContent = "";
    drawList();
    ask();
  };

  const show = (view: ContentNpcsView) => {
    loading.hidden = true;
    list = view.npcs;
    choices = view.choices;
    if (
      [...itemsList.children].map((o) => (o as HTMLOptionElement).value).join("\u0000") !==
      view.choices.items.join("\u0000")
    ) {
      itemsList.replaceChildren(
        ...view.choices.items.map((i) => {
          const o = document.createElement("option");
          o.value = i;
          return o;
        }),
      );
    }
    drawList();
    const n = view.npc;
    if (!openName || !n || n.name.toLowerCase() !== openName.toLowerCase()) {
      return;
    }
    const first = shown === null || shown.name !== n.name;
    shown = n;
    form.hidden = false;
    if (first || (!dirty() && !busy)) {
      fill();
    }
    update();
  };

  return {
    el,
    onShow: ask,
    changes: () => (dirty() && !busy ? 1 : 0),
    discard() {
      if (!busy) {
        fill();
        status.textContent = "";
        update();
      }
    },
    receive(msg) {
      if (msg.seq <= resetSeq) {
        return;
      }
      const newer = msg.seq >= appliedSeq;
      const savedFor = saving.get(msg.seq);
      if (savedFor !== undefined) {
        saving.delete(msg.seq);
        busy = false;
        if (msg.result) {
          say(status, msg.result.text, msg.result.ok);
          if (
            msg.result.ok &&
            msg.view.npc &&
            shown &&
            savedFor.toLowerCase() === shown.name.toLowerCase()
          ) {
            shown = msg.view.npc;
            fill();
          }
        }
      }
      if (!newer) {
        update();
        return;
      }
      appliedSeq = msg.seq;
      show(msg.view);
    },
    reset() {
      seq += 1;
      resetSeq = seq;
      appliedSeq = seq;
      saving.clear();
      list = [];
      choices = null;
      openName = null;
      shown = null;
      base = "";
      loaded = "";
      filledRevision = null;
      work = emptySections();
      mode = "forms";
      modeSel.value = "forms";
      busy = false;
      invalid.clear();
      search.value = "";
      filter.value = "all";
      status.textContent = "";
      checkBox.textContent = "";
      listEl.replaceChildren();
      sectionsEl.replaceChildren();
      textArea.value = "";
      form.hidden = true;
      loading.hidden = false;
    },
    open(name) {
      openNpc(name);
    },
  };
}

export type { NpcModel };
