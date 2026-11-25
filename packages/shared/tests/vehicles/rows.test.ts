/**
 * Vehicles as content rows (issue #44): tile sets read flags on their own layer and codes on
 * either, a row's `moves` and `lands`, what the engine reads of a row (body, step, lines, fixture,
 * picture), and deeds naming vehicles by `vehicle` or by the older `use`.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import type { VehicleRow } from "@secondstaronline/data";
import { classicData } from "@secondstaronline/data/classic";

import { buildContentStore, type ContentData, installContent } from "../../src/content/store.ts";
import { ARENA_TEXT } from "../../src/rules/combat/arena.ts";
import { engineFixtureKind } from "../../src/rules/core/fixtures.ts";
import { deedUse, deedVehicle } from "../../src/rules/housing/houses.ts";
import { blocksPlayer, groundPicture } from "../../src/rules/inventory/ground.ts";
import { stepLengthFor } from "../../src/rules/movement/movement.ts";
import {
  dropRefusal,
  padTextOf,
  sunkText,
  tileSetHas,
  vehicleCrosses,
  vehicleCrossesAt,
  vehicleLandsAt,
  vehicleOfBody,
  vehicleOfItem,
  vehicleRow,
} from "../../src/rules/vehicles/vehicles.ts";

const SKIFF: VehicleRow = {
  name: "Sand Skiff",
  picture: "Crate",
  rider: 58,
  hull: 30,
  moves: { over: { codes: ["8R"] }, except: { codes: ["S3"] } },
  boards: "shore",
};
const GLIDER: VehicleRow = {
  name: "Glider",
  display: "Old Glider",
  picture: "Crate",
  rider: 60,
  hull: 10,
  moves: { over: "any", except: { flags: ["sea"] } },
  boards: "pad",
  lands: { codes: ["8r"] },
};

beforeAll(() => {
  const d = structuredClone(classicData) as ContentData;
  d.houses.vehicles = [...(d.houses.vehicles ?? []), SKIFF, GLIDER];
  d.houses.deeds.push(
    { deed: "Skiff Deed", use: "vehicle", vehicle: "Sand Skiff", house: null, text: null },
    { deed: "Lost Deed", use: "vehicle", vehicle: "Raft", house: null, text: null },
  );
  installContent(buildContentStore(d));
});
afterAll(() => {
  installContent(buildContentStore(classicData as ContentData));
});

describe("tile sets", () => {
  test("a flag is read on its own layer, a code on either, case ignored", () => {
    // `sea` lives on layer 1, `airshipBlock` on layer 2.
    expect(tileSetHas({ flags: ["sea"] }, "W1", "G3")).toBe(true);
    expect(tileSetHas({ flags: ["sea"] }, "G1", "W1")).toBe(false);
    expect(tileSetHas({ flags: ["airshipBlock"] }, "G1", "d8")).toBe(true);
    expect(tileSetHas({ flags: ["airshipBlock"] }, "D8", "G3")).toBe(false);
    expect(tileSetHas({ codes: ["8r"] }, "8R", "G3")).toBe(true);
    expect(tileSetHas({ codes: ["s3"] }, "8R", "S3")).toBe(true);
    expect(tileSetHas({ codes: ["S3"] }, "G1", "G3")).toBe(false);
  });

  test("a row crosses `over` less `except`; `any` is every tile", () => {
    expect(vehicleCrosses(SKIFF, "8R", "G3")).toBe(true);
    expect(vehicleCrosses(SKIFF, "8R", "S3")).toBe(false);
    expect(vehicleCrosses(SKIFF, "G1", "G3")).toBe(false);
    expect(vehicleCrosses(GLIDER, "G1", "S3")).toBe(true);
    expect(vehicleCrosses(GLIDER, "W1", "G3")).toBe(false);
  });

  test("never off the map; a pad vehicle lands on its own tiles", () => {
    const l1 = Array.from({ length: 12 }, () => Array(17).fill("8R").join(" "));
    const l2 = Array.from({ length: 12 }, () => Array(17).fill("G3").join(" "));
    expect(vehicleCrossesAt(SKIFF, l1, l2, 1, 1)).toBe(true);
    expect(vehicleCrossesAt(SKIFF, l1, l2, 0, 1)).toBe(false);
    expect(vehicleCrossesAt(SKIFF, l1, l2, 18, 1)).toBe(false);
    expect(vehicleLandsAt(GLIDER, l1, l2, 4, 4)).toBe(true);
    expect(vehicleLandsAt(SKIFF, l1, l2, 4, 4)).toBe(false);
  });
});

describe("what the engine reads of a row", () => {
  test("its body, its step, and a parked one's name, kind, picture and blocking", () => {
    expect(vehicleOfBody(58)).toBe("Sand Skiff");
    expect(vehicleOfBody(60)).toBe("Glider");
    expect(stepLengthFor("Sand Skiff")).toBe(16);
    expect(stepLengthFor("Glider")).toBe(8);
    expect(vehicleOfItem("Ann's Sand Skiff")).toBe("Sand Skiff");
    expect(vehicleOfItem("ann's sand skiff")).toBe("Sand Skiff");
    expect(vehicleOfItem("Sand Skiff")).toBeNull();
    expect(engineFixtureKind("Ann's Sand Skiff")).toBe("vehicle");
    expect(engineFixtureKind("Ann's Boat")).toBe("vehicle");
    expect(engineFixtureKind("Ann's Raft")).toBeNull();
    expect(groundPicture("Ann's Glider")).toBe("Crate");
    expect(groundPicture("Ann's Airship")).toBe("AirshipPic");
    // A parked vehicle stands in the way, whatever `ground.blocks` names.
    expect(blocksPlayer("Ann's Sand Skiff", { level: 1, skills: [] })).toBe(true);
  });

  test("its lines name it: a flyer's, a land vehicle's, a sea-going one's", () => {
    expect(padTextOf("Glider").board).toBe("You board your Old Glider...");
    expect(padTextOf("Glider").notYours).toBe("You can't get on an Old Glider that's not yours!");
    expect(padTextOf("Airship").notYours).toBe("You can't get on an Airship that's not yours!");
    expect(dropRefusal("Glider")).toBe("You can't drop this from the sky!");
    expect(dropRefusal("Sand Skiff")).toBe("You can't drop this from your sand skiff!");
    expect(dropRefusal("Boat")).toBe("You can't drop this into the ocean!");
    expect(sunkText("Bob", "Glider", null)).toBe(
      "*** Bob's old glider was shot down. Bob fell from the sky.",
    );
    expect(sunkText("Bob", "Sand Skiff", "Ann")).toBe(
      "*** Bob's sand skiff was wrecked by Ann. Bob was thrown off.",
    );
    expect(sunkText("Bob", "Battleship", null)).toBe(
      "*** Bob's battleship was sunk. Bob was claimed by the waters.",
    );
    expect(ARENA_TEXT.landFirst("Glider")).toBe(
      "You must land your old glider before making a challenge.",
    );
    expect(ARENA_TEXT.landFirst("Sand Skiff")).toBe(
      "You must leave your sand skiff before making a challenge.",
    );
  });

  test("a name no row has rides as nothing", () => {
    expect(vehicleRow("Raft")).toBeNull();
    expect(stepLengthFor("Raft")).toBe(16);
  });
});

describe("deeds", () => {
  test("`use: vehicle` names its row; the older uses name Classic's rows", () => {
    expect(deedUse("Skiff Deed")).toEqual({ kind: "vehicle", vehicle: "Sand Skiff" });
    expect(deedUse("Boat Deed")).toEqual({ kind: "vehicle", vehicle: "Boat" });
    expect(deedUse("Airship Deed")).toEqual({ kind: "vehicle", vehicle: "Airship" });
    expect(deedVehicle({ use: "battleship" })).toBe("Battleship");
    expect(deedVehicle({ use: "place" })).toBeNull();
  });
  test("a deed naming a vehicle no row has builds nothing", () => {
    expect(deedUse("Lost Deed")).toEqual({ kind: "nothing", text: null });
  });
});
