/**
 * The Control Panel's Publish Changes page (ui/content-page.ts, issue #27): the pack update
 * notices, the shared draft with its checks and Publish, the publish history with Undo, Find
 * problems, and the "Where it is used" view of one row with its removal (issue #28). Its Pictures
 * & Sounds sections (issue #29) live in `artEl`, the separate Pictures & Sounds page.
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
import { createContentPage, makeItemPanels, refLabel, rowName } from "../src/ui/content-page.ts";
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

const ALE = { dataset: "items", part: "items", key: "Ale" };

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
  // Both pages are mounted, as the Control Panel mounts them (one shown at a time).
  document.body.replaceChildren(p.el, p.artEl);
  const $ = <T extends HTMLElement>(action: string) =>
    document.querySelector<T>(`[data-action="${action}"]`) as T;
  const last = (kind: string) => [...sent].reverse().find((s) => s.kind === kind);
  const count = (kind: string) => sent.filter((s) => s.kind === kind).length;
  const confirm = () =>
    (
      document.querySelector('[data-action="control-panel-confirm-ok"]') as HTMLButtonElement
    ).click();
  const settle = () => new Promise((r) => setTimeout(r, 0));
  /** Opens a row (as another page's link does) and answers it. */
  const open = (row: ContentRowDetail) => {
    p.openRow({ dataset: row.dataset, part: row.part, key: row.key });
    p.receive({ t: "contentRow", seq: last("row")?.seq ?? 0, row });
  };
  return { p, sent, $, last, count, confirm, settle, open };
}

const tabs = (p: ReturnType<typeof page>["p"]) => [
  ...p.el.querySelectorAll<HTMLButtonElement>('[data-action="content-tab"]'),
];
const shown = (p: ReturnType<typeof page>["p"], title: string) => {
  const sec = [...p.el.querySelectorAll<HTMLElement>(".content-section")].find(
    (s) => s.querySelector("h2")?.textContent === title,
  );
  return sec !== undefined && !sec.classList.contains("control-panel-tab-hidden");
};

describe("the helpers", () => {
  test("a row is named by dataset, field and key", () => {
    expect(refLabel({ dataset: "items", part: "items", key: "Ale" })).toBe("items/items/Ale");
    expect(refLabel({ dataset: "casino", part: "blackjack", key: null })).toBe("casino/blackjack");
  });

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
});

describe("no JSON editing anywhere", () => {
  test("neither page has a JSON box, a row picker, Add a row or Edit as JSON", () => {
    const { p, open, last } = page(noArtAssets());
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
            op: "set",
            author: "A",
            updatedAt: "2026-11-22T01:02:03.000Z",
          },
        ],
      }),
    });
    open(ale);
    for (const el of [p.el, p.artEl]) {
      expect(el.querySelector("textarea")).toBeNull();
      expect(el.textContent).not.toContain("Edit as JSON");
      expect(el.textContent).not.toContain("Show the original");
      for (const gone of [
        "content-json",
        "content-save",
        "content-add",
        "content-dataset",
        "content-part",
        "content-row-open",
        "content-draft-json",
      ]) {
        expect(el.querySelector(`[data-action="${gone}"]`)).toBeNull();
      }
    }
    // The installed packs are on the Packs page, not here.
    expect(p.el.textContent).not.toContain("v1.0.0");
  });
});

describe("the Publish Changes page", () => {
  test("showing it asks for the overview only, and there is nothing to publish yet", () => {
    const { p, last, count } = page();
    p.onShow();
    expect(last("overview")).toBeDefined();
    p.receive({ t: "contentOverview", seq: last("overview")?.seq ?? 0, overview: overview() });
    // No dataset rows are listed any more.
    expect(count("list")).toBe(0);
    const publish = p.el.querySelector('[data-action="content-publish"]') as HTMLButtonElement;
    expect(publish.disabled).toBe(true);
    expect(p.el.textContent).toContain("Nothing to publish");
  });

  test("the page opens on the unpublished changes; each tab shows its own part", () => {
    const { p } = page();
    expect(tabs(p).map((b) => b.textContent)).toEqual([
      "Unpublished changes",
      "History",
      "Find problems",
      "Where it is used",
    ]);
    // "Where it is used" only shows while a row is open.
    expect(tabs(p).map((b) => b.hidden)).toEqual([false, false, false, true]);
    expect(tabs(p)[0]?.getAttribute("aria-selected")).toBe("true");
    expect(shown(p, "Unpublished changes")).toBe(true);
    expect(shown(p, "Publish history")).toBe(false);
    expect(shown(p, "Where it is used")).toBe(false);
    tabs(p)[1]?.click();
    expect(shown(p, "Publish history")).toBe(true);
    expect(shown(p, "Unpublished changes")).toBe(false);
    tabs(p)[2]?.click();
    expect(shown(p, "Find problems")).toBe(true);
  });

  test("the first tab counts what waits to be published and carries a mark", () => {
    const draftOf = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        dataset: "items",
        part: "items",
        key: `Ale ${i + 1}`,
        op: "set" as const,
        author: "Other",
        updatedAt: "2026-11-22T01:02:03.000Z",
      }));
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
    // Each change is named in words, with the page it opens on as a hint.
    const cell = [...p.el.querySelectorAll("span")].find((s) => s.textContent === "Item: Ale 1");
    expect(cell?.title).toBe("Opens on the Items page");
    expect(p.el.textContent).toContain("Cancel this change");
    p.receive({ t: "contentOverview", seq: last("overview")?.seq ?? 0, overview: overview() });
    expect(first.textContent).toBe("Unpublished changes");
    expect(first.classList.contains("control-panel-tab-used")).toBe(false);
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

  test("a new row reads Added in the change list, an edited one Changed", () => {
    const { p, last } = page();
    p.onShow();
    const row = (key: string, added: boolean) => ({
      dataset: "items",
      part: "items",
      key,
      op: "set" as const,
      author: "A",
      updatedAt: "2026-11-22T01:02:03.000Z",
      ...(added ? { added: true as const } : {}),
    });
    p.receive({
      t: "contentOverview",
      seq: last("overview")?.seq ?? 0,
      overview: overview({ draft: [row("Moonblade", true), row("Ale", false)] }),
    });
    const changes = [...p.el.querySelectorAll("tbody tr")]
      .map((tr) => tr.querySelectorAll("td")[1]?.textContent)
      .filter((t) => t === "Added" || t === "Changed");
    expect(changes).toEqual(["Added", "Changed"]);
  });

  test("Cancel this change asks first, then discards the change with the revision it carries", async () => {
    const { p, last, count } = page();
    p.onShow();
    p.receive({
      t: "contentOverview",
      seq: last("overview")?.seq ?? 0,
      overview: overview({
        draft: [
          {
            dataset: "balance",
            part: "hulls",
            key: "Boat",
            op: "set",
            author: "A",
            updatedAt: "2026-11-22T01:02:03.000Z",
            revision: "r".repeat(16),
          },
        ],
      }),
    });
    (p.el.querySelector('[data-action="content-draft-discard"]') as HTMLButtonElement).click();
    // It asks first: Keep it sends nothing, Cancel the change sends the discard.
    expect(last("discard")).toBeUndefined();
    (
      p.el.querySelector('[data-action="control-panel-confirm-cancel"]') as HTMLButtonElement
    ).click();
    await Promise.resolve();
    expect(last("discard")).toBeUndefined();
    (p.el.querySelector('[data-action="content-draft-discard"]') as HTMLButtonElement).click();
    (p.el.querySelector('[data-action="control-panel-confirm-ok"]') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(last("discard")?.args).toEqual([
      { dataset: "balance", part: "hulls", key: "Boat" },
      "r".repeat(16),
    ]);
    const before = count("overview");
    p.receive({ t: "contentResult", seq: last("discard")?.seq ?? 0, ok: true, text: "Cancelled." });
    expect(count("overview")).toBe(before + 1);
    expect(p.el.querySelector(".content-status")?.textContent).toBe("Cancelled.");
  });

  test("a pack update says what changed in plain lines, and takes or keeps it", async () => {
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
    const blocks = [...p.el.querySelectorAll<HTMLElement>(".content-diff")];
    expect(blocks.map((b) => b.querySelector("figcaption")?.textContent)).toEqual([
      "What Classic changed",
      "How yours differs from Classic's new version",
    ]);
    const lines = (b: HTMLElement | undefined) =>
      [...(b?.querySelectorAll("li") ?? [])].map((li) => li.textContent);
    expect(lines(blocks[0])).toEqual(["Cost of a spin (gold): 10 → 12"]);
    expect(lines(blocks[1])).toEqual(["Cost of a spin (gold): 12 → 25"]);
    // No JSON diff any more.
    expect(p.el.querySelector(".content-diff-add")).toBeNull();
    expect(p.el.textContent).not.toContain('"cost"');
    (p.el.querySelector('[data-action="content-notice-dismiss"]') as HTMLButtonElement).click();
    expect(last("notice")?.args).toEqual([{ dataset: "casino", part: "slots", key: null }, false]);
    (p.el.querySelector('[data-action="content-notice-accept"]') as HTMLButtonElement).click();
    confirm();
    await settle();
    expect(last("notice")?.args).toEqual([{ dataset: "casino", part: "slots", key: null }, true]);
  });

  test("a pack update to a row you removed says yours is removed", () => {
    const { p, last } = page();
    p.onShow();
    p.receive({
      t: "contentOverview",
      seq: last("overview")?.seq ?? 0,
      overview: overview({
        notices: [
          {
            dataset: "items",
            part: "items",
            key: "Ale",
            packName: "Classic",
            packVersion: "1.3.0",
            was: { name: "Ale", sp: 1 },
            now: { name: "Ale", sp: 1 },
            yours: null,
            yoursOp: "remove",
          },
        ],
      }),
    });
    expect(p.el.textContent).toContain("which you had removed.");
    const blocks = [...p.el.querySelectorAll<HTMLElement>(".content-diff")];
    // The pack's two versions are the same: nothing changed there.
    expect(blocks[0]?.querySelector("li")?.textContent).toBe("nothing");
    expect(blocks[1]?.querySelector("li")?.textContent).toBe("removed");
  });

  test("another action's result goes to the status line, not the open row's error box", () => {
    const { p, last, open } = page();
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
    open(ale);
    (p.el.querySelector('[data-action="content-notice-dismiss"]') as HTMLButtonElement).click();
    p.receive({ t: "contentResult", seq: last("notice")?.seq ?? 0, ok: false, text: "Nope." });
    expect(p.el.querySelector(".content-status")?.textContent).toContain("Nope.");
    expect(p.el.querySelector(".content-editor-error")?.textContent ?? "").not.toContain("Nope.");
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

  test("Find problems lists them, in the world and in content", () => {
    const { p, $, last } = page();
    p.onShow();
    $("content-problems-check").click();
    expect(p.el.textContent).toContain("Looking…");
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

describe("a draft change opens on its own page", () => {
  const withChanges = (more: { openEditor?: (r: unknown) => boolean } = {}) => {
    const h = page(undefined, more);
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
        ],
      }),
    });
    return h;
  };
  const click = (h: ReturnType<typeof page>) =>
    (h.p.el.querySelector('[data-action="content-draft-open"]') as HTMLElement).click();

  test("clicking a change opens its editor page, and nothing opens here", () => {
    const opened: unknown[] = [];
    const h = withChanges({
      openEditor: (r) => {
        opened.push(r);
        return true;
      },
    });
    click(h);
    expect(opened).toEqual([ALE]);
    expect(h.last("row")).toBeUndefined();
    expect(tabs(h.p)[3]?.hidden).toBe(true);
    expect(shown(h.p, "Unpublished changes")).toBe(true);
  });

  test("a change whose page can't be opened shows where it is used here", () => {
    const h = withChanges({ openEditor: () => false });
    click(h);
    expect(h.last("row")?.args).toEqual([ALE]);
    expect(shown(h.p, "Where it is used")).toBe(true);
  });

  test("with no editor pages at all, a change shows where it is used here", () => {
    const h = withChanges();
    click(h);
    expect(h.last("row")?.args).toEqual([ALE]);
  });
});

describe("the Where it is used view", () => {
  test("opening a row shows its tab, title, state and buttons; Close hides the tab again", () => {
    const { p, last, $ } = page(undefined, { openEditor: () => true });
    p.openRow(ALE);
    expect(last("row")?.args).toEqual([ALE]);
    expect(p.el.querySelector(".content-editor-state")?.textContent).toBe("Loading…");
    p.receive({ t: "contentRow", seq: last("row")?.seq ?? 0, row: ale });
    const tab = tabs(p)[3] as HTMLButtonElement;
    expect(tab.hidden).toBe(false);
    expect(tab.getAttribute("aria-selected")).toBe("true");
    expect(shown(p, "Where it is used")).toBe(true);
    expect(shown(p, "Unpublished changes")).toBe(false);
    expect(p.el.querySelector(".content-editor-title")?.textContent).toBe("Item: Ale");
    expect(p.el.querySelector(".content-editor-state")?.textContent).toBe("Original");
    expect($("content-remove").textContent).toBe("Remove or retire this item…");
    expect($("content-open-page").hidden).toBe(false);
    // An original row has nothing to restore, and no unpublished change to cancel.
    expect($("content-revert").hidden).toBe(true);
    expect($("content-discard").hidden).toBe(true);
    $("content-close").click();
    expect(tab.hidden).toBe(true);
    expect(tabs(p)[0]?.getAttribute("aria-selected")).toBe("true");
    expect(shown(p, "Unpublished changes")).toBe(true);
    expect(shown(p, "Where it is used")).toBe(false);
  });

  test("the tab is offered while a row is still loading", () => {
    const { p } = page();
    p.openRow(ALE);
    expect(tabs(p)[3]?.hidden).toBe(false);
    expect(tabs(p)[3]?.getAttribute("aria-selected")).toBe("true");
  });

  test("Change it on its page opens the row's editor page", () => {
    const opened: unknown[] = [];
    const { $, open } = page(undefined, {
      openEditor: (r) => {
        opened.push(r);
        return true;
      },
    });
    open(ale);
    $("content-open-page").click();
    expect(opened).toEqual([ALE]);
  });

  test("Change it on its page is hidden with no editor pages, or for a read-only row", () => {
    const a = page();
    a.open(ale);
    expect(a.$("content-open-page").hidden).toBe(true);
    const b = page(undefined, { openEditor: () => true });
    b.open({ ...ale, dataset: "rects", part: "fx", key: null, keyField: null, readOnly: true });
    expect(b.$("content-open-page").hidden).toBe(true);
    expect(b.$("content-remove").hidden).toBe(true);
    expect(b.$("content-revert").hidden).toBe(true);
    expect(b.p.el.querySelector(".content-editor-state")?.textContent).toContain(
      "can't be changed",
    );
  });

  test("a missing row says so", () => {
    const { p, last } = page();
    p.openRow(ALE);
    p.receive({ t: "contentRow", seq: last("row")?.seq ?? 0, row: null });
    expect(p.el.querySelector(".content-editor-state")?.textContent).toBe("There is no such row.");
  });

  test("a balance row's remove, restore and cancel send back the revision it was opened at (issue #19)", async () => {
    const { $, last, open, confirm, settle } = page();
    const boat = { dataset: "balance", part: "hulls", key: "Boat" };
    open({
      ...boat,
      keyField: "vehicle",
      readOnly: false,
      status: "changed",
      pack: { vehicle: "Boat", hull: 60 },
      published: { vehicle: "Boat", hull: 65 },
      draft: { op: "set", data: { vehicle: "Boat", hull: 70 }, author: "Other" },
      revision: "r".repeat(16),
    });
    expect($("content-remove").textContent).toBe("Remove…");
    $("content-remove").click();
    confirm();
    await settle();
    expect(last("draft")?.args).toEqual([boat, "remove", null, "r".repeat(16)]);
    expect($("content-revert").hidden).toBe(false);
    $("content-revert").click();
    expect(last("draft")?.args).toEqual([boat, "revert", null, "r".repeat(16)]);
    expect($("content-discard").hidden).toBe(false);
    $("content-discard").click();
    expect(last("discard")?.args).toEqual([boat, "r".repeat(16)]);
  });

  test("a refused change to the open row shows in its error box; a done one reopens it", () => {
    const { p, $, last, count, open } = page();
    open({ ...ale, status: "changed" });
    $("content-revert").click();
    p.receive({
      t: "contentResult",
      seq: last("draft")?.seq ?? 0,
      ok: false,
      text: "the draft does not pass its checks",
      problems: [{ where: "items/items/Ale", message: "still sold in a shop" }],
    });
    expect(p.el.querySelector(".content-editor-error")?.textContent).toContain(
      "still sold in a shop",
    );
    const rows = count("row");
    $("content-revert").click();
    p.receive({ t: "contentResult", seq: last("draft")?.seq ?? 0, ok: true, text: "Restored." });
    expect(count("row")).toBe(rows + 1);
    expect(p.el.querySelector(".content-editor-error")?.textContent).toBe("");
  });
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

  /** A page with Ale open and its usage report in. */
  function withAle(usage: ContentUsageView = aleUsage) {
    const h = page();
    h.p.onShow();
    h.p.receive({ t: "contentOverview", seq: h.last("overview")?.seq ?? 0, overview: overview() });
    h.open(ale);
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

  test("Remove before the usage report has come asks to wait", () => {
    const { p, $, open } = page();
    open(ale);
    $("content-remove").click();
    expect(p.el.querySelector(".content-removal")).toBeNull();
    expect(p.el.querySelector(".content-editor-error")?.textContent).toContain("still loading");
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

  test("a removal in the draft clears the form and reopens the row", () => {
    const { p, $, last, count } = withAle();
    $("content-remove").click();
    $("content-removal-submit").click();
    const rows = count("row");
    const overviews = count("overview");
    p.receive({
      t: "contentResult",
      seq: last("remove")?.seq ?? 0,
      ok: true,
      text: "In the draft.",
    });
    expect(p.el.querySelector(".content-removal")).toBeNull();
    expect(count("row")).toBe(rows + 1);
    expect(count("overview")).toBe(overviews + 1);
    expect(p.el.querySelector(".content-status")?.textContent).toBe("In the draft.");
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
    // With no editor page to open it on, the change opens here.
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
    expect(h.$("content-remove").textContent).toBe("Remove this creature…");
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

  test("a vehicle row asks where its vehicle is used, and says Remove this vehicle", () => {
    const { $, last, open } = page();
    open({
      ...ale,
      dataset: "houses",
      part: "vehicles",
      key: "Boat",
      pack: { name: "Boat" },
      published: { name: "Boat" },
    });
    expect(last("usage")?.args).toEqual(["vehicle", "Boat"]);
    expect($("content-remove").textContent).toBe("Remove this vehicle…");
  });

  test("Close clears the usage report and removal form", () => {
    const { p, $ } = withAle();
    $("content-remove").click();
    expect(p.el.querySelector(".content-removal")).not.toBeNull();
    $("content-close").click();
    expect(p.el.querySelector(".content-usage")).toBeNull();
    expect(p.el.querySelector(".content-removal")).toBeNull();
  });

  test("opening another row clears the last row's usage report and removal form", () => {
    const { p, $ } = withAle();
    $("content-remove").click();
    p.openRow({ dataset: "casino", part: "slots", key: null });
    expect(p.el.querySelector(".content-usage")).toBeNull();
    expect(p.el.querySelector(".content-removal")).toBeNull();
  });

  test("a usage report that arrives after another row opened is not shown there", () => {
    const { p, last } = withAle();
    const stale = last("usage")?.seq ?? 0;
    p.openRow({ dataset: "casino", part: "slots", key: null });
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

  test("a row not yet published asks for no usage report and offers no Remove", () => {
    const { $, last, open } = page();
    open({ ...ale, status: null, published: null, pack: null });
    expect(last("usage")).toBeUndefined();
    expect($("content-remove").hidden).toBe(true);
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
});

/** Assets with one picture (Long Sword), so the picture panels can be shown in a test window. */
const SPRITES: Record<string, number[]> = { "long sword": [0, 0, 0, 1, 1, 0, 0] };
function noArtAssets(): Assets {
  return {
    index: { atlases: { items: { sheets: [], sprites: SPRITES } }, ui: {} },
    sheets: {},
    sprite: (_g: string, n: string) => SPRITES[n.toLowerCase()],
    ui: () => "",
    loadGroup: async () => {},
  } as unknown as Assets;
}
const noArt = noArtAssets();

/** An Image that "loads" at once, so saved frames finish loading in the test window. */
function loadingImages(w: number, h: number) {
  class LoadingImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = w;
    naturalHeight = h;
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
}

describe("the Pictures & Sounds page (artEl)", () => {
  const artSections = (p: ReturnType<typeof page>["p"]) =>
    [...p.artEl.querySelectorAll<HTMLElement>(".content-section h2")].map((h) => h.textContent);

  test("every picture and sound section is on it, not on Publish Changes", () => {
    const { p } = page(noArt);
    expect(artSections(p)).toEqual([
      "Item pictures",
      "Worn pictures",
      "Monster bodies",
      "Spell effects",
      "Tiles",
      "Sounds",
      "Upload files",
    ]);
    const mine = [...p.el.querySelectorAll<HTMLElement>(".content-section h2")].map(
      (h) => h.textContent,
    );
    for (const title of artSections(p)) {
      expect(mine).not.toContain(title);
    }
  });

  test("Show picks the one kind of pictures or sounds on screen", () => {
    const { p, $ } = page(noArt);
    const visible = () =>
      [...p.artEl.querySelectorAll<HTMLElement>(".content-section")]
        .filter((s) => !s.classList.contains("control-panel-tab-hidden"))
        .map((s) => s.querySelector("h2")?.textContent)
        .filter(Boolean);
    expect(visible()).toEqual(["Item pictures"]);
    const sel = $<HTMLSelectElement>("content-art-kind");
    expect([...sel.options].map((o) => o.value)).toEqual(artSections(p) as string[]);
    sel.value = "Tiles";
    sel.dispatchEvent(new Event("change"));
    expect(visible()).toEqual(["Tiles"]);
  });

  test("with no art to draw them, only the uploads are offered", () => {
    const { $ } = page();
    expect([...$<HTMLSelectElement>("content-art-kind").options].map((o) => o.value)).toEqual([
      "Upload files",
    ]);
  });

  const missingAle = async (more: { openEditor?: (r: unknown) => boolean } = {}) => {
    const h = page(noArt, more);
    const { p, last, settle } = h;
    p.onShow();
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
    (p.artEl.querySelector('[data-action="item-pictures-open"]') as HTMLElement).click();
    return h;
  };

  // The list is on the Pictures & Sounds page, so a row opened on Publish Changes would be out of
  // sight: the item opens on the Items page instead.
  test("an item in the Items without a picture list opens on its editor page", async () => {
    const opened: unknown[] = [];
    const { p, last } = await missingAle({
      openEditor: (r) => {
        opened.push(r);
        return true;
      },
    });
    expect(opened).toEqual([ALE]);
    expect(last("row")).toBeUndefined();
    expect(tabs(p)[3]?.hidden).toBe(true);
  });

  test("with no editor page to open, the item opens where it is used on Publish Changes", async () => {
    const { p, last } = await missingAle({ openEditor: () => false });
    expect(last("row")?.args).toEqual([ALE]);
    expect(tabs(p)[3]?.hidden).toBe(false);
  });
});

describe("monster bodies on the Pictures & Sounds page (issue #29, stage 4)", () => {
  const frames = Object.fromEntries(
    ["f1", "f2", "f3", "f4"]
      .flatMap((f) => ["n", "e", "s", "w"].map((d) => `${f}-${d}`))
      .map((f) => [f, { file: "a".repeat(64), regX: 25, regY: 6 }]),
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
  loadingImages(46, 45);

  function showBodies(t: ReturnType<typeof page>) {
    t.p.onShow();
    t.p.receive({ t: "contentOverview", seq: t.last("overview")?.seq ?? 0, overview: overview() });
    t.p.receive({ t: "contentBodyArt", seq: t.last("bodyArt")?.seq ?? 0, view: bodyView });
  }

  test("Discard drops frames set up in the Bodies section's panel", async () => {
    const t = page(noArt);
    const { p, $, settle } = t;
    showBodies(t);
    await settle();
    (p.artEl.querySelector('[data-action="bodies-open"][data-key="1000"]') as HTMLElement).click();
    await settle();
    await settle();
    const right = $<HTMLInputElement>("body-right");
    right.value = "2";
    right.dispatchEvent(new Event("change"));
    expect(p.changes()).toBe(1);
    p.discard();
    expect(p.changes()).toBe(0);
  });

  test("a body change goes into the draft, and the page refreshes the draft and the section", async () => {
    const t = page(noArt);
    const { p, $, last, count, settle } = t;
    showBodies(t);
    await settle();
    (p.artEl.querySelector('[data-action="bodies-open"][data-key="1000"]') as HTMLElement).click();
    await settle();
    $("body-remove").click();
    await settle();
    expect(last("body")?.args[0]).toEqual({ op: "remove", body: 1000 });
    const overviews = count("overview");
    const bodyArts = count("bodyArt");
    p.receive({
      t: "contentResult",
      seq: last("body")?.seq ?? 0,
      ok: true,
      text: "ok",
      body: 1000,
    });
    await settle();
    expect(count("overview")).toBeGreaterThan(overviews);
    expect(count("bodyArt")).toBeGreaterThan(bodyArts);
    // No row was open, so none is asked for.
    expect(last("row")).toBeUndefined();
  });
});

describe("spell effects on the Pictures & Sounds page (issue #29, stage 5)", () => {
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
  loadingImages(16, 16);

  function showEffects(t: ReturnType<typeof page>) {
    t.p.onShow();
    t.p.receive({ t: "contentOverview", seq: t.last("overview")?.seq ?? 0, overview: overview() });
    t.p.receive({ t: "contentFxArt", seq: t.last("fxArt")?.seq ?? 0, view: fxView });
  }

  test("Discard drops frames set up in the Spell effects section's panel", async () => {
    const t = page(noArt);
    const { p, $, settle } = t;
    showEffects(t);
    await settle();
    (p.artEl.querySelector('[data-action="fx-open"][data-key="crush"]') as HTMLElement).click();
    await settle();
    await settle();
    const right = $<HTMLInputElement>("fx-right");
    right.value = "2";
    right.dispatchEvent(new Event("change"));
    expect(p.changes()).toBe(1);
    p.discard();
    expect(p.changes()).toBe(0);
  });

  test("an effect change in the section goes into the draft, and the section refreshes", async () => {
    const t = page(noArt);
    const { p, $, last, count, settle } = t;
    showEffects(t);
    await settle();
    (p.artEl.querySelector('[data-action="fx-open"][data-key="crush"]') as HTMLElement).click();
    await settle();
    await settle();
    $("fx-remove").click();
    await settle();
    expect(last("fx")?.args[0]).toMatchObject({ op: "remove", run: "Crush" });
    const fxArts = count("fxArt");
    p.receive({
      t: "contentResult",
      seq: last("fx")?.seq ?? 0,
      ok: true,
      text: "ok",
      run: "Crush",
    });
    await settle();
    expect(count("fxArt")).toBeGreaterThan(fxArts);
  });

  test("the Spells page's effect panel shows a spell's run, and a change there reports back", async () => {
    const t = page(noArt);
    const { p, last, count, settle } = t;
    let saves = 0;
    const panel = p.spellEffect(() => {
      saves += 1;
    });
    if (!panel) {
      throw new Error("no effect panel");
    }
    // Made once.
    expect(p.spellEffect(() => {})).toBe(panel);
    document.body.append(panel.el);
    panel.show("Crush");
    p.receive({ t: "contentFxArt", seq: last("fxArt")?.seq ?? 0, view: fxView });
    await settle();
    await settle();
    expect(panel.el.hidden).toBe(false);
    expect(panel.el.textContent).toContain("Crush shows 2 frames. Drawn by spell Crush.");
    // Work set up in it is unsaved work of the page's.
    const right = panel.el.querySelector('[data-action="spells-effect-right"]') as HTMLInputElement;
    right.value = "3";
    right.dispatchEvent(new Event("change"));
    expect(panel.pending()).toBe(true);
    expect(p.changes()).toBe(1);
    // Shown again for the same spell, the unsaved work is kept; `force` drops it.
    const asks = count("fxArt");
    panel.show("Crush");
    expect(count("fxArt")).toBe(asks);
    panel.show("Crush", true);
    expect(count("fxArt")).toBe(asks + 1);
    p.receive({ t: "contentFxArt", seq: last("fxArt")?.seq ?? 0, view: fxView });
    await settle();
    await settle();
    expect(panel.pending()).toBe(false);
    (panel.el.querySelector('[data-action="spells-effect-remove"]') as HTMLButtonElement).click();
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
    expect(saves).toBe(1);
  });

  test("with no art there is no effect panel", () => {
    expect(page().p.spellEffect(() => {})).toBeNull();
  });
});

describe("tiles on the Pictures & Sounds page (issue #29, stage 6)", () => {
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
    expect(p.artEl.querySelectorAll('[data-action="tiles-open"]').length).toBe(2);
    (p.artEl.querySelector('[data-action="tiles-open"][data-code="S3"]') as HTMLElement).click();
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
    const { p, $, last, settle, count } = t;
    showTiles(t);
    await settle();
    (p.artEl.querySelector('[data-action="tiles-open"][data-code="S3"]') as HTMLElement).click();
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
    const before = count("tileArt");
    p.receive({ t: "contentResult", seq: change?.seq ?? 0, ok: true, text: "In the draft." });
    await settle();
    expect(count("tileArt")).toBeGreaterThan(before);
  });
});

describe("sounds on the Pictures & Sounds page (issue #29, stage 7)", () => {
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
    expect(
      p.artEl.querySelector('[data-action="sounds-open"][data-sound="crush"]')?.textContent,
    ).toBe("crush");
    // Upload tickets never answer here, so a chosen file stays waiting: unsaved work.
    const files = p.artEl.querySelector('[data-action="sounds-files"]') as HTMLInputElement;
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
    const { p, last, settle, count } = t;
    showSounds(t, { ...soundView, art: [{ name: "crush", file: "a".repeat(64), format: "wav" }] });
    await settle();
    (
      p.artEl.querySelector('[data-action="sounds-open"][data-sound="crush"]') as HTMLElement
    ).click();
    expect(p.artEl.textContent).toContain("Replaces crush for spell Crush.");
    const before = count("soundArt");
    const remove = p.artEl.querySelector('[data-action="sound-art-remove"]') as HTMLButtonElement;
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
    expect(count("soundArt")).toBeGreaterThan(before);
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

describe("references in plain words", () => {
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
