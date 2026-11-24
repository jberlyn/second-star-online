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
import { type PatternRow, ruleMatches } from "../core/patterns.ts";

export type { ItemBehaviour };

type BehaviourRows = Map<ItemBehaviour, PatternRow[]>;

/** The behaviour rows grouped by behaviour. */
function groupRows(rows: readonly (PatternRow & { behaviour: ItemBehaviour })[]): BehaviourRows {
  const out: BehaviourRows = new Map();
  for (const r of rows) {
    const list = out.get(r.behaviour) ?? [];
    list.push(
      r.except
        ? { match: r.match, pattern: r.pattern, except: r.except }
        : { match: r.match, pattern: r.pattern },
    );
    out.set(r.behaviour, list);
  }
  return out;
}

let ROWS: BehaviourRows = new Map();

onContent((c) => {
  ROWS = groupRows(c.itemRules.behaviours);
});

function hasIn(rows: BehaviourRows, name: string, behaviour: ItemBehaviour): boolean {
  const list = rows.get(behaviour);
  if (!list || isEngineFixture(name)) {
    return false;
  }
  const n = behaviourName(name);
  return list.some((r) => ruleMatches(n, r));
}

/**
 * `hasBehaviour` against rows that are not installed (a draft's item rules), for checks that must
 * not read the live store.
 */
export function behaviourTest(
  rows: readonly { match: "exact" | "contains"; pattern: string; behaviour: ItemBehaviour }[],
): (name: string, behaviour: ItemBehaviour) => boolean {
  const grouped = groupRows(rows);
  return (name, behaviour) => hasIn(grouped, name, behaviour);
}

/**
 * The name a behaviour row tests: without its `#id` (`Crate#12`) or `+N` ending (`Long Sword+3`,
 * `Knight's Sword +1`), so a carried container or an upgraded weapon keeps its item's behaviours.
 */
export function behaviourName(name: string): string {
  return withoutId(name).replace(/\s*\+\d+$/, "");
}

/** Whether the item `name` has `behaviour`. An engine fixture (`Bob's Door`) has none. */
export function hasBehaviour(name: string, behaviour: ItemBehaviour): boolean {
  return hasIn(ROWS, name, behaviour);
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
