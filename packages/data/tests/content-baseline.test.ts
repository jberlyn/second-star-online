import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  findMissingBaseline,
  fingerprintRows,
  listsOf,
  type OriginalsFile,
  type RowFingerprint,
} from "../build/content-baseline.ts";

const DATA_DIR = join(import.meta.dir, "..");
const originals = JSON.parse(
  readFileSync(join(import.meta.dir, "content-baseline.json"), "utf8"),
) as OriginalsFile;

// content-baseline.json holds a fingerprint (the key, and the first 16 hex of the SHA-256 of the row's
// JSON with keys sorted) of every row of every list in the content files as 1.6 shipped them.
// A forker may add rows anywhere; the 1.6 rows must stay, unchanged and in order.
const byFile = new Map<string, Map<string, RowFingerprint[]>>();
for (const [id, rows] of Object.entries(originals)) {
  const [file = "", path = ""] = id.split("#");
  const lists = byFile.get(file) ?? new Map<string, RowFingerprint[]>();
  lists.set(path, rows);
  byFile.set(file, lists);
}

describe("content baseline", () => {
  for (const [file, lists] of byFile) {
    test(`every baseline row of ${file} is still there, unchanged and in order (content-baseline.json)`, () => {
      const content = JSON.parse(readFileSync(join(DATA_DIR, "content", file), "utf8"));
      const now = listsOf(content);
      for (const [path, expected] of lists) {
        const rows = now.get(path) ?? [];
        const missing = findMissingBaseline(expected, rows);
        expect(
          missing,
          missing
            ? `${file}#${path}: "${missing.key}" (row ${missing.index}) is missing or changed`
            : "",
        ).toBeNull();
      }
    });
  }

  test("the fingerprint file covers every content file", () => {
    expect([...byFile.keys()].sort()).toEqual(
      [
        "attpower.json",
        "casino.json",
        "classes.json",
        "craft.json",
        "gather.json",
        "help.json",
        "houses.json",
        "item-rules.json",
        "items.json",
        "monsters.json",
        "npc-files.json",
        "quests.json",
        "social.json",
        "spells.json",
        "tiles.json",
      ].sort(),
    );
  });
});

describe("findMissingBaseline", () => {
  const original = [
    { name: "A", v: 1 },
    { name: "B", v: 2 },
    { name: "C", v: 3 },
  ];
  const prints = fingerprintRows(original);

  test("rows added at the start, middle and end pass", () => {
    const x = { name: "X", v: 9 };
    expect(findMissingBaseline(prints, [x, ...original])).toBeNull();
    expect(findMissingBaseline(prints, [original[0], x, original[1], original[2]])).toBeNull();
    expect(findMissingBaseline(prints, [...original, x])).toBeNull();
  });

  test("a changed, removed or reordered original row fails with its key", () => {
    expect(findMissingBaseline(prints, [original[0], { name: "B", v: 99 }, original[2]])).toEqual({
      index: 1,
      key: "B",
    });
    expect(findMissingBaseline(prints, [original[0], original[2]])).toEqual({ index: 1, key: "B" });
    expect(findMissingBaseline(prints, [original[1], original[0], original[2]])?.key).toBe("B");
  });

  test("key order inside a row does not matter", () => {
    expect(findMissingBaseline(prints, [{ v: 1, name: "A" }, ...original.slice(1)])).toBeNull();
  });
});
