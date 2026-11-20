/**
 * The chat log: every line a player writes to another player is recorded on the server, with
 * where it went and what became of it, for moderation. 1.6 logged nothing (IMs went peer to
 * peer). These are its shared rules: the channels, the outcomes, `/chatlog`'s arguments and the
 * line it prints. Pure.
 */
/** Where a line was written. */
export const CHAT_CHANNELS = [
  /** Local chat on the speaker's map. */
  "say",
  /** `/me` on the speaker's map. */
  "emote",
  /** `'` to everyone online. */
  "broadcast",
  /** `/msg`, the IMsend window or an IM window. */
  "im",
  /** The automatic answer an away player's IM window sent back. */
  "awayReply",
  /** The away text a player set. */
  "away",
  /** `/g` to the guild. */
  "guild",
  /** A chat room's input: Guild Chat, Admin Chat or a Game menu room. */
  "room",
  /** `-` staff chat. */
  "staff",
  /** A saved Bio profile. */
  "bio",
] as const;
export type ChatChannel = (typeof CHAT_CHANNELS)[number];

/** What became of a line. */
export const CHAT_OUTCOMES = [
  /** Sent on (for say, `/me` and broadcasts, `heard` says how many others read it). */
  "delivered",
  /** Refused by the chat or broadcast cooldown. */
  "cooldown",
  /** Refused by the house rule. */
  "house",
  /** A broadcast refused in jail, or a prisoner's line beyond their own map. */
  "jail",
  /** Refused because the speaker is muted. */
  "muted",
  /** An IM dropped by the recipient's ignore list. */
  "ignored",
  /** An IM to someone not online. */
  "notOnline",
  /** `/g` with no guild. */
  "noGuild",
  /** A room line out of a room. */
  "noRoom",
  /** Staff chat from a player. */
  "denied",
  /** A Bio profile refused for a ":" or "/". */
  "refused",
] as const;
export type ChatOutcome = (typeof CHAT_OUTCOMES)[number];

/** One logged line, as stored. */
export interface ChatLogRow {
  /** ISO time, UTC. */
  at: string;
  channel: ChatChannel;
  sender: string;
  /** The IM's recipient, the map, the guild or the room; null for broadcasts, staff chat, bios. */
  target: string | null;
  text: string;
  outcome: ChatOutcome;
  /** Others who read the line clearly (say, `/me`, broadcast). */
  heard: number | null;
  /** Others whose ignore list dropped it. */
  ignored: number | null;
  /** Others who got the muffled line instead. */
  muffled: number | null;
}

/** Lines `/chatlog` shows when no count is given, and the most it shows. */
export const CHATLOG_DEFAULT = 20;
export const CHATLOG_MAX = 100;

export interface ChatlogArgs {
  name: string;
  limit: number;
  channel: ChatChannel | null;
}

/**
 * `/chatlog <name> [n] [channel]`: the words after the name in either order. Null for a missing
 * name or a word that is neither a count nor a channel.
 */
export function parseChatlogArgs(typed: string): ChatlogArgs | null {
  const [, name, ...rest] = typed.trim().split(/\s+/);
  if (!name) {
    return null;
  }
  let limit = CHATLOG_DEFAULT;
  let channel: ChatChannel | null = null;
  for (const w of rest) {
    if (/^\d+$/.test(w)) {
      limit = Math.min(CHATLOG_MAX, Math.max(1, Number(w)));
      continue;
    }
    const c = CHAT_CHANNELS.find((k) => k.toLowerCase() === w.toLowerCase());
    if (!c) {
      return null;
    }
    channel = c;
  }
  return { name, limit, channel };
}

const OUTCOME_TEXT: Readonly<Record<ChatOutcome, string>> = {
  delivered: "",
  cooldown: "refused: cooldown",
  house: "refused: house rule",
  jail: "refused: jail",
  muted: "refused: muted",
  ignored: "ignored by recipient",
  notOnline: "recipient not online",
  noGuild: "refused: no guild",
  noRoom: "refused: not in a room",
  denied: "refused: not staff",
  refused: "refused",
};

/**
 * A `/chatlog` line:
 * `2026-11-18 09:00:05 UTC [im] Alice -> Bob: hi (ignored by recipient)`, with the counts after a
 * delivered say, `/me` or broadcast: `(heard by 3, 1 ignored, 2 muffled)`.
 */
export function chatlogLine(r: ChatLogRow): string {
  const to = r.target === null ? "" : ` -> ${r.target}`;
  const notes: string[] = [];
  if (r.outcome !== "delivered") {
    notes.push(OUTCOME_TEXT[r.outcome]);
  } else if (r.heard !== null) {
    notes.push(`heard by ${r.heard}`);
    if (r.ignored) {
      notes.push(`${r.ignored} ignored`);
    }
    if (r.muffled) {
      notes.push(`${r.muffled} muffled`);
    }
  }
  const tail = notes.length > 0 ? ` (${notes.join(", ")})` : "";
  return `${r.at.slice(0, 10)} ${r.at.slice(11, 19)} UTC [${r.channel}] ${r.sender}${to}: ${r.text}${tail}`;
}

export const CHATLOG_TEXT = {
  usage: `Usage: /chatlog <name> [count, up to ${CHATLOG_MAX}] [${CHAT_CHANNELS.join(" | ")}]`,
  header: (name: string, shown: number) => `* Chat log for ${name}, the last ${shown} lines:`,
  none: (name: string) => `No chat is logged for ${name}.`,
} as const;
