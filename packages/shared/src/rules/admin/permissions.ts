/**
 * Roles and permissions. A role is a display name, a rank and a set of permissions; the server
 * asks `can` before every privileged action and every gameplay exemption, and never checks a role
 * by name. An account holds at most one role; an account with none is an ordinary player (rank 0,
 * no permissions, no chat tag). Any role makes an account staff. Pure.
 *
 * The operator defines the roles (the server keeps them in the database and edits them in the
 * Server Settings window); `DEFAULT_ROLES` are the ones a new server starts with.
 */
import { ADMIN_COMMANDS, type AdminCmd } from "./admin.ts";

/** Privileged tools that are not chat commands. */
export const TOOL_PERMISSIONS = [
  /** `/drop`: create items and gold. */
  "drop",
  /** `/spawn`: place a rostered monster. */
  "spawn",
  /** `/roster`: read and set a map's monster roster. */
  "roster",
  /** Admin menu → World Editor. */
  "worldEditor",
  /** Admin menu → NPC Editor. */
  "npcEditor",
  /** Control Panel → Server Settings, which also edits and assigns the roles. */
  "settings",
  /** Control Panel: create, edit and remove items, monsters and NPCs. */
  "contentEditor",
  /** Control Panel: edit a character's stats, items and state. */
  "characterEditor",
  /** Control Panel: read the player activity log. */
  "activityLog",
  /** Chat → Admin Chat. */
  "adminChat",
  /** Admin menu → Begin (Lightning) Assassin's Game. */
  "assassinGame",
  /** Change or lift any staff member's ban, jail or mute, and act on staff of your own rank. */
  "overrule",
  /** `/pardon` your own character. */
  "pardonSelf",
  /** `/warp` your own character. */
  "warpSelf",
] as const;

/** Exemptions from the rules every character plays by. */
export const EXEMPTIONS = [
  /** Takes no damage: monsters, melee, spells and starving. */
  "invulnerable",
  /** Never gets hungry. */
  "noHunger",
  /** Cannot be shoved. */
  "unpushable",
  /** Never appears on the high scores. */
  "noHighScores",
  /** IP bans do not apply. */
  "bypassIpBan",
  /** Never refused by the per-address login and socket limits. */
  "bypassLoginLimits",
  /** Drops on every death, whatever the death-drop settings say (for testing them). */
  "dropOnEveryDeath",
  /** Not held back by the chat cooldown. */
  "bypassChatCooldown",
  /** Not held back by the broadcast cooldown. */
  "bypassBroadcastCooldown",
] as const;

export type ToolPermission = (typeof TOOL_PERMISSIONS)[number];
export type Exemption = (typeof EXEMPTIONS)[number];
export type Permission = AdminCmd | ToolPermission | Exemption;

export const PERMISSIONS: readonly Permission[] = [
  ...ADMIN_COMMANDS,
  ...TOOL_PERMISSIONS,
  ...EXEMPTIONS,
];

const PERMISSION_SET: ReadonlySet<string> = new Set(PERMISSIONS);

export function isPermission(s: string): s is Permission {
  return PERMISSION_SET.has(s);
}

/** How the Server Settings window's Roles page groups and names the permissions. */
export const PERMISSION_GROUPS = [
  { id: "commands", title: "Commands" },
  { id: "tools", title: "Tools" },
  { id: "exemptions", title: "Exemptions" },
] as const;
export type PermissionGroup = (typeof PERMISSION_GROUPS)[number]["id"];

const TOOL_LABELS: Record<ToolPermission, string> = {
  drop: "/drop: create items and gold",
  spawn: "/spawn: place a rostered monster",
  roster: "/roster: read and set a map's monsters",
  worldEditor: "World Editor",
  npcEditor: "NPC Editor",
  settings: "Server Settings, roles and staff",
  contentEditor: "Control Panel: edit items, monsters and NPCs",
  characterEditor: "Control Panel: edit characters",
  activityLog: "Control Panel: read the player activity log",
  adminChat: "Admin Chat room",
  assassinGame: "Start and stop the Assassin's Game",
  overrule: "Overrule: change anyone's ban, jail or mute, and act on staff of the same rank",
  pardonSelf: "/pardon yourself",
  warpSelf: "/warp yourself",
};

const EXEMPTION_LABELS: Record<Exemption, string> = {
  invulnerable: "Takes no damage (monsters, players, spells and starving)",
  noHunger: "Never gets hungry",
  unpushable: "Cannot be pushed",
  noHighScores: "Left off the high scores",
  bypassIpBan: "Not stopped by IP bans",
  bypassLoginLimits: "Not stopped by the per-address login limits",
  dropOnEveryDeath: "Drops on every death (for testing the death-drop settings)",
  bypassChatCooldown: "Skips the chat cooldown",
  bypassBroadcastCooldown: "Skips the broadcast cooldown",
};

/** A permission's group and the label the Roles page shows beside its box. */
export function permissionInfo(p: Permission): { group: PermissionGroup; label: string } {
  if ((ADMIN_COMMANDS as readonly string[]).includes(p)) {
    return { group: "commands", label: `/${p}` };
  }
  if (p in TOOL_LABELS) {
    return { group: "tools", label: TOOL_LABELS[p as ToolPermission] };
  }
  return { group: "exemptions", label: EXEMPTION_LABELS[p as Exemption] };
}

/**
 * The permissions that open a Control Panel page: holding any one shows the Control Panel and lets the
 * server open it. A page's own requests still need its own permission. Each Control Panel page adds its
 * permission here when it arrives.
 */
export const CONTROL_PANEL_PERMISSIONS: readonly Permission[] = ["settings", "activityLog"];

/** Whether `role` may open the Control Panel (it holds a permission with a page there). */
export function canOpenControlPanel(role: Role | undefined): boolean {
  return CONTROL_PANEL_PERMISSIONS.some((p) => can(role, p));
}

/** A role: its name, who it outranks and what it may do. */
export interface RoleDef {
  /** A short lowercase id (`moderator`), kept when the display name changes. */
  id: string;
  /** What players and staff read: the chat tag (`[Admin]`), `/banlist` and the settings window. */
  name: string;
  /** Who acts on whom: 1 or more (an account with no role is rank 0). */
  rank: number;
  permissions: ReadonlySet<Permission>;
}

/** The role an account holds, or null for an ordinary player. */
export type Role = RoleDef | null;

/**
 * A moderator is an ordinary player who moderates others: no warps, nothing on themselves and no
 * gameplay exemptions. `/pardon`, `/iplookup`, `/save` and `/Refresh` are administrators' too.
 */
const MODERATOR_PERMISSIONS: readonly Permission[] = [
  "inventory",
  "location",
  "kick",
  "ban",
  "unban",
  "jail",
  "unjail",
  "mute",
  "unmute",
  "banlist",
  // An operator behind a shared address must still get in.
  "bypassLoginLimits",
];

export const MODERATOR: RoleDef = {
  id: "moderator",
  name: "Moderator",
  rank: 1,
  permissions: new Set(MODERATOR_PERMISSIONS),
};

export const ADMINISTRATOR: RoleDef = {
  id: "administrator",
  name: "Admin",
  rank: 2,
  permissions: new Set(PERMISSIONS),
};

/** The roles a new server starts with (the roles migration writes the same). */
export const DEFAULT_ROLES: readonly RoleDef[] = [MODERATOR, ADMINISTRATOR];

/** Whether `role` holds `permission`. An ordinary player holds none. */
export function can(role: Role | undefined, permission: Permission): boolean {
  return role?.permissions.has(permission) ?? false;
}

/** 0 for an ordinary player. */
export function rankOf(role: Role | undefined): number {
  return role?.rank ?? 0;
}

/** Staff: any account with a role. Staff read and post staff chat and take IMs from prisoners. */
export function isStaff(role: Role | undefined): boolean {
  return role !== null && role !== undefined;
}

/** Whether `a` ranks strictly above `b`. */
export function outranks(a: Role | undefined, b: Role | undefined): boolean {
  return rankOf(a) > rankOf(b);
}

/** Whether the role holds every permission (at least one role must, so no one is locked out). */
export function hasEveryPermission(role: { permissions: ReadonlySet<string> }): boolean {
  return PERMISSIONS.every((p) => role.permissions.has(p));
}

/** A role as the wire and the database carry it. */
export interface RoleData {
  id: string;
  name: string;
  rank: number;
  permissions: string[];
}

export const ROLE_LIMITS = { idMax: 20, nameMax: 16, rankMax: 100 } as const;
const ROLE_ID = /^[a-z][a-z0-9_-]*$/;
/** Ids a role may not take: `none` is the CLI's word for no role, and a player has no role. */
const RESERVED_IDS = new Set(["none", "player"]);

/** Why a role definition is refused, or null. Unknown permissions are refused. */
export function roleDataError(r: RoleData): string | null {
  if (r.id.length === 0 || r.id.length > ROLE_LIMITS.idMax || !ROLE_ID.test(r.id)) {
    return `A role id is 1 to ${ROLE_LIMITS.idMax} lowercase letters, digits, - or _, starting with a letter.`;
  }
  if (RESERVED_IDS.has(r.id)) {
    return `A role cannot be called ${r.id}.`;
  }
  const name = r.name.trim();
  if (name.length === 0 || name.length > ROLE_LIMITS.nameMax || name !== r.name) {
    return `A role's name is 1 to ${ROLE_LIMITS.nameMax} characters, with no spaces at either end.`;
  }
  if (/[[\]"\p{Cc}]/u.test(name)) {
    return "A role's name cannot hold brackets, quotes or control characters.";
  }
  if (!Number.isInteger(r.rank) || r.rank < 1 || r.rank > ROLE_LIMITS.rankMax) {
    return `A role's rank is a whole number from 1 to ${ROLE_LIMITS.rankMax}.`;
  }
  const bad = r.permissions.find((p) => !isPermission(p));
  if (bad !== undefined) {
    return `There is no permission called ${bad}.`;
  }
  return null;
}

/** A stored or sent role as the rules use it; unknown permissions are dropped. */
export function roleFromData(r: RoleData): RoleDef {
  return {
    id: r.id,
    name: r.name,
    rank: r.rank,
    permissions: new Set(r.permissions.filter(isPermission)),
  };
}

/** A role as it is stored and sent, its permissions in `PERMISSIONS` order. */
export function roleToData(r: RoleDef): RoleData {
  return {
    id: r.id,
    name: r.name,
    rank: r.rank,
    permissions: PERMISSIONS.filter((p) => r.permissions.has(p)),
  };
}

/** The name as chat shows it: `[Admin] Berlyn` when role tags are on and the speaker has a role. */
export function taggedName(name: string, role: Role | undefined, tags: boolean): string {
  return tags && role ? `[${role.name}] ${name}` : name;
}

/** The refusal when a change would leave no role holding every permission. */
export const LOCKOUT_TEXT =
  "At least one role must keep every permission, so the server can always be run.";

/** Why a new set of roles is refused: none holds every permission. Null when fine. */
export function rolesError(roles: readonly { permissions: ReadonlySet<string> }[]): string | null {
  return roles.some(hasEveryPermission) ? null : LOCKOUT_TEXT;
}

/** The Roles and Staff pages' replies. */
export const ROLE_TEXT = {
  taken: (id: string) => `There is already a role called ${id}.`,
  noRole: (id: string) => `There is no role called ${id}.`,
  saved: (name: string) => `Saved ${name}. Everyone who holds it has its permissions now.`,
  deleted: (name: string) => `Deleted ${name}. Its accounts have no role now.`,
  self: "You cannot change your own role. Ask another administrator, or use bun run admin:role.",
  unchanged: (name: string) => `${name} already has that role.`,
  assigned: (name: string, role: string | null) =>
    role === null ? `${name} has no role now.` : `${name} is now ${role}.`,
} as const;
