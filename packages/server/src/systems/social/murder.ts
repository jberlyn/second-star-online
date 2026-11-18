/**
 * The murder flag and pardons.
 *
 * In 1.6 the victim's client sent `IWMD` to the player who last hit it after its death lock, and
 * the killer's client set its murder flag and printed the line. SSO does both on the server,
 * crediting the player by id: a monster never flags, and a player named like a monster flags like
 * anyone. The credit is whoever last hit, if that hit landed within `KILL_CREDIT_TICKS` of the death
 * (a bug fixed: 1.6 credited the last hit however long ago). An arena death never reaches here, and
 * a death while a Lightning Assassin's game runs flags no one: its deaths carry no penalties (a bug
 * fixed: 1.6 still flagged the killer).
 */
import { CHAT_COLOR, pardonedLine, wantedLine } from "@secondstaronline/shared";

import type { Outgoing, Player, World } from "../world/world.ts";
import { lightningOn } from "./assassin.ts";

/**
 * `IWMD` at the end of `p`'s death lock: an unflagged victim (`gnL = 0`) flags the player who
 * last hit it, unless that is itself or a Lightning game is running. Killing a wanted player is free
 * (kept on purpose: the flag marks murderers, and hunting one is not murder). The line goes out
 * on every flagging, even to a killer already wanted. A killer who is no longer online is not
 * flagged: 1.6's message to an absent name was lost.
 */
export function flagKiller(world: World, p: Player): { out: Outgoing[]; killer: Player | null } {
  const id = p.lastToHitId;
  if (p.char.wanted || id === null || id === p.id || lightningOn(world)) {
    return { out: [], killer: null };
  }
  const killer = world.players.get(id);
  if (!killer) {
    return { out: [], killer: null };
  }
  killer.char.wanted = true;
  return {
    out: [
      { to: killer.id, msg: { t: "chat", text: wantedLine(p.name), color: CHAT_COLOR.normal } },
    ],
    killer,
  };
}

/** `PRDN`: the flag clears and the target is told who pardoned it. */
export function pardon(target: Player, by: string): Outgoing[] {
  target.char.wanted = false;
  return [{ to: target.id, msg: { t: "chat", text: pardonedLine(by), color: CHAT_COLOR.normal } }];
}
