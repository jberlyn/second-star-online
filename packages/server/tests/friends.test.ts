/**
 * Friends, bios, profiles and medals on the server.
 */
import { describe, expect, test } from "bun:test";

import { type ServerMsg, skillIndex } from "@secondstaronline/shared";

import { type ChatDeps, handleChat } from "../src/systems/chat/chat.ts";
import { bioRequest, profileSave } from "../src/systems/social/bios.ts";
import { friendsCommand, friendsEntry } from "../src/systems/social/friends.ts";
import { presenceOut } from "../src/systems/social/presence.ts";
import { addPlayer, type Player, removePlayer, statsOf } from "../src/systems/world/world.ts";
import { player, setup, testMap } from "./helpers/sim.ts";

type Out = { to: string; msg: ServerMsg }[];
const texts = (out: Out, id: string) =>
  out.flatMap((o) => (o.to === id && o.msg.t === "chat" ? [o.msg.text] : []));
const of = <T extends ServerMsg["t"]>(out: Out, id: string, t: T) =>
  out.flatMap((o) => (o.to === id && o.msg.t === t ? [o.msg as Extract<ServerMsg, { t: T }>] : []));
const PRESENCE = { announcePresence: true, presenceChatLines: false };

function scene() {
  const map = testMap("x1000y992");
  const s = setup([map]);
  const saved: Record<string, string[]> = {};
  const deps: ChatDeps = {
    maxChars: 200,
    broadcastCooldownFrames: 0,
    chatCooldownFrames: 0,
    helpLines: () => null,
    saveBuddies: (account, items) => {
      saved[account] = [...items];
    },
  };
  const make = (name: string) => player(name, map, 5, 5);
  const alice = make("Alice");
  const bob = make("Bob");
  s.join(alice);
  s.join(bob);
  const say = (p: Player, line: string) => handleChat(s.world, p, line, deps);
  /** Bob logs on (the game's order: added, Friends entry, presence to the others). */
  const logOn = (p: Player): Out => {
    addPlayer(s.world, p);
    p.loading = 0;
    return [...friendsEntry(s.world, p), ...presenceOut(s.world, p, true, PRESENCE)];
  };
  const logOff = (p: Player): Out => {
    removePlayer(s.world, p.id);
    return presenceOut(s.world, p, false, PRESENCE);
  };
  return { ...s, map, alice, bob, make, say, saved, logOn, logOff, deps };
}

describe("/friends and the Friends window", () => {
  test("add: the line, the row, and an online buddy appended in the server's spelling", () => {
    const { alice, say, saved } = scene();
    const out = say(alice, "/friends add bob");
    expect(texts(out, "Alice")).toEqual(["*** bob was added to your friend's list."]);
    expect(of(out, "Alice", "friends")).toEqual([{ t: "friends", names: ["Bob"] }]);
    expect(saved.Alice).toEqual(["bob"]);
    expect(texts(say(alice, "/friends add BOB"), "Alice")).toEqual([
      "*** BOB is already on your friend's list!",
    ]);
  });

  test("add someone offline: no window line; they appear when they log on", () => {
    const { alice, say, make, logOn, logOff } = scene();
    expect(of(say(alice, "/friends add Carol"), "Alice", "friends")).toEqual([]);
    const carol = make("Carol");
    expect(of(logOn(carol), "Alice", "friends")).toEqual([{ t: "friends", names: ["Carol"] }]);
    expect(of(logOff(carol), "Alice", "friends")).toEqual([{ t: "friends", names: [] }]);
  });

  test("game entry fills the window from everyone online, yourself included", () => {
    const { world, make } = scene();
    const carol = make("Carol");
    carol.buddies = ["alice", "carol", "zed"];
    addPlayer(world, carol);
    expect(friendsEntry(world, carol)).toEqual([
      { to: "Carol", msg: { t: "friends", names: ["Alice", "Carol"] } },
    ]);
  });

  test("remove: the line, the row, the window line; again: 'is not on'", () => {
    const { alice, say, saved } = scene();
    say(alice, "/friends add Bob");
    const out = say(alice, "/friends remove BOB");
    expect(texts(out, "Alice")).toEqual(["*** BOB was removed from your friend's list."]);
    expect(of(out, "Alice", "friends")).toEqual([{ t: "friends", names: [] }]);
    expect(saved.Alice).toEqual([]);
    expect(texts(say(alice, "/friends remove Bob"), "Alice")).toEqual([
      "*** Bob is not on your friend's list!",
    ]);
  });

  test("the window's Remove sends the remove-buddy message with the selected line", () => {
    const { world, alice, say, saved } = scene();
    say(alice, "/friends add Bob");
    const out = friendsCommand(world, alice, { kind: "remove", name: "Bob" }, (a, i) => {
      saved[a] = [...i];
    });
    expect(texts(out, "Alice")).toEqual(["*** Bob was removed from your friend's list."]);
  });

  test("a malformed /friends is swallowed: nothing said, nothing printed", () => {
    const { alice, bob, say } = scene();
    for (const line of ["/friends", "/friends add", "/friends list"]) {
      const out = say(alice, line);
      expect(texts(out, "Alice")).toEqual([]);
      expect(texts(out, "Bob")).toEqual([]);
    }
    expect(bob.friends).toEqual([]);
  });

  test("presence off: logons no longer reach the window", () => {
    const { world, alice, say, make } = scene();
    say(alice, "/friends add Carol");
    const carol = make("Carol");
    addPlayer(world, carol);
    expect(
      presenceOut(world, carol, true, { announcePresence: false, presenceChatLines: false }),
    ).toEqual([]);
    expect(alice.friends).toEqual([]);
  });

  test("a dead buddy answers like anyone (the dead flag never blocks it)", () => {
    const { alice, bob, say } = scene();
    bob.deadLock = 50;
    expect(of(say(alice, "/friends add Bob"), "Alice", "friends")).toEqual([
      { t: "friends", names: ["Bob"] },
    ]);
  });
});

describe("bios", () => {
  test("the requester sees the target's bio drawn; own is false for someone else", () => {
    const { world, alice, bob } = scene();
    bob.char.skills[skillIndex("Cooking")] = 90; // holds the spatula, id 39
    bob.char.profile = "Fishing is life";
    bob.char.wanted = true;
    bob.char.faction = { ...bob.char.faction, id: 2 };
    bob.guild = "Knights";
    world.guilds.set("knights", {
      id: "g1",
      name: "Knights",
      alignment: "G",
      colour: 0,
      leaderId: "Bob",
      leaderName: "Bob",
      members: [],
      disbanded: false,
      listedAt: 1,
      createdAt: "",
    });
    const out = bioRequest(world, alice, { id: "Bob" });
    expect(out).toEqual([
      {
        to: "Alice",
        msg: {
          t: "playerBio",
          title: "Bob Star",
          bio: [
            "Name: Bob Star",
            "Class: Novice Cook",
            "Sex: Male",
            `Score: ${90 + 1 * 32 + 20 + 20}`,
            "Leader of the Knights",
            "Loyal to the Warriors",
            "Vile Murderer",
          ],
          profile: "Fishing is life",
          medals: ["39"],
          own: false,
        },
      },
    ]);
    // The Who window's Profile names the player, ignoring case.
    expect(bioRequest(world, alice, { name: "bob" })).toEqual(out);
  });

  test("your own bio is the editable layout", () => {
    const { world, alice } = scene();
    expect(of(bioRequest(world, alice, { id: "Alice" }), "Alice", "playerBio")[0]?.own).toBe(true);
  });

  test("an offline target answers nothing; a dead one answers", () => {
    const { world, alice, bob } = scene();
    expect(bioRequest(world, alice, { name: "Zed" })).toEqual([]);
    bob.deadLock = 40;
    expect(bioRequest(world, alice, { id: "Bob" })).toHaveLength(1);
  });

  test("Nature Shift's tree and the Robe of Invisibility", () => {
    const { world, alice, bob } = scene();
    bob.spell.body = 80;
    expect(of(bioRequest(world, alice, { id: "Bob" }), "Alice", "playerBio")[0]?.title).toBe(
      "A Tree",
    );
    bob.char.equip.body = "Robe of Invisibility";
    expect(of(bioRequest(world, alice, { id: "Bob" }), "Alice", "playerBio")[0]?.bio).toEqual([
      "Name: ????",
      "Class: ",
      "Sex: ",
      "Score: ",
    ]);
  });
});

describe("saving the profile on closing your own bio", () => {
  test("bug fixed: the profile is written as typed, periods and semicolons kept", () => {
    const { alice } = scene();
    const writes: string[] = [];
    expect(profileSave(alice, "Hi. I fish; a lot", (t) => writes.push(t))).toEqual([]);
    expect(alice.char.profile).toBe("Hi. I fish; a lot");
    expect(writes).toEqual(["Hi. I fish; a lot"]);
  });

  test("bug fixed: closing an unedited profile writes and alerts nothing, even with an old colon", () => {
    const { alice } = scene();
    alice.char.profile = "Time: now";
    const writes: string[] = [];
    expect(profileSave(alice, "Time: now", (t) => writes.push(t))).toEqual([]);
    expect(writes).toEqual([]);
  });

  test("a : or / is an alert and nothing is saved", () => {
    const { alice } = scene();
    const writes: string[] = [];
    expect(profileSave(alice, "a::b", (t) => writes.push(t))).toEqual([
      { to: "Alice", msg: { t: "alert", text: "You can't have a : in your profile!" } },
    ]);
    expect(writes).toEqual([]);
  });
});

describe("medals", () => {
  test("Cooking reaching 90 in play prints the spatula's line once and adds its point", () => {
    const { alice, run } = scene();
    alice.char.skills[skillIndex("Cooking")] = 89;
    run(1); // the first tick records the skills
    const sta = alice.char.stats.sta;
    alice.char.skills[skillIndex("Cooking")] = 90;
    const out = run(1);
    expect(texts(out, "Alice")).toEqual([
      "You have been awarded the silver spatula for being a master chef!",
    ]);
    // The allocated stat is untouched; the sheet and the rules see the point.
    expect(alice.char.stats.sta).toBe(sta);
    expect(statsOf(alice).sta).toBe(sta + 1);
    expect(of(out, "Alice", "sheet")[0]?.stats.sta).toBe(sta + 1);
    alice.char.skills[skillIndex("Cooking")] = 91;
    expect(texts(run(3), "Alice")).toEqual([]);
  });

  test("a skill already at 90 or more at login holds its medal and point without a line", () => {
    const { alice, run } = scene();
    const str = alice.char.stats.str;
    alice.char.skills[skillIndex("Slash")] = 100;
    alice.char.skills[skillIndex("Mining")] = 90;
    expect(texts(run(2), "Alice")).toEqual([]);
    expect(statsOf(alice).str).toBe(str + 2);
  });

  test("a skill set past 90 in play prints its line once", () => {
    const { alice, run } = scene();
    run(1);
    alice.char.skills[skillIndex("Mining")] = 95;
    expect(texts(run(1), "Alice")).toEqual([
      "You have been awarded the Medal of Stone for being a master at mining!",
    ]);
    alice.char.skills[skillIndex("Mining")] = 96;
    expect(texts(run(1), "Alice")).toEqual([]);
  });

  test("a skill lowered below 90 loses its medal and its point; back at 90 it returns", () => {
    const { world, alice, bob, run } = scene();
    const str = bob.char.stats.str;
    run(1);
    bob.char.skills[skillIndex("Blacksmithing")] = 90;
    run(1);
    expect(statsOf(bob)).toMatchObject({ str: str + 2 });
    expect(of(bioRequest(world, alice, { id: "Bob" }), "Alice", "playerBio")[0]?.medals).toEqual([
      "92",
    ]);
    bob.char.skills[skillIndex("Blacksmithing")] = 70;
    const out = run(1);
    expect(texts(out, "Bob")).toEqual([]);
    expect(statsOf(bob).str).toBe(str);
    expect(of(out, "Bob", "sheet")[0]?.stats.str).toBe(str);
    expect(of(bioRequest(world, alice, { id: "Bob" }), "Alice", "playerBio")[0]?.medals).toEqual(
      [],
    );
    bob.char.skills[skillIndex("Blacksmithing")] = 90;
    expect(texts(run(1), "Bob")).toEqual([
      "You have been awarded the gold medal for being a master at blacksmithing!",
    ]);
    expect(statsOf(bob).str).toBe(str + 2);
  });
});

describe("calculated stats", () => {
  test("a Druid plays with +3 Dex, Wis and Int and a Blacksmithing medal's points; neither is stored", () => {
    const { bob, run } = scene();
    const base = { ...bob.char.stats };
    bob.char.classCode = 11; // Druid
    bob.char.skills[skillIndex("Blacksmithing")] = 90;
    const out = run(1);
    const expected = {
      ...base,
      dex: base.dex + 3,
      wis: base.wis + 3,
      int: base.int + 3,
      str: base.str + 2,
      sta: base.sta + 2,
    };
    expect(statsOf(bob)).toEqual(expected);
    expect(of(out, "Bob", "sheet").at(-1)?.stats).toEqual(expected);
    expect(bob.char.stats).toEqual(base);
    // A class change takes the class's points with it.
    bob.char.classCode = 1;
    expect(statsOf(bob)).toEqual({ ...base, str: base.str + 2, sta: base.sta + 2 });
  });
});
