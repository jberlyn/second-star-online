/**
 * The player hub's houses (issue #36): an admin lists a character's houses, and revokes or
 * transfers one. 1.6 had nothing like it: staff edited the house files by hand.
 *
 * - **Revoke** is a demolition, the same `demolish` decay runs, and cannot be undone. Anyone inside
 *   is first moved out to the house's door, so the interior is deleted at once.
 * - **Transfer** moves the house whole: the blueprint and list entry, the names the engine gives
 *   the owner's fixtures (the door, the mailbox, the House Vault in the interior, the header and
 *   sign), and every Small Shop in the interior with its stock and till. The old owner's House
 *   Vault stays theirs while they keep another house; otherwise its contents move into the new
 *   owner's, which must have room for them.
 * - **Preview first:** the hub shows what either will destroy or move, and the change is refused
 *   when the house no longer matches what was shown (`expect`).
 *
 * The database writes are game.ts's: it persists the houses, the ground, the containers and the
 * rows `transferHouse` returns, in the intent's transaction.
 */
import {
  countedPile,
  HOUSE_ADMIN_TEXT,
  type HousePreview,
  type HubHouse,
  houseTypeOf,
  isFixtureKind,
  lingoEq,
  withShopOwner,
} from "@secondstaronline/shared";

import type { CasinoDeps } from "../casino/index.ts";
import { containerCapacity } from "../economy/containers.ts";
import type { ShopLedger } from "../economy/shop.ts";
import { houseVaultOf, ownsAHouse } from "../housing/houses.ts";
import { closeMailAt } from "../mail/mail.ts";
import { npcFileNamed, setNpcFile } from "../monsters/npcfiles.ts";
import { warp } from "../world/tick.ts";
import type { GroundItem, HouseRecord, Outgoing, Player, World, WorldMap } from "../world/world.ts";
import { type ActivityFields, diffLines, logWorld } from "./activity.ts";

export interface HouseAdminDeps {
  loadMap(name: string): WorldMap | null;
  /** A shopkeeper's ledger (its till and stock), made from its file on first use. */
  shopLedger(npc: string): ShopLedger | null;
  /** A character's guild, online or saved ("" for none). */
  guildOf(characterId: string): string;
  casino: CasinoDeps;
}

/** A character, as the hub names one. */
export interface HouseParty {
  characterId: string;
  name: string;
}

/** The house `owner` owns, named by its interior (any case), or null. */
export function ownedHouse(world: World, ownerId: string, interior: string): HouseRecord | null {
  for (const h of world.houses.values()) {
    if (h.ownerId === ownerId && lingoEq(h.interior, interior)) {
      return h;
    }
  }
  return null;
}

/** A shopkeeper's till: its ledger's, or its file's before the ledger kept one. */
const tillOf = (world: World, npc: string, ledger: ShopLedger | null): number =>
  ledger?.gold ?? npcFileNamed(world.npcs, npc)?.gold ?? 0;

/** The till and stock of each player shop in `interior`, in the order they were made. */
function shopsIn(world: World, interior: string, deps: HouseAdminDeps): HousePreview["shops"] {
  const out: HousePreview["shops"] = [];
  for (const ps of world.playerShops.values()) {
    if (!lingoEq(ps.interior, interior)) {
      continue;
    }
    const ledger = deps.shopLedger(ps.npc);
    const till = tillOf(world, ps.npc, ledger);
    const stock = (ledger?.lines ?? []).flatMap((l) =>
      l.kind === "SEL" && l.stock ? [{ item: l.item, qty: l.stock }] : [],
    );
    out.push({ npc: ps.npc, stock, till });
  }
  return out;
}

/**
 * The counted items on a map's floor (what demolition logs), summed by what each pile counts as:
 * two `50 Gold` piles are 100 Gold, a `5 Blue Crystal` pile five Blue Crystals.
 */
function floorOf(m: WorldMap | null): { item: string; qty: number }[] {
  const by = new Map<string, { item: string; qty: number }>();
  for (const g of m?.ground ?? []) {
    const c = countedPile(g.item, g.qty ?? 1);
    if (c === null) {
      continue;
    }
    const [name, n] = "gold" in c ? ["Gold", c.gold] : [c.item, c.n];
    const e = by.get(name.toLowerCase()) ?? { item: name, qty: 0 };
    e.qty += n;
    by.set(name.toLowerCase(), e);
  }
  return [...by.values()];
}

/** The online players whose place is the interior: on its map, or in an editor over it. */
function inside(world: World, interior: string): Player[] {
  return [...world.players.values()].filter((p) => lingoEq(p.map.name, interior));
}

/** One house as the hub lists it. */
function hubHouse(world: World, h: HouseRecord, deps: HouseAdminDeps): HubHouse {
  return {
    interior: h.interior,
    map: h.map,
    x: h.item2.x,
    y: h.item2.y,
    type: houseTypeOf(h)?.house ?? null,
    shops: [...world.playerShops.values()]
      .filter((ps) => lingoEq(ps.interior, h.interior))
      .map((ps) => {
        const ledger = deps.shopLedger(ps.npc);
        const sells = (ledger?.lines ?? []).filter((l) => l.kind === "SEL");
        return {
          npc: ps.npc,
          lines: sells.length,
          stock: sells.reduce((n, l) => n + (l.stock ?? 0), 0),
          till: tillOf(world, ps.npc, ledger),
        };
      }),
    vaultItems: (world.containers.get(houseVaultOf(h.ownerName)) ?? []).length,
  };
}

/** The houses `characterId` owns, in the order they were built. */
export function hubHouses(world: World, characterId: string, deps: HouseAdminDeps): HubHouse[] {
  return [...world.houses.values()]
    .filter((h) => h.ownerId === characterId)
    .map((h) => hubHouse(world, h, deps));
}

/** The guild a guild hall's fixtures are named for, or null for a house of a player. */
function hallGuild(m: WorldMap | null): string | null {
  for (const g of m?.ground ?? []) {
    if (isFixtureKind(g.item, "guildVault")) {
      const match = /^The (.+)'s Guild Vault$/i.exec(g.item);
      if (match?.[1]) {
        return match[1];
      }
    }
  }
  return null;
}

/** What a transfer would rename for its new owner (`HousePreview.renames`). */
function renamesOf(rec: HouseRecord, m: WorldMap | null, outdoor: WorldMap | null): string[] {
  const mine = (n: string) => renamed(n, rec.ownerName, "") !== null;
  const has = (map: WorldMap | null, kinds: Parameters<typeof isFixtureKind>[1][]) =>
    (map?.ground ?? []).some((g) => isFixtureKind(g.item, ...kinds) && mine(g.item));
  const box = rec.item1;
  return [
    ...(has(m, ["door", "openedDoor"]) ? ["door"] : []),
    ...(box && isFixtureKind(box.item, "mailbox") && mine(box.item) && outdoor ? ["mailbox"] : []),
    ...(has(m, ["houseVault"]) ? ["House Vault"] : []),
    ...(m && mine(m.title) ? ["header"] : []),
  ];
}

/**
 * A stable token for what a preview shows: equal previews give equal tokens. The interior's map
 * id is part of it, so a house demolished and built again the same at the same place (a new
 * interior row) never matches a preview of the old one.
 */
function tokenOf(p: Omit<HousePreview, "expect">, mapId: string | null): string {
  return Bun.hash(JSON.stringify([p, mapId])).toString(36);
}

export type PreviewResult = { ok: true; preview: HousePreview } | { ok: false; text: string };

/**
 * What revoking `interior`, or transferring it to `to`, would do now. A transfer is refused here,
 * before anything changes: no such character, the owner themselves, a guild hall for someone
 * outside its guild, or a vault merge that would not fit.
 */
export function housePreview(
  world: World,
  owner: HouseParty,
  interior: string,
  action: "revoke" | "transfer",
  to: HouseParty | null,
  deps: HouseAdminDeps,
): PreviewResult {
  const rec = ownedHouse(world, owner.characterId, interior);
  if (!rec) {
    return { ok: false, text: HOUSE_ADMIN_TEXT.noHouse(owner.name) };
  }
  const m = deps.loadMap(rec.interior);
  const outdoor = deps.loadMap(rec.map);
  if (action === "revoke" && !outdoor) {
    // Demolition works on the outdoor map; without it nothing would be demolished.
    return { ok: false, text: HOUSE_ADMIN_TEXT.noMap(rec.map) };
  }
  // The owner's other houses decide the vault: it is one per owner.
  const others = [...world.houses.values()].some(
    (h) => h.ownerId === owner.characterId && h !== rec,
  );
  const vaultName = houseVaultOf(rec.ownerName);
  const vault = { name: vaultName, items: [...(world.containers.get(vaultName) ?? [])] };
  let vaultFate: HousePreview["vaultFate"];
  if (action === "revoke") {
    vaultFate = others ? "kept" : "destroyed";
  } else {
    if (!to) {
      return { ok: false, text: HOUSE_ADMIN_TEXT.noTarget("") };
    }
    if (to.characterId === owner.characterId) {
      return { ok: false, text: HOUSE_ADMIN_TEXT.sameOwner(to.name) };
    }
    // A guild hall can be built only by a member of a guild, and its door and vault answer to
    // that guild: its owner must belong to it.
    const guild = hallGuild(m);
    if (guild !== null && !lingoEq(deps.guildOf(to.characterId), guild)) {
      return { ok: false, text: HOUSE_ADMIN_TEXT.notGuild(to.name, guild) };
    }
    if (others || vault.items.length === 0) {
      vaultFate = "kept";
    } else {
      const theirs = world.containers.get(houseVaultOf(to.name)) ?? [];
      const cap = containerCapacity(houseVaultOf(to.name));
      const n = theirs.length + vault.items.length;
      if (n > cap) {
        return { ok: false, text: HOUSE_ADMIN_TEXT.vaultFull(to.name, n, cap) };
      }
      vaultFate = theirs.length > 0 ? "merged" : "moved";
    }
  }
  const body: Omit<HousePreview, "expect"> = {
    action,
    owner: owner.name,
    house: hubHouse(world, rec, deps),
    ...(to ? { to: to.name } : {}),
    vault,
    vaultFate,
    shops: shopsIn(world, rec.interior, deps),
    floor: floorOf(m),
    inside: inside(world, rec.interior).map((p) => p.name),
    renames: renamesOf(rec, m, outdoor),
    guild: hallGuild(m),
  };
  return { ok: true, preview: { ...body, expect: tokenOf(body, m?.id ?? null) } };
}

/** The log's summary of what a revoke destroyed or a transfer moved. */
export function previewSummary(p: HousePreview): string {
  const where = `${p.house.type ?? "House"} on ${p.house.map} (${p.house.x}, ${p.house.y}), interior ${p.house.interior}`;
  const items = (l: readonly { item: string; qty: number }[]) =>
    l.map((x) => (x.qty === 1 ? x.item : `${x.qty} ${x.item}`)).join(", ") || "nothing";
  const lines = (l: readonly string[]) =>
    items(diffLines([], l).map(([item, qty]) => ({ item, qty })));
  const shops = p.shops.map(
    (s) => `${s.npc}'s stock ${items(s.stock)} and till ${s.till.toLocaleString("en")} gold`,
  );
  if (p.action === "revoke") {
    return [
      `Demolished ${where}.`,
      p.vaultFate === "destroyed"
        ? `House Vault destroyed: ${lines(p.vault.items)}.`
        : "House Vault kept (they own another house).",
      ...(shops.length > 0 ? [`Shops destroyed: ${shops.join("; ")}.`] : []),
      `Floor destroyed: ${items(p.floor)}.`,
    ].join(" ");
  }
  const vault =
    p.vaultFate === "kept"
      ? `House Vault stays ${p.owner}'s.`
      : `House Vault moved to ${p.to}'s${p.vaultFate === "merged" ? " (merged)" : ""}: ${lines(p.vault.items)}.`;
  return [
    `Transferred ${where} from ${p.owner} to ${p.to}.`,
    vault,
    ...(shops.length > 0 ? [`Shops handed over: ${shops.join("; ")}.`] : []),
  ].join(" ");
}

/**
 * Before a revoke: everyone inside goes out to the house's door, as they would walk out, so the
 * interior can be deleted at once. Someone in an editor over it is placed there without leaving
 * the editor.
 */
export function moveOut(
  world: World,
  rec: HouseRecord,
  deps: Pick<HouseAdminDeps, "loadMap" | "casino">,
): Outgoing[] {
  const outdoor = deps.loadMap(rec.map);
  if (!outdoor) {
    return [];
  }
  // The tile below the exit, where taking the interior's exit puts a player.
  const x = rec.item2.x;
  const y = rec.item2.y + 1;
  const out: Outgoing[] = [];
  for (const p of inside(world, rec.interior)) {
    if (p.editing) {
      p.map = outdoor;
      p.x = x;
      p.y = y;
      p.stepFrames = 0;
      continue;
    }
    out.push(...warp(world, p, outdoor, x, y, deps.casino, "houseRevoke"));
  }
  return out;
}

/** What a transfer changed that game.ts writes beside the ground, houses and containers. */
export interface TransferWrites {
  /** The interior's map row: its header and signs, when they named the old owner. */
  interior: { mapId: string; title: string; signs: [string, string, string] } | null;
  /** The interior's shopkeepers, whose `player_shops` rows now name the new owner. */
  shops: string[];
  /** The shopkeepers' files with their `OWN|` line naming the new owner (ledgers unchanged). */
  files: { npc: string; text: string }[];
}

/** `<old>'s …` becomes `<new>'s …`; anything else is left. */
function renamed(name: string, from: string, to: string): string | null {
  const prefix = `${from}'s `;
  return name.toLowerCase().startsWith(prefix.toLowerCase())
    ? `${to}'s ${name.slice(prefix.length)}`
    : null;
}

/**
 * Gives `rec` to `to`, after `housePreview` passed: the blueprint, the list entry, the owner's
 * named fixtures, the shops and (when it was the old owner's last house) the vault. Anyone inside
 * stays; the old owner's rights end at once, since every check reads these names and ids.
 */
export function transferHouse(
  world: World,
  rec: HouseRecord,
  to: HouseParty,
  preview: HousePreview,
  deps: Pick<HouseAdminDeps, "loadMap">,
): { out: Outgoing[]; writes: TransferWrites } {
  const from = rec.ownerName;
  const out: Outgoing[] = [];
  /** Renames the old owner's fixtures on a map, telling everyone on it. */
  const renameOn = (m: WorldMap, keep: (g: GroundItem) => boolean) => {
    const events: { e: "gset"; id: string; name: string }[] = [];
    for (const g of m.ground) {
      const next = keep(g) ? renamed(g.item, from, to.name) : null;
      if (next !== null) {
        g.item = next;
        world.groundLog.push({ mapId: m.id, set: { id: g.id, item: next } });
        events.push({ e: "gset", id: g.id, name: next });
      }
    }
    if (events.length > 0) {
      for (const o of world.rooms.get(m.name)?.players ?? []) {
        out.push({ to: o.id, msg: { t: "delta", events } });
      }
    }
  };
  // The outdoor mailbox, by the blueprint's exact name and tile: another house of the old owner's
  // on the same map has a mailbox of the same name, which stays theirs.
  const outdoor = deps.loadMap(rec.map);
  const box = rec.item1;
  if (outdoor && box && isFixtureKind(box.item, "mailbox")) {
    const next = renamed(box.item, from, to.name);
    if (next !== null) {
      renameOn(outdoor, (g) => g.item === box.item && g.x === box.x && g.y === box.y);
      rec.item1 = { ...box, item: next };
      // A mailbox opened there is the old owner's session no longer: it can't send any more.
      out.push(...closeMailAt(world, rec.map, box));
    }
  }
  // The interior's door (open or shut) and vault fixture, its header and its owner sign.
  const m = deps.loadMap(rec.interior);
  let interior: TransferWrites["interior"] = null;
  if (m) {
    renameOn(m, (g) => isFixtureKind(g.item, "door", "openedDoor", "houseVault"));
    // A House Vault window opened from this interior's fixture closes, whatever becomes of the
    // vault: a window stays only where it was opened (a map change closes it), so one open here
    // was opened here. One opened at the owner's other house is left alone.
    for (const p of world.players.values()) {
      if (
        p.container &&
        !p.container.carried &&
        lingoEq(p.map.name, rec.interior) &&
        isFixtureKind(p.container.name, "houseVault")
      ) {
        p.container = null;
        p.keyLock = false;
        out.push({ to: p.id, msg: { t: "vault", items: [], open: false, closed: true } });
      }
    }
    const title = renamed(m.title, from, to.name);
    const sign = lingoEq(m.signs[2], from);
    if (title !== null || sign) {
      if (title !== null) {
        m.title = title;
      }
      if (sign) {
        m.signs = [m.signs[0], m.signs[1], to.name];
      }
      interior = { mapId: m.id, title: m.title, signs: [...m.signs] };
    }
  }
  // The blueprint and its list entry.
  const oldId = rec.ownerId;
  rec.ownerId = to.characterId;
  rec.ownerName = to.name;
  for (const e of world.houseList) {
    if (e.ownerId === oldId && lingoEq(e.interior, rec.interior)) {
      e.ownerId = to.characterId;
      e.ownerName = to.name;
    }
  }
  world.housesDirty = true;
  // The shops, with their stock and till, which stay in the shopkeeper's ledger.
  const shops: string[] = [];
  const files: TransferWrites["files"] = [];
  for (const ps of world.playerShops.values()) {
    if (lingoEq(ps.interior, rec.interior)) {
      ps.ownerId = to.characterId;
      shops.push(ps.npc);
      // The file's ownership tag follows; its stock and till live in the ledger, which is kept.
      const f = npcFileNamed(world.npcs, ps.npc);
      if (f) {
        const text = withShopOwner(f.text, to.name);
        if (text !== f.text) {
          setNpcFile(world.npcs, f.name, text);
          files.push({ npc: f.name, text });
        }
      }
    }
  }
  // The vault, when this was the old owner's last house.
  if (!ownsAHouse(world, oldId) && preview.vaultFate !== "kept") {
    const fromVault = houseVaultOf(from);
    const toVault = houseVaultOf(to.name);
    const moving = world.containers.get(fromVault) ?? [];
    const merged = [...(world.containers.get(toVault) ?? []), ...moving];
    world.containers.set(toVault, merged);
    world.containers.delete(fromVault);
    world.containersDirty.add(fromVault);
    world.containersDirty.add(toVault);
    // Moved, not made: a container move, so the reconciliation's count does not change.
    const at: ActivityFields["at"] = { map: rec.interior, x: null, y: null };
    for (const [pile, n] of diffLines([], moving)) {
      logWorld(world, "container", pile, n, {
        other: fromVault,
        at,
        details: { to: toVault, house: rec.interior, transfer: true },
      });
    }
    // An open window on either vault shows what it no longer holds: it closes.
    for (const p of world.players.values()) {
      if (
        p.container &&
        (lingoEq(p.container.name, fromVault) || lingoEq(p.container.name, toVault))
      ) {
        p.container = null;
        p.keyLock = false;
        out.push({ to: p.id, msg: { t: "vault", items: [], open: false, closed: true } });
      }
    }
  }
  return { out, writes: { interior, shops, files } };
}

/**
 * What a revoke or transfer may change in memory, kept so a failed write can put it back (the
 * database rolls back with the intent; memory does not): the blueprints and list, the pending
 * ground and tile writes, the interiors queued for deletion, the given maps' ground, names,
 * header, signs and layer 2, the given vaults and which containers wait to be written, the player
 * shops with their files and ledgers, the casino tables, and every player's open windows and
 * sessions (vault, container, mailbox, shop, Bio, casino seat).
 * Players moved by a revoke are not restored here: the caller takes them off so they reload.
 */
export function houseSnapshot(
  world: World,
  maps: readonly (WorldMap | null)[],
  vaults: readonly string[],
): () => void {
  const houses = [...world.houses].map(([k, rec]) => [k, rec, structuredClone(rec)] as const);
  const list = structuredClone(world.houseList);
  const housesDirty = world.housesDirty;
  const groundLog = [...world.groundLog];
  const tileLog = new Set(world.tileLog);
  const toDelete = new Set(world.interiorsToDelete);
  const kept = maps.flatMap((m) =>
    m
      ? [
          {
            m,
            ground: m.ground.map((g) => [g, g.item] as const),
            title: m.title,
            signs: [...m.signs] as [string, string, string],
            // `setTile` replaces the layer and the walk grids, so the old ones are kept as they are.
            layer2: m.layers[1],
            walk: [m.walk, m.walkAir, m.walkShip] as const,
          },
        ]
      : [],
  );
  const boxes = vaults.map((v) => [v, world.containers.get(v)] as const);
  const dirtyBoxes = new Set(world.containersDirty);
  // The windows and sessions a change closes, and the casino tables an interior's deletion clears.
  const sessions = [...world.players.values()].map(
    (p) =>
      [
        p,
        {
          container: p.container,
          mailUi: p.mailUi,
          mailList: p.mailList,
          mailBox: p.mailBox,
          keyLock: p.keyLock,
          shop: p.shop,
          bio: p.bio,
          vaultOpen: p.vaultOpen,
          casino: p.casino,
        },
      ] as const,
  );
  const tables = [...world.casinoTables].map(([k, t]) => [k, t, structuredClone(t)] as const);
  const shops = [...world.playerShops].map(([k, ps]) => [k, ps, { ...ps }] as const);
  const npcs = shops.map(
    ([, ps]) => [ps.npc.toLowerCase(), world.npcs.get(ps.npc.toLowerCase())] as const,
  );
  const ledgers = shops.map(([, ps]) => [ps.npc, world.shops.get(ps.npc)] as const);
  return () => {
    world.houses.clear();
    for (const [k, rec, was] of houses) {
      Object.assign(rec, was);
      world.houses.set(k, rec);
    }
    world.houseList = list;
    world.housesDirty = housesDirty;
    world.groundLog.splice(0, world.groundLog.length, ...groundLog);
    world.tileLog.clear();
    for (const m of tileLog) {
      world.tileLog.add(m);
    }
    world.interiorsToDelete.clear();
    for (const n of toDelete) {
      world.interiorsToDelete.add(n);
    }
    for (const k of kept) {
      k.m.ground.splice(0, k.m.ground.length, ...k.ground.map(([g]) => g));
      for (const [g, item] of k.ground) {
        g.item = item;
      }
      k.m.title = k.title;
      k.m.signs = k.signs;
      k.m.layers[1] = k.layer2;
      [k.m.walk, k.m.walkAir, k.m.walkShip] = k.walk;
    }
    world.containersDirty.clear();
    for (const v of dirtyBoxes) {
      world.containersDirty.add(v);
    }
    for (const [p, was] of sessions) {
      Object.assign(p, was);
    }
    world.casinoTables.clear();
    for (const [k, t, was] of tables) {
      Object.assign(t, was);
      world.casinoTables.set(k, t);
    }
    for (const [v, lines] of boxes) {
      if (lines === undefined) {
        world.containers.delete(v);
      } else {
        world.containers.set(v, lines);
      }
    }
    world.playerShops.clear();
    for (const [k, ps, was] of shops) {
      Object.assign(ps, was);
      world.playerShops.set(k, ps);
    }
    for (const [k, f] of npcs) {
      if (f) {
        world.npcs.set(k, f);
      }
    }
    for (const [k, l] of ledgers) {
      if (l) {
        world.shops.set(k, l);
      }
    }
  };
}
