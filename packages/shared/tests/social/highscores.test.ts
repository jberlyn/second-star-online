/**
 * The High Score Statue's ranking.
 */
import { describe, expect, test } from "bun:test";

import { socialData } from "@secondstaronline/data";

import {
  type AssassinEntry,
  bioScore,
  highScorePoints,
  rankHighScore,
  SCORES_SIZE,
  scoresBlock,
  skillIndex,
} from "../../src/index.ts";

const e = (name: string, points: number): AssassinEntry => ({ id: name, name, points });

describe("high scores", () => {
  test("the points are the bio score: its listed skills, HPmax and SPmax", () => {
    const skills = Array.from({ length: 38 }, () => 0);
    skills[skillIndex("Slash")] = 3;
    skills[skillIndex("Cooking")] = 4;
    skills[skillIndex("Fire")] = 7;
    expect(highScorePoints(skills, 20, 10)).toBe(3 + 4 + 7 + 20 + 10);
    expect(highScorePoints(skills, 20, 10)).toBe(bioScore(skills, 20, 10));
  });

  test("no cap: a five-digit score counts", () => {
    const skills = Array.from({ length: 38 }, () => 0);
    skills[skillIndex("Slash")] = 20000;
    const points = highScorePoints(skills, 0, 0);
    expect(points).toBe(20000);
    expect(rankHighScore([e("Bob", 40)], e("Big", points))).toEqual([
      e("Big", 20000),
      e("Bob", 40),
    ]);
  });

  test("rankHighScore places ties right after the tied slot and keeps a higher existing score", () => {
    // Bob 40, Alice 30: Alice at 40 ties Bob and ranks right after Bob.
    expect(rankHighScore([e("Bob", 40), e("Alice", 30)], e("Alice", 40), SCORES_SIZE)).toEqual([
      e("Bob", 40),
      e("Alice", 40),
    ]);
    // Alice alone at 50: a lower or equal score never replaces her higher entry.
    expect(rankHighScore([e("Alice", 50)], e("Alice", 20), SCORES_SIZE)).toBeNull();
    expect(rankHighScore([e("Alice", 50)], e("Alice", 50), SCORES_SIZE)).toBeNull();
    // The table keeps ten.
    const full = Array.from({ length: 10 }, (_, k) => e(`P${k}`, 100 - k * 10));
    const out = rankHighScore(full, e("New", 55), SCORES_SIZE);
    expect(out?.length).toBe(10);
    expect(out?.[5]?.name).toBe("New");
    // Tying the 10th entry when full does not displace it.
    expect(rankHighScore(full, e("New", 10), SCORES_SIZE)).toBeNull();
  });

  test("scoresBlock: one chat entry, header with 25 spaces, four per line, empty slots 'N.  -  points'", () => {
    expect(scoresBlock([e("Alice", 10), e("Bob", 5)])).toBe(
      `\n${" ".repeat(25)}Top FSO Player Scores\n\n` +
        "1. Alice - 10 points      2. Bob - 5 points      3.  -  points      4.  -  points\n" +
        "5.  -  points      6.  -  points      7.  -  points      8.  -  points\n" +
        "9.  -  points      10.  -  points",
    );
  });
});

describe("the high-score data", () => {
  test("the statue's layout", () => {
    expect(socialData.highScores.header).toBe(`${" ".repeat(25)}Top FSO Player Scores`);
    expect(socialData.highScores.tableSize).toBe(10);
  });
});
