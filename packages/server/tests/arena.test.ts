/**
 * The arena challenge on the server: the challenge and quit words, the hop to a passing tile,
 * arena deaths, and how the arena lines are filtered and charged.
 */
import { describe, expect, test } from "bun:test";

import type { DeltaEvent, ServerMsg } from "@secondstaronline/shared";

import { helpLines } from "../src/game.ts";
import { type ChatDeps, handleChat } from "../src/systems/chat/chat.ts";
import { checkDeath } from "../src/systems/progression/vitals.ts";
import type { Player, Room } from "../src/systems/world/world.ts";
import { player, rngByN, setup, testMap } from "./helpers/sim.ts";

type Out = { to: string; msg: ServerMsg }[];
const chats = (out: Out, id: string) =>
  out.flatMap((o) => (o.to === id && o.msg.t === "chat" ? [o.msg.text] : []));
const deltas = (out: Out, id: string): DeltaEvent[] =>
  out.flatMap((o) => (o.to === id && o.msg.t === "delta" ? o.msg.events : []));

/** A map with `6P` on layer-1 tiles `arena` and a tree (blocked on foot) on each of `trees`. */
function scene(opts: {
  arena?: [number, number][];
  trees?: [number, number][];
  rng?: ReturnType<typeof rngByN>;
  everyTreeButArena?: boolean;
}) {
  const arena = opts.arena ?? [[4, 4]];
  const trees: [number, number][] = [...(opts.trees ?? [])];
  if (opts.everyTreeButArena) {
    for (let y = 1; y <= 12; y++) {
      for (let x = 1; x <= 17; x++) {
        if (!arena.some(([ax, ay]) => ax === x && ay === y)) {
          trees.push([x, y]);
        }
      }
    }
  }
  const map = testMap("x1000y992", trees, (x, y) =>
    arena.some(([ax, ay]) => ax === x && ay === y) ? "6P" : "G1",
  );
  const rng = opts.rng ?? rngByN();
  const { world, join, run } = setup([map], undefined, rng);
  const bob = player("Bob", map, 8, 8);
  const ann = player("Ann", map, 10, 8);
  const cat = player("Cat", map, 12, 8);
  for (const p of [bob, ann, cat]) {
    p.flicker = 0;
    join(p);
  }
  const room = world.rooms.get(map.name) as Room;
  const deps: ChatDeps = {
    maxChars: 200,
    broadcastCooldownFrames: 1000,
    chatCooldownFrames: 60,
    helpLines,
    rng,
  };
  const say = (p: Player, line: string) => handleChat(world, p, line, deps);
  return { map, world, room, bob, ann, cat, rng, say, run };
}

describe("Challenge and quit", () => {
  test("Challenge: '<name> has entered the arena!' to the map, the challenger too, then the hop", () => {
    const s = scene({ rng: rngByN({ 17: [4], 12: [4] }) });
    const out = s.say(s.bob, "Challenge");
    for (const id of ["Bob", "Ann", "Cat"]) {
      expect(chats(out, id)).toEqual(["Bob has entered the arena!"]);
    }
    expect([s.bob.x, s.bob.y, s.bob.stepFrames, s.bob.forceYou]).toEqual([4, 4, 0, true]);
    // The others re-place the sprite; the mover is told through forceYou, not a delta.
    expect(deltas(out, "Ann").map((e) => e.e)).toEqual(["leave", "enter"]);
    expect(deltas(out, "Bob")).toEqual([]);
    // The line comes before the move in the outgoing order.
    const firstLine = out.findIndex((o) => o.msg.t === "chat");
    const firstDelta = out.findIndex((o) => o.msg.t === "delta");
    expect(firstLine).toBeLessThan(firstDelta);
  });

  test("quit: '<name> has stopped fighting.' to the map and the hop to a passing tile", () => {
    // Exits are row by row; the first passing tile is (1,1). 201 = 204 less the 6P tile and the
    // tiles Ann and Cat stand on.
    const s = scene({ rng: rngByN({ 201: [1] }) });
    s.bob.x = 4;
    s.bob.y = 4;
    const out = s.say(s.bob, "quit");
    for (const id of ["Bob", "Ann", "Cat"]) {
      expect(chats(out, id)).toEqual(["Bob has stopped fighting."]);
    }
    expect([s.bob.x, s.bob.y, s.bob.forceYou]).toEqual([1, 1, true]);
    expect(deltas(out, "Cat").map((e) => e.e)).toEqual(["leave", "enter"]);
    // Off the arena it is silent.
    expect(s.say(s.bob, "quit")).toEqual([]);
  });

  test("a reader ignoring the challenger misses the arena line", () => {
    const s = scene({ rng: rngByN({ 17: [4], 12: [4] }) });
    s.ann.ignore = ["Bob"];
    const out = s.say(s.bob, "Challenge");
    expect(chats(out, "Ann")).toEqual([]);
    expect(chats(out, "Cat")).toEqual(["Bob has entered the arena!"]);
    // The ignorer still sees the sprite move.
    expect(deltas(out, "Ann").map((e) => e.e)).toEqual(["leave", "enter"]);

    s.bob.x = 4;
    s.bob.y = 4;
    expect(chats(s.say(s.bob, "quit"), "Ann")).toEqual([]);
  });

  test("the arena death's defeated line is filtered like an sqa too", () => {
    const s = scene({});
    s.ann.ignore = ["Bob"];
    s.bob.x = 4;
    s.bob.y = 4;
    s.bob.lastToHitMe = "Cat";
    s.bob.char.vitals.hp = 0;
    const out = s.run(1);
    expect(chats(out, "Cat")).toContain("Bob was defeated by Cat.");
    expect(chats(out, "Bob")).toContain("Bob was defeated by Cat.");
    expect(chats(out, "Ann")).not.toContain("Bob was defeated by Cat.");
    expect(s.bob.char.vitals.hp).toBe(1);
  });

  test("bug fixed: a challenge never puts you on a tile a player or a blocking item holds", () => {
    const s = scene({
      arena: [
        [4, 4],
        [6, 4],
      ],
      rng: rngByN({ 2: [1] }),
    });
    s.ann.x = 4;
    s.ann.y = 4;
    s.say(s.bob, "Challenge");
    // Ann's tile is skipped: the one free tile is picked with one roll.
    expect([s.bob.x, s.bob.y]).toEqual([6, 4]);
    expect(s.rng.calls).toEqual([1]);

    const full = scene({});
    full.map.ground.push({
      id: "g1",
      item: "Wooden Chest",
      x: 4,
      y: 4,
      kind: "admin",
      expiresAt: null,
    });
    expect(chats(full.say(full.bob, "Challenge"), "Bob")).toEqual([
      "There is no room in the arena!",
    ]);
    expect([full.bob.x, full.bob.y]).toEqual([8, 8]);
  });

  test("bug fixed: quit never puts you on another player's tile", () => {
    const s = scene({ rng: rngByN({ 201: [1] }) });
    s.ann.x = 1;
    s.ann.y = 1;
    s.cat.x = 2;
    s.cat.y = 1;
    s.bob.x = 4;
    s.bob.y = 4;
    s.say(s.bob, "quit");
    expect([s.bob.x, s.bob.y]).toEqual([3, 1]);
  });

  test("kept bug: a rider challenges and quits still flying", () => {
    const s = scene({ rng: rngByN({ 17: [4], 12: [4] }) });
    s.bob.vehicle = "Airship";
    s.bob.spell.body = 57;
    s.say(s.bob, "Challenge");
    expect([s.bob.x, s.bob.y]).toEqual([4, 4]);
    expect(s.bob.vehicle).toBe("Airship");
    s.say(s.bob, "quit");
    expect(s.bob.vehicle).toBe("Airship");
    expect(s.bob.spell.body).toBe(57);
    expect(s.bob.x === 4 && s.bob.y === 4).toBe(false);
  });

  test("a rider's exit is drawn from the Airship grid", () => {
    // Everything but the arena tile is a tree: blocked on foot, open to the Airship.
    const walker = scene({ arena: [[4, 4]], everyTreeButArena: true });
    walker.bob.x = 4;
    walker.bob.y = 4;
    expect(walker.say(walker.bob, "quit")).toEqual([]);
    expect([walker.bob.x, walker.bob.y]).toEqual([4, 4]);

    const rider = scene({ arena: [[4, 4]], everyTreeButArena: true, rng: rngByN({ 201: [1] }) });
    rider.bob.x = 4;
    rider.bob.y = 4;
    rider.bob.vehicle = "Airship";
    rider.say(rider.bob, "quit");
    expect([rider.bob.x, rider.bob.y]).toEqual([1, 1]);
  });

  test("an arena death aboard exits on the Airship grid", () => {
    const s = scene({ arena: [[4, 4]], everyTreeButArena: true, rng: rngByN({ 201: [2] }) });
    s.bob.x = 4;
    s.bob.y = 4;
    s.bob.vehicle = "Airship";
    s.bob.char.vitals.hp = 0;
    const r = checkDeath(s.room, s.bob, s.rng, {
      item: { world: s.world, rng: s.rng, now: 0 },
      dropOnDeath: true,
      immortal: false,
    });
    expect(r).toMatchObject({ kind: "arena", tile: { x: 2, y: 1 } });
  });

  test("divergence: an arena death with no passing tile keeps the player in place, at HP and SP 1, and says the line", () => {
    const s = scene({ arena: [[4, 4]], everyTreeButArena: true });
    s.bob.x = 4;
    s.bob.y = 4;
    s.bob.lastToHitMe = "Cat";
    s.bob.char.vitals.hp = 0;
    const out = s.run(1);
    expect([s.bob.x, s.bob.y]).toEqual([4, 4]);
    expect([s.bob.char.vitals.hp, s.bob.char.vitals.sp]).toEqual([1, 1]);
    expect(chats(out, "Ann")).toContain("Bob was defeated by Cat.");
    expect(deltas(out, "Ann")).toEqual([]);
  });

  test("an arena death sends no death message: the screen does not go black", () => {
    const s = scene({ arena: [[4, 4]], everyTreeButArena: true });
    s.bob.x = 4;
    s.bob.y = 4;
    s.bob.char.vitals.hp = 0;
    const out = s.run(1);
    expect(out.some((m) => m.msg.t === "death")).toBe(false);
  });

  test("bug fixed: Hold and the death wait stop the arena words", () => {
    const held = scene({});
    held.bob.x = 4;
    held.bob.y = 4;
    held.bob.spell.hold = 40;
    expect(chats(held.say(held.bob, "quit"), "Bob")).toEqual([
      "You cannot do that while you are held.",
    ]);
    expect([held.bob.x, held.bob.y]).toEqual([4, 4]);
    held.bob.x = 8;
    held.bob.y = 8;
    expect(chats(held.say(held.bob, "Challenge"), "Bob")).toEqual([
      "You cannot do that while you are held.",
    ]);
    expect([held.bob.x, held.bob.y]).toEqual([8, 8]);

    const dead = scene({});
    dead.bob.deadLock = 60;
    expect(dead.say(dead.bob, "Challenge")).toEqual([]);
    expect([dead.bob.x, dead.bob.y]).toEqual([8, 8]);
  });

  test("divergence: with no passing tile quit says nothing and stays put", () => {
    const s = scene({ everyTreeButArena: true });
    s.bob.x = 4;
    s.bob.y = 4;
    expect(s.say(s.bob, "quit")).toEqual([]);
    expect([s.bob.x, s.bob.y]).toEqual([4, 4]);
  });

  test("a mid-step player gets the stand-still line and does not move", () => {
    const s = scene({});
    s.bob.stepFrames = 5;
    expect(chats(s.say(s.bob, "Challenge"), "Bob")).toEqual([
      "You should stand still before making a challenge.",
    ]);
    s.bob.x = 4;
    s.bob.y = 4;
    expect(chats(s.say(s.bob, "quit"), "Bob")).toEqual([
      "You should stand still before exiting the arena.",
    ]);
    expect([s.bob.x, s.bob.y, s.bob.stepFrames]).toEqual([4, 4, 5]);
  });

  test("the words say nothing aloud and charge no chat cooldown", () => {
    const s = scene({});
    const out = s.say(s.bob, "Challenge");
    expect(chats(out, "Ann")).toEqual(["Bob has entered the arena!"]);
    expect(chats(out, "Ann").some((t) => t.includes("says"))).toBe(false);
    // A said line right after is not refused by a cooldown.
    expect(chats(s.say(s.bob, "hello"), "Ann")).toEqual(['Bob says "hello"']);
  });
});
