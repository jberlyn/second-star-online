/**
 * Mail on the server.
 *
 * 1.6's clients wrote each other's files (the sender name, the whole box on a delete). SSO keeps
 * rows: the server stamps the sender, reads and writes the boxes at the moment, drops a send to a
 * name with no character and cuts a box and a body. Mail reaches offline characters; an online
 * recipient gets 1.6's new-mail notice and, when their list is up, a reload.
 */
import {
  CHAT_COLOR,
  chatRefusal,
  MAIL_TEXT,
  type MailOpen,
  mailOpenCheck,
  mailRecipients,
  stripMailTo,
} from "@secondstaronline/shared";

import { chatWait, silenced } from "../chat/speech.ts";
import { onlineNamed } from "../social/presence.ts";
import type { GroundItem, Outgoing, Player, World } from "../world/world.ts";

/** What the mail handlers read and write; wired to `persistence/mail.ts` in `game.ts`. */
export interface MailStore {
  load(ownerId: string): { id: number; from: string; subject: string; body: string }[];
  /** Adds a message and drops the oldest past `cap`; the caller supplies the time. */
  add(ownerId: string, msg: { from: string; subject: string; body: string }, cap: number): void;
  remove(ownerId: string, id: number): void;
  /** A character by name, ignoring case. */
  find(name: string): { id: string; name: string } | null;
}

export interface MailDeps {
  /** Setting `chatCooldown`, in frames. */
  chatCooldownFrames: number;
  /** Setting `mailBodyMax`. */
  mailBodyMax: number;
  /** Setting `mailboxMax`. */
  mailboxMax: number;
}

const chat = (to: Player, text: string): Outgoing => ({
  to: to.id,
  msg: { t: "chat", text, color: CHAT_COLOR.normal },
});

const listFor = (p: Player, store: MailStore, lock: boolean): Outgoing => ({
  to: p.id,
  msg: { t: "mail", messages: store.load(p.id), lock },
});

/**
 * The mailbox click (or Ctrl): the position and owner tests, then the mail is loaded, 1.6's
 * client-side input lock is set and "You check your mail..." shows with the list. The caller has
 * set the click's 40-frame pause; Ctrl's is set by its own entry.
 */
export function mailOpen(
  p: Player,
  box: GroundItem,
  universal: boolean,
  store: MailStore,
): Outgoing[] {
  const check: MailOpen = mailOpenCheck({
    facing: p.facing,
    stepFrames: p.stepFrames,
    player: { x: p.x, y: p.y },
    box: { x: box.x, y: box.y },
    name: box.item,
    universal,
    me: p.name,
  });
  if (check === "notInFront") {
    return [chat(p, MAIL_TEXT.notInFront)];
  }
  if (check === "notYours") {
    return [chat(p, MAIL_TEXT.notYours)];
  }
  p.keyLock = true;
  p.mailList = true;
  p.mailUi = true;
  return [chat(p, MAIL_TEXT.checking), listFor(p, store, true)];
}

/**
 * The screen's own buttons mirror the input lock, which only the client set in 1.6: the list's
 * CLOSE unlocks and takes the list down; REPLY and a pane's CLOSE leave the keys locked while the
 * list is up (1.6's pane CLOSE unlocked with the list still on screen). Ignored until a pane has
 * opened.
 */
export function mailUiIntent(p: Player, act: "close" | "reply" | "composeClose"): void {
  if (!p.mailUi) {
    return;
  }
  if (act === "close") {
    p.mailList = false;
  }
  p.keyLock = p.mailList;
}

/**
 * SEND. An empty body or no filled recipient does nothing; more than 7 different names is refused
 * with a line. The chat wait refuses before anything is stored (the compose stays open with its
 * draft). Otherwise each different name in the stripped To gets one copy, a name with no character
 * dropped silently; an online recipient gets "*** You have new mail from <you>" and, with their
 * list up, the reloaded list; then `mailSent`. The keys stay locked: the list is still up.
 */
export function mailSend(
  world: World,
  p: Player,
  msg: { to: string; subject: string; body: string },
  store: MailStore,
  deps: MailDeps,
): Outgoing[] {
  // Mail is sent from the compose pane, which exists only after the mailbox was opened.
  if (!p.mailUi) {
    return [];
  }
  if (msg.body === "") {
    return [];
  }
  const { names, tooMany } = mailRecipients(stripMailTo(msg.to));
  if (names.length === 0) {
    return [];
  }
  if (tooMany) {
    return [chat(p, MAIL_TEXT.tooMany)];
  }
  const hush = silenced(p, "mail");
  if (hush) {
    return [chat(p, hush.text)];
  }
  const refused = chatRefusal(chatWait(p));
  if (refused) {
    return [chat(p, refused)];
  }
  p.chatIn = deps.chatCooldownFrames;
  const body = msg.body.slice(0, deps.mailBodyMax);
  const out: Outgoing[] = [];
  for (const name of names) {
    const to = store.find(name);
    if (!to) {
      continue;
    }
    store.add(to.id, { from: p.name, subject: msg.subject, body }, deps.mailboxMax);
    const online = onlineNamed(world, to.name);
    if (online) {
      out.push(chat(online, MAIL_TEXT.newMail(p.name)));
      if (online.mailList) {
        out.push(listFor(online, store, false));
      }
    }
  }
  out.push({ to: p.id, msg: { t: "mailSent" } });
  return out;
}

/** DELETE: the player's own message; another's id matches nothing. */
export function mailDelete(p: Player, id: number, store: MailStore): void {
  store.remove(p.id, id);
}
