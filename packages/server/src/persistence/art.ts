/** Paintings and photos: one row per saved image. Callers own transactions. */
import type { Rng } from "@secondstaronline/shared";

import type { Db } from "./database.ts";

export interface ArtRow {
  kind: "painting" | "photo";
  author: string;
  png: Uint8Array;
}

/** 1.6's `random(10000000)` is 1-10,000,000 in Lingo; SSO uses 1-9,999,999. */
export const ART_ID_MAX = 9_999_999;

/** Draws before falling back to the lowest free id (only a stuck or tiny `Rng` ever gets there). */
const ART_ID_TRIES = 100;

/**
 * Stores an image under a fresh random id and returns it (a taken id is drawn again, never
 * overwritten).
 */
export function addArt(
  db: Db,
  kind: "painting" | "photo",
  author: string,
  png: Uint8Array,
  createdAt: string,
  rng: Rng,
): number {
  const taken = (id: number) =>
    db.query<{ n: number }, [number]>("SELECT 1 AS n FROM art WHERE id = ?").get(id) !== null;
  let id = 0;
  for (let i = 0; i < ART_ID_TRIES && (id < 1 || taken(id)); i++) {
    id = rng.random(ART_ID_MAX);
  }
  for (id = id >= 1 && !taken(id) ? id : 1; taken(id); id++) {
    // The lowest free id above a stuck draw.
  }
  db.query("INSERT INTO art (id, kind, author, png, created_at) VALUES (?, ?, ?, ?, ?)").run(
    id,
    kind,
    author,
    png,
    createdAt,
  );
  return id;
}

/** An image by id, or null when none is stored (`readvalue` of a missing file). */
export function loadArt(db: Db, id: number): ArtRow | null {
  return (
    db.query<ArtRow, [number]>("SELECT kind, author, png FROM art WHERE id = ?").get(id) ?? null
  );
}
