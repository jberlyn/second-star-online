/** Newspapers: one row per author, matched ignoring case. Callers own transactions. */
import type { Db } from "./database.ts";

/** The nine fields in 1.6's file order: photo ids 1-3, then the six newspaper text fields. */
export interface NewspaperFields {
  photos: string[];
  texts: string[];
}

interface NewspaperRow {
  photo1: string;
  photo2: string;
  photo3: string;
  text1: string;
  text2: string;
  text3: string;
  text4: string;
  text5: string;
  text6: string;
}

/** An author's newspaper, or null when they have none. */
export function loadNewspaper(db: Db, author: string): NewspaperFields | null {
  const r = db
    .query<NewspaperRow, [string]>(
      `SELECT photo1, photo2, photo3, text1, text2, text3, text4, text5, text6
         FROM newspapers WHERE author = ?`,
    )
    .get(author);
  if (!r) {
    return null;
  }
  return {
    photos: [r.photo1, r.photo2, r.photo3],
    texts: [r.text1, r.text2, r.text3, r.text4, r.text5, r.text6],
  };
}

/** Writes (or rewrites) an author's newspaper. */
export function saveNewspaper(db: Db, author: string, f: NewspaperFields, savedAt: string): void {
  const p = f.photos;
  const t = f.texts;
  db.query(
    `INSERT INTO newspapers
       (author, photo1, photo2, photo3, text1, text2, text3, text4, text5, text6, saved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (author) DO UPDATE SET
       photo1 = excluded.photo1, photo2 = excluded.photo2, photo3 = excluded.photo3,
       text1 = excluded.text1, text2 = excluded.text2, text3 = excluded.text3,
       text4 = excluded.text4, text5 = excluded.text5, text6 = excluded.text6,
       saved_at = excluded.saved_at`,
  ).run(
    author,
    p[0] ?? "",
    p[1] ?? "",
    p[2] ?? "",
    t[0] ?? "",
    t[1] ?? "",
    t[2] ?? "",
    t[3] ?? "",
    t[4] ?? "",
    t[5] ?? "",
    savedAt,
  );
}
