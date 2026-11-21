/**
 * The hover tip over the playfield, in the running app: it names the character under the mouse
 * and keeps out from under the player menu that a click opens at the pointer.
 */
import { afterEach, describe, expect, spyOn, test } from "bun:test";

import type { AssetIndex } from "@secondstaronline/data";
import { type ClientMsg, NO_EQUIPMENT, NO_FOG, type ServerMsg } from "@secondstaronline/shared";

import { type App, runApp } from "../src/app.ts";
import type { Assets } from "../src/assets.ts";
import { walkerPixel } from "../src/model.ts";
import type { Connection } from "../src/net.ts";
import { PLAYFIELD_H, PLAYFIELD_W } from "../src/playfield.ts";

// Every sprite is 64×64 with its registration point in the middle, so a character can be hit.
const fakeAssets: Assets = {
  index: { version: 1, inputHash: "", atlases: {} as AssetIndex["atlases"], ui: {}, sounds: {} },
  sheets: {},
  loadGroup: async () => {},
  sprite: () => [0, 0, 0, 64, 64, 32, 32] as never,
  ui: (cast, member) => `/assets/ui/${cast.toLowerCase()}-${member}.png`,
};

let app: App | null = null;
let raf: ReturnType<typeof spyOn> | null = null;
afterEach(() => {
  app?.stop();
  app = null;
  raf?.mockRestore();
  raf = null;
  document.body.replaceChildren();
});

/** You, standing on tile (5, 5) of a grass map, with the frames run by hand. */
async function onMap() {
  let nextFrame: FrameRequestCallback | undefined;
  raf = spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
    nextFrame = cb;
    return 1;
  });
  const root = document.createElement("div");
  document.body.append(root);
  const sent: ClientMsg[] = [];
  const conn: Connection = {
    send: (m) => sent.push(m),
    close: () => {},
    onMessage: () => {},
    onGone: () => {},
    token: null,
  };
  const receive = (m: ServerMsg) => conn.onMessage(m);
  app = runApp(root, fakeAssets, conn);
  receive({
    t: "welcome",
    protocol: 1,
    id: "me",
    name: "Me",
    token: "00000000-0000-4000-8000-000000000000",
    resumed: false,
    rules: { chatMaxChars: 200 },
  });
  const rows = (code: string) => Array.from({ length: 12 }, () => Array(17).fill(code).join(" "));
  receive({
    t: "snapshot",
    map: {
      name: "x1000y992",
      title: "",
      layers: [rows("G1"), rows("G3"), rows("G3"), rows("5A")],
      signs: ["", "", ""],
      fog: { ...NO_FOG },
    },
    you: {
      id: "me",
      name: "Me",
      head: 1,
      x: 5,
      y: 5,
      facing: "S",
      step: null,
      equip: { ...NO_EQUIPMENT },
      body: null,
    },
    self: { n: 0, x: 5, y: 5, facing: "S", frames: 0 },
    players: [],
    monsters: [],
    ground: [],
  });
  await Bun.sleep(0);
  // The playfield drawn at 1:1 from the page's top-left (happy-dom does no layout).
  const canvas = root.querySelector("canvas.playfield") as HTMLCanvasElement;
  canvas.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: PLAYFIELD_W, height: PLAYFIELD_H, right: PLAYFIELD_W }) as DOMRect;
  const tip = root.querySelector(".hover-tip") as HTMLElement;
  const charMenu = root.querySelector(".char-menu") as HTMLElement;
  const p = walkerPixel(5, 5, "S", 0);
  const you = { x: p.px, y: p.py + 10 }; // inside the character
  const grass = { x: 12 * 32 + 16, y: 9 * 32 + 16 };
  const at = (type: string, pt: { x: number; y: number }) =>
    canvas.dispatchEvent(
      new PointerEvent(type, {
        pointerType: "mouse",
        clientX: pt.x,
        clientY: pt.y,
        bubbles: true,
      }),
    );
  const frame = () => nextFrame?.(performance.now());
  return { tip, charMenu, you, grass, at, frame };
}

describe("the playfield's hover tip", () => {
  test("design change: the character under the mouse is named in the hover tip, not drawn on the map", async () => {
    const s = await onMap();
    s.at("pointermove", s.you);
    s.frame();
    expect([s.tip.hidden, s.tip.textContent]).toEqual([false, "Me"]);
    // Bare grass names nothing.
    s.at("pointermove", s.grass);
    s.frame();
    expect(s.tip.hidden).toBe(true);
  });

  test("design change: the player menu a click opens hides the tip until it closes", async () => {
    const s = await onMap();
    s.at("pointermove", s.you);
    s.frame();
    expect(s.tip.hidden).toBe(false);
    // The click opens the player menu at the pointer; the mouse has not moved since.
    s.at("click", s.you);
    expect(s.charMenu.hidden).toBe(false);
    s.frame();
    expect(s.tip.hidden).toBe(true);
    // Frames go on with the pointer still over you: the tip stays away while the menu is up.
    s.frame();
    s.frame();
    expect(s.tip.hidden).toBe(true);
    // A click on the grass closes the menu; back over you, the tip returns.
    s.at("pointermove", s.grass);
    s.at("click", s.grass);
    expect(s.charMenu.hidden).toBe(true);
    s.at("pointermove", s.you);
    s.frame();
    expect([s.tip.hidden, s.tip.textContent]).toEqual([false, "Me"]);
  });
});
