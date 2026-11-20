/**
 * Operator tool v0: `/spawn <1-4>` puts the slot's roster species on the tile the operator faces,
 * now. NPCs spawn at 1/30 of a monster's rate (`random(60) <= 2`), so a shopkeeper set with
 * `/roster` takes about 10 minutes alone on the map to appear; this places it at once and where the
 * operator wants it. Not a 1.6 command; for anyone without the permission it is an unknown command.
 */
import {
  CHAT_COLOR,
  FACING_DELTA,
  MAP_HEIGHT,
  MAP_WIDTH,
  type Rng,
} from "@secondstaronline/shared";

import { monsterView } from "../monsters/slots.ts";
import { placeMonster } from "../monsters/spawn.ts";
import type { Outgoing, Player, World, WorldMap } from "../world/world.ts";

export const SPAWN_TEXT = {
  usage: "Usage: /spawn <1-4>",
  empty: (slot: number) => `Roster slot ${slot} is empty.`,
  live: (slot: number, name: string) => `Roster slot ${slot} already has a ${name}.`,
  offMap: "You must face a tile on the map.",
  spawned: (slot: number, name: string) =>
    `Spawned ${/^[aeiou]/i.test(name) ? "an" : "a"} ${name} in roster slot ${slot}.`,
} as const;

export function handleSpawn(
  world: World,
  p: Player,
  args: string,
  rng: Rng,
): { out: Outgoing[]; changed: WorldMap | null } {
  const tell = (text: string): Outgoing => ({
    to: p.id,
    msg: { t: "chat", text, color: CHAT_COLOR.normal },
  });
  const m = /^([1-4])$/.exec(args);
  const slot = m ? p.map.slots[Number(m[1]) - 1] : undefined;
  if (!slot) {
    return { out: [tell(SPAWN_TEXT.usage)], changed: null };
  }
  if (!slot.species) {
    return { out: [tell(SPAWN_TEXT.empty(slot.slot))], changed: null };
  }
  if (slot.live) {
    return { out: [tell(SPAWN_TEXT.live(slot.slot, slot.live.name))], changed: null };
  }
  const [dx, dy] = FACING_DELTA[p.facing];
  const x = p.x + dx;
  const y = p.y + dy;
  if (x < 1 || x > MAP_WIDTH || y < 1 || y > MAP_HEIGHT) {
    return { out: [tell(SPAWN_TEXT.offMap)], changed: null };
  }
  slot.live = placeMonster(slot.species, x, y, rng);
  slot.pause = 30;
  slot.dirty = true;
  const out: Outgoing[] = (world.rooms.get(p.map.name)?.players ?? []).map((o) => ({
    to: o.id,
    msg: { t: "delta", events: [{ e: "mspawn", monster: monsterView(slot) }] },
  }));
  out.push(tell(SPAWN_TEXT.spawned(slot.slot, slot.live.name)));
  return { out, changed: p.map };
}
