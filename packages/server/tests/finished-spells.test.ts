/**
 * Issue #17 on the server sim: Bless, Weaken, Haste, Poison Dart, Replenish, Holy Weapon and
 * Identify, which 1.6 listed, priced and taught but gave no effect, cast and do what SSO designed
 * for them.
 */
import { describe, expect, test } from "bun:test";

import {
  CAST_TEXT,
  EFFECT_TEXT,
  type ServerMsg,
  skillIndex,
  tileLoc,
} from "@secondstaronline/shared";

import { pollAttack, setAttackHeld } from "../src/systems/combat/melee.ts";
import { fighterOf } from "../src/systems/monsters/attack.ts";
import type { MonsterSlot } from "../src/systems/monsters/slots.ts";
import { species } from "../src/systems/monsters/slots.ts";
import { castIntent } from "../src/systems/spells/cast.ts";
import type { Player, Room, WorldMap } from "../src/systems/world/world.ts";
import { player, rngByN, setup, testMap } from "./helpers/sim.ts";

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
/** A click in the middle of tile (x, y). */
const centre = (x: number, y: number) => ({ h: x * 32 + 14, v: y * 32 + 15 });

/** Ann on (6, 6) and Bob on (9, 6), each with 20 of 40 HP and 200 SP. */
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
  const cast = (p: Player, spell: string, h: number, v: number) => {
    p.timers.actionDelay = 0;
    return castIntent(room, p, spell, h, v, { rng });
  };
  return { map, world, room, a, b, run, cast, rng };
}

const give = (p: Player, item: string, qty: number) => {
  const i = p.char.bag.indexOf(null);
  p.char.bag[i] = { item, qty };
};

/** Every crystal colour, plenty of each. */
const crystals = (p: Player) => {
  for (const c of ["Blue", "Yellow", "White", "Green"]) {
    give(p, `${c} Crystal`, 50);
  }
};

describe("design change: the spells 1.6 left without an effect work", () => {
  test("design change: Replenish heals between Minor and Major Heal, and any heal cures poison", () => {
    const { a, b, run, cast, room } = scene();
    a.spell.book = ["Replenish"];
    crystals(a);
    b.spell.poison = {
      frames: 500,
      next: 40,
      power: 1,
      owner: "x",
      ownerId: null,
      castSpell: null,
    };
    const t = at(9, 6);
    cast(a, "Replenish", t.h, t.v);
    const P = room.fxQueue[0]?.power ?? 0;
    expect(a.char.vitals.sp).toBe(200 - 22);
    const out = run(3);
    // 8 + P + random(6), the roll at its top.
    expect(b.char.vitals.hp).toBe(20 + 8 + P + 6);
    expect(b.spell.poison).toBeNull();
    expect(chat(out, "Bob")).toContain(EFFECT_TEXT.poisonEnds);
  });

  test("design change: Haste makes HP and SP regenerate twice as fast, then ends", () => {
    const { a, b, run, cast } = scene();
    a.spell.book = ["Haste"];
    crystals(a);
    const t = at(6, 6);
    cast(a, "Haste", t.h, t.v);
    const out = run(4);
    expect(chat(out, "Ann")).toContain(EFFECT_TEXT.haste);
    expect(a.spell.haste).toBeGreaterThan(1000);
    const [annHp, bobHp] = [a.char.vitals.hp, b.char.vitals.hp];
    run(600);
    expect(a.char.vitals.hp - annHp).toBe(2 * (b.char.vitals.hp - bobHp));
    expect(b.char.vitals.hp - bobHp).toBeGreaterThan(0);
    const ends = run(a.spell.haste);
    expect(chat(ends, "Ann")).toContain(EFFECT_TEXT.hasteEnds);
    expect(a.spell.haste).toBe(0);
  });

  test("design change: Bless adds 2 to the attack power of the player it lands on", () => {
    const { a, b, run, cast } = scene();
    a.spell.book = ["Bless"];
    crystals(a);
    const t = at(9, 6);
    cast(a, "Bless", t.h, t.v);
    const out = run(4);
    expect(chat(out, "Bob")).toContain(EFFECT_TEXT.bless);
    expect(fighterOf(b).blessBonus).toBe(2);
    expect(fighterOf(a).blessBonus).toBe(0);
    const ends = run(b.spell.bless);
    expect(chat(ends, "Bob")).toContain(EFFECT_TEXT.blessEnds);
    expect(fighterOf(b).blessBonus).toBe(0);
  });

  test("design change: Holy Weapon adds 2 to each melee hit, 4 on the undead", () => {
    const swing = (monster: string, holy: boolean) => {
      const { a, map, room, rng, world, cast, run } = scene();
      live(map, 1, monster, 6, 7, 5000);
      a.facing = "S";
      a.spell.book = ["Holy Weapon"];
      crystals(a);
      const t = at(6, 6);
      cast(a, "Holy Weapon", t.h, t.v);
      expect(chat(run(4), "Ann")).toContain(EFFECT_TEXT.holyWeapon);
      if (!holy) {
        a.spell.holyWeapon = 0;
      }
      a.timers.actionDelay = 0;
      setAttackHeld(a, true);
      return pollAttack(room, a, { rng, now: 0, world }).hits[0]?.dmg ?? 0;
    };
    expect(swing("Orc", true) - swing("Orc", false)).toBe(2);
    expect(swing("Zombie", true) - swing("Zombie", false)).toBe(4);
  });

  test("design change: Weaken takes 2 off another player's attack where PvP is on, never yours", () => {
    const { a, b, map, run, cast } = scene();
    a.spell.book = ["Weaken"];
    crystals(a);
    map.flags.canPvp = "O";
    cast(a, "Weaken", at(9, 6).h, at(9, 6).v);
    run(4);
    expect(b.spell.weaken).toBe(0);
    map.flags.canPvp = "X";
    cast(a, "Weaken", at(6, 6).h, at(6, 6).v);
    run(4);
    expect(a.spell.weaken).toBe(0);
    cast(a, "Weaken", at(9, 6).h, at(9, 6).v);
    const out = run(4);
    expect(chat(out, "Bob")).toContain(EFFECT_TEXT.weaken);
    expect(fighterOf(b).weakenPenalty).toBe(2);
    const ends = run(b.spell.weaken);
    expect(chat(ends, "Bob")).toContain(EFFECT_TEXT.weakenEnds);
  });

  test("design change: Weaken and Poison Dart are refused where fighting is off", () => {
    const { a, map, cast } = scene();
    a.spell.book = ["Weaken", "Poison Dart"];
    crystals(a);
    map.flags.canFight = "O";
    for (const spell of ["Weaken", "Poison Dart"]) {
      const r = cast(a, spell, 300, 200);
      expect(r.out[0]?.msg).toEqual({ t: "chat", text: CAST_TEXT.harmful, color: 0 });
    }
    expect(a.char.vitals.sp).toBe(200);
  });

  test("design change: Weaken on a monster runs out with its time", () => {
    const { a, map, run, cast } = scene();
    a.spell.book = ["Weaken"];
    crystals(a);
    const orc = live(map, 1, "Orc", 9, 4, 500);
    cast(a, "Weaken", at(9, 4).h, at(9, 4).v);
    const out = run(4);
    expect(events(out, "Ann")).toContainEqual(
      expect.objectContaining({ e: "mspell", slot: 1, text: "Weak" }),
    );
    expect(orc.weaken ?? 0).toBeGreaterThan(400);
    run(orc.weaken ?? 0);
    expect(orc.weaken).toBe(0);
  });

  test("design change: Poison Dart flies at a player and poisons them; each hit is the caster's", () => {
    const { a, b, run, cast, room } = scene();
    a.spell.book = ["Poison Dart"];
    crystals(a);
    a.char.skills[skillIndex("BlackArts")] = 20;
    a.char.skills[skillIndex("MartialArts")] = 20;
    cast(a, "Poison Dart", at(9, 6).h, at(9, 6).v);
    expect(room.fxQueue[0]?.name).toBe("Poison DartR");
    const out = run(12);
    expect(chat(out, "Bob")).toContain(EFFECT_TEXT.poison);
    expect(b.spell.poison?.ownerId).toBe("Ann");
    const hp = b.char.vitals.hp;
    run(40);
    // 2 + random(3), the roll at its top.
    expect(b.char.vitals.hp).toBe(hp - 5);
    expect(b.lastToHitId).toBe("Ann");
    // The poison kills, and the death is Ann's.
    b.char.vitals.hp = 4;
    run(40);
    expect(b.deadLock).toBeGreaterThan(0);
    expect(b.spell.poison).toBeNull();
  });

  test("design change: another player's poison does no harm where PvP is off", () => {
    const { b, map, run } = scene();
    b.spell.poison = {
      frames: 100,
      next: 1,
      power: 1,
      owner: "Ann",
      ownerId: "Ann",
      castSpell: null,
    };
    map.flags.canPvp = "O";
    const out = run(80);
    // Regeneration only: no hit lands.
    expect(b.char.vitals.hp).toBeGreaterThanOrEqual(20);
    expect(events(out, "Bob").filter((e) => e.e === "phit")).toEqual([]);
  });

  test("design change: a poisoned monster loses HP every two seconds and its death is the caster's", () => {
    const { a, b, map, run, cast } = scene();
    a.spell.book = ["Poison Dart"];
    crystals(a);
    b.x = 9;
    b.y = 9;
    const orc = live(map, 1, "Orc", 9, 6);
    cast(a, "Poison Dart", at(9, 6).h, at(9, 6).v);
    const out = run(12);
    expect(events(out, "Ann")).toContainEqual(
      expect.objectContaining({ e: "mspell", slot: 1, text: "Poison" }),
    );
    expect(orc.poison?.ownerId).toBe("Ann");
    const hp = orc.hp;
    run(40);
    expect(orc.hp).toBe(hp - 5);
    const exp = a.char.vitals.exp;
    orc.hp = 3;
    run(40);
    expect(map.slots[0]?.live).toBeNull();
    expect(a.char.vitals.exp).toBeGreaterThan(exp);
  });

  test("design change: Poison Dart trains Black Arts and Martial Arts on each cast", () => {
    const { a, run, cast } = scene();
    a.spell.book = ["Poison Dart"];
    crystals(a);
    a.char.skills[skillIndex("BlackArts")] = 1;
    a.char.skills[skillIndex("MartialArts")] = 1;
    cast(a, "Poison Dart", 400, 100);
    const out = run(2);
    // `random(skill) = 1` at skill 1.
    expect(a.char.skills[skillIndex("BlackArts")]).toBe(2);
    expect(a.char.skills[skillIndex("MartialArts")]).toBe(2);
    expect(chat(out, "Ann")).toEqual(
      expect.arrayContaining([
        "You have advanced in the art of Black Arts!",
        "You have advanced in the art of Martial Arts!",
      ]),
    );
  });

  test("design change: Identify tells you about the item where you cast it, and trains Item Identification", () => {
    const { a, map, cast, run } = scene();
    a.spell.book = ["Identify"];
    a.char.skills[skillIndex("ItemIdentification")] = 1;
    map.ground.push({ id: "g1", item: "Long Sword", x: 6, y: 4, kind: "drop", expiresAt: null });
    const c = centre(6, 4);
    const r = cast(a, "Identify", c.h, c.v);
    const lines = r.out.flatMap((o) => (o.msg.t === "chat" ? [o.msg.text] : []));
    expect(lines[0]).toBe("You study the Long Sword closely...");
    expect(lines).toContain("It is wielded as a weapon.");
    expect(a.char.vitals.sp).toBe(200 - 5);
    run(2);
    expect(a.char.skills[skillIndex("ItemIdentification")]).toBe(2);
  });

  test("design change: Identify where nothing lies is refused before anything is spent", () => {
    const { a, cast, room } = scene();
    a.spell.book = ["Identify"];
    const c = centre(7, 4);
    const r = cast(a, "Identify", c.h, c.v);
    expect(r.out[0]?.msg).toEqual({ t: "chat", text: CAST_TEXT.identifyNothing, color: 0 });
    expect(a.char.vitals.sp).toBe(200);
    expect(a.timers.actionDelay).toBe(0);
    expect(room.fxQueue).toEqual([]);
  });
});
