/** Golden tests for chat line rules. */
import { describe, expect, test } from "bun:test";

import {
  broadcastRefusal,
  CANNOT_FIGHT_TEXT,
  chatRefusal,
  formatBroadcast,
  formatEmote,
  formatSay,
  heardSqa,
  isJailMap,
  newsIsNew,
  PALETTE_RGB,
  PASSWORD_TEXT,
  parseChatLine,
  passwordFrom,
  presenceLine,
  pushLines,
  REPEATING_LINES,
  sayRefusedInHouse,
  whoCountLine,
} from "../../src/rules/chat/chat.ts";

describe("parseChatLine: the ChatSend order", () => {
  test("an empty line sends nothing", () => {
    expect(parseChatLine("")).toBeNull();
  });

  test("plain text is local chat with leading spaces stripped", () => {
    expect(parseChatLine("hello")).toEqual({ kind: "say", text: "hello" });
    expect(parseChatLine("     hello  ")).toEqual({ kind: "say", text: "hello  " });
  });

  test("a line of only spaces sends nothing", () => {
    expect(parseChatLine("   ")).toBeNull();
    expect(parseChatLine(" \t  ")).toBeNull();
    expect(formatSay("Bob", "")).toBe('Bob says ""');
  });

  test("' broadcasts: drop ', up to two spaces, then one more '", () => {
    expect(parseChatLine("'hi")).toEqual({ kind: "broadcast", text: "hi" });
    expect(parseChatLine("'  'hi")).toEqual({ kind: "broadcast", text: "hi" });
    expect(parseChatLine("'   hi")).toEqual({ kind: "broadcast", text: " hi" });
    expect(parseChatLine(" 'hi")).toEqual({ kind: "broadcast", text: "hi" });
    expect(parseChatLine("'")).toEqual({ kind: "broadcast", text: "" });
  });

  test("/help: the whole topic, 'Help' when absent, any case", () => {
    expect(parseChatLine("/help")).toEqual({ kind: "help", topic: "Help" });
    expect(parseChatLine("/help   ")).toEqual({ kind: "help", topic: "Help" });
    expect(parseChatLine("/HeLp banking")).toEqual({ kind: "help", topic: "banking" });
    expect(parseChatLine("/help basic commands")).toEqual({
      kind: "help",
      topic: "basic commands",
    });
    expect(parseChatLine("/help  using   items  ")).toEqual({
      kind: "help",
      topic: "using   items",
    });
  });

  test("who must be the whole line, any case", () => {
    expect(parseChatLine("who")).toEqual({ kind: "who" });
    expect(parseChatLine(" WHO")).toEqual({ kind: "who" });
    expect(parseChatLine("who ")).toEqual({ kind: "say", text: "who " });
  });

  test("/me keeps the space after the word, so the line has two", () => {
    const c = parseChatLine("/me waves");
    expect(c).toEqual({ kind: "emote", text: " waves" });
    expect(formatEmote("Bob", " waves")).toBe("Bob  waves");
  });

  test("the rest of the original grammar is recognised, not said", () => {
    for (const line of ["/logchat a.txt", "/RPG hi"]) {
      expect(parseChatLine(line)?.kind).toBe("unbuilt");
    }
    // `/friends` is built as its own command.
    expect(parseChatLine("/friends add bob")).toEqual({
      kind: "friends",
      friends: { kind: "add", name: "bob" },
    });
    // `/Pardon` is built as an admin command.
    expect(parseChatLine("/Pardon bob")?.kind).toBe("admin");
    expect(parseChatLine("/message")?.kind).toBe("say");
    expect(parseChatLine("quit it")?.kind).toBe("say");
  });

  test("Password= takes the second part of the line split on =", () => {
    expect(parseChatLine("Password=hunter2")).toEqual({ kind: "password", password: "hunter2" });
    expect(parseChatLine("PASSWORD=abc")).toEqual({ kind: "password", password: "abc" });
    // word 1 only has to contain it, so a prefix works too
    expect(parseChatLine("newPassword=x")).toEqual({ kind: "password", password: "x" });
    // item 2 stops at the next =
    expect(parseChatLine("Password=a=b")).toEqual({ kind: "password", password: "a" });
    expect(parseChatLine("Password=")).toEqual({ kind: "password", password: "" });
  });

  test("Password= strips every space, slash, colon and backslash", () => {
    expect(passwordFrom("Password=a  b")).toBe("ab");
    expect(passwordFrom("Password=x/y:z\\w")).toBe("xyzw");
    expect(passwordFrom("Password=a b c")).toBe("abc");
    expect(passwordFrom("Password=a///b")).toBe("ab");
    expect(passwordFrom("Password= a b ")).toBe("ab");
    expect(passwordFrom("Password=")).toBe("");
    expect(passwordFrom("Password=abc")).toBe("abc");
    expect(PASSWORD_TEXT.changed).toBe("Password has been changed.");
  });

  test("the bank by word 1, any case, after one leading space", () => {
    expect(parseChatLine(" /DEPOSIT 50")).toEqual({ kind: "bank", text: "/DEPOSIT 50" });
    expect(parseChatLine("/balance")).toEqual({ kind: "bank", text: "/balance" });
    expect(parseChatLine("/withdrawal 5")?.kind).toBe("say");
  });

  test("SSO's /spawn, like /roster", () => {
    expect(parseChatLine("/spawn 2")).toEqual({ kind: "spawn", args: "2", line: "/spawn 2" });
  });
});

describe("formats", () => {
  test("say and broadcast", () => {
    expect(formatSay("Bob", "hi")).toBe('Bob says "hi"');
    expect(formatBroadcast("Bob", "hi")).toBe('Bob broadcasts "hi"');
  });

  test("who count and SSO presence lines", () => {
    expect(whoCountLine(1)).toBe("There is 1 player logged on.");
    expect(whoCountLine(0)).toBe("There are 0 players logged on.");
    expect(whoCountLine(4)).toBe("There are 4 players logged on.");
    expect(presenceLine("Bob", true)).toBe("Bob has logged on.");
    expect(presenceLine("Bob", false)).toBe("Bob has logged off.");
  });

  test("bug fixed: a weaker pusher's line says only that they are too weak", () => {
    expect(pushLines("Bob", false)).toEqual(["Bob shoves you out of the way."]);
    expect(pushLines("Bob", true)).toEqual([
      "Bob attempts to shove you out of the way but is too weak.",
    ]);
  });
});

describe("cooldowns", () => {
  test("broadcast: seconds round up, so any positive remainder refuses", () => {
    expect(broadcastRefusal(0)).toBeNull();
    expect(broadcastRefusal(1000)).toBe("You cannot broadcast yet - 50 seconds remaining.");
    expect(broadcastRefusal(39)).toBe("You cannot broadcast yet - 2 seconds remaining.");
    expect(broadcastRefusal(20)).toBe("You cannot broadcast yet - 1 seconds remaining.");
    expect(broadcastRefusal(19)).toBe("You cannot broadcast yet - 1 seconds remaining.");
    expect(broadcastRefusal(1)).toBe("You cannot broadcast yet - 1 seconds remaining.");
  });

  test("local chat (SSO): seconds round up, never 0 while refusing", () => {
    expect(chatRefusal(0)).toBeNull();
    expect(chatRefusal(60)).toBe("You cannot chat yet - 3 seconds remaining.");
    expect(chatRefusal(1)).toBe("You cannot chat yet - 1 seconds remaining.");
  });
});

describe("house and jail rules", () => {
  test("no talking at y > 10 on a map whose name contains H", () => {
    expect(sayRefusedInHouse("x5H1y2", 11)).toBe(true);
    expect(sayRefusedInHouse("x5h1y2", 11)).toBe(true); // Lingo contains ignores case
    expect(sayRefusedInHouse("x5H1y2", 10)).toBe(false);
    expect(sayRefusedInHouse("x1000y992", 12)).toBe(false);
  });

  test("a quoted sqa line is muffled for a listener at y > 10 in a house", () => {
    expect(heardSqa('Bob says "hi"', "x5H1y2", 11)).toBe("You hear a muffled voice.");
    expect(heardSqa("Bob  waves", "x5H1y2", 11)).toBe("Bob  waves");
    expect(heardSqa('Bob says "hi"', "x5H1y2", 10)).toBe('Bob says "hi"');
  });

  test("jail is map x0y0", () => {
    expect(isJailMap("x0y0")).toBe(true);
    expect(isJailMap("X0Y0")).toBe(true);
    expect(isJailMap("x0y01")).toBe(false);
  });
});

describe("login news (SortNews)", () => {
  test("the news prints only when it differs from the news this computer kept", () => {
    expect(newsIsNew("Welcome to First Star Online!", null)).toBe(true);
    expect(newsIsNew("Welcome to First Star Online!", "Welcome to First Star Online!")).toBe(false);
    expect(newsIsNew("Server restarts at noon.", "Welcome to First Star Online!")).toBe(true);
  });
});

describe("the chat palette", () => {
  test("palette indices measured on the running 1.6", () => {
    expect(PALETTE_RGB).toEqual({
      0: "#FFFFFF",
      4: "#FFFF00",
      5: "#00FF00",
      6: "#FF0000",
      8: "#A0A0A4",
      46: "#CCCC33",
      84: "#9999FF",
      103: "#9900CC",
      124: "#669933",
    });
  });

  test("only the two held-key lines repeat per tick (movement.ts web line)", () => {
    expect([...REPEATING_LINES].sort()).toEqual(
      [CANNOT_FIGHT_TEXT, "Your feet are stuck in the web, you cannot move!"].sort(),
    );
  });
});
