/**
 * The activity log's write side (issue #25; rules: shared/rules/admin/activity.ts). Each system that
 * moves a player's items or gold, or decides a kill, a death, a level or a map change, appends one
 * entry per change to `world.activity` at the point it decides it. The game stamps the time and
 * writes the buffer to `activity_log` once a tick (persistence/activity.ts), so an event costs the
 * tick no SQL.
 *
 * - `qty` and `gold` are signed changes to what the character carries: the bag, worn gear and gold
 *   in hand. The bank, the vault and containers are other places, so a deposit is a loss here.
 * - Items are named as the bag shows them (`displayName`: a container's `#id` is left off).
 *
 * The check: every player keeps a ledger of what the log says they carry (`p.activityHeld`). Each
 * logged change moves it, and `checkHoldings` compares it with what they really carry once a tick
 * and when they leave. A difference is a change no system logged, a missed source or sink or a
 * dupe, and is written as an `unlogged` event so the log never silently misses one.
 */
import {
  type ActivityType,
  type Bag,
  className,
  content,
  countedPile,
  displayName,
  type Equipment,
  isGoldName,
  leadingInteger,
  NOTHING,
  pileToItem,
} from "@secondstaronline/shared";

import type { Player, World } from "../world/world.ts";

/** One event for the activity log. */
export interface ActivityEntry {
  /** ISO time, set by the game when the event's intent or tick ends. */
  at?: string;
  type: ActivityType;
  /** Null for a world event (`logWorld`). */
  accountId: string | null;
  characterId: string | null;
  character: string | null;
  otherId: string | null;
  other: string | null;
  item: string | null;
  qty: number;
  gold: number;
  map: string | null;
  x: number | null;
  y: number | null;
  details: Record<string, string | number | boolean> | null;
}

/** What a character carries by item, by lowercased display name; gold under `GOLD`. */
export type Holdings = Map<string, number>;

const GOLD = "\u0000gold";

/** The other party: a player (linked by id), or the name of an NPC, monster or container. */
export type Party = Pick<Player, "id" | "name"> | string | null;

export interface ActivityFields {
  other?: Party;
  item?: string | null;
  qty?: number;
  gold?: number;
  details?: Record<string, string | number | boolean | null | undefined> | null;
  /**
   * Where it happened, when not where the player stands (a map change logs the new map; a World
   * Editor save names only the map).
   */
  at?: { map: string; x: number | null; y: number | null };
}

/** A character who is not online: an offline winner's payout, a prize sent to their bag. */
export interface OfflineCharacter {
  id: string;
  accountId: string;
  name: string;
}

/**
 * Appends one event for `p`, moving their ledger by its `qty` and `gold`. An offline character has
 * no ledger and no place.
 */
export function logActivity(
  world: World,
  p: Player | OfflineCharacter,
  type: ActivityType,
  f: ActivityFields = {},
): void {
  const online = "char" in p ? p : null;
  const item = f.item ? displayName(f.item) : null;
  const qty = f.qty ?? 0;
  const gold = f.gold ?? 0;
  const held = online?.activityHeld;
  if (held) {
    if (item !== null && qty !== 0) {
      bump(held, keyOf(item), qty);
    }
    if (gold !== 0) {
      bump(held, GOLD, gold);
    }
  }
  const other = f.other ?? null;
  let details: ActivityEntry["details"] = null;
  if (f.details) {
    for (const [k, v] of Object.entries(f.details)) {
      if (v !== null && v !== undefined) {
        details ??= {};
        details[k] = v;
      }
    }
  }
  world.activity.push({
    type,
    accountId: p.accountId,
    characterId: p.id,
    character: p.name,
    otherId: typeof other === "object" && other !== null ? other.id : null,
    other: typeof other === "string" ? other : (other?.name ?? null),
    item,
    qty,
    gold,
    map: f.at ? f.at.map : (online?.map.name ?? null),
    x: f.at ? f.at.x : (online?.x ?? null),
    y: f.at ? f.at.y : (online?.y ?? null),
    details,
  });
}

/**
 * Logs a pile put on the ground for `p` but not carried by them (loot, a gathered drop, an admin's
 * `/drop`): `qty` stays 0 and `details.placed` (or `placedGold`) says how many.
 */
export function logPlaced(
  world: World,
  p: Player,
  type: ActivityType,
  pile: string,
  f: Omit<ActivityFields, "item" | "qty" | "gold"> & { count?: number } = {},
): void {
  const { count = 1, details, ...rest } = f;
  if (isGoldName(pile)) {
    const gold = leadingInteger(pile) * count;
    logActivity(world, p, type, { ...rest, details: { ...details, placedGold: gold } });
    return;
  }
  const { item, qty } = pileToItem(pile);
  logActivity(world, p, type, { ...rest, item, details: { ...details, placed: qty * count } });
}

/**
 * A world event with no character (issue #35): `count` copies of the stored name `pile` (a
 * pile of the currency counts as gold) made (`count` > 0) or ended (< 0), at `at`. A name that is
 * not counted (a door, an exit) logs nothing.
 */
export function logWorld(
  world: World,
  type: ActivityType,
  pile: string,
  count: number,
  f: { other?: string | null; at?: ActivityFields["at"]; details?: ActivityFields["details"] } = {},
): void {
  const c = countedPile(pile, count);
  if (c === null || ("gold" in c ? c.gold : c.n) === 0) {
    return;
  }
  let details: ActivityEntry["details"] = null;
  for (const [k, v] of Object.entries(f.details ?? {})) {
    if (v !== null && v !== undefined) {
      details ??= {};
      details[k] = v;
    }
  }
  world.activity.push({
    type,
    accountId: null,
    characterId: null,
    character: null,
    otherId: null,
    other: f.other ?? null,
    item: "gold" in c ? null : c.item,
    qty: "gold" in c ? 0 : c.n,
    gold: "gold" in c ? c.gold : 0,
    map: f.at?.map ?? null,
    x: f.at?.x ?? null,
    y: f.at?.y ?? null,
    details,
  });
}

/**
 * Logs each line of a change to stored lines (a container's, a vault's) as world events of
 * `type`: what `before` held that `after` does not ended, and the reverse was made.
 */
export function logWorldLines(
  world: World,
  type: ActivityType,
  before: readonly string[],
  after: readonly string[],
  f: Parameters<typeof logWorld>[4] = {},
): void {
  for (const [pile, n] of diffLines(before, after)) {
    logWorld(world, type, pile, n, f);
  }
}

/** Each stored line whose count differs between `before` and `after`, with `after - before`. */
export function diffLines(before: readonly string[], after: readonly string[]): [string, number][] {
  const count = (lines: readonly string[]) => {
    const h = new Map<string, number>();
    for (const l of lines) {
      if (l !== "") {
        h.set(l, (h.get(l) ?? 0) + 1);
      }
    }
    return h;
  };
  return diffHoldings(count(before), count(after));
}

/**
 * A World Editor save: the net change in the map's placed items and gold, by name, logged for the
 * editor with `details.placed` (negative for removed). Unchanged placements log nothing.
 */
export function logEditorPlacements(
  world: World,
  p: Player,
  map: string,
  before: readonly { item: string; qty?: number }[],
  after: readonly { item: string; qty?: number }[],
): void {
  const count = (piles: readonly { item: string; qty?: number }[]) => {
    const h: Holdings = new Map();
    for (const g of piles) {
      if (isGoldName(g.item)) {
        bump(h, GOLD, leadingInteger(g.item) * (g.qty ?? 1));
      } else {
        const { item, qty } = pileToItem(g.item);
        bump(h, keyOf(item), qty * (g.qty ?? 1));
      }
    }
    return h;
  };
  for (const [key, n] of diffHoldings(count(before), count(after))) {
    const details = { via: "worldEditor" };
    logActivity(world, p, "admin", {
      at: { map, x: null, y: null },
      ...(key === GOLD
        ? { details: { ...details, placedGold: n } }
        : { item: nameOf(key), details: { ...details, placed: n } }),
    });
  }
}

/** A worn item changed in place (broken in a fight): the old one is lost, the new one gained. */
export function logTransform(
  world: World,
  p: Player,
  from: string,
  to: string,
  details: ActivityFields["details"] = null,
): void {
  logActivity(world, p, "transform", { item: from, qty: -1, details });
  if (to !== NOTHING) {
    logActivity(world, p, "transform", { item: to, qty: 1, details });
  }
}

/**
 * Logs each line of a bag change (`before` → `after`) as `type`, one event per item. `more` adds
 * details to an item's event, by its name and change.
 */
export function logBagChange(
  world: World,
  p: Player | OfflineCharacter,
  type: ActivityType,
  before: Holdings,
  after: Holdings,
  f: Omit<ActivityFields, "item" | "qty" | "gold"> = {},
  more?: (item: string, n: number) => ActivityFields["details"],
): void {
  for (const [key, n] of diffHoldings(before, after)) {
    if (key === GOLD) {
      logActivity(world, p, type, { ...f, gold: n });
    } else {
      const extra = more?.(nameOf(key), n);
      logActivity(world, p, type, {
        ...f,
        item: nameOf(key),
        qty: n,
        ...(extra ? { details: { ...f.details, ...extra } } : {}),
      });
    }
  }
}

/** What `p` carries now: bag lines, worn gear and gold. */
export function holdingsOf(c: { bag: Bag; equip: Equipment; gold: number }): Holdings {
  const h: Holdings = new Map();
  for (const l of c.bag) {
    if (l && l.qty !== 0) {
      bump(h, keyOf(l.item), l.qty);
    }
  }
  for (const v of Object.values(c.equip)) {
    if (v && v !== NOTHING) {
      bump(h, keyOf(v), 1);
    }
  }
  if (c.gold !== 0) {
    h.set(GOLD, c.gold);
  }
  return h;
}

/** Each key whose count differs, with `after - before`. */
export function diffHoldings(before: Holdings, after: Holdings): [string, number][] {
  const out: [string, number][] = [];
  for (const [k, n] of after) {
    const d = n - (before.get(k) ?? 0);
    if (d !== 0) {
      out.push([k, d]);
    }
  }
  for (const [k, n] of before) {
    if (!after.has(k) && n !== 0) {
      out.push([k, -n]);
    }
  }
  return out;
}

/**
 * Compares `p`'s ledger with what they carry and logs each difference as `unlogged`, then starts
 * the ledger again from what they carry. The first call (login) only starts it. Returns the
 * number of differences found.
 */
export function checkHoldings(world: World, p: Player): number {
  const now = holdingsOf(p.char);
  const held = p.activityHeld;
  p.activityHeld = now;
  if (!held) {
    return 0;
  }
  const diff = diffHoldings(held, now);
  // The ledger is already `now`, so these events must not move it again.
  p.activityHeld = undefined;
  for (const [key, n] of diff) {
    if (key === GOLD) {
      logActivity(world, p, "unlogged", { gold: n });
    } else {
      logActivity(world, p, "unlogged", { item: nameOf(key), qty: n });
    }
  }
  p.activityHeld = now;
  return diff.length;
}

/** The ledger starts again from what `p` carries now (login, and a test's setup). */
export function resetHoldings(p: Player): void {
  p.activityHeld = holdingsOf(p.char);
  p.activityProgress = progressOf(p);
}

/** A character's level, class and skill values, as last logged. */
export interface Progress {
  level: number;
  classCode: number;
  skills: number[];
}

function progressOf(p: Player): Progress {
  return { level: p.char.vitals.level, classCode: p.char.classCode, skills: [...p.char.skills] };
}

/**
 * Logs what changed in `p`'s level, class and skills since the last check: one `level` event per
 * check that raised the level, one `class` event, and a `skill` event for each skill that went up
 * (skills rise in many places, a hit, a cast, a craft, a book, so they are compared here once a
 * tick rather than logged at each). The first call only notes them.
 */
export function checkProgress(world: World, p: Player): void {
  const was = p.activityProgress;
  const now = p.char;
  if (
    was &&
    was.level === now.vitals.level &&
    was.classCode === now.classCode &&
    was.skills.every((v, i) => v === now.skills[i]) &&
    was.skills.length === now.skills.length
  ) {
    return;
  }
  p.activityProgress = progressOf(p);
  if (!was) {
    return;
  }
  if (now.vitals.level !== was.level) {
    logActivity(world, p, "level", {
      details: { level: now.vitals.level, from: was.level },
    });
  }
  if (now.classCode !== was.classCode) {
    logActivity(world, p, "class", {
      details: {
        from: className(was.classCode) ?? String(was.classCode),
        to: className(now.classCode) ?? String(now.classCode),
      },
    });
  }
  now.skills.forEach((v, i) => {
    const before = was.skills[i] ?? 0;
    if (v > before) {
      logActivity(world, p, "skill", {
        details: {
          skill: content().classes.skills[i]?.skill ?? `Skill ${i + 1}`,
          level: v,
          gained: v - before,
        },
      });
    }
  });
}

/** The once-a-tick check of one player: their holdings, then their progress. */
export function checkPlayer(world: World, p: Player): void {
  checkHoldings(world, p);
  checkProgress(world, p);
}

function bump(h: Holdings, key: string, n: number): void {
  const v = (h.get(key) ?? 0) + n;
  if (v === 0) {
    h.delete(key);
  } else {
    h.set(key, v);
  }
}

/**
 * The last spelling seen for each lowercased item key, so a difference names the item as the bag
 * did. Bounded by the number of item names in the game.
 */
const spelling = new Map<string, string>();

/** The ledger key for an item (names match without regard to case), noting its spelling. */
function keyOf(name: string): string {
  const shown = displayName(name);
  const key = shown.toLowerCase();
  if (spelling.get(key) !== shown) {
    spelling.set(key, shown);
  }
  return key;
}

function nameOf(key: string): string {
  return spelling.get(key) ?? key;
}
