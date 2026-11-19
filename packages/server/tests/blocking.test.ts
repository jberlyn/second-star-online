/**
 * Monsters and NPCs block a player's step as 1.6's blocking check did: what blocks, the three-wide
 * Overlord, the Web and Holy Shield exemptions, push rolls and the remembered names.
 */
import { beforeEach, describe, expect, test } from "bun:test";

import type { ServerMsg } from "@secondstaronline/shared";

import { createGame } from "../src/game.ts";
import { type Db, openDatabase } from "../src/persistence/database.ts";
import { migrate } from "../src/persistence/migrations.ts";
import type { Rng } from "../src/rng.ts";
import { type MonsterSlot, species } from "../src/systems/monsters/slots.ts";
import { type MoveCtx, movePlayer, noteShown, setHeld } from "../src/systems/movement/movement.ts";
import type { Player, Room, WorldMap } from "../src/systems/world/world.ts";
import { player, rngByN, setup, testMap } from "./helpers/sim.ts";

type Out = { to: string; msg: ServerMsg }[];
const chat = (out: Out, to: string) =>
  out.flatMap((m) => (m.to === to && m.msg.t === "chat" ? [m.msg.text] : []));

/** An rng that throws on any `random(25)` call: proves no push roll was made. */
const noPushRoll = (): Rng => ({
  random(n) {
    if (n === 25) {
      throw new Error("random(25) rolled");
    }
    return n;
  },
});

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

/** Marks the names this player has been shown in slots 1-4. */
function shown(p: Player, ...names: (string | null)[]) {
  names.forEach((n, i) => {
    p.shownNames[i] = n;
  });
}

function scene(rng: Rng = noPushRoll()) {
  const map = testMap("x1000y992");
  const { world, join, run } = setup([map], undefined, rng);
  const a = player("A", map, 5, 5);
  a.flicker = 0;
  a.facing = "E";
  join(a);
  const room = world.rooms.get(map.name) as Room;
  return { map, world, room, a, join, run };
}

describe("monsters block", () => {
  test("a standing Slime blocks and turns the player, no push roll", () => {
    const s = scene();
    live(s.map, 1, "Slime", 5, 4);
    shown(s.a, "Slime");
    setHeld(s.a, "U", false);
    s.run(3);
    expect(s.a.y).toBe(5);
    expect(s.a.facing).toBe("N");
    expect(s.a.stepFrames).toBe(0);
    expect(chat(s.run(1), "A")).toEqual([]);
  });

  test("a shopkeeper NPC blocks", () => {
    const s = scene();
    live(s.map, 2, "Amber", 6, 5);
    shown(s.a, null, "Amber");
    setHeld(s.a, "R", false);
    s.run(2);
    expect(s.a.x).toBe(5);
  });

  test("an unshown slot still blocks by position", () => {
    const s = scene();
    live(s.map, 1, "Slime", 6, 5);
    setHeld(s.a, "R", false);
    s.run(2);
    expect(s.a.x).toBe(5);
  });

  test("a monster blocks its start tile on the tick its step begins, never its destination, nothing mid-step", () => {
    const s = scene();
    const m = live(s.map, 1, "Slime", 6, 5).live as NonNullable<MonsterSlot["live"]>;
    // Step just begun: logical tile (7,5), sprite still on (6,5). The tick's monster step is
    // skipped (movePlayer called directly), so anim stays 16 as at the players' step.
    m.x = 7;
    m.fromX = 6;
    m.anim = 16;
    const ctx: MoveCtx = {
      rng: noPushRoll(),
      emit: () => {},
      tell: () => {},
      crossings: [],
    };
    s.a.held = "R";
    movePlayer(s.room, s.a, ctx);
    expect(s.a.x).toBe(5); // blocked by the start tile
    // Mid-step: nothing blocks, neither tile.
    m.anim = 15;
    movePlayer(s.room, s.a, ctx);
    expect(s.a.x).toBe(6);
  });

  test("a monster's destination tile does not block until it arrives", () => {
    const s = scene();
    const m = live(s.map, 1, "Slime", 6, 5).live as NonNullable<MonsterSlot["live"]>;
    m.x = 5;
    m.y = 4;
    m.fromX = 6;
    m.fromY = 4;
    m.anim = 9;
    setHeld(s.a, "U", false);
    s.run(1);
    expect(s.a.y).toBe(4);
  });

  test("Overlord at x = 16 stops a walk off the right edge", () => {
    const s = scene();
    s.a.x = 17;
    live(s.map, 1, "Overlord", 16, 5);
    shown(s.a, "Overlord");
    setHeld(s.a, "R", false);
    s.run(3);
    expect(s.a.x).toBe(17);
    expect(s.a.facing).toBe("E");
    expect(s.world.players.has("A")).toBe(true);
  });

  test("a rider ignores monsters", () => {
    const s = scene();
    s.a.vehicle = "Airship";
    live(s.map, 1, "Slime", 6, 5);
    setHeld(s.a, "R", false);
    s.run(1);
    expect(s.a.x).toBe(6);
  });
});

describe("only an Overlord or Mutant Worm is three wide", () => {
  test("bug fixed: a Slime in slot 2 is one wide after an Overlord in slot 1, dead or alive", () => {
    for (const overlordLives of [false, true]) {
      const s = scene();
      if (overlordLives) {
        live(s.map, 1, "Overlord", 12, 9);
      }
      live(s.map, 2, "Slime", 7, 5);
      shown(s.a, "Overlord", "Slime");
      s.a.x = 8;
      s.a.facing = "W";
      // Target (9,5): the Slime at 7 is two to its left, and a Slime is one wide.
      setHeld(s.a, "R", false);
      s.run(1);
      expect(s.a.x).toBe(9);
    }
  });

  test("an Overlord in a higher slot still blocks three wide", () => {
    const s = scene();
    live(s.map, 1, "Slime", 12, 9);
    live(s.map, 2, "Overlord", 7, 5);
    shown(s.a, "Slime", "Overlord");
    s.a.x = 10;
    setHeld(s.a, "L", false);
    s.run(1);
    expect(s.a.x).toBe(10); // (9,5) is the Overlord's third tile
  });

  test("a lower slot is one wide", () => {
    const s = scene();
    live(s.map, 1, "Slime", 7, 5);
    live(s.map, 2, "Overlord", 12, 9);
    shown(s.a, "Slime", "Overlord");
    s.a.x = 8;
    setHeld(s.a, "R", false);
    s.run(1);
    expect(s.a.x).toBe(9);
  });
});

describe("a Web or Holy Shield never blocks, and clears nothing else", () => {
  test("bug fixed: a remembered Web in slot 2 does not let you walk through a Slime in slot 1", () => {
    const s = scene();
    live(s.map, 1, "Slime", 6, 5);
    shown(s.a, "Slime", "Web");
    setHeld(s.a, "R", false);
    s.run(1);
    expect(s.a.x).toBe(5);
  });

  test("a live Web or Holy Shield on the target is walked onto", () => {
    for (const name of ["Web", "Holy Shield"]) {
      const s = scene();
      live(s.map, 2, name, 6, 5);
      shown(s.a, null, name);
      setHeld(s.a, "R", false);
      s.run(1);
      expect(s.a.x).toBe(6);
    }
  });

  test("slot 3 after the Web still blocks", () => {
    const s = scene();
    live(s.map, 3, "Slime", 6, 5);
    shown(s.a, "Slime", "Web", "Slime");
    setHeld(s.a, "R", false);
    s.run(1);
    expect(s.a.x).toBe(5);
  });

  test("bug fixed: a Web in slot 4 does not let you walk onto a standing player; the roll still shoves", () => {
    const rng = rngByN({ 25: [1] });
    const s = scene(rng);
    const b = player("B", s.map, 6, 5);
    b.flicker = 0;
    s.join(b);
    shown(s.a, null, null, null, "Web");
    setHeld(s.a, "R", false);
    const out = s.run(1);
    expect(s.a.x).toBe(5); // blocked by B
    expect(chat(out, "B")).toEqual(["A shoves you out of the way."]);
    expect(b.x).toBe(7);
  });
});

describe("push rolls", () => {
  test("two standing players on the target → two rolls, in arrival order, before any shove", () => {
    const rng = rngByN({ 25: [1, 1] });
    const s = scene(rng);
    const b = player("B", s.map, 6, 5);
    const c = player("C", s.map, 6, 5);
    for (const p of [b, c]) {
      p.flicker = 0;
      s.join(p);
    }
    setHeld(s.a, "R", false);
    const out = s.run(1);
    expect(rng.calls.filter((n) => n === 25)).toHaveLength(2);
    expect(chat(out, "B")).toHaveLength(1);
    expect(chat(out, "C")).toHaveLength(1);
    expect(b.x).toBe(7);
    // C's shove is blocked by B, who now steps onto (7,5): they never share a tile.
    expect(c.x).toBe(6);
  });

  test("a press blocked by a tile with a player behind a Web still rolls", () => {
    const rng = rngByN({ 25: [2] });
    const s = scene(rng);
    const b = player("B", s.map, 6, 5);
    b.flicker = 0;
    s.join(b);
    live(s.map, 1, "Web", 5, 5); // my own tile is webbed
    shown(s.a, "Web");
    setHeld(s.a, "R", false);
    s.run(1);
    expect(rng.calls.filter((n) => n === 25)).toHaveLength(1);
    expect(s.a.x).toBe(5);
  });

  test("a pushed victim is blocked by a monster", () => {
    const rng = rngByN({ 25: [1] });
    const s = scene(rng);
    const b = player("B", s.map, 6, 5);
    b.flicker = 0;
    s.join(b);
    live(s.map, 1, "Slime", 7, 5);
    shown(b, "Slime");
    setHeld(s.a, "R", false);
    s.run(1);
    expect(b.x).toBe(6);
    expect(s.a.x).toBe(5);
  });
});

describe("remembered names", () => {
  const view = (slot: number, name: string) =>
    ({ slot, name, body: 1, x: 3, y: 3, facing: "S", step: null }) as never;

  test("snapshot and mspawn set names; deaths and a later snapshot keep them; a new Player starts empty", () => {
    const map = testMap("x1000y992");
    const p = player("A", map, 5, 5);
    expect(p.shownNames).toEqual([null, null, null, null]);
    noteShown(p, {
      t: "snapshot",
      monsters: [view(1, "Slime"), view(3, "Web")],
    } as unknown as ServerMsg);
    expect(p.shownNames).toEqual(["Slime", null, "Web", null]);
    noteShown(p, { t: "delta", events: [{ e: "mspawn", monster: view(2, "Overlord") }] });
    expect(p.shownNames).toEqual(["Slime", "Overlord", "Web", null]);
    noteShown(p, { t: "delta", events: [{ e: "mgone", slot: 2 }] });
    noteShown(p, { t: "snapshot", monsters: [] } as unknown as ServerMsg);
    expect(p.shownNames).toEqual(["Slime", "Overlord", "Web", null]);
  });
});

describe("through the game's delivery", () => {
  let db: Db;
  beforeEach(() => {
    db = openDatabase();
    migrate(db);
  });

  test("a map entry fills shownNames from the snapshot; an earlier player is not told", async () => {
    const sent: Out = [];
    const g = createGame({
      db,
      send: (to, msg) => sent.push({ to, msg }),
      isoNow: () => "2026-11-05T00:00:00.000Z",
      rng: rngByN(),
      minute: () => 0,
    });
    const ids: string[] = [];
    for (const name of ["Alice", "Bob"]) {
      await g.create({
        t: "create",
        name,
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
      const l = await g.login(name, "pw");
      if (!l.ok) {
        throw new Error(l.text);
      }
      ids.push(l.characterId);
    }
    g.enter(ids[0] as string, false);
    const room = [...g.world.rooms.values()][0] as Room;
    live(room.map, 1, "Slime", 3, 3);
    g.enter(ids[1] as string, false);
    expect(g.world.players.get(ids[1] as string)?.shownNames[0]).toBe("Slime");
    expect(g.world.players.get(ids[0] as string)?.shownNames[0]).toBeNull();
  });
});
