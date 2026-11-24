/**
 * Casting on the classic layout: the armed cursor casts on any pointer-down in the cast area,
 * whatever the pointer.
 */
import { afterEach, describe, expect, test } from "bun:test";

import type { AssetIndex } from "@secondstaronline/data";
import { PLAYFIELD_RECT, type ServerMsg } from "@secondstaronline/shared";

import { type App, runApp } from "../src/app.ts";
import type { Assets } from "../src/assets.ts";
import type { Connection } from "../src/net.ts";
import { PLAYFIELD_H, PLAYFIELD_W } from "../src/playfield.ts";

const fakeAssets: Assets = {
  index: { version: 1, inputHash: "", atlases: {} as AssetIndex["atlases"], ui: {}, sounds: {} },
  sheets: {},
  loadGroup: async () => {},
  sprite: () => undefined,
  ui: (cast, member) => `/assets/ui/${cast.toLowerCase()}-${member}.png`,
  hash: null,
  reload: async () => [],
  onReload: () => {},
};

const welcome: ServerMsg = {
  t: "welcome",
  protocol: 1,
  id: "me",
  name: "Me",
  token: "00000000-0000-4000-8000-000000000000",
  resumed: false,
  rules: { chatMaxChars: 200 },
};

let app: App | null = null;
afterEach(() => {
  app?.stop();
  app = null;
  document.body.replaceChildren();
  try {
    localStorage.clear();
  } catch {}
});

/** The game at 800×600 with Minor Heal selected on the Spellbook tab. */
function game() {
  window.innerWidth = 800;
  window.innerHeight = 600;
  const root = document.createElement("div");
  document.body.append(root);
  const sent: unknown[] = [];
  const c: Connection = {
    send: (m) => sent.push(m),
    close: () => {},
    onMessage: () => {},
    onGone: () => {},
    token: null,
  };
  app = runApp(root, fakeAssets, c);
  c.onMessage(welcome);
  c.onMessage({ t: "spellbook", spells: ["Minor Heal"] });
  const q = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
  q(".spell-line").click();
  // The playfield drawn at 1:1 from the page's top-left (happy-dom does no layout).
  const canvas = q<HTMLCanvasElement>("canvas.playfield");
  canvas.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: PLAYFIELD_W, height: PLAYFIELD_H, right: PLAYFIELD_W }) as DOMRect;
  const down = (pointerType: string, x: number, y: number, target: Element = canvas) =>
    target.dispatchEvent(
      new PointerEvent("pointerdown", {
        pointerType,
        pointerId: 7,
        clientX: x,
        clientY: y,
        bubbles: true,
      }),
    );
  const casts = () => sent.filter((m) => (m as { t: string }).t === "cast");
  const arm = () => q<HTMLButtonElement>(".spell-cast").click();
  return { root, q, down, casts, arm };
}

describe("casting from the armed cursor", () => {
  test("the armed cursor casts on any mouse-down in the cast area, the panel's left strip included", () => {
    const s = game();
    s.down("mouse", 100, 100);
    expect(s.casts()).toEqual([]); // not armed
    s.arm();
    s.down("mouse", 100, 100);
    expect(s.casts()).toEqual([
      { t: "cast", spell: "Minor Heal", x: PLAYFIELD_RECT.left + 100, y: PLAYFIELD_RECT.top + 100 },
    ]);
    // A cast never disarms; the cast button does.
    s.down("mouse", 120, 120);
    expect(s.casts()).toHaveLength(2);
    s.arm();
    s.down("mouse", 120, 120);
    expect(s.casts()).toHaveLength(2);
  });

  test("SSO: a touch or pen pointer-down casts as a mouse-down does", () => {
    for (const kind of ["touch", "pen"]) {
      const s = game();
      s.down(kind, 100, 100);
      expect(s.casts()).toEqual([]);
      s.arm();
      s.down(kind, 100, 100);
      expect(s.casts()).toEqual([
        {
          t: "cast",
          spell: "Minor Heal",
          x: PLAYFIELD_RECT.left + 100,
          y: PLAYFIELD_RECT.top + 100,
        },
      ]);
      app?.stop();
      document.body.replaceChildren();
    }
  });

  test("bug fixed: the point must be on the playfield, not 1.6's wider 8 < H < 580, 5 < V < 420", () => {
    const s = game();
    s.arm();
    // Stage H = 30 + clientX: −21 is H 9, inside 1.6's bounds but off the playfield; 0 is H 30.
    s.down("mouse", -21, 100);
    expect(s.casts()).toEqual([]);
    s.down("mouse", 0, 100);
    expect(s.casts()).toHaveLength(1);
    // The playfield's bottom-right pixel, stage (573, 414), is inside.
    s.down("mouse", PLAYFIELD_W - 1, PLAYFIELD_H - 1);
    expect(s.casts()).toHaveLength(2);
  });

  test("switching tabs disarms, as leaving frame 67 did", () => {
    const s = game();
    s.arm();
    s.q<HTMLButtonElement>('.tab-hit[aria-label="Stats"]').click();
    s.down("mouse", 100, 100);
    expect(s.casts()).toEqual([]);
  });

  test("a pointer-down on the menu bar or a floating window does not cast", () => {
    const s = game();
    s.arm();
    s.down("mouse", 100, 100, s.q(".menu-bar-holder"));
    s.down("mouse", 100, 100, s.q(".window-layer"));
    expect(s.casts()).toEqual([]);
  });
});
