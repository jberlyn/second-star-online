/**
 * The Control Panel's Balance page (issue #19): rows of the balance dataset with what plays now,
 * the pack's value and the engine's default; edits go to the draft with the row as the page saw
 * it; refreshes never overwrite a row being edited; stale answers are ignored; limits are checked
 * before sending; and the app routes the page's messages.
 */
import { afterEach, describe, expect, test } from "bun:test";

import type { AssetIndex } from "@secondstaronline/data";
import {
  type BalanceRowView,
  type ContentBalanceView,
  type ContentRowRef,
  content,
  PERMISSIONS,
  type ServerMsg,
} from "@secondstaronline/shared";

import { runApp } from "../src/app.ts";
import type { Assets } from "../src/assets.ts";
import type { Connection } from "../src/net.ts";
import {
  amountPreview,
  type BalanceChange,
  createBalancePage,
  fieldError,
  shownValue,
} from "../src/ui/balance-page.ts";
import { SNAPSHOT } from "./helpers/menu-helpers.ts";

afterEach(() => document.body.replaceChildren());

const hull = (key: string, now: number, fp: string, extra: Partial<BalanceRowView> = {}) =>
  ({
    part: "hulls",
    key,
    label: `${key} hull`,
    fields: [{ path: ["hull"], label: "Full hull", unit: "count", min: 1, max: 100_000 }],
    engine: { vehicle: key, hull: 60 },
    pack: { vehicle: key, hull: 60 },
    published: { vehicle: key, hull: now },
    draft: { vehicle: key, hull: now },
    edited: false,
    pending: null,
    fingerprint: fp,
    notice: null,
    ...extra,
  }) satisfies BalanceRowView;

const cannon = (fp: string, extra: Partial<BalanceRowView> = {}): BalanceRowView => ({
  part: "cannon",
  key: null,
  label: "Battleship cannon",
  fields: [
    { path: ["damage", "flat"], label: "Damage", unit: "count", min: 0, max: 10_000 },
    { path: ["damage", "randomN"], label: "plus random(n)", unit: "random", min: 0, max: 1000 },
    { path: ["reloadFrames"], label: "Reload", unit: "frames", min: 1, max: 72_000 },
  ],
  engine: { damage: { flat: 13, randomN: 3 }, reloadFrames: 100 },
  pack: null,
  published: { damage: { flat: 13, randomN: 3 }, reloadFrames: 100 },
  draft: { damage: { flat: 13, randomN: 3 }, reloadFrames: 100 },
  edited: false,
  pending: null,
  fingerprint: fp,
  notice: null,
  ...extra,
});

/** An amount's three fields at `path`, optional or not. */
const amount = (path: string, name: string, optional = false) =>
  (
    [
      { path: [path, "flat"], label: name, unit: "count", min: 0, max: 10_000 },
      { path: [path, "power"], label: `${name}: × power`, unit: "power", min: 0, max: 100 },
      { path: [path, "randomN"], label: `${name}: + random(n)`, unit: "random", min: 0, max: 1000 },
    ] as const
  ).map((f) => ({ ...f, path: [...f.path], ...(optional ? { optional: true } : {}) }));

const firebolt = (fp: string): BalanceRowView => {
  const v = {
    effect: "Firebolt",
    monster: { flat: 6, power: 1, randomN: 3 },
    player: { flat: 8, power: 1, randomN: 3 },
  };
  return {
    part: "spellEffects",
    key: "Firebolt",
    label: "Firebolt",
    fields: [
      ...amount("monster", "On a monster"),
      ...amount("monsterHealed", "Heals a species it heals", true),
      ...amount("player", "On a player"),
    ],
    engine: v,
    pack: v,
    published: v,
    draft: v,
    edited: false,
    pending: null,
    fingerprint: fp,
    notice: null,
  };
};

const view = (rows: BalanceRowView[], otherDraft = 0): ContentBalanceView => ({
  groups: [{ id: "vehicles", title: "Vehicles", help: "", rows }],
  otherDraft,
});

function page() {
  const asked: number[] = [];
  const sent: { seq: number; change: BalanceChange }[] = [];
  let opened = 0;
  const openedRows: ContentRowRef[] = [];
  const p = createBalancePage({
    view: (seq) => asked.push(seq),
    set: (seq, change) => sent.push({ seq, change }),
    openContent: () => {
      opened += 1;
    },
    openContentRow: (r) => openedRows.push(r),
  });
  document.body.append(p.el);
  const row = (id: string) => p.el.querySelector<HTMLElement>(`[data-row="${id}"]`) as HTMLElement;
  const input = (id: string, path: string) =>
    row(id).querySelector<HTMLInputElement>(`input[data-path="${path}"]`) as HTMLInputElement;
  const button = (id: string, action: string) =>
    row(id).querySelector<HTMLButtonElement>(`[data-action="${action}"]`) as HTMLButtonElement;
  const type = (id: string, path: string, value: string) => {
    const i = input(id, path);
    i.value = value;
    i.dispatchEvent(new Event("input"));
  };
  return { p, asked, sent, row, input, button, type, opened: () => opened, openedRows };
}

describe("the Balance page", () => {
  test("a card names a value kept in another dataset and opens its row there", () => {
    // House rest lives in houses.restRegen (Sol's #19 review): shown, with a link to its row.
    const t = page();
    t.p.onShow();
    const row = { dataset: "houses" as const, part: "restRegen", key: null };
    const answer = (now: string) =>
      t.p.receive({
        t: "contentBalance",
        seq: t.asked.at(-1) ?? 0,
        view: {
          groups: [
            {
              id: "vitals",
              title: "Regeneration",
              help: "",
              rows: [],
              elsewhere: [{ label: "Resting in a house", row, now }],
            },
          ],
          otherDraft: 0,
        },
      });
    answer("1 in 10");
    expect(t.p.el.textContent).toContain("Resting in a house: 1 in 10");
    t.p.published();
    answer("1 in 4");
    expect(t.p.el.textContent).toContain("Resting in a house: 1 in 4");
    t.p.el.querySelector<HTMLButtonElement>('[data-action="balance-open-row"]')?.click();
    expect(t.openedRows).toEqual([row]);
  });

  test("shows each value with what plays now, the pack's and the engine's, and its limits", () => {
    const t = page();
    t.p.onShow();
    t.p.receive({
      t: "contentBalance",
      seq: t.asked[0] ?? 0,
      view: view([hull("Boat", 60, "a".repeat(16)), cannon("b".repeat(16))]),
    });
    expect(t.input("hulls/Boat", "hull").value).toBe("60");
    expect(t.row("hulls/Boat").textContent).toContain(
      "Now 60 · pack 60 · engine default 60 · limits 1 to 100000",
    );
    // Frames in seconds, a roll as random(n), and no pack value (Minimal).
    expect(t.row("cannon/").textContent).toContain("Now 100 (5 s) · no pack value");
    expect(t.row("cannon/").textContent).toContain("Now random(3)");
    expect(t.button("cannon/", "balance-reset").textContent).toBe("Reset to the engine default");
    t.p.receive({
      t: "contentBalance",
      seq: t.asked[0] ?? 0,
      view: view([hull("Boat", 60, "a".repeat(16)), cannon("c".repeat(16), { edited: true })]),
    });
    expect(t.row("cannon/").textContent).toContain("Changed from the engine default");
    expect(t.button("hulls/Boat", "balance-save").disabled).toBe(true);
    // "Drop my edit" shows only while the row is edited.
    expect(t.button("hulls/Boat", "balance-undo-edit").hidden).toBe(true);
    t.type("hulls/Boat", "hull", "61");
    expect(t.button("hulls/Boat", "balance-undo-edit").hidden).toBe(false);
  });

  test("a save sends the whole row with the fingerprint it was filled from, and counts as unsaved until then", () => {
    const t = page();
    t.p.onShow();
    t.p.receive({ t: "contentBalance", seq: 1, view: view([cannon("b".repeat(16))]) });
    t.type("cannon/", "damage.randomN", "5");
    expect(t.p.changes()).toBe(1);
    t.button("cannon/", "balance-save").click();
    expect(t.sent).toEqual([
      {
        seq: 2,
        change: {
          part: "cannon",
          key: null,
          op: "set",
          data: { damage: { flat: 13, randomN: 5 }, reloadFrames: 100 },
          expect: "b".repeat(16),
        },
      },
    ]);
    // Saving disables the row's buttons until the answer comes; a second click sends nothing.
    t.button("cannon/", "balance-save").click();
    expect(t.sent).toHaveLength(1);
    const after = cannon("c".repeat(16), {
      draft: { damage: { flat: 13, randomN: 5 }, reloadFrames: 100 },
      pending: "set",
    });
    t.p.receive({
      t: "contentBalance",
      seq: 2,
      view: view([after]),
      result: { ok: true, text: "Battleship cannon is in the draft." },
    });
    expect(t.p.changes()).toBe(0);
    expect(t.row("cannon/").textContent).toContain("Battleship cannon is in the draft.");
    expect(t.row("cannon/").textContent).toContain("Changed in the draft");
    expect(t.button("cannon/", "balance-discard").hidden).toBe(false);
    expect(t.p.el.querySelector(".balance-draft")?.textContent).toContain("1 balance change");
  });

  test("a row being saved takes no typing, and its save is not an unsaved change (issue #19 review)", () => {
    const t = page();
    t.p.onShow();
    t.p.receive({ t: "contentBalance", seq: 1, view: view([hull("Boat", 60, "a".repeat(16))]) });
    t.type("hulls/Boat", "hull", "70");
    t.button("hulls/Boat", "balance-save").click();
    // On its way: the field is read-only, and leaving the page would lose nothing.
    expect(t.input("hulls/Boat", "hull").readOnly).toBe(true);
    expect(t.p.changes()).toBe(0);
    // Discard leaves a row being saved alone.
    t.p.discard();
    expect(t.input("hulls/Boat", "hull").value).toBe("70");
    t.p.receive({
      t: "contentBalance",
      seq: 2,
      view: view([
        hull("Boat", 60, "b".repeat(16), { draft: { vehicle: "Boat", hull: 70 }, pending: "set" }),
      ]),
      result: { ok: true, text: "Boat hull is in the draft." },
    });
    expect(t.input("hulls/Boat", "hull").readOnly).toBe(false);
    expect(t.input("hulls/Boat", "hull").value).toBe("70");
    // A refused save gives the field back with the typed value kept.
    t.type("hulls/Boat", "hull", "75");
    t.button("hulls/Boat", "balance-save").click();
    t.p.receive({
      t: "contentBalance",
      seq: 3,
      view: view([
        hull("Boat", 60, "c".repeat(16), { draft: { vehicle: "Boat", hull: 70 }, pending: "set" }),
      ]),
      result: { ok: false, text: "Someone changed it." },
    });
    expect(t.input("hulls/Boat", "hull").readOnly).toBe(false);
    expect(t.input("hulls/Boat", "hull").value).toBe("75");
    expect(t.p.changes()).toBe(1);
  });

  test("a save answered after a newer view keeps the newer view and gives the row its buttons back", () => {
    const t = page();
    t.p.onShow();
    t.p.receive({ t: "contentBalance", seq: 1, view: view([hull("Boat", 60, "a".repeat(16))]) });
    t.type("hulls/Boat", "hull", "70");
    t.button("hulls/Boat", "balance-save").click(); // seq 2
    t.p.published(); // seq 3: a publish meanwhile
    const newer = hull("Boat", 60, "c".repeat(16), {
      draft: { vehicle: "Boat", hull: 70 },
      pending: "set",
    });
    t.p.receive({ t: "contentBalance", seq: 3, view: view([newer]) });
    // The save's answer comes last, with an older view of the row.
    t.p.receive({
      t: "contentBalance",
      seq: 2,
      view: view([
        hull("Boat", 60, "b".repeat(16), { draft: { vehicle: "Boat", hull: 70 }, pending: "set" }),
      ]),
      result: { ok: true, text: "Boat hull is in the draft." },
    });
    expect(t.input("hulls/Boat", "hull").readOnly).toBe(false);
    expect(t.input("hulls/Boat", "hull").value).toBe("70");
    expect(t.button("hulls/Boat", "balance-discard").disabled).toBe(false);
    expect(t.button("hulls/Boat", "balance-reset").disabled).toBe(false);
    // A new edit can be saved, against the newer view's fingerprint.
    t.type("hulls/Boat", "hull", "71");
    expect(t.button("hulls/Boat", "balance-save").disabled).toBe(false);
    t.button("hulls/Boat", "balance-save").click();
    expect(t.sent.at(-1)?.change.expect).toBe("c".repeat(16));
  });

  test("a save answered first, while a newer view is on its way, shows what was saved (Neon's review)", () => {
    // The save (seq 2) and a publish's view (seq 3) are answered in order: the save's view applies,
    // and the row shows the saved value with the save's fingerprint, not the view from seq 1.
    const t = page();
    t.p.onShow();
    t.p.receive({ t: "contentBalance", seq: 1, view: view([hull("Boat", 60, "a".repeat(16))]) });
    t.type("hulls/Boat", "hull", "70");
    t.button("hulls/Boat", "balance-save").click(); // seq 2
    t.p.published(); // seq 3
    const saved = hull("Boat", 60, "b".repeat(16), {
      draft: { vehicle: "Boat", hull: 70 },
      pending: "set",
    });
    t.p.receive({
      t: "contentBalance",
      seq: 2,
      view: view([saved]),
      result: { ok: true, text: "Boat hull is in the draft." },
    });
    expect(t.input("hulls/Boat", "hull").value).toBe("70");
    expect(t.p.changes()).toBe(0);
    t.type("hulls/Boat", "hull", "71");
    t.button("hulls/Boat", "balance-save").click();
    expect(t.sent.at(-1)?.change.expect).toBe("b".repeat(16));
  });

  test("a row is locked the moment its save is sent, and stays locked through a rebuild", () => {
    const t = page();
    let lockedWhenSent = null as boolean | null;
    const p = createBalancePage({
      view: (seq) => t.asked.push(seq),
      set: () => {
        lockedWhenSent =
          p.el.querySelector<HTMLInputElement>('[data-row="hulls/Boat"] input')?.readOnly ?? null;
      },
      openContent: () => {},
      openContentRow: () => {},
    });
    document.body.append(p.el);
    p.onShow(); // seq 1
    p.receive({ t: "contentBalance", seq: 1, view: view([hull("Boat", 60, "a".repeat(16))]) });
    // A Reset leaves the row clean but busy.
    const boat = () => p.el.querySelector<HTMLElement>('[data-row="hulls/Boat"]') as HTMLElement;
    boat().querySelector<HTMLButtonElement>('[data-action="balance-reset"]')?.click();
    expect(lockedWhenSent).toBe(true);
    // A new release adds a row: the page rebuilds, and the busy row stays locked.
    p.receive({
      t: "contentBalance",
      seq: 1,
      view: view([hull("Boat", 60, "a".repeat(16)), hull("Airship", 80, "d".repeat(16))]),
    });
    expect(boat().querySelector<HTMLInputElement>("input")?.readOnly).toBe(true);
  });

  test("a refusal reads in the page's words", () => {
    const t = page();
    t.p.onShow();
    t.p.receive({ t: "contentBalance", seq: 1, view: view([hull("Boat", 60, "a".repeat(16))]) });
    t.type("hulls/Boat", "hull", "70");
    t.button("hulls/Boat", "balance-save").click();
    t.p.receive({
      t: "contentBalance",
      seq: t.sent.at(-1)?.seq ?? 0,
      view: view([hull("Boat", 60, "a".repeat(16))]),
      result: {
        ok: false,
        text: "Boat hull was not saved.",
        problems: [
          { where: "Full hull", message: `"Full hull" must be at most 9` },
          { where: "Full hull", message: "too big" },
        ],
      },
    });
    expect(t.row("hulls/Boat").textContent).toContain(
      `Boat hull was not saved. "Full hull" must be at most 9 Full hull: too big`,
    );
  });

  test("a value outside its limits, or not a whole number, is refused before sending", () => {
    const t = page();
    t.p.onShow();
    t.p.receive({ t: "contentBalance", seq: 1, view: view([hull("Boat", 60, "a".repeat(16))]) });
    t.type("hulls/Boat", "hull", "0");
    expect(t.button("hulls/Boat", "balance-save").disabled).toBe(true);
    expect(t.row("hulls/Boat").textContent).toContain("Full hull: from 1 to 100000");
    t.type("hulls/Boat", "hull", "2.5");
    expect(t.row("hulls/Boat").textContent).toContain("Full hull: a whole number");
    t.button("hulls/Boat", "balance-save").click();
    expect(t.sent).toEqual([]);
    expect(
      fieldError("100000", { path: [], label: "x", unit: "count", min: 1, max: 100_000 }),
    ).toBe(null);
  });

  test("a refresh keeps a row being edited, and says when someone else changed it meanwhile", () => {
    const t = page();
    t.p.onShow();
    t.p.receive({
      t: "contentBalance",
      seq: 1,
      view: view([hull("Boat", 60, "a".repeat(16)), hull("Airship", 80, "d".repeat(16))]),
    });
    t.type("hulls/Boat", "hull", "75");
    // Another admin put 90 in the draft for the Boat and 85 for the Airship.
    t.p.published();
    t.p.receive({
      t: "contentBalance",
      seq: 2,
      view: view([
        hull("Boat", 60, "e".repeat(16), { draft: { vehicle: "Boat", hull: 90 }, pending: "set" }),
        hull("Airship", 80, "f".repeat(16), { draft: { vehicle: "Airship", hull: 85 } }),
      ]),
    });
    expect(t.input("hulls/Boat", "hull").value).toBe("75");
    expect(t.row("hulls/Boat").querySelector<HTMLElement>(".balance-stale")?.hidden).toBe(false);
    // The untouched row follows the server.
    expect(t.input("hulls/Airship", "hull").value).toBe("85");
    // The edit still saves with what it was filled from, so the server can refuse it.
    t.button("hulls/Boat", "balance-save").click();
    expect(t.sent[0]?.change.expect).toBe("a".repeat(16));
    // Drop my edit shows theirs.
    t.p.receive({
      t: "contentBalance",
      seq: t.sent[0]?.seq ?? 0,
      view: view([
        hull("Boat", 60, "e".repeat(16), { draft: { vehicle: "Boat", hull: 90 }, pending: "set" }),
        hull("Airship", 80, "f".repeat(16)),
      ]),
      result: {
        ok: false,
        text: "Boat hull changed since you opened it: look at it again before saving.",
      },
    });
    expect(t.row("hulls/Boat").textContent).toContain("changed since you opened it");
    t.button("hulls/Boat", "balance-undo-edit").click();
    expect(t.input("hulls/Boat", "hull").value).toBe("90");
    expect(t.p.changes()).toBe(0);
  });

  test("an answer older than the view shown is ignored", () => {
    const t = page();
    t.p.onShow();
    t.p.onShow();
    t.p.receive({ t: "contentBalance", seq: 2, view: view([hull("Boat", 70, "a".repeat(16))]) });
    t.p.receive({ t: "contentBalance", seq: 1, view: view([hull("Boat", 60, "b".repeat(16))]) });
    expect(t.input("hulls/Boat", "hull").value).toBe("70");
  });

  test("reset and drop send the row's current fingerprint; discard puts edits back", () => {
    const t = page();
    t.p.onShow();
    t.p.receive({
      t: "contentBalance",
      seq: 1,
      view: view([hull("Boat", 90, "a".repeat(16), { edited: true })]),
    });
    expect(t.button("hulls/Boat", "balance-reset").hidden).toBe(false);
    expect(t.button("hulls/Boat", "balance-discard").hidden).toBe(true);
    t.button("hulls/Boat", "balance-reset").click();
    expect(t.sent[0]?.change).toEqual({
      part: "hulls",
      key: "Boat",
      op: "revert",
      data: null,
      expect: "a".repeat(16),
    });
    t.p.receive({
      t: "contentBalance",
      seq: t.sent[0]?.seq ?? 0,
      view: view([
        hull("Boat", 90, "b".repeat(16), {
          edited: true,
          pending: "revert",
          draft: { vehicle: "Boat", hull: 60 },
        }),
      ]),
      result: { ok: true, text: "Boat hull goes back to the pack's value when published." },
    });
    t.type("hulls/Boat", "hull", "5");
    expect(t.p.changes()).toBe(1);
    t.p.discard();
    expect(t.input("hulls/Boat", "hull").value).toBe("60");
    expect(t.p.changes()).toBe(0);
  });

  test("a reset page ignores answers to what it asked before", () => {
    const t = page();
    t.p.onShow();
    t.p.reset();
    t.p.receive({ t: "contentBalance", seq: 1, view: view([hull("Boat", 60, "a".repeat(16))]) });
    expect(t.p.el.querySelector('[data-row="hulls/Boat"]')).toBeNull();
  });

  test("an amount previews its range at a few powers, and follows typing", () => {
    expect(amountPreview("6", "1", "3")).toBe(
      "power 1: 8 to 10 · power 10: 17 to 19 · power 50: 57 to 59",
    );
    expect(amountPreview("13", null, "3")).toBe("Rolls 14 to 16");
    expect(amountPreview("5", "0", "0")).toBe("Always 5");
    expect(amountPreview("x", "1", "3")).toBeNull();
    const t = page();
    t.p.onShow();
    t.p.receive({
      t: "contentBalance",
      seq: t.asked[0] ?? 0,
      view: view([firebolt("f".repeat(16))]),
    });
    const previews = [...t.row("spellEffects/Firebolt").querySelectorAll(".balance-preview")];
    expect(previews.map((e) => e.textContent)).toEqual([
      "power 1: 8 to 10 · power 10: 17 to 19 · power 50: 57 to 59",
      "None of its own",
      "power 1: 10 to 12 · power 10: 19 to 21 · power 50: 59 to 61",
    ]);
    t.type("spellEffects/Firebolt", "monster.flat", "100");
    expect(previews[0]?.textContent).toBe(
      "power 1: 102 to 104 · power 10: 111 to 113 · power 50: 151 to 153",
    );
    expect(t.row("spellEffects/Firebolt").textContent).toContain("Now 1 × power");
    // A required amount emptied is an error, not "none": its preview hides.
    for (const part of ["flat", "power", "randomN"]) {
      t.type("spellEffects/Firebolt", `monster.${part}`, "");
    }
    expect(previews[0]?.textContent).toBe("");
    expect((previews[0] as HTMLElement).hidden).toBe(true);
  });

  test("an optional amount: empty is none, part-filled is refused, filled is sent, emptied is taken out", () => {
    const t = page();
    t.p.onShow();
    t.p.receive({
      t: "contentBalance",
      seq: t.asked[0] ?? 0,
      view: view([firebolt("f".repeat(16))]),
    });
    const id = "spellEffects/Firebolt";
    expect(t.input(id, "monsterHealed.flat").value).toBe("");
    // An absent amount shown empty is not an edit.
    expect(t.p.changes()).toBe(0);
    t.type(id, "monsterHealed.flat", "4");
    expect(t.button(id, "balance-save").disabled).toBe(true);
    expect(t.row(id).textContent).toContain(
      "Heals a species it heals: fill every part, or leave them all empty",
    );
    t.type(id, "monsterHealed.power", "1");
    t.type(id, "monsterHealed.randomN", "2");
    expect(t.button(id, "balance-save").disabled).toBe(false);
    t.button(id, "balance-save").click();
    expect(t.sent[0]?.change.data).toEqual({
      effect: "Firebolt",
      monster: { flat: 6, power: 1, randomN: 3 },
      monsterHealed: { flat: 4, power: 1, randomN: 2 },
      player: { flat: 8, power: 1, randomN: 3 },
    });
    // The saved row has it; emptying the three takes it out of what is sent.
    const healed = firebolt("g".repeat(16));
    healed.draft = {
      ...(healed.draft as object),
      monsterHealed: { flat: 4, power: 1, randomN: 2 },
    };
    t.p.receive({
      t: "contentBalance",
      seq: t.sent[0]?.seq ?? 0,
      view: view([healed]),
      result: { ok: true, text: "Firebolt is in the draft." },
    });
    for (const part of ["flat", "power", "randomN"]) {
      t.type(id, `monsterHealed.${part}`, "");
    }
    t.button(id, "balance-save").click();
    expect(t.sent[1]?.change.data).toEqual({
      effect: "Firebolt",
      monster: { flat: 6, power: 1, randomN: 3 },
      player: { flat: 8, power: 1, randomN: 3 },
    });
  });

  test("values are written for people", () => {
    const f = { path: [], label: "x", min: 0, max: 1 };
    expect(shownValue(30, { ...f, unit: "frames" })).toBe("30 (1.5 s)");
    // Counted down in both actor passes: Classic's flicker of 40 lasts about 1 s.
    expect(shownValue(40, { ...f, unit: "passFrames" })).toBe("40 (1 s)");
    expect(shownValue(20, { ...f, unit: "passFrames" })).toBe("20 (0.5 s)");
    expect(shownValue(0, { ...f, unit: "random" })).toBe("no roll");
    expect(shownValue(7, { ...f, unit: "count" })).toBe("7");
    expect(shownValue(2, { ...f, unit: "power" })).toBe("2 × power");
    expect(shownValue(0, { ...f, unit: "power" })).toBe("no power");
    expect(shownValue(3, { ...f, unit: "oneIn" })).toBe("1 in 3");
    // A counter that starts at 1: the regen period's 149 acts every 148 frames (Sol's #19 review).
    expect(shownValue(149, { ...f, unit: "counter" })).toBe("149: acts every 148 frames (7.4 s)");
    expect(shownValue(21, { ...f, unit: "counter" })).toBe("21: acts every 20 frames (1 s)");
    expect(shownValue(1, { ...f, unit: "counter" })).toBe("1: acts every 1 frame (0.05 s)");
    expect(shownValue(undefined, { ...f, unit: "count" })).toBe("none");
    expect(fieldError("", { ...f, unit: "count", optional: true })).toBeNull();
    expect(fieldError("", { ...f, unit: "count" })).toBe("x: a whole number");
  });
});

describe("the Balance page in the app", () => {
  const fakeAssets: Assets = {
    index: { version: 1, inputHash: "", atlases: {} as AssetIndex["atlases"], ui: {}, sounds: {} },
    sheets: {},
    loadGroup: async () => {},
    sprite: () => undefined,
    ui: (cast, member) => `/assets/ui/${cast.toLowerCase()}-${member}.png`,
    hash: null,
    reload: async () => [],
    onReload: () => {},
  };

  test("it sits under Game for the content editor, asks for its view and routes the answer", async () => {
    window.innerWidth = 1024;
    window.innerHeight = 768;
    const root = document.createElement("div");
    document.body.append(root);
    const sent: { t: string }[] = [];
    const c: Connection & { sent: { t: string }[] } = {
      sent,
      send: (m) => sent.push(m),
      close: () => {},
      onMessage: () => {},
      onGone: () => {},
      token: null,
    };
    const app = runApp(root, fakeAssets, c);
    c.onMessage({
      t: "welcome",
      protocol: 1,
      id: "me",
      name: "Me",
      token: "00000000-0000-4000-8000-000000000000",
      resumed: false,
      rules: { chatMaxChars: 200 },
    } as ServerMsg);
    c.onMessage({ t: "permissions", permissions: [...PERMISSIONS] });
    c.onMessage(SNAPSHOT);
    c.onMessage({ t: "controlPanel" });
    const link = root.querySelector<HTMLElement>('.control-panel-link[data-page="balance"]');
    expect(link?.textContent).toBe("Balance");
    link?.click();
    const asked = sent.filter((m) => m.t === "contentBalance").at(-1) as
      | { seq: number }
      | undefined;
    expect(asked).toBeDefined();
    c.onMessage({
      t: "contentBalance",
      seq: asked?.seq ?? 0,
      view: view([hull("Boat", 60, "a".repeat(16))]),
    } as ServerMsg);
    expect(root.querySelector('[data-row="hulls/Boat"]')).not.toBeNull();
    // Edited and left: the Control Panel asks first.
    const input = root.querySelector<HTMLInputElement>(
      'input[data-path="hull"]',
    ) as HTMLInputElement;
    input.value = "70";
    input.dispatchEvent(new Event("input"));
    // A balance-only publish keeps the store's hash: the page asks again all the same.
    const before = sent.filter((m) => m.t === "contentBalance").length;
    c.onMessage({ t: "content", hash: content().hash } as ServerMsg);
    expect(sent.filter((m) => m.t === "contentBalance").length).toBe(before + 1);
    root.querySelector<HTMLElement>('.control-panel-link[data-page="content"]')?.click();
    expect(root.querySelector(".control-panel-confirm")).not.toBeNull();
    // Discarded and on the Content page: a balance-only publish refreshes it too.
    root.querySelector<HTMLElement>('[data-action="control-panel-confirm-ok"]')?.click();
    await new Promise((r) => setTimeout(r, 0));
    const overviews = sent.filter((m) => m.t === "contentOverview").length;
    c.onMessage({ t: "content", hash: content().hash } as ServerMsg);
    expect(sent.filter((m) => m.t === "contentOverview").length).toBe(overviews + 1);
    app.stop();
  });
});

/** The drops row as the server sends it (stage 4): two picks, two counts and seconds. */
const drops = (fp: string, who = "wanted"): BalanceRowView => ({
  part: "drops",
  key: null,
  label: "Death drops and loot",
  fields: [
    {
      path: ["who"],
      label: "Drops on death",
      unit: "choice",
      min: 0,
      max: 0,
      choices: [
        { value: "off", label: "Off" },
        { value: "wanted", label: "Wanted only" },
        { value: "everyone", label: "Everyone" },
      ],
    },
    { path: ["goldCap"], label: "Most gold dropped", unit: "count", min: 0, max: 1_000_000_000 },
    {
      path: ["lootDecaySeconds"],
      label: "Monster loot lasts",
      unit: "seconds",
      min: 60,
      max: 604_800,
    },
  ],
  engine: { who: "wanted", goldCap: 200, lootDecaySeconds: 1800 },
  pack: { who: "wanted", goldCap: 200, lootDecaySeconds: 1800 },
  published: { who, goldCap: 200, lootDecaySeconds: 1800 },
  draft: { who, goldCap: 200, lootDecaySeconds: 1800 },
  edited: false,
  pending: null,
  fingerprint: fp,
  notice: null,
});

describe("the Balance page's picks, seconds and Find (#19 stages 4-6)", () => {
  test("a pick shows its labels, saves its value, and locks while the save is on its way", () => {
    const t = page();
    t.p.onShow();
    t.p.receive({ t: "contentBalance", seq: 1, view: view([drops("d1")]) });
    const sel = t
      .row("drops/")
      .querySelector<HTMLSelectElement>('select[data-path="who"]') as HTMLSelectElement;
    expect([...sel.options].map((o) => o.textContent)).toEqual(["Off", "Wanted only", "Everyone"]);
    expect(sel.value).toBe("wanted");
    expect(t.row("drops/").textContent).toContain("Now Wanted only");
    expect(t.row("drops/").textContent).toContain("1800 s (30 min)");
    sel.value = "everyone";
    sel.dispatchEvent(new Event("change"));
    t.button("drops/", "balance-save").click();
    expect(t.sent.at(-1)?.change).toEqual({
      part: "drops",
      key: null,
      op: "set",
      data: { who: "everyone", goldCap: 200, lootDecaySeconds: 1800 },
      expect: "d1",
    });
    expect(sel.disabled).toBe(true);
    const seq = t.sent.at(-1)?.seq as number;
    t.p.receive({
      t: "contentBalance",
      seq,
      view: view([{ ...drops("d2", "everyone"), pending: "set" }]),
      result: { ok: true, text: "Saved to the draft." },
    });
    expect(sel.disabled).toBe(false);
    expect(sel.value).toBe("everyone");
  });

  test("a pick outside its list and loot under a minute are refused before sending", () => {
    const f = drops("x").fields;
    expect(fieldError("sometimes", f[0] as never)).toBe("Drops on death: pick one");
    expect(fieldError("everyone", f[0] as never)).toBeNull();
    expect(fieldError("59", f[2] as never)).toBe("Monster loot lasts: from 60 to 604800");
    expect(shownValue(90_000, f[2] as never)).toBe("90000 s (1.04 days)");
    expect(shownValue(90, f[2] as never)).toBe("90 s (1.5 min)");
  });

  test("Find shows only the rows whose names hold every word, and says when nothing does", () => {
    const t = page();
    t.p.onShow();
    t.p.receive({
      t: "contentBalance",
      seq: 1,
      view: view([hull("Boat", 60, "b"), cannon("c"), drops("d")]),
    });
    const find = t.p.el.querySelector<HTMLInputElement>("#balance-search") as HTMLInputElement;
    const shown = () =>
      [...t.p.el.querySelectorAll<HTMLElement>(".balance-row")]
        .filter((r) => !r.hidden)
        .map((r) => r.dataset.row);
    find.value = "loot";
    find.dispatchEvent(new Event("input"));
    expect(shown()).toEqual(["drops/"]);
    find.value = "cannon reload";
    find.dispatchEvent(new Event("input"));
    expect(shown()).toEqual(["cannon/"]);
    const none = t.p.el.querySelector<HTMLElement>(".balance-no-match") as HTMLElement;
    expect(none.hidden).toBe(true);
    find.value = "zebra";
    find.dispatchEvent(new Event("input"));
    expect(shown()).toEqual([]);
    expect(none.hidden).toBe(false);
    find.value = "";
    find.dispatchEvent(new Event("input"));
    expect(shown()).toEqual(["hulls/Boat", "cannon/", "drops/"]);
  });

  test("a reset page (a new session) forgets the Find text and its 'Nothing matches.'", () => {
    const t = page();
    t.p.onShow();
    t.p.receive({ t: "contentBalance", seq: 1, view: view([hull("Boat", 60, "b")]) });
    const find = t.p.el.querySelector<HTMLInputElement>("#balance-search") as HTMLInputElement;
    const none = t.p.el.querySelector<HTMLElement>(".balance-no-match") as HTMLElement;
    find.value = "zebra";
    find.dispatchEvent(new Event("input"));
    expect(none.hidden).toBe(false);
    t.p.reset();
    expect(find.value).toBe("");
    expect(none.hidden).toBe(true);
    t.p.onShow();
    t.p.receive({ t: "contentBalance", seq: 3, view: view([hull("Boat", 60, "b")]) });
    expect(
      [...t.p.el.querySelectorAll<HTMLElement>(".balance-row")].filter((r) => !r.hidden),
    ).toHaveLength(1);
  });
});
