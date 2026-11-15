/**
 * The mail screen: frame 72's channels 6-17 and 362-368
 * (assets/original/main/layout/frame-72.json), drawn in place on the stage. Origin: the list
 * art, stage (154, 28), 350×350.
 *
 * Three layers, each with the flag 1.6 kept as the sprites' `visible` bit: the list (362-368),
 * the read pane (12-17) and the compose pane (6-11). A layer draws only while its flag is on
 * **and** the mail screen holds frame 72 (from the original's mail sort until the list's CLOSE):
 * the panes exist on frame 72 only (spans [72, 72]), so closing the list takes an open pane with it
 * while its flag stays set, which leaves the Use button dead and brings the pane back at the next
 * open (1.6 did the same). Stacking: compose over read over list.
 */
import { MAIL_TEXT, mailRecipients, replySubject, stripMailTo } from "@secondstaronline/shared";

import type { Assets } from "../assets.ts";
import { type Sfx, SOUND } from "../sfx.ts";
import { action } from "./action.ts";
import { artImg, type Rect } from "./stage.ts";

export const MAIL_ORIGIN = { x: 154, y: 28 } as const;
export const MAIL_SIZE = { w: 350, h: 350 } as const;

const R = (l: number, t: number, r: number, b: number): Rect => ({
  x: l,
  y: t,
  w: r - l,
  h: b - t,
});

/** Stage rects ([l, t, r, b] → x, y, w, h) from frame-72.json; the fields use their member box. */
export const MAIL_RECTS = {
  listArt: R(154, 28, 504, 378),
  fromList: R(169, 59, 240, 330),
  subjectList: R(242, 59, 488, 330),
  composeArt: R(207, 76, 457, 302),
  send: R(394, 270, 436, 287),
  composeClose: R(334, 272, 378, 286),
  to: R(266, 91, 442, 105),
  subject: R(266, 114, 440, 127),
  body: R(223, 138, 439, 257),
  readArt: R(207, 76, 457, 302),
  readClose: R(334, 272, 378, 286),
  reply: R(389, 270, 437, 287),
  readTo: R(266, 91, 440, 104),
  readSubject: R(266, 115, 440, 128),
  /** The member box 214×119, not the stored 16-px rect: the sprite is not stretched. */
  readBody: R(225, 140, 439, 259),
  /** The chat blocker, Internal #203 stretched over the chat entry (channel 366, locZ 9366). */
  blocker: R(17, 554, 783, 576),
  /** The list's four hotspots on sprite 362 (exclusive bounds, so x 277-325 is `276 < x < 326`). */
  close: R(277, 342, 326, 370),
  del: R(330, 339, 386, 368),
  write: R(390, 344, 441, 363),
  read: R(444, 339, 493, 368),
} as const;

export interface MailActions {
  /** The screen's own buttons, for the server's key-lock mirror. */
  ui(act: "close" | "reply" | "composeClose"): void;
  /** SEND after its local tests pass. */
  send(to: string, subject: string, body: string): void;
  /** DELETE: the removed message's id. */
  del(id: number): void;
  /** A line in the chat log. */
  say(text: string): void;
  /** The key lock. */
  lock(on: boolean): void;
  /** The mail sort's move to frame 71 (→ 72) and the list CLOSE's move to frame 55. */
  frame(on: boolean): void;
  /** The blocker over the chat entry. */
  blocker(on: boolean): void;
  sound(s: Sfx): void;
}

export interface MailMessage {
  id: number;
  from: string;
  subject: string;
  body: string;
}

export interface MailScreen {
  el: HTMLElement;
  /** Whether the mail list is open. */
  readonly listUp: boolean;
  /** The compose pane's flag, set whether or not it can be seen. */
  readonly composeUp: boolean;
  /** The list, the 362-368 flags on, the screen on frame 72. */
  show(messages: readonly MailMessage[]): void;
  /** The send went through. */
  sent(): void;
  /** Game entry: every flag off, everything hidden. */
  reset(): void;
}

const semantic = (label: string) =>
  `mail-${label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}`;

export function createMailScreen(a: Assets, act: MailActions): MailScreen {
  const el = document.createElement("div");
  el.className = "mail-screen";
  el.hidden = true;
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", "Mailbox");

  const layer = (cls: string, z: number) => {
    const d = document.createElement("div");
    d.className = `mail-layer ${cls}`;
    d.style.zIndex = String(z);
    el.append(d);
    return d;
  };
  const put = <T extends HTMLElement>(parent: HTMLElement, node: T, r: Rect, z: number): T => {
    node.style.left = `${r.x - MAIL_ORIGIN.x}px`;
    node.style.top = `${r.y - MAIL_ORIGIN.y}px`;
    node.style.width = `${r.w}px`;
    node.style.height = `${r.h}px`;
    node.style.zIndex = String(z);
    parent.append(node);
    return node;
  };
  const art = (parent: HTMLElement, member: number, r: Rect, z: number) => {
    const img = put(parent, artImg(a.ui("mail", member)), r, z);
    img.classList.add("mail-art");
    return img;
  };
  const button = (
    parent: HTMLElement,
    member: number,
    origin: string,
    label: string,
    r: Rect,
    z: number,
    on: () => void,
  ) => {
    const b = put(parent, action(document.createElement("button"), origin), r, z);
    b.type = "button";
    b.className = "hit mail-button";
    b.setAttribute("aria-label", label);
    if (member > 0) {
      b.append(artImg(a.ui("mail", member), label));
    }
    b.addEventListener("click", on);
    return b;
  };
  const field = (parent: HTMLElement, cls: string, r: Rect, z: number) => {
    const f = put(parent, document.createElement("div"), r, z);
    f.className = `mail-field ${cls}`;
    return f;
  };

  // ---- the list (362-368), locZ 9000+ --------------------------------------------------------
  const listLayer = layer("mail-list", 9000);
  art(listLayer, 2, MAIL_RECTS.listArt, 1);
  const fromBox = put(
    listLayer,
    action(document.createElement("div"), "mail-select-from"),
    MAIL_RECTS.fromList,
    4,
  );
  fromBox.className = "mail-field mail-lines mail-from";
  fromBox.setAttribute("role", "listbox");
  fromBox.setAttribute("aria-label", "Mail from");
  const subjectBox = put(
    listLayer,
    action(document.createElement("div"), "mail-select-subject"),
    MAIL_RECTS.subjectList,
    3,
  );
  subjectBox.className = "mail-field mail-lines mail-subject";
  subjectBox.setAttribute("role", "listbox");
  subjectBox.setAttribute("aria-label", "Mail subject");
  // The list's four hotspots: transparent buttons over the list art, exclusive bounds.
  const hot = (r: Rect, label: string, on: () => void) =>
    button(listLayer, 0, semantic(label), label, r, 2, on);

  // ---- the read pane (12-17), locZ 9700+ -----------------------------------------------------
  const readLayer = layer("mail-read", 9700);
  art(readLayer, 1, MAIL_RECTS.readArt, 1);
  const readTo = field(readLayer, "mail-read-to", MAIL_RECTS.readTo, 4);
  const readSubject = field(readLayer, "mail-read-subject", MAIL_RECTS.readSubject, 5);
  const readBody = field(readLayer, "mail-read-body", MAIL_RECTS.readBody, 6);
  button(readLayer, 17, semantic("Close"), "Close", MAIL_RECTS.readClose, 2, () => closePane());
  button(readLayer, 13, semantic("Reply"), "Reply", MAIL_RECTS.reply, 3, () => reply());

  // ---- the compose pane (6-11), locZ 9800+ ---------------------------------------------------
  const composeLayer = layer("mail-compose", 9800);
  art(composeLayer, 3, MAIL_RECTS.composeArt, 1);
  button(composeLayer, 16, semantic("Send"), "Send", MAIL_RECTS.send, 2, () => send());
  button(composeLayer, 17, semantic("Close"), "Close", MAIL_RECTS.composeClose, 3, () =>
    closePane(),
  );
  const input = (name: string, _member: number, r: Rect, z: number, label: string) => {
    const i = put(composeLayer, action(document.createElement("input"), `mail-${name}`), r, z);
    i.className = `mail-input ${name}`;
    i.type = "text";
    i.spellcheck = false;
    i.setAttribute("aria-label", label);
    // A `limit` box: typing stops when the box is full.
    let fit = "";
    i.addEventListener("input", () => {
      if (i.scrollWidth > i.clientWidth && i.clientWidth > 0) {
        i.value = fit;
      }
      fit = i.value;
    });
    return i;
  };
  const toIn = input("mail-to", 18, MAIL_RECTS.to, 4, "To");
  const subjectIn = input("mail-subj", 19, MAIL_RECTS.subject, 5, "Subject");
  const bodyIn = put(
    composeLayer,
    action(document.createElement("textarea"), "mail-body"),
    MAIL_RECTS.body,
    6,
  );
  bodyIn.className = "mail-input mail-body";
  bodyIn.spellcheck = false;
  bodyIn.setAttribute("aria-label", "Message");
  let bodyFit = "";
  bodyIn.addEventListener("input", () => {
    if (bodyIn.scrollHeight > bodyIn.clientHeight && bodyIn.clientHeight > 0) {
      bodyIn.value = bodyFit;
    }
    bodyFit = bodyIn.value;
  });

  // ---- state ---------------------------------------------------------------------------------
  let listFlag = false;
  let readFlag = false;
  let composeFlag = false;
  /** The screen holds frame 72 (from the original's mail sort until the list's CLOSE). */
  let framed = false;
  /** The cached list. */
  let messages: MailMessage[] = [];
  /** The number of the selected message. */
  let mailNum = 0;
  /** The highlighted line (the highlight survives an empty click). */
  let hilite = 0;
  let sendingFirst = false;

  const draw = () => {
    el.hidden = !framed;
    listLayer.hidden = !(framed && listFlag);
    readLayer.hidden = !(framed && readFlag);
    composeLayer.hidden = !(framed && composeFlag);
  };
  const lines = (box: HTMLElement, rows: readonly string[]) => {
    box.replaceChildren(
      ...rows.map((t, i) => {
        const row = document.createElement("div");
        row.className = "mail-row";
        row.setAttribute("role", "option");
        row.textContent = t;
        row.classList.toggle("on", i + 1 === hilite);
        return row;
      }),
    );
  };
  /** Both columns rebuilt from the cache; replacing the text drops the highlight. */
  const rebuild = () => {
    hilite = 0;
    lines(
      fromBox,
      messages.map((m) => m.from),
    );
    lines(
      subjectBox,
      messages.map((m) => m.subject),
    );
  };
  const rowIndex = (box: HTMLElement, e: Event) => {
    const row = (e.target as HTMLElement).closest(".mail-row");
    return row ? [...box.children].indexOf(row) + 1 : 0;
  };
  /** The From and Subject lists (members 11, 12): the click sound, then the line under it. */
  const select = (box: HTMLElement) => (e: Event) => {
    act.sound(SOUND.click);
    const n = rowIndex(box, e);
    mailNum = n;
    if (n > 0) {
      hilite = n;
    }
    const mark = (b: HTMLElement) =>
      [...b.children].forEach((r, i) => {
        r.classList.toggle("on", i + 1 === hilite);
      });
    mark(fromBox);
    mark(subjectBox);
  };
  fromBox.addEventListener("click", select(fromBox));
  subjectBox.addEventListener("click", select(subjectBox));

  // CLOSE unlocks, takes the list down and leaves frame 72. An open pane's flag stays.
  hot(MAIL_RECTS.close, "Close mailbox", () => {
    act.lock(false);
    listFlag = false;
    framed = false;
    act.blocker(false);
    act.frame(false);
    draw();
    act.ui("close");
  });
  // Delete: delete the selected message, rebuild, upload. The selection and the read pane stay.
  hot(MAIL_RECTS.del, "Delete message", () => {
    if (mailNum < 1) {
      return;
    }
    const gone = messages.splice(mailNum - 1, 1)[0];
    rebuild();
    if (gone) {
      act.del(gone.id);
    }
  });
  // The compose pane, the old draft kept, no lock.
  hot(MAIL_RECTS.write, "Write message", () => {
    composeFlag = true;
    draw();
  });
  // Read: the raw selected message into the read pane.
  hot(MAIL_RECTS.read, "Read message", () => {
    const m = mailNum < 1 ? undefined : messages[mailNum - 1];
    if (!m) {
      return;
    }
    readTo.textContent = m.from;
    readSubject.textContent = m.subject;
    readBody.textContent = m.body;
    readFlag = true;
    draw();
  });

  // REPLY locks, answers the sender under "Re: ", and shows the compose pane.
  const reply = () => {
    act.lock(true);
    toIn.value = readTo.textContent ?? "";
    bodyIn.value = "";
    bodyFit = "";
    subjectIn.value = replySubject(readSubject.textContent ?? "");
    composeFlag = true;
    draw();
    act.ui("reply");
  };
  // Either pane's CLOSE unlocks and hides 6-17; the list stays up.
  const closePane = () => {
    act.lock(false);
    composeFlag = false;
    readFlag = false;
    draw();
    act.ui("composeClose");
  };
  // An empty body, or no filled recipient, does nothing; the rest waits for the server.
  const send = () => {
    if (bodyIn.value === "") {
      return;
    }
    const { names, firstFilled } = mailRecipients(stripMailTo(toIn.value));
    if (names.length === 0) {
      return;
    }
    sendingFirst = firstFilled;
    act.send(toIn.value, subjectIn.value, bodyIn.value);
  };

  draw();
  return {
    el,
    get listUp() {
      return listFlag;
    },
    get composeUp() {
      return composeFlag;
    },
    show(list) {
      messages = list.map((m) => ({ ...m }));
      rebuild();
      listFlag = true;
      framed = true;
      act.blocker(true);
      act.frame(true);
      draw();
    },
    sent() {
      if (sendingFirst) {
        act.say(MAIL_TEXT.sending);
      }
      sendingFirst = false;
      act.lock(false);
      composeFlag = false;
      toIn.value = "";
      subjectIn.value = "";
      bodyIn.value = "";
      bodyFit = "";
      draw();
    },
    reset() {
      const wasFramed = framed;
      listFlag = false;
      readFlag = false;
      composeFlag = false;
      framed = false;
      mailNum = 0;
      hilite = 0;
      messages = [];
      sendingFirst = false;
      act.blocker(false);
      if (wasFramed) {
        act.frame(false);
      }
      draw();
    },
  };
}
