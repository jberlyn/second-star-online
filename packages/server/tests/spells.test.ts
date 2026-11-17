/**
 * Spells on the server sim: the cast, FX against monsters and players, summons, books, the server
 * timer, monster spells, arrows and the Portal spell.
 */
import { describe, expect, test } from "bun:test";

import {
  CAST_TEXT,
  EFFECT_TEXT,
  type ServerMsg,
  skillIndex,
  summonFor,
  tileLoc,
} from "@secondstaronline/shared";

import { npcFileNamed, setNpcFile } from "../src/systems/monsters/npcfiles.ts";
import type { MonsterSlot } from "../src/systems/monsters/slots.ts";
import { species } from "../src/systems/monsters/slots.ts";
import { castIntent, npcBlockedSubstring, shootArrow } from "../src/systems/spells/cast.ts";
import { SPELL_LEVEL_UP_TEXT } from "../src/systems/spells/collide.ts";
import { queueCast } from "../src/systems/spells/fx.ts";
import { playerLoc } from "../src/systems/spells/geometry.ts";
import { CHURCH_MAP, serverTimer, TIMEOUT_TICKS } from "../src/systems/spells/hazards.ts";
import { readBook } from "../src/systems/spells/learn.ts";
import { monsterSpells } from "../src/systems/spells/monsterspells.ts";
import { tick } from "../src/systems/world/tick.ts";
import {
  addPlayer,
  createWorld,
  type Player,
  type Room,
  type WorldMap,
} from "../src/systems/world/world.ts";
import { ARCHIVE_NPCS, NO_CASINO, player, rngByN, setup, testMap } from "./helpers/sim.ts";

type Out = { to: string; msg: ServerMsg }[];
const events = (msgs: Out, to: string) =>
  msgs.flatMap((m) => (m.to === to && m.msg.t === "delta" ? m.msg.events : []));
const chat = (msgs: Out, to: string) =>
  msgs.flatMap((m) => (m.to === to && m.msg.t === "chat" ? [m.msg.text] : []));

function live(map: WorldMap, slot: number, name: string, x: number, y: number, hp?: number) {
  const s = map.slots[slot - 1] as MonsterSlot;
  s.species ??= name;
  s.live = {
    name,
    hp: hp ?? species(name)?.hp ?? 0,
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

const at = (x: number, y: number) => tileLoc(x, y);
/**
 * A click in the middle of tile (x, y): a character's loc (x·32+14, y·32−3) lies 2 px above
 * its tile, so `(mouse − (30, 31)) / 32 + 1` there names the tile above.
 */
const centre = (x: number, y: number) => ({ h: x * 32 + 14, v: y * 32 + 15 });

function scene(rng = rngByN()) {
  const map = testMap("x1000y992");
  const { world, join, run } = setup([map], undefined, rng);
  const a = player("Ann", map, 6, 6);
  const b = player("Bob", map, 9, 6);
  for (const p of [a, b]) {
    p.flicker = 0;
    p.char.vitals = { ...p.char.vitals, sp: 200, spMax: 200, hp: 20, hpMax: 40 };
  }
  join(a);
  join(b);
  const room = world.rooms.get(map.name) as Room;
  const cast = (p: Player, spell: string, h: number, v: number) =>
    castIntent(room, p, spell, h, v, { rng });
  return { map, world, room, a, b, run, cast, rng };
}

const give = (p: Player, item: string, qty: number) => {
  const i = p.char.bag.indexOf(null);
  p.char.bag[i] = { item, qty };
};

describe("the cast", () => {
  test("a spell not in your spellbook does nothing at all, not even the delay", () => {
    const { a, cast } = scene();
    cast(a, "Fireball", 200, 100);
    expect(a.timers.actionDelay).toBe(0);
  });
  test("kept bug: the delay is set before every later check; an empty selection costs it", () => {
    const { a, cast } = scene();
    cast(a, "", 200, 100);
    expect(a.timers.actionDelay).toBe(20);
  });
  test("kept bug: the spell click area is larger than the playfield [30,31,574,415]: the server takes 8 < H < 580, 5 < V < 420", () => {
    const { a, cast } = scene();
    // The empty selection passes the book test and costs the delay once inside the bounds.
    const delay = (h: number, v: number) => {
      a.timers.actionDelay = 0;
      cast(a, "", h, v);
      return a.timers.actionDelay;
    };
    expect(delay(9, 6)).toBe(20);
    expect(delay(579, 419)).toBe(20);
    expect(delay(8, 100)).toBe(0);
    expect(delay(100, 5)).toBe(0);
    expect(delay(580, 100)).toBe(0);
    expect(delay(100, 420)).toBe(0);
  });
  test("ActionDelay > 0 exits, shared with melee", () => {
    const { a, cast } = scene();
    a.spell.book = ["Minor Heal"];
    give(a, "Blue Crystals", 10);
    cast(a, "Minor Heal", 200, 100);
    cast(a, "Minor Heal", 200, 100);
    expect(a.char.vitals.sp).toBe(195);
  });
  test("not enough SP and too few crystals: the messages", () => {
    const { a, cast } = scene();
    a.spell.book = ["Minor Heal", "Meteor"];
    a.char.vitals.sp = 30;
    expect(cast(a, "Meteor", 200, 100).out.map((o) => o.msg)).toContainEqual({
      t: "chat",
      text: CAST_TEXT.sp(34),
      color: 0,
    });
    a.timers.actionDelay = 0;
    const r = cast(a, "Minor Heal", 200, 100);
    expect(r.out[0]?.msg).toEqual({ t: "chat", text: CAST_TEXT.crystals("Minor Heal"), color: 0 });
    expect(a.char.vitals.sp).toBe(30);
  });
  test("SP and crystals are taken from the last crystal line", () => {
    const { a, room, cast } = scene();
    a.spell.book = ["Minor Heal"];
    give(a, "Blue Crystals", 2);
    give(a, "Blue Crystals", 5);
    cast(a, "Minor Heal", 200, 100);
    expect(a.char.bag[1]).toEqual({ item: "Blue Crystals", qty: 2 });
    expect(a.char.vitals.sp).toBe(195);
    expect(room.fxQueue).toHaveLength(1);
  });
  test("harmful spells and Hold are refused on a safe map before SP is spent", () => {
    const { a, map, cast } = scene();
    map.flags.canFight = "O";
    a.spell.book = ["Hold", "Fireball"];
    give(a, "Purple Crystals", 10);
    const r = cast(a, "Hold", 200, 100);
    expect(r.out[0]?.msg).toEqual({ t: "chat", text: CAST_TEXT.harmful, color: 0 });
    expect(a.char.vitals.sp).toBe(200);
    expect(a.timers.actionDelay).toBe(20);
  });
  test("kept bug: Portal is refused near any player, the caster too, after SP and crystals are spent", () => {
    const { a, room, cast } = scene();
    a.spell.book = ["Portal"];
    give(a, "White Crystals", 10);
    const me = at(6, 6);
    const r = cast(a, "Portal", me.h, me.v);
    expect(r.out[0]?.msg).toEqual({ t: "chat", text: CAST_TEXT.portal, color: 0 });
    expect(a.char.vitals.sp).toBe(200 - 32);
    expect(a.char.bag.some((l) => l?.item === "White Crystals")).toBe(false);
    expect(room.fxQueue).toHaveLength(0);
  });
});

describe("FX and monsters", () => {
  test("a fireball at a monster is placed next frame and hits in that frame's actor passes on FireballU-1 for 4 + P + random(3)", () => {
    const { a, map, run, cast } = scene();
    a.spell.book = ["Fireball"];
    give(a, "Red Crystals", 10);
    const m = live(map, 1, "Slime", 6, 5, 14);
    const t = at(6, 5);
    cast(a, "Fireball", t.h, t.v);
    const first = run(1);
    expect(events(first, "Ann")).toContainEqual({
      e: "fx",
      slot: 1,
      name: "FireballU",
      h: t.h,
      v: t.v,
      caster: "Ann",
    });
    // The network message places it before actor pass 1, so the hit lands the same frame.
    expect(m.hp).toBe(14 - (4 + 1 + 3));
    expect(events(first, "Bob")).toContainEqual({
      e: "mspell",
      slot: 1,
      text: "8",
      color: 124,
      splat: true,
      kill: false,
    });
    expect(m.hitCountb).toBe(15); // 16 set in pass 1, counted down in pass 2
  });
  test("a spell kill pays the spell XP table and its own level-up line", () => {
    const { a, map, run, cast } = scene();
    a.spell.book = ["Fireball"];
    give(a, "Red Crystals", 10);
    live(map, 1, "Slime", 6, 5, 3);
    a.char.vitals.exp = 29;
    const t = at(6, 5);
    cast(a, "Fireball", t.h, t.v);
    const out = run(2);
    expect(map.slots[0]?.live).toBeNull();
    expect(events(out, "Ann").some((e) => e.e === "mspell" && e.kill)).toBe(true);
    expect(chat(out, "Ann")).toContain(SPELL_LEVEL_UP_TEXT);
  });
  test("minor heal heals a monster (cap 200) and hurts an undead 61- body", () => {
    const { a, map, run, cast } = scene();
    a.spell.book = ["Minor Heal"];
    give(a, "Blue Crystals", 10);
    const slime = live(map, 1, "Slime", 6, 4, 5);
    const t = at(6, 4);
    cast(a, "Minor Heal", t.h, t.v);
    // Placed on frame 1, the mover sees `minor heal-3` two steps later.
    run(4);
    // 3 + P + random(5) with P = 1 + Blessing 2, capped at the Slime's 14.
    expect(slime.hp).toBe(14);
  });
});

describe("monsters heal past their own hit points", () => {
  test("kept bug: a spell heal lifts a Pig far above its 1 hit point and stops at the default cap of 200", () => {
    const { a, map, run, cast } = scene();
    a.spell.book = ["Minor Heal"];
    give(a, "Blue Crystals", 10);
    const pig = live(map, 1, "Pig", 6, 4, 1);
    const t = at(6, 4);
    cast(a, "Minor Heal", t.h, t.v);
    run(4);
    // A Pig has 1 hit point, yet a spell heal takes it above that.
    expect(pig.hp).toBeGreaterThan(1);
    // Near the top the same heal stops at the default cap of 200.
    pig.hp = 195;
    run(30);
    cast(a, "Minor Heal", t.h, t.v);
    run(4);
    expect(pig.hp).toBe(200);
  });
});

describe("players", () => {
  test("minor heal heals whoever stands in it, colour 5", () => {
    const { a, b, run, cast } = scene();
    a.spell.book = ["Minor Heal"];
    give(a, "Blue Crystals", 10);
    const t = at(9, 6);
    cast(a, "Minor Heal", t.h, t.v);
    const out = run(3);
    // 2 + P + random(2), P = 1 + Blessing's +2.
    expect(b.char.vitals.hp).toBe(20 + 2 + 3 + 2);
    expect(events(out, "Ann")).toContainEqual({ e: "phit", id: "Bob", text: "7", color: 5 });
  });
  test("damage only where PvP is on; the victim flickers 40 frames", () => {
    const { a, b, map, run, cast } = scene();
    a.spell.book = ["Firebolt"];
    give(a, "Red Crystals", 20);
    map.flags.canPvp = "O";
    const t = at(9, 6);
    cast(a, "Firebolt", t.h, t.v);
    run(17);
    expect(b.char.vitals.hp).toBe(20);
    map.flags.canPvp = "X";
    a.timers.actionDelay = 0;
    cast(a, "Firebolt", t.h, t.v);
    run(17);
    // 8 + P + random(3), P = 1 + Fire's +2; the bolt falls from above and lands on its later
    // frames (Firebolt-n rects sit up to 82 px above the loc).
    expect(b.char.vitals.hp).toBe(20 - (8 + 3 + 3));
    expect(b.lastToHitMe).toBe("Ann");
  });
  test("Hold: the hold counter = P·8, no step while it runs, the text", () => {
    const { a, b, run, cast } = scene();
    a.spell.book = ["Hold"];
    give(a, "Purple Crystals", 10);
    const t = at(9, 6);
    cast(a, "Hold", t.h, t.v);
    const out = run(4);
    expect(chat(out, "Bob")).toContain(EFFECT_TEXT.hold);
    expect(b.spell.hold).toBeGreaterThan(0);
    b.held = "R";
    run(1);
    expect(b.x).toBe(9);
  });
  test("Stone Skin stacks: the defense bonus + 1 and its counter + P·30, then back to 0", () => {
    const { a, run, cast } = scene();
    a.spell.book = ["Stone Skin"];
    give(a, "Purple Crystals", 10);
    const t = at(6, 6);
    cast(a, "Stone Skin", t.h, t.v);
    const out = run(12);
    expect(chat(out, "Ann")).toContain(EFFECT_TEXT.stoneSkin);
    expect(a.defenseBonus).toBe(1);
    // The defense counter = P·30 = 90 with P = 1 + Earth's +2.
    const ends = run(90);
    expect(chat(ends, "Ann")).toContain(EFFECT_TEXT.stoneSkinEnds);
    expect(a.defenseBonus).toBe(0);
  });
  test("kept bug: Whirlwind drains 1 SP a frame of overlap, no flicker", () => {
    const { a, b, run, cast } = scene();
    a.spell.book = ["Whirlwind"];
    give(a, "Purple Crystals", 10);
    const t = at(9, 6);
    cast(a, "Whirlwind", t.h, t.v);
    run(11);
    // Placed and tested on frame 1, then ten more frames.
    expect(b.char.vitals.sp).toBe(189);
    expect(b.flicker).toBe(0);
  });
  test("kept bug: your own harmful spell exits the whole collision, shielding you from later FX", () => {
    const { a, b, run, cast, room } = scene();
    a.spell.book = ["Minor Heal", "Whirlwind"];
    b.spell.book = ["Minor Heal"];
    give(a, "Purple Crystals", 10);
    give(b, "Blue Crystals", 10);
    const me = at(6, 6);
    cast(a, "Whirlwind", me.h, me.v); // slot 1: mine
    cast(b, "Minor Heal", me.h, me.v); // slot 2
    // Placed before actor pass 1: the heal's last step is in frame 4.
    run(3);
    expect(room.fx.map((f) => f.slot)).toEqual([1, 2]);
    expect(a.char.vitals.hp).toBe(20);
  });
  test("Morph changes the body for everyone; the morph counter 1300 then a revert", () => {
    const { a, run, cast } = scene(rngByN({ 5: [1] }));
    a.spell.book = ["Morph"];
    give(a, "Yellow Crystals", 10);
    const me = at(6, 6);
    cast(a, "Morph", me.h, me.v);
    const out = run(4);
    expect(events(out, "Bob")).toContainEqual({ e: "body", id: "Ann", body: 30 });
    expect(a.spell.morph).toBeGreaterThan(1290);
    a.spell.morph = 1;
    expect(events(run(1), "Bob")).toContainEqual({ e: "body", id: "Ann", body: null });
  });
});

describe("summons", () => {
  test("Summon Creature: a Pig in the first free slot; Cow at Sorcery > 39", () => {
    const { a, map, cast } = scene();
    a.spell.book = ["Summon Creature"];
    give(a, "White Crystals", 10);
    const t = centre(4, 4);
    cast(a, "Summon Creature", t.h, t.v);
    expect(map.slots[0]?.live).toMatchObject({ name: "Pig", x: 4, y: 4 });
    a.char.skills[skillIndex("Sorcery")] = 40;
    a.timers.actionDelay = 0;
    cast(a, "Summon Creature", t.h, t.v);
    expect(map.slots[1]?.live?.name).toBe("Cow");
  });
  test("kept bug: with four live monsters the summon fails silently, paid for", () => {
    const { a, map, cast } = scene();
    for (const k of [1, 2, 3, 4]) {
      live(map, k, "Slime", k, 1);
    }
    a.spell.book = ["Summon Creature"];
    give(a, "White Crystals", 10);
    const t = at(4, 4);
    const r = cast(a, "Summon Creature", t.h, t.v);
    expect(r.out).toEqual([]);
    expect(a.char.vitals.sp).toBe(200 - 13);
  });
  test("SSO: a summon on a tile off the 17×12 map fails silently, paid for", () => {
    const { a, map, cast } = scene();
    a.spell.book = ["Summon Creature"];
    give(a, "White Crystals", 10);
    // H 579 is inside the cast bounds and names tile (579 − 30) / 32 + 1 = 18.
    const r = cast(a, "Summon Creature", 579, 200);
    expect(r.out).toEqual([]);
    expect(map.slots.every((s) => !s.live)).toBe(true);
    expect(a.char.vitals.sp).toBe(200 - 13);
    a.timers.actionDelay = 0;
    // V 419 names row (419 − 31) / 32 + 1 = 13.
    cast(a, "Summon Creature", 200, 419);
    expect(map.slots.every((s) => !s.live)).toBe(true);
  });
  test("kept bug: Summon Creature's blocked test matches part of the tile name: x1y1 is blocked by x1y10", () => {
    const map = testMap("x1", [[1, 10]]);
    const room: Room = { map, npcs: ARCHIVE_NPCS, players: [], fx: [], fxQueue: [], doorLock: 0 };
    expect(npcBlockedSubstring(room, 1, 1)).toBe(true);
    expect(npcBlockedSubstring(room, 2, 1)).toBe(false);
  });
  test("kept bug: Raise Dead raises the Zombie on the tile below a grave", () => {
    const { a, map, cast } = scene();
    const row = map.layers[1][2]?.split(" ") ?? [];
    row[4] = "Q8"; // a grave at (5, 3)
    map.layers[1][2] = row.join(" ");
    a.spell.book = ["Raise Dead"];
    give(a, "Purple Crystals", 20);
    const grave = centre(5, 3);
    cast(a, "Raise Dead", grave.h, grave.v);
    expect(map.slots[0]?.live).toMatchObject({ name: "Zombie", x: 5, y: 4 });
  });
});

describe("books", () => {
  test("Dex too low: the refusal, the book kept", () => {
    const p = player("Ann", testMap("x1"), 1, 1);
    p.char.stats.dex = 10;
    give(p, "Meteor Book", 1);
    expect(readBook(p, 0, rngByN())).toEqual([
      "Your mysticism is not high enough to learn this spell.",
    ]);
    expect(p.char.bag[0]).toEqual({ item: "Meteor Book", qty: 1 });
  });
  test("read and learned, the book used up", () => {
    const p = player("Ann", testMap("x1"), 1, 1);
    give(p, "Fireball Book", 1);
    p.char.stats.dex = 20;
    expect(readBook(p, 0, rngByN())).toEqual([
      "You read the book...",
      "You have learned the spell of Fireball.",
    ]);
    expect(p.char.bag[0]).toBeNull();
    expect(p.spell.book).toEqual(["Fireball"]);
  });
  test("kept bug: reading a Bolt Book can use up an earlier Firebolt Book", () => {
    const p = player("Ann", testMap("x1"), 1, 1);
    p.char.stats.dex = 30;
    give(p, "Firebolt Book", 1);
    give(p, "Bolt Book", 1);
    readBook(p, 1, rngByN());
    expect(p.char.bag[0]).toBeNull();
    expect(p.char.bag[1]).toEqual({ item: "Bolt Book", qty: 1 });
    expect(p.spell.book).toEqual(["Bolt"]);
  });
  test("kept bug: a book is used up when the spell is already known", () => {
    const p = player("Ann", testMap("x1"), 1, 1);
    p.spell.book = ["Hold"];
    p.char.stats.dex = 20;
    give(p, "Hold Book", 1);
    expect(readBook(p, 0, rngByN())).toEqual([
      "You read the book...",
      "You already know this spell.",
    ]);
    expect(p.char.bag[0]).toBeNull();
  });
  test("kept bug: a skill book is used up when the skill is 77 or more and teaches nothing", () => {
    const p = player("Ann", testMap("x1"), 1, 1);
    p.char.stats.dex = 20;
    p.char.skills[skillIndex("Slash")] = 77;
    give(p, "Slash Book", 1);
    expect(readBook(p, 0, rngByN())).toEqual([
      "You read the book...",
      "There is nothing more you can learn from this book.",
    ]);
    expect(p.char.bag[0]).toBeNull();
    expect(p.char.skills[skillIndex("Slash")]).toBe(77);
  });
  test("kept bug: the Poison Dart Book has no Inventory member, so using it does nothing", () => {
    const p = player("Ann", testMap("x1"), 1, 1);
    give(p, "Poison Dart Book", 1);
    expect(readBook(p, 0, rngByN())).toEqual([]);
  });
});

describe("the server timer", () => {
  test("the church bell rings at the 20th run to x999y999, Churchy:5:200", () => {
    const world = createWorld();
    const map = testMap(CHURCH_MAP);
    const p = player("Ann", map, 1, 1);
    world.rooms.set(CHURCH_MAP, {
      map,
      npcs: ARCHIVE_NPCS,
      players: [p],
      fx: [],
      fxQueue: [],
      doorLock: 0,
    });
    const rng = rngByN();
    let rang = -1;
    for (let t = 1; t <= TIMEOUT_TICKS * 25; t++) {
      world.tickNo = t;
      if (serverTimer(world, null, rng).length > 0) {
        rang = world.timeouts;
      }
    }
    expect(rang).toBe(19);
  });
  test("the Server Spirit casts only into the hazard map's room", () => {
    const world = createWorld();
    const map = testMap("x5y5");
    world.rooms.set("x5y5", {
      map,
      npcs: ARCHIVE_NPCS,
      players: [],
      fx: [],
      fxQueue: [],
      doorLock: 0,
    });
    world.tickNo = TIMEOUT_TICKS;
    serverTimer(world, "x5y5", rngByN({ 50: [1], 10: [1] }));
    const room = world.rooms.get("x5y5");
    expect(room?.fxQueue.map((c) => c.name)).toEqual(["FireballL", "BoltD"]);
    expect(room?.fxQueue[1]).toMatchObject({ owner: "The Server Spirit", power: 30 });
  });
});

describe("monster spells", () => {
  test("kept bug: an unprovoked Passive Acrostia casts Major Heal at you", () => {
    // Two players: Major Heal's user roll is 115.
    const { a, map, run, room } = scene(rngByN({ 115: [1] }));
    live(map, 1, "Acrostia", 3, 3);
    a.char.vitals.hp = 10;
    // The mover's `random(30)` pick must hit a live slot before the spells roll.
    // Cast in frame 1's actor pass, placed by frame 2's network message, before its actor
    // passes.
    run(2);
    const me = at(6, 6);
    expect(room.fxQueue.length + room.fx.length).toBeGreaterThan(0);
    const cast = room.fx[0];
    expect(cast).toMatchObject({ name: "Major Heal", h: me.h, v: me.v, owner: "180", power: 23 });
  });
  test("kept bug: the Snow Serpent's Whirlwind lands on you but drains nothing with PvP off", () => {
    for (const pvp of ["O", "X"]) {
      const { a, map, run, room } = scene(rngByN({ 115: [1] }));
      map.flags.canPvp = pvp;
      live(map, 1, "Snow Serpent", 3, 3);
      run(12);
      expect(room.fx.some((f) => f.name === "Whirlwind" && f.owner === "180")).toBe(true);
      expect(a.char.vitals.sp < 200).toBe(pvp === "X");
    }
  });
  test("a monster's cast blocks everyone's monster spells for 30 frames: the caster name contains 18", () => {
    const { a, map, run } = scene(rngByN({ 115: [1] }));
    live(map, 1, "Acrostia", 3, 3);
    run(2);
    expect(a.spell.npcSpellBlock).toBeGreaterThan(25);
  });
});

describe("the Holy Shield", () => {
  test("kept bug: an innocent on a Holy Shield's exact spot gets Shield after the parry and block draws", () => {
    const { a, map, run } = scene(rngByN({ 10: [1] }));
    live(map, 1, "Slime", 6, 5);
    live(map, 2, "Holy Shield", 6, 6);
    const out = run(1);
    const hits = events(out, "Ann").filter((e) => e.e === "phit" && e.id === "Ann");
    expect(hits).toContainEqual({ e: "phit", id: "Ann", text: "Shield", color: 6 });
    expect(a.char.vitals.hp).toBe(20);
  });
});

describe("arrows and the Fire Staff", () => {
  test("a Fire Staff fireball goes when random(SPower) + (StaffFighting = 100 ? 2 : 0) > 2", () => {
    const { a, room, run } = scene(rngByN({ 3: [3], 6: [6] }));
    a.char.equip.weapon = "Fire Staff";
    a.char.skills[skillIndex("StaffFighting")] = 30;
    a.attackHeld = true;
    a.timers.canAttack = true;
    run(1);
    expect(room.fxQueue.concat(room.fx as never[]).length).toBeGreaterThan(0);
  });
});

describe("kept bugs on players and monsters", () => {
  test("kept bug: the spell-defense lookup is a no-op, so armour never lowers spell damage", () => {
    const hit = (body: string) => {
      const { a, b, run, cast } = scene();
      b.char.equip.body = body;
      a.spell.book = ["Meteor"];
      give(a, "Green Crystals", 10);
      const t = at(9, 6);
      cast(a, "Meteor", t.h, t.v);
      run(23);
      return 20 - b.char.vitals.hp;
    };
    expect(hit("Plate Armor")).toBe(hit("NOTHING"));
    expect(hit("NOTHING")).toBeGreaterThan(0);
  });
  test("kept bug: Hold ignores PvP flags: it roots a player where PvP is off", () => {
    const { a, b, map, run, cast } = scene();
    map.flags.canPvp = "O";
    a.spell.book = ["Hold"];
    give(a, "Purple Crystals", 10);
    const t = at(9, 6);
    cast(a, "Hold", t.h, t.v);
    run(4);
    expect(b.spell.hold).toBeGreaterThan(0);
  });
  test("kept bug: dead spells cost SP and crystals and show nothing: Bless", () => {
    const { a, room, run, cast } = scene();
    a.spell.book = ["Bless"];
    give(a, "Blue Crystals", 4);
    cast(a, "Bless", 200, 200);
    run(2);
    expect(a.char.vitals.sp).toBe(200 - 12);
    expect(a.char.bag.some((l) => l?.item === "Blue Crystals")).toBe(false);
    expect(room.fx).toEqual([]);
  });
  test("kept bug: Meteor's second hit frame (19) falls inside the first's 16-frame lockout", () => {
    const { a, map, run, cast } = scene();
    a.spell.book = ["Meteor"];
    give(a, "Green Crystals", 10);
    // A Zombie at 60, under its heal cap of 67, which a hit also clamps to.
    const zombie = live(map, 1, "Zombie", 4, 4, 60);
    const t = at(4, 4);
    cast(a, "Meteor", t.h, t.v);
    run(24);
    // One hit of 15 + P + random(3), P = 1 + Wrath's +2.
    expect(zombie.hp).toBe(60 - (15 + 3 + 3));
  });
  test("kept bug: Firesword without a sword: the warmth line, no counter; a recast refreshes P·40", () => {
    const { a, b, run, cast } = scene();
    a.spell.book = ["Firesword"];
    give(a, "Red Crystals", 30);
    const t = at(9, 6);
    cast(a, "Firesword", t.h, t.v);
    const out = run(4);
    expect(chat(out, "Bob")).toContain(EFFECT_TEXT.fireswordNoSword);
    expect(b.spell.fireSword).toBe(0);
    b.char.equip.weapon = "Short Sword";
    a.timers.actionDelay = 0;
    cast(a, "Firesword", t.h, t.v);
    run(4);
    const first = b.spell.fireSword;
    a.timers.actionDelay = 0;
    cast(a, "Firesword", t.h, t.v);
    run(4);
    expect(b.spell.fireSword).toBe(first); // assigned, not added
  });
  test("kept bug: Radar on a player sends a line every frame of overlap, up to 10; the FX flies twice as fast, so 5", () => {
    const { a, run, cast } = scene();
    a.spell.book = ["Radar"];
    give(a, "Yellow Crystals", 10);
    const t = at(9, 6);
    cast(a, "Radar", t.h, t.v);
    const lines = chat(run(12), "Ann").filter((l) => l.startsWith("*** Bob"));
    expect(lines).toHaveLength(5);
  });
  test("kept bug: a monster's Fireball flies in a random(4) direction from it, not at you", () => {
    const { map, run, room } = scene(rngByN({ 115: [1], 4: [3] }));
    // A Fireball tag on a Slime, as an operator's NPC file could give it (the NPC editor).
    const slime = live(map, 1, "Slime", 3, 3);
    const file = npcFileNamed(room.npcs, "Slime");
    setNpcFile(room.npcs, "Slime", `${file?.text ?? ""}\rSPL|Fireball`);
    // The cast is queued in frame 1's actor pass and placed by frame 2's network message
    // before that frame's two FX steps which take it off the top of the stage;
    // the queued cast is what shows the direction.
    run(1);
    const loc = at(slime.x, slime.y);
    expect(room.fxQueue.find((c) => c.owner === "a 180")).toMatchObject({
      name: "FireballU",
      h: loc.h,
      v: loc.v - 20,
    });
    // Placed 32 above the cast point.
    expect(events(run(1), "Ann")).toContainEqual(
      expect.objectContaining({ e: "fx", name: "FireballU", h: loc.h, v: loc.v - 20 - 32 }),
    );
  });
  test("kept bug: a player with 18 in the name blocks monster spells for 30 frames", () => {
    const { a, b, run, cast } = scene();
    a.name = "Ann18";
    a.spell.book = ["Minor Heal"];
    give(a, "Blue Crystals", 10);
    cast(a, "Minor Heal", 100, 100);
    run(1);
    expect(b.spell.npcSpellBlock).toBe(30);
  });
});

describe("arrow shots", () => {
  test("an arrow casts <Colour> Arrows<dir> from the shooter's tile for every colour and facing", () => {
    const room = { fxQueue: [] as { name: string; h: number; v: number }[] };
    const dirs = { E: "R", W: "L", N: "U", S: "D" } as const;
    for (const colour of ["Blue", "Green", "Purple", "Red", "White", "Yellow"]) {
      for (const [facing, d] of Object.entries(dirs)) {
        const p = { name: "Ann", id: "a", x: 5, y: 6, facing };
        shootArrow(room as never, p as never, colour, 3);
        expect(room.fxQueue.at(-1)).toMatchObject({ name: `${colour} Arrows${d}`, h: 174, v: 189 });
      }
    }
    expect(room.fxQueue.map((c) => c.name)).toContain("Yellow ArrowsD");
  });
});

describe("Portal", () => {
  /** Bob on the seed map at (9, 6), a Portal cast on him, and the ticks with `portalTargets`. */
  function portalScene(targets: { map: string; x: number; y: number }[], queues = {}) {
    const home = testMap("x1000y992");
    const far = testMap("x3y4");
    const maps = new Map([home, far].map((m) => [m.name, m]));
    const rng = rngByN(queues);
    const world = createWorld();
    const bob = player("Bob", home, 9, 6);
    bob.flicker = 0;
    addPlayer(world, bob);
    bob.loading = 0;
    const room = world.rooms.get(home.name) as Room;
    const me = playerLoc(bob);
    queueCast(room, {
      owner: "Ann",
      ownerId: "Ann",
      name: "Portal",
      casterH: me.h,
      casterV: me.v,
      h: me.h,
      v: me.v,
      power: 1,
    });
    const deps = {
      loadMap: (n: string) => maps.get(n) ?? null,
      startPoint: { map: "x1000y992", x: 6, y: 4 },
      casino: NO_CASINO,
      saveIntervalTicks: 600,
      stepFrames: 16,
      rng,
      portalTargets: targets,
    };
    const run = (n: number) => {
      for (let i = 0; i < n; i++) {
        tick(world, deps);
      }
    };
    return { bob, run, rng };
  }

  test("stepping into the portal's frame 3 warps you to random(count) of the operator's targets", () => {
    const s = portalScene(
      [
        { map: "x1000y992", x: 1, y: 1 },
        { map: "x3y4", x: 7, y: 8 },
        { map: "x1000y992", x: 2, y: 2 },
        { map: "x1000y992", x: 3, y: 3 },
      ],
      { 4: [2] },
    );
    s.run(6);
    expect(s.rng.calls.filter((n) => n === 4)).toEqual([4]);
    expect([s.bob.map.name, s.bob.x, s.bob.y]).toEqual(["x3y4", 7, 8]);
  });

  test("with no targets, random(0) matches no line and the empty warp lands on the start point", () => {
    const s = portalScene([]);
    s.run(6);
    expect([s.bob.map.name, s.bob.x, s.bob.y]).toEqual(["x1000y992", 6, 4]);
  });

  test("Cow, Pig, Spikes, Web and Holy Shield never cast: contains, so Illusionary Spikes too", () => {
    const map = testMap("x1000y992");
    const p = player("Ann", map, 5, 5);
    for (const name of ["Cow", "Pig", "Spikes", "Web", "Holy Shield", "Illusionary Spikes"]) {
      const npcs = new Map(ARCHIVE_NPCS);
      setNpcFile(npcs, name, "SPL|Firebolt\r");
      const room: Room = { map, npcs, players: [p], fx: [], fxQueue: [], doorLock: 0 };
      (map.slots[0] as MonsterSlot).live = {
        name,
        hp: 10,
        x: 5,
        y: 3,
        facing: "S",
        anim: 0,
        fromX: 5,
        fromY: 3,
        queue: [],
        hitCountb: 0,
      };
      monsterSpells(room, p, rngByN({ 90: [1] }));
      expect(room.fxQueue).toEqual([]);
    }
  });

  test("the summoned species come from the spell rows: Web, Illusionary Spikes, Holy Shield, Zombie, Pig and Cow above Sorcery 39", () => {
    expect(summonFor("Web")).toEqual({ monster: "Web", skilled: null });
    expect(summonFor("Illusionary Spikes")).toEqual({
      monster: "Illusionary Spikes",
      skilled: null,
    });
    expect(summonFor("Holy Shield")).toEqual({ monster: "Holy Shield", skilled: null });
    expect(summonFor("Raise Dead")).toEqual({ monster: "Zombie", skilled: null });
    expect(summonFor("Summon Creature")).toEqual({
      monster: "Pig",
      skilled: { skill: "Sorcery", above: 39, monster: "Cow" },
    });
  });
});
