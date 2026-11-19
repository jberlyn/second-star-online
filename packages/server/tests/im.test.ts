/**
 * IM, away, chat rooms and ignore on the server.
 */
import { describe, expect, test } from "bun:test";

import type { ServerMsg } from "@secondstaronline/shared";

import { helpLines } from "../src/game.ts";
import { type ChatDeps, handleChat } from "../src/systems/chat/chat.ts";
import { imIntent, setAway } from "../src/systems/chat/im.ts";
import { enterRoom, leaveRoom, roomMembership, roomSay } from "../src/systems/chat/rooms.ts";
import { chatterOut } from "../src/systems/monsters/npc.ts";
import { aqsToMap, toFactionChannel } from "../src/systems/social/factions.ts";
import type { Player } from "../src/systems/world/world.ts";
import { player, setup, testMap } from "./helpers/sim.ts";

type Out = { to: string; msg: ServerMsg }[];
const deps: ChatDeps = {
  maxChars: 200,
  broadcastCooldownFrames: 0,
  chatCooldownFrames: 60,
  helpLines,
};
const texts = (out: Out, id: string) =>
  out.flatMap((o) => (o.to === id && o.msg.t === "chat" ? [o.msg.text] : []));
const ims = (out: Out, id: string) =>
  out.flatMap((o) => (o.to === id && o.msg.t === "im" ? [o.msg] : []));
const of = (out: Out, id: string, t: ServerMsg["t"]) =>
  out.flatMap((o) => (o.to === id && o.msg.t === t ? [o.msg] : []));

function scene() {
  const here = testMap("x1000y992");
  const there = testMap("x1001y992");
  const s = setup([here, there]);
  const alice = player("Alice", here, 5, 5);
  const bob = player("Bob", here, 8, 8);
  const carol = player("Carol", there, 5, 5);
  for (const p of [alice, bob, carol]) {
    s.join(p);
  }
  const say = (p: Player, line: string) => handleChat(s.world, p, line, deps);
  return { ...s, alice, bob, carol, here, there, say };
}

describe("/msg", () => {
  test("the echo >>> in the main chat, then the IM to the target's window", () => {
    const { alice, say } = scene();
    const out = say(alice, "/msg bob  hi there");
    expect(texts(out, "Alice")).toEqual([">>> Alice:  hi there"]);
    expect(ims(out, "Bob")).toEqual([{ t: "im", from: "Alice", text: " hi there", away: false }]);
    expect(alice.chatIn).toBe(60);
  });

  test("no name or no text: nothing sent, the line stays typed", () => {
    const { alice, say } = scene();
    expect(say(alice, "/msg bob")).toEqual([
      { to: "Alice", msg: { t: "restore", text: "/msg bob" } },
    ]);
    expect(alice.chatIn).toBe(0);
  });

  test("divergence: to someone not online, the echo then '<name> is not online.'", () => {
    const { alice, say } = scene();
    expect(texts(say(alice, "/msg Zed hi"), "Alice")).toEqual([
      ">>> Alice: hi",
      "Zed is not online.",
    ]);
  });

  test("messaging yourself works", () => {
    const { alice, say } = scene();
    expect(ims(say(alice, "/msg alice note"), "Alice")).toEqual([
      { t: "im", from: "Alice", text: "note", away: false },
    ]);
  });

  test("divergence: it shares the chat cooldown; a refused line goes back", () => {
    const { alice, say } = scene();
    say(alice, "hello");
    const out = say(alice, "/msg bob hi");
    expect(out).toEqual([
      {
        to: "Alice",
        msg: {
          t: "chat",
          text: "You cannot chat yet - 3 seconds remaining.",
          color: 0,
          restore: "/msg bob hi",
        },
      },
    ]);
  });

  test("an ignored sender's IM vanishes; the sender sees only the echo", () => {
    const { alice, bob, say } = scene();
    bob.ignore = ["alice"];
    const out = say(alice, "/msg bob hi");
    expect(texts(out, "Alice")).toEqual([">>> Alice: hi"]);
    expect(out.filter((o) => o.to === "Bob")).toEqual([]);
  });

  test("an entry past the first 40 still blocks IMs", () => {
    const { alice, bob, say } = scene();
    bob.ignore = [...Array.from({ length: 99 }, (_, i) => `p${i}`), "Alice"];
    expect(ims(say(alice, "/msg bob hi"), "Bob")).toEqual([]);
  });
});

describe("the IM windows' sends", () => {
  test("IMsend: no echo anywhere", () => {
    const { world, alice } = scene();
    const out = imIntent(world, alice, "bob", "hi\r", "send", deps);
    expect(out).toEqual([{ to: "Bob", msg: { t: "im", from: "Alice", text: "hi", away: false } }]);
  });

  test("a window reply echoes into that window", () => {
    const { world, alice } = scene();
    const out = imIntent(world, alice, "Bob", "yo", "window", deps);
    expect(of(out, "Alice", "imEcho")).toEqual([{ t: "imEcho", to: "Bob", text: "yo" }]);
    expect(ims(out, "Bob")).toHaveLength(1);
  });

  test("an empty text or recipient sends nothing", () => {
    const { world, alice } = scene();
    expect(imIntent(world, alice, "Bob", "\r", "send", deps)).toEqual([]);
    expect(imIntent(world, alice, "", "hi", "send", deps)).toEqual([]);
  });

  test("divergence: not online is said for IMsend and replies too", () => {
    const { world, alice } = scene();
    expect(texts(imIntent(world, alice, "Zed", "hi", "send", deps), "Alice")).toEqual([
      "Zed is not online.",
    ]);
  });

  test("a refused reply goes back into its window", () => {
    const { world, alice } = scene();
    alice.chatIn = 30;
    expect(imIntent(world, alice, "Bob", "hi", "window", deps)).toEqual([
      {
        to: "Alice",
        msg: {
          t: "chat",
          text: "You cannot chat yet - 2 seconds remaining.",
          color: 0,
          restore: "hi",
          restoreTo: { kind: "im", to: "Bob" },
        },
      },
    ]);
  });
});

describe("away", () => {
  test("ON and OFF print their lines", () => {
    const { bob, world } = scene();
    expect(texts(setAway(world, bob, "brb", deps), "Bob")).toEqual([
      "*** Your away message has been turned ON.",
    ]);
    expect(texts(setAway(world, bob, null, deps), "Bob")).toEqual([
      "*** Your away message has been turned OFF.",
    ]);
    expect(bob.away).toBeNull();
  });

  test("while away an IM is logged and answered with the bare away text", () => {
    const { alice, bob, say, world } = scene();
    setAway(world, bob, "brb", deps);
    const out = say(alice, "/msg bob hi");
    expect(ims(out, "Bob")).toEqual([{ t: "im", from: "Alice", text: "hi", away: true }]);
    expect(ims(out, "Alice")).toEqual([{ t: "im", from: "Bob", text: "brb", away: false }]);
  });

  test("divergence: two away players do not loop; each logs the other's reply once", () => {
    const { alice, bob, say, world } = scene();
    setAway(world, alice, "out", deps);
    setAway(world, bob, "brb", deps);
    const out = say(alice, "/msg bob hi");
    expect(ims(out, "Bob")).toEqual([{ t: "im", from: "Alice", text: "hi", away: true }]);
    expect(ims(out, "Alice")).toEqual([{ t: "im", from: "Bob", text: "brb", away: true }]);
  });

  test("no auto-reply to yourself", () => {
    const { alice, say, world } = scene();
    setAway(world, alice, "out", deps);
    expect(ims(say(alice, "/msg alice note"), "Alice")).toEqual([
      { t: "im", from: "Alice", text: "note", away: true },
    ]);
  });

  test("OFF in any case or an empty text turns away off instead of answering", () => {
    const { alice, bob, say, world } = scene();
    expect(texts(setAway(world, bob, "off", deps), "Bob")).toEqual([
      "*** Your away message has been turned OFF.",
    ]);
    expect(bob.away).toBeNull();
    expect(ims(say(alice, "/msg bob a"), "Bob")).toEqual([
      { t: "im", from: "Alice", text: "a", away: false },
    ]);
    alice.chatIn = 0;
    expect(texts(setAway(world, bob, "", deps), "Bob")).toEqual([
      "*** Your away message has been turned OFF.",
    ]);
    expect(bob.away).toBeNull();
    expect(ims(say(alice, "/msg bob b"), "Bob")).toEqual([
      { t: "im", from: "Alice", text: "b", away: false },
    ]);
  });

  test("the chat limit is applied before the off test", () => {
    const { bob, world } = scene();
    const tiny = { ...deps, maxChars: 3 };
    expect(texts(setAway(world, bob, "office", tiny), "Bob")).toEqual([
      "*** Your away message has been turned OFF.",
    ]);
    expect(bob.away).toBeNull();
    expect(texts(setAway(world, bob, "onward", tiny), "Bob")).toEqual([
      "*** Your away message has been turned ON.",
    ]);
    expect(bob.away).toBe("onw");
  });

  test("an ignored sender gets no auto-reply: the ignore check runs before the message is sorted", () => {
    const { alice, bob, say, world } = scene();
    setAway(world, bob, "brb", deps);
    bob.ignore = ["Alice"];
    expect(say(alice, "/msg bob hi").filter((o) => o.msg.t === "im")).toEqual([]);
  });
});

describe("chat rooms", () => {
  test("entering: the title, the entry line and the roster, you included; the others see you join", () => {
    const { world, alice, bob } = scene();
    enterRoom(world, alice, "general");
    const out = enterRoom(world, bob, "general");
    expect(of(out, "Bob", "room")).toEqual([
      {
        t: "room",
        title: "You are in: General Chat",
        entering: "     *** Entering General Chat     ***",
        users: ["Alice", "Bob"],
      },
    ]);
    expect(of(out, "Alice", "roomUser")).toEqual([{ t: "roomUser", name: "Bob", on: true }]);
  });

  test("lines go to every member, the sender included, as <sender>: <text>", () => {
    const { world, alice, bob, carol } = scene();
    for (const p of [alice, bob]) {
      enterRoom(world, p, "tradingPost");
    }
    const out = roomSay(world, alice, " selling\rswords", deps, () => []);
    expect(of(out, "Alice", "roomLine")).toEqual([{ t: "roomLine", text: "Alice: sellingswords" }]);
    expect(of(out, "Bob", "roomLine")).toHaveLength(1);
    expect(out.filter((o) => o.to === carol.id)).toEqual([]);
  });

  test("SSO: /me or a typo in a room is an unknown command, told only to the typist and given back", () => {
    const { world, alice, bob } = scene();
    enterRoom(world, alice, "general");
    enterRoom(world, bob, "general");
    expect(roomSay(world, alice, "/me waves", deps, () => [])).toEqual([
      {
        to: alice.id,
        msg: {
          t: "chat",
          text: 'Unknown command "/me".',
          color: 0,
          restore: "/me waves",
          restoreTo: { kind: "room" },
        },
      },
    ]);
    expect(alice.chatIn).toBe(0);
    expect(world.chatLog).toEqual([]);
  });

  test("rooms are never filtered by ignore", () => {
    const { world, alice, bob } = scene();
    enterRoom(world, alice, "general");
    enterRoom(world, bob, "general");
    bob.ignore = ["Alice"];
    expect(
      of(
        roomSay(world, alice, "hi", deps, () => []),
        "Bob",
        "roomLine",
      ),
    ).toHaveLength(1);
  });

  test("one room at a time: entering another leaves the first", () => {
    const { world, alice, bob } = scene();
    enterRoom(world, alice, "general");
    enterRoom(world, bob, "general");
    const out = enterRoom(world, bob, "newPlayer");
    expect(of(out, "Alice", "roomUser")).toEqual([{ t: "roomUser", name: "Bob", on: false }]);
    expect(bob.room?.group).toBe("@NewPlayer");
  });

  test("Guild Chat with no guild says so but leaves your current room alone", () => {
    const { world, alice, bob } = scene();
    enterRoom(world, alice, "general");
    enterRoom(world, bob, "general");
    const out = enterRoom(world, bob, "guild");
    expect(texts(out, "Bob")).toEqual(["You don't belong to a guild!"]);
    expect(of(out, "Alice", "roomUser")).toEqual([]);
    expect(of(out, "Bob", "room")).toEqual([]);
    expect(bob.room?.group).toBe("@GeneralChat");
    expect(
      of(
        roomSay(world, bob, "anyone?", deps, () => []),
        "Alice",
        "roomLine",
      ),
    ).toEqual([{ t: "roomLine", text: "Bob: anyone?" }]);
  });

  test("divergence: Guild Chat is your guild's room; losing the guild drops you silently", () => {
    const { world, alice, bob } = scene();
    alice.guild = "Knights";
    bob.guild = "Knights";
    enterRoom(world, alice, "guild");
    const out = enterRoom(world, bob, "guild");
    expect(of(out, "Bob", "room")[0]).toMatchObject({ title: "Chat for the Knights Guild." });
    bob.guild = "";
    const drop = roomMembership(world);
    expect(drop).toEqual([{ to: "Alice", msg: { t: "roomUser", name: "Bob", on: false } }]);
    expect(bob.room).toBeNull();
  });

  test("divergence: a demoted immortal leaves Admin Chat", () => {
    const { world, alice } = scene();
    alice.role = "immortal";
    enterRoom(world, alice, "admin");
    alice.role = "player";
    roomMembership(world);
    expect(alice.room).toBeNull();
  });

  test("the room input: who and /msg as in the main input, /msg's echo in the main chat", () => {
    const { world, alice } = scene();
    enterRoom(world, alice, "general");
    expect(
      roomSay(world, alice, "who", deps, () => [{ to: "Alice", msg: { t: "who", names: [] } }]),
    ).toEqual([{ to: "Alice", msg: { t: "who", names: [] } }]);
    const out = roomSay(world, alice, "/msg bob hi", deps, () => []);
    expect(texts(out, "Alice")).toEqual([">>> Alice: hi"]);
    expect(roomSay(world, alice, "/msg bob", deps, () => [])).toEqual([
      { to: "Alice", msg: { t: "restore", text: "/msg bob", restoreTo: { kind: "room" } } },
    ]);
  });

  test("divergence: room lines share the chat cooldown, refused back into the room's input", () => {
    const { world, alice } = scene();
    enterRoom(world, alice, "general");
    roomSay(world, alice, "one", deps, () => []);
    expect(roomSay(world, alice, "two", deps, () => [])).toEqual([
      {
        to: "Alice",
        msg: {
          t: "chat",
          text: "You cannot chat yet - 3 seconds remaining.",
          color: 0,
          restore: "two",
          restoreTo: { kind: "room" },
        },
      },
    ]);
  });

  test("closing the window leaves", () => {
    const { world, alice, bob } = scene();
    enterRoom(world, alice, "general");
    enterRoom(world, bob, "general");
    expect(leaveRoom(world, alice)).toEqual([
      { to: "Bob", msg: { t: "roomUser", name: "Alice", on: false } },
    ]);
    expect(world.chatRooms.get("@GeneralChat")).toEqual(["Bob"]);
  });
});

describe("ignore filters what the ignored player's client sent", () => {
  test("say and /me: the ignorer misses them, everyone else hears", () => {
    const { alice, bob, say } = scene();
    bob.ignore = ["ALICE"];
    const out = say(alice, "hi");
    expect(texts(out, "Alice")).toEqual(['Alice says "hi"']);
    expect(texts(out, "Bob")).toEqual([]);
    alice.chatIn = 0;
    expect(texts(say(alice, "/me waves"), "Bob")).toEqual([]);
  });

  test("broadcasts, by the speaker", () => {
    const { alice, carol, say } = scene();
    carol.ignore = ["Alice"];
    const out = say(alice, "'hello all");
    expect(texts(out, "Bob")).toEqual(['Alice broadcasts "hello all"']);
    expect(texts(out, "Carol")).toEqual([]);
  });

  test("an entry past the first 50 still blocks chat", () => {
    const { alice, bob, say } = scene();
    bob.ignore = [...Array.from({ length: 99 }, (_, i) => `p${i}`), "Alice"];
    expect(texts(say(alice, "hi"), "Bob")).toEqual([]);
  });

  test("ignoring yourself does nothing", () => {
    const { alice, say } = scene();
    alice.ignore = ["Alice"];
    expect(texts(say(alice, "hi"), "Alice")).toEqual(['Alice says "hi"']);
  });

  test("a relayed aqs line (quests, rumours, leaders, shop list): the asker's ignorers miss it", () => {
    const { world, alice, bob } = scene();
    bob.ignore = ["Alice"];
    const out = aqsToMap(world, alice, 'Stephie says "Wow thanks"');
    expect(texts(out, "Alice")).toHaveLength(1);
    expect(texts(out, "Bob")).toEqual([]);
  });

  test("the faction announcement, Radar and Inxition lines and the like", () => {
    const { world, alice, bob, here } = scene();
    alice.char.faction = { id: 1, f1Bonus: 0, f2Bonus: 0, f3Bonus: 0 };
    bob.char.faction = { id: 1, f1Bonus: 0, f2Bonus: 0, f3Bonus: 0 };
    bob.ignore = ["Alice"];
    const f = toFactionChannel(
      world,
      1,
      "*** The Mage faction has become stronger thanks to Alice.",
      "Alice",
    );
    expect(f.map((o) => o.to)).toEqual(["Alice"]);
    const room = world.rooms.get(here.name);
    if (!room) {
      throw new Error("no room");
    }
    const r = chatterOut(room, "*** Alice has 20 Hit Points.", "Alice");
    expect(r.map((o) => o.to)).toEqual(["Alice"]);
  });
});

describe("/ignore, /unignore, /ignorelist", () => {
  test("the texts and the stored list, shared by the account's characters", () => {
    const { world, alice, say, carol } = scene();
    carol.accountId = alice.accountId;
    const saved: string[][] = [];
    const d = { ...deps, saveIgnores: (_id: string, l: readonly string[]) => saved.push([...l]) };
    const run = (line: string) => handleChat(world, alice, line, d);
    expect(texts(run("/ignore Bob"), "Alice")).toEqual(["Added Bob to your ignore list."]);
    expect(texts(run("/ignore Bob"), "Alice")).toEqual(["Added Bob to your ignore list."]);
    expect(texts(run("/ignorelist"), "Alice")).toEqual(["*** Your Ignore List ", "Bob", ""]);
    expect(texts(run("/unignore bob"), "Alice")).toEqual(["Removed bob from your ignore list."]);
    expect(alice.ignore).toEqual([]);
    expect(carol.ignore).toEqual([]);
    expect(saved).toEqual([["Bob"], []]);
    expect(say).toBeDefined();
  });
});
