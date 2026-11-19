/**
 * Chat rooms: General, New Player, Trading Post, Guild and Admin Chat, each a ChatWindow room.
 */
import { socialData } from "@secondstaronline/data";

import { lingoEq, lingoWord } from "../core/lingo.ts";
import { commandWord } from "./chat.ts";

export type RoomKey = "general" | "newPlayer" | "tradingPost" | "guild" | "admin";
export const ROOM_KEYS: readonly RoomKey[] = socialData.chat.rooms.map((r) => r.key);

const fill = (s: string, guild: string) => s.replace(/\{GUILD\}/g, guild);

function roomRow(key: RoomKey) {
  const r = socialData.chat.rooms.find((x) => x.key === key);
  if (!r) {
    throw new Error(`no room ${key}`);
  }
  return r;
}

/** A room's server group: `@GeneralChat`, …, `@x<guild>`, `@Adminss`. */
export function roomGroup(key: RoomKey, guild = ""): string {
  return fill(roomRow(key).group, guild);
}

/** The `Title` field and the line added to `Chat` on entering. */
export function roomTexts(key: RoomKey, guild = ""): { title: string; entering: string } {
  const r = roomRow(key);
  return { title: fill(r.title, guild), entering: fill(r.entering, guild) };
}

/** What a line typed into a room's typing field asks for. */
export type RoomLine =
  /** `/logchat <file>`: the room's own log. */
  | { kind: "logchat"; file: string }
  /** The whole line is `who`. */
  | { kind: "who" }
  /** `/msg`, with the main chat's echo; `text` is the line after its leading space. */
  | { kind: "msg"; text: string }
  /** SSO: any other command word, `/me` included; the typist is told and nothing is said. */
  | { kind: "unknown"; command: string }
  /** Everything else is room text: no `/me`, `'`, `/g` or keywords. */
  | { kind: "say"; text: string };

/** Parses a room input line; null for an empty line (a field holding only RETURN is cleared). */
export function parseRoomLine(raw: string): RoomLine | null {
  if (raw === "") {
    return null;
  }
  const text = raw.startsWith(" ") ? raw.slice(1) : raw;
  const w1 = lingoWord(text, 1);
  if (lingoEq(w1, "/logchat")) {
    return { kind: "logchat", file: lingoWord(text, 2) };
  }
  if (lingoEq(text, "who")) {
    return { kind: "who" };
  }
  if (lingoEq(w1, "/msg")) {
    return { kind: "msg", text };
  }
  if (commandWord(w1)) {
    return { kind: "unknown", command: w1 };
  }
  return { kind: "say", text };
}

/**
 * `/logchat` in the main input: word 2 names the file, the first word only. Returns null when word
 * 1 is not `/logchat`. SSO saves a browser download, `chatlog.txt` when no name was given.
 */
export function logchatFile(raw: string): string | null {
  const text = raw.startsWith(" ") ? raw.slice(1) : raw;
  if (!lingoEq(lingoWord(text, 1), "/logchat")) {
    return null;
  }
  return lingoWord(text, 2) || "chatlog.txt";
}
