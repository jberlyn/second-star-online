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

  test("kept bug: a monster's hit on you shows the number in colour 6 with no splat and no sound", () => {
    const { m } = setup();
    applyDelta(m, [{ e: "phit", id: "me", text: "4", color: 6 }]);
    expect(m.floaties).toMatchObject([{ text: "4", color: 6 }]);
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
  test("the fill sits at 871 − HP, the number rides its left end; the power bar slides 2 px a point", () => {
    const b = createBars(fakeAssets);
    b.setVitals({ level: 1, hp: 15, hpMax: 20, sp: 20, spMax: 20, exp: 0, expNeeded: 30 });
    const imgs = [...b.el.querySelectorAll("img")] as HTMLImageElement[];
    const fill = imgs.find((i) => i.src.endsWith("internal-151.png"));
    const track = imgs.find((i) => i.src.endsWith("internal-150.png"));
    // Box origin x 590: fill locH 856, left 856 − 81 − 590 = 185.
    expect(fill?.style.left).toBe("185px");
    expect(track?.style.left).toBe("180px");
    expect(b.el.querySelector(".hp-value")?.textContent).toBe("15");
    b.setPower(50, 474);
    const power = imgs.find((i) => i.style.opacity === "0.5");
    expect(power?.style.left).toBe(`${874 - 100 - 81 - 590}px`);
    expect(power?.src.endsWith("internal-474.png")).toBe(true);
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

  test("kept bug: at 1 HP/SP the number sits past the 800-px stage edge; above 200 the fill caps and the number spills left", () => {
    const b = createBars(fakeAssets);
    b.setVitals({ level: 1, hp: 1, hpMax: 200, sp: 1029, spMax: 1029, exp: 0, expNeeded: 30 });
    const imgs = [...b.el.querySelectorAll("img")] as HTMLImageElement[];
    const hpFill = imgs.find((i) => i.src.endsWith("internal-151.png"));
    const spFill = imgs.find((i) => i.src.endsWith("internal-153.png"));
    const hpVal = b.el.querySelector(".hp-value") as HTMLElement;
    const spVal = b.el.querySelector(".sp-value") as HTMLElement;
    // HP = 1: fill locH = 870 (left 870 - 81 - 590 = 199), number locH = 768 (left 178, right 802 > 800).
    expect(hpFill?.style.left).toBe("199px");
    expect(hpVal.style.left).toBe("178px");
    expect(hpVal.style.zIndex).toBe("318");
    // SP = 1029: capped at 200 -> fill locH = 671 (left 0), number locH = 569 (left -21, visible over the frame).
    expect(spFill?.style.left).toBe("0px");
    expect(spVal.style.left).toBe("-21px");
    expect(spVal.style.zIndex).toBe("319");
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
