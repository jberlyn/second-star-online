/**
 * Spells as content (#37 stage 4): a spell's own school and power, the bounds on its power, and
 * what happens to a live effect whose spell a publish removed.
 */
import { describe, expect, test } from "bun:test";

import { classicData } from "@secondstaronline/data/classic";

import { buildContentStore, type ContentData, installContent } from "../../src/content/store.ts";
import { editValueText } from "../../src/rules/admin/character-edit.ts";
import { NO_EQUIPMENT, NO_FACTION, skillIndex } from "../../src/rules/core/fighter.ts";
import type { Rng } from "../../src/rules/core/lingo.ts";
import { newFx, stepFx } from "../../src/rules/spells/spellfx.ts";
import { MAX_SPELL_POWER, spellImp, spellPower } from "../../src/rules/spells/spells.ts";

function withContent(change: (d: ContentData) => void, body: () => void): void {
  const d = structuredClone(classicData) as ContentData;
  change(d);
  installContent(buildContentStore(d));
  try {
    body();
  } finally {
    installContent(buildContentStore(classicData as ContentData));
  }
}

const always: Rng = { random: () => 1 };
const skills = (values: Record<string, number>) => {
  const out = classicData.classes.skills.map(() => 0);
  for (const [k, v] of Object.entries(values)) {
    out[skillIndex(k)] = v;
  }
  return out;
};

describe("spells as content", () => {
  test("spell power stays from 0 to its cap, whatever the rows say", () => {
    withContent(
      (d) => {
        d.spells.power.tables.Fire = { tiers: [{ when: null, op: "set", value: -100 }] };
        d.spells.power.tables.Water = { tiers: [{ when: null, op: "set", value: 99999 }] };
        d.spells.power.tables.Wind = {
          tiers: Array.from({ length: 5 }, () => ({
            when: null,
            op: "add" as const,
            value: 99999,
          })),
        };
      },
      () => {
        const c = { skills: skills({}), equip: NO_EQUIPMENT, faction: NO_FACTION };
        // A negative power would make Firebolt (no defence floor) heal its target.
        expect(spellPower("Firebolt", c)).toBe(0);
        expect(spellPower("Splash", c)).toBe(99999);
        expect(spellPower("Whirlwind", c)).toBe(MAX_SPELL_POWER);
      },
    );
  });

  test("a spell running another spell's effect trains its own school", () => {
    withContent(
      (d) => {
        const food = d.spells.spells.find((s) => s.name === "Create Food");
        if (food) {
          d.spells.spells.push({
            ...structuredClone(food),
            name: "Summon Bread",
            id: null,
            book: null,
            school: { skill: "Sorcery", line: "Bread!" },
            creates: [{ item: "Bread" }],
            fx: [],
          });
        }
      },
      () => {
        // The cast runs Create Food's FX; the school is Summon Bread's.
        const s = skills({ Magery: 0, Sorcery: 5 });
        expect(spellImp("Create Food", s, NO_FACTION, always, "Summon Bread")).toEqual(["Bread!"]);
        // Create Food itself has no school.
        expect(spellImp("Create Food", skills({ Sorcery: 5 }), NO_FACTION, always)).toEqual([]);
      },
    );
  });

  test("an effect whose spell a publish removed ends at its next step", () => {
    const fx = newFx("FireballR", { h: 200, v: 200 });
    stepFx(fx);
    expect(fx.gone).toBe(false);
    withContent(
      (d) => {
        d.spells.spells = d.spells.spells.filter((s) => s.name !== "Fireball");
      },
      () => {
        stepFx(fx);
        expect(fx.gone).toBe(true);
      },
    );
  });

  test("the character editor's log shows no faction as None", () => {
    expect(editValueText("faction", null)).toBe("None");
    expect(editValueText("faction", "mage")).toBe("Mage");
  });
});
