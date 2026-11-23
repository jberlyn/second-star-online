/**
 * Reading a book: the Use button on an item containing "Book". 1.6 split this between a server
 * routine and a client routine; SSO does both in one server step.
 */
import {
  BOOK_TEXT,
  bookDex,
  hasBehaviour,
  invDelSlot,
  type Rng,
  runBook,
} from "@secondstaronline/shared";

import { fighterOf } from "../monsters/attack.ts";
import { type Player, statsOf } from "../world/world.ts";

/**
 * Uses the book in bag `slot` (0-based). Returns the chat lines, in order. The book read is the
 * one used up, and only when it teaches something. Bugs fixed: 1.6 removed the first bag line
 * containing "<name>-" before reading, so a book that taught nothing was lost and a Bolt Book
 * could use up a Firebolt Book above it; and a book with no inventory picture (the Poison Dart
 * Book) could not be read at all.
 */
export function readBook(p: Player, slot: number, rng: Rng): string[] {
  const line = p.char.bag[slot];
  if (!line) {
    return [];
  }
  const name = line.item;
  if (bookDex(name) > statsOf(p).dex) {
    return [BOOK_TEXT.dex];
  }
  const lines: string[] = [BOOK_TEXT.read];
  const r = runBook(name, fighterOf(p), p.spell.book, rng);
  lines.push(...r.lines);
  if (r.kind === "none") {
    return lines;
  }
  invDelSlot(p.char.bag, slot, 1);
  p.invDirty = true;
  if (r.kind === "spell") {
    p.spell.bookDirty = true;
  }
  return lines;
}

/** True for the items the Use button reads as a book (the `book` behaviour). */
export function isBook(item: string): boolean {
  return hasBehaviour(item, "book");
}
