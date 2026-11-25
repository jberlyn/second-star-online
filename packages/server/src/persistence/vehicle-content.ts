/**
 * Migration 73's content half (issue #44): vehicles became `houses.vehicles` rows, each with its
 * own rider body and full hull, and `bindings.bodies.riders` and `balance.hulls` are gone. What a
 * world stored in them moves into vehicle rows, layer by layer, against the content in effect
 * before the change:
 *
 * - the release pack under everything (Classic had the three vehicles; any other, none);
 * - each imported pack (#34) in install order: its riders, hull rows and hull removals become its
 *   own vehicle rows (a partial pack's `houses.vehicles`), or removals of them when the pack turned
 *   vehicles off (a bodies section without riders). A full pack with no `houses` dataset cannot
 *   hold them, so its changes are carried up to the operator layer;
 * - the operator's rows (`content_rows`), then the open draft (`content_draft`);
 * - the publish log (`content_publishes`), replayed in order, so each publish's change to a hull or
 *   a rider is a change to the vehicle's row with the values it had before and after, and Undo
 *   keeps working.
 *
 * A vehicle row is written only where it differs from the row under it. Its base hash is left to
 * be worked out again from its base data (persistence/content.ts). The old fields are taken out
 * everywhere, so every store reads under the new schema. Runs inside the migration's transaction.
 */
import type { Db } from "./database.ts";

const NAMES = ["Boat", "Battleship", "Airship"] as const;
type Name = (typeof NAMES)[number];
type Row = Record<string, unknown>;

/** The Classic rows as this release ships them: 1.6's three vehicles as they played before. */
const LEGACY: Record<Name, Row> = {
  Boat: {
    name: "Boat",
    picture: "BoatPic",
    rider: 55,
    hull: 60,
    moves: { over: { flags: ["sea"] } },
    boards: "shore",
    bobs: true,
  },
  Battleship: {
    name: "Battleship",
    picture: "BattleshipPic",
    rider: 56,
    hull: 150,
    moves: { over: { flags: ["sea"] } },
    boards: "shore",
    cannon: true,
    bobs: true,
  },
  Airship: {
    name: "Airship",
    picture: "AirshipPic",
    rider: 57,
    hull: 80,
    moves: { over: "any", except: { flags: ["airshipBlock"] } },
    boards: "pad",
    lands: { flags: ["dock"] },
  },
};

/** The engine's default hulls, which a removed hull row fell back to. */
const DEFAULT_HULL: Record<Name, number> = { Boat: 60, Battleship: 150, Airship: 80 };

/** What decided the vehicles before: whether riders were bound, and each one's body and hull. */
interface State {
  on: boolean;
  rider: Record<Name, number>;
  hull: Record<Name, number>;
}

const isName = (v: unknown): v is Name => typeof v === "string" && NAMES.includes(v as Name);
const isObject = (v: unknown): v is Row => v !== null && typeof v === "object" && !Array.isArray(v);
const clone = (s: State): State => ({ on: s.on, rider: { ...s.rider }, hull: { ...s.hull } });

function canonical(v: unknown): string {
  if (Array.isArray(v)) {
    return `[${v.map(canonical).join(",")}]`;
  }
  if (isObject(v)) {
    return `{${Object.keys(v)
      .filter((k) => v[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);

/** The vehicle rows a state makes: Classic's with its body and hull, or none (no riders). */
function rowsOf(s: State): Record<Name, Row | null> {
  const out = {} as Record<Name, Row | null>;
  for (const n of NAMES) {
    out[n] = s.on ? { ...LEGACY[n], rider: s.rider[n], hull: s.hull[n] } : null;
  }
  return out;
}

/** A bodies row's riders taken into a state: bound (each body given) or, without riders, off. */
function takeRiders(s: State, bodies: unknown): void {
  const riders = isObject(bodies) ? bodies.riders : undefined;
  if (!isObject(riders)) {
    s.on = false;
    return;
  }
  s.on = true;
  for (const n of NAMES) {
    const b = riders[n];
    if (typeof b === "number") {
      s.rider[n] = b;
    }
  }
}

/** A bodies row without its riders. */
function withoutRiders(v: unknown): unknown {
  if (!isObject(v) || !("riders" in v)) {
    return v;
  }
  const { riders: _riders, ...rest } = v;
  return rest;
}

const parse = (s: string | null): unknown => (s === null ? null : JSON.parse(s));
const json = (v: unknown): string | null =>
  v === null || v === undefined ? null : JSON.stringify(v);

interface ContentRow {
  dataset: string;
  part: string;
  row_key: string;
  op: string;
  data: string | null;
  base_hash: string | null;
  base_data: string | null;
  seq: number;
  updated_by: string;
  updated_at: string;
}

interface DraftRow {
  dataset: string;
  part: string;
  row_key: string;
  op: string;
  data: string | null;
  author_account_id: string;
  author: string;
  updated_at: string;
}

interface StateRecord {
  op: string;
  data: unknown;
  baseHash: string | null;
  baseData: unknown;
}
interface Change {
  dataset: string;
  part: string;
  key: string | null;
  before: StateRecord | null;
  after: StateRecord | null;
}

const isBodies = (r: { dataset: string; part: string }) =>
  r.dataset === "bindings" && r.part === "bodies";
const isHull = (r: { dataset: string; part: string }) =>
  r.dataset === "balance" && r.part === "hulls";

export function moveVehicleContent(db: Db): void {
  // The release pack under every layer.
  const release = db
    .query<{ id: string }, []>(
      "SELECT id FROM content_packs WHERE source = 'release' ORDER BY position LIMIT 1",
    )
    .get();
  const state: State = {
    on: release?.id === "classic",
    rider: { Boat: 55, Battleship: 56, Airship: 57 },
    hull: { ...DEFAULT_HULL },
  };
  let packRows = rowsOf(state);

  // Imported packs, in install order.
  for (const p of db
    .query<{ id: string; data: string | null }, []>(
      "SELECT id, data FROM content_packs WHERE source = 'imported' AND data IS NOT NULL ORDER BY position",
    )
    .all()) {
    let blob: Row;
    try {
      blob = JSON.parse(p.data as string) as Row;
    } catch {
      continue; // unreadable: the start names it, as before
    }
    if (!isObject(blob) || !isObject(blob.data)) {
      continue;
    }
    const data = blob.data as Row;
    let touched = false;
    const bindings = data.bindings;
    if (isObject(bindings) && isObject(bindings.bodies)) {
      touched = true;
      takeRiders(state, bindings.bodies);
      bindings.bodies = withoutRiders(bindings.bodies);
    }
    const balance = data.balance;
    if (isObject(balance) && Array.isArray(balance.hulls)) {
      touched = true;
      for (const h of balance.hulls) {
        if (isObject(h) && isName(h.vehicle) && typeof h.hull === "number") {
          state.hull[h.vehicle] = h.hull;
        }
      }
      delete balance.hulls;
    }
    let removals = Array.isArray(blob.removals) ? (blob.removals as unknown[]) : null;
    if (removals) {
      removals = removals.filter((r) => {
        if (isObject(r) && r.dataset === "balance" && r.part === "hulls") {
          touched = true;
          if (isName(r.key)) {
            state.hull[r.key] = DEFAULT_HULL[r.key];
          }
          return false;
        }
        return true;
      });
      blob.removals = removals;
    }
    if (touched) {
      const want = rowsOf(state);
      const manifest = isObject(blob.manifest) ? blob.manifest : {};
      const partial = manifest.format === 2;
      const houses = isObject(data.houses) ? data.houses : partial ? {} : null;
      for (const n of NAMES) {
        if (same(want[n], packRows[n])) {
          continue;
        }
        if (want[n] === null) {
          if (partial) {
            blob.removals = [
              ...((blob.removals as unknown[] | undefined) ?? []),
              { dataset: "houses", part: "vehicles", key: n },
            ];
            packRows[n] = null;
          }
          continue;
        }
        if (houses) {
          const list = Array.isArray(houses.vehicles) ? (houses.vehicles as Row[]) : [];
          houses.vehicles = [...list.filter((v) => v.name !== n), want[n]];
          data.houses = houses;
          packRows[n] = want[n];
        }
        // A full pack with no `houses` cannot hold it: the operator layer carries it below.
      }
    }
    db.query("UPDATE content_packs SET data = ? WHERE id = ?").run(JSON.stringify(blob), p.id);
  }
  packRows = { ...packRows };
  const packState = clone(state);

  // The operator layer.
  const rows = db
    .query<ContentRow, []>(
      "SELECT dataset, part, row_key, op, data, base_hash, base_data, seq, updated_by, updated_at FROM content_rows",
    )
    .all();
  let by: ContentRow | null = null;
  const op = clone(state);
  for (const r of rows) {
    if (isBodies(r)) {
      by = r;
      if (r.op === "set") {
        takeRiders(op, parse(r.data));
      }
      db.query(
        "UPDATE content_rows SET data = ?, base_data = ?, base_hash = NULL WHERE dataset = ? AND part = ? AND row_key = ?",
      ).run(
        json(withoutRiders(parse(r.data))),
        json(withoutRiders(parse(r.base_data))),
        r.dataset,
        r.part,
        r.row_key,
      );
    }
  }
  for (const r of rows) {
    if (isHull(r) && isName(r.row_key)) {
      by ??= r;
      const d = parse(r.data);
      op.hull[r.row_key] =
        r.op === "set" && isObject(d) && typeof d.hull === "number"
          ? d.hull
          : DEFAULT_HULL[r.row_key];
    }
  }
  db.run("DELETE FROM content_rows WHERE dataset = 'balance' AND part = 'hulls'");
  const operatorRows = rowsOf(op);
  /** What plays for each vehicle once the operator's rows are laid on. */
  const playing: Record<Name, Row | null> = { ...packRows };
  const seq = () =>
    (db.query<{ n: number }, []>("SELECT coalesce(max(seq), 0) + 1 AS n FROM content_rows").get()
      ?.n ?? 1) as number;
  const taken = new Set(
    db
      .query<{ row_key: string }, []>(
        "SELECT row_key FROM content_rows WHERE dataset = 'houses' AND part = 'vehicles'",
      )
      .all()
      .map((r) => r.row_key.toLowerCase()),
  );
  for (const n of NAMES) {
    if (same(operatorRows[n], packRows[n]) || taken.has(n.toLowerCase())) {
      continue;
    }
    if (operatorRows[n] === null && packRows[n] === null) {
      continue;
    }
    db.query(
      "INSERT INTO content_rows (dataset, part, row_key, op, data, base_hash, base_data, seq, updated_by, updated_at) VALUES ('houses', 'vehicles', ?, ?, ?, NULL, ?, ?, ?, ?)",
    ).run(
      n,
      operatorRows[n] === null ? "remove" : "set",
      json(operatorRows[n]),
      json(packRows[n]),
      seq(),
      by?.updated_by ?? "system",
      by?.updated_at ?? new Date(0).toISOString(),
    );
    playing[n] = operatorRows[n];
  }

  // The open draft: what it would change, as changes to the vehicle rows.
  const drafts = db
    .query<DraftRow, []>(
      "SELECT dataset, part, row_key, op, data, author_account_id, author, updated_at FROM content_draft",
    )
    .all();
  const relevant = drafts.filter((d) => isBodies(d) || isHull(d));
  if (relevant.length > 0) {
    const draft = clone(op);
    const author = relevant.at(-1) as DraftRow;
    for (const d of relevant.filter(isBodies)) {
      if (d.op === "set") {
        takeRiders(draft, parse(d.data));
        db.query(
          "UPDATE content_draft SET data = ? WHERE dataset = ? AND part = ? AND row_key = ?",
        ).run(json(withoutRiders(parse(d.data))), d.dataset, d.part, d.row_key);
      } else if (d.op === "revert") {
        draft.on = packState.on;
        draft.rider = { ...packState.rider };
      }
    }
    for (const d of relevant.filter(isHull)) {
      if (!isName(d.row_key)) {
        continue;
      }
      const v = parse(d.data);
      draft.hull[d.row_key] =
        d.op === "set" && isObject(v) && typeof v.hull === "number"
          ? v.hull
          : d.op === "revert"
            ? packState.hull[d.row_key]
            : DEFAULT_HULL[d.row_key];
    }
    db.run("DELETE FROM content_draft WHERE dataset = 'balance' AND part = 'hulls'");
    const want = rowsOf(draft);
    for (const n of NAMES) {
      if (same(want[n], playing[n])) {
        continue;
      }
      const opName = same(want[n], packRows[n]) ? "revert" : want[n] === null ? "remove" : "set";
      db.query(
        "INSERT OR REPLACE INTO content_draft (dataset, part, row_key, op, data, author_account_id, author, updated_at) VALUES ('houses', 'vehicles', ?, ?, ?, ?, ?, ?)",
      ).run(
        n,
        opName,
        opName === "set" ? json(want[n]) : null,
        author.author_account_id,
        author.author,
        author.updated_at,
      );
    }
  }

  // The publish log, replayed: each publish's hull and rider changes become changes to the
  // vehicle rows, before and after, so Undo finds what it published.
  const record = (n: Name, row: Row | null): StateRecord | null =>
    same(row, packRows[n])
      ? null
      : row === null
        ? { op: "remove", data: null, baseHash: null, baseData: packRows[n] }
        : { op: "set", data: row, baseHash: null, baseData: packRows[n] };
  const history = clone(packState);
  const strip = (s: StateRecord | null): StateRecord | null =>
    s === null
      ? null
      : {
          ...s,
          data: withoutRiders(s.data),
          baseData: withoutRiders(s.baseData),
          baseHash: null,
        };
  for (const p of db
    .query<{ id: string; changes: string }, []>(
      "SELECT id, changes FROM content_publishes ORDER BY created_at, id",
    )
    .all()) {
    let changes: Change[];
    try {
      changes = JSON.parse(p.changes) as Change[];
    } catch {
      continue;
    }
    if (!Array.isArray(changes) || !changes.some((c) => isBodies(c) || isHull(c))) {
      continue;
    }
    const before = rowsOf(history);
    for (const c of changes) {
      if (isBodies(c)) {
        if (c.after === null) {
          history.on = packState.on;
          history.rider = { ...packState.rider };
        } else if (c.after.op === "set") {
          takeRiders(history, c.after.data);
        }
      } else if (isHull(c) && isName(c.key)) {
        const d = c.after?.data;
        history.hull[c.key] =
          c.after === null
            ? packState.hull[c.key]
            : c.after.op === "set" && isObject(d) && typeof d.hull === "number"
              ? d.hull
              : DEFAULT_HULL[c.key];
      }
    }
    const after = rowsOf(history);
    const next: Change[] = changes
      .filter((c) => !isHull(c))
      .map((c) => (isBodies(c) ? { ...c, before: strip(c.before), after: strip(c.after) } : c));
    for (const n of NAMES) {
      if (!same(before[n], after[n])) {
        next.push({
          dataset: "houses",
          part: "vehicles",
          key: n,
          before: record(n, before[n]),
          after: record(n, after[n]),
        });
      }
    }
    db.query("UPDATE content_publishes SET changes = ? WHERE id = ?").run(
      JSON.stringify(next),
      p.id,
    );
  }
}
