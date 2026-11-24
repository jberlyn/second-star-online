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
  content,
  PERMISSIONS,
  type ServerMsg,
} from "@secondstaronline/shared";

import { runApp } from "../src/app.ts";
import type { Assets } from "../src/assets.ts";
import type { Connection } from "../src/net.ts";
import {
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

const view = (rows: BalanceRowView[], otherDraft = 0): ContentBalanceView => ({
  groups: [{ id: "vehicles", title: "Vehicles", help: "", rows }],
  otherDraft,
});

function page() {
  const asked: number[] = [];
  const sent: { seq: number; change: BalanceChange }[] = [];
  let opened = 0;
  const p = createBalancePage({
    view: (seq) => asked.push(seq),
    set: (seq, change) => sent.push({ seq, change }),
    openContent: () => {
      opened += 1;
    },
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
  return { p, asked, sent, row, input, button, type, opened: () => opened };
}

describe("the Balance page", () => {
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

  test("values are written for people", () => {
    const f = { path: [], label: "x", min: 0, max: 1 };
    expect(shownValue(30, { ...f, unit: "frames" })).toBe("30 (1.50 s)");
    expect(shownValue(0, { ...f, unit: "random" })).toBe("no roll");
    expect(shownValue(7, { ...f, unit: "count" })).toBe("7");
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
