/**
 * Checks that `docs/running-a-server.md` documents every current server setting key and every
 * privileged in-game command as exact backticked tokens.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { SETTINGS } from "../packages/server/src/settings.ts";
import { ADMIN_COMMANDS } from "../packages/shared/src/rules/admin/admin.ts";

const ROOT = join(import.meta.dir, "..");
const DOC_PATH = join(ROOT, "docs", "running-a-server.md");

/** Privileged chat commands that are not `ADMIN_COMMANDS`. */
const SUPPLEMENTAL_COMMANDS = ["drop", "roster", "spawn"] as const;

/** Extracts every inline backticked span (`...`) from Markdown text. */
function inlineCodeSpans(markdown: string): string[] {
  return [...markdown.matchAll(/`([^`\n]+)`/g)].map((m) => m[1] as string);
}

describe("operator documentation", () => {
  test("documents every server setting key", () => {
    const spans = new Set(inlineCodeSpans(readFileSync(DOC_PATH, "utf8")));
    const missing = Object.keys(SETTINGS).filter((key) => !spans.has(key));
    expect(missing).toEqual([]);
  });

  test("documents every admin and privileged chat command", () => {
    const spans = inlineCodeSpans(readFileSync(DOC_PATH, "utf8"));
    const documentedCommands = new Set(
      spans
        .filter((s) => s.startsWith("/"))
        .map((s) => s.slice(1).split(/\s+/)[0]?.toLowerCase() ?? ""),
    );
    const expected = [...ADMIN_COMMANDS, ...SUPPLEMENTAL_COMMANDS];
    const missing = expected.filter((cmd) => !documentedCommands.has(cmd.toLowerCase()));
    expect(missing).toEqual([]);
  });
});
