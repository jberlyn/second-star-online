/** Golden tests for the arena challenge's rules. */
import { describe, expect, test } from "bun:test";

import {
  ARENA_TEXT,
  type ArenaRecord,
  arenaExits,
  challengeCheck,
  findArenaTile,
  isArenaTile,
  parseChatLine,
  pickArenaExit,
  quitCheck,
  type Rng,
  recordHasArena,
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
const record = (l: string[][], signs = ["", "", ""], title = ""): ArenaRecord => ({
  layers: l,
  signs,
  title,
});
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

describe("check 3, the map record", () => {
  test("check 3 reads ' 6P ' anywhere in the record, ignoring case", () => {
    const l = layers(
      () => "G1",
      (x, y) => (x === 5 && y === 11 ? "6p" : "G3"),
    );
    expect(recordHasArena(record(l))).toBe(true);
    expect(
      recordHasArena(
        record(
          layers(() => "G1"),
          ["a 6P b", "", ""],
        ),
      ),
    ).toBe(true);
    expect(
      recordHasArena(
        record(
          layers(() => "G1"),
          ["", "", ""],
          "the 6P pit",
        ),
      ),
    ).toBe(true);
    expect(recordHasArena(record(layers(() => "G1")))).toBe(false);
  });

  test("kept bug: a 6P only in column 1 or 17 is not an arena", () => {
    expect(recordHasArena(record(layers(at([[1, 3]]))))).toBe(false);
    expect(recordHasArena(record(layers(at([[17, 3]]))))).toBe(false);
    expect(recordHasArena(record(layers(at([[2, 3]]))))).toBe(true);
  });
});

describe("the challenge checks", () => {
  const l = layers(at([[4, 4]]));
  const base = { layer1: l[0] as string[], x: 8, y: 8, record: record(l) };

  test("the challenge checks in order: stand still, already in battle, not an arena", () => {
    expect(challengeCheck({ ...base, stepFrames: 3, x: 4, y: 4 })).toEqual({
      kind: "text",
      text: "You should stand still before making a challenge.",
    });
    expect(challengeCheck({ ...base, stepFrames: 0, x: 4, y: 4 })).toEqual({
      kind: "text",
      text: "You are already in a battle!!",
    });
    expect(challengeCheck({ ...base, stepFrames: 0, record: record(layers(() => "G1")) })).toEqual({
      kind: "text",
      text: "This is not an arena!",
    });
    expect(challengeCheck({ ...base, stepFrames: 0 })).toEqual({ kind: "go" });
    expect(ARENA_TEXT.entered("Bob")).toBe("Bob has entered the arena!");
    expect(ARENA_TEXT.stopped("Bob")).toBe("Bob has stopped fighting.");
    expect(ARENA_TEXT.defeated("Bob", "Ann")).toBe("Bob was defeated by Ann.");
  });

  test("quit is silent off a 6P tile, and its stand-still text comes first", () => {
    const q = { layer1: l[0] as string[], x: 8, y: 8 };
    expect(quitCheck({ ...q, stepFrames: 2 })).toEqual({
      kind: "text",
      text: "You should stand still before exiting the arena.",
    });
    expect(quitCheck({ ...q, stepFrames: 0 })).toEqual({ kind: "silent" });
    expect(quitCheck({ ...q, stepFrames: 0, x: 4, y: 4 })).toEqual({ kind: "go" });
  });
});

describe("the 799 rolls", () => {
  const l1 = layers(at([[4, 4]]))[0] as string[];

  test("the 799 rolls: random(17) then random(12), first 6P wins", () => {
    const rng = scripted([1, 1, 2, 2, 4, 4, 9, 9]);
    expect(findArenaTile(l1, rng)).toEqual({ x: 4, y: 4 });
    expect(rng.calls).toEqual([17, 12, 17, 12, 17, 12]);
  });

  test("799 misses → null, the 800th roll is never made", () => {
    const rng = scripted([]);
    expect(findArenaTile(l1, rng)).toBeNull();
    expect(rng.calls).toHaveLength(799 * 2);
  });

  test("kept bug: an arena only on layers 2-S or rows 10-12 passes check 3 and is never found", () => {
    const l = layers(at([[5, 11]]), (x, y) => (x === 5 && y === 5 ? "6P" : "G3"));
    // Row 11 of layer 1 reads another field (a kept bug: 1.6 did it): never an arena tile, never
    // found.
    expect(isArenaTile(l[0] as string[], 5, 11)).toBe(false);
    expect(recordHasArena(record(l))).toBe(true);
    const rng = scripted([5, 11]);
    expect(findArenaTile(l[0] as string[], rng)).toBeNull();
  });

  test("kept bug: one 6P tile fails about 2% of the time", () => {
    // 799 rolls over 204 record cells, one of which is the tile: 1 - (203/204)^799.
    const fail = (203 / 204) ** 799;
    expect(fail).toBeGreaterThan(0.019);
    expect(fail).toBeLessThan(0.021);
    // One challenge whose every roll misses finds nothing, silently.
    expect(findArenaTile(l1, scripted([]))).toBeNull();
  });
});

describe("the exit pick", () => {
  test("the exit pick: never 6P on rows 1-9 nor blocked; a 6P on rows 10-12 can be picked", () => {
    const l1 = rows(
      at([
        [3, 3],
        [6, 11],
      ]),
    );
    const blockedGrid = grid((x, y) => x === 1 && y === 1);
    const exits = arenaExits(l1, blockedGrid);
    expect(exits).toHaveLength(204 - 1 - 1); // blocked tile and the row-3 6P; the row-11 one passes
    expect(exits.some((t) => t.x === 3 && t.y === 3)).toBe(false);
    expect(exits.some((t) => t.x === 1 && t.y === 1)).toBe(false);
    expect(exits.some((t) => t.x === 6 && t.y === 11)).toBe(true);
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
    ).toEqual(
      // every row-1-9 tile is 6P; rows 10-12 pass (a kept bug)
      { x: 1, y: 10 },
    );
  });
});
