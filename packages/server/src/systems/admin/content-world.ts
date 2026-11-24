/**
 * The game world as the content service sees it when content in use is removed (issue #28): where
 * copies of an item or a monster's spawns and live ones are, the cleanup a publish runs on them,
 * and the stored references nothing in the content resolves.
 *
 * Online players, loaded maps and containers are in memory and authoritative, so they are read and
 * changed there (their clients told, their saves due); everyone and everything else is read and
 * changed in the database. A purge or replacement on a character is logged in the activity log as
 * an admin change, so the ledger check sees no unlogged difference.
 */
import {
  type BagLine,
  content,
  crystalPile,
  displayName,
  findNewQuest,
  isCrystal,
  isGoldName,
  isUniqueContainer,
  lingoEq,
  liveNpcText,
  mapCodes,
  NOTHING,
  type Rng,
  storedCopyAs,
  storedCopyOf,
  storedCount,
  vehicleOfItem,
} from "@secondstaronline/shared";

import { type EntryKind, npcTextCleaned, shopStockOf } from "../../content/cleanup.ts";
import type { ContentActor } from "../../content/service.ts";
import type { ContentProblem } from "../../content/validate.ts";
import type { ContentWorld, UsagePlace, UsagePlaceKind, WorldAction } from "../../content/world.ts";
import { mintContainerId } from "../crafting/craft.ts";
import { ledgerFromTemplate, type ShopLedger } from "../economy/shop.ts";
import { cancelTrade } from "../economy/trade.ts";
import { npcFileNamed, setNpcFile } from "../monsters/npcfiles.ts";
import {
  groundView,
  type Outgoing,
  type Player,
  type World,
  type WorldMap,
} from "../world/world.ts";
import { logActivity } from "./activity.ts";
import { closeNpcWindows } from "./npcedit.ts";

/** How many holders a usage place names. */
export const HOLDERS_SHOWN = 20;

/** A stored item of an offline character (a bag line, a worn slot or a vault line). */
export interface OfflineItem {
  table: "inventory" | "equipment" | "vault_items";
  characterId: string;
  accountId: string;
  name: string;
  item: string;
  qty: number;
  row: string | number;
}

/** The database side: offline characters and maps not loaded (persistence/content-world.ts). */
export interface ContentWorldStore {
  characterItems(
    table: OfflineItem["table"],
    likes: readonly string[],
    skip: readonly string[],
  ): OfflineItem[];
  deleteCharacterItem(i: OfflineItem): void;
  renameCharacterItem(i: OfflineItem, item: string): void;
  vault(characterId: string): string[];
  setVault(characterId: string, items: readonly string[]): void;
  addGold(characterId: string, gold: number): void;
  groundItems(
    likes: readonly string[],
    skip: readonly string[],
  ): { id: string; item: string; qty: number; map: string }[];
  deleteGround(id: string): void;
  renameGround(id: string, item: string, qty: number): void;
  rosterSlots(
    skip: readonly string[],
  ): { species: string | null; liveName: string | null; map: string }[];
  replaceSpecies(key: string, species: string | null, skip: readonly string[]): number;
  despawn(key: string, skip: readonly string[]): number;
  /** Every map not in `skip`, with its four tile layers. */
  mapLayers(skip: readonly string[]): { map: string; layers: string[][] }[];
  setInventoryQty(id: string, qty: number): void;
  saveShopFile(npc: string, text: string, ledger: ShopLedger, by: string, now: string): void;
}

export interface ContentWorldDeps {
  store: ContentWorldStore;
  world: World;
  /** Every map loaded since the start (its ground and slots are in memory). */
  loadedMaps(): readonly WorldMap[];
  rng: Rng;
  deliver(out: readonly Outgoing[]): void;
  /** Writes a loaded map's roster slots now (a removal must not wait for the periodic save). */
  saveSlots(m: WorldMap): void;
  /**
   * Writes now, in the caller's transaction, the inventories of `players`, every changed
   * container, the ground changes and the quest lines (game.ts `flushChanged`). What it would tell
   * the players goes to `send`, held until the publish commits.
   */
  persist(players: readonly Player[], send: (out: readonly Outgoing[]) => void): void;
  /** Wall-clock ISO time, for the rows it writes. */
  now(): string;
  /** An NPC's shop ledger: in memory, or loaded from the database (null: its file's state). */
  ledgerOf(npc: string): ShopLedger | null;
}

/** A tally of one kind of place: copies and who holds them. */
class Tally {
  count = 0;
  readonly holders = new Map<string, number>();
  add(holder: string, n: number): void {
    if (n <= 0) {
      return;
    }
    this.count += n;
    this.holders.set(holder, (this.holders.get(holder) ?? 0) + n);
  }
  place(place: UsagePlaceKind): UsagePlace | null {
    if (this.count === 0) {
      return null;
    }
    const holders = [...this.holders.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([h]) => h);
    return {
      place,
      count: this.count,
      holders: holders.slice(0, HOLDERS_SHOWN),
      holderCount: holders.length,
    };
  }
}

/**
 * Ground fixtures named after their owner (content-report.ts `OWNER_FORMS`): a door, a mailbox, a
 * board, a house vault, a newspaper, and a guild's vault.
 */
const OWNED_FIXTURE =
  /^(.+'s (Door|Opened Door|Mailbox|Board|House Vault|Newspaper)|The .+'s Guild Vault)$/i;

/** Paintings and photos players make (`Painting#12`): art of their own, no catalogue item. */
const PLAYER_ART = /^(Painting|Photo)#\d+$/;

/** Joins every bag line of `item` into its first line (containers, which never stack, excepted). */
function mergeStacks(bag: (BagLine | null)[], item: string): void {
  if (isUniqueContainer(item)) {
    return;
  }
  let first: BagLine | null = null;
  bag.forEach((l, i) => {
    if (!l || !lingoEq(l.item, item)) {
      return;
    }
    if (first) {
      first.qty += l.qty;
      bag[i] = null;
    } else {
      first = l;
    }
  });
}

/** Whether a quest line `npc:wants:reward` names the item. */
function questFields(line: string): string[] {
  return line.split(":");
}

export function createContentWorld(deps: ContentWorldDeps): ContentWorld {
  const { store, world } = deps;
  const online = () => [...world.players.keys()];
  const loaded = () => deps.loadedMaps().map((m) => m.id);

  /** Offline characters' stored items of one table that are copies. */
  const offlineRows = (table: OfflineItem["table"], spellings: readonly string[]) =>
    store.characterItems(table, spellings, online()).filter((r) => storedCopyOf(r.item, spellings));

  /** Ground items on maps not loaded that are copies. */
  const offlineGround = (spellings: readonly string[]) =>
    store.groundItems(spellings, loaded()).filter((r) => storedCopyOf(r.item, spellings));

  /**
   * What the open publish may change, as it was before, and how to put it back: the database rolls
   * back with a failed publish, and memory must go back with it.
   */
  let undoLast: (() => void) | null = null;
  /**
   * What the open publish tells clients (the new store and the cleanup), held until it commits
   * (`commit`), so a publish that rolls back has told nobody anything.
   */
  let outbox: Outgoing[] = [];
  const send = (out: readonly Outgoing[]) => {
    outbox.push(...out);
  };
  /** Opens a publish: memory is noted to put back, and clients are told nothing until it commits. */
  const begin = () => {
    undoLast = snapshot();
    outbox = [];
    touchedAll = new Set();
  };
  /** Online players whose things the last `apply` changed. */
  let touchedAll = new Set<Player>();
  const snapshot = (): (() => void) => {
    const players = [...world.players.values()].map((p) => ({
      p,
      bag: p.char.bag.map((l) => (l ? { ...l } : null)),
      equip: { ...p.char.equip },
      vault: [...p.char.vault],
      gold: p.char.gold,
      skills: [...p.char.skills],
      skillXp: p.char.skillXp ? [...p.char.skillXp] : p.char.skillXp,
      // The baselines the activity log and the medal check compare skills against follow a
      // publish that moves the skills, so they go back with them.
      progress: p.activityProgress
        ? { ...p.activityProgress, skills: [...p.activityProgress.skills] }
        : p.activityProgress,
      awardSkills: p.awardSkills ? [...p.awardSkills] : p.awardSkills,
      lastSheet: p.lastSheet,
      container: p.container,
      // A changed NPC file closes the shop or Bio window open on it.
      shop: p.shop,
      bio: p.bio,
      vaultOpen: p.vaultOpen,
      keyLock: p.keyLock,
      // The activity ledger moves with each logged change, so it goes back with them.
      held: p.activityHeld ? new Map(p.activityHeld) : undefined,
      storeDirty: p.char.storeDirty,
      invSaveDue: p.invSaveDue,
      // A publish puts a rebound special body (a rider's, the tree, the smoke) on the players who
      // wear it.
      body: p.spell.body,
      smokeBomb: p.spell.smokeBomb,
      // A publish that lowers a vehicle's full hull takes riders' hulls down with it.
      hull: p.hull,
    }));
    // Writing the touched players flushes every pending save; a rollback undoes those writes, so
    // what was pending is pending again.
    const pending = {
      tileLog: new Set(world.tileLog),
      powers: world.powersDirty,
      assassin: world.assassinDirty,
      highScores: world.highScoresDirty,
      guilds: new Set(world.guildsDirty),
      guildFields: new Map(world.guildFields),
      shops: [...world.shops.values()].map((sh) => [sh, sh.dirty] as const),
    };
    // A changed NPC file drops its shop's ledger from memory (an unsaved sale with it).
    const ledgers = new Map(world.shops);
    const containers = [...world.containers].map(([k, v]) => [k, [...v]] as const);
    const maps = deps.loadedMaps().map((m) => ({
      m,
      ground: m.ground.map((g) => ({ ...g })),
      slots: m.slots.map((sl) => [sl, { ...sl, live: sl.live ? { ...sl.live } : null }] as const),
    }));
    const quests = [...world.questLines];
    const shops = [...world.playerShops.values()].flatMap((ps) => {
      const f = npcFileNamed(world.npcs, ps.npc);
      return f ? [{ name: f.name, text: f.text }] : [];
    });
    const activity = world.activity.length;
    const groundLog = [...world.groundLog];
    const containersDirty = new Set(world.containersDirty);
    const questsDirty = new Set(world.questsDirty);
    return () => {
      for (const s of players) {
        s.p.char.bag.splice(0, s.p.char.bag.length, ...s.bag);
        Object.assign(s.p.char.equip, s.equip);
        s.p.char.vault = s.vault;
        s.p.char.gold = s.gold;
        s.p.char.skills.splice(0, s.p.char.skills.length, ...s.skills);
        s.p.char.skillXp = s.skillXp;
        s.p.activityProgress = s.progress;
        s.p.awardSkills = s.awardSkills;
        s.p.lastSheet = s.lastSheet;
        s.p.container = s.container;
        s.p.shop = s.shop;
        s.p.bio = s.bio;
        s.p.vaultOpen = s.vaultOpen;
        s.p.keyLock = s.keyLock;
        s.p.activityHeld = s.held;
        s.p.char.storeDirty = s.storeDirty;
        s.p.invSaveDue = s.invSaveDue;
        s.p.spell.body = s.body;
        s.p.spell.smokeBomb = s.smokeBomb;
        s.p.hull = s.hull;
        s.p.invDirty = true;
        s.p.lookDirty = true;
      }
      world.containers.clear();
      for (const [k, v] of containers) {
        world.containers.set(k, [...v]);
      }
      for (const { m, ground, slots } of maps) {
        m.ground.splice(0, m.ground.length, ...ground);
        for (const [sl, was] of slots) {
          Object.assign(sl, was);
        }
      }
      world.questLines.splice(0, world.questLines.length, ...quests);
      for (const sh of shops) {
        setNpcFile(world.npcs, sh.name, sh.text);
      }
      world.shops.clear();
      for (const [k, v] of ledgers) {
        world.shops.set(k, v);
      }
      world.activity.length = activity;
      world.groundLog.splice(0, world.groundLog.length, ...groundLog);
      world.containersDirty.clear();
      for (const c of containersDirty) {
        world.containersDirty.add(c);
      }
      world.questsDirty.clear();
      for (const q of questsDirty) {
        world.questsDirty.add(q);
      }
      world.tileLog.clear();
      for (const t of pending.tileLog) {
        world.tileLog.add(t);
      }
      world.powersDirty = pending.powers;
      world.assassinDirty = pending.assassin;
      world.highScoresDirty = pending.highScores;
      world.guildsDirty.clear();
      for (const g of pending.guilds) {
        world.guildsDirty.add(g);
      }
      world.guildFields.clear();
      for (const [k, v] of pending.guildFields) {
        world.guildFields.set(k, v);
      }
      for (const [sh, dirty] of pending.shops) {
        sh.dirty = dirty;
      }
    };
  };

  /** Closes every open window on a container. */
  const closeContainer = (name: string) => {
    for (const o of world.players.values()) {
      if (o.container && lingoEq(o.container.name, name)) {
        o.container = null;
        o.keyLock = false;
        send([{ to: o.id, msg: { t: "vault", items: [], open: false, closed: true } }]);
      }
    }
  };

  /** The text of a player shop as it stands now, its till and stock written in. */
  const shopText = (npc: string): { name: string; text: string } | null => {
    const f = npcFileNamed(world.npcs, npc);
    // A ledger not yet loaded since the start is read from the database (game.ts `ledgerOf`).
    return f ? { name: f.name, text: liveNpcText(f, deps.ledgerOf(f.name)) } : null;
  };

  function itemUsage(spellings: readonly string[]): UsagePlace[] {
    return itemPlaces(spellings).places;
  }

  function itemPlaces(spellings: readonly string[]): { places: UsagePlace[]; characters: number } {
    const shops = new Tally();
    for (const s of world.playerShops.values()) {
      const f = shopText(s.npc);
      if (f) {
        shops.add(f.name, shopStockOf(f.text, spellings));
      }
    }
    const bag = new Tally();
    const worn = new Tally();
    const vault = new Tally();
    const containers = new Tally();
    const ground = new Tally();
    const quests = new Tally();
    const is = (name: string) => storedCopyOf(name, spellings);
    for (const p of world.players.values()) {
      for (const l of p.char.bag) {
        if (l && is(l.item)) {
          bag.add(p.name, l.qty);
        }
      }
      for (const v of Object.values(p.char.equip)) {
        if (v && v !== NOTHING && is(v)) {
          worn.add(p.name, 1);
        }
      }
      for (const v of p.char.vault) {
        if (is(v)) {
          vault.add(p.name, 1);
        }
      }
    }
    for (const r of offlineRows("inventory", spellings)) {
      bag.add(r.name, r.qty);
    }
    for (const r of offlineRows("equipment", spellings)) {
      worn.add(r.name, 1);
    }
    for (const r of offlineRows("vault_items", spellings)) {
      vault.add(r.name, 1);
    }
    for (const [name, lines] of world.containers) {
      for (const l of lines) {
        if (is(l)) {
          containers.add(displayName(name), 1);
        }
      }
    }
    for (const m of deps.loadedMaps()) {
      for (const g of m.ground) {
        if (is(g.item)) {
          ground.add(m.name, (g.qty ?? 1) * storedCount(g.item));
        }
      }
    }
    for (const g of offlineGround(spellings)) {
      ground.add(g.map, g.qty * storedCount(g.item));
    }
    world.questLines.forEach((line, i) => {
      const [, wants = "", reward = ""] = questFields(line);
      if (line !== "" && (is(wants.trim()) || is(reward.trim()))) {
        quests.add(`Quest line ${i + 1}`, 1);
      }
    });
    const characters = new Set([
      ...bag.holders.keys(),
      ...worn.holders.keys(),
      ...vault.holders.keys(),
    ]);
    return {
      places: [
        bag.place("bag"),
        worn.place("worn"),
        vault.place("vault"),
        containers.place("container"),
        ground.place("ground"),
        shops.place("shop"),
        quests.place("quest"),
      ].filter((p): p is UsagePlace => p !== null),
      characters: characters.size,
    };
  }

  function monsterUsage(key: string): UsagePlace[] {
    const spawn = new Tally();
    const live = new Tally();
    for (const m of deps.loadedMaps()) {
      for (const s of m.slots) {
        if (s.species && lingoEq(s.species, key)) {
          spawn.add(m.name, 1);
        }
        if (s.live && lingoEq(s.live.name, key)) {
          live.add(m.name, 1);
        }
      }
    }
    for (const r of store.rosterSlots(loaded())) {
      if (r.species && lingoEq(r.species, key)) {
        spawn.add(r.map, 1);
      }
      if (r.liveName && lingoEq(r.liveName, key)) {
        live.add(r.map, 1);
      }
    }
    return [spawn.place("spawn"), live.place("live")].filter((p): p is UsagePlace => p !== null);
  }

  /** Purges or replaces the copies of one item; returns a line for each kind of place touched. */
  function applyItem(
    a: Extract<WorldAction, { kind: "item" }>,
    actor: ContentActor,
    publishId: string,
  ): string[] {
    const is = (name: string) => storedCopyOf(name, a.spellings);
    const details = { content: a.copies, publish: publishId, by: actor.name };
    const lines: string[] = [];
    /** Online players whose inventory changed: written with the publish. */
    const touched = new Set<Player>();
    /**
     * Player shops: the stock on sale goes, or is the replacement, with the till and stock as they
     * stand now written into the rewritten file and its new ledger. Returns the stock it touched.
     */
    const cleanShops = (mode: "remove" | "replace"): number => {
      let n = 0;
      for (const ps of world.playerShops.values()) {
        const f = shopText(ps.npc);
        const text = f ? npcTextCleaned(f.text, a.spellings, mode, a.replacement ?? "") : null;
        if (!f || text === null) {
          continue;
        }
        n += shopStockOf(f.text, a.spellings);
        const ledger = ledgerFromTemplate(setNpcFile(world.npcs, f.name, text));
        world.shops.set(f.name, ledger);
        store.saveShopFile(f.name, text, ledger, actor.accountId, deps.now());
        send(closeNpcWindows(world, f.name));
      }
      return n;
    };

    if (a.copies !== "retire") {
      const purge = a.copies === "purge";
      // A replaced container gets a new id of its own (minted, so it is no other container's), and
      // every copy of the same old one gets the same new name.
      const renamed = new Map<string, string>();
      const as = (stored: string) => {
        const was = renamed.get(stored.toLowerCase());
        if (was !== undefined) {
          return was;
        }
        let next = storedCopyAs(stored, a.replacement as string);
        if (next.includes("#")) {
          next = `${a.replacement}#${mintContainerId(world, Date.parse(deps.now()))}`;
        }
        renamed.set(stored.toLowerCase(), next);
        return next;
      };
      /**
       * A ground pile replaced: crystals carry their count in their name (`5 Blue Crystal`, one
       * pile), anything else in the pile's quantity.
       */
      const groundAs = (stored: string, qty: number): { item: string; qty: number } => {
        const next = as(stored);
        const n = Math.min(9999, qty * storedCount(stored));
        if (/^\d+ /.test(next)) {
          return { item: next, qty };
        }
        return isCrystal(next) ? { item: `${n} ${next}`, qty: 1 } : { item: next, qty: n };
      };
      // A container's storage goes with it: to the replacement's name (which keeps its `#id`), or,
      // purged, with it.
      let lostInside = 0;
      const moveStorage = (stored: string, next: string | null) => {
        if (!stored.includes("#")) {
          return;
        }
        // Its window closes for anyone who has it open (a ground crate is not carried), empty or
        // not, so nothing can be put into storage that has gone.
        closeContainer(stored);
        const lines = world.containers.get(stored);
        if (lines === undefined) {
          return;
        }
        world.containers.delete(stored);
        world.containersDirty.add(stored);
        if (next?.includes("#")) {
          world.containers.set(next, lines);
          world.containersDirty.add(next);
        } else {
          lostInside += lines.length;
        }
      };
      let held = 0;
      let refunded = 0;

      const characters = new Set<string>();
      // Online players: in memory, logged so their ledger check agrees.
      for (const p of world.players.values()) {
        let refund = 0;
        p.char.bag.forEach((l, i) => {
          if (!l || !is(l.item)) {
            return;
          }
          held += l.qty;
          characters.add(p.id);
          logActivity(world, p, "admin", { item: l.item, qty: -l.qty, details });
          if (purge) {
            refund += l.qty;
            moveStorage(l.item, null);
            p.char.bag[i] = null;
          } else {
            const next = as(l.item);
            moveStorage(l.item, next);
            l.item = next;
            logActivity(world, p, "admin", { item: l.item, qty: l.qty, details });
          }
          p.invDirty = true;
          touched.add(p);
        });
        // A replaced line joins a stack of the replacement already in the bag.
        if (!purge && touched.has(p)) {
          mergeStacks(p.char.bag, a.replacement as string);
        }
        for (const [slot, v] of Object.entries(p.char.equip) as [
          keyof typeof p.char.equip,
          string,
        ][]) {
          if (v && v !== NOTHING && is(v)) {
            held += 1;
            characters.add(p.id);
            logActivity(world, p, "admin", { item: v, qty: -1, details });
            if (purge) {
              refund += 1;
              p.char.equip[slot] = NOTHING;
            } else {
              p.char.equip[slot] = as(v);
              logActivity(world, p, "admin", { item: p.char.equip[slot], qty: 1, details });
            }
            p.invDirty = true;
            p.lookDirty = true;
            touched.add(p);
          }
        }
        const vaultBefore = p.char.vault.length;
        const inVault = p.char.vault.filter(is).length;
        if (inVault > 0) {
          held += inVault;
          characters.add(p.id);
          refund += purge ? inVault : 0;
          // A container stored in the vault takes its storage with it, as one in the bag does.
          for (const v of p.char.vault.filter(is)) {
            moveStorage(v, purge ? null : as(v));
          }
          p.char.vault = purge
            ? p.char.vault.filter((v) => !is(v))
            : p.char.vault.map((v) => (is(v) ? as(v) : v));
          logActivity(world, p, "admin", {
            item: a.key,
            details: { ...details, vault: purge ? p.char.vault.length - vaultBefore : inVault },
          });
          p.char.storeDirty = true;
          touched.add(p);
        }
        if (purge && refund > 0 && a.refundGold > 0) {
          const gold = refund * a.refundGold;
          p.char.gold += gold;
          refunded += gold;
          logActivity(world, p, "admin", { gold, details });
          p.invDirty = true;
        }
      }
      // Online players whose things changed: an open vault shows its new lines, and a trade in
      // progress is called off (its offer named the old lines).
      for (const p of touched) {
        if (p.vaultOpen) {
          send([{ to: p.id, msg: { t: "vault", items: [...p.char.vault], open: false } }]);
        }
        if (p.trade) {
          send(cancelTrade(world, p));
        }
      }
      // Offline characters: in the database, as one transaction with the publish's cleanup.
      const refunds = new Map<string, { n: number; account: string; name: string }>();
      const owed = (r: OfflineItem, n: number) => {
        characters.add(r.characterId);
        const e = refunds.get(r.characterId) ?? { n: 0, account: r.accountId, name: r.name };
        e.n += n;
        refunds.set(r.characterId, e);
      };
      const offline = (r: OfflineItem) => ({
        id: r.characterId,
        accountId: r.accountId,
        name: r.name,
      });
      for (const r of [
        ...offlineRows("inventory", a.spellings),
        ...offlineRows("equipment", a.spellings),
      ]) {
        held += r.qty;
        owed(r, r.qty);
        logActivity(world, offline(r), "admin", { item: r.item, qty: -r.qty, details });
        if (purge) {
          moveStorage(r.item, null);
          store.deleteCharacterItem(r);
        } else {
          moveStorage(r.item, as(r.item));
          store.renameCharacterItem(r, as(r.item));
          logActivity(world, offline(r), "admin", { item: as(r.item), qty: r.qty, details });
        }
      }
      // A replaced bag line joins a stack of the replacement the character already has.
      if (!purge && a.replacement) {
        const rep = a.replacement;
        const stacks = new Map<string, OfflineItem[]>();
        for (const r of store.characterItems("inventory", [rep], online())) {
          if (lingoEq(r.item, rep)) {
            stacks.set(r.characterId, [...(stacks.get(r.characterId) ?? []), r]);
          }
        }
        for (const rows of stacks.values()) {
          const [first, ...rest] = rows;
          if (first && rest.length > 0) {
            store.setInventoryQty(
              String(first.row),
              rows.reduce((n, r) => n + r.qty, 0),
            );
            for (const r of rest) {
              store.deleteCharacterItem(r);
            }
          }
        }
      }
      const vaults = new Map<string, OfflineItem>();
      for (const r of offlineRows("vault_items", a.spellings)) {
        held += 1;
        owed(r, 1);
        vaults.set(r.characterId, r);
      }
      for (const r of vaults.values()) {
        const items = store.vault(r.characterId);
        for (const v of items.filter(is)) {
          moveStorage(v, purge ? null : as(v));
        }
        const kept = purge ? items.filter((v) => !is(v)) : items.map((v) => (is(v) ? as(v) : v));
        store.setVault(r.characterId, kept);
        logActivity(world, offline(r), "admin", {
          item: a.key,
          details: {
            ...details,
            vault: purge ? kept.length - items.length : items.filter(is).length,
          },
        });
      }
      if (purge && a.refundGold > 0) {
        for (const [id, e] of refunds) {
          const gold = e.n * a.refundGold;
          store.addGold(id, gold);
          refunded += gold;
          logActivity(world, { id, accountId: e.account, name: e.name }, "admin", {
            gold,
            details,
          });
        }
      }
      if (held > 0) {
        lines.push(
          `${purge ? "Deleted" : `Replaced with ${a.replacement}`}: ${held} ${held === 1 ? "copy" : "copies"} of ${a.key} held by ${characters.size} ${characters.size === 1 ? "character" : "characters"}${refunded > 0 ? ` (${refunded} gold given back)` : ""}`,
        );
      }
      // Containers: all in memory.
      let inContainers = 0;
      for (const [name, items] of world.containers) {
        const n = items.filter(is).length;
        if (n > 0) {
          inContainers += n;
          for (const v of items.filter(is)) {
            moveStorage(v, purge ? null : as(v));
          }
          // Its lines changed: an open window on it closes (its list named the old lines).
          closeContainer(name);
          world.containers.set(
            name,
            purge ? items.filter((v) => !is(v)) : items.map((v) => (is(v) ? as(v) : v)),
          );
          world.containersDirty.add(name);
        }
      }
      if (inContainers > 0) {
        lines.push(
          `${purge ? "Deleted" : `Replaced with ${a.replacement}`}: ${inContainers} in containers`,
        );
      }
      // The ground: loaded maps in memory (players there see it go), the rest in the database.
      let onGround = 0;
      for (const m of deps.loadedMaps()) {
        const room = world.rooms.get(m.name);
        const out: Outgoing[] = [];
        for (const g of [...m.ground]) {
          if (!is(g.item)) {
            continue;
          }
          onGround += (g.qty ?? 1) * storedCount(g.item);
          if (purge) {
            moveStorage(g.item, null);
            m.ground.splice(m.ground.indexOf(g), 1);
            world.groundLog.push({ mapId: m.id, del: g.id });
            for (const o of room?.players ?? []) {
              out.push({ to: o.id, msg: { t: "delta", events: [{ e: "gdel", id: g.id }] } });
            }
          } else {
            // A pile's count moves to its quantity when the new item is not one that counts in
            // its name (`5 Blue Crystal` replaced by Apple is a pile of 5 Apples).
            const next = groundAs(g.item, g.qty ?? 1);
            moveStorage(g.item, next.item);
            g.item = next.item;
            if (next.qty > 1) {
              g.qty = next.qty;
            } else {
              delete g.qty;
            }
            world.groundLog.push({ mapId: m.id, del: g.id }, { mapId: m.id, add: g });
            for (const o of room?.players ?? []) {
              out.push({
                to: o.id,
                msg: {
                  t: "delta",
                  events: [
                    { e: "gdel", id: g.id },
                    { e: "gadd", item: groundView(g) },
                  ],
                },
              });
            }
          }
        }
        send(out);
      }
      for (const g of offlineGround(a.spellings)) {
        onGround += g.qty * storedCount(g.item);
        if (purge) {
          moveStorage(g.item, null);
          store.deleteGround(g.id);
        } else {
          const next = groundAs(g.item, g.qty);
          moveStorage(g.item, next.item);
          store.renameGround(g.id, next.item, next.qty);
        }
      }
      if (onGround > 0) {
        lines.push(
          `${purge ? "Deleted" : `Replaced with ${a.replacement}`}: ${onGround} on the ground`,
        );
      }
      const inShops = cleanShops(purge ? "remove" : "replace");
      if (inShops > 0) {
        lines.push(
          `${purge ? "Deleted" : `Replaced with ${a.replacement}`}: ${inShops} on sale in player shops`,
        );
      }
      if (lostInside > 0) {
        lines.push(`Deleted with the containers that held them: ${lostInside} stored items`);
      }
    }
    // A retirement nobody held was published as a removal: shops' empty lines naming it go too.
    if (a.copies === "retire" && content().item(a.key) === undefined) {
      cleanShops("remove");
    }
    // Quest lines: a line that wants or rewards it names the replacement, or is rolled again from
    // the (now published) pools, so no quest keeps making a retired or removed item.
    let quests = 0;
    world.questLines.forEach((line, i) => {
      const f = questFields(line);
      if (line === "" || !(is((f[1] ?? "").trim()) || is((f[2] ?? "").trim()))) {
        return;
      }
      quests += 1;
      if (a.copies === "replace" && a.replacement) {
        world.questLines[i] = [
          f[0] ?? "",
          is((f[1] ?? "").trim()) ? a.replacement : (f[1] ?? ""),
          is((f[2] ?? "").trim()) ? a.replacement : (f[2] ?? ""),
        ].join(":");
      } else {
        world.questLines[i] = findNewQuest(deps.rng);
      }
      world.questsDirty.add(i);
    });
    if (quests > 0) {
      lines.push(
        a.copies === "replace"
          ? `${quests} quest ${quests === 1 ? "line names" : "lines name"} ${a.replacement} instead`
          : `${quests} quest ${quests === 1 ? "line" : "lines"} rolled again`,
      );
    }
    // Written with the publish, so a crash before the next save cannot leave the new content with
    // the old copies.
    for (const p of touched) {
      touchedAll.add(p);
    }
    return lines;
  }

  function applyMonster(a: Extract<WorldAction, { kind: "monster" }>): string[] {
    let spawns = 0;
    let gone = 0;
    for (const m of deps.loadedMaps()) {
      const room = world.rooms.get(m.name);
      const before = spawns + gone;
      for (const s of m.slots) {
        if (s.species && lingoEq(s.species, a.key)) {
          spawns += 1;
          s.species = a.spawns === "replace" ? a.replacement : null;
          if (s.species === null) {
            s.home = null;
          }
          s.dirty = true;
        }
        if (s.live && lingoEq(s.live.name, a.key) && a.live === "despawn") {
          gone += 1;
          s.live = null;
          s.dirty = true;
          send(
            (room?.players ?? []).map((o) => ({
              to: o.id,
              msg: { t: "delta" as const, events: [{ e: "mgone" as const, slot: s.slot }] },
            })),
          );
        }
      }
      if (spawns + gone > before) {
        deps.saveSlots(m);
      }
    }
    spawns += store.replaceSpecies(a.key, a.spawns === "replace" ? a.replacement : null, loaded());
    if (a.live === "despawn") {
      gone += store.despawn(a.key, loaded());
      // An NPC that is gone has no Bio or shop to show, whether or not its file stays.
      if (gone > 0) {
        send(closeNpcWindows(world, a.key));
      }
    }
    const lines: string[] = [];
    if (spawns > 0) {
      lines.push(
        a.spawns === "replace"
          ? `${spawns} roster ${spawns === 1 ? "slot spawns" : "slots spawn"} ${a.replacement} instead of ${a.key}`
          : `${spawns} roster ${spawns === 1 ? "slot" : "slots"} of ${a.key} cleared`,
      );
    }
    if (gone > 0) {
      lines.push(`${gone} live ${a.key} despawned`);
    }
    return lines;
  }

  /** Whether a stored item name resolves to something the game knows. */
  function resolves(stored: string): boolean {
    const base = displayName(stored).trim();
    // Gold piles and the fixtures named after their owner (a parked boat, a house vault, a
    // newspaper, a guild vault) are ground items no catalogue lists.
    if (
      base === "" ||
      isGoldName(base) ||
      vehicleOfItem(base) !== null ||
      OWNED_FIXTURE.test(base) ||
      PLAYER_ART.test(stored)
    ) {
      return true;
    }
    const c = content();
    const known = (n: string) =>
      c.item(n) !== undefined ||
      c.items.fixtures.some((f) => lingoEq(f, n)) ||
      c.items.items.some((i) => (i.variants ?? []).some((v) => lingoEq(v, n)));
    if (known(base)) {
      return true;
    }
    // Only a crystal pile carries its count in its name (`5 Blue Crystal`); other piles keep it
    // in their quantity.
    const pile = crystalPile(base);
    if (pile && known(pile.item)) {
      return true;
    }
    const level = /^(.+?)\+\d+$/.exec(base);
    return level !== null && known(level[1] as string);
  }

  function problems(): ContentProblem[] {
    const out: ContentProblem[] = [];
    const tally = new Map<string, { where: string; name: string; holders: Set<string> }>();
    const note = (where: string, name: string, holder: string) => {
      if (resolves(name)) {
        return;
      }
      const k = `${where}\u0000${displayName(name).toLowerCase()}`;
      const e = tally.get(k) ?? { where, name: displayName(name), holders: new Set<string>() };
      e.holders.add(holder);
      tally.set(k, e);
    };

    for (const p of world.players.values()) {
      for (const l of p.char.bag) {
        if (l) {
          note("world/bags", l.item, p.name);
        }
      }
      for (const v of Object.values(p.char.equip)) {
        if (v && v !== NOTHING) {
          note("world/worn", v, p.name);
        }
      }
      for (const v of p.char.vault) {
        note("world/vaults", v, p.name);
      }
    }
    for (const [table, where] of [
      ["inventory", "world/bags"],
      ["equipment", "world/worn"],
      ["vault_items", "world/vaults"],
    ] as const) {
      for (const r of store.characterItems(table, [], online())) {
        note(where, r.item, r.name);
      }
    }
    for (const [name, items] of world.containers) {
      for (const v of items) {
        note("world/containers", v, displayName(name));
      }
    }

    for (const m of deps.loadedMaps()) {
      for (const g of m.ground) {
        note("world/ground", g.item, m.name);
      }
    }
    for (const r of store.groundItems([], loaded())) {
      note("world/ground", r.item, r.map);
    }
    for (const e of tally.values()) {
      const holders = [...e.holders];
      out.push({
        where: e.where,
        message: `"${e.name}" is not an item: held by ${holders.slice(0, 5).join(", ")}${holders.length > 5 ? ` and ${holders.length - 5} more` : ""}. It shows by its name with no picture, and does nothing.`,
      });
    }
    // Player shops selling or buying something no catalogue has (left by a database edit).
    for (const ps of world.playerShops.values()) {
      const f = shopText(ps.npc);
      for (const line of f ? f.text.split(/\r\n?|\n/) : []) {
        const m = /^(SEL|BUY)\|([^:|]*)/.exec(line);
        if (f && m && !resolves((m[2] as string).trim())) {
          out.push({
            where: "world/shops",
            message: `"${(m[2] as string).trim()}" is not an item: in ${f.name}'s player shop.`,
          });
        }
      }
    }
    // Roster slots naming no monster: they spawn a stand-in with the Generic body and 1 HP.
    const species = new Map<string, Set<string>>();
    const spelt = new Map<string, string>();
    const noteSpecies = (name: string, map: string) => {
      // A player shop's shopkeeper is named so as to be no monster.
      if (content().monster(name) || world.playerShops.has(name.toLowerCase())) {
        return;
      }
      const s = species.get(name.toLowerCase()) ?? new Set<string>();
      s.add(map);
      species.set(name.toLowerCase(), s);
      spelt.set(name.toLowerCase(), spelt.get(name.toLowerCase()) ?? name);
    };
    for (const m of deps.loadedMaps()) {
      for (const s of m.slots) {
        if (s.species) {
          noteSpecies(s.species, m.name);
        }
      }
    }
    for (const r of store.rosterSlots(loaded())) {
      if (r.species) {
        noteSpecies(r.species, r.map);
      }
    }
    for (const [name, maps] of species) {
      const list = [...maps];
      out.push({
        where: "world/spawns",
        message: `"${spelt.get(name) ?? name}" is not a monster: on the roster of ${list.slice(0, 5).join(", ")}${list.length > 5 ? ` and ${list.length - 5} more` : ""}. It spawns as a stand-in with the Generic body and 1 HP.`,
      });
    }
    return out;
  }

  return {
    tileMaps() {
      // Loaded maps are in memory and authoritative (gathering changes their tiles); the rest
      // are read from the database.
      const out = new Map<string, string[]>();
      const note = (map: string, layers: readonly (readonly string[])[]) => {
        for (const code of mapCodes(layers)) {
          const list = out.get(code) ?? [];
          list.push(map);
          out.set(code, list);
        }
      };
      for (const m of deps.loadedMaps()) {
        note(m.name, m.layers);
      }
      for (const m of store.mapLayers(loaded())) {
        note(m.map, m.layers);
      }
      return out;
    },
    usage(kind: EntryKind, spellings: readonly string[]) {
      return kind === "item" ? itemUsage(spellings) : monsterUsage(spellings[0] ?? "");
    },
    holders(spellings: readonly string[]) {
      return itemPlaces(spellings).characters;
    },
    begin,
    tell(out) {
      if (undoLast) {
        send(out);
      } else {
        deps.deliver(out);
      }
    },
    apply(actions, actor, publishId) {
      if (!undoLast) {
        begin();
      }
      touchedAll = new Set();
      const lines: string[] = [];
      for (const a of actions) {
        lines.push(...(a.kind === "item" ? applyItem(a, actor, publishId) : applyMonster(a)));
      }
      // Written with the publish, so a crash before the next save cannot leave the new content
      // with the old copies.
      deps.persist([...touchedAll], send);
      return lines;
    },
    problems,
    rollback() {
      undoLast?.();
      undoLast = null;
      outbox = [];
    },
    commit() {
      undoLast = null;
      const out = outbox;
      outbox = [];
      deps.deliver(out);
    },
  };
}
