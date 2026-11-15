/**
 * Instant messages and away messages. Pure rules over the generated `socialData.chat`.
 */
import { socialData } from "@secondstaronline/data";

import { lingoEq, lingoWord } from "../core/lingo.ts";

const C = socialData.chat;

const fill = (s: string, v: Record<string, string>) =>
  s.replace(/\{([A-Z]+)\}/g, (_m, k: string) => v[k] ?? "");
const tx = (k: keyof typeof C.texts) => C.texts[k].text;

/** Every IM, away, room, ignore and `/logchat` text, verbatim (the generated chat texts). */
export const CHAT_SOCIAL_TEXT = {
  /** The sender's `/msg` echo in the main chat. */
  imEcho: (me: string, text: string) => fill(tx("imEcho"), { NAME: me, TEXT: text }),
  /** A line in an IM window's received-text field. */
  imLine: (name: string, text: string) => fill(tx("imLine"), { NAME: name, TEXT: text }),
  /** The IM window's title. */
  imTitle: (sender: string) => fill(tx("imTitle"), { NAME: sender }),
  /** IMsend's title. */
  imSendTitle: tx("imSendTitle"),
  /** The Away window's title. */
  awayTitle: tx("awayTitle"),
  /** The Away window's line when away is switched on. */
  awayOn: tx("awayOn"),
  /** The Away window's line when away is switched off. */
  awayOff: tx("awayOff"),
  /** A line in the Away window's `Messages`. */
  awayLog: (name: string, text: string) => fill(tx("awayLog"), { NAME: name, TEXT: text }),
  /** The ChatWindow's title bar. */
  roomWindowTitle: tx("roomWindowTitle"),
  /** A room line. */
  roomLine: (name: string, text: string) => fill(tx("roomLine"), { NAME: name, TEXT: text }),
  /** Guild Chat with no guild. */
  noGuild: tx("noGuild"),
  /** The line printed after `/ignore`. */
  ignoreAdded: (rest: string) => fill(tx("ignoreAdded"), { TEXT: rest }),
  /** The line printed after `/unignore`. */
  ignoreRemoved: (rest: string) => fill(tx("ignoreRemoved"), { TEXT: rest }),
  /** The `/ignorelist` header, with its trailing space. */
  ignoreListHeader: tx("ignoreListHeader"),
  /** The line printed after `/logchat`. */
  logging: tx("logging"),
  // ---- SSO lines --------------------------------------------------------------------------
  notOnline: (name: string) => `${name} is not online.`,
  ignoreFull: "Your ignore list is full.",
} as const;

/** The ten IM windows. */
export const IM_SLOTS = C.windows.imSlots;
/** The IM and chat-chat message senders strip line breaks in chars 1-200. */
const RETURN_SCAN = C.windows.returnScan;

/** Removes the first word, keeping the space after it. */
function deleteWord1(s: string): string {
  const m = /^\s*\S+/.exec(s);
  return m ? s.slice(m[0].length) : s;
}

/**
 * `/msg` after the line's one leading space (the room input's copy): the name is the second word;
 * remove the first word and one leading space twice; the rest is the text, inner and trailing
 * spaces kept. No name or no text: null, and the line stays typed.
 */
export function parseMsg(text: string): { name: string; text: string } | null {
  const name = lingoWord(text, 2);
  let t = deleteWord1(text);
  if (t.startsWith(" ")) {
    t = t.slice(1);
  }
  t = deleteWord1(t);
  if (t.startsWith(" ")) {
    t = t.slice(1);
  }
  if (name === "" || t === "") {
    return null;
  }
  return { name, text: t };
}

/**
 * The RETURN strip of the IM and chat-chat message senders: the first 200 positions are scanned
 * forward; deleting a line break moves the next character into its position, which the loop then
 * skips, so the second of two adjacent line breaks survives, and so does any line break past the
 * 200th character. A browser's line feed counts.
 */
export function stripReturns(text: string): string {
  let s = text;
  for (let x = 1; x <= RETURN_SCAN; x++) {
    const ch = s[x - 1];
    if (ch === "\r" || ch === "\n") {
      s = s.slice(0, x - 1) + s.slice(x);
    }
  }
  return s;
}

/**
 * Whether an away text answers IMs: the away text is not "OFF", compared ignoring case, so an away
 * text of `off` is off though the ON line printed; an empty text is on and answers with an empty IM
 * (kept bugs). null: Back was pressed, or never Away.
 */
export function awayAnswers(away: string | null): boolean {
  return away !== null && !lingoEq(away, "OFF");
}

/**
 * The IM window an incoming IM shows in: the slot already holding this sender (ignoring case;
 * the lowest such); else the lowest free slot, opening it; else `random(10)`, opening it and
 * clearing the conversation it held. Slots are never freed: closing a window keeps its sender.
 * `slots` holds 10 names or null; `random` is 1-10.
 */
export function pickImSlot(
  slots: readonly (string | null)[],
  sender: string,
  random: (n: number) => number,
): { slot: number; opening: boolean } {
  for (let i = 0; i < IM_SLOTS; i++) {
    const held = slots[i];
    if (held != null && lingoEq(held, sender)) {
      return { slot: i + 1, opening: false };
    }
  }
  for (let i = 0; i < IM_SLOTS; i++) {
    if (slots[i] == null) {
      return { slot: i + 1, opening: true };
    }
  }
  return { slot: random(IM_SLOTS), opening: true };
}

/**
 * The slot a reply's echo goes into: the one holding the reply's target, ignoring case; the lookup
 * keeps the last match of a forward scan (one name is never in two slots, since the incoming-IM
 * sort reuses a sender's slot). null: no slot holds it, so there is no echo.
 */
export function replySlot(slots: readonly (string | null)[], to: string): number | null {
  let which: number | null = null;
  for (let i = 0; i < IM_SLOTS; i++) {
    const held = slots[i];
    if (held != null && lingoEq(held, to)) {
      which = i + 1;
    }
  }
  return which;
}
