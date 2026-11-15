/** The Assassin's game, guilds, friends and bios. */
import { z } from "zod";

import { NAME_MAX } from "../rules/progression/creation.ts";
import type { GuildAlignment, GuildScreen } from "../rules/social/guilds.ts";

/**
 * Admin menu → Begin Assassin's Game (`GO`), Begin Lightning Assassin's Game (`LIGHTNING`) or End
 * Assassin's Game (`STOP`): sent at once with no confirmation. Immortals only; anyone else is
 * silently refused.
 */
export const assassinGameSchema = z.strictObject({
  t: z.literal("assassinGame"),
  mode: z.enum(["GO", "LIGHTNING", "STOP"]),
});

const guildAlignment = z.enum(["G", "N", "E"]);

/** A guild's name as the client holds it: up to the sanitiser's 100 characters. */
const guildName = z.string().max(100);

/**
 * Create's OK: the field as typed and the selected alignment. The server sanitises; more than 100
 * characters is a forged intent.
 */
export const guildCreateSchema = z.strictObject({
  t: z.literal("guildCreate"),
  name: guildName,
  alignment: guildAlignment,
});

/** CANCEL in create mode (275) or OK as a member or leader (288): the screen closes. */
export const guildCloseSchema = z.strictObject({ t: z.literal("guildClose") });

/** The guild list's OK: view the selected guild, stale or empty. */
export const guildViewSchema = z.strictObject({
  t: z.literal("guildView"),
  name: z.string().max(200),
});

/**
 * Leave (289), Disband (291), Exile (292) and Abdicate (293). `viewing` is the guild name field,
 * the guild on screen, which each script first compares with your own; `member` is the selected
 * name.
 */
export const guildActionSchema = z.strictObject({
  t: z.literal("guildAction"),
  act: z.enum(["leave", "disband", "exile", "abdicate"]),
  viewing: z.string().max(200),
  member: z.string().max(NAME_MAX).optional(),
});

/**
 * A bio request (`$*+`): the player menu's Bio names the clicked player by id, the Who window's
 * Profile by name.
 */
export const bioRequestSchema = z.strictObject({
  t: z.literal("bioRequest"),
  id: z.string().max(64).optional(),
  name: z.string().max(200).optional(),
});

/**
 * Your own Bio window closed: the editable box is saved. Bounded, not a game rule: the
 * server cuts it to 500.
 */
export const profileSaveSchema = z.strictObject({
  t: z.literal("profileSave"),
  text: z.string().max(4000),
});

/** The Friends window's Remove, given the selected line. */
export const friendRemoveSchema = z.strictObject({
  t: z.literal("friendRemove"),
  name: z.string().min(1).max(200),
});

export type SocialServerMsg =
  /** The Guild Center (frame 72): opens on its mode, or closes (null, after "Guild Created"). */
  | { t: "guild"; screen: GuildScreen | null }
  /** `GLDLST` → the guild list: the guild names in creation order, up to 200. */
  | { t: "guildList"; names: string[] }
  /** A guild's fields; a null alignment leaves the buttons as they were. */
  | {
      t: "guildView";
      name: string;
      alignment: GuildAlignment | null;
      leader: string;
      members: string[];
    }
  /**
   * The Friends window's lines, online buddies in the server's spelling, sent whenever they change,
   * and refilled at game entry and Return To Game (frame 50). 1.6 opened the window itself at every
   * game entry; SSO opens it only from Game > Open Friend's List (a divergence: a popup at every
   * login gets in the way).
   */
  | { t: "friends"; names: string[] }
  /**
   * A player's bio as the Bio window draws it for you: the window title, the bio's lines, the
   * profile, the medal ids, and `own` for your editable layout.
   */
  | {
      t: "playerBio";
      title: string;
      bio: string[];
      profile: string;
      medals: string[];
      own: boolean;
    };
