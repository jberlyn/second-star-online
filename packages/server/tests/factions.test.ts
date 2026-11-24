/**
 * Sim tests: the murder flag, the faction head and exile at death, loyalty, the faction channels,
 * head and quest turn-ins, and the NPC keyword replies.
 */
import { describe, expect, test } from "bun:test";

import { classicData } from "@secondstaronline/data/classic";
import {
  buildContentStore,
  type ContentData,
  installContent,
  type ServerMsg,
} from "@secondstaronline/shared";

import { askForQuest, questGive } from "../src/systems/economy/quests.ts";
import { type MonsterSlot, species } from "../src/systems/monsters/slots.ts";
import { killCreditFrames } from "../src/systems/progression/vitals.ts";
import { askFactionPower, toFactionChannel } from "../src/systems/social/factions.ts";
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

  test("kept on purpose: killing a wanted player never flags the killer", () => {
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

  test("bug fixed: a death long after the last hit credits no one", () => {
    const { a, b, run } = murderScene();
    a.char.vitals.hp = 20;
    run(200); // Bob hit Alice long ago
    a.char.vitals.hp = 0; // something else takes the last of it
    const msgs = run(28);
    expect(b.char.wanted).toBe(false);
    expect(chat(msgs, "Bob")).toEqual(["Alice was just killed."]);
  });

  test("a death within the credit window still credits the hit", () => {
    const { a, b, run } = murderScene();
    a.char.vitals.hp = 20;
    run(killCreditFrames() - 2);
    a.char.vitals.hp = 0;
    const msgs = run(28);
    expect(b.char.wanted).toBe(true);
    expect(chat(msgs, "Bob")).toContain("*** Alice was just killed by Bob.");
  });

  test("bug fixed: a death long after the last hit earns its old attacker no Assassin points", () => {
    const { a, b, world, run } = murderScene();
    world.assassin.mode = "GO";
    a.char.vitals.hp = 20;
    run(200);
    a.char.vitals.hp = 0;
    const msgs = run(28);
    expect(world.assassin.scores.has(b.id)).toBe(false);
    expect(chat(msgs, "Bob").some((t) => t.includes("assassin points"))).toBe(false);
  });

  test("a death within the credit window earns the attacker Assassin points", () => {
    const { b, world, run } = murderScene();
    world.assassin.mode = "GO";
    const msgs = run(28);
    expect(world.assassin.scores.get(b.id)).toBeGreaterThan(0);
    expect(chat(msgs, "Bob").some((t) => t.includes("assassin points"))).toBe(true);
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
    a.char.faction = { key: "warrior", tier: 9 };
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
    a.char.faction = { key: "warrior", tier: 9 };
    a.char.vitals.hpMax = 90;
    run(1);
    expect(map.ground.some((g) => g.item === "Warrior's Head")).toBe(false);
  });

  test("bug fixed: exile below the line on death also leaves the faction channel", () => {
    const { world, a, run } = murderScene();
    a.char.faction = { key: "mage", tier: 3 };
    a.char.factionCount = 100000;
    a.char.vitals.hpMax = 49; // below the Mage line of 50, as an operator might set it
    expect(toFactionChannel(world, "mage", "*** Mages!", "Nobody").map((o) => o.to)).toEqual([
      a.id,
    ]);
    const msgs = run(1);
    expect(chat(msgs, "Alice")).toEqual([
      "*** You have been exiled from the Mage faction due to your downfalls in battle.",
    ]);
    expect(a.char.faction.key).toBe(null);
    expect(a.char.factionCount).toBe(0);
    expect(toFactionChannel(world, "mage", "*** Mages!", "Nobody")).toEqual([]);
  });
});

describe("loyalty", () => {
  test("the count drains per frame, warns at 20000 and kicks at 1, leaving the channel", () => {
    const map = testMap("x1000y992");
    const s = setup([map]);
    const a = player("Alice", map, 5, 5);
    a.char.faction = { key: "adventurer", tier: 0 };
    a.char.factionCount = 20001;
    s.join(a);
    expect(chat(s.run(1), "Alice")).toEqual([
      "*** Corin requests you bring him the head of a rival faction member.",
    ]);
    a.char.factionCount = 2;
    expect(chat(s.run(1), "Alice")).toEqual([
      "*** You have been kicked out of the Adventurer faction due to lack of loyalty.",
    ]);
    expect([a.char.faction.key, a.char.factionCount]).toEqual([null, 0]);
    expect(toFactionChannel(s.world, "adventurer", "*** Adventurers!", "Nobody")).toEqual([]);
  });

  test("a faction the world removed keeps its members' count until it returns", () => {
    const map = testMap("x1000y992");
    const s = setup([map]);
    const a = player("Alice", map, 5, 5);
    a.char.faction = { key: "adventurer", tier: 0 };
    a.char.factionCount = 2;
    s.join(a);
    withContent(
      (d) => {
        d.social.factions = d.social.factions.filter((f) => f.key !== "adventurer");
        d.social.factionRules.editorBoxes = ["warrior", "mage"];
      },
      () => {
        s.run(5);
        expect([a.char.faction.key, a.char.factionCount]).toEqual(["adventurer", 2]);
      },
    );
    // Back, the countdown runs on and kicks at 1 (it never reached 0 unkicked while gone).
    expect(chat(s.run(1), "Alice")).toEqual([
      "*** You have been kicked out of the Adventurer faction due to lack of loyalty.",
    ]);
  });
});

/** Runs `body` with Classic changed by `change`, then puts Classic back. */
function withContent(change: (d: ContentData) => void, body: () => void): void {
  const d = structuredClone(classicData) as ContentData;
  change(d);
  installContent(buildContentStore(d));
  try {
    body();
  } finally {
    installContent(buildContentStore(classicData as ContentData));
  }
}

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

  test("a rival head to Angela: said to the map, power moved, joined, announced to the Mages, bonuses for all", () => {
    const { world, map, a, c, join } = npcScene();
    live(map, 1, "Angela", 5, 4);
    world.factionPowers = { mage: 27, warrior: 123, adventurer: 0 };
    a.char.vitals.hpMax = 60;
    a.char.bag[3] = { item: "Warrior's Head", qty: 1 };
    c.char.faction = { key: "warrior", tier: 9 };
    const d = player("Dan", map, 3, 3);
    d.char.faction = { key: "mage", tier: 3 };
    join(d);
    const out = questGive(world, a, 3, "Angela", rngByN());
    expect(a.char.bag[3]).toBeNull();
    expect(world.factionPowers).toEqual({ mage: 28, warrior: 122, adventurer: 0 });
    expect(world.powersDirty).toBe(true);
    // Bug fixed: a Warrior no longer hears the Mages' announcement; a Mage does.
    expect(chat(out, "Carol")).toEqual([
      'Angela says "You have done well in slaying one of our foes."',
    ]);
    expect(chat(out, "Dan")).toEqual([
      'Angela says "You have done well in slaying one of our foes."',
      "*** The Mage faction has become stronger thanks to Alice.",
    ]);
    expect(chat(out, "Alice")).toEqual([
      'Angela says "You have done well in slaying one of our foes."',
      'Angela says "Welcome to the Mage faction."',
      "*** The Mage faction has become stronger thanks to Alice.",
    ]);
    expect(a.char.faction).toEqual({ key: "mage", tier: 3 });
    expect(a.char.factionCount).toBe(212000);
    expect(c.char.faction.tier).toBe(9);
  });

  test("bug fixed: a joiner who would be refused keeps the head and moves no power", () => {
    const { world, a, c } = npcScene();
    world.factionPowers = { mage: 27, warrior: 123, adventurer: 0 };
    a.char.vitals.hpMax = 20;
    a.char.bag[0] = { item: "Warrior's Head", qty: 1 };
    const out = questGive(world, a, 0, "Angela", rngByN());
    expect(chat(out, "Alice")).toEqual(['Angela says "You need more experience to join us."']);
    expect(chat(out, "Carol")).toEqual([]);
    expect(a.char.bag[0]).toEqual({ item: "Warrior's Head", qty: 1 });
    expect(world.factionPowers).toEqual({ mage: 27, warrior: 123, adventurer: 0 });
    expect(world.powersDirty).toBe(false);
    expect(a.char.faction.key).toBe(null);
    // Another faction's member is refused the same way.
    a.char.vitals.hpMax = 90;
    a.char.faction = { key: "adventurer", tier: 0 };
    expect(chat(questGive(world, a, 0, "Angela", rngByN()), "Alice")).toEqual([
      'Angela says "We could use someone like you in our faction."',
    ]);
    expect(a.char.bag[0]).toEqual({ item: "Warrior's Head", qty: 1 });
    expect(world.factionPowers).toEqual({ mage: 27, warrior: 123, adventurer: 0 });
  });

  test("a member turning a rival head in to its own leader adds time and moves power", () => {
    const { world, a } = npcScene();
    world.factionPowers = { mage: 27, warrior: 123, adventurer: 0 };
    a.char.vitals.hpMax = 20;
    a.char.faction = { key: "mage", tier: 3 };
    a.char.factionCount = 5;
    a.char.bag[0] = { item: "Warrior's Head", qty: 1 };
    const out = questGive(world, a, 0, "Angela", rngByN());
    expect(chat(out, "Alice")).toContain(
      'Angela says "I hope that you will be with us for years to come."',
    );
    expect(a.char.bag[0]).toBeNull();
    expect(world.factionPowers).toEqual({ mage: 28, warrior: 122, adventurer: 0 });
    expect(a.char.factionCount).toBe(212005);
  });

  test("bug fixed: turn-in takes the head you gave, not the first in the bag", () => {
    const { world, a } = npcScene();
    a.char.vitals.hpMax = 90;
    a.char.bag[0] = { item: "Mage's Head", qty: 2 };
    a.char.bag[5] = { item: "Mage's Head", qty: 1 };
    questGive(world, a, 5, "Trianus", rngByN());
    expect(a.char.bag[0]).toEqual({ item: "Mage's Head", qty: 2 });
    expect(a.char.bag[5]).toBeNull();
  });

  test("a quest item: the reward, thanks to the map, the line rerolled", () => {
    const { world, a, c } = npcScene();
    a.char.bag[2] = { item: "Fishle", qty: 1 };
    const out = questGive(world, a, 2, "Stephie", rngByN({ 43: [5], 17: [3], 19: [9] }));
    // The lowest empty slot takes the reward.
    expect(a.char.bag[0]).toEqual({ item: "Yellow Potion", qty: 1 });
    expect(a.char.bag[2]).toBeNull();
    expect(chat(out, "Carol")).toEqual([
      'Stephie says "Wow thanks, just what I needed. Here take this reward!"',
    ]);
    expect(world.questLines[1]).toBe("Cril:Corn:Trumpet");
    expect([...world.questsDirty]).toEqual([1]);
  });

  test("bug fixed: Fish given to Stephie is not her Fishle; nothing is taken", () => {
    const { world, a } = npcScene();
    a.char.bag[0] = { item: "Fish", qty: 3 };
    const out = questGive(world, a, 0, "Stephie", rngByN());
    expect(chat(out, "Alice")).toEqual(["Stephie says \"I'm sorry but I don't need that.\""]);
    expect(a.char.bag[0]).toEqual({ item: "Fish", qty: 3 });
  });

  test("bug fixed: a reward with no room is refused and nothing is taken", () => {
    const { world, a } = npcScene();
    for (let i = 0; i < 15; i++) {
      a.char.bag[i] = { item: `Thing ${i}`, qty: 1 };
    }
    a.char.bag[2] = { item: "Fishle", qty: 2 };
    const out = questGive(world, a, 2, "Stephie", rngByN());
    expect(chat(out, "Alice")).toEqual([
      'Stephie says "You have no room in your bag for my reward."',
    ]);
    expect(a.char.bag[2]).toEqual({ item: "Fishle", qty: 2 });
    expect(world.questsDirty.size).toBe(0);
    // Giving the last one frees its slot for the reward.
    a.char.bag[2] = { item: "Fishle", qty: 1 };
    questGive(world, a, 2, "Stephie", rngByN());
    expect(a.char.bag[2]).toEqual({ item: "Yellow Potion", qty: 1 });
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

describe("heads are their factions' head items", () => {
  function scene() {
    const map = testMap("x1000y992");
    const s = setup([map]);
    const a = player("Alice", map, 5, 5);
    s.join(a);
    a.facing = "N";
    live(map, 1, "Angela", 5, 4);
    s.world.factionPowers = { mage: 27, warrior: 123, adventurer: 0 };
    a.char.vitals.hpMax = 60;
    return { ...s, a };
  }

  test('a head named without " Head" is a head; an item with " Head" in its name that is no head is not taken', () => {
    withContent(
      (d) => {
        const w = d.social.factions.find((f) => f.key === "warrior");
        if (w) {
          w.head = "Ale";
        }
      },
      () => {
        const { world, a } = scene();
        a.char.bag[0] = { item: "Ale", qty: 1 };
        questGive(world, a, 0, "Angela", rngByN());
        expect(a.char.bag[0]).toBeNull();
        expect([a.char.faction.key, world.factionPowers.warrior]).toEqual(["mage", 122]);
        // The old Warrior's Head is no head now: it goes to the quest lines and stays in the bag.
        a.char.bag[1] = { item: "Warrior's Head", qty: 1 };
        const out = questGive(world, a, 1, "Angela", rngByN());
        expect(a.char.bag[1]).toEqual({ item: "Warrior's Head", qty: 1 });
        expect(chat(out, "Alice")).toEqual(["Angela says \"I'm sorry but I don't need that.\""]);
      },
    );
  });
});

describe("NPC keyword replies", () => {
  test("bug fixed: SayQuest: every slot's reply is heard by the map, with its closing quote", () => {
    const map = testMap("x1000y992");
    const s = setup([map]);
    const a = player("Alice", map, 5, 5);
    const c = player("Carol", map, 8, 8);
    s.join(a);
    s.join(c);
    live(map, 1, "Stephie", 2, 2);
    live(map, 2, "Edwin", 3, 2);
    const out = askForQuest(s.world, a);
    const both = [
      'Stephie says "Bring me a Fishle quickly and I\'ll reward you."',
      'Edwin says "Bring me a scroll quickly and I\'ll reward you."',
    ];
    expect(chat(out, "Alice")).toEqual(both);
    expect(chat(out, "Carol")).toEqual(both);
  });

  test("SayFaction: each leader on the map, heard by the map", () => {
    const map = testMap("x1000y992");
    const s = setup([map]);
    const a = player("Alice", map, 5, 5);
    s.join(a);
    live(map, 2, "Corin", 2, 2);
    live(map, 1, "Trianus", 3, 2);
    s.world.factionPowers = { mage: 27, warrior: 123, adventurer: 0 };
    expect(chat(askFactionPower(s.world, a), "Alice")).toEqual([
      'Trianus says "We are currently in absolute power."',
      'Corin says "We are very weak, I fear that we may be destroyed."',
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
    s.world.factionPowers = { mage: 150, warrior: 150, adventurer: 150 };
    expect(chat(askFactionPower(s.world, a), "Alice")).toEqual([
      'Angela says "Our power is fine...for now."',
      'Trianus says "Our power is fine...for now."',
      'Corin says "Our power is fine...for now."',
    ]);
  });
});
