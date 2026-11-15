import { expect, test } from "bun:test";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

test("system folders and guides correspond, with index and client guides present", () => {
  const roots = ["packages/server/src/systems", "packages/shared/src/rules"];
  const folders = new Set(
    roots.flatMap((root) =>
      readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name),
    ),
  );
  const directory = "docs/guides";
  const guides = new Set(
    readdirSync(directory)
      .filter((name) => name.endsWith(".md"))
      .map((name) => name.slice(0, -3))
      .filter((name) => name !== "README" && name !== "client"),
  );
  const missing = [...folders].filter((name) => !guides.has(name)).sort();
  const orphan = [...guides].filter((name) => !folders.has(name)).sort();
  expect({ missing, orphan }).toEqual({ missing: [], orphan: [] });
  for (const name of ["README", "client"]) {
    expect(statSync(join(directory, `${name}.md`)).isFile()).toBe(true);
  }
});
