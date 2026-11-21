/**
 * Browser-side cache for player preferences and floating window positions.
 *
 * The account row on the server is authoritative once logged in. This local cache exists so the
 * title, login and creation screens honour Display and Sound preferences before login, and so
 * viewport-specific floating window coordinates stay local to each device's screen size.
 */
import {
  defaultPlayerPrefs,
  mergePlayerPrefs,
  type PlayerPreferences,
} from "@secondstaronline/shared";

export const PREF_STORAGE_KEYS = {
  prefs: "sso.prefs",
  /** Set when `sso.prefs` holds migrated legacy keys or explicit pre-login edits awaiting first-login import. */
  prefsPending: "sso.prefsPending",
  windowPos: "sso.windowPos",
  news: "sso.news",
  // Legacy keys from before the Player Settings window (migrated on first read).
  legacySharp: "sso.sharpPixels",
  legacySfx: "sso.sfx",
  legacyControls: "sso.controls",
} as const;

export interface WindowPos {
  x: number;
  y: number;
}

export interface LocalPrefsState {
  prefs: PlayerPreferences;
  /**
   * True when these local settings came from legacy browser keys or an explicit pre-login save
   * (rather than a synced server account cache), so an uninitialized account imports them on
   * first login.
   */
  pendingSync: boolean;
}

export function getStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function setStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode or full quota: keep running with in-memory values.
  }
}

function removeStored(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Private mode: ignore.
  }
}

/**
 * Loads cached player preferences and whether they represent local/legacy overrides that should
 * initialize an uninitialized account on first login.
 */
export function loadLocalPrefsState(): LocalPrefsState {
  const raw = getStored(PREF_STORAGE_KEYS.prefs);
  if (raw !== null) {
    try {
      return {
        prefs: mergePlayerPrefs(JSON.parse(raw)),
        pendingSync: getStored(PREF_STORAGE_KEYS.prefsPending) === "1",
      };
    } catch {
      return { prefs: defaultPlayerPrefs(), pendingSync: false };
    }
  }
  const migrated: Record<string, unknown> = {};
  let hasLegacy = false;
  const sharp = getStored(PREF_STORAGE_KEYS.legacySharp);
  if (sharp === "1" || sharp === "0") {
    migrated.gameSize = sharp === "1" ? "sharp" : "fit";
    hasLegacy = true;
  }
  const sfx = getStored(PREF_STORAGE_KEYS.legacySfx);
  if (sfx === "0" || sfx === "1") {
    migrated.sfxEnabled = sfx !== "0";
    hasLegacy = true;
  }
  const controls = getStored(PREF_STORAGE_KEYS.legacyControls);
  if (controls === "classic" || controls === "modern") {
    migrated.controlSet = controls;
    hasLegacy = true;
  }
  return { prefs: mergePlayerPrefs(migrated), pendingSync: hasLegacy };
}

/** Loads cached player preferences, migrating legacy browser keys if `sso.prefs` is absent. */
export function loadLocalPrefs(): PlayerPreferences {
  return loadLocalPrefsState().prefs;
}

/**
 * Writes cached player preferences to `localStorage` for pre-login screens. Pass `pendingSync=true`
 * for explicit pre-login saves; pass `false` once synced with a server account.
 */
export function saveLocalPrefs(prefs: PlayerPreferences, pendingSync = false): void {
  setStored(PREF_STORAGE_KEYS.prefs, JSON.stringify(prefs));
  if (pendingSync) {
    setStored(PREF_STORAGE_KEYS.prefsPending, "1");
  } else {
    removeStored(PREF_STORAGE_KEYS.prefsPending);
  }
}

function readWindowPositions(): Record<string, WindowPos> {
  const raw = getStored(PREF_STORAGE_KEYS.windowPos);
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    const out: Record<string, WindowPos> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (
        v &&
        typeof v === "object" &&
        typeof (v as WindowPos).x === "number" &&
        typeof (v as WindowPos).y === "number" &&
        Number.isFinite((v as WindowPos).x) &&
        Number.isFinite((v as WindowPos).y)
      ) {
        out[k] = { x: (v as WindowPos).x, y: (v as WindowPos).y };
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function loadWindowPos(name: string): WindowPos | null {
  return readWindowPositions()[name] ?? null;
}

export function saveWindowPos(name: string, pos: WindowPos): void {
  const all = readWindowPositions();
  all[name] = { x: Math.round(pos.x), y: Math.round(pos.y) };
  setStored(PREF_STORAGE_KEYS.windowPos, JSON.stringify(all));
}
