/**
 * Bot script: the playthrough. One server on a file database, one cast, about twenty chapters run
 * in order, then a restart. King (the operator) builds the world in play; Alice, Bob, Carol and
 * Dave arrive and live in it; the next day everything they kept is still there.
 *
 * SQL is used only for character shortcuts that would otherwise take hours of play (each one
 * has a comment saying why); the world itself is built with the World Editor, `/drop`,
 * `/roster` + `/spawn`, `/warp` and the NPC Editor.
 *
 * Tiles (a tile is (x, y), 17 across, 12 down; nobody shares one):
 *   Town x1000y992   start (6,4). Amber (6,3), Cril (7,4), the trainer Smithy (5,4).
 *                    Crafting row y=10: Stove (2,10), Anvil (4,10), Alchemy Lab (6,10),
 *                    Cauldron (8,10); crafters stand on y=11 and are turned north (face).
 *                    Universal Mail (13,5), Message Boards (14,5), Assassin Statue (15,5),
 *                    High Score Statue (16,5), Halo's Newspaper (13,6), Vault (15,6),
 *                    Exit to Plots (9,8). `K2` newspaper-stand ground (10,11).
 *   Wilds x1001y992  east of the Town (the map edge). Trees (3,3), lake (10,5), soil (13,5),
 *                    arena `6P` (3..4, 8..9), airship pads `J2` (6,5) and (9,5), water (7,5).
 *                    `8R` house ground (10..14, 2..4) for the guild hall (hover (12,3)).
 *   Plots x1000y993  layer 1 all `8R` (house ground): Alice's house (4,3) and shop (12,3).
 *                    Reached through the Town's Exit.
 *   Casino x1001y993 Slot Machine (4,4), Blackjack Table (8,4), Checkers Table (12,4). Reached
 *                    by `/warp`.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ADMIN_TEXT,
  banNotice,
  CAST_TEXT,
  type EditorMap,
  LEVEL_UP_TEXT,
  type ServerMsg,
  skillIndex,
  TEXT,
  WEB_TEXT,
} from "@secondstaronline/shared";

import { setRole } from "../src/persistence/accounts.ts";
import { recentAudit } from "../src/persistence/admin.ts";
import { loadAssassinState } from "../src/persistence/assassin.ts";
import { loadBuddies } from "../src/persistence/buddies.ts";
import { loadSpellbook } from "../src/persistence/spells.ts";
import { b64, makePng } from "../tests/helpers/png.ts";
import {
  type Bot,
  centre,
  chats,
  connectBot,
  deltas,
  face,
  idOf,
  lastInv,
  login,
  make,
  place,
  type QueueRng,
  queueRng,
  say,
  settle,
  slotOf,
  startTestServer,
  type TestServer,
  tick,
} from "./harness.ts";

type Editor = Extract<ServerMsg, { t: "editor"; editing: true }>;
const isEditor = (m: ServerMsg): m is Editor => m.t === "editor" && m.editing;
const isSnapshot = (m: ServerMsg) => m.t === "snapshot";
const goldOf = (bot: Bot) => lastInv(bot)?.gold;

const withCode = (row: string, x: number, code: string) => {
  const words = row.split(" ");
  words[x - 1] = code;
  return words.join(" ");
};
/** Sets one tile of an editor map layer (0 = layer 1). */
const paint = (m: EditorMap, layer: 0 | 1 | 2 | 3, x: number, y: number, code: string) => {
  m.layers[layer][y - 1] = withCode(m.layers[layer][y - 1] ?? "", x, code);
};

const dbPath = join(tmpdir(), `sso-playthrough-${process.pid}.sqlite`);
/** What the players should still have after the restart: filled in as the chapters run. */
const kept: { what: string; check: () => void | Promise<void> }[] = [];
let failedAt: string | null = null;

describe("the playthrough", () => {
  let server: TestServer;
  let rng: QueueRng;
  let king: Bot;
  let alice: Bot;
  let bob: Bot;
  let carol: Bot;
  let dave: Bot;
  let seq = 0;

  const t = (n: number) => tick(server, n);
  const turn = async (bot: Bot, dir: "L" | "R" | "U" | "D") => {
    bot.send({ t: "step", seq: ++seq, dir, turn: true });
    await t(1);
  };
  const clearAll = () => {
    for (const b of [king, alice, bob, carol, dave]) {
      if (b) {
        lastInv(b); // remember the bag before the inbox is emptied
      }
      b?.clear();
    }
  };
  /** One chapter: skipped once an earlier one failed, so one break gives one real failure. */
  const chapter = (name: string, fn: () => Promise<void>) =>
    test(name, async () => {
      if (failedAt) {
        throw new Error(`skipped: chapter "${failedAt}" failed`);
      }
      try {
        clearAll();
        await fn();
      } catch (e) {
        failedAt = name;
        throw e;
      }
    }, 30_000);
  /** King loads a map in the World Editor, changes it and saves it. */
  const editMap = async (mx: number, my: number, fn: (m: EditorMap) => void) => {
    king.clear();
    king.send({ t: "editLoad", mx, my });
    const ed = await king.waitFor(isEditor);
    const m = structuredClone(ed.map);
    fn(m);
    king.clear();
    king.send({ t: "editSave", map: m });
    await king.waitFor((x) => x.t === "alert" && x.text === TEXT.mapSaved);
  };
  const who = (name: string) => {
    const p = [...server.game.world.players.values()].find((x) => x.name === name);
    if (!p) {
      throw new Error(`${name} is not in`);
    }
    return p;
  };
  /** King warps a player (the admin tool, so no walking is needed). */
  const warp = async (name: string, map: string, x: number, y: number) => {
    const bot = { Alice: alice, Bob: bob, Carol: carol, Dave: dave }[name];
    if (bot) {
      lastInv(bot);
    }
    bot?.clear();
    await say(king, `/warp ${name} ${map} ${x} ${y}`);
    await bot?.waitFor(isSnapshot);
    bot?.send({ t: "mapReady" });
    await settle();
  };

  beforeAll(() => {
    rng = queueRng();
    server = startTestServer({ rng, dbPath });
  });
  afterAll(async () => {
    for (const b of [king, alice, bob, carol, dave]) {
      b?.close();
    }
    await server?.stop();
    rmSync(dbPath, { force: true });
  });

  chapter("1 Operator builds the world", async () => {
    const maker = await connectBot(server.wsUrl);
    maker.send(make("King", 1));
    await maker.waitFor((m) => m.t === "created");
    maker.close();
    // The only role write: there is no in-game way to make the first immortal.
    setRole(server.db, (await accountOf("King")) ?? "", "immortal", "2026-11-08T00:00:00.000Z");
    king = await login(server, "King");
    expect(king.inbox.some((m) => m.t === "role" && m.role === "immortal")).toBe(true);

    // NPC Editor: Smithy becomes a trainer (the file is the NPC).
    king.send({ t: "npcEditOpen" });
    await king.waitFor((m) => m.t === "npcEditor");
    king.clear();
    king.send({
      t: "npcSave",
      name: "Smithy",
      text: ["BIO|Name: Smithy", "BIO|Class: Trainer", "TRN|Grunt:100"].join("\r"),
    });
    const saved = await king.waitFor((m) => m.t === "alert");
    expect(saved).toEqual({ t: "alert", text: "NPC has been successfully saved." });

    // World Editor: the four maps.
    king.send({ t: "editOpen" });
    await king.waitFor(isEditor);
    await editMap(1000, 992, (m) => {
      m.header = "Town";
      m.exit1 = { mx: 1000, my: 993, x: 3, y: 3 };
      paint(m, 0, 10, 11, "K2"); // where a Newspaper Kit may stand a newspaper
      m.items = [
        { name: "Stove", x: 2, y: 10 },
        { name: "Anvil", x: 4, y: 10 },
        { name: "Alchemy Lab", x: 6, y: 10 },
        { name: "Cauldron", x: 8, y: 10 },
        { name: "Universal Mail", x: 13, y: 5 },
        { name: "Message Boards", x: 14, y: 5 },
        { name: "Assassin Statue", x: 15, y: 5 },
        { name: "High Score Statue", x: 16, y: 5 },
        { name: "Halo's Newspaper", x: 13, y: 6 },
        { name: "Vault", x: 15, y: 6 },
        { name: "Exit", x: 9, y: 8 },
      ];
    });
    await editMap(1001, 992, (m) => {
      m.header = "Wilds";
      m.flags = { canFight: "X", fctSpwn: "X", isIndoors: "X", canPvp: "X" };
      m.layers[0] = m.layers[0].map((r) => r.replaceAll("H1", "G1"));
      paint(m, 1, 3, 3, "S3");
      paint(m, 0, 10, 5, "W1");
      paint(m, 1, 13, 5, "TL");
      for (const [x, y] of [
        [3, 8],
        [4, 8],
        [3, 9],
        [4, 9],
      ] as const) {
        paint(m, 0, x, y, "6P");
      }
      paint(m, 0, 6, 5, "J2");
      paint(m, 0, 9, 5, "J2");
      paint(m, 0, 7, 5, "W1");
      // A patch of house ground for the guild hall (hover (12,3); see chapter 13).
      for (let y = 2; y <= 4; y++) {
        for (let x = 10; x <= 14; x++) {
          paint(m, 0, x, y, "8R");
        }
      }
    });
    await editMap(1000, 993, (m) => {
      m.header = "Plots";
      m.layers[0] = m.layers[0].map((r) => r.replaceAll("H1", "8R"));
    });
    await editMap(1001, 993, (m) => {
      m.header = "Casino";
      m.layers[0] = m.layers[0].map((r) => r.replaceAll("H1", "G1"));
      m.items = [
        { name: "Slot Machine", x: 4, y: 4 },
        { name: "Blackjack Table", x: 8, y: 4 },
        { name: "Checkers Table", x: 12, y: 4 },
      ];
    });
    king.send({ t: "editLoad", mx: 1000, my: 992 });
    await king.waitFor(isEditor);
    king.clear();
    king.send({ t: "editClose" });
    await king.waitFor(isSnapshot);
    king.send({ t: "mapReady" });
    await t(50); // the entry wait before anyone can act

    // Settings: one harmless value.
    king.clear();
    king.send({ t: "settingsOpen" });
    await king.waitFor((m) => m.t === "settings");
    king.send({ t: "settingsSave", values: { jailMinutes: 40 } });
    await king.waitFor((m) => m.t === "settingsResult" && m.ok);
    king.send({ t: "settingsClose" });
    expect(server.game.settings.jailMinutes).toBe(40);

    // The NPCs, in front of King at the start tile.
    await say(king, "/roster 1 Amber");
    await say(king, "/roster 2 Cril");
    await say(king, "/roster 3 Smithy");
    face(server, "King", "N"); // staging: 1.6 logs in facing south
    await say(king, "/spawn 1"); // north (6,3)
    await turn(king, "R");
    await say(king, "/spawn 2"); // east (7,4)
    await turn(king, "L");
    await say(king, "/spawn 3"); // west (5,4)
    await turn(king, "U");
    expect(chats(king)).toContain("Spawned a Amber in roster slot 1.");
    const here = who("King").map;
    expect(here.ground.map((g) => g.item)).toEqual(
      expect.arrayContaining(["Stove", "Anvil", "Alchemy Lab", "Universal Mail", "Vault"]),
    );
  });

  async function accountOf(name: string): Promise<string | undefined> {
    return server.db
      .query<{ account_id: string }, [string]>("SELECT account_id FROM characters WHERE name = ?")
      .get(name)?.account_id;
  }

  chapter("2 Arrival", async () => {
    const maker = await connectBot(server.wsUrl);
    const classes: [string, 1 | 2][] = [
      ["Alice", 1],
      ["Bob", 2],
      ["Carol", 1],
      ["Dave", 2],
    ];
    for (const [name, cls] of classes) {
      maker.send(make(name, cls));
      expect(await maker.waitFor((m) => m.t === "created")).toEqual({
        t: "created",
        text: TEXT.created,
      });
      maker.clear();
    }
    maker.close();
    alice = await login(server, "Alice");
    bob = await login(server, "Bob");
    carol = await login(server, "Carol");
    dave = await login(server, "Dave");
    await t(2);
    for (const [bot, name] of [
      [alice, "Alice"],
      [bob, "Bob"],
      [carol, "Carol"],
      [dave, "Dave"],
    ] as const) {
      const snap = bot.inbox.find(isSnapshot);
      expect(snap?.t === "snapshot" && [snap.map.name, snap.self.x, snap.self.y]).toEqual([
        "x1000y992",
        6,
        4,
      ]);
      expect(
        lastInv(bot)?.bag.some((l) => l !== null),
        `${name} has a starting kit`,
      ).toBe(true);
    }
  });

  chapter("3 Talk", async () => {
    // Everyone is on (6,4); King warps them to the east side of the town to talk.
    await t(50);
    await say(alice, "hi there");
    expect(chats(alice)).toEqual(['Alice says "hi there"']);
    expect(chats(bob)).toEqual(['Alice says "hi there"']);
    await t(60); // /me shares the chat cooldown
    await say(alice, "/me waves");
    expect(chats(bob).at(-1)).toMatch(/waves/);
    clearAll();
    await t(60);
    await say(bob, "'hello world");
    for (const b of [alice, bob, carol, dave, king]) {
      expect(chats(b)).toEqual(['Bob broadcasts "hello world"']);
    }
    await say(bob, "'too soon");
    expect(chats(bob).at(-1)).toMatch(/You cannot broadcast yet/);
    clearAll();
    await say(carol, "who");
    expect(carol.inbox.find((m) => m.t === "who")).toEqual({
      t: "who",
      names: ["King", "Alice", "Bob", "Carol", "Dave"],
    });
    expect(chats(carol)).toEqual(["There are 5 players logged on."]);

    // Push (random(25) = 1 per standing player on the target tile): Dave shoves Carol; then
    // walks into the tile King, Alice and Bob stand on, and King (an immortal) is not shoved.
    carol.send({ t: "step", seq: ++seq, dir: "D", turn: false });
    await t(20);
    clearAll();
    rng.queue(25, 1);
    dave.send({ t: "step", seq: ++seq, dir: "D", turn: false });
    await t(1);
    expect(chats(carol)).toEqual(["Dave shoves you out of the way."]);
    await t(20);
    dave.send({ t: "step", seq: ++seq, dir: "D", turn: false });
    await t(20);
    clearAll();
    rng.queue(25, 1, 1, 1);
    dave.send({ t: "step", seq: ++seq, dir: "U", turn: false });
    await t(1);
    expect(chats(alice).concat(chats(bob))).toContain("Dave shoves you out of the way.");
    expect(chats(king)).toEqual([]);
    rng.reset();
    await t(20);
  });

  const here = (bot: Bot) => {
    const snap = [...bot.inbox].reverse().find((m) => m.t === "snapshot");
    return snap?.t === "snapshot" ? [snap.map.name, snap.self.x, snap.self.y] : null;
  };

  chapter("4 Out of town", async () => {
    // Alice walks off the east edge into the Wilds the operator built.
    await warp("Alice", "x1000y992", 17, 4);
    alice.clear();
    alice.send({ t: "step", seq: ++seq, dir: "R", turn: false });
    await t(2);
    await alice.waitFor(isSnapshot);
    alice.send({ t: "mapReady" });
    expect(here(alice)?.[0]).toBe("x1001y992");
    await t(50);
    // Bob walks onto the Town's Exit and lands on the Plots map; the edge takes him back.
    await warp("Bob", "x1000y992", 9, 9);
    bob.clear();
    bob.send({ t: "step", seq: ++seq, dir: "U", turn: false });
    await t(20);
    await bob.waitFor(isSnapshot);
    bob.send({ t: "mapReady" });
    expect(here(bob)).toEqual(["x1000y993", 3, 3]);
    await t(50);
    bob.clear();
    for (let i = 0; i < 3; i++) {
      bob.send({ t: "step", seq: ++seq, dir: "U", turn: false });
      await t(20);
    }
    await bob.waitFor(isSnapshot);
    bob.send({ t: "mapReady" });
    expect(here(bob)?.[0]).toBe("x1000y992");
    await t(50);
  });

  /** King warps himself (the admin tool). */
  const kingGo = async (map: string, x: number, y: number) => {
    king.clear();
    await say(king, `/warp King ${map} ${x} ${y}`);
    await king.waitFor(isSnapshot);
    king.send({ t: "mapReady" });
    await settle();
  };
  /** Logs a bot out the way a player does and waits for the socket to close. */
  const logout = async (bot: Bot) => {
    bot.send({ t: "logout" });
    await bot.closed;
    await settle(60);
  };
  const hits = (bot: Bot) => deltas(bot).filter((e) => e.e === "mhit");
  /** Holds the attack key until a kill shows, 15 frames at a time. */
  const fightUntilKill = async (bot: Bot) => {
    bot.send({ t: "attack", seq: ++seq, held: true });
    for (let i = 0; i < 40 && !hits(bot).some((e) => e.e === "mhit" && e.kill); i++) {
      await t(15);
    }
    bot.send({ t: "attack", seq: ++seq, held: false });
    await t(1);
  };

  chapter("5 Fight and level", async () => {
    // King sets the Wilds roster to Slime and leaves again (he would change the spawn gate).
    await kingGo("x1001y992", 2, 2);
    await say(king, "/roster 1 Slime");
    expect(chats(king)).toContain("Roster slot 1 is now Slime.");
    await kingGo("x1000y992", 6, 4);
    // SQL shortcut: 5 exp short of level 2, so one Slime is a level (the grind is not tested).
    await logout(alice);
    server.db.run("UPDATE characters SET exp = exp_needed - 5 WHERE name = 'Alice'");
    place(server.db, "Alice", "x1001y992", 12, 9, "N");
    alice = await login(server, "Alice");
    // Staging: 1.6 logs in facing south; the fight needs her north.
    face(server, "Alice", "N");
    await warp("Bob", "x1001y992", 14, 9);
    await t(50);
    clearAll();
    // Two players on the Wilds: the gate is 1/120; tile (12,8); random(5) = 1; facing S.
    rng.queue(120, 1);
    rng.queue(17, 12);
    rng.queue(12, 8);
    rng.queue(5, 1);
    rng.queue(4, 2);
    await t(1);
    expect(deltas(alice).some((e) => e.e === "mspawn")).toBe(true);
    expect(deltas(bob).some((e) => e.e === "mspawn")).toBe(true);
    clearAll();
    const gold0 = goldOf(alice) ?? 0;
    rng.queue(4, 1); // the loot line
    await fightUntilKill(alice);
    expect(chats(alice)).toContain(LEVEL_UP_TEXT);
    expect(hits(bob).some((e) => e.e === "mhit" && e.kill)).toBe(true);
    const drop = deltas(alice).flatMap((e) => (e.e === "gadd" ? [e.item] : []));
    expect(drop.length).toBeGreaterThan(0);
    for (const g of drop) {
      alice.send({ t: "pickup", id: g.id });
    }
    await t(1);
    expect(goldOf(alice) ?? 0).toBeGreaterThan(gold0);
    rng.reset();
    // Clean up: the Wilds roster is empty again before any later chapter queues a spawn roll.
    await kingGo("x1001y992", 2, 2);
    await say(king, "/roster 1 clear");
    await kingGo("x1000y992", 6, 4);
    kept.push({
      what: "Alice: level 2",
      check: () => {
        expect(lastInv(alice) && who("Alice").char.vitals.level).toBeGreaterThanOrEqual(2);
      },
    });
  });

  chapter("6 Die and respawn", async () => {
    // Alice kills Dave on the Wilds (PvP is on there); Dave drops one item and comes back at
    // the Town's respawn tile; the death lock ends and Alice is wanted for the murder.
    // SQL shortcut: Dave is a Warrior with the power a head counts for, and both have the 90 HP
    // a faction asks; earning either takes hours. Chapter 12 uses the head.
    await logout(alice);
    await logout(dave);
    server.db.run("UPDATE characters SET faction = 2, faction_count = 212000 WHERE name = 'Dave'");
    server.db.run("UPDATE characters SET hp_max = 90, hp = 90 WHERE name IN ('Alice', 'Dave')");
    alice = await login(server, "Alice");
    dave = await login(server, "Dave");
    await warp("Alice", "x1001y992", 6, 8);
    await warp("Dave", "x1001y992", 7, 8);
    await turn(alice, "R");
    alice.send({ t: "equip", slot: slotOf(alice, "Knife") });
    await t(60); // the attack timers settle after a warp
    clearAll();
    alice.send({ t: "attack", seq: ++seq, held: true });
    for (let i = 0; i < 60 && !dave.inbox.some(isSnapshot); i++) {
      await t(15);
    }
    alice.send({ t: "attack", seq: ++seq, held: false });
    await t(1);
    expect(deltas(dave).some((e) => e.e === "phit" && e.splat)).toBe(true);
    const snap = dave.inbox.find(isSnapshot);
    expect(snap?.t === "snapshot" && [snap.map.name, snap.self.x, snap.self.y]).toEqual([
      "x1000y992",
      5,
      5,
    ]);
    dave.send({ t: "mapReady" });
    await t(40); // the end of the death lock
    for (const b of [alice, dave, carol, king]) {
      expect(chats(b)).toContain("*** Dave was just killed by Alice.");
    }
    expect(chats(alice)).toContain("*** You are now wanted for the murder of Dave.");
    // Dave's Warrior's Head and an item lie on the tile he died on; Alice picks up the head.
    const piles = deltas(alice).flatMap((e) => (e.e === "gadd" ? [e.item] : []));
    expect(piles.map((g) => g.name)).toContain("Warrior's Head");
    alice.send({ t: "pickup", id: piles.find((g) => g.name === "Warrior's Head")?.id ?? "" });
    await t(1);
    expect(slotOf(alice, "Warrior's Head")).toBeGreaterThan(0);
  });

  /**
   * King puts `item` on the ground (`/drop`, an operator tool) next to `name`, who picks it up:
   * the only way gold and crystals enter a bag without SQL.
   */
  const supply = async (bot: Bot, name: string, item: string) => {
    await kingGo("x1000y992", 16, 12);
    await turn(king, "U");
    await warp(name, "x1000y992", 15, 11);
    await t(50);
    bot.clear();
    await say(king, `/drop ${item}`); // lands on (16, 11)
    await t(1);
    const pile = deltas(bot).flatMap((e) => (e.e === "gadd" ? [e.item] : []))[0];
    expect(pile, `${item} lies on the ground`).toBeDefined();
    bot.send({ t: "pickup", id: pile?.id ?? "" });
    await t(1);
    lastInv(bot);
    await kingGo("x1000y992", 6, 4);
  };

  chapter("7 Items", async () => {
    // Equip the Knife; eat an Apple; drop and take back; give to Bob.
    await warp("Alice", "x1000y992", 3, 6);
    await warp("Bob", "x1000y992", 4, 6);
    await turn(alice, "R");
    await t(50);
    alice.clear();
    bob.clear();
    expect(lastInv(alice)?.equip.weapon).toBe("Knife"); // wielded for the fight in chapter 6
    alice.send({ t: "unequip", slot: "LeftHand" });
    await t(41);
    alice.send({ t: "equip", slot: slotOf(alice, "Knife") });
    await t(1);
    expect(lastInv(alice)?.equip.weapon).toBe("Knife");
    expect(deltas(bob)).toContainEqual(
      expect.objectContaining({ e: "look", equip: expect.objectContaining({ weapon: "Knife" }) }),
    );
    alice.clear();
    // Still at the starting hunger, Alice is stuffed: the Apple is refused and kept.
    const kept = lastInv(alice)?.bag.find((l) => l?.item === "Apple")?.qty ?? 0;
    alice.send({ t: "use", slot: slotOf(alice, "Apple") });
    await t(1);
    expect(chats(alice)).toEqual(["You're stuffed!"]);
    expect(lastInv(alice)?.bag.find((l) => l?.item === "Apple")?.qty ?? 0).toBe(kept);
    // Give the Apple to Bob: the give line on both sides; he gets it 60 frames later.
    const apples = lastInv(bob)?.bag.find((l) => l?.item === "Apple")?.qty ?? 0;
    alice.clear();
    bob.clear();
    alice.send({ t: "give", slot: slotOf(alice, "Apple") });
    await t(1);
    expect(chats(alice)).toEqual(["*** You offer the Apple to Bob."]);
    await t(60);
    expect(chats(bob)).toEqual(["Alice is giving you a Apple."]);
    expect(lastInv(bob)?.bag.find((l) => l?.item === "Apple")?.qty ?? 0).toBeGreaterThan(apples);
    // Drop and take back: the Knife is equipped, so drop what is left of the bag's first line.
    const slot = (lastInv(alice)?.bag.findIndex((l) => l !== null) ?? -1) + 1;
    expect(slot).toBeGreaterThan(0);
    const name = lastInv(alice)?.bag[slot - 1]?.item ?? "";
    alice.clear();
    alice.send({ t: "drop", slot });
    await t(1);
    const lying = deltas(alice).flatMap((e) => (e.e === "gadd" ? [e.item] : []));
    expect(lying.map((g) => g.name)).toContain(name);
    alice.send({ t: "pickup", id: lying[0]?.id ?? "" });
    await t(1);
    expect(slotOf(alice, name)).toBeGreaterThan(0);
  });

  chapter("7b Gold and crystals to the faced player", async () => {
    await supply(alice, "Alice", "500 gold");
    expect(goldOf(alice)).toBeGreaterThanOrEqual(500);
    await supply(alice, "Alice", "5 White Crystals");
    expect(slotOf(alice, "White Crystals") || slotOf(alice, "5 White Crystals")).toBeGreaterThan(0);
    await warp("Alice", "x1000y992", 3, 6);
    await warp("Bob", "x1000y992", 4, 6);
    await turn(alice, "R");
    await t(50);
    const a0 = goldOf(alice) ?? 0;
    const b0 = goldOf(bob) ?? 0;
    alice.clear();
    bob.clear();
    alice.send({ t: "gold", n: 100 });
    await t(1);
    expect(chats(alice)).toEqual(["*** Offering the 100 gold to Bob."]);
    expect(chats(bob)).toEqual(["Alice is giving you 100 Gold."]);
    await t(60);
    expect(goldOf(alice)).toBe(a0 - 100);
    expect(goldOf(bob)).toBe(b0 + 100);
    alice.clear();
    bob.clear();
    const stack = lastInv(alice)?.bag.findIndex((l) => l?.item.includes("Crystals")) ?? -1;
    alice.send({ t: "crystals", slot: stack + 1, n: 2, mode: "give" });
    await t(1);
    expect(chats(alice)).toEqual(["*** Offering the 2 White Crystals to Bob."]);
    expect(chats(bob)).toEqual(["Alice is giving you 2 White Crystals."]);
    await t(60);
    expect(lastInv(bob)?.bag.some((l) => l?.item.includes("Crystals"))).toBe(true);
  });

  /** Opens an NPC's shop list in `mode` and returns its rows. */
  const shopRows = async (bot: Bot, slot: number, mode: "buy" | "sell") => {
    bot.clear();
    bot.send({ t: "npcClick", slot });
    await settle();
    bot.send({ t: "shopList", mode });
    const shop = await bot.waitFor((m) => m.t === "shop" && m.mode === mode);
    return shop.t === "shop" ? shop.rows : [];
  };
  const countOf = (bot: Bot, item: string) =>
    lastInv(bot)?.bag.reduce((n, l) => n + (l?.item === item ? l.qty : 0), 0) ?? 0;

  chapter("8 Money", async () => {
    // Bob (100 gold from chapter 7) at the hub (6,4): Amber north, Cril east.
    await warp("Bob", "x1000y992", 6, 4);
    await warp("Carol", "x1000y992", 7, 6);
    await t(50);
    const rows = await shopRows(bob, 1, "buy");
    const apple = rows.find((r) => r.item === "Apple");
    expect(apple, "Amber sells Apples").toBeDefined();
    const g0 = goldOf(bob) ?? 0;
    const apples0 = countOf(bob, "Apple");
    bob.clear();
    bob.send({ t: "buy", line: apple?.line ?? 0, count: 3 });
    await bob.waitFor((m) => m.t === "processed");
    await settle();
    expect(goldOf(bob)).toBe(g0 - 3 * (apple?.price ?? 0));
    expect(countOf(bob, "Apple")).toBe(apples0 + 3);
    bob.send({ t: "shopCancel" });
    const sellRows = await shopRows(bob, 1, "sell");
    const sale = sellRows.find((r) => r.item === "Apple");
    expect(sale, "Amber buys Apples").toBeDefined();
    const g1 = goldOf(bob) ?? 0;
    bob.clear();
    bob.send({ t: "sell", line: sale?.line ?? 0, count: 1 });
    await bob.waitFor((m) => m.t === "processed");
    await settle();
    expect(chats(bob)).toEqual(['Amber says "Thanks for the business!"']);
    expect(goldOf(bob)).toBe(g1 + (sale?.price ?? 0));
    bob.send({ t: "shopCancel" });

    // Cril's bank.
    const purse = goldOf(bob) ?? 0;
    bob.clear();
    await say(bob, "/balance");
    await say(bob, "/deposit 40");
    await say(bob, "/withdraw 10");
    expect(chats(bob)).toEqual([
      "You have 0 gold in the bank.",
      "You deposit 40 gold. You now have 40 gold in the bank.",
      "You withdraw 10 gold. You now have 30 gold in the bank.",
    ]);
    await t(1);
    expect(goldOf(bob)).toBe(purse - 30);
    kept.push({
      what: "Bob: 30 gold in the bank",
      check: async () => {
        await warp("Bob", "x1000y992", 6, 4);
        bob.clear();
        await say(bob, "/balance");
        expect(chats(bob)).toEqual(["You have 30 gold in the bank."]);
      },
    });

    // The personal vault: Alice puts an Apple (from King) in it and leaves it there.
    await supply(alice, "Alice", "Apple");
    await warp("Alice", "x1000y992", 15, 7);
    await turn(alice, "U");
    await t(50);
    const stored = "Apple";
    alice.clear();
    alice.send({ t: "drop", slot: slotOf(alice, stored) });
    await settle();
    expect(chats(alice)).toEqual([`You drop a ${stored} into the container.`]);
    alice.send({ t: "action" });
    expect(await alice.waitFor((m) => m.t === "vault")).toEqual({
      t: "vault",
      items: [stored],
      open: true,
    });
    alice.send({ t: "shopCancel" });
    kept.push({
      what: `Alice: ${stored} in her vault`,
      check: async () => {
        await warp("Alice", "x1000y992", 15, 7);
        await turn(alice, "U");
        await t(50);
        alice.clear();
        alice.send({ t: "action" });
        expect(await alice.waitFor((m) => m.t === "vault")).toEqual({
          t: "vault",
          items: [stored],
          open: true,
        });
        alice.send({ t: "shopCancel" });
      },
    });

    // A trade, Bob (10 gold) for Carol's Apple.
    const carolId = idOf(server.db, "Carol");
    const bobGold = goldOf(bob) ?? 0;
    const carolApples = countOf(carol, "Apple");
    const bobApples = countOf(bob, "Apple");
    bob.clear();
    carol.clear();
    bob.send({ t: "tradeOpen", id: carolId });
    await bob.waitFor((m) => m.t === "trade" && m.trade !== null);
    bob.send({ t: "tradeOffer", gold: 10, items: [] });
    await carol.waitFor((m) => m.t === "trade" && m.trade?.theirs?.gold === 10);
    const slot = slotOf(carol, "Apple");
    carol.send({ t: "tradeOffer", gold: 0, items: [{ slot, qty: 1 }] });
    await bob.waitFor((m) => m.t === "trade" && m.trade?.theirs?.items[0]?.item === "Apple");
    // Both accept; the second acceptance settles it.
    carol.send({ t: "tradeAccept" });
    bob.send({ t: "tradeAccept" });
    await carol.waitFor((m) => m.t === "inv");
    await settle();
    expect(goldOf(bob)).toBe(bobGold - 10);
    expect(goldOf(carol)).toBe(10);
    expect(countOf(bob, "Apple")).toBe(bobApples + 1);
    expect(countOf(carol, "Apple")).toBe(carolApples - 1);
  });

  chapter("9 Magic", async () => {
    // Bob learns Fireball from a book King drops, casts it with a crystal, then has none.
    // SQL shortcut: the book wants Dex 20 and a spell costs SP, and levelling both takes hours.
    await logout(bob);
    server.db.run("UPDATE characters SET dex = 20, sp = 200, sp_max = 200 WHERE name = 'Bob'");
    bob = await login(server, "Bob");
    await supply(bob, "Bob", "Fireball Book");
    await supply(bob, "Bob", "2 Red Crystals");
    await warp("Bob", "x1000y992", 6, 8);
    await t(50);
    bob.clear();
    bob.send({ t: "use", slot: slotOf(bob, "Fireball Book") });
    await t(1);
    expect(chats(bob)).toContain("You have learned the spell of Fireball.");
    expect(slotOf(bob, "Fireball Book")).toBe(0);
    await t(20);
    const sp0 = who("Bob").char.vitals.sp;
    const at = centre(8, 8);
    bob.clear();
    carol.clear();
    bob.send({ t: "cast", spell: "Fireball", x: at.x, y: at.y });
    await t(2);
    expect(deltas(carol).some((e) => e.e === "fx" && e.name.startsWith("Fireball"))).toBe(true);
    expect(slotOf(bob, "Red Crystals")).toBe(0);
    expect(who("Bob").char.vitals.sp).toBeLessThan(sp0);
    await t(20);
    bob.clear();
    bob.send({ t: "cast", spell: "Fireball", x: at.x, y: at.y });
    await t(1);
    expect(chats(bob)).toEqual([CAST_TEXT.crystals("Fireball")]);
    kept.push({
      what: "Bob: knows Fireball",
      check: () => {
        expect(loadSpellbook(server.db, idOf(server.db, "Bob"))).toContain("Fireball");
      },
    });
  });

  /** Holds the attack key until `n` of the bot's own swings have gone out. */
  const swing = async (bot: Bot, n: number) => {
    const who = idOf(server.db, [alice, bob, carol, dave].indexOf(bot) >= 0 ? nameOf(bot) : "");
    const swings = () => deltas(bot).filter((e) => e.e === "swing" && e.id === who).length;
    const start = swings();
    bot.send({ t: "attack", seq: ++seq, held: true });
    await settle(10);
    for (let i = 0; i < 800 && swings() - start < n; i++) {
      server.clock.advance(50);
      server.tickNow(1);
      await settle(2);
    }
    bot.send({ t: "attack", seq: ++seq, held: false });
    await t(1);
  };
  const nameOf = (bot: Bot) =>
    ["Alice", "Bob", "Carol", "Dave"][[alice, bob, carol, dave].indexOf(bot)] ?? "";
  const tiles = (bot: Bot) => deltas(bot).filter((e) => e.e === "tile");
  const grounded = (bot: Bot) =>
    deltas(bot).flatMap((e) => (e.e === "gadd" ? [[e.item.name, e.item.x, e.item.y]] : []));

  chapter("10 Gathering", async () => {
    // SQL shortcut: gathering skill levels that would take hours; the logins pick them up.
    for (const b of [alice, carol]) {
      await logout(b);
    }
    const setSkill = (name: string, skill: string, value: number) =>
      server.db.run(
        "INSERT OR REPLACE INTO character_skills (character_id, skill, value) VALUES (?, ?, ?)",
        [idOf(server.db, name), skillIndex(skill) + 1, value],
      );
    setSkill("Alice", "Lumberjacking", 5);
    setSkill("Carol", "Fishing", 20);
    setSkill("Carol", "Cooking", 1);
    setSkill("Carol", "Farming", 5);
    alice = await login(server, "Alice");
    carol = await login(server, "Carol");

    // Alice fells the Wilds tree at (3,3) with an Axe King drops, standing on (3,4).
    await supply(alice, "Alice", "Axe");
    await warp("Alice", "x1001y992", 3, 4);
    await warp("Bob", "x1001y992", 5, 4);
    await turn(alice, "U");
    await t(50);
    alice.send({ t: "unequip", slot: "LeftHand" }); // the Knife from chapter 7
    await t(1);
    alice.send({ t: "equip", slot: slotOf(alice, "Axe") });
    await t(1);
    expect(lastInv(alice)?.equip.weapon).toBe("Axe");
    clearAll();
    rng.fix(3, 1); // the logs roll (hunger's random(3) takes the 1 too)
    rng.fix(12, 1); // LumberjackImp
    await swing(alice, 18);
    rng.fix(3, null);
    rng.fix(12, null);
    expect(grounded(bob)).toContainEqual(["Logs", 3, 3]);
    expect(tiles(bob)).toContainEqual({ e: "tile", layer: 2, x: 3, y: 3, code: "P3" });
    expect(chats(alice)).toContain("You have advanced in the art of Lumberjacking!");
    alice.send({ t: "action" });
    await t(1);
    expect(slotOf(alice, "Logs")).toBeGreaterThan(0);

    // Carol casts a Fishing Pole into the lake at (10,5) from (10,6) and catches a Trout.
    await supply(carol, "Carol", "Fishing Pole");
    await warp("Carol", "x1001y992", 10, 6);
    await turn(carol, "U");
    await t(50);
    carol.send({ t: "equip", slot: slotOf(carol, "Fishing Pole") });
    await t(1);
    clearAll();
    rng.fix(28, 1); // FishCheck at Fishing 20
    await swing(carol, 1);
    await t(2);
    rng.fix(28, null);
    expect(deltas(bob).some((e) => e.e === "fx" && e.name === "Fishing")).toBe(true);
    const trout = deltas(carol).flatMap((e) => (e.e === "gadd" ? [e.item] : []));
    expect(trout.map((g) => g.name)).toContain("Trout");
    await t(41);
    carol.send({ t: "pickup", id: trout.find((g) => g.name === "Trout")?.id ?? "" });
    await t(1);
    expect(slotOf(carol, "Trout")).toBeGreaterThan(0);
  });

  chapter("10a Farming", async () => {
    // Carol tills the Wilds soil (13,5) with a Hoe, plants Seeds, waters them, and the corn drops.
    await supply(carol, "Carol", "Hoe");
    await supply(carol, "Carol", "Seeds");
    await supply(carol, "Carol", "Watering Bucket");
    await warp("Carol", "x1001y992", 13, 6);
    await turn(carol, "U");
    await t(50);
    carol.send({ t: "unequip", slot: "LeftHand" }); // the Fishing Pole
    await t(1);
    carol.send({ t: "equip", slot: slotOf(carol, "Hoe") });
    await t(1);
    expect(lastInv(carol)?.equip.weapon).toBe("Hoe");
    clearAll();
    await swing(carol, 18);
    expect(tiles(carol)).toContainEqual({ e: "tile", layer: 2, x: 13, y: 5, code: "SL" });
    carol.send({ t: "use", slot: slotOf(carol, "Seeds") });
    await t(1);
    expect(chats(carol)).toContain("You plant the seeds.");
    expect(tiles(carol)).toContainEqual({ e: "tile", layer: 2, x: 13, y: 5, code: "UL" });
    carol.send({ t: "unequip", slot: "LeftHand" });
    await t(1);
    carol.send({ t: "equip", slot: slotOf(carol, "Watering Bucket") });
    await t(1);
    await swing(carol, 18);
    expect(tiles(carol)).toContainEqual({ e: "tile", layer: 2, x: 13, y: 5, code: "XL" });
    // A produce roll on (13,5): random(600) = 9 runs only `CheckHoles` and `DoVeg`.
    carol.clear();
    rng.fix(600, 9);
    rng.fix(17, 13);
    rng.fix(12, 5);
    await t(1);
    rng.fix(600, null);
    rng.fix(17, null);
    rng.fix(12, null);
    expect(grounded(carol)).toContainEqual(["Corn", 13, 5]);
  });

  /** Stands a player on the Town's crafting row facing a fixture and lets the entry wait pass. */
  const atStation = async (bot: Bot, x: number) => {
    await warp(nameOf(bot), "x1000y992", x, 11);
    await turn(bot, "U");
    await t(50);
  };

  chapter("10b Crafts", async () => {
    // Everyone gets what they need from King (/drop) and goes to a station on row 10.
    await supply(alice, "Alice", "Saw");
    await supply(dave, "Dave", "Potion Bottle");
    await supply(dave, "Dave", "2 Red Crystals");
    await supply(dave, "Dave", "Red Sand");
    await supply(bob, "Bob", "Chunk of Star");
    await supply(bob, "Bob", "Silver Crown");
    await atStation(alice, 12); // anywhere: building needs only the Saw and the Logs
    await atStation(carol, 2); // Stove
    await atStation(dave, 6); // Alchemy Lab
    await atStation(bob, 8); // Cauldron
    // Alice builds a Chair (the Axe stays in her left hand; the Saw goes to the right).
    alice.send({ t: "equip", slot: slotOf(alice, "Saw") });
    await t(1);
    expect(lastInv(alice)?.equip.offHand).toBe("Saw");
    dave.send({ t: "equip", slot: slotOf(dave, "Red Sand") });
    await t(1);
    clearAll();
    alice.send({ t: "craft", slot: slotOf(alice, "Logs") });
    carol.send({ t: "craft", slot: slotOf(carol, "Trout") });
    dave.send({ t: "craft", slot: slotOf(dave, "Potion Bottle") });
    await t(1);
    expect(chats(alice)).toContain("You begin to build something...");
    expect(chats(carol)).toContain("You begin to cook the Trout.");
    expect(chats(dave)).toContain("You begin to mix the potion.");
    // The Cauldron: the first ingredient goes in quietly, the second brews a Gold Crown.
    bob.send({ t: "drop", slot: slotOf(bob, "Chunk of Star") });
    await t(1);
    expect(chats(bob)).toEqual(["You drop a Chunk of Star into the container."]);
    bob.send({ t: "drop", slot: slotOf(bob, "Silver Crown") });
    await t(1);
    expect(chats(bob)).toContain(
      "The cauldron bubbles...and with a huge puff of smoke, a new item appears inside.",
    );
    bob.send({ t: "action" });
    expect(await bob.waitFor((m) => m.t === "vault" && m.items.length > 0)).toEqual({
      t: "vault",
      items: ["Gold Crown"],
      open: true,
    });
    bob.send({ t: "vaultTake", index: 1 });
    await t(1);
    expect(slotOf(bob, "Gold Crown")).toBeGreaterThan(0);
    bob.send({ t: "shopCancel" });
    await t(200);
    expect(chats(alice)).toContain("You built a Chair!");
    expect(chats(carol)).toContain("Your Trout Fillet is ready!");
    expect(chats(dave)).toContain("Your potion is ready!");
    expect(slotOf(alice, "Chair")).toBeGreaterThan(0);
    expect(slotOf(carol, "Trout Fillet")).toBeGreaterThan(0);
    expect(slotOf(dave, "Red Potion")).toBeGreaterThan(0);
    // Alice smiths a sword at the Anvil.
    await supply(alice, "Alice", "Damaged Sword, Long");
    await supply(alice, "Alice", "Chunk of Iron");
    await supply(alice, "Alice", "Blacksmith Hammer");
    await atStation(alice, 4);
    alice.send({ t: "unequip", slot: "LeftHand" }); // the Axe
    await t(1);
    alice.send({ t: "equip", slot: slotOf(alice, "Blacksmith Hammer") });
    await t(1);
    clearAll();
    rng.fix(30, 1); // the smith animation rolls every frame
    alice.send({ t: "craft", slot: slotOf(alice, "Damaged Sword, Long") });
    await t(1);
    expect(chats(alice)).toContain("You begin to smith the Damaged Sword, Long...");
    await t(3);
    rng.fix(30, null);
    await t(500);
    expect(chats(alice)).toContain("Your Long Sword is ready!");
    expect(slotOf(alice, "Long Sword")).toBeGreaterThan(0);
    kept.push({
      what: "Alice: a Chair and a Long Sword",
      check: () => {
        expect(slotOf(alice, "Chair")).toBeGreaterThan(0);
        expect(slotOf(alice, "Long Sword")).toBeGreaterThan(0);
      },
    });
  });

  /** One tile of walking (the arrow pressed and released), then the new map if it changed. */
  const walk = async (bot: Bot, dir: "U" | "D" | "L" | "R") => {
    bot.send({ t: "step", seq: ++seq, dir, turn: false });
    bot.send({ t: "move", seq: ++seq, held: null, turn: false });
    await t(20);
    bot.send({ t: "mapReady" });
    await t(1);
  };
  const faceTo = async (bot: Bot, dir: "U" | "D" | "L" | "R") => {
    bot.send({ t: "step", seq: ++seq, dir, turn: true });
    bot.send({ t: "move", seq: ++seq, held: null, turn: false });
    await t(2);
  };
  const where = (name: string) => `${who(name).map.name}@${who(name).x},${who(name).y}`;
  const groundOf = (name: string, item: string) =>
    who(name).map.ground.find((g) => g.item === item)?.id ?? "";
  /** Says a line once the 3 s chat cooldown is over. */
  const sayLater = async (bot: Bot, text: string) => {
    await t(61);
    bot.clear();
    await say(bot, text);
  };
  /** Builds the building a deed in the bag stands for at (x, y) of the map the player is on. */
  const build = async (bot: Bot, deed: string, x: number, y: number) => {
    bot.clear();
    bot.send({ t: "use", slot: slotOf(bot, deed) });
    await settle();
    expect(bot.inbox.some((m) => m.t === "placing" && m.house !== null)).toBe(true);
    bot.send({ t: "placeHouse", slot: slotOf(bot, deed), x, y });
    await bot
      .waitFor((m) => m.t === "placing" && m.house === null)
      .catch((e) => {
        throw new Error(`${e.message}: ${JSON.stringify(chats(bot))}`);
      });
    await t(1);
  };

  chapter("11 Houses", async () => {
    // Alice builds a Small House on the Plots: Exit at (4,4), the door inside at (9,10).
    await supply(alice, "Alice", "Small House Deed");
    await supply(alice, "Alice", "House Key");
    await supply(alice, "Alice", "Apple");
    await warp("Alice", "x1000y993", 4, 6);
    await warp("Bob", "x1000y993", 12, 10);
    await t(50);
    await build(alice, "Small House Deed", 4, 3);
    expect(alice.inbox.some((m) => m.t === "inv")).toBe(true);
    await walk(alice, "U"); // (4,5)
    await walk(alice, "U"); // the Exit at (4,4)
    await t(2);
    expect(where("Alice")).toBe("xH11000yH1993@9,11");
    expect(who("Alice").map.title).toBe("Alice's House");
    const doorId = groundOf("Alice", "Alice's Door");
    alice.clear();
    alice.send({ t: "use", slot: slotOf(alice, "House Key") });
    await settle();
    expect(deltas(alice)).toContainEqual({ e: "gset", id: doorId, name: "Alice's Opened Door" });
    for (const d of ["U", "U", "U", "L", "L", "L"] as const) {
      await walk(alice, d);
    }
    expect(where("Alice")).toBe("xH11000yH1993@6,8");
    // The House Vault takes an Apple and gives it back.
    alice.clear();
    alice.send({ t: "drop", slot: slotOf(alice, "Apple") });
    await settle();
    expect(chats(alice)).toEqual(["You drop a Apple into the container."]);
    await t(41);
    alice.send({ t: "action" });
    await settle();
    expect(chats(alice)).toContain("You open Alice's House Vault to see what's inside...");
    alice.send({ t: "vaultTake", index: 1 });
    alice.send({ t: "shopCancel" });
    await settle();
    expect(slotOf(alice, "Apple")).toBeGreaterThan(0);
    kept.push({
      what: "Alice: a house on the Plots",
      check: () => {
        const row = server.db
          .query<{ n: number }, []>(
            "SELECT COUNT(*) AS n FROM maps WHERE mx = 1000 AND my = 993 AND slot = 1",
          )
          .get();
        expect(row?.n).toBe(1);
      },
    });
  });

  chapter("11b Player shop", async () => {
    // Alice builds a Small Shop at (12,3), stocks it with Fish; Carol buys one.
    await supply(alice, "Alice", "Small Shop Deed");
    await supply(alice, "Alice", "3 Fish");
    await warp("Alice", "x1000y993", 12, 6);
    await t(50);
    await build(alice, "Small Shop Deed", 12, 3);
    await walk(alice, "U"); // (12,5)
    await walk(alice, "U"); // the Exit (12,4)
    await t(2);
    expect(where("Alice")).toBe("xH21000yH2993@9,11");
    expect(who("Alice").map.title).toBe("Alice's Shop");
    for (const d of ["U", "U", "U", "U", "U", "U", "R"] as const) {
      await walk(alice, d);
    }
    await faceTo(alice, "U");
    expect(where("Alice")).toBe("xH21000yH2993@10,5");
    alice.clear();
    alice.send({ t: "gold", n: 100 });
    await settle();
    expect(chats(alice).some((l) => l.includes('Thanks for the gold!"'))).toBe(true);
    await sayLater(alice, "Zumu set Fish=5,2");
    expect(chats(alice)).toContain(`Zumu says "OK boss, I've added the item!"`);
    const sell = (await shopRows(alice, 1, "sell")).find((r) => r.item === "Fish");
    expect(sell, "Zumu buys Fish").toBeDefined();
    alice.send({ t: "sell", line: sell?.line ?? 0, count: 3 });
    await settle();
    alice.send({ t: "shopCancel" });
    await settle();
    // Carol walks in and buys a Fish.
    await warp("Carol", "x1000y993", 12, 6);
    await t(50);
    await walk(carol, "U");
    await walk(carol, "U");
    await t(2);
    await walk(carol, "U"); // inside, for the shop window
    expect(where("Carol")).toBe("xH21000yH2993@9,10");
    const buy = (await shopRows(carol, 1, "buy")).find((r) => r.item === "Fish");
    expect(buy, "Zumu sells Fish").toBeDefined();
    const gold0 = goldOf(carol) ?? 0;
    carol.send({ t: "buy", line: buy?.line ?? 0, count: 1 });
    await settle();
    carol.send({ t: "shopCancel" });
    await settle();
    expect(goldOf(carol)).toBe(gold0 - (buy?.price ?? 0));
    expect(slotOf(carol, "Fish")).toBeGreaterThan(0);
    // Alice reads the till; her shop is kept.
    await sayLater(alice, "Zumu inventory");
    expect(chats(alice).some((l) => l.includes("gold in the register"))).toBe(true);
    kept.push({
      what: "Alice: a shop on the Plots",
      check: () => {
        const row = server.db
          .query<{ n: number }, []>(
            "SELECT COUNT(*) AS n FROM maps WHERE mx = 1000 AND my = 993 AND slot = 2",
          )
          .get();
        expect(row?.n).toBe(1);
      },
    });
  });

  chapter("12 Society", async () => {
    // Alice gives Dave's head to Angela: she joins the Mage faction; King pardons the murder.
    await kingGo("x1000y992", 10, 2);
    await say(king, "/roster 4 Angela");
    await say(king, "/spawn 4"); // north of King: (10,1)
    await warp("Alice", "x1000y992", 10, 3);
    await turn(alice, "U");
    await t(50);
    clearAll();
    alice.send({ t: "give", slot: slotOf(alice, "Warrior's Head") });
    await settle();
    const thanks = 'Angela says "You have done well in slaying one of our foes."';
    expect(chats(alice)).toEqual([
      thanks,
      'Angela says "Welcome to the Mage faction."',
      "*** The Mage faction has become stronger thanks to Alice.",
    ]);
    expect(chats(king)).toContain(thanks);
    kept.push({
      what: "Alice: Mage faction",
      check: () => {
        const row = server.db
          .query<{ faction: number }, []>("SELECT faction FROM characters WHERE name = 'Alice'")
          .get();
        expect(row?.faction).toBe(1);
      },
    });
    await t(60);
    clearAll();
    await say(alice, "Is there a quest for me?");
    expect(chats(king)).toContain('Angela says "Sorry but I don\'t need anything right now"');
    clearAll();
    await say(king, "/Pardon Alice");
    expect(chats(king)).toEqual(["Pardoning Alice..."]);
    expect(chats(alice)).toEqual(["*** You have been pardoned by King."]);
    await say(king, "/roster 4 clear");
    await kingGo("x1000y992", 6, 4);

    // The Assassin's game: King starts a Lightning game; Alice hits Carol once.
    await warp("Alice", "x1000y992", 3, 6);
    await warp("Carol", "x1000y992", 4, 6);
    await turn(alice, "R");
    await t(60);
    clearAll();
    king.send({ t: "assassinGame", mode: "LIGHTNING" });
    await settle();
    expect(chats(alice)).toEqual([
      "*** The Lightning Assassin's Game has begun!",
      "*** Kill everyone in sight to become the greatest assassin ever!",
      "*** 1 hit is 1 kill and all death penalties are OFF!",
    ]);
    alice.send({ t: "attack", seq: ++seq, held: true });
    await t(1);
    alice.send({ t: "attack", seq: ++seq, held: false });
    await t(1);
    clearAll();
    await t(30);
    expect(chats(alice)).toEqual([
      "*** You are now wanted for the murder of Carol.",
      "*** Carol was just killed by Alice.",
      "*** Alice just received 10 assassin points!",
    ]);
    carol.send({ t: "mapReady" });
    clearAll();
    king.send({ t: "assassinGame", mode: "STOP" });
    await t(1);
    expect(chats(alice)).toContain("*** Alice has won first place with 10 points!");
    expect(slotOf(alice, "Long Sword")).toBeGreaterThan(0);
    await say(king, "/Pardon Alice");
    kept.push({
      what: "Alice: an assassin win",
      check: () => {
        expect(loadAssassinState(server.db).wins.get(idOf(server.db, "Alice"))).toBe(1);
      },
    });
  });

  chapter("13 Guild", async () => {
    // King drops a Guild Center on the Town; Bob creates the Knights there and invites Carol.
    await kingGo("x1000y992", 14, 12);
    await turn(king, "U");
    await warp("Bob", "x1000y992", 13, 11);
    await warp("Carol", "x1000y992", 3, 11);
    await turn(bob, "R");
    await t(50);
    bob.clear();
    await say(king, "/drop Guild Center"); // lands on (14, 11)
    await t(1);
    const center = deltas(bob).flatMap((e) => (e.e === "gadd" ? [e.item] : []))[0];
    expect(center?.name).toBe("Guild Center");
    await kingGo("x1000y992", 6, 4);
    bob.clear();
    bob.send({ t: "pickup", id: center?.id ?? "" });
    await settle();
    expect(bob.inbox.filter((m) => m.t === "guild")).toEqual([
      { t: "guild", screen: { mode: "create" } },
    ]);
    bob.send({ t: "guildCreate", name: "Knights", alignment: "G" });
    await settle();
    expect(chats(bob)).toEqual(["Guild created!", "Hail your guildmate Bob!"]);
    clearAll();
    await say(bob, "/invite Carol");
    expect(chats(bob)).toEqual(["*** Sending an invitation to Carol."]);
    expect(chats(carol)[0]).toBe(
      "*** Bob has invited you to join the Knights. If you would like to join type ACCEPT, to deny the invitation type REJECT.",
    );
    clearAll();
    await say(carol, "ACCEPT");
    expect(chats(carol)).toEqual([
      "*** You have accepted the offer.",
      "Hail your guildmate Carol!",
    ]);
    expect(chats(bob)).toContain("*** Carol has joined the Knights.");
    clearAll();
    await say(bob, "/g to arms");
    expect(chats(carol)).toEqual(['Bob tells the Knights "to arms"']);
    expect(chats(alice)).toEqual([]);
    kept.push({
      what: "Carol: in the Knights",
      check: async () => {
        carol.clear();
        await sayLater(bob, "/g still here");
        expect(chats(carol)).toEqual(['Bob tells the Knights "still here"']);
      },
    });

    // Bob builds the guild hall on the Plots, far from Alice's buildings; Carol opens its door.
    // (The Plots hold two buildings, Alice's house and shop: a map has two exit slots, so the
    // hall goes on the patch of house ground the operator painted in the Wilds.)
    await supply(bob, "Bob", "Small Guild Hall Deed");
    await supply(carol, "Carol", "Guild Key");
    await warp("Bob", "x1001y992", 12, 6);
    await warp("Carol", "x1001y992", 12, 6);
    await t(50);
    await build(bob, "Small Guild Hall Deed", 12, 3);
    await walk(bob, "R"); // out of the doorway
    await walk(carol, "U");
    await walk(carol, "U"); // the Exit at (12,4)
    await t(2);
    expect(where("Carol")).toBe("xH11001yH1992@9,11");
    expect(who("Carol").map.title).toBe("Hall of the Knights");
    const doorId = groundOf("Carol", "The Knights's Door");
    carol.clear();
    carol.send({ t: "use", slot: slotOf(carol, "Guild Key") });
    await settle();
    expect(deltas(carol)).toContainEqual({
      e: "gset",
      id: doorId,
      name: "The Knights's Opened Door",
    });
    for (const d of ["U", "U", "U", "L", "L", "L"] as const) {
      await walk(carol, d);
    }
    carol.clear();
    carol.send({ t: "drop", slot: slotOf(carol, "Fish") });
    await settle();
    expect(chats(carol)).toEqual(["You drop a Fish into the container."]);
  });

  const ims = (bot: Bot) => bot.inbox.filter((m) => m.t === "im");
  const bios = (bot: Bot) => bot.inbox.flatMap((m) => (m.t === "playerBio" ? [m] : []));

  chapter("14 People", async () => {
    for (const [name, x] of [
      ["Alice", 3],
      ["Bob", 4],
      ["Carol", 5],
      ["Dave", 7],
    ] as const) {
      await warp(name, "x1000y992", x, 7);
    }
    await t(50);
    // IM, a reply from the IM window, and an away message.
    clearAll();
    await say(alice, "/msg bob are you there?");
    expect(chats(alice)).toEqual([">>> Alice: are you there?"]);
    expect(ims(bob)).toEqual([{ t: "im", from: "Alice", text: "are you there?", away: false }]);
    clearAll();
    bob.send({ t: "im", to: "Alice", text: "yes!", via: "window" });
    await settle();
    expect(ims(alice)).toEqual([{ t: "im", from: "Bob", text: "yes!", away: false }]);
    clearAll();
    bob.send({ t: "away", text: "Gone fishing" });
    await t(61); // the 3 s chat cooldown
    alice.send({ t: "im", to: "Bob", text: "fish?", via: "send" });
    await settle();
    expect(ims(bob)).toEqual([{ t: "im", from: "Alice", text: "fish?", away: true }]);
    expect(ims(alice)).toEqual([{ t: "im", from: "Bob", text: "Gone fishing", away: false }]);
    bob.send({ t: "away", text: null });
    await settle();
    // A chat room: Alice and Bob enter General Chat; Carol is refused the Admin room.
    clearAll();
    alice.send({ t: "roomEnter", room: "general" });
    await settle();
    bob.send({ t: "roomEnter", room: "general" });
    await settle();
    expect(bob.inbox.find((m) => m.t === "room")).toMatchObject({
      title: "You are in: General Chat",
      users: ["Alice", "Bob"],
    });
    carol.send({ t: "roomEnter", room: "admin" });
    await settle();
    expect(carol.inbox.some((m) => m.t === "room")).toBe(false);
    await t(61);
    alice.send({ t: "roomSay", text: "room hello" });
    await settle();
    expect(bob.inbox).toContainEqual({ t: "roomLine", text: "Alice: room hello" });
    alice.send({ t: "roomLeave" });
    bob.send({ t: "roomLeave" });
    await settle();
    // Ignore: Carol ignores Dave and no longer hears him; Alice still does.
    clearAll();
    await say(carol, "/ignore Dave");
    expect(chats(carol)).toEqual(["Added Dave to your ignore list."]);
    clearAll();
    await say(dave, "anyone there?");
    expect(chats(alice)).toEqual(['Dave says "anyone there?"']);
    expect(chats(carol)).toEqual([]);
    // Friends and a bio.
    clearAll();
    await say(alice, "/friends add Bob");
    expect(chats(alice)).toEqual(["*** Bob was added to your friend's list."]);
    await t(1);
    expect(alice.inbox.filter((m) => m.t === "friends").at(-1)).toEqual({
      t: "friends",
      names: ["Bob"],
    });
    clearAll();
    alice.send({ t: "bioRequest", id: idOf(server.db, "Bob") });
    await settle();
    expect(bios(alice)[0]?.bio).toContain("Leader of the Knights");
    clearAll();
    alice.send({ t: "bioRequest", id: idOf(server.db, "Alice") });
    await settle();
    expect(bios(alice)[0]).toMatchObject({ own: true });
    expect(bios(alice)[0]?.bio).toContain("Loyal to the Mages");
    alice.send({ t: "profileSave", text: "Hunting slimes. Daily; ask me" });
    clearAll();
    alice.send({ t: "bioRequest", name: "alice" });
    await settle();
    expect(bios(alice)[0]).toMatchObject({ profile: "Hunting slimes Daily ask me", own: true });
    kept.push({
      what: "Alice: her profile, her friend Bob, Carol ignoring Dave",
      check: async () => {
        alice.clear();
        alice.send({ t: "bioRequest", name: "alice" });
        await settle();
        expect(bios(alice)[0]).toMatchObject({ profile: "Hunting slimes Daily ask me" });
        expect(loadBuddies(server.db, (await accountOf("Alice")) ?? "")).toEqual(["Bob"]);
        carol.clear();
        await sayLater(dave, "hello again");
        expect(chats(carol)).toEqual([]);
      },
    });
  });

  const msgsOf = <T extends ServerMsg["t"]>(bot: Bot, kind: T) =>
    bot.inbox.filter((m): m is Extract<ServerMsg, { t: T }> => m.t === kind);
  const PNG = makePng(64, 64, { noise: 3 });

  chapter("15 Letters", async () => {
    await warp("Alice", "x1000y992", 12, 5);
    await warp("Bob", "x1000y992", 13, 4);
    await turn(alice, "R"); // facing the Universal Mail at (13,5)
    await turn(bob, "D");
    await t(100); // the entry wait and the chat cooldown
    // Mail: Alice sends to Bob, Bob reads and replies, Alice deletes what she got.
    clearAll();
    alice.send({ t: "pickup", id: groundOf("Alice", "Universal Mail") });
    await settle();
    expect(chats(alice)).toEqual(["You check your mail..."]);
    expect(who("Alice").keyLock).toBe(true);
    alice.send({ t: "mailSend", to: "Bob", subject: "Hello", body: "Hi Bob" });
    await settle();
    expect(msgsOf(alice, "mailSent")).toEqual([{ t: "mailSent" }]);
    expect(chats(bob)).toEqual(["*** You have new mail from Alice"]);
    bob.clear();
    bob.send({ t: "pickup", id: groundOf("Bob", "Universal Mail") });
    await settle();
    expect(msgsOf(bob, "mail")[0]?.messages.map((m) => [m.from, m.subject, m.body])).toEqual([
      ["Alice", "Hello", "Hi Bob"],
    ]);
    alice.clear();
    bob.send({ t: "mailSend", to: "Alice", subject: "Re: Hello", body: "Hi back" });
    await settle();
    expect(chats(alice)).toEqual(["*** You have new mail from Bob"]);
    const reply = msgsOf(alice, "mail").at(-1)?.messages[0];
    expect(reply?.subject).toBe("Re: Hello");
    kept.push({
      what: "Alice: Bob's reply in her mailbox",
      check: async () => {
        await warp("Alice", "x1000y992", 12, 5);
        await turn(alice, "R");
        await t(100);
        alice.clear();
        alice.send({ t: "pickup", id: groundOf("Alice", "Universal Mail") });
        await settle();
        expect(
          msgsOf(alice, "mail")
            .at(-1)
            ?.messages.map((m) => m.subject),
        ).toEqual(["Re: Hello"]);
        alice.send({ t: "mailUi", act: "close" });
        await settle();
      },
    });
    alice.send({ t: "mailUi", act: "close" });
    bob.send({ t: "mailUi", act: "close" });
    await settle();
    expect(who("Alice").keyLock).toBe(false);
    // The Town Square board, read from the tile in front: Alice posts and sees her post; Bob
    // reads it.
    await warp("Alice", "x1000y992", 14, 6);
    await turn(alice, "U"); // facing the Message Boards at (14,5)
    await warp("Bob", "x1000y992", 14, 4);
    await turn(bob, "D");
    await t(100);
    clearAll();
    alice.send({ t: "pickup", id: groundOf("Alice", "Message Boards") });
    await settle();
    expect(chats(alice)).toEqual(["You view the message board"]);
    alice.clear();
    alice.send({ t: "boardPost", text: "Hello town" });
    await settle();
    expect(msgsOf(alice, "board")[0]?.board?.text).toContain("Hello town");
    alice.send({ t: "boardClose" });
    await settle();
    await t(45);
    bob.clear();
    bob.send({ t: "pickup", id: groundOf("Bob", "Message Boards") });
    await settle();
    expect(msgsOf(bob, "board")[0]?.board?.text).toContain("From: Alice");
    expect(msgsOf(bob, "board")[0]?.board?.text).toContain("Hello town");
    bob.send({ t: "boardClose" });
    await settle();
  });

  chapter("15b Painting", async () => {
    // A Canvas from King: Alice paints, drops the painting, Bob views it.
    await supply(alice, "Alice", "Canvas");
    await warp("Alice", "x1000y992", 3, 6);
    await warp("Bob", "x1000y992", 4, 6);
    await turn(alice, "R");
    await t(50);
    clearAll();
    rng.queue(9_999_999, 501); // the art id
    alice.send({ t: "use", slot: slotOf(alice, "Canvas") });
    await settle();
    expect(msgsOf(alice, "paint")).toEqual([{ t: "paint", reopen: false }]);
    alice.send({ t: "artSave", kind: "painting", png: b64(PNG) });
    await settle();
    expect(msgsOf(alice, "artSaved")).toEqual([{ t: "artSaved", kind: "painting" }]);
    await t(1);
    const painting = lastInv(alice)?.bag.find((l) => l?.item.startsWith("Painting#"))?.item ?? "";
    expect(painting).toMatch(/^Painting#\d+$/);
    await t(41);
    // Dropped on Bob's tile it would be a give; drop it on the faced tile after Bob steps away.
    await warp("Bob", "x1000y992", 6, 6);
    await turn(alice, "R");
    await t(50);
    alice.send({ t: "drop", slot: slotOf(alice, painting) });
    await t(30);
    // A painting on the ground is viewed from the tile in front of it.
    await warp("Bob", "x1000y992", 5, 6);
    await turn(bob, "L");
    bob.clear();
    bob.send({ t: "pickup", id: groundOf("Bob", painting) });
    await settle();
    expect(chats(bob)).toEqual(["You view the Painting, please wait..."]);
    const art = msgsOf(bob, "art")[0];
    expect(art?.author).toBe("Alice");
    expect(art?.png).toBe(b64(PNG));
    bob.send({ t: "viewClose" });
    await settle();
    kept.push({
      what: "Alice: a painting on the Town ground",
      check: () => {
        expect(groundOf("Alice", painting)).not.toBe("");
      },
    });
  });

  chapter("15c Newspaper", async () => {
    // King picks up a Newspaper Kit he dropped and stands his newspaper on the K2 ground.
    await kingGo("x1000y992", 16, 12);
    await turn(king, "U");
    await say(king, "/drop Newspaper Kit"); // lands on (16, 11)
    await t(1);
    const kit = who("King").map.ground.find((g) => g.item === "Newspaper Kit");
    expect(kit).toBeDefined();
    king.clear();
    king.send({ t: "pickup", id: kit?.id ?? "" });
    await t(1);
    lastInv(king);
    expect(slotOf(king, "Newspaper Kit")).toBeGreaterThan(0);
    await kingGo("x1000y992", 10, 12);
    await turn(king, "U");
    await t(50);
    king.clear();
    king.send({ t: "drop", slot: slotOf(king, "Newspaper Kit") });
    await t(1);
    expect(who("King").map.ground.some((g) => g.item === "King's Newspaper")).toBe(true);
    // He writes it, with Alice's painting as its photo.
    const art = server.db
      .query<{ id: number }, []>("SELECT id FROM art WHERE kind = 'painting'")
      .get()?.id;
    expect(art).toBeDefined();
    king.send({ t: "newspaperLoad" });
    await settle();
    const texts: [string, string, string, string, string, string] = [
      "The Daily Star",
      "Vol 1",
      "Body",
      "Left",
      "Right",
      "Footer",
    ];
    king.send({ t: "newspaperSave", photos: [String(art), "", ""], texts });
    await settle();
    // Bob's save writes his own paper, not King's; Alice reads the stand from the next tile,
    // facing it.
    bob.send({ t: "newspaperSave", photos: ["", "", ""], texts: ["x", "x", "x", "x", "x", "x"] });
    await settle();
    await warp("Alice", "x1000y992", 9, 11);
    await turn(alice, "R");
    await t(50);
    alice.clear();
    alice.send({ t: "pickup", id: groundOf("Alice", "King's Newspaper") });
    await settle();
    expect(chats(alice)).toEqual(["You view the newspaper"]);
    const paper = msgsOf(alice, "newspaper")[0];
    expect(paper?.texts).toEqual(texts);
    expect(paper?.photos).toEqual([b64(PNG), null, null]);
    alice.send({ t: "viewClose" });
    await settle();
    await kingGo("x1000y992", 6, 4);
    kept.push({
      what: "King: the newspaper stand and its text",
      check: async () => {
        await warp("Alice", "x1000y992", 9, 11);
        await turn(alice, "R");
        await t(50);
        alice.clear();
        alice.send({ t: "pickup", id: groundOf("Alice", "King's Newspaper") });
        await settle();
        expect(msgsOf(alice, "newspaper")[0]?.texts).toEqual(texts);
        alice.send({ t: "viewClose" });
        await settle();
      },
    });
  });

  chapter("16 Casino", async () => {
    await supply(alice, "Alice", "200 gold");
    await supply(bob, "Bob", "200 gold");
    // King warps them to the Casino (covers /warp on a player).
    await warp("Alice", "x1001y993", 4, 5);
    await warp("Bob", "x1001y993", 9, 4);
    await turn(alice, "U"); // facing the Slot Machine at (4,4)
    await t(50);
    // Slots: a losing pull costs 5 gold, a win pays the table (2-3-2 is 50 gross).
    clearAll();
    alice.send({ t: "pickup", id: groundOf("Alice", "Slot Machine") });
    await settle();
    expect(msgsOf(alice, "slot")).toEqual([{ t: "slot", open: true }]);
    let gold = goldOf(alice) ?? 0;
    rng.queue(4, 1, 2, 3);
    alice.send({ t: "slotPull" });
    await settle();
    await t(30);
    expect(msgsOf(alice, "slotResult")).toEqual([
      { t: "slotResult", reels: [1, 2, 3], win: false },
    ]);
    expect(chats(alice)).toContain("You lost. try again?");
    expect(goldOf(alice)).toBe(gold - 5);
    gold = goldOf(alice) ?? 0;
    alice.clear();
    rng.queue(4, 2, 3, 2);
    alice.send({ t: "slotPull" });
    await settle();
    await t(30);
    expect(chats(alice)).toContain("You won!!!!");
    expect(goldOf(alice)).toBe(gold - 5 + 50);
    alice.send({ t: "slotClose" });
    await settle();
    // Blackjack: Alice sits west of the table at (8,4), Bob east; Alice's 19 beats Bob's 18.
    await warp("Alice", "x1001y993", 7, 4);
    await warp("Bob", "x1001y993", 9, 4);
    await turn(alice, "R");
    await turn(bob, "L");
    await t(50);
    clearAll();
    alice.send({ t: "pickup", id: groundOf("Alice", "Blackjack Table") });
    await settle();
    bob.send({ t: "pickup", id: groundOf("Bob", "Blackjack Table") });
    await settle();
    expect(chats(alice)).toEqual(["Bob has joined the table!"]);
    expect(chats(bob)).toEqual(["You take a seat at Alice's table!"]);
    const a0 = goldOf(alice) ?? 0;
    const b0 = goldOf(bob) ?? 0;
    alice.send({ t: "bjBid", text: "20" });
    await t(1);
    rng.queue(13, 10, 9, 10, 8); // Alice 19, Bob 18
    bob.send({ t: "bjBid", text: "20" });
    await t(1);
    expect(chats(bob)).toContain("You are currently holding 18.");
    alice.send({ t: "bjStand" });
    bob.send({ t: "bjStand" });
    await t(1);
    expect(chats(alice)).toContain("Alice has won the game!!!");
    await t(45);
    expect(goldOf(alice)).toBe(a0 + 20);
    expect(goldOf(bob)).toBe(b0 - 20);
    bob.send({ t: "bjLeave" });
    await t(1);
    alice.send({ t: "bjLeave" });
    await t(1);
    // Checkers: Black moves, White moves, Black jumps.
    await warp("Alice", "x1001y993", 11, 4);
    await warp("Bob", "x1001y993", 13, 4);
    await turn(alice, "R");
    await turn(bob, "L");
    await t(50);
    clearAll();
    alice.send({ t: "pickup", id: groundOf("Alice", "Checkers Table") });
    await settle();
    bob.send({ t: "pickup", id: groundOf("Bob", "Checkers Table") });
    await settle();
    const start = "*** The Checkers Game Has Started. It's Alice's (black) turn.";
    expect(chats(bob)).toEqual([start]);
    alice.send({ t: "ckMove", piece: 8, dh: 1, dv: -1 });
    await settle();
    expect(msgsOf(bob, "ck").at(-1)).toMatchObject({ moved: { turn: 2 } });
    bob.send({ t: "ckMove", piece: 20, dh: 1, dv: 1 });
    await settle();
    expect(msgsOf(alice, "ck").at(-1)).toMatchObject({ moved: { turn: 1 } });
    alice.send({ t: "ckMove", piece: 8, dh: -1, dv: -1 });
    await settle();
    expect(msgsOf(bob, "ck").at(-1)).toMatchObject({ open: true });
    bob.send({ t: "ckClose" });
    await settle();
    alice.send({ t: "ckClose" });
    await settle();
    rng.reset();
    kept.push({
      what: "Alice and Bob: the casino's gold",
      check: () => {
        expect(goldOf(alice) ?? 0).toBeGreaterThan(0);
      },
    });
  });

  chapter("17 Airship", async () => {
    // Bob builds an airship from a deed on the Wilds pad (6,5), flies over the water to the
    // pad (9,5) and parks it there.
    await supply(bob, "Bob", "Airship Deed");
    await warp("Bob", "x1001y992", 6, 6);
    await turn(bob, "U"); // facing the pad (6,5)
    await t(50);
    bob.clear();
    bob.send({ t: "use", slot: slotOf(bob, "Airship Deed") });
    await t(1);
    const built = deltas(bob).flatMap((e) => (e.e === "gadd" ? [e.item] : []));
    expect(built.map((g) => [g.name, g.x, g.y])).toEqual([["Bob's Airship", 6, 5]]);
    expect(slotOf(bob, "Airship Deed")).toBe(0);
    await t(41);
    bob.clear();
    bob.send({ t: "action" });
    await t(1);
    expect(chats(bob)).toContain("You board your Airship...");
    for (let i = 0; i < 3; i++) {
      bob.send({ t: "step", seq: ++seq, dir: "R", turn: false });
      bob.send({ t: "move", seq: ++seq, held: null, turn: false });
      await t(9);
    }
    expect(where("Bob")).toBe("x1001y992@9,5");
    await t(41);
    bob.clear();
    bob.send({ t: "action" });
    await t(1);
    const parked = deltas(bob).flatMap((e) => (e.e === "gadd" ? [e.item] : []));
    expect(parked.map((g) => [g.name, g.x, g.y])).toEqual([["Bob's Airship", 9, 5]]);
    kept.push({
      what: "Bob: his airship parked on the Wilds pad (9,5)",
      check: () => {
        const row = server.db
          .query<{ n: number }, []>(
            "SELECT COUNT(*) AS n FROM ground_items WHERE item = 'Bob''s Airship'",
          )
          .get();
        expect(row?.n).toBe(1);
      },
    });
  });

  chapter("18 Arena, promotion, orb, pig and web", async () => {
    // The arena on the Wilds: Bob challenges and jumps onto a 6P tile (queued tile), then quits.
    await warp("Alice", "x1001y992", 8, 8);
    await warp("Bob", "x1001y992", 8, 9);
    await t(50);
    clearAll();
    rng.queue(17, 4);
    rng.queue(12, 9);
    bob.send({ t: "chat", text: "Challenge" });
    await t(1);
    expect(chats(bob)).toEqual(["Bob has entered the arena!"]);
    expect(chats(alice)).toEqual(["Bob has entered the arena!"]);
    const jumped = deltas(alice).flatMap((e) =>
      e.e === "enter" && e.player.name === "Bob" ? [[e.player.x, e.player.y]] : [],
    );
    expect(jumped).toEqual([[4, 9]]);
    await t(61);
    clearAll();
    bob.send({ t: "chat", text: "quit" });
    await t(1);
    expect(chats(alice)).toEqual(["Bob has stopped fighting."]);
    rng.reset();

    // SQL shortcuts: Slash 30 (the trainer's price in skill) and a Fire Orb, which has no source
    // in play; Alice's login picks them up.
    await logout(alice);
    server.db.run(
      "INSERT OR REPLACE INTO character_skills (character_id, skill, value) VALUES (?, ?, 30)",
      [idOf(server.db, "Alice"), skillIndex("Slash") + 1],
    );
    server.db.run(
      "INSERT INTO inventory (id, character_id, slot, item, qty) VALUES (?, ?, 15, 'Fire Orb', 1)",
      [crypto.randomUUID(), idOf(server.db, "Alice")],
    );
    alice = await login(server, "Alice");
    await supply(alice, "Alice", "Pig");
    await supply(bob, "Bob", "Web Book");
    await supply(bob, "Bob", "1 White Crystals"); // Web costs 3; Bob has the 2 Alice gave him

    // The promotion: Smithy trains a Fighter into a Grunt for 100 gold.
    await warp("Alice", "x1000y992", 6, 4);
    await t(50);
    const gold0 = goldOf(alice) ?? 0;
    clearAll();
    alice.send({ t: "npcClick", slot: 3 });
    alice.send({ t: "shopList", mode: "train" });
    const list = await alice.waitFor((m) => m.t === "shop" && m.mode === "train");
    const grunt = list.t === "shop" ? list.rows.find((r) => r.item === "Grunt") : undefined;
    expect(grunt, "Smithy trains Grunts").toEqual({ line: 3, item: "Grunt", price: 100 });
    alice.send({ t: "train", line: grunt?.line ?? 0 });
    await settle();
    expect(chats(alice)).toEqual(["Smithy: Congratulations, you are now a Grunt!"]);
    await t(1);
    expect(goldOf(alice)).toBe(gold0 - 100);
    alice.send({ t: "shopCancel" });
    kept.push({
      what: "Alice: Grunt class",
      check: () => {
        const row = server.db
          .query<{ class_code: number }, []>(
            "SELECT class_code FROM characters WHERE name = 'Alice'",
          )
          .get();
        expect(row?.class_code).toBe(4);
      },
    });

    // An orb lies on the ground like any item; Bob picks it up.
    await warp("Alice", "x1000y992", 3, 8);
    await warp("Bob", "x1000y992", 4, 9);
    await warp("Carol", "x1000y992", 5, 8);
    await turn(alice, "R");
    await turn(carol, "L");
    await t(50);
    clearAll();
    alice.send({ t: "drop", slot: slotOf(alice, "Fire Orb") });
    await t(1);
    const orb = deltas(bob).flatMap((e) => (e.e === "gadd" ? [e.item] : []));
    expect(orb.map((g) => [g.name, g.x, g.y])).toEqual([["Fire Orb", 4, 8]]);
    expect(chats(alice)).toEqual([]);
    bob.send({ t: "pickup", id: orb[0]?.id ?? "" });
    await t(1);
    expect(slotOf(bob, "Fire Orb")).toBeGreaterThan(0);
    kept.push({
      what: "Bob: a Fire Orb",
      check: () => {
        expect(slotOf(bob, "Fire Orb")).toBeGreaterThan(0);
      },
    });

    // A Pig dropped from the bag is a monster; Carol grabs it with Ctrl and holds a Pig.
    await t(60);
    clearAll();
    alice.send({ t: "drop", slot: slotOf(alice, "Pig") });
    await t(1);
    const pig = deltas(carol).flatMap((e) => (e.e === "mspawn" ? [e.monster] : []));
    expect(pig.map((m) => [m.name, m.x, m.y])).toEqual([["Pig", 4, 8]]);
    carol.send({ t: "action" });
    await t(1);
    expect(slotOf(carol, "Pig")).toBeGreaterThan(0);
    expect(deltas(carol).some((e) => e.e === "mgone")).toBe(true);
    kept.push({
      what: "Carol: a Pig",
      check: () => {
        expect(slotOf(carol, "Pig")).toBeGreaterThan(0);
      },
    });

    // A web: Bob learns Web and casts it on Carol's tile; Carol, pressing a key, is held.
    await t(60);
    clearAll();
    bob.send({ t: "use", slot: slotOf(bob, "Web Book") });
    await t(1);
    expect(chats(bob)).toContain("You have learned the spell of Web.");
    await t(41);
    clearAll();
    const at = centre(5, 8);
    bob.send({ t: "cast", spell: "Web", x: at.x, y: at.y });
    await t(1);
    const web = deltas(carol).flatMap((e) => (e.e === "mspawn" ? [e.monster] : []));
    expect(web.map((m) => [m.name, m.x, m.y])).toEqual([["Web", 5, 8]]);
    clearAll();
    carol.send({ t: "move", seq: ++seq, held: "R", turn: false });
    await t(2);
    expect(chats(carol)).toEqual([WEB_TEXT, WEB_TEXT]);
    expect(deltas(carol).filter((e) => e.e === "move" && "id" in e)).toEqual([]);
    carol.send({ t: "move", seq: ++seq, held: null, turn: false });
    await t(1);
  });

  chapter("19 Admin", async () => {
    // Dave changes his password in chat and logs in with the new one.
    await t(61);
    clearAll();
    await say(dave, "Password=newpass");
    await dave.waitFor((m) => m.t === "chat" && m.text === "Password has been changed.", 5000);
    expect(chats(dave)).toEqual(["Password has been changed."]);
    expect(JSON.stringify([...dave.inbox, ...king.inbox])).not.toContain("newpass");
    await logout(dave);
    const old = await connectBot(server.wsUrl);
    old.send({ t: "login", name: "Dave", password: "secret" });
    expect(await old.waitFor((m) => m.t === "denied")).toEqual({
      t: "denied",
      text: TEXT.badPassword,
    });
    old.close();
    dave = await login(server, "Dave", "newpass");
    // (Chapter 20 logs Dave in with the new password after the restart.)
    // King drops Dave an item (an operator tool), then kicks, bans and unbans him.
    await supply(dave, "Dave", "Apple");
    expect(slotOf(dave, "Apple")).toBeGreaterThan(0);
    await say(king, "/kick Dave");
    expect(await dave.waitFor((m) => m.t === "kicked")).toEqual({ t: "kicked", text: TEXT.kicked });
    expect((await dave.closed).code).toBe(4005);
    dave = await login(server, "Dave", "newpass");
    await say(king, "/ban Dave");
    expect(await dave.waitFor((m) => m.t === "kicked")).toEqual({
      t: "kicked",
      text: banNotice(ADMIN_TEXT.banned, null),
    });
    const refused = await connectBot(server.wsUrl);
    refused.send({ t: "login", name: "Dave", password: "newpass" });
    expect(await refused.waitFor((m) => m.t === "denied")).toEqual({
      t: "denied",
      text: banNotice(ADMIN_TEXT.banned, null),
    });
    refused.close();
    king.clear();
    await say(king, "/unban Dave");
    expect(chats(king)).toEqual(["Dave is no longer banned."]);
    dave = await login(server, "Dave", "newpass");
    const cmds = recentAudit(server.db, 500).map((r) => r.command);
    for (const c of ["/warp", "settings", "/drop", "/kick", "/ban", "/unban", "editSave"]) {
      expect(cmds, `the audit log has ${c}`).toContain(c);
    }
  });

  chapter("20 The next day", async () => {
    // Everyone logs out, the server stops and starts again on the same file, and everyone logs
    // back in: whatever the chapters left is still there.
    for (const b of [alice, bob, carol, dave, king]) {
      await logout(b);
    }
    await server.stop();
    rng.reset();
    server = startTestServer({ rng, dbPath });
    king = await login(server, "King");
    alice = await login(server, "Alice");
    bob = await login(server, "Bob");
    carol = await login(server, "Carol");
    dave = await login(server, "Dave", "newpass");
    await t(2);
    for (const b of [king, alice, bob, carol, dave]) {
      lastInv(b); // the checks clear inboxes; remember each bag first
    }
    expect(kept.length, "the chapters recorded what to check").toBeGreaterThanOrEqual(14);
    const missing: string[] = [];
    for (const k of kept) {
      try {
        await k.check();
      } catch (e) {
        missing.push(`${k.what}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
