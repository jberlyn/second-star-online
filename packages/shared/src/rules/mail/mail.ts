/**
 * Mail and message boards. Pure rules over the generated `socialData.mail` and `socialData.boards`.
 *
 * 1.6 kept a mailbox as the file `MAIL\<name>.txt` and a board as `BOARDS\<board>.txt`; SSO keeps
 * rows, so only what a player can see of the file format is kept: the strip of the To field, the
 * board's `From:` blocks.
 */
import { socialData } from "@secondstaronline/data";

import { lingoEq } from "../core/lingo.ts";
import { FACING_DELTA, type Facing } from "../movement/movement.ts";

const M = socialData.mail;
const B = socialData.boards;

const fill = (s: string, v: Record<string, string>) =>
  s.replace(/\{([A-Z]+)\}/g, (_m, k: string) => v[k] ?? "");
const mx = (k: keyof typeof M.texts) => M.texts[k].text;
const bx = (k: keyof typeof B.texts) => B.texts[k].text;

/** Every mail text, verbatim. */
export const MAIL_TEXT = {
  notInFront: mx("notInFront"),
  notYours: mx("notYours"),
  checking: mx("checking"),
  sending: mx("sending"),
  newMail: (name: string) => fill(mx("newMail"), { NAME: name }),
} as const;

/** Every board text, verbatim. */
export const BOARD_TEXT = {
  view: bx("view"),
  enterBuilding: bx("enterBuilding"),
  empty: bx("empty"),
  townSquare: B.townSquare,
} as const;

/** The send routine reads the first 7 comma-separated entries of the To field. */
export const MAIL_RECIPIENTS = M.recipients;
/** A guild board opens only from rows up to this. */
export const BOARD_MAX_Y = B.maxY;

/**
 * The To field after SEND's strip: two passes, x = 1-100 then x = 1-500; at each position a space
 * is deleted, then a `*`. Deleting while iterating skips the next character, so runs of four or
 * more leave residue. (The body's `*` strip is not kept.)
 */
export function stripMailTo(to: string): string {
  const chars = [...to];
  for (const scan of M.strip) {
    for (let x = 1; x <= scan; x++) {
      if (chars[x - 1] === " ") {
        chars.splice(x - 1, 1);
      }
      if (chars[x - 1] === "*") {
        chars.splice(x - 1, 1);
      }
    }
  }
  return chars.join("");
}

/**
 * The first 7 comma-separated entries of the stripped To field: the non-empty ones, duplicates
 * kept, and whether the first entry is filled (only the first prints "*** Sending Mail...").
 */
export function mailRecipients(stripped: string): { names: string[]; firstFilled: boolean } {
  const items = stripped.split(",").slice(0, MAIL_RECIPIENTS);
  return { names: items.filter((i) => i !== ""), firstFilled: (items[0] ?? "") !== "" };
}

/** The owner named before the apostrophe in a house mailbox's name. */
export function mailboxOwner(name: string): string {
  return name.split("'")[0] ?? "";
}

export type MailOpen = "notInFront" | "notYours" | "ok";

/**
 * The mailbox click: you must stand on the tile in front of the box, facing it, not mid-step;
 * **position first**, so a stranger out of place hears `notInFront`. A house box then needs its
 * owner (the first part of the name matches you, ignoring case); Universal Mail has no owner test.
 */
export function mailOpenCheck(a: {
  facing: Facing;
  stepFrames: number;
  player: { x: number; y: number };
  box: { x: number; y: number };
  name: string;
  universal: boolean;
  me: string;
}): MailOpen {
  const [dx, dy] = FACING_DELTA[a.facing];
  if (a.stepFrames > 0 || a.player.x + dx !== a.box.x || a.player.y + dy !== a.box.y) {
    return "notInFront";
  }
  if (!a.universal && !lingoEq(mailboxOwner(a.name), a.me)) {
    return "notYours";
  }
  return "ok";
}

/** REPLY's subject: "Re: " in front of whatever the read pane shows, so replies stack. */
export function replySubject(subject: string): string {
  return `${M.texts.reply.text.replace("{TEXT}", "")}${subject}`;
}

/** The post button's test: a letter or digit, either case (an assumption: ASCII only). */
export function postHasText(text: string): boolean {
  return /[a-z0-9]/i.test(text);
}

/**
 * One post as appended to the board file: `From: <name>`, a blank line, the text, then the rule of
 * 24 underscores, every line ended by RETURN.
 */
export function boardPostText(name: string, text: string): string {
  const body = text.replace(/\r\n|\n/g, "\r");
  return `From: ${name}\r\r${body}\r${B.rule}\r`;
}

/** The board as the window shows it: the posts in order, concatenated. */
export function boardText(posts: readonly { author: string; body: string }[]): string {
  return posts.map((p) => boardPostText(p.author, p.body)).join("");
}

/**
 * Which board an item opens: `Message Boards` (case-insensitive comparison) is Town Square, a name
 * containing `'s Board` a guild hall's.
 */
export function boardKind(name: string): "town" | "guild" | null {
  if (lingoEq(name, "Message Boards")) {
    return "town";
  }
  return name.toLowerCase().includes("'s board") ? "guild" : null;
}
