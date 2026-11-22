/**
 * A monster killed by a spell sends the same kill broadcast as a melee kill (the Overlord's "All
 * hail" line), to every player who hears the killer, while kill skill gain stays with melee.
 */
import { describe, expect, test } from "bun:test";

import { type ServerMsg, skillIndex, tileLoc } from "@secondstaronline/shared";

import type { MonsterSlot } from "../src/systems/monsters/slots.ts";
import { castIntent } from "../src/systems/spells/cast.ts";
import type { Player, Room } from "../src/systems/world/world.ts";
import { player, rngByN, setup, testMap } from "./helpers/sim.ts";

type Out = { to: string; msg: ServerMsg }[];
const chat = (msgs: Out, to: string) =>
  msgs.flatMap((m) => (m.to === to && m.msg.t === "chat" ? [m.msg.text] : []));

const HAIL = "*** ** * All hail Ann who has rid the world of an evil overlord!";

function scene(name: string) {
  const rng = rngByN();
  const map = testMap("x1000y992");
  const elsewhere = testMap("x1001y992");
  const { world, join, run } = setup([map, elsewhere], undefined, rng);
  const a = player("Ann", map, 6, 6);
  const b = player("Bob", map, 9, 6);
  const c = player("Cat", elsewhere, 5, 5);
  const d = player("Dan", elsewhere, 7, 7);
  for (const p of [a, b, c, d]) {
    p.flicker = 0;
    p.char.vitals = { ...p.char.vitals, sp: 200, spMax: 200, hp: 20, hpMax: 40 };
  }
  for (const p of [a, b, c, d]) {
    join(p);
  }
  d.ignore = ["ann"];
  const slot = map.slots[0] as MonsterSlot;
  slot.species = name;
  slot.pause = 10_000;
  slot.live = {
    name,
    hp: 1,
    x: 6,
    y: 4,
    facing: "S",
    anim: 0,
    fromX: 6,
    fromY: 4,
    queue: [],
    hitCountb: 0,
  };
  const room = world.rooms.get(map.name) as Room;
  const fireball = (p: Player) => {
    p.spell.book = ["Fireball"];
    const i = p.char.bag.indexOf(null);
    p.char.bag[i] = { item: "Red Crystal", qty: 10 };
    const t = tileLoc(6, 4);
    castIntent(room, p, "Fireball", t.h, t.v, { rng });
  };
  return { map, a, run, fireball };
}

describe("spell kill broadcast", () => {
  test("bug fixed: an Overlord killed by a spell is announced to everyone who hears the killer", () => {
    const { map, a, run, fireball } = scene("Overlord");
    const skills = [...a.char.skills];
    fireball(a);
    const out = run(2);
    expect(map.slots[0]?.live).toBeNull();
    for (const name of ["Ann", "Bob", "Cat"]) {
      expect(chat(out, name)).toContain(HAIL);
    }
    // Dan ignores Ann, as with a melee kill's broadcast.
    expect(chat(out, "Dan")).not.toContain(HAIL);
    // Kill skill gain follows the weapon, so a spell kill trains no weapon skill.
    expect(a.char.skills[skillIndex("Punch")]).toBe(skills[skillIndex("Punch")]);
  });

  test("a spell kill of a monster with no broadcast row announces nothing", () => {
    const { map, a, run, fireball } = scene("Slime");
    fireball(a);
    const out = run(2);
    expect(map.slots[0]?.live).toBeNull();
    expect(chat(out, "Bob").some((t) => t.includes("All hail"))).toBe(false);
  });
});
