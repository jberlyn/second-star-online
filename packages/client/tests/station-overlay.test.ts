/**
 * The crafting stations' overlays on the playfield: drawn only while a crafting player faces the
 * station (an SSO change); scenery overlays always draw.
 */
import { describe, expect, test } from "bun:test";

import type { AssetIndex } from "@secondstaronline/data";
import { NO_EQUIPMENT, NO_FOG } from "@secondstaronline/shared";

import type { Assets } from "../src/assets.ts";
import { createModel, type Model, type Self } from "../src/model.ts";
import { createPlayfield } from "../src/playfield.ts";

/** happy-dom has no 2D context: a stub that accepts every call. */
function stubCtx() {
  const state: Record<string | symbol, unknown> = {};
  return new Proxy(state, {
    get: (t, k) => (k in t ? t[k] : () => {}),
    set: (t, k, v) => {
      t[k] = v;
      return true;
    },
  });
}

/** You at (5, 5) facing south at a Stove on (5, 6); a Campfire on (8, 8). */
function stage() {
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
  HTMLCanvasElement.prototype.getContext = (() => stubCtx()) as never;
  const pf = createPlayfield(assets);
  HTMLCanvasElement.prototype.getContext = real;
  const m: Model = createModel();
  const rows = Array<string>(12).fill(Array(17).fill("G1").join(" "));
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
    server: { n: 0, x: 5, y: 5, facing: "S", frames: 0 },
  } as unknown as Self;
  m.ground.set("st", { id: "st", name: "Stove", x: 5, y: 6 });
  m.ground.set("cf", { id: "cf", name: "Campfire", x: 8, y: 8 });
  const drawn = () => {
    looked.length = 0;
    pf.draw(m);
    return looked.filter((n) => /^items\/(SV|CF)-\d$/.test(n)).map((n) => n.slice(6, 8));
  };
  return { m, drawn };
}

describe("station overlays on the playfield", () => {
  test("design change: a Stove's overlay draws only while you craft facing it; a Campfire's always", () => {
    const { m, drawn } = stage();
    expect(drawn()).toEqual(["CF"]);
    (m.self as Self).crafting = true;
    expect(drawn().sort()).toEqual(["CF", "SV"]);
    (m.self as Self).facing = "E";
    expect(drawn()).toEqual(["CF"]);
  });

  test("another player crafting at the Stove animates it for you", () => {
    const { m, drawn } = stage();
    m.peers.set("bob", {
      id: "bob",
      name: "bob",
      head: 1,
      x: 6,
      y: 6,
      facing: "W",
      frames: 0,
      fromX: 6,
      fromY: 6,
      atkAnim: 0,
      equip: { ...NO_EQUIPMENT },
      body: null,
      spellAnim: 0,
      crafting: true,
    });
    expect(drawn().sort()).toEqual(["CF", "SV"]);
  });
});
