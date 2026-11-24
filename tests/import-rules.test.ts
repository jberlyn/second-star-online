import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { checkImports, importsOf, readSources } from "./import-rules.ts";

const REPO_ROOT = join(import.meta.dir, "..");

describe("import rules", () => {
  test("the repo follows them", () => {
    const files = readSources(REPO_ROOT);
    expect(files.length).toBeGreaterThan(10);
    expect(checkImports(files)).toEqual([]);
  });

  test("parses static, type-only, re-export, side-effect and dynamic imports", () => {
    const refs = importsOf(`
      import { a } from "./a.ts";
      import type { B } from "../b.ts";
      export { c } from "./c.ts";
      import "./side.ts";
      const d = await import("./d.ts");
      // import { e } from "./commented.ts";
    `);
    expect(refs).toEqual([
      { specifier: "./a.ts", typeOnly: false },
      { specifier: "../b.ts", typeOnly: true },
      { specifier: "./c.ts", typeOnly: false },
      { specifier: "./side.ts", typeOnly: false },
      { specifier: "./d.ts", typeOnly: false },
    ]);
  });

  test("catches each kind of violation", () => {
    const rules = checkImports([
      { path: "packages/data/src/x.ts", text: 'import { z } from "zod";' },
      { path: "packages/data/src/y.ts", text: 'import { s } from "../schema/tiles.ts";' },
      { path: "packages/shared/src/x.ts", text: 'import { a } from "@secondstaronline/server";' },
      { path: "packages/client/src/x.ts", text: 'import { a } from "../../server/src/main.ts";' },
      {
        path: "packages/client/src/y.ts",
        text: 'import fixture from "@secondstaronline/data/test-fixtures/npc-expectations";',
      },
      {
        path: "packages/client/src/z.ts",
        text: 'import fixture from "../../data/test-fixtures/npc-expectations.json";',
      },
      { path: "packages/server/src/main.ts", text: 'import { Database } from "bun:sqlite";' },
      {
        path: "packages/server/src/systems/m/a.ts",
        text: 'import { x } from "../../persistence/db.ts";',
      },
      {
        path: "packages/server/src/systems/m/b.ts",
        text: 'import { x } from "../../gateway/server.ts";',
      },
      { path: "packages/server/src/main.ts", text: "Bun.serve({ fetch() {} });" },
      {
        path: "packages/server/src/x.ts",
        text: 'import { a } from "@secondstaronline/perf/src/bot.ts";',
      },
      {
        path: "packages/shared/src/y.ts",
        text: 'import { tilesData } from "@secondstaronline/data";',
      },
      {
        path: "packages/client/src/w.ts",
        text: 'import { classicData } from "@secondstaronline/data/classic";',
      },
      {
        path: "packages/server/src/systems/m/c.ts",
        text: 'import { classicData } from "@secondstaronline/data/classic";',
      },
    ]).map((v) => v.rule);
    expect(rules).toEqual([
      "data/src imports nothing (type-only from data/schema, the packs' JSON, and node:zlib in src/art, allowed)",
      "data/src imports nothing (type-only from data/schema, the packs' JSON, and node:zlib in src/art, allowed)",
      "shared imports only @secondstaronline/data types and zod",
      "client never imports server",
      "client imports only the @secondstaronline/data index",
      "test fixtures are only imported by tests",
      "test fixtures are only imported by tests",
      "only server/src/persistence imports bun:sqlite",
      "systems never import gateway/ or persistence/ (they are passed in)",
      "systems never import gateway/ or persistence/ (they are passed in)",
      "only server/src/gateway touches sockets",
      "nothing imports @secondstaronline/perf",
      "shared imports only @secondstaronline/data types and zod",
      "client imports only the @secondstaronline/data index",
      "only tests and command-line tools import the Classic fixture",
      "only tests and command-line tools import the Classic fixture",
    ]);
  });

  test("allowed imports pass", () => {
    expect(
      checkImports([
        { path: "packages/data/src/x.ts", text: 'import type { T } from "../schema/tiles.ts";' },
        {
          path: "packages/shared/src/x.ts",
          text: 'import type { TilesData } from "@secondstaronline/data";',
        },
        {
          path: "packages/data/src/classic.ts",
          text: 'import items from "../packs/classic/data/items.json" with { type: "json" };',
        },
        {
          path: "packages/server/src/cli/report.ts",
          text: 'import { classicData } from "@secondstaronline/data/classic";',
        },
        {
          path: "packages/server/src/persistence/db.ts",
          text: 'import { Database } from "bun:sqlite";',
        },
        { path: "packages/server/tests/x.test.ts", text: 'import { Database } from "bun:sqlite";' },
        { path: "packages/server/src/gateway/s.ts", text: "Bun.serve({ fetch() {} });" },
      ]),
    ).toEqual([]);
  });
});
