/**
 * The ignore list.
 *
 * 1.6 kept the list as RETURN-separated text for the session; SSO keeps the same lines per account
 * with 1.6's entry rule: the whole rest of the line is one entry. The list holds at most 100
 * entries, an entry is added once, `/unignore` removes every matching copy, and every entry
 * filters chat, broadcasts and IMs.
 */
import { lingoEq } from "../core/lingo.ts";
import { CHAT_SOCIAL_TEXT } from "./im.ts";

/** SSO's cap: past line 100 an entry could never be removed nor work. */
export const IGNORE_MAX = 100;

/** Remove the first word, then up to two leading spaces. */
export function ignoreRest(text: string): string {
  const m = /^\s*\S+/.exec(text);
  let t = m ? text.slice(m[0].length) : text;
  for (let i = 0; i < 2 && t.startsWith(" "); i++) {
    t = t.slice(1);
  }
  return t;
}

/** `/ignore <rest>`: appended once (ignoring case), or refused when a new entry would pass the cap. */
export function ignoreAdd(list: readonly string[], rest: string): { list: string[]; line: string } {
  if (list.some((entry) => lingoEq(entry, rest))) {
    return { list: [...list], line: CHAT_SOCIAL_TEXT.ignoreAdded(rest) };
  }
  if (list.length >= IGNORE_MAX) {
    return { list: [...list], line: CHAT_SOCIAL_TEXT.ignoreFull };
  }
  return { list: [...list, rest], line: CHAT_SOCIAL_TEXT.ignoreAdded(rest) };
}

/**
 * `/unignore <rest>`: every line equal to the rest (ignoring case) is deleted. The line always
 * prints.
 */
export function ignoreRemove(
  list: readonly string[],
  rest: string,
): { list: string[]; line: string } {
  return {
    list: list.filter((entry) => !lingoEq(entry, rest)),
    line: CHAT_SOCIAL_TEXT.ignoreRemoved(rest),
  };
}

/**
 * `/ignorelist`: one chat line of the header, RETURN and the list, which ends in RETURN, so the
 * chat shows the header, each entry and a blank line.
 */
export function ignoreListLines(list: readonly string[]): string[] {
  return [CHAT_SOCIAL_TEXT.ignoreListHeader, ...list, ""];
}

/**
 * Whether a line from `sender` is dropped for a reader with this list: a whole-entry match ignoring
 * case anywhere in the list. An entry with a trailing space or two words never matches a name.
 */
export function ignores(list: readonly string[], sender: string): boolean {
  return list.some((e) => lingoEq(e, sender));
}
