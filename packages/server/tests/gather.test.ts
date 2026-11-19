/**
 * Gathering in the tick: the swing's tool block, fishing, the Watering Bucket, seeds, regrowth
 * per map and treasure; and the tile changes written to the map row (real SQL on in-memory
 * SQLite).
 */
import { describe, expect, test } from "bun:test";

import {
  type DeltaEvent,
  FISHING_STOPPED_TEXT,
  footWalkGrid,
  type ServerMsg,
  skillIndex,
  tileAt,
  withTile,
} from "@secondstaronline/shared";

import { createGame } from "../src/game.ts";
import { openDatabase } from "../src/persistence/database.ts";
import { findMapByCoords } from "../src/persistence/maps.ts";
import { migrate } from "../src/persistence/migrations.ts";
import { handleChat } from "../src/systems/chat/chat.ts";
import { setAttackHeld } from "../src/systems/combat/melee.ts";
import { resetTreasure } from "../src/systems/crafting/gather.ts";
import { type ItemCtx, useIntent } from "../src/systems/inventory/items.ts";
import { pressStep, setHeld } from "../src/systems/movement/movement.ts";
import { type Player, removePlayer, type WorldMap } from "../src/systems/world/world.ts";
import { player, rngByN, setup, testMap } from "./helpers/sim.ts";

type Out = { to: string; msg: ServerMsg }[];

const events = (out: Out, to: string): DeltaEvent[] =>
  out.flatMap((o) => (o.to === to && o.msg.t === "delta" ? o.msg.events : []));
const lines = (out: Out, to: string): string[] =>
  out.flatMap((o) => (o.to === to && o.msg.t === "chat" ? [o.msg.text] : []));
const sounds = (out: Out, to: string): string[] =>
  out.flatMap((o) => (o.to === to && o.msg.t === "sound" ? [`${o.msg.name}:${o.msg.ch}`] : []));

const setSkill = (p: Player, name: string, v: number) => {
  p.char.skills[skillIndex(name)] = v;
};
const skill = (p: Player, name: string) => p.char.skills[skillIndex(name)] ?? 0;

function setLayer(m: WorldMap, layer: 0 | 1, x: number, y: number, code: string) {
  m.layers[layer] = withTile(m.layers[layer], x, y, code) ?? m.layers[layer];
  m.walk = footWalkGrid(m.layers[0], m.layers[1]);
}

/** Hunger rolls random(3) every tick too, so a queue for 3 must last. */
const ones = (n = 2000) => Array(n).fill(1);

/** A player at (5, 6) facing north at (5, 5), holding `tool`, swinging until `n` swings. */
function swinger(tool: string, rng = rngByN()) {
  const map = testMap("x1000y992", [[5, 5]]);
  const s = setup([map], undefined, rng);
  const a = player("a", map, 5, 6);
  a.char.equip.weapon = tool;
  s.join(a);
  const swings = (n: number): Out => {
    const out: Out = [];
    let done = 0;
    setAttackHeld(a, true);
    while (done < n) {
      const o = s.run(1);
      out.push(...o);
      done += events(o, "a").filter((e) => e.e === "swing").length;
    }
    setAttackHeld(a, false);
    return out;
  };
  return { ...s, map, a, swings };
}

describe("the axe", () => {
  test("bug fixed: 18 swings fell a tree, as the table says: the stump, treefalling, logs and the skill line", () => {
    const g = swinger("Axe", rngByN({ 3: ones(), 12: [1] }));
    setSkill(g.a, "Lumberjacking", 5);
    const b = player("b", g.map, 9, 9);
    g.join(b);
    const first = g.swings(17);
    expect(
      events(first, "a")
        .filter((e) => e.e === "swing")
        .every((e) => e.e === "swing" && e.sound === "treechop"),
    ).toBe(true);
    expect(tileAt(g.map.layers[1], 5, 5)).toBe("S3");
    const out = g.swings(1);
    expect(tileAt(g.map.layers[1], 5, 5)).toBe("P3");
    expect(events(out, "b")).toContainEqual({ e: "tile", layer: 2, x: 5, y: 5, code: "P3" });
    expect(g.map.ground.map((x) => [x.item, x.x, x.y, x.kind])).toEqual([["Logs", 5, 5, "loot"]]);
    expect(sounds(out, "a")).toEqual(["treefalling:2"]);
    expect(sounds(out, "b")).toEqual([]);
    expect(lines(out, "a")).toEqual(["You have advanced in the art of Lumberjacking!"]);
    expect(skill(g.a, "Lumberjacking")).toBe(6);
    expect(g.world.tileLog.has(g.map)).toBe(true);
  });

  test("a stump is not a tree: the swing stays a plain swordswing and counts nothing", () => {
    const g = swinger("Gold Axe");
    setLayer(g.map, 1, 5, 5, "P3");
    const out = g.swings(3);
    expect(
      events(out, "a")
        .filter((e) => e.e === "swing")
        .map((e) => e.e === "swing" && e.sound),
    ).toEqual(["swordswing", "swordswing", "swordswing"]);
    expect(g.a.gather.Axe).toBeUndefined();
  });

  test("bug fixed: Lumberjacking 0 fells trees, drops logs and can rise", () => {
    const g = swinger("Axe", rngByN({ 3: ones(), 12: [1] }));
    setSkill(g.a, "Lumberjacking", 0);
    const out = g.swings(18);
    expect(tileAt(g.map.layers[1], 5, 5)).toBe("P3");
    expect(g.map.ground.map((x) => x.item)).toEqual(["Logs"]);
    expect(lines(out, "a")).toEqual(["You have advanced in the art of Lumberjacking!"]);
    expect(skill(g.a, "Lumberjacking")).toBe(1);
  });

  test("bug fixed: a fell mid-step drops its logs on the felled tile", () => {
    const g = swinger("Axe", rngByN({ 3: ones(), 12: [1] }));
    setSkill(g.a, "Lumberjacking", 5);
    g.a.gather.Axe = 1; // the next hit succeeds
    g.a.stepFrames = 5; // mid-step: the faced tile is from the destination tile already
    const out = g.swings(1);
    expect(tileAt(g.map.layers[1], 5, 5)).toBe("P3");
    expect(g.map.ground.map((x) => [x.item, x.x, x.y])).toEqual([["Logs", 5, 5]]);
    expect(lines(out, "a")).toEqual(["You have advanced in the art of Lumberjacking!"]);
  });
});

describe("mining", () => {
  test("the hammer clanks for everyone; the break drops a find and plays crush to the miner", () => {
    const g = swinger("Mining Hammer", rngByN({ 5: [1] }));
    setLayer(g.map, 1, 5, 5, "B8");
    setSkill(g.a, "Mining", 5);
    g.a.gather["Mining Hammer"] = 1;
    const out = g.swings(1);
    expect(events(out, "a").find((e) => e.e === "swing")).toMatchObject({ sound: "swordhit2" });
    expect(tileAt(g.map.layers[1], 5, 5)).toBe("O8");
    expect(g.map.ground.map((x) => x.item)).toEqual(["1 Blue Crystals"]);
    expect(sounds(out, "a")).toEqual(["crush:2"]);
  });
});

describe("fishing", () => {
  const fisher = (rng = rngByN()) => {
    const map = testMap("x1000y992", [], (x, y) => (x === 5 && y === 5 ? "W1" : "G1"));
    const s = setup([map], undefined, rng);
    const a = player("a", map, 5, 6);
    a.char.equip.weapon = "Fishing Pole";
    s.join(a);
    return { ...s, map, a };
  };

  test("a cast into layer-1 water: the Fishing FX for everyone, AtDelay 20, a fish on the water", () => {
    const f = fisher(rngByN({ 28: [1] }));
    setSkill(f.a, "Fishing", 20);
    setAttackHeld(f.a, true);
    const swing = f.run(1);
    expect(events(swing, "a").find((e) => e.e === "swing")).toMatchObject({ atDelay: 20 });
    expect(f.map.ground.map((x) => [x.item, x.x, x.y])).toEqual([["Trout", 5, 5]]);
    expect(f.world.fishingSpots.get("a")?.left).toBe(4);
    const next = f.run(1);
    const fx = events(next, "a").find((e) => e.e === "fx");
    // The FX at sprite 112 + (-5, -17), facing north.
    expect(fx).toMatchObject({ name: "Fishing", h: 5 * 32 + 14 - 5, v: 6 * 32 - 3 - 17 });
  });

  test("bug fixed: the Ring of Quickness shortens a cast's AtDelay from 20 to 16", () => {
    const f = fisher(rngByN({ 28: [1] }));
    f.a.char.equip.ring = "Ring of Quickness";
    setSkill(f.a, "Fishing", 20);
    setAttackHeld(f.a, true);
    const swing = f.run(1);
    expect(events(swing, "a").find((e) => e.e === "swing")).toMatchObject({ atDelay: 16 });
    expect(f.a.timers.atDelay).toBe(16);
  });

  test("bug fixed: water drawn only on layer 2 (D2) can be fished", () => {
    const f = fisher(rngByN({ 28: [1] }));
    setLayer(f.map, 0, 5, 5, "G1");
    setLayer(f.map, 1, 5, 5, "D2");
    setSkill(f.a, "Fishing", 20);
    setAttackHeld(f.a, true);
    f.run(1);
    expect(f.map.ground.map((x) => [x.item, x.x, x.y])).toEqual([["Trout", 5, 5]]);
    expect(f.world.fishingSpots.get("a")?.left).toBe(4);
  });

  test("bug fixed: a cast mid-step catches like any other", () => {
    const f = fisher(rngByN({ 28: [1] }));
    setSkill(f.a, "Fishing", 20);
    f.a.stepFrames = 5;
    setAttackHeld(f.a, true);
    f.run(1);
    expect(f.map.ground.map((x) => x.item)).toEqual(["Trout"]);
  });

  const spent = (f: ReturnType<typeof fisher>, x = 5, y = 6) =>
    f.world.fishingSpots.set("a", { mapId: f.map.id, x, y, left: 0 });

  test("design change: turning does not refill a tile's allowance; fishing from another does", () => {
    const f = fisher(rngByN({ 28: [1, 1] }));
    setSkill(f.a, "Fishing", 20);
    setLayer(f.map, 0, 6, 5, "W1");
    spent(f);
    // Turn away and back without leaving the tile: 1.6 refilled the allowance on each press.
    setHeld(f.a, "R", true);
    f.run(1);
    setHeld(f.a, "U", true);
    f.run(1);
    setHeld(f.a, null, false);
    expect([f.a.x, f.a.y, f.a.facing]).toEqual([5, 6, "N"]);
    setAttackHeld(f.a, true);
    const out = f.run(1);
    setAttackHeld(f.a, false);
    expect(f.map.ground).toEqual([]);
    expect(lines(out, "a")).toContain(FISHING_STOPPED_TEXT);
    expect(f.world.fishingSpots.get("a")?.left).toBe(0);
    // A step to the next tile, facing water again: a full allowance there.
    pressStep(f.a, "R", false);
    f.run(20);
    pressStep(f.a, "U", true);
    f.run(1);
    expect([f.a.x, f.a.y, f.a.facing]).toEqual([6, 6, "N"]);
    f.run(20);
    setAttackHeld(f.a, true);
    f.run(1);
    expect(f.map.ground.map((g) => [g.item, g.x, g.y])).toEqual([["Trout", 6, 5]]);
    expect(f.world.fishingSpots.get("a")).toEqual({ mapId: f.map.id, x: 6, y: 6, left: 4 });
  });

  test("design change: logging out and back in does not refill a tile's allowance", () => {
    const f = fisher(rngByN({ 28: [1] }));
    spent(f);
    removePlayer(f.world, "a");
    const again = player("a", f.map, 5, 6);
    again.char.equip.weapon = "Fishing Pole";
    setSkill(again, "Fishing", 20);
    f.join(again);
    setAttackHeld(again, true);
    const out = f.run(1);
    expect(f.map.ground).toEqual([]);
    expect(lines(out, "a")).toContain(FISHING_STOPPED_TEXT);
  });

  test("design change: a fished-out tile says so once while the line is held", () => {
    const f = fisher();
    setSkill(f.a, "Fishing", 20);
    spent(f);
    setAttackHeld(f.a, true);
    const out = f.run(100); // five casts
    expect(lines(out, "a").filter((l) => l === FISHING_STOPPED_TEXT)).toHaveLength(1);
    expect(skill(f.a, "Fishing")).toBe(20);
  });
});

describe("farming", () => {
  test("bug fixed: the Watering Bucket counts only swings at a seeded tile", () => {
    const g = swinger("Watering Bucket");
    const out = g.swings(20);
    expect(g.a.gather["Watering Bucket"]).toBeUndefined();
    expect(events(out, "a").filter((e) => e.e === "tile")).toEqual([]);
    expect(
      events(out, "a")
        .filter((e) => e.e === "swing")
        .every((e) => e.e === "swing" && e.sound === null),
    ).toBe(true);
  });

  test("watering a seeded tile grows it; the sprinkle is cast facing east", () => {
    const g = swinger("Watering Bucket");
    g.a.facing = "E";
    setLayer(g.map, 1, 6, 6, "UL");
    g.a.gather["Watering Bucket"] = 1;
    const out = [...g.swings(1), ...g.run(1)];
    expect(tileAt(g.map.layers[1], 6, 6)).toBe("XL");
    expect(events(out, "a").find((e) => e.e === "fx")).toMatchObject({ name: "sprinkle" });
  });

  test("the hoe tills TL into SL with Shoveling on channel 2", () => {
    const g = swinger("Hoe");
    setLayer(g.map, 1, 5, 5, "TL");
    g.a.gather.Hoe = 1;
    const out = g.swings(1);
    expect(tileAt(g.map.layers[1], 5, 5)).toBe("SL");
    expect(sounds(out, "a")).toEqual(["shoveling:2"]);
  });

  test("bug fixed: seeds are kept on a wrong tile or off the map; they plant on SL", () => {
    const g = swinger("NOTHING");
    const ctx = (): ItemCtx => ({ world: g.world, rng: rngByN(), now: 0 });
    const room = g.world.rooms.get(g.map.name);
    if (!room) {
      throw new Error("no room");
    }
    g.a.char.bag[0] = { item: "Seeds", qty: 3 };
    setLayer(g.map, 1, 5, 5, "SL");
    let out = useIntent(ctx(), room, g.a, 1);
    expect(lines(out, "a")).toEqual(["You plant the seeds."]);
    expect(tileAt(g.map.layers[1], 5, 5)).toBe("UL");
    expect(g.a.char.bag[0]).toEqual({ item: "Seeds", qty: 2 });
    const wrong =
      "You plant the seeds into the ground but realize this isn't going to grow anything here!";
    out = useIntent(ctx(), room, g.a, 1);
    expect(lines(out, "a")).toEqual([wrong]);
    expect(g.a.char.bag[0]).toEqual({ item: "Seeds", qty: 2 });
    g.a.y = 1; // facing north off the map
    out = useIntent(ctx(), room, g.a, 1);
    expect(lines(out, "a")).toEqual([wrong]);
    expect(g.a.char.bag[0]).toEqual({ item: "Seeds", qty: 2 });
  });
});

describe("regrowth", () => {
  test("bug fixed: one random(600) per map per frame, however many players are there", () => {
    const rng = rngByN();
    const map = testMap("x1000y992");
    const s = setup([map], undefined, rng);
    s.join(player("a", map, 2, 2));
    s.join(player("b", map, 3, 3));
    s.join(player("c", map, 4, 4));
    rng.calls.length = 0;
    s.run(1);
    expect(rng.calls.filter((n) => n === 600)).toHaveLength(1);
    rng.calls.length = 0;
    s.run(5);
    expect(rng.calls.filter((n) => n === 600)).toHaveLength(5);
  });

  test("bug fixed: an empty map catches up on the frames it missed, up to an hour", () => {
    const rng = rngByN();
    const map = testMap("x1000y992");
    const s = setup([map], undefined, rng);
    const a = player("a", map, 2, 2);
    s.join(a);
    s.run(1);
    removePlayer(s.world, "a");
    s.run(40); // nobody there: the room is unloaded
    rng.calls.length = 0;
    const b = player("b", map, 3, 3);
    s.join(b);
    s.run(1);
    expect(rng.calls.filter((n) => n === 600)).toHaveLength(41);
    // A long absence catches up at most an hour of frames.
    removePlayer(s.world, "b");
    map.regrowthTick = s.world.tickNo - 1_000_000;
    rng.calls.length = 0;
    s.join(player("c", map, 4, 4));
    s.run(1);
    expect(rng.calls.filter((n) => n === 600)).toHaveLength(72_000);
  });

  test("bug fixed: a stump regrows on a roll under 6, even right after a death or exit warp", () => {
    const map = testMap("x1000y992");
    setLayer(map, 1, 3, 4, "P3");
    const rng = rngByN({ 600: [5], 17: [3], 12: [4] });
    const s = setup([map], undefined, rng);
    const a = player("a", map, 9, 9);
    s.join(a);
    const out = s.run(1);
    expect(tileAt(map.layers[1], 3, 4)).toBe("S3");
    expect(events(out, "a")).toContainEqual({ e: "tile", layer: 2, x: 3, y: 4, code: "S3" });
  });

  test("grown corn drops Corn on its own tile", () => {
    const map = testMap("x1000y992");
    setLayer(map, 1, 3, 4, "XL");
    const s = setup([map], undefined, rngByN({ 600: [9], 17: [1, 3], 12: [1, 4] }));
    s.join(player("a", map, 9, 9));
    s.run(1);
    expect(map.ground.map((x) => [x.item, x.x, x.y])).toEqual([["Corn", 3, 4]]);
    expect(tileAt(map.layers[1], 3, 4)).toBe("XL");
  });
});

describe("treasure", () => {
  test("a dig on the treasure's map finds it on random(5) = 1 and hides a new one", () => {
    const g = swinger("Shovel", rngByN({ 5: [1], 29: [...Array(69).fill(1), 14] }));
    g.world.treasureMaps = ["x1000y992"];
    g.world.treasure = { map: "x1000y992", item: "300 Gold" };
    setLayer(g.map, 1, 5, 5, "G3");
    g.a.gather.Shovel = 1;
    const out = g.swings(1);
    expect(tileAt(g.map.layers[1], 5, 5)).toBe("1K");
    expect(g.map.ground.map((x) => [x.item, x.x, x.y])).toEqual([["300 Gold", 5, 5]]);
    expect(lines(out, "a")).toContain("*** You uncover some treasure in your digging!");
    expect(g.world.treasure).toEqual({ map: "x1000y992", item: "Steel Shield" });
  });

  test("bug fixed: the shovel will not dig G3 over water on any row", () => {
    const g = swinger("Shovel");
    setLayer(g.map, 0, 5, 5, "N1");
    setLayer(g.map, 1, 5, 5, "G3");
    g.a.gather.Shovel = 1;
    g.swings(1);
    expect(tileAt(g.map.layers[1], 5, 5)).toBe("G3");
    expect(g.a.gather.Shovel).toBe(1); // the swing counted nothing
  });

  test("another map never finds it, and no list means no treasure", () => {
    const g = swinger("Shovel", rngByN({ 5: [1] }));
    resetTreasure(g.world, [], rngByN());
    setLayer(g.map, 1, 5, 5, "G3");
    expect(g.world.treasure).toBeNull();
    g.a.gather.Shovel = 1;
    g.swings(1);
    expect(g.map.ground).toEqual([]);
  });
});

describe("treasure rumours", () => {
  const chatDeps = (rng = rngByN({ 2: [1, 2] })) => ({
    maxChars: 200,
    broadcastCooldownFrames: 1000,
    chatCooldownFrames: 0,
    helpLines: () => null,
    rng,
    mapHeader: (name: string) => (name === "x5y5" ? "the old mill" : ""),
  });
  const withNpc = (name: string) => {
    const map = testMap("x1000y992");
    const s = setup([map]);
    const a = player("a", map, 5, 5);
    const b = player("b", map, 7, 7);
    s.join(a);
    s.join(b);
    const slot = map.slots[1];
    if (slot) {
      slot.live = {
        name,
        hp: 10,
        x: 2,
        y: 2,
        facing: "S",
        anim: 0,
        fromX: 2,
        fromY: 2,
        queue: [],
        hitCountb: 0,
      };
    }
    s.world.treasure = { map: "x5y5", item: "Plate Boots" };
    return { ...s, a };
  };

  test("asking about treasure makes a rumour NPC on the map name the treasure map's header to everyone", () => {
    const g = withNpc("Cril");
    const out = handleChat(g.world, g.a, "any treasure around here?", chatDeps());
    const said = 'Cril says "Word has it that some treasure was buried near the old mill."';
    expect(lines(out, "a")).toContain(said);
    expect(lines(out, "b")).toContain(said);
  });

  test("an NPC that is not a rumour NPC, no header, or another line says nothing", () => {
    expect(
      lines(handleChat(withNpc("Bob").world, withNpc("Bob").a, "treasure?", chatDeps()), "a"),
    ).toHaveLength(1);
    const g = withNpc("Vin");
    g.world.treasure = { map: "x9y9", item: "Plate Boots" };
    expect(lines(handleChat(g.world, g.a, "treasure?", chatDeps()), "a")).toHaveLength(1);
    const h = withNpc("Vin");
    expect(lines(handleChat(h.world, h.a, "hello", chatDeps()), "a")).toHaveLength(1);
    expect(lines(handleChat(h.world, h.a, "/me wants treasure", chatDeps()), "a")).toHaveLength(1);
  });

  test("the treasure rumour NPCs: Cril, Galor, Ratmas, Teral, Vin", () => {
    for (const npc of ["Cril", "Galor", "Ratmas", "Teral", "Vin"]) {
      const g = withNpc(npc);
      const out = handleChat(g.world, g.a, "any treasure around here?", chatDeps());
      expect(lines(out, "a")).toContain(
        `${npc} says "Word has it that some treasure was buried near the old mill."`,
      );
    }
  });
});

describe("tile persistence", () => {
  test("a felled tree is written to the map row and is a stump after a restart", async () => {
    const db = openDatabase();
    migrate(db);
    const sent: Out = [];
    const deps = {
      db,
      send: (to: string, msg: ServerMsg) => sent.push({ to, msg }),
      isoNow: () => "2026-11-06T00:00:00.000Z",
      rng: rngByN({ 3: [2] }),
      minute: () => 0,
    };
    const g = createGame(deps);
    const r = await g.create({
      t: "create",
      name: "Alice",
      password: "pw",
      sex: 1,
      head: 1,
      classCode: 1,
      str: 11,
      sta: 11,
      int: 11,
      wis: 11,
      dex: 11,
    });
    expect(r.ok).toBe(true);
    const l = await g.login("Alice", "pw");
    if (!l.ok) {
      throw new Error(l.text);
    }
    g.enter(l.characterId, false);
    g.intent(l.characterId, { t: "mapReady" });
    const p = g.world.players.get(l.characterId);
    if (!p) {
      throw new Error("no player");
    }
    const [dx, dy] =
      p.facing === "N" ? [0, -1] : p.facing === "S" ? [0, 1] : p.facing === "E" ? [1, 0] : [-1, 0];
    const tx = p.x + dx;
    const ty = p.y + dy;
    p.map.layers[1] = withTile(p.map.layers[1], tx, ty, "S3") ?? p.map.layers[1];
    p.char.equip.weapon = "Axe";
    p.gather.Axe = 1;
    g.intent(l.characterId, { t: "attack", seq: 1, held: true });
    g.tick();
    expect(tileAt(p.map.layers[1], tx, ty)).toBe("P3");
    const rec = findMapByCoords(db, 1000, 992);
    expect(rec && tileAt(rec.layers[1], tx, ty)).toBe("P3");
  });
});
