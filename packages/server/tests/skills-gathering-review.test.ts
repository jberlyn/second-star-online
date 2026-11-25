/**
 * Issue #38, review fixes: shared yield tables and curves are never written from a stale form;
 * regrowth never touches a produce check and keeps a pair another node uses; a removal report goes
 * stale when what names the skill changes; skill books' formulas are references; the Skills page's
 * discard reverts every field it saved; removals leave valid rows; and a refused page change rolls
 * back every side effect.
 */
import { afterAll, describe, expect, test } from "bun:test";

import { RELEASE_PACK_DIRS } from "@secondstaronline/data/packs";
import { content, installContent, isProduceCheck } from "@secondstaronline/shared";

import { draftGatheringChange, gatheringView } from "../src/content/gathering-page.ts";
import { type ContentActor, ContentService } from "../src/content/service.ts";
import {
  draftSkillChange,
  draftSkillRemoval,
  skillsView,
  skillUsage,
} from "../src/content/skills-page.ts";
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
const msg = (r: { ok: boolean; error?: string; value?: unknown; problems?: unknown }) =>
  r.ok ? String(r.value) : `${r.error} ${JSON.stringify(r.problems ?? [])}`;

describe("shared tables and curves", () => {
  test("a node switched to a shared yield table never writes over a newer edit of it", () => {
    const s = service();
    const v1 = gatheringView(s);
    const tree = v1.nodes.find((n) => n.node.yield === "Logs");
    const rock = v1.nodes.find((n) => n.node.tile === "B8");
    if (!tree?.yield || !rock) {
      throw new Error("Classic nodes");
    }
    // Operator B changes the Logs table through the tree.
    expect(
      msg(
        draftGatheringChange(s, ADMIN, {
          op: "node",
          index: tree.index,
          data: {
            node: tree.node,
            yieldTable: { ...tree.yield, chance: 7 },
            yieldExpect: v1.yieldFingerprints.Logs,
          },
          expect: tree.fingerprint,
        }),
      ),
    ).toContain("is in the draft");
    // Operator A, from the older view, points the rock at Logs carrying the old table: refused.
    const stale = draftGatheringChange(s, ADMIN, {
      op: "node",
      index: rock.index,
      data: {
        node: { ...rock.node, yield: "Logs" },
        yieldTable: { ...tree.yield, chance: 2 },
        yieldExpect: v1.yieldFingerprints.Logs,
      },
      expect: rock.fingerprint,
    });
    expect(stale.ok ? "" : stale.error).toContain("Yield table Logs changed");
    // Naming the table alone is fine, and B's edit stays.
    expect(
      msg(
        draftGatheringChange(s, ADMIN, {
          op: "node",
          index: rock.index,
          data: { node: { ...rock.node, yield: "Logs" } },
          expect: rock.fingerprint,
        }),
      ),
    ).toContain("is in the draft");
    expect(s.draftContent().gather.yields.Logs).toMatchObject({ chance: 7 });
  });

  test("a skill switched to another's curve never writes over a newer edit of it", () => {
    const s = service();
    expect(
      msg(
        draftSkillChange(s, ADMIN, {
          key: "Quarrying",
          op: "create",
          data: {
            progression: { model: "xp", curve: "steady", on: { gather: { xp: 10 } } },
            curve: { name: "steady", expect: null, curve: { counting: "perLevel", formula: 100 } },
          },
        }),
      ),
    ).toContain("is in the draft");
    const old = skillsView(s);
    const q = skillsView(s, "Quarrying").skill;
    // B edits the curve.
    expect(
      msg(
        draftSkillChange(s, ADMIN, {
          key: "Quarrying",
          op: "set",
          data: {
            curve: {
              name: "steady",
              expect: old.curveFingerprints.steady ?? null,
              curve: { counting: "perLevel", formula: 150 },
            },
          },
          expect: q?.fingerprint ?? "",
        }),
      ),
    ).toContain("is in the draft");
    // A switches Thrust to that curve carrying the copy it loaded: refused.
    const thrust = skillsView(s, "Thrust").skill;
    const stale = draftSkillChange(s, ADMIN, {
      key: "Thrust",
      op: "set",
      data: {
        progression: { model: "xp", curve: "steady" },
        curve: {
          name: "steady",
          expect: old.curveFingerprints.steady ?? null,
          curve: { counting: "perLevel", formula: 100 },
        },
      },
      expect: thrust?.fingerprint ?? "",
    });
    expect(stale.ok ? "" : stale.error).toContain("The level curve steady changed");
    // Naming it alone is fine; B's curve stays.
    expect(
      msg(
        draftSkillChange(s, ADMIN, {
          key: "Thrust",
          op: "set",
          data: { progression: { model: "xp", curve: "steady" } },
          expect: thrust?.fingerprint ?? "",
        }),
      ),
    ).toContain("is in the draft");
    expect(s.draftContent().classes.progression.curves.steady?.formula).toBe(150);
  });
});

describe("regrowth", () => {
  test("a produce check never takes a node's pair; a check left with none stays a tile check", () => {
    const s = service();
    const v = gatheringView(s);
    expect(v.regrowth.checks.find((c) => c.handler === "DoVeg")?.produce).toBe(true);
    const ice = v.nodes.find((n) => n.node.tile === "1G");
    if (!ice) {
      throw new Error("ice");
    }
    const doVeg = draftGatheringChange(s, ADMIN, {
      op: "node",
      index: ice.index,
      data: { node: ice.node, regrows: "DoVeg" },
      expect: ice.fingerprint,
    });
    expect(doVeg.ok ? "" : doVeg.error).toContain("drops farming produce");
    // Taking CheckIce's only pair leaves it a tile check that changes nothing.
    expect(
      msg(
        draftGatheringChange(s, ADMIN, {
          op: "node",
          index: ice.index,
          data: { node: ice.node, regrows: null },
          expect: ice.fingerprint,
        }),
      ),
    ).toContain("is in the draft");
    const checks = s.draftContent().gather.gathering.regrowth.checks;
    const iceCheck = checks.find((c) => c.handler === "CheckIce");
    expect(iceCheck?.tiles).toEqual([]);
    expect(iceCheck && isProduceCheck(iceCheck)).toBe(false);
    const veg = checks.find((c) => c.handler === "DoVeg");
    expect(veg && isProduceCheck(veg)).toBe(true);
  });

  test("moving a node keeps its old pair while another node still uses it", () => {
    const s = service();
    const v = gatheringView(s);
    const tree = v.nodes.find((n) => n.node.tile === "S3");
    if (!tree) {
      throw new Error("tree");
    }
    // Another node on the same tile pair (a dig, say).
    expect(
      msg(
        draftGatheringChange(s, ADMIN, {
          op: "newNode",
          data: { node: { ...tree.node, can: "Dig" }, regrows: "CheckTrees" },
        }),
      ),
    ).toContain("is in the draft");
    const copy = gatheringView(s).nodes.at(-1);
    expect(
      msg(
        draftGatheringChange(s, ADMIN, {
          op: "node",
          index: copy?.index ?? -1,
          data: { node: { ...tree.node, can: "Dig", tile: "Q9" }, regrows: "CheckTrees" },
          expect: copy?.fingerprint ?? "",
        }),
      ),
    ).toContain("is in the draft");
    const trees = s
      .draftContent()
      .gather.gathering.regrowth.checks.find((c) => c.handler === "CheckTrees");
    expect(trees?.tiles).toContainEqual({ from: "P3", to: "S3" });
    expect(trees?.tiles).toContainEqual({ from: "P3", to: "Q9" });
  });
});

describe("removing a skill", () => {
  test("a reference added after the report refuses the removal", () => {
    const s = service();
    const u = skillUsage(s, "Punch");
    if (!u.ok) {
      throw new Error(u.error);
    }
    const g = s.draftContent().classes.skillGain;
    expect(
      s.draftSet(ADMIN, { dataset: "classes", part: "skillGain", key: null }, "set", {
        ...g,
        weaponSkills: [...g.weaponSkills, { weapon: "Club", match: "exact", skills: ["Punch"] }],
      }).ok,
    ).toBe(true);
    const r = draftSkillRemoval(s, ADMIN, {
      key: "Punch",
      refs: u.value.uses.map((x) => ({ id: x.id, action: "clear" })),
      expect: u.value.fingerprint,
    });
    expect(r.ok ? "" : r.error).toContain("changed since you looked");
  });

  test("skill book formulas are references, cleared or pointed elsewhere; a spaced key cannot be named", () => {
    const s = service();
    const use = s.draftContent().itemRules.use;
    const books = structuredClone(use.skillBooks);
    if (!books[0]) {
      throw new Error("no book");
    }
    books[0].points = [
      { op: "set", value: 1 },
      { when: ["Punch > 5"], op: "add", value: "Punch" },
    ];
    expect(
      s.draftSet(ADMIN, { dataset: "itemRules", part: "use", key: null }, "set", {
        ...use,
        skillBooks: books,
      }).ok,
    ).toBe(true);
    // A pack skill whose key has a space (data a pack may carry; the page makes none).
    expect(
      s.draftSet(ADMIN, { dataset: "classes", part: "skills", key: "Rock Climbing" }, "set", {
        skill: "Rock Climbing",
      }).ok,
    ).toBe(true);
    const u = skillUsage(s, "Punch");
    if (!u.ok) {
      throw new Error(u.error);
    }
    const bookUses = u.value.uses.filter((x) => x.where.includes("a formula row reads it"));
    expect(bookUses.length).toBe(2);
    const choices = (to: string) =>
      u.value.uses.map((x) =>
        bookUses.includes(x)
          ? { id: x.id, action: "replace" as const, to }
          : x.clearable
            ? { id: x.id, action: "clear" as const }
            : { id: x.id, action: "replace" as const, to: "Slash" },
      );
    const spaced = draftSkillRemoval(s, ADMIN, {
      key: "Punch",
      refs: choices("Rock Climbing"),
      expect: u.value.fingerprint,
    });
    expect(spaced.ok ? "" : spaced.error).toContain("a formula cannot name Rock Climbing");
    expect(
      msg(
        draftSkillRemoval(s, ADMIN, {
          key: "Punch",
          refs: choices("Slash"),
          expect: u.value.fingerprint,
        }),
      ),
    ).toContain("will be removed");
    expect(s.draftContent().itemRules.use.skillBooks[0]?.points).toEqual([
      { op: "set", value: 1 },
      { when: ["Slash > 5"], op: "add", value: "Slash" },
    ]);
    expect(s.check()).toEqual([]);
  });

  test("a summon's skilled form becomes null, and a definition's only trained skill takes its list", () => {
    const s = service();
    expect(
      msg(s.draftItemChange(ADMIN, { name: "Rod", op: "create", copyFrom: "Mining Hammer" })),
    ).toContain("Rod");
    const rod = s.itemsView("Rod").item;
    expect(
      msg(
        s.draftItemChange(ADMIN, {
          name: "Rod",
          op: "set",
          data: { ...rod?.form, trains: ["Sorcery"] },
          expect: rod?.fingerprint ?? "",
        }),
      ),
    ).toContain("Rod");
    const u = skillUsage(s, "Sorcery");
    if (!u.ok) {
      throw new Error(u.error);
    }
    const refs = u.value.uses.map((x) =>
      x.clearable
        ? { id: x.id, action: "clear" as const }
        : { id: x.id, action: "replace" as const, to: "Magery" },
    );
    expect(
      msg(draftSkillRemoval(s, ADMIN, { key: "Sorcery", refs, expect: u.value.fingerprint })),
    ).toContain("will be removed");
    const d = s.draftContent();
    expect(d.spells.spells.find((x) => x.name === "Summon Creature")?.summon?.skilled).toBeNull();
    expect(d.items.definitions?.find((x) => x.name === "Rod")?.trains).toBeUndefined();
    expect(s.check()).toEqual([]);
  });
});

describe("the Skills page's discard", () => {
  test("a save of a start value and a place shows pending and is dropped whole; others' edits stay", () => {
    const s = service();
    // Another skill's start value in the same start class row.
    const thrust = skillsView(s, "Thrust").skill;
    expect(
      msg(
        draftSkillChange(s, ADMIN, {
          key: "Thrust",
          op: "set",
          data: { starts: { "1": 25 } },
          expect: thrust?.fingerprint ?? "",
        }),
      ),
    ).toContain("is in the draft");
    const punch = skillsView(s, "Punch").skill;
    expect(punch?.pending).toBe(false);
    expect(
      msg(
        draftSkillChange(s, ADMIN, {
          key: "Punch",
          op: "set",
          data: { starts: { "1": 9 }, order: 1, display: "Boxing" },
          expect: punch?.fingerprint ?? "",
        }),
      ),
    ).toContain("is in the draft");
    const after = skillsView(s, "Punch").skill;
    expect(after?.pending).toBe(true);
    expect(
      msg(
        draftSkillChange(s, ADMIN, {
          key: "Punch",
          op: "discard",
          expect: after?.fingerprint ?? "",
        }),
      ),
    ).toContain("the draft's change is gone");
    const d = s.draftContent().classes;
    expect(d.startClasses.find((x) => x.code === 1)?.skills).toMatchObject({ Thrust: 25 });
    expect(d.startClasses.find((x) => x.code === 1)?.skills.Punch).toBeUndefined();
    expect(d.skills.find((x) => x.skill === "Punch")?.display).toBeUndefined();
    expect(
      s
        .draft()
        .map((r) => `${r.part}/${r.key ?? ""}`)
        .sort(),
    ).toEqual(["startClasses/1"]);
    expect(skillsView(s, "Punch").skill?.pending).toBe(false);
  });
});

describe("a page change as one transaction", () => {
  test("a refused change rolls back every side effect of the rows before it", () => {
    const s = service();
    const v = s.monstersView("Slime").monster;
    expect(
      msg(
        s.draftMonsterChange(ADMIN, {
          name: "Slime",
          op: "set",
          data: { ...v?.form, skillCap: 12 },
          expect: v?.fingerprint ?? "",
        }),
      ),
    ).toContain("is in the draft");
    const before = s.draft();
    // Removing the species drops its draft-only definition too; the next row is refused.
    const r = s.draftChange(ADMIN, [
      { ref: { dataset: "monsters", part: "monsters", key: "Slime" }, op: "remove", data: null },
      { ref: { dataset: "monsters", part: "nothing", key: null }, op: "set", data: {} },
    ]);
    expect(r.ok).toBe(false);
    expect(s.draft()).toEqual(before);
  });
});
