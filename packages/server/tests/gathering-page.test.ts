/**
 * Issue #38: the Gathering page on the server. The nodes by tile with their yield tables and
 * regrowth, saves of a node (its fields, its yield table, its regrowth check) as one change, stale
 * refusals, refusals of new problems, new and removed nodes, fishing, farming and the hit counter,
 * and the draft's gathering changes dropped together.
 */
import { afterAll, describe, expect, test } from "bun:test";

import { RELEASE_PACK_DIRS } from "@secondstaronline/data/packs";
import { content, gatherPreview, installContent } from "@secondstaronline/shared";

import {
  draftGatheringChange,
  gatheringFieldProblems,
  gatheringView,
} from "../src/content/gathering-page.ts";
import { contentIntent } from "../src/content/page.ts";
import { type ContentActor, ContentService } from "../src/content/service.ts";
import { seedNewWorld, worldToCreate } from "../src/content/world-seed.ts";
import { openDatabase } from "../src/persistence/database.ts";
import { loadMigrations, MIGRATIONS_DIR, runMigrations } from "../src/persistence/migrations.ts";

const classic = content();
afterAll(() => installContent(classic));

const ADMIN: ContentActor = { accountId: "acc-admin", name: "Admin" };

function service() {
  const db = openDatabase();
  const creating = worldToCreate(db, "classic", RELEASE_PACK_DIRS);
  runMigrations(db, loadMigrations(MIGRATIONS_DIR));
  if (creating) {
    seedNewWorld(db, creating, RELEASE_PACK_DIRS, "2026-11-25T00:00:00.000Z");
  }
  let t = 0;
  return new ContentService({
    db,
    now: () => new Date(Date.UTC(2026, 10, 25, 0, 0, t++)).toISOString(),
    releasePacks: RELEASE_PACK_DIRS,
    onPublish: (store) => installContent(store),
  });
}

describe("the Gathering page's view", () => {
  test("lists Classic's nodes with their yield tables and regrowth, fishing and farming", () => {
    const s = service();
    const v = gatheringView(s);
    expect(v.nodes.length).toBe(content().gather.harvest.length);
    const tree = v.nodes.find((n) => n.node.can === "Chop");
    expect(tree?.yield).toMatchObject({ kind: "chance", item: "Logs" });
    expect(tree?.regrows).not.toBeNull();
    expect(v.fishing.skill).toBe("Fishing");
    expect(v.fishing.data?.bands.length).toBeGreaterThan(0);
    expect(v.farming.data?.wateringSkill).toBeTruthy();
    expect(v.tools.some((t) => t.can === "Chop")).toBe(true);
    expect(v.choices.cans).not.toContain("Fish");
    expect(v.skills.find((x) => x.skill === "Lumberjacking")?.gather).not.toBeNull();
    expect(v.pending).toBe(false);
  });

  test("the preview's swings per success match the counter table the game loads", () => {
    const s = service();
    const v = gatheringView(s);
    const tree = v.nodes.find((n) => n.node.can === "Chop");
    if (!tree) {
      throw new Error("no tree");
    }
    // Classic's own test: Lumberjacking 5 fells a tree in 18 swings, and drops logs 1 in 3.
    const [cell] = gatherPreview(
      tree.node,
      { counterTable: v.counter.rows, yields: { [tree.node.yield ?? ""]: tree.yield as never } },
      [5],
      [1],
      { level: 1, otherSkills: 0 },
    );
    expect(cell?.hits).toBe(18);
    expect(cell?.drop).toBeCloseTo(1 / 3);
  });
});

describe("Gathering page changes", () => {
  test("a node's save writes its fields, yield table and regrowth as one change; stale saves are refused", () => {
    const s = service();
    try {
      const v = gatheringView(s);
      const tree = v.nodes.find((n) => n.node.can === "Chop");
      if (!tree?.yield || tree.yield.kind !== "chance") {
        throw new Error("no tree");
      }
      const r = draftGatheringChange(s, ADMIN, {
        op: "node",
        index: tree.index,
        data: {
          node: { ...tree.node, xp: 7 },
          yieldTable: { ...tree.yield, chance: 2 },
          yieldExpect: v.yieldFingerprints[tree.node.yield ?? ""],
          regrows: null,
        },
        expect: tree.fingerprint,
      });
      expect(r.ok ? r.value : r.error).toBe(`Node ${tree.index + 1} is in the draft.`);
      expect(
        s
          .draft()
          .map((d) => d.part)
          .sort(),
      ).toEqual(["gathering", "harvest", "yields"]);
      const after = gatheringView(s).nodes[tree.index];
      expect(after?.regrows).toBeNull();
      expect(after?.node.xp).toBe(7);
      const stale = draftGatheringChange(s, ADMIN, {
        op: "node",
        index: tree.index,
        data: { node: tree.node },
        expect: tree.fingerprint,
      });
      expect(stale.ok ? "" : stale.error).toContain("changed since you opened it");
      expect(s.publish(ADMIN, s.draftRev(), "").ok).toBe(true);
      expect(content().gather.harvest[tree.index]?.xp).toBe(7);
      expect(content().gather.yields[tree.node.yield ?? ""]).toMatchObject({ chance: 2 });
    } finally {
      installContent(classic);
    }
  });

  test("a node knows the pack's node; saving the pack's back reverts your rows", () => {
    const s = service();
    try {
      const v = gatheringView(s);
      const tree = v.nodes.find((n) => n.node.can === "Chop");
      if (!tree?.yield || tree.yield.kind !== "chance" || !tree.pack) {
        throw new Error("no tree");
      }
      expect(tree.differs).toBe(false);
      expect(tree.pack.node).toEqual(tree.node);
      expect(v.counter.differs).toBe(false);
      const changed = draftGatheringChange(s, ADMIN, {
        op: "node",
        index: tree.index,
        data: {
          node: { ...tree.node, xp: 7 },
          yieldTable: { ...tree.yield, chance: 2 },
          yieldExpect: v.yieldFingerprints[tree.node.yield ?? ""],
        },
        expect: tree.fingerprint,
      });
      expect(changed.ok).toBe(true);
      expect(s.publish(ADMIN, s.draftRev(), "").ok).toBe(true);
      const v2 = gatheringView(s);
      const now = v2.nodes[tree.index];
      expect(now?.differs).toBe(true);
      // "Restore the original": the pack's node saved back, with its expect.
      const restored = draftGatheringChange(s, ADMIN, {
        op: "node",
        index: tree.index,
        data: {
          node: tree.pack.node,
          yieldTable: tree.pack.yield,
          yieldExpect: v2.yieldFingerprints[tree.node.yield ?? ""],
          regrows: tree.pack.regrows,
        },
        expect: now?.fingerprint ?? "",
      });
      expect(restored.ok ? restored.value : restored.error).toBe(
        `Node ${tree.index + 1} plays the original again once published.`,
      );
      // Rows equal to the pack's revert, leaving no change of yours once published.
      expect(
        s
          .draft()
          .map((d) => `${d.part}:${d.op}`)
          .sort(),
      ).toEqual(["harvest:revert", "yields:revert"]);
      expect(gatheringView(s).nodes[tree.index]?.differs).toBe(false);
      expect(s.publish(ADMIN, s.draftRev(), "").ok).toBe(true);
      expect(s.operatorRows().filter((r) => r.dataset === "gather")).toEqual([]);
    } finally {
      installContent(classic);
    }
  });

  test("a node of your own has no pack node", () => {
    const s = service();
    const v = gatheringView(s);
    const tree = v.nodes.find((n) => n.node.can === "Chop");
    if (!tree) {
      throw new Error("no tree");
    }
    const r = draftGatheringChange(s, ADMIN, {
      op: "newNode",
      data: { node: { ...tree.node, tile: "Z9", becomes: "Z8" } },
    });
    expect(r.ok ? r.value : r.error).toContain("is in the draft");
    expect(gatheringView(s).nodes.at(-1)?.pack).toBeNull();
  });

  test("a change that brings a new problem is refused and leaves the draft as it was", () => {
    const s = service();
    const v = gatheringView(s);
    const node = v.nodes[0];
    if (!node) {
      throw new Error("no node");
    }
    // A skill nothing has.
    const bad = draftGatheringChange(s, ADMIN, {
      op: "node",
      index: 0,
      data: { node: { ...node.node, skill: "Basket Weaving" } },
      expect: node.fingerprint,
    });
    expect(bad.ok).toBe(false);
    expect(bad.ok ? [] : (bad.problems ?? []).map((p) => `${p.where}: ${p.message}`)).toEqual([
      expect.stringContaining("Basket Weaving"),
    ]);
    // A shape the schema refuses.
    const shape = draftGatheringChange(s, ADMIN, {
      op: "node",
      index: 0,
      data: { node: { ...node.node, can: "Fish" } },
      expect: node.fingerprint,
    });
    expect(shape.ok).toBe(false);
    expect(s.draft()).toEqual([]);
  });

  test("a new node, its removal, the hit counter, fishing and farming; discard drops them all", () => {
    const s = service();
    const v = gatheringView(s);
    const made = draftGatheringChange(s, ADMIN, {
      op: "newNode",
      data: {
        node: {
          tile: "Q9",
          can: "Dig",
          becomes: "R9",
          skill: "Mining",
          gains: false,
          hitSound: null,
          successSound: null,
        },
      },
    });
    expect(made.ok ? made.value : made.error).toBe(`Node ${v.nodes.length + 1} is in the draft.`);
    const added = gatheringView(s).nodes.at(-1);
    const gone = draftGatheringChange(s, ADMIN, {
      op: "removeNode",
      index: added?.index ?? -1,
      expect: added?.fingerprint ?? "",
    });
    expect(gone.ok).toBe(true);
    expect(gatheringView(s).nodes.length).toBe(v.nodes.length);
    const counter = draftGatheringChange(s, ADMIN, {
      op: "counter",
      data: [{ gt: -1, value: 3 }],
      expect: v.counter.fingerprint,
    });
    expect(counter.ok).toBe(true);
    const fishing = v.fishing.data;
    const fish = draftGatheringChange(s, ADMIN, {
      op: "fishing",
      data: { ...fishing, antiMacroStart: (fishing?.antiMacroStart ?? 0) + 1 },
      expect: v.fishing.fingerprint,
    });
    expect(fish.ok ? fish.value : fish.error).toBe("Fishing is in the draft.");
    const farm = draftGatheringChange(s, ADMIN, {
      op: "farming",
      data: { ...v.farming.data, seedPause: 3 },
      expect: v.farming.fingerprint,
    });
    expect(farm.ok).toBe(true);
    const now = gatheringView(s);
    expect(now.pending).toBe(true);
    expect(now.fishing.data?.antiMacroStart).toBe((fishing?.antiMacroStart ?? 0) + 1);
    // Through the intent, as the page sends it.
    const answer = contentIntent(s, ADMIN, {
      t: "contentGatheringSet",
      seq: 1,
      op: "discard",
      expect: now.fingerprint,
    });
    expect(answer.t === "contentGathering" && answer.result?.ok).toBe(true);
    expect(s.draft()).toEqual([]);
  });
});

describe("refusals name the form's fields", () => {
  test("a node's, a drop table's and the gathering section's problems read by the page's labels", () => {
    const m = "bad";
    expect(
      gatheringFieldProblems([
        { where: "gather/harvest/1/tools/0", message: m },
        { where: "gather/harvest/0/becomes", message: m },
        { where: "gather/harvest/2", message: m },
        { where: "gather/yields/Logs/bySkill/1", message: m },
        { where: "gather/yields/Logs", message: m },
        { where: "gather/gathering/counterTable/3/value", message: m },
        { where: "gather/gathering/fishing", message: m },
        { where: "gather/gathering/fishing/bands/1/fish", message: m },
        { where: "gather/gathering/farming/seeds", message: m },
      ]).map((p) => p.where),
    ).toEqual([
      "Node 2: Only these tools 1",
      "Node 1: Turns into",
      "Node 3",
      "Drop table Logs: Better odds with more skill 2",
      "Drop table Logs",
      "Swings per harvest 4",
      "Fishing",
      "Fishing: Fish by skill 2",
      "Farming: Seeds",
    ]);
  });

  test("a shape the schema refuses is named by the form's label", () => {
    const s = service();
    const node = gatheringView(s).nodes[0];
    if (!node) {
      throw new Error("no node");
    }
    const bad = draftGatheringChange(s, ADMIN, {
      op: "node",
      index: 0,
      data: { node: { ...node.node, tier: 0 } },
      expect: node.fingerprint,
    });
    expect(bad.ok ? [] : (bad.problems ?? []).map((p) => p.where)).toEqual(["Lowest tool tier"]);
  });
});
