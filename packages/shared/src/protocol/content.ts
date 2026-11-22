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
  | { t: "content"; hash: string }
  | { t: "contentOverview"; seq: number; overview: ContentOverview }
  | { t: "contentList"; seq: number; listing: ContentListing | null; error?: string }
  | { t: "contentRow"; seq: number; row: ContentRowDetail | null; error?: string }
  /** A draft, discard, publish, undo or notice answer. */
  | { t: "contentResult"; seq: number; ok: boolean; text: string; problems?: ContentProblemView[] };
