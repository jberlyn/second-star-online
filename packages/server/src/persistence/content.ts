/**
 * The content store's tables (issue #27): installed packs, the operator layer, the shared draft
 * and the publish log. Plain functions taking the `Db` first; callers own transactions.
 */
import type { DatasetId } from "@secondstaronline/shared";

import { rowHash } from "../content/rows.ts";
import type { Db } from "./database.ts";

/** An installed pack, in load order. */
export interface InstalledPack {
  id: string;
  name: string;
  /** The version the server last loaded; null until the first start after the migration. */
  version: string | null;
  position: number;
  source: "release" | "imported";
  /** An imported pack's manifest and data, as JSON; null for a pack shipped in the release. */
  data: string | null;
  installedAt: string;
}

export function installedPacks(db: Db): InstalledPack[] {
  return db
    .query<
      {
        id: string;
        name: string;
        version: string | null;
        position: number;
        source: "release" | "imported";
        data: string | null;
        installed_at: string;
      },
      []
    >(
      "SELECT id, name, version, position, source, data, installed_at FROM content_packs ORDER BY position, id",
    )
    .all()
    .map((r) => ({
      id: r.id,
      name: r.name,
      version: r.version,
      position: r.position,
      source: r.source,
      data: r.data,
      installedAt: r.installed_at,
    }));
}

/** Records the version of an installed pack the server loaded. */
export function setPackVersion(db: Db, id: string, name: string, version: string): void {
  db.query("UPDATE content_packs SET version = ?, name = ? WHERE id = ?").run(version, name, id);
}

/** Records a newly installed pack after the others. */
export function insertPack(
  db: Db,
  p: {
    id: string;
    name: string;
    version: string;
    source: "release" | "imported";
    data: string | null;
  },
  now: string,
): void {
  const next =
    db.query<{ n: number | null }, []>("SELECT MAX(position) AS n FROM content_packs").get()?.n ??
    -1;
  db.query(
    "INSERT INTO content_packs (id, name, version, position, source, data, installed_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(p.id, p.name, p.version, next + 1, p.source, p.data, now);
}

/** Replaces an imported pack's data (an update, issue #34); its recorded version stays until start. */
export function setImportedPackData(db: Db, id: string, data: string): void {
  db.query("UPDATE content_packs SET data = ? WHERE id = ? AND source = 'imported'").run(data, id);
}

/** Removes an imported pack (it leaves at the next start). */
export function deleteImportedPack(db: Db, id: string): void {
  db.query("DELETE FROM content_packs WHERE id = ? AND source = 'imported'").run(id);
}

/** One operator-layer row: a change to a pack row, an added row, or a removal marker. */
export interface StoredContentRow {
  dataset: DatasetId;
  part: string;
  /** The entry's key in a keyed list, or null for a whole field. */
  key: string | null;
  op: "set" | "remove";
  data: unknown;
  /** The pack row it was based on; null for an added row. */
  baseHash: string | null;
  baseData: unknown;
  seq: number;
  updatedBy: string;
  updatedAt: string;
}

interface ContentRowRecord {
  dataset: string;
  part: string;
  row_key: string;
  op: "set" | "remove";
  data: string | null;
  base_hash: string | null;
  base_data: string | null;
  seq: number;
  updated_by: string;
  updated_at: string;
}

const parse = (s: string | null): unknown => (s === null ? null : JSON.parse(s));

/**
 * A row's base hash. A row a migration made records the pack row it was based on but no hash (SQL
 * cannot work one out), so it is worked out from that row here.
 */
const baseHashOf = (hash: string | null, data: unknown): string | null =>
  hash ?? (data === null || data === undefined ? null : rowHash(data));

const withBaseHash = (s: PublishedState | null): PublishedState | null =>
  s === null ? null : { ...s, baseHash: baseHashOf(s.baseHash ?? null, s.baseData) };

const toContentRow = (r: ContentRowRecord): StoredContentRow => ({
  dataset: r.dataset as DatasetId,
  part: r.part,
  key: r.row_key === "" ? null : r.row_key,
  op: r.op,
  data: parse(r.data),
  baseHash: baseHashOf(r.base_hash, parse(r.base_data)),
  baseData: parse(r.base_data),
  seq: r.seq,
  updatedBy: r.updated_by,
  updatedAt: r.updated_at,
});

/** The operator layer, in the order its rows were first made. */
export function contentRows(db: Db): StoredContentRow[] {
  return db
    .query<ContentRowRecord, []>(
      "SELECT dataset, part, row_key, op, data, base_hash, base_data, seq, updated_by, updated_at FROM content_rows ORDER BY seq, dataset, part, row_key",
    )
    .all()
    .map(toContentRow);
}

const keyOf = (key: string | null): string => key ?? "";

/**
 * The stored keys in `table` for a dataset part that match `key` ignoring case as the content
 * store does (JavaScript's `toLowerCase`, which folds every letter, not only SQLite's A-Z), so
 * `Écho` and `écho` are one row everywhere (issue #29).
 */
function sameKeys(
  db: Db,
  table: "content_rows" | "content_draft",
  dataset: string,
  part: string,
  key: string | null,
): string[] {
  const want = keyOf(key).toLowerCase();
  return db
    .query<{ row_key: string }, [string, string]>(
      `SELECT row_key FROM ${table} WHERE dataset = ? AND part = ?`,
    )
    .all(dataset, part)
    .map((r) => r.row_key)
    .filter((k) => k.toLowerCase() === want);
}

/** Deletes the rows `sameKeys` finds. */
function deleteSameKeys(
  db: Db,
  table: "content_rows" | "content_draft",
  dataset: string,
  part: string,
  key: string | null,
): void {
  for (const k of sameKeys(db, table, dataset, part, key)) {
    db.query(`DELETE FROM ${table} WHERE dataset = ? AND part = ? AND row_key = ?`).run(
      dataset,
      part,
      k,
    );
  }
}

/**
 * Writes an operator row, keeping its place (`seq`) when it already exists. Keys compare ignoring
 * case, so a row is found whatever case it was written in.
 */
export function upsertContentRow(db: Db, r: Omit<StoredContentRow, "seq">): void {
  const keys = sameKeys(db, "content_rows", r.dataset, r.part, r.key);
  const existing =
    keys.length === 0
      ? null
      : db
          .query<{ seq: number }, [string, string, string]>(
            "SELECT seq FROM content_rows WHERE dataset = ? AND part = ? AND row_key = ?",
          )
          .get(r.dataset, r.part, keys[0] as string);
  const seq =
    existing?.seq ??
    (db.query<{ n: number | null }, []>("SELECT MAX(seq) AS n FROM content_rows").get()?.n ?? 0) +
      1;
  deleteSameKeys(db, "content_rows", r.dataset, r.part, r.key);
  db.query(
    `INSERT INTO content_rows (dataset, part, row_key, op, data, base_hash, base_data, seq, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    r.dataset,
    r.part,
    keyOf(r.key),
    r.op,
    r.data === null || r.data === undefined ? null : JSON.stringify(r.data),
    r.baseHash,
    r.baseData === null || r.baseData === undefined ? null : JSON.stringify(r.baseData),
    seq,
    r.updatedBy,
    r.updatedAt,
  );
}

/** Drops an operator row, so the pack row shows again. */
export function deleteContentRow(db: Db, dataset: string, part: string, key: string | null): void {
  deleteSameKeys(db, "content_rows", dataset, part, key);
}

/** One pending change in the shared draft. `revert` drops the operator row. */
export interface DraftRow {
  dataset: DatasetId;
  part: string;
  key: string | null;
  op: "set" | "remove" | "revert";
  data: unknown;
  authorAccountId: string;
  author: string;
  updatedAt: string;
}

interface DraftRecord {
  dataset: string;
  part: string;
  row_key: string;
  op: "set" | "remove" | "revert";
  data: string | null;
  author_account_id: string;
  author: string;
  updated_at: string;
}

/** The shared draft, oldest change first. */
export function draftRows(db: Db): DraftRow[] {
  return db
    .query<DraftRecord, []>(
      "SELECT dataset, part, row_key, op, data, author_account_id, author, updated_at FROM content_draft ORDER BY updated_at, dataset, part, row_key",
    )
    .all()
    .map((r) => ({
      dataset: r.dataset as DatasetId,
      part: r.part,
      key: r.row_key === "" ? null : r.row_key,
      op: r.op,
      data: parse(r.data),
      authorAccountId: r.author_account_id,
      author: r.author,
      updatedAt: r.updated_at,
    }));
}

export function upsertDraftRow(db: Db, r: DraftRow): void {
  deleteSameKeys(db, "content_draft", r.dataset, r.part, r.key);
  db.query(
    `INSERT INTO content_draft (dataset, part, row_key, op, data, author_account_id, author, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    r.dataset,
    r.part,
    keyOf(r.key),
    r.op,
    r.data === null || r.data === undefined ? null : JSON.stringify(r.data),
    r.authorAccountId,
    r.author,
    r.updatedAt,
  );
}

export function deleteDraftRow(db: Db, dataset: string, part: string, key: string | null): void {
  deleteSameKeys(db, "content_draft", dataset, part, key);
}

export function clearDraft(db: Db): void {
  db.query("DELETE FROM content_draft").run();
}

/** One row's operator-layer state before and after a publish (null: no operator row). */
export interface PublishChange {
  dataset: DatasetId;
  part: string;
  key: string | null;
  before: PublishedState | null;
  after: PublishedState | null;
}

/** An operator row as a publish recorded it. */
export interface PublishedState {
  op: "set" | "remove";
  data: unknown;
  baseHash: string | null;
  baseData: unknown;
}

export interface StoredPublish {
  id: string;
  at: string;
  actorName: string;
  summary: string;
  changes: PublishChange[];
  hash: string;
  undoOf: string | null;
  undoneBy: string | null;
  /** What the publish did to the world (issue #28): a line per thing done; empty for none. */
  cleanup: string[];
  /** How many players it logged out (issue #40); null for a publish that did not. */
  loggedOut: number | null;
}

interface PublishRecord {
  id: string;
  created_at: string;
  actor_name: string;
  summary: string;
  changes: string;
  hash: string;
  undo_of: string | null;
  undone_by: string | null;
  cleanup: string | null;
}

const toPublish = (r: PublishRecord): StoredPublish => ({
  id: r.id,
  at: r.created_at,
  actorName: r.actor_name,
  summary: r.summary,
  changes: (JSON.parse(r.changes) as PublishChange[]).map((c) => ({
    ...c,
    before: withBaseHash(c.before),
    after: withBaseHash(c.after),
  })),
  hash: r.hash,
  undoOf: r.undo_of,
  undoneBy: r.undone_by,
  cleanup: r.cleanup ? ((JSON.parse(r.cleanup) as { lines?: string[] }).lines ?? []) : [],
  loggedOut: r.cleanup
    ? ((JSON.parse(r.cleanup) as { loggedOut?: number }).loggedOut ?? null)
    : null,
});

/** Logs a publish and returns its id. An undo also marks the publish it undid. */
export function insertPublish(
  db: Db,
  p: {
    actorAccountId: string;
    actorName: string;
    summary: string;
    changes: readonly PublishChange[];
    hash: string;
    undoOf: string | null;
  },
  now: string,
): string {
  const id = Bun.randomUUIDv7();
  db.query(
    `INSERT INTO content_publishes (id, created_at, actor_account_id, actor_name, summary, changes, hash, undo_of)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    now,
    p.actorAccountId,
    p.actorName,
    p.summary,
    JSON.stringify(p.changes),
    p.hash,
    p.undoOf,
  );
  if (p.undoOf) {
    db.query("UPDATE content_publishes SET undone_by = ? WHERE id = ?").run(id, p.undoOf);
  }
  return id;
}

/** The newest publishes, newest first. */
export function recentPublishes(db: Db, limit: number): StoredPublish[] {
  return db
    .query<PublishRecord, [number]>(
      "SELECT id, created_at, actor_name, summary, changes, hash, undo_of, undone_by, cleanup FROM content_publishes ORDER BY id DESC LIMIT ?",
    )
    .all(limit)
    .map(toPublish);
}

/** Every publish made after this one (ids are UUIDv7, so they sort in the order made). */
export function publishesAfter(db: Db, id: string): StoredPublish[] {
  return db
    .query<PublishRecord, [string]>(
      "SELECT id, created_at, actor_name, summary, changes, hash, undo_of, undone_by, cleanup FROM content_publishes WHERE id > ? ORDER BY id",
    )
    .all(id)
    .map(toPublish);
}

export function publishById(db: Db, id: string): StoredPublish | null {
  const r = db
    .query<PublishRecord, [string]>(
      "SELECT id, created_at, actor_name, summary, changes, hash, undo_of, undone_by, cleanup FROM content_publishes WHERE id = ?",
    )
    .get(id);
  return r ? toPublish(r) : null;
}

/** Records what a publish did to the world, and how many players it logged out (issue #40). */
export function setPublishCleanup(
  db: Db,
  id: string,
  cleanup: { actions: readonly unknown[]; lines: readonly string[]; loggedOut?: number },
): void {
  db.query("UPDATE content_publishes SET cleanup = ? WHERE id = ?").run(
    JSON.stringify(cleanup),
    id,
  );
}

/** A removed entry's world cleanup, waiting in the draft. */
export interface DraftAction {
  kind: "item" | "monster" | "vehicle" | "class";
  key: string;
  action: unknown;
  authorAccountId: string;
  author: string;
  updatedAt: string;
}

export function draftActions(db: Db): DraftAction[] {
  return db
    .query<
      {
        kind: "item" | "monster" | "vehicle" | "class";
        entry_key: string;
        action: string;
        author_account_id: string;
        author: string;
        updated_at: string;
      },
      []
    >(
      "SELECT kind, entry_key, action, author_account_id, author, updated_at FROM content_draft_actions ORDER BY updated_at, entry_key",
    )
    .all()
    .map((r) => ({
      kind: r.kind,
      key: r.entry_key,
      action: JSON.parse(r.action) as unknown,
      authorAccountId: r.author_account_id,
      author: r.author,
      updatedAt: r.updated_at,
    }));
}

/** Deletes a kind's draft actions whose key matches `key` ignoring case as JavaScript folds it. */
function deleteSameActions(db: Db, kind: string, key: string): void {
  const want = key.toLowerCase();
  for (const r of db
    .query<{ entry_key: string }, [string]>(
      "SELECT entry_key FROM content_draft_actions WHERE kind = ?",
    )
    .all(kind)) {
    if (r.entry_key.toLowerCase() === want) {
      db.query("DELETE FROM content_draft_actions WHERE kind = ? AND entry_key = ?").run(
        kind,
        r.entry_key,
      );
    }
  }
}

export function upsertDraftAction(db: Db, a: DraftAction): void {
  deleteSameActions(db, a.kind, a.key);
  db.query(
    `INSERT INTO content_draft_actions (kind, entry_key, action, author_account_id, author, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(a.kind, a.key, JSON.stringify(a.action), a.authorAccountId, a.author, a.updatedAt);
}

export function deleteDraftAction(db: Db, kind: string, key: string): void {
  deleteSameActions(db, kind, key);
}

export function clearDraftActions(db: Db): void {
  db.query("DELETE FROM content_draft_actions").run();
}
