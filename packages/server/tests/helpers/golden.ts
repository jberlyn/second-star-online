/**
 * Golden files: text a test records and compares against a committed copy (the behaviour snapshot
 * and the replay's hash sequence). A mismatch fails with the lines that changed; run the test with
 * `SSO_UPDATE_GOLDEN=1` to rewrite the files after reviewing the change (docs/modding.md, "The
 * safety net").
 */
import { expect } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative } from "node:path";

export const UPDATE_GOLDEN = process.env.SSO_UPDATE_GOLDEN === "1";

/** How many changed lines a failure prints. */
const SHOWN = 80;

/**
 * The lines only in `want` (-) and only in `got` (+), in file order, with the first line number
 * that differs. The golden files hold one keyed line per name, so a set difference reads well.
 */
export function lineDiff(want: string, got: string): string {
  const a = want.split("\n");
  const b = got.split("\n");
  const count = (lines: string[]) => {
    const m = new Map<string, number>();
    for (const l of lines) {
      m.set(l, (m.get(l) ?? 0) + 1);
    }
    return m;
  };
  const inB = count(b);
  const inA = count(a);
  const removed: string[] = [];
  const added: string[] = [];
  for (const l of a) {
    const n = inB.get(l) ?? 0;
    if (n > 0) {
      inB.set(l, n - 1);
    } else {
      removed.push(`- ${l}`);
    }
  }
  for (const l of b) {
    const n = inA.get(l) ?? 0;
    if (n > 0) {
      inA.set(l, n - 1);
    } else {
      added.push(`+ ${l}`);
    }
  }
  const first = a.findIndex((l, i) => l !== b[i]);
  // Pair a removed line with the added line of the same name (the text before " | ").
  const keyOf = (l: string) => l.slice(2).split(" | ")[0] ?? l;
  const lines: string[] = [];
  const pending = new Map<string, string[]>();
  for (const l of added) {
    pending.set(keyOf(l), [...(pending.get(keyOf(l)) ?? []), l]);
  }
  for (const l of removed) {
    lines.push(l);
    const k = keyOf(l);
    const match = pending.get(k);
    if (match?.length) {
      lines.push(match.shift() as string);
    }
  }
  for (const rest of pending.values()) {
    lines.push(...rest);
  }
  // The same lines in another order: show the first lines that moved.
  if (lines.length === 0 && first >= 0) {
    for (let i = first; i < Math.min(first + 5, a.length, b.length); i++) {
      lines.push(`- ${a[i]}`, `+ ${b[i]}`);
    }
  }
  return [
    `first difference at line ${first < 0 ? Math.min(a.length, b.length) + 1 : first + 1}; ${removed.length} removed, ${added.length} added`,
    ...lines.slice(0, SHOWN),
    ...(lines.length > SHOWN ? [`… and ${lines.length - SHOWN} more`] : []),
  ].join("\n");
}

/** Compares `text` with the golden file at `path`, or writes it under `SSO_UPDATE_GOLDEN=1`. */
export function expectGolden(path: string, text: string): void {
  const body = text.endsWith("\n") ? text : `${text}\n`;
  if (UPDATE_GOLDEN) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body);
    return;
  }
  const name = relative(process.cwd(), path);
  if (!existsSync(path)) {
    throw new Error(`${name} is missing: run with SSO_UPDATE_GOLDEN=1 to record it`);
  }
  const want = readFileSync(path, "utf8");
  if (want !== body) {
    throw new Error(
      `${name} differs from today's behaviour. Review the change; if it is intended, rerun with SSO_UPDATE_GOLDEN=1 and add a differences entry when it differs from 1.6.\n${lineDiff(want, body)}`,
    );
  }
  expect(body).toBe(want);
}
