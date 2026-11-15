/**
 * Lingo helpers. Lingo was the scripting language of Macromedia Director, which the original game
 * was written in. Its text comparisons ignore case, an empty string is contained in every string,
 * words are runs of non-space characters, and positive random bounds yield values from 1 to n.
 * The `lingo*` functions copy that behaviour on purpose, so code that calls them behaves like the
 * original.
 */

/** Case-insensitive substring matching; the empty string occurs in every string. */
export function lingoContains(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/**
 * Returns the word at a 1-based index. Words are runs of non-whitespace; a missing word is
 * EMPTY (""), which matters because EMPTY is "contained" in every list.
 */
export function lingoWord(line: string, n: number): string {
  const words = line.trim().split(/\s+/);
  return words[n - 1] ?? "";
}

/** Case-insensitive string equality. */
export function lingoEq(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** Parse typed text as a whole number, or null if invalid. */
export function lingoInteger(s: string): number | null {
  const t = s.trim();
  return /^-?\d+$/.test(t) ? Number.parseInt(t, 10) : null;
}

/**
 * The sim's randomness (`Rng`). Positive bounds return 1..n. Nonpositive or unset bounds produced a
 * random signed 32-bit number in the original (never 1..n in practice), so an implementation draws
 * once and returns 0. An unset bound is passed as 0.
 */
export interface Rng {
  random(n: number): number;
}

/** Integer division truncates toward zero. */
export function lingoDiv(a: number, b: number): number {
  return Math.trunc(a / b);
}
