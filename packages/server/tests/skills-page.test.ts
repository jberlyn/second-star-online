/**
 * Issue #38: the Skills page on the server. The list in Skills-page order, one skill's form (name
 * and place, start values, promotions, progression, curve), what trains it, saves as one change
 * with stale refusals and refusals of new problems, new skills, and removal through the where-used
 * flow (references cleared or pointed elsewhere, characters' values kept, bindings refuse).
 */
import { afterAll, describe, expect, test } from "bun:test";

import { RELEASE_PACK_DIRS } from "@secondstaronline/data/packs";
import { content, installContent, skillPageOrder } from "@secondstaronline/shared";

import { contentIntent } from "../src/content/page.ts";
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

describe("the Skills page's view", () => {
  test("lists the skills in Skills-page order with what trains the open one", () => {
    const s = service();
    const v = skillsView(s, "slash");
    expect(v.skills.map((x) => x.skill)).toEqual(content().classes.skills.map((x) => x.skill));
    expect(v.skills.find((x) => x.skill === "Meditation")?.hidden).toBe(true);
    const slash = v.skill;
    expect(slash?.skill).toBe("Slash");
    expect(slash?.order).toBe(1);
    // Fighter (class 1) starts with Slash 20.
    expect(slash?.starts.find((x) => x.code === 1)?.value).toBe(20);
    expect(slash?.trains.some((t) => t.kind === "weapon")).toBe(true);
    // Grunt's promotion needs Slash; Thrust's progression requires it.
    expect(slash?.trains.some((t) => t.kind === "promotion")).toBe(true);
    expect(slash?.trains.some((t) => t.text.includes("Thrust's kill progression"))).toBe(true);
    const fishing = skillsView(s, "Fishing").skill;
    expect(fishing?.bindings).toEqual(["fishing"]);
    expect(fishing?.trains.some((t) => t.kind === "fishing")).toBe(true);
    const thrust = skillsView(s, "Thrust").skill;
    expect(thrust?.promotions.find((p) => p.name === "Grunt")?.grants).toBe(true);
  });
});

describe("Skills page changes", () => {
  test("a save writes the skill, its start values, grants and place as one change; published, it plays", () => {
    const s = service();
    try {
      const v = skillsView(s, "Punch").skill;
      if (!v) {
        throw new Error("Punch");
      }
      const r = draftSkillChange(s, ADMIN, {
        key: "Punch",
        op: "set",
        data: {
          display: "Boxing",
          order: 1,
          starts: { "1": 15 },
          grants: [4],
        },
        expect: v.fingerprint,
      });
      expect(r.ok ? r.value : r.error).toBe("Punch is in the draft.");
      expect(
        s
          .draft()
          .map((d) => `${d.part}/${d.key ?? ""}`)
          .sort(),
      ).toEqual(["classes/4", "skillOrder/", "skills/Punch", "startClasses/1"]);
      expect(s.publish(ADMIN, s.draftRev(), "").ok).toBe(true);
      const c = content().classes;
      expect(skillPageOrder(c)[0]?.skill).toBe("Punch");
      expect(c.skills.find((x) => x.skill === "Punch")?.display).toBe("Boxing");
      expect(c.startClasses.find((x) => x.code === 1)?.skills.Punch).toBe(15);
      expect(c.classes.find((x) => x.code === 4)?.promotion?.skillGrants).toContain("Punch");
      // The fingerprint the page had is stale now.
      const stale = draftSkillChange(s, ADMIN, {
        key: "Punch",
        op: "set",
        data: { hidden: true },
        expect: v.fingerprint,
      });
      expect(stale.ok ? "" : stale.error).toContain("changed since you opened it");
    } finally {
      installContent(classic);
    }
  });

  test("a change that brings a new problem is refused, and the draft is as it was", () => {
    const s = service();
    const v = skillsView(s, "Thrust").skill;
    if (!v) {
      throw new Error("Thrust");
    }
    // An xp model naming a curve the world does not have.
    const bad = draftSkillChange(s, ADMIN, {
      key: "Thrust",
      op: "set",
      data: { progression: { model: "xp", curve: "nowhere" } },
      expect: v.fingerprint,
    });
    expect(bad.ok).toBe(false);
    expect(s.draft()).toEqual([]);
    // A formula reading a name nothing defines.
    const formula = draftSkillChange(s, ADMIN, {
      key: "Thrust",
      op: "set",
      data: {
        progression: {
          model: "chance",
          on: { kill: { roll: [{ op: "set", value: "nonsense" }] } },
        },
      },
      expect: v.fingerprint,
    });
    expect(formula.ok).toBe(false);
    expect(formula.ok ? [] : (formula.problems ?? []).map((p) => p.where)).toContain(
      "Progression (kill): roll row 1",
    );
    expect(s.draft()).toEqual([]);
    const same = draftSkillChange(s, ADMIN, {
      key: "Thrust",
      op: "set",
      data: {},
      expect: v.fingerprint,
    });
    expect(same.ok ? "" : same.error).toContain("nothing to save");
  });

  test("a new skill gets a permanent key, an xp model and its curve; discarding it takes its rows", () => {
    const s = service();
    const r = draftSkillChange(s, ADMIN, {
      key: "Swimming",
      op: "create",
      data: {
        display: "Swimming",
        progression: { model: "xp", curve: "swim", on: { gather: { xp: 10 } } },
        curve: {
          name: "swim",
          expect: null,
          curve: { counting: "perLevel", formula: 100, cap: 50 },
        },
        starts: { "1": 1 },
      },
    });
    expect(r.ok ? r.value : r.error).toBe("Swimming is in the draft.");
    const v = skillsView(s, "Swimming");
    expect(v.skills.at(-1)?.skill).toBe("Swimming");
    expect(v.skills.at(-1)?.model).toBe("xp");
    expect(v.skill?.curve?.curve.cap).toBe(50);
    expect(v.skill?.published).toBe(false);
    const again = draftSkillChange(s, ADMIN, { key: "swimming", op: "create", data: {} });
    expect(again.ok ? "" : again.error).toContain("already a skill");
    const bad = draftSkillChange(s, ADMIN, { key: "1bad", op: "create", data: {} });
    expect(bad.ok).toBe(false);
    const gone = draftSkillChange(s, ADMIN, {
      key: "Swimming",
      op: "discard",
      expect: v.skill?.fingerprint ?? "",
    });
    expect(gone.ok ? gone.value : gone.error).toContain("the draft's change is gone");
    expect(s.draftContent().classes.skills.some((x) => x.skill === "Swimming")).toBe(false);
    expect(s.draftContent().classes.startClasses.find((x) => x.code === 1)?.skills.Swimming).toBe(
      undefined,
    );
  });

  test("the Content page's JSON editor and the Skills page share a skill's revision", () => {
    const s = service();
    const v = skillsView(s, "Slash").skill;
    const row = contentIntent(s, ADMIN, {
      t: "contentRow",
      seq: 1,
      dataset: "classes",
      part: "skills",
      key: "Slash",
    });
    expect(row.t === "contentRow" ? row.row?.revision : null).toBe(v?.fingerprint);
    // The JSON editor saves with the revision it saw; then the page's is stale.
    const saved = contentIntent(s, ADMIN, {
      t: "contentDraft",
      seq: 2,
      dataset: "classes",
      part: "skills",
      key: "Slash",
      op: "set",
      data: { skill: "Slash", display: "Slashing" },
      expect: v?.fingerprint,
    });
    expect(saved.t === "contentResult" && saved.ok).toBe(true);
    const r = draftSkillChange(s, ADMIN, {
      key: "Slash",
      op: "set",
      data: { hidden: true },
      expect: v?.fingerprint ?? "",
    });
    expect(r.ok).toBe(false);
  });
});

describe("removing a skill", () => {
  test("lists every reference and the characters; a binding refuses it", () => {
    const s = service();
    const u = skillUsage(s, "Fishing");
    expect(u.ok && u.value.bindings).toEqual(["fishing"]);
    const fp = u.ok ? u.value.fingerprint : "";
    const r = draftSkillRemoval(s, ADMIN, { key: "Fishing", refs: [], expect: fp });
    expect(r.ok ? "" : r.error).toContain("binding");
    const slash = skillUsage(s, "Slash", {
      skillHolders: (k: string) => (k === "Slash" ? 7 : 0),
    } as never);
    if (!slash.ok) {
      throw new Error(slash.error);
    }
    expect(slash.value.characters).toBe(7);
    const wheres = slash.value.uses.map((x) => x.where);
    expect(wheres.some((w) => w.startsWith("Start class 1"))).toBe(true);
    expect(wheres.some((w) => w.includes("Thrust's progression (kill): its requirement"))).toBe(
      true,
    );
    // Grunt's promotion requirement can only be pointed elsewhere.
    expect(
      slash.value.uses.find((x) => x.where.includes("Promotion to Grunt: needs it"))?.clearable,
    ).toBe(false);
  });

  test("each reference is cleared or pointed at another skill; published, the skill is gone", () => {
    const s = service();
    try {
      const u = skillUsage(s, "Slash");
      if (!u.ok) {
        throw new Error(u.error);
      }
      const fp = u.value.fingerprint;
      // Without a choice for a reference that cannot be cleared, it is refused.
      // Every use needs a choice; one that cannot be cleared is refused when cleared.
      const none = draftSkillRemoval(s, ADMIN, { key: "Slash", refs: [], expect: fp });
      expect(none.ok ? "" : none.error).toContain("Choose what happens to every use");
      const allClear = u.value.uses.map((x) => ({ id: x.id, action: "clear" as const }));
      const refused = draftSkillRemoval(s, ADMIN, { key: "Slash", refs: allClear, expect: fp });
      expect(refused.ok ? "" : refused.error).toContain("only pointed at another skill");
      const refs = u.value.uses.map((x) =>
        x.clearable
          ? { id: x.id, action: "clear" as const }
          : { id: x.id, action: "replace" as const, to: "Thrust" },
      );
      // Thrust's own requirement of Slash goes elsewhere: Punch.
      const req = u.value.uses.find((x) => x.where.includes("Thrust's progression"));
      const choices = refs.map((r) =>
        r.id === req?.id ? { id: r.id, action: "replace" as const, to: "Punch" } : r,
      );
      const r = draftSkillRemoval(s, ADMIN, { key: "Slash", refs: choices, expect: fp });
      expect(r.ok ? r.value : `${r.error} ${JSON.stringify(r.ok ? [] : r.problems)}`).toContain(
        "will be removed when the draft is published",
      );
      expect(s.check()).toEqual([]);
      expect(s.publish(ADMIN, s.draftRev(), "").ok).toBe(true);
      const c = content().classes;
      expect(c.skills.some((x) => x.skill === "Slash")).toBe(false);
      expect(c.startClasses.some((x) => "Slash" in x.skills)).toBe(false);
      expect(c.classes.find((x) => x.name === "Grunt")?.promotion?.requirement.stat).toBe("Thrust");
      const thrust = c.skills.find((x) => x.skill === "Thrust")?.progression;
      expect(
        thrust?.model === "chance" && thrust.on?.kill ? thrust.on.kill.requires?.skill : null,
      ).toBe("Punch");
      expect(
        c.skillGain.weaponSkills.every((w) => !w.skills.includes("Slash") && w.skills.length > 0),
      ).toBe(true);
    } finally {
      installContent(classic);
    }
  });
});
