/**
 * The paint screen, the painting viewer and the camera lens.
 *
 * The paint screen is the paint screen's art (member 12, 414×293) at stage (91, 72), drawn in place
 * (hit tests are in GUI coordinates). The painting is the shared
 * 64×64 image (member "Painting", Internal #505): the paint screen shows it 4× (sprite 398) and
 * 1:1 in the preview (397), the viewer shows it 1:1, and a photo crop overwrites it, so a
 * cancelled canvas, a viewed painting and a photo all land in the same image (kept bugs: 1.6 did
 * this). The tools are the pure rules in `@secondstaronline/shared` (`paintAt`).
 */
import {
  ART_TEXT,
  blankPaint,
  fillPaint,
  getPaintPixel,
  lensOk,
  PAINT_SCALE,
  PAINT_SIZE,
  type PaintImage,
  type PaintTool,
  paintAt,
  paintHit,
  paintPoint,
  photoCrop,
  setPaintPixels,
} from "@secondstaronline/shared";

import type { Assets } from "../assets.ts";
import { action } from "./action.ts";
import { artImg, type Rect } from "./stage.ts";

const R = (l: number, t: number, r: number, b: number): Rect => ({
  x: l,
  y: t,
  w: r - l,
  h: b - t,
});

/** Stage rects on score frames 50-78. */
export const PAINT_RECTS = {
  gui: R(91, 72, 505, 365),
  swatch: R(103, 328, 126, 353),
  preview: R(136, 254, 200, 318),
  image: R(242, 81, 498, 337),
  /** The eight tool buttons (37×36), by tool. */
  tools: [
    R(119, 85, 156, 121),
    R(176, 88, 213, 124),
    R(118, 125, 155, 161),
    R(175, 124, 212, 160),
    R(119, 171, 156, 207),
    R(175, 169, 212, 205),
    R(119, 210, 156, 246),
    R(175, 211, 212, 247),
  ],
  viewer: R(330, 166, 559, 253),
  viewerImage: R(338, 177, 402, 241),
  author: R(413, 180, 552, 192),
} as const;

/**
 * The loop's pace: the original ran every pass of a tight loop; SSO applies
 * once per tick (20 fps).
 */
export const PAINT_TICK_MS = 50;
/** The lens, 64×64 (Internal #509), and its playfield origin on the stage (`frame-67.json`). */
export const LENS_SIZE = 64;
const PLAYFIELD_ORIGIN = { x: 30, y: 31 } as const;

export interface PaintActions {
  /** Cancel: `paintUi cancel`. */
  cancel(): void;
  /** The viewer's close. */
  viewClose(): void;
  /** Saves a painting or a photo, with the PNG as base64. */
  save(kind: "painting" | "photo", png: string): void;
  /** A chat line for you alone. */
  say(text: string): void;
  /** The key lock. */
  lock(on: boolean): void;
  /** More than 14 non-empty bag lines among 1-15 (the bag test). */
  bagFull(): boolean;
  /** Draws a fresh playfield frame without the lens. */
  redraw(): void;
  /** The playfield's pixels at a 64×64 rect (RGBA), or null when it cannot be read. */
  grab(crop: { x: number; y: number; w: number; h: number }): ArrayLike<number> | null;
}

export interface PaintHooks {
  /** The paint screen art's pixel at GUI-local (x, y), RGB, or null (default: from its image). */
  guiPixel?(x: number, y: number): [number, number, number] | null;
  /** The image as a base64 PNG (default: a canvas's `toDataURL`). */
  encode?(img: PaintImage): string | null;
  /** A base64 PNG as 64×64 RGBA pixels (default: an `Image` drawn on a canvas). */
  decode?(png: string): Promise<ArrayLike<number> | null>;
  /** Randomness for the smudge tools: a random roll from 1 through n. */
  random?(n: number): number;
}

export interface PaintUi {
  /** The paint screen, 414×293, placed by the shell at stage (91, 72). */
  paint: HTMLElement;
  /** The viewer, 229×87, placed at stage (330, 166). */
  viewer: HTMLElement;
  /** The lens, in the playfield overlay (544×384 playfield pixels). */
  lens: HTMLElement;
  /** The shared 64×64 painting (member 505). */
  readonly image: PaintImage;
  readonly tool: PaintTool;
  readonly colour: readonly [number, number, number];
  readonly paintOpen: boolean;
  readonly viewerOpen: boolean;
  readonly lensUp: boolean;
  /** Opens the paint screen (`reopen` keeps the image; otherwise it is black). */
  openPaint(reopen: boolean): void;
  /** `paint` from the server's `artSaved`: "...Saved!", the screen hides, the keys unlock. */
  saved(): void;
  /** The viewer, with the stored picture or none. */
  showArt(author: string, png: string | null): Promise<void>;
  /** Use Film: the lens appears. */
  showLens(): void;
  /** The lens follows the pointer: playfield pixels. */
  moveLens(x: number, y: number): void;
  /** A click on the map, yourself, a player or a monster while the lens is up. */
  takePhoto(x: number, y: number): void;
  /** A bag click hides the lens, film lost. */
  cancelLens(): void;
  /** Applies the held tool or pick once (the 50 ms loop); a test steps it by hand. */
  tick(): void;
  /** Game entry clears the image, the flags and hides all. */
  reset(): void;
}

function defaultEncode(img: PaintImage): string | null {
  const c = document.createElement("canvas");
  c.width = PAINT_SIZE;
  c.height = PAINT_SIZE;
  const ctx = c.getContext("2d");
  if (!ctx) {
    return null;
  }
  ctx.putImageData(toImageData(ctx, img), 0, 0);
  const url = c.toDataURL("image/png");
  return url.split(",")[1] ?? null;
}

function defaultDecode(png: string): Promise<ArrayLike<number> | null> {
  return new Promise((resolve) => {
    const im = new Image();
    im.onload = () => {
      const c = document.createElement("canvas");
      c.width = PAINT_SIZE;
      c.height = PAINT_SIZE;
      const ctx = c.getContext("2d");
      if (!ctx) {
        resolve(null);
        return;
      }
      ctx.drawImage(im, 0, 0, PAINT_SIZE, PAINT_SIZE);
      resolve(ctx.getImageData(0, 0, PAINT_SIZE, PAINT_SIZE).data);
    };
    im.onerror = () => resolve(null);
    im.src = `data:image/png;base64,${png}`;
  });
}

function toImageData(ctx: CanvasRenderingContext2D, img: PaintImage): ImageData {
  const out = ctx.createImageData(PAINT_SIZE, PAINT_SIZE);
  for (let i = 0, j = 0; i < img.data.length; i += 3, j += 4) {
    out.data[j] = img.data[i] as number;
    out.data[j + 1] = img.data[i + 1] as number;
    out.data[j + 2] = img.data[i + 2] as number;
    out.data[j + 3] = 255;
  }
  return out;
}

export function createPaintUi(a: Assets, act: PaintActions, hooks: PaintHooks = {}): PaintUi {
  const image = blankPaint();
  let tool: PaintTool = 1;
  let colour: [number, number, number] = [0, 0, 0];
  const rnd = { random: hooks.random ?? ((n: number) => 1 + Math.floor(Math.random() * n)) };
  const encode = hooks.encode ?? defaultEncode;
  const decode = hooks.decode ?? defaultDecode;

  // ---- the shared image on three canvases (4× image, preview, viewer) ---------------------
  const canvases: HTMLCanvasElement[] = [];
  const makeCanvas = (cls: string): HTMLCanvasElement => {
    const c = document.createElement("canvas");
    c.width = PAINT_SIZE;
    c.height = PAINT_SIZE;
    c.className = `paint-canvas ${cls}`;
    canvases.push(c);
    return c;
  };
  const render = () => {
    for (const c of canvases) {
      const ctx = c.getContext("2d");
      if (ctx) {
        ctx.putImageData(toImageData(ctx, image), 0, 0);
      }
    }
  };
  const put = <T extends HTMLElement>(node: T, r: Rect, origin: Rect): T => {
    node.style.left = `${r.x - origin.x}px`;
    node.style.top = `${r.y - origin.y}px`;
    node.style.width = `${r.w}px`;
    node.style.height = `${r.h}px`;
    return node;
  };

  // ---- the paint screen ------------------------------------------------------------------
  const paint = document.createElement("div");
  paint.className = "paint-screen";
  paint.hidden = true;
  paint.setAttribute("role", "dialog");
  paint.setAttribute("aria-label", "Painting");
  const G = PAINT_RECTS.gui;
  const gui = put(artImg(a.ui("paintings", 12), "Paint"), G, G);
  gui.classList.add("paint-gui");
  // Sprite 395's mouseDown takes the clicks on the GUI box; the art sits behind it.
  const hitLayer = put(action(document.createElement("div"), "paint-tools"), G, G);
  hitLayer.className = "paint-hit";
  const swatch = put(document.createElement("div"), PAINT_RECTS.swatch, G);
  swatch.className = "paint-swatch";
  const preview = put(makeCanvas("paint-preview"), PAINT_RECTS.preview, G);
  const big = put(action(makeCanvas("paint-image"), "paint-draw"), PAINT_RECTS.image, G);
  const toolIcon = document.createElement("img");
  toolIcon.className = "art paint-tool";
  toolIcon.alt = "";
  toolIcon.draggable = false;
  const showTool = () => {
    const r = PAINT_RECTS.tools[tool - 1] as Rect;
    toolIcon.src = a.ui("paintings", tool <= 6 ? 15 + tool : 17 + tool);
    put(toolIcon, r, G);
  };
  paint.append(gui, hitLayer, preview, swatch, toolIcon, big);
  const showColour = () => {
    swatch.style.backgroundColor = `rgb(${colour[0]}, ${colour[1]}, ${colour[2]})`;
  };

  // ---- the viewer ------------------------------------------------------------------------
  const V = PAINT_RECTS.viewer;
  const viewer = action(document.createElement("div"), "paint-viewer-close");
  viewer.className = "paint-viewer";
  viewer.hidden = true;
  viewer.setAttribute("role", "dialog");
  viewer.setAttribute("aria-label", "Painting viewer");
  const viewerBg = put(artImg(a.ui("paintings", 23), "Painting"), V, V);
  viewerBg.classList.add("paint-viewer-bg");
  const viewerImage = put(
    action(makeCanvas("paint-viewer-image"), "paint-draw"),
    PAINT_RECTS.viewerImage,
    V,
  );
  const author = put(document.createElement("div"), PAINT_RECTS.author, V);
  author.className = "paint-author";
  viewer.append(viewerBg, viewerImage, author);

  // ---- the lens ---------------------------------------------------------------------------
  const lens = document.createElement("div");
  lens.className = "paint-lens";
  lens.hidden = true;
  action(lens, "paint-lens");
  const lensArt = artImg(a.ui("internal", 509), "");
  lensArt.classList.add("paint-lens-art");
  lens.append(lensArt);
  let lensPos = { x: -500, y: -500 };
  const placeLens = () => {
    lens.style.left = `${lensPos.x - LENS_SIZE / 2}px`;
    lens.style.top = `${lensPos.y - LENS_SIZE / 2}px`;
  };
  let lensUp = false;

  // ---- holding a tool or the picker -----------------------------------------------------
  let held: "tool" | "pick" | null = null;
  let heldOn: "paint" | "viewer" = "paint";
  let pointer = { x: 0, y: 0 };
  let timer: ReturnType<typeof setInterval> | null = null;

  /** The pointer as stage coordinates, from the box of `el` whose stage origin is `origin`. */
  const stagePoint = (e: PointerEvent, el: HTMLElement, origin: Rect) => {
    const box = el.getBoundingClientRect();
    const scale = box.width > 0 ? box.width / origin.w : 1;
    return {
      x: origin.x + (e.clientX - box.left) / scale,
      y: origin.y + (e.clientY - box.top) / scale,
    };
  };
  // The art is read from its own pixels: loaded when the screen is built, so the first press of
  // the picker already finds it.
  const guiCtx = hooks.guiPixel
    ? null
    : (() => {
        const c = document.createElement("canvas");
        c.width = G.w;
        c.height = G.h;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        if (ctx) {
          const im = new Image();
          im.crossOrigin = "anonymous";
          im.onload = () => ctx.drawImage(im, 0, 0);
          im.src = a.ui("paintings", 12);
        }
        return ctx;
      })();
  const guiPixel =
    hooks.guiPixel ??
    ((x: number, y: number): [number, number, number] | null => {
      if (!guiCtx) {
        return null;
      }
      const d = guiCtx.getImageData(x, y, 1, 1).data;
      return d[3] === 0 ? null : [d[0] as number, d[1] as number, d[2] as number];
    });

  const applyTool = () => {
    if (heldOn === "paint") {
      const p = paintPoint(pointer, { x: PAINT_RECTS.image.x, y: PAINT_RECTS.image.y });
      paintAt(image, tool, p.x, p.y, colour, rnd);
    } else {
      const p = paintPoint(pointer, {
        x: PAINT_RECTS.viewerImage.x,
        y: PAINT_RECTS.viewerImage.y,
      });
      paintAt(image, tool, p.x, p.y, colour, rnd);
    }
    render();
  };
  /** The composite pixel under the pointer (the art with the preview over it). */
  const pickColour = () => {
    const pv = PAINT_RECTS.preview;
    const px = Math.trunc(pointer.x);
    const py = Math.trunc(pointer.y);
    let rgb: [number, number, number] | null = null;
    if (px >= pv.x && px < pv.x + pv.w && py >= pv.y && py < pv.y + pv.h) {
      rgb = getPaintPixel(image, px - pv.x, py - pv.y);
    } else {
      rgb = guiPixel(px - G.x, py - G.y);
    }
    if (rgb) {
      colour = rgb;
      showColour();
    }
  };
  const tick = () => {
    if (held === "tool") {
      applyTool();
    } else if (held === "pick") {
      pickColour();
    }
  };
  const release = () => {
    held = null;
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
  const hold = (what: "tool" | "pick", on: "paint" | "viewer") => {
    held = what;
    heldOn = on;
    tick();
    if (timer === null) {
      timer = setInterval(tick, PAINT_TICK_MS);
    }
  };
  /**
   * Holds a tool or the picker while the pointer is down on `el`. The loop reads the mouse itself,
   * so the pointer is followed even off the image (clipped): the element captures the pointer
   * and hears its moves and its release.
   */
  const startHold = (
    el: HTMLElement,
    e: PointerEvent,
    what: "tool" | "pick",
    on: "paint" | "viewer",
    point: (ev: PointerEvent) => { x: number; y: number },
  ) => {
    pointer = point(e);
    el.setPointerCapture?.(e.pointerId);
    const move = (ev: Event) => {
      pointer = point(ev as PointerEvent);
    };
    const end = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", end);
      el.removeEventListener("pointercancel", end);
      release();
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    hold(what, on);
  };

  // ---- hiding and showing -----------------------------------------------------------------
  const hidePaint = () => {
    paint.hidden = true;
    if (held !== null && heldOn === "paint") {
      release();
    }
  };
  const hideViewer = () => {
    viewer.hidden = true;
  };

  /** Cancel: hide, unlock, tell the server; the image is kept. */
  const doCancel = () => {
    hidePaint();
    act.lock(false);
    act.cancel();
  };
  // The GUI's mouseDown: hit tests in stage coordinates, whatever the scale.
  hitLayer.addEventListener("pointerdown", (e) => {
    const pt = stagePoint(e, hitLayer, G);
    pointer = pt;
    const hit = paintHit(pt.x, pt.y);
    switch (hit.kind) {
      case "cancel":
        doCancel();
        return;
      case "fill":
        fillPaint(image, colour);
        render();
        return;
      case "save":
        save("painting");
        return;
      case "tool":
        tool = hit.tool;
        showTool();
        return;
      case "pick":
        startHold(hitLayer, e, "pick", "paint", (ev) => stagePoint(ev, hitLayer, G));
        return;
      default:
        return;
    }
  });
  // The image's own mouseDown, on sprite 398.
  big.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    startHold(big, e, "tool", "paint", (ev) => stagePoint(ev, hitLayer, G));
  });
  // The viewed image is still sprite 398 with its paint script (kept bug: 1.6 did it, so the
  // viewer can be painted on): the tool paints at `(mouse − the image's top-left) / 4` on a 1:1
  // image.
  viewerImage.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    startHold(viewerImage, e, "tool", "viewer", (ev) => stagePoint(ev, viewerBg, V));
  });
  // Any mouseUp on the page closes the viewer and unlocks the keys. A catcher larger than the
  // page sits under the viewer's pieces and every piece's release bubbles to the viewer.
  const catcher = document.createElement("div");
  catcher.className = "paint-catcher";
  action(catcher, "paint-viewer-close");
  viewer.prepend(catcher);
  viewer.addEventListener("pointerup", () => {
    if (!viewer.hidden) {
      hideViewer();
      act.lock(false);
      act.viewClose();
    }
  });

  /** The bag test, then "Saving...", then the image to the server. */
  const save = (kind: "painting" | "photo") => {
    if (act.bagFull()) {
      act.say(kind === "painting" ? ART_TEXT.paintFull : ART_TEXT.photoFull);
      return;
    }
    act.say(kind === "painting" ? ART_TEXT.paintSaving : ART_TEXT.photoSaving);
    const png = encode(image);
    if (png) {
      act.save(kind, png);
    }
  };

  const ui: PaintUi = {
    paint,
    viewer,
    lens,
    image,
    get tool() {
      return tool;
    },
    get colour() {
      return colour;
    },
    get paintOpen() {
      return !paint.hidden;
    },
    get viewerOpen() {
      return !viewer.hidden;
    },
    get lensUp() {
      return lensUp;
    },
    openPaint(reopen) {
      if (!reopen) {
        image.data.fill(0);
      }
      colour = [0, 0, 0];
      tool = 1;
      showTool();
      showColour();
      render();
      paint.hidden = false;
      act.lock(true);
    },
    saved() {
      act.say(ART_TEXT.saved);
      hidePaint();
      act.lock(false);
    },
    async showArt(who, png) {
      author.textContent = ART_TEXT.author(who);
      if (png) {
        const px = await decode(png);
        if (px) {
          setPaintPixels(image, px, 4);
        }
      }
      render();
      viewer.hidden = false;
      act.lock(true);
    },
    showLens() {
      lensUp = true;
      lens.hidden = false;
      placeLens();
    },
    moveLens(x, y) {
      lensPos = { x, y };
      if (lensUp) {
        placeLens();
      }
    },
    takePhoto(x, y) {
      if (!lensUp) {
        return;
      }
      lensPos = { x, y };
      // The lens loc is the stage point.
      const h = x + PLAYFIELD_ORIGIN.x;
      const v = y + PLAYFIELD_ORIGIN.y;
      if (!lensOk(h, v)) {
        placeLens();
        act.say(ART_TEXT.noPicture);
        return;
      }
      ui.cancelLens();
      act.redraw();
      const px = act.grab(photoCrop(h, v));
      if (!px) {
        return;
      }
      // Overwrites the shared image, a cancelled painting included.
      setPaintPixels(image, px, 4);
      render();
      save("photo");
    },
    cancelLens() {
      lensUp = false;
      lens.hidden = true;
      lensPos = { x: -500, y: -500 };
    },
    tick,
    reset() {
      release();
      image.data.fill(0);
      tool = 1;
      colour = [0, 0, 0];
      paint.hidden = true;
      viewer.hidden = true;
      ui.cancelLens();
      render();
    },
  };
  showTool();
  showColour();
  render();
  return ui;
}

export { PAINT_SCALE };
