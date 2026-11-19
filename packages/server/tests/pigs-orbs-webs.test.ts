/**
 * Sim tests: the web check, the Pig drop and the orbs as ordinary items. Scripted `Rng`
 * replays.
 */
import { describe, expect, test } from "bun:test";

import {
  type DeltaEvent,
  PIG_TEXT,
  type ServerMsg,
  VEHICLE_TEXT,
  WEB_TEXT,
} from "@secondstaronline/shared";

import { type Rng, scriptedRng } from "../src/rng.ts";
import { actionIntent, dropIntent, type ItemCtx } from "../src/systems/inventory/items.ts";
import { type MonsterSlot, species } from "../src/systems/monsters/slots.ts";
import { scheduleStep, setHeld } from "../src/systems/movement/movement.ts";
import type { Player, Room, WorldMap } from "../src/systems/world/world.ts";
import { player, rngByN, setup, testMap } from "./helpers/sim.ts";

type Out = { to: string; msg: ServerMsg }[];
const chat = (out: Out, to: string) =>
  out.flatMap((m) => (m.to === to && m.msg.t === "chat" ? [m.msg.text] : []));
const events = (out: Out, to: string): DeltaEvent[] =>
  out.flatMap((m) => (m.to === to && m.msg.t === "delta" ? m.msg.events : []));

function scene(rng: Rng = rngByN()) {
  const map = testMap("x1000y992");
  const { world, join, run } = setup([map], undefined, rng);
  const a = player("A", map, 5, 5);
  const b = player("B", map, 12, 9);
  for (const p of [a, b]) {
    p.flicker = 0;
  }
  a.facing = "E";
  join(a);
  join(b);
  const room = world.rooms.get(map.name) as Room;
  const ctx = (): ItemCtx => ({ world, rng, now: 1_000_000 });
  return { map, world, room, a, b, run, ctx, rng };
}

const give = (p: Player, slot: number, item: string, qty = 1) => {
  p.char.bag[slot - 1] = { item, qty };
};

/** A live monster in slot `n` (1-based). */
function live(map: WorldMap, n: number, name: string, x: number, y: number) {
  const s = map.slots[n - 1] as MonsterSlot;
  s.species ??= name;
  s.live = {
    name,
    hp: species(name)?.hp ?? 1,
    x,
    y,
    facing: "S",
    anim: 0,
    fromX: x,
    fromY: y,
    queue: [],
    hitCountb: 0,
  };
  return s;
}
const livePigs = (map: WorldMap) =>
  map.slots.filter((s) => s.live !== null && s.live.name === "Pig");

describe("web", () => {
  test("bug fixed: the web message prints once a press, not every attempt while held", () => {
    const s = scene();
    live(s.map, 1, "Web", 5, 5);
    setHeld(s.a, "R", false);
    const lines: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      lines.push(...chat(s.run(1), "A"));
    }
    expect(lines).toEqual([WEB_TEXT]);
    expect([s.a.x, s.a.y, s.a.facing, s.a.stepFrames]).toEqual([5, 5, "E", 0]);
    // A release and a new press print it again.
    setHeld(s.a, null, false);
    s.run(1);
    setHeld(s.a, "U", false);
    expect(chat(s.run(1), "A")).toEqual([WEB_TEXT]);
  });

  test("bug fixed: a scheduled client's web refusals print once until the key changes", () => {
    const s = scene();
    live(s.map, 1, "Web", 5, 5);
    setHeld(s.a, "R", false, true);
    const lines: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const at = { map: s.map.name, n: s.a.n, x: s.a.x, y: s.a.y, blocked: true };
      scheduleStep(s.a, { t: "step", seq: i + 1, dir: "R", turn: false, at });
      lines.push(...chat(s.run(1), "A"));
    }
    expect(lines).toEqual([WEB_TEXT]);
  });

  test("web: it does not turn the walker either", () => {
    const s = scene();
    live(s.map, 1, "Web", 5, 5);
    s.a.facing = "N";
    setHeld(s.a, "R", false);
    s.run(1);
    expect(s.a.facing).toBe("N");
  });

  test("web: aboard an Airship webs are ignored", () => {
    const s = scene();
    live(s.map, 1, "Web", 5, 5);
    s.a.vehicle = "Airship";
    setHeld(s.a, "R", false);
    const out = s.run(1);
    expect(chat(out, "A")).toEqual([]);
    expect(s.a.x).toBe(6);
  });

  test("web: a web on the next tile is walked onto", () => {
    const s = scene();
    live(s.map, 1, "Web", 6, 5);
    // The client was shown the Web placed, so slot 1's remembered name is Web;
    // it clears its own block.
    s.a.shownNames[0] = "Web";
    setHeld(s.a, "R", false);
    expect(chat(s.run(1), "A")).toEqual([]);
    expect(s.a.x).toBe(6);
    // Wait out the step, then try again: now the web is on my own tile.
    const lines: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      lines.push(...chat(s.run(1), "A"));
    }
    expect(lines.length).toBeGreaterThan(0);
    expect(new Set(lines)).toEqual(new Set([WEB_TEXT]));
    expect(s.a.x).toBe(6);
  });

  test("web: a shoved webbed player reads the push lines, then the web line, and stays", () => {
    const s = scene(scriptedRng([1]));
    live(s.map, 1, "Web", 6, 5);
    s.b.x = 6;
    s.b.y = 5;
    setHeld(s.a, "R", false);
    const out = s.run(1);
    const lines = chat(out, "B");
    expect(lines.at(-1)).toBe(WEB_TEXT);
    expect(lines.length).toBeGreaterThan(1);
    expect([s.b.x, s.b.y]).toEqual([6, 5]);
  });

  test("web: a dead slot's old web does not hold anyone", () => {
    const s = scene();
    const slot = live(s.map, 1, "Web", 5, 5);
    slot.live = null;
    setHeld(s.a, "R", false);
    expect(chat(s.run(1), "A")).toEqual([]);
    expect(s.a.x).toBe(6);
  });
});

describe("pig drop", () => {
  test("pig drop: summoned as a live Pig on the faced tile, one Pig leaves the bag, the room sees mspawn", () => {
    const s = scene();
    give(s.a, 1, "Pig", 2);
    const out = dropIntent(s.ctx(), s.room, s.a, 1);
    expect(s.a.char.bag[0]).toEqual({ item: "Pig", qty: 1 });
    expect(s.map.slots[0]?.live).toMatchObject({ name: "Pig", x: 6, y: 5 });
    expect(s.map.slots[0]?.dirty).toBe(true);
    for (const id of ["A", "B"]) {
      expect(events(out, id).map((e) => e.e)).toEqual(["mspawn"]);
    }
    expect(s.map.ground).toEqual([]);
  });

  test('pig drop: four live summons → "It\'s too crowded to drop any pigs here!", the pig kept', () => {
    const s = scene();
    for (let n = 1; n <= 4; n += 1) {
      live(s.map, n, "Slime", 10 + n, 2);
    }
    give(s.a, 1, "Pig");
    const out = dropIntent(s.ctx(), s.room, s.a, 1);
    expect(chat(out, "A")).toEqual([PIG_TEXT.crowded]);
    expect(PIG_TEXT.crowded).toBe("It's too crowded to drop any pigs here!");
    expect(s.a.char.bag[0]).toEqual({ item: "Pig", qty: 1 });
  });

  test('bug fixed: a faced tile off the map at the side, bottom or top → "You can\'t drop an animal here!", the pig kept', () => {
    const s = scene();
    give(s.a, 1, "Pig", 4);
    const tries: [number, number, "N" | "E" | "S" | "W"][] = [
      [17, 5, "E"],
      [1, 5, "W"],
      [5, 12, "S"],
      [5, 1, "N"],
    ];
    for (const [x, y, facing] of tries) {
      s.a.x = x;
      s.a.y = y;
      s.a.facing = facing;
      expect(chat(dropIntent(s.ctx(), s.room, s.a, 1), "A")).toEqual([PIG_TEXT.blocked]);
    }
    expect(s.a.char.bag[0]).toEqual({ item: "Pig", qty: 4 });
    expect(livePigs(s.map)).toHaveLength(0);
  });

  test('pig drop: blocked tile → "You can\'t drop an animal here!", the pig kept', () => {
    const s = scene();
    s.map.walk[4]![5] = false; // x6y5
    give(s.a, 1, "Pig");
    const out = dropIntent(s.ctx(), s.room, s.a, 1);
    expect(chat(out, "A")).toEqual([PIG_TEXT.blocked]);
    expect(PIG_TEXT.blocked).toBe("You can't drop an animal here!");
    expect(s.a.char.bag[0]).toEqual({ item: "Pig", qty: 1 });
  });

  test("bug fixed: pig drop reads the tile's own entry, so x1y1 is open when only x1y10 is blocked", () => {
    const s = scene();
    s.map.walk[9]![0] = false; // x1y10
    s.a.x = 2;
    s.a.y = 1;
    s.a.facing = "W";
    give(s.a, 1, "Pig");
    expect(chat(dropIntent(s.ctx(), s.room, s.a, 1), "A")).toEqual([]);
    expect(s.a.char.bag[0]).toBeNull();
    expect(
      s.map.slots.some((m) => m.live?.name === "Pig" && m.live.x === 1 && m.live.y === 1),
    ).toBe(true);
  });

  test("bug fixed: a pig is refused from an Airship and kept", () => {
    const s = scene();
    s.map.walk[4]![5] = false;
    s.map.walkAir[4]![5] = true;
    s.a.vehicle = "Airship";
    give(s.a, 1, "Pig");
    expect(chat(dropIntent(s.ctx(), s.room, s.a, 1), "A")).toEqual([VEHICLE_TEXT.sky]);
    expect(s.a.char.bag[0]).toEqual({ item: "Pig", qty: 1 });
    expect(livePigs(s.map)).toHaveLength(0);
  });

  test("bug fixed: a pig waits out the item pause and the step like any other item", () => {
    const s = scene();
    give(s.a, 1, "Pig", 2);
    s.a.itemPause = 400;
    expect(dropIntent(s.ctx(), s.room, s.a, 1)).toEqual([]);
    s.a.itemPause = 0;
    s.a.stepFrames = 7;
    expect(dropIntent(s.ctx(), s.room, s.a, 1)).toEqual([]);
    expect(s.a.char.bag[0]).toEqual({ item: "Pig", qty: 2 });
    expect(livePigs(s.map)).toHaveLength(0);
    s.a.stepFrames = 0;
    dropIntent(s.ctx(), s.room, s.a, 1);
    expect(s.a.char.bag[0]).toEqual({ item: "Pig", qty: 1 });
    expect(livePigs(s.map)).toHaveLength(1);
  });

  test("pig drop: allowed on a no-fight map, no Sorcery test", () => {
    const s = scene();
    s.map.flags.canFight = "O";
    give(s.a, 1, "Pig");
    dropIntent(s.ctx(), s.room, s.a, 1);
    expect(s.map.slots[0]?.live?.name).toBe("Pig");
    expect(s.a.char.skills.length).toBeGreaterThan(0);
  });

  test("pig drop: a Cooked Pig takes the ordinary path", () => {
    const s = scene();
    give(s.a, 1, "Cooked Pig");
    dropIntent(s.ctx(), s.room, s.a, 1);
    expect(livePigs(s.map)).toHaveLength(0);
    expect(s.map.ground.map((g) => g.item)).toEqual(["Cooked Pig"]);
  });

  test("pig drop: grabbed back with Ctrl gives the Pig back", () => {
    const s = scene();
    give(s.a, 1, "Pig");
    dropIntent(s.ctx(), s.room, s.a, 1);
    expect(s.a.char.bag[0]).toBeNull();
    s.a.itemPause = 0;
    actionIntent(s.ctx(), s.room, s.a);
    expect(s.a.char.bag.some((l) => l?.item === "Pig")).toBe(true);
    expect(livePigs(s.map)).toHaveLength(0);
  });
});

describe("orbs are ordinary items", () => {
  test("orb drop: a Water Orb lands on the floor like any item", () => {
    for (const orb of ["Water Orb", "Fire Orb", "Earth Orb", "Wind Orb"]) {
      const s = scene();
      give(s.a, 1, orb);
      const out = dropIntent(s.ctx(), s.room, s.a, 1);
      expect(s.map.ground.map((g) => [g.item, g.x, g.y])).toEqual([[orb, 6, 5]]);
      expect(events(out, "B").map((e) => e.e)).toEqual(["gadd"]);
      expect(s.a.char.bag[0]).toBeNull();
    }
  });

  test("orb drop: an orb goes into a container on the faced tile", () => {
    const s = scene();
    s.map.ground.push({ id: "c", item: "Crate#1", x: 6, y: 5, kind: "admin", expiresAt: null });
    give(s.a, 1, "Fire Orb");
    dropIntent(s.ctx(), s.room, s.a, 1);
    expect(s.a.char.bag[0]).toBeNull();
    expect(s.map.ground.map((g) => g.item)).toEqual(["Crate#1"]);
  });

  test('orb drop: aboard an Airship "You can\'t drop this from the sky!"', () => {
    const s = scene();
    s.a.vehicle = "Airship";
    give(s.a, 1, "Earth Orb");
    expect(chat(dropIntent(s.ctx(), s.room, s.a, 1), "A")).toEqual([VEHICLE_TEXT.sky]);
    expect(s.a.char.bag[0]).toEqual({ item: "Earth Orb", qty: 1 });
  });
});
