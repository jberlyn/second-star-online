/**
 * IMsend, the IM windows, Away and the ChatWindow, placed from the shipped layout data's
 * sub-movie frame-1.json and score-spans.jsonl.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { AssetIndex } from "@secondstaronline/data";

import type { Assets } from "../src/assets.ts";
import { AWAY_RECTS, createAwayWindow } from "../src/ui/away.ts";
import { createChatLog } from "../src/ui/chat.ts";
import { createChatRoomWindow, ROOM_RECTS } from "../src/ui/chatroom.ts";
import { createImWindows, IMSEND_RECTS, IMWIN_RECTS, type Rect } from "../src/ui/im.ts";
import { createWindowLayer, STAGE_COLOR } from "../src/ui/window.ts";

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

const SUB = join(import.meta.dir, "../../../assets/original/sub");
type Sprite = { channel: number; rect: number[] };
const frame1 = (movie: string) =>
  (
    JSON.parse(readFileSync(join(SUB, movie, "layout", "frame-1.json"), "utf8")) as {
      sprites: Sprite[];
    }
  ).sprites;
/** A channel's rect in frames 2-28 (`loc` + stored `size`, stretched there). */
const stretched = (movie: string, ch: number) => {
  const span = readFileSync(join(SUB, movie, "layout", "score-spans.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map(
      (l) => JSON.parse(l) as { channel: number; frames: number[]; loc: number[]; size: number[] },
    )
    .find((s) => s.channel === ch && s.frames[0] === 2);
  if (!span) {
    throw new Error(`${movie} channel ${ch}`);
  }
  const [x, y] = span.loc as [number, number];
  const [w, h] = span.size as [number, number];
  return [x, y, x + w, y + h];
};
const asRect = (r: Rect) => [r.x, r.y, r.x + r.w, r.y + r.h];
const rectOf = (movie: string, ch: number) => frame1(movie).find((s) => s.channel === ch)?.rect;

describe("placement", () => {
  test("IMsend", () => {
    expect(asRect(IMSEND_RECTS.art)).toEqual(rectOf("IMsend", 1) as number[]);
    expect(asRect(IMSEND_RECTS.button)).toEqual(rectOf("IMsend", 2) as number[]);
    expect(asRect(IMSEND_RECTS.send)).toEqual(rectOf("IMsend", 6) as number[]);
    expect(asRect(IMSEND_RECTS.to)).toEqual(rectOf("IMsend", 7) as number[]);
  });

  test("the IM windows, Send at frames 2-28's stretched rect", () => {
    for (const n of [1, 5, 10]) {
      const m = `IMwin${n}`;
      expect(asRect(IMWIN_RECTS.art)).toEqual(rectOf(m, 1) as number[]);
      expect(asRect(IMWIN_RECTS.button)).toEqual(rectOf(m, 2) as number[]);
      expect(asRect(IMWIN_RECTS.receive)).toEqual(rectOf(m, 7) as number[]);
      expect(asRect(IMWIN_RECTS.send)).toEqual(stretched(m, 6));
    }
  });

  test("Away", () => {
    const m = "AwayMessageWindow";
    expect(asRect(AWAY_RECTS.frame)).toEqual(rectOf(m, 1) as number[]);
    expect(asRect(AWAY_RECTS.away)).toEqual(rectOf(m, 2) as number[]);
    expect(asRect(AWAY_RECTS.back)).toEqual(rectOf(m, 3) as number[]);
    expect(asRect(AWAY_RECTS.messages)).toEqual(rectOf(m, 4) as number[]);
    expect(asRect(AWAY_RECTS.text)).toEqual(rectOf(m, 5) as number[]);
  });

  test("the ChatWindow, Title, UserList and SendChat stretched in frames 2-28", () => {
    const m = "ChatWindow";
    expect(asRect(ROOM_RECTS.art)).toEqual(rectOf(m, 1) as number[]);
    expect(asRect(ROOM_RECTS.title)).toEqual(stretched(m, 2));
    expect(asRect(ROOM_RECTS.input)).toEqual(stretched(m, 3));
    expect(asRect(ROOM_RECTS.chat)).toEqual(stretched(m, 4));
    expect(asRect(ROOM_RECTS.users)).toEqual(stretched(m, 5));
  });
});

describe("stage colours match each movie's frame 1 layout", () => {
  const colourOf = (movie: string) =>
    (
      JSON.parse(readFileSync(join(SUB, movie, "layout", "frame-1.json"), "utf8")) as {
        stageColor: string | null;
      }
    ).stageColor;

  test("every window SSO builds shows its movie's recorded stage colour behind the art", () => {
    for (const movie of [
      "IMsend",
      "IMwin1",
      "AwayMessageWindow",
      "WhoWindow",
      "ChatWindow",
      "BioWindow",
      "TradeWindow",
      "Friendsgui",
    ]) {
      expect(STAGE_COLOR[movie] ?? null).toBe(colourOf(movie));
    }
    for (let n = 2; n <= 10; n++) {
      expect(colourOf(`IMwin${n}`)).toBe(STAGE_COLOR.IMwin1 ?? null);
    }
  });

  test("IMsend and the IM windows are white behind their art, as 1.6's stage", () => {
    const { ims } = imScene();
    ims.openSend("");
    ims.receive("Bob", "hi");
    const bg = (w: HTMLElement | undefined) =>
      w?.querySelector<HTMLElement>(".window-body")?.style.backgroundColor.toUpperCase() ?? "";
    expect(["#FFFFFF", "RGB(255, 255, 255)"]).toContain(bg(ims.sendWindow.el));
    expect(["#FFFFFF", "RGB(255, 255, 255)"]).toContain(bg(ims.windowOf(1)?.el));
  });
});

function imScene(randoms: number[] = []) {
  const layer = createWindowLayer();
  document.body.replaceChildren(layer.el);
  const sent: unknown[] = [];
  const ims = createImWindows(
    fakeAssets,
    layer,
    { send: (to, text, via) => sent.push([to, text, via]), me: () => "Alice" },
    () => randoms.shift() ?? 1,
  );
  return { layer, ims, sent };
}
const field = (w: HTMLElement, orig: string) =>
  w.querySelector<HTMLTextAreaElement | HTMLInputElement>(`[data-action="${orig}"]`) as
    | HTMLTextAreaElement
    | HTMLInputElement;
const enter = (el: HTMLElement) =>
  el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

describe("IMsend", () => {
  test("opens titled 'Send an Instant Message' with To filled; Send closes it and sends", () => {
    const { ims, sent } = imScene();
    ims.openSend("Bob");
    const w = ims.sendWindow.el;
    expect(ims.sendWindow.isOpen).toBe(true);
    expect(w.getAttribute("aria-label")).toBe("Send an Instant Message");
    expect(field(w, "message-recipient").value).toBe("Bob");
    field(w, "message-text").value = "hello";
    (w.querySelector('[data-action="message-send"]') as HTMLElement).click();
    expect(sent).toEqual([["Bob", "hello", "send"]]);
    expect(ims.sendWindow.isOpen).toBe(false);
  });

  test("Enter in Send sends; with no recipient the window stays and the text is gone", () => {
    const { ims, sent } = imScene();
    ims.openSend("");
    const w = ims.sendWindow.el;
    const msg = field(w, "message-text");
    msg.value = "lost";
    enter(msg);
    expect(sent).toEqual([]);
    expect(msg.value).toBe("");
    expect(ims.sendWindow.isOpen).toBe(true);
  });
});

describe("the IM windows", () => {
  test("an IM opens 'IM from <sender>' in the lowest free slot with '<sender>: <text>'", () => {
    const { ims } = imScene();
    ims.receive("Bob", "hi");
    const w = ims.windowOf(1);
    expect(w?.isOpen).toBe(true);
    expect(w?.el.getAttribute("aria-label")).toBe("IM from Bob");
    expect(w?.el.querySelector(".im-receive")?.textContent).toBe("Bob: hi\n");
  });

  test("closing frees the slot; the next IM in it starts with a clean window", () => {
    const { ims } = imScene();
    ims.receive("Bob", "one");
    ims.windowOf(1)?.close();
    expect(ims.slots[0]).toBeNull();
    ims.receive("bob", "two");
    expect(ims.windowOf(1)?.isOpen).toBe(true);
    expect(ims.windowOf(1)?.el.querySelector(".im-receive")?.textContent).toBe("bob: two\n");
    expect(ims.slots[0]).toBe("bob");
  });

  test("closing a slot makes a later sender reuse it instead of taking random(10)", () => {
    const { ims } = imScene([]);
    for (let n = 1; n <= 10; n++) {
      ims.receive(`P${n}`, "x");
    }
    ims.windowOf(3)?.close();
    ims.receive("Eleven", "new");
    expect(ims.slots[2]).toBe("Eleven");
    expect(ims.windowOf(3)?.el.querySelector(".im-receive")?.textContent).toBe("Eleven: new\n");
  });

  test("with all ten slots held, the 11th sender takes random(10) and clears it", () => {
    const { ims } = imScene([3]);
    for (let n = 1; n <= 10; n++) {
      ims.receive(`P${n}`, "x");
    }
    ims.receive("Eleven", "new");
    expect(ims.slots[2]).toBe("Eleven");
    expect(ims.windowOf(3)?.el.querySelector(".im-receive")?.textContent).toBe("Eleven: new\n");
  });

  test("a reply sends to the window's sender; the server's echo lands in it", () => {
    const { ims, sent } = imScene();
    ims.receive("Bob", "hi");
    const w = ims.windowOf(1)?.el as HTMLElement;
    const reply = field(w, "message-reply-text");
    reply.value = "yo";
    enter(reply);
    expect(sent).toEqual([["Bob", "yo", "window"]]);
    ims.echo("Bob", "yo");
    expect(w.querySelector(".im-receive")?.textContent).toBe("Bob: hi\nAlice: yo\n");
  });
});

describe("Away", () => {
  test("Away sends the text and empties Messages; Back sends null and keeps them", () => {
    const layer = createWindowLayer();
    document.body.replaceChildren(layer.el);
    const sent: (string | null)[] = [];
    const away = createAwayWindow(fakeAssets, layer, { away: (t) => sent.push(t) });
    away.open();
    expect(away.window.el.getAttribute("aria-label")).toBe("Away Message");
    away.log("Bob", "old");
    const w = away.window.el;
    w.querySelector<HTMLTextAreaElement>('[data-action="away-message"]')!.value = "brb";
    (w.querySelector('[data-action="away-set"]') as HTMLElement).click();
    expect(away.messages.textContent).toBe("");
    away.log("Bob", "hi");
    (w.querySelector('[data-action="away-back"]') as HTMLElement).click();
    expect(sent).toEqual(["brb", null]);
    expect(away.messages.textContent).toBe("Bob: hi\n");
  });
});

describe("the ChatWindow", () => {
  function roomScene() {
    const layer = createWindowLayer();
    document.body.replaceChildren(layer.el);
    const sent: unknown[] = [];
    const room = createChatRoomWindow(fakeAssets, layer, {
      say: (t) => sent.push(["say", t]),
      leave: () => sent.push(["leave"]),
      logchat: (f, t) => sent.push(["logchat", f, t]),
    });
    return { room, sent };
  }

  test("entering keeps the old text and adds a blank line, the entry line, a blank line", () => {
    const { room } = roomScene();
    room.enter("You are in: General Chat", "     *** Entering General Chat     ***", ["Alice"]);
    room.line("Alice: hi");
    room.enter("You are in: New Player Chat", "     *** Entering New Player Chat     ***", [
      "Alice",
      "Bob",
    ]);
    expect(room.log).toBe(
      "\n     *** Entering General Chat     ***\n\nAlice: hi\n\n     *** Entering New Player Chat     ***\n\n",
    );
    expect(room.window.el.getAttribute("aria-label")).toBe("Chat");
    expect(room.users).toEqual(["Alice", "Bob"]);
  });

  test("the roster: adding appends unchecked; removing skips the line after each deletion", () => {
    const { room } = roomScene();
    room.enter("t", "e", ["Alice"]);
    room.user("Bob", true);
    room.user("Bob", true);
    room.user("bob", false);
    expect(room.users).toEqual(["Alice", "Bob"]);
  });

  test("Enter sends the line; /logchat saves the room log; closing leaves", () => {
    const { room, sent } = roomScene();
    room.enter("t", "e", ["Alice"]);
    room.input.value = "hello";
    enter(room.input);
    room.input.value = "/logchat room.txt";
    enter(room.input);
    room.window.close();
    expect(sent).toEqual([["say", "hello"], ["logchat", "room.txt", "\ne\n\n"], ["leave"]]);
  });
});

describe("the main chat's saved text (/logchat, Clear Chat Text)", () => {
  test("every line since login or Clear Chat Text, collapsed lines included", () => {
    const log = createChatLog();
    log.add("a");
    log.add("a");
    log.add("b");
    expect(log.text()).toBe("a\na\nb\n");
    log.clear();
    expect(log.text()).toBe("");
    expect(log.el.childElementCount).toBe(0);
  });
});
