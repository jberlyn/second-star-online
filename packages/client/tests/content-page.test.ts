/**
 * The Control Panel's Content page (ui/content-page.ts, issue #27): the installed packs and their
 * update notices, the shared draft with its checks and Publish, the rows of a dataset with a JSON
 * editor that saves to the draft, and the publish history with Undo.
 */
import { describe, expect, test } from "bun:test";

import type { ContentOverview, ContentRowDetail } from "@secondstaronline/shared";

import { createContentPage, lineDiff, refLabel } from "../src/ui/content-page.ts";

const overview = (over: Partial<ContentOverview> = {}): ContentOverview => ({
  draft: [],
  problems: [],
  history: [],
  packs: [
    { id: "classic", name: "Classic", version: "1.0.0", source: "release", updatedFrom: null },
  ],
  notices: [],
  datasets: [
    {
      id: "items",
      readOnly: false,
      parts: [
        { part: "items", keyed: true, rows: 2 },
        { part: "fixtures", keyed: false, rows: 1 },
      ],
    },
    { id: "rects", readOnly: true, parts: [{ part: "fx", keyed: false, rows: 1 }] },
  ],
  hash: "abc",
  ...over,
});

const ale: ContentRowDetail = {
  dataset: "items",
  part: "items",
  key: "Ale",
  keyField: "name",
  readOnly: false,
  status: "pack",
  pack: { name: "Ale", icon: null },
  published: { name: "Ale", icon: null },
  draft: null,
};

function page() {
  const sent: { kind: string; seq: number; args: unknown[] }[] = [];
  const rec =
    (kind: string) =>
    (seq: number, ...args: unknown[]) =>
      sent.push({ kind, seq, args });
  const p = createContentPage({
    overview: rec("overview"),
    list: rec("list"),
    row: rec("row"),
    draft: rec("draft"),
    discard: rec("discard"),
    publish: rec("publish"),
    undo: rec("undo"),
    notice: rec("notice"),
  });
  document.body.replaceChildren(p.el);
  const $ = <T extends HTMLElement>(action: string) =>
    p.el.querySelector<T>(`[data-action="${action}"]`) as T;
  const last = (kind: string) => [...sent].reverse().find((s) => s.kind === kind);
  const confirm = () =>
    (p.el.querySelector('[data-action="control-panel-confirm-ok"]') as HTMLButtonElement).click();
  const settle = () => new Promise((r) => setTimeout(r, 0));
  return { p, sent, $, last, confirm, settle };
}

describe("the helpers", () => {
  test("a row is named by dataset, field and key", () => {
    expect(refLabel({ dataset: "items", part: "items", key: "Ale" })).toBe("items/items/Ale");
    expect(refLabel({ dataset: "casino", part: "blackjack", key: null })).toBe("casino/blackjack");
  });

  test("a line diff keeps, adds and removes lines", () => {
    expect(lineDiff("a\nb\nc", "a\nx\nc")).toEqual([
      { kind: "same", text: "a" },
      { kind: "del", text: "b" },
      { kind: "add", text: "x" },
      { kind: "same", text: "c" },
    ]);
  });
});

describe("the Content page", () => {
  test("showing it asks for the overview, then lists the first field's rows", () => {
    const { p, last } = page();
    p.onShow();
    const ask = last("overview");
    expect(ask).toBeDefined();
    p.receive({ t: "contentOverview", seq: ask?.seq ?? 0, overview: overview() });
    expect(p.el.textContent).toContain("Classic");
    expect(p.el.textContent).toContain("v1.0.0");
    expect(last("list")?.args).toEqual(["items", "items"]);
    // Nothing to publish yet.
    const publish = p.el.querySelector('[data-action="content-publish"]') as HTMLButtonElement;
    expect(publish.disabled).toBe(true);
  });

  test("a row opens in the editor, and a save puts its JSON in the draft", () => {
    const { p, $, last } = page();
    p.onShow();
    p.receive({ t: "contentOverview", seq: last("overview")?.seq ?? 0, overview: overview() });
    p.receive({
      t: "contentList",
      seq: last("list")?.seq ?? 0,
      listing: {
        dataset: "items",
        part: "items",
        keyField: "name",
        rows: [{ key: "Ale", status: "pack", draft: null }],
      },
    });
    const row = p.el.querySelector('[data-action="content-row-open"]') as HTMLElement;
    row.click();
    expect(last("row")?.args).toEqual([{ dataset: "items", part: "items", key: "Ale" }]);
    p.receive({ t: "contentRow", seq: last("row")?.seq ?? 0, row: ale });
    const json = $<HTMLTextAreaElement>("content-json");
    expect(JSON.parse(json.value)).toEqual({ name: "Ale", icon: null });
    expect(p.changes()).toBe(0);
    json.value = JSON.stringify({ name: "Ale", display: "Brown Ale", icon: null });
    expect(p.changes()).toBe(1);
    $("content-save").click();
    expect(last("draft")?.args).toEqual([
      { dataset: "items", part: "items", key: "Ale" },
      "set",
      { name: "Ale", display: "Brown Ale", icon: null },
    ]);
  });

  test("invalid JSON is caught before anything is sent, and a refusal shows its problems", () => {
    const { p, $, last, sent } = page();
    p.onShow();
    p.receive({ t: "contentOverview", seq: last("overview")?.seq ?? 0, overview: overview() });
    p.receive({
      t: "contentList",
      seq: last("list")?.seq ?? 0,
      listing: { dataset: "items", part: "items", keyField: "name", rows: [] },
    });
    $("content-add").click();
    $<HTMLTextAreaElement>("content-json").value = "{ nope";
    $("content-save").click();
    expect(sent.some((s) => s.kind === "draft")).toBe(false);
    expect(p.el.querySelector(".content-editor-error")?.textContent).toContain("not valid JSON");
    $<HTMLTextAreaElement>("content-json").value = JSON.stringify({ name: "Moon#1", icon: null });
    $("content-save").click();
    expect(last("draft")?.args[0]).toEqual({ dataset: "items", part: "items", key: "Moon#1" });
    p.receive({
      t: "contentResult",
      seq: last("draft")?.seq ?? 0,
      ok: false,
      text: "the draft does not pass its checks",
      problems: [{ where: "items/items/Moon#1", message: "a key may not contain #" }],
    });
    expect(p.el.querySelector(".content-editor-error")?.textContent).toContain("may not contain #");
  });

  test("Publish sends the draft as the admin saw it, after asking", async () => {
    const { p, last, confirm, settle } = page();
    p.onShow();
    const draft = [
      {
        dataset: "items",
        part: "items",
        key: "Ale",
        op: "set" as const,
        author: "Other",
        updatedAt: "2026-11-22T01:02:03.000Z",
      },
    ];
    p.receive({
      t: "contentOverview",
      seq: last("overview")?.seq ?? 0,
      overview: overview({ draft }),
    });
    expect(p.el.textContent).toContain("Every check passes.");
    expect(p.el.textContent).toContain("Other");
    const publish = p.el.querySelector('[data-action="content-publish"]') as HTMLButtonElement;
    expect(publish.disabled).toBe(false);
    (p.el.querySelector('[data-action="content-summary"]') as HTMLInputElement).value =
      "Rename Ale";
    publish.click();
    confirm();
    await settle();
    expect(last("publish")?.args).toEqual([
      "Rename Ale",
      [{ dataset: "items", part: "items", key: "Ale", updatedAt: "2026-11-22T01:02:03.000Z" }],
    ]);
  });

  test("a failing check blocks Publish and lists the problems", () => {
    const { p, last } = page();
    p.onShow();
    p.receive({
      t: "contentOverview",
      seq: last("overview")?.seq ?? 0,
      overview: overview({
        draft: [
          {
            dataset: "items",
            part: "items",
            key: "Boat Deed",
            op: "remove",
            author: "A",
            updatedAt: "x",
          },
        ],
        problems: [
          {
            where: "houses/deeds/Boat Deed",
            message: "names an item that does not exist: Boat Deed",
          },
        ],
      }),
    });
    expect(
      (p.el.querySelector('[data-action="content-publish"]') as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(p.el.textContent).toContain("names an item that does not exist");
  });

  test("a pack update shows what changed and takes or keeps it", async () => {
    const { p, last, confirm, settle } = page();
    p.onShow();
    p.receive({
      t: "contentOverview",
      seq: last("overview")?.seq ?? 0,
      overview: overview({
        notices: [
          {
            dataset: "casino",
            part: "slots",
            key: null,
            packName: "Classic",
            packVersion: "1.3.0",
            was: { cost: 10 },
            now: { cost: 12 },
            yours: { cost: 25 },
            yoursOp: "set",
          },
        ],
      }),
    });
    expect(p.el.textContent).toContain(
      "Classic v1.3.0 changed casino/slots, which you have customised.",
    );
    expect(p.el.querySelector(".content-diff-add")?.textContent).toContain("12");
    (p.el.querySelector('[data-action="content-notice-dismiss"]') as HTMLButtonElement).click();
    expect(last("notice")?.args).toEqual([{ dataset: "casino", part: "slots", key: null }, false]);
    (p.el.querySelector('[data-action="content-notice-accept"]') as HTMLButtonElement).click();
    confirm();
    await settle();
    expect(last("notice")?.args).toEqual([{ dataset: "casino", part: "slots", key: null }, true]);
  });

  test("Undo takes a publish back after asking; an undone one says so", async () => {
    const { p, last, confirm, settle } = page();
    p.onShow();
    const pub = {
      at: "2026-11-22T01:00:00.000Z",
      actorName: "A",
      rows: ["items/items/Ale"],
      undoOf: null,
    };
    p.receive({
      t: "contentOverview",
      seq: last("overview")?.seq ?? 0,
      overview: overview({
        history: [
          { ...pub, id: "p2", summary: "Second", undoneBy: null },
          { ...pub, id: "p1", summary: "First", undoneBy: "p3" },
        ],
      }),
    });
    const undos = p.el.querySelectorAll('[data-action="content-undo"]');
    expect(undos).toHaveLength(1);
    expect(p.el.textContent).toContain("Undone");
    (undos[0] as HTMLButtonElement).click();
    confirm();
    await settle();
    expect(last("undo")?.args).toEqual(["p2"]);
  });

  test("a read-only row cannot be saved", () => {
    const { p, $, last } = page();
    p.onShow();
    p.receive({ t: "contentOverview", seq: last("overview")?.seq ?? 0, overview: overview() });
    p.receive({
      t: "contentList",
      seq: last("list")?.seq ?? 0,
      listing: {
        dataset: "rects",
        part: "fx",
        keyField: null,
        rows: [{ key: null, status: "pack", draft: null }],
      },
    });
    (p.el.querySelector('[data-action="content-row-open"]') as HTMLElement).click();
    p.receive({
      t: "contentRow",
      seq: last("row")?.seq ?? 0,
      row: { ...ale, dataset: "rects", part: "fx", key: null, keyField: null, readOnly: true },
    });
    expect($("content-save").hidden).toBe(true);
    expect($<HTMLTextAreaElement>("content-json").readOnly).toBe(true);
  });
});

describe("review fixes", () => {
  test("a whole-field row opened from the draft saves while a keyed list is on screen", () => {
    const { p, $, last } = page();
    p.onShow();
    const draft = [
      {
        dataset: "casino",
        part: "slots",
        key: null,
        op: "set" as const,
        author: "A",
        updatedAt: "x",
      },
    ];
    p.receive({
      t: "contentOverview",
      seq: last("overview")?.seq ?? 0,
      overview: overview({ draft }),
    });
    p.receive({
      t: "contentList",
      seq: last("list")?.seq ?? 0,
      listing: { dataset: "items", part: "items", keyField: "name", rows: [] },
    });
    (p.el.querySelector('[data-action="content-draft-open"]') as HTMLElement).click();
    p.receive({
      t: "contentRow",
      seq: last("row")?.seq ?? 0,
      row: {
        ...ale,
        dataset: "casino",
        part: "slots",
        key: null,
        keyField: null,
        pack: { cost: 10 },
        published: { cost: 10 },
      },
    });
    $<HTMLTextAreaElement>("content-json").value = JSON.stringify({ cost: 12 });
    $("content-save").click();
    expect(last("draft")?.args).toEqual([
      { dataset: "casino", part: "slots", key: null },
      "set",
      { cost: 12 },
    ]);
  });

  test("Add a row is editable after a read-only row was shown", () => {
    const { p, $, last } = page();
    p.onShow();
    p.receive({ t: "contentOverview", seq: last("overview")?.seq ?? 0, overview: overview() });
    p.receive({
      t: "contentRow",
      seq: 0,
      row: { ...ale, dataset: "rects", part: "fx", key: null, keyField: null, readOnly: true },
    });
    (p.el.querySelector('[data-action="content-row-open"]') as HTMLElement | null)?.click();
    p.receive({
      t: "contentList",
      seq: last("list")?.seq ?? 0,
      listing: {
        dataset: "rects",
        part: "fx",
        keyField: null,
        rows: [{ key: null, status: "pack", draft: null }],
      },
    });
    (p.el.querySelector('[data-action="content-row-open"]') as HTMLElement).click();
    p.receive({
      t: "contentRow",
      seq: last("row")?.seq ?? 0,
      row: { ...ale, dataset: "rects", part: "fx", key: null, keyField: null, readOnly: true },
    });
    expect($<HTMLTextAreaElement>("content-json").readOnly).toBe(true);
    p.receive({
      t: "contentList",
      seq: last("list")?.seq ?? 0,
      listing: { dataset: "items", part: "items", keyField: "name", rows: [] },
    });
    // The list answered was for an earlier seq; ask again so the items list is current.
    (p.el.querySelector('[data-action="content-dataset"]') as HTMLSelectElement).dispatchEvent(
      new Event("change"),
    );
    p.receive({
      t: "contentList",
      seq: last("list")?.seq ?? 0,
      listing: { dataset: "items", part: "items", keyField: "name", rows: [] },
    });
    $("content-add").click();
    expect($<HTMLTextAreaElement>("content-json").readOnly).toBe(false);
    expect($("content-save").hidden).toBe(false);
  });
});
