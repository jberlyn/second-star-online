/**
 * Sim tests: guilds on the server.
 */
import { describe, expect, test } from "bun:test";

import { headDrop, type ServerMsg, turnKey } from "@secondstaronline/shared";

import { type ChatDeps, handleChat } from "../src/systems/chat/chat.ts";
import { mayUseContainer } from "../src/systems/economy/containers.ts";
import { actionIntent, type ItemCtx, pickupIntent } from "../src/systems/inventory/items.ts";
import {
  guildAction,
  guildClose,
  guildCreate,
  guildList,
  guildLogin,
  guildView,
} from "../src/systems/social/guilds.ts";
import {
  addPlayer,
  createWorld,
  type GroundItem,
  type Player,
  type Room,
  type World,
} from "../src/systems/world/world.ts";
import { player, rngByN, testMap } from "./helpers/sim.ts";

type Out = { to: string; msg: ServerMsg }[];
const chat = (msgs: Out, to: string) =>
  msgs.flatMap((m) => (m.to === to && m.msg.t === "chat" ? [m.msg.text] : []));
const of = (msgs: Out, to: string, t: ServerMsg["t"]) =>
  msgs.filter((m) => m.to === to && m.msg.t === t).map((m) => m.msg);

const chatDeps: ChatDeps = {
  maxChars: 200,
  broadcastCooldownFrames: 1000,
  chatCooldownFrames: 60,
  helpLines: () => null,
};
let ids = 0;
const guildDeps = { newId: () => `guild-${++ids}`, now: () => "2026-11-07T00:00:00.000Z" };

function scene() {
  const map = testMap("x1000y992");
  const world: World = createWorld();
  const join = (name: string, x = 5, y = 6, facing: Player["facing"] = "N"): Player => {
    const p = player(name, map, x, y);
    p.facing = facing;
    addPlayer(world, p);
    p.loading = 0;
    return p;
  };
  const room = (): Room => world.rooms.get(map.name) as Room;
  const ctx = (): ItemCtx => ({ world, rng: rngByN(), now: 1_000_000 });
  const center: GroundItem = {
    id: "gc",
    item: "Guild Center",
    x: 5,
    y: 5,
    kind: "drop",
    expiresAt: null,
  };
  map.ground.push(center);
  const say = (p: Player, line: string) => {
    p.chatIn = 0;
    return handleChat(world, p, line, chatDeps);
  };
  /** Alice opens the Center and creates Knights (Good). */
  const knights = () => {
    const a = join("Alice");
    pickupIntent(ctx(), room(), a, "gc");
    a.itemPause = 0;
    const out = guildCreate(world, a, "Knights", "G", guildDeps);
    return { a, out };
  };
  /** Knights with Bob and Carol as members. */
  const full = () => {
    const { a } = knights();
    const b = join("Bob", 3, 3);
    const c = join("Carol", 4, 3);
    say(a, "/invite Bob");
    say(b, "ACCEPT");
    say(a, "/invite Carol");
    say(c, "ACCEPT");
    return { a, b, c };
  };
  const open = (p: Player) => {
    p.guildScreen = true;
    p.keyLock = true;
  };
  return { map, world, join, room, ctx, center, say, knights, full, open };
}

describe("the Guild Center click", () => {
  test("from the tile in front, facing it: the screen in create mode, the list, the key lock", () => {
    const s = scene();
    const a = s.join("Alice", 5, 6, "N");
    const out = pickupIntent(s.ctx(), s.room(), a, "gc");
    expect(of(out, "Alice", "guild")).toEqual([{ t: "guild", screen: { mode: "create" } }]);
    expect(of(out, "Alice", "guildList")).toEqual([{ t: "guildList", names: [] }]);
    expect(a.keyLock).toBe(true);
    // The click's pause came first.
    expect(a.itemPause).toBe(4);
  });

  test("anywhere else, or facing away: the standing-in-front line", () => {
    const s = scene();
    const a = s.join("Alice", 5, 6, "E");
    expect(chat(pickupIntent(s.ctx(), s.room(), a, "gc"), "Alice")).toEqual([
      "You see the guild center, but you must be standing in front of it to use it.",
    ]);
    expect(a.keyLock).toBe(false);
  });

  test("Ctrl on the faced Center opens it too", () => {
    const s = scene();
    const a = s.join("Alice", 5, 6, "N");
    expect(of(actionIntent(s.ctx(), s.room(), a), "Alice", "guild")).toHaveLength(1);
  });
});

describe("create", () => {
  test("Guild created!, the screen closes, the field is set and the Hail goes to the guild", () => {
    const s = scene();
    const { a, out } = s.knights();
    expect(chat(out, "Alice")).toEqual(["Guild created!", "Hail your guildmate Alice!"]);
    expect(of(out, "Alice", "guild")).toEqual([{ t: "guild", screen: null }]);
    expect(a.guild).toBe("Knights");
    expect(a.keyLock).toBe(false);
    expect(guildList(s.world)).toEqual(["Knights"]);
  });

  test("a taken name, ignoring case, gets the alert; the keys are already unlocked", () => {
    const s = scene();
    s.knights();
    const b = s.join("Bob", 3, 3);
    s.open(b);
    const out = guildCreate(s.world, b, "the KNIGHTS", "E", guildDeps);
    expect(of(out, "Bob", "alert")).toEqual([
      { t: "alert", text: "This guild name is already taken!" },
    ]);
    expect(b.guild).toBe("");
    expect(b.keyLock).toBe(false);
    expect(b.guildScreen).toBe(true);
  });

  test("divergence: an empty name after the sanitiser gets the same alert", () => {
    const s = scene();
    const b = s.join("Bob", 3, 3);
    s.open(b);
    expect(of(guildCreate(s.world, b, "the", "G", guildDeps), "Bob", "alert")).toHaveLength(1);
  });

  test("CANCEL closes and unlocks", () => {
    const s = scene();
    const b = s.join("Bob", 3, 3);
    s.open(b);
    guildClose(b);
    expect(b.keyLock).toBe(false);
    expect(b.guildScreen).toBe(false);
  });
});

describe("invite, ACCEPT, REJECT", () => {
  test("an invitation, the acceptance and the joins: the joiner does not hear 'has joined'", () => {
    const s = scene();
    const { a } = s.knights();
    const b = s.join("Bob", 3, 3);
    const inv = s.say(a, "/invite Bob");
    expect(chat(inv, "Alice")).toEqual(["*** Sending an invitation to Bob."]);
    expect(chat(inv, "Bob")).toEqual([
      "*** Alice has invited you to join the Knights. If you would like to join type ACCEPT, to deny the invitation type REJECT.",
    ]);
    const acc = s.say(b, "ACCEPT");
    expect(chat(acc, "Bob")).toEqual([
      "*** You have accepted the offer.",
      "Hail your guildmate Bob!",
    ]);
    expect(chat(acc, "Alice")).toEqual([
      "*** Bob has joined the Knights.",
      "Hail your guildmate Bob!",
    ]);
    expect(b.guild).toBe("Knights");
  });

  test("ACCEPT with nothing pending is said aloud", () => {
    const s = scene();
    const c = s.join("Carol", 3, 3);
    expect(chat(s.say(c, "ACCEPT"), "Carol")).toEqual(['Carol says "ACCEPT"']);
  });

  test("REJECT tells the leader; the invitation is gone", () => {
    const s = scene();
    const { a } = s.knights();
    const b = s.join("Bob", 3, 3);
    s.say(a, "/invite Bob");
    const out = s.say(b, "reject");
    expect(chat(out, "Bob")).toEqual(["*** You have rejected the offer."]);
    expect(chat(out, "Alice")).toEqual(["*** Bob has declined your offer."]);
    expect(b.guildInvite).toBeNull();
  });

  test("only a leader invites; someone in a guild (you too) gets the denial", () => {
    const s = scene();
    const { a, b } = s.full();
    expect(chat(s.say(b, "/invite Carol"), "Bob")).toEqual([
      "*** You are not the leader of a guild.",
    ]);
    expect(chat(s.say(a, "/invite Alice"), "Alice")).toEqual([
      "*** Sending an invitation to Alice.",
      "*** Alice already belongs to a guild.",
    ]);
    // Nobody of that name online: the line still prints.
    expect(chat(s.say(a, "/invite Zed"), "Alice")).toEqual(["*** Sending an invitation to Zed."]);
  });

  test("a newer invitation replaces the old one", () => {
    const s = scene();
    const { a } = s.knights();
    const d = s.join("Dave", 2, 2);
    s.open(d);
    guildCreate(s.world, d, "Rogues", "E", guildDeps);
    const b = s.join("Bob", 3, 3);
    s.say(a, "/invite Bob");
    s.say(d, "/invite Bob");
    s.say(b, "ACCEPT");
    expect(b.guild).toBe("Rogues");
  });

  test("divergence: ACCEPT after the inviter left joins nothing", () => {
    const s = scene();
    const { a } = s.knights();
    const b = s.join("Bob", 3, 3);
    s.say(a, "/invite Bob");
    s.world.players.delete(a.id);
    expect(chat(s.say(b, "ACCEPT"), "Bob")).toEqual(["*** You have accepted the offer."]);
    expect(b.guild).toBe("");
  });
});

describe("guild chat /g", () => {
  test("to every member online, the sender included; others never hear it", () => {
    const s = scene();
    const { a, b } = s.full();
    const z = s.join("Zed", 9, 9);
    const out = s.say(a, "/g hello");
    expect(chat(out, "Alice")).toEqual(['Alice tells the Knights "hello"']);
    expect(chat(out, "Bob")).toEqual(['Alice tells the Knights "hello"']);
    expect(chat(out, "Zed")).toEqual([]);
    expect(chat(s.say(z, "/g hi"), "Zed")).toEqual(["You don't belong to a guild!"]);
    expect(b.guild).toBe("Knights");
  });

  test("every /g line is in the chat log: delivered, refused by the cooldown, with no guild", () => {
    const s = scene();
    const { a } = s.full();
    const z = s.join("Zed", 9, 9);
    s.world.chatLog.length = 0;
    s.say(a, "/g hello");
    handleChat(s.world, a, "/g too fast", chatDeps);
    s.say(z, "/g hi");
    expect(s.world.chatLog.map((e) => [e.channel, e.sender, e.target, e.text, e.outcome])).toEqual([
      ["guild", "Alice", "Knights", "hello", "delivered"],
      ["guild", "Alice", "Knights", "too fast", "cooldown"],
      ["guild", "Zed", null, "hi", "noGuild"],
    ]);
  });

  test("guild chat is filtered by each member's ignore list", () => {
    const s = scene();
    const { a, b } = s.full();
    b.ignore = ["Alice"];
    const out = s.say(a, "/g hello");
    expect(chat(out, "Alice")).toEqual(['Alice tells the Knights "hello"']);
    expect(chat(out, "Bob")).toEqual([]);
  });

  test("divergence: it shares the chat cooldown", () => {
    const s = scene();
    const { a } = s.full();
    s.say(a, "/g one");
    const out = handleChat(s.world, a, "/g two", chatDeps);
    expect(chat(out, "Alice")[0]).toMatch(/^You cannot chat yet/);
  });
});

describe("leave, exile, abdicate, disband", () => {
  test("leave: 'Quitting' to you, 'has just quit' to the others, the screen closes", () => {
    const s = scene();
    const { b } = s.full();
    s.open(b);
    const out = guildAction(s.world, b, "leave", "Knights", undefined);
    expect(chat(out, "Bob")).toEqual(["*** Quitting the Knights"]);
    expect(chat(out, "Alice")).toEqual(["*** Bob has just quit the Knights"]);
    expect(b.guild).toBe("");
    expect(b.keyLock).toBe(false);
  });

  test("a leader has no Leave; another guild on screen is not yours", () => {
    const s = scene();
    const { a } = s.full();
    s.open(a);
    expect(guildAction(s.world, a, "leave", "Knights", undefined)).toEqual([]);
    expect(chat(guildAction(s.world, a, "disband", "Rogues", undefined), "Alice")).toEqual([
      "You're not a member of this guild!",
    ]);
  });

  test("exile: the exiled member hears the exile line, then the kick", () => {
    const s = scene();
    const { a, b } = s.full();
    s.open(a);
    const out = guildAction(s.world, a, "exile", "Knights", "Bob");
    expect(chat(out, "Bob")).toEqual([
      "*** Bob was just exiled from the Knights",
      "You have been kicked out of the Knights",
    ]);
    expect(chat(out, "Carol")).toEqual(["*** Bob was just exiled from the Knights"]);
    expect(b.guild).toBe("");
    expect(a.guildScreen).toBe(true);
  });

  test("bug fixed: abdicate names the new leader and redraws the old leader's screen as a member's", () => {
    const s = scene();
    const { a, b } = s.full();
    s.open(a);
    const out = guildAction(s.world, a, "abdicate", "Knights", "Bob");
    expect(chat(out, "Alice")).toEqual([
      "*** Abdicating to Bob",
      "*** Alice has promoted Bob to the new leader of the Knights!!",
    ]);
    const g = s.world.guilds.get("knights");
    expect(g?.leaderName).toBe("Bob");
    expect(g?.members.map((m) => m.name)).toEqual(["Carol", "Alice"]);
    expect(of(out, "Alice", "guild")).toEqual([
      {
        t: "guild",
        screen: {
          mode: "member",
          name: "Knights",
          alignment: "G",
          leader: "Bob",
          members: ["Carol", "Alice"],
        },
      },
    ]);
    expect(a.guildScreen).toBe(true);
    expect(guildAction(s.world, a, "exile", "Knights", "Carol")).toEqual([]);
    expect(b.guild).toBe("Knights");
  });

  test("divergence: a stale target (exiled since) is refused", () => {
    const s = scene();
    const { a } = s.full();
    s.open(a);
    guildAction(s.world, a, "exile", "Knights", "Bob");
    expect(guildAction(s.world, a, "abdicate", "Knights", "Bob")).toEqual([]);
  });

  test("disband: everyone online, the leader too, loses the guild", () => {
    const s = scene();
    const { a, b } = s.full();
    s.open(a);
    const out = guildAction(s.world, a, "disband", "Knights", undefined);
    expect(chat(out, "Alice")).toEqual(["The Knights has been disband!"]);
    expect(chat(out, "Bob")).toEqual(["The Knights has been disband!"]);
    expect(a.guild).toBe("");
    expect(b.guild).toBe("");
    expect(guildList(s.world)).toEqual([]);
  });
});

describe("login", () => {
  test("a member hails the guild; an exile, a disband and a recreated name each tell", () => {
    const s = scene();
    const { a, b, c } = s.full();
    s.world.players.delete(c.id); // Carol logs off
    s.open(a);
    guildAction(s.world, a, "exile", "Knights", "Carol");
    const c2 = s.join("Carol", 4, 3);
    expect(chat(guildLogin(s.world, c2, "Knights"), "Carol")).toEqual([
      "You have been kicked out of the Knights",
    ]);
    s.world.players.delete(b.id);
    const b2 = s.join("Bob", 3, 3);
    const hail = guildLogin(s.world, b2, "Knights");
    expect(chat(hail, "Alice")).toEqual(["Hail your guildmate Bob!"]);
    expect(b2.guild).toBe("Knights");
    s.world.players.delete(b2.id);
    guildAction(s.world, a, "disband", "Knights", undefined);
    const b3 = s.join("Bob", 3, 3);
    expect(chat(guildLogin(s.world, b3, "Knights"), "Bob")).toEqual([
      "The Knights has been disband!",
    ]);
  });

  test("a guild of the same name created again: an old member is kicked at login", () => {
    const s = scene();
    const { a, b } = s.full();
    s.world.players.delete(b.id);
    s.open(a);
    guildAction(s.world, a, "disband", "Knights", undefined);
    s.open(a);
    guildCreate(s.world, a, "knights", "N", guildDeps);
    const b2 = s.join("Bob", 3, 3);
    expect(chat(guildLogin(s.world, b2, "Knights"), "Bob")).toEqual([
      "You have been kicked out of the Knights",
    ]);
  });
});

describe("viewing", () => {
  test("another guild's fields; a disbanded one reads Neutral with nobody", () => {
    const s = scene();
    const { a } = s.full();
    const d = s.join("Dave", 2, 2);
    s.open(d);
    guildCreate(s.world, d, "Rogues", "E", guildDeps);
    s.open(a);
    expect(of(guildView(s.world, a, "Rogues"), "Alice", "guildView")).toEqual([
      { t: "guildView", name: "Rogues", alignment: "E", leader: "Dave", members: [] },
    ]);
    s.open(d);
    guildAction(s.world, d, "disband", "Rogues", undefined);
    expect(of(guildView(s.world, a, "Rogues"), "Alice", "guildView")).toEqual([
      { t: "guildView", name: "Rogues", alignment: "N", leader: "", members: [] },
    ]);
  });
});

describe("halls, keys, vaults and head drops follow the guild", () => {
  test("a member's Guild Key fits the guild's door; anyone else's does not", () => {
    const s = scene();
    const { b } = s.full();
    expect(turnKey("Guild Key", "The Knights's Door", b.name, b.guild).kind).toBe("turn");
    expect(turnKey("Guild Key", "The Knights's Door", "Zed", "").kind).toBe("text");
  });

  test("the guild vault is its members'", () => {
    const s = scene();
    const { b } = s.full();
    const z = s.join("Zed", 9, 9);
    expect(mayUseContainer(b, "The Knights's Guild Vault")).toBe(true);
    expect(mayUseContainer(z, "The Knights's Guild Vault")).toBe(false);
    expect(mayUseContainer(b, "The Rogues's Guild Vault")).toBe(false);
  });

  test("furniture may go down in your guild's hall", () => {
    expect(headDrop("Hall of the Knights", "Bob", "Knights")).toBe(0);
  });

  test("bug fixed: only the leader who disbanded a guild may found its name again", () => {
    const s = scene();
    const { a, b } = s.full();
    s.world.containers.set("The Knights's Guild Vault", ["Gold Crown"]);
    s.open(a);
    guildAction(s.world, a, "disband", "Knights", undefined);
    // A stranger, and a former member, get the taken alert and nothing of the old guild's.
    for (const p of [s.join("Dave", 2, 2), b]) {
      s.open(p);
      const out = guildCreate(s.world, p, "knights", "N", guildDeps);
      expect(of(out, p.name, "alert")).toEqual([
        { t: "alert", text: "This guild name is already taken!" },
      ]);
      expect(p.guild).toBe("");
      expect(mayUseContainer(p, "The Knights's Guild Vault")).toBe(false);
      expect(turnKey("Guild Key", "The Knights's Door", p.name, p.guild).kind).not.toBe("turn");
      expect(headDrop("Hall of the Knights", p.name, p.guild)).toBe(1);
      guildClose(p);
    }
    expect(s.world.guilds.get("knights")?.disbanded).toBe(true);
    // The old leader takes the name back, with its vault, door and hall.
    s.open(a);
    guildCreate(s.world, a, "knights", "N", guildDeps);
    expect(a.guild).toBe("knights");
    expect(mayUseContainer(a, "The Knights's Guild Vault")).toBe(true);
    expect(s.world.containers.get("The Knights's Guild Vault")).toEqual(["Gold Crown"]);
    expect(turnKey("Guild Key", "The Knights's Door", a.name, a.guild).kind).toBe("turn");
    expect(headDrop("Hall of the Knights", a.name, a.guild)).toBe(0);
  });
});
