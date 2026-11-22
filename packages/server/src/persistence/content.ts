/**
 * The content store's tables (issue #27): installed packs, the operator layer, the shared draft
 * and the publish log. Plain functions taking the `Db` first; callers own transactions.
 */
import type { DatasetId } from "@secondstaronline/shared";

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

const toContentRow = (r: ContentRowRecord): StoredContentRow => ({
  dataset: r.dataset as DatasetId,
  part: r.part,
  key: r.row_key === "" ? null : r.row_key,
  op: r.op,
  data: parse(r.data),
  baseHash: r.base_hash,
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
 * Writes an operator row, keeping its place (`seq`) when it already exists. Keys compare ignoring
 * case, so a row is found whatever case it was written in.
 */
export function upsertContentRow(db: Db, r: Omit<StoredContentRow, "seq">): void {
  const existing = db
    .query<{ seq: number; row_key: string }, [string, string, string]>(
      "SELECT seq, row_key FROM content_rows WHERE dataset = ? AND part = ? AND lower(row_key) = lower(?)",
    )
    .get(r.dataset, r.part, keyOf(r.key));
  const seq =
    existing?.seq ??
    (db.query<{ n: number | null }, []>("SELECT MAX(seq) AS n FROM content_rows").get()?.n ?? 0) +
      1;
  if (existing) {
    db.query("DELETE FROM content_rows WHERE dataset = ? AND part = ? AND row_key = ?").run(
      r.dataset,
      r.part,
      existing.row_key,
    );
  }
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
  db.query(
    "DELETE FROM content_rows WHERE dataset = ? AND part = ? AND lower(row_key) = lower(?)",
  ).run(dataset, part, keyOf(key));
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
  db.query(
    "DELETE FROM content_draft WHERE dataset = ? AND part = ? AND lower(row_key) = lower(?)",
  ).run(r.dataset, r.part, keyOf(r.key));
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
  db.query(
    "DELETE FROM content_draft WHERE dataset = ? AND part = ? AND lower(row_key) = lower(?)",
  ).run(dataset, part, keyOf(key));
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
  changes: JSON.parse(r.changes) as PublishChange[],
  hash: r.hash,
  undoOf: r.undo_of,
  undoneBy: r.undone_by,
  cleanup: r.cleanup ? ((JSON.parse(r.cleanup) as { lines?: string[] }).lines ?? []) : [],
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

/** Records what a publish did to the world. */
export function setPublishCleanup(
  db: Db,
  id: string,
  cleanup: { actions: readonly unknown[]; lines: readonly string[] },
): void {
  db.query("UPDATE content_publishes SET cleanup = ? WHERE id = ?").run(
    JSON.stringify(cleanup),
    id,
  );
}

/** A removed entry's world cleanup, waiting in the draft. */
export interface DraftAction {
  kind: "item" | "monster";
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
        kind: "item" | "monster";
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

export function upsertDraftAction(db: Db, a: DraftAction): void {
  db.query("DELETE FROM content_draft_actions WHERE kind = ? AND lower(entry_key) = lower(?)").run(
    a.kind,
    a.key,
  );
  db.query(
    `INSERT INTO content_draft_actions (kind, entry_key, action, author_account_id, author, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(a.kind, a.key, JSON.stringify(a.action), a.authorAccountId, a.author, a.updatedAt);
}

export function deleteDraftAction(db: Db, kind: string, key: string): void {
  db.query("DELETE FROM content_draft_actions WHERE kind = ? AND lower(entry_key) = lower(?)").run(
    kind,
    key,
  );
}

export function clearDraftActions(db: Db): void {
  db.query("DELETE FROM content_draft_actions").run();
}

/** A skill's index as characters are saved with it. */
export interface SavedSkill {
  skill: string;
  index: number;
}

/** Every skill that has been live, by the index characters are saved with. */
export function savedSkills(db: Db): SavedSkill[] {
  return db
    .query<{ skill: string; idx: number }, []>("SELECT skill, idx FROM content_skills ORDER BY idx")
    .all()
    .map((r) => ({ skill: r.skill, index: r.idx }));
}

/** Records skills as live (a skill already recorded keeps its row). */
export function recordSkills(db: Db, skills: readonly SavedSkill[]): void {
  const q = db.query(
    "INSERT INTO content_skills (skill, idx) VALUES (?, ?) ON CONFLICT DO NOTHING",
  );
  for (const s of skills) {
    q.run(s.skill, s.index);
  }
}
