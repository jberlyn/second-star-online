/**
 * The chat window (stage 500×300), one window for every room, titled "Chat".
 * assets/original/sub/ChatWindow/layout/frame-1.json and score-spans.jsonl (frames 2-28 stretch
 * three fields; frame 1's are stale):
 * - the art (member 1) at [0, -2, 500, 298];
 * - `Title` at [13, 10, 481, 34], Arial 12 black; `Chat` at [12, 34, 387, 243] and the user list at
 *   [397, 34, 490, 243], Arial 12 black, scrolling; the typing field at [11, 252, 487, 288], Courier 12
 *   black, editable.
 *
 * Entering a room keeps the old text and adds a blank line, the entry line and a blank line;
 * the roster is replaced by the snapshot, then grows with each join message (no duplicate
 * check) and shrinks with each leave message (lines 1-70, skipping the line after each
 * deletion). Closing the window leaves the room (the original's `closeWindow` sends its leave
 * message).
 * `/logchat` in its input saves the room log. No sound.
 */
import { CHAT_SOCIAL_TEXT, lingoEq, parseRoomLine } from "@secondstaronline/shared";

import type { Assets } from "../assets.ts";
import { gameInput } from "./action.ts";
import { artImg, place, type Rect } from "./im.ts";
import type { GameWindow, WindowLayer } from "./window.ts";

export const ROOM_STAGE = { w: 500, h: 300 } as const;
const r = (l: number, t: number, rr: number, b: number): Rect => ({
  x: l,
  y: t,
  w: rr - l,
  h: b - t,
});
export const ROOM_RECTS = {
  art: r(0, -2, 500, 298),
  title: r(13, 10, 481, 34),
  chat: r(12, 34, 387, 243),
  users: r(397, 34, 490, 243),
  input: r(11, 252, 487, 288),
} as const;

export interface RoomActions {
  /** A line typed into the typing field (the server parses `who` and `/msg`). */
  say(text: string): void;
  /** The window closed: leave the room. */
  leave(): void;
  /** `/logchat <file>`: save the room log (the client's download). */
  logchat(file: string, text: string): void;
}

export interface ChatRoomWindow {
  window: GameWindow;
  enter(title: string, entering: string, users: readonly string[]): void;
  line(text: string): void;
  user(name: string, on: boolean): void;
  restore(text: string): void;
  readonly log: string;
  readonly users: readonly string[];
  readonly input: HTMLInputElement;
  setMaxChars(n: number): void;
}

export function createChatRoomWindow(
  a: Assets,
  layer: WindowLayer,
  act: RoomActions,
): ChatRoomWindow {
  const stage = document.createElement("div");
  stage.className = "im-stage room-stage";
  const art = place(artImg(a, "ChatWindow", 1, "im-art"), ROOM_RECTS.art, "im-abs");
  const title = place(document.createElement("div"), ROOM_RECTS.title, "im-abs");
  title.classList.add("room-title");
  const chat = place(document.createElement("div"), ROOM_RECTS.chat, "im-abs");
  chat.classList.add("room-text", "room-chat");
  chat.setAttribute("role", "log");
  const userList = place(document.createElement("div"), ROOM_RECTS.users, "im-abs");
  userList.classList.add("room-text", "room-users");
  userList.setAttribute("aria-label", "In this room");
  const input = place(gameInput("room-chat-input"), ROOM_RECTS.input, "im-abs");
  input.classList.add("room-input");
  input.type = "text";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.maxLength = 200;
  input.enterKeyHint = "send";
  input.setAttribute("aria-label", "Room chat");
  stage.append(art, title, chat, userList, input);

  let log = "";
  let users: string[] = [];
  const draw = () => {
    chat.textContent = log;
    chat.scrollTop = chat.scrollHeight;
    userList.textContent = users.map((u) => `${u}\n`).join("");
  };

  const win = layer.create({
    title: CHAT_SOCIAL_TEXT.roomWindowTitle,
    name: "room",
    width: ROOM_STAGE.w,
    height: ROOM_STAGE.h,
    body: stage,
    onClose: () => act.leave(),
  });

  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key !== "Enter") {
      return;
    }
    e.preventDefault();
    const raw = input.value;
    if (raw === "") {
      return;
    }
    const parsed = parseRoomLine(raw);
    input.value = "";
    if (parsed?.kind === "logchat") {
      act.logchat(parsed.file || "chatlog.txt", log);
      return;
    }
    act.say(raw);
  });

  return {
    window: win,
    input,
    get log() {
      return log;
    },
    get users() {
      return users;
    },
    setMaxChars(n) {
      input.maxLength = n;
    },
    enter(t, entering, list) {
      title.textContent = t;
      users = [...list];
      input.value = "";
      log = `${log}\n${entering}\n\n`;
      draw();
      win.open();
    },
    line(text) {
      log = `${log}${text}\n`;
      draw();
    },
    user(name, on) {
      if (on) {
        users.push(name);
      } else {
        // The 70-line forward loop skips the next line after a deletion.
        for (let x = 1; x <= 70; x++) {
          const u = users[x - 1];
          if (u !== undefined && lingoEq(u, name)) {
            users.splice(x - 1, 1);
          }
        }
      }
      draw();
    },
    restore(text) {
      if (input.value === "") {
        input.value = text;
      }
      win.open();
    },
  };
}
