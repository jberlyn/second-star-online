/**
 * Bot script: Alice, an administrator, places Amber, Cril and the Fire God with `/roster` and `/spawn`;
 * opens Amber's Bio, buys and sells; gets a free Fireball Book; banks with Cril in the roster, and
 * cannot once he is gone; fills and empties her vault; gives Cril gold; trades with Bob, and a
 * second trade ends when Bob leaves; after a relog her gold, bag, bank, vault and Amber's stock are
 * where they were.
 *
 * The RNG is the script's: a size with nothing queued answers `n`, which matches only
 * `random(1)` (no spawn, no move, no attack, no chatter).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import type { CreateMsg, InventoryView, ServerMsg } from "@secondstaronline/shared";

import type { Db } from "../src/persistence/database.ts";
import { loadShop } from "../src/persistence/economy.ts";
import type { Rng } from "../src/rng.ts";
import { type Bot, connectBot, settle, startTestServer, type TestServer } from "./harness.ts";

type Chat = Extract<ServerMsg, { t: "chat" }>;

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

function place(db: Db, name: string, x: number, y: number) {
  db.run("UPDATE characters SET x = ?, y = ? WHERE name = ?", [x, y, name]);
}

const chatTexts = (bot: Bot) =>
  bot.inbox.filter((m): m is Chat => m.t === "chat").map((m) => m.text);
const lastInv = (bot: Bot): InventoryView | undefined =>
  bot.inbox.filter((m) => m.t === "inv").at(-1)?.inv as InventoryView | undefined;
const bagHas = (bot: Bot, item: string) =>
  lastInv(bot)?.bag.find((l) => l?.item === item)?.qty ?? 0;

describe("NPCs, shops, bank and trade", () => {
  let server: TestServer;
  let alice: Bot;
  let bob: Bot;
  let bobId = "";

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
  const turn = async (bot: Bot, dir: "L" | "R" | "U" | "D") => {
    bot.send({ t: "step", seq: 1, dir, turn: true });
    await tick(1);
  };

  beforeAll(async () => {
    server = startTestServer({ rng });
    const bot = await connectBot(server.wsUrl);
    for (const name of ["Alice", "Bob"]) {
      bot.send(make(name));
      await bot.waitFor((m) => m.t === "created");
      bot.clear();
    }
    bot.close();
    server.db.run(
      "UPDATE accounts SET role = 'administrator' WHERE id = (SELECT account_id FROM characters WHERE name = 'Alice')",
    );
    server.db.run("UPDATE characters SET gold = 1000 WHERE name = 'Alice'");
    place(server.db, "Alice", 6, 6); // the test turns it north after login (face)
    place(server.db, "Bob", 8, 6);
  });
  afterAll(async () => {
    await server.stop();
  });

  test("an operator places NPCs with /roster and /spawn", async () => {
    alice = await login("Alice");
    await say(alice, "/roster 1 Amber");
    await say(alice, "/roster 2 Cril");
    await say(alice, "/roster 3 Fire God");
    await say(alice, "/spawn 1"); // north of Alice: (6, 5)
    await turn(alice, "L");
    await say(alice, "/spawn 2"); // west: (5, 6)
    await turn(alice, "R");
    await say(alice, "/spawn 3"); // east: (7, 6)
    expect(chatTexts(alice)).toContain("Spawned an Amber in roster slot 1.");
    expect(chatTexts(alice)).toContain("Spawned a Fire God in roster slot 3.");
  });

  test("clicking Amber opens her Bio with Buy and Sell", async () => {
    alice.send({ t: "npcClick", slot: 1 });
    const bio = await alice.waitFor((m) => m.t === "bio");
    expect(bio).toMatchObject({ t: "bio", name: "Amber", buy: true, sell: true });
  });

  test("buying three Apples from Amber, then selling one back, each answered processed ok", async () => {
    const apples = bagHas(alice, "Apple");
    alice.clear();
    alice.send({ t: "shopList", mode: "buy" });
    const list = await alice.waitFor((m) => m.t === "shop");
    expect(list.t === "shop" && list.rows[0]).toEqual({ line: 4, item: "Apple", price: 10 });
    alice.send({ t: "buy", line: 4, count: 3 });
    // A completed deal says so, and the client plays the cash sound for it.
    expect(await alice.waitFor((m) => m.t === "processed")).toEqual({ t: "processed", ok: true });
    await settle();
    expect(lastInv(alice)?.gold).toBe(970);
    expect(bagHas(alice, "Apple")).toBe(apples + 3);
    // The list holds the keys until CANCEL, and a locked click opens no Bio.
    alice.send({ t: "shopCancel" });
    // Selling needs the Bio's Sell button.
    alice.send({ t: "npcClick", slot: 1 });
    await settle();
    alice.send({ t: "shopList", mode: "sell" });
    await alice.waitFor((m) => m.t === "shop" && m.mode === "sell");
    alice.clear();
    alice.send({ t: "sell", line: 5, count: 1 });
    expect(await alice.waitFor((m) => m.t === "processed")).toEqual({ t: "processed", ok: true });
    await settle();
    expect(chatTexts(alice)).toEqual(['Amber says "Thanks for the business!"']);
    expect(lastInv(alice)?.gold).toBe(975);
    alice.send({ t: "shopCancel" });
  });

  test("bug fixed: the Fire God's book costs its 100 gold, though he keeps no gold line", async () => {
    alice.send({ t: "npcClick", slot: 3 });
    await settle();
    alice.send({ t: "shopList", mode: "buy" });
    await alice.waitFor((m) => m.t === "shop" && m.rows[0]?.item === "Fireball Book");
    alice.send({ t: "buy", line: 1, count: 1 });
    await alice.waitFor((m) => m.t === "processed");
    await settle();
    expect(bagHas(alice, "Fireball Book")).toBe(1);
    expect(lastInv(alice)?.gold).toBe(875);
    alice.send({ t: "shopCancel" });
  });

  test("the bank, with Cril in the roster", async () => {
    alice.clear();
    await say(alice, "/balance");
    await say(alice, "/deposit 100");
    await say(alice, "/withdraw 30");
    await say(alice, "/withdraw 500");
    expect(chatTexts(alice)).toEqual([
      "You have 0 gold in the bank.",
      "You deposit 100 gold. You now have 100 gold in the bank.",
      "You withdraw 30 gold. You now have 70 gold in the bank.",
      "You don't have that much gold in the bank.",
    ]);
    expect(lastInv(alice)?.gold).toBe(805);
  });

  test("gold to Cril: the offer and 'Thanks for the gold!'", async () => {
    await turn(alice, "L"); // Cril is west
    alice.clear();
    alice.send({ t: "gold", n: 5 });
    await settle();
    expect(chatTexts(alice)).toEqual([
      "*** Offering the 5 gold to Cril.",
      'Cril says "Thanks for the gold!"',
    ]);
    expect(lastInv(alice)?.gold).toBe(800);
  });

  test("the personal vault: a drop puts an Apple in; the window gives it back", async () => {
    await turn(alice, "D"); // south of Alice is free
    await say(alice, "/drop Vault");
    const slot = (lastInv(alice)?.bag.findIndex((l) => l?.item === "Apple") ?? -1) + 1;
    const before = bagHas(alice, "Apple");
    alice.clear();
    alice.send({ t: "drop", slot });
    await settle();
    expect(chatTexts(alice)).toEqual(["You drop a Apple into the container."]);
    expect(bagHas(alice, "Apple")).toBe(before - 1);
    alice.send({ t: "action" }); // Ctrl on the faced Vault
    const v = await alice.waitFor((m) => m.t === "vault");
    expect(v).toEqual({ t: "vault", items: ["Apple"], open: true });
    await settle();
    expect(chatTexts(alice)).toContain("You open your vault to see what's inside...");
    alice.clear();
    alice.send({ t: "vaultTake", index: 1 });
    await alice.waitFor((m) => m.t === "vault");
    await settle();
    expect(bagHas(alice, "Apple")).toBe(before);
    expect(chatTexts(alice)).toContain("You take a Apple out of the container.");
    alice.send({ t: "shopCancel" });
  });

  test("bug fixed: Alice trades 50 gold for Bob's Apple; both accept and both hear it is done", async () => {
    bob = await login("Bob");
    await tick(1); // Bob's bag arrives
    const snap = bob.inbox.find((m) => m.t === "snapshot");
    bobId = snap?.t === "snapshot" ? snap.you.id : "";
    const aliceApples = bagHas(alice, "Apple");
    const aliceGold = lastInv(alice)?.gold ?? 0;
    alice.clear();
    alice.send({ t: "tradeOpen", id: bobId });
    await alice.waitFor((m) => m.t === "trade" && m.trade !== null);
    alice.send({ t: "tradeOffer", gold: 50, items: [] });
    await settle();
    await bob.waitFor((m) => m.t === "trade" && m.trade?.theirs?.gold === 50);
    await settle();
    expect(chatTexts(bob)).toContain("Alice is initiating a trade with you.");
    const appleSlot = (lastInv(bob)?.bag.findIndex((l) => l?.item === "Apple") ?? -1) + 1;
    bob.send({ t: "tradeOffer", gold: 0, items: [{ slot: appleSlot, qty: 1 }] });
    await alice.waitFor((m) => m.t === "trade" && m.trade?.theirs?.items[0]?.item === "Apple");
    const bobApples = bagHas(bob, "Apple");
    bob.clear();
    alice.send({ t: "tradeAccept" });
    await settle();
    // Nothing moves until Bob accepts too.
    expect(chatTexts(bob)).toEqual(["Alice accepts the trade..."]);
    expect(bob.inbox.some((m) => m.t === "inv")).toBe(false);
    alice.clear();
    bob.send({ t: "tradeAccept" });
    await bob.waitFor((m) => m.t === "inv");
    await settle();
    expect(chatTexts(alice)).toEqual(["Bob accepts the trade...", "The trade is complete."]);
    expect(lastInv(bob)?.gold).toBe(50);
    expect(bagHas(bob, "Apple")).toBe(bobApples - 1);
    expect(lastInv(alice)?.gold).toBe(aliceGold - 50);
    expect(bagHas(alice, "Apple")).toBe(aliceApples + 1);
  });

  test("a trade ends for Alice when Bob leaves", async () => {
    alice.send({ t: "tradeOpen", id: bobId });
    alice.send({ t: "tradeOffer", gold: 1, items: [] });
    await bob.waitFor((m) => m.t === "trade" && m.trade !== null && m.trade.theirs?.gold === 1);
    alice.clear();
    bob.close();
    await alice.waitFor((m) => m.t === "chat" && m.text === "Trade cancelled.");
  });

  test("bug fixed: the bank needs a living banker: off the roster, or rostered but not spawned, 'You cannot bank here!'", async () => {
    await say(alice, "/roster 2 clear");
    alice.clear();
    await say(alice, "/balance");
    expect(chatTexts(alice)).toEqual(["You cannot bank here!"]);
    await say(alice, "/roster 2 Cril");
    alice.clear();
    await say(alice, "/balance");
    expect(chatTexts(alice)).toEqual(["You cannot bank here!"]);
    await turn(alice, "L");
    await say(alice, "/spawn 2");
  });

  test("after a relog: gold, bag, bank, vault and Amber's stock persist", async () => {
    // 1000 − 30 (Apples) + 5 (one sold) − 100 (book) − 100 + 30 (bank) − 5 (Cril) − 50 (trade).
    const gold = 750;
    alice.send({ t: "logout" });
    await alice.closed;
    await settle();
    expect(loadShop(server.db, "Amber")?.lines.find((l) => l.line === 4)?.stock).toBe(
      10031 - 3 + 1,
    );
    alice = await login("Alice");
    await tick(1);
    await alice.waitFor((m) => m.t === "inv");
    expect(lastInv(alice)?.gold).toBe(gold);
    expect(bagHas(alice, "Fireball Book")).toBe(1);
    alice.clear();
    await say(alice, "/balance");
    expect(chatTexts(alice)).toEqual(["You have 70 gold in the bank."]);
  });
});
