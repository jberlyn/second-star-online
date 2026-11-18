/**
 * Monster loot and the death drop: which item, if any, goes on the ground.
 *
 * Implements the original's monster loot and the player death
 * drop).
 */

import type { Rng } from "../core/lingo.ts";
import type { Bag } from "../inventory/inventory.ts";

/** One `INV|<item>:<N>` line (the quantity is part of the name, "15 Gold"). */
export interface LootLine {
  item: string;
  oneIn: number;
}

/**
 * The server's two draws on the killed species' `INV|` lines, anywhere in its file (`NpcFile.loot`:
 * the NPC editor can change them): a line uniformly, then `random(N) = 1`. No draw when the species
 * has no file or no `INV|` line. Returns the ground name ("15 Gold").
 */
export function rollLoot(lines: readonly LootLine[] | null, rng: Rng): string | null {
  if (!lines || lines.length === 0) {
    return null;
  }
  const line = lines[rng.random(lines.length) - 1];
  if (!line) {
    return null;
  }
  return rng.random(line.oneIn) === 1 ? line.item : null;
}

/**
 * The six colours of crystal, one or a stack ("Blue Crystal", "Red Crystals"), by whole name
 * ignoring case; an item that only contains the word, such as a "Crystal Axe", is not one.
 */
export function isCrystal(item: string): boolean {
  return /^(blue|green|purple|red|white|yellow) crystals?$/i.test(item.trim());
}

export type DeathDrop =
  | { kind: "none" }
  /** One unit of bag line `slot` (0-based) goes on the death tile. */
  | { kind: "item"; slot: number }
  /** `amount` gold goes on the death tile as `"<amount> Gold"`. */
  | { kind: "gold"; amount: number };

/**
 * The drop draws of a non-arena death, in order: `random(2)` gold-or-item when gold > 0 (drawn even
 * with the death drop off); then, if it is on, the item branch `random(items)` over the bag's
 * non-crystal lines (drawn even in a vehicle) or the gold branch `random(gold)`, `random(200)` if
 * over 200, and again `random(gold)` when wanted.
 */
export function rollDeathDrop(
  who: { bag: Bag; gold: number; wanted: boolean; inVehicle: boolean },
  dropOnDeath: boolean,
  rng: Rng,
): DeathDrop {
  let gold = false;
  if (who.gold > 0) {
    gold = rng.random(2) === 1;
  }
  if (!dropOnDeath) {
    return { kind: "none" };
  }
  if (!gold) {
    // One of the bag's items at random, every line counting and crystals never (a bug fixed: 1.6
    // counted the filled lines among 1-8 and picked a line number up to that count, so it could
    // land on an empty line; its deliberate crystal exclusion is kept).
    const items = who.bag.flatMap((l, i) => (l !== null && !isCrystal(l.item) ? [i] : []));
    const slot = items[rng.random(items.length) - 1];
    if (slot === undefined || who.inVehicle) {
      return { kind: "none" };
    }
    return { kind: "item", slot };
  }
  if (who.inVehicle) {
    return { kind: "none" };
  }
  let amount = rng.random(who.gold);
  if (amount > 200) {
    amount = rng.random(200);
  }
  if (who.wanted) {
    amount = rng.random(who.gold);
  }
  return { kind: "gold", amount };
}
