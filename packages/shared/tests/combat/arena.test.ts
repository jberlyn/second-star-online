/** Golden tests for the arena challenge's rules. */
import { describe, expect, test } from "bun:test";

import {
  ARENA_TEXT,
  arenaExits,
  arenaTiles,
  challengeCheck,
  findArenaTile,
  hasArena,
  isArenaTile,
  parseChatLine,
  pickArenaExit,
  quitCheck,
  type Rng,
} from "../../src/index.ts";

const rows = (cell: (x: number, y: number) => string) =>
  Array.from({ length: 12 }, (_, y) =>
    Array.from({ length: 17 }, (_, x) => cell(x + 1, y + 1)).join(" "),
  );
const layers = (
  l1: (x: number, y: number) => string,
  l3: (x: number, y: number) => string = () => "G3",
) => [rows(l1), rows(() => "G3"), rows(l3), rows(() => "5A")];
const at = (tiles: [number, number][]) => (x: number, y: number) =>
  tiles.some(([tx, ty]) => tx === x && ty === y) ? "6P" : "G1";
const grid = (blocked: (x: number, y: number) => boolean) =>
  Array.from({ length: 12 }, (_, y) =>
    Array.from({ length: 17 }, (_, x) => !blocked(x + 1, y + 1)),
  );

/** Answers the queued rolls in order, then 1. */
const scripted = (rolls: number[]): Rng & { calls: number[] } => {
  const calls: number[] = [];
  return {
    calls,
    random(n) {
      calls.push(n);
      return rolls.shift() ?? 1;
    },
  };
};

describe("the parse", () => {
  test("the parse: quit and Challenge in any case, one leading space dropped, a trailing space said aloud", () => {
    expect(parseChatLine("QUIT")?.kind).toBe("arenaQuit");
    expect(parseChatLine(" quit")?.kind).toBe("arenaQuit");
    expect(parseChatLine("challenge")?.kind).toBe("arenaChallenge");
    expect(parseChatLine("Challenge")?.kind).toBe("arenaChallenge");
    for (const line of ["quit ", "  quit", "quit now", "Challenge "]) {
      expect(parseChatLine(line)?.kind).toBe("say");
    }
    expect(parseChatLine("Password=x")?.kind).toBe("password");
  });
});

describe("is it an arena", () => {
  test("a map is an arena when layer 1 has a 6P tile, ignoring case", () => {
    expect(hasArena(layers(at([[5, 5]]))[0] as string[])).toBe(true);
    expect(hasArena(layers((x, y) => (x === 5 && y === 5 ? "6p" : "G1"))[0] as string[])).toBe(
      true,
    );
    expect(hasArena(layers(() => "G1")[0] as string[])).toBe(false);
  });

  test("bug fixed: a 6P only in column 1 or 17 is an arena", () => {
    expect(hasArena(layers(at([[1, 3]]))[0] as string[])).toBe(true);
    expect(hasArena(layers(at([[17, 3]]))[0] as string[])).toBe(true);
  });

  test("bug fixed: a 6P on another layer, or 6P in a sign or title, is not an arena", () => {
    const l = layers(
      () => "G1",
      (x, y) => (x === 5 && y === 5 ? "6P" : "G3"),
    );
    expect(hasArena(l[0] as string[])).toBe(false);
    expect(
      challengeCheck({
        stepFrames: 0,
        held: false,
        dead: false,
        riding: false,
        layer1: l[0] as string[],
        x: 8,
        y: 8,
      }),
    ).toEqual({ kind: "text", text: "This is not an arena!" });
  });

  test("bug fixed: arena tiles on rows 10-12 are arena tiles", () => {
    const l1 = layers(at([[5, 11]]))[0] as string[];
    expect(isArenaTile(l1, 5, 11)).toBe(true);
    expect(hasArena(l1)).toBe(true);
    expect(arenaTiles(l1)).toEqual([{ x: 5, y: 11 }]);
  });
});

describe("the challenge checks", () => {
  const l = layers(at([[4, 4]]));
  const base = { layer1: l[0] as string[], x: 8, y: 8, held: false, dead: false, riding: false };

  test("the challenge checks in order: stand still, already in battle, not an arena", () => {
    expect(challengeCheck({ ...base, stepFrames: 3, x: 4, y: 4 })).toEqual({
      kind: "text",
      text: "You should stand still before making a challenge.",
    });
    expect(challengeCheck({ ...base, stepFrames: 0, x: 4, y: 4 })).toEqual({
      kind: "text",
      text: "You are already in a battle!!",
    });
    expect(
      challengeCheck({ ...base, stepFrames: 0, layer1: layers(() => "G1")[0] as string[] }),
    ).toEqual({
      kind: "text",
      text: "This is not an arena!",
    });
    expect(challengeCheck({ ...base, stepFrames: 0 })).toEqual({ kind: "go" });
    expect(ARENA_TEXT.entered("Bob")).toBe("Bob has entered the arena!");
    expect(ARENA_TEXT.stopped("Bob")).toBe("Bob has stopped fighting.");
    expect(ARENA_TEXT.defeated("Bob", "Ann")).toBe("Bob was defeated by Ann.");
  });

  test("bug fixed: a rider must land before making a challenge", () => {
    expect(challengeCheck({ ...base, stepFrames: 0, riding: true })).toEqual({
      kind: "text",
      text: "You must land your airship before making a challenge.",
    });
    // Moving is still said first, and the death wait stays silent.
    expect(challengeCheck({ ...base, stepFrames: 2, riding: true })).toMatchObject({
      text: "You should stand still before making a challenge.",
    });
    expect(challengeCheck({ ...base, stepFrames: 0, riding: true, dead: true })).toEqual({
      kind: "silent",
    });
  });

  test("quit is silent off a 6P tile, and its stand-still text comes first", () => {
    const q = { layer1: l[0] as string[], x: 8, y: 8, held: false, dead: false, riding: false };
    expect(quitCheck({ ...q, stepFrames: 2 })).toEqual({
      kind: "text",
      text: "You should stand still before exiting the arena.",
    });
    expect(quitCheck({ ...q, stepFrames: 0 })).toEqual({ kind: "silent" });
    expect(quitCheck({ ...q, stepFrames: 0, x: 4, y: 4 })).toEqual({ kind: "go" });
  });

  test("divergence: a rider over a 6P tile is not in the arena, so quit is silent", () => {
    const q = { layer1: l[0] as string[], held: false, dead: false, stepFrames: 0 };
    expect(quitCheck({ ...q, x: 4, y: 4, riding: false })).toEqual({ kind: "go" });
    expect(quitCheck({ ...q, x: 4, y: 4, riding: true })).toEqual({ kind: "silent" });
  });

  test("bug fixed: Hold and the death wait stop the arena words", () => {
    expect(challengeCheck({ ...base, stepFrames: 0, held: true })).toEqual({
      kind: "text",
      text: "You cannot do that while you are held.",
    });
    expect(challengeCheck({ ...base, stepFrames: 0, dead: true })).toEqual({ kind: "silent" });
    const onArena = { ...base, x: 4, y: 4, stepFrames: 0 };
    expect(quitCheck({ ...onArena, held: true })).toEqual({
      kind: "text",
      text: "You cannot do that while you are held.",
    });
    expect(quitCheck({ ...onArena, dead: true })).toEqual({ kind: "silent" });
  });
});

describe("the challenge tile", () => {
  const l1 = layers(
    at([
      [4, 4],
      [9, 2],
    ]),
  )[0] as string[];

  test("bug fixed: one uniform roll over the 6P tiles, never a silent miss", () => {
    for (const [roll, tile] of [
      [1, { x: 9, y: 2 }],
      [2, { x: 4, y: 4 }],
    ] as const) {
      const rng = scripted([roll]);
      expect(findArenaTile(l1, rng)).toEqual(tile);
      expect(rng.calls).toEqual([2]);
    }
  });

  test("bug fixed: a taken tile is never picked; every tile taken gives null", () => {
    const rng = scripted([1]);
    expect(findArenaTile(l1, rng, (x, y) => x === 9 && y === 2)).toEqual({ x: 4, y: 4 });
    expect(rng.calls).toEqual([1]);
    expect(findArenaTile(l1, scripted([]), () => true)).toBeNull();
  });
});

describe("the exit pick", () => {
  test("the exit pick: never 6P nor blocked nor taken", () => {
    const l1 = rows(
      at([
        [3, 3],
        [6, 11],
      ]),
    );
    const blockedGrid = grid((x, y) => x === 1 && y === 1);
    const exits = arenaExits(l1, blockedGrid, (x, y) => x === 2 && y === 2);
    expect(exits).toHaveLength(204 - 1 - 2 - 1); // blocked, the two 6P tiles, the taken tile
    expect(exits.some((t) => t.x === 3 && t.y === 3)).toBe(false);
    expect(exits.some((t) => t.x === 1 && t.y === 1)).toBe(false);
    expect(exits.some((t) => t.x === 6 && t.y === 11)).toBe(false);
    expect(exits.some((t) => t.x === 2 && t.y === 2)).toBe(false);
  });

  test("every passing tile can be picked, one roll", () => {
    const l1 = rows(() => "G1");
    const g = grid((x, y) => !(y === 2 && x <= 3)); // three passing tiles
    expect(arenaExits(l1, g)).toEqual([
      { x: 1, y: 2 },
      { x: 2, y: 2 },
      { x: 3, y: 2 },
    ]);
    for (const [roll, tile] of [
      [1, 1],
      [2, 2],
      [3, 3],
    ] as const) {
      const rng = scripted([roll]);
      expect(pickArenaExit(l1, g, rng)).toEqual({ x: tile, y: 2 });
      expect(rng.calls).toEqual([3]);
    }
  });

  test("divergence: no passing tile → null, where 1.6's exit loop never ended", () => {
    const rng = scripted([]);
    expect(
      pickArenaExit(
        rows(() => "G1"),
        grid(() => true),
        rng,
      ),
    ).toBeNull();
    expect(rng.calls).toEqual([]);
    expect(
      pickArenaExit(
        rows(() => "6P"),
        grid(() => false),
        rng,
      ),
    ).toBeNull();
  });
});
