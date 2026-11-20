/**
 * Roles and permissions. A role is a rank and a set of permissions; the server asks `can` before
 * every privileged action and every gameplay exemption, and never checks a role by name. Pure.
 *
 * The built-in roles reproduce SSO's three fixed roles exactly. Operator-defined roles replace
 * this table later (issue #7).
 */
import { ADMIN_COMMANDS, type AdminCmd, type Role } from "./admin.ts";

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
  /** Admin menu → Server Settings. */
  "settings",
  /** Chat → Admin Chat. */
  "adminChat",
  /** Admin menu → Begin (Lightning) Assassin's Game. */
  "assassinGame",
  /** Change or lift any staff member's ban or jail, and act on staff of your own rank. */
  "overrule",
] as const;

/** Exemptions from the rules every character plays by. */
export const EXEMPTIONS = [
  /** Takes no damage from monsters or melee. */
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
] as const;

export type ToolPermission = (typeof TOOL_PERMISSIONS)[number];
export type Exemption = (typeof EXEMPTIONS)[number];
export type Permission = AdminCmd | ToolPermission | Exemption;

export const PERMISSIONS: readonly Permission[] = [
  ...ADMIN_COMMANDS,
  ...TOOL_PERMISSIONS,
  ...EXEMPTIONS,
];

/** A role: who it outranks and what it may do. */
export interface RoleDef {
  id: Role;
  /** 0 is an ordinary player; any higher rank is staff. */
  rank: number;
  permissions: ReadonlySet<Permission>;
}

/** The commands moderators share with immortals (the original moderation set and SSO's). */
const MODERATOR_PERMISSIONS: readonly Permission[] = [
  "save",
  "refresh",
  "inventory",
  "location",
  "iplookup",
  "kick",
  "warpscript",
  "ban",
  "warp",
  "jail",
  "pardon",
  "warptome",
  "warpmeto",
  "unban",
  "unjail",
  "banlist",
  // An operator behind a shared address must still get in.
  "bypassLoginLimits",
];

export const BUILTIN_ROLES: Readonly<Record<Role, RoleDef>> = {
  player: { id: "player", rank: 0, permissions: new Set() },
  moderator: { id: "moderator", rank: 1, permissions: new Set(MODERATOR_PERMISSIONS) },
  immortal: { id: "immortal", rank: 2, permissions: new Set(PERMISSIONS) },
};

/** Whether `role` holds `permission`. */
export function can(role: Role, permission: Permission): boolean {
  return BUILTIN_ROLES[role].permissions.has(permission);
}

export function rankOf(role: Role): number {
  return BUILTIN_ROLES[role].rank;
}

/** Staff: any role above an ordinary player. Staff read and post staff chat. */
export function isStaff(role: Role): boolean {
  return rankOf(role) > 0;
}

/** Whether `a` ranks strictly above `b`. */
export function outranks(a: Role, b: Role): boolean {
  return rankOf(a) > rankOf(b);
}
