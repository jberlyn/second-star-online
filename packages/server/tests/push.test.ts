/**
 * Pushing, seeded and scripted `Rng` replays.
 */
import { describe, expect, test } from "bun:test";

import type { ServerMsg } from "@secondstaronline/shared";

import { scriptedRng, seededRng } from "../src/rng.ts";
import { setHeld } from "../src/systems/movement/movement.ts";
import { player, setup, testMap } from "./helpers/sim.ts";

const chatTo = (out: { to: string; msg: ServerMsg }[], id: string) =>
  out.flatMap((o) => (o.to === id && o.msg.t === "chat" ? [o.msg.text] : []));

const ALWAYS = () => scriptedRng([1]);

describe("the push roll", () => {
  test("each blocked tick rolls random(25); about 1 in 25 pushes", () => {
    const rolls: number[] = [];
    const seeded = seededRng(7);
    const rng = {
      random(n: number) {
        rolls.push(n);
        return seeded.random(n);
      },
    };
    const map = testMap("x1000y992");
    const { join, run } = setup([map], undefined, rng);
    const a = player("a", map, 5, 5);
    const b = player("b", map, 6, 5);
    b.role = "immortal"; // never moves, so every tick is a blocked attempt
    join(a);
    join(b);
    setHeld(a, "R", false);
    run(500);
    // Hunger also rolls random(3) every tick and regrowth random(600) per player, and from
    // frame 400 the periodic save random(350) and its quest chest random(4000); the push roll is
    // the random(25).
    expect(rolls.filter((n) => n === 25)).toHaveLength(500);
    const others = [600, 17, 12, 350, 4000]; // regrowth, a sampled tile's x and y, the save
    expect(new Set(rolls.filter((n) => !others.includes(n)))).toEqual(new Set([25, 3]));
  });

  test("no roll while Turn is held: turning is checked first", () => {
    const rng = scriptedRng([1]);
    const map = testMap("x1000y992");
    const { join, run } = setup([map], undefined, rng);
    const a = player("a", map, 5, 5);
    const b = player("b", map, 6, 5);
    join(a);
    join(b);
    setHeld(a, "R", true);
    run(3);
    expect(b.x).toBe(6);
  });
});

describe("the roll against a standing player", () => {
  test("a hit prints the shove line to the victim only and moves it one step", () => {
    const map = testMap("x1000y992");
    const { join, run } = setup([map], undefined, ALWAYS());
    const a = player("a", map, 5, 5);
    const b = player("b", map, 6, 5);
    join(a);
    join(b);
    setHeld(a, "R", false);
    const out = run(1);
    expect(chatTo(out, "b")).toEqual(["a shoves you out of the way."]);
    expect(chatTo(out, "a")).toEqual([]);
    // 16 calls, one used by actor pass 2 the same frame.
    expect([b.x, b.y, b.facing, b.stepFrames, b.n]).toEqual([7, 5, "E", 15, 1]);
    // a stays put this tick, facing the push.
    expect([a.x, a.facing]).toEqual([5, "E"]);
  });

  test("bug fixed: a weaker pusher is 'too weak' and does not shove", () => {
    const map = testMap("x1000y992");
    const { join, run } = setup([map], undefined, ALWAYS());
    const a = player("a", map, 5, 5);
    const b = player("b", map, 6, 5);
    a.char.stats.str = 3;
    b.char.stats.str = 15;
    join(a);
    join(b);
    setHeld(a, "R", false);
    const out = run(1);
    expect(chatTo(out, "b")).toEqual(["a attempts to shove you out of the way but is too weak."]);
    expect(b.x).toBe(6);
    expect(b.stepFrames).toBe(0);
  });

  test("equal strength is not 'too weak'", () => {
    const map = testMap("x1000y992");
    const { join, run } = setup([map], undefined, ALWAYS());
    const a = player("a", map, 5, 5);
    const b = player("b", map, 6, 5);
    join(a);
    join(b);
    setHeld(a, "R", false);
    expect(chatTo(run(1), "b")).toEqual(["a shoves you out of the way."]);
  });

  test("immortals are immune", () => {
    const map = testMap("x1000y992");
    const { join, run } = setup([map], undefined, ALWAYS());
    const a = player("a", map, 5, 5);
    const b = player("b", map, 6, 5);
    b.role = "immortal";
    join(a);
    join(b);
    setHeld(a, "R", false);
    expect(chatTo(run(5), "b")).toEqual([]);
    expect(b.x).toBe(6);
  });

  test("a player still loading its map is immune (SSO key lock)", () => {
    const map = testMap("x1000y992");
    const { join, run } = setup([map], undefined, ALWAYS());
    const a = player("a", map, 5, 5);
    const b = player("b", map, 6, 5);
    join(a);
    join(b);
    b.loading = 50;
    setHeld(a, "R", false);
    expect(chatTo(run(1), "b")).toEqual([]);
    expect(b.x).toBe(6);
  });

  test("the forced move runs the victim's checks: a tree stops it silently, facing the push", () => {
    const map = testMap("x1000y992", [[7, 5]]);
    const { join, run } = setup([map], undefined, ALWAYS());
    const a = player("a", map, 5, 5);
    const b = player("b", map, 6, 5);
    join(a);
    join(b);
    setHeld(a, "R", false);
    const out = run(1);
    expect(chatTo(out, "b")).toEqual(["a shoves you out of the way."]);
    expect([b.x, b.facing]).toEqual([6, "E"]);
  });

  test("a victim holding Turn only turns to face the push", () => {
    const map = testMap("x1000y992");
    const { join, run } = setup([map], undefined, ALWAYS());
    const a = player("a", map, 5, 5);
    const b = player("b", map, 6, 5);
    join(a);
    join(b);
    setHeld(b, null, true);
    setHeld(a, "R", false);
    run(1);
    expect([b.x, b.facing]).toEqual([6, "E"]);
  });

  test("pushes chain: the victim, blocked by a third player, rolls its own push", () => {
    const map = testMap("x1000y992");
    const { join, run } = setup([map], undefined, ALWAYS());
    const a = player("a", map, 5, 5);
    const b = player("b", map, 6, 5);
    const c = player("c", map, 7, 5);
    join(a);
    join(b);
    join(c);
    setHeld(a, "R", false);
    const out = run(1);
    expect(chatTo(out, "b")).toEqual(["a shoves you out of the way."]);
    expect(chatTo(out, "c")).toEqual(["b shoves you out of the way."]);
    expect(c.x).toBe(8);
    expect(b.x).toBe(6); // b's own step was blocked by c, who was still standing
  });

  test("others see the pushed player's step", () => {
    const map = testMap("x1000y992");
    const { join, run } = setup([map], undefined, ALWAYS());
    const a = player("a", map, 5, 5);
    const b = player("b", map, 6, 5);
    join(a);
    join(b);
    setHeld(a, "R", false);
    const out = run(1);
    const deltas = out.flatMap((o) =>
      o.to === "a" && o.msg.t === "delta" ? o.msg.events.map((e) => e.e) : [],
    );
    expect(deltas).toContain("move");
    expect(out.some((o) => o.to === "b" && o.msg.t === "you")).toBe(true);
  });

  test("pushed off the screen edge: the victim changes map", () => {
    const map = testMap("x1000y992");
    const east = testMap("x1001y992");
    const { join, run, world } = setup([map, east], undefined, ALWAYS());
    const a = player("a", map, 16, 5);
    const b = player("b", map, 17, 5);
    join(a);
    join(b);
    setHeld(a, "R", false);
    run(1);
    expect([b.map.name, b.x, b.y]).toEqual(["x1001y992", 1, 5]);
    expect(world.rooms.get("x1001y992")?.players).toEqual([b]);
  });
});
