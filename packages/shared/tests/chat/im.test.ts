/** IM, away, ignore and chat-room rules. */
import { describe, expect, test } from "bun:test";

import {
  awayAnswers,
  CHAT_SOCIAL_TEXT,
  IGNORE_MAX,
  ignoreAdd,
  ignoreListLines,
  ignoreRemove,
  ignoreRest,
  ignores,
  logchatFile,
  parseChatLine,
  parseMsg,
  parseRoomLine,
  pickImSlot,
  replySlot,
  roomGroup,
  roomTexts,
  stripReturns,
} from "../../src/index.ts";

describe("/msg", () => {
  test("the split: word 2 is the name, one space after each deleted word, the rest kept", () => {
    expect(parseMsg("/msg bob hi there")).toEqual({ name: "bob", text: "hi there" });
    expect(parseMsg("/msg bob  hi")).toEqual({ name: "bob", text: " hi" });
    expect(parseMsg("/msg bob hi  ")).toEqual({ name: "bob", text: "hi  " });
  });

  test("no name or no text: nothing, the line stays typed", () => {
    expect(parseMsg("/msg")).toBeNull();
    expect(parseMsg("/msg bob")).toBeNull();
    expect(parseMsg("/msg bob ")).toBeNull();
  });

  test("parseChatLine hands /msg and the ignore commands over", () => {
    expect(parseChatLine(" /MSG bob hi")).toEqual({ kind: "msg", text: "/MSG bob hi" });
    expect(parseChatLine("/ignorelist")).toEqual({ kind: "ignoreList" });
    expect(parseChatLine("/ignore  bob ")).toEqual({ kind: "ignore", rest: "bob " });
    expect(parseChatLine("/unignore bob")).toEqual({ kind: "unignore", rest: "bob" });
    expect(parseChatLine("/logchat x")?.kind).toBe("unbuilt");
  });

  test("the IM echo, line and window titles", () => {
    expect(CHAT_SOCIAL_TEXT.imEcho("Alice", "hi")).toBe(">>> Alice: hi");
    expect(CHAT_SOCIAL_TEXT.imLine("Bob", "yo")).toBe("Bob: yo");
    expect(CHAT_SOCIAL_TEXT.imTitle("Bob")).toBe("IM from Bob");
    expect(CHAT_SOCIAL_TEXT.imSendTitle).toBe("Send an Instant Message");
  });
});

describe("the RETURN strip", () => {
  test("one RETURN goes; of two adjacent the second survives", () => {
    expect(stripReturns("a\rb")).toBe("ab");
    expect(stripReturns("a\r\rb")).toBe("a\rb");
    expect(stripReturns("a\n\nb")).toBe("a\nb");
  });

  test("only chars 1-200 are scanned", () => {
    expect(stripReturns(`${"x".repeat(200)}\ry`)).toBe(`${"x".repeat(200)}\ry`);
    expect(stripReturns(`${"x".repeat(199)}\ry`)).toBe(`${"x".repeat(199)}y`);
  });
});

describe("away", () => {
  test("the away ON and OFF lines and window title", () => {
    expect(CHAT_SOCIAL_TEXT.awayOn).toBe("*** Your away message has been turned ON.");
    expect(CHAT_SOCIAL_TEXT.awayOff).toBe("*** Your away message has been turned OFF.");
    expect(CHAT_SOCIAL_TEXT.awayTitle).toBe("Away Message");
  });

  test("an away text of off (any case) or an empty one is off", () => {
    expect(awayAnswers(null)).toBe(false);
    expect(awayAnswers("Off")).toBe(false);
    expect(awayAnswers("")).toBe(false);
    expect(awayAnswers("brb")).toBe(true);
  });
});

describe("IM windows", () => {
  const empty = () => Array.from({ length: 10 }, () => null as string | null);
  const never = () => {
    throw new Error("no random");
  };

  test("the sender's own slot, ignoring case, without reopening", () => {
    const s = empty();
    s[3] = "Bob";
    expect(pickImSlot(s, "bob", never)).toEqual({ slot: 4, opening: false });
  });

  test("else the lowest free slot, opening it", () => {
    const s = empty();
    s[0] = "Ann";
    expect(pickImSlot(s, "Bob", never)).toEqual({ slot: 2, opening: true });
  });

  test("with every slot held, the 11th sender takes random(10) and clears it", () => {
    const s = Array.from({ length: 10 }, (_, i) => `P${i + 1}`);
    let asked = 0;
    const pick = pickImSlot(s, "Eleven", (n) => {
      asked = n;
      return 7;
    });
    expect(asked).toBe(10);
    expect(pick).toEqual({ slot: 7, opening: true });
  });

  test("a reply's echo goes into the slot holding its target", () => {
    const s = empty();
    s[4] = "Bob";
    expect(replySlot(s, "BOB")).toBe(5);
    expect(replySlot(s, "Carl")).toBeNull();
  });
});

describe("ignore", () => {
  test("the rest: word 1 and up to two spaces deleted, the whole rest kept", () => {
    expect(ignoreRest("/ignore bob")).toBe("bob");
    expect(ignoreRest("/ignore   bob")).toBe(" bob");
    expect(ignoreRest("/ignore Bad Guy ")).toBe("Bad Guy ");
    expect(ignoreRest("/ignore")).toBe("");
  });

  test("add keeps one entry, ignoring case, and accepts the empty name once", () => {
    const a = ignoreAdd(["bob"], "BOB");
    expect(a.list).toEqual(["bob"]);
    expect(a.line).toBe("Added BOB to your ignore list.");
    expect(ignoreAdd([], "").list).toEqual([""]);
    expect(ignoreAdd([""], "").list).toEqual([""]);
  });

  test("the list holds 100; the 101st is refused", () => {
    const full = Array.from({ length: IGNORE_MAX }, (_, i) => `p${i}`);
    expect(ignoreAdd(full, "x")).toEqual({ list: full, line: "Your ignore list is full." });
  });

  test("a duplicate is still accepted when the list is full and does not grow it", () => {
    const full = Array.from({ length: IGNORE_MAX }, (_, i) => `p${i}`);
    expect(ignoreAdd(full, "P0")).toEqual({
      list: full,
      line: "Added P0 to your ignore list.",
    });
  });

  test("unignore removes every matching copy, adjacent or apart", () => {
    expect(ignoreRemove(["bob", "BOB", "ann"], "bob").list).toEqual(["ann"]);
    expect(ignoreRemove(["bob", "ann", "bob"], "bob").list).toEqual(["ann"]);
    expect(ignoreRemove(["bob", "ann"], "BOB").list).toEqual(["ann"]);
  });

  test("unignore always prints, found or not", () => {
    expect(ignoreRemove([], "zed")).toEqual({
      list: [],
      line: "Removed zed from your ignore list.",
    });
  });

  test("/ignorelist: the header with its trailing space, the list, a blank line", () => {
    expect(ignoreListLines(["bob"])).toEqual(["*** Your Ignore List ", "bob", ""]);
    expect(ignoreListLines([])).toEqual(["*** Your Ignore List ", ""]);
  });

  test("every entry counts, not just the first 50 for chat or 40 for IMs", () => {
    const list = Array.from({ length: 100 }, (_, i) => `p${i + 1}`);
    expect(ignores(list, "P50")).toBe(true);
    expect(ignores(list, "p51")).toBe(true);
    expect(ignores(list, "p40")).toBe(true);
    expect(ignores(list, "p41")).toBe(true);
    expect(ignores(list, "p100")).toBe(true);
    expect(ignores(list, "p101")).toBe(false);
  });

  test("whole-entry match: a trailing space or two words never matches", () => {
    expect(ignores(["bob "], "bob")).toBe(false);
    expect(ignores(["bob smith"], "bob")).toBe(false);
  });
});

describe("chat rooms", () => {
  test("groups, titles and entry lines, five spaces each side", () => {
    expect(roomGroup("general")).toBe("@GeneralChat");
    expect(roomGroup("newPlayer")).toBe("@NewPlayer");
    expect(roomGroup("tradingPost")).toBe("@TradingPostChat");
    expect(roomGroup("guild", "Knights")).toBe("@xKnights");
    expect(roomGroup("admin")).toBe("@Adminss");
    expect(roomTexts("general")).toEqual({
      title: "You are in: General Chat",
      entering: "     *** Entering General Chat     ***",
    });
    expect(roomTexts("guild", "Knights")).toEqual({
      title: "Chat for the Knights Guild.",
      entering: "     *** Entering Chat for the Knights Guild.     ***",
    });
    expect(roomTexts("admin").title).toBe("You are in: Admin Chat");
    expect(CHAT_SOCIAL_TEXT.roomLine("Bob", "hi")).toBe("Bob: hi");
  });

  test("the room input: /logchat, who, /msg, another command word is unknown, the rest is room text", () => {
    expect(parseRoomLine("/logchat room.txt more")).toEqual({ kind: "logchat", file: "room.txt" });
    expect(parseRoomLine(" who")).toEqual({ kind: "who" });
    expect(parseRoomLine("/msg bob hi")).toEqual({ kind: "msg", text: "/msg bob hi" });
    expect(parseRoomLine("/me waves")).toEqual({ kind: "unknown", command: "/me" });
    expect(parseRoomLine("/o\\ yay")).toEqual({ kind: "say", text: "/o\\ yay" });
    expect(parseRoomLine("'shout")).toEqual({ kind: "say", text: "'shout" });
    expect(parseRoomLine("   ")).toEqual({ kind: "say", text: "  " });
    expect(parseRoomLine("")).toBeNull();
  });

  test("/logchat names the file by word 2 only, chatlog.txt with none", () => {
    expect(logchatFile("/logchat mine.txt extra")).toBe("mine.txt");
    expect(logchatFile(" /LOGCHAT")).toBe("chatlog.txt");
    expect(logchatFile("hello")).toBeNull();
    expect(CHAT_SOCIAL_TEXT.logging).toBe("Logging the chat to file.");
  });
});
