/**
 * Player shops on the server with real SQL (in-memory SQLite): a Small Shop's build makes its
 * shopkeeper; the owner's chat commands rewrite its file and ledger with the stock kept; decay
 * deletes it with the interior.
 */
import { beforeEach, describe, expect, test } from "bun:test";

import {
  npcLines,
  parseNpcFile,
  type ServerMsg,
  setPrices,
  shopkeeperFile,
} from "@secondstaronline/shared";

import { createGame, type Game } from "../src/game.ts";
import { type Db, openDatabase } from "../src/persistence/database.ts";
import { loadShop } from "../src/persistence/economy.ts";
import { loadInventory } from "../src/persistence/inventory.ts";
import { findMapByCoords } from "../src/persistence/maps.ts";
import { migrate } from "../src/persistence/migrations.ts";
import { loadSlots } from "../src/persistence/monsters.ts";
import { loadNpcFiles } from "../src/persistence/npcfiles.ts";
import { loadPlayerShops } from "../src/persistence/playershops.ts";
import { ledgerFromTemplate, npcBuy, SHOP_TEXT } from "../src/systems/economy/shop.ts";
import { monsterView } from "../src/systems/monsters/slots.ts";
import type { Player } from "../src/systems/world/world.ts";
import { rngByN } from "./helpers/sim.ts";

let db: Db;
let sent: { to: string; msg: ServerMsg }[];
let now: string;

const ROW_8R = Array.from({ length: 17 }, () => "8R").join(" ");
const INTERIOR = "xH11000yH1992";

beforeEach(() => {
  db = openDatabase();
  migrate(db);
  sent = [];
  now = "2026-11-05T00:00:00.000Z";
  db.run("UPDATE maps SET layer1 = ?", [JSON.stringify(Array.from({ length: 12 }, () => ROW_8R))]);
});

const game = (queues: Record<number, number[]> = {}): Game =>
  createGame({
    db,
    send: (to, msg) => sent.push({ to, msg }),
    isoNow: () => now,
    rng: rngByN(queues),
    minute: () => 0,
  });

async function makeChar(g: Game, name: string): Promise<string> {
  await g.create({
    t: "create",
    name,
    password: "pw",
    sex: 1,
    head: 1,
    classCode: 1,
    str: 11,
    sta: 11,
    int: 11,
    wis: 11,
    dex: 11,
  });
  const l = await g.login(name, "pw");
  if (!l.ok) {
    throw new Error(l.text);
  }
  return l.characterId;
}

const texts = (to: string) =>
  sent.flatMap((m) => (m.to === to && m.msg.t === "chat" ? [m.msg.text] : []));
const chats = (to: string) =>
  sent.flatMap((m) => (m.to === to && m.msg.t === "chat" ? [m.msg] : []));

function pl(g: Game, id: string): Player {
  const p = g.world.players.get(id);
  if (!p) {
    throw new Error("not in");
  }
  return p;
}

/**
 * Carol builds a Small Shop at (10, 4) on the seed map and walks in; the default rolls name
 * its shopkeeper Zumu (`random(17)` 17, then 5, 5, 5 and 11: Z u m u).
 */
async function buildShop(g: Game, name = "Carol"): Promise<string> {
  const id = await makeChar(g, name);
  g.enter(id, false);
  g.intent(id, { t: "mapReady" });
  pl(g, id).char.bag[2] = { item: "Small Shop Deed", qty: 1 };
  g.intent(id, { t: "use", slot: 3 });
  g.intent(id, { t: "placeHouse", slot: 3, x: 10, y: 4 });
  return id;
}

/** Walks `id` in through the shop's Exit (10, 5), arriving at (9, 11). */
function walkIn(g: Game, id: string): Player {
  const p = pl(g, id);
  p.x = 10;
  p.y = 5;
  g.tick();
  g.intent(id, { t: "mapReady" });
  return p;
}

const say = (g: Game, id: string, text: string) => {
  const p = pl(g, id);
  p.chatIn = 0;
  g.intent(id, { t: "chat", text });
};

describe("the shopkeeper", () => {
  test("a Small Shop's build writes its shopkeeper: file, owner and roster slot 1 at (10, 4) with 128 HP", async () => {
    const g = game();
    const carol = await buildShop(g);
    const shops = loadPlayerShops(db);
    expect(shops).toEqual([{ npc: "Zumu", ownerId: carol, interior: INTERIOR }]);
    expect(loadNpcFiles(db).find((f) => f.npc === "Zumu")?.text).toBe(
      "OWN|Carol\rBIO|Name: Zumu\rBIO|Class: Shopkeeper\rPRO|\rGLD|0\rSEL|Apple:2:0\rBUY|Apple:1",
    );
    const interior = findMapByCoords(db, 1000, 992, 1);
    expect(interior?.title).toBe("Carol's Shop");
    expect(loadSlots(db, interior?.id ?? "")[0]).toMatchObject({
      species: "Zumu",
      live: { name: "Zumu", hp: 128, x: 10, y: 4 },
    });
  });

  test("it is drawn with member Generic's body 200, its name being outside mlists", async () => {
    const g = game();
    const carol = await buildShop(g);
    const p = walkIn(g, carol);
    expect(p.map.name).toBe(INTERIOR);
    const slot = p.map.slots[0];
    expect(slot && monsterView(slot)).toMatchObject({ name: "Zumu", body: 200 });
  });

  test("a taken name is rolled again; 1.6 overwrote the file", async () => {
    // The first roll is Tela (T e l a, no ending), the crystal merchant's file; then Zumu.
    const g = game({ 17: [15], 5: [2, 4, 1], 11: [1] });
    await buildShop(g);
    expect(loadPlayerShops(db).map((s) => s.npc)).toEqual(["Zumu"]);
    expect(g.world.npcs.get("tela")?.text).toContain("SEL|");
  });

  test("a Small House makes no shopkeeper", async () => {
    const g = game();
    const id = await makeChar(g, "Bob");
    g.enter(id, false);
    g.intent(id, { t: "mapReady" });
    pl(g, id).char.bag[2] = { item: "Small House Deed", qty: 1 };
    g.intent(id, { t: "use", slot: 3 });
    g.intent(id, { t: "placeHouse", slot: 3, x: 10, y: 4 });
    expect(loadPlayerShops(db)).toEqual([]);
  });
});

describe("commands", () => {
  test("a command is said first, then answered; at y > 10 the line is refused and the command still runs", async () => {
    const g = game();
    const carol = await buildShop(g);
    const p = walkIn(g, carol);
    expect(p.y).toBe(11);
    sent = [];
    say(g, carol, "Zumu set Fish=5,2");
    expect(texts(carol)).toEqual([
      "You need to enter this building to talk",
      `Zumu says "OK boss, I've added the item!"`,
    ]);
    p.y = 9;
    sent = [];
    say(g, carol, "Zumu set Fish=6,2");
    expect(texts(carol)).toEqual([
      `Carol says "Zumu set Fish=6,2"`,
      `Zumu says "OK boss, I've added the item!"`,
    ]);
  });

  test("divergence: under the chat cooldown the command runs and the line is not put back", async () => {
    const g = game();
    const carol = await buildShop(g);
    const p = walkIn(g, carol);
    p.y = 9;
    say(g, carol, "hello");
    sent = [];
    g.intent(carol, { t: "chat", text: "Zumu set Fish=5,2" });
    const got = chats(carol);
    expect(got[0]?.text).toMatch(/^You cannot chat yet/);
    expect(got[0]?.restore).toBeUndefined();
    expect(got[1]?.text).toBe(`Zumu says "OK boss, I've added the item!"`);
  });

  test("a command's file and ledger rewrite keeps the stock and till, and survives a restart", async () => {
    let g = game();
    const carol = await buildShop(g);
    const p = walkIn(g, carol);
    p.y = 9;
    say(g, carol, "Zumu set Fish=5,2");
    // A sale to the shop puts 3 Fish in stock and takes 6 from a till of 100.
    const ledger = g.world.shops.get("Zumu");
    if (!ledger) {
      throw new Error("no ledger");
    }
    ledger.gold = 100;
    const fish = ledger.lines.find((l) => l.kind === "SEL" && l.item === "Fish");
    if (fish) {
      fish.stock = 3;
    }
    ledger.dirty = true;
    say(g, carol, "Zumu set Corn=4,1");
    const file = loadNpcFiles(db)
      .find((f) => f.npc === "Zumu")
      ?.text.split("\r");
    expect(file).toEqual([
      "OWN|Carol",
      "BIO|Name: Zumu",
      "BIO|Class: Shopkeeper",
      "PRO|",
      "GLD|100",
      "SEL|Apple:2:0",
      "BUY|Apple:1",
      "SEL|Fish:5:3",
      "BUY|Fish:2",
      "SEL|Corn:4:0",
      "BUY|Corn:1",
      "",
    ]);
    expect(loadShop(db, "Zumu")).toMatchObject({
      gold: 100,
      lines: expect.arrayContaining([
        { line: 8, kind: "SEL", item: "Fish", price: 5, stock: 3 },
        { line: 10, kind: "SEL", item: "Corn", price: 4, stock: 0 },
      ]),
    });
    g.leave(carol);
    g = game();
    g.enter(carol, false);
    g.intent(carol, { t: "mapReady" });
    pl(g, carol).y = 9;
    sent = [];
    say(g, carol, "Zumu register 60");
    expect(texts(carol)).toContain(`Zumu says "Here's the gold."`);
    expect(loadShop(db, "Zumu")?.gold).toBe(40);
    expect(loadInventory(db, carol).gold).toBe(pl(g, carol).char.gold);
  });

  test("Inventory: the till to the owner; the stock said to the room, muffled at y > 10", async () => {
    const g = game();
    const carol = await buildShop(g);
    const pc = walkIn(g, carol);
    pc.y = 9;
    const dave = await makeChar(g, "Dave");
    g.enter(dave, false);
    g.intent(dave, { t: "mapReady" });
    walkIn(g, dave); // (9, 11): outside, for chat
    sent = [];
    say(g, carol, "Zumu inventory");
    expect(texts(carol)).toEqual([
      `Carol says "Zumu inventory"`,
      `Zumu says "I have 0 gold in the register...`,
      `Zumu says "I have 0 Apples."`,
    ]);
    expect(texts(dave)).toEqual(["You hear a muffled voice.", "You hear a muffled voice."]);
    pl(g, dave).y = 9;
    sent = [];
    say(g, carol, "Zumu inventory");
    expect(texts(dave)).toEqual([`Carol says "Zumu inventory"`, `Zumu says "I have 0 Apples."`]);
  });

  test("someone else's commands: the employee and steal lines; inventory and profile say nothing", async () => {
    const g = game();
    const carol = await buildShop(g);
    walkIn(g, carol);
    const dave = await makeChar(g, "Dave");
    g.enter(dave, false);
    g.intent(dave, { t: "mapReady" });
    walkIn(g, dave).y = 9;
    sent = [];
    say(g, dave, "Zumu set Fish=1,9999");
    say(g, dave, "Zumu remove Apple");
    say(g, dave, "Zumu register 1");
    say(g, dave, "Zumu inventory");
    say(g, dave, "Zumu profile Robbed");
    say(g, dave, "Zumu title Dave's now");
    expect(texts(dave).filter((t) => !t.startsWith("Dave says"))).toEqual([
      "Zumu is not your employee!",
      "Zumu is not your employee!",
      `Zumu says "I don't think my boss would like you trying to steal from us."`,
      "You can't change the title of this area!",
    ]);
  });

  test("owned by id: a character whose name is inside the owner's is no owner", async () => {
    const g = game();
    const carol = await buildShop(g, "Carola");
    walkIn(g, carol);
    const car = await makeChar(g, "Carol");
    g.enter(car, false);
    g.intent(car, { t: "mapReady" });
    walkIn(g, car).y = 9;
    sent = [];
    say(g, car, "Zumu register 1");
    expect(texts(car)).toContain(
      `Zumu says "I don't think my boss would like you trying to steal from us."`,
    );
  });

  test("title: the owner's interior takes a new header, shown on the next load", async () => {
    const g = game();
    const carol = await buildShop(g);
    walkIn(g, carol).y = 9;
    sent = [];
    say(g, carol, "Zumu title Fresh Fish");
    expect(texts(carol)).toContain("Your shop title has been updated.");
    expect(findMapByCoords(db, 1000, 992, 1)?.title).toBe("Fresh Fish");
  });

  test("divergence: set closes the shopkeeper's open lists and Bio windows", async () => {
    const g = game();
    const carol = await buildShop(g);
    walkIn(g, carol).y = 9;
    const dave = await makeChar(g, "Dave");
    g.enter(dave, false);
    g.intent(dave, { t: "mapReady" });
    walkIn(g, dave);
    g.intent(dave, { t: "npcClick", slot: 1 });
    expect(pl(g, dave).bio?.npc).toBe("Zumu");
    sent = [];
    say(g, carol, "Zumu set Fish=5,2");
    expect(sent.some((m) => m.to === dave && m.msg.t === "npcClosed")).toBe(true);
    expect(pl(g, dave).bio).toBeNull();
  });

  test("not on a house map, a line naming an NPC is only said", async () => {
    const g = game();
    const id = await makeChar(g, "Ann");
    g.enter(id, false);
    g.intent(id, { t: "mapReady" });
    sent = [];
    say(g, id, "Slime set Fish=5,2");
    expect(texts(id)).toEqual([`Ann says "Slime set Fish=5,2"`]);
  });
});

describe("decay", () => {
  test("a demolished shop's shopkeeper, file, till and owner row are deleted with the interior", async () => {
    let g = game();
    const carol = await buildShop(g);
    g.leave(carol);
    expect(loadPlayerShops(db)).toHaveLength(1);
    now = "2027-01-10T00:00:00.000Z";
    g = game({ 50: [2, 1] });
    const ann = await makeChar(g, "Ann");
    g.enter(ann, false);
    expect(findMapByCoords(db, 1000, 992, 1)).toBeNull();
    expect(loadPlayerShops(db)).toEqual([]);
    expect(loadNpcFiles(db).some((f) => f.npc === "Zumu")).toBe(false);
    expect(loadShop(db, "Zumu")).toBeNull();
    expect(g.world.npcs.get("zumu")).toBeUndefined();
  });
});

describe("buying from a player shop", () => {
  test("kept bug: the seventh item, on line 18, answers out of stock", () => {
    let lines = npcLines(shopkeeperFile("Carol", "Zumu"));
    for (const it of ["Corn", "Fish", "Trout", "Squid", "Herb", "Ale"]) {
      lines = (setPrices(lines, true, "Zumu", it, 1, 1).lines ?? []).filter((l) => l !== "");
    }
    lines = lines.map((l) => (l.startsWith("SEL|") ? l.replace(/:0$/, ":5") : l));
    const shop = ledgerFromTemplate(parseNpcFile("Zumu", lines.join("\r")));
    const buyer = { gold: 100, bag: Array.from({ length: 15 }, () => null) };
    expect(npcBuy(shop, 16, 1, buyer, rngByN()).ok).toBe(true); // Herb, line 16
    expect(npcBuy(shop, 18, 1, buyer, rngByN())).toEqual({
      ok: false,
      text: SHOP_TEXT.outOfStock,
    });
  });
});
