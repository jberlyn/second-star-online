/**
 * Factions on the server.
 *
 * 1.6 ran membership, the loyalty count and the joins on the client and only the powers on the
 * server; SSO keeps all of it on the server. 1.6 had one `@Faction` channel for all three factions,
 * which a death exile never left; SSO's faction channel is each faction's online members, so a
 * player hears only its own faction's announcements and stops hearing them the moment the
 * membership ends, however it ends (bugs fixed).
 */
import { socialData } from "@secondstaronline/data";
import {
  CHAT_COLOR,
  type FactionId,
  factionIdOf,
  headTurnIn,
  heardSqa,
  joinFaction,
  joinRefusal,
  leaderFaction,
  lingoContains,
  loyaltyStep,
  NO_FACTION,
  type Powers,
  sayFaction,
  sortFaction,
} from "@secondstaronline/shared";

import { hears } from "../chat/ignore.ts";
import type { Outgoing, Player, World } from "../world/world.ts";

const chat = (to: Player, text: string): Outgoing => ({
  to: to.id,
  msg: { t: "chat", text, color: CHAT_COLOR.normal },
});

/**
 * An `aqs` reply: the asker's client relayed it to its map as `sqa`, so everyone there reads it,
 * muffled at y > 10 in a house, except those whose ignore list holds the asker, the relay's sender.
 */
export function aqsToMap(world: World, asker: Player, text: string): Outgoing[] {
  const room = world.rooms.get(asker.map.name);
  const members = room ? room.players : [asker];
  return members
    .filter((o) => hears(o, asker.name))
    .map((o) => chat(o, heardSqa(text, o.map.name, o.y)));
}

/**
 * A `sqa` to faction `id`'s channel: every online member of that faction, but those ignoring
 * `from`, whose client sent it.
 */
export function toFactionChannel(
  world: World,
  id: FactionId,
  text: string,
  from: string,
): Outgoing[] {
  if (id === 0) {
    return [];
  }
  return [...world.players.values()]
    .filter((o) => o.char.faction.id === id && hears(o, from))
    .map((o) => chat(o, text));
}

/**
 * The faction sort for everyone online after the powers change: in 1.6 a join's faction broadcast
 * had every client ask for the powers again.
 */
export function refreshBonuses(world: World): void {
  for (const o of world.players.values()) {
    o.char.faction = sortFaction(o.char.faction.id, world.factionPowers);
  }
}

/** Sets `p`'s membership and its bonuses from the current powers. */
function setMembership(world: World, p: Player, id: FactionId, count: number): void {
  p.char.faction = id === 0 ? { ...NO_FACTION } : sortFaction(id, world.factionPowers);
  p.char.factionCount = count;
}

/**
 * One frame of 1.6's loyalty countdown while `Fctcnt > 0`. Returns the line to print, if any, and
 * whether the membership ended (to be saved).
 */
export function loyaltyFrame(world: World, p: Player): { line: string | null; kicked: boolean } {
  if (p.char.factionCount <= 0) {
    return { line: null, kicked: false };
  }
  const step = loyaltyStep({ id: p.char.faction.id, count: p.char.factionCount });
  p.char.factionCount = step.count;
  if (step.kicked) {
    setMembership(world, p, 0, 0);
  }
  return { line: step.text, kicked: step.kicked };
}

/**
 * Before a head leaves the bag: a rival head given to a leader whose faction would not take the
 * giver (too weak, or in another faction) is refused with the leader's line, and nothing is taken
 * or moved. 1.6 took the head and moved the power first (a bug fixed). Null when the hand-in goes
 * ahead: not a head for a leader, the leader's own faction's head, or a join that would succeed.
 */
export function headRefusal(world: World, p: Player, npc: string, item: string): Outgoing[] | null {
  const row = leaderFaction(npc);
  if (!row || !lingoContains(item, " Head")) {
    return null;
  }
  const r = headTurnIn(npc, item, world.factionPowers);
  if (r.kind !== "rival" || !r.join) {
    return null;
  }
  const line = joinRefusal(
    { id: p.char.faction.id, count: p.char.factionCount },
    r.leader,
    p.char.vitals.hpMax,
  );
  return line === null ? null : [chat(p, line)];
}

/**
 * The faction branch of the quest hand-in once the head is taken (`headRefusal` has let it
 * through): own head wasted; a rival head said to the map, the power moved, then the join, its
 * announcement to the leader's faction channel, and everyone's bonuses refreshed. Null when `item`
 * is not a head for a leader.
 */
export function giveHead(
  world: World,
  p: Player,
  npc: string,
  item: string,
): { out: Outgoing[]; changed: boolean } | null {
  const r = headTurnIn(npc, item, world.factionPowers);
  if (r.kind === "notHead") {
    return null;
  }
  const out = aqsToMap(world, p, r.line);
  if (r.kind === "own") {
    return { out, changed: false };
  }
  world.factionPowers = r.powers as Powers;
  world.powersDirty = true;
  if (r.join) {
    const j = joinFaction(
      { id: p.char.faction.id, count: p.char.factionCount },
      r.leader,
      p.char.vitals.hpMax,
      p.name,
    );
    out.push(chat(p, j.line));
    setMembership(world, p, factionIdOf(j.membership.id), j.membership.count);
    if (j.announce) {
      out.push(...toFactionChannel(world, r.leader, j.announce, p.name));
    }
  }
  refreshBonuses(world);
  return { out, changed: true };
}

/**
 * Each leader standing in the map's slots, in Angela, Trianus, Corin
 * order, says how its faction stands.
 */
export function askFactionPower(world: World, p: Player): Outgoing[] {
  const room = world.rooms.get(p.map.name);
  if (!room) {
    return [];
  }
  const out: Outgoing[] = [];
  for (const leader of socialData.factions.map((f) => f.leader)) {
    const here = room.map.slots.some((s) => s.live?.name === leader);
    const text = here ? sayFaction(leader, world.factionPowers) : null;
    if (text) {
      out.push(...aqsToMap(world, p, text));
    }
  }
  return out;
}
