/**
 * Player text can't make elements. The client sets every player-supplied string with
 * `textContent`, `.value` or canvas `fillText`; markup APIs are banned in `packages/client/src`
 * except where the string is a static literal (allow-list below, one line each).
 */
import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const SRC = join(ROOT, "packages", "client", "src");
const BANNED = /\b(innerHTML|outerHTML|insertAdjacentHTML)\b|document\.write\b|\.srcdoc\b/;

/** `file:line-text` pairs whose markup is a static string with no player text in it. */
const ALLOWED: ReadonlyArray<{ file: string; text: string }> = [
  {
    file: "ui/screens.ts",
    text: 'classText.innerHTML = "Fighter<br>Ranger<br>Mage";',
  },
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
  });
}

test("the client builds no element from a string except the allow-listed static ones", () => {
  const found: string[] = [];
  for (const file of walk(SRC)) {
    const rel = file.slice(SRC.length + 1);
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (BANNED.test(line) && !ALLOWED.some((a) => a.file === rel && line.trim() === a.text)) {
          found.push(`${rel}:${i + 1}  ${line.trim()}`);
        }
      });
  }
  expect(found).toEqual([]);
});
