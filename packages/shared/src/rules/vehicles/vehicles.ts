/**
 * The vehicles' pure checks: the Airship, the Boat and the Battleship. I/O-free: the server action
 * (server/systems/vehicles/vehicles.ts) applies the result.
 *
 * Implements the original's airship-drop and boat-drop routines, the airship and boat clicks, the
 * boarding check and unboarding, and the drop refusal while aboard.
 */
import { MAP_HEIGHT, MAP_WIDTH } from "../../constants.ts";
import { onContent } from "../../content/store.ts";
import { lingoWord } from "../core/lingo.ts";
import { tileHas } from "../core/tiles.ts";
import type { Facing, Vehicle } from "../movement/movement.ts";
import { FACING_DELTA } from "../movement/movement.ts";

/**
 * Each vehicle's rider body (`bindings.json` `bodies.riders`), as 1.6's `MyBody`: Classic's 55 the
 * Boat, 56 the Battleship, 57 the Airship. Every peer sees a rider as this body.
 */
export let VEHICLE_BODY: Readonly<Record<Vehicle, number>> = { Boat: 0, Battleship: 0, Airship: 0 };
let VEHICLE_OF_BODY = new Map<number, Vehicle>();
onContent((c) => {
  VEHICLE_BODY = { ...c.bindings.bodies.riders };
  VEHICLE_OF_BODY = new Map(
    (Object.entries(VEHICLE_BODY) as [Vehicle, number][]).map(([v, b]) => [b, v]),
  );
});

/** The vehicle a body number means: a rider body (Classic's 55-57), or null. */
export function vehicleOfBody(body: number | null | undefined): Vehicle | null {
  return body === null || body === undefined ? null : (VEHICLE_OF_BODY.get(body) ?? null);
}

/** The vehicle a parked ground item is: `<owner>'s Airship`, `'s Boat` or `'s Battleship`. */
export function vehicleOfItem(item: string): Vehicle | null {
  const lower = item.toLowerCase();
  if (lower.includes("'s airship")) {
    return "Airship";
  }
  if (lower.includes("'s battleship")) {
    return "Battleship";
  }
  if (lower.includes("'s boat")) {
    return "Boat";
  }
  return null;
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
 * The Boat's and Battleship's lines, from 1.6's boat routines, which said "boat" for both; SSO
 * names the Battleship as one.
 */
export const SHIP_TEXT = {
  standStill: (noun: string) => `Please stand still before trying to build your ${noun}.`,
  notWater: (noun: string) =>
    `You have to use this ${noun} deed over water to have your ship built!`,
  inTheWay: (noun: string) => `There's something in the way, you can't place your ${noun} here!`,
  board: (noun: string) => `You board your ${noun}...`,
  notYours: (noun: string) => `You can't get on a ${noun} that's not yours!`,
  see: (owner: string, noun: string) => `You see ${owner}'s ${noun}.`,
  stopMoving: (noun: string) => `Please stop moving before trying to unboard your ${noun}.`,
  cannotGetOff: "You can't get off here!",
  parked: (noun: string) => `There's already something here, you can't park your ${noun} here!`,
  ocean: "You can't drop this into the ocean!",
} as const;

/** A ship's name in its lines: "boat" or "battleship". */
export function shipNoun(vehicle: "Boat" | "Battleship"): string {
  return vehicle === "Boat" ? "boat" : "battleship";
}

/** The line refusing a drop aboard: from the sky on an Airship, into the ocean on a ship. */
export function dropRefusal(vehicle: Vehicle): string {
  return vehicle === "Airship" ? VEHICLE_TEXT.sky : SHIP_TEXT.ocean;
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

export type BoardResult = "board" | "notYours" | "see";

/**
 * The vehicle click. Aboard already → "You see <owner>'s Airship." (1.6 said nothing; SSO lets a
 * rider look). The vehicle must be the tile I face and I must be standing on my own tile (the
 * original compares sprite positions): the tile one step back from the item along my facing is
 * mine. Then the owner boards; anyone else is told it isn't theirs. Otherwise: "You see <owner>'s
 * Airship."
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
    return "see";
  }
  const [dx, dy] = FACING_DELTA[a.facing];
  const behindX = a.item.x - dx;
  const behindY = a.item.y - dy;
  if (a.stepFrames === 0 && behindX === a.me.x && behindY === a.me.y) {
    return a.isOwner ? "board" : "notYours";
  }
  return "see";
}

/**
 * The boat-drop checks, in 1.6's order (its 20-item cap dropped): stand still, the faced tile on
 * screen, a tile the ship can sail (`shipWalkable`; 1.6 listed W1 N1 D2 I2), nothing on it.
 */
export function shipDeedCheck(a: {
  noun: string;
  stepFrames: number;
  faced: { x: number; y: number };
  shipWalkable: boolean;
  itemOnFaced: boolean;
  playerOnFaced: boolean;
}): DeedResult {
  if (a.stepFrames > 0) {
    return { kind: "text", text: SHIP_TEXT.standStill(a.noun) };
  }
  const { x, y } = a.faced;
  if (x < 1 || x > MAP_WIDTH || y < 1 || y > MAP_HEIGHT) {
    return { kind: "silent" };
  }
  if (!a.shipWalkable) {
    return { kind: "text", text: SHIP_TEXT.notWater(a.noun) };
  }
  if (a.itemOnFaced || a.playerOnFaced) {
    return { kind: "text", text: SHIP_TEXT.inTheWay(a.noun) };
  }
  return { kind: "build" };
}

/**
 * Getting off a ship onto the faced tile, which must be one a walker could step onto: walkable on
 * foot, on screen, not an exit, and free of players, monsters and blocking items (1.6 checked a
 * fixed list of ground tiles). The ship parks on my own tile, which must hold no item.
 */
export function shipUnboardCheck(a: {
  noun: string;
  stepFrames: number;
  faced: { x: number; y: number };
  footWalkable: boolean;
  facedTaken: boolean;
  itemOnMine: boolean;
}): UnboardResult {
  if (a.stepFrames > 0) {
    return { kind: "text", text: SHIP_TEXT.stopMoving(a.noun) };
  }
  const { x, y } = a.faced;
  const onScreen = x >= 1 && x <= MAP_WIDTH && y >= 1 && y <= MAP_HEIGHT;
  if (!onScreen || !a.footWalkable || a.facedTaken) {
    return { kind: "text", text: SHIP_TEXT.cannotGetOff };
  }
  if (a.itemOnMine) {
    return { kind: "text", text: SHIP_TEXT.parked(a.noun) };
  }
  return { kind: "park" };
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

/**
 * A vehicle's hull (issue #2, an SSO addition: 1.6 had none). Hits on a rider wear the hull, never
 * the rider: a fixed amount per hit, whatever the attacker's level or power. At 0 the vehicle is
 * lost and the rider dies.
 */
export const HULL_MAX: Readonly<Record<Vehicle, number>> = {
  Boat: 60,
  Airship: 80,
  Battleship: 150,
};

/** What one arrow or harmful spell takes off a hull. */
export const HULL_HIT_DAMAGE = 2;

/** Hull a parked vehicle regains for each whole minute parked. */
export const HULL_REPAIR_PER_MINUTE = 1;

/** A vehicle's full hull. */
export function hullMax(vehicle: Vehicle): number {
  return HULL_MAX[vehicle];
}

/**
 * The hull a rider boards with. A parked vehicle's hull (null: never damaged, or parked before
 * hulls existed, so full) gains `repairPerMinute` for each whole minute since `parkedAt`, and never
 * exceeds the full hull (which may have been lowered since).
 */
export function boardingHull(
  parked: { hull: number | null; parkedAt: number | null },
  max: number,
  now: number,
  repairPerMinute = HULL_REPAIR_PER_MINUTE,
): number {
  if (parked.hull === null) {
    return max;
  }
  const minutes = parked.parkedAt === null ? 0 : Math.floor((now - parked.parkedAt) / 60_000);
  return Math.min(max, parked.hull + Math.max(0, minutes) * repairPerMinute);
}

/** The line everyone sees when a rider's vehicle is destroyed, in place of the death line. */
export function sunkText(name: string, vehicle: Vehicle, killer: string | null): string {
  const by = killer ? ` by ${killer}` : "";
  if (vehicle === "Airship") {
    return `*** ${name}'s airship was shot down${by}. ${name} fell from the sky.`;
  }
  return `*** ${name}'s ${shipNoun(vehicle)} was sunk${by}. ${name} was claimed by the waters.`;
}
