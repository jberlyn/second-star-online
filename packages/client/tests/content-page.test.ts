/**
 * The Control Panel's Content page (ui/content-page.ts, issue #27): the installed packs and their
 * update notices, the shared draft with its checks and Publish, the rows of a dataset with a JSON
 * editor that saves to the draft, and the publish history with Undo.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import type {
  ContentItemArtView,
  ContentOverview,
  ContentRowDetail,
  ContentSoundArtView,
  ContentTileArtView,
  ContentUsageView,
  ContentWornArtView,
} from "@secondstaronline/shared";

import type { Assets } from "../src/assets.ts";
import {
  createContentPage,
  editorFor,
  lineDiff,
  makeItemPanels,
  refLabel,
  rowName,
} from "../src/ui/content-page.ts";
import { placeText, removalForm, removalHeadline, useText } from "../src/ui/content-usage.ts";

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
  draftRev: "0123456789abcdef",
  removals: [],
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

function page(assets?: Assets, more: { openEditor?: (r: unknown) => boolean } = {}) {
  const sent: { kind: string; seq: number; args: unknown[] }[] = [];
  const rec =
    (kind: string) =>
    (seq: number, ...args: unknown[]) =>
      sent.push({ kind, seq, args });
  const p = createContentPage(
    {
      overview: rec("overview"),
      list: rec("list"),
      row: rec("row"),
      draft: rec("draft"),
      discard: rec("discard"),
      publish: rec("publish"),
      undo: rec("undo"),
      notice: rec("notice"),
      usage: rec("usage"),
      remove: rec("remove"),
      problems: rec("problems"),
      uploadTicket: rec("uploadTicket"),
      itemArt: rec("itemArt"),
      picture: rec("picture"),
      wornArt: rec("wornArt"),
      wornSheet: rec("wornSheet"),
      worn: rec("worn"),
      bodyArt: rec("bodyArt"),
      bodySheet: rec("bodySheet"),
      body: rec("body"),
      fxArt: rec("fxArt"),
      fxSheet: rec("fxSheet"),
      fx: rec("fx"),
      tileArt: rec("tileArt"),
      tileSheet: rec("tileSheet"),
      tile: rec("tile"),
      soundArt: rec("soundArt"),
      sound: rec("sound"),
      openCharacter: (name: string) => sent.push({ kind: "openCharacter", seq: 0, args: [name] }),
      ...more,
    },
    assets,
  );
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

/** Assets with one picture (Long Sword), so the picture picker can be shown in a test window. */
const SPRITES: Record<string, number[]> = { "long sword": [0, 0, 0, 1, 1, 0, 0] };
const noArt = {
  index: { atlases: { items: { sheets: [], sprites: SPRITES } }, ui: {} },
  sheets: {},
  sprite: (_g: string, n: string) => SPRITES[n.toLowerCase()],
  ui: () => "",
  loadGroup: async () => {},
} as unknown as Assets;

describe("item pictures on the Content page (issue #29)", () => {
  test("an item row shows its picture panel, and a choice there goes into the draft", async () => {
    const { p, $, last, settle } = page(noArt);
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
    (p.el.querySelector('[data-action="content-row-open"]') as HTMLElement).click();
    p.receive({ t: "contentRow", seq: last("row")?.seq ?? 0, row: ale });
    const ask = last("itemArt");
    expect(ask).toBeDefined();
    const view = {
      items: [{ name: "Ale", icon: null }, { name: "Long Sword" }],
      art: [],
      currency: "Gold",
      maxSide: 512,
      packPictures: ["long sword"],
    };
    p.receive({ t: "contentItemArt", seq: ask?.seq ?? 0, view });
    await settle();
    const panel = p.el.querySelector(".content-editor .item-art") as HTMLElement;
    expect(panel.hidden).toBe(false);
    expect(panel.textContent).toContain("It has no picture yet");
    $<HTMLInputElement>("item-art-choose").value = "Long Sword";
    $("item-art-use").click();
    await settle();
    // One change, made whole by the server against the draft as it is then.
    expect(last("picture")?.args).toEqual([{ op: "choose", item: "Ale", picture: "Long Sword" }]);
    p.receive({
      t: "contentResult",
      seq: last("picture")?.seq ?? 0,
      ok: true,
      text: "Ale's picture is in the draft.",
    });
    await settle();
    expect(panel.textContent).toContain("Ale's picture is in the draft.");
    // The page refreshed: the overview and the row again.
    expect(last("row")?.args).toEqual([{ dataset: "items", part: "items", key: "Ale" }]);
  });

  test("a picture change keeps unsaved JSON in the row editor", async () => {
    const { p, $, last, settle } = page(noArt);
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
    (p.el.querySelector('[data-action="content-row-open"]') as HTMLElement).click();
    p.receive({ t: "contentRow", seq: last("row")?.seq ?? 0, row: ale });
    p.receive({
      t: "contentItemArt",
      seq: last("itemArt")?.seq ?? 0,
      view: {
        items: [{ name: "Ale", icon: null }],
        art: [],
        currency: "Gold",
        maxSide: 512,
        packPictures: ["long sword"],
      },
    });
    await settle();
    const json = $<HTMLTextAreaElement>("content-json");
    json.value = JSON.stringify({ name: "Ale", display: "Pale Ale", icon: null });
    const rowSeq = last("row")?.seq;
    $<HTMLInputElement>("item-art-choose").value = "Long Sword";
    $("item-art-use").click();
    await settle();
    p.receive({ t: "contentResult", seq: last("picture")?.seq ?? 0, ok: true, text: "ok" });
    await settle();
    // The row was not asked for again, so the editor kept the operator's text.
    expect(last("row")?.seq).toBe(rowSeq);
    expect(json.value).toContain("Pale Ale");
    expect(p.el.textContent).toContain("your unsaved JSON is kept");
  });

  test("a row that is not an item has no picture panel", () => {
    const { p, last } = page(noArt);
    p.onShow();
    p.receive({ t: "contentOverview", seq: last("overview")?.seq ?? 0, overview: overview() });
    p.receive({
      t: "contentRow",
      seq: 0,
      row: { ...ale, dataset: "casino", part: "blackjack", key: null, keyField: null },
    });
    const panel = p.el.querySelector(".content-editor .item-art") as HTMLElement;
    expect(panel.hidden).toBe(true);
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

  test("a balance row's save and discard send back the revision it was opened at (issue #19)", () => {
    const { p, $, last } = page();
    p.onShow();
    p.receive({ t: "contentOverview", seq: last("overview")?.seq ?? 0, overview: overview() });
    p.receive({
      t: "contentList",
      seq: last("list")?.seq ?? 0,
      listing: {
        dataset: "balance",
        part: "hulls",
        keyField: "vehicle",
        rows: [{ key: "Boat", status: "pack", draft: null }],
      },
    });
    (p.el.querySelector('[data-action="content-row-open"]') as HTMLElement).click();
    p.receive({
      t: "contentRow",
      seq: last("row")?.seq ?? 0,
      row: {
        dataset: "balance",
        part: "hulls",
        key: "Boat",
        keyField: "vehicle",
        readOnly: false,
        status: "pack",
        pack: { vehicle: "Boat", hull: 60 },
        published: { vehicle: "Boat", hull: 60 },
        draft: { op: "set", data: { vehicle: "Boat", hull: 70 }, author: "Other" },
        revision: "r".repeat(16),
      },
    });
    const json = $<HTMLTextAreaElement>("content-json");
    json.value = JSON.stringify({ vehicle: "Boat", hull: 75 });
    $("content-save").click();
    expect(last("draft")?.args).toEqual([
      { dataset: "balance", part: "hulls", key: "Boat" },
      "set",
      { vehicle: "Boat", hull: 75 },
      "r".repeat(16),
    ]);
    $("content-discard").click();
    expect(last("discard")?.args).toEqual([
      { dataset: "balance", part: "hulls", key: "Boat" },
      "r".repeat(16),
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
    // "Log everyone out while publishing" is off by default, with no suggestion.
    const logout = p.el.querySelector('[data-action="content-publish-logout"]') as HTMLInputElement;
    expect(logout.checked).toBe(false);
    expect(p.el.textContent).not.toContain("Suggested");
    confirm();
    await settle();
    expect(last("publish")?.args).toEqual(["Rename Ale", "0123456789abcdef", false]);
  });

  test("the publish confirmation suggests logging everyone out when a removal is in the world", async () => {
    const { p, last, confirm, settle } = page();
    p.onShow();
    p.receive({
      t: "contentOverview",
      seq: last("overview")?.seq ?? 0,
      overview: overview({
        draft: [
          {
            dataset: "items",
            part: "items",
            key: "Ale",
            op: "remove",
            author: "A",
            updatedAt: "2026-11-22T01:02:03.000Z",
          },
        ],
        removals: [
          {
            kind: "item",
            key: "Ale",
            lines: ["Deleted: 5 copies of Ale held by 2 characters"],
            stillUsed: 0,
            inWorld: 2,
          },
        ],
      }),
    });
    (p.el.querySelector('[data-action="content-publish"]') as HTMLButtonElement).click();
    const box = p.el.querySelector('[data-action="control-panel-confirm"]') as HTMLElement;
    expect(box.textContent).toContain("This draft removes 1 item.");
    expect(box.textContent).toContain("Log everyone out while publishing");
    expect(box.textContent).toContain("Suggested");
    const logout = box.querySelector('[data-action="content-publish-logout"]') as HTMLInputElement;
    expect(logout.checked).toBe(false);
    logout.click();
    confirm();
    await settle();
    expect(last("publish")?.args.at(-1)).toBe(true);
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

  test("another action's result leaves unsaved edits and their error box alone", () => {
    const { p, $, last } = page();
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
    (p.el.querySelector('[data-action="content-row-open"]') as HTMLElement).click();
    p.receive({ t: "contentRow", seq: last("row")?.seq ?? 0, row: ale });
    const json = $<HTMLTextAreaElement>("content-json");
    json.value = JSON.stringify({ name: "Ale", display: "Brown Ale", icon: null });
    (p.el.querySelector('[data-action="content-notice-dismiss"]') as HTMLButtonElement).click();
    p.receive({ t: "contentResult", seq: last("notice")?.seq ?? 0, ok: true, text: "Kept." });
    expect(p.changes()).toBe(1);
    (p.el.querySelector('[data-action="content-notice-dismiss"]') as HTMLButtonElement).click();
    p.receive({ t: "contentResult", seq: last("notice")?.seq ?? 0, ok: false, text: "Nope." });
    expect(p.el.querySelector(".content-status")?.textContent).toContain("Nope.");
    expect(p.el.querySelector('[role="alert"]')?.textContent ?? "").not.toContain("Nope.");
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
      "Classic v1.3.0 changed Casino › slots, which you had changed.",
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
      cleanup: [],
      loggedOut: null,
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

test("a new row with an empty or over-long key is caught before anything is sent", () => {
  const { p, $, last, sent } = page();
  p.onShow();
  p.receive({ t: "contentOverview", seq: last("overview")?.seq ?? 0, overview: overview() });
  p.receive({
    t: "contentList",
    seq: last("list")?.seq ?? 0,
    listing: { dataset: "items", part: "items", keyField: "name", rows: [] },
  });
  $("content-add").click();
  for (const name of ["", "   ", "x".repeat(81)]) {
    $<HTMLTextAreaElement>("content-json").value = JSON.stringify({ name, icon: null });
    $("content-save").click();
    expect(sent.some((s) => s.kind === "draft")).toBe(false);
    expect(p.el.querySelector(".content-editor-error")?.textContent).toContain(
      "1 to 80 characters",
    );
  }
});

describe("where an item or a monster is used, and its removal (issue #28)", () => {
  const aleUsage: ContentUsageView = {
    kind: "item",
    key: "Ale",
    name: "Ale",
    retired: false,
    uses: [
      {
        row: { dataset: "craft", part: "stations", key: null },
        where: "craft/stations → cook.recipes[2].output",
        name: "Ale",
        removable: true,
      },
      {
        row: { dataset: "quests", part: "pools", key: null },
        where: "quests/pools → wanted[4].item",
        name: "ale",
        removable: false,
      },
    ],
    world: [
      { place: "bag", count: 5, holders: ["Al", "Bo"], holderCount: 2 },
      { place: "ground", count: 1, holders: ["x1000y992"], holderCount: 1 },
    ],
    npcFile: false,
    pending: false,
    characters: 2,
  };

  /** A page with Ale open in the editor and its usage report in. */
  function withAle(usage: ContentUsageView = aleUsage) {
    const h = page();
    h.p.onShow();
    h.p.receive({ t: "contentOverview", seq: h.last("overview")?.seq ?? 0, overview: overview() });
    h.p.receive({
      t: "contentList",
      seq: h.last("list")?.seq ?? 0,
      listing: {
        dataset: "items",
        part: "items",
        keyField: "name",
        rows: [{ key: "Ale", status: "pack", draft: null }],
      },
    });
    (h.p.el.querySelector('[data-action="content-row-open"]') as HTMLElement).click();
    h.p.receive({ t: "contentRow", seq: h.last("row")?.seq ?? 0, row: ale });
    expect(h.last("usage")?.args).toEqual(["item", "Ale"]);
    h.p.receive({ t: "contentUsage", seq: h.last("usage")?.seq ?? 0, usage });
    return h;
  }

  test("opening an item shows where it is used, with links to each place", () => {
    const { p, sent, last } = withAle();
    expect(p.el.textContent).toContain(
      "Held by 2 characters · on the ground on 1 map · named in 2 places in content",
    );
    expect(p.el.textContent).toContain("cannot be removed, only replaced");
    const holder = p.el.querySelector('[data-action="content-holder-open"]') as HTMLButtonElement;
    holder.click();
    expect(sent.at(-1)).toEqual({ kind: "openCharacter", seq: 0, args: ["Al"] });
    (p.el.querySelector('[data-action="content-use-open"]') as HTMLButtonElement).click();
    expect(last("row")?.args).toEqual([{ dataset: "craft", part: "stations", key: null }]);
  });

  test("Remove offers the cleanup with its defaults: remove the entries, retire the copies", () => {
    const { $, last } = withAle();
    $("content-remove").click();
    expect($<HTMLSelectElement>("content-removal-content").value).toBe("remove");
    expect($<HTMLSelectElement>("content-removal-copies").value).toBe("retire");
    // The refund and the replacement only show when they apply.
    expect(
      ($("content-removal-refund").closest(".control-panel-field") as HTMLElement).hidden,
    ).toBe(true);
    expect(
      ($("content-removal-replacement").closest(".control-panel-field") as HTMLElement).hidden,
    ).toBe(true);
    $("content-removal-submit").click();
    expect(last("remove")?.args).toEqual([
      {
        kind: "item",
        key: "Ale",
        content: "remove",
        replacement: null,
        copies: "retire",
        refundGold: 0,
      },
    ]);
  });

  test("purging asks again, and carries the refund", async () => {
    const { p, $, last, confirm, settle } = withAle();
    $("content-remove").click();
    const copies = $<HTMLSelectElement>("content-removal-copies");
    copies.value = "purge";
    copies.dispatchEvent(new Event("change"));
    $<HTMLInputElement>("content-removal-refund").value = "25";
    $("content-removal-submit").click();
    expect(last("remove")).toBeUndefined();
    expect(p.el.textContent).toContain("Undoing the publish brings the item back, not the copies");
    confirm();
    await settle();
    expect(last("remove")?.args).toEqual([
      {
        kind: "item",
        key: "Ale",
        content: "remove",
        replacement: null,
        copies: "purge",
        refundGold: 25,
      },
    ]);
  });

  test("replacing needs the other item's name", () => {
    const { p, $, last } = withAle();
    $("content-remove").click();
    const sel = $<HTMLSelectElement>("content-removal-content");
    sel.value = "replace";
    sel.dispatchEvent(new Event("change"));
    $("content-removal-submit").click();
    expect(last("remove")).toBeUndefined();
    expect(p.el.textContent).toContain("Name the item to replace it with.");
    $<HTMLInputElement>("content-removal-replacement").value = "Mead";
    $("content-removal-submit").click();
    expect(last("remove")?.args[0]).toMatchObject({ content: "replace", replacement: "Mead" });
  });

  test("a monster's removal offers its roster slots, live ones and NPC file", () => {
    const slime: ContentUsageView = {
      kind: "monster",
      key: "Slime",
      name: "Slime",
      retired: false,
      uses: [],
      world: [
        { place: "spawn", count: 3, holders: ["x1000y992"], holderCount: 1 },
        { place: "live", count: 1, holders: ["x1000y992"], holderCount: 1 },
      ],
      npcFile: true,
      pending: false,
      characters: 0,
    };
    const h = page();
    h.p.onShow();
    h.p.receive({ t: "contentOverview", seq: h.last("overview")?.seq ?? 0, overview: overview() });
    h.p.receive({
      t: "contentRow",
      seq: -1,
      row: ale,
    });
    // Open the monster's row from the draft.
    h.p.receive({
      t: "contentOverview",
      seq: h.last("overview")?.seq ?? 0,
      overview: overview({
        draft: [
          {
            dataset: "monsters",
            part: "monsters",
            key: "Slime",
            op: "set",
            author: "A",
            updatedAt: "2026-11-22T00:00:00.000Z",
          },
        ],
      }),
    });
    (h.p.el.querySelector('[data-action="content-draft-open"]') as HTMLElement).click();
    h.p.receive({
      t: "contentRow",
      seq: h.last("row")?.seq ?? 0,
      row: {
        ...ale,
        dataset: "monsters",
        part: "monsters",
        key: "Slime",
        pack: { name: "Slime" },
        published: { name: "Slime" },
      },
    });
    expect(h.last("usage")?.args).toEqual(["monster", "Slime"]);
    h.p.receive({ t: "contentUsage", seq: h.last("usage")?.seq ?? 0, usage: slime });
    expect(h.p.el.textContent).toContain("spawns on 1 map · 1 alive now · has its own NPC file");
    h.$("content-remove").click();
    expect(h.$<HTMLSelectElement>("content-removal-spawns").value).toBe("remove");
    expect(h.$<HTMLSelectElement>("content-removal-live").value).toBe("despawn");
    expect(h.$<HTMLSelectElement>("content-removal-npcfile").value).toBe("delete");
    h.$("content-removal-submit").click();
    expect(h.last("remove")?.args).toEqual([
      {
        kind: "monster",
        key: "Slime",
        content: "remove",
        replacement: null,
        spawns: "remove",
        live: "despawn",
        npcRow: "delete",
      },
    ]);
  });

  test("Add a row clears the last row's usage report and removal form", () => {
    const { p, $ } = withAle();
    $("content-remove").click();
    expect(p.el.querySelector(".content-removal")).not.toBeNull();
    $("content-add").click();
    expect(p.el.querySelector(".content-usage")).toBeNull();
    expect(p.el.querySelector(".content-removal")).toBeNull();
  });

  test("a usage report that arrives after another row opened is not shown there", () => {
    const { p, last } = withAle();
    const stale = last("usage")?.seq ?? 0;
    p.receive({
      t: "contentOverview",
      seq: last("overview")?.seq ?? 0,
      overview: overview({
        draft: [
          {
            dataset: "casino",
            part: "slots",
            key: null,
            op: "set",
            author: "A",
            updatedAt: "2026-11-22T00:00:00.000Z",
          },
        ],
      }),
    });
    (p.el.querySelector('[data-action="content-draft-open"]') as HTMLElement).click();
    p.receive({ t: "contentUsage", seq: stale, usage: aleUsage });
    expect(p.el.querySelector(".content-usage")).toBeNull();
  });

  test("an item already retired is removed by purging or replacing its copies, not retiring", () => {
    const { $ } = withAle({ ...aleUsage, retired: true });
    $("content-remove").click();
    const sel = $<HTMLSelectElement>("content-removal-copies");
    expect([...sel.options].map((o) => o.value)).toEqual(["purge", "replace"]);
    expect(sel.value).toBe("purge");
  });

  test("the draft says what its removals will do", () => {
    expect(
      removalHeadline([
        { kind: "item", key: "Ale", lines: [], stillUsed: 3, inWorld: 0 },
        { kind: "item", key: "Mead", lines: [], stillUsed: 2, inWorld: 0 },
        { kind: "monster", key: "Slime", lines: [], stillUsed: 0, inWorld: 0 },
      ]),
    ).toBe("This draft removes 2 items and 1 monster still used in 5 places.");
    expect(
      removalHeadline([{ kind: "monster", key: "Slime", lines: [], stillUsed: 0, inWorld: 0 }]),
    ).toBe("This draft removes 1 monster.");
    const { p, last } = page();
    p.onShow();
    p.receive({
      t: "contentOverview",
      seq: last("overview")?.seq ?? 0,
      overview: overview({
        removals: [
          {
            kind: "item",
            key: "Ale",
            lines: ["5 copies in the bags of 2 characters stay (retired: no more can be made)"],
            stillUsed: 2,
            inWorld: 1,
          },
        ],
      }),
    });
    expect(p.el.textContent).toContain("This draft removes 1 item still used in 2 places.");
    expect(p.el.textContent).toContain("stay (retired: no more can be made)");
  });

  test("the history shows what a publish did to the world, and Undo says it stays", async () => {
    const { p, last, settle } = page();
    p.onShow();
    p.receive({
      t: "contentOverview",
      seq: last("overview")?.seq ?? 0,
      overview: overview({
        history: [
          {
            id: "p1",
            at: "2026-11-22T01:00:00.000Z",
            actorName: "A",
            summary: "Purge ale",
            rows: ["items/items/Ale"],
            undoOf: null,
            undoneBy: null,
            cleanup: ["Deleted: 5 copies of Ale held by 2 characters"],
            loggedOut: null,
          },
        ],
      }),
    });
    expect(p.el.textContent).toContain("Deleted: 5 copies of Ale held by 2 characters");
    (p.el.querySelector('[data-action="content-undo"]') as HTMLButtonElement).click();
    await settle();
    expect(p.el.textContent).toContain("is not undone");
  });

  test("a publish that only logged everyone out shows the count, and Undo warns of nothing done to the world", async () => {
    const { p, last, settle } = page();
    p.onShow();
    p.receive({
      t: "contentOverview",
      seq: last("overview")?.seq ?? 0,
      overview: overview({
        history: [
          {
            id: "p1",
            at: "2026-11-22T01:00:00.000Z",
            actorName: "A",
            summary: "Cheaper ale",
            rows: ["items/items/Ale"],
            undoOf: null,
            undoneBy: null,
            cleanup: [],
            loggedOut: 3,
          },
        ],
      }),
    });
    expect(p.el.textContent).toContain("Logged everyone else out while publishing: 3 players.");
    (p.el.querySelector('[data-action="content-undo"]') as HTMLButtonElement).click();
    await settle();
    const box = p.el.querySelector('[data-action="control-panel-confirm"]') as HTMLElement;
    expect(box.textContent).toContain("Undo");
    expect(box.textContent).not.toContain("is not undone");
  });

  test("Look for problems lists them, in the world and in content", () => {
    const { p, $, last } = page();
    p.onShow();
    $("content-problems-check").click();
    p.receive({
      t: "contentProblems",
      seq: last("problems")?.seq ?? 0,
      world: [{ where: "world/bags", message: '"Moonblade" is not an item' }],
      content: [],
    });
    expect(p.el.textContent).toContain("In the world (1)");
    expect(p.el.textContent).toContain('"Moonblade" is not an item');
    expect(p.el.textContent).toContain("Every reference in content resolves.");
  });
});

describe("monster bodies on the Content page (issue #29, stage 4)", () => {
  const wolf: ContentRowDetail = {
    dataset: "monsters",
    part: "monsters",
    key: "Wolf",
    keyField: "name",
    readOnly: false,
    status: "pack",
    pack: { name: "Wolf", body: 1000 },
    published: { name: "Wolf", body: 1000 },
    draft: null,
  };
  const frames = Object.fromEntries(
    [
      "f1-n",
      "f1-e",
      "f1-s",
      "f1-w",
      "f2-n",
      "f2-e",
      "f2-s",
      "f2-w",
      "f3-n",
      "f3-e",
      "f3-s",
      "f3-w",
      "f4-n",
      "f4-e",
      "f4-s",
      "f4-w",
    ].map((f) => [f, { file: "a".repeat(64), regX: 25, regY: 6 }]),
  );
  const bodyView = {
    bodies: [{ body: 1000, users: ["monster Wolf"], monsters: ["Wolf"] }],
    monsters: [{ name: "Wolf", body: 1000 }],
    art: [{ name: "1000", frames }],
    packBodies: [55],
    next: 1001,
    maxSide: 512,
    head: 1,
  };
  /** An Image that "loads" at once, so a saved upload's frames finish loading in the test window. */
  class LoadingImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 46;
    naturalHeight = 45;
    set src(_v: string) {
      queueMicrotask(() => this.onload?.());
    }
  }
  const realImage = globalThis.Image;
  beforeEach(() => {
    globalThis.Image = LoadingImage as unknown as typeof Image;
  });
  afterEach(() => {
    globalThis.Image = realImage;
  });

  function openWolf(t: ReturnType<typeof page>) {
    const { p, last } = t;
    p.onShow();
    p.receive({ t: "contentOverview", seq: last("overview")?.seq ?? 0, overview: overview() });
    p.receive({ t: "contentBodyArt", seq: last("bodyArt")?.seq ?? 0, view: bodyView });
    p.receive({
      t: "contentList",
      seq: last("list")?.seq ?? 0,
      listing: {
        dataset: "monsters",
        part: "monsters",
        keyField: "name",
        rows: [{ key: "Wolf", status: "pack", draft: null }],
      },
    });
    (p.el.querySelector('[data-action="content-row-open"]') as HTMLElement).click();
    p.receive({ t: "contentRow", seq: last("row")?.seq ?? 0, row: wolf });
    p.receive({ t: "contentBodyArt", seq: last("bodyArt")?.seq ?? 0, view: bodyView });
  }

  test("a monster row shows its body panel; a body change there keeps unsaved JSON", async () => {
    const t = page(noArt);
    const { p, $, last, settle } = t;
    openWolf(t);
    await settle();
    const panel = p.el.querySelector(".content-editor section.body-art") as HTMLElement;
    expect(panel.hidden).toBe(false);
    expect(panel.textContent).toContain("It draws body 1000, which nothing else draws.");
    const json = $<HTMLTextAreaElement>("content-json");
    json.value = JSON.stringify({ name: "Wolf", display: "Grey Wolf", body: 1000 });
    const rowSeq = last("row")?.seq;
    const sel = $<HTMLSelectElement>("body-art-choose");
    sel.value = "55";
    $("body-art-use").click();
    await settle();
    expect(last("body")?.args[0]).toEqual({ op: "choose", monster: "Wolf", body: 55, from: 1000 });
    p.receive({ t: "contentResult", seq: last("body")?.seq ?? 0, ok: true, text: "ok", body: 55 });
    await settle();
    expect(last("row")?.seq).toBe(rowSeq);
    expect(json.value).toContain("Grey Wolf");
    expect(p.el.textContent).toContain("your unsaved JSON is kept");
  });

  test("Neon fix: a body saved in the Bodies section leaves a new row and the row panel's frames alone", async () => {
    const t = page(noArt);
    const { p, $, last, settle } = t;
    openWolf(t);
    await settle();
    await settle();
    // Frames being set up in the row's panel: its saved upload, moved 3 px.
    const right = $<HTMLInputElement>("body-art-right");
    right.value = "3";
    right.dispatchEvent(new Event("change"));
    expect(p.changes()).toBe(1);
    const rowSeq = last("row")?.seq;
    // In the section, body 1000's upload is taken out.
    (p.el.querySelector('[data-action="bodies-open"][data-key="1000"]') as HTMLElement).click();
    await settle();
    $("body-remove").click();
    await settle();
    expect(last("body")?.args[0]).toEqual({ op: "remove", body: 1000 });
    p.receive({
      t: "contentResult",
      seq: last("body")?.seq ?? 0,
      ok: true,
      text: "ok",
      body: 1000,
    });
    await settle();
    // The row is not reloaded, so its panel keeps its frames.
    expect(last("row")?.seq).toBe(rowSeq);
    expect(p.changes()).toBe(1);

    // A new row being added is not wiped by a section save either.
    $("content-add").click();
    const json = $<HTMLTextAreaElement>("content-json");
    json.value = '{"name": "Blob"}';
    (p.el.querySelector('[data-action="bodies-open"][data-key="1000"]') as HTMLElement).click();
    await settle();
    $("body-remove").click();
    await settle();
    p.receive({
      t: "contentResult",
      seq: last("body")?.seq ?? 0,
      ok: true,
      text: "ok",
      body: 1000,
    });
    await settle();
    expect(json.value).toBe('{"name": "Blob"}');
    expect(p.el.textContent).not.toContain("There is no such row.");
  });

  test("Neon fix: Discard drops frames set up in the Bodies section's panel too", async () => {
    const t = page(noArt);
    const { p, $, settle } = t;
    openWolf(t);
    await settle();
    (p.el.querySelector('[data-action="bodies-open"][data-key="1000"]') as HTMLElement).click();
    await settle();
    await settle();
    const right = $<HTMLInputElement>("body-right");
    right.value = "2";
    right.dispatchEvent(new Event("change"));
    expect(p.changes()).toBe(1);
    p.discard();
    expect(p.changes()).toBe(0);
  });
});

describe("spell effects on the Content page (issue #29, stage 5)", () => {
  const crushRow: ContentRowDetail = {
    dataset: "spells",
    part: "spells",
    key: "Crush",
    keyField: "name",
    readOnly: false,
    status: "pack",
    pack: { name: "Crush", fx: [] },
    published: { name: "Crush", fx: [] },
    draft: null,
  };
  const fxView = {
    runs: [
      {
        member: "Crush",
        effect: "Crush",
        show: "point" as const,
        needs: 2,
        trail: 0,
        trigger: 0,
        users: ["spell Crush"],
        spell: "Crush",
        content: true,
      },
    ],
    spells: [
      { name: "Crush", fx: [{ member: "Crush", effect: "Crush", frames: 2, lastFrame: 2 }] },
    ],
    art: [
      {
        name: "Crush",
        frames: [
          { file: "a".repeat(64), regX: 4, regY: 4 },
          { file: "a".repeat(64), regX: 4, regY: 4 },
        ],
      },
    ],
    packRuns: {},
    maxSide: 512,
    head: 1,
  };
  class LoadingImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 16;
    naturalHeight = 16;
    set src(_v: string) {
      queueMicrotask(() => this.onload?.());
    }
  }
  const realImage = globalThis.Image;
  beforeEach(() => {
    globalThis.Image = LoadingImage as unknown as typeof Image;
  });
  afterEach(() => {
    globalThis.Image = realImage;
  });

  function openCrush(t: ReturnType<typeof page>) {
    const { p, last } = t;
    p.onShow();
    p.receive({ t: "contentOverview", seq: last("overview")?.seq ?? 0, overview: overview() });
    p.receive({ t: "contentFxArt", seq: last("fxArt")?.seq ?? 0, view: fxView });
    p.receive({
      t: "contentList",
      seq: last("list")?.seq ?? 0,
      listing: {
        dataset: "spells",
        part: "spells",
        keyField: "name",
        rows: [{ key: "Crush", status: "pack", draft: null }],
      },
    });
    (p.el.querySelector('[data-action="content-row-open"]') as HTMLElement).click();
    p.receive({ t: "contentRow", seq: last("row")?.seq ?? 0, row: crushRow });
    p.receive({ t: "contentFxArt", seq: last("fxArt")?.seq ?? 0, view: fxView });
  }

  test("a spell row shows its effect panel; a change there keeps unsaved JSON", async () => {
    const t = page(noArt);
    const { p, $, last, settle } = t;
    openCrush(t);
    await settle();
    await settle();
    const panel = p.el.querySelector(".content-editor section.fx-art") as HTMLElement;
    expect(panel.hidden).toBe(false);
    expect(panel.textContent).toContain("Crush shows 2 frames. Drawn by spell Crush.");
    const json = $<HTMLTextAreaElement>("content-json");
    json.value = JSON.stringify({ name: "Crush", display: "Big Crush", fx: [] });
    const rowSeq = last("row")?.seq;
    $("fx-art-remove").click();
    await settle();
    expect(last("fx")?.args[0]).toMatchObject({ op: "remove", run: "Crush" });
    p.receive({
      t: "contentResult",
      seq: last("fx")?.seq ?? 0,
      ok: true,
      text: "ok",
      run: "Crush",
    });
    await settle();
    expect(last("row")?.seq).toBe(rowSeq);
    // Taking the upload out does not change the spell's row: the row is left as it is.
    expect(json.value).toContain("Big Crush");
    expect(p.el.textContent).not.toContain("There is no such row.");
  });

  test("Sol 6: a save in the section leaves the open row and its panel's unsaved work alone", async () => {
    const t = page(noArt);
    const { p, $, last, settle } = t;
    openCrush(t);
    await settle();
    await settle();
    // Work set up in the row's Effect panel: its saved upload, moved 3 px.
    const right = $<HTMLInputElement>("fx-art-right");
    right.value = "3";
    right.dispatchEvent(new Event("change"));
    expect(p.changes()).toBe(1);
    const rowSeq = last("row")?.seq;
    // In the section, Crush's upload is taken out.
    (p.el.querySelector('[data-action="fx-open"][data-key="crush"]') as HTMLElement).click();
    await settle();
    await settle();
    $("fx-remove").click();
    await settle();
    p.receive({
      t: "contentResult",
      seq: last("fx")?.seq ?? 0,
      ok: true,
      text: "ok",
      run: "Crush",
    });
    await settle();
    expect(last("row")?.seq).toBe(rowSeq);
    expect(p.changes()).toBe(1);
  });

  test("Neon 6: a save in the section refreshes the row's Effect panel when nothing is set up in it", async () => {
    const t = page(noArt);
    const { p, $, last, settle } = t;
    openCrush(t);
    await settle();
    await settle();
    (p.el.querySelector('[data-action="fx-open"][data-key="crush"]') as HTMLElement).click();
    await settle();
    await settle();
    const before = t.sent.filter((x) => x.kind === "fxArt").length;
    $("fx-remove").click();
    await settle();
    p.receive({
      t: "contentResult",
      seq: last("fx")?.seq ?? 0,
      ok: true,
      text: "ok",
      run: "Crush",
    });
    await settle();
    // The section's list and the row's own panel both ask for the draft's runs again.
    expect(t.sent.filter((x) => x.kind === "fxArt").length).toBeGreaterThanOrEqual(before + 2);
  });

  test("Discard drops frames set up in the Spell effects section's panel too", async () => {
    const t = page(noArt);
    const { p, $, settle } = t;
    openCrush(t);
    await settle();
    (p.el.querySelector('[data-action="fx-open"][data-key="crush"]') as HTMLElement).click();
    await settle();
    await settle();
    const right = $<HTMLInputElement>("fx-right");
    right.value = "2";
    right.dispatchEvent(new Event("change"));
    expect(p.changes()).toBe(1);
    p.discard();
    expect(p.changes()).toBe(0);
  });
});

describe("tiles on the Content page (issue #29, stage 6)", () => {
  const tileView: ContentTileArtView = {
    catalogue: [
      { code: "G1", member: 1 },
      { code: "S3", name: "Tree", member: 55 },
    ],
    walkable: ["G1"],
    art: [],
    packTiles: ["g1", "s3"],
    refs: {},
    maps: {},
    next: "AA",
    ground: "G1",
    liveUploads: [],
    head: 1,
  };

  function showTiles(t: ReturnType<typeof page>) {
    const { p, last } = t;
    p.onShow();
    p.receive({ t: "contentOverview", seq: last("overview")?.seq ?? 0, overview: overview() });
    p.receive({ t: "contentTileArt", seq: last("tileArt")?.seq ?? 0, view: tileView });
  }

  test("the Tiles section lists the catalogue; Discard drops a tile's unsaved changes", async () => {
    const t = page(noArt);
    const { p, $, settle } = t;
    showTiles(t);
    await settle();
    expect(p.el.querySelectorAll('[data-action="tiles-open"]').length).toBe(2);
    (p.el.querySelector('[data-action="tiles-open"][data-code="S3"]') as HTMLElement).click();
    const name = $<HTMLInputElement>("tile-art-name");
    expect(name.value).toBe("Tree");
    name.value = "Oak";
    name.dispatchEvent(new Event("input"));
    expect(p.changes()).toBe(1);
    p.discard();
    expect(p.changes()).toBe(0);
  });

  test("a tile change goes into the draft, and the section refreshes from it", async () => {
    const t = page(noArt);
    const { p, $, last, settle, sent } = t;
    showTiles(t);
    await settle();
    (p.el.querySelector('[data-action="tiles-open"][data-code="S3"]') as HTMLElement).click();
    const walk = $<HTMLInputElement>("tile-art-walkable");
    walk.checked = true;
    walk.dispatchEvent(new Event("change"));
    $<HTMLButtonElement>("tile-art-save").click();
    const change = last("tile");
    expect(change?.args[0]).toMatchObject({
      op: "edit",
      code: "S3",
      name: "Tree",
      walkable: true,
      flags: [],
    });
    const before = sent.filter((x) => x.kind === "tileArt").length;
    p.receive({ t: "contentResult", seq: change?.seq ?? 0, ok: true, text: "In the draft." });
    await settle();
    // The page refreshes the section from the draft.
    expect(sent.filter((x) => x.kind === "tileArt").length).toBeGreaterThan(before);
  });
});

describe("sounds on the Content page (issue #29, stage 7)", () => {
  const soundView: ContentSoundArtView = {
    uses: { crush: { name: "crush", users: ["spell Crush"] } },
    art: [],
    packSounds: { crush: "/assets/packs/classic/sounds/crush.wav?v=1" },
    liveUploads: [],
    maxBytes: 5 * 1024 * 1024,
  };

  function showSounds(t: ReturnType<typeof page>, view = soundView) {
    const { p, last } = t;
    p.onShow();
    p.receive({ t: "contentOverview", seq: last("overview")?.seq ?? 0, overview: overview() });
    p.receive({ t: "contentSoundArt", seq: last("soundArt")?.seq ?? 0, view });
  }

  test("the Sounds section lists every sound; Discard drops a new sound's chosen files", async () => {
    const t = page(noArt);
    const { p, settle } = t;
    showSounds(t);
    await settle();
    expect(p.el.querySelector('[data-action="sounds-open"][data-sound="crush"]')?.textContent).toBe(
      "crush",
    );
    // Upload tickets never answer here, so a chosen file stays waiting: unsaved work.
    const files = p.el.querySelector('[data-action="sounds-files"]') as HTMLInputElement;
    Object.defineProperty(files, "files", {
      configurable: true,
      value: [new File([new Uint8Array(8)], "boom.wav")],
    });
    files.dispatchEvent(new Event("change"));
    await settle();
    expect(p.changes()).toBe(1);
    p.discard();
    expect(p.changes()).toBe(0);
  });

  test("a sound change goes into the draft, and the section refreshes from it", async () => {
    const t = page(noArt);
    const { p, last, settle, sent } = t;
    showSounds(t, { ...soundView, art: [{ name: "crush", file: "a".repeat(64), format: "wav" }] });
    await settle();
    (p.el.querySelector('[data-action="sounds-open"][data-sound="crush"]') as HTMLElement).click();
    expect(p.el.textContent).toContain("Replaces crush for spell Crush.");
    const before = sent.filter((x) => x.kind === "soundArt").length;
    // The section's own apply goes through the page's `sound` action and its result.
    const remove = p.el.querySelector('[data-action="sound-art-remove"]') as HTMLButtonElement;
    expect(remove.hidden || remove.disabled).toBe(false);
    remove.click();
    const change = last("sound");
    expect(change?.args[0]).toMatchObject({ op: "remove", name: "crush" });
    p.receive({
      t: "contentResult",
      seq: change?.seq ?? 0,
      ok: true,
      text: "Out.",
      sound: "crush",
    });
    await settle();
    expect(sent.filter((x) => x.kind === "soundArt").length).toBeGreaterThan(before);
  });
});

describe("the Items page's picture panels (#30)", () => {
  /** A fake panel: pending until shown again, recording what it was shown. */
  const fake = () => {
    const shows: string[] = [];
    let pending = false;
    return {
      el: document.createElement("div"),
      shows,
      setPending: (v: boolean) => {
        pending = v;
      },
      show(item: { name?: string; item?: string }) {
        shows.push(item.name ?? item.item ?? "");
        pending = false;
      },
      clear() {},
      pending: () => pending,
    };
  };
  const itemView = {
    items: [{ name: "Stick" }],
    art: [],
    currency: "Gold",
    maxSide: 512,
    packPictures: [],
  } as unknown as ContentItemArtView;
  const wornView = { items: [{ name: "Stick" }] } as unknown as ContentWornArtView;

  test("a panel that just saved refreshes, while the other keeps its unsaved work", async () => {
    const pic = fake();
    const worn = fake();
    let picSaved = () => {};
    let saves = 0;
    const panels = makeItemPanels(
      (ps) => {
        picSaved = ps;
        return { pic, worn };
      },
      async () => itemView,
      async () => wornView,
      () => {
        saves += 1;
      },
    );
    panels.show("Stick");
    await new Promise((r) => setTimeout(r, 0));
    expect(pic.shows).toEqual(["Stick"]);
    // A picture is uploaded and saved while frames are set up beside it; the save's refresh
    // (and any refresh after it, such as the form's slot save) must not leave the saved picture
    // marked unsaved, nor wipe the unsaved frames.
    pic.setPending(true);
    worn.setPending(true);
    picSaved();
    expect(saves).toBe(1);
    panels.show("Stick");
    await new Promise((r) => setTimeout(r, 0));
    expect(pic.shows).toEqual(["Stick", "Stick"]);
    expect(panels.pending()).toBe(true); // the worn frames, still unsaved
    expect(worn.shows).toEqual(["Stick"]);
    // Unsaved picture work (no save) is kept by a later refresh.
    pic.setPending(true);
    panels.show("Stick");
    await new Promise((r) => setTimeout(r, 0));
    expect(pic.shows).toEqual(["Stick", "Stick"]);
  });
});

describe("the plain-language page", () => {
  const draftOf = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      dataset: "items",
      part: "items",
      key: `Ale ${i + 1}`,
      op: "set" as const,
      author: "Other",
      updatedAt: "2026-11-22T01:02:03.000Z",
    }));
  const tabs = (p: ReturnType<typeof page>["p"]) => [
    ...p.el.querySelectorAll<HTMLButtonElement>('[data-action="content-tab"]'),
  ];
  const shown = (p: ReturnType<typeof page>["p"], title: string) => {
    const sec = [...p.el.querySelectorAll<HTMLElement>(".content-section")].find(
      (s) => s.querySelector("h2")?.textContent === title,
    );
    return sec !== undefined && !sec.classList.contains("control-panel-tab-hidden");
  };

  test("rows are named in words, as the editor pages name them", () => {
    expect(rowName({ dataset: "items", part: "items", key: "Ale" })).toBe("Item: Ale");
    expect(rowName({ dataset: "monsters", part: "definitions", key: "Orc" })).toBe(
      "Monster rules: Orc",
    );
    expect(rowName({ dataset: "balance", part: "spellEffects", key: "Firebolt" })).toBe(
      "Balance › spell effects › Firebolt",
    );
    expect(rowName({ dataset: "casino", part: "slots", key: null })).toBe("Casino › slots");
    expect(rowName({ dataset: "newThing", part: "newThing", key: null })).toBe("newThing");
  });

  test("the page opens on the unpublished changes; each tab shows its own part", () => {
    const { p } = page();
    expect(tabs(p).map((b) => b.textContent)).toEqual([
      "Unpublished changes",
      "Pictures and sounds",
      "History",
      "Packs",
      "Find problems",
      "Edit as JSON (advanced)",
    ]);
    expect(tabs(p)[0]?.getAttribute("aria-selected")).toBe("true");
    expect(shown(p, "Unpublished changes")).toBe(true);
    expect(shown(p, "Publish history")).toBe(false);
    expect(shown(p, "Edit as JSON (advanced)")).toBe(false);
    tabs(p)[2]?.click();
    expect(shown(p, "Publish history")).toBe(true);
    expect(shown(p, "Unpublished changes")).toBe(false);
  });

  test("the first tab counts what waits to be published and carries a mark", () => {
    const { p, last } = page();
    p.onShow();
    p.receive({
      t: "contentOverview",
      seq: last("overview")?.seq ?? 0,
      overview: overview({ draft: draftOf(3) }),
    });
    const first = tabs(p)[0] as HTMLButtonElement;
    expect(first.textContent).toBe("Unpublished changes (3)");
    expect(first.classList.contains("control-panel-tab-used")).toBe(true);
    expect(
      (p.el.querySelector('[data-action="content-publish"]') as HTMLButtonElement).textContent,
    ).toBe("Publish 3 changes");
    // Each change is named in words, its path kept as a hint.
    const cell = [...p.el.querySelectorAll("span")].find((s) => s.textContent === "Item: Ale 1");
    expect(cell?.title).toBe("items/items/Ale 1");
    expect(p.el.textContent).toContain("Cancel this change");
    p.receive({ t: "contentOverview", seq: last("overview")?.seq ?? 0, overview: overview() });
    expect(first.textContent).toBe("Unpublished changes");
    expect(first.classList.contains("control-panel-tab-used")).toBe(false);
  });

  test("opening a row (from a change, or another page's link) shows the JSON tab", () => {
    const { p, last } = page();
    p.openRow({ dataset: "items", part: "items", key: "Ale" });
    expect(tabs(p)[5]?.getAttribute("aria-selected")).toBe("true");
    expect(shown(p, "Edit as JSON (advanced)")).toBe(true);
    p.receive({ t: "contentRow", seq: last("row")?.seq ?? 0, row: ale });
    expect(p.el.querySelector(".content-editor-title")?.textContent).toBe("Item: Ale");
    expect(p.el.querySelector(".content-editor-state")?.textContent).toBe("Original");
    expect(p.el.querySelector('[data-action="content-remove"]')?.textContent).toBe(
      "Remove or retire this item…",
    );
  });

  test("the history names what each publish changed in words", () => {
    const { p, last } = page();
    p.onShow();
    p.receive({
      t: "contentOverview",
      seq: last("overview")?.seq ?? 0,
      overview: overview({
        history: [
          {
            id: "p1",
            at: "2026-11-22T01:02:03.000Z",
            actorName: "Other",
            summary: "Cheaper ale",
            rows: ["items/items/Ale", "casino/slots"],
            undoOf: null,
            undoneBy: null,
            cleanup: [],
            loggedOut: null,
          },
        ],
      }),
    });
    expect(p.el.textContent).toContain("Item: Ale, Casino › slots");
    expect(p.el.textContent).toContain("Undo this publish");
  });
});

describe("references and changes in plain words", () => {
  test("a reference reads as words, with its path kept for the tooltip", () => {
    expect(placeText("cook.recipes[2].output")).toBe("cook › recipes 3 › output");
    expect(placeText("line 6")).toBe("line 6");
    expect(placeText("[16]")).toBe("entry 17");
    expect(
      useText({
        row: { dataset: "npcFiles", part: "files", key: "Amber" },
        where: "npcFiles/files/Amber → line 6",
      }),
    ).toBe("Amber's NPC file, line 6");
    expect(
      useText({
        row: { dataset: "craft", part: "stations", key: null },
        where: "craft/stations → cook.recipes[2].output",
      }),
    ).toBe("Crafting › stations, cook › recipes 3 › output");
    expect(useText({ row: { dataset: "items", part: "items", key: "Ale" }, where: "x" })).toBe(
      "Item: Ale",
    );
  });

  test("each change knows the editor page it opens on", () => {
    expect(editorFor({ dataset: "items", part: "definitions", key: "Ale" })).toEqual({
      page: "items",
      key: "Ale",
    });
    expect(editorFor({ dataset: "monsters", part: "monsters", key: "Orc" })?.page).toBe("monsters");
    expect(editorFor({ dataset: "classes", part: "skills", key: "parry" })?.page).toBe("skills");
    expect(editorFor({ dataset: "npcFiles", part: "files", key: "Amber" })?.page).toBe("npcs");
    expect(editorFor({ dataset: "gather", part: "harvest", key: null })).toEqual({
      page: "gathering",
      key: null,
    });
    expect(editorFor({ dataset: "balance", part: "regen", key: null })?.page).toBe("balance");
    expect(editorFor({ dataset: "casino", part: "slots", key: null })).toBeNull();
  });

  const withChanges = (openEditor?: (r: unknown) => boolean) => {
    const h = page(undefined, openEditor ? { openEditor } : {});
    h.p.onShow();
    h.p.receive({
      t: "contentOverview",
      seq: h.last("overview")?.seq ?? 0,
      overview: overview({
        draft: [
          {
            dataset: "items",
            part: "items",
            key: "Ale",
            op: "set",
            author: "A",
            updatedAt: "2026-11-22T01:02:03.000Z",
          },
          {
            dataset: "casino",
            part: "slots",
            key: null,
            op: "set",
            author: "A",
            updatedAt: "2026-11-22T01:02:03.000Z",
          },
        ],
      }),
    });
    return h;
  };

  test("clicking a change opens it on its editor page, with Edit as JSON beside it", () => {
    const opened: unknown[] = [];
    const h = withChanges((r) => {
      opened.push(r);
      return true;
    });
    const rowsOf = () => [
      ...h.p.el.querySelectorAll<HTMLElement>('[data-action="content-draft-open"]'),
    ];
    (rowsOf()[0] as HTMLElement).click();
    expect(opened).toEqual([{ dataset: "items", part: "items", key: "Ale" }]);
    expect(h.last("row")).toBeUndefined();
    // Only the change with an editor page offers Edit as JSON; it opens the JSON editor.
    const json = [
      ...h.p.el.querySelectorAll<HTMLButtonElement>('[data-action="content-draft-json"]'),
    ];
    expect(json).toHaveLength(1);
    json[0]?.click();
    expect(h.last("row")?.args).toEqual([{ dataset: "items", part: "items", key: "Ale" }]);
    // A change no editor page covers opens as JSON.
    (rowsOf()[1] as HTMLElement).click();
    expect(opened).toHaveLength(1);
    expect(h.last("row")?.args).toEqual([{ dataset: "casino", part: "slots", key: null }]);
  });

  test("a change opens as JSON when its editor page can't be opened", () => {
    const h = withChanges(() => false);
    (h.p.el.querySelector('[data-action="content-draft-open"]') as HTMLElement).click();
    expect(h.last("row")?.args).toEqual([{ dataset: "items", part: "items", key: "Ale" }]);
  });
});

describe("the removal form in plain words", () => {
  test("the button says whether it retires or removes the item", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const usage: ContentUsageView = {
      kind: "item",
      key: "Ale",
      name: "Ale",
      retired: false,
      uses: [],
      world: [{ place: "bag", count: 3, holders: ["Al"], holderCount: 1 }],
      npcFile: false,
      pending: false,
      characters: 1,
    };
    const form = removalForm(usage, host, { submit: () => {}, cancel: () => {} });
    host.append(form);
    const submit = form.querySelector<HTMLButtonElement>('[data-action="content-removal-submit"]');
    expect(submit?.textContent).toBe("Retire it");
    const copies = form.querySelector<HTMLSelectElement>('[data-action="content-removal-copies"]');
    if (copies) {
      copies.value = "purge";
      copies.dispatchEvent(new Event("change"));
    }
    expect(submit?.textContent).toBe("Remove it");
    expect(form.textContent).toContain("Nothing changes for players until you publish.");
  });
});
