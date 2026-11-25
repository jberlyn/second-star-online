/**
 * The Control Panel's Items page (issue #30, stage 3): the item list with search and kinds, the
 * form for the open item with where each rule comes from, edits sent with the item as the page saw
 * it, a form locked while its save is on its way, refreshes that never overwrite an edit, stale
 * answers ignored, and the app routing the page's messages.
 */
import { afterEach, describe, expect, test } from "bun:test";

import type { ItemDefinition } from "@secondstaronline/data";
import type {
  ContentItemsView,
  ContentItemView,
  ContentRowRef,
  ItemListEntry,
} from "@secondstaronline/shared";

import {
  canonical,
  createItemsPage,
  type ItemChange,
  rollBounds,
  rollFrom,
  rollRange,
} from "../src/ui/items-page.ts";

afterEach(() => document.body.replaceChildren());

const entry = (name: string, kind: ItemListEntry["kind"], extra: Partial<ItemListEntry> = {}) =>
  ({
    name,
    display: name,
    kind,
    state: "pack",
    retired: false,
    pending: false,
    ...extra,
  }) satisfies ItemListEntry;

const LIST = [
  entry("Apple", "food"),
  entry("Long Sword", "weapon"),
  entry("Leather Armor", "armour"),
  entry("Moon Sword", "weapon", { state: "yours", display: "Moonblade" }),
];

const sword = (
  fp: string,
  form: Partial<ItemDefinition> = {},
  extra: Partial<ContentItemView> = {},
): ContentItemView => ({
  name: "Long Sword",
  display: "",
  retired: false,
  inPack: true,
  form: {
    name: "Long Sword",
    slot: "LeftHand",
    strength: 8,
    behaviours: ["sword"],
    attack: { base: [{ flat: 6, randomN: 6 }] },
    trains: ["Slash"],
    ...form,
  },
  defined: false,
  pack: {
    name: "Long Sword",
    slot: "LeftHand",
    strength: 8,
    attack: { base: [{ flat: 6, randomN: 6 }] },
  },
  sources: [
    { group: "basics", label: "Worn in", from: 'the pack\'s contains "Long Sword" (row 90)' },
    { group: "weapon", label: "Damage", from: 'the pack\'s contains "Long Sword" (row 8)' },
  ],
  edited: false,
  pending: { definition: null, catalogue: null },
  fingerprint: fp,
  notice: null,
  choices: {
    slots: ["Head", "Body", "LeftHand", "RightHand", "Feet", "Ring", "No"],
    slotVars: ["BodyE", "HeadE"],
    breakArmourSlots: ["BodyE", "HeadE", "RightHandE"],
    breakWeaponSlots: ["LeftHandE"],
    wornSlots: ["weapon", "ring"],
    behaviours: ["key", "sword"],
    powers: ["attack"],
    stats: ["HP", "SP", "Hunger"],
    skills: ["Slash", "Thrust"],
    toolCans: ["Chop", "Mine"],
    ladders: ["axe"],
    menus: ["Cook", "Storage"],
    layers: ["weapon", "shield"],
    groundLayers: ["hidden", "overChars"],
  },
  ...extra,
});

const view = (item: ContentItemView | null, items = LIST, itemDraft = 0): ContentItemsView => ({
  items,
  item,
  otherDraft: 0,
  itemDraft,
});

function page() {
  const asked: { seq: number; name?: string }[] = [];
  const sent: { seq: number; change: ItemChange }[] = [];
  const openedRows: ContentRowRef[] = [];
  const p = createItemsPage({
    view: (seq, name) => asked.push({ seq, ...(name !== undefined ? { name } : {}) }),
    set: (seq, change) => sent.push({ seq, change }),
    openContent: () => {},
    openContentRow: (r) => openedRows.push(r),
    panels: () => null,
  });
  document.body.append(p.el);
  const q = <T extends HTMLElement>(sel: string) => p.el.querySelector<T>(sel) as T;
  const act = <T extends HTMLElement>(a: string) => q<T>(`[data-action="${a}"]`);
  const type = (a: string, value: string) => {
    const i = act<HTMLInputElement>(a);
    i.value = value;
    i.dispatchEvent(new Event("input"));
  };
  const listed = () =>
    [...p.el.querySelectorAll<HTMLButtonElement>('[data-action="items-open"]')].map(
      (b) => b.dataset.item,
    );
  return { p, asked, sent, openedRows, q, act, type, listed };
}

/** Opens Long Sword: the list, then its form. */
function opened(fp = "a".repeat(16)) {
  const t = page();
  t.p.onShow();
  t.p.receive({ t: "contentItems", seq: 1, view: view(null) });
  t.p.open("Long Sword");
  t.p.receive({ t: "contentItems", seq: 2, view: view(sword(fp)) });
  return t;
}

describe("the Items page", () => {
  test("lists every item; Find and the kind narrow it", () => {
    const t = page();
    t.p.onShow();
    expect(t.asked).toEqual([{ seq: 1 }]);
    t.p.receive({ t: "contentItems", seq: 1, view: view(null) });
    expect(t.listed()).toEqual(["Apple", "Long Sword", "Leather Armor", "Moon Sword"]);
    t.type("items-search", "moonblade");
    expect(t.listed()).toEqual(["Moon Sword"]);
    t.type("items-search", "");
    const kind = t.act<HTMLSelectElement>("items-kind");
    kind.value = "weapon";
    kind.dispatchEvent(new Event("change"));
    expect(t.listed()).toEqual(["Long Sword", "Moon Sword"]);
    kind.value = "changed";
    kind.dispatchEvent(new Event("change"));
    expect(t.listed()).toEqual(["Moon Sword"]);
  });

  test("an item opens with what it plays and where each rule comes from", () => {
    const t = opened();
    expect(t.asked.at(-1)).toEqual({ seq: 2, name: "Long Sword" });
    expect(t.q(".items-form").hidden).toBe(false);
    expect(t.q(".items-form h2").textContent).toBe("Long Sword");
    expect(t.act<HTMLSelectElement>("items-slot").value).toBe("LeftHand");
    expect(t.act<HTMLInputElement>("items-strength").value).toBe("8");
    expect(t.p.el.textContent).toContain('Worn in: the pack\'s contains "Long Sword" (row 90)');
    // Damage reads as "from … to …", not `flat + random(n)`.
    expect(t.act<HTMLInputElement>("items-base-flat-from").value).toBe("7");
    expect(t.act<HTMLInputElement>("items-base-flat-to").value).toBe("12");
    // Nothing edited: nothing to save.
    expect(t.act<HTMLButtonElement>("items-save").disabled).toBe(true);
    expect(t.p.changes()).toBe(0);
  });

  test("an edit is saved as the whole definition, with the item as the page saw it", () => {
    const t = opened("a".repeat(16));
    t.type("items-strength", "23");
    expect(t.p.changes()).toBe(1);
    t.act<HTMLButtonElement>("items-save").click();
    expect(t.sent).toHaveLength(1);
    const c = t.sent[0]?.change as ItemChange;
    expect(c.op).toBe("set");
    expect(c.expect).toBe("a".repeat(16));
    expect(c.data).toEqual({
      attack: { base: [{ flat: 6, randomN: 6 }] },
      behaviours: ["sword"],
      name: "Long Sword",
      slot: "LeftHand",
      strength: 23,
      trains: ["Slash"],
    });
  });

  test("a form being saved is locked, and keeps nothing typed meanwhile", () => {
    const t = opened();
    t.type("items-strength", "23");
    t.act<HTMLButtonElement>("items-save").click();
    // Locked before the request went: the rules' fieldset is disabled.
    expect(t.q<HTMLFieldSetElement>(".items-rules").disabled).toBe(true);
    expect(t.p.changes()).toBe(0);
    // A publish refresh meanwhile does not unlock it or refill it.
    t.p.published();
    t.p.receive({ t: "contentItems", seq: 4, view: view(sword("b".repeat(16))) });
    expect(t.q<HTMLFieldSetElement>(".items-rules").disabled).toBe(true);
    expect(t.act<HTMLInputElement>("items-strength").value).toBe("23");
    // The save's answer (older than that view) unlocks it and keeps the newest view.
    t.p.receive({
      t: "contentItems",
      seq: 3,
      view: view(sword("c".repeat(16), { strength: 23 })),
      result: { ok: true, text: "Long Sword is in the draft." },
    });
    expect(t.q<HTMLFieldSetElement>(".items-rules").disabled).toBe(false);
    expect(t.p.el.textContent).toContain("Long Sword is in the draft.");
  });

  test("a refresh never overwrites an edit, and says when the item changed under it", () => {
    const t = opened("a".repeat(16));
    t.type("items-strength", "30");
    t.p.published();
    t.p.receive({
      t: "contentItems",
      seq: 3,
      view: view(sword("b".repeat(16), { strength: 12 })),
    });
    expect(t.act<HTMLInputElement>("items-strength").value).toBe("30");
    expect(t.q(".items-form .balance-stale:not([hidden])").textContent).toContain(
      "Someone changed this item",
    );
    // Dropping the edit shows theirs.
    t.act<HTMLButtonElement>("items-undo-edit").click();
    expect(t.act<HTMLInputElement>("items-strength").value).toBe("12");
  });

  test("an answer older than the view shown is ignored", () => {
    const t = opened("a".repeat(16));
    t.p.receive({ t: "contentItems", seq: 1, view: view(sword("z".repeat(16), { strength: 99 })) });
    expect(t.act<HTMLInputElement>("items-strength").value).toBe("8");
  });

  test("a value out of its limits is refused before sending", () => {
    const t = opened();
    t.type("items-strength", "999");
    expect(t.act<HTMLButtonElement>("items-save").disabled).toBe(true);
    expect(t.p.el.textContent).toContain("Strength needed: a whole number from 0 to 200");
  });

  test("a refusal names the form's fields", () => {
    const t = opened();
    t.type("items-strength", "23");
    t.act<HTMLButtonElement>("items-save").click();
    t.p.receive({
      t: "contentItems",
      seq: 3,
      view: view(sword("a".repeat(16))),
      result: {
        ok: false,
        text: "Long Sword was not saved.",
        problems: [
          { where: "Skills it trains", message: "names a skill that does not exist: Basket" },
        ],
      },
    });
    expect(t.p.el.textContent).toContain(
      "Long Sword was not saved. Skills it trains: names a skill that does not exist: Basket",
    );
    // The edit stays to fix.
    expect(t.act<HTMLInputElement>("items-strength").value).toBe("23");
  });

  test("a damage roll is added and removed", () => {
    const t = opened();
    t.act<HTMLButtonElement>("items-base-add").click();
    const rolls = t.p.el.querySelectorAll('[data-list="base"] .items-list-row');
    expect(rolls.length).toBe(2);
    const from = t.p.el.querySelectorAll<HTMLInputElement>('[data-action="items-base-flat-from"]');
    expect(from[1]?.value).toBe("2");
    (
      t.p.el.querySelectorAll<HTMLButtonElement>(
        '[data-action="items-base-remove"]',
      )[1] as HTMLButtonElement
    ).click();
    expect(t.p.el.querySelectorAll('[data-list="base"] .items-list-row').length).toBe(1);
    expect(t.p.changes()).toBe(0);
  });

  test("the pack's rules for a group come back into the form", () => {
    const t = opened();
    t.type("items-strength", "40");
    t.q<HTMLButtonElement>('[data-action="items-pack-basics"]').click();
    expect(t.act<HTMLInputElement>("items-strength").value).toBe("8");
    // The pack has no behaviours row: they go.
    expect(t.act<HTMLInputElement>("items-behaviour-sword").checked).toBe(false);
  });

  test("switching items with an edit is refused until it is saved or dropped", () => {
    const t = opened();
    t.type("items-strength", "23");
    t.p.open("Apple");
    expect(t.asked.at(-1)).toEqual({ seq: 2, name: "Long Sword" });
    expect(t.p.el.textContent).toContain("unsaved changes");
  });

  test("New makes an item from another and opens it", () => {
    const t = page();
    t.p.onShow();
    t.p.receive({ t: "contentItems", seq: 1, view: view(null) });
    t.type("items-new-name", "Star Sword");
    t.type("items-new-copy", "Long Sword");
    t.act<HTMLButtonElement>("items-create").click();
    expect(t.sent[0]?.change).toEqual({ name: "Star Sword", op: "create", copyFrom: "Long Sword" });
    t.p.receive({
      t: "contentItems",
      seq: 2,
      view: view(
        sword(
          "d".repeat(16),
          { name: "Star Sword" },
          { name: "Star Sword", inPack: false, defined: true, pack: null },
        ),
      ),
      result: { ok: true, text: "Star Sword is in the draft." },
    });
    expect(t.q(".items-form h2").textContent).toBe("Star Sword");
    expect(t.act<HTMLInputElement>("items-new-name").value).toBe("");
  });

  test("Remove opens the item's where-used report on the Content page", () => {
    const t = opened();
    t.act<HTMLButtonElement>("items-remove").click();
    expect(t.openedRows).toEqual([{ dataset: "items", part: "items", key: "Long Sword" }]);
  });

  test("Save sends a new name alone; Restore the original drops the definition", () => {
    const t = opened("a".repeat(16));
    t.type("items-display", "Old Sword");
    t.act<HTMLButtonElement>("items-save").click();
    expect(t.sent[0]?.change).toEqual({
      name: "Long Sword",
      op: "rename",
      display: "Old Sword",
      expect: "a".repeat(16),
    });
    t.p.receive({
      t: "contentItems",
      seq: 3,
      view: view(sword("e".repeat(16), {}, { defined: true, edited: true })),
      result: { ok: true, text: "Long Sword is called Old Sword in the draft." },
    });
    t.act<HTMLButtonElement>("items-revert").click();
    expect(t.sent[1]?.change).toEqual({ name: "Long Sword", op: "revert", expect: "e".repeat(16) });
  });

  test("one Save sends the rules, then the name, naming the item as the rules' save left it", () => {
    const t = opened("a".repeat(16));
    t.type("items-strength", "23");
    t.type("items-display", "Old Sword");
    t.act<HTMLButtonElement>("items-save").click();
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]?.change.op).toBe("set");
    // The rules' answer: saved. The name goes next, with the new fingerprint.
    t.p.receive({
      t: "contentItems",
      seq: 3,
      view: view(sword("b".repeat(16), { strength: 23 }, { defined: true })),
      result: { ok: true, text: "Long Sword is in the draft." },
    });
    expect(t.sent[1]?.change).toEqual({
      name: "Long Sword",
      op: "rename",
      display: "Old Sword",
      expect: "b".repeat(16),
    });
    t.p.receive({
      t: "contentItems",
      seq: 4,
      view: view(sword("c".repeat(16), { strength: 23 }, { display: "Old Sword", defined: true })),
      result: { ok: true, text: "Long Sword is called Old Sword in the draft." },
    });
    expect(t.q(".items-form h2").textContent).toBe("Old Sword");
    expect(t.p.changes()).toBe(0);
  });

  test("a refused rules save sends no name, and keeps both edits", () => {
    const t = opened("a".repeat(16));
    t.type("items-strength", "23");
    t.type("items-display", "Old Sword");
    t.act<HTMLButtonElement>("items-save").click();
    t.p.receive({
      t: "contentItems",
      seq: 3,
      view: view(sword("a".repeat(16))),
      result: { ok: false, text: "Long Sword was not saved." },
    });
    expect(t.sent).toHaveLength(1);
    expect(t.act<HTMLInputElement>("items-strength").value).toBe("23");
    expect(t.act<HTMLInputElement>("items-display").value).toBe("Old Sword");
  });

  test("a name save keeps unsaved rule edits, and a rules save keeps a typed name", () => {
    const t = opened("a".repeat(16));
    t.type("items-display", "Old Sword");
    t.act<HTMLButtonElement>("items-save").click();
    // Typed while the name was on its way? The form is locked: type after the answer.
    t.p.receive({
      t: "contentItems",
      seq: 3,
      view: view(
        sword(
          "b".repeat(16),
          {},
          { display: "Old Sword", pending: { definition: null, catalogue: "set" } },
        ),
      ),
      result: { ok: true, text: "Long Sword is called Old Sword in the draft." },
    });
    t.type("items-strength", "23");
    // A refresh with the name only: the rule edit stays, saveable against the item as it is now.
    t.p.published();
    t.p.receive({
      t: "contentItems",
      seq: 5,
      view: view(
        sword(
          "c".repeat(16),
          {},
          { display: "Old Sword", pending: { definition: null, catalogue: "set" } },
        ),
      ),
    });
    expect(t.act<HTMLInputElement>("items-strength").value).toBe("23");
    t.act<HTMLButtonElement>("items-save").click();
    expect(t.sent[1]?.change.expect).toBe("c".repeat(16));
  });

  test("a refused New item leaves the open item and its edits alone", () => {
    const t = opened();
    t.type("items-strength", "23");
    t.type("items-new-name", "Crate#1");
    t.act<HTMLButtonElement>("items-create").click();
    t.p.receive({
      t: "contentItems",
      seq: 3,
      view: view(null),
      result: { ok: false, text: "Crate#1 is a name the game gives its own things" },
    });
    expect(t.q(".items-form").hidden).toBe(false);
    expect(t.act<HTMLInputElement>("items-strength").value).toBe("23");
  });

  test("removing a list row keeps another field's error", () => {
    const t = opened();
    t.type("items-strength", "999");
    // Long Sword has one attack roll: take it out.
    t.act<HTMLButtonElement>("items-base-remove").click();
    expect(t.act<HTMLButtonElement>("items-save").disabled).toBe(true);
    expect(t.p.el.textContent).toContain("Strength needed: a whole number from 0 to 200");
  });

  test("a name the server could never answer is refused before the form locks", () => {
    const t = opened();
    t.type("items-display", "x".repeat(41));
    t.act<HTMLButtonElement>("items-save").click();
    expect(t.sent).toHaveLength(0);
    expect(t.q<HTMLFieldSetElement>(".items-rules").disabled).toBe(false);
  });

  test("the pictures follow a new slot, and Discard drops unsaved pictures too", () => {
    const shows: [string, boolean | undefined][] = [];
    const p = createItemsPage({
      view: () => {},
      set: () => {},
      openContent: () => {},
      openContentRow: () => {},
      panels: () => ({
        el: document.createElement("div"),
        show: (key, force) => shows.push([key, force]),
        clear: () => {},
        pending: () => false,
      }),
    });
    document.body.append(p.el);
    p.onShow();
    p.receive({ t: "contentItems", seq: 1, view: view(null) });
    p.open("Long Sword");
    p.receive({
      t: "contentItems",
      seq: 2,
      view: view(sword("a".repeat(16), { slot: undefined })),
    });
    expect(shows).toEqual([["Long Sword", undefined]]);
    // Its first slot saved: the worn panel is asked for again.
    p.receive({
      t: "contentItems",
      seq: 3,
      view: view(sword("b".repeat(16), { slot: "LeftHand" })),
    });
    expect(shows.at(-1)).toEqual(["Long Sword", undefined]);
    expect(shows).toHaveLength(2);
    p.discard();
    expect(shows.at(-1)).toEqual(["Long Sword", true]);
  });

  test("reset drops everything, the search included", () => {
    const t = opened();
    t.type("items-search", "zebra");
    t.p.reset();
    expect(t.act<HTMLInputElement>("items-search").value).toBe("");
    expect(t.q(".items-form").hidden).toBe(true);
    expect(t.listed()).toEqual([]);
    // An answer to a request sent before the reset is dropped.
    t.p.receive({ t: "contentItems", seq: 2, view: view(sword("a".repeat(16))) });
    expect(t.listed()).toEqual([]);
  });

  test("helpers: a roll's range, and a form compared without its empty parts", () => {
    expect(rollRange(6, 6)).toBe("Rolls 7 to 12");
    expect(rollRange(3, 0)).toBe("Always 3");
    expect(rollBounds(6, 6)).toEqual({ from: 7, to: 12 });
    expect(rollBounds(6, 0)).toEqual({ from: 6, to: 6 });
    expect(rollBounds(6, null)).toEqual({ from: 6, to: 6 });
    expect(rollFrom(7, 12)).toEqual({ flat: 6, randomN: 6 });
    expect(rollFrom(6, 6)).toEqual({ flat: 6, randomN: 0 });
    for (const [flat, n] of [
      [-3, 4],
      [0, 1],
      [10, 0],
    ] as const) {
      const b = rollBounds(flat, n);
      const back = rollFrom(b.from, b.to);
      expect(rollBounds(back.flat, back.randomN)).toEqual(b);
    }
    expect(canonical({ b: 1, a: { x: [] }, use: {} })).toBe(canonical({ b: 1 }));
  });
});

describe("the rest of the definition (#30 stage 4)", () => {
  test("a tool use, a broken form, break slots, a ground flag and a list toggle save", () => {
    const t = opened();
    t.act("items-tools-add").click();
    t.type("items-damaged", "Broken Sword");
    t.act<HTMLInputElement>("items-breaks-weapon-LeftHandE").click();
    t.act<HTMLInputElement>("items-ground-blocks").click();
    t.act<HTMLInputElement>("items-in-shops").click();
    const tier = t.act<HTMLInputElement>("items-tools-tier");
    tier.value = "";
    tier.dispatchEvent(new Event("input"));
    t.act("items-save").click();
    const data = t.sent.at(-1)?.change.data as Record<string, unknown>;
    expect(data.tools).toEqual([{ can: "Chop" }]);
    expect(data.damaged).toBe("Broken Sword");
    expect(data.breaks).toEqual({ weapon: ["LeftHandE"] });
    expect(data.ground).toEqual({ blocks: true });
    expect(data.inPlayerShops).toBe(true);
  });

  test("clearing a group's last field leaves the group out, and a bad number is refused", () => {
    const t = opened();
    t.act<HTMLInputElement>("items-ground-blocks").click();
    t.act<HTMLInputElement>("items-ground-blocks").click();
    t.type("items-ground-offset-dx", "99999");
    expect(t.act<HTMLButtonElement>("items-save").disabled).toBe(true);
    t.type("items-ground-offset-dx", "");
    expect(t.act<HTMLButtonElement>("items-save").disabled).toBe(true);
  });
});

describe("stage 4 review fixes (#30)", () => {
  test("the break slots offered are the ones the engine rolls (Sol 8)", () => {
    const t = opened();
    const ticks = (kind: string) =>
      [...t.p.el.querySelectorAll(`[data-list="breaks-${kind}"] input`)].map(
        (i) => (i as HTMLElement).dataset.action,
      );
    expect(ticks("armour")).toEqual([
      "items-breaks-armour-BodyE",
      "items-breaks-armour-HeadE",
      "items-breaks-armour-RightHandE",
    ]);
    expect(ticks("weapon")).toEqual(["items-breaks-weapon-LeftHandE"]);
  });

  test("the pack's rules for one group leave another group's unread text and error (Sol 12)", () => {
    const t = opened();
    t.type("items-ground-offset-dx", "99999");
    t.q<HTMLButtonElement>('[data-action="items-pack-basics"]').click();
    expect(t.act<HTMLInputElement>("items-ground-offset-dx").value).toBe("99999");
    expect(t.act<HTMLButtonElement>("items-save").disabled).toBe(true);
  });

  test("the pictures follow a saved worn alias, behaviour or ground offset (Neon 9)", () => {
    const shows: string[] = [];
    const p = createItemsPage({
      view: () => {},
      set: () => {},
      openContent: () => {},
      openContentRow: () => {},
      panels: () => ({
        el: document.createElement("div"),
        show: (key) => shows.push(key),
        clear: () => {},
        pending: () => false,
      }),
    });
    document.body.append(p.el);
    p.onShow();
    p.receive({ t: "contentItems", seq: 1, view: view(null) });
    p.open("Long Sword");
    p.receive({ t: "contentItems", seq: 2, view: view(sword("a".repeat(16))) });
    expect(shows).toHaveLength(1);
    p.receive({
      t: "contentItems",
      seq: 3,
      view: view(sword("b".repeat(16), { paperdoll: [{ layer: "weapon", becomes: "Axe" }] })),
    });
    expect(shows).toHaveLength(2);
    p.receive({
      t: "contentItems",
      seq: 4,
      view: view(
        sword("c".repeat(16), {
          paperdoll: [{ layer: "weapon", becomes: "Axe" }],
          ground: { offset: { dx: 1, dy: 2 } },
        }),
      ),
    });
    expect(shows).toHaveLength(3);
  });
});

/** The definition the last Save sent. */
function savedData(sent: readonly { change: ItemChange }[]): ItemDefinition {
  const last = sent.at(-1);
  if (!last) {
    throw new Error("nothing was sent");
  }
  return last.change.data as ItemDefinition;
}

describe("the plain-language form", () => {
  test("damage typed as from and to saves as the roll that gives it", () => {
    const t = opened();
    t.type("items-base-flat-from", "10");
    t.type("items-base-flat-to", "15");
    t.act("items-save").click();
    expect(savedData(t.sent).attack?.base).toEqual([{ flat: 9, randomN: 6 }]);
  });

  test("a fixed amount rolls nothing, and 'to' below 'from' is refused", () => {
    const t = opened();
    t.type("items-base-flat-from", "9");
    t.type("items-base-flat-to", "9");
    expect(t.act<HTMLButtonElement>("items-save").disabled).toBe(false);
    t.type("items-base-flat-to", "3");
    expect(t.act<HTMLButtonElement>("items-save").disabled).toBe(true);
    expect(t.p.el.textContent).toContain('"to" no lower than "from"');
    t.type("items-base-flat-to", "9");
    t.act("items-save").click();
    expect(savedData(t.sent).attack?.base).toEqual([{ flat: 9, randomN: 0 }]);
  });

  test("protection shows as less damage, and is saved with the rules' sign", () => {
    const t = page();
    t.p.onShow();
    t.p.receive({ t: "contentItems", seq: 1, view: view(null) });
    t.p.open("Long Sword");
    t.p.receive({
      t: "contentItems",
      seq: 2,
      view: view(sword("a".repeat(16), { armour: [{ slot: "BodyE", hitMe: -4, hitMe2: null }] })),
    });
    expect(t.act<HTMLInputElement>("items-armour-hitMe").value).toBe("4");
    expect(t.act<HTMLInputElement>("items-armour-hitMe2").value).toBe("");
    t.type("items-armour-hitMe", "6");
    t.type("items-armour-hitMe2", "2");
    t.act("items-save").click();
    expect(savedData(t.sent).armour).toEqual([{ slot: "BodyE", hitMe: -6, hitMe2: -2 }]);
    // The slot reads as a place, not a variable.
    const slot = t.act<HTMLSelectElement>("items-armour-slot");
    expect(slot.selectedOptions[0]?.textContent).toBe("Body");
  });

  test("a tab with settings is marked, and the mark follows an edit", async () => {
    const t = opened();
    const used = () =>
      [...t.p.el.querySelectorAll<HTMLButtonElement>(".control-panel-tab-used")].map(
        (b) => b.dataset.tab,
      );
    // The tab strip follows the form a moment later (it watches it).
    const settle = () => new Promise((r) => setTimeout(r, 0));
    await settle();
    expect(used()).toEqual(["Basics", "Weapon"]);
    t.act<HTMLInputElement>("items-ground-blocks").click();
    await settle();
    expect(used()).toEqual(["Basics", "Weapon", "On the ground"]);
  });

  test("Restore this tab shows only where the item differs from the pack", () => {
    const t = opened();
    const restore = (id: string) => t.act<HTMLButtonElement>(`items-pack-${id}`);
    // The sword's behaviours and training are its own, not the pack's (which has none).
    expect(restore("basics").hidden).toBe(false);
    expect(restore("armour").hidden).toBe(true);
    t.act<HTMLInputElement>("items-ground-blocks").click();
    expect(restore("ground").hidden).toBe(false);
  });

  test("rarely used fields are folded away, and open when the item uses one", () => {
    const t = opened();
    const more = (group: string) =>
      t.q<HTMLDetailsElement>(`.items-group[data-group="${group}"] .items-more`);
    expect(more("weapon").open).toBe(false);
    expect(more("ground").open).toBe(false);
    const u = page();
    u.p.onShow();
    u.p.receive({ t: "contentItems", seq: 1, view: view(null) });
    u.p.open("Long Sword");
    u.p.receive({
      t: "contentItems",
      seq: 2,
      view: view(sword("a".repeat(16), { ground: { offset: { dx: 1, dy: 2 } } })),
    });
    expect(u.q<HTMLDetailsElement>('.items-group[data-group="ground"] .items-more').open).toBe(
      true,
    );
    expect(u.act<HTMLInputElement>("items-ground-offset-dy").value).toBe("2");
  });

  test("abilities and trained skills show what is ticked, the rest folded under Add", () => {
    const t = opened();
    const pick = t.q('[data-list="behaviours"]');
    const shownTicks = [...pick.querySelectorAll(":scope > .items-checks input")].map(
      (i) => (i as HTMLElement).dataset.action,
    );
    expect(shownTicks).toEqual(["items-behaviour-sword"]);
    const folded = [...pick.querySelectorAll(".items-more-picks input")].map(
      (i) => (i as HTMLElement).dataset.action,
    );
    expect(folded).toEqual(["items-behaviour-key"]);
    // Ticking a folded one saves it.
    t.act<HTMLInputElement>("items-behaviour-key").click();
    t.act("items-save").click();
    expect(savedData(t.sent).behaviours).toEqual(["key", "sword"]);
  });

  test("an offset typed as two numbers saves as one", () => {
    const t = opened();
    t.type("items-ground-offset-dy", "-8");
    t.act("items-save").click();
    expect(savedData(t.sent).ground).toEqual({
      offset: { dx: 0, dy: -8 },
    });
  });

  test("the Ctrl message is a line and a tick box, not JSON", () => {
    const t = opened();
    t.type("items-ground-ctrl", "It is too heavy.");
    t.act<HTMLInputElement>("items-ground-ctrl-unpause").click();
    t.act("items-save").click();
    expect(savedData(t.sent).ground).toEqual({
      ctrlText: { text: "It is too heavy.", unpause: true },
    });
  });
});
