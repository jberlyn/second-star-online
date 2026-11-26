/**
 * Masterwork names: a craft can turn what it makes into a `+N` masterwork, by the Classic smithing
 * table (`stations.smith.masterwork`, a repair's roll) or by the masterworks every craft shares
 * (`masterworks`, a chance by the craft's skill). A rule written for the base item by its exact
 * name also covers the masterworks made from it.
 */
import type { Masterwork } from "@secondstaronline/data";

import { type ContentData, content } from "../../content/store.ts";
import { lingoEq, type Rng } from "../core/lingo.ts";
import { oddsAt, rollChance } from "./odds.ts";

export type { Masterwork };

/** The base item a masterwork was made from, or the name itself when it is not a masterwork. */
export function masterworkBase(name: string, craft?: ContentData["craft"]): string {
  const data = craft ?? content().craft;
  for (const m of data.stations.smith?.masterwork ?? []) {
    if (m.outcomes.some((o) => lingoEq(o.result, name))) {
      return m.item;
    }
  }
  for (const m of data.masterworks ?? []) {
    if (m.results.some((r) => lingoEq(r.item, name))) {
      return m.item;
    }
  }
  return name;
}

/** Every masterwork made from `name`, by either table. */
export function masterworksOf(name: string, craft?: ContentData["craft"]): string[] {
  const data = craft ?? content().craft;
  return [
    ...(data.stations.smith?.masterwork ?? [])
      .filter((m) => lingoEq(m.item, name))
      .flatMap((m) => m.outcomes.map((o) => o.result)),
    ...(data.masterworks ?? [])
      .filter((m) => lingoEq(m.item, name))
      .flatMap((m) => m.results.map((r) => r.item)),
  ];
}

/** The shared masterwork row for an item a craft makes, or null. */
export function masterworkRow(item: string, craft?: ContentData["craft"]): Masterwork | null {
  return (craft ?? content().craft).masterworks?.find((m) => lingoEq(m.item, item)) ?? null;
}

/** The chance (0 to 1) a craft of `item` at `skill` comes out a masterwork (0 with no row). */
export function masterworkChance(
  item: string,
  skill: number,
  craft?: ContentData["craft"],
): number {
  const row = masterworkRow(item, craft);
  return row ? oddsAt(row.odds, skill) : 0;
}

/**
 * What a successful craft of `item` at `skill` makes: with the row's chance, one of its masterworks
 * picked by weight, else the item itself. An item with no row draws nothing from `rng`, so a world
 * with no masterworks (Classic) rolls exactly as before.
 */
export function rollMasterwork(item: string, skill: number, rng: Rng): string {
  const row = masterworkRow(item);
  if (!row || !rollChance(oddsAt(row.odds, skill), rng)) {
    return item;
  }
  const total = row.results.reduce((n, r) => n + r.weight, 0);
  let roll = rng.random(total);
  for (const r of row.results) {
    roll -= r.weight;
    if (roll <= 0) {
      return r.item;
    }
  }
  return row.results[row.results.length - 1]?.item ?? item;
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
