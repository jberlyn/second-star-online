/**
 * A sign's text in play: clicking a `Sign 1`-`Sign 3` ground item from any distance or Ctrl facing
 * one puts Internal #10 on sprite 292 and the map's sign text into the sign text field (sprite 293,
 * Arial white at stage (192, 175), 241 wide). Clicking the panel hides it. Sprite 294 has no member
 * on frames 50-78, so nothing more shows. Rects are relative to the playfield overlay, whose origin
 * is stage (30, 31).
 */
import type { Assets } from "../assets.ts";
import { action } from "./action.ts";
import { artImg } from "./stage.ts";

export interface SignPanel {
  el: HTMLElement;
  show(text: string): void;
  close(): void;
  readonly open: boolean;
}

/** Internal #10 (286×113, reg 41, 72) at sprite 292's loc (209, 223): stage [168, 151]. */
export const SIGN_RECT = { x: 168 - 30, y: 151 - 31, w: 286, h: 113 };
/** The sign text field at stage (192, 175), 241 wide. */
export const SIGN_TEXT_RECT = { x: 192 - 168, y: 175 - 151, w: 241, h: 264 - 175 };

export function createSignPanel(assets: Assets): SignPanel {
  const el = action(document.createElement("div"), "sign-close");
  el.className = "sign-panel";
  el.hidden = true;
  el.setAttribute("role", "dialog");
  el.style.cssText = `left:${SIGN_RECT.x}px;top:${SIGN_RECT.y}px;width:${SIGN_RECT.w}px;height:${SIGN_RECT.h}px`;
  el.append(artImg(assets.ui("internal", 10)));
  const text = document.createElement("div");
  text.className = "sign-text";
  text.style.cssText = `left:${SIGN_TEXT_RECT.x}px;top:${SIGN_TEXT_RECT.y}px;width:${SIGN_TEXT_RECT.w}px;height:${SIGN_TEXT_RECT.h}px`;
  el.append(text);
  const close = () => {
    el.hidden = true;
  };
  el.addEventListener("click", close);
  return {
    el,
    show(t) {
      text.textContent = t;
      el.setAttribute("aria-label", t);
      el.hidden = false;
    },
    close,
    get open() {
      return !el.hidden;
    },
  };
}
