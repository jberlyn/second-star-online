/**
 * Sim tests: spawning, monster AI and attacks, melee, XP, death (seeded and scripted
 * `Rng` replays).
 */
import { describe, expect, test } from "bun:test";

import { type ServerMsg, skillIndex } from "@secondstaronline/shared";

import { seededRng } from "../src/rng.ts";
import { onArenaTile, setAttackHeld } from "../src/systems/combat/melee.ts";
import { authorPath, moveLadder, moverPass, nextStep } from "../src/systems/monsters/ai.ts";
import { monsterAttack, monsterAttackValue } from "../src/systems/monsters/attack.ts";
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
  test("ladders: spawn 80…1300 by players, move 30…600 then 50 at the 9th", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(spawnLadder)).toEqual([
      80, 120, 230, 400, 600, 900, 1300, 1300,
    ]);
    expect([1, 2, 8, 9, 15].map(moveLadder)).toEqual([30, 50, 600, 50, 50]);
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

  test("kept bug: slot 5 never spawns: a roster has four slots", () => {
    expect(testMap("x1").slots.map((s) => s.slot)).toEqual([1, 2, 3, 4]);
  });

  test("kept bug: a failed NPCed roll ends the whole pass", () => {
    const map = withRoster(testMap("x1"), "Trimble", "Slime");
    const rng = rngByN({ 80: [1], 5: [1, 1], 60: [3] });
    expect(spawnPass(map, { rng, players: 1, minute: 0 })).toEqual([]);
    expect(map.slots[1]?.live).toBeNull();
    expect(rng.calls.filter((n) => n === 17)).toHaveLength(1);
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

  test("kept bug: a species with no HP entry inherits the slot's last HP", () => {
    const map = testMap("x1");
    const slot = map.slots[0] as MonsterSlot;
    slot.lastHp = -3;
    expect(placeMonster(slot, "Trimble", 4, 4, rngByN()).hp).toBe(-3);
    expect(placeMonster(slot, "Slime", 4, 4, rngByN()).hp).toBe(14);
  });

  test("kept bug: the footprint test is skipped at x > 12 or y > 9", () => {
    const map = testMap("x1", [[14, 3]]);
    expect(refusesTile(map, "Overlord", 13, 4)).toBe(false); // (14,3) is a tree
    expect(refusesTile(map, "Overlord", 12, 4)).toBe(true); // (14,3) is the (+2,−1) cell
  });

  test("kept bug: five sea creatures spawn on land; Squid needs water", () => {
    const map = testMap("x1", [], (x) => (x === 3 ? "W1" : "G1"));
    expect(refusesTile(map, "Krommie", 5, 5)).toBe(false);
    expect(refusesTile(map, "Squid", 5, 5)).toBe(true);
    // W1 is not on the on-foot whitelist, so Krommie can never spawn on water.
    expect(refusesTile(map, "Squid", 3, 5)).toBe(false);
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
  test("a hostile path leans toward the author by pixel position", () => {
    const map = testMap("x1");
    const m = live(map, 1, "Slime", 5, 5);
    const a = player("a", map, 5, 9); // below, same column: L, R or D
    const path = authorPath(ARCHIVE_NPCS, m, a, rngByN({ 10: [4], 3: [1, 2, 3, 3] }));
    expect(path).toEqual(["L", "R", "D", "D"]);
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
    const step = nextStep(map, map.slots[0] as MonsterSlot);
    expect(step).toMatchObject({ fromX: 5, fromY: 5 });
    expect([m.x, m.y, m.facing, m.anim]).toEqual([6, 5, "E", 16]);
    expect(map.slots[0]?.pause).toBe(90);
    expect(m.queue).toEqual([]);
  });

  test("kept bug: slot 2's pause after authoring is 0 when no step can start", () => {
    const map = testMap("x1", [
      [4, 5],
      [6, 5],
      [5, 4],
      [5, 6],
    ]);
    live(map, 1, "Slime", 2, 2);
    live(map, 2, "Slime", 5, 5); // boxed in by trees
    const a = player("a", map, 10, 10);
    moverPass(ARCHIVE_NPCS, map, a, 1, rngByN({ 30: [2], 10: [3] }));
    expect(map.slots[1]?.pause).toBe(0);
    moverPass(ARCHIVE_NPCS, map, a, 1, rngByN({ 30: [1], 10: [3] }));
    expect(map.slots[0]?.pause).toBe(90);
  });

  test("steps follow back to back, 16 calls = 8 frames each, and players never block them", () => {
    const map = testMap("x1000y992");
    const m = live(map, 1, "Slime", 5, 5);
    const { join, run, world } = setup([map], undefined, rngByN());
    const a = player("a", map, 6, 5);
    join(a);
    m.queue = ["R", "R"];
    nextStep(map, map.slots[0] as MonsterSlot);
    expect([m.x, m.y]).toEqual([6, 5]); // onto the player's tile
    run(8);
    expect([m.x, m.y]).toEqual([7, 5]);
    expect(m.anim).toBe(16);
    expect(world.tickNo).toBe(8);
  });
});

describe("kept bugs in the monster tables", () => {
  test("kept bug: the hostile list is matched by contains: Dragon leans via Dragon Hatchling, Overlord wanders", () => {
    expect(leansToward("Dragon")).toBe(true);
    expect(leansToward("Overlord")).toBe(false);
    expect(leansToward("Slime")).toBe(true);
  });
  test("kept bug: a name with no attack entry hits for 35", () => {
    expect(monsterAttackValue("Trimble")).toBe(35);
    expect(monsterAttackValue("Slime")).toBe(1);
  });
  test('kept bug: the "Snared Load" typo in the attack table misses the Snared Loah, which hits for the default 35, not 18', () => {
    expect(species("Snared Loah")?.attack).toBe(35);
    expect(monsterAttackValue("Snared Loah")).toBe(35);
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
      immortal: () => false,
    });
    expect([r.outcome?.text, r.outcome?.lines]).toEqual([
      "Parry",
      ["You have advanced in the art of Parry!"],
    ]);
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
      immortal: () => false,
    });
    expect([r.outcome?.text, r.outcome?.lines]).toEqual([
      "Block",
      ["You have advanced in the art of Block!"],
    ]);
    expect(a.char.skills[skillIndex("Block")]).toBe(6);
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
  test("kept bug: an unprovoked Passive monster's random(10) = 1 skips its walk tick", () => {
    const map = testMap("x1000y992");
    const m = live(map, 1, "Kin", 5, 5);
    m.anim = 10;
    const a = player("a", map, 9, 9);
    const r = monsterAttack(map, map.slots[0] as MonsterSlot, a, {
      rng: rngByN({ 10: [1] }),
      npcs: ARCHIVE_NPCS,
      immortal: () => false,
    });
    expect(r).toEqual({ outcome: null, stall: true });
    a.npcAttackFlag = true;
    const provoked = monsterAttack(map, map.slots[0] as MonsterSlot, a, {
      rng: rngByN({ 10: [1] }),
      npcs: ARCHIVE_NPCS,
      immortal: () => false,
    });
    expect(provoked.stall).toBe(false);
  });
  test("kept bug: the last monster to roll against you is blamed, even during i-frames", () => {
    const map = testMap("x1000y992");
    live(map, 1, "Orc", 5, 6);
    const a = player("a", map, 5, 5);
    a.flicker = 20;
    monsterAttack(map, map.slots[0] as MonsterSlot, a, {
      rng: rngByN({ 10: [1] }),
      npcs: ARCHIVE_NPCS,
      immortal: () => false,
    });
    expect(a.lastToHitMe).toBe("a Orc");
    expect(a.char.vitals.hp).toBe(20);
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
    expect(map.slots[0]?.lastHp).toBe(-2);
    expect(a.char.vitals.exp).toBe(23);
  });

  test("kept bug: XP overflow is lost and one level comes per kill", () => {
    const map = testMap("x1000y992");
    const { join, run } = setup([map], undefined, rngByN());
    const a = player("a", map, 5, 5);
    a.facing = "E";
    a.char.stats.str = 20;
    a.char.vitals.exp = 29;
    join(a);
    const m = live(map, 1, "Slime", 6, 5);
    m.hp = 0;
    (map.slots[0] as MonsterSlot).pause = 10_000;
    setAttackHeld(a, true);
    const msgs = run(2);
    expect(a.char.vitals).toMatchObject({ level: 2, exp: 0, expNeeded: 400, hpMax: 21 });
    expect(chat(msgs, "a")).toContain("You have become more powerful!");
  });

  test("bug fixed: on a no-fight map an arena tile waits for the re-arm like any swing", () => {
    const map = testMap("x1", [], (x, y) => (x === 5 && y === 5 ? "6P" : "G1"));
    map.flags.canFight = "O";
    const { join, run } = setup([map], undefined, rngByN());
    const a = player("a", map, 5, 5);
    join(a);
    // Waited for +7, then held: the re-arm resets the bar's member before the swing, so a held
    // key swings at +0 every 14 frames, as on a fight map.
    a.timers.barMember = 475;
    a.timers.atDelay = 1;
    setAttackHeld(a, true);
    const msgs = run(60);
    const swings = msgs
      .flatMap((m) => (m.msg.t === "delta" && m.to === "a" ? m.msg.events : []))
      .filter((e) => e.e === "swing");
    expect(swings.every((e) => e.e === "swing" && e.bonus === 0)).toBe(true);
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

  /** A Slime beside `a` hits in the actor pass that draws random(10) = 1 (`first` rolls before). */
  function blinkScene(first: number) {
    const map = testMap("x1000y992");
    const rolls = [...Array(first).fill(2), 1];
    const { join, run } = setup([map], undefined, rngByN({ 10: rolls, 3: [3, 3, 3, 3] }));
    const a = player("a", map, 5, 5);
    a.flicker = 0;
    join(a);
    live(map, 1, "Slime", 5, 6);
    (map.slots[0] as MonsterSlot).pause = 10_000;
    /** `hidden` at the end of each of `n` ticks. */
    const hiddenAtTickEnds = (n: number) => {
      const seen: boolean[] = [];
      for (let i = 0; i < n; i++) {
        run(1);
        seen.push(a.hidden);
      }
      return seen;
    };
    return { a, run, hiddenAtTickEnds };
  }

  test("kept bug: a monster hit in pass 1 hides your sprite for the whole 20 frames, not a blink", () => {
    const { a, hiddenAtTickEnds } = blinkScene(0);
    // The hit lands in pass 1 of tick 1, after the player sprite's call: 40 calls are left, the
    // first in pass 2, so every tick ends with the flip count odd (hidden) until the last call.
    const seen = hiddenAtTickEnds(22);
    expect(seen.slice(0, 20)).toEqual(Array(20).fill(true));
    expect(seen.slice(20)).toEqual([false, false]);
    expect(a.flicker).toBe(0);
  });

  test("a monster hit in pass 2 leaves your sprite drawn (an even count of flips per frame)", () => {
    const { a, hiddenAtTickEnds } = blinkScene(1);
    const seen = hiddenAtTickEnds(22);
    expect(seen.every((h) => !h)).toBe(true);
    expect(a.flicker).toBe(0);
  });

  test("login: the counter starts at 40 with the sprite shown", () => {
    const map = testMap("x1000y992");
    const { join } = setup([map], undefined, rngByN());
    const a = player("a", map, 5, 5);
    join(a);
    expect([a.flicker, a.hidden]).toEqual([40, false]);
  });

  test("a map load shows the sprite again; the counter keeps running", () => {
    const map = testMap("x1000y992");
    const { join, run, world } = setup([map], undefined, rngByN());
    const a = player("a", map, 5, 5);
    join(a);
    run(1);
    expect([a.hidden, a.flicker]).toEqual([false, 38]);
    a.hidden = true; // mid-blink
    leaveRoom(world, a);
    enterRoom(world, a);
    expect(a.hidden).toBe(false);
    expect(a.flicker).toBeGreaterThan(0);
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

  test("death: penalty roll, HP and SP 1, facing south, then the death text to everyone and the respawn warp", () => {
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
    expect(a.char.vitals).toMatchObject({ hp: 1, sp: 1, hpMax: 19, spMax: 19 });
    expect(a.facing).toBe("S");
    expect(chat(msgs, "a")).toContain(
      "*** Your downfall in battle has caused you to become weakened.",
    );
    msgs = run(26);
    expect(chat(msgs, "b")).toEqual([]);
    msgs = run(1);
    expect(chat(msgs, "b")).toEqual(["*** a was just killed by a Slime."]);
    expect(msgs.find((m) => m.to === "b" && m.msg.t === "chat")?.msg).toMatchObject({ color: 8 });
    expect([a.x, a.y, a.char.hunger]).toEqual([6, 4, 40000]);
    expect(a.deathPause).toBe(90 - 27);
    expect(world.players.size).toBe(2);
  });

  test("immortals take no monster damage", () => {
    const map = testMap("x1000y992");
    const { join, run } = setup([map], undefined, rngByN({ 10: [1] }));
    const a = player("a", map, 5, 5);
    a.role = "immortal";
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
      expect(nextStep(land, slot)).toBeNull();
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
      expect(nextStep(water, wSlot)).not.toBeNull();
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
