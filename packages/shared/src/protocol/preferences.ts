/** Player settings (per-account preferences), ignore list management, and Who's Online opener. */
import { z } from "zod";

import { type PlayerPreferences, playerPrefsPatchSchema } from "../rules/core/preferences.ts";
import { NAME_MAX } from "../rules/progression/creation.ts";
import { CHAT_INPUT_MAX } from "./chat.ts";

/** Max length for a new entry added via the Settings Ignore list input (character name cap). */
export const IGNORE_ADD_MAX = NAME_MAX;

/** Saves a page's (or full set of) player settings to the logged-in account. */
export const prefsSaveSchema = z.strictObject({
  t: z.literal("prefsSave"),
  prefs: playerPrefsPatchSchema,
  requestId: z.number().int().min(1).max(1_000_000_000).optional(),
});

/** Adds an entry to the account's ignore list (same list as `/ignore`). */
export const ignoreAddSchema = z.strictObject({
  t: z.literal("ignoreAdd"),
  name: z
    .string()
    .min(1)
    .max(IGNORE_ADD_MAX)
    .refine((s) => !/[\r\n]/.test(s), "one line"),
});

/** Removes any stored entry from the account's ignore list (same list as `/unignore`). */
export const ignoreRemoveSchema = z.strictObject({
  t: z.literal("ignoreRemove"),
  name: z.string().min(1).max(CHAT_INPUT_MAX),
});

/** Opens the Who's Online window without typing `who` in chat. */
export const whoOpenSchema = z.strictObject({
  t: z.literal("whoOpen"),
});

export type PreferencesServerMsg =
  /**
   * The account's player settings and ignore list, pushed at login and on save. `stored` is false
   * when the account has no saved preferences row yet (so the client may import migrated legacy or
   * pre-login settings).
   */
  | { t: "prefs"; prefs: PlayerPreferences; ignores: string[]; stored?: boolean }
  /** Reply to `prefsSave`, echoing `requestId` when supplied and the server's confirmed `prefs`. */
  | {
      t: "prefsResult";
      ok: boolean;
      text: string;
      requestId?: number;
      prefs?: PlayerPreferences;
    }
  /** Updated account ignore list (after `/ignore`, `/unignore`, or Settings ignore management). */
  | { t: "ignores"; list: string[]; ok?: boolean; text?: string };
