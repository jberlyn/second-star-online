/**
 * Vehicles as content rows (issue #44): a world's own vehicles, built from their deeds, ridden over
 * the tiles their rows name, boarded and left the way their rows say, and drawn with their own
 * bodies. A Sand Skiff crosses sand (`8R`) and is boarded from the shore; a Canoe is a second
 * Boat-like vehicle with its own picture, rider and hull; a Glider lands on its own pads.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import type { VehicleRow } from "@secondstaronline/data";
import { classicData } from "@secondstaronline/data/classic";
import {
  buildContentStore,
  type ContentData,
  hullMax,
  installContent,
  type ServerMsg,
  stepLengthFor,
  vehicleOfBody,
} from "@secondstaronline/shared";

import { newVehicleArtGaps } from "../src/content/art-usage.ts";
import { contractProblems } from "../src/content/contract.ts";
import { vehicleProblems } from "../src/content/validate.ts";
import {
  actionIntent,
  dropIntent,
  type ItemCtx,
  useIntent,
} from "../src/systems/inventory/items.ts";
import { walkWorld } from "../src/systems/movement/movement.ts";
import type { Player, Room, WorldMap } from "../src/systems/world/world.ts";
import { player, rngByN, setup, testMap } from "./helpers/sim.ts";

type Out = { to: string; msg: ServerMsg }[];
const chat = (out: Out, to: string) =>
  out.flatMap((m) => (m.to === to && m.msg.t === "chat" ? [m.msg.text] : []));

const SKIFF: VehicleRow = {
  name: "Sand Skiff",
  picture: "Crate",
  rider: 58,
  hull: 30,
  moves: { over: { codes: ["8R"] } },
  boards: "shore",
};
const CANOE: VehicleRow = {
  name: "Canoe",
  display: "Little Canoe",
  picture: "Crate",
  rider: 59,
  hull: 20,
  moves: { over: { flags: ["sea"] } },
  boards: "shore",
};
const GLIDER: VehicleRow = {
  name: "Glider",
  picture: "Crate",
  rider: 60,
  hull: 10,
  moves: { over: "any", except: { codes: ["W1"] } },
  boards: "pad",
  lands: { codes: ["8R"] },
};

/** Classic with the three vehicles above and a deed for each. */
function withVehicles(d: ContentData): ContentData {
  d.houses.vehicles = [...(d.houses.vehicles ?? []), ...structuredClone([SKIFF, CANOE, GLIDER])];
  for (const v of [SKIFF, CANOE, GLIDER]) {
    const deed = `${v.name} Deed`;
    d.items.items.push({ name: deed, icon: null });
    d.houses.deeds.push({ deed, use: "vehicle", vehicle: v.name, house: null, text: null });
  }
  return d;
}

beforeAll(() => {
  installContent(buildContentStore(withVehicles(structuredClone(classicData) as ContentData)));
});
afterAll(() => {
  installContent(buildContentStore(classicData as ContentData));
});

/** Grass (G1) west of column 8, sand (8R) from column 8 to 12, sea (W1) east of it. */
function scene() {
  const map = testMap("x1000y992", [], (x) => (x < 8 ? "G1" : x <= 12 ? "8R" : "W1"));
  const rng = rngByN();
  const { world, join } = setup([map], undefined, rng);
  const ann = player("Ann", map, 7, 5);
  ann.facing = "E";
  ann.flicker = 0;
  join(ann);
  const room = world.rooms.get(map.name) as Room;
  const ctx = (): ItemCtx => ({ world, rng, now: 1_000_000 });
  const ctrl = (p: Player) => {
    p.itemPause = 0;
    return actionIntent(ctx(), room, p);
  };
  return { map, world, room, ann, ctx, ctrl };
}

const give = (p: Player, slot: number, item: string) => {
  p.char.bag[slot - 1] = { item, qty: 1 };
};
const groundAt = (map: WorldMap, x: number, y: number) =>
  map.ground.find((g) => g.x === x && g.y === y);

describe("a Sand Skiff: over sand, boarded from the shore (issue #44)", () => {
  test("its deed builds it on the faced sand, never on grass", () => {
    const s = scene();
    give(s.ann, 1, "Sand Skiff Deed");
    s.ann.facing = "W";
    expect(chat(useIntent(s.ctx(), s.room, s.ann, 1), "Ann")).toEqual([
      "You have to use this sand skiff deed where your sand skiff can go!",
    ]);
    s.ann.facing = "E";
    s.ann.itemPause = 0;
    expect(chat(useIntent(s.ctx(), s.room, s.ann, 1), "Ann")).toEqual([]);
    expect(groundAt(s.map, 8, 5)).toMatchObject({
      item: "Ann's Sand Skiff",
      ownerId: "Ann",
      facing: "E",
    });
    expect(s.ann.char.bag[0]).toBeNull();
  });

  test("ridden, it crosses sand only, with its own body and hull, and blocks like a walker", () => {
    const s = scene();
    give(s.ann, 1, "Sand Skiff Deed");
    useIntent(s.ctx(), s.room, s.ann, 1);
    expect(chat(s.ctrl(s.ann), "Ann")).toEqual(["You board your sand skiff..."]);
    expect([s.ann.vehicle, s.ann.spell.body, s.ann.hull, s.ann.x]).toEqual([
      "Sand Skiff",
      58,
      30,
      8,
    ]);
    expect(vehicleOfBody(58)).toBe("Sand Skiff");
    expect(stepLengthFor("Sand Skiff")).toBe(16);
    const w = walkWorld(s.room, s.ann);
    expect([7, 8, 12, 13].map((x) => w.walkable(x, 5))).toEqual([false, true, true, false]);
    // Not a sea-going vehicle: its own words for a drop aboard.
    give(s.ann, 2, "Apple");
    s.ann.itemPause = 0;
    expect(chat(dropIntent(s.ctx(), s.room, s.ann, 2), "Ann")).toEqual([
      "You can't drop this from your sand skiff!",
    ]);
  });

  test("it is left onto the shore beside it, and parks where it stood", () => {
    const s = scene();
    give(s.ann, 1, "Sand Skiff Deed");
    useIntent(s.ctx(), s.room, s.ann, 1);
    s.ctrl(s.ann);
    s.ann.facing = "W";
    expect(chat(s.ctrl(s.ann), "Ann")).toEqual([]);
    expect([s.ann.vehicle, s.ann.x, s.ann.spell.body]).toEqual([null, 7, null]);
    expect(groundAt(s.map, 8, 5)?.item).toBe("Ann's Sand Skiff");
  });
});

describe("riders in a walker's way", () => {
  test("a shore vehicle's rider blocks a walker, a flying rider never does", () => {
    const s = scene();
    const bob = player("Bob", s.map, 9, 6);
    s.room.players.push(bob);
    s.ann.x = 9;
    s.ann.y = 5;
    s.ann.vehicle = "Sand Skiff";
    expect(walkWorld(s.room, bob).pcBlocked(9, 5)).toBe(true);
    s.ann.vehicle = "Glider";
    expect(walkWorld(s.room, bob).pcBlocked(9, 5)).toBe(false);
  });
});

describe("a Canoe: a second Boat-like vehicle with its own art, rider and hull", () => {
  test("built on the water, ridden with its own body and hull, named by its display name", () => {
    const s = scene();
    s.ann.x = 12;
    give(s.ann, 1, "Canoe Deed");
    useIntent(s.ctx(), s.room, s.ann, 1);
    expect(groundAt(s.map, 13, 5)?.item).toBe("Ann's Canoe");
    expect(chat(s.ctrl(s.ann), "Ann")).toEqual(["You board your little canoe..."]);
    expect([s.ann.vehicle, s.ann.spell.body, s.ann.hull]).toEqual(["Canoe", 59, 20]);
    expect(hullMax("Canoe")).toBe(20);
    const w = walkWorld(s.room, s.ann);
    expect([12, 13, 17].map((x) => w.walkable(x, 5))).toEqual([false, true, true]);
    // A sea-going vehicle keeps 1.6's water line.
    give(s.ann, 2, "Apple");
    s.ann.itemPause = 0;
    expect(chat(dropIntent(s.ctx(), s.room, s.ann, 2), "Ann")).toEqual([
      "You can't drop this into the ocean!",
    ]);
  });
});

describe("a Glider: a flying vehicle with its own pads", () => {
  test("built and left on its pads, it flies like the Airship but not over the sea", () => {
    const s = scene();
    give(s.ann, 1, "Glider Deed");
    useIntent(s.ctx(), s.room, s.ann, 1);
    expect(groundAt(s.map, 8, 5)?.item).toBe("Ann's Glider");
    expect(chat(s.ctrl(s.ann), "Ann")).toEqual(["You board your Glider..."]);
    expect([s.ann.vehicle, s.ann.spell.body]).toEqual(["Glider", 60]);
    expect(stepLengthFor("Glider")).toBe(8);
    const w = walkWorld(s.room, s.ann);
    expect([1, 7, 8, 13].map((x) => w.walkable(x, 5))).toEqual([true, true, true, false]);
    // Grass is no pad: it cannot be left there.
    s.ann.x = 7;
    expect(chat(s.ctrl(s.ann), "Ann")).toEqual(["You cannot get off here."]);
    s.ann.x = 9;
    expect(chat(s.ctrl(s.ann), "Ann")).toEqual([]);
    expect(groundAt(s.map, 9, 5)?.item).toBe("Ann's Glider");
  });
});

describe("Classic's deeds still name their vehicles by the old `use`", () => {
  test("a Boat Deed builds the Boat row", () => {
    const s = scene();
    s.ann.x = 12;
    give(s.ann, 1, "Boat Deed");
    useIntent(s.ctx(), s.room, s.ann, 1);
    expect(groundAt(s.map, 13, 5)?.item).toBe("Ann's Boat");
  });
});

describe("the vehicles' publish checks", () => {
  const data = (change: (d: ContentData) => void) => {
    const d = withVehicles(structuredClone(classicData) as ContentData);
    change(d);
    return d;
  };
  const row = (d: ContentData, name: string) =>
    d.houses.vehicles?.find((v) => v.name === name) as VehicleRow;

  test("Classic's and these rows pass", () => {
    expect(vehicleProblems(data(() => {}))).toEqual([]);
    expect(contractProblems(data(() => {}))).toEqual([]);
  });

  test("tiles must exist, flags must be carried, and there must be a way to board", () => {
    const d = data((x) => {
      row(x, "Sand Skiff").moves = { over: { codes: ["Q?"] }, except: { codes: ["G1"] } };
      row(x, "Glider").lands = { flags: ["grave"], codes: ["ZZ"] };
    });
    expect(vehicleProblems(d)).toEqual([
      {
        where: "houses/vehicles/Sand Skiff",
        message: "moves.over names a tile that does not exist: Q?",
      },
      {
        where: "houses/vehicles/Sand Skiff",
        message: "it crosses no tile, so it can never be built or boarded",
      },
      { where: "houses/vehicles/Glider", message: "lands names a tile that does not exist: ZZ" },
    ]);
  });

  test("the way to board is over less except, by the runtime's layer rules", () => {
    const crossesNothing = data((x) => {
      row(x, "Sand Skiff").moves = { over: { codes: ["8R"] }, except: { codes: ["8R"] } };
      // Docks are layer-1 tiles: excepting them on layer 1 leaves the Glider nowhere to land.
      row(x, "Glider").moves = { over: "any", except: { flags: ["dock"] } };
      row(x, "Glider").lands = { flags: ["dock"] };
    });
    expect(vehicleProblems(crossesNothing)).toEqual([
      {
        where: "houses/vehicles/Sand Skiff",
        message: "it crosses no tile, so it can never be built or boarded",
      },
      {
        where: "houses/vehicles/Glider",
        message: "it has no tile it can fly onto and land on, so it can never be built or boarded",
      },
    ]);
    // `airshipBlock` is a layer-2 flag: a sea-going row that excepts it still crosses the sea.
    const fine = data((x) => {
      row(x, "Canoe").moves = { over: { flags: ["sea"] }, except: { flags: ["airshipBlock"] } };
    });
    expect(vehicleProblems(fine)).toEqual([]);
  });

  test("a vehicle may not take an owner fixture's name, and riders need bodies of their own", () => {
    const d = data((x) => {
      row(x, "Canoe").name = "Mailbox";
      row(x, "Glider").rider = 58;
    });
    expect(vehicleProblems(d)).toEqual([
      {
        where: "houses/vehicles/Mailbox",
        message: "Mailbox is the name of an engine fixture: name it another way",
      },
    ]);
    expect(contractProblems(d)).toEqual([
      {
        where: "houses/vehicles/Glider",
        message: "the Sand Skiff and the Glider riders need different bodies (both are 58)",
      },
    ]);
  });
});

describe("more of the vehicles' checks", () => {
  const data = (change: (d: ContentData) => void) => {
    const d = withVehicles(structuredClone(classicData) as ContentData);
    change(d);
    return d;
  };
  const row = (d: ContentData, name: string) =>
    d.houses.vehicles?.find((v) => v.name === name) as VehicleRow;

  test("a name takes a key's form, displays are told apart, and no item is named like a parked one", () => {
    const d = data((x) => {
      row(x, "Sand Skiff").name = "5 Skiff";
      row(x, "Glider").display = "Little Canoe";
      x.items.items.push({ name: "Bob's Canoe", icon: null });
    });
    expect(vehicleProblems(d).map((p) => `${p.where}: ${p.message}`)).toEqual([
      "houses/vehicles/5 Skiff: a key may not start with a number and a space",
      "items/items/Bob's Canoe: Bob's Canoe is named like a parked Canoe: name the item another way",
      "houses/vehicles/Glider: the Canoe and the Glider show the same name (Little Canoe): give one another display",
    ]);
  });

  test("art: packs (an incoming pack's included) and uploads both count; walking frames only", () => {
    const keys = (items: string[], bodies: string[]) => ({
      sprites: {
        items: new Set(items),
        bodies: new Set(bodies),
        paperdoll: new Set<string>(),
        fx: new Set<string>(),
        tiles: new Set<string>(),
      },
      sounds: new Set<string>(),
    });
    const walk = (b: number) =>
      [1, 2, 3, 4].flatMap((f) => ["n", "e", "s", "w"].map((dir) => `${b}-f${f}-${dir}`));
    const next = data((x) => {
      x.houses.vehicles = [{ ...SKIFF, cannon: true }];
    });
    const published = structuredClone(classicData) as ContentData;
    const none = keys([], []);
    // Nothing draws it: both named.
    expect(newVehicleArtGaps(next, published, none, none).map((p) => p.message)).toEqual([
      "the parked picture Crate has no art",
      "the rider body 58 is missing f1-n, f1-e, f1-s, f1-w, f2-n, f2-e and 10 more (a rider walks in four directions)",
    ]);
    // A pack's (or an incoming pack's) art, with no upload library: none, firing frames or not.
    expect(newVehicleArtGaps(next, published, keys(["crate"], walk(58)), none)).toEqual([]);
    // Uploaded art counts the same.
    expect(newVehicleArtGaps(next, published, none, keys(["crate"], walk(58)))).toEqual([]);
  });
});
