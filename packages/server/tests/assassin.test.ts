/**
 * Sim tests: the Assassin's game: Lightning one-hit melee and its penalty-free death, the
 * points at the end of the death lock, the starts and the end with its prizes, and the Statue.
 */
import { describe, expect, test } from "bun:test";

import { type ServerMsg, skillIndex } from "@secondstaronline/shared";

import { setAttackHeld } from "../src/systems/combat/melee.ts";
import { type ItemCtx, pickupIntent } from "../src/systems/inventory/items.ts";
import { type AssassinDeps, scoreKill, setAssassinMode } from "../src/systems/social/assassin.ts";
import { tick } from "../src/systems/world/tick.ts";
import {
  addPlayer,
  createWorld,
  type Player,
  type Room,
  type World,
} from "../src/systems/world/world.ts";
import { NO_CASINO, player, rngByN, testMap } from "./helpers/sim.ts";

type Out = { to: string; msg: ServerMsg }[];
const chat = (msgs: Out, to: string) =>
  msgs.flatMap((m) => (m.to === to && m.msg.t === "chat" ? [m.msg.text] : []));

/** A PvP-X map with Alice at (5, 5) facing Bob at (5, 4); both at 90 HP. */
function scene(rngQueues: Record<number, number[]> = {}) {
  const map = testMap("x1000y992");
  map.flags.canPvp = "X";
  const world: World = createWorld();
  const rng = rngByN(rngQueues);
  const join = (id: string, x: number, y: number): Player => {
    const p = player(id, map, x, y);
    addPlayer(world, p);
    p.loading = 0;
    p.flicker = 0;
    p.char.vitals.hpMax = 90;
    p.char.vitals.hp = 90;
    p.char.skills = Array(38).fill(0);
    return p;
  };
  const deps = {
    loadMap: () => map,
    startPoint: { map: map.name, x: 6, y: 4 },
    casino: NO_CASINO,
    saveIntervalTicks: 600,
    stepFrames: 16,
    rng,
    now: () => 1_000_000,
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
  const given: { id: string; prize: string }[] = [];
  const game: AssassinDeps = {
    rng,
    prizes: () => ["Long Sword", "1000 Gold", "500 Gold", "Knife"],
    giveOffline: (id, prize) => given.push({ id, prize }),
  };
  const alice = join("Alice", 5, 5);
  const bob = join("Bob", 5, 4);
  alice.facing = "N";
  return { map, world, rng, run, game, given, alice, bob, join };
}

describe("Lightning", () => {
  test("one landed melee hit kills: HP held at 1, no drop, head, penalty or exile", () => {
    // random(5) = 1 would weaken a normal death.
    const s = scene({ 5: [1, 1, 1] });
    setAssassinMode(s.world, "LIGHTNING", s.game);
    s.bob.char.faction = { id: 1, f1Bonus: 0, f2Bonus: 0, f3Bonus: 0 };
    setAttackHeld(s.alice, true);
    s.run(1);
    setAttackHeld(s.alice, false);
    // The hit lands in the key poll, after every death check; Bob's dies
    // next frame.
    s.run(1);
    expect(s.bob.deadLock).toBeGreaterThan(0);
    expect(s.bob.char.vitals.hp).toBe(1);
    expect(s.bob.char.vitals.hpMax).toBe(90);
    expect(s.bob.char.faction.id).toBe(1);
    expect(s.map.ground).toEqual([]);
  });

  test("kept bug: the kill still flags the killer and pays 10, after the death line", () => {
    const s = scene();
    setAssassinMode(s.world, "LIGHTNING", s.game);
    setAttackHeld(s.alice, true);
    s.run(1);
    setAttackHeld(s.alice, false);
    const msgs = s.run(40);
    expect(chat(msgs, "Alice")).toEqual([
      "*** You are now wanted for the murder of Bob.",
      "*** Bob was just killed by Alice.",
      "*** Alice just received 10 assassin points!",
    ]);
    expect(chat(msgs, "Bob")).toEqual([
      "*** Bob was just killed by Alice.",
      "*** Alice just received 10 assassin points!",
    ]);
    expect(s.alice.char.wanted).toBe(true);
    expect(s.world.assassin.current).toEqual([{ id: s.alice.id, name: "Alice", points: 10 }]);
  });

  test("a parried hit does not kill", () => {
    const s = scene({ 90: [1] });
    setAssassinMode(s.world, "LIGHTNING", s.game);
    setAttackHeld(s.alice, true);
    s.run(1);
    setAttackHeld(s.alice, false);
    s.run(1);
    expect(s.bob.deadLock).toBe(0);
    expect(s.bob.char.vitals.hp).toBe(90);
  });

  test("a normal start ends Lightning; one hit no longer kills", () => {
    const s = scene();
    setAssassinMode(s.world, "LIGHTNING", s.game);
    setAssassinMode(s.world, "GO", s.game);
    setAttackHeld(s.alice, true);
    s.run(1);
    setAttackHeld(s.alice, false);
    s.run(1);
    expect(s.bob.deadLock).toBe(0);
    expect(s.bob.char.vitals.hp).toBeLessThan(90);
    expect(s.bob.char.vitals.hp).toBeGreaterThan(0);
  });

  test("bug fixed: during a Lightning game every death is penalty-free, not only a melee hit", () => {
    const s = scene({ 5: [1, 1, 1] });
    setAssassinMode(s.world, "LIGHTNING", s.game);
    // An arrow, a spell or starvation: HP reaches 0 with the last hitter on record.
    s.bob.char.vitals.hp = 0;
    s.bob.lastToHitMe = "Alice";
    s.bob.lastToHitId = s.alice.id;
    const gold = s.bob.char.gold;
    const bag = JSON.stringify(s.bob.char.bag);
    const msgs = s.run(1);
    expect(chat(msgs, "Bob")).not.toContain(
      "*** Your downfall in battle has caused you to become weakened.",
    );
    expect(s.bob.char.vitals.hpMax).toBe(90);
    expect(s.bob.char.gold).toBe(gold);
    expect(JSON.stringify(s.bob.char.bag)).toBe(bag);
    expect(s.bob.deadLock).toBeGreaterThan(0);
    // The points are still Lightning's 10.
    expect(chat(s.run(40), "Alice")).toContain("*** Alice just received 10 assassin points!");
  });

  test("outside a Lightning game the same death takes every penalty", () => {
    const s = scene({ 5: [1, 1, 1] });
    s.bob.char.vitals.hp = 0;
    s.bob.lastToHitMe = "Alice";
    s.bob.lastToHitId = s.alice.id;
    const msgs = s.run(1);
    expect(chat(msgs, "Bob")).toContain(
      "*** Your downfall in battle has caused you to become weakened.",
    );
    expect(s.bob.char.vitals.hpMax).toBe(89);
  });

  test("an arena Lightning death takes the arena exit: no flag, no points", () => {
    const map = testMap("x1000y992", [], (_x, y) => (y <= 9 ? "6P" : "G1"));
    const s = scene();
    s.world.rooms.clear();
    s.world.players.clear();
    const a = player("Alice", map, 5, 5);
    const b = player("Bob", map, 5, 4);
    for (const p of [a, b]) {
      addPlayer(s.world, p);
      p.loading = 0;
      p.flicker = 0;
      p.char.skills = Array(38).fill(0);
      p.char.vitals.hp = 90;
    }
    a.facing = "N";
    setAssassinMode(s.world, "LIGHTNING", s.game);
    const deps = {
      loadMap: () => map,
      startPoint: { map: map.name, x: 6, y: 4 },
      casino: NO_CASINO,
      saveIntervalTicks: 600,
      stepFrames: 16,
      rng: s.rng,
    };
    setAttackHeld(a, true);
    tick(s.world, deps);
    setAttackHeld(a, false);
    for (let i = 0; i < 40; i++) {
      tick(s.world, deps);
    }
    expect(b.deadLock).toBe(0);
    expect(a.char.wanted).toBe(false);
    expect(s.world.assassin.current).toEqual([]);
  });
});

describe("scoring", () => {
  test("nothing while no game runs", () => {
    const s = scene();
    s.bob.lastToHitId = s.alice.id;
    expect(scoreKill(s.world, s.bob)).toEqual([]);
    expect(s.world.assassin.scores.size).toBe(0);
  });

  test("a normal game pays CompareAss on the victim's rating; the total adds up; a wanted victim counts", () => {
    const s = scene();
    setAssassinMode(s.world, "GO", s.game);
    s.alice.char.skills[skillIndex("Slash")] = 100; // Alice 190, Bob 90
    s.bob.char.wanted = true;
    s.bob.lastToHitId = s.alice.id;
    const out = scoreKill(s.world, s.bob);
    expect(chat(out, "Bob")).toEqual(["*** Alice just received 10 assassin points!"]);
    scoreKill(s.world, s.bob);
    expect(s.world.assassin.scores.get(s.alice.id)).toBe(20);
    expect(s.world.assassin.current).toEqual([{ id: s.alice.id, name: "Alice", points: 20 }]);
  });

  test("a killer who has logged off earns nothing; nor does a monster or yourself", () => {
    const s = scene();
    setAssassinMode(s.world, "GO", s.game);
    s.bob.lastToHitId = "gone";
    expect(scoreKill(s.world, s.bob)).toEqual([]);
    s.bob.lastToHitId = null;
    expect(scoreKill(s.world, s.bob)).toEqual([]);
    s.bob.lastToHitId = s.bob.id;
    expect(scoreKill(s.world, s.bob)).toEqual([]);
  });

  test("kept bug: a tied total leaves the old table entry, though the line still prints", () => {
    const s = scene();
    const carol = s.join("Carol", 9, 9);
    setAssassinMode(s.world, "LIGHTNING", s.game);
    s.bob.lastToHitId = carol.id;
    scoreKill(s.world, s.bob);
    scoreKill(s.world, s.bob); // Carol 20
    s.bob.lastToHitId = s.alice.id;
    const out = scoreKill(s.world, s.bob); // Alice 10
    scoreKill(s.world, s.bob); // Alice 20: ties Carol
    expect(chat(out, "Alice")).toEqual(["*** Alice just received 10 assassin points!"]);
    expect(s.world.assassin.scores.get(s.alice.id)).toBe(20);
    expect(s.world.assassin.current).toEqual([
      { id: carol.id, name: "Carol", points: 20 },
      { id: s.alice.id, name: "Alice", points: 10 },
    ]);
  });
});

describe("start and end", () => {
  test("a start tells everyone and clears this game's scores and table", () => {
    const s = scene();
    s.world.assassin.scores.set(s.alice.id, 50);
    s.world.assassin.current = [{ id: s.alice.id, name: "Alice", points: 50 }];
    const out = setAssassinMode(s.world, "GO", s.game);
    expect(chat(out, "Bob")).toEqual([
      "*** The Assassin's Game has begun!",
      "*** Kill everyone in sight to become the greatest assassin ever!",
    ]);
    expect(s.world.assassin.mode).toBe("GO");
    expect(s.world.assassin.scores.size).toBe(0);
    expect(s.world.assassin.current).toEqual([]);
    expect(s.world.assassinDirty).toBe(true);
  });

  test("the end: lines, a win, STOP, prizes 1-3 (online ones added to the bag, offline ones written)", () => {
    const s = scene();
    setAssassinMode(s.world, "GO", s.game);
    s.world.assassin.current = [
      { id: s.alice.id, name: "Alice", points: 40 },
      { id: "carol-id", name: "Carol", points: 30 },
      { id: s.bob.id, name: "Bob", points: 10 },
    ];
    const gold = s.bob.char.gold;
    const out = setAssassinMode(s.world, "STOP", s.game);
    expect(chat(out, "Bob")).toEqual([
      "*** The assassin's game has ended!!!",
      "*** Alice has won first place with 40 points!",
      "*** Carol has won second place and Bob has come in third.",
      "*** Check back soon for yet another assassin's game.",
    ]);
    expect(s.world.assassin.mode).toBe("STOP");
    expect(s.world.assassin.wins.get(s.alice.id)).toBe(1);
    expect(s.world.assassin.legends).toEqual([{ id: s.alice.id, name: "Alice", points: 1 }]);
    expect(s.alice.char.bag.some((l) => l?.item === "Long Sword")).toBe(true);
    expect(s.given).toEqual([{ id: "carol-id", prize: "1000 Gold" }]);
    expect(s.bob.char.gold).toBe(gold + 500);
    // The current table stays for the Statue.
    expect(s.world.assassin.current).toHaveLength(3);
  });

  test("a prize item to a full bag is lost; gold to a full bag arrives", () => {
    const s = scene();
    s.alice.char.bag = s.alice.char.bag.map(() => ({ item: "Apple", qty: 1 }));
    s.bob.char.bag = s.bob.char.bag.map(() => ({ item: "Apple", qty: 1 }));
    const gold = s.bob.char.gold;
    s.world.assassin.current = [
      { id: s.alice.id, name: "Alice", points: 40 },
      { id: s.bob.id, name: "Bob", points: 30 },
    ];
    setAssassinMode(s.world, "STOP", s.game);
    expect(s.alice.char.bag.some((l) => l?.item === "Long Sword")).toBe(false);
    expect(s.bob.char.gold).toBe(gold + 1000);
  });

  test("an end nobody scored in names no winner, counts no win and gives nothing", () => {
    const s = scene();
    setAssassinMode(s.world, "GO", s.game);
    const out = setAssassinMode(s.world, "STOP", s.game);
    expect(chat(out, "Alice")).toEqual([
      "*** The assassin's game has ended!!!",
      "*** Check back soon for yet another assassin's game.",
    ]);
    expect(s.world.assassin.wins.size).toBe(0);
    expect(s.given).toEqual([]);
  });
});

describe("the Assassin Statue", () => {
  test("a click from anywhere: its line, pause 20, the all-time block then the current block", () => {
    const s = scene();
    s.map.ground.push({
      id: "st",
      x: 15,
      y: 10,
      item: "Assassin Statue",
      qty: 1,
      kind: "admin",
      expiresAt: null,
    });
    s.world.assassin.legends = [{ id: s.alice.id, name: "Alice", points: 1 }];
    s.world.assassin.current = [{ id: s.alice.id, name: "Alice", points: 10 }];
    const room = s.world.rooms.get(s.map.name) as Room;
    const ctx: ItemCtx = { world: s.world, rng: s.rng, now: 1_000_000 };
    const out = pickupIntent(ctx, room, s.bob, "st");
    const lines = chat(out, "Bob");
    expect(lines[0]).toBe("You view the top Assassins of FSO...");
    expect(lines[1]?.split("\n")[3]?.startsWith("1. Alice - 1 points      2.  -  points")).toBe(
      true,
    );
    expect(lines[2]?.split("\n")[1]).toBe("                         Current Top Assassins");
    expect(lines[2]?.split("\n")[3]?.startsWith("1. Alice - 10 points")).toBe(true);
    expect(s.bob.itemPause).toBe(20);
    // Never picked up.
    expect(s.map.ground).toHaveLength(1);
  });
});
