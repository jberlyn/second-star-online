import { describe, expect, test } from "bun:test";

import { STEPFRAMES_PER_FRAME } from "../../src/constants.ts";
import {
  advanceStep,
  applyOutcome,
  attemptMove,
  blockPCCheck,
  edgeWrap,
  isWebBody,
  monsterSpriteTile,
  resolveHeld,
  STEP_FRAMES,
  stepLengthFor,
  stepOffsetPx,
  type Walker,
  type WalkWorld,
  walkFrame,
} from "../../src/rules/movement/movement.ts";

const open: WalkWorld = {
  walkable: () => true,
  pcBlocked: () => false,
  itemBlocks: () => false,
  webAt: () => false,
};
const walker = (x = 5, y = 5): Walker => ({ x, y, facing: "N", stepFrames: 0 });

describe("step timing", () => {
  test("a step takes 16 frames and moves the logical tile at once", () => {
    const w = walker();
    const o = attemptMove(w, "R", false, open);
    expect(o).toEqual({ kind: "step", facing: "E", fromX: 5, fromY: 5, toX: 6, toY: 5 });
    applyOutcome(w, o);
    expect(w).toEqual({ x: 6, y: 5, facing: "E", stepFrames: 16 });
    expect(STEP_FRAMES).toBe(16);
  });

  test("a held arrow walks at a steady 16-frame cadence with no gap", () => {
    const w = walker();
    const starts: number[] = [];
    for (let frame = 1; frame <= 64; frame++) {
      advanceStep(w); // stepFrame runs before the frame script
      const o = attemptMove(w, "R", false, open);
      if (o.kind === "step") {
        starts.push(frame);
        applyOutcome(w, o);
      }
    }
    expect(starts).toEqual([1, 17, 33, 49]);
  });

  test("walk frames F1,–,F2,–,F3,–,F2,–,F1,–,F2,–,F3,–,F2,–", () => {
    // After the n-th animated frame of a step, stepFrames = 16 - n.
    const shown = Array.from({ length: 16 }, (_, i) => walkFrame(STEP_FRAMES - (i + 1)));
    expect(shown).toEqual([
      "F1",
      "F1",
      "F2",
      "F2",
      "F3",
      "F3",
      "F2",
      "F2",
      "F1",
      "F1",
      "F2",
      "F2",
      "F3",
      "F3",
      "F2",
      "F2",
    ]);
    expect(walkFrame(0)).toBe("F2"); // standing
  });

  test("the sprite moves 2 px per frame, 32 px per step", () => {
    expect(stepOffsetPx(16)).toBe(0);
    expect(stepOffsetPx(15)).toBe(2);
    expect(stepOffsetPx(1)).toBe(30);
    expect(stepOffsetPx(0)).toBe(0);
  });

  test("no new step while one is in progress", () => {
    const w = { ...walker(), stepFrames: 3 };
    expect(attemptMove(w, "L", false, open)).toEqual({ kind: "none" });
  });
});

describe("operator setting stepFrames (walk speed is an operator setting)", () => {
  test("8-frame steps: a held arrow steps every 8 frames, 4 px per frame", () => {
    const w = walker();
    const starts: number[] = [];
    for (let frame = 1; frame <= 32; frame++) {
      advanceStep(w);
      const o = attemptMove(w, "R", false, open);
      if (o.kind === "step") {
        starts.push(frame);
        applyOutcome(w, o, 8);
      }
    }
    expect(starts).toEqual([1, 9, 17, 25]);
    expect(stepOffsetPx(7, 8)).toBe(4);
    expect(stepOffsetPx(1, 8)).toBe(28);
  });

  test("8-frame walk cycle F1,–,F2,–,F3,–,F2,– as the Airship's 8-frame step", () => {
    const shown = Array.from({ length: 8 }, (_, i) => walkFrame(8 - (i + 1), 8));
    expect(shown).toEqual(["F1", "F1", "F2", "F2", "F3", "F3", "F2", "F2"]);
  });
});

describe("diagonal priority", () => {
  test("one direction per frame, Left > Right > Up > Down", () => {
    expect(resolveHeld({ L: true, U: true })).toBe("L");
    expect(resolveHeld({ R: true, U: true, D: true })).toBe("R");
    expect(resolveHeld({ U: true, D: true })).toBe("U");
    expect(resolveHeld({ D: true })).toBe("D");
    expect(resolveHeld({ L: true, R: true })).toBe("L");
    expect(resolveHeld({})).toBeNull();
  });
});

describe("turn in place", () => {
  test("Alt + arrow turns without stepping, only when standing", () => {
    expect(attemptMove(walker(), "D", true, open)).toEqual({ kind: "turn", facing: "S" });
    expect(attemptMove({ ...walker(), stepFrames: 5 }, "D", true, open)).toEqual({ kind: "none" });
  });
});

describe("collision", () => {
  test("an unwalkable tile turns you to face it and stops you", () => {
    const world: WalkWorld = {
      walkable: (x) => x !== 6,
      pcBlocked: () => false,
      itemBlocks: () => false,
      webAt: () => false,
    };
    expect(attemptMove(walker(), "R", false, world)).toEqual({
      kind: "blocked",
      facing: "E",
      by: "tile",
    });
  });

  test("a pc block faces the walker and stops", () => {
    const world: WalkWorld = { ...open, pcBlocked: (x, y) => x === 5 && y === 4 };
    expect(attemptMove(walker(), "U", false, world)).toEqual({
      kind: "blocked",
      facing: "N",
      by: "pc",
    });
  });

  test("pcBlocked is asked about x = 18: a block stops the edge crossing at the right edge", () => {
    const asked: [number, number][] = [];
    const world: WalkWorld = {
      ...open,
      pcBlocked: (x, y) => {
        asked.push([x, y]);
        return x === 18;
      },
    };
    expect(attemptMove(walker(17, 4), "R", false, world)).toEqual({
      kind: "blocked",
      facing: "E",
      by: "pc",
    });
    expect(asked).toEqual([[18, 4]]);
  });

  test("an item block faces the walker and stops", () => {
    const world: WalkWorld = { ...open, itemBlocks: (x, y) => x === 6 && y === 5 };
    expect(attemptMove(walker(), "R", false, world)).toEqual({
      kind: "blocked",
      facing: "E",
      by: "item",
    });
  });

  test("item block comes before the web: on a web facing a fixture → blocked by item", () => {
    const world: WalkWorld = {
      ...open,
      webAt: (x, y) => x === 5 && y === 5,
      itemBlocks: (x, y) => x === 6 && y === 5,
    };
    expect(attemptMove(walker(), "R", false, world)).toEqual({
      kind: "blocked",
      facing: "E",
      by: "item",
    });
  });

  test("a pc block comes before the item block", () => {
    const world: WalkWorld = {
      ...open,
      pcBlocked: (x) => x === 6,
      itemBlocks: (x) => x === 6,
    };
    expect(attemptMove(walker(), "R", false, world)).toMatchObject({ by: "pc" });
  });

  test("mid-step is still none whatever blocks", () => {
    const world: WalkWorld = { ...open, pcBlocked: () => true, itemBlocks: () => true };
    expect(attemptMove({ ...walker(), stepFrames: 4 }, "R", false, world)).toEqual({
      kind: "none",
    });
  });

  test("a player on the target, moving or not, is the world's pcBlocked", () => {
    // The caller passes every other player at its logical tile; see the server movement tests
    // for a player mid-step.
    const world: WalkWorld = { ...open, pcBlocked: (x, y) => x === 5 && y === 4 };
    expect(attemptMove(walker(), "U", false, world)).toMatchObject({ kind: "blocked", by: "pc" });
  });
});

describe("edge wrap", () => {
  test("x 18/0 and y 13/0 wrap to 1/17 and 1/12 and move the map by one", () => {
    expect(edgeWrap(18, 4)).toEqual({ toX: 1, toY: 4, dmx: 1, dmy: 0 });
    expect(edgeWrap(0, 4)).toEqual({ toX: 17, toY: 4, dmx: -1, dmy: 0 });
    expect(edgeWrap(3, 13)).toEqual({ toX: 3, toY: 1, dmx: 0, dmy: 1 });
    expect(edgeWrap(3, 0)).toEqual({ toX: 3, toY: 12, dmx: 0, dmy: -1 });
  });

  test("crossing an edge leaves the wrapped tile to the server, which knows the next map", () => {
    const nothingWalkable: WalkWorld = {
      walkable: () => false,
      pcBlocked: () => false,
      itemBlocks: () => true,
      webAt: () => false,
    };
    expect(attemptMove(walker(17, 4), "R", false, nothingWalkable)).toEqual({
      kind: "edge",
      facing: "E",
      toX: 1,
      toY: 4,
      dmx: 1,
      dmy: 0,
    });
  });
});

describe("Airship step length", () => {
  test("the Airship step is 8 calls against 16 on foot", () => {
    expect(stepLengthFor("Airship")).toBe(8);
    expect(stepLengthFor(null)).toBe(16);
  });

  test("sprite moves 4 px per frame on foot, 8 aboard an Airship", () => {
    // Two `stepFrame` calls a frame: the walker's counter after each whole frame.
    const px = (len: number, frames: number) =>
      stepOffsetPx(len - frames * STEPFRAMES_PER_FRAME, len);
    expect([1, 2, 3].map((f) => px(16, f))).toEqual([4, 8, 12]);
    expect(px(16, 7)).toBe(28);
    expect(px(16, 8)).toBe(0); // arrived: the sprite stands on the next tile
    expect([1, 2, 3].map((f) => px(8, f))).toEqual([8, 16, 24]);
    expect(px(8, 4)).toBe(0); // an Airship tile in 4 frames
  });

  test("walk frames over one tile are F1 F2 F3 F2 F1 F2 F3 F2", () => {
    const shown: string[] = [];
    for (let f = 1; f <= 8; f++) {
      shown.push(walkFrame(16 - f * STEPFRAMES_PER_FRAME, 16));
    }
    expect(shown).toEqual(["F1", "F2", "F3", "F2", "F1", "F2", "F3", "F2"]);
  });
});

describe("web", () => {
  const webbed: WalkWorld = { ...open, webAt: (x, y) => x === 5 && y === 5 };

  test("web: a web on my own tile stops the step, no facing change", () => {
    const w = walker();
    const o = attemptMove(w, "R", false, webbed);
    expect(o).toEqual({ kind: "web" });
    applyOutcome(w, o);
    expect(w).toEqual({ x: 5, y: 5, facing: "N", stepFrames: 0 });
  });

  test("web: checked after the player block and the mid-step test", () => {
    const blocked: WalkWorld = { ...webbed, pcBlocked: (x, y) => x === 6 && y === 5 };
    expect(attemptMove(walker(), "R", false, blocked)).toEqual({
      kind: "blocked",
      facing: "E",
      by: "pc",
    });
    const mid: Walker = { ...walker(), stepFrames: 4 };
    expect(attemptMove(mid, "R", false, webbed)).toEqual({ kind: "none" });
  });

  test("web: checked before the edge wrap", () => {
    const edgeWeb: WalkWorld = { ...open, webAt: (x, y) => x === 17 && y === 5 };
    expect(attemptMove(walker(17, 5), "R", false, edgeWeb)).toEqual({ kind: "web" });
  });

  test("web: turn-in-place still turns", () => {
    expect(attemptMove(walker(), "R", true, webbed)).toEqual({ kind: "turn", facing: "E" });
  });

  test("web: a web on the next tile does not block", () => {
    const ahead: WalkWorld = { ...open, webAt: (x, y) => x === 6 && y === 5 };
    expect(attemptMove(walker(), "R", false, ahead).kind).toBe("step");
  });

  test('isWebBody: 92 is a web; 90, 99, 9 are not ("92-" in the member name)', () => {
    expect(isWebBody(92)).toBe(true);
    expect(isWebBody(90)).toBe(false);
    expect(isWebBody(99)).toBe(false);
    expect(isWebBody(9)).toBe(false);
  });
});

describe("blockPCCheck", () => {
  const at = (x: number, y: number) => ({ x, y });
  const none = { name: null, at: null };
  const slot = (name: string | null, x?: number, y?: number) => ({
    name,
    at: x === undefined || y === undefined ? null : at(x, y),
  });

  test("a standing player on the target blocks", () => {
    expect(blockPCCheck(5, 5, [at(5, 5)], [none, none, none, none])).toBe(true);
    expect(blockPCCheck(5, 5, [at(6, 5)], [none, none, none, none])).toBe(false);
  });

  test("a monster at the target blocks; none elsewhere", () => {
    expect(blockPCCheck(5, 5, [], [slot("Slime", 5, 5), none, none, none])).toBe(true);
    expect(blockPCCheck(5, 5, [], [slot("Slime", 6, 5), none, none, none])).toBe(false);
    expect(blockPCCheck(5, 5, [], [slot("Slime", 4, 5), none, none, none])).toBe(false);
  });

  for (const name of ["Overlord", "Mutant Worm", "overlord"]) {
    test(`${name} blocks x+1 and x+2 on its row, not the row above`, () => {
      const s = [slot(name, 5, 5), none, none, none];
      expect(blockPCCheck(5, 5, [], s)).toBe(true);
      expect(blockPCCheck(6, 5, [], s)).toBe(true);
      expect(blockPCCheck(7, 5, [], s)).toBe(true);
      expect(blockPCCheck(8, 5, [], s)).toBe(false);
      expect(blockPCCheck(6, 4, [], s)).toBe(false);
      expect(blockPCCheck(4, 5, [], s)).toBe(false);
    });
  }

  test("bug fixed: only an Overlord or Mutant Worm itself is three wide, in any slot", () => {
    const lowerFirst = [slot("Slime", 5, 5), slot("Overlord", 9, 9), none, none];
    expect(blockPCCheck(6, 5, [], lowerFirst)).toBe(false);
    const higher = [slot("Overlord", 9, 9), slot("Slime", 5, 5), none, none];
    expect(blockPCCheck(5, 5, [], higher)).toBe(true);
    expect(blockPCCheck(6, 5, [], higher)).toBe(false);
    expect(blockPCCheck(7, 5, [], higher)).toBe(false);
    expect(blockPCCheck(10, 9, [], higher)).toBe(true);
  });

  test("bug fixed: a remembered dead Overlord in slot 1 does not widen slot 2", () => {
    const s = [slot("Overlord"), slot("Slime", 5, 5), none, none];
    expect(blockPCCheck(6, 5, [], s)).toBe(false);
    expect(blockPCCheck(7, 5, [], s)).toBe(false);
  });

  test("bug fixed: a Web or Holy Shield never blocks but clears nothing else", () => {
    expect(blockPCCheck(9, 9, [], [slot("Web", 9, 9), none, none, none])).toBe(false);
    expect(blockPCCheck(9, 9, [], [none, slot("Holy Shield", 9, 9), none, none])).toBe(false);
    const s = [slot("Slime", 5, 5), slot("Web", 9, 9), none, none];
    expect(blockPCCheck(5, 5, [], s)).toBe(true);
    expect(blockPCCheck(6, 6, [at(6, 6)], s)).toBe(true);
  });

  test("bug fixed: a remembered dead Holy Shield clears no player", () => {
    expect(blockPCCheck(5, 5, [at(5, 5)], [slot("Holy Shield"), none, none, none])).toBe(true);
  });

  test("bug fixed: a Web does not clear an Overlord's three-wide block", () => {
    const s = [slot("Overlord", 5, 5), slot("Web", 9, 9), none, none];
    expect(blockPCCheck(6, 5, [], s)).toBe(true);
    expect(blockPCCheck(7, 5, [], s)).toBe(true);
  });

  test("a live monster whose name was never shown blocks its own tile only", () => {
    expect(blockPCCheck(5, 5, [], [slot(null, 5, 5), none, none, none])).toBe(true);
    expect(blockPCCheck(6, 5, [], [slot(null, 5, 5), none, none, none])).toBe(false);
  });

  test("a null name and a null position never block or clear", () => {
    expect(blockPCCheck(5, 5, [], [none, none, none, none])).toBe(false);
    expect(blockPCCheck(5, 5, [at(5, 5)], [none, none, none, none])).toBe(true);
  });
});

describe("monsterSpriteTile", () => {
  test("standing → its tile; step just begun (16) → start tile; 1-15 → none", () => {
    expect(monsterSpriteTile(6, 5, 5, 5, 0)).toEqual({ x: 6, y: 5 });
    expect(monsterSpriteTile(6, 5, 5, 5, 16)).toEqual({ x: 5, y: 5 });
    expect(monsterSpriteTile(6, 5, 5, 5, 15)).toBeNull();
    expect(monsterSpriteTile(6, 5, 5, 5, 1)).toBeNull();
  });
});
