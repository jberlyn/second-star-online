/**
 * SSO's login, creation and socket limits, the proxy-hop address, the hash queue, and the
 * prototype-key throw in the settings save. 1.6 had none of these.
 */
import { describe, expect, test } from "bun:test";

import { clientIp, securityHeaders } from "../src/gateway/server.ts";
import {
  HASH_OPTIONS,
  hashPassword,
  setHashOptionsForTests,
  verifyPassword,
} from "../src/persistence/accounts.ts";
import { applySettingValues, defaultSettings } from "../src/settings.ts";
import {
  allowCreate,
  allowLoginFromIp,
  allowLoginToAccount,
  CREATE_WINDOW_MS,
  ipKey,
  LOGIN_WINDOW_MS,
  newLoginLimits,
  noteCreate,
  noteLoginSuccess,
  notePasswordTry,
  noteUnknownName,
  unnoteCreate,
} from "../src/systems/admin/login-limits.ts";
import { TEST_HASH_OPTIONS } from "./helpers/fast-hash.ts";

describe("settings save", () => {
  test.each(["constructor", "toString", "__proto__", "hasOwnProperty"])(
    "a prototype key %s is an unknown setting, not a throw",
    (key) => {
      const r = applySettingValues(defaultSettings(), JSON.parse(`{"${key}": 1}`));
      expect(r.ok).toBe(false);
      expect(!r.ok && r.error).toContain(`There is no setting called ${key}`);
    },
  );
});

describe("ipKey", () => {
  test("IPv4 stays, a mapped IPv4 is unwrapped, IPv6 is cut to its /64", () => {
    expect(ipKey("203.0.113.9")).toBe("203.0.113.9");
    expect(ipKey("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(ipKey("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:1:2");
    expect(ipKey("2001:0DB8:0001:0002::1")).toBe("2001:db8:1:2");
    expect(ipKey("2001:db8::1")).toBe("2001:db8:0:0");
    expect(ipKey("::1")).toBe("0:0:0:0");
  });
});

describe("failed logins", () => {
  test("20 failures from one address refuse the 21st, any account; the window ends them", () => {
    const l = newLoginLimits();
    for (let i = 0; i < 20; i++) {
      noteUnknownName(l, "1.2.3.4", 1000);
    }
    expect(allowLoginFromIp(l, "1.2.3.4", 1000, 20)).toBe(false);
    expect(allowLoginFromIp(l, "1.2.3.5", 1000, 20)).toBe(true);
    expect(allowLoginFromIp(l, "1.2.3.4", 1000 + LOGIN_WINDOW_MS, 20)).toBe(true);
    expect(allowLoginFromIp(l, "1.2.3.4", 1000, 0)).toBe(true); // 0 = off
  });

  test("5 wrong passwords lock the pair; another address and another account are free; a success clears", () => {
    const l = newLoginLimits();
    for (let i = 0; i < 5; i++) {
      notePasswordTry(l, "acc", "1.2.3.4", 10 + i);
    }
    expect(allowLoginToAccount(l, "acc", "1.2.3.4", 20, 5)).toBe(false);
    expect(allowLoginToAccount(l, "acc", "9.9.9.9", 20, 5)).toBe(true);
    expect(allowLoginToAccount(l, "other", "1.2.3.4", 20, 5)).toBe(true);
    noteLoginSuccess(l, "acc", "1.2.3.4", 14);
    expect(allowLoginToAccount(l, "acc", "1.2.3.4", 20, 5)).toBe(true);
  });

  test("a try counts before its hash; a success takes back only its own try", () => {
    const l = newLoginLimits();
    notePasswordTry(l, "acc", "1.2.3.4", 100); // a wrong one
    notePasswordTry(l, "acc", "1.2.3.4", 200); // still hashing: already counted
    expect(allowLoginFromIp(l, "1.2.3.4", 200, 2)).toBe(false);
    noteLoginSuccess(l, "acc", "1.2.3.4", 200);
    expect(allowLoginFromIp(l, "1.2.3.4", 200, 2)).toBe(true);
    expect(allowLoginFromIp(l, "1.2.3.4", 200, 1)).toBe(false); // the failure at 100 stays
  });

  test("an address that never comes back is swept after the window", () => {
    const l = newLoginLimits();
    noteUnknownName(l, "1.1.1.1", 1);
    notePasswordTry(l, "acc", "2.2.2.2", 1);
    noteCreate(l, "3.3.3.3", 1);
    noteUnknownName(l, "9.9.9.9", 1 + LOGIN_WINDOW_MS);
    expect([...l.ipFails.keys()]).toEqual(["9.9.9.9"]);
    expect(l.pairFails.size).toBe(0);
    expect(l.creates.size).toBe(1); // creations count for an hour
    noteUnknownName(l, "9.9.9.9", 1 + CREATE_WINDOW_MS);
    expect(l.creates.size).toBe(0);
  });

  test("an IPv6 /64 counts as one address", () => {
    const l = newLoginLimits();
    for (let i = 0; i < 3; i++) {
      noteUnknownName(l, `2001:db8:0:1::${i + 1}`, 0);
    }
    expect(allowLoginFromIp(l, "2001:db8:0:1:ffff::9", 0, 3)).toBe(false);
    expect(allowLoginFromIp(l, "2001:db8:0:2::1", 0, 3)).toBe(true);
  });
});

describe("creations", () => {
  test("3 an hour per address", () => {
    const l = newLoginLimits();
    for (let i = 0; i < 3; i++) {
      expect(allowCreate(l, "1.2.3.4", 0, 3)).toBe(true);
      noteCreate(l, "1.2.3.4", 0);
    }
    expect(allowCreate(l, "1.2.3.4", 0, 3)).toBe(false);
    expect(allowCreate(l, "1.2.3.4", CREATE_WINDOW_MS, 3)).toBe(true);
    unnoteCreate(l, "1.2.3.4", 0); // a creation that lost its name to a race
    expect(allowCreate(l, "1.2.3.4", 0, 3)).toBe(true);
  });
});

describe("the address behind proxies (SSO_PROXY_HOPS)", () => {
  const req = (xff?: string) =>
    new Request("http://x/ws", { headers: xff ? { "x-forwarded-for": xff } : {} });
  test("0 hops is the socket; a forged header is ignored", () => {
    expect(clientIp(req("6.6.6.6"), "10.0.0.1", 0)).toBe("10.0.0.1");
  });
  test("1 hop is the right-most entry, which the client cannot forge", () => {
    expect(clientIp(req("6.6.6.6, 203.0.113.9"), "10.0.0.1", 1)).toBe("203.0.113.9");
  });
  test("2 hops is the second from the right; too few entries fall back to the socket", () => {
    expect(clientIp(req("6.6.6.6, 203.0.113.9, 10.0.0.2"), "10.0.0.1", 2)).toBe("203.0.113.9");
    expect(clientIp(req("203.0.113.9"), "10.0.0.1", 2)).toBe("10.0.0.1");
    expect(clientIp(req(), "10.0.0.1", 1)).toBe("10.0.0.1");
  });
  test("a mapped IPv4 reads as IPv4", () => {
    expect(clientIp(req(), "::ffff:10.0.0.1", 0)).toBe("10.0.0.1");
  });
});

describe("security headers", () => {
  test("nosniff and a narrow CSP; frame-ancestors only when the operator sets it", () => {
    const h = securityHeaders();
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["content-security-policy"]).toBe(
      "script-src 'self'; object-src 'none'; base-uri 'none'",
    );
    expect(securityHeaders("'none'")["content-security-policy"]).toContain(
      "frame-ancestors 'none'",
    );
  });
});

describe("the hash queue", () => {
  test("many hashes at once all finish, two at a time", async () => {
    const hashes = await Promise.all(Array.from({ length: 5 }, (_, i) => hashPassword(`pw${i}`)));
    expect(hashes.every((h) => h.startsWith("$argon2id$"))).toBe(true);
  });

  test("a server hashes with Argon2id at 64 MiB and two passes; tests swap in a cheaper cost", async () => {
    expect(HASH_OPTIONS).toEqual({ algorithm: "argon2id", memoryCost: 65536, timeCost: 2 });
    const cheap = await hashPassword("secret");
    expect(cheap).toContain("$m=1024,t=1,");
    setHashOptionsForTests(null);
    try {
      const real = await hashPassword("secret");
      expect(real).toContain("$m=65536,t=2,");
      const account = { passwordHash: real } as Parameters<typeof verifyPassword>[0];
      expect(await verifyPassword(account, "secret")).toBe(true);
      expect(await verifyPassword({ ...account, passwordHash: cheap }, "secret")).toBe(true);
    } finally {
      setHashOptionsForTests(TEST_HASH_OPTIONS);
    }
  });
});
