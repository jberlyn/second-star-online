/**
 * The forms drawn from content schemas (ui/schema-form.ts): every part of the Classic pack reads
 * back from its form exactly as it went in, so opening and saving a row never changes what it says.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  DATASET_FILES,
  DATASET_SCHEMAS,
  partJsonSchema,
  type SchemaDatasetId,
} from "@secondstaronline/data/schema";

import { canonical } from "../src/ui/content-area-page.ts";
import { contentWords } from "../src/ui/content-words.ts";
import {
  blank,
  entryTitle,
  FormError,
  fits,
  humanize,
  type JsonSchema,
  schemaForm,
} from "../src/ui/schema-form.ts";

const CONTENT = join(import.meta.dir, "../../data/content");

const schemaOf = (dataset: string, part: string) =>
  (partJsonSchema(dataset as SchemaDatasetId, part) ?? {}) as JsonSchema;

test("every Classic part reads back from its form unchanged", () => {
  const checked: string[] = [];
  for (const [dataset, schema] of Object.entries(DATASET_SCHEMAS)) {
    if (dataset === "rects" || dataset === "art") {
      continue;
    }
    const file = join(CONTENT, `${DATASET_FILES[dataset as keyof typeof DATASET_FILES]}.json`);
    const data = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    const shape = (schema as unknown as { shape: Record<string, unknown> }).shape;
    for (const part of Object.keys(shape)) {
      if (data[part] === undefined) {
        continue;
      }
      const form = schemaForm(schemaOf(dataset, part), data[part], contentWords(dataset, part), {
        id: "test",
      });
      expect(`${dataset}/${part}:${canonical(form.value())}`).toBe(
        `${dataset}/${part}:${canonical(data[part])}`,
      );
      // Every value has a control of its own: nothing is left as a value you can't change.
      expect(`${dataset}/${part}:${form.el.querySelectorAll(".schema-form-kept").length}`).toBe(
        `${dataset}/${part}:0`,
      );
      checked.push(`${dataset}/${part}`);
    }
  }
  expect(checked.length).toBeGreaterThan(90);
});

test("a form shows no JSON: every value has a control of its own", () => {
  const data = JSON.parse(readFileSync(join(CONTENT, "spells.json"), "utf8")) as {
    spells: unknown[];
  };
  const form = schemaForm(
    schemaOf("spells", "spells"),
    data.spells,
    contentWords("spells", "spells"),
    { id: "test" },
  );
  expect(form.el.querySelectorAll(".schema-form-kept").length).toBe(0);
  expect(form.el.textContent).not.toContain("{");
});

test("a number out of its limits, or not whole, does not read", () => {
  const schema: JsonSchema = {
    type: "object",
    properties: { n: { type: "integer", minimum: 1, maximum: 9 } },
    required: ["n"],
    additionalProperties: false,
  };
  const words = contentWords("balance", "x");
  const form = schemaForm(schema, { n: 3 }, words, { id: "t" });
  expect(form.value()).toEqual({ n: 3 });
  const input = form.el.querySelector("input") as HTMLInputElement;
  input.value = "12";
  expect(() => form.value()).toThrow(FormError);
  input.value = "2.5";
  expect(() => form.value()).toThrow("whole number");
  input.value = "4";
  expect(form.value()).toEqual({ n: 4 });
});

test("an optional field is ticked on and off; a list's entries are added, moved and removed", () => {
  const schema: JsonSchema = {
    type: "object",
    properties: {
      note: { anyOf: [{ type: "string" }, { type: "null" }] },
      tags: { type: "array", items: { type: "string" } },
    },
    required: ["note", "tags"],
    additionalProperties: false,
  };
  const form = schemaForm(schema, { note: null, tags: ["a", "b"] }, contentWords("x", "y"), {
    id: "t",
  });
  const tick = form.el.querySelector<HTMLInputElement>("[data-action='t-set']");
  const toggle = () => {
    if (tick) {
      tick.checked = !tick.checked;
      tick.dispatchEvent(new Event("change"));
    }
  };
  toggle();
  expect(form.value()).toEqual({ note: "", tags: ["a", "b"] });
  toggle();
  expect(form.value()).toEqual({ note: null, tags: ["a", "b"] });
  form.el.querySelectorAll<HTMLButtonElement>("[data-action='t-down']")[0]?.click();
  expect(form.value()).toEqual({ note: null, tags: ["b", "a"] });
  form.el.querySelector<HTMLButtonElement>("[data-action='t-add']")?.click();
  expect(form.value()).toEqual({ note: null, tags: ["b", "a", ""] });
  form.el.querySelectorAll<HTMLButtonElement>("[data-action='t-remove-entry']")[0]?.click();
  expect(form.value()).toEqual({ note: null, tags: ["a", ""] });
});

test("a value of several shapes keeps its shape, and picking another starts it blank", () => {
  const schema: JsonSchema = {
    anyOf: [{ type: "integer" }, { type: "array", items: { type: "integer" } }],
  };
  const form = schemaForm(schema, [1, 2], contentWords("x", "y"), { id: "t" });
  expect(form.value()).toEqual([1, 2]);
  const pick = form.el.querySelector<HTMLSelectElement>("[data-action='t-shape']");
  if (pick) {
    pick.value = "0";
    pick.dispatchEvent(new Event("change"));
  }
  expect(form.value()).toBe(0);
});

test("plain words: keys, entry titles, blanks and shapes", () => {
  expect(humanize("periodFrames")).toBe("Period frames");
  expect(humanize("npcSpawn")).toBe("NPC spawn");
  expect(entryTitle({ name: "Firebolt", sp: 3 }, 0)).toBe("Firebolt");
  expect(entryTitle({ sp: 3 }, 4)).toBe("SP 3");
  expect(entryTitle({ on: true }, 4)).toBe("Entry 5");
  expect(entryTitle({ roll: 1, npc: "Water God" }, 0)).toBe("Water God");
  expect(entryTitle({ roll: 1, wants: "scroll" }, 0)).toBe("scroll");
  expect(entryTitle({ faces: [1, 1, 1], bonus: 50 }, 0)).toBe("Faces 1, 1, 1 · Bonus 50");
  expect(blank({ type: "integer", minimum: 5 })).toBe(5);
  expect(
    blank({
      type: "object",
      properties: { a: { type: "string" }, b: { type: "boolean" } },
      required: ["a"],
    }),
  ).toEqual({ a: "" });
  expect(fits({ type: "object", properties: { k: { const: "x" } } }, { k: "y" })).toBe(false);
});

test("RuneScape-style recipes: a level, a chance by level and set recipes read back in plain words", () => {
  const data = JSON.parse(readFileSync(join(CONTENT, "craft.json"), "utf8")) as {
    stations: {
      cook: { recipes: Record<string, unknown>[] };
      build: Record<string, unknown>;
    };
  };
  const st = data.stations;
  st.cook.recipes[0] = {
    ...st.cook.recipes[0],
    requires: { needs: "cooking", atLeast: 15 },
    odds: [
      { level: 15, percent: 40.5 },
      { level: 68, percent: 100 },
    ],
  };
  st.build.recipes = [
    {
      input: "Logs",
      output: "Crate",
      xp: 25,
      requires: { needs: "carpentry", atLeast: 10 },
      odds: [{ level: 10, percent: 100 }],
    },
  ];
  const form = schemaForm(schemaOf("craft", "stations"), st, contentWords("craft", "stations"), {
    id: "test",
  });
  expect(canonical(form.value())).toBe(canonical(st));
  const text = form.el.textContent ?? "";
  expect(text).toContain("Chance of success by skill");
  expect(text).toContain("Set recipes");
  expect(text).toContain("Skill needed");
});

test("a recipe's form groups its fields under tabs, and reads back unchanged (issue #45)", () => {
  const schema = schemaOf("craft", "recipes") as JsonSchema & { items?: JsonSchema };
  const recipe = {
    name: "Iron Dagger",
    station: "Forge",
    category: "Daggers",
    materials: [{ item: "Chunk of Iron", qty: 2 }],
    tier: 2,
    skill: "Blacksmithing",
    level: 10,
    xp: 25,
    odds: [{ level: 10, percent: 50 }],
    time: [{ level: 0, frames: 100 }],
    output: { item: "Dagger", qty: 1 },
  };
  const form = schemaForm(schema.items ?? schema, recipe, contentWords("craft", "recipes"));
  const tabs = [...form.el.querySelectorAll<HTMLElement>(".schema-form-tabs [role=tab]")];
  expect(tabs.map((t) => t.textContent)).toEqual([
    "Recipe",
    "Materials",
    "Tool",
    "Skill",
    "Odds",
    "Output",
  ]);
  const panes = [...form.el.querySelectorAll<HTMLElement>(".schema-form-tab")];
  expect(panes.map((p) => p.hidden)).toEqual([false, true, true, true, true, true]);
  tabs[4]?.click();
  expect(panes.map((p) => p.hidden)).toEqual([true, true, true, true, false, true]);
  expect(canonical(form.value())).toBe(canonical(recipe));
});

test("an object with nothing under More options shows no empty fold", () => {
  const form = schemaForm(
    {
      type: "object",
      properties: { level: { type: "integer" }, percent: { type: "number" } },
      required: ["level", "percent"],
    },
    { level: 1, percent: 50 },
    contentWords("craft", "recipes"),
  );
  expect(form.el.querySelector(".schema-form-more")).toBeNull();
});
