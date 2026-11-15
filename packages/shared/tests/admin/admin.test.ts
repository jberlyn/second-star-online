/** Admin command rules. */
import { describe, expect, test } from "bun:test";

import {
  ADMIN_ROLES,
  ADMIN_TEXT,
  adminChatRefusedInHouse,
  cheatFileLines,
  cheatLine,
  findClass,
  formatAdminChat,
  inventoryLines,
  mayRun,
  parseChatLine,
  parseWarpLine,
  WARPSCRIPT_OFF,
  warpscriptMatches,
} from "../../src/index.ts";

describe("the moderator/immortal table", () => {
  test("kept bug: moderators may kick, warp, jail, look up IPs and see their location, nothing else", () => {
    const mod = Object.entries(ADMIN_ROLES)
      .filter(([, roles]) => roles.includes("moderator"))
      .map(([c]) => c)
      .sort();
    expect(mod).toEqual(
      ["iplookup", "jail", "kick", "location", "warp", "warpmeto", "warptome"].sort(),
    );
    for (const cmd of Object.keys(ADMIN_ROLES)) {
      expect(mayRun(cmd as keyof typeof ADMIN_ROLES, "immortal")).toBe(true);
      expect(mayRun(cmd as keyof typeof ADMIN_ROLES, "player")).toBe(false);
    }
  });
});

describe("parsing a chat line", () => {
  test("each command by word 1, any case, after one leading space", () => {
    expect(parseChatLine(" /WARP Bob x5y5 3 4")).toEqual({
      kind: "admin",
      cmd: "warp",
      w2: "Bob",
      line: "/WARP Bob x5y5 3 4",
    });
    expect(parseChatLine("/warptome bob")).toMatchObject({ cmd: "warptome", w2: "bob" });
    expect(parseChatLine("/BanIP 1.2.3.4")).toMatchObject({ cmd: "banip", w2: "1.2.3.4" });
    expect(parseChatLine("/setclass Bob Death Knight")).toMatchObject({ cmd: "setclass" });
    expect(parseChatLine("/warping")?.kind).toBe("say");
  });

  test("a line starting with - is the admin channel, whatever follows", () => {
    expect(parseChatLine("-hi")).toEqual({ kind: "adminChat", typed: "-hi" });
    expect(parseChatLine(" --- hello")).toEqual({ kind: "adminChat", typed: "--- hello" });
  });
});

describe("admin chat", () => {
  test('the - and the leading spaces go: <... Bob tells the admins "hi"', () => {
    expect(formatAdminChat("Bob", "-   hi")).toBe('<... Bob tells the admins "hi"');
    expect(formatAdminChat("Bob", "-")).toBe('<... Bob tells the admins ""');
  });

  test("in a house map the sender must be at y ≤ 7", () => {
    expect(adminChatRefusedInHouse("x5H1y2", 8)).toBe(true);
    expect(adminChatRefusedInHouse("x5H1y2", 7)).toBe(false);
    expect(adminChatRefusedInHouse("x5y2", 12)).toBe(false);
  });
});

describe("warp lines", () => {
  test("items 3-5 of the typed line; a leading x is deleted and the rest split on y", () => {
    expect(parseWarpLine("/warp Bob x1000y992 5 5")).toEqual({ map: "x1000y992", x: 5, y: 5 });
    expect(parseWarpLine("/warp Bob 7y-3 2 12")).toEqual({ map: "x7y-3", x: 2, y: 12 });
  });

  test("a double space shifts the items (the delimiter is one space), so x is not a number", () => {
    expect(parseWarpLine("/warp Bob  x1y1 5 5")).toBeNull();
    expect(parseWarpLine("/warp Bob x1y1  5 5")).toBeNull();
  });

  test("the server cuts the line at its first * (item 2 by *)", () => {
    expect(parseWarpLine("/warp Bob x1y1 5 5*9")).toEqual({ map: "x1y1", x: 5, y: 5 });
    expect(parseWarpLine("/warp Bob x1y1 5*5")).toBeNull();
  });

  test("SSO: x or y missing, not a whole number, or off the map is refused", () => {
    expect(parseWarpLine("/warp Bob x1y1")).toBeNull();
    expect(parseWarpLine("/warp Bob x1y1 18 5")).toBeNull();
    expect(parseWarpLine("/warp Bob x1y1 5 0")).toBeNull();
  });
});

describe("/warpscript", () => {
  const line = 'Slim broadcasts "help me"';
  test("contains, ignoring case, on the whole server line", () => {
    expect(warpscriptMatches("HELP", line)).toBe(true);
    expect(warpscriptMatches("hel", line)).toBe(true);
    expect(warpscriptMatches("orc", line)).toBe(false);
  });

  test("kept bug: the speaker's name and the word 'broadcasts' match too", () => {
    expect(warpscriptMatches("slim", line)).toBe(true);
    expect(warpscriptMatches("broad", 'Ann broadcasts "hi"')).toBe(true);
  });

  test("unset or empty is inactive; OFF stores a word no one types", () => {
    expect(warpscriptMatches(null, line)).toBe(false);
    expect(warpscriptMatches("", line)).toBe(false);
    expect(warpscriptMatches(WARPSCRIPT_OFF, line)).toBe(false);
  });
});

describe("texts", () => {
  test("/Location prints the map and tile as x-y", () => {
    expect(ADMIN_TEXT.location("x1000y992", 5, 6)).toBe(
      "You are at map: x1000y992 at position: 5-6",
    );
  });

  test("/Inventory prints the 15 bag lines as Name-qty, empty slots blank", () => {
    const bag = Array.from({ length: 15 }, () => null) as ({ item: string; qty: number } | null)[];
    bag[0] = { item: "Apple", qty: 2 };
    bag[2] = { item: "Knife", qty: 1 };
    const lines = inventoryLines(bag);
    expect(lines).toHaveLength(15);
    expect(lines.slice(0, 3)).toEqual(["Apple-2", "", "Knife-1"]);
  });

  test("/CheatFile: the header and cheat log lines", () => {
    expect(cheatLine("Bob", "1.2.3.4", "Speed Hacking")).toBe(
      "Bob - at IP 1.2.3.4 - Speed Hacking",
    );
    expect(cheatFileLines(["a", "", "b"])).toEqual(["* Cheater Log:", "a", "b"]);
    expect(cheatFileLines(Array(400).fill("x"))).toHaveLength(301);
  });
});

describe("/setclass classes", () => {
  test("by name ignoring case and spaces, or by code", () => {
    expect(findClass("death  knight")).toEqual({ code: 17, name: "Death Knight" });
    expect(findClass("12")).toEqual({ code: 12, name: "Ninja" });
    expect(findClass("Immortal")).toEqual({ code: 18, name: "Immortal" });
    expect(findClass("27")).toBeNull();
    expect(findClass("Pirate")).toBeNull();
  });
});
