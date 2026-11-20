/**
 * Pins for server-authority entries in docs/differences-from-fso.md that no other test covered:
 * equip checks, exact-name sales, map-scoped pickups, give reach, item pauses, hunger, /Pardon,
 * the hazard timer, the monster walk grid, the loading lock, per-player rolls and the death save.
 */
import { describe, expect, test } from "bun:test";

import {
  ADMIN_TEXT,
  ADMINISTRATOR,
  DEFAULT_DEATH_DROPS,
  type DeathDropRules,
  EQUIP_TEXT,
  emptyBag,
  type ServerMsg,
} from "@secondstaronline/shared";

import type { AdminDeps } from "../src/systems/admin/commands.ts";
import { type ChatDeps, handleChat } from "../src/systems/chat/chat.ts";
import { ledgerFromTemplate, npcSell } from "../src/systems/economy/shop.ts";
import {
  equipIntent,
  GIVE_TEXT,
  giveIntent,
  type ItemCtx,
  pickupIntent,
  useIntent,
} from "../src/systems/inventory/items.ts";
import { nextStep } from "../src/systems/monsters/ai.ts";
import { npcFileNamed } from "../src/systems/monsters/npcfiles.ts";
import { type LiveMonster, type MonsterSlot, species } from "../src/systems/monsters/slots.ts";
import { serverTimer, TIMEOUT_TICKS } from "../src/systems/spells/hazards.ts";
import { MAX_EMULATED_PLAYERS, tick } from "../src/systems/world/tick.ts";
import {
  addPlayer,
  createWorld,
  type Player,
  type Room,
  type World,
  type WorldMap,
} from "../src/systems/world/world.ts";
import { fakeModeration, testClock } from "./helpers/moderation.ts";
import { ARCHIVE_NPCS, NO_CASINO, player, rngByN, setup, testMap } from "./helpers/sim.ts";

type Out = { to: string; msg: ServerMsg }[];
const chat = (out: Out, to: string) =>
  out.flatMap((m) => (m.to === to && m.msg.t === "chat" ? [m.msg.text] : []));

function live(map: WorldMap, slot: number, name: string, x: number, y: number): LiveMonster {
  const s = map.slots[slot - 1] as MonsterSlot;
  s.species ??= name;
  s.live = {
    name,
    hp: species(name)?.hp ?? 10,
    x,
    y,
    facing: "S",
    anim: 0,
    fromX: x,
    fromY: y,
    queue: [],
    hitCountb: 0,
  };
  return s.live;
}

/** One or more maps, players added by hand, item intents called directly. */
function itemScene(maps: WorldMap[] = [testMap("x1000y992")]) {
  const world: World = createWorld();
  const rng = rngByN();
  const ctx = (): ItemCtx => ({ world, rng, now: 1_000_000 });
  const join = (id: string, map: WorldMap, x: number, y: number): Player => {
    const p = player(id, map, x, y);
    addPlayer(world, p);
    p.loading = 0;
    p.flicker = 0;
    return p;
  };
  const room = (map: WorldMap): Room => world.rooms.get(map.name) as Room;
  return { world, rng, ctx, join, room, maps };
}

describe("Server derives the equip slot and checks requirements", () => {
  test("SSO: the server derives the slot and refuses gear the strength, hands or murder flag do not allow", () => {
    const map = testMap("x1000y992");
    const s = itemScene([map]);
    const a = s.join("A", map, 5, 5);
    a.char.stats.str = 1;
    a.char.bag[0] = { item: "Pharaoh Sword", qty: 1 };
    expect(chat(equipIntent(s.ctx(), s.room(map), a, 1), "A")).toEqual([EQUIP_TEXT.weak]);
    expect(a.char.equip.weapon).toBe("NOTHING");
    expect(a.char.bag[0]).toEqual({ item: "Pharaoh Sword", qty: 1 });

    a.char.stats.str = 99;
    a.char.equip.offHand = "Small Shield";
    a.char.bag[1] = { item: "War Hammer", qty: 1 };
    expect(chat(equipIntent(s.ctx(), s.room(map), a, 2), "A")).toEqual([EQUIP_TEXT.shieldHeld]);
    expect(a.char.equip.weapon).toBe("NOTHING");

    a.char.bag[2] = { item: "Murder Helm", qty: 1 };
    expect(chat(equipIntent(s.ctx(), s.room(map), a, 3), "A")).toEqual([EQUIP_TEXT.vile]);
    expect(a.char.equip.head).toBe("NOTHING");
    a.char.wanted = true;
    equipIntent(s.ctx(), s.room(map), a, 3);
    // The slot comes from the item, not the client: a helm goes on the head.
    expect(a.char.equip.head).toBe("Murder Helm");
    expect(a.char.bag[2]).toBeNull();
  });
});

describe("Removals address an exact item in a named slot", () => {
  test("SSO: a sale to an NPC takes the first line whose name matches exactly, ignoring case", () => {
    const t = npcFileNamed(ARCHIVE_NPCS, "Akadius");
    if (!t) {
      throw new Error("Akadius");
    }
    const bag = emptyBag();
    bag[0] = { item: "Trout Fillet", qty: 1 };
    bag[1] = { item: "trout", qty: 2 };
    const r = npcSell(ledgerFromTemplate(t), 9, 1, { gold: 0, bag });
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.buyer.bag[0]).toEqual({ item: "Trout Fillet", qty: 1 });
    // The stack left behind takes the shop's spelling, as a sale to Picha1 does.
    expect(r.buyer.bag[1]).toEqual({ item: "Trout", qty: 1 });
  });
});

describe("Map, ground and container files are resolved by the server", () => {
  test("SSO: a pickup finds the item id only on the player's own map", () => {
    const here = testMap("x1000y992");
    const there = testMap("x1001y992");
    const s = itemScene([here, there]);
    const a = s.join("A", here, 5, 5);
    s.join("B", there, 5, 5);
    there.ground.push({ id: "far", item: "Apple", x: 6, y: 5, kind: "drop", expiresAt: null });
    a.facing = "E";
    pickupIntent(s.ctx(), s.room(here), a, "far");
    expect(a.char.bag.filter((l) => l !== null)).toEqual([]);
    expect(there.ground.map((g) => g.id)).toEqual(["far"]);
  });
});

describe("Pickup and give require adjacency on the current map", () => {
  test("SSO: a give reaches only a player on the faced tile; a quest NPC takes it from two tiles ahead", () => {
    const map = testMap("x1000y992");
    const s = itemScene([map]);
    const a = s.join("A", map, 5, 5);
    const b = s.join("B", map, 7, 5);
    a.facing = "E";
    a.char.bag[0] = { item: "Fishle", qty: 1 };
    expect(chat(giveIntent(s.ctx(), s.room(map), a, 1), "A")).toEqual([GIVE_TEXT.noOne]);
    expect(map.ground).toEqual([]);
    expect(a.char.bag[0]).toEqual({ item: "Fishle", qty: 1 });
    // B steps aside; Stephie stands two tiles ahead and takes the quest item.
    b.y = 9;
    live(map, 1, "Stephie", 7, 5);
    const out = giveIntent(s.ctx(), s.room(map), a, 1);
    expect(chat(out, "A")).toContain(
      'Stephie says "Wow thanks, just what I needed. Here take this reward!"',
    );
    expect(a.char.bag.some((l) => l?.item === "Fishle")).toBe(false);
  });
});

describe("Use/equip answered without the long pauses", () => {
  test("SSO: Use and Equip are resolved at once and leave no item pause", () => {
    const map = testMap("x1000y992");
    const s = itemScene([map]);
    const a = s.join("A", map, 5, 5);
    a.char.hunger = 1000;
    a.char.bag[0] = { item: "Apple", qty: 2 };
    a.char.bag[1] = { item: "Knife", qty: 1 };
    useIntent(s.ctx(), s.room(map), a, 1);
    expect(a.char.bag[0]).toEqual({ item: "Apple", qty: 1 });
    expect(a.itemPause).toBe(0);
    // The next action in the same tick is not held back.
    equipIntent(s.ctx(), s.room(map), a, 2);
    expect(a.char.equip.weapon).toBe("Knife");
    expect(a.itemPause).toBe(0);
  });
});

describe("Regen, hunger, food and death run on the server", () => {
  test("SSO: the server tick spends hunger on random(3) = 1, and only then", () => {
    const map = testMap("x1000y992");
    const rng = rngByN({ 3: [1] });
    const { join, run } = setup([map], undefined, rng);
    const a = player("a", map, 5, 5);
    a.char.hunger = 1000;
    join(a);
    run(1);
    expect(a.char.hunger).toBe(999);
    run(1); // random(3) = 3 from here on: no change
    expect(a.char.hunger).toBe(999);
  });
});

describe("Murder flag and pardons are server-only", () => {
  test('SSO: /Pardon of a name that is not online says "<name> is not online."', () => {
    const map = testMap("x1000y992");
    const clock = testClock();
    const s = setup([map], undefined, undefined, () => clock.ms);
    const imm = player("Imm", map, 5, 5);
    imm.role = ADMINISTRATOR;
    s.join(imm);
    const m = fakeModeration((id) => id);
    const admin: AdminDeps = {
      findCharacter: () => null,
      moderation: m.store,
      now: clock.iso,
      durations: () => ({ banMinutes: 0, ipBanMinutes: 0, jailMinutes: 10, muteMinutes: 10 }),
      setClass: () => {},
      cheatLines: () => [],
      audit: () => {},
      kick: () => {},
      saveAll: () => {},
      reloadSettings: () => {},
      loadMap: () => map,
      fallbackPoint: () => ({ map: "x1000y992", x: 6, y: 4 }),
      casino: NO_CASINO,
    };
    const deps: ChatDeps = {
      maxChars: 200,
      broadcastCooldownFrames: 0,
      chatCooldownFrames: 0,
      helpLines: () => null,
      admin,
    };
    const out = handleChat(s.world, imm, "/pardon Zed", deps);
    expect(chat(out, "Imm")).toContain(ADMIN_TEXT.notOnline("Zed"));
  });
});

describe("Hazard timer on ticks", () => {
  test("SSO: the hazard timer runs once every seven ticks", () => {
    expect(TIMEOUT_TICKS).toBe(7);
    const world = createWorld();
    const ran: number[] = [];
    for (let t = 1; t <= 21; t++) {
      world.tickNo = t;
      const before = world.timeouts;
      serverTimer(world, null, rngByN());
      if (world.timeouts !== before) {
        ran.push(t);
      }
    }
    expect(ran).toEqual([7, 14, 21]);
  });
});

describe("One monster walk grid for every player", () => {
  test("SSO: a monster walks the on-foot grid even with an Airship rider on the map", () => {
    const map = testMap("x1000y992", [[6, 5]]);
    // The tree blocks on foot but not aloft.
    expect(map.walk[4]?.[5]).toBe(false);
    expect(map.walkAir[4]?.[5]).toBe(true);
    const rider = player("r", map, 9, 9);
    rider.vehicle = "Airship";
    const m = live(map, 1, "Slime", 5, 5);
    m.queue = ["R"];
    const step = nextStep(map, map.slots[0] as MonsterSlot, { players: [rider], rng: rngByN() });
    expect(step).toBeNull();
    expect([m.x, m.y]).toEqual([5, 5]);
  });
});

describe("Map loading lock", () => {
  test("SSO: a player still loading the map is not hit by a monster beside it", () => {
    const map = testMap("x1000y992");
    const rng = rngByN({ 10: [1, 1, 1, 1], 3: [3, 3, 3, 3] });
    const { world, run } = setup([map], undefined, rng);
    const a = player("a", map, 5, 5);
    a.flicker = 0;
    addPlayer(world, a); // no mapReady: loading stays up
    expect(a.loading).toBeGreaterThan(0);
    live(map, 1, "Slime", 5, 6);
    (map.slots[0] as MonsterSlot).pause = 10_000;
    run(2);
    expect(a.char.vitals.hp).toBe(20);
    expect(a.lastToHitMe).toBeNull();
  });
});

describe("Per-client AI rolls become per-player server rolls", () => {
  /** The spawn gate draws, random(ladder), in one tick for `n` players on a Slime map. */
  function gateDraws(n: number): number {
    const map = testMap("x1000y992");
    (map.slots[0] as MonsterSlot).species = "Slime";
    const rng = rngByN();
    const { join, run } = setup([map], undefined, rng);
    for (let i = 0; i < n; i++) {
      join(player(`p${i}`, map, 1 + (i % 17), 1 + Math.floor(i / 17)));
    }
    run(45); // past the 45-frame entry wait
    const ladder = n === 1 ? 80 : n === 2 ? 120 : 1300;
    rng.calls.length = 0;
    run(1);
    return rng.calls.filter((c) => c === ladder).length;
  }

  test("SSO: each player on the map makes the spawn roll, up to 15", () => {
    const one = gateDraws(1);
    expect(one).toBeGreaterThan(0);
    expect(gateDraws(2)).toBe(2 * one);
    expect(gateDraws(16)).toBe(MAX_EMULATED_PLAYERS * one);
  });
});

describe("The death save holds the respawn tile", () => {
  test("SSO: the tick that moves a dead player to the respawn tile also saves them", () => {
    const map = testMap("x1000y992");
    const { world } = setup([map]);
    const deps = {
      loadMap: (n: string) => (n === map.name ? map : null),
      loadMapById: (id: string) => (id === map.id ? map : null),
      fallbackPoint: { map: "x1000y992", x: 6, y: 4 },
      saveIntervalTicks: 600,
      rng: rngByN({ 5: [1] }),
      casino: NO_CASINO,
      deathDrops: DEFAULT_DEATH_DROPS as DeathDropRules,
    };
    const a = player("a", map, 9, 9);
    a.char.respawn = null;
    addPlayer(world, a);
    a.loading = 0;
    a.char.vitals.hp = 0;
    tick(world, deps);
    expect(a.deadLock).toBe(27);
    for (let i = 0; i < 26; i++) {
      tick(world, deps);
    }
    expect([a.x, a.y]).toEqual([9, 9]);
    const r = tick(world, deps);
    expect([a.x, a.y]).toEqual([6, 4]);
    expect(r.saves).toContain(a);
  });
});
