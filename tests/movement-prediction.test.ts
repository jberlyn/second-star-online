import { describe, expect, test } from "bun:test";

import { createInputState, type InputSink, keyDown, keyUp } from "../packages/client/src/input.ts";
import {
  applyDelta,
  applySnapshot,
  applyYou,
  clientTick,
  createModel,
  type Intent,
  walkerPixel,
} from "../packages/client/src/model.ts";
import { setAttackHeld } from "../packages/server/src/systems/combat/melee.ts";
import { scheduleStep, setHeld } from "../packages/server/src/systems/movement/movement.ts";
import { mapView, playerView, selfState } from "../packages/server/src/systems/world/world.ts";
import { player, setup, testMap } from "../packages/server/tests/helpers/sim.ts";
import type { ServerMsg, StepMsg } from "../packages/shared/src/index.ts";

function harness(x = 8) {
  const map = testMap("x1000y992");
  const p = player("me", map, x, 6);
  // An open map to the east, so a walk off the right edge crosses.
  const sim = setup([map, testMap("x1001y992")]);
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
    attack(held) {
      // As the app does: mirror the server's latch for the attack-lock prediction.
      if (held && !intent.attackHeld) {
        intent.attackPress = 0;
      }
      intent.attackHeld = held;
    },
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
            keyDown(h.input, h.sink, { key: "ArrowRight" });
          }
          if (t === 7) {
            keyDown(h.input, h.sink, { key: "ArrowUp" });
          }
          if (t === 8) {
            keyUp(h.input, h.sink, { key: "ArrowRight" });
          }
          if (t === 15) {
            keyDown(h.input, h.sink, { key: "ArrowLeft" });
          }
          if (t === 17) {
            keyUp(h.input, h.sink, { key: "ArrowLeft" });
          }
          if (t === 23) {
            keyDown(h.input, h.sink, { key: "ArrowRight" });
          }
          if (t === 24) {
            keyUp(h.input, h.sink, { key: "ArrowUp" });
          }
          if (t === 31) {
            keyDown(h.input, h.sink, { key: "ArrowLeft" });
          }
          if (t === 33) {
            keyUp(h.input, h.sink, { key: "ArrowRight" });
          }
          if (t === 40) {
            keyUp(h.input, h.sink, { key: "ArrowLeft" });
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
          clientTick(h.m, h.intent, (step) => {
            const seq = h.request();
            requests.push({
              due: t + (delay === "variable" ? (t * 7) % 11 : delay),
              msg: { t: "step", seq, ...step },
            });
            return seq;
          });
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

  test("turn requests face without moving, and a scheduled step waits out the attack animation", () => {
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
    // No step starts during the animation; the request waits, then walks unrefused.
    h.sim.run();
    expect(h.p).toMatchObject({ x: 8, y: 6, n: 0 });
    h.sim.run();
    expect(h.p).toMatchObject({ x: 8, y: 6, n: 0 });
    expect(h.p.walkQueue).toHaveLength(1);
    h.sim.run();
    expect(h.p).toMatchObject({ x: 8, y: 5, n: 1 });
    expect(h.p.moveRejected).toBeUndefined();
  });

  test("a hold or the death lock still refuses scheduled steps", () => {
    for (const lock of ["hold", "dead"] as const) {
      const h = harness();
      if (lock === "hold") {
        h.p.spell.hold = 10;
      } else {
        h.p.deadLock = 10;
      }
      scheduleStep(h.p, {
        t: "step",
        seq: 1,
        dir: "U",
        turn: false,
        at: { map: h.p.map.name, n: 0, x: 8, y: 6 },
      });
      h.sim.run();
      expect(h.p).toMatchObject({ x: 8, y: 6, n: 0, moveRejected: 1 });
      expect(h.p.walkQueue).toHaveLength(0);
    }
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
    expect(h.p.map.name).toBe("x1001y992");
    expect(h.p.walkQueue).toHaveLength(0);
    expect(h.p.held).toBeNull();
  });

  test("stale origins, loading and key locks cannot author movement", () => {
    for (const reason of ["origin", "loading", "lock"]) {
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
      scheduleStep(h.p, msg);
      h.sim.run();
      expect(h.p).toMatchObject({ x: 8, y: 6, n: 0 });
      expect(h.p.moveRejected).toBe(1);
      expect(h.p.walkQueue).toHaveLength(0);
    }
  });

  test("a queue flood refuses only the overflowing request", () => {
    const h = harness();
    for (let i = 0; i < 5; i++) {
      scheduleStep(h.p, {
        t: "step",
        seq: i + 1,
        dir: "R",
        turn: false,
        at: { map: h.p.map.name, n: i, x: 8 + i, y: 6 },
      });
    }
    expect(h.p.moveRejected).toBe(5);
    expect(h.p.walkQueue?.map((q) => q.seq)).toEqual([1, 2, 3, 4]);
    h.sim.run();
    expect(h.p).toMatchObject({ x: 9, y: 6, n: 1 });
  });

  test("a refusal names only the refused request and keeps the requests queued behind it", () => {
    const h = harness();
    h.p.map.walk[5]![8] = false;
    const at = (n: number, x: number) => ({ map: h.p.map.name, n, x, y: 6 });
    scheduleStep(h.p, { t: "step", seq: 1, dir: "R", turn: false, at: at(0, 8) });
    scheduleStep(h.p, { t: "step", seq: 2, dir: "R", turn: false, at: at(1, 9) });
    scheduleStep(h.p, { t: "step", seq: 3, dir: "U", turn: false, at: at(0, 8) });
    h.sim.run();
    expect(h.p).toMatchObject({ x: 8, y: 6, n: 0, moveRejected: 1 });
    expect(h.p.walkQueue?.map((q) => q.seq)).toEqual([2, 3]);
    // The stale follow-on is refused on its own; the corrected request still walks.
    h.sim.run(10);
    expect(h.p).toMatchObject({ x: 8, y: 5, n: 1, moveRejected: 2 });
  });
});

/**
 * Runs client and server with `delay` ticks each way. `script` presses keys on the client; the
 * attack key reaches the server with the same delay as the steps. Returns the ticks on which a
 * server correction moved the client's walker back (a visible snap).
 */
function runLatency(
  h: ReturnType<typeof harness>,
  delay: number,
  ticks: number,
  script: (t: number, sink: InputSink) => void,
): number[] {
  const toServer: { due: number; send: () => void }[] = [];
  const replies: { due: number; msg: ServerMsg }[] = [];
  const snaps: number[] = [];
  const sink: InputSink = {
    ...h.sink,
    attack(held) {
      h.sink.attack(held);
      toServer.push({ due: h.m.tick + delay, send: () => setAttackHeld(h.p, held) });
    },
  };
  for (let t = 0; t < ticks; t++) {
    script(t, sink);
    clientTick(h.m, h.intent, (step) => {
      const seq = h.request();
      toServer.push({ due: t + delay, send: () => scheduleStep(h.p, { t: "step", seq, ...step }) });
      return seq;
    });
    while (toServer[0] && toServer[0].due <= t) {
      toServer.shift()!.send();
    }
    for (const { msg } of h.sim.run()) {
      replies.push({ due: t + delay, msg });
    }
    while (replies[0] && replies[0].due <= t) {
      const { msg } = replies.shift()!;
      if (msg.t === "delta") {
        applyDelta(h.m, msg.events);
        continue;
      }
      if (msg.t !== "you") {
        continue;
      }
      const s = h.m.self!;
      const before = walkerPixel(s.x, s.y, s.facing, s.stepFrames);
      applyYou(h.m, msg.self);
      const after = walkerPixel(s.x, s.y, s.facing, s.stepFrames);
      if (after.px < before.px) {
        snaps.push(t);
      }
    }
  }
  return snaps;
}

describe("scheduled movement under latency", () => {
  for (const delay of [2, 4, 6, 10]) {
    test(`a step only the server sees blocked corrects and walking resumes with ${delay} ticks latency`, () => {
      const h = harness(2);
      // A wall the client does not know about, removed at tick 20.
      h.p.map.walk[5]![2] = false;
      const snaps = runLatency(h, delay, 90, (t, sink) => {
        if (t === 0) {
          keyDown(h.input, sink, { key: "ArrowRight" });
        }
        if (t === 20) {
          h.p.map.walk[5]![2] = true;
        }
        if (t === 70) {
          keyUp(h.input, sink, { key: "ArrowRight" });
        }
      });
      // Corrections only while the wall stands and for the requests already in flight.
      const settled = 20 + 2 * delay + 8;
      expect(snaps.filter((t) => t > settled)).toEqual([]);
      // Seven tiles in the fifty ticks after the wall goes, as without latency.
      expect(h.p.x).toBeGreaterThanOrEqual(8);
      expect(h.m.self).toMatchObject({ x: h.p.x, y: h.p.y, n: h.p.n, stepFrames: 0 });
    });

    test(`a bow out of crystals predicts no lock, so walking never stalls, with ${delay} ticks latency`, () => {
      const walk = (bow: boolean) => {
        const h = harness(2);
        if (bow) {
          h.p.char.equip.weapon = "Wooden Bow";
          h.p.char.equip.offHand = "Blue Arrows";
          h.m.inv = { gold: 0, bag: [], equip: { ...h.p.char.equip } };
        }
        const path: number[] = [];
        const snaps = runLatency(h, delay, 80, (t, sink) => {
          const s = h.m.self!;
          path.push(walkerPixel(s.x, s.y, s.facing, s.stepFrames).px);
          if (t === 0) {
            keyDown(h.input, sink, { key: "ArrowRight" });
            if (bow) {
              keyDown(h.input, sink, { key: "Tab" });
            }
          }
          if (t === 60) {
            keyUp(h.input, sink, { key: "Tab" });
            keyUp(h.input, sink, { key: "ArrowRight" });
          }
        });
        expect(snaps).toEqual([]);
        expect(h.m.self).toMatchObject({ x: h.p.x, n: h.p.n, stepFrames: 0 });
        return path;
      };
      // Held attack with no crystals walks exactly as without attacking: never a predicted pause.
      expect(walk(true)).toEqual(walk(false));
    });

    test(`attacking while walking never sends a step the server refuses with ${delay} ticks latency`, () => {
      const h = harness(2);
      const snaps = runLatency(h, delay, 120, (t, sink) => {
        const tab = (down: boolean) =>
          down ? keyDown(h.input, sink, { key: "Tab" }) : keyUp(h.input, sink, { key: "Tab" });
        if (t === 0) {
          keyDown(h.input, sink, { key: "ArrowRight" });
        }
        // Taps at different points of a step, then a held attack (a swing every 15 ticks).
        if (t === 5 || t === 10 || t === 21) {
          tab(true);
        }
        if (t === 6 || t === 11 || t === 22) {
          tab(false);
        }
        if (t === 30) {
          tab(true);
        }
        if (t === 100) {
          tab(false);
          keyUp(h.input, sink, { key: "ArrowRight" });
        }
      });
      expect(snaps).toEqual([]);
      expect(h.p.moveRejected).toBeUndefined();
      expect(h.p.x).toBeGreaterThan(5);
      expect(h.m.self).toMatchObject({ x: h.p.x, y: h.p.y, n: h.p.n, stepFrames: 0 });
    });
  }
});
