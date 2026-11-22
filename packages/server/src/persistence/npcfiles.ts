/**
 * NPC files saved from the NPC editor, and the versions they replaced. The caller owns the
 * transaction: a save writes the file, its version and the reset shop ledger together.
 */
import type { Db } from "./database.ts";

export interface StoredNpcFile {
  npc: string;
  text: string;
}

/** Every saved file (the server lays them over the archive's at start-up). */
export function loadNpcFiles(db: Db): StoredNpcFile[] {
  return db.query<StoredNpcFile, []>("SELECT npc, text FROM npc_files ORDER BY npc").all();
}

export function saveNpcFile(db: Db, f: StoredNpcFile, savedBy: string, now: string): void {
  db.query(
    "INSERT INTO npc_files (npc, text, saved_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(npc) DO UPDATE SET npc = excluded.npc, text = excluded.text, saved_by = excluded.saved_by, updated_at = excluded.updated_at",
  ).run(f.npc, f.text, savedBy, now);
}

/** Keeps the file as it was before a save. */
export function insertNpcFileVersion(db: Db, f: StoredNpcFile, savedBy: string, now: string): void {
  db.query(
    "INSERT INTO npc_file_versions (id, npc, saved_by, text, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(Bun.randomUUIDv7(), f.npc, savedBy, f.text, now);
}

export function npcFileVersions(db: Db, npc: string): string[] {
  return db
    .query<{ text: string }, [string]>(
      "SELECT text FROM npc_file_versions WHERE npc = ? ORDER BY created_at, id",
    )
    .all(npc)
    .map((r) => r.text);
}

/** Drops an NPC's save, so its content row plays again (its versions are kept). */
export function deleteNpcFile(db: Db, npc: string): void {
  db.query("DELETE FROM npc_files WHERE lower(npc) = lower(?)").run(npc);
}
