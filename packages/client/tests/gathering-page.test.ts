/**
 * The Control Panel's Gathering page (issue #38): the nodes by tile, a node's form (tile, tools,
 * skill, yield table, sounds) saved with the fingerprint it was filled from, a new node, the
 * preview of success and yield by skill and tool tier, and fishing's tables with their preview.
 */
import { afterEach, describe, expect, test } from "bun:test";

import { harvestNodeSchema, yieldTableSchema } from "@secondstaronline/data/schema";
import type { ContentGatheringView } from "@secondstaronline/shared";

import {
  createGatheringPage,
  type GatheringChange,
  nodePayload,
} from "../src/ui/gathering-page.ts";

afterEach(() => document.body.replaceChildren());

const VIEW = (fp = "aaaaaaaaaaaaaaaa"): ContentGatheringView => ({
  nodes: [
    {
      index: 0,
      node: {
        tile: "T1",
        can: "Chop",
        becomes: "S1",
        skill: "Lumberjacking",
        gains: true,
        yield: "Logs",
        hitSound: { name: "treechop", ch: 3 },
        successSound: null,
      },
      yield: { kind: "chance", item: "Logs", chance: 3 },
      yieldSharedWith: [],
      regrows: "trees",
      fingerprint: fp,
    },
  ],
  counter: {
    rows: [
      { gt: -1, value: 18 },
      { gt: 10, value: 9 },
    ],
    fingerprint: "cccccccccccccccc",
  },
  fishing: {
    data: {
      layers: [1],
      waterTiles: ["W1"],
      fxOffsets: { E: [0, 0], W: [0, 0], N: [0, 0], S: [0, 0] },
      bands: [{ lt: 101, fish: "Fish" }],
      fishCheck: [{ gt: -1, value: 4 }],
      antiMacroStart: 5,
      stoppedText: "The fish have gone.",
    },
    fingerprint: "dddddddddddddddd",
    skill: "Fishing",
  },
  farming: { data: null, fingerprint: "eeeeeeeeeeeeeeee" },
  regrowth: {
    roll: 600,
    tiles: 204,
    checks: [
      { handler: "trees", below: 10, produce: false },
      { handler: "DoVeg", below: 30, produce: true },
    ],
  },
  findChance: 5,
  tools: [
    { pattern: "Axe", match: "contains", can: "Chop", tier: 1 },
    { pattern: "Gold Axe", match: "exact", can: "Chop", tier: 2 },
  ],
  skills: [
    {
      skill: "Lumberjacking",
      display: "Lumberjacking",
      model: "chance",
      gather: { roll: 10 },
      curve: null,
      cap: null,
    },
  ],
  tables: {},
  caps: { faction: 50, mage: 30 },
  choices: {
    cans: ["Chop", "Mine", "Dig"],
    sounds: ["treechop"],
    tiles: [{ code: "T1", name: "Tree" }],
    items: ["Logs", "Fish"],
    yields: ["Logs", "Stones"],
  },
  yields: {
    Logs: { kind: "chance", item: "Logs", chance: 3 },
    Stones: { kind: "chance", item: "Fish", chance: 9, bySkill: [{ gt: 50, value: 2 }] },
  },
  yieldFingerprints: { Logs: "2222222222222222", Stones: "3333333333333333" },
  pending: false,
  otherDraft: 0,
  fingerprint: "ffffffffffffffff",
});

function page() {
  const sent: GatheringChange[] = [];
  let seq = 0;
  const p = createGatheringPage({
    view: (s) => {
      seq = s;
    },
    set: (s, c) => {
      seq = s;
      sent.push(c);
    },
    openContent: () => {},
    openSkill: () => {},
  });
  document.body.append(p.el);
  p.onShow();
  p.receive({ t: "contentGathering", seq, view: VIEW() });
  return { p, sent, seq: () => seq };
}
const q = <T extends Element>(root: ParentNode, sel: string) => root.querySelector(sel) as T;
const typeIn = (el: HTMLInputElement, v: string) => {
  el.value = v;
  el.dispatchEvent(new Event("input"));
};

describe("the Gathering page", () => {
  test("lists the nodes by tile; a node's form saves with its fingerprint", () => {
    const { p, sent } = page();
    const node = q<HTMLButtonElement>(p.el, "[data-action='gathering-open-node']");
    expect(node.textContent).toContain("Chop T1 (Tree)");
    expect(node.querySelector("canvas")).not.toBeNull();
    node.click();
    expect(q<HTMLInputElement>(p.el, "[data-action='gathering-tile']").value).toBe("T1");
    expect(q<HTMLSelectElement>(p.el, "[data-action='gathering-regrows']").value).toBe("trees");
    typeIn(q<HTMLInputElement>(p.el, "[data-action='gathering-yield-chance']"), "2");
    typeIn(q<HTMLInputElement>(p.el, "[data-action='gathering-tier']"), "2");
    expect(p.changes()).toBe(1);
    q<HTMLButtonElement>(p.el, "[data-action='gathering-save']").click();
    expect(sent.at(-1)).toMatchObject({
      op: "node",
      index: 0,
      expect: "aaaaaaaaaaaaaaaa",
      data: {
        node: { tile: "T1", tier: 2, yield: "Logs" },
        yieldTable: { kind: "chance", item: "Logs", chance: 2 },
        regrows: "trees",
      },
    });
  });

  test("the preview gives each skill value and tool tier's swings, success and yield", () => {
    const { p } = page();
    q<HTMLButtonElement>(p.el, "[data-action='gathering-open-node']").click();
    typeIn(q<HTMLInputElement>(p.el, "[data-action='gathering-tier']"), "2");
    const rows = [...p.el.querySelectorAll(".gathering-preview tbody tr")].map((r) =>
      [...r.querySelectorAll("td")].map((c) => c.textContent),
    );
    // Tier 1 cannot work a tier-2 node; tier 2 from skill 11 takes 9 swings, drops 1 in 3. Every
    // value from 0 to 100 is covered, runs that read the same folded into one row.
    const at = (tier: string, v: number) =>
      rows.find((r) => {
        const [lo, hi = lo] = (r[1] ?? "").split("-").map(Number);
        return r[0]?.startsWith(tier) && v >= (lo ?? 0) && v <= (hi ?? 0);
      });
    expect(at("Tier 1", 20)?.[2]).toBe("needs tier 2");
    expect(at("Tier 2", 20)?.slice(1, 5)).toEqual([
      "11-100",
      "9",
      "1 in 9 (11.1%)",
      "1 in 3 (33.3%)",
    ]);
    expect(at("Tier 2", 5)?.slice(1, 3)).toEqual(["0-10", "18"]);
  });

  test("a new node is sent without a fingerprint", () => {
    const { p, sent } = page();
    q<HTMLButtonElement>(p.el, "[data-action='gathering-new-node']").click();
    typeIn(q<HTMLInputElement>(p.el, "[data-action='gathering-tile']"), "Q9");
    typeIn(q<HTMLInputElement>(p.el, "[data-action='gathering-becomes']"), "R9");
    q<HTMLButtonElement>(p.el, "[data-action='gathering-save']").click();
    expect(sent.at(-1)).toMatchObject({
      op: "newNode",
      data: { node: { tile: "Q9", becomes: "R9", can: "Chop" } },
    });
    expect(sent.at(-1)?.expect).toBeUndefined();
  });

  test("fishing edits its tables and previews bites and catches", () => {
    const { p, sent } = page();
    q<HTMLButtonElement>(p.el, "[data-action='gathering-open-fishing']").click();
    const rows = [...p.el.querySelectorAll(".gathering-preview tbody tr")];
    expect(rows[0]?.textContent).toContain("1 in 4");
    expect(rows[0]?.textContent).toContain("Fish");
    typeIn(q<HTMLInputElement>(p.el, "[data-action='gathering-anti-macro']"), "7");
    q<HTMLButtonElement>(p.el, "[data-action='gathering-save']").click();
    expect(sent.at(-1)).toMatchObject({
      op: "fishing",
      expect: "dddddddddddddddd",
      data: { antiMacroStart: 7 },
    });
  });
});

describe("review fixes (issue #38)", () => {
  test("opening a chance yield node leaves the form clean; its save parses as the server's schemas", () => {
    const { p, sent } = page();
    q<HTMLButtonElement>(p.el, "[data-action='gathering-open-node']").click();
    expect(p.changes()).toBe(0);
    // A by-skill row added and taken away again: the table has none, and the save says so.
    q<HTMLButtonElement>(p.el, "[data-action='gathering-yield-by-add']").click();
    q<HTMLButtonElement>(p.el, "[data-action='gathering-yield-by-remove']").click();
    typeIn(q<HTMLInputElement>(p.el, "[data-action='gathering-yield-chance']"), "4");
    q<HTMLButtonElement>(p.el, "[data-action='gathering-save']").click();
    const data = sent.at(-1)?.data as { node: unknown; yieldTable: unknown; yieldExpect: unknown };
    expect(harvestNodeSchema.safeParse(data.node).success).toBe(true);
    expect(yieldTableSchema.safeParse(data.yieldTable).success).toBe(true);
    expect(data.yieldTable).toEqual({ kind: "chance", item: "Logs", chance: 4 });
    expect(data.yieldExpect).toBe("2222222222222222");
  });

  test("naming another table, an unused one too, sends only its name", () => {
    const { p, sent } = page();
    q<HTMLButtonElement>(p.el, "[data-action='gathering-open-node']").click();
    typeIn(q<HTMLInputElement>(p.el, "[data-action='gathering-yield']"), "Stones");
    expect(q<HTMLInputElement>(p.el, "[data-action='gathering-yield-item']").value).toBe("Fish");
    q<HTMLButtonElement>(p.el, "[data-action='gathering-save']").click();
    const data = sent.at(-1)?.data as Record<string, unknown>;
    expect((data.node as { yield: string }).yield).toBe("Stones");
    expect("yieldTable" in data).toBe(false);
    expect(
      nodePayload(
        {
          node: { tile: "T1" } as never,
          yieldTable: { kind: "chance", item: "Fish", chance: 9, bySkill: [] },
          regrows: null,
        },
        { edited: true, expect: null },
      ).yieldTable,
    ).toEqual({ kind: "chance", item: "Fish", chance: 9 });
  });

  test("regrowth offers no produce check, and reads how often a check runs as the game rolls it", () => {
    const { p } = page();
    q<HTMLButtonElement>(p.el, "[data-action='gathering-open-node']").click();
    const opts = [
      ...p.el.querySelectorAll<HTMLOptionElement>("[data-action='gathering-regrows'] option"),
    ];
    expect(opts.map((o) => o.value)).toEqual(["", "trees"]);
    // random(600) < 10 fires on 9 of 600 values, then one tile of 204.
    expect(opts[1]?.textContent).toContain("1 in 13,600 frames");
  });

  test("Drop my edit on a new node closes its form", () => {
    const { p } = page();
    q<HTMLButtonElement>(p.el, "[data-action='gathering-new-node']").click();
    expect(q<HTMLElement>(p.el, ".items-form").hidden).toBe(false);
    q<HTMLButtonElement>(p.el, "[data-action='gathering-undo-edit']").click();
    expect(q<HTMLElement>(p.el, ".items-form").hidden).toBe(true);
    expect(p.changes()).toBe(0);
  });

  test("a node naming its tools previews only those tools' tiers", () => {
    const { p } = page();
    q<HTMLButtonElement>(p.el, "[data-action='gathering-open-node']").click();
    typeIn(q<HTMLInputElement>(p.el, "[data-action='gathering-tools']"), "Gold Axe");
    const tools = new Set(
      [...p.el.querySelectorAll(".gathering-preview tbody tr")].map(
        (r) => r.querySelector("td")?.textContent,
      ),
    );
    expect([...tools]).toEqual(["Tier 2: Gold Axe"]);
  });
});
