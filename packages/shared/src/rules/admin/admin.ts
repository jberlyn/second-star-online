/**
 * Admin command rules, shared by the server (which runs every command) and the tests. Pure.
 */
import { classesData } from "@secondstaronline/data";

import { lingoContains, lingoEq } from "../core/lingo.ts";

export type Role = "player" | "moderator" | "immortal";

/**
 * The admin commands of 1.6's `ChatSend` grammar, plus SSO's `/role`, `/unban`, `/setclass`,
 * `/unjail` and `/banlist`.
 */
export type AdminCmd =
  | "save"
  | "refresh"
  | "cheatfile"
  | "unbanip"
  | "inventory"
  | "banip"
  | "location"
  | "iplookup"
  | "kick"
  | "warpscript"
  | "ban"
  | "warp"
  | "jail"
  | "pardon"
  | "warptome"
  | "warpmeto"
  | "role"
  | "unban"
  | "setclass"
  | "unjail"
  | "banlist";

/**
 * Who may run each command.
 * Moderators share most of the 1.6 admin commands, `/unban`, `/unjail` and `/banlist`; IP bans,
 * `/role` and `/setclass` remain immortal-only. Item creation (`/drop`) is immortal-only too, checked in `handleDrop`.
 */
export const ADMIN_ROLES: Readonly<Record<AdminCmd, readonly Role[]>> = {
  save: ["immortal", "moderator"],
  refresh: ["immortal", "moderator"],
  cheatfile: ["immortal", "moderator"],
  unbanip: ["immortal"], // an IP ban can lock out an immortal or the whole proxy
  inventory: ["immortal", "moderator"],
  banip: ["immortal"], // an IP ban can lock out an immortal or the whole proxy
  location: ["immortal", "moderator"],
  iplookup: ["immortal", "moderator"],
  kick: ["immortal", "moderator"],
  warpscript: ["immortal", "moderator"],
  ban: ["immortal", "moderator"],
  warp: ["immortal", "moderator"],
  jail: ["immortal", "moderator"],
  pardon: ["immortal", "moderator"],
  warptome: ["immortal", "moderator"],
  warpmeto: ["immortal", "moderator"],
  role: ["immortal"], // SSO
  unban: ["immortal", "moderator"], // SSO
  setclass: ["immortal"], // SSO
  unjail: ["immortal", "moderator"], // SSO
  banlist: ["immortal", "moderator"], // SSO
};

export function mayRun(cmd: AdminCmd, role: Role): boolean {
  return ADMIN_ROLES[cmd].includes(role);
}

/** The SSO additions: for anyone not allowed, the line is said as local chat, as 1.6 would have. */
export const SSO_ADMIN_CMDS: readonly AdminCmd[] = [
  "role",
  "unban",
  "setclass",
  "unjail",
  "banlist",
];

/**
 * Who may read and post to staff chat (`-text`): both staff roles (immortals and
 * moderators).
 */
export function usesStaffChat(role: Role): boolean {
  return role === "immortal" || role === "moderator";
}

/** The exact texts of the admin commands. */
export const ADMIN_TEXT = {
  kickDenied: "Only immortals/guides can kick players.",
  banDenied: "Only immortals can ban players.",
  /** (`/warp`, `/warpmeto`): moderators may run both despite the wording. */
  warpDenied: "Only immortals can warp players.",
  /** (`/warptome`). */
  warpToMeDenied: "Only immortals/guides can warp players.",
  warpscriptDenied: "Only staff can use /warpscript.",
  staffChatDenied: "Only immortals and moderators can use staff chat.",
  kicking: (name: string) => `*** kicking ${name}...`,
  /** The kicked player's chat line before the alert. */
  beingKicked: "*** You are being kicked.",
  banning: (name: string) => `*** banning ${name}...`,
  warping: (name: string) => `*** Warping ${name}...`,
  jailing: (name: string) => `*** Jailing ${name}...`,
  warpingYouTo: (name: string) => `*** Warping you to ${name}...`,
  warpscriptSet: (word: string) => `Warpscript set to: ${word}`,
  lookingUpIp: (name: string) => `Looking up IP address for ${name}...`,
  theIpIs: (ip: string) => `The IP is: ${ip}`,
  banningIp: (ip: string) => `Banning ${ip}...`,
  unbanningIp: (ip: string) => `Unbanning ${ip}...`,
  /** The where-am-I reply, with the location as `x-y`. */
  location: (map: string, x: number, y: number) => `You are at map: ${map} at position: ${x}-${y}`,
  /** The cheat list reply's first line. */
  cheatHeader: "* Cheater Log:",
  /** At login on a `BANNED!!!!!!` character file. */
  banned: "YOU ARE BANNED FROM PLAYING HERE ON THIS ACCOUNT!!",
  /**
   * The IP ban's text: written by the IP ban check but never shown in 1.6, whose IP ban did
   * nothing.
   */
  ipBanned: "You are banned from playing on this server.",
  // ---- SSO lines: the jail map, the role and unban chat commands, the set-class tool ----
  notOnline: (name: string) => `${name} is not online.`,
  noSuchCharacter: (name: string) => `There is no character called ${name}.`,
  noJail: "There is no jail map: save a map at X 0, Y 0 in the World Editor first.",
  warpUsage: "Usage: /warp <name> <map> <x> <y>, for example /warp Slim x1000y992 5 5",
  noMap: (map: string) => `There is no map ${map}.`,
  roleUsage: "Usage: /role <name> player, moderator or immortal",
  roleSelf: "You cannot change your own role.",
  roleSet: (name: string, role: Role) =>
    `${name} is now ${role === "immortal" ? "an" : "a"} ${role}.`,
  banSelf: "You cannot ban yourself.",
  unbanned: (name: string) => `${name} is no longer banned.`,
  notBanned: (name: string) => `${name} is not banned.`,
  kickImmortal: "Only an immortal can kick an immortal.",
  /** `/iplookup`, `/jail`, `/warp`, `/warptome` by a moderator on an immortal. */
  immortalTarget: "Only an immortal can do that to an immortal.",
  setClassUsage: "Usage: /setclass <name> <class name or number 1-26>",
  noSuchClass: (cls: string) => `There is no class called ${cls}.`,
  classSet: (name: string, cls: string) => `${name} is now a ${cls}.`,
} as const;

/** The jail map and tile of `/jail` (`"!!! !!! x0y0 4 4"`). */
export const JAIL = { map: "x0y0", x: 4, y: 4 } as const;

/**
 * A warp line as the original's warp routine reads it: items 3, 4 and 5 split on single spaces (so
 * a double space shifts them), a leading `x` deleted from the map, the rest split on `y`. `/warp`
 * sends the whole typed line (`"/warp Bob x5y5 3 4"`), and the server cuts it at the first `*` (the
 * second part split on `*`).
 *
 * Returns the map name and tile, or null when x or y is not a whole number on the map (SSO:
 * anything else does not parse as an integer, which 1.6 then wrote into the player's tile
 * unchecked). A map that does not exist is the caller's: the missing-map fallback.
 */
export function parseWarpLine(line: string): { map: string; x: number; y: number } | null {
  const items = (line.split("*")[0] ?? "").split(" ");
  let mapXY = items[2] ?? "";
  const xs = items[3] ?? "";
  const ys = items[4] ?? "";
  if (!/^\d+$/.test(xs) || !/^\d+$/.test(ys)) {
    return null;
  }
  const x = Number(xs);
  const y = Number(ys);
  if (x < 1 || x > 17 || y < 1 || y > 12) {
    return null;
  }
  if (lingoEq(mapXY.charAt(0), "x")) {
    mapXY = mapXY.slice(1);
  }
  const yAt = mapXY.indexOf("y");
  const mx = yAt < 0 ? mapXY : mapXY.slice(0, yAt);
  const rest = yAt < 0 ? "" : mapXY.slice(yAt + 1);
  const my = rest.split("y")[0] ?? "";
  return { map: `x${mx}y${my}`, x, y };
}

/**
 * Whether a broadcast message warps its speaker to a staff member with this `/warpscript` keyword:
 * case-insensitive whole-word/token matching against the broadcast message content only (never
 * the speaker's name or `"broadcasts"` wrapper), preventing accidental substring triggers.
 * An unset, empty, or `WARPSCRIPT_OFF` keyword is inactive.
 */
export function warpscriptMatches(keyword: string | null, message: string): boolean {
  if (keyword === null || keyword === "" || keyword === WARPSCRIPT_OFF) {
    return false;
  }
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^A-Za-z0-9_])${escaped}(?:$|[^A-Za-z0-9_])`, "i").test(message);
}

/** `/warpscript OFF` stores this keyword, which no one is likely to type. */
export const WARPSCRIPT_OFF = "iasdfji23j4ihfih23io4haklsq";

/**
 * The `-text` line as it goes out to the staff: the `-` and up to two spaces deleted, then up to
 * 98 more leading spaces, then `<... <name> tells the staff "<text>"`. An empty line still sends
 * `""`.
 */
export function formatStaffChat(name: string, typed: string): string {
  let t = typed.startsWith("-") ? typed.slice(1) : typed;
  for (let i = 0; i < 2 + 98 && t.startsWith(" "); i++) {
    t = t.slice(1);
  }
  return `<... ${name} tells the staff "${t}"`;
}

/**
 * `/Inventory`: the `Inventory` field of cast 2, which the server's inventory sorter fills with the
 * 15 bag lines as the server holds them, `Name-qty`, an empty line for an empty slot. Printed as
 * one block.
 */
export function inventoryLines(bag: readonly ({ item: string; qty: number } | null)[]): string[] {
  return bag.map((l) => (l ? `${l.item}-${l.qty}` : ""));
}

/** A cheat log line as the original writes it (`cheatLine`). */
export function cheatLine(name: string, ip: string, reason: string): string {
  return `${name} - at IP ${ip} - ${reason}`;
}

/** The cheat list reply (`cheatFileLines`): the header, then each non-empty entry, at most 300. */
export function cheatFileLines(entries: readonly string[]): string[] {
  return [ADMIN_TEXT.cheatHeader, ...entries.filter((e) => e !== "").slice(0, 300)];
}

/**
 * `/setclass`'s class: a class name from the class data, ignoring case (`Death Knight`), or its
 * code 1-26. Code 5 is tested twice when the original loads a character (both Swordsman), so each
 * code has one name.
 */
export function findClass(text: string): { code: number; name: string } | null {
  const t = text.trim().replace(/\s+/g, " ");
  if (/^\d+$/.test(t)) {
    const c = classesData.classes.find((k) => k.code === Number(t));
    return c ? { code: c.code, name: c.name } : null;
  }
  const c = classesData.classes.find((k) => lingoEq(k.name, t));
  return c ? { code: c.code, name: c.name } : null;
}

/** The class name for a code, or null. */
export function className(code: number): string | null {
  return classesData.classes.find((k) => k.code === code)?.name ?? null;
}
