/**
 * The Slot Machine panel: sprites 333-336 on frame 72 (assets/original/main/layout/frame-72.json),
 * drawn in place on the stage. Every piece sits at its sprite's rect (loc − reg): the panel
 * (308×243, reg 160, 122) at loc (323, 170), the pulled panel (311×243, reg 168, 122) in its place,
 * and three reels at locs (245|307|368, 148) showing the blank face or faces 1-4, each at its own
 * size and regpoint (cast-manifest Casino 9-13). Origin: the union of every sprite, stage (155,
 * 48).
 *
 * One member script reads the mouse (the panel's own): Close H 200-216, V 64-79, the lever H
 * 168-188, V 56-219. A local flag blocks both while a pull is settling. The server opening the
 * panel shows 333-336; closing it, or game entry, hides them.
 */
import type { Assets } from "../assets.ts";
import { type Sfx, SOUND } from "../sfx.ts";
import { action } from "./action.ts";
import { artImg, type Rect } from "./stage.ts";

export const SLOT_ORIGIN = { x: 155, y: 48 } as const;
export const SLOT_SIZE = { w: 316, h: 243 } as const;

const R = (l: number, t: number, r: number, b: number): Rect => ({
  x: l,
  y: t,
  w: r - l,
  h: b - t,
});

/** Stage rects ([l, t, r, b] → x, y, w, h). */
export const SLOT_RECTS = {
  /** 333 the panel: loc (323, 170), reg (160, 122). */
  panel: R(163, 48, 471, 291),
  /** 333 the pulled panel after a pull: reg (168, 122). */
  pulled: R(155, 48, 466, 291),
  /** Close: mouseH 200-216, mouseV 64-79. */
  close: R(200, 64, 217, 80),
  /** The lever: mouseH 168-188, mouseV 56-219. */
  pull: R(168, 56, 189, 220),
} as const;

/** The reels' locs (334-336); a face is drawn at loc − reg. */
export const SLOT_REEL_LOCS: readonly { x: number; y: number }[] = [
  { x: 245, y: 148 },
  { x: 307, y: 148 },
  { x: 368, y: 148 },
];

/** Casino members 9-13: the blank face and faces 1-4, with their sizes and regpoints. */
export const SLOT_FACES: readonly {
  member: number;
  w: number;
  h: number;
  rx: number;
  ry: number;
}[] = [
  { member: 9, w: 51, h: 39, rx: 16, ry: -11 },
  { member: 10, w: 57, h: 62, rx: 20, ry: 16 },
  { member: 11, w: 43, h: 42, rx: 14, ry: 9 },
  { member: 12, w: 51, h: 39, rx: 16, ry: -11 },
  { member: 13, w: 51, h: 39, rx: 16, ry: -11 },
];

/** The stage rect of face `face` (0 = blank, 1-4 = S1-S4) on reel `reel` (0-2). */
export function reelRect(reel: number, face: number): Rect {
  const loc = SLOT_REEL_LOCS[reel] ?? { x: 245, y: 148 };
  const f = SLOT_FACES[face] ?? { member: 9, w: 51, h: 39, rx: 16, ry: -11 };
  return { x: loc.x - f.rx, y: loc.y - f.ry, w: f.w, h: f.h };
}

/** One 20 fps frame. */
export const SLOT_FRAME_MS = 50;

export interface SlotActions {
  /** The lever: `slotPull`. */
  pull(): void;
  /** Close: `slotClose`. */
  close(): void;
  /** The key lock. */
  lock(on: boolean): void;
  /** Frame 72 on or off; off plays the first tab. */
  frame(on: boolean): void;
  sound(s: Sfx): void;
  /** `random(4)`; replaceable in tests. */
  random?(n: number): number;
}

export interface SlotMachine {
  el: HTMLElement;
  readonly isOpen: boolean;
  /** A pull is settling. */
  readonly pulling: boolean;
  /** The server opened or closed the panel. */
  show(open: boolean): void;
  /** The reels spin until the result. */
  spin(): void;
  /** The settled reels and whether it is a win; `null` reels: stop where they are. */
  result(reels: readonly [number, number, number] | null, win: boolean): void;
  /** One animation frame (the timer's, or a test's). */
  frame(): void;
}

export function createSlotMachine(a: Assets, act: SlotActions): SlotMachine {
  const random = act.random ?? ((n: number) => 1 + Math.floor(Math.random() * n));
  const el = document.createElement("div");
  el.className = "slot-machine";
  el.hidden = true;
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", "Slot machine");
  const put = <T extends HTMLElement>(node: T, r: Rect, z: number): T => {
    node.style.left = `${r.x - SLOT_ORIGIN.x}px`;
    node.style.top = `${r.y - SLOT_ORIGIN.y}px`;
    node.style.width = `${r.w}px`;
    node.style.height = `${r.h}px`;
    node.style.zIndex = String(z);
    el.append(node);
    return node;
  };
  const panel = put(artImg(a.ui("casino", 2), "Slot machine"), SLOT_RECTS.panel, 1);
  const pulled = put(artImg(a.ui("casino", 3), "Slot machine, lever pulled"), SLOT_RECTS.pulled, 1);
  pulled.hidden = true;
  panel.classList.add("slot-art");
  pulled.classList.add("slot-art");
  const reels = [0, 1, 2].map((i) => {
    const img = put(artImg(a.ui("casino", 9), ""), reelRect(i, 0), 2);
    img.classList.add("slot-art", "slot-reel");
    return img;
  });
  const hotspot = (label: string, r: Rect, on: () => void) => {
    const b = put(
      action(
        document.createElement("button"),
        label === "Pull the lever" ? "slots-pull" : "slots-close",
      ),
      r,
      3,
    );
    b.type = "button";
    b.className = "hit slot-button";
    b.setAttribute("aria-label", label);
    b.addEventListener("click", on);
    return b;
  };

  /** A pull is settling. */
  let slotIP = false;
  let open = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const face = (i: number, f: number) => {
    const img = reels[i];
    if (!img) {
      return;
    }
    const r = reelRect(i, f);
    img.src = a.ui("casino", SLOT_FACES[f]?.member ?? 9);
    img.style.left = `${r.x - SLOT_ORIGIN.x}px`;
    img.style.top = `${r.y - SLOT_ORIGIN.y}px`;
    img.style.width = `${r.w}px`;
    img.style.height = `${r.h}px`;
    img.dataset.face = String(f);
  };
  const lever = (down: boolean) => {
    panel.hidden = down;
    pulled.hidden = !down;
  };
  const stop = () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
  const hide = () => {
    stop();
    open = false;
    slotIP = false;
    el.hidden = true;
  };

  hotspot("Close the slot machine", SLOT_RECTS.close, () => {
    // Exits while a pull is in progress.
    if (slotIP) {
      return;
    }
    hide();
    act.lock(false);
    act.frame(false);
    act.close();
  });
  hotspot("Pull the lever", SLOT_RECTS.pull, () => {
    // Exits while a pull is in progress; else marks a pull in progress and, with the lever up,
    // pulls it and asks the server.
    if (slotIP) {
      return;
    }
    slotIP = true;
    if (!pulled.hidden) {
      return;
    }
    lever(true);
    act.pull();
  });

  const m: SlotMachine = {
    el,
    get isOpen() {
      return open;
    },
    get pulling() {
      return slotIP;
    },
    show(on) {
      if (!on) {
        // Closed by the server (a short pull closes it first).
        const was = open;
        hide();
        lever(false);
        if (was) {
          act.lock(false);
          act.frame(false);
        }
        return;
      }
      open = true;
      slotIP = false;
      stop();
      lever(false);
      for (let i = 0; i < 3; i += 1) {
        face(i, 0);
      }
      el.hidden = false;
      act.lock(true);
      act.frame(true);
    },
    spin() {
      if (!open) {
        return;
      }
      stop();
      timer = setInterval(() => m.frame(), SLOT_FRAME_MS);
    },
    frame() {
      // The spin: a random face on each reel every frame.
      for (let i = 0; i < 3; i += 1) {
        face(i, random(4));
      }
    },
    result(rs, win) {
      stop();
      if (rs) {
        for (let i = 0; i < 3; i += 1) {
          face(i, rs[i] ?? 0);
        }
      }
      lever(false);
      slotIP = false;
      if (win) {
        act.sound(SOUND.cash);
      }
    },
  };
  return m;
}
