/**
 * Mail and message boards. Pure rules over the generated `socialData.mail` and `socialData.boards`.
 *
 * 1.6 kept a mailbox as the file `MAIL\<name>.txt` and a board as `BOARDS\<board>.txt`; SSO keeps
 * rows, so only what a player can see of the file format is kept: the board's `From:` blocks.
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
  tooMany: mx("tooMany"),
} as const;

/** Every board text, verbatim. */
export const BOARD_TEXT = {
  view: bx("view"),
  notInFront: bx("notInFront"),
  notMember: bx("notMember"),
  empty: bx("empty"),
  townSquare: B.townSquare,
} as const;

/** A message goes to at most this many different names. */
export const MAIL_RECIPIENTS = M.recipients;

/**
 * The To field after SEND's strip: every space and `*` is removed. (1.6 deleted while stepping
 * forward, so runs of four or more left some behind; the body's `*` strip is not kept.)
 */
export function stripMailTo(to: string): string {
  return to.replace(/[ *]/g, "");
}

/**
 * The comma-separated names of the stripped To field: the non-empty ones, each once (ignoring
 * case, the first spelling kept), and whether there are more than `MAIL_RECIPIENTS` of them, in
 * which case nothing is sent. (1.6 read items 1-7 whatever they held, so a repeated name got two
 * copies and an eighth was dropped unseen.)
 */
export function mailRecipients(stripped: string): { names: string[]; tooMany: boolean } {
  const names: string[] = [];
  for (const item of stripped.split(",")) {
    if (item !== "" && !names.some((n) => lingoEq(n, item))) {
      names.push(item);
    }
  }
  return { names, tooMany: names.length > MAIL_RECIPIENTS };
}

/** The owner named before the apostrophe in a house mailbox's name. */
export function mailboxOwner(name: string): string {
  return name.split("'")[0] ?? "";
}

export type MailOpen = "notInFront" | "notYours" | "ok";

/** Standing still on the tile in front of `item`, facing it. */
export function standingInFront(a: {
  facing: Facing;
  stepFrames: number;
  player: { x: number; y: number };
  item: { x: number; y: number };
}): boolean {
  const [dx, dy] = FACING_DELTA[a.facing];
  return a.stepFrames === 0 && a.player.x + dx === a.item.x && a.player.y + dy === a.item.y;
}

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
  if (!standingInFront({ ...a, item: a.box })) {
    return "notInFront";
  }
  if (!a.universal && !lingoEq(mailboxOwner(a.name), a.me)) {
    return "notYours";
  }
  return "ok";
}

/**
 * REPLY's subject: "Re: " in front of the read pane's subject, unless it already starts "Re: "
 * (ignoring case). 1.6 added it every time, so replies stacked "Re: Re: ".
 */
export function replySubject(subject: string): string {
  const re = M.texts.reply.text.replace("{TEXT}", "");
  return subject.toLowerCase().startsWith(re.toLowerCase()) ? subject : `${re}${subject}`;
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

/** A hall's board (`The <guild>'s Board`) is read only by that guild's members. */
export function boardMember(board: string, guild: string): boolean {
  return guild !== "" && lingoEq(board, `The ${guild}'s Board`);
}
