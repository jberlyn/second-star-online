/**
 * Client: monsters, effects, floaties, the predicted power bar, the bars component and the attack
 * key.
 */

import { describe, expect, test } from "bun:test";

import type { AssetIndex } from "@secondstaronline/data";
import type { MapView, PlayerView, SelfState } from "@secondstaronline/shared";
import { NO_EQUIPMENT, NO_FOG } from "@secondstaronline/shared";

import type { Assets } from "../src/assets.ts";
import { createInputState, type InputSink, keyDown, keyUp } from "../src/input.ts";
import { applyDelta, applySnapshot, clientTick, createModel, type Intent } from "../src/model.ts";
import { createBars } from "../src/ui/bars.ts";
import { createMenuBar } from "../src/ui/menubar.ts";
import { createGameView } from "../src/ui/shells.ts";

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
const self: SelfState = { n: 0, x: 5, y: 5, facing: "N", frames: 0 };
const fakeAssets: Assets = {
  index: { version: 1, inputHash: "", atlases: {} as AssetIndex["atlases"], ui: {}, sounds: {} },
  sheets: {},
  loadGroup: async () => {},
  sprite: () => undefined,
  ui: (cast, member) => `/assets/ui/${cast}-${member}.png`,
};

function setup() {
  const m = createModel();
  applySnapshot(m, {
    map,
    you,
    self,
    players: [],
    monsters: [{ slot: 1, name: "Slime", body: 30, x: 5, y: 4, facing: "S", step: null }],
  });
  m.loading = false;
  const intent: Intent = { held: null, turn: false, pending: null };
  return { m, intent };
}

describe("monsters on the client", () => {
  test("a step animates 16 calls = 8 frames from the start tile", () => {
    const { m, intent } = setup();
    applyDelta(m, [{ e: "mmove", slot: 1, fromX: 5, fromY: 4, toX: 6, toY: 4, facing: "E" }]);
    const mon = m.monsters.get(1);
    expect(mon?.frames).toBe(16);
    for (let i = 0; i < 4; i++) {
      clientTick(m, intent);
    }
    expect(mon?.frames).toBe(8);
    for (let i = 0; i < 4; i++) {
      clientTick(m, intent);
    }
    expect(mon?.frames).toBe(0);
  });

  test("a hit shows the splat for 3 calls = 2 frames and a colour-84 floatie for 30 calls = 15 frames; hitsound plays on channel 2", () => {
    const { m, intent } = setup();
    applyDelta(m, [{ e: "mhit", slot: 1, dmg: 4, kill: false }]);
    expect(m.sounds).toEqual([{ name: "hitsound", ch: 2 }]);
    expect(m.effects).toMatchObject([{ kind: "splat" }]);
    expect(m.floaties).toMatchObject([{ text: "4", color: 84 }]);
    const startY = m.floaties[0]?.py ?? 0;
    clientTick(m, intent);
    // Up 2 px on each of the first two calls, which are one frame.
    expect(m.floaties[0]?.py).toBe(startY - 4);
    expect(m.effects).toMatchObject([{ kind: "splat" }]);
    clientTick(m, intent);
    expect(m.effects).toEqual([]);
    for (let i = 0; i < 12; i++) {
      clientTick(m, intent);
    }
    expect(m.floaties).toHaveLength(1);
    clientTick(m, intent);
    expect(m.floaties).toEqual([]);
  });

  test("divergence: a monster's hit on you shows the number with the splat and hitsound", () => {
    const { m } = setup();
    applyDelta(m, [{ e: "phit", id: "me", text: "4", color: 6, splat: true }]);
    expect(m.floaties).toMatchObject([{ text: "4", color: 6 }]);
    expect(m.effects).toMatchObject([{ kind: "splat" }]);
    expect(m.sounds).toEqual([{ name: "hitsound", ch: 5 }]);
  });

  test("a Parry, Block or Shield floatie has no splat and no sound", () => {
    const { m } = setup();
    applyDelta(m, [{ e: "phit", id: "me", text: "Parry", color: 103, splat: false }]);
    expect(m.floaties).toMatchObject([{ text: "Parry", color: 103 }]);
    expect(m.effects).toEqual([]);
    expect(m.sounds).toEqual([]);
  });

  test("PvP damage carries hitsound in item 6: the splat and hitsound on channel 5", () => {
    const { m } = setup();
    applyDelta(m, [{ e: "phit", id: "me", text: "7", color: 6, splat: true }]);
    expect(m.effects).toMatchObject([{ kind: "splat" }]);
    expect(m.sounds).toEqual([{ name: "hitsound", ch: 5 }]);
  });

  test("a kill removes the monster and shows kill1-kill4, with no floatie; fx on 1 and hitsound on 2", () => {
    const { m } = setup();
    applyDelta(m, [{ e: "mhit", slot: 1, dmg: 4, kill: true }]);
    expect(m.monsters.size).toBe(0);
    expect(m.effects).toMatchObject([{ kind: "kill" }]);
    expect(m.floaties).toEqual([]);
    expect(m.sounds).toEqual([
      { name: "fx", ch: 1 },
      { name: "hitsound", ch: 2 },
    ]);
  });

  test("your swing snaps the predicted bar to the server's", () => {
    const { m, intent } = setup();
    const t = m.self?.timers;
    for (let i = 0; i < 30; i++) {
      clientTick(m, intent);
    }
    expect(t?.bar).toBe(30);
    expect(t?.barMember).toBe(472);
    applyDelta(m, [
      {
        e: "swing",
        id: "me",
        bonus: 3,
        atDelay: 14,
        actionDelay: 14,
        sound: "swordswing",
      },
    ]);
    // The swing plays on channel 3.
    expect([t?.bar, t?.atkAnim, m.sounds]).toEqual([0, 5, [{ name: "swordswing", ch: 3 }]]);
    // No step starts during the 5-frame attack animation.
    intent.held = "R";
    clientTick(m, intent);
    expect(m.self?.x).toBe(5);
  });
});

describe("bars", () => {
  test("HP and SP fill the wooden slot left to right by percentage; the text reads current / max", () => {
    const b = createBars(fakeAssets);
    b.setVitals({ level: 1, hp: 15, hpMax: 20, sp: 20, spMax: 20, exp: 0, expNeeded: 30 });
    const q = (sel: string) => b.el.querySelector(sel) as HTMLElement;
    // The slot is stage x 600-789: 189 px wide, 10 px from the box origin.
    expect(q(".hp-track").style.left).toBe("10px");
    expect(q(".hp-track").style.width).toBe("189px");
    // The depleted part of each slot is a plain black track, not 1.6's darker track sprite.
    expect(q(".hp-track").querySelector("img")).toBeNull();
    expect(q(".sp-track").querySelector("img")).toBeNull();
    expect(q(".hp-fill").style.left).toBe("10px");
    // 15/20 = 75% of 189 = 141.75 px, measured from the slot's left edge.
    expect(q(".hp-fill").style.width).toBe("141.75px");
    expect(q(".sp-fill").style.width).toBe("189px");
    expect(q(".hp-value").textContent).toBe("15 / 20");
    expect(q(".sp-value").textContent).toBe("20 / 20");
    b.setPower(50, 474);
    const power = [...b.el.querySelectorAll("img")].find((i) => i.style.opacity === "0.5");
    expect(power?.style.left).toBe(`${874 - 100 - 81 - 590}px`);
    expect(power?.src.endsWith("internal-474.png")).toBe(true);
  });

  test("a full bar is full at any maximum, and values above 200 are not capped", () => {
    const b = createBars(fakeAssets);
    const q = (sel: string) => b.el.querySelector(sel) as HTMLElement;
    b.setVitals({ level: 1, hp: 20, hpMax: 20, sp: 1029, spMax: 1029, exp: 0, expNeeded: 30 });
    expect(q(".hp-fill").style.width).toBe("189px");
    expect(q(".sp-fill").style.width).toBe("189px");
    b.setVitals({ level: 1, hp: 1, hpMax: 200, sp: 10, spMax: 1000, exp: 0, expNeeded: 30 });
    expect(q(".hp-fill").style.width).toBe("0.95px");
    expect(q(".sp-fill").style.width).toBe("1.89px");
    expect(q(".hp-value").textContent).toBe("1 / 200");
    expect(q(".sp-value").textContent).toBe("10 / 1000");
  });

  test("each bar's text field sits in that bar's own hover zone", () => {
    const b = createBars(fakeAssets);
    b.setVitals({ level: 1, hp: 15, hpMax: 20, sp: 20, spMax: 20, exp: 0, expNeeded: 30 });
    const hpValue = b.el.querySelector(".hp-value") as HTMLElement;
    const spValue = b.el.querySelector(".sp-value") as HTMLElement;
    expect(b.el.querySelector(".hp-hover .hp-value")).toBe(hpValue);
    expect(b.el.querySelector(".sp-hover .sp-value")).toBe(spValue);
    expect(hpValue.getAttribute("aria-hidden")).toBe("true");
    expect(spValue.getAttribute("aria-hidden")).toBe("true");
  });

  test("the desktop stage places the bars", () => {
    const el = (tag: string) => document.createElement(tag);
    const parts = {
      playfield: el("canvas") as HTMLCanvasElement,
      chatLog: el("div"),
      chatInput: el("input") as HTMLInputElement,
      menuBar: createMenuBar([]),
      bars: el("div"),
      panel: el("div"),
      menuLayer: el("div"),
      amount: el("div"),
      shop: el("div"),
      shopBusy: el("img"),
      overlay: el("div"),
      header: el("div"),
      guild: el("div"),
      mail: el("div"),
      board: el("div"),
      paint: el("div"),
      viewer: el("div"),
      slots: el("div"),
      blackjack: el("div"),
    };
    const view = createGameView(fakeAssets, parts);
    expect(view.root.contains(parts.bars)).toBe(true);
    // Stage clips at x 800 (no wrapper zIndex so channels 36-64 and 318-319 keep their order).
    expect(parts.bars.style.left).toBe("590px");
    expect(parts.bars.style.width).toBe("210px");
    expect(parts.bars.style.zIndex).toBe("");
    const edge = view.root.querySelector(".bars-edge") as HTMLElement;
    expect(edge.style.left).toBe("789px");
    expect(edge.style.width).toBe("11px");
    expect(edge.style.zIndex).toBe("320");
  });
});

describe("attack input", () => {
  test("Tab is one hold state", () => {
    const out: string[] = [];
    const sink: InputSink = {
      move: () => {},
      step: () => {},
      attack: (held) => out.push(`attack ${held}`),
      action: () => {},
    };
    const s = createInputState();
    expect(keyDown(s, sink, "Tab", false)).toBe(true);
    keyDown(s, sink, "Tab", false); // key repeat: no change
    keyUp(s, sink, "Tab");
    expect(out).toEqual(["attack true", "attack false"]);
  });
});
