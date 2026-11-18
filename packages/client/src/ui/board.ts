/**
 * The message board window. On the play frames the board's sprites 193-198 are 1×1 placeholders
 * that the board's sort script swaps for the real members, each at its own size with its
 * regpoint on the placeholder's loc, so the rects below are from the member sizes (no frame PNG
 * shows them). Origin: the art, stage (185, 14), 350×303; locZ 5004-5009. No sound anywhere.
 *
 * POST and CLOSE are the members' own scripts. A post keeps the window open: the server reloads
 * the board with the post on it, scrolled to the end (1.6 closed the window without a reload).
 */
import type { Assets } from "../assets.ts";
import { action } from "./action.ts";
import { artImg, type Rect } from "./stage.ts";

export const BOARD_ORIGIN = { x: 185, y: 14 } as const;
export const BOARD_SIZE = { w: 350, h: 303 } as const;

const R = (l: number, t: number, r: number, b: number): Rect => ({
  x: l,
  y: t,
  w: r - l,
  h: b - t,
});

export const BOARD_RECTS = {
  art: R(185, 14, 535, 317),
  topic: R(261, 23, 479, 39),
  close: R(415, 288, 472, 308),
  post: R(472, 288, 524, 307),
  text: R(203, 45, 502, 210),
  postText: R(204, 215, 516, 273),
} as const;

export interface BoardActions {
  /** Post: the post's text field as typed. */
  post(text: string): void;
  /** Close. */
  close(): void;
  /** The key lock. */
  lock(on: boolean): void;
}

export interface BoardWindow {
  el: HTMLElement;
  readonly isOpen: boolean;
  /** The board and its lock (a reload after a post, too), or null to close it. */
  show(board: { topic: string; text: string; lock: boolean } | null): void;
  /** Game entry hides it. */
  reset(): void;
}

export function createBoardWindow(a: Assets, act: BoardActions): BoardWindow {
  const el = document.createElement("div");
  el.className = "board-window";
  el.hidden = true;
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", "Message board");
  const put = <T extends HTMLElement>(node: T, r: Rect, z: number): T => {
    node.style.left = `${r.x - BOARD_ORIGIN.x}px`;
    node.style.top = `${r.y - BOARD_ORIGIN.y}px`;
    node.style.width = `${r.w}px`;
    node.style.height = `${r.h}px`;
    node.style.zIndex = String(z);
    el.append(node);
    return node;
  };
  const backdrop = put(artImg(a.ui("internal", 143)), BOARD_RECTS.art, 5004);
  backdrop.classList.add("board-art");
  const topic = put(document.createElement("div"), BOARD_RECTS.topic, 5005);
  topic.className = "board-field board-topic";
  const text = put(document.createElement("div"), BOARD_RECTS.text, 5008);
  text.className = "board-field board-text";
  text.tabIndex = 0;
  text.setAttribute("aria-label", "Messages");
  const postText = put(
    action(document.createElement("textarea"), "board-post-text"),
    BOARD_RECTS.postText,
    5009,
  );
  postText.className = "board-field board-post-text";
  postText.spellcheck = false;
  postText.setAttribute("aria-label", "Your post");
  // A `limit` box: typing stops when the 312×58 box is full (the 1.6 cap on a post's size).
  let fit = "";
  postText.addEventListener("input", () => {
    if (postText.scrollHeight > postText.clientHeight && postText.clientHeight > 0) {
      postText.value = fit;
    }
    fit = postText.value;
  });
  const button = (m: number, label: string, r: Rect, z: number, on: () => void) => {
    const b = put(
      action(document.createElement("button"), `board-${label.toLowerCase().replaceAll(" ", "-")}`),
      r,
      z,
    );
    b.type = "button";
    b.className = "hit board-button";
    b.setAttribute("aria-label", label);
    b.append(artImg(a.ui("internal", m), label));
    b.addEventListener("click", on);
    return b;
  };
  // CLOSE: hide, unlock, tell the server; no sound.
  button(146, "Close", BOARD_RECTS.close, 5006, () => {
    hide();
    act.lock(false);
    act.close();
  });
  // POST: the server tests the text and reloads the board; the keys stay locked.
  button(145, "Post", BOARD_RECTS.post, 5007, () => {
    act.post(postText.value);
  });

  let open = false;
  const hide = () => {
    open = false;
    el.hidden = true;
  };
  return {
    el,
    get isOpen() {
      return open;
    },
    show(board) {
      if (!board) {
        hide();
        return;
      }
      // A reload of the open board follows a post: it scrolls to the end, where the post is.
      const reload = open && topic.textContent === board.topic;
      open = true;
      el.hidden = false;
      topic.textContent = board.topic;
      // The file's carriage returns are line breaks; the field's text is the whole board.
      text.textContent = board.text.replace(/\r\n|\r/g, "\n");
      text.scrollTop = reload ? text.scrollHeight : 0;
      // The board's sort script empties the post field.
      postText.value = "";
      fit = "";
      act.lock(board.lock);
    },
    reset() {
      hide();
    },
  };
}
