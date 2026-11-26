/**
 * The Control Panel's Activity Log page (ui/activity-log.ts, issue #25): a character's timeline and
 * an item's flow, filtered by type and UTC day, with linked names, totals and older pages.
 */
import { describe, expect, test } from "bun:test";

import {
  ACTIVITY_GROUPS,
  ACTIVITY_PAGE,
  type ActivityRow,
  type ReconcileItem,
  type ReconcileRunView,
} from "@secondstaronline/shared";

import {
  type ActivityRequest,
  activityTime,
  createActivityLogPage,
  dayAfter,
  dayStart,
  type ReconcileRequest,
  typesFor,
} from "../src/ui/activity-log.ts";

const row = (over: Partial<ActivityRow> = {}): ActivityRow => ({
  id: "r1",
  at: "2026-11-22T09:15:03.120Z",
  type: "trade",
  character: "Al",
  other: "Bo",
  otherIsPlayer: true,
  item: "Apple",
  qty: -2,
  gold: 0,
  map: "x1y1",
  x: 3,
  y: 4,
  details: null,
  ...over,
});

function page() {
  const sent: ActivityRequest[] = [];
  const p = createActivityLogPage({ query: (q) => sent.push(q) });
  document.body.replaceChildren(p.el);
  const $ = <T extends HTMLElement>(action: string) =>
    p.el.querySelector<T>(`[data-action="${action}"]`) as T;
  const status = () => p.el.querySelector(".activity-status")?.textContent;
  const cells = () =>
    [...p.el.querySelectorAll("table[aria-label='Activity'] tbody tr")].map((tr) =>
      [...tr.querySelectorAll("td")].map((td) => td.textContent),
    );
  return { p, sent, $, status, cells };
}

describe("the helpers", () => {
  test("a row's time reads as a UTC date and time", () => {
    expect(activityTime("2026-11-22T09:15:03.120Z")).toBe("2026-11-22 09:15:03");
  });

  test("a date filter covers whole UTC days, the To day included", () => {
    expect(dayStart("2026-11-22")).toBe("2026-11-22T00:00:00.000Z");
    expect(dayAfter("2026-11-22")).toBe("2026-11-23T00:00:00.000Z");
    expect(dayAfter("2026-12-31")).toBe("2027-01-01T00:00:00.000Z");
    expect(dayStart("")).toBeNull();
    expect(dayAfter("")).toBeNull();
  });

  test("the type filter asks for every type, a whole group or one type", () => {
    expect(typesFor("")).toEqual([]);
    expect(typesFor("group:combat")).toEqual([...ACTIVITY_GROUPS.combat]);
    expect(typesFor("trade")).toEqual(["trade"]);
    expect(typesFor("nonsense")).toEqual([]);
  });
});

describe("asking for rows", () => {
  test("Show asks for the typed character's timeline with the filters; a blank name asks nothing", () => {
    const { sent, $, status } = page();
    $("activity-show").click();
    expect(sent).toEqual([]);
    expect(status()).toBe("Type a character's name.");
    $<HTMLInputElement>("activity-name").value = "  Al ";
    $<HTMLSelectElement>("activity-type").value = "group:session";
    $<HTMLInputElement>("activity-since").value = "2026-11-01";
    $<HTMLInputElement>("activity-until").value = "2026-11-22";
    $("activity-show").click();
    expect(sent).toEqual([
      {
        seq: 1,
        scope: "character",
        name: "Al",
        types: [...ACTIVITY_GROUPS.session],
        since: "2026-11-01T00:00:00.000Z",
        until: "2026-11-23T00:00:00.000Z",
        before: null,
        limit: ACTIVITY_PAGE,
      },
    ]);
    expect(status()).toBe("Loading…");
  });

  test("Enter in the name asks too", () => {
    const { sent, $ } = page();
    const name = $<HTMLInputElement>("activity-name");
    name.value = "Al";
    name.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(sent.map((q) => q.name)).toEqual(["Al"]);
  });

  test("the arrow keys move between the views, as tabs do", () => {
    const { $ } = page();
    $("activity-mode-timeline").focus();
    $("activity-mode-timeline").dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
    expect($("activity-mode-item").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe($("activity-mode-item"));
    expect($<HTMLInputElement>("activity-name").placeholder).toContain("Gold");
  });

  test("Item flow asks for an item, and the tabs say which is on", () => {
    const { sent, $ } = page();
    expect($("activity-mode-timeline").getAttribute("aria-selected")).toBe("true");
    $("activity-mode-item").click();
    expect($("activity-mode-item").getAttribute("aria-selected")).toBe("true");
    expect($("activity-mode-timeline").getAttribute("aria-selected")).toBe("false");
    $<HTMLInputElement>("activity-name").value = "Apple";
    $("activity-show").click();
    expect(sent.at(-1)).toMatchObject({ scope: "item", name: "Apple" });
  });
});

describe("showing rows", () => {
  test("a timeline lists each row, links the other player and the item, and says how many", () => {
    const { p, sent, cells, status } = page();
    p.show("character", "Al");
    p.receive({ seq: sent[0]?.seq ?? 0, rows: [row()], more: false });
    expect(cells()).toEqual([
      ["2026-11-22 09:15:03", "Trade", "Al", "-2 Apple", "Bo", "x1y1 (3, 4)"],
    ]);
    expect(status()).toBe("1 event, newest first.");
    const links = [...p.el.querySelectorAll<HTMLElement>(".activity-link")];
    expect(links.map((l) => [l.dataset.action, l.textContent])).toEqual([
      ["activity-item", "Apple"],
      ["activity-player", "Bo"],
    ]);
  });

  test("a player named in a row opens their timeline; an item opens its flow", () => {
    const { p, sent } = page();
    p.show("character", "Al");
    p.receive({ seq: 1, rows: [row()], more: false });
    p.el.querySelector<HTMLElement>("[data-action='activity-player']")?.click();
    expect(sent.at(-1)).toMatchObject({ seq: 2, scope: "character", name: "Bo", types: [] });
    p.receive({ seq: 2, rows: [row({ character: "Bo", other: "Al" })], more: false });
    p.el.querySelector<HTMLElement>("[data-action='activity-item']")?.click();
    expect(sent.at(-1)).toMatchObject({ seq: 3, scope: "item", name: "Apple" });
  });

  test("an item's flow shows its totals and links each character", () => {
    const { p, sent } = page();
    p.show("item", "Apple");
    p.receive({
      seq: sent[0]?.seq ?? 0,
      rows: [row(), row({ id: "r2", character: "Bo", other: "Al", qty: 2 })],
      more: false,
      totals: [{ type: "trade", gained: 2, lost: 2, rows: 2 }],
    });
    const totals = [...p.el.querySelectorAll("table[aria-label='Totals by type'] tbody tr")].map(
      (tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent),
    );
    expect(totals).toEqual([["Trade", "2", "2", "2"]]);
    const players = [...p.el.querySelectorAll("[data-action='activity-player']")];
    expect(players.map((l) => l.textContent)).toEqual(["Al", "Bo", "Bo", "Al"]);
  });

  test("Show older asks for the rows after the last one shown and adds them", () => {
    const { p, sent, $, cells, status } = page();
    p.show("character", "Al");
    expect($("activity-more").hidden).toBe(true);
    p.receive({ seq: 1, rows: [row()], more: true });
    expect($("activity-more").hidden).toBe(false);
    expect(status()).toBe("1+ event, newest first.");
    $("activity-more").click();
    expect(sent.at(-1)).toMatchObject({
      seq: 2,
      name: "Al",
      before: { at: "2026-11-22T09:15:03.120Z", id: "r1" },
    });
    p.receive({ seq: 2, rows: [row({ id: "r0", at: "2026-11-21T08:00:00.000Z" })], more: false });
    expect(cells().map((c) => c[0])).toEqual(["2026-11-22 09:15:03", "2026-11-21 08:00:00"]);
    expect($("activity-more").hidden).toBe(true);
  });

  test("a new search clears the last one's rows and totals; capped totals say so", () => {
    const { p, cells } = page();
    p.show("item", "Apple");
    p.receive({
      seq: 1,
      rows: [row()],
      more: false,
      totals: [{ type: "trade", gained: 0, lost: 2, rows: 1 }],
      totalsCapped: 20000,
    });
    const totals = p.el.querySelector<HTMLElement>(".activity-totals");
    expect(totals?.hidden).toBe(false);
    expect(totals?.querySelector("h2")?.textContent).toBe("Totals over the newest 20,000 events");
    p.el.querySelector<HTMLElement>("[data-action='activity-player']")?.click();
    expect(totals?.hidden).toBe(true);
    expect(cells()).toEqual([]);
    p.receive({ seq: 2, rows: [row({ id: "r2" })], more: false });
    expect(totals?.hidden).toBe(true);
    expect(cells()).toHaveLength(1);
  });

  test("a reset forgets the search and its results, and a late answer is ignored", () => {
    const { p, $, cells, status } = page();
    p.show("item", "Apple");
    p.reset();
    p.receive({ seq: 1, rows: [row()], more: false });
    expect(cells()).toEqual([]);
    expect($<HTMLInputElement>("activity-name").value).toBe("");
    expect($("activity-mode-timeline").getAttribute("aria-selected")).toBe("true");
    expect(status()).toBe("Type a character's name and choose Show.");
  });

  test("an answer to an older request is ignored", () => {
    const { p, cells } = page();
    p.show("character", "Al");
    p.show("character", "Bo");
    p.receive({ seq: 1, rows: [row()], more: false });
    expect(cells()).toEqual([]);
  });

  test("the server's error is shown in place of rows; no rows says so", () => {
    const { p, status } = page();
    p.show("character", "Nobody");
    p.receive({ seq: 1, rows: [], more: false, error: "There is no character called Nobody." });
    expect(status()).toBe("There is no character called Nobody.");
    p.show("item", "Apple");
    p.receive({ seq: 2, rows: [], more: false, totals: [] });
    expect(status()).toBe("Nothing is logged for this item with these filters.");
  });

  test("an unlogged change is marked", () => {
    const { p } = page();
    p.show("character", "Al");
    p.receive({ seq: 1, rows: [row({ type: "unlogged", other: null })], more: false });
    expect(p.el.querySelector(".activity-unlogged")?.textContent).toBe("-2 Apple");
  });
});

describe("the Reconciliation section (issue #35)", () => {
  const item = (over: Partial<ReconcileItem> = {}): ReconcileItem => ({
    item: "Steel Sword",
    currency: false,
    baseline: 4,
    made: 1,
    ended: 0,
    unlogged: 1,
    expected: 5,
    actual: 7,
    difference: 2,
    ...over,
  });
  const run = (over: Partial<ReconcileRunView> = {}): ReconcileRunView => ({
    id: "run1",
    at: "2026-11-25T04:00:01.000Z",
    by: null,
    baseline: false,
    items: 40,
    mismatches: 1,
    rows: [item()],
    more: 0,
    ...over,
  });

  function reconPage() {
    const sent: ReconcileRequest[] = [];
    const queries: ActivityRequest[] = [];
    const p = createActivityLogPage({
      query: (q) => queries.push(q),
      reconcile: (r) => sent.push(r),
    });
    document.body.replaceChildren(p.el);
    const $ = <T extends HTMLElement>(action: string) =>
      p.el.querySelector<T>(`[data-action="${action}"]`) as T;
    const recon = () => p.el.querySelector<HTMLElement>(".activity-reconcile");
    const cells = () =>
      [...p.el.querySelectorAll(".activity-run tbody tr")].map((tr) =>
        [...tr.querySelectorAll("td")].map((td) => td.textContent),
      );
    return { p, sent, queries, $, recon, cells };
  }

  test("the Reconciliation mode asks for the latest runs and hides the search", () => {
    const { sent, $, recon, p } = reconPage();
    expect(recon()?.hidden).toBe(true);
    $("activity-mode-reconcile").click();
    expect(sent).toEqual([{ seq: 1, run: false }]);
    expect(recon()?.hidden).toBe(false);
    expect(p.el.querySelector<HTMLElement>(".activity-search")?.hidden).toBe(true);
    expect($("activity-mode-reconcile").getAttribute("aria-selected")).toBe("true");
    // Shown again: asked again.
    p.onShow();
    expect(sent).toEqual([
      { seq: 1, run: false },
      { seq: 2, run: false },
    ]);
  });

  test("runs are shown newest first with their differing items; an item opens its flow", () => {
    const { p, $, cells, queries } = reconPage();
    $("activity-mode-reconcile").click();
    p.receiveReconcile({
      seq: 1,
      runs: [
        run({
          rows: [item(), item({ item: "Gold", currency: true, difference: -5, unlogged: 0 })],
          mismatches: 2,
        }),
        run({ id: "run0", at: "2026-11-24T04:00:00.000Z", baseline: true, rows: [], by: "God" }),
      ],
    });
    const headings = [...p.el.querySelectorAll(".activity-run h2")].map((h) => h.textContent);
    expect(headings).toEqual([
      "2026-11-25 04:00:01, nightly run: 2 of 40 items differ",
      "2026-11-24 04:00:00, run by God: baseline taken of 40 items",
    ]);
    expect(cells()).toEqual([
      ["Steel Sword", "4", "1", "0", "5", "7", "+2", "+1"],
      ["Gold", "4", "1", "0", "5", "7", "-5", "0"],
    ]);
    // Each item's name opens its flow; the currency's opens the gold's.
    const links = p.el.querySelectorAll<HTMLElement>("[data-action='activity-reconcile-item']");
    expect([...links].map((l) => l.textContent)).toEqual(["Steel Sword", "Gold"]);
    links[1]?.click();
    expect(queries.at(-1)).toMatchObject({ scope: "item", name: "Gold", before: null });
    links[0]?.click();
    expect(queries.at(-1)).toMatchObject({ scope: "item", name: "Steel Sword", before: null });
    expect(p.el.querySelector<HTMLElement>(".activity-search")?.hidden).toBe(false);
    expect($("activity-mode-item").getAttribute("aria-selected")).toBe("true");
  });

  test("each run folds under its heading: the newest open, a run with differences marked", () => {
    const { p, $ } = reconPage();
    $("activity-mode-reconcile").click();
    p.receiveReconcile({
      seq: 1,
      runs: [
        run({ mismatches: 0, rows: [] }),
        run({ id: "run1", at: "2026-11-24T04:00:01.000Z", rows: [item()], mismatches: 1 }),
      ],
    });
    const runs = [...p.el.querySelectorAll<HTMLDetailsElement>("details.activity-run")];
    expect(runs.map((r) => r.open)).toEqual([true, false]);
    expect(runs.map((r) => r.classList.contains("activity-run-differs"))).toEqual([false, true]);
    // The heading is what opens and folds a run.
    expect(runs[1]?.querySelector("summary h2")?.textContent).toContain("1 of 40 items differ");
  });

  test("Run now asks for a run and shows what it found; an older answer is ignored", () => {
    const { p, $, sent } = reconPage();
    $("activity-mode-reconcile").click();
    // Waiting for an answer, Run now is off.
    expect($<HTMLButtonElement>("activity-reconcile-run").disabled).toBe(true);
    p.receiveReconcile({ seq: 1, runs: [] });
    $("activity-reconcile-run").click();
    expect(sent.at(-1)).toEqual({ seq: 2, run: true });
    expect($<HTMLButtonElement>("activity-reconcile-run").disabled).toBe(true);
    p.receiveReconcile({ seq: 1, runs: [run()] });
    expect(p.el.querySelectorAll(".activity-run")).toHaveLength(0);
    p.receiveReconcile({
      seq: 2,
      runs: [run({ mismatches: 0, rows: [] })],
      text: "Every item's count matches what the log expects.",
    });
    expect($<HTMLButtonElement>("activity-reconcile-run").disabled).toBe(false);
    expect(p.el.querySelector(".activity-reconcile-status")?.textContent).toBe(
      "Every item's count matches what the log expects.",
    );
    expect(p.el.querySelector(".activity-run h2")?.textContent).toBe(
      "2026-11-25 04:00:01, nightly run: all 40 items match",
    );
  });

  test("no run yet says how to start; a reset forgets the runs", () => {
    const { p, $ } = reconPage();
    $("activity-mode-reconcile").click();
    p.receiveReconcile({ seq: 1, runs: [] });
    expect(p.el.querySelector(".activity-reconcile-status")?.textContent).toBe(
      "No run yet: Run now takes the baseline.",
    );
    p.reset();
    expect(p.el.querySelector<HTMLElement>(".activity-reconcile")?.hidden).toBe(true);
    expect(p.el.querySelectorAll(".activity-run")).toHaveLength(0);
  });

  test("a world event's row names no character", () => {
    const { p } = page();
    p.show("item", "Apple");
    p.receive({
      seq: 1,
      rows: [row({ type: "decay", character: null, other: null, qty: -2 })],
      more: false,
    });
    const cells = [...p.el.querySelectorAll("table[aria-label='Activity'] tbody td")].map(
      (td) => td.textContent,
    );
    expect(cells.slice(1, 3)).toEqual(["Decay", "World"]);
  });
});
