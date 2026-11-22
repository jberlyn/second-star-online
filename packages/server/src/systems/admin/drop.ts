/**
 * `/drop <item>` and `/drop <n> gold` for the `drop` permission (administrators): the original's command. 1.6 took `N gold` or
 * any member name of the Inventory cast; SSO takes the catalogue items that are Inventory members
 * (the ones with an icon) and the cast's fixture members, plus a count (SSO's own addition). The
 * item lands on the faced tile and never decays (SSO's own rule).
 */
import {
  can,
  content,
  FACING_DELTA,
  ID_CONTAINERS,
  isGoldName,
  isWalkable,
  leadingInteger,
  lingoContains,
  lingoEq,
  lingoWord,
  MAP_HEIGHT,
  MAP_WIDTH,
  pileToItem,
} from "@secondstaronline/shared";

import { addGround, DROP_TEXT, type ItemCtx, ItemOut } from "../inventory/items.ts";
import type { Outgoing, Player, Room } from "../world/world.ts";
import { logActivity } from "./activity.ts";

/** The original's alert, an alert here too. */
export const NO_SUCH_ITEM = "This item doesn't exist!";

/** The most a counted `/drop` pile holds: the gold dialog's cap. */
export const DROP_MAX = 9999;

/** What a `/drop` text puts on the ground: the ground name and how many the pile gives. */
export interface DropPile {
  item: string;
  qty: number;
}

/**
 * The catalogue spelling of a name that is an Inventory cast member: an item with an icon
 * (items.json `icon`: an original Inventory member, or added art), by its key or the display name it
 * was renamed to. Director's member lookup ignores case (`"Cash"` finds `cash`).
 */
function inventoryItem(name: string): string | null {
  // A renamed item may be typed by the name players see; it is put down by its key.
  const item = content().itemNamed(name);
  return item && item.icon !== null ? item.name : null;
}

/** A crystal stack ("Blue Crystals"): on the ground it is a `"<n> <Colour> Crystals"` pile. */
const isCrystals = (name: string) => lingoContains(name, " Crystals");

/**
 * What `/drop` (and the World Editor's placed items) puts down for this text, or null for "This
 * item doesn't exist!":
 * - `N gold` with a positive integer amount, as typed;
 * - an Inventory item or fixture member, as typed; a bare crystal name becomes a pile of 1 (SSO: in
 *   1.6 it picked up as "Crystals ");
 * - `<n> <Inventory item>` with n from 1 to 9,999 (SSO): crystals as the `"<n> <Colour> Crystals"`
 *   pile, anything else as one pile that gives n. The containers that never stack (`InvAdd` gives
 *   each its own `#id`) take no count.
 */
export function parseDrop(text: string): DropPile | null {
  if (lingoEq(lingoWord(text, 2), "gold") && Number.parseInt(lingoWord(text, 1), 10) > 0) {
    return { item: text, qty: 1 };
  }
  const plain = inventoryItem(text);
  if (plain !== null) {
    if (isCrystals(plain)) {
      return { item: `1 ${plain}`, qty: 1 };
    }
    // Typed as the key, it is put down as typed; typed as a renamed item's display name, by its key.
    return { item: lingoEq(plain, text) ? text : plain, qty: 1 };
  }
  if (content().items.fixtures.some((f) => lingoEq(f, text))) {
    return { item: text, qty: 1 };
  }
  const count = lingoWord(text, 1);
  if (!/^\d+$/.test(count)) {
    return null;
  }
  const n = Number(count);
  const base = inventoryItem(text.trim().replace(/^\S+\s+/, ""));
  if (base === null || n < 1 || n > DROP_MAX || ID_CONTAINERS.some((c) => lingoEq(c, base))) {
    return null;
  }
  if (isCrystals(base)) {
    return { item: `${n} ${base}`, qty: 1 };
  }
  return { item: base, qty: n };
}

/** Whether `/drop` (and the World Editor) takes this text. */
export function droppableName(text: string): boolean {
  return parseDrop(text) !== null;
}

/** A pile as `/drop` and the World Editor write it: `"<n> <item>"` when it holds more than 1. */
export function dropText(g: { item: string; qty?: number }): string {
  return (g.qty ?? 1) > 1 ? `${g.qty} ${g.item}` : g.item;
}

export function handleDrop(ctx: ItemCtx, room: Room, p: Player, item: string): Outgoing[] {
  const io = new ItemOut(room);
  // Creating items from nothing needs `drop`: moderators must not mint gold or stacks.
  if (item === "" || !can(p.role, "drop")) {
    return io.out;
  }
  // a positive integer followed by the word "gold", or a known name.
  const pile = parseDrop(item);
  if (pile === null) {
    io.out.push({ to: p.id, msg: { t: "alert", text: NO_SUCH_ITEM } });
    return io.out;
  }
  if (p.stepFrames > 0) {
    return io.out;
  }
  const [dx, dy] = FACING_DELTA[p.facing];
  const x = p.x + dx;
  const y = p.y + dy;
  if (room.map.ground.some((g) => g.x === x && g.y === y)) {
    io.tell(p, DROP_TEXT.crowded);
    return io.out;
  }
  // Off the screen there is no tile to hold it (SSO: refused silently).
  if (x < 1 || x > MAP_WIDTH || y < 1 || y > MAP_HEIGHT) {
    return io.out;
  }
  if (!isWalkable(room.map.walk, x, y)) {
    io.tell(p, DROP_TEXT.blocked);
    return io.out;
  }
  addGround(ctx, room, io, {
    item: pile.item,
    ...(pile.qty > 1 ? { qty: pile.qty } : {}),
    x,
    y,
    kind: "admin",
    expiresAt: null,
  });
  // Made from nothing: the admin does not carry it, so it is logged as placed on the ground.
  const gold = isGoldName(pile.item) ? leadingInteger(pile.item) : 0;
  const made = gold > 0 ? null : pileToItem(pile.item);
  logActivity(ctx.world, p, "admin", {
    item: made?.item ?? null,
    at: { map: room.map.name, x, y },
    details: { placed: made ? made.qty * pile.qty : null, placedGold: gold || null },
  });
  return io.out;
}
