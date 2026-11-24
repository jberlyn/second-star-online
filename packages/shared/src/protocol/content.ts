/**
 * The content store's messages (issue #27): the Control Panel's Content page (the shared draft,
 * its checks, the publish history with undo, the installed packs and their notices, and a JSON
 * editor for one row), and the hash every client follows to fetch the store. The Content page's
 * intents are gated by the `contentEditor` permission.
 */
import { z } from "zod";

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
  | { t: "contentResult"; seq: number; ok: boolean; text: string; problems?: ContentProblemView[] };
