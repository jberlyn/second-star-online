/**
 * Pins for server-authority entries in docs/differences-from-fso.md that had no test of their own:
 * the cheat log's flood and bad-frame lines, monsters idle on an empty map, minted container ids,
 * the bank and shop checks, trades ending on a map change, the house placement gate, the decay
 * clock and the demolished house's vault and interior.
 */
import { beforeEach, describe, expect, test } from "bun:test";

import { CLOSE, emptyBag, HOUSE_CLOCK_FRAMES, type ServerMsg } from "@secondstaronline/shared";

import { connectBot, login, make, settle, startTestServer } from "../e2e/harness.ts";
import { createGame, type Game } from "../src/game.ts";
import { recentCheats } from "../src/persistence/admin.ts";
import { loadContainers } from "../src/persistence/containers.ts";
import { type Db, openDatabase } from "../src/persistence/database.ts";
import { findMapByCoords } from "../src/persistence/maps.ts";
import { migrate } from "../src/persistence/migrations.ts";
import { saveSettingOverride } from "../src/persistence/settings.ts";
import { applySave, editorMap } from "../src/systems/admin/worldedit.ts";
import { mintContainerId } from "../src/systems/crafting/craft.ts";
import { bankChat, buyIntent, shopListIntent } from "../src/systems/economy/intents.ts";
import { ledgerFromTemplate } from "../src/systems/economy/shop.ts";
import { offerTrade, openTrade } from "../src/systems/economy/trade.ts";
import { houseClockStep } from "../src/systems/housing/houses.ts";
import type { ItemCtx } from "../src/systems/inventory/items.ts";
import { clickNpc } from "../src/systems/monsters/npc.ts";
import { npcFileNamed } from "../src/systems/monsters/npcfiles.ts";
import { placeMonster } from "../src/systems/monsters/spawn.ts";
import { warp } from "../src/systems/world/tick.ts";
import {
  addPlayer,
  createWorld,
  type Player,
  type Room,
  type WorldMap,
} from "../src/systems/world/world.ts";
import { prepareScenarioMap } from "./helpers/scenario-map.ts";
import { ARCHIVE_NPCS, NO_CASINO, player, rngByN, setup, testMap } from "./helpers/sim.ts";

type Out = { to: string; msg: ServerMsg }[];
const chat = (out: Out, to: string) =>
  out.flatMap((m) => (m.to === to && m.msg.t === "chat" ? [m.msg.text] : []));

/** Two maps, an NPC roster and players joined by hand (as in npcs-trade.test.ts). */
function scene() {
  const map = testMap("x1000y992");
  const other = testMap("x1001y992");
  const world = createWorld();
  const rng = rngByN();
  const ctx = (): ItemCtx => ({
    world,
    rng,
    now: 0,
    shop: (npc) => {
      const t = npcFileNamed(world.npcs, npc);
      if (!t) {
        return null;
      }
      const s = world.shops.get(t.name) ?? ledgerFromTemplate(t);
      world.shops.set(t.name, s);
      return s;
    },
  });
  const join = (id: string, x: number, y: number, on: WorldMap = map): Player => {
    const p = player(id, on, x, y);
    addPlayer(world, p);
    p.loading = 0;
    return p;
  };
  const room = () => world.rooms.get(map.name) as Room;
  const put = (n: number, species: string, x: number, y: number) => {
    const s = map.slots[n - 1];
    if (!s) {
      throw new Error("slot");
    }
    s.species = species;
    s.live = placeMonster(species, x, y, rng);
    return s;
  };
  return { map, other, world, rng, ctx, join, room, put };
}

describe("the cheat log", () => {
  test("SSO: flooding and malformed frames are written to the cheat log with the sender's name", async () => {
    const server = startTestServer();
    const maker = await connectBot(server.wsUrl);
    maker.send(make("Alice"));
    await maker.waitFor((m) => m.t === "created");
    maker.close();

    const flooder = await login(server, "Alice");
    for (let i = 0; i < 100; i++) {
      flooder.send({ t: "mapReady" });
    }
    expect((await flooder.closed).code).toBe(CLOSE.rateLimited.code);

    const garbler = await login(server, "Alice");
    for (let i = 0; i < 51; i++) {
      garbler.send({ t: "teleport", x: 1 } as unknown as never);
    }
    expect((await garbler.closed).code).toBe(CLOSE.badMessage.code);
    await settle();

    const reasons = recentCheats(server.db, 10).map((c) => `${c.name}: ${c.reason}`);
    expect(reasons).toContain("Alice: Flooding");
    expect(reasons).toContain("Alice: Sending bad messages");
    await server.stop();
  });
});

describe("monsters", () => {
  test("SSO: monster AI runs only on a map with players; an empty map spawns nothing", () => {
    const empty = testMap("x1000y992");
    const busy = testMap("x1001y992");
    for (const m of [empty, busy]) {
      const slot = m.slots[0];
      if (!slot) {
        throw new Error("slot");
      }
      slot.species = "Slime";
    }
    // Every spawn gate passes and every spawn tile is (7, 3).
    const many = (n: number) => Array.from({ length: 2000 }, () => n);
    const rng = rngByN({ 80: many(1), 17: many(7), 12: many(3), 5: many(1) });
    const s = setup([empty, busy], undefined, rng);
    s.join(player("a", busy, 2, 2));
    s.run(60); // past the 45-frame drop-in after entering
    expect(busy.slots[0]?.live).not.toBeNull();
    expect(empty.slots[0]?.live).toBeNull();
    s.join(player("b", empty, 2, 2));
    s.run(60);
    expect(empty.slots[0]?.live).toMatchObject({ name: "Slime", x: 7, y: 3 });
  });
});

describe("container ids", () => {
  test("SSO: the server mints unique increasing container ids, whatever the clock says", () => {
    const world = createWorld();
    const a = mintContainerId(world, 5000);
    const b = mintContainerId(world, 5000);
    const c = mintContainerId(world, 10);
    expect([a, b, c]).toEqual([5000, 5001, 5002]);
    expect(mintContainerId(world, 9000)).toBe(9000);
  });

  test("SSO: two bare Cauldrons placed in one World Editor save get different minted ids", () => {
    const map = testMap("x1000y992");
    const s = setup([map]);
    const m = editorMap(() => map, 1000, 992).map;
    m.items = [
      { name: "Cauldron", x: 2, y: 2 },
      { name: "Cauldron", x: 4, y: 2 },
    ];
    let n = 0;
    const r = applySave(s.world, map, m, () => `id${n++}`, 5000);
    expect(r.added.map((g) => g.item)).toEqual(["Cauldron#5000", "Cauldron#5001"]);
  });
});

describe("the bank", () => {
  test("SSO: the bank account is the session character's own; another's deposit is not yours", () => {
    const s = scene();
    s.put(3, "Andero", 3, 3);
    const al = s.join("Al", 6, 4);
    const bo = s.join("Bo", 8, 4);
    al.char.gold = 100;
    bo.char.gold = 0;
    expect(chat(bankChat(ARCHIVE_NPCS, al, "/deposit 40"), "Al")).toEqual([
      "You deposit 40 gold. You now have 40 gold in the bank.",
    ]);
    expect(chat(bankChat(ARCHIVE_NPCS, bo, "/balance"), "Bo")).toEqual([
      "You have 0 gold in the bank.",
    ]);
    bankChat(ARCHIVE_NPCS, bo, "/withdraw 40");
    expect([al.char.gold, al.char.bank, bo.char.gold, bo.char.bank ?? 0]).toEqual([60, 40, 0, 0]);
  });
});

describe("shops", () => {
  test("bug fixed: an NPC shop neither lists nor sells a retired item a saved ledger still holds", () => {
    const s = scene();
    const p = s.join("Al", 6, 4);
    p.char.gold = 1000;
    p.char.bag = emptyBag();
    s.put(1, "Akadius", 7, 3);
    clickNpc(s.room(), p, 1, s.rng);
    // A ledger saved before the Classic pack retired Damaged Armor (Merius sold it).
    const ledger = s.ctx().shop?.("Akadius");
    const line = ledger?.lines.find((l) => l.line === 4);
    if (!line) {
      throw new Error("no line 4");
    }
    line.item = "Damaged Armor";
    const list = shopListIntent(s.ctx(), p, "buy");
    const rows = list.flatMap((o) => (o.msg.t === "shop" ? o.msg.rows : []));
    expect(rows.some((r) => r.item === "Damaged Armor")).toBe(false);
    expect(chat(buyIntent(s.ctx(), p, 4, 1), "Al")).toEqual([
      'Akadius says "Sorry but I\'m out of that particular item."',
    ]);
    expect(p.char.gold).toBe(1000);
    expect(p.char.bag.every((l) => l === null)).toBe(true);
  });
  test("SSO: Shop OK does nothing once the opened NPC has left the map's roster", () => {
    const s = scene();
    const p = s.join("Al", 6, 4);
    p.char.gold = 1000;
    p.char.bag = emptyBag();
    const slot = s.put(1, "Akadius", 7, 3);
    clickNpc(s.room(), p, 1, s.rng);
    shopListIntent(s.ctx(), p, "buy");
    // In the roster: a buy of line 4 (Raw Fish at 70) goes through.
    expect(chat(buyIntent(s.ctx(), p, 4, 1), "Al")).toEqual([
      'Akadius says "Thanks for the business!"',
    ]);
    expect(p.char.gold).toBe(930);
    // Off the roster (here, the slot cleared): the same OK is ignored.
    slot.species = null;
    slot.live = null;
    expect(buyIntent(s.ctx(), p, 4, 1)).toEqual([]);
    expect(p.char.gold).toBe(930);
    expect(p.char.bag[0]).toEqual({ item: "Raw Fish", qty: 1 });
  });
});

describe("trades", () => {
  test("SSO: a map change ends the server-held trade for both traders", () => {
    const s = scene();
    const a = s.join("A", 6, 4);
    const b = s.join("B", 7, 4);
    a.char.gold = 100;
    openTrade(s.world, a, "B");
    offerTrade(s.world, a, { t: "tradeOffer", gold: 5, items: [] });
    expect(b.trade).toBe(a.trade);
    const out = warp(s.world, a, s.other, 5, 5, NO_CASINO);
    expect(a.trade).toBeNull();
    expect(b.trade).toBeNull();
    expect(s.world.trades.size).toBe(0);
    expect(chat(out, "A")).toContain("Trade cancelled.");
    expect(chat(out, "B")).toContain("Trade cancelled.");
    expect(a.char.gold).toBe(100);
  });
});

describe("houses on the server (real SQL)", () => {
  let db: Db;
  let sent: Out;
  let now: string;
  const ROW_8R = Array.from({ length: 17 }, () => "8R").join(" ");

  beforeEach(() => {
    db = openDatabase();
    migrate(db);
    prepareScenarioMap(db);
    sent = [];
    now = "2026-11-05T00:00:00.000Z";
    db.run("UPDATE maps SET layer1 = ?", [
      JSON.stringify(Array.from({ length: 12 }, () => ROW_8R)),
    ]);
  });

  const game = (): Game =>
    createGame({
      db,
      send: (to, msg) => sent.push({ to, msg }),
      isoNow: () => now,
      rng: rngByN(),
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

  function enter(g: Game, id: string): Player {
    g.enter(id, false);
    g.intent(id, { t: "mapReady" });
    const p = g.world.players.get(id);
    if (!p) {
      throw new Error("not in");
    }
    return p;
  }

  /** Bob builds a Small House on x1000y992, walks in and drops an Apple into his House Vault. */
  function buildAndFill(g: Game, id: string): Player {
    const p = enter(g, id);
    p.char.bag[2] = { item: "Small House Deed", qty: 1 };
    p.char.bag[0] = { item: "House Key", qty: 1 };
    p.char.bag[1] = { item: "Apple", qty: 1 };
    g.intent(id, { t: "use", slot: 3 });
    g.intent(id, { t: "placeHouse", slot: 3, x: 10, y: 4 });
    p.x = 10;
    p.y = 5;
    g.tick();
    g.intent(id, { t: "mapReady" });
    p.facing = "N";
    g.intent(id, { t: "use", slot: 1 });
    p.itemPause = 0;
    p.x = 5;
    p.y = 9;
    p.facing = "N";
    g.intent(id, { t: "drop", slot: 2 });
    return p;
  }

  test("SSO: a placement click without the deed's Use first builds nothing and spends nothing", async () => {
    const g = game();
    const id = await makeChar(g, "Bob");
    const p = enter(g, id);
    p.char.bag[2] = { item: "Small House Deed", qty: 1 };
    g.intent(id, { t: "placeHouse", slot: 3, x: 10, y: 4 });
    expect(findMapByCoords(db, 1000, 992, 1)).toBeNull();
    expect(p.char.bag[2]).toEqual({ item: "Small House Deed", qty: 1 });
    // The same click after Use builds.
    g.intent(id, { t: "use", slot: 3 });
    g.intent(id, { t: "placeHouse", slot: 3, x: 10, y: 4 });
    expect(findMapByCoords(db, 1000, 992, 1)).not.toBeNull();
  });

  test("SSO: an online player's house clock is due every 1,230 frames", () => {
    expect(HOUSE_CLOCK_FRAMES).toBe(1230);
    const p = player("a", testMap("x1000y992"), 2, 2);
    p.houseClock = HOUSE_CLOCK_FRAMES;
    const due: number[] = [];
    for (let frame = 1; frame <= 2 * HOUSE_CLOCK_FRAMES; frame++) {
      if (houseClockStep(p)) {
        due.push(frame);
      }
    }
    expect(due).toEqual([1230, 2460]);
  });

  test("SSO: house decay reads the date in the operator's houseDecayTimeZone", async () => {
    let g = game();
    const bob = await makeChar(g, "Bob");
    buildAndFill(g, bob);
    g.leave(bob);
    // 23:00 on 31 December UTC is already 1 January in Tokyo: November is two months back.
    saveSettingOverride(db, "houseDecayTimeZone", "Asia/Tokyo", now);
    now = "2026-12-31T23:00:00.000Z";
    g = game();
    const ann = await makeChar(g, "Ann");
    g.enter(ann, false);
    expect(findMapByCoords(db, 1000, 992, 1)).toBeNull();
  });

  test("SSO: decay deletes the House Vault's contents, and an occupied interior waits for its occupant", async () => {
    let g = game();
    const bob = await makeChar(g, "Bob");
    buildAndFill(g, bob);
    expect(texts(sent, bob)).toContain("You drop a Apple into the container.");
    g.leave(bob);
    g = game();
    expect(loadContainers(db).get("Bob's House Vault")).toEqual(["Apple"]);
    // Ann stands inside Bob's house when the day's sweep runs.
    const ann = await makeChar(g, "Ann");
    const a = enter(g, ann);
    a.x = 10;
    a.y = 5;
    g.tick();
    g.intent(ann, { t: "mapReady" });
    expect(a.map.name).toBe("xH11000yH1992");
    now = "2027-01-10T00:00:00.000Z";
    a.houseClock = 1;
    g.tick();
    expect(g.world.houses.size).toBe(0);
    expect(loadContainers(db).get("Bob's House Vault")).toBeUndefined();
    expect(findMapByCoords(db, 1000, 992, 1)).not.toBeNull();
    // Once she leaves, the interior goes.
    g.leave(ann);
    g.tick();
    expect(findMapByCoords(db, 1000, 992, 1)).toBeNull();
  });
});

const texts = (out: Out, to: string) => chat(out, to);
