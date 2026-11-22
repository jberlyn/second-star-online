/**
 * Masterwork names: a repair can turn an item into its `+N` masterwork (craft `smith.masterwork`).
 * A rule written for the base item by its exact name also covers the masterworks made from it.
 */
import { content } from "../../content/store.ts";
import { lingoEq } from "../core/lingo.ts";

/** The base item a masterwork was made from, or the name itself when it is not a masterwork. */
export function masterworkBase(name: string): string {
  for (const m of content().craft.stations.smith.masterwork) {
    if (m.outcomes.some((o) => lingoEq(o.result, name))) {
      return m.item;
    }
  }
  return name;
}

/**
 * An exact-name weapon rule: the name itself, or a masterwork of it. A bug fixed: 1.6's exact
 * rows left a Knight's Sword +1 training nothing and a Sword of Hope +1 without its Heavy Arms
 * bonus.
 */
export function weaponIs(weapon: string, pattern: string): boolean {
  return lingoEq(weapon, pattern) || lingoEq(masterworkBase(weapon), pattern);
}
