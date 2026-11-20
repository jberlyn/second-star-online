/**
 * The chat log: every line a player writes to others is logged with where it went and what became
 * of it, refused or not, and staff read it back with /chatlog or admin:chatlog.
 */
import { beforeEach, describe, expect, test } from "bun:test";

import {
  CHATLOG_TEXT,
  type ChatLogRow,
  chatlogLine,
  parseChatlogArgs,
  type ServerMsg,
} from "@secondstaronline/shared";

import { chatlogReport, parseChatlogCli } from "../src/cli/admin-chatlog.ts";
import { createGame } from "../src/game.ts";
import { setRole } from "../src/persistence/accounts.ts";
import { insertAudit, recentAudit } from "../src/persistence/admin.ts";
import { chatLogLines, insertChatLog, pruneChatLog } from "../src/persistence/chatlog.ts";
import { type Db, openDatabase } from "../src/persistence/database.ts";
import { migrate } from "../src/persistence/migrations.ts";
import { saveSettingOverride } from "../src/persistence/settings.ts";
import { type ChatDeps, handleChat } from "../src/systems/chat/chat.ts";
import { imIntent, setAway } from "../src/systems/chat/im.ts";
import { enterRoom, roomSay } from "../src/systems/chat/rooms.ts";
import { profileSave } from "../src/systems/social/bios.ts";
import type { ChatLogEntry, Player } from "../src/systems/world/world.ts";
import { NEVER_PUSH, player, setup, testMap } from "./helpers/sim.ts";

const deps: ChatDeps = {
  maxChars: 200,
  broadcastCooldownFrames: 1000,
  chatCooldownFrames: 60,
  helpLines: () => null,
};

function scene() {
  const here = testMap("x1000y992");
  const house = testMap("H1x1000y992");
  const jail = testMap("x0y0");
  const s = setup([here, house, jail]);
  const alice = player("Alice", here, 5, 5);
  const bob = player("Bob", here, 8, 8);
  const carol = player("Carol", here, 6, 6);
  for (const p of [alice, bob, carol]) {
    s.join(p);
  }
  const say = (p: Player, line: string, cooled = true) => {
    if (cooled) {
      p.chatIn = 0;
      p.broadcastIn = 0;
    }
    return handleChat(s.world, p, line, deps);
  };
  /** The entries logged since the last call, without the ids. */
  const logged = (): Omit<ChatLogEntry, "accountId" | "characterId">[] =>
    s.world.chatLog.splice(0).map(({ accountId, characterId, ...e }) => {
      expect(characterId).toBe(e.sender);
      expect(accountId).toBe(e.sender);
      return e;
    });
  return { ...s, alice, bob, carol, here, house, jail, say, logged };
}

describe("local say and /me", () => {
  test("a delivered say: the words, the map and how many others heard it", () => {
    const { alice, say, logged } = scene();
    say(alice, "hello there");
    expect(logged()).toEqual([
      {
        channel: "say",
        sender: "Alice",
        target: "x1000y992",
        text: "hello there",
        outcome: "delivered",
        heard: 2,
        ignored: 0,
        muffled: 0,
      },
    ]);
  });

  test("the counts: a reader ignoring the speaker and one hearing it muffled", () => {
    const house = testMap("H1x1000y992");
    const s = setup([house]);
    const alice = player("Alice", house, 5, 5);
    const bob = player("Bob", house, 6, 5);
    // At the back of a house, a line with a quote mark is muffled.
    const carol = player("Carol", house, 6, 11);
    for (const p of [alice, bob, carol]) {
      s.join(p);
    }
    bob.ignore = ["Alice"];
    handleChat(s.world, alice, "psst", deps);
    expect(s.world.chatLog).toMatchObject([
      { channel: "say", target: house.name, heard: 0, ignored: 1, muffled: 1 },
    ]);
  });

  test("/me is logged as an emote", () => {
    const { alice, say, logged } = scene();
    say(alice, "/me waves");
    expect(logged()).toMatchObject([
      { channel: "emote", text: " waves", outcome: "delivered", heard: 2 },
    ]);
  });

  test("refused by the cooldown and by the house rule: still logged", () => {
    const { alice, house, say, logged } = scene();
    say(alice, "one");
    say(alice, "two", false);
    alice.map = house;
    alice.y = 11;
    say(alice, "three");
    expect(logged().map((e) => [e.text, e.outcome])).toEqual([
      ["one", "delivered"],
      ["two", "cooldown"],
      ["three", "house"],
    ]);
  });

  test("commands, a player shop line and Password= are not logged", () => {
    const { alice, say, logged } = scene();
    say(alice, "Password=secret");
    say(alice, "/ignorelist");
    say(alice, "who");
    say(alice, "/balance");
    expect(logged()).toEqual([]);
  });
});

describe("broadcasts", () => {
  test("delivered to everyone online, with the counts", () => {
    const { alice, carol, say, logged } = scene();
    carol.ignore = ["alice"];
    say(alice, "'hear ye");
    expect(logged()).toEqual([
      {
        channel: "broadcast",
        sender: "Alice",
        target: null,
        text: "hear ye",
        outcome: "delivered",
        heard: 1,
        ignored: 1,
        muffled: 0,
      },
    ]);
  });

  test("refused by the cooldown and in jail", () => {
    const { alice, jail, say, logged } = scene();
    say(alice, "'one");
    say(alice, "'two", false);
    alice.map = jail;
    say(alice, "'three");
    expect(logged().map((e) => [e.text, e.outcome])).toEqual([
      ["one", "delivered"],
      ["two", "cooldown"],
      ["three", "jail"],
    ]);
  });
});

describe("staff chat", () => {
  test("from staff, delivered; from a player, denied", () => {
    const { alice, bob, say, logged } = scene();
    alice.role = "moderator";
    say(alice, "-  heads up");
    say(bob, "-let me in");
    expect(logged().map((e) => [e.sender, e.channel, e.text, e.outcome])).toEqual([
      ["Alice", "staff", "heads up", "delivered"],
      ["Bob", "staff", "let me in", "denied"],
    ]);
  });
});

describe("instant messages", () => {
  test("/msg: delivered, ignored, not online and refused by the cooldown", () => {
    const { alice, bob, say, logged } = scene();
    say(alice, "/msg bob hi");
    bob.ignore = ["Alice"];
    say(alice, "/msg bob hi again");
    say(alice, "/msg nobody hello?");
    say(alice, "/msg bob too fast", false);
    expect(logged().map((e) => [e.channel, e.target, e.text, e.outcome])).toEqual([
      ["im", "Bob", "hi", "delivered"],
      ["im", "Bob", "hi again", "ignored"],
      ["im", "nobody", "hello?", "notOnline"],
      ["im", "bob", "too fast", "cooldown"],
    ]);
  });

  test("the IM windows log the same way", () => {
    const { alice, world, logged } = scene();
    imIntent(world, alice, "Bob", "from the window", "window", deps);
    imIntent(world, alice, "Bob", "too fast", "send", deps);
    alice.chatIn = 0;
    imIntent(world, alice, "Zed", "anyone?", "send", deps);
    expect(logged().map((e) => [e.target, e.text, e.outcome])).toEqual([
      ["Bob", "from the window", "delivered"],
      ["Bob", "too fast", "cooldown"],
      ["Zed", "anyone?", "notOnline"],
    ]);
  });

  test("an away text and the automatic away reply are logged", () => {
    const { alice, bob, world, say, logged } = scene();
    setAway(world, bob, "gone fishing", deps);
    say(alice, "/msg bob you there?");
    expect(logged().map((e) => [e.channel, e.sender, e.target, e.text, e.outcome])).toEqual([
      ["away", "Bob", null, "gone fishing", "delivered"],
      ["im", "Alice", "Bob", "you there?", "delivered"],
      ["awayReply", "Bob", "Alice", "gone fishing", "delivered"],
    ]);
    // Turning away off says nothing to anyone.
    setAway(world, bob, null, deps);
    expect(logged()).toEqual([]);
  });
});

describe("chat rooms", () => {
  test("delivered to the room, refused by the cooldown, and out of a room; an immortal skips the cooldown", () => {
    const { alice, bob, world, logged } = scene();
    alice.role = "immortal";
    enterRoom(world, alice, "admin");
    enterRoom(world, bob, "general");
    const who = () => [];
    // Carriage returns are removed, as from the line sent.
    roomSay(world, alice, "staff only\rhere", deps, who);
    roomSay(world, alice, "again", deps, who);
    roomSay(world, bob, "hi all", deps, who);
    roomSay(world, bob, "again", deps, who);
    bob.room = null;
    bob.chatIn = 0;
    roomSay(world, bob, "anyone?", deps, who);
    // `who` in a room is not a line.
    roomSay(world, bob, "who", deps, who);
    expect(logged().map((e) => [e.sender, e.target, e.text, e.outcome])).toEqual([
      ["Alice", "admin", "staff onlyhere", "delivered"],
      ["Alice", "admin", "again", "delivered"],
      ["Bob", "general", "hi all", "delivered"],
      ["Bob", "general", "again", "cooldown"],
      ["Bob", null, "anyone?", "noRoom"],
    ]);
  });
});

describe("bios", () => {
  test("a saved profile and a refused one are logged; an unchanged one is not", () => {
    const { alice, world, logged } = scene();
    profileSave(world, alice, "I like fishing", () => {});
    profileSave(world, alice, "I like fishing", () => {});
    profileSave(world, alice, "visit http://x", () => {});
    expect(logged().map((e) => [e.channel, e.text, e.outcome])).toEqual([
      ["bio", "I like fishing", "delivered"],
      ["bio", "visit http://x", "refused"],
    ]);
  });
});

describe("/chatlog's rules", () => {
  test("the name, then a count and a channel in either order", () => {
    expect(parseChatlogArgs("/chatlog Bob")).toEqual({ name: "Bob", limit: 20, channel: null });
    expect(parseChatlogArgs("/chatlog Bob IM 5")).toEqual({ name: "Bob", limit: 5, channel: "im" });
    expect(parseChatlogArgs("/chatlog Bob 999")?.limit).toBe(100);
    expect(parseChatlogArgs("/chatlog")).toBeNull();
    expect(parseChatlogArgs("/chatlog Bob shouting")).toBeNull();
  });

  test("a line shows the time to the second, the channel, the target and the outcome", () => {
    const row: ChatLogRow = {
      at: "2026-11-18T09:00:05.123Z",
      channel: "im",
      sender: "Alice",
      target: "Bob",
      text: "hi",
      outcome: "ignored",
      heard: null,
      ignored: null,
      muffled: null,
    };
    expect(chatlogLine(row)).toBe(
      "2026-11-18 09:00:05 UTC [im] Alice -> Bob: hi (ignored by recipient)",
    );
    expect(
      chatlogLine({
        ...row,
        channel: "say",
        target: "x1000y992",
        outcome: "delivered",
        heard: 3,
        ignored: 1,
        muffled: 2,
      }),
    ).toBe(
      "2026-11-18 09:00:05 UTC [say] Alice -> x1000y992: hi (heard by 3, 1 ignored, 2 muffled)",
    );
    expect(
      chatlogLine({ ...row, channel: "broadcast", target: null, outcome: "delivered", heard: 0 }),
    ).toBe("2026-11-18 09:00:05 UTC [broadcast] Alice: hi (heard by 0)");
  });
});

describe("the chat log in the database", () => {
  type Out = { to: string; msg: ServerMsg }[];
  const texts = (out: Out, id: string) =>
    out.flatMap((o) => (o.to === id && o.msg.t === "chat" ? [o.msg.text] : []));
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
        setRole(db, l.accountId, role, new Date(wall).toISOString());
      }
      game.enter(l.characterId, false, "10.0.0.1");
      return l;
    };
    const say = (id: string, text: string) => {
      sent.length = 0;
      game.intent(id, { t: "chat", text });
      return texts(sent, id);
    };
    return { game, make, say };
  }

  test("lines are written on the tick, stamped with the time they were sent", async () => {
    const { game, make, say } = await start();
    const alice = await make("Alice");
    say(alice.characterId, "first");
    wall += 5_000;
    expect(chatLogLines(db, { limit: 10 })).toEqual([]);
    game.tick();
    expect(chatLogLines(db, { limit: 10 })).toMatchObject([
      { at: "2026-11-18T09:00:00.000Z", sender: "Alice", text: "first", channel: "say" },
    ]);
  });

  test("/chatlog: an immortal reads a player's lines and the IMs sent to them; the lookup is audited", async () => {
    const { make, say } = await start();
    const mod = await make("God", "immortal");
    const alice = await make("Alice");
    const bob = await make("Bob");
    say(alice.characterId, "hello all");
    wall += 4_000;
    say(bob.characterId, "/msg alice go away");
    wall += 4_000;
    say(alice.characterId, "-staff?");
    wall += 4_000;
    // Lines from this intent are written before the lookup reads them.
    expect(say(mod.characterId, "/chatlog alice")).toEqual([
      CHATLOG_TEXT.header("Alice", 3),
      "2026-11-18 09:00:00 UTC [say] Alice -> x1000y992: hello all (heard by 2)",
      "2026-11-18 09:00:04 UTC [im] Bob -> Alice: go away",
      "2026-11-18 09:00:08 UTC [staff] Alice: staff? (refused: not staff)",
    ]);
    expect(say(mod.characterId, "/chatlog alice 1 say")).toEqual([
      CHATLOG_TEXT.header("Alice", 1),
      "2026-11-18 09:00:00 UTC [say] Alice -> x1000y992: hello all (heard by 2)",
    ]);
    expect(recentAudit(db, 5).filter((r) => r.command === "/chatlog")).toMatchObject([
      { actor: "God", target: "Alice", after: '{"limit":20,"channel":null}' },
      { actor: "God", target: "Alice", after: '{"limit":1,"channel":"say"}' },
    ]);
  });

  test("/chatlog: usage, an unknown name, a quiet one, another immortal's log", async () => {
    const { make, say } = await start();
    const god = await make("God", "immortal");
    const other = await make("Other", "immortal");
    await make("Alice");
    expect(say(god.characterId, "/chatlog")).toEqual([CHATLOG_TEXT.usage]);
    expect(say(god.characterId, "/chatlog Nobody")).toEqual([
      "There is no character called Nobody.",
    ]);
    expect(say(god.characterId, "/chatlog alice")).toEqual([CHATLOG_TEXT.none("Alice")]);
    // Commands, /chatlog included, are not chat.
    say(other.characterId, "-checking in");
    expect(say(god.characterId, "/chatlog other")).toEqual([
      CHATLOG_TEXT.header("Other", 1),
      "2026-11-18 09:00:00 UTC [staff] Other: checking in",
    ]);
  });

  test("/chatlog is an immortal's: a moderator or a player who types it is told it is unknown", async () => {
    const { game, make, say } = await start();
    const mod = await make("Mod", "moderator");
    const alice = await make("Alice");
    say(alice.characterId, "secret");
    expect(say(mod.characterId, "/chatlog alice")).toEqual(['Unknown command "/chatlog".']);
    say(alice.characterId, "/chatlog mod");
    game.tick();
    // Nothing was said, so only Alice's line is logged.
    expect(chatLogLines(db, { limit: 5 }).map((r) => [r.sender, r.text])).toEqual([
      ["Alice", "secret"],
    ]);
    expect(recentAudit(db, 5).filter((r) => r.command === "/chatlog")).toEqual([]);
  });

  test("lines older than the retention setting are pruned at start and hourly; 0 keeps them", async () => {
    const old = (at: string, text: string): ChatLogEntry => ({
      at,
      channel: "say",
      accountId: "a",
      characterId: "c",
      sender: "Alice",
      target: "x1000y992",
      text,
      outcome: "delivered",
    });
    insertChatLog(
      db,
      [old("2026-08-01T00:00:00.000Z", "ancient"), old("2026-08-20T09:30:00.000Z", "older")],
      "",
    );
    const { game } = await start();
    // 90 days before 2026-11-18 09:00 is 2026-08-20 09:00.
    expect(chatLogLines(db, { limit: 10 }).map((r) => r.text)).toEqual(["older"]);
    // Past its 90 days, but not yet an hour since the last prune.
    wall += 40 * 60_000;
    game.tick();
    expect(chatLogLines(db, { limit: 10 }).map((r) => r.text)).toEqual(["older"]);
    wall += 30 * 60_000;
    game.tick();
    expect(chatLogLines(db, { limit: 10 })).toEqual([]);

    insertChatLog(db, [old("2020-01-01T00:00:00.000Z", "kept")], "");
    saveSettingOverride(db, "chatLogRetention", 0, "");
    pruneChatLog(db, new Date(wall).toISOString(), 0);
    await start();
    expect(chatLogLines(db, { limit: 10 }).map((r) => r.text)).toEqual(["kept"]);
  });

  test("audit rows are kept forever by default; a retention setting prunes them at start and hourly", async () => {
    const audit = (at: string, target: string) =>
      insertAudit(db, { actor: "a", command: "/kick", target }, at);
    audit("2020-01-01T00:00:00.000Z", "Ancient");
    audit("2026-11-08T09:30:00.000Z", "Older");
    await start();
    const targets = () => recentAudit(db, 10).map((r) => r.target);
    expect(targets()).toEqual(["Ancient", "Older"]);

    saveSettingOverride(db, "auditLogRetention", 10 * 86_400, "");
    const second = (await start()).game;
    // 10 days before 2026-11-18 09:00 is 2026-11-08 09:00.
    expect(targets()).toEqual(["Older"]);
    wall += 40 * 60_000;
    second.tick();
    expect(targets()).toEqual(["Older"]);
    wall += 30 * 60_000;
    second.tick();
    expect(targets()).toEqual([]);
  });

  test("admin:chatlog filters by name, channel and time", async () => {
    const { make, say, game } = await start();
    const alice = await make("Alice");
    const bob = await make("Bob");
    say(alice.characterId, "morning");
    wall += 3_600_000;
    say(bob.characterId, "/msg alice afternoon");
    say(bob.characterId, "'to all");
    game.tick();
    const path = `${process.env.TMPDIR ?? "/tmp"}/sso-chatlog-${Bun.randomUUIDv7()}.sqlite`;
    db.run(`VACUUM INTO '${path}'`);
    const run = (...argv: string[]) => {
      const o = parseChatlogCli(argv);
      if (typeof o === "string") {
        throw new Error(o);
      }
      return chatlogReport(path, o).map((l) => l.slice(20));
    };
    expect(run("alice")).toEqual([
      "UTC [say] Alice -> x1000y992: morning (heard by 1)",
      "UTC [im] Bob -> Alice: afternoon",
    ]);
    expect(run("--channel", "broadcast")).toEqual(["UTC [broadcast] Bob: to all (heard by 1)"]);
    expect(run("--since", "2026-11-18T09:30Z", "-n", "1")).toEqual([
      "UTC [broadcast] Bob: to all (heard by 1)",
    ]);
    expect(run("--until", "2026-11-18T09:30Z")).toEqual([
      "UTC [say] Alice -> x1000y992: morning (heard by 1)",
    ]);
    expect(parseChatlogCli(["--channel", "shout"])).toContain("unknown channel");
    expect(parseChatlogCli(["--since", "soon"])).toContain("--since needs");
  });
});
