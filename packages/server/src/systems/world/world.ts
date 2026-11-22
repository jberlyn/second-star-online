/**
 * The live world: maps with players on them, held in memory and owned by the sim. Pure apart from
 * the `loadMap` function it is given; it never touches sockets, SQL or the clock.
 */
import { classesData } from "@secondstaronline/data";
import {
  ARCHIVED_POWERS,
  type AssassinEntry,
  type AssassinState,
  type AttackTimers,
  airshipWalkGrid,
  anyOpenDoor,
  archivedQuestLines,
  type Bag,
  type ChatChannel,
  type ChatOutcome,
  type DeltaEvent,
  type Dir,
  defaultPlayerPrefs,
  type Equipment,
  effectiveStats,
  emptyAssassinState,
  emptyBag,
  FACING_DELTA,
  type Facing,
  type Faction,
  type FishingSpot,
  type FxSprite,
  footWalkGrid,
  type GatherCounters,
  type GroundView,
  HOUSE_CLOCK_FRAMES,
  type HouseListEntry,
  hullMax,
  type InventoryView,
  isJailMap,
  type MapExit,
  type MapFog,
  type MapView,
  type MonsterView,
  NO_EQUIPMENT,
  NO_FACTION,
  NO_FOG,
  newAttackTimers,
  newGatherCounters,
  type Piece,
  type PlayerPreferences,
  type PlayerView,
  type Powers,
  QUEST_SAVE_BLOCK,
  type Role,
  type RoomKey,
  type SelfState,
  type ServerMsg,
  shipWalkGrid,
  tileAt,
  type Vehicle,
  type Vitals,
  type VitalsView,
  withTile,
} from "@secondstaronline/shared";

import { type CraftState, cancelCrafts, newCraftState } from "../crafting/craft.ts";
import type { ShopLedger } from "../economy/shop.ts";
import { archiveNpcStore, type NpcStore } from "../monsters/npcfiles.ts";
import { type MonsterSlot, monsterView } from "../monsters/slots.ts";

/** The account's role as the sim sees it: the operator's definition, or null for a player. */
export type { Role };

/** A map as the sim uses it. */
export interface WorldMap {
  id: string;
  name: string;
  title: string;
  layers: [string[], string[], string[], string[]];
  /**
   * On-foot walk grid, `walk[y-1][x-1]` (shared/rules/core/walk.ts). Monsters use it too: 1.6
   * built monsters' blocked tiles on each client from that player's vehicle, and SSO uses this
   * on-foot grid for everyone, whatever anyone rides.
   */
  walk: boolean[][];
  /** The Airship's grid: blocked only by layer-2 D8 I8 E8 J8 K8 L8. */
  walkAir: boolean[][];
  /** The Boat's and Battleship's grid: layer-1 sea water. */
  walkShip: boolean[][];
  /** Map field 12 (persistence/maps.ts `MapFlags`). */
  flags: MapFlags;
  /** The four roster slots and their live monsters, kept while the server runs. */
  slots: MonsterSlot[];
  /** Ground items in creation order. */
  ground: GroundItem[];
  /** Fields 13 and 18: where the `Exit` and `Exit2` items lead, or null. */
  exit1: MapExit | null;
  exit2: MapExit | null;
  /** Fields 14-16: the Sign 1-3 texts. */
  signs: [string, string, string];
  /** Field 12 items 6-10. */
  fog: MapFog;
  /** The server tick its regrowth last ran on; an empty map catches up from here. */
  regrowthTick?: number;
  /** The server tick an emptied map's door relock falls due on; its next room picks it up. */
  doorLockTick?: number;
}

/** A ground item: an original `Name:px-py` entry with a server id. */
export interface GroundItem {
  id: string;
  /** The original name, quantity included ("15 Gold", "5 Blue Crystals"). */
  item: string;
  /**
   * How many the pile gives on pickup when more than 1: only a counted `/drop`. Absent
   * means 1.
   */
  qty?: number;
  x: number;
  y: number;
  /** loot decays; drop and admin never do. */
  kind: "loot" | "drop" | "admin";
  /** Wall-clock ms the loot decays at, or null. */
  expiresAt: number | null;
  /** The character who built or parked an Airship; null or absent otherwise. */
  ownerId?: string | null;
  /** A parked vehicle's hull (null or absent: full) and the wall-clock ms it was parked at. */
  hull?: number | null;
  parkedAt?: number | null;
  /** The way a parked ship faces; null or absent faces east, as its docked picture. */
  facing?: Facing | null;
}

export function groundView(g: GroundItem): GroundView {
  return { id: g.id, name: g.item, x: g.x, y: g.y, ...(g.facing ? { facing: g.facing } : {}) };
}

/** Map field 12 items 1, 2, 3 and 5. */
export interface MapFlags {
  canFight: string;
  fctSpwn: string;
  isIndoors: string;
  canPvp: string;
}

export const DEFAULT_FLAGS: MapFlags = { canFight: "X", fctSpwn: "X", isIndoors: "X", canPvp: "X" };

export function toWorldMap(
  m: Omit<
    WorldMap,
    | "walk"
    | "walkAir"
    | "walkShip"
    | "flags"
    | "slots"
    | "ground"
    | "exit1"
    | "exit2"
    | "signs"
    | "fog"
  > & {
    flags?: MapFlags;
    slots?: MonsterSlot[];
    ground?: GroundItem[];
    exit1?: MapExit | null;
    exit2?: MapExit | null;
    signs?: [string, string, string];
    fog?: MapFog;
  },
): WorldMap {
  return {
    id: m.id,
    name: m.name,
    title: m.title,
    layers: m.layers,
    flags: m.flags ?? { ...DEFAULT_FLAGS },
    slots: m.slots ?? emptySlots(),
    ground: m.ground ?? [],
    exit1: m.exit1 ?? null,
    exit2: m.exit2 ?? null,
    signs: m.signs ?? ["", "", ""],
    fog: m.fog ?? { ...NO_FOG },
    walk: footWalkGrid(m.layers[0], m.layers[1]),
    walkAir: airshipWalkGrid(m.layers[1]),
    walkShip: shipWalkGrid(m.layers[0]),
  };
}

/**
 * Changes one tile (1.6's tile-replace and tile-change messages): the layer row and, for layers 1
 * and 2, the walk grid. Returns the event for the map, or null when (x, y) is off the map or the
 * tile already holds the code. The map is queued for writing.
 */
export function setTile(
  world: World,
  m: WorldMap,
  layer: 1 | 2 | 3 | 4,
  x: number,
  y: number,
  code: string,
): DeltaEvent | null {
  const rows = m.layers[layer - 1] ?? [];
  if (tileAt(rows, x, y) === code) {
    return null;
  }
  const next = withTile(rows, x, y, code);
  if (!next) {
    return null;
  }
  m.layers[layer - 1] = next;
  if (layer <= 2) {
    m.walk = footWalkGrid(m.layers[0], m.layers[1]);
    m.walkAir = airshipWalkGrid(m.layers[1]);
    m.walkShip = shipWalkGrid(m.layers[0]);
  }
  world.tileLog.add(m);
  return { e: "tile", layer, x, y, code };
}

export function emptySlots(): MonsterSlot[] {
  return [1, 2, 3, 4].map((slot) => ({
    slot,
    species: null,
    live: null,
    pause: 0,
    dirty: false,
  }));
}

/** The stats `p` plays with: the allocated stats plus its class's and held medals' points. */
export function statsOf(p: {
  char: Pick<CharacterState, "stats" | "skills" | "classCode">;
}): CharacterState["stats"] {
  return effectiveStats(p.char.stats, p.char.classCode, p.char.skills);
}

/** Server-owned character state the combat and progression rules read and change. */
export interface CharacterState {
  /** The class code; a promotion or `/setclass` changes it. */
  classCode: number;
  vitals: Vitals;
  /** The allocated stats; the rules read `statsOf`, which adds the class's and medals' points. */
  stats: {
    str: number;
    sta: number;
    agi: number;
    dex: number;
    int: number;
    wis: number;
    spd: number;
  };
  /** One value per skill in `classesData.skills`, index 0 = Slash. */
  skills: number[];
  hunger: number;
  equip: Equipment;
  /** The membership with the faction sort's bonuses. */
  faction: Faction;
  /** `Fctcnt`: frames of play left in the faction. */
  factionCount: number;
  /** `gnL`: wanted for murder. */
  wanted: boolean;
  /** The O-O-O respawn point, or null for the operator's setting. */
  respawn: { mapId: string; x: number; y: number } | null;
  /** Gold (file field 1) and the 15 bag lines. */
  gold: number;
  bag: Bag;
  /** The bank balance, or null with no account yet. */
  bank: number | null;
  /** The personal vault's lines. */
  vault: string[];
  /** The bank or vault changed: write it with the inventory. */
  storeDirty: boolean;
  /** `sex`: 1 male, 2 female, for the bio. */
  sex: number;
  /** The profile (sheet item 6), shown in your bio and edited only there. */
  profile: string;
}

/** Where an admin off the map is: the World Editor, the NPC editor or the Control Panel. */
export type Editing = "world" | "npc" | "controlPanel";

export interface Player {
  id: string;
  accountId: string;
  name: string;
  head: number;
  /** The account's role (its permissions and rank), or null for an ordinary player. */
  role: Role;
  map: WorldMap;
  x: number;
  y: number;
  facing: Facing;
  stepFrames: number;
  /** What the player is riding. Boarding also sets `spell.body = 57`. */
  vehicle: Vehicle | null;
  /** The vehicle or the airship's ground row changed: write both in this tick's transaction. */
  vehicleDirty: boolean;
  /** Aboard: the vehicle's hull, which hits wear instead of HP. Null on foot. */
  hull: number | null;
  /** The vehicle destroyed at this death, named in the respawn line; cleared at the respawn. */
  sunk: Vehicle | null;
  /** Latest held arrow and Turn modifier from `move`. */
  held: Dir | null;
  heldTurn: boolean;
  /** A `step` press not yet acted on; dropped after `PENDING_MAX_TICKS` mid-step ticks. */
  pending: { dir: Dir; turn: boolean; age: number } | null;
  /** Ticks left in the `loading` lock; 0 when the map is drawn. */
  loading: number;
  /** Present for clients that commit individual step directions at their tile boundaries. */
  walkQueue?: {
    seq: number;
    dir: Dir;
    turn: boolean;
    at: { map: string; n: number; x: number; y: number; blocked?: boolean };
  }[];
  moveRejected?: number;
  /** Steps started since login; lets the client match its predictions (SelfState.n). */
  n: number;
  /** True when this stay began with a resumed session, not a real login. */
  resumed: boolean;
  /** Ticks until the next periodic save. */
  saveIn: number;
  /** The last SelfState sent, to send `you` only on change. */
  lastSent: SelfState | null;
  /** Send `you` this tick even if unchanged (a refused press the client may have predicted). */
  forceYou: boolean;
  /** Frames until the next broadcast is allowed (the sizzle counter). */
  broadcastIn: number;
  /** Frames until the next local chat line or emote is allowed. */
  chatIn: number;
  /**
   * Frames until the next line delivered nowhere (an away text, a room line out of a room, staff
   * chat refused to a player) is logged; a log-only timer, so it never delays what the player says.
   */
  unsentLogIn: number;

  // ---- combat, monsters and progression --------------------------------------
  char: CharacterState;
  /** The regen counter: 1 at login (a resumed session keeps it). */
  regenCounter: number;
  timers: AttackTimers;
  /** The attack key is held (`attack{held}`). */
  attackHeld: boolean;
  /** Ticks since an attack press not yet acted on, or null; kept for `ATTACK_LATCH_TICKS`. */
  attackPress: number | null;
  /**
   * The refusal line already said while the attack key has been held ("You cannot fight here!",
   * a bow's missing arrows or crystal), so it is said once per press, not every tick. Cleared on
   * release.
   */
  attackRefused: string | null;
  /** Frames until the Battleship's cannon can fire again (0: loaded). */
  cannonReload: number;
  /** A press of the attack key the cannon has not yet answered with a shot: one shot a press. */
  cannonArmed: boolean;
  /**
   * The i-frame counter after a hit: monster hits are ignored while it runs. Your sprite stays
   * drawn (a design change: 1.6 flipped its visibility on every call, so it vanished or blinked).
   */
  flicker: number;
  /** The defense bonus (spells). */
  defenseBonus: number;
  /** No spawn rolls for 45 frames after a map entry. */
  monDropIn: number;
  /** The death pause counter: monsters do not roll against you. */
  deathPause: number;
  /** Set by death until the next map draw: the dead player cannot be hit again. */
  dontHitMeAgain: boolean;
  /**
   * A Lightning hit landed (`ltass`): the next death check runs 1.6's penalty-free death routine at
   * HP 1.
   */
  lightningDeath: boolean;
  /** The monster-attack flag, per player: a Passive monster was hit while you were here. */
  npcAttackFlag: boolean;
  /** `LastToHitMe`: "a Slime". */
  lastToHitMe: string | null;
  /**
   * The player behind `lastToHitMe`, by id, or null for a monster (the flag and points go to a
   * player id, never to a name). Cleared at death and login, and by a death that comes more than
   * `KILL_CREDIT_TICKS` after the last hit.
   */
  lastToHitId: string | null;
  /** Ticks since the hit that set `lastToHitMe` landed. */
  hitAge: number;
  /** Frames left of the death lock; the respawn warp happens when it ends. */
  deadLock: number;
  /** Vitals changed: send `vitals` and save them. */
  vitalsDirty: boolean;

  // ---- inventory --------------------------------------------------------------
  /** Gold, bag or equipment changed: send `inv` and write it in this tick's transaction. */
  invDirty: boolean;
  /** Equipment changed: others see the new look. */
  lookDirty: boolean;
  /** The inventory was sent and still has to be written. */
  invSaveDue: boolean;
  /** The stats and skills last sent (`sheet`), to send only on change. */
  lastSheet: string;
  /** The Purple Potion's attack bonus; cleared when the attack counter runs out. */
  attackBonus: number;
  /** Item 2 of the last Attack message on this map. */
  lastWeaponSeen: string;
  /**
   * The item-action pause, counted down in the frame script: `ACTION_PAUSE` after Ctrl or a click,
   * longer after a switch or key. Use, Equip, Drop and a click pickup refuse while it runs; 1.6 also
   * made the client wait 40, 425 or 325 frames for a server reply, which SSO has no use for, so
   * those waits do not exist here.
   */
  itemPause: number;
  /** A Ctrl pressed during a short item-action pause, run when the pause ends. */
  actionQueued: boolean;

  // ---- NPCs, shops, bank, vault and trade -------------------------------------
  /**
   * 1.6's client-side input lock, held by a window: the Bio window or the vault. Movement, attack,
   * bag and ground clicks and the monster click wait.
   */
  keyLock: boolean;
  /** Frames until the next pig grab. */
  piggie: number;
  /** The NPC whose Bio is open (1.6 kept its name and its selection in two client globals). */
  bio: { slot: number; npc: string } | null;
  /** The NPC whose shop list is open, and which list (1.6 kept a sell list and a buy list). */
  shop: { npc: string; mode: "buy" | "sell" | "train" } | null;
  /** The personal vault was opened (1.6 marked it with the player's name as its last chest). */
  vaultOpen: boolean;
  /** The trade this player is in, by id, or null. */
  trade: string | null;

  // ---- spells -----------------------------------------------------------------
  spell: SpellState;

  // ---- the World Editor, the NPC editor and the Control Panel ---------------------
  /**
   * In the World Editor, the NPC editor or the Control Panel: off the map (the client left its map
   * group), so nothing on it sees, hits or ticks for this player until Return To Game. Null in play.
   */
  editing: Editing | null;

  // ---- admin -------------------------------------------------------------------
  /** The connection's IP address (`/IPlookup`, the cheat log); set by the gateway at login. */
  ip: string;
  /**
   * When the jail sentence ends (wall-clock ms; `Infinity` for a permanent one), or null.
   * Loaded from the stored sentence at login and set by `/jail`; `jailTick` releases at the time.
   */
  jailUntil: number | null;
  /**
   * When the mute ends (wall-clock ms; `Infinity` for a permanent one), or null. Loaded at login
   * and set by `/mute`; `muteTick` lifts it at the time.
   */
  muteUntil: number | null;
  /** A staff member's `/warpscript` keyword, or null until set. */
  warpscript: string | null;

  // ---- gathering ---------------------------------------------------------------
  /**
   * The chop, dig, farm, watering and mine counters (how many times each tool has been used in a
   * row): client globals, so they start at 0 each login.
   */
  gather: GatherCounters;
  /**
   * The refusal line (web, blocked edge or a fished-out tile) already printed for the current
   * press, so a held key prints it once; cleared by a new press, a release or any other outcome.
   */
  told: string | null;
  /**
   * The name last shown placed in each roster slot 1-4 (index = slot - 1), null = never shown
   * (outlives the monster). Kept while this Player lives, empty at a fresh login;
   * read by the blocking check.
   */
  shownNames: (string | null)[];

  // ---- crafting stations and containers --------------------------------------
  /** The running crafts and the session's last action, next food and next potion. */
  craft: CraftState;
  /**
   * The container the window is on (`Cauldron#n`, a carried Crate or Cabinet; 1.6 kept it in its
   * last-chest name): the window's OK withdraws from it. `shown` is the list the window was last
   * sent, which a click reads by line; the server then takes the first line equal to that name.
   */
  container: {
    name: string;
    shown: string[];
    /** Opened from the bag (Storage), so only while the bag holds it. */
    carried?: boolean;
  } | null;

  // ---- housing ---------------------------------------------------------------
  /** The deed being placed, or null. */
  placing: { slot: number; house: string } | null;
  /**
   * 1.6's do-not-drop flag: reset by Drop, never by a click, so a click reads what the last
   * house test left.
   */
  headFlag: 0 | 1;
  /**
   * The five-minute countdown (1230 at login): at 0 the client asks the time, and its reply sends
   * the month report.
   */
  houseClock: number;

  // ---- quest chests ----------------------------------------------------------
  /**
   * Frames before the periodic save may roll again; each save rolls the quest chest refill.
   */
  saveBlock: number;

  // ---- guilds ----------------------------------------------------------------
  /**
   * The `Guild` field (TempSave): the guild this session loaded, or "". Set only while you are
   * in it, so the players whose field names a guild are its `@<guild>` channel.
   */
  guild: string;
  /** A pending guild invitation, until answered, replaced or logout. */
  guildInvite: { guildId: string; inviterId: string } | null;
  /** The Guild Center (frame 72) is up. */
  guildScreen: boolean;

  // ---- the casino ---------------------------------------------------------------
  /**
   * The slot panel: `null` = closed; `spin` counts the ticks until a pull settles (0 = idle). A map
   * change closes it.
   */
  slot: { spin: number } | null;
  /**
   * The blackjack or checkers seat: `key` is the table's `world.casinoTables` key. A map change
   * closes it; a mid-hand blackjack seat survives a dropped connection for the grace.
   */
  casino: { key: string; side: 1 | 2 } | null;

  // ---- mail and message boards -----------------------------------------------
  /** The mail list (sprite 362) is up: set when the list is built, cleared by the list's CLOSE. */
  mailList: boolean;
  /** The mailbox is open (from opening it until the list's CLOSE): gates `mailUi` and SEND. */
  mailUi: boolean;
  /** The open board, which posts go to, until Close or a map change. */
  board: string | null;

  // ---- paintings, photos and newspapers --------------------------------------
  /** A Canvas was used: a save spends a Canvas from the bag; a cancelled picture reopens. */
  canvas: boolean;
  /** A Film was used (the lens is up): a photo save spends a Film from the bag. */
  film: boolean;
  /** Which art screen the client has up: gates `paintUi` and `viewClose`. */
  artUi: "paint" | "view" | null;

  // ---- IM, away, chat rooms and ignore ---------------------------------------
  /**
   * The ignore list, the account's, loaded at login: whole entries in order. Shared by every online
   * character of the account.
   */
  ignore: string[];
  /**
   * The away text, or null for "OFF". Set by the Away window's Away and Back; a resumed session
   * keeps it, a login starts off.
   */
  away: string | null;
  /** The chat room you are in by its menu item and its group, or null. */
  room: { key: RoomKey; group: string } | null;

  // ---- friends, bios and medals ----------------------------------------------
  /**
   * The buddy list, the account's: the items of 1.6's `:a:b:` string in order. Shared by every
   * online character of the account.
   */
  buddies: string[];
  /** The Friends window's lines: online buddies in the server's spelling (BUD). */
  friends: string[];
  /** Per-account player settings, loaded at login and shared by online characters of the account. */
  prefs: PlayerPreferences;
  /** Whether the account already has a persisted row in `account_preferences`. */
  prefsStored: boolean;
  /**
   * The skills the medal line check last saw, to print a medal's line when a skill reaches 90 in
   * play. Null until the session's first tick records them.
   */
  awardSkills: number[] | null;
}

/**
 * A guild row: `members` exclude the leader, in join order. A disbanded row stays (1.6's
 * `!DISBAND!` file) until the name is created again.
 */
export interface GuildRow {
  id: string;
  name: string;
  alignment: "G" | "N" | "E";
  colour: number;
  leaderId: string | null;
  leaderName: string;
  members: { id: string; name: string }[];
  disbanded: boolean;
  /** `GuildList.txt`'s order. */
  listedAt: number;
  createdAt: string;
}

/** A character's spell state: the spellbook and the frame-script counters. */
export interface SpellState {
  /** The spellbook field's lines, saved in full. */
  book: string[];
  /** The book changed: send `spellbook` and write the saved form with the inventory. */
  bookDirty: boolean;
  /** The hold counter: no step while > 0. */
  hold: number;
  /** The defense counter: the defense bonus returns to 0 when it runs out. */
  defenseCounter: number;
  /** The Firesword counter. */
  fireSword: number;
  /** The Magic Shield counter: while it runs, spell damage on you is 5 lower (`spellDefense`). */
  magicDef: number;
  /** The morph counter: the body reverts when it runs out. */
  morph: number;
  /** The Smoke Bomb tick. */
  smokeBomb: number;
  /** The body after a body change, or null for the paperdoll. */
  body: number | null;
  /** The NPC spell block: monster spells wait 30 frames after a monster's cast. */
  npcSpellBlock: number;
}

export function newSpellState(book: string[] = []): SpellState {
  return {
    book,
    bookDirty: false,
    hold: 0,
    defenseCounter: 0,
    fireSword: 0,
    magicDef: 0,
    morph: 0,
    smokeBomb: 0,
    body: null,
    npcSpellBlock: 0,
  };
}

/**
 * A live spell FX on a map: the sprite (shared/rules/spells/spellfx.ts) plus what the original kept
 * per FX slot: its power and owner (`Spell<k>Power`, `Spell<k>Owner`).
 */
export interface SpellFx extends FxSprite {
  /** The FX slot, 1-based: the lowest free when placed, with no cap. */
  slot: number;
  power: number;
  /** The caster's name as sent: a player's name, "a 180", "180", or "The Server Spirit". */
  owner: string;
  /** The casting player, when a player cast it (kill credit, own-spell tests). */
  ownerId: string | null;
  /** The players this Radar has already reported on. */
  radarSeen?: Set<string>;
  /** A cannonball shot: the loc its last hit test reached, where the next one sweeps from. */
  sweptTo?: { h: number; v: number };
}

/** Fresh per-session combat state for a character entering the world. */
export function sessionCombatState(): Pick<
  Player,
  | "regenCounter"
  | "timers"
  | "attackHeld"
  | "attackPress"
  | "attackRefused"
  | "cannonReload"
  | "cannonArmed"
  | "flicker"
  | "defenseBonus"
  | "monDropIn"
  | "deathPause"
  | "dontHitMeAgain"
  | "lightningDeath"
  | "npcAttackFlag"
  | "lastToHitMe"
  | "lastToHitId"
  | "hitAge"
  | "deadLock"
  | "vitalsDirty"
  | "invDirty"
  | "vehicleDirty"
  | "sunk"
  | "lookDirty"
  | "invSaveDue"
  | "lastSheet"
  | "attackBonus"
  | "lastWeaponSeen"
  | "itemPause"
  | "actionQueued"
  | "keyLock"
  | "piggie"
  | "bio"
  | "shop"
  | "vaultOpen"
  | "trade"
  | "spell"
  | "editing"
  | "jailUntil"
  | "muteUntil"
  | "warpscript"
  | "gather"
  | "told"
  | "shownNames"
  | "craft"
  | "container"
  | "placing"
  | "headFlag"
  | "houseClock"
  | "saveBlock"
  | "guild"
  | "guildInvite"
  | "guildScreen"
  | "slot"
  | "casino"
  | "mailList"
  | "mailUi"
  | "board"
  | "canvas"
  | "film"
  | "artUi"
  | "ignore"
  | "away"
  | "room"
  | "buddies"
  | "friends"
  | "prefs"
  | "prefsStored"
  | "awardSkills"
> {
  return {
    regenCounter: 1,
    timers: newAttackTimers(),
    attackHeld: false,
    attackPress: null,
    attackRefused: null,
    cannonReload: 0,
    cannonArmed: false,
    // Login starts the i-frames.
    flicker: 40,
    defenseBonus: 0,
    monDropIn: 0,
    deathPause: 0,
    dontHitMeAgain: false,
    lightningDeath: false,
    npcAttackFlag: false,
    lastToHitMe: null,
    lastToHitId: null,
    hitAge: 0,
    deadLock: 0,
    vitalsDirty: true,
    invDirty: true,
    vehicleDirty: false,
    sunk: null,
    lookDirty: false,
    invSaveDue: false,
    lastSheet: "",
    attackBonus: 0,
    lastWeaponSeen: "",
    itemPause: 0,
    actionQueued: false,
    keyLock: false,
    piggie: 0,
    bio: null,
    shop: null,
    vaultOpen: false,
    trade: null,
    spell: newSpellState(),
    editing: null,
    jailUntil: null,
    muteUntil: null,
    warpscript: null,
    gather: newGatherCounters(),
    told: null,
    shownNames: [null, null, null, null],
    craft: newCraftState(),
    container: null,
    placing: null,
    headFlag: 0,
    houseClock: HOUSE_CLOCK_FRAMES,
    saveBlock: QUEST_SAVE_BLOCK,
    guild: "",
    guildInvite: null,
    guildScreen: false,
    slot: null,
    casino: null,
    mailList: false,
    mailUi: false,
    board: null,
    canvas: false,
    film: false,
    artUi: null,
    ignore: [],
    away: null,
    room: null,
    buddies: [],
    friends: [],
    prefs: defaultPlayerPrefs(),
    prefsStored: false,
    awardSkills: null,
  };
}

/** A default character for tests and fixtures: creation vitals, no skills. */
export function defaultCharacter(): CharacterState {
  return {
    classCode: 1,
    vitals: { level: 1, hp: 20, hpMax: 20, sp: 20, spMax: 20, exp: 0, expNeeded: 30 },
    stats: { str: 10, sta: 10, agi: 1, dex: 10, int: 10, wis: 10, spd: 1 },
    skills: Array(classesData.skills.length).fill(1),
    hunger: 50000,
    equip: { ...NO_EQUIPMENT },
    faction: { ...NO_FACTION },
    factionCount: 0,
    wanted: false,
    respawn: null,
    gold: 0,
    bag: emptyBag(),
    bank: null,
    vault: [],
    storeDirty: false,
    sex: 1,
    profile: "I have not edited my profile yet",
  };
}

export interface Room {
  map: WorldMap;
  /** The world's NPC file store, for the systems that only get the room. */
  npcs: NpcStore;
  /** In order of arrival: the order players act in each tick (channel order). */
  players: Player[];
  /** Spell FX on the map, by slot. */
  fx: SpellFx[];
  /**
   * Casts waiting for the next frame script: a cast reaches the clients as a message, read one per
   * frame at the top of the frame script, before the collision test.
   */
  fxQueue: CastMessage[];
  /**
   * The map's door relock timer, 0 when none runs. When the map empties it is kept on the map as
   * `doorLockTick`, so the doors still close on time.
   */
  doorLock: number;
}

/** A cast message on its way to the map's clients (items 1-7). */
export interface CastMessage {
  /** The caster's name. */
  owner: string;
  ownerId: string | null;
  /** The spell name, item 2. */
  name: string;
  casterH: number;
  casterV: number;
  /** The target tile: the mouse, or the arrow's tile. */
  h: number;
  v: number;
  power: number;
  /** False for a cast that trains no skill (the Fire Staff's and Firesword's free fireballs). */
  train?: boolean;
}

/** One line for the chat log (`systems/chat/log.ts`). */
export interface ChatLogEntry {
  /** ISO time, set by the game when the line's intent ends. */
  at?: string;
  channel: ChatChannel;
  accountId: string;
  characterId: string;
  sender: string;
  target: string | null;
  text: string;
  outcome: ChatOutcome;
  heard?: number;
  ignored?: number;
  muffled?: number;
}

export interface World {
  rooms: Map<string, Room>;
  players: Map<string, Player>;
  /** Ticks since the server started (the periodic monster save). */
  tickNo: number;
  /**
   * Lines players wrote to each other since the last write, in order (the chat log). Systems
   * append through `logChat`; the game stamps and writes them.
   */
  chatLog: ChatLogEntry[];
  /** Ground items added or removed since the last write, in order (persistence). */
  /** Ground changes since the last write; `set` renames in place (doors). */
  groundLog: {
    mapId: string;
    add?: GroundItem;
    del?: string;
    set?: { id: string; item: string };
  }[];
  /** Gives waiting for the target's grab, 60 frames after the drop. */
  gives: {
    at: number;
    giver: string;
    /** Kept so a giver who logged off in the 60 frames is still named. */
    giverName: string;
    target: string;
    mapId: string;
    groundId: string;
  }[];
  /** NPC shop ledgers in use, by NPC name; written when `dirty`. */
  shops: Map<string, ShopLedger>;
  /** Every NPC file, with the NPC editor's saves on top. */
  npcs: NpcStore;
  /** Open trades by id. */
  trades: Map<string, Trade>;
  /** Server timer runs so far, one every 7 ticks (350 ms). */
  timeouts: number;
  /** The church bell's counter. */
  npcAct: number;
  /** Maps whose tiles changed since the last write. */
  tileLog: Set<WorldMap>;
  /** The one treasure, or null while the `treasureMaps` setting is empty. */
  treasure: { map: string; item: string } | null;
  /** The `treasureMaps` setting: the maps 1.6's treasure-list builder picks from. */
  treasureMaps: string[];
  /** The `roleTags` setting: chat puts the speaker's role name before their name. */
  roleTags: boolean;
  /**
   * Each character's fishing allowance, by character id: the tile it belongs to and the catches
   * left. Kept here rather than on the player so logging out and back in does not refill it.
   */
  fishingSpots: Map<string, FishingSpot>;
  /** The last container id minted (`mintContainerId`). */
  lastContainerId: number;
  /** Named containers' lines (1.6 kept one text file per container), loaded at start. */
  containers: Map<string, string[]>;
  /** Containers changed since the last write. */
  containersDirty: Set<string>;
  /** Blueprints by interior map name, one per house. */
  houses: Map<string, HouseRecord>;
  /** The house list: each house and the month its owner was last seen, in build order. */
  houseList: HouseListEntry[];
  /** The house tables changed since the last write. */
  housesDirty: boolean;
  /** The decay calendar day (`YYYY-MM-DD`) the house sweep last ran on, or "" before the first. */
  houseSweepDay: string;
  /** Demolished interiors to delete once nobody stands in them. */
  interiorsToDelete: Set<string>;
  /** Player shops by lower-case shopkeeper name. */
  playerShops: Map<string, PlayerShop>;
  /** The faction counts (1.6's factions file), mage:warrior:adventurer. */
  factionPowers: Powers;
  /** The powers changed since the last write. */
  powersDirty: boolean;
  /** 1.6's quest settings file, lines 1-40. */
  questLines: string[];
  /** Quest lines changed since the last write (0-based). */
  questsDirty: Set<number>;
  /** The Assassin's game: mode, tables, points and wins. */
  assassin: AssassinState;
  /** The Assassin's game changed since the last write. */
  assassinDirty: boolean;
  /** The tables with someone seated, by `<map>:<x>:<y>`. */
  casinoTables: Map<string, CasinoTable>;
  /** The High Score Statue's top 10, in rank order. */
  highScores: AssassinEntry[];
  /** The High Score table changed since the last write. */
  highScoresDirty: boolean;
  /** Guilds by lower-case name, disbanded ones included. */
  guilds: Map<string, GuildRow>;
  /** Guild rows changed since the last write. */
  guildsDirty: Set<GuildRow>;
  /** Characters' `Guild` fields changed since the last write, by character id. */
  guildFields: Map<string, string>;
  /**
   * The chat rooms' members by group (`@GeneralChat`, `@x<guild>`, …), player ids in the order they
   * entered: the roster snapshot's order.
   */
  chatRooms: Map<string, string[]>;
}

/** A player shop: the shopkeeper's NPC file name, its owner and the interior it stands in. */
export interface PlayerShop {
  npc: string;
  ownerId: string;
  interior: string;
}

/** One house blueprint. */
export interface HouseRecord {
  ownerId: string;
  ownerName: string;
  map: string;
  /** The mailbox or lamp as recorded, or null for a hall (the second field of the blueprint). */
  item1: { item: string; x: number; y: number } | null;
  /** The exit (item 3). */
  item2: { item: string; x: number; y: number };
  tiles: { code: string; x: number; y: number }[];
  /** The interior map it built. */
  interior: string;
}

/**
 * A player-to-player trade: A (the initiator) offers first, then B; only A accepts. An offer is
 * locked once sent.
 */
export interface Trade {
  id: string;
  a: string;
  b: string;
  /** A's offer once A pressed Trade, B's once B did. */
  aOffer: TradeOffer | null;
  bOffer: TradeOffer | null;
  /** Each side's Accept since the last change of either offer. */
  aAccepted: boolean;
  bAccepted: boolean;
}

export interface TradeOffer {
  gold: number;
  /** Bag lines by 1-based slot, with the item they held when offered. */
  items: { slot: number; item: string; qty: number }[];
}

/** A seated player; `awayIn` counts the grace ticks left after a dropped connection (0 = here). */
export interface CasinoSeat {
  id: string;
  name: string;
  awayIn: number;
}

/** A Blackjack Table's hand. Index 0 is Player 1. */
export interface BjTable {
  game: "blackjack";
  key: string;
  seats: [CasinoSeat | null, CasinoSeat | null];
  /** The locked bid, or null. */
  locked: [number | null, number | null];
  /** Gold held from each player's purse since their bid locked. */
  held: [number, number];
  /** The bid fields' text. */
  fields: [string, string];
  stake: number | null;
  hands: [number[], number[]];
  holds: [boolean, boolean];
  phase: "bids" | "play" | "shown";
  /** Ticks to the reset while `shown`. */
  resetIn: number;
}

/** A Checkers Table; `turn` 0 = not started. */
export interface CkTable {
  game: "checkers";
  key: string;
  seats: [CasinoSeat | null, CasinoSeat | null];
  board: Piece[];
  turn: 0 | 1 | 2;
  /** Piece index that must continue a multi-jump, or null. */
  jumpFrom?: number | null;
}

export type CasinoTable = BjTable | CkTable;

export interface Outgoing {
  to: string;
  msg: ServerMsg;
}

/** A player may not act for at most 100 ticks (5 s) after a map change. */
export const LOADING_TIMEOUT_TICKS = 100;
/** One early press is kept for up to 4 ticks to absorb jitter. */
export const PENDING_MAX_TICKS = 4;

export function createWorld(npcs: NpcStore = archiveNpcStore()): World {
  return {
    npcs,
    rooms: new Map(),
    players: new Map(),
    tickNo: 0,
    chatLog: [],
    groundLog: [],
    gives: [],
    shops: new Map(),
    trades: new Map(),
    timeouts: 0,
    // The church bell's counter starts at 1 at server start.
    npcAct: 1,
    tileLog: new Set(),
    treasure: null,
    treasureMaps: [],
    roleTags: false,
    fishingSpots: new Map(),
    lastContainerId: 0,
    containers: new Map(),
    containersDirty: new Set(),
    houses: new Map(),
    houseList: [],
    housesDirty: false,
    houseSweepDay: "",
    interiorsToDelete: new Set(),
    playerShops: new Map(),
    factionPowers: [...ARCHIVED_POWERS],
    powersDirty: false,
    questLines: archivedQuestLines(),
    questsDirty: new Set(),
    chatRooms: new Map(),
    assassin: emptyAssassinState(),
    assassinDirty: false,
    casinoTables: new Map(),
    highScores: [],
    highScoresDirty: false,
    guilds: new Map(),
    guildsDirty: new Set(),
    guildFields: new Map(),
  };
}

/** My HP, SP and XP for my own client, with the hull while aboard (the HP bar shows it). */
export function vitalsView(p: Player): VitalsView {
  const v = { ...p.char.vitals };
  return p.vehicle && p.hull !== null ? { ...v, hull: { hp: p.hull, max: hullMax(p.vehicle) } } : v;
}

export function playerView(p: Player): PlayerView {
  const [dx, dy] = FACING_DELTA[p.facing];
  return {
    id: p.id,
    name: p.name,
    head: p.head,
    x: p.x,
    y: p.y,
    facing: p.facing,
    step: p.stepFrames > 0 ? { fromX: p.x - dx, fromY: p.y - dy, frames: p.stepFrames } : null,
    equip: { ...p.char.equip },
    body: p.spell.body,
  };
}

export function inventoryView(p: Player): InventoryView {
  return {
    gold: p.char.gold,
    bag: p.char.bag.map((l) => (l ? { ...l } : null)),
    equip: { ...p.char.equip },
  };
}

export function selfState(p: Player): SelfState {
  const s: SelfState = { n: p.n, x: p.x, y: p.y, facing: p.facing, frames: p.stepFrames };
  if (p.moveRejected !== undefined) {
    s.moveRejected = p.moveRejected;
  }
  if (p.spell.hold > 0) {
    s.hold = true;
  }
  return s;
}

export function liveMonsterViews(m: WorldMap): MonsterView[] {
  return m.slots.flatMap((s) => (s.live ? [monsterView(s)] : []));
}

export function mapView(m: WorldMap): MapView {
  return {
    name: m.name,
    title: m.title,
    layers: m.layers,
    signs: [...m.signs],
    fog: { ...m.fog },
    ...(m.flags.canFight === "O" ? { noFight: true as const } : {}),
  };
}

function roomFor(world: World, map: WorldMap): Room {
  let room = world.rooms.get(map.name);
  if (!room) {
    room = { map, npcs: world.npcs, players: [], fx: [], fxQueue: [], doorLock: 0 };
    world.rooms.set(map.name, room);
    // The relock that was running when the map emptied; one already due closes the doors on the
    // next frame. Doors left open with no timer at all (a restart) close then too.
    if (map.doorLockTick !== undefined) {
      room.doorLock = Math.max(1, map.doorLockTick - world.tickNo);
      delete map.doorLockTick;
    } else if (anyOpenDoor(map.ground.map((g) => g.item))) {
      room.doorLock = 1;
    }
  }
  return room;
}

/**
 * Puts `p` on its map: everyone already there sees it arrive; `p` gets the map snapshot and
 * is `loading` until it says the map is drawn.
 */
export function enterRoom(world: World, p: Player): Outgoing[] {
  const room = roomFor(world, p.map);
  const out: Outgoing[] = [];
  for (const other of room.players) {
    out.push({
      to: other.id,
      msg: { t: "delta", events: [{ e: "enter", player: playerView(p) }] },
    });
  }
  room.players.push(p);
  p.loading = LOADING_TIMEOUT_TICKS;
  // Each map entry: 45 frames without spawn rolls, and the monster-attack flag cleared on map draw.
  p.monDropIn = 45;
  p.npcAttackFlag = false;
  // Drawing the map's items clears the input lock, and a map change ends any running craft and
  // closes an open vault, container, message board or mailbox (its window closes on the client
  // too), so a mailbox opened on one map never sends mail from another.
  p.keyLock = false;
  p.vaultOpen = false;
  p.container = null;
  p.board = null;
  p.mailList = false;
  p.mailUi = false;
  const stopped = cancelCrafts(p);
  // The death guard clears when a map is drawn; the loading lock keeps the player safe until then.
  p.dontHitMeAgain = false;
  // Drawing an O-O-O map (no fighting, indoors, no PvP) saves the respawn point, except in jail.
  const f = p.map.flags;
  if (
    !isJailMap(p.map.name) &&
    `${f.canFight}-${f.isIndoors}-${f.canPvp}`.toUpperCase().includes("O-O-O")
  ) {
    p.char.respawn = { mapId: p.map.id, x: p.x, y: p.y };
  }
  p.pending = null;
  if (p.walkQueue) {
    p.walkQueue = [];
  }
  p.lastSent = selfState(p);
  p.forceYou = false;
  out.push({
    to: p.id,
    msg: {
      t: "snapshot",
      map: mapView(p.map),
      you: playerView(p),
      self: selfState(p),
      players: room.players.filter((o) => o !== p).map(playerView),
      monsters: liveMonsterViews(p.map),
      ground: p.map.ground.map(groundView),
    },
  });
  out.push(...stopped);
  return out;
}

/** Takes `p` off its map; everyone still there sees it leave. Empty rooms are unloaded. */
export function leaveRoom(world: World, p: Player): Outgoing[] {
  const room = world.rooms.get(p.map.name);
  if (!room?.players.includes(p)) {
    return [];
  }
  room.players = room.players.filter((o) => o !== p);
  if (room.players.length === 0) {
    world.rooms.delete(p.map.name);
    if (room.doorLock > 0) {
      room.map.doorLockTick = world.tickNo + room.doorLock;
    }
  }
  const leave: DeltaEvent = { e: "leave", id: p.id };
  return room.players.map((o) => ({ to: o.id, msg: { t: "delta", events: [leave] } }));
}

/** A player joins the world, at a login or a resumed session. */
export function addPlayer(world: World, p: Player): Outgoing[] {
  world.players.set(p.id, p);
  return enterRoom(world, p);
}

export function removePlayer(world: World, id: string): { player: Player; out: Outgoing[] } | null {
  const p = world.players.get(id);
  if (!p) {
    return null;
  }
  world.players.delete(id);
  return { player: p, out: leaveRoom(world, p) };
}

/** The grid a player moves on: on foot, aboard an Airship, or aboard a ship. */
export function walkGridFor(
  map: Pick<WorldMap, "walk" | "walkAir" | "walkShip">,
  vehicle: Vehicle | null,
): boolean[][] {
  if (vehicle === "Airship") {
    return map.walkAir;
  }
  return vehicle ? map.walkShip : map.walk;
}
