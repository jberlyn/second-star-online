/**
 * The Control Panel's Activity Log page (ui/activity-log.ts, issue #25): a character's timeline and
 * an item's flow, filtered by type and UTC day, with linked names, totals and older pages.
 */
import { describe, expect, test } from "bun:test";

import { ACTIVITY_GROUPS, ACTIVITY_PAGE, type ActivityRow } from "@secondstaronline/shared";

import {
  type ActivityRequest,
  activityTime,
  createActivityLogPage,
  dayAfter,
  dayStart,
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

  test("Item flow asks for an item, and the mode buttons say which is on", () => {
    const { sent, $ } = page();
    expect($("activity-mode-timeline").getAttribute("aria-pressed")).toBe("true");
    $("activity-mode-item").click();
    expect($("activity-mode-item").getAttribute("aria-pressed")).toBe("true");
    expect($("activity-mode-timeline").getAttribute("aria-pressed")).toBe("false");
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
    expect($("activity-mode-timeline").getAttribute("aria-pressed")).toBe("true");
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
