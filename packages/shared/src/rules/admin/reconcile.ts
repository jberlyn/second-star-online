/**
 * Item reconciliation (issue #35): the activity log's rows compared with what exists. A run counts
 * every copy of every item, and the gold, wherever it is held, and compares the count with what the
 * log says it should be: the last run's count, plus what was made since, less what ended. A
 * difference is a source or sink the log missed, or a dupe. Pure.
 *
 * Each activity type counts in one of three ways:
 *
 * - **Moves** change where an item is, not how many exist: a trade, a give, a drop and a pickup, a
 *   player shop sale (the stock and till are counted), the bank, the vault, a container, and a
 *   death drop that stays on the ground.
 * - **Makes and ends** change how many exist by their signed `qty` and `gold`: NPC shops, rewards
 *   and payments, using up, spells, crafting, quests, the casino, admins, and the world events.
 * - **Unlogged** rows (the server's own check) are kept out of what is expected and shown beside
 *   it, so a dupe still shows as a difference, with the unexplained change next to it.
 *
 * Whatever the type, a row's details can add to it: `placed` (and `placedGold`) were made on the
 * ground, not carried (loot, gathering, a faction head, `/drop`); `stored` were made or used up in
 * a container (a Cauldron's brew); `vault` and `bank` an admin changed there; and `lost`, on a
 * move, ended with nobody carrying them (a pickup into a full bag, a vehicle lost at a death). On
 * a make, `lost` is an item never made (a prize with no room in the bag), so it does not count. A row marked
 * `as: "monster"` turned a monster into an item, or an item into a monster (a Pig), so its `qty`
 * counts though it is a pickup or a drop.
 */
import { engineFixtureKind } from "../core/fixtures.ts";
import { isDoorOrSwitch } from "../housing/doors.ts";
import { crystalPile, displayName, isGoldName, leadingInteger } from "../inventory/inventory.ts";
import { standName } from "../mail/newspaper.ts";
import { vehicleOfItem } from "../vehicles/vehicles.ts";
import type { ActivityType } from "./activity.ts";

/** How a type counts towards what exists. `none`: it moves no item or gold. */
export type ActivityCount = "move" | "make" | "unlogged" | "none";

export const ACTIVITY_COUNTS: Readonly<Record<ActivityType, ActivityCount>> = {
  trade: "move",
  drop: "move",
  pickup: "move",
  give: "move",
  buy: "make",
  sell: "make",
  playerShop: "move",
  bank: "move",
  vault: "move",
  container: "move",
  craft: "make",
  gather: "make",
  loot: "make",
  spell: "make",
  use: "make",
  pay: "make",
  reward: "make",
  casino: "make",
  deathDrop: "move",
  transform: "make",
  admin: "make",
  decay: "make",
  refill: "make",
  demolish: "make",
  regrow: "make",
  unlogged: "unlogged",
  kill: "none",
  playerKill: "none",
  death: "none",
  level: "none",
  skill: "none",
  quest: "make",
  class: "none",
  login: "none",
  logout: "none",
  map: "none",
};

/** The types a run reads: every type that can change what exists. */
export const COUNTED_ACTIVITY_TYPES: readonly ActivityType[] = (
  Object.keys(ACTIVITY_COUNTS) as ActivityType[]
).filter((t) => ACTIVITY_COUNTS[t] !== "none");

/** The world events: rows with no character. */
export const WORLD_ACTIVITY_TYPES = [
  "decay",
  "refill",
  "demolish",
  "regrow",
] as const satisfies readonly ActivityType[];
export type WorldActivityType = (typeof WORLD_ACTIVITY_TYPES)[number];

/** What a run reads of a row. */
export interface CountedRow {
  type: ActivityType;
  qty: number;
  gold: number;
  details: Readonly<Record<string, string | number | boolean>> | null;
}

/** A row's change to how many of its item, and how much gold, exist. */
export interface ActivityChange {
  item: number;
  gold: number;
  /** An `unlogged` row: its change is shown beside what is expected, not in it. */
  unlogged: boolean;
}

/** How a row changes what exists (0 for a move: the item is still somewhere). */
export function activityChange(r: CountedRow): ActivityChange {
  const how = ACTIVITY_COUNTS[r.type];
  if (how === "none") {
    return { item: 0, gold: 0, unlogged: false };
  }
  if (how === "unlogged") {
    return { item: r.qty, gold: r.gold, unlogged: true };
  }
  const d = r.details ?? {};
  const n = (k: string): number => {
    const v = d[k];
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
  };
  const counts = how === "make" || d.as === "monster";
  // `lost` on a move is an existing item destroyed; on a make (a prize that found no room) it is
  // an item never made, already left out of `qty`.
  const lost = how === "move" ? n("lost") : 0;
  return {
    item: (counts ? r.qty : 0) + n("placed") + n("stored") + n("vault") - lost,
    gold: (counts ? r.gold : 0) + n("placedGold") + n("bank"),
    unlogged: false,
  };
}

/** What a stored name counts as: an amount of the currency, or `n` of one item. */
export type Counted = { gold: number } | { item: string; n: number };

/**
 * What `count` copies of a stored name count as, or null for a name that is not counted: a pile of
 * the currency (`15 Gold`) is gold; a crystal pile (`5 Blue Crystal`) is that many crystals; a
 * parked vehicle (`Bob's Airship`) is one of its kind (`Airship`), as is a character riding one;
 * a container's `#id` is left off (`Crate#12` is a `Crate`). The engine's other fixtures (doors,
 * mailboxes, house and guild vaults, newspaper stands, exits, signs) and the doors and switches that keys and switches
 * rename in place are not items, and are not counted.
 */
export function countedPile(stored: string, count = 1): Counted | null {
  const name = stored.trim();
  if (name === "" || count === 0) {
    return null;
  }
  if (isGoldName(name)) {
    return { gold: leadingInteger(name) * count };
  }
  const vehicle = vehicleOfItem(name);
  if (vehicle) {
    return { item: vehicle, n: count };
  }
  if (engineFixtureKind(name) !== null || isDoorOrSwitch(name) || isStand(name)) {
    return null;
  }
  const pile = crystalPile(name);
  if (pile) {
    return { item: pile.item, n: pile.qty * count };
  }
  return { item: displayName(name), n: count };
}

/**
 * A newspaper stand (`<owner>'s Newspaper`): like a mailbox, an owned fixture the engine names,
 * not an item (content-world.ts `OWNED_FIXTURE`).
 */
function isStand(name: string): boolean {
  const suffix = standName("").toLowerCase();
  return name.length > suffix.length && name.toLowerCase().endsWith(suffix);
}

/** The key the currency is counted under (no item has an empty name). */
export const CURRENCY_KEY = "";

/** An item's key: its name without regard to case. */
export function reconcileKey(item: string): string {
  return item.toLowerCase();
}

/** One item's line in a run. */
export interface ReconcileItem {
  /** The item's name, or the currency's. */
  item: string;
  /** The currency (gold), counted wherever it is held. */
  currency: boolean;
  /** The last run's actual count. */
  baseline: number;
  /** Made and ended since the last run (each a total, not net). */
  made: number;
  ended: number;
  /** The net change of `unlogged` rows since the last run, kept out of `expected`. */
  unlogged: number;
  expected: number;
  actual: number;
  /** `actual - expected`: a source or sink the log missed, or a dupe. */
  difference: number;
}

/** A count by key, with the name to show. */
export type CountMap = Map<string, { item: string; n: number }>;

/** What the log says since the last run, by key. */
export type FlowMap = Map<string, { item: string; made: number; ended: number; unlogged: number }>;

/** Adds `n` of `item` (or the currency, `CURRENCY_KEY`) to a count. */
export function addCount(m: CountMap, key: string, item: string, n: number): void {
  if (n === 0) {
    return;
  }
  const e = m.get(key);
  if (e) {
    e.n += n;
  } else {
    m.set(key, { item, n });
  }
}

/** Adds one row's change to the flows. */
export function addFlow(m: FlowMap, key: string, item: string, n: number, unlogged: boolean): void {
  if (n === 0) {
    return;
  }
  let e = m.get(key);
  if (!e) {
    e = { item, made: 0, ended: 0, unlogged: 0 };
    m.set(key, e);
  }
  if (unlogged) {
    e.unlogged += n;
  } else if (n > 0) {
    e.made += n;
  } else {
    e.ended -= n;
  }
}

/**
 * Each item's line: expected is the baseline plus made less ended; the difference is actual less
 * expected. With no baseline (the first run) the actual count is the baseline and nothing is
 * compared. Items that are nowhere and moved nowhere are left out. Ordered by the size of the
 * difference, then the unlogged change, then name.
 */
export function reconcileItems(
  baseline: CountMap | null,
  flows: FlowMap,
  actual: CountMap,
  currencyName: string,
): ReconcileItem[] {
  const keys = new Set([...(baseline?.keys() ?? []), ...flows.keys(), ...actual.keys()]);
  const out: ReconcileItem[] = [];
  for (const key of keys) {
    const a = actual.get(key)?.n ?? 0;
    const f = baseline ? flows.get(key) : undefined;
    const base = baseline ? (baseline.get(key)?.n ?? 0) : a;
    const made = f?.made ?? 0;
    const ended = f?.ended ?? 0;
    const unlogged = f?.unlogged ?? 0;
    const expected = base + made - ended;
    if (base === 0 && made === 0 && ended === 0 && unlogged === 0 && a === 0) {
      continue;
    }
    const currency = key === CURRENCY_KEY;
    out.push({
      item: currency
        ? currencyName
        : (actual.get(key)?.item ?? flows.get(key)?.item ?? baseline?.get(key)?.item ?? key),
      currency,
      baseline: base,
      made,
      ended,
      unlogged,
      expected,
      actual: a,
      difference: a - expected,
    });
  }
  return out.sort(
    (x, y) =>
      Math.abs(y.difference) - Math.abs(x.difference) ||
      Math.abs(y.unlogged) - Math.abs(x.unlogged) ||
      x.item.localeCompare(y.item),
  );
}

/** Whether a line belongs in the portal's list: a difference, or an unlogged change. */
export function reconcileFlagged(r: ReconcileItem): boolean {
  return r.difference !== 0 || r.unlogged !== 0;
}

/** One run as the Activity Log page shows it. */
export interface ReconcileRunView {
  id: string;
  /** ISO time, UTC. */
  at: string;
  /** Who ran it from the page, or null for the nightly run. */
  by: string | null;
  /** The first run: it only took the baseline. */
  baseline: boolean;
  /** Items counted. */
  items: number;
  /** Items whose expected and actual counts differ. */
  mismatches: number;
  /** The flagged lines (`reconcileFlagged`), at most `RECONCILE_ROWS_MAX`, biggest first. */
  rows: ReconcileItem[];
  /** Flagged lines left out past the cap. */
  more: number;
}

/** The runs the page shows (newest first), and the lines each may send. */
export const RECONCILE_RUNS_SHOWN = 5;
export const RECONCILE_ROWS_MAX = 200;

/** The runs kept in the database (the newest); older ones are deleted. */
export const RECONCILE_RUNS_KEPT = 90;

/** The nightly run starts at the first tick after this hour, UTC, once a day. */
export const RECONCILE_NIGHTLY_HOUR = 4;

/** The time of the latest nightly run due at `nowMs`: today's at the hour, or yesterday's. */
export function nightlyDue(nowMs: number, hour = RECONCILE_NIGHTLY_HOUR): number {
  const d = new Date(nowMs);
  const today = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour);
  return today <= nowMs ? today : today - 86_400_000;
}
