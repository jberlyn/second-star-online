/**
 * The Control Panel's Skills page (issue #38): every skill in Skills-page order, and a form for the
 * one open: its name and place, who starts with it, its progression per source (1.6's chance model
 * or the XP model, formulas as rows), its level curve, what trains it, and previews worked out by
 * the game's own rules (shared `chancePreview` and `xpPreview`) on the form as it is being edited.
 * Saves go into the content store's shared draft, published from the Content page. An SSO page:
 * 1.6's skills were fixed in its code.
 *
 * - A change carries the skill as the page showed it (`fingerprint`); the server refuses it if
 *   someone changed the skill since (here or in the Content page's JSON editor), and refuses a
 *   change that brings a new problem.
 * - Removing a skill lists every reference and the characters with a value stored; each reference
 *   is cleared or pointed at another skill. A skill a binding names cannot be removed.
 *
 * Refreshes never touch a form being edited: its fields and fingerprint stay as they were filled.
 */
import type {
  ChanceSettings,
  Curve,
  Formula,
  FormulaRow,
  SkillProgression,
  XpSettings,
} from "@secondstaronline/data";
import {
  type ContentProblemView,
  type ContentRowRef,
  type ContentSkillsView,
  type ContentSkillUsage,
  type ContentSkillView,
  chancePreview,
  formatXp,
  type PreviewContext,
  previewCap,
  type SkillListEntry,
  type SkillSource,
  type SkillTrainer,
  sourceSettings,
  xpPreview,
} from "@secondstaronline/shared";

import { action, noAutofill } from "./action.ts";
import { formActions, pageHeading, panelButton, sectionTabs } from "./control-panel-kit.ts";
import { canonical } from "./items-page.ts";

/** A Skills page change as the page sends it. */
export interface SkillChange {
  key: string;
  op: "set" | "create" | "discard";
  data?: SkillForm;
  expect?: string;
}

/** A skill's form, as a save carries it. */
export interface SkillForm {
  display?: string;
  hidden?: boolean;
  progression?: SkillProgression | null;
  order?: number;
  starts?: Record<string, number | null>;
  grants?: number[];
  /** The curve, sent only when the form edited it, with its revision as loaded (null: new). */
  curve?: { name: string; curve: Curve; expect?: string | null } | null;
}

/** A removal's choice for one reference. */
export interface SkillRemovalChoice {
  id: string;
  action: "clear" | "replace";
  to?: string;
}

export interface SkillsPageActions {
  view(seq: number, key?: string): void;
  set(seq: number, change: SkillChange): void;
  usage(seq: number, key: string): void;
  remove(seq: number, key: string, refs: SkillRemovalChoice[], expect: string): void;
  openContent(): void;
  openContentRow(row: ContentRowRef): void;
  /** Opens an item on the Items page. */
  openItem(name: string): void;
  /** Opens the Gathering page (at a node). */
  openGathering(node?: number): void;
}

export type SkillsAnswer =
  | {
      t: "contentSkills";
      seq: number;
      view: ContentSkillsView;
      result?: { ok: boolean; text: string; problems?: ContentProblemView[] };
    }
  | { t: "contentSkillUsage"; seq: number; usage: ContentSkillUsage | null; error?: string };

export interface SkillsPage {
  readonly el: HTMLElement;
  onShow(): void;
  changes(): number;
  discard(): void;
  receive(msg: SkillsAnswer): void;
  published(): void;
  reset(): void;
  open(key: string): void;
}

export const SOURCES: readonly { id: SkillSource; label: string; help: string }[] = [
  { id: "kill", label: "Kill", help: "The weapon's skills, when its holder kills a monster." },
  {
    id: "shot",
    label: "Shot",
    help: "The bound Archery (and Martial Arts with a crossbow), each arrow.",
  },
  { id: "defend", label: "Defend", help: "The bound Parry and Block, when struck." },
  { id: "cast", label: "Cast", help: "The bound Magery and the spell's school, each cast." },
  {
    id: "gather",
    label: "Gather",
    help: "A harvest node's skill and the bound Fishing, each success.",
  },
  { id: "craft", label: "Craft", help: "The bound crafting skill, each craft." },
  {
    id: "hit",
    label: "Hit",
    help: "The weapon's skills (or a spell's school), each hit that does damage.",
  },
];

const OPS: FormulaRow["op"][] = ["set", "add", "subtract", "multiply"];

/** A formula as rows: a bare number is one `set` row. */
export function formulaRows(f: Formula | undefined): FormulaRow[] {
  if (f === undefined) {
    return [];
  }
  return typeof f === "number" ? [{ op: "set", value: f }] : structuredClone(f);
}

/** Rows back to a formula: one plain `set` of a number is the number itself; none is undefined. */
export function rowsFormula(rows: readonly FormulaRow[]): Formula | undefined {
  if (rows.length === 0) {
    return undefined;
  }
  const [only] = rows;
  if (
    rows.length === 1 &&
    only &&
    only.op === "set" &&
    !only.when?.length &&
    typeof only.value === "number"
  ) {
    return only.value;
  }
  return rows.map((r) => ({ ...r, ...(r.when?.length ? {} : { when: undefined }) }));
}

/** A row's value as typed: a whole number, `random(n)`, `a + random(n)` or a name. */
export function parseValue(t: string): FormulaRow["value"] | null {
  const s = t.trim();
  if (/^-?\d{1,6}$/.test(s)) {
    return Number(s);
  }
  if (/^(?:\d{1,6} \+ )?random\([1-9]\d{0,5}\)$/.test(s) || /^[A-Za-z_]\w*$/.test(s)) {
    return s;
  }
  return null;
}

/** A row's conditions as typed: `name > n`, comma-separated; empty for none. */
export function parseWhen(t: string): string[] | null {
  const parts = t
    .split(",")
    .map((x) => x.trim().replace(/\s+/g, " "))
    .filter((x) => x !== "");
  return parts.every((p) => /^[A-Za-z_]\w* [<>] -?\d{1,7}$/.test(p)) ? parts : null;
}

/** A chance as the preview writes it: "1 in 23" (and a percentage). */
export function chanceText(p: number): string {
  if (p <= 0) {
    return "never";
  }
  if (p >= 1) {
    return "always";
  }
  return `1 in ${(1 / p).toFixed(1).replace(/\.0$/, "")} (${(p * 100).toFixed(p < 0.01 ? 2 : 1)}%)`;
}

let ids = 0;

/** A labelled field, as the other Control Panel pages lay them out. */
function labelled(label: string, control: HTMLElement, help = ""): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "control-panel-field balance-field";
  const l = document.createElement("label");
  l.className = "control-panel-field-label";
  ids += 1;
  control.id ||= `skills-field-${ids}`;
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
}

function option(value: string, text = value): HTMLOptionElement {
  const o = document.createElement("option");
  o.value = value;
  o.textContent = text;
  return o;
}

/**
 * A formula editor: one line per row (its conditions, its op, its value), with add and remove.
 * `errors` collects rows that do not read; `changed` runs on every edit with the rows.
 */
export function formulaEditor(
  idPrefix: string,
  label: string,
  rows: FormulaRow[],
  errors: Map<HTMLElement, string>,
  changed: (rows: FormulaRow[]) => void,
): HTMLElement {
  const box = document.createElement("div");
  box.className = "items-list-editor";
  const title = document.createElement("p");
  title.className = "items-list-title";
  title.textContent = label;
  const list = document.createElement("div");
  const help = document.createElement("p");
  help.className = "control-panel-field-help";
  help.textContent =
    "Rows apply in order to a result that starts at 0. When: conditions like skill > 10 or strength < 5, comma-separated (empty: always). Value: a number, random(n), a + random(n), or a name: skill, a stat (strength, stamina, intelligence, wisdom, dexterity), level, tier, damage (hits only), a stat table or another skill.";
  const draw = () => {
    list.replaceChildren(
      ...rows.map((row, i) => {
        const line = document.createElement("div");
        line.className = "items-list-row";
        line.dataset.list = idPrefix;
        const when = noAutofill(action(document.createElement("input"), `${idPrefix}-when`));
        when.value = (row.when ?? []).join(", ");
        when.placeholder = "always";
        const op = action(document.createElement("select"), `${idPrefix}-op`);
        for (const o of OPS) {
          op.append(option(o));
        }
        op.value = row.op;
        const value = noAutofill(action(document.createElement("input"), `${idPrefix}-value`));
        value.value = String(row.value);
        const check = () => {
          const w = parseWhen(when.value);
          const v = parseValue(value.value);
          if (w === null) {
            errors.set(when, `${label} row ${i + 1}: a condition is name > n or name < n`);
          } else {
            errors.delete(when);
            row.when = w.length > 0 ? w : undefined;
          }
          if (v === null) {
            errors.set(value, `${label} row ${i + 1}: a value is a number, random(n) or a name`);
          } else {
            errors.delete(value);
            row.value = v;
          }
          row.op = op.value as FormulaRow["op"];
          changed(rows);
        };
        when.addEventListener("input", check);
        value.addEventListener("input", check);
        op.addEventListener("change", check);
        line.append(
          labelled("When", when),
          labelled("Op", op),
          labelled("Value", value),
          panelButton(`${idPrefix}-remove`, "Remove", () => {
            errors.delete(when);
            errors.delete(value);
            rows.splice(i, 1);
            draw();
            changed(rows);
          }),
        );
        return line;
      }),
    );
  };
  draw();
  box.append(
    title,
    list,
    panelButton(`${idPrefix}-add`, "Add a row", () => {
      rows.push({ op: rows.length === 0 ? "set" : "add", value: rows.length === 0 ? "skill" : 1 });
      draw();
      changed(rows);
    }),
    help,
  );
  return box;
}

/** A skill's form from its view. */
function formOf(
  v: ContentSkillView,
): Required<Omit<SkillForm, "curve">> & { curve: SkillForm["curve"] } {
  return {
    display: v.row.display ?? "",
    hidden: v.row.hidden === true,
    progression: v.row.progression ? structuredClone(v.row.progression) : null,
    order: v.order,
    starts: Object.fromEntries(v.starts.map((s) => [String(s.code), s.value])),
    grants: v.promotions.filter((p) => p.grants).map((p) => p.code),
    curve: v.curve ? { name: v.curve.name, curve: structuredClone(v.curve.curve) } : null,
  };
}

export function createSkillsPage(actions: SkillsPageActions): SkillsPage {
  const el = document.createElement("div");
  el.className = "skills-page items-page balance-page";
  el.append(
    pageHeading(
      "Skills",
      "Every skill and how it rises: its name and place on the Skills page, the classes that start with it, its progression from each kind of action (1.6's chance to advance, or XP against a level curve), and what trains it. Changes go into the content draft, published from the Content page. New kinds of skill effect need code.",
    ),
  );
  const draftLine = document.createElement("div");
  draftLine.className = "balance-draft";
  draftLine.hidden = true;
  const draftText = document.createElement("span");
  draftLine.append(
    draftText,
    panelButton("skills-open-content", "Review and publish on the Content page", () =>
      actions.openContent(),
    ),
  );
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
  const problemText = (r: { text: string; problems?: ContentProblemView[] }) =>
    [r.text, ...(r.problems ?? []).map((p) => `${p.where}: ${p.message}`)].join(" ");

  // ---- a new skill ----
  const newBox = document.createElement("details");
  newBox.className = "items-new";
  const newSummary = action(document.createElement("summary"), "skills-new-toggle");
  newSummary.textContent = "New skill";
  const newKey = noAutofill(action(document.createElement("input"), "skills-new-key"));
  newKey.maxLength = 40;
  const newDisplay = noAutofill(action(document.createElement("input"), "skills-new-display"));
  newDisplay.maxLength = 40;
  const newModel = action(document.createElement("select"), "skills-new-model");
  newModel.append(option("chance", "Chance to advance (1.6's)"), option("xp", "XP and levels"));
  const newCurve = noAutofill(action(document.createElement("input"), "skills-new-curve"));
  newCurve.placeholder = "a curve's name";
  const curvesList = document.createElement("datalist");
  curvesList.id = "skills-curves";
  newCurve.setAttribute("list", curvesList.id);
  const newStatus = statusLine();
  const createBtn = panelButton(
    "skills-create",
    "Make it in the draft",
    () => {
      const key = newKey.value.trim();
      if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(key)) {
        say(newStatus, "A key is letters, digits and spaces, starting with a letter.", false);
        return;
      }
      const data: SkillForm = {};
      if (newDisplay.value.trim()) {
        data.display = newDisplay.value.trim();
      }
      if (newModel.value === "xp") {
        const name = newCurve.value.trim() || key.toLowerCase().replace(/\s+/g, "-");
        data.progression = { model: "xp", curve: name };
        if (!view?.progression.curves[name]) {
          // A new curve: 100 XP a level, to change in the form.
          data.curve = { name, curve: { counting: "perLevel", formula: 100 } };
        }
      }
      seq += 1;
      saving.set(seq, { key, create: true });
      createBtn.disabled = true;
      say(newStatus, "Saving…");
      actions.set(seq, { key, op: "create", data });
    },
    "primary",
  );
  newBox.append(
    newSummary,
    labelled(
      "Key",
      newKey,
      "Its permanent key: characters keep their values under it, so it never changes. Rename it later by its display name.",
    ),
    labelled("Display name", newDisplay, "What players see. Empty shows the key."),
    labelled("Progression", newModel),
    labelled(
      "Level curve",
      newCurve,
      "For XP: the curve it levels by (a new name makes one: 100 XP a level).",
    ),
    curvesList,
    createBtn,
    newStatus,
  );

  // ---- the list ----
  const listBox = document.createElement("section");
  listBox.className = "items-list-box";
  const search = noAutofill(action(document.createElement("input"), "skills-search"));
  search.type = "search";
  search.placeholder = "Find a skill";
  const listEl = document.createElement("ul");
  listEl.className = "items-list";
  listEl.setAttribute("aria-label", "Skills");
  const listCount = document.createElement("p");
  listCount.className = "control-panel-field-help";
  listBox.append(newBox, labelled("Find", search), listCount, listEl);

  // ---- the form ----
  const form = document.createElement("section");
  form.className = "items-form";
  form.hidden = true;
  const title = document.createElement("h2");
  title.className = "content-section-title";
  const tags = document.createElement("p");
  tags.className = "control-panel-field-help";
  const noticeLine = document.createElement("p");
  noticeLine.className = "balance-stale";
  noticeLine.hidden = true;
  const stale = document.createElement("p");
  stale.className = "balance-stale skills-stale";
  stale.hidden = true;
  stale.textContent =
    "Someone changed this skill since you started editing it: saving will be refused. Drop your edit to see theirs.";
  const groups = document.createElement("div");
  const status = statusLine();
  const saveBtn = panelButton(
    "skills-save",
    "Save to the draft",
    () => {
      if (!shown) {
        return;
      }
      if (invalid.size > 0) {
        say(status, [...invalid.values()].join(". "), false);
        return;
      }
      send({ key: shown.skill, op: "set", data: dataOf(), expect: filled.fingerprint });
    },
    "primary",
  );
  const undoBtn = panelButton("skills-undo-edit", "Drop my edit", () => {
    fill();
    status.textContent = "";
    update();
  });
  const dropBtn = panelButton("skills-discard", "Drop the draft's change", () => {
    if (shown) {
      send({ key: shown.skill, op: "discard", expect: shown.fingerprint });
    }
  });
  const removeBtn = panelButton(
    "skills-remove",
    "Remove… (where it is used)",
    () => {
      if (shown) {
        seq += 1;
        usageAsked = seq;
        removal.hidden = false;
        tabs.select(removalTitle.textContent ?? "");
        removalBody.replaceChildren();
        say(removalStatus, "Finding where it is used…");
        actions.usage(seq, shown.skill);
      }
    },
    "danger",
  );
  const buttons = document.createElement("div");
  buttons.className = "content-buttons";
  buttons.append(saveBtn, undoBtn, dropBtn, removeBtn);

  // The removal panel.
  const removal = document.createElement("section");
  removal.className = "balance-row skills-removal";
  removal.dataset.ownSave = "";
  removal.hidden = true;
  const removalTitle = document.createElement("h3");
  removalTitle.className = "balance-row-title";
  removalTitle.textContent = "Remove this skill";
  const removalBody = document.createElement("div");
  const removalStatus = statusLine();
  let usage: ContentSkillUsage | null = null;
  const removalChoices = new Map<string, SkillRemovalChoice>();
  const removeGo = panelButton(
    "skills-remove-confirm",
    "Remove it in the draft",
    () => {
      if (!usage || !shown) {
        return;
      }
      const choices = [...removalChoices.values()];
      if (choices.some((c) => c.action === "replace" && !c.to)) {
        say(removalStatus, "Pick the skill each pointed reference goes to.", false);
        return;
      }
      seq += 1;
      removing.add(seq);
      say(removalStatus, "Removing…");
      actions.remove(seq, usage.skill, choices, usage.fingerprint);
    },
    "danger",
  );
  const removeCancel = panelButton("skills-remove-cancel", "Keep it", () => {
    removal.hidden = true;
    usage = null;
  });
  removal.append(removalTitle, removalBody, removeGo, removeCancel, removalStatus);

  const tabs = sectionTabs(form, "skills");
  form.append(
    title,
    tags,
    noticeLine,
    stale,
    tabs.el,
    groups,
    removal,
    formActions(buttons, status),
  );
  const loading = document.createElement("p");
  loading.className = "balance-loading";
  loading.textContent = "Loading…";
  const layout = document.createElement("div");
  layout.className = "items-layout";
  layout.append(listBox, form);
  el.append(draftLine, loading, layout);

  // ---- state ----
  let seq = 0;
  let resetSeq = -1;
  let appliedSeq = -1;
  let usageAsked = -1;
  const saving = new Map<number, { key: string; create?: boolean; op?: SkillChange["op"] }>();
  const removing = new Set<number>();
  let view: ContentSkillsView | null = null;
  let list: SkillListEntry[] = [];
  let openKey: string | null = null;
  let shown: ContentSkillView | null = null;
  let work = {} as ReturnType<typeof formOf>;
  let filled = { value: "", fingerprint: "" };
  let busy = false;
  const invalid = new Map<HTMLElement, string>();
  /** The preview's inputs (kept across skills). */
  const preview = {
    source: "kill" as SkillSource,
    level: 1,
    str: 5,
    sta: 5,
    int: 5,
    wis: 5,
    dex: 5,
    otherSkills: 0,
    tier: 1,
    damage: 10,
    /** A killed monster's skill cap (null: none). */
    monsterCap: null as number | null,
  };
  /** Whether the form edited its curve, and the curve's revision as the form loaded it. */
  let curveEdit: { edited: boolean; expect: string | null } = { edited: false, expect: null };

  /** The form as a save sends it: the curve only when edited, naming its revision. */
  const dataOf = (): SkillForm => {
    const out: SkillForm = structuredClone(work);
    if (!curveEdit.edited || !out.curve) {
      delete out.curve;
    } else {
      out.curve = { ...out.curve, expect: curveEdit.expect };
    }
    return out;
  };
  const dirty = () => shown !== null && (canonical(work) !== filled.value || invalid.size > 0);
  const send = (change: SkillChange) => {
    if (busy) {
      return;
    }
    busy = true;
    say(status, "Saving…");
    update();
    seq += 1;
    saving.set(seq, { key: change.key, op: change.op });
    actions.set(seq, change);
  };
  const ask = () => {
    seq += 1;
    actions.view(seq, openKey ?? undefined);
  };
  const update = () => {
    const d = dirty();
    saveBtn.disabled = busy || !d;
    undoBtn.disabled = busy || !d;
    dropBtn.hidden = !shown?.pending;
    dropBtn.disabled = busy;
    removeBtn.disabled = busy;
    stale.hidden = !(shown && d && shown.fingerprint !== filled.fingerprint);
    for (const c of groups.querySelectorAll<
      HTMLInputElement | HTMLSelectElement | HTMLButtonElement
    >("input, select, button")) {
      c.disabled = busy;
    }
  };
  const fill = () => {
    if (!shown) {
      return;
    }
    work = formOf(shown);
    curveEdit = {
      edited: false,
      expect: shown.curve ? (view?.curveFingerprints[shown.curve.name] ?? null) : null,
    };
    filled = { value: canonical(work), fingerprint: shown.fingerprint };
    invalid.clear();
    draw();
  };

  // ---- drawing the form ----
  const section = (titleText: string, ...children: HTMLElement[]) => {
    const sec = document.createElement("section");
    sec.className = "balance-row items-group";
    const h = document.createElement("h3");
    h.className = "balance-row-title";
    h.textContent = titleText;
    sec.append(h, ...children);
    return sec;
  };
  const edited = () => {
    status.textContent = "";
    // A redraw (a formula row removed, the model or a source switched) drops fields: what they
    // held is no longer the form's.
    for (const k of [...invalid.keys()]) {
      if (!k.isConnected) {
        invalid.delete(k);
      }
    }
    update();
    drawPreview();
  };
  const intField = (
    idName: string,
    value: number | null,
    min: number,
    max: number,
    nullable: boolean,
    label: string,
    write: (n: number | null) => void,
  ) => {
    const input = noAutofill(action(document.createElement("input"), idName));
    input.type = "number";
    input.min = String(min);
    input.max = String(max);
    input.value = value === null ? "" : String(value);
    if (nullable) {
      input.placeholder = "not set";
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
  /** A cap field: empty (none), a number, `faction` or `mage`. */
  const capField = (
    idName: string,
    value: ChanceSettings["cap"],
    label: string,
    write: (c: ChanceSettings["cap"]) => void,
  ) => {
    const input = noAutofill(action(document.createElement("input"), idName));
    input.value = value === undefined ? "" : String(value);
    input.placeholder = "none (100)";
    input.addEventListener("input", () => {
      const t = input.value.trim().toLowerCase();
      if (t === "") {
        invalid.delete(input);
        write(undefined);
      } else if (t === "faction" || t === "mage") {
        invalid.delete(input);
        write(t);
      } else if (/^\d+$/.test(t) && Number(t) <= 100) {
        invalid.delete(input);
        write(Number(t));
      } else {
        invalid.set(input, `${label}: a number to 100, faction or mage`);
      }
      edited();
    });
    return input;
  };
  const skillSelect = (idName: string, value: string, write: (s: string) => void) => {
    const sel = action(document.createElement("select"), idName);
    for (const k of view?.keys ?? []) {
      sel.append(option(k));
    }
    sel.value = value;
    sel.addEventListener("change", () => {
      write(sel.value);
      edited();
    });
    return sel;
  };
  /** A requirement: another skill above a value, or none. */
  const requiresField = (
    idName: string,
    s: { requires?: { skill: string; above: number } | null | undefined },
  ) => {
    const box = document.createElement("div");
    box.className = "items-list-row";
    const on = document.createElement("label");
    on.className = "items-check";
    const check = action(document.createElement("input"), `${idName}-on`);
    check.type = "checkbox";
    check.checked = !!s.requires;
    on.append(check, " Needs another skill first");
    const fields = document.createElement("span");
    const drawFields = () => {
      fields.replaceChildren();
      if (!s.requires) {
        return;
      }
      const r = s.requires;
      fields.append(
        labelled(
          "Skill",
          skillSelect(`${idName}-skill`, r.skill, (k) => {
            r.skill = k;
          }),
        ),
        labelled(
          "Above",
          intField(`${idName}-above`, r.above, -1, 100, false, "Needs above", (n) => {
            r.above = n ?? 0;
          }),
        ),
      );
    };
    check.addEventListener("change", () => {
      if (check.checked) {
        s.requires = { skill: view?.keys[0] ?? "", above: 0 };
      } else {
        delete s.requires;
      }
      drawFields();
      edited();
    });
    drawFields();
    box.append(on, fields);
    return box;
  };

  /** The settings a source's own entry holds (created on first use). */
  const ownOn = () => {
    const p = work.progression;
    if (!p) {
      return null;
    }
    p.on ??= {};
    return p.on as Partial<Record<SkillSource, ChanceSettings | XpSettings | false>>;
  };

  const drawSource = (src: (typeof SOURCES)[number]): HTMLElement => {
    const box = document.createElement("div");
    box.className = "items-list-editor";
    box.dataset.source = src.id;
    const model = work.progression?.model ?? "chance";
    const own = work.progression?.on?.[src.id as keyof NonNullable<SkillProgression["on"]>];
    const mode = action(document.createElement("select"), "skills-source-mode");
    mode.append(
      option("default", "The world's default"),
      option("own", "Its own settings"),
      option("off", "Off: never trains from this"),
    );
    mode.value = own === false ? "off" : own === undefined ? "default" : "own";
    const p = view?.progression;
    const def = p ? (model === "chance" ? p.defaults.chance : p.defaults.xp)[src.id] : undefined;
    const defText = document.createElement("p");
    defText.className = "control-panel-field-help";
    defText.textContent =
      def === undefined || def === false
        ? "The world's default: it does not train from this."
        : `The world's default: ${JSON.stringify(def)}`;
    const body = document.createElement("div");
    const drawBody = () => {
      body.replaceChildren();
      // Read only: drawing never changes the form (`ownOn` makes `on` when a source is set).
      const s = (
        work.progression?.on as
          | Partial<Record<SkillSource, ChanceSettings | XpSettings | false>>
          | undefined
      )?.[src.id];
      if (!s) {
        return;
      }
      if (model === "chance") {
        const c = s as ChanceSettings;
        const rows = formulaRows(c.roll);
        body.append(
          formulaEditor(
            "skills-roll",
            `${src.label}: roll (random(n) = 1 advances)`,
            rows,
            invalid,
            (r) => {
              const f = rowsFormula(r);
              if (f === undefined) {
                delete c.roll;
              } else {
                c.roll = f;
              }
              edited();
            },
          ),
          labelled(
            "Cap",
            capField("skills-cap", c.cap, `${src.label} cap`, (v) => {
              if (v === undefined) {
                delete c.cap;
              } else {
                c.cap = v;
              }
            }),
            "It rises only below this: a number, faction (the faction perk's skill cap) or mage (its mage cap). Empty: 100.",
          ),
          requiresField("skills-requires", c),
        );
        if (src.id === "kill") {
          const l = document.createElement("label");
          l.className = "items-check";
          const b = action(document.createElement("input"), "skills-monster-cap");
          b.type = "checkbox";
          b.checked = c.monsterCap === true;
          b.addEventListener("change", () => {
            if (b.checked) {
              c.monsterCap = true;
            } else {
              delete c.monsterCap;
            }
            edited();
          });
          l.append(b, " Also below the killed monster's skill cap");
          body.append(l);
        }
        if (src.id === "gather" || src.id === "craft") {
          body.append(
            labelled(
              "Minimum",
              intField("skills-min", c.min ?? null, 0, 100, true, `${src.label} minimum`, (n) => {
                if (n === null) {
                  delete c.min;
                } else {
                  c.min = n;
                }
              }),
              "The lowest value that rolls (empty: 0). Other sources need the skill above 0.",
            ),
          );
        }
      } else {
        const x = s as XpSettings;
        body.append(
          formulaEditor(
            "skills-xp",
            `${src.label}: XP per action`,
            formulaRows(x.xp),
            invalid,
            (r) => {
              const f = rowsFormula(r);
              if (f === undefined) {
                delete x.xp;
              } else {
                x.xp = f;
              }
              edited();
            },
          ),
          requiresField("skills-requires", x),
        );
      }
    };
    mode.addEventListener("change", () => {
      if (!work.progression) {
        work.progression = { model: "chance" };
      }
      const on = ownOn();
      if (!on) {
        return;
      }
      if (mode.value === "default") {
        delete on[src.id];
      } else if (mode.value === "off") {
        on[src.id] = false;
      } else {
        on[src.id] = structuredClone(def || {}) as ChanceSettings;
      }
      if (Object.keys(on).length === 0 && work.progression) {
        delete work.progression.on;
      }
      for (const k of [...invalid.keys()]) {
        if (!k.isConnected) {
          invalid.delete(k);
        }
      }
      drawBody();
      edited();
    });
    drawBody();
    const h = document.createElement("p");
    h.className = "items-list-title";
    h.textContent = `${src.label}: ${src.help}`;
    box.append(h, labelled("Settings", mode), defText, body);
    return box;
  };

  const curveEditor = (): HTMLElement => {
    const box = document.createElement("div");
    const prog = work.progression;
    if (prog?.model !== "xp") {
      return box;
    }
    const p = view?.progression;
    if (!work.curve || work.curve.name !== prog.curve) {
      const have = p?.curves[prog.curve];
      // An existing curve is only named until edited; a new name makes a new curve.
      curveEdit = have
        ? { edited: false, expect: view?.curveFingerprints[prog.curve] ?? null }
        : { edited: true, expect: null };
      work.curve = {
        name: prog.curve,
        curve: structuredClone(have ?? { counting: "perLevel", formula: 100 }),
      };
    }
    const c = work.curve.curve;
    const name = noAutofill(action(document.createElement("input"), "skills-curve-name"));
    name.value = prog.curve;
    name.setAttribute("list", curvesList.id);
    name.addEventListener("change", () => {
      const n = name.value.trim();
      if (n === "") {
        invalid.set(name, "Level curve: give it a name");
        edited();
        return;
      }
      invalid.delete(name);
      prog.curve = n;
      work.curve = null;
      drawForm();
      edited();
    });
    const counting = action(document.createElement("select"), "skills-curve-counting");
    counting.append(
      option("perLevel", "Per level: the XP from each level to the next"),
      option("total", "Total: the running XP that reaches the next level"),
    );
    counting.value = c.counting;
    counting.addEventListener("change", () => {
      curveEdit.edited = true;
      c.counting = counting.value as Curve["counting"];
      edited();
    });
    const table = noAutofill(action(document.createElement("input"), "skills-curve-table"));
    table.value = (c.table ?? []).join(", ");
    table.placeholder = "none";
    table.addEventListener("input", () => {
      const parts = table.value
        .split(",")
        .map((x) => x.trim())
        .filter((x) => x !== "");
      if (parts.every((x) => /^\d{1,13}$/.test(x))) {
        invalid.delete(table);
        if (parts.length === 0) {
          curveEdit.edited = true;
          delete c.table;
        } else {
          curveEdit.edited = true;
          c.table = parts.map(Number);
        }
      } else {
        invalid.set(table, "Level table: whole numbers, comma-separated");
      }
      edited();
    });
    const cap = intField("skills-curve-cap", c.cap ?? null, 1, 100, true, "Curve cap", (n) => {
      curveEdit.edited = true;
      if (n === null) {
        delete c.cap;
      } else {
        c.cap = n;
      }
    });
    const levelCap = capField("skills-level-cap", prog.cap, "Level cap", (v) => {
      if (v === undefined) {
        delete prog.cap;
      } else {
        prog.cap = v;
      }
    });
    const shared = shown?.curve?.sharedWith ?? [];
    box.append(
      labelled(
        "Level curve",
        name,
        shared.length > 0 && shown?.curve?.name === prog.curve
          ? `Shared with ${shared.join(", ")}: a change here changes theirs too.`
          : "The curve it levels by. A new name makes a new curve.",
      ),
      labelled("Counting", counting),
      labelled(
        "Level table",
        table,
        "What leaving each level takes, from level 0, comma-separated. Past the table, the formula below.",
      ),
      formulaEditor(
        "skills-curve-formula",
        "Past the table: the formula (reads only level)",
        formulaRows(c.formula),
        invalid,
        (r) => {
          const f = rowsFormula(r);
          if (f === undefined) {
            curveEdit.edited = true;
            delete c.formula;
          } else {
            curveEdit.edited = true;
            c.formula = f;
          }
          edited();
        },
      ),
      labelled("Curve's highest level", cap, "Empty: 100."),
      labelled("Its level cap", levelCap, "A number, faction or mage; empty: none."),
    );
    return box;
  };

  const trainerLink = (t: SkillTrainer): HTMLElement => {
    const li = document.createElement("li");
    const b = action(document.createElement("button"), "skills-trainer");
    b.type = "button";
    b.className = "control-panel-link";
    b.textContent = t.text;
    b.addEventListener("click", () => {
      if (t.page === "items" && t.item) {
        actions.openItem(t.item);
      } else if (t.page === "gathering") {
        actions.openGathering(t.node);
      } else if (t.row) {
        actions.openContentRow(t.row);
      } else {
        actions.openContent();
      }
    });
    li.append(b);
    return li;
  };

  // The previews.
  const previewBox = document.createElement("div");
  const previewOut = document.createElement("div");
  previewOut.className = "skills-preview";
  const drawPreview = () => {
    previewOut.replaceChildren();
    if (!shown || !view) {
      return;
    }
    const ctx: PreviewContext = {
      stats: {
        level: preview.level,
        str: preview.str,
        sta: preview.sta,
        int: preview.int,
        wis: preview.wis,
        dex: preview.dex,
      },
      tables: view.progression.tables,
      otherSkills: preview.otherSkills,
      tier: preview.tier,
      caps: view.caps,
      damage: preview.damage,
      monsterCap: preview.monsterCap,
    };
    const prog = work.progression ?? undefined;
    const s = sourceSettings(view.progression, prog, preview.source);
    const table = document.createElement("table");
    table.className = "control-panel-table";
    const head = document.createElement("tr");
    const body = document.createElement("tbody");
    const cell = (tag: "td" | "th", text: string) => {
      const c = document.createElement(tag);
      c.textContent = text;
      return c;
    };
    if (!s && prog?.model !== "xp") {
      previewOut.textContent = "It does not train from this source.";
      return;
    }
    if (prog?.model === "xp") {
      const curve = work.curve?.curve ?? view.progression.curves[prog.curve];
      if (!curve) {
        previewOut.textContent = "Its curve is missing.";
        return;
      }
      table.setAttribute("aria-label", "XP to reach each level");
      head.append(
        cell("th", "Level"),
        cell("th", "XP to reach it"),
        cell("th", "XP to the next"),
        cell("th", "XP an action"),
        cell("th", "Actions"),
      );
      // The level table shows whether or not this source gives XP (none: 0 an action).
      const rows = xpPreview(
        shown.skill,
        curve,
        previewCap(prog.cap, ctx),
        s as XpSettings | undefined,
        ctx,
      );
      for (const r of rows) {
        const tr = document.createElement("tr");
        tr.append(
          cell("td", String(r.level)),
          cell("td", formatXp(r.total)),
          cell("td", r.need === null ? "—" : formatXp(r.need)),
          cell("td", `${Number(r.perAction.toFixed(2))}${r.estimate ? " (mean)" : ""}`),
          cell(
            "td",
            r.actions === null
              ? "—"
              : `${r.estimate ? "about " : ""}${r.actions.toLocaleString("en-US")}`,
          ),
        );
        body.append(tr);
      }
    } else {
      table.setAttribute("aria-label", "Chance to advance at each value");
      head.append(cell("th", "Value"), cell("th", "Chance an action raises it"));
      for (const r of chancePreview(shown.skill, preview.source, s as ChanceSettings, ctx)) {
        const tr = document.createElement("tr");
        tr.append(cell("td", String(r.value)), cell("td", r.why ?? chanceText(r.chance)));
        body.append(tr);
      }
    }
    const thead = document.createElement("thead");
    thead.append(head);
    table.append(thead, body);
    const wrap = document.createElement("div");
    wrap.className = "control-panel-table-wrap skills-preview-table";
    wrap.append(table);
    previewOut.append(wrap);
  };
  /** The killed monster's skill cap, for a kill whose settings test it (empty: none). */
  const monsterCapInput = () => {
    const input = noAutofill(action(document.createElement("input"), "skills-preview-monster-cap"));
    input.type = "number";
    input.min = "0";
    input.max = "100";
    input.placeholder = "none";
    input.value = preview.monsterCap === null ? "" : String(preview.monsterCap);
    input.addEventListener("input", () => {
      const t = input.value.trim();
      const n = Number(t);
      if (t === "") {
        preview.monsterCap = null;
      } else if (Number.isInteger(n) && n >= 0) {
        preview.monsterCap = n;
      } else {
        return;
      }
      drawPreview();
    });
    return labelled("Killed monster's cap", input);
  };
  const previewInputs = () => {
    const src = action(document.createElement("select"), "skills-preview-source");
    for (const x of SOURCES) {
      src.append(option(x.id, x.label));
    }
    src.value = preview.source;
    src.addEventListener("change", () => {
      preview.source = src.value as SkillSource;
      drawPreview();
    });
    const num = (
      key: Exclude<keyof typeof preview, "source" | "monsterCap">,
      label: string,
      max: number,
    ) => {
      const input = noAutofill(action(document.createElement("input"), "skills-preview-input"));
      input.type = "number";
      input.min = "0";
      input.max = String(max);
      input.value = String(preview[key]);
      input.addEventListener("input", () => {
        const n = Number(input.value);
        if (Number.isInteger(n) && n >= 0 && n <= max) {
          preview[key] = n;
          drawPreview();
        }
      });
      return labelled(label, input);
    };
    const row = document.createElement("div");
    row.className = "items-list-row";
    row.append(
      labelled("Source", src),
      num("level", "Level", 1000),
      num("str", "Strength", 1000),
      num("sta", "Stamina", 1000),
      num("int", "Intelligence", 1000),
      num("wis", "Wisdom", 1000),
      num("dex", "Dexterity", 1000),
      num("otherSkills", "Other skills at", 100),
      num("tier", "Tool tier", 1000),
      num("damage", "A hit's damage", 1_000_000),
      monsterCapInput(),
    );
    previewBox.replaceChildren(
      row,
      Object.assign(document.createElement("p"), {
        className: "control-panel-field-help",
        textContent:
          "Worked out by the game's own rules from the form as it is now, unsaved edits included. A faction or mage cap reads an unaffiliated character's; the requirement reads the other skills' value.",
      }),
      previewOut,
    );
  };

  const drawForm = () => {
    const v = shown;
    if (!v || !view) {
      groups.replaceChildren();
      return;
    }
    // Name and place.
    const display = noAutofill(action(document.createElement("input"), "skills-display"));
    display.maxLength = 40;
    display.value = work.display;
    display.addEventListener("input", () => {
      work.display = display.value.trim();
      edited();
    });
    const hiddenLabel = document.createElement("label");
    hiddenLabel.className = "items-check";
    const hidden = action(document.createElement("input"), "skills-hidden");
    hidden.type = "checkbox";
    hidden.checked = work.hidden;
    hidden.addEventListener("change", () => {
      work.hidden = hidden.checked;
      edited();
    });
    hiddenLabel.append(hidden, " Hidden: kept off the Skills page (it still rises and works)");
    const order = intField(
      "skills-order",
      work.order,
      1,
      view.skills.length,
      false,
      "Place",
      (n) => {
        work.order = n ?? 1;
      },
    );
    // Who starts with it.
    const starts = document.createElement("div");
    starts.className = "items-list-row";
    for (const s of v.starts) {
      starts.append(
        labelled(
          s.label,
          intField(
            "skills-start",
            work.starts[String(s.code)] ?? null,
            0,
            100,
            true,
            `${s.label}'s start`,
            (n) => {
              work.starts[String(s.code)] = n;
            },
          ),
        ),
      );
    }
    const grants = document.createElement("div");
    grants.className = "items-checks";
    for (const p of v.promotions) {
      const l = document.createElement("label");
      l.className = "items-check";
      const b = action(document.createElement("input"), "skills-grant");
      b.type = "checkbox";
      b.checked = work.grants.includes(p.code);
      b.addEventListener("change", () => {
        work.grants = b.checked
          ? [...work.grants, p.code].sort((a, c) => a - c)
          : work.grants.filter((c) => c !== p.code);
        edited();
      });
      l.append(b, ` ${p.name}`);
      grants.append(l);
    }
    // Progression.
    const model = action(document.createElement("select"), "skills-model");
    model.append(
      option("chance", "Chance to advance by one (1.6's)"),
      option("xp", "XP against a level curve"),
    );
    model.value = work.progression?.model ?? "chance";
    model.addEventListener("change", () => {
      if (model.value === "xp") {
        const curve =
          Object.keys(view?.progression.curves ?? {})[0] ??
          v.skill.toLowerCase().replace(/\s+/g, "-");
        work.progression = { model: "xp", curve };
      } else {
        work.progression = null;
        work.curve = null;
      }
      drawForm();
      edited();
    });
    const sources = document.createElement("div");
    for (const src of SOURCES) {
      sources.append(drawSource(src));
    }
    // What trains it.
    const trains = document.createElement("ul");
    trains.className = "items-sources";
    trains.append(...v.trains.map(trainerLink));
    if (v.trains.length === 0) {
      const li = document.createElement("li");
      li.textContent = "Nothing trains or reads it yet.";
      trains.append(li);
    }
    previewInputs();
    groups.replaceChildren(
      section(
        "Name and place",
        labelled("Display name", display, `What players see; empty shows its key (${v.skill}).`),
        hiddenLabel,
        labelled("Place on the Skills page", order, `1 is first; there are ${view.skills.length}.`),
      ),
      section(
        "Who starts with it",
        labelled(
          "Start values",
          starts,
          "Each start class's value (empty: 1, as for any skill a class does not set).",
        ),
        labelled(
          "Promotions that grant it",
          grants,
          "A promotion raises it to a roll of 1-10 if it is below.",
        ),
      ),
      section("Progression", labelled("Model", model), curveEditor(), sources),
      section(
        "What trains it",
        Object.assign(document.createElement("p"), {
          className: "control-panel-field-help",
          textContent: "Set where each one lives: open it to change it.",
        }),
        trains,
        ...(v.bindings.length > 0
          ? [
              Object.assign(document.createElement("p"), {
                className: "control-panel-field-help",
                textContent: `The ${v.bindings.join(", ")} binding${v.bindings.length === 1 ? " names" : "s name"} it, so it cannot be removed.`,
              }),
            ]
          : []),
      ),
      section("Preview", previewBox),
    );
    drawPreview();
  };
  const draw = () => {
    if (!shown) {
      return;
    }
    title.textContent = shown.row.display ? `${shown.row.display} (${shown.skill})` : shown.skill;
    tags.textContent = [
      shown.row.progression?.model === "xp" ? "XP model" : "chance model",
      shown.row.hidden ? "hidden" : "",
      shown.inPack ? "" : "yours",
      shown.pending ? "changed in the draft" : "",
      shown.published ? "" : "only in the draft",
    ]
      .filter((x) => x !== "")
      .join(" · ");
    noticeLine.hidden = !shown.notice;
    noticeLine.textContent = shown.notice?.note ?? "";
    drawForm();
    update();
  };

  const drawList = () => {
    const words = search.value
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w !== "");
    const rows = list.filter((s) =>
      words.every((w) => `${s.display} ${s.skill}`.toLowerCase().includes(w)),
    );
    listCount.textContent = `${rows.length} of ${list.length} skills, in Skills-page order`;
    listEl.replaceChildren(
      ...rows.map((s) => {
        const li = document.createElement("li");
        const b = action(document.createElement("button"), "skills-open");
        b.type = "button";
        b.className = "items-list-item";
        b.dataset.skill = s.skill;
        if (openKey && s.skill.toLowerCase() === openKey.toLowerCase()) {
          b.setAttribute("aria-current", "true");
        }
        const name = document.createElement("span");
        name.textContent = s.display === s.skill ? s.skill : `${s.display} (${s.skill})`;
        const meta = document.createElement("span");
        meta.className = "items-list-meta";
        meta.textContent = [
          s.model === "xp" ? "XP" : "chance",
          s.hidden ? "hidden" : "",
          s.state === "yours" ? "yours" : s.state === "edited" ? "changed" : "",
          s.pending ? "in the draft" : "",
        ]
          .filter((x) => x !== "")
          .join(" · ");
        b.append(name, " ", meta);
        b.addEventListener("click", () => openSkill(s.skill));
        li.append(b);
        return li;
      }),
    );
  };
  search.addEventListener("input", drawList);

  const openSkill = (key: string) => {
    if (shown && (dirty() || busy)) {
      say(
        status,
        busy
          ? "Wait for the save to finish."
          : `${shown.row.display ?? shown.skill} has unsaved changes: save them or drop your edit first.`,
        false,
      );
      return;
    }
    openKey = key;
    shown = null;
    form.hidden = true;
    removal.hidden = true;
    usage = null;
    status.textContent = "";
    drawList();
    ask();
  };

  const drawUsage = (u: ContentSkillUsage) => {
    usage = u;
    removalChoices.clear();
    const lines: HTMLElement[] = [];
    const head = document.createElement("p");
    head.className = "control-panel-field-help";
    head.textContent = `${u.characters} character${u.characters === 1 ? " has" : "s have"} a value of it stored. They keep it: if the skill returns, so do their values.`;
    lines.push(head);
    if (u.bindings.length > 0) {
      const b = document.createElement("p");
      b.className = "balance-stale";
      b.textContent = `The ${u.bindings.join(", ")} binding${u.bindings.length === 1 ? " names" : "s name"} it: point ${u.bindings.length === 1 ? "it" : "them"} at another skill first (the Content page's bindings).`;
      lines.push(b);
    }
    const ul = document.createElement("ul");
    ul.className = "items-sources";
    for (const use of u.uses) {
      const li = document.createElement("li");
      li.className = "items-list-row";
      const choice: SkillRemovalChoice = use.clearable
        ? { id: use.id, action: "clear" }
        : { id: use.id, action: "replace" };
      removalChoices.set(use.id, choice);
      const sel = action(document.createElement("select"), "skills-remove-action");
      if (use.clearable) {
        sel.append(option("clear", `Clear it: ${use.clears}`));
      }
      sel.append(option("replace", "Point it at another skill"));
      sel.value = choice.action;
      const to = action(document.createElement("select"), "skills-remove-to");
      to.append(option("", "pick a skill"));
      for (const k of view?.keys ?? []) {
        if (k !== u.skill) {
          to.append(option(k));
        }
      }
      to.hidden = choice.action !== "replace";
      sel.addEventListener("change", () => {
        choice.action = sel.value as SkillRemovalChoice["action"];
        to.hidden = choice.action !== "replace";
      });
      to.addEventListener("change", () => {
        if (to.value) {
          choice.to = to.value;
        } else {
          delete choice.to;
        }
      });
      const where = document.createElement("span");
      where.textContent = use.where;
      li.append(where, sel, to);
      ul.append(li);
    }
    if (u.uses.length === 0) {
      const li = document.createElement("li");
      li.textContent = "Nothing in content names it.";
      ul.append(li);
    }
    lines.push(ul);
    removalBody.replaceChildren(...lines);
    removeGo.disabled = u.bindings.length > 0;
    removalStatus.textContent = "";
  };

  const show = (v: ContentSkillsView) => {
    loading.hidden = true;
    view = v;
    list = v.skills;
    curvesList.replaceChildren(...Object.keys(v.progression.curves).map((c) => option(c)));
    drawList();
    const total = v.skillDraft + v.otherDraft;
    draftLine.hidden = total === 0;
    draftText.textContent =
      total === 0
        ? ""
        : `The draft holds ${v.skillDraft === 1 ? "1 change to classes and skills" : `${v.skillDraft} changes to classes and skills`}${v.otherDraft > 0 ? ` and ${v.otherDraft} other ${v.otherDraft === 1 ? "change" : "changes"}` : ""}, live once published. `;
    if (!openKey) {
      return;
    }
    const s = v.skill;
    if (!s || s.skill.toLowerCase() !== openKey.toLowerCase()) {
      if (shown && !v.skills.some((x) => x.skill.toLowerCase() === openKey?.toLowerCase())) {
        shown = null;
        form.hidden = true;
        openKey = null;
      }
      return;
    }
    const first = shown === null || shown.skill !== s.skill;
    shown = s;
    form.hidden = false;
    if (first || (!busy && !dirty())) {
      fill();
    }
    draw();
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
      if (msg.t === "contentSkillUsage") {
        if (msg.seq === usageAsked) {
          if (msg.usage) {
            drawUsage(msg.usage);
          } else {
            say(removalStatus, msg.error ?? "It cannot be said.", false);
          }
        }
        return;
      }
      const newer = msg.seq >= appliedSeq;
      if (removing.has(msg.seq)) {
        removing.delete(msg.seq);
        if (msg.result) {
          say(removalStatus, problemText(msg.result), msg.result.ok);
          if (msg.result.ok) {
            removal.hidden = true;
            usage = null;
            say(status, msg.result.text);
            shown = null;
            openKey = null;
            form.hidden = true;
          }
        }
        if (newer) {
          appliedSeq = msg.seq;
          show(msg.view);
        }
        return;
      }
      const save = saving.get(msg.seq);
      if (save) {
        saving.delete(msg.seq);
        if (save.create) {
          createBtn.disabled = false;
          say(newStatus, msg.result ? problemText(msg.result) : "", msg.result?.ok ?? false);
          if (msg.result?.ok && !(shown && (dirty() || busy))) {
            newKey.value = "";
            newDisplay.value = "";
            newCurve.value = "";
            openKey = save.key;
            shown = null;
          }
          if (msg.result?.ok) {
            // Ask with the new skill open.
            seq += 1;
            appliedSeq = msg.seq;
            show(msg.view);
            actions.view(seq, openKey ?? undefined);
            return;
          }
        } else {
          busy = false;
          if (msg.result) {
            say(status, msg.result.ok ? msg.result.text : problemText(msg.result), msg.result.ok);
            if (msg.result.ok && newer && msg.view.skill && msg.view.skill.skill === shown?.skill) {
              shown = msg.view.skill;
              fill();
            }
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
      removing.clear();
      view = null;
      list = [];
      openKey = null;
      shown = null;
      busy = false;
      invalid.clear();
      usage = null;
      search.value = "";
      newKey.value = "";
      newDisplay.value = "";
      newCurve.value = "";
      newStatus.textContent = "";
      createBtn.disabled = false;
      status.textContent = "";
      listEl.replaceChildren();
      groups.replaceChildren();
      form.hidden = true;
      removal.hidden = true;
      loading.hidden = false;
      draftLine.hidden = true;
    },
    open(key) {
      openSkill(key);
    },
  };
}
