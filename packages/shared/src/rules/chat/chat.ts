/**
 * Chat line rules, shared by the server (which parses and formats every line) and the client
 * (colours, the ×N collapse). Pure.
 */
import type { AdminCmd } from "../admin/admin.ts";
import { lingoContains, lingoWord } from "../core/lingo.ts";
import { WEB_TEXT } from "../movement/movement.ts";
import { type FriendsCommand, parseFriends } from "../social/buddies.ts";
import { ignoreRest } from "./ignore.ts";

/** What one typed line asks for, decided in the original `ChatSend` order. */
export type ChatCommand =
  /** Local chat to the map: the text after the typical chat message's hygiene. */
  | { kind: "say"; text: string }
  /** `/me`: everything after the word `/me`, leading space kept. */
  | { kind: "emote"; text: string }
  /** `'text`: the text after the original's prefix stripping. */
  | { kind: "broadcast"; text: string }
  /** `/help [topic]`: the whole rest of the line is looked up. */
  | { kind: "help"; topic: string }
  /** The whole line is `who`. */
  | { kind: "who" }
  /** The whole line is `quit` (any case): quits the arena challenge. */
  | { kind: "arenaQuit" }
  /** The whole line is `Challenge` (any case): starts the arena challenge. */
  | { kind: "arenaChallenge" }
  /** A command of the original grammar that SSO has not built yet: dropped. */
  | { kind: "unbuilt"; command: string }
  /**
   * SSO: a line whose first word looks like a command (`/` and a letter) that is no command. 1.6
   * said it as local chat; SSO tells only the typist (`unknownCommandText`) and says nothing.
   */
  | { kind: "unknown"; command: string }
  /**
   * `Password=<new>`: `password` is the second part of the whole line split on `=`, with every
   * forbidden character removed (`passwordFrom`). The server hashes it into the account.
   */
  | { kind: "password"; password: string }
  /**
   * `/g text`: word 1 deleted, one leading `'`, up to two spaces, one more `'`; then the guild
   * message sender strips up to 98 leading spaces.
   */
  | { kind: "guildChat"; text: string }
  /** `/invite name`: word 1 deleted, one leading space; the whole rest is the name. */
  | { kind: "guildInvite"; name: string }
  /**
   * `ACCEPT` / `REJECT` as word 1: answers a pending invitation; with none pending the line falls
   * through to local chat, so `say` is what it would say.
   */
  | { kind: "guildAnswer"; accept: boolean; say: string }
  /**
   * SSO operator stand-in: `/roster [slot species|clear]`. Not 1.6 grammar: for anyone without the
   * permission the server says the line as local chat, as 1.6 would.
   */
  | { kind: "roster"; args: string; line: string }
  /** SSO operator stand-in: `/spawn <1-4>`, like `/roster`. */
  | { kind: "spawn"; args: string; line: string }
  /**
   * `/balance`, `/deposit`, `/withdraw` (→ the bank command): the line after its one leading
   * space; the chat field is cleared.
   */
  | { kind: "bank"; text: string }
  /**
   * `/drop <item>` / `/drop <n> gold`: word 1 deleted, then one leading space. Anyone without the
   * `drop` permission: nothing happens.
   */
  | { kind: "drop"; item: string }
  /**
   * `-text`: `typed` is the line after its one leading space; the server strips the `-` and spaces
   * (`formatStaffChat`). Staff (any account with a role) post to staff chat; players
   * receive an explicit refusal and their input clears.
   */
  | { kind: "staffChat"; typed: string }
  /**
   * An admin command: `line` is the whole line after its one leading space (`/warp` sends it all);
   * `w2` is word 2, the name or IP most of them take.
   */
  | { kind: "admin"; cmd: AdminCmd; w2: string; line: string }
  /**
   * `/msg`: `text` is the line after its one leading space, split by `parseMsg`
   * (shared/rules/chat/im.ts). With no name or no text nothing happens and it stays typed.
   */
  | { kind: "msg"; text: string }
  /** `/ignorelist`. */
  | { kind: "ignoreList" }
  /** `/ignore <rest>`: the rest after word 1 and up to two spaces. */
  | { kind: "ignore"; rest: string }
  /** `/unignore <rest>`. */
  | { kind: "unignore"; rest: string }
  /**
   * `/friends add|remove <word 3>`: anything else is swallowed (`friends` null) and the field is
   * cleared.
   */
  | { kind: "friends"; friends: FriendsCommand };

/**
 * The admin commands by their word 1, 1.6's and SSO's own.
 */
const ADMIN_WORD1: Readonly<Record<string, AdminCmd>> = {
  "/save": "save",
  "/refresh": "refresh",
  "/cheatfile": "cheatfile",
  "/unbanip": "unbanip",
  "/inventory": "inventory",
  "/banip": "banip",
  "/location": "location",
  "/iplookup": "iplookup",
  "/kick": "kick",
  "/warpscript": "warpscript",
  "/ban": "ban",
  "/warp": "warp",
  "/jail": "jail",
  "/pardon": "pardon",
  "/warptome": "warptome",
  "/warpmeto": "warpmeto",
  "/unban": "unban",
  "/setclass": "setclass",
  "/unjail": "unjail",
  "/banlist": "banlist",
  "/chatlog": "chatlog",
  "/auditlog": "auditlog",
  "/mute": "mute",
  "/unmute": "unmute",
};

/**
 * Commands whose first word is tested against the typed line's first word that SSO has not built
 * yet (`/RPG` stays inert: its server subject has no handler). Each exits `ChatSend` in 1.6, so
 * none falls through to local chat.
 */
const UNBUILT_WORD1 = [
  "/rpg",
  // The client saves `/logchat` itself and never sends it.
  "/logchat",
] as const;

/** Compare strings without regard to case. */
function lingoEq(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** Removes up to `times` leading spaces. */
function dropLeadingSpaces(s: string, times: number): string {
  let out = s;
  for (let i = 0; i < times && out.startsWith(" "); i++) {
    out = out.slice(1);
  }
  return out;
}

/** Removes the first word, keeping the space after it. */
function deleteWord1(s: string): string {
  const m = /^\s*\S+/.exec(s);
  return m ? s.slice(m[0].length) : s;
}

/**
 * `Password=<new>` uses the second part of the whole line split on `=` (empty when no `=`
 * appears). It removes every space, `/`, `:` and `\`, including adjacent ones and a leading one.
 */
export function passwordFrom(text: string): string {
  return (text.split("=")[1] ?? "")
    .split("")
    .filter((c) => ![" ", "/", ":", "\\"].includes(c))
    .join("");
}

/**
 * The replies to `Password=`: "Password has been changed." is 1.6's text without the password (1.6
 * echoed it back); the refusal is SSO's (1.6 would have stored an empty password).
 */
export const PASSWORD_TEXT = {
  changed: "Password has been changed.",
  refused: "Your password was not changed.",
  /** SSO: the hash could not be stored. */
  failed: "Your password could not be changed. Please try again.",
} as const;

/** The most a password can be: the login schema's cap. */
export const PASSWORD_MAX = 64;

/**
 * Parses a typed line. Returns null for a line that sends nothing (empty).
 * `raw` is the input field as typed, already cut to the length cap.
 */
export function parseChatLine(raw: string): ChatCommand | null {
  if (raw === "") {
    return null;
  }
  // One leading space is deleted before any test.
  const text = dropLeadingSpaces(raw, 1);
  const w1 = lingoWord(text, 1);

  if (lingoEq(w1, "/help")) {
    const topic = deleteWord1(text).trim();
    return { kind: "help", topic: topic === "" ? "Help" : topic };
  }
  if (text.startsWith("'")) {
    // drop the ', then up to two spaces, then one more ' if present.
    let t = dropLeadingSpaces(text.slice(1), 2);
    if (t.startsWith("'")) {
      t = t.slice(1);
    }
    return { kind: "broadcast", text: t };
  }
  if (lingoEq(text, "who")) {
    return { kind: "who" };
  }
  if (lingoEq(w1, "/me")) {
    return { kind: "emote", text: deleteWord1(text) };
  }
  if (lingoEq(w1, "/roster")) {
    return {
      kind: "roster",
      args: deleteWord1(text).trim(),
      line: dropLeadingSpaces(dropLeadingSpaces(raw, 1), 98),
    };
  }
  if (lingoEq(w1, "/spawn")) {
    return {
      kind: "spawn",
      args: deleteWord1(text).trim(),
      line: dropLeadingSpaces(dropLeadingSpaces(raw, 1), 98),
    };
  }
  if (lingoEq(w1, "/balance") || lingoEq(w1, "/deposit") || lingoEq(w1, "/withdraw")) {
    return { kind: "bank", text };
  }
  if (lingoEq(w1, "/drop")) {
    // Remove the first word, then one leading space.
    return { kind: "drop", item: dropLeadingSpaces(deleteWord1(text), 1) };
  }
  // Own keys only: a word like "constructor" or "__proto__" is not a command.
  const key = w1.toLowerCase();
  const admin = Object.hasOwn(ADMIN_WORD1, key) ? ADMIN_WORD1[key] : undefined;
  if (admin) {
    return { kind: "admin", cmd: admin, w2: lingoWord(text, 2), line: text };
  }
  if (text.startsWith("-")) {
    return { kind: "staffChat", typed: text };
  }
  if (lingoEq(w1, "accept") || lingoEq(w1, "reject")) {
    return {
      kind: "guildAnswer",
      accept: lingoEq(w1, "accept"),
      say: dropLeadingSpaces(dropLeadingSpaces(raw, 1), 98),
    };
  }
  if (lingoEq(w1, "/invite")) {
    return { kind: "guildInvite", name: dropLeadingSpaces(deleteWord1(text), 1) };
  }
  if (lingoEq(w1, "/g")) {
    let t = deleteWord1(text);
    if (t.startsWith("'")) {
      t = t.slice(1);
    }
    t = dropLeadingSpaces(t, 2);
    if (t.startsWith("'")) {
      t = t.slice(1);
    }
    return { kind: "guildChat", text: dropLeadingSpaces(t, 98) };
  }
  if (lingoEq(w1, "/msg")) {
    return { kind: "msg", text };
  }
  if (lingoEq(w1, "/friends")) {
    return { kind: "friends", friends: parseFriends(text) };
  }
  if (lingoEq(w1, "/ignorelist")) {
    return { kind: "ignoreList" };
  }
  if (lingoEq(w1, "/ignore")) {
    return { kind: "ignore", rest: ignoreRest(text) };
  }
  if (lingoEq(w1, "/unignore")) {
    return { kind: "unignore", rest: ignoreRest(text) };
  }
  if (lingoContains(w1, "Password=")) {
    return { kind: "password", password: passwordFrom(text) };
  }
  // Compare the whole line ignoring case, no trimming; `quit` is tested first.
  if (lingoEq(text, "quit")) {
    return { kind: "arenaQuit" };
  }
  if (lingoEq(text, "Challenge")) {
    return { kind: "arenaChallenge" };
  }
  if (UNBUILT_WORD1.some((c) => lingoEq(w1, c))) {
    return { kind: "unbuilt", command: w1 };
  }
  if (commandWord(w1)) {
    return { kind: "unknown", command: w1 };
  }
  // Local chat re-reads the field and deletes one leading space, then up to 98 more. A line with
  // nothing but spaces sends nothing, rather than `Bob says ""`.
  const say = dropLeadingSpaces(dropLeadingSpaces(raw, 1), 98);
  return say.trim() === "" ? null : { kind: "say", text: say };
}

/** True when `w1` looks like a command: `/`, a letter, then letters and digits. */
export function commandWord(w1: string): boolean {
  return /^\/[A-Za-z][A-Za-z0-9]*$/.test(w1);
}

/**
 * SSO's reply to a command that does not exist or that the typist may not use: the same either
 * way, so a player cannot learn the staff commands by trying them.
 */
export function unknownCommandText(command: string): string {
  return `Unknown command "${command}".`;
}

/** `"<name> says "<text>""`. */
export function formatSay(name: string, text: string): string {
  return `${name} says "${text}"`;
}

/** `<name> <text>`: `/me waves` gives `Bob  waves`. */
export function formatEmote(name: string, text: string): string {
  return `${name} ${text}`;
}

/** Built by the server from the sender's name. */
export function formatBroadcast(name: string, text: string): string {
  return `${name} broadcasts "${text}"`;
}

export const CHAT_TEXT = {
  /** Local chat from inside a house, too far from the door. */
  houseRefused: "You need to enter this building to talk",
  /** What a receiver hears of a quoted line spoken inside a house. */
  muffled: "You hear a muffled voice.",
  /** A broadcast attempt in jail. */
  jailShout: "You shout but no one can hear you!",
  /** HELP fallback. */
  noHelp: "There is no help on that subject!",
} as const;

/**
 * The broadcast cooldown refusal. Seconds round up, so any positive remainder still refuses and
 * the full 1,000-frame cooldown applies.
 */
export function broadcastRefusal(framesLeft: number): string | null {
  if (framesLeft <= 0) {
    return null;
  }
  return `You cannot broadcast yet - ${Math.ceil(framesLeft / 20)} seconds remaining.`;
}

/** SSO's local chat cooldown refusal. Seconds round up, so it never reads 0 while it refuses. */
export function chatRefusal(framesLeft: number): string | null {
  if (framesLeft <= 0) {
    return null;
  }
  return `You cannot chat yet - ${Math.ceil(framesLeft / 20)} seconds remaining.`;
}

/** A map whose name contains `H` is a house (case-insensitive substring matching). */
export function isHouseMap(mapName: string): boolean {
  return lingoContains(mapName, "H");
}

/** In a house you must be at y ≤ 10 to talk. */
export function sayRefusedInHouse(mapName: string, y: number): boolean {
  return y > 10 && isHouseMap(mapName);
}

/**
 * What a receiver sees of a `sqa` line: in a house at y > 10, any line with a quote mark is "You
 * hear a muffled voice." Broadcasts and system lines are not `sqa`.
 */
export function heardSqa(text: string, mapName: string, y: number): string {
  if (text.includes('"') && y > 10 && isHouseMap(mapName)) {
    return CHAT_TEXT.muffled;
  }
  return text;
}

/** The jail map (case-insensitive comparison). */
export function isJailMap(mapName: string): boolean {
  return lingoEq(mapName, "x0y0");
}

/** The who reply's chat line. */
export function whoCountLine(count: number): string {
  return count === 1 ? "There is 1 player logged on." : `There are ${count} players logged on.`;
}

/** SSO presence chat lines, off by default. */
export function presenceLine(name: string, on: boolean): string {
  return `${name} has logged ${on ? "on" : "off"}.`;
}

/**
 * Push lines to the victim. A weaker pusher only reads as too weak (a bug fixed: 1.6 printed both
 * lines and shoved anyway).
 */
export function pushLines(pusher: string, tooWeak: boolean): string[] {
  return tooWeak
    ? [`${pusher} attempts to shove you out of the way but is too weak.`]
    : [`${pusher} shoves you out of the way.`];
}

/** Chat line colours: palette indices as the original set `foreColor` (plus `staff` for SSO's staff chat). */
export const CHAT_COLOR = { normal: 0, broadcast: 4, death: 8, staff: 5 } as const;

/**
 * Whether the login news prints: only when it differs from the last news kept on this
 * computer (`getPref("GNEWS.txt")`, written by `setPref("GNEWS", …)`; Director adds the `.txt`, as
 * for every 1.6 pref). No kept news (a first run, or storage unavailable) prints it.
 */
export function newsIsNew(news: string, kept: string | null): boolean {
  return news !== kept;
}

/**
 * Director's Windows system palette, a hand table of the indices measured or read so far (not a
 * generated 256-entry palette, since the static ends other than 0, 4, 5, 6 and 8 are not measured).
 * - 0 #FFFFFF white: system lines and chat.
 * - 4 #FFFF00 yellow: broadcasts, the Yellow guild colour.
 * - 5 #00FF00 green: Neon Green, a heal on a player; measured on the running 1.6.
 * - 6 #FF0000 red: player damage floaties; measured on the running 1.6.
 * - 8 #A0A0A4 grey: the death line; measured on the running 1.6.
 * - 46 #CCCC33: a heal on a monster; measured on the running 1.6.
 * - 84 #9999FF: melee on a monster; index 84 of the 6×6×6 cube counted down from white.
 * - 103 #9900CC: Parry, Block; index 103 of the same cube.
 * - 124 #669933: arrow and spell damage on a monster; measured on the running 1.6.
 */
export const PALETTE_RGB: Readonly<Record<number, string>> = {
  0: "#FFFFFF",
  4: "#FFFF00",
  5: "#00FF00",
  6: "#FF0000",
  8: "#A0A0A4",
  46: "#CCCC33",
  84: "#9999FF",
  103: "#9900CC",
  124: "#669933",
};

/** The line every held attack frame prints off an arena tile on a no-fight map. */
export const CANNOT_FIGHT_TEXT = "You cannot fight here!";

/**
 * The two lines the server sends once per tick while a key is held (the attack key on a no-fight
 * map, tick.ts; an arrow in a web, movement.ts). The client collapses a repeat of exactly these
 * into one line with a ×N counter; every other line prints each time, as 1.6 did.
 */
export const REPEATING_LINES: ReadonlySet<string> = new Set([CANNOT_FIGHT_TEXT, WEB_TEXT]);
