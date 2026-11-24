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
  ArtItem,
  ArtWorn,
  EquipSlot,
  Item,
  ItemRulesData,
} from "@secondstaronline/data";

import type { BodyUse } from "../content/bodies.ts";
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
});

/** Drops a change from the draft. */
export const contentDiscardSchema = z.strictObject({ t: z.literal("contentDiscard"), seq, ...ref });

/**
 * Publishes the draft as the admin last saw it (`draftRev`, the overview's revision), so a change
 * another admin made since refuses the publish.
 */
export const contentPublishSchema = z.strictObject({
  t: z.literal("contentPublish"),
  seq,
  summary: z.string().max(200),
  draftRev: z.string().regex(/^[0-9a-f]{16}$/),
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

/** An item or a monster (NPCs are monsters), by key, for where-used and removal (issue #28). */
const entry = {
  kind: z.enum(["item", "monster"]),
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
 * file goes with it or stays.
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
      ...bodyFrameSet,
    }),
    z.strictObject({ op: z.literal("remove"), body: bodyNumber }),
    z.strictObject({
      op: z.literal("choose"),
      monster: z.string().min(1).max(80),
      body: bodyNumber,
    }),
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
  | "shop";

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
  kind: "item" | "monster";
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
  kind: "item" | "monster";
  key: string;
  lines: string[];
  /** Places it is still used that the publish leaves (references, retired copies). */
  stillUsed: number;
}

/** A change in the shared draft. */
export interface ContentDraftView extends ContentRowRef {
  op: "set" | "remove" | "revert";
  author: string;
  updatedAt: string;
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
    };
