/**
 * Client: the mail screen (frame 72's channels 6-17 and 362-368) and the message board. Rects are
 * checked against the shipped layout data's frame-72.json.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { AssetIndex } from "@secondstaronline/data";

import type { Assets } from "../src/assets.ts";
import { type Sfx, SOUND } from "../src/sfx.ts";
import { BOARD_RECTS, createBoardWindow } from "../src/ui/board.ts";
import { createMailScreen, MAIL_RECTS, type MailMessage } from "../src/ui/mail.ts";

const fakeAssets: Assets = {
  index: { version: 1, inputHash: "", atlases: {} as AssetIndex["atlases"], ui: {}, sounds: {} },
  sheets: {},
  loadGroup: async () => {},
  sprite: () => undefined,
  ui: (cast, member) => `/assets/ui/${cast.toLowerCase()}-${member}.png`,
  hash: null,
  reload: async () => [],
  onReload: () => {},
};

const MSGS: MailMessage[] = [
  { id: 11, from: "Bob", subject: "Hello", body: "First body" },
  { id: 12, from: "Carol", subject: "Re: Hi", body: "Second body" },
  { id: 13, from: "Dave", subject: "Third", body: "Third body" },
];

function mailScreen() {
  const log: unknown[] = [];
  const sounds: Sfx[] = [];
  const state = { locked: false, framed: false };
  const m = createMailScreen(fakeAssets, {
    ui: (act) => log.push(["ui", act]),
    send: (to, subject, body) => log.push(["send", to, subject, body]),
    del: (id) => log.push(["del", id]),
    say: (t) => log.push(["say", t]),
    lock: (on) => {
      state.locked = on;
    },
    frame: (on) => {
      state.framed = on;
    },
    sound: (s) => sounds.push(s),
  });
  document.body.replaceChildren(m.el);
  const btn = (label: string, layer = ".mail-list") =>
    m.el.querySelector<HTMLButtonElement>(`${layer} [aria-label="${label}"]`) as HTMLButtonElement;
  const rows = (cls: string) => [...m.el.querySelectorAll<HTMLElement>(`${cls} .mail-row`)];
  const input = (label: string) =>
    m.el.querySelector<HTMLInputElement>(`[aria-label="${label}"]`) as HTMLInputElement;
  return { m, log, sounds, state, btn, rows, input };
}

const FRAME = JSON.parse(
  readFileSync(join(import.meta.dir, "../../../assets/original/main/layout/frame-72.json"), "utf8"),
) as { sprites: { channel: number; rect: number[] }[] };
const rectOf = (ch: number) => FRAME.sprites.find((s) => s.channel === ch)?.rect;
const asRect = (r: { x: number; y: number; w: number; h: number }) => [
  r.x,
  r.y,
  r.x + r.w,
  r.y + r.h,
];

describe("placement", () => {
  test("every mail bitmap and field sits at its sprite's rect", () => {
    const pairs: [keyof typeof MAIL_RECTS, number][] = [
      ["composeArt", 6],
      ["send", 7],
      ["composeClose", 8],
      ["to", 9],
      ["subject", 10],
      ["body", 11],
      ["readArt", 12],
      ["readClose", 13],
      ["reply", 14],
      ["readTo", 15],
      ["readSubject", 16],
      ["listArt", 362],
      ["subjectList", 364],
      ["fromList", 368],
    ];
    for (const [key, ch] of pairs) {
      expect({ key, rect: asRect(MAIL_RECTS[key]) }).toEqual({ key, rect: rectOf(ch) as number[] });
    }
  });
  test("divergence: the 271-px list columns scroll, the From column following the Subject bar", () => {
    const { m } = mailScreen();
    const from = m.el.querySelector(".mail-from") as HTMLElement;
    const subject = m.el.querySelector(".mail-subject") as HTMLElement;
    for (const box of [from, subject]) {
      expect(box.style.height).toBe("271px");
    }
    const css = readFileSync(join(import.meta.dir, "../src/styles.css"), "utf8");
    expect(css).toMatch(/\.mail-screen \.mail-lines \{[^}]*overflow-y: auto;/);
    expect(css).toMatch(/\.mail-screen \.mail-from \{\s*scrollbar-width: none;/);
    m.show(
      Array.from({ length: 50 }, (_, i) => ({ id: i + 1, from: `P${i}`, subject: "s", body: "b" })),
    );
    subject.scrollTop = 120;
    subject.dispatchEvent(new Event("scroll"));
    expect(from.scrollTop).toBe(120);
    from.scrollTop = 40;
    from.dispatchEvent(new Event("scroll"));
    expect(subject.scrollTop).toBe(40);
  });
  test("a layer's empty area passes clicks through, so an open pane never covers the list's buttons", () => {
    const css = readFileSync(join(import.meta.dir, "../src/styles.css"), "utf8");
    expect(css).toMatch(/\.mail-screen > \.mail-layer \{\s*pointer-events: none;/);
    expect(css).toMatch(/\.mail-screen \.mail-layer > \* \{\s*pointer-events: auto;/);
  });
  test("ReadBody is its 214×119 member box, not the stored 16-px rect", () => {
    expect(MAIL_RECTS.readBody).toEqual({ x: 225, y: 140, w: 214, h: 119 });
    expect(rectOf(17)?.[3]).toBe(156);
  });
});

describe("the list", () => {
  test("opens with both columns; the click sound plays on every line, selecting in both", () => {
    const { m, rows, sounds } = mailScreen();
    m.show(MSGS);
    expect(m.el.hidden).toBe(false);
    expect(rows(".mail-from").map((r) => r.textContent)).toEqual(["Bob", "Carol", "Dave"]);
    expect(rows(".mail-subject").map((r) => r.textContent)).toEqual(["Hello", "Re: Hi", "Third"]);
    rows(".mail-from")[1]?.click();
    expect(sounds).toEqual([SOUND.click]);
    expect(rows(".mail-from")[1]?.classList.contains("on")).toBe(true);
    expect(rows(".mail-subject")[1]?.classList.contains("on")).toBe(true);
  });

  test("READ with nothing selected does nothing; with a line it fills the read pane", () => {
    const { m, btn, rows } = mailScreen();
    m.show(MSGS);
    btn("Read message").click();
    expect(m.el.querySelector<HTMLElement>(".mail-read")?.hidden).toBe(true);
    rows(".mail-from")[0]?.click();
    btn("Read message").click();
    const read = m.el.querySelector<HTMLElement>(".mail-read") as HTMLElement;
    expect(read.hidden).toBe(false);
    // divergence: the sender sits under FROM:, which covers the compose art's TO:.
    expect(read.querySelector(".mail-read-label")?.textContent).toBe("FROM:");
    expect(MAIL_RECTS.readFromLabel).toEqual({ x: 221, y: 92, w: 38, h: 9 });
    expect(read.querySelector(".mail-read-to")?.textContent).toBe("Bob");
    expect(read.querySelector(".mail-read-subject")?.textContent).toBe("Hello");
    expect(read.querySelector(".mail-read-body")?.textContent).toBe("First body");
  });

  test("divergence: DELETE clears the selection and closes the read pane showing that message", () => {
    const { m, btn, rows, log } = mailScreen();
    m.show(MSGS);
    rows(".mail-from")[0]?.click();
    btn("Read message").click();
    btn("Delete message").click();
    btn("Delete message").click();
    expect(log).toEqual([["del", 11]]);
    expect(rows(".mail-from").map((r) => r.textContent)).toEqual(["Carol", "Dave"]);
    expect(m.el.querySelector<HTMLElement>(".mail-read")?.hidden).toBe(true);
    // Deleting another message leaves an open read pane alone.
    rows(".mail-from")[0]?.click();
    btn("Read message").click();
    rows(".mail-from")[1]?.click();
    btn("Delete message").click();
    expect(log).toEqual([
      ["del", 11],
      ["del", 13],
    ]);
    expect(m.el.querySelector<HTMLElement>(".mail-read")?.hidden).toBe(false);
    expect(m.el.querySelector(".mail-read-to")?.textContent).toBe("Carol");
  });

  test("a click below the last line selects no mail, so READ does nothing", () => {
    const { m, btn, rows } = mailScreen();
    m.show(MSGS);
    rows(".mail-from")[0]?.click();
    (m.el.querySelector(".mail-from") as HTMLElement).click();
    btn("Read message").click();
    expect(m.el.querySelector<HTMLElement>(".mail-read")?.hidden).toBe(true);
  });

  test("divergence: with every pane up, nothing in the mail screen reaches the chat entry", () => {
    const { m, btn } = mailScreen();
    m.show(MSGS);
    btn("Write message").click();
    const px = (v: string) => Number.parseFloat(v || "0");
    // Every placed piece, on the stage: the screen's origin plus its own box.
    const boxes = [...m.el.querySelectorAll<HTMLElement>("*")]
      .filter((e) => e.style.top !== "")
      .map((e) => ({
        bottom: 28 + px(e.style.top) + px(e.style.height),
        right: 154 + px(e.style.left) + px(e.style.width),
      }));
    expect(boxes.length).toBeGreaterThan(0);
    // The chat entry is the stage's (21, 556) 760×20 box: nothing reaches down to it.
    expect(boxes.filter((b) => b.bottom > 556)).toEqual([]);
    expect(Math.max(...boxes.map((b) => b.bottom))).toBeLessThanOrEqual(28 + 350);
  });

  test("CLOSE unlocks, leaves frame 72 and tells the server", () => {
    const { m, btn, state, log } = mailScreen();
    m.show(MSGS);
    expect(state).toMatchObject({ framed: true });
    state.locked = true;
    btn("Close mailbox").click();
    expect(state).toEqual({ locked: false, framed: false });
    expect(m.el.hidden).toBe(true);
    expect(m.listUp).toBe(false);
    expect(log).toContainEqual(["ui", "close"]);
  });

  test("a reload keeps the open panes and the screen", () => {
    const { m, btn } = mailScreen();
    m.show(MSGS);
    btn("Write message").click();
    m.show(MSGS.slice(0, 2));
    expect(m.composeUp).toBe(true);
    expect(m.el.querySelector<HTMLElement>(".mail-compose")?.hidden).toBe(false);
  });
});

describe("compose, reply and send", () => {
  test("bug fixed: REPLY locks, answers the sender and adds Re: only once", () => {
    const { m, btn, rows, input, state, log } = mailScreen();
    m.show(MSGS);
    rows(".mail-from")[1]?.click();
    btn("Read message").click();
    btn("Reply", ".mail-read").click();
    expect(state.locked).toBe(true);
    expect(input("To").value).toBe("Carol");
    expect(input("Subject").value).toBe("Re: Hi");
    expect((m.el.querySelector(".mail-body") as HTMLTextAreaElement).value).toBe("");
    expect(m.composeUp).toBe(true);
    expect(log).toContainEqual(["ui", "reply"]);
  });

  test("bug fixed: either pane's CLOSE hides both panes; the list and the lock stay up", () => {
    const { m, btn, rows, state, log } = mailScreen();
    m.show(MSGS);
    rows(".mail-from")[0]?.click();
    btn("Read message").click();
    btn("Reply", ".mail-read").click();
    btn("Close", ".mail-compose").click();
    expect(state.locked).toBe(true);
    expect(m.composeUp).toBe(false);
    expect(m.listUp).toBe(true);
    expect(m.el.querySelector<HTMLElement>(".mail-read")?.hidden).toBe(true);
    expect(log).toContainEqual(["ui", "composeClose"]);
    btn("Write message").click();
    btn("Close", ".mail-compose").click();
    expect(log.filter((l) => (l as unknown[])[1] === "composeClose")).toHaveLength(2);
  });

  test("bug fixed: SEND waits for mailSent; then the line, cleared and hidden, still locked", () => {
    const { m, btn, input, state, log } = mailScreen();
    m.show(MSGS);
    btn("Write message").click();
    input("To").value = "Bob, Al";
    input("Subject").value = "Hi";
    const body = m.el.querySelector(".mail-body") as HTMLTextAreaElement;
    body.value = "Hello";
    state.locked = true;
    btn("Send", ".mail-compose").click();
    expect(log).toEqual([["send", "Bob, Al", "Hi", "Hello"]]);
    // Nothing has happened yet: the draft stays until the server answers.
    expect(m.composeUp).toBe(true);
    expect(input("To").value).toBe("Bob, Al");
    m.sent();
    expect(log).toContainEqual(["say", "*** Sending Mail..."]);
    expect(state.locked).toBe(true);
    expect(m.listUp).toBe(true);
    expect(m.composeUp).toBe(false);
    expect(input("To").value).toBe("");
    expect(input("Subject").value).toBe("");
    expect(body.value).toBe("");
  });

  test("bug fixed: a To with no item 1 sends and prints the line", () => {
    const { m, btn, input, log } = mailScreen();
    m.show(MSGS);
    btn("Write message").click();
    input("To").value = ",Bob";
    (m.el.querySelector(".mail-body") as HTMLTextAreaElement).value = "x";
    btn("Send", ".mail-compose").click();
    m.sent();
    expect(log.filter((l) => (l as unknown[])[0] === "say")).toEqual([
      ["say", "*** Sending Mail..."],
    ]);
  });

  test("bug fixed: more than 7 names says so and sends nothing; repeats count once", () => {
    const { m, btn, input, log } = mailScreen();
    m.show(MSGS);
    btn("Write message").click();
    input("To").value = "a,b,c,d,e,f,g,h";
    (m.el.querySelector(".mail-body") as HTMLTextAreaElement).value = "x";
    btn("Send", ".mail-compose").click();
    expect(log).toEqual([["say", "*** A message can go to at most 7 people."]]);
    expect(m.composeUp).toBe(true);
    log.length = 0;
    input("To").value = "a,a,a,a,a,a,a,b";
    btn("Send", ".mail-compose").click();
    expect(log).toEqual([["send", "a,a,a,a,a,a,a,b", "", "x"]]);
  });

  test("an empty body or no recipient sends nothing and the compose stays", () => {
    const { m, btn, input, log } = mailScreen();
    m.show(MSGS);
    btn("Write message").click();
    input("To").value = "Bob";
    btn("Send", ".mail-compose").click();
    input("To").value = " * , ";
    (m.el.querySelector(".mail-body") as HTMLTextAreaElement).value = "x";
    btn("Send", ".mail-compose").click();
    expect(log).toEqual([]);
    expect(m.composeUp).toBe(true);
  });

  test("a refused send (no mailSent) keeps the draft with the compose open", () => {
    const { m, btn, input } = mailScreen();
    m.show(MSGS);
    btn("Write message").click();
    input("To").value = "Bob";
    (m.el.querySelector(".mail-body") as HTMLTextAreaElement).value = "draft";
    btn("Send", ".mail-compose").click();
    expect(m.composeUp).toBe(true);
    expect((m.el.querySelector(".mail-body") as HTMLTextAreaElement).value).toBe("draft");
  });

  test("divergence: list CLOSE closes both panes and drops the draft; reopen shows the list alone", () => {
    const { m, btn, rows, input } = mailScreen();
    m.show(MSGS);
    rows(".mail-from")[0]?.click();
    btn("Read message").click();
    btn("Write message").click();
    input("To").value = "Bob";
    btn("Close mailbox").click();
    expect(m.el.hidden).toBe(true);
    expect(m.composeUp).toBe(false);
    m.show(MSGS);
    expect(m.el.querySelector<HTMLElement>(".mail-compose")?.hidden).toBe(true);
    expect(m.el.querySelector<HTMLElement>(".mail-read")?.hidden).toBe(true);
    btn("Write message").click();
    expect(input("To").value).toBe("");
  });

  test("divergence: WRITE starts an empty draft; a second WRITE keeps the open one", () => {
    const { m, btn, input } = mailScreen();
    m.show(MSGS);
    btn("Write message").click();
    input("To").value = "Bob";
    input("Subject").value = "Hi";
    (m.el.querySelector(".mail-body") as HTMLTextAreaElement).value = "draft";
    btn("Write message").click();
    expect(input("To").value).toBe("Bob");
    btn("Close", ".mail-compose").click();
    btn("Write message").click();
    expect(input("To").value).toBe("");
    expect(input("Subject").value).toBe("");
    expect((m.el.querySelector(".mail-body") as HTMLTextAreaElement).value).toBe("");
  });

  test("game entry clears every flag", () => {
    const { m, btn } = mailScreen();
    m.show(MSGS);
    btn("Write message").click();
    m.reset();
    expect(m.composeUp).toBe(false);
    expect(m.listUp).toBe(false);
    expect(m.el.hidden).toBe(true);
  });
});

function boardWindow() {
  const log: unknown[] = [];
  const state = { locked: false };
  const b = createBoardWindow(fakeAssets, {
    post: (t) => log.push(["post", t]),
    close: () => log.push(["close"]),
    lock: (on) => {
      state.locked = on;
    },
  });
  document.body.replaceChildren(b.el);
  const btn = (label: string) =>
    b.el.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`) as HTMLButtonElement;
  const post = () => b.el.querySelector(".board-post-text") as HTMLTextAreaElement;
  return { b, log, state, btn, post };
}

describe("the message board", () => {
  test("rects are the members' own boxes at their placeholders", () => {
    expect(asRect(BOARD_RECTS.art)).toEqual([185, 14, 535, 317]);
    expect(asRect(BOARD_RECTS.topic)).toEqual([261, 23, 479, 39]);
    expect(asRect(BOARD_RECTS.close)).toEqual([415, 288, 472, 308]);
    expect(asRect(BOARD_RECTS.post)).toEqual([472, 288, 524, 307]);
    expect(asRect(BOARD_RECTS.text)).toEqual([203, 45, 502, 210]);
    expect(asRect(BOARD_RECTS.postText)).toEqual([204, 215, 516, 273]);
  });

  test("open: topic, text with line breaks, an emptied PostText and the lock", () => {
    const { b, state, post } = boardWindow();
    post().value = "old";
    b.show({ topic: "Town Square", text: "From: A\r\rHi\r____\r", lock: true });
    expect(b.isOpen).toBe(true);
    expect(b.el.querySelector(".board-topic")?.textContent).toBe("Town Square");
    expect(b.el.querySelector(".board-text")?.textContent).toBe("From: A\n\nHi\n____\n");
    expect(post().value).toBe("");
    expect(state.locked).toBe(true);
    b.show({ topic: "The Knights's Board", text: "", lock: false });
    expect(state.locked).toBe(false);
  });

  test("bug fixed: Post keeps the lock; the server's reload shows the post, scrolled to it", () => {
    const { b, state, btn, post, log } = boardWindow();
    b.show({ topic: "Town Square", text: "", lock: true });
    post().value = "Hello";
    btn("Post").click();
    expect(state.locked).toBe(true);
    expect(log).toEqual([["post", "Hello"]]);
    expect(b.isOpen).toBe(true);
    const text = b.el.querySelector(".board-text") as HTMLElement;
    Object.defineProperty(text, "scrollHeight", { configurable: true, value: 900 });
    b.show({ topic: "Town Square", text: "From: Me\r\rHello\r____\r", lock: true });
    expect(b.isOpen).toBe(true);
    expect(text.textContent).toContain("Hello");
    expect(post().value).toBe("");
    expect(state.locked).toBe(true);
    expect(text.scrollTop).toBe(900);
    b.show(null);
    expect(b.isOpen).toBe(false);
  });

  test("Close hides, unlocks and tells the server", () => {
    const { b, state, btn, log } = boardWindow();
    b.show({ topic: "Town Square", text: "", lock: true });
    btn("Close").click();
    expect(b.isOpen).toBe(false);
    expect(state.locked).toBe(false);
    expect(log).toEqual([["close"]]);
  });

  test("game entry hides an open board", () => {
    const { b } = boardWindow();
    b.show({ topic: "Town Square", text: "", lock: false });
    b.reset();
    expect(b.isOpen).toBe(false);
  });
});
