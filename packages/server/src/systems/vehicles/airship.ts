/**
 * The Airship: building it from a deed on a landing pad, boarding, unboarding and losing it at
 * death. The checks are pure (shared/rules/vehicles/vehicles.ts); this applies them.
 *
 * Every change to the ground goes through `addGround`/`removeGround`, so it lands in
 * `world.groundLog`, and sets `invDirty` and `vehicleDirty`, so `persistItems` writes the ground
 * row and the character's vehicle and tile in one transaction: an airship is never both parked
 * and ridden, and never lost, after a crash.
 */
import {
  AIRSHIP_BODY,
  boardCheck,
  boardingHull,
  DEFAULT_HULL_RULES,
  deedCheck,
  FACING_DELTA,
  hullMax,
  invDelSlot,
  lingoEq,
  ownerName,
  unboardCheck,
  VEHICLE_TEXT,
} from "@secondstaronline/shared";

import { addGround, type ItemCtx, ItemOut, removeGround } from "../inventory/items.ts";
import {
  type GroundItem,
  type Outgoing,
  type Player,
  playerView,
  type Room,
} from "../world/world.ts";

/** The ground name of an Airship built or parked by `p`. */
const airshipName = (p: Player) => `${p.name}'s Airship`;

/** Everyone else on the map re-places the sprite at its new tile (the `V` message). */
function replace(room: Room, io: ItemOut, p: Player): void {
  for (const o of room.players) {
    if (o !== p) {
      io.out.push({
        to: o.id,
        msg: {
          t: "delta",
          events: [
            { e: "leave", id: p.id },
            { e: "enter", player: playerView(p) },
          ],
        },
      });
    }
  }
}

/**
 * From Use on an Airship Deed: builds the airship on the faced `J2` pad and consumes one deed. 1.6
 * refused the build when 20 items were already on the ground; SSO has no such cap (a divergence).
 */
export function airshipDeed(ctx: ItemCtx, room: Room, p: Player, slot: number): Outgoing[] {
  const io = new ItemOut(room);
  const [dx, dy] = FACING_DELTA[p.facing];
  const faced = { x: p.x + dx, y: p.y + dy };
  const r = deedCheck({
    stepFrames: p.stepFrames,
    faced,
    layer1: room.map.layers[0],
    itemOnFaced: room.map.ground.some((g) => g.x === faced.x && g.y === faced.y),
  });
  if (r.kind === "silent") {
    return io.out;
  }
  if (r.kind === "text") {
    io.tell(p, r.text);
    return io.out;
  }
  addGround(ctx, room, io, {
    item: airshipName(p),
    x: faced.x,
    y: faced.y,
    kind: "drop",
    expiresAt: null,
    ownerId: p.id,
  });
  invDelSlot(p.char.bag, slot - 1, 1);
  p.invDirty = true;
  return io.out;
}

/**
 * From a click and from Ctrl on foot: the owner boards, anyone else is told it is not theirs. An
 * item with no owner id (an operator's `/drop` or a World Editor placement) falls back to 1.6's
 * name test.
 */
export function airshipClick(ctx: ItemCtx, room: Room, p: Player, g: GroundItem): Outgoing[] {
  const io = new ItemOut(room);
  const isOwner = g.ownerId ? g.ownerId === p.id : lingoEq(ownerName(g.item), p.name);
  const r = boardCheck({
    vehicle: p.vehicle,
    stepFrames: p.stepFrames,
    me: { x: p.x, y: p.y },
    facing: p.facing,
    item: { x: g.x, y: g.y },
    isOwner,
  });
  if (r === "silent") {
    return io.out;
  }
  if (r === "notYours") {
    io.tell(p, VEHICLE_TEXT.notYours);
    return io.out;
  }
  if (r === "see") {
    io.tell(p, VEHICLE_TEXT.see(ownerName(g.item)));
    return io.out;
  }
  // Board: the airship leaves the ground, the rider hops onto its tile with no step.
  removeGround(ctx, room, io, g.id);
  const rules = ctx.hulls ?? DEFAULT_HULL_RULES;
  // The hull it was parked with, repaired for the time it stood (an SSO addition).
  p.hull = boardingHull(
    { hull: g.hull ?? null, parkedAt: g.parkedAt ?? null },
    hullMax("Airship", rules),
    ctx.now,
    rules.repairPerMinute,
  );
  p.vitalsDirty = true;
  p.vehicle = "Airship";
  p.x = g.x;
  p.y = g.y;
  p.stepFrames = 0;
  p.spell.body = AIRSHIP_BODY;
  io.all({ e: "body", id: p.id, body: AIRSHIP_BODY });
  replace(room, io, p);
  p.forceYou = true;
  p.vehicleDirty = true;
  p.invDirty = true;
  io.tell(p, VEHICLE_TEXT.board);
  return io.out;
}

/**
 * From Ctrl aboard: parks the airship on my own tile, which must be a `J2` pad with nothing on it.
 * No text on success (1.6 prints none); the player stays on the tile and the paperdoll comes back.
 */
export function unboardAirship(ctx: ItemCtx, room: Room, p: Player): Outgoing[] {
  const io = new ItemOut(room);
  const r = unboardCheck({
    stepFrames: p.stepFrames,
    me: { x: p.x, y: p.y },
    layer1: room.map.layers[0],
    itemOnMine: room.map.ground.some((g) => g.x === p.x && g.y === p.y),
  });
  if (r.kind === "text") {
    io.tell(p, r.text);
    return io.out;
  }
  addGround(ctx, room, io, {
    item: airshipName(p),
    x: p.x,
    y: p.y,
    kind: "drop",
    expiresAt: null,
    ownerId: p.id,
    hull: p.hull,
    parkedAt: ctx.now,
  });
  p.vehicle = null;
  p.hull = null;
  p.vitalsDirty = true;
  p.spell.body = null;
  io.all({ e: "body", id: p.id, body: null });
  p.forceYou = true;
  p.vehicleDirty = true;
  p.invDirty = true;
  return io.out;
}

/**
 * The airship is lost at death: the body reverts for everyone and nothing parks. Returns the body
 * event for the map. A death because the hull ran out is remembered for the respawn line.
 */
export function vehicleDeath(room: Room, p: Player): Outgoing[] {
  const io = new ItemOut(room);
  if (p.vehicle && p.hull !== null && p.hull <= 0) {
    p.sunk = p.vehicle;
  }
  p.vehicle = null;
  p.hull = null;
  p.vitalsDirty = true;
  p.spell.body = null;
  p.vehicleDirty = true;
  p.invDirty = true;
  io.all({ e: "body", id: p.id, body: null });
  return io.out;
}
