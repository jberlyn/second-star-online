/**
 * The game: joins the sim (systems/), persistence and settings behind the few calls the gateway
 * makes. Built once in main.ts with its dependencies.
 *
 * The gateway owns sockets and sessions; this module owns accounts, characters and the
 * world. Nothing here touches a socket: messages go out through `send`.
 */

import {
  ACTIVITY_TOTALS_MAX,
  type ActivityType,
  ADMIN_TEXT,
  airshipWalkGrid,
  anyMapName,
  banNotice,
  CHARACTER_SEARCH_LIMIT,
  CHAT_COLOR,
  type CreateMsg,
  can,
  canOpenControlPanel,
  cheatLine,
  className,
  content,
  creationError,
  type DeltaEvent,
  diffEdit,
  EDIT_TEXT,
  type EditorMap,
  editableOf,
  endIso,
  endMs,
  factionKeyOf,
  findNewQuest,
  findSkillIndex,
  footWalkGrid,
  HUB_EDITS,
  HUB_TEXT,
  hubArgs,
  hullMax,
  type InGameMsg,
  invAdd,
  ipKey,
  isActive,
  isActivityType,
  isJailMap,
  isStaff,
  MODERATION_TEXT,
  mapName,
  mergePlayerPrefs,
  NEW_SKILL_VALUE,
  NO_FOG,
  PASSWORD_TEXT,
  type Permission,
  parseHouseMapName,
  parseMapName,
  prefsEqual,
  questLineUnanswerable,
  ROLE_TEXT,
  type Role,
  type RoleData,
  type RoleDef,
  roleDataError,
  roleFromData,
  rolesError,
  roleToData,
  type ServerMsg,
  SKILL_KEYS,
  type SkillValues,
  savedSpellbook,
  shipWalkGrid,
  skillsFromKeys,
  sortFaction,
  startingCharacter,
  startingPowers,
  TEXT,
  TIMED_HUB_ACTIONS,
  VEHICLE_BODY,
} from "@secondstaronline/shared";

import { DEFAULT_SERVER_CONFIG, type ServerConfig } from "./config.ts";
import {
  CONTRACT_POINTS,
  type ContractPoint,
  type PointMap,
  pointProblem,
  pointProblems,
} from "./content/contract.ts";
import { CONTENT_INTENTS, contentIntent } from "./content/page.ts";
import type { ContentService } from "./content/service.ts";
import type { ContentProblem } from "./content/validate.ts";
import type { ContentWorld } from "./content/world.ts";
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
  type ActivityScope,
  activityItemTotals,
  activityRows,
  insertActivity,
  pruneActivity,
} from "./persistence/activity.ts";
import {
  auditTrail,
  findCharacterAccount,
  insertAudit,
  insertCheat,
  pruneAudit,
  recentCheats,
  setClassCode,
} from "./persistence/admin.ts";
import { addArt, loadArt } from "./persistence/art.ts";
import { loadAssassinState, saveAssassinState } from "./persistence/assassin.ts";
import { addPost, loadBoard } from "./persistence/boards.ts";
import { loadBuddies, saveBuddies } from "./persistence/buddies.ts";
import {
  characterEdits,
  findCharacterEdit,
  insertCharacterEdit,
  saveLookAndClass,
} from "./persistence/character-edits.ts";
import {
  findCharacterByAccount,
  findCharacterById,
  insertCharacter,
  loadSkills,
  loadSkillValues,
  saveProfileText,
  saveProgress,
  savePromotion,
  saveSkillValues,
  saveVehicle,
} from "./persistence/characters.ts";
import { chatLogLines, insertChatLog, pruneChatLog } from "./persistence/chatlog.ts";
import { loadContainers, saveContainer } from "./persistence/containers.ts";
import { contentWorldStore } from "./persistence/content-world.ts";
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
import {
  deleteGround,
  insertGround,
  loadGround,
  peekGround,
  renameGround,
} from "./persistence/ground.ts";
import {
  loadCharacterGuild,
  loadGuilds,
  saveCharacterGuild,
  saveGuild,
} from "./persistence/guilds.ts";
import { loadHighScores, saveHighScores } from "./persistence/highscores.ts";
import { loadHouseList, loadHouses, saveHouses } from "./persistence/houses.ts";
import { characterTimes, loadStoredCharacter, searchCharacters } from "./persistence/hub.ts";
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
import {
  accountAddresses,
  accountBan,
  accountMute,
  activeBans,
  activeIpBans,
  activeJails,
  activeMutes,
  characterJail,
  charactersAt,
  expireModeration,
  ipBan,
  ipBansFrom,
  moderationHistory,
  normalizeIpBans,
  noteAddress,
  pruneModeration,
  recordModeration,
} from "./persistence/moderation.ts";
import { loadSlots, saveSlots } from "./persistence/monsters.ts";
import { loadNewspaper, saveNewspaper } from "./persistence/newspapers.ts";
import { insertNpcFileVersion, loadNpcFiles, saveNpcFile } from "./persistence/npcfiles.ts";
import { deletePlayerShops, insertPlayerShop, loadPlayerShops } from "./persistence/playershops.ts";
import { loadAccountPreferencesRecord, saveAccountPreferences } from "./persistence/preferences.ts";
import {
  deleteRole,
  loadRoles,
  roleHolders,
  saveRole,
  staffAccounts,
} from "./persistence/roles.ts";
import { loadSettingOverrides, saveSettingOverride } from "./persistence/settings.ts";
import {
  loadFactionPowers,
  loadQuestLines,
  saveFactionPowers,
  saveQuestLine,
} from "./persistence/social.ts";
import { loadSpellbook, saveSpellbook } from "./persistence/spells.ts";
import type { Rng } from "./rng.ts";
import {
  applySettingValues,
  DAY_SECONDS,
  deathDropRules,
  resolveSettings,
  type Settings,
  secondsToTicks,
  settingPages,
  settingRows,
} from "./settings.ts";
import {
  type ActivityFields,
  checkPlayer,
  holdingsOf,
  logActivity,
  logBagChange,
  logEditorPlacements,
  resetHoldings,
} from "./systems/admin/activity.ts";
import {
  applyLive,
  type EditDeps,
  logEdit,
  type Prepared,
  prepareEdit,
  prepareUndo,
} from "./systems/admin/character-edit.ts";
import { characterHub, type HubDeps, liveSheet, searchRows } from "./systems/admin/characters.ts";
import {
  type AdminDeps,
  adminWarp,
  applyRole,
  moderate,
  permissionsMsg,
} from "./systems/admin/commands.ts";
import { createContentWorld } from "./systems/admin/content-world.ts";
import { openControlPanel } from "./systems/admin/control-panel.ts";
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
import { closeNpcWindows, loadNpc, openNpcEditor, saveNpc } from "./systems/admin/npcedit.ts";
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
  refundHolds,
  savedGold,
  tablePlayers,
} from "./systems/casino/blackjack.ts";
import { ckClose, ckMove } from "./systems/casino/checkers.ts";
import { type CasinoDeps, casinoLeave, casinoReturn } from "./systems/casino/index.ts";
import { slotClose, slotPull } from "./systems/casino/slots.ts";
import { type ChatDeps, handleChat, helpReply, whoReply } from "./systems/chat/chat.ts";
import { ignoreModify } from "./systems/chat/ignore.ts";
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
  monthCheck,
  placeCancel,
  placeHouseIntent,
} from "./systems/housing/houses.ts";
import {
  actionIntent,
  arrangeIntent,
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
import { noteShown, pressStep, scheduleStep, setHeld } from "./systems/movement/movement.ts";
import { type AssassinDeps, setAssassinMode } from "./systems/social/assassin.ts";
import { bioRequest, profileSave } from "./systems/social/bios.ts";
import { friendsCommand, friendsEntry } from "./systems/social/friends.ts";
import {
  type GuildDeps,
  guildAction,
  guildClose,
  guildCreate,
  guildLogin,
  guildView,
} from "./systems/social/guilds.ts";
import { presenceOut, whoNames } from "./systems/social/presence.ts";
import { castIntent } from "./systems/spells/cast.ts";
import {
  fallbackTarget,
  flushInventory,
  portalOpen,
  respawnTarget,
  type TickDeps,
  tick,
} from "./systems/world/tick.ts";
import {
  addPlayer,
  createWorld,
  groundView,
  inventoryView,
  newSpellState,
  type Outgoing,
  type Player,
  type Room,
  removePlayer,
  sessionCombatState,
  toWorldMap,
  vitalsView,
  type World,
  type WorldMap,
} from "./systems/world/world.ts";
import type { TickProbe } from "./tick-stats.ts";

/** Delivers a message to a player's live connection (`Send`). */
export type Send = (playerId: string, msg: ServerMsg) => void;

export interface GameDeps {
  db: Db;
  /**
   * The live content store's service (packs, operator layer, draft and publish), for the Control
   * Panel's Content page. Absent in tests that build a game alone: the page then answers that
   * there is no content service.
   */
  content?: ContentService;
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
  /** Server infrastructure (`SSO_*` variables); defaults to `DEFAULT_SERVER_CONFIG`. */
  config?: ServerConfig;
}

/**
 * A help file by the name `gethelp` received: the server read its help text files from a Windows
 * disk, so the match ignores case.
 */
export function helpLines(topic: string): readonly string[] | null {
  const want = topic.toLowerCase();
  return content().help.topics.find((t) => t.topic.toLowerCase() === want)?.lines ?? null;
}

export type LoginResult =
  | { ok: true; accountId: string; characterId: string; name: string }
  | { ok: false; text: string };

export interface Game {
  readonly world: World;
  /** The settings in force; replaced when an operator saves them or runs `/Refresh`. */
  readonly settings: Settings;
  /** Server infrastructure, fixed for the process (config.ts). */
  readonly config: ServerConfig;
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
  /** A World or NPC Editor user may send editor-sized frames (`EDITOR_MESSAGE_BYTES`). */
  canEdit(characterId: string): boolean;
  /** Roles that bypass login limits are exempt from the per-address socket count. */
  canModerate(characterId: string): boolean;
  /** A player holding an unspent canvas or film may send an art-sized frame. */
  canUpload(characterId: string): boolean;
  intent(characterId: string, msg: InGameMsg): void;
  /** One sim tick: movement, deltas, saves. False if it threw (rolled back and logged). */
  tick(): boolean;
  /** Saves everyone online (shutdown). */
  saveAll(): void;
  /** Writes the buffered chat lines and activity now (shutdown, after the last logouts). */
  flushLogs(): void;
  /**
   * A new content store was installed (a publish or an undo): the NPC files are laid over it
   * again and every player in game is told the new hash, so their clients fetch it.
   */
  contentPublished(hash: string, restoring?: boolean): void;
  /** The world as the content service sees it: where-used, removal cleanup and problems (#28). */
  readonly contentWorld: ContentWorld;
  /**
   * The content contract's point settings (start, fallback, jail) that cannot hold a player, judged
   * with the content installed now (issue #37).
   */
  contractPointProblems(): ContentProblem[];
}

/**
 * The intents the editors and the Control Panel take, with its Server Settings page; every
 * other intent is ignored while editing.
 */
const EDITOR_INTENTS = new Set([
  "controlPanelOpen",
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
  "roleSave",
  "roleDelete",
  "roleAssign",
  "activityQuery",
  "characterSearch",
  "characterOpen",
  "characterModerate",
  "characterEdit",
  "characterUndo",
  ...CONTENT_INTENTS,
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
  // Player settings and Who's Online work over editors too.
  "prefsSave",
  "ignoreAdd",
  "ignoreRemove",
  "whoOpen",
]);

/**
 * Admin intents an honest client sends only for a role with the permission (in the matching editor), with the
 * cheat log reason 1.6's own gate wrote for that tool: the World Editor's SAVE ("Attempted Admin
 * Access") and the NPC editor's ("Attempting to get Admin access"). Settings take the World
 * Editor's.
 */
const ADMIN_INTENTS: Readonly<Record<string, { permission: Permission; reason: string }>> = {
  editOpen: { permission: "worldEditor", reason: "Attempted Admin Access" },
  editLoad: { permission: "worldEditor", reason: "Attempted Admin Access" },
  editSave: { permission: "worldEditor", reason: "Attempted Admin Access" },
  npcEditOpen: { permission: "npcEditor", reason: "Attempting to get Admin access" },
  npcLoad: { permission: "npcEditor", reason: "Attempting to get Admin access" },
  npcSave: { permission: "npcEditor", reason: "Attempting to get Admin access" },
  settingsOpen: { permission: "settings", reason: "Attempted Admin Access" },
  settingsSave: { permission: "settings", reason: "Attempted Admin Access" },
  roleSave: { permission: "settings", reason: "Attempted Admin Access" },
  roleDelete: { permission: "settings", reason: "Attempted Admin Access" },
  roleAssign: { permission: "settings", reason: "Attempted Admin Access" },
  activityQuery: { permission: "activityLog", reason: "Attempted Admin Access" },
  // The player hub; each moderation button also needs its own command's permission.
  characterSearch: { permission: "characterView", reason: "Attempted Admin Access" },
  characterOpen: { permission: "characterView", reason: "Attempted Admin Access" },
  characterModerate: { permission: "characterView", reason: "Attempted Admin Access" },
  characterEdit: { permission: "characterEditor", reason: "Attempted Admin Access" },
  characterUndo: { permission: "characterEditor", reason: "Attempted Admin Access" },
  // The Content page (issue #27).
  ...Object.fromEntries(
    CONTENT_INTENTS.map((t) => [
      t,
      { permission: "contentEditor", reason: "Attempted Admin Access" },
    ]),
  ),
  // Menu 502's Assassin items: 1.6's server just ignored anyone but an immortal.
  assassinGame: { permission: "assassinGame", reason: "Attempted Admin Access" },
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

/**
 * A grid map's name as the world spells it, `x0y0` for `X00Y0`: a setting naming a map (the jail,
 * the bell's map) is compared with live maps' names, so a spelling `/warp` would accept must not
 * miss them.
 */
function canonicalMapName(name: string): string {
  const c = parseMapName(name);
  return c ? mapName(c.mx, c.my) : name;
}

export function createGame(deps: GameDeps): Game {
  const { db, send, isoNow, rng } = deps;
  const minute = deps.minute ?? (() => new Date().getUTCMinutes());
  let lastMinute = minute();
  /** The skill keys online characters' skill lists are in (`SKILL_KEYS` when they were built). */
  let skillKeys = SKILL_KEYS;
  /**
   * Puts every online character's skills (and the copies the activity log and the medal check
   * compare against) in the order of the installed store's skills, by key. A skill the store
   * dropped has its value written, so it is there if the skill returns; a skill the store added
   * takes the value saved for it, else `NEW_SKILL_VALUE`, as a login does. `restoring` (the store
   * a failed publish replaced going back) writes nothing: the publish's writes were rolled back,
   * and the world's rollback puts every list back as it was.
   */
  const followSkills = (restoring: boolean) => {
    const was = skillKeys;
    skillKeys = SKILL_KEYS;
    if (was.length === skillKeys.length && was.every((k, i) => k === skillKeys[i])) {
      return;
    }
    const byKey = (list: readonly number[]): SkillValues =>
      Object.fromEntries(was.map((k, i) => [k, list[i] ?? NEW_SKILL_VALUE]));
    const dropped = was.filter((k) => findSkillIndex(k) === undefined);
    for (const o of world.players.values()) {
      const values = byKey(o.char.skills);
      if (dropped.length > 0 && !restoring) {
        saveSkillValues(db, o.id, Object.fromEntries(dropped.map((k) => [k, values[k] ?? 0])));
      }
      // Saved values are matched as a login matches them (another spelling counts).
      const saved = skillsFromKeys(loadSkillValues(db, o.id));
      const now = skillsFromKeys(values, (k) => saved[findSkillIndex(k) ?? -1] ?? NEW_SKILL_VALUE);
      // A new skill reads the same in the copies as on the character, so it logs no gain.
      const copy = (list: readonly number[]) =>
        skillsFromKeys(byKey(list), (k) => now[findSkillIndex(k) ?? -1] ?? NEW_SKILL_VALUE);
      if (o.activityProgress) {
        o.activityProgress.skills = copy(o.activityProgress.skills);
      }
      if (o.awardSkills) {
        o.awardSkills = copy(o.awardSkills);
      }
      o.char.skills = now;
    }
  };
  /** Accounts with a `Password=` hash in flight. */
  const passwordBusy = new Set<string>();
  const crashPoint = (label: string) => deps.crashPoint?.(label);
  const nowMs = deps.nowMs ?? (() => Date.parse(isoNow()));
  /** Failed-login and creation counts; a restart clears them. */
  const limits = newLoginLimits();
  let settings = resolveSettings(loadSettingOverrides(db));
  const config: ServerConfig = { ...DEFAULT_SERVER_CONFIG, ...deps.config };
  // The content store's NPC files with the NPC editor's saves on top, laid again after a publish.
  const npcs = archiveNpcStore();
  const layNpcFiles = () => {
    npcs.clear();
    for (const [k, f] of archiveNpcStore()) {
      npcs.set(k, f);
    }
    for (const f of loadNpcFiles(db)) {
      setNpcFile(npcs, npcFileNamed(npcs, f.npc)?.name ?? f.npc, f.text);
    }
  };
  layNpcFiles();
  const world = createWorld(npcs);
  /** The special bodies bound when the store was installed, to follow them across a publish. */
  let boundBodies = content().bindings.bodies;
  world.roleTags = settings.roleTags;
  world.jail = { ...settings.jailPoint, map: canonicalMapName(settings.jailPoint.map) };
  /** The operator's roles by id (persistence/roles.ts), read at start and after every change. */
  let roles = new Map<string, RoleDef>();
  const reloadRoles = () => {
    roles = new Map(loadRoles(db).map((r) => [r.id, r]));
  };
  reloadRoles();
  /** An account's role by its stored id; an id with no role (deleted) is no role. */
  const roleOf = (id: string | null): Role => (id === null ? null : (roles.get(id) ?? null));
  // IP bans from before keys get their standard form; lapsed bans and old addresses go.
  normalizeIpBans(db, isoNow());
  pruneModeration(db, isoNow(), settings.addressHistory / DAY_SECONDS);
  /** Forgets chat lines, activity and audit rows past their retention settings. */
  const pruneLogs = () => {
    pruneChatLog(db, isoNow(), settings.chatLogRetention / DAY_SECONDS);
    pruneActivity(db, isoNow(), settings.activityLogRetention / DAY_SECONDS);
    pruneAudit(db, isoNow(), settings.auditLogRetention / DAY_SECONDS);
  };
  pruneLogs();
  /** The logs are pruned again an hour after the last time. */
  let logPruneAt = nowMs() + 3_600_000;
  /** Lapsed bans, IP bans, sentences and mutes are logged as ended once a minute. */
  let moderationExpireAt = nowMs() + 60_000;
  /**
   * The chat lines and activity events written in the open transaction, still kept in memory: they
   * leave the buffers only once it commits (`commitLogs`), so a rollback writes them again later.
   */
  let chatWritten = 0;
  let activityWritten = 0;
  /** Writes the chat lines and activity logged since the last write (`world.chatLog`, `.activity`). */
  const flushChatLog = () => {
    if (world.chatLog.length > chatWritten) {
      insertChatLog(db, world.chatLog.slice(chatWritten), isoNow());
      chatWritten = world.chatLog.length;
    }
    if (world.activity.length > activityWritten) {
      insertActivity(db, world.activity.slice(activityWritten), isoNow());
      activityWritten = world.activity.length;
    }
  };
  /** The transaction that wrote them committed: they leave the buffers. */
  const commitLogs = () => {
    world.chatLog.splice(0, chatWritten);
    world.activity.splice(0, activityWritten);
    chatWritten = 0;
    activityWritten = 0;
  };
  /** The transaction rolled back: what it wrote is unwritten and stays to be written again. */
  const rollbackLogs = () => {
    chatWritten = 0;
    activityWritten = 0;
  };
  // Named containers: the Cauldrons and carried crates and cabinets.
  world.containers = loadContainers(db);
  // The house blueprints and list.
  for (const h of loadHouses(db)) {
    world.houses.set(h.interior, h);
  }
  world.houseList = loadHouseList(db);
  // Player shops: their files came in with the NPC editor's saves above.
  for (const s of loadPlayerShops(db)) {
    world.playerShops.set(s.npc.toLowerCase(), s);
  }
  // Faction powers and quest lines: each faction's `startPower` on the first start (Classic: the
  // archive's 27:123:0).
  const powers = loadFactionPowers(db);
  if (powers) {
    world.factionPowers = powers;
  } else {
    world.factionPowers = startingPowers();
    saveFactionPowers(db, world.factionPowers);
  }
  const quests = loadQuestLines(db);
  if (quests) {
    world.questLines = quests;
  }
  // A line that names no NPC (1.6's roll 29, or the archive's ":Steel Key:Trumpet"), or an item
  // the catalogue no longer has or has retired (Dantan's Water Orb), can never be answered: it is
  // replaced by a new quest as the lines are loaded or seeded.
  db.transaction(() => {
    for (const [i, text] of world.questLines.entries()) {
      if (questLineUnanswerable(text)) {
        world.questLines[i] = findNewQuest(rng);
      }
      if (!quests || world.questLines[i] !== text) {
        saveQuestLine(db, i + 1, world.questLines[i] ?? "");
      }
    }
  })();
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

  /** Where a map name is: its grid position, exit slot and cache key, or null for no map name. */
  const mapPlace = (name: string) => {
    // A house interior is its outdoor map's position and exit slot. Names match ignoring case, so
    // the cache is keyed by the map's own spelling: a second copy of a live map (`X1000Y992`) would
    // write stale monster slots over the live ones at the next save.
    const h = parseHouseMapName(name);
    const c = h ?? parseMapName(name);
    if (!c) {
      return null;
    }
    const slot: 0 | 1 | 2 = h ? h.slot : 0;
    return { mx: c.mx, my: c.my, slot, key: anyMapName(c.mx, c.my, slot) };
  };

  const loadMap = (name: string): WorldMap | null => {
    // A name that is no map at all is not cached, so typed names cannot grow the cache.
    const c = mapPlace(name);
    if (!c) {
      return null;
    }
    const key = c.key;
    if (mapCache.has(key)) {
      return mapCache.get(key) ?? null;
    }
    const rec = findMapByCoords(db, c.mx, c.my, c.slot);
    const m = rec
      ? toWorldMap({ ...rec, slots: slotsFor(rec.id), ground: groundFor(rec.id) })
      : null;
    mapCache.set(key, m);
    return m;
  };

  /**
   * A map as the content contract's check reads it, changing nothing: the loaded map when it is in
   * memory, else its saved tiles and ground items (a map loaded only to be checked would be saved
   * back with empty monster slots).
   */
  const peekMap = (name: string): PointMap | null => {
    const c = mapPlace(name);
    if (!c) {
      return null;
    }
    if (mapCache.has(c.key)) {
      return mapCache.get(c.key) ?? null;
    }
    const rec = findMapByCoords(db, c.mx, c.my, c.slot);
    return rec ? { layers: rec.layers, ground: peekGround(db, rec.id, isoNow()) } : null;
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
      ...(g.ownerId ? { ownerId: g.ownerId } : {}),
      ...(g.hull != null ? { hull: g.hull } : {}),
      ...(g.parkedAt ? { parkedAt: Date.parse(g.parkedAt) } : {}),
      ...(g.facing ? { facing: g.facing } : {}),
      ...(g.droppedById && g.droppedBy
        ? { droppedBy: { id: g.droppedById, name: g.droppedBy } }
        : {}),
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
      return secondsToTicks(config.reconnectGrace);
    },
    addGoldOffline: (id, delta) => {
      addGoldOffline(db, id, delta);
      crashPoint("bj:offlineCredit");
    },
    logOffline: (id, type, f) => logOffline(id, type, f),
  };

  const probe = deps.probe;
  const tickDeps: TickDeps = {
    phase: probe ? (name) => probe.phase(name) : undefined,
    casino: casinoDeps,
    loadMap,
    loadMapById,
    fallbackPoint: settings.fallbackPoint,
    minute,
    now: nowMs,
    lootDecayMinutes: settings.lootDecay / 60,
    npcChatterSeconds: settings.npcChatter,
    deathDrops: deathDropRules(settings),
    portalTargets: settings.portalTargets,
    hazardMap: settings.hazardMap && canonicalMapName(settings.hazardMap),
    bellMap: settings.bellMap && canonicalMapName(settings.bellMap),
    saveIntervalTicks: secondsToTicks(config.saveInterval),
    rng,
  };

  const chatDeps: ChatDeps = {
    maxChars: settings.chatMaxChars,
    broadcastCooldownFrames: secondsToTicks(settings.broadcastCooldown),
    chatCooldownFrames: secondsToTicks(settings.chatCooldown),
    helpLines,
    saveSlots: (m) => saveMapSlots(m),
    itemCtx: () => itemCtx(),
    rng,
    mapHeader: (name) => loadMap(name)?.title ?? "",
    saveIgnores: (accountId, list) => db.transaction(() => saveIgnores(db, accountId, list))(),
    saveBuddies: (accountId, items) => db.transaction(() => saveBuddies(db, accountId, items))(),
    // `Password=`: hashed off the tick, through the server-wide hash queue. The reply comes once
    // the hash is stored (or says it failed), one change in flight per account, and a change ends
    // the character's other resume tokens (an account logs in to its first character only, so
    // these are all the account's sessions).
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
              hull: g.hull ?? null,
              parkedAt: g.parkedAt == null ? null : new Date(g.parkedAt).toISOString(),
              facing: g.facing ?? null,
              droppedById: g.droppedBy?.id ?? null,
              droppedBy: g.droppedBy?.name ?? null,
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
              hull: p.hull,
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
    chatCooldownFrames: secondsToTicks(settings.chatCooldown),
    mailBodyMax: settings.mailBodyMax,
    mailboxMax: settings.mailboxMax,
  };
  const boardDeps: BoardDeps = {
    chatCooldownFrames: secondsToTicks(settings.chatCooldown),
    boardPostsMax: settings.boardPostsMax,
    boardPostMax: settings.boardPostMax,
  };

  /**
   * Where a player who is no prisoner leaves the jail's map for: their respawn point, or the
   * Fallback map when that is gone or on the jail's map (a jail moved onto a map they had made
   * their respawn point).
   */
  const outOfJail = (respawn: Player["char"]["respawn"]) => {
    const to = respawnTarget(respawn, tickDeps);
    return to && !isJailMap(to.map.name, world.jail.map) ? to : fallbackTarget(tickDeps);
  };

  /**
   * Puts a jail point in force. A jail moved to another map takes its online prisoners with it, so
   * the old map no longer holds them (it is an ordinary map now) and their release still sends them
   * home. Offline prisoners arrive at the new jail at their next login. Anyone else on the new
   * jail's map, staff apart, goes to their respawn point, as a login there would send them.
   */
  const moveJail = (
    jail: { map: string; x: number; y: number },
    tell: (out: readonly Outgoing[]) => void,
  ) => {
    const old = world.jail;
    world.jail = jail;
    if (isJailMap(old.map, jail.map)) {
      return;
    }
    const warpDeps = { loadMap, casino: casinoDeps };
    for (const p of [...world.players.values()]) {
      if (p.jailUntil !== null && isJailMap(p.map.name, old.map)) {
        tell(adminWarp(world, p, jail.map, jail.x, jail.y, warpDeps));
      } else if (p.jailUntil === null && isJailMap(p.map.name, jail.map) && !isStaff(p.role)) {
        const to = outOfJail(p.char.respawn);
        if (to) {
          tell(adminWarp(world, p, to.map.name, to.x, to.y, warpDeps));
        }
      }
    }
  };

  /**
   * Puts new settings in force at once: every reader takes its value from these deps, and clients
   * get the rules they predict with.
   */
  const applySettings = (next: Settings, tell: (out: readonly Outgoing[]) => void = deliver) => {
    const rulesBefore = settings.chatMaxChars;
    settings = next;
    moveJail({ ...settings.jailPoint, map: canonicalMapName(settings.jailPoint.map) }, tell);
    Object.assign(tickDeps, {
      fallbackPoint: settings.fallbackPoint,
      lootDecayMinutes: settings.lootDecay / 60,
      npcChatterSeconds: settings.npcChatter,
      deathDrops: deathDropRules(settings),
      portalTargets: settings.portalTargets,
      hazardMap: settings.hazardMap && canonicalMapName(settings.hazardMap),
      bellMap: settings.bellMap && canonicalMapName(settings.bellMap),
    });
    Object.assign(chatDeps, {
      maxChars: settings.chatMaxChars,
      broadcastCooldownFrames: secondsToTicks(settings.broadcastCooldown),
      chatCooldownFrames: secondsToTicks(settings.chatCooldown),
    });
    Object.assign(artDeps, { artBytesMax: settings.artBytesMax });
    Object.assign(mailDeps, {
      chatCooldownFrames: secondsToTicks(settings.chatCooldown),
      mailBodyMax: settings.mailBodyMax,
      mailboxMax: settings.mailboxMax,
    });
    Object.assign(boardDeps, {
      chatCooldownFrames: secondsToTicks(settings.chatCooldown),
      boardPostsMax: settings.boardPostsMax,
      boardPostMax: settings.boardPostMax,
    });
    world.roleTags = settings.roleTags;
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
  /** An activity log event for a character who is not online (an offline payout or prize). */
  const logOffline = (characterId: string, type: ActivityType, f: ActivityFields) => {
    const c = findCharacterById(db, characterId);
    if (c) {
      logActivity(world, { id: c.id, accountId: c.accountId, name: c.name }, type, f);
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
        const r = invAdd(inv, prize, 1, rng);
        saveInventory(db, characterId, inv, isoNow());
        // A full bag loses the prize, as it does online.
        logOffline(
          characterId,
          "reward",
          r.kind === "gold"
            ? { gold: r.amount, details: { prize: "Assassin" } }
            : r.kind === "full"
              ? { item: prize, details: { prize: "Assassin", lost: 1 } }
              : { item: prize, qty: 1, details: { prize: "Assassin" } },
        );
      })();
    },
  };
  const adminDeps: AdminDeps = {
    findCharacter: (name) => {
      const c = findCharacterAccount(db, name);
      return c && { ...c, role: roleOf(c.roleId) };
    },
    moderation: {
      accountBan: (accountId) => accountBan(db, accountId),
      jail: (characterId) => characterJail(db, characterId),
      mute: (accountId) => accountMute(db, accountId),
      ipBan: (key) => ipBan(db, key),
      ipBansFrom: (accountId) => ipBansFrom(db, accountId),
      record: (e) => {
        recordModeration(db, e);
      },
      addresses: (accountId) => accountAddresses(db, accountId),
      charactersAt: (key) => charactersAt(db, key),
      activeBans: (now) => activeBans(db, now),
      activeJails: (now) => activeJails(db, now),
      activeMutes: (now) => activeMutes(db, now),
      activeIpBans: (now) => activeIpBans(db, now),
      history: (accountId, limit) => moderationHistory(db, accountId, limit),
    },
    chatLog: (q) => {
      flushChatLog();
      return chatLogLines(db, q);
    },
    auditTrail: (q) => auditTrail(db, q),
    now: isoNow,
    durations: () => ({
      banMinutes: settings.banLength / 60,
      ipBanMinutes: settings.ipBanLength / 60,
      jailMinutes: settings.jailSentence / 60,
      muteMinutes: settings.muteLength / 60,
    }),
    setClass: (characterId, code) => {
      // An online target's change is logged by the next progress check; an offline one's here.
      const was = world.players.has(characterId)
        ? null
        : (findCharacterById(db, characterId)?.classCode ?? null);
      setClassCode(db, characterId, code, isoNow());
      if (was !== null && was !== code) {
        logOffline(characterId, "class", {
          details: { from: className(was) ?? String(was), to: className(code) ?? String(code) },
        });
      }
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
    loadMapById,
    fallbackPoint: () => settings.fallbackPoint,
    casino: casinoDeps,
  };
  chatDeps.admin = adminDeps;

  // ---- the player hub (issue #26) ----------------------------------------------------------------
  const hubDeps: HubDeps = {
    findCharacter: adminDeps.findCharacter,
    search: (query) => searchCharacters(db, query, CHARACTER_SEARCH_LIMIT),
    roleName: (id) => roleOf(id)?.name ?? null,
    stored: (id) => loadStoredCharacter(db, id),
    times: (id) => characterTimes(db, id),
    edits: (id) => characterEdits(db, id, HUB_EDITS),
    accountBan: (accountId) => accountBan(db, accountId),
    jail: (characterId) => characterJail(db, characterId),
    mute: (accountId) => accountMute(db, accountId),
    history: (accountId, limit) => moderationHistory(db, accountId, limit),
    chatLog: (name, limit) => {
      flushChatLog();
      return chatLogLines(db, { name, limit });
    },
    addresses: (accountId) => accountAddresses(db, accountId),
    ipBan: (key) => ipBan(db, key),
    mapName: (id) => findMapById(db, id)?.name ?? id,
    now: isoNow,
  };

  /** Opens a player hub. Every read is audited, as `/chatlog` is (the hub may hold their chat). */
  const characterOpen = (p: Player, msg: Extract<InGameMsg, { t: "characterOpen" }>): ServerMsg => {
    const hub = characterHub(world, p, msg.name, hubDeps);
    insertAudit(
      db,
      {
        actor: p.accountId,
        command: "characterView",
        target: hub?.name ?? msg.name.trim(),
        after: { chat: hub?.chat !== undefined, addresses: hub?.addresses !== undefined },
      },
      isoNow(),
    );
    return hub
      ? { t: "characterHub", seq: msg.seq, hub }
      : { t: "characterHub", seq: msg.seq, hub: null, error: HUB_TEXT.notFound(msg.name.trim()) };
  };

  /**
   * A hub moderation button: the command's own code and checks. Its lines to the staff member
   * come back as the result; it worked when it wrote to the audit log, as every action does.
   */
  const characterModerate = (p: Player, msg: Extract<InGameMsg, { t: "characterModerate" }>) => {
    const result = (ok: boolean, text: string) =>
      send(p.id, { t: "characterResult", seq: msg.seq, ok, text });
    if (!can(p.role, msg.action)) {
      cheat(p.name, p.ip, "Attempted Admin Access");
      // A role changed under an open hub still gets an answer, not a page left waiting.
      result(false, HUB_TEXT.notAllowed);
      return;
    }
    const timed = TIMED_HUB_ACTIONS.includes(msg.action);
    if (timed && msg.reason.trim() === "") {
      result(false, HUB_TEXT.needReason);
      return;
    }
    const args = hubArgs(timed ? msg.duration : "", msg.reason);
    if (!args) {
      result(false, HUB_TEXT.badDuration);
      return;
    }
    let done = false;
    const out = moderate(world, p, msg.action, msg.name.trim(), args, {
      ...adminDeps,
      audit: (e) => {
        done = true;
        audit(e);
      },
    });
    const mine = (o: Outgoing) => o.to === p.id && o.msg.t === "chat";
    deliver(out.filter((o) => !mine(o)));
    const text = out
      .filter(mine)
      .map((o) => (o.msg.t === "chat" ? o.msg.text : ""))
      .join(" ");
    result(done, text);
    deliverKicks();
  };

  // ---- the character editor (issue #26) ----------------------------------------------------------
  const editDeps: EditDeps = {
    findCharacter: adminDeps.findCharacter,
    stored: (id) => loadStoredCharacter(db, id),
    loadMap,
    mapName: (id) => findMapById(db, id)?.name ?? id,
    jailedOffline: (id) => isActive(characterJail(db, id), isoNow()),
    writeOffline: (stored, a, mapIds) => {
      const id = stored.record.id;
      const now = isoNow();
      // The vehicle, hull and facing the editor leaves alone, as saved.
      const r = findCharacterById(db, id);
      if (!r) {
        return;
      }
      saveProgress(
        db,
        id,
        {
          position: {
            mapId: mapIds.position,
            x: a.position.x,
            y: a.position.y,
            facing: r.position.facing,
          },
          vitals: {
            level: a.level,
            hp: a.hp,
            hpMax: a.hpMax,
            sp: a.sp,
            spMax: a.spMax,
            exp: a.exp,
            expNeeded: a.expNeeded,
          },
          hunger: a.hunger,
          skills: skillsFromKeys(a.skills),
          respawn:
            a.respawn && mapIds.respawn
              ? { mapId: mapIds.respawn, x: a.respawn.x, y: a.respawn.y }
              : null,
          faction: { key: a.faction, count: a.factionCount },
          wanted: a.wanted,
          stats: {
            str: a.str,
            sta: a.sta,
            dex: a.dex,
            int: a.int,
            wis: a.wis,
          },
          vehicle: r.vehicle,
          hull: r.hull,
        },
        now,
      );
      saveLookAndClass(db, id, { classCode: a.classCode, sex: a.sex, head: a.head }, now);
      saveInventory(
        db,
        id,
        {
          gold: a.gold,
          bag: a.bag.map((l) => (l ? { item: l.item, qty: l.qty } : null)),
          equip: { ...a.equip },
        },
        now,
      );
      if (a.bank !== null) {
        saveBank(db, id, a.bank, now);
      }
      saveVault(db, id, a.vault);
      saveSpellbook(db, id, a.spellbook);
    },
    casino: casinoDeps,
    rng,
  };

  /**
   * Applies a checked edit or undo in the intent's transaction: the live character (then written
   * at once, so a save can never put the old values back) or the saved one, the log row, the
   * audit row and the activity events. Returns the new edit's id.
   */
  const applyEdit = (
    p: Player,
    e: Extract<Prepared, { ok: true }>["edit"],
    reason: string,
    undoOf: string | null,
  ): string => {
    logEdit(world, e, p, "", "before");
    const t = e.online;
    const mark = world.activity.length;
    try {
      if (t) {
        deliver(applyLive(world, t, e, editDeps));
        if (t.vitalsDirty) {
          t.vitalsDirty = false;
          send(t.id, { t: "vitals", vitals: vitalsView(t) });
        }
        // Progress, class and look now; the inventory, bank, vault and spellbook with
        // `persistItems`.
        save(t);
        saveLookAndClass(
          db,
          t.id,
          { classCode: t.char.classCode, sex: t.char.sex, head: t.head },
          isoNow(),
        );
        t.invSaveDue = true;
        flushChanged([t]);
        // A move can set the respawn point on arrival: the log records what the character ends
        // as, not only what was asked.
        e.after = editableOf(liveSheet(world, t, editDeps.mapName));
        e.changes = diffEdit(e.before, e.after);
      } else if (e.stored) {
        editDeps.writeOffline(e.stored, e.after, e.mapIds);
      }
    } catch (err) {
      // The writes roll back with the intent, but the live character changed in memory: take
      // them off so they reload from the database, as the intent's own player is.
      if (t) {
        dropActivity(t.id, mark);
        deps.kick?.(t.id, TEXT.serverError);
        if (world.players.has(t.id)) {
          evict(t.id);
        }
      }
      throw err;
    }
    const id = insertCharacterEdit(
      db,
      {
        actorAccountId: p.accountId,
        actorName: p.name,
        characterId: e.target.characterId,
        character: e.target.name,
        reason,
        changes: e.changes,
        override: e.override,
        undoOf,
      },
      isoNow(),
    );
    logEdit(world, e, p, id, "after");
    insertAudit(
      db,
      {
        actor: p.accountId,
        command: undoOf ? "characterUndo" : "characterEdit",
        target: e.target.name,
        before: Object.fromEntries(e.changes.map((c) => [c.field, c.before])),
        after: { edit: id, ...(undoOf ? { undoOf } : {}), reason },
      },
      isoNow(),
    );
    return id;
  };

  const characterEdit = (p: Player, msg: Extract<InGameMsg, { t: "characterEdit" }>) => {
    const result = (ok: boolean, text: string) =>
      send(p.id, { t: "characterResult", seq: msg.seq, ok, text });
    const reason = msg.reason.trim().split(/\s+/).join(" ");
    if (reason === "") {
      result(false, EDIT_TEXT.needReason);
      return;
    }
    const r = prepareEdit(world, msg, editDeps);
    if (!r.ok) {
      result(false, r.text);
      return;
    }
    applyEdit(p, r.edit, reason, null);
    result(true, EDIT_TEXT.saved(r.edit.target.name, r.edit.changes.length));
  };

  const characterUndo = (p: Player, msg: Extract<InGameMsg, { t: "characterUndo" }>) => {
    const result = (ok: boolean, text: string) =>
      send(p.id, { t: "characterResult", seq: msg.seq, ok, text });
    const reason = msg.reason.trim().split(/\s+/).join(" ");
    if (reason === "") {
      result(false, EDIT_TEXT.needReason);
      return;
    }
    const r = prepareUndo(world, { name: msg.name, edit: findCharacterEdit(db, msg.id) }, editDeps);
    if (!r.ok) {
      result(false, r.text);
      return;
    }
    applyEdit(p, r.edit, reason, msg.id);
    result(true, EDIT_TEXT.undone(r.edit.target.name));
  };

  /** Server Settings window SAVE: the `settings` permission only; every changed value audited. */
  const settingsSave = (p: Player, values: Record<string, unknown>) => {
    if (!can(p.role, "settings")) {
      cheat(p.name, p.ip, "Attempted Admin Access");
      return;
    }
    const r = applySettingValues(settings, values);
    if (!r.ok) {
      send(p.id, { t: "settingsResult", ok: false, key: r.key, text: r.error });
      return;
    }
    // The content contract: a start, fallback or jail point must hold a player. One already broken
    // (a map deleted since) may stay while another setting is saved.
    for (const key of Object.keys(CONTRACT_POINTS) as ContractPoint[]) {
      const problem = r.changed.some((c) => c.key === key)
        ? pointProblem(r.settings[key], peekMap)
        : null;
      if (problem !== null) {
        send(p.id, { t: "settingsResult", ok: false, key, text: `${problem}.` });
        return;
      }
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
    send(p.id, settingsMsg());
    send(p.id, { t: "settingsResult", ok: true });
  };

  /** The Server Settings window's contents: the pages, the settings, the roles and the staff. */
  /**
   * The Activity Log page's query: a page of one character's timeline or one item's flow, newest
   * first. A character is found by name; one that was deleted is still read by the name it was
   * logged under. Every read is audited, as `/chatlog` is.
   */
  const activityQuery = (
    p: Player,
    asked: Extract<InGameMsg, { t: "activityQuery" }>,
  ): ServerMsg => {
    const q = { ...asked, name: asked.name.trim(), types: asked.types.filter(isActivityType) };
    flushChatLog();
    const c = q.scope === "character" ? findCharacterAccount(db, q.name) : null;
    const scope: ActivityScope =
      q.scope === "item" ? { item: q.name } : c ? { characterId: c.characterId } : { name: q.name };
    const rows = activityRows(db, {
      scope,
      types: q.types,
      since: q.since,
      until: q.until,
      before: q.before,
      limit: q.limit + 1,
    });
    const more = rows.length > q.limit;
    rows.length = Math.min(rows.length, q.limit);
    const first = q.before === null;
    // Every read is audited, a further page too (its cursor is the client's, not the server's).
    insertAudit(
      db,
      {
        actor: p.accountId,
        command: "activityLog",
        target: c?.name ?? q.name,
        after: {
          scope: q.scope,
          types: q.types,
          since: q.since,
          until: q.until,
          ...(q.before ? { before: q.before.at } : {}),
        },
      },
      isoNow(),
    );
    const error =
      first &&
      rows.length === 0 &&
      q.scope === "character" &&
      !c &&
      q.types.length === 0 &&
      q.since === null &&
      q.until === null
        ? ADMIN_TEXT.noSuchCharacter(q.name)
        : undefined;
    return {
      t: "activity",
      seq: q.seq,
      rows,
      more,
      ...(first && q.scope === "item" ? itemTotals(q.name, q.since, q.until) : {}),
      ...(error ? { error } : {}),
    };
  };

  /** An item's totals, over at most its newest `ACTIVITY_TOTALS_MAX` events (the tick waits for it). */
  const itemTotals = (item: string, since: string | null, until: string | null) => {
    const r = activityItemTotals(db, item, since, until, ACTIVITY_TOTALS_MAX);
    return { totals: r.totals, ...(r.capped ? { totalsCapped: ACTIVITY_TOTALS_MAX } : {}) };
  };

  const settingsMsg = (): ServerMsg => {
    const holders = roleHolders(db);
    return {
      t: "settings",
      pages: settingPages(),
      rows: settingRows(settings),
      roles: [...roles.values()].map((r) => ({
        ...roleToData(r),
        holders: holders.get(r.id) ?? 0,
      })),
      staff: staffAccounts(db).map((a) => ({ name: a.name, role: a.role })),
    };
  };

  /**
   * After the roles or an assignment change: everyone online takes their account's role as the
   * database now holds it, and those whose role changed get their new permissions at once.
   */
  const refreshRoles = () => {
    reloadRoles();
    for (const o of [...world.players.values()]) {
      const next = roleOf(findAccountById(db, o.accountId)?.role ?? null);
      if (
        JSON.stringify(next && roleToData(next)) !== JSON.stringify(o.role && roleToData(o.role))
      ) {
        deliver(applyRole(world, o, next));
      }
    }
  };

  /** A role change from the Server Settings page: refused with why, or applied and audited. */
  const roleChange = (p: Player, change: () => string | { done: string }) => {
    const r = db.transaction(change)();
    if (typeof r === "string") {
      send(p.id, { t: "roleResult", ok: false, text: r });
      return;
    }
    refreshRoles();
    // An edit to your own role can take Server Settings away: then the lists are not yours to see.
    if (can(p.role, "settings")) {
      send(p.id, settingsMsg());
    }
    send(p.id, { t: "roleResult", ok: true, text: r.done });
  };

  /** Roles page → Save: a new role or a change to one. */
  const roleSave = (p: Player, data: RoleData, create: boolean) =>
    roleChange(p, () => {
      const bad = roleDataError(data);
      if (bad) {
        return bad;
      }
      const was = roles.get(data.id) ?? null;
      if (create && was) {
        return ROLE_TEXT.taken(data.id);
      }
      if (!create && !was) {
        return ROLE_TEXT.noRole(data.id);
      }
      const role = roleFromData(data);
      const next = [...roles.values()].filter((r) => r.id !== role.id).concat(role);
      const locked = rolesError(next);
      if (locked) {
        return locked;
      }
      const now = isoNow();
      saveRole(db, role, now);
      insertAudit(
        db,
        {
          actor: p.accountId,
          command: create ? "role create" : "role edit",
          target: role.id,
          before: was && roleToData(was),
          after: roleToData(role),
        },
        now,
      );
      return { done: ROLE_TEXT.saved(role.name) };
    });

  /** Roles page → Delete: the role goes and its accounts are left with no role. */
  const roleDelete = (p: Player, id: string) =>
    roleChange(p, () => {
      const was = roles.get(id);
      if (!was) {
        return ROLE_TEXT.noRole(id);
      }
      const locked = rolesError([...roles.values()].filter((r) => r.id !== id));
      if (locked) {
        return locked;
      }
      const now = isoNow();
      const held = staffAccounts(db).filter((a) => a.role === id);
      deleteRole(db, id, now);
      insertAudit(
        db,
        {
          actor: p.accountId,
          command: "role delete",
          target: id,
          before: { ...roleToData(was), accounts: held.map((a) => a.name) },
          after: null,
        },
        now,
      );
      return { done: ROLE_TEXT.deleted(was.name) };
    });

  /** Staff page: gives a character's account a role, or none. */
  const roleAssign = (p: Player, name: string, roleId: string | null) =>
    roleChange(p, () => {
      const c = findCharacterAccount(db, name.trim());
      if (!c) {
        return ADMIN_TEXT.noSuchCharacter(name.trim());
      }
      if (c.accountId === p.accountId) {
        return ROLE_TEXT.self;
      }
      const role = roleId === null ? null : roles.get(roleId);
      if (role === undefined) {
        return ROLE_TEXT.noRole(roleId ?? "");
      }
      if (c.roleId === (role?.id ?? null)) {
        return ROLE_TEXT.unchanged(c.name);
      }
      const now = isoNow();
      setRole(db, c.accountId, role?.id ?? null, now);
      insertAudit(
        db,
        {
          actor: p.accountId,
          command: "role assign",
          target: c.name,
          before: c.roleId,
          after: role?.id ?? null,
        },
        now,
      );
      return { done: ROLE_TEXT.assigned(c.name, role?.name ?? null) };
    });

  /** Everyone online and every loaded map written now (`/save`, shutdown). */
  const saveEveryone = () => {
    const all = [...world.players.values()];
    const maps = [...mapCache.values()].filter((m): m is WorldMap => !!m);
    db.transaction(() => {
      all.forEach(save);
      maps.forEach(saveMapSlots);
      flushChatLog();
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

  /** The world as the Content page's where-used and removal cleanup see it (issue #28). */
  const contentWorld = createContentWorld({
    store: contentWorldStore(db),
    world,
    loadedMaps: () => [...mapCache.values()].filter((m): m is WorldMap => !!m),
    rng,
    deliver,
    saveSlots: (m) => saveMapSlots(m),
    persist: (players, out) => flushChanged(players, out),
    now: () => isoNow(),
    ledgerOf: (npc) => ledgerOf(npc),
  });

  /**
   * After an intent outside the tick: sends `inv` to everyone in `players` whose inventory changed
   * and writes those inventories, banks, vaults, NPC ledgers and ground items in one transaction.
   */
  const flushChanged = (
    players: readonly Player[],
    out: (o: readonly Outgoing[]) => void = deliver,
  ) => {
    const changed: Player[] = [];
    for (const o of players) {
      out(flushInventory(world, o));
      if (o.invSaveDue || o.char.storeDirty) {
        o.invSaveDue = false;
        changed.push(o);
      }
    }
    persistItems(changed);
  };

  /** Before each save, the list drops any line that names no spell, as the saved form does. */
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
        faction: { key: p.char.faction.key, count: p.char.factionCount },
        wanted: p.char.wanted,
        stats: p.char.stats,
        vehicle: p.vehicle,
        hull: p.hull,
      },
      isoNow(),
    );
  };

  /**
   * SAVE: World Editor users in the editor only (the original checked only in the client). The old map is
   * kept as a version; the map, its slots and its placed items are written together.
   */
  /** Today in the house decay time zone, `YYYY-MM-DD`. */
  const houseDay = (): string =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: settings.houseDecayTimeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(nowMs()));
  /** This month in the house decay time zone, `YYYY-MM`. */
  const houseMonth = (): string => houseDay().slice(0, 7);

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
   * characters saved there go to the fallback point, not their respawn point (1.6's missing map
   * sent them to the start point).
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
      // A respawn point inside the interior goes with it.
      db.query("UPDATE characters SET respawn_map_id = NULL WHERE respawn_map_id = ?").run(rec.id);
      const to = fallbackTarget(tickDeps);
      if (to) {
        db.query("UPDATE characters SET map_id = ?, x = ?, y = ? WHERE map_id = ?").run(
          to.map.id,
          to.x,
          to.y,
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

  /** One clock check from `p`: refresh, the day's sweep if it has not run, then demolish. */
  const houseMonthCheck = (p: Player) => {
    const day = houseDay();
    const demolitions = monthCheck(world, p, day.slice(0, 7), day);
    const out: Outgoing[] = [];
    for (const d of demolitions) {
      out.push(...demolish(world, d.interior, loadMap).out);
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
    if (!can(p.role, "worldEditor") || p.editing !== "world") {
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
      const placedBefore = target.ground.filter((g) => g.kind === "admin");
      result = applySave(world, target, m, () => Bun.randomUUIDv7());
      logEditorPlacements(world, p, target.name, placedBefore, result.added);
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
    // Servers before blueprints were kept per house overwrote a second house's record on the same
    // map while its interior lived on, so an interior is an orphan only when no record and no list
    // entry names its outdoor map.
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

  /** The IP ban notice for an address in force, or null. */
  const ipBanRefusal = (ip: string): string | null => {
    if (ip === "") {
      return null;
    }
    const b = ipBan(db, ipKey(ip));
    return isActive(b, isoNow()) ? banNotice(ADMIN_TEXT.ipBanned, b?.expiresAt ?? null) : null;
  };
  /** Why an account may not play: its ban, or its address's (unless its role bypasses IP bans). */
  const banRefusal = (accountId: string, role: Role, ip: string): string | null => {
    const b = accountBan(db, accountId);
    if (isActive(b, isoNow())) {
      return banNotice(ADMIN_TEXT.banned, b?.expiresAt ?? null);
    }
    return can(role, "bypassIpBan") ? null : ipBanRefusal(ip);
  };

  const core: Game = {
    world,
    get settings() {
      return settings;
    },
    config,
    contentWorld,
    contractPointProblems: () => pointProblems(settings, peekMap),

    async login(name, password, ip = "") {
      const account = findAccountByUsername(db, name);
      // SSO's login limits. An address over its per-address count is refused, except for a role
      // with `bypassLoginLimits` (an operator behind a shared address must still get in), and
      // then only while that account has no failure from the address in the window: one honest
      // try, not a free run of guesses at a staff password once the address is spent.
      const exempt = account !== null && can(roleOf(account.role), "bypassLoginLimits");
      if (
        !allowLoginFromIp(limits, ip, nowMs(), settings.loginFailsPerIp) &&
        !(exempt && account && allowLoginToAccount(limits, account.id, ip, nowMs(), 1))
      ) {
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
      // back. An IP ban is checked after the password too, so that it never stops a role that
      // bypasses it (1.6 checked the address on connect; the reply did nothing).
      const refused = banRefusal(account.id, roleOf(account.role), ip);
      if (refused) {
        return { ok: false, text: refused };
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
      const ipRefused = ipBanRefusal(ip);
      if (ipRefused) {
        return { ok: false, text: ipRefused };
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
      // A publish during the hash may have taken the class off the screen: checked again.
      const late = creationError(choice);
      if (late) {
        unnoteCreate(limits, ip, counted);
        return { ok: false, text: late };
      }
      const now = isoNow();
      let made: { id: string; accountId: string; name: string } | null = null;
      try {
        db.transaction(() => {
          const account = insertAccount(db, { username: msg.name, passwordHash, now });
          const characterId = insertCharacter(db, {
            accountId: account.id,
            start: startingCharacter(choice),
            // Load Character's Facing = "N" is overwritten by the play-entry setup's Facing = "S":
            // every login faces south.
            // The starting map is also the new character's first respawn point.
            position: { mapId: map.id, x: sp.x, y: sp.y, facing: "S" },
            now,
          });
          made = { id: characterId, accountId: account.id, name: msg.name };
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
      // What a new character starts with is where those items came from, logged once it exists.
      if (made) {
        const who: { id: string; accountId: string; name: string } = made;
        logBagChange(world, who, "reward", new Map(), holdingsOf(loadInventory(db, who.id)), {
          details: { start: true },
        });
        stampChat();
      }
      return { ok: true };
    },

    refusal(characterId, ip) {
      const c = findCharacterById(db, characterId);
      const account = c ? findAccountById(db, c.accountId) : null;
      return account ? banRefusal(account.id, roleOf(account.role), ip) : ipBanRefusal(ip);
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
      // A saved map that is gone: the fallback point, never their respawn point.
      if (!map) {
        const to = fallbackTarget(tickDeps);
        if (!to) {
          return false;
        }
        ({ map, x, y } = to);
      }
      // A sentence in force puts the prisoner in jail wherever they were saved; a player on the
      // jail map without one (it ended while they were away) goes to their respawn point.
      const now = isoNow();
      noteAddress(db, account.id, ip, now, settings.addressHistory / DAY_SECONDS);
      const sentence = characterJail(db, c.id);
      const jailUntil = isActive(sentence, now) ? endMs(sentence?.expiresAt ?? null) : null;
      const mute = accountMute(db, account.id);
      const muteUntil = isActive(mute, now) ? endMs(mute?.expiresAt ?? null) : null;
      const jail = world.jail;
      const jailMap =
        jailUntil !== null && !isJailMap(map.name, jail.map) ? loadMap(jail.map) : null;
      if (jailMap) {
        map = jailMap;
        x = jail.x;
        y = jail.y;
      } else if (
        jailUntil === null &&
        isJailMap(map.name, jail.map) &&
        !isStaff(roleOf(account.role))
      ) {
        const to = outOfJail(c.respawn);
        if (to) {
          ({ map, x, y } = to);
        }
      }
      const p: Player = {
        id: c.id,
        accountId: c.accountId,
        name: c.name,
        head: c.head,
        role: roleOf(account.role),
        map,
        x,
        y,
        // Load Character's Facing = "N" is overwritten by the play-entry setup's Facing = "S", for
        // new and loaded characters alike. A resumed session keeps its facing.
        facing: resumed ? c.position.facing : "S",
        stepFrames: 0,
        vehicle: c.vehicle,
        hull: c.vehicle ? (c.hull ?? hullMax(c.vehicle)) : null,
        held: null,
        heldTurn: false,
        pending: null,
        loading: 0,
        n: 0,
        resumed,
        saveIn: secondsToTicks(config.saveInterval),
        lastSent: null,
        forceYou: false,
        broadcastIn: 0,
        chatIn: 0,
        unsentLogIn: 0,
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
          faction: sortFaction(factionKeyOf(c.faction.key), world.factionPowers),
          factionCount: c.faction.count,
          wanted: c.wanted,
          respawn: c.respawn,
          sex: c.sex,
          profile: c.profile,
        },
        ...sessionCombatState(),
        ip,
        spell: {
          ...newSpellState(loadSpellbook(db, c.id)),
          body: c.vehicle ? VEHICLE_BODY[c.vehicle] : null,
        },
      };
      p.jailUntil = jailUntil;
      p.muteUntil = muteUntil;
      p.ignore = loadIgnores(db, c.accountId);
      p.buddies = loadBuddies(db, c.accountId);
      const prefRec = loadAccountPreferencesRecord(db, c.accountId);
      p.prefs = prefRec.prefs;
      p.prefsStored = prefRec.stored;
      const kept = keptSocial.get(c.id);
      if (resumed) {
        p.regenCounter = keptRegen.get(c.id) ?? p.regenCounter;
        p.away = kept?.away ?? null;
      }
      keptRegen.delete(c.id);
      keptSocial.delete(c.id);
      // The login names the address; the activity ledger starts once a blackjack seat is back.
      logActivity(world, p, "login", { details: { ip, resumed: resumed || null } });
      send(p.id, permissionsMsg(p.role));
      send(p.id, { t: "prefs", prefs: p.prefs, ignores: [...p.ignore], stored: p.prefsStored });
      deliver(addPlayer(world, p));
      // The guild loads with the character; a resumed session greets nobody.
      deliver(guildLogin(world, p, loadCharacterGuild(db, c.id), resumed));
      if (resumed) {
        deliver(rejoinRoom(world, p, kept?.room ?? null));
      }
      persistItems([]);
      send(p.id, { t: "spellbook", spells: [...p.spell.book] });
      // A blackjack seat held through the grace reopens as it was.
      deliver(casinoReturn(world, p));
      resetHoldings(p);
      flushChanged(tablePlayers(world, p)); // a hand that settled while away
      // Frame 50 fills the Friends window; it opens only from the menu.
      deliver(friendsEntry(world, p));
      deliver(presenceOut(world, p, true));
      // Loading the character sends Help.txt as the greeting. A resumed session is not a login.
      if (!resumed) {
        deliver(helpReply(p, "Help", chatDeps));
        // Game entry asks for the news after the greeting; the client decides whether to print
        // it.
        if (settings.news !== "") {
          send(p.id, { t: "news", text: settings.news });
        }
        // A prisoner or a muted player is told why, and until when, each time they log in.
        if (p.jailUntil !== null) {
          const text = MODERATION_TEXT.youAreJailed(endIso(p.jailUntil));
          send(p.id, { t: "chat", text, color: CHAT_COLOR.normal });
        }
        if (p.muteUntil !== null) {
          const text = MODERATION_TEXT.youAreMuted(endIso(p.muteUntil));
          send(p.id, { t: "chat", text, color: CHAT_COLOR.normal });
        }
      }
      // The clock's minute (the first clock request at entry).
      send(p.id, { t: "minute", minute: minute() });
      if (!resumed) {
        // A login is a clock check: the player's houses are seen this month.
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
        // Anything no event explained is logged before they go.
        checkPlayer(world, leaving);
        logActivity(world, leaving, "logout", { details: { ip: leaving.ip || null } });
      }
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
      deliver(presenceOut(world, r.player, false));
    },

    isOnline(characterId) {
      return world.players.has(characterId);
    },

    canEdit(characterId) {
      const p = world.players.get(characterId);
      return (
        p !== undefined &&
        (can(p.role, "worldEditor") || can(p.role, "npcEditor") || can(p.role, "contentEditor"))
      );
    },

    canModerate(characterId) {
      const p = world.players.get(characterId);
      return p !== undefined && can(p.role, "bypassLoginLimits");
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
      // The editors, Settings and the Assassin's Game need their permission; 1.6's own gates
      // logged these too.
      const gate = ADMIN_INTENTS[msg.t];
      if (gate && (!can(p.role, gate.permission) || !editingOk(p, msg.t))) {
        cheat(p.name, p.ip, gate.reason);
        return;
      }
      if ((CONTENT_INTENTS as readonly string[]).includes(msg.t)) {
        const service = deps.content;
        const seq = "seq" in msg ? msg.seq : 0;
        send(
          p.id,
          service
            ? contentIntent(
                service,
                { accountId: p.accountId, name: p.name },
                msg as Parameters<typeof contentIntent>[2],
                contentWorld,
              )
            : { t: "contentResult", seq, ok: false, text: "This server has no content service." },
        );
        return;
      }
      switch (msg.t) {
        case "settingsOpen":
          send(p.id, settingsMsg());
          return;
        case "roleSave":
          roleSave(p, msg.role, msg.create);
          return;
        case "roleDelete":
          roleDelete(p, msg.id);
          return;
        case "roleAssign":
          roleAssign(p, msg.name, msg.role);
          return;
        case "settingsSave":
          settingsSave(p, msg.values);
          return;
        case "settingsClose":
          return;
        case "activityQuery":
          send(p.id, activityQuery(p, msg));
          return;
        case "characterSearch":
          send(p.id, {
            t: "characterList",
            seq: msg.seq,
            rows: searchRows(world, msg.query, hubDeps),
          });
          return;
        case "characterOpen":
          send(p.id, characterOpen(p, msg));
          return;
        case "characterModerate":
          characterModerate(p, msg);
          return;
        case "characterEdit":
          characterEdit(p, msg);
          return;
        case "characterUndo":
          characterUndo(p, msg);
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
          {
            // The Canvas or Film goes in, the Painting or Photo comes out.
            const before = holdingsOf(p.char);
            deliver(artSaveIntent(p, msg.kind, msg.png, artStore, artDeps));
            logBagChange(world, p, "craft", before, holdingsOf(p.char), {
              details: { craft: msg.kind },
            });
          }
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
          deliver(openEditor(world, p, loadMap, parseMapName(p.map.name), casinoDeps));
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
          deliver(openNpcEditor(world, p, casinoDeps));
          return;
        // The Control Panel: any of its permissions opens it; 1.6 had none, so the World Editor's
        // reason is logged, as for Server Settings.
        case "controlPanelOpen":
          if (!canOpenControlPanel(p.role)) {
            cheat(p.name, p.ip, "Attempted Admin Access");
            return;
          }
          deliver(openControlPanel(world, p, casinoDeps));
          return;
        case "npcLoad":
          deliver(loadNpc(world, p, msg.name, ledgerOf));
          return;
        case "npcSave":
          npcSave(p, msg.name, msg.text);
          return;
        case "move":
          setHeld(p, msg.held, msg.turn, msg.scheduled);
          return;
        case "step":
          if (msg.at) {
            scheduleStep(p, msg);
          } else {
            pressStep(p, msg.dir, msg.turn);
          }
          return;
        case "mapReady":
          p.loading = 0;
          return;
        // IM, Away and chat rooms.
        case "im":
          deliver(imIntent(world, p, msg.to, msg.text, msg.via, chatDeps));
          return;
        case "away":
          deliver(setAway(world, p, msg.text, chatDeps));
          return;
        case "roomEnter":
          // Admin Chat needs `adminChat` (1.6: an immortal's, menu 502); anyone else is ignored, not disconnected as 1.6
          // did, and logged.
          if (msg.room === "admin" && !can(p.role, "adminChat")) {
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
            profileSave(world, p, msg.text, (profile) =>
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
        case "prefsSave": {
          const next = mergePlayerPrefs(msg.prefs, p.prefs);
          const req = msg.requestId !== undefined ? { requestId: msg.requestId } : {};
          if (p.prefsStored && prefsEqual(next, p.prefs)) {
            send(p.id, {
              t: "prefsResult",
              ok: true,
              text: "Settings saved.",
              ...req,
              prefs: p.prefs,
            });
            return;
          }
          try {
            db.transaction(() => saveAccountPreferences(db, p.accountId, next, isoNow()))();
          } catch {
            send(p.id, {
              t: "prefsResult",
              ok: false,
              text: "Could not save settings.",
              ...req,
              prefs: p.prefs,
            });
            return;
          }
          for (const o of world.players.values()) {
            if (o.accountId === p.accountId) {
              o.prefs = next;
              o.prefsStored = true;
              send(o.id, { t: "prefs", prefs: next, ignores: [...o.ignore], stored: true });
            }
          }
          send(p.id, {
            t: "prefsResult",
            ok: true,
            text: "Settings saved.",
            ...req,
            prefs: next,
          });
          return;
        }
        case "ignoreAdd":
          deliver(
            ignoreModify(world, p, "add", msg.name, (id, list) => chatDeps.saveIgnores?.(id, list)),
          );
          return;
        case "ignoreRemove":
          deliver(
            ignoreModify(world, p, "remove", msg.name, (id, list) =>
              chatDeps.saveIgnores?.(id, list),
            ),
          );
          return;
        case "whoOpen":
          send(p.id, { t: "who", names: whoNames(world) });
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
        case "arrange":
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
                      ? dropIntent(ctx, room, p, msg.slot, msg.n)
                      : msg.t === "give"
                        ? giveIntent(ctx, room, p, msg.slot, msg.n)
                        : msg.t === "arrange"
                          ? arrangeIntent(p, msg.from, msg.to)
                          : msg.t === "unequip"
                            ? unequipIntent(ctx, room, p, msg.slot)
                            : msg.t === "pickup"
                              ? pickupIntent(ctx, room, p, msg.id)
                              : msg.t === "action"
                                ? actionIntent(ctx, room, p)
                                : msg.t === "crystals"
                                  ? crystalsIntent(ctx, room, p, msg.slot, msg.n, msg.mode)
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
            send(p.id, { t: "vitals", vitals: vitalsView(p) });
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
          const r = castIntent(room, p, msg.spell, msg.x, msg.y, {
            rng,
            world,
            portalOpen: () => portalOpen(tickDeps),
          });
          deliver(r.out);
          if (p.vitalsDirty) {
            p.vitalsDirty = false;
            send(p.id, { t: "vitals", vitals: vitalsView(p) });
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
            if (r.grabbed) {
              logActivity(world, p, "pickup", { item: r.grabbed, qty: 1, other: r.grabbed });
            }
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
              : withdrawVault(world, p, msg.index, rng),
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
          const t = p.trade ? world.trades.get(p.trade) : undefined;
          const partner = t ? (t.a === p.id ? t.b : t.a) : undefined;
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
      try {
        // Stakes at the tables go back first, so the saved purses and the log agree.
        refundHolds(world, casinoDeps);
        saveEveryone();
        commitLogs();
      } catch (err) {
        rollbackLogs();
        throw err;
      }
    },

    contentPublished(hash, restoring = false) {
      // An NPC whose file changed starts its shop again, as an NPC Editor save does: its ledger and
      // saved shop go, and its open Bio and shop windows close. So does an NPC whose file the
      // publish removed.
      const before = new Map([...npcs].map(([k, f]) => [k, { name: f.name, text: f.text }]));
      layNpcFiles();
      // Putting back the store a failed publish replaced: the saved ledgers rolled back with it, so
      // they are read again rather than reset.
      const restart = (name: string) => {
        world.shops.delete(name);
        if (!restoring) {
          deleteShop(db, name);
        }
        contentWorld.tell(closeNpcWindows(world, name));
      };
      for (const [k, f] of npcs) {
        if (before.get(k)?.text !== f.text) {
          restart(f.name);
        }
      }
      for (const [k, f] of before) {
        if (!npcs.has(k)) {
          restart(f.name);
        }
      }
      // Everyone online keeps their skills by key when the publish adds, removes or moves one,
      // and every sheet is sent again: the Skills tab's rows may have changed.
      followSkills(restoring);
      for (const o of world.players.values()) {
        o.lastSheet = "";
        // A member's tier follows the store's tier rows; a faction the store dropped gives none of
        // its perks (the membership stays saved, for the faction to return to).
        o.char.faction = sortFaction(factionKeyOf(o.char.faction.key), world.factionPowers);
      }
      // Setting defaults drawn from content (the Assassin prizes) follow it.
      // Its moves (a jail point changed since the settings were read) wait with the publish.
      applySettings(resolveSettings(loadSettingOverrides(db)), (o) => contentWorld.tell(o));
      // A body the engine put on a player follows its binding: a rider shows the vehicle's new
      // body, and a tree or smoke shows the new one (or ends, unbound), so clients that now read
      // the new bindings see what the player is. Any other body (a morph) that is now a rider's,
      // the tree or the smoke ends, or clients would take the player for one.
      const bodiesWere = boundBodies;
      boundBodies = content().bindings.bodies;
      const special = new Set([
        ...Object.values(boundBodies.riders),
        ...(boundBodies.tree === undefined ? [] : [boundBodies.tree]),
        ...(boundBodies.smoke === undefined ? [] : [boundBodies.smoke]),
      ]);
      const bodyEvents = new Map<Room, DeltaEvent[]>();
      for (const o of world.players.values()) {
        const body = o.spell.body;
        let next = body;
        if (o.vehicle) {
          next = VEHICLE_BODY[o.vehicle];
        } else if (body !== null && body === bodiesWere.tree) {
          next = boundBodies.tree ?? null;
        } else if (body !== null && body === bodiesWere.smoke) {
          next = boundBodies.smoke ?? null;
        } else if (body !== null && special.has(body)) {
          next = null;
        }
        if (body !== null && body === bodiesWere.smoke && next === null) {
          o.spell.smokeBomb = 0; // its timer would end a later body
        }
        const room = world.rooms.get(o.map.name);
        if (next !== body && room) {
          o.spell.body = next;
          const events = bodyEvents.get(room) ?? [];
          events.push({ e: "body", id: o.id, body: next });
          bodyEvents.set(room, events);
        }
      }
      // Walkability comes from the tile tables: every loaded map's grids are worked out again.
      for (const room of world.rooms.values()) {
        const m = room.map;
        m.walk = footWalkGrid(m.layers[0], m.layers[1]);
        m.walkAir = airshipWalkGrid(m.layers[1]);
        m.walkShip = shipWalkGrid(m.layers[0]);
      }
      // Every client is told the new store, then gets its inventory and the ground items around it
      // again (their art may have changed); the client holds them until the new store is in. During
      // a publish this waits until it commits, so a publish that fails tells nobody anything.
      const told = new Set<string>();
      const out: Outgoing[] = [];
      for (const room of world.rooms.values()) {
        const events: DeltaEvent[] = [
          ...(bodyEvents.get(room) ?? []),
          ...room.map.ground.map((g) => ({ e: "gadd" as const, item: groundView(g) })),
        ];
        for (const o of room.players) {
          told.add(o.id);
          out.push({ to: o.id, msg: { t: "content", hash } });
          out.push({ to: o.id, msg: { t: "inv", inv: inventoryView(o) } });
          if (events.length > 0) {
            out.push({ to: o.id, msg: { t: "delta", events } });
          }
        }
      }
      for (const o of world.players.values()) {
        if (!told.has(o.id)) {
          out.push({ to: o.id, msg: { t: "content", hash } });
        }
      }
      contentWorld.tell(out);
    },

    flushLogs() {
      try {
        db.transaction(flushChatLog)();
        commitLogs();
      } catch (err) {
        rollbackLogs();
        throw err;
      }
    },
  };

  // One guard per entry point: the synchronous body of an intent, tick, enter or leave is one SQL
  // transaction inside a catch. A throw rolls back every write of that call; memory is not rolled
  // back, so the player whose action threw is logged out and a re-login reloads them from SQL.
  const fault =
    deps.onFault ?? ((where: string, err: unknown) => console.error(`fault in ${where}`, err));
  const inner = { enter: core.enter, leave: core.leave, intent: core.intent, tick: core.tick };
  /** Forgets `characterId`'s activity events logged since `mark` (a call that threw and evicted them). */
  const dropActivity = (characterId: string, mark: number) => {
    const kept = world.activity.slice(mark).filter((e) => e.characterId !== characterId);
    world.activity.splice(mark, world.activity.length - mark, ...kept);
  };
  /** A logged line or event takes the time its intent ended, not the time it was written. */
  const stampChat = () => {
    const now = isoNow();
    for (const log of [world.chatLog, world.activity]) {
      for (let i = log.length - 1; i >= 0; i--) {
        const e = log[i];
        if (!e || e.at !== undefined) {
          break;
        }
        e.at = now;
      }
    }
  };
  return Object.assign(core, {
    enter(characterId: string, resumed: boolean, ip?: string) {
      const mark = world.activity.length;
      try {
        const r = db.transaction(() => inner.enter(characterId, resumed, ip))();
        commitLogs();
        return r;
      } catch (err) {
        rollbackLogs();
        fault("enter", err);
        evict(characterId);
        dropActivity(characterId, mark);
        return false;
      } finally {
        stampChat();
      }
    },
    leave(characterId: string) {
      const mark = world.activity.length;
      try {
        db.transaction(() => inner.leave(characterId))();
        commitLogs();
      } catch (err) {
        rollbackLogs();
        fault("leave", err);
        evict(characterId);
        dropActivity(characterId, mark);
      }
      stampChat();
    },
    intent(characterId: string, msg: InGameMsg) {
      const mark = world.activity.length;
      try {
        db.transaction(() => inner.intent(characterId, msg))();
        commitLogs();
      } catch (err) {
        // A read (the Activity Log, /chatlog) may have written the buffers: that rolled back too.
        rollbackLogs();
        // Their writes rolled back and they reload from SQL, so their events from this call go
        // too. Others keep theirs: their memory, which is what gets saved, did change.
        dropActivity(characterId, mark);
        // A server fault is a bug, not cheating: it goes to the error log, naming who it hit, and
        // never to the cheat log.
        const p = world.players.get(characterId);
        fault(`intent ${msg.t} from ${p?.name ?? characterId}`, err);
        deps.kick?.(characterId, TEXT.serverError);
        // A kick without a gateway (tests) still takes the player off the map.
        if (world.players.has(characterId)) {
          evict(characterId);
        }
      }
      stampChat();
    },
    tick() {
      deps.probe?.begin();
      // The chat log is written in its own transaction, so a tick that throws still keeps it.
      try {
        db.transaction(() => {
          flushChatLog();
          if (nowMs() >= logPruneAt) {
            logPruneAt = nowMs() + 3_600_000;
            pruneLogs();
          }
          if (nowMs() >= moderationExpireAt) {
            moderationExpireAt = nowMs() + 60_000;
            expireModeration(db, isoNow());
          }
        })();
        commitLogs();
      } catch (err) {
        rollbackLogs();
        fault("chat log", err);
      }
      let ok: boolean;
      try {
        db.transaction(() => inner.tick())();
        commitLogs();
        ok = true;
      } catch (err) {
        rollbackLogs();
        fault("tick", err);
        ok = false;
      }
      // Whatever no event explained since the last check is logged as unlogged. No SQL: it only
      // fills the buffer, outside the tick's transaction, and is timed with the tick's last phase.
      for (const p of world.players.values()) {
        checkPlayer(world, p);
      }
      if (ok) {
        deps.probe?.end();
      }
      // The tick's events take the time it ended.
      stampChat();
      // A Ctrl pressed during the short item-action pause runs once the pause ends, through the
      // same guarded intent path as a fresh press.
      for (const p of [...world.players.values()]) {
        if (p.actionQueued && p.itemPause === 0) {
          p.actionQueued = false;
          core.intent(p.id, { t: "action" });
        }
      }
      return ok;
    },
  });
}
