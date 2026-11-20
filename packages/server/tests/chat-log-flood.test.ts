/**
 * Lines the server logs but delivers nowhere (a room line typed out of a room, staff chat refused
 * to a player, an away text) are logged at most once per chat cooldown, so they cannot flood the
 * chat log.
 */
import { describe, expect, test } from "bun:test";

import { type ChatDeps, handleChat } from "../src/systems/chat/chat.ts";
import { setAway } from "../src/systems/chat/im.ts";
import { roomSay } from "../src/systems/chat/rooms.ts";
import { player, setup, testMap } from "./helpers/sim.ts";

const deps: ChatDeps = {
  maxChars: 200,
  broadcastCooldownFrames: 1000,
  chatCooldownFrames: 60,
  helpLines: () => null,
};

function scene() {
  const map = testMap("x1000y992");
  const s = setup([map]);
  const bob = player("Bob", map, 5, 5);
  s.join(bob);
  const logged = () => s.world.chatLog.splice(0).map((e) => [e.channel, e.text, e.outcome]);
  return { world: s.world, bob, logged };
}

describe("lines delivered nowhere cannot flood the chat log", () => {
  test("SSO: a room line out of a room is logged once per chat cooldown", () => {
    const { world, bob, logged } = scene();
    for (let i = 0; i < 5; i++) {
      roomSay(world, bob, `spam ${i}`, deps, () => []);
    }
    expect(logged()).toEqual([["room", "spam 0", "noRoom"]]);
    bob.unsentLogIn = 0;
    roomSay(world, bob, "later", deps, () => []);
    expect(logged()).toEqual([["room", "later", "noRoom"]]);
  });

  test("SSO: staff chat refused to a player is logged once per chat cooldown, and still refused", () => {
    const { world, bob, logged } = scene();
    const replies = [];
    for (let i = 0; i < 5; i++) {
      replies.push(handleChat(world, bob, `-hello ${i}`, deps).length);
    }
    expect(replies.every((n) => n > 0)).toBe(true);
    expect(logged().map(([c, , o]) => [c, o])).toEqual([["staff", "denied"]]);
    // The player's own chat cooldown is untouched.
    expect(bob.chatIn).toBe(0);
  });

  test("SSO: an away text is logged once per chat cooldown, though each one is set", () => {
    const { world, bob, logged } = scene();
    for (let i = 0; i < 5; i++) {
      setAway(world, bob, `away ${i}`, deps);
    }
    expect(bob.away).toBe("away 4");
    expect(logged()).toEqual([["away", "away 0", "delivered"]]);
  });
});
