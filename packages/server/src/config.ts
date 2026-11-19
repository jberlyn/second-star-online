/**
 * Server infrastructure: how the process saves, keeps dropped sessions and takes connections. These
 * are set when the server starts, from `SSO_*` environment variables, not in the in-game Settings
 * window: they belong to whoever hosts the process, and changing them live is a deployment
 * decision, not a game one. Pure apart from reading the environment it is given.
 */

import { formatTimeLength, parseTimeLength } from "@secondstaronline/shared";

export interface ServerConfig {
  /** Seconds between periodic saves of online characters (`SSO_SAVE_INTERVAL`). */
  saveInterval: number;
  /** Seconds a dropped connection may resume without logging in; 0 = off (`SSO_RECONNECT_GRACE`). */
  reconnectGrace: number;
  /** Open connections one address (IPv6 /64) may hold; 0 = no limit (`SSO_SOCKETS_PER_IP`). */
  socketsPerIp: number;
}

export const DEFAULT_SERVER_CONFIG: Readonly<ServerConfig> = {
  saveInterval: 30,
  reconnectGrace: 30,
  socketsPerIp: 10,
};

interface Field {
  key: keyof ServerConfig;
  env: string;
  kind: "time" | "count";
  min: number;
  max: number;
}

/** Each variable, its limits and what it sets. The ranges are the old settings' ranges. */
export const SERVER_CONFIG_VARS: readonly Field[] = [
  { key: "saveInterval", env: "SSO_SAVE_INTERVAL", kind: "time", min: 1, max: 3600 },
  { key: "reconnectGrace", env: "SSO_RECONNECT_GRACE", kind: "time", min: 0, max: 300 },
  { key: "socketsPerIp", env: "SSO_SOCKETS_PER_IP", kind: "count", min: 0, max: 1000 },
];

function range(f: Field): string {
  return f.kind === "time"
    ? `a time from ${formatTimeLength(f.min)} to ${formatTimeLength(f.max)}, like 30s or 2m`
    : `a whole number from ${f.min} to ${f.max}`;
}

/**
 * The config from the environment: an unset or empty variable keeps its default. A time is
 * written as in the Server Settings window ("30s", "2m", "0"). Any value out of range or not a
 * time is an error naming the variable, so a typo refuses startup instead of quietly using a
 * default.
 */
export function readServerConfig(
  env: Readonly<Record<string, string | undefined>>,
): { ok: true; config: ServerConfig } | { ok: false; errors: string[] } {
  const config: ServerConfig = { ...DEFAULT_SERVER_CONFIG };
  const errors: string[] = [];
  for (const f of SERVER_CONFIG_VARS) {
    const raw = env[f.env]?.trim();
    if (raw === undefined || raw === "") {
      continue;
    }
    const n = f.kind === "time" ? parseTimeLength(raw) : /^\d+$/.test(raw) ? Number(raw) : null;
    if (n === null || n < f.min || n > f.max) {
      errors.push(`${f.env} must be ${range(f)}, got "${raw}"`);
      continue;
    }
    config[f.key] = n;
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, config };
}
