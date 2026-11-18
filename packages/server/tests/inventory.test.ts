/**
 * Sim tests: item intents, ground items, gives, loot, decay, PvP, breaks and the death drop.
 * Scripted `Rng` replays.
 */
import { describe, expect, test } from "bun:test";

import {
  type DeltaEvent,
  NO_EQUIPMENT,
  PICKUP_TEXT,
  type ServerMsg,
} from "@secondstaronline/shared";

import { handleDrop, NO_SUCH_ITEM, parseDrop } from "../src/systems/admin/drop.ts";
import { setAttackHeld } from "../src/systems/combat/melee.ts";
import { containerCapacity } from "../src/systems/economy/containers.ts";
import {
  actionIntent,
  crystalsIntent,
  DROP_TEXT,
  dropIntent,
  equipIntent,
  GIVE_TEXT,
  giveIntent,
  goldIntent,
  type ItemCtx,
  pickupIntent,
  TILE_ITEM_CAP,
  unequipIntent,
  useIntent,
} from "../src/systems/inventory/items.ts";
import { nextStep } from "../src/systems/monsters/ai.ts";
import { type MonsterSlot, species } from "../src/systems/monsters/slots.ts";
import { tick } from "../src/systems/world/tick.ts";
import {
  addPlayer,
  createWorld,
  type GroundItem,
  type Player,
  type Room,
  type World,
  type WorldMap,
} from "../src/systems/world/world.ts";
import { NO_CASINO, player, rngByN, testMap } from "./helpers/sim.ts";

type Out = { to: string; msg: ServerMsg }[];
const chat = (out: Out, to: string) =>
  out.flatMap((m) => (m.to === to && m.msg.t === "chat" ? [m.msg.text] : []));
const events = (out: Out, to: string): DeltaEvent[] =>
  out.flatMap((m) => (m.to === to && m.msg.t === "delta" ? m.msg.events : []));

function scene(
  rngQueues: Record<number, number[]> = {},
  opts: { now?: number; canPvp?: string } = {},
) {
  const map = testMap("x1000y992");
  if (opts.canPvp) {
    map.flags.canPvp = opts.canPvp;
  }
  const world: World = createWorld();
  const rng = rngByN(rngQueues);
  let now = opts.now ?? 1_000_000;
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
    startPoint: { map: map.name, x: 6, y: 4 },
    casino: NO_CASINO,
    saveIntervalTicks: 600,
    stepFrames: 16,
    rng,
    now: () => now,
    lootDecayMinutes: 30,
    dropOnDeath: true,
  };
  const run = (n = 1): Out => {
    const all: Out = [];
    for (let i = 0; i < n; i++) {
      all.push(...tick(world, deps).out);
    }
    return all;
  };
  return {
    map,
    world,
    rng,
    ctx,
    join,
    room,
    run,
    setNow: (t: number) => {
      now = t;
    },
  };
}

const give = (p: Player, slot: number, item: string, qty = 1) => {
  p.char.bag[slot - 1] = { item, qty };
};
const groundAt = (map: WorldMap, x: number, y: number) =>
  map.ground.filter((g: GroundItem) => g.x === x && g.y === y).map((g) => g.item);

describe("use", () => {
  test("eating an apple: one unit spent, HP up, hunger up, the line", () => {
    const s = scene({ 3: [2] });
    const p = s.join("A", 5, 5);
    p.char.vitals.hp = 10;
    p.char.hunger = 1000;
    give(p, 1, "Apple", 2);
    const out = useIntent(s.ctx(), s.room(), p, 1);
    expect(chat(out, "A")).toEqual(["You eat an apple."]);
    expect(p.char.bag[0]).toEqual({ item: "Apple", qty: 1 });
    expect(p.char.vitals.hp).toBe(13);
    expect(p.char.hunger).toBe(2750);
    expect(p.invDirty).toBe(true);
  });
  test("Purple Potion: AttackBonus and AttackCounter 400; it wears off with its line", () => {
    const s = scene();
    const p = s.join("A", 5, 5);
    p.char.hunger = 1000;
    give(p, 1, "Purple Potion");
    expect(chat(useIntent(s.ctx(), s.room(), p, 1), "A")).toEqual([
      "The power of argon flows through your body.",
    ]);
    expect(p.attackBonus).toBe(1);
    expect(p.timers.attackCounter).toBe(400);
    const out = s.run(400);
    expect(chat(out, "A")).toContain(
      "You no longer feel the power of Argon helping you in battle.",
    );
    expect(p.attackBonus).toBe(0);
  });
  test("bug fixed: a stuffed player is refused and keeps the food", () => {
    const s = scene();
    const p = s.join("A", 5, 5);
    p.char.hunger = 35000;
    give(p, 1, "Apple", 2);
    expect(chat(useIntent(s.ctx(), s.room(), p, 1), "A")).toEqual(["You're stuffed!"]);
    expect(p.char.bag[0]).toEqual({ item: "Apple", qty: 2 });
    expect(p.char.hunger).toBe(35000);
  });
});

describe("equip and unequip", () => {
  test("equipping a Knife moves one unit and others see the new look", () => {
    const s = scene();
    const a = s.join("A", 5, 5);
    s.join("B", 8, 8);
    give(a, 2, "Knife");
    equipIntent(s.ctx(), s.room(), a, 2);
    expect(a.char.equip.weapon).toBe("Knife");
    expect(a.char.bag[1]).toBeNull();
    const out = s.run();
    expect(events(out, "B")).toContainEqual({
      e: "look",
      id: "A",
      equip: { ...NO_EQUIPMENT, weapon: "Knife" },
    });
    expect(out.some((m) => m.to === "A" && m.msg.t === "inv")).toBe(true);
  });
  test("bug fixed: equipping into a full slot swaps, the worn item back in the bag", () => {
    const s = scene();
    const a = s.join("A", 5, 5);
    a.char.equip.weapon = "Dagger";
    give(a, 3, "Knife");
    expect(equipIntent(s.ctx(), s.room(), a, 3)).toEqual([]);
    expect(a.char.equip.weapon).toBe("Knife");
    // The Knife's line was emptied and takes the Dagger (the lowest empty line is line 1).
    expect(a.char.bag.filter((l) => l !== null)).toEqual([{ item: "Dagger", qty: 1 }]);
  });
  test("bug fixed: a swap needs room for the worn item; a full bag refuses and changes nothing", () => {
    const s = scene();
    const a = s.join("A", 5, 5);
    a.char.equip.weapon = "Dagger";
    a.char.bag = a.char.bag.map((_, i) => ({
      item: i === 0 ? "Knife" : `Rock${i}`,
      qty: i === 0 ? 2 : 1,
    }));
    expect(chat(equipIntent(s.ctx(), s.room(), a, 1), "A")).toEqual([
      "You are carrying too much to swap this for what you're wearing!",
    ]);
    expect(a.char.equip.weapon).toBe("Dagger");
    expect(a.char.bag[0]).toEqual({ item: "Knife", qty: 2 });
    // A single Knife frees its own line for the Dagger.
    a.char.bag[0] = { item: "Knife", qty: 1 };
    equipIntent(s.ctx(), s.room(), a, 1);
    expect(a.char.equip.weapon).toBe("Knife");
    expect(a.char.bag[0]).toEqual({ item: "Dagger", qty: 1 });
  });
  test("no Equip button for a Potion Bottle: nothing happens", () => {
    const s = scene();
    const a = s.join("A", 5, 5);
    give(a, 1, "Potion Bottle");
    expect(equipIntent(s.ctx(), s.room(), a, 1)).toEqual([]);
    expect(a.char.equip.weapon).toBe("NOTHING");
  });
  test("unequip returns the item; a full bag without it says flinv", () => {
    const s = scene();
    const a = s.join("A", 5, 5);
    a.char.equip.weapon = "Knife";
    unequipIntent(s.ctx(), s.room(), a, "LeftHand");
    expect(a.char.equip.weapon).toBe("NOTHING");
    expect(a.char.bag[0]).toEqual({ item: "Knife", qty: 1 });
    a.char.bag = a.char.bag.map((_, i) => ({ item: `Rock${i}`, qty: 1 }));
    a.char.equip.head = "Plate Helm";
    expect(chat(unequipIntent(s.ctx(), s.room(), a, "Head"), "A")).toEqual([
      "You are carrying too much to unequip this!",
    ]);
  });
  test("unequip waits out Ctrl's ItemActionPause", () => {
    const s = scene();
    const a = s.join("A", 5, 5);
    a.char.equip.weapon = "Knife";
    a.itemPause = 40;
    expect(unequipIntent(s.ctx(), s.room(), a, "LeftHand")).toEqual([]);
    expect(a.char.equip.weapon).toBe("Knife");
    a.itemPause = 0;
    unequipIntent(s.ctx(), s.room(), a, "LeftHand");
    expect(a.char.equip.weapon).toBe("NOTHING");
  });
});

describe("drop, pickup and give", () => {
  test("drop puts one unit on the faced tile", () => {
    const s = scene();
    const a = s.join("A", 5, 5);
    a.facing = "E";
    give(a, 1, "Apple", 2);
    const out = dropIntent(s.ctx(), s.room(), a, 1);
    expect(groundAt(s.map, 6, 5)).toEqual(["Apple"]);
    expect(events(out, "A").map((e) => e.e)).toEqual(["gadd"]);
    expect(a.char.bag[0]?.qty).toBe(1);
  });
  test("bug fixed: items share a tile; a fixture or a full tile is too crowded", () => {
    const s = scene();
    const a = s.join("A", 5, 5);
    a.facing = "E";
    give(a, 1, "Apple", 20);
    dropIntent(s.ctx(), s.room(), a, 1);
    expect(chat(dropIntent(s.ctx(), s.room(), a, 1), "A")).toEqual([]);
    expect(groundAt(s.map, 6, 5)).toEqual(["Apple", "Apple"]);
    for (let i = 2; i < TILE_ITEM_CAP; i++) {
      dropIntent(s.ctx(), s.room(), a, 1);
    }
    expect(groundAt(s.map, 6, 5)).toHaveLength(TILE_ITEM_CAP);
    expect(chat(dropIntent(s.ctx(), s.room(), a, 1), "A")).toEqual([DROP_TEXT.crowded]);
    expect(a.char.bag[0]?.qty).toBe(20 - TILE_ITEM_CAP);
    // Something that stands in the way leaves no room at all.
    s.map.ground.length = 0;
    s.map.ground.push({ id: "t", item: "Table", x: 6, y: 5, kind: "drop", expiresAt: null });
    expect(chat(dropIntent(s.ctx(), s.room(), a, 1), "A")).toEqual([DROP_TEXT.crowded]);
  });
  test("drop onto a blocked tile", () => {
    const s = scene();
    s.map.walk[4]![5] = false;
    const a = s.join("A", 5, 5);
    a.facing = "E";
    give(a, 1, "Apple");
    expect(chat(dropIntent(s.ctx(), s.room(), a, 1), "A")).toEqual([DROP_TEXT.blocked]);
  });
  test("click pickup needs an orthogonal neighbour, never your own tile", () => {
    const s = scene();
    const a = s.join("A", 5, 5);
    s.map.ground.push({ id: "g1", item: "Apple", x: 5, y: 5, kind: "drop", expiresAt: null });
    expect(chat(pickupIntent(s.ctx(), s.room(), a, "g1"), "A")).toEqual([
      "You see the Apple, but you must be standing in front of it to pick it up!",
    ]);
    s.map.ground[0]!.x = 6;
    pickupIntent(s.ctx(), s.room(), a, "g1");
    expect(a.char.bag[0]).toEqual({ item: "Apple", qty: 1 });
    expect(s.map.ground).toEqual([]);
  });
  test("bug fixed: picking up takes the one entry and leaves its twins on the tile", () => {
    const s = scene();
    const a = s.join("A", 5, 5);
    for (const id of ["g1", "g2"]) {
      s.map.ground.push({ id, item: "3 Gold", x: 6, y: 5, kind: "loot", expiresAt: null });
    }
    pickupIntent(s.ctx(), s.room(), a, "g1");
    expect(a.char.gold).toBe(3);
    expect(s.map.ground.map((g) => g.id)).toEqual(["g2"]);
    pickupIntent(s.ctx(), s.room(), a, "g2");
    expect(a.char.gold).toBe(6);
    expect(s.map.ground).toEqual([]);
  });
  test("a click on an item someone already took says it is no longer there", () => {
    const s = scene();
    const a = s.join("A", 5, 5);
    const b = s.join("B", 7, 5);
    s.map.ground.push({ id: "g1", item: "Apple", x: 6, y: 5, kind: "drop", expiresAt: null });
    pickupIntent(s.ctx(), s.room(), a, "g1");
    expect(chat(pickupIntent(s.ctx(), s.room(), b, "g1"), "B")).toEqual([
      "You cannot pick this up because it's no longer there",
    ]);
    expect(b.char.bag.filter((x) => x !== null)).toEqual([]);
  });
  test("bug fixed: a full bag takes a clicked item it holds a stack of, as Ctrl does", () => {
    const s = scene();
    const a = s.join("A", 5, 5);
    a.facing = "E";
    a.char.bag = a.char.bag.map((_, i) => ({ item: i === 0 ? "Apple" : `Rock${i}`, qty: 1 }));
    s.map.ground.push({ id: "g1", item: "Apple", x: 6, y: 5, kind: "drop", expiresAt: null });
    s.map.ground.push({ id: "g2", item: "Apple", x: 6, y: 5, kind: "drop", expiresAt: null });
    s.map.ground.push({ id: "g3", item: "Pear", x: 6, y: 5, kind: "drop", expiresAt: null });
    expect(chat(pickupIntent(s.ctx(), s.room(), a, "g1"), "A")).toEqual([]);
    expect(a.char.bag[0]).toEqual({ item: "Apple", qty: 2 });
    actionIntent(s.ctx(), s.room(), a);
    expect(a.char.bag[0]).toEqual({ item: "Apple", qty: 3 });
    // Nothing to stack on: still too full.
    a.itemPause = 0;
    expect(chat(pickupIntent(s.ctx(), s.room(), a, "g3"), "A")).toEqual([
      "You see the Pear, but you are carrying too much to pick it up!",
    ]);
  });
  test("bug fixed: a fixture the world placed is not picked up by a click or Ctrl; a player's is", () => {
    const s = scene();
    const a = s.join("A", 5, 5);
    a.facing = "E";
    s.map.ground.push({
      id: "c",
      item: "Copy Machine",
      x: 6,
      y: 5,
      kind: "admin",
      expiresAt: null,
    });
    expect(chat(pickupIntent(s.ctx(), s.room(), a, "c"), "A")).toEqual([PICKUP_TEXT.fixed]);
    a.itemPause = 0;
    expect(chat(actionIntent(s.ctx(), s.room(), a), "A")).toEqual([PICKUP_TEXT.fixed]);
    expect(s.map.ground).toHaveLength(1);
    // A Table a player dropped can be carried off again.
    s.map.ground[0] = { id: "t", item: "Table", x: 6, y: 5, kind: "drop", expiresAt: null };
    a.itemPause = 0;
    actionIntent(s.ctx(), s.room(), a);
    expect(a.char.bag[0]).toEqual({ item: "Table", qty: 1 });
  });
  test("Ctrl sets ItemActionPause 40: Use waits it out", () => {
    const s = scene({ 3: [1] });
    const a = s.join("A", 5, 5);
    a.char.hunger = 1000;
    give(a, 1, "Apple", 2);
    actionIntent(s.ctx(), s.room(), a);
    expect(a.itemPause).toBe(40);
    useIntent(s.ctx(), s.room(), a, 1);
    expect(a.char.bag[0]?.qty).toBe(2);
    s.run(40);
    useIntent(s.ctx(), s.room(), a, 1);
    expect(a.char.bag[0]?.qty).toBe(1);
  });
  test('Use on a Piano says "You can\'t use this." and consumes nothing', () => {
    const s = scene();
    const a = s.join("A", 5, 5);
    give(a, 1, "Piano");
    expect(chat(useIntent(s.ctx(), s.room(), a, 1), "A")).toEqual(["You can't use this."]);
    expect(a.char.bag[0]).toEqual({ item: "Piano", qty: 1 });
  });
  test("Ctrl on a Street Lamp says its line and clears the pause it set", () => {
    const s = scene();
    const a = s.join("A", 5, 5);
    a.facing = "E";
    s.map.ground.push({ id: "g1", item: "Street Lamp", x: 6, y: 5, kind: "drop", expiresAt: null });
    expect(chat(actionIntent(s.ctx(), s.room(), a), "A")).toEqual(["This is a street lamp."]);
    expect(a.itemPause).toBe(0);
    expect(s.map.ground).toHaveLength(1);
  });
  test("Ctrl on a Fire Pot says its line and keeps the 40-frame pause", () => {
    const s = scene();
    const a = s.join("A", 5, 5);
    a.facing = "E";
    s.map.ground.push({ id: "g1", item: "Fire Pot", x: 6, y: 5, kind: "drop", expiresAt: null });
    expect(chat(actionIntent(s.ctx(), s.room(), a), "A")).toEqual(["I bet that's hot."]);
    expect(a.itemPause).toBe(40);
  });
  test("a crystal pile becomes n crystals", () => {
    const s = scene();
    const a = s.join("A", 5, 5);
    a.facing = "E";
    s.map.ground.push({
      id: "g1",
      item: "5 Blue Crystals",
      x: 6,
      y: 5,
      kind: "loot",
      expiresAt: null,
    });
    actionIntent(s.ctx(), s.room(), a);
    expect(a.char.bag[0]).toEqual({ item: "Blue Crystals", qty: 5 });
  });
  test("give: one unit on the target's tile, grabbed 60 frames later", () => {
    const s = scene();
    const a = s.join("A", 5, 5);
    const b = s.join("B", 6, 5);
    a.facing = "E";
    give(a, 1, "Knife");
    const out = giveIntent(s.ctx(), s.room(), a, 1);
    expect(chat(out, "A")).toEqual(["*** You offer the Knife to B."]);
    expect(groundAt(s.map, 6, 5)).toEqual(["Knife"]);
    s.run(59);
    expect(b.char.bag[0]).toBeNull();
    s.run(1);
    expect(b.char.bag[0]).toEqual({ item: "Knife", qty: 1 });
    expect(s.map.ground).toEqual([]);
  });
  test('the receiver is told "<giver> is giving you a <item>." before the bag check', () => {
    const s = scene();
    const a = s.join("A", 5, 5);
    const b = s.join("B", 6, 5);
    a.facing = "E";
    give(a, 1, "Knife");
    b.char.bag = b.char.bag.map((_, i) => ({ item: `Rock${i}`, qty: 1 }));
    giveIntent(s.ctx(), s.room(), a, 1);
    expect(chat(s.run(59), "B")).toEqual([]);
    // a full bag: the line comes first, then the click's refusal and nothing is taken
    expect(chat(s.run(1), "B")[0]).toBe("A is giving you a Knife.");
    expect(b.char.bag.every((l) => l?.item.startsWith("Rock"))).toBe(true);
  });
  test('bug fixed: a gold give says "A is giving you 50 Gold."', () => {
    const s = scene();
    const a = s.join("A", 5, 5);
    const b = s.join("B", 6, 5);
    a.facing = "E";
    a.char.gold = 100;
    const out = goldIntent(s.ctx(), s.room(), a, 50);
    expect(chat(out, "B")).toEqual(["A is giving you 50 Gold."]);
    expect(b.char.gold).toBe(50);
  });
  test("bug fixed: a given painting is named without its # number", () => {
    const s = scene();
    const a = s.join("A", 5, 5);
    const b = s.join("B", 6, 5);
    a.facing = "E";
    give(a, 1, "Painting#12");
    const out = giveIntent(s.ctx(), s.room(), a, 1);
    expect(chat(out, "A")).toEqual(["*** You offer the Painting to B."]);
    expect(chat(s.run(60), "B")).toContain("A is giving you a Painting.");
    expect(b.char.bag[0]?.item).toBe("Painting#12");
  });
  test("give with no one in front", () => {
    const s = scene();
    const a = s.join("A", 5, 5);
    give(a, 1, "Knife");
    expect(chat(giveIntent(s.ctx(), s.room(), a, 1), "A")).toEqual([GIVE_TEXT.noOne]);
  });
  test("bug fixed: Give on crystals gives them, naming the pile, to the player in front", () => {
    const s = scene();
    const a = s.join("A", 5, 5);
    const b = s.join("B", 6, 5);
    a.facing = "E";
    give(a, 1, "Red Crystals", 10);
    const out = crystalsIntent(s.ctx(), s.room(), a, 1, 4, "give");
    expect(chat(out, "A")).toEqual(["*** Offering the 4 Red Crystals to B."]);
    expect(chat(out, "B")).toEqual(["A is giving you 4 Red Crystals."]);
    expect(a.char.bag[0]).toEqual({ item: "Red Crystals", qty: 6 });
    expect(b.char.bag[0]).toEqual({ item: "Red Crystals", qty: 4 });
  });
  test("bug fixed: Drop on crystals drops them even facing a player", () => {
    const s = scene();
    const a = s.join("A", 5, 5);
    const b = s.join("B", 6, 5);
    a.facing = "E";
    give(a, 1, "Red Crystals", 10);
    expect(chat(crystalsIntent(s.ctx(), s.room(), a, 1, 4, "drop"), "A")).toEqual([]);
    expect(groundAt(s.map, 6, 5)).toEqual(["4 Red Crystals"]);
    expect(b.char.bag[0]).toBeNull();
    // Give with no one in front says so and keeps them.
    a.facing = "W";
    expect(chat(crystalsIntent(s.ctx(), s.room(), a, 1, 2, "give"), "A")).toEqual([
      GIVE_TEXT.noOne,
    ]);
    expect(a.char.bag[0]).toEqual({ item: "Red Crystals", qty: 6 });
  });
  test("a short crystal drop says the balance test's line, before the path split", () => {
    const s = scene();
    const a = s.join("A", 5, 5);
    a.facing = "E";
    give(a, 1, "Red Crystals", 3);
    expect(chat(crystalsIntent(s.ctx(), s.room(), a, 1, 4, "drop"), "A")).toEqual([
      "You don't have enough crystals!",
    ]);
  });
});

describe("gold drop and give", () => {
  const live = (x: number, y: number) => ({
    name: "Slime",
    hp: 5,
    x,
    y,
    facing: "S" as const,
    anim: 0,
    fromX: x,
    fromY: y,
    queue: [],
    hitCountb: 0,
  });
  test("drop: a '<n> Gold' pile on the faced tile and the gold taken", () => {
    const s = scene();
    const a = s.join("A", 5, 5);
    a.facing = "E";
    a.char.gold = 100;
    const out = goldIntent(s.ctx(), s.room(), a, 40);
    expect(chat(out, "A")).toEqual([]);
    expect(groundAt(s.map, 6, 5)).toEqual(["40 Gold"]);
    expect(a.char.gold).toBe(60);
    expect(s.map.ground[0]?.kind).toBe("drop");
  });
  test("more than you have: 'You don't have enough gold!' for both paths", () => {
    const s = scene();
    const a = s.join("A", 5, 5);
    s.join("B", 6, 5);
    a.facing = "E";
    a.char.gold = 10;
    expect(chat(goldIntent(s.ctx(), s.room(), a, 11), "A")).toEqual([
      "You don't have enough gold!",
    ]);
    a.facing = "W";
    expect(chat(goldIntent(s.ctx(), s.room(), a, 11), "A")).toEqual([
      "You don't have enough gold!",
    ]);
    expect(a.char.gold).toBe(10);
    expect(s.map.ground).toEqual([]);
  });
  test("bug fixed: give says 'Offering the 50 gold to B.'; B has it at once", () => {
    const s = scene();
    const a = s.join("A", 5, 5);
    const b = s.join("B", 6, 5);
    a.facing = "E";
    a.char.gold = 100;
    b.char.gold = 7;
    const out = goldIntent(s.ctx(), s.room(), a, 50);
    expect(chat(out, "A")).toEqual(["*** Offering the 50 gold to B."]);
    expect(a.char.gold).toBe(50);
    expect(b.char.gold).toBe(57);
    expect(s.map.ground).toEqual([]);
  });
  test("a give to a full bag still lands: gold always passes the bag check", () => {
    const s = scene();
    const a = s.join("A", 5, 5);
    const b = s.join("B", 6, 5);
    a.facing = "E";
    a.char.gold = 5;
    for (let i = 1; i <= 15; i++) {
      give(b, i, "Rock");
    }
    goldIntent(s.ctx(), s.room(), a, 5);
    expect(b.char.gold).toBe(5);
  });
  test("a monster one or two tiles ahead: nothing happens", () => {
    for (const x of [6, 7]) {
      const s = scene();
      const a = s.join("A", 5, 5);
      a.facing = "E";
      a.char.gold = 100;
      const slot = s.map.slots[0] as MonsterSlot;
      slot.species = "Slime";
      slot.live = live(x, 5);
      expect(goldIntent(s.ctx(), s.room(), a, 10)).toEqual([]);
      expect(a.char.gold).toBe(100);
      expect(s.map.ground).toEqual([]);
    }
  });
  test("drop refusals: mid-step silent, crowded, blocked", () => {
    const s = scene();
    const a = s.join("A", 5, 5);
    a.facing = "E";
    a.char.gold = 100;
    a.stepFrames = 3;
    expect(goldIntent(s.ctx(), s.room(), a, 1)).toEqual([]);
    a.stepFrames = 0;
    s.map.ground.push({ id: "g", item: "Fire Pot", x: 6, y: 5, kind: "drop", expiresAt: null });
    expect(chat(goldIntent(s.ctx(), s.room(), a, 1), "A")).toEqual([DROP_TEXT.crowded]);
    s.map.ground.length = 0;
    s.map.walk[4]![5] = false;
    expect(chat(goldIntent(s.ctx(), s.room(), a, 1), "A")).toEqual([DROP_TEXT.blocked]);
    expect(a.char.gold).toBe(100);
  });
  test("a dropped pile picked up gives the gold back", () => {
    const s = scene();
    const a = s.join("A", 5, 5);
    const b = s.join("B", 7, 5);
    a.facing = "E";
    a.char.gold = 30;
    goldIntent(s.ctx(), s.room(), a, 30);
    b.facing = "W";
    actionIntent(s.ctx(), s.room(), b);
    expect(b.char.gold).toBe(30);
    expect(s.map.ground).toEqual([]);
  });
});

describe("ground items block by name", () => {
  test("a Windmill blocks the player; an Apple does not", () => {
    const s = scene();
    const a = s.join("A", 5, 5);
    s.map.ground.push({ id: "w", item: "Windmill", x: 6, y: 5, kind: "admin", expiresAt: null });
    a.held = "R";
    s.run(1);
    expect(a.x).toBe(5);
    s.map.ground[0]!.item = "Apple";
    s.run(1);
    expect(a.x).toBe(6);
  });
  test("a blocking item on the anchor tile aborts a monster's path", () => {
    const s = scene();
    const slot = s.map.slots[0] as MonsterSlot;
    slot.species = "Slime";
    slot.live = {
      name: "Slime",
      hp: 5,
      x: 5,
      y: 5,
      facing: "S",
      anim: 0,
      fromX: 5,
      fromY: 5,
      queue: ["R", "D"],
      hitCountb: 0,
    };
    s.map.ground.push({
      id: "w",
      item: "Statue of Bob",
      x: 6,
      y: 5,
      kind: "admin",
      expiresAt: null,
    });
    expect(nextStep(s.map, slot)).toBeNull();
    expect(slot.live.queue).toEqual([]);
    // Bug fixed: Holy Water stops a monster as it stops a player.
    s.map.ground[0]!.item = "Holy Water";
    slot.live.queue = ["R"];
    expect(nextStep(s.map, slot)).toBeNull();
    s.map.ground[0]!.item = "Apple";
    slot.live.queue = ["R"];
    expect(nextStep(s.map, slot)).not.toBeNull();
  });
});

describe("loot and decay", () => {
  function slime(s: ReturnType<typeof scene>, x: number, y: number) {
    const slot = s.map.slots[0] as MonsterSlot;
    slot.species = "Slime";
    slot.live = {
      name: "Slime",
      hp: 0,
      x,
      y,
      facing: "S",
      anim: 0,
      fromX: x,
      fromY: y,
      queue: [],
      hitCountb: 0,
    };
    expect(species("Slime")).toBeDefined();
  }
  test("a killed Slime drops 2 Gold on its tile, as loot that decays after 30 minutes", () => {
    const s = scene({ 4: [1] });
    const a = s.join("A", 5, 5);
    slime(s, 5, 4);
    setAttackHeld(a, true);
    const out = s.run(2);
    expect(events(out, "A").some((e) => e.e === "mhit" && e.kill)).toBe(true);
    expect(groundAt(s.map, 5, 4)).toEqual(["2 Gold"]);
    const g = s.map.ground[0] as GroundItem;
    expect(g.kind).toBe("loot");
    expect(g.expiresAt).toBe(1_000_000 + 30 * 60_000);
    setAttackHeld(a, false);
    s.setNow(1_000_000 + 30 * 60_000);
    const later = s.run(1);
    expect(events(later, "A")).toContainEqual({ e: "gdel", id: g.id });
    expect(s.map.ground).toEqual([]);
  });
  test("bug fixed: loot lands on the tile the monster is drawn nearest", () => {
    const killMidStep = (anim: number) => {
      const s = scene({ 4: [1] });
      const a = s.join("A", 5, 5);
      slime(s, 5, 4);
      const slot = s.map.slots[0] as MonsterSlot;
      slot.pause = 10_000;
      const m = slot.live!;
      m.hp = 0;
      m.fromX = 4;
      m.anim = anim; // mid-step from (4,4) into (5,4)
      setAttackHeld(a, true);
      s.run(1);
      return s.map;
    };
    // Just set off: still drawn on (4,4).
    const early = killMidStep(16);
    expect(groundAt(early, 4, 4)).toEqual(["2 Gold"]);
    expect(groundAt(early, 5, 4)).toEqual([]);
    // Most of the way there: drawn on (5,4).
    expect(groundAt(killMidStep(4), 5, 4)).toEqual(["2 Gold"]);
  });
});

describe("PvP melee", () => {
  test("a swing on the faced tile hurts a player on a PvP map, with the splat", () => {
    // Attacker: AttPower draws; victim: random(3) = 3, parry random(90) = 2 at Parry 0.
    const s = scene({ 90: [2] });
    const a = s.join("A", 5, 5);
    const b = s.join("B", 5, 4);
    b.char.skills = Array(38).fill(0);
    b.char.vitals.hp = 20;
    setAttackHeld(a, true);
    const out = s.run(1);
    const hit = events(out, "B").find((e) => e.e === "phit");
    expect(hit).toMatchObject({ id: "B", color: 6, splat: true });
    expect(b.char.vitals.hp).toBeLessThan(20);
    expect(b.lastToHitMe).toBe("A");
    expect(b.flicker).toBe(39); // set in the key poll, one call in actor pass 2
  });
  test("no PvP on a map whose CanPeeVeePee is O", () => {
    const s = scene({ 90: [2] }, { canPvp: "O" });
    const a = s.join("A", 5, 5);
    const b = s.join("B", 5, 4);
    setAttackHeld(a, true);
    s.run(1);
    expect(b.char.vitals.hp).toBe(20);
  });
  test("bug fixed: a swing that also hits a monster still hurts a player on the tile", () => {
    const s = scene({ 90: [2] });
    const a = s.join("A", 5, 5);
    const b = s.join("B", 5, 4);
    const slot = s.map.slots[0] as MonsterSlot;
    slot.species = "Slime";
    slot.live = {
      name: "Slime",
      hp: 50,
      x: 5,
      y: 4,
      facing: "S",
      anim: 0,
      fromX: 5,
      fromY: 4,
      queue: [],
      hitCountb: 0,
    };
    b.char.skills = Array(38).fill(0);
    setAttackHeld(a, true);
    s.run(1);
    expect(slot.live?.hp).toBeLessThan(50);
    expect(b.char.vitals.hp).toBeLessThan(20);
  });
  test("bug fixed: immortals take no PvP damage", () => {
    const s = scene({ 90: [2] });
    const a = s.join("A", 5, 5);
    const b = s.join("B", 5, 4);
    b.role = "immortal";
    b.char.skills = Array(38).fill(0);
    setAttackHeld(a, true);
    const out = s.run(1);
    expect(b.char.vitals.hp).toBe(20);
    expect(events(out, "B").some((e) => e.e === "phit")).toBe(false);
  });
});

describe("breaks", () => {
  test("a weapon break on a monster hit: the damaged form and the line", () => {
    // The break roll is 1 for Sta 10, hunger 50000: 1 + 30 + 500 + 130 = 661.
    const s = scene({ 661: [1] });
    const a = s.join("A", 5, 5);
    a.char.equip.weapon = "Long Sword";
    const slot = s.map.slots[0] as MonsterSlot;
    slot.species = "Orc";
    slot.live = {
      name: "Orc",
      hp: 500,
      x: 5,
      y: 4,
      facing: "S",
      anim: 0,
      fromX: 5,
      fromY: 4,
      queue: [],
      hitCountb: 0,
    };
    setAttackHeld(a, true);
    const out = s.run(1);
    expect(chat(out, "A")).toContain("Your Long Sword shatters in battle!");
    expect(a.char.equip.weapon).toBe("Damaged Sword, Long");
  });
});

describe("the death drop", () => {
  test("no gold: a random bag line is picked; one unit goes on the death tile", () => {
    const s = scene({ 2: [1] });
    const a = s.join("A", 5, 5);
    give(a, 1, "Apple", 2);
    give(a, 2, "Knife");
    a.char.vitals.hp = 0;
    s.run(1);
    expect(groundAt(s.map, 5, 5)).toEqual(["Apple"]);
    expect(a.char.bag[0]).toEqual({ item: "Apple", qty: 1 });
    expect(s.map.ground[0]?.kind).toBe("drop");
  });
});

describe("the death gold drop", () => {
  test("random(2) = 1 picks gold; random(gold) over 200 is redrawn as random(200)", () => {
    // random(500) = 500 (> 200) → random(200) = 120.
    const s = scene({ 2: [1], 500: [500], 200: [120] });
    const a = s.join("A", 5, 5);
    a.char.gold = 500;
    a.char.vitals.hp = 0;
    s.run(1);
    expect(groundAt(s.map, 5, 5)).toEqual(["120 Gold"]);
    expect(a.char.gold).toBe(380);
    expect(s.map.ground[0]?.kind).toBe("drop");
  });
  test("a wanted player draws random(gold) again, past the 200 cap", () => {
    const s = scene({ 2: [1], 500: [450, 470], 200: [10] });
    const a = s.join("A", 5, 5);
    a.char.gold = 500;
    a.char.wanted = true;
    a.char.vitals.hp = 0;
    s.run(1);
    expect(groundAt(s.map, 5, 5)).toEqual(["470 Gold"]);
    expect(a.char.gold).toBe(30);
  });
  test("random(2) = 2 with gold picks an item instead", () => {
    const s = scene({ 2: [2, 1] });
    const a = s.join("A", 5, 5);
    a.char.gold = 50;
    give(a, 1, "Knife");
    a.char.vitals.hp = 0;
    s.run(1);
    expect(groundAt(s.map, 5, 5)).toEqual(["Knife"]);
    expect(a.char.gold).toBe(50);
  });
});

describe("/drop", () => {
  test("only immortals drop items or gold; moderators and players do nothing", () => {
    const s = scene();
    const a = s.join("A", 5, 5);
    a.facing = "E";
    expect(handleDrop(s.ctx(), s.room(), a, "Long Sword")).toEqual([]);
    // Item and gold creation stays immortal-only, count or not.
    a.role = "moderator";
    expect(handleDrop(s.ctx(), s.room(), a, "Apple")).toEqual([]);
    expect(handleDrop(s.ctx(), s.room(), a, "50 gold")).toEqual([]);
    expect(handleDrop(s.ctx(), s.room(), a, "20 Apple")).toEqual([]);
    expect(groundAt(s.map, 6, 5)).toEqual([]);
    a.facing = "S";
    a.role = "immortal";
    handleDrop(s.ctx(), s.room(), a, "Long Sword");
    expect(groundAt(s.map, 5, 6)).toEqual(["Long Sword"]);
    expect(handleDrop(s.ctx(), s.room(), a, "Sword of Bob")).toEqual([
      { to: "A", msg: { t: "alert", text: NO_SUCH_ITEM } },
    ]);
    a.facing = "W";
    handleDrop(s.ctx(), s.room(), a, "50 gold");
    expect(groundAt(s.map, 4, 5)).toEqual(["50 gold"]);
  });
});

describe("/drop names", () => {
  test("/drop takes only Inventory cast members; the shop whitelist's singular crystals are not", () => {
    expect(parseDrop("Blue Crystal")).toBeNull();
    expect(parseDrop("red crystal")).toBeNull();
    // A real item with no Inventory member is refused too, as in 1.6.
    expect(parseDrop("Gold Armor")).toBeNull();
    expect(parseDrop("Crate")).toBeNull();
    // Member lookup ignores case; the name goes down as typed.
    expect(parseDrop("long sword")).toEqual({ item: "long sword", qty: 1 });
    expect(parseDrop("vault")).toEqual({ item: "vault", qty: 1 });
  });
  test("/drop N gold requires a positive first word; 0 gold falls through and is refused", () => {
    expect(parseDrop("5 gold")).toEqual({ item: "5 gold", qty: 1 });
    expect(parseDrop("0 gold")).toBeNull();
    // Only word 2 is tested, so "20 Gold Armor" is a gold pile, picked up as 20 gold.
    expect(parseDrop("20 Gold Armor")).toEqual({ item: "20 Gold Armor", qty: 1 });
  });
  test("SSO: a bare crystal name is a pile of 1", () => {
    expect(parseDrop("Blue Crystals")).toEqual({ item: "1 Blue Crystals", qty: 1 });
  });
  test("SSO: a count from 1 to 9,999 on any stacking Inventory item", () => {
    expect(parseDrop("50 blue crystals")).toEqual({ item: "50 Blue Crystals", qty: 1 });
    expect(parseDrop("20 apple")).toEqual({ item: "Apple", qty: 20 });
    expect(parseDrop("1 Apple")).toEqual({ item: "Apple", qty: 1 });
    expect(parseDrop("9999 Apple")).toEqual({ item: "Apple", qty: 9999 });
    for (const bad of ["0 Apple", "10000 Apple", "-5 Apple", "20 Rune Sword", "20 Vault"]) {
      expect(parseDrop(bad)).toBeNull();
    }
    // Containers get their own #id on every add, so they take no count.
    expect(parseDrop("Cauldron")).toEqual({ item: "Cauldron", qty: 1 });
    expect(parseDrop("3 Cauldron")).toBeNull();
  });
  test("/drop Blue Crystal shows the alert; /drop 50 Blue Crystals picks up as 50", () => {
    const s = scene();
    const a = s.join("A", 5, 5);
    a.role = "immortal";
    a.facing = "E";
    expect(handleDrop(s.ctx(), s.room(), a, "Blue Crystal")).toEqual([
      { to: "A", msg: { t: "alert", text: NO_SUCH_ITEM } },
    ]);
    expect(groundAt(s.map, 6, 5)).toEqual([]);
    handleDrop(s.ctx(), s.room(), a, "50 Blue Crystals");
    expect(groundAt(s.map, 6, 5)).toEqual(["50 Blue Crystals"]);
    actionIntent(s.ctx(), s.room(), a);
    expect(a.char.bag[0]).toEqual({ item: "Blue Crystals", qty: 50 });
  });
  test("/drop 20 Apple is one pile that adds 20 to the stack", () => {
    const s = scene();
    const a = s.join("A", 5, 5);
    a.role = "immortal";
    a.facing = "E";
    give(a, 1, "Apple", 3);
    handleDrop(s.ctx(), s.room(), a, "20 Apple");
    expect(s.map.ground.filter((g) => g.x === 6 && g.y === 5)).toMatchObject([
      { item: "Apple", qty: 20, kind: "admin" },
    ]);
    actionIntent(s.ctx(), s.room(), a);
    expect(a.char.bag[0]).toEqual({ item: "Apple", qty: 23 });
    expect(groundAt(s.map, 6, 5)).toEqual([]);
  });
});

describe("container capacity", () => {
  test("container capacity, contains cascade, last wins: Wind Cabinet 20 after Cabinet 10", () => {
    expect(containerCapacity("Crate#1")).toBe(3);
    expect(containerCapacity("Cabinet#1")).toBe(10);
    expect(containerCapacity("Wind Cabinet#1")).toBe(20);
    expect(containerCapacity("Bob's House Vault")).toBe(15);
    expect(containerCapacity("Cauldron#1")).toBe(15);
    expect(containerCapacity("Apple")).toBe(15);
  });
});
