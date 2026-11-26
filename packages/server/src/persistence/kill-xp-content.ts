/**
 * Migration 75's content half (issue #42): a monster's fixed kill XP is its species row's
 * `killXp`, and the name-matched table `monsters.rules.killXp` and a monster definition's
 * `killXp` are gone. What a world stored in them moves onto species rows, layer by layer, so every
 * monster gives the kill XP it gave before:
 *
 * - the release pack under everything ships the values on its rows already (Classic: Cow and
 *   Holy Shield, 5); before the change Classic held them in the table;
 * - each imported pack (#34) in install order: its table replaces the one under it, its
 *   definitions decide for their monsters (a definition without `killXp` meant none), and its own
 *   species rows are given what then played for them. The old fields are taken out;
 * - the operator's rows (`content_rows`): what played for every species, with the operator's
 *   table and definitions on top, is compared with what its species row now says, and the
 *   operator's row for that species is set (or added, over the pack's row) where they differ;
 * - the open draft (`content_draft`), the same way on top of the operator layer;
 * - the publish log (`content_publishes`): the old fields are taken out of the rows it keeps, so
 *   every entry reads under the new schema. An undo of a publish made before the upgrade that
 *   changed only the table or a definition's kill XP puts back the rest of that row and leaves the
 *   kill XP as it is now.
 *
 * Species rows' `base_data` (the pack row an operator edited over) are given the value the packs
 * played, so a pack row that only gained the value raises no notice. Running it again changes
 * nothing. Runs inside the migration's transaction.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { RELEASE_PACK_DIRS } from "@secondstaronline/data/packs";
import { firstMatch, type PatternRow } from "@secondstaronline/shared";

import type { Db } from "./database.ts";

type Row = Record<string, unknown>;
type Rule = PatternRow & { xp: number };

/** The table each release pack held before #42. */
const LEGACY_RULES: Record<string, Rule[]> = {
  classic: [
    { match: "exact", pattern: "Cow", xp: 5 },
    { match: "exact", pattern: "Holy Shield", xp: 5 },
  ],
};

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
const json = (v: unknown): string | null =>
  v === null || v === undefined ? null : JSON.stringify(v);
const lower = (s: string) => s.toLowerCase();

function isRule(v: unknown): v is Rule {
  return (
    isObject(v) &&
    (v.match === "exact" || v.match === "contains") &&
    typeof v.pattern === "string" &&
    typeof v.xp === "number"
  );
}

/** What decided a monster's fixed kill XP: the table, and the definitions by name. */
interface State {
  rules: Rule[];
  /** A definition per monster; its `killXp`, or undefined when it set none. */
  defs: Map<string, number | undefined>;
}
const clone = (s: State): State => ({ rules: [...s.rules], defs: new Map(s.defs) });

/** What played for a monster: its definition's value, else the table's first match. */
function fixedOf(s: State, name: string): number | undefined {
  const k = lower(name);
  if (s.defs.has(k)) {
    return s.defs.get(k);
  }
  return firstMatch(s.rules, name)?.xp;
}

/** A rules section without its kill XP table, and the table it held (null: none). */
function takeRules(v: unknown): { rest: unknown; rules: Rule[] | null } {
  if (!isObject(v) || !("killXp" in v)) {
    return { rest: v, rules: null };
  }
  const { killXp, ...rest } = v;
  return { rest, rules: Array.isArray(killXp) ? killXp.filter(isRule) : [] };
}

/** A definition without its kill XP, and the value it held. */
function takeDef(v: unknown): { rest: unknown; xp: number | undefined } {
  if (!isObject(v)) {
    return { rest: v, xp: undefined };
  }
  const { killXp, ...rest } = v;
  return { rest, xp: typeof killXp === "number" ? killXp : undefined };
}

/** A species row with `killXp` set to `xp` (taken out when undefined). */
function withFixed(row: Row, xp: number | undefined): Row {
  const { killXp: _old, ...rest } = row;
  return xp === undefined ? rest : { ...rest, killXp: xp };
}

const fixedIn = (row: unknown) =>
  isObject(row) && typeof row.killXp === "number" ? row.killXp : undefined;

/** The release pack's species rows, by name, as this release ships them. */
function releaseSpecies(id: string | undefined): Map<string, Row> {
  const out = new Map<string, Row>();
  const dir = id === undefined ? undefined : RELEASE_PACK_DIRS[id];
  const file = dir === undefined ? undefined : join(dir, "data", "monsters.json");
  if (file === undefined || !existsSync(file)) {
    return out;
  }
  const data = parse(readFileSync(file, "utf8"));
  const list = isObject(data) && Array.isArray(data.monsters) ? data.monsters : [];
  for (const r of list) {
    if (isObject(r) && typeof r.name === "string") {
      out.set(lower(r.name), r);
    }
  }
  return out;
}

interface ContentRow {
  part: string;
  row_key: string;
  op: string;
  data: string | null;
  base_data: string | null;
}

export function moveKillXp(db: Db): void {
  const release = db
    .query<{ id: string }, []>(
      "SELECT id FROM content_packs WHERE source = 'release' ORDER BY position LIMIT 1",
    )
    .get();
  const species = releaseSpecies(release?.id);
  const pack: State = { rules: [...(LEGACY_RULES[release?.id ?? ""] ?? [])], defs: new Map() };

  // Imported packs, in install order.
  for (const p of db
    .query<{ id: string; data: string | null }, []>(
      "SELECT id, data FROM content_packs WHERE source = 'imported' AND data IS NOT NULL ORDER BY position",
    )
    .all()) {
    const blob = parse(p.data);
    if (!isObject(blob) || !isObject(blob.data) || !isObject(blob.data.monsters)) {
      continue;
    }
    const m = blob.data.monsters;
    const rules = takeRules(m.rules);
    if (rules.rules !== null) {
      pack.rules = rules.rules;
      m.rules = rules.rest;
    }
    if (Array.isArray(m.definitions)) {
      m.definitions = m.definitions.map((d) => {
        const t = takeDef(d);
        if (isObject(d) && typeof d.name === "string") {
          pack.defs.set(lower(d.name), t.xp);
        }
        return t.rest;
      });
    }
    for (const r of Array.isArray(blob.removals) ? blob.removals : []) {
      if (isObject(r) && r.dataset === "monsters" && r.part === "definitions") {
        pack.defs.delete(lower(String(r.key)));
      }
    }
    if (Array.isArray(m.monsters)) {
      m.monsters = m.monsters.map((r) => {
        if (!isObject(r) || typeof r.name !== "string") {
          return r;
        }
        const row = withFixed(r, fixedOf(pack, r.name));
        species.set(lower(r.name), row);
        return row;
      });
    }
    db.query("UPDATE content_packs SET data = ? WHERE id = ?").run(JSON.stringify(blob), p.id);
  }
  // Species rows a pack's table or definition decided for but that came from a pack under it:
  // what the packs played, which the operator layer below writes where it differs.
  const packFixed = (name: string) => fixedOf(pack, name);

  const seq = () =>
    (db.query<{ n: number }, []>("SELECT coalesce(max(seq), 0) + 1 AS n FROM content_rows").get()
      ?.n ?? 1) as number;

  // The operator layer.
  const rows = db
    .query<ContentRow, []>(
      "SELECT part, row_key, op, data, base_data FROM content_rows WHERE dataset = 'monsters'",
    )
    .all();
  const op = clone(pack);
  const opSpecies = new Map<string, { key: string; op: string; data: Row | null }>();
  for (const r of rows) {
    if (r.part === "rules" && r.op === "set") {
      const t = takeRules(parse(r.data));
      if (t.rules !== null) {
        op.rules = t.rules;
      }
      db.query(
        "UPDATE content_rows SET data = ?, base_data = ?, base_hash = NULL WHERE dataset = 'monsters' AND part = 'rules' AND row_key = ?",
      ).run(json(t.rest), json(takeRules(parse(r.base_data)).rest), r.row_key);
    } else if (r.part === "definitions") {
      if (r.op === "set") {
        op.defs.set(lower(r.row_key), takeDef(parse(r.data)).xp);
      } else {
        op.defs.delete(lower(r.row_key));
      }
      db.query(
        "UPDATE content_rows SET data = ?, base_data = ?, base_hash = NULL WHERE dataset = 'monsters' AND part = 'definitions' AND row_key = ?",
      ).run(json(takeDef(parse(r.data)).rest), json(takeDef(parse(r.base_data)).rest), r.row_key);
    } else if (r.part === "monsters") {
      const data = parse(r.data);
      opSpecies.set(lower(r.row_key), {
        key: r.row_key,
        op: r.op,
        data: r.op === "set" && isObject(data) ? data : null,
      });
      // The pack row it was edited over, as the packs now play it.
      const base = parse(r.base_data);
      if (isObject(base) && typeof base.name === "string") {
        db.query(
          "UPDATE content_rows SET base_data = ?, base_hash = NULL WHERE dataset = 'monsters' AND part = 'monsters' AND row_key = ?",
        ).run(json(withFixed(base, packFixed(base.name))), r.row_key);
      }
    }
  }
  /** Each species row in play after the operator layer: its own row, else the packs'. */
  const playing = new Map<string, Row>();
  for (const [k, row] of species) {
    playing.set(k, row);
  }
  for (const [k, s] of opSpecies) {
    if (s.data) {
      playing.set(k, s.data);
    } else if (s.op === "remove") {
      playing.delete(k);
    }
  }
  for (const [k, row] of playing) {
    const name = String(row.name);
    const want = fixedOf(op, name);
    if (fixedIn(row) === want) {
      continue;
    }
    const own = opSpecies.get(k);
    const fixed = withFixed(row, want);
    if (own?.data) {
      db.query(
        "UPDATE content_rows SET data = ? WHERE dataset = 'monsters' AND part = 'monsters' AND row_key = ?",
      ).run(json(fixed), own.key);
    } else {
      db.query(
        "INSERT INTO content_rows (dataset, part, row_key, op, data, base_hash, base_data, seq, updated_by, updated_at) VALUES ('monsters', 'monsters', ?, 'set', ?, NULL, ?, ?, 'system', ?)",
      ).run(name, json(fixed), json(row), seq(), new Date(0).toISOString());
    }
    playing.set(k, fixed);
  }

  // The open draft, on top of the operator layer.
  const draft = db
    .query<ContentRow, []>(
      "SELECT part, row_key, op, data, NULL AS base_data FROM content_draft WHERE dataset = 'monsters'",
    )
    .all();
  const dr = clone(op);
  const draftSpecies = new Map<string, { key: string; op: string; data: Row | null }>();
  for (const r of draft) {
    if (r.part === "rules") {
      if (r.op === "set") {
        const t = takeRules(parse(r.data));
        if (t.rules !== null) {
          dr.rules = t.rules;
        }
        db.query(
          "UPDATE content_draft SET data = ? WHERE dataset = 'monsters' AND part = 'rules' AND row_key = ?",
        ).run(json(t.rest), r.row_key);
      } else if (r.op === "revert") {
        dr.rules = [...pack.rules];
      }
    } else if (r.part === "definitions") {
      const k = lower(r.row_key);
      if (r.op === "set") {
        dr.defs.set(k, takeDef(parse(r.data)).xp);
        db.query(
          "UPDATE content_draft SET data = ? WHERE dataset = 'monsters' AND part = 'definitions' AND row_key = ?",
        ).run(json(takeDef(parse(r.data)).rest), r.row_key);
      } else if (r.op === "revert" && pack.defs.has(k)) {
        dr.defs.set(k, pack.defs.get(k));
      } else {
        dr.defs.delete(k);
      }
    } else if (r.part === "monsters") {
      const data = parse(r.data);
      draftSpecies.set(lower(r.row_key), {
        key: r.row_key,
        op: r.op,
        data: r.op === "set" && isObject(data) ? data : null,
      });
    }
  }
  const draftPlaying = new Map(playing);
  for (const [k, s] of draftSpecies) {
    const packRow = species.get(k);
    if (s.data) {
      draftPlaying.set(k, s.data);
    } else if (s.op === "revert" && packRow) {
      draftPlaying.set(k, packRow);
    } else {
      draftPlaying.delete(k);
    }
  }
  for (const [k, row] of draftPlaying) {
    const name = String(row.name);
    const want = fixedOf(dr, name);
    if (fixedIn(row) === want) {
      continue;
    }
    const own = draftSpecies.get(k);
    const data = json(withFixed(row, want));
    if (own) {
      db.query(
        "UPDATE content_draft SET op = 'set', data = ? WHERE dataset = 'monsters' AND part = 'monsters' AND row_key = ?",
      ).run(data, own.key);
    } else {
      db.query(
        "INSERT INTO content_draft (dataset, part, row_key, op, data, author_account_id, author, updated_at) VALUES ('monsters', 'monsters', ?, 'set', ?, 'system', 'system', ?)",
      ).run(name, data, new Date(0).toISOString());
    }
  }

  // The publish log: the old fields out of every row it keeps.
  for (const p of db
    .query<{ id: string; changes: string }, []>("SELECT id, changes FROM content_publishes")
    .all()) {
    const changes = parse(p.changes);
    if (!Array.isArray(changes)) {
      continue;
    }
    let touched = false;
    for (const c of changes) {
      if (!isObject(c) || c.dataset !== "monsters") {
        continue;
      }
      const strip =
        c.part === "rules"
          ? (v: unknown) => takeRules(v).rest
          : c.part === "definitions"
            ? (v: unknown) => takeDef(v).rest
            : null;
      if (!strip) {
        continue;
      }
      for (const side of ["before", "after"] as const) {
        const s = c[side];
        if (isObject(s)) {
          for (const f of ["data", "baseData"] as const) {
            if (isObject(s[f]) && "killXp" in (s[f] as Row)) {
              s[f] = strip(s[f]);
              touched = true;
            }
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
