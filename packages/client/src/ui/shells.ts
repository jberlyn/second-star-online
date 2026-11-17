/**
 * The game screen: the classic layout only. The 800×600 frame (frame 63) at its original rects, scaled
 * as a unit under 1.6's menu bar (a 20 px strip scaled with it). Any window size gets it, scaled
 * down to fit when the window is small.
 */
import type { Assets } from "../assets.ts";
import { PLAYFIELD_H, PLAYFIELD_W } from "../playfield.ts";
import { BARS_RECT } from "./bars.ts";
import { MENU_BAR_H, type MenuBar } from "./menubar.ts";
import { artImg, DIRECTOR_BAR_W, fitScale, type StageItem, wholeStage } from "./stage.ts";

export interface GameParts {
  playfield: HTMLCanvasElement;
  chatLog: HTMLElement;
  chatInput: HTMLInputElement;
  /** The classic layout's menu bar holder (ui/menubar.ts). */
  menuBar: MenuBar;
  /** HP, SP and power bars (ui/bars.ts). */
  bars: HTMLElement;
  /** The right panel: tabs, bag, equipment, stats, skills (ui/panel.ts). */
  panel: HTMLElement;
  /** The item menu's 800×600 layer (ui/panel.ts `menuLayer`). */
  menuLayer: HTMLElement;
  /** The crystal amount dialog (ui/amount.ts), 253×117 at stage (223, 183). */
  amount: HTMLElement;
  /** The shop and vault window (ui/shop.ts), 213×266 at stage (205, 89). */
  shop: HTMLElement;
  /** The PROCESSING box (sprite 370), 106×32 at stage (271, 221). */
  shopBusy: HTMLElement;
  /** A 544×384 layer over the playfield, in playfield pixels (the player menu). */
  overlay: HTMLElement;
  /** The map header, the in-game map header field on sprite 299 at [139, 426, 458, 442]. */
  header: HTMLElement;
  /** The Guild Center (ui/guildcenter.ts), 356×299 at stage (151, 29). */
  guild: HTMLElement;
  /** The Slot Machine panel (ui/slots.ts), 316×243 at stage (155, 48). */
  slots: HTMLElement;
  /** The Blackjack Table (ui/blackjack.ts), 340×233 at stage (153, 54). */
  blackjack: HTMLElement;
  /** The mail screen (ui/mail.ts), 350×350 at stage (154, 28). */
  mail: HTMLElement;
  /** The message board window (ui/board.ts), 350×303 at stage (185, 14). */
  board: HTMLElement;
  /** The paint screen (ui/paint.ts), 414×293 at stage (91, 72). */
  paint: HTMLElement;
  /** The painting viewer (ui/paint.ts), 229×87 at stage (330, 166). */
  viewer: HTMLElement;
}

export interface GameView {
  root: HTMLElement;
  /** Re-fits to the window (resize). */
  fit(w: number, h: number, sharpPixels: boolean): void;
  /** The frame's current scale; windows scale with it. */
  scale: number;
  /**
   * Frame 72 (the Guild Center): the panel's tab icons and every tab's contents are off it, so
   * the panel shows only its background and the bars.
   */
  setFrame72(on: boolean): void;
}

/**
 * Frame 63's frame pieces (assets/original/main/layout/frame-63.json), by score channel. The
 * four tab icons are not frame art: the build erases the copies baked into #186 and the panel
 * draws them on one row (ui/panel.ts).
 */
function frameArt(a: Assets): StageItem[] {
  const m = (n: number) => artImg(a.ui("internal", n));
  return [
    { el: m(188), x: 597, y: 53, w: 204, h: 271, z: 3, art: true },
    { el: m(186), x: 566, y: 0, w: 234, h: 600, z: 4, art: true },
    { el: m(187), x: 1, y: 0, w: 565, h: 41, z: 256, art: true },
    { el: m(190), x: 1, y: 41, w: 33, h: 559, z: 257, art: true },
    { el: m(191), x: 34, y: 404, w: 532, h: 196, z: 258, art: true },
    { el: m(406), x: 22, y: 41, w: 12, h: 379, z: 271, art: true },
    { el: m(407), x: 34, y: 404, w: 532, h: 21, z: 279, art: true },
    { el: m(405), x: 566, y: 26, w: 12, h: 397, z: 284, art: true },
  ];
}

export function createGameView(a: Assets, parts: GameParts): GameView {
  const root = document.createElement("div");
  root.className = "game";
  root.dataset.shell = "desktop";
  // Wooden bar-slot cutouts of Internal #186: drawn above the bar tracks/fills (36-64) so the
  // bars sit inside the 5 px transparent slots without overlapping the bevels, and the right 11 px
  // edge (x 789-800) drawn above the numbers (318-319) so 1 HP/SP hides behind the wooden edge.
  const barsCutout = document.createElement("div");
  barsCutout.className = "bars-cutout";
  barsCutout.append(artImg(a.ui("internal", 186)));
  const barsEdge = document.createElement("div");
  barsEdge.className = "bars-edge";
  barsEdge.append(artImg(a.ui("internal", 186)));

  const stage = wholeStage([
    ...frameArt(a),
    // Channels 105/106, but drawn above the frame art (channels 256+): Internal #191 is
    // opaque grey under the chat, and 1.6 showed the chat text on it.
    // The box runs on past the 742 px field so the browser's bar sits where Director's
    // was, x 765-780 (`.director-scroll`).
    { el: parts.chatLog, x: 20, y: 456, w: 742 + DIRECTOR_BAR_W, h: 88, z: 300 },
    // The entry fills the lower well of Internal #191/#186 (interior x 18-780, y 554-573), not
    // the score's 756×20 text rect: a browser centres a single-line input and gives it its own
    // inline start padding, so the box itself must be the well for the text to land on Director's
    // 1 px margin. It starts 3 px into the well for a little more left margin, and sits 2 px below
    // the well's top because browser centring leaves the glyphs high in the field.
    { el: parts.chatInput, x: 21, y: 556, w: 760, h: 20, z: 301 },
    { el: parts.playfield, x: 30, y: 31, w: PLAYFIELD_W, h: PLAYFIELD_H, z: 110 },
    // Score channels 36-64 (bars, above panel art 4 and below strips 256+); the current/max
    // numbers live in hover zones at z 321 (bars.ts), above strips 256+ and playfield 110. No z on the wrapper so each child keeps its own
    // channel on the stage, and high numbers spill left of x 590 over the frame.
    { el: parts.bars, ...BARS_RECT },
    { el: barsCutout, x: 566, y: BARS_RECT.y, w: 234, h: BARS_RECT.h, z: 65 },
    { el: barsEdge, x: 789, y: BARS_RECT.y, w: 11, h: BARS_RECT.h, z: 320 },
    // The pages (channels 35-100, 220-234, 354-359) above the panel art (3, 4).
    { el: parts.panel, x: 566, y: 0, w: 234, h: 410, z: 35 },
    // The item menu: a bag click sets sprites 95-100 to locZ 7000-7005, above everything.
    { el: parts.menuLayer, x: 0, y: 0, w: 800, h: 600, z: 7000 },
    // Channels 88-92: the dialog sits in the playfield.
    { el: parts.amount, x: 223, y: 183, w: 253, h: 117, z: 400 },
    // Channels 210-219 and 370 (locZ 9999 when shown), in the playfield.
    { el: parts.shop, x: 205, y: 89, w: 213, h: 266, z: 401 },
    { el: parts.shopBusy, x: 271, y: 221, w: 106, h: 32, z: 403 },
    // Sprites 302-304 at locZ 9993-9997, above the playfield's sprites.
    { el: parts.overlay, x: 30, y: 31, w: PLAYFIELD_W, h: PLAYFIELD_H, z: 402 },
    { el: parts.header, x: 139, y: 426, w: 319, h: 16, z: 299 },
    // Frame 72's guild sprites, locZ 9991-9999, in place on the stage.
    { el: parts.guild, x: 151, y: 29, w: 356, h: 299, z: 9991 },
    // Frame 72's slot sprites 333-336, in place on the stage.
    { el: parts.slots, x: 155, y: 48, w: 316, h: 243, z: 9100 },
    // Frame 72's blackjack sprites 333 and 338-353, in place likewise.
    { el: parts.blackjack, x: 153, y: 54, w: 340, h: 233, z: 9100 },
    // Frame 72's mail sprites (locZ 9000-9817), and the board's 193-198 (locZ 5004-5009), in place
    // on the stage.
    { el: parts.mail, x: 154, y: 28, w: 350, h: 350, z: 9000 },
    { el: parts.board, x: 185, y: 14, w: 350, h: 303, z: 5004 },
    // Paintings: sprites 395-399 at locZ ch+9900; the viewer's 395 at 3889 and
    // its author field at 9988, above the panel and the guild screen.
    { el: parts.paint, x: 91, y: 72, w: 414, h: 293, z: 10295 },
    { el: parts.viewer, x: 330, y: 166, w: 229, h: 87, z: 10295 },
  ]);
  const holder = document.createElement("div");
  holder.className = "stage-holder";
  holder.append(stage);
  const frame = document.createElement("div");
  frame.className = "desktop-frame";
  frame.append(parts.menuBar.el, holder);
  root.append(frame);

  const view: GameView = {
    root,
    scale: 1,
    setFrame72(on) {
      root.classList.toggle("f72", on);
    },
    fit(w, h, sharpPixels) {
      const s = fitScale(w, h, sharpPixels, MENU_BAR_H);
      view.scale = s;
      parts.menuBar.setScale(s);
      stage.style.transform = `scale(${s})`;
      holder.style.width = `${800 * s}px`;
      holder.style.height = `${600 * s}px`;
    },
  };
  return view;
}
