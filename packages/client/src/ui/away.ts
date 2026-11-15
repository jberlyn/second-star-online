/**
 * The Away window (stage 300×225), assets/original/sub/AwayMessageWindow/layout/frame-1.json:
 * - the purple frame (member 3) at [0, -1, 300, 225];
 * - the away message field [10, 11, 290, 71]: your away text, Geneva 12 white, editable;
 * - Away (member 4) at [190, 77, 242, 97] and Back (member 8) at [243, 77, 295, 97], labels in
 *   their art;
 * - the `Messages` field [8, 102, 293, 217]: IMs received while away, Geneva 12 white, scrolling.
 *
 * Away sends the field's text and empties `Messages`; Back turns it off and keeps them. The main
 * chat's ON/OFF line comes from the server. Its only opener is the Friends window's third button.
 * No sound.
 */
import { CHAT_SOCIAL_TEXT } from "@secondstaronline/shared";

import type { Assets } from "../assets.ts";
import { action } from "./action.ts";
import { appendLine, artImg, place, type Rect } from "./im.ts";
import type { GameWindow, WindowLayer } from "./window.ts";

export const AWAY_STAGE = { w: 300, h: 225 } as const;
const r = (l: number, t: number, rr: number, b: number): Rect => ({
  x: l,
  y: t,
  w: rr - l,
  h: b - t,
});
export const AWAY_RECTS = {
  frame: r(0, -1, 300, 225),
  away: r(190, 77, 242, 97),
  back: r(243, 77, 295, 97),
  messages: r(8, 102, 293, 217),
  text: r(10, 11, 290, 71),
} as const;

export interface AwayWindow {
  window: GameWindow;
  open(): void;
  /** An IM that arrived while away. */
  log(from: string, text: string): void;
  readonly messages: HTMLElement;
}

export function createAwayWindow(
  a: Assets,
  layer: WindowLayer,
  act: { away(text: string | null): void },
): AwayWindow {
  const stage = document.createElement("div");
  stage.className = "im-stage away-stage";
  const frame = place(artImg(a, "AwayMessageWindow", 3, "im-art"), AWAY_RECTS.frame, "im-abs");
  const text = place(
    action(document.createElement("textarea"), "away-message"),
    AWAY_RECTS.text,
    "im-abs",
  );
  text.classList.add("im-field", "away-field");
  text.setAttribute("aria-label", "Away message");
  // No keyUp behaviour is attached to it: Enter types a RETURN, as in any field.
  const messages = place(document.createElement("div"), AWAY_RECTS.messages, "im-abs");
  messages.classList.add("im-receive", "away-messages");
  messages.setAttribute("role", "log");
  const button = (member: 4 | 8, label: string, rect: Rect, on: () => void) => {
    const b = place(
      action(document.createElement("button"), member === 4 ? "away-set" : "away-back"),
      rect,
      "im-abs",
    );
    b.classList.add("im-btn");
    b.type = "button";
    b.setAttribute("aria-label", label);
    b.append(artImg(a, "AwayMessageWindow", member, "im-btn-art"));
    b.addEventListener("click", on);
    return b;
  };
  const awayBtn = button(4, "Away", AWAY_RECTS.away, () => {
    act.away(text.value);
    messages.textContent = "";
  });
  const backBtn = button(8, "Back", AWAY_RECTS.back, () => act.away(null));
  stage.append(frame, text, awayBtn, backBtn, messages);
  const win = layer.create({
    title: CHAT_SOCIAL_TEXT.awayTitle,
    name: "away",
    movie: "AwayMessageWindow",
    width: AWAY_STAGE.w,
    height: AWAY_STAGE.h,
    body: stage,
  });
  return {
    window: win,
    messages,
    open: () => win.open(),
    log(from, t) {
      appendLine(messages, CHAT_SOCIAL_TEXT.awayLog(from, t));
    },
  };
}
