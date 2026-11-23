/**
 * Golden rules: mail and message boards.
 */
import { describe, expect, test } from "bun:test";

import {
  BOARD_TEXT,
  boardKind,
  boardMember,
  boardPostText,
  boardText,
  clickGate,
  ctrlGate,
  MAIL_TEXT,
  mailboxOwner,
  mailOpenCheck,
  mailRecipients,
  postHasText,
  replySubject,
  standingInFront,
  stripMailTo,
} from "../../src/index.ts";

/** Ctrl by a player of middling Strength away from their own premises. */
const STRANGER = { str: 50, mine: false };

describe("gate routing", () => {
  test("click: Message Boards exact, 's Board", () => {
    expect(clickGate("Message Boards")).toEqual({ kind: "board" });
    expect(clickGate("message boards")).toEqual({ kind: "board" });
    expect(clickGate("The Knights's Board")).toEqual({ kind: "board" });
  });
  test("click: Universal Mail, and a player's mailbox whatever the owner is called", () => {
    expect(clickGate("Universal Mail")).toEqual({ kind: "mail", universal: true });
    expect(clickGate("Alice's Mailbox")).toEqual({ kind: "mail", universal: false });
    // 1.6 read the words and opened the universal mail; an engine fixture is known by its kind.
    expect(clickGate("Universal Mail's Mailbox")).toEqual({ kind: "mail", universal: false });
  });
  test("click: signs stay silent", () => {
    expect(clickGate("Sign 1")).toEqual({ kind: "silent" });
  });
  test("Ctrl: 's Mailbox before Universal Mail, boards", () => {
    expect(ctrlGate("Universal Mail's Mailbox", STRANGER)).toEqual({
      kind: "mail",
      universal: false,
    });
    expect(ctrlGate("Universal Mail", STRANGER)).toEqual({ kind: "mail", universal: true });
    expect(ctrlGate("Bob's Mailbox", STRANGER)).toEqual({ kind: "mail", universal: false });
    expect(ctrlGate("Message Boards", STRANGER)).toEqual({ kind: "board" });
    expect(ctrlGate("The Knights's Board", STRANGER)).toEqual({ kind: "board" });
  });
});

describe("mailOpenCheck", () => {
  const base = {
    facing: "N" as const,
    stepFrames: 0,
    player: { x: 5, y: 6 },
    box: { x: 5, y: 5 },
    name: "Alice's Mailbox",
    universal: false,
    me: "Alice",
  };
  test("in front and facing, on each side", () => {
    const at = (facing: "N" | "S" | "E" | "W", x: number, y: number) =>
      mailOpenCheck({ ...base, facing, player: { x, y } });
    expect(at("N", 5, 6)).toBe("ok");
    expect(at("S", 5, 4)).toBe("ok");
    expect(at("E", 4, 5)).toBe("ok");
    expect(at("W", 6, 5)).toBe("ok");
    expect(at("S", 5, 6)).toBe("notInFront");
  });
  test("mid-step is refused", () => {
    expect(mailOpenCheck({ ...base, stepFrames: 3 })).toBe("notInFront");
  });
  test("position before owner: a stranger out of place hears notInFront", () => {
    expect(mailOpenCheck({ ...base, me: "Bob", player: { x: 9, y: 9 } })).toBe("notInFront");
    expect(mailOpenCheck({ ...base, me: "Bob" })).toBe("notYours");
  });
  test("owner is the part before ', ignoring case; Universal Mail has no owner test", () => {
    expect(mailboxOwner("Alice's Mailbox")).toBe("Alice");
    expect(mailOpenCheck({ ...base, me: "ALICE" })).toBe("ok");
    expect(mailOpenCheck({ ...base, me: "Bob", name: "Universal Mail", universal: true })).toBe(
      "ok",
    );
  });
  test("the texts", () => {
    expect(MAIL_TEXT.notInFront).toBe(
      "You see the mailbox, but you must be standing in front of it to check it.",
    );
    expect(MAIL_TEXT.notYours).toBe("You can't check mail that's not yours!");
    expect(MAIL_TEXT.checking).toBe("You check your mail...");
    expect(MAIL_TEXT.sending).toBe("*** Sending Mail...");
    expect(MAIL_TEXT.newMail("Bob")).toBe("*** You have new mail from Bob");
  });
});

describe("stripMailTo", () => {
  test("spaces and stars go", () => {
    expect(stripMailTo("a b")).toBe("ab");
    expect(stripMailTo("a*b")).toBe("ab");
    expect(stripMailTo(" Bob , Al ")).toBe("Bob,Al");
  });
  test("bug fixed: long runs of spaces and stars are removed completely", () => {
    expect(stripMailTo("a   b")).toBe("ab");
    expect(stripMailTo("a    b")).toBe("ab");
    expect(stripMailTo("a****b")).toBe("ab");
    expect(stripMailTo(`a${" * ".repeat(300)}b`)).toBe("ab");
  });
});

describe("mailRecipients", () => {
  test("bug fixed: more than seven different names is too many", () => {
    expect(mailRecipients("a,b,c,d,e,f,g")).toEqual({
      names: ["a", "b", "c", "d", "e", "f", "g"],
      tooMany: false,
    });
    expect(mailRecipients("a,b,c,d,e,f,g,h").tooMany).toBe(true);
    expect(MAIL_TEXT.tooMany).toBe("*** A message can go to at most 7 people.");
  });
  test("bug fixed: empty items are skipped wherever they are", () => {
    expect(mailRecipients(",Bob")).toEqual({ names: ["Bob"], tooMany: false });
    expect(mailRecipients(",,,,,,,Bob").names).toEqual(["Bob"]);
    expect(mailRecipients(",,").names).toEqual([]);
  });
  test("bug fixed: a repeated name counts once, ignoring case", () => {
    expect(mailRecipients("Bob,bob,BOB,Al").names).toEqual(["Bob", "Al"]);
    expect(mailRecipients("a,a,a,a,a,a,a,a,b").tooMany).toBe(false);
  });
});

describe("standingInFront", () => {
  const at = { player: { x: 5, y: 5 }, item: { x: 5, y: 4 } };
  test("still, on the tile in front, facing it", () => {
    expect(standingInFront({ facing: "N", stepFrames: 0, ...at })).toBe(true);
    expect(standingInFront({ facing: "E", stepFrames: 0, ...at })).toBe(false);
    expect(standingInFront({ facing: "N", stepFrames: 2, ...at })).toBe(false);
    expect(
      standingInFront({ facing: "N", stepFrames: 0, player: { x: 5, y: 7 }, item: at.item }),
    ).toBe(false);
  });
});

describe("replies and posts", () => {
  test("bug fixed: replySubject adds Re: once", () => {
    expect(replySubject("Hi")).toBe("Re: Hi");
    expect(replySubject(replySubject("Hi"))).toBe("Re: Hi");
    expect(replySubject("RE: Hi")).toBe("RE: Hi");
    expect(replySubject("Reply")).toBe("Re: Reply");
  });
  test("postHasText: a letter or digit, either case", () => {
    expect(postHasText("hello")).toBe(true);
    expect(postHasText("HELLO")).toBe(true);
    expect(postHasText("!!! 7")).toBe(true);
    expect(postHasText("!!! ...\n")).toBe(false);
    expect(postHasText("")).toBe(false);
  });
  test("boardPostText has 24 underscores", () => {
    expect(boardPostText("Alice", "Hi")).toBe(`From: Alice\r\rHi\r${"_".repeat(24)}\r`);
    expect(
      boardText([
        { author: "A", body: "x" },
        { author: "B", body: "y" },
      ]),
    ).toBe(boardPostText("A", "x") + boardPostText("B", "y"));
  });
  test("board names and texts", () => {
    expect(boardKind("Message Boards")).toBe("town");
    expect(boardKind("The Knights's Board")).toBe("guild");
    expect(boardKind("Sign 1")).toBeNull();
    expect(BOARD_TEXT.view).toBe("You view the message board");
    expect(BOARD_TEXT.notInFront).toBe(
      "You see the message board, but you must be standing in front of it to read it.",
    );
    expect(BOARD_TEXT.notMember).toBe("Only members of this guild can read its board.");
    expect(BOARD_TEXT.empty).toBe("Type in something before you post!!!");
    expect(BOARD_TEXT.townSquare).toBe("Town Square");
  });
  test("bug fixed: a hall's board belongs to its guild's members", () => {
    expect(boardMember("The Knights's Board", "Knights")).toBe(true);
    expect(boardMember("the knights's board", "KNIGHTS")).toBe(true);
    expect(boardMember("The Knights's Board", "Rooks")).toBe(false);
    expect(boardMember("The Knights's Board", "")).toBe(false);
  });
});
