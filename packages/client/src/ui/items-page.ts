/**
 * The Control Panel's Items page (issue #30): every item in a searchable list, and a form for the
 * one open, showing what it plays now and where each rule comes from (its own definition, or the
 * pack's rows that match it). Saving writes the item's definition (`items/definitions/<name>`): one
 * record of its rules, which the content store compiles into exact rows that win in every table.
 * An SSO page: 1.6 kept its items' rules in its scripts.
 *
 * The form speaks the operator's words, not the tables': a tab per job the item can do (Basics,
 * Picture, Weapon, Armour, When used, Tool, Breaking, On the ground), each tab marked when the item
 * has settings there, damage typed as "from … to …" rather than `flat + random(n)`, protection as
 * "less damage" rather than a signed delta, and the rarely used fields last, below a thin line.
 *
 * Changes go into the content store's shared draft, so the Content page publishes, undoes and
 * notices them like any other row. A change carries the item as the page showed it (`fingerprint`),
 * and the server refuses it if someone changed the item since (here or in the Content page's JSON
 * editor). One Save sends the rules and then the name. Pictures use #29's panels, made by the
 * Content page; removing an item goes through the Content page's where-used report and removal
 * form (#28).
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
import { contentWords } from "./content-words.ts";
import {
  formActions,
  moreFields,
  newDialog,
  pageHeading,
  panelButton,
  sectionTabs,
  sourcesNote,
} from "./control-panel-kit.ts";
import { FormError, type FormWords, type JsonSchema, schemaForm } from "./schema-form.ts";

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

/**
 * The lowest and highest results of `flat + random(n)`. `random(n)` rolls 1 to n, and 0 (or none)
 * rolls nothing, so `6 + random(6)` is 7 to 12 and `6 + random(0)` is always 6.
 */
export function rollBounds(flat: number, randomN: number | null): { from: number; to: number } {
  return randomN ? { from: flat + 1, to: flat + randomN } : { from: flat, to: flat };
}

/** The roll that gives `from` to `to` (`rollBounds` backwards): a fixed value rolls nothing. */
export function rollFrom(from: number, to: number): { flat: number; randomN: number } {
  return from === to ? { flat: from, randomN: 0 } : { flat: from - 1, randomN: to - from + 1 };
}

/** The definition's keys each tab of the form holds (what "Restore this tab" puts back). */
const GROUP_KEYS: Record<string, readonly (keyof ItemDefinition)[]> = {
  basics: [
    "slot",
    "strength",
    "twoHanded",
    "behaviours",
    "requires",
    "paperdoll",
    "inEditorList",
    "inPlayerShops",
  ],
  weapon: ["attack", "trains", "cooldowns", "sound"],
  armour: ["armour", "elemental", "spellDefense", "gear"],
  use: ["use", "menu"],
  tools: ["tools"],
  breaking: ["damaged", "breaks"],
  ground: ["ground", "container"],
};

const KIND_TEXT: Record<ItemListEntry["kind"], string> = {
  weapon: "Weapon",
  armour: "Armour",
  food: "Food",
  other: "Other",
};

/** Where an item is worn (the Equip slot). 1.6's weapon hand is the left one. */
const SLOT_TEXT: Record<string, string> = {
  LeftHand: "Weapon hand",
  RightHand: "Off hand (shield)",
  Head: "Head",
  Body: "Body",
  Feet: "Feet",
  Ring: "Ring",
  No: "Nowhere: Equip refuses it",
};

/** The slots armour and breaks are tested in (1.6's `RingE`-style names). */
const SLOT_VAR_TEXT: Record<string, string> = {
  LeftHandE: "Weapon hand",
  RightHandE: "Off hand (shield)",
  HeadE: "Head",
  BodyE: "Body",
  FeetE: "Feet",
  RingE: "Ring",
};

/** The worn slots gear bonuses and swing speeds are tested in. */
const WORN_TEXT: Record<string, string> = {
  weapon: "Weapon hand",
  offHand: "Off hand",
  head: "Head",
  body: "Body",
  feet: "Feet",
  ring: "Ring",
};

const POWER_TEXT: Record<string, string> = {
  attack: "Attack power",
  spell: "Spell power",
  blackArts: "Black Arts power",
  martialArts: "Martial Arts power",
  killXp: "XP per kill",
};

const LAYER_TEXT: Record<string, string> = {
  weapon: "Weapon",
  shield: "Shield",
  helm: "Helmet",
  gloves: "Gloves",
  body: "Body",
};

const GROUND_LAYER_TEXT: Record<string, string> = {
  hidden: "Hidden (not drawn)",
  overChars: "Over the characters",
  overLayer3: "Over the top map layer",
};

const TOOL_TEXT: Record<string, string> = {
  Chop: "Chop trees",
  Mine: "Mine rock",
  Dig: "Dig",
  Farm: "Plant seeds",
  Fish: "Fish",
  Water: "Water crops",
};

const MENU_TEXT: Record<string, string> = {
  Storage: "Storage (opens it)",
};

/** What each behaviour does, as a tick box says it. */
const BEHAVIOUR_TEXT: Record<string, string> = {
  key: "Key: opens doors",
  book: "Book: can be read",
  bow: "Bow: shoots arrows",
  crossbow: "Crossbow: also trains Martial Arts",
  sword: "Counts as a sword (Firesword)",
  swingFireballs: "Every swing also throws a fireball",
  hidesName: "Hides the wearer's name",
  hidesHead: "Hides the wearer's hair",
  hidesHelm: "Hides the wearer's helmet",
  quiver: "Drawn on the wearer's back",
  hiddenFacingNorth: "Not drawn facing north",
  chest: "Chest: opens with a click",
  cabinet: "Cabinet (a container)",
  windCabinet: "Wind Cabinet (a container)",
  crate: "Crate (a container)",
  cauldron: "Cauldron: brews recipes",
  personalVault: "Personal vault",
  map: "Drawn as a map on the ground",
  camera: "Camera: takes photos",
  film: "Film for a camera",
  canvas: "Canvas: opens the paint screen",
  newspaperKit: "Newspaper kit",
  argonsFist: "Casts Argon's Fist when used",
  releasesMonster: "Dropped, it becomes the monster",
  slotMachine: "Slot machine",
  blackjackTable: "Blackjack table",
  checkersTable: "Checkers table",
  highScoreStatue: "Shows the high scores",
  assassinStatue: "Shows the assassins' ranking",
  door: "Door",
  switchDoor: "Door opened by switches",
  clock: "Clock: shows the server time",
  messageBoard: "Message board",
  universalMail: "Mailbox",
  guildCenter: "Guild center",
  noClick: "Clicking it does nothing",
  noCtrl: "Ctrl on it does nothing",
};

/** A choice's words: its entry in `text`, or the value itself. */
const textOf = (text: Record<string, string>) => (v: string) => text[v] ?? v;

/** A column of a list of records (damage rolls, protection rows, use effects). */
interface Column {
  key: string;
  label: string;
  kind: "int" | "intOrNull" | "bool" | "select" | "text" | "range" | "classes";
  /** Shown only while the row passes this test (a class requirement's classes, issue #15). */
  when?: (row: Obj) => boolean;
  /** Changing it redraws the list, for a column whose `when` reads it. */
  redraw?: boolean;
  min?: number;
  max?: number;
  options?: () => string[];
  /** The words a select shows for each value. */
  optionText?: (v: string) => string;
  /** An empty pick or text leaves the field out. */
  optional?: boolean;
  /** Shown and typed with the opposite sign: a rule's −2 is "2 less damage". */
  negate?: boolean;
  /** A range's largest spread (`randomN`). */
  maxSpread?: number;
  /** A range from a number to itself writes `randomN: null`, not 0 (use effects). */
  nullWhenFixed?: boolean;
  placeholder?: string;
}

/** A list of records in the definition, at a path: its columns and a new record. */
interface ListSpec {
  id: string;
  label: string;
  /** One record, for the Add button ("Add damage roll"). */
  one: string;
  path: string[];
  help: string;
  columns: Column[];
  fresh(): Obj;
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
  setAt(root, path, n);
  // A group left empty goes too ({"ground": {}} is "no ground rules", as left out is).
  if (n === undefined) {
    for (let i = path.length - 1; i > 0; i--) {
      const parent = at(root, path.slice(0, i));
      if (
        parent !== null &&
        typeof parent === "object" &&
        !Array.isArray(parent) &&
        Object.keys(parent).length === 0
      ) {
        setAt(root, path.slice(0, i), undefined);
      } else {
        break;
      }
    }
  }
}

function setAt(root: Obj, path: readonly string[], n: unknown): void {
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

/** A number for a field: the opposite sign when `negate`, never "-0". */
const signed = (v: number, negate: boolean) => (negate && v !== 0 ? -v : v);

export function createItemsPage(actions: ItemsPageActions): ItemsPage {
  const el = document.createElement("div");
  el.className = "items-page balance-page plain-editor";
  el.append(
    pageHeading(
      "Items",
      "Pick an item to change how it works in the game. Saving puts your changes with the other unpublished changes: players get them once you publish them on the Publish Changes page.",
    ),
  );
  const draftLine = document.createElement("div");
  draftLine.className = "balance-draft";
  draftLine.hidden = true;
  const draftText = document.createElement("span");
  draftLine.append(
    draftText,
    panelButton("items-open-content", "Review and publish…", () => actions.openContent()),
  );

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

  // ---- a new item ----
  const newBox = newDialog("items-new-toggle", "+ New item", "New item");
  const newName = noAutofill(action(document.createElement("input"), "items-new-name"));
  newName.maxLength = 40;
  const newDisplay = noAutofill(action(document.createElement("input"), "items-new-display"));
  newDisplay.maxLength = 40;
  newDisplay.placeholder = "Same as the ID";
  const newFrom = noAutofill(action(document.createElement("input"), "items-new-copy"));
  newFrom.placeholder = "Start from scratch";
  const namesList = document.createElement("datalist");
  namesList.id = "items-names";
  newFrom.setAttribute("list", namesList.id);
  const newStatus = document.createElement("p");
  newStatus.className = "balance-status";
  newStatus.setAttribute("role", "status");
  const createBtn = panelButton(
    "items-create",
    "Create item",
    () => {
      const name = newName.value.trim();
      if (name === "") {
        newStatus.textContent = "Give it an ID.";
        return;
      }
      seq += 1;
      saving.set(seq, { name, create: true });
      createBtn.disabled = true;
      newStatus.textContent = "Creating…";
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
    field(
      "Copy an existing item (optional)",
      newFrom,
      "items-new-copy",
      "The easiest way to make an item: start from a similar one, then change what you need.",
    ),
    namesList,
    field(
      "ID",
      newName,
      "items-new-name",
      "Its permanent name inside the game: maps and saved characters use it, so it can't change later.",
    ),
    field("Name players see (optional)", newDisplay, "items-new-display"),
    newStatus,
  );
  newBox.actions(createBtn);

  // ---- the list ----
  const listBox = document.createElement("section");
  listBox.className = "items-list-box";
  const search = noAutofill(action(document.createElement("input"), "items-search"));
  search.type = "search";
  search.placeholder = "Search items";
  const kindSel = action(document.createElement("select"), "items-kind");
  for (const [v, t] of [
    ["all", "All items"],
    ["weapon", "Weapons"],
    ["armour", "Armour"],
    ["food", "Food"],
    ["other", "Other"],
    ["changed", "Changed or added by you"],
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
  const filters = document.createElement("div");
  filters.className = "items-filters";
  filters.append(field("Search", search, "items-search"), field("Show", kindSel, "items-kind"));
  listBox.append(newBox.el, filters, listCount, listEl);

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
    panelButton("items-notice", "Review it under Publish Changes", () => {
      // Pack updates are answered with the unpublished changes.
      actions.openContent();
    }),
  );
  const stale = document.createElement("p");
  stale.className = "balance-stale";
  stale.hidden = true;
  stale.textContent =
    "Someone changed this item while you were editing it, so saving will be refused. Undo your changes to see theirs.";
  // The name players see: in the Basics tab, saved with the rules.
  const display = noAutofill(action(document.createElement("input"), "items-display"));
  display.maxLength = 40;
  const displayField = field("Name players see", display, "items-display");
  const displayHelp = document.createElement("p");
  displayHelp.className = "control-panel-field-help";
  displayField.append(displayHelp);
  const removeBtn = panelButton(
    "items-remove",
    "Remove or retire this item…",
    () => {
      if (shown) {
        actions.openContentRow({ dataset: "items", part: "items", key: shown.name });
      }
    },
    "danger",
  );
  const removeBox = document.createElement("div");
  removeBox.className = "items-remove";
  const removeHelp = document.createElement("p");
  removeHelp.className = "control-panel-field-help";
  removeHelp.textContent =
    "Shows everywhere the item is used first, then asks what happens to each.";
  removeBox.append(removeBtn, removeHelp);
  // The pictures: a tab of their own, saved by their own buttons.
  const pictures = document.createElement("section");
  pictures.className = "balance-row";
  pictures.dataset.group = "picture";
  pictures.dataset.ownSave = "";
  pictures.hidden = true;
  const picturesTitle = document.createElement("h3");
  picturesTitle.className = "balance-row-title";
  picturesTitle.textContent = "Picture";
  const picturesHost = document.createElement("div");
  picturesHost.className = "items-pictures-host";
  pictures.append(picturesTitle, picturesHost);
  // The tabs: one fieldset, locked while a save is on its way.
  const rules = document.createElement("fieldset");
  rules.className = "items-rules";
  const groupsEl = document.createElement("div");
  rules.append(groupsEl);
  const status = document.createElement("p");
  status.className = "balance-status";
  status.setAttribute("role", "status");
  const saveBtn = panelButton("items-save", "Save changes", () => save(), "primary");
  const undoEditBtn = panelButton("items-undo-edit", "Undo changes", () => {
    fill();
    status.textContent = "";
    update();
  });
  const revertBtn = panelButton("items-revert", "Restore the original", () => {
    if (shown) {
      send({ name: shown.name, op: "revert", expect: shown.fingerprint });
    }
  });
  const dropBtn = panelButton("items-discard", "Cancel unpublished changes", () => {
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
  const tabs = sectionTabs(form, "items");
  form.append(header, noticeLine, stale, tabs.el, rules, formActions(buttons, status));
  const loading = document.createElement("p");
  loading.className = "balance-loading";
  loading.textContent = "Loading…";
  const layout = document.createElement("div");
  layout.className = "items-layout";
  const empty = document.createElement("p");
  empty.className = "items-empty-form";
  empty.textContent = "Pick an item on the left to see and change how it works.";
  layout.append(listBox, empty, form);
  el.append(draftLine, loading, layout);

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
  /** A name to save once the rules' save is answered (one Save sends both). */
  let renameNext: string | null = null;
  /** Fields whose text does not read (their errors). */
  const invalid = new Map<HTMLElement, string>();
  /** An item definition's shape, from the server: the rarer parts' forms are drawn from it. */
  let defSchema: JsonSchema | null = null;
  /** The schema at `path` in a definition (each step a property), or null. */
  const schemaAt = (path: readonly string[]): JsonSchema | null => {
    let sch: JsonSchema | null = defSchema;
    for (const k of path) {
      const props = sch?.properties ?? sch?.anyOf?.find((x) => x.properties)?.properties;
      sch = props?.[k] ?? null;
    }
    return sch;
  };
  /** Words borrowed from the rule table holding the same thing (`prefix` is its path there). */
  const wordsVia = (dataset: string, part: string, prefix: string[]): FormWords => {
    const w = contentWords(dataset, part);
    return { field: (path) => w.field([...prefix, ...path]), names: w.names };
  };
  let panels: ItemPanels | null | undefined;

  /** Forgets the errors of fields no longer on the page (redrawn from the working definition). */
  const forgetGone = () => {
    for (const el of [...invalid.keys()]) {
      if (!el.isConnected) {
        invalid.delete(el);
      }
    }
  };
  /** The rules have an edit (or text that does not read) not yet saved. */
  const rulesDirty = () => shown !== null && (canonical(work) !== filled.value || invalid.size > 0);
  /** The name players see has an edit not yet saved. */
  const nameDirty = () => shown !== null && display.value.trim() !== filled.display;
  const dirty = () => rulesDirty() || nameDirty();

  const send = (change: ItemChange) => {
    if (busy) {
      return false;
    }
    // What the server's message check would refuse unanswered is refused here, before the form
    // locks waiting for an answer that would never come.
    const tooLong =
      change.name.trim().length > 80
        ? "That item's ID is longer than 80 characters."
        : (change.display ?? "").length > 40
          ? "The name players see is at most 40 characters."
          : null;
    if (tooLong) {
      status.textContent = tooLong;
      status.className = "balance-status balance-status-error";
      return false;
    }
    // Locked before the request goes, so nothing typed from here on can be lost.
    busy = true;
    status.textContent = "Saving…";
    status.className = "balance-status";
    update();
    seq += 1;
    saving.set(seq, { name: change.name, op: change.op });
    actions.set(seq, change);
    return true;
  };

  const renameChange = (): ItemChange | null =>
    shown
      ? {
          name: shown.name,
          op: "rename",
          display: display.value.trim(),
          expect: shown.fingerprint,
        }
      : null;

  /** Saves the rules, then the name (each only when changed). */
  const save = () => {
    if (!shown) {
      return;
    }
    if (rulesDirty()) {
      const name = nameDirty() ? display.value.trim() : null;
      if (name !== null && name.length > 40) {
        status.textContent = "The name players see is at most 40 characters.";
        status.className = "balance-status balance-status-error";
        return;
      }
      if (send({ name: shown.name, op: "set", data: clean(work), expect: filled.fingerprint })) {
        renameNext = name;
      }
    } else if (nameDirty()) {
      const change = renameChange();
      if (change) {
        send(change);
      }
    }
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
    opts: { negate?: boolean; placeholder?: string } = {},
  ) => {
    const negate = opts.negate === true;
    const input = noAutofill(action(document.createElement("input"), id));
    input.type = "number";
    // What is typed is the shown sign: the limits turn round with it.
    const lo = negate ? -max : min;
    const hi = negate ? -min : max;
    input.min = String(lo);
    input.max = String(hi);
    input.step = "1";
    input.value = typeof value === "number" ? String(signed(value, negate)) : "";
    if (nullable) {
      input.placeholder = opts.placeholder ?? "None";
    }
    input.addEventListener("input", () => {
      const t = input.value.trim();
      if (t === "" && nullable) {
        invalid.delete(input);
        write(null);
      } else if (!/^-?\d+$/.test(t) || Number(t) < lo || Number(t) > hi) {
        invalid.set(input, `${label}: a whole number from ${lo} to ${hi}`);
      } else {
        invalid.delete(input);
        write(signed(Number(t), negate));
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
    const isGroup = control.tagName === "DIV";
    // A group of tick boxes is named by a heading, not a label (a label names one control).
    const l = document.createElement(isGroup ? "span" : "label");
    l.className = "control-panel-field-label";
    fieldIds += 1;
    control.id ||= `items-field-${fieldIds}`;
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

  /**
   * Tick boxes for the values picked, and a drop-down (`more`, "Add an ability…") of the rest:
   * picking one there ticks it (forty abilities or skills at once are a wall).
   */
  const pickMany = (
    listId: string,
    values: readonly string[],
    has: Set<string>,
    text: (v: string) => string,
    id: (v: string) => string,
    more: string,
    write: (picked: string[]) => void,
  ) => {
    const box = document.createElement("div");
    box.className = "items-pick";
    box.dataset.list = listId;
    const on = document.createElement("div");
    on.className = "items-checks";
    const none = document.createElement("p");
    none.className = "control-panel-field-help";
    none.textContent = "None.";
    const add = action(document.createElement("select"), `items-${listId}-pick`);
    add.className = "items-pick-add";
    add.setAttribute("aria-label", more.replace(/…$/, ""));
    const sorted = [...values].sort((a, b) => text(a).localeCompare(text(b)));
    const ticks = new Map<string, HTMLElement>();
    const fillAdd = () => {
      const first = document.createElement("option");
      first.value = "";
      first.textContent = more;
      add.replaceChildren(
        first,
        ...sorted
          .filter((v) => !has.has(v) && !on.contains(ticks.get(v) ?? null))
          .map((v) => {
            const o = document.createElement("option");
            o.value = v;
            o.textContent = text(v);
            return o;
          }),
      );
      add.value = "";
      add.hidden = add.options.length <= 1;
      none.hidden = on.querySelector("input") !== null;
    };
    for (const v of sorted) {
      const tick = check(has.has(v), text(v), id(v), (ticked) => {
        if (ticked) {
          has.add(v);
        } else {
          has.delete(v);
        }
        write(values.filter((x) => has.has(x)));
      });
      ticks.set(v, tick);
      if (has.has(v)) {
        on.append(tick);
      }
    }
    add.addEventListener("change", () => {
      const v = add.value;
      const tick = ticks.get(v);
      if (!tick) {
        return;
      }
      on.append(tick);
      tick.querySelector("input")?.click();
      fillAdd();
    });
    on.append(none);
    fillAdd();
    box.append(on, add);
    return box;
  };

  /** A list of records: a row of fields for each, each removable, and an Add button. */
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
          const name = `${spec.label} ${arr.length > 1 ? `${i + 1} ` : ""}`;
          for (const c of spec.columns) {
            const id = `items-${spec.id}-${c.key}`;
            let control: HTMLElement;
            if (c.when && !c.when(row)) {
              continue;
            }
            if (c.kind === "classes") {
              const all = choices()?.classes ?? [];
              control = pickMany(
                `${spec.id}-${c.key}-${i}`,
                all.map((k) => String(k.code)),
                new Set(((row[c.key] as number[] | undefined) ?? []).map(String)),
                (v) => all.find((k) => String(k.code) === v)?.name ?? `Class ${v}`,
                (v) => `${id}-${v}`,
                "Add a class…",
                (picked) => {
                  if (picked.length > 0) {
                    row[c.key] = picked.map(Number);
                  } else {
                    delete row[c.key];
                  }
                },
              );
              line.append(labelled(c.label, control));
              continue;
            }
            if (c.kind === "range") {
              line.append(rangeField(row, c, `${name.trim()}`, id));
              continue;
            }
            if (c.kind === "int" || c.kind === "intOrNull") {
              control = intInput(
                row[c.key],
                c.min ?? 0,
                c.max ?? 9999,
                c.kind === "intOrNull",
                `${name}${c.label}`.trim(),
                (n) => {
                  if (c.optional && n === null) {
                    delete row[c.key];
                  } else {
                    row[c.key] = n;
                  }
                },
                id,
                {
                  ...(c.negate ? { negate: true } : {}),
                  ...(c.placeholder ? { placeholder: c.placeholder } : {}),
                },
              );
            } else if (c.kind === "bool") {
              control = check(row[c.key] === true, c.label, id, (on) => {
                if (on) {
                  row[c.key] = true;
                } else {
                  delete row[c.key];
                }
              });
            } else if (c.kind === "select") {
              const words = c.optionText ?? ((v: string) => v);
              const opts = [
                ...(c.optional ? [["", c.placeholder ?? "None"] as const] : []),
                ...(c.options?.() ?? []).map((o) => [o, words(o)] as const),
              ];
              control = select(String(row[c.key] ?? ""), opts, id, (v) => {
                if (c.optional && v === "") {
                  delete row[c.key];
                } else {
                  row[c.key] = v;
                }
                if (c.redraw) {
                  draw();
                }
              });
            } else {
              const t = noAutofill(action(document.createElement("input"), id));
              t.value = String(row[c.key] ?? "");
              if (c.placeholder) {
                t.placeholder = c.placeholder;
              }
              t.addEventListener("input", () => {
                if (c.optional && t.value.trim() === "") {
                  delete row[c.key];
                } else {
                  row[c.key] = t.value;
                }
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
          );
          return line;
        }),
      );
    };
    const add = panelButton(`items-${spec.id}-add`, `+ Add ${spec.one}`, () => {
      const arr = (at(work, spec.path) as Obj[] | undefined) ?? [];
      arr.push(spec.fresh());
      put(work, spec.path, arr);
      draw();
      edited();
    });
    add.classList.add("items-add");
    draw();
    box.append(head, help, rowsEl, add);
    return box;
  };

  /**
   * A roll typed as "from … to …" (a row's `flat` and `randomN`): `6 + random(6)` shows as 7 to 12.
   */
  const rangeField = (row: Obj, c: Column, name: string, id: string) => {
    const wrap = document.createElement("div");
    wrap.className = "control-panel-field balance-field items-range";
    const l = document.createElement("label");
    l.className = "control-panel-field-label";
    const fromIn = noAutofill(action(document.createElement("input"), `${id}-from`));
    const toIn = noAutofill(action(document.createElement("input"), `${id}-to`));
    fieldIds += 1;
    fromIn.id = `items-field-${fieldIds}`;
    l.htmlFor = fromIn.id;
    l.textContent = c.label;
    fromIn.setAttribute("aria-label", `${c.label} from`);
    toIn.setAttribute("aria-label", `${c.label} to`);
    const b = rollBounds(Number(row.flat ?? 0), (row.randomN as number | null | undefined) ?? null);
    for (const [input, v] of [
      [fromIn, b.from],
      [toIn, b.to],
    ] as const) {
      input.type = "number";
      input.step = "1";
      input.value = String(v);
    }
    const lo = c.min ?? -9999;
    const hi = c.max ?? 9999;
    const spread = c.maxSpread ?? 9999;
    const read = () => {
      const f = fromIn.value.trim();
      const t = toIn.value.trim();
      const err = `${name}: whole numbers from ${lo} to ${hi + spread}, "to" no lower than "from"`;
      if (!/^-?\d+$/.test(f) || !/^-?\d+$/.test(t)) {
        invalid.set(wrap, err);
      } else {
        const r = rollFrom(Number(f), Number(t));
        if (Number(t) < Number(f) || r.flat < lo || r.flat > hi || r.randomN > spread) {
          invalid.set(wrap, err);
        } else {
          invalid.delete(wrap);
          row.flat = r.flat;
          row.randomN = c.nullWhenFixed && r.randomN === 0 ? null : r.randomN;
        }
      }
      edited();
    };
    fromIn.addEventListener("input", read);
    toIn.addEventListener("input", read);
    const pair = document.createElement("div");
    pair.className = "items-range-pair";
    pair.append(fromIn, " to ", toIn);
    wrap.append(l, pair);
    return wrap;
  };

  /**
   * Builds the tabs from `work`; with `only`, redraws that tab alone, so text another tab holds
   * that does not read yet (and its error) stays as it is.
   */
  const drawGroups = (only?: string) => {
    const c = choices();
    if (!c || !shown) {
      groupsEl.replaceChildren();
      return;
    }
    const item = shown;
    /** A section's less used fields, shown after its main ones. */
    const more = (_used: boolean, ...controls: HTMLElement[]) => moreFields("", ...controls);
    const has = (...paths: string[][]) => paths.some((p) => clean(at(work, p)) !== undefined);
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
      foot.append(
        sourcesNote(
          item.defined
            ? "Where these settings come from: this item's own rules"
            : "Where these settings come from",
          item.sources.filter((x) => x.group === id).map((s) => `${s.label}: ${s.from}`),
        ),
      );
      if (item.pack) {
        const pack = item.pack;
        const restore = panelButton(`items-pack-${id}`, "Restore this tab to the original", () => {
          for (const k of GROUP_KEYS[id] ?? []) {
            const v = (pack as Obj)[k];
            put(work, [k], v === undefined ? undefined : structuredClone(v));
          }
          drawGroups(id);
          forgetGone();
          edited();
        });
        restore.classList.add("items-restore");
        foot.append(restore);
      }
      sec.append(foot);
      return sec;
    };

    // ---- Basics ----
    // The same test the server uses: a name whose behaviours are its base item's.
    const masterwork = !definesBehaviours(item.name);
    const abilities = masterwork
      ? (() => {
          const p = document.createElement("p");
          p.className = "control-panel-field-help";
          p.textContent = `A +N masterwork has the abilities of the item it is made from.`;
          return p;
        })()
      : labelled(
          "Special abilities",
          pickMany(
            "behaviours",
            c.behaviours,
            new Set((work.behaviours as string[] | undefined) ?? []),
            textOf(BEHAVIOUR_TEXT),
            (b) => `items-behaviour-${b}`,
            "Add an ability…",
            (picked) => put(work, ["behaviours"], picked.length > 0 ? picked : undefined),
          ),
          "What it does besides being worn: opening doors, shooting arrows, holding items…",
        );
    const basics = group(
      "basics",
      "Basics",
      "Its name, where it is worn and what a player needs to use it.",
      displayField,
      labelled(
        "Worn in",
        select(
          String(work.slot ?? ""),
          [["", "Not worn"], ...c.slots.map((s) => [s, SLOT_TEXT[s] ?? s] as const)],
          "items-slot",
          (v) => put(work, ["slot"], v === "" ? undefined : v),
        ),
        "Weapons go in the weapon hand; shields and arrows in the off hand.",
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
        "The Strength a player needs to equip it. Leave it empty for none.",
      ),
      check(work.twoHanded === true, "Needs both hands", "items-two-handed", (on) =>
        put(work, ["twoHanded"], on ? true : undefined),
      ),
      labelled(
        "Only these classes",
        pickMany(
          "classes",
          c.classes.map((k) => String(k.code)),
          new Set(((work.classes as number[] | undefined) ?? []).map(String)),
          (v) => c.classes.find((k) => String(k.code) === v)?.name ?? `Class ${v}`,
          (v) => `items-class-${v}`,
          "Add a class…",
          (picked) => put(work, ["classes"], picked.length > 0 ? picked.map(Number) : undefined),
        ),
        "Only characters of these classes can equip it (a +1 of it too). Add none for every class.",
      ),
      abilities,
      listEditor({
        id: "requires",
        label: "Requirements",
        one: "requirement",
        path: ["requires"],
        help: "A skill or level a player must reach, or a class they must be in, before equipping or using it.",
        columns: [
          {
            key: "on",
            label: "Before",
            kind: "select",
            options: () => ["equip", "use"],
            optionText: textOf({ equip: "Equipping", use: "Using" }),
          },
          {
            key: "needs",
            label: "Needs",
            kind: "select",
            options: () => ["level", "class", ...c.skills],
            optionText: textOf({ level: "Level", class: "A class" }),
            redraw: true,
          },
          {
            key: "atLeast",
            label: "At least",
            kind: "int",
            min: 0,
            max: 1_000_000,
            when: (row) => row.needs !== "class",
          },
          {
            key: "classes",
            label: "Classes",
            kind: "classes",
            when: (row) => row.needs === "class",
          },
          {
            key: "text",
            label: "Message if not met",
            kind: "text",
            optional: true,
            placeholder: "The usual message",
          },
        ],
        fresh: () => ({ on: "equip", needs: "level", atLeast: 1 }),
      }),
      check(
        work.inPlayerShops === true,
        "Players can sell it in their shops",
        "items-in-shops",
        (on) => put(work, ["inPlayerShops"], on ? true : undefined),
      ),
      check(
        work.inEditorList === true,
        "Listed in the World Editor's items",
        "items-in-editor",
        (on) => put(work, ["inEditorList"], on ? true : undefined),
      ),
      more(
        has(["paperdoll"]),
        listEditor({
          id: "paperdoll",
          label: "Borrow another item's worn picture",
          one: "borrowed picture",
          path: ["paperdoll"],
          help: "Draws it on the character as another item looks when worn. Not needed once it has worn pictures of its own (the Picture tab).",
          columns: [
            {
              key: "layer",
              label: "Worn as",
              kind: "select",
              options: () => c.layers,
              optionText: textOf(LAYER_TEXT),
            },
            { key: "becomes", label: "Looks like", kind: "text", placeholder: "Another item's ID" },
          ],
          fresh: () => ({ layer: "weapon", becomes: "" }),
        }),
      ),
      removeBox,
    );

    // ---- Weapon ----
    /**
     * A rarer part of the definition at `path` as a form drawn from its shape (a skill book, the
     * skill bonuses): ticked on to give the item one, off to leave it out.
     */
    const formAt = (path: string[], label: string, id: string, w: FormWords): HTMLElement => {
      const inner = schemaAt(path);
      const box = document.createElement("div");
      box.className = "items-schema-form";
      if (!inner) {
        box.textContent = "Loading…";
        return box;
      }
      const wrapper: JsonSchema = {
        type: "object",
        properties: { [label]: inner },
        required: [],
        additionalProperties: false,
      };
      const v = at(work, path);
      const form = schemaForm(
        wrapper,
        v === undefined ? {} : { [label]: v },
        {
          field: (p) => (p.length === 1 ? { label } : w.field(p.slice(1))),
          names: w.names,
        },
        {
          id,
          onInput: () => {
            try {
              const read = form.value() as Record<string, unknown>;
              invalid.delete(box);
              put(work, path, read[label]);
            } catch (e) {
              if (!(e instanceof FormError)) {
                throw e;
              }
              invalid.set(box, e.message);
            }
            edited();
          },
        },
      );
      box.append(form.el);
      return box;
    };
    const tiers = formAt(
      ["attack", "blocks"],
      "Skill bonuses",
      "items-tiers",
      wordsVia("attPower", "attPower", ["skillBlocks"]),
    );
    const rollColumns = (label: string): Column[] => [
      { key: "flat", label, kind: "range", min: -9999, max: 9999, maxSpread: 9999 },
      {
        key: "strengthHalf",
        label: "Plus up to half the wielder's Strength",
        kind: "bool",
      },
    ];
    const sound = noAutofill(action(document.createElement("input"), "items-sound"));
    sound.value = typeof work.sound === "string" ? work.sound : "";
    sound.placeholder = "The usual swing";
    sound.disabled = work.sound === null;
    sound.addEventListener("input", () => {
      put(work, ["sound"], sound.value.trim() === "" ? undefined : sound.value.trim());
      edited();
    });
    const weapon = group(
      "weapon",
      "Weapon",
      "How hard it hits when held in the weapon hand, how fast it swings and what it trains.",
      listEditor({
        id: "base",
        label: "Damage",
        one: "damage roll",
        path: ["attack", "base"],
        help: "The damage each hit rolls, before skills and Strength add to it. Most weapons have one roll; with more, the last one counts.",
        columns: rollColumns("Damage"),
        fresh: () => ({ flat: 1, randomN: 6 }),
      }),
      labelled(
        "Skills it trains",
        pickMany(
          "trains",
          c.skills,
          new Set(
            ((work.trains as string[] | undefined) ?? []).flatMap(
              (s) => c.skills.find((x) => x.toLowerCase() === s.toLowerCase()) ?? [],
            ),
          ),
          (s) => s,
          (s) => `items-trains-${s.replace(/\W/g, "-")}`,
          "Add a skill…",
          (picked) => put(work, ["trains"], picked.length > 0 ? picked : undefined),
        ),
        "Killing something with it trains these skills.",
      ),
      listEditor({
        id: "cooldowns",
        label: "Swing speed",
        one: "swing speed",
        path: ["cooldowns"],
        help: "The wait between swings while it is worn, in frames (20 a second; the usual is 14). Lower is faster. A ring can set it too.",
        columns: [
          {
            key: "slot",
            label: "While worn in",
            kind: "select",
            options: () => c.wornSlots,
            optionText: textOf(WORN_TEXT),
          },
          { key: "atDelay", label: "Between attacks", kind: "int", min: 0, max: 1000 },
          { key: "actionDelay", label: "Between actions", kind: "int", min: 0, max: 1000 },
        ],
        fresh: () => ({ slot: "weapon", atDelay: 14, actionDelay: 14 }),
      }),
      labelled("Swing sound", sound, "A sound's name. Leave it empty for the usual swing."),
      check(work.sound === null, "Swings silently", "items-silent-swing", (on) => {
        put(work, ["sound"], on ? null : undefined);
        sound.disabled = on;
        sound.value = "";
      }),
      more(
        has(["attack", "overrides"], ["attack", "blocks"]),
        listEditor({
          id: "overrides",
          label: "Final damage override",
          one: "override roll",
          path: ["attack", "overrides"],
          help: "Rolled after every bonus, replacing the damage. Almost no item has one.",
          columns: rollColumns("Damage"),
          fresh: () => ({ flat: 1, randomN: 6 }),
        }),
        labelled(
          "Skill bonuses",
          tiers,
          "Damage added as the wielder's skills rise, step by step. Copying an existing weapon is the easy way to get these.",
        ),
      ),
    );

    // ---- Armour ----
    const armour = group(
      "armour",
      "Armour",
      "How much it protects the wearer, and the bonuses it gives while worn.",
      listEditor({
        id: "armour",
        label: "Protection",
        one: "protection",
        path: ["armour"],
        help: "How much less damage each hit does while it is worn there. A negative number makes hits hurt more.",
        columns: [
          {
            key: "slot",
            label: "While worn in",
            kind: "select",
            options: () => c.slotVars,
            optionText: textOf(SLOT_VAR_TEXT),
          },
          {
            key: "hitMe",
            label: "Against players",
            kind: "int",
            min: -999,
            max: 999,
            negate: true,
          },
          {
            key: "hitMe2",
            label: "Against monsters",
            kind: "intOrNull",
            min: -999,
            max: 999,
            negate: true,
          },
        ],
        fresh: () => ({
          slot: c.slotVars.includes("BodyE") ? "BodyE" : c.slotVars[0],
          hitMe: -1,
          hitMe2: -1,
        }),
      }),
      listEditor({
        id: "spellDefense",
        label: "Spell protection",
        one: "spell protection",
        path: ["spellDefense"],
        help: "How much less damage attack spells do while it is worn there. Metal armour usually has a negative number: spells hurt more.",
        columns: [
          {
            key: "slot",
            label: "While worn in",
            kind: "select",
            options: () => c.slotVars,
            optionText: textOf(SLOT_VAR_TEXT),
          },
          {
            key: "delta",
            label: "Less spell damage",
            kind: "int",
            min: -999,
            max: 999,
            negate: true,
          },
        ],
        fresh: () => ({ slot: c.slotVars.includes("BodyE") ? "BodyE" : c.slotVars[0], delta: -1 }),
      }),
      listEditor({
        id: "gear",
        label: "Bonuses while worn",
        one: "bonus",
        path: ["gear"],
        help: "Adds to the wearer's power while it is worn there.",
        columns: [
          {
            key: "slot",
            label: "While worn in",
            kind: "select",
            options: () => c.wornSlots,
            optionText: textOf(WORN_TEXT),
          },
          {
            key: "power",
            label: "Adds to",
            kind: "select",
            options: () => c.powers,
            optionText: textOf(POWER_TEXT),
          },
          { key: "add", label: "Amount", kind: "int", min: -999, max: 999 },
        ],
        fresh: () => ({ slot: c.wornSlots[0] ?? "ring", power: c.powers[0] ?? "attack", add: 1 }),
      }),
      more(
        has(["elemental"]),
        listEditor({
          id: "elemental",
          label: "Protection against one attacker",
          one: "protection",
          path: ["elemental"],
          help: "Extra protection against one weapon (when a player hits) or one monster (when it hits), such as Ice Armor against an Ice Sword or a Yeti.",
          columns: [
            {
              key: "handler",
              label: "Hit by",
              kind: "select",
              options: () => ["HitMe", "HitMe2"],
              optionText: textOf({ HitMe: "A player's weapon", HitMe2: "A monster" }),
            },
            {
              key: "trigger",
              label: "Named",
              kind: "text",
              placeholder: "Ice Sword, a Yeti…",
            },
            {
              key: "slot",
              label: "While worn in",
              kind: "select",
              options: () => c.slotVars,
              optionText: textOf(SLOT_VAR_TEXT),
            },
            {
              key: "delta",
              label: "Less damage",
              kind: "int",
              min: -999,
              max: 999,
              negate: true,
            },
          ],
          fresh: () => ({
            handler: "HitMe",
            trigger: "",
            slot: c.slotVars.includes("BodyE") ? "BodyE" : c.slotVars[0],
            delta: -1,
          }),
        }),
      ),
    );

    // ---- When used ----
    const message = noAutofill(action(document.createElement("input"), "items-use-message"));
    message.value = String(at(work, ["use", "message"]) ?? "");
    message.placeholder = "None";
    message.addEventListener("input", () => {
      put(work, ["use", "message"], message.value === "" ? undefined : message.value);
      edited();
    });
    const refusal = noAutofill(action(document.createElement("input"), "items-use-refusal"));
    refusal.value = String(at(work, ["use", "refusal"]) ?? "");
    refusal.placeholder = "You cannot use the …";
    refusal.addEventListener("input", () => {
      put(work, ["use", "refusal"], refusal.value.trim() === "" ? undefined : refusal.value);
      edited();
    });
    const textAt = (path: string[], id: string, placeholder = "") => {
      const t = noAutofill(action(document.createElement("input"), id));
      t.value = String(at(work, path) ?? "");
      t.placeholder = placeholder;
      t.addEventListener("input", () => {
        put(work, path, t.value.trim() === "" ? undefined : t.value.trim());
        edited();
      });
      return t;
    };
    const intAt = (
      path: string[],
      min: number,
      max: number,
      label: string,
      id: string,
      placeholder?: string,
    ) =>
      intInput(
        at(work, path),
        min,
        max,
        true,
        label,
        (n) => put(work, path, n ?? undefined),
        id,
        placeholder ? { placeholder } : {},
      );
    const flagAt = (path: string[], label: string, id: string) =>
      check(at(work, path) === true, label, id, (on) => put(work, path, on ? true : undefined));
    const use = group(
      "use",
      "When used",
      "What happens when a player uses it from their bag: eating food, drinking a potion, reading a book.",
      flagAt(["use", "usable"], "Players can use it", "items-usable"),
      flagAt(
        ["use", "whenFull"],
        "Can be used when full (a healing potion, say)",
        "items-use-when-full",
      ),
      listEditor({
        id: "effects",
        label: "Effects",
        one: "effect",
        path: ["use", "effects"],
        help: "Each changes a stat by an amount in the range when it is used. Food raises Hunger; a negative amount lowers it. The Game Rules page sets what a full stomach refuses and the most hunger can reach.",
        columns: [
          { key: "stat", label: "Stat", kind: "select", options: () => c.stats },
          {
            key: "flat",
            label: "Changes it by",
            kind: "range",
            min: -99999,
            max: 99999,
            maxSpread: 99999,
            nullWhenFixed: true,
          },
        ],
        fresh: () => ({ stat: "Hunger", flat: 1000, randomN: null }),
      }),
      labelled(
        "Message when used",
        message,
        'Shown to the player, such as "You eat an apple." Leave it empty for none.',
      ),
      labelled(
        "Message when it can't be used",
        refusal,
        'Replaces "You cannot use the …". Leave it empty for the usual message.',
      ),
      labelled(
        "Item menu button",
        select(
          String(work.menu ?? ""),
          [["", "Equip (the usual)"], ...c.menus.map((m) => [m, MENU_TEXT[m] ?? m] as const)],
          "items-menu",
          (v) => put(work, ["menu"], v === "" ? undefined : v),
        ),
        "The button the item's menu shows in place of Equip: a stove's Cook, an anvil's Smith.",
      ),
      more(
        has(["use", "mysticism"], ["use", "skillBook"], ["use", "silent"]),
        flagAt(["use", "silent"], "Using it does nothing and says nothing", "items-use-silent"),
        labelled(
          "Mysticism needed to read",
          intAt(["use", "mysticism"], 0, 1000, "Mysticism needed to read", "items-mysticism", "1"),
          "For a spell book: the Mysticism a player needs to learn its spell.",
        ),
        labelled(
          "Skill book",
          formAt(
            ["use", "skillBook"],
            "Skill book",
            "items-skill-book",
            wordsVia("itemRules", "use", ["skillBooks", "[]"]),
          ),
          "Reading it teaches a skill and uses it up. Leave it off if it is not a skill book.",
        ),
      ),
    );

    // ---- Tool ----
    const tools = group(
      "tools",
      "Tool",
      "What players can gather with it, such as chopping trees with an axe or fishing with a rod.",
      listEditor({
        id: "tools",
        label: "Tool uses",
        one: "tool use",
        path: ["tools"],
        help: "A better tier gathers more often. The swing speed sets how fast it swings, from the gathering skill. Items that share hits keep one count of hits between them.",
        columns: [
          {
            key: "can",
            label: "Can",
            kind: "select",
            options: () => c.toolCans,
            optionText: textOf(TOOL_TEXT),
            optional: true,
            placeholder: "Nothing",
          },
          {
            key: "tier",
            label: "Tier",
            kind: "intOrNull",
            min: 1,
            max: 1000,
            optional: true,
            placeholder: "1",
          },
          {
            key: "ladder",
            label: "Swing speed from",
            kind: "select",
            options: () => c.ladders,
            optional: true,
            placeholder: "The usual",
          },
          {
            key: "counter",
            label: "Shares hits with",
            kind: "text",
            optional: true,
            placeholder: "No other item",
          },
        ],
        fresh: () => ({ can: c.toolCans[0] ?? "Chop" }),
      }),
    );

    // ---- Breaking ----
    const breakSlots = (kind: "armour" | "weapon") => {
      const box = document.createElement("div");
      box.className = "items-checks";
      box.dataset.list = `breaks-${kind}`;
      const has = new Set((at(work, ["breaks", kind]) as string[] | undefined) ?? []);
      const slots = kind === "armour" ? c.breakArmourSlots : c.breakWeaponSlots;
      for (const v of slots) {
        box.append(
          check(has.has(v), SLOT_VAR_TEXT[v] ?? v, `items-breaks-${kind}-${v}`, (on) => {
            if (on) {
              has.add(v);
            } else {
              has.delete(v);
            }
            const list = slots.filter((x) => has.has(x));
            put(work, ["breaks", kind], list.length > 0 ? list : undefined);
          }),
        );
      }
      return box;
    };
    const breaking = group(
      "breaking",
      "Breaking",
      "Whether it can break while in use, and what it turns into.",
      labelled(
        "Can break when worn as armour in",
        breakSlots("armour"),
        "Tick none and it never breaks as armour.",
      ),
      labelled(
        "Can break when used as a weapon in",
        breakSlots("weapon"),
        "Tick none and it never breaks as a weapon.",
      ),
      labelled(
        "Breaks into",
        textAt(["damaged"], "items-damaged", "Nothing: it stays as it is"),
        "The ID of the item it becomes when it breaks.",
      ),
    );

    // ---- On the ground ----
    const offset = (axis: "dx" | "dy", label: string) =>
      intInput(
        at(work, ["ground", "offset", axis]),
        -1000,
        1000,
        true,
        label,
        (n) => {
          const other = at(work, ["ground", "offset", axis === "dx" ? "dy" : "dx"]);
          if ((n === null || n === undefined) && other === undefined) {
            put(work, ["ground", "offset"], undefined);
          } else {
            const o = { dx: 0, dy: 0, ...((at(work, ["ground", "offset"]) as Obj) ?? {}) };
            o[axis] = n ?? 0;
            put(work, ["ground", "offset"], o);
          }
        },
        `items-ground-offset-${axis}`,
        { placeholder: "0" },
      );
    const ctrlText = noAutofill(action(document.createElement("input"), "items-ground-ctrl"));
    ctrlText.value = String(at(work, ["ground", "ctrlText", "text"]) ?? "");
    ctrlText.placeholder = "Ctrl picks it up";
    const ctrlUnpause = check(
      at(work, ["ground", "ctrlText", "unpause"]) === true,
      "The message ends Ctrl's pause",
      "items-ground-ctrl-unpause",
      () => writeCtrl(),
    );
    const writeCtrl = () => {
      const text = ctrlText.value.trim();
      const unpause = (ctrlUnpause.querySelector("input") as HTMLInputElement).checked;
      put(work, ["ground", "ctrlText"], text === "" ? undefined : { text, unpause });
    };
    ctrlText.addEventListener("input", () => {
      writeCtrl();
      edited();
    });
    const offsetPair = document.createElement("div");
    offsetPair.className = "items-range-pair";
    offsetPair.append("Right ", offset("dx", "Right"), " Down ", offset("dy", "Down"));
    const ground = group(
      "ground",
      "On the ground",
      "How it behaves on the map, and how much it holds if it is a container.",
      flagAt(
        ["ground", "blocks"],
        "Blocks movement: nobody can walk through it",
        "items-ground-blocks",
      ),
      labelled(
        "Hover name",
        textAt(["ground", "tipName"], "items-ground-tip", "Its name"),
        "What the tip says when the mouse is over it on the ground.",
      ),
      flagAt(["ground", "tipless"], "Show no hover name", "items-ground-tipless"),
      labelled(
        "Container size",
        intAt(["container", "capacity"], 0, 1000, "Container size", "items-capacity", "The usual"),
        "How many lines of items it holds, if it is a container.",
      ),
      flagAt(["container", "uniqueId"], "Each copy has its own storage", "items-unique-id"),
      more(
        has(
          ["ground", "platforms"],
          ["ground", "overlay"],
          ["ground", "inUse"],
          ["ground", "layer"],
          ["ground", "offset"],
          ["ground", "ctrlText"],
        ),
        listEditor({
          id: "ground-platforms",
          label: "Blocks until a skill is high enough",
          one: "skill needed",
          path: ["ground", "platforms"],
          help: "Players can only cross it once they reach every skill or level listed.",
          columns: [
            {
              key: "needs",
              label: "Needs",
              kind: "select",
              options: () => ["level", ...c.skills],
              optionText: textOf({ level: "Level" }),
            },
            { key: "atLeast", label: "At least", kind: "int", min: 0, max: 1_000_000 },
          ],
          fresh: () => ({ needs: "level", atLeast: 1 }),
        }),
        labelled(
          "Animated overlay",
          textAt(["ground", "overlay"], "items-ground-overlay", "None"),
          "An animation drawn over it, such as a fire's flames.",
        ),
        flagAt(
          ["ground", "inUse"],
          "Animate only while someone crafts at it",
          "items-ground-in-use",
        ),
        labelled(
          "Drawn on layer",
          select(
            String(at(work, ["ground", "layer"]) ?? ""),
            [
              ["", "With the other items (the usual)"],
              ...c.groundLayers.map((l) => [l, GROUND_LAYER_TEXT[l] ?? l] as const),
            ],
            "items-ground-layer",
            (v) => put(work, ["ground", "layer"], v === "" ? undefined : v),
          ),
        ),
        labelled(
          "Position on its tile (pixels)",
          offsetPair,
          "Moves its picture on its tile. The Picture tab lets you drag it instead.",
        ),
        labelled(
          "Ctrl message",
          ctrlText,
          'Ctrl on it says this instead of picking it up, such as "It is too heavy."',
        ),
        ctrlUnpause,
      ),
    );

    const sections = [basics, pictures, weapon, armour, use, tools, breaking, ground];
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

  /**
   * Marks each tab that holds settings (its tab shows a dot), and shows "Restore this tab" only on
   * a tab that differs from the pack's.
   */
  const markUsed = () => {
    const pack = shown?.pack ?? null;
    for (const sec of groupsEl.querySelectorAll<HTMLElement>(":scope > .items-group")) {
      const keys = GROUP_KEYS[sec.dataset.group ?? ""] ?? [];
      const used = keys.some((k) => clean(work[k]) !== undefined);
      if (sec.dataset.used !== String(used)) {
        sec.dataset.used = String(used);
      }
      const restore = sec.querySelector<HTMLButtonElement>(
        ":scope > .items-group-foot > .items-restore",
      );
      if (restore) {
        const same = keys.every(
          (k) => canonical(work[k]) === canonical(pack ? (pack as Obj)[k] : undefined),
        );
        restore.hidden = same;
      }
    }
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
  /** Fills the name players see from the view. */
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
    markUsed();
    update();
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
        ? v.defined || v.edited
          ? ["Changed by you", "changed"]
          : ["Original", "original"]
        : ["Added by you", "changed"],
    );
    if (v.retired) {
      t.push(["Retired", "retired"]);
    }
    if (v.pending.definition === "set" || v.pending.catalogue !== null) {
      t.push(["Unpublished changes", "pending"]);
    } else if (v.pending.definition !== null) {
      t.push([
        v.inPack ? "Back to the original once published" : "Rules cleared once published",
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
    revertBtn.textContent = v.inPack ? "Restore the original" : "Clear all its rules";
    revertBtn.title = v.inPack
      ? "Plays the pack's original rules again once published."
      : "Leaves it with no rules once published.";
    revertBtn.hidden = !(v.defined || v.edited) || v.pending.definition === "revert";
    revertBtn.disabled = busy;
    dropBtn.title = "Takes this item's changes out of the draft: players keep what they have now.";
    dropBtn.hidden = v.pending.definition === null && v.pending.catalogue === null;
    dropBtn.disabled = busy;
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
    listCount.textContent =
      rows.length === list.length
        ? `${list.length} items`
        : `${rows.length} of ${list.length} items`;
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
        name.className = "items-list-name";
        name.textContent = i.display || i.name;
        const meta = document.createElement("span");
        meta.className = "items-list-meta";
        meta.textContent = [
          KIND_TEXT[i.kind],
          i.state === "yours" ? "added by you" : i.state === "edited" ? "changed" : "",
          i.retired ? "retired" : "",
          i.pending ? "unpublished" : "",
        ]
          .filter((x) => x !== "")
          .join(" · ");
        b.append(name, " ", meta);
        if (i.display && i.display !== i.name) {
          b.title = `ID: ${i.name}`;
        }
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
        pictures.hidden = false;
      }
    }
    panels?.show(name);
  };

  const openItem = (name: string) => {
    if (shown && (dirty() || busy || panels?.pending())) {
      status.textContent = busy
        ? "Wait for the save to finish."
        : `${shown.display || shown.name} has unsaved changes: save them or undo them first.`;
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
    defSchema = (view.definitionSchema as JsonSchema | undefined) ?? defSchema;
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
        : `${total === 1 ? "1 unpublished change" : `${total} unpublished changes`}${view.otherDraft > 0 && view.itemDraft > 0 ? ` (${view.itemDraft} to items)` : view.itemDraft === 0 ? " (none to items)" : ""}. Players get them once you publish. `;
    const item = view.item;
    empty.hidden = openName !== null && shown !== null;
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
        empty.hidden = false;
        openName = null;
        panels?.clear();
      }
      return;
    }
    const first = shown === null || shown.name !== item.name;
    shown = item;
    form.hidden = false;
    empty.hidden = true;
    if (first) {
      fill();
    } else if (!busy) {
      // Each part catches up on its own: an edit in one is never lost to a refresh of the other.
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
    // What the picture panels draw from: the slot, the worn aliases, the behaviours and the ground
    // offset. A saved change to any of them redraws the panels.
    const f = item.form as Obj;
    const slot = JSON.stringify([
      f.slot,
      f.paperdoll,
      f.behaviours,
      (f.ground as Obj | undefined)?.offset,
    ]);
    if (first) {
      filled = { ...filled, slot };
      showPanels(item.name);
    } else if (slot !== filled.slot) {
      // A new equip slot, alias, behaviour or offset (saved): the panels catch up.
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
            newBox.open = false;
            openName = msg.view.item.name;
            shown = null;
          }
        } else if (openName && save.name.toLowerCase() === openName.toLowerCase()) {
          busy = false;
          const next = renameNext;
          renameNext = null;
          if (msg.result) {
            if (msg.result.ok && newer && msg.view.item) {
              // Saved: the part saved shows what the draft now holds; an unsaved edit in the
              // other part stays (a rename keeps rule edits, a rules save keeps a typed name).
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
          if (newer) {
            appliedSeq = msg.seq;
            show(msg.view);
          } else {
            update();
          }
          // The rules are saved: the name the same Save carried goes next.
          if (msg.result?.ok && save.op === "set" && next !== null && nameDirty()) {
            const change = renameChange();
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
      list = [];
      openName = null;
      shown = null;
      work = {};
      filled = { value: "", fingerprint: "", display: "", slot: undefined };
      busy = false;
      renameNext = null;
      invalid.clear();
      panels?.clear();
      search.value = "";
      kindSel.value = "all";
      newName.value = "";
      newBox.open = false;
      newDisplay.value = "";
      newFrom.value = "";
      newStatus.textContent = "";
      createBtn.disabled = false;
      status.textContent = "";
      listEl.replaceChildren();
      groupsEl.replaceChildren();
      form.hidden = true;
      empty.hidden = false;
      loading.hidden = false;
      draftLine.hidden = true;
    },
    open(name) {
      openItem(name);
    },
  };
}
