/**
 * An in-memory moderation store for the admin command tests (the SQLite one is
 * persistence/moderation.ts), and a settable wall clock.
 */
import type {
  AddressSeen,
  IpBanRecord,
  ModerationEntry,
  ModerationLogRow,
  ModerationRecord,
  NamedRecord,
} from "@secondstaronline/shared";

import type { ModerationStore } from "../../src/systems/admin/commands.ts";

export const T0 = "2026-11-17T09:00:00.000Z";

/** A wall clock tests move by minutes. */
export function testClock(start = T0) {
  const c = {
    ms: Date.parse(start),
    iso: () => new Date(c.ms).toISOString(),
    advance: (minutes: number) => {
      c.ms += minutes * 60_000;
    },
  };
  return c;
}

const live = (r: { expiresAt: string | null }, now: string) =>
  r.expiresAt === null || r.expiresAt > now;

export function fakeModeration(nameOf: (accountId: string) => string) {
  const bans = new Map<string, NamedRecord>();
  const jails = new Map<string, NamedRecord>();
  const mutes = new Map<string, NamedRecord>();
  const ipBans = new Map<string, IpBanRecord>();
  const log: ModerationEntry[] = [];
  /** Addresses per account, the latest first. */
  const addresses = new Map<string, AddressSeen[]>();
  const rec = (e: ModerationEntry): ModerationRecord => ({
    actorId: e.actorId,
    actorName: e.actorName,
    actorRole: e.actorRole,
    reason: e.reason,
    createdAt: e.createdAt,
    expiresAt: e.expiresAt,
  });
  const store: ModerationStore = {
    accountBan: (id) => bans.get(id) ?? null,
    jail: (id) => jails.get(id) ?? null,
    mute: (id) => mutes.get(id) ?? null,
    ipBan: (key) => ipBans.get(key) ?? null,
    ipBansFrom: (id) => [...ipBans.values()].filter((b) => b.sourceAccountId === id),
    record: (e) => {
      log.push(e);
      switch (e.action) {
        case "ban":
          bans.set(e.accountId ?? "", { ...rec(e), name: e.characterName ?? "" });
          return;
        case "unban":
          bans.delete(e.accountId ?? "");
          return;
        case "jail":
          jails.set(e.characterId ?? "", { ...rec(e), name: e.characterName ?? "" });
          return;
        case "unjail":
          jails.delete(e.characterId ?? "");
          return;
        case "mute":
          mutes.set(e.accountId ?? "", { ...rec(e), name: e.characterName ?? "" });
          return;
        case "unmute":
          mutes.delete(e.accountId ?? "");
          return;
        case "ipban":
          ipBans.set(e.ipKey ?? "", {
            ...rec(e),
            key: e.ipKey ?? "",
            address: e.address ?? "",
            sourceAccountId: e.sourceAccountId ?? null,
          });
          return;
        case "unipban":
          ipBans.delete(e.ipKey ?? "");
          return;
        case "pardon":
          return;
      }
    },
    addresses: (id) => addresses.get(id) ?? [],
    charactersAt: (key) =>
      [...addresses.entries()].flatMap(([id, seen]) =>
        seen.filter((a) => a.key === key).map((a) => ({ name: nameOf(id), lastSeen: a.lastSeen })),
      ),
    activeBans: (now) => [...bans.values()].filter((b) => live(b, now)).reverse(),
    activeJails: (now) => [...jails.values()].filter((j) => live(j, now)).reverse(),
    activeMutes: (now) => [...mutes.values()].filter((u) => live(u, now)).reverse(),
    activeIpBans: (now) =>
      [...ipBans.values()]
        .filter((b) => live(b, now))
        .reverse()
        .map((b) => ({ ...b, sourceName: b.sourceAccountId ? nameOf(b.sourceAccountId) : null })),
    history: (id, limit): ModerationLogRow[] =>
      log
        .filter((e) => e.accountId === id)
        .slice(-limit)
        .map((e) => ({
          action: e.action,
          address: e.address ?? null,
          actorName: e.actorName,
          actorRole: e.actorRole,
          reason: e.reason,
          createdAt: e.createdAt,
          expiresAt: e.expiresAt,
        })),
  };
  return { store, bans, jails, mutes, ipBans, log, addresses };
}
