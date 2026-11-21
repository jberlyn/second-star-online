/**
 * Buddies and the Friends window on the server.
 *
 * 1.6's client kept the list and the window; the server keeps both (the list per account) and
 * pushes the window's lines whenever they change:
 * - at game entry, from everyone online (frame 50's `getusers`), and again at Return To Game
 *   (re-enters frame 50); 1.6 also opened the window there, SSO never does;
 * - at a buddy's logon and logoff (`934`/`935`), always pushed live while chat logon/logoff lines
 *   follow each player's own preference;
 * - after `/friends add` when the name is online (1.6 asked the other client, which answered; the
 *   name is appended in the server's spelling, with no test) and after a removal. A dead player is
 *   no different: 1.6's dead-player gate never closed (nothing set the flag to 1).
 */
import {
  buddyAdd,
  buddyRemove,
  CHAT_COLOR,
  type FriendsCommand,
  friendsAtEntry,
  friendsDelete,
  friendsLogoff,
  friendsLogon,
} from "@secondstaronline/shared";

import type { Outgoing, Player, World } from "../world/world.ts";
import { onlineNamed, whoNames } from "./presence.ts";

const tell = (p: Player, text: string): Outgoing => ({
  to: p.id,
  msg: { t: "chat", text, color: CHAT_COLOR.normal },
});

/** The window's lines for `p`. */
export function friendsOut(p: Player): Outgoing {
  return { to: p.id, msg: { t: "friends", names: [...p.friends] } };
}

/**
 * Frame 50: the window is emptied and filled from everyone online, `p` included. 1.6 also opened
 * it; SSO leaves that to Open Friend's List.
 */
export function friendsEntry(world: World, p: Player): Outgoing[] {
  p.friends = friendsAtEntry(p.buddies, whoNames(world));
  return [friendsOut(p)];
}

/** `p` logged on (`on`) or off: every other player's window that lists buddies. */
export function friendsPresence(world: World, p: Player, on: boolean): Outgoing[] {
  const out: Outgoing[] = [];
  for (const o of world.players.values()) {
    if (o === p) {
      continue;
    }
    const next = on
      ? friendsLogon(o.friends, o.buddies, p.name)
      : friendsLogoff(o.friends, o.buddies, p.name);
    if (next.length !== o.friends.length || next.some((n, i) => n !== o.friends[i])) {
      o.friends = next;
      out.push(friendsOut(o));
    }
  }
  return out;
}

/** The account's list changed: every online character of it takes it, and it is written. */
function setBuddies(
  world: World,
  p: Player,
  items: readonly string[],
  save: (accountId: string, items: readonly string[]) => void,
): void {
  for (const o of world.players.values()) {
    if (o.accountId === p.accountId) {
      o.buddies = [...items];
    }
  }
  save(p.accountId, items);
}

/**
 * `/friends add|remove` and the Friends window's Remove (which removes the selected line). A
 * malformed line does nothing.
 */
export function friendsCommand(
  world: World,
  p: Player,
  cmd: FriendsCommand,
  save: (accountId: string, items: readonly string[]) => void,
): Outgoing[] {
  if (!cmd) {
    return [];
  }
  if (cmd.kind === "add") {
    const r = buddyAdd(p.buddies, cmd.name);
    if (!r.ask) {
      return [tell(p, r.line)];
    }
    setBuddies(world, p, r.items, save);
    const out = [tell(p, r.line)];
    // 1.6 asked the named client whether it was online; its answer appended the sender's own name
    // to the window unconditionally. Offline: an SMUS error, ignored.
    const target = onlineNamed(world, cmd.name);
    if (target) {
      p.friends = [...p.friends, target.name];
      out.push(friendsOut(p));
    }
    return out;
  }
  const r = buddyRemove(p.buddies, cmd.name);
  if (!r.removed) {
    return [tell(p, r.line)];
  }
  setBuddies(world, p, r.items, save);
  p.friends = friendsDelete(p.friends, cmd.name);
  return [tell(p, r.line), friendsOut(p)];
}
