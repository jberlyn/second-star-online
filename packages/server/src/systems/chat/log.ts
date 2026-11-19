/**
 * The chat log's write side: each system that carries a player's words appends one entry per line
 * to `world.chatLog`, delivered or not, at the point it decides what becomes of the line. The game
 * stamps the time and writes the buffer to `chat_log` once a tick (persistence/chatlog.ts), so a
 * line costs the tick no SQL. Rules: shared/rules/admin/chatlog.ts.
 */
import type { ChatChannel, ChatOutcome } from "@secondstaronline/shared";

import type { Outgoing, Player, World } from "../world/world.ts";

export function logChat(
  world: World,
  p: Player,
  channel: ChatChannel,
  text: string,
  outcome: ChatOutcome,
  target: string | null = null,
  counts: { heard?: number; ignored?: number; muffled?: number } = {},
): void {
  world.chatLog.push({
    channel,
    accountId: p.accountId,
    characterId: p.id,
    sender: p.name,
    target,
    text,
    outcome,
    ...counts,
  });
}

/**
 * The counts for a line said to many (say, `/me`, broadcast): of the others in `audience`, how many
 * read `text`, how many ignore the speaker and how many got something else (the muffled line).
 */
export function audienceCounts(
  p: Player,
  audience: readonly Player[],
  out: readonly Outgoing[],
  text: string,
): { heard: number; ignored: number; muffled: number } {
  const got = new Map<string, string>();
  for (const o of out) {
    if (o.msg.t === "chat") {
      got.set(o.to, o.msg.text);
    }
  }
  let heard = 0;
  let ignored = 0;
  let muffled = 0;
  for (const o of audience) {
    if (o === p) {
      continue;
    }
    const t = got.get(o.id);
    if (t === undefined) {
      ignored++;
    } else if (t === text) {
      heard++;
    } else {
      muffled++;
    }
  }
  return { heard, ignored, muffled };
}
