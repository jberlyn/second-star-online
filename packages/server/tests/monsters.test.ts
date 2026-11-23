/**
 * Sim tests: spawning, monster AI and attacks, melee, XP, death (seeded and scripted
 * `Rng` replays).
 */
import { describe, expect, test } from "bun:test";

import { ADMINISTRATOR, type ServerMsg, skillIndex } from "@secondstaronline/shared";

import { seededRng } from "../src/rng.ts";
import { onArenaTile, setAttackHeld } from "../src/systems/combat/melee.ts";
import { authorPath, moveLadder, moverPass, nextStep } from "../src/systems/monsters/ai.ts";
import { monsterAttack, monsterAttackValue } from "../src/systems/monsters/attack.ts";
import { setNpcFile } from "../src/systems/monsters/npcfiles.ts";
import {
  type LiveMonster,
  leansToward,
  type MonsterSlot,
  species,
} from "../src/systems/monsters/slots.ts";
import {
  placeMonster,
  refusesTile,
  spawnLadder,
  spawnPass,
} from "../src/systems/monsters/spawn.ts";
import { enterRoom, leaveRoom, type WorldMap } from "../src/systems/world/world.ts";
import { ARCHIVE_NPCS, player, rngByN, setup, testMap } from "./helpers/sim.ts";

function withRoster(map: WorldMap, ...names: (string | null)[]): WorldMap {
  names.forEach((n, i) => {
    const s = map.slots[i] as MonsterSlot;
    s.species = n;
  });
  return map;
}

function live(map: WorldMap, slot: number, name: string, x: number, y: number): LiveMonster {
  const s = map.slots[slot - 1] as MonsterSlot;
  s.species ??= name;
  const sp = species(name);
  s.live = {
    name,
    hp: sp?.hp ?? 0,
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

const events = (msgs: { to: string; msg: ServerMsg }[], to: string) =>
  msgs.flatMap((m) => (m.to === to && m.msg.t === "delta" ? m.msg.events : []));
const chat = (msgs: { to: string; msg: ServerMsg }[], to: string) =>
  msgs.flatMap((m) => (m.to === to && m.msg.t === "chat" ? [m.msg.text] : []));

describe("spawning", () => {
  test("bug fixed: ladders: spawn 80…1300 by players, move 30…600 and 600 from the 8th on", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(spawnLadder)).toEqual([
      80, 120, 230, 400, 600, 900, 1300, 1300,
    ]);
    expect([1, 2, 8, 9, 15].map(moveLadder)).toEqual([30, 50, 600, 600, 600]);
  });

  test("gate, tile, random(5), pause: a Slime spawns on its rolled tile with pause 30", () => {
    const map = withRoster(testMap("x1"), "Slime");
    const rng = rngByN({ 80: [1], 17: [7], 12: [3], 5: [1], 4: [2] });
    const spawned = spawnPass(map, { rng, players: 1, minute: 0 });
    expect(spawned).toHaveLength(1);
    expect(map.slots[0]?.live).toMatchObject({ name: "Slime", hp: 14, x: 7, y: 3, facing: "S" });
    expect(map.slots[0]?.pause).toBe(30);
    // The order of draws: gate, x, y, random(5), facing.
    expect(rng.calls).toEqual([80, 17, 12, 5, 4]);
  });

  test("random(5) is drawn even while the slot is paused", () => {
    const map = withRoster(testMap("x1"), "Slime");
    (map.slots[0] as MonsterSlot).pause = 3;
    const rng = rngByN({ 80: [1], 5: [1] });
    expect(spawnPass(map, { rng, players: 1, minute: 0 })).toEqual([]);
    expect(rng.calls).toEqual([80, 17, 12, 5]);
  });

  test("kept on purpose: slot 5 never spawns: a roster has four slots", () => {
    expect(testMap("x1").slots.map((s) => s.slot)).toEqual([1, 2, 3, 4]);
  });

  test("bug fixed: a failed NPC roll skips only its own slot", () => {
    const map = withRoster(testMap("x1"), "Trimble", "Slime");
    const rng = rngByN({ 80: [1], 17: [4, 7], 12: [4, 3], 5: [1, 1], 60: [3] });
    const spawned = spawnPass(map, { rng, players: 1, minute: 0 });
    expect(spawned.map((s) => s.slot)).toEqual([2]);
    expect(map.slots[0]?.live).toBeNull();
    expect(map.slots[1]?.live).toMatchObject({ name: "Slime", x: 7, y: 3 });
  });

  test("Zombies spawn only in server minutes 36-48", () => {
    const map = withRoster(testMap("x1"), "Zombie");
    const at = (minute: number) => {
      (map.slots[0] as MonsterSlot).live = null;
      (map.slots[0] as MonsterSlot).pause = 0;
      return spawnPass(map, { rng: rngByN({ 80: [1], 5: [1] }), players: 1, minute }).length;
    };
    expect(at(35)).toBe(0);
    expect(at(36)).toBe(1);
    expect(at(48)).toBe(1);
    expect(at(49)).toBe(0);
  });

  test("bug fixed: every species has hit points; 1.6's unlisted ones and unknown names get 1", () => {
    expect(species("Trimble")?.hp).toBe(1); // no row in 1.6's HP table
    expect(placeMonster("Trimble", 4, 4, rngByN()).hp).toBe(1);
    expect(placeMonster("Slime", 4, 4, rngByN()).hp).toBe(14);
    expect(placeMonster("Angela", 4, 4, rngByN()).hp).toBe(389);
    expect(placeMonster("Not In The Data", 4, 4, rngByN()).hp).toBe(1);
  });

  test("bug fixed: a slot's new monster starts at its species' hit points, not the last occupant's", () => {
    const map = withRoster(testMap("x1"), "Slime");
    const slot = map.slots[0] as MonsterSlot;
    slot.live = placeMonster("Slime", 4, 4, rngByN());
    slot.live.hp = 3; // wounded, then killed
    slot.live = null;
    const rng = rngByN({ 80: [1], 17: [7], 12: [3], 5: [1], 4: [2] });
    expect(spawnPass(map, { rng, players: 1, minute: 0 })).toHaveLength(1);
    expect(slot.live).toMatchObject({ name: "Slime", hp: 14 });
  });

  test("bug fixed: the footprint test runs wherever the anchor is", () => {
    const map = testMap("x1", [[14, 3]]);
    expect(refusesTile(map, "Overlord", 13, 4)).toBe(true); // (14,3) is the (+1,−1) cell
    expect(refusesTile(map, "Overlord", 12, 4)).toBe(true); // (14,3) is the (+2,−1) cell
    expect(refusesTile(map, "Overlord", 10, 4)).toBe(false);
    const low = testMap("x2", [[16, 10]]);
    expect(refusesTile(low, "Mutant Worm", 14, 11)).toBe(true); // (16,10) is the (+2,−1) cell
    // A cell off the screen never refuses.
    expect(refusesTile(low, "Mutant Worm", 17, 11)).toBe(false);
  });

  test("bug fixed: every sea creature spawns only on water", () => {
    const map = testMap("x1", [], (x) => (x === 3 ? "W1" : "G1"));
    for (const name of [
      "Squid",
      "Shark",
      "Mizella",
      "Krommie",
      "Jelstar",
      "Merius",
      "Mellanie",
      "Minmaye",
    ]) {
      expect([name, refusesTile(map, name, 5, 5)]).toEqual([name, true]);
      expect([name, refusesTile(map, name, 3, 5)]).toEqual([name, false]);
    }
    expect(refusesTile(map, "Slime", 3, 5)).toBe(true);
  });

  test("bug fixed: no monster spawns on a blocking item such as a crafting station", () => {
    const map = withRoster(testMap("x1"), "Slime");
    const put = (item: string, x: number, y: number) =>
      map.ground.push({ id: `g${map.ground.length}`, item, x, y, kind: "admin", expiresAt: null });
    put("Anvil", 7, 3);
    put("Carpentry Bench", 4, 4);
    put("Stone Statue", 10, 4); // under an Overlord's footprint at (9,5)
    put("Apple", 5, 5); // an item that does not block
    expect(refusesTile(map, "Slime", 7, 3)).toBe(true);
    expect(refusesTile(map, "Slime", 4, 4)).toBe(true);
    expect(refusesTile(map, "Slime", 5, 5)).toBe(false);
    expect(refusesTile(map, "Overlord", 9, 5)).toBe(true);
    expect(refusesTile(map, "Overlord", 2, 8)).toBe(false);
    // The roll that would place a Slime on (7,3) spawns nothing while the Anvil stands there.
    const roll = () => rngByN({ 80: [1], 17: [7], 12: [3], 5: [1], 4: [2] });
    expect(spawnPass(map, { rng: roll(), players: 1, minute: 0 })).toEqual([]);
    map.ground = map.ground.filter((g) => g.item !== "Anvil");
    expect(spawnPass(map, { rng: roll(), players: 1, minute: 0 })).toHaveLength(1);
    expect(map.slots[0]?.live).toMatchObject({ name: "Slime", x: 7, y: 3 });
  });

  test("a client takes no spawn rolls for 44 frames after entering a map: the 45-frame spawn countdown runs before actor pass 1", () => {
    const map = withRoster(testMap("x1000y992"), "Slime");
    const rng = rngByN();
    const { join, run } = setup([map], undefined, rng);
    join(player("a", map, 5, 5));
    run(44);
    expect(rng.calls.includes(80)).toBe(false);
    run(1);
    expect(rng.calls.includes(80)).toBe(true);
  });
});

describe("monster movement", () => {
  test("a hostile walk leans toward the author by pixel position", () => {
    const map = testMap("x1");
    const m = live(map, 1, "Slime", 5, 5);
    const a = player("a", map, 5, 9); // below, same column: L, R or D
    const plan = authorPath(ARCHIVE_NPCS, m, a, rngByN({ 10: [4] }));
    expect(plan).toEqual({ queue: [], chase: { id: "a", steps: 4 } });
    m.chase = plan?.chase;
    const rng = rngByN({ 3: [3] });
    expect(nextStep(map, map.slots[0] as MonsterSlot, { players: [a], rng })).not.toBeNull();
    expect([m.x, m.y, m.facing]).toEqual([5, 6, "S"]);
    expect(m.chase).toEqual({ id: "a", steps: 3 });
  });

  test("bug fixed: each chase step aims at where its player stands now", () => {
    const map = testMap("x1");
    const m = live(map, 1, "Slime", 5, 5);
    const a = player("a", map, 5, 9);
    m.chase = { id: "a", steps: 2 };
    const ctx = { players: [a], rng: rngByN({ 3: [3, 2] }) };
    nextStep(map, map.slots[0] as MonsterSlot, ctx); // D, toward a below
    expect([m.x, m.y]).toEqual([5, 6]);
    // a walks off to the right: the next step's choices are D, R and U, not L, R and D.
    a.x = 12;
    a.y = 6;
    m.anim = 0;
    nextStep(map, map.slots[0] as MonsterSlot, ctx);
    expect([m.x, m.y, m.facing]).toEqual([6, 6, "E"]);
    expect(m.chase).toBeNull();
  });

  test("a chase ends when its player leaves the map", () => {
    const map = testMap("x1");
    const m = live(map, 1, "Slime", 5, 5);
    m.chase = { id: "gone", steps: 5 };
    expect(nextStep(map, map.slots[0] as MonsterSlot, { players: [], rng: rngByN() })).toBeNull();
    expect([m.x, m.y]).toEqual([5, 5]);
    expect(m.chase).toBeNull();
  });

  test("a random walk is drawn whole at authoring", () => {
    const map = testMap("x1");
    const m = live(map, 1, "Kin", 5, 5); // not on the hostile list
    const a = player("a", map, 5, 9);
    const plan = authorPath(ARCHIVE_NPCS, m, a, rngByN({ 10: [3], 4: [1, 2, 3] }));
    expect(plan).toEqual({ queue: ["U", "D", "L"], chase: null });
  });

  test("Still or file-less species never move", () => {
    const map = testMap("x1");
    expect(
      authorPath(ARCHIVE_NPCS, live(map, 1, "Andero", 5, 5), player("a", map, 1, 1), rngByN()),
    ).toBeNull();
    expect(
      authorPath(ARCHIVE_NPCS, live(map, 2, "Cow", 5, 5), player("a", map, 1, 1), rngByN()),
    ).toBeNull();
  });

  test("blocked steps are skipped at no cost; a started step sets the pause to 90", () => {
    const map = testMap("x1", [[5, 4]]);
    const m = live(map, 1, "Slime", 5, 5);
    m.queue = ["U", "U", "R"];
    const step = nextStep(map, map.slots[0] as MonsterSlot, { players: [], rng: rngByN() });
    expect(step).toMatchObject({ fromX: 5, fromY: 5 });
    expect([m.x, m.y, m.facing, m.anim]).toEqual([6, 5, "E", 16]);
    expect(map.slots[0]?.pause).toBe(90);
    expect(m.queue).toEqual([]);
  });

  test("bug fixed: every slot waits 30 after authoring when no step can start", () => {
    const map = testMap("x1", [
      [4, 5],
      [6, 5],
      [5, 4],
      [5, 6],
    ]);
    live(map, 1, "Slime", 2, 2);
    live(map, 2, "Slime", 5, 5); // boxed in by trees
    const a = player("a", map, 10, 10);
    moverPass(ARCHIVE_NPCS, map, a, 1, rngByN({ 30: [2], 10: [3] }), [a]);
    expect(map.slots[1]?.pause).toBe(30);
    moverPass(ARCHIVE_NPCS, map, a, 1, rngByN({ 30: [1], 10: [3] }), [a]);
    expect(map.slots[0]?.pause).toBe(90);
  });

  test("steps follow back to back, 16 calls = 8 frames each", () => {
    const map = testMap("x1000y992");
    const m = live(map, 1, "Cow", 5, 5);
    const { join, run, world } = setup([map], undefined, rngByN());
    const a = player("a", map, 12, 8);
    join(a);
    m.queue = ["R", "R"];
    nextStep(map, map.slots[0] as MonsterSlot, { players: [a], rng: rngByN() });
    expect([m.x, m.y]).toEqual([6, 5]);
    run(8);
    expect([m.x, m.y]).toEqual([7, 5]);
    expect(m.anim).toBe(16);
    expect(world.tickNo).toBe(8);
  });

  test("bug fixed: players and other monsters block a monster's step", () => {
    const map = testMap("x1");
    const m = live(map, 1, "Slime", 5, 5);
    live(map, 2, "Orc", 5, 4);
    const a = player("a", map, 6, 5);
    const ctx = { players: [a], rng: rngByN() };
    m.queue = ["R", "U", "D"]; // R onto a, U onto the Orc: both skipped
    expect(nextStep(map, map.slots[0] as MonsterSlot, ctx)).toMatchObject({ fromX: 5, fromY: 5 });
    expect([m.x, m.y]).toEqual([5, 6]);
    // An Airship rider blocks no one.
    a.vehicle = "Airship";
    m.anim = 0;
    m.queue = ["R"];
    nextStep(map, map.slots[0] as MonsterSlot, ctx);
    expect([m.x, m.y]).toEqual([6, 6]);
  });

  test("bug fixed: a 3×2 monster's footprint blocks and is blocked", () => {
    const map = testMap("x1");
    const worm = live(map, 1, "Mutant Worm", 5, 5); // covers (5-7, 4-5)
    const m = live(map, 2, "Slime", 8, 4);
    m.queue = ["L", "D"]; // L onto (7,4), a footprint cell: skipped
    nextStep(map, map.slots[1] as MonsterSlot, { players: [], rng: rngByN() });
    expect([m.x, m.y]).toEqual([8, 5]);
    // The worm's step R would cover (8,5), where the Slime now stands.
    worm.queue = ["R"];
    expect(nextStep(map, map.slots[0] as MonsterSlot, { players: [], rng: rngByN() })).toBeNull();
  });
});

describe("kept bugs in the monster tables", () => {
  test("bug fixed: the hostile list is matched by whole entries; Dragon and Overlord lean by rule", () => {
    expect(leansToward("Slime")).toBe(true);
    expect(leansToward("slime")).toBe(true);
    expect(leansToward("Dragon")).toBe(true);
    expect(leansToward("Overlord")).toBe(true);
    // Parts of entries no longer match.
    expect(leansToward("Hatchling")).toBe(false);
    expect(leansToward("Snow")).toBe(false);
    expect(leansToward("Trimble")).toBe(false);
  });
  test("bug fixed: a name with no attack entry never melees", () => {
    expect(monsterAttackValue("Trimble")).toBeNull();
    // Angela, Trianus and Corin have 1.6 HP rows but no attack row; the Officer has both.
    for (const name of ["Angela", "Trianus", "Corin"]) {
      expect([name, monsterAttackValue(name)]).toEqual([name, null]);
    }
    expect(monsterAttackValue("Officer")).toBe(35);
    expect(monsterAttackValue("Not A Monster")).toBeNull();
    expect(monsterAttackValue("Slime")).toBe(1);
    const map = testMap("x1000y992");
    live(map, 1, "Trimble", 5, 6);
    const a = player("a", map, 5, 5);
    a.flicker = 0;
    const rng = rngByN({ 10: [1] });
    expect(
      monsterAttack(map, map.slots[0] as MonsterSlot, a, {
        rng,
        npcs: ARCHIVE_NPCS,
        invulnerable: () => false,
      }),
    ).toBeNull();
    expect(rng.calls).toEqual([]);
    expect(a.char.vitals.hp).toBe(20);
  });
  test("bug fixed: the Snared Loah hits for its own 18", () => {
    expect(species("Snared Loah")?.attack).toBe(18);
    expect(monsterAttackValue("Snared Loah")).toBe(18);
  });
  test('a parried monster hit can raise Parry: "You have advanced in the art of Parry!"', () => {
    const map = testMap("x1000y992");
    live(map, 1, "Orc", 5, 6);
    const a = player("a", map, 5, 5);
    a.flicker = 0;
    a.char.skills[skillIndex("Parry")] = 60;
    // random(10) = 1 attacks; Parry 60's last ladder draw random(60) = 1 parries; the skill-gain
    // random(60) = 1 raises it.
    const r = monsterAttack(map, map.slots[0] as MonsterSlot, a, {
      rng: rngByN({ 10: [1], 60: [1, 1] }),
      npcs: ARCHIVE_NPCS,
      invulnerable: () => false,
    });
    expect([r?.text, r?.lines]).toEqual(["Parry", ["You have advanced in the art of Parry!"]]);
    expect(a.char.skills[skillIndex("Parry")]).toBe(61);
  });
  test('a blocked monster hit can raise Block at Parry > 50: "You have advanced in the art of Block!"', () => {
    const map = testMap("x1000y992");
    live(map, 1, "Orc", 5, 6);
    const a = player("a", map, 5, 5);
    a.flicker = 0;
    a.char.skills[skillIndex("Parry")] = 60;
    a.char.skills[skillIndex("Block")] = 5;
    // Parry: random(90) twice, then random(60) = 2, no parry. Block 5: random(90) = 1, a block;
    // the skill-gain random(5) = 1.
    const r = monsterAttack(map, map.slots[0] as MonsterSlot, a, {
      rng: rngByN({ 10: [1], 60: [2], 90: [5, 5, 1], 5: [1] }),
      npcs: ARCHIVE_NPCS,
      invulnerable: () => false,
    });
    expect([r?.text, r?.lines]).toEqual(["Block", ["You have advanced in the art of Block!"]]);
    expect(a.char.skills[skillIndex("Block")]).toBe(6);
  });
  test("a plain monster hit that raises Parry from 50 to 51 can raise Block in the same hit", () => {
    const map = testMap("x1000y992");
    live(map, 1, "Orc", 5, 6);
    const a = player("a", map, 5, 5);
    a.flicker = 0;
    a.char.skills[skillIndex("Parry")] = 50;
    a.char.skills[skillIndex("Block")] = 7;
    // No parry, no block, the hit lands; then Parry's gain random(50) = 1 makes it 51, and Block's
    // gain random(7) = 1 reads that 51, past its Parry > 50 requirement.
    const r = monsterAttack(map, map.slots[0] as MonsterSlot, a, {
      rng: rngByN({ 10: [1], 50: [1], 7: [1] }),
      npcs: ARCHIVE_NPCS,
      invulnerable: () => false,
    });
    expect(r?.lines).toEqual([
      "You have advanced in the art of Parry!",
      "You have advanced in the art of Block!",
    ]);
    expect([a.char.skills[skillIndex("Parry")], a.char.skills[skillIndex("Block")]]).toEqual([
      51, 8,
    ]);
  });
  test("bug fixed: arena tiles on rows 10-12 are arena tiles", () => {
    const map = testMap("x1", [], () => "6P");
    const room = { map, npcs: ARCHIVE_NPCS, players: [], fx: [], fxQueue: [], doorLock: 0 };
    expect(onArenaTile(room, 5, 9)).toBe(true);
    for (const y of [10, 11, 12]) {
      expect(onArenaTile(room, 5, y)).toBe(true);
    }
    const plain = testMap("x2", [], (_x, y) => (y === 11 ? "G1" : "6P"));
    const plainRoom = { ...room, map: plain };
    expect(onArenaTile(plainRoom, 5, 11)).toBe(false);
  });
  test("bug fixed: an unprovoked Passive monster's random(10) = 1 does not hold up its walk", () => {
    const map = testMap("x1000y992");
    const m = live(map, 1, "Orc", 5, 5);
    m.anim = 10;
    (map.slots[0] as MonsterSlot).pause = 10_000;
    const { join, run, world } = setup([map], undefined, rngByN({ 10: [1, 1, 1, 1] }));
    setNpcFile(world.npcs, "Orc", "FLG|Passive");
    const a = player("a", map, 12, 9);
    join(a);
    a.loading = 0;
    run(1);
    // Both actor passes walk it, whatever the attack roll.
    expect(m.anim).toBe(8);
  });
  test("bug fixed: a roll ignored while you blink names no one", () => {
    const map = testMap("x1000y992");
    live(map, 1, "Orc", 5, 6);
    const a = player("a", map, 5, 5);
    a.flicker = 20;
    a.lastToHitMe = "a Slime";
    monsterAttack(map, map.slots[0] as MonsterSlot, a, {
      rng: rngByN({ 10: [1] }),
      npcs: ARCHIVE_NPCS,
      invulnerable: () => false,
    });
    expect(a.lastToHitMe).toBe("a Slime");
    expect(a.char.vitals.hp).toBe(20);
    a.flicker = 0;
    monsterAttack(map, map.slots[0] as MonsterSlot, a, {
      rng: rngByN({ 10: [1] }),
      npcs: ARCHIVE_NPCS,
      invulnerable: () => false,
    });
    expect(a.lastToHitMe).toBe("a Orc");
  });
});

describe("melee", () => {
  test("a seeded Slime fight: bare hands kill it, the kill gives 23 XP at level 1", () => {
    const map = testMap("x1000y992");
    const { join, run } = setup([map], undefined, seededRng(3));
    const a = player("a", map, 5, 5);
    a.facing = "E";
    a.char.stats.str = 20; // AttPower 6 bare-handed: 4 a hit on a Slime
    a.flicker = 0;
    join(a);
    live(map, 1, "Slime", 6, 5);
    (map.slots[0] as MonsterSlot).pause = 10_000; // keep it still
    setAttackHeld(a, true);
    const msgs = run(60);
    const hits = events(msgs, "a").filter((e) => e.e === "mhit");
    expect(hits.map((h) => (h.e === "mhit" ? h.dmg : 0))).toEqual([4, 4, 4, 4]);
    expect(hits.at(-1)).toMatchObject({ kill: true });
    expect(map.slots[0]?.live).toBeNull();
    expect(a.char.vitals.exp).toBe(23);
  });

  test("bug fixed: XP overflow carries over and a kill can raise several levels", () => {
    const map = testMap("x1000y992");
    const { join, run } = setup([map], undefined, rngByN());
    const a = player("a", map, 5, 5);
    a.facing = "E";
    a.char.stats.str = 20;
    // 29 + the Slime's 23 = 52: level 2 at 30 with 22 over. Then 400 + 406 more reach level 4.
    a.char.vitals.exp = 29;
    join(a);
    const m = live(map, 1, "Slime", 6, 5);
    m.hp = 0;
    (map.slots[0] as MonsterSlot).pause = 10_000;
    setAttackHeld(a, true);
    let msgs = run(2);
    expect(a.char.vitals).toMatchObject({ level: 2, exp: 22, expNeeded: 400, hpMax: 21 });
    expect(chat(msgs, "a").filter((t) => t === "You have become more powerful!")).toHaveLength(1);
    a.char.vitals.exp = 806 - 22; // a Slime gives 22 at level 2
    const m2 = live(map, 1, "Slime", 6, 5);
    m2.hp = 0;
    msgs = run(30);
    expect(a.char.vitals).toMatchObject({ level: 4, exp: 0, expNeeded: 408, hpMax: 23 });
    expect(chat(msgs, "a").filter((t) => t === "You have become more powerful!")).toHaveLength(2);
  });

  test("bug fixed: on a no-fight map an arena tile waits for the re-arm like any swing", () => {
    const map = testMap("x1", [], (x, y) => (x === 5 && y === 5 ? "6P" : "G1"));
    map.flags.canFight = "O";
    const { join, run } = setup([map], undefined, rngByN());
    const a = player("a", map, 5, 5);
    join(a);
    // Held: the key swings every 14 frames, as on a fight map.
    a.timers.atDelay = 1;
    setAttackHeld(a, true);
    const msgs = run(60);
    const swings = msgs
      .flatMap((m) => (m.msg.t === "delta" && m.to === "a" ? m.msg.events : []))
      .filter((e) => e.e === "swing");
    expect(swings.length).toBe(Math.floor(60 / 14) + 1);
  });

  test("bug fixed: off an arena tile on a no-fight map, a held key says it once per press", () => {
    const map = testMap("x1");
    map.flags.canFight = "O";
    const { join, run } = setup([map], undefined, rngByN());
    const a = player("a", map, 5, 5);
    join(a);
    setAttackHeld(a, true);
    expect(chat(run(5), "a")).toEqual(["You cannot fight here!"]);
    setAttackHeld(a, false);
    run(1);
    setAttackHeld(a, true);
    expect(chat(run(5), "a")).toEqual(["You cannot fight here!"]);
  });

  test("bug fixed: on a no-fight map a tap, released before the next tick, says it once", () => {
    const map = testMap("x1");
    map.flags.canFight = "O";
    const { join, run } = setup([map], undefined, rngByN());
    const a = player("a", map, 5, 5);
    join(a);
    setAttackHeld(a, true);
    const out = run(1);
    setAttackHeld(a, false);
    out.push(...run(5));
    expect(chat(out, "a")).toEqual(["You cannot fight here!"]);
  });
});

describe("monster attacks and death", () => {
  test("a Slime next to you hits on random(10) = 1; the floatie is colour 6 with i-frames after", () => {
    const map = testMap("x1000y992");
    const rng = rngByN({ 10: [1, 1], 3: [3, 3, 3, 3] });
    const { join, run } = setup([map], undefined, rng);
    const a = player("a", map, 5, 5);
    a.flicker = 0;
    join(a);
    live(map, 1, "Slime", 5, 6);
    (map.slots[0] as MonsterSlot).pause = 10_000;
    const msgs = run(2);
    const hits = events(msgs, "a").filter((e) => e.e === "phit");
    expect(hits).toEqual([{ e: "phit", id: "a", text: "4", color: 6, splat: true }]);
    expect(a.char.vitals.hp).toBe(16);
    // 40 set in pass 1 of tick 1, then 3 more calls (pass 2, then tick 2) count it down
    expect(a.flicker).toBe(37);
    expect(a.lastToHitMe).toBe("a Slime");
  });

  test("design change: a monster hit starts 40 calls of i-frames and never hides your sprite", () => {
    const map = testMap("x1000y992");
    const { join, run } = setup([map], undefined, rngByN({ 10: [1], 3: [3, 3, 3, 3] }));
    const a = player("a", map, 5, 5);
    a.flicker = 0;
    join(a);
    live(map, 1, "Slime", 5, 6);
    (map.slots[0] as MonsterSlot).pause = 10_000;
    const out = run(1);
    // Hit in pass 1, then one call in pass 2.
    expect(a.flicker).toBe(39);
    out.push(...run(20));
    expect(a.flicker).toBe(0);
    const selves = out.flatMap((o) => (o.to === "a" && o.msg.t === "you" ? [o.msg.self] : []));
    expect(selves.every((y) => !("hidden" in y))).toBe(true);
  });

  test("login: the i-frame counter starts at 40", () => {
    const map = testMap("x1000y992");
    const { join } = setup([map], undefined, rngByN());
    const a = player("a", map, 5, 5);
    join(a);
    expect(a.flicker).toBe(40);
  });

  test("a map load keeps the i-frame counter running", () => {
    const map = testMap("x1000y992");
    const { join, run, world } = setup([map], undefined, rngByN());
    const a = player("a", map, 5, 5);
    join(a);
    run(1);
    expect(a.flicker).toBe(38);
    leaveRoom(world, a);
    enterRoom(world, a);
    expect(a.flicker).toBe(38);
  });

  test('death: the dying player gets { t: "death" } after the tick\'s vitals, once, and nobody else does', () => {
    const map = testMap("x1000y992");
    const { join, run } = setup([map], undefined, rngByN({ 5: [1] }));
    const a = player("a", map, 9, 9);
    const b = player("b", map, 2, 2);
    join(a);
    join(b);
    a.char.vitals.hp = 0;
    const msgs = run(1);
    const types = msgs.filter((m) => m.to === "a").map((m) => m.msg.t);
    expect(types.filter((t) => t === "death")).toHaveLength(1);
    expect(types.indexOf("death")).toBeGreaterThan(types.indexOf("vitals"));
    expect(msgs.some((m) => m.to === "b" && m.msg.t === "death")).toBe(false);
    // The next ticks of the 27-frame lock send no second one.
    expect(run(5).some((m) => m.msg.t === "death")).toBe(false);
  });

  test("a Lightning death sends it too", () => {
    const map = testMap("x1000y992");
    const { join, run } = setup([map], undefined, rngByN({ 5: [1] }));
    const a = player("a", map, 9, 9);
    join(a);
    a.lightningDeath = true;
    a.char.vitals.hp = 20;
    expect(run(1).some((m) => m.to === "a" && m.msg.t === "death")).toBe(true);
  });

  test("death: HP and SP 1, facing south, then the death text to everyone and the respawn warp", () => {
    const map = testMap("x1000y992");
    const rng = rngByN({ 5: [1] });
    const { join, run, world } = setup([map], undefined, rng);
    const a = player("a", map, 9, 9);
    const b = player("b", map, 2, 2);
    join(a);
    join(b);
    a.char.vitals.hp = 0;
    a.lastToHitMe = "a Slime";
    let msgs = run(1);
    expect(a.deadLock).toBe(27);
    expect(a.char.vitals).toMatchObject({ hp: 1, sp: 1, hpMax: 20, spMax: 20 });
    expect(a.facing).toBe("S");
    expect(chat(msgs, "a")).toEqual([]);
    msgs = run(26);
    expect(chat(msgs, "b")).toEqual([]);
    msgs = run(1);
    expect(chat(msgs, "b")).toEqual(["*** a was just killed by a Slime."]);
    expect(msgs.find((m) => m.to === "b" && m.msg.t === "chat")?.msg).toMatchObject({ color: 8 });
    expect([a.x, a.y, a.char.hunger]).toEqual([6, 4, 40000]);
    expect(a.deathPause).toBe(90 - 27);
    expect(world.players.size).toBe(2);
  });

  test("divergence: a wanted player's deaths never lower HPmax or SPmax, on a PvP map or not", () => {
    for (const pvp of ["X", "O"]) {
      const map = testMap("x1000y992");
      map.flags.canPvp = pvp;
      // random(5) = 1 every time: 1.6's one-in-five penalty roll would always hit.
      const { join, run } = setup([map], undefined, rngByN({ 5: [1, 1, 1, 1, 1, 1, 1, 1] }));
      const a = player("a", map, 9, 9);
      join(a);
      a.char.wanted = true;
      a.char.vitals = { ...a.char.vitals, hp: 0, hpMax: 40, spMax: 30 };
      a.lastToHitMe = "a Slime";
      run(1);
      expect(a.deadLock).toBe(27);
      expect(a.char.vitals).toMatchObject({ hp: 1, sp: 1, hpMax: 40, spMax: 30 });
    }
  });

  test("administrators take no monster damage", () => {
    const map = testMap("x1000y992");
    const { join, run } = setup([map], undefined, rngByN({ 10: [1] }));
    const a = player("a", map, 5, 5);
    a.role = ADMINISTRATOR;
    a.flicker = 0;
    join(a);
    live(map, 1, "Slime", 5, 6);
    run(1);
    expect(a.char.vitals.hp).toBe(20);
  });

  test("the eight sea creatures move only on water", () => {
    const seaCreatures = [
      "Squid",
      "Shark",
      "Mizella",
      "Krommie",
      "Jelstar",
      "Merius",
      "Mellanie",
      "Minmaye",
    ];
    for (const name of seaCreatures) {
      const land = testMap("x1000y992");
      const slot = land.slots[0] as MonsterSlot;
      slot.live = {
        name,
        hp: 10,
        x: 5,
        y: 5,
        facing: "E",
        anim: 0,
        fromX: 5,
        fromY: 5,
        queue: ["R"],
        hitCountb: 0,
      };
      expect(nextStep(land, slot, { players: [], rng: rngByN() })).toBeNull();
      const water = testMap("x1000y992", [], () => "W1");
      const wSlot = water.slots[0] as MonsterSlot;
      wSlot.live = {
        name,
        hp: 10,
        x: 5,
        y: 5,
        facing: "E",
        anim: 0,
        fromX: 5,
        fromY: 5,
        queue: ["R"],
        hitCountb: 0,
      };
      expect(nextStep(water, wSlot, { players: [], rng: rngByN() })).not.toBeNull();
    }
  });

  test("Officer fights a wanted player on a no-fight map", () => {
    const map = testMap("x1000y992");
    map.flags.canFight = "O";
    const { join, run } = setup([map], undefined, rngByN({ 10: [1] }));
    const a = player("a", map, 5, 5);
    a.flicker = 0;
    a.char.wanted = true;
    join(a);
    live(map, 1, "Officer", 5, 6);
    run(1);
    expect(a.lastToHitMe).toBe("a Officer");
    expect(a.char.vitals.hp).toBeLessThan(20);
  });

  test("Holy Shield never hits an innocent", () => {
    const map = testMap("x1000y992");
    const { join, run } = setup([map], undefined, rngByN({ 10: [1] }));
    const a = player("a", map, 5, 5);
    a.flicker = 0;
    a.char.wanted = false;
    join(a);
    live(map, 1, "Holy Shield", 5, 6);
    run(1);
    expect(a.lastToHitMe).toBeNull();
    expect(a.char.vitals.hp).toBe(20);
  });
});
