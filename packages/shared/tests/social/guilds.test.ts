/** Goldens for the guild rules. */
import { describe, expect, test } from "bun:test";

import {
  abdicateGuild,
  clickGate,
  ctrlGate,
  exileMember,
  GUILD_DEFAULT_NAME,
  GUILD_TEXT,
  type GuildRecord,
  guildFileLines,
  guildScreenFields,
  guildScreenFor,
  leaveGuild,
  loadGuildLines,
  loadGuildOutcome,
  parseChatLine,
  sanitiseGuildName,
} from "../../src/index.ts";

/** Ctrl by a player of middling Strength away from their own premises. */
const STRANGER = { str: 50, mine: false };

const knights: GuildRecord = {
  name: "Knights",
  alignment: "G",
  colour: 0,
  leader: "Alice",
  members: ["Bob", "Carol"],
};

describe("the name sanitiser", () => {
  test('each of / ? . : * @ & " is deleted, but of two adjacent ones one survives', () => {
    expect(sanitiseGuildName('a/b?c.d:e*f@g&h"i')).toBe("abcdefghi");
    expect(sanitiseGuildName("a//b")).toBe("a/b");
    expect(sanitiseGuildName("a::b")).toBe("a:b");
  });

  test("the passes scan characters 1-100 only", () => {
    const long = `${"x".repeat(100)}/`;
    expect(sanitiseGuildName(long)).toBe(long);
  });

  test("leading 'the' is stripped twice, then a space, then again", () => {
    expect(sanitiseGuildName("The Knights")).toBe("Knights");
    expect(sanitiseGuildName("the the Knights")).toBe("Knights");
    expect(sanitiseGuildName("The")).toBe("");
    expect(sanitiseGuildName("Thebes")).toBe("Thebes");
  });

  test("SSO also removes every semicolon, backtick and apostrophe; other marks and trailing spaces stay", () => {
    expect(sanitiseGuildName("O'Neil;s`")).toBe("ONeils");
    expect(sanitiseGuildName("a-b\\c, ")).toBe("a-b\\c, ");
  });

  test("the field starts as 'Super Guild Guys ' with its trailing space", () => {
    expect(GUILD_DEFAULT_NAME).toBe("Super Guild Guys ");
  });
});

describe("the file and the guild loader", () => {
  test("the header is <align>-<colour>-*<leader>*, then the members", () => {
    expect(guildFileLines(knights)).toEqual(["G-0-*Alice*", "Bob", "Carol"]);
  });

  test("bug fixed: a line not starting with a letter keeps its first character; empty lines go", () => {
    expect(loadGuildLines(["G-0-*Alice*", "Bob", "", "1st", "_x"])).toEqual([
      "G-0-*Alice*",
      "Bob",
      "1st",
      "_x",
    ]);
    const odd: GuildRecord = { ...knights, members: ["_Bob", "1Carol"] };
    expect(guildScreenFor("Alice", odd)).toMatchObject({ members: ["_Bob", "1Carol"] });
    expect(loadGuildOutcome(guildFileLines(odd), "_Bob")).toBe("kept");
    expect(loadGuildOutcome(guildFileLines(odd), "Bob")).toBe("kicked");
  });

  test("the leader and every member are kept; anyone else is kicked", () => {
    const file = guildFileLines(knights);
    expect(loadGuildOutcome(file, "Alice")).toBe("kept");
    expect(loadGuildOutcome(file, "bob")).toBe("kept");
    expect(loadGuildOutcome(file, "Bo")).toBe("kicked");
    expect(loadGuildOutcome(["!DISBAND!"], "Bob")).toBe("disbanded");
    expect(loadGuildOutcome(null, "Bob")).toBe("cleared");
  });
});

describe("the screen", () => {
  test("The guild leader opens leader mode; a member opens member mode; no guild opens create", () => {
    expect(guildScreenFor("Alice", knights).mode).toBe("leader");
    expect(guildScreenFor("Bob", knights)).toEqual({
      mode: "member",
      name: "Knights",
      alignment: "G",
      leader: "Alice",
      members: ["Bob", "Carol"],
    });
    expect(guildScreenFor("Bob", null)).toEqual({ mode: "create" });
  });

  test("viewing a missing guild: no alignment, leader or members", () => {
    expect(guildScreenFields(null)).toEqual({ alignment: null, leader: "", members: [] });
  });

  test("viewing a disbanded file reads Neutral: !DISBAND! contains N", () => {
    expect(guildScreenFields(["!DISBAND!"])).toEqual({ alignment: "N", leader: "", members: [] });
  });
});

describe("changes (leave, exile, abdicate)", () => {
  test("leave deletes your line", () => {
    expect(leaveGuild(knights, "Bob").members).toEqual(["Carol"]);
  });

  test("exile deletes the selected member", () => {
    expect(exileMember(knights, "Carol").members).toEqual(["Bob"]);
  });

  test("bug fixed: abdicate crowns the target, re-adds the old leader last and names the new leader", () => {
    const g = abdicateGuild(knights, "Bob");
    expect(g.leader).toBe("Bob");
    expect(g.members).toEqual(["Carol", "Alice"]);
    expect(guildFileLines(g)[0]).toBe("G-0-*Bob*");
    // "*** Abdicating to <name>" names the new leader (1.6 named the guild).
    expect(GUILD_TEXT.abdicating("Bob")).toBe("*** Abdicating to Bob");
  });
});

describe("the guild texts are verbatim", () => {
  test("invite, answers and changes", () => {
    expect(GUILD_TEXT.sending("Bob")).toBe("*** Sending an invitation to Bob.");
    expect(GUILD_TEXT.invited("Alice", "Knights")).toBe(
      "*** Alice has invited you to join the Knights. If you would like to join type ACCEPT, to deny the invitation type REJECT.",
    );
    expect(GUILD_TEXT.joined("Bob", "Knights")).toBe("*** Bob has joined the Knights.");
    expect(GUILD_TEXT.quit("Bob", "Knights")).toBe("*** Bob has just quit the Knights");
    expect(GUILD_TEXT.exiled("Bob", "Knights")).toBe("*** Bob was just exiled from the Knights");
    expect(GUILD_TEXT.promoted("Alice", "Bob", "Knights")).toBe(
      "*** Alice has promoted Bob to the new leader of the Knights!!",
    );
    expect(GUILD_TEXT.disbanded("Knights")).toBe("The Knights has been disband!");
    expect(GUILD_TEXT.kicked("Knights")).toBe("You have been kicked out of the Knights");
    expect(GUILD_TEXT.chat("Alice", "Knights", "hi")).toBe('Alice tells the Knights "hi"');
  });
});

describe("chat grammar", () => {
  test("/g strips one ', two spaces, another ', then up to 98 spaces", () => {
    expect(parseChatLine("/g hello")).toEqual({ kind: "guildChat", text: "hello" });
    // Deleting the first word keeps the space, so the first ' test misses and the second takes it.
    expect(parseChatLine("/G '  'hi")).toEqual({ kind: "guildChat", text: "'hi" });
    expect(parseChatLine("/g    hi")).toEqual({ kind: "guildChat", text: "hi" });
    expect(parseChatLine("/g")).toEqual({ kind: "guildChat", text: "" });
  });

  test("/invite: the whole rest after one space", () => {
    expect(parseChatLine("/invite Bob Smith")).toEqual({ kind: "guildInvite", name: "Bob Smith" });
  });

  test("ACCEPT / REJECT carry the line they would say", () => {
    expect(parseChatLine("accept please")).toEqual({
      kind: "guildAnswer",
      accept: true,
      say: "accept please",
    });
    expect(parseChatLine("REJECT")?.kind).toBe("guildAnswer");
  });
});

describe("the Guild Center click", () => {
  test("click and Ctrl reach GuildCenterClick", () => {
    expect(clickGate("Guild Center")).toEqual({ kind: "guildCenter" });
    expect(ctrlGate("Guild Center", STRANGER)).toEqual({ kind: "guildCenter" });
  });
});
