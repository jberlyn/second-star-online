/**
 * Message boards on the server.
 *
 * Posts are append-only rows read at the moment; the server opens only the board that was clicked
 * and a post goes to the board last opened. (1.6 let any client overwrite a board, or read and
 * write any board by name from anywhere.)
 */
import {
  BOARD_MAX_Y,
  BOARD_TEXT,
  boardKind,
  boardText,
  CHAT_COLOR,
  chatRefusal,
  postHasText,
} from "@secondstaronline/shared";

import type { GroundItem, Outgoing, Player } from "../world/world.ts";

export interface BoardStore {
  load(board: string): { author: string; body: string }[];
  /** Appends a post and drops the oldest past `cap`; the caller supplies the time. */
  add(board: string, author: string, body: string, cap: number): void;
}

export interface BoardDeps {
  /** Setting `chatCooldownFrames`. */
  chatCooldownFrames: number;
  /** Setting `boardPostsMax`. */
  boardPostsMax: number;
  /** Setting `boardPostMax`. */
  boardPostMax: number;
}

/** The click's item-action pause, set for every name past `Message Boards`. */
const CLICK_PAUSE = 40;

const chat = (to: Player, text: string): Outgoing => ({
  to: to.id,
  msg: { t: "chat", text, color: CHAT_COLOR.normal },
});

/**
 * Opens a board by click (`via` "click") or Ctrl ("ctrl", whose 40-frame pause the caller set).
 * Town Square: no distance test, the input lock is set, and the click sets no pause (it runs
 * before). A hall's board: the click's pause, then your own tile's y > 7 on any map is "You have to
 * enter the building to view this board." (no membership test; no lock). Then "You view the message
 * board" and the board.
 */
export function boardOpen(
  p: Player,
  board: GroundItem,
  via: "click" | "ctrl",
  store: BoardStore,
): Outgoing[] {
  const kind = boardKind(board.item);
  if (!kind) {
    return [];
  }
  let name: string;
  let lock: boolean;
  if (kind === "town") {
    name = BOARD_TEXT.townSquare;
    lock = true;
    p.keyLock = true;
  } else {
    if (via === "click") {
      p.itemPause = CLICK_PAUSE;
    }
    if (p.y > BOARD_MAX_Y) {
      return [chat(p, BOARD_TEXT.enterBuilding)];
    }
    name = board.item;
    lock = false;
  }
  p.board = name;
  return [
    chat(p, BOARD_TEXT.view),
    {
      to: p.id,
      msg: { t: "board", board: { topic: name, text: boardText(store.load(name)), lock } },
    },
  ];
}

/**
 * Post: the input lock is cleared first (so a refused post leaves the board open and unlocked); no
 * letter or digit gets the alert; the chat wait refuses (the board stays open with its text);
 * otherwise the post is cut, appended to the board last opened, and the window closes without
 * reloading or saying anything.
 */
export function boardPostIntent(
  p: Player,
  text: string,
  store: BoardStore,
  deps: BoardDeps,
): Outgoing[] {
  const board = p.board;
  if (board === null) {
    return [];
  }
  p.keyLock = false;
  if (!postHasText(text)) {
    return [{ to: p.id, msg: { t: "alert", text: BOARD_TEXT.empty } }];
  }
  const refused = chatRefusal(p.chatIn);
  if (refused) {
    return [chat(p, refused)];
  }
  p.chatIn = deps.chatCooldownFrames;
  store.add(board, p.name, text.slice(0, deps.boardPostMax), deps.boardPostsMax);
  p.board = null;
  return [{ to: p.id, msg: { t: "board", board: null } }];
}

/** Close: the input lock is cleared. */
export function boardCloseIntent(p: Player): void {
  p.keyLock = false;
  p.board = null;
}
