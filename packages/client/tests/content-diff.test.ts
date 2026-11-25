/**
 * A pack update's notice on the Publish Changes page names what changed in plain words
 * (ui/content-diff.ts), one line per value, as the row's form names it, instead of a JSON diff.
 */
import { describe, expect, test } from "bun:test";

import { phrase, plainChanges } from "../src/ui/content-diff.ts";

describe("what changed, in plain words", () => {
  test("a changed number is named by its form's label, old → new", () => {
    expect(plainChanges("casino", "slots", { cost: 10 }, { cost: 12 })).toEqual([
      { where: "Cost of a spin (gold)", what: "10 → 12" },
    ]);
  });

  test("a list told apart by names says what was added and removed", () => {
    const was = { name: "Orc", drops: [{ item: "Bone" }, { item: "Club" }] };
    const now = { name: "Orc", drops: [{ item: "Bone" }, { item: "Gold Ring" }] };
    const lines = plainChanges("monsters", "monsters", was, now).map((c) => c.what);
    expect(lines).toContain("added Gold Ring");
    expect(lines).toContain("removed Club");
  });

  test("a list put in another order says so, and nothing else", () => {
    const lines = plainChanges(
      "monsters",
      "monsters",
      { drops: [{ item: "A" }, { item: "B" }] },
      { drops: [{ item: "B" }, { item: "A" }] },
    );
    expect(lines.map((c) => c.what)).toEqual(["put in another order"]);
  });

  test("a value set or taken out, and yes/no and text read as words", () => {
    const lines = plainChanges(
      "items",
      "items",
      { name: "Ale", gone: 1, flag: true, note: "x" },
      { name: "Ale", flag: false, note: "", extra: "y" },
    ).map((c) => c.what);
    expect(lines).toEqual(["taken out", "yes → no", "“x” → (empty)", "set to “y”"]);
  });

  test("the same value gives nothing; the limit caps the lines", () => {
    expect(plainChanges("items", "items", { a: 1 }, { a: 1 })).toEqual([]);
    expect(
      plainChanges("items", "items", { a: 1, b: 2, c: 3 }, { a: 2, b: 3, c: 4 }, 2),
    ).toHaveLength(2);
  });

  test("a value is one short phrase", () => {
    expect(phrase(null)).toBe("none");
    expect(phrase([])).toBe("an empty list");
    expect(phrase([1, 2])).toBe("a list of 2");
    expect(phrase({ a: 1 })).toBe("a group of settings");
    expect(phrase("x".repeat(80))).toBe(`“${"x".repeat(57)}…”`);
  });
});
