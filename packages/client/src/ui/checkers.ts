/**
 * The Checkers window ("Checkers"). Stage 304×310
 * (assets/original/sub/Checkers/layout/frame-1.json): the board (ch 1, member 1) at
 * [0, 0, 304, 310]; 24 pieces 30×30 at loc − (15, 15) (Black 2, White 3, BlackKing 6, WhiteKing
 * 7); the two name fields [95, 3, 195, 19] and [93, 17, 224, 33] ("Black is <name>", "White is
 * <name>"); the selection `Box` (34×34, reg 17,17, ch 28) on the selected piece; the turn marker
 * (member 14, 17×17, reg 8,8, ch 29). The reference copies on channels 112-135 are not drawn.
 *
 * The selection and the marker are the client's own, as in 1.6 (sprite 28 moves only inside
 * your window; sprite 29 only when it becomes your turn): the marker starts off the stage and
 * first appears after a move, and a reset never moves it. The server never sees a selection; a
 * click on the board sends the direction.
 */
import {
  CK_MARKER,
  CK_TEXT,
  fill,
  ownedBy,
  type Piece,
  type PieceName,
} from "@secondstaronline/shared";

import type { Assets } from "../assets.ts";
import { action } from "./action.ts";
import { artImg, type Rect } from "./stage.ts";
import type { GameWindow, WindowLayer } from "./window.ts";

export const CK_STAGE = { w: 304, h: 310 } as const;

/** Stage rects ([l, t, r, b] → x, y, w, h). */
export const CK_RECTS = {
  board: { x: 0, y: 0, w: 304, h: 310 },
  p1name: { x: 95, y: 3, w: 100, h: 16 },
  p2name: { x: 93, y: 17, w: 131, h: 16 },
} as const;

/** Cast members of the `Checkers` sub-movie. */
export const CK_MEMBER: Readonly<Record<PieceName, number>> = {
  Black: 2,
  White: 3,
  BlackKing: 6,
  WhiteKing: 7,
};
const BOX_MEMBER = 8;
const MARKER_MEMBER = 14;

/** A piece's rect: its loc − (15, 15) (30×30). */
export function pieceRect(p: Pick<Piece, "h" | "v">): Rect {
  return { x: p.h - 15, y: p.v - 15, w: 30, h: 30 };
}

export type CkView = Extract<import("@secondstaronline/shared").ServerMsg, { t: "ck"; open: true }>;

export interface CheckersActions {
  /** `ckMove`: the piece (0-23) towards the click. */
  move(piece: number, dh: -1 | 1, dv: -1 | 1): void;
  /** Closing the window quits. */
  close(): void;
  /** The key lock. */
  lock(on: boolean): void;
}

export interface CheckersWindow {
  window: GameWindow;
  readonly isOpen: boolean;
  /** The server's view; the first one opens the window. */
  view(v: CkView): void;
  /** Shuts the window with no quit message (logout, a lost connection). */
  reset(): void;
}

const place = (el: HTMLElement, r: Rect, z: number) => {
  el.style.left = `${r.x}px`;
  el.style.top = `${r.y}px`;
  el.style.width = `${r.w}px`;
  el.style.height = `${r.h}px`;
  el.style.zIndex = String(z);
};

const sign = (n: number): -1 | 0 | 1 => (n < 0 ? -1 : n > 0 ? 1 : 0);

export function createCheckersWindow(
  a: Assets,
  layer: WindowLayer,
  act: CheckersActions,
): CheckersWindow {
  const stage = document.createElement("div");
  stage.className = "ck-stage";
  const boardImg = artImg(a.ui("checkers", 1), "Checkers board");
  boardImg.classList.add("ck-art");
  place(boardImg, CK_RECTS.board, 1);
  const board = action(document.createElement("button"), "checkers-move");
  board.type = "button";
  board.className = "ck-board";
  board.setAttribute("aria-label", "Move the selected piece towards here");
  place(board, CK_RECTS.board, 2);
  const nameEls = [CK_RECTS.p1name, CK_RECTS.p2name].map((r, i) => {
    const s = document.createElement("div");
    s.className = `ck-name ck-name-${i + 1}`;
    place(s, r, 3);
    return s;
  });
  const box = artImg(a.ui("checkers", BOX_MEMBER), "");
  box.classList.add("ck-art", "ck-box");
  place(box, { x: -64, y: -81, w: 34, h: 34 }, 5);
  box.hidden = true;
  const marker = artImg(a.ui("checkers", MARKER_MEMBER), "Turn marker");
  marker.classList.add("ck-art", "ck-marker");
  place(marker, { x: 72, y: 2, w: 17, h: 17 }, 5);
  marker.hidden = true;
  const pieces = Array.from({ length: 24 }, (_, i) => {
    const b = action(document.createElement("button"), "checkers-select-piece");
    b.type = "button";
    b.className = "ck-piece";
    b.dataset.piece = String(i);
    b.setAttribute("aria-label", i < 12 ? "Black piece" : "White piece");
    const img = artImg(a.ui("checkers", CK_MEMBER.Black), "");
    img.classList.add("ck-art");
    b.append(img);
    stage.append(b);
    return { b, img };
  });
  stage.append(boardImg, board, ...nameEls, box, marker);

  let open = false;
  let side: 1 | 2 = 1;
  let turn: 0 | 1 | 2 = 0;
  let selected: number | null = null;
  let board24: Piece[] = [];

  const select = (i: number | null) => {
    selected = i;
    const p = i === null ? null : board24[i];
    if (!p) {
      selected = null;
      box.hidden = true;
      return;
    }
    place(box, { x: p.h - 17, y: p.v - 17, w: 34, h: 34 }, 5);
    box.hidden = false;
  };

  const win = layer.create({
    title: "Checkers",
    name: "checkers",
    width: CK_STAGE.w,
    height: CK_STAGE.h,
    body: stage,
    movie: "Checkers",
    // Closing the window quits.
    onClose: () => {
      if (open) {
        open = false;
        selected = null;
        act.lock(false);
        act.close();
      }
    },
  });

  pieces.forEach(({ b }, i) => {
    b.addEventListener("click", () => {
      // A piece click: your own piece on your turn takes the selection box.
      const p = board24[i];
      if (!open || turn !== side || !p || p.v <= 0 || !ownedBy(side, p.m)) {
        return;
      }
      select(i);
    });
  });
  board.addEventListener("click", (e) => {
    // A board click: towards the click, by the sign of its offset.
    if (!open || selected === null) {
      return;
    }
    const p = board24[selected];
    if (!p) {
      return;
    }
    const rect = board.getBoundingClientRect();
    const sx = rect.width > 0 ? CK_RECTS.board.w / rect.width : 1;
    const sy = rect.height > 0 ? CK_RECTS.board.h / rect.height : 1;
    const h = (e.clientX - rect.left) * sx;
    const v = (e.clientY - rect.top) * sy;
    const dh = sign(h - p.h);
    const dv = sign(v - p.v);
    if (dh === 0 || dv === 0) {
      return;
    }
    const i = selected;
    select(null);
    act.move(i, dh, dv);
  });

  return {
    window: win,
    get isOpen() {
      return open;
    },
    view(v) {
      const first = !open;
      open = true;
      side = v.side;
      if (first) {
        turn = 0;
        marker.hidden = true;
        select(null);
        win.open();
        act.lock(true);
      }
      board24 = v.pieces.map((p) => ({ ...p }));
      if (v.moved) {
        turn = v.moved.turn;
        const at = turn === 1 ? CK_MARKER.black : CK_MARKER.white;
        place(marker, { x: at[0] - 8, y: at[1] - 8, w: 17, h: 17 }, 5);
        marker.hidden = false;
      } else {
        // A join or a quit: both names known start Black's turn; a quit waits.
        turn = v.names[0] !== "" && v.names[1] !== "" ? 1 : 0;
      }
      const sel = selected;
      select(null);
      if (sel !== null && !v.moved && board24[sel]) {
        select(sel);
      }
      const texts = [CK_TEXT.black, CK_TEXT.white];
      nameEls.forEach((el, i) => {
        const name = v.names[i] ?? "";
        el.textContent = name ? fill(texts[i] ?? "", { USER: name }) : "";
      });
      board24.forEach((p, i) => {
        const el = pieces[i];
        if (!el) {
          return;
        }
        el.b.hidden = p.v < 0;
        const r = pieceRect(p);
        place(el.b, r, 4);
        el.img.src = a.ui("checkers", CK_MEMBER[p.m]);
        el.b.dataset.name = p.m;
      });
    },
    reset() {
      if (open) {
        open = false;
        selected = null;
        win.close();
      }
    },
  };
}
