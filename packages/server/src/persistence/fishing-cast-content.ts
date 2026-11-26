/**
 * Migration 76's content half: fishing's cast effect and sound are content (`fishing.castFx`,
 * `castSound`), where the engine fixed them as the 13-frame `Fishing` run and the `splash` sound on
 * channel 4. Every stored fishing section without them is given those values, so a world plays
 * what it played:
 *
 * - each imported pack's `gather.gathering` (#34);
 * - the operator's rows (`content_rows`), in `data` and in `base_data` (the pack row an operator
 *   edited over, so the new pack row raises no notice);
 * - the open draft (`content_draft`);
 * - the publish log (`content_publishes`): the rows it keeps, so an undo of an older publish
 *   writes a fishing section the schema takes.
 *
 * The release packs ship the fields already. Running it again changes nothing. Runs inside the
 * migration's transaction.
 */
import type { Db } from "./database.ts";

type Row = Record<string, unknown>;

/** What the engine played before the fields were content. */
export const LEGACY_FISHING_CAST = {
  castFx: { fx: "Fishing", frames: 13 },
  castSound: { name: "splash", ch: 4 },
} as const;

const isObject = (v: unknown): v is Row => v !== null && typeof v === "object" && !Array.isArray(v);
const parse = (s: string | null): unknown => {
  if (s === null) {
    return null;
  }
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

/** A gathering section with the fields given to its fishing, or null when it needs none. */
export function withFishingCast(gathering: unknown): Row | null {
  if (!isObject(gathering) || !isObject(gathering.fishing)) {
    return null;
  }
  const f = gathering.fishing;
  if ("castFx" in f && "castSound" in f) {
    return null;
  }
  return {
    ...gathering,
    fishing: {
      ...f,
      ...("castFx" in f ? {} : { castFx: { ...LEGACY_FISHING_CAST.castFx } }),
      ...("castSound" in f ? {} : { castSound: { ...LEGACY_FISHING_CAST.castSound } }),
    },
  };
}

export function moveFishingCast(db: Db): void {
  rewriteStoredGathering(db, withFishingCast);
}

/**
 * Rewrites every stored gathering section with `fix` (null: leave it): each imported pack's, the
 * operator's rows (`data` and `base_data`), the draft's and the publish log's. Shared by the
 * migrations that change fishing (76, 77).
 */
export function rewriteStoredGathering(db: Db, fix: (gathering: unknown) => Row | null): void {
  // Imported packs.
  for (const p of db
    .query<{ id: string; data: string }, []>(
      "SELECT id, data FROM content_packs WHERE source = 'imported' AND data IS NOT NULL",
    )
    .all()) {
    const blob = parse(p.data);
    if (!isObject(blob) || !isObject(blob.data) || !isObject(blob.data.gather)) {
      continue;
    }
    const next = fix(blob.data.gather.gathering);
    if (next) {
      blob.data.gather.gathering = next;
      db.query("UPDATE content_packs SET data = ? WHERE id = ?").run(JSON.stringify(blob), p.id);
    }
  }

  // The operator's rows and the draft.
  for (const r of db
    .query<{ row_key: string; data: string | null; base_data: string | null }, []>(
      "SELECT row_key, data, base_data FROM content_rows WHERE dataset = 'gather' AND part = 'gathering'",
    )
    .all()) {
    const data = fix(parse(r.data));
    const base = fix(parse(r.base_data));
    if (data || base) {
      db.query(
        "UPDATE content_rows SET data = ?, base_data = ?, base_hash = CASE WHEN ? THEN NULL ELSE base_hash END WHERE dataset = 'gather' AND part = 'gathering' AND row_key = ?",
      ).run(
        data ? JSON.stringify(data) : r.data,
        base ? JSON.stringify(base) : r.base_data,
        base ? 1 : 0,
        r.row_key,
      );
    }
  }
  for (const r of db
    .query<{ row_key: string; data: string | null }, []>(
      "SELECT row_key, data FROM content_draft WHERE dataset = 'gather' AND part = 'gathering'",
    )
    .all()) {
    const data = fix(parse(r.data));
    if (data) {
      db.query(
        "UPDATE content_draft SET data = ? WHERE dataset = 'gather' AND part = 'gathering' AND row_key = ?",
      ).run(JSON.stringify(data), r.row_key);
    }
  }

  // The publish log.
  for (const p of db
    .query<{ id: string; changes: string }, []>("SELECT id, changes FROM content_publishes")
    .all()) {
    const changes = parse(p.changes);
    if (!Array.isArray(changes)) {
      continue;
    }
    let touched = false;
    for (const c of changes) {
      if (!isObject(c) || c.dataset !== "gather" || c.part !== "gathering") {
        continue;
      }
      for (const side of ["before", "after"] as const) {
        const s = c[side];
        if (!isObject(s)) {
          continue;
        }
        for (const f of ["data", "baseData"] as const) {
          const next = fix(s[f]);
          if (next) {
            s[f] = next;
            touched = true;
          }
        }
      }
    }
    if (touched) {
      db.query("UPDATE content_publishes SET changes = ? WHERE id = ?").run(
        JSON.stringify(changes),
        p.id,
      );
    }
  }
}
