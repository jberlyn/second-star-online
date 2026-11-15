/**
 * Bot script: Alice, an immortal, makes Mo a moderator with `/role`; Mo reads her `-` line but his
 * own stays typed. Mo warps Bob. Alice uses the seeded jail map x0y0 to jail Bob
 * for the `jailFrames` she sets in Settings: his shout fails, and when the sentence ends he is on
 * the start point. Her `/warpscript` pulls Bob over when he broadcasts the keyword. `/warpmeto`,
 * `/Location`, `/IPlookup`, a counted `/drop`, a forged editor save that lands in `/CheatFile`, and
 * `/setclass`. She kicks Bob, bans him (his login is refused), unbans him, bans his IP and unbans
 * it; Mo's `/ban` is refused. Every admin action is in the audit log.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { ADMIN_TEXT, type CreateMsg, type ServerMsg, TEXT } from "@secondstaronline/shared";

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
    server = startTestServer({ rng });
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

  test("/role makes Mo a moderator at once; he reads admin chat but his own line stays typed", async () => {
    await say(alice, "/role mo moderator");
    expect(lines(alice)).toContain("Mo is now a moderator.");
    await mo.waitFor((m) => m.t === "role" && m.role === "moderator");
    bob.clear();
    await say(alice, "-  meeting at noon");
    await mo.waitFor(
      (m) => m.t === "chat" && m.text === '<... Alice tells the admins "meeting at noon"',
    );
    expect(lines(bob)).toEqual([]);
    mo.clear();
    await say(mo, "-hi all");
    expect(mo.inbox.filter((m) => m.t === "restore" || m.t === "chat")).toEqual([
      { t: "restore", text: "-hi all" },
    ]);
    expect(alice.inbox.some((m) => m.t === "chat" && m.text.includes("hi all"))).toBe(false);
  });

  test("Mo warps Bob; Mo's /ban is refused", async () => {
    bob.clear();
    await say(mo, "/warp Bob x1000y992 12 8");
    await bob.waitFor(isSnapshot);
    expect(where(bob)).toEqual(["x1000y992", 12, 8]);
    mo.clear();
    await say(mo, "/ban Bob");
    expect(lines(mo)).toEqual([ADMIN_TEXT.banDenied]);
  });

  test("Settings: Alice sets jailFrames; the window shows it", async () => {
    alice.clear();
    alice.send({ t: "settingsOpen" });
    const rows = await alice.waitFor((m) => m.t === "settings");
    expect(rows.t === "settings" && rows.rows.find((r) => r.key === "jailFrames")?.value).toBe(
      8000,
    );
    alice.send({ t: "settingsSave", values: { jailFrames: 40, broadcastCooldownFrames: 0 } });
    await alice.waitFor((m) => m.t === "settingsResult" && m.ok);
    expect(server.game.settings.jailFrames).toBe(40);
  });

  test("the seeded jail confines Bob until his sentence ends", async () => {
    bob.clear();
    alice.clear();
    await say(alice, "/jail bob");
    expect(lines(alice)).toEqual(["*** Jailing bob..."]);
    await bob.waitFor(isSnapshot);
    bob.send({ t: "mapReady" });
    expect(where(bob)).toEqual(["x0y0", 4, 4]);
    bob.clear();
    await say(bob, "'let me out");
    expect(lines(bob)).toEqual(["You shout but no one can hear you!"]);
    bob.clear();
    await tick(39);
    expect(bob.inbox.some(isSnapshot)).toBe(false);
    await tick(1);
    await bob.waitFor(isSnapshot);
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
    await say(alice, "/ban bob");
    expect(await bob.waitFor((m) => m.t === "kicked")).toEqual({
      t: "kicked",
      text: ADMIN_TEXT.banned,
    });
    const again = await connectBot(server.wsUrl);
    again.send({ t: "login", name: "Bob", password: "secret" });
    expect(await again.waitFor((m) => m.t === "denied")).toEqual({
      t: "denied",
      text: ADMIN_TEXT.banned,
    });
    alice.clear();
    await say(alice, "/unban Bob");
    expect(lines(alice)).toEqual(["Bob is no longer banned."]);
    again.clear();
    again.send({ t: "login", name: "Bob", password: "secret" });
    await again.waitFor(isSnapshot);
    again.close();
    await settle();
  });

  test("/BanIP refuses a login from that address; /unbanIP lets it in", async () => {
    alice.clear();
    await say(alice, "/IPlookup Mo");
    const ip = lines(alice)[1]?.replace("The IP is: ", "") ?? "";
    await say(alice, `/BanIP ${ip}`);
    expect(lines(alice)).toContain(`Banning ${ip}...`);
    const c = await connectBot(server.wsUrl);
    c.send({ t: "login", name: "Bob", password: "secret" });
    expect(await c.waitFor((m) => m.t === "denied")).toEqual({
      t: "denied",
      text: ADMIN_TEXT.ipBanned,
    });
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
