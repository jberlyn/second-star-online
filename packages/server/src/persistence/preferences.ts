/** Per-account player preferences. Defaults and merge rules live in @secondstaronline/shared. */
import {
  defaultPlayerPrefs,
  mergePlayerPrefs,
  type PlayerPreferences,
} from "@secondstaronline/shared";

import type { Db } from "./database.ts";

export interface AccountPreferencesRecord {
  prefs: PlayerPreferences;
  stored: boolean;
}

export function loadAccountPreferencesRecord(db: Db, accountId: string): AccountPreferencesRecord {
  const row = db
    .query<{ prefs: string }, [string]>(
      "SELECT prefs FROM account_preferences WHERE account_id = ? LIMIT 1",
    )
    .get(accountId);
  if (!row) {
    return { prefs: defaultPlayerPrefs(), stored: false };
  }
  try {
    return { prefs: mergePlayerPrefs(JSON.parse(row.prefs)), stored: true };
  } catch {
    return { prefs: defaultPlayerPrefs(), stored: true };
  }
}

export function loadAccountPreferences(db: Db, accountId: string): PlayerPreferences {
  return loadAccountPreferencesRecord(db, accountId).prefs;
}

export function saveAccountPreferences(
  db: Db,
  accountId: string,
  prefs: PlayerPreferences,
  now: string,
): void {
  db.query(
    `INSERT INTO account_preferences (account_id, prefs, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(account_id) DO UPDATE SET prefs = excluded.prefs, updated_at = excluded.updated_at`,
  ).run(accountId, JSON.stringify(prefs), now);
}
