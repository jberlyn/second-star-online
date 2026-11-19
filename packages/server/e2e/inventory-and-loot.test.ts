/**
 * Bot script: the starting kit arrives; equipping the
 * Knife changes Alice's look for Bob; she eats an Apple and gives one to Bob, who grabs it
 * 60 frames later; she kills a Slime, whose 2 Gold decays after the loot time; she hits Bob
 * on a PvP map (a swing that also hits a monster would not); Bob dies and drops his Knife;
 * Alice picks it up; and after a relog everything is where it was.
 *
 * The RNG is the script's: a size with nothing queued answers `n`, which matches only
 * `random(1)` (no spawn, no move, no monster attack, no hunger loss, no parry).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import type {
  CreateMsg,
  DeltaEvent,
  GroundView,
  InventoryView,
  ServerMsg,
} from "@secondstaronline/shared";

import type { Db } from "../src/persistence/database.ts";
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

const queues: Record<number, number[]> = {};
const rng: Rng = {
  random(n) {
    if (!(n >= 1)) {
      return 0;
    }
    const q = queues[n];
    return q && q.length > 0 ? (q.shift() as number) : n;
  },
};
const queue = (n: number, ...answers: number[]) => {
  queues[n] = [...(queues[n] ?? []), ...answers];
};

let now = Date.parse("2026-11-05T00:00:00.000Z");
const iso = () => new Date(now).toISOString();

function place(db: Db, name: string, x: number, y: number) {
  db.run("UPDATE characters SET x = ?, y = ? WHERE name = ?", [x, y, name]);
}

const chatTexts = (bot: Bot) =>
  bot.inbox.filter((m): m is Chat => m.t === "chat").map((m) => m.text);
const deltas = (bot: Bot): DeltaEvent[] =>
  bot.inbox.flatMap((m) => (m.t === "delta" ? m.events : []));
const lastInv = (bot: Bot): InventoryView | undefined =>
  bot.inbox.filter((m) => m.t === "inv").at(-1)?.inv as InventoryView | undefined;
/** The first three bag lines (the bag always has 15). */
const bag3 = (bot: Bot) => lastInv(bot)?.bag.slice(0, 3);
const added = (bot: Bot): GroundView[] =>
  deltas(bot).flatMap((e) => (e.e === "gadd" ? [e.item] : []));

describe("inventory, equipment and loot", () => {
  let server: TestServer;
  let alice: Bot;
  let bob: Bot;

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

  beforeAll(async () => {
    server = startTestServer({
      rng,
      isoNow: iso,
      // One-minute loot decay so the script can watch it go (setting `lootDecay`).
      prepare: (db) =>
        db.run("INSERT INTO settings (key, value, updated_at) VALUES ('lootDecay', '60', ?)", [
          iso(),
        ]),
    });
    const bot = await connectBot(server.wsUrl);
    for (const name of ["Alice", "Bob"]) {
      bot.send(make(name));
      await bot.waitFor((m) => m.t === "created");
      bot.clear();
    }
    bot.close();
    place(server.db, "Alice", 6, 4); // the test turns it north after login (face)
    place(server.db, "Bob", 5, 4); // west of Alice
  });
  afterAll(async () => {
    await server.stop();
  });

  test("the starting kit and the stats arrive at login", async () => {
    alice = await login("Alice");
    bob = await login("Bob");
    await tick(1);
    expect(lastInv(alice)).toMatchObject({ gold: 0, equip: { weapon: "NOTHING" } });
    expect(bag3(alice)).toEqual([{ item: "Apple", qty: 2 }, { item: "Knife", qty: 1 }, null]);
    expect(alice.inbox.some((m) => m.t === "sheet")).toBe(true);
  });

  test("equipping the Knife: Alice's bag loses it and Bob sees her new look", async () => {
    bob.clear();
    alice.send({ t: "equip", slot: 2 });
    await settle();
    expect(lastInv(alice)?.equip.weapon).toBe("Knife");
    expect(bag3(alice)).toEqual([{ item: "Apple", qty: 2 }, null, null]);
    await tick(1);
    expect(deltas(bob)).toContainEqual(
      expect.objectContaining({ e: "look", equip: expect.objectContaining({ weapon: "Knife" }) }),
    );
  });

  test("bug fixed: eating an Apple at the starting hunger of 50000 is refused and the Apple kept", async () => {
    alice.clear();
    alice.send({ t: "use", slot: 1 });
    await tick(1);
    expect(chatTexts(alice)).toEqual(["You're stuffed!"]);
    expect(lastInv(alice)).toBeUndefined();
  });

  test("giving an Apple to Bob: it lands on his tile and he grabs it 60 frames later", async () => {
    // Turn west to face Bob (Alt-turn).
    alice.send({ t: "step", seq: 1, dir: "L", turn: true });
    await tick(1);
    alice.clear();
    bob.clear();
    alice.send({ t: "give", slot: 1 });
    await settle();
    expect(chatTexts(alice)).toEqual(["*** You offer the Apple to Bob."]);
    expect(added(bob)).toMatchObject([{ name: "Apple", x: 5, y: 4 }]);
    await tick(59);
    expect(lastInv(bob)).toBeUndefined();
    await tick(1);
    expect(lastInv(bob)?.bag[0]).toEqual({ item: "Apple", qty: 3 });
    // The receiver is told who is giving what
    expect(chatTexts(bob)).toEqual(["Alice is giving you a Apple."]);
    expect(deltas(alice).some((e) => e.e === "gdel")).toBe(true);
  });

  test("Alice kills a Slime north of her; its 2 Gold decays after a minute", async () => {
    alice.send({ t: "step", seq: 2, dir: "U", turn: true });
    await tick(50);
    // Two players: spawn gate 1/120; tile (6,3); random(5) = 1; facing S.
    queue(120, 1);
    queue(17, 6);
    queue(12, 3);
    queue(5, 1);
    queue(4, 2);
    await tick(1);
    expect(deltas(alice).some((e) => e.e === "mspawn")).toBe(true);
    alice.clear();
    bob.clear();
    // Loot: line random(4) = 1 ("2 Gold:1"), then random(1) = 1.
    queue(4, 1);
    alice.send({ t: "attack", seq: 3, held: true });
    for (let i = 0; i < 20 && !deltas(alice).some((e) => e.e === "mhit" && e.kill); i++) {
      await tick(15);
    }
    alice.send({ t: "attack", seq: 4, held: false });
    await tick(1);
    expect(added(bob)).toMatchObject([{ name: "2 Gold", x: 6, y: 3 }]);
    now += 60_000;
    await tick(1);
    const gold = added(bob)[0] as GroundView;
    expect(deltas(bob)).toContainEqual({ e: "gdel", id: gold.id });
  });

  test("PvP on this map: Alice's swing hurts Bob, with the splat; wanted, he dies and drops his Knife", async () => {
    // Face Bob again; Bob is down to 1 HP.
    alice.send({ t: "step", seq: 5, dir: "L", turn: true });
    await tick(30);
    const p = server.game.world.players.get(
      server.db.query<{ id: string }, []>("SELECT id FROM characters WHERE name = 'Bob'").get()
        ?.id ?? "",
    );
    if (p) {
      p.char.vitals.hp = 1;
      // Only a wanted character drops on death.
      p.char.wanted = true;
    }
    alice.clear();
    bob.clear();
    alice.send({ t: "attack", seq: 6, held: true });
    await tick(1);
    alice.send({ t: "attack", seq: 7, held: false });
    await tick(1);
    expect(deltas(bob)).toContainEqual(
      expect.objectContaining({ e: "phit", splat: true, color: 6 }),
    );
    // Death drop: no gold, two filled lines, random(2) = 2: line 2, the Knife.
    expect(added(alice)).toMatchObject([{ name: "Knife", x: 5, y: 4 }]);
    expect(lastInv(bob)?.bag[1]).toBeNull();
  });

  test("Alice clicks the Knife next to her and picks it up", async () => {
    const knife = added(alice)[0] as GroundView;
    alice.send({ t: "pickup", id: knife.id });
    await settle();
    expect(bag3(alice)).toEqual([{ item: "Apple", qty: 1 }, { item: "Knife", qty: 1 }, null]);
  });

  test("a relog keeps the bag and the equipment", async () => {
    alice.close();
    await settle(60);
    alice = await login("Alice");
    await tick(1);
    expect(lastInv(alice)?.equip.weapon).toBe("Knife");
    expect(bag3(alice)).toEqual([{ item: "Apple", qty: 1 }, { item: "Knife", qty: 1 }, null]);
    alice.close();
    bob.close();
    await settle(60);
  });
});
