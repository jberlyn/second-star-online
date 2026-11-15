import { describe, expect, test } from "bun:test";

import type { MapView, PlayerView, SelfState } from "@secondstaronline/shared";
import { NO_EQUIPMENT, NO_FOG } from "@secondstaronline/shared";

import {
  animObjFrame,
  applyDelta,
  applySnapshot,
  applyYou,
  clientTick,
  createModel,
  type Intent,
  PREDICTION_TIMEOUT_TICKS,
  walkerPixel,
} from "../src/model.ts";

const rows = (code: string) => Array.from({ length: 12 }, () => Array(17).fill(code).join(" "));
const map: MapView = {
  name: "x1000y992",
  title: "",
  layers: [rows("G1"), rows("G3"), rows("G3"), rows("5A")],
  signs: ["", "", ""],
  fog: { ...NO_FOG },
};
const you: PlayerView = {
  id: "me",
  name: "me",
  head: 1,
  x: 5,
  y: 5,
  facing: "N",
  step: null,
  equip: { ...NO_EQUIPMENT },
  body: null,
};
const self = (s: Partial<SelfState> = {}): SelfState => ({
  n: 0,
  x: 5,
  y: 5,
  facing: "N",
  frames: 0,
  ...s,
});

function setup() {
  const m = createModel();
  applySnapshot(m, { map, you, self: self(), players: [], monsters: [] });
  m.loading = false;
  const intent: Intent = { held: null, turn: false, pending: null };
  return { m, intent };
}

describe("client prediction", () => {
  test("a press steps at once, before the server answers", () => {
    const { m, intent } = setup();
    intent.pending = { dir: "R", turn: false, age: 0 };
    clientTick(m, intent);
    // The step starts in the key poll and actor pass 2 runs one call the same frame.
    expect(m.self).toMatchObject({ x: 6, y: 5, facing: "E", stepFrames: 15, n: 1 });
  });

  test("the server's matching 'you' confirms the step; nothing snaps", () => {
    const { m, intent } = setup();
    intent.pending = { dir: "R", turn: false, age: 0 };
    clientTick(m, intent);
    clientTick(m, intent);
    applyYou(m, self({ n: 1, x: 6, facing: "E", frames: 16 }));
    expect(m.self).toMatchObject({ x: 6, stepFrames: 13, n: 1 }); // two calls a tick
    expect(m.self?.predicted.size).toBe(0);
  });

  test("a 'you' that has not seen the step yet keeps the prediction", () => {
    const { m, intent } = setup();
    intent.pending = { dir: "R", turn: false, age: 0 };
    clientTick(m, intent);
    applyYou(m, self({ n: 0, x: 5, facing: "N" }));
    expect(m.self).toMatchObject({ x: 6, n: 1 });
  });

  test("the server stepping where we did not snaps us to it (a key released late)", () => {
    const { m } = setup();
    applyYou(m, self({ n: 1, x: 5, y: 6, facing: "S", frames: 16 }));
    expect(m.self).toMatchObject({ x: 5, y: 6, facing: "S", stepFrames: 16, n: 1 });
  });

  test("a refused step snaps back on the server's 'you' (blocked by a player it saw)", () => {
    const { m, intent } = setup();
    intent.pending = { dir: "R", turn: false, age: 0 };
    clientTick(m, intent);
    applyYou(m, self({ n: 0, x: 5, facing: "E" })); // ahead: kept for now
    // The server never confirms step 1: after the timeout the client gives up.
    for (let i = 0; i <= PREDICTION_TIMEOUT_TICKS + 1; i++) {
      clientTick(m, intent);
    }
    expect(m.self).toMatchObject({ x: 5, y: 5, n: 0 });
  });

  test("a standing peer blocks the prediction too; a moving one does not", () => {
    const { m, intent } = setup();
    applyDelta(m, [{ e: "enter", player: { ...you, id: "p", name: "p", x: 6, y: 5 } }]);
    intent.pending = { dir: "R", turn: false, age: 0 };
    clientTick(m, intent);
    expect(m.self).toMatchObject({ x: 5, facing: "E" });
    applyDelta(m, [
      { e: "move", id: "p", fromX: 7, fromY: 5, toX: 6, toY: 5, facing: "W", frames: 16 },
    ]);
    intent.pending = { dir: "R", turn: false, age: 0 };
    clientTick(m, intent);
    expect(m.self).toMatchObject({ x: 6 });
  });

  test("no prediction while loading", () => {
    const { m, intent } = setup();
    m.loading = true;
    intent.held = "R";
    clientTick(m, intent);
    expect(m.self?.x).toBe(5);
  });
});

describe("the actor phase runs twice per frame", () => {
  test("a step starts at 16 calls and the next tick has used two of them", () => {
    const { m, intent } = setup();
    intent.pending = { dir: "R", turn: false, age: 0 };
    clientTick(m, intent);
    expect(m.self?.stepFrames).toBe(15);
    clientTick(m, intent);
    expect(m.self?.stepFrames).toBe(13);
    // Three 2 px calls into a 16-call step east into (6,5): 6 px right of (5,5).
    expect(walkerPixel(6, 5, "E", 13)).toEqual({ px: 150, py: 126 });
  });

  test("no step is predicted while the keys are locked", () => {
    const { m, intent } = setup();
    m.keyLock = true;
    intent.held = "R";
    clientTick(m, intent);
    expect(m.self).toMatchObject({ x: 5, stepFrames: 0 });
  });

  test("the key poll runs between the two actor passes", () => {
    const { m, intent } = setup();
    intent.held = "R";
    // Frame 1: pass 1 (idle), the key poll starts the step at 16 calls, pass 2 uses one.
    clientTick(m, intent);
    expect(m.self?.stepFrames).toBe(15);
    // Frames 2-8 use two calls each (15 used); frame 9's pass 1 uses the 16th, so frame 9's
    // key poll starts the next step: still a tile every 8 frames.
    for (let t = 2; t <= 8; t++) {
      clientTick(m, intent);
    }
    expect(m.self).toMatchObject({ x: 6, stepFrames: 1 });
    clientTick(m, intent);
    expect(m.self).toMatchObject({ x: 7, stepFrames: 15 });
  });

  test("a held arrow walks a tile every 8 frames", () => {
    const { m, intent } = setup();
    intent.held = "R";
    const xs: number[] = [];
    for (let t = 0; t < 17; t++) {
      clientTick(m, intent);
      xs.push(m.self?.x ?? 0);
    }
    expect(xs).toEqual([6, 6, 6, 6, 6, 6, 6, 6, 7, 7, 7, 7, 7, 7, 7, 7, 8]);
  });
});

describe("peers", () => {
  test("a move snaps to the start tile and animates 16 calls, 8 frames", () => {
    const { m, intent } = setup();
    applyDelta(m, [{ e: "enter", player: { ...you, id: "p", name: "p", x: 8, y: 8 } }]);
    applyDelta(m, [
      { e: "move", id: "p", fromX: 8, fromY: 8, toX: 9, toY: 8, facing: "E", frames: 16 },
    ]);
    clientTick(m, intent);
    expect(m.peers.get("p")).toMatchObject({ x: 9, frames: 14 });
    applyDelta(m, [
      { e: "turn", id: "p", facing: "S" },
      { e: "leave", id: "p" },
    ]);
    expect(m.peers.has("p")).toBe(false);
  });
});

describe("sprite placement", () => {
  test("standing at (X,Y) the anchor is (X·32−16, Y·32−34) on the playfield", () => {
    expect(walkerPixel(1, 1, "S", 0)).toEqual({ px: 16, py: -2 });
    expect(walkerPixel(6, 4, "N", 0)).toEqual({ px: 176, py: 94 });
  });

  test("mid-step the sprite is 2 px per frame past the start tile", () => {
    // Stepping east into (6,4); after 1 animated frame (15 left) it is 2 px right of (5,4).
    expect(walkerPixel(6, 4, "E", 15)).toEqual({ px: 146, py: 94 });
    expect(walkerPixel(6, 4, "E", 16)).toEqual({ px: 144, py: 94 });
  });
});

describe("door changes", () => {
  test("gset renames the door in place and its tile opens", () => {
    const m = createModel();
    const door = { id: "d1", name: "Steel Door", x: 5, y: 4 };
    const loot = { id: "g2", name: "3 Gold", x: 9, y: 9 };
    applySnapshot(m, { map, you, self: self(), players: [], monsters: [], ground: [door, loot] });
    m.loading = false;
    const intent: Intent = { held: null, turn: false, pending: { dir: "U", turn: false, age: 0 } };
    clientTick(m, intent);
    // A closed Steel Door blocks: the press only turns you.
    expect(m.self).toMatchObject({ x: 5, y: 5 });
    applyDelta(m, [{ e: "gset", id: "d1", name: "Open Steel Door" }]);
    expect([...m.ground.values()].map((g) => g.name)).toEqual(["Open Steel Door", "3 Gold"]);
    intent.pending = { dir: "U", turn: false, age: 0 };
    clientTick(m, intent);
    expect(m.self).toMatchObject({ x: 5, y: 4 });
  });
});

describe("web prediction", () => {
  const web = { slot: 1, name: "Web", body: 92, x: 5, y: 5, facing: "S" as const, step: null };
  const webbed = (body: number | null) => {
    const m = createModel();
    applySnapshot(m, {
      map,
      you: { ...you, body },
      self: self(),
      players: [],
      monsters: [web],
    });
    m.loading = false;
    return m;
  };

  test("prediction: a web under me predicts no step and no turn", () => {
    const m = webbed(null);
    clientTick(m, { held: null, turn: false, pending: { dir: "R", turn: false, age: 0 } });
    expect(m.self).toMatchObject({ x: 5, y: 5, facing: "N", stepFrames: 0, n: 0 });
  });

  test("prediction: aboard an Airship a web is ignored", () => {
    const m = webbed(57);
    clientTick(m, { held: null, turn: false, pending: { dir: "R", turn: false, age: 0 } });
    expect(m.self).toMatchObject({ x: 6, facing: "E" });
  });
});

describe("monster blocking prediction", () => {
  const mon = (slot: number, name: string, body: number, x: number, y: number) => ({
    slot,
    name,
    body,
    x,
    y,
    facing: "S" as const,
    step: null,
  });
  const press = (): Intent => ({
    held: null,
    turn: false,
    pending: { dir: "R", turn: false, age: 0 },
  });

  test("prediction refuses a step into a standing monster and faces it", () => {
    const m = createModel();
    applySnapshot(m, {
      map,
      you,
      self: self(),
      players: [],
      monsters: [mon(1, "Slime", 1, 6, 5)],
    });
    m.loading = false;
    clientTick(m, press());
    expect(m.self).toMatchObject({ x: 5, facing: "E", stepFrames: 0, n: 0 });
  });

  test("slot names: snapshot sets, mspawn sets, mdie keeps, a second snapshot keeps slots it doesn't mention", () => {
    const m = createModel();
    expect(m.slotNames).toEqual([null, null, null, null]);
    applySnapshot(m, {
      map,
      you,
      self: self(),
      players: [],
      monsters: [mon(1, "Slime", 1, 2, 2)],
    });
    expect(m.slotNames).toEqual(["Slime", null, null, null]);
    applyDelta(m, [{ e: "mspawn", monster: mon(3, "Web", 92, 3, 3) }]);
    expect(m.slotNames).toEqual(["Slime", null, "Web", null]);
    applyDelta(m, [{ e: "mgone", slot: 1 }]);
    expect(m.slotNames).toEqual(["Slime", null, "Web", null]);
    applySnapshot(m, {
      map,
      you,
      self: self(),
      players: [],
      monsters: [mon(2, "Overlord", 30, 9, 9)],
    });
    expect(m.slotNames).toEqual(["Slime", "Overlord", "Web", null]);
  });

  test("a remembered Web lets prediction walk into a standing peer", () => {
    const m = createModel();
    applySnapshot(m, {
      map,
      you,
      self: self(),
      players: [{ ...you, id: "p", name: "p", x: 6, y: 5 }],
      monsters: [mon(2, "Web", 92, 12, 9)],
    });
    m.loading = false;
    clientTick(m, press());
    expect(m.self).toMatchObject({ x: 6, facing: "E" });
  });
});

describe("animated-object cycle", () => {
  test("frames 1-4 over a 13-frame cycle held 3, 3, 3, 4 (counts 12, 9, 6, 3 of 13 → 1)", () => {
    const frames = Array.from({ length: 26 }, (_, t) => animObjFrame(t));
    expect(frames.slice(0, 13)).toEqual([1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 4]);
    expect(frames.slice(13)).toEqual(frames.slice(0, 13));
  });
});
