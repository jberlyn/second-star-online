/**
 * Monster loot and the death drop: which item, if any, goes on the ground.
 *
 * Implements the original's monster loot and the player death
 * drop).
 */

import { content } from "../../content/store.ts";
import type { Rng } from "../core/lingo.ts";
import { type Bag, isCrystal } from "../inventory/inventory.ts";

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

export type DeathDrop =
  | { kind: "none" }
  /** One unit of bag line `slot` (0-based) goes on the death tile. */
  | { kind: "item"; slot: number }
  /** `amount` gold goes on the death tile as `"<amount> Gold"`. */
  | { kind: "gold"; amount: number };

/** Whose deaths drop gold or an item (balance `drops.who`). */
export type DeathDropWho = "off" | "wanted" | "pvp" | "everyone";
/** What a death drop can be (balance `drops.kind`): gold or an item as in 1.6, or only one. */
export type DeathDropKind = "either" | "gold" | "items";

/** The world's death-drop rules (the Balance page's Death drops and loot). */
export interface DeathDropRules {
  who: DeathDropWho;
  kind: DeathDropKind;
  /** The most gold a death drops unless wanted; 0 for no cap (1.6: 200). */
  goldCap: number;
  /** A character below this level drops nothing unless wanted; 0 for none. */
  minLevel: number;
}

/** SSO's defaults: only a wanted character drops, gold or an item, as 1.6 chose it. */
export const DEFAULT_DEATH_DROPS: DeathDropRules = {
  who: "wanted",
  kind: "either",
  goldCap: 200,
  minLevel: 0,
};

/** The world's death-drop rules: the balance row `drops` (Server Settings before issue #19). */
export function balanceDeathDrops(): DeathDropRules {
  const d = content().balance.drops;
  return { who: d.who, kind: d.kind, goldCap: d.goldCap, minLevel: d.minLevel };
}

/** Seconds monster loot lasts on the ground: the balance row `drops.lootDecaySeconds`. */
export function lootDecaySeconds(): number {
  return content().balance.drops.lootDecaySeconds;
}

/** The character who died, as the drop sees it. */
export interface DeathDropVictim {
  bag: Bag;
  gold: number;
  level: number;
  wanted: boolean;
  /** Another player landed the last hit, recently enough to be credited with the kill. */
  killedByPlayer: boolean;
  inVehicle: boolean;
}

/** Whether this death drops anything under `rules`, before any draw. */
export function dropsOnDeath(who: DeathDropVictim, rules: DeathDropRules): boolean {
  if (rules.who === "off") {
    return false;
  }
  if (who.wanted) {
    // A murderer chose the risk: no level protection.
    return true;
  }
  if (who.level < rules.minLevel) {
    return false;
  }
  return rules.who === "everyone" || (rules.who === "pvp" && who.killedByPlayer);
}

/**
 * The drop of a non-arena death (a design change: 1.6 dropped on every death; here the operator's
 * `rules` decide, and the default is a wanted character's death only). No draws when it does not
 * drop. Then `random(2)` gold-or-item when gold > 0 and the kind allows both; the item branch
 * `random(items)` over the bag's non-crystal lines, or the gold branch `random(gold)`, redrawn as
 * `random(cap)` over the cap unless wanted. Nothing drops aboard a vehicle, after the same draws.
 */
export function rollDeathDrop(who: DeathDropVictim, rules: DeathDropRules, rng: Rng): DeathDrop {
  if (!dropsOnDeath(who, rules)) {
    return { kind: "none" };
  }
  const gold =
    who.gold > 0 && (rules.kind === "gold" || (rules.kind === "either" && rng.random(2) === 1));
  if (!gold) {
    if (rules.kind === "gold") {
      return { kind: "none" };
    }
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
  let amount = rng.random(who.gold);
  if (!who.wanted && rules.goldCap > 0 && amount > rules.goldCap) {
    amount = rng.random(rules.goldCap);
  }
  return who.inVehicle ? { kind: "none" } : { kind: "gold", amount };
}
