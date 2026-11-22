/** Goldens for buddies, bios, profiles and medals. */
import { describe, expect, test } from "bun:test";

import { classicData } from "@secondstaronline/data/classic";

const { social: socialData } = classicData;

import {
  type BioSource,
  BUDDY_MAX,
  BUDDY_TEXT,
  bioScore,
  bioTitle,
  buddyAdd,
  buddyRemove,
  buddyString,
  drawProfile,
  effectiveStats,
  friendsAtEntry,
  friendsDelete,
  friendsLogoff,
  friendsLogon,
  giveBio,
  heldMedals,
  medalBonus,
  medalField,
  medalStrip,
  newMedalLines,
  parseFriends,
  saveProfile,
  skillIndex,
} from "../../src/index.ts";

const skills = (set: Record<string, number> = {}) => {
  const s: number[] = Array(38).fill(0);
  for (const [k, v] of Object.entries(set)) {
    s[skillIndex(k)] = v;
  }
  return s;
};

describe("buddies", () => {
  test("the four texts verbatim", () => {
    expect(BUDDY_TEXT.added("Bob")).toBe("*** Bob was added to your friend's list.");
    expect(BUDDY_TEXT.already("Bob")).toBe("*** Bob is already on your friend's list!");
    expect(BUDDY_TEXT.removed("Bob")).toBe("*** Bob was removed from your friend's list.");
    expect(BUDDY_TEXT.notOn("Bob")).toBe("*** Bob is not on your friend's list!");
    expect(BUDDY_TEXT.title).toBe("Friends");
  });

  test("/friends uses only word 3; anything else is swallowed", () => {
    expect(parseFriends("/friends add Bob Smith")).toEqual({ kind: "add", name: "Bob" });
    expect(parseFriends("/friends REMOVE bob")).toEqual({ kind: "remove", name: "bob" });
    expect(parseFriends("/friends")).toBeNull();
    expect(parseFriends("/friends add")).toBeNull();
    expect(parseFriends("/friends list Bob")).toBeNull();
  });

  test("adding a buddy: a case-blind `contains`, yourself allowed", () => {
    expect(buddyString([])).toBe(":");
    const a = buddyAdd([], "Bob");
    expect(a).toEqual({
      items: ["Bob"],
      line: "*** Bob was added to your friend's list.",
      ask: true,
    });
    expect(buddyString(a.items)).toBe(":Bob:");
    expect(buddyAdd(a.items, "BOB")).toEqual({
      items: ["Bob"],
      line: "*** BOB is already on your friend's list!",
      ask: false,
    });
  });

  test("divergence: the list holds 199 names; an add past that is refused", () => {
    expect(BUDDY_MAX).toBe(199);
    const many = Array.from({ length: 198 }, (_, i) => `P${i}`);
    const last = buddyAdd(many, "Zed");
    expect(last.items).toHaveLength(199);
    expect(buddyAdd(last.items, "Amy")).toEqual({
      items: last.items,
      line: "Your friends list is full.",
      ask: false,
    });
    // A name with colons adds several items: refused whole when they would pass the cap.
    expect(buddyAdd(many, "a:b").line).toBe("Your friends list is full.");
    expect(buddyAdd(many.slice(1), "a:b").items).toHaveLength(199);
  });

  test("bug fixed: any name on the list can be removed, the 190th and later too", () => {
    const list = Array.from({ length: BUDDY_MAX }, (_, i) => `P${i + 1}`);
    const first = buddyRemove(list, "p189");
    expect(first.line).toBe("*** p189 was removed from your friend's list.");
    expect(first.items).toHaveLength(BUDDY_MAX - 1);
    expect(first.items).not.toContain("P189");
    for (const name of ["P190", "P199"]) {
      const r = buddyRemove(list, name);
      expect(r.removed).toBe(true);
      expect(r.line).toBe(`*** ${name} was removed from your friend's list.`);
      expect(r.items).toEqual(list.filter((n) => n !== name));
    }
    expect(buddyRemove(list, "Nobody")).toEqual({
      items: list,
      line: "*** Nobody is not on your friend's list!",
      removed: false,
    });
  });

  test("bug fixed: a removal keeps every other name, in order, past the 199th too", () => {
    const list = Array.from({ length: 205 }, (_, i) => `P${i + 1}`);
    const r = buddyRemove(list, "P1");
    expect(r.items).toHaveLength(204);
    expect(r.items[0]).toBe("P2");
    expect(r.items.at(-1)).toBe("P205");
  });

  test("the window: entry from everyone online in the server's order and spelling", () => {
    expect(friendsAtEntry(["bob", "zed", "alice"], ["Alice", "Bob", "Carol"])).toEqual([
      "Alice",
      "Bob",
    ]);
    const online = Array.from({ length: 205 }, (_, i) => `P${i + 1}`);
    expect(friendsAtEntry(["P201", "P5"], online)).toEqual(["P5"]);
  });

  test("the window: logon appends a buddy once, logoff deletes it", () => {
    expect(friendsLogon(["Alice"], ["bob"], "Bob")).toEqual(["Alice", "Bob"]);
    expect(friendsLogon(["Alice", "Bob"], ["bob"], "Bob")).toEqual(["Alice", "Bob"]);
    expect(friendsLogon(["Alice"], ["bob"], "Carol")).toEqual(["Alice"]);
    expect(friendsLogoff(["Alice", "Bob"], ["bob"], "Bob")).toEqual(["Alice"]);
    expect(friendsLogoff(["Alice", "Bob"], [], "Bob")).toEqual(["Alice", "Bob"]);
    // The deletion loop skips the line that moves up.
    expect(friendsDelete(["Bob", "bob", "Cy"], "BOB")).toEqual(["bob", "Cy"]);
  });
});

const base: BioSource = {
  name: "Bob",
  sex: 1,
  level: 7,
  profile: "Hello there",
  medals: "39-31-",
  skills: skills(),
  hpMax: 40,
  spMax: 25,
  guild: null,
  faction: 0,
  wanted: false,
  body: null,
  tree: false,
  bodyItem: "",
  inVehicle: false,
};

describe("bios", () => {
  test("the title table: strict >, the last true row wins", () => {
    expect(bioTitle(skills())).toBe("Adventurer");
    expect(bioTitle(skills({ Cooking: 10 }))).toBe("Adventurer");
    expect(bioTitle(skills({ Cooking: 11 }))).toBe("Apprentice Cook");
    expect(bioTitle(skills({ Fishing: 91 }))).toBe("Master Baiter");
    // Later rows win: Archery > 30 comes after Slash > 45.
    expect(bioTitle(skills({ Slash: 50, Archery: 31 }))).toBe("Apprentice Archer");
    expect(bioTitle(skills({ Slash: 61, Swordsmanship: 51 }))).toBe("Swordsman");
    expect(bioTitle(skills({ Slash: 61, Swordsmanship: 51, Thrust: 51 }))).toBe("Jouster");
    expect(bioTitle(skills({ Fencing: 81, Slash: 81, Swordsmanship: 91 }))).toBe(
      "Master Swordsman",
    );
    expect(bioTitle(skills({ Magery: 81, Sorcery: 61, UnholyCombat: 61 }))).toBe("Death Knight");
    expect(bioTitle(skills({ Magery: 95, Archery: 96 }))).toBe("Master Archer");
  });

  test("bug fixed: the score counts every listed skill, HPmax and SPmax", () => {
    const s = skills({
      Slash: 10,
      Lumberjacking: 50,
      Archery: 50,
      Punch: 50,
      Fire: 7,
      Wind: 3,
      Cooking: 5,
    });
    expect(bioScore(s, 40, 25)).toBe(10 + 50 + 50 + 50 + 7 + 3 + 5 + 40 + 25);
    // Every skill counts once.
    const all = skills();
    for (const name of socialData.bios.score.counted) {
      if (name !== "HPmax" && name !== "SPmax") {
        all[skillIndex(name)] = 1;
      }
    }
    expect(bioScore(all, 0, 0)).toBe(all.filter((v) => v === 1).length);
    expect(new Set(socialData.bios.score.counted).size).toBe(socialData.bios.score.counted.length);
  });

  test("the reply's items and the viewer's lines", () => {
    const items = giveBio({
      ...base,
      guild: { name: "Knights", leader: true },
      faction: 1,
      wanted: true,
    });
    expect(items).toEqual([
      "Bob Star",
      "Adventurer",
      "1",
      "7",
      "Hello there",
      "",
      "39-31-",
      "65",
      "Leader of the Knights",
      "Loyal to the Mages",
      "Vile Murderer",
    ]);
    expect(drawProfile(items, "Alice")).toEqual({
      title: "Bob Star",
      bio: [
        "Name: Bob Star",
        "Class: Adventurer",
        "Sex: Male",
        "Score: 65",
        "Leader of the Knights",
        "Loyal to the Mages",
        "Vile Murderer",
      ],
      profile: "Hello there",
      medals: ["39", "31"],
      own: false,
    });
    expect(drawProfile(items, "bob").own).toBe(true);
  });

  test("a member, the Warriors and Adventurers, and empty lines left out", () => {
    const d = drawProfile(
      giveBio({ ...base, sex: 2, guild: { name: "Knights", leader: false }, faction: 2 }),
      "Bob",
    );
    expect(d.bio).toEqual([
      "Name: Bob Star",
      "Class: Adventurer",
      "Sex: Female",
      "Score: 65",
      "Member of the Knights",
      "Loyal to the Warriors",
    ]);
    expect(drawProfile(giveBio({ ...base, faction: 3 }), "x").bio.at(-1)).toBe(
      "Loyal to the Adventurers",
    );
  });

  test("disguises: a tree is A Tree, then the Robe out of a vehicle wins; both hide the rest", () => {
    const tree = drawProfile(giveBio({ ...base, tree: true, wanted: true }), "Bob");
    expect(tree).toEqual({
      title: "A Tree",
      bio: ["Name: A Tree", "Class: ", "Sex: ", "Score: "],
      profile: "",
      medals: [],
      own: false,
    });
    const robe = giveBio({ ...base, tree: true, bodyItem: "Robe of Invisibility" });
    expect(robe[0]).toBe("????");
    expect(drawProfile(robe, "Bob").bio).toEqual(["Name: ????", "Class: ", "Sex: ", "Score: "]);
    // In a vehicle the Robe hides nothing.
    expect(giveBio({ ...base, bodyItem: "Robe of Invisibility", inVehicle: true })[0]).toBe(
      "Bob Star",
    );
  });

  test("bug fixed: each bio clears all 14 slots and draws from slot 1", () => {
    const blank = socialData.bios.medalStrip.blankMember;
    const member = (id: number) => socialData.medals.awards.find((a) => a.id === id)?.member;
    const twelve = ["39", "31", "94", "95", "93", "35", "61", "44", "45", "91", "92", "20"];
    const first = medalStrip(twelve);
    expect(first).toHaveLength(14);
    expect(first[0]).toBe(member(39));
    expect(first[11]).toBe(member(20));
    expect(first.slice(12)).toEqual([blank, blank]);
    const second = medalStrip(["21"]);
    expect(second[0]).toBe(member(21));
    expect(second.slice(1)).toEqual(Array(13).fill(blank));
  });
});

describe("SaveProfile", () => {
  test("bug fixed: periods and semicolons are kept", () => {
    expect(saveProfile("I like fish. And chips; really..")).toEqual({
      profile: "I like fish. And chips; really..",
      alert: null,
    });
  });

  test("bug fixed: any colon or slash refuses the save, none is silently removed", () => {
    for (const text of ["a:b", "a::b", "a:b/c"]) {
      expect(saveProfile(text)).toEqual({
        profile: null,
        alert: "You can't have a : in your profile!",
      });
    }
    for (const text of ["http/x", "http//x"]) {
      expect(saveProfile(text)).toEqual({
        profile: null,
        alert: "You can't have a / in your profile!",
      });
    }
  });

  test("capped at 500 characters", () => {
    expect(saveProfile("x".repeat(600)).profile).toHaveLength(500);
  });
});

describe("calculated medals", () => {
  test("every medal at 90: its id in the field and its points in the bonus", () => {
    for (const a of socialData.medals.awards) {
      const sk = skills({ [a.skill]: 90 });
      expect(medalField(sk)).toBe(`${a.id}-`);
      expect(medalBonus(sk)).toEqual(a.stats);
    }
  });

  test("90 or more holds a medal, 89 does not", () => {
    expect(medalField(skills({ Cooking: 100 }))).toBe("39-");
    expect(medalField(skills({ Cooking: 91 }))).toBe("39-");
    expect(medalField(skills({ Cooking: 89 }))).toBe("");
    expect(medalBonus(skills({ Cooking: 89 }))).toEqual({});
  });

  test("several at once, in the table's order, their points summed", () => {
    const sk = skills({ Slash: 90, Cooking: 90, Blacksmithing: 95 });
    expect(heldMedals(sk).map((a) => a.id)).toEqual([39, 95, 92]);
    expect(medalField(sk)).toBe("39-95-92-");
    expect(medalBonus(sk)).toEqual({ sta: 3, str: 3 });
  });

  test("the stats played with are the allocated stats plus the bonus; the input is untouched", () => {
    const stats = { str: 20, sta: 10, dex: 5, int: 5, wis: 5 };
    const sk = skills({ Blacksmithing: 90 });
    // Class 1 (Fighter) has no points of its own.
    expect(effectiveStats(stats, 1, sk)).toEqual({ ...stats, str: 22, sta: 12 });
    expect(stats.str).toBe(20);
    expect(effectiveStats(stats, 1, skills({ Blacksmithing: 89 }))).toEqual(stats);
  });

  test("a line prints only for a medal newly held", () => {
    expect(newMedalLines(skills({ Cooking: 89 }), skills({ Cooking: 90 }))).toEqual([
      "You have been awarded the silver spatula for being a master chef!",
    ]);
    expect(newMedalLines(skills({ Cooking: 90 }), skills({ Cooking: 95 }))).toEqual([]);
    expect(newMedalLines(skills({ Cooking: 95 }), skills({ Cooking: 50 }))).toEqual([]);
  });
});
