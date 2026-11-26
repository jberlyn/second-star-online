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
  regrowthName,
  waitText,
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
      castFx: { fx: "Fishing", frames: 13 },
      castSound: { name: "splash", ch: 4 },
      fxOffsets: { E: [0, 0], W: [0, 0], N: [0, 0], S: [0, 0] },
      trains: { cast: true, catch: false },
      catches: [{ fish: "Fish", from: 0, weight: 1 }],
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
    effects: ["Wood Chips"],
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
    expect(node.textContent).toContain("Chop Tree");
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

  test("a node can need a class: Classes ticked in place of At least (issue #15)", () => {
    const { p, sent } = page();
    q<HTMLButtonElement>(p.el, "[data-action='gathering-open-node']").click();
    const on = q<HTMLInputElement>(p.el, "[data-action='gathering-requires-on']");
    on.checked = true;
    on.dispatchEvent(new Event("change"));
    const needs = q<HTMLSelectElement>(p.el, "[data-action='gathering-requires-needs']");
    needs.value = "class";
    needs.dispatchEvent(new Event("change"));
    expect(q(p.el, "[data-action='gathering-requires-at']")).toBeNull();
    const ranger = q<HTMLInputElement>(p.el, "[data-action='gathering-requires-class-3']");
    ranger.checked = true;
    ranger.dispatchEvent(new Event("change"));
    q<HTMLButtonElement>(p.el, "[data-action='gathering-save']").click();
    expect(sent.at(-1)).toMatchObject({
      data: { node: { requires: { needs: "class", atLeast: 1, classes: [3] } } },
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

describe("fishing's catches and training", () => {
  test("a catch pool's fish, ranges, weights and XP are edited, previewed and saved", () => {
    const { p, sent } = page();
    q<HTMLButtonElement>(p.el, "[data-action='gathering-open-fishing']").click();
    q<HTMLButtonElement>(p.el, "[data-action='gathering-catches-add']").click();
    const last = <T extends Element>(sel: string) => [...p.el.querySelectorAll(sel)].at(-1) as T;
    typeIn(last<HTMLInputElement>("[data-action='gathering-catches-fish']"), "Shark");
    typeIn(last<HTMLInputElement>("[data-action='gathering-catches-from']"), "50");
    typeIn(last<HTMLInputElement>("[data-action='gathering-catches-weight']"), "3");
    typeIn(last<HTMLInputElement>("[data-action='gathering-catches-xp']"), "80");
    // The first fish's range now ends at 60.
    typeIn(q<HTMLInputElement>(p.el, "[data-action='gathering-catches-below']"), "60");
    expect(last<HTMLInputElement>("[data-action='gathering-catches-below']").placeholder).toBe(
      "no limit",
    );
    q<HTMLInputElement>(p.el, "[data-action='gathering-trains-catch']").click();
    q<HTMLInputElement>(p.el, "[data-action='gathering-trains-cast']").click();
    const rows = [...p.el.querySelectorAll(".gathering-preview tbody tr")].map(
      (r) => r.textContent ?? "",
    );
    expect(rows.find((r) => r.startsWith("50-59"))).toContain("Fish 25%");
    expect(rows.find((r) => r.startsWith("50-59"))).toContain("Shark 75% (80 XP)");
    expect(rows.find((r) => r.startsWith("60"))).toContain("Shark (80 XP)");
    q<HTMLButtonElement>(p.el, "[data-action='gathering-save']").click();
    expect(sent.at(-1)).toMatchObject({
      op: "fishing",
      data: {
        trains: { cast: false, catch: true },
        catches: [
          { fish: "Fish", from: 0, below: 60, weight: 1 },
          { fish: "Shark", from: 50, weight: 3, xp: 80 },
        ],
      },
    });
  });
});

describe("fishing's splash and sound", () => {
  test("the cast's effect, frames, sound and where it lands are edited and saved", () => {
    const { p, sent } = page();
    q<HTMLButtonElement>(p.el, "[data-action='gathering-open-fishing']").click();
    const fx = q<HTMLInputElement>(p.el, "[data-action='gathering-cast-fx']");
    expect(fx.value).toBe("Fishing");
    expect(fx.getAttribute("list")).toBe("gathering-effects");
    expect(q<HTMLInputElement>(p.el, "[data-action='gathering-cast-frames']").value).toBe("13");
    expect(q<HTMLInputElement>(p.el, "[data-action='gathering-cast-sound']").value).toBe("splash");
    typeIn(fx, "Bobber");
    typeIn(q<HTMLInputElement>(p.el, "[data-action='gathering-cast-frames']"), "6");
    typeIn(q<HTMLInputElement>(p.el, "[data-action='gathering-cast-sound-ch']"), "6");
    typeIn(q<HTMLInputElement>(p.el, "[data-action='gathering-cast-offset-n-y']"), "-40");
    q<HTMLButtonElement>(p.el, "[data-action='gathering-save']").click();
    expect(sent.at(-1)).toMatchObject({
      op: "fishing",
      data: {
        castFx: { fx: "Bobber", frames: 6 },
        castSound: { name: "splash", ch: 6 },
        fxOffsets: { N: [0, -40], S: [0, 0], E: [0, 0], W: [0, 0] },
      },
    });
  });

  test("clearing the effect or the sound saves none, and hides what only it needs", () => {
    const { p, sent } = page();
    q<HTMLButtonElement>(p.el, "[data-action='gathering-open-fishing']").click();
    typeIn(q<HTMLInputElement>(p.el, "[data-action='gathering-cast-fx']"), "");
    typeIn(q<HTMLInputElement>(p.el, "[data-action='gathering-cast-sound']"), "");
    expect(p.el.querySelector("[data-action='gathering-cast-frames']")).toBeNull();
    expect(p.el.querySelector("[data-action='gathering-cast-sound-ch']")).toBeNull();
    q<HTMLButtonElement>(p.el, "[data-action='gathering-save']").click();
    expect(sent.at(-1)).toMatchObject({ op: "fishing", data: { castFx: null, castSound: null } });
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
    // An average of 13,600 frames at 20 a second: about 11 minutes.
    expect(opts[1]?.textContent).toBe("Trees: grows back in about 11 minutes on average");
  });

  test("Undo changes on a new node closes its form", () => {
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

describe("the plain-language form", () => {
  const tabs = (p: { el: HTMLElement }) =>
    [...p.el.querySelectorAll<HTMLElement>(".items-group")].map((s) => [
      s.querySelector(".balance-row-title")?.textContent,
      s.dataset.used,
    ]);

  test("asks for a pick until something is open, and lists the other activities", () => {
    const { p } = page();
    expect(q<HTMLElement>(p.el, ".items-empty-form").hidden).toBe(false);
    expect(q<HTMLElement>(p.el, ".items-form").hidden).toBe(true);
    expect(
      [...p.el.querySelectorAll("[aria-label='Other activities'] button")].map(
        (b) => b.firstChild?.textContent,
      ),
    ).toEqual(["Fishing", "Farming", "Swings per harvest"]);
    q<HTMLButtonElement>(p.el, "[data-action='gathering-open-counter']").click();
    expect(q<HTMLElement>(p.el, ".items-empty-form").hidden).toBe(true);
    expect(
      q<HTMLElement>(p.el, "[data-action='gathering-open-counter']").getAttribute("aria-current"),
    ).toBe("true");
  });

  test("a tile's form: plain tabs with help lines, a dot only where it holds more than the basics", () => {
    const { p } = page();
    q<HTMLButtonElement>(p.el, "[data-action='gathering-open-node']").click();
    expect(q<HTMLElement>(p.el, ".items-form h2").textContent).toBe("Chop Tree");
    expect(q<HTMLElement>(p.el, ".items-form-id").textContent).toBe("Node 1 · tile T1");
    expect(tabs(p)).toEqual([
      ["Tile", "true"],
      ["Tool", "false"],
      ["Skill", "false"],
      ["Harvesting", "false"],
      ["Drops", "true"],
      ["Sounds and effect", "true"],
      ["Odds", "false"],
    ]);
    expect(p.el.querySelectorAll(".items-group > .items-intro")).toHaveLength(7);
    // The rare tool fields are folded away while empty.
    const toolMore = q<HTMLElement>(p.el, "[data-group='tool']").querySelector(
      ".items-more",
    ) as HTMLDetailsElement;
    expect(toolMore.open).toBe(false);
    expect(toolMore.contains(q(p.el, "[data-action='gathering-tools']"))).toBe(true);
    // The tool action reads in words, and says which tools can do it now.
    const can = q<HTMLSelectElement>(p.el, "[data-action='gathering-can']");
    expect(can.selectedOptions[0]?.textContent).toBe("Chop (axes)");
    expect(can.parentElement?.textContent).toContain(
      "Tools that can chop now: anything named like “Axe” (tier 1), Gold Axe (tier 2).",
    );
    // The buttons say what they do.
    expect(q<HTMLButtonElement>(p.el, "[data-action='gathering-save']").textContent).toBe(
      "Save changes",
    );
    expect(q<HTMLButtonElement>(p.el, "[data-action='gathering-undo-edit']").textContent).toBe(
      "Undo changes",
    );
    expect(q<HTMLButtonElement>(p.el, "[data-action='gathering-remove-node']").hidden).toBe(false);
  });

  test("a tile with special tools opens its More options; a new tile cannot be removed", () => {
    const { p, seq } = page();
    q<HTMLButtonElement>(p.el, "[data-action='gathering-open-node']").click();
    typeIn(q<HTMLInputElement>(p.el, "[data-action='gathering-tools']"), "Gold Axe");
    q<HTMLButtonElement>(p.el, "[data-action='gathering-save']").click();
    p.receive({
      t: "contentGathering",
      seq: seq(),
      view: (() => {
        const v = VIEW("bbbbbbbbbbbbbbbb");
        (v.nodes[0] as { node: { tools?: string[] } }).node.tools = ["Gold Axe"];
        return v;
      })(),
      result: { ok: true, text: "Node 1 is in the draft." },
    });
    const toolMore = q<HTMLElement>(p.el, "[data-group='tool'] .items-more") as HTMLDetailsElement;
    expect(toolMore.open).toBe(true);
    expect(q<HTMLElement>(p.el, "[data-group='tool']").dataset.used).toBe("true");
    q<HTMLButtonElement>(p.el, "[data-action='gathering-new-node']").click();
    expect(q<HTMLElement>(p.el, ".items-form h2").textContent).toBe("New harvestable tile");
    expect(q<HTMLButtonElement>(p.el, "[data-action='gathering-remove-node']").hidden).toBe(true);
  });

  test("skill rows read “from skill N” and save as the stored “above N - 1”", () => {
    const { p, sent } = page();
    q<HTMLButtonElement>(p.el, "[data-action='gathering-open-node']").click();
    typeIn(q<HTMLInputElement>(p.el, "[data-action='gathering-yield']"), "Stones");
    const from = q<HTMLInputElement>(p.el, "[data-action='gathering-yield-by-gt']");
    // Stones' row is "above 50": from skill 51.
    expect(from.value).toBe("51");
    typeIn(from, "41");
    q<HTMLButtonElement>(p.el, "[data-action='gathering-save']").click();
    const data = sent.at(-1)?.data as { yieldTable: unknown };
    expect(data.yieldTable).toEqual({
      kind: "chance",
      item: "Fish",
      chance: 9,
      bySkill: [{ gt: 40, value: 2 }],
    });
    // The hit counter's first row, "above -1", reads from skill 0.
    const { p: p2 } = page();
    q<HTMLButtonElement>(p2.el, "[data-action='gathering-open-counter']").click();
    expect(
      [...p2.el.querySelectorAll<HTMLInputElement>("[data-action='gathering-counter-gt']")].map(
        (i) => i.value,
      ),
    ).toEqual(["0", "11"]);
  });

  test("an out-of-range number is refused by name, and nothing is sent", () => {
    const { p, sent } = page();
    q<HTMLButtonElement>(p.el, "[data-action='gathering-open-node']").click();
    typeIn(q<HTMLInputElement>(p.el, "[data-action='gathering-tier']"), "0");
    const before = sent.length;
    q<HTMLButtonElement>(p.el, "[data-action='gathering-save']").click();
    expect(sent.length).toBe(before);
    expect(q<HTMLElement>(p.el, ".balance-status").textContent).toBe(
      "Lowest tool tier: a whole number from 1 to 1000",
    );
  });

  test("farming's tilled soil is typed as tile codes and saved as the game reads it", () => {
    const { p, sent } = page();
    p.receive({
      t: "contentGathering",
      seq: 50,
      view: {
        ...VIEW(),
        farming: {
          data: {
            seedTest: "*SL*",
            seeds: [{ item: "Seeds", plants: "UL" }],
            seedPause: 10,
            wateringSkill: "Lumberjacking",
            watering: [{ from: "UL", to: "XL" }],
            produce: [{ tile: "XL", item: "Corn" }],
          },
          fingerprint: "eeeeeeeeeeeeeeee",
        },
      },
    });
    q<HTMLButtonElement>(p.el, "[data-action='gathering-open-farming']").click();
    expect(tabs(p).map((t) => t[0])).toEqual(["Seeds", "Watering", "Crops"]);
    const soil = q<HTMLInputElement>(p.el, "[data-action='gathering-seed-test']");
    expect(soil.value).toBe("SL");
    typeIn(soil, "SL, TL");
    q<HTMLButtonElement>(p.el, "[data-action='gathering-save']").click();
    expect(sent.at(-1)).toMatchObject({ op: "farming", data: { seedTest: "*SL*TL*" } });
  });

  test("waits and regrowth checks read in plain words", () => {
    expect(waitText(20)).toBe("1 second");
    expect(waitText(24_480)).toBe("20 minutes");
    expect(waitText(20 * 60 * 150)).toBe("2.5 hours");
    expect(regrowthName("CheckTrees")).toBe("Trees");
    expect(regrowthName("DoVeg")).toBe("Veg");
    expect(regrowthName("trees")).toBe("Trees");
  });

  describe("restoring the original", () => {
    /** The page with node 1 changed from the pack's (xp and its drop chance), and its form open. */
    const changed = () => {
      const t = page();
      const v = VIEW();
      const node = v.nodes[0];
      if (!node) {
        throw new Error("no node");
      }
      node.pack = {
        node: { ...node.node },
        yield: { kind: "chance", item: "Logs", chance: 5 },
        regrows: "trees",
      };
      node.node = { ...node.node, xp: 7 };
      node.differs = true;
      v.counter.pack = v.counter.rows;
      v.counter.differs = false;
      t.p.receive({ t: "contentGathering", seq: t.seq(), view: v });
      q<HTMLButtonElement>(t.p.el, "[data-action='gathering-open-node']").click();
      return t;
    };
    const tagText = (root: ParentNode) =>
      [...root.querySelectorAll(".items-form-head .balance-tag")].map((x) => x.textContent);

    test("a changed tile says so and offers its restores only where it differs", () => {
      const { p } = changed();
      expect(tagText(p.el)).toEqual(["Changed by you"]);
      expect(q<HTMLButtonElement>(p.el, "[data-action='gathering-revert']").hidden).toBe(false);
      expect(q<HTMLButtonElement>(p.el, "[data-action='gathering-pack-skill']").hidden).toBe(false);
      expect(q<HTMLButtonElement>(p.el, "[data-action='gathering-pack-drops']").hidden).toBe(false);
      expect(q<HTMLButtonElement>(p.el, "[data-action='gathering-pack-tile']").hidden).toBe(true);
      expect(q<HTMLButtonElement>(p.el, "[data-action='gathering-pack-tool']").hidden).toBe(true);
    });

    test("Restore this tab copies the pack's fields into the form, to be saved", () => {
      const { p, sent } = changed();
      q<HTMLButtonElement>(p.el, "[data-action='gathering-pack-drops']").click();
      expect(q<HTMLButtonElement>(p.el, "[data-action='gathering-pack-drops']").hidden).toBe(true);
      q<HTMLButtonElement>(p.el, "[data-action='gathering-save']").click();
      const data = sent.at(-1)?.data as { node: { xp?: number }; yieldTable?: unknown };
      // The drops are the pack's again; the skill tab's XP is still the change.
      expect(data.yieldTable).toEqual({ kind: "chance", item: "Logs", chance: 5 });
      expect(data.node.xp).toBe(7);
    });

    test("Restore the original saves the pack's node, drop table and regrowth", () => {
      const { p, sent } = changed();
      q<HTMLButtonElement>(p.el, "[data-action='gathering-revert']").click();
      expect(sent.at(-1)).toMatchObject({
        op: "node",
        index: 0,
        expect: "aaaaaaaaaaaaaaaa",
        data: {
          regrows: "trees",
          yieldTable: { kind: "chance", item: "Logs", chance: 5 },
          yieldExpect: "2222222222222222",
        },
      });
      expect(
        (sent.at(-1)?.data as { node?: { xp?: number } } | undefined)?.node?.xp,
      ).toBeUndefined();
    });

    test("an unchanged part is Original with nothing to restore; a tile of your own has no original", () => {
      const t = changed();
      q<HTMLButtonElement>(t.p.el, "[data-action='gathering-open-counter']").click();
      // The tile's form has no changes, so the counter opens.
      expect(tagText(t.p.el)).toEqual(["Original"]);
      expect(q<HTMLButtonElement>(t.p.el, "[data-action='gathering-revert']").hidden).toBe(true);
      document.body.replaceChildren();
      const own = page();
      q<HTMLButtonElement>(own.p.el, "[data-action='gathering-open-node']").click();
      expect(tagText(own.p.el)).toEqual(["Added by you"]);
      expect(own.p.el.querySelector("[data-action='gathering-pack-tile']")).toBeNull();
    });
  });
});

describe("RuneScape-style harvesting", () => {
  test("a chance by level, tool tiers, lasting tiles and a timer are edited, previewed and saved", () => {
    const { p, sent } = page();
    q<HTMLButtonElement>(p.el, "[data-action='gathering-open-node']").click();
    const how = q<HTMLSelectElement>(p.el, "[data-action='gathering-how']");
    expect(how.value).toBe("swings");
    how.value = "odds";
    how.dispatchEvent(new Event("change"));
    // Two starting points: 25% at level 1, 90% at 99.
    const levels = [
      ...p.el.querySelectorAll<HTMLInputElement>("[data-action='gathering-odds-level']"),
    ];
    const percents = [
      ...p.el.querySelectorAll<HTMLInputElement>("[data-action='gathering-odds-percent']"),
    ];
    expect(levels.map((i) => i.value)).toEqual(["1", "99"]);
    typeIn(levels[0] as HTMLInputElement, "15");
    typeIn(percents[0] as HTMLInputElement, "12.5");
    typeIn(levels[1] as HTMLInputElement, "60");
    typeIn(percents[1] as HTMLInputElement, "50");
    typeIn(q<HTMLInputElement>(p.el, "[data-action='gathering-tier-bonus']"), "10");
    typeIn(q<HTMLInputElement>(p.el, "[data-action='gathering-depletes']"), "8");
    typeIn(q<HTMLInputElement>(p.el, "[data-action='gathering-respawn']"), "90");
    // The preview reads the chance: 12.5% at 15 is about 8 swings; tier 2 adds 10 points.
    const rows = [...p.el.querySelectorAll(".gathering-preview tbody tr")].map((r) =>
      [...r.querySelectorAll("td")].map((c) => c.textContent),
    );
    const at = (tier: string, v: number) =>
      rows.find((r) => {
        const [lo, hi = lo] = (r[1] ?? "").split("-").map(Number);
        return r[0]?.startsWith(tier) && v >= (lo ?? 0) && v <= (hi ?? 0);
      });
    expect(at("Tier 1", 15)?.slice(2, 4)).toEqual(["about 8", "1 in 8 (12.5%)"]);
    expect(at("Tier 2", 60)?.slice(2, 4)).toEqual(["about 1.7", "1 in 1.7 (60.0%)"]);
    expect(p.el.querySelector(".gathering-preview")?.textContent).toContain(
      "Each tile gives 8 harvests on average",
    );
    q<HTMLButtonElement>(p.el, "[data-action='gathering-save']").click();
    const data = sent.at(-1)?.data as { node: Record<string, unknown> };
    expect(data.node).toMatchObject({
      odds: [
        { level: 15, percent: 12.5 },
        { level: 60, percent: 50 },
      ],
      tierBonus: 10,
      depletes: 8,
      respawn: 90,
    });
    expect(harvestNodeSchema.safeParse(data.node).success).toBe(true);
    // Back to swings, before a save: the chance and the tool bonus go.
    const again = page();
    q<HTMLButtonElement>(again.p.el, "[data-action='gathering-open-node']").click();
    const how2 = q<HTMLSelectElement>(again.p.el, "[data-action='gathering-how']");
    how2.value = "odds";
    how2.dispatchEvent(new Event("change"));
    typeIn(q<HTMLInputElement>(again.p.el, "[data-action='gathering-tier-bonus']"), "5");
    typeIn(q<HTMLInputElement>(again.p.el, "[data-action='gathering-depletes']"), "3");
    how2.value = "swings";
    how2.dispatchEvent(new Event("change"));
    q<HTMLButtonElement>(again.p.el, "[data-action='gathering-save']").click();
    const saved = again.sent.at(-1)?.data as { node: Record<string, unknown> };
    const back = saved.node;
    expect(back.odds).toBeUndefined();
    expect(back.tierBonus).toBeUndefined();
    expect(back.depletes).toBe(3);
  });

  test("a percent with more than two decimal places is refused by name", () => {
    const { p, sent } = page();
    q<HTMLButtonElement>(p.el, "[data-action='gathering-open-node']").click();
    const how = q<HTMLSelectElement>(p.el, "[data-action='gathering-how']");
    how.value = "odds";
    how.dispatchEvent(new Event("change"));
    typeIn(q<HTMLInputElement>(p.el, "[data-action='gathering-odds-percent']"), "1.234");
    const before = sent.length;
    q<HTMLButtonElement>(p.el, "[data-action='gathering-save']").click();
    expect(sent.length).toBe(before);
  });

  test("a fish caught only with named tools saves them as a list", () => {
    const { p, sent } = page();
    q<HTMLButtonElement>(p.el, "[data-action='gathering-open-fishing']").click();
    typeIn(q<HTMLInputElement>(p.el, "[data-action='gathering-catches-tools']"), "Harpoon, Net");
    q<HTMLButtonElement>(p.el, "[data-action='gathering-save']").click();
    expect(sent.at(-1)).toMatchObject({
      op: "fishing",
      data: { catches: [{ fish: "Fish", tools: ["Harpoon", "Net"] }] },
    });
    // Cleared again, before a save: no list at all.
    const again = page();
    q<HTMLButtonElement>(again.p.el, "[data-action='gathering-open-fishing']").click();
    const tools = q<HTMLInputElement>(again.p.el, "[data-action='gathering-catches-tools']");
    typeIn(tools, "Harpoon");
    typeIn(tools, "");
    typeIn(q<HTMLInputElement>(again.p.el, "[data-action='gathering-anti-macro']"), "7");
    q<HTMLButtonElement>(again.p.el, "[data-action='gathering-save']").click();
    const fishing = again.sent.at(-1)?.data as { catches: Record<string, unknown>[] };
    const catches = fishing.catches;
    expect(catches[0]?.tools).toBeUndefined();
  });
});
