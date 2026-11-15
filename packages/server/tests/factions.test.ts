/**
 * Sim tests: the murder flag, the faction head and exile at death, loyalty, the `@Faction`
 * channel, head and quest turn-ins, and the NPC keyword replies.
 */
import { describe, expect, test } from "bun:test";

import type { ServerMsg } from "@secondstaronline/shared";

import { askForQuest, questGive } from "../src/systems/economy/quests.ts";
import { type MonsterSlot, species } from "../src/systems/monsters/slots.ts";
import { askFactionPower, factionLogin } from "../src/systems/social/factions.ts";
import type { WorldMap } from "../src/systems/world/world.ts";
import { player, rngByN, setup, testMap } from "./helpers/sim.ts";

type Out = { to: string; msg: ServerMsg }[];
const chat = (msgs: Out, to: string) =>
  msgs.flatMap((m) => (m.to === to && m.msg.t === "chat" ? [m.msg.text] : []));

function live(map: WorldMap, slot: number, name: string, x: number, y: number): void {
  const s = map.slots[slot - 1] as MonsterSlot;
  s.species = name;
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
}

/** Two players on a PvP-X map; `a` will die at the next tick, last hit by `b`. */
function murderScene(rng = rngByN()) {
  const map = testMap("x1000y992");
  map.flags.canPvp = "X";
  const s = setup([map], undefined, rng);
  const a = player("Alice", map, 9, 9);
  const b = player("Bob", map, 2, 2);
  s.join(a);
  s.join(b);
  a.char.vitals.hp = 0;
  a.lastToHitMe = "Bob";
  a.lastToHitId = b.id;
  return { ...s, map, a, b };
}

describe("the murder flag", () => {
  test("an unflagged victim flags its killer at the end of the lock, naming the victim", () => {
    const { a, b, run } = murderScene();
    run(1);
    expect(b.char.wanted).toBe(false);
    const msgs = run(27);
    expect(b.char.wanted).toBe(true);
    expect(chat(msgs, "Bob")).toEqual([
      "*** You are now wanted for the murder of Alice.",
      "*** Alice was just killed by Bob.",
    ]);
    expect(a.char.wanted).toBe(false);
  });

  test("kept bug: killing a wanted player never flags the killer", () => {
    const { a, b, run } = murderScene();
    a.char.wanted = true;
    run(28);
    expect(b.char.wanted).toBe(false);
  });

  test("monsters never flag and you cannot flag yourself", () => {
    const { a, b, run } = murderScene();
    a.lastToHitMe = "a Slime";
    a.lastToHitId = null;
    run(28);
    expect(b.char.wanted).toBe(false);
    const s2 = murderScene();
    s2.a.lastToHitId = s2.a.id;
    s2.run(28);
    expect(s2.a.char.wanted).toBe(false);
  });

  test("a player named like a monster is flagged like anyone", () => {
    const { a, b, run } = murderScene();
    b.name = "Orc";
    a.lastToHitMe = "Orc";
    run(28);
    expect(b.char.wanted).toBe(true);
  });

  test("kept bug: a starvation death credits the last attacker, however long ago", () => {
    const { a, b, run } = murderScene();
    a.char.vitals.hp = 20;
    run(200); // Bob hit Alice long ago; nothing has cleared it
    a.char.vitals.hp = 0; // hunger takes the last of it
    run(28);
    expect(b.char.wanted).toBe(true);
  });

  test("an arena death never flags", () => {
    const map = testMap("x1000y992", [], (_x, y) => (y <= 9 ? "6P" : "G1"));
    const s = setup([map]);
    const a = player("Alice", map, 9, 9);
    const b = player("Bob", map, 2, 2);
    s.join(a);
    s.join(b);
    a.char.vitals.hp = 0;
    a.lastToHitId = b.id;
    s.run(40);
    expect(b.char.wanted).toBe(false);
  });

  test("a killer who has left is not flagged (1.6's message to an absent name was lost)", () => {
    const { b, run, world } = murderScene();
    world.players.delete(b.id);
    run(28);
    expect(b.char.wanted).toBe(false);
  });
});

describe("faction death", () => {
  test("a member drops its head on a PvP-X map before its item drop, whatever killed it", () => {
    const { a, map, run } = murderScene();
    a.char.faction = { id: 2, f1Bonus: 0, f2Bonus: 9, f3Bonus: 0 };
    a.char.factionCount = 100000;
    a.char.vitals.hpMax = 90;
    a.char.bag[0] = { item: "Apple", qty: 1 };
    a.lastToHitId = null;
    run(1);
    const here = map.ground.filter((g) => g.x === 9 && g.y === 9).map((g) => g.item);
    expect(here[0]).toBe("Warrior's Head");
  });

  test("no head on a map whose PvP flag is O, nor from a non-member", () => {
    const { a, map, run } = murderScene();
    map.flags.canPvp = "O";
    a.char.faction = { id: 2, f1Bonus: 0, f2Bonus: 9, f3Bonus: 0 };
    a.char.vitals.hpMax = 90;
    run(1);
    expect(map.ground.some((g) => g.item === "Warrior's Head")).toBe(false);
  });

  test("kept bug: exile below the line after the penalty; the channel is kept", () => {
    const { a, run } = murderScene(rngByN({ 5: [1] }));
    a.char.faction = { id: 1, f1Bonus: 3, f2Bonus: 0, f3Bonus: 0 };
    a.char.factionCount = 100000;
    a.char.vitals.hpMax = 50; // the penalty takes it to 49
    factionLogin(a);
    const msgs = run(1);
    expect(chat(msgs, "Alice")).toEqual([
      "*** Your downfall in battle has caused you to become weakened.",
      "*** You have been exiled from the Mage faction due to your downfalls in battle.",
    ]);
    expect(a.char.faction.id).toBe(0);
    expect(a.char.factionCount).toBe(0);
    expect(a.factionChannel).toBe(true);
  });
});

describe("loyalty", () => {
  test("the count drains per frame, warns at 20000 and kicks at 1, leaving @Faction", () => {
    const map = testMap("x1000y992");
    const s = setup([map]);
    const a = player("Alice", map, 5, 5);
    a.char.faction = { id: 3, f1Bonus: 0, f2Bonus: 0, f3Bonus: 0 };
    a.char.factionCount = 20001;
    factionLogin(a);
    s.join(a);
    expect(chat(s.run(1), "Alice")).toEqual([
      "*** Corin requests you bring him the head of a rival faction member.",
    ]);
    a.char.factionCount = 2;
    expect(chat(s.run(1), "Alice")).toEqual([
      "*** You have been kicked out of the Adventurer faction due to lack of loyalty.",
    ]);
    expect([a.char.faction.id, a.char.factionCount, a.factionChannel]).toEqual([0, 0, false]);
  });
});

describe("turn-ins", () => {
  function npcScene() {
    const map = testMap("x1000y992");
    const s = setup([map]);
    const a = player("Alice", map, 5, 5);
    const c = player("Carol", map, 8, 8);
    s.join(a);
    s.join(c);
    a.facing = "N";
    return { ...s, map, a, c };
  }

  test("a rival head to Angela: said to the map, power moved, joined, announced, bonuses for all", () => {
    const { world, map, a, c } = npcScene();
    live(map, 1, "Angela", 5, 4);
    world.factionPowers = [27, 123, 0];
    a.char.vitals.hpMax = 60;
    a.char.bag[3] = { item: "Warrior's Head", qty: 1 };
    c.char.faction = { id: 2, f1Bonus: 0, f2Bonus: 9, f3Bonus: 0 };
    factionLogin(c);
    const out = questGive(world, a, 3, "Angela", rngByN());
    expect(a.char.bag[3]).toBeNull();
    expect(world.factionPowers).toEqual([28, 122, 0]);
    expect(world.powersDirty).toBe(true);
    expect(chat(out, "Carol")).toEqual([
      'Angela says "You have done well in slaying one of our foes."',
      "*** The Mage faction has become stronger thanks to Alice.",
    ]);
    expect(chat(out, "Alice")).toEqual([
      'Angela says "You have done well in slaying one of our foes."',
      'Angela says "Welcome to the Mage faction."',
      "*** The Mage faction has become stronger thanks to Alice.",
    ]);
    expect(a.char.faction).toEqual({ id: 1, f1Bonus: 3, f2Bonus: 0, f3Bonus: 0 });
    expect(a.char.factionCount).toBe(212000);
    expect(c.char.faction.f2Bonus).toBe(9);
  });

  test("kept bug: a refused joiner's head still moves the power", () => {
    const { world, a } = npcScene();
    world.factionPowers = [27, 123, 0];
    a.char.vitals.hpMax = 20;
    a.char.bag[0] = { item: "Warrior's Head", qty: 1 };
    const out = questGive(world, a, 0, "Angela", rngByN());
    expect(world.factionPowers).toEqual([28, 122, 0]);
    expect(chat(out, "Alice")).toContain('Angela says "You need more experience to join us."');
    expect(a.char.faction.id).toBe(0);
  });

  test("kept bug: turn-in takes the first head in the bag, not the one given", () => {
    const { world, a } = npcScene();
    a.char.bag[0] = { item: "Mage's Head", qty: 2 };
    a.char.bag[5] = { item: "Mage's Head", qty: 1 };
    questGive(world, a, 5, "Trianus", rngByN());
    expect(a.char.bag[0]).toEqual({ item: "Mage's Head", qty: 1 });
    expect(a.char.bag[5]).toEqual({ item: "Mage's Head", qty: 1 });
  });

  test("a quest item: the reward, thanks to the map, the line rerolled", () => {
    const { world, a, c } = npcScene();
    a.char.bag[2] = { item: "Fishle", qty: 1 };
    const out = questGive(world, a, 2, "Stephie", rngByN({ 44: [5], 20: [3, 9] }));
    // The lowest empty slot takes the reward.
    expect(a.char.bag[0]).toEqual({ item: "Yellow Potion", qty: 1 });
    expect(a.char.bag[2]).toBeNull();
    expect(chat(out, "Carol")).toEqual([
      'Stephie says "Wow thanks, just what I needed. Here take this reward!"',
    ]);
    expect(world.questLines[1]).toBe("Cril:Corn:Trumpet");
    expect([...world.questsDirty]).toEqual([1]);
  });

  test("nothing wanted: 'I'm sorry' to the giver alone; a monster takes nothing", () => {
    const { world, a } = npcScene();
    a.char.bag[0] = { item: "Apple", qty: 1 };
    const out = questGive(world, a, 0, "Smithy", rngByN());
    expect(out).toEqual([
      {
        to: "Alice",
        msg: { t: "chat", text: "Smithy says \"I'm sorry but I don't need that.\"", color: 0 },
      },
    ]);
    expect(questGive(world, a, 0, "Slime", rngByN())).toEqual([]);
    expect(a.char.bag[0]).toEqual({ item: "Apple", qty: 1 });
  });

  test("Oraku takes his orb for the Royal Ninja Uniform", () => {
    const { world, a } = npcScene();
    a.char.bag[0] = { item: "Oraku's Orb", qty: 1 };
    const out = questGive(world, a, 0, "Oraku", rngByN());
    expect(a.char.bag[0]).toEqual({ item: "Royal Ninja Uniform", qty: 1 });
    expect(chat(out, "Alice")[0]).toStartWith("Oraku says \"I've been searching");
  });
});

describe("NPC keyword replies", () => {
  test("SayQuest: slot 1 to the asker, others to the map", () => {
    const map = testMap("x1000y992");
    const s = setup([map]);
    const a = player("Alice", map, 5, 5);
    const c = player("Carol", map, 8, 8);
    s.join(a);
    s.join(c);
    live(map, 1, "Stephie", 2, 2);
    live(map, 2, "Edwin", 3, 2);
    const out = askForQuest(s.world, a);
    expect(chat(out, "Alice")).toEqual([
      "Stephie says \"Bring me a Fishle quickly and I'll reward you.",
      "Edwin says \"Bring me a scroll quickly and I'll reward you.",
    ]);
    expect(chat(out, "Carol")).toEqual([
      "Edwin says \"Bring me a scroll quickly and I'll reward you.",
    ]);
  });

  test("SayFaction: each leader on the map, heard by the map", () => {
    const map = testMap("x1000y992");
    const s = setup([map]);
    const a = player("Alice", map, 5, 5);
    s.join(a);
    live(map, 2, "Corin", 2, 2);
    live(map, 1, "Trianus", 3, 2);
    s.world.factionPowers = [27, 123, 0];
    expect(chat(askFactionPower(s.world, a), "Alice")).toEqual([
      'Trianus says "We are currently in absolute power.',
      'Corin says "We are very weak, I fear that we may be destroyed.',
    ]);
  });

  test("Pig and Cow give no quest", () => {
    const map = testMap("x1000y992");
    const s = setup([map]);
    const a = player("Alice", map, 5, 5);
    s.join(a);
    live(map, 1, "Pig", 2, 2);
    live(map, 2, "Cow", 3, 2);
    expect(askForQuest(s.world, a)).toEqual([]);
  });

  test("faction leaders answer in Angela, Trianus, Corin order", () => {
    const map = testMap("x1000y992");
    const s = setup([map]);
    const a = player("Alice", map, 5, 5);
    s.join(a);
    live(map, 1, "Corin", 2, 2);
    live(map, 2, "Trianus", 3, 2);
    live(map, 3, "Angela", 4, 2);
    s.world.factionPowers = [150, 150, 150];
    expect(chat(askFactionPower(s.world, a), "Alice")).toEqual([
      'Angela says "Our power is fine...for now.',
      'Trianus says "Our power is fine...for now.',
      'Corin says "Our power is fine...for now.',
    ]);
  });
});
