/** Message boards: append-only posts per board. Callers own transactions. */
import type { Db } from "./database.ts";

export interface PostRow {
  author: string;
  body: string;
}

/** A board's posts, oldest first (a board with none is empty). */
export function loadBoard(db: Db, board: string): PostRow[] {
  return db
    .query<PostRow, [string]>("SELECT author, body FROM board_posts WHERE board = ? ORDER BY id")
    .all(board);
}

/** Appends a post, then drops the oldest past `cap`. */
export function addPost(
  db: Db,
  board: string,
  author: string,
  body: string,
  postedAt: string,
  cap: number,
): void {
  db.query("INSERT INTO board_posts (board, author, body, posted_at) VALUES (?, ?, ?, ?)").run(
    board,
    author,
    body,
    postedAt,
  );
  db.query(
    `DELETE FROM board_posts WHERE board = ? AND id NOT IN
       (SELECT id FROM board_posts WHERE board = ? ORDER BY id DESC LIMIT ?)`,
  ).run(board, board, cap);
}
