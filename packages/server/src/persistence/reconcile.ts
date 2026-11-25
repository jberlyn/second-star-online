/**
 * Item reconciliation's reads and writes (issue #35; rules: shared/rules/admin/reconcile.ts): what
 * every holder in the database holds, the activity rows since the last run, and the runs. Plain
 * functions taking the `Db` first; the caller owns the transaction, so a run reads one consistent
 * database.
 */
import {
  activityChange,
  addCount,
  addFlow,
  BAG_SLOTS,
  COUNTED_ACTIVITY_TYPES,
  type CountMap,
  CURRENCY_KEY,
  countedPile,
  type FlowMap,
  isActivityType,
  NOTHING,
  parseNpcFile,
  RECONCILE_ROWS_MAX,
  RECONCILE_RUNS_KEPT,
  type ReconcileItem,
  type ReconcileRunView,
  reconcileFlagged,
  reconcileKey,
} from "@secondstaronline/shared";

import type { Db } from "./database.ts";

/** Adds `count` copies of a stored name to `m` (the currency under `CURRENCY_KEY`). */
function countStored(m: CountMap, stored: string, count: number, currency: string): void {
  const c = countedPile(stored, count);
  if (c === null) {
    return;
  }
  if ("gold" in c) {
    addCount(m, CURRENCY_KEY, currency, c.gold);
  } else {
    addCount(m, reconcileKey(c.item), c.item, c.n);
  }
}

/**
 * Everything the database holds, by item, with the currency under `CURRENCY_KEY`: bags, worn gear,
 * gold in hand, the bank, personal vaults, named containers (house and guild vaults, chests,
 * crates, cabinets and Cauldrons), the ground of every map, player shops' stock and tills, and
 * the vehicles characters ride (a parked one is on the ground). Stakes held at a blackjack table
 * are taken off the gold: the saved purse counts them, but the log spent them at the bid.
 */
export function countHoldings(db: Db, currency: string): CountMap {
  const m: CountMap = new Map();
  // Each holder is grouped by item in SQL: what reaches the game thread is one row per distinct
  // name, not one per copy.
  for (const r of db
    .query<{ item: string; n: number }, [number]>(
      "SELECT item, SUM(qty) AS n FROM inventory WHERE slot BETWEEN 1 AND ? GROUP BY item",
    )
    .all(BAG_SLOTS)) {
    countStored(m, r.item, r.n, currency);
  }
  for (const r of db
    .query<{ item: string; n: number }, [string]>(
      "SELECT item, COUNT(*) AS n FROM equipment WHERE item != ? GROUP BY item",
    )
    .all(NOTHING)) {
    countStored(m, r.item, r.n, currency);
  }
  for (const r of db
    .query<{ vehicle: string; n: number }, []>(
      "SELECT vehicle, COUNT(*) AS n FROM characters WHERE vehicle IS NOT NULL GROUP BY vehicle",
    )
    .all()) {
    addCount(m, reconcileKey(r.vehicle), r.vehicle, r.n);
  }
  const sum = (sql: string) => db.query<{ n: number | null }, []>(sql).get()?.n ?? 0;
  addCount(m, CURRENCY_KEY, currency, sum("SELECT SUM(gold) AS n FROM characters"));
  addCount(m, CURRENCY_KEY, currency, sum("SELECT SUM(balance) AS n FROM bank_accounts"));
  addCount(m, CURRENCY_KEY, currency, -sum("SELECT SUM(gold) AS n FROM casino_holds"));
  for (const sql of [
    "SELECT item, COUNT(*) AS n FROM vault_items GROUP BY item",
    "SELECT item, COUNT(*) AS n FROM container_items GROUP BY item",
    "SELECT item, SUM(qty) AS n FROM ground_items GROUP BY item",
  ]) {
    for (const r of db.query<{ item: string; n: number }, []>(sql).all()) {
      countStored(m, r.item, r.n, currency);
    }
  }
  const shops = playerShopStock(db);
  addCount(m, CURRENCY_KEY, currency, shops.till);
  for (const [item, n] of shops.stock) {
    countStored(m, item, n, currency);
  }
  return m;
}

/**
 * The stock and tills of the player shops: each shop's saved ledger, or its NPC file's own lines
 * while it has none. Three joined queries, matching names exactly (as `loadShop` does), so each
 * uses its table's key.
 */
export function playerShopStock(db: Db): { till: number; stock: [string, number][] } {
  const stock: [string, number][] = [];
  let till = 0;
  const saved = new Map(
    db
      .query<{ npc: string; gold: number | null }, []>(
        "SELECT n.npc AS npc, n.gold AS gold FROM npc_shops n JOIN player_shops s ON n.npc = s.npc",
      )
      .all()
      .map((r) => [r.npc, r.gold]),
  );
  for (const r of db
    .query<{ item: string; n: number }, []>(
      `SELECT l.item AS item, SUM(l.stock) AS n FROM npc_shop_lines l
       JOIN player_shops s ON l.npc = s.npc
       WHERE l.kind = 'SEL' AND l.stock IS NOT NULL GROUP BY l.item`,
    )
    .all()) {
    stock.push([r.item, r.n]);
  }
  for (const s of db
    .query<{ npc: string; text: string | null }, []>(
      "SELECT s.npc AS npc, f.text AS text FROM player_shops s LEFT JOIN npc_files f ON f.npc = s.npc",
    )
    .all()) {
    const file = s.text === null ? null : parseNpcFile(s.npc, s.text);
    if (saved.has(s.npc)) {
      till += saved.get(s.npc) ?? file?.gold ?? 0;
      continue;
    }
    // No ledger saved yet: the file's own lines are its stock and till.
    till += file?.gold ?? 0;
    for (const l of file?.sells ?? []) {
      if (l.stock !== null && l.stock !== 0) {
        stock.push([l.item, l.stock]);
      }
    }
  }
  return { till, stock };
}

/** The newest activity row's `seq` (0 with none). */
export function lastActivitySeq(db: Db): number {
  return db.query<{ n: number | null }, []>("SELECT MAX(seq) AS n FROM activity_log").get()?.n ?? 0;
}

/** A number held in a row's details under `key`, or 0 (a missing or non-numeric detail). */
const detail = (key: string) =>
  `CASE WHEN json_type(details, '$.${key}') IN ('integer', 'real') THEN json_extract(details, '$.${key}') ELSE 0 END`;

/** The details `activityChange` reads, summed in SQL. */
const DETAIL_KEYS = ["placed", "placedGold", "stored", "vault", "bank", "lost"] as const;

/**
 * What the activity rows after `afterSeq`, up to `toSeq`, made, ended and changed unlogged. The
 * rows are summed in SQL, by type, item and the signs of their changes (so a total made and a
 * total ended stay apart), and only those sums reach the game thread: `activityChange` is linear
 * in a row's numbers, so it gives a group's change from its sums.
 */
export function activityFlows(db: Db, afterSeq: number, toSeq: number, currency: string): FlowMap {
  const m: FlowMap = new Map();
  const types = COUNTED_ACTIVITY_TYPES;
  const itemDetails = `(${detail("placed")} + ${detail("stored")} + ${detail("vault")} - ${detail("lost")})`;
  const goldDetails = `(${detail("placedGold")} + ${detail("bank")})`;
  const groups = db
    .query<
      {
        type: string;
        item: string | null;
        monster: number;
        qty: number;
        gold: number;
        placed: number;
        placedGold: number;
        stored: number;
        vault: number;
        bank: number;
        lost: number;
      },
      (string | number)[]
    >(
      `SELECT type, item,
         CASE WHEN json_extract(details, '$.as') = 'monster' THEN 1 ELSE 0 END AS monster,
         SUM(qty) AS qty, SUM(gold) AS gold,
         ${DETAIL_KEYS.map((k) => `SUM(${detail(k)}) AS ${k}`).join(", ")}
       FROM activity_log
       WHERE seq > ? AND seq <= ? AND type IN (${types.map(() => "?").join(", ")})
       GROUP BY type, item, monster, SIGN(qty), SIGN(gold), SIGN(${itemDetails}),
         SIGN(${goldDetails})`,
    )
    .all(afterSeq, toSeq, ...types);
  for (const g of groups) {
    if (!isActivityType(g.type)) {
      continue;
    }
    const details: Record<string, string | number | boolean> = {};
    for (const k of DETAIL_KEYS) {
      if (g[k] !== 0) {
        details[k] = g[k];
      }
    }
    if (g.monster === 1) {
      details.as = "monster";
    }
    const c = activityChange({ type: g.type, qty: g.qty, gold: g.gold, details });
    addFlow(m, CURRENCY_KEY, currency, c.gold, c.unlogged);
    if (g.item !== null && c.item !== 0) {
      // A row names an item as the bag shows it; a pile's name counts what the pile holds.
      const p = countedPile(g.item);
      if (p === null) {
        continue;
      }
      if ("gold" in p) {
        addFlow(m, CURRENCY_KEY, currency, c.item * p.gold, c.unlogged);
      } else {
        addFlow(m, reconcileKey(p.item), p.item, c.item * p.n, c.unlogged);
      }
    }
  }
  return m;
}

export interface StoredRun {
  id: string;
  at: string;
  by: string | null;
  lastSeq: number;
  baseline: boolean;
  items: number;
  mismatches: number;
}

interface RunRow {
  id: string;
  created_at: string;
  by_name: string | null;
  last_seq: number;
  baseline: number;
  items: number;
  mismatches: number;
}

const toRun = (r: RunRow): StoredRun => ({
  id: r.id,
  at: r.created_at,
  by: r.by_name,
  lastSeq: r.last_seq,
  baseline: r.baseline === 1,
  items: r.items,
  mismatches: r.mismatches,
});

/** The newest runs, newest first. */
export function recentRuns(db: Db, limit: number): StoredRun[] {
  return db
    .query<RunRow, [number]>(
      `SELECT id, created_at, by_name, last_seq, baseline, items, mismatches FROM reconcile_runs
       ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .all(limit)
    .map(toRun);
}

/** A run's actual counts, by key: the next run's baseline. */
export function runCounts(db: Db, runId: string): CountMap {
  const m: CountMap = new Map();
  for (const r of db
    .query<{ item_key: string; item: string; actual: number }, [string]>(
      "SELECT item_key, item, actual FROM reconcile_items WHERE run_id = ?",
    )
    .all(runId)) {
    m.set(r.item_key, { item: r.item, n: r.actual });
  }
  return m;
}

/** Writes a run and its lines, then forgets the runs past the newest `RECONCILE_RUNS_KEPT`. */
export function insertRun(db: Db, run: StoredRun, items: readonly ReconcileItem[]): void {
  db.query(
    `INSERT INTO reconcile_runs (id, created_at, by_name, last_seq, baseline, items, mismatches)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(run.id, run.at, run.by, run.lastSeq, run.baseline ? 1 : 0, run.items, run.mismatches);
  const ins = db.prepare(
    `INSERT INTO reconcile_items (run_id, item_key, item, baseline, made, ended, unlogged,
       expected, actual, difference) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const i of items) {
    ins.run(
      run.id,
      i.currency ? CURRENCY_KEY : reconcileKey(i.item),
      i.item,
      i.baseline,
      i.made,
      i.ended,
      i.unlogged,
      i.expected,
      i.actual,
      i.difference,
    );
  }
  db.query(
    `DELETE FROM reconcile_runs WHERE id NOT IN (
       SELECT id FROM reconcile_runs ORDER BY created_at DESC, id DESC LIMIT ?)`,
  ).run(RECONCILE_RUNS_KEPT);
}

/** A run as the page shows it: its flagged lines, biggest first, at most `RECONCILE_ROWS_MAX`. */
export function runView(db: Db, run: StoredRun): ReconcileRunView {
  const rows = db
    .query<
      {
        item_key: string;
        item: string;
        baseline: number;
        made: number;
        ended: number;
        unlogged: number;
        expected: number;
        actual: number;
        difference: number;
      },
      [string]
    >(
      `SELECT item_key, item, baseline, made, ended, unlogged, expected, actual, difference
       FROM reconcile_items WHERE run_id = ? AND (difference != 0 OR unlogged != 0)
       ORDER BY ABS(difference) DESC, ABS(unlogged) DESC, item`,
    )
    .all(run.id)
    .map(
      (r): ReconcileItem => ({
        item: r.item,
        currency: r.item_key === CURRENCY_KEY,
        baseline: r.baseline,
        made: r.made,
        ended: r.ended,
        unlogged: r.unlogged,
        expected: r.expected,
        actual: r.actual,
        difference: r.difference,
      }),
    )
    .filter(reconcileFlagged);
  return {
    id: run.id,
    at: run.at,
    by: run.by,
    baseline: run.baseline,
    items: run.items,
    mismatches: run.mismatches,
    rows: rows.slice(0, RECONCILE_ROWS_MAX),
    more: Math.max(0, rows.length - RECONCILE_ROWS_MAX),
  };
}

/** The blackjack stakes held now, by character: the table is rewritten whole. */
export function saveCasinoHolds(db: Db, holds: ReadonlyMap<string, number>): void {
  db.query("DELETE FROM casino_holds").run();
  const ins = db.prepare("INSERT INTO casino_holds (character_id, gold) VALUES (?, ?)");
  for (const [id, gold] of holds) {
    if (gold > 0) {
      ins.run(id, gold);
    }
  }
}

/** The stakes a crash left held, with their owners, and the table emptied. */
export function takeCasinoHolds(
  db: Db,
): { characterId: string; accountId: string; name: string; gold: number }[] {
  const rows = db
    .query<{ characterId: string; accountId: string; name: string; gold: number }, []>(
      `SELECT h.character_id AS characterId, c.account_id AS accountId, c.name AS name,
         h.gold AS gold
       FROM casino_holds h JOIN characters c ON c.id = h.character_id ORDER BY h.character_id`,
    )
    .all();
  db.query("DELETE FROM casino_holds").run();
  return rows;
}
