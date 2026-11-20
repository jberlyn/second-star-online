/** Factions, the murder flag's lines and quests. */
import { describe, expect, test } from "bun:test";

import { socialData } from "@secondstaronline/data";

import {
  ARCHIVED_POWERS,
  archivedQuestLines,
  asksAboutFaction,
  asksForQuest,
  type Bag,
  deathHead,
  emptyBag,
  exileAtDeath,
  factionBonus,
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
  wantedLine,
} from "../../src/index.ts";

const seq = (...rolls: number[]): Rng => ({ random: () => rolls.shift() ?? 1 });

describe("factions", () => {
  test("the archive's powers are 27:123:0", () => {
    expect(ARCHIVED_POWERS).toEqual([27, 123, 0]);
  });

  test("bug fixed: the faction bonus cascade's last true row wins, and 200 or more gives 9", () => {
    expect([0, 4, 5, 9, 10, 27, 79, 80, 89, 90, 123, 199, 200, 500].map(factionBonus)).toEqual([
      0, 0, 1, 1, 2, 3, 8, 9, 9, 9, 9, 9, 9, 9,
    ]);
    // Only your own faction's bonus is set.
    expect(sortFaction(2, [27, 123, 0])).toEqual({ id: 2, f1Bonus: 0, f2Bonus: 9, f3Bonus: 0 });
    expect(sortFaction(1, [27, 123, 0])).toEqual({ id: 1, f1Bonus: 3, f2Bonus: 0, f3Bonus: 0 });
    expect(sortFaction(0, [27, 123, 0])).toEqual({ id: 0, f1Bonus: 0, f2Bonus: 0, f3Bonus: 0 });
  });

  test("the head drops only for a member on a PvP-X map", () => {
    expect(deathHead(1, true)).toBe("Mage's Head");
    expect(deathHead(2, true)).toBe("Warrior's Head");
    expect(deathHead(3, true)).toBe("Adventurer's Head");
    expect(deathHead(3, false)).toBeNull();
    expect(deathHead(0, true)).toBeNull();
  });

  test("exile on the post-penalty HPmax: Mage < 50, Warrior < 60, Adventurer < 40", () => {
    expect(exileAtDeath({ id: 1, count: 9 }, 49)).toBe(
      "*** You have been exiled from the Mage faction due to your downfalls in battle.",
    );
    expect(exileAtDeath({ id: 1, count: 9 }, 50)).toBeNull();
    expect(exileAtDeath({ id: 3, count: 9 }, 39)).toBe(
      "*** You have been exiled from the Adventurer's faction due to your downfalls in battle.",
    );
    expect(exileAtDeath({ id: 3, count: 9 }, 40)).toBeNull();
    expect(exileAtDeath({ id: 0, count: 0 }, 1)).toBeNull();
  });

  test("bug fixed: the Warriors take no one below their exile line of 60", () => {
    expect(joinFaction({ id: 0, count: 0 }, 2, 55, "Bob")).toEqual({
      membership: { id: 0, count: 0 },
      line: 'Trianus says "You need more experience to join us."',
      announce: null,
    });
    expect(joinRefusal({ id: 0, count: 0 }, 2, 59)).toBe(
      'Trianus says "You need more experience to join us."',
    );
    const j = joinFaction({ id: 0, count: 0 }, 2, 60, "Bob");
    expect(j.membership).toEqual({ id: 2, count: 212000 });
    expect(exileAtDeath(j.membership, 60)).toBeNull();
  });

  test("no faction's join line is below its exile line", () => {
    for (const f of socialData.factions) {
      expect(f.joinHpMaxAbove + 1).toBeGreaterThanOrEqual(f.exileHpMaxBelow);
    }
  });

  test("joinRefusal: members and fit newcomers pass; the weak and other factions' members are refused", () => {
    expect(joinRefusal({ id: 0, count: 0 }, 1, 50)).toBeNull();
    expect(joinRefusal({ id: 1, count: 5 }, 1, 3)).toBeNull();
    expect(joinRefusal({ id: 0, count: 0 }, 1, 49)).toBe(
      'Angela says "You need more experience to join us."',
    );
    expect(joinRefusal({ id: 2, count: 5 }, 1, 90)).toBe(
      'Angela says "We could use someone like you in our faction."',
    );
  });

  test("joining needs HPmax > 49; rejoining adds 212000 with no HP check", () => {
    expect(joinFaction({ id: 0, count: 0 }, 1, 50, "Bob")).toEqual({
      membership: { id: 1, count: 212000 },
      line: 'Angela says "Welcome to the Mage faction."',
      announce: "*** The Mage faction has become stronger thanks to Bob.",
    });
    expect(joinFaction({ id: 0, count: 0 }, 1, 49, "Bob")).toEqual({
      membership: { id: 0, count: 0 },
      line: 'Angela says "You need more experience to join us."',
      announce: null,
    });
    expect(joinFaction({ id: 1, count: 5 }, 1, 3, "Bob")).toEqual({
      membership: { id: 1, count: 212005 },
      line: 'Angela says "I hope that you will be with us for years to come."',
      announce: "*** The Mage faction has become stronger thanks to Bob.",
    });
    // Another faction's member: nothing changes, but the Mages' announcement says "Mage's".
    expect(joinFaction({ id: 2, count: 5 }, 1, 90, "Bob")).toEqual({
      membership: { id: 2, count: 5 },
      line: 'Angela says "We could use someone like you in our faction."',
      announce: "*** The Mage's faction has become stronger thanks to Bob.",
    });
    expect(joinFaction({ id: 1, count: 5 }, 3, 90, "Bob").line).toBe(
      'Corin says "You should see the light and join us."',
    );
  });

  test("loyalty: the warnings at 20000, 10000, 5000 and the kick at 1", () => {
    expect(loyaltyStep({ id: 1, count: 20001 })).toEqual({
      count: 20000,
      text: "*** Angela requests you bring her the head of a rival faction member.",
      kicked: false,
    });
    expect(loyaltyStep({ id: 2, count: 10001 }).text).toBe(
      "*** If you wish to continue to server the Warriors, see Trianus immediately.",
    );
    expect(loyaltyStep({ id: 3, count: 5001 }).text).toBe(
      "*** You will soon be kicked out of the Adventurers if you do not bring the head of a rival faction member to Corin.",
    );
    expect(loyaltyStep({ id: 1, count: 2 })).toEqual({
      count: 0,
      text: "*** You have been kicked out of the Mage faction due to lack of loyalty.",
      kicked: true,
    });
    expect(loyaltyStep({ id: 1, count: 500 })).toEqual({ count: 499, text: null, kicked: false });
  });

  test("turn-in: own head wasted; a rival head moves 1 power when the rival has any", () => {
    expect(headTurnIn("Angela", "Mage's Head", [27, 123, 0])).toEqual({
      kind: "own",
      line: "Angela says \"A fallen member...I'll be sure to dispose of this so that our rivals don't see our weakness.\"",
    });
    expect(headTurnIn("Angela", "Warrior's Head", [27, 123, 0])).toEqual({
      kind: "rival",
      line: 'Angela says "You have done well in slaying one of our foes."',
      powers: [28, 122, 0],
      leader: 1,
      join: true,
    });
    // The rival at 0 moves nothing, but the join still runs.
    const r = headTurnIn("Trianus", "adventurer's Head", [27, 123, 0]);
    expect(r).toMatchObject({ kind: "rival", powers: [27, 123, 0], leader: 2, join: true });
    expect(headTurnIn("Smithy", "Mage's Head", [1, 1, 1]).kind).toBe("notHead");
    expect(headTurnIn("Corin", "Sword", [1, 1, 1]).kind).toBe("notHead");
  });

  test("bug fixed: faction leader lines close their quote", () => {
    expect(sayFaction("Angela", [27, 123, 0])).toBe('Angela says "Our power is fine...for now."');
    expect(sayFaction("Trianus", [27, 123, 0])).toBe(
      'Trianus says "We are currently in absolute power."',
    );
    expect(sayFaction("Corin", [27, 123, 0])).toBe(
      'Corin says "We are very weak, I fear that we may be destroyed."',
    );
    // A tie for highest is not absolute power.
    expect(sayFaction("Corin", [5, 5, 5])).toBe('Corin says "Our power is fine...for now."');
    expect(sayFaction("Smithy", [1, 2, 3])).toBeNull();
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
  test("the archive's seven lines, padded to 40", () => {
    const lines = archivedQuestLines();
    expect(lines.length).toBe(40);
    expect(lines.slice(0, 7)).toEqual([
      "Edwin:scroll:Airship Deed",
      "Stephie:Fishle:Yellow Potion",
      ":Steel Key:Trumpet",
      "Missie:Dragon Wing:Knight Shield",
      "James:tom tom:trumpet",
      "Girl:trumpet:Ruby Ring",
      "Dantan:Water Orb:Plate Boots",
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
    expect(findNewQuest(seq(29, 13, 20))).toBe("Divela:Scroll:Scimitar");
    expect(findNewQuest(seq(38, 12, 9))).toBe("Kanta:Silver Token:Trumpet");
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
});
