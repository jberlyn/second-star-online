/** Moderation rules: ranks, durations, addresses and the lines staff read. */
import { describe, expect, test } from "bun:test";

import {
  ADMINISTRATOR,
  banListLine,
  banNotice,
  canonicalIp,
  DURATION_MAX_MINUTES,
  durationText,
  expiryOf,
  formatUtc,
  historyLine,
  ipKey,
  isActive,
  keyLabel,
  MODERATOR,
  type ModerationRecord,
  mayChange,
  mayTarget,
  outranks,
  parseDuration,
  parseModerationArgs,
} from "../../src/index.ts";

const NOW = "2026-11-17T09:00:00.000Z";
const rec = (over: Partial<ModerationRecord> = {}): ModerationRecord => ({
  actorId: "a1",
  actorName: "Alice",
  actorRole: "Moderator",
  reason: "",
  createdAt: NOW,
  expiresAt: null,
  ...over,
});

describe("ranks", () => {
  test("no role < moderator < administrator, by rank", () => {
    expect(outranks(ADMINISTRATOR, MODERATOR)).toBe(true);
    expect(outranks(MODERATOR, null)).toBe(true);
    expect(outranks(MODERATOR, MODERATOR)).toBe(false);
    expect(outranks(MODERATOR, ADMINISTRATOR)).toBe(false);
    expect(outranks(null, MODERATOR)).toBe(false);
  });

  test("an operator's role outranks by its rank, whatever it is called", () => {
    const senior = { id: "senior", name: "Senior", rank: 5, permissions: new Set<never>() };
    expect(outranks(senior, ADMINISTRATOR)).toBe(true);
    expect(mayTarget(senior, ADMINISTRATOR)).toBe(true);
    expect(mayTarget(ADMINISTRATOR, senior)).toBe(true); // overrule
    expect(mayTarget(MODERATOR, senior)).toBe(false);
  });

  test("a moderator acts on players only; an administrator on anyone", () => {
    expect(mayTarget(MODERATOR, null)).toBe(true);
    expect(mayTarget(MODERATOR, MODERATOR)).toBe(false);
    expect(mayTarget(MODERATOR, ADMINISTRATOR)).toBe(false);
    expect(mayTarget(ADMINISTRATOR, ADMINISTRATOR)).toBe(true);
    expect(mayTarget(null, null)).toBe(false);
  });

  test("only the maker of an action or an administrator may change it", () => {
    const byAlice = rec();
    expect(mayChange({ id: "a1", role: MODERATOR }, byAlice)).toBe(true);
    expect(mayChange({ id: "b2", role: MODERATOR }, byAlice)).toBe(false);
    expect(mayChange({ id: "c3", role: ADMINISTRATOR }, byAlice)).toBe(true);
    expect(mayChange({ id: "c3", role: ADMINISTRATOR }, rec({ actorRole: "Admin" }))).toBe(true);
    expect(mayChange({ id: "b2", role: MODERATOR }, rec({ actorRole: "Admin" }))).toBe(false);
  });

  test("an action is in force until it expires; permanent ones never do", () => {
    expect(isActive(null, NOW)).toBe(false);
    expect(isActive(rec(), NOW)).toBe(true);
    expect(isActive(rec({ expiresAt: "2026-11-17T09:00:00.001Z" }), NOW)).toBe(true);
    expect(isActive(rec({ expiresAt: NOW }), NOW)).toBe(false);
  });
});

describe("durations", () => {
  test("each unit, runs of units, any case, and perm", () => {
    expect(parseDuration("30m")).toBe(30);
    expect(parseDuration("12H")).toBe(720);
    expect(parseDuration("7d")).toBe(10080);
    expect(parseDuration("2w")).toBe(20160);
    expect(parseDuration("1d12h")).toBe(2160);
    expect(parseDuration("perm")).toBe("perm");
    expect(parseDuration("Permanent")).toBe("perm");
  });

  test("zero and more than ten years are refused; other words are not durations", () => {
    expect(parseDuration("0m")).toBe("bad");
    expect(parseDuration(`${DURATION_MAX_MINUTES + 1}m`)).toBe("bad");
    expect(parseDuration(`${DURATION_MAX_MINUTES}m`)).toBe(DURATION_MAX_MINUTES);
    expect(parseDuration("rude")).toBeNull();
    expect(parseDuration("3")).toBeNull();
    expect(parseDuration("3days")).toBeNull();
    expect(parseDuration("")).toBeNull();
  });

  test("the end of an action: the given length, else the setting, where 0 is permanent", () => {
    expect(expiryOf(30, 0, NOW)).toBe("2026-11-17T09:30:00.000Z");
    expect(expiryOf(null, 10, NOW)).toBe("2026-11-17T09:10:00.000Z");
    expect(expiryOf(null, 0, NOW)).toBeNull();
    expect(expiryOf("perm", 10, NOW)).toBeNull();
  });

  test("lengths are written back in the same grammar", () => {
    expect(durationText(3 * 86_400_000)).toBe("3d");
    expect(durationText(36 * 3_600_000)).toBe("1d12h");
    expect(durationText(45 * 60_000)).toBe("45m");
  });
});

describe("command arguments", () => {
  test("name only, a duration, a reason, or both", () => {
    expect(parseModerationArgs("/ban Bob")).toEqual({ scope: null, duration: null, reason: "" });
    expect(parseModerationArgs("/ban Bob 3d")).toEqual({ scope: null, duration: 4320, reason: "" });
    expect(parseModerationArgs("/ban Bob being a rude person")).toEqual({
      scope: null,
      duration: null,
      reason: "being a rude person",
    });
    expect(parseModerationArgs("/ban  Bob  perm   spam  bot")).toEqual({
      scope: null,
      duration: "perm",
      reason: "spam bot",
    });
  });

  test("a reason that starts with a number is still a reason; a bad duration refuses", () => {
    expect(parseModerationArgs("/ban Bob 3 warnings ignored")?.reason).toBe("3 warnings ignored");
    expect(parseModerationArgs("/ban Bob perm 1d is not a duration here")?.reason).toBe(
      "1d is not a duration here",
    );
    expect(parseModerationArgs("/ban Bob 0d")).toBeNull();
  });

  test("/banip's latest or all comes before the duration, only when allowed", () => {
    expect(parseModerationArgs("/banip Eve all 30d alts", { scope: true })).toEqual({
      scope: "all",
      duration: 43200,
      reason: "alts",
    });
    expect(parseModerationArgs("/banip Eve", { scope: true })?.scope).toBeNull();
    expect(parseModerationArgs("/ban Eve all of it")).toEqual({
      scope: null,
      duration: null,
      reason: "all of it",
    });
  });

  test("an unban's words are all reason", () => {
    expect(parseModerationArgs("/unban Bob 3d early", { duration: false })?.reason).toBe(
      "3d early",
    );
  });
});

describe("addresses", () => {
  test("IPv4 in range only", () => {
    expect(canonicalIp("203.0.113.7")).toEqual({ address: "203.0.113.7", key: "203.0.113.7" });
    expect(canonicalIp("010.0.0.1")?.address).toBe("10.0.0.1");
    for (const bad of ["256.1.1.1", "1.2.3", "1.2.3.4.5", "foo", "", "1.2.3.4/24", "Bob"]) {
      expect(canonicalIp(bad)).toBeNull();
    }
  });

  test("IPv6 written any way has one form and its /64 key", () => {
    const a = canonicalIp("2001:0DB8:0000:0000:0000:0000:0000:0001");
    expect(a).toEqual({ address: "2001:db8::1", key: "2001:db8:0:0" });
    expect(canonicalIp("2001:db8::1")).toEqual(a);
    expect(canonicalIp("2001:db8:1:2:aaaa::1")?.key).toBe(ipKey("2001:db8:1:2:ffff::9"));
    expect(canonicalIp("::1")?.address).toBe("::1");
    expect(canonicalIp("1:0:0:2:0:0:0:3")?.address).toBe("1:0:0:2::3");
    expect(canonicalIp("::ffff:203.0.113.7")).toEqual({
      address: "203.0.113.7",
      key: "203.0.113.7",
    });
  });

  test("zone ids, ranges and malformed IPv6 are refused", () => {
    for (const bad of ["fe80::1%eth0", "2001:db8::/64", "1::2::3", "12345::1", "1:2:3:4:5:6:7"]) {
      expect(canonicalIp(bad)).toBeNull();
    }
  });

  test("staff read an IPv6 key as its /64", () => {
    expect(keyLabel("2001:db8:1:2")).toBe("2001:db8:1:2::/64");
    expect(keyLabel("203.0.113.7")).toBe("203.0.113.7");
  });
});

describe("lines", () => {
  test("the login notice says when the ban ends, never why", () => {
    expect(banNotice("BANNED!!", "2026-11-20T14:00:00.000Z")).toBe(
      "BANNED!! Banned until 2026-11-20 14:00 UTC.",
    );
    expect(banNotice("BANNED!!", null)).toBe("BANNED!! This ban is permanent.");
  });

  test("/banlist rows and history lines", () => {
    expect(formatUtc(NOW)).toBe("2026-11-17 09:00 UTC");
    expect(banListLine("Bob", rec({ reason: "spam", expiresAt: "2026-11-20T14:00:00.000Z" }))).toBe(
      "Bob - until 2026-11-20 14:00 UTC - Alice (Moderator): spam",
    );
    expect(banListLine("Eve", rec({ actorRole: "Admin" }))).toBe("Eve - permanent - Alice (Admin)");
    expect(
      historyLine({
        action: "ban",
        address: null,
        actorName: "Alice",
        actorRole: "Moderator",
        reason: "spam",
        createdAt: NOW,
        expiresAt: "2026-11-20T09:00:00.000Z",
      }),
    ).toBe("2026-11-17 09:00 UTC ban 3d by Alice (Moderator): spam");
    expect(
      historyLine({
        action: "unipban",
        address: "203.0.113.7",
        actorName: "Root",
        actorRole: "Admin",
        reason: "",
        createdAt: NOW,
        expiresAt: null,
      }),
    ).toBe("2026-11-17 09:00 UTC unipban 203.0.113.7 by Root (Admin)");
  });
});
