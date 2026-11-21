/**
 * Chat and presence on the server.
 */
import { beforeEach, describe, expect, test } from "bun:test";

import type { ServerMsg } from "@secondstaronline/shared";

import { createGame, helpLines } from "../src/game.ts";
import { setRole } from "../src/persistence/accounts.ts";
import { type Db, openDatabase } from "../src/persistence/database.ts";
import { migrate } from "../src/persistence/migrations.ts";
import { saveSettingOverride } from "../src/persistence/settings.ts";
import { type ChatDeps, handleChat } from "../src/systems/chat/chat.ts";
import { NEVER_PUSH, player, setup, testMap } from "./helpers/sim.ts";

type Out = { to: string; msg: ServerMsg }[];
const deps: ChatDeps = {
  maxChars: 200,
  broadcastCooldownFrames: 1000,
  chatCooldownFrames: 60,
  helpLines,
};
const chats = (out: Out, id: string) =>
  out.flatMap((o) => (o.to === id && o.msg.t === "chat" ? [o.msg] : []));
const texts = (out: Out, id: string) => chats(out, id).map((m) => m.text);

function twoMaps() {
  const here = testMap("x1000y992");
  const there = testMap("x1001y992");
  const s = setup([here, there]);
  const a = player("a", here, 5, 5);
  const b = player("b", here, 8, 8);
  const c = player("c", there, 5, 5);
  s.join(a);
  s.join(b);
  s.join(c);
  return { ...s, a, b, c, here, there };
}

describe("local say", () => {
  test("goes to everyone on the map, the speaker included, in white", () => {
    const { world, a } = twoMaps();
    const out = handleChat(world, a, "hello there", deps);
    expect(chats(out, "a")).toEqual([{ t: "chat", text: 'a says "hello there"', color: 0 }]);
    expect(texts(out, "b")).toEqual(['a says "hello there"']);
    expect(texts(out, "c")).toEqual([]);
  });

  test("lines are cut to chatMaxChars", () => {
    const { world, a } = twoMaps();
    const out = handleChat(world, a, "x".repeat(300), { ...deps, maxChars: 200 });
    expect(texts(out, "a")).toEqual([`a says "${"x".repeat(200)}"`]);
  });

  test("the chat cooldown refuses a second line inside 3 s and hands it back", () => {
    const { world, a, run } = twoMaps();
    handleChat(world, a, "one", deps);
    run(20);
    const out = handleChat(world, a, "two", deps);
    expect(chats(out, "a")).toEqual([
      { t: "chat", text: "You cannot chat yet - 2 seconds remaining.", color: 0, restore: "two" },
    ]);
    expect(texts(out, "b")).toEqual([]);
    run(40);
    expect(texts(handleChat(world, a, "two", deps), "b")).toEqual(['a says "two"']);
  });

  test("/me shares the chat cooldown", () => {
    const { world, a } = twoMaps();
    handleChat(world, a, "hi", deps);
    expect(texts(handleChat(world, a, "/me waves", deps), "a")[0]).toMatch(/cannot chat yet/);
  });

  test("in a house at y > 10 neither talk nor /me goes", () => {
    const house = testMap("x5H1y2");
    const s = setup([house]);
    const a = player("a", house, 5, 11);
    s.join(a);
    expect(texts(handleChat(s.world, a, "hi", deps), "a")).toEqual([
      "You need to enter this building to talk",
    ]);
    a.chatIn = 0;
    expect(texts(handleChat(s.world, a, "/me waves", deps), "a")).toEqual([
      "You need to enter this building to talk",
    ]);
  });

  test("SSO: a line the house rule refuses still starts the cooldown", () => {
    const house = testMap("x5H1y2");
    const s = setup([house]);
    const a = player("a", house, 5, 11);
    s.join(a);
    handleChat(s.world, a, "hi", deps);
    expect(a.chatIn).toBe(deps.chatCooldownFrames);
    expect(texts(handleChat(s.world, a, "quest", deps), "a")[0]).toMatch(/cannot chat yet/);
  });

  test("a line of only spaces sends nothing and starts no cooldown", () => {
    const { world, a } = twoMaps();
    expect(handleChat(world, a, "   ", deps)).toEqual([]);
    expect(a.chatIn).toBe(0);
  });

  test("a listener in a house at y > 10 hears a muffled voice", () => {
    const house = testMap("x5H1y2");
    const s = setup([house]);
    const a = player("a", house, 5, 5);
    const b = player("b", house, 5, 11);
    s.join(a);
    s.join(b);
    const out = handleChat(s.world, a, "secret", deps);
    expect(texts(out, "a")).toEqual(['a says "secret"']);
    expect(texts(out, "b")).toEqual(["You hear a muffled voice."]);
  });
});

describe(`broadcast`, () => {
  test("goes to every player in yellow (palette 4), built from the sender's name", () => {
    const { world, a } = twoMaps();
    const out = handleChat(world, a, "'  'hello all", deps);
    for (const id of ["a", "b", "c"]) {
      expect(chats(out, id)).toEqual([{ t: "chat", text: 'a broadcasts "hello all"', color: 4 }]);
    }
  });

  test("1000-frame cooldown; a refusal keeps the line typed", () => {
    const { world, a, run } = twoMaps();
    handleChat(world, a, "'one", deps);
    run(1);
    const out = handleChat(world, a, "'two", deps);
    expect(chats(out, "a")).toEqual([
      {
        t: "chat",
        text: "You cannot broadcast yet - 50 seconds remaining.",
        color: 0,
        restore: "'two",
      },
    ]);
    expect(texts(out, "b")).toEqual([]);
  });

  test("the full 1000-frame cooldown applies, including its last 19 frames", () => {
    const { world, a, run } = twoMaps();
    handleChat(world, a, "'one", deps);
    run(980);
    expect(a.broadcastIn).toBe(20);
    expect(texts(handleChat(world, a, "'early", deps), "a")[0]).toBe(
      "You cannot broadcast yet - 1 seconds remaining.",
    );
    run(19);
    expect(a.broadcastIn).toBe(1);
    expect(texts(handleChat(world, a, "'early", deps), "a")[0]).toBe(
      "You cannot broadcast yet - 1 seconds remaining.",
    );
    run(1);
    expect(texts(handleChat(world, a, "'now", deps), "b")).toEqual(['a broadcasts "now"']);
  });

  test("from jail no one hears, and the cooldown still starts", () => {
    const jail = testMap("x0y0");
    const s = setup([jail]);
    const a = player("a", jail, 4, 4);
    s.join(a);
    const out = handleChat(s.world, a, "'let me out", deps);
    expect(chats(out, "a")).toEqual([
      { t: "chat", text: "You shout but no one can hear you!", color: 0 },
    ]);
    expect(a.broadcastIn).toBe(1000);
  });
});

describe("/help", () => {
  test("/help alone sends Help.txt; /help <word> the file of that name, any case", () => {
    const { world, a } = twoMaps();
    expect(texts(handleChat(world, a, "/help", deps), "a")).toEqual([
      "Welcome to First Star Online! To get help, type /help followed by the topic you want help on. Type /help topics for a list of the help topics!",
    ]);
    const banking = texts(handleChat(world, a, "/HELP Banking", deps), "a");
    expect(banking[0]).toBe("BANKING");
    expect(banking[2]).toBe(""); // the blank line between paragraphs
    expect(banking).toHaveLength(8);
  });

  test("the whole topic is sent, so two-word topics have help", () => {
    const { world, a } = twoMaps();
    const basic = texts(handleChat(world, a, "/help basic commands", deps), "a");
    expect(basic[0]).toBe("BASIC COMMANDS");
    expect(basic).toHaveLength(helpLines("basic commands")?.length ?? 0);
    expect(texts(handleChat(world, a, "/help no such topic", deps), "a")).toEqual([
      "There is no help on that subject!",
    ]);
  });

  test("help is not chat: no cooldown, only the asker sees it", () => {
    const { world, a } = twoMaps();
    handleChat(world, a, "hi", deps);
    const out = handleChat(world, a, "/help menu", deps);
    expect(texts(out, "a").length).toBeGreaterThan(1);
    expect(texts(out, "b")).toEqual([]);
  });
});

describe("who", () => {
  test("the count line, then everyone's names in logon order", () => {
    const { world, a } = twoMaps();
    const out = handleChat(world, a, "WHO", deps);
    expect(texts(out, "a")).toEqual(["There are 3 players logged on."]);
    expect(out.find((o) => o.msg.t === "who")?.msg).toEqual({ t: "who", names: ["a", "b", "c"] });
  });

  test("one player reads 'There is 1 player logged on.'; 'who are you' is chat", () => {
    const here = testMap("x1000y992");
    const s = setup([here]);
    const a = player("a", here, 5, 5);
    s.join(a);
    expect(texts(handleChat(s.world, a, "who", deps), "a")).toEqual([
      "There is 1 player logged on.",
    ]);
    expect(texts(handleChat(s.world, a, "who are you", deps), "a")).toEqual([
      'a says "who are you"',
    ]);
  });
});

describe("SSO: unknown commands", () => {
  test("a typo is told to the typist alone, given back to fix, costs no cooldown and is not logged", () => {
    const { world, a } = twoMaps();
    expect(handleChat(world, a, " /dacne now", deps)).toEqual([
      {
        to: "a",
        msg: { t: "chat", text: 'Unknown command "/dacne".', color: 0, restore: " /dacne now" },
      },
    ]);
    expect(a.chatIn).toBe(0);
    expect(world.chatLog).toEqual([]);
  });

  test.each(["/drop 5 gold", "/spawn 1", "/roster", "/Pardon b", "/kick b"])(
    "a player's %s gets the same reply as a typo",
    (typed) => {
      const { world, a } = twoMaps();
      const w1 = typed.split(" ")[0];
      expect(texts(handleChat(world, a, typed, deps), "a")).toEqual([`Unknown command "${w1}".`]);
      expect(texts(handleChat(world, a, typed, deps), "b")).toEqual([]);
    },
  );

  test("a slash that is not a command word is still talk", () => {
    const { world, a } = twoMaps();
    expect(texts(handleChat(world, a, "/o\\ yay", deps), "b")).toEqual(['a says "/o\\ yay"']);
  });
});

describe("commands not built yet are dropped, never said", () => {
  test.each(["/logchat file", "/RPG hi", "quit", "Challenge"])("%s", (line) => {
    const { world, a } = twoMaps();
    expect(handleChat(world, a, line, deps)).toEqual([]);
    expect(a.chatIn).toBe(0);
  });
});

// ---- game: presence and the greeting, through the real database -----------------------------

describe("presence and the login greeting", () => {
  let db: Db;
  const sent: Out = [];
  const NOW = "2026-11-05T00:00:00.000Z";

  beforeEach(() => {
    db = openDatabase();
    migrate(db);
    sent.length = 0;
  });

  async function gameWith(overrides: Record<string, unknown> = {}, minute?: () => number) {
    for (const [k, v] of Object.entries(overrides)) {
      saveSettingOverride(db, k, v, NOW);
    }
    const game = createGame({
      db,
      send: (to, msg) => sent.push({ to, msg }),
      isoNow: () => NOW,
      rng: NEVER_PUSH,
      ...(minute ? { minute } : {}),
    });
    const make = async (name: string) => {
      const r = await game.create({
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
      expect(r).toEqual({ ok: true });
      const l = await game.login(name, "pw");
      if (!l.ok) {
        throw new Error(l.text);
      }
      return l;
    };
    return { game, make };
  }

  test("logon and logoff go to everyone else and print nothing by default", async () => {
    const { game, make } = await gameWith();
    const a = await make("Alice");
    const b = await make("Bob");
    game.enter(a.characterId, false);
    sent.length = 0;
    game.enter(b.characterId, false);
    expect(sent.filter((o) => o.to === a.characterId).map((o) => o.msg)).toEqual([
      { t: "delta", events: [expect.objectContaining({ e: "enter" })] },
      { t: "presence", on: true, name: "Bob" },
    ]);
    sent.length = 0;
    game.leave(b.characterId);
    expect(sent.filter((o) => o.msg.t === "presence" || o.msg.t === "chat")).toEqual([
      { to: a.characterId, msg: { t: "presence", on: false, name: "Bob" } },
    ]);
  });

  test("per-player presenceChatLines prints '<name> has logged on/off.' for everyone or friends only", async () => {
    const { game, make } = await gameWith();
    const a = await make("Alice");
    const b = await make("Bob");
    const c = await make("Carol");
    game.enter(a.characterId, false);
    game.intent(a.characterId, { t: "prefsSave", prefs: { presenceChatLines: "everyone" } });
    game.enter(b.characterId, false);
    game.leave(b.characterId);
    expect(texts(sent, a.characterId)).toContain("Bob has logged on.");
    expect(texts(sent, a.characterId)).toContain("Bob has logged off.");

    sent.length = 0;
    game.intent(a.characterId, { t: "prefsSave", prefs: { presenceChatLines: "friends" } });
    game.intent(a.characterId, { t: "chat", text: "/friends add Carol" });
    sent.length = 0;
    game.enter(b.characterId, false);
    game.enter(c.characterId, false);
    expect(texts(sent, a.characterId)).not.toContain("Bob has logged on.");
    expect(texts(sent, a.characterId)).toContain("Carol has logged on.");
  });

  test("a real login gets the Help.txt greeting; a resumed session does not", async () => {
    const { game, make } = await gameWith();
    const a = await make("Alice");
    game.enter(a.characterId, false);
    expect(texts(sent, a.characterId)[0]).toMatch(/^Welcome to First Star Online!/);
    game.leave(a.characterId);
    sent.length = 0;
    game.enter(a.characterId, true);
    expect(texts(sent, a.characterId)).toEqual([]);
  });

  test("a real login gets the operator's News after the greeting; none when empty or resumed", async () => {
    const news = () => sent.filter((s) => s.msg.t === "news").map((s) => s.msg);
    const { game, make } = await gameWith();
    const a = await make("Alice");
    game.enter(a.characterId, false);
    expect(news()).toEqual([{ t: "news", text: "Welcome to First Star Online!" }]);
    const order = sent.filter((s) => s.to === a.characterId).map((s) => s.msg.t);
    expect(order.indexOf("news")).toBeGreaterThan(order.indexOf("chat"));
    game.leave(a.characterId);
    sent.length = 0;
    game.enter(a.characterId, true);
    expect(news()).toEqual([]);
    const quiet = await gameWith({ news: "" });
    const b = await make("Bob");
    sent.length = 0;
    quiet.game.enter(b.characterId, false);
    expect(news()).toEqual([]);
  });

  test("entering the game sends the server minute, and each new minute goes to everyone", async () => {
    let now = 7;
    const { game, make } = await gameWith({}, () => now);
    const a = await make("Alice");
    game.enter(a.characterId, false);
    expect(sent.filter((s) => s.msg.t === "minute").map((s) => s.msg)).toEqual([
      { t: "minute", minute: 7 },
    ]);
    sent.length = 0;
    game.tick();
    expect(sent.filter((s) => s.msg.t === "minute")).toEqual([]);
    now = 8;
    game.tick();
    expect(sent.filter((s) => s.msg.t === "minute")).toEqual([
      { to: a.characterId, msg: { t: "minute", minute: 8 } },
    ]);
  });

  test("an administrator account is loaded with its role (push immunity)", async () => {
    const { game, make } = await gameWith();
    const a = await make("Alice");
    setRole(db, a.accountId, "administrator", NOW);
    game.enter(a.characterId, false);
    expect(game.world.players.get(a.characterId)?.role?.id).toBe("administrator");
    expect(game.world.players.get(a.characterId)?.char.stats.str).toBe(10);
  });
});
