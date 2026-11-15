import { describe, expect, test } from "bun:test";

import { createInputState, type InputSink, keyDown, keyUp } from "../packages/client/src/input.ts";
import {
  applySnapshot,
  applyYou,
  clientTick,
  createModel,
  type Intent,
  walkerPixel,
} from "../packages/client/src/model.ts";
import { scheduleStep, setHeld } from "../packages/server/src/systems/movement/movement.ts";
import { mapView, playerView, selfState } from "../packages/server/src/systems/world/world.ts";
import { player, setup, testMap } from "../packages/server/tests/helpers/sim.ts";
import type { ServerMsg, StepMsg } from "../packages/shared/src/index.ts";

function harness() {
  const map = testMap("x1000y992");
  const p = player("me", map, 8, 6);
  const sim = setup([map]);
  sim.join(p);
  const m = createModel();
  applySnapshot(m, {
    map: mapView(map),
    you: playerView(p),
    self: selfState(p),
    players: [],
    monsters: [],
  });
  m.loading = false;
  const intent: Intent = { held: null, turn: false, pending: null };
  const input = createInputState();
  const sink: InputSink = {
    move(held, turn) {
      intent.held = held;
      intent.turn = turn;
    },
    step(dir, turn) {
      intent.pending = { dir, turn, age: 0 };
    },
    attack() {},
    action() {},
  };
  let seq = 0;
  return { p, sim, m, intent, input, sink, request: () => ++seq };
}

describe("scheduled movement prediction", () => {
  for (const delay of [0, 1, 3, 7, 10, "variable"] as const) {
    for (const serverFirst of [false, true]) {
      test(`overlapping arrows keep the same path with ${delay} ticks latency, server first ${serverFirst}`, () => {
        const h = harness();
        const requests: { due: number; msg: StepMsg }[] = [];
        const replies: { due: number; msg: ServerMsg }[] = [];
        let confirmed = 0;
        for (let t = 0; t < 90; t++) {
          // Turn near step boundaries, briefly hold opposing arrows, then release all keys.
          if (t === 0) {
            keyDown(h.input, h.sink, "ArrowRight", false);
          }
          if (t === 7) {
            keyDown(h.input, h.sink, "ArrowUp", false);
          }
          if (t === 8) {
            keyUp(h.input, h.sink, "ArrowRight");
          }
          if (t === 15) {
            keyDown(h.input, h.sink, "ArrowLeft", false);
          }
          if (t === 17) {
            keyUp(h.input, h.sink, "ArrowLeft");
          }
          if (t === 23) {
            keyDown(h.input, h.sink, "ArrowRight", false);
          }
          if (t === 24) {
            keyUp(h.input, h.sink, "ArrowUp");
          }
          if (t === 31) {
            keyDown(h.input, h.sink, "ArrowLeft", false);
          }
          if (t === 33) {
            keyUp(h.input, h.sink, "ArrowRight");
          }
          if (t === 40) {
            keyUp(h.input, h.sink, "ArrowLeft");
          }
          const serverTick = () => {
            while (requests[0] && requests[0].due <= t) {
              scheduleStep(h.p, requests.shift()!.msg);
            }
            for (const { msg } of h.sim.run()) {
              replies.push({ due: t + (delay === "variable" ? (t * 7) % 11 : delay), msg });
            }
          };
          if (serverFirst) {
            serverTick();
          }
          clientTick(h.m, h.intent, (step) =>
            requests.push({
              due: t + (delay === "variable" ? (t * 7) % 11 : delay),
              msg: { t: "step", seq: h.request(), ...step },
            }),
          );
          if (!serverFirst) {
            serverTick();
          }
          while (replies[0] && replies[0].due <= t) {
            const { msg } = replies.shift()!;
            if (msg.t !== "you") {
              continue;
            }
            const s = h.m.self!;
            const before = walkerPixel(s.x, s.y, s.facing, s.stepFrames);
            const n = s.n;
            applyYou(h.m, msg.self);
            expect(walkerPixel(s.x, s.y, s.facing, s.stepFrames)).toEqual(before);
            expect(s.n).toBe(n);
            expect(msg.self.moveRejected).toBeUndefined();
            confirmed++;
          }
        }
        expect(confirmed).toBeGreaterThan(4);
        expect(h.p.n).toBeGreaterThan(4);
        expect(h.m.self).toMatchObject({ x: h.p.x, y: h.p.y, n: h.p.n, stepFrames: 0 });
        expect(h.m.self?.predicted.size).toBe(0);
      });
    }
  }

  test("queued directions wait for the authoritative step cadence and do not expire mid-step", () => {
    const h = harness();
    scheduleStep(h.p, {
      t: "step",
      seq: 1,
      dir: "R",
      turn: false,
      at: { map: h.p.map.name, n: 0, x: 8, y: 6 },
    });
    h.sim.run();
    scheduleStep(h.p, {
      t: "step",
      seq: 2,
      dir: "U",
      turn: false,
      at: { map: h.p.map.name, n: 1, x: 9, y: 6 },
    });
    setHeld(h.p, "L", false);
    h.sim.run(7);
    expect(h.p).toMatchObject({ x: 9, y: 6, n: 1 });
    h.sim.run();
    expect(h.p).toMatchObject({ x: 9, y: 5, n: 2 });
    h.sim.run(20);
    expect(h.p).toMatchObject({ x: 9, y: 5, n: 2 });
  });

  test("scheduled held updates preserve the push modifier without starting an independent step", () => {
    const h = harness();
    setHeld(h.p, "R", true, true);
    h.sim.run(10);
    expect(h.p).toMatchObject({ x: 8, y: 6, n: 0, held: null, heldTurn: true });
    setHeld(h.p, "R", false, true);
    expect(h.p.heldTurn).toBe(false);
  });

  test("a refused predicted step corrects immediately and cannot bypass collision", () => {
    const h = harness();
    h.intent.held = "R";
    clientTick(h.m, h.intent, (step) => scheduleStep(h.p, { t: "step", seq: 1, ...step }));
    h.p.map.walk[5]![8] = false;
    const reply = h.sim.run().find(({ msg }) => msg.t === "you")?.msg;
    expect(h.p).toMatchObject({ x: 8, y: 6, n: 0, moveRejected: 1 });
    if (reply?.t !== "you") {
      throw new Error("missing correction");
    }
    applyYou(h.m, reply.self);
    expect(h.m.self).toMatchObject({ x: 8, y: 6, n: 0 });
  });

  test("matching blocked predictions do not discard later requests", () => {
    const h = harness();
    h.p.map.walk[5]![8] = false;
    h.m.walk[5]![8] = false;
    h.intent.held = "R";
    clientTick(h.m, h.intent, (step) => scheduleStep(h.p, { t: "step", seq: 1, ...step }));
    h.sim.run();
    expect(h.p).toMatchObject({ x: 8, y: 6, n: 0 });
    expect(h.p.moveRejected).toBeUndefined();
  });

  test("turn requests face without moving, and attacks still lock scheduled steps", () => {
    const h = harness();
    scheduleStep(h.p, {
      t: "step",
      seq: 1,
      dir: "L",
      turn: true,
      at: { map: h.p.map.name, n: 0, x: 8, y: 6 },
    });
    h.sim.run();
    expect(h.p).toMatchObject({ x: 8, y: 6, facing: "W", n: 0 });
    h.p.timers.atkAnim = 5;
    scheduleStep(h.p, {
      t: "step",
      seq: 2,
      dir: "U",
      turn: false,
      at: { map: h.p.map.name, n: 0, x: 8, y: 6 },
    });
    h.sim.run();
    expect(h.p).toMatchObject({ x: 8, y: 6, n: 0 });
    h.sim.run(4);
    expect(h.p).toMatchObject({ x: 8, y: 6, n: 0, moveRejected: 2 });
  });

  test("map entry clears scheduled requests so an edge cannot leave a stale walk behind", () => {
    const h = harness();
    h.p.x = 17;
    for (let i = 1; i <= 2; i++) {
      scheduleStep(h.p, {
        t: "step",
        seq: i,
        dir: "R",
        turn: false,
        at: { map: h.p.map.name, n: 0, x: 17, y: 6 },
      });
    }
    expect(h.sim.run().some(({ msg }) => msg.t === "snapshot")).toBe(true);
    expect(h.p.walkQueue).toHaveLength(0);
    expect(h.p.held).toBeNull();
  });

  test("stale origins, loading, key locks and queue floods cannot author movement", () => {
    for (const reason of ["origin", "loading", "lock", "flood"]) {
      const h = harness();
      if (reason === "loading") {
        h.p.loading = 100;
      }
      if (reason === "lock") {
        h.p.keyLock = true;
      }
      const msg: StepMsg = {
        t: "step",
        seq: 1,
        dir: "R",
        turn: false,
        at: { map: h.p.map.name, n: 0, x: reason === "origin" ? 7 : 8, y: 6 },
      };
      for (let i = 0; i < (reason === "flood" ? 5 : 1); i++) {
        scheduleStep(h.p, { ...msg, seq: i + 1 });
      }
      h.sim.run();
      expect(h.p).toMatchObject({ x: 8, y: 6, n: 0 });
      expect(h.p.moveRejected).toBeGreaterThan(0);
      expect(h.p.walkQueue).toHaveLength(0);
    }
  });
});
