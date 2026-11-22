/**
 * Sub-movie windows. The original opened each MIAW (IM, Who, Trade…) as its
 * own small OS window at its stage size. SSO:
 *
 * A floating window at the sub-movie's original size, scaled with the 800×600 frame, with a
 * plain title bar (drag to move) and a close button standing in for the OS window chrome. It
 * opens centred on the screen, or at its saved browser position (clamped to the viewport) when
 * "Remember floating window positions" is enabled.
 *
 * One `WindowLayer` holds every window; windows are built once and only re-parented.
 */

import { action } from "./action.ts";

export interface GameWindow {
  readonly el: HTMLElement;
  readonly isOpen: boolean;
  open(): void;
  close(): void;
  /** Sets the title bar text (`window(...).title`). */
  setTitle(title: string): void;
}

export interface WindowPosStore {
  shouldRemember(): boolean;
  load(name: string): { x: number; y: number } | null;
  save(name: string, pos: { x: number; y: number }): void;
}

export interface WindowLayer {
  readonly el: HTMLElement;
  /** The frame's current scale. */
  setScale(scale: number): void;
  create(opts: WindowOptions): GameWindow;
  /** Clears cached positions on closed windows (e.g. when Remember positions is turned off). */
  resetPositions(): void;
}

/**
 * Each sub-movie's stage colour, behind its art: `stageColor` in
 * assets/original/sub/<Movie>/layout/frame-1.json, read from the movie's config chunk (palette
 * index 0, white). A movie whose chunk cannot be read (ChatWindow, BioWindow, TradeWindow) is
 * not listed and keeps the window's black; their art covers the stage.
 */
export const STAGE_COLOR: Readonly<Record<string, string>> = {
  IMsend: "#FFFFFF",
  IMwin1: "#FFFFFF",
  AwayMessageWindow: "#FFFFFF",
  WhoWindow: "#FFFFFF",
  Friendsgui: "#FFFFFF",
  Checkers: "#FFFFFF",
};

export interface WindowOptions {
  /** The title the original set (`window(...).title`). */
  title: string;
  /** Short class name for per-window CSS, e.g. `who`. */
  name: string;
  /** Optional storage key for saved window position (defaults to `name`). */
  posKey?: string;
  /** The sub-movie's stage size. */
  width: number;
  height: number;
  body: HTMLElement;
  /** Runs when an open window closes, by its close button or by script (`on closeWindow`). */
  onClose?: () => void;
  /**
   * Asked when the close button is clicked: false keeps the window open (it may close itself
   * later). A close by script does not ask.
   */
  beforeClose?: () => boolean;
  /** The sub-movie, for its stage colour (`STAGE_COLOR`). */
  movie?: string;
}

export function createWindowLayer(store?: WindowPosStore): WindowLayer {
  const el = document.createElement("div");
  el.className = "window-layer";
  el.dataset.shell = "desktop";
  let scale = 1;
  const windows: { win: HTMLElement; opts: WindowOptions; pos: { x: number; y: number } | null }[] =
    [];

  const posKey = (opts: WindowOptions) => opts.posKey ?? opts.name;

  const place = (w: (typeof windows)[number]) => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // A window larger than the screen (Player Settings on a phone) shrinks to fit, so its close
    // button and edges stay reachable; any other window keeps the layer's scale.
    const baseW = w.win.offsetWidth || w.opts.width;
    const baseH = w.win.offsetHeight || w.opts.height + 20;
    const s = Math.min(scale, vw / baseW, vh / baseH);
    const pw = baseW * s;
    const ph = baseH * s;
    let seed = w.pos;
    if (!seed && store?.shouldRemember()) {
      seed = store.load(posKey(w.opts));
    }
    const pos = seed ? { x: seed.x, y: seed.y } : { x: (vw - pw) / 2, y: (vh - ph) / 2 };
    pos.x = Math.max(0, Math.min(pos.x, Math.max(0, vw - pw)));
    pos.y = Math.max(0, Math.min(pos.y, Math.max(0, vh - ph)));
    w.pos = pos;
    w.win.style.left = `${pos.x}px`;
    w.win.style.top = `${pos.y}px`;
    w.win.style.transform = `scale(${s})`;
  };

  return {
    el,
    setScale(sc) {
      scale = sc;
      for (const w of windows) {
        if (!w.win.hidden) {
          place(w);
        }
      }
    },
    resetPositions() {
      for (const w of windows) {
        if (w.win.hidden) {
          w.pos = null;
        }
      }
    },
    create(opts) {
      const win = document.createElement("div");
      win.className = `sso-window window-${opts.name}`;
      win.hidden = true;
      win.setAttribute("role", "dialog");
      win.setAttribute("aria-label", opts.title);
      const bar = action(document.createElement("div"), "window-drag");
      bar.className = "window-bar";
      const title = document.createElement("span");
      title.className = "window-title";
      title.textContent = opts.title;
      const close = action(document.createElement("button"), "window-close");
      close.type = "button";
      close.className = "window-close";
      close.textContent = "×";
      close.setAttribute("aria-label", `Close ${opts.title}`);
      bar.append(title, close);
      const body = document.createElement("div");
      body.className = "window-body";
      body.style.setProperty("--w", `${opts.width}px`);
      body.style.setProperty("--h", `${opts.height}px`);
      const stageColor = opts.movie ? STAGE_COLOR[opts.movie] : undefined;
      if (stageColor) {
        body.style.backgroundColor = stageColor;
      }
      body.append(opts.body);
      win.append(bar, body);
      el.append(win);
      const entry = { win, opts, pos: null as { x: number; y: number } | null };
      windows.push(entry);

      // Drag by the title bar.
      bar.addEventListener("pointerdown", (e) => {
        if (e.target === close) {
          return;
        }
        const start = { x: e.clientX, y: e.clientY, pos: { ...(entry.pos ?? { x: 0, y: 0 }) } };
        bar.setPointerCapture?.(e.pointerId);
        const move = (ev: PointerEvent) => {
          entry.pos = {
            x: start.pos.x + ev.clientX - start.x,
            y: start.pos.y + ev.clientY - start.y,
          };
          place(entry);
        };
        const up = () => {
          bar.removeEventListener("pointermove", move);
          bar.removeEventListener("pointerup", up);
          bar.removeEventListener("pointercancel", up);
          if (entry.pos && store?.shouldRemember()) {
            store.save(posKey(opts), entry.pos);
          }
        };
        bar.addEventListener("pointermove", move);
        bar.addEventListener("pointerup", up);
        bar.addEventListener("pointercancel", up);
        e.preventDefault();
      });

      const gw: GameWindow = {
        el: win,
        get isOpen() {
          return !win.hidden;
        },
        open() {
          const wasClosed = win.hidden;
          win.hidden = false;
          el.append(win); // on top
          if (wasClosed && store && !store.shouldRemember()) {
            entry.pos = null;
          }
          place(entry);
        },
        close() {
          if (win.hidden) {
            return;
          }
          win.hidden = true;
          if (store && !store.shouldRemember()) {
            entry.pos = null;
            win.style.left = "";
            win.style.top = "";
          }
          opts.onClose?.();
        },
        setTitle(t) {
          title.textContent = t;
          win.setAttribute("aria-label", t);
        },
      };
      close.addEventListener("click", () => {
        if (opts.beforeClose?.() !== false) {
          gw.close();
        }
      });
      return gw;
    },
  };
}
