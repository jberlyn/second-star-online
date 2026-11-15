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
  KEY_PAUSE,
  keyConsumed,
  lingoEq,
  relockAfter,
  renameTargets,
  SWITCH_PAUSE,
  SWITCH_TEXT,
  switchFlip,
  turnKey,
} from "@secondstaronline/shared";

import type { ItemCtx, ItemOut } from "../inventory/items.ts";
import type { GroundItem, Player, Room } from "../world/world.ts";

/**
 * The door switch and the `` !`(`` echo: every door or switch on the map whose name contains `old`
 * becomes `to` in place, and the echo sets every client's relock counter to 200.
 */
export function renameDoors(ctx: ItemCtx, room: Room, io: ItemOut, old: string, to: string): void {
  const ground = room.map.ground;
  for (const i of renameTargets(
    ground.map((g) => g.item),
    old,
  )) {
    const g = ground[i] as GroundItem;
    g.item = to;
    ctx.world.groundLog.push({ mapId: room.map.id, set: { id: g.id, item: to } });
    io.all({ e: "gset", id: g.id, name: to });
  }
  room.doorLock = relockAfter(room.doorLock, "change");
}

/**
 * A key's Use, after Use's gates. Null when the item is not a key (its name contains "Key"). The
 * faced point is sprite 112 ± 32 px, so mid-step it matches nothing; the last door on the tile
 * wins; house and guild keys set no pause and are kept; a coloured key is consumed from its slot
 * and pauses 425.
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
  const door = facedDoor(
    room.map.ground.filter((g) => g.x === p.x + dx && g.y === p.y + dy).map((g) => g.item),
  );
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
  renameDoors(ctx, room, io, turn.from, turn.to);
  if (turn.coloured) {
    if (keyConsumed(item)) {
      invDelSlot(p.char.bag, slot - 1, 1);
      p.invDirty = true;
    }
    p.itemPause = KEY_PAUSE;
  }
  return true;
}

/**
 * The On or Off switch click, from a click or Ctrl, which first cleared the item-action pause. The
 * relock is armed with 100 **before** the adjacency test (1.6 did this, so a refused click still
 * arms the relock); then the switch must be the faced tile with you standing still. It flips every
 * switch of its state and closes or opens the switch doors on the map, and pauses 100.
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
  room.doorLock = relockAfter(room.doorLock, "switchClick");
  const [dx, dy] = FACING_DELTA[p.facing];
  if (p.stepFrames > 0 || g.x !== p.x + dx || g.y !== p.y + dy) {
    io.tell(p, SWITCH_TEXT.notInFront);
    return;
  }
  const [own, doors] = switchFlip(state);
  renameDoors(ctx, room, io, own[0], own[1]);
  // The close-doors and open-doors messages go only for the doors on screen.
  if (room.map.ground.some((x) => lingoEq(x.item, doors[0]))) {
    renameDoors(ctx, room, io, doors[0], doors[1]);
  }
  p.itemPause = SWITCH_PAUSE;
}

/**
 * The relock counter: at 0, `closeAllDoors` closes the open coloured and switch doors and turns ON
 * switches OFF; each close echoes, so the timer runs again from 200. Player and guild doors are
 * never closed.
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
