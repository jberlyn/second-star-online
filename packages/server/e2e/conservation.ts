/**
 * The conservation check: gold and every item name summed over every place SQL
 * keeps them, so a duplication or a loss shows as a difference between two readings. Read from
 * SQL (after the server restarts or the players leave), never from memory.
 *
 * It only means something in a scene with no sources or sinks: no monsters, no NPC with an
 * unlimited till in reach, no loot decay inside the window, no gathering or crafting. Stores
 * summed: characters.gold (with a live blackjack stake),
 * inventory, equipment, bank_accounts.balance, vault_items, container_items, ground_items
 * (`<n> Gold` piles are gold, `<n> X Crystals` piles are crystals, `qty` counts items),
 * npc_shops.gold where not NULL, npc_shop_lines.stock, and the live Pigs in map_slots.
 */
import { expect } from "bun:test";

import type { Db } from "../src/persistence/database.ts";

export interface Totals {
  gold: number;
  items: Map<string, number>;
}

const bump = (m: Map<string, number>, name: string, n: number) => {
  const k = name.toLowerCase();
  m.set(k, (m.get(k) ?? 0) + n);
};

/** A stored line may be a plain name, `Name-qty`, a gold pile `<n> Gold` or `<n> Colour Crystals`. */
function addLine(t: Totals, line: string, qty = 1): void {
  const gold = /^(\d+) Gold$/i.exec(line);
  if (gold) {
    t.gold += Number(gold[1]) * qty;
    return;
  }
  const crystals = /^(\d+) (\w+) Crystals$/i.exec(line);
  if (crystals) {
    bump(t.items, `${crystals[2]} Crystals`, Number(crystals[1]) * qty);
    return;
  }
  bump(t.items, line, qty);
}

export function totals(db: Db): Totals {
  const t: Totals = { gold: 0, items: new Map() };
  const one = <T>(sql: string): T[] => db.query<T, []>(sql).all();
  for (const r of one<{ g: number | null }>("SELECT SUM(gold) AS g FROM characters")) {
    t.gold += r.g ?? 0;
  }
  for (const r of one<{ g: number | null }>("SELECT SUM(balance) AS g FROM bank_accounts")) {
    t.gold += r.g ?? 0;
  }
  for (const r of one<{ item: string; qty: number }>("SELECT item, qty FROM inventory")) {
    addLine(t, r.item, r.qty);
  }
  for (const r of one<{ item: string }>("SELECT item FROM equipment")) {
    addLine(t, r.item);
  }
  for (const r of one<{ item: string }>("SELECT item FROM vault_items")) {
    addLine(t, r.item);
  }
  for (const r of one<{ item: string }>("SELECT item FROM container_items")) {
    addLine(t, r.item);
  }
  for (const r of one<{ item: string; qty: number }>("SELECT item, qty FROM ground_items")) {
    addLine(t, r.item, r.qty);
  }
  for (const r of one<{ g: number | null }>("SELECT SUM(gold) AS g FROM npc_shops")) {
    t.gold += r.g ?? 0;
  }
  for (const r of one<{ item: string; stock: number }>(
    "SELECT item, stock FROM npc_shop_lines WHERE stock IS NOT NULL",
  )) {
    bump(t.items, r.item, r.stock);
  }
  // A live Pig (a monster in a slot that a player can grab) is an item that has not been taken.
  for (const r of one<{ n: number }>(
    "SELECT COUNT(*) AS n FROM map_slots WHERE live_name IS NOT NULL AND lower(species) = 'pig'",
  )) {
    bump(t.items, "Pig", r.n);
  }
  return t;
}

/** Fails with the differing names when gold or any item count moved. */
export function expectConserved(before: Totals, after: Totals): void {
  expect(after.gold, "gold").toBe(before.gold);
  const names = new Set([...before.items.keys(), ...after.items.keys()]);
  const diff: string[] = [];
  for (const n of names) {
    const a = before.items.get(n) ?? 0;
    const b = after.items.get(n) ?? 0;
    if (a !== b) {
      diff.push(`${n}: ${a} -> ${b}`);
    }
  }
  expect(diff, "items").toEqual([]);
}
