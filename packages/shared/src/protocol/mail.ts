/** Mail, message boards, paintings, photos and newspapers. */
import { z } from "zod";

/**
 * The mail screen's own buttons: the list's CLOSE (keys unlocked), REPLY and the compose or read
 * pane's CLOSE (keys stay locked while the list is up). The server mirrors the key lock from these.
 */
export const mailUiSchema = z.strictObject({
  t: z.literal("mailUi"),
  act: z.enum(["close", "reply", "composeClose"]),
});

/**
 * SEND: the fields as typed. The server strips To, splits it, stamps the sender and cuts the body;
 * the bounds here are the schema's.
 */
export const mailSendSchema = z.strictObject({
  t: z.literal("mailSend"),
  to: z.string().max(500),
  subject: z.string().max(200),
  body: z.string().max(4000),
});

/** DELETE: the selected message's id. */
export const mailDeleteSchema = z.strictObject({
  t: z.literal("mailDelete"),
  id: z.number().int(),
});

/** The board window's Post: the post's text field. */
export const boardPostSchema = z.strictObject({
  t: z.literal("boardPost"),
  text: z.string().max(4000),
});

/** The board window's Close. */
export const boardCloseSchema = z.strictObject({ t: z.literal("boardClose") });

/** The paint screen's Cancel: unlocks; the picture and the Canvas are kept. */
export const paintUiSchema = z.strictObject({ t: z.literal("paintUi"), act: z.literal("cancel") });

/** The viewer's close, any mouseUp on the page. */
export const viewCloseSchema = z.strictObject({ t: z.literal("viewClose") });

/**
 * The painting or photo save: the finished 64×64 PNG as base64. The server checks the credit, the
 * bag and the PNG.
 */
export const artSaveSchema = z.strictObject({
  t: z.literal("artSave"),
  kind: z.enum(["painting", "photo"]),
  png: z.string().max(22_000),
});

/** The newspaper editor's load: the player's own paper. */
export const newspaperLoadSchema = z.strictObject({ t: z.literal("newspaperLoad") });

/** SAVE PAPER: the three photo ids and the six texts. */
export const newspaperSaveSchema = z.strictObject({
  t: z.literal("newspaperSave"),
  photos: z.array(z.string().max(20)).length(3),
  texts: z.tuple([
    z.string().max(500),
    z.string().max(500),
    z.string().max(4000),
    z.string().max(500),
    z.string().max(500),
    z.string().max(500),
  ]),
});

export type MailServerMsg =
  /**
   * The mailbox list, oldest first. `lock` is true for an open from the box (keys locked)
   * and false for a reload of the mail list.
   */
  | {
      t: "mail";
      messages: { id: number; from: string; subject: string; body: string }[];
      lock: boolean;
    }
  /** The send went through: SEND's close. */
  | { t: "mailSent" }
  /** The message board: its topic and text (reloaded after a post), or null to close it. */
  | { t: "board"; board: { topic: string; text: string; lock: boolean } | null }
  /** Using a canvas: the paint screen opens; `reopen` keeps a cancelled picture. */
  | { t: "paint"; reopen: boolean }
  /** Use Film: the camera lens appears and follows the mouse. */
  | { t: "lens" }
  /** The paint screen's OK: the save went through ("...Saved!", the screen closes). */
  | { t: "artSaved"; kind: "painting" | "photo" }
  /** A painting's view: the author and the PNG (null: none stored). */
  | { t: "art"; author: string; png: string | null }
  /** A newspaper and its three photos: the six texts and each photo's PNG or null. */
  | { t: "newspaper"; texts: string[]; photos: (string | null)[] }
  /** The newspaper editor's three photo ids and six texts (blank with no paper). */
  | { t: "newspaperEdit"; photos: string[]; texts: string[] };
