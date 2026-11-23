/**
 * The Control Panel's Characters page and player hub (issue #26): the search, the hub read live
 * or from the database, what each permission shows, the audit, and the moderation buttons that
 * run the chat commands' own code.
 */
import { beforeEach, describe, expect, test } from "bun:test";

import {
  type CharacterHub,
  HUB_TEXT,
  hubArgs,
  inGameSchema,
  type ServerMsg,
} from "@secondstaronline/shared";

import { createGame, type Game } from "../src/game.ts";
import { setRole } from "../src/persistence/accounts.ts";
import { recentAudit, recentCheats } from "../src/persistence/admin.ts";
import { type Db, openDatabase } from "../src/persistence/database.ts";
import { migrate } from "../src/persistence/migrations.ts";
import {
  accountBan,
  accountMute,
  characterJail,
  moderationHistory,
} from "../src/persistence/moderation.ts";
import { NEVER_PUSH } from "./helpers/sim.ts";

describe("hub arguments", () => {
  test("an empty length is the default; a bad one is refused; the reason's spaces collapse", () => {
    expect(hubArgs("", "  spam   and  flood ")).toEqual({
      scope: null,
      duration: null,
      reason: "spam and flood",
    });
    expect(hubArgs("7d", "x")).toEqual({ scope: null, duration: 7 * 24 * 60, reason: "x" });
    expect(hubArgs("perm", "")).toEqual({ scope: null, duration: "perm", reason: "" });
    expect(hubArgs("soon", "x")).toBeNull();
    expect(hubArgs("0m", "x")).toBeNull();
  });

  test("the intents are strict", () => {
    const ok = {
      t: "characterModerate",
      seq: 1,
      name: "Al",
      action: "ban",
      duration: "",
      reason: "x",
    };
    expect(inGameSchema.safeParse(ok).success).toBe(true);
    expect(inGameSchema.safeParse({ ...ok, action: "warp" }).success).toBe(false);
    expect(
      inGameSchema.safeParse({ t: "characterSearch", seq: 1, query: "a".repeat(21) }).success,
    ).toBe(false);
    expect(inGameSchema.safeParse({ t: "characterOpen", seq: 1, name: "" }).success).toBe(false);
  });
});

describe("the player hub", () => {
  let db: Db;
  let wall: number;
  const sent: { to: string; msg: ServerMsg }[] = [];
  const kicked: string[] = [];

  beforeEach(() => {
    db = openDatabase();
    migrate(db);
    wall = Date.parse("2026-11-22T09:00:00.000Z");
    sent.length = 0;
    kicked.length = 0;
    // A role that may look characters up but not read chat or addresses, nor ban.
    db.run(
      `INSERT INTO roles (id, name, rank, permissions, created_at, updated_at)
       VALUES ('viewer', 'Viewer', 1, '["characterView","kick"]', ?, ?)`,
      [new Date(wall).toISOString(), new Date(wall).toISOString()],
    );
  });

  function start() {
    const game = createGame({
      db,
      send: (to, msg) => sent.push({ to, msg }),
      kick: (id) => kicked.push(id),
      isoNow: () => new Date(wall).toISOString(),
      rng: NEVER_PUSH,
    });
    let ips = 0;
    const make = async (name: string, role?: string, online = true) => {
      ips += 1;
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
        // Account creation is limited per address.
        `10.0.1.${ips}`,
      );
      const l = await game.login(name, "pw", "10.0.0.1");
      if (!l.ok) {
        throw new Error(l.text);
      }
      if (role) {
        setRole(db, l.accountId, role, new Date(wall).toISOString());
      }
      if (online) {
        game.enter(l.characterId, false, "10.0.0.7");
      }
      return l;
    };
    return { game, make };
  }

  const reply = <T extends ServerMsg["t"]>(id: string, t: T) => {
    const m = sent.find((s) => s.to === id && s.msg.t === t)?.msg;
    return m as Extract<ServerMsg, { t: T }> | undefined;
  };

  const open = (game: Game, id: string, name: string): CharacterHub | null => {
    sent.length = 0;
    game.intent(id, { t: "characterOpen", seq: 3, name });
    return reply(id, "characterHub")?.hub ?? null;
  };

  const search = (game: Game, id: string, query: string) => {
    sent.length = 0;
    game.intent(id, { t: "characterSearch", seq: 4, query });
    return reply(id, "characterList")?.rows.map((r) => [r.name, r.online, r.role]);
  };

  const moderate = (game: Game, id: string, over: Record<string, unknown>) => {
    sent.length = 0;
    game.intent(id, {
      t: "characterModerate",
      seq: 5,
      name: "Al",
      action: "ban",
      duration: "",
      reason: "spam",
      ...over,
    } as never);
    return reply(id, "characterResult");
  };

  test("a player without characterView gets nothing and is written to the cheat log", async () => {
    const { game, make } = start();
    const al = await make("Al");
    expect(open(game, al.characterId, "Al")).toBeNull();
    expect(sent).toEqual([]);
    expect(search(game, al.characterId, "")).toBeUndefined();
    expect(recentCheats(db, 5).map((c) => c.reason)).toContain("Attempted Admin Access");
    expect(recentAudit(db, 5).filter((a) => a.command === "characterView")).toEqual([]);
  });

  test("the search finds names containing the text, those starting with it first, and who is online", async () => {
    const { game, make } = start();
    const god = await make("God", "administrator");
    await make("Albert", undefined, false);
    wall += 1000;
    await make("Sal");
    wall += 1000;
    await make("Alba");
    expect(search(game, god.characterId, "al")).toEqual([
      ["Alba", true, null],
      ["Albert", false, null],
      ["Sal", true, null],
    ]);
    expect(search(game, god.characterId, "GOD")).toEqual([["God", true, "Admin"]]);
    expect(search(game, god.characterId, "%")).toEqual([]);
    // Empty: the most recently saved first.
    expect(search(game, god.characterId, "")?.[0]?.[0]).toBe("Alba");
  });

  test("an online character's hub is read live, and reads the same from the database once they leave", async () => {
    const { game, make } = start();
    const god = await make("God", "administrator");
    const al = await make("Al");
    const p = game.world.players.get(al.characterId);
    if (!p) {
      throw new Error("not online");
    }
    p.char.gold = 1234;
    p.char.bank = 50;
    p.char.vault = ["Steel Sword"];
    p.char.skills[0] = 7;
    p.spell.book = ["Minor Heal"];
    p.invDirty = true;
    p.char.storeDirty = true;
    p.spell.bookDirty = true;
    // The tick writes what changed.
    game.tick();
    const live = open(game, god.characterId, "al");
    expect(live?.presence).toBe("playing");
    expect(live?.sheet).toMatchObject({ name: "Al", gold: 1234, bank: 50, vault: ["Steel Sword"] });
    expect(live?.sheet.skills.Slash).toBe(7);
    expect(live?.sheet.bag[0]).toEqual({ item: "Apple", qty: expect.any(Number) });
    game.leave(al.characterId);
    game.tick();
    const saved = open(game, god.characterId, "Al");
    expect(saved?.presence).toBe("offline");
    expect(saved?.sheet).toEqual(live?.sheet as CharacterHub["sheet"]);
  });

  test("the chat log and addresses come only with chatlog and banip; every read is audited", async () => {
    const { game, make } = start();
    const god = await make("God", "administrator");
    const viewer = await make("Vic", "viewer");
    const al = await make("Al");
    game.intent(al.characterId, { t: "chat", text: "hello there" });
    const full = open(game, god.characterId, "Al");
    expect(full?.chat?.map((c) => c.text)).toContain("hello there");
    expect(full?.addresses?.map((a) => a.address)).toEqual(["10.0.0.7"]);
    const limited = open(game, viewer.characterId, "Al");
    expect(limited?.name).toBe("Al");
    expect(limited?.chat).toBeUndefined();
    expect(limited?.addresses).toBeUndefined();
    const audits = recentAudit(db, 5).filter((a) => a.command === "characterView");
    expect(audits.map((a) => [a.target, JSON.parse(a.after ?? "null")])).toEqual([
      ["Al", { chat: true, addresses: true }],
      ["Al", { chat: false, addresses: false }],
    ]);
  });

  test("an unknown name answers with an error, and is audited", async () => {
    const { game, make } = start();
    const god = await make("God", "administrator");
    sent.length = 0;
    game.intent(god.characterId, { t: "characterOpen", seq: 9, name: "Nobody" });
    expect(reply(god.characterId, "characterHub")).toEqual({
      t: "characterHub",
      seq: 9,
      hub: null,
      error: HUB_TEXT.notFound("Nobody"),
    });
    expect(recentAudit(db, 1)[0]?.target).toBe("Nobody");
  });

  test("Ban from the hub runs /ban: it is logged with its reason, the player is kicked and the hub shows it", async () => {
    const { game, make } = start();
    const god = await make("God", "administrator");
    const al = await make("Al");
    const r = moderate(game, god.characterId, { duration: "7d", reason: "  real  money trading " });
    expect(r?.ok).toBe(true);
    expect(r?.text).toContain("Al");
    expect(kicked).toEqual([al.characterId]);
    expect(accountBan(db, al.accountId)?.reason).toBe("real money trading");
    expect(accountBan(db, al.accountId)?.expiresAt).toBe("2026-11-29T09:00:00.000Z");
    game.leave(al.characterId);
    const hub = open(game, god.characterId, "Al");
    expect(hub?.ban?.reason).toBe("real money trading");
    expect(hub?.history.map((h) => h.action)).toEqual(["ban"]);
    // Lifted the same way.
    expect(moderate(game, god.characterId, { action: "unban", reason: "appeal" })?.ok).toBe(true);
    expect(moderationHistory(db, al.accountId, 5).map((h) => [h.action, h.reason])).toEqual([
      ["ban", "real money trading"],
      ["unban", "appeal"],
    ]);
  });

  test("a ban, jail or mute needs a reason and a length the commands understand", async () => {
    const { game, make } = start();
    const god = await make("God", "administrator");
    const al = await make("Al");
    expect(moderate(game, god.characterId, { reason: "  " })).toEqual({
      t: "characterResult",
      seq: 5,
      ok: false,
      text: HUB_TEXT.needReason,
    });
    expect(moderate(game, god.characterId, { action: "jail", duration: "soon" })).toEqual({
      t: "characterResult",
      seq: 5,
      ok: false,
      text: HUB_TEXT.badDuration,
    });
    expect(accountBan(db, al.accountId)).toBeNull();
    // A lift needs neither, and refuses what is not in force with the command's own line.
    const r = moderate(game, god.characterId, { action: "unmute", reason: "" });
    expect(r?.ok).toBe(false);
    expect(r?.text).toContain("Al");
  });

  test("each button needs its command's permission; the command's rank checks still apply", async () => {
    const { game, make } = start();
    const god = await make("God", "administrator");
    const viewer = await make("Vic", "viewer");
    await make("Al");
    // Refused and cheat-logged, but answered, so a hub whose role changed is not left waiting.
    expect(moderate(game, viewer.characterId, {})).toEqual({
      t: "characterResult",
      seq: 5,
      ok: false,
      text: HUB_TEXT.notAllowed,
    });
    expect(recentCheats(db, 1)[0]?.reason).toBe("Attempted Admin Access");
    // The viewer may kick, but not an administrator.
    const r = moderate(game, viewer.characterId, { action: "kick", name: "God", reason: "" });
    expect(r?.ok).toBe(false);
    expect(kicked).toEqual([]);
    expect(game.world.players.has(god.characterId)).toBe(true);
  });

  test("IP bans in force and the address in an IP ban's history row are /banip's alone", async () => {
    const { game, make } = start();
    const god = await make("God", "administrator");
    const viewer = await make("Vic", "viewer");
    await make("Al");
    sent.length = 0;
    game.intent(god.characterId, { t: "chat", text: "/banip Al 7d botting" });
    const full = open(game, god.characterId, "Al");
    expect(full?.ipBans?.map((b) => [b.address, b.reason])).toEqual([["10.0.0.7", "botting"]]);
    expect(full?.bypassesIpBans).toBe(false);
    expect(full?.history.map((h) => [h.action, h.address])).toEqual([["ipban", "10.0.0.7"]]);
    const limited = open(game, viewer.characterId, "Al");
    expect(limited?.ipBans).toBeUndefined();
    expect(limited?.bypassesIpBans).toBeUndefined();
    // The viewer sees that an IP ban was made, as /banlist shows a moderator, not where.
    expect(limited?.history.map((h) => [h.action, h.address])).toEqual([["ipban", null]]);
    expect(JSON.stringify(limited)).not.toContain("10.0.0.7");
  });

  test("a hub kick says so and kicks; kicking yourself is refused", async () => {
    const { game, make } = start();
    const god = await make("God", "administrator");
    const al = await make("Al");
    const r = moderate(game, god.characterId, { action: "kick", reason: "" });
    expect(r?.ok).toBe(true);
    expect(r?.text).toContain("Al");
    expect(kicked).toEqual([al.characterId]);
    const self = moderate(game, god.characterId, { action: "kick", name: "god", reason: "" });
    expect(self).toEqual({
      t: "characterResult",
      seq: 5,
      ok: false,
      text: "You cannot kick yourself.",
    });
    expect(kicked).toEqual([al.characterId]);
  });

  test("Jail and Mute from the hub run /jail and /mute, online, and their lifts end them", async () => {
    const { game, make } = start();
    const god = await make("God", "administrator");
    const al = await make("Al");
    expect(moderate(game, god.characterId, { action: "jail", duration: "1h" })?.ok).toBe(true);
    expect(characterJail(db, al.characterId)?.reason).toBe("spam");
    expect(game.world.players.get(al.characterId)?.jailUntil).toBe(wall + 3_600_000);
    expect(moderate(game, god.characterId, { action: "mute", duration: "perm" })?.ok).toBe(true);
    expect(accountMute(db, al.accountId)?.expiresAt).toBeNull();
    expect(open(game, god.characterId, "Al")?.mute?.reason).toBe("spam");
    expect(moderate(game, god.characterId, { action: "unjail", reason: "" })?.ok).toBe(true);
    expect(moderate(game, god.characterId, { action: "unmute", reason: "" })?.ok).toBe(true);
    expect(game.world.players.get(al.characterId)?.jailUntil).toBeNull();
    expect(game.world.players.get(al.characterId)?.muteUntil).toBeNull();
    const hub = open(game, god.characterId, "Al");
    expect([hub?.jail, hub?.mute]).toEqual([null, null]);
  });

  test("an online character's level and class in the search are the live ones; a staff member off the map is editing", async () => {
    const { game, make } = start();
    const god = await make("God", "administrator");
    const al = await make("Al");
    const p = game.world.players.get(al.characterId);
    if (!p) {
      throw new Error("not online");
    }
    p.char.vitals.level = 9;
    sent.length = 0;
    game.intent(god.characterId, { t: "characterSearch", seq: 2, query: "Al" });
    expect(reply(god.characterId, "characterList")?.rows[0]?.level).toBe(9);
    game.intent(god.characterId, { t: "controlPanelOpen" });
    expect(open(game, god.characterId, "God")?.presence).toBe("editing");
  });
});
