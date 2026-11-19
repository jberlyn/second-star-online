/**
 * Instant messages and away messages on the server.
 *
 * 1.6 sent an IM peer to peer (`MG@`); the receiver's client dropped an ignored sender's, logged
 * it while away (answering with the bare away text) or showed it in a window. SSO routes it
 * through the server with the same texts and adds:
 * - "<name> is not online." to the sender after a send to nobody;
 * - no auto-reply to an auto-reply or to yourself (two away players do not loop);
 * - the chat cooldown and the 200-character cap;
 * - every IM, automatic away reply and away text in the chat log, sent or not.
 */
import {
  awayAnswers,
  CHAT_COLOR,
  CHAT_SOCIAL_TEXT,
  chatRefusal,
  lingoEq,
  parseMsg,
  type RestoreTarget,
  stripReturns,
} from "@secondstaronline/shared";

import type { Outgoing, Player, World } from "../world/world.ts";
import { hears } from "./ignore.ts";
import { logChat } from "./log.ts";

export interface ImDeps {
  /** Setting `chatMaxChars`. */
  maxChars: number;
  /** Setting `chatCooldown`, in frames. */
  chatCooldownFrames: number;
}

const tell = (p: Player, text: string): Outgoing => ({
  to: p.id,
  msg: { t: "chat", text, color: CHAT_COLOR.normal },
});

/** The online player a name reaches, ignoring case. */
function online(world: World, name: string): Player | null {
  for (const o of world.players.values()) {
    if (lingoEq(o.name, name)) {
      return o;
    }
  }
  return null;
}

/**
 * Delivers one IM to `to` (`Chatmsg "MG@ …"`): dropped if `to` ignores the sender anywhere on its
 * list; while `to` is away, logged and answered with the away text unless it came from `to` itself
 * or is itself an auto-reply; else shown in its window. Reaches the dead.
 */
export function deliverIm(
  world: World,
  from: Player,
  to: Player,
  text: string,
  autoReply = false,
): Outgoing[] {
  const channel = autoReply ? "awayReply" : "im";
  if (!hears(to, from.name)) {
    logChat(world, from, channel, text, "ignored", to.name);
    return [];
  }
  logChat(world, from, channel, text, "delivered", to.name);
  if (awayAnswers(to.away)) {
    const out: Outgoing[] = [{ to: to.id, msg: { t: "im", from: from.name, text, away: true } }];
    if (to !== from && !autoReply) {
      out.push(...deliverIm(world, to, from, to.away ?? "", true));
    }
    return out;
  }
  return [{ to: to.id, msg: { t: "im", from: from.name, text, away: false } }];
}

/**
 * `/msg` typed in the main input or a room's: `text` is the line after its one leading space,
 * `typed` the line as typed. No name or no text leaves it typed; else the echo `>>> <me>: <text>`
 * in the main chat, sent or not.
 */
export function msgCommand(
  world: World,
  p: Player,
  text: string,
  typed: string,
  deps: ImDeps,
  restoreTo?: RestoreTarget,
): Outgoing[] {
  const m = parseMsg(text);
  if (!m) {
    return [{ to: p.id, msg: { t: "restore", text: typed, ...(restoreTo ? { restoreTo } : {}) } }];
  }
  const refused = chatRefusal(p.chatIn);
  if (refused) {
    logChat(world, p, "im", m.text, "cooldown", m.name);
    return [
      {
        to: p.id,
        msg: {
          t: "chat",
          text: refused,
          color: 0,
          restore: typed,
          ...(restoreTo ? { restoreTo } : {}),
        },
      },
    ];
  }
  p.chatIn = deps.chatCooldownFrames;
  const out: Outgoing[] = [tell(p, CHAT_SOCIAL_TEXT.imEcho(p.name, m.text))];
  const target = online(world, m.name);
  if (!target) {
    logChat(world, p, "im", m.text, "notOnline", m.name);
    out.push(tell(p, CHAT_SOCIAL_TEXT.notOnline(m.name)));
    return out;
  }
  return [...out, ...deliverIm(world, p, target, m.text)];
}

/**
 * The IMsend window's Send (`via` "send": no echo, the window closes) or an IM window's reply
 * (`via` "window": the echo `<me>: <text>` into that window). line breaks in chars 1-200 go first; an
 * empty text or recipient sends nothing (the client checks the same before closing IMsend).
 */
export function imIntent(
  world: World,
  p: Player,
  to: string,
  raw: string,
  via: "send" | "window",
  deps: ImDeps,
): Outgoing[] {
  const text = stripReturns(raw).slice(0, deps.maxChars);
  if (text === "" || to === "") {
    return [];
  }
  const refused = chatRefusal(p.chatIn);
  if (refused) {
    logChat(world, p, "im", text, "cooldown", to);
    const restoreTo: RestoreTarget = via === "send" ? { kind: "imSend", to } : { kind: "im", to };
    return [{ to: p.id, msg: { t: "chat", text: refused, color: 0, restore: raw, restoreTo } }];
  }
  p.chatIn = deps.chatCooldownFrames;
  const out: Outgoing[] = via === "window" ? [{ to: p.id, msg: { t: "imEcho", to, text } }] : [];
  const target = online(world, to);
  if (!target) {
    logChat(world, p, "im", text, "notOnline", to);
    out.push(tell(p, CHAT_SOCIAL_TEXT.notOnline(to)));
    return out;
  }
  return [...out, ...deliverIm(world, p, target, text)];
}

/**
 * The Away window: Away holds the field's text, Back turns it off; each prints its line in the main
 * chat. An empty text or "OFF" (any case) turns it off. Held for the session.
 */
export function setAway(world: World, p: Player, text: string | null, deps: ImDeps): Outgoing[] {
  const away = text === null ? null : text.slice(0, deps.maxChars);
  if (away === null || !awayAnswers(away)) {
    p.away = null;
    return [tell(p, CHAT_SOCIAL_TEXT.awayOff)];
  }
  p.away = away;
  logChat(world, p, "away", away, "delivered");
  return [tell(p, CHAT_SOCIAL_TEXT.awayOn)];
}
