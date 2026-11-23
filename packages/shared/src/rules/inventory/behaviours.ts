/**
 * Item behaviours (issue #37 stage 3): what an item does that its name alone decided in 1.6 (a
 * name holding "Key" opened doors, "bow" shot arrows, " Chest" opened as a chest). Content gives
 * each behaviour to items by name in `item-rules.json` `behaviours`; an item has every behaviour a
 * row matches. Classic's rows keep 1.6's word tests where they did no harm and name the items
 * exactly where they did (Bowmaster's Ring was a bow, a Swordfish a sword for Firesword).
 */
import type { ItemBehaviour } from "@secondstaronline/data";

import { onContent } from "../../content/store.ts";
import { isEngineFixture, withoutId } from "../core/fixtures.ts";
import { lingoContains, lingoEq } from "../core/lingo.ts";

export type { ItemBehaviour };

let ROWS: Map<ItemBehaviour, { match: "exact" | "contains"; pattern: string }[]> = new Map();

onContent((c) => {
  const rows = new Map<ItemBehaviour, { match: "exact" | "contains"; pattern: string }[]>();
  for (const r of c.itemRules.behaviours) {
    const list = rows.get(r.behaviour) ?? [];
    list.push({ match: r.match, pattern: r.pattern });
    rows.set(r.behaviour, list);
  }
  ROWS = rows;
});

/**
 * The name a behaviour row tests: without its `#id` (`Crate#12`) or `+N` ending (`Long Sword+3`,
 * `Knight's Sword +1`), so a carried container or an upgraded weapon keeps its item's behaviours.
 */
export function behaviourName(name: string): string {
  return withoutId(name).replace(/\s*\+\d+$/, "");
}

/** Whether the item `name` has `behaviour`. An engine fixture (`Bob's Door`) has none. */
export function hasBehaviour(name: string, behaviour: ItemBehaviour): boolean {
  const rows = ROWS.get(behaviour);
  if (!rows || isEngineFixture(name)) {
    return false;
  }
  const n = behaviourName(name);
  return rows.some((r) =>
    r.match === "exact" ? lingoEq(n, r.pattern) : lingoContains(n, r.pattern),
  );
}

/** A carried container with storage of its own: a cabinet, crate or cauldron. */
export function isStorageContainer(name: string): boolean {
  return (
    hasBehaviour(name, "cabinet") ||
    hasBehaviour(name, "windCabinet") ||
    hasBehaviour(name, "crate") ||
    hasBehaviour(name, "cauldron")
  );
}

/** A cabinet of either look. */
export function isCabinet(name: string): boolean {
  return hasBehaviour(name, "cabinet") || hasBehaviour(name, "windCabinet");
}
