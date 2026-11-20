/**
 * Sim tests: the High Score Statue and the ranking checked with each periodic save.
 */
import { describe, expect, test } from "bun:test";

import {
  ADMINISTRATOR,
  highScorePoints,
  type ServerMsg,
  skillIndex,
} from "@secondstaronline/shared";

import { type ItemCtx, pickupIntent } from "../src/systems/inventory/items.ts";
import { tick } from "../src/systems/world/tick.ts";
import type { GroundItem, Player, Room } from "../src/systems/world/world.ts";
import { NO_CASINO, player, rngByN, setup, testMap } from "./helpers/sim.ts";

type Out = { to: string; msg: ServerMsg }[];
const chat = (msgs: Out, to: string) =>
  msgs.flatMap((m) => (m.to === to && m.msg.t === "chat" ? [m.msg.text] : []));

function scene() {
  const map = testMap("x1000y992");
  const s = setup([map]);
  const rng = rngByN();
  const statue: GroundItem = {
    id: "hs",
    item: "High Score Statue",
    x: 12,
    y: 9,
    kind: "drop",
    expiresAt: null,
  };
  map.ground.push(statue);
  const join = (name: string, x = 5, y = 6): Player => {
    const p = player(name, map, x, y);
    s.join(p);
    return p;
  };
  const room = (): Room => s.world.rooms.get(map.name) as Room;
  const ctx = (): ItemCtx => ({ world: s.world, rng, now: 1_000_000 });
  const deps = {
    loadMap: () => map,
    casino: NO_CASINO,
    saveIntervalTicks: 600,
    rng,
  };
  const run = (n: number) => {
    const all: Out = [];
    for (let i = 0; i < n; i += 1) {
      all.push(...tick(s.world, deps).out);
    }
    return all;
  };
  const click = (p: Player) => {
    p.itemPause = 0;
    return pickupIntent(ctx(), room(), p, "hs");
  };
  return { ...s, join, click, run };
}

describe("high scores", () => {
  test("the statue reads from anywhere: the line, then one block", () => {
    const t = scene();
    const a = t.join("Alice", 1, 1);
    t.world.highScores = [{ id: "bob", name: "Bob", points: 77 }];
    const out = t.click(a);
    const lines = chat(out, "Alice");
    expect(lines[0]).toBe("You read the high score list...");
    expect(lines[1]).toContain("1. Bob - 77 points");
    expect(lines[1]).toContain(`${" ".repeat(25)}Top FSO Player Scores`);
    expect(a.itemPause).toBe(20);
  });

  test("submitted on the save tick only; administrators skipped; five-digit scores count", () => {
    const t = scene();
    const a = t.join("Alice");
    const imm = t.join("King");
    imm.role = ADMINISTRATOR;
    const big = t.join("Big");
    for (const p of [a, imm, big]) {
      p.char.skills[skillIndex("Slash")] = 40;
      p.saveIn = 10;
    }
    big.char.skills[skillIndex("Slash")] = 20000;
    t.run(5);
    expect(t.world.highScores).toEqual([]);
    expect(t.world.highScoresDirty).toBe(false);
    t.run(5);
    const points = (p: Player) =>
      highScorePoints(p.char.skills, p.char.vitals.hpMax, p.char.vitals.spMax);
    expect(points(big)).toBeGreaterThan(9999);
    expect(t.world.highScores).toEqual([
      { id: "Big", name: "Big", points: points(big) },
      { id: "Alice", name: "Alice", points: points(a) },
    ]);
    expect(t.world.highScoresDirty).toBe(true);
  });
});
