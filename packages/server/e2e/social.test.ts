/**
 * Bot script: guilds, factions, IM, friends and the Assassin's game.
 *
 * Part 1: on the seed map (PvP flag X), Bob kills Alice, a Warrior: her Warrior's Head drops on her
 * tile and, when her death lock ends, Bob is wanted for her murder. Bob picks the head up; King, an
 * immortal, puts Angela in front of him; Bob gives her the head: the map hears her thanks, the
 * Warriors lose a point to the Mages, Bob joins the Mages and the shared `@Faction` channel (Alice
 * too, still a Warrior) hears the announcement. Asked about a quest, Angela has nothing; asked
 * about power, she says the Mages are fine. King pardons Bob.
 *
 * Part 2: King starts a Lightning Assassin's game from the Admin menu; Alice hits Bob once and he
 * dies with nothing dropped; at the end of his death lock Alice is wanted and receives 10 points;
 * King ends the game with menu 502's End Assassin's Game: Alice wins first place and the Long
 * Sword, nobody is second or third; Alice clicks the Assassin Statue and reads both tables.
 *
 * Part 3: King, an immortal, drops a Guild Center. Alice stands in front of it, opens it in create
 * mode and creates the Knights. She invites Bob; Carol's ACCEPT with no invitation is said aloud;
 * Bob accepts and both hear the Hail. `/g` reaches Alice and Bob, not Carol. Bob builds a Small
 * Guild Hall; Alice walks in, opens "The Knights's Door" with her Guild Key and drops an Apple into
 * the Guild Vault; Carol walks in behind her and is refused the vault. Alice walks back out to the
 * Center, opens it as leader and exiles Bob, who hears the exile line and then the kick, and can no
 * longer use `/g`.
 *
 * Part 4: Alice IMs Bob with `/msg` and Bob replies from his IM window, its echo back in it; an IM
 * to someone offline says so. Bob sets away and Alice's next IM gets the bare away text. Both enter
 * General Chat and see each other in the roster; Carol, not an immortal, cannot enter Admin Chat.
 * Bob ignores Alice: her local chat and IMs stop reaching him, her room lines do not.
 *
 * Part 5: Alice's Friends window is filled (empty) at game entry, not opened. She adds Bob while he
 * is offline; he logs on and appears in it. Bob, a wanted Mage and a Novice Cook, creates the
 * Knights at a Guild Center King drops. Alice views Bob's bio from the player menu (title, score,
 * guild, faction and murder lines), then her own, and saves an edited profile, which loses its
 * period and semicolon. Bob logs off and leaves her list. Her Cooking reaching 90 awards the silver
 * spatula, which her bio then shows.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  bioScore,
  type CreateMsg,
  type DeltaEvent,
  type GroundView,
  type ServerMsg,
  skillIndex,
} from "@secondstaronline/shared";

import { setRole } from "../src/persistence/accounts.ts";
import { loadAssassinState } from "../src/persistence/assassin.ts";
import type { Db } from "../src/persistence/database.ts";
import { loadFactionPowers } from "../src/persistence/social.ts";
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
const lines = (bot: Bot) => bot.inbox.flatMap((m) => (m.t === "chat" ? [m.text] : []));
const deltas = (bot: Bot): DeltaEvent[] =>
  bot.inbox.flatMap((m) => (m.t === "delta" ? m.events : []));
const added = (bot: Bot): GroundView[] =>
  deltas(bot).flatMap((e) => (e.e === "gadd" ? [e.item] : []));
const lastInv = (bot: Bot) => {
  const m = bot.inbox.filter((x) => x.t === "inv").at(-1);
  return m?.t === "inv" ? m.inv : undefined;
};

describe("murder flag, factions and quests", () => {
  let server: TestServer;
  let alice: Bot;
  let bob: Bot;
  let king: Bot;
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
  const turn = async (bot: Bot, dir: "U" | "D" | "L" | "R") => {
    bot.send({ t: "step", seq: ++seq, dir, turn: true });
    await tick(1);
  };
  const live = (name: string) =>
    [...server.game.world.players.values()].find((p) => p.name === name);

  beforeAll(async () => {
    server = startTestServer({ rng });
    const bot = await connectBot(server.wsUrl);
    for (const name of ["Alice", "Bob", "King"]) {
      bot.send(make(name));
      await bot.waitFor((m) => m.t === "created");
      bot.clear();
    }
    bot.close();
    const db = server.db;
    place(db, "Alice", 6, 4);
    place(db, "Bob", 5, 4);
    place(db, "King", 5, 2);
    // Alice is a Warrior; both have the HP a faction asks for asks for.
    db.run("UPDATE characters SET faction = 2, faction_count = 212000 WHERE name = 'Alice'");
    db.run("UPDATE characters SET hp_max = 90, hp = 90 WHERE name IN ('Alice', 'Bob')");
    const acc = db
      .query<{ account_id: string }, [string]>("SELECT account_id FROM characters WHERE id = ?")
      .get(idOf(db, "King"));
    setRole(db, acc?.account_id ?? "", "immortal", "2026-11-07T00:00:00.000Z");
    alice = await login("Alice");
    bob = await login("Bob");
    king = await login("King");
  });

  afterAll(() => {
    alice?.close();
    bob?.close();
    king?.close();
    server?.stop();
  });

  test("Bob kills Alice: her Warrior's Head drops on her tile", async () => {
    await turn(bob, "R");
    await tick(60); // the attack timers settle after login
    const a = live("Alice");
    if (a) {
      a.char.vitals.hp = 1;
    }
    bob.clear();
    bob.send({ t: "attack", seq: ++seq, held: true });
    await tick(1);
    bob.send({ t: "attack", seq: ++seq, held: false });
    await tick(1);
    // The head goes down before her item drop.
    expect(added(bob).map((g) => `${g.name}@${g.x},${g.y}`)).toEqual([
      "Warrior's Head@6,4",
      "Knife@6,4",
    ]);
  });

  test("at the end of her death lock Bob is wanted for her murder", async () => {
    await tick(30);
    expect(lines(bob)).toContain("*** You are now wanted for the murder of Alice.");
    expect(lines(bob)).toContain("*** Alice was just killed by Bob.");
    expect(server.db.query("SELECT wanted FROM characters WHERE name = 'Bob'").get()).toEqual({
      wanted: 1,
    });
  });

  test("Bob gives the head to Angela: power moves, he joins, @Faction hears it", async () => {
    const head = added(bob).find((g) => g.name === "Warrior's Head");
    bob.send({ t: "pickup", id: head?.id ?? "" });
    await settle();
    const slot = (lastInv(bob)?.bag.findIndex((l) => l?.item === "Warrior's Head") ?? -1) + 1;
    expect(slot).toBeGreaterThan(0);
    // King, north of Bob, faces south and puts Angela between them.
    await turn(king, "D");
    king.send({ t: "chat", text: "/roster 1 Angela" });
    king.send({ t: "chat", text: "/spawn 1" });
    await settle();
    await turn(bob, "U");
    alice.clear();
    bob.clear();
    king.clear();
    bob.send({ t: "give", slot });
    await settle();
    const thanks = 'Angela says "You have done well in slaying one of our foes."';
    const joined = "*** The Mage faction has become stronger thanks to Bob.";
    expect(lines(bob)).toEqual([thanks, 'Angela says "Welcome to the Mage faction."', joined]);
    expect(lines(king)).toEqual([thanks]);
    // Alice is a Warrior, still in the one shared channel.
    expect(lines(alice)).toContain(joined);
    expect(loadFactionPowers(server.db)).toEqual([28, 122, 0]);
  });

  test("Angela answers the quest and power questions to the map", async () => {
    king.clear();
    bob.send({ t: "chat", text: "Is there a quest for me?" });
    await settle();
    expect(lines(king)).toContain('Angela says "Sorry but I don\'t need anything right now"');
    await tick(60); // the 3 s chat cooldown
    king.clear();
    bob.send({ t: "chat", text: "Who is in power?" });
    await settle();
    expect(lines(king)).toContain('Angela says "Our power is fine...for now.');
  });

  test("King pardons Bob", async () => {
    bob.clear();
    king.clear();
    king.send({ t: "chat", text: "/Pardon Bob" });
    await settle();
    expect(lines(king)).toEqual(["Pardoning Bob..."]);
    expect(lines(bob)).toEqual(["*** You have been pardoned by King."]);
    expect(live("Bob")?.char.wanted).toBe(false);
  });
});

const STATUE = "8c2a55a5-0000-4000-8000-000000000001";

describe("the Assassin's game", () => {
  let server: TestServer;
  let alice: Bot;
  let bob: Bot;
  let king: Bot;
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
  const live = (name: string) =>
    [...server.game.world.players.values()].find((p) => p.name === name);

  beforeAll(async () => {
    // An Assassin Statue placed with the World Editor (none ships).
    server = startTestServer({
      rng,
      prepare: (db) => {
        const map = db.query("SELECT id FROM maps WHERE mx = 1000 AND my = 992").get() as {
          id: string;
        };
        db.run(
          "INSERT INTO ground_items (id, map_id, x, y, item, qty, kind, expires_at, created_at) VALUES (?, ?, 12, 8, 'Assassin Statue', 1, 'admin', NULL, '2026-11-07')",
          [STATUE, map.id],
        );
      },
    });
    const bot = await connectBot(server.wsUrl);
    for (const name of ["Alice", "Bob", "King"]) {
      bot.send(make(name));
      await bot.waitFor((m) => m.t === "created");
      bot.clear();
    }
    bot.close();
    const db = server.db;
    place(db, "Alice", 5, 4);
    place(db, "Bob", 6, 4);
    place(db, "King", 5, 2);
    db.run("UPDATE characters SET hp_max = 90, hp = 90 WHERE name IN ('Alice', 'Bob')");
    const acc = db
      .query<{ account_id: string }, [string]>("SELECT account_id FROM characters WHERE id = ?")
      .get(idOf(db, "King"));
    setRole(db, acc?.account_id ?? "", "immortal", "2026-11-07T00:00:00.000Z");
    alice = await login("Alice");
    bob = await login("Bob");
    king = await login("King");
  });

  afterAll(() => {
    alice?.close();
    bob?.close();
    king?.close();
    server?.stop();
  });

  test("King begins a Lightning game from the Admin menu, at once", async () => {
    alice.clear();
    king.send({ t: "assassinGame", mode: "LIGHTNING" });
    await settle();
    expect(lines(alice)).toEqual([
      "*** The Lightning Assassin's Game has begun!",
      "*** Kill everyone in sight to become the greatest assassin ever!",
      "*** 1 hit is 1 kill and all death penalties are OFF!",
    ]);
    expect(loadAssassinState(server.db).mode).toBe("LIGHTNING");
  });

  test("Alice hits Bob once: he dies with nothing dropped", async () => {
    alice.send({ t: "step", seq: ++seq, dir: "R", turn: true });
    await tick(60); // the attack timers settle after login
    bob.clear();
    alice.send({ t: "attack", seq: ++seq, held: true });
    await tick(1);
    alice.send({ t: "attack", seq: ++seq, held: false });
    await tick(1);
    expect(live("Bob")?.deadLock).toBeGreaterThan(0);
    expect(live("Bob")?.char.vitals.hpMax).toBe(90);
    expect(added(bob)).toEqual([]);
  });

  test("at the end of his lock Alice is wanted and receives 10 points, after the death line", async () => {
    alice.clear();
    await tick(30);
    expect(lines(alice)).toEqual([
      "*** You are now wanted for the murder of Bob.",
      "*** Bob was just killed by Alice.",
      "*** Alice just received 10 assassin points!",
    ]);
  });

  test("King ends it with menu 502's End Assassin's Game: Alice wins and gets the Long Sword", async () => {
    alice.clear();
    king.send({ t: "assassinGame", mode: "STOP" });
    await tick(1);
    expect(lines(alice)).toEqual([
      "*** The assassin's game has ended!!!",
      "*** Alice has won first place with 10 points!",
      "***  has won second place and  has come in third.",
      "*** Check back soon for yet another assassin's game.",
    ]);
    expect(lastInv(alice)?.bag.some((l) => l?.item === "Long Sword")).toBe(true);
    expect(loadAssassinState(server.db).wins.get(idOf(server.db, "Alice"))).toBe(1);
  });

  test("Alice clicks the Assassin Statue: its line, then both tables", async () => {
    await tick(40);
    alice.clear();
    alice.send({ t: "pickup", id: STATUE });
    await settle();
    const [line, allTime, current] = lines(alice);
    expect(line).toBe("You view the top Assassins of FSO...");
    expect(allTime?.split("\n")[1]).toBe("                        * Top All-Time Assassins *");
    expect(allTime?.split("\n")[3]?.startsWith("1. Alice - 1 points      2.  -  points")).toBe(
      true,
    );
    expect(current?.split("\n")[3]?.startsWith("1. Alice - 10 points      2.  -  points")).toBe(
      true,
    );
  });
});

describe("guilds", () => {
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
  const at = (name: string) => `${who(name).map.name}@${who(name).x},${who(name).y}`;
  const slotOf = (name: string, item: string) =>
    who(name).char.bag.findIndex((l) => l !== null && l.item === item) + 1;
  const groundOf = (name: string, item: string) =>
    who(name).map.ground.find((g) => g.item === item)?.id ?? "";
  const guildMsgs = (bot: Bot) => bot.inbox.filter((m) => m.t === "guild");

  beforeAll(async () => {
    server = startTestServer({
      rng,
      prepare: (db) => {
        // Buildable ground: layer 1 `8R`.
        const row = Array.from({ length: 17 }, () => "8R").join(" ");
        db.run("UPDATE maps SET layer1 = ?", [
          JSON.stringify(Array.from({ length: 12 }, () => row)),
        ]);
      },
    });
    const bot = await connectBot(server.wsUrl);
    for (const name of ["Alice", "Bob", "Carol", "King"]) {
      bot.send(make(name));
      await bot.waitFor((m) => m.t === "created");
      bot.clear();
    }
    bot.close();
    const db = server.db;
    place(db, "Alice", 12, 8);
    place(db, "Bob", 7, 6);
    place(db, "Carol", 4, 6);
    place(db, "King", 12, 6);
    bag(db, "Alice", ["Guild Key", "Apple"]);
    bag(db, "Bob", ["Small Guild Hall Deed"]);
    bag(db, "Carol", ["Pie"]);
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

  test("King drops a Guild Center; Alice opens it in front and creates the Knights", async () => {
    await turn(king, "D");
    await say(king, "/drop Guild Center");
    expect(groundOf("Alice", "Guild Center")).not.toBe("");
    await turn(alice, "U"); // facing the Center at (12, 7)
    alice.clear();
    alice.send({ t: "pickup", id: groundOf("Alice", "Guild Center") });
    await settle();
    expect(guildMsgs(alice)).toEqual([{ t: "guild", screen: { mode: "create" } }]);
    alice.send({ t: "guildCreate", name: "Knights", alignment: "G" });
    await settle();
    expect(lines(alice)).toEqual(["Guild created!", "Hail your guildmate Alice!"]);
    expect(guildMsgs(alice).at(-1)).toEqual({ t: "guild", screen: null });
  });

  test("Alice invites Bob; Carol's ACCEPT is said; Bob accepts and both hear the Hail", async () => {
    alice.clear();
    bob.clear();
    carol.clear();
    await say(alice, "/invite Bob");
    expect(lines(alice)).toEqual(["*** Sending an invitation to Bob."]);
    expect(lines(bob)[0]).toBe(
      "*** Alice has invited you to join the Knights. If you would like to join type ACCEPT, to deny the invitation type REJECT.",
    );
    await say(carol, "ACCEPT");
    expect(lines(carol)).toEqual(['Carol says "ACCEPT"']);
    alice.clear();
    bob.clear();
    await say(bob, "ACCEPT");
    expect(lines(bob)).toEqual(["*** You have accepted the offer.", "Hail your guildmate Bob!"]);
    expect(lines(alice)).toContain("*** Bob has joined the Knights.");
    expect(lines(alice)).toContain("Hail your guildmate Bob!");
  });

  test("/g reaches Alice and Bob only", async () => {
    alice.clear();
    bob.clear();
    carol.clear();
    await say(alice, "/g to arms");
    expect(lines(alice)).toEqual(['Alice tells the Knights "to arms"']);
    expect(lines(bob)).toEqual(['Alice tells the Knights "to arms"']);
    expect(lines(carol)).toEqual([]);
  });

  test("Bob builds a Small Guild Hall: 'Hall of the Knights'", async () => {
    bob.send({ t: "use", slot: 1 });
    bob.send({ t: "placeHouse", slot: 1, x: 7, y: 3 });
    await settle();
    expect(slotOf("Bob", "Small Guild Hall Deed")).toBe(0);
    await step(bob, "R"); // (8, 6): out of the doorway
  });

  test("Alice opens the hall's door with her Guild Key and fills the Guild Vault", async () => {
    for (const d of ["L", "L", "L", "L", "L", "U", "U", "U", "U"] as const) {
      await step(alice, d); // (7, 8) then up to the Exit at (7, 4)
    }
    await tick(2);
    expect(at("Alice")).toBe("xH11000yH1992@9,11");
    expect(who("Alice").map.title).toBe("Hall of the Knights");
    const doorId = groundOf("Alice", "The Knights's Door");
    alice.clear();
    alice.send({ t: "use", slot: 1 });
    await settle();
    expect(deltas(alice)).toContainEqual({
      e: "gset",
      id: doorId,
      name: "The Knights's Opened Door",
    });
    for (const d of ["U", "U", "U", "L", "L", "L"] as const) {
      await step(alice, d); // (6, 8), facing the vault at (5, 8)
    }
    alice.clear();
    alice.send({ t: "drop", slot: slotOf("Alice", "Apple") });
    await settle();
    expect(lines(alice)).toEqual(["You drop a Apple into the container."]);
    await step(alice, "U"); // (6, 7): out of Carol's way
  });

  test("Carol walks in behind her and is refused the vault", async () => {
    for (const d of ["R", "R", "R", "U", "U"] as const) {
      await step(carol, d); // (7, 6), (7, 5), the Exit
    }
    await tick(2);
    expect(at("Carol")).toBe("xH11000yH1992@9,11");
    // The hall door has relocked: Alice comes back and opens it for her, then steps aside.
    for (const d of ["R", "R", "R", "D", "D"] as const) {
      await step(alice, d); // (9, 7), (9, 8), (9, 9) facing the door
    }
    await tick(100);
    alice.send({ t: "use", slot: 1 });
    await settle();
    for (const d of ["U", "U", "R"] as const) {
      await step(alice, d); // (9, 8), (9, 7), (10, 7)
    }
    for (const d of ["U", "U", "U", "L", "L", "L"] as const) {
      await step(carol, d);
    }
    expect(at("Carol")).toBe("xH11000yH1992@6,8");
    carol.clear();
    carol.send({ t: "action" });
    await settle();
    expect(lines(carol)).toEqual(["You can't open a vault that's not yours!"]);
  });

  test("Alice walks back to the Center and exiles Bob: he hears both lines", async () => {
    for (const d of ["L", "D", "D"] as const) {
      await step(alice, d); // (9, 7), (9, 8), (9, 9), facing the relocked door
    }
    await tick(100);
    alice.send({ t: "use", slot: 1 });
    await settle();
    for (const d of ["D", "D", "D"] as const) {
      await step(alice, d); // out through the Exit: (7, 5)
    }
    await tick(2);
    expect(at("Alice")).toBe("x1000y992@7,5");
    for (const d of ["D", "D", "D", "R", "R", "R", "R", "R"] as const) {
      await step(alice, d); // (12, 8), round the trees at (10-11, 6-7)
    }
    await turn(alice, "U"); // facing the Center at (12, 7)
    expect(at("Alice")).toBe("x1000y992@12,8");
    await tick(41);
    alice.clear();
    alice.send({ t: "pickup", id: groundOf("Alice", "Guild Center") });
    await settle();
    expect(guildMsgs(alice)).toEqual([
      {
        t: "guild",
        screen: {
          mode: "leader",
          name: "Knights",
          alignment: "G",
          leader: "Alice",
          members: ["Bob"],
        },
      },
    ]);
    bob.clear();
    alice.send({ t: "guildAction", act: "exile", viewing: "Knights", member: "Bob" });
    await settle();
    expect(lines(bob)).toEqual([
      "*** Bob was just exiled from the Knights",
      "You have been kicked out of the Knights",
    ]);
    bob.clear();
    await say(bob, "/g hello?");
    expect(lines(bob)).toEqual(["You don't belong to a guild!"]);
  });
});

describe("IM, chat rooms and ignore", () => {
  let server: TestServer;
  let alice: Bot;
  let bob: Bot;
  let carol: Bot;

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
  /** Sends and lets the 3 s chat cooldown run out. */
  const send = async (bot: Bot, m: Parameters<Bot["send"]>[0]) => {
    bot.send(m);
    await tick(61);
  };
  const ims = (bot: Bot) => bot.inbox.filter((m) => m.t === "im");

  beforeAll(async () => {
    server = startTestServer({ rng });
    const bot = await connectBot(server.wsUrl);
    for (const name of ["Alice", "Bob", "Carol"]) {
      bot.send(make(name));
      await bot.waitFor((m) => m.t === "created");
      bot.clear();
    }
    bot.close();
    place(server.db, "Alice", 5, 5);
    place(server.db, "Bob", 7, 5);
    place(server.db, "Carol", 9, 5);
    alice = await login("Alice");
    bob = await login("Bob");
    carol = await login("Carol");
  });

  afterAll(() => {
    for (const b of [alice, bob, carol]) {
      b?.close();
    }
    server?.stop();
  });

  test("Alice /msg's Bob: her echo in the main chat, his IM window", async () => {
    alice.clear();
    bob.clear();
    await send(alice, { t: "chat", text: "/msg bob are you there?" });
    expect(lines(alice)).toEqual([">>> Alice: are you there?"]);
    expect(ims(bob)).toEqual([{ t: "im", from: "Alice", text: "are you there?", away: false }]);
  });

  test("Bob replies from his IM window: the echo in it, the IM to Alice", async () => {
    alice.clear();
    bob.clear();
    await send(bob, { t: "im", to: "Alice", text: "yes!", via: "window" });
    expect(bob.inbox.filter((m) => m.t === "imEcho")).toEqual([
      { t: "imEcho", to: "Alice", text: "yes!" },
    ]);
    expect(ims(alice)).toEqual([{ t: "im", from: "Bob", text: "yes!", away: false }]);
  });

  test("an IM to someone offline says so", async () => {
    alice.clear();
    await send(alice, { t: "chat", text: "/msg Zed hello" });
    expect(lines(alice)).toEqual([">>> Alice: hello", "Zed is not online."]);
  });

  test("Bob sets away; Alice's IM gets the bare away text", async () => {
    bob.clear();
    await send(bob, { t: "away", text: "Gone fishing" });
    expect(lines(bob)).toEqual(["*** Your away message has been turned ON."]);
    alice.clear();
    bob.clear();
    await send(alice, { t: "im", to: "Bob", text: "fish?", via: "send" });
    expect(ims(bob)).toEqual([{ t: "im", from: "Alice", text: "fish?", away: true }]);
    expect(ims(alice)).toEqual([{ t: "im", from: "Bob", text: "Gone fishing", away: false }]);
    await send(bob, { t: "away", text: null });
    expect(lines(bob)).toContain("*** Your away message has been turned OFF.");
  });

  test("both enter General Chat; Carol cannot enter Admin Chat", async () => {
    alice.clear();
    bob.clear();
    carol.clear();
    await send(alice, { t: "roomEnter", room: "general" });
    await send(bob, { t: "roomEnter", room: "general" });
    expect(bob.inbox.filter((m) => m.t === "room")).toEqual([
      {
        t: "room",
        title: "You are in: General Chat",
        entering: "     *** Entering General Chat     ***",
        users: ["Alice", "Bob"],
      },
    ]);
    expect(alice.inbox.filter((m) => m.t === "roomUser")).toEqual([
      { t: "roomUser", name: "Bob", on: true },
    ]);
    await send(carol, { t: "roomEnter", room: "admin" });
    expect(carol.inbox.filter((m) => m.t === "room")).toEqual([]);
  });

  test("Bob ignores Alice: her say and IMs stop reaching him; her room lines still do", async () => {
    bob.clear();
    await send(bob, { t: "chat", text: "/ignore Alice" });
    expect(lines(bob)).toEqual(["Added Alice to your ignore list."]);
    alice.clear();
    bob.clear();
    carol.clear();
    await send(alice, { t: "chat", text: "hello everyone" });
    expect(lines(carol)).toEqual(['Alice says "hello everyone"']);
    expect(lines(bob)).toEqual([]);
    await send(alice, { t: "chat", text: "/msg bob psst" });
    expect(ims(bob)).toEqual([]);
    await send(alice, { t: "roomSay", text: "room hello" });
    expect(bob.inbox.filter((m) => m.t === "roomLine")).toEqual([
      { t: "roomLine", text: "Alice: room hello" },
    ]);
  });
});

describe("friends, bios and medals", () => {
  let server: TestServer;
  let alice: Bot;
  let bob: Bot;
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
  const friends = (bot: Bot) => bot.inbox.filter((m) => m.t === "friends");
  const bios = (bot: Bot) => bot.inbox.filter((m) => m.t === "playerBio");
  const skill = (db: Db, name: string, skill: string, value: number) =>
    db.run("UPDATE character_skills SET value = ? WHERE character_id = ? AND skill = ?", [
      value,
      idOf(db, name),
      skillIndex(skill) + 1,
    ]);

  beforeAll(async () => {
    server = startTestServer({ rng });
    const bot = await connectBot(server.wsUrl);
    for (const name of ["Alice", "Bob", "King"]) {
      bot.send(make(name));
      await bot.waitFor((m) => m.t === "created");
      bot.clear();
    }
    bot.close();
    const db = server.db;
    place(db, "Alice", 5, 5);
    place(db, "Bob", 12, 8);
    place(db, "King", 12, 6);
    // Bob: a Mage, wanted for murder, a Novice Cook (Cooking 41 > 40).
    db.run("UPDATE characters SET faction = 1, faction_count = 1000, wanted = 1 WHERE name = ?", [
      "Bob",
    ]);
    skill(db, "Bob", "Cooking", 41);
    const acc = db
      .query<{ account_id: string }, [string]>("SELECT account_id FROM characters WHERE id = ?")
      .get(idOf(db, "King"));
    setRole(db, acc?.account_id ?? "", "immortal", "2026-11-07T00:00:00.000Z");
    alice = await login("Alice");
  });

  afterAll(() => {
    for (const b of [alice, bob, king]) {
      b?.close();
    }
    server?.stop();
  });

  test("Alice's Friends window is filled, empty, at game entry", () => {
    expect(friends(alice)).toEqual([{ t: "friends", names: [] }]);
  });

  test("Alice adds Bob while he is offline; he logs on and appears in her window", async () => {
    alice.clear();
    await say(alice, "/friends add Bob");
    expect(lines(alice)).toEqual(["*** Bob was added to your friend's list."]);
    expect(friends(alice)).toEqual([]);
    bob = await login("Bob");
    expect(friends(alice)).toEqual([{ t: "friends", names: ["Bob"] }]);
  });

  test("Bob creates the Knights at a Guild Center King drops", async () => {
    king = await login("King");
    await turn(king, "D");
    await say(king, "/drop Guild Center");
    await turn(bob, "U"); // facing the Center at (12, 7)
    const center = who("Bob").map.ground.find((g) => g.item === "Guild Center")?.id ?? "";
    bob.send({ t: "pickup", id: center });
    await settle();
    bob.clear();
    bob.send({ t: "guildCreate", name: "Knights", alignment: "G" });
    await settle();
    expect(lines(bob)).toEqual(["Guild created!", "Hail your guildmate Bob!"]);
  });

  test("Alice views Bob's bio from the player menu: title, score, guild, faction, murder lines", async () => {
    alice.clear();
    alice.send({ t: "bioRequest", id: idOf(server.db, "Bob") });
    await settle();
    const b = who("Bob");
    const score = bioScore(b.char.skills, b.char.vitals.hpMax, b.char.vitals.spMax);
    expect(bios(alice)).toEqual([
      {
        t: "playerBio",
        title: "Bob Star",
        bio: [
          "Name: Bob Star",
          "Class: Novice Cook",
          "Sex: Male",
          `Score: ${score}`,
          "Leader of the Knights",
          "Loyal to the Mages",
          "Vile Murderer",
        ],
        profile: "I have not edited my profile yet",
        medals: [],
        own: false,
      },
    ]);
  });

  test("Alice edits her own profile: closing her bio strips it and saves it", async () => {
    alice.clear();
    alice.send({ t: "bioRequest", id: idOf(server.db, "Alice") });
    await settle();
    expect(bios(alice)[0]).toMatchObject({ title: "Alice Star", own: true });
    alice.send({ t: "profileSave", text: "Hunting slimes. Daily; ask me" });
    alice.clear();
    alice.send({ t: "bioRequest", name: "alice" });
    await settle();
    expect(bios(alice)[0]).toMatchObject({ profile: "Hunting slimes Daily ask me", own: true });
  });

  test("Bob logs off and leaves Alice's list", async () => {
    alice.clear();
    bob.close();
    await settle();
    await tick(1);
    expect(friends(alice)).toEqual([{ t: "friends", names: [] }]);
  });

  test("a skill reaching 90 awards its medal, shown in her bio", async () => {
    await tick(1);
    // The skill is set on the server's player, as an operator's change would set it.
    who("Alice").char.skills[skillIndex("Cooking")] = 90;
    alice.clear();
    await tick(1);
    expect(lines(alice)).toEqual([
      "You have been awarded the silver spatula for being a master chef!",
    ]);
    alice.send({ t: "bioRequest", id: idOf(server.db, "Alice") });
    await settle();
    expect(bios(alice)[0]).toMatchObject({ medals: ["39"], own: true });
    // Calculated from the skill: dropping below 90 takes the medal off the bio again.
    who("Alice").char.skills[skillIndex("Cooking")] = 89;
    alice.clear();
    alice.send({ t: "bioRequest", id: idOf(server.db, "Alice") });
    await settle();
    expect(bios(alice)[0]).toMatchObject({ medals: [], own: true });
  });
});
