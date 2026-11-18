/**
 * Admin commands, the jail and staff chat.
 */
import { beforeEach, describe, expect, test } from "bun:test";

import {
  ADMIN_TEXT,
  banNotice,
  CHAT_COLOR,
  MODERATION_TEXT,
  type ServerMsg,
  TEXT,
} from "@secondstaronline/shared";

import { createGame, helpLines } from "../src/game.ts";
import { setRole } from "../src/persistence/accounts.ts";
import { recentAudit, recentCheats } from "../src/persistence/admin.ts";
import { type Db, openDatabase } from "../src/persistence/database.ts";
import { migrate } from "../src/persistence/migrations.ts";
import { loadSettingOverrides, saveSettingOverride } from "../src/persistence/settings.ts";
import type { AdminDeps, CharacterAccount } from "../src/systems/admin/commands.ts";
import { openEditor } from "../src/systems/admin/worldedit.ts";
import { type ChatDeps, handleChat } from "../src/systems/chat/chat.ts";
import type { Player, WorldMap } from "../src/systems/world/world.ts";
import { fakeModeration, testClock } from "./helpers/moderation.ts";
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
  const clock = testClock();
  const s = setup(maps, undefined, undefined, () => clock.ms);
  const byName = new Map(maps.map((m) => [m.name, m]));
  const imm = player("Imm", seed, 5, 5);
  imm.role = "immortal";
  const mod = player("Mod", seed, 6, 5);
  mod.role = "moderator";
  const bob = player("Bob", other, 3, 3);
  for (const p of [imm, mod, bob]) {
    s.join(p);
  }
  /** Characters that are not online: name -> role. */
  const offline = new Map<string, Player["role"]>();
  const kicks: { id: string; text: string }[] = [];
  const audits: string[] = [];
  const classes = new Map<string, number>();
  const roles = new Map<string, string>();
  // Test players' account and character ids are their names.
  const m = fakeModeration((id) => id);
  const accountOf = (p: Player): CharacterAccount => ({
    characterId: p.id,
    accountId: p.accountId,
    name: p.name,
    role: p.role,
    classCode: classes.get(p.id) ?? 1,
  });
  const admin: AdminDeps = {
    findCharacter: (name) => {
      const p = [...s.world.players.values()].find(
        (o) => o.name.toLowerCase() === name.toLowerCase(),
      );
      if (p) {
        return accountOf(p);
      }
      const off = [...offline.keys()].find((n) => n.toLowerCase() === name.toLowerCase());
      return off
        ? {
            characterId: off,
            accountId: off,
            name: off,
            role: offline.get(off) ?? "player",
            classCode: 1,
          }
        : null;
    },
    setRole: (id, role) => roles.set(id, role),
    moderation: m.store,
    now: clock.iso,
    durations: () => ({ banMinutes: 0, ipBanMinutes: 43_200, jailMinutes: 10 }),
    setClass: (id, code) => classes.set(id, code),
    cheatLines: () => ["Bob - at IP 9.9.9.9 - Attempted Admin Access"],
    audit: (e) => audits.push(`${e.command} ${e.target ?? ""}`.trim()),
    kick: (id, text) => kicks.push({ id, text }),
    saveAll: () => audits.push("saved"),
    reloadSettings: () => audits.push("reloaded"),
    loadMap: (n) => byName.get(n) ?? null,
    fallbackPoint: () => ({ map: "x1000y992", x: 6, y: 4 }),
    casino: { graceTicks: 600, addGoldOffline: () => {} },
  };
  const deps: ChatDeps = {
    maxChars: 200,
    broadcastCooldownFrames: 0,
    chatCooldownFrames: 0,
    helpLines,
    admin,
  };
  const say = (p: Player, line: string) => handleChat(s.world, p, line, deps);
  /** Runs whole seconds of ticks while the clock moves with them. */
  const runMinutes = (minutes: number) => {
    const out: Out = [];
    for (let i = 0; i < minutes * 60; i++) {
      clock.ms += 1000;
      out.push(...s.run(20));
    }
    return out;
  };
  return {
    ...s,
    seed,
    other,
    jail,
    imm,
    mod,
    bob,
    say,
    kicks,
    audits,
    classes,
    clock,
    offline,
    runMinutes,
    m,
    bans: m.bans,
    jails: m.jails,
    ipBans: m.ipBans,
  };
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

  test("a moderator may run the moderation commands, but not IP bans, /role or /setclass", () => {
    const { mod, say, bob, bans, ipBans, audits } = scene();
    expect(texts(say(mod, "/Location"), "Mod")).toEqual([
      "You are at map: x1000y992 at position: 6-5",
    ]);
    expect(texts(say(mod, "/IPlookup bob"), "Mod")).toEqual([
      "Looking up IP address for bob...",
      "The IP is: 127.0.0.1",
    ]);
    say(mod, "/warp Bob x1000y992 9 9");
    expect([bob.map.name, bob.x, bob.y]).toEqual(["x1000y992", 9, 9]);
    bob.char.wanted = true;
    expect(texts(say(mod, "/Pardon Bob"), "Mod")).toEqual(["Pardoning Bob..."]);
    expect(bob.char.wanted).toBe(false);
    // IP bans can lock out an immortal or the whole proxy, so they stay immortal-only.
    expect(say(mod, "/BanIP 2.3.4.5")).toEqual([]);
    expect(texts(say(mod, "/unbanip 1.2.3.4"), "Mod")).toEqual([]);
    expect(ipBans.size).toBe(0);
    expect(texts(say(mod, "/ban Bob"), "Mod")).toEqual([
      "*** banning Bob...",
      "Bob is banned permanently.",
    ]);
    expect(bans.get("Bob")?.actorId).toBe("Mod");
    expect(texts(say(mod, "/unban Bob"), "Mod")).toEqual(["Bob is no longer banned."]);
    expect(bans.has("Bob")).toBe(false);
    expect(texts(say(mod, "/CheatFile"), "Mod")[0]).toBe("* Cheater Log:");
    expect(texts(say(mod, "/Inventory"), "Mod")).toHaveLength(15);
    say(mod, "/save");
    say(mod, "/Refresh");
    expect(audits).toContain("saved");
    expect(audits).toContain("reloaded");
  });

  test("SSO: a moderator may not lift a ban an immortal made", () => {
    const { imm, mod, say, bans } = scene();
    say(imm, "/ban Bob");
    expect(bans.get("Bob")?.actorId).toBe("Imm");
    expect(texts(say(mod, "/unban Bob"), "Mod")).toEqual([
      MODERATION_TEXT.notYourBan("Bob", "Imm"),
    ]);
    expect(bans.get("Bob")?.actorId).toBe("Imm");
    // An immortal may still lift it.
    expect(texts(say(imm, "/unban Bob"), "Imm")).toEqual(["Bob is no longer banned."]);
    expect(bans.has("Bob")).toBe(false);
  });

  test("SSO's /role and /setclass are said as local chat by anyone but an immortal", () => {
    const { mod, say } = scene();
    expect(texts(say(mod, "/role Bob immortal"), "Mod")).toEqual(['Mod says "/role Bob immortal"']);
    expect(texts(say(mod, "/setclass Bob Ninja"), "Mod")).toEqual([
      'Mod says "/setclass Bob Ninja"',
    ]);
  });
});

describe("staff chat", () => {
  test("a player's - line gets an explicit denial and clears input (no restore)", () => {
    const { bob, say } = scene();
    expect(say(bob, "- smile")).toEqual([
      { to: "Bob", msg: { t: "chat", text: ADMIN_TEXT.staffChatDenied, color: CHAT_COLOR.normal } },
    ]);
  });

  test("both immortals and moderators post to staff in CHAT_COLOR.staff; players excluded", () => {
    const { imm, mod, say } = scene();
    const immOut = say(imm, "-  hello");
    const immLine = {
      t: "chat" as const,
      text: '<... Imm tells the staff "hello"',
      color: CHAT_COLOR.staff,
    };
    expect(immOut).toEqual([
      { to: "Imm", msg: immLine },
      { to: "Mod", msg: immLine },
    ]);

    const modOut = say(mod, "-copy that");
    const modLine = {
      t: "chat" as const,
      text: '<... Mod tells the staff "copy that"',
      color: CHAT_COLOR.staff,
    };
    expect(modOut).toEqual([
      { to: "Imm", msg: modLine },
      { to: "Mod", msg: modLine },
    ]);
    expect(texts(modOut, "Bob")).toEqual([]);
  });

  test("staff chat has no house sender restriction, no muffling, and no ignore filtering", () => {
    const { imm, mod, say } = scene();
    const house = testMap("x5H1y2");
    imm.map = house;
    imm.y = 8;
    mod.map = house;
    mod.y = 11;
    mod.ignore = ["imm"];
    const out = say(imm, "-hi");
    const expected = {
      t: "chat" as const,
      text: '<... Imm tells the staff "hi"',
      color: CHAT_COLOR.staff,
    };
    expect(out).toEqual([
      { to: "Imm", msg: expected },
      { to: "Mod", msg: expected },
    ]);
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

  test("bug fixed: /warp to a map that does not exist is refused and moves no one", () => {
    const { imm, bob, say } = scene();
    const before = [bob.map.name, bob.x, bob.y];
    expect(texts(say(imm, "/warp Bob x77y77 2 2"), "Imm")).toEqual([
      "*** Warping Bob...",
      ADMIN_TEXT.noMap("x77y77"),
    ]);
    expect([bob.map.name, bob.x, bob.y]).toEqual(before);
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
    openEditor(
      world,
      imm2,
      () => seed,
      { mx: 1000, my: 992 },
      {
        graceTicks: 600,
        addGoldOffline: () => {},
      },
    );
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

  test("divergence: the sentence is stored and ends at its time, then releases to the respawn point", () => {
    const { imm, bob, say, runMinutes, jails, seed } = scene();
    bob.char.respawn = { mapId: seed.id, x: 7, y: 7 };
    expect(texts(say(imm, "/jail bob 2m"), "Imm")).toEqual([
      "*** Jailing bob...",
      "Bob is jailed until 2026-11-17 09:02 UTC.",
    ]);
    expect([bob.map.name, bob.x, bob.y]).toEqual(["x0y0", 4, 4]);
    expect(jails.get("Bob")?.expiresAt).toBe("2026-11-17T09:02:00.000Z");
    runMinutes(1);
    expect(bob.map.name).toBe("x0y0");
    const out = runMinutes(1);
    expect([bob.map.name, bob.x, bob.y]).toEqual(["x1000y992", 7, 7]);
    expect(out.some((o) => o.to === "Bob" && o.msg.t === "snapshot")).toBe(true);
    expect(bob.jailUntil).toBeNull();
  });

  test("a /jail without a duration lasts the jailMinutes setting", () => {
    const { imm, say, jails } = scene();
    say(imm, "/jail Bob being rude");
    expect(jails.get("Bob")).toMatchObject({
      expiresAt: "2026-11-17T09:10:00.000Z",
      reason: "being rude",
      actorRank: "immortal",
    });
  });

  test("a prisoner dead when the sentence ends is still released", () => {
    const { imm, bob, say, runMinutes } = scene();
    say(imm, "/jail Bob 1m");
    bob.deadLock = 5000;
    runMinutes(1);
    expect(bob.map.name).toBe("x1000y992");
    expect(bob.jailUntil).toBeNull();
  });

  test("divergence: staff warps neither take a prisoner out nor put a player in; /unjail releases", () => {
    const { imm, mod, bob, say, jails } = scene();
    say(mod, "/jail Bob 1h");
    expect(texts(say(imm, "/warp Bob x1001y992 3 3"), "Imm")[1]).toBe(
      MODERATION_TEXT.prisoner("Bob"),
    );
    expect(texts(say(imm, "/warptome Bob"), "Imm")[1]).toBe(MODERATION_TEXT.prisoner("Bob"));
    expect(bob.map.name).toBe("x0y0");
    expect(texts(say(mod, "/unjail Bob"), "Mod")).toEqual([MODERATION_TEXT.unjailed("Bob")]);
    expect([bob.map.name, bob.x, bob.y, bob.jailUntil]).toEqual(["x1000y992", 6, 4, null]);
    expect(jails.has("Bob")).toBe(false);
    expect(texts(say(mod, "/unjail Bob"), "Mod")).toEqual([MODERATION_TEXT.notJailed("Bob")]);
    expect(texts(say(imm, "/warp Bob x0y0 4 4"), "Imm")[1]).toBe(MODERATION_TEXT.useJail);
    expect(bob.map.name).toBe("x1000y992");
  });

  test("a jailed moderator cannot /warpmeto out", () => {
    const { imm, mod, say } = scene();
    say(imm, "/jail Mod 1h");
    expect(texts(say(mod, "/warpmeto Imm"), "Mod")[1]).toBe(MODERATION_TEXT.prisoner("Mod"));
    expect(mod.map.name).toBe("x0y0");
  });

  test("an offline character can be jailed; the sentence waits for their login", () => {
    const { imm, say, jails, offline } = scene();
    offline.set("Zed", "player");
    expect(texts(say(imm, "/jail Zed 1d"), "Imm")).toEqual([
      "*** Jailing Zed...",
      "Zed is jailed until 2026-11-18 09:00 UTC.",
    ]);
    expect(jails.get("Zed")?.expiresAt).toBe("2026-11-18T09:00:00.000Z");
  });

  test("a permanent sentence never ends by itself", () => {
    const { imm, bob, say, runMinutes } = scene();
    say(imm, "/jail Bob perm");
    expect(bob.jailUntil).toBe(Number.POSITIVE_INFINITY);
    runMinutes(2);
    expect(bob.map.name).toBe("x0y0");
  });

  test("pardoning a prisoner clears the wanted flag and leaves them jailed", () => {
    const { imm, bob, say } = scene();
    say(imm, "/jail Bob 1h");
    bob.char.wanted = true;
    say(imm, "/pardon Bob");
    expect(bob.char.wanted).toBe(false);
    expect([bob.map.name, bob.jailUntil !== null]).toEqual(["x0y0", true]);
  });

  test("jail broadcasts still fail", () => {
    const { imm, bob, say } = scene();
    say(imm, "/jail Bob");
    expect(texts(say(bob, "'help"), "Bob")).toEqual(["You shout but no one can hear you!"]);
  });
});

describe("/warpscript", () => {
  test("a player gets an explicit denial and cleared input (no restore); moderators can set it", () => {
    const { bob, mod, say } = scene();
    expect(say(bob, "/warpscript help")).toEqual([
      {
        to: "Bob",
        msg: { t: "chat", text: ADMIN_TEXT.warpscriptDenied, color: CHAT_COLOR.normal },
      },
    ]);
    expect(texts(say(mod, "/warpscript help"), "Mod")).toEqual(["Warpscript set to: help"]);
  });

  test("a broadcast containing the whole keyword warps the speaker to the staff member", () => {
    const { imm, bob, say } = scene();
    expect(texts(say(imm, "/warpscript HELP"), "Imm")).toEqual(["Warpscript set to: HELP"]);
    const out = say(bob, "'please help me");
    expect(texts(out, "Imm")).toContain("*** Warping Bob...");
    expect([bob.map.name, bob.x, bob.y]).toEqual(["x1000y992", 5, 5]);
  });

  test("speaker name, protocol wrapper, and substrings do not trigger /warpscript", () => {
    const { imm, bob, say } = scene();
    say(imm, "/warpscript bob");
    say(bob, "'hi there");
    expect(bob.map.name).toBe("x1001y992");

    say(imm, "/warpscript broadcasts");
    say(bob, "'hi there");
    expect(bob.map.name).toBe("x1001y992");

    say(imm, "/warpscript help");
    say(bob, "'I am helpless");
    expect(bob.map.name).toBe("x1001y992");
  });

  test("multiple matching staff: deterministic single winner (first in login order)", () => {
    const { imm, mod, bob, say } = scene();
    say(imm, "/warpscript help");
    say(mod, "/warpscript help");
    const out = say(bob, "'help!");
    expect(texts(out, "Imm")).toContain("*** Warping Bob...");
    expect(texts(out, "Mod")).not.toContain("*** Warping Bob...");
    expect([bob.map.name, bob.x, bob.y]).toEqual(["x1000y992", 5, 5]);
  });

  test("a moderator's warp keyword moves players but cannot warp an immortal", () => {
    const { imm, mod, bob, say } = scene();
    say(mod, "/warpscript help");
    say(bob, "'help");
    expect([bob.map.name, bob.x, bob.y]).toEqual([mod.map.name, mod.x, mod.y]);
    const out = say(imm, "'help");
    expect([imm.x, imm.y]).toEqual([5, 5]);
    expect(texts(out, "Mod")).not.toContain("*** Warping Imm...");
  });

  test("OFF prints the word it stores and disables matching", () => {
    const { imm, bob, say } = scene();
    expect(texts(say(imm, "/warpscript off"), "Imm")).toEqual([
      "Warpscript set to: iasdfji23j4ihfih23io4haklsq",
    ]);
    say(bob, "'help");
    expect(bob.map.name).toBe("x1001y992");
  });
});

describe("ignore and /warpscript", () => {
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

  test("SSO: a moderator cannot kick or ban an immortal", () => {
    const { mod, say, kicks, bans } = scene();
    expect(texts(say(mod, "/kick Imm"), "Mod")).toEqual([
      "*** kicking Imm...",
      ADMIN_TEXT.kickImmortal,
    ]);
    expect(kicks).toEqual([]);
    expect(texts(say(mod, "/ban Imm"), "Mod")).toEqual([
      "*** banning Imm...",
      MODERATION_TEXT.staffTarget,
    ]);
    expect(bans.size).toBe(0);
  });

  test("SSO: a moderator cannot look up, jail or warp an immortal", () => {
    const { imm, mod, bob, say, audits } = scene();
    const lines = (typed: string) => texts(say(mod, typed), "Mod");
    expect(lines("/iplookup Imm")).toEqual([
      ADMIN_TEXT.lookingUpIp("Imm"),
      ADMIN_TEXT.immortalTarget,
    ]);
    expect(lines("/jail Imm")[1]).toBe(MODERATION_TEXT.staffTarget);
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
    expect(texts(say(imm, "/ban Bob"), "Imm")).toEqual([
      "*** banning Bob...",
      "Bob is banned permanently.",
    ]);
    expect(bans.get("Bob")?.actorId).toBe("Imm");
    expect(kicks).toEqual([{ id: "Bob", text: banNotice(ADMIN_TEXT.banned, null) }]);
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

  test("/BanIP and /unbanIP print 1.6's lines, then what they did", () => {
    const { imm, say, ipBans } = scene();
    expect(texts(say(imm, "/BanIP 1.2.3.4"), "Imm")).toEqual([
      "Banning 1.2.3.4...",
      "Banned 1.2.3.4 until 2026-12-17 09:00 UTC.",
    ]);
    expect(ipBans.has("1.2.3.4")).toBe(true);
    expect(texts(say(imm, "/unbanIP 1.2.3.4"), "Imm")).toEqual([
      "Unbanning 1.2.3.4...",
      "1.2.3.4 is no longer banned.",
    ]);
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

describe("moderation: who may change what, durations and reasons", () => {
  /** A second moderator, online. */
  const withMo2 = (sc: ReturnType<typeof scene>) => {
    const mo2 = player("Mo2", sc.seed, 7, 5);
    mo2.role = "moderator";
    sc.join(mo2);
    return mo2;
  };

  test("regression: a moderator's /ban cannot overwrite an immortal's ban to lift it", () => {
    const { imm, mod, say, bans } = scene();
    say(imm, "/ban Bob perm");
    expect(texts(say(mod, "/ban Bob 1h"), "Mod")).toEqual([
      "*** banning Bob...",
      MODERATION_TEXT.notYourBan("Bob", "Imm"),
    ]);
    expect(bans.get("Bob")).toMatchObject({
      actorId: "Imm",
      actorRank: "immortal",
      expiresAt: null,
    });
    expect(texts(say(mod, "/unban Bob"), "Mod")).toEqual([
      MODERATION_TEXT.notYourBan("Bob", "Imm"),
    ]);
    expect(bans.has("Bob")).toBe(true);
  });

  test("a moderator may not ban, jail or pardon another moderator", () => {
    const sc = scene();
    const mo2 = withMo2(sc);
    expect(texts(sc.say(sc.mod, "/ban Mo2"), "Mod")[1]).toBe(MODERATION_TEXT.staffTarget);
    expect(texts(sc.say(sc.mod, "/jail Mo2"), "Mod")[1]).toBe(MODERATION_TEXT.staffTarget);
    mo2.char.wanted = true;
    expect(texts(sc.say(sc.mod, "/pardon Mo2"), "Mod")[1]).toBe(MODERATION_TEXT.staffTarget);
    expect(mo2.char.wanted).toBe(true);
    expect(sc.bans.size + sc.jails.size).toBe(0);
    // An immortal may act on anyone but themselves.
    expect(texts(sc.say(sc.imm, "/ban Mo2 1d"), "Imm")[1]).toBe(
      "Mo2 is banned until 2026-11-18 09:00 UTC.",
    );
    expect(texts(sc.say(sc.imm, "/jail Imm"), "Imm")[1]).toBe(MODERATION_TEXT.jailSelf);
  });

  test("a moderator changes only their own ban; an immortal changes any", () => {
    const sc = scene();
    withMo2(sc);
    const { mod, imm, say, bans } = sc;
    say(mod, "/ban Bob 3d spam");
    expect(texts(say(mod, "/ban Bob 7d spam again"), "Mod")[1]).toBe(
      "Bob is now banned until 2026-11-24 09:00 UTC (was until 2026-11-20 09:00 UTC).",
    );
    const mo2 = [...sc.world.players.values()].find((o) => o.name === "Mo2") as Player;
    expect(texts(say(mo2, "/ban Bob 1h"), "Mo2")[1]).toBe(MODERATION_TEXT.notYourBan("Bob", "Mod"));
    expect(texts(say(mo2, "/unban Bob"), "Mo2")).toEqual([
      MODERATION_TEXT.notYourBan("Bob", "Mod"),
    ]);
    expect(bans.get("Bob")?.expiresAt).toBe("2026-11-24T09:00:00.000Z");
    expect(texts(say(imm, "/ban Bob 1h"), "Imm")[1]).toBe(
      "Bob is now banned until 2026-11-17 10:00 UTC (was until 2026-11-24 09:00 UTC).",
    );
    expect(bans.get("Bob")).toMatchObject({ actorId: "Imm", actorRank: "immortal" });
  });

  test("a lapsed ban stops nobody: another moderator may ban anew", () => {
    const sc = scene();
    const mo2 = withMo2(sc);
    sc.say(sc.mod, "/ban Bob 30m");
    sc.clock.advance(30);
    expect(texts(sc.say(mo2, "/ban Bob 1h"), "Mo2")[1]).toBe(
      "Bob is banned until 2026-11-17 10:30 UTC.",
    );
    expect(texts(sc.say(sc.mod, "/unban Bob"), "Mod")).toEqual([
      MODERATION_TEXT.notYourBan("Bob", "Mo2"),
    ]);
  });

  test("a jail follows the same rule: its maker or an immortal changes or ends it", () => {
    const sc = scene();
    const mo2 = withMo2(sc);
    sc.say(sc.mod, "/jail Bob 1h");
    expect(texts(sc.say(mo2, "/jail Bob 5m"), "Mo2")[1]).toBe(
      MODERATION_TEXT.notYourJail("Bob", "Mod"),
    );
    expect(texts(sc.say(mo2, "/unjail Bob"), "Mo2")).toEqual([
      MODERATION_TEXT.notYourJail("Bob", "Mod"),
    ]);
    expect(texts(sc.say(sc.mod, "/jail Bob 2h"), "Mod")[1]).toBe(
      "Bob is now jailed until 2026-11-17 11:00 UTC (was until 2026-11-17 10:00 UTC).",
    );
    expect(sc.bob.jailUntil).toBe(Date.parse("2026-11-17T11:00:00.000Z"));
    expect(texts(sc.say(sc.imm, "/unjail Bob appeal"), "Imm")).toEqual([
      MODERATION_TEXT.unjailed("Bob"),
    ]);
  });

  test("durations default from settings; a bad one refuses; the reason never reaches the player", () => {
    const { imm, say, bans, kicks, m } = scene();
    expect(texts(say(imm, "/ban Bob 0m"), "Imm")[1]).toBe(MODERATION_TEXT.badDuration);
    expect(bans.size).toBe(0);
    const out = say(imm, "/ban Bob being a rude person");
    expect(bans.get("Bob")).toMatchObject({ expiresAt: null, reason: "being a rude person" });
    expect(kicks).toEqual([{ id: "Bob", text: banNotice(ADMIN_TEXT.banned, null) }]);
    expect(JSON.stringify(out.filter((o) => o.to === "Bob"))).not.toContain("rude");
    expect(m.log.at(-1)).toMatchObject({ action: "ban", actorName: "Imm", actorRank: "immortal" });
  });

  test("usage lines for the moderation commands with no name", () => {
    const { imm, say } = scene();
    expect(texts(say(imm, "/ban"), "Imm")).toEqual([MODERATION_TEXT.banUsage]);
    expect(texts(say(imm, "/unban"), "Imm")).toEqual([MODERATION_TEXT.unbanUsage]);
    expect(texts(say(imm, "/unjail"), "Imm")).toEqual([MODERATION_TEXT.unjailUsage]);
    expect(texts(say(imm, "/banip"), "Imm")[1]).toBe(MODERATION_TEXT.banIpUsage);
  });

  test("a moderator may not pardon an immortal; pardons are logged", () => {
    const { imm, mod, bob, say, m } = scene();
    imm.char.wanted = true;
    expect(texts(say(mod, "/pardon Imm"), "Mod")[1]).toBe(MODERATION_TEXT.staffTarget);
    expect(imm.char.wanted).toBe(true);
    bob.char.wanted = true;
    say(mod, "/pardon Bob self-defence");
    expect(m.log.at(-1)).toMatchObject({ action: "pardon", reason: "self-defence" });
  });

  test("/unjail and /banlist are said as local chat by players", () => {
    const { bob, say } = scene();
    expect(texts(say(bob, "/unjail Bob"), "Bob")).toEqual(['Bob says "/unjail Bob"']);
    expect(texts(say(bob, "/banlist"), "Bob")).toEqual(['Bob says "/banlist"']);
  });
});

describe("IP bans", () => {
  const seen = (address: string, key: string, lastSeen: string) => ({ address, key, lastSeen });

  test("/banip takes a character name first, else a valid address", () => {
    const { imm, say, ipBans } = scene();
    expect(texts(say(imm, "/banip foo"), "Imm")[1]).toBe(MODERATION_TEXT.noSuchTarget("foo"));
    expect(texts(say(imm, "/banip 1.2.3.999"), "Imm")[1]).toBe(
      MODERATION_TEXT.noSuchTarget("1.2.3.999"),
    );
    expect(texts(say(imm, "/banip 1.2.3.4 all"), "Imm")[1]).toBe(MODERATION_TEXT.banIpUsage);
    expect(texts(say(imm, "/banip Bob"), "Imm")[1]).toBe(MODERATION_TEXT.noAddresses("Bob"));
    expect(texts(say(imm, "/banip Imm"), "Imm")[1]).toBe(ADMIN_TEXT.banSelf);
    expect(texts(say(imm, "/banip 2001:DB8::7 perm"), "Imm")[1]).toBe(
      "Banned 2001:db8::/64 permanently.",
    );
    expect([...ipBans.keys()]).toEqual(["2001:db8:0:0"]);
  });

  test("/banip <name> bans the latest address, or all of them; an immortal is never IP banned", () => {
    const { imm, say, ipBans, m, offline } = scene();
    m.addresses.set("Bob", [
      seen("10.0.0.2", "10.0.0.2", "2026-11-17T08:00:00.000Z"),
      seen("2001:db8:1:2::5", "2001:db8:1:2", "2026-11-10T08:00:00.000Z"),
      seen("2001:db8:1:2::6", "2001:db8:1:2", "2026-11-09T08:00:00.000Z"),
    ]);
    expect(texts(say(imm, "/banip Bob"), "Imm")[1]).toBe(
      "Banned 1 address used by Bob until 2026-12-17 09:00 UTC.",
    );
    expect([...ipBans.keys()]).toEqual(["10.0.0.2"]);
    expect(texts(say(imm, "/banip Bob all 1w alts"), "Imm")[1]).toBe(
      "Banned 2 addresses used by Bob until 2026-11-24 09:00 UTC.",
    );
    expect(ipBans.get("2001:db8:1:2")).toMatchObject({ sourceAccountId: "Bob", reason: "alts" });
    offline.set("Root", "immortal");
    expect(texts(say(imm, "/banip Root"), "Imm")[1]).toBe(MODERATION_TEXT.ipImmortal);
    expect(texts(say(imm, "/unbanip Bob"), "Imm")[1]).toBe(
      "Lifted 2 IP bans on addresses used by Bob.",
    );
    expect(ipBans.size).toBe(0);
    expect(texts(say(imm, "/unbanip Bob"), "Imm")[1]).toBe(MODERATION_TEXT.noIpBans("Bob"));
  });

  test("an IP ban disconnects every session from that address except an immortal's", () => {
    const { imm, mod, bob, say, kicks } = scene();
    for (const p of [imm, mod, bob]) {
      p.ip = "2001:db8:5:6::1";
    }
    say(imm, "/banip 2001:db8:5:6:ffff::9 2h");
    const notice = banNotice(ADMIN_TEXT.ipBanned, "2026-11-17T11:00:00.000Z");
    expect(kicks).toEqual([
      { id: "Mod", text: notice },
      { id: "Bob", text: notice },
    ]);
  });

  test("/unbanip of an address that is not banned says so", () => {
    const { imm, say } = scene();
    expect(texts(say(imm, "/unbanip 10.1.1.1"), "Imm")[1]).toBe(
      MODERATION_TEXT.ipNotBanned("10.1.1.1"),
    );
  });
});

describe("/banlist", () => {
  test("moderators see bans and jails; immortals also see IP bans", () => {
    const { imm, mod, say } = scene();
    say(mod, "/ban Bob 3d spam");
    say(imm, "/banip 10.9.9.9 perm proxy");
    expect(texts(say(mod, "/banlist"), "Mod")).toEqual([
      "* Bans (page 1 of 1):",
      "Bob - until 2026-11-20 09:00 UTC - Mod (moderator): spam",
      "* Jailed:",
      "(none)",
    ]);
    expect(texts(say(imm, "/banlist"), "Imm").slice(-2)).toEqual([
      "* IP bans:",
      "10.9.9.9 - permanent - Imm (immortal): proxy",
    ]);
    expect(texts(say(mod, "/banlist 10.9.9.9"), "Mod")).toEqual([
      MODERATION_TEXT.addressesImmortal,
    ]);
  });

  test("/banlist <name>: standing, history and (immortals) addresses", () => {
    const { imm, mod, say, clock, m } = scene();
    m.addresses.set("Bob", [
      { address: "10.0.0.2", key: "10.0.0.2", lastSeen: "2026-11-17T08:00:00.000Z" },
    ]);
    say(mod, "/ban Bob 3d spam");
    clock.advance(60);
    say(imm, "/unban Bob appeal accepted");
    say(imm, "/banip Bob 1d");
    say(mod, "/jail Bob 1h rude");
    expect(texts(say(mod, "/banlist bob"), "Mod")).toEqual([
      "* Bob: jailed - until 2026-11-17 11:00 UTC - Mod (moderator): rude",
      "2026-11-17 09:00 UTC ban 3d by Mod (moderator): spam",
      "2026-11-17 10:00 UTC unban by Imm (immortal): appeal accepted",
      "2026-11-17 10:00 UTC ipban 1d by Imm (immortal)",
      "2026-11-17 10:00 UTC jail 1h by Mod (moderator): rude",
    ]);
    expect(texts(say(imm, "/banlist bob"), "Imm").slice(3)).toEqual([
      "2026-11-17 10:00 UTC ipban 10.0.0.2 1d by Imm (immortal)",
      "2026-11-17 10:00 UTC jail 1h by Mod (moderator): rude",
      "* Addresses:",
      "10.0.0.2 (last 2026-11-17 08:00 UTC)",
    ]);
    expect(texts(say(imm, "/banlist 10.0.0.2"), "Imm")).toEqual([
      "* 10.0.0.2 - until 2026-11-18 10:00 UTC - Imm (immortal)",
      "* Seen with:",
      "Bob (last 2026-11-17 08:00 UTC)",
    ]);
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
    const make = async (name: string, role?: "moderator" | "immortal") => {
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
    const notice = banNotice(ADMIN_TEXT.banned, null);
    expect(await game.login("Bob", "pw")).toEqual({ ok: false, text: notice });
    expect(await game.login("Bob", "wrong")).toEqual({ ok: false, text: TEXT.badPassword });
    expect(game.refusal(bob.characterId, "10.0.0.2")).toBe(notice);
    game.intent(alice.characterId, { t: "chat", text: "/unban bob" });
    expect((await game.login("Bob", "pw")).ok).toBe(true);
    expect(recentAudit(db, 10).map((r) => `${r.actor} ${r.command} ${r.target}`)).toEqual([
      "Alice /ban Bob",
      "Alice /unban Bob",
    ]);
  });

  test("a moderator cannot lift a ban an immortal made", async () => {
    const { game, make } = await start();
    const alice = await make("Alice", "immortal");
    const mo = await make("Mo", "moderator");
    const bob = await make("Bob");
    game.intent(alice.characterId, { t: "chat", text: "/ban Bob" });
    expect(kicked).toEqual([bob.characterId]);
    game.leave(bob.characterId);
    sent.length = 0;
    game.intent(mo.characterId, { t: "chat", text: "/unban bob" });
    expect(texts(sent, mo.characterId)).toEqual([MODERATION_TEXT.notYourBan("Bob", "Alice")]);
    expect(await game.login("Bob", "pw", "10.0.0.2")).toEqual({
      ok: false,
      text: banNotice(ADMIN_TEXT.banned, null),
    });
    // The stored maker lets an immortal undo its own ban.
    game.intent(alice.characterId, { t: "chat", text: "/unban bob" });
    expect((await game.login("Bob", "pw", "10.0.0.2")).ok).toBe(true);
  });

  test("divergence: an IP ban refuses a login from that address after the password", async () => {
    const { game, make } = await start();
    const alice = await make("Alice", "immortal");
    await make("Bob");
    game.intent(alice.characterId, { t: "chat", text: "/BanIP 10.0.0.9" });
    expect(await game.login("Bob", "nope", "10.0.0.9")).toEqual({
      ok: false,
      text: TEXT.badPassword,
    });
    expect(await game.login("Bob", "pw", "10.0.0.9")).toEqual({
      ok: false,
      text: banNotice(ADMIN_TEXT.ipBanned, "2026-12-06T00:00:00.000Z"),
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
      values: { jailMinutes: 100, chatMaxChars: 150 },
    });
    expect(game.settings.jailMinutes).toBe(100);
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
    ).toEqual(["settings jailMinutes 10 100", "settings chatMaxChars 200 150"]);
  });

  test("Settings: a bad value refuses the whole save with its key and label", async () => {
    const { game, make } = await start();
    const alice = await make("Alice", "immortal");
    game.intent(alice.characterId, {
      t: "settingsSave",
      values: { jailMinutes: 5, chatMaxChars: 0 },
    });
    expect(sent.at(-1)?.msg).toMatchObject({
      t: "settingsResult",
      ok: false,
      key: "chatMaxChars",
      text: expect.stringMatching(/^Longest chat line/),
    });
    expect(game.settings.jailMinutes).toBe(10);
  });

  test("/Refresh reads the stored settings again", async () => {
    const { game, make } = await start();
    const alice = await make("Alice", "immortal");
    saveSettingOverride(db, "jailMinutes", 42, NOW);
    expect(game.settings.jailMinutes).toBe(10);
    game.intent(alice.characterId, { t: "chat", text: "/Refresh" });
    expect(game.settings.jailMinutes).toBe(42);
  });

  test("the cheat log: admin intents from anyone else are refused and written", async () => {
    const { game, make } = await start();
    const alice = await make("Alice", "immortal");
    const bob = await make("Bob");
    game.intent(bob.characterId, { t: "settingsSave", values: { jailMinutes: 1 } });
    game.intent(bob.characterId, { t: "npcSave", name: "Cril", text: "GLD|1" });
    // An immortal's editor SAVE from outside the editor is no honest client's either.
    game.intent(alice.characterId, { t: "editLoad", mx: 1, my: 1 });
    expect(game.settings.jailMinutes).toBe(10);
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
