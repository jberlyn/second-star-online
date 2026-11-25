/**
 * The Control Panel's Skills page (issue #38): the list in Skills-page order, the open skill's form
 * (name and place, start values, grants, progression per source with formulas as rows, the curve),
 * a save carrying the fingerprint it was filled from, previews from the form as edited, the links
 * to what trains it, and the removal flow (each reference cleared or pointed elsewhere).
 */
import { afterEach, describe, expect, test } from "bun:test";

import type {
  ContentSkillsView,
  ContentSkillUsage,
  ContentSkillView,
  SkillListEntry,
} from "@secondstaronline/shared";

import {
  chanceText,
  createSkillsPage,
  formulaText,
  parseValue,
  parseWhen,
  rowsFormula,
  type SkillChange,
  type SkillRemovalChoice,
  settingsText,
} from "../src/ui/skills-page.ts";

afterEach(() => document.body.replaceChildren());

const entry = (skill: string, extra: Partial<SkillListEntry> = {}): SkillListEntry => ({
  skill,
  display: skill,
  hidden: false,
  model: "chance",
  state: "pack",
  pending: false,
  ...extra,
});

const slash = (fp: string, extra: Partial<ContentSkillView> = {}): ContentSkillView => ({
  skill: "Slash",
  row: { skill: "Slash" },
  order: 1,
  inPack: true,
  published: true,
  starts: [
    { code: 1, label: "Fighter", value: 20 },
    { code: 3, label: "Ranger", value: null },
  ],
  promotions: [{ code: 4, name: "Grunt", grants: false }],
  curve: null,
  trains: [
    {
      kind: "item",
      text: "Long Sword: a kill or a hit with it trains it",
      page: "items",
      item: "Long Sword",
    },
    { kind: "node", text: "Chop tile T1", page: "gathering", node: 2 },
  ],
  bindings: [],
  pending: false,
  fingerprint: fp,
  notice: null,
  ...extra,
});

const view = (skill: ContentSkillView | null): ContentSkillsView => ({
  skills: [entry("Slash"), entry("Mining", { model: "xp" }), entry("Meditation", { hidden: true })],
  skill,
  progression: {
    line: "You have advanced in the art of {skill}!",
    tables: {},
    curves: { steady: { counting: "perLevel", formula: 100 } },
    defaults: { chance: { kill: { roll: [{ op: "set", value: "skill" }], cap: 100 } }, xp: {} },
  },
  keys: ["Slash", "Mining", "Meditation"],
  curveFingerprints: { steady: "1111111111111111" },
  caps: { faction: 50, mage: 30 },
  otherDraft: 0,
  skillDraft: 0,
});

function page() {
  const calls: {
    view: (string | undefined)[];
    set: SkillChange[];
    usage: string[];
    remove: [string, SkillRemovalChoice[], string][];
    opened: string[];
  } = {
    view: [],
    set: [],
    usage: [],
    remove: [],
    opened: [],
  };
  let seq = 0;
  const p = createSkillsPage({
    view: (s, key) => {
      seq = s;
      calls.view.push(key);
    },
    set: (s, change) => {
      seq = s;
      calls.set.push(change);
    },
    usage: (s, key) => {
      seq = s;
      calls.usage.push(key);
    },
    remove: (s, key, refs, expect) => {
      seq = s;
      calls.remove.push([key, refs, expect]);
    },
    openContent: () => calls.opened.push("content"),
    openContentRow: (row) => calls.opened.push(`row ${row.dataset}/${row.part}`),
    openItem: (name) => calls.opened.push(`item ${name}`),
    openGathering: (node) => calls.opened.push(`node ${node}`),
  });
  document.body.append(p.el);
  return { p, calls, seq: () => seq };
}

const q = <T extends Element>(root: ParentNode, sel: string) => root.querySelector(sel) as T;
const typeIn = (el: HTMLInputElement, v: string) => {
  el.value = v;
  el.dispatchEvent(new Event("input"));
};

describe("formula rows", () => {
  test("values and conditions read as the schema does; one plain set row is a number", () => {
    expect(parseValue("12")).toBe(12);
    expect(parseValue("5 + random(3)")).toBe("5 + random(3)");
    expect(parseValue("wisdomBonus")).toBe("wisdomBonus");
    expect(parseValue("1 +")).toBeNull();
    expect(parseWhen("skill > 10, strength < 5")).toEqual(["skill > 10", "strength < 5"]);
    expect(parseWhen("skill >= 10")).toBeNull();
    expect(rowsFormula([{ op: "set", value: 7 }])).toBe(7);
    expect(rowsFormula([])).toBeUndefined();
    expect(chanceText(0.25)).toBe("1 in 4 (25.0%)");
    expect(chanceText(0)).toBe("never");
  });
});

describe("the Skills page", () => {
  test("lists the skills in order; opening one asks for it and fills its form", () => {
    const { p, calls, seq } = page();
    p.onShow();
    p.receive({ t: "contentSkills", seq: seq(), view: view(null) });
    const buttons = [...p.el.querySelectorAll<HTMLButtonElement>("[data-action='skills-open']")];
    expect(buttons.map((b) => b.dataset.skill)).toEqual(["Slash", "Mining", "Meditation"]);
    expect(buttons[2]?.textContent).toContain("hidden");
    buttons[0]?.click();
    expect(calls.view.at(-1)).toBe("Slash");
    p.receive({ t: "contentSkills", seq: seq(), view: view(slash("aaaaaaaaaaaaaaaa")) });
    const form = q<HTMLElement>(p.el, ".items-form");
    expect(form.hidden).toBe(false);
    // Opening it changes nothing.
    expect(p.changes()).toBe(0);
    expect(q<HTMLInputElement>(form, "[data-action='skills-display']").value).toBe("");
    const starts = [...form.querySelectorAll<HTMLInputElement>("[data-action='skills-start']")];
    expect(starts.map((s) => s.value)).toEqual(["20", ""]);
    // The chance preview: value 10 rolls random(10).
    const rows = [...form.querySelectorAll(".skills-preview tbody tr")];
    expect(rows).toHaveLength(101);
    expect(rows[10]?.textContent).toContain("1 in 10");
    expect(rows[0]?.textContent).toContain("at 0 it never rises");
  });

  test("a save sends the form with the fingerprint it was filled from; a refresh keeps the edit", () => {
    const { p, calls, seq } = page();
    p.open("Slash");
    p.receive({ t: "contentSkills", seq: seq(), view: view(slash("aaaaaaaaaaaaaaaa")) });
    const form = q<HTMLElement>(p.el, ".items-form");
    typeIn(q<HTMLInputElement>(form, "[data-action='skills-display']"), "Slashing");
    const starts = [...form.querySelectorAll<HTMLInputElement>("[data-action='skills-start']")];
    typeIn(starts[1] as HTMLInputElement, "5");
    const grant = q<HTMLInputElement>(form, "[data-action='skills-grant']");
    grant.checked = true;
    grant.dispatchEvent(new Event("change"));
    expect(p.changes()).toBe(1);
    // Someone else's change arrives: the edit stays, and the page says saving will be refused.
    p.published();
    p.receive({ t: "contentSkills", seq: seq(), view: view(slash("bbbbbbbbbbbbbbbb")) });
    expect(q<HTMLInputElement>(form, "[data-action='skills-display']").value).toBe("Slashing");
    expect(q<HTMLElement>(p.el, ".skills-stale").hidden).toBe(false);
    q<HTMLButtonElement>(p.el, "[data-action='skills-save']").click();
    const sent = calls.set.at(-1);
    expect(sent?.op).toBe("set");
    expect(sent?.expect).toBe("aaaaaaaaaaaaaaaa");
    expect(sent?.data).toMatchObject({
      display: "Slashing",
      starts: { "1": 20, "3": 5 },
      grants: [4],
      order: 1,
    });
  });

  test("a source's own settings edit its formula as rows; the preview follows the edit", () => {
    const { p, calls, seq } = page();
    p.open("Slash");
    p.receive({ t: "contentSkills", seq: seq(), view: view(slash("aaaaaaaaaaaaaaaa")) });
    const kill = q<HTMLElement>(p.el, "[data-source='kill']");
    const mode = q<HTMLSelectElement>(kill, "[data-action='skills-source-mode']");
    mode.value = "own";
    mode.dispatchEvent(new Event("change"));
    // The default's row is copied: set skill. Add 10 to it.
    q<HTMLButtonElement>(kill, "[data-action='skills-roll-add']").click();
    const values = [
      ...kill.querySelectorAll<HTMLInputElement>("[data-action='skills-roll-value']"),
    ];
    typeIn(values[1] as HTMLInputElement, "10");
    const rows = [...p.el.querySelectorAll(".skills-preview tbody tr")];
    expect(rows[10]?.textContent).toContain("1 in 20");
    q<HTMLButtonElement>(p.el, "[data-action='skills-save']").click();
    expect(calls.set.at(-1)?.data?.progression).toEqual({
      model: "chance",
      on: {
        kill: {
          roll: [
            { op: "set", value: "skill" },
            { op: "add", value: 10 },
          ],
          cap: 100,
        },
      },
    });
  });

  test("the XP model edits its curve; the preview is the level table", () => {
    const { p, calls, seq } = page();
    p.open("Slash");
    p.receive({ t: "contentSkills", seq: seq(), view: view(slash("aaaaaaaaaaaaaaaa")) });
    const model = q<HTMLSelectElement>(p.el, "[data-action='skills-model']");
    model.value = "xp";
    model.dispatchEvent(new Event("change"));
    expect(q<HTMLInputElement>(p.el, "[data-action='skills-curve-name']").value).toBe("steady");
    typeIn(q<HTMLInputElement>(p.el, "[data-action='skills-curve-table']"), "0, 50");
    const rows = [...p.el.querySelectorAll(".skills-preview tbody tr")];
    expect(rows[1]?.textContent).toContain("50");
    q<HTMLButtonElement>(p.el, "[data-action='skills-save']").click();
    expect(calls.set.at(-1)?.data).toMatchObject({
      progression: { model: "xp", curve: "steady" },
      curve: {
        name: "steady",
        curve: { counting: "perLevel", formula: 100, table: [0, 50] },
        // The curve's revision as the form loaded it: a newer edit refuses the save.
        expect: "1111111111111111",
      },
    });
  });

  test("what trains it links to where it is set", () => {
    const { p, calls, seq } = page();
    p.open("Slash");
    p.receive({ t: "contentSkills", seq: seq(), view: view(slash("aaaaaaaaaaaaaaaa")) });
    const links = [...p.el.querySelectorAll<HTMLButtonElement>("[data-action='skills-trainer']")];
    links[0]?.click();
    links[1]?.click();
    expect(calls.opened).toEqual(["item Long Sword", "node 2"]);
  });

  test("removal lists the uses; each is cleared or pointed at another skill", () => {
    const { p, calls, seq } = page();
    p.open("Slash");
    p.receive({ t: "contentSkills", seq: seq(), view: view(slash("aaaaaaaaaaaaaaaa")) });
    q<HTMLButtonElement>(p.el, "[data-action='skills-remove']").click();
    expect(calls.usage).toEqual(["Slash"]);
    const usage: ContentSkillUsage = {
      skill: "Slash",
      display: "Slash",
      uses: [
        {
          id: "a",
          where: "Start class 1: its start value",
          clearable: true,
          clears: "the class no longer sets it",
        },
        { id: "b", where: "Promotion to Grunt: needs it", clearable: false, clears: "" },
      ],
      characters: 3,
      bindings: [],
      fingerprint: "cccccccccccccccc",
    };
    p.receive({ t: "contentSkillUsage", seq: seq(), usage });
    expect(q<HTMLElement>(p.el, ".skills-removal").textContent).toContain(
      "3 characters have a value",
    );
    const to = [...p.el.querySelectorAll<HTMLSelectElement>("[data-action='skills-remove-to']")];
    expect(to[0]?.hidden).toBe(true);
    expect(to[1]?.hidden).toBe(false);
    // Without a skill for the pointed one, it asks for one.
    q<HTMLButtonElement>(p.el, "[data-action='skills-remove-confirm']").click();
    expect(calls.remove).toEqual([]);
    (to[1] as HTMLSelectElement).value = "Mining";
    to[1]?.dispatchEvent(new Event("change"));
    q<HTMLButtonElement>(p.el, "[data-action='skills-remove-confirm']").click();
    expect(calls.remove).toEqual([
      [
        "Slash",
        [
          { id: "a", action: "clear" },
          { id: "b", action: "replace", to: "Mining" },
        ],
        "cccccccccccccccc",
      ],
    ]);
  });

  test("a binding that names the skill keeps it from being removed", () => {
    const { p, seq } = page();
    p.open("Slash");
    p.receive({ t: "contentSkills", seq: seq(), view: view(slash("aaaaaaaaaaaaaaaa")) });
    q<HTMLButtonElement>(p.el, "[data-action='skills-remove']").click();
    p.receive({
      t: "contentSkillUsage",
      seq: seq(),
      usage: {
        skill: "Slash",
        display: "Slash",
        uses: [],
        characters: 0,
        bindings: ["parry"],
        fingerprint: "x",
      },
    });
    expect(q<HTMLButtonElement>(p.el, "[data-action='skills-remove-confirm']").disabled).toBe(true);
    expect(q<HTMLElement>(p.el, ".skills-removal").textContent).toContain("parry binding");
  });
});

describe("review fixes (issue #38)", () => {
  test("choosing another skill's curve sends only its name", () => {
    const { p, calls, seq } = page();
    p.open("Slash");
    p.receive({ t: "contentSkills", seq: seq(), view: view(slash("aaaaaaaaaaaaaaaa")) });
    const model = q<HTMLSelectElement>(p.el, "[data-action='skills-model']");
    model.value = "xp";
    model.dispatchEvent(new Event("change"));
    q<HTMLButtonElement>(p.el, "[data-action='skills-save']").click();
    const data = calls.set.at(-1)?.data;
    expect(data?.progression).toEqual({ model: "xp", curve: "steady" });
    expect(data && "curve" in data).toBe(false);
  });

  test("a field a redraw removes no longer blocks the save", () => {
    const { p, calls, seq } = page();
    p.open("Slash");
    p.receive({ t: "contentSkills", seq: seq(), view: view(slash("aaaaaaaaaaaaaaaa")) });
    const kill = q<HTMLElement>(p.el, "[data-source='kill']");
    const mode = q<HTMLSelectElement>(kill, "[data-action='skills-source-mode']");
    mode.value = "own";
    mode.dispatchEvent(new Event("change"));
    q<HTMLButtonElement>(kill, "[data-action='skills-roll-add']").click();
    const values = [
      ...kill.querySelectorAll<HTMLInputElement>("[data-action='skills-roll-value']"),
    ];
    typeIn(values[1] as HTMLInputElement, "not a value");
    const removes = [
      ...kill.querySelectorAll<HTMLButtonElement>("[data-action='skills-roll-remove']"),
    ];
    removes[1]?.click();
    q<HTMLButtonElement>(p.el, "[data-action='skills-save']").click();
    expect(calls.set.at(-1)?.op).toBe("set");
  });

  test("a kill's monster cap is a preview input", () => {
    const { p, seq } = page();
    p.open("Slash");
    p.receive({ t: "contentSkills", seq: seq(), view: view(slash("aaaaaaaaaaaaaaaa")) });
    const kill = q<HTMLElement>(p.el, "[data-source='kill']");
    const mode = q<HTMLSelectElement>(kill, "[data-action='skills-source-mode']");
    mode.value = "own";
    mode.dispatchEvent(new Event("change"));
    const cap = q<HTMLInputElement>(
      kill,
      "input[type='checkbox'][data-action='skills-monster-cap']",
    );
    cap.checked = true;
    cap.dispatchEvent(new Event("change"));
    typeIn(q<HTMLInputElement>(p.el, "[data-action='skills-preview-monster-cap']"), "20");
    const rows = [...p.el.querySelectorAll(".skills-preview tbody tr")];
    expect(rows[25]?.textContent).toContain("monster's cap");
    expect(rows[19]?.textContent).toContain("1 in 19");
  });

  test("a new skill's key is one word", () => {
    const { p, calls } = page();
    typeIn(q<HTMLInputElement>(p.el, "[data-action='skills-new-key']"), "Rock Climbing");
    q<HTMLButtonElement>(p.el, "[data-action='skills-create']").click();
    expect(calls.set).toEqual([]);
  });
});

describe("the plain-language form", () => {
  const open = (extra: Partial<ContentSkillView> = {}, list?: Partial<SkillListEntry>) => {
    const t = page();
    t.p.open("Slash");
    const v = view(slash("aaaaaaaaaaaaaaaa", extra));
    if (list) {
      v.skills[0] = entry("Slash", list);
    }
    t.p.receive({ t: "contentSkills", seq: t.seq(), view: v });
    return t;
  };
  const tags = (root: ParentNode) =>
    [...root.querySelectorAll(".items-form-head .balance-tag")].map((x) => x.textContent);

  test("formulas and the normal rules read as words, not as JSON", () => {
    expect(
      formulaText([
        { op: "set", value: "skill" },
        { op: "add", value: "wisdomBonus" },
      ]),
    ).toBe("skill + wisdomBonus");
    expect(formulaText([{ op: "multiply", value: 2, when: ["skill > 10"] }])).toBe(
      "× 2 (if skill > 10)",
    );
    expect(formulaText(100)).toBe("100");
    expect(settingsText("chance", { roll: [{ op: "set", value: "skill" }], cap: "faction" })).toBe(
      "Normally a 1 in (skill) chance to go up each time; it stops at the faction cap.",
    );
    expect(settingsText("xp", undefined)).toBe("Normally it doesn't go up this way.");
    const { p } = open();
    const kill = q<HTMLElement>(p.el, "[data-source='kill']");
    expect(kill.textContent).toContain("Killing a monster");
    expect(kill.textContent).toContain("Normally a 1 in (skill) chance");
    expect(kill.textContent).not.toContain("{");
  });

  test("a formula's steps are named in words and summed up as they are typed", () => {
    const { p } = open();
    const kill = q<HTMLElement>(p.el, "[data-source='kill']");
    const mode = q<HTMLSelectElement>(kill, "[data-action='skills-source-mode']");
    mode.value = "own";
    mode.dispatchEvent(new Event("change"));
    const op = q<HTMLSelectElement>(kill, "[data-action='skills-roll-op']");
    expect([...op.options].map((o) => o.textContent)).toEqual([
      "Set to",
      "Add",
      "Subtract",
      "Multiply by",
    ]);
    q<HTMLButtonElement>(kill, "[data-action='skills-roll-add']").click();
    typeIn(
      [
        ...kill.querySelectorAll<HTMLInputElement>("[data-action='skills-roll-value']"),
      ][1] as HTMLInputElement,
      "5",
    );
    expect(q<HTMLElement>(kill, ".skills-formula-sum").textContent).toBe("Works out as: skill + 5");
  });

  test("a cap is picked from a list: a number shows its own box; the save keeps the stored value", () => {
    const { p, calls } = open();
    const kill = q<HTMLElement>(p.el, "[data-source='kill']");
    const mode = q<HTMLSelectElement>(kill, "[data-action='skills-source-mode']");
    mode.value = "own";
    mode.dispatchEvent(new Event("change"));
    const kind = q<HTMLSelectElement>(kill, "[data-action='skills-cap-kind']");
    const n = q<HTMLInputElement>(kill, "input[data-action='skills-cap']");
    // The normal rule's cap of 100 is copied: a number.
    expect(kind.value).toBe("number");
    expect(n.hidden).toBe(false);
    kind.value = "faction";
    kind.dispatchEvent(new Event("change"));
    expect(n.hidden).toBe(true);
    expect(kind.selectedOptions[0]?.textContent).toContain("50");
    q<HTMLButtonElement>(p.el, "[data-action='skills-save']").click();
    expect(calls.set.at(-1)?.data?.progression?.on?.kill).toEqual({
      roll: [{ op: "set", value: "skill" }],
      cap: "faction",
    });
    kind.value = "number";
    kind.dispatchEvent(new Event("change"));
    typeIn(n, "500");
    expect(q<HTMLButtonElement>(p.el, "[data-action='skills-save']").disabled).toBe(true);
  });

  test("rare settings fold under More options, open when one is in use", () => {
    const { p } = open({
      row: {
        skill: "Slash",
        progression: {
          model: "chance",
          on: { kill: { roll: 10, requires: { skill: "Mining", above: 5 } } },
        },
      },
    });
    const kill = q<HTMLElement>(p.el, "[data-source='kill']");
    expect(q<HTMLDetailsElement>(kill, ".items-more").open).toBe(true);
    const shot = q<HTMLElement>(p.el, "[data-source='shot']");
    // The normal rule: no fields of its own, and only its sentence.
    expect(shot.querySelector(".items-more")).toBeNull();
  });

  test("tabs with settings of the skill's own carry a dot; the tags say where it stands", () => {
    const { p } = open({ pending: true }, { state: "edited" });
    const used = () =>
      Object.fromEntries(
        [...p.el.querySelectorAll<HTMLElement>(".items-group")].map((x) => [
          x.dataset.group,
          x.dataset.used,
        ]),
      );
    // Fighter starts at 20.
    expect(used()).toMatchObject({ basics: "false", starts: "true", rises: "false" });
    expect(tags(p.el)).toEqual(["Changed by you", "Unpublished changes"]);
    typeIn(q<HTMLInputElement>(p.el, "[data-action='skills-display']"), "Slashing");
    expect(used()).toMatchObject({ basics: "true" });
    const model = q<HTMLSelectElement>(p.el, "[data-action='skills-model']");
    model.value = "xp";
    model.dispatchEvent(new Event("change"));
    expect(used()).toMatchObject({ rises: "true" });
  });

  test("the Save bar: Undo shows once edited, Cancel unpublished changes only with a change", () => {
    const { p, calls } = open();
    expect(tags(p.el)).toEqual(["Original"]);
    expect(q<HTMLElement>(p.el, ".items-empty-form").hidden).toBe(true);
    const undo = q<HTMLButtonElement>(p.el, "[data-action='skills-undo-edit']");
    const drop = q<HTMLButtonElement>(p.el, "[data-action='skills-discard']");
    expect(undo.hidden).toBe(true);
    expect(drop.hidden).toBe(true);
    typeIn(q<HTMLInputElement>(p.el, "[data-action='skills-display']"), "Slashing");
    expect(undo.hidden).toBe(false);
    undo.click();
    expect(q<HTMLInputElement>(p.el, "[data-action='skills-display']").value).toBe("");
    expect(p.changes()).toBe(0);
    const t = open({ pending: true, published: false }, { state: "yours", pending: true });
    expect(tags(t.p.el)).toEqual(["Added by you", "Not published yet"]);
    const d = q<HTMLButtonElement>(t.p.el, "[data-action='skills-discard']");
    expect(d.hidden).toBe(false);
    d.click();
    expect(t.calls.set.at(-1)).toEqual({
      key: "Slash",
      op: "discard",
      expect: "aaaaaaaaaaaaaaaa",
    });
    expect(calls.set).toEqual([]);
  });

  test("a pack skill with unpublished changes is changed by you", () => {
    const { p } = open({ pending: true });
    expect(tags(p.el)).toEqual(["Changed by you", "Unpublished changes"]);
  });

  test("a new skill asks for a level curve only when it earns XP", () => {
    const { p } = page();
    const model = q<HTMLSelectElement>(p.el, "[data-action='skills-new-model']");
    const curve = q<HTMLInputElement>(p.el, "[data-action='skills-new-curve']");
    expect(curve.closest<HTMLElement>(".control-panel-field")?.hidden).toBe(true);
    model.value = "xp";
    model.dispatchEvent(new Event("change"));
    expect(curve.closest<HTMLElement>(".control-panel-field")?.hidden).toBe(false);
  });

  describe("restoring the original", () => {
    const pack = {
      display: "",
      hidden: false,
      progression: null,
      order: 1,
      starts: { "1": 20, "3": null },
      grants: [],
      curve: null,
    };
    test("an original skill shows no restore buttons; a changed one does", () => {
      const original = open({ pack, differs: false });
      expect(tags(original.p.el)).toContain("Original");
      expect(q<HTMLButtonElement>(original.p.el, "[data-action='skills-revert']").hidden).toBe(
        true,
      );
      expect(q<HTMLButtonElement>(original.p.el, "[data-action='skills-pack-basics']").hidden).toBe(
        true,
      );
      document.body.replaceChildren();
      const changed = open({ pack, differs: true, row: { skill: "Slash", display: "Slashing" } });
      expect(tags(changed.p.el)).toContain("Changed by you");
      const revert = q<HTMLButtonElement>(changed.p.el, "[data-action='skills-revert']");
      expect(revert.hidden).toBe(false);
      revert.click();
      expect(changed.calls.set.at(-1)).toEqual({
        key: "Slash",
        op: "revert",
        expect: "aaaaaaaaaaaaaaaa",
      });
    });

    test("Restore this tab puts that tab's fields back to the pack's, to be saved", () => {
      const { p, calls } = open({
        pack,
        differs: true,
        row: { skill: "Slash", display: "Slashing", hidden: true },
        starts: [
          { code: 1, label: "Fighter", value: 30 },
          { code: 3, label: "Ranger", value: null },
        ],
      });
      // Starting values differ too, but only Basics is restored.
      const basics = q<HTMLButtonElement>(p.el, "[data-action='skills-pack-basics']");
      expect(basics.hidden).toBe(false);
      basics.click();
      expect(q<HTMLInputElement>(p.el, "[data-action='skills-display']").value).toBe("");
      expect(q<HTMLButtonElement>(p.el, "[data-action='skills-pack-basics']").hidden).toBe(true);
      expect(q<HTMLButtonElement>(p.el, "[data-action='skills-pack-starts']").hidden).toBe(false);
      q<HTMLButtonElement>(p.el, "[data-action='skills-save']").click();
      expect(calls.set.at(-1)?.data).toMatchObject({
        display: "",
        hidden: false,
        starts: { "1": 30, "3": null },
      });
    });

    test("a skill of your own has nothing to restore", () => {
      const { p } = open({ pack: null, inPack: false }, { state: "yours" });
      expect(tags(p.el)).toContain("Added by you");
      expect(q<HTMLButtonElement>(p.el, "[data-action='skills-revert']").hidden).toBe(true);
      expect(p.el.querySelector("[data-action='skills-pack-basics']")).toBeNull();
    });
  });
});
