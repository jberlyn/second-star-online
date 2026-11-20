/**
 * Bot script: Alice, an administrator, puts Amber and a Slime on the seed map; Bob buys 3 Apples from
 * Amber. Alice opens the NPC editor (Bob sees her leave; Bob cannot open it) and LOADs Amber with
 * the live stock. A save naming an item that does not exist is refused and changes nothing. Her
 * save of Amber's new prices closes Bob's open shop; reopened, it lists the new line and charges
 * the new price. She gives the Slime one drop line, `INV|5 Gold:1`, and Bob's kill drops 5 Gold. A
 * chatter line past line 20 saves with a warning. She switches to the World Editor and Return To
 * Game puts her back.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import type { CreateMsg, DeltaEvent, ServerMsg } from "@secondstaronline/shared";

import { loadNpcFiles, npcFileVersions } from "../src/persistence/npcfiles.ts";
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

/** `random(n)` answers n: no spawns, moves, monster attacks, chatter or pushes. */
const rng: Rng = { random: (n) => (n >= 1 ? n : 0) };

type Alert = Extract<ServerMsg, { t: "alert" }>;
type Script = Extract<ServerMsg, { t: "npcScript" }>;
type Shop = Extract<ServerMsg, { t: "shop" }>;
const deltas = (bot: Bot): DeltaEvent[] =>
  bot.inbox.flatMap((m) => (m.t === "delta" ? m.events : []));
const goldOf = (bot: Bot) => bot.inbox.flatMap((m) => (m.t === "inv" ? [m.inv.gold] : [])).at(-1);

describe("the NPC editor", () => {
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
  const say = async (bot: Bot, text: string) => {
    bot.send({ t: "chat", text });
    await settle();
  };
  const turn = async (bot: Bot, dir: "U" | "D" | "L" | "R") => {
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
    server.db.run("UPDATE characters SET x = 6, y = 6 WHERE name = 'Alice'");
    server.db.run("UPDATE characters SET x = 6, y = 4, gold = 1000 WHERE name = 'Bob'");
  });
  afterAll(async () => {
    await server.stop();
  });

  test("Alice puts Amber and a Slime on the map; Bob buys 3 Apples from Amber", async () => {
    alice = await login("Alice");
    bob = await login("Bob");
    await tick(50); // the entry wait before anyone can act
    await turn(alice, "R");
    await turn(bob, "D");
    await say(alice, "/roster 1 Amber");
    await say(alice, "/spawn 1"); // on (7, 6)
    await say(alice, "/roster 2 Slime");
    await turn(alice, "U");
    await say(alice, "/spawn 2"); // on (6, 5), in front of Bob
    expect(
      deltas(bob).flatMap((e) =>
        e.e === "mspawn" ? [[e.monster.name, e.monster.x, e.monster.y]] : [],
      ),
    ).toEqual([
      ["Amber", 7, 6],
      ["Slime", 6, 5],
    ]);
    bob.send({ t: "npcClick", slot: 1 });
    bob.send({ t: "shopList", mode: "buy" });
    bob.send({ t: "buy", line: 4, count: 3 });
    await settle();
    expect(goldOf(bob)).toBe(970);
  });

  test("only an administrator opens the NPC editor; Bob sees Alice leave", async () => {
    bob.clear();
    bob.send({ t: "npcEditOpen" });
    await settle();
    expect(bob.inbox.some((m) => m.t === "npcEditor")).toBe(false);
    alice.send({ t: "npcEditOpen" });
    await alice.waitFor((m) => m.t === "npcEditor");
    await bob.waitFor((m) => m.t === "delta" && m.events.some((e) => e.e === "leave"));
  });

  test("LOAD shows Amber's file with the live stock", async () => {
    alice.clear();
    alice.send({ t: "npcLoad", name: "Amber" });
    const s = await alice.waitFor((m): m is Script => m.t === "npcScript");
    expect(s.text.split("\r")).toEqual([
      "BIO|Name: Amber",
      "BIO|Class: Casino Manager",
      "GLD|107537454",
      "SEL|Apple:10:10028",
      "BUY|Apple:5",
      "SEL|Ale:10:9604",
      "BUY|Ale:5",
      "SEL|Pie:10:5771",
      "BUY|Pie:5",
    ]);
  });

  test("a save naming no item is refused; Bob's open shop stays", async () => {
    bob.send({ t: "npcClick", slot: 1 });
    bob.send({ t: "shopList", mode: "buy" });
    await settle();
    alice.clear();
    bob.clear();
    alice.send({ t: "npcSave", name: "Amber", text: "SEL|Fire:5:10\n" });
    const a = await alice.waitFor((m): m is Alert => m.t === "alert");
    expect(a.text).toBe('The NPC was not saved. Line 1: "Fire" is not an item.');
    expect(bob.inbox.some((m) => m.t === "npcClosed")).toBe(false);
    expect(loadNpcFiles(server.db)).toEqual([]);
  });

  test("a save replaces Amber's file: Bob's shop closes; reopened, it sells at the new price", async () => {
    alice.clear();
    alice.send({
      t: "npcSave",
      name: "Amber",
      text: "BIO|Name: Amber\nGLD|5\nSEL|Apple:7:2\nBUY|Apple:3\n",
    });
    const a = await alice.waitFor((m): m is Alert => m.t === "alert");
    expect(a.text).toBe("NPC has been successfully saved.");
    await bob.waitFor((m) => m.t === "npcClosed");
    expect(npcFileVersions(server.db, "Amber")[0]).toContain("SEL|Apple:10:10028");
    bob.clear();
    bob.send({ t: "npcClick", slot: 1 });
    bob.send({ t: "shopList", mode: "buy" });
    const shop = await bob.waitFor((m): m is Shop => m.t === "shop");
    expect(shop.rows).toEqual([{ line: 3, item: "Apple", price: 7 }]);
    bob.send({ t: "buy", line: 3, count: 1 });
    await settle();
    expect(goldOf(bob)).toBe(963);
    bob.send({ t: "shopCancel" });
  });

  test("the Slime's drops are its INV| lines: INV|5 Gold:1 always drops 5 Gold", async () => {
    alice.clear();
    alice.send({ t: "npcSave", name: "Slime", text: "INV|5 Gold:1\n" });
    await alice.waitFor((m) => m.t === "alert");
    bob.clear();
    bob.send({ t: "attack", seq: 1, held: true });
    await tick(12 * 15);
    bob.send({ t: "attack", seq: 2, held: false });
    await tick(1);
    expect(deltas(bob).some((e) => e.e === "mhit" && e.kill)).toBe(true);
    const drops = deltas(bob).flatMap((e) => (e.e === "gadd" ? [e.item] : []));
    expect(drops.map((g) => [g.name, g.x, g.y])).toEqual([["5 Gold", 6, 5]]);
  });

  test("bug fixed: a chatter line past line 20 saves with no warning, and is said", async () => {
    alice.clear();
    const lines = [...Array.from({ length: 20 }, () => "BIO|Name: Amber"), "RND|Hello"];
    alice.send({ t: "npcSave", name: "Amber", text: lines.join("\n") });
    const a = await alice.waitFor((m): m is Alert => m.t === "alert");
    expect(a.text).toBe("NPC has been successfully saved.");
    expect(server.game.world.npcs.get("amber")?.chatter).toEqual(["Hello"]);
  });

  test("the World Editor opens from the NPC editor; Return To Game puts Alice back", async () => {
    alice.clear();
    bob.clear();
    alice.send({ t: "editOpen" });
    await alice.waitFor((m) => m.t === "editor" && m.editing);
    alice.send({ t: "editClose" });
    const snap = await alice.waitFor(
      (m): m is Extract<ServerMsg, { t: "snapshot" }> => m.t === "snapshot",
    );
    expect([snap.map.name, snap.self.x, snap.self.y]).toEqual(["x1000y992", 6, 6]);
    await bob.waitFor((m) => m.t === "delta" && m.events.some((e) => e.e === "enter"));
    expect(deltas(bob).filter((e) => e.e === "leave")).toEqual([]);
  });
});
