/**
 * `/auditlog`: an administrator reads what staff did, by a character's account or to that character,
 * from the audit log and the moderation log together.
 */
import { beforeEach, describe, expect, test } from "bun:test";

import {
  ADMIN_TEXT,
  AUDITLOG_TEXT,
  auditlogLine,
  parseAuditlogArgs,
  type ServerMsg,
  unknownCommandText,
} from "@secondstaronline/shared";

import { createGame } from "../src/game.ts";
import { setRole } from "../src/persistence/accounts.ts";
import { recentAudit } from "../src/persistence/admin.ts";
import { type Db, openDatabase } from "../src/persistence/database.ts";
import { migrate } from "../src/persistence/migrations.ts";
import { NEVER_PUSH } from "./helpers/sim.ts";

describe("/auditlog's words and lines", () => {
  test("a name, then a count that defaults to 10 and stops at 100", () => {
    expect(parseAuditlogArgs("/auditlog bob")).toEqual({ name: "bob", limit: 10 });
    expect(parseAuditlogArgs("/AUDITLOG  bob  3 ")).toEqual({ name: "bob", limit: 3 });
    expect(parseAuditlogArgs("/auditlog bob 500")).toEqual({ name: "bob", limit: 100 });
    expect(parseAuditlogArgs("/auditlog bob 0")).toEqual({ name: "bob", limit: 1 });
    expect(parseAuditlogArgs("/auditlog")).toBeNull();
    expect(parseAuditlogArgs("/auditlog bob lots")).toBeNull();
    expect(parseAuditlogArgs("/auditlog bob 3 more")).toBeNull();
  });

  test("an audit row shows before -> after; a moderation row its end and reason", () => {
    const row = {
      at: "2026-11-18T10:02:45.123Z",
      actor: "King",
      action: "/setclass",
      target: "Bob",
      before: "1",
      after: "7",
      reason: null,
      expiresAt: null,
      permanent: false,
    };
    expect(auditlogLine(row)).toBe("2026-11-18 10:02:45 UTC King /setclass Bob: 1 -> 7");
    expect(auditlogLine({ ...row, action: "/warp", before: null, after: '{"map":"x1y1"}' })).toBe(
      '2026-11-18 10:02:45 UTC King /warp Bob: {"map":"x1y1"}',
    );
    expect(auditlogLine({ ...row, action: "/save", target: null, before: null, after: null })).toBe(
      "2026-11-18 10:02:45 UTC King /save",
    );
    const jail = {
      ...row,
      action: "/jail",
      before: null,
      after: null,
      reason: "spamming",
      expiresAt: "2026-11-18T10:32:45.123Z",
    };
    expect(auditlogLine(jail)).toBe(
      '2026-11-18 10:02:45 UTC King /jail Bob (until 2026-11-18 10:32:45 UTC, "spamming")',
    );
    expect(auditlogLine({ ...jail, expiresAt: null, permanent: true, reason: "" })).toBe(
      "2026-11-18 10:02:45 UTC King /jail Bob (permanent)",
    );
    expect(auditlogLine({ ...jail, action: "/unjail", expiresAt: null, reason: "" })).toBe(
      "2026-11-18 10:02:45 UTC King /unjail Bob",
    );
  });
});

describe("/auditlog in the game", () => {
  type Out = { to: string; msg: ServerMsg }[];
  let db: Db;
  let wall: number;
  const sent: Out = [];

  beforeEach(() => {
    db = openDatabase();
    migrate(db);
    wall = Date.parse("2026-11-18T09:00:00.000Z");
    sent.length = 0;
  });

  async function start() {
    const game = createGame({
      db,
      send: (to, msg) => sent.push({ to, msg }),
      isoNow: () => new Date(wall).toISOString(),
      rng: NEVER_PUSH,
    });
    let n = 0;
    const make = async (name: string, role?: "moderator" | "administrator") => {
      n += 1;
      const ip = `10.0.0.${n}`;
      await game.create(
        {
          t: "create",
          name,
          password: "pw",
          sex: 1,
          head: 1,
          classCode: 1,
          str: 10,
          sta: 10,
          int: 10,
          wis: 10,
          dex: 10,
        },
        ip,
      );
      const l = await game.login(name, "pw", ip);
      if (!l.ok) {
        throw new Error(l.text);
      }
      if (role) {
        setRole(db, l.accountId, role, new Date(wall).toISOString());
      }
      game.enter(l.characterId, false, ip);
      return l;
    };
    const say = (id: string, text: string) => {
      sent.length = 0;
      game.intent(id, { t: "chat", text });
      wall += 1_000;
      return sent.flatMap((o) => (o.to === id && o.msg.t === "chat" ? [o.msg.text] : []));
    };
    return { make, say };
  }

  test("an administrator sees what a moderator did and what was done to a player, with reasons; the lookup is audited", async () => {
    const { make, say } = await start();
    const king = await make("King", "administrator");
    const mod = await make("Mod", "moderator");
    await make("Bob");
    await make("Alice");
    say(mod.characterId, "/jail Bob 30m spamming the market");
    say(mod.characterId, "/kick Alice");
    say(king.characterId, "/unjail Bob served enough");
    say(king.characterId, "/setclass Bob 7");
    say(king.characterId, "/CheatFile");

    // By the moderator: their jail (from the moderation log, with its reason) and their kick.
    expect(say(king.characterId, "/auditlog mod")).toEqual([
      AUDITLOG_TEXT.header("Mod", 2),
      '2026-11-18 09:00:00 UTC Mod /jail Bob (until 2026-11-18 09:30:00 UTC, "spamming the market")',
      "2026-11-18 09:00:01 UTC Mod /kick Alice",
    ]);
    // To the player: the jail, the release and the class change, but not King's /CheatFile look.
    expect(say(king.characterId, "/auditlog bob")).toEqual([
      AUDITLOG_TEXT.header("Bob", 3),
      '2026-11-18 09:00:00 UTC Mod /jail Bob (until 2026-11-18 09:30:00 UTC, "spamming the market")',
      '2026-11-18 09:00:02 UTC King /unjail Bob ("served enough")',
      "2026-11-18 09:00:03 UTC King /setclass Bob: 1 -> 7",
    ]);
    // By the administrator, the newest 2: the two lookups above.
    expect(say(king.characterId, "/auditlog King 2")).toEqual([
      AUDITLOG_TEXT.header("King", 2),
      '2026-11-18 09:00:05 UTC King /auditlog Mod: {"limit":10}',
      '2026-11-18 09:00:06 UTC King /auditlog Bob: {"limit":10}',
    ]);
    expect(recentAudit(db, 10).filter((r) => r.command === "/cheatfile")).toMatchObject([
      { actor: "King", target: null },
    ]);
  });

  test("usage, an unknown name, a quiet one", async () => {
    const { make, say } = await start();
    const king = await make("King", "administrator");
    await make("Quiet");
    expect(say(king.characterId, "/auditlog")).toEqual([AUDITLOG_TEXT.usage]);
    expect(say(king.characterId, "/auditlog Quiet many")).toEqual([AUDITLOG_TEXT.usage]);
    expect(say(king.characterId, "/auditlog Quiet")).toEqual([AUDITLOG_TEXT.none("Quiet")]);
    expect(say(king.characterId, "/auditlog Nobody")).toEqual([
      ADMIN_TEXT.noSuchCharacter("Nobody"),
    ]);
  });

  test("mutes and unmutes come from the moderation log, once each, with their reasons", async () => {
    const { make, say } = await start();
    const king = await make("King", "administrator");
    const mod = await make("Mod", "moderator");
    await make("Bob");
    say(mod.characterId, "/mute Bob perm flooding");
    say(king.characterId, "/unmute Bob appealed");
    expect(say(king.characterId, "/auditlog bob")).toEqual([
      AUDITLOG_TEXT.header("Bob", 2),
      '2026-11-18 09:00:00 UTC Mod /mute Bob (permanent, "flooding")',
      '2026-11-18 09:00:01 UTC King /unmute Bob ("appealed")',
    ]);
  });

  test("/auditlog is an administrator's: a moderator or a player is told it is unknown, and nothing is audited", async () => {
    const { make, say } = await start();
    const mod = await make("Mod", "moderator");
    const bob = await make("Bob");
    expect(say(mod.characterId, "/auditlog bob")).toEqual([unknownCommandText("/auditlog")]);
    expect(say(bob.characterId, "/auditlog mod")).toEqual([unknownCommandText("/auditlog")]);
    expect(recentAudit(db, 10)).toEqual([]);
  });
});
