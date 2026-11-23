/** Factions, the murder flag's lines and quests. */
import { describe, expect, test } from "bun:test";

import { classicData } from "@secondstaronline/data/classic";

const { social: socialData } = classicData;

import { buildContentStore, content, installContent } from "../../src/content/store.ts";
import {
  archivedQuestLines,
  asksAboutFaction,
  asksForQuest,
  type Bag,
  deathHead,
  emptyBag,
  exileAtDeath,
  factionBonus,
  factionByKey,
  findNewQuest,
  headTurnIn,
  joinFaction,
  joinRefusal,
  loyaltyStep,
  pardonedLine,
  pardoningLine,
  questLineUnanswerable,
  questMatch,
  questReward,
  questRoom,
  questTake,
  type Rng,
  sayFaction,
  sayQuest,
  sortFaction,
  startingPowers,
  wantedLine,
} from "../../src/index.ts";

const seq = (...rolls: number[]): Rng => ({ random: () => rolls.shift() ?? 1 });

/** Classic's faction with this key. */
const F = (key: string) => {
  const f = factionByKey(key);
  if (!f) {
    throw new Error(key);
  }
  return f;
};
/** Powers in 1.6's file order, mage:warrior:adventurer. */
const P = (mage: number, warrior: number, adventurer: number) => ({ mage, warrior, adventurer });

describe("factions", () => {
  test("Classic's factions start at the archive's powers, 27:123:0", () => {
    expect(startingPowers()).toEqual({ mage: 27, warrior: 123, adventurer: 0 });
  });

  test("bug fixed: the faction bonus cascade's last true row wins, and 200 or more gives 9", () => {
    expect([0, 4, 5, 9, 10, 27, 79, 80, 89, 90, 123, 199, 200, 500].map(factionBonus)).toEqual([
      0, 0, 1, 1, 2, 3, 8, 9, 9, 9, 9, 9, 9, 9,
    ]);
    // Your tier comes from your own faction's power.
    expect(sortFaction("warrior", P(27, 123, 0))).toEqual({ key: "warrior", tier: 9 });
    expect(sortFaction("mage", P(27, 123, 0))).toEqual({ key: "mage", tier: 3 });
    expect(sortFaction(null, P(27, 123, 0))).toEqual({ key: null, tier: 0 });
  });

  test("the head drops only for a member on a PvP-X map", () => {
    expect(deathHead("mage", true)).toBe("Mage's Head");
    expect(deathHead("warrior", true)).toBe("Warrior's Head");
    expect(deathHead("adventurer", true)).toBe("Adventurer's Head");
    expect(deathHead("adventurer", false)).toBeNull();
    expect(deathHead(null, true)).toBeNull();
  });

  test("exile on the post-penalty HPmax: Mage < 50, Warrior < 60, Adventurer < 40", () => {
    expect(exileAtDeath({ key: "mage", count: 9 }, 49)).toBe(
      "*** You have been exiled from the Mage faction due to your downfalls in battle.",
    );
    expect(exileAtDeath({ key: "mage", count: 9 }, 50)).toBeNull();
    expect(exileAtDeath({ key: "adventurer", count: 9 }, 39)).toBe(
      "*** You have been exiled from the Adventurer's faction due to your downfalls in battle.",
    );
    expect(exileAtDeath({ key: "adventurer", count: 9 }, 40)).toBeNull();
    expect(exileAtDeath({ key: null, count: 0 }, 1)).toBeNull();
  });

  test("bug fixed: the Warriors take no one below their exile line of 60", () => {
    expect(joinFaction({ key: null, count: 0 }, F("warrior"), 55, "Bob")).toEqual({
      membership: { key: null, count: 0 },
      line: 'Trianus says "You need more experience to join us."',
      announce: null,
    });
    expect(joinRefusal({ key: null, count: 0 }, F("warrior"), 59)).toBe(
      'Trianus says "You need more experience to join us."',
    );
    const j = joinFaction({ key: null, count: 0 }, F("warrior"), 60, "Bob");
    expect(j.membership).toEqual({ key: "warrior", count: 212000 });
    expect(exileAtDeath(j.membership, 60)).toBeNull();
  });

  test("no faction's join line is below its exile line", () => {
    for (const f of socialData.factions) {
      expect(f.joinHpMaxAbove + 1).toBeGreaterThanOrEqual(f.exileHpMaxBelow);
    }
  });

  test("joinRefusal: members and fit newcomers pass; the weak and other factions' members are refused", () => {
    expect(joinRefusal({ key: null, count: 0 }, F("mage"), 50)).toBeNull();
    expect(joinRefusal({ key: "mage", count: 5 }, F("mage"), 3)).toBeNull();
    expect(joinRefusal({ key: null, count: 0 }, F("mage"), 49)).toBe(
      'Angela says "You need more experience to join us."',
    );
    expect(joinRefusal({ key: "warrior", count: 5 }, F("mage"), 90)).toBe(
      'Angela says "We could use someone like you in our faction."',
    );
  });

  test("joining needs HPmax > 49; rejoining adds 212000 with no HP check", () => {
    expect(joinFaction({ key: null, count: 0 }, F("mage"), 50, "Bob")).toEqual({
      membership: { key: "mage", count: 212000 },
      line: 'Angela says "Welcome to the Mage faction."',
      announce: "*** The Mage faction has become stronger thanks to Bob.",
    });
    expect(joinFaction({ key: null, count: 0 }, F("mage"), 49, "Bob")).toEqual({
      membership: { key: null, count: 0 },
      line: 'Angela says "You need more experience to join us."',
      announce: null,
    });
    expect(joinFaction({ key: "mage", count: 5 }, F("mage"), 3, "Bob")).toEqual({
      membership: { key: "mage", count: 212005 },
      line: 'Angela says "I hope that you will be with us for years to come."',
      announce: "*** The Mage faction has become stronger thanks to Bob.",
    });
    // Another faction's member: nothing changes, but the Mages' announcement says "Mage's".
    expect(joinFaction({ key: "warrior", count: 5 }, F("mage"), 90, "Bob")).toEqual({
      membership: { key: "warrior", count: 5 },
      line: 'Angela says "We could use someone like you in our faction."',
      announce: "*** The Mage's faction has become stronger thanks to Bob.",
    });
    expect(joinFaction({ key: "mage", count: 5 }, F("adventurer"), 90, "Bob").line).toBe(
      'Corin says "You should see the light and join us."',
    );
  });

  test("loyalty: the warnings at 20000, 10000, 5000 and the kick at 1", () => {
    expect(loyaltyStep({ key: "mage", count: 20001 })).toEqual({
      count: 20000,
      text: "*** Angela requests you bring her the head of a rival faction member.",
      kicked: false,
    });
    expect(loyaltyStep({ key: "warrior", count: 10001 }).text).toBe(
      "*** If you wish to continue to server the Warriors, see Trianus immediately.",
    );
    expect(loyaltyStep({ key: "adventurer", count: 5001 }).text).toBe(
      "*** You will soon be kicked out of the Adventurers if you do not bring the head of a rival faction member to Corin.",
    );
    expect(loyaltyStep({ key: "mage", count: 2 })).toEqual({
      count: 0,
      text: "*** You have been kicked out of the Mage faction due to lack of loyalty.",
      kicked: true,
    });
    expect(loyaltyStep({ key: "mage", count: 500 })).toEqual({
      count: 499,
      text: null,
      kicked: false,
    });
  });

  test("turn-in: own head wasted; a rival head moves 1 power when the rival has any", () => {
    expect(headTurnIn("Angela", "Mage's Head", P(27, 123, 0))).toEqual({
      kind: "own",
      line: "Angela says \"A fallen member...I'll be sure to dispose of this so that our rivals don't see our weakness.\"",
    });
    expect(headTurnIn("Angela", "Warrior's Head", P(27, 123, 0))).toEqual({
      kind: "rival",
      line: 'Angela says "You have done well in slaying one of our foes."',
      powers: P(28, 122, 0),
      leader: F("mage"),
      join: true,
    });
    // The rival at 0 moves nothing, but the join still runs.
    const r = headTurnIn("Trianus", "adventurer's Head", P(27, 123, 0));
    expect(r).toMatchObject({
      kind: "rival",
      powers: P(27, 123, 0),
      leader: F("warrior"),
      join: true,
    });
    expect(headTurnIn("Smithy", "Mage's Head", P(1, 1, 1)).kind).toBe("notHead");
    expect(headTurnIn("Corin", "Sword", P(1, 1, 1)).kind).toBe("notHead");
    // A head is its faction's head item, exactly: 1.6 read any item containing " Head".
    expect(headTurnIn("Corin", "Mage's Head Bust", P(1, 1, 1)).kind).toBe("notHead");
  });

  test("bug fixed: faction leader lines close their quote", () => {
    expect(sayFaction("Angela", P(27, 123, 0))).toBe('Angela says "Our power is fine...for now."');
    expect(sayFaction("Trianus", P(27, 123, 0))).toBe(
      'Trianus says "We are currently in absolute power."',
    );
    expect(sayFaction("Corin", P(27, 123, 0))).toBe(
      'Corin says "We are very weak, I fear that we may be destroyed."',
    );
    // A tie for highest is not absolute power.
    expect(sayFaction("Corin", P(5, 5, 5))).toBe('Corin says "Our power is fine...for now."');
    expect(sayFaction("Smithy", P(1, 2, 3))).toBeNull();
  });

  test("the keyword lines", () => {
    expect(asksAboutFaction("who is in power?")).toBe(true);
    expect(asksAboutFaction("STATUS?")).toBe(true);
    expect(asksAboutFaction("power")).toBe(false);
    expect(asksForQuest("quest please")).toBe(true);
    expect(asksForQuest("Do you have a quest?")).toBe(true);
    expect(asksForQuest("a quest")).toBe(false);
  });

  test("the murder lines name the victim and the administrator", () => {
    expect(wantedLine("Bob")).toBe("*** You are now wanted for the murder of Bob.");
    expect(pardonedLine("King")).toBe("*** You have been pardoned by King.");
    expect(pardoningLine("Alice")).toBe("Pardoning Alice...");
  });
});

const bag = (...lines: [string, number][]): Bag => {
  const b = emptyBag();
  lines.forEach(([item, qty], i) => {
    b[i] = { item, qty };
  });
  return b;
};

describe("quests", () => {
  test("the archive's lines, padded to 40; Dantan's Water Orb line is gone (bug fixed)", () => {
    const lines = archivedQuestLines();
    expect(lines.length).toBe(40);
    expect(lines.slice(0, 7)).toEqual([
      "Edwin:scroll:Airship Deed",
      "Stephie:Fishle:Yellow Potion",
      ":Steel Key:Trumpet",
      "Missie:Dragon Wing:Knight Shield",
      "James:tom tom:trumpet",
      "Girl:trumpet:Ruby Ring",
      "",
    ]);
  });

  test("bug fixed: quest lines match the NPC and item exactly, and the first match wins", () => {
    const lines = archivedQuestLines();
    expect(questMatch(lines, "Stephie", "Fish")).toBeNull();
    expect(questMatch(lines, "stephie", "fishle")).toEqual({ index: 1, reward: "Yellow Potion" });
    expect(questMatch(lines, "Stephie", "Corn")).toBeNull();
    // "Girl" is not "Missie"'s line, nor "James" a part of another name.
    expect(questMatch(lines, "Gi", "trumpet")).toBeNull();
    const twice = [...lines];
    twice[9] = "Stephie:Fishle:Katana";
    expect(questMatch(twice, "Stephie", "Fishle")).toEqual({ index: 1, reward: "Yellow Potion" });
    // The archive's nameless line answers to nobody.
    expect(questMatch(lines, "", "Steel Key")).toBeNull();
  });

  test("bug fixed: the item comes off the slot you gave from, which keeps its name", () => {
    const b = bag(["Gold Fish", 3], ["Fish", 2]);
    expect(questTake(b, 1)).toBe(1);
    expect(b[0]).toEqual({ item: "Gold Fish", qty: 3 });
    expect(b[1]).toEqual({ item: "Fish", qty: 1 });
    const c = bag(["Scroll", 1]);
    expect(questTake(c, 0)).toBe(0);
    expect(c[0]).toBeNull();
    expect(questTake(c, 0)).toBe(-1);
  });

  test("bug fixed: the reward stacks on its exact name, keeping the stack's spelling, else the lowest empty slot", () => {
    const b = bag(["Apple", 1], ["Golden Trumpet", 1], ["trumpet", 2]);
    expect(questReward(b, "Trumpet")).toBe(2);
    expect(b[2]).toEqual({ item: "trumpet", qty: 3 });
    expect(b[1]).toEqual({ item: "Golden Trumpet", qty: 1 });
    expect(questReward(b, "Katana")).toBe(3);
    expect(b[3]).toEqual({ item: "Katana", qty: 1 });
  });

  test("bug fixed: a reward to a full bag has no room unless the given stack empties", () => {
    const b: Bag = Array.from({ length: 15 }, (_v, i) => ({ item: `Thing ${i}`, qty: 2 }));
    expect(questRoom(b, 4, "Katana")).toBe(false);
    expect(questRoom(b, 4, "Thing 9")).toBe(true);
    b[4] = { item: "Thing 4", qty: 1 };
    expect(questRoom(b, 4, "Katana")).toBe(true);
    questTake(b, 4);
    expect(questReward(b, "Katana")).toBe(4);
  });

  test("bug fixed: FindNewQuest always names an NPC, each named one equally likely", () => {
    expect(findNewQuest(seq(1, 1, 1))).toBe("Water God:Dragon Wing:Fire Key");
    // random(43) over the named NPCs: 29 is the NPC after 1.6's empty roll 29.
    expect(findNewQuest(seq(29, 10, 19))).toBe("Divela:Scroll:Purple Potion");
    expect(findNewQuest(seq(38, 9, 9))).toBe("Kanta:Silver Token:Trumpet");
    const names = new Set<string>();
    for (let n = 1; n <= 43; n++) {
      const npc = findNewQuest(seq(n, 1, 1)).split(":")[0] ?? "";
      expect(npc).not.toBe("");
      names.add(npc);
    }
    expect(names.size).toBe(43);
    expect(questLineUnanswerable(":Steel Key:Trumpet")).toBe(true);
    expect(questLineUnanswerable("Edwin:scroll:Airship Deed")).toBe(false);
    expect(questLineUnanswerable("")).toBe(false);
  });

  test("bug fixed: no quest asks for or gives an item nobody can get", () => {
    const pools = content().quests.pools;
    for (const p of [...pools.wanted, ...pools.rewards]) {
      expect(["Damaged Helm", "Water Orb", "Ocarina", "Scimitar"]).not.toContain(p.item);
    }
    expect(pools.wanted.map((p) => p.roll)).toEqual(pools.wanted.map((_, i) => i + 1));
    expect(pools.rewards.map((p) => p.roll)).toEqual(pools.rewards.map((_, i) => i + 1));
    // A stored line that asks for or gives one is rolled again at start.
    expect(questLineUnanswerable("Dantan:Water Orb:Plate Boots")).toBe(true);
    expect(questLineUnanswerable("Divela:Scroll:Scimitar")).toBe(true);
    expect(questLineUnanswerable("Divela:Scroll:Katana")).toBe(false);
  });

  test("bug fixed: every quest reply is heard by the map, closes its quote and ends its sentence", () => {
    const lines = archivedQuestLines();
    expect(sayQuest(lines, ["Stephie", "", "Smithy", "Edwin"])).toEqual([
      { text: 'Stephie says "Bring me a Fishle quickly and I\'ll reward you."', to: "map" },
      { text: 'Smithy says "Sorry but I don\'t need anything right now."', to: "map" },
      { text: 'Edwin says "Bring me a scroll quickly and I\'ll reward you."', to: "map" },
    ]);
    // A name inside another's line text is not that NPC's quest.
    expect(sayQuest(lines, ["Steel"])).toEqual([
      { text: 'Steel says "Sorry but I don\'t need anything right now."', to: "map" },
    ]);
  });

  test("a quest NPC asks for a renamed item by the name players see", () => {
    const before = content();
    const items = structuredClone(before.items);
    const fishle = items.items.find((i) => i.name === "Fishle");
    if (fishle) {
      fishle.display = "Spotted Fishle";
    }
    try {
      installContent(buildContentStore({ ...before, items }));
      expect(sayQuest(archivedQuestLines(), ["Stephie"])[0]?.text).toBe(
        'Stephie says "Bring me a Spotted Fishle quickly and I\'ll reward you."',
      );
    } finally {
      installContent(before);
    }
  });
});
