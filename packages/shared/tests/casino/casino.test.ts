/**
 * The casino's slots and high scores.
 */
import { describe, expect, test } from "bun:test";

import { casinoData } from "@secondstaronline/data";

import {
  type AssassinEntry,
  clickGate,
  ctrlGate,
  highScorePoints,
  isSlotMachine,
  rankHighScore,
  SCORES_SIZE,
  scoresBlock,
  skillIndex,
  slotOpenCheck,
  slotPayout,
  slotReels,
  slotSettle,
  submitsScore,
} from "../../src/index.ts";

/** Ctrl by a player of middling Strength away from their own premises. */
const STRANGER = { str: 50, mine: false };

const e = (name: string, points: number): AssassinEntry => ({ id: name, name, points });

describe("slots", () => {
  test("4-4-4 pays 80 and 2-3-2 pays 50; RTP 245/64 over all 64 reels", () => {
    expect(slotPayout([4, 4, 4])).toBe(80);
    expect(slotPayout([2, 3, 2])).toBe(50);
    expect(slotPayout([1, 1, 1])).toBe(20);
    expect(slotPayout([2, 2, 2])).toBe(25);
    expect(slotPayout([3, 3, 3])).toBe(30);
    expect(slotPayout([3, 4, 3])).toBe(40);
    let gross = 0;
    let wins = 0;
    for (let a = 1; a <= 4; a += 1) {
      for (let b = 1; b <= 4; b += 1) {
        for (let c = 1; c <= 4; c += 1) {
          const pay = slotPayout([a, b, c]);
          gross += pay;
          wins += pay > 0 ? 1 : 0;
        }
      }
    }
    expect(gross).toBe(245);
    expect(wins).toBe(6);
  });

  test("slotReels rolls three random(4) in order", () => {
    const seen: number[] = [];
    const rolls = [3, 1, 4];
    const reels = slotReels({
      random(n) {
        seen.push(n);
        return rolls[seen.length - 1] ?? 0;
      },
    });
    expect(seen).toEqual([4, 4, 4]);
    expect(reels).toEqual([3, 1, 4]);
  });

  test("slotSettle: charges 5, pays the gross on a win, exits on short gold", () => {
    expect(slotSettle(100, [1, 2, 3])).toEqual({ ok: true, gold: 95, win: false });
    expect(slotSettle(100, [4, 4, 4])).toEqual({ ok: true, gold: 175, win: true });
    expect(slotSettle(100, [2, 3, 2])).toEqual({ ok: true, gold: 145, win: true });
    expect(slotSettle(5, [1, 2, 3])).toEqual({ ok: true, gold: 0, win: false });
    expect(slotSettle(4, [2, 3, 2])).toEqual({ ok: false });
    expect(slotSettle(0, [1, 1, 1])).toEqual({ ok: false });
  });

  test("slotOpenCheck: facing N on the tile south, not mid-step", () => {
    const m = { x: 10, y: 10 };
    const at = (x: number, y: number, facing: "N" | "S" | "E" | "W", stepFrames = 0) =>
      slotOpenCheck({ x, y, facing, stepFrames }, m);
    expect(at(10, 11, "N")).toBe("open");
    for (const f of ["S", "E", "W"] as const) {
      expect(at(10, 11, f)).toBe("stand");
    }
    expect(at(10, 11, "N", 3)).toBe("stand");
    for (const [x, y] of [
      [10, 10],
      [10, 12],
      [9, 11],
      [11, 11],
      [9, 10],
      [11, 10],
      [10, 9],
    ] as const) {
      expect(at(x, y, "N")).toBe("stand");
    }
  });
});

describe("high scores", () => {
  test("submitsScore: 9999 sends, 10000 does not; immortals never", () => {
    expect(submitsScore(0, false)).toBe(true);
    expect(submitsScore(9999, false)).toBe(true);
    expect(submitsScore(10000, false)).toBe(false);
    expect(submitsScore(50, true)).toBe(false);
  });

  test("the points include bioScore plus the eight formerly dropped skills", () => {
    const skills = Array.from({ length: 38 }, () => 0);
    skills[skillIndex("Slash")] = 3;
    skills[skillIndex("Cooking")] = 4;
    const lost = [
      "Lumberjacking",
      "Archery",
      "Blessing",
      "Musicianship",
      "Illusion",
      "Punch",
      "fire",
      "wind",
    ] as const;
    for (const [i, name] of lost.entries()) {
      skills[skillIndex(name)] = 10 + i;
    }
    const lostSum = lost.reduce((acc, _, i) => acc + 10 + i, 0);
    expect(highScorePoints(skills, 20, 10)).toBe(3 + 4 + lostSum + 20 + 10);
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

describe("gates", () => {
  test("the High Score Statue reads from anywhere, before the header test", () => {
    expect(clickGate("High Score Statue")).toEqual({ kind: "scores" });
    expect(clickGate("High Score Statue")).toEqual({ kind: "scores" });
    expect(ctrlGate("High Score Statue", STRANGER)).toEqual({ kind: "scores" });
  });

  test("bug fixed: a click plays a casino game anywhere; Ctrl carries one off only from your own premises", () => {
    const games = [
      ["Slot Machine", "slots"],
      ["Blackjack Table", "blackjack"],
      ["Checkers Table", "checkers"],
    ] as const;
    for (const [name, game] of games) {
      expect(clickGate(name)).toEqual({ kind: "casino", game });
      expect(ctrlGate(name, STRANGER)).toEqual({ kind: "casino", game });
      expect(ctrlGate(name, { ...STRANGER, mine: true })).toEqual({ kind: "take" });
    }
    // `contains`, so a longer name routes and plays; a chest first.
    expect(isSlotMachine("Slot Machine")).toBe(true);
    expect(isSlotMachine("Slot Machine 2")).toBe(true);
    expect(isSlotMachine("Piano")).toBe(false);
    expect(ctrlGate("Slot Machine 2", STRANGER)).toEqual({ kind: "casino", game: "slots" });
    expect(ctrlGate("Slot Machine Chest", STRANGER)).toEqual({ kind: "open" });
    // The Piano says its line and is never a game.
    expect(ctrlGate("Piano", STRANGER)).toEqual({ kind: "text", text: "This is a piano." });
  });
});

describe("the casino data", () => {
  test("round-trips the slot table and the statue's layout", () => {
    expect(casinoData.slots.payouts.length).toBeGreaterThan(0);
    expect(casinoData.slots.cost).toBe(5);
    expect(casinoData.slots.spinFrames).toBe(30);
    expect(casinoData.scores.header).toBe(`${" ".repeat(25)}Top FSO Player Scores`);
    expect(casinoData.scores.tableSize).toBe(10);
  });
});
