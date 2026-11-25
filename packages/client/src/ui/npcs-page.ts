/**
 * The Control Panel's NPCs page (issue #32): every NPC file in a searchable list, and the open one
 * as a plain form behind four tabs (Talk; Shop; Bank and training; As a monster), or as its text,
 * kept in step: switching views carries the edit across. The form names things in plain words
 * (the file's tags only appear in the text view). An SSO page: 1.6 edited NPC files as text in
 * the NPC Editor window.
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
  NPC_FLAGS,
  type NpcListEntry,
  type NpcModel,
  npcFieldOk,
  npcModel,
  resolveNpcItemNames,
  withNpcModel,
} from "@secondstaronline/shared";

import { action, noAutofill } from "./action.ts";
import { formActions, pageHeading, panelButton, sectionTabs } from "./control-panel-kit.ts";

export interface NpcsPageActions {
  view(seq: number, name?: string): void;
  save(seq: number, name: string, text: string, expect: string | null): void;
  /** Opens a monster on the Monsters page. */
  openMonster(name: string): void;
  /** Whether the Monsters page may be opened (its permission). */
  canOpenMonster?(): boolean;
  /**
   * Whether a creature's loot, spells and behaviour are edited on the Creatures tab beside this
   * page (a content editor's): the As a monster tab then stays out of the way, so each thing has
   * one place. Its lines are kept as they are when the file is saved here.
   */
  lootElsewhere?(): boolean;
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
  ["files", "Has a file"],
  ["npc", "Placed as an NPC"],
  ["shop", "Shopkeepers"],
  ["banker", "Bankers"],
  ["trainer", "Trainers"],
  ["loot", "Drops loot"],
  ["species", "Monsters"],
];

/** The flags that do something in play, with what each does. */
const FLAG_TEXT: readonly (readonly [(typeof NPC_FLAGS)[number], string])[] = [
  ["Still", "Stays in one place (never walks)"],
  ["Passive", "Only fights once someone attacks it"],
];

const isKnownFlag = (line: string) => NPC_FLAGS.some((f) => f.toLowerCase() === line.toLowerCase());

/** One loot line's chance a kill drops it: a line picked at random, then 1 in N. */
export function lootOdds(lines: number, oneIn: number): string {
  if (lines < 1 || oneIn < 1) {
    return "";
  }
  const n = lines * oneIn;
  return n === 1 ? "Every kill" : `About 1 in ${n.toLocaleString("en")} kills`;
}

export function createNpcsPage(actions: NpcsPageActions): NpcsPage {
  const el = document.createElement("div");
  el.className = "npcs-page items-page balance-page plain-editor";
  el.append(
    pageHeading(
      "NPCs",
      "What each NPC says, sells and buys, whether it runs a bank or trains players, and what a monster drops and casts. Saving changes it straight away for everyone: there is nothing to publish.",
    ),
  );
  let ids = 0;
  const labelled = (label: string, control: HTMLElement, help = "") => {
    const wrap = document.createElement("div");
    wrap.className = "control-panel-field balance-field";
    const isGroup = control.tagName === "DIV";
    // A group of tick boxes is named by a heading, not a label (a label names one control).
    const l = document.createElement(isGroup ? "span" : "label");
    l.className = "control-panel-field-label";
    ids += 1;
    control.id ||= `npcs-field-${ids}`;
    if (l instanceof HTMLLabelElement) {
      l.htmlFor = control.id;
    } else {
      l.id = `${control.id}-label`;
      control.setAttribute("role", "group");
      control.setAttribute("aria-labelledby", l.id);
    }
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
  const intro = (text: string) => {
    const p = document.createElement("p");
    p.className = "items-intro";
    p.textContent = text;
    return p;
  };

  // ---- the list ----
  const listBox = document.createElement("section");
  listBox.className = "items-list-box";
  const search = noAutofill(action(document.createElement("input"), "npcs-search"));
  search.type = "search";
  search.placeholder = "Name";
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
  const filters = document.createElement("div");
  filters.className = "items-filters";
  filters.append(labelled("Search", search), labelled("Show", filter));
  listBox.append(filters, listCount, listEl);

  // ---- the form ----
  const form = document.createElement("section");
  form.className = "items-form";
  form.hidden = true;
  const header = document.createElement("div");
  header.className = "items-form-head";
  const title = document.createElement("h2");
  title.className = "content-section-title";
  const tags = document.createElement("div");
  tags.className = "balance-tags";
  const monsterLink = panelButton(
    "npcs-open-monster",
    "Open its stats on the Monsters page",
    () => {
      if (shown) {
        actions.openMonster(shown.name);
      }
    },
  );
  header.append(title, tags, monsterLink);
  const stale = document.createElement("p");
  stale.className = "balance-stale";
  stale.hidden = true;
  stale.textContent =
    "Someone saved this NPC while you were editing it, so saving will be refused. Undo your changes to see theirs.";
  const modeSel = action(document.createElement("select"), "npcs-mode");
  modeSel.id = "npcs-mode";
  for (const [v, t] of [
    ["forms", "Simple form"],
    ["text", "The file as text (advanced)"],
  ]) {
    const o = document.createElement("option");
    o.value = v as string;
    o.textContent = t as string;
    modeSel.append(o);
  }
  const modeBox = labelled(
    "View",
    modeSel,
    "The text view shows the NPC file itself, line by line. Your changes carry across when you switch.",
  );
  modeBox.classList.add("npcs-mode");
  const sectionsEl = document.createElement("fieldset");
  sectionsEl.className = "items-rules";
  const textArea = noAutofill(action(document.createElement("textarea"), "npcs-text"));
  textArea.id = "npcs-text";
  textArea.className = "content-json";
  textArea.rows = 20;
  textArea.spellcheck = false;
  const textBox = labelled(
    "The NPC file",
    textArea,
    "One line each, starting with a tag: BIO| and PRO| (its Bio window), RND| (things it says), SEL|item:price:stock (sells), BUY|item:price (buys), GLD|gold (its till), BNK| (runs a bank), TRN|class:price (promotions), INV|item:N (drops 1 in N), SPL|spell (casts), FLG|Still or FLG|Passive.",
  );
  textBox.classList.add("npcs-text-view");
  textBox.hidden = true;
  const checkBox = document.createElement("div");
  checkBox.className = "npcs-check";
  checkBox.setAttribute("role", "status");
  const status = document.createElement("p");
  status.className = "balance-status";
  status.setAttribute("role", "status");
  const saveBtn = panelButton(
    "npcs-save",
    "Save changes",
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
  const undoBtn = panelButton("npcs-undo", "Undo changes", () => {
    fill();
    status.textContent = "";
    update();
  });
  const mainButtons = document.createElement("div");
  mainButtons.className = "content-buttons";
  mainButtons.append(saveBtn, undoBtn);
  const liveNote = document.createElement("p");
  liveNote.className = "control-panel-field-help npcs-live";
  liveNote.textContent = "Saves go live at once, for everyone.";
  const buttons = document.createElement("div");
  buttons.className = "items-actions";
  buttons.append(mainButtons, liveNote);
  form.append(
    header,
    stale,
    sectionTabs(form, "npcs").el,
    sectionsEl,
    textBox,
    checkBox,
    modeBox,
    formActions(buttons, status),
  );
  const itemsList = document.createElement("datalist");
  itemsList.id = "npcs-items";
  const loading = document.createElement("p");
  loading.className = "balance-loading";
  loading.textContent = "Loading…";
  const empty = document.createElement("p");
  empty.className = "items-empty-form";
  empty.textContent = "Pick an NPC on the left to see and change what it says, sells and does.";
  const layout = document.createElement("div");
  layout.className = "items-layout";
  layout.append(listBox, empty, form);
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
  /** The tabs drawn, each with whether the file has anything in it (its tab's dot). */
  let tabsUsed: { sec: HTMLElement; used: () => boolean }[] = [];
  /** Redraws the loot lines' odds (they follow every line's chance and the number of lines). */
  let refreshOdds = () => {};

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
    refreshOdds();
    update();
  };
  const linesArea = (key: "bio" | "profile" | "chatter", label: string, help: string) => {
    const area = noAutofill(action(document.createElement("textarea"), `npcs-${key}`));
    area.rows = Math.max(2, Math.min(8, work[key].length + 1));
    area.value = work[key].join("\n");
    area.addEventListener("input", () => {
      // A blank Bio, profile or chatter line is a line of its own (`PRO|`).
      const lines = area.value === "" ? [] : area.value.split("\n");
      const bad = lines.find((l) => !npcFieldOk(l.replace(/:/g, "")));
      if (bad !== undefined) {
        invalid.set(area, `${label}: "${bad}" cannot hold | \` * ^`);
      } else {
        invalid.delete(area);
        work[key] = lines;
      }
      edited();
    });
    return labelled(label, area, help);
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
  /** A table of entries: one row each, removable, and an "+ Add …" button. */
  const rows = <T>(
    id: string,
    label: string,
    one: string,
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
        say(status, `${bad[1]}: fix it before adding or removing a line.`, false);
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
    const add = panelButton(`npcs-${id}-add`, `+ Add ${one}`, () => {
      if (blocked()) {
        return;
      }
      get().push(fresh());
      draw();
      edited();
    });
    add.classList.add("items-add");
    box.append(head, h, body, add);
    return box;
  };

  const drawSections = (mixed: number[], kept: { line: number; text: string }[]) => {
    tabsUsed = [];
    refreshOdds = () => {};
    if (mixed.length > 0) {
      const p = document.createElement("p");
      p.className = "balance-stale";
      p.textContent = `Line ${mixed.join(", ")} is read two ways at once (a drop line inside another line): change it in the file as text.`;
      sectionsEl.replaceChildren(p);
      return;
    }
    const c = choices;
    const sec = (titleText: string, help: string, used: () => boolean, ...kids: HTMLElement[]) => {
      const s = document.createElement("section");
      s.className = "balance-row items-group";
      const h = document.createElement("h3");
      h.className = "balance-row-title";
      h.textContent = titleText;
      s.append(h, intro(help), ...kids);
      tabsUsed.push({ sec: s, used });
      return s;
    };
    /** The As a monster tab, hidden where the Creatures tab edits the same lines. */
    const asMonster = (
      titleText: string,
      help: string,
      used: () => boolean,
      ...kids: HTMLElement[]
    ) => {
      const s = sec(titleText, help, used, ...kids);
      s.hidden = actions.lootElsewhere?.() === true;
      return s;
    };
    const more = (open: boolean, ...controls: HTMLElement[]) => {
      const box = document.createElement("details");
      box.className = "items-more";
      box.open = open;
      const summary = action(document.createElement("summary"), "npcs-more-toggle");
      summary.textContent = "More options";
      box.append(summary, ...controls);
      return box;
    };

    // The till: one number, or none (a till from 0).
    const gold = noAutofill(action(document.createElement("input"), "npcs-gold"));
    gold.type = "number";
    gold.min = "0";
    gold.step = "1";
    gold.placeholder = "0";
    gold.value = work.gold.length > 0 ? String(work.gold[0]) : "";
    gold.addEventListener("input", () => {
      const t = gold.value.trim();
      if (t === "") {
        invalid.delete(gold);
        work.gold = work.gold.slice(1);
      } else if (!/^\d+$/.test(t) || !Number.isSafeInteger(Number(t))) {
        invalid.set(gold, "Gold in its till: a whole number from 0");
      } else {
        invalid.delete(gold);
        work.gold = [Number(t), ...work.gold.slice(1)];
      }
      edited();
    });
    const goldBox = labelled(
      "Gold in its till",
      gold,
      work.gold.length > 1
        ? `This file has ${work.gold.length} till lines and only one is allowed: remove the others in the file as text.`
        : "The gold it has right now to pay players who sell to it. Saving sets it to this; empty means none.",
    );

    // Spells: the ticked ones in view, the rest folded under "Add a spell…".
    const spellTags = [
      ...(c?.spellTags ?? []),
      ...work.spells.filter(
        (x) => !(c?.spellTags ?? []).some((t) => t.toLowerCase() === x.toLowerCase()),
      ),
    ];
    const has = new Set(work.spells.map((x) => x.toLowerCase()));
    const spellBox = document.createElement("div");
    spellBox.className = "items-pick";
    spellBox.dataset.list = "spells";
    const spellsOn = document.createElement("div");
    spellsOn.className = "items-checks";
    const spellsRest = document.createElement("details");
    spellsRest.className = "items-more-picks";
    const spellsSummary = action(document.createElement("summary"), "npcs-spells-more");
    spellsSummary.textContent = "Add a spell…";
    const spellsOff = document.createElement("div");
    spellsOff.className = "items-checks";
    spellsRest.append(spellsSummary, spellsOff);
    for (const tag of spellTags) {
      const tick = check(has.has(tag.toLowerCase()), tag, "npcs-spell", (on) => {
        work.spells = on
          ? [...work.spells, tag]
          : work.spells.filter((x) => x.toLowerCase() !== tag.toLowerCase());
      });
      (has.has(tag.toLowerCase()) ? spellsOn : spellsOff).append(tick);
    }
    if (spellsOn.children.length === 0) {
      const none = document.createElement("p");
      none.className = "control-panel-field-help";
      none.textContent = "None.";
      spellsOn.append(none);
    }
    spellBox.append(spellsOn, spellsRest);

    // Flags: the two that do something as ticks; any other line kept under More options.
    const otherFlags = noAutofill(action(document.createElement("textarea"), "npcs-flags"));
    const others = work.flags.filter((f) => !isKnownFlag(f));
    otherFlags.rows = Math.max(2, Math.min(6, others.length + 1));
    otherFlags.value = others.join("\n");
    otherFlags.addEventListener("input", () => {
      const lines = otherFlags.value.split("\n").filter((l) => l !== "");
      const bad = lines.find((l) => !npcFieldOk(l));
      if (bad !== undefined) {
        invalid.set(otherFlags, `Other flag lines: "${bad}" cannot hold | : \` * ^`);
      } else {
        invalid.delete(otherFlags);
        work.flags = [...work.flags.filter(isKnownFlag), ...lines];
      }
      edited();
    });
    const flagTicks = FLAG_TEXT.map(([flag, label]) =>
      check(
        work.flags.some((f) => f.toLowerCase() === flag.toLowerCase()),
        label,
        `npcs-flag-${flag.toLowerCase()}`,
        (on) => {
          const rest = work.flags.filter((f) => f.toLowerCase() !== flag.toLowerCase());
          work.flags = on ? [...rest, flag] : rest;
        },
      ),
    );

    const loot = rows(
      "loot",
      "Drops",
      "drop",
      "When it dies, one of these lines is picked at random, then that item drops 1 in N times. Put a number before the item to drop a pile, as in 15 Gold.",
      () => work.loot,
      () => ({ item: "", oneIn: 1 }),
      (r, i) => {
        const odds = document.createElement("span");
        odds.className = "control-panel-field-help npcs-odds";
        odds.dataset.row = String(i);
        return [
          labelled(
            "Item",
            text(
              r.item,
              `Drop ${i + 1}: item`,
              (t) => {
                r.item = t;
              },
              itemsList.id,
            ),
          ),
          labelled(
            "Drops 1 in",
            num(r.oneIn, 1, `Drop ${i + 1}: 1 in`, (n) => {
              r.oneIn = n;
            }),
          ),
          odds,
        ];
      },
    );
    refreshOdds = () => {
      for (const s of loot.querySelectorAll<HTMLElement>(".npcs-odds")) {
        const r = work.loot[Number(s.dataset.row)];
        s.textContent = r ? lootOdds(work.loot.length, r.oneIn) : "";
      }
    };
    refreshOdds();

    const keptNote = intro(
      kept.length === 0
        ? ""
        : `This file also has lines the form doesn't show. They are kept as they are; to change them, switch View to the file as text: ${kept.map((k) => `line ${k.line} "${k.text}"`).join(", ")}.`,
    );
    keptNote.hidden = kept.length === 0;

    sectionsEl.replaceChildren(
      sec(
        "Talk",
        "What players read when they click it, and what it says out loud.",
        () => work.bio.length + work.profile.length + work.chatter.length > 0,
        linesArea(
          "bio",
          "Bio window: top lines",
          "The short lines at the top of its Bio window, one per line, as in Name: Amber.",
        ),
        linesArea(
          "profile",
          "Bio window: description",
          "The text in the larger box under them, one line per line.",
        ),
        linesArea(
          "chatter",
          "Things it says",
          "Now and then it says one of these out loud, picked at random. One per line.",
        ),
      ),
      sec(
        "Shop",
        "What it sells to players and buys from them. Prices are in gold.",
        () => work.sells.length + work.buys.length + work.gold.length > 0,
        rows(
          "sells",
          "Sells",
          "item to sell",
          "Each item it sells, its price, and how many it has right now. Saving sets its stock to these numbers.",
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
              "Price (gold)",
              num(r.price, 0, `Sells ${i + 1}: price`, (n) => {
                r.price = n;
              }),
            ),
            labelled(
              "In stock",
              num(r.stock, 0, `Sells ${i + 1}: stock`, (n) => {
                r.stock = n;
              }),
            ),
          ],
        ),
        rows(
          "buys",
          "Buys",
          "item to buy",
          "Each item players can sell to it, and what it pays.",
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
              "Pays (gold)",
              num(r.price, 0, `Buys ${i + 1}: price`, (n) => {
                r.price = n;
              }),
            ),
          ],
        ),
        goldBox,
      ),
      sec(
        "Bank and training",
        "Whether players can use their bank here, and the classes it can promote them to.",
        () => work.banker.length + work.trains.length > 0,
        check(
          work.banker.length > 0,
          "Runs a bank (talking to it opens the player's bank)",
          "npcs-banker",
          (on) => {
            work.banker = on ? (work.banker.length > 0 ? work.banker : [""]) : [];
          },
        ),
        rows(
          "trains",
          "Promotes players to",
          "class",
          "A class it can promote a player to, and what the promotion costs in gold.",
          () => work.trains,
          () => ({ cls: c?.classes[0] ?? "", price: 1000 }),
          (r, i) => [
            labelled(
              "Class",
              text(
                r.cls,
                `Promotion ${i + 1}: class`,
                (t) => {
                  r.cls = t;
                },
                "npcs-classes",
              ),
            ),
            labelled(
              "Price (gold)",
              num(r.price, 0, `Promotion ${i + 1}: price`, (n) => {
                r.price = n;
              }),
            ),
          ],
        ),
      ),
      asMonster(
        "As a monster",
        "For an NPC that is also a monster: what it drops when killed, the spells it casts, and how it moves and fights.",
        () => work.loot.length + work.spells.length + work.flags.length > 0,
        loot,
        labelled("Spells it casts", spellBox),
        labelled("How it behaves", flagTicksBox(flagTicks)),
        more(
          others.length > 0,
          labelled(
            "Other flag lines",
            otherFlags,
            "One per line. Only the two above do anything in play; anything else here is kept but ignored.",
          ),
        ),
      ),
    );
    sectionsEl.append(keptNote);
    const classes = document.createElement("datalist");
    classes.id = "npcs-classes";
    for (const k of c?.classes ?? []) {
      const o = document.createElement("option");
      o.value = k;
      classes.append(o);
    }
    sectionsEl.append(classes);
  };
  const flagTicksBox = (ticks: HTMLElement[]) => {
    const box = document.createElement("div");
    box.className = "items-checks";
    box.append(...ticks);
    return box;
  };
  /** Each tab's dot: whether the file has anything in it. */
  const markUsed = () => {
    for (const t of tabsUsed) {
      t.sec.dataset.used = String(t.used());
    }
  };

  /** Shows the open file in the mode chosen, from `base` and `work`. */
  const drawForm = () => {
    if (!shown) {
      return;
    }
    sectionsEl.hidden = mode !== "forms";
    textBox.hidden = mode !== "text";
    if (mode === "text") {
      tabsUsed = [];
    }
    if (mode === "forms") {
      const m = modelOf(npcText(base, work));
      const kept = m.lines
        .filter((l) => l.kind === null && l.text !== "")
        .map((l) => ({ line: l.line, text: l.text }));
      drawSections(m.mixed, kept);
      // The file as text is only offered when the form can't show all of it: the form covers
      // everything an NPC file does in play.
      modeBox.hidden = m.mixed.length === 0 && kept.length === 0;
    } else {
      modeBox.hidden = false;
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
        say(status, "Fix the fields marked in red first.", false);
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
          `Line ${m.mixed.join(", ")} is read two ways at once: fix it here in the text first.`,
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
    title.textContent = v.name;
    tags.replaceChildren(
      ...[
        ...(v.exists ? [] : ([["No file yet", "pending"]] as const)),
        ...(v.species ? ([["Also a monster", "original"]] as const) : []),
      ].map(([x, kind]) => {
        const s = document.createElement("span");
        s.className = `balance-tag items-tag-${kind}`;
        s.textContent = x;
        return s;
      }),
    );
    markUsed();
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
        ? `This can't be saved yet: ${r.error}`
        : r.warnings.length > 0
          ? r.warnings.join(" ")
          : "";
      checkBox.className = r.error ? "npcs-check balance-status-error" : "npcs-check";
    }
    const refused = t === null || npcCheck(t).error !== null;
    saveBtn.disabled = busy || refused || !(isDirty || !v.exists);
    saveBtn.textContent = v.exists ? "Save changes" : "Create its NPC file";
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
          n.file ? "" : "no file yet",
          n.shop ? "shop" : "",
          n.banker ? "bank" : "",
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
          : `${shown.name} has unsaved changes: save or undo them first.`,
        false,
      );
      return;
    }
    openName = name;
    shown = null;
    form.hidden = true;
    empty.hidden = false;
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
    empty.hidden = true;
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
      empty.hidden = false;
      tabsUsed = [];
      loading.hidden = false;
    },
    open(name) {
      openNpc(name);
    },
  };
}

export type { NpcModel };
