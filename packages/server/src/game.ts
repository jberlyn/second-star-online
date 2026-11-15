/**
 * The game: joins the sim (systems/), persistence and settings behind the few calls the gateway
 * makes. Built once in main.ts with its dependencies.
 *
 * The gateway owns sockets and sessions; this module owns accounts, characters and the
 * world. Nothing here touches a socket: messages go out through `send`.
 */

import { helpData } from "@secondstaronline/data";
import {
  ADMIN_TEXT,
  AIRSHIP_BODY,
  type CreateMsg,
  cheatLine,
  creationError,
  type EditorMap,
  factionIdOf,
  type InGameMsg,
  invAdd,
  mapName,
  NO_FOG,
  PASSWORD_TEXT,
  parseHouseMapName,
  parseMapName,
  type ServerMsg,
  savedSpellbook,
  sortFaction,
  startingCharacter,
  TEXT,
  TICK_MS,
} from "@secondstaronline/shared";

import {
  findAccountById,
  findAccountByUsername,
  hashPassword,
  insertAccount,
  setPasswordHash,
  setRole,
  UsernameTakenError,
  verifyPassword,
} from "./persistence/accounts.ts";
import {
  addIpBan,
  findCharacterAccount,
  insertAudit,
  insertCheat,
  isAccountBanned,
  isIpBanned,
  recentCheats,
  removeIpBan,
  setAccountBan,
  setClassCode,
} from "./persistence/admin.ts";
import { addArt, loadArt } from "./persistence/art.ts";
import { loadAssassinState, saveAssassinState } from "./persistence/assassin.ts";
import { addPost, loadBoard } from "./persistence/boards.ts";
import { loadBuddies, saveBuddies } from "./persistence/buddies.ts";
import {
  findCharacterByAccount,
  findCharacterById,
  insertCharacter,
  loadSkills,
  saveProfileText,
  saveProgress,
  savePromotion,
  saveVehicle,
} from "./persistence/characters.ts";
import { loadContainers, saveContainer } from "./persistence/containers.ts";
import type { Db } from "./persistence/database.ts";
import {
  deleteShop,
  loadBank,
  loadShop,
  loadVault,
  saveBank,
  saveShop,
  saveVault,
} from "./persistence/economy.ts";
import { deleteGround, insertGround, loadGround, renameGround } from "./persistence/ground.ts";
import {
  loadCharacterGuild,
  loadGuilds,
  saveCharacterGuild,
  saveGuild,
} from "./persistence/guilds.ts";
import { loadHighScores, saveHighScores } from "./persistence/highscores.ts";
import { loadHouseList, loadHouses, saveHouses } from "./persistence/houses.ts";
import { loadIgnores, saveIgnores } from "./persistence/ignores.ts";
import { addGoldOffline, loadInventory, saveInventory } from "./persistence/inventory.ts";
import { addMail, deleteMail, findCharacterByName, loadMail } from "./persistence/mail.ts";
import {
  deleteMap,
  findMapByCoords,
  findMapById,
  insertMapVersion,
  listInteriorMapNames,
  saveMap,
  saveMapExits,
  saveMapLayers,
  saveMapTitle,
} from "./persistence/maps.ts";
import { loadSlots, saveSlots } from "./persistence/monsters.ts";
import { loadNewspaper, saveNewspaper } from "./persistence/newspapers.ts";
import { insertNpcFileVersion, loadNpcFiles, saveNpcFile } from "./persistence/npcfiles.ts";
import { deletePlayerShops, insertPlayerShop, loadPlayerShops } from "./persistence/playershops.ts";
import { loadSettingOverrides, saveSettingOverride } from "./persistence/settings.ts";
import {
  loadFactionPowers,
  loadQuestLines,
  saveFactionPowers,
  saveQuestLine,
} from "./persistence/social.ts";
import { loadSpellbook, saveSpellbook } from "./persistence/spells.ts";
import type { Rng } from "./rng.ts";
import { applySettingValues, resolveSettings, type Settings, settingRows } from "./settings.ts";
import type { AdminDeps } from "./systems/admin/commands.ts";
import {
  allowCreate,
  allowLoginFromIp,
  allowLoginToAccount,
  newLoginLimits,
  noteCreate,
  noteLoginSuccess,
  notePasswordTry,
  noteUnknownName,
  unnoteCreate,
} from "./systems/admin/login-limits.ts";
import { loadNpc, openNpcEditor, saveNpc } from "./systems/admin/npcedit.ts";
import {
  applySave,
  closeEditor,
  editorMap,
  openEditor,
  SAVED,
  saveError,
  versionData,
} from "./systems/admin/worldedit.ts";
import {
  bjBid,
  bjHit,
  bjLeave,
  bjStand,
  savedGold,
  tablePlayers,
} from "./systems/casino/blackjack.ts";
import { ckClose, ckMove } from "./systems/casino/checkers.ts";
import { type CasinoDeps, casinoLeave, casinoReturn } from "./systems/casino/index.ts";
import { slotClose, slotPull } from "./systems/casino/slots.ts";
import { type ChatDeps, handleChat, helpReply, whoReply } from "./systems/chat/chat.ts";
import { imIntent, setAway } from "./systems/chat/im.ts";
import { enterRoom, leaveRoom, rejoinRoom, roomMembership, roomSay } from "./systems/chat/rooms.ts";
import { setAttackHeld } from "./systems/combat/melee.ts";
import { craftIntent } from "./systems/crafting/craft.ts";
import { resetTreasure } from "./systems/crafting/gather.ts";
import { storageIntent, withdrawContainer } from "./systems/economy/containers.ts";
import {
  buyIntent,
  sellIntent,
  shopCancelIntent,
  shopListIntent,
  trainIntent,
} from "./systems/economy/intents.ts";
import { forgetShops, shopCommand } from "./systems/economy/playershop.ts";
import { ledgerFromTemplate, type ShopLedger } from "./systems/economy/shop.ts";
import {
  acceptTrade,
  cancelTrade,
  leaveTrade,
  offerTrade,
  openTrade,
} from "./systems/economy/trade.ts";
import { withdrawVault } from "./systems/economy/vault.ts";
import {
  demolish,
  type HouseDeps,
  houseKey,
  monthCheck,
  placeCancel,
  placeHouseIntent,
} from "./systems/housing/houses.ts";
import {
  actionIntent,
  crystalsIntent,
  dropIntent,
  equipIntent,
  giveIntent,
  goldIntent,
  type ItemCtx,
  pickupIntent,
  unequipIntent,
  useIntent,
} from "./systems/inventory/items.ts";
import {
  type ArtDeps,
  type ArtStore,
  artSaveIntent,
  paintUiIntent,
  viewCloseIntent,
} from "./systems/mail/art.ts";
import {
  type BoardDeps,
  type BoardStore,
  boardCloseIntent,
  boardPostIntent,
} from "./systems/mail/boards.ts";
import {
  type MailDeps,
  type MailStore,
  mailDelete,
  mailSend,
  mailUiIntent,
} from "./systems/mail/mail.ts";
import {
  type NewspaperStore,
  newspaperLoadIntent,
  newspaperSaveIntent,
} from "./systems/mail/newspapers.ts";
import { clickNpc, closeBio } from "./systems/monsters/npc.ts";
import { archiveNpcStore, npcFileNamed, setNpcFile } from "./systems/monsters/npcfiles.ts";
import type { MonsterSlot } from "./systems/monsters/slots.ts";
import { noteShown, pressStep, setHeld } from "./systems/movement/movement.ts";
import { type AssassinDeps, setAssassinMode } from "./systems/social/assassin.ts";
import { bioRequest, profileSave } from "./systems/social/bios.ts";
import { factionLogin } from "./systems/social/factions.ts";
import { friendsCommand, friendsEntry } from "./systems/social/friends.ts";
import {
  type GuildDeps,
  guildAction,
  guildClose,
  guildCreate,
  guildLogin,
  guildView,
} from "./systems/social/guilds.ts";
import { presenceOut } from "./systems/social/presence.ts";
import { castIntent } from "./systems/spells/cast.ts";
import { flushInventory, type TickDeps, tick } from "./systems/world/tick.ts";
import {
  addPlayer,
  createWorld,
  newSpellState,
  type Outgoing,
  type Player,
  removePlayer,
  sessionCombatState,
  toWorldMap,
  type World,
  type WorldMap,
} from "./systems/world/world.ts";
import type { TickProbe } from "./tick-stats.ts";

/** Delivers a message to a player's live connection (`Send`). */
export type Send = (playerId: string, msg: ServerMsg) => void;

export interface GameDeps {
  db: Db;
  send: Send;
  /** Wall-clock ISO timestamp for rows (`created_at`, `updated_at`). */
  isoNow(): string;
  /** The sim's randomness: pushes, spawns, monster moves and attacks, damage. */
  rng: Rng;
  /** Server minute of the hour for the Zombie and Skeleton window (UTC). */
  minute?(): number;
  /** Wall-clock ms (loot decay); defaults to the time of `isoNow`. */
  nowMs?(): number;
  /**
   * Disconnects a player with an alert (`/kick`, `/ban`). The gateway owns sockets; the game calls
   * this only after the command's own lines have gone out.
   */
  kick?(playerId: string, text: string): void;
  /** A throw caught at an entry point; defaults to `console.error`. */
  onFault?(where: string, err: unknown): void;
  /**
   * A named window where `SSO_CRASH_AT` may kill the process (crash tests); a no-op unless wired.
   */
  crashPoint?(label: string): void;
  /** Ends every resume token of a player except the live connection's (a password change). */
  dropOtherSessions?(playerId: string): void;
  /** Times the stretches of each tick; absent in normal play. */
  probe?: TickProbe;
}

/**
 * A help file by the name `gethelp` received: the server read its help text files from a Windows
 * disk, so the match ignores case.
 */
export function helpLines(topic: string): readonly string[] | null {
  const want = topic.toLowerCase();
  return helpData.topics.find((t) => t.topic.toLowerCase() === want)?.lines ?? null;
}

export type LoginResult =
  | { ok: true; accountId: string; characterId: string; name: string }
  | { ok: false; text: string };

export interface Game {
  readonly world: World;
  /** The settings in force; replaced when an operator saves them or runs `/Refresh`. */
  readonly settings: Settings;
  /** `ip` is the connection's address: an IP ban refuses the login. */
  login(name: string, password: string, ip?: string): Promise<LoginResult>;
  create(msg: CreateMsg, ip?: string): Promise<{ ok: true } | { ok: false; text: string }>;
  /**
   * Puts a logged-in character on its map. `resumed` marks a reconnect, not a login; `ip` is the
   * connection's address (`/IPlookup`).
   */
  enter(characterId: string, resumed: boolean, ip?: string): boolean;
  /** Why a resumed session may not come back (a ban since it dropped), or null. */
  refusal(characterId: string, ip: string): string | null;
  /**
   * Writes a cheat log line: an intent an honest client never sends. The gateway reports
   * connections it closes for bad or flooding frames.
   */
  cheat(characterId: string | null, ip: string, reason: string): void;
  /** Takes a character off the map and saves it. */
  leave(characterId: string): void;
  isOnline(characterId: string): boolean;
  /** An immortal may send editor-sized frames (`EDITOR_MESSAGE_BYTES`). */
  canEdit(characterId: string): boolean;
  /** Moderators and immortals are exempt from the per-address socket count. */
  canModerate(characterId: string): boolean;
  /** A player holding an unspent canvas or film may send an art-sized frame. */
  canUpload(characterId: string): boolean;
  intent(characterId: string, msg: InGameMsg): void;
  /** One sim tick: movement, deltas, saves. False if it threw (rolled back and logged). */
  tick(): boolean;
  /** Saves everyone online (shutdown). */
  saveAll(): void;
}

/**
 * The intents an editor takes and the Settings window's, whose ≡ menu item stays reachable in an
 * editor; every other intent is ignored while editing.
 */
const EDITOR_INTENTS = new Set([
  "editOpen",
  "editLoad",
  "editSave",
  "editClose",
  "npcEditOpen",
  "npcLoad",
  "npcSave",
  "settingsOpen",
  "settingsSave",
  "settingsClose",
  "assassinGame",
  // IM, Away and chat rooms are their own windows (MIAWs), usable over the editors.
  "im",
  "away",
  "roomEnter",
  "roomLeave",
  "roomSay",
  // The Friends and Bio windows and the Who window's Profile are windows too.
  "bioRequest",
  "profileSave",
  "friendRemove",
]);

/**
 * Admin intents an honest client sends only for an immortal (in the matching editor), with the
 * cheat log reason 1.6's own gate wrote for that tool: the World Editor's SAVE ("Attempted Admin
 * Access") and the NPC editor's ("Attempting to get Admin access"). Settings take the World
 * Editor's.
 */
const ADMIN_INTENTS: Readonly<Record<string, string>> = {
  editOpen: "Attempted Admin Access",
  editLoad: "Attempted Admin Access",
  editSave: "Attempted Admin Access",
  npcEditOpen: "Attempting to get Admin access",
  npcLoad: "Attempting to get Admin access",
  npcSave: "Attempting to get Admin access",
  settingsOpen: "Attempted Admin Access",
  settingsSave: "Attempted Admin Access",
  // Menu 502's Assassin items: 1.6's server just ignored a non-immortal.
  assassinGame: "Attempted Admin Access",
};

/** LOAD and SAVE belong to the editor they are sent from. */
function editingOk(p: Player, t: string): boolean {
  if (t === "editLoad" || t === "editSave") {
    return p.editing === "world";
  }
  if (t === "npcLoad" || t === "npcSave") {
    return p.editing === "npc";
  }
  return true;
}

export function createGame(deps: GameDeps): Game {
  const { db, send, isoNow, rng } = deps;
  const minute = deps.minute ?? (() => new Date().getUTCMinutes());
  let lastMinute = minute();
  /** Accounts with a `Password=` hash in flight. */
  const passwordBusy = new Set<string>();
  const crashPoint = (label: string) => deps.crashPoint?.(label);
  const nowMs = deps.nowMs ?? (() => Date.parse(isoNow()));
  /** Failed-login and creation counts; a restart clears them. */
  const limits = newLoginLimits();
  let settings = resolveSettings(loadSettingOverrides(db));
  // The archive's NPC files with the NPC editor's saves on top.
  const npcs = archiveNpcStore();
  for (const f of loadNpcFiles(db)) {
    setNpcFile(npcs, npcFileNamed(npcs, f.npc)?.name ?? f.npc, f.text);
  }
  const world = createWorld(npcs);
  world.jailFrames = settings.jailFrames;
  // Named containers: the Cauldrons and carried crates and cabinets.
  world.containers = loadContainers(db);
  // The house blueprints and list.
  for (const h of loadHouses(db)) {
    world.houses.set(houseKey(h.ownerId, h.map), h);
  }
  world.houseList = loadHouseList(db);
  // Player shops: their files came in with the NPC editor's saves above.
  for (const s of loadPlayerShops(db)) {
    world.playerShops.set(s.npc.toLowerCase(), s);
  }
  // Faction powers and quest lines: seeded from the archive on the first start.
  const powers = loadFactionPowers(db);
  if (powers) {
    world.factionPowers = powers;
  } else {
    saveFactionPowers(db, world.factionPowers);
  }
  const quests = loadQuestLines(db);
  if (quests) {
    world.questLines = quests;
  } else {
    db.transaction(() => {
      for (const [i, text] of world.questLines.entries()) {
        saveQuestLine(db, i + 1, text);
      }
    })();
  }
  // The Assassin's game: nothing seeded, the all-time table starts empty.
  world.assassin = loadAssassinState(db);
  // The High Score Statue: the archive's `highscore.txt` is empty, so it starts empty.
  world.highScores = loadHighScores(db);
  // Guilds: disbanded rows included, by lower-case name.
  for (const g of loadGuilds(db)) {
    world.guilds.set(g.name.toLowerCase(), g);
  }
  const guildDeps: GuildDeps = { newId: () => Bun.randomUUIDv7(), now: isoNow };
  // The treasure list is built at server start.
  resetTreasure(world, settings.treasureMaps, rng);
  const mapCache = new Map<string, WorldMap | null>();

  const loadMap = (name: string): WorldMap | null => {
    if (mapCache.has(name)) {
      return mapCache.get(name) ?? null;
    }
    // A house interior is its outdoor map's position and exit slot.
    const h = parseHouseMapName(name);
    const c = h ?? parseMapName(name);
    const rec = c ? findMapByCoords(db, c.mx, c.my, h ? h.slot : 0) : null;
    const m = rec
      ? toWorldMap({ ...rec, slots: slotsFor(rec.id), ground: groundFor(rec.id) })
      : null;
    mapCache.set(name, m);
    return m;
  };

  const loadMapById = (id: string): WorldMap | null => {
    const rec = findMapById(db, id);
    return rec ? loadMap(rec.name) : null;
  };

  /** A map's ground items; loot already past its time is deleted on the way. */
  function groundFor(mapId: string) {
    return loadGround(db, mapId, isoNow()).map((g) => ({
      id: g.id,
      item: g.item,
      ...(g.qty > 1 ? { qty: g.qty } : {}),
      x: g.x,
      y: g.y,
      kind: g.kind,
      expiresAt: g.expiresAt === null ? null : Date.parse(g.expiresAt),
    }));
  }

  /** Restores a map's slots: monsters come back as they were, standing. */
  function slotsFor(mapId: string): MonsterSlot[] {
    return loadSlots(db, mapId).map((r) => ({
      slot: r.slot,
      species: r.species,
      live: r.live
        ? { ...r.live, anim: 0, fromX: r.live.x, fromY: r.live.y, queue: [], hitCountb: 0 }
        : null,
      pause: 0,
      lastHp: r.lastHp,
      dirty: false,
      home: r.home ?? null,
    }));
  }

  const saveMapSlots = (m: WorldMap) => {
    saveSlots(
      db,
      m.id,
      m.slots.map((s) => ({
        slot: s.slot,
        species: s.species,
        live: s.live && {
          name: s.live.name,
          hp: s.live.hp,
          x: s.live.x,
          y: s.live.y,
          facing: s.live.facing,
        },
        lastHp: s.lastHp,
        home: s.home ?? null,
      })),
      isoNow(),
    );
    for (const s of m.slots) {
      s.dirty = false;
    }
  };

  /** Regen counters of dropped sessions, kept for a resume (only a login resets). */
  const keptRegen = new Map<string, number>();
  /** A dropped session's away text and room, for its resume. */
  const keptSocial = new Map<string, Pick<Player, "away" | "room">>();

  /** The Blackjack Table's grace and offline gold. */
  const casinoDeps: CasinoDeps = {
    get graceTicks() {
      return Math.ceil(settings.resumeGraceMs / TICK_MS);
    },
    addGoldOffline: (id, delta) => {
      addGoldOffline(db, id, delta);
      crashPoint("bj:offlineCredit");
    },
  };

  const probe = deps.probe;
  const tickDeps: TickDeps = {
    phase: probe ? (name) => probe.phase(name) : undefined,
    casino: casinoDeps,
    loadMap,
    loadMapById,
    startPoint: settings.startPoint,
    respawnPoint: settings.respawnPoint,
    minute,
    now: nowMs,
    lootDecayMinutes: settings.lootDecayMinutes,
    dropOnDeath: settings.dropOnDeath,
    portalTargets: settings.portalTargets,
    hazardMap: settings.hazardMap,
    saveIntervalTicks: settings.saveIntervalTicks,
    rng,
  };

  const chatDeps: ChatDeps = {
    maxChars: settings.chatMaxChars,
    broadcastCooldownFrames: settings.broadcastCooldownFrames,
    chatCooldownFrames: settings.chatCooldownFrames,
    helpLines,
    saveSlots: (m) => saveMapSlots(m),
    itemCtx: () => itemCtx(),
    rng,
    mapHeader: (name) => loadMap(name)?.title ?? "",
    saveIgnores: (accountId, list) => db.transaction(() => saveIgnores(db, accountId, list))(),
    saveBuddies: (accountId, items) => db.transaction(() => saveBuddies(db, accountId, items))(),
    // `Password=`: hashed off the tick, through the server-wide hash queue. The reply comes once
    // the hash is stored (or says it failed), one change in flight per account, and a change ends
    // the account's other resume tokens.
    changePassword: (p, password) => {
      if (passwordBusy.has(p.accountId)) {
        return;
      }
      passwordBusy.add(p.accountId);
      void (async () => {
        let text: string = PASSWORD_TEXT.failed;
        try {
          const hash = await hashPassword(password);
          db.transaction(() => setPasswordHash(db, p.accountId, hash, isoNow()))();
          text = PASSWORD_TEXT.changed;
          deps.dropOtherSessions?.(p.id);
        } catch (e) {
          console.error(`Password= for account ${p.accountId} failed:`, e);
        } finally {
          passwordBusy.delete(p.accountId);
        }
        if (world.players.get(p.id) === p) {
          send(p.id, { t: "chat", text, color: 0 });
        }
      })();
    },
    // A player shop command: the file, its ledger, the owner's gold and a title are written
    // together.
    shop: (p, typed) => {
      const r = shopCommand(world, p, typed, shopLedger);
      const w = r.write;
      if (w) {
        const now = isoNow();
        db.transaction(() => {
          if (w.file) {
            saveNpcFile(db, { npc: w.file.npc, text: w.file.text }, p.accountId, now);
            saveShop(db, w.file.ledger, now);
          }
          if (w.gold) {
            persistItems([p]);
          }
          if (w.title) {
            saveMapTitle(db, w.title.map.id, w.title.text, now);
          }
        })();
      }
      return r;
    },
  };
  /**
   * An NPC's ledger: in memory once used, else the saved one, else a fresh copy of its template
   * (the archived file's lines, stock and gold).
   */
  const shopLedger = (npc: string): ShopLedger | null => {
    const t = npcFileNamed(world.npcs, npc);
    if (!t) {
      return null;
    }
    const cached = world.shops.get(t.name);
    if (cached) {
      return cached;
    }
    const saved = loadShop(db, t.name);
    const ledger: ShopLedger = saved
      ? { npc: t.name, gold: saved.gold, lines: saved.lines, dirty: false, goldLine: t.goldLine }
      : ledgerFromTemplate(t);
    world.shops.set(t.name, ledger);
    return ledger;
  };
  /** An NPC's ledger as it stands, without making one (the NPC editor's LOAD). */
  const ledgerOf = (npc: string): ShopLedger | null => {
    const cached = world.shops.get(npc);
    if (cached) {
      return cached;
    }
    const saved = loadShop(db, npc);
    return saved ? { npc, gold: saved.gold, lines: saved.lines, dirty: false } : null;
  };
  /**
   * NPC editor SAVE: the file, the version it replaced and the dropped ledger are written
   * together.
   */
  const npcSave = (p: Player, name: string, text: string) => {
    const r = saveNpc(world, p, name, text, ledgerOf);
    const save = r.save;
    if (save) {
      const now = isoNow();
      db.transaction(() => {
        insertNpcFileVersion(db, { npc: save.npc, text: save.previous }, p.accountId, now);
        saveNpcFile(db, { npc: save.npc, text: save.text }, p.accountId, now);
        deleteShop(db, save.npc);
        insertAudit(db, { actor: p.accountId, command: "npcSave", target: save.npc }, now);
      })();
    }
    deliver(r.out);
  };
  const itemCtx = (): ItemCtx => ({
    world,
    rng,
    now: nowMs(),
    shop: shopLedger,
    mail: mailStore,
    boards: boardStore,
    art: artStore,
    newspapers: newspaperStore,
    slotsChanged: (m) => saveMapSlots(m),
  });

  /**
   * Writes the ground items added and removed since the last write and the inventories that
   * changed, in one transaction: an item movement is never half-saved.
   */
  const persistItems = (players: readonly Player[]) => {
    const log = world.groundLog.splice(0);
    const tiles = [...world.tileLog];
    world.tileLog.clear();
    const shopsDirty = [...world.shops.values()].some((s) => s.dirty);
    const boxes = [...world.containersDirty];
    world.containersDirty.clear();
    const questLines = [...world.questsDirty];
    world.questsDirty.clear();
    const powers = world.powersDirty;
    world.powersDirty = false;
    const assassin = world.assassinDirty;
    world.assassinDirty = false;
    const highScores = world.highScoresDirty;
    world.highScoresDirty = false;
    const guilds = [...world.guildsDirty];
    world.guildsDirty.clear();
    const guildFields = [...world.guildFields];
    world.guildFields.clear();
    if (
      log.length === 0 &&
      players.length === 0 &&
      !shopsDirty &&
      tiles.length === 0 &&
      boxes.length === 0 &&
      questLines.length === 0 &&
      !powers &&
      !assassin &&
      !highScores &&
      guilds.length === 0 &&
      guildFields.length === 0
    ) {
      return;
    }
    const now = isoNow();
    db.transaction(() => {
      // Tiles changed by gathering, seeds and regrowth, with the drops they made.
      for (const m of tiles) {
        saveMapLayers(db, m.id, m.layers, now);
      }
      for (const e of log) {
        if (e.add) {
          const g = e.add;
          insertGround(
            db,
            {
              id: g.id,
              mapId: e.mapId,
              x: g.x,
              y: g.y,
              item: g.item,
              qty: g.qty ?? 1,
              kind: g.kind,
              expiresAt: g.expiresAt === null ? null : new Date(g.expiresAt).toISOString(),
              ownerId: g.ownerId ?? null,
            },
            now,
          );
        }
        if (e.del) {
          deleteGround(db, e.del);
        }
        if (e.set) {
          renameGround(db, e.set.id, e.set.item);
        }
      }
      for (const p of players) {
        saveInventory(
          db,
          p.id,
          { gold: savedGold(world, p), bag: p.char.bag, equip: p.char.equip },
          now,
        );
        if (p.vehicleDirty) {
          // Boarding or parking an Airship: the ground row above and the character's vehicle and
          // tile land together.
          p.vehicleDirty = false;
          saveVehicle(
            db,
            p.id,
            {
              vehicle: p.vehicle,
              position: { mapId: p.map.id, x: p.x, y: p.y, facing: p.facing },
            },
            now,
          );
        }
        if (p.spell.bookDirty) {
          // A book's use and the spell it teaches are written together.
          p.spell.bookDirty = false;
          saveSpellbook(db, p.id, savedSpellbook(p.spell.book));
        }
        if (p.char.storeDirty) {
          p.char.storeDirty = false;
          if (p.char.bank !== null) {
            saveBank(db, p.id, p.char.bank, now);
          }
          saveVault(db, p.id, p.char.vault);
        }
      }
      crashPoint("persist:mid");
      for (const shop of world.shops.values()) {
        if (shop.dirty) {
          shop.dirty = false;
          saveShop(db, shop, now);
        }
      }
      // A deposit, a brew or a withdraw, with the bag it changed.
      for (const name of boxes) {
        saveContainer(db, name, world.containers.get(name) ?? []);
      }
      // A turn-in's rerolled quest line and the powers a head moved, with the giver's bag.
      for (const i of questLines) {
        saveQuestLine(db, i + 1, world.questLines[i] ?? "");
      }
      if (powers) {
        saveFactionPowers(db, world.factionPowers);
      }
      // A kill's points, a start or an end, with the bags the prizes went to.
      if (assassin) {
        saveAssassinState(db, world.assassin);
      }
      // A score submitted on a save tick.
      if (highScores) {
        saveHighScores(db, world.highScores);
      }
      // A guild change with every `Guild` field it set: never half-saved.
      for (const g of guilds) {
        saveGuild(db, g);
      }
      for (const [id, guild] of guildFields) {
        saveCharacterGuild(db, id, guild);
      }
    })();
  };
  // Mail and message boards: rows read and written at the moment, each write in its own
  // transaction.
  const mailStore: MailStore = {
    load: (ownerId) => loadMail(db, ownerId),
    add: (ownerId, msg, cap) => db.transaction(() => addMail(db, ownerId, msg, isoNow(), cap))(),
    remove: (ownerId, id) => db.transaction(() => deleteMail(db, ownerId, id))(),
    find: (name) => findCharacterByName(db, name),
  };
  const boardStore: BoardStore = {
    load: (board) => loadBoard(db, board),
    add: (board, author, body, cap) =>
      db.transaction(() => addPost(db, board, author, body, isoNow(), cap))(),
  };
  // Paintings, photos and newspapers: rows read and written at the moment.
  const artStore: ArtStore = {
    load: (id) => loadArt(db, id),
    add: (kind, author, png) =>
      db.transaction(() => addArt(db, kind, author, png, isoNow(), rng))(),
  };
  const newspaperStore: NewspaperStore = {
    load: (author) => loadNewspaper(db, author),
    save: (author, f) => db.transaction(() => saveNewspaper(db, author, f, isoNow()))(),
  };
  const artDeps: ArtDeps = { artBytesMax: settings.artBytesMax, rng };
  const mailDeps: MailDeps = {
    chatCooldownFrames: settings.chatCooldownFrames,
    mailBodyMax: settings.mailBodyMax,
    mailboxMax: settings.mailboxMax,
  };
  const boardDeps: BoardDeps = {
    chatCooldownFrames: settings.chatCooldownFrames,
    boardPostsMax: settings.boardPostsMax,
    boardPostMax: settings.boardPostMax,
  };
  const presenceDeps = {
    announcePresence: settings.announcePresence,
    presenceChatLines: settings.presenceChatLines,
  };

  /**
   * Puts new settings in force at once: every reader takes its value from these deps, and clients
   * get the rules they predict with.
   */
  const applySettings = (next: Settings) => {
    const rulesBefore = settings.chatMaxChars;
    settings = next;
    Object.assign(tickDeps, {
      startPoint: settings.startPoint,
      respawnPoint: settings.respawnPoint,
      lootDecayMinutes: settings.lootDecayMinutes,
      dropOnDeath: settings.dropOnDeath,
      portalTargets: settings.portalTargets,
      hazardMap: settings.hazardMap,
      saveIntervalTicks: settings.saveIntervalTicks,
    });
    Object.assign(chatDeps, {
      maxChars: settings.chatMaxChars,
      broadcastCooldownFrames: settings.broadcastCooldownFrames,
      chatCooldownFrames: settings.chatCooldownFrames,
    });
    Object.assign(artDeps, { artBytesMax: settings.artBytesMax });
    Object.assign(mailDeps, {
      chatCooldownFrames: settings.chatCooldownFrames,
      mailBodyMax: settings.mailBodyMax,
      mailboxMax: settings.mailboxMax,
    });
    Object.assign(boardDeps, {
      chatCooldownFrames: settings.chatCooldownFrames,
      boardPostsMax: settings.boardPostsMax,
      boardPostMax: settings.boardPostMax,
    });
    Object.assign(presenceDeps, {
      announcePresence: settings.announcePresence,
      presenceChatLines: settings.presenceChatLines,
    });
    world.jailFrames = settings.jailFrames;
    if (JSON.stringify(settings.treasureMaps) !== JSON.stringify(world.treasureMaps)) {
      resetTreasure(world, settings.treasureMaps, rng);
    }
    if (settings.chatMaxChars !== rulesBefore) {
      for (const o of world.players.values()) {
        send(o.id, {
          t: "rules",
          rules: { chatMaxChars: settings.chatMaxChars },
        });
      }
    }
  };

  const audit: AdminDeps["audit"] = (e) => insertAudit(db, e, isoNow());
  const cheat = (name: string, ip: string, reason: string) =>
    insertCheat(db, { name, ip, reason }, isoNow());
  /** Kicks wait until the command's lines are delivered (`deliverKicks`). */
  const kicks: { id: string; text: string }[] = [];
  const deliverKicks = () => {
    for (const k of kicks.splice(0)) {
      deps.kick?.(k.id, k.text);
    }
  };
  /** The Assassin's end: the prize setting and offline winners' bags. */
  const assassinDeps: AssassinDeps = {
    rng,
    prizes: () => settings.assassinPrizes,
    giveOffline: (characterId, prize) => {
      db.transaction(() => {
        if (!findCharacterById(db, characterId)) {
          return;
        }
        const inv = loadInventory(db, characterId);
        invAdd(inv, prize, 1, rng);
        saveInventory(db, characterId, inv, isoNow());
      })();
    },
  };
  const adminDeps: AdminDeps = {
    findCharacter: (name) => findCharacterAccount(db, name),
    setRole: (accountId, role) => setRole(db, accountId, role, isoNow()),
    setBan: (accountId, by) => setAccountBan(db, accountId, by, isoNow()),
    addIpBan: (ip, by) => addIpBan(db, ip, by, isoNow()),
    removeIpBan: (ip) => removeIpBan(db, ip),
    setClass: (characterId, code) => {
      setClassCode(db, characterId, code, isoNow());
      // An online target's promotions read the live class.
      for (const o of world.players.values()) {
        if (o.id === characterId) {
          o.char.classCode = code;
        }
      }
    },
    cheatLines: () => recentCheats(db, 300).map((c) => cheatLine(c.name, c.ip, c.reason)),
    audit,
    kick: (id, text) => kicks.push({ id, text }),
    saveAll: () => saveEveryone(),
    savePlayer: (t) => save(t),
    reloadSettings: () => applySettings(resolveSettings(loadSettingOverrides(db))),
    loadMap,
    startPoint: () => settings.startPoint,
  };
  chatDeps.admin = adminDeps;

  /** Settings window SAVE: immortals only; every changed value audited. */
  const settingsSave = (p: Player, values: Record<string, unknown>) => {
    if (p.role !== "immortal") {
      cheat(p.name, p.ip, "Attempted Admin Access");
      return;
    }
    const r = applySettingValues(settings, values);
    if (!r.ok) {
      send(p.id, { t: "settingsResult", ok: false, key: r.key, text: r.error });
      return;
    }
    const now = isoNow();
    db.transaction(() => {
      for (const c of r.changed) {
        saveSettingOverride(db, c.key, c.after, now);
        insertAudit(
          db,
          {
            actor: p.accountId,
            command: "settings",
            target: c.key,
            before: c.before,
            after: c.after,
          },
          now,
        );
      }
    })();
    // The same step as `/Refresh`: everyone online gets the new rules at once.
    applySettings(r.settings);
    send(p.id, { t: "settings", rows: settingRows(settings) });
    send(p.id, { t: "settingsResult", ok: true });
  };

  /** Everyone online and every loaded map written now (`/save`, shutdown). */
  const saveEveryone = () => {
    const all = [...world.players.values()];
    const maps = [...mapCache.values()].filter((m): m is WorldMap => !!m);
    db.transaction(() => {
      all.forEach(save);
      maps.forEach(saveMapSlots);
    })();
    persistItems(all);
  };

  const deliver = (out: readonly Outgoing[]) => {
    for (const o of out) {
      // 1.6 set a slot's remembered name when its client drew the placement.
      const to = world.players.get(o.to);
      if (to) {
        noteShown(to, o.msg);
      }
      send(o.to, o.msg);
    }
  };

  /**
   * After an intent outside the tick: sends `inv` to everyone in `players` whose inventory changed
   * and writes those inventories, banks, vaults, NPC ledgers and ground items in one transaction.
   */
  const flushChanged = (players: readonly Player[]) => {
    const changed: Player[] = [];
    for (const o of players) {
      deliver(flushInventory(world, o));
      if (o.invSaveDue || o.char.storeDirty) {
        o.invSaveDue = false;
        changed.push(o);
      }
    }
    persistItems(changed);
  };

  /**
   * `loadspells` before each save rebuilds the list from what `savespells` kept, so a learned
   * Identify (no save id) is gone after the next save.
   */
  const normaliseSpellbook = (p: Player) => {
    const kept = savedSpellbook(p.spell.book);
    if (kept.length !== p.spell.book.length) {
      p.spell.book = kept;
      send(p.id, { t: "spellbook", spells: [...kept] });
    }
  };

  const save = (p: Player) => {
    normaliseSpellbook(p);
    saveProgress(
      db,
      p.id,
      {
        position: { mapId: p.map.id, x: p.x, y: p.y, facing: p.facing },
        vitals: p.char.vitals,
        hunger: p.char.hunger,
        skills: p.char.skills,
        respawn: p.char.respawn,
        faction: { id: p.char.faction.id, count: p.char.factionCount },
        wanted: p.char.wanted,
        stats: p.char.stats,
        medals: p.char.medals,
        vehicle: p.vehicle,
      },
      isoNow(),
    );
  };

  /**
   * SAVE: immortals in the editor only (the original checked only in the client). The old map is
   * kept as a version; the map, its slots and its placed items are written together.
   */
  /** This month in the house decay time zone. */
  const houseMonth = (): string =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: settings.houseDecayTimeZone,
      month: "numeric",
    }).format(new Date(nowMs()));

  /** Writes the house tables when they changed (in the caller's transaction, or its own). */
  const persistHouses = () => {
    if (world.housesDirty) {
      world.housesDirty = false;
      saveHouses(db, world.houses.values(), world.houseList, isoNow());
    }
  };

  /** The interior's map row from its template, with its items and no roster. */
  const createInterior: HouseDeps["createInterior"] = (plan, type, outdoor) => {
    const now = isoNow();
    const c = parseHouseMapName(plan.interior);
    if (!c) {
      throw new Error(`not a house map: ${plan.interior}`);
    }
    // A house on the same map and slot replaces the interior.
    const old = findMapByCoords(db, c.mx, c.my, c.slot);
    if (old) {
      deleteInterior(plan.interior);
    }
    const tpl = type.template;
    const f18 = /^H([12])(-?\d+):H\1(-?\d+):(\d+):(\d+):$/.exec(tpl.field18);
    const id = saveMap(
      db,
      {
        mx: c.mx,
        my: c.my,
        slot: c.slot,
        title: plan.title,
        layers: [[...tpl.layers[0]], [...tpl.layers[1]], [...tpl.layers[2]], [...tpl.layers[3]]],
        flags: { ...tpl.flags },
        exit1: plan.exitBack,
        // The template's stale field 18 survives: no Exit2 item uses it.
        exit2: f18
          ? {
              mx: Number(f18[2]),
              my: Number(f18[3]),
              x: Number(f18[4]),
              y: Number(f18[5]),
              house: f18[1] === "1" ? 1 : 2,
            }
          : null,
        signs: ["", "", plan.sign3],
        fog: { ...NO_FOG },
      },
      now,
    );
    for (const it of plan.interiorItems) {
      insertGround(
        db,
        {
          id: Bun.randomUUIDv7(),
          mapId: id,
          x: it.x,
          y: it.y,
          item: it.item,
          qty: 1,
          kind: "drop",
          expiresAt: null,
        },
        now,
      );
    }
    saveMapExits(db, outdoor.id, outdoor.exit1, outdoor.exit2, now);
    mapCache.delete(plan.interior);
    const m = loadMap(plan.interior);
    if (!m) {
      throw new Error(`interior not saved: ${plan.interior}`);
    }
    return m;
  };

  /**
   * Deletes a demolished interior, or leaves it queued while someone stands in it. Offline
   * characters saved there go to the start point, as 1.6's missing map sent them.
   */
  function deleteInterior(name: string): boolean {
    const room = world.rooms.get(name);
    if (room && room.players.length > 0) {
      return false;
    }
    world.rooms.delete(name);
    const c = parseHouseMapName(name);
    const rec = c ? findMapByCoords(db, c.mx, c.my, c.slot) : null;
    if (rec) {
      const sp = settings.startPoint;
      const start = findMapByCoords(db, ...startCoords(sp.map));
      if (start) {
        db.query("UPDATE characters SET map_id = ?, x = ?, y = ? WHERE map_id = ?").run(
          start.id,
          sp.x,
          sp.y,
          rec.id,
        );
      }
      deleteMap(db, rec.id);
    }
    // A shop's shopkeeper, its file and its till go with the interior.
    deletePlayerShops(db, name);
    forgetShops(world, name);
    mapCache.delete(name);
    return true;
  }
  const startCoords = (name: string): [number, number] => {
    const c = parseMapName(name);
    return c ? [c.mx, c.my] : [Number.NaN, Number.NaN];
  };

  /** The queued interiors nobody is in any more. */
  const flushInteriorDeletes = () => {
    if (world.interiorsToDelete.size === 0) {
      return;
    }
    db.transaction(() => {
      for (const name of [...world.interiorsToDelete]) {
        if (deleteInterior(name)) {
          world.interiorsToDelete.delete(name);
        }
      }
    })();
  };

  /** One month report from `p`: refresh, maybe sweep, then demolish. */
  const houseMonthCheck = (p: Player) => {
    const demolitions = monthCheck(world, p, houseMonth(), rng);
    const out: Outgoing[] = [];
    for (const d of demolitions) {
      out.push(...demolish(world, d.ownerId, d.map, loadMap).out);
    }
    deliver(out);
    if (world.housesDirty || demolitions.length > 0) {
      db.transaction(() => {
        persistItems([]);
        persistHouses();
      })();
    }
    crashPoint("house:demolished");
    flushInteriorDeletes();
  };

  const houseDeps = (): HouseDeps => ({
    createInterior,
    loadMap,
    rng,
    month: houseMonth,
  });

  const editSave = (p: Player, m: EditorMap) => {
    if (p.role !== "immortal" || p.editing !== "world") {
      return;
    }
    const error = saveError(m);
    if (error) {
      send(p.id, { t: "alert", text: error });
      return;
    }
    const name = mapName(m.mx, m.my);
    const before = loadMap(name);
    const now = isoNow();
    let result: ReturnType<typeof applySave> | null = null;
    db.transaction(() => {
      if (before) {
        insertMapVersion(
          db,
          { mapId: before.id, savedBy: p.accountId, data: versionData(before) },
          now,
        );
      }
      const id = saveMap(
        db,
        {
          mx: m.mx,
          my: m.my,
          title: m.header,
          layers: m.layers,
          flags: m.flags,
          exit1: m.exit1,
          exit2: m.exit2,
          signs: m.signs,
          fog: m.fog,
        },
        now,
      );
      const target = before ?? toWorldMap({ id, name, title: m.header, layers: m.layers });
      if (!before) {
        mapCache.set(name, target);
      }
      result = applySave(world, target, m, () => Bun.randomUUIDv7());
      for (const gid of result.removed) {
        deleteGround(db, gid);
      }
      for (const g of result.added) {
        insertGround(
          db,
          {
            id: g.id,
            mapId: target.id,
            x: g.x,
            y: g.y,
            item: g.item,
            qty: g.qty ?? 1,
            kind: g.kind,
            expiresAt: null,
          },
          now,
        );
      }
      saveMapSlots(target);
    })();
    if (result) {
      deliver((result as ReturnType<typeof applySave>).out);
    }
    audit({ actor: p.accountId, command: "editSave", target: name });
    send(p.id, { t: "alert", text: SAVED });
  };

  // House interiors whose house is gone (a crash between a demolition and its deferred delete, or
  // an interior held back while someone stood in it) are deleted at start.
  {
    // A blueprint is kept per owner and outdoor map, so a second house of one owner on a map
    // overwrites the first's record while its interior lives on: an interior is an orphan only when
    // no record and no list entry names its outdoor map.
    const live = new Set([
      ...[...world.houses.values()].map((h) => h.map),
      ...world.houseList.map((h) => h.map),
    ]);
    for (const name of listInteriorMapNames(db)) {
      const c = parseHouseMapName(name);
      if (c && !live.has(mapName(c.mx, c.my))) {
        world.interiorsToDelete.add(name);
      }
    }
    flushInteriorDeletes();
  }

  /** Takes a player off the map without saving: a broken enter or leave must leave no ghost. */
  const evict = (characterId: string) => {
    try {
      removePlayer(world, characterId);
    } catch {
      world.players.delete(characterId);
    }
  };

  const core: Game = {
    world,
    get settings() {
      return settings;
    },

    async login(name, password, ip = "") {
      // An IP ban refuses the connection before the password (1.6 checked the IP on connect with
      // its address lookup and sort routines; the reply did nothing).
      if (ip !== "" && isIpBanned(db, ip)) {
        return { ok: false, text: ADMIN_TEXT.ipBanned };
      }
      const account = findAccountByUsername(db, name);
      // SSO's login limits: a moderator or immortal is never refused by the per-address count (an
      // operator behind a shared address must still get in).
      const exempt = account !== null && account.role !== "player";
      if (!exempt && !allowLoginFromIp(limits, ip, nowMs(), settings.loginFailsPerIp)) {
        return { ok: false, text: TEXT.tooManyLogins };
      }
      if (!account) {
        noteUnknownName(limits, ip, nowMs());
        return { ok: false, text: TEXT.noSuchName };
      }
      if (!allowLoginToAccount(limits, account.id, ip, nowMs(), settings.loginFailsPerAccount)) {
        return { ok: false, text: TEXT.tooManyLogins };
      }
      const tried = nowMs();
      notePasswordTry(limits, account.id, ip, tried);
      if (!(await verifyPassword(account, password))) {
        return { ok: false, text: TEXT.badPassword };
      }
      noteLoginSuccess(limits, account.id, ip, tried);
      const character = findCharacterByAccount(db, account.id);
      if (!character) {
        return { ok: false, text: TEXT.noSuchName };
      }
      // The server checked the password first and the client refused the banned file it got
      // back.
      if (isAccountBanned(db, account.id)) {
        return { ok: false, text: ADMIN_TEXT.banned };
      }
      return { ok: true, accountId: account.id, characterId: character.id, name: character.name };
    },

    async create(msg, ip = "") {
      const choice = {
        name: msg.name,
        sex: msg.sex,
        head: msg.head,
        classCode: msg.classCode,
        str: msg.str,
        sta: msg.sta,
        int: msg.int,
        wis: msg.wis,
        dex: msg.dex,
      };
      const error = creationError(choice);
      if (error) {
        return { ok: false, text: error };
      }
      if (findAccountByUsername(db, msg.name)) {
        return { ok: false, text: TEXT.nameTaken };
      }
      if (!allowCreate(limits, ip, nowMs(), settings.createsPerIp)) {
        return { ok: false, text: TEXT.tooManyCreates };
      }
      const sp = settings.startPoint;
      const map = loadMap(sp.map);
      if (!map) {
        throw new Error(`start point map ${sp.map} does not exist`);
      }
      const counted = nowMs();
      noteCreate(limits, ip, counted);
      let passwordHash: string;
      try {
        passwordHash = await hashPassword(msg.password);
      } catch (err) {
        unnoteCreate(limits, ip, counted);
        throw err;
      }
      const now = isoNow();
      try {
        db.transaction(() => {
          const account = insertAccount(db, { username: msg.name, passwordHash, now });
          insertCharacter(db, {
            accountId: account.id,
            start: startingCharacter(choice),
            // Load Character's Facing = "N" is overwritten by the play-entry setup's Facing = "S":
            // every login faces south.
            position: { mapId: map.id, x: sp.x, y: sp.y, facing: "S" },
            now,
          });
        })();
      } catch (err) {
        if (
          err instanceof UsernameTakenError ||
          (err instanceof Error && /UNIQUE/.test(err.message))
        ) {
          unnoteCreate(limits, ip, counted);
          return { ok: false, text: TEXT.nameTaken };
        }
        unnoteCreate(limits, ip, counted);
        throw err;
      }
      return { ok: true };
    },

    refusal(characterId, ip) {
      if (isIpBanned(db, ip)) {
        return ADMIN_TEXT.ipBanned;
      }
      const c = findCharacterById(db, characterId);
      return c && isAccountBanned(db, c.accountId) ? ADMIN_TEXT.banned : null;
    },

    cheat(characterId, ip, reason) {
      const p = characterId ? world.players.get(characterId) : undefined;
      const c = !p && characterId ? findCharacterById(db, characterId) : null;
      cheat(p?.name ?? c?.name ?? "?", ip, reason);
    },

    enter(characterId, resumed, ip = "") {
      if (world.players.has(characterId)) {
        return false;
      }
      const c = findCharacterById(db, characterId);
      const account = c ? findAccountById(db, c.accountId) : null;
      if (!c || !account) {
        return false;
      }
      const inv = loadInventory(db, c.id);
      const stored = findMapById(db, c.position.mapId);
      let map = stored ? loadMap(stored.name) : null;
      let { x, y } = c.position;
      if (!map) {
        const sp = settings.startPoint;
        map = loadMap(sp.map);
        x = sp.x;
        y = sp.y;
        if (!map) {
          return false;
        }
      }
      const p: Player = {
        id: c.id,
        accountId: c.accountId,
        name: c.name,
        head: c.head,
        role: account.role,
        map,
        x,
        y,
        // Load Character's Facing = "N" is overwritten by the play-entry setup's Facing = "S", for
        // new and loaded characters alike. A resumed session keeps its facing.
        facing: resumed ? c.position.facing : "S",
        stepFrames: 0,
        vehicle: c.vehicle,
        held: null,
        heldTurn: false,
        pending: null,
        loading: 0,
        n: 0,
        resumed,
        saveIn: settings.saveIntervalTicks,
        lastSent: null,
        forceYou: false,
        broadcastIn: 0,
        chatIn: 0,
        char: {
          classCode: c.classCode,
          vitals: { ...c.vitals },
          stats: { ...c.stats },
          skills: loadSkills(db, c.id),
          hunger: c.hunger,
          equip: inv.equip,
          gold: inv.gold,
          bag: inv.bag,
          bank: loadBank(db, c.id),
          vault: loadVault(db, c.id),
          storeDirty: false,
          // The faction sort on the login's faction reply.
          faction: sortFaction(factionIdOf(c.faction.id), world.factionPowers),
          factionCount: c.faction.count,
          wanted: c.wanted,
          respawn: c.respawn,
          sex: c.sex,
          profile: c.profile,
          medals: c.medals,
        },
        ...sessionCombatState(),
        ip,
        spell: { ...newSpellState(loadSpellbook(db, c.id)), body: c.vehicle ? AIRSHIP_BODY : null },
      };
      p.ignore = loadIgnores(db, c.accountId);
      p.buddies = loadBuddies(db, c.accountId);
      const kept = keptSocial.get(c.id);
      if (resumed) {
        p.regenCounter = keptRegen.get(c.id) ?? p.regenCounter;
        p.away = kept?.away ?? null;
      }
      keptRegen.delete(c.id);
      keptSocial.delete(c.id);
      factionLogin(p); // `@Faction` at load
      send(p.id, { t: "role", role: p.role });
      deliver(addPlayer(world, p, !resumed));
      // The guild loads with the character; a resumed session greets nobody.
      deliver(guildLogin(world, p, loadCharacterGuild(db, c.id), resumed));
      if (resumed) {
        deliver(rejoinRoom(world, p, kept?.room ?? null));
      }
      persistItems([]);
      send(p.id, { t: "spellbook", spells: [...p.spell.book] });
      // A blackjack seat held through the grace reopens as it was.
      deliver(casinoReturn(world, p));
      flushChanged(tablePlayers(world, p)); // a hand that settled while away
      // Frame 50 fills the Friends window; it opens only from the menu.
      deliver(friendsEntry(world, p));
      deliver(presenceOut(world, p, true, presenceDeps));
      // Loading the character sends Help.txt as the greeting. A resumed session is not a login.
      if (!resumed) {
        deliver(helpReply(p, "Help", chatDeps));
        // Game entry asks for the news after the greeting; the client decides whether to print
        // it.
        if (settings.news !== "") {
          send(p.id, { t: "news", text: settings.news });
        }
      }
      // The clock's minute (the first clock request at entry).
      send(p.id, { t: "minute", minute: minute() });
      if (!resumed) {
        // The login's two clock replies each send the month report: two checks.
        houseMonthCheck(p);
        houseMonthCheck(p);
      }
      return true;
    },

    leave(characterId) {
      const leaving = world.players.get(characterId);
      // A blackjack seat waits the grace mid-hand (the saved gold keeps its hold); a checkers seat
      // and an undealt blackjack seat free at once.
      if (leaving?.casino) {
        const mates = tablePlayers(world, leaving);
        deliver(casinoLeave(world, leaving, casinoDeps));
        flushChanged(mates);
      }
      // A trade ends when a trader leaves.
      const tradeOut = leaving ? leaveTrade(world, leaving) : [];
      if (leaving) {
        keptSocial.set(leaving.id, { away: leaving.away, room: leaving.room });
      }
      // Logging off drops you from your room (`935` → `xILoggedOff`).
      const roomOut = leaving ? leaveRoom(world, leaving) : [];
      const r = removePlayer(world, characterId);
      if (!r) {
        return;
      }
      deliver(tradeOut);
      deliver(roomOut);
      save(r.player);
      keptRegen.set(r.player.id, r.player.regenCounter);
      deliver(r.out);
      deliver(presenceOut(world, r.player, false, presenceDeps));
    },

    isOnline(characterId) {
      return world.players.has(characterId);
    },

    canEdit(characterId) {
      return world.players.get(characterId)?.role === "immortal";
    },

    canModerate(characterId) {
      const role = world.players.get(characterId)?.role;
      return role === "moderator" || role === "immortal";
    },

    canUpload(characterId) {
      const p = world.players.get(characterId);
      return p !== undefined && (p.canvas || p.film);
    },

    intent(characterId, msg) {
      const p = world.players.get(characterId);
      if (!p) {
        return;
      }
      // In an editor the playfield is gone: only the editors' own intents count, and chat has no
      // input on their frames.
      if (p.editing && !EDITOR_INTENTS.has(msg.t)) {
        return;
      }
      // The editors and Settings are an immortal's; 1.6's own gates logged these too.
      const adminReason = ADMIN_INTENTS[msg.t];
      if (adminReason && (p.role !== "immortal" || !editingOk(p, msg.t))) {
        cheat(p.name, p.ip, adminReason);
        return;
      }
      switch (msg.t) {
        case "settingsOpen":
          send(p.id, { t: "settings", rows: settingRows(settings) });
          return;
        case "settingsSave":
          settingsSave(p, msg.values);
          return;
        case "settingsClose":
          return;
        // The Guild Center: each change is written with the fields it set.
        case "guildCreate":
          deliver(guildCreate(world, p, msg.name, msg.alignment, guildDeps));
          persistItems([]);
          return;
        case "guildClose":
          guildClose(p);
          return;
        // The Slot Machine's lever and Close; settled on the tick.
        case "slotPull": {
          const room = world.rooms.get(p.map.name);
          if (room) {
            deliver(slotPull(room, p));
          }
          return;
        }
        case "slotClose":
          slotClose(p);
          return;
        // The Blackjack Table and the Checkers window.
        case "bjBid":
          {
            const mates = tablePlayers(world, p);
            deliver(bjBid(world, p, msg.text, rng));
            flushChanged(mates);
          }
          return;
        case "bjHit":
          {
            const mates = tablePlayers(world, p);
            deliver(bjHit(world, p, rng));
            flushChanged(mates);
          }
          return;
        case "bjStand":
          {
            const mates = tablePlayers(world, p);
            deliver(bjStand(world, p));
            flushChanged(mates);
          }
          return;
        case "bjLeave":
          {
            const mates = tablePlayers(world, p);
            deliver(bjLeave(world, p, casinoDeps));
            flushChanged(mates);
          }
          return;
        case "ckMove":
          deliver(ckMove(world, p, msg.piece, msg.dh, msg.dv));
          return;
        case "ckClose":
          deliver(ckClose(world, p));
          return;
        case "guildView":
          deliver(guildView(world, p, msg.name));
          return;
        case "guildAction":
          deliver(guildAction(world, p, msg.act, msg.viewing, msg.member));
          persistItems([]);
          return;
        // Mail and message boards.
        case "mailUi":
          mailUiIntent(p, msg.act);
          return;
        case "mailSend":
          if (!p.mailUi) {
            cheat(p.name, p.ip, "Mail sent without a mailbox");
          }
          deliver(mailSend(world, p, msg, mailStore, mailDeps));
          return;
        case "mailDelete":
          mailDelete(p, msg.id, mailStore);
          return;
        case "boardPost":
          deliver(boardPostIntent(p, msg.text, boardStore, boardDeps));
          return;
        case "boardClose":
          boardCloseIntent(p);
          return;
        // Paintings, photos and newspapers.
        case "paintUi":
          paintUiIntent(p);
          return;
        case "viewClose":
          viewCloseIntent(p);
          return;
        case "artSave":
          deliver(artSaveIntent(p, msg.kind, msg.png, artStore, artDeps));
          flushChanged([p]); // the Painting or Photo is in the bag: write it now
          return;
        case "newspaperLoad":
          deliver(newspaperLoadIntent(p, newspaperStore));
          return;
        case "newspaperSave":
          deliver(newspaperSaveIntent(p, { photos: msg.photos, texts: msg.texts }, newspaperStore));
          return;
        case "assassinGame":
          deliver(setAssassinMode(world, msg.mode, assassinDeps));
          audit({ actor: p.accountId, command: "assassin", target: msg.mode });
          flushChanged([...world.players.values()]); // online winners' prizes
          persistItems([]);
          return;
        case "editOpen":
          deliver(openEditor(world, p, loadMap, parseMapName(p.map.name)));
          return;
        case "editLoad":
          if (p.editing === "world") {
            const { map, exists } = editorMap(loadMap, msg.mx, msg.my);
            send(p.id, { t: "editor", editing: true, map, exists });
          }
          return;
        case "editSave":
          editSave(p, msg.map);
          return;
        case "editClose":
          deliver(closeEditor(world, p));
          // Return To Game re-enters frame 50, which refills the Friends window.
          if (!p.editing) {
            deliver(friendsEntry(world, p));
          }
          return;
        case "npcEditOpen":
          deliver(openNpcEditor(world, p));
          return;
        case "npcLoad":
          deliver(loadNpc(world, p, msg.name, ledgerOf));
          return;
        case "npcSave":
          npcSave(p, msg.name, msg.text);
          return;
        case "move":
          setHeld(p, msg.held, msg.turn);
          return;
        case "step":
          pressStep(p, msg.dir, msg.turn);
          return;
        case "mapReady":
          p.loading = 0;
          return;
        // IM, Away and chat rooms.
        case "im":
          deliver(imIntent(world, p, msg.to, msg.text, msg.via, chatDeps));
          return;
        case "away":
          deliver(setAway(p, msg.text, chatDeps));
          return;
        case "roomEnter":
          // Admin Chat is an immortal's (menu 502); anyone else is ignored, not disconnected as 1.6
          // did, and logged.
          if (msg.room === "admin" && p.role !== "immortal") {
            cheat(p.name, p.ip, "Attempted Admin Access");
            return;
          }
          deliver(enterRoom(world, p, msg.room));
          return;
        case "roomLeave":
          deliver(leaveRoom(world, p));
          return;
        case "roomSay":
          deliver(roomSay(world, p, msg.text, chatDeps, (q) => whoReply(world, q)));
          return;
        // Friends, bios and profiles.
        case "bioRequest":
          deliver(bioRequest(world, p, { id: msg.id, name: msg.name }));
          return;
        case "profileSave":
          deliver(
            profileSave(p, msg.text, (profile) =>
              db.transaction(() => saveProfileText(db, p.id, profile, isoNow()))(),
            ),
          );
          return;
        case "friendRemove":
          deliver(
            friendsCommand(world, p, { kind: "remove", name: msg.name }, (id, items) =>
              chatDeps.saveBuddies?.(id, items),
            ),
          );
          return;
        case "chat":
          deliver(handleChat(world, p, msg.text, chatDeps));
          // `/drop`, the bank.
          flushChanged([p]);
          persistItems([]); // a guild join
          deliverKicks();
          return;
        case "attack":
          setAttackHeld(p, msg.held);
          return;
        case "use":
        case "equip":
        case "drop":
        case "give":
        case "unequip":
        case "pickup":
        case "action":
        case "crystals":
        case "gold":
        case "craft":
        case "storage": {
          const room = world.rooms.get(p.map.name);
          if (!room) {
            return;
          }
          const ctx = itemCtx();
          const out =
            msg.t === "craft"
              ? craftIntent(room, p, msg.slot, { world, rng })
              : msg.t === "storage"
                ? storageIntent(world, p, msg.slot)
                : msg.t === "use"
                  ? useIntent(ctx, room, p, msg.slot)
                  : msg.t === "equip"
                    ? equipIntent(ctx, room, p, msg.slot)
                    : msg.t === "drop"
                      ? dropIntent(ctx, room, p, msg.slot)
                      : msg.t === "give"
                        ? giveIntent(ctx, room, p, msg.slot)
                        : msg.t === "unequip"
                          ? unequipIntent(ctx, room, p, msg.slot)
                          : msg.t === "pickup"
                            ? pickupIntent(ctx, room, p, msg.id)
                            : msg.t === "action"
                              ? actionIntent(ctx, room, p)
                              : msg.t === "crystals"
                                ? crystalsIntent(ctx, room, p, msg.slot, msg.n)
                                : goldIntent(ctx, room, p, msg.n);
          deliver(out);
          // Everyone whose inventory changed (a crystal or gold give changes two) gets `inv` now.
          const changed: Player[] = [];
          for (const o of room.players) {
            deliver(flushInventory(world, o));
            if (o.invSaveDue) {
              o.invSaveDue = false;
              changed.push(o);
            }
          }
          if (p.vitalsDirty) {
            p.vitalsDirty = false;
            send(p.id, { t: "vitals", vitals: { ...p.char.vitals } });
          }
          if (p.spell.bookDirty) {
            send(p.id, { t: "spellbook", spells: [...p.spell.book] });
            if (!changed.includes(p)) {
              changed.push(p);
            }
          }
          // A dropped Pig leaves the bag and takes a monster slot: one transaction. The inner
          // transaction in `persistItems` nests as a savepoint.
          db.transaction(() => {
            persistItems(changed);
            if (room.map.slots.some((s) => s.dirty)) {
              saveMapSlots(room.map);
            }
          })();
          return;
        }
        case "placeHouse": {
          const room = world.rooms.get(p.map.name);
          if (!room) {
            return;
          }
          db.transaction(() => {
            const r = placeHouseIntent(world, room, p, msg.slot, msg.x, msg.y, houseDeps());
            deliver(r.out);
            deliver(flushInventory(world, p));
            if (r.built) {
              persistItems([p]);
              persistHouses();
            }
            // The Small Shop's shopkeeper: its file, its owner and the roster.
            if (r.shop) {
              const now = isoNow();
              const { shop, interior } = r.shop;
              saveNpcFile(
                db,
                { npc: shop.npc, text: world.npcs.get(shop.npc.toLowerCase())?.text ?? "" },
                p.accountId,
                now,
              );
              insertPlayerShop(db, shop, now);
              saveMapSlots(interior);
            }
          })();
          return;
        }
        case "placeCancel":
          placeCancel(p);
          return;
        case "cast": {
          const room = world.rooms.get(p.map.name);
          if (!room) {
            return;
          }
          const r = castIntent(room, p, msg.spell, msg.x, msg.y, { rng });
          deliver(r.out);
          if (p.vitalsDirty) {
            p.vitalsDirty = false;
            send(p.id, { t: "vitals", vitals: { ...p.char.vitals } });
          }
          if (r.slotsChanged) {
            saveMapSlots(p.map);
          }
          flushChanged([p]); // the crystals
          return;
        }
        case "npcClick": {
          const room = world.rooms.get(p.map.name);
          if (room) {
            const r = clickNpc(room, p, msg.slot, rng);
            deliver(r.out);
            if (r.slotsChanged) {
              saveMapSlots(p.map);
              crashPoint("npc:pigGrab");
            }
            flushChanged(room.players);
          }
          return;
        }
        case "npcClose":
          closeBio(p);
          return;
        case "shopList":
          deliver(shopListIntent(itemCtx(), p, msg.mode));
          return;
        case "buy":
          deliver(buyIntent(itemCtx(), p, msg.line, msg.count));
          flushChanged([p]);
          return;
        case "sell":
          deliver(sellIntent(itemCtx(), p, msg.line, msg.count));
          flushChanged([p]);
          return;
        case "train": {
          // Write-through on a promotion.
          const r = trainIntent(itemCtx(), p, msg.line);
          if (r.result) {
            savePromotion(db, p.id, r.result, isoNow());
          }
          deliver(r.out);
          flushChanged([p]);
          return;
        }
        case "shopCancel":
          shopCancelIntent(p);
          return;
        case "vaultTake":
          // 1.6's last-chest name is the open container: the personal vault or a named one.
          deliver(
            p.container
              ? withdrawContainer(world, p, msg.index, rng)
              : withdrawVault(p, msg.index, rng),
          );
          flushChanged([p]);
          return;
        case "tradeOpen":
          deliver(openTrade(world, p, msg.id));
          return;
        case "tradeOffer":
          deliver(offerTrade(world, p, msg));
          return;
        case "tradeAccept": {
          const partner = p.trade ? world.trades.get(p.trade)?.b : undefined;
          deliver(acceptTrade(world, p));
          const other = partner ? world.players.get(partner) : undefined;
          flushChanged(other ? [p, other] : [p]);
          return;
        }
        case "tradeCancel":
          deliver(cancelTrade(world, p));
          return;
        case "logout":
          return; // the gateway handles logout
      }
    },

    tick() {
      const r = tick(world, tickDeps);
      deliver(r.out);
      // A new minute turns everyone's placed Clocks.
      const m = minute();
      if (m !== lastMinute) {
        lastMinute = m;
        for (const o of world.players.values()) {
          send(o.id, { t: "minute", minute: m });
        }
      }
      // Lost a room's membership: dropped at once.
      deliver(roomMembership(world));
      probe?.phase("deliver");
      for (const p of r.houseChecks) {
        houseMonthCheck(p);
      }
      if (r.houseChecks.length > 0) {
        crashPoint("tick:afterHouseCheck");
      }
      flushInteriorDeletes();
      persistItems(r.invSaves);
      if (r.saves.length > 0 || r.slotSaves.length > 0) {
        db.transaction(() => {
          r.saves.forEach(save);
          r.slotSaves.forEach(saveMapSlots);
        })();
      }
      probe?.phase("sql");
      return true;
    },

    saveAll() {
      saveEveryone();
    },
  };

  // One guard per entry point: the synchronous body of an intent, tick, enter or leave is one SQL
  // transaction inside a catch. A throw rolls back every write of that call; memory is not rolled
  // back, so the player whose action threw is logged out and a re-login reloads them from SQL.
  const fault =
    deps.onFault ?? ((where: string, err: unknown) => console.error(`fault in ${where}`, err));
  const inner = { enter: core.enter, leave: core.leave, intent: core.intent, tick: core.tick };
  return Object.assign(core, {
    enter(characterId: string, resumed: boolean, ip?: string) {
      try {
        return db.transaction(() => inner.enter(characterId, resumed, ip))();
      } catch (err) {
        fault("enter", err);
        evict(characterId);
        return false;
      }
    },
    leave(characterId: string) {
      try {
        db.transaction(() => inner.leave(characterId))();
      } catch (err) {
        fault("leave", err);
        evict(characterId);
      }
    },
    intent(characterId: string, msg: InGameMsg) {
      try {
        db.transaction(() => inner.intent(characterId, msg))();
      } catch (err) {
        fault(`intent ${msg.t}`, err);
        const p = world.players.get(characterId);
        if (p) {
          cheat(p.name, p.ip, `Server error on ${msg.t}`);
        }
        deps.kick?.(characterId, TEXT.serverError);
        // A kick without a gateway (tests) still takes the player off the map.
        if (world.players.has(characterId)) {
          evict(characterId);
        }
      }
    },
    tick() {
      try {
        deps.probe?.begin();
        db.transaction(() => inner.tick())();
        deps.probe?.end();
        return true;
      } catch (err) {
        fault("tick", err);
        return false;
      }
    },
  });
}
