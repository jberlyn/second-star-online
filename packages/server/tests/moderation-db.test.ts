/**
 * Moderation through the real database: the migration that carries old bans over, timed bans at
 * login, IP bans by /64, login address history, stored jail sentences and mutes.
 */
import { beforeEach, describe, expect, test } from "bun:test";

import {
  ADMIN_TEXT,
  banNotice,
  MODERATION_TEXT,
  type ServerMsg,
  startingCharacter,
} from "@secondstaronline/shared";

import { createGame } from "../src/game.ts";
import { insertAccount, setRole } from "../src/persistence/accounts.ts";
import { insertCharacter } from "../src/persistence/characters.ts";
import { type Db, openDatabase } from "../src/persistence/database.ts";
import { findCharacterByName } from "../src/persistence/mail.ts";
import { findMapByCoords } from "../src/persistence/maps.ts";
import { loadMigrations, migrate, runMigrations } from "../src/persistence/migrations.ts";
import {
  accountAddresses,
  accountBan,
  characterJail,
  normalizeIpBans,
  pruneModeration,
} from "../src/persistence/moderation.ts";
import { loadSettingOverrides, saveSettingOverride } from "../src/persistence/settings.ts";
import { NEVER_PUSH } from "./helpers/sim.ts";

type Out = { to: string; msg: ServerMsg }[];
const texts = (out: Out, id: string) =>
  out.flatMap((o) => (o.to === id && o.msg.t === "chat" ? [o.msg.text] : []));

const T0 = Date.parse("2026-11-17T09:00:00.000Z");

describe("the moderation migration", () => {
  const MINE = "20261117_29_moderation.sql";

  test("old bans carry over permanent, with the banner's rank; IP bans get keys; prisoners keep a sentence", () => {
    const db = openDatabase();
    const all = loadMigrations();
    runMigrations(
      db,
      // Every other migration; the mutes one rebuilds a table this one makes, so it waits too.
      all.filter((m) => m.name !== MINE && m.name !== "20261120_41_mutes.sql"),
    );
    const now = "2026-11-10T00:00:00.000Z";
    const acct = (username: string, role: "player" | "moderator" | "immortal" = "player") =>
      insertAccount(db, { username, passwordHash: "h", now, role }).id;
    const imm = acct("imm", "immortal");
    const mod = acct("mod", "moderator");
    const demoted = acct("demoted", "player");
    const victims = ["v1", "v2", "v3", "v4"].map((v) => acct(v));
    const home = findMapByCoords(db, 1000, 992);
    const jail = findMapByCoords(db, 0, 0);
    if (!home || !jail) {
      throw new Error("no seed maps");
    }
    const character = (accountId: string, name: string, onJail = false) =>
      insertCharacter(db, {
        accountId,
        start: startingCharacter({
          name,
          sex: 1,
          head: 1,
          classCode: 1,
          str: 1,
          sta: 1,
          int: 1,
          wis: 1,
          dex: 1,
        }),
        position: { mapId: (onJail ? jail : home).id, x: 4, y: 4, facing: "S" },
        now,
      });
    for (const [i, id] of victims.entries()) {
      character(id, `Victim${"abcd"[i]}`);
    }
    const prisoner = acct("prisoner");
    character(prisoner, "Prisoner", true);
    const staffInJail = acct("visitor", "moderator");
    character(staffInJail, "Visitor", true);
    const ban = (id: string, by: string) =>
      db.run("UPDATE accounts SET banned_at = ?, banned_by = ? WHERE id = ?", [now, by, id]);
    ban(victims[0] ?? "", imm);
    ban(victims[1] ?? "", mod);
    ban(victims[2] ?? "", "gone-account");
    ban(victims[3] ?? "", demoted);
    for (const ip of ["10.0.0.1", "2001:0DB8::1", "2001:db8::2", "not an ip"]) {
      db.run("INSERT INTO ip_bans (ip, banned_by, created_at) VALUES (?, ?, ?)", [ip, imm, now]);
    }
    saveSettingOverride(db, "jailFrames", 400, now);

    migrate(db);
    normalizeIpBans(db, now);

    const rank = (id: string | undefined) => accountBan(db, id ?? "")?.actorRank;
    expect(victims.map(rank)).toEqual(["immortal", "moderator", "immortal", "moderator"]);
    expect(accountBan(db, victims[0] ?? "")).toMatchObject({
      actorId: imm,
      actorName: "imm",
      expiresAt: null,
      reason: "",
    });
    expect(
      db
        .query("SELECT COUNT(*) AS n FROM pragma_table_info('accounts') WHERE name LIKE 'banned%'")
        .get(),
    ).toEqual({ n: 0 });
    expect(db.query("SELECT ip_key, address FROM ip_bans ORDER BY ip_key").all()).toEqual([
      { ip_key: "10.0.0.1", address: "10.0.0.1" },
      { ip_key: "2001:db8:0:0", address: "2001:db8::1" },
    ]);
    expect(
      db
        .query(
          "SELECT address, reason FROM moderation_log WHERE action = 'unipban' ORDER BY address",
        )
        .all(),
    ).toEqual([
      { address: "2001:db8::2", reason: "Same address as another ban" },
      { address: "not an ip", reason: "Not an address" },
    ]);
    const p = findCharacterByName(db, "Prisoner");
    const v = findCharacterByName(db, "Visitor");
    expect(characterJail(db, p?.id ?? "")).toMatchObject({
      actorName: "system",
      reason: "Carried over",
    });
    expect(characterJail(db, v?.id ?? "")).toBeNull();
    expect(loadSettingOverrides(db).has("jailFrames")).toBe(false);
    db.close();
  });
});

describe("moderation in the game (real SQLite)", () => {
  let db: Db;
  let wall = T0;
  const sent: Out = [];
  const kicked: string[] = [];

  beforeEach(() => {
    db = openDatabase();
    migrate(db);
    wall = T0;
    sent.length = 0;
    kicked.length = 0;
  });

  const startGame = () =>
    createGame({
      db,
      send: (to, msg) => sent.push({ to, msg }),
      isoNow: () => new Date(wall).toISOString(),
      rng: NEVER_PUSH,
      kick: (id) => kicked.push(id),
    });

  async function start() {
    let game = startGame();
    const make = async (name: string, role?: "moderator" | "immortal", ip = "10.0.0.1") => {
      await game.create({
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
      });
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
      return texts(sent, id);
    };
    const restart = () => {
      game = startGame();
      return game;
    };
    return { game: () => game, make, say, restart };
  }

  test("a timed ban refuses login with its end, and lapses on time", async () => {
    const { game, make, say } = await start();
    const alice = await make("Alice", "immortal");
    const bob = await make("Bob");
    expect(say(alice.characterId, "/ban Bob 1h spamming")[1]).toBe(
      "Bob is banned until 2026-11-17 10:00 UTC.",
    );
    game().leave(bob.characterId);
    const notice = banNotice(ADMIN_TEXT.banned, "2026-11-17T10:00:00.000Z");
    expect(await game().login("Bob", "pw", "10.0.0.5")).toEqual({ ok: false, text: notice });
    expect(notice).not.toContain("spamming");
    wall += 60 * 60_000;
    expect((await game().login("Bob", "pw", "10.0.0.5")).ok).toBe(true);
  });

  test("a ban keeps its maker's rank at the time: a demoted immortal's ban stays theirs", async () => {
    const { game, make, say } = await start();
    const alice = await make("Alice", "immortal");
    const mo = await make("Mo", "moderator");
    await make("Bob");
    say(alice.characterId, "/ban Bob");
    setRole(db, alice.accountId, "moderator", "now");
    expect(say(mo.characterId, "/unban Bob")).toEqual([MODERATION_TEXT.notYourBan("Bob", "Alice")]);
    expect(
      db.query("SELECT action, actor_rank FROM moderation_log WHERE action = 'ban'").all(),
    ).toEqual([{ action: "ban", actor_rank: "immortal" }]);
    expect(game().settings.banLength).toBe(0);
  });

  test("IP bans cover the IPv6 /64, refuse creation and resume, and never stop an immortal", async () => {
    const { game, make, say } = await start();
    const alice = await make("Alice", "immortal", "2001:db8:7:7::1");
    const bob = await make("Bob", undefined, "2001:db8:7:7::2");
    expect(say(alice.characterId, "/banip 2001:db8:7:7::99 1d")[1]).toBe(
      "Banned 2001:db8:7:7::/64 until 2026-11-18 09:00 UTC.",
    );
    // Bob shared the /64 and is disconnected; Alice is not.
    expect(kicked).toEqual([bob.characterId]);
    game().leave(bob.characterId);
    const notice = banNotice(ADMIN_TEXT.ipBanned, "2026-11-18T09:00:00.000Z");
    expect(await game().login("Bob", "pw", "2001:db8:7:7:abcd::1")).toEqual({
      ok: false,
      text: notice,
    });
    expect(game().refusal(bob.characterId, "2001:db8:7:7::3")).toBe(notice);
    expect(game().refusal(alice.characterId, "2001:db8:7:7::3")).toBeNull();
    expect((await game().login("Alice", "pw", "2001:db8:7:7::1")).ok).toBe(true);
    expect(
      await game().create(
        {
          t: "create",
          name: "Carl",
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
        "2001:db8:7:7::4",
      ),
    ).toEqual({ ok: false, text: notice });
    expect((await game().login("Bob", "pw", "2001:db8:8:8::1")).ok).toBe(true);
  });

  test("login addresses are kept for /banip <name>; old ones are forgotten", async () => {
    const { game, make, say } = await start();
    const alice = await make("Alice", "immortal", "10.0.0.1");
    const bob = await make("Bob", undefined, "10.0.0.2");
    game().leave(bob.characterId);
    wall += 60_000;
    game().enter(bob.characterId, true, "10.0.0.3");
    expect(accountAddresses(db, bob.accountId).map((a) => a.address)).toEqual([
      "10.0.0.3",
      "10.0.0.2",
    ]);
    expect(say(alice.characterId, "/banip Bob all perm")[1]).toBe(
      "Banned 2 addresses used by Bob permanently.",
    );
    expect(say(alice.characterId, "/banlist 10.0.0.2")).toEqual([
      "* 10.0.0.2 - permanent - Alice (immortal)",
      "* Seen with:",
      "Bob (last 2026-11-17 09:00 UTC)",
    ]);
    pruneModeration(db, new Date(wall + 181 * 86_400_000).toISOString(), 180);
    expect(accountAddresses(db, bob.accountId)).toEqual([]);
  });

  test("a sentence survives logout and restart, and one that ends offline releases at login", async () => {
    const { game, make, say, restart } = await start();
    const alice = await make("Alice", "immortal");
    const bob = await make("Bob");
    say(alice.characterId, "/jail Bob 30m");
    expect(game().world.players.get(bob.characterId)?.map.name).toBe("x0y0");
    game().leave(bob.characterId);
    restart();
    game().enter(bob.characterId, false, "10.0.0.1");
    const p = game().world.players.get(bob.characterId);
    expect([p?.map.name, p?.jailUntil]).toEqual(["x0y0", Date.parse("2026-11-17T09:30:00.000Z")]);
    game().leave(bob.characterId);
    wall += 31 * 60_000;
    game().enter(bob.characterId, false, "10.0.0.1");
    const q = game().world.players.get(bob.characterId);
    expect([q?.map.name, q?.jailUntil]).toEqual(["x1000y992", null]);
  });

  test("a mute survives logout and restart and is told at login; one that ends offline is gone", async () => {
    const { game, make, say, restart } = await start();
    const alice = await make("Alice", "immortal");
    const bob = await make("Bob");
    say(alice.characterId, "/mute Bob 30m flooding");
    game().leave(bob.characterId);
    restart();
    sent.length = 0;
    game().enter(bob.characterId, false, "10.0.0.1");
    const notice = MODERATION_TEXT.youAreMuted("2026-11-17T09:30:00.000Z");
    expect(texts(sent, bob.characterId)).toContain(notice);
    expect(say(bob.characterId, "hello")).toEqual([notice]);
    expect(
      db.query("SELECT action, reason FROM moderation_log WHERE action = 'mute'").all(),
    ).toEqual([{ action: "mute", reason: "flooding" }]);
    game().leave(bob.characterId);
    wall += 31 * 60_000;
    game().enter(bob.characterId, false, "10.0.0.1");
    expect(game().world.players.get(bob.characterId)?.muteUntil).toBeNull();
    expect(say(bob.characterId, "hello")).toEqual(['Bob says "hello"']);
  });

  test("a prisoner is told the sentence at login", async () => {
    const { game, make, say } = await start();
    const alice = await make("Alice", "immortal");
    const bob = await make("Bob");
    game().leave(bob.characterId);
    say(alice.characterId, "/jail Bob 2h");
    sent.length = 0;
    game().enter(bob.characterId, false, "10.0.0.1");
    expect(texts(sent, bob.characterId)).toContain(
      MODERATION_TEXT.youAreJailed("2026-11-17T11:00:00.000Z"),
    );
  });

  test("an offline /jail puts the prisoner in jail at login", async () => {
    const { game, make, say } = await start();
    const alice = await make("Alice", "immortal");
    const bob = await make("Bob");
    game().leave(bob.characterId);
    expect(say(alice.characterId, "/jail Bob 2h")[1]).toBe(
      "Bob is jailed until 2026-11-17 11:00 UTC.",
    );
    game().enter(bob.characterId, false, "10.0.0.1");
    const p = game().world.players.get(bob.characterId);
    expect([p?.map.name, p?.x, p?.y]).toEqual(["x0y0", 4, 4]);
  });

  test("staff may stand in the jail without a sentence; a player there without one is released", async () => {
    const { game, make, say } = await start();
    const alice = await make("Alice", "immortal");
    const bob = await make("Bob");
    say(alice.characterId, "/jail Bob 1m");
    say(alice.characterId, "/warp Alice x0y0 5 5");
    game().leave(bob.characterId);
    game().leave(alice.characterId);
    wall += 2 * 60_000;
    game().enter(alice.characterId, false, "10.0.0.1");
    game().enter(bob.characterId, false, "10.0.0.1");
    expect(game().world.players.get(alice.characterId)?.map.name).toBe("x0y0");
    expect(game().world.players.get(bob.characterId)?.map.name).toBe("x1000y992");
  });
});
