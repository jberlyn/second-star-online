/** The Assassin's game. */
import { describe, expect, test } from "bun:test";

import {
  ARCHIVED_PRIZES,
  type AssassinEntry,
  clickGate,
  combatRating,
  compareAss,
  ctrlGate,
  endLines,
  killPoints,
  prizeLineOk,
  prizesGiven,
  rankEntry,
  STATUE_PAUSE,
  STATUE_TEXT,
  scoreLine,
  scoring,
  skillIndex,
  startLines,
  statueBlock,
} from "../../src/index.ts";

const e = (name: string, points: number): AssassinEntry => ({ id: name, name, points });

describe("ratings and points", () => {
  test("the combat rating is sixteen combat skills plus HPmax", () => {
    const skills = Array.from({ length: 38 }, () => 1);
    expect(combatRating(skills, 50)).toBe(66);
    // Skills outside the sum (Cooking, Mining, Block, Sorcery …) add nothing.
    const only = Array.from({ length: 38 }, () => 0);
    for (const s of ["Cooking", "Mining", "Block", "Sorcery", "Lumberjacking", "BlackArts"]) {
      only[skillIndex(s)] = 100;
    }
    expect(combatRating(only, 40)).toBe(40);
  });

  test("CompareAss: a stronger killer is paid from the victim's band", () => {
    expect(compareAss(500, 100)).toBe(10);
    expect(compareAss(500, 149)).toBe(10);
    expect(compareAss(500, 150)).toBe(15);
    expect(compareAss(900, 399)).toBe(25);
    expect(compareAss(900, 599)).toBe(30);
    expect(compareAss(900, 799)).toBe(40);
    expect(compareAss(1200, 999)).toBe(50);
    expect(compareAss(1500, 1299)).toBe(60);
    expect(compareAss(1900, 1799)).toBe(70);
  });

  test("CompareAss: a weaker killer is paid from its own band", () => {
    expect(compareAss(100, 2000)).toBe(20);
    expect(compareAss(200, 2000)).toBe(30);
    expect(compareAss(350, 2000)).toBe(40);
    expect(compareAss(500, 2000)).toBe(50);
    expect(compareAss(700, 2000)).toBe(70);
    expect(compareAss(900, 2000)).toBe(80);
    expect(compareAss(1200, 2000)).toBe(90);
    expect(compareAss(1799, 2000)).toBe(100);
  });

  test("kept bug: equal ratings, or a deciding rating of 1800 or more, pay the victim's raw rating", () => {
    expect(compareAss(300, 300)).toBe(300);
    expect(compareAss(2500, 1800)).toBe(1800);
    expect(compareAss(1800, 1900)).toBe(1900);
  });

  test("Lightning pays 10 for any kill; a game runs only in GO or LIGHTNING", () => {
    expect(killPoints("LIGHTNING", 100, 2000)).toBe(10);
    expect(killPoints("GO", 100, 2000)).toBe(20);
    expect(scoring("GO")).toBe(true);
    expect(scoring("LIGHTNING")).toBe(true);
    expect(scoring("STOP")).toBe(false);
  });
});

describe("the tables", () => {
  test("an empty table takes the first score; a higher score goes first, a lower one between", () => {
    const one = rankEntry([], e("Alice", 10));
    expect(one).toEqual([e("Alice", 10)]);
    expect(rankEntry([e("Alice", 10)], e("Bob", 25))).toEqual([e("Bob", 25), e("Alice", 10)]);
    expect(rankEntry([e("Bob", 40), e("Alice", 10)], e("Carol", 20))).toEqual([
      e("Bob", 40),
      e("Carol", 20),
      e("Alice", 10),
    ]);
  });

  test("kept bug: a score equal to any entry never ranks, even with empty slots below", () => {
    expect(rankEntry([e("Alice", 10)], e("Bob", 10))).toBeNull();
    expect(rankEntry([e("Alice", 30), e("Bob", 20)], e("Carol", 20))).toBeNull();
  });

  test("kept bug: a tied score leaves the player's old entry (Bob 40, Alice 30 → Alice 40 is not written)", () => {
    expect(rankEntry([e("Bob", 40), e("Alice", 30)], e("Alice", 40))).toBeNull();
  });

  test("the player's own entry is blanked and counts 0: a new total moves it up", () => {
    expect(rankEntry([e("Bob", 40), e("Alice", 30)], e("Alice", 50))).toEqual([
      e("Alice", 50),
      e("Bob", 40),
    ]);
    expect(rankEntry([e("Bob", 40), e("Alice", 30), e("Carol", 5)], e("Alice", 35))).toEqual([
      e("Bob", 40),
      e("Alice", 35),
      e("Carol", 5),
    ]);
  });

  test("only the top 10 are kept", () => {
    const table = Array.from({ length: 10 }, (_, k) => e(`P${k}`, 100 - k * 5));
    const out = rankEntry(table, e("New", 99));
    expect(out).toHaveLength(10);
    expect(out?.[1]).toEqual(e("New", 99));
    expect(out?.at(-1)).toEqual(e("P8", 60));
    expect(rankEntry(table, e("Low", 1))).toBeNull();
  });
});

describe("texts", () => {
  test("the starts and the score line", () => {
    expect(startLines("GO")).toEqual([
      "*** The Assassin's Game has begun!",
      "*** Kill everyone in sight to become the greatest assassin ever!",
    ]);
    expect(startLines("LIGHTNING")).toEqual([
      "*** The Lightning Assassin's Game has begun!",
      "*** Kill everyone in sight to become the greatest assassin ever!",
      "*** 1 hit is 1 kill and all death penalties are OFF!",
    ]);
    expect(scoreLine("Alice", 10)).toBe("*** Alice just received 10 assassin points!");
  });

  test("the end: three winners", () => {
    expect(endLines([e("Alice", 40), e("Bob", 30), e("Carol", 10)])).toEqual([
      "*** The assassin's game has ended!!!",
      "*** Alice has won first place with 40 points!",
      "*** Bob has won second place and Carol has come in third.",
      "*** Check back soon for yet another assassin's game.",
    ]);
  });

  test("the end: a missing second and third print blank, as in 1.6", () => {
    expect(endLines([e("Alice", 10)])[2]).toBe("***  has won second place and  has come in third.");
  });

  test("the end with nobody scored prints no winners", () => {
    expect(endLines([])).toEqual([
      "*** The assassin's game has ended!!!",
      "*** Check back soon for yet another assassin's game.",
    ]);
  });

  test("the Statue: its line and pause", () => {
    expect(STATUE_TEXT).toBe("You view the top Assassins of FSO...");
    expect(STATUE_PAUSE).toBe(20);
    expect(clickGate("Assassin Statue", 1)).toEqual({ kind: "statue" });
    expect(ctrlGate("Assassin Statue")).toEqual({ kind: "statue" });
  });

  test("the Statue's blocks: four entries a line, empty ones as 'N.  -  points'", () => {
    expect(statueBlock("current", [e("Alice", 10), e("Bob", 5)])).toBe(
      "\n                         Current Top Assassins\n\n" +
        "1. Alice - 10 points      2. Bob - 5 points      3.  -  points      4.  -  points\n" +
        "5.  -  points      6.  -  points      7.  -  points      8.  -  points\n" +
        "9.  -  points      10.  -  points",
    );
    expect(
      statueBlock("allTime", [e("Alice", 1)])
        .split("\n")
        .slice(0, 4),
    ).toEqual([
      "",
      "                        * Top All-Time Assassins *",
      "",
      "1. Alice - 1 points      2.  -  points      3.  -  points      4.  -  points",
    ]);
  });
});

describe("prizes and commands", () => {
  test("the archive's prizes; 1-3 given, a blank stops the rest, the fourth is never given", () => {
    expect(ARCHIVED_PRIZES).toEqual(["Long Sword", "1000 Gold", "500 Gold", "Knife"]);
    expect(prizesGiven(ARCHIVED_PRIZES)).toEqual(["Long Sword", "1000 Gold", "500 Gold"]);
    expect(prizesGiven(["Long Sword", "", "500 Gold", "Knife"])).toEqual(["Long Sword"]);
  });

  test("a prize line is an item, a fixture, '<n> Gold' or blank", () => {
    expect(prizeLineOk("")).toBe(true);
    expect(prizeLineOk("long sword")).toBe(true);
    expect(prizeLineOk("1000 Gold")).toBe(true);
    expect(prizeLineOk("0 Gold")).toBe(false);
    expect(prizeLineOk("Excalibur")).toBe(false);
  });
});
