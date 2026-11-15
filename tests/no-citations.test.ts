import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { checkSources, readSources } from "./no-citations.ts";

describe("public source hygiene", () => {
  test("the published source has no development references", () => {
    expect(checkSources(readSources(join(import.meta.dir, "..")))).toEqual([]);
  });
  test("rejects citations, private paths, old click IDs and provenance imports in code or prose", () => {
    for (const text of [
      "Foo.ls:12",
      "archive/private",
      "decompiled/foo",
      "docs/research/data",
      "score:main:3:4",
      "data-orig",
      "@secondstaronline/data/prov",
      "8h.3",
      "REL-08",
      "DIVERGENCES",
      "BUG_LEDGER.md",
      "agent/scratch/foo",
      "docs/workflow/README.md",
    ]) {
      expect(checkSources([{ path: "content.json", text }]).length).toBeGreaterThan(0);
    }
  });
  test("rejects handler, spec, research and stylesheet citations", () => {
    for (const [path, text] of [
      ["x.sql", "CreateUser:396"],
      ["x.css", "OtherHandler:42"],
      ["x.ts", "sound.md §1.5"],
      ["x.sql", "research record"],
      ["x.css", "Internal #203"],
    ] as const) {
      expect(checkSources([{ path, text }]).length).toBeGreaterThan(0);
    }
  });
  test("rejects quoted source statements while allowing useful art names", () => {
    for (const text of [
      ["`repeat", "with sample = 1 to 2`"].join(" "),
      ["`if sample > 2", "then exit`"].join(" "),
      ["`sprite(2)", ".visible = 0`"].join(""),
      ["`go(", "the frame)`"].join(""),
      ["`myName", '= "Example"`'].join(" "),
      ["`integer(", "item 2)`"].join(""),
      ["`contains", '"Example"`'].join(" "),
    ]) {
      expect(checkSources([{ path: "x.ts", text }]).length).toBeGreaterThan(0);
    }
    expect(
      checkSources([{ path: "x.ts", text: "The icon is Internal #118 at its native size." }]),
    ).toEqual([]);
  });
  test("permits ordinary original-art references and game prose", () => {
    expect(
      checkSources([
        {
          path: "guide.md",
          text: "The original art is in assets/original/ and 1.6 had this behavior.",
        },
      ]),
    ).toEqual([]);
  });
});
