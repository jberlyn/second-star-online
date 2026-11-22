/**
 * Doors, keys, switches and the relock on the server. The rules are
 * `shared/rules/housing/doors.ts`; this module applies them to a room's ground items.
 */
import {
  closeAllDoors,
  FACING_DELTA,
  facedDoor,
  invDelSlot,
  isKey,
  keyConsumed,
  keyPause,
  lingoEq,
  RELOCK_FRAMES,
  renameTargets,
  SWITCH_PAUSE,
  SWITCH_TEXT,
  switchFlip,
  turnKey,
} from "@secondstaronline/shared";

import { logActivity } from "../admin/activity.ts";
import type { ItemCtx, ItemOut } from "../inventory/items.ts";
import type { GroundItem, Player, Room } from "../world/world.ts";

/** One door or switch takes its new name in place; every change restarts the map's relock (200). */
function renameItem(ctx: ItemCtx, room: Room, io: ItemOut, g: GroundItem, to: string): void {
  g.item = to;
  ctx.world.groundLog.push({ mapId: room.map.id, set: { id: g.id, item: to } });
  io.all({ e: "gset", id: g.id, name: to });
  room.doorLock = RELOCK_FRAMES;
}

/** Every door or switch on the map named exactly `old` becomes `to` (a switch's doors, the relock). */
export function renameDoors(ctx: ItemCtx, room: Room, io: ItemOut, old: string, to: string): void {
  const ground = room.map.ground;
  for (const i of renameTargets(
    ground.map((g) => g.item),
    old,
  )) {
    renameItem(ctx, room, io, ground[i] as GroundItem, to);
  }
}

/**
 * A key's Use, after Use's gates. Null when the item is not a key (its name contains "Key"). The
 * faced point is sprite 112 ± 32 px, so mid-step it matches nothing; the last door on the tile
 * wins, and only that door turns. A coloured key is spent from its slot when it opens its door
 * (closing is free) and pauses 425; House and Guild Keys are kept and pause 100.
 */
export function useKey(
  ctx: ItemCtx,
  room: Room,
  io: ItemOut,
  p: Player,
  slot: number,
  item: string,
): boolean {
  if (!isKey(item)) {
    return false;
  }
  if (p.stepFrames > 0) {
    return true;
  }
  const [dx, dy] = FACING_DELTA[p.facing];
  const onTile = room.map.ground.filter((g) => g.x === p.x + dx && g.y === p.y + dy);
  const door = facedDoor(onTile.map((g) => g.item));
  if (!door) {
    return true;
  }
  // A Guild Key fits "The " followed by the player's guild name.
  const turn = turnKey(item, door, p.name, p.guild);
  if (turn.kind === "text") {
    io.tell(p, turn.text);
  }
  if (turn.kind !== "turn") {
    return true;
  }
  const g = onTile.findLast((x) => x.item === door) as GroundItem;
  renameItem(ctx, room, io, g, turn.to);
  if (keyConsumed(turn, item)) {
    logActivity(ctx.world, p, "use", { item, qty: -1, details: { door } });
    invDelSlot(p.char.bag, slot - 1, 1);
    p.invDirty = true;
  }
  p.itemPause = keyPause(turn);
  return true;
}

/**
 * The On or Off switch click, from a click or Ctrl, which first cleared the item-action pause. The
 * switch must be the faced tile with you standing still, or you are told so and nothing changes.
 * Then that switch alone flips, the map's switch doors close or open, and you pause 100.
 */
export function switchClick(
  ctx: ItemCtx,
  room: Room,
  io: ItemOut,
  p: Player,
  g: GroundItem,
  state: "on" | "off",
): void {
  p.itemPause = 0;
  const [dx, dy] = FACING_DELTA[p.facing];
  if (p.stepFrames > 0 || g.x !== p.x + dx || g.y !== p.y + dy) {
    io.tell(p, SWITCH_TEXT.notInFront);
    return;
  }
  const [own, doors] = switchFlip(state);
  renameItem(ctx, room, io, g, own[1]);
  if (room.map.ground.some((x) => lingoEq(x.item, doors[0]))) {
    renameDoors(ctx, room, io, doors[0], doors[1]);
  }
  p.itemPause = SWITCH_PAUSE;
}

/**
 * The relock counter: at 0, `closeAllDoors` closes the open coloured, switch, player and guild
 * doors and turns ON switches OFF; each close restarts the timer, which finds nothing more to close
 * when it next runs out.
 */
export function relockStep(ctx: ItemCtx, room: Room, io: ItemOut): void {
  if (room.doorLock <= 0) {
    return;
  }
  room.doorLock -= 1;
  if (room.doorLock > 0) {
    return;
  }
  for (const [old, to] of closeAllDoors(room.map.ground.map((g) => g.item))) {
    renameDoors(ctx, room, io, old, to);
  }
}
