/**
 * Spells on the server sim: the cast, FX against monsters and players, summons, books, the server
 * timer, monster spells, arrows and the Portal spell.
 */
import { describe, expect, test } from "bun:test";

import { classicData } from "@secondstaronline/data/classic";
import {
  ADMINISTRATOR,
  buildContentStore,
  CAST_TEXT,
  type ContentData,
  EFFECT_TEXT,
  installContent,
  LEVEL_UP_TEXT,
  type ServerMsg,
  skillIndex,
  summonFor,
  tileLoc,
} from "@secondstaronline/shared";

import { npcFileNamed, setNpcFile } from "../src/systems/monsters/npcfiles.ts";
import type { MonsterSlot } from "../src/systems/monsters/slots.ts";
import { species } from "../src/systems/monsters/slots.ts";
import { castIntent, npcBlocked, shootArrow } from "../src/systems/spells/cast.ts";
import { queueCast } from "../src/systems/spells/fx.ts";
import { playerLoc } from "../src/systems/spells/geometry.ts";
import { serverTimer, TIMEOUT_TICKS } from "../src/systems/spells/hazards.ts";
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
  test("bug fixed: only a cast that goes ahead sets the delay; a refused one costs nothing", () => {
    const { a, map, cast } = scene();
    cast(a, "", 200, 100);
    expect(a.timers.actionDelay).toBe(0);
    a.spell.book = ["Minor Heal", "Fireball"];
    cast(a, "Minor Heal", 200, 100); // no crystals
    expect(a.timers.actionDelay).toBe(0);
    map.flags.canFight = "O";
    cast(a, "Fireball", 200, 100); // harmful here
    expect(a.timers.actionDelay).toBe(0);
    map.flags.canFight = "X";
    give(a, "Blue Crystal", 10);
    cast(a, "Minor Heal", 200, 100);
    expect(a.timers.actionDelay).toBe(20);
  });
  test("bug fixed: the server takes a cast click only on the playfield [30, 31, 574, 415]", () => {
    const { a, cast } = scene();
    a.spell.book = ["Minor Heal"];
    give(a, "Blue Crystal", 30);
    const casts = (h: number, v: number) => {
      a.timers.actionDelay = 0;
      const before = a.char.vitals.sp;
      cast(a, "Minor Heal", h, v);
      return a.char.vitals.sp < before;
    };
    expect(casts(30, 31)).toBe(true);
    expect(casts(573, 414)).toBe(true);
    // 1.6's margin around the playfield: 8 < H < 580, 5 < V < 420.
    expect(casts(9, 6)).toBe(false);
    expect(casts(579, 419)).toBe(false);
    expect(casts(29, 100)).toBe(false);
    expect(casts(100, 415)).toBe(false);
  });
  test("bug fixed: Bless, Weaken, Haste, Poison Dart, Replenish, Holy Weapon and Identify are refused before anything is spent", () => {
    const { a, room, cast } = scene();
    const inert = [
      "Bless",
      "Weaken",
      "Haste",
      "Poison Dart",
      "Replenish",
      "Holy Weapon",
      "Identify",
    ];
    a.spell.book = [...inert];
    give(a, "Blue Crystal", 4);
    for (const spell of inert) {
      const r = cast(a, spell, 200, 200);
      expect(r.out[0]?.msg).toEqual({ t: "chat", text: CAST_TEXT.inert, color: 0 });
    }
    expect(a.char.vitals.sp).toBe(200);
    expect(a.char.bag.some((l) => l?.item === "Blue Crystal")).toBe(true);
    expect(a.timers.actionDelay).toBe(0);
    expect(room.fxQueue).toEqual([]);
  });
  test("bug fixed: Fireball and Wind Wave cast with their school bonus", () => {
    const { a, room, cast } = scene();
    a.spell.book = ["Fireball", "Wind Wave"];
    a.char.skills[skillIndex("Fire")] = 31;
    a.char.skills[skillIndex("Wind")] = 11;
    give(a, "Red Crystal", 10);
    give(a, "Green Crystal", 10);
    cast(a, "Fireball", 300, 100);
    a.timers.actionDelay = 0;
    cast(a, "Wind Wave", 300, 100);
    // 1 + Fire's 2 + 1 + 1 + 1; 1 + Wind's 2 + 1.
    expect(room.fxQueue.map((c) => [c.name, c.power])).toEqual([
      ["FireballR", 6],
      ["Wind waveR", 4],
    ]);
  });
  test("ActionDelay > 0 exits, shared with melee", () => {
    const { a, cast } = scene();
    a.spell.book = ["Minor Heal"];
    give(a, "Blue Crystal", 10);
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
    give(a, "Blue Crystal", 2);
    give(a, "Blue Crystal", 5);
    cast(a, "Minor Heal", 200, 100);
    expect(a.char.bag[1]).toEqual({ item: "Blue Crystal", qty: 2 });
    expect(a.char.vitals.sp).toBe(195);
    expect(room.fxQueue).toHaveLength(1);
  });
  test("harmful spells and Hold are refused on a safe map before SP is spent", () => {
    const { a, map, cast } = scene();
    map.flags.canFight = "O";
    a.spell.book = ["Hold", "Fireball"];
    give(a, "Purple Crystal", 10);
    const r = cast(a, "Hold", 200, 100);
    expect(r.out[0]?.msg).toEqual({ t: "chat", text: CAST_TEXT.harmful, color: 0 });
    expect(a.char.vitals.sp).toBe(200);
    expect(a.timers.actionDelay).toBe(0);
  });
  test("bug fixed: Portal is refused near another player before SP and crystals are spent, and opens on the caster", () => {
    const { a, room, cast } = scene();
    a.spell.book = ["Portal"];
    give(a, "White Crystal", 20);
    const bob = at(9, 6);
    const r = cast(a, "Portal", bob.h, bob.v);
    expect(r.out[0]?.msg).toEqual({ t: "chat", text: CAST_TEXT.portal, color: 0 });
    expect(a.char.vitals.sp).toBe(200);
    expect(a.char.bag.some((l) => l?.item === "White Crystal" && l.qty === 20)).toBe(true);
    expect(room.fxQueue).toHaveLength(0);
    const me = at(6, 6);
    cast(a, "Portal", me.h, me.v);
    expect(a.char.vitals.sp).toBe(200 - 32);
    expect(room.fxQueue.map((c) => c.name)).toEqual(["Portal"]);
  });

  test("bug fixed: Portal with no destination is refused before SP and crystals are spent", () => {
    const { a, room } = scene();
    a.spell.book = ["Portal"];
    give(a, "White Crystal", 10);
    const t = at(9, 9);
    const r = castIntent(room, a, "Portal", t.h, t.v, { rng: rngByN(), portalOpen: () => false });
    expect(r.out[0]?.msg).toEqual({ t: "chat", text: CAST_TEXT.portalClosed, color: 0 });
    expect(a.char.vitals.sp).toBe(200);
    expect(a.char.bag.some((l) => l?.item === "White Crystal")).toBe(true);
    expect(room.fxQueue).toHaveLength(0);
  });
});

describe("FX and monsters", () => {
  test("a fireball at a monster is placed next frame and hits in that frame's actor passes on FireballU-1 for 4 + P + random(3)", () => {
    const { a, map, run, cast } = scene();
    a.spell.book = ["Fireball"];
    give(a, "Red Crystal", 10);
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
    // The network message places it before actor pass 1, so the hit lands the same frame. P = 1 +
    // Fire's +2.
    expect(m.hp).toBe(14 - (4 + 3 + 3));
    expect(events(first, "Bob")).toContainEqual({
      e: "mspell",
      slot: 1,
      text: "10",
      color: 124,
      splat: true,
      kill: false,
    });
    expect(m.hitCountb).toBe(15); // 16 set in pass 1, counted down in pass 2
  });
  test("bug fixed: a spell kill pays the spell XP table and the melee level-up line", () => {
    const { a, map, run, cast } = scene();
    a.spell.book = ["Fireball"];
    give(a, "Red Crystal", 10);
    live(map, 1, "Slime", 6, 5, 3);
    a.char.vitals.exp = 29;
    const t = at(6, 5);
    cast(a, "Fireball", t.h, t.v);
    const out = run(2);
    expect(map.slots[0]?.live).toBeNull();
    expect(events(out, "Ann").some((e) => e.e === "mspell" && e.kill)).toBe(true);
    expect(chat(out, "Ann")).toContain(LEVEL_UP_TEXT);
    expect(LEVEL_UP_TEXT).toBe("You have become more powerful!");
  });
  test("bug fixed: a spell kill drops the loot on the tile the monster is drawn nearest", () => {
    const killMidStep = (anim: number, aimX: number) => {
      const { a, map, run, cast } = scene(rngByN({ 4: [1] }));
      a.spell.book = ["Fireball"];
      give(a, "Red Crystal", 10);
      const m = live(map, 1, "Slime", 6, 4, 1);
      (map.slots[0] as MonsterSlot).pause = 10_000;
      m.fromX = 5;
      m.facing = "E";
      m.anim = anim; // mid-step from (5,4) into (6,4)
      const t = at(aimX, 4);
      cast(a, "Fireball", t.h, t.v);
      run(2);
      expect(map.slots[0]?.live).toBeNull();
      const on = (x: number, y: number) =>
        map.ground.filter((g) => g.x === x && g.y === y).map((g) => g.item);
      return on;
    };
    // Just set off: still drawn on (5,4).
    const early = killMidStep(16, 5);
    expect(early(5, 4)).toEqual(["2 Gold"]);
    expect(early(6, 4)).toEqual([]);
    // Most of the way there: drawn on (6,4).
    const late = killMidStep(4, 6);
    expect(late(6, 4)).toEqual(["2 Gold"]);
    expect(late(5, 4)).toEqual([]);
  });
  test("minor heal heals a monster up to its own hit points, a Slime's 14", () => {
    const { a, map, run, cast } = scene();
    a.spell.book = ["Minor Heal"];
    give(a, "Blue Crystal", 10);
    const slime = live(map, 1, "Slime", 6, 4, 5);
    const t = at(6, 4);
    cast(a, "Minor Heal", t.h, t.v);
    // Placed on frame 1, the mover sees `minor heal-3` two steps later.
    run(4);
    // 3 + P + random(5) with P = 1 + Blessing 2, capped at the Slime's 14.
    expect(slime.hp).toBe(14);
  });
});

describe("monster heals", () => {
  test("bug fixed: a spell heal stops at the monster's own hit points: a Pig stays at 1", () => {
    const { a, map, run, cast } = scene();
    a.spell.book = ["Minor Heal"];
    give(a, "Blue Crystal", 10);
    const pig = live(map, 1, "Pig", 6, 4, 1);
    const t = at(6, 4);
    cast(a, "Minor Heal", t.h, t.v);
    run(4);
    expect(pig.hp).toBe(1);
    const dragon = live(map, 2, "Dragon Hatchling", 9, 4, 320);
    run(30);
    const d = at(9, 4);
    a.timers.actionDelay = 0;
    cast(a, "Minor Heal", d.h, d.v);
    run(4);
    expect(dragon.hp).toBe(322);
  });
});

describe("players", () => {
  test("minor heal heals whoever stands in it, colour 5", () => {
    const { a, b, run, cast } = scene();
    a.spell.book = ["Minor Heal"];
    give(a, "Blue Crystal", 10);
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
    give(a, "Red Crystal", 20);
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
  test("bug fixed: a role that takes no damage is untouched by harmful spells and Whirlwind", () => {
    const { a, b, run, cast } = scene();
    b.role = ADMINISTRATOR;
    a.spell.book = ["Firebolt", "Whirlwind"];
    give(a, "Red Crystal", 20);
    give(a, "Purple Crystal", 10);
    const t = at(9, 6);
    cast(a, "Firebolt", t.h, t.v);
    run(17);
    expect([b.char.vitals.hp, b.flicker, b.lastToHitMe]).toEqual([20, 0, null]);
    a.timers.actionDelay = 0;
    cast(a, "Whirlwind", t.h, t.v);
    run(11);
    expect(b.char.vitals.sp).toBe(200);
  });
  test("Hold: the hold counter = P·8, no step while it runs, the text", () => {
    const { a, b, room, run, cast } = scene();
    a.spell.book = ["Hold"];
    give(a, "Purple Crystal", 10);
    const t = at(9, 6);
    cast(a, "Hold", t.h, t.v);
    const P = room.fxQueue[0]?.power ?? 0;
    const out = run(4);
    expect(chat(out, "Bob")).toContain(EFFECT_TEXT.hold);
    // P·8 (P = 1 here), counted down each frame from the one it landed in (frame 3 of 4 run).
    expect(P).toBe(1);
    expect(b.spell.hold).toBe(P * 8 - 3);
    b.held = "R";
    run(1);
    expect(b.x).toBe(9);
  });
  test("Stone Skin: the defense bonus 1 and its counter P·30, then back to 0", () => {
    const { a, run, cast } = scene();
    a.spell.book = ["Stone Skin"];
    give(a, "Purple Crystal", 10);
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
  test("kept on purpose: Whirlwind drains 1 SP a frame of overlap, no flicker", () => {
    const { a, b, run, cast } = scene();
    a.spell.book = ["Whirlwind"];
    give(a, "Purple Crystal", 10);
    const t = at(9, 6);
    cast(a, "Whirlwind", t.h, t.v);
    run(11);
    // Placed and tested on frame 1, then ten more frames.
    expect(b.char.vitals.sp).toBe(189);
    expect(b.flicker).toBe(0);
  });
  test("bug fixed: your own harmful spell skips only itself; a later FX still lands on you", () => {
    const { a, b, run, cast, room } = scene();
    a.spell.book = ["Minor Heal", "Whirlwind"];
    b.spell.book = ["Minor Heal"];
    give(a, "Purple Crystal", 10);
    give(b, "Blue Crystal", 10);
    const me = at(6, 6);
    cast(a, "Whirlwind", me.h, me.v); // slot 1: mine
    cast(b, "Minor Heal", me.h, me.v); // slot 2
    // Placed before actor pass 1: the heal's last step is in frame 4.
    run(3);
    expect(room.fx.map((f) => f.slot)).toEqual([1, 2]);
    // 2 + P + random(2), P = 1 + Blessing's +2.
    expect(a.char.vitals.hp).toBe(20 + 2 + 3 + 2);
    expect(a.char.vitals.sp).toBe(200 - 13);
  });
  test("bug fixed: a buff cast again restarts its time and never adds: Stone Skin, Magic Shield, Argon's Fist", () => {
    const { a, run, cast } = scene();
    a.spell.book = ["Stone Skin", "Magic Shield", "Argon's Fist"];
    give(a, "Purple Crystal", 10);
    give(a, "Yellow Crystal", 10);
    const me = at(6, 6);
    const twice = (spell: string) => {
      for (let i = 0; i < 2; i++) {
        a.timers.actionDelay = 0;
        cast(a, spell, me.h, me.v);
        run(12);
      }
    };
    twice("Stone Skin");
    expect(a.defenseBonus).toBe(1);
    expect(a.spell.defenseCounter).toBeLessThanOrEqual(3 * 30);
    twice("Magic Shield");
    // P = 1 + Wrath's +2.
    expect(a.spell.magicDef).toBeLessThanOrEqual(3 * 70);
    twice("Argon's Fist");
    expect(a.timers.attackCounter).toBeLessThanOrEqual(400);
  });
  test("Morph changes the body for everyone; the morph counter 1300 then a revert", () => {
    const { a, run, cast } = scene(rngByN({ 5: [1] }));
    a.spell.book = ["Morph"];
    give(a, "Yellow Crystal", 10);
    const me = at(6, 6);
    cast(a, "Morph", me.h, me.v);
    const out = run(4);
    expect(events(out, "Bob")).toContainEqual({ e: "body", id: "Ann", body: 30 });
    expect(a.spell.morph).toBeGreaterThan(1290);
    a.spell.morph = 1;
    expect(events(run(1), "Bob")).toContainEqual({ e: "body", id: "Ann", body: null });
  });
});

describe("a body spell's length (issue #29)", () => {
  test("SSO: Morph into a body numbered over 300 still reverts, after the spell's own seconds", () => {
    const d = structuredClone(classicData) as ContentData;
    // An operator's body (numbered from 1000) as every Morph form, and a Morph lasting 10 s.
    d.bindings.bodies.morph = [{ above: 0, body: 1000 }];
    const morph = d.spells.spells.find((s) => s.name === "Morph");
    if (morph) {
      morph.lasts = 10;
    }
    installContent(buildContentStore(d));
    try {
      const { a, run, cast } = scene(rngByN({ 5: [1] }));
      a.spell.book = ["Morph"];
      give(a, "Yellow Crystal", 10);
      const me = at(6, 6);
      cast(a, "Morph", me.h, me.v);
      expect(events(run(4), "Bob")).toContainEqual({ e: "body", id: "Ann", body: 1000 });
      // 1.6 set ten billion frames for any body over 300: the morph never ended.
      expect(a.spell.morph).toBeGreaterThan(190);
      expect(a.spell.morph).toBeLessThanOrEqual(200);
      expect(events(run(200), "Bob")).toContainEqual({ e: "body", id: "Ann", body: null });
    } finally {
      installContent(buildContentStore(classicData as ContentData));
    }
  });
});

describe("summons", () => {
  test("Summon Creature: a Pig in the first free slot; Cow at Sorcery > 39", () => {
    const { a, map, cast } = scene();
    a.spell.book = ["Summon Creature"];
    give(a, "White Crystal", 10);
    const t = centre(4, 4);
    cast(a, "Summon Creature", t.h, t.v);
    expect(map.slots[0]?.live).toMatchObject({ name: "Pig", x: 4, y: 4 });
    a.char.skills[skillIndex("Sorcery")] = 40;
    a.timers.actionDelay = 0;
    cast(a, "Summon Creature", t.h, t.v);
    expect(map.slots[1]?.live?.name).toBe("Cow");
  });
  test("bug fixed: with four live monsters a summon is refused before SP and crystals are spent", () => {
    const { a, map, room, cast } = scene();
    for (const k of [1, 2, 3, 4]) {
      live(map, k, "Slime", k, 1);
    }
    a.spell.book = ["Summon Creature"];
    give(a, "White Crystal", 10);
    const t = at(4, 4);
    const r = cast(a, "Summon Creature", t.h, t.v);
    expect(r.out[0]?.msg).toEqual({ t: "chat", text: CAST_TEXT.summon, color: 0 });
    expect(a.char.vitals.sp).toBe(200);
    expect(a.char.bag.some((l) => l?.item === "White Crystal" && l.qty === 10)).toBe(true);
    expect(room.fxQueue).toEqual([]);
  });
  test("bug fixed: a summon on a blocked tile is refused before anything is spent", () => {
    const { a, map, cast } = scene();
    map.walk[3]![3] = false; // x4y4
    a.spell.book = ["Summon Creature"];
    give(a, "White Crystal", 10);
    const t = centre(4, 4);
    const r = cast(a, "Summon Creature", t.h, t.v);
    expect(r.out[0]?.msg).toEqual({ t: "chat", text: CAST_TEXT.summon, color: 0 });
    expect(map.slots.every((s) => !s.live)).toBe(true);
    expect(a.char.vitals.sp).toBe(200);
  });
  test("bug fixed: the summons read a tile's own blocked entry: x1y1 is open when only x1y10 is blocked", () => {
    const map = testMap("x1", [[1, 10]]);
    expect(npcBlocked(map.walk, 1, 1)).toBe(false);
    expect(npcBlocked(map.walk, 1, 10)).toBe(true);
  });
  test("kept on purpose: Raise Dead raises the Zombie on the tile below a grave, from the grave or the tile below", () => {
    for (const click of [3, 4]) {
      const { a, map, cast } = scene();
      const row = map.layers[1][2]?.split(" ") ?? [];
      row[4] = "Q8"; // a grave at (5, 3)
      map.layers[1][2] = row.join(" ");
      a.spell.book = ["Raise Dead"];
      give(a, "Purple Crystal", 20);
      const t = centre(5, click);
      cast(a, "Raise Dead", t.h, t.v);
      expect(map.slots[0]?.live).toMatchObject({ name: "Zombie", x: 5, y: 4 });
    }
  });
  test("bug fixed: Raise Dead on a grave in the bottom row is refused before anything is spent: the Zombie would be off the map", () => {
    const { a, map, cast } = scene();
    const row = map.layers[1][11]?.split(" ") ?? [];
    row[4] = "Q8"; // a grave at (5, 12)
    map.layers[1][11] = row.join(" ");
    a.spell.book = ["Raise Dead"];
    give(a, "Purple Crystal", 20);
    const t = centre(5, 12);
    cast(a, "Raise Dead", t.h, t.v);
    expect(map.slots.every((sl) => sl.live === null)).toBe(true);
    expect(a.char.vitals.sp).toBe(200);
    expect(a.char.bag.find((l) => l?.item === "Purple Crystal")?.qty).toBe(20);
    expect(a.timers.actionDelay).toBe(0);
    // The control: a grave one row up raises its Zombie on the bottom row.
    const c = scene();
    const up = c.map.layers[1][10]?.split(" ") ?? [];
    up[4] = "Q8"; // a grave at (5, 11)
    c.map.layers[1][10] = up.join(" ");
    c.a.spell.book = ["Raise Dead"];
    give(c.a, "Purple Crystal", 20);
    const u = centre(5, 11);
    c.cast(c.a, "Raise Dead", u.h, u.v);
    expect(c.map.slots[0]?.live).toMatchObject({ name: "Zombie", x: 5, y: 12 });
  });
  test("bug fixed: Raise Dead is refused where fighting is off; Summon Creature is not", () => {
    const { a, map, cast } = scene();
    map.flags.canFight = "O";
    const row = map.layers[1][2]?.split(" ") ?? [];
    row[4] = "Q8";
    map.layers[1][2] = row.join(" ");
    a.spell.book = ["Raise Dead", "Summon Creature"];
    give(a, "Purple Crystal", 20);
    give(a, "White Crystal", 20);
    const grave = centre(5, 3);
    const r = cast(a, "Raise Dead", grave.h, grave.v);
    expect(r.out[0]?.msg).toEqual({ t: "chat", text: CAST_TEXT.summon, color: 0 });
    expect(a.char.vitals.sp).toBe(200);
    const t = centre(8, 8);
    cast(a, "Summon Creature", t.h, t.v);
    expect(map.slots[0]?.live?.name).toBe("Pig");
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
  test("bug fixed: reading a Bolt Book uses up that Bolt Book, not a Firebolt Book above it", () => {
    const p = player("Ann", testMap("x1"), 1, 1);
    p.char.stats.dex = 30;
    give(p, "Firebolt Book", 1);
    give(p, "Bolt Book", 1);
    readBook(p, 1, rngByN());
    expect(p.char.bag[0]).toEqual({ item: "Firebolt Book", qty: 1 });
    expect(p.char.bag[1]).toBeNull();
    expect(p.spell.book).toEqual(["Bolt"]);
  });
  test("bug fixed: a book is kept when the spell is already known", () => {
    const p = player("Ann", testMap("x1"), 1, 1);
    p.spell.book = ["Hold"];
    p.char.stats.dex = 20;
    give(p, "Hold Book", 1);
    expect(readBook(p, 0, rngByN())).toEqual([
      "You read the book...",
      "You already know this spell.",
    ]);
    expect(p.char.bag[0]).toEqual({ item: "Hold Book", qty: 1 });
  });
  test("bug fixed: a skill book is kept when the skill is 77 or more and it teaches nothing", () => {
    const p = player("Ann", testMap("x1"), 1, 1);
    p.char.stats.dex = 20;
    p.char.skills[skillIndex("Slash")] = 77;
    give(p, "Slash Book", 1);
    expect(readBook(p, 0, rngByN())).toEqual([
      "You read the book...",
      "There is nothing more you can learn from this book.",
    ]);
    expect(p.char.bag[0]).toEqual({ item: "Slash Book", qty: 1 });
    expect(p.char.skills[skillIndex("Slash")]).toBe(77);
  });
  test("bug fixed: a book with no picture is read like any other book", () => {
    const p = player("Ann", testMap("x1"), 1, 1);
    give(p, "Poison Dart Book", 1);
    expect(readBook(p, 0, rngByN())).toEqual([
      "You read the book...",
      "You have learned the spell of Poison Dart.",
    ]);
    expect(p.char.bag[0]).toBeNull();
  });
  test("bug fixed: the Radar Book teaches Radar", () => {
    const p = player("Ann", testMap("x1"), 1, 1);
    give(p, "Radar Book", 1);
    expect(readBook(p, 0, rngByN())).toContain("You have learned the spell of Radar.");
    expect(p.spell.book).toEqual(["Radar"]);
  });
});

describe("the server timer", () => {
  /** The timer runs at which the bell rang for a player on `on`, with the bell on `bellMap`. */
  const bellRuns = (on: string, bellMap: string | null) => {
    const world = createWorld();
    const map = testMap(on);
    const p = player("Ann", map, 1, 1);
    world.rooms.set(on, {
      map,
      npcs: ARCHIVE_NPCS,
      players: [p],
      fx: [],
      fxQueue: [],
      doorLock: 0,
    });
    const rng = rngByN();
    const rang: number[] = [];
    for (let t = 1; t <= TIMEOUT_TICKS * 25; t++) {
      world.tickNo = t;
      const out = serverTimer(world, { hazardMap: null, bellMap }, rng);
      if (out.length > 0) {
        expect(out).toEqual([
          { to: p.id, msg: { t: "sound", name: "churchy", ch: 5, volume: 200 } },
        ]);
        rang.push(world.timeouts);
      }
    }
    return rang;
  };
  test("the church bell rings at the 20th run to the bell map, Churchy:5:200", () => {
    expect(bellRuns("x999y999", "x999y999")).toEqual([19]);
  });
  test("SSO: the bell map is a setting; empty means no bell", () => {
    expect(bellRuns("x3y4", "x3y4")).toEqual([19]);
    expect(bellRuns("x999y999", "x3y4")).toEqual([]);
    expect(bellRuns("x999y999", null)).toEqual([]);
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
    serverTimer(world, { hazardMap: "x5y5", bellMap: null }, rngByN({ 50: [1], 10: [1] }));
    const room = world.rooms.get("x5y5");
    expect(room?.fxQueue.map((c) => c.name)).toEqual(["FireballL", "BoltD"]);
    expect(room?.fxQueue[1]).toMatchObject({ owner: "The Server Spirit", power: 30 });
  });
});

describe("monster spells", () => {
  test("kept on purpose: an unprovoked Passive Acrostia casts Major Heal at you", () => {
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
  test("bug fixed: the Snow Serpent's Whirlwind drains you with PvP off too: the flag is for players' spells", () => {
    for (const pvp of ["O", "X"]) {
      const { a, map, run, room } = scene(rngByN({ 115: [1] }));
      map.flags.canPvp = pvp;
      live(map, 1, "Snow Serpent", 3, 3);
      run(12);
      expect(room.fx.some((f) => f.name === "Whirlwind" && f.owner === "180")).toBe(true);
      expect(a.char.vitals.sp).toBeLessThan(200);
    }
  });
  test("bug fixed: a player's harmful spell provokes a Passive monster for everyone here", () => {
    const { a, b, map, run, cast } = scene();
    a.spell.book = ["Fireball"];
    give(a, "Red Crystal", 10);
    live(map, 1, "Acrostia", 6, 5);
    const t = at(6, 5);
    cast(a, "Fireball", t.h, t.v);
    run(1);
    expect(a.npcAttackFlag).toBe(true);
    expect(b.npcAttackFlag).toBe(true);
  });
  test("a monster's cast blocks everyone's monster spells for 30 frames: the caster name contains 18", () => {
    const { a, map, run } = scene(rngByN({ 115: [1] }));
    live(map, 1, "Acrostia", 3, 3);
    run(2);
    expect(a.spell.npcSpellBlock).toBeGreaterThan(25);
  });
});

describe("the Holy Shield", () => {
  test("bug fixed: an innocent on a Holy Shield's exact spot gets Shield before any parry or block draw", () => {
    const rng = rngByN({ 10: [1] });
    const { a, map, run } = scene(rng);
    live(map, 1, "Slime", 6, 5);
    live(map, 2, "Holy Shield", 6, 6);
    const out = run(1);
    expect(rng.calls.filter((n) => n === 90 || n === 3000)).toEqual([]);
    const hits = events(out, "Ann").filter((e) => e.e === "phit" && e.id === "Ann");
    expect(hits).toContainEqual({ e: "phit", id: "Ann", text: "Shield", color: 6, splat: false });
    expect(a.char.vitals.hp).toBe(20);
  });
});

describe("arrows and the Fire Staff", () => {
  test("bug fixed: a Fire Staff fireball trains no skill", () => {
    // random(7) = 1 every time: any training roll would succeed.
    const { a, room, run } = scene(rngByN({ 3: [3], 6: [6], 7: [1, 1, 1, 1, 1, 1] }));
    a.char.equip.weapon = "Fire Staff";
    a.char.skills[skillIndex("StaffFighting")] = 30;
    a.char.skills[skillIndex("Magery")] = 7;
    a.char.skills[skillIndex("Fire")] = 7;
    a.attackHeld = true;
    a.timers.canAttack = true;
    const out = run(2);
    expect(room.fx.some((f) => f.name.startsWith("Fireball"))).toBe(true);
    expect(chat(out, "Ann").filter((l) => l.includes("advanced"))).toEqual([]);
    expect(a.char.skills[skillIndex("Magery")]).toBe(7);
    expect(a.char.skills[skillIndex("Fire")]).toBe(7);
  });
  test("bug fixed: a Firesword fireball trains no skill; a cast Fireball with the same rolls does", () => {
    const rolls = () => rngByN({ 7: [1, 1, 1, 1, 1, 1] });
    const { a, room, run } = scene(rolls());
    a.char.equip.weapon = "Long Sword";
    a.spell.fireSword = 100;
    a.char.skills[skillIndex("Magery")] = 7;
    a.char.skills[skillIndex("Fire")] = 7;
    a.attackHeld = true;
    a.timers.canAttack = true;
    const out = run(2);
    expect(room.fx.some((f) => f.name.startsWith("Fireball"))).toBe(true);
    expect(chat(out, "Ann").filter((l) => l.includes("advanced"))).toEqual([]);
    expect(a.char.skills[skillIndex("Magery")]).toBe(7);
    expect(a.char.skills[skillIndex("Fire")]).toBe(7);
    // The control: a cast Fireball trains Magery and Fire on the same rolls.
    const c = scene(rolls());
    c.a.spell.book = ["Fireball"];
    give(c.a, "Red Crystal", 10);
    c.a.char.skills[skillIndex("Magery")] = 7;
    c.a.char.skills[skillIndex("Fire")] = 7;
    const t = at(6, 3);
    c.cast(c.a, "Fireball", t.h, t.v);
    c.run(2);
    expect(c.a.char.skills[skillIndex("Magery")]).toBe(8);
    expect(c.a.char.skills[skillIndex("Fire")]).toBe(8);
  });
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

describe("players and monsters", () => {
  test("bug fixed: armour and Magic Shield change the spell damage you take", () => {
    const hit = (body: string, shield = 0) => {
      const { a, b, run, cast } = scene();
      b.char.equip.body = body;
      b.char.vitals.hp = 60;
      b.spell.magicDef = shield;
      a.spell.book = ["Meteor"];
      give(a, "Green Crystal", 10);
      const t = at(9, 6);
      cast(a, "Meteor", t.h, t.v);
      run(23);
      return 60 - b.char.vitals.hp;
    };
    // 15 + P + random(3), P = 1 + Wrath's +2, then + random(3).
    const bare = hit("NOTHING");
    expect(bare).toBe(15 + 3 + 3 + 3);
    expect(hit("Plate Armor")).toBe(bare + 4);
    expect(hit("Necromancer's Robe")).toBe(bare - 4);
    expect(hit("NOTHING", 500)).toBe(bare - 5);
  });
  test("bug fixed: Hold obeys the PvP flag: a player's Hold roots no one where PvP is off", () => {
    const { a, b, map, run, cast } = scene();
    map.flags.canPvp = "O";
    a.spell.book = ["Hold"];
    give(a, "Purple Crystal", 10);
    const t = at(9, 6);
    cast(a, "Hold", t.h, t.v);
    run(4);
    expect(b.spell.hold).toBe(0);
  });
  test("a player's Hold roots another player where PvP is on", () => {
    const { a, b, map, run, cast } = scene();
    map.flags.canPvp = "X";
    a.spell.book = ["Hold"];
    give(a, "Purple Crystal", 10);
    const t = at(9, 6);
    cast(a, "Hold", t.h, t.v);
    run(4);
    expect(b.spell.hold).toBeGreaterThan(0);
  });
  test("bug fixed: a monster's Hold still roots a player where PvP is off", () => {
    const { b, map, room, run } = scene();
    map.flags.canPvp = "O";
    const me = playerLoc(b);
    queueCast(room, {
      owner: "180",
      ownerId: null,
      name: "Hold",
      casterH: me.h,
      casterV: me.v,
      h: me.h,
      v: me.v,
      power: 2,
    });
    run(4);
    expect(b.spell.hold).toBeGreaterThan(0);
  });
  test("bug fixed: Meteor hits a monster on both its hit frames, 13 and 19", () => {
    const { a, map, run, cast } = scene();
    a.spell.book = ["Meteor"];
    give(a, "Green Crystal", 10);
    const zombie = live(map, 1, "Zombie", 4, 4, 60);
    const t = at(4, 4);
    cast(a, "Meteor", t.h, t.v);
    run(24);
    // Two hits of 15 + P + random(3), P = 1 + Wrath's +2.
    expect(zombie.hp).toBe(60 - 2 * (15 + 3 + 3));
  });
  test("a second Meteor inside the lockout still misses: only the FX that set it hits again", () => {
    const { a, map, run, cast } = scene();
    a.spell.book = ["Meteor"];
    give(a, "Green Crystal", 20);
    const zombie = live(map, 1, "Zombie", 4, 4, 67);
    const t = at(4, 4);
    cast(a, "Meteor", t.h, t.v);
    run(10);
    a.timers.actionDelay = 0;
    cast(a, "Meteor", t.h, t.v);
    run(30);
    expect(zombie.hp).toBeLessThan(67);
    expect((67 - zombie.hp) % (15 + 3 + 3)).toBe(0);
  });
  test("kept on purpose: Firesword without a sword: the warmth line, no counter; a recast refreshes P·40", () => {
    const { a, b, run, cast } = scene();
    a.spell.book = ["Firesword"];
    give(a, "Red Crystal", 30);
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
  test("bug fixed: Radar on a player sends one line", () => {
    const { a, run, cast } = scene();
    a.spell.book = ["Radar"];
    give(a, "Yellow Crystal", 10);
    const t = at(9, 6);
    cast(a, "Radar", t.h, t.v);
    const lines = chat(run(12), "Ann").filter((l) => l.startsWith("*** Bob"));
    expect(lines).toHaveLength(1);
  });
  test("kept on purpose: a monster's Fireball flies in a random(4) direction from it, not at you", () => {
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
  test("bug fixed: a player with 18 in the name does not block monster spells", () => {
    const { a, b, run, cast } = scene();
    a.name = "Ann18";
    a.spell.book = ["Minor Heal"];
    give(a, "Blue Crystal", 10);
    cast(a, "Minor Heal", 100, 100);
    run(1);
    expect(b.spell.npcSpellBlock).toBe(0);
  });
});

describe("arrow shots", () => {
  test("an arrow casts <Colour> Arrows<dir> from the shooter's tile for every colour and facing", () => {
    const room = { fxQueue: [] as { name: string; h: number; v: number }[] };
    const dirs = { E: "R", W: "L", N: "U", S: "D" } as const;
    for (const colour of ["Blue", "Green", "Purple", "Red", "White", "Yellow"]) {
      for (const [facing, d] of Object.entries(dirs)) {
        const p = { name: "Ann", id: "a", x: 5, y: 6, facing, char: { equip: { weapon: "Bow" } } };
        shootArrow(room as never, p as never, colour, 3);
        // The arrow keeps the bow it left, for the skills its hit trains.
        expect(room.fxQueue.at(-1)).toMatchObject({
          name: `${colour} Arrows${d}`,
          h: 174,
          v: 189,
          firedFrom: "Bow",
        });
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

  test("bug fixed: a portal whose targets' maps are all missing moves no one", () => {
    for (const targets of [[], [{ map: "x77y77", x: 2, y: 2 }]]) {
      const s = portalScene(targets);
      s.run(6);
      expect([s.bob.map.name, s.bob.x, s.bob.y]).toEqual(["x1000y992", 9, 6]);
    }
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
