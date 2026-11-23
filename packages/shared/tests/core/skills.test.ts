/** Skills by key (#37 stage 1): the lookups the rules and the server's saves use. */
import { describe, expect, test } from "bun:test";

import { classicData } from "@secondstaronline/data/classic";

import { buildContentStore, type ContentData, installContent } from "../../src/content/store.ts";
import {
  boundSkillIndex,
  boundSkillValue,
  SKILL_KEYS,
  skillDisplay,
  skillIndex,
  skillsByKey,
  skillsFromKeys,
  skillValue,
} from "../../src/rules/core/fighter.ts";

describe("skills by key", () => {
  test("values by key become the list in the content's order, and back", () => {
    const list = skillsFromKeys({ Slash: 20, Archery: 9 });
    expect(list).toHaveLength(SKILL_KEYS.length);
    expect([list[skillIndex("Slash")], list[skillIndex("Archery")], list[1]]).toEqual([20, 9, 1]);
    expect(skillsByKey(list).Archery).toBe(9);
    expect(Object.keys(skillsByKey(list))).toEqual([...SKILL_KEYS]);
  });

  test("the exact key wins over another spelling of it, whatever order they come in", () => {
    expect(skillsFromKeys({ slash: 3, Slash: 7 })[skillIndex("Slash")]).toBe(7);
    expect(skillsFromKeys({ Slash: 7, slash: 3 })[skillIndex("Slash")]).toBe(7);
    // With no exact key, the other spelling is read.
    expect(skillsFromKeys({ "Martial Arts": 4 })[skillIndex("MartialArts")]).toBe(4);
  });

  test("a skill the world does not have reads 0; a bound skill reads through its binding", () => {
    const list = skillsFromKeys({ Parry: 12 });
    expect(skillValue(list, "Swimming")).toBe(0);
    expect(boundSkillIndex("parry")).toBe(skillIndex("Parry"));
    expect(boundSkillValue(list, "parry")).toBe(12);
  });

  test("a skill is shown by its display name, else its key", () => {
    expect(skillDisplay("HeavyArms")).toBe("Heavy Arms");
    expect(skillDisplay("fire")).toBe("Fire");
    expect(skillDisplay("Slash")).toBe("Slash");
    expect(skillDisplay("Swimming")).toBe("Swimming");
  });

  test("a binding the world leaves out reads as none", () => {
    const d = structuredClone(classicData) as ContentData;
    d.bindings.skills = { block: "Block" };
    installContent(buildContentStore(d));
    try {
      const list = skillsFromKeys({ Parry: 12, Block: 5 });
      expect(boundSkillIndex("parry")).toBeUndefined();
      expect(boundSkillValue(list, "parry")).toBe(0);
      expect(boundSkillValue(list, "block")).toBe(5);
    } finally {
      installContent(buildContentStore(classicData));
    }
  });
});
