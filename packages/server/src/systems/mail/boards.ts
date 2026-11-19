/**
 * Message boards on the server.
 *
 * Posts are append-only rows read at the moment; the server opens only the board that was clicked,
 * from the tile in front of it, and a post goes to the board that is open. A map change closes it.
 * (1.6 let any client overwrite a board, or read and write any board by name from anywhere.)
 */
import {
  BOARD_TEXT,
  boardKind,
  boardMember,
  boardText,
  CHAT_COLOR,
  chatRefusal,
  postHasText,
  standingInFront,
} from "@secondstaronline/shared";

import type { GroundItem, Outgoing, Player } from "../world/world.ts";

export interface BoardStore {
  load(board: string): { author: string; body: string }[];
  /** Appends a post and drops the oldest past `cap`; the caller supplies the time. */
  add(board: string, author: string, body: string, cap: number): void;
}

export interface BoardDeps {
  /** Setting `chatCooldown`, in frames. */
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

const boardMsg = (p: Player, name: string, store: BoardStore): Outgoing => ({
  to: p.id,
  msg: { t: "board", board: { topic: name, text: boardText(store.load(name)), lock: true } },
});

/**
 * Opens a board by click (`via` "click") or Ctrl ("ctrl", whose 40-frame pause the caller set).
 * A hall's board click sets the 40-frame pause first; Town Square's sets none. Either way you must
 * stand still in front of the board, facing it ("You see the message board, but…"), and a hall's
 * board opens only for a member of its guild. Then the keys lock and "You view the message board"
 * shows with the board. (1.6 opened Town Square's board from any distance, and a hall's for anyone
 * standing in rows 1-7 of any map, without locking the keys.)
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
  if (kind === "guild" && via === "click") {
    p.itemPause = CLICK_PAUSE;
  }
  const inFront = standingInFront({
    facing: p.facing,
    stepFrames: p.stepFrames,
    player: { x: p.x, y: p.y },
    item: { x: board.x, y: board.y },
  });
  if (!inFront) {
    return [chat(p, BOARD_TEXT.notInFront)];
  }
  if (kind === "guild" && !boardMember(board.item, p.guild)) {
    return [chat(p, BOARD_TEXT.notMember)];
  }
  const name = kind === "town" ? BOARD_TEXT.townSquare : board.item;
  p.keyLock = true;
  p.board = name;
  return [chat(p, BOARD_TEXT.view), boardMsg(p, name, store)];
}

/**
 * Post: no letter or digit gets the alert; the chat wait refuses (the board stays open with its
 * text, the keys still locked); otherwise the post is cut and appended to the open board, which
 * reloads with the post on it. (1.6 cleared the lock before the test and closed the window
 * without a reload.)
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
  if (!postHasText(text)) {
    return [{ to: p.id, msg: { t: "alert", text: BOARD_TEXT.empty } }];
  }
  const refused = chatRefusal(p.chatIn);
  if (refused) {
    return [chat(p, refused)];
  }
  p.chatIn = deps.chatCooldownFrames;
  store.add(board, p.name, text.slice(0, deps.boardPostMax), deps.boardPostsMax);
  return [boardMsg(p, board, store)];
}

/** Close: the input lock is cleared. */
export function boardCloseIntent(p: Player): void {
  p.keyLock = false;
  p.board = null;
}
