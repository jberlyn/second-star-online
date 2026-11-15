/**
 * Every test a ledger entry names must exist. A `Pinned by:` line in the divergences document or
 * the bug ledger lists test names (a title or the start of one) followed by the test file in
 * parentheses; each name must be inside a describe, test or it title of that file.
 */
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const TITLE = /\b(?:test|it|describe)(?:\.[a-z]+)?\s*\(\s*(["'`])((?:\\[\s\S]|(?!\1)[^\\])*)\1/g;

function titlesOf(file: string): string {
  const text = readFileSync(join(ROOT, file), "utf8");
  const out: string[] = [];
  for (const m of text.matchAll(TITLE)) {
    const raw = m[2] as string;
    out.push(raw, raw.replace(/\\(.)/g, "$1"));
  }
  return out.join("\u0000");
}

function checkPinnedBy(ledger: string): void {
  // The "Entry shape" examples in a ledger's header sit in a fenced block and name no real test.
  let fenced = false;
  const lines = readFileSync(join(ROOT, ledger), "utf8")
    .split("\n")
    .filter((l) => {
      if (l.startsWith("```")) {
        fenced = !fenced;
      }
      return !fenced && l.startsWith("- **Pinned by:**");
    });
  const titles = new Map<string, string>();
  const bad: string[] = [];
  let names = 0;
  for (const line of lines) {
    // Every backticked name belongs to the next `(file.test.ts)` after it on the line.
    let waiting: string[] = [];
    for (const t of line.matchAll(/`([^`]+)`|\(([^()`]*\.test\.ts)\)/g)) {
      if (t[1] !== undefined) {
        waiting.push(t[1]);
        names++;
        continue;
      }
      const file = t[2] as string;
      if (!existsSync(join(ROOT, file))) {
        bad.push(`${file}: no such file`);
      } else {
        if (!titles.has(file)) {
          titles.set(file, titlesOf(file));
        }
        for (const n of waiting) {
          if (!(titles.get(file) as string).includes(n)) {
            bad.push(`${file}: ${n}`);
          }
        }
      }
      waiting = [];
    }
    for (const n of waiting) {
      bad.push(`no test file after: ${n}`);
    }
  }
  expect(names).toBeGreaterThan(0);
  expect(bad.length, `${bad.length} stale names:\n  ${bad.slice(0, 40).join("\n  ")}`).toBe(0);
}

test("every test named in a divergence entry's `Pinned by:` is a title in the file named after it", () => {
  checkPinnedBy("docs/divergences.md");
});

test("every test named in a kept bug's `Pinned by:` is a title in the file named after it", () => {
  checkPinnedBy("docs/bug-ledger.md");
});
