/**
 * The bag, gold and the six equipment slots. Pure functions over plain data; the server owns the
 * state and the client only renders it.
 *
 * Names match without regard to case; substring matches also ignore case.
 */
import type { EquipSlot } from "@secondstaronline/data";

import { content, onContent } from "../../content/store.ts";

export type { EquipSlot };

import { type Equipment, NOTHING } from "../core/fighter.ts";
import { lingoContains, lingoEq, lingoWord, type Rng } from "../core/lingo.ts";
import { anyMatch } from "../core/patterns.ts";

/** The Pig drop's two lines. */
export const PIG_TEXT = {
  crowded: "It's too crowded to drop any pigs here!",
  blocked: "You can't drop an animal here!",
} as const;

/** 15 bag lines (`CHAR\<name>-i.txt` field 2). */
export const BAG_SLOTS = 15;

export interface BagLine {
  item: string;
  qty: number;
}

/** Index 0 = bag slot 1. `null` = an empty line. Always `BAG_SLOTS` long. */
export type Bag = (BagLine | null)[];

/** The equip slot types in file order. */
export const EQUIP_SLOTS: readonly EquipSlot[] = [
  "Head",
  "Body",
  "LeftHand",
  "RightHand",
  "Feet",
  "Ring",
];

/** Which `Equipment` field holds each slot type. */
export const EQUIP_FIELD: Record<EquipSlot, keyof Equipment> = {
  Head: "head",
  Body: "body",
  LeftHand: "weapon",
  RightHand: "offHand",
  Feet: "feet",
  Ring: "ring",
};

export function emptyBag(): Bag {
  return Array.from({ length: BAG_SLOTS }, () => null);
}

/** The bag as the original's field text, `Name-qty:…`, for its substring tests. */
export function bagText(bag: Bag): string {
  return bag.map((l) => (l ? `${l.item}-${l.qty}` : "")).join(":");
}

/** Parses the first word as an integer; anything that is not a number reads as 0. */
export function leadingInteger(s: string): number {
  const w = lingoWord(s, 1);
  return /^-?\d+$/.test(w) ? Number(w) : 0;
}

/**
 * The currency's item key (`bindings.json` `currency`, Classic's `Gold`), or null when the world
 * binds none. Characters carry it as a purse ("gold" in the engine's words), and a pile of it on
 * the ground is named with its amount, `15 Gold`.
 */
export let CURRENCY: string | null = null;
onContent((c) => {
  CURRENCY = c.bindings.currency.item ?? null;
});

/**
 * A currency pile, `<n> Gold`: a whole number, then the currency's words (`/drop 5 gold coins` made
 * one too). 1.6 took any name containing " Gold" (in Classic only the fixture `Open Gold Door`
 * differs, and no player can pick it up); a world's own currency (`Coin`) must not swallow an item
 * named `Silver Coin`.
 */
export function isGoldName(name: string): boolean {
  return /^-?\d+$/.test(lingoWord(name, 1)) && afterCountIsGold(name);
}

/** The ground name of a pile of `n` of the currency, `15 Gold`, or null with no currency. */
export function goldPileName(n: number): string | null {
  return CURRENCY === null ? null : `${n} ${CURRENCY}`;
}

/**
 * Whether the words after a pile's count begin with the currency's own words (`5 Gold`, but also
 * `5 gold coins`, as `/drop` and the NPC files took it).
 */
export function afterCountIsGold(name: string, currency: string | null = CURRENCY): boolean {
  if (currency === null) {
    return false;
  }
  const words = currency.split(" ").filter((w) => w !== "");
  return words.length > 0 && words.every((w, i) => lingoEq(lingoWord(name, i + 2), w));
}

/** The six crystal colours, in the order the bag loads them. */
export const CRYSTAL_COLOURS = ["Blue", "Red", "Green", "Yellow", "Purple", "White"] as const;
export type CrystalColour = (typeof CRYSTAL_COLOURS)[number];

/**
 * The colour of a crystal (`Blue Crystal`, case ignored), or null for any other name. The whole
 * name must match: a `Crystal Axe` or a `Blue Crystal Ring` is not a crystal. (1.6 named the item
 * "Blue Crystals" and tested names with "contains"; SSO names it in the singular, issue #39. The
 * old plural still counts, so a copy the upgrade's migration missed works and picks up singular.)
 */
export function crystalColour(item: string): CrystalColour | null {
  const m = /^(\S+) crystals?$/i.exec(item.trim());
  return m ? (CRYSTAL_COLOURS.find((c) => lingoEq(c, m[1] as string)) ?? null) : null;
}

/** Whether the name is one of the six crystals. */
export function isCrystal(item: string): boolean {
  return crystalColour(item) !== null;
}

/** The crystal item of a colour: `Blue Crystal`. */
export function crystalItem(colour: CrystalColour): string {
  return `${colour} Crystal`;
}

/**
 * A crystal pile on the ground, `"<n> <Colour> Crystal"` (its count in its name, as `15 Gold`
 * carries its amount): the crystal, by its singular name, and the count, or null for any other
 * name.
 */
export function crystalPile(name: string): { item: string; qty: number } | null {
  const m = /^(\d+) (.+)$/.exec(name.trim());
  const colour = m ? crystalColour(m[2] as string) : null;
  return m && colour ? { item: crystalItem(colour), qty: Number(m[1]) } : null;
}

/** A crystal pile `"<n> <Colour> Crystal"` becomes `n` of `<Colour> Crystal` on pickup. */
export function pileToItem(name: string): { item: string; qty: number } {
  return crystalPile(name) ?? { item: name, qty: 1 };
}

/**
 * The container names that get a `#id` when added, plus the Cauldron: `containers.uniqueIds` in
 * content/item-rules.json. Giving every Cauldron its own id is a divergence: in 1.6 a carried
 * Cauldron had none, so all of them opened one shared file.
 */
export let ID_CONTAINERS: readonly string[];

/** The bag slot `InvAdd` would use, or -1: a stack by exact name, else the lowest empty. */
export function addSlotFor(bag: Bag, item: string): number {
  const stack = bag.findIndex((l) => l !== null && lingoEq(l.item, item));
  if (stack >= 0) {
    return stack;
  }
  return bag.indexOf(null);
}

/** A bare Crate, Cabinet, Wind Cabinet or Cauldron, which `invAdd` gives its own `#id`. */
export function isUniqueContainer(item: string): boolean {
  return anyMatch(content().itemRules.containers.uniqueIds, item);
}

export type AddResult =
  | { kind: "gold"; amount: number }
  | { kind: "bag"; slot: number; item: string }
  /** No stack and no empty line: nothing added. */
  | { kind: "full" };

/**
 * `InvAdd` on a bag and gold balance, in place. A container becomes `Name#n`, a name containing "
 * Gold" adds the first word parsed as an integer in gold, every other item stacks on an exact
 * (case-insensitive) name or takes the lowest empty line. `rng` draws only for containers. A stack
 * is rewritten as `<name>-<total>`, so it takes the incoming spelling: Cuchad's `long sword` turns
 * a `Long Sword` stack into `long sword`. `taken` names a container id already in use: the id is
 * rolled again while it is (a few tries), so a new container never opens another's storage.
 */
export function invAdd(
  inv: { bag: Bag; gold: number },
  name: string,
  qty: number,
  rng: Rng,
  taken?: (item: string) => boolean,
): AddResult {
  let item = name;
  if (isUniqueContainer(item)) {
    item = `${name}#${rng.random(999999)}`;
    for (let i = 0; i < 20 && taken?.(item); i++) {
      item = `${name}#${rng.random(999999)}`;
    }
  }
  if (isGoldName(item)) {
    const amount = leadingInteger(item);
    inv.gold += amount;
    return { kind: "gold", amount };
  }
  const slot = addSlotFor(inv.bag, item);
  if (slot < 0) {
    return { kind: "full" };
  }
  const line = inv.bag[slot];
  if (line) {
    line.item = item;
    line.qty += qty;
    return { kind: "bag", slot, item };
  }
  inv.bag[slot] = { item, qty };
  return { kind: "bag", slot, item };
}

/**
 * Takes `qty` from bag slot `slot` (0-based), blanking it at 0 (the original's bag-delete routine).
 * A divergence: 1.6 matched by substring, SSO removes from the exact slot. False when the slot
 * holds less.
 */
export function invDelSlot(bag: Bag, slot: number, qty: number): boolean {
  const line = bag[slot];
  if (!line || line.qty < qty) {
    return false;
  }
  line.qty -= qty;
  if (line.qty === 0) {
    bag[slot] = null;
  }
  return true;
}

/**
 * Drag to rearrange: the lines in bag slots `from` and `to` (0-based) change places, so a line
 * dragged onto an empty slot moves there. False when `from` is empty or the two are the same slot.
 */
export function arrangeBag(bag: Bag, from: number, to: number): boolean {
  if (from === to || !bag[from] || to < 0 || to >= bag.length) {
    return false;
  }
  const line = bag[from] ?? null;
  bag[from] = bag[to] ?? null;
  bag[to] = line;
  return true;
}

export function filledLines(bag: Bag): number {
  return bag.filter((l) => l !== null).length;
}

/**
 * A stored item name without its `#id` (`Crate#12` is `Crate`): the item's key, which rules and
 * logs go by. Players see `itemLabel`, which also follows a rename.
 */
export function displayName(item: string): string {
  const i = item.indexOf("#");
  return i < 0 ? item : item.slice(0, i);
}

/**
 * Whether a stored item name is a copy of the item spelled one of `spellings` (its key and its
 * archived spellings, case ignored): the name itself, a container with its `#id` (`Crate#12`), a
 * crystal pile (`5 Blue Crystal`) or a masterwork level (`Long Sword+2`).
 */
export function storedCopyOf(stored: string, spellings: readonly string[]): boolean {
  const base = displayName(stored).trim();
  const is = (s: string) => spellings.some((k) => lingoEq(k, s.trim()));
  if (is(base)) {
    return true;
  }
  // Only a crystal pile carries its count in its name; `15 Gold` is gold, not the Gold item.
  const pile = crystalPile(base);
  if (pile && is(pile.item)) {
    return true;
  }
  // A masterwork level is written onto the name (`Long Sword+2`); a name with a space before its
  // `+N` is a catalogue item of its own (`Plate Armor +1`), whatever the catalogue holds now.
  const level = /^(.*\S)\+\d+$/.exec(base);
  return level !== null && is(level[1] as string);
}

/**
 * A stored copy rewritten as another item (an operator's Replace). A container keeps its `#id`
 * when the new item is a container too, so its storage goes with it; a crystal pile keeps its
 * count when the new item is crystals too (any other pile's count is `storedCount`, which the
 * caller moves to the pile's quantity). A masterwork level goes with the old item.
 */
export function storedCopyAs(stored: string, item: string): string {
  const id = /#([^#]*)$/.exec(stored)?.[1];
  if (id !== undefined && isUniqueContainer(item)) {
    return `${item}#${id}`;
  }
  const count = /^(\d+) .+$/.exec(displayName(stored).trim());
  return count && isCrystal(item) ? `${count[1]} ${item}` : item;
}

/** How many a stored pile name counts (`5 Blue Crystal` is 5); 1 for anything else. */
export function storedCount(stored: string): number {
  const count = /^(\d+) .+$/.exec(displayName(stored).trim());
  return count ? Math.max(1, Number(count[1])) : 1;
}

/** The name players see for an item key: its `display` when an operator renamed it. */
function labelOfKey(key: string): string {
  return content().item(key)?.display ?? key;
}

/**
 * The name players see for a stored item name: the `#id` dropped, and the key replaced by the
 * item's display name when an operator renamed it, keeping the count (`15 Gold`) and the
 * masterwork level (`Long Sword+2`) the stored name carries. A rename changes only this: copies
 * players hold keep their key, so none is stranded.
 */
export function itemLabel(item: string): string {
  const base = displayName(item);
  const direct = content().item(base);
  if (direct) {
    return direct.display ?? base;
  }
  const count = /^(\d+) (.+)$/.exec(base);
  if (count) {
    return `${count[1]} ${labelOfKey(count[2] as string)}`;
  }
  const level = /^(.+?)(\+\d+)$/.exec(base);
  if (level) {
    return `${labelOfKey(level[1] as string)}${level[2]}`;
  }
  return base;
}

/** The name players see for a monster or NPC: its species' `display` when renamed, else the name. */
export function monsterLabel(name: string): string {
  return content().monster(name)?.display ?? name;
}

/** The atlas art for an item key: its `sprite` when it has one, else the key itself. */
export function itemSprite(key: string): string {
  return content().item(key)?.sprite ?? key;
}

/** An empty equipment set as `Equipment`. */
export function equipmentOf(slots: Partial<Record<EquipSlot, string>>): Equipment {
  return {
    head: slots.Head ?? NOTHING,
    body: slots.Body ?? NOTHING,
    weapon: slots.LeftHand ?? NOTHING,
    offHand: slots.RightHand ?? NOTHING,
    feet: slots.Feet ?? NOTHING,
    ring: slots.Ring ?? NOTHING,
  };
}

export function equipped(e: Equipment, slot: EquipSlot): string {
  return e[EQUIP_FIELD[slot]];
}

onContent((c) => {
  ID_CONTAINERS = c.itemRules.containers.uniqueIds.map((r) => r.pattern);
});
