/**
 * The ignore list. Pure rules over the generated `socialData.chat.windows`.
 *
 * 1.6 kept the list as RETURN-separated text for the session; SSO keeps the same lines per account
 * with 1.6's quirks: the whole rest of the line is one entry, any entry and duplicates are
 * accepted, `/unignore` skips the line after each deletion, and only the first 50 entries filter
 * chat lines and broadcasts, the first 40 IMs. The list holds at most 100 entries.
 */
import { socialData } from "@secondstaronline/data";

import { lingoEq } from "../core/lingo.ts";
import { CHAT_SOCIAL_TEXT } from "./im.ts";

const W = socialData.chat.windows;

/** `sqa` and `Broadcast` check lines 1-50; IMs lines 1-40. */
export const IGNORE_WINDOW = { chat: W.chatIgnoreLines, im: W.imIgnoreLines } as const;
export type IgnoreWindow = (typeof IGNORE_WINDOW)[keyof typeof IGNORE_WINDOW];
/** `/unignore` scans lines 1-100. */
const UNIGNORE_SCAN = W.unignoreScan;
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

/** `/ignore <rest>`: appended unchecked, or refused when full. */
export function ignoreAdd(list: readonly string[], rest: string): { list: string[]; line: string } {
  if (list.length >= IGNORE_MAX) {
    return { list: [...list], line: CHAT_SOCIAL_TEXT.ignoreFull };
  }
  return { list: [...list, rest], line: CHAT_SOCIAL_TEXT.ignoreAdded(rest) };
}

/**
 * `/unignore <rest>`: for x = 1 to 100, a line equal to the rest (ignoring case) is deleted, and
 * the line that moves into x is not tested: of two adjacent copies one survives. The line always
 * prints.
 */
export function ignoreRemove(
  list: readonly string[],
  rest: string,
): { list: string[]; line: string } {
  const out = [...list];
  for (let x = 1; x <= UNIGNORE_SCAN; x++) {
    const entry = out[x - 1];
    if (entry !== undefined && lingoEq(entry, rest)) {
      out.splice(x - 1, 1);
    }
  }
  return { list: out, line: CHAT_SOCIAL_TEXT.ignoreRemoved(rest) };
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
 * case among the first `window` lines. An entry with a trailing space or two words never matches a
 * name.
 */
export function ignores(list: readonly string[], sender: string, window: IgnoreWindow): boolean {
  return list.slice(0, window).some((e) => lingoEq(e, sender));
}
