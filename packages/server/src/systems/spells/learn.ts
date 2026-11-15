/**
 * Reading a book: the Use button on an item containing "Book". 1.6 split this between a server
 * routine and a client routine; SSO does both in one server step.
 */
import { itemsData } from "@secondstaronline/data";
import {
  BOOK_TEXT,
  bookDex,
  invDelSlot,
  lingoContains,
  type Rng,
  runBook,
} from "@secondstaronline/shared";

import type { Player } from "../world/world.ts";

/** Book items with a member in cast Inventory; without one the use exits silently. */
const HAS_ICON = new Set(
  itemsData.items.filter((i) => i.icon !== null).map((i) => i.name.toLowerCase()),
);

/**
 * Uses the book in bag `slot` (0-based). Returns the chat lines, in order. The book is consumed
 * even when nothing is learned (it is removed before the book is read).
 */
export function readBook(p: Player, slot: number, rng: Rng): string[] {
  const line = p.char.bag[slot];
  if (!line) {
    return [];
  }
  const name = line.item;
  if (!HAS_ICON.has(name.toLowerCase())) {
    return []; // 1.6 looks the icon up in its inventory art and gets no member
  }
  if (bookDex(name) > p.char.stats.dex) {
    return [BOOK_TEXT.dex];
  }
  const lines: string[] = [BOOK_TEXT.read];
  // The first of lines 1-15 whose "<item>-<n>" contains "<name>-" loses one, so reading a Bolt Book
  // can use up an earlier Firebolt Book (a kept 1.6 bug).
  const want = `${name}-`;
  const first = p.char.bag.findIndex(
    (l) => l !== null && lingoContains(`${l.item}-${l.qty}`, want),
  );
  if (first < 0 || !invDelSlot(p.char.bag, first, 1)) {
    return lines;
  }
  p.invDirty = true;
  const before = p.spell.book.length;
  const r = runBook(name, p.char.skills, p.spell.book, rng);
  if (r.kind === "spell" || p.spell.book.length !== before) {
    p.spell.bookDirty = true;
  }
  lines.push(...r.lines);
  return lines;
}

/** True for the items the Use button reads as a book. */
export function isBook(item: string): boolean {
  return lingoContains(item, "Book");
}
