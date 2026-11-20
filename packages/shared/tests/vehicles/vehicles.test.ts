import { describe, expect, test } from "bun:test";

import {
  boardCheck,
  boardingHull,
  DEFAULT_HULL_RULES,
  deedCheck,
  hullMax,
  isDock,
  layer1Tile,
  ownerName,
  sunkText,
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
  test("a J2 pad on rows 10-12 counts for building and unboarding", () => {
    for (const y of [10, 11, 12]) {
      const layer1 = pad(5, y);
      expect(layer1Tile(layer1, 5, y)).toBe("J2");
      expect(isDock(layer1, 5, y)).toBe(true);
      expect(deedCheck({ ...base, layer1, faced: { x: 5, y } })).toEqual({ kind: "build" });
    }
    expect(isDock(pad(5, 9), 5, 9)).toBe(true);
    expect(isDock(pad(5, 9, "j2"), 5, 9)).toBe(true);
    expect(isDock(pad(5, 12, "j2"), 5, 12)).toBe(true);
    expect(layer1Tile(pad(5, 12), 5, 0)).toBe("");
    expect(layer1Tile(pad(5, 12), 5, 13)).toBe("");
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
  test("a pad on rows 10-12 lets you off", () => {
    for (const y of [10, 11, 12]) {
      expect(unboardCheck({ ...base, me: { x: 5, y }, layer1: pad(5, y) })).toEqual({
        kind: "park",
      });
    }
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

describe("hulls", () => {
  test("SSO: a vehicle never damaged, or parked before hulls, boards full", () => {
    expect(boardingHull({ hull: null, parkedAt: null }, 80, 0, 1)).toBe(80);
  });
  test("SSO: a parked hull regains repairPerMinute for each whole minute, up to full", () => {
    const parked = { hull: 50, parkedAt: 1_000_000 };
    expect(boardingHull(parked, 80, 1_000_000 + 59_999, 1)).toBe(50);
    expect(boardingHull(parked, 80, 1_000_000 + 10 * 60_000 + 59_999, 1)).toBe(60);
    expect(boardingHull(parked, 80, 1_000_000 + 600 * 60_000, 1)).toBe(80);
    expect(boardingHull(parked, 80, 1_000_000 + 600 * 60_000, 0)).toBe(50);
  });
  test("SSO: a hull above a lowered full hull is cut to it", () => {
    expect(boardingHull({ hull: 70, parkedAt: 0 }, 40, 0, 1)).toBe(40);
  });
  test("SSO: the full hull comes from the rules", () => {
    expect(hullMax("Airship", DEFAULT_HULL_RULES)).toBe(80);
    expect(hullMax("Airship", { ...DEFAULT_HULL_RULES, airship: 120 })).toBe(120);
  });
  test("SSO: the shot-down line names the attacker when there is one", () => {
    expect(sunkText("Bob", "Airship", "Ann")).toBe(
      "*** Bob's airship was shot down by Ann. Bob fell from the sky.",
    );
    expect(sunkText("Bob", "Airship", null)).toBe(
      "*** Bob's airship was shot down. Bob fell from the sky.",
    );
  });
});
