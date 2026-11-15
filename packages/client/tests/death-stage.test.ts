/**
 * The death frame and the hit blink on the playfield.
 */
import { describe, expect, test } from "bun:test";

import type { AssetIndex } from "@secondstaronline/data";
import { NO_FOG } from "@secondstaronline/shared";

import type { Assets } from "../src/assets.ts";
import { createModel, type Model, onDeath, onRespawnDrawn, type Self } from "../src/model.ts";
import { createPlayfield } from "../src/playfield.ts";

describe("the death stage", () => {
  test("death: black for one draw, then frozen until the respawn map is drawn", () => {
    const m = createModel();
    expect(m.deathStage).toBe("none");
    onDeath(m);
    expect(m.deathStage).toBe("black");
    onRespawnDrawn(m);
    expect(m.deathStage).toBe("none");
  });
});

/** happy-dom has no 2D context: a stub that records every call and accepts the rest. */
function recordingCtx() {
  const calls: { name: string; style: unknown }[] = [];
  const state: Record<string | symbol, unknown> = {};
  const ctx = new Proxy(state, {
    get: (t, k) =>
      k in t
        ? t[k]
        : (...args: unknown[]) => {
            void args;
            calls.push({ name: String(k), style: t.fillStyle });
          },
    set: (t, k, v) => {
      t[k] = v;
      return true;
    },
  });
  return { ctx, calls };
}

function stage(selfHidden: boolean) {
  const { ctx, calls } = recordingCtx();
  const looked: string[] = [];
  const assets: Assets = {
    index: { version: 1, inputHash: "", atlases: {} as AssetIndex["atlases"], ui: {}, sounds: {} },
    sheets: {},
    loadGroup: async () => {},
    sprite: (group, name) => {
      looked.push(`${group}/${name}`);
      return undefined;
    },
    ui: () => "",
  };
  const real = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = (() => ctx) as never;
  const pf = createPlayfield(assets);
  HTMLCanvasElement.prototype.getContext = real;
  const m: Model = createModel();
  const row = Array(17).fill("G1").join(" ");
  const rows = Array<string>(12).fill(row);
  m.map = {
    name: "x1y1",
    title: "",
    layers: [rows, rows, rows, rows],
    signs: ["", "", ""],
    fog: NO_FOG,
  };
  m.self = {
    id: "me",
    name: "me",
    head: 1,
    x: 5,
    y: 5,
    facing: "S",
    stepFrames: 0,
    body: null,
    timers: { atkAnim: 0 },
    spellAnim: 0,
    server: { n: 0, x: 5, y: 5, facing: "S", frames: 0, hidden: selfHidden },
  } as unknown as Self;
  m.ground.set("g", { id: "g", name: "Apple", x: 3, y: 3 });
  return { pf, m, calls, looked };
}

describe("the playfield on the death frame", () => {
  test("black: the map layers and ground items are not drawn; the next draws leave the canvas alone", () => {
    const { pf, m, calls, looked } = stage(false);
    pf.draw(m);
    const lit = calls.filter((c) => c.name === "drawImage").length;
    expect(lit).toBeGreaterThanOrEqual(2); // the base and top layers
    expect(looked.some((n) => n === "items/Apple")).toBe(true);
    calls.length = 0;
    looked.length = 0;
    onDeath(m);
    pf.draw(m);
    expect(calls.some((c) => c.name === "fillRect" && c.style === "#000000")).toBe(true);
    expect(calls.filter((c) => c.name === "drawImage")).toHaveLength(0);
    expect(looked.some((n) => n.startsWith("items/"))).toBe(false);
    expect(m.deathStage).toBe("frozen");
    calls.length = 0;
    pf.draw(m);
    expect(calls).toEqual([]);
    onRespawnDrawn(m);
    pf.draw(m);
    expect(calls.some((c) => c.name === "drawImage")).toBe(true);
  });

  test("the local player is not drawn while self.hidden", () => {
    const shown = stage(false);
    shown.pf.draw(shown.m);
    const hidden = stage(true);
    hidden.pf.draw(hidden.m);
    const bodiesOf = (l: string[]) => l.filter((n) => !n.startsWith("items/"));
    expect(bodiesOf(shown.looked).length).toBeGreaterThan(0);
    expect(bodiesOf(hidden.looked)).toEqual([]);
  });
});
