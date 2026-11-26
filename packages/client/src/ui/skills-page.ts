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
  CurveGrowth,
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
  op: "set" | "create" | "discard" | "revert";
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
  {
    id: "kill",
    label: "Killing a monster",
    help: "When a player kills a monster with a weapon that uses this skill.",
  },
  {
    id: "shot",
    label: "Shooting arrows",
    help: "Each arrow fired. Only the archery skill trains this way (and martial arts, with a crossbow).",
  },
  {
    id: "defend",
    label: "Being attacked",
    help: "Each time the player is struck. Only the parry and block skills train this way.",
  },
  {
    id: "cast",
    label: "Casting spells",
    help: "Each spell cast. Trains the magery skill and the spell's own school.",
  },
  {
    id: "gather",
    label: "Gathering",
    help: "Each successful harvest at a gathering spot that uses this skill, and each catch for the fishing skill.",
  },
  {
    id: "craft",
    label: "Crafting",
    help: "Each item made with the crafting skill for that kind of recipe.",
  },
  {
    id: "hit",
    label: "Landing a hit",
    help: "Each hit that does damage with a weapon (or spell school) that uses this skill.",
  },
];

const OPS: FormulaRow["op"][] = ["set", "add", "subtract", "multiply"];
/** What each formula step does, as the form says it. */
const OP_TEXT: Record<FormulaRow["op"], string> = {
  set: "Set to",
  add: "Add",
  subtract: "Subtract",
  multiply: "Multiply by",
};
const OP_SIGN: Record<FormulaRow["op"], string> = {
  set: "",
  add: "+",
  subtract: "−",
  multiply: "×",
};

/** A formula in words: `skill + wisdomBonus`, `100`, `level × 50 (if level > 10)`. */
export function formulaText(f: Formula | undefined): string {
  if (f === undefined) {
    return "0";
  }
  if (typeof f === "number") {
    return String(f);
  }
  const parts = f.map((r, i) => {
    const when = r.when?.length ? ` (if ${r.when.join(" and ")})` : "";
    const head = r.op === "set" ? (i === 0 ? "" : "then ") : `${OP_SIGN[r.op]} `;
    return `${head}${r.value}${when}`;
  });
  return parts.join(" ") || "0";
}

/** A cap in words: `100`, `the faction cap`. */
function capText(cap: ChanceSettings["cap"], none: string): string {
  return cap === undefined
    ? none
    : cap === "faction"
      ? "the faction cap"
      : cap === "mage"
        ? "the mage cap"
        : String(cap);
}

/** What a source's settings do, in a sentence (a world default, shown under "Normal rule"). */
export function settingsText(
  model: "chance" | "xp",
  s: ChanceSettings | XpSettings | false | undefined,
): string {
  if (s === undefined || s === false) {
    return "Normally it doesn't go up this way.";
  }
  const req = s.requires ? `; only once ${s.requires.skill} is above ${s.requires.above}` : "";
  if (model === "xp") {
    return `Normally it earns ${formulaText((s as XpSettings).xp)} XP each time${req}.`;
  }
  const c = s as ChanceSettings;
  return `Normally a 1 in (${formulaText(c.roll)}) chance to go up each time; it stops at ${capText(c.cap, "100")}${c.monsterCap ? " and at the killed monster's skill cap" : ""}${c.min !== undefined ? `; it can rise from ${c.min}` : ""}${req}.`;
}

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
 * A formula editor: one line per step (when it applies, what it does, its value), with add and
 * remove. `errors` collects steps that do not read; `changed` runs on every edit with the rows.
 */
export function formulaEditor(
  idPrefix: string,
  label: string,
  rows: FormulaRow[],
  errors: Map<HTMLElement, string>,
  changed: (rows: FormulaRow[]) => void,
  help = "",
): HTMLElement {
  const box = document.createElement("div");
  box.className = "items-list-editor skills-formula";
  const title = document.createElement("p");
  title.className = "items-list-title";
  title.textContent = label;
  const list = document.createElement("div");
  const sum = document.createElement("p");
  sum.className = "control-panel-field-help skills-formula-sum";
  const say = () => {
    sum.textContent = `Works out as: ${formulaText(rowsFormula(rows))}`;
  };
  const guide = document.createElement("details");
  guide.className = "items-more-picks";
  const guideSummary = action(document.createElement("summary"), `${idPrefix}-guide`);
  guideSummary.textContent = "What can I type?";
  const guideText = document.createElement("p");
  guideText.className = "control-panel-field-help";
  guideText.textContent =
    "The steps work top to bottom, starting from 0. A value is a whole number, a dice roll like random(6) or 2 + random(6), or a name: skill (this skill's value), level, strength, stamina, intelligence, wisdom, dexterity, tier (the tool's tier), damage (on a hit), a stat table such as wisdomBonus, or another skill's ID. Only when: leave it empty to always apply, or write conditions like skill > 10 or strength < 5, separated by commas.";
  guide.append(guideSummary, guideText);
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
          op.append(option(o, OP_TEXT[o]));
        }
        op.value = row.op;
        const value = noAutofill(action(document.createElement("input"), `${idPrefix}-value`));
        value.value = String(row.value);
        const check = () => {
          const w = parseWhen(when.value);
          const v = parseValue(value.value);
          if (w === null) {
            errors.set(when, `${label}, step ${i + 1}: a condition looks like skill > 10`);
          } else {
            errors.delete(when);
            row.when = w.length > 0 ? w : undefined;
          }
          if (v === null) {
            errors.set(
              value,
              `${label}, step ${i + 1}: a value is a whole number, random(n) or a name`,
            );
          } else {
            errors.delete(value);
            row.value = v;
          }
          row.op = op.value as FormulaRow["op"];
          say();
          changed(rows);
        };
        when.addEventListener("input", check);
        value.addEventListener("input", check);
        op.addEventListener("change", check);
        line.append(
          labelled(i === 0 ? "Step" : "Then", op),
          labelled("Value", value),
          labelled("Only when", when),
          panelButton(`${idPrefix}-remove`, "Remove", () => {
            errors.delete(when);
            errors.delete(value);
            rows.splice(i, 1);
            draw();
            say();
            changed(rows);
          }),
        );
        return line;
      }),
    );
  };
  draw();
  say();
  box.append(title);
  if (help) {
    const h = document.createElement("p");
    h.className = "control-panel-field-help";
    h.textContent = help;
    box.append(h);
  }
  box.append(
    list,
    sum,
    panelButton(`${idPrefix}-add`, "+ Add a step", () => {
      rows.push({ op: rows.length === 0 ? "set" : "add", value: rows.length === 0 ? "skill" : 1 });
      draw();
      say();
      changed(rows);
    }),
    guide,
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

/** The form fields each tab holds ("Restore this tab to the original" puts these back). */
const TAB_FIELDS: Record<string, readonly (keyof ReturnType<typeof formOf>)[]> = {
  basics: ["display", "hidden", "order"],
  starts: ["starts", "grants"],
  rises: ["progression", "curve"],
};

/** The pack's form as the parts of a skill's view `formOf` reads. */
function packViewOf(pack: NonNullable<ContentSkillView["pack"]>): Pick<
  ContentSkillView,
  "row" | "order" | "starts" | "promotions" | "curve"
> & {
  promotions: ContentSkillView["promotions"];
} {
  return {
    row: {
      skill: "",
      ...(pack.display ? { display: pack.display } : {}),
      ...(pack.hidden ? { hidden: true } : {}),
      ...(pack.progression ? { progression: pack.progression } : {}),
    } as ContentSkillView["row"],
    order: pack.order,
    starts: Object.entries(pack.starts).map(([code, value]) => ({
      code: Number(code),
      label: "",
      value,
    })),
    promotions: pack.grants.map((code) => ({ code, name: "", grants: true })),
    curve: pack.curve ? { ...pack.curve, sharedWith: [] } : null,
  };
}

export function createSkillsPage(actions: SkillsPageActions): SkillsPage {
  const el = document.createElement("div");
  el.className = "skills-page items-page balance-page plain-editor";
  el.append(
    pageHeading(
      "Skills",
      "Pick a skill to change its name, who starts with it and how fast it goes up. Saving puts your changes with the other unpublished changes: players get them once you publish them on the Publish Changes page.",
    ),
  );
  const draftLine = document.createElement("div");
  draftLine.className = "balance-draft";
  draftLine.hidden = true;
  const draftText = document.createElement("span");
  draftLine.append(
    draftText,
    panelButton("skills-open-content", "Review and publish…", () => actions.openContent()),
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
  /** A help line under a tab's title: what the tab is for. */
  const intro = (text: string) => {
    const p = document.createElement("p");
    p.className = "items-intro";
    p.textContent = text;
    return p;
  };
  const helpLine = (text: string) => {
    const p = document.createElement("p");
    p.className = "control-panel-field-help";
    p.textContent = text;
    return p;
  };
  /** Fields folded under a summary ("More options"), open when one of them is in use. */
  const more = (open: boolean, text: string, ...controls: HTMLElement[]) => {
    const box = document.createElement("details");
    box.className = "items-more";
    box.open = open;
    const summary = action(document.createElement("summary"), "skills-more-toggle");
    summary.textContent = text;
    box.append(summary, ...controls);
    return box;
  };

  // ---- a new skill ----
  const newBox = document.createElement("details");
  newBox.className = "items-new";
  const newSummary = action(document.createElement("summary"), "skills-new-toggle");
  newSummary.textContent = "+ New skill";
  const newKey = noAutofill(action(document.createElement("input"), "skills-new-key"));
  newKey.maxLength = 40;
  const newDisplay = noAutofill(action(document.createElement("input"), "skills-new-display"));
  newDisplay.maxLength = 40;
  const newModel = action(document.createElement("select"), "skills-new-model");
  newModel.append(
    option("chance", "A chance to go up by one each time (like 1.6)"),
    option("xp", "Earns XP and goes up in levels"),
  );
  const newCurve = noAutofill(action(document.createElement("input"), "skills-new-curve"));
  newCurve.placeholder = "a new curve, named after the skill";
  const curvesList = document.createElement("datalist");
  curvesList.id = "skills-curves";
  newCurve.setAttribute("list", curvesList.id);
  const newStatus = statusLine();
  const createBtn = panelButton(
    "skills-create",
    "Create skill",
    () => {
      const key = newKey.value.trim();
      if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(key)) {
        say(
          newStatus,
          "The ID is one word: letters, digits and _, starting with a letter (no spaces).",
          false,
        );
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
  const newCurveField = labelled(
    "Level curve",
    newCurve,
    "Skills on the same curve need the same XP for each level. Pick one, or leave it empty for a new curve of 100 XP a level.",
  );
  const showNewCurve = () => {
    newCurveField.hidden = newModel.value !== "xp";
  };
  newModel.addEventListener("change", showNewCurve);
  showNewCurve();
  newBox.append(
    newSummary,
    labelled(
      "ID",
      newKey,
      "One word, like Climbing. Players' values are stored under it, so it can't change later.",
    ),
    labelled("Name players see (optional)", newDisplay, "Leave it empty to show the ID."),
    labelled("How it goes up", newModel),
    newCurveField,
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
  const filters = document.createElement("div");
  filters.className = "items-filters";
  filters.append(labelled("Search", search));
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
  const stale = document.createElement("p");
  stale.className = "balance-stale skills-stale";
  stale.hidden = true;
  stale.textContent =
    "Someone changed this skill while you were editing it, so saving will be refused. Undo your changes to see theirs.";
  const groups = document.createElement("div");
  const status = statusLine();
  const saveBtn = panelButton(
    "skills-save",
    "Save changes",
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
  const undoBtn = panelButton("skills-undo-edit", "Undo changes", () => {
    fill();
    status.textContent = "";
    update();
  });
  const revertBtn = panelButton("skills-revert", "Restore the original", () => {
    if (shown) {
      send({ key: shown.skill, op: "revert", expect: shown.fingerprint });
    }
  });
  revertBtn.title =
    "Puts its name, starting values and how it goes up back to the pack's once published.";
  const dropBtn = panelButton("skills-discard", "Cancel unpublished changes", () => {
    if (shown) {
      send({ key: shown.skill, op: "discard", expect: shown.fingerprint });
    }
  });
  const removeBtn = panelButton(
    "skills-remove",
    "Remove this skill…",
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
  const removeBox = document.createElement("div");
  removeBox.className = "items-remove";
  removeBox.append(
    removeBtn,
    helpLine("Shows everything that uses it first, so you can clear or move each one."),
  );
  const mainButtons = document.createElement("div");
  mainButtons.className = "content-buttons";
  mainButtons.append(saveBtn, undoBtn);
  const resetButtons = document.createElement("div");
  resetButtons.className = "content-buttons items-reset-buttons";
  resetButtons.append(revertBtn, dropBtn);
  const buttons = document.createElement("div");
  buttons.className = "items-actions";
  buttons.append(mainButtons, resetButtons);

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
    "Remove the skill",
    () => {
      if (!usage || !shown) {
        return;
      }
      const choices = [...removalChoices.values()];
      if (choices.some((c) => c.action === "replace" && !c.to)) {
        say(removalStatus, "Pick the skill each moved use goes to.", false);
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
  const removalButtons = document.createElement("div");
  removalButtons.className = "content-buttons";
  removalButtons.append(removeGo, removeCancel);
  removal.append(
    removalTitle,
    intro(
      "Everything that uses this skill is listed below: choose whether each one forgets it or uses another skill instead. The removal is an unpublished change until you publish.",
    ),
    removalBody,
    removalButtons,
    removalStatus,
  );

  const tabs = sectionTabs(form, "skills");
  form.append(header, noticeLine, stale, tabs.el, groups, removal, formActions(buttons, status));
  const loading = document.createElement("p");
  loading.className = "balance-loading";
  loading.textContent = "Loading…";
  const layout = document.createElement("div");
  layout.className = "items-layout";
  const empty = document.createElement("p");
  empty.className = "items-empty-form";
  empty.textContent = "Pick a skill on the left to see and change how it works.";
  layout.append(listBox, empty, form);
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
    undoBtn.hidden = !d;
    undoBtn.disabled = busy;
    // A pack's skill that plays something else (in the draft) can go back to the pack's.
    revertBtn.hidden = !(shown?.pack && shown.differs);
    revertBtn.disabled = busy;
    dropBtn.hidden = !shown?.pending;
    dropBtn.title = shown?.published
      ? "Takes this skill's changes out of the draft: players keep what they have now."
      : "Takes this new skill out of the draft.";
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
  const section = (id: string, titleText: string, help: string, ...children: HTMLElement[]) => {
    const sec = document.createElement("section");
    sec.className = "balance-row items-group";
    sec.dataset.group = id;
    const h = document.createElement("h3");
    h.className = "balance-row-title";
    h.textContent = titleText;
    sec.append(h, intro(help), ...children);
    const pack = shown?.pack;
    const keys = TAB_FIELDS[id];
    if (pack && keys) {
      const foot = document.createElement("div");
      foot.className = "items-group-foot";
      const restore = panelButton(`skills-pack-${id}`, "Restore this tab to the original", () => {
        const from = formOf({ ...(shown as ContentSkillView), ...packViewOf(pack) });
        for (const k of keys) {
          (work as Record<string, unknown>)[k] = structuredClone(from[k]);
        }
        if (
          keys.includes("curve") &&
          canonical(work.curve) !== canonical(formOf(shown as ContentSkillView).curve)
        ) {
          curveEdit = {
            edited: work.curve !== null,
            expect: work.curve ? (view?.curveFingerprints[work.curve.name] ?? null) : null,
          };
        }
        drawForm();
        edited();
      });
      restore.classList.add("items-restore");
      foot.append(document.createElement("span"), restore);
      sec.append(foot);
    }
    return sec;
  };
  /** Marks the tabs that hold settings of the skill's own (a dot on the tab). */
  const markUsed = () => {
    const used: Record<string, boolean> = {
      basics: work.display !== "" || work.hidden,
      starts: Object.values(work.starts ?? {}).some((x) => x !== null) || work.grants.length > 0,
      rises: work.progression !== null,
    };
    const pack = shown?.pack;
    const original = pack && shown ? formOf({ ...shown, ...packViewOf(pack) }) : null;
    for (const sec of groups.querySelectorAll<HTMLElement>(":scope > .items-group")) {
      const u = String(used[sec.dataset.group ?? ""] === true);
      if (sec.dataset.used !== u) {
        sec.dataset.used = u;
      }
      const restore = sec.querySelector<HTMLButtonElement>(
        ":scope > .items-group-foot > .items-restore",
      );
      if (restore && original) {
        // Shown only where the form differs from what the pack plays.
        restore.hidden = (TAB_FIELDS[sec.dataset.group ?? ""] ?? []).every(
          (k) => canonical(work[k]) === canonical(original[k]),
        );
      }
    }
  };
  const edited = () => {
    status.textContent = "";
    // A redraw (a formula step removed, the model or a source switched) drops fields: what they
    // held is no longer the form's.
    for (const k of [...invalid.keys()]) {
      if (!k.isConnected) {
        invalid.delete(k);
      }
    }
    markUsed();
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
    empty = "not set",
  ) => {
    const input = noAutofill(action(document.createElement("input"), idName));
    input.type = "number";
    input.min = String(min);
    input.max = String(max);
    input.value = value === null ? "" : String(value);
    if (nullable) {
      input.placeholder = empty;
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
  /**
   * A cap: none, a number, or the faction or mage cap, picked from a list (a number shows its own
   * box). Saves as before: undefined, a number, `faction` or `mage`.
   */
  const capField = (
    idName: string,
    value: ChanceSettings["cap"],
    label: string,
    none: string,
    write: (c: ChanceSettings["cap"]) => void,
  ) => {
    const box = document.createElement("div");
    box.className = "items-range-pair skills-cap";
    const kind = action(document.createElement("select"), `${idName}-kind`);
    kind.append(
      option("none", none),
      option("number", "A number…"),
      option("faction", `The faction cap (${view?.caps.faction ?? "?"} unless a perk changes it)`),
      option("mage", `The mage cap (${view?.caps.mage ?? "?"} unless a perk changes it)`),
    );
    kind.value =
      value === undefined ? "none" : value === "faction" || value === "mage" ? value : "number";
    kind.setAttribute("aria-label", label);
    const n = noAutofill(action(document.createElement("input"), idName));
    n.type = "number";
    n.min = "0";
    n.max = "100";
    n.value = typeof value === "number" ? String(value) : "";
    n.setAttribute("aria-label", `${label}: the number`);
    const show = () => {
      n.hidden = kind.value !== "number";
    };
    const read = () => {
      invalid.delete(n);
      if (kind.value === "none") {
        write(undefined);
      } else if (kind.value === "faction" || kind.value === "mage") {
        write(kind.value);
      } else {
        const t = n.value.trim();
        if (/^\d+$/.test(t) && Number(t) <= 100) {
          write(Number(t));
        } else {
          invalid.set(n, `${label}: a whole number from 0 to 100`);
        }
      }
      edited();
    };
    kind.addEventListener("change", () => {
      if (kind.value === "number" && n.value.trim() === "") {
        n.value = "100";
      }
      show();
      read();
    });
    n.addEventListener("input", read);
    show();
    box.append(kind, n);
    return box;
  };
  const skillSelect = (idName: string, value: string, write: (s: string) => void) => {
    const sel = action(document.createElement("select"), idName);
    for (const k of view?.keys ?? []) {
      const s = view?.skills.find((x) => x.skill === k);
      sel.append(option(k, s && s.display !== k ? `${s.display} (${k})` : k));
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
    box.className = "skills-requires";
    const on = document.createElement("label");
    on.className = "items-check";
    const check = action(document.createElement("input"), `${idName}-on`);
    check.type = "checkbox";
    check.checked = !!s.requires;
    on.append(check, " Only once another skill is high enough");
    const fields = document.createElement("span");
    fields.className = "items-list-row";
    const drawFields = () => {
      fields.replaceChildren();
      if (!s.requires) {
        return;
      }
      const r = s.requires;
      fields.append(
        labelled(
          "That skill",
          skillSelect(`${idName}-skill`, r.skill, (k) => {
            r.skill = k;
          }),
        ),
        labelled(
          "Is above",
          intField(`${idName}-above`, r.above, -1, 100, false, "Is above", (n) => {
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
  const tick = (idName: string, on: boolean, text: string, write: (on: boolean) => void) => {
    const l = document.createElement("label");
    l.className = "items-check";
    const b = action(document.createElement("input"), idName);
    b.type = "checkbox";
    b.checked = on;
    b.addEventListener("change", () => {
      write(b.checked);
      edited();
    });
    l.append(b, ` ${text}`);
    return l;
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
      option("default", "The normal rule (shared by every skill)"),
      option("own", "Its own rule"),
      option("off", "Never goes up this way"),
    );
    mode.value = own === false ? "off" : own === undefined ? "default" : "own";
    const p = view?.progression;
    const def = p ? (model === "chance" ? p.defaults.chance : p.defaults.xp)[src.id] : undefined;
    const defText = helpLine(settingsText(model, def));
    const body = document.createElement("div");
    const drawBody = () => {
      body.replaceChildren();
      defText.hidden = mode.value !== "default";
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
        const extra: HTMLElement[] = [requiresField("skills-requires", c)];
        if (src.id === "kill") {
          extra.push(
            tick(
              "skills-monster-cap",
              c.monsterCap === true,
              "Also stops at the killed monster's skill cap",
              (on) => {
                if (on) {
                  c.monsterCap = true;
                } else {
                  delete c.monsterCap;
                }
              },
            ),
          );
        }
        if (src.id === "gather" || src.id === "craft") {
          extra.push(
            labelled(
              "Can go up from",
              intField(
                "skills-min",
                c.min ?? null,
                0,
                100,
                true,
                `${src.label}: can go up from`,
                (n) => {
                  if (n === null) {
                    delete c.min;
                  } else {
                    c.min = n;
                  }
                },
                "0",
              ),
              "The lowest value that still goes up this way. Empty means 0: a player who has never used it can start learning.",
            ),
          );
        }
        body.append(
          formulaEditor(
            "skills-roll",
            "Chance to go up: 1 in…",
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
            "Each time, it goes up by one with a chance of 1 in this number, so a bigger number is slower. Starting from skill makes it harder as it rises.",
          ),
          labelled(
            "Stops going up at",
            capField(
              "skills-cap",
              c.cap,
              `${src.label}: stops going up at`,
              "100 (no cap)",
              (v) => {
                if (v === undefined) {
                  delete c.cap;
                } else {
                  c.cap = v;
                }
              },
            ),
          ),
          more(
            !!c.requires || c.monsterCap === true || c.min !== undefined,
            "More options",
            ...extra,
          ),
        );
      } else {
        const x = s as XpSettings;
        body.append(
          formulaEditor("skills-xp", "XP earned each time", formulaRows(x.xp), invalid, (r) => {
            const f = rowsFormula(r);
            if (f === undefined) {
              delete x.xp;
            } else {
              x.xp = f;
            }
            edited();
          }),
          more(!!x.requires, "More options", requiresField("skills-requires", x)),
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
    h.textContent = src.label;
    box.append(h, helpLine(src.help), labelled("Rule", mode), defText, body);
    return box;
  };

  const curveEditor = (): HTMLElement => {
    const box = document.createElement("div");
    const prog = work.progression;
    if (prog?.model !== "xp") {
      return box;
    }
    box.className = "items-list-editor skills-levels";
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
      option("perLevel", "From one level to the next"),
      option("total", "In total, from level 0"),
    );
    counting.value = c.counting;
    counting.addEventListener("change", () => {
      curveEdit.edited = true;
      c.counting = counting.value as Curve["counting"];
      drawForm();
      edited();
    });
    // The curve's shape: formula rows, or the growth form (start, per level, power, growth).
    const shape = action(document.createElement("select"), "skills-curve-shape");
    shape.append(
      option("formula", "Formula rows"),
      option("growth", "Grows by a percent each level"),
    );
    shape.value = c.growth ? "growth" : "formula";
    shape.addEventListener("change", () => {
      curveEdit.edited = true;
      if (shape.value === "growth") {
        delete c.formula;
        c.growth = { start: 100, perLevel: 0, exponent: 1, growthPercent: 10 };
      } else {
        delete c.growth;
        c.formula = 100;
      }
      drawForm();
      edited();
    });
    const growthEditor = (g: CurveGrowth): HTMLElement => {
      const part = (
        key: keyof CurveGrowth,
        label: string,
        min: number,
        max: number,
        help: string,
      ) =>
        labelled(
          label,
          intField(`skills-curve-${key.toLowerCase()}`, g[key], min, max, false, label, (n) => {
            curveEdit.edited = true;
            g[key] = n ?? min;
          }),
          help,
        );
      const wrap = document.createElement("div");
      wrap.append(
        helpLine(
          `${c.counting === "total" ? "The total XP to reach the next level" : "The XP to go up from level L"} is (start + per level × L to the power) × (1 + growth%) to the power L.`,
        ),
        part("start", "Start", 0, 1_000_000_000, "The XP level 0 takes."),
        part("perLevel", "Per level", 0, 1_000_000_000, "Added for each level, before growth."),
        part("exponent", "Power", 1, 4, "1: per level adds a straight line; 2: squared."),
        part("growthPercent", "Growth %", 0, 100, "How much more each level takes than the last."),
      );
      return wrap;
    };
    const table = noAutofill(action(document.createElement("input"), "skills-curve-table"));
    table.value = (c.table ?? []).join(", ");
    table.placeholder = "none: use the formula for every level";
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
        invalid.set(table, "XP for the first levels: whole numbers, separated by commas");
      }
      edited();
    });
    const cap = intField(
      "skills-curve-cap",
      c.cap ?? null,
      1,
      100,
      true,
      "Highest level",
      (n) => {
        curveEdit.edited = true;
        if (n === null) {
          delete c.cap;
        } else {
          c.cap = n;
        }
      },
      "100",
    );
    const levelCap = capField("skills-level-cap", prog.cap, "Stops levelling at", "No cap", (v) => {
      if (v === undefined) {
        delete prog.cap;
      } else {
        prog.cap = v;
      }
    });
    const shared = shown?.curve?.sharedWith ?? [];
    const head = document.createElement("p");
    head.className = "items-list-title";
    head.textContent = "Levels";
    box.append(
      head,
      labelled(
        "Level curve",
        name,
        shared.length > 0 && shown?.curve?.name === prog.curve
          ? `Also used by ${shared.join(", ")}: changing the XP below changes theirs too.`
          : "Skills on the same curve need the same XP for each level. Type a new name to make a curve of its own.",
      ),
      labelled(
        "Shape",
        shape,
        "Growth is the easy way to a curve that gets steeper each level (10% is close to RuneScape's). Formula rows give any shape, step by step.",
      ),
      c.growth
        ? growthEditor(c.growth)
        : formulaEditor(
            "skills-curve-formula",
            c.counting === "total"
              ? "Total XP needed to reach each level"
              : "XP needed to go up from each level",
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
            "Use level for the level being left, e.g. Set to 100 then Multiply by level.",
          ),
      labelled("Highest level", cap, "Empty means 100."),
      labelled("Stops levelling at", levelCap),
      more(
        c.table !== undefined || c.counting === "total",
        "More options",
        labelled("XP is counted", counting),
        labelled(
          "XP for the first levels",
          table,
          "Exact XP for levels 0, 1, 2… separated by commas. Levels past the list use the growth or formula above.",
        ),
      ),
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
      previewOut.textContent = "It doesn't go up this way.";
      return;
    }
    if (prog?.model === "xp") {
      const curve = work.curve?.curve ?? view.progression.curves[prog.curve];
      if (!curve) {
        previewOut.textContent = "Its level curve is missing.";
        return;
      }
      table.setAttribute("aria-label", "XP to reach each level");
      head.append(
        cell("th", "Level"),
        cell("th", "Total XP to reach it"),
        cell("th", "XP to the next level"),
        cell("th", "XP each time"),
        cell("th", "Times to go up"),
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
      head.append(cell("th", "Skill value"), cell("th", "Chance it goes up each time"));
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
    return labelled("Killed monster's skill cap", input);
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
    const stats = document.createElement("div");
    stats.className = "items-list-row";
    stats.append(
      num("level", "Level", 1000),
      num("str", "Strength", 1000),
      num("sta", "Stamina", 1000),
      num("int", "Intelligence", 1000),
      num("wis", "Wisdom", 1000),
      num("dex", "Dexterity", 1000),
      num("otherSkills", "Its other skills at", 100),
      num("tier", "Tool tier", 1000),
      num("damage", "A hit's damage", 1_000_000),
      monsterCapInput(),
    );
    previewBox.replaceChildren(
      labelled("Trained by", src),
      more(
        false,
        "The sample character",
        stats,
        helpLine(
          "A faction or mage cap is worked out for a character with no faction. A rule that needs another skill reads Its other skills at.",
        ),
      ),
      previewOut,
    );
  };

  const drawForm = () => {
    const v = shown;
    if (!v || !view) {
      groups.replaceChildren();
      return;
    }
    // ---- Basics ----
    const display = noAutofill(action(document.createElement("input"), "skills-display"));
    display.maxLength = 40;
    display.value = work.display;
    display.placeholder = v.skill;
    display.addEventListener("input", () => {
      work.display = display.value.trim();
      edited();
    });
    const order = intField(
      "skills-order",
      work.order,
      1,
      view.skills.length,
      false,
      "Position on the Skills page",
      (n) => {
        work.order = n ?? 1;
      },
    );
    // ---- Starting values ----
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
            `${s.label} starts at`,
            (n) => {
              work.starts[String(s.code)] = n;
            },
            "1",
          ),
        ),
      );
    }
    const grants = document.createElement("div");
    grants.className = "items-checks";
    for (const p of v.promotions) {
      grants.append(
        tick("skills-grant", work.grants.includes(p.code), p.name, (on) => {
          work.grants = on
            ? [...work.grants, p.code].sort((a, c) => a - c)
            : work.grants.filter((c) => c !== p.code);
        }),
      );
    }
    if (v.promotions.length === 0) {
      grants.append(helpLine("There are no promotions."));
    }
    // ---- How it goes up ----
    const model = action(document.createElement("select"), "skills-model");
    model.append(
      option("chance", "A chance to go up by one each time (like 1.6)"),
      option("xp", "Earns XP and goes up in levels"),
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
    const waysTitle = document.createElement("p");
    waysTitle.className = "items-list-title skills-ways-title";
    waysTitle.textContent = "What makes it go up";
    sources.append(waysTitle);
    for (const src of SOURCES) {
      sources.append(drawSource(src));
    }
    // ---- Where it's used ----
    const trains = document.createElement("ul");
    trains.className = "items-sources";
    trains.append(...v.trains.map(trainerLink));
    if (v.trains.length === 0) {
      const li = document.createElement("li");
      li.textContent = "Nothing trains or uses it yet.";
      trains.append(li);
    }
    previewInputs();
    groups.replaceChildren(
      section(
        "basics",
        "Basics",
        "What players see and where it sits on their Skills page.",
        labelled(
          "Name players see",
          display,
          `Leave it empty to show its ID, ${v.skill}, which never changes.`,
        ),
        tick(
          "skills-hidden",
          work.hidden,
          "Hide it from players' Skills page (it still goes up and works)",
          (on) => {
            work.hidden = on;
          },
        ),
        labelled(
          "Position on the Skills page",
          order,
          `1 is the top; there are ${view.skills.length} skills.`,
        ),
        removeBox,
      ),
      section(
        "starts",
        "Starting values",
        "The value each class starts with, and promotions that raise it.",
        labelled("Each class starts at", starts, "Leave a class empty for 1."),
        labelled(
          "Promotions that teach it",
          grants,
          "Taking one of these promotions raises it to a random 1 to 10, if it is lower.",
        ),
      ),
      section(
        "rises",
        "How it goes up",
        "Choose how the skill improves, then what makes it go up. Most skills use the normal rules every skill shares.",
        labelled("It goes up by", model),
        curveEditor(),
        sources,
      ),
      section(
        "used",
        "Where it's used",
        "Items, gathering spots, recipes and rules that train or need this skill. Open one to change it where it is set.",
        trains,
        ...(v.bindings.length > 0
          ? [
              helpLine(
                `The game's ${v.bindings.join(", ")} rule${v.bindings.length === 1 ? " uses" : "s use"} it, so it can't be removed. Point ${v.bindings.length === 1 ? "that rule" : "those rules"} at another skill first, on the Skills the game uses tab.`,
              ),
            ]
          : []),
      ),
      section(
        "preview",
        "Try it out",
        "How quickly it goes up for a sample character, worked out by the game's own rules from this form, unsaved changes included.",
        previewBox,
      ),
    );
    markUsed();
    drawPreview();
  };
  const draw = () => {
    if (!shown) {
      return;
    }
    const v = shown;
    const shownName = v.row.display || v.skill;
    title.textContent = shownName;
    subtitle.textContent = shownName === v.skill ? "" : `ID: ${v.skill}`;
    const state = list.find((x) => x.skill === v.skill)?.state ?? (v.inPack ? "pack" : "yours");
    const t: [string, string][] = [
      state === "yours"
        ? ["Added by you", "changed"]
        : // Against the pack's form when the server says (start values and grants count too).
          (v.differs ?? (state === "edited" || v.pending))
          ? ["Changed by you", "changed"]
          : ["Original", "original"],
    ];
    if (v.row.hidden) {
      t.push(["Hidden from players", "retired"]);
    }
    if (!v.published) {
      t.push(["Not published yet", "pending"]);
    } else if (v.pending) {
      t.push(["Unpublished changes", "pending"]);
    }
    tags.replaceChildren(
      ...t.map(([x, kind]) => {
        const s = document.createElement("span");
        s.className = `balance-tag items-tag-${kind}`;
        s.textContent = x;
        return s;
      }),
    );
    noticeLine.hidden = !v.notice;
    noticeLine.textContent = v.notice?.note ?? "";
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
    listCount.textContent =
      rows.length === list.length
        ? `${list.length} skills, in the order players see them`
        : `${rows.length} of ${list.length} skills`;
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
          s.model === "xp" ? "levels" : "",
          s.hidden ? "hidden" : "",
          s.state === "yours" ? "added by you" : s.state === "edited" || s.pending ? "changed" : "",
          s.pending ? "unpublished" : "",
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
          : `${shown.row.display || shown.skill} has unsaved changes: save or undo them first.`,
        false,
      );
      return;
    }
    openKey = key;
    shown = null;
    form.hidden = true;
    empty.hidden = false;
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
      b.textContent = `The ${u.bindings.join(", ")} binding${u.bindings.length === 1 ? " names" : "s name"} it: point ${u.bindings.length === 1 ? "it" : "them"} at another skill first, on the Skills the game uses tab.`;
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
        : `${total === 1 ? "1 unpublished change" : `${total} unpublished changes`}${v.otherDraft > 0 && v.skillDraft > 0 ? ` (${v.skillDraft} to classes and skills)` : v.skillDraft === 0 ? " (none to skills)" : ""}. Players get them once you publish. `;
    empty.hidden = openKey !== null && shown !== null;
    if (!openKey) {
      return;
    }
    const s = v.skill;
    if (!s || s.skill.toLowerCase() !== openKey.toLowerCase()) {
      if (shown && !v.skills.some((x) => x.skill.toLowerCase() === openKey?.toLowerCase())) {
        shown = null;
        form.hidden = true;
        empty.hidden = false;
        openKey = null;
      }
      return;
    }
    const first = shown === null || shown.skill !== s.skill;
    shown = s;
    form.hidden = false;
    empty.hidden = true;
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
            empty.hidden = false;
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
      empty.hidden = false;
      removal.hidden = true;
      loading.hidden = false;
      draftLine.hidden = true;
    },
    open(key) {
      openSkill(key);
    },
  };
}
