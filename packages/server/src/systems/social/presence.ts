/**
 * Presence and the who list.
 *
 * - Logon/logoff: the 1.6 server sent `934`/`935 <name>` to `@AllUsers`; clients only updated an
 *   open Friends window and printed nothing. SSO sends `presence` events to everyone else behind
 *   `announcePresence`, and optionally prints chat lines (`presenceChatLines`). They fire whenever
 *   a player enters or leaves the world, a reconnect included, as a dropped SMUS connection was a
 *   logoff.
 * - Who: everyone in the world, in logon order (`system.group.getusers @AllUsers`).
 * - The Friends window follows the same events (`friendsPresence`), so with `announcePresence` off
 *   it is filled only at game entry.
 */
import { CHAT_COLOR, lingoEq, presenceLine } from "@secondstaronline/shared";

import type { Outgoing, Player, World } from "../world/world.ts";
import { friendsPresence } from "./friends.ts";

export interface PresenceDeps {
  announcePresence: boolean;
  presenceChatLines: boolean;
}

/** Tells everyone except `p` that it logged on (`on`) or off. */
export function presenceOut(world: World, p: Player, on: boolean, deps: PresenceDeps): Outgoing[] {
  if (!deps.announcePresence) {
    return [];
  }
  const out: Outgoing[] = [];
  for (const o of world.players.values()) {
    if (o === p) {
      continue;
    }
    out.push({ to: o.id, msg: { t: "presence", on, name: p.name } });
    if (deps.presenceChatLines) {
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
