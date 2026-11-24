/**
 * Pins for docs/differences-from-fso.md: the paperdoll's bare character centred in the middle
 * equipment box, wherever gear would draw.
 */
import { afterEach, describe, expect, test } from "bun:test";

import type { AssetIndex } from "@secondstaronline/data";
import { emptyBag, NO_EQUIPMENT, PAPERDOLL_SIZE, paperdollLayers } from "@secondstaronline/shared";

import type { Assets } from "../src/assets.ts";
import { createPanel } from "../src/ui/panel.ts";

const PANEL_X = 566;
type Rect = { x0: number; y0: number; x1: number; y1: number };

/**
 * A 2D context that records opaque pixels: `drawImage` from the fake sheet fills the drawn layer's
 * opaque rectangle (keyed by its source x), and `getImageData` reads them back.
 */
function fakeContext(canvas: HTMLCanvasElement, opaque: Map<number, Rect>) {
  let alpha = new Uint8ClampedArray(canvas.width * canvas.height);
  const ctx: Record<string, unknown> = {
    canvas,
    clearRect: () => {
      alpha = new Uint8ClampedArray(canvas.width * canvas.height);
    },
    drawImage: (_img: unknown, sx: number, _sy: number, _w: number, _h: number, dx = 0, dy = 0) => {
      const r = opaque.get(sx);
      if (!r) {
        return;
      }
      for (let y = r.y0 + dy; y <= r.y1 + dy; y++) {
        for (let x = r.x0 + dx; x <= r.x1 + dx; x++) {
          if (x >= 0 && y >= 0 && x < canvas.width && y < canvas.height) {
            alpha[y * canvas.width + x] = 255;
          }
        }
      }
    },
    getImageData: (_x: number, _y: number, w: number, h: number) => {
      const data = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < w * h; i++) {
        data[i * 4 + 3] = alpha[i] ?? 0;
      }
      return { data, width: w, height: h };
    },
  };
  return new Proxy(ctx, { get: (t, k: string) => (k in t ? t[k] : () => {}) });
}

const realGetContext = HTMLCanvasElement.prototype.getContext;
afterEach(() => {
  HTMLCanvasElement.prototype.getContext = realGetContext;
  document.body.replaceChildren();
});

describe("Equipment icons, × markers and the paperdoll centred on their boxes", () => {
  test("design change: the bare character's pixels sit centred in x 676-710, y 306-359; gear does not move it", () => {
    // Bare body layers draw inside x 5..33, y 4..41 of the 46×45 frame; any gear layer fills the
    // whole frame, so centring on it would put the doll elsewhere.
    const bare = new Set(paperdollLayers({ head: 1 }, "F2", "S"));
    const BODY: Rect = { x0: 8, y0: 12, x1: 30, y1: 41 };
    const HEAD: Rect = { x0: 5, y0: 4, x1: 33, y1: 20 };
    const GEAR: Rect = { x0: 0, y0: 0, x1: PAPERDOLL_SIZE.w - 1, y1: PAPERDOLL_SIZE.h - 1 };
    const opaque = new Map<number, Rect>();
    const ids = new Map<string, number>();
    const sprite = (group: string, name: string) => {
      if (group !== "paperdoll") {
        return undefined;
      }
      let id = ids.get(name);
      if (id === undefined) {
        id = ids.size + 1;
        ids.set(name, id);
        opaque.set(id, !bare.has(name) ? GEAR : name.startsWith("Head") ? HEAD : BODY);
      }
      return [0, id, 0, PAPERDOLL_SIZE.w, PAPERDOLL_SIZE.h, 0, 0] as never;
    };
    const contexts = new WeakMap<HTMLCanvasElement, unknown>();
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
      let c = contexts.get(this);
      if (!c) {
        c = fakeContext(this, opaque);
        contexts.set(this, c);
      }
      return c;
    } as never;
    const assets: Assets = {
      index: {
        version: 1,
        inputHash: "",
        atlases: {} as AssetIndex["atlases"],
        ui: {},
        sounds: {},
      },
      sheets: { paperdoll: [{} as never] } as never,
      loadGroup: async () => {},
      sprite: sprite as never,
      ui: (cast, member) => `/assets/ui/${cast.toLowerCase()}-${member}.png`,
      hash: null,
      reload: async () => [],
      onReload: () => {},
    };
    const panel = createPanel(assets, {
      use: () => {},
      equip: () => {},
      drop: () => {},
      give: () => {},
      unequip: () => {},
      crystals: () => {},
      oneCrystal: () => {},
      stack: () => {},
      arrange: () => {},
      gold: () => {},
      sound: () => {},
      canModify: () => true,
      say: () => {},
    });
    const doll = panel.el.querySelector<HTMLCanvasElement>("canvas.doll");
    if (!doll) {
      throw new Error("no doll");
    }
    const place = () => [
      Number.parseFloat(doll.style.left) + PANEL_X,
      Number.parseFloat(doll.style.top),
    ];
    // 1.6's score loc before anything is drawn.
    expect(place()).toEqual([673, 319]);
    // The first inventory already wears gear.
    panel.setInventory(
      {
        gold: 0,
        bag: emptyBag(),
        equip: {
          ...NO_EQUIPMENT,
          head: "Chain Helm",
          body: "Robe",
          feet: "Boots",
          weapon: "Knife",
        },
      },
      1,
    );
    const [left, top] = place() as [number, number];
    // The bare character's drawn bounds (x 5..33, y 4..41) on the stage.
    const drawn = { x0: left + 5, x1: left + 33, y0: top + 4, y1: top + 41 };
    expect(drawn.x0).toBeGreaterThanOrEqual(676);
    expect(drawn.x1).toBeLessThanOrEqual(710);
    expect(drawn.y0).toBeGreaterThanOrEqual(306);
    expect(drawn.y1).toBeLessThanOrEqual(359);
    expect(Math.abs((drawn.x0 + drawn.x1 + 1) / 2 - (676 + 711) / 2)).toBeLessThanOrEqual(0.5);
    expect(Math.abs((drawn.y0 + drawn.y1 + 1) / 2 - (306 + 360) / 2)).toBeLessThanOrEqual(0.5);
    expect([left, top]).toEqual([674, 310]);
    // Other gear, then none: the doll stays put.
    panel.setInventory(
      {
        gold: 0,
        bag: emptyBag(),
        equip: { ...NO_EQUIPMENT, offHand: "Shield", ring: "Ring", weapon: "Long Sword" },
      },
      1,
    );
    expect(place()).toEqual([674, 310]);
    panel.setInventory({ gold: 0, bag: emptyBag(), equip: NO_EQUIPMENT }, 1);
    expect(place()).toEqual([674, 310]);
  });
});
