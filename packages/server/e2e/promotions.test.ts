/**
 * Bot script: Amber's file is replaced by a trainer
 * (`TRN|Grunt:100`, `TRN|Fire Mage:10000`, `TRN|Ninja:5`; /roster takes only the `mlists` species,
 * so the trainer wears Amber's name). Alice, an immortal, puts it on the map. Bob (a Fighter with
 * 150 gold and Slash 30) clicks it: the Bio has Train; the train list has the three lines; Fire
 * Mage is refused for a Fighter, Ninja does nothing, Grunt promotes (class, gold, `heal2`); a
 * second Grunt says "learned all"; after a reconnect the class and gold hold and Thrust is as it
 * was (a kept bug: promotion skill grants are undone).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import type { CreateMsg, ServerMsg } from "@secondstaronline/shared";

import { saveNpcFile } from "../src/persistence/npcfiles.ts";
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

const TRAINER = ["BIO|Name: Amber", "TRN|Grunt:100", "TRN|Fire Mage:10000", "TRN|Ninja:5"].join(
  "\r",
);

const chats = (bot: Bot) => bot.inbox.flatMap((m) => (m.t === "chat" ? [m.text] : []));
const goldOf = (bot: Bot) => bot.inbox.flatMap((m) => (m.t === "inv" ? [m.inv.gold] : [])).at(-1);
const kinds = (bot: Bot) => bot.inbox.map((m) => m.t);

describe("promotions at a trainer", () => {
  let server: TestServer;
  let alice: Bot;
  let bob: Bot;
  let thrustBefore: number | undefined;

  const login = async (name: string): Promise<Bot> => {
    const bot = await connectBot(server.wsUrl);
    bot.send({ t: "login", name, password: "secret" });
    await bot.waitFor((m) => m.t === "snapshot");
    bot.send({ t: "mapReady" });
    await settle();
    return bot;
  };
  const tick = async (n: number) => {
    await settle();
    server.tickNow(n);
    await settle();
  };
  const say = async (bot: Bot, text: string) => {
    bot.send({ t: "chat", text });
    await settle();
  };
  const thrust = () =>
    server.db
      .query<{ value: number }, []>(
        "SELECT value FROM character_skills WHERE skill = 2 AND character_id = (SELECT id FROM characters WHERE name = 'Bob')",
      )
      .get()?.value;

  beforeAll(async () => {
    server = startTestServer({
      rng,
      prepare: (db) =>
        saveNpcFile(db, { npc: "Amber", text: TRAINER }, "test", "2026-11-08T00:00:00.000Z"),
    });
    const bot = await connectBot(server.wsUrl);
    for (const name of ["Alice", "Bob"]) {
      bot.send(make(name));
      await bot.waitFor((m) => m.t === "created");
      bot.clear();
    }
    bot.close();
    server.db.run(
      "UPDATE accounts SET role = 'immortal' WHERE id = (SELECT account_id FROM characters WHERE name = 'Alice')",
    );
    server.db.run("UPDATE characters SET x = 6, y = 6 WHERE name = 'Alice'");
    server.db.run("UPDATE characters SET x = 6, y = 4, gold = 150 WHERE name = 'Bob'");
    server.db.run(
      "UPDATE character_skills SET value = 30 WHERE skill = 1 AND character_id = (SELECT id FROM characters WHERE name = 'Bob')",
    );
  });
  afterAll(async () => {
    await server.stop();
  });

  test("Bob clicks the trainer: the Bio has Train; the train list has the three lines", async () => {
    alice = await login("Alice");
    bob = await login("Bob");
    thrustBefore = thrust();
    await tick(50);
    alice.send({ t: "step", seq: 1, dir: "R", turn: true });
    await tick(1);
    await say(alice, "/roster 1 Amber");
    await say(alice, "/spawn 1");
    bob.clear();
    bob.send({ t: "npcClick", slot: 1 });
    bob.send({ t: "shopList", mode: "train" });
    await settle();
    expect(bob.inbox.find((m) => m.t === "bio")).toMatchObject({ name: "Amber", train: true });
    const shop = bob.inbox.find((m): m is Extract<ServerMsg, { t: "shop" }> => m.t === "shop");
    expect(shop).toEqual({
      t: "shop",
      mode: "train",
      rows: [
        { line: 2, item: "Grunt", price: 100 },
        { line: 3, item: "Fire Mage", price: 10000 },
        { line: 4, item: "Ninja", price: 5 },
      ],
    });
  });

  test("Fire Mage is refused for a Fighter; Ninja does nothing but clear PROCESSING", async () => {
    bob.clear();
    bob.send({ t: "train", line: 3 });
    await settle();
    expect(chats(bob)).toEqual(["Amber: It is impossible for a Fighter to learn this."]);
    expect(kinds(bob)).toEqual(["chat", "processed"]);
    bob.clear();
    bob.send({ t: "train", line: 4 });
    await settle();
    expect(kinds(bob)).toEqual(["processed"]);
  });

  test("Grunt promotes: the text, heal2, 100 gold gone; again says learned all", async () => {
    bob.clear();
    bob.send({ t: "train", line: 2 });
    await settle();
    expect(chats(bob)).toEqual(["Amber: Congratulations, you are now a Grunt!"]);
    expect(bob.inbox.find((m) => m.t === "sound")).toEqual({ t: "sound", name: "heal2", ch: 3 });
    expect(kinds(bob).filter((k) => k === "processed")).toHaveLength(1);
    expect(goldOf(bob)).toBe(50);
    bob.clear();
    bob.send({ t: "train", line: 2 });
    await settle();
    expect(chats(bob)).toEqual(["Amber: You have learned all there is to the art of the Grunt."]);
  });

  test("after a reconnect the class and gold hold, and Thrust is as it was", async () => {
    bob.close();
    await settle();
    bob = await login("Bob");
    const row = server.db
      .query<{ class_code: number; gold: number }, []>(
        "SELECT class_code, gold FROM characters WHERE name = 'Bob'",
      )
      .get();
    expect(row).toEqual({ class_code: 4, gold: 50 });
    expect(thrustBefore).toBe(20);
    expect(thrust()).toBe(thrustBefore);
  });
});
