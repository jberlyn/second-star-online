/**
 * Operator tools v0: chat commands that set a map's four roster slots, so a server has monsters
 * before the monster editor exists. In 1.6 a GM placed up to four monsters in the World Editor and
 * its save wrote the roster; there was no chat command. The `roster` permission only.
 *
 * - `/roster` lists the four slots of your map.
 * - `/roster <1-4> <species>` puts a species in a slot (any `mlists` name, case ignored); species
 *   with no body art are refused.
 * - `/roster <1-4> clear` empties a slot.
 *
 * Changing a slot removes the monster living in it.
 */
import { CHAT_COLOR, type DeltaEvent } from "@secondstaronline/shared";

import { species } from "../monsters/slots.ts";
import type { Outgoing, Player, World, WorldMap } from "../world/world.ts";

export const ROSTER_TEXT = {
  usage: "Usage: /roster, /roster <1-4> <monster>, /roster <1-4> clear",
  unknown: (name: string) => `There is no monster called ${name}.`,
  noArt: (name: string) => `${name} has no artwork and cannot be placed.`,
  set: (slot: number, name: string) => `Roster slot ${slot} is now ${name}.`,
  cleared: (slot: number) => `Roster slot ${slot} is now empty.`,
} as const;

export function rosterLine(map: WorldMap): string {
  const parts = map.slots.map((s) => `${s.slot} ${s.species ?? "(empty)"}`);
  return `Roster of ${map.name}: ${parts.join(", ")}`;
}

export interface RosterResult {
  out: Outgoing[];
  /** The map whose slots changed (to save), or null. */
  changed: WorldMap | null;
}

/** Handles `/roster …` from a role with `roster`. */
export function handleRoster(world: World, p: Player, args: string): RosterResult {
  const map = p.map;
  const tell = (text: string): Outgoing => ({
    to: p.id,
    msg: { t: "chat", text, color: CHAT_COLOR.normal },
  });
  if (args === "") {
    return { out: [tell(rosterLine(map))], changed: null };
  }
  const m = /^([1-4])\s+(.+)$/.exec(args);
  if (!m) {
    return { out: [tell(ROSTER_TEXT.usage)], changed: null };
  }
  const n = Number(m[1]);
  const want = (m[2] as string).trim();
  const slot = map.slots[n - 1];
  if (!slot) {
    return { out: [tell(ROSTER_TEXT.usage)], changed: null };
  }
  let name: string | null = null;
  if (want.toLowerCase() !== "clear") {
    const sp = species(want);
    if (!sp) {
      return { out: [tell(ROSTER_TEXT.unknown(want))], changed: null };
    }
    if (!sp.bodyInMainChars) {
      return { out: [tell(ROSTER_TEXT.noArt(sp.name))], changed: null };
    }
    name = sp.name;
  }
  const out: Outgoing[] = [];
  if (slot.live) {
    slot.live = null;
    const ev: DeltaEvent = { e: "mgone", slot: n };
    for (const o of world.rooms.get(map.name)?.players ?? []) {
      out.push({ to: o.id, msg: { t: "delta", events: [ev] } });
    }
  }
  slot.species = name;
  slot.home = null; // no editor tile
  slot.pause = 0;
  slot.dirty = true;
  out.push(tell(name ? ROSTER_TEXT.set(n, name) : ROSTER_TEXT.cleared(n)));
  return { out, changed: map };
}
