/**
 * The player hub on the server (issue #26): the Characters page's search and one character's hub.
 *
 * - **Live or saved:** an online character is read from the world, since what is saved can be up
 *   to a save interval behind; an offline one from the database. Both build the same
 *   `CharacterSheet`, so the page never shows where it came from.
 * - **Gated:** the hub needs `characterView`. The chat log in it needs `chatlog` and the addresses
 *   `banip`, as their commands do. Every hub read is audited, as `/chatlog` is.
 * - **Moderation:** the hub's buttons run the chat commands' own code (`moderate` in
 *   commands.ts), so they make the same checks and write the same logs.
 *
 * I/O goes through `HubDeps`, wired in game.ts.
 */
import {
  type AddressSeen,
  type Bag,
  type CharacterEditRow,
  type CharacterHub,
  type CharacterListRow,
  type CharacterSheet,
  type ChatLogRow,
  can,
  EQUIP_FIELD,
  EQUIP_SLOTS,
  type Equipment,
  HUB_CHAT_LINES,
  HUB_HISTORY,
  type HubIpBan,
  type HubPresence,
  type IpBanRecord,
  isActive,
  type ModerationLogRow,
  type ModerationRecord,
  type Role,
} from "@secondstaronline/shared";

import { savedGold } from "../casino/blackjack.ts";
import type { Player, World } from "../world/world.ts";

/** One search result, with the account's role id (the caller names it). */
export interface CharacterMatch {
  id: string;
  name: string;
  level: number;
  classCode: number;
  roleId: string | null;
  updatedAt: string;
}

/** The saved character row the hub reads (persistence/characters.ts `CharacterRecord`). */
export interface StoredRecord {
  id: string;
  name: string;
  sex: number;
  head: number;
  classCode: number;
  vitals: {
    level: number;
    hp: number;
    hpMax: number;
    sp: number;
    spMax: number;
    exp: number;
    expNeeded: number;
  };
  stats: CharacterSheet["stats"];
  hunger: number;
  position: { mapId: string; x: number; y: number; facing: string };
  respawn: { mapId: string; x: number; y: number } | null;
  faction: { id: number; count: number };
  wanted: boolean;
  vehicle: string | null;
}

/** Everything saved about a character that the hub shows. */
export interface StoredCharacter {
  record: StoredRecord;
  /** The saved map's name, or the id when that map is gone. */
  mapName: string;
  /** The respawn map's name (the id when it is gone), or null. */
  respawnMapName: string | null;
  skills: number[];
  inventory: { gold: number; bag: Bag; equip: Equipment };
  bank: number | null;
  vault: string[];
  spellbook: string[];
  updatedAt: string;
  accountCreated: string;
}

export interface HubDeps {
  /** A character by name ignoring case, with its account and role; null when there is none. */
  findCharacter(name: string): {
    characterId: string;
    accountId: string;
    name: string;
    role: Role;
  } | null;
  search(query: string): CharacterMatch[];
  /** A role id's display name (null for none or one that was deleted). */
  roleName(roleId: string | null): string | null;
  stored(characterId: string): StoredCharacter | null;
  times(characterId: string): { updatedAt: string; accountCreated: string };
  /** The character editor's newest log rows for them, newest first. */
  edits(characterId: string): CharacterEditRow[];
  accountBan(accountId: string): ModerationRecord | null;
  jail(characterId: string): ModerationRecord | null;
  mute(accountId: string): ModerationRecord | null;
  history(accountId: string, limit: number): ModerationLogRow[];
  chatLog(name: string, limit: number): ChatLogRow[];
  addresses(accountId: string): AddressSeen[];
  /** The IP ban on an address key, lapsed or not; null when there is none. */
  ipBan(key: string): IpBanRecord | null;
  /** A map's name by id, or the id when that map is gone. */
  mapName(mapId: string): string;
  now(): string;
}

/**
 * The Characters page's results: an online character's level and class are read from the world,
 * as their hub is, since the save can be behind.
 */
export function searchRows(world: World, query: string, deps: HubDeps): CharacterListRow[] {
  return deps.search(query).map((m) => {
    const p = world.players.get(m.id);
    return {
      name: m.name,
      level: p?.char.vitals.level ?? m.level,
      classCode: p?.char.classCode ?? m.classCode,
      role: deps.roleName(m.roleId),
      online: p !== undefined,
      lastSaved: m.updatedAt,
    };
  });
}

/** The houses `characterId` owns, in the order they were built. */
export function housesOf(world: World, characterId: string): CharacterSheet["houses"] {
  return [...world.houses.values()]
    .filter((h) => h.ownerId === characterId)
    .map((h) => ({ map: h.map, interior: h.interior }));
}

/** The five stats. */
const statsOf5 = (s: CharacterSheet["stats"]): CharacterSheet["stats"] => ({
  str: s.str,
  sta: s.sta,
  dex: s.dex,
  int: s.int,
  wis: s.wis,
});

const equipOf = (equip: Record<string, string>): Record<string, string> =>
  Object.fromEntries(EQUIP_SLOTS.map((s) => [EQUIP_FIELD[s], equip[EQUIP_FIELD[s]] ?? ""]));

/**
 * An online character's sheet, from the world. `mapName` names the respawn point's map, which is
 * kept by id (the id itself when that map is gone).
 */
export function liveSheet(
  world: World,
  p: Player,
  mapName: (mapId: string) => string,
): CharacterSheet {
  const c = p.char;
  return {
    name: p.name,
    sex: c.sex,
    head: p.head,
    classCode: c.classCode,
    level: c.vitals.level,
    exp: c.vitals.exp,
    expNeeded: c.vitals.expNeeded,
    hp: c.vitals.hp,
    hpMax: c.vitals.hpMax,
    sp: c.vitals.sp,
    spMax: c.vitals.spMax,
    stats: statsOf5(c.stats),
    skills: [...c.skills],
    hunger: c.hunger,
    faction: c.faction.id,
    factionCount: c.factionCount,
    wanted: c.wanted,
    position: { map: p.map.name, x: p.x, y: p.y, facing: p.facing },
    respawn: c.respawn ? { map: mapName(c.respawn.mapId), x: c.respawn.x, y: c.respawn.y } : null,
    vehicle: p.vehicle,
    // The purse as it is saved, with a blackjack stake held at the table, so the gold does not
    // jump when the player drops mid-hand and is read from the database.
    gold: savedGold(world, p),
    bank: c.bank,
    bag: c.bag.map((l) => (l ? { item: l.item, qty: l.qty } : null)),
    equip: equipOf({ ...c.equip }),
    vault: [...c.vault],
    spellbook: [...p.spell.book],
    houses: housesOf(world, p.id),
  };
}

/** An offline character's sheet, from what was saved. */
export function storedSheet(world: World, s: StoredCharacter): CharacterSheet {
  const r = s.record;
  return {
    name: r.name,
    sex: r.sex,
    head: r.head,
    classCode: r.classCode,
    level: r.vitals.level,
    exp: r.vitals.exp,
    expNeeded: r.vitals.expNeeded,
    hp: r.vitals.hp,
    hpMax: r.vitals.hpMax,
    sp: r.vitals.sp,
    spMax: r.vitals.spMax,
    stats: statsOf5(r.stats),
    skills: [...s.skills],
    hunger: r.hunger,
    faction: r.faction.id,
    factionCount: r.faction.count,
    wanted: r.wanted,
    position: { map: s.mapName, x: r.position.x, y: r.position.y, facing: r.position.facing },
    respawn:
      r.respawn && s.respawnMapName !== null
        ? { map: s.respawnMapName, x: r.respawn.x, y: r.respawn.y }
        : null,
    vehicle: r.vehicle,
    gold: s.inventory.gold,
    bank: s.bank,
    bag: s.inventory.bag.map((l) => (l ? { item: l.item, qty: l.qty } : null)),
    equip: equipOf({ ...s.inventory.equip }),
    vault: [...s.vault],
    spellbook: [...s.spellbook],
    houses: housesOf(world, r.id),
  };
}

/**
 * The IP bans in force on the addresses an account played from, one per banned key (an IPv6
 * address bans its /64, so two addresses can share one). A ban made by address alone has no row
 * in the account's history, so this is the only place the hub shows it.
 */
function ipBansOn(addresses: readonly AddressSeen[], deps: HubDeps, now: string): HubIpBan[] {
  const seen = new Set<string>();
  const out: HubIpBan[] = [];
  for (const a of addresses) {
    if (seen.has(a.key)) {
      continue;
    }
    seen.add(a.key);
    const b = deps.ipBan(a.key);
    if (b && isActive(b, now)) {
      out.push({
        address: b.address,
        actorName: b.actorName,
        actorRole: b.actorRole,
        reason: b.reason,
        createdAt: b.createdAt,
        expiresAt: b.expiresAt,
      });
    }
  }
  return out;
}

function presenceOf(p: Player | undefined): HubPresence {
  if (!p) {
    return "offline";
  }
  return p.editing ? "editing" : "playing";
}

/**
 * One character's hub for `viewer`, or null when no character has that name. The chat log and
 * addresses are left out for a role without `chatlog` or `banip`.
 */
export function characterHub(
  world: World,
  viewer: Player,
  name: string,
  deps: HubDeps,
): CharacterHub | null {
  const c = deps.findCharacter(name.trim());
  if (!c) {
    return null;
  }
  const p = world.players.get(c.characterId);
  let sheet: CharacterSheet;
  let times: { updatedAt: string; accountCreated: string };
  if (p) {
    sheet = liveSheet(world, p, deps.mapName);
    times = deps.times(c.characterId);
  } else {
    const stored = deps.stored(c.characterId);
    if (!stored) {
      return null;
    }
    sheet = storedSheet(world, stored);
    times = stored;
  }
  const now = deps.now();
  const live = (r: ModerationRecord | null) => (isActive(r, now) ? r : null);
  // Addresses are `/banip`'s, as on `/banlist`: without it an IP ban shows as made, not where.
  const seesAddresses = can(viewer.role, "banip");
  const addresses = seesAddresses ? deps.addresses(c.accountId) : [];
  return {
    name: c.name,
    role: c.role?.name ?? null,
    created: times.accountCreated,
    lastSaved: times.updatedAt,
    presence: presenceOf(p),
    sheet,
    ban: live(deps.accountBan(c.accountId)),
    jail: live(deps.jail(c.characterId)),
    mute: live(deps.mute(c.accountId)),
    edits: deps.edits(c.characterId),
    history: deps
      .history(c.accountId, HUB_HISTORY)
      .map((r) => (seesAddresses ? r : { ...r, address: null })),
    ...(can(viewer.role, "chatlog") ? { chat: deps.chatLog(c.name, HUB_CHAT_LINES) } : {}),
    ...(seesAddresses
      ? {
          addresses,
          ipBans: ipBansOn(addresses, deps, now),
          bypassesIpBans: can(c.role, "bypassIpBan"),
        }
      : {}),
  };
}
