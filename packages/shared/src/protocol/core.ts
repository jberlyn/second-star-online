/** Login, movement and the world's state: the intents and server messages every screen needs, the shared views, frame limits, alert texts and close codes. */
import { z } from "zod";

import type { MapFog } from "../rules/admin/worldedit.ts";
import { NAME_MAX } from "../rules/progression/creation.ts";
import { seq } from "./fields.ts";

export const PROTOCOL_VERSION = 1;

/** Upper bound on any inbound frame, in bytes. The largest intent (create) is under 300. */
export const MAX_MESSAGE_BYTES = 1024;

const dir = z.enum(["L", "R", "U", "D"]);

const name = z.string().min(1).max(NAME_MAX);

/** Not a game rule: a bound so hashing cost stays small. The original had none. */
const password = z.string().min(1).max(64);

const stat = z.number().int().min(1).max(20);

export const loginSchema = z.strictObject({ t: z.literal("login"), name, password });

export const createSchema = z.strictObject({
  t: z.literal("create"),
  name,
  password,
  sex: z.union([z.literal(1), z.literal(2)]),
  head: z.number().int().min(1).max(17),
  /** A class the creation screen offers (`classes.json` `startClasses`); the server checks it. */
  classCode: z.number().int().min(1).max(10_000),
  str: stat,
  sta: stat,
  int: stat,
  wis: stat,
  dex: stat,
});

/** Reconnect after a network drop without the password ("resumed session"). */
export const resumeSchema = z.strictObject({ t: z.literal("resume"), token: z.uuid() });

/** The held arrow and the Turn modifier, sent on every change. */
export const moveSchema = z.strictObject({
  t: z.literal("move"),
  seq,
  held: dir.nullable(),
  turn: z.boolean(),
  /** Directions arrive as scheduled steps; this only updates modifier state. */
  scheduled: z.boolean().optional(),
});

/** A scheduled prediction when `at` is present; otherwise a legacy buffered key press. */
export const stepSchema = z.strictObject({
  t: z.literal("step"),
  seq,
  dir,
  turn: z.boolean(),
  /** A prediction commits one direction at a tile boundary, never a destination. */
  at: z
    .strictObject({
      map: z.string().max(64),
      n: z.number().int().min(0),
      x: z.number().int().min(1).max(17),
      y: z.number().int().min(1).max(12),
      /** The client also found a block; matching refusals need no position correction. */
      blocked: z.boolean().optional(),
    })
    .optional(),
});

/** The client has drawn the new map; ends the `loading` lock. */
export const mapReadySchema = z.strictObject({ t: z.literal("mapReady") });

export const logoutSchema = z.strictObject({ t: z.literal("logout") });

/**
 * Upper bound on an in-game frame from a World Editor user: a whole map save (four layers, three signs, the
 * header) is about 7 KB; an NPC file is at most 100 lines of 255 characters. Not a game rule.
 */
export const EDITOR_MESSAGE_BYTES = 32_768;

/**
 * The in-game frame allowance of a player holding an unspent canvas or film: a 64×64 PNG
 * (`artBytesMax` 16,384 bytes) as base64 fits. Every other frame keeps `MAX_MESSAGE_BYTES`.
 */
export const UPLOAD_MESSAGE_BYTES = 24_576;

export type FacingWire = "N" | "S" | "E" | "W";

/** The six equipment slots by field (`NOTHING` when empty), shared/rules/core/fighter.ts. */
export interface EquipView {
  weapon: string;
  offHand: string;
  head: string;
  body: string;
  feet: string;
  ring: string;
}

/** A ground item: the original's name ("15 Gold") on a tile. */
export interface GroundView {
  id: string;
  /** The stored name ("15 Gold", "Crate#3"): the item's key, with what it carries. */
  name: string;
  /**
   * The atlas art to draw, when the item's `sprite` differs from its key (an operator gave it new
   * art); absent draws by the name, as 1.6 did.
   */
  sprite?: string;
  x: number;
  y: number;
  /** The way a parked Boat or Battleship faces; absent faces east. */
  facing?: FacingWire;
}

/** Your gold, 15 bag lines and equipment (the `inx` reply). */
export interface InventoryView {
  gold: number;
  bag: ({ item: string; qty: number } | null)[];
  equip: EquipView;
  /**
   * The atlas art of each bag or worn item whose `sprite` differs from its key, by key; absent
   * when every item draws by its name.
   */
  sprites?: Record<string, string>;
}

/** Another player as a client draws them. */
export interface PlayerView {
  id: string;
  name: string;
  head: number;
  x: number;
  y: number;
  facing: FacingWire;
  /** Mid-step on arrival: where the step started and how many frames are left. */
  step: { fromX: number; fromY: number; frames: number } | null;
  /** What they wear. */
  equip: EquipView;
  /**
   * A `Chars` body replacing the paperdoll: Morph, Nature Shift, Smoke Bomb (body 100, hidden
   * from everyone else), or null.
   */
  body: number | null;
  /** Crafting (an SSO addition): the station they face animates. Absent when not crafting. */
  crafting?: true;
}

/** A monster in roster slot 1-4 as a client draws it (sprites 180-183). */
export interface MonsterView {
  slot: number;
  name: string;
  /** `Chars` body: members `<body>-F<1..4>-<N|S|W|E>`. */
  body: number;
  x: number;
  y: number;
  facing: FacingWire;
  /** Mid-step: where the step started and how many of its 16 frames are left. */
  step: { fromX: number; fromY: number; frames: number } | null;
}

/** HP, SP and XP, sent to their owner on every change. */
export interface VitalsView {
  level: number;
  hp: number;
  hpMax: number;
  sp: number;
  spMax: number;
  exp: number;
  expNeeded: number;
  /** Aboard a vehicle: its hull, which hits wear instead of HP. The HP bar shows it. */
  hull?: { hp: number; max: number };
}

export interface MapView {
  name: string;
  title: string;
  /** Layers 1-4, each 12 rows of 17 space-separated tile codes. */
  layers: [string[], string[], string[], string[]];
  /** Map fields 14-16: what clicking Sign 1-3 shows. */
  signs: [string, string, string];
  /** Map field 12 items 6-10: the fog over the playfield. */
  fog: MapFog;
  /**
   * The map's "can fight" flag is off: a swing happens only on an arena tile. The client reads it
   * to predict the attack lock.
   */
  noFight?: true;
}

/** Your own authoritative state. `n` counts your steps since the last snapshot. */
export interface SelfState {
  n: number;
  x: number;
  y: number;
  facing: FacingWire;
  frames: number;
  /** While the hold counter runs, no step starts, so the client does not predict one. */
  hold?: boolean;
  /**
   * Sequence of the highest refused scheduled movement request. Each refusal names one request;
   * a client ignores refusals of requests it sent before its last correction.
   */
  moveRejected?: number;
}

/**
 * The swing's sound on channel 3: a name from the sound list (`swordswing` by default), or null for
 * none.
 */
export type SwingSound = string | null;

export type DeltaEvent =
  | { e: "enter"; player: PlayerView }
  | { e: "leave"; id: string }
  | {
      e: "move";
      id: string;
      fromX: number;
      fromY: number;
      toX: number;
      toY: number;
      facing: FacingWire;
      frames: number;
    }
  | { e: "turn"; id: string; facing: FacingWire }
  /** A monster appears. */
  | { e: "mspawn"; monster: MonsterView }
  /** A monster starts a 16-frame step . */
  | {
      e: "mmove";
      slot: number;
      fromX: number;
      fromY: number;
      toX: number;
      toY: number;
      facing: FacingWire;
    }
  /**
   * A melee hit on a monster: the splat and the floatie in colour 84 at the monster, and
   * `hitsound`. On a kill the monster is gone first, so only the `kill1` effect and the `fx` sound
   * show.
   */
  | { e: "mhit"; slot: number; dmg: number; kill: boolean }
  /** An operator emptied or changed the slot: the monster is removed without a kill. */
  | { e: "mgone"; slot: number }
  /**
   * A player swings: attack animation and the swing sound. `atDelay`/`actionDelay` are the
   * cooldowns it set, so the swinger's client can re-predict its attack lock.
   */
  | {
      e: "swing";
      id: string;
      atDelay: number;
      actionDelay: number;
      /**
       * `swordswing`/`LaserSword`, or for a tool at its own tile `treechop` (an axe at a tree) or
       * `swordhit2` (a hammer at its rock), on channel 3.
       */
      sound: SwingSound;
    }
  /**
   * Floating text over a player (`TS`): a monster hit is colour 6 with no splat and no sound (a 1.6
   * quirk kept), Parry and Block colour 103.
   */
  | { e: "phit"; id: string; text: string; color: number; splat?: boolean }
  /**
   * A map tile changed: gathering, seeds, watering, regrowth. `layer` is 1-4; the client
   * redraws that tile.
   */
  | { e: "tile"; layer: number; x: number; y: number; code: string }
  /** A ground item appears (`!((`). */
  | { e: "gadd"; item: GroundView }
  /** A ground item goes (`(**`, decay, pickup). */
  | { e: "gdel"; id: string }
  /**
   * A door or switch changes name in place (the `` !`( `` line): the client swaps the item's
   * picture.
   */
  | { e: "gset"; id: string; name: string }
  /** A player's equipment changed. */
  /** New worn gear, or (from the character editor) a new head too. */
  | { e: "look"; id: string; equip: EquipView; head?: number }
  /**
   * A spell FX appears (the cast handler): member `<name>-1` at the stage loc (h, v); each client
   * then steps it with the shared spell FX rules. `slot` is its FX slot: a new FX in a slot
   * replaces the old one. `caster` plays the cast frame for 5 frames (its own cast animation counter).
   */
  | { e: "fx"; slot: number; name: string; h: number; v: number; caster?: string }
  /** A FX the server stopped early: a cannonball shot that hit something. */
  | { e: "fxend"; slot: number; name: string }
  /** A player's body changes or reverts. */
  | { e: "body"; id: string; body: number | null }
  /** A player starts or stops crafting (SSO): the station they face animates while `on`. */
  | { e: "craft"; id: string; on: boolean }
  /**
   * A spell's floatie over a monster (the spell hit check): colour 124 with the splat and
   * `hitsound` for damage, 46 for a heal (the element heals keep the splat and sound); `kill` shows
   * `kill1` and plays `fx`.
   */
  | { e: "mspell"; slot: number; text: string; color: number; splat: boolean; kill: boolean };

/** Original alert texts. */
export const TEXT = {
  nameTaken: "That character name is already taken. Please choose a unique name.",
  created: "Character has been successfully created. You can now play First Star Online!",
  badPassword: "The password entered is invalid!",
  noSuchName:
    "That character name does not exist on this server. You must create the character to play.",
  kicked: "You have been kicked from the game.",
  /** SSO: an action threw on the server; the player is logged out. */
  serverError: "Something went wrong on the server, so you were logged out. Please log in again.",
  /** SSO: the login limits. */
  tooManyLogins: "Too many failed logins. Please wait a few minutes and try again.",
  tooManyCreates: "Too many new characters from this address. Please try again later.",
  tooManyConnections: "Too many connections from this address.",
  /** The map-created message, shown with the frame above 100. */
  mapSaved: "Map has been successfully saved!",
  /** SSO: a second login to the same account replaces the first. */
  replaced: "You logged in from somewhere else.",
  /** SSO: a resume token that expired or was never issued. */
  resumeFailed: "Your session has ended. Please log in again.",
} as const;

/** WebSocket close codes the server uses. */
export const CLOSE = {
  logout: { code: 4001, reason: "logged out" },
  replaced: { code: 4002, reason: "logged in elsewhere" },
  badMessage: { code: 4003, reason: "too many bad messages" },
  rateLimited: { code: 4004, reason: "too many messages" },
  /** `/kick` or `/ban`. */
  kicked: { code: 4005, reason: "kicked" },
  /** more open sockets from one address than `socketsPerIp`. */
  tooManyConnections: { code: 4006, reason: "too many connections" },
  /**
   * the connection fell too far behind (more than about 1 MB waiting). Not final: the client's
   * resume brings it back with a fresh snapshot.
   */
  behind: { code: 4007, reason: "fell behind" },
} as const;

export type CoreServerMsg =
  /**
   * The death frame, to the dying player only, after the killing tick's delta/you/vitals. Not sent
   * for an arena death. The client blacks out the playfield until the respawn map is drawn.
   */
  | { t: "death" }
  | {
      t: "welcome";
      protocol: number;
      id: string;
      name: string;
      token: string;
      resumed: boolean;
      /**
       * The server's rules the client predicts with: the chat length cap (setting
       * `chatMaxChars`).
       */
      rules: { chatMaxChars: number };
      /**
       * The published content store's hash: a client holding another store fetches
       * `/content/<hash>.json` and installs it before it plays (a deploy or a publish while it
       * was away). The server always sends it; a message without it checks nothing.
       */
      content?: string;
    }
  /** Login or creation refused, with the original alert text where one exists. */
  | { t: "denied"; text: string }
  /** Creation succeeded; as in the original, you then log in. */
  | { t: "created"; text: string }
  | {
      t: "snapshot";
      map: MapView;
      you: PlayerView;
      self: SelfState;
      players: PlayerView[];
      monsters: MonsterView[];
      ground: GroundView[];
    }
  /** Your stats and every skill for the Stats and Skills tabs, sent when they change. */
  | {
      t: "sheet";
      stats: {
        str: number;
        sta: number;
        dex: number;
        int: number;
        wis: number;
      };
      /** Every skill's value by skill key (`classes.json` `skills`). */
      skills: Record<string, number>;
    }
  | { t: "vitals"; vitals: VitalsView }
  | { t: "you"; self: SelfState }
  | { t: "delta"; events: DeltaEvent[] }
  | { t: "kicked"; text: string }
  /**
   * The key lock set or cleared by the server outside a window: a craft's start and end, a map
   * load. While set, the bag ignores clicks.
   */
  | { t: "lock"; on: boolean }
  /**
   * A server sound: the church bell, `Churchy:5:200`. Without `volume` it is a plain
   * `puppetSound` the server decided on (`treefalling`, `crush`, `shoveling` on channel 2 for the
   * gatherer), which leaves the channel's volume as it is.
   */
  | { t: "sound"; name: string; ch: number; volume?: number }
  /**
   * Show Sign n's text (map field 13 + n): Ctrl on a sign. A click on a sign opens it in the
   * client, from any distance.
   */
  | { t: "sign"; n: 1 | 2 | 3 }
  /**
   * Your role's permissions, sent on entering the world and whenever your role or its definition
   * changes: they decide which menus show (1.6 installed the Admin menu, 502, for an immortal).
   * The server still checks every request.
   */
  | { t: "permissions"; permissions: string[] }
  /** A message box (`alert`), e.g. "Map has been successfully saved!" */
  | { t: "alert"; text: string }
  /**
   * The login news: the operator's News text, printed in the chat only when
   * it differs from the last news this browser showed.
   */
  | { t: "news"; text: string }
  /**
   * The server's minute of the hour (UTC), on entering the game and whenever it changes: 1.6's time
   * request reply read as the new minute (asked about once a minute, every 1230 ticks), which turns
   * placed Clocks (`clockFace`).
   */
  | { t: "minute"; minute: number }
  /** The rules of `welcome` changed (an operator saved Settings or ran `/Refresh`). */
  | { t: "rules"; rules: { chatMaxChars: number } };
