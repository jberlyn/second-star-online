/**
 * Where content is edited (ui/content-areas.ts): every part of every dataset has exactly one
 * Control Panel page, so an operator never has to edit a row as JSON or wonder which page has it.
 */
import { expect, test } from "bun:test";

import { DATASET_SCHEMAS } from "@secondstaronline/data/schema";

import type { AreaTab } from "../src/ui/content-area-page.ts";
import {
  CLASS_TABS,
  COMMUNITY_TABS,
  CRAFT_TABS,
  CREATURE_RULE_TABS,
  GAME_RULE_TABS,
  HOUSE_TABS,
  homeOf,
  ITEM_RULE_TABS,
  QUEST_TABS,
  SPELL_TABS,
} from "../src/ui/content-areas.ts";

test("every content part has a page that edits it", () => {
  const homeless: string[] = [];
  for (const [dataset, schema] of Object.entries(DATASET_SCHEMAS)) {
    if (dataset === "rects") {
      continue;
    }
    for (const part of Object.keys((schema as unknown as { shape: object }).shape)) {
      if (homeOf(dataset, part) === null) {
        homeless.push(`${dataset}/${part}`);
      }
    }
  }
  expect(homeless).toEqual([]);
  // The collision rects are built from the art: no page edits them.
  expect(homeOf("rects", "fx")).toBeNull();
});

test("no part is on two pages", () => {
  const custom: AreaTab = {
    kind: "custom",
    label: "x",
    help: "",
    el: document.createElement("div"),
  };
  const seen = new Map<string, number>();
  for (const tabs of [
    ITEM_RULE_TABS,
    CREATURE_RULE_TABS,
    SPELL_TABS(custom),
    CLASS_TABS,
    CRAFT_TABS,
    HOUSE_TABS(custom),
    QUEST_TABS,
    COMMUNITY_TABS,
    GAME_RULE_TABS,
  ]) {
    for (const t of tabs) {
      const parts = t.kind === "records" ? [t.part] : t.kind === "settings" ? t.parts : [];
      for (const p of parts) {
        const id = `${p.dataset}/${p.part}`;
        seen.set(id, (seen.get(id) ?? 0) + 1);
      }
    }
  }
  expect([...seen].filter(([, n]) => n > 1)).toEqual([]);
});

test("the editor pages' own parts go to their pages", () => {
  expect(homeOf("items", "definitions")).toBe("items");
  expect(homeOf("monsters", "casting")).toBe("monsters");
  expect(homeOf("npcFiles", "files")).toBe("npcs");
  expect(homeOf("balance", "spellEffects")).toBe("spells");
  expect(homeOf("balance", "cannon")).toBe("houses");
  expect(homeOf("balance", "drops")).toBe("balance");
  expect(homeOf("tiles", "catalogue")).toBe("pictures");
  expect(homeOf("spells", "spells")).toBe("spells");
  expect(homeOf("houses", "restRegen")).toBe("houses");
});
