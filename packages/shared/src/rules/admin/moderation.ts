/**
 * Moderation rules: who may ban, jail or pardon whom, the duration and reason grammar of the
 * moderation commands, IP address validation and the lines staff read. Pure: the server passes the
 * time in.
 *
 * Every ban, IP ban and jail stores the rank of the staff member who made it at that moment. A
 * moderator may act on players only; an immortal on anyone but themselves. Only the staff member who
 * made an action, or an immortal, may change or lift it, so moderators settle each other's bans with
 * the team rather than overriding them.
 */
import type { Role } from "./admin.ts";
import { can, outranks } from "./permissions.ts";

/**
 * Whether `actor` may ban, jail, pardon or IP-ban a character whose account has `target`'s role:
 * anyone they outrank, or anyone at all with `overrule`. Acting on yourself is refused separately.
 */
export function mayTarget(actor: Role, target: Role): boolean {
  return can(actor, "overrule") || outranks(actor, target);
}

/** A stored ban, IP ban or jail: who made it, at what rank, and until when. */
export interface ModerationRecord {
  actorId: string;
  actorName: string;
  actorRank: Role;
  reason: string;
  createdAt: string;
  /** ISO time it ends, or null for permanent. */
  expiresAt: string | null;
}

/** Whether a stored action is still in force at `now` (ISO times compare as text). */
export function isActive(r: { expiresAt: string | null } | null, now: string): boolean {
  return r !== null && (r.expiresAt === null || r.expiresAt > now);
}

/**
 * Whether `actor` may change or lift `existing`: the staff member who made it, or any immortal. A
 * lapsed action blocks nobody; the caller checks `isActive` first.
 */
export function mayChange(actor: { id: string; role: Role }, existing: ModerationRecord): boolean {
  return can(actor.role, "overrule") || existing.actorId === actor.id;
}

// ---- durations ---------------------------------------------------------------------------------

/** Ten years, the longest timed action. */
export const DURATION_MAX_MINUTES = 3650 * 24 * 60;

const UNIT_MINUTES: Readonly<Record<string, number>> = { m: 1, h: 60, d: 1440, w: 10080 };
const DURATION_SHAPE = /^(?:\d+[mhdw])+$/i;

/** A duration in minutes, or `"perm"` for permanent. */
export type Duration = number | "perm";

/**
 * Reads a duration word: `30m`, `12h`, `7d`, `2w` or a run of them (`1d12h`), ignoring case, or
 * `perm`/`permanent`. Returns null for a word that is not a duration, and `"bad"` for one that is
 * shaped like a duration but is zero or longer than ten years.
 */
export function parseDuration(word: string): Duration | "bad" | null {
  const w = word.toLowerCase();
  if (w === "perm" || w === "permanent") {
    return "perm";
  }
  if (!DURATION_SHAPE.test(w)) {
    return null;
  }
  let minutes = 0;
  for (const m of w.matchAll(/(\d+)([mhdw])/g)) {
    minutes += Number(m[1]) * (UNIT_MINUTES[m[2] ?? "m"] ?? 1);
  }
  return minutes > 0 && minutes <= DURATION_MAX_MINUTES ? minutes : "bad";
}

/** The end of an action of `d` (or the setting `fallbackMinutes`, where 0 is permanent). */
export function expiryOf(d: Duration | null, fallbackMinutes: number, now: string): string | null {
  const minutes = d === null ? fallbackMinutes : d;
  if (minutes === "perm" || minutes === 0) {
    return null;
  }
  return new Date(Date.parse(now) + minutes * 60_000).toISOString();
}

/** What follows the name in a moderation command. */
export interface ModerationArgs {
  /** `/banip <name>`'s `latest` or `all`; null when not given. */
  scope: "latest" | "all" | null;
  duration: Duration | null;
  reason: string;
}

/**
 * The words after the command and the name: an optional `latest`/`all` (when `scope` is allowed),
 * an optional duration, then the reason. Null when a duration-shaped word is out of range.
 */
export function parseModerationArgs(
  typed: string,
  opts: { scope?: boolean; duration?: boolean } = {},
): ModerationArgs | null {
  const words = typed.trim().split(/\s+/).slice(2);
  let scope: ModerationArgs["scope"] = null;
  if (opts.scope && words.length > 0) {
    const w = (words[0] ?? "").toLowerCase();
    if (w === "latest" || w === "all") {
      scope = w;
      words.shift();
    }
  }
  let duration: Duration | null = null;
  if (opts.duration !== false && words.length > 0) {
    const d = parseDuration(words[0] ?? "");
    if (d === "bad") {
      return null;
    }
    if (d !== null) {
      duration = d;
      words.shift();
    }
  }
  return { scope, duration, reason: words.join(" ") };
}

// ---- addresses ---------------------------------------------------------------------------------

/**
 * The key an address is banned and limited by: IPv4 as is, IPv6 expanded and cut to its first four
 * groups (a /64, so one subscriber's whole block counts as one address). Lenient: the gateway's
 * addresses are already valid, so anything else is keyed by its text.
 */
export function ipKey(ip: string): string {
  const bare = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (!bare.includes(":")) {
    return bare;
  }
  const noZone = bare.split("%")[0] ?? bare;
  const [head, tail] = noZone.split("::");
  const h = head ? head.split(":") : [];
  const t = tail === undefined ? [] : tail ? tail.split(":") : [];
  const groups =
    tail === undefined
      ? h
      : [...h, ...Array<string>(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t];
  return groups
    .slice(0, 4)
    .map((g) => Number.parseInt(g || "0", 16).toString(16))
    .join(":");
}

const parseIpv4 = (s: string): number[] | null => {
  const parts = s.split(".");
  if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)) {
    return null;
  }
  return parts.map(Number);
};

/** The eight 16-bit groups of an IPv6 address, or null. */
const parseIpv6 = (s: string): number[] | null => {
  if (!/^[0-9a-f:.]+$/i.test(s) || s.split("::").length > 2) {
    return null;
  }
  const parse = (part: string): number[] | null => {
    if (part === "") {
      return [];
    }
    const out: number[] = [];
    const items = part.split(":");
    for (const [i, g] of items.entries()) {
      if (g.includes(".")) {
        const v4 = i === items.length - 1 ? parseIpv4(g) : null;
        if (!v4) {
          return null;
        }
        out.push(((v4[0] ?? 0) << 8) | (v4[1] ?? 0), ((v4[2] ?? 0) << 8) | (v4[3] ?? 0));
      } else if (/^[0-9a-f]{1,4}$/i.test(g)) {
        out.push(Number.parseInt(g, 16));
      } else {
        return null;
      }
    }
    return out;
  };
  const [head, tail] = s.split("::");
  const h = parse(head ?? "");
  if (tail === undefined) {
    return h && h.length === 8 ? h : null;
  }
  const t = parse(tail);
  if (!h || !t || h.length + t.length > 7) {
    return null;
  }
  return [...h, ...Array<number>(8 - h.length - t.length).fill(0), ...t];
};

/**
 * A typed address checked and put in its standard form, with its ban key: IPv4 dotted, IPv6 in
 * lower-case compressed form (an IPv4-mapped IPv6 address is its IPv4 address). Null for anything
 * that is not a single address (names, ranges, zone ids).
 */
export function canonicalIp(text: string): { address: string; key: string } | null {
  const v4 = parseIpv4(text);
  if (v4) {
    const address = v4.join(".");
    return { address, key: address };
  }
  const g = parseIpv6(text);
  if (!g) {
    return null;
  }
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
    const a = `${(g[6] ?? 0) >> 8}.${(g[6] ?? 0) & 255}.${(g[7] ?? 0) >> 8}.${(g[7] ?? 0) & 255}`;
    return { address: a, key: a };
  }
  // RFC 5952: the longest run of two or more zero groups (the first on a tie) becomes `::`.
  let best = -1;
  let bestLen = 1;
  for (let i = 0; i < 8; ) {
    let j = i;
    while (j < 8 && g[j] === 0) {
      j++;
    }
    if (j - i > bestLen) {
      best = i;
      bestLen = j - i;
    }
    i = j === i ? i + 1 : j;
  }
  const hex = g.map((x) => x.toString(16));
  const address =
    best < 0
      ? hex.join(":")
      : `${hex.slice(0, best).join(":")}::${hex.slice(best + bestLen).join(":")}`;
  return { address, key: ipKey(address) };
}

/** How staff read an IP ban's key: IPv4 as is, IPv6 as its /64. */
export function keyLabel(key: string): string {
  return key.includes(":") ? `${canonicalIp(`${key}::`)?.address ?? key}/64` : key;
}

// ---- lines -------------------------------------------------------------------------------------

/** `2026-11-20T14:00:00.000Z` as `2026-11-20 14:00 UTC`. */
export function formatUtc(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/** When a stored action ends, in wall-clock ms: `Infinity` for a permanent one. */
export function endMs(expiresAt: string | null): number {
  return expiresAt === null ? Number.POSITIVE_INFINITY : Date.parse(expiresAt);
}

/** `endMs` back to the stored end: null for a permanent one. */
export function endIso(ms: number): string | null {
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** `until 2026-11-20 14:00 UTC` or `permanently`. */
export function untilText(expiresAt: string | null): string {
  return expiresAt === null ? "permanently" : `until ${formatUtc(expiresAt)}`;
}

/**
 * What a banned player reads at login and when kicked: 1.6's alert and when the ban ends. The
 * reason is for staff only and never reaches the player.
 */
export function banNotice(alert: string, expiresAt: string | null): string {
  return expiresAt === null
    ? `${alert} This ban is permanent.`
    : `${alert} Banned until ${formatUtc(expiresAt)}.`;
}

/** One `/banlist` row: `<who> - <until> - <actor> (<rank>)[: <reason>]`. */
export function banListLine(who: string, r: ModerationRecord, extra = ""): string {
  const until = r.expiresAt === null ? "permanent" : `until ${formatUtc(r.expiresAt)}`;
  const reason = r.reason === "" ? "" : `: ${r.reason}`;
  return `${who} - ${until} - ${r.actorName} (${r.actorRank})${extra}${reason}`;
}

/** One moderation action, as the server logs and applies it. */
export interface ModerationEntry {
  action: ModerationAction;
  accountId?: string | null;
  /** The jailed character (`jail`, `unjail`). */
  characterId?: string | null;
  characterName?: string | null;
  /** The IP ban's key and address (`ipban`, `unipban`). */
  ipKey?: string | null;
  address?: string | null;
  /** `/banip <name>`: the account whose address it was. */
  sourceAccountId?: string | null;
  actorId: string;
  actorName: string;
  actorRank: Role;
  reason: string;
  expiresAt: string | null;
  createdAt: string;
}

/** An IP ban in the table. */
export interface IpBanRecord extends ModerationRecord {
  key: string;
  address: string;
  sourceAccountId: string | null;
}

/** A ban or jail in force with the character it is on. */
export interface NamedRecord extends ModerationRecord {
  name: string;
}

export interface AddressSeen {
  address: string;
  key: string;
  lastSeen: string;
}

/** The moderation log's actions. */
export type ModerationAction =
  | "ban"
  | "unban"
  | "ipban"
  | "unipban"
  | "jail"
  | "unjail"
  | "mute"
  | "unmute"
  | "pardon";

/** One row of a character's moderation history. */
export interface ModerationLogRow {
  action: ModerationAction;
  /** The address for an IP ban, else null. */
  address: string | null;
  actorName: string;
  actorRank: Role;
  reason: string;
  createdAt: string;
  expiresAt: string | null;
}

/** A `/banlist <name>` history line: `2026-11-10 09:00 UTC ban 3d by Alice (moderator): spam`. */
export function historyLine(r: ModerationLogRow): string {
  const timed =
    r.action === "ban" || r.action === "jail" || r.action === "ipban" || r.action === "mute";
  const length = !timed
    ? ""
    : r.expiresAt === null
      ? " permanent"
      : ` ${durationText(Date.parse(r.expiresAt) - Date.parse(r.createdAt))}`;
  const what = r.address === null ? r.action : `${r.action} ${r.address}`;
  const reason = r.reason === "" ? "" : `: ${r.reason}`;
  return `${formatUtc(r.createdAt)} ${what}${length} by ${r.actorName} (${r.actorRank})${reason}`;
}

/** A length in the duration grammar: `3d`, `1d12h`, `45m`. */
export function durationText(ms: number): string {
  let m = Math.max(1, Math.round(ms / 60_000));
  const parts: string[] = [];
  for (const [unit, size] of [
    ["w", 10080],
    ["d", 1440],
    ["h", 60],
    ["m", 1],
  ] as const) {
    if (m >= size) {
      parts.push(`${Math.floor(m / size)}${unit}`);
      m %= size;
    }
  }
  return parts.join("");
}

/** The moderation commands' texts (the 1.6 echoes stay in `ADMIN_TEXT`). */
export const MODERATION_TEXT = {
  staffTarget: "Only an immortal can do that to staff.",
  jailSelf: "You cannot jail yourself.",
  badDuration:
    "A duration is a number with m, h, d or w (30m, 12h, 7d, 2w, 1d12h) up to 10 years, or perm.",
  banUsage: "Usage: /ban <name> [duration] [reason]",
  unbanUsage: "Usage: /unban <name> [reason]",
  jailUsage: "Usage: /jail <name> [duration] [reason]",
  unjailUsage: "Usage: /unjail <name> [reason]",
  banIpUsage:
    "Usage: /banip <name or address> [latest|all] [duration] [reason]; latest or all with a name only.",
  unbanIpUsage: "Usage: /unbanip <name or address> [reason]",
  banned: (name: string, expiresAt: string | null) => `${name} is banned ${untilText(expiresAt)}.`,
  banChanged: (name: string, expiresAt: string | null, was: string | null) =>
    `${name} is now banned ${untilText(expiresAt)} (was ${untilText(was)}).`,
  notYourBan: (name: string, by: string) =>
    `${name} was banned by ${by}; ask ${by} or an immortal.`,
  jailed: (name: string, expiresAt: string | null) => `${name} is jailed ${untilText(expiresAt)}.`,
  jailChanged: (name: string, expiresAt: string | null, was: string | null) =>
    `${name} is now jailed ${untilText(expiresAt)} (was ${untilText(was)}).`,
  notYourJail: (name: string, by: string) =>
    `${name} was jailed by ${by}; ask ${by} or an immortal.`,
  notJailed: (name: string) => `${name} is not jailed.`,
  unjailed: (name: string) => `${name} is released from jail.`,
  /** What the prisoner reads when jailed, and at login while the sentence runs. */
  youAreJailed: (expiresAt: string | null) => `You have been jailed ${untilText(expiresAt)}.`,
  /** A prisoner's IM to a player, or their guild, room, mail or board line. */
  prisonerSilenced: "You are in jail: only those near you and staff can hear you.",
  muteSelf: "You cannot mute yourself.",
  muteUsage: "Usage: /mute <name> [duration] [reason]",
  unmuteUsage: "Usage: /unmute <name> [reason]",
  muted: (name: string, expiresAt: string | null) => `${name} is muted ${untilText(expiresAt)}.`,
  muteChanged: (name: string, expiresAt: string | null, was: string | null) =>
    `${name} is now muted ${untilText(expiresAt)} (was ${untilText(was)}).`,
  notYourMute: (name: string, by: string) =>
    `${name} was muted by ${by}; ask ${by} or an immortal.`,
  notMuted: (name: string) => `${name} is not muted.`,
  unmuted: (name: string) => `${name} is no longer muted.`,
  /** What a muted player reads when muted and whenever they try to talk. */
  youAreMuted: (expiresAt: string | null) =>
    `You are muted ${untilText(expiresAt)}. You can still send an IM to staff.`,
  youAreUnmuted: "You are no longer muted.",
  pardonSelf: "You cannot pardon yourself.",
  warpSelf: "You cannot warp yourself.",
  /** A staff warp of a prisoner. */
  prisoner: (name: string) => `${name} is jailed; use /unjail.`,
  /** A staff warp of a player onto the jail map. */
  useJail: "Use /jail to put a player in jail.",
  noSuchTarget: (word: string) => `There is no character or address called ${word}.`,
  ipImmortal: "IP bans do not apply to immortals.",
  noAddresses: (name: string) => `${name} has no known addresses.`,
  ipBanned: (address: string, expiresAt: string | null) =>
    `Banned ${address} ${untilText(expiresAt)}.`,
  ipBannedFor: (n: number, name: string, expiresAt: string | null) =>
    `Banned ${n} ${n === 1 ? "address" : "addresses"} used by ${name} ${untilText(expiresAt)}.`,
  ipNotBanned: (address: string) => `${address} is not banned.`,
  noIpBans: (name: string) => `${name} has no IP bans.`,
  ipUnbanned: (address: string) => `${address} is no longer banned.`,
  ipUnbannedFor: (n: number, name: string) =>
    `Lifted ${n} IP ${n === 1 ? "ban" : "bans"} on addresses used by ${name}.`,
  addressesImmortal: "Only an immortal can look up addresses.",
  listBans: (page: number, pages: number) => `* Bans (page ${page} of ${pages}):`,
  listJails: "* Jailed:",
  listMutes: "* Muted:",
  listIpBans: "* IP bans:",
  listNone: "(none)",
  notModerated: (name: string) => `* ${name}: not banned, jailed or muted.`,
  historyAddresses: "* Addresses:",
  addressSeenWith: "* Seen with:",
} as const;

/** `/banlist` shows this many rows a page. */
export const BANLIST_PAGE = 10;
