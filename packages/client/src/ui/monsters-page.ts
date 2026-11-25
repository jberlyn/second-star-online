/**
 * The Control Panel's Monsters page (issue #31): every species in a searchable list, and a form for
 * the one open, in plain words, one tab at a time: Basics, Picture, Behaviour, Fighting, Rewards,
 * Loot & spells and Editor lists. Saving writes the monster's species record
 * (`monsters/monsters/<name>`: its stats and flags) and its definition (`monsters/definitions/<name>`:
 * what the name-matched tables decide for it) into the content store's shared draft, published from
 * the Content page. An SSO page: 1.6 kept a monster's rules in its scripts and its NPC file.
 *
 * - One Save changes sends the rules and stats, then the name players see once the first is saved.
 * - A change carries the monster as the page showed it (`fingerprint`); the server refuses it if
 *   someone changed the monster since (here or in the Content page's JSON editor).
 * - Rarely used fields fold under "More options", which opens by itself when one of them is set; a
 *   tab that holds settings shows a dot (`data-used`).
 * - The Picture tab uses #29's body panel; removing a monster goes through the Content page's
 *   where-used report and removal form (#28).
 * - Its NPC file's loot, spells and flags (the Loot & spells tab) save at once, outside the draft,
 *   as the NPC Editor's saves do (stage 3), and only for a published monster.
 * - The Monster spells card edits the global monster spells (`casting.spells`) in the draft.
 *
 * Refreshes never touch a form being edited: its fields and fingerprint stay as they were filled.
 */
import type { MonsterSpellRule } from "@secondstaronline/data";
import type {
  ContentMonstersView,
  ContentMonsterView,
  ContentNpcFileView,
  ContentProblemView,
  ContentRowRef,
  MonsterListEntry,
} from "@secondstaronline/shared";

import { action, noAutofill } from "./action.ts";
import type { MonsterBodyPanel } from "./content-page.ts";
import {
  formActions,
  pageHeading,
  panelButton,
  sectionTabs,
  sourcesNote,
} from "./control-panel-kit.ts";
import { canonical, clean, rollBounds, rollFrom } from "./items-page.ts";

/** A Monsters page change as the page sends it. */
export interface MonsterChange {
  name: string;
  op: "set" | "revert" | "discard" | "rename" | "create";
  record?: unknown;
  data?: unknown;
  display?: string;
  copyFrom?: string;
  expect?: string;
}

/** A monster's NPC file sections as the page sends them. */
export interface NpcSectionsChange {
  loot: { item: string; oneIn: number }[];
  spells: string[];
  flags: string[];
}

export interface MonstersPageActions {
  /** Asks for the view, with the form of `name`. */
  view(seq: number, name?: string): void;
  /** Sends one change; the answer is a `contentMonsters` with `result`. */
  set(seq: number, change: MonsterChange): void;
  /** Saves the monster spells; the answer is a `contentMonsters` with `result`. */
  spells(seq: number, rows: MonsterSpellRule[], expect: string): void;
  /** Asks for a monster's NPC file sections. */
  npcFile(seq: number, name: string): void;
  /** Saves them (live); the answer is a `contentNpcFile` with `result`. */
  npcFileSet(seq: number, name: string, expect: string | null, sections: NpcSectionsChange): void;
  /** Opens the Content page, where the draft is published. */
  openContent(): void;
  /** Opens the Content page at a row (a monster's removal, a notice). */
  openContentRow(row: ContentRowRef): void;
  /** #29's body panel (null with no art). */
  body(saved: () => void): MonsterBodyPanel | null;
  /** Opens the monster's whole NPC file on the NPCs page (issue #32). */
  openNpc?(name: string): void;
  /** Whether the NPCs page may be opened (its permission). */
  canOpenNpc?(): boolean;
}

/** The answers the server sends the page. */
export type MonstersAnswer =
  | {
      t: "contentMonsters";
      seq: number;
      view: ContentMonstersView;
      result?: { ok: boolean; text: string; problems?: ContentProblemView[] };
    }
  | {
      t: "contentNpcFile";
      seq: number;
      view: ContentNpcFileView | null;
      error?: string;
      result?: { ok: boolean; text: string };
    };

export interface MonstersPage {
  readonly el: HTMLElement;
  onShow(): void;
  /** Unsaved changes: the form's, the NPC file's, the spells card's and the body panel's. */
  changes(): number;
  /** Puts the form back to what the server last showed. */
  discard(): void;
  receive(msg: MonstersAnswer): void;
  /** A publish or undo went live: ask again. */
  published(): void;
  /** A new session, or the permission went: drop everything. */
  reset(): void;
  /** Opens a monster's form. */
  open(name: string): void;
}

type Obj = Record<string, unknown>;

/** A yes/no setting: in the definition (`form`) or the species record's flags (`record`). */
type Flag = readonly ["form" | "record", string, string];

/** The Behaviour tab's everyday settings. */
const BEHAVIOUR_MAIN: readonly Flag[] = [
  ["form", "hostile", "Always attacks players (even when not on the World Editor's monster list)"],
  ["form", "officer", "Attacks wanted players, like a guard"],
  ["form", "sparesInnocent", "Leaves innocent players alone"],
  ["record", "immobile", "Never moves"],
  ["form", "sea", "Lives in water (appears and moves only on water)"],
  ["form", "neverCasts", "Never casts spells"],
];

/** The Behaviour tab's rarely used settings, under "More options". */
const BEHAVIOUR_MORE: readonly Flag[] = [
  ["form", "footprint", "Big: takes up 3×2 tiles"],
  ["form", "clearsBlock", "Others can walk through it"],
  ["form", "namesSelf", "Says its name when clicked"],
  ["record", "unclickable", "Clicking it does nothing"],
  ["form", "noQuests", "Never gives quests"],
  ["record", "trap", "A trap: holds a player standing on it and never attacks (needs Never moves)"],
  ["record", "dispellable", "Dispel Illusions destroys it"],
  ["record", "shieldsInnocent", "An innocent player standing on it can't be hit"],
  ["record", "hurtByHealing", "Healing spells hurt it"],
];

/** The editor lists a definition toggles. */
const LISTS: readonly (readonly [string, string])[] = [
  ["worldEditorMonsters", "World Editor: monster list (placed as a monster that attacks players)"],
  ["worldEditorNpcs", "World Editor: NPC list"],
  ["npcEditorMonsters", "NPC Editor: monster list"],
  ["npcEditorNpcs", "NPC Editor: NPC list (appears less often)"],
];

/** Where a monster spell lands, in words. */
const AIM_TEXT: Record<string, string> = {
  aimFirst: "Lands near the player",
  aimNoExit: "Lands near the player (even from a monster set to never cast)",
  dirAfterExits: "Flies out from the monster in a random direction",
  dirBeforeExits: "Flies out from the monster in a random direction (1.6's other roll order)",
  onPlayer: "Lands on the player",
  buff: "On the monster itself",
};

/** The NPC file flags the game reads, with what each does. */
const NPC_FLAGS: readonly (readonly [string, string])[] = [
  ["Passive", "Only fights once someone attacks it"],
  ["Still", "Stays in one place (never walks)"],
];

/** The record and definition keys each tab of the form holds ("Restore this tab"). */
const GROUP_KEYS: Record<string, { record: string[]; form: string[] }> = {
  basics: { record: ["hp", "attack", "defense", "spawnMinute"], form: [] },
  behaviour: {
    record: ["flags"],
    form: [...BEHAVIOUR_MAIN, ...BEHAVIOUR_MORE].filter(([w]) => w === "form").map(([, k]) => k),
  },
  combat: { record: [], form: ["affinities", "skillCap"] },
  xp: { record: ["xpMelee", "xpSpell", "skillXp"], form: ["killXp", "killBroadcast"] },
  lists: { record: [], form: ["lists"] },
};

/** The odds of one drop line: a uniform pick of a line, then 1 in N. */
export function dropOdds(lines: number, oneIn: number): string {
  if (lines < 1 || oneIn < 1) {
    return "";
  }
  const n = lines * oneIn;
  // Worded as the NPCs page words it.
  return n === 1 ? "Every kill" : `About 1 in ${n.toLocaleString("en")} kills`;
}

export function createMonstersPage(actions: MonstersPageActions): MonstersPage {
  const el = document.createElement("div");
  el.className = "monsters-page items-page balance-page plain-editor";
  el.append(
    pageHeading(
      "Monsters",
      "Pick a monster to change how tough it is, how it behaves and what it gives. Saving puts your changes in the draft: players get them once you publish on the Content page. Loot and spells save straight away.",
    ),
  );
  const draftLine = document.createElement("div");
  draftLine.className = "balance-draft";
  draftLine.hidden = true;
  const draftText = document.createElement("span");
  draftLine.append(
    draftText,
    panelButton("monsters-open-content", "Review and publish…", () => actions.openContent()),
  );

  let fieldIds = 0;
  const labelled = (label: string, control: HTMLElement, help = "") => {
    const wrap = document.createElement("div");
    wrap.className = "control-panel-field balance-field";
    const isGroup = control.tagName === "DIV";
    // A group of controls is named by a heading, not a label (a label names one control).
    const l = document.createElement(isGroup ? "span" : "label");
    l.className = "control-panel-field-label";
    fieldIds += 1;
    control.id ||= `monsters-field-${fieldIds}`;
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
  /** A help line under a tab's title: what the tab is for. */
  const intro = (text: string) => {
    const p = document.createElement("p");
    p.className = "items-intro";
    p.textContent = text;
    return p;
  };
  const statusLine = () => {
    const p = document.createElement("p");
    p.className = "balance-status";
    p.setAttribute("role", "status");
    return p;
  };
  const say = (p: HTMLElement, text: string, ok = true) => {
    p.textContent = text;
    p.className = ok ? "balance-status" : "balance-status balance-status-error";
  };
  /** A titled card holding a list of rows and its Add button. */
  const card = (id: string, label: string, help: string, rows: HTMLElement, add: HTMLElement) => {
    const box = document.createElement("div");
    box.className = "items-list-editor";
    box.dataset.card = id;
    const head = document.createElement("h4");
    head.className = "items-list-title";
    head.textContent = label;
    const h = document.createElement("p");
    h.className = "control-panel-field-help";
    h.textContent = help;
    add.classList.add("items-add");
    box.append(head, h, rows, add);
    return box;
  };

  // ---- a new monster ----
  const newBox = document.createElement("details");
  newBox.className = "items-new";
  const newSummary = action(document.createElement("summary"), "monsters-new-toggle");
  newSummary.textContent = "+ New monster";
  const newName = noAutofill(action(document.createElement("input"), "monsters-new-name"));
  newName.maxLength = 40;
  const newDisplay = noAutofill(action(document.createElement("input"), "monsters-new-display"));
  newDisplay.maxLength = 40;
  newDisplay.placeholder = "Same as the ID";
  const newFrom = noAutofill(action(document.createElement("input"), "monsters-new-copy"));
  newFrom.placeholder = "Start from scratch";
  const namesList = document.createElement("datalist");
  namesList.id = "monsters-names";
  newFrom.setAttribute("list", namesList.id);
  const itemsList = document.createElement("datalist");
  itemsList.id = "monsters-items";
  const newStatus = statusLine();
  const createBtn = panelButton(
    "monsters-create",
    "Create monster",
    () => {
      const name = newName.value.trim();
      if (name === "") {
        say(newStatus, "Give it an ID.", false);
        return;
      }
      seq += 1;
      saving.set(seq, { name, create: true });
      createBtn.disabled = true;
      say(newStatus, "Creating…");
      const from = newFrom.value.trim();
      actions.set(seq, {
        name,
        op: "create",
        ...(newDisplay.value.trim() ? { display: newDisplay.value.trim() } : {}),
        ...(from
          ? {
              copyFrom:
                list.find((m) => m.display.toLowerCase() === from.toLowerCase())?.name ?? from,
            }
          : {}),
      });
    },
    "primary",
  );
  newName.id = "monsters-new-name";
  newDisplay.id = "monsters-new-display";
  newFrom.id = "monsters-new-copy";
  newBox.append(
    newSummary,
    labelled(
      "Copy an existing monster (optional)",
      newFrom,
      "The easiest way to make a monster: start from a similar one (its stats, rules, picture, loot and spells), then change what you need.",
    ),
    labelled(
      "ID",
      newName,
      "Its permanent name inside the game: maps and NPC files use it, so it can't change later.",
    ),
    labelled("Name players see (optional)", newDisplay),
    namesList,
    itemsList,
    createBtn,
    newStatus,
  );

  // ---- the list ----
  const listBox = document.createElement("section");
  listBox.className = "items-list-box";
  const search = noAutofill(action(document.createElement("input"), "monsters-search"));
  search.type = "search";
  search.placeholder = "Search monsters";
  search.id = "monsters-search";
  const kindSel = action(document.createElement("select"), "monsters-filter");
  kindSel.id = "monsters-filter";
  for (const [v, t] of [
    ["all", "All monsters"],
    ["hostile", "Attack players"],
    ["sea", "Live in water"],
    ["casts", "Cast spells"],
    ["loot", "Drop loot"],
    ["npc", "NPCs"],
    ["changed", "Changed or added by you"],
  ]) {
    const o = document.createElement("option");
    o.value = v as string;
    o.textContent = t as string;
    kindSel.append(o);
  }
  const listEl = document.createElement("ul");
  listEl.className = "items-list";
  listEl.setAttribute("aria-label", "Monsters");
  const listCount = document.createElement("p");
  listCount.className = "control-panel-field-help";
  const filters = document.createElement("div");
  filters.className = "items-filters";
  filters.append(labelled("Search", search), labelled("Show", kindSel));
  listBox.append(newBox, filters, listCount, listEl);

  // ---- the form ----
  const form = document.createElement("section");
  form.className = "items-form";
  form.hidden = true;
  const header = document.createElement("div");
  header.className = "items-form-head";
  const title = document.createElement("h2");
  title.className = "content-section-title";
  const subtitle = document.createElement("p");
  subtitle.className = "control-panel-field-help items-form-id";
  const tags = document.createElement("div");
  tags.className = "balance-tags";
  header.append(title, subtitle, tags);
  const noticeLine = document.createElement("p");
  noticeLine.className = "balance-stale";
  noticeLine.hidden = true;
  const noticeText = document.createElement("span");
  noticeLine.append(
    noticeText,
    " ",
    panelButton("monsters-notice", "Review it on the Content page", () => {
      if (shown) {
        actions.openContentRow({ dataset: "monsters", part: "definitions", key: shown.name });
      }
    }),
  );
  const stale = document.createElement("p");
  stale.className = "balance-stale";
  stale.hidden = true;
  stale.textContent =
    "Someone changed this monster while you were editing it, so saving will be refused. Undo your changes to see theirs.";
  // The name players see: in the Basics tab, saved with the rest.
  const display = noAutofill(action(document.createElement("input"), "monsters-display"));
  display.maxLength = 40;
  display.id = "monsters-display";
  const displayField = labelled("Name players see", display);
  const displayHelp = document.createElement("p");
  displayHelp.className = "control-panel-field-help";
  displayField.append(displayHelp);
  const removeBtn = panelButton(
    "monsters-remove",
    "Remove this monster…",
    () => {
      if (shown) {
        actions.openContentRow({ dataset: "monsters", part: "monsters", key: shown.name });
      }
    },
    "danger",
  );
  const removeBox = document.createElement("div");
  removeBox.className = "items-remove";
  const removeHelp = document.createElement("p");
  removeHelp.className = "control-panel-field-help";
  removeHelp.textContent =
    "Opens the Content page, which shows where the monster is used (maps, NPC files) first.";
  removeBox.append(removeBtn, removeHelp);
  // The picture: a tab of its own, saved by the body panel's own buttons.
  const bodyBox = document.createElement("section");
  bodyBox.className = "balance-row";
  bodyBox.dataset.group = "picture";
  bodyBox.dataset.ownSave = "";
  bodyBox.hidden = true;
  const bodyTitle = document.createElement("h3");
  bodyTitle.className = "balance-row-title";
  bodyTitle.textContent = "Picture";
  const bodyHost = document.createElement("div");
  bodyHost.className = "items-pictures-host";
  bodyBox.append(
    bodyTitle,
    intro("How it looks walking and attacking. Picture changes have their own Save button."),
    bodyHost,
  );
  const rules = document.createElement("fieldset");
  rules.className = "items-rules";
  const groupsEl = document.createElement("div");
  rules.append(groupsEl);
  const status = statusLine();
  const saveBtn = panelButton("monsters-save", "Save changes", () => save(), "primary");
  const undoEditBtn = panelButton("monsters-undo-edit", "Undo changes", () => {
    fill();
    status.textContent = "";
    update();
  });
  const revertBtn = panelButton("monsters-revert", "Restore the original rules", () => {
    if (shown) {
      send({ name: shown.name, op: "revert", expect: shown.fingerprint });
    }
  });
  const dropBtn = panelButton("monsters-discard", "Cancel unpublished changes", () => {
    if (shown) {
      send({ name: shown.name, op: "discard", expect: shown.fingerprint });
    }
  });
  const mainButtons = document.createElement("div");
  mainButtons.className = "content-buttons";
  mainButtons.append(saveBtn, undoEditBtn);
  const resetButtons = document.createElement("div");
  resetButtons.className = "content-buttons items-reset-buttons";
  resetButtons.append(revertBtn, dropBtn);
  const buttons = document.createElement("div");
  buttons.className = "items-actions";
  buttons.append(mainButtons, resetButtons);

  // The NPC file: loot, spells and flags, saved live.
  const npcBox = document.createElement("section");
  npcBox.className = "balance-row monsters-npc";
  npcBox.dataset.group = "loot";
  // It saves on its own: the draft's Save bar steps aside while its tab shows.
  npcBox.dataset.ownSave = "";
  const npcTitle = document.createElement("h3");
  npcTitle.className = "balance-row-title";
  npcTitle.textContent = "Loot & spells";
  const npcHelp = intro(
    "What it drops and the spells it casts. These save straight away for everyone, without waiting for the draft to be published.",
  );
  const npcBody = document.createElement("fieldset");
  npcBody.className = "items-rules";
  const npcStatus = statusLine();
  const npcSaveBtn = panelButton(
    "monsters-npc-save",
    "Save loot & spells",
    () => {
      if (!npcShown || npcBusy) {
        return;
      }
      const bad = npcInvalid();
      if (bad) {
        say(npcStatus, bad, false);
        return;
      }
      npcBusy = true;
      seq += 1;
      npcSaving.set(seq, npcShown.name);
      say(npcStatus, "Saving…");
      updateNpc();
      // The revision the edit started from, never a newer one a refresh brought.
      actions.npcFileSet(seq, npcShown.name, npcRevision, structuredClone(npcWork));
    },
    "primary",
  );
  const npcUndoBtn = panelButton("monsters-npc-undo", "Undo changes", () => {
    fillNpc();
    npcStatus.textContent = "";
    updateNpc();
  });
  const npcButtons = document.createElement("div");
  npcButtons.className = "content-buttons";
  const npcWholeBtn = panelButton("monsters-npc-whole", "Open its whole NPC file", () => {
    if (shown) {
      actions.openNpc?.(shown.name);
    }
  });
  npcButtons.append(npcSaveBtn, npcUndoBtn);
  const npcFoot = document.createElement("div");
  npcFoot.className = "items-group-foot";
  npcFoot.append(npcButtons, npcWholeBtn);
  // The link has its own rule: it shows whenever the NPCs page may be opened, a file read two ways
  // included (that is where it is fixed).
  npcBox.append(npcTitle, npcHelp, npcBody, npcFoot, npcStatus);

  const tabs = sectionTabs(form, "monsters");
  form.append(header, noticeLine, stale, tabs.el, rules, formActions(buttons, status));

  // The monster spells card: every monster spell, shared by all monsters.
  const spellsBox = document.createElement("details");
  spellsBox.className = "balance-row monsters-spells";
  const spellsSummary = action(document.createElement("summary"), "monsters-spells-toggle");
  spellsSummary.textContent = "Monster spells (shared by every monster)";
  const spellsHelp = intro(
    "The spells monsters can cast. Give a monster a spell in its Loot & spells tab. Saved changes go in the draft.",
  );
  const spellsRows = document.createElement("div");
  const spellsStatus = statusLine();
  const spellsAdd = panelButton("monsters-spells-add", "+ Add a monster spell", () => {
    spellsWork.push({
      tag: "",
      name: choices?.fx[0] ?? "",
      kind: "aimFirst",
      power: 10,
      ladder: [90, 145, 200, 300, 500, 700, 1000],
      aName: true,
    });
    drawSpells();
    updateSpells();
  });
  spellsAdd.classList.add("items-add");
  const spellsSave = panelButton(
    "monsters-spells-save",
    "Save monster spells",
    () => {
      if (!spellsView || spellsBusy) {
        return;
      }
      if (spellsInvalid.size > 0) {
        say(spellsStatus, [...spellsInvalid.values()].join(". "), false);
        return;
      }
      spellsBusy = true;
      seq += 1;
      spellsSaving.add(seq);
      say(spellsStatus, "Saving…");
      updateSpells();
      actions.spells(seq, structuredClone(spellsWork), spellsFingerprint);
    },
    "primary",
  );
  const spellsUndo = panelButton("monsters-spells-undo", "Undo changes", () => {
    fillSpells();
    spellsStatus.textContent = "";
    updateSpells();
  });
  const spellsButtons = document.createElement("div");
  spellsButtons.className = "content-buttons";
  spellsButtons.append(spellsSave, spellsUndo);
  spellsBox.append(spellsSummary, spellsHelp, spellsRows, spellsAdd, spellsButtons, spellsStatus);

  const loading = document.createElement("p");
  loading.className = "balance-loading";
  loading.textContent = "Loading…";
  const layout = document.createElement("div");
  layout.className = "items-layout";
  const empty = document.createElement("p");
  empty.className = "items-empty-form";
  empty.textContent = "Pick a monster on the left to see and change how it plays.";
  layout.append(listBox, empty, form);
  el.append(draftLine, spellsBox, loading, layout);

  // ---- state ----
  let seq = 0;
  let resetSeq = -1;
  let appliedSeq = -1;
  const saving = new Map<number, { name: string; create?: boolean; op?: MonsterChange["op"] }>();
  let list: MonsterListEntry[] = [];
  let choices: ContentMonstersView["choices"] | null = null;
  let openName: string | null = null;
  let shown: ContentMonsterView | null = null;
  let work: { record: Obj; form: Obj } = { record: {}, form: {} };
  let filled = { value: "", fingerprint: "", display: "", nameFingerprint: "" };
  let busy = false;
  /** A name to save once the rules' save is answered (one Save sends both). */
  let renameNext: string | null = null;
  const invalid = new Map<HTMLElement, string>();
  let body: MonsterBodyPanel | null | undefined;
  // The NPC file.
  let npcShown: ContentNpcFileView | null = null;
  let npcWork: NpcSectionsChange = { loot: [], spells: [], flags: [] };
  let npcFilled = "";
  /** The file's revision the section was filled from: what a save names. */
  let npcRevision: string | null = null;
  /** Loot fields whose text does not read. */
  const npcErrors = new Map<HTMLElement, string>();
  let npcBusy = false;
  let npcAsked = -1;
  const npcSaving = new Map<number, string>();
  // The monster spells.
  let spellsView: ContentMonstersView["spells"] | null = null;
  let spellsWork: MonsterSpellRule[] = [];
  let spellsFilled = "";
  /** The spells' fingerprint the card was filled from: what a save names. */
  let spellsFingerprint = "";
  let spellsBusy = false;
  const spellsSaving = new Set<number>();
  const spellsInvalid = new Map<HTMLElement, string>();

  const forgetGone = (m: Map<HTMLElement, string>) => {
    for (const k of [...m.keys()]) {
      if (!k.isConnected) {
        m.delete(k);
      }
    }
  };
  const formValue = () => canonical({ record: work.record, form: work.form });
  const rulesDirty = () => shown !== null && (formValue() !== filled.value || invalid.size > 0);
  const nameDirty = () => shown !== null && display.value.trim() !== filled.display;
  const dirty = () => rulesDirty() || nameDirty();
  const npcDirty = () =>
    npcShown !== null && (canonical(npcWork) !== npcFilled || npcErrors.size > 0);
  const spellsDirty = () =>
    spellsView !== null && (canonical(spellsWork) !== spellsFilled || spellsInvalid.size > 0);

  const send = (change: MonsterChange) => {
    if (busy) {
      return false;
    }
    if ((change.display ?? "").length > 40) {
      say(status, "The name players see is at most 40 characters.", false);
      return false;
    }
    busy = true;
    say(status, "Saving…");
    update();
    seq += 1;
    saving.set(seq, { name: change.name, op: change.op });
    actions.set(seq, change);
    return true;
  };
  const renameChange = (expect: string): MonsterChange | null =>
    shown ? { name: shown.name, op: "rename", display: display.value.trim(), expect } : null;
  /** Saves the rules and stats, then the name (each only when changed). */
  const save = () => {
    if (!shown) {
      return;
    }
    if (rulesDirty()) {
      const name = nameDirty() ? display.value.trim() : null;
      if (name !== null && name.length > 40) {
        say(status, "The name players see is at most 40 characters.", false);
        return;
      }
      if (
        send({
          name: shown.name,
          op: "set",
          record: clean(work.record),
          data: clean(work.form),
          expect: filled.fingerprint,
        })
      ) {
        renameNext = name;
      }
    } else if (nameDirty()) {
      // The monster as the name was filled from: a rename someone made since is not overwritten.
      const change = renameChange(filled.nameFingerprint);
      if (change) {
        send(change);
      }
    }
  };
  const ask = () => {
    seq += 1;
    actions.view(seq, openName ?? undefined);
  };
  const askNpc = () => {
    if (!shown || !shown.published) {
      return;
    }
    seq += 1;
    npcAsked = seq;
    actions.npcFile(seq, shown.name);
  };

  // ---- controls ----
  const intInput = (
    value: unknown,
    min: number,
    max: number,
    nullable: boolean,
    label: string,
    write: (n: number | null) => void,
    edited: () => void,
    errors: Map<HTMLElement, string>,
    placeholder = "None",
  ) => {
    const input = noAutofill(action(document.createElement("input"), "monsters-number"));
    input.type = "number";
    input.min = String(min);
    input.max = String(max);
    input.step = "1";
    input.value = typeof value === "number" ? String(value) : "";
    if (nullable) {
      input.placeholder = placeholder;
    }
    input.addEventListener("input", () => {
      const t = input.value.trim();
      if (t === "" && nullable) {
        errors.delete(input);
        write(null);
      } else if (!/^-?\d+$/.test(t) || Number(t) < min || Number(t) > max) {
        errors.set(input, `${label}: a whole number from ${min} to ${max}`);
      } else {
        errors.delete(input);
        write(Number(t));
      }
      edited();
    });
    return input;
  };
  const check = (
    on: boolean,
    label: string,
    write: (on: boolean) => void,
    edited: () => void,
    id = "monsters-check",
  ) => {
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
  const textInput = (
    value: string,
    write: (t: string) => void,
    edited: () => void,
    list = "",
    placeholder = "",
  ) => {
    const t = noAutofill(action(document.createElement("input"), "monsters-text"));
    t.value = value;
    if (list) {
      t.setAttribute("list", list);
    }
    if (placeholder) {
      t.placeholder = placeholder;
    }
    t.addEventListener("input", () => {
      write(t.value);
      edited();
    });
    return t;
  };
  /**
   * Tick boxes for a list of values: the ticked ones in view, the rest folded under `more` (a wall
   * of thirty spells at once is hard to read).
   */
  const pickMany = (
    listId: string,
    values: readonly string[],
    has: Set<string>,
    more: string,
    write: (picked: string[]) => void,
    edited: () => void,
  ) => {
    const box = document.createElement("div");
    box.className = "items-pick";
    box.dataset.list = listId;
    const on = document.createElement("div");
    on.className = "items-checks";
    const rest = document.createElement("details");
    rest.className = "items-more-picks";
    const restSummary = action(document.createElement("summary"), `monsters-${listId}-more`);
    restSummary.textContent = more;
    const off = document.createElement("div");
    off.className = "items-checks";
    rest.append(restSummary, off);
    for (const v of [...values].sort((a, b) => a.localeCompare(b))) {
      const tick = check(
        has.has(v),
        v,
        (ticked) => {
          if (ticked) {
            has.add(v);
          } else {
            has.delete(v);
          }
          write(values.filter((x) => has.has(x)));
        },
        edited,
      );
      (has.has(v) ? on : off).append(tick);
    }
    if (on.children.length === 0) {
      const none = document.createElement("p");
      none.className = "control-panel-field-help";
      none.textContent = "None.";
      on.append(none);
    }
    box.append(on);
    if (off.children.length > 0) {
      box.append(rest);
    }
    return box;
  };
  const setKey = (o: Obj, k: string, v: unknown) => {
    if (v === undefined || v === null || v === false || v === "") {
      delete o[k];
    } else {
      o[k] = v;
    }
  };
  const flagsOf = (): Obj => {
    if (!work.record.flags || typeof work.record.flags !== "object") {
      work.record.flags = {};
    }
    return work.record.flags as Obj;
  };

  const drawGroups = (only?: string) => {
    const v = shown;
    if (!v || !choices) {
      groupsEl.replaceChildren();
      return;
    }
    const c = choices;
    const edited = () => {
      status.textContent = "";
      markUsed();
      update();
    };
    /** Fields folded under "More options", open when one of them has a value. */
    const more = (open: boolean, ...controls: HTMLElement[]) => {
      const box = document.createElement("details");
      box.className = "items-more";
      box.open = open;
      const summary = action(document.createElement("summary"), "monsters-more-toggle");
      summary.textContent = "More options";
      box.append(summary, ...controls);
      return box;
    };
    const group = (id: string, label: string, help: string, ...controls: HTMLElement[]) => {
      const sec = document.createElement("section");
      sec.className = "balance-row items-group";
      sec.dataset.group = id;
      const h = document.createElement("h3");
      h.className = "balance-row-title";
      h.textContent = label;
      sec.append(h, intro(help), ...controls);
      const foot = document.createElement("div");
      foot.className = "items-group-foot";
      const from = v.sources.filter((x) => x.group === id);
      if (from.length > 0) {
        foot.append(
          sourcesNote(
            v.defined
              ? "Where these settings come from: this monster's own rules"
              : "Where these settings come from",
            from.map((s) => `${s.label}: ${s.from}`),
          ),
        );
      } else {
        foot.append(document.createElement("span"));
      }
      if (v.pack) {
        const pack = v.pack;
        const restore = panelButton(
          `monsters-pack-${id}`,
          "Restore this tab to the original",
          () => {
            const keys = GROUP_KEYS[id] ?? { record: [], form: [] };
            for (const k of keys.form) {
              setKey(work.form, k, structuredClone((pack.form as Obj)[k]));
            }
            if (pack.record) {
              for (const k of keys.record) {
                const pv = (pack.record as Obj)[k];
                if (pv === undefined) {
                  delete work.record[k];
                } else {
                  work.record[k] = structuredClone(pv);
                }
              }
            }
            drawGroups(id);
            forgetGone(invalid);
            edited();
          },
        );
        restore.classList.add("items-restore");
        foot.append(restore);
      }
      sec.append(foot);
      return sec;
    };

    // ---- Basics ----
    // The two spawn minutes go together: both filled, or both empty (any time).
    const minute = (work.record.spawnMinute as { gt: number; lt: number } | null) ?? null;
    const pair: { gt: number | null; lt: number | null } = {
      gt: minute?.gt ?? null,
      lt: minute?.lt ?? null,
    };
    const spawnErrors = new Map<HTMLElement, string>();
    let spawnBoxes: HTMLInputElement[] = [];
    const writePair = () => {
      for (const b of spawnBoxes) {
        invalid.delete(b);
      }
      for (const [k, e] of spawnErrors) {
        invalid.set(k, e);
      }
      if (spawnErrors.size > 0) {
        return;
      }
      if (pair.gt === null && pair.lt === null) {
        work.record.spawnMinute = null;
      } else if (pair.gt === null || pair.lt === null) {
        invalid.set(
          spawnBoxes[0] as HTMLInputElement,
          "Only appears between minutes: fill both, or neither for any time",
        );
      } else {
        work.record.spawnMinute = { gt: pair.gt, lt: pair.lt };
      }
    };
    const spawnGt = intInput(
      minute?.gt,
      -1,
      60,
      true,
      "Only appears after minute",
      (n) => {
        pair.gt = n;
      },
      () => {
        writePair();
        edited();
      },
      spawnErrors,
      "Any",
    );
    const spawnLt = intInput(
      minute?.lt,
      0,
      61,
      true,
      "Only appears before minute",
      (n) => {
        pair.lt = n;
      },
      () => {
        writePair();
        edited();
      },
      spawnErrors,
      "Any",
    );
    spawnGt.setAttribute("aria-label", "Only appears after minute");
    spawnLt.setAttribute("aria-label", "Only appears before minute");
    spawnBoxes = [spawnGt, spawnLt];
    const spawnPair = document.createElement("div");
    spawnPair.className = "items-range-pair";
    spawnPair.append("after", spawnGt, "and before", spawnLt);
    const basics = group(
      "basics",
      "Basics",
      "Its name and how tough it is.",
      displayField,
      labelled(
        "Hit points",
        intInput(
          work.record.hp,
          1,
          1_000_000_000,
          false,
          "Hit points",
          (n) => {
            work.record.hp = n;
          },
          edited,
          invalid,
        ),
        "How much damage it takes to kill. A monster already out keeps its hit points until it appears again.",
      ),
      labelled(
        "Attack",
        intInput(
          work.record.attack,
          0,
          1_000_000_000,
          true,
          "Attack",
          (n) => {
            work.record.attack = n;
          },
          edited,
          invalid,
          "Never attacks",
        ),
        "How hard its melee hits are. Leave it empty for a monster that never attacks in melee.",
      ),
      labelled(
        "Defense",
        intInput(
          work.record.defense,
          0,
          1_000_000_000,
          false,
          "Defense",
          (n) => {
            work.record.defense = n;
          },
          edited,
          invalid,
        ),
        "Taken off every melee hit it takes.",
      ),
      more(
        minute !== null,
        labelled(
          "Only appears between minutes",
          spawnPair,
          "Minutes of each hour on the server clock: it appears only after the first and before the second (Classic's Zombies and Skeletons). Leave both empty for any time.",
        ),
      ),
      removeBox,
    );

    // ---- Behaviour ----
    const flags = flagsOf();
    const flagCheck = ([where, k, label]: Flag) =>
      where === "form"
        ? check(work.form[k] === true, label, (on) => setKey(work.form, k, on || undefined), edited)
        : check(flags[k] === true, label, (on) => setKey(flags, k, on || undefined), edited);
    const effectPicks = (key: "healedBy" | "resists", more: string) =>
      pickMany(
        key,
        c.effects,
        new Set((flags[key] as string[] | undefined) ?? []),
        more,
        (picked) => setKey(flags, key, picked.length > 0 ? picked : undefined),
        edited,
      );
    const moreBehaviour =
      BEHAVIOUR_MORE.some(([w, k]) => (w === "form" ? work.form[k] : flags[k]) === true) ||
      flags.grabbable !== undefined ||
      flags.healedBy !== undefined ||
      flags.resists !== undefined;
    const behaviour = group(
      "behaviour",
      "Behaviour",
      "How it acts around players. A monster on the World Editor's monster list (Editor lists tab) attacks players already.",
      ...BEHAVIOUR_MAIN.map(flagCheck),
      more(
        moreBehaviour,
        ...BEHAVIOUR_MORE.map(flagCheck),
        labelled(
          "Can be picked up as",
          textInput(
            String(flags.grabbable ?? ""),
            (t) => setKey(flags, "grabbable", t.trim() || undefined),
            edited,
            itemsList.id,
            "Can't be picked up",
          ),
          "Ctrl on it, or a click from the tile it faces, picks it up as this item (Classic's Pig).",
        ),
        labelled(
          "Healed by these spells",
          effectPicks("healedBy", "Add a spell…"),
          "These spells heal it instead of hurting it.",
        ),
        labelled(
          "Resists these spells",
          effectPicks("resists", "Add a spell…"),
          "These spells hit it for only 1 to 3 damage.",
        ),
      ),
    );

    // ---- Fighting ----
    const affRows = document.createElement("div");
    const affinities = (): Obj[] => {
      if (!Array.isArray(work.form.affinities)) {
        work.form.affinities = [];
      }
      return work.form.affinities as Obj[];
    };
    const drawAff = () => {
      const arr = (work.form.affinities as Obj[] | undefined) ?? [];
      affRows.replaceChildren(
        ...arr.map((row, i) => {
          const line = document.createElement("div");
          line.className = "items-list-row";
          line.dataset.list = "affinities";
          const name = `Weapon bonus ${arr.length > 1 ? `${i + 1}` : ""}`.trim();
          // The bonus typed as "from … to …" (`delta + random(n)`).
          const b = rollBounds(Number(row.delta ?? 0), Number(row.randomN ?? 0));
          const fromIn = noAutofill(
            action(document.createElement("input"), "monsters-affinity-from"),
          );
          const toIn = noAutofill(action(document.createElement("input"), "monsters-affinity-to"));
          for (const [input, n, word] of [
            [fromIn, b.from, "from"],
            [toIn, b.to, "to"],
          ] as const) {
            input.type = "number";
            input.step = "1";
            input.value = String(n);
            input.setAttribute("aria-label", `${name}: extra damage ${word}`);
          }
          const range = document.createElement("div");
          range.className = "items-range-pair";
          range.append(fromIn, " to ", toIn);
          const read = () => {
            const f = fromIn.value.trim();
            const t = toIn.value.trim();
            const err = `${name}: whole numbers, "to" no lower than "from"`;
            if (!/^-?\d+$/.test(f) || !/^-?\d+$/.test(t) || Number(t) < Number(f)) {
              invalid.set(range, err);
            } else {
              const r = rollFrom(Number(f), Number(t));
              if (Math.abs(r.flat) > 1_000_000 || r.randomN > 1_000_000) {
                invalid.set(range, `${name}: at most a million either way`);
              } else {
                invalid.delete(range);
                row.delta = r.flat;
                row.randomN = r.randomN;
              }
            }
            edited();
          };
          fromIn.addEventListener("input", read);
          toIn.addEventListener("input", read);
          line.append(
            labelled(
              "Weapon name contains",
              textInput(
                String(row.weapon ?? ""),
                (t) => {
                  row.weapon = t;
                },
                edited,
                "",
                "Silver",
              ),
            ),
            labelled("Extra damage", range),
            panelButton("monsters-affinity-remove", "Remove", () => {
              arr.splice(i, 1);
              if (arr.length === 0) {
                delete work.form.affinities;
              }
              drawAff();
              forgetGone(invalid);
              edited();
            }),
          );
          return line;
        }),
      );
    };
    drawAff();
    const combat = group(
      "combat",
      "Fighting",
      "Weapons that hurt it more (or less), and how far killing it trains a player's skills.",
      card(
        "affinities",
        "Weapon bonuses",
        "A melee weapon whose name contains these words (Silver, Sword of Hope) adds this much to each hit on it. Use negative numbers for less damage. Every matching row counts.",
        affRows,
        panelButton("monsters-affinity-add", "+ Add weapon bonus", () => {
          affinities().push({ weapon: "", delta: 1, randomN: 0 });
          drawAff();
          edited();
        }),
      ),
      labelled(
        "Skill training limit",
        intInput(
          work.form.skillCap,
          0,
          1_000_000,
          true,
          "Skill training limit",
          (n) => setKey(work.form, "skillCap", n ?? undefined),
          edited,
          invalid,
          "World default",
        ),
        "Killing it trains the weapon's skills only up to this level. Leave it empty for the world's default.",
      ),
    );

    // ---- Rewards ----
    const xp = group(
      "xp",
      "Rewards",
      "The XP a player gets for killing it, and an optional announcement.",
      labelled(
        "XP for a melee kill",
        intInput(
          work.record.xpMelee,
          0,
          1_000_000_000,
          false,
          "XP for a melee kill",
          (n) => {
            work.record.xpMelee = n;
          },
          edited,
          invalid,
        ),
      ),
      labelled(
        "XP for a spell kill",
        intInput(
          work.record.xpSpell,
          0,
          1_000_000_000,
          false,
          "XP for a spell kill",
          (n) => {
            work.record.xpSpell = n;
          },
          edited,
          invalid,
        ),
      ),
      labelled(
        "Announcement when killed",
        textInput(
          String(work.form.killBroadcast ?? ""),
          (t) => setKey(work.form, "killBroadcast", t.trim() || undefined),
          edited,
          "",
          "No announcement",
        ),
        "Shown to everyone online. {} becomes the killer's name: {} has slain the Dragon!",
      ),
      more(
        work.record.skillXp !== undefined || work.form.killXp !== undefined,
        labelled(
          "Skill XP per kill",
          intInput(
            work.record.skillXp,
            0,
            1_000_000_000,
            true,
            "Skill XP per kill",
            (n) => setKey(work.record, "skillXp", n ?? undefined),
            edited,
            invalid,
            "Each skill's own amount",
          ),
          "For skills that rise by XP: the XP a kill gives each skill the weapon trains.",
        ),
        labelled(
          "Fixed kill XP",
          intInput(
            work.form.killXp,
            0,
            1_000_000_000,
            true,
            "Fixed kill XP",
            (n) => setKey(work.form, "killXp", n ?? undefined),
            edited,
            invalid,
            "Not used",
          ),
          "Replaces the melee kill XP, after any XP ring bonus is counted.",
        ),
      ),
    );

    // ---- Editor lists ----
    const listsOf = (): Obj => {
      if (!work.form.lists || typeof work.form.lists !== "object") {
        work.form.lists = {};
      }
      return work.form.lists as Obj;
    };
    const lists = group(
      "lists",
      "Editor lists",
      "Which pick lists offer it when you place monsters on maps (World Editor) or in NPC files (NPC Editor).",
      ...LISTS.map(([k, label]) =>
        check(
          (work.form.lists as Obj | undefined)?.[k] === true,
          label,
          (on) => setKey(listsOf(), k, on || undefined),
          edited,
        ),
      ),
    );
    const sections = [basics, bodyBox, behaviour, combat, xp, npcBox, lists];
    const old = only
      ? [...groupsEl.children].find((e) => (e as HTMLElement).dataset.group === only)
      : undefined;
    const fresh = only ? sections.find((e) => e.dataset.group === only) : undefined;
    if (old && fresh) {
      old.replaceWith(fresh);
    } else {
      groupsEl.replaceChildren(...sections);
    }
    markUsed();
  };

  /** Whether the part of a tab's keys is set (its tab shows a dot). */
  const markUsed = () => {
    const pack = shown?.pack ?? null;
    for (const sec of groupsEl.querySelectorAll<HTMLElement>(":scope > .items-group")) {
      const keys = GROUP_KEYS[sec.dataset.group ?? ""] ?? { record: [], form: [] };
      const recordKeys = sec.dataset.group === "basics" ? [] : keys.record;
      // An empty list or object (`flags: {}`) is no setting.
      const set = (x: unknown) => !["null", "{}", "[]"].includes(canonical(x));
      const used =
        keys.form.some((k) => set(work.form[k])) || recordKeys.some((k) => set(work.record[k]));
      if (sec.dataset.used !== String(used)) {
        sec.dataset.used = String(used);
      }
      const restore = sec.querySelector<HTMLButtonElement>(
        ":scope > .items-group-foot > .items-restore",
      );
      if (restore) {
        const same =
          keys.form.every(
            (k) => canonical(work.form[k]) === canonical(pack ? (pack.form as Obj)[k] : undefined),
          ) &&
          (!pack?.record ||
            keys.record.every(
              (k) => canonical(work.record[k]) === canonical((pack.record as Obj)[k]),
            ));
        restore.hidden = same;
      }
    }
    npcBox.dataset.used = String(
      npcWork.loot.length > 0 || npcWork.spells.length > 0 || npcWork.flags.length > 0,
    );
  };

  const fillRules = () => {
    if (!shown) {
      return;
    }
    const { name: _n, display: _d, body: _b, bodyInMainChars: _m, ...rec } = shown.record;
    work = {
      record: structuredClone(rec) as Obj,
      form: structuredClone(shown.form) as Obj,
    };
    filled = { ...filled, value: formValue(), fingerprint: shown.fingerprint };
    invalid.clear();
    drawGroups();
  };
  const fillName = () => {
    if (!shown) {
      return;
    }
    display.value = shown.display;
    filled = { ...filled, display: shown.display, nameFingerprint: shown.fingerprint };
  };
  const fill = () => {
    fillRules();
    fillName();
  };

  const update = () => {
    const v = shown;
    if (!v) {
      return;
    }
    const shownName = v.display || v.name;
    title.textContent = shownName;
    subtitle.textContent = shownName === v.name ? "" : `ID: ${v.name}`;
    display.placeholder = v.name;
    displayHelp.textContent = `What players see. Leave it empty to show its ID, ${v.name}, which never changes.`;
    const t: [string, string][] = [];
    t.push(
      v.inPack
        ? v.defined || v.edited || v.pending.record !== null
          ? ["Changed by you", "changed"]
          : ["Original", "original"]
        : ["Added by you", "changed"],
    );
    if (!v.published) {
      t.push(["Not published yet", "pending"]);
    }
    if (v.pending.definition === "set" || v.pending.record !== null) {
      t.push(["Unpublished changes", "pending"]);
    } else if (v.pending.definition !== null) {
      t.push([
        v.inPack ? "Back to the original rules once published" : "Rules cleared once published",
        "pending",
      ]);
    }
    tags.replaceChildren(
      ...t.map(([x, kind]) => {
        const s = document.createElement("span");
        s.className = `balance-tag items-tag-${kind}`;
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
    revertBtn.textContent = v.inPack ? "Restore the original rules" : "Clear all its rules";
    revertBtn.title = v.inPack
      ? "Its Behaviour, Fighting, Rewards and Editor lists settings go back to the pack's once published. Its stats stay as they are."
      : "Leaves it with no rules of its own once published.";
    revertBtn.hidden = !(v.defined || v.edited) || v.pending.definition === "revert";
    revertBtn.disabled = busy;
    dropBtn.title =
      "Takes this monster's changes out of the draft: players keep what they have now.";
    dropBtn.hidden = v.pending.definition === null && v.pending.record === null;
    dropBtn.disabled = busy;
    removeBtn.disabled = busy;
    rules.disabled = busy;
    display.readOnly = busy;
    if (errs.length > 0) {
      say(status, errs.join(". "), false);
    }
  };
  display.addEventListener("input", () => update());

  // ---- the NPC file ----
  const npcInvalid = (): string | null => {
    if (npcErrors.size > 0) {
      return [...npcErrors.values()].join(". ");
    }
    for (const [i, l] of npcWork.loot.entries()) {
      if (l.item.trim() === "") {
        return `Drop ${i + 1}: pick an item.`;
      }
      if (!Number.isSafeInteger(l.oneIn) || l.oneIn < 1) {
        return `Drop ${i + 1}: the chance is a whole number from 1.`;
      }
    }
    if (npcWork.flags.some((f) => f.trim() === "")) {
      return "Other flag lines: a flag needs a name.";
    }
    return null;
  };
  const fillNpc = () => {
    if (!npcShown) {
      return;
    }
    npcWork = {
      loot: structuredClone(npcShown.loot),
      spells: [...npcShown.spells],
      flags: [...npcShown.flags],
    };
    npcFilled = canonical(npcWork);
    npcRevision = npcShown.revision;
    npcErrors.clear();
    drawNpc();
  };
  const drawNpc = () => {
    const v = npcShown;
    if (!shown) {
      npcBody.replaceChildren();
      return;
    }
    if (!shown.published) {
      const p = document.createElement("p");
      p.className = "control-panel-field-help";
      p.textContent =
        "This monster is new and not published yet: publish it first, then give it loot and spells here.";
      npcBody.replaceChildren(p);
      return;
    }
    if (!v) {
      npcBody.replaceChildren();
      return;
    }
    if (v.mixed.length > 0) {
      const p = document.createElement("p");
      p.className = "balance-stale";
      p.textContent = `Line ${v.mixed.join(", ")} of its NPC file can be read two ways (a drop line inside another line). Fix it on the NPCs page (Open its whole NPC file, then edit it as text) before changing loot and spells here.`;
      npcBody.replaceChildren(p);
      return;
    }
    const edited = () => {
      npcStatus.textContent = "";
      markUsed();
      updateNpc();
    };
    const info = document.createElement("p");
    info.className = "control-panel-field-help";
    info.textContent = v.exists
      ? `Its NPC file has ${v.lines} of at most ${v.maxLines} lines.`
      : "It has no NPC file yet: saving makes one.";
    // Loot.
    const lootRows = document.createElement("div");
    const drawLoot = () => {
      const n = npcWork.loot.length;
      lootRows.replaceChildren(
        ...npcWork.loot.map((l, i) => {
          const line = document.createElement("div");
          line.className = "items-list-row";
          line.dataset.list = "loot";
          const odds = document.createElement("span");
          odds.className = "control-panel-field-help balance-preview";
          odds.textContent = dropOdds(n, l.oneIn);
          line.append(
            labelled(
              "Item",
              textInput(
                l.item,
                (t) => {
                  l.item = t;
                },
                edited,
                itemsList.id,
                "15 Gold",
              ),
            ),
            labelled(
              "Drops 1 in",
              intInput(
                l.oneIn,
                1,
                Number.MAX_SAFE_INTEGER,
                false,
                `Drop ${i + 1}: chance`,
                (x) => {
                  l.oneIn = x ?? 1;
                  odds.textContent = dropOdds(npcWork.loot.length, l.oneIn);
                },
                edited,
                npcErrors,
              ),
            ),
            panelButton("monsters-loot-remove", "Remove", () => {
              npcWork.loot.splice(i, 1);
              drawLoot();
              edited();
            }),
            odds,
          );
          return line;
        }),
      );
    };
    drawLoot();
    // Spells: the monster spells, ticked; one the file names that no monster spell has stays,
    // shown so it can be taken off.
    const tags = new Map<string, string>();
    for (const t of v.spellTags) {
      tags.set(t.toLowerCase(), t);
    }
    const missing = npcWork.spells.filter((x) => !tags.has(x.toLowerCase()));
    const spellPicks = pickMany(
      "spells",
      v.spellTags,
      new Set(npcWork.spells.map((s) => tags.get(s.toLowerCase())).filter((s) => s !== undefined)),
      "Add a spell…",
      (picked) => {
        // Kept in the file's order; newly ticked ones go at the end.
        const was = npcWork.spells.filter((s) => {
          const tag = tags.get(s.toLowerCase());
          return tag === undefined ? missing.includes(s) : picked.includes(tag);
        });
        const fresh = picked.filter((p) => !was.some((s) => s.toLowerCase() === p.toLowerCase()));
        npcWork.spells = [...was, ...fresh];
      },
      edited,
    );
    for (const s of missing) {
      (spellPicks.querySelector(".items-checks") as HTMLElement).append(
        check(
          true,
          `${s} (no such monster spell)`,
          (on) => {
            if (!on) {
              npcWork.spells = npcWork.spells.filter((x) => x !== s);
              missing.splice(missing.indexOf(s), 1);
            }
          },
          edited,
        ),
      );
    }
    // Flags: the two the game reads as tick boxes, any others as text.
    const known = (f: string) =>
      NPC_FLAGS.some(([k]) => k.toLowerCase() === f.trim().toLowerCase());
    const others = () => npcWork.flags.filter((f) => !known(f));
    const flagChecks = NPC_FLAGS.map(([k, label]) =>
      check(
        npcWork.flags.some((f) => f.trim().toLowerCase() === k.toLowerCase()),
        label,
        (on) => {
          if (on) {
            npcWork.flags.push(k);
          } else {
            npcWork.flags = npcWork.flags.filter((f) => f.trim().toLowerCase() !== k.toLowerCase());
          }
        },
        edited,
        "monsters-npc-flag",
      ),
    );
    const flagsArea = noAutofill(action(document.createElement("textarea"), "monsters-npc-flags"));
    flagsArea.rows = 2;
    flagsArea.value = others().join("\n");
    flagsArea.addEventListener("input", () => {
      const typed = flagsArea.value.split("\n").filter((f) => f.trim() !== "");
      npcWork.flags = [...npcWork.flags.filter((f) => known(f)), ...typed];
      edited();
    });
    const flagsMore = document.createElement("details");
    flagsMore.className = "items-more";
    flagsMore.open = others().length > 0;
    const flagsSummary = action(document.createElement("summary"), "monsters-more-toggle");
    flagsSummary.textContent = "More options";
    flagsMore.append(
      flagsSummary,
      labelled(
        "Other flag lines",
        flagsArea,
        "One per line, kept in its NPC file for scripts and other tools. The game itself reads only the two above.",
      ),
    );
    npcBody.replaceChildren(
      info,
      card(
        "loot",
        "Drops",
        "When it dies, one of these lines is picked at random, then that item drops 1 in N times. Put a number before the item to drop a pile, as in 15 Gold.",
        lootRows,
        panelButton("monsters-loot-add", "+ Add drop", () => {
          npcWork.loot.push({ item: "", oneIn: 1 });
          drawLoot();
          edited();
        }),
      ),
      labelled(
        "Spells it casts",
        spellPicks,
        "From the Monster spells list at the top of the page.",
      ),
      ...flagChecks,
      flagsMore,
    );
  };
  const updateNpc = () => {
    npcSaveBtn.textContent =
      npcShown?.exists === false ? "Create its NPC file" : "Save loot & spells";
    npcWholeBtn.hidden =
      actions.openNpc === undefined ||
      actions.canOpenNpc?.() === false ||
      shown?.published !== true;
    const usable = shown?.published === true && npcShown !== null && npcShown.mixed.length === 0;
    npcButtons.hidden = !usable;
    // A monster with no file can attach an empty one.
    npcSaveBtn.disabled = npcBusy || !(npcDirty() || npcShown?.exists === false);
    npcUndoBtn.hidden = !npcDirty();
    npcBody.disabled = npcBusy;
    if (npcDirty() && npcShown && npcShown.revision !== npcRevision && !npcBusy) {
      say(
        npcStatus,
        "Someone changed this monster's loot or spells while you were editing them, so saving will be refused. Undo your changes to see theirs.",
        false,
      );
    }
  };

  // ---- the monster spells ----
  const fillSpells = () => {
    if (!spellsView) {
      return;
    }
    spellsWork = structuredClone(spellsView.rows);
    spellsFilled = canonical(spellsWork);
    spellsFingerprint = spellsView.fingerprint;
    spellsInvalid.clear();
    drawSpells();
  };
  const drawSpells = () => {
    const c = choices;
    if (!c) {
      spellsRows.replaceChildren();
      return;
    }
    const edited = () => {
      spellsStatus.textContent = "";
      updateSpells();
    };
    spellsRows.replaceChildren(
      ...spellsWork.map((s, i) => {
        const line = document.createElement("div");
        line.className = "items-list-editor";
        line.dataset.list = "monster-spells";
        const head = document.createElement("h4");
        head.className = "items-list-title";
        head.textContent = s.tag || `New spell ${i + 1}`;
        const kind = action(document.createElement("select"), "monsters-spell-kind");
        for (const k of c.kinds) {
          const o = document.createElement("option");
          o.value = k;
          o.textContent = AIM_TEXT[k] ?? k;
          kind.append(o);
        }
        kind.value = s.kind;
        kind.addEventListener("change", () => {
          s.kind = kind.value as MonsterSpellRule["kind"];
          edited();
        });
        const fx = action(document.createElement("select"), "monsters-spell-fx");
        for (const f of new Set([...c.fx, s.name])) {
          const o = document.createElement("option");
          o.value = f;
          o.textContent = f;
          fx.append(o);
        }
        fx.value = s.name;
        fx.addEventListener("change", () => {
          s.name = fx.value;
          edited();
        });
        const ladder = document.createElement("div");
        ladder.className = "monsters-ladder";
        s.ladder.forEach((n, j) => {
          const players = j < 6 ? `${j + 1}` : "7+";
          const step = intInput(
            n,
            1,
            1_000_000,
            false,
            `${s.tag || `Spell ${i + 1}`}: how often with ${players} ${j === 0 ? "player" : "players"}`,
            (x) => {
              s.ladder[j] = x ?? 1;
            },
            edited,
            spellsInvalid,
          );
          step.setAttribute(
            "aria-label",
            `1 in, with ${players} ${j === 0 ? "player" : "players"}`,
          );
          const cell = document.createElement("label");
          cell.className = "monsters-ladder-step";
          const word = document.createElement("span");
          word.textContent = `${players} ${j === 0 ? "player" : "players"}`;
          cell.append(word, step);
          ladder.append(cell);
        });
        const tag = textInput(
          s.tag,
          (t) => {
            s.tag = t.trim();
            head.textContent = s.tag || `New spell ${i + 1}`;
          },
          edited,
        );
        // A saved spell's tag is what NPC files name: it stays as it is.
        tag.readOnly = (spellsView?.rows ?? []).some((r) => r.tag !== "" && r.tag === s.tag);
        const row = document.createElement("div");
        row.className = "items-list-row";
        row.append(
          labelled("ID", tag, tag.readOnly ? "Can't change once saved." : "Can't change later."),
          labelled("Spell", fx),
          labelled("Where it lands", kind),
          labelled(
            "Power",
            intInput(
              s.power,
              0,
              1_000_000,
              false,
              `${s.tag || `Spell ${i + 1}`}: power`,
              (x) => {
                s.power = x ?? 0;
              },
              edited,
              spellsInvalid,
            ),
          ),
        );
        line.append(
          head,
          row,
          labelled(
            "How often it casts: 1 in …",
            ladder,
            "Each turn a monster may cast it, by how many players are on the map. Bigger numbers mean less often.",
          ),
          check(
            s.aName,
            'Messages call the caster "a" monster ("a Orc")',
            (on) => {
              s.aName = on;
            },
            edited,
          ),
          panelButton("monsters-spell-remove", "Remove this spell", () => {
            spellsWork.splice(i, 1);
            drawSpells();
            forgetGone(spellsInvalid);
            edited();
          }),
        );
        return line;
      }),
    );
  };
  const updateSpells = () => {
    spellsSave.disabled = spellsBusy || !spellsDirty();
    spellsUndo.hidden = !spellsDirty();
    spellsAdd.disabled = spellsBusy;
    if (
      spellsDirty() &&
      spellsView &&
      spellsView.fingerprint !== spellsFingerprint &&
      !spellsBusy
    ) {
      say(
        spellsStatus,
        "Someone changed the monster spells while you were editing them, so saving will be refused. Undo your changes to see theirs.",
        false,
      );
    }
  };

  const drawList = () => {
    const words = search.value
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w !== "");
    const kind = kindSel.value;
    const rows = list.filter((m) => {
      const text = `${m.display} ${m.name}`.toLowerCase();
      if (!words.every((w) => text.includes(w))) {
        return false;
      }
      switch (kind) {
        case "hostile":
          return m.hostile;
        case "sea":
          return m.sea;
        case "casts":
          return m.casts;
        case "loot":
          return m.loot;
        case "npc":
          return m.npc;
        case "changed":
          return m.state !== "pack" || m.pending;
        default:
          return true;
      }
    });
    listCount.textContent =
      rows.length === list.length
        ? `${list.length} monsters`
        : `${rows.length} of ${list.length} monsters`;
    listEl.replaceChildren(
      ...rows.map((m) => {
        const li = document.createElement("li");
        const b = action(document.createElement("button"), "monsters-open");
        b.type = "button";
        b.className = "items-list-item";
        b.dataset.monster = m.name;
        if (openName && m.name.toLowerCase() === openName.toLowerCase()) {
          b.setAttribute("aria-current", "true");
        }
        const name = document.createElement("span");
        name.className = "items-list-name";
        name.textContent = m.display || m.name;
        const meta = document.createElement("span");
        meta.className = "items-list-meta";
        meta.textContent = [
          m.hostile ? "attacks" : "",
          m.npc ? "NPC" : "",
          m.sea ? "water" : "",
          m.state === "yours" ? "added by you" : m.state === "edited" ? "changed" : "",
          m.pending ? "unpublished" : "",
        ]
          .filter((x) => x !== "")
          .join(" · ");
        b.append(name, " ", meta);
        if (m.display && m.display !== m.name) {
          b.title = `ID: ${m.name}`;
        }
        b.addEventListener("click", () => openMonster(m.name));
        li.append(b);
        return li;
      }),
    );
  };
  search.addEventListener("input", drawList);
  kindSel.addEventListener("change", drawList);

  const showBody = (name: string, force = false) => {
    if (body === undefined) {
      body = actions.body(() => {
        if (el.isConnected) {
          ask();
        }
      });
      if (body) {
        bodyHost.append(body.el);
        bodyBox.hidden = false;
      }
    }
    body?.show(name, force);
  };

  const openMonster = (name: string) => {
    if (shown && (dirty() || busy || npcDirty() || npcBusy || body?.pending())) {
      say(
        status,
        busy || npcBusy
          ? "Wait for the save to finish."
          : `${shown.display || shown.name} has unsaved changes: save them or undo them first.`,
        false,
      );
      return;
    }
    openName = name;
    shown = null;
    npcShown = null;
    form.hidden = true;
    status.textContent = "";
    npcStatus.textContent = "";
    drawList();
    ask();
  };

  const show = (view: ContentMonstersView) => {
    loading.hidden = true;
    list = view.monsters;
    choices = view.choices;
    namesList.replaceChildren(
      ...list.map((m) => {
        const o = document.createElement("option");
        o.value = m.display;
        return o;
      }),
    );
    if (itemsList.childElementCount !== view.choices.items.length) {
      itemsList.replaceChildren(
        ...view.choices.items.map((i) => {
          const o = document.createElement("option");
          o.value = i;
          return o;
        }),
      );
    }
    drawList();
    const total = view.monsterDraft + view.otherDraft;
    draftLine.hidden = total === 0;
    draftText.textContent =
      total === 0
        ? ""
        : `${total === 1 ? "1 unpublished change" : `${total} unpublished changes`}${view.otherDraft > 0 && view.monsterDraft > 0 ? ` (${view.monsterDraft} to monsters)` : view.monsterDraft === 0 ? " (none to monsters)" : ""}. Players get them once you publish. `;
    // The spells card refreshes unless it holds an edit.
    const firstSpells = spellsView === null;
    spellsView = view.spells;
    if (firstSpells || (!spellsDirty() && !spellsBusy)) {
      fillSpells();
    }
    updateSpells();
    const m = view.monster;
    empty.hidden = openName !== null && shown !== null;
    if (!openName) {
      return;
    }
    if (!m || m.name.toLowerCase() !== openName.toLowerCase()) {
      const open = openName.toLowerCase();
      if (shown && !view.monsters.some((x) => x.name.toLowerCase() === open)) {
        shown = null;
        npcShown = null;
        form.hidden = true;
        empty.hidden = false;
        openName = null;
        body?.clear();
      }
      return;
    }
    const first = shown === null || shown.name !== m.name;
    const wasPublished = shown?.published;
    shown = m;
    form.hidden = false;
    empty.hidden = true;
    if (first) {
      fill();
      showBody(m.name);
      askNpc();
    } else if (!busy) {
      if (!rulesDirty()) {
        fillRules();
      } else {
        const { name: _n, display: _d, body: _b, bodyInMainChars: _m, ...rec } = m.record;
        if (canonical({ record: rec, form: m.form }) === filled.value) {
          filled = { ...filled, fingerprint: m.fingerprint };
        }
      }
      if (!nameDirty()) {
        fillName();
      }
      showBody(m.name);
      // Published since: its NPC file can be edited now; or the file may have changed.
      if (!npcDirty() && !npcBusy && (wasPublished !== m.published || m.published)) {
        askNpc();
      }
    }
    // The NPC section redraws when it is filled or the monster's state changes, never under typing.
    if (first || wasPublished !== m.published) {
      drawNpc();
    }
    updateNpc();
    update();
  };

  return {
    el,
    onShow: ask,
    changes: () =>
      (dirty() && !busy ? 1 : 0) +
      (npcDirty() && !npcBusy ? 1 : 0) +
      (spellsDirty() && !spellsBusy ? 1 : 0) +
      (body?.pending() ? 1 : 0),
    discard() {
      if (!busy) {
        fill();
        if (shown) {
          body?.show(shown.name, true);
        }
        status.textContent = "";
        update();
      }
      if (!npcBusy) {
        fillNpc();
        updateNpc();
      }
      if (!spellsBusy) {
        fillSpells();
        updateSpells();
      }
    },
    receive(msg) {
      if (msg.seq <= resetSeq) {
        return;
      }
      if (msg.t === "contentNpcFile") {
        const savedFor = npcSaving.get(msg.seq);
        if (savedFor !== undefined) {
          npcSaving.delete(msg.seq);
          npcBusy = false;
          if (msg.result) {
            say(npcStatus, msg.result.text, msg.result.ok);
          }
          if (shown && savedFor.toLowerCase() === shown.name.toLowerCase() && msg.view) {
            npcShown = msg.view;
            if (msg.result?.ok) {
              fillNpc();
            }
          }
        } else if (
          msg.seq === npcAsked &&
          shown &&
          msg.view &&
          msg.view.name.toLowerCase() === shown.name.toLowerCase()
        ) {
          // A file shown for the first time fills the section; a refresh keeps an edit.
          const first = npcShown === null;
          const keep = !first && npcDirty();
          npcShown = msg.view;
          if (!keep) {
            fillNpc();
          }
          markUsed();
          updateNpc();
          return;
        }
        drawNpc();
        markUsed();
        updateNpc();
        return;
      }
      const newer = msg.seq >= appliedSeq;
      if (spellsSaving.has(msg.seq)) {
        spellsSaving.delete(msg.seq);
        spellsBusy = false;
        if (msg.result) {
          say(
            spellsStatus,
            [
              msg.result.text,
              ...(msg.result.problems ?? []).map((p) => `${p.where}: ${p.message}`),
            ].join(" "),
            msg.result.ok,
          );
          if (msg.result.ok) {
            spellsView = msg.view.spells;
            fillSpells();
          }
        }
        if (newer) {
          appliedSeq = msg.seq;
          show(msg.view);
        }
        updateSpells();
        return;
      }
      const save = saving.get(msg.seq);
      if (save !== undefined) {
        saving.delete(msg.seq);
        if (save.create) {
          createBtn.disabled = false;
          say(
            newStatus,
            [
              msg.result?.text ?? "",
              ...(msg.result?.problems ?? []).map((p) => `${p.where}: ${p.message}`),
            ].join(" "),
            msg.result?.ok ?? false,
          );
          if (
            msg.result?.ok &&
            !(shown && (dirty() || busy || npcDirty() || npcBusy || body?.pending()))
          ) {
            newName.value = "";
            newDisplay.value = "";
            newFrom.value = "";
            newBox.open = false;
            // The answer's view carries the new monster's form: it opens from it.
            openName = save.name;
            shown = null;
            npcShown = null;
          }
        } else if (openName && save.name.toLowerCase() === openName.toLowerCase()) {
          busy = false;
          const next = renameNext;
          renameNext = null;
          if (msg.result) {
            if (msg.result.ok && newer && msg.view.monster) {
              // Saved: the part saved shows what the draft now holds; an unsaved edit in the
              // other part stays (a rename keeps rule edits, a rules save keeps a typed name).
              shown = msg.view.monster;
              if (save.op === "rename") {
                fillName();
              } else if (save.op === "discard") {
                fill();
              } else {
                fillRules();
              }
            }
            say(
              status,
              msg.result.ok
                ? msg.result.text
                : [
                    msg.result.text,
                    ...(msg.result.problems ?? []).map((p) => `${p.where}: ${p.message}`),
                  ].join(" "),
              msg.result.ok,
            );
          }
          if (newer) {
            appliedSeq = msg.seq;
            show(msg.view);
          } else {
            update();
          }
          // The rules are saved: the name the same Save carried goes next.
          if (msg.result?.ok && save.op === "set" && next !== null && nameDirty() && shown) {
            const change = renameChange(shown.fingerprint);
            if (change) {
              send(change);
            }
          }
          return;
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
      npcSaving.clear();
      spellsSaving.clear();
      list = [];
      choices = null;
      openName = null;
      shown = null;
      work = { record: {}, form: {} };
      filled = { value: "", fingerprint: "", display: "", nameFingerprint: "" };
      busy = false;
      renameNext = null;
      invalid.clear();
      npcShown = null;
      npcWork = { loot: [], spells: [], flags: [] };
      npcFilled = "";
      npcBusy = false;
      spellsView = null;
      spellsWork = [];
      spellsFilled = "";
      spellsBusy = false;
      spellsInvalid.clear();
      body?.clear();
      search.value = "";
      kindSel.value = "all";
      newName.value = "";
      newDisplay.value = "";
      newFrom.value = "";
      newStatus.textContent = "";
      createBtn.disabled = false;
      status.textContent = "";
      npcStatus.textContent = "";
      spellsStatus.textContent = "";
      listEl.replaceChildren();
      groupsEl.replaceChildren();
      npcBody.replaceChildren();
      spellsRows.replaceChildren();
      form.hidden = true;
      empty.hidden = false;
      loading.hidden = false;
      draftLine.hidden = true;
    },
    open(name) {
      openMonster(name);
    },
  };
}
