/**
 * Who may speak, and when: mutes, the prisoner's limits and the cooldowns, checked in one place for
 * every way a player talks.
 *
 * A muted player says nothing anywhere, staff chat included; a prisoner is heard only on their own
 * map (local chat and `/me`), though a jailed staff member keeps staff chat. Either may still send
 * an IM to staff, to ask why. A role may skip the chat and broadcast
 * cooldowns (`bypassChatCooldown`, `bypassBroadcastCooldown`).
 */
import { can, endIso, isStaff, MODERATION_TEXT } from "@secondstaronline/shared";

import type { Player } from "../world/world.ts";

/** The ways a player talks. Broadcasts keep 1.6's own jail refusal (`CHAT_TEXT.jailShout`). */
export type SpeechChannel =
  | "say"
  | "emote"
  | "broadcast"
  | "im"
  | "room"
  | "guild"
  | "mail"
  | "board"
  | "staff";

/** Why `p` is silenced on `channel`, with the chat log's outcome, or null. */
export function silenced(
  p: Player,
  channel: SpeechChannel,
  to?: Player | null,
): { text: string; outcome: "muted" | "jail" } | null {
  if (channel === "im" && to && isStaff(to.role)) {
    return null;
  }
  if (p.muteUntil !== null) {
    return { text: MODERATION_TEXT.youAreMuted(endIso(p.muteUntil)), outcome: "muted" };
  }
  const local = channel === "say" || channel === "emote" || channel === "broadcast";
  // Staff chat reaches only staff, like an IM to staff, so the jail leaves it.
  if (p.jailUntil !== null && !local && channel !== "staff") {
    return { text: MODERATION_TEXT.prisonerSilenced, outcome: "jail" };
  }
  return null;
}

/** The chat cooldown frames `p` still waits: 0 for a role that skips it. */
export function chatWait(p: Player): number {
  return can(p.role, "bypassChatCooldown") ? 0 : p.chatIn;
}

/** The broadcast cooldown frames `p` still waits: 0 for a role that skips it. */
export function broadcastWait(p: Player): number {
  return can(p.role, "bypassBroadcastCooldown") ? 0 : p.broadcastIn;
}
