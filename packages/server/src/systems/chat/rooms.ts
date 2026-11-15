/**
 * Chat rooms on the server.
 *
 * 1.6's rooms were SMUS groups any client could join; the server now holds who is in which room:
 * Guild Chat for the members of your guild, Admin Chat for immortals. One room at a time; entering
 * another leaves the first; closing the window is the only other way out, and logging off drops
 * you. Lines reach every member, the sender included, never filtered by ignore, and reach the dead.
 */
import {
  CHAT_COLOR,
  CHAT_SOCIAL_TEXT,
  chatRefusal,
  parseRoomLine,
  type RoomKey,
  roomGroup,
  roomTexts,
  stripReturns,
} from "@secondstaronline/shared";

import type { Outgoing, Player, World } from "../world/world.ts";
import { type ImDeps, msgCommand } from "./im.ts";

const tell = (p: Player, text: string): Outgoing => ({
  to: p.id,
  msg: { t: "chat", text, color: CHAT_COLOR.normal },
});

function members(world: World, group: string): Player[] {
  const ids = world.chatRooms.get(group) ?? [];
  return ids.flatMap((id) => {
    const o = world.players.get(id);
    return o ? [o] : [];
  });
}

/**
 * Leaves your room: the others' rosters drop you (`xILoggedOff`). Your window, if any, is the
 * client's.
 */
export function leaveRoom(world: World, p: Player): Outgoing[] {
  const room = p.room;
  if (!room) {
    return [];
  }
  p.room = null;
  const ids = (world.chatRooms.get(room.group) ?? []).filter((id) => id !== p.id);
  if (ids.length === 0) {
    world.chatRooms.delete(room.group);
  } else {
    world.chatRooms.set(room.group, ids);
  }
  return members(world, room.group).map((o) => ({
    to: o.id,
    msg: { t: "roomUser", name: p.name, on: false },
  }));
}

/** Joins `group` and tells the others. */
function joinGroup(world: World, p: Player, key: RoomKey, group: string): Outgoing[] {
  const out = members(world, group).map((o) => ({
    to: o.id,
    msg: { t: "roomUser" as const, name: p.name, on: true },
  }));
  p.room = { key, group };
  world.chatRooms.set(group, [...(world.chatRooms.get(group) ?? []), p.id]);
  return out;
}

/**
 * A Game menu room or Admin Chat (`EnterGeneralChat`, `NewPlayerChat`, `TradingPostChat`,
 * `xxGuildChat`, `EnterAdminChat`): the old room is left first, so Guild Chat with no guild leaves
 * you in no room and prints "You don't belong to a guild!" while the window stays up (a 1.6 bug
 * kept; your later lines go nowhere). Admin Chat from anyone but an immortal is refused before that
 * by the caller (no disconnect).
 */
export function enterRoom(world: World, p: Player, key: RoomKey): Outgoing[] {
  const out = leaveRoom(world, p);
  if (key === "guild" && p.guild === "") {
    out.push(tell(p, CHAT_SOCIAL_TEXT.noGuild));
    return out;
  }
  const group = roomGroup(key, p.guild);
  out.push(...joinGroup(world, p, key, group));
  const { title, entering } = roomTexts(key, p.guild);
  // The `getusers` snapshot replaces the roster, you included.
  const users = members(world, group).map((o) => o.name);
  out.push({ to: p.id, msg: { t: "room", title, entering, users } });
  return out;
}

/** Whether `p` may still be in its room: its guild's, or an immortal's. */
function stillMember(p: Player): boolean {
  const room = p.room;
  if (!room) {
    return true;
  }
  if (room.key === "guild") {
    return p.guild !== "" && roomGroup("guild", p.guild) === room.group;
  }
  if (room.key === "admin") {
    return p.role === "immortal";
  }
  return true;
}

/**
 * Drops anyone who lost a room's membership (exiled, guild disbanded or left, demoted from
 * immortal), at once and silently: the window stays with its text and others' rosters drop them.
 * Run once a tick.
 */
export function roomMembership(world: World): Outgoing[] {
  const out: Outgoing[] = [];
  for (const p of world.players.values()) {
    if (!stillMember(p)) {
      out.push(...leaveRoom(world, p));
    }
  }
  return out;
}

/** A resumed session takes back its room without a new entry line, if it may still be there. */
export function rejoinRoom(
  world: World,
  p: Player,
  room: { key: RoomKey; group: string } | null,
): Outgoing[] {
  if (!room) {
    return [];
  }
  p.room = room;
  if (!stillMember(p)) {
    p.room = null;
    return [];
  }
  p.room = null;
  return joinGroup(world, p, room.key, room.group);
}

/**
 * A line typed into the room's input: `who` and `/msg` as in the main input, with `/msg`'s echo in
 * the main chat; everything else is room text, line breaks in chars 1-200 blanked, sent to every member
 * as `<sender>: <text>`. `/logchat` never reaches the server (the client saves the room log). Out
 * of a room (after the no-guild entry above, or after losing membership) a line goes nowhere.
 */
export function roomSay(
  world: World,
  p: Player,
  raw: string,
  deps: ImDeps,
  who: (p: Player) => Outgoing[],
): Outgoing[] {
  const typed = raw.slice(0, deps.maxChars);
  const line = parseRoomLine(typed);
  if (!line || line.kind === "logchat") {
    return [];
  }
  if (line.kind === "who") {
    return who(p);
  }
  if (line.kind === "msg") {
    return msgCommand(world, p, line.text, typed, deps, { kind: "room" });
  }
  const room = p.room;
  if (!room) {
    return [];
  }
  const refused = chatRefusal(p.chatIn);
  if (refused) {
    return [
      {
        to: p.id,
        msg: { t: "chat", text: refused, color: 0, restore: typed, restoreTo: { kind: "room" } },
      },
    ];
  }
  p.chatIn = deps.chatCooldownFrames;
  const text = CHAT_SOCIAL_TEXT.roomLine(p.name, stripReturns(line.text));
  return members(world, room.group).map((o) => ({ to: o.id, msg: { t: "roomLine", text } }));
}
