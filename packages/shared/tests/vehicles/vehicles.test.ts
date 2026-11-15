import { describe, expect, test } from "bun:test";

import {
  boardCheck,
  deedCheck,
  isDock,
  ownerName,
  recordTile,
  unboardCheck,
  VEHICLE_TEXT,
  vehicleOfBody,
} from "../../src/rules/vehicles/vehicles.ts";

const row = (code: string, at: number) =>
  Array.from({ length: 17 }, (_, i) => (i + 1 === at ? code : "G1")).join(" ");
const pad = (x: number, y: number, code = "J2") =>
  Array.from({ length: 12 }, (_, i) => (i + 1 === y ? row(code, x) : row("none", 0)));

describe("airship drop checks", () => {
  const base = { stepFrames: 0, faced: { x: 5, y: 5 }, layer1: pad(5, 5), itemOnFaced: false };
  test("mid-step: stand still text, before anything else", () => {
    expect(deedCheck({ ...base, stepFrames: 3, faced: { x: 0, y: 5 } })).toEqual({
      kind: "text",
      text: "Please stand still before trying to build your airship.",
    });
  });
  test("an off-screen faced tile is silent", () => {
    for (const faced of [
      { x: 0, y: 5 },
      { x: 18, y: 5 },
      { x: 5, y: 0 },
      { x: 5, y: 13 },
    ]) {
      expect(deedCheck({ ...base, faced })).toEqual({ kind: "silent" });
    }
  });
  test("not a J2 pad: no full stop", () => {
    expect(deedCheck({ ...base, faced: { x: 6, y: 5 } })).toEqual({
      kind: "text",
      text: "You cannot build your airship here",
    });
  });
  test("an item on the faced tile", () => {
    expect(deedCheck({ ...base, itemOnFaced: true })).toEqual({
      kind: "text",
      text: "There's something in the way, you can't place airship here!",
    });
  });
  test("a pad with the way clear builds", () => {
    expect(deedCheck(base)).toEqual({ kind: "build" });
  });
  test("kept bug: a J2 pad on rows 10-12 never counts", () => {
    const layer1 = pad(5, 10);
    expect(recordTile(layer1, 5, 10)).toBe("");
    expect(isDock(layer1, 5, 10)).toBe(false);
    expect(deedCheck({ ...base, layer1, faced: { x: 5, y: 10 } })).toEqual({
      kind: "text",
      text: VEHICLE_TEXT.cannotBuild,
    });
    expect(isDock(pad(5, 9), 5, 9)).toBe(true);
    expect(isDock(pad(5, 9, "j2"), 5, 9)).toBe(true);
  });
});

describe("AirshipClick", () => {
  const base = {
    vehicle: null,
    stepFrames: 0,
    me: { x: 4, y: 5 },
    facing: "E" as const,
    item: { x: 5, y: 5 },
    isOwner: true,
  };
  test("the owner facing an adjacent airship boards", () => {
    expect(boardCheck(base)).toBe("board");
  });
  test("another player is told it is not theirs", () => {
    expect(boardCheck({ ...base, isOwner: false })).toBe("notYours");
  });
  test("facing away from it only says whose it is", () => {
    expect(boardCheck({ ...base, facing: "W" })).toBe("see");
    expect(boardCheck({ ...base, item: { x: 8, y: 5 } })).toBe("see");
  });
  test("mid-step: the airship is never on my tile, so you only see it", () => {
    expect(boardCheck({ ...base, stepFrames: 4 })).toBe("see");
  });
  test("already aboard: silent", () => {
    expect(boardCheck({ ...base, vehicle: "Airship" })).toBe("silent");
  });
  test("ownerName is the text before the first apostrophe", () => {
    expect(ownerName("Ann's Airship")).toBe("Ann");
    expect(ownerName("O'Neil's Airship")).toBe("O");
  });
});

describe("UnboardAirship", () => {
  const base = { stepFrames: 0, me: { x: 5, y: 5 }, layer1: pad(5, 5), itemOnMine: false };
  test("mid-step: unboarding is refused with the stop-moving text", () => {
    expect(unboardCheck({ ...base, stepFrames: 1 })).toEqual({
      kind: "text",
      text: VEHICLE_TEXT.stopMoving,
    });
  });
  test("my own tile must be a pad, not the faced one", () => {
    expect(unboardCheck({ ...base, me: { x: 6, y: 5 } })).toEqual({
      kind: "text",
      text: "You cannot get off here.",
    });
  });
  test("an item on my tile", () => {
    expect(unboardCheck({ ...base, itemOnMine: true })).toEqual({
      kind: "text",
      text: "There's already something here, you can't park your Airship here!",
    });
  });
  test("kept bug: a pad on row 10 never lets you off", () => {
    expect(unboardCheck({ ...base, me: { x: 5, y: 10 }, layer1: pad(5, 10) })).toEqual({
      kind: "text",
      text: VEHICLE_TEXT.cannotGetOff,
    });
  });
  test("a clear pad parks", () => {
    expect(unboardCheck(base)).toEqual({ kind: "park" });
  });
});

describe("body 57 means the Airship", () => {
  test("only 57", () => {
    expect(vehicleOfBody(57)).toBe("Airship");
    expect(vehicleOfBody(30)).toBeNull();
    expect(vehicleOfBody(null)).toBeNull();
  });
});
