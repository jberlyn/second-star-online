/** Chat lines, IMs, away, chat rooms and the Who list. */
import { z } from "zod";

/**
 * Upper bound on a typed chat line. Not a game rule: the server cuts lines to the operator's
 * `chatMaxChars` (default 200). A single-line input never holds a line break.
 */
export const CHAT_INPUT_MAX = 500;

/** One typed chat line, raw: the server parses commands. */
export const chatSchema = z.strictObject({
  t: z.literal("chat"),
  text: z
    .string()
    .min(1)
    .max(CHAT_INPUT_MAX)
    .refine((s) => !/[\r\n]/.test(s), "one line"),
});

/** A multi-line window field (IMsend, IM windows, Away): bounded, not a game rule. */
const windowText = z.string().max(CHAT_INPUT_MAX);

/**
 * An IM from the IMsend window's Send (`via` "send") or an IM window's reply (
 * `via` "window"). `to` is the `To` field or the window's sender. The server strips line breaks as 1.6
 * did.
 */
export const imSchema = z.strictObject({
  t: z.literal("im"),
  to: z.string().max(200),
  text: windowText,
  via: z.enum(["send", "window"]),
});

/** The Away window's Away (the field's text) or Back (null). */
export const awaySchema = z.strictObject({ t: z.literal("away"), text: windowText.nullable() });

/** Menu 500's General, New Player, Trading Post and Guild Chat, menu 502's Admin Chat (CHR). */
export const roomEnterSchema = z.strictObject({
  t: z.literal("roomEnter"),
  room: z.enum(["general", "newPlayer", "tradingPost", "guild", "admin"]),
});

/** Closing the ChatWindow (`closeWindow`, which leaves the room). */
export const roomLeaveSchema = z.strictObject({ t: z.literal("roomLeave") });

/** A line typed into the room's typing field: the server parses `who` and `/msg`. */
export const roomSaySchema = z.strictObject({
  t: z.literal("roomSay"),
  text: z.string().min(1).max(CHAT_INPUT_MAX),
});

/**
 * Where a refused line goes back: the main chat input when absent, the room's input, an IM window's
 * reply field (by its sender) or the IMsend window, reopened.
 */
export type RestoreTarget =
  | { kind: "room" }
  | { kind: "im"; to: string }
  | { kind: "imSend"; to: string };

export type ChatServerMsg =
  /**
   * One chat line in a palette colour (shared/rules/chat/chat.ts `PALETTE_RGB`). `restore` puts a
   * refused line back in the chat input.
   */
  | { t: "chat"; text: string; color: number; restore?: string; restoreTo?: RestoreTarget }
  /** The `who` reply: names in logon order; the client opens the Who window. */
  | { t: "who"; names: string[] }
  /** Logon (`on`) or logoff, sent to everyone. Prints nothing. */
  | { t: "presence"; on: boolean; name: string }
  /**
   * A refused line goes back in the chat input with no chat line (e.g. an IM or room error).
   */
  | { t: "restore"; text: string; restoreTo?: RestoreTarget }
  /**
   * An IM arrives (the original's IM sorter): the client picks its window. `away`: you are away, so
   * it goes to the Away window's `Messages` log and no window opens.
   */
  | { t: "im"; from: string; text: string; away: boolean }
  /** Your reply from an IM window, echoed into the window holding `to`. */
  | { t: "imEcho"; to: string; text: string }
  /**
   * You entered a room: the ChatWindow opens with this title field and entry line (added after the
   * old text) and the roster snapshot, you included.
   */
  | { t: "room"; title: string; entering: string; users: string[] }
  /** A room line (`cMsgX` → `xSendSomeChatYo`), `<sender>: <text>`. */
  | { t: "roomLine"; text: string }
  /** Someone entered (`listMex`) or left (`unListMex`) your room. */
  | { t: "roomUser"; name: string; on: boolean };
