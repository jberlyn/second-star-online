/**
 * The activity log's coverage (issue #25): every source and sink of a player's items and gold
 * writes an event. Each test sets a scene up, starts the activity ledger (`resetHoldings`), runs the
 * real system, then checks the events and that `checkHoldings` finds no change the events did not
 * explain.
 */
import { beforeEach, describe, expect, test } from "bun:test";

import {
  ADMINISTRATOR,
  DEFAULT_DEATH_DROPS,
  type DeathDropRules,
  ORAKU,
  type ServerMsg,
  skillIndex,
  tileLoc,
} from "@secondstaronline/shared";

import { createGame, type Game } from "../src/game.ts";
import { setRole } from "../src/persistence/accounts.ts";
import { type Db, openDatabase } from "../src/persistence/database.ts";
import { migrate } from "../src/persistence/migrations.ts";
import { type ActivityEntry, checkHoldings, resetHoldings } from "../src/systems/admin/activity.ts";
import { handleDrop } from "../src/systems/admin/drop.ts";
import { bjBid, bjSit, bjStand, type CasinoDeps } from "../src/systems/casino/blackjack.ts";
import { casinoLeave, casinoMapChange } from "../src/systems/casino/index.ts";
import { pollAttack, setAttackHeld } from "../src/systems/combat/melee.ts";
import { craftIntent } from "../src/systems/crafting/craft.ts";
import { depositContainer, withdrawContainer } from "../src/systems/economy/containers.ts";
import { questGive } from "../src/systems/economy/quests.ts";
import { acceptTrade, offerTrade, openTrade } from "../src/systems/economy/trade.ts";
import { depositVault, withdrawVault } from "../src/systems/economy/vault.ts";
import {
  actionIntent,
  crystalsIntent,
  dropIntent,
  giveIntent,
  goldIntent,
  grab,
  type ItemCtx,
  ItemOut,
  pickupIntent,
  useIntent,
} from "../src/systems/inventory/items.ts";
import { monsterAttack } from "../src/systems/monsters/attack.ts";
import { setNpcFile } from "../src/systems/monsters/npcfiles.ts";
import type { MonsterSlot } from "../src/systems/monsters/slots.ts";
import { setAssassinMode } from "../src/systems/social/assassin.ts";
import { castIntent } from "../src/systems/spells/cast.ts";
import { tick } from "../src/systems/world/tick.ts";
import {
  addPlayer,
  createWorld,
  type GroundItem,
  type Player,
  type Room,
  type World,
} from "../src/systems/world/world.ts";
import { b64, makePng } from "./helpers/png.ts";
import { prepareScenarioMap } from "./helpers/scenario-map.ts";
import { ARCHIVE_NPCS, NO_CASINO, player, rngByN, setup, testMap } from "./helpers/sim.ts";

type Out = { to: string; msg: ServerMsg }[];

/** A map with players, an item ctx and a tick runner (as tests/inventory.test.ts builds it). */
function scene(rngQueues: Record<number, number[]> = {}, opts: { canPvp?: string } = {}) {
  const map = testMap("x1000y992");
  if (opts.canPvp) {
    map.flags.canPvp = opts.canPvp;
  }
  const world: World = createWorld();
  const rng = rngByN(rngQueues);
  const now = 1_000_000;
  const ctx = (): ItemCtx => ({ world, rng, now });
  const join = (id: string, x: number, y: number): Player => {
    const p = player(id, map, x, y);
    addPlayer(world, p);
    p.loading = 0;
    p.flicker = 0;
    return p;
  };
  const room = (): Room => world.rooms.get(map.name) as Room;
  const deps = {
    loadMap: () => map,
    casino: NO_CASINO,
    saveIntervalTicks: 600,
    stepFrames: 16,
    rng,
    now: () => now,
    lootDecayMinutes: 30,
    deathDrops: DEFAULT_DEATH_DROPS as DeathDropRules,
  };
  const run = (n = 1): Out => {
    const all: Out = [];
    for (let i = 0; i < n; i++) {
      all.push(...tick(world, deps).out);
    }
    return all;
  };
  return { map, world, rng, deps, ctx, join, room, run };
}

const put = (p: Player, slot: number, item: string, qty = 1) => {
  p.char.bag[slot - 1] = { item, qty };
};

/** The ledger starts here, after the scene's own changes. */
const start = (...ps: Player[]) => {
  for (const p of ps) {
    resetHoldings(p);
  }
};

/** The logged events, trimmed to what these tests check. */
function logged(world: World, type?: string) {
  return world.activity
    .filter((e) => type === undefined || e.type === type)
    .map((e: ActivityEntry) => ({
      type: e.type,
      who: e.character,
      ...(e.other !== null ? { other: e.other } : {}),
      ...(e.otherId !== null ? { otherId: e.otherId } : {}),
      ...(e.item !== null ? { item: e.item } : {}),
      ...(e.qty !== 0 ? { qty: e.qty } : {}),
      ...(e.gold !== 0 ? { gold: e.gold } : {}),
    }));
}

/** No player's carried change went unexplained. */
const balanced = (world: World, ...ps: Player[]) => {
  for (const p of ps) {
    expect(checkHoldings(world, p)).toBe(0);
  }
  expect(world.activity.filter((e) => e.type === "unlogged")).toEqual([]);
};

const orc = (slot: MonsterSlot, name: string, hp: number, x: number, y: number) => {
  slot.species = name;
  slot.live = {
    name,
    hp,
    x,
    y,
    facing: "S",
    anim: 0,
    fromX: x,
    fromY: y,
    queue: [],
    hitCountb: 0,
  };
};

describe("using items", () => {
  test("eating an apple logs one apple used", () => {
    const s = scene({ 3: [2] });
    const a = s.join("A", 5, 5);
    put(a, 1, "Apple", 2);
    a.char.vitals.hp = 10;
    a.char.hunger = 1000;
    start(a);
    useIntent(s.ctx(), s.room(), a, 1);
    expect(logged(s.world)).toEqual([{ type: "use", who: "A", item: "Apple", qty: -1 }]);
    balanced(s.world, a);
  });
});

describe("drop, give and pickup", () => {
  test("a drop logs the items leaving the bag, and its pile names the dropper", () => {
    const s = scene();
    const a = s.join("A", 5, 5);
    a.facing = "E";
    put(a, 1, "Long Sword", 3);
    start(a);
    dropIntent(s.ctx(), s.room(), a, 1, 2);
    expect(logged(s.world)).toEqual([{ type: "drop", who: "A", item: "Long Sword", qty: -2 }]);
    expect(s.map.ground[0]?.droppedBy).toEqual({ id: "A", name: "A" });
    balanced(s.world, a);
  });

  test("picking up your own drop names nobody; another player's drop names them", () => {
    const s = scene();
    const a = s.join("A", 5, 5);
    const b = s.join("B", 7, 5);
    a.facing = "E";
    put(a, 1, "Knife", 2);
    dropIntent(s.ctx(), s.room(), a, 1, 1);
    start(a, b);
    s.world.activity.length = 0;
    const g = s.map.ground[0] as GroundItem;
    a.facing = "E";
    pickupIntent(s.ctx(), s.room(), a, g.id);
    expect(logged(s.world)).toEqual([{ type: "pickup", who: "A", item: "Knife", qty: 1 }]);
    dropIntent(s.ctx(), s.room(), a, 1, 1);
    s.world.activity.length = 0;
    b.facing = "W";
    const g2 = s.map.ground[0] as GroundItem;
    pickupIntent(s.ctx(), s.room(), b, g2.id);
    expect(logged(s.world)).toEqual([
      { type: "pickup", who: "B", other: "A", otherId: "A", item: "Knife", qty: 1 },
    ]);
    balanced(s.world, a, b);
  });

  test("a crystal pile picked up with Ctrl logs n crystals", () => {
    const s = scene();
    const a = s.join("A", 5, 5);
    a.facing = "E";
    s.map.ground.push({
      id: "g1",
      item: "5 Blue Crystal",
      x: 6,
      y: 5,
      kind: "loot",
      expiresAt: null,
    });
    start(a);
    actionIntent(s.ctx(), s.room(), a);
    expect(logged(s.world)).toEqual([{ type: "pickup", who: "A", item: "Blue Crystal", qty: 5 }]);
    expect(s.world.activity[0]?.details).toEqual({ from: "loot" });
    balanced(s.world, a);
  });

  test("an item given: the giver logs it leaving and the receiver logs it arriving, each naming the other", () => {
    const s = scene();
    const a = s.join("A", 5, 5);
    const b = s.join("B", 6, 5);
    a.facing = "E";
    put(a, 1, "Long Sword", 3);
    start(a, b);
    giveIntent(s.ctx(), s.room(), a, 1, 3);
    s.run(60);
    expect(logged(s.world).filter((e) => e.type === "give")).toEqual([
      { type: "give", who: "A", other: "B", otherId: "B", item: "Long Sword", qty: -3 },
      { type: "give", who: "B", other: "A", otherId: "A", item: "Long Sword", qty: 3 },
    ]);
    balanced(s.world, a, b);
  });

  test("crystals given land at once, logged for both", () => {
    const s = scene();
    const a = s.join("A", 5, 5);
    const b = s.join("B", 6, 5);
    a.facing = "E";
    put(a, 1, "Red Crystal", 10);
    start(a, b);
    crystalsIntent(s.ctx(), s.room(), a, 1, 4, "give");
    expect(logged(s.world)).toEqual([
      { type: "give", who: "A", other: "B", otherId: "B", item: "Red Crystal", qty: -4 },
      { type: "give", who: "B", other: "A", otherId: "A", item: "Red Crystal", qty: 4 },
    ]);
    balanced(s.world, a, b);
  });

  test("crystals dropped log the crystals leaving", () => {
    const s = scene();
    const a = s.join("A", 5, 5);
    a.facing = "E";
    put(a, 1, "Red Crystal", 10);
    start(a);
    crystalsIntent(s.ctx(), s.room(), a, 1, 4, "drop");
    expect(logged(s.world)).toEqual([{ type: "drop", who: "A", item: "Red Crystal", qty: -4 }]);
    balanced(s.world, a);
  });

  test("gold given logs both sides; gold dropped and picked back up logs both ways", () => {
    const s = scene();
    const a = s.join("A", 5, 5);
    const b = s.join("B", 6, 5);
    a.facing = "E";
    a.char.gold = 100;
    start(a, b);
    goldIntent(s.ctx(), s.room(), a, 50);
    expect(logged(s.world)).toEqual([
      { type: "give", who: "A", other: "B", otherId: "B", gold: -50 },
      { type: "give", who: "B", other: "A", otherId: "A", gold: 50 },
    ]);
    s.world.activity.length = 0;
    a.facing = "S";
    goldIntent(s.ctx(), s.room(), a, 20);
    const g = s.map.ground[0] as GroundItem;
    pickupIntent(s.ctx(), s.room(), a, g.id);
    expect(logged(s.world)).toEqual([
      { type: "drop", who: "A", gold: -20 },
      { type: "pickup", who: "A", gold: 20 },
    ]);
    balanced(s.world, a, b);
  });

  test("an item grabbed into a full bag is destroyed, logged as lost and not carried", () => {
    const s = scene();
    const b = s.join("B", 6, 5);
    b.char.bag = b.char.bag.map((_, i) => ({ item: `Rock${i}`, qty: 1 }));
    const g: GroundItem = { id: "g1", item: "Knife", x: 6, y: 5, kind: "drop", expiresAt: null };
    s.map.ground.push(g);
    start(b);
    grab(s.ctx(), s.room(), new ItemOut(s.room()), b, g);
    expect(logged(s.world)).toEqual([{ type: "pickup", who: "B", item: "Knife" }]);
    expect(s.world.activity[0]?.details).toEqual({ lost: 1 });
    balanced(s.world, b);
  });
});

describe("combat", () => {
  test("a melee kill logs the kill and the loot it left, credited to the killer", () => {
    const s = scene({ 4: [1] });
    const a = s.join("A", 5, 5);
    orc(s.map.slots[0] as MonsterSlot, "Slime", 0, 5, 4);
    start(a);
    setAttackHeld(a, true);
    s.run(2);
    const kill = logged(s.world).filter((e) => e.type === "kill" || e.type === "loot");
    expect(kill).toEqual([
      { type: "kill", who: "A", other: "Slime" },
      { type: "loot", who: "A", other: "Slime" },
    ]);
    expect(s.world.activity.find((e) => e.type === "loot")?.details).toEqual({ placedGold: 2 });
    balanced(s.world, a);
  });

  test("a weapon break logs the weapon lost and its damaged form gained", () => {
    const s = scene({ 661: [1] });
    const a = s.join("A", 5, 5);
    a.char.equip.weapon = "Long Sword";
    orc(s.map.slots[0] as MonsterSlot, "Orc", 500, 5, 4);
    start(a);
    setAttackHeld(a, true);
    s.run(1);
    expect(logged(s.world, "transform")).toEqual([
      { type: "transform", who: "A", item: "Long Sword", qty: -1 },
      { type: "transform", who: "A", item: "Damaged Sword, Long", qty: 1 },
    ]);
    balanced(s.world, a);
  });
});

describe("death", () => {
  test("a wanted death drops one item, logged as a death drop with the death", () => {
    const s = scene({ 2: [1] });
    const a = s.join("A", 5, 5);
    put(a, 1, "Apple", 2);
    put(a, 2, "Knife");
    a.char.wanted = true;
    a.char.vitals.hp = 0;
    a.lastToHitMe = "a Slime";
    start(a);
    s.run(1);
    expect(logged(s.world).filter((e) => e.type !== "map")).toEqual([
      { type: "death", who: "A", other: "a Slime" },
      { type: "deathDrop", who: "A", item: "Apple", qty: -1 },
    ]);
    expect(s.map.ground[0]?.droppedBy).toEqual({ id: "A", name: "A" });
    balanced(s.world, a);
  });

  test("a faction member's death logs the head it leaves, placed on the ground", () => {
    const s = scene();
    const a = s.join("A", 5, 5);
    a.char.faction = { key: "mage", tier: 0 };
    a.char.vitals.hpMax = 30;
    a.char.vitals.hp = 0;
    start(a);
    s.run(1);
    const head = s.world.activity.filter((e) => e.type === "deathDrop");
    expect(head.map((e) => [e.item, e.qty, e.details])).toEqual([
      [s.map.ground[0]?.item ?? "", 0, { placed: 1 }],
    ]);
    expect(head[0]?.item).toContain("Head");
    balanced(s.world, a);
  });

  test("a wanted death's gold drop is logged", () => {
    const s = scene({ 2: [1], 500: [470] });
    const a = s.join("A", 5, 5);
    a.char.gold = 500;
    a.char.wanted = true;
    a.char.vitals.hp = 0;
    start(a);
    s.run(1);
    expect(logged(s.world, "deathDrop")).toEqual([{ type: "deathDrop", who: "A", gold: -470 }]);
    balanced(s.world, a);
  });

  test("a player's kill logs the death naming the killer and the killer's player kill", () => {
    const s = scene({ 2: [1, 1] });
    s.deps.deathDrops = { ...DEFAULT_DEATH_DROPS, who: "pvp" };
    const a = s.join("A", 5, 5);
    const b = s.join("B", 9, 9);
    put(b, 1, "Knife", 1);
    b.lastToHitMe = "A";
    b.lastToHitId = a.id;
    b.char.vitals.hp = 0;
    start(a, b);
    s.run(1);
    expect(logged(s.world).filter((e) => e.type !== "map")).toEqual([
      { type: "death", who: "B", other: "A", otherId: "A" },
      { type: "playerKill", who: "A", other: "B", otherId: "B" },
      { type: "deathDrop", who: "B", item: "Knife", qty: -1 },
    ]);
    balanced(s.world, a, b);
  });

  test("a killer who has logged off is still named and linked on the victim's death", () => {
    const s = scene({ 2: [1, 1] });
    const b = s.join("B", 9, 9);
    b.lastToHitMe = "Gone";
    b.lastToHitId = "gone-id";
    b.char.vitals.hp = 0;
    start(b);
    s.run(1);
    expect(logged(s.world, "death")).toEqual([
      { type: "death", who: "B", other: "Gone", otherId: "gone-id" },
    ]);
    expect(logged(s.world, "playerKill")).toEqual([]);
  });
});

describe("admin", () => {
  test("/drop logs what the admin made, as placed on the ground", () => {
    const s = scene();
    const a = s.join("A", 5, 5);
    a.role = ADMINISTRATOR;
    a.facing = "E";
    start(a);
    handleDrop(s.ctx(), s.room(), a, "20 Apple");
    a.facing = "W";
    handleDrop(s.ctx(), s.room(), a, "50 gold");
    expect(logged(s.world)).toEqual([
      { type: "admin", who: "A", item: "Apple" },
      { type: "admin", who: "A" },
    ]);
    expect(s.world.activity.map((e) => e.details)).toEqual([{ placed: 20 }, { placedGold: 50 }]);
    balanced(s.world, a);
  });
});

describe("using items up", () => {
  test("a coloured key spent on its door is logged as used", () => {
    const s = scene();
    const a = s.join("A", 5, 5);
    s.map.ground.push({ id: "d", item: "Steel Door", x: 5, y: 4, kind: "drop", expiresAt: null });
    put(a, 2, "Steel Key", 2);
    start(a);
    useIntent(s.ctx(), s.room(), a, 2);
    expect(logged(s.world)).toEqual([{ type: "use", who: "A", item: "Steel Key", qty: -1 }]);
    balanced(s.world, a);
  });

  test("a book read and learned is logged as used", () => {
    const s = scene();
    const a = s.join("A", 5, 5);
    a.char.stats.dex = 20;
    put(a, 1, "Fireball Book");
    start(a);
    useIntent(s.ctx(), s.room(), a, 1);
    expect(logged(s.world)).toEqual([{ type: "use", who: "A", item: "Fireball Book", qty: -1 }]);
    balanced(s.world, a);
  });

  test("a book that teaches nothing stays and logs nothing", () => {
    const s = scene();
    const a = s.join("A", 5, 5);
    a.char.stats.dex = 10;
    put(a, 1, "Meteor Book");
    start(a);
    useIntent(s.ctx(), s.room(), a, 1);
    expect(logged(s.world)).toEqual([]);
    balanced(s.world, a);
  });

  test("seeds planted are logged as used", () => {
    const map = testMap("x1000y992", [], () => "G1");
    const sim = setup([map]);
    const a = player("A", map, 5, 6);
    sim.join(a);
    const row = (map.layers[1][4] ?? "").split(" ");
    row[4] = "SL";
    map.layers[1][4] = row.join(" ");
    const room = sim.world.rooms.get(map.name) as Room;
    put(a, 1, "Seeds", 3);
    start(a);
    useIntent({ world: sim.world, rng: rngByN(), now: 0 }, room, a, 1);
    expect(logged(sim.world)).toEqual([{ type: "use", who: "A", item: "Seeds", qty: -1 }]);
    balanced(sim.world, a);
  });

  test("a vehicle deed built is logged as used; the cannonball fired is too", () => {
    const map = testMap("x1000y992", [], (x) => (x >= 8 ? "W1" : "G1"));
    const sim = setup([map]);
    const ann = player("Ann", map, 7, 5);
    ann.flicker = 0;
    sim.join(ann);
    const room = sim.world.rooms.get(map.name) as Room;
    const ctx = (): ItemCtx => ({ world: sim.world, rng: rngByN(), now: 1_000_000 });
    ann.facing = "E";
    put(ann, 1, "Battleship Deed");
    start(ann);
    useIntent(ctx(), room, ann, 1);
    expect(logged(sim.world)).toEqual([
      { type: "use", who: "Ann", item: "Battleship Deed", qty: -1 },
    ]);
    ann.itemPause = 0;
    actionIntent(ctx(), room, ann);
    expect(ann.vehicle).toBe("Battleship");
    put(ann, 2, "Cannonball", 3);
    start(ann);
    sim.world.activity.length = 0;
    ann.facing = "W";
    setAttackHeld(ann, true);
    sim.run(1);
    setAttackHeld(ann, false);
    expect(logged(sim.world, "use")).toEqual([
      { type: "use", who: "Ann", item: "Cannonball", qty: -1 },
    ]);
    balanced(sim.world, ann);
  });

  test("a bow's crystal is logged as used per shot", () => {
    const s = scene();
    const a = s.join("A", 5, 5);
    a.facing = "E";
    a.timers.canAttack = true;
    a.char.equip = { ...a.char.equip, weapon: "Wooden Bow", offHand: "Blue Arrows" };
    put(a, 1, "Blue Crystal", 5);
    orc(s.map.slots[0] as MonsterSlot, "Overlord", 1000, 6, 5);
    start(a);
    setAttackHeld(a, true);
    pollAttack(s.room(), a, { rng: s.rng, now: 0, world: s.world });
    expect(logged(s.world)).toEqual([{ type: "use", who: "A", item: "Blue Crystal", qty: -1 }]);
    balanced(s.world, a);
  });

  test("a spell's crystals are logged as used, naming the spell", () => {
    const s = scene();
    const a = s.join("A", 6, 6);
    a.char.vitals = { ...a.char.vitals, sp: 200, spMax: 200 };
    a.spell.book = ["Minor Heal"];
    put(a, 1, "Blue Crystal", 10);
    start(a);
    castIntent(s.room(), a, "Minor Heal", 200, 100, { rng: s.rng, world: s.world });
    const used = s.world.activity.filter((e) => e.type === "use");
    expect(used.map((e) => [e.item, e.qty < 0, e.details?.spell])).toEqual([
      ["Blue Crystal", true, "Minor Heal"],
    ]);
    balanced(s.world, a);
  });
});

describe("pigs", () => {
  test("a Pig dropped is logged leaving as a monster; grabbed back it is logged as picked up", () => {
    const s = scene();
    const a = s.join("A", 5, 5);
    a.facing = "E";
    put(a, 1, "Pig");
    start(a);
    dropIntent(s.ctx(), s.room(), a, 1);
    a.itemPause = 0;
    actionIntent(s.ctx(), s.room(), a);
    expect(logged(s.world)).toEqual([
      { type: "drop", who: "A", item: "Pig", qty: -1 },
      { type: "pickup", who: "A", other: "Pig", item: "Pig", qty: 1 },
    ]);
    balanced(s.world, a);
  });
});

describe("vault and containers", () => {
  test("a vault deposit and withdrawal are logged out of and back into the bag", () => {
    const s = scene();
    const a = s.join("A", 5, 5);
    put(a, 1, "Apple", 5);
    start(a);
    depositVault(s.world, a, 1, 3);
    a.vaultOpen = true;
    withdrawVault(s.world, a, 1, s.rng);
    expect(logged(s.world)).toEqual([
      { type: "vault", who: "A", item: "Apple", qty: -3 },
      { type: "vault", who: "A", item: "Apple", qty: 1 },
    ]);
    balanced(s.world, a);
  });

  test("a container deposit and withdrawal are logged naming the container", () => {
    const s = scene();
    const a = s.join("A", 5, 5);
    put(a, 1, "Apple", 2);
    start(a);
    depositContainer(s.world, a, 1, "Gold Chest", 2);
    a.container = { name: "Gold Chest", shown: ["Apple", "Apple"] };
    withdrawContainer(s.world, a, 1, s.rng);
    expect(logged(s.world)).toEqual([
      { type: "container", who: "A", other: "Gold Chest", item: "Apple", qty: -2 },
      { type: "container", who: "A", other: "Gold Chest", item: "Apple", qty: 1 },
    ]);
    balanced(s.world, a);
  });
});

describe("gold to an NPC and quests", () => {
  test("gold given to an NPC is logged as paid to it", () => {
    const s = scene();
    const a = s.join("A", 5, 5);
    a.char.gold = 100;
    orc(s.map.slots[0] as MonsterSlot, "Amber", 10, 5, 4);
    start(a);
    goldIntent(s.ctx(), s.room(), a, 30);
    expect(logged(s.world)).toEqual([{ type: "pay", who: "A", other: "Amber", gold: -30 }]);
    balanced(s.world, a);
  });

  test("a quest hand-in logs the item given and the reward, naming the NPC", () => {
    const s = scene();
    const a = s.join("A", 5, 5);
    s.world.questLines[0] = "Stephie:Fishle:Yellow Potion";
    put(a, 1, "Fishle");
    start(a);
    questGive(s.world, a, 0, "Stephie", s.rng);
    expect(logged(s.world)).toEqual([
      { type: "quest", who: "A", other: "Stephie", item: "Fishle", qty: -1 },
      { type: "quest", who: "A", other: "Stephie", item: "Yellow Potion", qty: 1 },
    ]);
    balanced(s.world, a);
  });

  test("Oraku's exchange logs the item given and the reward", () => {
    const s = scene();
    const a = s.join("A", 5, 5);
    put(a, 1, ORAKU!.item);
    start(a);
    questGive(s.world, a, 0, ORAKU!.npc, s.rng);
    expect(logged(s.world)).toEqual([
      { type: "quest", who: "A", other: ORAKU!.npc, item: ORAKU!.item, qty: -1 },
      { type: "quest", who: "A", other: ORAKU!.npc, item: ORAKU!.reward, qty: 1 },
    ]);
    balanced(s.world, a);
  });

  test("a head given to a faction leader logs the head given", () => {
    const s = scene();
    const a = s.join("A", 5, 5);
    orc(s.map.slots[0] as MonsterSlot, "Angela", 10, 5, 4);
    s.world.factionPowers = { mage: 27, warrior: 123, adventurer: 0 };
    a.char.vitals.hpMax = 60;
    put(a, 4, "Warrior's Head");
    start(a);
    questGive(s.world, a, 3, "Angela", s.rng);
    expect(logged(s.world)).toEqual([
      { type: "quest", who: "A", other: "Angela", item: "Warrior's Head", qty: -1 },
    ]);
    balanced(s.world, a);
  });
});

describe("trade", () => {
  test("a settled trade logs each side's items and gold for both, each naming the other", () => {
    const s = scene();
    const a = s.join("A", 6, 4);
    const b = s.join("B", 7, 4);
    a.char.gold = 100;
    put(b, 1, "Knife", 2);
    start(a, b);
    openTrade(s.world, a, "B");
    offerTrade(s.world, a, { t: "tradeOffer", gold: 40, items: [] });
    offerTrade(s.world, b, { t: "tradeOffer", gold: 0, items: [{ slot: 1, qty: 2 }] });
    acceptTrade(s.world, a);
    acceptTrade(s.world, b);
    expect(logged(s.world)).toEqual([
      { type: "trade", who: "A", other: "B", otherId: "B", gold: -40 },
      { type: "trade", who: "B", other: "A", otherId: "A", gold: 40 },
      { type: "trade", who: "B", other: "A", otherId: "A", item: "Knife", qty: -2 },
      { type: "trade", who: "A", other: "B", otherId: "B", item: "Knife", qty: 2 },
    ]);
    balanced(s.world, a, b);
  });
});

describe("crafting and gathering", () => {
  function bench(station: string, rng = rngByN()) {
    const map = testMap("x1000y992");
    const sim = setup([map], undefined, rng);
    const a = player("a", map, 5, 6);
    sim.join(a);
    const room = sim.world.rooms.get(map.name) as Room;
    map.ground.push({ id: "st", item: station, x: 5, y: 5, kind: "admin", expiresAt: null });
    const ctx = { world: sim.world, rng, stepLength: 16 };
    return { ...sim, a, room, ctx };
  }

  test("a smithing job logs the materials going in and the result coming out", () => {
    const k = bench("Anvil");
    k.a.char.equip.weapon = "Blacksmith Hammer";
    put(k.a, 1, "Damaged Sword, Long");
    put(k.a, 2, "Chunk of Iron");
    start(k.a);
    craftIntent(k.room, k.a, 1, k.ctx);
    k.run(500);
    expect(logged(k.world, "craft")).toEqual(
      expect.arrayContaining([
        { type: "craft", who: "a", item: "Damaged Sword, Long", qty: -1 },
        { type: "craft", who: "a", item: "Chunk of Iron", qty: -1 },
        { type: "craft", who: "a", item: "Long Sword", qty: 1 },
      ]),
    );
    expect(logged(k.world, "craft")).toHaveLength(3);
    balanced(k.world, k.a);
  });

  /** A player at (5, 6) facing north at a tree on (5, 5), holding `tool`. */
  function swinger(tool: string, rng = rngByN()) {
    const map = testMap("x1000y992", [[5, 5]]);
    const sim = setup([map], undefined, rng);
    const a = player("a", map, 5, 6);
    a.char.equip.weapon = tool;
    sim.join(a);
    const swings = (n: number) => {
      let done = 0;
      setAttackHeld(a, true);
      while (done < n) {
        const o = sim.run(1);
        done += o.filter(
          (m) => m.to === "a" && m.msg.t === "delta" && m.msg.events.some((e) => e.e === "swing"),
        ).length;
      }
      setAttackHeld(a, false);
    };
    return { ...sim, map, a, swings };
  }

  test("logs from a felled tree are logged as gathered, placed on the ground", () => {
    const g = swinger("Axe", rngByN({ 3: Array(2000).fill(1), 12: [1] }));
    g.a.char.skills[skillIndex("Lumberjacking")] = 5;
    g.a.gather.Axe = 1;
    start(g.a);
    g.swings(1);
    expect(logged(g.world, "gather")).toEqual([{ type: "gather", who: "a", item: "Logs" }]);
    expect(g.world.activity.find((e) => e.type === "gather")?.details).toEqual({ placed: 1 });
    balanced(g.world, g.a);
  });

  test("treasure dug up is logged as gathered gold, placed on the ground", () => {
    const g = swinger("Shovel", rngByN({ 5: [1], 29: [...Array(69).fill(1), 14] }));
    g.world.treasureMaps = ["x1000y992"];
    g.world.treasure = { map: "x1000y992", item: "300 Gold" };
    const row = (g.map.layers[1][4] ?? "").split(" ");
    row[4] = "G3";
    g.map.layers[1][4] = row.join(" ");
    g.a.gather.Shovel = 1;
    start(g.a);
    g.swings(1);
    expect(g.world.activity.filter((e) => e.type === "gather").map((e) => e.details)).toEqual([
      { treasure: true, placedGold: 300 },
    ]);
    balanced(g.world, g.a);
  });

  test("a fish caught is logged as gathered", () => {
    const map = testMap("x1000y992", [], (x, y) => (x === 5 && y === 5 ? "W1" : "G1"));
    const sim = setup([map], undefined, rngByN({ 28: [1] }));
    const a = player("a", map, 5, 6);
    a.char.equip.weapon = "Fishing Pole";
    sim.join(a);
    a.char.skills[skillIndex("Fishing")] = 20;
    start(a);
    setAttackHeld(a, true);
    sim.run(1);
    expect(logged(sim.world, "gather")).toEqual([{ type: "gather", who: "a", item: "Trout" }]);
    balanced(sim.world, a);
  });
});

describe("spells and armour", () => {
  test("a monster killed by a player's spell logs the kill and the loot for the caster", () => {
    const rng = rngByN();
    const map = testMap("x1000y992");
    const sim = setup([map], undefined, rng);
    const a = player("Ann", map, 6, 6);
    a.flicker = 0;
    a.char.vitals = { ...a.char.vitals, sp: 200, spMax: 200 };
    sim.join(a);
    const slot = map.slots[0] as MonsterSlot;
    orc(slot, "Slime", 1, 6, 4);
    slot.pause = 10_000;
    const room = sim.world.rooms.get(map.name) as Room;
    a.spell.book = ["Fireball"];
    put(a, 1, "Red Crystal", 10);
    start(a);
    const t = tileLoc(6, 4);
    castIntent(room, a, "Fireball", t.h, t.v, { rng, world: sim.world });
    sim.run(2);
    expect(slot.live).toBeNull();
    expect(logged(sim.world).filter((e) => e.type === "kill")).toEqual([
      { type: "kill", who: "Ann", other: "Slime" },
    ]);
    balanced(sim.world, a);
  });

  test("food made by Create Food is logged as made by a spell", () => {
    const rng = rngByN();
    const map = testMap("x1000y992");
    const sim = setup([map], undefined, rng);
    const a = player("Ann", map, 6, 6);
    a.flicker = 0;
    a.char.vitals = { ...a.char.vitals, sp: 200, spMax: 200 };
    sim.join(a);
    const room = sim.world.rooms.get(map.name) as Room;
    a.spell.book = ["Create Food"];
    for (const [i, c] of ["Blue", "Red", "Green", "Yellow", "White", "Black"].entries()) {
      put(a, i + 1, `${c} Crystals`, 10);
    }
    start(a);
    const t = tileLoc(6, 6);
    castIntent(room, a, "Create Food", t.h, t.v, { rng, world: sim.world });
    sim.run(5);
    const made = sim.world.activity.filter((e) => e.type === "spell");
    expect(made.map((e) => [e.qty, e.details])).toEqual([[1, { spell: "Create Food" }]]);
    balanced(sim.world, a);
  });

  test("armour broken by a monster's hit logs the piece lost and its damaged form gained", () => {
    const map = testMap("x1000y992");
    const sim = setup([map]);
    const a = player("a", map, 5, 5);
    a.flicker = 0;
    a.char.skills = a.char.skills.map(() => 0);
    a.char.equip.body = "Plate Armor";
    a.char.equip.head = "Plate Armor";
    a.char.equip.offHand = "Plate Armor";
    sim.join(a);
    const slot = map.slots[0] as MonsterSlot;
    orc(slot, "Orc", 50, 5, 6);
    a.lastToHitMe = "an Orc";
    start(a);
    monsterAttack(map, slot, a, {
      // random(10) = 1 attacks; the break roll at Sta 10, hunger 50000 is random(761) = 1.
      rng: rngByN({ 10: [1], 761: [1], 3: [1, 1, 1, 1] }),
      npcs: ARCHIVE_NPCS,
      invulnerable: () => false,
      world: sim.world,
    });
    const t = logged(sim.world, "transform");
    expect(t).toHaveLength(2);
    expect(t[0]).toMatchObject({ item: "Plate Armor", qty: -1 });
    expect(t[1]?.qty).toBe(1);
    balanced(sim.world, a);
  });
});

describe("casino", () => {
  function table(cards: number[]) {
    const map = testMap("x1000y992");
    const sim = setup([map]);
    const rng = rngByN({ 13: cards });
    const tbl: GroundItem = {
      id: "bj",
      item: "Blackjack Table",
      x: 10,
      y: 5,
      kind: "drop",
      expiresAt: null,
    };
    map.ground.push(tbl);
    const offline: { id: string; gold: number }[] = [];
    const deps: CasinoDeps = {
      graceTicks: 600,
      addGoldOffline: () => {},
      logOffline: (id, _type, f) => offline.push({ id, gold: f.gold ?? 0 }),
    };
    const join = (name: string, x: number): Player => {
      const p = player(name, map, x, 5);
      p.char.gold = 100;
      sim.join(p);
      return p;
    };
    const a = join("Alice", 9);
    const b = join("Bob", 11);
    start(a, b);
    bjSit(sim.world, a, tbl);
    bjSit(sim.world, b, tbl);
    bjBid(sim.world, a, "50", rng);
    bjBid(sim.world, b, "30", rng);
    return { ...sim, a, b, deps, offline };
  }

  test("blackjack bids, the refund and the winnings are logged as casino gold", () => {
    const t = table([10, 9, 10, 8]);
    bjStand(t.world, t.a);
    bjStand(t.world, t.b);
    const gold = (who: string) =>
      t.world.activity.filter((e) => e.type === "casino" && e.character === who).map((e) => e.gold);
    // Alice bid 50, got 20 back when the stake was set at 30, and won the 60 pot.
    expect(gold("Alice")).toEqual([-50, 20, 60]);
    expect(gold("Bob")).toEqual([-30]);
    balanced(t.world, t.a, t.b);
  });

  test("an offline winner's pot is logged for them through the offline log", () => {
    const t = table([10, 9, 10, 8]);
    // Bob drops mid-hand and waits out the grace; Alice changes map and forfeits to him.
    casinoLeave(t.world, t.b, t.deps);
    t.world.players.delete("Bob");
    casinoMapChange(t.world, t.a, t.deps);
    expect(t.offline).toEqual([{ id: "Bob", gold: 60 }]);
    balanced(t.world, t.a);
  });

  test("a slot pull's loss is logged as casino gold", () => {
    const map = testMap("x1000y992");
    const sim = setup([map]);
    const a = player("A", map, 5, 5);
    a.char.gold = 100;
    sim.join(a);
    a.slot = { spin: 1 };
    start(a);
    sim.run(1);
    const c = sim.world.activity.filter((e) => e.type === "casino");
    expect(c).toHaveLength(1);
    expect(c[0]?.gold).toBe(a.char.gold - 100);
    expect(c[0]?.details).toEqual({ game: "slots" });
    balanced(sim.world, a);
  });

  test("an Assassin's Game prize to an online winner is logged as a reward", () => {
    const s = scene();
    const a = s.join("A", 5, 5);
    s.world.assassin.mode = "GO";
    s.world.assassin.current = [{ id: "A", name: "A", points: 3 }];
    start(a);
    setAssassinMode(s.world, "STOP", {
      rng: s.rng,
      prizes: () => ["1000 Gold", "", "", ""],
      giveOffline: () => {},
    });
    expect(logged(s.world)).toEqual([{ type: "reward", who: "A", gold: 1000 }]);
    balanced(s.world, a);
  });
});

describe("on the server (real SQL)", () => {
  let db: Db;
  const NOW = "2026-11-05T00:00:00.000Z";
  const ROW_8R = Array.from({ length: 17 }, () => "8R").join(" ");

  beforeEach(() => {
    db = openDatabase();
    migrate(db);
    prepareScenarioMap(db);
    db.run("UPDATE maps SET layer1 = ?", [
      JSON.stringify(Array.from({ length: 12 }, () => ROW_8R)),
    ]);
  });

  const game = (): Game =>
    createGame({ db, send: () => {}, isoNow: () => NOW, rng: rngByN(), minute: () => 0 });

  async function makeChar(g: Game, name: string, admin = false): Promise<string> {
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
    if (admin) {
      const acc = db
        .query<{ account_id: string }, [string]>("SELECT account_id FROM characters WHERE id = ?")
        .get(l.characterId);
      setRole(db, acc?.account_id ?? "", "administrator", NOW);
    }
    return l.characterId;
  }

  const pl = (g: Game, id: string): Player => {
    const p = g.world.players.get(id);
    if (!p) {
      throw new Error("not in");
    }
    return p;
  };

  /** The rows written, after two ticks write the buffer and the check's findings. */
  const rows = (g: Game, type?: string) => {
    g.tick();
    g.tick();
    return db
      .query<
        {
          type: string;
          character: string;
          other: string | null;
          item: string | null;
          qty: number;
          gold: number;
        },
        []
      >("SELECT type, character, other, item, qty, gold FROM activity_log ORDER BY created_at, id")
      .all()
      .filter((r) => type === undefined || r.type === type);
  };

  test("a login logs the address, a logout logs the leaving, and nothing goes unlogged between", async () => {
    const g = game();
    const id = await makeChar(g, "Al");
    g.enter(id, false, "203.0.113.9");
    g.intent(id, { t: "mapReady" });
    g.leave(id);
    // The starting Apples and Knife are logged at creation, as rewards.
    const r = rows(g).filter((x) => x.type !== "map" && x.type !== "reward");
    expect(r.map((x) => x.type)).toEqual(["login", "logout"]);
    const d = db
      .query<{ details: string }, []>("SELECT details FROM activity_log WHERE type = 'login'")
      .get();
    expect(JSON.parse(d?.details ?? "{}")).toEqual({ ip: "203.0.113.9" });
  });

  test("an NPC shop purchase and a bank deposit and withdrawal are logged", async () => {
    const g = game();
    const id = await makeChar(g, "Al", true);
    db.run("UPDATE characters SET gold = 1000 WHERE id = ?", [id]);
    g.enter(id, false);
    g.intent(id, { t: "mapReady" });
    g.intent(id, { t: "chat", text: "/roster 1 Amber" });
    g.intent(id, { t: "chat", text: "/roster 2 Cril" });
    g.intent(id, { t: "chat", text: "/spawn 1" });
    g.intent(id, { t: "chat", text: "/spawn 2" });
    g.intent(id, { t: "npcClick", slot: 1 });
    g.intent(id, { t: "shopList", mode: "buy" });
    g.intent(id, { t: "buy", line: 4, count: 3 });
    g.intent(id, { t: "shopCancel" });
    g.intent(id, { t: "chat", text: "/deposit 100" });
    g.intent(id, { t: "chat", text: "/withdraw 40" });
    expect(rows(g).filter((x) => ["buy", "bank", "unlogged"].includes(x.type))).toEqual([
      { type: "buy", character: "Al", other: "Amber", item: "Apple", qty: 3, gold: 0 },
      { type: "buy", character: "Al", other: "Amber", item: null, qty: 0, gold: -30 },
      { type: "bank", character: "Al", other: null, item: null, qty: 0, gold: -100 },
      { type: "bank", character: "Al", other: null, item: null, qty: 0, gold: 40 },
    ]);
  });

  test("a painting saved logs the Canvas used and the Painting made", async () => {
    const g = game();
    const id = await makeChar(g, "Al");
    g.enter(id, false);
    g.intent(id, { t: "mapReady" });
    const p = pl(g, id);
    p.char.bag[0] = { item: "Canvas", qty: 1 };
    p.canvas = true;
    resetHoldings(p);
    g.intent(id, { t: "artSave", kind: "painting", png: b64(makePng()) });
    expect(rows(g).filter((x) => ["craft", "unlogged"].includes(x.type))).toEqual([
      { type: "craft", character: "Al", other: null, item: "Painting", qty: 1, gold: 0 },
      { type: "craft", character: "Al", other: null, item: "Canvas", qty: -1, gold: 0 },
    ]);
  });

  test("an NPC shop sale is logged with the NPC", async () => {
    const g = game();
    const id = await makeChar(g, "Al", true);
    g.enter(id, false);
    g.intent(id, { t: "mapReady" });
    pl(g, id).char.bag[0] = { item: "Crate#4242", qty: 1 };
    resetHoldings(pl(g, id));
    g.intent(id, { t: "chat", text: "/roster 1 Kanta" });
    g.intent(id, { t: "chat", text: "/spawn 1" });
    g.intent(id, { t: "npcClick", slot: 1 });
    g.intent(id, { t: "shopList", mode: "sell" });
    g.intent(id, { t: "sell", line: 11, count: 1 });
    expect(rows(g).filter((x) => ["sell", "unlogged"].includes(x.type))).toEqual([
      { type: "sell", character: "Al", other: "Kanta", item: null, qty: 0, gold: 15 },
      { type: "sell", character: "Al", other: "Kanta", item: "Crate", qty: -1, gold: 0 },
    ]);
  });

  test("a promotion's price is logged as paid to the trainer, and the class change is logged", async () => {
    const g = game();
    setNpcFile(g.world.npcs, "Amber", ["BIO|A trainer", "TRN|Grunt:100"].join("\r"));
    const id = await makeChar(g, "Al", true);
    db.run("UPDATE characters SET gold = 150 WHERE id = ?", [id]);
    db.run("UPDATE character_skills SET value = 30 WHERE character_id = ? AND skill = 'Slash'", [
      id,
    ]);
    g.enter(id, false);
    g.intent(id, { t: "mapReady" });
    g.intent(id, { t: "chat", text: "/roster 1 Amber" });
    g.intent(id, { t: "chat", text: "/spawn 1" });
    g.intent(id, { t: "npcClick", slot: 1 });
    g.intent(id, { t: "shopList", mode: "train" });
    g.intent(id, { t: "train", line: 2 });
    const r = rows(g);
    expect(r.filter((x) => ["pay", "unlogged"].includes(x.type))).toEqual([
      { type: "pay", character: "Al", other: "Amber", item: null, qty: 0, gold: -100 },
    ]);
    expect(r.some((x) => x.type === "class")).toBe(true);
  });

  test("a Small Shop deed used, its till collected and a sale to a customer are logged", async () => {
    const g = game();
    const carol = await makeChar(g, "Carol");
    g.enter(carol, false);
    g.intent(carol, { t: "mapReady" });
    const c = pl(g, carol);
    c.char.bag[2] = { item: "Small Shop Deed", qty: 1 };
    resetHoldings(c);
    g.intent(carol, { t: "use", slot: 3 });
    g.intent(carol, { t: "placeHouse", slot: 3, x: 10, y: 4 });
    c.x = 10;
    c.y = 5;
    g.tick();
    g.intent(carol, { t: "mapReady" });
    c.y = 9;
    const say = (id: string, text: string) => {
      pl(g, id).chatIn = 0;
      g.intent(id, { t: "chat", text });
    };
    const keeper = [...g.world.playerShops.values()][0]?.npc ?? "";
    say(carol, `${keeper} set Fish=5,2`);
    const ledger = g.world.shops.get(keeper);
    if (!ledger) {
      throw new Error("no ledger");
    }
    ledger.gold = 100;
    ledger.dirty = true;
    say(carol, `${keeper} register 60`);
    expect(rows(g).filter((x) => ["use", "playerShop", "unlogged"].includes(x.type))).toEqual([
      { type: "use", character: "Carol", other: null, item: "Small Shop Deed", qty: -1, gold: 0 },
      { type: "playerShop", character: "Carol", other: keeper, item: null, qty: 0, gold: 60 },
    ]);
    // A customer buys a Fish: their log names Carol, the shop's owner. The till's write made a
    // new ledger.
    const now = g.world.shops.get(keeper) ?? ledger;
    const fish = now.lines.find((l) => l.kind === "SEL" && l.item === "Fish");
    if (fish) {
      fish.stock = 3;
    }
    now.dirty = true;
    const dan = await makeChar(g, "Dan");
    db.run("UPDATE characters SET gold = 50 WHERE id = ?", [dan]);
    g.enter(dan, false);
    g.intent(dan, { t: "mapReady" });
    const d = pl(g, dan);
    d.x = 10;
    d.y = 5;
    g.tick();
    g.intent(dan, { t: "mapReady" });
    g.intent(dan, { t: "npcClick", slot: 1 });
    g.intent(dan, { t: "shopList", mode: "buy" });
    g.intent(dan, { t: "buy", line: fish?.line ?? 0, count: 1 });
    expect(
      rows(g).filter((x) => x.character === "Dan" && ["playerShop", "unlogged"].includes(x.type)),
    ).toEqual([
      { type: "playerShop", character: "Dan", other: "Carol", item: "Fish", qty: 1, gold: 0 },
      { type: "playerShop", character: "Dan", other: "Carol", item: null, qty: 0, gold: -5 },
    ]);
  });
});
