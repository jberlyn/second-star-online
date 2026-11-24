/**
 * Masterwork names: a repair can turn an item into its `+N` masterwork (craft `smith.masterwork`).
 * A rule written for the base item by its exact name also covers the masterworks made from it.
 */
import { type ContentData, content } from "../../content/store.ts";
import { lingoEq } from "../core/lingo.ts";

/** The base item a masterwork was made from, or the name itself when it is not a masterwork. */
export function masterworkBase(name: string, craft?: ContentData["craft"]): string {
  for (const m of (craft ?? content().craft).stations.smith?.masterwork ?? []) {
    if (m.outcomes.some((o) => lingoEq(o.result, name))) {
      return m.item;
    }
  }
  return name;
}

/**
 * An exact-name weapon rule: the name itself, or a masterwork of it. A bug fixed: 1.6's exact
 * rows left a Knight's Sword +1 training nothing and a Sword of Hope +1 without its Heavy Arms
 * bonus. `craft` reads another set of data's masterworks (the content report, the item resolver)
 * in place of the installed store's.
 */
export function weaponIs(weapon: string, pattern: string, craft?: ContentData["craft"]): boolean {
  return lingoEq(weapon, pattern) || lingoEq(masterworkBase(weapon, craft), pattern);
}
