/**
 * Typed server settings. Each setting has a default, a schema, an explanation for the operator's
 * tooltip and where it comes from. The database stores only the operator's overrides
 * (persistence/settings.ts); this module is pure.
 */

import { z } from "zod";

import { ARCHIVED_PRIZES, prizeLineOk, type SettingRow, TICK_HZ } from "@secondstaronline/shared";

const point = z.strictObject({
  map: z.string().regex(/^x-?\d+y-?\d+$/),
  x: z.number().int().min(1).max(17),
  y: z.number().int().min(1).max(12),
});
export type MapPoint = z.infer<typeof point>;

/** How the Settings window shows a setting (protocol `SettingRow`). */
export type SettingForm =
  | { kind: "point" }
  | { kind: "points" }
  | { kind: "int"; min: number; max: number }
  | { kind: "duration"; min: number; max: number; zero?: string }
  | { kind: "bool" }
  | { kind: "map" }
  | { kind: "maps" }
  | { kind: "zone" }
  | { kind: "prizes" }
  | { kind: "text" };

/** The Settings window's sections, in the order it shows them. */
export const SETTING_GROUPS = [
  "World",
  "Chat",
  "Items",
  "Server",
  "Moderation and security",
] as const;
export type SettingGroup = (typeof SETTING_GROUPS)[number];

interface SettingDef<T> {
  schema: z.ZodType<T>;
  default: T;
  /** The Settings window's section, label and control. */
  group: SettingGroup;
  label: string;
  form: SettingForm;
  /** Shown to operators in the settings form. */
  tooltip: string;
  /**
   * Where the default comes from: 1.6's value and where 1.6 kept it, or why SSO added the setting.
   * Nothing reads it.
   */
  source: string;
}

/** An IANA time zone this runtime knows. */
export function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone !== "";
  } catch {
    return false;
  }
}

/** The longest login news the Settings window takes (SSO; News.txt had no limit). */
export const NEWS_MAX = 1000;

function def<T>(d: SettingDef<T>): SettingDef<T> {
  return d;
}

const MINUTE = 60;
const HOUR = 3600;
export const DAY_SECONDS = 86_400;
const DAY = DAY_SECONDS;
/** Ten years, the longest /ban or /jail (shared `DURATION_MAX_MINUTES`). */
const TEN_YEARS = 3650 * DAY;

/**
 * A length of time, stored and sent in whole seconds; the Settings window reads and writes it as
 * time ("30s", "5m", "7d"). `zero` says what 0 means when it is allowed.
 */
function duration(min: number, max: number, zero?: string) {
  return {
    form: { kind: "duration" as const, min, max, ...(zero ? { zero } : {}) },
    schema: z.number().int().min(min).max(max),
  };
}

/** A setting's seconds as frames (1/20 s), the unit the world tick counts. */
export function secondsToTicks(seconds: number): number {
  return seconds * TICK_HZ;
}

export const SETTINGS = {
  startPoint: def({
    group: "World",
    label: "Starting map",
    form: { kind: "point" },
    schema: point,
    default: { map: "x1000y992", x: 6, y: 4 },
    tooltip:
      "Where new characters appear, and their first respawn point. Entering a no-fight, indoor, no-PvP map replaces their respawn point.",
    source:
      "SSO setting. Replaces the creation position x1000y992 6-4 that 1.6 hard-coded. 1.6 also sent travel to a missing map here; SSO refuses that travel instead.",
  }),
  fallbackPoint: def({
    group: "World",
    label: "Fallback map",
    form: { kind: "point" },
    schema: point,
    default: { map: "x1000y992", x: 5, y: 5 },
    tooltip:
      "Where characters go when their place is gone: their saved map was deleted or their house decayed. Also where a death or jail release goes if their respawn point's map is gone. Never use a tutorial map here.",
    source:
      "SSO setting. Replaces 1.6's Starting Map file (x0y102 5-5), which every death used because no 1.6 map saved a respawn point; keeps its tile on the seed map.",
  }),
  saveInterval: def({
    group: "Server",
    label: "Save every",
    ...duration(1, HOUR),
    default: 30,
    tooltip: "How often online characters are saved, besides saves on logout and map change.",
    source: "The original client uploaded its character file every 20-40 s.",
  }),
  chatMaxChars: def({
    group: "Chat",
    label: "Longest chat line",
    form: { kind: "int", min: 1, max: 500 },
    schema: z.number().int().min(1).max(500),
    default: 200,
    tooltip: "The longest chat line a player can send, in characters. Longer lines are cut.",
    source: "SSO addition. The original had no limit.",
  }),
  broadcastCooldown: def({
    group: "Chat",
    label: "Broadcast wait",
    ...duration(0, HOUR, "off"),
    default: 50,
    tooltip: "How long a player must wait between broadcasts (lines starting with ').",
    source:
      "1.6's broadcast cooldown of 1000 frames (50 s), unused in 1.6 because the registered flag was always 1; SSO applies it to everyone.",
  }),
  chatCooldown: def({
    group: "Chat",
    label: "Chat wait",
    ...duration(0, HOUR, "off"),
    default: 3,
    tooltip:
      "How long a player must wait between local chat lines and emotes. Also paces IMs, guild and room lines, mail and board posts.",
    source: "SSO addition. The original had no local chat limit.",
  }),
  mailBodyMax: def({
    group: "Chat",
    label: "Longest mail",
    form: { kind: "int", min: 1, max: 4000 },
    schema: z.number().int().min(1).max(4000),
    default: 2000,
    tooltip: "The longest mail body a player can send, in characters. Longer bodies are cut.",
    source:
      "SSO addition. 1.6 had only the compose box's limit and the multiuser server's ~2 MB message cap.",
  }),
  mailboxMax: def({
    group: "Chat",
    label: "Messages per mailbox",
    form: { kind: "int", min: 1, max: 1000 },
    schema: z.number().int().min(1).max(1000),
    default: 50,
    tooltip: "How many messages a mailbox holds. A new message past this drops the oldest one.",
    source: "SSO addition. 1.6 had no cap.",
  }),
  boardPostsMax: def({
    group: "Chat",
    label: "Posts per board",
    form: { kind: "int", min: 1, max: 1000 },
    schema: z.number().int().min(1).max(1000),
    default: 200,
    tooltip: "How many posts a message board keeps. A new post past this drops the oldest one.",
    source: "SSO addition. 1.6 kept every post in one file.",
  }),
  boardPostMax: def({
    group: "Chat",
    label: "Longest board post",
    form: { kind: "int", min: 1, max: 4000 },
    schema: z.number().int().min(1).max(4000),
    default: 300,
    tooltip: "The longest message board post, in characters. Longer posts are cut.",
    source: "SSO addition. 1.6's only cap was the post text box's 312x58 limit.",
  }),
  artBytesMax: def({
    group: "Chat",
    label: "Largest painting or photo",
    form: { kind: "int", min: 1024, max: 65536 },
    schema: z.number().int().min(1024).max(65536),
    default: 16384,
    tooltip:
      "The most bytes a saved painting or photo (a 64x64 PNG) may take. A bigger image is dropped.",
    source: "SSO addition. 1.6 stored whatever the client sent, any size and format.",
  }),
  announcePresence: def({
    group: "Chat",
    label: "Announce logons",
    form: { kind: "bool" },
    schema: z.boolean(),
    default: true,
    tooltip:
      "Tell every player when someone logs on or off. Used by the Friends list; prints nothing unless the next setting is on.",
    source: "1.6 sent 934/935 to @AllUsers; the operator toggle is an SSO addition.",
  }),
  presenceChatLines: def({
    group: "Chat",
    label: "Logon lines in chat",
    form: { kind: "bool" },
    schema: z.boolean(),
    default: false,
    tooltip:
      'Also print "<name> has logged on." and "<name> has logged off." in everyone\'s chat. Off in First Star Online 1.6.',
    source: "SSO addition. 1.6 printed nothing.",
  }),
  lootDecay: def({
    group: "Items",
    label: "Loot lasts",
    ...duration(MINUTE, 7 * DAY),
    default: 30 * MINUTE,
    tooltip:
      "How long items dropped by monsters stay on the ground. Player drops and items placed with /drop never disappear.",
    source:
      "SSO addition. The original never removed ground items; its 20 slots per map were the only limit.",
  }),
  npcChatter: def({
    group: "World",
    label: "NPC chatter every",
    ...duration(10, HOUR),
    default: 150,
    tooltip:
      "Time between an NPC's random lines (RND| lines in its NPC file), such as a God's. Everyone on the map sees them.",
    source:
      "1.6 rolled per player against a ladder that never scaled; 150 s was its average with one player on the map.",
  }),
  dropOnDeath: def({
    group: "Items",
    label: "Drop an item on death",
    form: { kind: "bool" },
    schema: z.boolean(),
    default: true,
    tooltip:
      "When a character dies, they may drop one random item from their bag (never crystals) on the spot where they died. Immortals always do.",
    source: '1.6\'s server settings file: "Chars Drop Items On Death: ON".',
  }),
  portalTargets: def({
    group: "World",
    label: "Portal targets",
    form: { kind: "points" },
    schema: z.array(point).max(30),
    default: [] as MapPoint[],
    tooltip:
      "Where a Portal spell can send players: one whose map exists is picked at random each time. With none, Portal cannot be cast.",
    source:
      "1.6's Portal file, read by the server's Portal handler: random(n) of its first 30 items. Its only entry, xbrinkybrink, is not a map, so in 1.6 Portal always ended on the fallback x1000y992 5-5.",
  }),
  hazardMap: def({
    group: "World",
    label: "Server Spirit map",
    form: { kind: "map" },
    schema: z
      .string()
      .regex(/^x-?\d+y-?\d+$/)
      .nullable(),
    default: null as string | null,
    tooltip:
      "A map where the Server Spirit throws fireballs and lightning bolts every 0.35 s. Empty turns it off.",
    source:
      "The @xSlimmySlimm sends of 1.6's timer script. No archived map has that name, so in 1.6 they hit nobody.",
  }),
  treasureMaps: def({
    group: "World",
    label: "Treasure maps",
    form: { kind: "maps" },
    schema: z.array(z.string().regex(/^x-?\d+y-?\d+$/)).max(100),
    default: [] as string[],
    tooltip:
      "The maps a buried treasure can be on. The server hides one treasure on one of them; whoever digs it up with a Shovel (1 dig in 5 on that map) gets a ring, a damaged sword or helm, a shield, boots or a gold pile, and a new treasure is hidden. Empty turns treasure off.",
    source:
      "The 21 maps of 1.6's treasure list. None of them is archived. The item list stays the original's.",
  }),
  houseDecayTimeZone: def({
    group: "World",
    label: "House decay time zone",
    form: { kind: "zone" },
    schema: z.string().refine(isTimeZone, "Pick a time zone from the list."),
    default: "UTC",
    tooltip:
      "The calendar the house decay sweep reads. A house survives while its owner was seen this month or last month; the month turns over at midnight in this time zone.",
    source:
      "1.6 used the month of the multiuser server's clock, relayed by whichever client last sent the month.",
  }),
  assassinPrizes: def({
    group: "Items",
    label: "Assassin prizes",
    form: { kind: "prizes" },
    schema: z
      .array(
        z
          .string()
          .max(60)
          .refine(prizeLineOk, "Each line is an item, an amount like 1000 Gold, or empty."),
      )
      .length(4),
    default: [...ARCHIVED_PRIZES],
    tooltip:
      "What the first, second, third and fourth place win when an Assassin's game ends: an item, or an amount like 1000 Gold. An empty line gives no prize from that place on. An item to a full bag is lost; gold always arrives.",
    source:
      '1.6\'s AssassinPrizes.txt, "Long Sword:1000 Gold:500 Gold:Knife", given when the game ends; SSO edits it with the File Editor.',
  }),
  news: def({
    group: "Chat",
    label: "Login news",
    form: { kind: "text" },
    schema: z.string().max(NEWS_MAX),
    default: "Welcome to First Star Online!",
    tooltip:
      "Printed in the chat when a player logs in, once per browser for each new text: change it to post news. Leave it empty for none.",
    source:
      "1.6's News.txt, sent at game entry and printed when it differs from the client's saved news preference. 1.6 operators edited the file by hand.",
  }),
  resumeGrace: def({
    group: "Server",
    label: "Reconnect grace",
    ...duration(0, 5 * MINUTE, "off"),
    default: 30,
    tooltip: "How long after a dropped connection a player can reconnect without logging in again.",
    source: "SSO addition (resumed sessions); the same 30 s grace as blackjack.",
  }),
  jailSentence: def({
    group: "Moderation and security",
    label: "Jail sentence",
    ...duration(MINUTE, TEN_YEARS),
    default: 10 * MINUTE,
    tooltip:
      "How long a /jail without a duration lasts. The sentence runs in real time, while the prisoner is offline too; when it ends they go to their respawn point (the Fallback map if its map is gone).",
    source:
      '1.6\'s server settings file had "Jail Sentence Time (1800 = 1 minute):8000" in frames, counted only while online and restarted on every entry. SSO stores sentences and counts them in real time.',
  }),
  banLength: def({
    group: "Moderation and security",
    label: "Ban length",
    ...duration(0, TEN_YEARS, "permanent"),
    default: 0,
    tooltip: "How long a /ban without a duration lasts. 0 makes it permanent until /unban.",
    source: "SSO addition. 1.6's bans were permanent.",
  }),
  ipBanLength: def({
    group: "Moderation and security",
    label: "IP ban length",
    ...duration(0, TEN_YEARS, "permanent"),
    default: 30 * DAY,
    tooltip:
      "How long a /banip without a duration lasts. 0 makes it permanent. Addresses are reassigned over time, so a permanent IP ban can lock out someone else later.",
    source: "SSO addition. 1.6's IP bans were permanent (and never checked).",
  }),
  addressHistory: def({
    group: "Moderation and security",
    label: "Keep login addresses",
    ...duration(0, TEN_YEARS, "forever"),
    default: 180 * DAY,
    tooltip:
      "How long an account's login addresses are kept for /banip <name> and /banlist after it last used them. 0 keeps them forever.",
    source: "SSO addition: /banip <name> needs the addresses an account has used.",
  }),
  chatLogRetention: def({
    group: "Moderation and security",
    label: "Keep chat log",
    ...duration(0, TEN_YEARS, "forever"),
    default: 90 * DAY,
    tooltip:
      "How long the chat log keeps each line players write to each other (say, /me, broadcasts, IMs, guild, rooms, staff chat, away texts and bios) for /chatlog and admin:chatlog. 0 keeps them forever.",
    source: "SSO addition. 1.6 logged no chat on the server.",
  }),
  auditLogRetention: def({
    group: "Moderation and security",
    label: "Keep audit log",
    ...duration(0, TEN_YEARS, "forever"),
    default: 0,
    tooltip:
      "How long the audit log keeps each staff action (admin commands, editor saves, setting and role changes, /chatlog lookups) for admin:audit. 0 keeps them forever. Bans, jails and pardons are kept regardless, for /banlist.",
    source: "SSO addition. 1.6 kept no audit log.",
  }),
  loginFailsPerIp: def({
    group: "Moderation and security",
    label: "Failed logins per address",
    form: { kind: "int", min: 0, max: 1000 },
    schema: z.number().int().min(0).max(1000),
    default: 20,
    tooltip:
      "How many failed logins one address (an IPv6 /64) may make in 5 minutes before further logins from it are refused. 0 turns the limit off. Moderators and immortals are not refused by it. A restart clears the counts.",
    source: "SSO addition. 1.6 had no limit.",
  }),
  loginFailsPerAccount: def({
    group: "Moderation and security",
    label: "Failed logins per account",
    form: { kind: "int", min: 0, max: 1000 },
    schema: z.number().int().min(0).max(1000),
    default: 5,
    tooltip:
      "How many wrong passwords one address may try on one account in 5 minutes before that pair is refused. 0 turns the limit off. A restart clears the counts.",
    source: "SSO addition. 1.6 had no limit.",
  }),
  createsPerIp: def({
    group: "Moderation and security",
    label: "New characters per address",
    form: { kind: "int", min: 0, max: 1000 },
    schema: z.number().int().min(0).max(1000),
    default: 3,
    tooltip:
      "How many characters one address (an IPv6 /64) may create in an hour. 0 turns the limit off. A restart clears the counts.",
    source: "SSO addition. 1.6 had no limit.",
  }),
  socketsPerIp: def({
    group: "Moderation and security",
    label: "Open connections per address",
    form: { kind: "int", min: 0, max: 1000 },
    schema: z.number().int().min(0).max(1000),
    default: 10,
    tooltip:
      "How many connections one address (an IPv6 /64) may hold open at once. 0 turns the limit off. A moderator or immortal's connection stops counting once logged in.",
    source: "SSO addition. 1.6 had no limit.",
  }),
} as const;

export type SettingKey = keyof typeof SETTINGS;
export type Settings = { [K in SettingKey]: (typeof SETTINGS)[K]["default"] };

export function defaultSettings(): Settings {
  const out: Record<string, unknown> = {};
  for (const [k, d] of Object.entries(SETTINGS)) {
    out[k] = structuredClone(d.default);
  }
  return out as Settings;
}

/**
 * Applies stored overrides (raw JSON text by key) over the defaults. An override that no
 * longer parses is ignored, so a bad row can never stop the server.
 */
export function resolveSettings(overrides: ReadonlyMap<string, string>): Settings {
  const out = defaultSettings() as Record<string, unknown>;
  for (const [key, raw] of overrides) {
    const d = Object.hasOwn(SETTINGS, key)
      ? (SETTINGS as Record<string, SettingDef<unknown>>)[key]
      : undefined;
    if (!d) {
      continue;
    }
    try {
      const parsed = d.schema.safeParse(JSON.parse(raw));
      if (parsed.success) {
        out[key] = parsed.data;
      }
    } catch {
      // ignore unparseable JSON
    }
  }
  return out as Settings;
}

/** The Settings window's rows (protocol `SettingRow`), section by section. */
export function settingRows(current: Settings): SettingRow[] {
  const order = (d: unknown) => SETTING_GROUPS.indexOf((d as SettingDef<unknown>).group);
  const defs = Object.entries(SETTINGS).sort(([, a], [, b]) => order(a) - order(b));
  return defs.map(([key, d]) => {
    const def = d as SettingDef<unknown>;
    return {
      key,
      group: def.group,
      label: def.label,
      tooltip: def.tooltip,
      ...def.form,
      value: structuredClone((current as Record<string, unknown>)[key]),
      default: structuredClone(def.default),
    };
  });
}

/**
 * Checks a Settings window SAVE against each setting's schema. Returns the new settings and
 * what changed (with the values before and after, for the audit log), or why the save is
 * refused: an unknown key or a value its schema refuses, named by its label.
 */
export function applySettingValues(
  current: Settings,
  values: Readonly<Record<string, unknown>>,
):
  | {
      ok: true;
      settings: Settings;
      changed: { key: SettingKey; before: unknown; after: unknown }[];
    }
  | { ok: false; key: string | null; error: string } {
  const next = structuredClone(current) as Record<string, unknown>;
  const changed: { key: SettingKey; before: unknown; after: unknown }[] = [];
  for (const [key, raw] of Object.entries(values)) {
    // `constructor`, `__proto__` and the rest of Object.prototype are not settings.
    const d = Object.hasOwn(SETTINGS, key)
      ? (SETTINGS as Record<string, SettingDef<unknown>>)[key]
      : undefined;
    if (!d) {
      return { ok: false, key: null, error: `There is no setting called ${key}.` };
    }
    const parsed = d.schema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false,
        key,
        error: `${d.label}: ${parsed.error.issues[0]?.message ?? "not allowed"}`,
      };
    }
    if (JSON.stringify(parsed.data) !== JSON.stringify(next[key])) {
      changed.push({ key: key as SettingKey, before: next[key], after: parsed.data });
      next[key] = parsed.data;
    }
  }
  return { ok: true, settings: next as Settings, changed };
}
