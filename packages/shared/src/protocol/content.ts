/**
 * The content store's messages (issue #27): the Control Panel's Content page (the shared draft,
 * its checks, the publish history with undo, the installed packs and their notices, and a JSON
 * editor for one row), and the hash every client follows to fetch the store. The Content page's
 * intents are gated by the `contentEditor` permission.
 */

import { z } from "zod";

import type {
  ArtBody,
  ArtFrameId,
  ArtFx,
  ArtItem,
  ArtSound,
  ArtTile,
  ArtWorn,
  ChanceSettings,
  Curve,
  EquipSlot,
  GatherData,
  HarvestNode,
  Item,
  ItemDefinition,
  ItemRulesData,
  Monster,
  MonsterDefinition,
  MonsterSpellRule,
  ProgressionData,
  Skill,
  SkillProgression,
  StatTable,
  XpSettings,
  YieldTable,
} from "@secondstaronline/data";

import type { BodyUse } from "../content/bodies.ts";
import type { FxRunUse } from "../content/fx.ts";
import type { SoundUse } from "../content/sounds.ts";
import type { TileRow } from "../content/tiles.ts";
import type { WornLayerUse } from "../content/worn.ts";

const seq = z
  .number()
  .int()
  .min(0)
  .max(2 ** 31);

/** A dataset id, a top-level field and an entry key (null for a whole field). */
const ref = {
  dataset: z.string().min(1).max(20),
  /** A dataset's top-level field: a plain identifier. */
  part: z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,39}$/),
  key: z.string().min(1).max(80).nullable(),
};

export interface ContentRowRef {
  dataset: string;
  part: string;
  key: string | null;
}

/** The Content page's overview. */
export const contentOverviewSchema = z.strictObject({ t: z.literal("contentOverview"), seq });

/** The rows of one dataset field (every entry of a keyed list, or the field itself). */
export const contentListSchema = z.strictObject({
  t: z.literal("contentList"),
  seq,
  dataset: ref.dataset,
  part: ref.part,
});

/** One row: the pack's version, the published one and the draft's. */
export const contentRowSchema = z.strictObject({ t: z.literal("contentRow"), seq, ...ref });

/**
 * Puts a change in the shared draft: `set` the row's JSON, `remove` a keyed row, or `revert` it
 * to its pack version.
 */
export const contentDraftSchema = z.strictObject({
  t: z.literal("contentDraft"),
  seq,
  ...ref,
  op: z.enum(["set", "remove", "revert"]),
  data: z.unknown(),
  /**
   * The row's revision as the page last saw it (`ContentRowDetail.revision`). A balance row
   * needs it, so a stale JSON editor cannot write over a Balance page save (issue #19).
   */
  expect: z.string().max(64).optional(),
});

/** Drops a change from the draft (`expect` as for `contentDraft`). */
export const contentDiscardSchema = z.strictObject({
  t: z.literal("contentDiscard"),
  seq,
  ...ref,
  expect: z.string().max(64).optional(),
});

/**
 * Publishes the draft as the admin last saw it (`draftRev`, the overview's revision), so a change
 * another admin made since refuses the publish. `logoutEveryone` (issue #40) logs every other
 * player out first and refuses logins until the publish ends.
 */
export const contentPublishSchema = z.strictObject({
  t: z.literal("contentPublish"),
  seq,
  summary: z.string().max(200),
  draftRev: z.string().regex(/^[0-9a-f]{16}$/),
  logoutEveryone: z.boolean().optional(),
});

/** Undoes a publish as a whole. */
export const contentUndoSchema = z.strictObject({
  t: z.literal("contentUndo"),
  seq,
  id: z.string().min(1).max(40),
});

/** Answers a pack-update notice: take the pack's version (`accept`) or keep yours. */
export const contentNoticeSchema = z.strictObject({
  t: z.literal("contentNotice"),
  seq,
  ...ref,
  accept: z.boolean(),
});

/**
 * An item, a monster (NPCs are monsters) or a vehicle (issue #44), by key, for where-used and
 * removal (issue #28).
 */
const entry = {
  kind: z.enum(["item", "monster", "vehicle"]),
  key: z.string().min(1).max(80),
};

/** Where an item or a monster is used: content rows and the world. */
export const contentUsageSchema = z.strictObject({ t: z.literal("contentUsage"), seq, ...entry });

const replacement = z.string().max(80).nullable();

/**
 * Puts an item's or monster's removal in the draft with its cleanup: what happens to the
 * references content holds (`content`), and, published, to the world. An item: the copies players
 * hold are retired, purged (with an optional gold refund for each) or replaced. A monster: its
 * roster slots are cleared or replaced, live ones despawn or stay until they die, and its own NPC
 * file goes with it or stays. A vehicle: its riders land and its parked ones become their deed
 * where they are, or both switch to another vehicle.
 */
export const contentRemoveSchema = z.strictObject({
  t: z.literal("contentRemove"),
  seq,
  ...entry,
  content: z.enum(["remove", "replace", "leave"]),
  replacement,
  /** An item's copies (default: retire). */
  copies: z.enum(["retire", "purge", "replace"]).optional(),
  /** Gold back for each purged copy a character held. */
  refundGold: z.number().int().min(0).max(1_000_000).optional(),
  /** A monster's roster slots (default: remove). */
  spawns: z.enum(["remove", "replace"]).optional(),
  /** A monster's live ones (default: despawn). */
  live: z.enum(["despawn", "leave"]).optional(),
  /** A monster's own NPC file row (default: delete). */
  npcRow: z.enum(["delete", "keep"]).optional(),
  /** A vehicle's riders and parked ones (default: land). */
  riders: z.enum(["land", "switch"]).optional(),
});

/** The references nothing resolves: the Content problems list. */
export const contentProblemsSchema = z.strictObject({ t: z.literal("contentProblems"), seq });

/**
 * A ticket for uploading art and sounds (issue #29). Files are too big for the socket, so the page
 * posts each one to `/upload/<image|sound>` with the ticket in `x-upload-ticket`; the answer names
 * the stored file by its hash, for an `art` row to use.
 */
export const contentUploadTicketSchema = z.strictObject({
  t: z.literal("contentUploadTicket"),
  seq,
});

// ---- the Packs page (issue #34) ----

/**
 * Exporting and importing packs. The files are too big for the socket: an export is downloaded
 * from `PACK_DOWNLOAD_PATH` and an import posted to `/upload/pack`, each with an upload ticket in
 * `x-upload-ticket`. The posted file is checked and answered with a `ContentPackPreview`; nothing
 * changes until `contentPackApply` names it.
 */
export const PACK_DOWNLOAD_PATH = "/download/pack";

/** Asks for the Packs page's view. */
export const contentPacksSchema = z.strictObject({ t: z.literal("contentPacks"), seq });

/**
 * Puts a checked pack file in: its rows into the draft (`merge`), or as a pack (`install`); or
 * lets it go (`cancel`).
 */
export const contentPackApplySchema = z.strictObject({
  t: z.literal("contentPackApply"),
  seq,
  importId: z.string().uuid(),
  mode: z.enum(["merge", "install", "cancel"]),
});

/** Removes an imported pack (at the next start). */
export const contentPackRemoveSchema = z.strictObject({
  t: z.literal("contentPackRemove"),
  seq,
  id: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
});

/** An installed pack as the Packs page lists it. */
export interface ContentPackEntry {
  id: string;
  name: string;
  version: string;
  source: "release" | "imported";
  /** The release it was made for. */
  sso: string;
  /**
   * `loaded`: in play. `next start`: installed or updated, in play from the next start.
   * `removed at next start`. `left out`: an imported pack the start could not load.
   */
  state: "loaded" | "next start" | "removed at next start" | "left out";
}

/** The Packs page's view. */
export interface ContentPacksView {
  packs: ContentPackEntry[];
  /** Why the imported packs were left out at start, or null. */
  leftOut: string | null;
  /** The release this server runs, which an export records. */
  release: string;
}

/** What a checked pack file would change, before anything does. */
export interface ContentPackPreview {
  importId: string;
  manifest: {
    id: string;
    name: string;
    version: string;
    sso: string;
    builtOn: { id: string; version: string }[];
    exportedAt: string | null;
  };
  files: number;
  /** Rows (as `items/items/Ale`) it adds, changes and removes against the published store. */
  added: string[];
  changed: string[];
  removed: string[];
  unchanged: number;
  /** Rows the operator's published changes also change: theirs stay on top of an installed pack. */
  overYourChanges: string[];
  /** Rows the draft holds: a merge replaces them. */
  overTheDraft: string[];
  /** Installing it as a pack: whether it can be, why not, and the version it would update. */
  install: { ok: boolean; errors: string[]; updates: string | null };
  /** Merging it into the draft: the problems the draft would then have. */
  merge: { problems: string[] };
}

/**
 * Everything the item picture picker needs at once (issue #29): the draft's items, their uploaded
 * pictures and the currency, so it never fetches hundreds of rows one by one.
 */
export const contentItemArtSchema = z.strictObject({ t: z.literal("contentItemArt"), seq });

const pictureSettings = z.strictObject({
  file: z.string().regex(/^[0-9a-f]{64}$/),
  regX: z.number().int().min(-2048).max(2048),
  regY: z.number().int().min(-2048).max(2048),
  transparency: z.enum(["alpha", "green"]),
});

/**
 * One picture change (issue #29), made in the draft as a whole: the server reads the item as the
 * draft has it now and changes only its `sprite` and its upload, so no other edit is lost and no
 * half of a change is left behind. See `PictureChange`.
 */
/** Asks for the worn frame set panels' view (issue #29, stage 3). */
export const contentWornArtSchema = z.strictObject({ t: z.literal("contentWornArt"), seq });

const fileHash = z.string().regex(/^[0-9a-f]{64}$/);
const frameIds = [
  "f1-n",
  "f1-e",
  "f1-s",
  "f1-w",
  "f2-n",
  "f2-e",
  "f2-s",
  "f2-w",
  "f3-n",
  "f3-e",
  "f3-s",
  "f3-w",
  "f4-n",
  "f4-e",
  "f4-s",
  "f4-w",
] as const;
const layerName = z.string().trim().min(1).max(80);

/**
 * Cuts an uploaded sheet (184×180: rows N, E, S, W of frames F1-F4) into frame files, stored like
 * any upload. Nothing goes in the draft: the answer names the frames, to save with `contentWorn`.
 */
export const contentWornSheetSchema = z.strictObject({
  t: z.literal("contentWornSheet"),
  seq,
  sheet: fileHash,
});

/**
 * One worn layer change (issue #29, stage 3), made in the draft as a whole: set a layer's frames
 * (the whole row), take its upload out, or give an item its own layer by taking out the exact
 * alias rows that name it alone. See `WornChange`.
 */
export const contentWornSchema = z.strictObject({
  t: z.literal("contentWorn"),
  seq,
  change: z.discriminatedUnion("op", [
    z.strictObject({
      op: z.literal("set"),
      layer: layerName,
      frames: z.partialRecord(z.enum(frameIds), fileHash),
      mirrored: z.boolean(),
      transparency: z.enum(["alpha", "green"]),
    }),
    z.strictObject({ op: z.literal("remove"), layer: layerName }),
    z.strictObject({ op: z.literal("ownLayer"), item: z.string().min(1).max(80) }),
  ]),
});

/** Asks for the body panels' view (issue #29, stage 4). */
export const contentBodyArtSchema = z.strictObject({ t: z.literal("contentBodyArt"), seq });

/**
 * Cuts an uploaded body sheet (rows N, E, S, W of frames F1-F4, equal cells up to 512×512) into
 * its 16 frame files, stored like any upload. Nothing goes in the draft: the answer names the
 * frames and the cell size, to save with `contentBody`.
 */
export const contentBodySheetSchema = z.strictObject({
  t: z.literal("contentBodySheet"),
  seq,
  sheet: fileHash,
});

/** A body number (1 to 9999, the data schema's `BODY_MAX`). */
const bodyNumber = z.number().int().min(1).max(9999);
const anchoredFile = z.strictObject({
  file: fileHash,
  regX: z.number().int().min(-2048).max(2048),
  regY: z.number().int().min(-2048).max(2048),
});
const bodyFrameSet = {
  frames: z.partialRecord(z.enum(frameIds), anchoredFile),
  mirrored: z.boolean(),
  transparency: z.enum(["alpha", "green"]),
};

/**
 * One body change (issue #29, stage 4), made in the draft as a whole: paint a body that exists,
 * make a new body (the server picks its number, and gives it to a monster when one is named),
 * take a body's upload out, or give a monster another body. See `BodyChange`.
 */
export const contentBodySchema = z.strictObject({
  t: z.literal("contentBody"),
  seq,
  change: z.discriminatedUnion("op", [
    z.strictObject({
      op: z.literal("set"),
      body: bodyNumber,
      /** A monster's own body being replaced: refused unless it still draws it alone. */
      owner: z.string().min(1).max(80).optional(),
      ...bodyFrameSet,
    }),
    z.strictObject({
      op: z.literal("new"),
      monster: z.string().min(1).max(80).optional(),
      /** The monster's body as the panel showed it: refused if it has changed since. */
      from: bodyNumber.optional(),
      ...bodyFrameSet,
    }),
    z.strictObject({ op: z.literal("remove"), body: bodyNumber }),
    z.strictObject({
      op: z.literal("choose"),
      monster: z.string().min(1).max(80),
      body: bodyNumber,
      /** The monster's body as the panel showed it: refused if it has changed since. */
      from: bodyNumber.optional(),
    }),
  ]),
});

/** Asks for the effect panels' view (issue #29, stage 5). */
export const contentFxArtSchema = z.strictObject({ t: z.literal("contentFxArt"), seq });

/**
 * Cuts an uploaded strip (rows of `across` equal frames: the run's rows, then its trail's) into
 * frame files, stored like any upload. Nothing goes in the draft: the answer names the frames, to
 * save with `contentFx`.
 */
export const contentFxSheetSchema = z.strictObject({
  t: z.literal("contentFxSheet"),
  seq,
  sheet: fileHash,
  across: z.number().int().min(1).max(99),
  /** Rows of the run's frames, then rows of its trail's, read left to right, top to bottom. */
  runRows: z.number().int().min(1).max(99),
  trailRows: z.number().int().min(0).max(99),
});

const runName = z.string().trim().min(1).max(80);
const runFrames = z.array(anchoredFile).min(1).max(99);
/** An art row's fingerprint (`artRowFingerprint`), null for none, or left out for no check. */
const fingerprint = z
  .string()
  .regex(/^[0-9a-f]{8}$/)
  .nullable()
  .optional();

/**
 * One effect run change (issue #29, stage 5), made in the draft as a whole: paint a run (its
 * frames, its trail, and from its spell the spell row's length), or take its upload out. `seen` is
 * who the panel said draws the run; the change is refused if that has changed. See `FxChange`.
 */
export const contentFxSchema = z.strictObject({
  t: z.literal("contentFx"),
  seq,
  change: z.discriminatedUnion("op", [
    z.strictObject({
      op: z.literal("set"),
      run: runName,
      frames: runFrames,
      trail: runFrames.nullable(),
      transparency: z.enum(["alpha", "green"]),
      seen: z.array(z.string().min(1).max(120)).max(64),
      fit: z.boolean().optional(),
      /** The run's upload as the panel saw it; refused if it changed since. */
      expect: fingerprint,
    }),
    z.strictObject({ op: z.literal("remove"), run: runName, expect: fingerprint }),
  ]),
});

/** Asks for the tile panels' view (issue #29, stage 6). */
export const contentTileArtSchema = z.strictObject({ t: z.literal("contentTileArt"), seq });

/**
 * Cuts an uploaded tileset (sides multiples of 32, at most 2048) into 32×32 tile files, stored
 * like any upload; cells that show nothing once `transparency` is applied are left out. Nothing
 * goes in the draft: the answer names each cell's file, to add with `contentTile`.
 */
export const contentTileSheetSchema = z.strictObject({
  t: z.literal("contentTileSheet"),
  seq,
  sheet: fileHash,
  transparency: z.enum(["alpha", "green"]),
});

const tileCode = z.string().trim().min(1).max(16);
const tileName = z.string().trim().max(80);

/**
 * One tile change (issue #29, stage 6), made in the draft as a whole: add tiles (the server gives
 * each its code), paint a tile, take its upload out, change its name, walkability and flags, or
 * take it out of the catalogue. See `TileChange`.
 */
export const contentTileSchema = z.strictObject({
  t: z.literal("contentTile"),
  seq,
  change: z.discriminatedUnion("op", [
    z.strictObject({
      op: z.literal("add"),
      tiles: z
        .array(
          z.strictObject({
            file: fileHash,
            name: tileName.optional(),
            walkable: z.boolean(),
          }),
        )
        .min(1)
        .max(512),
      transparency: z.enum(["alpha", "green"]),
    }),
    z.strictObject({
      op: z.literal("set"),
      code: tileCode,
      file: fileHash,
      transparency: z.enum(["alpha", "green"]),
      /** The tile's upload as the panel saw it; refused if it changed since. */
      expect: fingerprint,
    }),
    z.strictObject({ op: z.literal("remove"), code: tileCode, expect: fingerprint }),
    z.strictObject({
      op: z.literal("edit"),
      code: tileCode,
      name: tileName.nullable(),
      walkable: z.boolean(),
      flags: z.array(z.enum(["sea", "airshipBlock", "dock", "arena", "grave"])).max(5),
      /** The tile as the panel showed it (`tileFingerprint`); refused if it changed since. */
      seen: fingerprint,
    }),
    z.strictObject({ op: z.literal("delete"), code: tileCode, seen: fingerprint }),
  ]),
});

/** Asks for the Balance page's view (issue #19). */
export const contentBalanceSchema = z.strictObject({ t: z.literal("contentBalance"), seq });

/**
 * One Balance page change (issue #19), as a row of the `balance` dataset: `set` its whole value,
 * `revert` it to the packs' value (or the engine's default when no pack sets it), or `discard` the
 * draft's change to it. `expect` is the row as the page last showed it (`BalanceRowView.fingerprint`):
 * a change someone else made since refuses the save.
 */
export const contentBalanceSetSchema = z.strictObject({
  t: z.literal("contentBalanceSet"),
  seq,
  part: z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,39}$/),
  key: z.string().min(1).max(40).nullable(),
  op: z.enum(["set", "revert", "discard"]),
  data: z.unknown(),
  expect: z.string().regex(/^[0-9a-f]{16}$/),
});

/**
 * Asks for the Items page's view (issue #30): the item list, and with `name` the item open in its
 * form.
 */
export const contentItemsSchema = z.strictObject({
  t: z.literal("contentItems"),
  seq,
  name: z.string().min(1).max(80).optional(),
});

/**
 * One Items page change (issue #30). `set` writes the item's definition (`data`); `revert` drops
 * it, so the item follows the pack's rules again; `discard` drops the draft's changes to the item;
 * `rename` sets its display name (`display`, empty for none); `create` adds a new item `name`,
 * copying `copyFrom`'s rules and picture if given. `expect` is the item as the page last showed it
 * (`ContentItemView.fingerprint`); `create` names none.
 */
export const contentItemSetSchema = z.strictObject({
  t: z.literal("contentItemSet"),
  seq,
  /** An existing item's key (a catalogue key may be 80 long); a new item's is at most 40. */
  name: z.string().trim().min(1).max(80),
  op: z.enum(["set", "revert", "discard", "rename", "create"]),
  data: z.unknown().optional(),
  display: z.string().max(40).optional(),
  copyFrom: z.string().min(1).max(80).optional(),
  expect: z
    .string()
    .regex(/^[0-9a-f]{16}$/)
    .optional(),
});

/** Asks for the NPCs page's view (issue #32), with `name` the NPC file open. */
export const contentNpcsSchema = z.strictObject({
  t: z.literal("contentNpcs"),
  seq,
  name: z.string().trim().min(1).max(80).optional(),
});

/**
 * The NPCs page's save (issue #32): the whole file's text, checked as the NPC Editor's SAVE is, and
 * live at once. `expect` is the revision the page showed (null: it had no file).
 */
export const contentNpcSaveSchema = z.strictObject({
  t: z.literal("contentNpcSave"),
  seq,
  name: z.string().trim().min(1).max(80),
  text: z.string().max(30_000),
  expect: z
    .string()
    .regex(/^[0-9a-f]{16}$/)
    .nullable(),
});

/** Asks for the Monsters page's view (issue #31, stage 4), with `name` the monster open. */
export const contentMonstersSchema = z.strictObject({
  t: z.literal("contentMonsters"),
  seq,
  name: z.string().min(1).max(80).optional(),
});

/**
 * One Monsters page change (issue #31, stage 4). `set` writes the monster's species record
 * (`record`: its stats and flags; its name, display and body stay the draft's) and definition
 * (`data`); `revert` drops the definition, so the monster plays the pack's rules again; `discard`
 * drops the draft's changes to the monster; `rename` sets its display name; `create` adds a new
 * monster `name`, copying `copyFrom`'s record, rules and NPC file if given. `expect` is the monster
 * as the page last showed it; `create` names none.
 */
export const contentMonsterSetSchema = z.strictObject({
  t: z.literal("contentMonsterSet"),
  seq,
  name: z.string().trim().min(1).max(80),
  op: z.enum(["set", "revert", "discard", "rename", "create"]),
  record: z.unknown().optional(),
  data: z.unknown().optional(),
  display: z.string().max(40).optional(),
  copyFrom: z.string().min(1).max(80).optional(),
  expect: z
    .string()
    .regex(/^[0-9a-f]{16}$/)
    .optional(),
});

/** Asks for the Skills page's view (issue #38), with `key` the skill open. */
export const contentSkillsSchema = z.strictObject({
  t: z.literal("contentSkills"),
  seq,
  key: z.string().min(1).max(80).optional(),
});

/** A skill's or gathering part's revision as the page last showed it. */
const pageExpect = z
  .string()
  .regex(/^[0-9a-f]{16}$/)
  .optional();

/**
 * One Skills page change (issue #38). `set` writes the skill (`data`: its display name, whether it
 * is hidden, its progression, its place on the Skills page, its start values by start class, the
 * promotions that grant it, and its curve); `create` adds skill `key` (a permanent key, never
 * renamed) from `data`; `discard` drops the draft's changes to it; `revert` puts a pack's skill
 * back to what the pack plays for it (each row its form writes) once published. `expect` is the skill as the
 * page last showed it (`ContentSkillView.fingerprint`); `create` names none. The server checks
 * `data` field by field and refuses a change that brings a new problem.
 */
export const contentSkillSetSchema = z.strictObject({
  t: z.literal("contentSkillSet"),
  seq,
  key: z.string().trim().min(1).max(40),
  op: z.enum(["set", "create", "discard", "revert"]),
  data: z.unknown().optional(),
  expect: pageExpect,
});

/** Where a skill is used (issue #38): every reference, and the characters with a value stored. */
export const contentSkillUsageSchema = z.strictObject({
  t: z.literal("contentSkillUsage"),
  seq,
  key: z.string().min(1).max(80),
});

/**
 * Removes a skill in the draft (issue #38): each reference the usage listed is cleared or pointed
 * at another skill (`refs`, checked by the server against the usage it builds again). Characters'
 * stored values stay. Refused while a binding names it, or when the skill changed since `expect`.
 */
export const contentSkillRemoveSchema = z.strictObject({
  t: z.literal("contentSkillRemove"),
  seq,
  key: z.string().min(1).max(80),
  refs: z.unknown(),
  expect: pageExpect,
});

/** Asks for the Gathering page's view (issue #38). */
export const contentGatheringSchema = z.strictObject({ t: z.literal("contentGathering"), seq });

/**
 * One Gathering page change (issue #38): a harvest node's fields (`node`, with `index` the node
 * and `data` its node, yield table and regrowth), a new node (`newNode`), a node's removal
 * (`removeNode`), fishing's, farming's or the hit counter's tables, or `discard` (the draft's
 * gathering changes go). `expect` is the part as the page last showed it. The server checks `data`
 * against the schema and refuses a change that brings a new problem.
 */
export const contentGatheringSetSchema = z.strictObject({
  t: z.literal("contentGatheringSet"),
  seq,
  op: z.enum(["node", "newNode", "removeNode", "fishing", "farming", "counter", "discard"]),
  index: z.number().int().min(0).max(10_000).optional(),
  data: z.unknown().optional(),
  expect: pageExpect,
});

/** The Monster spells card's save (issue #31, stage 4): every monster spell, in the draft. */
export const contentMonsterSpellsSchema = z.strictObject({
  t: z.literal("contentMonsterSpells"),
  seq,
  spells: z.unknown(),
  expect: z.string().regex(/^[0-9a-f]{16}$/),
});

/**
 * One field of an NPC file line: one line of printable text, so a save can never add a line of its
 * own (a pasted line break), with none of the characters that split a line (`|`, `:`) or the file
 * (`` ` ``, `*`, `^`).
 */
const npcFileField = (max: number) =>
  // Not trimmed: a field the file holds with spaces must come back as it was, so an unchanged line
  // keeps its text (the server refuses a blank one).
  z
    .string()
    .min(1)
    .max(max)
    .refine(
      (t) =>
        ![...t].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 || "|:`*^".includes(c)),
      { message: "one line, without | : ` * or ^" },
    );

/**
 * Asks for a monster's NPC file sections (issue #31, stage 3): its drop lines, the monster spells
 * it casts and its flags, as the Monsters page edits them.
 */
export const contentNpcFileSchema = z.strictObject({
  t: z.literal("contentNpcFile"),
  seq,
  name: z.string().trim().min(1).max(80),
});

/**
 * Saves a monster's NPC file sections (issue #31, stage 3). Like an NPC Editor save it applies at
 * once, outside the draft; every other line of the file stays as it was. `expect` is the file's
 * revision as the page last showed it (`ContentNpcFileView.revision`, null when it had no file), so
 * a save over a file the NPC Editor or a publish changed since is refused.
 */
export const contentNpcFileSetSchema = z.strictObject({
  t: z.literal("contentNpcFileSet"),
  seq,
  name: z.string().trim().min(1).max(80),
  expect: z
    .string()
    .regex(/^[0-9a-f]{16}$/)
    .nullable(),
  sections: z.strictObject({
    loot: z
      .array(
        z.strictObject({
          item: npcFileField(80),
          // Any chance a file may hold (the NPC Editor takes any whole number from 1).
          oneIn: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
        }),
      )
      .max(100),
    spells: z.array(npcFileField(40)).max(100),
    flags: z.array(npcFileField(250)).max(100),
  }),
});

/** Asks for the sound panels' view (issue #29, stage 7). */
export const contentSoundArtSchema = z.strictObject({ t: z.literal("contentSoundArt"), seq });

const soundName = z.string().trim().min(1).max(80);
/** A sound's upload as the panel saw it: its fingerprint, or null for none. Never left out. */
const soundExpect = z
  .string()
  .regex(/^[0-9a-f]{8}$/)
  .nullable();

/**
 * One sound change (issue #29, stage 7), made in the draft as a whole: a sound's file (a new sound,
 * or replacing one), or its upload taken out. See `SoundChange`.
 */
export const contentSoundSchema = z.strictObject({
  t: z.literal("contentSound"),
  seq,
  change: z.discriminatedUnion("op", [
    z.strictObject({
      op: z.literal("set"),
      name: soundName,
      file: fileHash,
      format: z.enum(["wav", "mp3", "ogg"]),
      /** The sound's upload as the panel saw it; refused if it changed since. */
      expect: soundExpect,
    }),
    z.strictObject({ op: z.literal("remove"), name: soundName, expect: soundExpect }),
  ]),
});

export const contentPictureSchema = z.strictObject({
  t: z.literal("contentPicture"),
  seq,
  change: z.discriminatedUnion("op", [
    z.strictObject({
      op: z.literal("upload"),
      item: z.string().min(1).max(80),
      art: pictureSettings,
    }),
    z.strictObject({
      op: z.literal("choose"),
      item: z.string().min(1).max(80),
      picture: z.string().trim().min(1).max(80),
    }),
    z.strictObject({ op: z.literal("remove"), item: z.string().min(1).max(80) }),
    z.strictObject({
      op: z.literal("pile"),
      pile: z.enum(["SmallGold", "MediumGold", "LargeGold"]),
      art: pictureSettings.nullable(),
    }),
  ]),
});

/** The item picture picker's view of the draft. */
export interface ContentItemArtView {
  /** Every item row as the draft would publish it. */
  items: Item[];
  /** The `art` dataset's item pictures as the draft would publish them. */
  art: ArtItem[];
  /** The currency item (its ground piles are `SmallGold`, `MediumGold` and `LargeGold`). */
  currency: string | null;
  /**
   * The item pictures the installed packs draw, in lower case. With the draft's uploads, these are
   * the pictures that will exist once the draft is published.
   */
  packPictures: string[];
  /** The largest side an item picture may have. */
  maxSide: number;
}

/**
 * Everything the worn frame set panels need at once (issue #29, stage 3), worked out from the
 * draft's rules: the items that are worn and the layer each draws, every layer the content draws
 * with the frames it needs, the uploads, and the frames the packs draw.
 */
export interface ContentWornArtView {
  /** Every item that is worn somewhere, as the draft would publish it. */
  items: {
    name: string;
    display?: string;
    retired?: boolean;
    slot: EquipSlot;
    /** The layer it draws, or null: an alias makes it draw nothing. */
    layer: string | null;
    aliases: { index: number; match: "exact" | "contains"; pattern: string; becomes: string }[];
    ownLayerPossible: boolean;
  }[];
  /** Every layer the content draws, with its frames and who draws it. */
  layers: WornLayerUse[];
  /** The `art` dataset's worn layers as the draft would publish them. */
  art: ArtWorn[];
  /** The frames the installed packs draw, by layer name in lower case. */
  packLayers: Record<string, ArtFrameId[]>;
  /** The draft's renderer rules, so the preview stacks the layers as the game will. */
  rules: {
    aliases: ItemRulesData["paperdoll"]["aliases"];
    behaviours: ItemRulesData["behaviours"];
  };
  /** A hairstyle the preview's bare character wears (the first sex's first head). */
  head: number;
}

/**
 * Everything the body panels need at once (issue #29, stage 4), from the draft: every body the
 * content draws and who draws it, the monsters and their bodies, the uploads, and the bodies the
 * packs draw.
 */
export interface ContentBodyArtView {
  /** Every body the content draws, with who draws it. */
  bodies: BodyUse[];
  /** Every monster as the draft would publish it: its key, the name players see, its body. */
  monsters: { name: string; display?: string; body: number }[];
  /** The `art` dataset's bodies as the draft would publish them. */
  art: ArtBody[];
  /** The body numbers the installed packs draw. */
  packBodies: number[];
  /** The number the next new body would take, or null with none left. */
  next: number | null;
  /** The largest side a body frame may have. */
  maxSide: number;
  /** A hairstyle the preview's player wears for scale (the first sex's first head). */
  head: number;
}

/**
 * Everything the effect panels need at once (issue #29, stage 5), from the draft: every run the
 * content and the engine draw and who draws it, the spells and their runs, the uploads, and the
 * runs the packs draw.
 */
export interface ContentFxArtView {
  /** Every run drawn, with how many frames show and who draws it. */
  runs: FxRunUse[];
  /** Every spell with runs, as the draft would publish it: its key, its name, its runs' rows. */
  spells: {
    name: string;
    display?: string;
    fx: { member: string; effect: string; frames: number; lastFrame: number | null }[];
  }[];
  /** The `art` dataset's runs as the draft would publish them. */
  art: ArtFx[];
  /** The runs the installed packs draw, by lower-case member: their frame and trail counts. */
  packRuns: Record<string, { frames: number; trail: number }>;
  /** The largest side an effect frame may have. */
  maxSide: number;
  /** A hairstyle the preview's player wears for scale (the first sex's first head). */
  head: number;
}

/**
 * Everything the tile panels need at once (issue #29, stage 6), from the draft: the catalogue,
 * which tiles are walkable, the uploads, the tiles the packs draw, who names each tile and the maps
 * using it.
 */
export interface ContentTileArtView {
  /** The catalogue as the draft would publish it. */
  catalogue: TileRow[];
  /** The walkable codes as the draft would publish them. */
  walkable: string[];
  /** The `art` dataset's tiles as the draft would publish them. */
  art: ArtTile[];
  /** The codes the installed packs draw, lower case. */
  packTiles: string[];
  /** Content rows naming each tile, by lower-case code. */
  refs: Record<string, string[]>;
  /** Maps using each tile, by lower-case code (up to `TILE_MAPS_SHOWN` named, then a count). */
  maps: Record<string, { count: number; names: string[] }>;
  /** The code the next new tile would take, or null with none left. */
  next: string | null;
  /** The map ground tile, for the preview. */
  ground: string;
  /** Codes (lower case) with a published upload: removing it in the draft brings a pack's back. */
  liveUploads: string[];
  /** A hairstyle the preview's player wears (the first sex's first head). */
  head: number;
}

/**
 * Everything the sound panels need at once (issue #29, stage 7), from the draft: every sound the
 * content and the engine play with who plays it, the uploads, and where the packs' sounds are.
 */
export interface ContentSoundArtView {
  /** Every sound played, by lower-case name. */
  uses: Record<string, SoundUse>;
  /** The `art` dataset's sounds as the draft would publish them. */
  art: ArtSound[];
  /** Where each pack sound is served (`/assets/packs/…`), by lower-case name. */
  packSounds: Record<string, string>;
  /** Sounds (lower case) with a published upload: removing it in the draft brings a pack's back. */
  liveUploads: string[];
  /** The most a sound file may weigh. */
  maxBytes: number;
}

/** How many maps a tile's usage names. */
export const TILE_MAPS_SHOWN = 20;

/** Where uploads are posted: `/upload/image` or `/upload/sound`. */
export const UPLOAD_PATH = "/upload/";
/** The header `/assets/index.json` names its hash in (the one `content` and `welcome` carry). */
export const ASSETS_HASH_HEADER = "x-assets-hash";
/** The header an upload carries its ticket in. */
export const UPLOAD_TICKET_HEADER = "x-upload-ticket";

/** A kind of place the world keeps an item or a monster. */
export type ContentPlaceKind =
  | "bag"
  | "worn"
  | "vault"
  | "container"
  | "ground"
  | "quest"
  | "spawn"
  | "live"
  /** Stock on sale in player shops. */
  | "shop"
  /** Characters riding a vehicle. */
  | "aboard"
  /** A vehicle parked on the ground. */
  | "parked";

/** One kind of place, with how many and who or where holds them (the first few). */
export interface ContentPlaceView {
  place: ContentPlaceKind;
  count: number;
  holders: string[];
  holderCount: number;
}

/** A reference in content to an item or a monster. */
export interface ContentUseView {
  row: ContentRowRef;
  where: string;
  name: string;
  /** A cleanup can remove it (else it is replaced or fixed by hand). */
  removable: boolean;
}

export interface ContentUsageView {
  kind: "item" | "monster" | "vehicle";
  key: string;
  name: string;
  retired: boolean;
  uses: ContentUseView[];
  world: ContentPlaceView[];
  /** How many different characters hold a copy (bag, gear or vault). */
  characters: number;
  /** A monster with an NPC file of its own. */
  npcFile: boolean;
  /** Its removal is waiting in the draft. */
  pending: boolean;
}

/** A removal in the draft and what publishing it will do. */
export interface ContentRemovalView {
  kind: "item" | "monster" | "vehicle";
  key: string;
  lines: string[];
  /** Places it is still used that the publish leaves (references, retired copies). */
  stillUsed: number;
  /** Places in the world that hold it now (bags, banks, the ground, live monsters, quests). */
  inWorld: number;
}

/** A change in the shared draft. */
export interface ContentDraftView extends ContentRowRef {
  op: "set" | "remove" | "revert";
  author: string;
  updatedAt: string;
  /** The row's revision, for a row a discard must name (as `ContentRowDetail.revision`). */
  revision?: string;
}

/** One value a Balance page row edits: where it sits in the row, and its limits (issue #19). */
export interface BalanceFieldView {
  /** The value's path inside the row (`["damage", "flat"]`). */
  path: string[];
  label: string;
  /**
   * How the page shows it: a count, frames (also shown in seconds), a `random(n)` roll, a multiple
   * of the caster's power, a chance of 1 in N, or a counter's target (a counter that starts at 1
   * and acts on reaching it, so every target − 1 frames), seconds of real time (also shown in
   * minutes, hours or days), or a pick from `choices` (`min` and `max` are then 0).
   */
  /** `passFrames`: frames counted down in both of a frame's actor passes, so twice a frame. */
  unit:
    | "count"
    | "frames"
    | "passFrames"
    | "random"
    | "power"
    | "oneIn"
    | "counter"
    | "seconds"
    | "choice";
  /** A `choice` field's values, each with the label the page shows for it. */
  choices?: { value: string; label: string }[];
  min: number;
  max: number;
  /** A line under the field. */
  help?: string;
  /**
   * The value may be absent: an empty field leaves it out. Fields sharing the path's parent are
   * filled or left empty together (an amount's three parts).
   */
  optional?: boolean;
}

/** One row of the `balance` dataset on the Balance page (issue #19). */
export interface BalanceRowView {
  part: string;
  key: string | null;
  label: string;
  fields: BalanceFieldView[];
  /** The engine's default. */
  engine: unknown;
  /** The installed packs' value, or null when no pack sets it (the engine's default plays). */
  pack: unknown;
  /** What plays now: the published value. */
  published: unknown;
  /** What the draft would publish. */
  draft: unknown;
  /** Published with an operator change. */
  edited: boolean;
  /** The draft's change to it, if any. */
  pending: "set" | "revert" | "remove" | null;
  /** The row as shown, for `contentBalanceSet`'s `expect`. */
  fingerprint: string;
  /** A pack update changed a row the operator had changed. */
  notice: { packName: string; packVersion: string; now: unknown } | null;
}

/** A card of the Balance page. */
export interface BalanceGroupView {
  id: string;
  title: string;
  /** A line under the title. */
  help: string;
  rows: BalanceRowView[];
  /**
   * Values of the same kind that live in another dataset (house rest, in `houses`): what plays now,
   * and the row the Content page opens to edit them.
   */
  elsewhere?: { label: string; row: ContentRowRef; now: string }[];
}

/** The Balance page's view. */
export interface ContentBalanceView {
  groups: BalanceGroupView[];
  /** Draft changes outside the balance dataset, published with it from the Content page. */
  otherDraft: number;
}

/** One item in the Items page's list (issue #30). */
export interface ItemListEntry {
  name: string;
  /** The name players see. */
  display: string;
  /** What it is, from what it plays now. */
  kind: "weapon" | "armour" | "food" | "other";
  /**
   * `pack`: the pack's item, unchanged; `edited`: a pack item with a definition or a catalogue
   * change of the operator's; `yours`: an item the operator added.
   */
  state: "pack" | "edited" | "yours";
  retired: boolean;
  /** The draft changes it. */
  pending: boolean;
}

/** Where one table of an item's rules comes from, as the Items page says it. */
export interface ItemRuleSource {
  /** The form's group (`equip`, `attack`, `armour`, `use`). */
  group: string;
  /** What the table is (`Slot`, `Attack roll`). */
  label: string;
  /** `your definition`, or the pack's rows that decide it (`contains "Sword" (row 12)`). */
  from: string;
}

/** The item open in the Items page's form (issue #30). */
export interface ContentItemView {
  name: string;
  /** The display name the draft gives it ("" for none). */
  display: string;
  retired: boolean;
  /** The installed packs have the item. */
  inPack: boolean;
  /**
   * What the form holds: the draft's definition, or (with none) what the item plays in the draft,
   * as a definition. Saved unchanged it plays identically.
   */
  form: ItemDefinition;
  /** The draft holds a definition for it (its own row). */
  defined: boolean;
  /** What the pack's own rules play for it (as a definition), or null for an item of yours. */
  pack: ItemDefinition | null;
  /** Each covered table's source in the draft. */
  sources: ItemRuleSource[];
  /** A definition of the operator's is published. */
  edited: boolean;
  /** The draft's change to its definition, and to its catalogue row. */
  pending: {
    definition: "set" | "revert" | "remove" | null;
    catalogue: "set" | "remove" | "revert" | null;
  };
  /** The item as shown, for `contentItemSet`'s `expect`. */
  fingerprint: string;
  /** A pack update changed the rules under its definition. */
  notice: { packName: string; packVersion: string; note: string } | null;
  /** The values the form's picks offer. */
  choices: {
    slots: string[];
    slotVars: string[];
    /** The slots armour can break in, and the one a weapon can. */
    breakArmourSlots: string[];
    breakWeaponSlots: string[];
    wornSlots: string[];
    behaviours: string[];
    powers: string[];
    stats: string[];
    skills: string[];
    /** Stage 4's picks: tool uses, swing ladders, menu buttons, paperdoll and ground layers. */
    toolCans: string[];
    ladders: string[];
    menus: string[];
    layers: string[];
    groundLayers: string[];
  };
}

/** One monster in the Monsters page's list (issue #31, stage 4). */
export interface MonsterListEntry {
  name: string;
  /** The name players see. */
  display: string;
  /** `pack`: the pack's, unchanged; `edited`: a pack monster the operator changed; `yours`: added. */
  state: "pack" | "edited" | "yours";
  /** The draft changes it. */
  pending: boolean;
  /** What it plays now, for the list's filters. */
  hostile: boolean;
  sea: boolean;
  casts: boolean;
  loot: boolean;
  /** On an editor's NPC list. */
  npc: boolean;
}

/** One monster's form on the Monsters page (issue #31, stage 4). */
export interface ContentMonsterView {
  name: string;
  /** The display name the draft gives it ("" for none). */
  display: string;
  /** The installed packs have the species. */
  inPack: boolean;
  /** The species record the draft holds (stats, flags, body). */
  record: Monster;
  /**
   * The draft's definition, or (with none) what the monster plays in the draft, as a definition.
   * Saved unchanged it plays identically.
   */
  form: MonsterDefinition;
  /** The draft holds a definition for it. */
  defined: boolean;
  /** What the pack plays for it (its record and its rules as a definition), or null for yours. */
  pack: { record: Monster | null; form: MonsterDefinition } | null;
  /** Where each rule comes from in the draft. */
  sources: ItemRuleSource[];
  /** A definition of the operator's is published. */
  edited: boolean;
  /** The draft's change to its definition, and to its species record. */
  pending: {
    definition: "set" | "revert" | "remove" | null;
    record: "set" | "remove" | "revert" | null;
  };
  /** The monster as shown, for `contentMonsterSet`'s `expect`. */
  fingerprint: string;
  /** A pack update changed the rules under its definition. */
  notice: { packName: string; packVersion: string; note: string } | null;
  /** The species is published (only a published monster's NPC file can be edited live). */
  published: boolean;
}

/** The Monsters page's view: the list, the open monster and the monster spells. */
export interface ContentMonstersView {
  monsters: MonsterListEntry[];
  monster: ContentMonsterView | null;
  /** The global monster spells (`casting.spells`) as the draft holds them. */
  spells: {
    rows: MonsterSpellRule[];
    /** For `contentMonsterSpells`' `expect`. */
    fingerprint: string;
    pending: boolean;
  };
  /** The values the form's picks offer. */
  choices: {
    /** Spell effects a monster can be healed by or resist. */
    effects: string[];
    /** Monster spell kinds. */
    kinds: string[];
    /** Spell effects a monster spell can draw (FX runs). */
    fx: string[];
    /** Item names, for loot and grabs. */
    items: string[];
  };
  /** Draft changes outside these monsters' rows. */
  otherDraft: number;
  monsterDraft: number;
}

/** The progression sources, by their place on the Skills page. */
export type SkillSource = "kill" | "shot" | "defend" | "cast" | "gather" | "craft" | "hit";

/** One skill in the Skills page's list (issue #38), in Skills page order. */
export interface SkillListEntry {
  skill: string;
  /** The name players see. */
  display: string;
  hidden: boolean;
  model: "chance" | "xp";
  /** `pack`: the pack's, unchanged; `edited`: a pack skill the operator changed; `yours`: added. */
  state: "pack" | "edited" | "yours";
  /** The draft changes it. */
  pending: boolean;
}

/** Something that trains or reads a skill, as the Skills page lists it (read-only). */
export interface SkillTrainer {
  /** What it is. */
  kind:
    | "weapon"
    | "item"
    | "node"
    | "fishing"
    | "watering"
    | "recipe"
    | "spell"
    | "book"
    | "promotion"
    | "binding"
    | "other";
  /** What the page says. */
  text: string;
  /** Where it is set: a Control Panel page, and what to open there. */
  page: "items" | "gathering" | "content";
  /** The item to open on the Items page. */
  item?: string;
  /** The harvest node to open on the Gathering page. */
  node?: number;
  /** The row to open on the Content page. */
  row?: ContentRowRef;
}

/** One skill's form on the Skills page (issue #38). */
export interface ContentSkillView {
  skill: string;
  /** The skill row as the draft holds it. */
  row: Skill;
  /** Its place on the Skills page, from 1. */
  order: number;
  /** The installed packs have it. */
  inPack: boolean;
  /** It is published (a skill only the draft has is removed by discarding it). */
  published: boolean;
  /** Each start class's starting value for it (null: not set, so 1). */
  starts: { code: number; label: string; value: number | null }[];
  /** The promotions, and whether each grants it. */
  promotions: { code: number; name: string; grants: boolean }[];
  /** Its `xp` curve as the draft holds it, and the other skills that use the same curve. */
  curve: { name: string; curve: Curve; sharedWith: string[] } | null;
  /** What trains it or reads it, each linking where it is set. */
  trains: SkillTrainer[];
  /** The bindings that name it (it cannot be removed while one does). */
  bindings: string[];
  /** The draft changes it. */
  pending: boolean;
  /** The skill as shown, for `contentSkillSet`'s and `contentSkillRemove`'s `expect`. */
  fingerprint: string;
  /** A pack update changed it under the operator's change. */
  notice: { packName: string; packVersion: string; note: string } | null;
  /**
   * What the pack plays for its form (as a save would send it), or null for a skill of the
   * operator's own: "Restore the original" and each tab's restore read it.
   */
  pack?: {
    display: string;
    hidden: boolean;
    progression: SkillProgression | null;
    order: number;
    starts: Record<string, number | null>;
    grants: number[];
    curve: { name: string; curve: Curve } | null;
  } | null;
  /** Its form differs from the pack's (the draft's, so unpublished changes count). */
  differs?: boolean;
}

/** The Skills page's view: the list, the open skill, and what the previews read. */
export interface ContentSkillsView {
  skills: SkillListEntry[];
  skill: ContentSkillView | null;
  /** The draft's progression: its line, stat tables, curves and world defaults. */
  progression: ProgressionData;
  /** Every skill's key, for picks (a requirement, a replacement). */
  keys: string[];
  /** Each curve's revision, for a save's `curve.expect`. */
  curveFingerprints: Record<string, string>;
  /** What a `faction` and a `mage` cap are for an unaffiliated character (the perk defaults). */
  caps: { faction: number; mage: number };
  /** Draft changes outside the skills' rows, and inside them. */
  otherDraft: number;
  skillDraft: number;
}

/** One reference to a skill, for its removal (issue #38). */
export interface SkillUseView {
  /** The reference's id, which `contentSkillRemove`'s `refs` names. */
  id: string;
  /** Where it is, as the page says it. */
  where: string;
  /** Clearing it is possible (otherwise it can only be pointed at another skill). */
  clearable: boolean;
  /** What clearing does. */
  clears: string;
}

/** Where a skill is used, for its removal (issue #38). */
export interface ContentSkillUsage {
  skill: string;
  display: string;
  uses: SkillUseView[];
  /** The characters with a value of it stored (kept, and restored if it returns). */
  characters: number;
  /** The bindings that name it: it cannot be removed until each points elsewhere. */
  bindings: string[];
  /** The skill as the usage was built, for `contentSkillRemove`'s `expect`. */
  fingerprint: string;
}

/** A skill's progression as the Gathering page's preview reads it. */
export interface GatheringSkill {
  skill: string;
  display: string;
  model: "chance" | "xp";
  /** Its `gather` settings, its own over the world's default; null when gathering never trains it. */
  gather: ChanceSettings | XpSettings | null;
  /** An `xp` skill's curve and cap. */
  curve: Curve | null;
  cap: number | "faction" | "mage" | null;
}

/** One harvest node on the Gathering page (issue #38). */
export interface GatheringNodeView {
  index: number;
  node: HarvestNode;
  /** The yield table it rolls (null: none), and the other nodes rolling the same table. */
  yield: YieldTable | null;
  yieldSharedWith: number[];
  /** The regrowth check that turns its spent tile back (by handler), or null. */
  regrows: string | null;
  /** The node as shown, for `contentGatheringSet`'s `expect`. */
  fingerprint: string;
  /**
   * The pack's node for the same tile (its fields, yield table and regrowth), or null for a node
   * of the operator's own: "Restore the original" and each tab's restore read it.
   */
  pack?: { node: HarvestNode; yield: YieldTable | null; regrows: string | null } | null;
  /** It plays something other than the pack's node (in the draft). */
  differs?: boolean;
}

/** The Gathering page's view (issue #38). */
export interface ContentGatheringView {
  nodes: GatheringNodeView[];
  /** The hits a tool takes per success, by the skill (`gathering.counterTable`). */
  counter: {
    rows: { gt: number; value: number }[];
    fingerprint: string;
    /** The pack's rows, and whether the draft's differ. */
    pack?: { gt: number; value: number }[];
    differs?: boolean;
  };
  /** Fishing (null: the world has none). */
  fishing: {
    data: NonNullable<GatherData["gathering"]["fishing"]> | null;
    fingerprint: string;
    skill: string | null;
    /** The pack's fishing (null: none), and whether the draft's differs. */
    pack?: NonNullable<GatherData["gathering"]["fishing"]> | null;
    differs?: boolean;
  };
  /** Farming (null: the world has none). */
  farming: {
    data: NonNullable<GatherData["gathering"]["farming"]> | null;
    fingerprint: string;
    /** The pack's farming (null: none), and whether the draft's differs. */
    pack?: NonNullable<GatherData["gathering"]["farming"]> | null;
    differs?: boolean;
  };
  /** The regrowth checks: their handlers and how often each runs. */
  /**
   * The regrowth checks: their handlers, how often each runs, and whether it drops farming produce
   * (a node's tile never regrows by one).
   */
  regrowth: {
    roll: number;
    tiles: number;
    checks: { handler: string; below: number; produce: boolean }[];
  };
  /** An ore strike's find chance (`gathering.mining.findChance`), when the world mines. */
  findChance: number | null;
  /** The tool rows that gather, with their tiers. */
  tools: { pattern: string; match: "exact" | "contains"; can: string; tier: number }[];
  /** Every yield table by name, used or not. */
  yields: Record<string, YieldTable>;
  /** Each yield table's revision, for a node save's `yieldExpect`. */
  yieldFingerprints: Record<string, string>;
  /** Every skill's gathering progression, for the preview. */
  skills: GatheringSkill[];
  /** The draft's stat tables, for formulas. */
  tables: Record<string, StatTable>;
  /** What a `faction` and a `mage` cap are for an unaffiliated character. */
  caps: { faction: number; mage: number };
  /** The values the form's picks offer. */
  choices: {
    cans: string[];
    sounds: string[];
    tiles: { code: string; name: string }[];
    items: string[];
    yields: string[];
  };
  /** Draft changes to gathering, and elsewhere. */
  pending: boolean;
  otherDraft: number;
  /** Every gathering row as shown, for `discard`'s `expect`. */
  fingerprint: string;
}

/** One name on the NPCs page's list (issue #32). */
export interface NpcListEntry {
  name: string;
  /** It has an NPC file (an empty one counts). */
  file: boolean;
  /** On an editor's NPC list. */
  npc: boolean;
  /** A monster species of that name exists. */
  species: boolean;
  /** Its file sells or buys, banks, trains, or drops loot. */
  shop: boolean;
  banker: boolean;
  trainer: boolean;
  loot: boolean;
}

/** The NPC file open on the NPCs page (issue #32). */
export interface ContentNpcView {
  name: string;
  exists: boolean;
  /** The file's revision, null with no file: what a save names as `expect`. */
  revision: string | null;
  /** The file as LOAD shows it: live shop stock and gold written in. */
  text: string;
  /** A monster species of that name exists (the Monsters page edits its stats). */
  species: boolean;
}

/** The NPCs page's view (issue #32). */
export interface ContentNpcsView {
  npcs: NpcListEntry[];
  npc: ContentNpcView | null;
  choices: {
    /** Item names, for shop lines and loot. */
    items: string[];
    /** The classes a trainer can promote to. */
    classes: string[];
    /** Monster spell tags. */
    spellTags: string[];
  };
}

/** A monster's NPC file as the Monsters page edits it (issue #31, stage 3). */
export interface ContentNpcFileView {
  /** The file's name (the store's spelling), or the monster's when it has no file yet. */
  name: string;
  /** Whether it has a file (an empty one counts). */
  exists: boolean;
  /** The file's revision, null with no file: what a save names as `expect`. */
  revision: string | null;
  loot: { item: string; oneIn: number }[];
  spells: string[];
  flags: string[];
  /** Lines (1-based) read as two sections at once, which the page cannot edit apart. */
  mixed: number[];
  /** Lines in the file, and the most a file may hold. */
  lines: number;
  maxLines: number;
  /** The monster spell tags a `spells` entry may name. */
  spellTags: string[];
}

/** The Items page's view: the list, and the open item. */
export interface ContentItemsView {
  items: ItemListEntry[];
  item: ContentItemView | null;
  /** Draft changes outside these items' rows, published with them from the Content page. */
  otherDraft: number;
  /** Draft changes to items' catalogue rows and definitions. */
  itemDraft: number;
  /** One item definition's shape as JSON Schema: the form draws its rarer parts from it. */
  definitionSchema?: unknown;
}

/** A problem a check found, and where. */
export interface ContentProblemView {
  where: string;
  message: string;
}

/** One publish in the history. */
export interface ContentPublishView {
  id: string;
  at: string;
  actorName: string;
  summary: string;
  /** The rows it changed (`items/items/Ale`). */
  rows: string[];
  undoOf: string | null;
  undoneBy: string | null;
  /** What it did to the world (purged copies, cleared spawns), a line each; an undo leaves it. */
  cleanup: string[];
  /** How many players it logged out while publishing (issue #40); null when it did not. */
  loggedOut: number | null;
}

/** An installed pack. */
export interface ContentPackView {
  id: string;
  name: string;
  version: string;
  source: "release" | "imported";
  /** The version this start replaced, when a release brought a newer one. */
  updatedFrom: string | null;
}

/** A row a newer pack version changed under an operator's change. */
export interface ContentNoticeView extends ContentRowRef {
  packName: string;
  packVersion: string;
  was: unknown;
  now: unknown;
  yours: unknown;
  yoursOp: "set" | "remove";
  /** What the notice means, when the row is not simply the pack's (an item definition, #30). */
  note?: string;
}

/** A dataset and its top-level fields, for browsing rows. */
export interface ContentDatasetView {
  id: string;
  readOnly: boolean;
  parts: { part: string; keyed: boolean; rows: number }[];
}

export interface ContentOverview {
  draft: ContentDraftView[];
  problems: ContentProblemView[];
  history: ContentPublishView[];
  packs: ContentPackView[];
  notices: ContentNoticeView[];
  datasets: ContentDatasetView[];
  /** The published store's hash. */
  hash: string;
  /** The draft's revision: Publish sends it back, and a draft changed since refuses it. */
  draftRev: string;
  /** The removals the draft holds and what publishing them does (issue #28). */
  removals: ContentRemovalView[];
}

/** A row's state: as the pack has it, changed or added by the operator, or removed. */
export type ContentRowStatus = "pack" | "changed" | "added" | "removed";

export interface ContentListing {
  dataset: string;
  part: string;
  keyField: string | null;
  /** One row's shape as JSON Schema (as `ContentRowDetail.schema`), for a new entry's form. */
  schema?: unknown;
  rows: { key: string | null; status: ContentRowStatus; draft: ContentDraftView["op"] | null }[];
}

export interface ContentRowDetail extends ContentRowRef {
  keyField: string | null;
  readOnly: boolean;
  status: ContentRowStatus | null;
  /** The pack's version (null when an operator added it). */
  pack: unknown;
  /** The live version (null when removed or not yet published). */
  published: unknown;
  /** The draft's change, if any. */
  draft: { op: ContentDraftView["op"]; data: unknown; author: string } | null;
  /** Something the admin should know before editing (an NPC Editor save that plays instead). */
  note?: string;
  /**
   * The row's shape as JSON Schema (an entry of a keyed list, or the whole section): the Control
   * Panel draws its form from it.
   */
  schema?: unknown;
  /**
   * The row's revision, for a row a change must name (a balance row, the Balance page's
   * fingerprint): a save or discard sends it back, and is refused once the row has changed.
   */
  revision?: string;
}

export type ContentServerMsg =
  /**
   * The published store changed (an operator published or undid a publish): fetch
   * `/content/<hash>.json` and install it. Sent to every player in game.
   */
  | {
      t: "content";
      hash: string;
      /**
       * The asset index's hash (issue #29): when it differs from the one loaded, fetch
       * `/assets/index.json` again and load the sheets and sounds that changed.
       */
      assets?: string;
    }
  /** An upload ticket, and the largest file the server takes. */
  | { t: "contentUploadTicket"; seq: number; ticket: string; maxBytes: number }
  /** The Packs page's view, after an ask or with an apply's or removal's answer (issue #34). */
  | {
      t: "contentPacks";
      seq: number;
      view: ContentPacksView;
      result?: { ok: boolean; text: string };
    }
  /** The item picture picker's view. */
  | { t: "contentItemArt"; seq: number; view: ContentItemArtView }
  /** The worn frame set panels' view. */
  | { t: "contentWornArt"; seq: number; view: ContentWornArtView }
  /** A sheet cut into frames (blank cells left out), or why it could not be. */
  | {
      t: "contentWornSheet";
      seq: number;
      frames: Partial<Record<ArtFrameId, string>> | null;
      error?: string;
    }
  /** The body panels' view. */
  | { t: "contentBodyArt"; seq: number; view: ContentBodyArtView }
  /** A body sheet cut into its 16 frames and its cell size, or why it could not be. */
  | {
      t: "contentBodySheet";
      seq: number;
      frames: Partial<Record<ArtFrameId, string>> | null;
      cell?: { w: number; h: number };
      error?: string;
    }
  /** The effect panels' view. */
  | { t: "contentFxArt"; seq: number; view: ContentFxArtView }
  /** A strip cut into its run's and trail's frames, or why it could not be. */
  | {
      t: "contentFxSheet";
      seq: number;
      frames: string[] | null;
      trail?: string[];
      cell?: { w: number; h: number };
      error?: string;
    }
  /** The tile panels' view. */
  | { t: "contentTileArt"; seq: number; view: ContentTileArtView }
  /** The sound panels' view. */
  | { t: "contentSoundArt"; seq: number; view: ContentSoundArtView }
  /**
   * The Balance page's view, after a `contentBalance` ask or with a `contentBalanceSet`'s answer
   * (`result`).
   */
  | {
      t: "contentBalance";
      seq: number;
      view: ContentBalanceView;
      result?: { ok: boolean; text: string; problems?: ContentProblemView[] };
    }
  /** The Items page's view, after a `contentItems` ask or with a `contentItemSet`'s answer. */
  | {
      t: "contentItems";
      seq: number;
      view: ContentItemsView;
      result?: { ok: boolean; text: string; problems?: ContentProblemView[] };
    }
  /** The NPCs page's view, after a `contentNpcs` ask or with a `contentNpcSave`'s answer. */
  | {
      t: "contentNpcs";
      seq: number;
      view: ContentNpcsView;
      result?: { ok: boolean; text: string };
    }
  /** The Monsters page's view, after a `contentMonsters` ask or with a change's answer. */
  | {
      t: "contentMonsters";
      seq: number;
      view: ContentMonstersView;
      result?: { ok: boolean; text: string; problems?: ContentProblemView[] };
    }
  /** The Skills page's view, after a `contentSkills` ask or with a change's answer (issue #38). */
  | {
      t: "contentSkills";
      seq: number;
      view: ContentSkillsView;
      result?: { ok: boolean; text: string; problems?: ContentProblemView[] };
    }
  /** Where a skill is used, or why it cannot be said. */
  | { t: "contentSkillUsage"; seq: number; usage: ContentSkillUsage | null; error?: string }
  /** The Gathering page's view, after a `contentGathering` ask or with a change's answer. */
  | {
      t: "contentGathering";
      seq: number;
      view: ContentGatheringView;
      result?: { ok: boolean; text: string; problems?: ContentProblemView[] };
    }
  /**
   * A monster's NPC file sections, after a `contentNpcFile` ask or with a `contentNpcFileSet`'s
   * answer; `view` is null when the name is neither a monster nor a file.
   */
  | {
      t: "contentNpcFile";
      seq: number;
      view: ContentNpcFileView | null;
      error?: string;
      result?: { ok: boolean; text: string };
    }
  /** A tileset cut into tiles (cells showing nothing left out), or why it could not be. */
  | {
      t: "contentTileSheet";
      seq: number;
      cells: { col: number; row: number; file: string }[] | null;
      grid?: { cols: number; rows: number };
      error?: string;
    }
  | { t: "contentOverview"; seq: number; overview: ContentOverview }
  | { t: "contentList"; seq: number; listing: ContentListing | null; error?: string }
  | { t: "contentRow"; seq: number; row: ContentRowDetail | null; error?: string }
  | { t: "contentUsage"; seq: number; usage: ContentUsageView | null; error?: string }
  | {
      t: "contentProblems";
      seq: number;
      content: ContentProblemView[];
      world: ContentProblemView[];
    }
  /** A draft, discard, publish, undo, notice or removal answer. */
  | {
      t: "contentResult";
      seq: number;
      ok: boolean;
      text: string;
      problems?: ContentProblemView[];
      /** The body a `contentBody` change drew on (a new body's number, picked by the server). */
      body?: number;
      /** The run a `contentFx` change drew on, as the draft spells it. */
      run?: string;
      /** The tiles a `contentTile` change drew on (new tiles' codes, given by the server). */
      codes?: string[];
      /** The sound a `contentSound` change wrote, as the draft spells it. */
      sound?: string;
    };
