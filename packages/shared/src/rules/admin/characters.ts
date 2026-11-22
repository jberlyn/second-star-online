/**
 * The Control Panel's Characters page and player hub (issue #26): find a character, then see them in
 * one place, with their sheet, items, houses, moderation and history. 1.6 had nothing like it: staff
 * read and edited the character's text files by hand. Pure.
 */
import { content } from "../../content/store.ts";
import type { CharacterEditRow } from "./character-edit.ts";
import type { ChatLogRow } from "./chatlog.ts";
import {
  type AddressSeen,
  type ModerationArgs,
  type ModerationLogRow,
  type ModerationRecord,
  parseDuration,
} from "./moderation.ts";

/** The longest search the Characters page sends. */
export const CHARACTER_SEARCH_MAX = 20;
/** At most this many characters come back for one search. */
export const CHARACTER_SEARCH_LIMIT = 50;
/** How many of a character's newest chat lines the hub shows. */
export const HUB_CHAT_LINES = 50;
/** How many of an account's newest moderation entries the hub shows. */
export const HUB_HISTORY = 50;

/** One search result: enough to pick the right character. */
export interface CharacterListRow {
  name: string;
  level: number;
  classCode: number;
  /** The account's role name, or null for an ordinary player. */
  role: string | null;
  online: boolean;
  /** When the character was last saved (ISO). */
  lastSaved: string;
}

/** Where a character is right now. */
export type HubPresence =
  /** Playing, on a map. */
  | "playing"
  /** Online in the World Editor, the NPC Editor or the Control Panel (off the map). */
  | "editing"
  | "offline";

/**
 * A character as the hub shows it, read from the live character when they are online and from the
 * database when they are not, so the two always look the same.
 */
export interface CharacterSheet {
  name: string;
  sex: number;
  head: number;
  classCode: number;
  level: number;
  exp: number;
  expNeeded: number;
  hp: number;
  hpMax: number;
  sp: number;
  spMax: number;
  /** The allocated stats (class and medal points are not included). */
  stats: {
    str: number;
    sta: number;
    dex: number;
    int: number;
    wis: number;
  };
  /** One value per skill in the content store's `classes.skills`, index 0 = Slash. */
  skills: number[];
  hunger: number;
  /** `Fctnme`: 0 none, 1 Mage, 2 Warrior, 3 Adventurer. */
  faction: number;
  /** Frames of play left in the faction. */
  factionCount: number;
  wanted: boolean;
  position: { map: string; x: number; y: number; facing: string };
  /** The respawn point, or null for the operator's fallback point. */
  respawn: { map: string; x: number; y: number } | null;
  vehicle: string | null;
  /** Gold in hand as it is saved: the purse plus any blackjack stake held at the table. */
  gold: number;
  /** The bank balance, or null with no account yet. */
  bank: number | null;
  /** 15 lines; null is an empty line. */
  bag: ({ item: string; qty: number } | null)[];
  /** Worn gear by slot field (`weapon`, `offHand`, `head`, `body`, `feet`, `ring`); "NOTHING" when empty. */
  equip: Record<string, string>;
  vault: string[];
  spellbook: string[];
  /** The houses they own: the map each stands on and its interior's name. */
  houses: { map: string; interior: string }[];
}

/** The hub's whole page for one character. */
export interface CharacterHub {
  name: string;
  /** The account's role name, or null. */
  role: string | null;
  /** When the account was made (ISO). */
  created: string;
  /** When the character was last saved (ISO). */
  lastSaved: string;
  presence: HubPresence;
  sheet: CharacterSheet;
  /** What is in force now. */
  ban: ModerationRecord | null;
  jail: ModerationRecord | null;
  mute: ModerationRecord | null;
  /** Bans, jails, mutes, IP bans and pardons, oldest first (the newest `HUB_HISTORY`). */
  history: ModerationLogRow[];
  /** The newest chat lines, oldest first; only for a role with `chatlog`. */
  chat?: ChatLogRow[];
  /** The addresses the account played from, the latest first; only for a role with `banip`. */
  addresses?: AddressSeen[];
  /** The IP bans in force on those addresses; only for a role with `banip`. */
  ipBans?: HubIpBan[];
  /** Their role is not stopped by IP bans; sent with `ipBans`. */
  bypassesIpBans?: boolean;
  /** The character editor's log for them, newest first (the newest `HUB_EDITS`). */
  edits: CharacterEditRow[];
}

/** An IP ban in force on one of the character's addresses. */
export interface HubIpBan {
  address: string;
  actorName: string;
  actorRole: string;
  reason: string;
  createdAt: string;
  /** ISO time it ends, or null for permanent. */
  expiresAt: string | null;
}

/** What the hub's moderation buttons do: the chat commands of the same names. */
export const HUB_ACTIONS = ["kick", "ban", "unban", "jail", "unjail", "mute", "unmute"] as const;
export type HubAction = (typeof HUB_ACTIONS)[number];

/** The actions that take a length. */
export const TIMED_HUB_ACTIONS: readonly HubAction[] = ["ban", "jail", "mute"];

/** A class code's name, or `Class <code>` for one the content no longer lists. */
export function classLabel(code: number): string {
  return content().classes.classes.find((c) => c.code === code)?.name ?? `Class ${code}`;
}

const FACTION_LABELS = ["None", "Mage", "Warrior", "Adventurer"] as const;

/** A stored faction id's name. */
export function factionLabel(id: number): string {
  return FACTION_LABELS[id] ?? "None";
}

export const HUB_TEXT = {
  searchHelp: "Part of a character's name. Leave it empty to list the most recently saved.",
  noMatches: "No character's name contains that.",
  notFound: (name: string) => `There is no character named ${name}.`,
  badDuration: "That length is not one the server understands. Try 30m, 7d or perm.",
  /** A ban, jail or mute from the hub needs a reason (a kick takes none, nor does a lift). */
  needReason: "Give a reason. It is kept in the moderation log.",
  notAllowed: "Your role may not do that.",
} as const;

/**
 * A hub button's length and reason as the commands read them, or null for a length they do not
 * understand. An empty length uses the setting's default; the reason's spaces collapse as a typed
 * command's do.
 */
export function hubArgs(duration: string, reason: string): ModerationArgs | null {
  const words = reason
    .trim()
    .split(/\s+/)
    .filter((w) => w !== "");
  const d = duration.trim();
  if (d === "") {
    return { scope: null, duration: null, reason: words.join(" ") };
  }
  const parsed = parseDuration(d);
  return parsed === null || parsed === "bad"
    ? null
    : { scope: null, duration: parsed, reason: words.join(" ") };
}
