/**
 * Bot script: three bots chat, broadcast, ask for help and the who list, push each other, and log
 * on and off, against a real server.
 *
 * A second map, x1001y992, is copied from the seed map so one bot can be out of earshot.
 * The RNG is controlled by the script: it rolls a push only when told to.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { ADMIN_TEXT, type CreateMsg, type ServerMsg } from "@secondstaronline/shared";

import { setRole } from "../src/persistence/accounts.ts";
import type { Db } from "../src/persistence/database.ts";
import { saveSettingOverride } from "../src/persistence/settings.ts";
import { type Bot, connectBot, settle, startTestServer, type TestServer } from "./harness.ts";

const NOW = "2026-11-05T00:00:00.000Z";
type Chat = Extract<ServerMsg, { t: "chat" }>;

const make = (name: string, str = 11): CreateMsg => ({
  t: "create",
  name,
  password: "secret",
  sex: 1,
  head: 1,
  classCode: 1,
  str,
  sta: 11,
  int: 11,
  wis: 11,
  dex: 11,
});

function addEastMap(db: Db) {
  db.run(
    `INSERT INTO maps (id, mx, my, title, layer1, layer2, layer3, layer4, created_at, updated_at)
     SELECT '01a1a613-69ff-72dc-8025-af4ca595e964', 1001, 992, title, layer1, layer2, layer3,
            layer4, created_at, updated_at FROM maps WHERE mx = 1000 AND my = 992`,
  );
}

/** Puts a character somewhere before it logs in. */
function place(db: Db, name: string, map: { mx: number; my: number }, x: number, y: number) {
  db.run(
    `UPDATE characters SET map_id = (SELECT id FROM maps WHERE mx = ? AND my = ?), x = ?, y = ?
     WHERE name = ?`,
    [map.mx, map.my, x, y, name],
  );
}

const chats = (bot: Bot): Chat[] => bot.inbox.filter((m): m is Chat => m.t === "chat");
const chatTexts = (bot: Bot) => chats(bot).map((m) => m.text);

async function createAll(server: TestServer, specs: CreateMsg[]) {
  const bot = await connectBot(server.wsUrl);
  for (const c of specs) {
    bot.send(c);
    await bot.waitFor((m) => m.t === "created");
    bot.clear();
  }
  bot.close();
}

async function login(server: TestServer, name: string): Promise<Bot> {
  const bot = await connectBot(server.wsUrl);
  bot.send({ t: "login", name, password: "secret" });
  await bot.waitFor((m) => m.t === "snapshot");
  bot.send({ t: "mapReady" });
  await settle();
  return bot;
}

describe("chat, help, who, pushing and presence", () => {
  let server: TestServer;
  let pushNext = false;
  const SEED = { mx: 1000, my: 992 };
  const EAST = { mx: 1001, my: 992 };
  let alice: Bot;
  let bob: Bot;
  let cara: Bot;

  const tick = async (n: number) => {
    await settle();
    server.tickNow(n);
    await settle();
  };
  const say = async (bot: Bot, text: string) => {
    bot.send({ t: "chat", text });
    await settle();
  };
  const clearAll = () => {
    for (const b of [alice, bob, cara]) {
      b.clear();
    }
  };

  beforeAll(async () => {
    server = startTestServer({
      prepare: addEastMap,
      rng: {
        random: (n: number) => {
          // Only the push roll (hunger rolls random(3) every tick).
          if (pushNext && n === 25) {
            pushNext = false;
            return 1;
          }
          return 2;
        },
      },
    });
    await createAll(server, [make("Alice"), make("Bob"), make("Cara")]);
    place(server.db, "Alice", SEED, 5, 5);
    place(server.db, "Bob", SEED, 6, 5);
    place(server.db, "Cara", EAST, 5, 5);
  });
  afterAll(async () => {
    await server.stop();
  });

  test("a real login gets the help greeting; others get a presence event and no chat line", async () => {
    alice = await login(server, "Alice");
    expect(chatTexts(alice)[0]).toMatch(/^Welcome to First Star Online!/);
    alice.clear();
    bob = await login(server, "Bob");
    cara = await login(server, "Cara");
    expect(alice.inbox.filter((m) => m.t === "presence")).toEqual([
      { t: "presence", on: true, name: "Bob" },
      { t: "presence", on: true, name: "Cara" },
    ]);
    expect(chatTexts(alice)).toEqual([]);
  });

  test("say reaches the speaker's map only; a second line inside 3 s is refused and handed back", async () => {
    clearAll();
    await say(alice, "hi there");
    expect(chats(alice)).toEqual([{ t: "chat", text: 'Alice says "hi there"', color: 0 }]);
    expect(chatTexts(bob)).toEqual(['Alice says "hi there"']);
    expect(chatTexts(cara)).toEqual([]);

    await say(alice, "again");
    expect(chats(alice).at(-1)).toEqual({
      t: "chat",
      text: "You cannot chat yet - 3 seconds remaining.",
      color: 0,
      restore: "again",
    });
    expect(chatTexts(bob)).toEqual(['Alice says "hi there"']);
    await tick(60);
    await say(alice, "again");
    expect(chatTexts(bob).at(-1)).toBe('Alice says "again"');
  });

  test("a broadcast reaches everyone in yellow; the next waits 1000 frames", async () => {
    clearAll();
    await say(bob, "'hello world");
    for (const b of [alice, bob, cara]) {
      expect(chats(b)).toEqual([{ t: "chat", text: 'Bob broadcasts "hello world"', color: 4 }]);
    }
    await say(bob, "'too soon");
    expect(chats(bob).at(-1)).toEqual({
      t: "chat",
      text: "You cannot broadcast yet - 50 seconds remaining.",
      color: 0,
      restore: "'too soon",
    });
    await tick(981);
    await say(bob, "'still too soon");
    expect(chats(bob).at(-1)).toEqual({
      t: "chat",
      text: "You cannot broadcast yet - 1 seconds remaining.",
      color: 0,
      restore: "'still too soon",
    });
    await tick(19);
    await say(bob, "'now");
    expect(chatTexts(cara).at(-1)).toBe('Bob broadcasts "now"');
  });

  test("/help topics, a missing topic, and a two-word topic", async () => {
    clearAll();
    await say(cara, "/help banking");
    expect(chatTexts(cara)[0]).toBe("BANKING");
    expect(chatTexts(cara)).toHaveLength(8);
    cara.clear();
    await say(cara, "/help basic commands");
    expect(chatTexts(cara)[0]).toBe("BASIC COMMANDS");
    expect(chatTexts(cara).length).toBeGreaterThan(1);
    cara.clear();
    await say(cara, "/help no such topic");
    expect(chatTexts(cara)).toEqual(["There is no help on that subject!"]);
    expect(chatTexts(alice)).toEqual([]);
  });

  test("who: the count line and the names in logon order", async () => {
    clearAll();
    await say(cara, "who");
    expect(chatTexts(cara)).toEqual(["There are 3 players logged on."]);
    expect(cara.inbox.find((m) => m.t === "who")).toEqual({
      t: "who",
      names: ["Alice", "Bob", "Cara"],
    });
  });

  test("unbuilt commands are dropped and unauthorized staff chat gives a private refusal", async () => {
    clearAll();
    await tick(60);
    await say(alice, "/rpg hi");
    expect(chatTexts(alice)).toEqual([]);
    await say(alice, "-admins only");
    expect(chatTexts(alice)).toEqual([ADMIN_TEXT.staffChatDenied]);
    expect(alice.inbox.some((m) => m.t === "restore")).toBe(false);
    expect(chatTexts(bob)).toEqual([]);
  });

  test("walking into a standing player can push them", async () => {
    clearAll();
    pushNext = true;
    alice.send({ t: "step", seq: 1, dir: "R", turn: false });
    await tick(1);
    expect(chatTexts(bob)).toEqual(["Alice shoves you out of the way."]);
    expect(chatTexts(alice)).toEqual([]);
    const you = bob.inbox.filter((m) => m.t === "you").at(-1);
    expect(you).toMatchObject({ self: { x: 7, y: 5, facing: "E" } });
    await tick(16);
  });

  test("logoff and logon reach the others as presence events; an administrator is never pushed", async () => {
    clearAll();
    bob.send({ t: "logout" });
    await bob.closed;
    await settle();
    expect(alice.inbox.filter((m) => m.t === "presence")).toEqual([
      { t: "presence", on: false, name: "Bob" },
    ]);
    const account = server.db
      .query<{ account_id: string }, [string]>("SELECT account_id FROM characters WHERE name = ?")
      .get("Bob");
    setRole(server.db, account?.account_id ?? "", "administrator", NOW);
    bob = await login(server, "Bob");
    expect(alice.inbox.filter((m) => m.t === "presence").at(-1)).toEqual({
      t: "presence",
      on: true,
      name: "Bob",
    });
    // Alice (5,5) steps next to Bob (7,5), then walks into him with the push rolled.
    alice.send({ t: "step", seq: 2, dir: "R", turn: false });
    await tick(16);
    bob.clear();
    pushNext = true;
    alice.send({ t: "step", seq: 3, dir: "R", turn: false });
    await tick(1);
    expect(chatTexts(bob)).toEqual([]);
    expect(bob.inbox.some((m) => m.t === "you" && m.self.x !== 7)).toBe(false);
  });
});

describe("presence settings", () => {
  test("presenceChatLines prints logon and logoff lines", async () => {
    const server = startTestServer({
      prepare: (db) => saveSettingOverride(db, "presenceChatLines", true, NOW),
    });
    try {
      await createAll(server, [make("Dana"), make("Eli")]);
      const dana = await login(server, "Dana");
      const eli = await login(server, "Eli");
      expect(chatTexts(dana)).toContain("Eli has logged on.");
      eli.send({ t: "logout" });
      await eli.closed;
      await settle();
      expect(chatTexts(dana)).toContain("Eli has logged off.");
    } finally {
      await server.stop();
    }
  });

  test("announcePresence off sends no presence events at all", async () => {
    const server = startTestServer({
      prepare: (db) => saveSettingOverride(db, "announcePresence", false, NOW),
    });
    try {
      await createAll(server, [make("Finn"), make("Gwen")]);
      const finn = await login(server, "Finn");
      await login(server, "Gwen");
      expect(finn.inbox.some((m) => m.t === "presence")).toBe(false);
    } finally {
      await server.stop();
    }
  });
});
