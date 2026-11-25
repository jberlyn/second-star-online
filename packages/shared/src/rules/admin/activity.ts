/**
 * The player activity log (issue #25): what each player did with items and gold, who they fought,
 * how they progressed and when they came and went, so admins can trace abuse, exploits and
 * real-money trading. 1.6 logged none of it on the server. These are its shared rules: the event
 * types, the row the Control Panel reads and the query limits. Pure.
 *
 * Each row is one character's view of one event. `qty` and `gold` are signed changes to what that
 * character carries (bag, worn gear and gold in hand): a sale is `qty -1, gold +40`, a bank
 * deposit `gold -500`. A trade or a give is written once for each side. Items are recorded by name
 * and quantity, not by individual copy.
 *
 * A world event (an item decaying on the ground, a quest chest refilled, a house demolished, a
 * plant regrown) has no character: its `qty` and `gold` are the change to what exists. How each
 * type counts towards what exists is in reconcile.ts (issue #35).
 */

/** The event types, by group, in the order the Control Panel's filter lists them. */
export const ACTIVITY_GROUPS = {
  items: [
    /** A trade window that both sides accepted: one row per item line and one for gold, per side. */
    "trade",
    /** Dropped on the ground. */
    "drop",
    /** Picked up from the ground; `other` is the player who dropped it, when one did. */
    "pickup",
    /** Given to a player who stood in front (1.6's give: dropped, then grabbed by the target). */
    "give",
    /** Bought from an NPC's shop; `other` is the NPC. */
    "buy",
    /** Sold to an NPC's shop. */
    "sell",
    /** Bought from or sold to a player's shop; `other` is the shop's owner when known. */
    "playerShop",
    /** Gold put in or taken out of the bank. */
    "bank",
    /** Items put in or taken out of the personal vault. */
    "vault",
    /** Items put in or taken out of a house chest, cabinet, crate or Cauldron; `other` names it. */
    "container",
    /** Made at a workbench: what went in (negative) and what came out (positive). */
    "craft",
    /** Gathered: chopped, mined, fished or dug up, onto the ground (`details.placed`). */
    "gather",
    /** Loot a kill left on the ground (`details.placed`), credited to the killer. */
    "loot",
    /** Made by a spell (Create Food). */
    "spell",
    /** Used up: eaten, drunk, read, cast from, fired or spent by the item's own action. */
    "use",
    /** Paid to an NPC or the game for a service: training, spells, rent, art, a deed, a fee. */
    "pay",
    /** Given by an NPC or the game: a quest reward, a prize, a refund. */
    "reward",
    /** Bet or won at the casino. */
    "casino",
    /** Dropped or lost at a death. */
    "deathDrop",
    /** Changed into another item in the bag (a key cut, a crate filled, a boat launched). */
    "transform",
    /** Created or removed by an admin (`/drop`, the character editor). */
    "admin",
    /** A world event: an item on the ground decayed (its loot time ran out). No character. */
    "decay",
    /** A world event: the periodic save put an item in a quest chest. No character. */
    "refill",
    /**
     * A world event: a demolished house took what was in it, its vault, items, shop stock and till.
     * No character.
     */
    "demolish",
    /** A world event: a regrown plant produced an item on the ground. No character. */
    "regrow",
    /**
     * A change to what a character carries that no event explained: a missed source or sink in
     * the code, or a dupe. Written by the server's own check, so nothing goes unrecorded.
     */
    "unlogged",
  ],
  combat: [
    /** Killed a monster; `other` is the monster. */
    "kill",
    /** Killed a player; `other` is the victim. */
    "playerKill",
    /** Died; `other` is the killer, a player or a monster, or null. */
    "death",
  ],
  progression: [
    /** Reached a new level. */
    "level",
    /** A skill reached a new level. */
    "skill",
    /** A quest hand-in to an NPC: the item given and the reward. */
    "quest",
    /** Changed class: a promotion at a trainer or an admin's `/setclass`. */
    "class",
  ],
  session: [
    /** Logged in or resumed a dropped session, with the address. */
    "login",
    /** Logged out or dropped. */
    "logout",
    /** Moved to another map: an edge, a door, a warp, a spell or a death. */
    "map",
  ],
} as const;

export type ActivityGroup = keyof typeof ACTIVITY_GROUPS;
export type ActivityType = (typeof ACTIVITY_GROUPS)[ActivityGroup][number];

export const ACTIVITY_TYPES: readonly ActivityType[] = Object.values(ACTIVITY_GROUPS).flat();

const TYPE_SET: ReadonlySet<string> = new Set(ACTIVITY_TYPES);

export function isActivityType(s: string): s is ActivityType {
  return TYPE_SET.has(s);
}

/** The group a type is filed under. */
export function activityGroup(t: ActivityType): ActivityGroup {
  for (const [g, types] of Object.entries(ACTIVITY_GROUPS)) {
    if ((types as readonly string[]).includes(t)) {
      return g as ActivityGroup;
    }
  }
  return "items";
}

export const ACTIVITY_GROUP_LABELS: Readonly<Record<ActivityGroup, string>> = {
  items: "Items and gold",
  combat: "Combat",
  progression: "Progression",
  session: "Sessions",
};

export const ACTIVITY_TYPE_LABELS: Readonly<Record<ActivityType, string>> = {
  trade: "Trade",
  drop: "Drop",
  pickup: "Pick up",
  give: "Give",
  buy: "Shop buy",
  sell: "Shop sell",
  playerShop: "Player shop",
  bank: "Bank",
  vault: "Vault",
  container: "Container",
  craft: "Craft",
  gather: "Gather",
  loot: "Loot",
  spell: "Spell",
  use: "Use",
  pay: "Pay",
  reward: "Reward",
  casino: "Casino",
  deathDrop: "Death drop",
  transform: "Transform",
  admin: "Admin",
  decay: "Decay",
  refill: "Chest refill",
  demolish: "Demolished",
  regrow: "Regrowth",
  unlogged: "Unlogged change",
  kill: "Kill",
  playerKill: "Player kill",
  death: "Death",
  level: "Level",
  skill: "Skill",
  quest: "Quest",
  class: "Class",
  login: "Login",
  logout: "Logout",
  map: "Map change",
};

/** One logged event, as the Control Panel reads it. */
export interface ActivityRow {
  /** The row's id (a UUIDv7): pages ask for rows before it. */
  id: string;
  /** ISO time, UTC. */
  at: string;
  type: ActivityType;
  /** The character, or null for a world event. */
  character: string | null;
  /** The other party: a player (`otherIsPlayer`), an NPC, a monster or a container; or null. */
  other: string | null;
  otherIsPlayer: boolean;
  item: string | null;
  /** Signed change to what `character` carries. */
  qty: number;
  gold: number;
  map: string | null;
  x: number | null;
  y: number | null;
  /** Type-specific facts: an address, a level, a skill, the map left, why. */
  details: Record<string, string | number | boolean> | null;
}

/** Rows a page of the timeline or item flow shows, and the most a request may ask for. */
export const ACTIVITY_PAGE = 100;
export const ACTIVITY_PAGE_MAX = 500;

/** The most events an item's totals add up (newest first), so a busy item cannot stall a tick. */
export const ACTIVITY_TOTALS_MAX = 20_000;

/** Longest name or item a query may carry. */
export const ACTIVITY_QUERY_MAX = 40;

/** One line of an item's totals: of one type, how many players gained and lost, over how many rows. */
export interface ActivityTotal {
  type: ActivityType;
  gained: number;
  lost: number;
  rows: number;
}

/**
 * The line a row reads as in the timeline: what moved and with whom, such as
 * `-2 Steel Sword, +80 gold with Tracy` or `Level 12`.
 */
export function activitySummary(r: ActivityRow): string {
  const parts: string[] = [];
  if (r.item !== null && r.qty !== 0) {
    parts.push(`${r.qty > 0 ? "+" : ""}${r.qty} ${r.item}`);
  } else if (r.item !== null) {
    parts.push(r.item);
  }
  if (r.gold !== 0) {
    parts.push(`${r.gold > 0 ? "+" : ""}${r.gold} gold`);
  }
  // Put on the ground or lost, not carried: loot, gathering, an admin's drop, a full bag.
  const d0 = r.details ?? {};
  if (typeof d0.placed === "number") {
    parts.push(d0.placed < 0 ? `${-d0.placed} removed` : `${d0.placed} placed`);
  }
  if (typeof d0.placedGold === "number") {
    parts.push(
      d0.placedGold < 0 ? `${-d0.placedGold} gold removed` : `${d0.placedGold} gold placed`,
    );
  }
  if (typeof d0.stored === "number") {
    parts.push(d0.stored < 0 ? `${-d0.stored} used up in storage` : `${d0.stored} made in storage`);
  }
  if (typeof d0.lost === "number") {
    parts.push(`${d0.lost} lost (no room)`);
  }
  const d = r.details ?? {};
  switch (r.type) {
    case "login":
      parts.push(`${d.resumed ? "resumed from" : "from"} ${d.ip || "an unknown address"}`);
      break;
    case "logout":
      if (d.ip) {
        parts.push(`from ${d.ip}`);
      }
      break;
    case "map":
      parts.push(`${d.from ?? "?"} → ${r.map ?? "?"}${d.via ? ` (${d.via})` : ""}`);
      break;
    case "level":
      parts.push(`Level ${d.level ?? "?"}`);
      break;
    case "skill":
      parts.push(`${d.skill ?? "Skill"} ${d.level ?? "?"}`);
      break;
    case "quest":
      if (r.item === null) {
        parts.push(String(d.step ?? ""));
      }
      break;
    case "class":
      parts.push(`${d.from ?? "?"} → ${d.to ?? "?"}`);
      break;
    default:
      break;
  }
  const head = parts.filter((s) => s !== "").join(", ");
  const tail = r.other === null ? "" : `${head === "" ? "" : " "}${otherWord(r.type)} ${r.other}`;
  return `${head}${tail}`;
}

function otherWord(t: ActivityType): string {
  switch (t) {
    case "death":
      return "killed by";
    case "kill":
    case "playerKill":
      return "killed";
    case "pickup":
      return "dropped by";
    case "container":
      return "in";
    case "buy":
    case "playerShop":
      return "from";
    case "sell":
      return "to";
    default:
      return "with";
  }
}
