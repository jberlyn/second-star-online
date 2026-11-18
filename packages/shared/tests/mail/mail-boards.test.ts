/**
 * Golden rules: mail and message boards.
 */
import { describe, expect, test } from "bun:test";

import {
  BOARD_TEXT,
  boardKind,
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
  test("click: Universal Mail before 's Mailbox", () => {
    expect(clickGate("Universal Mail")).toEqual({ kind: "mail", universal: true });
    expect(clickGate("Alice's Mailbox")).toEqual({ kind: "mail", universal: false });
    expect(clickGate("Universal Mail's Mailbox")).toEqual({ kind: "mail", universal: true });
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
  test("a run of four spaces leaves one (delete while iterating)", () => {
    // By hand: pass 1 deletes at x=2 and x=3 (4 → 2 spaces, the scan has moved on to `b`);
    // pass 2 deletes at x=2 (2 → 1) and moves on. Three spaces are all removed.
    expect(stripMailTo("a   b")).toBe("ab");
    expect(stripMailTo("a    b")).toBe("a b");
  });
  test("a run of four stars leaves one", () => {
    expect(stripMailTo("a***b")).toBe("ab");
    expect(stripMailTo("a****b")).toBe("a*b");
  });
});

describe("mailRecipients", () => {
  test("eight names → seven", () => {
    expect(mailRecipients("a,b,c,d,e,f,g,h").names).toEqual(["a", "b", "c", "d", "e", "f", "g"]);
  });
  test(",Bob has no item 1, so no Sending line", () => {
    expect(mailRecipients(",Bob")).toEqual({ names: ["Bob"], firstFilled: false });
    expect(mailRecipients("Bob")).toEqual({ names: ["Bob"], firstFilled: true });
  });
  test("a repeated name twice; all empty → none", () => {
    expect(mailRecipients("Bob,Bob").names).toEqual(["Bob", "Bob"]);
    expect(mailRecipients(",,").names).toEqual([]);
  });
});

describe("replies and posts", () => {
  test("replySubject stacks Re:", () => {
    expect(replySubject("Hi")).toBe("Re: Hi");
    expect(replySubject(replySubject("Hi"))).toBe("Re: Re: Hi");
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
    expect(BOARD_TEXT.enterBuilding).toBe("You have to enter the building to view this board.");
    expect(BOARD_TEXT.empty).toBe("Type in something before you post!!!");
    expect(BOARD_TEXT.townSquare).toBe("Town Square");
  });
});
