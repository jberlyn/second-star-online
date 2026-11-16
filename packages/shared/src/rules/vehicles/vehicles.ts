/**
 * The Airship's pure checks. I/O-free: the server action (server/systems/vehicles/airship.ts)
 * applies the result.
 *
 * Implements the original's airship-drop routine, the airship click, the boarding check and
 * unboarding, the Ctrl/click routing of an inventory item, and the drop refusal while aboard.
 */
import { MAP_HEIGHT, MAP_WIDTH } from "../../constants.ts";
import { lingoWord } from "../core/lingo.ts";
import { tileHas } from "../core/tiles.ts";
import type { Facing, Vehicle } from "../movement/movement.ts";
import { FACING_DELTA } from "../movement/movement.ts";

/** The body number every peer sees on a rider (body 57). */
export const AIRSHIP_BODY = 57;

/** The vehicle a body number means: only 57, the Airship (morphs are 30-41; others 80, 100). */
export function vehicleOfBody(body: number | null | undefined): Vehicle | null {
  return body === AIRSHIP_BODY ? "Airship" : null;
}

export const VEHICLE_TEXT = {
  standStill: "Please stand still before trying to build your airship.",
  /** No full stop, as in 1.6. */
  cannotBuild: "You cannot build your airship here",
  inTheWay: "There's something in the way, you can't place airship here!",
  board: "You board your Airship...",
  notYours: "You can't get on an Airship that's not yours!",
  see: (owner: string) => `You see ${owner}'s Airship.`,
  stopMoving: "Please stop moving before trying to unboard your airship.",
  cannotGetOff: "You cannot get off here.",
  parked: "There's already something here, you can't park your Airship here!",
  sky: "You can't drop this from the sky!",
} as const;

/**
 * Word `x` of the map record's field `y` (where `#` separates fields), which is a layer-1 row only
 * for y = 1..9 (a kept 1.6 bug for arena checks: an arena on rows 10-12 reads another field).
 * Returns "" outside rows 1-9.
 */
export function recordTile(layer1: readonly string[], x: number, y: number): string {
  if (y < 1 || y > 9) {
    return "";
  }
  return lingoWord(layer1[y - 1] ?? "", x);
}

/** Word `x` of layer 1's row `y` (1-based, 1..MAP_HEIGHT). Returns "" outside 1..MAP_HEIGHT. */
export function layer1Tile(layer1: readonly string[], x: number, y: number): string {
  if (y < 1 || y > MAP_HEIGHT) {
    return "";
  }
  return lingoWord(layer1[y - 1] ?? "", x);
}

/** A landing pad: the tile is "J2" (ignoring case). */
export function isDock(layer1: readonly string[], x: number, y: number): boolean {
  return tileHas(layer1Tile(layer1, x, y), "dock");
}

export type DeedResult = { kind: "silent" } | { kind: "text"; text: string } | { kind: "build" };

/** The airship-drop checks, in 1.6's order. The 20-item cap is dropped. */
export function deedCheck(a: {
  stepFrames: number;
  /** The tile the player faces (may be off-screen). */
  faced: { x: number; y: number };
  layer1: readonly string[];
  itemOnFaced: boolean;
}): DeedResult {
  if (a.stepFrames > 0) {
    return { kind: "text", text: VEHICLE_TEXT.standStill };
  }
  const { x, y } = a.faced;
  if (x === 0 || x === MAP_WIDTH + 1 || y === 0 || y === MAP_HEIGHT + 1) {
    return { kind: "silent" };
  }
  if (!isDock(a.layer1, x, y)) {
    return { kind: "text", text: VEHICLE_TEXT.cannotBuild };
  }
  if (a.itemOnFaced) {
    return { kind: "text", text: VEHICLE_TEXT.inTheWay };
  }
  return { kind: "build" };
}

/** The owner shown in an Airship's name: the text before the first `'`. */
export function ownerName(item: string): string {
  const i = item.indexOf("'");
  return i < 0 ? item : item.slice(0, i);
}

export type BoardResult = "silent" | "board" | "notYours" | "see";

/**
 * The airship click. Aboard already → nothing. The airship must be the tile I face and I must be
 * standing on my own tile (the original compares sprite positions): the tile one step back from the
 * item along my facing is mine. Then the owner boards; anyone else is told it isn't theirs.
 * Otherwise: "You see <owner>'s Airship."
 */
export function boardCheck(a: {
  vehicle: Vehicle | null;
  stepFrames: number;
  me: { x: number; y: number };
  facing: Facing;
  item: { x: number; y: number };
  isOwner: boolean;
}): BoardResult {
  if (a.vehicle !== null) {
    return "silent";
  }
  const [dx, dy] = FACING_DELTA[a.facing];
  const behindX = a.item.x - dx;
  const behindY = a.item.y - dy;
  if (a.stepFrames === 0 && behindX === a.me.x && behindY === a.me.y) {
    return a.isOwner ? "board" : "notYours";
  }
  return "see";
}

export type UnboardResult = { kind: "text"; text: string } | { kind: "park" };

/** Unboarding: mid-step, not a dock (my own tile), item here, park. */
export function unboardCheck(a: {
  stepFrames: number;
  me: { x: number; y: number };
  layer1: readonly string[];
  itemOnMine: boolean;
}): UnboardResult {
  if (a.stepFrames > 0) {
    return { kind: "text", text: VEHICLE_TEXT.stopMoving };
  }
  if (!isDock(a.layer1, a.me.x, a.me.y)) {
    return { kind: "text", text: VEHICLE_TEXT.cannotGetOff };
  }
  if (a.itemOnMine) {
    return { kind: "text", text: VEHICLE_TEXT.parked };
  }
  return { kind: "park" };
}
