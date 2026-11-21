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
  IGNORE_ADD_MAX,
  ignoreAdd,
  ignoreListLines,
  ignoreRemove,
  ignores,
  stripReturns,
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

function applyIgnoreChange(
  world: World,
  p: Player,
  next: readonly string[],
  save: (accountId: string, list: readonly string[]) => void,
): { changed: boolean; out: Outgoing[] } {
  const changed = next.length !== p.ignore.length || next.some((e, i) => e !== p.ignore[i]);
  if (!changed) {
    return { changed: false, out: [] };
  }
  const out: Outgoing[] = [];
  for (const o of world.players.values()) {
    if (o.accountId === p.accountId) {
      o.ignore = [...next];
      out.push({ to: o.id, msg: { t: "ignores", list: [...next] } });
    }
  }
  save(p.accountId, next);
  return { changed: true, out };
}

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
  const { out } = applyIgnoreChange(world, p, r.list, save);
  return [...out, tell(p, r.line)];
}

/**
 * Settings → Social & privacy → Ignore list: adds or removes one entry, returning the updated
 * list and status line without printing to chat.
 */
export function ignoreModify(
  world: World,
  p: Player,
  kind: "add" | "remove",
  name: string,
  save: (accountId: string, list: readonly string[]) => void,
): Outgoing[] {
  let target = name;
  if (kind === "add") {
    target = stripReturns(name).trim();
    if (target === "") {
      return [
        {
          to: p.id,
          msg: { t: "ignores", list: [...p.ignore], ok: false, text: "Enter a player name." },
        },
      ];
    }
    if (target.length > IGNORE_ADD_MAX) {
      return [
        {
          to: p.id,
          msg: {
            t: "ignores",
            list: [...p.ignore],
            ok: false,
            text: `Names can be at most ${IGNORE_ADD_MAX} characters.`,
          },
        },
      ];
    }
  }
  const r = kind === "add" ? ignoreAdd(p.ignore, target) : ignoreRemove(p.ignore, target);
  const { changed, out } = applyIgnoreChange(world, p, r.list, save);
  const others = out.filter((o) => o.to !== p.id);
  return [
    ...others,
    { to: p.id, msg: { t: "ignores", list: [...r.list], ok: changed, text: r.line } },
  ];
}
