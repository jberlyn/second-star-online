/**
 * Typed server settings. Each setting has a default, a schema, an explanation for the operator's
 * tooltip and where it comes from. The database stores only the operator's overrides
 * (persistence/settings.ts); this module is pure.
 */

import { z } from "zod";

import {
  ARCHIVED_PRIZES,
  type DeathDropKind,
  type DeathDropRules,
  type DeathDropWho,
  type HullRules,
  prizeLineOk,
  type SettingPage,
  type SettingRow,
  TICK_HZ,
} from "@secondstaronline/shared";

const point = z.strictObject({
  map: z.string().regex(/^x-?\d+y-?\d+$/),
  x: z.number().int().min(1).max(17),
  y: z.number().int().min(1).max(12),
});
export type MapPoint = z.infer<typeof point>;

/** How the Server Settings window shows a setting (protocol `SettingRow`). */
export type SettingForm =
  | { kind: "point" }
  | { kind: "points" }
  | { kind: "int"; min: number; max: number }
  | { kind: "duration"; min: number; max: number; zero?: string }
  | { kind: "bool" }
  | { kind: "choice"; choices: { value: string; label: string }[] }
  | { kind: "map" }
  | { kind: "maps" }
  | { kind: "zone" }
  | { kind: "prizes" }
  | { kind: "text" };

/**
 * The Server Settings window's sidebar pages, in order, grouped by what an operator is trying to
 * do. Every page here is a list of settings (`kind: "rows"`); the Roles and Staff pages bring their
 * own editors and are added by `settingPages` after these.
 */
export const SETTING_PAGES = [
  { id: "world", title: "World" },
  { id: "chat", title: "Chat and mail" },
  { id: "items", title: "Items" },
  { id: "moderation", title: "Moderation" },
  { id: "logins", title: "Logins" },
  { id: "records", title: "Logs" },
] as const;
export type SettingPageId = (typeof SETTING_PAGES)[number]["id"];

interface SettingDef<T> {
  schema: z.ZodType<T>;
  default: T;
  /** The Server Settings window's page, label and control. */
  page: SettingPageId;
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

/** The longest login news the Server Settings window takes (SSO; News.txt had no limit). */
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
 * A length of time, stored and sent in whole seconds; the Server Settings window reads and writes
 * it as time ("30s", "5m", "7d"). `zero` says what 0 means when it is allowed.
 */
/** A pick from a list: each value with the label the window shows for it. */
function choice<const T extends string>(labels: Record<T, string>) {
  const values = Object.keys(labels) as T[];
  return {
    form: {
      kind: "choice" as const,
      choices: values.map((value) => ({ value, label: labels[value] })),
    },
    schema: z.enum(values as [T, ...T[]]),
  };
}

function duration(min: number, max: number, zero?: string) {
  return {
    form: { kind: "duration" as const, min, max, ...(zero ? { zero } : {}) },
    schema: z.number().int().min(min).max(max),
  };
}

/** The Items page's death-drop settings, as the world tick reads them. */
export function deathDropRules(s: Settings): DeathDropRules {
  return {
    who: s.deathDrops,
    kind: s.deathDropKind,
    goldCap: s.deathDropGoldCap,
    minLevel: s.deathDropMinLevel,
  };
}

/** The World page's vehicle hull settings. */
export function hullRules(s: Settings): HullRules {
  return {
    airship: s.airshipHull,
    hitDamage: s.hullHitDamage,
    repairPerMinute: s.hullRepairPerMinute,
  };
}

/** A setting's seconds as frames (1/20 s), the unit the world tick counts. */
export function secondsToTicks(seconds: number): number {
  return seconds * TICK_HZ;
}

export const SETTINGS = {
  startPoint: def({
    page: "world",
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
    page: "world",
    label: "Fallback map",
    form: { kind: "point" },
    schema: point,
    default: { map: "x1000y992", x: 5, y: 5 },
    tooltip:
      "Where characters go when their place is gone: their saved map was deleted or their house decayed. Also where a death or jail release goes if their respawn point's map is gone. Never use a tutorial map here.",
    source:
      "SSO setting. Replaces 1.6's Starting Map file (x0y102 5-5), which every death used because no 1.6 map saved a respawn point; keeps its tile on the seed map.",
  }),
  chatMaxChars: def({
    page: "chat",
    label: "Longest chat line",
    form: { kind: "int", min: 1, max: 500 },
    schema: z.number().int().min(1).max(500),
    default: 200,
    tooltip: "The longest chat line a player can send, in characters. Longer lines are cut.",
    source: "SSO addition. The original had no limit.",
  }),
  broadcastCooldown: def({
    page: "chat",
    label: "Broadcast wait",
    ...duration(0, HOUR, "off"),
    default: 50,
    tooltip:
      "How long a player must wait between broadcasts (lines starting with '). Roles with the matching bypass permission skip it.",
    source:
      "1.6's broadcast cooldown of 1000 frames (50 s), unused in 1.6 because the registered flag was always 1; SSO applies it to everyone.",
  }),
  chatCooldown: def({
    page: "chat",
    label: "Chat wait",
    ...duration(0, HOUR, "off"),
    default: 3,
    tooltip:
      "How long a player must wait between local chat lines and emotes. Also paces IMs, guild and room lines, mail and board posts. Roles with the matching bypass permission skip it.",
    source: "SSO addition. The original had no local chat limit.",
  }),
  mailBodyMax: def({
    page: "chat",
    label: "Longest mail",
    form: { kind: "int", min: 1, max: 4000 },
    schema: z.number().int().min(1).max(4000),
    default: 2000,
    tooltip: "The longest mail body a player can send, in characters. Longer bodies are cut.",
    source:
      "SSO addition. 1.6 had only the compose box's limit and the multiuser server's ~2 MB message cap.",
  }),
  mailboxMax: def({
    page: "chat",
    label: "Messages per mailbox",
    form: { kind: "int", min: 1, max: 1000 },
    schema: z.number().int().min(1).max(1000),
    default: 50,
    tooltip: "How many messages a mailbox holds. A new message past this drops the oldest one.",
    source: "SSO addition. 1.6 had no cap.",
  }),
  boardPostsMax: def({
    page: "chat",
    label: "Posts per board",
    form: { kind: "int", min: 1, max: 1000 },
    schema: z.number().int().min(1).max(1000),
    default: 200,
    tooltip: "How many posts a message board keeps. A new post past this drops the oldest one.",
    source: "SSO addition. 1.6 kept every post in one file.",
  }),
  boardPostMax: def({
    page: "chat",
    label: "Longest board post",
    form: { kind: "int", min: 1, max: 4000 },
    schema: z.number().int().min(1).max(4000),
    default: 300,
    tooltip: "The longest message board post, in characters. Longer posts are cut.",
    source: "SSO addition. 1.6's only cap was the post text box's 312x58 limit.",
  }),
  artBytesMax: def({
    page: "chat",
    label: "Largest painting or photo",
    form: { kind: "int", min: 1024, max: 65536 },
    schema: z.number().int().min(1024).max(65536),
    default: 16384,
    tooltip:
      "The most bytes a saved painting or photo (a 64x64 PNG) may take. A bigger image is dropped.",
    source: "SSO addition. 1.6 stored whatever the client sent, any size and format.",
  }),
  announcePresence: def({
    page: "chat",
    label: "Announce logons",
    form: { kind: "bool" },
    schema: z.boolean(),
    default: true,
    tooltip:
      "Tell every player when someone logs on or off. Used by the Friends list; prints nothing unless the next setting is on.",
    source: "1.6 sent 934/935 to @AllUsers; the operator toggle is an SSO addition.",
  }),
  presenceChatLines: def({
    page: "chat",
    label: "Logon lines in chat",
    form: { kind: "bool" },
    schema: z.boolean(),
    default: false,
    tooltip:
      'Also print "<name> has logged on." and "<name> has logged off." in everyone\'s chat. Off in First Star Online 1.6.',
    source: "SSO addition. 1.6 printed nothing.",
  }),
  roleTags: def({
    page: "chat",
    label: "Role tags in chat",
    form: { kind: "bool" },
    schema: z.boolean(),
    default: false,
    tooltip:
      'Put a staff member\'s role name before their name when they talk, as in "[Admin] Berlyn says". Covers local chat, /me, broadcasts, chat rooms, guild chat and staff chat; IMs keep the plain name. Players get no tag.',
    source: "SSO addition (issue #7). 1.6 had no roles.",
  }),
  lootDecay: def({
    page: "items",
    label: "Loot lasts",
    ...duration(MINUTE, 7 * DAY),
    default: 30 * MINUTE,
    tooltip:
      "How long items dropped by monsters stay on the ground. Player drops and items placed with /drop never disappear.",
    source:
      "SSO addition. The original never removed ground items; its 20 slots per map were the only limit.",
  }),
  npcChatter: def({
    page: "world",
    label: "NPC chatter every",
    ...duration(10, HOUR),
    default: 150,
    tooltip:
      "Time between an NPC's random lines (RND| lines in its NPC file), such as a God's. Everyone on the map sees them.",
    source:
      "1.6 rolled per player against a ladder that never scaled; 150 s was its average with one player on the map.",
  }),
  deathDrops: def({
    page: "items",
    label: "Drops on death",
    ...choice({
      off: "Off",
      wanted: "Wanted only",
      pvp: "Killed by a player",
      everyone: "Everyone",
    }),
    default: "wanted" as DeathDropWho,
    tooltip:
      "Whose deaths drop gold or one random bag item (never crystals) where they died. Wanted only: characters wanted for murder. Killed by a player: anyone another player kills, and wanted characters however they die. Everyone: every death outside an arena, as in 1.6. A faction member killed on a PvP map drops the faction's head whatever this says, and a role with the drop-on-every-death permission always drops.",
    source:
      "1.6's server settings file: \"Chars Drop Items On Death: ON\", which dropped on every death. SSO defaults to wanted characters only, so monsters never take a player's gear.",
  }),
  deathDropKind: def({
    page: "items",
    label: "What drops on death",
    ...choice({ either: "Gold or an item", gold: "Gold only", items: "Items only" }),
    default: "either" as DeathDropKind,
    tooltip:
      "Gold or an item: a coin toss when the character carries gold, as in 1.6. Gold only: a death without gold drops nothing. Items only: gold is never dropped.",
    source: "SSO addition. 1.6 always chose between gold and an item.",
  }),
  deathDropGoldCap: def({
    page: "items",
    label: "Most gold dropped on death",
    form: { kind: "int", min: 0, max: 1_000_000_000 },
    schema: z.number().int().min(0).max(1_000_000_000),
    default: 200,
    tooltip:
      "The most gold a death drops, unless the character is wanted for murder: a wanted character can drop any amount up to all they carry. 0 means no cap.",
    source: "1.6 capped the gold drop at 200 unless wanted; the cap was fixed in its code.",
  }),
  deathDropMinLevel: def({
    page: "items",
    label: "No drops below level",
    form: { kind: "int", min: 0, max: 100_000 },
    schema: z.number().int().min(0).max(100_000),
    default: 0,
    tooltip:
      "Characters below this level drop nothing when they die, so new players keep their first gear. It does not protect a character wanted for murder. 0 protects no one.",
    source: "SSO addition.",
  }),
  portalTargets: def({
    page: "world",
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
    page: "world",
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
  airshipHull: def({
    page: "world",
    label: "Airship hull",
    form: { kind: "int", min: 1, max: 100_000 },
    schema: z.number().int().min(1).max(100_000),
    default: 80,
    tooltip:
      "How much damage an airship takes before it is shot down. Hits on a rider wear the hull, not the rider's HP. When it runs out, the airship is lost and the rider dies.",
    source: "SSO addition (issue #2). 1.6's riders took hits on their own HP.",
  }),
  hullHitDamage: def({
    page: "world",
    label: "Hull damage per hit",
    form: { kind: "int", min: 0, max: 100_000 },
    schema: z.number().int().min(0).max(100_000),
    default: 2,
    tooltip:
      "What one arrow or harmful spell takes off a vehicle's hull, whatever the attacker's level or power. 0 makes vehicles immune to them.",
    source:
      "SSO addition (issue #2). A fixed amount, so a strong character cannot wear a hull down faster than a cannon.",
  }),
  hullRepairPerMinute: def({
    page: "world",
    label: "Hull repair per minute parked",
    form: { kind: "int", min: 0, max: 100_000 },
    schema: z.number().int().min(0).max(100_000),
    default: 1,
    tooltip:
      "How much hull a parked vehicle regains for each minute it stays parked, up to full. There is no repair while riding. 0 turns repair off.",
    source: "SSO addition (issue #2).",
  }),
  treasureMaps: def({
    page: "world",
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
    page: "world",
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
    page: "items",
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
    page: "chat",
    label: "Login news",
    form: { kind: "text" },
    schema: z.string().max(NEWS_MAX),
    default: "Welcome to First Star Online!",
    tooltip:
      "Printed in the chat when a player logs in, once per browser for each new text: change it to post news. Leave it empty for none.",
    source:
      "1.6's News.txt, sent at game entry and printed when it differs from the client's saved news preference. 1.6 operators edited the file by hand.",
  }),
  jailSentence: def({
    page: "moderation",
    label: "Jail sentence",
    ...duration(MINUTE, TEN_YEARS),
    default: 10 * MINUTE,
    tooltip:
      "How long a /jail without a duration lasts. The sentence runs in real time, while the prisoner is offline too; when it ends they go to their respawn point (the Fallback map if its map is gone).",
    source:
      '1.6\'s server settings file had "Jail Sentence Time (1800 = 1 minute):8000" in frames, counted only while online and restarted on every entry. SSO stores sentences and counts them in real time.',
  }),
  muteLength: def({
    page: "moderation",
    label: "Mute length",
    ...duration(MINUTE, TEN_YEARS),
    default: 10 * MINUTE,
    tooltip:
      "How long a /mute without a duration lasts. It runs in real time, while the player is offline too. A muted player cannot chat, IM, post or mail, except an IM to staff.",
    source: "SSO addition. 1.6 had no mute.",
  }),
  banLength: def({
    page: "moderation",
    label: "Ban length",
    ...duration(0, TEN_YEARS, "permanent"),
    default: 0,
    tooltip: "How long a /ban without a duration lasts. 0 makes it permanent until /unban.",
    source: "SSO addition. 1.6's bans were permanent.",
  }),
  ipBanLength: def({
    page: "moderation",
    label: "IP ban length",
    ...duration(0, TEN_YEARS, "permanent"),
    default: 30 * DAY,
    tooltip:
      "How long a /banip without a duration lasts. 0 makes it permanent. Addresses are reassigned over time, so a permanent IP ban can lock out someone else later.",
    source: "SSO addition. 1.6's IP bans were permanent (and never checked).",
  }),
  addressHistory: def({
    page: "moderation",
    label: "Keep login addresses",
    ...duration(0, TEN_YEARS, "forever"),
    default: 180 * DAY,
    tooltip:
      "How long an account's login addresses are kept for /banip <name> and /banlist after it last used them. 0 keeps them forever.",
    source: "SSO addition: /banip <name> needs the addresses an account has used.",
  }),
  chatLogRetention: def({
    page: "records",
    label: "Keep chat log",
    ...duration(0, TEN_YEARS, "forever"),
    default: 90 * DAY,
    tooltip:
      "How long the chat log keeps each line players write to each other (say, /me, broadcasts, IMs, guild, rooms, staff chat, away texts and bios) for /chatlog and admin:chatlog. 0 keeps them forever.",
    source: "SSO addition. 1.6 logged no chat on the server.",
  }),
  auditLogRetention: def({
    page: "records",
    label: "Keep audit log",
    ...duration(0, TEN_YEARS, "forever"),
    default: 0,
    tooltip:
      "How long the audit log keeps each staff action (admin commands, editor saves, setting changes, role edits and assignments, /chatlog lookups) for admin:audit. 0 keeps them forever. Bans, jails and pardons are kept regardless, for /banlist.",
    source: "SSO addition. 1.6 kept no audit log.",
  }),
  loginFailsPerIp: def({
    page: "logins",
    label: "Failed logins per address",
    form: { kind: "int", min: 0, max: 1000 },
    schema: z.number().int().min(0).max(1000),
    default: 20,
    tooltip:
      "How many failed logins one address (an IPv6 /64) may make in 5 minutes before further logins from it are refused. 0 turns the limit off. Roles that bypass login limits are not refused by it. A restart clears the counts.",
    source: "SSO addition. 1.6 had no limit.",
  }),
  loginFailsPerAccount: def({
    page: "logins",
    label: "Failed logins per account",
    form: { kind: "int", min: 0, max: 1000 },
    schema: z.number().int().min(0).max(1000),
    default: 5,
    tooltip:
      "How many wrong passwords one address may try on one account in 5 minutes before that pair is refused. 0 turns the limit off. A restart clears the counts.",
    source: "SSO addition. 1.6 had no limit.",
  }),
  createsPerIp: def({
    page: "logins",
    label: "New characters per address",
    form: { kind: "int", min: 0, max: 1000 },
    schema: z.number().int().min(0).max(1000),
    default: 3,
    tooltip:
      "How many characters one address (an IPv6 /64) may create in an hour. 0 turns the limit off. A restart clears the counts.",
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

/** The Server Settings window's pages (protocol `SettingPage`), in sidebar order. */
export function settingPages(): SettingPage[] {
  return [
    ...SETTING_PAGES.map((p) => ({ id: p.id, title: p.title, kind: "rows" as const })),
    { id: "roles", title: "Roles", kind: "roles" },
    { id: "staff", title: "Staff", kind: "staff" },
  ];
}

/** The Server Settings window's rows (protocol `SettingRow`), page by page. */
export function settingRows(current: Settings): SettingRow[] {
  const order = (d: unknown) =>
    SETTING_PAGES.findIndex((p) => p.id === (d as SettingDef<unknown>).page);
  const defs = Object.entries(SETTINGS).sort(([, a], [, b]) => order(a) - order(b));
  return defs.map(([key, d]) => {
    const def = d as SettingDef<unknown>;
    return {
      key,
      page: def.page,
      label: def.label,
      tooltip: def.tooltip,
      ...def.form,
      value: structuredClone((current as Record<string, unknown>)[key]),
      default: structuredClone(def.default),
    };
  });
}

/**
 * Checks a Server Settings window SAVE against each setting's schema. Returns the new settings and
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
