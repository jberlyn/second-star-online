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
  blankMap,
  CHARACTER_SEARCH_LIMIT,
  CHAT_COLOR,
  type ContentMapsView,
  type CreateMsg,
  CURRENCY,
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
  goldPileName,
  HOUSE_ADMIN_TEXT,
  type HousePreview,
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
  lingoEq,
  MODERATION_TEXT,
  mapName,
  mergePlayerPrefs,
  NEW_SKILL_VALUE,
  NO_FOG,
  type NpcSections,
  nightlyDue,
  normaliseXp,
  PASSWORD_TEXT,
  type Permission,
  parseHouseMapName,
  parseMapName,
  prefsEqual,
  questLineUnanswerable,
  RECONCILE_RUNS_SHOWN,
  ROLE_TEXT,
  type Role,
  type RoleData,
  type RoleDef,
  reconcileItems,
  roleDataError,
  roleFromData,
  rolesError,
  roleToData,
  type ServerMsg,
  SKILL_KEYS,
  type SkillValues,
  savedSpellbook,
  skillsFromKeys,
  sortFaction,
  startingCharacter,
  startingPowers,
  syncLevel,
  TEXT,
  TIMED_HUB_ACTIONS,
  vehicleBody,
  vehicleOfItem,
  vehicleRow,
  vehicleRows,
} from "@secondstaronline/shared";

import { DEFAULT_SERVER_CONFIG, type ServerConfig } from "./config.ts";
import {
  CONTRACT_POINTS,
  type ContractPoint,
  jailClash,
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
  loadSkillXp,
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
  expiredGround,
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
  latestMapVersionId,
  listInteriorMapNames,
  listMapPlacements,
  listMapVersions,
  mapVersionData,
  saveMap,
  saveMapExits,
  saveMapLayers,
  saveMapTitle,
  saveMapTitleAndSigns,
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
import {
  deletePlayerShops,
  insertPlayerShop,
  loadPlayerShops,
  setPlayerShopOwner,
} from "./persistence/playershops.ts";
import { loadAccountPreferencesRecord, saveAccountPreferences } from "./persistence/preferences.ts";
import {
  activityFlows,
  countHoldings,
  insertRun,
  lastActivitySeq,
  recentRuns,
  runCounts,
  runView,
  type StoredRun,
  saveCasinoHolds,
  takeCasinoHolds,
} from "./persistence/reconcile.ts";
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
  resolveSettings,
  type Settings,
  secondsToTicks,
  settingPages,
  settingRows,
} from "./settings.ts";
import {
  type ActivityFields,
  checkHoldings,
  checkPlayer,
  holdingsOf,
  logActivity,
  logBagChange,
  logEditorPlacements,
  logWorld,
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
  type HouseAdminDeps,
  housePreview,
  houseSnapshot,
  hubHouses,
  moveOut,
  ownedHouse,
  previewSummary,
  transferHouse,
} from "./systems/admin/house-admin.ts";
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
import { closeNpcWindows } from "./systems/admin/npcedit.ts";
import { npcPageView, saveNpcPage } from "./systems/admin/npcpage.ts";
import { npcFileView, saveNpcSections } from "./systems/admin/npcsections.ts";
import {
  applySave,
  closeEditor,
  editorMap,
  editorView,
  SAVED,
  saveError,
  versionData,
} from "./systems/admin/worldedit.ts";
import {
  bjBid,
  bjHit,
  bjLeave,
  bjStand,
  closeTablesOn,
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
  houseVaultOf,
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
import { bodyOf, type MonsterSlot } from "./systems/monsters/slots.ts";
import { noteShown, pressStep, scheduleStep, setHeld } from "./systems/movement/movement.ts";
import { type AssassinDeps, endRemovedGame, setAssassinMode } from "./systems/social/assassin.ts";
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
  /**
   * Runs the item reconciliation nightly, at the first tick after `RECONCILE_NIGHTLY_HOUR` UTC
   * (issue #35); main.ts turns it on. Off by default, so a test's clock never starts one.
   */
  nightlyReconcile?: boolean;
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
  /** A content editor may send editor-sized frames (`EDITOR_MESSAGE_BYTES`). */
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
  /**
   * The published store changed: tell every client (`assets`: the asset index's hash, when the
   * uploaded art may have changed with it).
   */
  contentPublished(hash: string, restoring?: boolean, assets?: string): void;
  /** The world as the content service sees it: where-used, removal cleanup and problems (#28). */
  readonly contentWorld: ContentWorld;
  /**
   * The content contract's checks that read the world, judged with the content installed now
   * (issue #37): the point settings (start, fallback, jail) that cannot hold a player.
   */
  contractPointProblems(): ContentProblem[];
  /**
   * The vehicles in use (issue #44), by the installed content's row names: how many characters
   * ride each (online or saved) and how many are parked (loaded maps from memory, the rest from
   * the database).
   */
  vehiclesInUse(): Map<string, { aboard: number; parked: number }>;
}

/**
 * The intents the editors and the Control Panel take, with its Server Settings page; every
 * other intent is ignored while editing.
 */
const EDITOR_INTENTS = new Set([
  "controlPanelOpen",
  "editClose",
  "settingsOpen",
  "settingsSave",
  "settingsClose",
  "roleSave",
  "roleDelete",
  "roleAssign",
  "activityQuery",
  "reconcileQuery",
  "reconcileRun",
  "characterSearch",
  "characterOpen",
  "characterModerate",
  "characterEdit",
  "characterUndo",
  "characterHousePreview",
  "characterHouseRevoke",
  "characterHouseTransfer",
  ...CONTENT_INTENTS,
  // The NPCs page (issue #32).
  "contentNpcs",
  "contentNpcSave",
  // The World page (issue #33).
  "contentMaps",
  "contentMapSave",
  "contentMapRestore",
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
  // The NPC file editor (issue #32, the Talk & Shops tab): the NPC Editor's reason.
  contentNpcs: { permission: "contentEditor", reason: "Attempting to get Admin access" },
  contentNpcSave: { permission: "contentEditor", reason: "Attempting to get Admin access" },
  // The World page (issue #33): the World Editor's reason.
  contentMaps: { permission: "contentEditor", reason: "Attempted Admin Access" },
  contentMapSave: { permission: "contentEditor", reason: "Attempted Admin Access" },
  contentMapRestore: { permission: "contentEditor", reason: "Attempted Admin Access" },
  settingsOpen: { permission: "settings", reason: "Attempted Admin Access" },
  settingsSave: { permission: "settings", reason: "Attempted Admin Access" },
  roleSave: { permission: "settings", reason: "Attempted Admin Access" },
  roleDelete: { permission: "settings", reason: "Attempted Admin Access" },
  roleAssign: { permission: "settings", reason: "Attempted Admin Access" },
  activityQuery: { permission: "activityLog", reason: "Attempted Admin Access" },
  reconcileQuery: { permission: "activityLog", reason: "Attempted Admin Access" },
  reconcileRun: { permission: "activityLog", reason: "Attempted Admin Access" },
  // The player hub; each moderation button also needs its own command's permission.
  characterSearch: { permission: "characterView", reason: "Attempted Admin Access" },
  characterOpen: { permission: "characterView", reason: "Attempted Admin Access" },
  characterModerate: { permission: "characterView", reason: "Attempted Admin Access" },
  characterEdit: { permission: "characterEditor", reason: "Attempted Admin Access" },
  characterUndo: { permission: "characterEditor", reason: "Attempted Admin Access" },
  // The hub's houses (issue #36): the preview is a read, the changes the editor's.
  characterHousePreview: { permission: "characterView", reason: "Attempted Admin Access" },
  characterHouseRevoke: { permission: "characterEditor", reason: "Attempted Admin Access" },
  characterHouseTransfer: { permission: "characterEditor", reason: "Attempted Admin Access" },
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

/** No admin intent belongs to one place any more: the World and NPC editors are Control Panel pages. */
function editingOk(_p: Player, _t: string): boolean {
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
    remapSkills(restoring);
    // XP totals held to the new content: a skill switched to `chance` keeps none, one switched to
    // `xp` starts at its level's total, and a changed curve holds each inside its level. A failed
    // publish's rollback puts the snapshot back instead.
    if (!restoring) {
      for (const o of world.players.values()) {
        if (o.char.skillXp) {
          o.char.skillXp = normaliseXp(o.char.skills, o.char.skillXp, o.char.faction);
        }
        // The character level under a changed curve (issue #42): same level, its XP need worked
        // out again, and a level-up for XP that now reaches it.
        const was = o.char.vitals.expNeeded;
        const gained = syncLevel(o.char.vitals);
        if (gained > 0 || o.char.vitals.expNeeded !== was) {
          o.vitalsDirty = true;
        }
      }
    }
  };
  const remapSkills = (restoring: boolean) => {
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
      // A dropped skill's value and XP are written, for it to come back to.
      const xpBy = Object.fromEntries(was.map((k, i) => [k, o.char.skillXp?.[i] ?? 0]));
      if (dropped.length > 0 && !restoring) {
        saveSkillValues(
          db,
          o.id,
          Object.fromEntries(dropped.map((k) => [k, values[k] ?? 0])),
          Object.fromEntries(dropped.map((k) => [k, xpBy[k] ?? 0])),
        );
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
      // XP totals follow their skills by key; a skill the store added takes its saved total.
      if (o.char.skillXp) {
        const savedXp = loadSkillXp(db, o.id);
        o.char.skillXp = skillsFromKeys(xpBy, (k) => savedXp[findSkillIndex(k) ?? -1] ?? 0);
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
    // Rows the next reconciliation run has still to read are kept (issue #35).
    pruneActivity(
      db,
      isoNow(),
      settings.activityLogRetention / DAY_SECONDS,
      recentRuns(db, 1)[0]?.lastSeq ?? null,
    );
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
  /** The stakes `casino_holds` holds, as last written (set once the startup refunds have run). */
  let holdsWritten = "";
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
  /**
   * Writes only the activity logged since the last write: each entry point does this in its own
   * transaction, so an item change and its row commit together (issue #35). Chat lines wait for
   * the tick.
   */
  const flushActivity = () => {
    if (world.activity.length > activityWritten) {
      insertActivity(db, world.activity.slice(activityWritten), isoNow());
      activityWritten = world.activity.length;
    }
  };
  /** The transaction that wrote them committed: they leave the buffers. */
  /**
   * What an intent holds back until its transaction commits (a house revoke or transfer, issue
   * #36): sent after the commit, dropped with a rollback.
   */
  const afterCommit: Outgoing[] = [];
  /** What puts an intent's memory changes back if its transaction rolls back (`houseChange`). */
  const rollbacks: (() => void)[] = [];
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
    // The stakes written may have rolled back with the purses: the next save writes them again.
    holdsWritten = "";
  };
  // Blackjack stakes a crash left held (a clean shutdown refunds them first): the saved purse
  // already counts each, as the restart gives it back, so the refund is logged as a clean
  // shutdown's is, and the log and the purse agree (issue #35).
  try {
    db.transaction(() => {
      for (const h of takeCasinoHolds(db)) {
        logActivity(world, { id: h.characterId, accountId: h.accountId, name: h.name }, "reward", {
          gold: h.gold,
          details: { game: "blackjack", refund: true, restart: true },
        });
      }
      flushChatLog();
    })();
    commitLogs();
  } catch (err) {
    rollbackLogs();
    throw err;
  }
  // The table is empty now; `persistItems` writes it again whenever the stakes change.
  holdsWritten = "[]";
  /** The stakes held at the blackjack tables now, by character. */
  const casinoHolds = (): Map<string, number> => {
    const m = new Map<string, number>();
    for (const t of world.casinoTables.values()) {
      if (t.game !== "blackjack") {
        continue;
      }
      t.seats.forEach((seat, i) => {
        const held = t.held[i] ?? 0;
        if (seat && held > 0) {
          m.set(seat.id, (m.get(seat.id) ?? 0) + held);
        }
      });
    }
    return m;
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
  endRemovedGame(world);
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
      ? toWorldMap({ ...rec, slots: slotsFor(rec.id), ground: groundFor(rec.id, rec.name) })
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

  /**
   * A map's ground items; loot already past its time is deleted on the way, and logged as decayed
   * (issue #35), as it is when it decays on a loaded map.
   */
  function groundFor(mapId: string, map: string) {
    const now = isoNow();
    for (const g of expiredGround(db, mapId, now)) {
      logWorld(world, "decay", g.item, -g.qty, { at: { map, x: g.x, y: g.y } });
    }
    return loadGround(db, mapId, now).map((g) => ({
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
    npcChatterSeconds: settings.npcChatter,
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
   * A monster's NPC file sections saved from the Monsters page (issue #31): written as an NPC
   * Editor save is (the file, the version it replaced, the dropped ledger and an audit line).
   */
  const npcSectionsSave = (
    p: Player,
    seq: number,
    name: string,
    expect: string | null,
    sections: NpcSections,
  ) => {
    const r = saveNpcSections(world, name, expect, sections, ledgerOf);
    const save = r.save;
    if (save) {
      const now = isoNow();
      db.transaction(() => {
        insertNpcFileVersion(db, { npc: save.npc, text: save.previous }, p.accountId, now);
        saveNpcFile(db, { npc: save.npc, text: save.text }, p.accountId, now);
        deleteShop(db, save.npc);
        insertAudit(db, { actor: p.accountId, command: "npcSections", target: save.npc }, now);
      })();
    }
    deliver(r.out);
    send(p.id, {
      t: "contentNpcFile",
      seq,
      view: npcFileView(world, name),
      result: { ok: r.ok, text: r.text },
    });
  };
  /** The NPCs page's save (issue #32), written as an NPC Editor save is. */
  const npcPageSave = (
    p: Player,
    seq: number,
    name: string,
    text: string,
    expect: string | null,
  ) => {
    const r = saveNpcPage(world, name, text, expect, ledgerOf);
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
    send(p.id, {
      t: "contentNpcs",
      seq,
      view: npcPageView(world, ledgerOf, name),
      result: { ok: r.ok, text: r.text },
    });
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
    // The stakes held at the tables, written with the purses that count them (`savedGold`).
    const holds = casinoHolds();
    const holdsKey = JSON.stringify([...holds].sort());
    const holdsDue = holdsKey !== holdsWritten;
    if (
      !holdsDue &&
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
      if (holdsDue) {
        saveCasinoHolds(db, holds);
        holdsWritten = holdsKey;
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
      npcChatterSeconds: settings.npcChatter,
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
  const houseAdminDeps: HouseAdminDeps = {
    loadMap,
    shopLedger: (npc) => shopLedger(npc),
    guildOf: (id) => world.players.get(id)?.guild ?? loadCharacterGuild(db, id),
    casino: casinoDeps,
  };
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
    houses: (id) => hubHouses(world, id, houseAdminDeps),
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

  // ---- the hub's houses (issue #36) --------------------------------------------------------------
  /** A hub house intent's character and (for a transfer) the new owner, or why there is none. */
  const houseParties = (
    name: string,
    to: string | null,
  ):
    | {
        ok: true;
        owner: { characterId: string; name: string };
        to: { characterId: string; name: string } | null;
      }
    | { ok: false; text: string } => {
    const o = adminDeps.findCharacter(name.trim());
    if (!o) {
      return { ok: false, text: HUB_TEXT.notFound(name.trim()) };
    }
    const owner = { characterId: o.characterId, name: o.name };
    if (to === null) {
      return { ok: true, owner, to: null };
    }
    const t = adminDeps.findCharacter(to.trim());
    return t
      ? { ok: true, owner, to: { characterId: t.characterId, name: t.name } }
      : { ok: false, text: HOUSE_ADMIN_TEXT.noTarget(to.trim()) };
  };

  const characterHousePreview = (
    p: Player,
    msg: Extract<InGameMsg, { t: "characterHousePreview" }>,
  ) => {
    const answer = (preview: HousePreview | null, error?: string) =>
      send(p.id, {
        t: "characterHousePreview",
        seq: msg.seq,
        preview,
        ...(error === undefined ? {} : { error }),
      });
    const who = houseParties(msg.name, msg.action === "transfer" ? msg.to : null);
    if (!who.ok) {
      answer(null, who.text);
      return;
    }
    const r = housePreview(world, who.owner, msg.interior, msg.action, who.to, houseAdminDeps);
    if (r.ok) {
      answer(r.preview);
    } else {
      answer(null, r.text);
    }
  };

  /**
   * Runs a house revoke or transfer's changes (issue #36). What it sends waits for the intent's
   * transaction to commit (`afterCommit`). If the intent fails, from a write here or anything after
   * it, the memory it changed is put back (`houseSnapshot`) and anyone it moved is taken off the map
   * to reload from the database, as a failed edit's target is.
   */
  const houseChange = (
    snapshot: () => void,
    moved: () => readonly Player[],
    change: (later: (out: readonly Outgoing[]) => void) => void,
  ) => {
    const mark = world.activity.length;
    // Run by the intent's catch, so a failure after this returns (the activity flush, the
    // commit) puts memory back too.
    rollbacks.push(() => {
      snapshot();
      for (const o of moved()) {
        dropActivity(o.id, mark);
        deps.kick?.(o.id, TEXT.serverError);
        if (world.players.has(o.id)) {
          evict(o.id);
        }
      }
    });
    change((out) => afterCommit.push(...out));
  };

  /** A line in chat for a character, when they are online. */
  const chatTo = (characterId: string, text: string): Outgoing[] =>
    world.players.has(characterId) ? [{ to: characterId, msg: { t: "chat", text, color: 0 } }] : [];

  /**
   * Revoke: the preview the admin confirmed must still hold; then everyone inside goes out to the
   * door and the house is demolished as decay demolishes one, its interior deleted at once. Those
   * moved out are saved where they now stand, with their purses (a blackjack hand they leave is
   * settled), so a restart keeps them there. Logged in the owner's edit log (irreversible) and the
   * audit log; what it destroyed is logged as `demolish` world events by `demolish` and
   * `deleteInterior`.
   */
  const characterHouseRevoke = (
    p: Player,
    msg: Extract<InGameMsg, { t: "characterHouseRevoke" }>,
  ) => {
    const result = (ok: boolean, text: string) =>
      send(p.id, { t: "characterResult", seq: msg.seq, ok, text });
    const reason = msg.reason.trim().split(/\s+/).join(" ");
    if (reason === "") {
      result(false, EDIT_TEXT.needReason);
      return;
    }
    const who = houseParties(msg.name, null);
    if (!who.ok) {
      result(false, who.text);
      return;
    }
    const r = housePreview(world, who.owner, msg.interior, "revoke", null, houseAdminDeps);
    if (!r.ok) {
      result(false, r.text);
      return;
    }
    const rec = ownedHouse(world, who.owner.characterId, msg.interior);
    if (r.preview.expect !== msg.expect || !rec) {
      result(false, HOUSE_ADMIN_TEXT.changed);
      return;
    }
    const interior = loadMap(rec.interior);
    const evacuees = [...world.players.values()].filter((o) => lingoEq(o.map.name, rec.interior));
    // A blackjack hand left mid-play pays the opponent: their purse is written too.
    const seated = (o: Player) =>
      [...world.casinoTables.values()].some((t) => t.seats.some((seat) => seat?.id === o.id));
    const players = [...world.players.values()].filter((o) => evacuees.includes(o) || seated(o));
    const snap = houseSnapshot(world, [loadMap(rec.map), interior], [houseVaultOf(rec.ownerName)]);
    // The interior's deletion also drops its cached map and room.
    const cacheKey = mapPlace(rec.interior)?.key ?? null;
    const cached = cacheKey === null ? undefined : mapCache.get(cacheKey);
    const room = world.rooms.get(rec.interior);
    const respawns = [...world.players.values()].map((o) => [o, o.char.respawn] as const);
    houseChange(
      () => {
        snap();
        if (cacheKey !== null && cached !== undefined) {
          mapCache.set(cacheKey, cached);
        }
        if (room) {
          world.rooms.set(rec.interior, room);
        }
        for (const [o, r] of respawns) {
          o.char.respawn = r;
        }
      },
      () => evacuees,
      (later) => {
        later(moveOut(world, rec, houseAdminDeps));
        later(demolish(world, rec.interior, loadMap).out);
        // The sweep takes its own entries off the list; a revoke takes this house's.
        world.houseList = world.houseList.filter((e) => !lingoEq(e.interior, rec.interior));
        world.housesDirty = true;
        // Where the evacuees stand now, before the interior's deletion would send their saved
        // rows to the fallback point.
        for (const o of evacuees) {
          save(o);
        }
        persistItems(players.filter((o) => world.players.has(o.id)));
        persistHouses();
        flushInteriorDeletes();
        const summary = previewSummary(r.preview);
        const id = insertCharacterEdit(
          db,
          {
            actorAccountId: p.accountId,
            actorName: p.name,
            characterId: who.owner.characterId,
            character: who.owner.name,
            reason,
            changes: [],
            override: false,
            undoOf: null,
            kind: "houseRevoke",
            summary,
            irreversible: true,
          },
          isoNow(),
        );
        insertAudit(
          db,
          {
            actor: p.accountId,
            command: "houseRevoke",
            target: who.owner.name,
            before: { house: rec.interior, map: rec.map, type: r.preview.house.type },
            after: { edit: id, reason, summary },
          },
          isoNow(),
        );
        later(chatTo(who.owner.characterId, HOUSE_ADMIN_TEXT.toOwnerRevoked(rec.map)));
        later([
          {
            to: p.id,
            msg: {
              t: "characterResult",
              seq: msg.seq,
              ok: true,
              text: HOUSE_ADMIN_TEXT.revoked(who.owner.name, rec.map),
            },
          },
        ]);
      },
    );
  };

  /**
   * Transfer: the preview the admin confirmed must still hold (it refuses a vault that would not
   * fit); then the house changes hands whole. Logged in both characters' edit logs and the audit
   * log; a vault merge is logged as `container` moves.
   */
  const characterHouseTransfer = (
    p: Player,
    msg: Extract<InGameMsg, { t: "characterHouseTransfer" }>,
  ) => {
    const result = (ok: boolean, text: string) =>
      send(p.id, { t: "characterResult", seq: msg.seq, ok, text });
    const reason = msg.reason.trim().split(/\s+/).join(" ");
    if (reason === "") {
      result(false, EDIT_TEXT.needReason);
      return;
    }
    const who = houseParties(msg.name, msg.to);
    if (!who.ok || !who.to) {
      result(false, who.ok ? HOUSE_ADMIN_TEXT.noTarget(msg.to.trim()) : who.text);
      return;
    }
    const to = who.to;
    const r = housePreview(world, who.owner, msg.interior, "transfer", to, houseAdminDeps);
    if (!r.ok) {
      result(false, r.text);
      return;
    }
    const rec = ownedHouse(world, who.owner.characterId, msg.interior);
    if (r.preview.expect !== msg.expect || !rec) {
      result(false, HOUSE_ADMIN_TEXT.changed);
      return;
    }
    houseChange(
      houseSnapshot(
        world,
        [loadMap(rec.map), loadMap(rec.interior)],
        [houseVaultOf(rec.ownerName), houseVaultOf(to.name)],
      ),
      () => [],
      (later) => {
        const t = transferHouse(world, rec, to, r.preview, houseAdminDeps);
        later(t.out);
        // The new owner's decay clock starts now, as a build's does.
        const month = houseMonth();
        for (const e of world.houseList) {
          if (lingoEq(e.interior, rec.interior)) {
            e.month = month;
          }
        }
        const now = isoNow();
        for (const npc of t.writes.shops) {
          setPlayerShopOwner(db, npc, to.characterId);
        }
        for (const f of t.writes.files) {
          saveNpcFile(db, f, p.accountId, now);
        }
        if (t.writes.interior) {
          const w = t.writes.interior;
          saveMapTitleAndSigns(db, w.mapId, w.title, w.signs, now);
        }
        persistItems([]);
        persistHouses();
        const summary = previewSummary(r.preview);
        const ids = [who.owner, to].map((c) =>
          insertCharacterEdit(
            db,
            {
              actorAccountId: p.accountId,
              actorName: p.name,
              characterId: c.characterId,
              character: c.name,
              reason,
              changes: [],
              override: false,
              undoOf: null,
              kind: "houseTransfer",
              summary,
            },
            now,
          ),
        );
        insertAudit(
          db,
          {
            actor: p.accountId,
            command: "houseTransfer",
            target: who.owner.name,
            before: { house: rec.interior, map: rec.map, owner: who.owner.name },
            after: { owner: to.name, edits: ids, reason, summary },
          },
          now,
        );
        later(chatTo(who.owner.characterId, HOUSE_ADMIN_TEXT.toOwnerTransferred(rec.map, to.name)));
        later(
          chatTo(
            to.characterId,
            HOUSE_ADMIN_TEXT.toNewOwner(
              rec.map,
              who.owner.name,
              r.preview.renames.includes("door"),
            ),
          ),
        );
        later([
          {
            to: p.id,
            msg: {
              t: "characterResult",
              seq: msg.seq,
              ok: true,
              text: HOUSE_ADMIN_TEXT.transferred(who.owner.name, rec.map, to.name),
            },
          },
        ]);
      },
    );
  };

  /** Server Settings window SAVE: the `settings` permission only; every changed value audited. */

  /**
   * Online riders of a vehicle no row has (issue #44: a release pack that dropped it, a database
   * edit; a content write that takes out a ridden vehicle needs its removal's cleanup) land where
   * they are, at the start of the tick after the change, so a publish's cleanup has run first.
   * Logged as placed, as a removal's landing is, and saved with the vehicle write.
   */
  const landStranded = () => {
    for (const o of world.players.values()) {
      if (!o.vehicle || vehicleRow(o.vehicle)) {
        continue;
      }
      logActivity(world, o, "admin", {
        item: o.vehicle,
        details: { placed: -1, landed: "no such vehicle" },
      });
      o.vehicle = null;
      o.hull = null;
      o.spell.body = null;
      o.vitalsDirty = true;
      o.vehicleDirty = true;
      o.invDirty = true;
      o.forceYou = true;
      const room = world.rooms.get(o.map.name);
      deliver([
        ...(room?.players ?? []).map((x) => ({
          to: x.id,
          msg: { t: "delta" as const, events: [{ e: "body" as const, id: o.id, body: null }] },
        })),
        { to: o.id, msg: { t: "vitals", vitals: vitalsView(o) } },
      ]);
    }
  };

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
    // The content contract: a start, fallback or jail point must hold a player, and the start and
    // fallback may not be on the jail's map (moving either, or the jail, is checked). One already
    // broken (a map deleted since) may stay while another setting is saved.
    for (const key of Object.keys(CONTRACT_POINTS) as ContractPoint[]) {
      const problem = r.changed.some((c) => c.key === key)
        ? pointProblem(r.settings[key], peekMap)
        : null;
      if (problem !== null) {
        send(p.id, { t: "settingsResult", ok: false, key, text: `${problem}.` });
        return;
      }
    }
    const clash = jailClash(
      r.settings,
      r.changed.map((c) => c.key),
    );
    if (clash) {
      send(p.id, { t: "settingsResult", ok: false, key: clash.key, text: `${clash.text}.` });
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
    // The currency's name asks for its flow: every change to the gold (issue #35).
    const gold = q.scope === "item" && CURRENCY !== null && lingoEq(q.name, CURRENCY);
    const scope: ActivityScope = gold
      ? { gold: true }
      : q.scope === "item"
        ? { item: q.name }
        : c
          ? { characterId: c.characterId }
          : { name: q.name };
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
      ...(first && q.scope === "item" ? itemTotals(gold ? null : q.name, q.since, q.until) : {}),
      ...(error ? { error } : {}),
    };
  };

  /**
   * An item reconciliation run (issue #35): every unexplained change to what players carry is
   * logged, everything live is saved as the periodic save does, then the database is counted in
   * this one transaction and compared with the last run's count and the activity rows written
   * since it. The first run only takes the baseline. `by` names who ran it (null: the nightly run).
   */
  const runReconcile = (by: string | null): StoredRun => {
    for (const o of world.players.values()) {
      checkHoldings(world, o);
    }
    saveEveryone();
    const currency = CURRENCY ?? "Gold";
    const prev = recentRuns(db, 1)[0] ?? null;
    const lastSeq = lastActivitySeq(db);
    const actual = countHoldings(db, currency);
    const flows = prev ? activityFlows(db, prev.lastSeq, lastSeq, currency) : new Map();
    const items = reconcileItems(prev ? runCounts(db, prev.id) : null, flows, actual, currency);
    const run: StoredRun = {
      id: Bun.randomUUIDv7(),
      at: isoNow(),
      by,
      lastSeq,
      baseline: prev === null,
      items: items.length,
      mismatches: items.filter((i) => i.difference !== 0).length,
    };
    insertRun(db, run, items);
    return run;
  };
  /** The nightly run is checked for once a minute. */
  let reconcileCheckAt = nowMs() + 60_000;
  /**
   * The nightly run, when one is due: in its own transaction after the tick's, so a run that
   * fails rolls back only itself (and is tried again a minute later).
   */
  const nightlyReconcile = () => {
    if (!deps.nightlyReconcile || nowMs() < reconcileCheckAt) {
      return;
    }
    reconcileCheckAt = nowMs() + 60_000;
    // Read from the database, so a run that rolled back is not taken for one that happened.
    const last = recentRuns(db, 1)[0];
    if (last && Date.parse(last.at) >= nightlyDue(nowMs())) {
      return;
    }
    try {
      db.transaction(() => runReconcile(null))();
      commitLogs();
    } catch (err) {
      rollbackLogs();
      fault("reconcile", err);
    }
  };
  /** The Reconciliation section's answer: the newest runs, newest first. */
  const reconcileMsg = (seq: number, text?: string): ServerMsg => ({
    t: "reconcile",
    seq,
    runs: recentRuns(db, RECONCILE_RUNS_SHOWN).map((r) => runView(db, r)),
    ...(text ? { text } : {}),
  });

  /** An item's totals, over at most its newest `ACTIVITY_TOTALS_MAX` events (the tick waits for it). */
  const itemTotals = (item: string | null, since: string | null, until: string | null) => {
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
        ...(p.char.skillXp === undefined
          ? {}
          : { skillXp: normaliseXp(p.char.skills, p.char.skillXp, p.char.faction) }),
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
    // What the interior held goes with it: its items and its shops' stock and tills (issue #35).
    logDemolished(name, rec?.id ?? null);
    // Its casino tables go too, each stake still held handed back, so a player away in the
    // reconnect grace is not seated again at a table whose map is gone (issue #36).
    closeTablesOn(world, name, casinoDeps);
    // A shop or Bio window open on one of its shopkeepers closes.
    for (const ps of world.playerShops.values()) {
      if (lingoEq(ps.interior, name)) {
        afterCommit.push(...closeNpcWindows(world, ps.npc));
      }
    }
    if (rec) {
      // A respawn point inside the interior goes with it, saved and live.
      db.query("UPDATE characters SET respawn_map_id = NULL WHERE respawn_map_id = ?").run(rec.id);
      for (const o of world.players.values()) {
        if (o.char.respawn?.mapId === rec.id) {
          o.char.respawn = null;
        }
      }
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
  /**
   * Logs what a deleted interior destroys as `demolish` world events: the items on its floor (as
   * saved; nothing moves there while it is empty) and each of its player shops' stock and till.
   */
  function logDemolished(interior: string, mapId: string | null): void {
    const details = { house: interior };
    if (mapId !== null) {
      for (const g of db
        .query<{ item: string; qty: number; x: number; y: number }, [string]>(
          "SELECT item, qty, x, y FROM ground_items WHERE map_id = ? ORDER BY id",
        )
        .all(mapId)) {
        logWorld(world, "demolish", g.item, -g.qty, {
          at: { map: interior, x: g.x, y: g.y },
          details,
        });
      }
    }
    for (const ps of world.playerShops.values()) {
      if (!lingoEq(ps.interior, interior)) {
        continue;
      }
      const ledger = shopLedger(ps.npc);
      if (!ledger) {
        continue;
      }
      const till = ledger.gold ?? npcFileNamed(world.npcs, ps.npc)?.gold ?? 0;
      const pile = goldPileName(till);
      if (pile !== null && till !== 0) {
        logWorld(world, "demolish", pile, -1, {
          other: ps.npc,
          at: { map: interior, x: null, y: null },
          details,
        });
      }
      for (const l of ledger.lines) {
        if (l.kind === "SEL" && l.stock) {
          logWorld(world, "demolish", l.item, -l.stock, {
            other: ps.npc,
            at: { map: interior, x: null, y: null },
            details,
          });
        }
      }
    }
  }
  /** The queued interiors nobody is in any more. */
  const flushInteriorDeletes = () => {
    if (world.interiorsToDelete.size === 0) {
      return;
    }
    // The ground changes not yet written go first, so what a deleted interior destroys is read
    // as it stands (issue #35): an item that decayed there is not destroyed twice, and one just
    // put down is not lost unlogged.
    persistItems([]);
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

  /**
   * A map save, from the in-game World Editor or the Control Panel's World page (issue #33): checked
   * (`saveError`), the map it replaces kept as a version, applied live to everyone on it, audited.
   * `expect` is the revision the World page showed (null: no map there); the in-game editor names
   * none. Returns whether it saved and what to tell the saver.
   */
  const saveEditorMap = (
    p: Player,
    m: EditorMap,
    expect?: string | null,
  ): { ok: boolean; text: string } => {
    const error = saveError(m);
    if (error) {
      return { ok: false, text: error };
    }
    const name = mapName(m.mx, m.my);
    const before = loadMap(name);
    if (expect !== undefined && expect !== mapRevisionOf(before, m.mx, m.my)) {
      return {
        ok: false,
        text: `Map ${name} changed since you opened it (another admin saved it): open it again before saving.`,
      };
    }
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
    return { ok: true, text: SAVED };
  };
  /**
   * A map's revision as the World page names it, null with no map: a hash of the editor's view (so
   * `/roster`, `/drop` and other live changes count) and of its newest version's id (every save and
   * restore adds one, so a save of identical content, or a restore back to it, still counts).
   */
  const mapRevisionOf = (m: WorldMap | null, mx: number, my: number): string | null =>
    m
      ? new Bun.CryptoHasher("sha256")
          .update(JSON.stringify(editorView(m, mx, my)))
          .update(`\n${latestMapVersionId(db, m.id) ?? ""}`)
          .digest("hex")
          .slice(0, 16)
      : null;
  /** Why a saved version cannot be put back as it is (content changed since), or undefined. */
  const versionBlocked = (data: unknown, mx: number, my: number): string | undefined => {
    const v = versionAsEditorMap(data, mx, my);
    return v ? (saveError(v) ?? undefined) : "This version's data cannot be read.";
  };
  /**
   * The World page's view (issue #33): with `list` every grid map (a scan of the world, so only when
   * asked), and with a position the map open.
   */
  const mapsView = (mx?: number, my?: number, list = false): ContentMapsView => {
    const maps = list ? listMapPlacements(db) : null;
    if (mx === undefined || my === undefined) {
      return { maps, map: null };
    }
    // A position with no map is looked at, not loaded: `loadMap` would remember the miss for ever,
    // so browsing empty positions would grow the cache.
    const name = mapName(mx, my);
    const m = mapCache.get(name) ?? (findMapByCoords(db, mx, my, 0) ? loadMap(name) : null);
    const names = new Map<string, string>();
    const nameOf = (id: string) => {
      if (!names.has(id)) {
        names.set(id, findAccountById(db, id)?.username ?? id);
      }
      return names.get(id) as string;
    };
    return {
      maps,
      map: {
        map: m ? editorView(m, mx, my) : blankMap(mx, my),
        exists: m !== null,
        revision: mapRevisionOf(m, mx, my),
        versions: m
          ? listMapVersions(db, m.id).map((v) => {
              const blocked = versionBlocked(v.data, mx, my);
              return { id: v.id, by: nameOf(v.savedBy), at: v.at, ...(blocked ? { blocked } : {}) };
            })
          : [],
      },
    };
  };
  /** A saved version of a map as the editor holds a map, to save it back. */
  const versionAsEditorMap = (data: unknown, mx: number, my: number): EditorMap | null => {
    const v = data as {
      title?: string;
      layers?: EditorMap["layers"];
      flags?: EditorMap["flags"];
      exit1?: EditorMap["exit1"];
      exit2?: EditorMap["exit2"];
      signs?: EditorMap["signs"];
      fog?: EditorMap["fog"];
      roster?: { species: string | null; home: { x: number; y: number } | null }[];
      items?: { name: string; x: number; y: number }[];
    } | null;
    if (!v?.layers || !v.flags) {
      return null;
    }
    const blank = blankMap(mx, my);
    // A slot with no home (`/roster`) comes back so, as `editorView` shows it.
    const mobs = [0, 1, 2, 3].map((i) => {
      const r = v.roster?.[i];
      if (!r?.species) {
        return null;
      }
      return r.home
        ? { name: r.species, x: r.home.x, y: r.home.y }
        : { name: r.species, x: i + 1, y: 1, anywhere: true as const };
    }) as EditorMap["mobs"];
    // Versions saved before factions were content name 1.6's letters (the migration rewrote live
    // maps, not their history): W, M and A are the three factions; X and O are none.
    const legacy: Record<string, string> = {
      W: "warrior",
      M: "mage",
      A: "adventurer",
      X: "",
      O: "",
    };
    const fct = v.flags.fctSpwn ?? "";
    return {
      mx,
      my,
      layers: v.layers,
      flags: { ...v.flags, fctSpwn: legacy[fct] ?? fct },
      header: v.title ?? "",
      signs: v.signs ?? blank.signs,
      exit1: v.exit1 ?? null,
      exit2: v.exit2 ?? null,
      fog: v.fog ?? blank.fog,
      mobs,
      // Every placed item comes back; past `EDITOR_ITEM_SLOTS` the save refuses it (`blocked`).
      items: v.items ?? [],
    };
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

  /**
   * A publish that logs everyone out (issue #40) holds this while it logs them out and publishes:
   * every way in (a login, a resume, a new character, entering the map) is refused with
   * `TEXT.publishing`. The publish runs synchronously on the game thread and releases it in a
   * `finally`, so it never outlives the publish; a restart starts unlocked.
   */
  let publishLock = false;
  /** How many players that publish logged out, for its log and audit entry. */
  let publishLoggedOut: number | undefined;

  const core: Game = {
    world,
    get settings() {
      return settings;
    },
    config,
    contentWorld,
    contractPointProblems: () => pointProblems(settings, peekMap),
    vehiclesInUse: () => {
      const out = new Map<string, { aboard: number; parked: number }>();
      const at = (name: string) => {
        const row = vehicleRow(name);
        if (!row) {
          return null;
        }
        const e = out.get(row.name) ?? { aboard: 0, parked: 0 };
        out.set(row.name, e);
        return e;
      };
      const online = new Set(world.players.keys());
      for (const r of db
        .query<{ id: string; vehicle: string }, []>(
          "SELECT id, vehicle FROM characters WHERE vehicle IS NOT NULL",
        )
        .all()) {
        if (!online.has(r.id)) {
          const e = at(r.vehicle);
          if (e) {
            e.aboard += 1;
          }
        }
      }
      for (const o of world.players.values()) {
        const e = o.vehicle ? at(o.vehicle) : null;
        if (e) {
          e.aboard += 1;
        }
      }
      const loaded = [...mapCache.values()].filter((m): m is WorldMap => !!m);
      const loadedIds = new Set(loaded.map((m) => m.id));
      const parked = (item: string) => {
        const v = vehicleOfItem(item);
        const e = v ? at(v) : null;
        if (e) {
          e.parked += 1;
        }
      };
      for (const g of db
        .query<{ map_id: string; item: string }, []>(
          "SELECT map_id, item FROM ground_items WHERE item LIKE '%''s %'",
        )
        .all()) {
        if (!loadedIds.has(g.map_id)) {
          parked(g.item);
        }
      }
      for (const m of loaded) {
        for (const g of m.ground) {
          parked(g.item);
        }
      }
      return out;
    },

    async login(name, password, ip = "") {
      if (publishLock) {
        return { ok: false, text: TEXT.publishing };
      }
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
      if (publishLock) {
        return { ok: false, text: TEXT.publishing };
      }
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
      if (publishLock) {
        return { ok: false, text: TEXT.publishing };
      }
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
      if (publishLock) {
        unnoteCreate(limits, ip, counted);
        return { ok: false, text: TEXT.publishing };
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
          // What a new character starts with is where those items came from: logged with the
          // character, in its transaction, so the rows and the bag commit together (issue #35).
          logBagChange(world, made, "reward", new Map(), holdingsOf(loadInventory(db, made.id)), {
            details: { start: true },
          });
          flushActivity();
        })();
        commitLogs();
      } catch (err) {
        rollbackLogs();
        // Assigned in the transaction's closure, which the narrowing does not see.
        const failed = made as { id: string } | null;
        if (failed) {
          const gone = failed.id;
          world.activity.splice(
            0,
            world.activity.length,
            ...world.activity.filter((e) => e.characterId !== gone),
          );
        }
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
      if (made) {
        stampChat();
      }
      return { ok: true };
    },

    refusal(characterId, ip) {
      if (publishLock) {
        return TEXT.publishing;
      }
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
      if (world.players.has(characterId) || publishLock) {
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
      // A vehicle no row has (since removed) rides as nothing: the rider comes back on foot where
      // they were (issue #44).
      const vehicle = vehicleRow(c.vehicle) ? c.vehicle : null;
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
        vehicle,
        // A saved hull above the vehicle's full hull (lowered while the rider was away) comes back
        // at the full hull (issue #19).
        hull: vehicle ? Math.min(c.hull ?? hullMax(vehicle), hullMax(vehicle)) : null,
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
          skillXp: loadSkillXp(db, c.id),
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
          body: vehicle ? vehicleBody(vehicle) : null,
        },
      };
      // XP held to the current content (a curve change, a model switch while offline).
      p.char.skillXp = normaliseXp(p.char.skills, p.char.skillXp ?? [], p.char.faction);
      // The character level likewise (issue #42): its XP need under the curve now.
      syncLevel(p.char.vitals);
      p.jailUntil = jailUntil;
      p.muteUntil = muteUntil;
      p.ignore = loadIgnores(db, c.accountId);
      if (c.vehicle && !vehicle) {
        // Landed where they were: the vehicle is gone with its row, logged as an admin change
        // (placed, so the carried-items ledger is untouched) and saved with the next write.
        logActivity(world, p, "admin", {
          item: c.vehicle,
          details: { placed: -1, landed: "no such vehicle" },
        });
        p.vehicleDirty = true;
        p.invDirty = true;
      }
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
      // Loading the character sends Help.txt as the greeting (a world with no `Help` topic sends
      // none). A resumed session is not a login.
      if (!resumed) {
        if (helpLines("Help") !== null) {
          deliver(helpReply(p, "Help", chatDeps));
        }
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
      return p !== undefined && can(p.role, "contentEditor");
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
      // The World page (issue #33): maps saved live, as the World Editor saves them.
      if (msg.t === "contentMaps") {
        send(p.id, {
          t: "contentMaps",
          seq: msg.seq,
          view: mapsView(msg.mx, msg.my, msg.list === true),
        });
        return;
      }
      if (msg.t === "contentMapSave") {
        const r = saveEditorMap(p, msg.map, msg.expect);
        send(p.id, {
          t: "contentMaps",
          seq: msg.seq,
          view: mapsView(msg.map.mx, msg.map.my),
          result: r,
        });
        return;
      }
      if (msg.t === "contentMapRestore") {
        const m = loadMap(mapName(msg.mx, msg.my));
        const data = m ? mapVersionData(db, m.id, msg.version) : null;
        const restored = data ? versionAsEditorMap(data, msg.mx, msg.my) : null;
        const r = restored
          ? saveEditorMap(p, restored, msg.expect)
          : { ok: false, text: "That version of the map is not there any more." };
        send(p.id, {
          t: "contentMaps",
          seq: msg.seq,
          view: mapsView(msg.mx, msg.my),
          result: r.ok ? { ok: true, text: "The version is back: it is the map now." } : r,
        });
        return;
      }
      // The NPCs page (issue #32): a whole NPC file, saved live as the NPC Editor does.
      if (msg.t === "contentNpcs") {
        send(p.id, {
          t: "contentNpcs",
          seq: msg.seq,
          view: npcPageView(world, ledgerOf, msg.name),
        });
        return;
      }
      if (msg.t === "contentNpcSave") {
        npcPageSave(p, msg.seq, msg.name, msg.text, msg.expect);
        return;
      }
      // A monster's NPC file sections (issue #31) save live, as the NPC Editor does.
      if (msg.t === "contentNpcFile") {
        const view = npcFileView(world, msg.name);
        send(p.id, {
          t: "contentNpcFile",
          seq: msg.seq,
          view,
          ...(view ? {} : { error: `There is no monster or NPC file named ${msg.name}.` }),
        });
        return;
      }
      if (msg.t === "contentNpcFileSet") {
        npcSectionsSave(p, msg.seq, msg.name, msg.expect, msg.sections);
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
                msg.t === "contentPublish" ? publishLoggedOut : undefined,
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
        case "reconcileQuery":
          send(p.id, reconcileMsg(msg.seq));
          return;
        case "reconcileRun": {
          const run = runReconcile(p.name);
          insertAudit(
            db,
            { actor: p.accountId, command: "reconcile", target: null, after: { run: run.id } },
            isoNow(),
          );
          send(
            p.id,
            reconcileMsg(
              msg.seq,
              run.baseline
                ? "The first run took the baseline: the next run compares with it."
                : run.mismatches === 0
                  ? "Every item's count matches what the log expects."
                  : `${run.mismatches} item${run.mismatches === 1 ? "'s count differs" : "s' counts differ"} from what the log expects.`,
            ),
          );
          return;
        }
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
        case "characterHousePreview":
          characterHousePreview(p, msg);
          return;
        case "characterHouseRevoke":
          characterHouseRevoke(p, msg);
          return;
        case "characterHouseTransfer":
          characterHouseTransfer(p, msg);
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
        case "editClose":
          deliver(closeEditor(world, p));
          // Return To Game re-enters frame 50, which refills the Friends window.
          if (!p.editing) {
            deliver(friendsEntry(world, p));
          }
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
                ? storageIntent(world, p, msg.slot, rng)
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
              logActivity(world, p, "pickup", {
                item: r.grabbed,
                qty: 1,
                other: r.grabbed,
                details: { as: "monster" },
              });
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
      landStranded();
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

    contentPublished(hash, restoring = false, assets) {
      // An Assassin's Game the published content no longer has ends (not when a failed publish is
      // putting the old store back: that store had the game, if it was running).
      if (!restoring) {
        endRemovedGame(world);
      }
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
        ...vehicleRows().map((v) => v.rider),
        ...(boundBodies.tree === undefined ? [] : [boundBodies.tree]),
        ...(boundBodies.smoke === undefined ? [] : [boundBodies.smoke]),
      ]);
      const bodyEvents = new Map<Room, DeltaEvent[]>();
      for (const o of world.players.values()) {
        const body = o.spell.body;
        let next = body;
        if (o.vehicle) {
          // A vehicle no row has rides as nothing: its rider shows their own body.
          next = vehicleRow(o.vehicle) ? vehicleBody(o.vehicle) : null;
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
      // Walkability comes from the tile tables: every loaded map's grids are worked out again,
      // the cached maps nobody is on included (they are reused when someone comes back).
      const rooms = new Set([...world.rooms.values()].map((r) => r.map));
      for (const m of new Set([...mapCache.values(), ...rooms])) {
        if (!m) {
          continue;
        }
        m.walk = footWalkGrid(m.layers[0], m.layers[1]);
        m.walkAir = airshipWalkGrid(m.layers[1]);
      }
      // Every client is told the new store, then gets its inventory and the ground items around it
      // again (their art may have changed); the client holds them until the new store is in. During
      // a publish this waits until it commits, so a publish that fails tells nobody anything.
      const told = new Set<string>();
      const out: Outgoing[] = [];
      const contentMsg: ServerMsg = assets
        ? { t: "content", hash, assets }
        : { t: "content", hash };
      for (const room of world.rooms.values()) {
        const events: DeltaEvent[] = [
          ...(bodyEvents.get(room) ?? []),
          // Each live monster's body as the published store draws it: a species given another
          // body (or an upload taken out) is drawn and hit-tested with the new one at once.
          ...room.map.slots.flatMap((s) =>
            s.live ? [{ e: "mbody" as const, slot: s.slot, body: bodyOf(s.live.name) }] : [],
          ),
          ...room.map.ground.map((g) => ({ e: "gadd" as const, item: groundView(g) })),
        ];
        for (const o of room.players) {
          told.add(o.id);
          out.push({ to: o.id, msg: contentMsg });
          out.push({ to: o.id, msg: { t: "inv", inv: inventoryView(o) } });
          if (events.length > 0) {
            out.push({ to: o.id, msg: { t: "delta", events } });
          }
        }
      }
      for (const o of world.players.values()) {
        if (!told.has(o.id)) {
          out.push({ to: o.id, msg: contentMsg });
        }
        // A rider's hull follows the published balance, for every rider online (one in an editor,
        // out of any room, included): a lowered full hull takes the hull down with it, and the
        // hull bar is sent again whatever changed, so it shows the new full hull too. The
        // publish's snapshot keeps the hull, so a publish that rolls back puts it back (issue #19).
        // A vehicle no row has (one this publish removes, which its cleanup lands or switches)
        // keeps its hull.
        if (o.vehicle && o.hull !== null && vehicleRow(o.vehicle)) {
          o.hull = Math.min(o.hull, hullMax(o.vehicle));
          out.push({ to: o.id, msg: { t: "vitals", vitals: vitalsView(o) } });
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
    // A world event the call logged (a decay as a map loaded) rolled back with it too.
    const kept = world.activity
      .slice(mark)
      .filter((e) => e.characterId !== characterId && e.characterId !== null);
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
  /** An intent in its own transaction: a throw rolls its writes back and logs its player out. */
  const guardedIntent = (characterId: string, msg: InGameMsg) => {
    const mark = world.activity.length;
    try {
      db.transaction(() => {
        inner.intent(characterId, msg);
        flushActivity();
      })();
      commitLogs();
      rollbacks.length = 0;
      deliver(afterCommit.splice(0));
    } catch (err) {
      afterCommit.length = 0;
      for (const undo of rollbacks.splice(0).reverse()) {
        undo();
      }
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
  };
  /**
   * A publish that logs everyone out first (issue #40). Under the publish lock, every player but
   * the publishing admin is logged out the usual way (each saved, trades cancelled, windows
   * closed; other staff and anyone in the Control Panel too), each in their own transaction, so a
   * publish that then rolls back or throws keeps their saves. The publish runs as any publish
   * does, and the lock is released however it ends. Anything that would not reach the publish (no
   * permission, which the gate logs, or any check the publish itself runs first:
   * `ContentService.publishPreflight`) goes the usual way and logs nobody out. A logout whose save
   * fails stops it: nothing is published and the admin is told whose save failed.
   */
  const publishAlone = (characterId: string, msg: Extract<InGameMsg, { t: "contentPublish" }>) => {
    const p = world.players.get(characterId);
    const service = deps.content;
    if (!p || !can(p.role, "contentEditor") || !service) {
      guardedIntent(characterId, msg);
      return;
    }
    // The publish's own checks, before anyone is logged out; a refusal goes the usual way, which
    // runs them again and answers with the problems. A throw is a fault, as in any intent.
    let refused: boolean;
    try {
      refused = !service.publishPreflight(msg.draftRev, contentWorld).ok;
    } catch (err) {
      fault(`intent ${msg.t} from ${p.name}`, err);
      deps.kick?.(characterId, TEXT.serverError);
      if (world.players.has(characterId)) {
        evict(characterId);
      }
      return;
    }
    if (refused) {
      guardedIntent(characterId, msg);
      return;
    }
    publishLock = true;
    try {
      let loggedOut = 0;
      for (const id of [...world.players.keys()]) {
        if (id === characterId) {
          continue;
        }
        const name = world.players.get(id)?.name ?? id;
        // Saved first, then disconnected (the gateway's own leave then finds nobody to save).
        const saved = guardedLeave(id);
        deps.kick?.(id, saved ? TEXT.publishing : TEXT.serverError);
        if (!saved) {
          // A save that failed loses that player's state since their last save: nothing is
          // published, and the admin is told whose save it was.
          send(characterId, {
            t: "contentResult",
            seq: msg.seq,
            ok: false,
            text: `Not published: saving ${name} failed while logging everyone out, so nothing was published${loggedOut > 0 ? ` (${loggedOut === 1 ? "1 player was" : `${loggedOut} players were`} logged out first)` : ""}. The server's error log has the reason.`,
          });
          return;
        }
        loggedOut += 1;
      }
      publishLoggedOut = loggedOut;
      guardedIntent(characterId, msg);
    } finally {
      publishLock = false;
      publishLoggedOut = undefined;
    }
  };
  /**
   * Takes a character off the map and saves it in its own transaction: false when that threw (the
   * fault is logged and the player evicted, to reload from SQL).
   */
  const guardedLeave = (characterId: string): boolean => {
    const mark = world.activity.length;
    let ok = true;
    try {
      db.transaction(() => {
        inner.leave(characterId);
        flushActivity();
      })();
      commitLogs();
    } catch (err) {
      ok = false;
      rollbackLogs();
      fault("leave", err);
      evict(characterId);
      dropActivity(characterId, mark);
    }
    stampChat();
    return ok;
  };
  return Object.assign(core, {
    enter(characterId: string, resumed: boolean, ip?: string) {
      const mark = world.activity.length;
      try {
        // Each entry point writes the rows it logged in its own transaction, with the state they
        // describe, so a crash never keeps one without the other (issue #35).
        const r = db.transaction(() => {
          const ok = inner.enter(characterId, resumed, ip);
          flushActivity();
          return ok;
        })();
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
      guardedLeave(characterId);
    },
    intent(characterId: string, msg: InGameMsg) {
      if (msg.t === "contentPublish" && msg.logoutEveryone === true) {
        publishAlone(characterId, msg);
        return;
      }
      guardedIntent(characterId, msg);
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
        db.transaction(() => {
          inner.tick();
          flushActivity();
        })();
        commitLogs();
        deliver(afterCommit.splice(0));
        ok = true;
      } catch (err) {
        afterCommit.length = 0;
        rollbackLogs();
        fault("tick", err);
        ok = false;
      }
      if (ok) {
        nightlyReconcile();
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
