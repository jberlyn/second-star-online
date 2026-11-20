import { describe, expect, test } from "bun:test";

import type { AssetIndex } from "@secondstaronline/data";

import type { Assets } from "../src/assets.ts";
import { createMenuBar } from "../src/ui/menubar.ts";
import { createGameView } from "../src/ui/shells.ts";
import { fitScale } from "../src/ui/stage.ts";

const fakeAssets: Assets = {
  index: { version: 1, inputHash: "", atlases: {} as AssetIndex["atlases"], ui: {}, sounds: {} },
  sheets: {},
  loadGroup: async () => {},
  sprite: () => undefined,
  ui: (cast, member) => `/assets/ui/${cast}-${member}.png`,
};

function parts() {
  const el = (tag: string) => document.createElement(tag);
  return {
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
}

describe("the classic layout at every size", () => {
  test("desktop scale fills the window; sharp pixels forces whole numbers", () => {
    expect(fitScale(1920, 1080, false)).toBeCloseTo(1.8);
    expect(fitScale(1920, 1080, true)).toBe(1);
    expect(fitScale(1600, 1200, true)).toBe(2);
    expect(fitScale(400, 300, true)).toBe(0.5);
  });

  test("the menu bar's 20 px is part of the height", () => {
    expect(fitScale(800, 620, false, 20)).toBe(1);
    expect(fitScale(1600, 1240, true, 20)).toBe(2);
    expect(fitScale(800, 600, false, 20)).toBeCloseTo(600 / 620);
  });

  test("a window smaller than 800×600 gets the classic layout scaled down: 700×400 → scale 400/620", () => {
    expect(fitScale(700, 400, false, 20)).toBeCloseTo(400 / 620);
    const p = parts();
    const view = createGameView(fakeAssets, p);
    document.body.append(view.root);
    view.fit(700, 400, false);
    expect(view.scale).toBeCloseTo(400 / 620);
    expect(view.root.dataset.shell).toBe("desktop");
    expect(view.root.querySelector(".desktop-frame")?.contains(p.menuBar.el)).toBe(true);
    const stage = view.root.querySelector<HTMLElement>(".stage-holder > *");
    expect(stage?.style.transform).toBe(`scale(${400 / 620})`);
    view.root.remove();
  });

  test("the stage puts the playfield and chat at their rects (frame 63)", () => {
    const p = parts();
    const view = createGameView(fakeAssets, p);
    expect(view.root.querySelector("canvas")).toBe(p.playfield);
    expect([p.playfield.style.left, p.playfield.style.top, p.playfield.style.width]).toEqual([
      "30px",
      "31px",
      "544px",
    ]);
    expect([p.chatLog.style.left, p.chatLog.style.top]).toEqual(["20px", "456px"]);
    // The entry fills the frame's lower well, not the score's 756×20 text rect.
    expect([
      p.chatInput.style.left,
      p.chatInput.style.top,
      p.chatInput.style.width,
      p.chatInput.style.height,
    ]).toEqual(["21px", "556px", "760px", "20px"]);
    expect(view.root.querySelector(".turn-btn")).toBeNull();
  });
});

describe("the mail screen's windows", () => {
  test("divergence: the stage places the mail and board at their rects, and nothing blocks the chat entry", () => {
    const p = parts();
    createGameView(fakeAssets, p);
    const at = (el: HTMLElement) => [el.style.left, el.style.top, el.style.width, el.style.height];
    expect(at(p.mail)).toEqual(["154px", "28px", "350px", "350px"]);
    expect(at(p.board)).toEqual(["185px", "14px", "350px", "303px"]);
    // Neither screen's box overlaps the chat entry's, and nothing above the entry covers it
    // except the item menu's layer, which is empty until a bag click.
    const box = (el: HTMLElement) => {
      const [l, t, w, h] = at(el).map((v) => Number.parseFloat(v));
      return { l, t, r: (l ?? 0) + (w ?? 0), b: (t ?? 0) + (h ?? 0) };
    };
    const entry = box(p.chatInput);
    const overlaps = (el: HTMLElement) => {
      const o = box(el);
      return (
        (o.l ?? 0) < entry.r && o.r > (entry.l ?? 0) && (o.t ?? 0) < entry.b && o.b > (entry.t ?? 0)
      );
    };
    expect(overlaps(p.mail)).toBe(false);
    expect(overlaps(p.board)).toBe(false);
    const z = (el: HTMLElement) => Number(el.style.zIndex || 0);
    const covering = Object.entries(p)
      .filter(([k, el]) => k !== "chatInput" && el instanceof HTMLElement && el.style.top !== "")
      .filter(([, el]) => overlaps(el as HTMLElement) && z(el as HTMLElement) > z(p.chatInput))
      .map(([k]) => k);
    expect(covering).toEqual(["menuLayer"]);
    expect(p.menuLayer.childElementCount).toBe(0);
  });
});
