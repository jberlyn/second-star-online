/**
 * The character editor's log (issue #26) and the writes an offline edit makes. Plain functions
 * taking the `Db` first; callers own transactions.
 */
import type { CharacterEditRow, EditChange } from "@secondstaronline/shared";

import type { Db } from "./database.ts";

interface EditRow {
  id: string;
  created_at: string;
  actor_name: string;
  reason: string;
  changes: string;
  override: number;
  undo_of: string | null;
  undone_by: string | null;
  character_id: string;
}

/** One logged edit, with the character it was made to. */
export interface StoredEdit extends CharacterEditRow {
  characterId: string;
}

const toRow = (r: EditRow): StoredEdit => ({
  id: r.id,
  at: r.created_at,
  actorName: r.actor_name,
  reason: r.reason,
  changes: JSON.parse(r.changes) as EditChange[],
  override: r.override === 1,
  undoOf: r.undo_of,
  undoneBy: r.undone_by,
  characterId: r.character_id,
});

const COLUMNS =
  "id, created_at, actor_name, reason, changes, override, undo_of, undone_by, character_id";

/** Logs one edit and returns its id. An undo also marks the edit it undid. */
export function insertCharacterEdit(
  db: Db,
  e: {
    actorAccountId: string;
    actorName: string;
    characterId: string;
    character: string;
    reason: string;
    changes: readonly EditChange[];
    override: boolean;
    undoOf: string | null;
  },
  now: string,
): string {
  const id = Bun.randomUUIDv7();
  db.query(
    `INSERT INTO character_edits (id, created_at, actor_account_id, actor_name, character_id,
       character, reason, changes, override, undo_of)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    now,
    e.actorAccountId,
    e.actorName,
    e.characterId,
    e.character,
    e.reason,
    JSON.stringify(e.changes),
    e.override ? 1 : 0,
    e.undoOf,
  );
  if (e.undoOf) {
    db.query("UPDATE character_edits SET undone_by = ? WHERE id = ?").run(id, e.undoOf);
  }
  return id;
}

/** A character's newest edits, newest first. */
export function characterEdits(db: Db, characterId: string, limit: number): CharacterEditRow[] {
  return db
    .query<EditRow, [string, number]>(
      `SELECT ${COLUMNS} FROM character_edits WHERE character_id = ?
       ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .all(characterId, limit)
    .map((r) => {
      const { characterId: _, ...row } = toRow(r);
      return row;
    });
}

export function findCharacterEdit(db: Db, id: string): StoredEdit | null {
  const r = db
    .query<EditRow, [string]>(`SELECT ${COLUMNS} FROM character_edits WHERE id = ?`)
    .get(id);
  return r ? toRow(r) : null;
}

/**
 * An offline edit's character-row fields that `saveProgress` does not write: the class, sex and
 * head.
 */
export function saveLookAndClass(
  db: Db,
  id: string,
  c: { classCode: number; sex: number; head: number },
  now: string,
): void {
  db.query(
    "UPDATE characters SET class_code = ?, sex = ?, head = ?, updated_at = ? WHERE id = ?",
  ).run(c.classCode, c.sex, c.head, now, id);
}
