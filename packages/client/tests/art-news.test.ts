/**
 * Client: the paint screen, the painting viewer, the camera lens and the newspaper windows.
 * Rects are checked against the shipped layout data (the main movie's frame 50 and each
 * sub-movie's frame 1).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { AssetIndex } from "@secondstaronline/data";
import { getPaintPixel, quantise } from "@secondstaronline/shared";

import type { Assets } from "../src/assets.ts";
import {
  createNewspaper,
  EDITOR_PHOTO_FIELDS,
  NEWS_FIELDS,
  NEWS_PHOTOS,
  SAVE_PAPER,
} from "../src/ui/newspaper.ts";
import { createPaintUi, PAINT_RECTS } from "../src/ui/paint.ts";
import { createWindowLayer } from "../src/ui/window.ts";

const fakeAssets: Assets = {
  index: { version: 1, inputHash: "", atlases: {} as AssetIndex["atlases"], ui: {}, sounds: {} },
  sheets: {},
  loadGroup: async () => {},
  sprite: () => undefined,
  ui: (cast, member) => `/assets/ui/${cast.toLowerCase()}-${member}.png`,
};

const sprites = (path: string) =>
  (
    JSON.parse(readFileSync(join(import.meta.dir, "../../../assets/original", path), "utf8")) as {
      sprites: { channel: number; rect: number[] }[];
    }
  ).sprites;
const rectOf = (list: { channel: number; rect: number[] }[], ch: number) =>
  list.find((s) => s.channel === ch)?.rect;
const asRect = (r: { x: number; y: number; w: number; h: number }) => [
  r.x,
  r.y,
  r.x + r.w,
  r.y + r.h,
];

/** A 64×64 RGBA picture of one colour, as a decoded PNG. */
const flat = (r: number, g: number, b: number) => {
  const d = new Uint8ClampedArray(64 * 64 * 4);
  for (let i = 0; i < d.length; i += 4) {
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
    d[i + 3] = 255;
  }
  return d;
};

function paintScene(opts: { bagFull?: boolean } = {}) {
  const log: unknown[] = [];
  const state = { locked: false, bagFull: opts.bagFull ?? false };
  const grabs: unknown[] = [];
  const ui = createPaintUi(
    fakeAssets,
    {
      cancel: () => log.push(["cancel"]),
      viewClose: () => log.push(["viewClose"]),
      save: (kind, png) => log.push(["save", kind, png]),
      say: (t) => log.push(["say", t]),
      lock: (on) => {
        state.locked = on;
      },
      bagFull: () => state.bagFull,
      redraw: () => log.push(["redraw"]),
      grab: (crop) => {
        grabs.push(crop);
        return flat(200, 100, 50);
      },
    },
    {
      guiPixel: (x, y) => (x === 7 && y === 9 ? [10, 20, 30] : [1, 2, 3]),
      encode: () => "PNGDATA",
      decode: async () => flat(255, 0, 0),
      random: () => 4,
    },
  );
  document.body.replaceChildren(ui.paint, ui.viewer, ui.lens);
  // happy-dom has no layout: the pointer's client coordinates are GUI-local (scale 1).
  const G = PAINT_RECTS.gui;
  const V = PAINT_RECTS.viewer;
  const fire = (
    el: Element,
    type: string,
    x: number,
    y: number,
    origin: { x: number; y: number },
  ) =>
    el.dispatchEvent(
      new MouseEvent(type, { clientX: x - origin.x, clientY: y - origin.y, bubbles: true }),
    );
  const hit = ui.paint.querySelector(".paint-hit") as HTMLElement;
  const image = ui.paint.querySelector(".paint-image") as HTMLElement;
  const viewerImage = ui.viewer.querySelector(".paint-viewer-image") as HTMLElement;
  const down = (x: number, y: number) => fire(hit, "pointerdown", x, y, G);
  const press = (x: number, y: number) => fire(image, "pointerdown", x, y, G);
  const release = (el: Element = image, x = 300, y = 200) => fire(el, "pointerup", x, y, G);
  const toolSrc = () => (ui.paint.querySelector(".paint-tool") as HTMLImageElement).src;
  return {
    ui,
    log,
    state,
    grabs,
    G,
    V,
    hit,
    image,
    viewerImage,
    down,
    press,
    release,
    fire,
    toolSrc,
  };
}

describe("placement", () => {
  const f50 = sprites("main/layout/frame-50.json");
  test("the swatch, preview, viewed image, author field and tool icon sit at their sprites' rects", () => {
    const s = paintScene();
    const at = (el: Element | null, origin: { x: number; y: number }) => {
      const e = el as HTMLElement;
      const l = Number.parseFloat(e.style.left) + origin.x;
      const t = Number.parseFloat(e.style.top) + origin.y;
      return [l, t, l + Number.parseFloat(e.style.width), t + Number.parseFloat(e.style.height)];
    };
    expect(at(s.ui.paint.querySelector(".paint-swatch"), s.G)).toEqual(
      rectOf(f50, 396) as number[],
    );
    expect(at(s.ui.paint.querySelector(".paint-preview"), s.G)).toEqual(
      rectOf(f50, 397) as number[],
    );
    expect(at(s.viewerImage, s.V)).toEqual(rectOf(f50, 398) as number[]);
    expect(at(s.ui.viewer.querySelector(".paint-author"), s.V)).toEqual(
      rectOf(f50, 373) as number[],
    );
    expect(at(s.ui.paint.querySelector(".paint-tool"), s.G)).toEqual(rectOf(f50, 399) as number[]);
  });
  test("the paint screen is 414×293 at (91, 72), the 4× image 256×256 at (242, 81), the viewer 229×87 at (330, 166)", () => {
    expect(asRect(PAINT_RECTS.gui)).toEqual([91, 72, 505, 365]);
    expect(asRect(PAINT_RECTS.image)).toEqual([242, 81, 498, 337]);
    expect(asRect(PAINT_RECTS.viewer)).toEqual([330, 166, 559, 253]);
    expect(PAINT_RECTS.tools.map(asRect)).toEqual([
      [119, 85, 156, 121],
      [176, 88, 213, 124],
      [118, 125, 155, 161],
      [175, 124, 212, 160],
      [119, 171, 156, 207],
      [175, 169, 212, 205],
      [119, 210, 156, 246],
      [175, 211, 212, 247],
    ]);
  });
  test("the paint elements carry their click origins", () => {
    const s = paintScene();
    expect(s.hit.dataset.action).toBe("paint-tools");
    expect(s.image.dataset.action).toBe("paint-draw");
    expect(s.ui.lens.dataset.action).toBe("paint-lens");
  });
});

describe("the paint screen", () => {
  test("Use Canvas opens it black, tool 1, colour black, under the keys lock", () => {
    const s = paintScene();
    s.ui.openPaint(false);
    expect(s.ui.paintOpen).toBe(true);
    expect(s.state.locked).toBe(true);
    expect(s.ui.tool).toBe(1);
    expect(s.ui.colour).toEqual([0, 0, 0]);
    expect(getPaintPixel(s.ui.image, 5, 5)).toEqual([0, 0, 0]);
    expect(s.toolSrc()).toContain("paintings-16");
  });
  test("a tool click swaps the bbbN icon: tools 1-6 are members 16-21, 7 and 8 are 24 and 25", () => {
    const s = paintScene();
    s.ui.openPaint(false);
    s.down(190, 190); // tool 6
    expect(s.ui.tool).toBe(6);
    expect(s.toolSrc()).toContain("paintings-21");
    s.down(130, 250); // tool 7
    expect(s.toolSrc()).toContain("paintings-24");
    s.down(190, 250); // tool 8
    expect(s.toolSrc()).toContain("paintings-25");
    s.down(130, 100); // tool 1
    expect(s.toolSrc()).toContain("paintings-16");
  });
  test("a held pointer paints once per tick and stops on release", () => {
    const s = paintScene();
    s.ui.openPaint(false);
    s.down(130, 190); // tool 5, darken: +14 at the centre per application
    s.press(242 + 4 * 10 + 1, 81 + 4 * 10 + 1); // image pixel (10, 10)
    const at = () => getPaintPixel(s.ui.image, 10, 10)?.[0];
    expect(at()).toBe(quantise(14));
    s.ui.tick();
    expect(at()).toBe(quantise(quantise(14) + 14));
    s.release();
    const held = at();
    s.ui.tick();
    expect(at()).toBe(held);
  });
  test("Fill paints the whole image in the current colour", () => {
    const s = paintScene();
    s.ui.openPaint(false);
    s.down(227, 85);
    expect(getPaintPixel(s.ui.image, 0, 0)).toEqual([0, 0, 0]);
    // Pick a colour from the gradient (the stub's pixel at GUI-local (7, 9)), then Fill.
    s.down(98, 316 + 0); // outside the pick region: nothing
    s.down(140, 320); // inside: GUI-local (49, 248), the stub's default colour
    s.release(s.hit);
    s.down(227, 85);
    expect(getPaintPixel(s.ui.image, 63, 63)).toEqual([quantise(1), quantise(2), quantise(3)]);
  });
  test("the colour pick reads the paint screen's art, or the preview where it lies over it", () => {
    const s = paintScene();
    s.ui.openPaint(false);
    s.down(98 + 0, 100); // a tool click first, to prove the pick is separate
    s.down(131 + 1, 307); // GUI-local (41, 235)
    expect(s.ui.colour).toEqual([1, 2, 3]);
    s.release(s.hit);
    // The preview (136,254,200,318) lies over the pick region's lower part: it shows the image.
    s.down(140, 310);
    expect(s.ui.colour).toEqual(getPaintPixel(s.ui.image, 4, 56) as [number, number, number]);
  });
  test("Save: the bag test first ('too much'), else 'Saving painting...' and the PNG; the screen stays until artSaved", () => {
    const s = paintScene({ bagFull: true });
    s.ui.openPaint(false);
    s.down(480, 352);
    expect(s.log).toEqual([
      ["say", "You are carrying too much to add a painting to your inventory."],
    ]);
    s.log.length = 0;
    s.state.bagFull = false;
    s.down(480, 352);
    expect(s.log).toEqual([
      ["say", "Saving painting, please wait..."],
      ["save", "painting", "PNGDATA"],
    ]);
    expect(s.ui.paintOpen).toBe(true);
    // A second Save before the reply sends again (the server ignores it).
    s.down(480, 352);
    expect(s.log.filter((l) => (l as unknown[])[0] === "save")).toHaveLength(2);
    s.ui.saved();
    expect(s.log.at(-1)).toEqual(["say", "...Saved!"]);
    expect(s.ui.paintOpen).toBe(false);
    expect(s.state.locked).toBe(false);
  });
  test("kept bug: Cancel keeps the picture and the next Canvas reopens it", () => {
    const s = paintScene();
    s.ui.openPaint(false);
    s.down(130, 190);
    s.press(242 + 40, 81 + 40);
    s.release();
    const before = [...s.ui.image.data];
    s.down(420, 352);
    expect(s.ui.paintOpen).toBe(false);
    expect(s.log).toContainEqual(["cancel"]);
    expect(s.state.locked).toBe(false);
    s.ui.openPaint(true);
    expect([...s.ui.image.data]).toEqual(before);
    s.ui.openPaint(false);
    expect(getPaintPixel(s.ui.image, 10, 10)).toEqual([0, 0, 0]);
  });
  test("clicks on the canvas margin do nothing; the image area belongs to the painting script", () => {
    const s = paintScene();
    s.ui.openPaint(false);
    s.down(300, 200);
    expect(s.log).toEqual([]);
    expect(s.ui.tool).toBe(1);
  });
});

describe("the viewer", () => {
  test("shows 'Author: <name>' and the picture, locking the keys", async () => {
    const s = paintScene();
    await s.ui.showArt("Bob", "x");
    expect(s.ui.viewerOpen).toBe(true);
    expect((s.ui.viewer.querySelector(".paint-author") as HTMLElement).textContent).toBe(
      "Author: Bob",
    );
    expect(getPaintPixel(s.ui.image, 0, 0)).toEqual([255, 0, 0]);
    expect(s.state.locked).toBe(true);
  });
  test("an item with no stored art opens it with 'Author: ' and no picture", async () => {
    const s = paintScene();
    await s.ui.showArt("", null);
    expect((s.ui.viewer.querySelector(".paint-author") as HTMLElement).textContent).toBe(
      "Author: ",
    );
    expect(s.ui.viewerOpen).toBe(true);
  });
  test("any mouseup on the page closes it and unlocks the keys", async () => {
    const s = paintScene();
    await s.ui.showArt("Bob", "x");
    const catcher = s.ui.viewer.querySelector(".paint-catcher") as HTMLElement;
    s.fire(catcher, "pointerup", 0, 0, { x: 0, y: 0 });
    expect(s.ui.viewerOpen).toBe(false);
    expect(s.log).toContainEqual(["viewClose"]);
    expect(s.state.locked).toBe(false);
  });
  test("kept bug: a pointer down on the viewed image paints on it at (mouse − top-left) / 4", async () => {
    const s = paintScene();
    await s.ui.showArt("Bob", "x");
    // Tool 1 black on red: blend 150 of black darkens the red, at pixel (8/4, 8/4) = (2, 2).
    const V = PAINT_RECTS.viewerImage;
    s.fire(s.viewerImage, "pointerdown", V.x + 8, V.y + 8, s.V);
    expect((getPaintPixel(s.ui.image, 2, 2) as number[])[0]).toBeLessThan(255);
    expect(getPaintPixel(s.ui.image, 8, 8)).toEqual([255, 0, 0]);
  });
  test("kept bug: a cancelled canvas reopens showing a viewed painting, which Save keeps as yours", async () => {
    const s = paintScene();
    s.ui.openPaint(false);
    s.down(420, 352); // cancel
    await s.ui.showArt("Bob", "x");
    s.fire(s.ui.viewer, "pointerup", 0, 0, s.V);
    s.ui.openPaint(true);
    expect(getPaintPixel(s.ui.image, 30, 30)).toEqual([255, 0, 0]);
    s.down(480, 352);
    expect(s.log).toContainEqual(["save", "painting", "PNGDATA"]);
  });
});

describe("the lens", () => {
  test("it appears on Use Film and follows the pointer in playfield pixels", () => {
    const s = paintScene();
    expect(s.ui.lens.hidden).toBe(true);
    s.ui.showLens();
    expect(s.ui.lensUp).toBe(true);
    s.ui.moveLens(100, 80);
    expect(s.ui.lens.style.left).toBe("68px");
    expect(s.ui.lens.style.top).toBe("48px");
  });
  test("a tap too near the edge says 'You can't take a picture here!' and the lens stays", () => {
    const s = paintScene();
    s.ui.showLens();
    s.ui.takePhoto(20, 100); // stage h = 50 <= 72
    expect(s.log).toEqual([["say", "You can't take a picture here!"]]);
    expect(s.ui.lensUp).toBe(true);
    s.ui.takePhoto(300, 10); // stage v = 41 <= 67
    expect(s.log).toHaveLength(2);
  });
  test("a good shot hides the lens, redraws, crops 64×64 around the tap and saves a photo", () => {
    const s = paintScene();
    s.ui.showLens();
    s.ui.takePhoto(200, 150);
    expect(s.ui.lensUp).toBe(false);
    expect(s.grabs).toEqual([{ x: 168, y: 118, w: 64, h: 64 }]);
    expect(s.log).toEqual([
      ["redraw"],
      ["say", "Saving Photo, please wait..."],
      ["save", "photo", "PNGDATA"],
    ]);
    // The crop overwrites the shared image (a cancelled painting included), on the 5-bit grid.
    expect(getPaintPixel(s.ui.image, 0, 0)).toEqual([quantise(200), quantise(100), quantise(50)]);
  });
  test("kept bug: a full bag after the shot says so and the film is lost", () => {
    const s = paintScene({ bagFull: true });
    s.ui.showLens();
    s.ui.takePhoto(200, 150);
    expect(s.log).toEqual([
      ["redraw"],
      ["say", "You are carrying too much to add a photo to your inventory."],
    ]);
    expect(s.ui.lensUp).toBe(false);
  });
  test("a bag click hides it, the film lost", () => {
    const s = paintScene();
    s.ui.showLens();
    s.ui.cancelLens();
    expect(s.ui.lensUp).toBe(false);
    expect(s.ui.lens.hidden).toBe(true);
    s.ui.takePhoto(200, 150);
    expect(s.log).toEqual([]);
  });
  test("game entry clears the image, hides everything and cancels the lens", async () => {
    const s = paintScene();
    s.ui.openPaint(false);
    s.ui.showLens();
    await s.ui.showArt("Bob", "x");
    s.ui.reset();
    expect(s.ui.paintOpen).toBe(false);
    expect(s.ui.viewerOpen).toBe(false);
    expect(s.ui.lensUp).toBe(false);
    expect(getPaintPixel(s.ui.image, 0, 0)).toEqual([0, 0, 0]);
  });
});

function newsScene() {
  const log: unknown[] = [];
  const layer = createWindowLayer();
  const ui = createNewspaper(fakeAssets, layer, {
    save: (photos, texts) => log.push(["save", photos, texts]),
    say: (t) => log.push(["say", t]),
  });
  document.body.replaceChildren(layer.el);
  const q = <T extends Element>(win: HTMLElement, sel: string) => [...win.querySelectorAll<T>(sel)];
  return { ui, log, q };
}

describe("the newspaper windows", () => {
  test("rects: the reader's photos and the editor's name fields and SAVE PAPER match frame 1's layout", () => {
    const reader = sprites("sub/Newspaper/layout/frame-1.json");
    expect(NEWS_PHOTOS.map(asRect)).toEqual([2, 3, 4].map((c) => rectOf(reader, c) as number[]));
    const editor = sprites("sub/newspapergui/layout/frame-1.json");
    // The name fields' origins are the sprites'; their sizes are the fields' own boxes (the
    // stored frame heights and widths are stale), from text-styles.jsonl.
    const styles = readFileSync(
      join(import.meta.dir, "../../../assets/original/sub/newspapergui/layout/text-styles.jsonl"),
      "utf8",
    )
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { name: string; box: { width: number; height: number } });
    for (const [i, ch] of [12, 13, 14].entries()) {
      const f = rectOf(editor, ch) as number[];
      const r = EDITOR_PHOTO_FIELDS[i] as { x: number; y: number; w: number; h: number };
      const box = styles.find((x) => x.name === `Photo${i + 1}Name`)?.box;
      expect([r.x, r.y, r.w, r.h]).toEqual([
        f[0] ?? 0,
        f[1] ?? 0,
        box?.width ?? 0,
        box?.height ?? 0,
      ]);
    }
    expect(asRect(SAVE_PAPER)).toEqual(rectOf(editor, 2) as number[]);
    // Fields: the stored heights of Newspaper2/3/5/6 are stale; the origins match.
    for (const [i, ch] of [5, 6, 7, 8, 9, 10].entries()) {
      const f = rectOf(reader, ch) as number[];
      expect([NEWS_FIELDS[i]?.x, NEWS_FIELDS[i]?.y]).toEqual([f[0], f[1]]);
    }
  });
  test("both windows are 400×412 with a blank title and a close box only", () => {
    const s = newsScene();
    for (const win of [s.ui.reader, s.ui.editor]) {
      win.open();
      expect(win.el.querySelector(".window-title")?.textContent).toBe(" ");
      expect(win.el.querySelector(".window-body")?.getAttribute("style")).toContain("--w: 400px");
    }
  });
  test("the reader fills six fields, hides a null photo and shows photo 1 at 128×128", () => {
    const s = newsScene();
    s.ui.read(["T1", "T2", "T3", "T4", "T5", "T6"], ["AAAA", null, null]);
    expect(s.ui.reader.isOpen).toBe(true);
    const fields = s.q(s.ui.reader.el, ".news-field");
    expect(fields.map((f) => f.textContent)).toEqual(["T1", "T2", "T3", "T4", "T5", "T6"]);
    const photos = s.q<HTMLImageElement>(s.ui.reader.el, ".news-photo");
    expect(photos.map((p) => p.hidden)).toEqual([false, true, true]);
    expect(photos[0]?.src).toBe("data:image/png;base64,AAAA");
    expect(photos[0]?.style.getPropertyValue("--w")).toBe("128px");
    expect(photos[1]?.style.getPropertyValue("--w")).toBe("64px");
    // Re-reading refills the same window.
    s.ui.read(["a", "b", "c", "d", "e", "f"], [null, null, null]);
    expect(s.q(s.ui.reader.el, ".news-field")[0]?.textContent).toBe("a");
    expect(s.q<HTMLImageElement>(s.ui.reader.el, ".news-photo").every((p) => p.hidden)).toBe(true);
    expect(s.q(document.body, ".window-layer .sso-window")).toHaveLength(2);
  });
  test("the editor opens with the cast defaults, then newspaperEdit fills all nine", () => {
    const s = newsScene();
    s.ui.openEditor();
    expect(s.ui.editor.isOpen).toBe(true);
    expect(s.ui.values().texts).toEqual(Array(6).fill("NEWSPAPER TITLE"));
    expect(s.ui.values().photos).toEqual(["Photo Number", "Photo Number", "5524916"]);
    s.ui.fill(["1", "2", "3"], ["a", "b", "c", "d", "e", "f"]);
    expect(s.ui.values()).toEqual({
      photos: ["1", "2", "3"],
      texts: ["a", "b", "c", "d", "e", "f"],
    });
    // No paper: all nine go blank, not back to the cast text.
    s.ui.fill([], []);
    expect(s.ui.values().texts).toEqual(Array(6).fill(""));
  });
  test("SAVE PAPER sends the nine fields and prints 'Newspaper saved!' always; the window stays", () => {
    const s = newsScene();
    s.ui.openEditor();
    s.ui.fill(["12", "x", "y"], ["T", "S", "B", "L", "R", "F"]);
    (s.q(s.ui.editor.el, ".news-save")[0] as HTMLButtonElement).click();
    expect(s.log).toEqual([
      ["save", ["12", "x", "y"], ["T", "S", "B", "L", "R", "F"]],
      ["say", "Newspaper saved!"],
    ]);
    expect(s.ui.editor.isOpen).toBe(true);
  });
  test("the editor controls carry semantic actions", () => {
    const s = newsScene();
    const actions = s.q<HTMLElement>(s.ui.editor.el, "[data-action]").map((e) => e.dataset.action);
    expect(actions.filter((id) => id === "newspaper-text")).toHaveLength(6);
    expect(actions.filter((id) => id === "newspaper-photo")).toHaveLength(3);
    expect(actions).toContain("newspaper-save");
  });
});
