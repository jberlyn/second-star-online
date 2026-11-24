/**
 * Name-pattern rows (the item rules in `content/item-rules.json`). 1.6 decided most things about an
 * item by testing its name with case-insensitive comparison or `contains` in a fixed order; a row
 * records one such test, and a table is a list of rows in that order. Each table says whether the
 * first or the last match wins, as the 1.6 script did.
 */
import { lingoContains, lingoEq } from "./lingo.ts";

export type PatternRow = {
  match: "exact" | "contains";
  pattern: string;
  /**
   * Names the row does not match (issue #30): the content store sets it on a pack row whose item
   * an item definition now decides, so the row stops applying to that item and only it. Never
   * stored: the store compiles it from the definitions.
   */
  except?: readonly string[];
};

/** Whether a row leaves out `name` (its `except`: an item a definition decides). */
export function excepted(r: object, name: string): boolean {
  const except = (r as { except?: readonly string[] }).except;
  return except?.some((n) => lingoEq(n, name)) === true;
}

/** A row uses either exact or substring matching, both ignoring case. */
export function ruleMatches(name: string, r: PatternRow): boolean {
  if (excepted(r, name)) {
    return false;
  }
  return r.match === "exact" ? lingoEq(name, r.pattern) : lingoContains(name, r.pattern);
}

/** The first matching row of a table, or undefined. */
export function firstMatch<T extends PatternRow>(rows: readonly T[], name: string): T | undefined {
  return rows.find((r) => ruleMatches(name, r));
}

/** The last matching row of a table, or undefined. */
export function lastMatch<T extends PatternRow>(rows: readonly T[], name: string): T | undefined {
  let found: T | undefined;
  for (const r of rows) {
    if (ruleMatches(name, r)) {
      found = r;
    }
  }
  return found;
}

/** Does any row match? */
export function anyMatch(rows: readonly PatternRow[], name: string): boolean {
  return rows.some((r) => ruleMatches(name, r));
}
