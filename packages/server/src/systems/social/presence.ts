/**
 * Presence and the who list.
 *
 * - Logon/logoff: the 1.6 server sent `934`/`935 <name>` to `@AllUsers`; clients only updated an
 *   open Friends window and printed nothing. SSO always sends `presence` events and updates each
 *   player's Friends window, and prints chat lines according to each recipient's own
 *   `presenceChatLines` setting (`"off"`, `"friends"`, or `"everyone"`, default `"off"`). They
 *   fire whenever a player enters or leaves the world, a reconnect included, as a dropped SMUS
 *   connection was a logoff.
 * - Who: everyone in the world, in logon order (`system.group.getusers @AllUsers`).
 */
import { CHAT_COLOR, isBuddy, lingoEq, presenceLine } from "@secondstaronline/shared";

import type { Outgoing, Player, World } from "../world/world.ts";
import { friendsPresence } from "./friends.ts";

/** Tells everyone except `p` that it logged on (`on`) or off. */
export function presenceOut(world: World, p: Player, on: boolean): Outgoing[] {
  const out: Outgoing[] = [];
  for (const o of world.players.values()) {
    if (o === p) {
      continue;
    }
    out.push({ to: o.id, msg: { t: "presence", on, name: p.name } });
    const mode = o.prefs.presenceChatLines;
    if (mode === "everyone" || (mode === "friends" && isBuddy(o.buddies, p.name))) {
      out.push({
        to: o.id,
        msg: { t: "chat", text: presenceLine(p.name, on), color: CHAT_COLOR.normal },
      });
    }
  }
  out.push(...friendsPresence(world, p, on));
  return out;
}

/** The online player a P2P message to `name` reaches, ignoring case (as `/msg`). */
export function onlineNamed(world: World, name: string): Player | null {
  for (const o of world.players.values()) {
    if (lingoEq(o.name, name)) {
      return o;
    }
  }
  return null;
}

/** Names of everyone in the world, in logon order (`World.players` keeps insertion order). */
export function whoNames(world: World): string[] {
  return [...world.players.values()].map((p) => p.name);
}
