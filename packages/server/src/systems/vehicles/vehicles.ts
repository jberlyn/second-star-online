/**
 * The vehicles: the Airship, the Boat and the Battleship. Building one from a deed (an Airship on a
 * landing pad, a ship on open water), boarding, getting off and losing it at death. The checks are
 * pure (shared/rules/vehicles/vehicles.ts); this applies them.
 *
 * Every change to the ground goes through `addGround`/`removeGround`, so it lands in
 * `world.groundLog`, and sets `invDirty` and `vehicleDirty`, so `persistItems` writes the ground
 * row and the character's vehicle and tile in one transaction: a vehicle is never both parked
 * and ridden, and never lost, after a crash.
 */
import {
  boardCheck,
  boardingHull,
  deedCheck,
  FACING_DELTA,
  hullMax,
  invDelSlot,
  isShip,
  isWalkable,
  lingoEq,
  ownerName,
  ridersBound,
  SHIP_TEXT,
  shipDeedCheck,
  shipNoun,
  shipUnboardCheck,
  unboardCheck,
  VEHICLE_BODY,
  VEHICLE_TEXT,
  type Vehicle,
  vehicleOfItem,
} from "@secondstaronline/shared";

import { logActivity } from "../admin/activity.ts";
import { arenaTileTaken } from "../combat/arena.ts";
import { addGround, type ItemCtx, ItemOut, removeGround } from "../inventory/items.ts";
import {
  type GroundItem,
  type Outgoing,
  type Player,
  playerView,
  type Room,
} from "../world/world.ts";

/** The ground name of a vehicle built or parked by `p`. */
const parkedName = (p: Player, vehicle: Vehicle) => `${p.name}'s ${vehicle}`;

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

function facedTile(p: Player): { x: number; y: number } {
  const [dx, dy] = FACING_DELTA[p.facing];
  return { x: p.x + dx, y: p.y + dy };
}

const itemAt = (room: Room, x: number, y: number) =>
  room.map.ground.some((g) => g.x === x && g.y === y);

/**
 * From Use on a vehicle deed. An Airship is built on the faced `J2` pad; a Boat or Battleship on
 * the faced water tile (1.6's boat-drop routine, which its deed handler never called). One deed is
 * consumed. 1.6 refused either build when 20 items were already on the ground; SSO has no such cap
 * (a divergence).
 */
export function vehicleDeed(
  ctx: ItemCtx,
  room: Room,
  p: Player,
  slot: number,
  vehicle: Vehicle,
): Outgoing[] {
  const io = new ItemOut(room);
  const faced = facedTile(p);
  const r = isShip(vehicle)
    ? shipDeedCheck({
        noun: shipNoun(vehicle),
        stepFrames: p.stepFrames,
        faced,
        shipWalkable: isWalkable(room.map.walkShip, faced.x, faced.y),
        itemOnFaced: itemAt(room, faced.x, faced.y),
        playerOnFaced: room.players.some((o) => o.x === faced.x && o.y === faced.y),
      })
    : deedCheck({
        stepFrames: p.stepFrames,
        faced,
        layer1: room.map.layers[0],
        itemOnFaced: itemAt(room, faced.x, faced.y),
      });
  if (r.kind === "silent") {
    return io.out;
  }
  if (r.kind === "text") {
    io.tell(p, r.text);
    return io.out;
  }
  addGround(ctx, room, io, {
    item: parkedName(p, vehicle),
    x: faced.x,
    y: faced.y,
    kind: "drop",
    expiresAt: null,
    ownerId: p.id,
    // A new ship faces out to sea, the way its builder looks.
    ...(isShip(vehicle) ? { facing: p.facing } : {}),
  });
  logActivity(ctx.world, p, "use", {
    item: p.char.bag[slot - 1]?.item,
    qty: -1,
    details: { built: vehicle },
  });
  // The vehicle itself is made, parked: counted by its kind wherever it is (issue #35).
  logActivity(ctx.world, p, "use", { item: vehicle, details: { built: vehicle, placed: 1 } });
  invDelSlot(p.char.bag, slot - 1, 1);
  p.invDirty = true;
  return io.out;
}

/**
 * From a click and from Ctrl: the owner on foot boards, anyone else on foot is told it is not
 * theirs, and a rider is told whose it is. An item with no owner id (an operator's `/drop` or a
 * World Editor placement) falls back to 1.6's name test.
 */
export function vehicleClick(ctx: ItemCtx, room: Room, p: Player, g: GroundItem): Outgoing[] {
  const io = new ItemOut(room);
  const vehicle = vehicleOfItem(g.item);
  // A world without rider bodies has no vehicles: one left on the ground cannot be boarded.
  if (!vehicle || !ridersBound()) {
    return io.out;
  }
  const isOwner = g.ownerId ? g.ownerId === p.id : lingoEq(ownerName(g.item), p.name);
  const r = boardCheck({
    vehicle: p.vehicle,
    stepFrames: p.stepFrames,
    me: { x: p.x, y: p.y },
    facing: p.facing,
    item: { x: g.x, y: g.y },
    isOwner,
  });
  const ship = isShip(vehicle) ? shipNoun(vehicle) : null;
  if (r === "notYours") {
    io.tell(p, ship ? SHIP_TEXT.notYours(ship) : VEHICLE_TEXT.notYours);
    return io.out;
  }
  if (r === "see") {
    const owner = ownerName(g.item);
    io.tell(p, ship ? SHIP_TEXT.see(owner, ship) : VEHICLE_TEXT.see(owner));
    return io.out;
  }
  // Board: the vehicle leaves the ground, the rider hops onto its tile with no step.
  removeGround(ctx, room, io, g.id);
  // The hull it was parked with, repaired for the time it stood (an SSO addition).
  p.hull = boardingHull(
    { hull: g.hull ?? null, parkedAt: g.parkedAt ?? null },
    hullMax(vehicle),
    ctx.now,
  );
  p.vitalsDirty = true;
  p.vehicle = vehicle;
  p.x = g.x;
  p.y = g.y;
  p.stepFrames = 0;
  // Aboard a ship you face the way it was moored, so boarding moves no pixel of it.
  if (isShip(vehicle)) {
    p.facing = g.facing ?? "E";
  }
  const body = VEHICLE_BODY[vehicle];
  p.spell.body = body;
  io.all({ e: "body", id: p.id, body });
  replace(room, io, p);
  p.forceYou = true;
  p.vehicleDirty = true;
  p.invDirty = true;
  io.tell(p, ship ? SHIP_TEXT.board(ship) : VEHICLE_TEXT.board);
  return io.out;
}

/**
 * From Ctrl aboard. An Airship parks on my own tile, which must be a `J2` pad with nothing on it,
 * and I stay there; 1.6 prints nothing. A ship parks on my own water tile and I step ashore onto
 * the faced tile, which a walker must be able to stand on (1.6's UnboardBoat).
 */
export function unboardVehicle(ctx: ItemCtx, room: Room, p: Player): Outgoing[] {
  const io = new ItemOut(room);
  const vehicle = p.vehicle;
  if (!vehicle) {
    return io.out;
  }
  const faced = facedTile(p);
  const taken = arenaTileTaken(room, p);
  const exitAt = (x: number, y: number) =>
    room.map.ground.some(
      (g) => g.x === x && g.y === y && (lingoEq(g.item, "Exit") || lingoEq(g.item, "Exit2")),
    );
  const r = isShip(vehicle)
    ? shipUnboardCheck({
        noun: shipNoun(vehicle),
        stepFrames: p.stepFrames,
        faced,
        footWalkable: isWalkable(room.map.walk, faced.x, faced.y),
        facedTaken: taken(faced.x, faced.y) || exitAt(faced.x, faced.y),
        itemOnMine: itemAt(room, p.x, p.y),
      })
    : unboardCheck({
        stepFrames: p.stepFrames,
        me: { x: p.x, y: p.y },
        layer1: room.map.layers[0],
        itemOnMine: itemAt(room, p.x, p.y),
      });
  if (r.kind === "text") {
    io.tell(p, r.text);
    return io.out;
  }
  addGround(ctx, room, io, {
    item: parkedName(p, vehicle),
    x: p.x,
    y: p.y,
    kind: "drop",
    expiresAt: null,
    ownerId: p.id,
    hull: p.hull,
    parkedAt: ctx.now,
    // A ship stays facing the way it was left.
    ...(isShip(vehicle) ? { facing: p.facing } : {}),
  });
  p.vehicle = null;
  p.hull = null;
  p.vitalsDirty = true;
  p.spell.body = null;
  io.all({ e: "body", id: p.id, body: null });
  if (isShip(vehicle)) {
    // Ashore: the rider hops onto the faced tile with no step.
    p.x = faced.x;
    p.y = faced.y;
    p.stepFrames = 0;
    replace(room, io, p);
  }
  p.forceYou = true;
  p.vehicleDirty = true;
  p.invDirty = true;
  return io.out;
}

/**
 * The vehicle is lost at death: the body reverts for everyone and nothing parks. Returns the body
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
