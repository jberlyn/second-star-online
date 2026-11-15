/**
 * The Assassin's game rows: the mode, the current and all-time top-10 tables, the points per
 * character this game and the wins per character. Callers own transactions.
 */
import {
  type AssassinEntry,
  type AssassinMode,
  type AssassinState,
  emptyAssassinState,
} from "@secondstaronline/shared";

import type { Db } from "./database.ts";

export function loadAssassinState(db: Db): AssassinState {
  const s = emptyAssassinState();
  const mode = db
    .query<{ mode: AssassinMode }, []>("SELECT mode FROM assassin_game WHERE id = 1")
    .get();
  if (mode) {
    s.mode = mode.mode;
  }
  const rows = db
    .query<{ kind: string; character_id: string; name: string; points: number }, []>(
      "SELECT kind, character_id, name, points FROM assassin_table ORDER BY kind, rank",
    )
    .all();
  for (const r of rows) {
    const e: AssassinEntry = { id: r.character_id, name: r.name, points: r.points };
    (r.kind === "legend" ? s.legends : s.current).push(e);
  }
  for (const r of db
    .query<{ character_id: string; points: number }, []>(
      "SELECT character_id, points FROM assassin_scores",
    )
    .all()) {
    s.scores.set(r.character_id, r.points);
  }
  for (const r of db
    .query<{ character_id: string; wins: number }, []>(
      "SELECT character_id, wins FROM assassin_legends",
    )
    .all()) {
    s.wins.set(r.character_id, r.wins);
  }
  return s;
}

/** Writes the whole state (a game has at most a few hundred rows). */
export function saveAssassinState(db: Db, s: AssassinState): void {
  db.query(
    "INSERT INTO assassin_game (id, mode) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET mode = excluded.mode",
  ).run(s.mode);
  db.query("DELETE FROM assassin_table").run();
  const put = db.query(
    "INSERT INTO assassin_table (kind, rank, character_id, name, points) VALUES (?, ?, ?, ?, ?)",
  );
  for (const [kind, table] of [
    ["current", s.current],
    ["legend", s.legends],
  ] as const) {
    for (const [k, e] of table.entries()) {
      put.run(kind, k + 1, e.id, e.name, e.points);
    }
  }
  db.query("DELETE FROM assassin_scores").run();
  const score = db.query("INSERT INTO assassin_scores (character_id, points) VALUES (?, ?)");
  for (const [id, points] of s.scores) {
    score.run(id, points);
  }
  const win = db.query(
    "INSERT INTO assassin_legends (character_id, wins) VALUES (?, ?) ON CONFLICT (character_id) DO UPDATE SET wins = excluded.wins",
  );
  for (const [id, wins] of s.wins) {
    win.run(id, wins);
  }
}
