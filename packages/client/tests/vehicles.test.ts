/**
 * Client tests: a rider is known by body 57, as 1.6's peers knew it.
 */
import { describe, expect, test } from "bun:test";

import type { MapView, PlayerView, SelfState } from "@secondstaronline/shared";
import { NO_EQUIPMENT, NO_FOG } from "@secondstaronline/shared";

import {
  applyDelta,
  applySnapshot,
  clientTick,
  createModel,
  type Intent,
  lenOf,
} from "../src/model.ts";
import { bodyFrame } from "../src/playfield.ts";

const rows = (code: string) => Array.from({ length: 12 }, () => Array(17).fill(code).join(" "));
const map: MapView = {
  name: "x1000y992",
  title: "",
  // Water under the whole map: blocked on foot, open to an Airship.
  layers: [rows("W1"), rows("G3"), rows("G3"), rows("5A")],
  signs: ["", "", ""],
  fog: { ...NO_FOG },
};
const view = (id: string, x: number, y: number, body: number | null): PlayerView => ({
  id,
  name: id,
  head: 1,
  x,
  y,
  facing: "E",
  step: null,
  equip: { ...NO_EQUIPMENT },
  body,
});
const self = (s: Partial<SelfState> = {}): SelfState => ({
  n: 0,
  x: 5,
  y: 5,
  facing: "E",
  frames: 0,
  ...s,
});

function setup(body: number | null, peers: PlayerView[] = []) {
  const m = createModel();
  applySnapshot(m, {
    map,
    you: view("me", 5, 5, body),
    self: self(),
    players: peers,
    monsters: [],
  });
  m.loading = false;
  const intent: Intent = { held: null, turn: false, pending: null };
  return { m, intent };
}

describe("a rider on the client (body 57)", () => {
  test("predicts an 8-frame step over water, which blocks on foot", () => {
    const rider = setup(57);
    rider.intent.pending = { dir: "R", turn: false, age: 0 };
    clientTick(rider.m, rider.intent);
    expect(rider.m.self).toMatchObject({ x: 6, stepFrames: 7 }); // 8 calls, one used in pass 2
    const foot = setup(null);
    foot.intent.pending = { dir: "R", turn: false, age: 0 };
    clientTick(foot.m, foot.intent);
    expect(foot.m.self).toMatchObject({ x: 5, stepFrames: 0 });
  });

  test("the step length is 16 calls on foot, 8 aboard", () => {
    expect(lenOf(57)).toBe(8);
    expect(lenOf(null)).toBe(16);
    expect(lenOf(30)).toBe(16);
  });

  test("walks through a standing foot peer, which blocks a walker", () => {
    const { m, intent } = setup(57, [view("bob", 6, 5, null)]);
    intent.pending = { dir: "R", turn: false, age: 0 };
    clientTick(m, intent);
    expect(m.self).toMatchObject({ x: 6 });
  });

  test("a standing rider peer does not block a foot walker", () => {
    const m = createModel();
    const water = {
      ...map,
      layers: [rows("G1"), rows("G3"), rows("G3"), rows("5A")] as MapView["layers"],
    };
    applySnapshot(m, {
      map: water,
      you: view("me", 5, 5, null),
      self: self(),
      players: [view("bob", 6, 5, 57)],
      monsters: [],
    });
    m.loading = false;
    const intent: Intent = { held: null, turn: false, pending: { dir: "R", turn: false, age: 0 } };
    clientTick(m, intent);
    expect(m.self).toMatchObject({ x: 6, facing: "E" });
  });

  test("a body-57 peer animates 8 frames, as the server's move event says", () => {
    const { m } = setup(null, [view("bob", 8, 8, 57)]);
    applyDelta(m, [{ e: "move", id: "bob", x: 9, y: 8, facing: "E", frames: 8 } as never]);
    expect(m.peers.get("bob")?.frames).toBe(8);
    clientTick(m, { held: null, turn: false, pending: null });
    expect(m.peers.get("bob")?.frames).toBe(6); // two calls a tick
  });

  test("a body event makes a peer a rider and back", () => {
    const { m } = setup(null, [view("bob", 8, 8, null)]);
    applyDelta(m, [{ e: "body", id: "bob", body: 57 }]);
    expect(m.peers.get("bob")?.body).toBe(57);
    applyDelta(m, [{ e: "body", id: "bob", body: null }]);
    expect(m.peers.get("bob")?.body).toBeNull();
  });
});

describe("the rider's frames", () => {
  test("standing, the frame cycles F2, F3, F1 on the client's own counter", () => {
    const { m } = setup(57);
    const seen: string[] = [];
    for (let t = 0; t < 6; t++) {
      m.tick = t;
      seen.push(bodyFrame(m, 57, 0));
    }
    expect(seen).toEqual(["F2", "F3", "F1", "F2", "F3", "F1"]);
    m.tick = 1;
    expect(bodyFrame(m, null, 0)).toBe("F2");
  });
  test("mid-step an 8-frame step shows F1, F2, F3, F2 (counters 8, 6, 4, 2)", () => {
    const { m } = setup(57);
    expect([7, 5, 3, 1].map((left) => bodyFrame(m, 57, left))).toEqual(["F1", "F2", "F3", "F2"]);
  });
});
