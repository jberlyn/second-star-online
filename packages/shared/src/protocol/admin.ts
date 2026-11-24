/** The World Editor, the NPC editor, the Control Panel and its Server Settings page. */
import { z } from "zod";

import {
  ACTIVITY_PAGE_MAX,
  ACTIVITY_QUERY_MAX,
  ACTIVITY_TYPES,
  type ActivityRow,
  type ActivityTotal,
  isActivityType,
} from "../rules/admin/activity.ts";
import type { SettableField } from "../rules/admin/character-edit.ts";
import {
  CHARACTER_SEARCH_MAX,
  type CharacterHub,
  type CharacterListRow,
  HUB_ACTIONS,
} from "../rules/admin/characters.ts";
import {
  EDITOR_ITEM_SLOTS,
  type EditorMap,
  HEADER_MAX,
  SIGN_MAX,
} from "../rules/admin/worldedit.ts";
import { tileX, tileY } from "./fields.ts";

/** Grid positions: 1.6 maps were named by any integer pair (`x0y-1` exists). */
const gridPos = z.number().int().min(-1_000_000).max(1_000_000);

const layerRows = z.array(z.string().max(80)).length(12);

const flag = z.string().max(1);

const mapExit = z
  .strictObject({
    mx: gridPos,
    my: gridPos,
    x: tileX,
    y: tileY,
    house: z.union([z.literal(1), z.literal(2)]).optional(),
  })
  .nullable();

const placed = z.strictObject({ name: z.string().min(1).max(40), x: tileX, y: tileY });

/** One editor save; the server checks the rest (`editorMapError`). */
export const editorMapSchema = z.strictObject({
  mx: gridPos,
  my: gridPos,
  layers: z.tuple([layerRows, layerRows, layerRows, layerRows]),
  flags: z.strictObject({
    canFight: flag,
    /** A faction key, or "" for none. */
    fctSpwn: z.string().max(40),
    isIndoors: flag,
    canPvp: flag,
  }),
  header: z.string().max(HEADER_MAX),
  signs: z.tuple([z.string().max(SIGN_MAX), z.string().max(SIGN_MAX), z.string().max(SIGN_MAX)]),
  exit1: mapExit,
  exit2: mapExit,
  fog: z.strictObject({
    tex: z.string().max(20),
    blend: z.number().int().min(0).max(255),
    r: z.number().int().min(0).max(255),
    g: z.number().int().min(0).max(255),
    b: z.number().int().min(0).max(255),
  }),
  mobs: z.tuple([placed.nullable(), placed.nullable(), placed.nullable(), placed.nullable()]),
  items: z.array(placed).max(EDITOR_ITEM_SLOTS),
});

/** Admin menu → World Editor. */
export const editOpenSchema = z.strictObject({ t: z.literal("editOpen") });

/** LOAD or a map arrow: the map at X/Y. */
export const editLoadSchema = z.strictObject({
  t: z.literal("editLoad"),
  mx: gridPos,
  my: gridPos,
});

/** SAVE. */
export const editSaveSchema = z.strictObject({ t: z.literal("editSave"), map: editorMapSchema });

/** Admin menu → Return To Game. */
export const editCloseSchema = z.strictObject({ t: z.literal("editClose") });

/**
 * Admin menu → Control Panel: the admin leaves the map, as for the editors, and the client shows
 * the Control Panel. Leaving it is Return to Game (`editClose`).
 */
export const controlPanelOpenSchema = z.strictObject({ t: z.literal("controlPanelOpen") });

/** A name from the editor's two lists (`NPCed`, `MONed`; the server checks it). */
const npcName = z.string().max(40);

/** Admin menu → NPC Editor. */
export const npcEditOpenSchema = z.strictObject({ t: z.literal("npcEditOpen") });

/** LOAD, which loads the named NPC file. */
export const npcLoadSchema = z.strictObject({ t: z.literal("npcLoad"), name: npcName });

/** SAVE, which saves the NPC file: the field's text. */
export const npcSaveSchema = z.strictObject({
  t: z.literal("npcSave"),
  name: npcName,
  text: z.string().max(30_000),
});

/**
 * The Control Panel's Server Settings page opens, and its Revert: the settings as the server holds
 * them (SSO's typed settings forms in place of the File Editor).
 */
export const settingsOpenSchema = z.strictObject({ t: z.literal("settingsOpen") });

/**
 * The window's SAVE: the values by setting key, those of the page being saved (keys left out keep
 * their values). Each value is checked by its setting's own schema on the server
 * (server/src/settings.ts); one bad value refuses the whole save.
 */
export const settingsSaveSchema = z.strictObject({
  t: z.literal("settingsSave"),
  values: z.record(z.string().max(40), z.unknown()),
});

/** The old Server Settings window's close box. No client sends it now; the server ignores it. */
export const settingsCloseSchema = z.strictObject({ t: z.literal("settingsClose") });

/** An ISO time (`2026-11-22T09:00:00.000Z`), as the activity log's filters send it. */
const isoTime = z
  .string()
  .max(30)
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/);

/**
 * The Control Panel's Activity Log page asks for a page of rows: one character's timeline
 * (`character`, by name) or every movement of one item (`item`). `before` is the last row of the
 * page already shown. `seq` comes back on the reply. Gated by the `activityLog` permission.
 */
export const activityQuerySchema = z.strictObject({
  t: z.literal("activityQuery"),
  seq: z
    .number()
    .int()
    .min(0)
    .max(2 ** 31),
  scope: z.enum(["character", "item"]),
  name: z.string().min(1).max(ACTIVITY_QUERY_MAX),
  /** Event types to show (every type when empty); an unknown type refuses the query. */
  types: z.array(z.string().max(20).refine(isActivityType)).max(ACTIVITY_TYPES.length),
  since: isoTime.nullable(),
  until: isoTime.nullable(),
  before: z.strictObject({ at: isoTime, id: z.string().max(40) }).nullable(),
  limit: z.number().int().min(1).max(ACTIVITY_PAGE_MAX),
});

const seqField = z
  .number()
  .int()
  .min(0)
  .max(2 ** 31);

/**
 * The Characters page's search: characters whose name contains `query`, ignoring case (the most
 * recently saved when it is empty). Gated by the `characterView` permission.
 */
export const characterSearchSchema = z.strictObject({
  t: z.literal("characterSearch"),
  seq: seqField,
  query: z.string().max(CHARACTER_SEARCH_MAX),
});

/** Opens one character's player hub, by name. Gated by `characterView`, and every read is audited. */
export const characterOpenSchema = z.strictObject({
  t: z.literal("characterOpen"),
  seq: seqField,
  name: z.string().min(1).max(CHARACTER_SEARCH_MAX),
});

/**
 * One of the hub's moderation buttons: the chat command of the same name, with the same checks
 * (the command's own permission, rank and who may change a ban). `duration` is a length as the
 * commands read it (`30m`, `7d`, `perm`) or "" for the setting's default.
 */
export const characterModerateSchema = z.strictObject({
  t: z.literal("characterModerate"),
  /** Comes back on the result, so it reaches only the hub that asked. */
  seq: seqField,
  name: z.string().min(1).max(CHARACTER_SEARCH_MAX),
  action: z.enum(HUB_ACTIONS),
  duration: z.string().max(12),
  reason: z.string().max(200),
});

const editPoint = z.strictObject({
  map: z.string().max(40),
  x: z.number().int().min(-1000).max(1000),
  y: z.number().int().min(-1000).max(1000),
});
const editInt = z
  .number()
  .int()
  .min(-(2 ** 31))
  .max(2 ** 31);
const itemName = z.string().max(80);

/**
 * The character editor's values, one optional key per field it may set (shared
 * rules/admin/character-edit.ts `SETTABLE_FIELDS`); the server checks every value against the
 * game's limits. The shape only bounds the message.
 */
const editValues = z
  .strictObject({
    classCode: editInt,
    level: editInt,
    exp: editInt,
    hp: editInt,
    sp: editInt,
    str: editInt,
    sta: editInt,
    dex: editInt,
    int: editInt,
    wis: editInt,
    /** By skill key: only the skills the edit changes need be named. */
    skills: z
      .record(z.string().max(80), editInt)
      .refine((o) => Object.keys(o).length <= 1000, "too many skills"),
    hunger: editInt,
    faction: z.string().min(1).max(40).nullable(),
    factionCount: editInt,
    wanted: z.boolean(),
    respawn: editPoint.nullable(),
    gold: editInt,
    bank: editInt.nullable(),
    bag: z.array(z.strictObject({ item: itemName, qty: editInt }).nullable()).max(15),
    equip: z.strictObject({
      weapon: itemName,
      offHand: itemName,
      head: itemName,
      body: itemName,
      feet: itemName,
      ring: itemName,
    }),
    vault: z.array(itemName).max(30),
    spellbook: z.array(z.string().max(40)).max(64),
    position: editPoint,
    sex: editInt,
    head: editInt,
  })
  .partial();

// The schema names exactly the settable fields (a mismatch is a type error).
type EditKeys = keyof z.infer<typeof editValues>;
true satisfies [Exclude<SettableField, EditKeys>, Exclude<EditKeys, SettableField>] extends [
  never,
  never,
]
  ? true
  : false;

/**
 * The player hub's character editor: the new values (`set`) and the values the hub showed for
 * those same fields (`seen`), so an edit made over a stale hub is refused rather than undoing
 * whatever changed since. Gated by `characterEditor`; a reason is required.
 */
export const characterEditSchema = z.strictObject({
  t: z.literal("characterEdit"),
  seq: seqField,
  name: z.string().min(1).max(CHARACTER_SEARCH_MAX),
  set: editValues,
  seen: editValues,
  /** Save worn gear that breaks the wear rules; logged with the edit. */
  override: z.boolean(),
  reason: z.string().max(200),
});

/** Undoes one edit from the character's log, by id, when nothing it set has changed since. */
export const characterUndoSchema = z.strictObject({
  t: z.literal("characterUndo"),
  seq: seqField,
  name: z.string().min(1).max(CHARACTER_SEARCH_MAX),
  id: z.string().min(1).max(40),
  reason: z.string().max(200),
});

/** A role as the Roles page sends it (shared `RoleData`; the server checks it with `roleDataError`). */
const roleDataSchema = z.strictObject({
  id: z.string().max(40),
  name: z.string().max(40),
  rank: z.number().int(),
  permissions: z.array(z.string().max(40)).max(100),
});

/**
 * Roles page → Save: a new role (`create`, refused if the id is taken) or a change to one. Gated by
 * the `settings` permission and audited.
 */
export const roleSaveSchema = z.strictObject({
  t: z.literal("roleSave"),
  role: roleDataSchema,
  create: z.boolean(),
});

/** Roles page → Delete: its accounts are left with no role. */
export const roleDeleteSchema = z.strictObject({
  t: z.literal("roleDelete"),
  id: z.string().max(40),
});

/** Staff page: gives a character's account a role, or none (`null`). */
export const roleAssignSchema = z.strictObject({
  t: z.literal("roleAssign"),
  name: z.string().max(40),
  role: z.string().max(40).nullable(),
});

/**
 * One page of the Server Settings window's sidebar (server/src/settings.ts `SETTING_PAGES`). The
 * server sends only the pages the player may use. A `rows` page lists the settings whose `page` is its
 * id and is saved on its own. The `roles` page edits the role definitions (`roleSave`,
 * `roleDelete`) and the `staff` page who holds them (`roleAssign`).
 */
export interface SettingPage {
  id: string;
  title: string;
  kind: "rows" | "roles" | "staff";
  /** A line under the page's intro: where settings it once held have gone. */
  note?: string;
}

/** A role on the Roles page, with how many accounts hold it. */
export interface RoleRow {
  id: string;
  name: string;
  rank: number;
  permissions: string[];
  holders: number;
}

/** A staff account on the Staff page: its character's name and its role's id. */
export interface StaffRow {
  name: string;
  role: string;
}

/** One row of the Server Settings window (server/src/settings.ts). */
export interface SettingRow {
  key: string;
  /** The id of the page it is on (`SettingPage.id`); rows come in page order. */
  page: string;
  /** The row's label. */
  label: string;
  /** What it does and where 1.6 had it (every setting carries an explanation). */
  tooltip: string;
  /**
   * The control: a map tile (`point`), a list of them (`points`), a whole number (`int`, with
   * `min`/`max`), a length of time (`duration`, whole seconds from `min` to `max`), on/off
   * (`bool`), one of a list (`choice`, the values and their labels in `choices`), a map name or
   * none (`map`), a list of map names (`maps`), a time zone (`zone`), the four Assassin prize
   * lines (`prizes`), or free text (`text`, the login news).
   */
  kind:
    | "point"
    | "points"
    | "int"
    | "duration"
    | "bool"
    | "choice"
    | "map"
    | "maps"
    | "zone"
    | "prizes"
    | "text";
  value: unknown;
  default: unknown;
  min?: number;
  max?: number;
  /** A `choice`'s values, in order, each with the label the window shows. */
  choices?: { value: string; label: string }[];
  /** What a `duration` of 0 means, such as "off" or "permanent", when 0 is allowed. */
  zero?: string;
}

export type AdminServerMsg =
  /**
   * The World Editor shows a map (the map, item and monster fetches, then the map render): on
   * entering, on LOAD and on the arrows. `editing` is false when the editor closes; the map
   * snapshot follows.
   */
  | { t: "editor"; editing: true; map: EditorMap; exists: boolean }
  | { t: "editor"; editing: false }
  /** The NPC editor opens (frame 311, `go("NPC Editor")`). */
  | { t: "npcEditor" }
  /** The Control Panel opens. Return to Game closes it with `editor` (`editing: false`). */
  | { t: "controlPanel" }
  /**
   * LOAD's reply: the file as the server holds it, CR-separated; "" when there is
   * none. The client shows it through `showNpcScript`.
   */
  | { t: "npcScript"; name: string; text: string }
  /** An NPC editor save changed this NPC's file: its Bio window and shop list close (SSO). */
  | { t: "npcClosed" }
  /**
   * The Server Settings window: its pages, every setting with its value, the roles and the staff
   * who hold them.
   */
  | {
      t: "settings";
      pages: SettingPage[];
      rows: SettingRow[];
      roles: RoleRow[];
      staff: StaffRow[];
    }
  /**
   * The Server Settings window's SAVE: applied for everyone online, or refused whole with the
   * setting at fault (`key`, null for an unknown one) and why.
   */
  | { t: "settingsResult"; ok: true }
  | { t: "settingsResult"; ok: false; key: string | null; text: string }
  /** A role save, delete or assignment: done (the window's `settings` follows) or refused. */
  | { t: "roleResult"; ok: boolean; text: string }
  /**
   * A page of the activity log, newest first (`activityQuery`'s answer, with its `seq`). `more`
   * when older rows match. The first page of an item's flow carries its totals by type. `error`
   * when nothing could be read (no character by that name has ever been logged).
   */
  | {
      t: "activity";
      seq: number;
      rows: ActivityRow[];
      more: boolean;
      totals?: ActivityTotal[];
      /** The totals cover only this many newest events: older ones were left out. */
      totalsCapped?: number;
      error?: string;
    }
  /** The Characters page's search results (`characterSearch`'s answer, with its `seq`). */
  | { t: "characterList"; seq: number; rows: CharacterListRow[] }
  /** A player hub (`characterOpen`'s answer), or why there is none. */
  | { t: "characterHub"; seq: number; hub: CharacterHub | null; error?: string }
  /** A hub button's outcome: the lines the chat command would have printed. */
  | { t: "characterResult"; seq: number; ok: boolean; text: string };
