/**
 * The IMsend window and the ten IM windows.
 *
 * **IMsend** (stage 315×150, assets/original/sub/IMsend/layout/frame-1.json): the art
 * (member 1) at [7, 7, 307, 118] with the "To:" label in it; the `To` field [56, 9, 232, 24]
 * (Geneva 12 bold black); the `Send` field [11, 43, 302, 114] (Geneva 12 black); the Send button
 * (member 2) at [261, 123, 304, 145]. Opened by the Game menu's Send Instant Message (both fields
 * emptied) and the Who window's IM button (`To` = the selection). Send, or Enter in `Send`, empties
 * `Send` first, then with a text and a recipient closes the window and sends; with no recipient
 * the window stays and the text is gone.
 *
 * **IMwin1-10** (stage 370×240, all laid out alike, IMwin1/frame-1.json): the art at [4, 9, 366,
 * 207]; the received-text field [6, 10, 362, 114] (Geneva 12 bold black, scrolling, not editable); `Send` at
 * frames 2-28's stretched rect [9, 132, 359, 203]; Send (member 2) at [321, 213, 364, 235]. An
 * IM shows in the slot already holding its sender, else the lowest free one, else a random one,
 * which it clears; closing a window never frees its slot (as in 1.6) (`pickImSlot`).
 *
 * Neither plays a sound.
 */
import {
  CHAT_SOCIAL_TEXT,
  IM_SLOTS,
  pickImSlot,
  replySlot,
  stripReturns,
} from "@secondstaronline/shared";

import type { Assets } from "../assets.ts";
import { action } from "./action.ts";
import type { GameWindow, WindowLayer } from "./window.ts";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
const r = (l: number, t: number, rr: number, b: number): Rect => ({
  x: l,
  y: t,
  w: rr - l,
  h: b - t,
});

export const IMSEND_STAGE = { w: 315, h: 150 } as const;
/** IMsend's sprites at their `frame-1.json` rects. */
export const IMSEND_RECTS = {
  art: r(7, 7, 307, 118),
  button: r(261, 123, 304, 145),
  send: r(11, 43, 302, 114),
  to: r(56, 9, 232, 24),
} as const;

export const IMWIN_STAGE = { w: 370, h: 240 } as const;
/** An IM window's sprites; `send` is frames 2-28's stretched rect (frame 1's is stale). */
export const IMWIN_RECTS = {
  art: r(4, 9, 366, 207),
  button: r(321, 213, 364, 235),
  send: r(9, 132, 359, 203),
  receive: r(6, 10, 362, 114),
} as const;

/** Places an element at a stage rect (`.im-abs`). */
export function place<T extends HTMLElement>(el: T, rect: Rect, cls: string): T {
  el.classList.add(cls);
  el.style.setProperty("--x", `${rect.x}px`);
  el.style.setProperty("--y", `${rect.y}px`);
  el.style.setProperty("--w", `${rect.w}px`);
  el.style.setProperty("--h", `${rect.h}px`);
  return el;
}

export function artImg(a: Assets, movie: string, member: number, cls: string): HTMLImageElement {
  const img = document.createElement("img");
  img.className = `${cls} art`;
  img.src = a.ui(movie, member);
  img.alt = "";
  img.draggable = false;
  return img;
}

/** A window field: Enter runs `onEnter` (as the original's key-up scripts did), no line break. */
export function onEnterKey(el: HTMLElement, onEnter: () => void): void {
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      onEnter();
    } else {
      e.stopPropagation();
    }
  });
}

/** Appends a line (and RETURN) to a log field and scrolls it to the end. */
export function appendLine(el: HTMLElement, line: string): void {
  el.textContent = `${el.textContent ?? ""}${line}\n`;
  el.scrollTop = el.scrollHeight;
}

export interface ImActions {
  /** Sends an IM (`via` "send" from IMsend, "window" from a reply), the raw field text. */
  send(to: string, text: string, via: "send" | "window"): void;
  /** Your character's name, for the reply echo. */
  me(): string;
}

export interface ImWindows {
  /** Opens IMsend with `To` filled (Who, Friends) or empty (the Game menu). */
  openSend(to: string): void;
  /** An IM arrives. */
  receive(from: string, text: string): void;
  /** Your reply's echo into the window holding `to`. */
  echo(to: string, text: string): void;
  /** A refused send's text goes back. */
  restoreSend(to: string, text: string): void;
  restoreReply(to: string, text: string): void;
  /** The slots' senders (null: never used). */
  readonly slots: readonly (string | null)[];
  readonly sendWindow: GameWindow;
  windowOf(slot: number): GameWindow | null;
  closeAll(): void;
}

export function createImWindows(
  a: Assets,
  layer: WindowLayer,
  act: ImActions,
  random: (n: number) => number = (n) => 1 + Math.floor(Math.random() * n),
): ImWindows {
  // ---- IMsend --------------------------------------------------------------------------
  const sendStage = document.createElement("div");
  sendStage.className = "im-stage";
  const sendArt = place(artImg(a, "IMsend", 1, "im-art"), IMSEND_RECTS.art, "im-abs");
  const toField = place(
    action(document.createElement("input"), "message-recipient"),
    IMSEND_RECTS.to,
    "im-abs",
  );
  toField.classList.add("im-to");
  toField.type = "text";
  toField.autocomplete = "off";
  toField.spellcheck = false;
  toField.setAttribute("aria-label", "To");
  const sendField = place(
    action(document.createElement("textarea"), "message-text"),
    IMSEND_RECTS.send,
    "im-abs",
  );
  sendField.classList.add("im-field");
  sendField.setAttribute("aria-label", "Message");
  const sendBtn = place(
    action(document.createElement("button"), "message-send"),
    IMSEND_RECTS.button,
    "im-abs",
  );
  sendBtn.classList.add("im-btn");
  sendBtn.type = "button";
  sendBtn.setAttribute("aria-label", "Send");
  sendBtn.append(artImg(a, "IMsend", 2, "im-btn-art"));
  sendStage.append(sendArt, toField, sendField, sendBtn);
  const sendWin = layer.create({
    title: CHAT_SOCIAL_TEXT.imSendTitle,
    name: "imsend",
    movie: "IMsend",
    width: IMSEND_STAGE.w,
    height: IMSEND_STAGE.h,
    body: sendStage,
  });
  // The Send button: `Send` is emptied before anything is checked.
  const doSend = () => {
    const text = sendField.value;
    sendField.value = "";
    const to = toField.value;
    if (stripReturns(text) === "" || to === "") {
      return;
    }
    sendWin.close();
    act.send(to, text, "send");
  };
  sendBtn.addEventListener("click", doSend);
  onEnterKey(sendField, doSend);
  onEnterKey(toField, () => {}); // Enter in `To` does nothing special.

  // ---- IMwin1-10 --------------------------------------------------------------------------
  const slots: (string | null)[] = Array.from({ length: IM_SLOTS }, () => null);
  const wins: { win: GameWindow; receive: HTMLElement; field: HTMLTextAreaElement }[] = [];
  const imWin = (slot: number) => {
    const have = wins[slot - 1];
    if (have) {
      return have;
    }
    const stage = document.createElement("div");
    stage.className = "im-stage";
    const art = place(artImg(a, "IMwin1", 1, "im-art"), IMWIN_RECTS.art, "im-abs");
    const receive = place(document.createElement("div"), IMWIN_RECTS.receive, "im-abs");
    receive.classList.add("im-receive");
    receive.setAttribute("role", "log");
    const field = place(
      action(document.createElement("textarea"), "message-reply-text"),
      IMWIN_RECTS.send,
      "im-abs",
    );
    field.classList.add("im-field");
    field.setAttribute("aria-label", "Reply");
    const btn = place(
      action(document.createElement("button"), "message-reply-send"),
      IMWIN_RECTS.button,
      "im-abs",
    );
    btn.classList.add("im-btn");
    btn.type = "button";
    btn.setAttribute("aria-label", "Send");
    btn.append(artImg(a, "IMwin1", 2, "im-btn-art"));
    stage.append(art, receive, field, btn);
    const win = layer.create({
      title: "",
      name: "imwin",
      movie: "IMwin1",
      width: IMWIN_STAGE.w,
      height: IMWIN_STAGE.h,
      body: stage,
    });
    // The window's Send button: the field is emptied, then the message is sent to
    // this window's sender (the front window's slot).
    const reply = () => {
      const text = field.value;
      field.value = "";
      const to = slots[slot - 1];
      if (stripReturns(text) === "" || to == null) {
        return;
      }
      act.send(to, text, "window");
    };
    btn.addEventListener("click", reply);
    onEnterKey(field, reply);
    const w = { win, receive, field };
    wins[slot - 1] = w;
    return w;
  };

  return {
    slots,
    sendWindow: sendWin,
    windowOf: (slot) => wins[slot - 1]?.win ?? null,
    openSend(to) {
      toField.value = to;
      sendField.value = "";
      sendWin.open();
    },
    receive(from, text) {
      const pick = pickImSlot(slots, from, random);
      slots[pick.slot - 1] = from;
      const w = imWin(pick.slot);
      if (pick.opening) {
        w.field.value = "";
        w.receive.textContent = "";
      }
      w.win.setTitle(CHAT_SOCIAL_TEXT.imTitle(from));
      w.win.open();
      appendLine(w.receive, CHAT_SOCIAL_TEXT.imLine(from, text));
    },
    echo(to, text) {
      const slot = replySlot(slots, to);
      if (slot !== null) {
        appendLine(imWin(slot).receive, CHAT_SOCIAL_TEXT.imLine(act.me(), text));
      }
    },
    restoreSend(to, text) {
      toField.value = to;
      sendField.value = text;
      sendWin.open();
    },
    restoreReply(to, text) {
      const slot = replySlot(slots, to);
      if (slot !== null) {
        const w = imWin(slot);
        if (w.field.value === "") {
          w.field.value = text;
        }
      }
    },
    closeAll() {
      sendWin.close();
      for (const w of wins) {
        w?.win.close();
      }
    },
  };
}
