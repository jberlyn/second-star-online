/**
 * The Control Panel's Content page (ui/content-page.ts, issue #27): the installed packs and their
 * update notices, the shared draft with its checks and Publish, the rows of a dataset with a JSON
 * editor that saves to the draft, and the publish history with Undo.
 */
import { describe, expect, test } from "bun:test";

import type { ContentOverview, ContentRowDetail, ContentUsageView } from "@secondstaronline/shared";

import { createContentPage, lineDiff, refLabel } from "../src/ui/content-page.ts";
import { removalHeadline } from "../src/ui/content-usage.ts";

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
    usage: rec("usage"),
    remove: rec("remove"),
    problems: rec("problems"),
    openCharacter: (name: string) => sent.push({ kind: "openCharacter", seq: 0, args: [name] }),
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
    expect(last("publish")?.args).toEqual(["Rename Ale", "0123456789abcdef"]);
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
      cleanup: [],
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

  test("the draft says what its removals will do", () => {
    expect(
      removalHeadline([
        { kind: "item", key: "Ale", lines: [], stillUsed: 3 },
        { kind: "item", key: "Mead", lines: [], stillUsed: 2 },
        { kind: "monster", key: "Slime", lines: [], stillUsed: 0 },
      ]),
    ).toBe("This draft removes 2 items and 1 monster still used in 5 places.");
    expect(removalHeadline([{ kind: "monster", key: "Slime", lines: [], stillUsed: 0 }])).toBe(
      "This draft removes 1 monster.",
    );
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
          },
        ],
      }),
    });
    expect(p.el.textContent).toContain("Deleted: 5 copies of Ale held by 2 characters");
    (p.el.querySelector('[data-action="content-undo"]') as HTMLButtonElement).click();
    await settle();
    expect(p.el.textContent).toContain("is not undone");
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
