/**
 * Bot script: Alice, an immortal, makes Mo a moderator with `/role`; both staff roles read and post
 * `-` lines in green. Mo warps Bob. Alice sets `jailMinutes` in Settings and jails Bob in the seeded
 * jail map x0y0: his shout fails, and when the wall clock passes his sentence he is on the start
 * point. Her `/warpscript` pulls Bob over when he broadcasts the keyword. `/warpmeto`,
 * `/Location`, `/IPlookup`, a counted `/drop`, a forged editor save that lands in `/CheatFile`, and
 * `/setclass`. She kicks Bob, bans him for a day (his login is refused with the end, never the
 * reason), unbans him, bans his IP (which disconnects Mo, on the same address) and unbans it; Mo
 * cannot ban an immortal. Every admin action is in the audit log.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  ADMIN_TEXT,
  banNotice,
  CHAT_COLOR,
  type CreateMsg,
  MODERATION_TEXT,
  type ServerMsg,
  TEXT,
  unknownCommandText,
} from "@secondstaronline/shared";

import { recentAudit } from "../src/persistence/admin.ts";
import type { Rng } from "../src/rng.ts";
import { type Bot, connectBot, settle, startTestServer, type TestServer } from "./harness.ts";

const make = (name: string): CreateMsg => ({
  t: "create",
  name,
  password: "secret",
  sex: 1,
  head: 1,
  classCode: 1,
  str: 11,
  sta: 11,
  int: 11,
  wis: 11,
  dex: 11,
});

/** No spawns, moves, attacks or pushes. */
const rng: Rng = { random: (n) => (n >= 1 ? n : 0) };

type Snapshot = Extract<ServerMsg, { t: "snapshot" }>;
const isSnapshot = (m: ServerMsg): m is Snapshot => m.t === "snapshot";
const lines = (bot: Bot) => bot.inbox.flatMap((m) => (m.t === "chat" ? [m.text] : []));

describe("admin commands, roles, bans and settings", () => {
  let server: TestServer;
  let alice: Bot;
  let bob: Bot;
  let mo: Bot;
  /** The wall clock: the jail sentence and ban ends read it. */
  let wall = Date.parse("2026-11-04T00:00:00.000Z");

  const tick = async (n: number) => {
    await settle();
    server.tickNow(n);
    await settle();
  };
  const login = async (name: string): Promise<Bot> => {
    const bot = await connectBot(server.wsUrl);
    bot.send({ t: "login", name, password: "secret" });
    await bot.waitFor((m) => m.t === "snapshot");
    bot.send({ t: "mapReady" });
    await settle();
    return bot;
  };
  const say = async (bot: Bot, text: string) => {
    bot.send({ t: "chat", text });
    await settle();
  };
  const where = (bot: Bot) => {
    const snap = [...bot.inbox].reverse().find(isSnapshot);
    return snap ? [snap.map.name, snap.you.x, snap.you.y] : null;
  };

  beforeAll(async () => {
    server = startTestServer({ rng, isoNow: () => new Date(wall).toISOString() });
    const bot = await connectBot(server.wsUrl);
    for (const name of ["Alice", "Bob", "Mo"]) {
      bot.send(make(name));
      await bot.waitFor((m) => m.t === "created");
      bot.clear();
    }
    bot.close();
    server.db.run(
      "UPDATE accounts SET role = 'immortal' WHERE id = (SELECT account_id FROM characters WHERE name = 'Alice')",
    );
    server.db.run("UPDATE characters SET x = 6, y = 6 WHERE name = 'Alice'");
    server.db.run("UPDATE characters SET x = 9, y = 6 WHERE name = 'Bob'");
    server.db.run("UPDATE characters SET x = 3, y = 3 WHERE name = 'Mo'");
    alice = await login("Alice");
    bob = await login("Bob");
    mo = await login("Mo");
  });
  afterAll(async () => {
    await server.stop();
  });

  test("/role makes Mo a moderator at once; both staff roles post and read staff chat in CHAT_COLOR.staff", async () => {
    await say(alice, "/role mo moderator");
    expect(lines(alice)).toContain("Mo is now a moderator.");
    await mo.waitFor((m) => m.t === "role" && m.role === "moderator");
    bob.clear();
    await say(alice, "-  meeting at noon");
    await mo.waitFor(
      (m) =>
        m.t === "chat" &&
        m.text === '<... Alice tells the staff "meeting at noon"' &&
        m.color === CHAT_COLOR.staff,
    );
    expect(lines(bob)).toEqual([]);
    alice.clear();
    mo.clear();
    await say(mo, "-hi all");
    await alice.waitFor(
      (m) =>
        m.t === "chat" &&
        m.text === '<... Mo tells the staff "hi all"' &&
        m.color === CHAT_COLOR.staff,
    );
    expect(lines(bob)).toEqual([]);
  });

  test("Mo warps Bob; Mo cannot ban Alice; Bob's /ban and -chat are denied", async () => {
    bob.clear();
    await say(mo, "/warp Bob x1000y992 12 8");
    await bob.waitFor(isSnapshot);
    expect(where(bob)).toEqual(["x1000y992", 12, 8]);
    mo.clear();
    await say(mo, "/ban Alice");
    expect(lines(mo)).toEqual(["*** banning Alice...", MODERATION_TEXT.staffTarget]);
    bob.clear();
    await say(bob, "/ban Alice");
    expect(lines(bob)).toEqual([unknownCommandText("/ban")]);
    bob.clear();
    await say(bob, "-sneak");
    expect(bob.inbox.filter((m) => m.t === "restore" || m.t === "chat")).toEqual([
      { t: "chat", text: ADMIN_TEXT.staffChatDenied, color: CHAT_COLOR.normal },
    ]);
  });

  test("Settings: Alice sets jailMinutes; the window shows it", async () => {
    alice.clear();
    alice.send({ t: "settingsOpen" });
    const rows = await alice.waitFor((m) => m.t === "settings");
    expect(rows.t === "settings" && rows.rows.find((r) => r.key === "jailMinutes")?.value).toBe(10);
    alice.send({ t: "settingsSave", values: { jailMinutes: 2, broadcastCooldownFrames: 0 } });
    await alice.waitFor((m) => m.t === "settingsResult" && m.ok);
    expect(server.game.settings.jailMinutes).toBe(2);
  });

  test("the seeded jail confines Bob until his sentence ends", async () => {
    bob.clear();
    alice.clear();
    await say(alice, "/jail bob");
    expect(lines(alice)).toEqual([
      "*** Jailing bob...",
      "Bob is jailed until 2026-11-04 00:02 UTC.",
    ]);
    await bob.waitFor(isSnapshot);
    bob.send({ t: "mapReady" });
    expect(where(bob)).toEqual(["x0y0", 4, 4]);
    bob.clear();
    await say(bob, "'let me out");
    expect(lines(bob)).toEqual(["You shout but no one can hear you!"]);
    bob.clear();
    wall += 119_000;
    await tick(40);
    expect(bob.inbox.some(isSnapshot)).toBe(false);
    wall += 1000;
    await tick(20);
    await bob.waitFor(isSnapshot);
    // Released to his respawn point: the starting map's tile, where he was created.
    expect(where(bob)).toEqual(["x1000y992", 6, 4]);
    bob.send({ t: "mapReady" });
  });

  test("/warpscript pulls Bob to Alice when he broadcasts the keyword; /warpmeto and /Location", async () => {
    alice.clear();
    await say(alice, "/warpscript help");
    expect(lines(alice)).toEqual(["Warpscript set to: help"]);
    server.db.run("UPDATE characters SET x = 1 WHERE name = 'Bob'");
    await say(mo, "/warp Bob x1000y992 15 10");
    bob.clear();
    await say(bob, "'can someone HELP me");
    await bob.waitFor(isSnapshot);
    expect(where(bob)).toEqual(["x1000y992", 6, 6]);
    expect(lines(alice)).toContain("*** Warping Bob...");
    await say(alice, "/warpscript OFF");

    await say(mo, "/warp Bob x1000y992 15 10");
    alice.clear();
    await say(alice, "/warpmeto bob");
    await alice.waitFor(isSnapshot);
    alice.send({ t: "mapReady" });
    await say(alice, "/Location");
    expect(lines(alice)).toEqual([
      "*** Warping you to bob...",
      "You are at map: x1000y992 at position: 15-10",
    ]);
  });

  test("/IPlookup, a counted /drop, /setclass and /Inventory", async () => {
    alice.clear();
    await say(alice, "/IPlookup Bob");
    const [looking, ip] = lines(alice);
    expect(looking).toBe("Looking up IP address for Bob...");
    expect(ip).toMatch(/^The IP is: \S+$/);
    // The faced tile of 6,6 (north, the login facing) is open grass.
    await say(alice, "/warp Alice x1000y992 6 6");
    await alice.waitFor(isSnapshot);
    alice.send({ t: "mapReady" });
    alice.clear();
    await say(alice, "/drop 3 Apple");
    await say(alice, "/setclass bob ninja");
    expect(lines(alice)).toEqual(["Bob is now a Ninja."]);
    const row = server.db
      .query<{ class_code: number }, []>("SELECT class_code FROM characters WHERE name = 'Bob'")
      .get();
    expect(row?.class_code).toBe(12);
    alice.clear();
    await say(alice, "/Inventory");
    expect(lines(alice)[0]).toBe("Apple-2");
  });

  test("a forged NPC editor save is refused and shows in /CheatFile", async () => {
    bob.send({ t: "npcSave", name: "Cril", text: "GLD|1" });
    await settle();
    alice.clear();
    await say(alice, "/CheatFile");
    const [header, entry] = lines(alice);
    expect(header).toBe("* Cheater Log:");
    expect(entry).toMatch(/^Bob - at IP \S+ - Attempting to get Admin access$/);
  });

  test("/kick, then /ban: Bob's login is refused until /unban", async () => {
    await say(alice, "/kick Bob");
    const kicked = await bob.waitFor((m) => m.t === "kicked");
    expect(kicked).toEqual({ t: "kicked", text: TEXT.kicked });
    expect((await bob.closed).code).toBe(4005);

    bob = await login("Bob");
    const notice = banNotice(ADMIN_TEXT.banned, new Date(wall + 86_400_000).toISOString());
    await say(alice, "/ban bob 1d being a rude person");
    const kick = await bob.waitFor((m) => m.t === "kicked");
    expect(kick).toEqual({ t: "kicked", text: notice });
    expect(JSON.stringify(kick)).not.toContain("rude");
    const again = await connectBot(server.wsUrl);
    again.send({ t: "login", name: "Bob", password: "secret" });
    expect(await again.waitFor((m) => m.t === "denied")).toEqual({ t: "denied", text: notice });
    alice.clear();
    await say(alice, "/unban Bob");
    expect(lines(alice)).toEqual(["Bob is no longer banned."]);
    again.clear();
    again.send({ t: "login", name: "Bob", password: "secret" });
    await again.waitFor(isSnapshot);
    again.close();
    await settle();
  });

  test("/BanIP disconnects and refuses that address, except an immortal; /unbanIP lets it in", async () => {
    alice.clear();
    await say(alice, "/IPlookup Mo");
    const ip = lines(alice)[1]?.replace("The IP is: ", "") ?? "";
    await say(alice, `/BanIP ${ip}`);
    expect(lines(alice)).toContain(`Banning ${ip}...`);
    // Every bot shares the address: Mo is disconnected, Alice (an immortal) is not.
    const notice = banNotice(ADMIN_TEXT.ipBanned, new Date(wall + 30 * 86_400_000).toISOString());
    expect(await mo.waitFor((m) => m.t === "kicked")).toEqual({ t: "kicked", text: notice });
    expect(alice.inbox.some((m) => m.t === "kicked")).toBe(false);
    const c = await connectBot(server.wsUrl);
    c.send({ t: "login", name: "Bob", password: "secret" });
    expect(await c.waitFor((m) => m.t === "denied")).toEqual({ t: "denied", text: notice });
    await say(alice, `/unbanIP ${ip}`);
    c.clear();
    c.send({ t: "login", name: "Bob", password: "secret" });
    await c.waitFor(isSnapshot);
    c.close();
  });

  test("every admin action is in the audit log", () => {
    const cmds = recentAudit(server.db, 100).map((r) => r.command);
    for (const c of [
      "/role",
      "/warp",
      "settings",
      "/jail",
      "/warpscript",
      "/warpmeto",
      "/iplookup",
      "/drop",
      "/setclass",
      "/kick",
      "/ban",
      "/unban",
      "/banip",
      "/unbanip",
    ]) {
      expect(cmds).toContain(c);
    }
  });
});
