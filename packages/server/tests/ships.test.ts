/**
 * Boat and Battleship sim tests (issue #2): building on water, boarding from the shore, sailing
 * only on water, getting off onto any shore, the rules aboard, sinking and map crossings.
 */
import { describe, expect, test } from "bun:test";

import { classicData } from "@secondstaronline/data/classic";

const { rects: rectsData } = classicData;

import {
  DEFAULT_DEATH_DROPS,
  type DeltaEvent,
  type ServerMsg,
  SHIP_TEXT,
  tileLoc,
} from "@secondstaronline/shared";

import { pollAttack, setAttackHeld } from "../src/systems/combat/melee.ts";
import {
  actionIntent,
  dropIntent,
  type ItemCtx,
  pickupIntent,
  useIntent,
} from "../src/systems/inventory/items.ts";
import { walkWorld } from "../src/systems/movement/movement.ts";
import { checkDeath } from "../src/systems/progression/vitals.ts";
import { castIntent } from "../src/systems/spells/cast.ts";
import { crossMapEdge } from "../src/systems/world/tick.ts";
import { type Player, type Room, vitalsView, type WorldMap } from "../src/systems/world/world.ts";
import { player, rngByN, setup, testMap } from "./helpers/sim.ts";

type Out = { to: string; msg: ServerMsg }[];
const chat = (out: Out, to: string) =>
  out.flatMap((m) => (m.to === to && m.msg.t === "chat" ? [m.msg.text] : []));
const events = (out: Out, to: string): DeltaEvent[] =>
  out.flatMap((m) => (m.to === to && m.msg.t === "delta" ? m.msg.events : []));

/** Land (G1) west of column 8, sea (W1) from column 8 east. */
const coast = (name = "x1000y992", water = (x: number) => x >= 8) =>
  testMap(name, [], (x) => (water(x) ? "W1" : "G1"));

function scene() {
  const map = coast();
  const rng = rngByN();
  const { world, join, run, deps } = setup([map], undefined, rng);
  const ann = player("Ann", map, 7, 5);
  const bob = player("Bob", map, 7, 7);
  for (const p of [ann, bob]) {
    p.flicker = 0;
    p.char.vitals = { ...p.char.vitals, sp: 200, spMax: 200, hp: 20, hpMax: 40 };
  }
  ann.facing = "E";
  join(ann);
  join(bob);
  const room = world.rooms.get(map.name) as Room;
  const ctx = (now = 1_000_000): ItemCtx => ({ world, rng, now });
  return { map, world, room, ann, bob, run, rng, ctx, deps };
}

const give = (p: Player, slot: number, item: string, qty = 1) => {
  p.char.bag[slot - 1] = { item, qty };
};
const parked = (map: WorldMap, x: number, y: number) =>
  map.ground.find((g) => g.x === x && g.y === y && /'s (Boat|Battleship)$/.test(g.item));
/** Ctrl, with the item-action pause cleared first. */
const ctrl = (s: ReturnType<typeof scene>, p: Player, now?: number) => {
  p.itemPause = 0;
  return actionIntent(s.ctx(now), s.room, p);
};

/** Ann builds a ship on the water east of her and boards it. */
function aboard(deed: "Boat Deed" | "Battleship Deed" = "Boat Deed") {
  const s = scene();
  give(s.ann, 1, deed);
  useIntent(s.ctx(), s.room, s.ann, 1);
  const out = ctrl(s, s.ann);
  return { ...s, out };
}

describe("building", () => {
  test("bug fixed: a Boat Deed builds the boat on the faced water and is used up", () => {
    const s = scene();
    give(s.ann, 1, "Boat Deed");
    const out = useIntent(s.ctx(), s.room, s.ann, 1);
    expect(chat(out, "Ann")).toEqual([]);
    expect(parked(s.map, 8, 5)).toMatchObject({ item: "Ann's Boat", ownerId: "Ann" });
    expect(s.ann.char.bag[0]).toBeNull();
  });
  test("a Battleship Deed builds a Battleship", () => {
    const s = scene();
    give(s.ann, 1, "Battleship Deed");
    useIntent(s.ctx(), s.room, s.ann, 1);
    expect(parked(s.map, 8, 5)?.item).toBe("Ann's Battleship");
  });
  test("away from water, mid-step, or with something on the water, the deed is kept", () => {
    const s = scene();
    give(s.ann, 1, "Boat Deed");
    s.ann.facing = "W";
    expect(chat(useIntent(s.ctx(), s.room, s.ann, 1), "Ann")).toEqual([
      "You have to use this boat deed over water to have your ship built!",
    ]);
    s.ann.facing = "E";
    s.ann.stepFrames = 4;
    s.ann.itemPause = 0;
    expect(chat(useIntent(s.ctx(), s.room, s.ann, 1), "Ann")).toEqual([
      "Please stand still before trying to build your boat.",
    ]);
    s.ann.stepFrames = 0;
    s.map.ground.push({ id: "g1", item: "Apple", x: 8, y: 5, kind: "drop", expiresAt: null });
    s.ann.itemPause = 0;
    expect(chat(useIntent(s.ctx(), s.room, s.ann, 1), "Ann")).toEqual([
      "There's something in the way, you can't place your boat here!",
    ]);
    expect(s.ann.char.bag[0]).toEqual({ item: "Boat Deed", qty: 1 });
  });
});

describe("boarding", () => {
  test("from the shore: you move onto the boat, body 55, a full hull of 60", () => {
    const s = aboard();
    expect(chat(s.out, "Ann")).toEqual([SHIP_TEXT.board("boat")]);
    expect([s.ann.vehicle, s.ann.x, s.ann.y, s.ann.spell.body]).toEqual(["Boat", 8, 5, 55]);
    expect(events(s.out, "Bob")).toContainEqual({ e: "body", id: "Ann", body: 55 });
    expect(parked(s.map, 8, 5)).toBeUndefined();
    expect(vitalsView(s.ann).hull).toEqual({ hp: 60, max: 60 });
  });
  test("a Battleship: body 56 and a hull of 150", () => {
    const s = aboard("Battleship Deed");
    expect(chat(s.out, "Ann")).toEqual(["You board your battleship..."]);
    expect([s.ann.vehicle, s.ann.spell.body, s.ann.hull]).toEqual(["Battleship", 56, 150]);
  });
  test("someone else's boat: you can't get on it", () => {
    const s = scene();
    give(s.ann, 1, "Boat Deed");
    useIntent(s.ctx(), s.room, s.ann, 1);
    s.ann.x = 6;
    s.bob.x = 7;
    s.bob.y = 5;
    s.bob.facing = "E";
    expect(chat(ctrl(s, s.bob), "Bob")).toEqual(["You can't get on a boat that's not yours!"]);
    expect(s.bob.vehicle).toBeNull();
  });
});

describe("sailing", () => {
  test("a ship sails only on water, at walking pace", () => {
    const s = aboard();
    const w = walkWorld(s.room, s.ann);
    expect([w.walkable(9, 5), w.walkable(7, 5)]).toEqual([true, false]);
    expect(s.ann.vehicle).toBe("Boat");
  });
  test("a parked ship and another ship's rider block it; an airship rider does not", () => {
    const s = aboard();
    s.map.ground.push({
      id: "p1",
      item: "Bob's Battleship",
      x: 9,
      y: 5,
      kind: "drop",
      expiresAt: null,
    });
    s.bob.x = 8;
    s.bob.y = 6;
    s.bob.vehicle = "Boat";
    const w = walkWorld(s.room, s.ann);
    expect(w.itemBlocks(9, 5)).toBe(true);
    expect(w.pcBlocked(8, 6)).toBe(true);
    s.bob.vehicle = "Airship";
    expect(w.pcBlocked(8, 6)).toBe(false);
  });
  test("divergence: a ship crosses a map edge only onto water; an airship onto anything", () => {
    const cross = (eastWater: boolean, vehicle: "Boat" | "Airship") => {
      const west = coast("x1000y992", () => true);
      const east = coast("x1001y992", () => eastWater);
      const { world, join, deps } = setup([west, east]);
      const p = player("Ann", west, 17, 5);
      join(p);
      p.vehicle = vehicle;
      crossMapEdge(world, deps, {
        player: p,
        outcome: { kind: "edge", facing: "E", toX: 1, toY: 5, dmx: 1, dmy: 0 },
      });
      return p.map.name;
    };
    expect(cross(true, "Boat")).toBe("x1001y992");
    expect(cross(false, "Boat")).toBe("x1000y992");
    expect(cross(false, "Airship")).toBe("x1001y992");
  });
});

describe("facing at the mooring", () => {
  test("SSO: a new ship faces out to sea, the way its builder looked", () => {
    const s = scene();
    give(s.ann, 1, "Boat Deed");
    const out = useIntent(s.ctx(), s.room, s.ann, 1);
    expect(parked(s.map, 8, 5)?.facing).toBe("E");
    expect(events(out, "Bob")).toContainEqual({
      e: "gadd",
      item: { id: parked(s.map, 8, 5)?.id ?? "", name: "Ann's Boat", x: 8, y: 5, facing: "E" },
    });
  });
  test("SSO: a ship parks facing the way it was left, and boarding takes that facing", () => {
    const s = aboard();
    s.ann.facing = "W";
    ctrl(s, s.ann);
    expect(parked(s.map, 8, 5)?.facing).toBe("W");
    // Ashore at (7, 5), Ann turns east to face it; aboard she faces west, as it lay.
    expect([s.ann.x, s.ann.y]).toEqual([7, 5]);
    s.ann.facing = "E";
    ctrl(s, s.ann);
    expect(s.ann.vehicle).toBe("Boat");
    expect(s.ann.facing as string).toBe("W");
  });
  test("SSO: a ship parked before facing was kept, or placed by an operator, faces east", () => {
    const s = scene();
    s.map.ground.push({
      id: "old",
      item: "Ann's Boat",
      ownerId: "Ann",
      x: 8,
      y: 5,
      kind: "drop",
      expiresAt: null,
    });
    s.ann.facing = "E";
    s.ann.itemPause = 0;
    actionIntent(s.ctx(), s.room, s.ann);
    expect([s.ann.vehicle, s.ann.facing]).toEqual(["Boat", "E"]);
  });
});

describe("getting off", () => {
  test("onto the faced shore: you step ashore and the boat parks with its hull", () => {
    const s = aboard();
    s.ann.hull = 40;
    s.ann.facing = "W";
    const out = ctrl(s, s.ann, 2_000_000);
    expect(chat(out, "Ann")).toEqual([]);
    expect([s.ann.vehicle, s.ann.x, s.ann.y, s.ann.spell.body, s.ann.hull]).toEqual([
      null,
      7,
      5,
      null,
      null,
    ]);
    expect(parked(s.map, 8, 5)).toMatchObject({
      item: "Ann's Boat",
      ownerId: "Ann",
      hull: 40,
      parkedAt: 2_000_000,
    });
  });
  test("not onto water, a player, or mid-step; a ground item in front is taken instead", () => {
    const s = aboard();
    s.ann.facing = "E";
    expect(chat(ctrl(s, s.ann), "Ann")).toEqual(["You can't get off here!"]);
    s.ann.facing = "W";
    s.bob.x = 7;
    s.bob.y = 5;
    expect(chat(ctrl(s, s.ann), "Ann")).toEqual(["You can't get off here!"]);
    s.bob.y = 7;
    s.ann.stepFrames = 3;
    expect(chat(ctrl(s, s.ann), "Ann")).toEqual([
      "Please stop moving before trying to unboard your boat.",
    ]);
    s.ann.stepFrames = 0;
    expect(s.ann.vehicle).toBe("Boat");
  });
  test("a tree on the shore stops you getting off", () => {
    const s = aboard();
    s.map.layers[1][4] = (s.map.layers[1][4] ?? "")
      .split(" ")
      .map((c, i) => (i === 6 ? "S3" : c))
      .join(" ");
    s.map.walk[4] = s.map.walk[4]?.map((v, i) => (i === 6 ? false : v)) ?? [];
    s.ann.facing = "W";
    expect(chat(ctrl(s, s.ann), "Ann")).toEqual(["You can't get off here!"]);
  });
  test("boarding again later repairs the hull a point a minute", () => {
    const s = aboard();
    s.ann.hull = 10;
    s.ann.facing = "W";
    ctrl(s, s.ann, 2_000_000);
    s.ann.facing = "E";
    ctrl(s, s.ann, 2_000_000 + 30 * 60_000);
    expect([s.ann.vehicle, s.ann.hull]).toEqual(["Boat", 40]);
  });
});

describe("aboard", () => {
  test("bug fixed: nothing is dropped into the ocean", () => {
    const s = aboard();
    give(s.ann, 2, "Apple");
    s.ann.itemPause = 0;
    const out = dropIntent(s.ctx(), s.room, s.ann, 2, 1);
    expect(chat(out, "Ann")).toEqual(["You can't drop this into the ocean!"]);
    expect(s.ann.char.bag[1]).toEqual({ item: "Apple", qty: 1 });
  });
  test("divergence: a click on a parked ship from aboard says whose it is", () => {
    const s = aboard();
    s.map.ground.push({
      id: "bs",
      item: "Bob's Battleship",
      ownerId: "Bob",
      x: 10,
      y: 5,
      kind: "drop",
      expiresAt: null,
    });
    s.ann.itemPause = 0;
    expect(chat(pickupIntent(s.ctx(), s.room, s.ann, "bs"), "Ann")).toEqual([
      "You see Bob's battleship.",
    ]);
    // Ann still rides her own boat; Bob's stays parked.
    expect([s.ann.vehicle, parked(s.map, 10, 5)?.item]).toEqual(["Boat", "Bob's Battleship"]);
  });
  test("every ship frame's rect holds the rider's registration point, where tile-aimed shots go", () => {
    const frames = Object.entries(rectsData.chars).filter(([k]) => /^5[56]-/.test(k));
    expect(frames.length).toBe(44);
    for (const [name, [w, h, regX, regY]] of frames) {
      expect({ name, inX: regX >= 0 && regX < w, inY: regY >= 0 && regY < h }).toEqual({
        name,
        inX: true,
        inY: true,
      });
    }
  });
  test("no swing aboard", () => {
    const s = aboard();
    s.ann.timers.canAttack = true;
    setAttackHeld(s.ann, true);
    const ev = pollAttack(s.room, s.ann, { rng: s.rng, now: 0, world: s.world });
    expect(ev.swing).toBeNull();
  });
  test("SSO: the hull running out sinks the boat and everyone hears it", () => {
    const s = aboard();
    s.ann.hull = 2;
    s.bob.spell.book = ["Firebolt"];
    give(s.bob, 1, "Red Crystal", 20);
    const t = tileLoc(8, 5);
    castIntent(s.room, s.bob, "Firebolt", t.h, t.v, { rng: s.rng });
    const out = s.run(60);
    expect([s.ann.vehicle, s.ann.hull, s.ann.spell.body]).toEqual([null, null, null]);
    expect(chat(out, "Bob")).toContain(
      "*** Ann's boat was sunk by Bob. Ann was claimed by the waters.",
    );
    expect(s.bob.char.wanted).toBe(true);
  });
  test("a death aboard loses the ship and drops nothing", () => {
    const s = aboard("Battleship Deed");
    s.ann.char.vitals.hp = 0;
    const r = checkDeath(s.room, s.ann, rngByN(), {
      item: s.ctx(),
      rules: DEFAULT_DEATH_DROPS,
      everyDeath: false,
    });
    expect(r.kind).toBe("death");
    expect(s.ann.vehicle).toBeNull();
    expect(parked(s.map, 8, 5)).toBeUndefined();
  });
});
