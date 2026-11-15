import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("the script reference lists every root package script", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
    scripts: Record<string, string>;
  };
  const docs = readFileSync("docs/scripts.md", "utf8");
  const missing = Object.keys(pkg.scripts).filter(
    (name) => !docs.includes(`\`bun run ${name}\``) && !docs.includes(`\`bun run ${name} `),
  );
  expect(missing).toEqual([]);
});

test("deployment guidance states current WebSocket Origin behavior", () => {
  const guide = readFileSync("docs/running-a-server.md", "utf8");
  expect(guide).toContain("accepts WebSocket connections from any `Origin`");
  expect(guide).toContain("enforce it at the reverse proxy");
});
