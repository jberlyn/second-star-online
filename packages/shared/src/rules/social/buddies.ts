/**
 * The buddy list and the Friends window's lines. Pure rules over the generated `socialData.buddies`
 * (the generated social data).
 *
 * 1.6 kept the list as one string `:a:b:` (a leading colon, each name followed by one) and read it
 * by splitting on colons, so the first field is always empty and name k is field k + 1. SSO keeps
 * the items between the colons as rows per account and runs 1.6's string tests on the same string
 * rebuilt (`buddyString`), so every quirk carries over: the add test is a case-insensitive
 * substring check for `:<name>:`, and the original's remove routine finds only items 1-190 (so the
 * first 189 names; a kept bug of 1.6) and keeps items 1-200 when it rebuilds. 1.6 had no add limit;
 * SSO stops at `BUDDY_MAX` names.
 *
 * The Friends window shows online buddies only, in the server's spelling: filled at game entry
 * from everyone online (`friendsAtEntry`), a buddy appended at logon and deleted at logoff, an
 * added buddy appended when online (the online reply), a removed one deleted.
 */
import { socialData } from "@secondstaronline/data";

import { lingoContains, lingoEq, lingoWord } from "../core/lingo.ts";

const B = socialData.buddies;

const fill = (s: string, name: string) => s.replace("{NAME}", name);

/** Every buddy text, verbatim (the generated social data's `buddies.texts`). */
export const BUDDY_TEXT = {
  added: (name: string) => fill(B.texts.added.text, name),
  already: (name: string) => fill(B.texts.already.text, name),
  removed: (name: string) => fill(B.texts.removed.text, name),
  notOn: (name: string) => fill(B.texts.notOn.text, name),
  /** The Friends window's title. */
  title: B.texts.title.text,
  /** SSO divergence: the friends list is capped at 199 names. */
  full: "Your friends list is full.",
} as const;

/**
 * SSO's cap (user decision): the names the original's remove rebuild keeps (items 2-200). 1.6 had
 * none; each add rewrote the whole stored list, so a flood of adds could stall the server.
 */
export const BUDDY_MAX = 199;

/** The list as 1.6's pref held it: `:` then each item and a `:`. */
export function buddyString(items: readonly string[]): string {
  return `:${items.map((i) => `${i}:`).join("")}`;
}

/** The items between the colons of a `:a:b:` string (the leading and closing empties dropped). */
function itemsOf(s: string): string[] {
  return s.split(":").slice(1, -1);
}

/** The buddy list contains `:<name>:`, ignoring case. */
export function isBuddy(items: readonly string[], name: string): boolean {
  return lingoContains(buddyString(items), `:${name}:`);
}

/** What `/friends` asks for: word 2 `add` or `remove` and a word 3; else nothing. */
export type FriendsCommand = { kind: "add" | "remove"; name: string } | null;

/** Parses a `/friends` line: only word 3 is the name, anything else is swallowed. */
export function parseFriends(text: string): FriendsCommand {
  const w2 = lingoWord(text, 2);
  const name = lingoWord(text, 3);
  if (name === "") {
    return null;
  }
  if (lingoEq(w2, "add")) {
    return { kind: "add", name };
  }
  if (lingoEq(w2, "remove")) {
    return { kind: "remove", name };
  }
  return null;
}

/**
 * `buddyAdd`: already there (ignoring case) → its line, nothing changes; otherwise appended, any
 * name, yourself included. `ask`: the add then asks the name whether it is online (the online
 * query), which appends it to the window when it is. SSO refuses an add that would leave more than
 * `BUDDY_MAX` items (a name with colons adds several), with nothing changed.
 */
export function buddyAdd(
  items: readonly string[],
  name: string,
): { items: string[]; line: string; ask: boolean } {
  if (isBuddy(items, name)) {
    return { items: [...items], line: BUDDY_TEXT.already(name), ask: false };
  }
  const next = itemsOf(`${buddyString(items)}${name}:`);
  if (next.length > BUDDY_MAX) {
    return { items: [...items], line: BUDDY_TEXT.full, ask: false };
  }
  return { items: next, line: BUDDY_TEXT.added(name), ask: true };
}

/**
 * `buddyRemove`: the first of items 1-200 equal to the name (ignoring case; item 1 is always
 * empty); not found leaves x = 201, and any x > 190 prints "is not on" (a kept bug of 1.6).
 * Otherwise the list is rebuilt from items 1-200 without x and without empty items.
 */
export function buddyRemove(
  items: readonly string[],
  name: string,
): { items: string[]; line: string; removed: boolean } {
  const all = ["", ...items];
  let x = 1;
  for (; x <= B.removeScan; x++) {
    if (lingoEq(all[x - 1] ?? "", name)) {
      break;
    }
  }
  if (x > B.removeLimit) {
    return { items: [...items], line: BUDDY_TEXT.notOn(name), removed: false };
  }
  const kept: string[] = [];
  for (let beh = 1; beh <= B.removeScan; beh++) {
    const item = all[beh - 1] ?? "";
    if (item !== "" && beh !== x) {
      kept.push(item);
    }
  }
  return { items: kept, line: BUDDY_TEXT.removed(name), removed: true };
}

/**
 * Deletes window lines equal to the name among lines 1-100. Like every such loop in 1.6, the line
 * that moves up into a deleted place is not tested.
 */
export function friendsDelete(lines: readonly string[], name: string): string[] {
  const out = [...lines];
  for (let x = 1; x <= B.windowLines; x++) {
    const line = out[x - 1];
    if (line !== undefined && lingoEq(line, name)) {
      out.splice(x - 1, 1);
    }
  }
  return out;
}

/**
 * The window at game entry (`friendsAtEntry`): of the first 200 names online, in the server's order
 * and spelling, those on the list. (1.6 also lost names past the reply's 800th character; that
 * parsing artefact is N/A with the server's own roster.)
 */
export function friendsAtEntry(items: readonly string[], online: readonly string[]): string[] {
  return online.slice(0, B.entryNames).filter((n) => isBuddy(items, n));
}

/**
 * `934` → a buddy logged on: a buddy not already shown is appended. (1.6's own test was a
 * substring one, so a shown "JimBob" hid a buddy "Bob"; that P2P artefact is N/A.)
 */
export function friendsLogon(lines: readonly string[], items: readonly string[], name: string) {
  if (!isBuddy(items, name) || lines.some((l) => lingoEq(l, name))) {
    return [...lines];
  }
  return [...lines, name];
}

/** `935` → a buddy logged off: a buddy's lines are deleted. */
export function friendsLogoff(lines: readonly string[], items: readonly string[], name: string) {
  return isBuddy(items, name) ? friendsDelete(lines, name) : [...lines];
}
