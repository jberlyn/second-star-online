import { expect, test } from "bun:test";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

test("README files use their conventional name, other Markdown files use lowercase hyphenated names, and Compose uses the default filename", () => {
  const bad: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (["node_modules", ".tsbuild", "dist", ".git", "perf-results"].includes(name)) {
        continue;
      }
      const path = join(dir, name);
      if (path === "packages/data/assets") {
        continue;
      }
      if (statSync(path).isDirectory()) {
        walk(path);
      } else if (name.toLowerCase() === "readme.md" && name !== "README.md") {
        bad.push(path);
      } else if (
        name.endsWith(".md") &&
        !["AGENTS.md", "CLAUDE.md", "README.md"].includes(name) &&
        (name !== name.toLowerCase() || name.includes("_"))
      ) {
        bad.push(path);
      }
    }
  };
  walk(".");
  expect(bad).toEqual([]);
  expect(existsSync("docker-compose.yml")).toBe(true);
  expect(existsSync("compose.yaml")).toBe(false);
  expect(existsSync("agent")).toBe(false);
  expect(existsSync("docs/workflow")).toBe(false);
});
