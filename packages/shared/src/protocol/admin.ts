/** The World Editor, the NPC editor and the Settings window. */
import { z } from "zod";

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
  flags: z.strictObject({ canFight: flag, fctSpwn: flag, isIndoors: flag, canPvp: flag }),
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
 * Admin menu → Settings, and the window's LOAD: the settings as the server holds them (SSO's typed
 * settings forms in place of the File Editor).
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

/** The Settings window closes (its close box). */
export const settingsCloseSchema = z.strictObject({ t: z.literal("settingsClose") });

/**
 * One page of the Settings window's sidebar (server/src/settings.ts `SETTING_PAGES`). The server
 * sends only the pages the player may use. A `rows` page lists the settings whose `page` is its
 * id and is saved on its own; other kinds of page (roles, per-map overrides) will bring their own
 * editor and messages.
 */
export interface SettingPage {
  id: string;
  title: string;
  kind: "rows";
}

/** One row of the Settings window (server/src/settings.ts). */
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
   * (`bool`), a map name or none (`map`), a list of map names (`maps`), a time zone (`zone`), the
   * four Assassin prize lines (`prizes`), or free text (`text`, the login news).
   */
  kind:
    | "point"
    | "points"
    | "int"
    | "duration"
    | "bool"
    | "map"
    | "maps"
    | "zone"
    | "prizes"
    | "text";
  value: unknown;
  default: unknown;
  min?: number;
  max?: number;
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
  /**
   * LOAD's reply: the file as the server holds it, CR-separated; "" when there is
   * none. The client shows it through `showNpcScript`.
   */
  | { t: "npcScript"; name: string; text: string }
  /** An NPC editor save changed this NPC's file: its Bio window and shop list close (SSO). */
  | { t: "npcClosed" }
  /** The Settings window: its pages, and every setting with its value. */
  | { t: "settings"; pages: SettingPage[]; rows: SettingRow[] }
  /**
   * The Settings window's SAVE: applied for everyone online, or refused whole with the setting
   * at fault (`key`, null for an unknown one) and why.
   */
  | { t: "settingsResult"; ok: true }
  | { t: "settingsResult"; ok: false; key: string | null; text: string };
