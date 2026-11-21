import { describe, expect, test } from "bun:test";

import { shipWalkGrid } from "../../src/rules/core/walk.ts";
import {
  boardCheck,
  boardingHull,
  deedCheck,
  dropRefusal,
  hullMax,
  isDock,
  layer1Tile,
  ownerName,
  shipDeedCheck,
  shipUnboardCheck,
  sunkText,
  unboardCheck,
  VEHICLE_BODY,
  VEHICLE_TEXT,
  vehicleOfBody,
  vehicleOfItem,
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
  test("divergence: already aboard, a click only says whose it is", () => {
    expect(boardCheck({ ...base, vehicle: "Airship" })).toBe("see");
    expect(boardCheck({ ...base, vehicle: "Boat", isOwner: false })).toBe("see");
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
  test("SSO: an airship's full hull is 80", () => {
    expect(hullMax("Airship")).toBe(80);
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

describe("ships", () => {
  const sea = (x: number) => (x >= 8 ? "W1" : "G1");
  const l1 = Array.from({ length: 12 }, () =>
    Array.from({ length: 17 }, (_, i) => sea(i + 1)).join(" "),
  );
  test("SSO: a ship sails on sea tiles, shoreline art on layer 2 included", () => {
    const g = shipWalkGrid(l1);
    expect([g[4]?.[7], g[4]?.[6], g[0]?.[9]]).toEqual([true, false, true]);
  });
  test("bodies 55 and 56 are the Boat and the Battleship", () => {
    expect([vehicleOfBody(55), vehicleOfBody(56), vehicleOfBody(57), vehicleOfBody(58)]).toEqual([
      "Boat",
      "Battleship",
      "Airship",
      null,
    ]);
    expect(VEHICLE_BODY).toEqual({ Boat: 55, Battleship: 56, Airship: 57 });
    expect(vehicleOfItem("Ann's Battleship")).toBe("Battleship");
    expect(vehicleOfItem("Ann's Boat")).toBe("Boat");
  });
  test("the ship deed checks, in 1.6's order", () => {
    const base = {
      noun: "boat",
      stepFrames: 0,
      faced: { x: 8, y: 5 },
      shipWalkable: true,
      itemOnFaced: false,
      playerOnFaced: false,
    };
    expect(shipDeedCheck(base)).toEqual({ kind: "build" });
    expect(shipDeedCheck({ ...base, stepFrames: 2, shipWalkable: false })).toMatchObject({
      text: "Please stand still before trying to build your boat.",
    });
    expect(shipDeedCheck({ ...base, faced: { x: 18, y: 5 } })).toEqual({ kind: "silent" });
    expect(shipDeedCheck({ ...base, shipWalkable: false, itemOnFaced: true })).toMatchObject({
      text: "You have to use this boat deed over water to have your ship built!",
    });
    expect(shipDeedCheck({ ...base, playerOnFaced: true })).toMatchObject({
      text: "There's something in the way, you can't place your boat here!",
    });
  });
  test("divergence: getting off needs a tile a walker could take, not 1.6's fixed list", () => {
    const base = {
      noun: "battleship",
      stepFrames: 0,
      faced: { x: 7, y: 5 },
      footWalkable: true,
      facedTaken: false,
      itemOnMine: false,
    };
    expect(shipUnboardCheck(base)).toEqual({ kind: "park" });
    for (const bad of [{ footWalkable: false }, { facedTaken: true }, { faced: { x: 0, y: 5 } }]) {
      expect(shipUnboardCheck({ ...base, ...bad })).toEqual({
        kind: "text",
        text: "You can't get off here!",
      });
    }
    expect(shipUnboardCheck({ ...base, itemOnMine: true })).toMatchObject({
      text: "There's already something here, you can't park your battleship here!",
    });
  });
  test("SSO: a sunk ship's line, and the drop refusal at sea", () => {
    expect(sunkText("Bob", "Battleship", "Ann")).toBe(
      "*** Bob's battleship was sunk by Ann. Bob was claimed by the waters.",
    );
    expect(sunkText("Bob", "Boat", null)).toBe(
      "*** Bob's boat was sunk. Bob was claimed by the waters.",
    );
    expect(dropRefusal("Boat")).toBe("You can't drop this into the ocean!");
    expect(dropRefusal("Airship")).toBe("You can't drop this from the sky!");
    expect([hullMax("Boat"), hullMax("Battleship")]).toEqual([60, 150]);
  });
});
