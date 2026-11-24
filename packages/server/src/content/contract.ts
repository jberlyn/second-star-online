/**
 * The core content contract (issue #37): what a world must have before it can run. Content must
 * bind a currency item and have at least one start class and one skill; the start, fallback and
 * jail points (settings) must stand on walkable tiles of maps that exist, and the start and
 * fallback may not be on the jail's map. Every other binding is
 * optional: one left out turns its mechanic off.
 *
 * The content service refuses a publish (and an undo, or taking a pack's change) that breaks the
 * contract; the game refuses a settings save that moves a point off the walkable ground, and names
 * what is broken at start (`bun run maps:check` too). Pure: the maps come from the caller.
 */
import {
  blocksPlayer,
  type ContentData,
  footWalkGrid,
  isWalkable,
  lingoEq,
  MAP_HEIGHT,
  MAP_WIDTH,
  parseMapName,
} from "@secondstaronline/shared";

import type { ContentProblem } from "./validate.ts";

/** What content must hold for a world to run, and the bindings that must not clash. */
export function contractProblems(data: ContentData): ContentProblem[] {
  const out: ContentProblem[] = [];
  const currency = data.bindings.currency.item;
  if (currency === undefined) {
    out.push({
      where: "bindings/currency",
      message: "the world needs a currency: bind an item as its item",
    });
  } else {
    const item = data.items.items.find((i) => lingoEq(i.name, currency));
    if (!item || item.retired) {
      out.push({
        where: "bindings/currency",
        message: `the currency must be an item that exists and is not retired: ${currency}`,
      });
    } else if (item.name !== currency) {
      // Piles are named with the currency's key, so it is spelled exactly as the item is.
      out.push({
        where: "bindings/currency",
        message: `spell the currency exactly as its item's key: ${item.name}`,
      });
    }
  }
  if (data.classes.startClasses.length === 0) {
    out.push({
      where: "classes/startClasses",
      message: "the world needs at least one start class",
    });
  }
  if (data.classes.skills.length === 0) {
    out.push({ where: "classes/skills", message: "the world needs at least one skill" });
  }
  // A body tells peers what a player is: a rider's body must say which vehicle, and no spell may
  // put a rider's body on a player who is not riding.
  const { riders, morph, tree, smoke } = data.bindings.bodies;
  const riderOf = new Map<number, string>();
  // Vehicles are engine kinds drawn as their rider bodies: a world without riders has none.
  if (!riders) {
    data.houses.deeds.forEach((d) => {
      if (d.use === "airship" || d.use === "boat" || d.use === "battleship") {
        out.push({
          where: "bindings/bodies",
          message: `${d.deed} makes a vehicle, so the world needs rider bodies (bodies.riders)`,
        });
      }
    });
  }
  for (const [vehicle, body] of Object.entries(riders ?? {})) {
    const other = riderOf.get(body);
    if (other) {
      out.push({
        where: "bindings/bodies",
        message: `the ${other} and the ${vehicle} riders need different bodies (both are ${body})`,
      });
    }
    riderOf.set(body, vehicle);
  }
  const spellBodies: [string, number | undefined][] = [
    ["tree", tree],
    ["smoke", smoke],
    ...(morph ?? []).map((r, i): [string, number] => [`morph[${i}]`, r.body]),
  ];
  for (const [name, body] of spellBodies) {
    const vehicle = body === undefined ? undefined : riderOf.get(body);
    if (vehicle) {
      out.push({
        where: "bindings/bodies",
        message: `${name} is the ${vehicle} rider's body (${body}): give it another`,
      });
    }
  }
  if (smoke !== undefined && smoke === tree) {
    out.push({
      where: "bindings/bodies",
      message: `the smoke and the tree need different bodies (both are ${smoke})`,
    });
  }
  // A morph shown as the smoke would hide its player; one shown as the tree would read as a tree.
  (morph ?? []).forEach((r, i) => {
    const as = r.body === smoke ? "smoke" : r.body === tree ? "tree" : null;
    if (as) {
      out.push({
        where: "bindings/bodies",
        message: `morph[${i}] is the ${as}'s body (${r.body}): give it another`,
      });
    }
  });
  return out;
}

/** A point setting: a map and a tile. */
export interface MapPoint {
  map: string;
  x: number;
  y: number;
}

/** What the point check reads of a map. */
export interface PointMap {
  layers: readonly (readonly string[])[];
  ground: readonly { x: number; y: number; item: string }[];
}

/** The settings the contract needs on walkable ground, with their labels. */
export const CONTRACT_POINTS = {
  startPoint: "Starting map",
  fallbackPoint: "Fallback map",
  jailPoint: "Jail",
} as const;

export type ContractPoint = keyof typeof CONTRACT_POINTS;

/**
 * Why a point cannot hold a player, or null when it can: its map must exist, and its tile must be
 * walkable on foot with the installed content's tiles and free of anything that blocks a new
 * character's way (`ground.blocks`, and the skill and level platforms).
 */
export function pointProblem(
  pt: MapPoint,
  loadMap: (name: string) => PointMap | null,
): string | null {
  const m = loadMap(pt.map);
  if (!m) {
    return `${pt.map} does not exist`;
  }
  if (pt.x < 1 || pt.x > MAP_WIDTH || pt.y < 1 || pt.y > MAP_HEIGHT) {
    return `(${pt.x}, ${pt.y}) is off the map`;
  }
  const walk = footWalkGrid(m.layers[0] ?? [], m.layers[1] ?? []);
  if (!isWalkable(walk, pt.x, pt.y)) {
    return `${pt.map} (${pt.x}, ${pt.y}) is not a walkable tile`;
  }
  // As a player on foot meets it, a new one: the skill and level platforms block too.
  const blocker = m.ground.find(
    (g) => g.x === pt.x && g.y === pt.y && blocksPlayer(g.item, NEW_PLAYER),
  );
  if (blocker) {
    return `${pt.map} (${pt.x}, ${pt.y}) is blocked by ${blocker.item}`;
  }
  return null;
}

/** Who the points must hold: a new character, level 1 with no skill raised. */
const NEW_PLAYER = { level: 1, skills: [] as number[] };

/**
 * Two map names are one map: grid names by their numbers (`x00y0` is `x0y0`), others as the jail
 * check compares them (case ignored).
 */
export function sameMap(a: string, b: string): boolean {
  const ga = parseMapName(a);
  const gb = parseMapName(b);
  return ga && gb ? ga.mx === gb.mx && ga.my === gb.my : lingoEq(a, b);
}

/**
 * Why the start or fallback point cannot be on its map, or null: never the jail's. The jail map
 * holds whoever stands on it (no edges, exits or Portal; anyone not serving a sentence is moved
 * off), so a new character would start in jail, and a fallback there would send released
 * prisoners back in.
 */
export function jailMapProblem(
  key: ContractPoint,
  points: Readonly<Record<ContractPoint, MapPoint>>,
): string | null {
  return key !== "jailPoint" && sameMap(points[key].map, points.jailPoint.map)
    ? `${points[key].map} is the jail's map`
    : null;
}

/**
 * The jail-map clash a settings save makes, under the setting it changed: a start or fallback
 * point moved onto the jail's map, or the jail moved onto the start's or the fallback's map.
 */
export function jailClash(
  points: Readonly<Record<ContractPoint, MapPoint>>,
  changed: readonly string[],
): { key: ContractPoint; text: string } | null {
  for (const key of ["startPoint", "fallbackPoint"] as const) {
    if (changed.includes(key) && sameMap(points[key].map, points.jailPoint.map)) {
      return { key, text: `${points[key].map} is the jail's map` };
    }
  }
  if (changed.includes("jailPoint")) {
    for (const key of ["startPoint", "fallbackPoint"] as const) {
      if (sameMap(points[key].map, points.jailPoint.map)) {
        return {
          key: "jailPoint",
          text: `${points.jailPoint.map} holds the ${CONTRACT_POINTS[key]} point: the jail needs a map of its own`,
        };
      }
    }
  }
  return null;
}

/** The contract's points that cannot hold a player. */
export function pointProblems(
  points: Readonly<Record<ContractPoint, MapPoint>>,
  loadMap: (name: string) => PointMap | null,
): ContentProblem[] {
  return (Object.keys(CONTRACT_POINTS) as ContractPoint[]).flatMap((key) => {
    const problem = pointProblem(points[key], loadMap) ?? jailMapProblem(key, points);
    return problem === null
      ? []
      : [{ where: `settings/${key}`, message: `${CONTRACT_POINTS[key]}: ${problem}` }];
  });
}
