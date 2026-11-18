/**
 * Bot script, part 1: Alice uses a Small House Deed; her first click is on rough ground (refused,
 * placement stays on), her second builds. Bob, on the map, gets the map again with the house's
 * tiles, its Exit and Alice's mailbox. Alice walks onto the Exit and arrives in `xH11000yH1992` at
 * (9, 11) under the header "Alice's House", then walks back out below the door. Outdoors, her Anvil
 * cannot be dropped ("This building does not belong to you…") and a town Anvil answers a click with
 * its line. Months later, with Alice away, Bob's clock check rolls the sweep: the house comes down
 * in front of him and its interior is gone.
 *
 * Rest regen and furniture inside a house need the door opened, which is part 2's: they
 * join its script (the server tests cover them by placing the player).
 *
 * Part 3: Carol builds a Small Shop and its shopkeeper Zumu stands at (10, 4); she gives him gold,
 * sets a price for Fish and sells him three; Dave walks in and buys one, and the till rises;
 * Carol's inventory says the stock to the room; she registers the till out; Dave's commands are
 * refused.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  type CreateMsg,
  type DeltaEvent,
  type ServerMsg,
  withTile,
} from "@secondstaronline/shared";

import type { Db } from "../src/persistence/database.ts";
import { findMapByCoords } from "../src/persistence/maps.ts";
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

const wins: Record<number, number> = {};
const rng: Rng = { random: (n) => (n >= 1 ? (wins[n] ?? n) : 0) };
let now = "2026-11-05T00:00:00.000Z";

const idOf = (db: Db, name: string) =>
  (db.query("SELECT id FROM characters WHERE name = ?").get(name) as { id: string }).id;
function place(db: Db, name: string, x: number, y: number) {
  db.run("UPDATE characters SET x = ?, y = ? WHERE name = ?", [x, y, name]);
}
function bag(db: Db, name: string, items: string[]) {
  const id = idOf(db, name);
  db.run("DELETE FROM inventory WHERE character_id = ?", [id]);
  items.forEach((item, i) => {
    db.run("INSERT INTO inventory (id, character_id, slot, item, qty) VALUES (?, ?, ?, ?, 1)", [
      crypto.randomUUID(),
      id,
      i + 1,
      item,
    ]);
  });
}
function fixture(db: Db, item: string, x: number, y: number) {
  const map = db.query("SELECT id FROM maps WHERE mx = 1000 AND my = 992").get() as { id: string };
  db.run(
    "INSERT INTO ground_items (id, map_id, x, y, item, qty, kind, expires_at, created_at) VALUES (?, ?, ?, ?, ?, 1, 'admin', NULL, '2026-11-05')",
    [crypto.randomUUID(), map.id, x, y, item],
  );
}

const lines = (bot: Bot) => bot.inbox.flatMap((m) => (m.t === "chat" ? [m.text] : []));
const deltas = (bot: Bot): DeltaEvent[] =>
  bot.inbox.flatMap((m) => (m.t === "delta" ? m.events : []));
const lastSnapshot = (bot: Bot) => {
  const s = bot.inbox.filter((m) => m.t === "snapshot").at(-1);
  return s?.t === "snapshot" ? s : null;
};

describe("house maps, deeds and building", () => {
  let server: TestServer;
  let alice: Bot;
  let bob: Bot;
  let seq = 0;

  const tick = async (n: number) => {
    await settle();
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
  /** A quick tap of an arrow, then enough frames to finish the step and any warp. */
  const step = async (bot: Bot, dir: "U" | "D") => {
    bot.send({ t: "step", seq: ++seq, dir, turn: false });
    bot.send({ t: "move", seq: ++seq, held: null, turn: false });
    await tick(20);
    bot.send({ t: "mapReady" });
    await tick(1);
  };

  beforeAll(async () => {
    server = startTestServer({
      rng,
      isoNow: () => now,
      prepare: (db) => {
        // Buildable ground: layer 1 `8R`.
        const row = Array.from({ length: 17 }, () => "8R").join(" ");
        db.run("UPDATE maps SET layer1 = ?", [
          JSON.stringify(Array.from({ length: 12 }, () => row)),
        ]);
        // A tree inside the first footprint Alice tries.
        const l2 = JSON.parse(
          (
            db.query("SELECT layer2 AS l FROM maps WHERE mx = 1000 AND my = 992").get() as {
              l: string;
            }
          ).l,
        ) as string[];
        db.run("UPDATE maps SET layer2 = ? WHERE mx = 1000 AND my = 992", [
          JSON.stringify(withTile(l2, 15, 5, "S3")),
        ]);
        fixture(db, "Anvil", 3, 6);
      },
    });
    const bot = await connectBot(server.wsUrl);
    for (const name of ["Alice", "Bob"]) {
      bot.send(make(name));
      await bot.waitFor((m) => m.t === "created");
      bot.clear();
    }
    bot.close();
    place(server.db, "Alice", 7, 6);
    place(server.db, "Bob", 3, 7);
    bag(server.db, "Alice", ["Small House Deed", "Anvil"]);
    alice = await login("Alice");
    bob = await login("Bob");
  });

  afterAll(() => {
    alice?.close();
    bob?.close();
    server?.stop();
  });

  test("a deed's Use starts placement; rough ground is refused and placement stays on", async () => {
    alice.send({ t: "use", slot: 1 });
    await settle();
    expect(alice.inbox.some((m) => m.t === "placing" && m.house === "Small House")).toBe(true);
    alice.send({ t: "placeHouse", slot: 1, x: 15, y: 5 });
    await settle();
    expect(lines(alice)).toContain("The terrain is too rough to build here!");
    expect(findMapByCoords(server.db, 1000, 992, 1)).toBeNull();
  });

  test("the second click builds; Bob gets the map again with the tiles, the Exit and the mailbox", async () => {
    bob.clear();
    alice.send({ t: "placeHouse", slot: 1, x: 7, y: 3 });
    // Building writes the house map to the database, which can outlast settle()'s fixed
    // 30 ms under a loaded test run, so wait for the replies themselves.
    await alice.waitFor((m) => m.t === "placing" && m.house === null);
    await alice.waitFor((m) => m.t === "inv" && m.inv.bag[0] === null);
    await bob.waitFor((m) => m.t === "snapshot");
    const snap = lastSnapshot(bob);
    expect(snap?.map.layers[1][1]?.split(" ").slice(5, 8)).toEqual(["D5", "E5", "I5"]);
    expect(snap?.ground.map((g) => `${g.name}@${g.x},${g.y}`)).toEqual(
      expect.arrayContaining(["Exit@7,4", "Alice's Mailbox@6,4"]),
    );
  });

  test("the Exit leads in at (9, 11) under 'Alice's House'; the interior Exit leads out below the door", async () => {
    alice.clear();
    await step(alice, "U"); // (7, 5)
    await step(alice, "U"); // onto the Exit at (7, 4)
    await tick(2);
    const inside = lastSnapshot(alice);
    expect(inside?.map.name).toBe("xH11000yH1992");
    expect(inside?.map.title).toBe("Alice's House");
    expect([inside?.you.x, inside?.you.y]).toEqual([9, 11]);
    alice.clear();
    await step(alice, "D"); // onto the interior Exit (9, 12)
    await tick(2);
    const out = lastSnapshot(alice);
    expect(out?.map.name).toBe("x1000y992");
    expect([out?.you.x, out?.you.y]).toEqual([7, 5]);
  });

  test("outdoors her Anvil cannot be placed, and the town Anvil answers a click", async () => {
    alice.clear();
    alice.send({ t: "drop", slot: 2 });
    await settle();
    expect(lines(alice)).toContain(
      "This building does not belong to you, you can't place this here!",
    );
    const anvil = lastSnapshot(bob)?.ground.find((g) => g.name === "Anvil");
    bob.clear();
    bob.send({ t: "pickup", id: anvil?.id ?? "" });
    await settle();
    expect(lines(bob)).toContain("This is an anvil, used for blacksmithing.");
  });

  test("two months on, with Alice away, Bob's clock check sweeps: the house comes down in front of him", async () => {
    alice.send({ t: "logout" });
    alice.close();
    await settle(60);
    now = "2027-01-10T00:00:00.000Z";
    wins[50] = 1;
    bob.clear();
    await tick(1230);
    delete wins[50];
    const tiles = deltas(bob).filter((e) => e.e === "tile");
    expect(tiles.length).toBe(9);
    expect(deltas(bob).filter((e) => e.e === "gdel").length).toBe(2);
    expect(findMapByCoords(server.db, 1000, 992, 1)).toBeNull();
    expect(findMapByCoords(server.db, 1000, 992)?.layers[1][1]?.split(" ").slice(5, 8)).toEqual([
      "G3",
      "G3",
      "G3",
    ]);
  });
});

/**
 * Part 2: doors, keys and containers. Alice builds again and opens her door with her House Key;
 * inside she rests (rest regen at y < 11) and places her Anvil. Bob walks in through the open
 * door: his House Key does not fit, his Anvil is refused and hers answers his click with its
 * line. Alice fills and empties her House Vault; Bob, facing it, is refused and keeps his Pie.
 * Outside, Alice opens a Steel Door with a Steel Key (spent), and 200 frames later it relocks.
 * A Crate on the floor takes her Apple, opens with Ctrl and is clicked up with the Apple in it.
 */
describe("doors, keys and containers", () => {
  let server: TestServer;
  let alice: Bot;
  let bob: Bot;
  let seq = 0;

  const tick = async (n: number) => {
    await settle();
    // The gateway's message bucket refills on the server clock (manual in tests).
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
  const who = (name: string) => {
    const p = [...server.game.world.players.values()].find((x) => x.name === name);
    if (!p) {
      throw new Error(`${name} is not in`);
    }
    return p;
  };
  /** Where a character stands on the server: `<map>@x,y`. */
  const at = (name: string) => `${who(name).map.name}@${who(name).x},${who(name).y}`;
  /** The 1-based bag slot holding `item` on the server, or 0. */
  const slotOf = (name: string, item: string) =>
    who(name).char.bag.findIndex((l) => l !== null && l.item === item) + 1;
  /** The id of the ground item called `item` on `name`'s map. */
  const groundOf = (name: string, item: string) =>
    who(name).map.ground.find((g) => g.item === item)?.id ?? "";

  beforeAll(async () => {
    now = "2026-11-05T00:00:00.000Z";
    server = startTestServer({
      rng,
      isoNow: () => now,
      prepare: (db) => {
        const row = Array.from({ length: 17 }, () => "8R").join(" ");
        db.run("UPDATE maps SET layer1 = ?", [
          JSON.stringify(Array.from({ length: 12 }, () => row)),
        ]);
        fixture(db, "Steel Door", 7, 7);
        fixture(db, "Crate#501", 6, 6);
      },
    });
    const bot = await connectBot(server.wsUrl);
    for (const name of ["Alice", "Bob"]) {
      bot.send(make(name));
      await bot.waitFor((m) => m.t === "created");
      bot.clear();
    }
    bot.close();
    place(server.db, "Alice", 7, 6);
    place(server.db, "Bob", 7, 5);
    // Alice is hurt (rest regen) and strong enough to lift a crate (Str 15).
    server.db.run("UPDATE characters SET hp = 5, sp = 5, str = 15 WHERE name = 'Alice'");
    bag(server.db, "Alice", [
      "Small House Deed",
      "House Key",
      "Anvil",
      "Apple",
      "Steel Key",
      "Steel Key",
    ]);
    bag(server.db, "Bob", ["House Key", "Anvil", "Pie"]);
    alice = await login("Alice");
  });

  afterAll(() => {
    alice?.close();
    bob?.close();
    server?.stop();
  });

  test("Alice builds and opens her door with her House Key; it stays open", async () => {
    alice.send({ t: "use", slot: 1 });
    alice.send({ t: "placeHouse", slot: 1, x: 7, y: 3 });
    await settle();
    await step(alice, "U"); // (7, 5)
    await step(alice, "U"); // the Exit: inside at (9, 11)
    await tick(2);
    expect(at("Alice")).toBe("xH11000yH1992@9,11");
    const doorId = groundOf("Alice", "Alice's Door");
    alice.clear();
    alice.send({ t: "use", slot: 2 });
    await settle();
    expect(deltas(alice)).toContainEqual({ e: "gset", id: doorId, name: "Alice's Opened Door" });
    await tick(400); // player doors never relock
    await step(alice, "U"); // through the door (9, 10)
    await step(alice, "U"); // (9, 9)
    await step(alice, "U"); // (9, 8)
    expect(at("Alice")).toBe("xH11000yH1992@9,8");
  });

  test("inside, she rests and places her Anvil", async () => {
    const hp = () => {
      const v = alice.inbox.filter((m) => m.t === "vitals").at(-1);
      return v?.t === "vitals" ? v.vitals.hp : -1;
    };
    alice.clear();
    wins[10] = 1;
    await tick(3);
    delete wins[10];
    expect(hp()).toBeGreaterThan(5);
    alice.send({ t: "drop", slot: 3 }); // facing (9, 7)
    await settle();
    expect(deltas(alice).some((e) => e.e === "gadd" && e.item.name === "Anvil")).toBe(true);
  });

  test("Bob walks in: his key does not fit, his Anvil is refused, hers answers his click", async () => {
    bob = await login("Bob");
    await step(bob, "U"); // the Exit: inside at (9, 11), facing the open door
    await tick(2);
    bob.clear();
    bob.send({ t: "use", slot: 1 });
    await settle();
    expect(lines(bob)).toEqual(["Your key doesn't fit this lock!"]);
    await step(bob, "U"); // (9, 10)
    await step(bob, "U"); // (9, 9)
    bob.clear();
    bob.send({ t: "drop", slot: 2 });
    await settle();
    expect(lines(bob)).toEqual([
      "This building does not belong to you, you can't place this here!",
    ]);
    bob.send({ t: "pickup", id: groundOf("Bob", "Anvil") });
    await settle();
    expect(lines(bob)).toContain("This is an anvil, used for blacksmithing.");
  });

  test("Alice fills and empties her House Vault; Bob, facing it, is refused", async () => {
    await step(alice, "L"); // (8, 8)
    await step(alice, "L"); // (7, 8)
    await step(alice, "L"); // (6, 8), facing the vault at (5, 8)
    alice.clear();
    alice.send({ t: "drop", slot: slotOf("Alice", "Apple") });
    await settle();
    expect(lines(alice)).toEqual(["You drop a Apple into the container."]);
    await tick(41);
    alice.send({ t: "action" });
    await settle();
    expect(lines(alice)).toContain("You open Alice's House Vault to see what's inside...");
    expect(alice.inbox).toContainEqual({ t: "vault", items: ["Apple"], open: true });
    alice.send({ t: "vaultTake", index: 1 });
    alice.send({ t: "shopCancel" });
    await settle();
    expect(slotOf("Alice", "Apple")).toBeGreaterThan(0);
    await step(alice, "U"); // (6, 7): out of Bob's way
    await step(bob, "U"); // (9, 8)
    await step(bob, "L"); // (8, 8)
    await step(bob, "L"); // (7, 8)
    await step(bob, "L"); // (6, 8), facing the vault
    bob.clear();
    bob.send({ t: "action" });
    await settle();
    expect(lines(bob)).toEqual(["You can't open a vault that's not yours!"]);
    await tick(41);
    bob.send({ t: "drop", slot: 3 });
    await settle();
    expect(lines(bob)).toContain("You can't open a vault that's not yours!");
    expect(slotOf("Bob", "Pie")).toBe(3);
  });

  test("outside, a Steel Key opens the Steel Door and is spent; 200 frames later it relocks", async () => {
    for (const d of ["R", "R", "D", "R", "D", "D", "D", "D"] as const) {
      await step(alice, d); // (7, 7) (8, 7) (8, 8) (9, 8) … the Exit
    }
    await tick(2);
    expect(at("Alice")).toBe("x1000y992@7,5");
    await step(alice, "D"); // (7, 6), facing the Steel Door at (7, 7)
    const doorId = groundOf("Alice", "Steel Door");
    alice.clear();
    alice.send({ t: "use", slot: 5 });
    await settle();
    expect(deltas(alice)).toContainEqual({ e: "gset", id: doorId, name: "Open Steel Door" });
    expect(who("Alice").char.bag[4]).toBeNull();
    alice.clear();
    await tick(199);
    expect(deltas(alice).some((e) => e.e === "gset")).toBe(false);
    await tick(1);
    expect(deltas(alice)).toContainEqual({ e: "gset", id: doorId, name: "Steel Door" });
  });

  test("a Crate takes her Apple, opens with Ctrl, and is clicked up with the Apple in it", async () => {
    await turn(alice, "L"); // facing the Crate at (6, 6)
    await tick(430); // the Steel Key's 425-frame pause
    alice.clear();
    alice.send({ t: "drop", slot: slotOf("Alice", "Apple") });
    await settle();
    expect(lines(alice)).toEqual(["You drop a Apple into the container."]);
    alice.send({ t: "action" });
    await settle();
    expect(lines(alice)).toContain("You open the Crate to see what's inside...");
    expect(alice.inbox).toContainEqual({ t: "vault", items: ["Apple"], open: true });
    alice.send({ t: "shopCancel" });
    await tick(1);
    alice.send({ t: "pickup", id: groundOf("Alice", "Crate#501") });
    await settle();
    expect(slotOf("Alice", "Crate#501")).toBeGreaterThan(0);
    const row = server.db
      .query("SELECT item FROM container_items WHERE name = 'Crate#501'")
      .all() as { item: string }[];
    expect(row.map((r) => r.item)).toEqual(["Apple"]);
  });
});

describe("player shops", () => {
  let server: TestServer;
  let carol: Bot;
  let dave: Bot;
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
  /** Says a line once the 3 s chat cooldown is over. */
  const say = async (bot: Bot, text: string) => {
    await tick(61);
    bot.clear();
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
  const at = (name: string) => `${who(name).map.name}@${who(name).x},${who(name).y}`;
  const till = () => server.game.world.shops.get("Zumu")?.gold;

  beforeAll(async () => {
    now = "2026-11-05T00:00:00.000Z";
    server = startTestServer({
      rng,
      isoNow: () => now,
      prepare: (db) => {
        const row = Array.from({ length: 17 }, () => "8R").join(" ");
        db.run("UPDATE maps SET layer1 = ?", [
          JSON.stringify(Array.from({ length: 12 }, () => row)),
        ]);
      },
    });
    const bot = await connectBot(server.wsUrl);
    for (const name of ["Carol", "Dave"]) {
      bot.send(make(name));
      await bot.waitFor((m) => m.t === "created");
      bot.clear();
    }
    bot.close();
    place(server.db, "Carol", 7, 6);
    place(server.db, "Dave", 7, 6);
    bag(server.db, "Carol", ["Small Shop Deed", "Fish"]);
    server.db.run("UPDATE inventory SET qty = 3 WHERE item = 'Fish'");
    server.db.run("UPDATE characters SET gold = 500 WHERE name IN ('Carol', 'Dave')");
    carol = await login("Carol");
  });

  afterAll(() => {
    carol?.close();
    dave?.close();
    server?.stop();
  });

  test("Carol builds a Small Shop; its shopkeeper Zumu stands at (10, 4) with Generic's body", async () => {
    carol.send({ t: "use", slot: 1 });
    carol.send({ t: "placeHouse", slot: 1, x: 7, y: 3 });
    await settle();
    await step(carol, "U"); // (7, 5)
    await step(carol, "U"); // the Exit: inside at (9, 11)
    await tick(2);
    expect(at("Carol")).toBe("xH11000yH1992@9,11");
    const snap = lastSnapshot(carol);
    expect(snap?.map.title).toBe("Carol's Shop");
    expect(snap?.monsters).toContainEqual(
      expect.objectContaining({ slot: 1, name: "Zumu", body: 200, x: 10, y: 4 }),
    );
  });

  test("she gives Zumu gold, sets a price and sells him stock", async () => {
    for (const d of ["U", "U", "U", "U", "U", "U"] as const) {
      await step(carol, d);
    }
    await step(carol, "R");
    await turn(carol, "U");
    expect(at("Carol")).toBe("xH11000yH1992@10,5");
    carol.clear();
    carol.send({ t: "gold", n: 100 });
    await settle();
    expect(lines(carol)).toContain('Zumu says "Thanks for the gold!"');
    expect(till()).toBe(100);

    await say(carol, "Zumu set Fish=5,2");
    // A command is answered, not said aloud.
    expect(lines(carol)).toEqual([`Zumu says "OK boss, I've added the item!"`]);

    carol.send({ t: "npcClick", slot: 1 });
    await settle();
    carol.send({ t: "shopList", mode: "sell" });
    carol.send({ t: "sell", line: 9, count: 3 }); // BUY|Fish:2 on line 9
    await settle();
    carol.send({ t: "shopCancel" });
    await settle();
    expect(till()).toBe(94);
    expect(
      server.game.world.shops.get("Zumu")?.lines.find((l) => l.kind === "SEL" && l.item === "Fish")
        ?.stock,
    ).toBe(3);
  });

  test("Dave walks in and buys a Fish; the till rises by 5", async () => {
    dave = await login("Dave");
    await step(dave, "U"); // (7, 5)
    await step(dave, "U"); // inside at (9, 11)
    await tick(2);
    await step(dave, "U"); // (9, 10): inside, for chat
    expect(at("Dave")).toBe("xH11000yH1992@9,10");
    dave.send({ t: "npcClick", slot: 1 });
    await settle();
    dave.send({ t: "shopList", mode: "buy" });
    dave.send({ t: "buy", line: 8, count: 1 }); // SEL|Fish:5:3 on line 8
    await settle();
    dave.send({ t: "shopCancel" });
    await settle();
    expect(till()).toBe(99);
    expect(who("Dave").char.gold).toBe(495);
  });

  test("Carol's inventory: the till and the stock to her alone", async () => {
    dave.clear();
    await say(carol, "Zumu inventory");
    expect(lines(carol)).toEqual([
      'Zumu says "I have 99 gold in the register..."',
      'Zumu says "I have 0 Apple in stock."',
      'Zumu says "I have 2 Fish in stock."',
    ]);
    expect(lines(dave)).toEqual([]);
  });

  test("Carol registers the gold out", async () => {
    const before = who("Carol").char.gold;
    await say(carol, "Zumu register 99");
    expect(lines(carol)).toContain(`Zumu says "Here's the gold."`);
    expect(who("Carol").char.gold).toBe(before + 99);
    expect(till()).toBe(0);
  });

  test("Dave's commands are refused", async () => {
    await say(dave, "Zumu set Fish=1,9999");
    expect(lines(dave)).toContain("Zumu is not your employee!");
    await say(dave, "Zumu register 5");
    expect(lines(dave)).toContain(
      `Zumu says "I don't think my boss would like you trying to steal from us."`,
    );
    expect(who("Dave").char.gold).toBe(495);
  });
});
