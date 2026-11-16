/**
 * Ignore on the server.
 *
 * 1.6's client dropped a `sqa` or broadcast whose sender was among the first 50 entries, and an IM
 * whose sender was among the first 40, so ignoring a player hid what their own client sent: their say,
 * `/me`, admin `-` lines, broadcasts, IMs, the `aqs` replies it relayed (quest slots 2-4, rumours,
 * faction leaders, its shop's stock list) and its other `sqa` lines (the Overlord kill line, Radar
 * and Inxition read-outs, the faction join announcement). The server applies the same test per
 * reader at each of those deliveries (`hears`), now against every entry on the list. Lines the
 * server says to you are never filtered, so ignoring yourself does nothing. Never filtered: chat
 * rooms, rosters, bios, trades, invitations.
 */
import {
  CHAT_COLOR,
  ignoreAdd,
  ignoreListLines,
  ignoreRemove,
  ignores,
} from "@secondstaronline/shared";

import type { Outgoing, Player, World } from "../world/world.ts";

/** Whether `reader` sees a line `sender`'s client sent. */
export function hears(reader: Player, sender: string): boolean {
  return reader.name === sender || !ignores(reader.ignore, sender);
}

const tell = (p: Player, text: string): Outgoing => ({
  to: p.id,
  msg: { t: "chat", text, color: CHAT_COLOR.normal },
});

/**
 * `/ignore`, `/unignore` and `/ignorelist`. The account's list changes for every character of it
 * online and is written through `save`.
 */
export function ignoreCommand(
  world: World,
  p: Player,
  cmd: { kind: "ignore" | "unignore"; rest: string } | { kind: "ignoreList" },
  save: (accountId: string, list: readonly string[]) => void,
): Outgoing[] {
  if (cmd.kind === "ignoreList") {
    return ignoreListLines(p.ignore).map((t) => tell(p, t));
  }
  const r =
    cmd.kind === "ignore" ? ignoreAdd(p.ignore, cmd.rest) : ignoreRemove(p.ignore, cmd.rest);
  if (r.list.length !== p.ignore.length || r.list.some((e, i) => e !== p.ignore[i])) {
    for (const o of world.players.values()) {
      if (o.accountId === p.accountId) {
        o.ignore = [...r.list];
      }
    }
    save(p.accountId, r.list);
  }
  return [tell(p, r.line)];
}
