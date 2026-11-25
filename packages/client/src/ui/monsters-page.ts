/**
 * The Control Panel's Monsters page (issue #31): every species in a searchable list, and a form for
 * the one open, showing what it plays now and where each rule comes from. Saving writes the
 * monster's species record (`monsters/monsters/<name>`: its stats and flags) and its definition
 * (`monsters/definitions/<name>`: what the name-matched tables decide for it) into the content
 * store's shared draft, published from the Content page. An SSO page: 1.6 kept a monster's rules in
 * its scripts and its NPC file.
 *
 * - A change carries the monster as the page showed it (`fingerprint`); the server refuses it if
 *   someone changed the monster since (here or in the Content page's JSON editor).
 * - The body uses #29's body panel; removing a monster goes through the Content page's where-used
 *   report and removal form (#28).
 * - Its NPC file's loot, spells and flags save at once, outside the draft, as the NPC Editor's
 *   saves do (stage 3), and only for a published monster.
 * - The Monster spells card edits the global monster spells (`casting.spells`) in the draft.
 *
 * Refreshes never touch a form being edited: its fields and fingerprint stay as they were filled.
 */
import type { MonsterDefinition, MonsterSpellRule } from "@secondstaronline/data";
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
import { pageHeading, panelButton } from "./control-panel-kit.ts";
import { canonical, clean, rollRange } from "./items-page.ts";

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

/** The definition's yes/no fields, with what each means. */
const DEF_FLAGS: readonly (readonly [keyof MonsterDefinition, string])[] = [
  ["hostile", "Hostile though off the World Editor's monster list"],
  ["officer", "Attacks wanted players"],
  ["sparesInnocent", "Never attacks an innocent player"],
  ["sea", "A sea creature (spawns and moves on water)"],
  ["footprint", "3×2 wide"],
  ["clearsBlock", "Clears its block when it moves"],
  ["namesSelf", "A click on it says its name"],
  ["noQuests", "Never gives quests"],
  ["neverCasts", "Never casts monster spells"],
];

/** The species record's yes/no flags. */
const RECORD_FLAGS: readonly (readonly [string, string])[] = [
  ["immobile", "Immobile (never walks)"],
  ["unclickable", "A click on it does nothing"],
  ["trap", "A trap: holds a player standing on it, never attacks (must be immobile)"],
  ["dispellable", "Dispel Illusions destroys it"],
  ["shieldsInnocent", "An innocent player standing on it cannot be hit"],
  ["hurtByHealing", "Minor and Major Heal hurt it"],
];

/** The editor lists a definition toggles. */
const LISTS: readonly (readonly [string, string])[] = [
  ["worldEditorMonsters", "World Editor: monsters (placed as a monster; hostile)"],
  ["worldEditorNpcs", "World Editor: NPCs"],
  ["npcEditorMonsters", "NPC Editor: monsters"],
  ["npcEditorNpcs", "NPC Editor: NPCs (a rarer spawn)"],
];

/** The record and definition keys each group of the form holds ("use the pack's rules here"). */
const GROUP_KEYS: Record<string, { record: string[]; form: string[] }> = {
  stats: { record: ["hp", "attack", "defense", "spawnMinute"], form: [] },
  behaviour: {
    record: ["flags"],
    form: DEF_FLAGS.map(([k]) => k as string),
  },
  combat: { record: [], form: ["affinities", "skillCap"] },
  xp: { record: ["xpMelee", "xpSpell", "skillXp"], form: ["killXp", "killBroadcast"] },
  lists: { record: [], form: ["lists"] },
};

const GROUP_TITLES: Record<string, string> = {
  stats: "Stats",
  behaviour: "Behaviour",
  combat: "Combat",
  xp: "XP",
  lists: "Lists",
};

/** The odds of one drop line: a uniform pick of a line, then 1 in N. */
export function dropOdds(lines: number, oneIn: number): string {
  if (lines < 1 || oneIn < 1) {
    return "";
  }
  const n = lines * oneIn;
  return `1 in ${n.toLocaleString("en")} a kill`;
}

export function createMonstersPage(actions: MonstersPageActions): MonstersPage {
  const el = document.createElement("div");
  el.className = "monsters-page items-page balance-page";
  el.append(
    pageHeading(
      "Monsters",
      "Every monster's stats and rules in one form: hit points, attack, behaviour, weapon affinities, XP and the editor lists. Saving gives the monster a definition of its own, which plays instead of the pack's rows that match it. Stats and rules go into the content draft, published from the Content page; a monster's loot, spells and NPC flags live in its NPC file and save at once.",
    ),
  );
  const draftLine = document.createElement("div");
  draftLine.className = "balance-draft";
  draftLine.hidden = true;
  const draftText = document.createElement("span");
  draftLine.append(
    draftText,
    panelButton("monsters-open-content", "Review and publish on the Content page", () =>
      actions.openContent(),
    ),
  );

  let fieldIds = 0;
  const labelled = (label: string, control: HTMLElement, help = "") => {
    const wrap = document.createElement("div");
    wrap.className = "control-panel-field balance-field";
    const l = document.createElement("label");
    l.className = "control-panel-field-label";
    fieldIds += 1;
    control.id ||= `monsters-field-${fieldIds}`;
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

  // ---- a new monster ----
  const newBox = document.createElement("details");
  newBox.className = "items-new";
  const newSummary = action(document.createElement("summary"), "monsters-new-toggle");
  newSummary.textContent = "New monster";
  const newName = noAutofill(action(document.createElement("input"), "monsters-new-name"));
  newName.maxLength = 40;
  const newDisplay = noAutofill(action(document.createElement("input"), "monsters-new-display"));
  newDisplay.maxLength = 40;
  const newFrom = noAutofill(action(document.createElement("input"), "monsters-new-copy"));
  const namesList = document.createElement("datalist");
  namesList.id = "monsters-names";
  newFrom.setAttribute("list", namesList.id);
  const itemsList = document.createElement("datalist");
  itemsList.id = "monsters-items";
  const newStatus = statusLine();
  const createBtn = panelButton(
    "monsters-create",
    "Make it in the draft",
    () => {
      const name = newName.value.trim();
      if (name === "") {
        say(newStatus, "Give it a name.", false);
        return;
      }
      seq += 1;
      saving.set(seq, { name, create: true });
      createBtn.disabled = true;
      say(newStatus, "Saving…");
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
      "Name",
      newName,
      "Its permanent key: maps' rosters and NPC files name it by this, so it never changes. Rename it later by its display name.",
    ),
    labelled("Display name", newDisplay, "What players see. Leave it empty to show the name."),
    labelled(
      "Copy",
      newFrom,
      "Optional: a monster it starts as, with its stats, rules, body and NPC file (loot, spells, flags). Change what you like after.",
    ),
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
  search.placeholder = "Find a monster";
  search.id = "monsters-search";
  const kindSel = action(document.createElement("select"), "monsters-filter");
  kindSel.id = "monsters-filter";
  for (const [v, t] of [
    ["all", "Every monster"],
    ["hostile", "Hostile"],
    ["sea", "Sea creatures"],
    ["casts", "Casts spells"],
    ["loot", "Has loot"],
    ["npc", "NPCs"],
    ["changed", "Changed or yours"],
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
  listBox.append(labelled("Find", search), labelled("Show", kindSel), listCount, listEl);

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
    panelButton("monsters-notice", "Answer it on the Content page", () => {
      if (shown) {
        actions.openContentRow({ dataset: "monsters", part: "definitions", key: shown.name });
      }
    }),
  );
  const stale = document.createElement("p");
  stale.className = "balance-stale";
  stale.hidden = true;
  stale.textContent =
    "Someone changed this monster since you started editing it: saving will be refused. Drop your edit to see theirs.";
  // Identity: the display name and the body.
  const identity = document.createElement("section");
  identity.className = "balance-row";
  const identityTitle = document.createElement("h3");
  identityTitle.className = "balance-row-title";
  identityTitle.textContent = "Name and body";
  const display = noAutofill(action(document.createElement("input"), "monsters-display"));
  display.maxLength = 40;
  display.id = "monsters-display";
  const renameBtn = panelButton("monsters-rename", "Rename in the draft", () => {
    if (shown) {
      send({
        name: shown.name,
        op: "rename",
        display: display.value.trim(),
        // The monster as the name was filled from: a rename someone made since is not overwritten.
        expect: filled.nameFingerprint,
      });
    }
  });
  const removeBtn = panelButton(
    "monsters-remove",
    "Remove… (where it is used)",
    () => {
      if (shown) {
        actions.openContentRow({ dataset: "monsters", part: "monsters", key: shown.name });
      }
    },
    "danger",
  );
  const bodyHost = document.createElement("div");
  bodyHost.className = "items-pictures-host";
  identity.append(
    identityTitle,
    labelled("Display name", display, "What players see; empty shows its name."),
    renameBtn,
    removeBtn,
    bodyHost,
  );
  const rules = document.createElement("fieldset");
  rules.className = "items-rules";
  const groupsEl = document.createElement("div");
  rules.append(groupsEl);
  const status = statusLine();
  const saveBtn = panelButton(
    "monsters-save",
    "Save to the draft",
    () => {
      if (shown) {
        send({
          name: shown.name,
          op: "set",
          record: clean(work.record),
          data: clean(work.form),
          expect: filled.fingerprint,
        });
      }
    },
    "primary",
  );
  const undoEditBtn = panelButton("monsters-undo-edit", "Drop my edit", () => {
    fill();
    status.textContent = "";
    update();
  });
  const revertBtn = panelButton("monsters-revert", "Play the pack's rules again", () => {
    if (shown) {
      send({ name: shown.name, op: "revert", expect: shown.fingerprint });
    }
  });
  const dropBtn = panelButton("monsters-discard", "Drop the draft's changes", () => {
    if (shown) {
      send({ name: shown.name, op: "discard", expect: shown.fingerprint });
    }
  });
  const buttons = document.createElement("div");
  buttons.className = "content-buttons";
  buttons.append(saveBtn, undoEditBtn, revertBtn, dropBtn);

  // The NPC file: loot, spells and flags, saved live.
  const npcBox = document.createElement("section");
  npcBox.className = "balance-row monsters-npc";
  const npcTitle = document.createElement("h3");
  npcTitle.className = "balance-row-title";
  npcTitle.textContent = "Loot, spells and NPC flags (its NPC file)";
  const npcHelp = document.createElement("p");
  npcHelp.className = "balance-stale";
  npcHelp.textContent =
    "These live in the monster's NPC file and save at once, for everyone, like an NPCs page save: they do not wait for the draft.";
  const npcBody = document.createElement("fieldset");
  npcBody.className = "items-rules";
  const npcStatus = statusLine();
  const npcSaveBtn = panelButton(
    "monsters-npc-save",
    "Save the NPC file now",
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
  const npcUndoBtn = panelButton("monsters-npc-undo", "Drop my edit", () => {
    fillNpc();
    npcStatus.textContent = "";
    updateNpc();
  });
  const npcButtons = document.createElement("div");
  npcButtons.className = "content-buttons";
  const npcWholeBtn = panelButton("monsters-npc-whole", "Open the whole NPC file", () => {
    if (shown) {
      actions.openNpc?.(shown.name);
    }
  });
  npcButtons.append(npcSaveBtn, npcUndoBtn);
  // The link has its own rule: it shows whenever the NPCs page may be opened, a file read two ways
  // included (that is where it is fixed).
  npcBox.append(npcTitle, npcHelp, npcBody, npcButtons, npcWholeBtn, npcStatus);

  form.append(title, tags, noticeLine, stale, identity, rules, buttons, status, npcBox);

  // The monster spells card.
  const spellsBox = document.createElement("details");
  spellsBox.className = "balance-row monsters-spells";
  const spellsSummary = action(document.createElement("summary"), "monsters-spells-toggle");
  spellsSummary.textContent = "Monster spells";
  const spellsHelp = document.createElement("p");
  spellsHelp.className = "control-panel-field-help";
  spellsHelp.textContent =
    "The spells monsters cast. A monster casts the ones its NPC file names by tag (Spells, in its form). Each cast rolls 1 in the ladder's step for the number of players on the map (1 to 7 or more). Changes go into the draft.";
  const spellsRows = document.createElement("div");
  const spellsStatus = statusLine();
  const spellsAdd = panelButton("monsters-spells-add", "Add a monster spell", () => {
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
  const spellsSave = panelButton(
    "monsters-spells-save",
    "Save the monster spells to the draft",
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
  const spellsUndo = panelButton("monsters-spells-undo", "Drop my edit", () => {
    fillSpells();
    spellsStatus.textContent = "";
    updateSpells();
  });
  const spellsButtons = document.createElement("div");
  spellsButtons.className = "content-buttons";
  spellsButtons.append(spellsAdd, spellsSave, spellsUndo);
  spellsBox.append(spellsSummary, spellsHelp, spellsRows, spellsButtons, spellsStatus);

  const loading = document.createElement("p");
  loading.className = "balance-loading";
  loading.textContent = "Loading…";
  const layout = document.createElement("div");
  layout.className = "items-layout";
  layout.append(listBox, form);
  el.append(draftLine, newBox, spellsBox, loading, layout);

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
      return;
    }
    if ((change.display ?? "").length > 40) {
      say(status, "A display name is at most 40 characters.", false);
      return;
    }
    busy = true;
    say(status, "Saving…");
    update();
    seq += 1;
    saving.set(seq, { name: change.name, op: change.op });
    actions.set(seq, change);
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
  ) => {
    const input = noAutofill(action(document.createElement("input"), "monsters-number"));
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
  const check = (on: boolean, label: string, write: (on: boolean) => void, edited: () => void) => {
    const wrap = document.createElement("label");
    wrap.className = "items-check";
    const box = action(document.createElement("input"), "monsters-check");
    box.type = "checkbox";
    box.checked = on;
    box.addEventListener("change", () => {
      write(box.checked);
      edited();
    });
    wrap.append(box, ` ${label}`);
    return wrap;
  };
  const textInput = (value: string, write: (t: string) => void, edited: () => void, list = "") => {
    const t = noAutofill(action(document.createElement("input"), "monsters-text"));
    t.value = value;
    if (list) {
      t.setAttribute("list", list);
    }
    t.addEventListener("input", () => {
      write(t.value);
      edited();
    });
    return t;
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
      update();
    };
    const group = (id: string, ...controls: HTMLElement[]) => {
      const sec = document.createElement("section");
      sec.className = "balance-row items-group";
      sec.dataset.group = id;
      const h = document.createElement("h3");
      h.className = "balance-row-title";
      h.textContent = GROUP_TITLES[id] ?? id;
      sec.append(h);
      const from = v.sources.filter((x) => x.group === id);
      if (from.length > 0) {
        const head = document.createElement("p");
        head.className = "control-panel-field-help";
        head.textContent = v.defined
          ? "In the draft it plays its own definition:"
          : "What it plays now comes from:";
        const ul = document.createElement("ul");
        ul.className = "items-sources";
        for (const s of from) {
          const li = document.createElement("li");
          li.textContent = `${s.label}: ${s.from}`;
          ul.append(li);
        }
        sec.append(head, ul);
      }
      sec.append(...controls);
      if (v.pack) {
        const pack = v.pack;
        sec.append(
          panelButton(`monsters-pack-${id}`, "Use the pack's rules here", () => {
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
          }),
        );
      }
      return sec;
    };
    // Stats.
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
      for (const [k, v] of spawnErrors) {
        invalid.set(k, v);
      }
      if (spawnErrors.size > 0) {
        return;
      }
      if (pair.gt === null && pair.lt === null) {
        work.record.spawnMinute = null;
      } else if (pair.gt === null || pair.lt === null) {
        invalid.set(
          spawnBoxes[0] as HTMLInputElement,
          "Spawn minutes: fill both, or neither for any time",
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
      "Spawns after minute",
      (n) => {
        pair.gt = n;
      },
      () => {
        writePair();
        edited();
      },
      spawnErrors,
    );
    const spawnLt = intInput(
      minute?.lt,
      0,
      61,
      true,
      "Spawns before minute",
      (n) => {
        pair.lt = n;
      },
      () => {
        writePair();
        edited();
      },
      spawnErrors,
    );
    spawnBoxes = [spawnGt, spawnLt];
    const stats = group(
      "stats",
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
        ),
        "Its melee hit. Empty: it never melees.",
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
        "Taken off a melee attack's power.",
      ),
      labelled(
        "Spawns only after minute",
        spawnGt,
        "With the next field: it spawns only while the server minute is between the two (Classic's Zombie and Skeleton). Empty: any time.",
      ),
      labelled("…and before minute", spawnLt),
    );
    // Behaviour.
    const flags = flagsOf();
    const effectChecks = (key: "healedBy" | "resists") => {
      const box = document.createElement("div");
      box.className = "items-checks";
      box.dataset.list = key;
      const has = new Set((flags[key] as string[] | undefined) ?? []);
      for (const e of c.effects) {
        box.append(
          check(
            has.has(e),
            e,
            (on) => {
              if (on) {
                has.add(e);
              } else {
                has.delete(e);
              }
              const l = c.effects.filter((x) => has.has(x));
              setKey(flags, key, l.length > 0 ? l : undefined);
            },
            edited,
          ),
        );
      }
      return box;
    };
    const behaviour = group(
      "behaviour",
      ...DEF_FLAGS.map(([k, label]) =>
        check(work.form[k] === true, label, (on) => setKey(work.form, k, on || undefined), edited),
      ),
      ...RECORD_FLAGS.map(([k, label]) =>
        check(flags[k] === true, label, (on) => setKey(flags, k, on || undefined), edited),
      ),
      labelled(
        "Picked up as",
        textInput(
          String(flags.grabbable ?? ""),
          (t) => setKey(flags, "grabbable", t.trim() || undefined),
          edited,
          itemsList.id,
        ),
        "Ctrl, or a click from the tile it faces, picks it up as this item (Classic: a Pig). Empty: it cannot be picked up.",
      ),
      labelled("Healed by", effectChecks("healedBy"), "Spell hits that heal it instead."),
      labelled("Resists", effectChecks("resists"), "Spell hits that deal it only random(3)."),
    );
    // Combat.
    const affRows = document.createElement("div");
    const affinities = (): Obj[] => {
      if (!Array.isArray(work.form.affinities)) {
        work.form.affinities = [];
      }
      return work.form.affinities as Obj[];
    };
    const drawAff = () => {
      const arr = affinities();
      affRows.replaceChildren(
        ...arr.map((row, i) => {
          const line = document.createElement("div");
          line.className = "items-list-row";
          line.dataset.list = "affinities";
          const preview = document.createElement("span");
          preview.className = "control-panel-field-help balance-preview";
          const show = () => {
            preview.textContent = `${Number(row.delta ?? 0) >= 0 ? "+" : ""}${rollRange(Number(row.delta ?? 0), Number(row.randomN ?? 0)).replace(/^Always /, "")} damage`;
          };
          line.append(
            labelled(
              "Weapon family",
              textInput(
                String(row.weapon ?? ""),
                (t) => {
                  row.weapon = t;
                },
                edited,
              ),
            ),
            labelled(
              "Adds",
              intInput(
                row.delta,
                -1_000_000,
                1_000_000,
                false,
                `Weapon affinity ${i + 1}: adds`,
                (n) => {
                  row.delta = n;
                  show();
                },
                edited,
                invalid,
              ),
            ),
            labelled(
              "+ random(n)",
              intInput(
                row.randomN,
                0,
                1_000_000,
                false,
                `Weapon affinity ${i + 1}: random(n)`,
                (n) => {
                  row.randomN = n;
                  show();
                },
                edited,
                invalid,
              ),
            ),
            panelButton("monsters-affinity-remove", "Remove", () => {
              arr.splice(i, 1);
              if (arr.length === 0) {
                delete work.form.affinities;
              }
              drawAff();
              forgetGone(invalid);
              edited();
            }),
            preview,
          );
          show();
          return line;
        }),
      );
    };
    drawAff();
    const combat = group(
      "combat",
      labelled(
        "Weapon affinities",
        affRows,
        "Melee damage a weapon family adds against it: a weapon whose name contains the family (Silver, Sword of Hope). Each row that matches adds, in order.",
      ),
      panelButton("monsters-affinity-add", "Add a weapon affinity", () => {
        affinities().push({ weapon: "", delta: 1, randomN: 0 });
        drawAff();
        edited();
      }),
      labelled(
        "Kill skill cap",
        intInput(
          work.form.skillCap,
          0,
          1_000_000,
          true,
          "Kill skill cap",
          (n) => setKey(work.form, "skillCap", n ?? undefined),
          edited,
          invalid,
        ),
        "A kill trains the weapon's skills up to this. Empty: the world's default.",
      ),
    );
    // XP.
    const xp = group(
      "xp",
      labelled(
        "Melee kill XP",
        intInput(
          work.record.xpMelee,
          0,
          1_000_000_000,
          false,
          "Melee kill XP",
          (n) => {
            work.record.xpMelee = n;
          },
          edited,
          invalid,
        ),
      ),
      labelled(
        "Spell kill XP",
        intInput(
          work.record.xpSpell,
          0,
          1_000_000_000,
          false,
          "Spell kill XP",
          (n) => {
            work.record.xpSpell = n;
          },
          edited,
          invalid,
        ),
      ),
      labelled(
        "Skill XP",
        intInput(
          work.record.skillXp,
          0,
          1_000_000_000,
          true,
          "Skill XP",
          (n) => setKey(work.record, "skillXp", n ?? undefined),
          edited,
          invalid,
        ),
        "The XP a kill gives each XP-model skill the weapon trains. Empty: the skills' own amount.",
      ),
      labelled(
        "Kill XP after the ring",
        intInput(
          work.form.killXp,
          0,
          1_000_000_000,
          true,
          "Kill XP",
          (n) => setKey(work.form, "killXp", n ?? undefined),
          edited,
          invalid,
        ),
        "In place of the melee kill XP, once the ring's bonus is counted. Empty: none.",
      ),
      labelled(
        "Kill broadcast",
        textInput(
          String(work.form.killBroadcast ?? ""),
          (t) => setKey(work.form, "killBroadcast", t.trim() || undefined),
          edited,
        ),
        "Said to everyone on a kill; {} is the killer's name. Empty: none.",
      ),
    );
    // Lists.
    const listsOf = (): Obj => {
      if (!work.form.lists || typeof work.form.lists !== "object") {
        work.form.lists = {};
      }
      return work.form.lists as Obj;
    };
    const lists = group(
      "lists",
      ...LISTS.map(([k, label]) =>
        check(
          (work.form.lists as Obj | undefined)?.[k] === true,
          label,
          (on) => setKey(listsOf(), k, on || undefined),
          edited,
        ),
      ),
    );
    const sections = [stats, behaviour, combat, xp, lists];
    const old = only
      ? [...groupsEl.children].find((e) => (e as HTMLElement).dataset.group === only)
      : undefined;
    const fresh = only ? sections.find((e) => e.dataset.group === only) : undefined;
    if (old && fresh) {
      old.replaceWith(fresh);
    } else {
      groupsEl.replaceChildren(...sections);
    }
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
    title.textContent = v.display && v.display !== v.name ? `${v.display} (${v.name})` : v.name;
    const t: string[] = [];
    t.push(
      v.inPack
        ? v.defined || v.edited
          ? "Has its own definition"
          : "Plays the pack's rules"
        : "Your monster",
    );
    if (!v.published) {
      t.push("Only in the draft");
    }
    if (v.pending.definition === "set") {
      t.push("Rules changed in the draft");
    } else if (v.pending.definition !== null) {
      t.push("Definition dropped in the draft");
    }
    if (v.pending.record !== null) {
      t.push("Stats, name or body changed in the draft");
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
    saveBtn.disabled = busy || !rulesDirty() || errs.length > 0;
    undoEditBtn.hidden = !isDirty;
    undoEditBtn.disabled = busy;
    revertBtn.textContent = v.inPack ? "Play the pack's rules again" : "Drop its definition";
    revertBtn.hidden = !(v.defined || v.edited);
    revertBtn.disabled = busy;
    dropBtn.hidden = v.pending.definition === null && v.pending.record === null;
    dropBtn.disabled = busy;
    renameBtn.disabled = busy || !nameDirty();
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
        return `Loot ${i + 1}: pick an item.`;
      }
      if (!Number.isSafeInteger(l.oneIn) || l.oneIn < 1) {
        return `Loot ${i + 1}: the chance is a whole number from 1.`;
      }
    }
    if (npcWork.flags.some((f) => f.trim() === "")) {
      return "Flags: a flag needs a name.";
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
        "This monster is only in the draft: publish it first, then give it loot, spells and flags here.";
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
      p.textContent = `Line ${v.mixed.join(", ")} of its NPC file is read two ways at once (a drop line inside another line): fix it on the NPCs page (Open the whole NPC file, then edit it as text) before editing these here.`;
      npcBody.replaceChildren(p);
      return;
    }
    const edited = () => {
      npcStatus.textContent = "";
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
              ),
              "A count before it drops a pile: 15 Gold.",
            ),
            labelled(
              "1 in",
              intInput(
                l.oneIn,
                1,
                Number.MAX_SAFE_INTEGER,
                false,
                `Loot ${i + 1}: 1 in`,
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
    const lootHelp = document.createElement("p");
    lootHelp.className = "control-panel-field-help";
    lootHelp.textContent =
      "A kill picks one line at random, then drops it 1 in N times: each line's odds are 1 in (lines × N).";
    // Spells.
    const spellBox = document.createElement("div");
    spellBox.className = "items-checks";
    spellBox.dataset.list = "spells";
    const has = new Set(npcWork.spells.map((s) => s.toLowerCase()));
    for (const tag of v.spellTags) {
      spellBox.append(
        check(
          has.has(tag.toLowerCase()),
          tag,
          (on) => {
            if (on) {
              npcWork.spells.push(tag);
            } else {
              npcWork.spells = npcWork.spells.filter((s) => s.toLowerCase() !== tag.toLowerCase());
            }
          },
          edited,
        ),
      );
    }
    // Spells the file names that no monster spell has: kept, shown so they can be taken off.
    for (const s of npcWork.spells.filter(
      (x) => !v.spellTags.some((t) => t.toLowerCase() === x.toLowerCase()),
    )) {
      spellBox.append(
        check(
          true,
          `${s} (no such monster spell)`,
          (on) => {
            if (!on) {
              npcWork.spells = npcWork.spells.filter((x) => x !== s);
            }
          },
          edited,
        ),
      );
    }
    // Flags.
    const flagsArea = noAutofill(action(document.createElement("textarea"), "monsters-npc-flags"));
    flagsArea.rows = 3;
    flagsArea.value = npcWork.flags.join("\n");
    flagsArea.addEventListener("input", () => {
      npcWork.flags = flagsArea.value
        .split("\n")
        .map((f) => f)
        .filter((f) => f.trim() !== "");
      edited();
    });
    npcBody.replaceChildren(
      info,
      labelled("Loot", lootRows),
      lootHelp,
      panelButton("monsters-loot-add", "Add a drop", () => {
        npcWork.loot.push({ item: "", oneIn: 1 });
        drawLoot();
        edited();
      }),
      labelled(
        "Spells it casts",
        spellBox,
        "The monster spells (from the Monster spells card) it casts.",
      ),
      labelled(
        "NPC flags",
        flagsArea,
        "One per line. Passive: it fights only once attacked. Still: it never walks.",
      ),
    );
  };
  const updateNpc = () => {
    npcSaveBtn.textContent =
      npcShown?.exists === false ? "Attach an NPC file now" : "Save the NPC file now";
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
        "Someone changed this NPC file since you started editing it: saving will be refused. Drop your edit to see theirs.",
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
        line.className = "items-list-row";
        line.dataset.list = "monster-spells";
        const kind = action(document.createElement("select"), "monsters-spell-kind");
        for (const k of c.kinds) {
          const o = document.createElement("option");
          o.value = k;
          o.textContent = k;
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
          const step = intInput(
            n,
            1,
            1_000_000,
            false,
            `${s.tag || `Spell ${i + 1}`}: ladder step ${j + 1}`,
            (x) => {
              s.ladder[j] = x ?? 1;
            },
            edited,
            spellsInvalid,
          );
          step.setAttribute(
            "aria-label",
            `Ladder, ${j < 6 ? j + 1 : "7 or more"} ${j === 0 ? "player" : "players"}`,
          );
          ladder.append(step);
        });
        const tag = textInput(
          s.tag,
          (t) => {
            s.tag = t.trim();
          },
          edited,
        );
        // A saved spell's tag is what NPC files name: it stays as it is.
        tag.readOnly = (spellsView?.rows ?? []).some((r) => r.tag !== "" && r.tag === s.tag);
        line.append(
          labelled("Tag", tag, "What an NPC file's SPL| line names."),
          labelled("Effect", fx),
          labelled("Aim", kind),
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
          labelled("Ladder (1 to 7+ players)", ladder),
          check(
            s.aName,
            'Cast as "a" monster (the original\'s a-prefixed caster)',
            (on) => {
              s.aName = on;
            },
            edited,
          ),
          panelButton("monsters-spell-remove", "Remove", () => {
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
        "Someone changed the monster spells since you started editing them: saving will be refused. Drop your edit to see theirs.",
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
    listCount.textContent = `${rows.length} of ${list.length} monsters`;
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
        name.textContent = m.display === m.name ? m.name : `${m.display} (${m.name})`;
        const meta = document.createElement("span");
        meta.className = "items-list-meta";
        meta.textContent = [
          m.hostile ? "hostile" : "",
          m.npc ? "NPC" : "",
          m.sea ? "sea" : "",
          m.state === "yours" ? "yours" : m.state === "edited" ? "changed" : "",
          m.pending ? "in the draft" : "",
        ]
          .filter((x) => x !== "")
          .join(" · ");
        b.append(name, " ", meta);
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
          : `${shown.display || shown.name} has unsaved changes: save them or drop your edit first.`,
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
        : `The draft holds ${view.monsterDraft === 1 ? "1 monster change" : `${view.monsterDraft} monster changes`}${view.otherDraft > 0 ? ` and ${view.otherDraft} other ${view.otherDraft === 1 ? "change" : "changes"}` : ""}, live once published. `;
    // The spells card refreshes unless it holds an edit.
    const firstSpells = spellsView === null;
    spellsView = view.spells;
    if (firstSpells || (!spellsDirty() && !spellsBusy)) {
      fillSpells();
    }
    updateSpells();
    const m = view.monster;
    if (!openName) {
      return;
    }
    if (!m || m.name.toLowerCase() !== openName.toLowerCase()) {
      const open = openName.toLowerCase();
      if (shown && !view.monsters.some((x) => x.name.toLowerCase() === open)) {
        shown = null;
        npcShown = null;
        form.hidden = true;
        openName = null;
        body?.clear();
      }
      return;
    }
    const first = shown === null || shown.name !== m.name;
    const wasPublished = shown?.published;
    shown = m;
    form.hidden = false;
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
          updateNpc();
          return;
        }
        drawNpc();
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
            // The answer's view carries the new monster's form: it opens from it.
            openName = save.name;
            shown = null;
            npcShown = null;
          }
        } else if (openName && save.name.toLowerCase() === openName.toLowerCase()) {
          busy = false;
          if (msg.result) {
            if (msg.result.ok && newer && msg.view.monster) {
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
      loading.hidden = false;
      draftLine.hidden = true;
    },
    open(name) {
      openMonster(name);
    },
  };
}
