/**
 * Power a worn item adds (`gear` in content/item-rules.json): the spell power of robes, tiaras and
 * the Mage's Ring, Black Arts and Martial Arts bodies, and the Argon's Ring's attack power. Every
 * matching row adds.
 */
import { itemRulesData } from "@secondstaronline/data";

import type { Equipment } from "../core/fighter.ts";
import { ruleMatches } from "../core/patterns.ts";

type Power = (typeof itemRulesData.gear)[number]["power"];

/** The sum of the `add` of every `gear` row of this power that the worn item in its slot matches. */
export function gearBonus(equip: Equipment, power: Power): number {
  let total = 0;
  for (const row of itemRulesData.gear) {
    if (row.power === power && ruleMatches(equip[row.slot], row)) {
      total += row.add;
    }
  }
  return total;
}
