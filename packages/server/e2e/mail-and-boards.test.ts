/**
 * Bot script: mail and message boards.
 *
 * Part 1: King, an immortal, drops a `Universal Mail` and `Message Boards`; a hall's `The Knights's
 * Board` is stood on the map as a built hall would place it (it is not a `/drop` item). Alice, out
 * of place, hears the position line; in front she opens her box (the keys lock) and sends to
 * "Bob,Nobody": Bob, online, hears "*** You have new mail from Alice", opens the box, reads it and
 * replies; Alice's open list reloads with Bob's reply and she deletes it. Alice posts on Town
 * Square (the window closes, nothing printed) and Bob, opening it, sees "From: Alice". Carol, with
 * no guild, is refused the Knights' board from row 8 and reads and posts on it from row 7, without
 * the keys locking.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import type { CreateMsg, ServerMsg } from "@secondstaronline/shared";

import { setRole } from "../src/persistence/accounts.ts";
import type { Db } from "../src/persistence/database.ts";
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

const rng: Rng = { random: (n) => (n >= 1 ? n : 0) };

const idOf = (db: Db, name: string) =>
  (db.query("SELECT id FROM characters WHERE name = ?").get(name) as { id: string }).id;
function place(db: Db, name: string, x: number, y: number) {
  db.run("UPDATE characters SET x = ?, y = ? WHERE name = ?", [x, y, name]);
}
const lines = (bot: Bot) => bot.inbox.flatMap((m) => (m.t === "chat" ? [m.text] : []));
const msgsOf = <T extends ServerMsg["t"]>(bot: Bot, t: T) =>
  bot.inbox.filter((m): m is Extract<ServerMsg, { t: T }> => m.t === t);

describe("mail and boards", () => {
  let server: TestServer;
  let alice: Bot;
  let bob: Bot;
  let carol: Bot;
  let king: Bot;
  let seq = 0;

  const tick = async (n: number) => {
    await settle();
    server.clock.advance(Math.ceil(n * 50));
    server.tickNow(n);
    await settle();
  };
  const login = async (name: string): Promise<Bot> => {
    const bot = await connectBot(server.wsUrl);
    bot.send({ t: "login", name, password: "secret" });
    await bot.waitFor((m: ServerMsg) => m.t === "snapshot");
    bot.send({ t: "mapReady" });
    await settle();
    return bot;
  };
  const step = async (bot: Bot, dir: "U" | "D" | "L" | "R") => {
    bot.send({ t: "step", seq: ++seq, dir, turn: false });
    bot.send({ t: "move", seq: ++seq, held: null, turn: false });
    await tick(20);
    bot.send({ t: "mapReady" });
    await tick(1);
  };
  const turn = async (bot: Bot, dir: "U" | "D" | "L" | "R") => {
    bot.send({ t: "step", seq: ++seq, dir, turn: true });
    bot.send({ t: "move", seq: ++seq, held: null, turn: false });
    await tick(2);
  };
  const say = async (bot: Bot, text: string) => {
    bot.send({ t: "chat", text });
    await settle();
  };
  const who = (name: string) => {
    const p = [...server.game.world.players.values()].find((x) => x.name === name);
    if (!p) {
      throw new Error(`${name} is not in`);
    }
    return p;
  };
  const groundOf = (name: string, item: string) =>
    who(name).map.ground.find((g) => g.item === item)?.id ?? "";
  const click = async (bot: Bot, name: string, item: string) => {
    bot.clear();
    bot.send({ t: "pickup", id: groundOf(name, item) });
    await settle();
  };

  beforeAll(async () => {
    server = startTestServer({ rng });
    const bot = await connectBot(server.wsUrl);
    for (const name of ["Alice", "Bob", "Carol", "King"]) {
      bot.send(make(name));
      await bot.waitFor((m) => m.t === "created");
      bot.clear();
    }
    bot.close();
    const db = server.db;
    place(db, "Alice", 12, 9);
    place(db, "Bob", 11, 7);
    place(db, "Carol", 4, 8);
    place(db, "King", 12, 6);
    const acc = db
      .query<{ account_id: string }, [string]>("SELECT account_id FROM characters WHERE id = ?")
      .get(idOf(db, "King"));
    setRole(db, acc?.account_id ?? "", "immortal", "2026-11-07T00:00:00.000Z");
    alice = await login("Alice");
    bob = await login("Bob");
    carol = await login("Carol");
    king = await login("King");
  });

  afterAll(() => {
    for (const b of [alice, bob, carol, king]) {
      b?.close();
    }
    server?.stop();
  });

  test("King drops a Universal Mail and Message Boards; the Knights' board stands above him", async () => {
    await turn(king, "D");
    await say(king, "/drop Universal Mail"); // (12, 7)
    await turn(king, "R");
    await say(king, "/drop Message Boards"); // (13, 6)
    // A hall's board is placed by its house map, not droppable
    // (`/drop` takes catalogue fixtures): stand one on the map as the hall would.
    who("King").map.ground.push({
      id: crypto.randomUUID(),
      item: "The Knights's Board",
      x: 12,
      y: 5,
      kind: "admin",
      expiresAt: null,
    });
    expect(groundOf("Alice", "Universal Mail")).not.toBe("");
    expect(groundOf("Alice", "Message Boards")).not.toBe("");
    expect(groundOf("Alice", "The Knights's Board")).not.toBe("");
  });

  test("Alice, two tiles away, hears the position line; in front she opens her box and the keys lock", async () => {
    await click(alice, "Alice", "Universal Mail");
    expect(lines(alice)).toEqual([
      "You see the mailbox, but you must be standing in front of it to check it.",
    ]);
    expect(who("Alice").keyLock).toBe(false);
    await tick(45); // the click's 40-frame pause
    await step(alice, "U"); // (12, 8), facing the box at (12, 7)
    await click(alice, "Alice", "Universal Mail");
    expect(lines(alice)).toEqual(["You check your mail..."]);
    expect(msgsOf(alice, "mail")).toEqual([{ t: "mail", messages: [], lock: true }]);
    expect(who("Alice").keyLock).toBe(true);
  });

  test("Alice sends to Bob and a name nobody has: Bob hears the notice, mailSent comes back", async () => {
    alice.clear();
    bob.clear();
    alice.send({ t: "mailSend", to: "Bob,Nobody", subject: "Hello", body: "Hi Bob" });
    await settle();
    expect(msgsOf(alice, "mailSent")).toEqual([{ t: "mailSent" }]);
    expect(lines(bob)).toEqual(["*** You have new mail from Alice"]);
    expect(msgsOf(bob, "mail")).toEqual([]);
    expect(who("Alice").keyLock).toBe(false);
  });

  test("Bob opens his box, reads the mail and replies; Alice's open list reloads", async () => {
    await turn(bob, "R"); // facing the box at (12, 7)
    await click(bob, "Bob", "Universal Mail");
    expect(lines(bob)).toEqual(["You check your mail..."]);
    const list = msgsOf(bob, "mail")[0];
    expect(list?.messages.map((m) => [m.from, m.subject, m.body])).toEqual([
      ["Alice", "Hello", "Hi Bob"],
    ]);
    bob.send({ t: "mailUi", act: "reply" });
    alice.clear();
    bob.send({ t: "mailSend", to: "Alice", subject: "Re: Hello", body: "Hi back" });
    await settle();
    expect(lines(alice)).toEqual(["*** You have new mail from Bob"]);
    const reload = msgsOf(alice, "mail");
    expect(reload).toHaveLength(1);
    expect(reload[0]?.lock).toBe(false);
    expect(reload[0]?.messages.map((m) => [m.from, m.subject])).toEqual([["Bob", "Re: Hello"]]);
  });

  test("Alice deletes it: the row is gone", async () => {
    const id = msgsOf(alice, "mail")[0]?.messages[0]?.id ?? 0;
    alice.send({ t: "mailDelete", id });
    await settle();
    const n = (
      server.db
        .query("SELECT COUNT(*) AS n FROM mail WHERE owner_id = ?")
        .get(idOf(server.db, "Alice")) as { n: number }
    ).n;
    expect(n).toBe(0);
    alice.send({ t: "mailUi", act: "close" });
    bob.send({ t: "mailUi", act: "close" });
    await settle();
    expect(who("Alice").keyLock).toBe(false);
    expect(who("Bob").mailList).toBe(false);
  });

  test("Alice posts on Town Square from anywhere; the window closes and prints nothing", async () => {
    await tick(100); // the chat wait and the click's pause
    await click(alice, "Alice", "Message Boards");
    expect(lines(alice)).toEqual(["You view the message board"]);
    expect(msgsOf(alice, "board")[0]?.board).toEqual({
      topic: "Town Square",
      text: "",
      lock: true,
    });
    expect(who("Alice").keyLock).toBe(true);
    alice.clear();
    alice.send({ t: "boardPost", text: "Hello town" });
    await settle();
    expect(msgsOf(alice, "board")).toEqual([{ t: "board", board: null }]);
    expect(lines(alice)).toEqual([]);
    expect(who("Alice").keyLock).toBe(false);
  });

  test("Bob opens Town Square and sees From: Alice", async () => {
    await tick(45);
    await click(bob, "Bob", "Message Boards");
    const board = msgsOf(bob, "board")[0]?.board;
    expect(board?.text).toBe(`From: Alice\r\rHello town\r${"_".repeat(24)}\r`);
    bob.send({ t: "boardClose" });
    await settle();
    expect(who("Bob").keyLock).toBe(false);
  });

  test("Carol, with no guild, is refused the Knights' board from row 8, and reads and posts from row 7", async () => {
    await click(carol, "Carol", "The Knights's Board");
    expect(lines(carol)).toEqual(["You have to enter the building to view this board."]);
    expect(msgsOf(carol, "board")).toEqual([]);
    await tick(45);
    await step(carol, "U"); // (4, 7)
    await click(carol, "Carol", "The Knights's Board");
    expect(lines(carol)).toEqual(["You view the message board"]);
    expect(msgsOf(carol, "board")[0]?.board).toEqual({
      topic: "The Knights's Board",
      text: "",
      lock: false,
    });
    expect(who("Carol").keyLock).toBe(false);
    carol.send({ t: "boardPost", text: "Carol was here" });
    await settle();
    await tick(45);
    await click(carol, "Carol", "The Knights's Board");
    expect(msgsOf(carol, "board")[0]?.board?.text).toBe(
      `From: Carol\r\rCarol was here\r${"_".repeat(24)}\r`,
    );
  });
});
