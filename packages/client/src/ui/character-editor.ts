/**
 * The player hub's character editor and its log (issue #26). 1.6 had nothing like it: staff
 * changed a character's text file by hand. A plain SSO form built from the Control Panel's
 * shared parts.
 *
 * - **The form** starts from the hub's sheet. Save sends only the fields that differ, with the
 *   values the hub showed for them, so the server refuses an edit made over a stale hub. The same
 *   limits the server checks are checked here first, and Save asks before it sends, listing the
 *   changes. Experience needed and HP and SP max follow the level and are not typed.
 * - **The log** lists each edit with its admin, reason and changes. Undo puts an edit's old values
 *   back, with a reason of its own; the server refuses it when something it set has changed since.
 */
import {
  BAG_SLOTS,
  type CharacterEditRow,
  type CharacterSheet,
  changeText,
  content,
  deriveEdit,
  diffEdit,
  EDIT_LIMITS,
  EDIT_TEXT,
  type EditableCharacter,
  editableOf,
  editErrors,
  factionLabel,
  HEADS_BY_SEX,
  onContent,
  SETTABLE_FIELDS,
  type Sex,
  STAT_FIELDS,
  sameValue,
  staleCheckFields,
} from "@secondstaronline/shared";

import { action, gameInput } from "./action.ts";
import { activityTime } from "./activity-log.ts";
import { confirmBox, createTable, formField, panelButton } from "./control-panel-kit.ts";

/** The worn-gear fields in the paperdoll's order, with their labels. */
const WORN: readonly [string, string][] = [
  ["head", "Head"],
  ["body", "Body"],
  ["weapon", "Weapon"],
  ["offHand", "Off hand"],
  ["feet", "Feet"],
  ["ring", "Ring"],
];

const STAT_LABELS: Record<(typeof STAT_FIELDS)[number], string> = {
  str: "Strength",
  sta: "Stamina",
  dex: "Mysticism (dex)",
  int: "Intelligence",
  wis: "Wisdom",
};

let lists = 0;

function datalist(id: string, values: readonly string[]): HTMLDataListElement {
  const d = document.createElement("datalist");
  d.id = id;
  for (const v of values) {
    const o = document.createElement("option");
    o.value = v;
    d.append(o);
  }
  return d;
}

function numberInput(id: string): HTMLInputElement {
  const i = gameInput(id);
  i.type = "number";
  i.step = "1";
  i.inputMode = "numeric";
  return i;
}

function textInput(id: string, list?: string, max = 80): HTMLInputElement {
  const i = gameInput(id);
  i.type = "text";
  i.maxLength = max;
  i.spellcheck = false;
  if (list) {
    i.setAttribute("list", list);
  }
  return i;
}

function select(id: string, options: readonly [string, string][]): HTMLSelectElement {
  const s = action(document.createElement("select"), id);
  for (const [value, label] of options) {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = label;
    s.append(o);
  }
  return s;
}

function subtitle(text: string): HTMLElement {
  const h = document.createElement("h2");
  h.className = "activity-subtitle";
  h.textContent = text;
  return h;
}

function section(title: string, ...body: Node[]): HTMLElement {
  const s = document.createElement("section");
  s.className = "hub-section";
  s.append(subtitle(title), ...body);
  return s;
}

function grid(...fields: HTMLElement[]): HTMLElement {
  const g = document.createElement("div");
  g.className = "hub-edit-grid";
  g.append(...fields);
  return g;
}

/** A whole number typed in a field, or NaN (the limits check names it). */
const num = (i: HTMLInputElement): number => (i.value.trim() === "" ? Number.NaN : Number(i.value));

/** One name per line, blank lines dropped. */
const lines = (t: HTMLTextAreaElement): string[] =>
  t.value
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");

export interface CharacterEditorOptions {
  /** Sends an edit; false while another change is still waiting for its answer. */
  save(req: {
    set: Partial<EditableCharacter>;
    seen: Partial<EditableCharacter>;
    override: boolean;
    reason: string;
  }): boolean;
  /** Where the confirmation box goes. */
  host: HTMLElement;
}

export interface CharacterEditor {
  /** The form's sections. */
  readonly sections: HTMLElement[];
  /** Fills the form from the hub's sheet (a new hub, or after a save). */
  load(name: string, sheet: CharacterSheet): void;
  /** The server's answer to a save. */
  result(ok: boolean, text: string): void;
  /** Forgets the half-typed reason and the last result. */
  clear(): void;
}

export function createCharacterEditor(opts: CharacterEditorOptions): CharacterEditor {
  lists += 1;
  const itemList = `hub-items-${lists}`;
  const mapsHelp = "A map's name, such as x1000y992; the tile is 1-17 across and 1-12 down.";
  let name = "";
  let original: EditableCharacter | null = null;

  // ---- core ------------------------------------------------------------------------------------
  const cls = select(
    "hub-edit-class",
    content().classes.classes.map((c) => [String(c.code), c.name]),
  );
  const level = numberInput("hub-edit-level");
  const exp = numberInput("hub-edit-exp");
  const hp = numberInput("hub-edit-hp");
  const sp = numberInput("hub-edit-sp");
  const hunger = numberInput("hub-edit-hunger");
  // The world's factions, and the shown character's saved faction when the world has removed it.
  const faction = select("hub-edit-faction", []);
  const factionOptions = (...saved: (string | null | undefined)[]) => {
    const rows: [string, string][] = [
      ["", "None"],
      ...content().social.factions.map((f): [string, string] => [f.key, f.name]),
    ];
    for (const k of saved) {
      if (k && !rows.some(([r]) => r.toLowerCase() === k.toLowerCase())) {
        rows.push([k, factionLabel(k)]);
      }
    }
    faction.replaceChildren(
      ...rows.map(([value, label]) => {
        const o = document.createElement("option");
        o.value = value;
        o.textContent = label;
        return o;
      }),
    );
  };
  factionOptions();
  const factionCount = numberInput("hub-edit-faction-time");
  const wanted = select("hub-edit-wanted", [
    ["false", "No"],
    ["true", "Yes"],
  ]);
  const derived = document.createElement("p");
  derived.className = "control-panel-field-help hub-edit-note";
  const core = section(
    "Character",
    grid(
      formField("Class", cls),
      formField("Level", level),
      formField("Experience", exp),
      formField("HP", hp),
      formField("SP", sp),
      formField(
        "Hunger",
        hunger,
        `0 to ${EDIT_LIMITS.hungerMax}; a new character starts at ${EDIT_LIMITS.hungerMax}, a death sets 40000.`,
      ),
      formField("Faction", faction),
      formField("Faction time", factionCount, "Frames of play left in the faction."),
      formField("Wanted", wanted),
    ),
    derived,
  );

  // ---- stats and skills ------------------------------------------------------------------------
  const stats = new Map(STAT_FIELDS.map((f) => [f, numberInput(`hub-edit-${f}`)] as const));
  const statsBox = section(
    "Stats",
    grid(...STAT_FIELDS.map((f) => formField(STAT_LABELS[f], stats.get(f) as HTMLInputElement))),
    note("The allocated points, 1 to 20. Class and medal points are added in play."),
  );
  let skills: HTMLInputElement[] = [];
  /** The skill key each of `skills` edits. */
  let skillKeys: string[] = [];
  const skillsGrid = grid();
  const skillsBox = section("Skills", skillsGrid, note("1 to 100."));

  // ---- gold and items --------------------------------------------------------------------------
  const gold = numberInput("hub-edit-gold");
  const bank = numberInput("hub-edit-bank");
  const bagItems = Array.from({ length: BAG_SLOTS }, (_v, i) =>
    textInput(`hub-edit-bag-${i + 1}-item`, itemList),
  );
  const bagQty = Array.from({ length: BAG_SLOTS }, (_v, i) => {
    const q = numberInput(`hub-edit-bag-${i + 1}-qty`);
    q.min = "1";
    return q;
  });
  const bagRows = document.createElement("div");
  bagRows.className = "hub-edit-bag";
  bagItems.forEach((item, i) => {
    const row = document.createElement("div");
    row.className = "hub-edit-bag-row";
    const label = document.createElement("span");
    label.className = "hub-edit-bag-line";
    label.textContent = String(i + 1);
    item.setAttribute("aria-label", `Bag line ${i + 1} item`);
    const qty = bagQty[i] as HTMLInputElement;
    qty.setAttribute("aria-label", `Bag line ${i + 1} quantity`);
    row.append(label, item, qty);
    bagRows.append(row);
  });
  const worn = new Map(
    WORN.map(
      ([f]) =>
        [
          f,
          textInput(`hub-edit-worn-${f.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, itemList),
        ] as const,
    ),
  );
  const vault = action(document.createElement("textarea"), "hub-edit-vault");
  vault.rows = 4;
  const spellbook = action(document.createElement("textarea"), "hub-edit-spellbook");
  spellbook.rows = 4;
  const goldBox = section(
    "Gold and bank",
    grid(formField("Gold carried", gold), formField("Bank", bank)),
  );
  const bagBox = section(
    "Bag",
    bagRows,
    note("An item name and how many. Leave the name empty for an empty line."),
  );
  const wornBox = section(
    "Worn gear",
    grid(...WORN.map(([f, l]) => formField(l, worn.get(f) as HTMLInputElement))),
    note(
      "Leave a slot empty to take its item off. Gear must follow the wear rules unless overridden.",
    ),
  );
  const storeBox = section(
    "Vault and spellbook",
    grid(
      formField("Vault", vault, "One item per line, at most 15."),
      formField("Spellbook", spellbook, "One spell per line, in the order the book lists them."),
    ),
  );

  // ---- position and look -----------------------------------------------------------------------
  const posMap = textInput("hub-edit-position-map", undefined, 40);
  const posX = numberInput("hub-edit-position-x");
  const posY = numberInput("hub-edit-position-y");
  const resMap = textInput("hub-edit-respawn-map", undefined, 40);
  const resX = numberInput("hub-edit-respawn-x");
  const resY = numberInput("hub-edit-respawn-y");
  const sex = select("hub-edit-sex", [
    ["1", "Male"],
    ["2", "Female"],
  ]);
  const head = action(document.createElement("select"), "hub-edit-head");
  const fillHeads = (keep: number) => {
    const heads = HEADS_BY_SEX[(Number(sex.value) === 2 ? 2 : 1) as Sex];
    head.replaceChildren(
      ...heads.map((h) => {
        const o = document.createElement("option");
        o.value = String(h);
        o.textContent = `Head ${h}`;
        return o;
      }),
    );
    head.value = String(heads.includes(keep) ? keep : (heads[0] ?? 1));
  };
  sex.addEventListener("change", () => fillHeads(Number(head.value)));
  const placeBox = section(
    "Position and look",
    grid(
      formField("Map", posMap, mapsHelp),
      formField("Across", posX),
      formField("Down", posY),
      formField("Respawn map", resMap, "Where a death or a jail release sends them."),
      formField("Respawn across", resX),
      formField("Respawn down", resY),
      formField("Sex", sex),
      formField("Head", head),
    ),
    note("Moving an online player warps them; a new head redraws on their map at once."),
  );

  // ---- save ------------------------------------------------------------------------------------
  const reason = textInput("hub-edit-reason", undefined, 200);
  const override = action(document.createElement("input"), "hub-edit-override");
  override.type = "checkbox";
  const overrideLabel = document.createElement("label");
  overrideLabel.className = "hub-edit-check";
  overrideLabel.append(override, " Override the wear rules (logged)");
  const status = document.createElement("p");
  status.className = "activity-status";
  status.setAttribute("role", "status");
  const saveBtn = panelButton("hub-edit-save", "Save changes", () => save(), "primary");
  const resetBtn = panelButton("hub-edit-reset", "Discard changes", () => {
    if (original) {
      fill(original);
      status.textContent = "";
    }
  });
  const buttons = document.createElement("div");
  buttons.className = "hub-tools";
  buttons.append(saveBtn, resetBtn);
  const saveBox = section(
    "Save",
    grid(formField("Reason", reason, "Required. Kept in the character's edit log.")),
    overrideLabel,
    buttons,
    status,
  );
  saveBox.classList.add("hub-edit-save", "hub-wide");
  const items = datalist(itemList, []);
  saveBox.append(items);
  // The class list, the factions, the skills and the item suggestions follow the content store, so
  // a publish that adds a class, a faction, a skill or an item shows here at once.
  onContent((c) => {
    const pickedFaction = faction.value;
    factionOptions(original?.faction, pickedFaction);
    faction.value = pickedFaction;
    const picked = cls.value;
    cls.replaceChildren(
      ...c.classes.classes.map((k) => {
        const o = document.createElement("option");
        o.value = String(k.code);
        o.textContent = k.name;
        return o;
      }),
    );
    cls.value = picked;
    // What was typed stays with its skill, wherever the publish moved it.
    const typed = new Map(skillKeys.map((k, i) => [k, skills[i]?.value]));
    skillKeys = c.classes.skills.map((s) => s.skill);
    skills = skillKeys.map((_k, i) => numberInput(`hub-edit-skill-${i + 1}`));
    skills.forEach((s, i) => {
      const k = skillKeys[i] as string;
      s.value = typed.get(k) ?? String(original?.skills[k] ?? "");
    });
    skillsGrid.replaceChildren(
      ...c.classes.skills.map((s, i) =>
        formField(s.display ?? s.skill, skills[i] as HTMLInputElement),
      ),
    );
    items.replaceChildren(
      ...c.items.items.map((i) => {
        const o = document.createElement("option");
        o.value = i.name;
        return o;
      }),
    );
  });

  function note(text: string): HTMLElement {
    const p = document.createElement("p");
    p.className = "control-panel-field-help hub-edit-note";
    p.textContent = text;
    return p;
  }

  const fill = (c: EditableCharacter) => {
    cls.value = String(c.classCode);
    level.value = String(c.level);
    exp.value = String(c.exp);
    hp.value = String(c.hp);
    sp.value = String(c.sp);
    hunger.value = String(c.hunger);
    factionOptions(c.faction);
    faction.value = c.faction ?? "";
    factionCount.value = String(c.factionCount);
    wanted.value = String(c.wanted);
    derived.textContent = `Experience needed ${c.expNeeded}, HP max ${c.hpMax}, SP max ${c.spMax}. They follow the level: each level up or down moves HP and SP max by one.`;
    for (const f of STAT_FIELDS) {
      (stats.get(f) as HTMLInputElement).value = String(c[f]);
    }
    // A skill the sheet does not list (it came with a publish since) stays empty and unsent.
    skills.forEach((s, i) => {
      const v = c.skills[skillKeys[i] as string];
      s.value = v === undefined ? "" : String(v);
    });
    gold.value = String(c.gold);
    bank.value = c.bank === null ? "" : String(c.bank);
    bank.disabled = c.bank === null;
    bank.placeholder = c.bank === null ? "No account" : "";
    bagItems.forEach((item, i) => {
      const l = c.bag[i];
      item.value = l?.item ?? "";
      (bagQty[i] as HTMLInputElement).value = l ? String(l.qty) : "";
    });
    for (const [f, input] of worn) {
      const v = c.equip[f as keyof EditableCharacter["equip"]] ?? "NOTHING";
      input.value = v === "NOTHING" ? "" : v;
    }
    vault.value = c.vault.join("\n");
    spellbook.value = c.spellbook.join("\n");
    posMap.value = c.position.map;
    posX.value = String(c.position.x);
    posY.value = String(c.position.y);
    resMap.value = c.respawn?.map ?? "";
    resX.value = c.respawn ? String(c.respawn.x) : "";
    resY.value = c.respawn ? String(c.respawn.y) : "";
    sex.value = String(c.sex);
    fillHeads(c.head);
    override.checked = false;
  };

  const wornValue = (f: string): string => {
    const v = worn.get(f)?.value.trim() ?? "";
    return v === "" ? "NOTHING" : v;
  };

  /** The form as an editable character; untouched lines keep the hub's spelling and `#id`. */
  const read = (c: EditableCharacter): EditableCharacter => ({
    ...c,
    classCode: Number(cls.value),
    level: num(level),
    exp: num(exp),
    hp: num(hp),
    sp: num(sp),
    hunger: num(hunger),
    faction: faction.value === "" ? null : faction.value,
    factionCount: num(factionCount),
    wanted: wanted.value === "true",
    ...Object.fromEntries(STAT_FIELDS.map((f) => [f, num(stats.get(f) as HTMLInputElement)])),
    skills: {
      ...c.skills,
      ...Object.fromEntries(
        skillKeys.flatMap((k, i) => {
          const input = skills[i] as HTMLInputElement;
          return c.skills[k] === undefined && input.value.trim() === "" ? [] : [[k, num(input)]];
        }),
      ),
    },
    gold: num(gold),
    bank: c.bank === null ? null : num(bank),
    bag: bagItems.map((item, i) => {
      const name = item.value.trim();
      const was = c.bag[i];
      if (name === "") {
        return null;
      }
      const qty = num(bagQty[i] as HTMLInputElement);
      // The hub shows a Crate's `#id`: a line left as it was keeps it.
      return { item: was && was.item === name ? was.item : name, qty };
    }),
    equip: {
      weapon: wornValue("weapon"),
      offHand: wornValue("offHand"),
      head: wornValue("head"),
      body: wornValue("body"),
      feet: wornValue("feet"),
      ring: wornValue("ring"),
    },
    vault: lines(vault),
    spellbook: lines(spellbook),
    position: { map: posMap.value.trim(), x: num(posX), y: num(posY) },
    respawn:
      resMap.value.trim() === "" && c.respawn === null
        ? null
        : { map: resMap.value.trim(), x: num(resX), y: num(resY) },
    sex: Number(sex.value),
    head: Number(head.value),
  });

  const save = () => {
    const c = original;
    if (!c) {
      return;
    }
    const typed = read(c);
    const set: Partial<EditableCharacter> = {};
    const seen: Partial<EditableCharacter> = {};
    for (const f of SETTABLE_FIELDS) {
      if (!sameValue(typed[f], c[f])) {
        (set as Record<string, unknown>)[f] = typed[f];
      }
    }
    // What the hub showed for each field set, and for those a level change recalculates.
    for (const f of staleCheckFields(set)) {
      (seen as Record<string, unknown>)[f] = c[f];
    }
    if (Object.keys(set).length === 0) {
      status.textContent = EDIT_TEXT.nothing;
      return;
    }
    const after = deriveEdit(c, set);
    const errors = editErrors(c, after);
    if (errors.length > 0) {
      status.textContent = errors.join(" ");
      return;
    }
    const why = reason.value.trim();
    if (why === "") {
      status.textContent = EDIT_TEXT.needReason;
      reason.focus();
      return;
    }
    const changes = diffEdit(c, after).map(changeText);
    const asked = name;
    const withOverride = override.checked;
    void confirmBox(opts.host, {
      text: `Save these changes to ${asked}? ${changes.join("; ")}.`,
      confirm: "Save",
      cancel: "Cancel",
    }).then((yes) => {
      if (!yes || name !== asked || original !== c) {
        return;
      }
      status.textContent = opts.save({ set, seen, override: withOverride, reason: why })
        ? "Saving…"
        : EDIT_TEXT.wait;
    });
  };

  return {
    sections: [core, statsBox, skillsBox, goldBox, bagBox, wornBox, storeBox, placeBox, saveBox],
    load(n, sheet) {
      if (n !== name) {
        reason.value = "";
        status.textContent = "";
      }
      name = n;
      original = editableOf(sheet);
      fill(original);
    },
    result(ok, text) {
      status.textContent = text;
      if (ok) {
        reason.value = "";
      }
    },
    clear() {
      name = "";
      original = null;
      reason.value = "";
      status.textContent = "";
    },
  };
}

export interface EditLogOptions {
  /** Undoes an edit by id with a reason; false while another change is still waiting. */
  undo(id: string, reason: string): boolean;
  /** Whether undo buttons show (the role holds `characterEditor`). */
  canUndo(): boolean;
  host: HTMLElement;
}

export interface EditLog {
  readonly sections: HTMLElement[];
  show(name: string, rows: readonly CharacterEditRow[]): void;
  result(ok: boolean, text: string): void;
  clear(): void;
}

/** The character's edit log, newest first, with Undo on each edit not yet undone. */
export function createEditLog(opts: EditLogOptions): EditLog {
  let name = "";
  const reason = textInput("hub-undo-reason", undefined, 200);
  const status = document.createElement("p");
  status.className = "activity-status";
  status.setAttribute("role", "status");
  const reasonBox = grid(
    formField("Reason to undo", reason, "Required to undo. Kept in the edit log."),
  );
  const byId = new Map<string, CharacterEditRow>();
  const state = (r: CharacterEditRow): string | Node => {
    if (r.undoneBy !== null) {
      return "Undone";
    }
    if (!opts.canUndo()) {
      return "";
    }
    const b = panelButton("hub-undo", "Undo", () => undo(r), "danger");
    b.dataset.edit = r.id;
    return b;
  };
  const table = createTable<CharacterEditRow>({
    label: "Edit log",
    columns: [
      { label: "Time (UTC)", cell: (r) => activityTime(r.at) },
      { label: "By", cell: (r) => r.actorName },
      { label: "Reason", cell: (r) => r.reason },
      {
        label: "Changes",
        cell: (r) => {
          const ul = document.createElement("ul");
          ul.className = "hub-edit-changes";
          const items = [
            ...(r.undoOf ? ["Undid an earlier edit"] : []),
            ...(r.override ? ["Wear rules overridden"] : []),
            ...r.changes.map(changeText),
          ];
          for (const t of items) {
            const li = document.createElement("li");
            li.textContent = t;
            ul.append(li);
          }
          return ul;
        },
      },
      { label: "", cell: state },
    ],
    empty: "No admin has edited this character.",
    key: (r) => r.id,
  });

  const undo = (r: CharacterEditRow) => {
    const why = reason.value.trim();
    if (why === "") {
      status.textContent = EDIT_TEXT.needReason;
      reason.focus();
      return;
    }
    const asked = name;
    void confirmBox(opts.host, {
      text: `Undo this edit to ${asked}? ${r.changes.map(changeText).join("; ")}.`,
      confirm: "Undo",
      cancel: "Cancel",
      danger: true,
    }).then((yes) => {
      if (!yes || name !== asked || !byId.has(r.id) || !opts.canUndo()) {
        return;
      }
      status.textContent = opts.undo(r.id, why) ? "Undoing…" : EDIT_TEXT.wait;
    });
  };

  const box = section("Edits, newest first", table.el);
  const undoBox = section("Undo", reasonBox, status);
  box.classList.add("hub-wide");
  undoBox.classList.add("hub-wide");

  return {
    sections: [undoBox, box],
    show(n, rows) {
      if (n !== name) {
        reason.value = "";
        status.textContent = "";
      }
      name = n;
      byId.clear();
      for (const r of rows) {
        byId.set(r.id, r);
      }
      table.setRows(rows);
      undoBox.hidden = !opts.canUndo() || !rows.some((r) => r.undoneBy === null);
    },
    result(ok, text) {
      status.textContent = text;
      if (ok) {
        reason.value = "";
      }
    },
    clear() {
      name = "";
      byId.clear();
      reason.value = "";
      status.textContent = "";
      table.setRows([]);
    },
  };
}
