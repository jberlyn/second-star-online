/**
 * Guild halls belong to their guild (issue #16).
 *
 * 1.6 tied a hall, its door, its vault and the Guild Key to the guild only by name, and left all of
 * them behind when the guild disbanded, for whoever founded that name next. SSO records each hall's
 * guild by id: the hall stands while any member is seen, and goes with the guild. The door, vault
 * and board still answer to the guild's name, which is safe because a live guild's name is its own
 * and a disbanded guild leaves nothing that name could find: its halls are demolished and its vault
 * emptied, so the name is free for anyone.
 */
import { lingoEq } from "@secondstaronline/shared";

import { logWorldLines } from "../admin/activity.ts";
import { hallGuild } from "../admin/house-admin.ts";
import { demolish, isHall } from "../housing/houses.ts";
import type { GuildRow, HouseRecord, Outgoing, World, WorldMap } from "../world/world.ts";

/** A guild's Guild Vault, the container every hall of the guild opens. */
export const guildVaultOf = (guild: string): string => `The ${guild}'s Guild Vault`;

export const HALL_TEXT = {
  /** Disband with items in the vault: nothing is lost by a click. */
  emptyVault: "Empty the Guild Vault before you disband the guild.",
  /** The first Disband while the guild has a hall: a second press disbands. */
  warn: (n: number) =>
    `Disbanding the guild demolishes its ${n === 1 ? "hall" : `${n} halls`} and everything inside. Press Disband again to disband it.`,
} as const;

/** The halls of the guild with id `guildId`, in build order. */
export function hallsOf(world: World, guildId: string): HouseRecord[] {
  return [...world.houses.values()].filter((h) => h.guildId === guildId);
}

/**
 * Demolishes halls as decay does: the outdoor exit and tiles go, the interior is deleted once
 * nobody stands in it, and each leaves the house list. A hall whose outdoor map is gone still
 * leaves the records.
 */
export function demolishHalls(
  world: World,
  halls: readonly HouseRecord[],
  loadMap: (name: string) => WorldMap | null,
): Outgoing[] {
  const out: Outgoing[] = [];
  for (const h of halls) {
    out.push(...demolish(world, h.interior, loadMap).out);
    if (world.houses.get(h.interior) === h) {
      world.houses.delete(h.interior);
      world.interiorsToDelete.add(h.interior);
    }
    world.houseList = world.houseList.filter((e) => !lingoEq(e.interior, h.interior));
    world.housesDirty = true;
  }
  return out;
}

/** Empties a guild's vault, logging what it held as destroyed. */
export function emptyGuildVault(world: World, g: GuildRow): void {
  const vault = guildVaultOf(g.name);
  const lines = world.containers.get(vault);
  if (!lines) {
    return;
  }
  logWorldLines(world, "demolish", lines, [], { other: vault, details: { guild: g.name } });
  world.containers.delete(vault);
  world.containersDirty.add(vault);
}

/**
 * What a disband takes with the guild: every hall (and its floor) and the vault. The leader is
 * refused while a hall stands with items in the vault, so the vault's contents are lost only when
 * no hall is left to reach them.
 */
export function endGuild(
  world: World,
  g: GuildRow,
  loadMap: (name: string) => WorldMap | null,
): Outgoing[] {
  const out = demolishHalls(world, hallsOf(world, g.id), loadMap);
  emptyGuildVault(world, g);
  return out;
}

/**
 * At start: every hall names its guild by id, and nothing of a disbanded guild is left. A hall
 * built before halls named their guild is matched by its Guild Vault (or its header); a hall whose
 * guild is gone or disbanded is demolished, and a disbanded guild's vault is emptied. Returns the
 * number of halls demolished.
 */
export function settleHalls(world: World, loadMap: (name: string) => WorldMap | null): number {
  const live = new Map<string, GuildRow>();
  for (const g of world.guilds.values()) {
    if (g.disbanded) {
      emptyGuildVault(world, g);
    } else {
      live.set(g.id, g);
    }
  }
  const gone: HouseRecord[] = [];
  for (const h of world.houses.values()) {
    if (!isHall(h)) {
      continue;
    }
    if (h.guildId !== undefined) {
      if (!live.has(h.guildId)) {
        gone.push(h);
      }
      continue;
    }
    const m = loadMap(h.interior);
    const header = /^Hall of the (.+)$/i.exec(m?.title ?? "")?.[1] ?? null;
    const name = hallGuild(m) ?? header;
    const g = name === null ? undefined : world.guilds.get(name.toLowerCase());
    if (g && !g.disbanded) {
      h.guildId = g.id;
      world.housesDirty = true;
    } else {
      gone.push(h);
    }
  }
  demolishHalls(world, gone, loadMap);
  return gone.length;
}
