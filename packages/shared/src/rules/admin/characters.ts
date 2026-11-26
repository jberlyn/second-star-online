/**
 * The Control Panel's Characters page and player hub (issue #26): find a character, then see them in
 * one place, with their sheet, items, houses, moderation and history. 1.6 had nothing like it: staff
 * read and edited the character's text files by hand. Pure.
 */
import type { BalanceLevels } from "@secondstaronline/data";

import { content } from "../../content/store.ts";
import type { SkillValues } from "../core/fighter.ts";
import { factionByKey } from "../social/factions.ts";
import type { CharacterEditRow, HungerLimits } from "./character-edit.ts";
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
  /** Every skill the content lists, by skill key (`classes.skills`). */
  skills: SkillValues;
  hunger: number;
  /** The faction's key (`Fctnme`), or null for none. */
  faction: string | null;
  /** Frames of play left in the faction. */
  factionCount: number;
  wanted: boolean;
  /** Where it stands; `title` is the map's title, when it has one. */
  position: { map: string; title?: string; x: number; y: number; facing: string };
  /** The respawn point, or null for the operator's fallback point. */
  respawn: { map: string; title?: string; x: number; y: number } | null;
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
  /** The world's hunger limits for the editor (a client's store has no balance rows). */
  hunger: HungerLimits;
  /** The world's level curve and level rewards (the balance row `levels`), for the editor. */
  levels?: BalanceLevels;
  /** The houses they own, in the order they were built (issue #36). */
  houses: HubHouse[];
}

/** One house a character owns, as the hub lists it (issue #36). */
export interface HubHouse {
  /** The interior's map name, which names the house. */
  interior: string;
  /** The outdoor map it stands on, and its door (the exit) there. */
  map: string;
  x: number;
  y: number;
  /** The house type, or null when the content no longer lists one that matches. */
  type: string | null;
  /**
   * The Small Shops in its interior: each shopkeeper, the items it sells (its stock lines), how
   * many it holds in stock and its till.
   */
  shops: { npc: string; lines: number; stock: number; till: number }[];
  /** How many items the owner's House Vault holds (one vault, shared by all their houses). */
  vaultItems: number;
}

/** What one house's revoke or transfer will do, as the hub shows it before the admin confirms. */
export interface HousePreview {
  action: "revoke" | "transfer";
  owner: string;
  house: HubHouse;
  /** A transfer's new owner. */
  to?: string;
  /** The owner's House Vault and its contents. */
  vault: { name: string; items: string[] };
  /**
   * What happens to the vault: a revoke `destroyed` (the owner's last house) or `kept`; a transfer
   * `kept` (the old owner keeps another house) or `moved` into the new owner's vault (`merged` when
   * theirs already holds something).
   */
  vaultFate: "destroyed" | "kept" | "moved" | "merged";
  /** Each shop's stock (by item) and till: destroyed by a revoke, handed over by a transfer. */
  shops: { npc: string; stock: { item: string; qty: number }[]; till: number }[];
  /** The items on the interior's floor (a revoke destroys them; a transfer leaves them). */
  floor: { item: string; qty: number }[];
  /** The players standing inside: a revoke moves them out to the door. */
  inside: string[];
  /**
   * What a transfer renames for the new owner, as the hub names them: of "door", "mailbox",
   * "House Vault" and "header", those this house has in its owner's name. A guild hall's door and
   * vault are its guild's, a Small Shop has neither door nor mailbox, and a custom header stays.
   */
  renames: string[];
  /** The guild a guild hall's door and vault answer to, or null for a player's house. */
  guild: string | null;
  /** Names this preview: a revoke or transfer is refused when the house no longer matches it. */
  expect: string;
}

export const HOUSE_ADMIN_TEXT = {
  noHouse: (name: string) => `${name} does not own that house.`,
  changed: "The house changed since you looked. Look at what it holds again before you confirm.",
  noTarget: (name: string) => `There is no character named ${name}.`,
  sameOwner: (name: string) => `${name} already owns that house.`,
  notGuild: (name: string, guild: string) =>
    `${name} can't own a hall of ${guild}: they are not a member.`,
  vaultFull: (name: string, n: number, cap: number) =>
    `${name}'s House Vault would hold ${n} items, but holds at most ${cap}. Nothing changed.`,
  revoked: (owner: string, map: string) => `${owner}'s house on ${map} was demolished.`,
  transferred: (owner: string, map: string, to: string) =>
    `${owner}'s house on ${map} now belongs to ${to}.`,
  /** To the owner, when online. */
  toOwnerRevoked: (map: string) => `An admin has demolished your house on ${map}.`,
  toOwnerTransferred: (map: string, to: string) =>
    `An admin has given your house on ${map} to ${to}.`,
  toNewOwner: (map: string, from: string, door: boolean) =>
    `An admin has given you ${from}'s house on ${map}.${door ? " Your House Key opens its door." : ""}`,
  noMap: (map: string) =>
    `The map ${map} the house stands on is missing, so it can't be demolished.`,
} as const;

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

/** A saved faction's name: its row's, or the saved key of a faction the world no longer has. */
export function factionLabel(key: string | null): string {
  if (key === null) {
    return "None";
  }
  return factionByKey(key)?.name ?? key;
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
