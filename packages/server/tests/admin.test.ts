/**
 * Admin commands, the jail and the admin channel.
 */
import { beforeEach, describe, expect, test } from "bun:test";

import { ADMIN_TEXT, type ServerMsg, TEXT } from "@secondstaronline/shared";

import { createGame, helpLines } from "../src/game.ts";
import { setRole } from "../src/persistence/accounts.ts";
import { recentAudit, recentCheats } from "../src/persistence/admin.ts";
import { type Db, openDatabase } from "../src/persistence/database.ts";
import { migrate } from "../src/persistence/migrations.ts";
import { loadSettingOverrides, saveSettingOverride } from "../src/persistence/settings.ts";
import type { AdminDeps, CharacterAccount } from "../src/systems/admin/commands.ts";
import { openEditor } from "../src/systems/admin/worldedit.ts";
import { type ChatDeps, handleChat } from "../src/systems/chat/chat.ts";
import {
  addPlayer,
  createWorld,
  LOGIN_JAIL_FRAMES,
  type Player,
  type WorldMap,
} from "../src/systems/world/world.ts";
import { NEVER_PUSH, player, setup, testMap } from "./helpers/sim.ts";

type Out = { to: string; msg: ServerMsg }[];
const texts = (out: Out, id: string) =>
  out.flatMap((o) => (o.to === id && o.msg.t === "chat" ? [o.msg.text] : []));

/** A world of three maps (the seed, a neighbour, the jail) and a fake database. */
function scene(withJail = true) {
  const seed = testMap("x1000y992");
  const other = testMap("x1001y992");
  const jail = testMap("x0y0");
  const maps: WorldMap[] = withJail ? [seed, other, jail] : [seed, other];
  const s = setup(maps);
  const byName = new Map(maps.map((m) => [m.name, m]));
  const imm = player("Imm", seed, 5, 5);
  imm.role = "immortal";
  const mod = player("Mod", seed, 6, 5);
  mod.role = "moderator";
  const bob = player("Bob", other, 3, 3);
  for (const p of [imm, mod, bob]) {
    s.join(p);
  }
  const kicks: { id: string; text: string }[] = [];
  const audits: string[] = [];
  const bans = new Map<string, string | null>();
  const classes = new Map<string, number>();
  const roles = new Map<string, string>();
  const ipBans = new Set<string>();
  const accountOf = (p: Player): CharacterAccount => ({
    characterId: p.id,
    accountId: p.accountId,
    name: p.name,
    role: p.role,
    classCode: classes.get(p.id) ?? 1,
    bannedAt: bans.get(p.accountId) ?? null,
  });
  const admin: AdminDeps = {
    findCharacter: (name) => {
      const p = [...s.world.players.values()].find(
        (o) => o.name.toLowerCase() === name.toLowerCase(),
      );
      return p ? accountOf(p) : null;
    },
    setRole: (id, role) => roles.set(id, role),
    setBan: (id, by) => bans.set(id, by),
    addIpBan: (ip) => ipBans.add(ip),
    removeIpBan: (ip) => ipBans.delete(ip),
    setClass: (id, code) => classes.set(id, code),
    cheatLines: () => ["Bob - at IP 9.9.9.9 - Attempted Admin Access"],
    audit: (e) => audits.push(`${e.command} ${e.target ?? ""}`.trim()),
    kick: (id, text) => kicks.push({ id, text }),
    saveAll: () => audits.push("saved"),
    reloadSettings: () => audits.push("reloaded"),
    loadMap: (n) => byName.get(n) ?? null,
    startPoint: () => ({ map: "x1000y992", x: 6, y: 4 }),
  };
  const deps: ChatDeps = {
    maxChars: 200,
    broadcastCooldownFrames: 0,
    chatCooldownFrames: 0,
    helpLines,
    admin,
  };
  const say = (p: Player, line: string) => handleChat(s.world, p, line, deps);
  return { ...s, seed, other, jail, imm, mod, bob, say, kicks, audits, bans, classes, ipBans };
}

describe("the role table (moderator command set)", () => {
  test("a player's denials say 1.6's lines; the silent ones say nothing", () => {
    const { bob, say } = scene();
    expect(texts(say(bob, "/warp Imm x1y1 2 2"), "Bob")).toEqual([ADMIN_TEXT.warpDenied]);
    expect(texts(say(bob, "/warpmeto Imm"), "Bob")).toEqual([ADMIN_TEXT.warpDenied]);
    expect(texts(say(bob, "/warptome Imm"), "Bob")).toEqual([ADMIN_TEXT.warpToMeDenied]);
    expect(texts(say(bob, "/kick Imm"), "Bob")).toEqual([ADMIN_TEXT.kickDenied]);
    expect(texts(say(bob, "/ban Imm"), "Bob")).toEqual([ADMIN_TEXT.banDenied]);
    for (const line of [
      "/save",
      "/Refresh",
      "/CheatFile",
      "/Inventory",
      "/BanIP 1.2.3.4",
      "/jail Imm",
      "/Location",
      "/IPlookup Imm",
    ]) {
      expect(say(bob, line)).toEqual([]);
    }
  });

  test("a moderator may warp, jail, kick, look up and locate, but not ban", () => {
    const { mod, say, bob } = scene();
    expect(texts(say(mod, "/Location"), "Mod")).toEqual([
      "You are at map: x1000y992 at position: 6-5",
    ]);
    expect(texts(say(mod, "/ban Bob"), "Mod")).toEqual([ADMIN_TEXT.banDenied]);
    expect(texts(say(mod, "/IPlookup bob"), "Mod")).toEqual([
      "Looking up IP address for bob...",
      "The IP is: 127.0.0.1",
    ]);
    say(mod, "/warp Bob x1000y992 9 9");
    expect([bob.map.name, bob.x, bob.y]).toEqual(["x1000y992", 9, 9]);
  });

  test("SSO's /role, /unban and /setclass are said as local chat by anyone but an immortal", () => {
    const { mod, say } = scene();
    expect(texts(say(mod, "/role Bob immortal"), "Mod")).toEqual(['Mod says "/role Bob immortal"']);
  });
});

describe("the admin channel", () => {
  test("kept bug: anyone else's - line sends nothing and stays typed", () => {
    const { mod, bob, say } = scene();
    expect(say(mod, "-hi")).toEqual([{ to: "Mod", msg: { t: "restore", text: "-hi" } }]);
    expect(say(bob, "- smile")).toEqual([{ to: "Bob", msg: { t: "restore", text: "- smile" } }]);
  });

  test("an immortal's line reaches immortals and moderators in white, the sender included", () => {
    const { imm, say } = scene();
    const out = say(imm, "-  hello");
    const line = { t: "chat" as const, text: '<... Imm tells the admins "hello"', color: 0 };
    expect(out).toEqual([
      { to: "Imm", msg: line },
      { to: "Mod", msg: line },
    ]);
  });

  test("kept bug: a reader in a house at y > 10 hears a muffled voice; the sender must be at y ≤ 7", () => {
    const { imm, mod, say } = scene();
    const house = testMap("x5H1y2");
    mod.map = house;
    mod.y = 11;
    expect(texts(say(imm, "-hi"), "Mod")).toEqual(["You hear a muffled voice."]);
    imm.map = house;
    imm.y = 8;
    expect(texts(say(imm, "-hi"), "Imm")).toEqual(["You need to enter this building to talk"]);
  });
});

describe("warps", () => {
  test("/warp echoes and moves the target to the map and tile", () => {
    const { imm, bob, say, audits } = scene();
    const out = say(imm, "/warp bob x1000y992 2 3");
    expect(texts(out, "Imm")).toEqual(["*** Warping bob..."]);
    expect([bob.map.name, bob.x, bob.y]).toEqual(["x1000y992", 2, 3]);
    expect(out.some((o) => o.to === "Bob" && o.msg.t === "snapshot")).toBe(true);
    expect(audits).toEqual(["/warp Bob"]);
  });

  test("SSO: an offline name and a bad line get a line after the echo", () => {
    const { imm, say } = scene();
    expect(texts(say(imm, "/warp Zed x1y1 2 2"), "Imm")).toEqual([
      "*** Warping Zed...",
      "Zed is not online.",
    ]);
    expect(texts(say(imm, "/warp Bob x1y1 two 2"), "Imm")).toEqual([
      "*** Warping Bob...",
      ADMIN_TEXT.warpUsage,
    ]);
    expect(say(imm, "/warp")).toEqual([]);
  });

  test("a map that does not exist takes the missing-map fallback to the start point", () => {
    const { imm, bob, say } = scene();
    say(imm, "/warp Bob x77y77 2 2");
    expect([bob.map.name, bob.x, bob.y]).toEqual(["x1000y992", 6, 4]);
  });

  test("a dead target is moved: the death does not stop /warp or /warpmeto", () => {
    const { imm, bob, say } = scene();
    bob.deadLock = 10;
    expect(texts(say(imm, "/warp Bob x1000y992 2 2"), "Imm")).toEqual(["*** Warping Bob..."]);
    expect([bob.map.name, bob.x, bob.y]).toEqual(["x1000y992", 2, 2]);
    bob.deadLock = 10;
    say(imm, "/warpmeto Bob");
    expect([imm.map.name, imm.x, imm.y]).toEqual(["x1000y992", 2, 2]);
  });

  test("a target in an editor is put back in the game first", () => {
    const { imm, world, say, seed } = scene();
    const imm2 = player("Ed", seed, 1, 1);
    imm2.role = "immortal";
    world.players.set(imm2.id, imm2);
    openEditor(world, imm2, () => seed, { mx: 1000, my: 992 });
    expect(imm2.editing).toBe("world");
    const out = say(imm, "/warp Ed x1001y992 4 4");
    expect(imm2.editing).toBeNull();
    expect(out).toContainEqual({ to: "Ed", msg: { t: "editor", editing: false } });
    expect(imm2.map.name).toBe("x1001y992");
  });

  test("/warptome brings the target onto the admin's tile; /warpmeto takes the admin to theirs", () => {
    const { imm, bob, say } = scene();
    say(imm, "/warptome Bob");
    expect([bob.map.name, bob.x, bob.y]).toEqual(["x1000y992", 5, 5]);
    bob.x = 9;
    expect(texts(say(imm, "/warpmeto bob"), "Imm")[0]).toBe("*** Warping you to bob...");
    expect([imm.map.name, imm.x, imm.y]).toEqual(["x1000y992", 9, 5]);
  });
});

describe("the jail", () => {
  test("SSO: with no map x0y0 the jail is refused", () => {
    const { imm, bob, say } = scene(false);
    expect(texts(say(imm, "/jail Bob"), "Imm")).toEqual(["*** Jailing Bob...", ADMIN_TEXT.noJail]);
    expect(bob.map.name).toBe("x1001y992");
  });

  test("kept bug: the sentence is jailFrames from every entry, counted anywhere, and releases only on x0y0 to the start point", () => {
    const { imm, bob, say, run, world } = scene();
    world.jailFrames = 30;
    say(imm, "/jail bob");
    expect([bob.map.name, bob.x, bob.y, bob.jailIn]).toEqual(["x0y0", 4, 4, 30]);
    run(29);
    expect(bob.map.name).toBe("x0y0");
    const out = run(1);
    expect([bob.map.name, bob.x, bob.y]).toEqual(["x1000y992", 6, 4]);
    expect(out.some((o) => o.to === "Bob" && o.msg.t === "snapshot")).toBe(true);
    expect(bob.jailIn).toBe(0);
  });

  test("a prisoner dead when the sentence ends is still released: the dead flag never stops the self-warp", () => {
    const { imm, bob, say, run, world } = scene();
    world.jailFrames = 10;
    say(imm, "/jail Bob");
    bob.deadLock = 50;
    run(10);
    expect(bob.map.name).toBe("x1000y992");
    expect(bob.jailIn).toBe(0);
  });

  test("kept bug: leaving the jail any other way ends it: the sentence runs out off x0y0 and releases nobody; going back in restarts it", () => {
    const { imm, bob, say, run, world } = scene();
    world.jailFrames = 30;
    say(imm, "/jail Bob");
    run(5);
    // An administrator can explicitly release a prisoner with a warp.
    say(imm, "/warp Bob x1001y992 3 3");
    expect([bob.map.name, bob.jailIn]).toEqual(["x1001y992", 25]);
    run(25);
    expect([bob.map.name, bob.x, bob.y, bob.jailIn]).toEqual(["x1001y992", 3, 3, 0]);
    say(imm, "/warp Bob x0y0 4 4");
    expect(bob.jailIn).toBe(30);
  });

  test("a login onto x0y0 starts the sentence at 10000 whatever jailFrames says; a resumed session keeps the entry rule", () => {
    const world = createWorld();
    world.jailFrames = 30;
    const jail = testMap("x0y0");
    const a = player("a", jail, 4, 4);
    addPlayer(world, a);
    expect(a.jailIn).toBe(LOGIN_JAIL_FRAMES);
    expect(LOGIN_JAIL_FRAMES).toBe(10000);
    const b = player("b", jail, 4, 4);
    addPlayer(world, b, false);
    expect(b.jailIn).toBe(30);
  });

  test("jail broadcasts still fail", () => {
    const { imm, bob, say } = scene();
    say(imm, "/jail Bob");
    expect(texts(say(bob, "'help"), "Bob")).toEqual(["You shout but no one can hear you!"]);
  });
});

describe("/warpscript", () => {
  test("kept bug: anyone else's line stays typed", () => {
    const { mod, say } = scene();
    expect(say(mod, "/warpscript help")).toEqual([
      { to: "Mod", msg: { t: "restore", text: "/warpscript help" } },
    ]);
  });

  test("a broadcast containing the keyword warps the speaker to the immortal", () => {
    const { imm, bob, say } = scene();
    expect(texts(say(imm, "/warpscript HELP"), "Imm")).toEqual(["Warpscript set to: HELP"]);
    const out = say(bob, "'please help me");
    expect(texts(out, "Imm")).toContain("*** Warping Bob...");
    expect([bob.map.name, bob.x, bob.y]).toEqual(["x1000y992", 5, 5]);
  });

  test("OFF prints the word it stores", () => {
    const { imm, bob, say } = scene();
    expect(texts(say(imm, "/warpscript off"), "Imm")).toEqual([
      "Warpscript set to: iasdfji23j4ihfih23io4haklsq",
    ]);
    say(bob, "'help");
    expect(bob.map.name).toBe("x1001y992");
  });
});

describe("ignore and the admin lines", () => {
  test("kept bug: admin chat is a sqa, so a reader ignoring the sender misses it", () => {
    const { imm, mod, say } = scene();
    mod.ignore = ["imm"];
    const out = say(imm, "-hello");
    expect(texts(out, "Imm")).toEqual(['<... Imm tells the admins "hello"']);
    expect(texts(out, "Mod")).toEqual([]);
  });

  test("an immortal ignoring the speaker never reads the broadcast, so never warps them", () => {
    const { imm, bob, say } = scene();
    say(imm, "/warpscript HELP");
    imm.ignore = ["Bob"];
    const out = say(bob, "'please help me");
    expect(texts(out, "Imm")).toEqual([]);
    expect(bob.map.name).toBe("x1001y992");
  });
});

describe("kicks, bans, roles and classes", () => {
  test("/kick echoes, then the target reads the kick line and is disconnected with 1.6's kick alert", () => {
    const { imm, say, kicks } = scene();
    const out = say(imm, "/kick bob");
    expect(texts(out, "Imm")).toEqual(["*** kicking bob..."]);
    expect(texts(out, "Bob")).toEqual(["*** You are being kicked."]);
    expect(kicks).toEqual([{ id: "Bob", text: TEXT.kicked }]);
  });

  test("SSO: a moderator cannot kick an immortal", () => {
    const { mod, say, kicks } = scene();
    expect(texts(say(mod, "/kick Imm"), "Mod")).toEqual([
      "*** kicking Imm...",
      ADMIN_TEXT.kickImmortal,
    ]);
    expect(kicks).toEqual([]);
  });

  test("SSO: a moderator cannot look up, jail or warp an immortal", () => {
    const { imm, mod, bob, say, audits } = scene();
    const lines = (typed: string) => texts(say(mod, typed), "Mod");
    expect(lines("/iplookup Imm")).toEqual([
      ADMIN_TEXT.lookingUpIp("Imm"),
      ADMIN_TEXT.immortalTarget,
    ]);
    expect(lines("/jail Imm")[1]).toBe(ADMIN_TEXT.immortalTarget);
    expect(lines("/warp Imm x1001y992 3 3")[1]).toBe(ADMIN_TEXT.immortalTarget);
    expect(lines("/warptome Imm")[1]).toBe(ADMIN_TEXT.immortalTarget);
    expect([imm.map.name, imm.x, imm.y]).toEqual(["x1000y992", 5, 5]);
    expect(audits).toEqual([]);
    // A player target still works for a moderator; an immortal may act on an immortal.
    expect(lines("/warptome Bob")).toEqual(["*** Warping Bob..."]);
    expect(bob.map.name).toBe("x1000y992");
    expect(texts(say(imm, "/iplookup imm"), "Imm")[1]).toMatch(/^The IP is: /);
  });

  test("/ban flags the account and disconnects with the login refusal's text", () => {
    const { imm, say, kicks, bans } = scene();
    expect(texts(say(imm, "/ban Bob"), "Imm")).toEqual(["*** banning Bob..."]);
    expect(bans.get("Bob")).toBe("Imm");
    expect(kicks).toEqual([{ id: "Bob", text: ADMIN_TEXT.banned }]);
    expect(texts(say(imm, "/ban imm"), "Imm")).toEqual(["*** banning imm...", ADMIN_TEXT.banSelf]);
    expect(texts(say(imm, "/ban Zed"), "Imm")[1]).toBe("There is no character called Zed.");
  });

  test("/role changes a role at once; your own is refused", () => {
    const { imm, bob, say } = scene();
    const out = say(imm, "/role bob moderator");
    expect(texts(out, "Imm")).toEqual(["Bob is now a moderator."]);
    expect(bob.role).toBe("moderator");
    expect(out).toContainEqual({ to: "Bob", msg: { t: "role", role: "moderator" } });
    expect(texts(say(imm, "/role imm player"), "Imm")).toEqual([ADMIN_TEXT.roleSelf]);
    expect(texts(say(imm, "/role bob king"), "Imm")).toEqual([ADMIN_TEXT.roleUsage]);
  });

  test("/setclass sets the class code by name or number", () => {
    const { imm, say, classes } = scene();
    expect(texts(say(imm, "/setclass bob death knight"), "Imm")).toEqual([
      "Bob is now a Death Knight.",
    ]);
    expect(classes.get("Bob")).toBe(17);
    expect(texts(say(imm, "/setclass bob Pirate"), "Imm")).toEqual([
      "There is no class called Pirate.",
    ]);
    expect(texts(say(imm, "/setclass bob"), "Imm")).toEqual([ADMIN_TEXT.setClassUsage]);
  });

  test("/BanIP and /unbanIP print 1.6's lines", () => {
    const { imm, say, ipBans } = scene();
    expect(texts(say(imm, "/BanIP 1.2.3.4"), "Imm")).toEqual(["Banning 1.2.3.4..."]);
    expect(ipBans.has("1.2.3.4")).toBe(true);
    expect(texts(say(imm, "/unbanIP 1.2.3.4"), "Imm")).toEqual(["Unbanning 1.2.3.4..."]);
    expect(ipBans.size).toBe(0);
  });

  test("/Inventory, /CheatFile, /save and /Refresh", () => {
    const { imm, say, audits } = scene();
    imm.char.bag[0] = { item: "Apple", qty: 2 };
    const inv = texts(say(imm, "/Inventory"), "Imm");
    expect(inv).toHaveLength(15);
    expect(inv[0]).toBe("Apple-2");
    expect(texts(say(imm, "/CheatFile"), "Imm")).toEqual([
      "* Cheater Log:",
      "Bob - at IP 9.9.9.9 - Attempted Admin Access",
    ]);
    expect(say(imm, "/save")).toEqual([]);
    expect(say(imm, "/Refresh")).toEqual([]);
    expect(audits).toEqual(["saved", "/save", "reloaded", "/refresh"]);
  });
});

// ---- the game, through the real database ---------------------------------------------------

describe("bans, settings and the logs in the game (real SQLite)", () => {
  let db: Db;
  const sent: Out = [];
  const kicked: string[] = [];
  const NOW = "2026-11-06T00:00:00.000Z";

  beforeEach(() => {
    db = openDatabase();
    migrate(db);
    sent.length = 0;
    kicked.length = 0;
  });

  async function start() {
    const game = createGame({
      db,
      send: (to, msg) => sent.push({ to, msg }),
      isoNow: () => NOW,
      rng: NEVER_PUSH,
      kick: (id) => kicked.push(id),
    });
    const make = async (name: string, role?: "immortal") => {
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
      const l = await game.login(name, "pw", "10.0.0.1");
      if (!l.ok) {
        throw new Error(l.text);
      }
      if (role) {
        setRole(db, l.accountId, role, NOW);
      }
      game.enter(l.characterId, false, "10.0.0.1");
      return l;
    };
    return { game, make };
  }

  test("a banned account's login is refused with 1.6's alert until /unban", async () => {
    const { game, make } = await start();
    const alice = await make("Alice", "immortal");
    const bob = await make("Bob");
    game.intent(alice.characterId, { t: "chat", text: "/ban Bob" });
    expect(kicked).toEqual([bob.characterId]);
    game.leave(bob.characterId);
    expect(await game.login("Bob", "pw")).toEqual({ ok: false, text: ADMIN_TEXT.banned });
    expect(await game.login("Bob", "wrong")).toEqual({ ok: false, text: TEXT.badPassword });
    expect(game.refusal(bob.characterId, "10.0.0.2")).toBe(ADMIN_TEXT.banned);
    game.intent(alice.characterId, { t: "chat", text: "/unban bob" });
    expect((await game.login("Bob", "pw")).ok).toBe(true);
    expect(recentAudit(db, 10).map((r) => `${r.actor} ${r.command} ${r.target}`)).toEqual([
      "Alice /ban Bob",
      "Alice /unban Bob",
    ]);
  });

  test("an IP ban refuses a login from that address before the password", async () => {
    const { game, make } = await start();
    const alice = await make("Alice", "immortal");
    await make("Bob");
    game.intent(alice.characterId, { t: "chat", text: "/BanIP 10.0.0.9" });
    expect(await game.login("Bob", "nope", "10.0.0.9")).toEqual({
      ok: false,
      text: ADMIN_TEXT.ipBanned,
    });
    expect((await game.login("Bob", "pw", "10.0.0.8")).ok).toBe(true);
  });

  test("Settings: an immortal's save is stored, audited and applied at once; rules go to everyone", async () => {
    const { game, make } = await start();
    const alice = await make("Alice", "immortal");
    const bob = await make("Bob");
    game.intent(alice.characterId, { t: "settingsOpen" });
    const rows = sent.find((o) => o.msg.t === "settings");
    expect(rows?.to).toBe(alice.characterId);
    sent.length = 0;
    game.intent(alice.characterId, {
      t: "settingsSave",
      values: { jailFrames: 100, chatMaxChars: 150 },
    });
    expect(game.settings.jailFrames).toBe(100);
    expect(game.world.jailFrames).toBe(100);
    expect(loadSettingOverrides(db).get("chatMaxChars")).toBe("150");
    expect(sent).toContainEqual({
      to: bob.characterId,
      msg: { t: "rules", rules: { chatMaxChars: 150 } },
    });
    expect(sent).toContainEqual({
      to: alice.characterId,
      msg: { t: "settingsResult", ok: true },
    });
    expect(
      recentAudit(db, 10).map((r) => `${r.command} ${r.target} ${r.before} ${r.after}`),
    ).toEqual(["settings jailFrames 8000 100", "settings chatMaxChars 200 150"]);
  });

  test("Settings: a bad value refuses the whole save with its key and label", async () => {
    const { game, make } = await start();
    const alice = await make("Alice", "immortal");
    game.intent(alice.characterId, {
      t: "settingsSave",
      values: { jailFrames: 5, chatMaxChars: 0 },
    });
    expect(sent.at(-1)?.msg).toMatchObject({
      t: "settingsResult",
      ok: false,
      key: "chatMaxChars",
      text: expect.stringMatching(/^Longest chat line/),
    });
    expect(game.settings.jailFrames).toBe(8000);
  });

  test("/Refresh reads the stored settings again", async () => {
    const { game, make } = await start();
    const alice = await make("Alice", "immortal");
    saveSettingOverride(db, "jailFrames", 42, NOW);
    expect(game.settings.jailFrames).toBe(8000);
    game.intent(alice.characterId, { t: "chat", text: "/Refresh" });
    expect(game.settings.jailFrames).toBe(42);
  });

  test("the cheat log: admin intents from anyone else are refused and written", async () => {
    const { game, make } = await start();
    const alice = await make("Alice", "immortal");
    const bob = await make("Bob");
    game.intent(bob.characterId, { t: "settingsSave", values: { jailFrames: 1 } });
    game.intent(bob.characterId, { t: "npcSave", name: "Cril", text: "GLD|1" });
    // An immortal's editor SAVE from outside the editor is no honest client's either.
    game.intent(alice.characterId, { t: "editLoad", mx: 1, my: 1 });
    expect(game.settings.jailFrames).toBe(8000);
    expect(recentCheats(db, 10)).toEqual([
      { name: "Bob", ip: "10.0.0.1", reason: "Attempted Admin Access" },
      { name: "Bob", ip: "10.0.0.1", reason: "Attempting to get Admin access" },
      { name: "Alice", ip: "10.0.0.1", reason: "Attempted Admin Access" },
    ]);
    sent.length = 0;
    game.intent(alice.characterId, { t: "chat", text: "/CheatFile" });
    expect(texts(sent, alice.characterId)).toEqual([
      "* Cheater Log:",
      "Bob - at IP 10.0.0.1 - Attempted Admin Access",
      "Bob - at IP 10.0.0.1 - Attempting to get Admin access",
      "Alice - at IP 10.0.0.1 - Attempted Admin Access",
    ]);
  });

  test("/setclass writes the class code, online or not", async () => {
    const { game, make } = await start();
    const alice = await make("Alice", "immortal");
    const bob = await make("Bob");
    game.leave(bob.characterId);
    game.intent(alice.characterId, { t: "chat", text: "/setclass Bob Ninja" });
    const row = db
      .query<{ class_code: number }, [string]>("SELECT class_code FROM characters WHERE id = ?")
      .get(bob.characterId);
    expect(row?.class_code).toBe(12);
  });
});
