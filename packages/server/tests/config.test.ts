import { describe, expect, test } from "bun:test";

import { DEFAULT_SERVER_CONFIG, readServerConfig } from "../src/config.ts";

describe("server config from the environment", () => {
  test("unset or empty variables keep the defaults", () => {
    expect(readServerConfig({})).toEqual({ ok: true, config: { ...DEFAULT_SERVER_CONFIG } });
    expect(readServerConfig({ SSO_SAVE_INTERVAL: "" })).toEqual({
      ok: true,
      config: { ...DEFAULT_SERVER_CONFIG },
    });
    expect(DEFAULT_SERVER_CONFIG).toEqual({
      saveInterval: 30,
      reconnectGrace: 30,
      socketsPerIp: 10,
    });
  });

  test("times are written as in the Server Settings window; counts are whole numbers", () => {
    expect(
      readServerConfig({
        SSO_SAVE_INTERVAL: "2m",
        SSO_RECONNECT_GRACE: "0",
        SSO_SOCKETS_PER_IP: "0",
      }),
    ).toEqual({ ok: true, config: { saveInterval: 120, reconnectGrace: 0, socketsPerIp: 0 } });
    expect(readServerConfig({ SSO_RECONNECT_GRACE: "1m 30s" })).toMatchObject({
      config: { reconnectGrace: 90 },
    });
  });

  test("a value that does not read, or is out of range, refuses startup by name", () => {
    const r = readServerConfig({
      // A bare number has no unit: refused, as in the Server Settings window.
      SSO_SAVE_INTERVAL: "30",
      SSO_RECONNECT_GRACE: "10m",
      SSO_SOCKETS_PER_IP: "ten",
    });
    expect(r).toEqual({
      ok: false,
      errors: [
        'SSO_SAVE_INTERVAL must be a time from 1s to 1h, like 30s or 2m, got "30"',
        'SSO_RECONNECT_GRACE must be a time from 0 to 5m, like 30s or 2m, got "10m"',
        'SSO_SOCKETS_PER_IP must be a whole number from 0 to 1000, got "ten"',
      ],
    });
    expect(readServerConfig({ SSO_SAVE_INTERVAL: "0" }).ok).toBe(false);
  });
});
